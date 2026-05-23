# Rolling Shutter, LiDAR Deskew, and Motion Distortion

<!-- kb-visual:start -->
![Rolling Shutter, LiDAR Deskew, and Motion Distortion curated visual](../_assets/visuals/geometry-3d-rolling-shutter-lidar-deskew-motion-distortion.svg)

*Visual: time-sweep diagram showing camera rows and LiDAR points captured at different poses, ego-motion interpolation, deskew transform, and object-motion caveat.*
<!-- kb-visual:end -->

Motion distortion happens when a sensor frame is treated as instantaneous even
though its samples were acquired over time. A rolling-shutter image is not one
camera pose; each row has a different exposure time. A spinning or scanning
LiDAR cloud is not one LiDAR pose; each point has a different firing time.

Deskewing is the act of transforming each sample from its acquisition pose into
a common reference time. It is simple in concept and easy to get subtly wrong:
the output quality depends on timestamp truth, motion interpolation, frame
conventions, extrinsics, and the difference between ego-motion and independently
moving objects. In aggregated-map pipelines — where dozens of scans are
accumulated before segmentation — uncorrected distortion compounds into
structural artifacts (double walls, smeared curbs, ghost poles) that no
downstream model can undo.

---

## 1. Related Docs

- [Continuous-Time Trajectory Splines and Gaussian Process Priors](../state-estimation/continuous-time-trajectory-splines-gp-priors.md)
- [Sensor Calibration and Time Synchronization Fundamentals](sensor-calibration-time-synchronization.md) — deskew depends on calibrated extrinsics and synced clocks
- [LiDAR Working Principles and Noise Models](lidar-working-principles-noise-models.md) — sensor sweep timing and per-point timestamp formats
- [Point Cloud Registration Math: ICP, NDT, and GICP](point-cloud-registration-math-icp-ndt-gicp.md) — deskew is a prerequisite for registration; CT-ICP integrates them jointly
- [Lie Groups SE(3), SO(3), Adjoints, and Jacobians](lie-groups-se3-so3-jacobians.md) — SE(3) interpolation math underlying the correction formula
- [Coordinate Frames, Projections, and SE(3)](coordinate-frames-projections-se3.md)
- [IMU Error Models and Preintegration](../state-estimation/imu-error-models-preintegration.md)
- [Time Synchronization Error Budgets](../systems-engineering/time-synchronization-error-budgets.md)
- [Aggregated-Map Semantic Segmentation](../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md) — §9.2 conditioning; deskewed scans are the direct input to the segmentation pipeline

---

## 2. Why It Matters

### 2.1 The 50 cm Rule

A 10 Hz spinning LiDAR (e.g., Velodyne HDL-64E, Ouster OS1) takes **100 ms**
to complete one full 360° revolution; a 20 Hz sensor takes 50 ms. During that
window the ego-platform moves continuously. The platform is not static between
the first fired beam and the last.

| Speed | Sweep (10 Hz) | Sweep (20 Hz) | Smear (10 Hz) | Smear (20 Hz) |
|---|---|---|---|---|
| 1.4 m/s (5 km/h) — pedestrian | 100 ms | 50 ms | 14 cm | 7 cm |
| 2.8 m/s (10 km/h) — GSE slow | 100 ms | 50 ms | **28 cm** | 14 cm |
| 5.6 m/s (20 km/h) — aircraft tow | 100 ms | 50 ms | **56 cm** | 28 cm |
| 8.3 m/s (30 km/h) — airside service | 100 ms | 50 ms | **83 cm** | 42 cm |
| 27.8 m/s (100 km/h) — highway AV | 100 ms | 50 ms | 278 cm | 139 cm |

At **airside taxi speeds** (10–30 km/h ≈ 2.8–8.3 m/s), a 10 Hz LiDAR produces
28–83 cm of positional smear across a single sweep. Without correction, a
painted taxiway centreline appears as a curved or smeared stripe; a curb appears
doubled. ILS hold-short lines and runway designators are 15–30 cm wide — at
56 cm translational smear (20 km/h, 10 Hz), these features wash into background
pavement and become undetectable by any segmentation model.

### 2.2 Rotational Smear at Airside Turn Rates

Yaw motion during a turn adds azimuthal shear independent of forward speed:

```text
smear_rotation ≈ omega_yaw * T_sweep * range_m

omega_yaw in rad/s, T_sweep in seconds
```

| Scenario | Yaw rate | T_sweep | Range | Smear |
|---|---|---|---|---|
| Gentle taxiway turn | 5 °/s = 0.087 rad/s | 100 ms | 20 m | **17 cm** |
| Normal turn, GSE | 15 °/s = 0.26 rad/s | 100 ms | 20 m | **52 cm** |
| Tight pushback tug | 30 °/s = 0.52 rad/s | 100 ms | 20 m | **104 cm** |

Rotation-induced distortion dominates at close range and high turn rates — both
common during docking, gate approach, and tight airside manoeuvres.

### 2.3 Cascade Into the Map Pipeline

A scan fed into ICP or NDT registration is matched as a rigid body. A sheared
scan violates the rigid-body assumption; the optimizer finds a compromise
transformation that minimises residuals across the distorted body — but no
single rigid pose can fit a deformed cloud. Registration error compounds
scan-over-scan. In aggregated maps (multi-scan accumulation used for semantic
segmentation), undeskewed scans produce:

