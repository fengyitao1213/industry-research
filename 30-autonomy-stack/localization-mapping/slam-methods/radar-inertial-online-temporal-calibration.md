# Radar-Inertial Online Temporal and Spatio-Temporal Calibration

<!-- method-priority:start
priority:
  learning: 3
  deployment: 4
  type: "method"
  stage: "deployment-pattern"
  maturity: "prototype"
  tags: ["slam", "fallback", "gnss-denied", "outdoor", "adverse-weather"]
  reason: "Radar-Inertial online calibration is rated for radar fusion hardening when timing or extrinsics can silently bias localization."
method-priority:end -->

Related docs: [radar-inertial odometry](radar-inertial-odometry.md), [4D imaging radar RIO and SLAM](4d-imaging-radar-rio-slam.md), [GV-iRIOM 4D radar visual GNSS mapping](gv-iriom-4d-radar.md), [radar-LiDAR-inertial fusion](radar-lidar-inertial-fusion.md), [sensor calibration and time synchronization](../../../10-knowledge-base/geometry-3d/sensor-calibration-time-synchronization.md), and [robust multi-sensor localization](../overview/robust-state-estimation-multi-sensor.md).

**Last updated:** 2026-05-23

## Executive Summary

Radar-inertial odometry is unusually sensitive to time alignment because radar Doppler measures velocity at the radar measurement time while the IMU propagates a high-rate trajectory. A few tens of milliseconds of radar-IMU offset can turn into biased velocity and pose updates during turns, acceleration, braking, and vibration.

Three recent lines are useful. EKF-RIO-TC estimates the radar-IMU time offset online inside an EKF radar-inertial odometry framework. RIO-T estimates a temporal offset state in a factor graph with IMU and radar ego-velocity factors. LC-RIO-ET extends the hardening pattern to joint online extrinsic and temporal calibration with continuous-time IMU modeling.

The production lesson is broader than timestamps: hardware triggering helps, but it does not prove that radar measurements, IMU states, and radar-IMU extrinsics are mutually consistent. Online calibration should be treated as a monitored health and estimation function, not only an offline setup step.

## What It Adds

- Treats temporal offset as an estimated state, not a fixed assumption.
- Treats radar-IMU extrinsics as estimated or monitored states when the method supports spatio-temporal calibration.
- Uses radar ego-velocity from a single scan as the measurement affected by time offset.
- Aligns radar and IMU updates to a common time stream.
- Uses continuous-time inertial models in LC-RIO-ET so radar factors can query acceleration and angular velocity at arbitrary measurement times.
- Demonstrates that online temporal calibration can reduce odometry error even without radar scan matching or target tracking.
- Provides public code for EKF-RIO-TC; LC-RIO-ET has a public project/repository shell, but the repository states code will be released after review.

## Sensor and Factor Model

Sensor suite:

- Doppler-capable radar or 4D radar.
- IMU.
- Optional ground truth for calibration validation.

EKF-style abstraction:

```text
x = [R, p, v, b_g, b_a, delta_t_RI]
z_radar_velocity(t_r) = h(x(t_r + delta_t_RI)) + noise
```

Temporal factor-graph abstraction:

```text
X* = arg min_X
      sum || r_imu ||^2
    + sum || r_radar_velocity(delta_t_RI) ||^2
    + sum || r_constant_time_offset ||^2
```

Spatio-temporal factor-graph abstraction:

```text
X* = arg min_X
      sum || r_imu ||^2
    + sum rho(|| r_radar_velocity(T_RI, delta_t_RI) ||^2)
    + sum || r_constant_time_offset ||^2
    + sum || r_constant_extrinsic ||^2
```

RIO-T adjusts the radar ego-velocity factor using recent IMU acceleration after bias and gravity correction, assuming locally constant acceleration around the relevant interval. LC-RIO-ET instead fits uniform cubic B-splines to raw acceleration and angular velocity over a sliding window, then evaluates the inertial signal at radar measurement times so temporal and extrinsic parameters can be optimized together.

