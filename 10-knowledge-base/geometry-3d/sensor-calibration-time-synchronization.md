# Sensor Calibration and Time Synchronization Fundamentals

<!-- kb-visual:start -->
![Sensor Calibration and Time Synchronization Fundamentals curated visual](../_assets/visuals/geometry-3d-sensor-calibration-time-synchronization.svg)

*Visual: calibration contract diagram linking intrinsics, extrinsics, trigger source, timestamp semantics, clock alignment, validation logs, and fusion failure modes.*
<!-- kb-visual:end -->

Multi-sensor autonomy depends on two promises: every sensor is placed correctly
in space, and every measurement is placed correctly in time. Calibration and
time synchronization failures often look like model errors, perception false
positives, localization drift, or controller instability because the stack is
working with a subtly inconsistent world.

This page covers the foundation needed before LiDAR-camera fusion, radar
tracking, GNSS/INS localization, online mapping, docking, and incident replay.
It deepens the treatment of the `world_T_imu * imu_T_lidar * p_lidar`
composition chain used throughout the autonomy stack, and explains how errors
in that chain degrade aggregated-map quality and downstream semantic
segmentation.

---

## Related Docs

- [LiDAR Working Principles and Noise Models](lidar-working-principles-noise-models.md) — upstream sensor physics; per-beam intrinsics in §12 of that page
- [Rolling Shutter and LiDAR Deskew / Motion Distortion](rolling-shutter-lidar-deskew-motion-distortion.md) — deskewing consumes calibrated extrinsics and per-point timestamps from this page
- [Point Cloud Registration Math: ICP, NDT, GICP](point-cloud-registration-math-icp-ndt-gicp.md) — registration consumes calibrated extrinsics; map error budget connects here
- [Coordinate Frames, Projections, and SE(3)](coordinate-frames-projections-se3.md) — the SE(3) frame convention underlying every extrinsic transform
- [Lie Groups SE(3), SO(3), Adjoints, and Jacobians](lie-groups-se3-so3-jacobians.md) — Exp/Log maps and Jacobians used in extrinsic optimization
- [Multi-Sensor Calibration Observability](multi-sensor-calibration-observability.md) — FIM, degenerate motions, observability-aware data collection
- [RTK-GPS, IMU, and Multi-Sensor Localization](../state-estimation/rtk-gps-imu-localization.md)
- [Multi-LiDAR Calibration](../../20-av-platform/sensors/multi-lidar-calibration.md)
- [Calibration Tracking](../../20-av-platform/sensors/calibration-tracking.md)
- [Deterministic Networking and TSN](../../20-av-platform/networking-connectivity/deterministic-networking-tsn.md)
- [Aggregated-Map Semantic Segmentation](../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md) — segmentation quality is directly gated on calibration quality

---

## Why It Matters

| Effect | Impact | Risk if ignored |
|---|---|---|
| Extrinsic rotation error δθ at lever arm L | Lateral offset ≈ L · sin(δθ) per scan; summed over 200-scan aggregation systematic bias reaches sub-5 cm threshold | Ghost walls, doubled curbs, scan-seam artefacts in the aggregated map |
| Extrinsic translation error δt | Shifts every mapped point by δt regardless of aggregation count | Uniform world-frame offset; double-wall at >1 cm offset |
| Time-sync error Δτ at speed v | Lateral smear ≈ v · Δτ; at 5 m/s and Δτ = 20 ms smear = 10 cm | Thin-class IoU (curbs, markings, runway lights) halved when smear ≈ class width |
| LiDAR per-beam intrinsic elevation error 0.1° | ~17 mm lateral offset at 10 m range; fan-pattern rib artefacts in flat surfaces | Systematic ring seams corrupt ground-plane fitting and marking detection |
| Wrong transform direction or stale calibration | Fusion appears offset; silent drift as mount flexes over time | Systematic perception errors that look like model failures |

Sub-5 cm RMS map error is achievable with good calibration and PTP hardware
synchronization. Above ~10 cm combined error, thin-class IoU degrades sharply.

---

## 1. The Calibration Transform Chain

Every aggregated point in a multi-scan LiDAR map is placed by the composition:

```
p_world = world_T_imu  *  imu_T_lidar  *  p_lidar
```

Each factor is a 4x4 homogeneous matrix in SE(3). Errors in any factor
propagate into map position. The chain generalizes when a camera or radar is
added:

```
p_camera = camera_T_imu  *  imu_T_world  *  p_world
         = camera_T_imu  *  world_T_imu^{-1}  *  world_T_imu  *  imu_T_lidar  *  p_lidar
```

Error compounding works as follows:

- Extrinsic rotation error δθ (degrees) at lever arm L (m) produces lateral
  offset ≈ L · sin(δθ). For L = 0.5 m and δθ = 0.5°, offset ≈ 4 mm per scan.
  Negligible for a single scan but summed over a 200-scan aggregation the
  systematic bias reaches ~4 cm, crossing the 5 cm target.
- Extrinsic translation error δt adds directly: a 2 cm translation error shifts
  every point by 2 cm in the sensor frame, which maps directly into the world
  frame regardless of aggregation count.
- Time-sync error Δτ at vehicle speed v produces a lateral smear of ≈ v · Δτ.
  At 5 m/s airside speed and Δτ = 2 ms, smear = 1 cm; at Δτ = 20 ms,
  smear = 10 cm.