- **Double walls** — each scan contributes two offset copies of planar surfaces
- **Smeared curbs** — 5–10 cm curb edge spreads into road surface, becoming
  invisible
- **Ghost poles** — vertical features appear duplicated or elongated
- **Blurred lane markings** — signal spread over multiple voxels, below
  segmentation threshold

Segmentation models cannot recover signal that is spread across multiple voxels;
deskew must happen before registration, which must happen before aggregation,
which must happen before segmentation. The ordering is strict and
non-negotiable. See §9 for the complete pipeline chain.

| Pipeline stage | Distortion impact |
|---|---|
| feature extraction | edges and planes are selected from bent geometry |
| scan-to-scan odometry | one rigid transform cannot align a distorted scan |
| scan-to-map matching | residuals become structured with azimuth and time |
| loop closure | historical maps contain scan-shape artifacts |
| TSDF/occupancy mapping | surfaces thicken; dynamic actors leave ghosts |
| aggregated-map segmentation | planes appear warped; markings smear below voxel threshold |
| camera-LiDAR fusion | projected points shift by row/point timestamp mismatch |

---

## 3. One Principle

Every measurement belongs at its acquisition time:

```text
z_i was measured at t_i
```

If the platform pose is `T_WB(t)` and the sensor extrinsic is `T_BS`, a point
measured in sensor coordinates at time `t_i` is:

```text
p_W(t_i) = T_WB(t_i) * T_BS * p_Si
```

To express the point in a reference sensor frame at time `t_ref`:

```text
p_Sref = T_SB * T_BW(t_ref) * T_WB(t_i) * T_BS * p_Si
```

That is deskewing. Everything else is how to estimate `T_WB(t_i)` accurately
enough.

### 3.1 The Rolling-Shutter-of-LiDAR Model

The analogy to a rolling-shutter camera is precise: both sample different
spatial positions at different times, then package the results as a single
"frame." A spinning LiDAR fires each channel laser sequentially as the head
rotates. For a 16-channel Velodyne VLP-16, each firing cycle is **2.304 µs**
and the full 360° sweep takes ~55,296 µs (≈ 55 ms). Every fired point has a
distinct **per-point timestamp** `t_i` within the sweep interval
`[t_start, t_end]`.

Each point `p_i` (in LiDAR sensor frame) was captured when the sensor was at
ego-pose `T_world_ego(t_i)`, not at the nominal scan-end pose
`T_world_ego(t_end)`. If the sweep is assembled without correction, every point
is implicitly placed in the `t_end` frame — but early-sweep points belong to an
earlier, different frame.

**Correct model:** To bring all points into a common reference frame
(conventionally `t_end`, the scan-end time):

```text
p_corrected = T_world_ego(t_end)^{-1} · T_world_ego(t_i) · p_raw
```

Where:
- `p_raw` is the 3D point in sensor frame at acquisition time `t_i`
- `T_world_ego(t_i)` is the 4×4 SE(3) ego pose at time `t_i`
- `T_world_ego(t_end)^{-1}` is the inverse of the scan-end pose

The composition `T_world_ego(t_end)^{-1} · T_world_ego(t_i)` is the relative
transform from `t_end` back to `t_i`. Applying it to `p_raw` moves the point
into the `t_end` ego-frame as if the sensor had been at `t_end` when firing it.
After this correction, all points live in a consistent `t_end` frame and the
cloud can be treated as a rigid snapshot.

### 3.2 Per-Point Timestamp Sources

Not all LiDAR configurations expose per-point timestamps by default. Using
approximate timestamps reconstructed from azimuth angle degrades deskew quality.

| Sensor family | Timestamp field | Precision | Notes |
|---|---|---|---|
| Ouster OS-series | 64-bit ns per column | 10 ns (with PTP) | Column = one azimuth step firing all channels; per-point time = column_ts + channel offset |
| Velodyne VLP-16 / HDL-64E | 2-byte firing offset per data block | ~1 µs | Full per-point ts from block header + firing offset table |
| Livox (all models) | 32-bit ns offset per point relative to packet start | ~10 ns | Non-repetitive scan pattern; ts-to-direction mapping is non-linear |
| Hesai Pandar series | Per-channel µs timestamps | ~1 µs | Dual-return modes keep both timestamps |

If using ROS, the `sensor_msgs::PointCloud2` field `time` carries per-point
timestamps when the driver populates it. Some older drivers publish only a
header timestamp (scan start), requiring per-point time reconstruction from
azimuth angle — an approximation that degrades deskew quality vs. true hardware
timestamps.

---

## 4. Rolling-Shutter Cameras (Brief Context)

A global-shutter camera exposes all pixels simultaneously. A rolling-shutter
camera exposes rows sequentially; row `v` is read at `t(v) = t_frame + (v-v0)*t_row`.
During yaw, a vertical pole can appear slanted; projection must use the per-row
pose `T_CW(t(v))`, not a single frame pose. Effect scales as
`image_error ~= angular_rate * readout_time * focal_length`.