## Observability and Motion Requirements

Temporal offset is easiest to observe when motion changes quickly:

- acceleration and braking,
- turns and yaw-rate changes,
- vibration or aggressive platform motion,
- radar velocity discrepancy that changes with offset.

Smooth constant-velocity motion can make the offset weakly observable. Calibration validation should therefore include intentional excitation rather than only straight, slow driving.

Spatial extrinsics add more observability requirements:

- yaw and lateral velocity excitation for radar mounting yaw,
- pitch/roll and vertical motion where the radar provides useful elevation structure,
- enough static radar returns across varied azimuth/elevation angles,
- repeated maneuvers that separate time delay from lever-arm error.

If the vehicle only drives slowly and straight, an online estimator can appear stable while converging to a biased offset or extrinsic.

## Dynamic and Degraded Scenes

Temporal calibration does not solve radar outliers. It should be combined with:

- static-return selection for Doppler ego-velocity,
- dynamic-object rejection,
- multipath gating,
- radar health metrics,
- IMU saturation checks.

The benefit is strongest in adverse weather or GNSS-denied environments where radar-inertial odometry becomes a primary fallback and time misalignment cannot be hidden by stronger LiDAR/camera/map factors.

## Evaluation Guidance

Track:

- ATE/RPE with and without estimated time offset.
- Estimated offset convergence time.
- Sensitivity to injected artificial delays.
- Velocity RMSE during acceleration and turning.
- Radar ego-velocity residual before and after compensation.
- Robustness under hardware triggering, software timestamping, and replayed bags.

EKF-RIO-TC reports evaluation on simulated and real-world datasets, including a self-collected seven-sequence radar/IMU dataset with OptiTrack ground truth, plus ICINS2021 and ColoRadar. RIO-T reports real-world radar/IMU experiments focused on temporal delay impact. LC-RIO-ET reports comparisons on the EKF-RIO-TC and ICINS datasets, with the strongest gains on unsynchronized sequences where joint extrinsic and temporal calibration can correct downstream radar-inertial estimators.

## Integration Readiness

The EKF-RIO-TC implementation is public and directly useful for radar-IMU timing studies. LC-RIO-ET is currently better treated as primary-source method evidence because its GitHub repository says the implementation will be released after review.

For production stacks, temporal and extrinsic calibration should be one part of a larger synchronization strategy: PTP/PPS where possible, driver timestamp audits, bag replay tests, temperature and boot-cycle checks, calibration-bay replay, and runtime alarms if estimated offsets or extrinsics move outside calibrated bounds.

## Limitations

- Online offset estimation needs excitation.
- A constant time offset model may be insufficient for variable driver latency or clock drift.
- Time calibration cannot compensate bad radar extrinsics.
- Joint temporal/extrinsic estimation can converge to plausible but wrong parameters under weak motion excitation.
- Radar ego-velocity still assumes enough static returns.
- Factor-graph or EKF tuning can overfit one radar model or motion profile.
- A public repository shell is not the same as reusable code; check release status before planning implementation work around LC-RIO-ET.

## Sources

- EKF-RIO-TC arXiv paper: https://arxiv.org/abs/2502.00661
- EKF-RIO-TC repository: https://github.com/spearwin/EKF-RIO-TC
- RIO-T project page: https://rio-online-t.github.io/
- RIO-T paper PDF: https://lamor.fer.hr/images/50050805/Impact_of_Temporal_Delay_on_Radar_Inertial_Odometry.pdf
- LC-RIO-ET project page: https://unizgfer-lamor.github.io/lc-rio-et/
- LC-RIO-ET arXiv paper: https://arxiv.org/abs/2603.19958
- LC-RIO-ET repository shell: https://github.com/StironjaVlaho/LC-RIO-ET
- Classic camera-IMU online temporal calibration context: https://journals.sagepub.com/doi/pdf/10.1177/0278364913515286
