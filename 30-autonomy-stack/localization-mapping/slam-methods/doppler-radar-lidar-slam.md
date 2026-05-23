# Doppler Radar-LiDAR SLAM

<!-- method-priority:start
priority:
  learning: 3
  deployment: 3
  type: "method-family"
  stage: "deployment-pattern"
  maturity: "prototype"
  tags: ["slam", "fallback", "gnss-denied", "outdoor", "adverse-weather"]
  reason: "Doppler Radar-LiDAR SLAM is rated for Doppler-aware radar odometry and radar-LiDAR-inertial fallback localization under degraded visibility."
method-priority:end -->

Related docs: [Radar Odometry and Radar SLAM](radar-odometry-radar-slam.md), [Radar-Inertial Odometry](radar-inertial-odometry.md), [4D Imaging Radar RIO and SLAM](4d-imaging-radar-rio-slam.md), [Radar RIO correspondence and uncertainty](radar-rio-correspondence-uncertainty.md), [Radar-LiDAR-Inertial Fusion](radar-lidar-inertial-fusion.md), [RadarSplat-RIO](radarsplat-rio.md), [CAO-RONet](cao-ronet.md), [Radar Place Recognition: 4DRaL and SHeRLoc](radar-place-recognition-4dral-sherloc.md), [4D imaging radar](../../../20-av-platform/sensors/4d-radar.md), and [radar FMCW/MIMO/Doppler](../../../10-knowledge-base/signal-processing/radar-fmcw-mimo-doppler.md).

**Last updated:** 2026-05-23

## Executive Summary

Doppler radar-LiDAR SLAM is the bridge between radar-only odometry, radar-inertial odometry, and radar-LiDAR-inertial fusion. It treats Doppler not only as an object-detection attribute, but as a motion constraint for ego-velocity, radar scan distortion, direct radar registration, and multi-sensor factor graphs.

This page groups three related 2024-2025 lines that are easy to scatter across broader radar pages:

- **Radarize:** commodity single-chip mmWave radar SLAM for indoor robots, using Doppler-shift odometry and multipath artifact suppression.
- **DRO:** Doppler-aware direct odometry for spinning FMCW radar, using radar intensity scan-to-local-map registration plus motion and Doppler distortion models.
- **Doppler-SLAM:** Doppler-aided radar-inertial and LiDAR-inertial SLAM, coupling 4D radar or FMCW LiDAR, IMU, Doppler velocity, graph optimization, loop closure, and online extrinsic calibration.

The production lesson is not that Doppler alone solves localization. Doppler is a high-value velocity and distortion cue that can stabilize radar odometry and help LiDAR-inertial systems under degraded visibility, but it must still be fused with calibrated timing, extrinsics, IMU/wheel/GNSS/map constraints, health monitoring, and conservative fallback policies.

## Why This Bridge Page Exists

Existing pages already cover the broad families:

- [Radar Odometry and Radar SLAM](radar-odometry-radar-slam.md) covers radar-only registration, radar keypoints, radar maps, and radar loop closure.
- [Radar-Inertial Odometry](radar-inertial-odometry.md) covers radar plus IMU state estimation.
- [4D Imaging Radar RIO and SLAM](4d-imaging-radar-rio-slam.md) covers 4D radar, Doppler ego-velocity, and RIO/SLAM pipelines.
- [Radar RIO correspondence and uncertainty](radar-rio-correspondence-uncertainty.md) covers point-correspondence learning, radar point uncertainty, and uncertainty-aware RIO weighting.
- [Radar-LiDAR-Inertial Fusion](radar-lidar-inertial-fusion.md) covers multi-sensor fusion when LiDAR is degraded.

Radarize, DRO, and Doppler-SLAM are narrower than those family pages, but related enough that separate atomic pages would duplicate assumptions, failure modes, and routing. Treat them as a Doppler bridge cluster until one method becomes a stable production reference or needs deeper implementation coverage.

## Method Boundary

| Method | Sensor setting | Core idea | Source maturity | Routing |
|---|---|---|---|---|
| Radarize | Commodity single-chip mmWave radar, indoor robots | Doppler-shift odometry plus multipath artifact suppression for radar-only SLAM | MobiSys 2024 paper, project page, code, and Zenodo dataset | Commodity radar-only SLAM route; weak direct transfer to road/airside without sensor and environment validation |
| DRO | Spinning FMCW radar, optional gyroscope, Doppler-enabling modulation when available | Direct scan-to-local-map registration over radar intensity while modeling motion and Doppler distortion; optional Doppler velocity constraint | RSS 2025 paper and public MIT-licensed code | Direct radar odometry route for high-resolution radar and radar benchmark comparison |
| Doppler-SLAM | 4D radar or FMCW LiDAR plus IMU, with graph optimization and loop closure | Doppler-aided radar-inertial and LiDAR-inertial SLAM with online extrinsic calibration | RA-L 2025 paper and repository, but repository usage/source maturity remains incomplete as of this update | Radar-LiDAR-inertial fusion route; watch for runnable source release before treating as code-mature |

## Inputs and Outputs

Inputs:

- Doppler-capable radar measurements: range, azimuth, optional elevation, intensity/RCS, and radial velocity.
- For spinning radar methods: polar radar intensity scans and timestamps across a sweep.
- Optional IMU or gyroscope measurements for high-rate rotation and velocity propagation.
- Optional LiDAR or FMCW LiDAR point data for geometric constraints.
- Sensor extrinsics, time offsets, radar chirp/modulation configuration, and vehicle-frame conventions.
- Dataset-specific calibration and ground truth for evaluation.

Outputs:

- Radar odometry or radar-inertial odometry.
- Velocity estimates constrained by Doppler measurements.
- Motion-compensated radar scans or radar local maps.
- Optional SLAM trajectory, loop closures, and graph-optimized map state.
- Health signals such as Doppler inlier counts, scan-registration residuals, and cross-modal consistency.

Non-outputs:

- No guarantee of absolute global pose without map, GNSS, loop closure, or external reference.
- No LiDAR-like dense geometry from radar alone.
- No safety case for standalone use in road, airside, port, mining, or construction autonomy.
- No assumption that indoor commodity radar results transfer to outdoor AV radars.

## Core Technical Idea

Doppler gives a radial velocity measurement along the radar line of sight. For a static reflector, that radial velocity is induced by ego-motion. A simplified residual is:

```text
r_doppler = z_i - u_i^T * (v_body + omega_body x r_i)
```

where `z_i` is measured radial velocity, `u_i` is the line-of-sight unit vector, `v_body` is body velocity, `omega_body` is angular velocity, and `r_i` is the reflector position in the sensor frame.

The bridge family uses this signal in three ways:

1. **Velocity aiding:** Estimate ego-velocity from many static radar returns and use it as a factor in odometry or SLAM.
2. **Scan distortion correction:** Model the fact that spinning radar scans are collected over time, so vehicle motion and Doppler distortion affect the radar image.
3. **Fusion hardening:** Add Doppler factors beside IMU, LiDAR scan factors, radar scan factors, loop closures, and online calibration variables.

The practical pattern is:

```text
Doppler-capable radar
  -> radar filtering and static-return selection
  -> Doppler velocity / distortion model
  -> radar direct registration or radar-inertial factor
  -> optional LiDAR/IMU/map/loop fusion
  -> pose, velocity, covariance, and sensor-health state
```

## Pipeline

1. **Sensor decoding and synchronization**
   - Decode radar intensity, point, and Doppler fields.
   - Align radar, IMU, LiDAR, wheel, and GNSS/map timestamps.
   - Preserve chirp/modulation metadata because Doppler observability depends on radar waveform design.

2. **Radar preprocessing**
   - Filter near-field ego returns, sidelobes, low-confidence detections, and obvious dynamic objects.
   - Estimate static-return sets or robustly downweight moving objects.
   - Convert between polar images, radar point clouds, and local-map representations as needed.

3. **Doppler velocity and distortion modeling**
   - Estimate ego-velocity from static Doppler measurements.
   - Model sweep-time motion distortion for spinning radar.
   - Handle Doppler sign convention, ambiguity, wrapping, and chirp-specific observability.

4. **Odometry or SLAM update**
   - Radarize-style systems run radar-only odometry and mapping.
   - DRO-style systems directly register radar intensity scans to a local map.
   - Doppler-SLAM-style systems add Doppler and spatial factors inside a radar-inertial or LiDAR-inertial graph.

5. **Back-end and diagnostics**
   - Add IMU preintegration, loop closures, map constraints, GNSS, wheel factors, or LiDAR scan factors when available.
   - Publish modality residuals, inlier geometry, covariance, and fallback state.
   - Reject or inflate Doppler factors when dynamic clutter, multipath, or weak geometry dominates.

## Strengths

- Doppler directly observes velocity, which cameras and LiDAR do not measure without temporal differencing.
- Radar remains useful in rain, fog, snow, dust, smoke, darkness, and glare.
- Direct radar registration avoids fragile feature extraction for some high-resolution spinning radar settings.
- Doppler distortion modeling can improve spinning-radar odometry when scan time is non-negligible.
- Multi-sensor graph formulations can combine radar velocity with IMU propagation, LiDAR geometry, loop closure, and online extrinsic calibration.
- Radar-only methods like Radarize are useful for low-cost indoor robot research where privacy, lighting, and occlusion matter.

## Failure Modes