| Model | Assumption | Use |
|---|---|---|
| constant velocity during frame | short exposure, smooth motion | visual odometry / bundle adjustment |
| IMU-integrated pose per row | reliable IMU timing and extrinsics | visual-inertial systems |
| continuous-time spline/GP | batch calibration or offline SLAM | rolling-shutter calibration |
| learned correction | model absorbs residual distortion | perception-only; weak geometry guarantees |

---

## 5. Math — Pose Interpolation Methods

To evaluate `T_world_ego(t_i)` for every point, a continuous (or
piecewise-continuous) trajectory model is required. Three families are in use.

### 5.1 Constant-Velocity / SLERP (LOAM / KISS-ICP Style)

Assume constant angular and linear velocity during the sweep (zero acceleration).
Let the fractional time within the scan be:

```text
s_i = (t_i - t_start) / (t_end - t_start)    in [0, 1]
```

**Rotation (SLERP on SO(3)):**

```text
R(s_i) = R_start · Exp( s_i · Log(R_start^T · R_end) )
```

where `Exp` and `Log` are the SO(3) exponential and logarithm maps (axis-angle /
Rodrigues). See [Lie Groups SE(3), SO(3)](lie-groups-se3-so3-jacobians.md).

**Translation (LERP):**

```text
t(s_i) = (1 - s_i) · t_start + s_i · t_end
```

KISS-ICP implements this with the constant-velocity assumption. From consecutive
pose estimates over interval `Delta_t`, it estimates body-frame velocity:

```text
v_t = R_{t-2}^T (t_{t-1} - t_{t-2}) / Delta_t     # translational velocity
w_t = Log(R_{t-2}^T R_{t-1}) / Delta_t             # rotational velocity in Lie algebra
```

Per-point correction at relative time `s_i` in `[0, Delta_t]`:

```text
p_i* = Exp(s_i · w_t) · p_i + s_i · v_t
```

This constant-velocity model fails during aggressive braking, sharp turns, or
large accelerations — conditions infrequent on taxiways but common in industrial
yard manoeuvres and pushback tugs.

### 5.2 Higher-Order Interpolation (SQUAD)

For high angular-rate manoeuvres, linear SLERP between scan-start and scan-end
may be insufficient. The De-Skewing for Local Mapping paper (Sensors 2020) uses:

- **Lagrangian interpolation** (degree 4, four nearest IMU poses) for translation
- **SQUAD** (Spherical and Quadrangle) for rotation — a higher-order variant of
  SLERP using an auxiliary quaternion controller `s_i`:

```text
s_i = exp( (-log(q_{i+1} q_i^{-1}) + log(q_i q_{i-1}^{-1})) / 4 ) · q_i

squad(q_i, q_{i+1}, s_i, s_{i+1}, t) =
    slerp( slerp(q_i, q_{i+1}, t),
           slerp(s_i, s_{i+1}, t),
           2t(1-t) )
```

SQUAD achieves C1-continuity (smooth tangent at control points) vs. SLERP's C0,
which matters when IMU measurements are at moderate rate (100 Hz) relative to
LiDAR firing rate.

### 5.3 Full SE(3) Left-/Right-Product Convention

Many implementations split rotation and translation. The fully-consistent SE(3)
interpolation stays on the manifold:

```text
T(s_i) = Exp( s_i · Log(T_end · T_start^{-1}) ) · T_start
```

The **right-product correction** form used by most LIO systems expresses the
intra-scan relative transform as:

```text
Delta_T(t_i) = T_world_ego(t_end)^{-1} · T_world_ego(t_i)
p_corrected  = Delta_T(t_i) · p_raw
```

The multiplication convention (left vs. right) must match the Jacobian
convention used in the downstream optimizer. Mixing conventions is a silent,
hard-to-detect bug — see
[Lie Groups SE(3), SO(3)](lie-groups-se3-so3-jacobians.md) for left/right
perturbation derivations.

---

## 6. IMU-Aided Deskew — The LIO Standard Pipeline

### 6.1 Architecture

When IMU data is available at high rate (typically 200–400 Hz), the ego-pose at
each `t_i` is derived from IMU pre-integration rather than a linear assumption.
The kinematic model integrates:

```text
p_dot = v
v_dot = R (a_m - b_a) + g
R_dot = R · skew(w_m - b_w)
b_a_dot = eta_ba
b_w_dot = eta_bw
```

where `a_m`, `w_m` are IMU accelerometer/gyroscope measurements, `b_a`, `b_w`
are slowly-varying biases, and `g` is gravity.

**Standard LIO deskew pipeline:**

```text
[IMU @ 200-400 Hz] --> pre-integration --> intra-scan pose buffer
                                                 |
[LiDAR scan, per-point t_i] ------------------->|-- per-point pose T(t_i)
                                                 |
                                    deskew: p_corr = T_end^{-1} · T(t_i) · p_raw
                                                 |
                                       registration (ICP / NDT / ikd-tree)
                                                 |
                                            map update
```

**LIO-SAM** deskews each incoming scan using IMU preintegration between the
previous keyframe and the current scan end. The `deskewPoint()` function looks
up the preintegrated relative transform at each point timestamp and applies the
correction. GPS/compass measurements enter as prior factors in the back-end
factor graph but are not required for deskew.

