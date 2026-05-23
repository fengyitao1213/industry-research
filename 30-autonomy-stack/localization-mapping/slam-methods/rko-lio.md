# RKO-LIO

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "modern-core"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "runtime-localization", "outdoor"]
  reason: "RKO-LIO is rated for LiDAR-inertial odometry coverage because it targets one robust configuration across varied LiDAR sensors and robot platforms."
method-priority:end -->

Related docs: [FAST-LIO2](fast-lio-fast-lio2.md), [KISS-ICP](kiss-icp.md), [KISS-SLAM](kiss-slam.md), [GLIM](glim.md), [MA-LIO](ma-lio.md), [continuous-time registration](continuous-time-registration.md), [GEODE Degenerate LiDAR Benchmark](geode-degenerate-lidar-benchmark.md), and [robust state estimation](../overview/robust-state-estimation-multi-sensor.md).

**Last updated:** 2026-05-23

## Executive Summary

RKO-LIO is a PRBonn LiDAR-inertial odometry system designed to avoid sensor-specific LiDAR modeling and manufacturer-specific IMU tuning. The 2025 arXiv paper, revised in April 2026, and the IEEE RA-L 2026 project documentation frame it as one odometry configuration tested across different LiDAR types, robot platforms, and environments.

The method sits between very practical LiDAR-only baselines such as [KISS-ICP](kiss-icp.md) and tightly coupled LIO systems such as [FAST-LIO2](fast-lio-fast-lio2.md), [LIO-SAM](lio-sam.md), and [GLIM](glim.md). Its main value for AV research is not a new sensor suite. It is a deployability pattern: use a simplified IMU motion model, scan-to-map LiDAR registration, and regularization so the same odometry package can be tried on spinning, solid-state, and non-repetitive LiDAR platforms with limited configuration changes.

## What It Adds

| Element | RKO-LIO pattern | Review question |
|---|---|---|
| Sensor-agnostic LiDAR front end | Direct scan-to-map registration rather than a feature extractor tuned to one scan pattern | Does the target LiDAR provide enough timestamped geometry for stable local registration? |
| Simplified IMU use | Accelerometer and gyroscope readings are used without requiring detailed manufacturer noise sheets | Are the IMU timestamps, gravity alignment, and extrinsics still verified independently? |
| Registration regularization | LiDAR registration is regularized to improve odometry robustness across platforms | Does the regularizer hide degeneracy or expose it through residual diagnostics? |
| Minimal configuration | Required setup emphasizes LiDAR-IMU-base extrinsics and topic/frame configuration | Are transform conventions, body frames, and data-loader inference logged in release artifacts? |
| Practical packaging | ROS 2 package plus Python/offline workflow | Can the same config be replayed, compared, and pinned for CI/regression tests? |

## Inputs, Outputs, and Assumptions

Inputs:

- Timestamped LiDAR point clouds.
- IMU accelerometer and gyroscope measurements.
- LiDAR-to-base and IMU-to-base extrinsics.
- ROS topics, TF tree, or an explicit configuration file.

Outputs:

- High-rate odometry pose stream.
- Local scan-to-map alignment state.
- Optional visualization and replay outputs in the reference tooling.

Assumptions:

- The LiDAR sees enough static geometry for scan-to-map alignment.
- LiDAR and IMU timestamps are meaningful even if the method does not require detailed sensor-specific models.
- Extrinsics are correct and use the same transform convention as the package.
- Dynamic objects, dust, spray, reflections, and moving workers are filtered or down-weighted outside the core odometry assumption.
- Global localization, loop closure, map versioning, and safety-case evidence are handled by companion modules.

## Architecture

RKO-LIO follows a compact odometry loop:

```text
LiDAR scan + IMU stream
        |
        v
simplified IMU motion model
        |
        v
motion-compensated scan-to-map registration
        |
        v
regularized pose update
        |
        v
odometry output + local map update
```

The important architectural choice is that the LiDAR side is not tied to one ordered range image, ring layout, or feature-extraction recipe. That makes RKO-LIO a useful comparison point for AV stacks that mix roof, side, bumper, spinning, solid-state, or newer FMCW-style LiDARs over time.

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV | Strong as an odometry baseline | Useful when sensor suites change across prototypes; still needs HD-map localization, GNSS/INS, and dynamic-object rejection. |
| Warehouse and factory AMR | Strong for 3D LiDAR platforms | Gives a practical fallback where 2D SLAM is too planar; rack repetition and reflective wraps require loop/relocalization checks. |
| Yard, port, mining, construction | Strong prototype fit | Outdoor geometry, dust, vibration, grade changes, and changing assets should be evaluated against FAST-LIO2, GLIM, and KISS-ICP. |
| Airside AV | Conditional but relevant | Can support survey and fallback odometry, but open aprons, aircraft reflections, jet-blast artifacts, and long low-feature taxiways need degeneracy gates. |
| Delivery robot and campus | Conditional | Works if the platform has suitable 3D LiDAR and IMU; low-cost sensors may make wheel/visual/GNSS factors more practical. |