The deskewing step in
[Rolling Shutter and LiDAR Deskew](rolling-shutter-lidar-deskew-motion-distortion.md)
is the first consumer of this chain: if `imu_T_lidar` is wrong, deskewing
applies an offset trajectory and smears the scan. A 5 ms temporal error at 5
m/s produces 2.5 cm smear — approaching the practical limit for curb-level
features. See §5.3 for the per-point deskewing formula.

---

## 2. Intrinsic Calibration

### 2.1 LiDAR Per-Beam Model (HDL-64E Style)

A spinning multi-beam LiDAR such as the Velodyne HDL-64E has 64 independent
laser/detector pairs. Each beam i has up to six factory-calibrated intrinsic
parameters:

| Parameter | Symbol | Typical magnitude |
|---|---|---|
| Elevation (vertical) angle | phi_i | Varies ±15° across beams; error ~0.01–0.1° |
| Azimuth (rotational) offset | theta_i | ±0.01–0.5° inter-beam |
| Range scale factor | m_i | ~1 ± 0.001 |
| Range bias (zero-offset) | delta_r_i | ±10–25 mm |
| Horizontal position offset | delta_x_i | mm-level |
| Vertical position offset | delta_z_i | mm-level |

Random range measurement noise is ±25 mm; systematic per-beam misalignment
(the "layered" error) is the dominant degrader of planar-surface quality if
the factory calibration is ignored. The HDL-64E ships with a factory `.yaml`
or `.xml` file containing all 64 × 6 values. For solid-state or MEMS-based
LiDARs (Livox Avia, Ouster OS1), the per-beam model does not apply directly;
manufacturers provide factory intrinsics and do not expect field
re-calibration of the intrinsic model.

**Calibration method:** Place a pattern of known planar surfaces at several
distances and angles. For each beam, fit a plane to the returned points;
deviations from the best-fit plane residuals drive a Levenberg-Marquardt
(or equivalent) least-squares solver. The pattern-plane approach uses five
mutually non-parallel planes; five unknowns per beam can in principle be
solved with five planes.

A 0.1° elevation error at 10 m range produces a ~17 mm lateral offset — the
canonical fan-pattern rib artefact visible in flat-surface scans when the
factory calibration is stale.

### 2.2 Camera Intrinsics — Brown-Conrady and Fisheye Models

The standard pinhole projection:

```
[u]   [fx   0  cx] [X/Z]
[v] = [ 0  fy  cy] [Y/Z]
[1]   [ 0   0   1] [ 1 ]
```

followed by Brown-Conrady radial-tangential distortion:

```
r_sq = x*x + y*y
x' = x*(1 + k1*r_sq + k2*r_sq^2 + k3*r_sq^3) + 2*p1*x*y + p2*(r_sq + 2*x*x)
y' = y*(1 + k1*r_sq + k2*r_sq^2 + k3*r_sq^3) + p1*(r_sq + 2*y*y) + 2*p2*x*y
```

For wide-angle / fisheye lenses (common in airside AV for full-perimeter
coverage), the Brown model breaks down beyond ~90° FoV. OpenCV's fisheye module
implements the Kannala-Brandt equidistant projection model with four distortion
terms k1...k4.

**Calibration target paradigms:**

| Target | Camera detection | LiDAR detection | Notes |
|---|---|---|---|
| Checkerboard | Corner subpixel (cv2.findChessboardCorners) | Plane fit to reflective surface | Classic; pose ambiguity at symmetry |
| ChArUco | Corner + ArUco ID for unambiguous pose | Plane fit | Handles partial occlusion; recommended over pure checkerboard |
| AprilTag / AprilGrid | Tag ID enables pose without flips | Retroreflective backing → bright cluster | Kalibr default; robust at low resolution |
| Retroreflective board | ArUco overlay on retroreflective surface | Intensity peak centroid | Best for LiDAR-camera joint calibration |

Kalibr's camera-IMU pipeline mandates AprilGrid to avoid symmetry-induced pose
flips that corrupt the B-spline trajectory estimate. Acceptance criterion:
reprojection error < 0.5 px RMS.

---

## 3. Extrinsic Calibration

### 3.1 The SE(3) Rigid Transform Problem

Each sensor-to-sensor transform is a rigid body transformation T in SE(3):

```
T = [R | t]    R in SO(3), t in R^3
    [0 | 1]
```

Six degrees of freedom: 3 rotation (roll, pitch, yaw) + 3 translation
(x, y, z). For N sensors, (N-1) pairwise transforms are needed to define a
single reference frame. In a typical airside AV: LiDAR_front to IMU
(reference), LiDAR_left to IMU, camera_front to IMU, plus optional
LiDAR-to-LiDAR for multi-LiDAR rigs.

See [Lie Groups SE(3), SO(3), Adjoints, and Jacobians](lie-groups-se3-so3-jacobians.md)
for the Exp/Log maps and Jacobians used in optimization.

### 3.2 Target-Based Extrinsic Methods

**Planar board (checkerboard / ChArUco / AprilTag):**

1. Detect calibration target in camera image — extract 3D corner coordinates
   via PnP.