**FAST-LIO2** uses the iterated Extended Kalman Filter (iEKF). The state
propagation step integrates IMU between scans. The **back-propagation** step
re-traces this integration from `t_end` backward to each `t_i` to produce
per-point relative transforms. This is exact for the IMU model (noise and bias
aside) rather than the constant-velocity approximation.

**DLIO** (Chen et al. ICRA 2023) constructs a continuous-time trajectory using
a coarse-to-fine strategy. A nonlinear geometric observer initialises the state
(removing the sensitive initialisation problem of Kalman-based methods), then
IMU integration constructs piecewise-analytical trajectory segments. Per-point
deskewing is computed from analytical equations parameterised solely by time,
enabling parallel per-point deskewing with no sequential dependency within a
batch. DLIO achieves ~12% accuracy improvement and ~20% lower compute vs.
FAST-LIO2 on standard benchmarks.

### 6.2 Bias Estimation

IMU biases (`b_a` for accelerometer, `b_w` for gyroscope) are slowly
time-varying due to temperature, ageing, and vibration.

```text
Gyro bias b_w: typical MEMS grade 0.01-0.5 deg/s
At 0.1 deg/s uncompensated bias, over 100 ms sweep: 0.01 deg heading error
At 20 m range: 3.5 mm -- below noise floor
At 1.0 deg/s bias, over 100 ms sweep: 0.1 deg heading error
At 20 m range: 35 mm -- approaches landmark-class noise
```

Bias is often larger immediately after cold-start or during temperature
transitions. More critically, biased pre-integration is **systematic**, not
random: it produces a rotated scan rather than a noisy one, and does not average
out in aggregated maps. In LIO systems, biases are included in the state vector
and estimated online via the filter or graph optimiser. The standard prior is a
random-walk model (`b_dot ~ N(0, Q_b)`). Well-calibrated bias reduces deskew
error; undercalibrated bias (e.g., immediately after cold-start) degrades
correction quality.

### 6.3 IMU Rate and Aliasing

At 100 Hz IMU with a 100 ms sweep, there are only ~10 IMU samples to
characterise intra-scan motion. High-frequency vibrations (e.g., engine
vibration on an aircraft tug at 50–300 Hz) are below the Nyquist rate and
cannot be captured. Piecewise-linear interpolation between those 10 samples
aliases high-frequency rotational motion. Result: residual high-frequency
distortion that looks like blur rather than shear.

Practical mitigation: 200–400 Hz IMU, or gyroscope-only integration at 1000 Hz
(where only rotation — the dominant distortion source — is integrated at high
rate, while translation is handled at lower rate).

---

## 7. Wheel-Odometry / GNSS-Aided Deskew

When IMU is unavailable or low-quality, alternative motion sources can drive
deskew.

**Wheel odometry:** Provides linear velocity directly from encoder pulses; more
noise-immune to vibration than IMU integration. Rotation still requires a
gyroscope or steering angle model. Tightly-coupled LiDAR-IMU-wheel systems use
wheel odometry as a linear constraint in the factor graph, complementing IMU
where LiDAR geometry degenerates.

**GNSS / RTK:** Low-cost GPS at 5–10 Hz is too slow for per-point deskew
(100 ms sweep → at most 1 sample/sweep). However, RTK GPS at 10–20 Hz in open
outdoor environments (e.g., taxiway) offers 2–5 cm absolute accuracy, bounding
accumulated drift in the pose buffer. GLIO (GNSS+LiDAR+IMU) fuses all three.

**KISS-ICP (LiDAR-only):** Estimates velocity from consecutive scan-to-scan
registrations and uses the constant-velocity assumption to deskew the next scan.
Bootstrapped (no deskew on first scan) but converges rapidly. Fails during
aggressive braking or sharp turns — infrequent on taxiways but common during
pushback.

| Source | Rate | Provides | Best for |
|---|---|---|---|
| IMU (200+ Hz) | 200–1000 Hz | rotation + acceleration | general; standard LIO |
| Wheel encoder | 50–100 Hz | linear velocity | low-vibration indoor/yard |
| RTK GNSS | 10–20 Hz | absolute position + heading | open taxiway; drift bound |
| KISS-ICP (scan-to-scan) | 10–20 Hz | velocity estimate | LiDAR-only; fails on sharp turns |

---

## 8. Continuous-Time Formulations

Discrete-pose interpolation is an approximation. Continuous-time methods treat
the entire trajectory as a parametric curve and evaluate pose at any query time
analytically.

### 8.1 CT-ICP: Two-Pose-Per-Scan (Elastic Scan Matching)

CT-ICP (Continuous-Time ICP, Dellenbach et al. ICRA 2022) parameterises each
scan with **two control poses** `{T_start, T_end}` and interpolates per-point
poses linearly between them. The scan-to-map registration objective is:

```text
min_{T_start, T_end}  sum_i  rho( d(p_i(T(s_i)), pi_i)^2 )
```

where `T(s_i)` is the linearly-interpolated pose at fractional time `s_i`,
`d(·, pi_i)` is the point-to-plane distance to the nearest surface `pi_i` in
the map, and `rho` is a robust kernel (e.g., Cauchy). By jointly optimising
`T_start` and `T_end`, CT-ICP simultaneously estimates the scan's trajectory
and deskews its points. No external IMU required; the trajectory curvature
within the scan is inferred from geometric constraint alone.