- **Dynamic objects:** Moving vehicles, aircraft, carts, people, forklifts, and machinery create Doppler that is not ego-motion.
- **Multipath and ghosts:** Metal, glass, wet pavement, fences, containers, aircraft, racks, and terminal facades can create false returns.
- **Doppler ambiguity:** Velocity wrapping, sign conventions, and waveform-specific Doppler observability can silently bias estimates.
- **Timing and extrinsics:** Small radar-IMU-LiDAR time offsets or lever-arm errors bias Doppler residuals and scan deskewing.
- **Sparse observability:** Open aprons, fields, featureless tunnels, and smooth corridors can have weak spatial constraints even if velocity is observable.
- **Sensor transfer:** Commodity indoor mmWave radar, spinning Navtech-style radar, automotive 4D radar, and FMCW LiDAR have different noise and observability models.
- **Overweighting velocity:** Doppler improves velocity and distortion correction, but does not by itself bound position, yaw, or global map drift.
- **Code maturity mismatch:** Paper claims and public repositories are not equally ready; Doppler-SLAM's public repository still needs runnable usage/source maturity checks before code-level adoption.

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV | Medium | Useful as an adverse-weather odometry/fusion cue; road-speed operation needs radar model, traffic dynamic-object, and map-fusion validation. |
| Airside | Medium-high | Doppler is valuable in fog, rain, night, spray, wet pavement, and open-apron fallback, but aircraft and GSE multipath make standalone radar unsafe. |
| Warehouse / factory | Medium | Radarize-style commodity radar is relevant indoors, but racks, metal walls, and tight corridors increase multipath and aliasing. |
| Logistics yard / port | Medium-high | Containers, trucks, poles, and buildings provide reflectors; moving heavy vehicles require dynamic-return rejection. |
| Mining / construction | Medium-high | Strong dust and low-visibility relevance; vibration, sparse geometry, and moving machinery require robust fusion. |
| Agriculture | Medium | Weather and dust robustness help, but vegetation motion and weak static structure can reduce scan-matching reliability. |
| Delivery robot / outdoor campus | Medium | Useful as a rain/night fallback if radar placement and compute allow it; small platforms may have weak mounting geometry. |

## AV Relevance

The strongest AV role is a fallback and cross-checking factor:

- Add Doppler velocity factors to a LiDAR-inertial or radar-inertial estimator.
- Use direct radar odometry as an independent monitor when LiDAR or cameras degrade.
- Compare Doppler-aided radar odometry against wheel/IMU/GNSS/map localization during weather and visibility faults.
- Preserve short-term motion continuity in feature-poor or obscured segments.
- Expose radar health separately so planners know when Doppler geometry is weak or dynamic clutter dominates.

The production architecture should look like:

```text
Doppler radar odometry / radar-LiDAR-inertial factors
  + IMU / wheel / LiDAR / map / GNSS where valid
  + modality health and covariance inflation
  + dynamic-object and multipath rejection
  + fallback policy
  -> safety-gated localization state
```

## Implementation Notes

- Start by reproducing public benchmarks for the exact method family: Radarize indoor sequences, DRO Boreas/MulRan runs, or Doppler-SLAM demos when runnable source matures.
- Log radar waveform, chirp configuration, Doppler ambiguity limits, and sign conventions as part of the calibration package.
- Treat radar Doppler, radar spatial registration, LiDAR scan matching, IMU propagation, and wheel odometry as separate residual families with separate health metrics.
- Keep radar time alignment and lever-arm calibration in the estimator or release gate; Doppler residuals are sensitive to both.
- Compare radar-only, radar-inertial, radar-LiDAR-inertial, and full localization-stack outputs on the same routes.
- Validate on weather and visibility slices, not only average ATE.
- Do not promote a paper repository into a production dependency until install, dataset, run, evaluation, and license paths are verified.

## Validation Checklist

- Reproduce the authors' reported dataset route before changing sensors or domains.
- Check Doppler inlier geometry by route segment, weather, speed, and traffic density.
- Run ablations with and without Doppler constraints, scan-deskew modeling, gyro/IMU aiding, and LiDAR factors.
- Measure drift in open areas, featureless tunnels, metal-rich interiors, wet pavement, and dense dynamic traffic.
- Validate radar-to-IMU and radar-to-LiDAR extrinsics after vibration, maintenance, and sensor replacement.
- Compare covariance consistency using NIS/NEES or equivalent innovation diagnostics.
- Test fallback behavior when radar Doppler is unreliable, LiDAR is degraded, or both disagree.
- For airside and managed-site use, include aircraft, GSE, containers, fences, terminal glass, de-icing spray, and wet-ground scenarios.

## Sources

- Sie, Wu, Guo, and Vasisht, "Radarize: Enhancing Radar SLAM with Generalizable Doppler-Based Odometry." MobiSys 2024 / arXiv. https://arxiv.org/abs/2311.11260
- Radarize project page. https://radarize.github.io/
- Radarize official implementation. https://github.com/ConnectedSystemsLab/radarize_ae
- Radarize dataset release. https://zenodo.org/records/11093859
- Le Gentil, Brizi, Lisus, Qiao, Grisetti, and Barfoot, "DRO: Doppler-Aware Direct Radar Odometry." RSS 2025 / arXiv. https://arxiv.org/abs/2504.20339
- DRO official implementation. https://github.com/utiasASRL/dro
- Wang et al., "Doppler-SLAM: Doppler-Aided Radar-Inertial and LiDAR-Inertial Simultaneous Localization and Mapping." IEEE RA-L, 2025. https://arxiv.org/abs/2504.11634
- Doppler-SLAM repository. https://github.com/Wayne-DWA/Doppler-SLAM
- Local context: [Radar Odometry and Radar SLAM](radar-odometry-radar-slam.md)
- Local context: [Radar-LiDAR-Inertial Fusion](radar-lidar-inertial-fusion.md)