2. Fit a plane through the LiDAR points on the target — extract plane centroid
   and normal n.
3. Formulate constraint: the plane centroid and normal in LiDAR frame must
   match the plane in camera frame after transformation T.
4. Minimize reprojection error over multiple poses (at least 3 non-coplanar
   board orientations, ideally 10-30) via nonlinear least squares (Ceres
   Solver or Gauss-Newton).

The plane-normal constraint decouples rotation from translation, improving
numerical conditioning. Retroreflective targets allow sub-centimeter placement
accuracy in the LiDAR at 20 m range.

### 3.3 Targetless Extrinsic Methods

| Method | Key observable | Practical requirements |
|---|---|---|
| Motion-based (hand-eye AX=XB) | Relative motion from odometry | Sufficient motion excitation (see §4) |
| Mutual information (MI) maximization | MI between LiDAR intensity and camera gray | Texture-rich scene; overlapping FoV |
| Semantic feature matching | Matching class boundaries in both modalities | Pre-trained segmentation on both |
| Continuous-time targetless | SfM camera poses + LiDAR voxel map | Structured environment; good initialization |

The MI approach maximizes I(LiDAR_intensity; camera_gray) as a function of the
extrinsic T using gradient-free or analytic gradient optimization. Convergence
basin is narrow (~10 cm / ~5°); good initialization (e.g., from hand
measurement) is required.

---

## 4. Hand-Eye and Motion-Based Calibration

### 4.1 The AX = XB Problem

The hand-eye problem formalizes as:

```
A_i * X = X * B_i    for i = 1 ... N motion pairs
```

Where:

- A_i = relative motion of the "hand" (vehicle odometry) between pose i-1 and
  i, in SE(3).
- B_i = relative motion of the "eye" (LiDAR or camera) between the same two
  times, in SE(3).
- X = the unknown fixed transform from sensor to reference frame (the
  extrinsic).

**Solution approaches:**

- Tsai-Lenz (1989): closed-form; solves rotation then translation separately;
  requires simultaneous non-parallel rotations.
- Daniilidis (1999): dual quaternion formulation; solves rotation and
  translation simultaneously; better numerical properties.
- Full SE(3) optimization (Ceres / g2o): iterative; handles sensor noise;
  the standard approach in modern calibration tools.

### 4.2 Required Motion Excitation

At least two non-collinear rotation axes must be excited to make X unique (rank
condition on the Gramian):

- Translation-only motion leaves rotation unobservable.
- Rotation-only motion leaves translation partially observable only if rotation
  axes are linearly independent across motions.
- Rule of thumb: a "figure-8" trajectory excites all 6 DoF; straight-and-stop
  trajectories leave yaw-axis translation degenerate.

**Degenerate motion patterns:**

| Motion pattern | Unobservable DoF |
|---|---|
| Straight translation only | All rotational DoF of T_IL |
| Rotation in place | Translation of T_IL (partially) |
| Planar (ground-robot) motion | Vertical translation, roll/pitch of T_IL |
| Single-axis rotation | Other two rotation axes |

The "all-zeros-residual trap": after a least-squares optimization, zero
residual does not imply correct calibration. If the system is degenerate, the
optimizer finds a family of solutions with zero residual in the observable
subspace. Always inspect the per-DoF covariance from the FIM inverse and verify
calibration on a held-out trajectory with known ground truth.

---

## 5. LiDAR-IMU Extrinsic and Temporal Calibration

### 5.1 Parameters to Estimate

- Spatial: T_IL in SE(3) (IMU-to-LiDAR rigid transform, 6 DoF).
- Temporal: delta_t_IL (scalar; the time offset between LiDAR scan timestamps
  and IMU timestamps; typically -50 ms to +50 ms).
- IMU intrinsics (often co-estimated): scale/misalignment matrix, bias b_a and
  b_g (accelerometer and gyroscope biases).
- Gravity vector g in the IMU frame (3 DoF, constrained to |g| = 9.805 m/s²).

### 5.2 The LIO-Standard Online Refinement Pipeline

**LI-Init (HKU-MARS, IROS 2022):** Initializes extrinsic and temporal
calibration without targets or a prior map. The algorithm aligns LiDAR
odometry (from a scan-matching backbone) with IMU integration residuals to
recover delta_t_IL and T_IL. After initialization, FAST-LIO2 refines the
extrinsic online via its iterated-EKF for an additional 15-30 s of operation.
Output is written into a FAST-LIO2 config YAML.

**FAST-LIO2 online extrinsic refinement:** The iterated-EKF state vector
includes T_IL. The update equation re-estimates T_IL at each scan provided the
motion is sufficiently exciting (Fisher information condition monitored
internally). In practice, online refinement converges within the first 30-60 s
of a survey drive.

**OA-LICalib (APRIL-ZJU, TRO 2022):** Offline batch continuous-time
calibration of both LiDAR intrinsics and LiDAR-IMU spatiotemporal extrinsics.
Uses an information-theoretic data selection policy (FIM rank monitoring) to
pick only the informative trajectory segments, then applies truncated SVD to
update only the identifiable directions of the state. This is the most rigorous
offline tool currently available. OA-LICalib reports map thickness (Table VI
of the paper): 1.9-2.3 cm for their method versus 4.3-5.4 cm for uncalibrated
baselines.