Performance: mean RTE 0.59% on KITTI, 60 ms/scan single-thread CPU.

### 8.2 B-Spline Trajectory Representations

State-of-the-art continuous-time methods use **B-spline curves** over SE(3) or
SO(3)×R³ to represent the full trajectory. A B-spline of degree `k` has
`C^{k-1}` continuity and local support (moving one control point affects only
neighbouring segments). For deskewing, the pose at any timestamp is evaluated
by the B-spline basis functions applied to the nearest control poses.

```text
T(t) = prod_{j=0}^{k} Exp( B_{j,k}(t) · log(T_{i+j-1}^{-1} T_{i+j}) )
```

Notable implementations:

- **Coco-LIC** (2023): non-uniform B-spline LiDAR-inertial-camera odometry;
  control nodes placed adaptively via IMU pre-estimation
- **RESPLE** (2024): recursive Bayesian spline estimation for 6-DoF
  continuous-time motion
- **LIO-MARS** (2024): non-uniform continuous-time trajectories; unscented
  transform for surfel deskewing

B-splines add computational cost proportional to degree and knot density but
provide physically smoother trajectories that better handle vibration and
high-rate manoeuvres.

### 8.4 Truly-Coupled Deskew

Standard pipelines use a **two-step** approach: (1) deskew with the previous
pose estimate, (2) register. The deskew step uses stale poses, so errors in the
previous estimate pollute the current correction. The truly-coupled method
(arXiv 2410.05152) embeds deskew inside the optimisation: each point's pose
`T(t_i; S)` is a function of the estimated state `S` (biases, velocity, gravity
orientation), and the registration residuals are differentiated w.r.t. `S`
jointly. This closes the loop: better state → better deskew → better residuals
→ better state.

The paper demonstrated that DLIO leaves measurable double-wall gaps at scan
boundaries in high-rotation sequences, while the coupled approach eliminates
them. This is directly relevant to the aggregated-map quality metric: the
double-wall gap is the primary visual/quantitative indicator of deskew
correctness in accumulated maps.

### 8.5 Summary Table

| Approach | IMU required | Accuracy | CPU cost | Notes |
|---|---|---|---|---|
| Constant velocity / SLERP (LOAM, KISS-ICP) | No | Low–medium | Very low | Fails at sharp manoeuvres |
| IMU pre-integration linear (LIO-SAM) | Yes (200–400 Hz) | High | Low | Standard LIO pipeline |
| Back-propagation (FAST-LIO2) | Yes | High | Low–medium | Exact per IMU model |
| SQUAD higher-order (PMC7180945) | Yes (100+ Hz) | High | Low–medium | C1-continuous; better at moderate IMU rate |
| Two-pose per scan (CT-ICP) | No | High | Medium | LiDAR-only; KITTI SOTA |
| Continuous-time B-spline (Coco-LIC, RESPLE) | Yes | Very high | High | Best for aggressive motion |
| Truly-coupled (arXiv 2410.05152) | Yes | Very high | Low | Eliminates two-step stale-pose bias |

**Recommended minimum for airside aggregated-map pipeline:** IMU pre-integration
with back-propagation (FAST-LIO2 style), hardware PPS/PTP time sync, 200+ Hz
IMU. For high-accuracy map-grade output: B-spline trajectory or truly-coupled
deskew.

---

## 9. Solid-State and Non-Spinning LiDAR

The deskewing problem exists for all LiDAR sensors with asynchronous point
acquisition — not just spinning mechanical designs.

**Livox (Risley prism) — important clarification:** Livox sensors (Mid-360,
Avia, HAP) use mechanically rotating Risley prisms, not fully solid-state. They
produce non-repetitive, pseudo-random scan patterns with varying coverage across
the FOV over integration time. Points are still fired sequentially with distinct
per-point timestamps, so the same rolling-shutter distortion applies. However,
the pattern is irregular: unlike a spinning LiDAR where beam angle is a linear
function of time, the Livox azimuth/elevation mapping is non-linear. The deskew
formula is identical in structure (`p_corr = T_end^{-1} · T(t_i) · p_raw`) but
the timestamp-to-beam-direction mapping is more complex. FAST-LIO2 and DLIO
both explicitly support Livox sensors.

**MEMS LiDAR:** Oscillating mirror; scan pattern is a Lissajous or raster.
Distortion model is similar to spinning but with sinusoidal rather than linear
azimuth sweep — interpolation must account for the actual angular velocity of
the mirror at each firing.

**Optical Phased Array (OPA):** Beam-steering via phased array at near-electronic
rates; frame rates can exceed 100 Hz, making per-sweep motion much smaller
(~5 ms/frame at 200 Hz → smear reduced by ×20 vs. 10 Hz spinning). Deskew
still needed but less critical.

**Flash LiDAR:** Fires a full-frame pulse and captures all returns simultaneously
(like a global-shutter camera). No temporal sweep → **no rolling-shutter
distortion within a frame**. However, if the vehicle moves significantly between
successive flash frames (e.g., 33 ms at 30 Hz), the issue shifts to inter-frame
registration, not intra-frame deskew.

