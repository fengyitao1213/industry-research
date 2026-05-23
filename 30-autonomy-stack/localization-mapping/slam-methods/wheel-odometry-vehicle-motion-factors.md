# Wheel Odometry and Vehicle Motion Factors

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method-family"
  stage: "deployment-pattern"
  maturity: "fielded-pattern"
  tags: ["slam", "runtime-localization", "outdoor", "fallback"]
  reason: "Wheel and vehicle-motion factors support ground-vehicle localization with short-term motion constraints and slip-aware fallback behavior."
method-priority:end -->

Related docs: [wheel odometry and encoder models](../../../10-knowledge-base/state-estimation/wheel-odometry-encoder-models.md), [GTSAM factor graphs](../../../10-knowledge-base/state-estimation/gtsam-factor-graphs.md), [multi-sensor fusion measurement models](../../../10-knowledge-base/state-estimation/multi-sensor-fusion-measurement-models-first-principles.md), [VINS-Mono / VINS-Fusion](vins-mono-vins-fusion.md), [LIO-SAM](lio-sam.md), [Semantic-LiDAR-Inertial-Wheel Odometry](semantic-liw-odometry.md), [CM-LIUW-Odometry](cm-liuw-odometry.md), and [robust multi-sensor localization](../overview/robust-state-estimation-multi-sensor.md).

**Last updated:** 2026-05-23

## Executive Summary

Wheel odometry is not only a dead-reckoning topic. In ground-vehicle SLAM and localization stacks it becomes a family of motion factors: relative pose factors, velocity factors, preintegrated wheel factors, nonholonomic constraints, planar-motion constraints, and online vehicle-kinematic calibration terms. These factors can stabilize visual, LiDAR, radar, IMU, GNSS, UWB, and map-matching estimators when external geometry is weak or intermittently unavailable.

The useful distinction is responsibility. The [wheel odometry primer](../../../10-knowledge-base/state-estimation/wheel-odometry-encoder-models.md) explains encoder math, covariance, calibration, and slip indicators. This page covers how those measurements enter SLAM and localization graphs without being over-trusted. The main operational lesson from VINS-on-Wheels, VIWO, skid-steer LiDAR-IMU-wheel factors, and online neural wheel-kinematic models is that wheel evidence helps only when calibration, observability, slip, time alignment, and vehicle mode are explicit.

For AVs, the family is strongest on low-speed and managed-site platforms: airport GSE, yard tractors, port vehicles, forklifts, indoor AMRs, mining robots, delivery robots, and campus shuttles. It is also useful on road AVs as a short-term cross-check against IMU, GNSS, LiDAR, radar Doppler, and map localization. It should not become a hidden hard prior that bends the trajectory through slip, tire deformation, steering bias, or wrong vehicle-mode assumptions.

## What It Covers

| Pattern | Typical sensors | Core idea | Best use here |
|---|---|---|---|
| Visual-inertial-wheel odometry | Camera, IMU, wheel encoders | Add wheel increments and nonholonomic constraints to VIO so scale, yaw, and ground-plane motion are better conditioned. | Ground vehicles with camera-rich rigs and weak GNSS. |
| Online wheel calibration | Camera or LiDAR, IMU, wheel encoders | Estimate wheel scale, extrinsics, and sometimes time offset while estimating vehicle state. | Vehicles whose tire pressure, load, or sensor mounting changes over time. |
| LiDAR-IMU-wheel factors | LiDAR, IMU, wheel encoders | Use wheel motion constraints to stabilize LiDAR-inertial odometry in corridors, tunnels, open aprons, and weak geometry. | GNSS-denied or degraded geometric scenes. |
| Skid-steer and vehicle-mode factors | LiDAR/visual, IMU, wheel encoders, steering/mode state | Model skid steering, lateral slip, crab steering, reversing, or articulated modes instead of assuming one bicycle model. | Industrial vehicles, tugs, loaders, AMRs, and robots on changing surfaces. |
| Learned/adaptive kinematic factors | LiDAR, IMU, wheel encoders, online learning signal | Adapt wheel-motion residuals to terrain-dependent slip or nonlinear skid-steer behavior inside the estimator. | Research or pilot systems where fixed wheel noise is too brittle. |