### 5.3 Per-Point Deskewing — Temporal Calibration in Action

The per-point deskewing formula assumes linear interpolation of the relative
pose between scan start and end:

```
T_k(t_i) = Exp( (t_i - t_start)/(t_end - t_start) * Log(T_k(t_start)^{-1} * T_k(t_end)) ) * T_k(t_start)
```

where t_i is the per-point timestamp of point i within the scan (the `t`
channel in the `(x, y, z, intensity, t)` tuple). If delta_t_IL is wrong, the
deskewing uses an offset trajectory, smearing the scan. A 5 ms temporal error
at 5 m/s produces 2.5 cm smear — approaching the practical limit for curb-level
features.

---

## 6. LiDAR-Camera Extrinsic Calibration

### 6.1 Projection-Error Minimization

For a checkerboard visible in both camera and LiDAR:

1. Extract checkerboard corners p_c in image (pixels).
2. Fit plane to LiDAR points on board; extract 3D corner positions p_L in the
   LiDAR frame.
3. Minimize reprojection residual:

```
min_{R,t}  sum_i  || p_c_i - project(K * [R|t] * p_L_i) ||^2
```

where `project` is the perspective (or fisheye) projection and K is the camera
intrinsic matrix. Optimized with Ceres; typically needs 10-30 board poses for
robust convergence.

### 6.2 Edge/Line-Based Methods

Extract edges from the camera image (Canny) and LiDAR scan (intensity
gradient). Penalize distance from projected LiDAR edge points to the camera
edge map. More robust to textureless boards; requires a good initial guess
within ~5 cm / ~2°.

### 6.3 Mutual Information — Targetless

```
T* = argmax_T  I( I_camera(u,v) ; f_LiDAR(R*p + t) )
```

where f is a surface feature (intensity, normal-derived depth, or semantic
label). Gradient ascent (or particle swarm for global search) over the 6-DoF
space.

### 6.4 Key Tooling

| Tool | Approach | Multi-sensor | Notes |
|---|---|---|---|
| Kalibr | B-spline continuous-time; camera-IMU | Multi-cam multi-IMU | Does not natively calibrate LiDAR; needs companion tool |
| lidar_camera_calibration | Target-based plane+point correspondences | Single pair | Standard ROS package; uses checkerboard |
| targetless (arXiv 2302.05094) | MI / structural | Yes | General, single-shot, automatic |
| OA-LICalib | Continuous-time, observability-aware | LiDAR+IMU | Best offline LiDAR-IMU; no camera |
| LI-Init | Motion-based initialization | LiDAR+IMU | For use before FAST-LIO2 / R3LIVE |

---

## 7. Time Synchronization Architecture

### 7.1 Clock Domains

A vehicle commonly contains several clocks:

```
GNSS receiver clock
  -> PPS / time-of-week
PTP grandmaster
  -> vehicle Ethernet clocks
sensor hardware clocks
  -> camera, LiDAR, radar, IMU
host system clocks
  -> ROS / middleware timestamps
```

Good systems make the clock domain explicit in every driver and log.

### 7.2 GPS-PPS

The GPS receiver outputs a hardware pulse on its PPS pin every 1000 ms. The
LiDAR's sync input latches its internal counter on the PPS rising edge and
reads the absolute UTC time from the NMEA GPRMC sentence arriving ~70 ms later
at 9600 baud. Result: LiDAR timestamps aligned to UTC within ~1 µs jitter
(dominated by cable propagation and UART latency). Ouster, Velodyne, and Livox
all support this mode.

### 7.3 PTP — IEEE 1588v2 Four-Timestamp Math

A software-over-Ethernet protocol using the four-timestamp handshake:

- Sync message (master to slave): t1 (departure), t2 (arrival).
- Delay_Req / Delay_Resp (slave to master): t3 (departure), t4 (arrival).

Computed quantities:

```
link_delay   = [(t4 - t1) - (t3 - t2)] / 2
clock_offset = [(t2 - t1) - (t3 - t4)] / 2
             = (t2 - t1) - link_delay
```

PTP hardware timestamping in the PHY achieves sub-100 ns accuracy on a switched
Ethernet LAN. Software-only PTP (no PHY assist) degrades to ~10-100 µs.

### 7.4 gPTP / IEEE 802.1AS

A profile of IEEE 1588v2 optimized for TSN (Time-Sensitive Networking)
automotive Ethernet. Removes BMCA and Announce messages; mandates PHY-level
timestamping. AUTOSAR Time Sync over Ethernet uses gPTP as the backbone. An
Nvidia Orin ECU and a Velodyne LiDAR on the same gPTP domain can achieve
< 1 µs alignment.

### 7.5 ROS Message Timestamping

`ros::Time::now()` at the driver's receive callback has OS-scheduler jitter
of 1-10 ms on a non-RT Linux kernel. For precision mapping this is
insufficient; hardware-backed timestamps must be used instead (read directly
from the UDP packet header where the sensor embeds its PTP-synchronized
timestamp).

### 7.6 Per-Point Timestamp Channel

Modern LiDARs encode `t` (nanoseconds since scan start, or absolute PTP time)
in each point's packet. LIO-SAM and FAST-LIO2 consume this channel directly.
If the `t` field is absent (some older drivers strip it), all points in the
scan are assigned the scan start time — this is equivalent to assuming zero
vehicle motion during the scan and produces a characteristic "fan smear" on
fast-moving platforms.