**FMCW LiDAR:** Coherent ranging; reports both range and radial velocity per
point. The velocity measurement can directly inform the motion model for
deskewing, a unique capability not available in pulsed ToF sensors.

**Key distinction:** The deskew problem is specifically an **intra-frame**
problem. Flash LiDAR eliminates intra-frame distortion; all other sensor types
(spinning, MEMS, Risley prism) retain it to varying degrees.

---

## 10. Ego-Motion vs Object Motion

Deskewing with ego-motion assumes the world is static:

```text
p_W for a static surface is constant
```

For a moving vehicle or pedestrian:

```text
p_W(t_i) = p_W(t_ref) + v_object * (t_i - t_ref)
```

Ego deskew can make static background sharper while stretching moving objects.
That is not a bug in ego deskew; it is a missing object-motion model. Perception
systems may need:

- dynamic object masking before mapping,
- per-object velocity compensation,
- track-aware accumulation,
- short temporal windows for moving classes,
- different deskew policy for detection input versus static mapping input.

For static-map aggregation (the primary airside use case), dynamic object
masking before accumulation is the standard mitigation. Airside dynamic objects
— aircraft, GSE, personnel — must be filtered before the scan contributes to
the persistent map.

---

## 11. Deskew in the Aggregated Map Pipeline

### 11.1 The Mandatory Ordering

Deskew is not optional in a high-quality aggregated map pipeline. The correct
order of operations is strict:

```text
Raw LiDAR packet
    |
    v
1. Per-point timestamp extraction
    |  (Ouster: 64-bit ns per column;  Velodyne: 2-byte firing offset;
    |   Livox: 32-bit ns per point;   Hesai: per-channel us timestamp)
    |
    v
2. IMU pre-integration (or constant-velocity estimate)
    |  produces T_world_ego(t_i) for each point timestamp
    |
    v
3. Deskew:  p_corr = T_end^{-1} · T(t_i) · p_raw
    |  all points now live in the scan-end frame
    |
    v
4. Scan-to-map registration (ICP / NDT / LOAM edge-plane)
    |  rigid-body assumption now valid for the deskewed cloud
    |
    v
5. Map update (add deskewed, registered scan to voxel map / surfel map)
    |
    v
6. Semantic segmentation
    |  operates on clean, geometrically consistent multi-scan accumulation
    |  (see §9.2 conditioning in aggregated-map-semantic-segmentation.md)
```

Inserting registration (step 4) before deskew (step 3) is the most common
implementation error. It uses stale poses from the previous frame for the
current frame's deskew — acceptable in steady-state but causes systematic error
at the start of trajectories and after aggressive manoeuvres.

### 11.2 Effect on Segmentation Quality

A segmentation model trained on clean, deskewed point clouds will fail
catastrophically on undeskewed inputs at high vehicle speeds:

- **Planes** (road, taxiway pavement) appear warped — planar features scatter
  across voxels
- **Poles and signage** appear doubled or elongated — object detection misses or
  double-counts
- **Painted markings** (hold-short lines, runway identifiers) smear below the
  voxel resolution threshold, becoming invisible to any segmentation model
- **Curb edges** (5–10 cm height) smear into road surface, making curb detection
  unreliable

Quantitative evidence from the De-Skewing for Local Mapping paper: 41% decrease
in X-dimension registration error and 50% decrease in Y-dimension error at a
deceleration zone, with "ten times decrease" in per-channel RMSE on uneven
roads. These are mapping-quality improvements; segmentation-quality degradation
from skew is at minimum proportional to these figures.

### 11.3 Airside-Specific Considerations

- **PTP/GPS sync:** Airside AV sensors can synchronise to aeronautical GNSS
  (GPS time) via PPS pulse, giving sub-microsecond LiDAR-IMU time alignment.
  This is the recommended configuration for all precision deskew.
- **Taxiway surface reflectivity:** Asphalt absorbs LiDAR returns, producing
  sparser scans at oblique angles. Sparse scans amplify per-point deskew
  importance: each point is individually more valuable, so its geometric
  accuracy matters more.
- **Adverse weather:** Rain and fog reduce effective LiDAR range. Reduced range
  means the scan covers less ground area, which means translational smear
  occupies a larger fraction of the effective scan footprint — deskew becomes
  more important, not less, in adverse weather.
- **Symmetric apron geometry:** Symmetric apron geometry causes false loop
  closures; undeskewed scans compound this by adding artificial shape variation
  that distinguishes structurally identical bays.

---

## 12. Quality Metrics and Diagnostics

### 12.1 The Double-Wall Visual Symptom

The most salient diagnostic of an undeskewed aggregated map is the **double
wall**: when multiple scans of a planar surface (wall, kerb, building facade)
are accumulated without deskew, the early-sweep points and late-sweep points of
each scan land at slightly different world positions. Over N accumulated scans,
each contributing a shifted copy, the map shows two or more parallel planes
where only one should exist. The separation equals approximately the
translational smear per scan. This is the direct output-space indicator used by
practitioners to identify missing or broken deskew.

### 12.2 Self-Overlap Gap Metric