## Inputs and Outputs

Inputs:

- Raw or integrated wheel encoder increments with timestamps.
- Steering angle, drive mode, gear, brake, traction, and vehicle-mode state when available.
- IMU angular rate and acceleration for propagation and slip checks.
- Camera, LiDAR, radar, GNSS, UWB, map-matching, or visual landmark residuals from the primary localization stack.
- Calibration parameters: wheel scale, track width, steering scale and bias, wheel-to-IMU/body extrinsics, and sensor time offsets.
- Surface and weather context where available, such as wet apron, painted line, snow, gravel, tunnel floor, or mine mud.

Outputs:

- Relative motion constraints between estimator states.
- Velocity or yaw-rate factors for filters and factor graphs.
- Nonholonomic residuals, such as low lateral body velocity.
- Online estimates or diagnostics for wheel scale, steering bias, extrinsics, and wheel covariance.
- Slip and mode-health diagnostics that can gate wheel factors before they corrupt the state.

## Factor Patterns

A wheel factor should be treated as a measurement with a domain of validity, not as the vehicle truth. Common abstractions are:

```text
r_relative = Log(z_wheel_ij^-1 * (X_i^-1 * X_j))
r_velocity = v_body_measured - R_WB^T * v_world
r_yaw_rate = yaw_rate_gyro - f_wheel_yaw(v, steering, wheelbase)
r_nhc      = [v_body_y, v_body_z]
```

For factor graphs, wheel preintegration is usually a relative motion factor between two states. For filters, wheel odometry is often a velocity or pseudo-measurement update. In both cases the covariance must be allowed to grow under slip, poor time alignment, uncertain steering geometry, or vehicle modes that violate the assumed model.

The dangerous failure mode is an overconfident wheel residual. It can force a visually or geometrically correct trajectory to follow a slipping tire path. Production implementations should expose wheel residuals separately from visual, LiDAR, IMU, GNSS, radar, UWB, and map factors.

## Visual-Inertial-Wheel Lineage

VINS-on-Wheels is a useful early reference because it treats wheel encoder data as a way to improve the observability of monocular visual-inertial estimation on wheeled robots. Later VIWO work adds online calibration of wheel intrinsic and extrinsic parameters, so the estimator can account for wheel scale and frame alignment rather than assuming them fixed.

Recent visual-inertial-wheel variants extend the same pattern with probabilistic filtering, point-line visual features, parking-slot or semantic landmarks, and application-specific constraints. The common value is not that a camera plus wheel encoder becomes production localization by itself. The value is that ground-vehicle motion priors can reduce visual scale ambiguity, smooth short-term ego motion, and create cross-check residuals for estimator health.

Use this family as a bridge between visual SLAM and vehicle state estimation:

- Wheel constraints can improve scale and yaw observability during low-parallax driving.
- Nonholonomic constraints can suppress lateral drift when the vehicle is actually in a standard wheeled mode.
- Online calibration is important because wheel scale and extrinsics change with tires, payload, suspension, and mounting.
- Visual factors remain responsible for scene-relative pose; wheel factors remain responsible for short-term vehicle-motion evidence.

## LiDAR-IMU-Wheel and Skid-Steer Factors

LiDAR-inertial odometry can be weak in long tunnels, corridors, mines, warehouses, open apron regions, and other geometrically degenerate scenes. Wheel factors help by constraining the local motion even when scan matching has poor lateral, yaw, or forward observability.

Skid-steer and industrial platforms make the problem harder. A fixed differential-drive or bicycle model can be wrong during skid turns, lateral movement, tire deformation, payload changes, rough ground, or low-friction surfaces. Full linear wheel odometry factors and online calibration methods address part of this by estimating kinematic parameters and covariance online. Online neural LiDAR-IMU-wheel factor work goes further by learning terrain-dependent nonlinear wheel behavior inside the factor-graph optimization.