IMU interpolation at a per-point timestamp t_p, given IMU samples at t_k and
t_{k+1}:

```
alpha = (t_p - t_k) / (t_{k+1} - t_k)
omega_p = (1 - alpha) * omega_k + alpha * omega_{k+1}    (linear angular velocity)
```

For higher fidelity, use SLERP on the integrated rotation quaternion, or the
piecewise-linear deskewing formula from §5.3.

### 7.7 Clock-Skew Model and MEMS Thermal Drift

When sensor A and system ECU B use independent oscillators, a linear clock
model suffices over short intervals:

```
t_B = a * t_A + b
```

where `a` is the clock ratio (skew; ideally 1.000000 but drifts at ~10-100 ppm
for MEMS oscillators) and `b` is the clock offset. Estimate `a` and `b` by
cross-correlating a shared signal (e.g., IMU acceleration spike from a vibration
event observed in both clocks). Online estimation via Kalman filter tracking
`[a, b]` as a slowly-varying state is the approach used in LIC-Fusion 2.0.

Thermal drift of a MEMS oscillator is 2-10 ppm/°C. Over a 40°C ambient change
(cold hangar to sunny apron), the clock skew can shift by ~100-400 ppm,
equivalent to 0.1-0.4 ms drift per second of unsynchronized operation —
significant for high-speed mapping passes.

### 7.8 Why Milliseconds Matter

Position error from timestamp offset is approximately:

```
position_error = vehicle_speed * time_offset
```

| Speed | 2 ms offset | 20 ms offset | 50 ms offset |
|---|---:|---:|---:|
| 2 m/s low-speed docking | 0.004 m | 0.04 m | 0.10 m |
| 5 m/s airside taxiway | 0.010 m | 0.10 m | 0.25 m |
| 10 m/s yard or campus | 0.020 m | 0.20 m | 0.50 m |
| 25 m/s road AV | 0.050 m | 0.50 m | 1.25 m |

Yaw-rate error also matters. A vehicle turning at 20 deg/s with a 50 ms offset
has a one-degree angular mismatch before any sensor noise is considered.

---

## 8. Observability and Calibration Quality Metrics

### 8.1 Fisher Information Matrix

For a calibration problem estimating state theta from measurements z with noise
covariance Sigma:

```
FIM(theta) = J^T * Sigma^{-1} * J
```

where J = dz/dtheta is the measurement Jacobian. The Cramer-Rao bound gives
the minimum achievable covariance: Cov(theta_hat) >= FIM(theta)^{-1}.

Rank deficiency: if the robot trajectory lacks sufficient excitation, some
rows/columns of J are linearly dependent → rank(FIM) < dim(theta). The
corresponding eigenvectors of FIM indicate unobservable directions. OA-LICalib
monitors rank(FIM) during data collection and alerts the operator when
calibration segments are uninformative.

### 8.2 Observability Gramian

For continuous-time systems, the observability Gramian integrates the squared
Jacobian over the collection window:

```
W = integral  J(t)^T * J(t) dt
```

A Gramian with small minimum singular value sigma_min → near-degenerate
calibration. GRIL-Calib for ground robots addresses the structural
unobservability of the vertical translation DoF under pure planar motion by
adding a ground-plane residual constraint that supplements the Gramian.

### 8.3 Truncated SVD for Degenerate Directions (OA-LICalib)

OA-LICalib's state update uses:

```
delta_theta = V_r * Sigma_r^{-1} * U_r^T * residual
```

where the subscript `r` denotes the truncated (rank-r) SVD of the Jacobian —
only the identifiable directions are updated. Unidentifiable directions are
frozen, preventing the optimizer from fitting noise in degenerate modes.

---

## 9. Online vs Offline / Lifelong Calibration

### 9.1 Offline Batch Calibration

Run once (e.g., post-installation, after vehicle maintenance). Tools:
OA-LICalib, Kalibr + LI-Init. Requires a dedicated calibration drive with
scripted motions (figure-8, tilts, stops). Results written to a configuration
file consumed by the runtime.

Time to run: 30-120 min including data collection and optimization. Achievable
accuracy: < 1 cm translation, < 0.1° rotation (spatial); < 1 ms temporal with
hardware sync.

### 9.2 Online Continuous Refinement

The extrinsic state T_IL is added to the SLAM/LIO state vector and jointly
estimated during normal operation. FAST-LIO2's iterated-EKF does this by
default. LIC-Fusion 2.0 and FAST-LIO-SAM-based systems also track temporal
offset online.

**Observability caveat:** Online calibration only converges if the platform is
moving with sufficient excitation. During straight-line driving segments, the
calibration state should be frozen (no update) to prevent divergence.
Observability-aware online systems monitor the FIM rank per time window and
gate updates accordingly.

### 9.3 Thermal Drift and Vibration

Environmental perturbations that shift calibration:

- **Temperature:** Mechanical structures expand/contract (~10-20 µm/m/°C for
  aluminum). A 40 cm lever arm on a mounting bracket changes by ~80-160 µm over
  a 20°C range — generally below detection, but IMU MEMS scale factor drifts
  ~0.1% over the same range.