The truly-coupled deskewing paper (arXiv 2410.05152) explicitly quantifies
double-wall severity via **self-overlap gap measurement**: in a corridor where
the scan overlaps itself (180° and 0° beams look at the same wall), the gap
between the two apparent wall positions in the undeskewed case is measurable and
non-zero. After correct deskew, the gap closes to the sensor noise floor (~2 cm
for modern LiDAR). This metric is actionable: it can be computed from any
accumulated map without ground truth.

### 12.3 Point-to-Plane Residual Limitations

The naive approach — compute mean point-to-plane distance before and after
deskew and claim improvement — has a known flaw: if motion is purely
translational perpendicular to a surface, the point moves along the normal
direction and point-to-plane distance changes, making the metric valid. But if
motion is **tangential to the surface**, the point moves parallel to the plane
and point-to-plane distance is zero both before and after — the improvement in
geometric consistency is real but invisible to this metric.

A proper alternative: measure the offset of the entire deskewed cloud w.r.t. a
reference cloud obtained from a stationary scan. This is a proper ground-truth
comparison when a static reference is available.

### 12.4 Seam Consistency and RTE/RRE

In a loop-closed map, seam consistency measures how well the scan at loop
closure aligns with the initial mapping pass. An undeskewed pipeline produces
larger loop-closure residuals because accumulated scan distortion compounds
per-scan registration error. After deskew, loop closure residuals decrease
systematically. KITTI-style RTE (Relative Translation Error) and RRE (Relative
Rotation Error) over 100 m / 200 m segments are the standard aggregate metrics
for LIO systems; they are implicitly deskew quality metrics.

### 12.5 Practical Diagnostics

1. **Visual inspection:** Load map in CloudCompare/Open3D; examine planar surfaces for double layering.
2. **Colour-by-time:** Colour points by relative scan time; a colour gradient across a wall indicates missing or broken deskew.
3. **Time-offset sweep:** Shift the IMU-LiDAR timestamp offset by ±10 ms; residuals should increase in both directions — minimum is the true offset.
4. **Straight-line planarity:** Drive straight; compute planarity of aggregated road surface. Undeskewed road appears curved.
5. **Self-overlap gap:** In a corridor, measure 0°/180° wall separation. Should be ≤2 cm after correct deskew.

---

## 13. Failure Modes

| Symptom | Cause | Diagnostic |
|---|---|---|
| Walls bend during turns | No deskew or wrong angular velocity | Colour points by relative scan time |
| Sharp when straight, distorted in turns | Rotation deskew missing or sign wrong | Replay turn-in-place data |
| Distortion grows with speed | Timestamp offset; translation not modelled | Plot residual vs speed |
| Cloud jumps at packet boundary | Packet timestamp interpreted as point timestamp | Inspect per-ring time continuity |
| Vertical poles split into two | Wrong reference time or yaw interpolation | Compare start/mid/end reference outputs |
| Deskew worsens the cloud | Wrong extrinsic, frame direction, or time base | Test static scene with controlled motion |
| Moving cars become smeared | Ego-only deskew applied to dynamic objects | Mask or track dynamic classes |
| Double wall even after deskew | IMU bias drift; stale two-step deskew | Check bias estimates; use truly-coupled method |
| High-frequency blur (not shear) | IMU rate aliasing; vibration > Nyquist | Upgrade to 400 Hz IMU or filter high-freq vibration |
| Systematic rotational shear | IMU gyro saturation during manoeuvre | Check gyro full-scale range; apply SAAVE correction |
| Gradual drift in map quality | Extrinsic calibration error R^L_I | Re-run LiDAR-IMU spatial calibration; 0.5° rotation error ≈ 0.5° bias drift |
| Scan correction inconsistent at startup | Cold-start IMU bias; not yet estimated | Add warm-up period or initialise biases from prior |
| Time-sync structured shear | Hardware clock offset > 5 ms | Use PTP 1588 or GPS PPS; validate with DTW timestamp alignment |

**IMU bias drift:** Gyro bias `b_w` (0.01–0.5 °/s MEMS grade) produces a
systematic, non-averaging rotational error in the deskewed cloud — not blur, but
rotation. Temperature transitions cause the largest jumps. Mitigations: LIO
online bias estimation, temperature-compensated firmware, warm-up period.

**Time-synchronisation:** A 10 ms LiDAR-IMU clock offset at 5 m/s maps to
5 cm systematic position error per point. The error is structured and correlated
within a sweep, so it does not average out in aggregated maps. Ouster sensors
give 10 ns precision with PTP 1588 or GPS PPS; without hardware sync, the ROS
driver stack can introduce 5–20 ms jitter.

**Gyroscope saturation:** High-rate events (aircraft tow emergency stop) can
saturate MEMS gyroscopes (±500–2000 °/s full scale). Clipped angular velocity
→ sheared deskew. SAAVE (arXiv 2605.17264) reduces error by 83.4% in saturated
segments.

**Extrinsic calibration error:** `T^L_I` (LiDAR-IMU 6-DoF rigid transform)
errors in the rotation component `R^L_I` directly corrupt deskew. 0.5° rotation
calibration error produces the same order of magnitude deskew error as 0.5°
bias drift.

---

## 14. Implementation Checklist

- Use hardware per-point timestamps; do not reconstruct from azimuth angle.
- Define and document whether the published cloud is expressed at scan start,
  midpoint, or end — the choice propagates into all downstream transforms.