## Failure Modes

| Failure mode | How it appears | Mitigation |
|---|---|---|
| Weak or repeated geometry | Smooth drift in corridors, open aprons, road lanes, or repeated racks | Add place recognition, map priors, GEODE-style degeneracy tests, and covariance inflation. |
| Bad extrinsics | Consistent scan residual bias, curved structures, or IMU disagreement | Version LiDAR/IMU/base transforms and replay calibration bags before release. |
| Timestamp or frame convention error | Pose lag, scan shear, or inverted transforms | Log topic timestamps, TF source, transform convention, and config snapshot. |
| Dynamic clutter | Odometry follows vehicles, workers, aircraft servicing equipment, or pallets | Filter dynamic objects and compare with map-cleaning/MOS evidence. |
| Adverse-weather artifacts | Dust, spray, rain, snow, or multipath creates false registration support | Gate by weather/artifact detectors and compare radar/GNSS/wheel fallback factors. |
| Local-only drift | Odometry remains smooth but map/global pose diverges | Combine with loop closure, GNSS/raw factors, surveyed landmarks, or map localization. |

## Evaluation Guidance

Use RKO-LIO as a baseline when the review question is "can one LIO configuration generalize across sensors?" rather than "can this solve the whole localization stack?"

Track:

- ATE/RPE by platform and LiDAR type.
- Drift per distance and per time in weak-geometry sequences.
- Residual distributions before and after regularization.
- Failure labels for dynamic scenes, weather artifacts, and timestamp faults.
- Runtime and memory on the target compute.
- Sensitivity to extrinsic perturbation and IMU quality.
- Replay reproducibility with pinned package version, bag, config, and TF tree.

Compare against:

- [KISS-ICP](kiss-icp.md) as a LiDAR-only registration baseline.
- [FAST-LIO2](fast-lio-fast-lio2.md) and [Point-LIO](point-lio.md) as mature real-time LIO baselines.
- [GLIM](glim.md) and [MOLA](mola.md) as modular mapping/localization stacks.
- [MA-LIO](ma-lio.md) when the platform has multiple asynchronous LiDARs.
- [GVINS/GLIO raw GNSS factor fusion](gvins-glio-gnss-raw-factor-fusion.md), [wheel odometry and vehicle-motion factors](wheel-odometry-vehicle-motion-factors.md), and [radar localization](radar-to-lidar-map-localization.md) for global anchoring or degraded sensing.

## Integration Readiness

The official repository is MIT-licensed and provides a ROS 2 package plus a Python/offline workflow. ROS documentation lists Humble, Jazzy, Kilted, and Rolling support, and the quickstart shows both package installation and source-build paths. That makes RKO-LIO more integration-friendly than many single-paper LIO repos.

Production use still needs:

- ROS 2 launch and parameter pinning for each vehicle build.
- TF and extrinsic artifact review.
- Deterministic bag replay in CI.
- Runtime health metrics for registration residuals, IMU consistency, dropped packets, and odometry jumps.
- Map/localization handoff rules so local odometry does not silently become the global truth.
- License, dependency, and package-version review before embedding in product builds.

## Boundaries

RKO-LIO is an odometry method, not a complete production localization architecture. It does not replace loop closure, relocalization, map lifecycle, surveyed infrastructure aids, raw GNSS factors, wheel slip checks, safety monitors, or fleet evidence packages.

It is most useful as a robust, practical LIO baseline for comparing sensor suites and deployment assumptions. If the stack needs continuous-time multi-sensor modeling, use [CLIC and Coco-LIC](clic-coco-lic.md) or continuous-time trajectory foundations. If the stack needs multi-LiDAR asynchronous uncertainty, use [MA-LIO](ma-lio.md) as the closer reference.

## Sources

- RKO-LIO arXiv paper: https://arxiv.org/abs/2509.06593
- RKO-LIO official project docs: https://prbonn.github.io/rko_lio/
- RKO-LIO repository: https://github.com/PRBonn/rko_lio
- RKO-LIO ROS docs: https://docs.ros.org/en/jazzy/p/rko_lio/
- RKO-LIO quickstart: https://docs.ros.org/en/jazzy/p/rko_lio/pages/quickstart.html