- **Vibration / shock:** A minor collision (curb bump at 1-2 m/s) can shift a
  camera mounting bracket by 1-5 mm and 0.1-0.5°. Post-shock recalibration is
  mandatory.
- **Production fleet strategy:** Monitor the extrinsic residual (mean
  reprojection error or map wall-thickness metric) in the data pipeline. Trigger
  a full recalibration when residual exceeds 1.5× the post-calibration baseline.
  Typical recalibration interval in production AV fleets: every 500-1000
  operating hours or after any collision event.

---

## 10. Calibration Evidence in Aggregated Maps

### 10.1 How Calibration Errors Manifest in Maps

| Error type | Map artefact | Magnitude threshold for visibility |
|---|---|---|
| Extrinsic rotation error (~0.5°, L=1 m) | Lateral shear between scan strips | ~8 mm per scan; visible after 10+ scans |
| Extrinsic translation error (2 cm) | Uniform offset; "double wall" if sign alternates | Visible at ~1 cm offset |
| Time-sync error (5 ms, 5 m/s) | Motion smear; curved walls, ghost points near dynamic objects | Visible at ~2 cm smear |
| LiDAR intrinsic per-beam elevation error (0.1°) | Fan-pattern rib artefacts in flat surfaces | Visible as ~17 mm offset at 10 m range |

**Double walls** are the canonical extrinsic calibration artefact: two
nearly-parallel thin surfaces appear where only one physical wall exists, caused
by two sensors (or two scan epochs) placing the same wall surface at slightly
different world positions.

**Dynamic ghosting** on slow-moving objects (taxiing aircraft, ground-support
vehicles) looks like calibration error but is actually a time-sync error: the
object moved between the LiDAR scan timestamp and the IMU-pose timestamp, so
deskewing applies the wrong motion correction.

### 10.2 How the Segmentation Pipeline Detects Bad Calibration

- **Seam artefacts at scan boundaries:** If the network is trained on clean
  aggregated maps, it will misclassify "phantom" points between scan strips as
  object surfaces. Seam artefacts appear as repeating thin parallel structures
  at scan-overlap distances.
- **Class confusion at calibration-error scale:** When calibration error is
  comparable to the physical width of a class (e.g., 10 cm error vs. 15 cm
  curb), the model sees a smeared gradient rather than a sharp curb edge, causing
  ground/curb confusion. Per-class IoU for thin structures (curbs, markings,
  runway lights) is the most sensitive diagnostic for calibration quality.
- **Map-entropy metric:** The entropy (or "thickness") of flat surfaces (ground
  plane, walls) in the aggregated map is a calibration-quality proxy: lower
  entropy → sharper surfaces → better calibration. OA-LICalib reports map
  thickness: 1.9-2.3 cm for their method vs. 4.3-5.4 cm for uncalibrated
  baselines.

See [Aggregated-Map Semantic Segmentation](../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md)
for the full treatment of how map quality gates segmentation performance.

---

## 11. Production Checklist

### 11.1 Order of Calibration Operations

1. **Camera intrinsics** — static, in a controlled environment (low-light
   variation, static target). Tools: OpenCV calibrateCamera or Kalibr with
   AprilGrid. Verify: reprojection error < 0.5 px RMS.
2. **LiDAR intrinsics** (if factory calibration is unavailable or suspect) —
   five-plane pattern at 5-20 m range. Verify: planar residual < 15 mm at 20 m.
3. **Camera-to-camera extrinsics** (if stereo / multi-camera) — Kalibr with
   simultaneous AprilGrid views. Verify: stereo reprojection error < 1 px;
   epipolar error < 1 px.
4. **Camera-to-LiDAR extrinsics** — target-based (checkerboard / retroreflective
   board at 5-15 m, at least 10 poses covering full angular range). Or targetless
   MI method initialized from rough hand-measurement. Verify: projected LiDAR
   edges align with image edges within 3 px.
5. **LiDAR-to-IMU spatiotemporal extrinsics** — run LI-Init with a figure-8 +
   stop sequence (minimum 60 s). Verify: temporal offset delta_t < 0.5 ms;
   spatial residual < 2 cm.
6. **System-level time sync** — enable PTP or GPS-PPS before the survey drive;
   verify sync status via sensor API. Verify: per-point timestamp monotonicity;
   no > 2 ms discontinuities.
7. **End-to-end map check** — collect a 5-minute closed-loop survey drive; build
   a dense map; measure wall thickness and ground-plane flatness. Accept if wall
   thickness < 3 cm and ground-plane RMS < 2 cm.

### 11.2 Recalibration Triggers and Frequency

| Event | Action |
|---|---|
| New sensor installation | Full calibration sequence (steps 1-7) |
| Sensor repositioning / bracket replacement | Steps 4-7 |
| Vehicle collision (any severity) | Steps 4-7; check intrinsics if sensor hit directly |
| Temperature change >30°C from calibration baseline | Steps 5-6 (spatial/temporal drift check) |
| Wall-thickness metric exceeds 5 cm in production maps | Steps 4-7 |
| Operating-hours interval (production fleet) | Full calibration every 500-1000 h |

### 11.3 Logging Schema

