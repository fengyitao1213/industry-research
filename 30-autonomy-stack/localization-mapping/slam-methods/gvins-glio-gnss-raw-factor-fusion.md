# GVINS and GLIO Raw GNSS Factor Fusion

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method-family"
  stage: "deployment-pattern"
  maturity: "prototype"
  tags: ["slam", "runtime-localization", "outdoor", "fallback"]
  reason: "Raw GNSS factor fusion is rated for globally referenced localization when visual, LiDAR, IMU, and GNSS factors must survive urban-canyon outages."
method-priority:end -->

Related docs: [GNSS and RTK error models](../../../10-knowledge-base/state-estimation/gnss-rtk-error-models.md), [RTK GPS and IMU localization](../../../10-knowledge-base/state-estimation/rtk-gps-imu-localization.md), [GTSAM factor graphs](../../../10-knowledge-base/state-estimation/gtsam-factor-graphs.md), [multi-sensor fusion measurement models](../../../10-knowledge-base/state-estimation/multi-sensor-fusion-measurement-models-first-principles.md), [VINS-Mono / VINS-Fusion](vins-mono-vins-fusion.md), [LIO-SAM](lio-sam.md), [factor graphs and iSAM2](factor-graph-isam2-gtsam.md), [GLIM](glim.md), and [robust multi-sensor localization](../overview/robust-state-estimation-multi-sensor.md).

**Last updated:** 2026-05-23

## Executive Summary

GVINS and GLIO are useful references for tightly coupling raw GNSS observables with local odometry sensors instead of inserting GNSS only as a loose position fix. GVINS combines GNSS pseudorange and Doppler factors with visual-inertial constraints. GLIO combines GNSS pseudorange and Doppler factors with LiDAR-inertial odometry and a larger mapping optimization.

The common lesson is factor accountability. A local odometry chain can remain smooth through short GNSS outages, while raw satellite factors can anchor the graph when enough trustworthy measurements are available. This is different from simply adding an RTK position message to a state estimator; the graph can reason about satellite geometry, receiver clock terms, Doppler range-rate evidence, and local visual or LiDAR motion constraints together.

For AVs, the pattern matters anywhere GNSS is intermittently useful but not fully trustworthy: urban canyons, terminals, ports, mines with open-sky transitions, construction sites, campuses, and airport aprons near reflective structures. It is not a guarantee of centimeter accuracy. Multipath, antenna lever arms, clock modeling, satellite visibility, and robust gating still decide whether raw GNSS factors help or corrupt the estimate.

## What It Covers

| System | Sensor mix | Core idea | Best use here |
|---|---|---|---|
| GVINS | Camera, IMU, raw GNSS | Fuse code pseudorange and Doppler shift with visual-inertial optimization | GNSS-VIO reference for global 6-DoF consistency under partial satellite availability. |
| GLIO | LiDAR, IMU, raw GNSS | Fuse pseudorange, Doppler, LiDAR, and IMU factors with sliding-window and batch optimization | GNSS-LiDAR-IMU reference for urban-canyon and outdoor mapping localization. |

Both systems belong beside VINS-Fusion and LIO-SAM, but they fill a narrower gap: direct raw GNSS observable factors rather than only GPS/RTK position factors.

## Inputs and Outputs

Inputs:

- Raw GNSS observables, especially pseudorange and Doppler.
- Satellite ephemeris, receiver time, and GNSS quality metadata.
- IMU measurements for propagation and short-term motion.
- Camera feature tracks for GVINS, or LiDAR scans and local maps for GLIO.
- Sensor extrinsics, antenna lever arm, and timestamp alignment.
- Optional correction streams or receiver products depending on the platform.

Outputs:

- Locally smooth odometry from visual-inertial or LiDAR-inertial constraints.
- Globally anchored pose estimates when GNSS factors are accepted.
- Receiver clock and drift estimates where modeled.
- Graph residuals for GNSS, IMU, visual, LiDAR, and loop or map constraints.
- Diagnostics for satellite availability, innovation gating, and GNSS outage handling.

## Raw GNSS Factor Pattern

The GNSS measurement model is covered in [GNSS and RTK error models](../../../10-knowledge-base/state-estimation/gnss-rtk-error-models.md). The SLAM-relevant abstraction is:

```text
X* = arg min_X
    sum_imu      || r_imu(x_i, x_j) ||^2
  + sum_local    rho(|| r_visual_or_lidar(x_k, z_k) ||^2)
  + sum_pr       rho(|| r_pseudorange(x_k, clock_k, sat_j, z_pr) ||^2)
  + sum_dopp     rho(|| r_doppler(x_k, v_k, clock_drift_k, sat_j, z_d) ||^2)
  + sum_prior    || r_prior ||^2
```