- Use hardware time sync (GPS PPS or PTP 1588); software arrival timestamps
  introduce 5–20 ms jitter.
- Interpolate poses on SE(3); keep left/right multiplication conventions
  consistent with the downstream optimizer.
- Include LiDAR-to-IMU extrinsics in the deskew transform chain.
- **Strict ordering:** deskew → registration → map aggregation → segmentation.
  Inverting steps 1 and 2 is the most common implementation error.
- Plot point residuals by relative scan time after scan-to-map alignment.
- Test: static scene, turn-in-place, hard braking, moving object.
- Keep raw clouds for debugging; irreversible deskew hides timing mistakes.
- Mask dynamic objects before contributing scans to a long-term static map.
- On airside deployments: GPS PPS from aeronautical GNSS gives sub-µs
  LiDAR-IMU alignment.

---

## 15. Minimal Pseudocode

```text
for point in scan:
    t_i = scan_start_time + point.relative_time
    T_WS_i = query_pose_sensor(t_i)       # IMU pre-integration or constant-vel
    T_WS_ref = query_pose_sensor(t_ref)   # scan-end or chosen reference
    point_ref = inverse(T_WS_ref) * T_WS_i * point.sensor_xyz
    output.add(point_ref)
```

If `query_pose_sensor(t)` silently extrapolates far beyond its support interval,
the deskewer will produce plausible but wrong clouds. Treat extrapolation as a
fault unless the estimator explicitly supports it.

---

## 16. Sources

- Ji Zhang and Sanjiv Singh, "LOAM: Lidar Odometry and Mapping in Real-time": https://publications.ri.cmu.edu/storage/publications/pub_files/2014/7/Ji_LidarMapping_RSS2014_v8.pdf
- Tixiao Shan et al., "LIO-SAM: Tightly-coupled Lidar Inertial Odometry via Smoothing and Mapping" (2020): https://arxiv.org/abs/2007.00258
- Wei Xu et al., "FAST-LIO2: Fast Direct LiDAR-Inertial Odometry" (2022): https://ar5iv.labs.arxiv.org/html/2107.06829
- Igor Vizzo et al., "KISS-ICP: In Defense of Point-to-Point ICP" (arXiv 2209.15397): https://arxiv.org/abs/2209.15397
- Pierre Dellenbach et al., "CT-ICP: Real-Time Elastic LiDAR Odometry" (arXiv 2109.12979): https://arxiv.org/pdf/2109.12979
- Yunfan Chen et al., "DLIO: Direct LiDAR-Inertial Odometry" (arXiv 2203.03749): https://arxiv.org/abs/2203.03749
- Real-Time Truly-Coupled LiDAR-Inertial Motion Correction (arXiv 2410.05152): https://arxiv.org/html/2410.05152v1
- De-Skewing LiDAR Scan for Refinement of Local Mapping (PMC7180945): https://pmc.ncbi.nlm.nih.gov/articles/PMC7180945/
- Velocity Estimation from LiDAR Sensors Motion Distortion Effect (PMC10708802): https://pmc.ncbi.nlm.nih.gov/articles/PMC10708802/
- Coco-LIC non-uniform B-spline LIO (arXiv 2309.09808): https://arxiv.org/pdf/2309.09808
- LIO-MARS non-uniform continuous-time (arXiv 2511.13985): https://arxiv.org/pdf/2511.13985
- RESPLE recursive Bayesian spline (arXiv 2504.11580): https://arxiv.org/html/2504.11580v1
- Continuous-Time State Estimation Survey (arXiv 2411.03951): https://arxiv.org/pdf/2411.03951
- Registration-based deskewing evaluation (Wiley Photogrammetric Record 2024): https://onlinelibrary.wiley.com/doi/10.1111/phor.12516
- AC-LIO: Asymptotic Compensation for Distortion (arXiv 2412.05873): https://arxiv.org/html/2412.05873v3
- Gyroscope Saturation SAAVE (arXiv 2605.17264): https://arxiv.org/abs/2605.17264
- Open-Source LiDAR Time Synchronization (arXiv 2107.02625): https://arxiv.org/pdf/2107.02625
- Ouster Multi-Sensor Synchronization docs: https://static.ouster.dev/sensor-docs/image_route1/image_route2/time_sync/time-sync.html
- Ouster Lidar Packet Format: https://static.ouster.dev/sensor-docs/image_route1/image_route2/appendix/lidar-packet-format.html
- Ouster Community: Motion Distortion Correction: https://community.ouster.com/t/lidar-motion-distortion-correction-motion-compensation/468
- IMU Preintegration in LIO-SAM (blog): https://limhyungtae.github.io/2022-04-01-IMU-Preintegration-(Easy)-5.-IMUPreintegration-in-LIO-SAM/
- Paul Furgale, Timothy D. Barfoot, and Gabe Sibley, "Continuous-Time Batch Estimation using Temporal Basis Functions": https://furgalep.github.io/bib/furgale_icra12.pdf
- Autoware Universe `distortion_corrector` documentation: https://autowarefoundation.github.io/autoware_universe/pr-9482/sensing/autoware_pointcloud_preprocessor/docs/distortion-corrector/
- ETH ASL LiDAR undistortion package: https://github.com/ethz-asl/lidar_undistortion