Every calibration artifact must record: software version and tool; date, ambient
temperature, platform ID, and sensor serial numbers; all extrinsic transforms
(SE(3) matrix + covariance diagonal); temporal offset per sensor pair
(delta_t ± sigma); post-calibration quality metrics (reprojection error, wall
thickness, ground-plane flatness); FIM minimum singular value per DoF; time-sync
mode and verified offset; approval status and rollback target. Distribute static
transforms through versioned URDF/YAML — the format matters less than consistent
versioning and review.

### 11.4 Survey Drive Protocol Tie-In

The calibration survey drive is distinct from the operational survey drive but
informs its design:

- The calibration drive should include tight figure-8 turns (radius ≤ 5 m),
  stops, ramp traversals (to excite pitch/roll), and a straight baseline return
  for consistency check.
- Operational survey drives that begin without hardware time-sync validation
  (e.g., PTP lock not confirmed) should be flagged; all data collected without
  confirmed sync must be post-processed with software offset estimation before
  map ingestion.
- The data pipeline should auto-compute the map-thickness metric for every survey
  leg and reject legs exceeding the 5 cm threshold before feeding into the
  segmentation training set.

---

## 12. Implementation Notes

- Apply LiDAR-IMU extrinsic before integrating IMU increments; the lever arm
  amplifies angular velocity error if not applied at the IMU output stage.
- Use `T_target_source` naming consistently and add projection tests in CI to
  catch inversion bugs.
- Verify PTP phase locking is active in multi-LiDAR setups; unsynchronized
  overlapping beams produce cross-talk returns in the merged cloud.
- For targetless MI methods, initialize from a hand-measured approximate
  transform; convergence basin is narrow (~10 cm / ~5°).
- Use map wall-thickness as the primary end-to-end acceptance criterion; it
  integrates all error sources simultaneously.
- Freeze the online calibration state during straight-line segments to prevent
  divergence from degenerate geometry.
- Include the FIM minimum singular value in calibration logs; a small sigma_min
  is a leading indicator of poor calibration even when residuals look acceptable.
- Preserve calibration covariance; correlated sensors treated as independent
  create overconfident fusion.
- Runtime monitors: LiDAR-camera reprojection residuals; multi-LiDAR overlap
  ICP residuals; PTP offset and grandmaster identity; IMU bias residuals; message
  age. Feed these into degraded-mode policy (slow down, disable fusion path,
  request service, or stop). Log raw sensor timestamps, PTP/PPS lock status,
  static transform tree, and calibration artifact IDs for incident replay.

---

## 13. Failure Modes

| Symptom | Cause | Diagnostic |
|---|---|---|
| Double walls in aggregated map | Extrinsic rotation or translation error between sensors or scan epochs | Measure wall thickness metric; compare with and without per-sensor calibration applied |
| Fan-pattern rib artefacts in flat surfaces | LiDAR per-beam elevation error; stale factory calibration | Run per-beam plane-fit residuals; compare planar std-dev by ring against spec |
| Silent extrinsic drift | Mount flex, thermal change, or vibration shifts calibration gradually | Monitor map wall-thickness; require recalibration when thickness exceeds 1.5× post-cal baseline |
| Deskewing worsens accuracy | LiDAR-IMU time offset or extrinsic error; IMU bias | Check residuals during rotation vs. translation segments; validate at known surveyed structure |
| Motion smear despite deskew | Temporal calibration error larger than expected; missing `t` channel | Verify per-point timestamps are present; check delta_t_IL vs. independent measurement |
| Wrong transform direction | Sensor fusion appears offset or mirrored | Use `T_target_source` naming and projection tests in CI |
| Unsynchronized clocks | Moving objects smear; estimator innovation grows during turns | Use hardware timestamps and PTP/PPS where available |
| Timestamping at arrival time | Latency changes with CPU/network load | Timestamp at acquisition in the sensor or driver boundary |
| PTP grandmaster failover | Clock jumps or offset ramps during operation | Monitor grandmaster identity and holdover state; define degraded policy |
| Bad calibration dataset | Optimizer finds a plausible but unobservable solution | Use calibration motions and targets that excite all unknowns; inspect FIM eigenvalues |
| Temperature or vibration sensitivity | Calibration correct in depot, wrong in service | Validate across operating temperature and vibration envelope; recalibrate after collisions |
| Correlated sensors treated as independent | Fusion becomes overconfident | Preserve calibration covariance; avoid double-counting measurements from shared sources |
| Dynamic ghosting mistaken for calibration error | Time-sync error: object moved between LiDAR scan and IMU-pose timestamps | Compare static vs. dynamic scene calibration residuals; check delta_t_IL specifically |
| "All-zeros residual" trap | Degenerate calibration: optimizer fits noise in unobservable subspace | Inspect per-DoF covariance from FIM inverse; validate on held-out trajectory |
| Camera-LiDAR projection misalignment at edges | Brown-Conrady model insufficient for fisheye lens | Switch to Kannala-Brandt / OpenCV fisheye model for >90° FoV cameras |

---

## 14. Sources