Pseudorange factors constrain receiver position and clock bias relative to satellites. Doppler factors constrain range rate, which helps velocity, clock drift, and continuity through partial satellite visibility. Local odometry factors keep the graph observable when GNSS is weak, while GNSS factors keep local odometry from drifting when satellite evidence is trustworthy.

The operational risk is asymmetry: a missing GNSS factor usually causes drift, but a bad GNSS factor can bend the whole graph. Raw-factor systems therefore need residual inspection, robust kernels, elevation and signal-quality weighting, multipath checks, and covariance inflation rather than blind insertion.

## GVINS Structure

GVINS extends visual-inertial smoothing with raw GNSS factors. Its important modeling choices are:

1. Use visual features and IMU preintegration for locally smooth 6-DoF motion.
2. Use GNSS pseudorange factors for absolute range evidence to satellites.
3. Use Doppler shift factors for range-rate and velocity information.
4. Estimate GNSS receiver clock terms inside the optimization.
5. Maintain continuity across GNSS-friendly, GNSS-intermittent, and GNSS-unfriendly intervals.

The paper reports that even one satellite can help when fused with visual-inertial constraints, but that should be interpreted as a fused-graph result, not as standalone one-satellite localization.

## GLIO Structure

GLIO applies the same raw-GNSS idea to LiDAR-inertial odometry. Its structure is useful for ground robots and AV-like platforms:

1. Run LiDAR-inertial odometry over a sliding window.
2. Add pseudorange and Doppler factors directly to the optimization.
3. Use scan-to-multiscan LiDAR constraints in a larger batch optimization stage.
4. Evaluate against urban-canyon data where standalone GNSS and local LIO each have different failure modes.

The GLIO paper reports large positioning improvements over traditional GNSS and standalone LIO baselines on UrbanNav-style urban-canyon evaluation. Treat that as paper evidence for the method pattern, not as a general production guarantee.

## Assumptions

- Raw GNSS measurements and ephemerides are available from the receiver.
- Satellite timestamps, receiver clock terms, and sensor timestamps are modeled consistently.
- Antenna lever arm relative to the IMU/body frame is calibrated.
- IMU noise and bias models are close enough for preintegration.
- Camera or LiDAR odometry remains locally observable when GNSS is weak.
- Multipath and low-elevation satellites are downweighted or rejected.
- GNSS residuals can be inspected separately from visual, LiDAR, and IMU residuals.

## Failure Modes

- **Multipath bias:** Reflections from buildings, hangars, aircraft, containers, cranes, or wet ground can create confident but wrong pseudorange factors.
- **Overconfident receiver metadata:** Receiver fix status or covariance may not fully reflect local multipath or spoofing.
- **Lever-arm error:** A wrong antenna-to-IMU transform creates systematic position and yaw errors during turns.
- **Clock and time-sync mistakes:** GNSS clock, camera/LiDAR timestamps, and IMU integration can disagree in ways that look like motion errors.
- **Weak local odometry:** Visual low texture, glare, motion blur, LiDAR degeneracy, or dynamic objects can leave GNSS factors underconstrained or over-dominant.
- **Poor satellite geometry:** Low satellite count or bad DOP can make pseudorange factors weak along important axes.
- **Reacquisition jumps:** GNSS returning after an outage can produce discontinuities if factors are accepted without innovation checks.
- **Bad robust-loss tuning:** Too permissive and multipath corrupts the graph; too strict and useful GNSS is ignored.

## AV Relevance

Raw GNSS factor fusion is relevant because AV localization usually needs both local smoothness and global accountability. Visual, LiDAR, wheel, and IMU constraints provide local continuity; GNSS provides a global frame when valid. A factor graph can keep those responsibilities separate instead of hiding them inside one fused pose.

For production AVs, this page should be read as a pattern:

- Insert raw GNSS only after quality checks, innovation gates, and multipath-aware weighting.
- Keep local odometry and GNSS residual streams separately observable in logs.
- Use GNSS factors as one source among LiDAR map matching, wheel odometry, IMU propagation, visual odometry, and surveyed map priors.
- Define behavior for GNSS denial, partial satellites, reacquisition, and spoofing/interference.
- Validate graph jumps before allowing globally corrected pose into planning or control.

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV | Strong research fit | Useful in urban canyons and mapped ODDs, but must handle buildings, bridges, trees, and high-speed lever-arm effects. |
| Airside AV | Strong research fit | Open sky helps, but terminals, aircraft, jet bridges, wet pavement, and service vehicles create multipath and occlusion. |
| Port and logistics yard | Strong research fit | Containers and cranes create severe multipath; LiDAR/wheel/IMU factors are important companions. |
| Mining and construction | Medium to strong | Open-sky transitions benefit from GNSS; dust, vibration, slopes, and occlusion require robust local odometry. |
| Warehouse and indoor | Weak as GNSS | The factor pattern transfers, but GNSS factors are unavailable indoors; use UWB, fiducials, WiFi, wheel, or map factors instead. |
| Outdoor campus and delivery robot | Medium to strong | Useful for tree/building occlusion and stop-start routes where local odometry drift still matters. |
| Agriculture | Medium to strong | Open sky and repeated rows make GNSS valuable, but vegetation, slopes, and long smooth motion need wheel/IMU support. |

## Implementation Notes

- Start by logging raw observables, satellite IDs, elevation/azimuth, C/N0, ephemeris source, receiver clock state, and correction age.
- Calibrate the GNSS antenna lever arm in the same vehicle frame used by IMU, LiDAR, and camera factors.
- Keep receiver position fixes as diagnostics; do not treat them as the only GNSS information if raw factors are available.
- Use robust kernels and per-satellite weighting based on elevation, signal quality, and innovation history.
- Separate local odometry factors from global factors in telemetry so GNSS corruption is visible.
- Test GNSS outage and reacquisition explicitly; the dangerous case is not losing GNSS, but accepting it again too aggressively.
- Compare against loose GPS/RTK position-factor baselines before claiming the raw-factor graph is worth the integration complexity.

## Validation Checklist

- Replay routes with raw GNSS enabled, GNSS disabled, and GNSS delayed/reintroduced.
- Report ATE/RPE, map-frame error, heading error, and drift before and after GNSS updates.
- Plot pseudorange and Doppler residuals by satellite, elevation, azimuth, and C/N0.
- Check innovation gates under terminals, bridges, hangars, containers, aircraft, wet pavement, and tree cover.
- Validate lever-arm sensitivity with turns, braking, slopes, and antenna relocation perturbations.
- Confirm graph corrections do not create planner-facing pose jumps without a transition policy.
- Compare against LIO-SAM/VINS-Fusion-style loose GPS factors and against a receiver-only RTK solution.
- Test spoofing/interference indicators and receiver fix-state transitions.

## Relation to Existing Corpus

- [VINS-Fusion](vins-mono-vins-fusion.md) covers visual-inertial estimation and global GPS fusion at a broader system level.
- [LIO-SAM](lio-sam.md) covers LiDAR, IMU, GPS, and loop factors with GPS usually treated as a position-style factor.
- [Robust multi-sensor localization](../overview/robust-state-estimation-multi-sensor.md) covers gating, covariance, fallback, and estimator health.
- [GNSS and RTK error models](../../../10-knowledge-base/state-estimation/gnss-rtk-error-models.md) covers pseudorange, carrier phase, Doppler, RTK states, and multipath physics.
- [GV-iRIOM](gv-iriom-4d-radar.md) covers globally referenced radar/visual/GNSS mapping, while this page focuses on raw GNSS factors with visual or LiDAR inertial odometry.

## Sources

- Cao, Lu, Cao, Shen, and Shen, "GVINS: Tightly Coupled GNSS-Visual-Inertial Fusion for Smooth and Consistent State Estimation," arXiv, 2021: https://arxiv.org/abs/2103.07899
- GVINS HKUST record: https://repository.hkust.edu.hk/ir/Record/1783.1-115906
- GVINS official repository: https://github.com/HKUST-Aerial-Robotics/GVINS
- GVINS dataset repository: https://github.com/HKUST-Aerial-Robotics/GVINS-Dataset
- Liu et al., "GLIO: Tightly-coupled GNSS/LiDAR/IMU Integration for Continuous and Drift-free State Estimation of Intelligent Vehicles in Urban Areas," IEEE Transactions on Intelligent Vehicles, 2023: https://ieeexplore.ieee.org/document/10285475
- GLIO PolyU publication record: https://research.polyu.edu.hk/en/publications/glio-tightly-coupled-gnsslidarimu-integration-for-continuous-and-/
- GLIO author project page: https://xikunliu-huskit.github.io/publication/2023-09-GLIO
- GLIO official repository: https://github.com/XikunLiu-huskit/GLIO