That adaptivity is promising, but it raises deployment questions: how the learned factor is bounded, how drift is detected when the learned kinematics are wrong, how training history is logged, and how the estimator fails closed when terrain or tire behavior leaves the training regime.

## Assumptions

- The active vehicle mode is known: Ackermann, differential, skid-steer, crab, reverse, articulated, towing, or another mode.
- Encoder ticks, steering, IMU, camera, LiDAR, radar, GNSS, and UWB timestamps are aligned tightly enough for the target speed.
- Wheel scale, track width, steering bias, and wheel-to-body extrinsics are calibrated or estimated online.
- The nonholonomic constraint is disabled or weakened when lateral motion is physically possible.
- Wheel covariance expands under slip, wheel lift, tire pressure changes, severe braking, rough terrain, and payload changes.
- The estimator can inspect wheel residuals separately from other residual families.

## Failure Modes

| Failure mode | What happens | Mitigation |
|---|---|---|
| Slip accepted as motion | The graph follows wheel spin instead of vehicle motion. | Gate or inflate wheel factors using IMU, LiDAR, radar, GNSS Doppler, traction, and surface residuals. |
| Wrong vehicle mode | Nonholonomic or bicycle constraints fight crab, skid, reverse, or articulated motion. | Log and estimate mode state; switch residual models by mode. |
| Scale or steering bias | Maps bend and turns over- or under-rotate. | Online calibration, holdout paths, and residual checks against IMU yaw and map localization. |
| Time offset | Wheel increments align with the wrong IMU or scan interval. | Hardware timestamps, time-offset estimation, and replay checks from raw ticks. |
| Overconfident covariance | Wheel factors dominate visual, LiDAR, GNSS, or UWB evidence. | Use realistic covariance, robust losses, and per-factor health telemetry. |
| Learned factor drift | Adaptive or neural kinematics learn a local artifact instead of the true vehicle motion. | Bound learned residuals, log model state, compare against fixed-model baselines, and add fail-closed policies. |

## AV Relevance

Wheel and vehicle-motion factors are especially relevant because AV localization is rarely a single-sensor problem. GNSS can be denied or multipath-corrupted; LiDAR can be degenerate on open tarmac or in corridors; cameras can lose texture or be blinded; radar can be sparse or multipath-prone. Wheel constraints provide independent high-rate motion evidence, but only over short windows and only while their assumptions hold.

For a production stack, wheel factors should be used as supporting evidence:

- stabilize short GNSS, visual, or LiDAR outages;
- cross-check IMU yaw and acceleration;
- support LiDAR or radar deskew;
- help map matching converge from a better motion prior;
- improve low-speed docking, reversing, towing, and indoor/outdoor transitions;
- produce slip and calibration diagnostics for runtime assurance.

They should not be used as a hidden override of map, GNSS, LiDAR, visual, or safety-monitor evidence.

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV | Strong support factor | Useful for short-term ego motion and cross-checking, but high speed, tire dynamics, ABS/ESC intervention, and GNSS/map fusion still dominate deployment behavior. |
| Airside AV | Strong support factor | Very relevant for low-speed GSE, docking, towing, terminal-edge GNSS multipath, wet painted markings, and open-apron LiDAR degeneracy. |
| Warehouse / AMR | Strong | Wheel constraints and nonholonomic models are core, but floor slip, pallet loads, and tight turns must be modeled. |
| Port / logistics yard | Strong | Helps with low-speed tractors and container-yard GNSS multipath; must handle loads, dust, tire deformation, and repeated structure. |
| Mining / tunnel | Strong | Supports GPS-denied, feature-poor corridors; must be paired with LiDAR, UWB, radar, or map constraints and aggressive slip detection. |
| Construction / agriculture | Conditional | Valuable on rough terrain, but wheel-ground interaction is highly variable and may need adaptive or learned kinematic factors. |
| Delivery robot / campus | Medium to strong | Useful for low-speed sidewalk and campus robots; curbs, wet surfaces, grass, and small wheels can make slip frequent. |