- LIDAR Velodyne HDL-64E Calibration Using Pattern Planes — SAGE Journals: https://journals.sagepub.com/doi/full/10.5772/50900
- On-Site Sensor Recalibration of a Spinning Multi-Beam LiDAR — PMC: https://pmc.ncbi.nlm.nih.gov/articles/PMC3545590/
- OA-LICalib: Observability-Aware Intrinsic and Extrinsic Calibration of LiDAR-IMU Systems — IEEE TRO 2022: https://ieeexplore.ieee.org/document/9787062/
- OA-LICalib GitHub (APRIL-ZJU): https://github.com/APRIL-ZJU/OA-LICalib
- OA-LICalib arXiv preprint: https://arxiv.org/pdf/2205.03276
- Targetless Intrinsics and Extrinsic Calibration of Multiple LiDARs and Cameras with IMU — arXiv 2501.02821: https://arxiv.org/html/2501.02821v1
- GRIL-Calib: Targetless Ground Robot IMU-LiDAR Extrinsic Calibration — arXiv 2312.14035: https://arxiv.org/html/2312.14035v1
- LiDAR_IMU_Init (HKU-MARS, IROS 2022) GitHub: https://github.com/hku-mars/LiDAR_IMU_Init
- Robust Real-time LiDAR-inertial Initialization — arXiv 2202.11006: https://arxiv.org/pdf/2202.11006
- Observability-aware Online Multi-lidar Extrinsic Calibration — arXiv 2212.09579: https://arxiv.org/pdf/2212.09579
- Kalibr Camera-IMU Calibration Wiki: https://github.com/ethz-asl/kalibr/wiki/camera-imu-calibration
- Kalibr GitHub: https://github.com/ethz-asl/kalibr
- Automatic Extrinsic Calibration of Camera and 3D LiDAR Using Line and Plane Correspondences — IROS 2018 (Zhou): https://www.cs.cmu.edu/~kaess/pub/Zhou18iros.pdf
- Automatic Extrinsic Calibration Camera and 3D LiDAR 3D Point and Plane — arXiv 1904.12433: https://arxiv.org/abs/1904.12433
- From Chaos to Calibration: Geometric Mutual Information Camera-LiDAR — arXiv 2311.01905: https://arxiv.org/pdf/2311.01905
- Calibrating LiDAR and Camera using Semantic Mutual Information — arXiv 2104.12023: https://arxiv.org/pdf/2104.12023
- General, Single-Shot, Target-Less, Automatic LiDAR-Camera Extrinsic Calibration — arXiv 2302.05094: https://arxiv.org/pdf/2302.05094
- Hand-Eye Calibration Survey — arXiv 2311.12655: https://arxiv.org/pdf/2311.12655
- LiDAR-LiDAR Hand-Eye Calibration via Optimization on SE(3) — ResearchGate: https://www.researchgate.net/publication/348383649_Lidar-Lidar_Hand-Eye_Calibration_via_Optimization_on_SE3
- On the Covariance of X in AX=XB — arXiv 1706.03498: https://arxiv.org/pdf/1706.03498
- Piecewise Linear De-skewing for LiDAR Inertial Odometry — arXiv 2108.06078: https://arxiv.org/pdf/2108.06078
- A Method of Calibration for the Distortion of LiDAR Integrating IMU and Odometer — PMC: https://pmc.ncbi.nlm.nih.gov/articles/PMC9459914/
- OpenCV Fisheye Camera Model Docs: https://docs.opencv.org/3.4/db/d58/group__calib3d__fisheye.html
- Ouster Multi-Sensor Synchronization Docs: https://static.ouster.dev/sensor-docs/image_route1/image_route2/time_sync/time-sync.html
- Livox Time Synchronization Instructions: https://livox-wiki-en.readthedocs.io/en/latest/tutorials/new_product/common/time_sync.html
- Intel TSN / gPTP Overview (ECI): https://eci.intel.com/docs/3.3/development/performance/tsnrefsw/tsn-overview.html
- LIC-Fusion 2.0 Tech Report: https://xingxingzuo.github.io/assets/documents/tr_lic2.pdf
- NavVis Guide to Evaluating Mobile Point Cloud Quality: https://www.navvis.com/blog/a-complete-guide-to-evaluating-mobile-point-cloud-quality
- Automatic Miscalibration Detection and Correction of LiDAR and Camera — Springer CJME 2024: https://link.springer.com/article/10.1186/s10033-024-01035-3
- Sensor Calibration for Automated Vehicles — Trucks VC / Medium: https://medium.com/fot-future-of-transportation-trucks-vc/trucks-fot-research-brief-sensor-calibration-for-automated-vehicles-d21cf446be05
- Camera, LiDAR, and IMU Spatiotemporal Calibration: Methodological Review — MDPI Sensors 2025: https://www.mdpi.com/1424-8220/25/17/5409
- Autoware sensor calibration guide: https://autowarefoundation.github.io/autoware-documentation/main/how-to-guides/integrating-autoware/creating-vehicle-and-sensor-description/calibrating-sensors/
- IEEE 1588 Precision Time Protocol overview: https://standards.ieee.org/ieee/1588/6825/
- IEEE 802.1AS timing and synchronization standard: https://1.ieee802.org/tsn/802-1as/
- linuxptp project documentation: https://linuxptp.sourceforge.net/
- ROS 2 time design article: https://design.ros2.org/articles/clock_and_time.html
- ROS message_filters documentation: https://docs.ros.org/en/rolling/p/message_filters/