## Implementation Notes

- Keep raw encoder counts and integrated wheel messages; replay should regenerate factors from raw ticks.
- Log the active vehicle mode with each wheel residual.
- Do not publish zero covariance unless the consumer explicitly treats it as unknown.
- Compare wheel speed against IMU acceleration, IMU yaw rate, GNSS Doppler, radar ego velocity, and LiDAR/map odometry.
- Estimate or validate wheel-to-IMU extrinsics, wheel scale, steering bias, and encoder latency before using tight wheel factors.
- Use robust losses and factor gating for wheel residuals, but make gating decisions observable in telemetry.
- Separate "wheel odometry helped local smoothness" from "wheel odometry provided global localization"; it normally does only the first.

## Validation Checklist

- Run replay with wheel factors enabled, disabled, delayed, and covariance-inflated.
- Test straight, turning, reversing, docking, towing, crab, skid, and stop-start modes separately.
- Perturb wheel radius, track width, steering bias, and time offset to measure estimator sensitivity.
- Include low-friction surfaces: wet paint, standing water, snow, gravel, rubber dust, mud, and loose material.
- Plot wheel residuals against IMU yaw, GNSS Doppler, radar ego velocity, and LiDAR/map residuals.
- Check whether wheel constraints mask failures in visual, LiDAR, GNSS, radar, or UWB evidence.
- Validate that planner-facing pose does not jump when wheel factors are rejected or reintroduced.
- For learned/adaptive factors, compare against fixed wheel models and record model-state changes during replay.

## Relation to Existing Corpus

- [Wheel odometry and encoder models](../../../10-knowledge-base/state-estimation/wheel-odometry-encoder-models.md) covers the underlying encoder equations, calibration, covariance, and slip signals.
- [Semantic-LiDAR-Inertial-Wheel Odometry](semantic-liw-odometry.md) covers a semantic-map LiDAR-IMU-wheel deployment pattern for large dynamic port environments.
- [CM-LIUW-Odometry](cm-liuw-odometry.md) covers a UWB/LiDAR/IMU/wheel system for coal-mine tunnels.
- [GVINS and GLIO raw GNSS factor fusion](gvins-glio-gnss-raw-factor-fusion.md) covers raw GNSS pseudorange and Doppler factors, not wheel or vehicle-motion factors.
- [Robust multi-sensor localization](../overview/robust-state-estimation-multi-sensor.md) covers estimator gating, covariance, fallback, and runtime health at system level.

## Sources

- Wu, Guo, Georgiou, and Roumeliotis, "VINS on Wheels," ICRA 2017: https://mars.cs.umn.edu/papers/KejianWu_VINSonWheels.pdf
- Lee, Eckenhoff, Yang, Geneva, and Huang, "Visual-Inertial-Wheel Odometry with Online Calibration," IROS 2020: https://woosiklee.com/downloads/papers/Lee2020IROS.pdf
- PIEKF-VIWO paper: https://arxiv.org/abs/2303.07668
- PL-VIWO paper: https://arxiv.org/abs/2503.00551
- PL-VIWO official repository: https://github.com/Happy-ZZX/PL-VIWO
- PL-VIWO2 paper: https://arxiv.org/abs/2509.21563
- Okawara et al., "Tightly-Coupled LiDAR-IMU-Wheel Odometry with Online Calibration of a Kinematic Model for Skid-Steering Robots": https://arxiv.org/abs/2404.02515
- Full linear wheel odometry factor repository: https://github.com/TakuOkawara/full_linear_wheel_odometry_factor
- Okawara et al., "Tightly-Coupled LiDAR-IMU-Wheel Odometry with an Online Neural Kinematic Model Learning via Factor Graph Optimization": https://arxiv.org/abs/2407.08907
- VIPS-Odom paper: https://arxiv.org/abs/2407.05017
