# Continuous-Time Registration for LiDAR SLAM and AV Localization

<!-- method-priority:start
priority:
  learning: 5
  deployment: 4
  type: "architecture-pattern"
  stage: "foundation"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "runtime-localization", "validation"]
  reason: "Continuous-Time Registration for LiDAR SLAM and AV Localization is rated for foundational SLAM modeling, optimization, registration, or mapping concepts."
method-priority:end -->

Related library pages: [Production LiDAR-to-Map Localization](../overview/production-lidar-map-localization.md) and [Modern LiDAR SLAM and Odometry Algorithms](../overview/lidar-slam-algorithms.md).

Related method pages: [KISS-ICP](./kiss-icp.md) (iter 20, constant-velocity deskew), [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) (iter 22, IMU-tight LIO baseline), [CT-ICP](./ct-icp.md) (2-pose CT-ICP deep dive), [KISS-SLAM](./kiss-slam.md) (iter 32), [CLIC / Coco-LIC](./clic-coco-lic.md), [LIO-SAM](./lio-sam.md), [MOLA](./mola.md), [Loop Closure and Place Recognition](./loop-closure-place-recognition.md) (iter 28).

Related overview pages: [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md).

Related KB pages: [Rolling-Shutter LiDAR Deskew and Motion Distortion](../../../10-knowledge-base/geometry-3d/rolling-shutter-lidar-deskew-motion-distortion.md) (iter 13), [Lie Groups SE(3)/SO(3) and Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) (iter 14), [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md), [Sensor Calibration and Time Synchronization](../../../10-knowledge-base/geometry-3d/sensor-calibration-time-synchronization.md) (iter 13).

**Last updated:** 2026-05-24

---

## What It Is

Continuous-time SLAM is a family of methods that represent the sensor trajectory as a smooth function of time `T(t) : R -> SE(3)` rather than a discrete sequence of poses `{T_k}`. Because `T(t)` can be evaluated at any query time, every measurement — whether a LiDAR point, an IMU reading, or a camera image — is associated with the pose at its exact acquisition timestamp.

The canonical modern representative is **CT-ICP** (Continuous-Time ICP, Dellenbach, Deschaud, Jacquet, Goulette; ICRA 2022), which uses two control poses per scan and linear SE(3) interpolation. The broader family includes B-spline systems (CLINS, Coco-LIC, SLICT2, LIO-MARS), Gaussian Process methods (STEAM, Barfoot et al.), and practical IMU-pre-integration approaches (FAST-LIO2) that achieve the same effect at IMU rate.

Continuous-time registration matters because spinning LiDARs are not instantaneous. A 10 Hz sensor takes **100 ms** to complete one 360-degree revolution. Treating the entire sweep as one rigid pose introduces systematic motion distortion that blurs maps, corrupts scan-matching correspondences, and degrades localization. Continuous-time methods correct this at the source rather than applying a separate deskew preprocessing step.

---

## Core Technical Idea

### Why Discrete-Time SLAM Is Wrong for Spinning LiDAR

Classical SLAM assigns one pose `T_k in SE(3)` per measurement epoch. For a camera at 30 Hz this is a reasonable approximation. For a spinning LiDAR it is structurally incorrect.

A 10 Hz spinning LiDAR (Velodyne HDL-64E, Ouster OS1) takes **100 ms** to complete one 360-degree revolution. The sensor fires each channel at a distinct per-point timestamp `t_i`. For a 64-channel sensor rotating at 600 RPM, successive firings are separated by roughly 2.3 microseconds. The first-fired point and the last-fired point in the same "scan" were acquired up to 100 ms apart.

If a single 4x4 SE(3) pose is assigned to the entire scan, every point is implicitly placed at that one pose. The positional smear is:

```
smear ≈ v * dt_sweep
```

At airside taxi speeds of 5-8 m/s (18-30 km/h), a 10 Hz LiDAR yields **50-80 cm of positional smear** across one scan. A straight taxiway centreline becomes a curved stripe; a curb appears doubled or blurred. This systematic error accumulates in long survey runs, making change detection harder and safety-case documentation less reliable.

The high-rate IMU problem is symmetric. IMU runs at 200-1000 Hz. A discrete-time filter that only queries IMU at LiDAR frame rate aliases the inertial signal and misses high-frequency events.

**Continuous-time SLAM** resolves both problems by representing the trajectory as `T(t)` and querying it at each point's exact acquisition timestamp.

See also: [Rolling-Shutter LiDAR Deskew and Motion Distortion](../../../10-knowledge-base/geometry-3d/rolling-shutter-lidar-deskew-motion-distortion.md) for the physics of spinning-LiDAR distortion.

### Formal Problem Statement

Given a sensor platform moving in SE(3) and a set of measurements `{(z_k, t_k)}` with precise timestamps, find the continuous trajectory `T(t)` that maximises the posterior:

```
T*(t) = argmax_T  p(T(t)) * prod_k p(z_k | T(t_k))
```

where `p(T(t))` is a smoothness prior on the trajectory (GP or spline regulariser) and `p(z_k | T(t_k))` is the measurement likelihood at the exact timestamp `t_k`.

In practice this is minimised as a nonlinear least squares problem:

```
min_theta  sum_k || r_k(T(t_k; theta)) ||^2_W  +  lambda * R(theta)
```

where `theta` are the trajectory parameters (control points or GP inducing points), `r_k` is the residual for measurement `k`, `W` is its information matrix, and `R(theta)` is the regularisation term.

The key architectural difference from discrete-time SLAM: `T(t_k; theta)` is queried at the measurement's exact time, not snapped to a grid. Jacobians of `r_k` with respect to `theta` must propagate through the trajectory parameterisation.

---

## Trajectory Parameterizations

### Linear SE(3) Interpolation (SLERP)

**The simplest continuous-time approximation.** Given two reference poses `T_a` at time `t_a` and `T_b` at time `t_b`, the pose at intermediate time `t` is:

```
s = (t - t_a) / (t_b - t_a)    in [0, 1]

T(t) = T_a * Exp(s * Log(T_a^{-1} * T_b))
```

Where:
- `Log : SE(3) -> se(3)` maps a group element to its Lie algebra tangent vector (a 6-vector `[omega; v]`)
- `Exp : se(3) -> SE(3)` is the matrix exponential mapping back to the group
- The product `T_a^{-1} * T_b` is the relative transform from `a` to `b`
- `s * Log(...)` scales that relative twist by fraction `s`

This is **SLERP on SE(3)** (screw-linear interpolation). It is exact for constant-velocity (uniform screw) motion; for non-uniform motion it is a first-order approximation.

**CT-ICP uses exactly this formula** with `T_a = T_begin` and `T_b = T_end` for each scan. **KISS-ICP's constant-velocity deskew** is a degenerate case: it uses the velocity estimated from two prior frames and extrapolates forward rather than interpolating between two known current-scan poses. This introduces error if motion is non-constant between frames. See [KISS-ICP](./kiss-icp.md) for full detail.

See also: [Lie Groups SE(3)/SO(3) and Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md).

### B-Spline on SE(3) Lie Group

**The gold-standard continuous-time parameterisation.** Rather than two control poses per scan, a set of **control points** `{T_m}` (SE(3) elements) distributed over time parameterise the full trajectory via B-spline basis functions.

**Furgale, Tong, Barfoot, Sibley (IJRR 2015)** — "Continuous-Time Batch Trajectory Estimation Using Temporal Basis Functions" — is the canonical formulation. It extends classical B-splines from Euclidean space to Lie groups by working in the Lie algebra.

**Uniform B-spline on SE(3) (cumulative form, order 4):**

```
T(u) = T_0 * Exp(B_1(u) * Log(T_0^{-1} * T_1))
           * Exp(B_2(u) * Log(T_1^{-1} * T_2))
           * Exp(B_3(u) * Log(T_2^{-1} * T_3))
```

Where `u` is the normalised parameter within a knot interval, `B_i(u)` are **cumulative** B-spline basis functions (not the standard ones), and `T_0, T_1, T_2, T_3` are the four control points for a cubic spline interval.

For cubic (order 4) B-splines, the cumulative blending matrices encode `C^2` continuity — smooth position, velocity, and acceleration at all times. Velocity and acceleration come for free by differentiating the spline.

**Knot spacing choices:**
- **Uniform:** constant interval `dt` between control points — simpler and predictable.
- **Non-uniform:** variable `dt` adapts to motion dynamics, placing more control points during aggressive motion. Coco-LIC and LIO-MARS use this approach.

**Sommer et al. (CVPR 2020 / arXiv:1911.08860)** — "Efficient Derivative Computation for Cumulative B-Splines on Lie Groups" — provides the standard implementation: `O(k)` instead of `O(k^2)` matrix operations for order-`k` splines. This work underlies Basalt (ETH), Coco-LIC, and most modern B-spline SLAM systems.

**IMU integration on splines.** Angular velocity and linear acceleration at time `t` are the first and second Lie-algebra derivatives of `T(t)`. IMU residuals compare these spline derivatives to the raw IMU measurements:

```
r_gyro(t_k)  = omega_spline(t_k) - omega_imu(t_k)
r_accel(t_k) = a_spline(t_k) - R_spline(t_k)^T * (a_imu(t_k) - g)
```

### Gaussian Process Priors on SE(3)

**The probabilistic continuous-time approach.** Barfoot, Tong, and Sarkka (RSS 2014 / Autonomous Robots 2015) — "Batch Continuous-Time Trajectory Estimation as Exactly Sparse Gaussian Process Regression" — reformulate SLAM as GP regression on SE(3).

**STEAM** (Simultaneous Trajectory Estimation And Mapping):
- Trajectory `T(t)` is a sample from a GP: `T(t) ~ GP(mu(t), K(t,t'))`
- The GP prior encodes smoothness via a covariance kernel (White-Noise-On-Acceleration / WNOA or White-Noise-On-Jerk / WNOJ)
- Posterior is conditioned on measurements at timestamps `{t_k}` to give a mean trajectory plus covariance

**Key advantages over B-splines:**
1. Principled uncertainty quantification: trajectory covariance is computed, not just a point estimate.
2. Sparse structure: the GP prior produces a block-tridiagonal information matrix — linear complexity in the number of support points.
3. No need to pre-specify knot spacing; the kernel encodes the motion model.

**GP interpolation (WNOA prior).** At any query time `t*` between support times `t_i` and `t_{i+1}`, the posterior mean trajectory is a closed-form function of the two neighbouring support poses and velocities. This enables **per-point pose queries at O(1) cost** once the GP is solved.

The STEAM open-source library (Barfoot Lab, UTIAS Toronto) implements exactly sparse GP regression on SE(3)/SO(3) for batch trajectory estimation and is used in continuous-time radar-inertial and LiDAR-inertial odometry at UTIAS.

### Discrete Poses + IMU Pre-integration

**Not strictly continuous-time, but practically equivalent at IMU rate.** Forster, Carlone et al. (TRO 2016) — "On-Manifold Preintegration for Real-Time Visual-Inertial Odometry" — pre-integrate IMU measurements between keyframe timestamps, forming a single relative motion constraint on `SO(3) x R^3` that can be reused when keyframe poses change without re-integration from raw IMU.

The result: within a LiDAR scan (~100 ms), IMU integration at 200-1000 Hz provides a piecewise trajectory at IMU rate. Each LiDAR point is deskewed by querying the nearest IMU-integrated pose.

**FAST-LIO2** uses backward IMU propagation: starting from the predicted end-of-scan state, the IMU is integrated backward to each point's timestamp, yielding per-point transforms before the IEKF registration step. This is a **practical approximation to continuous-time** that is very accurate when the IMU rate is much higher than the LiDAR rate and IMU noise is low. See [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md).

---

## Operator Mathematics

The key operators used in all SE(3) continuous-time work:

| Symbol | Space | Meaning |
|--------|-------|---------|
| `T in SE(3)` | 4x4 matrix | Rigid body pose: rotation `R in SO(3)` + translation `t in R^3` |
| `xi in se(3)` | 6-vector | Lie algebra element: `[omega; v]` — angular and linear velocity |
| `Log(T)` | SE(3) -> se(3) | Matrix logarithm; maps group element to algebra |
| `Exp(xi)` | se(3) -> SE(3) | Matrix exponential; maps algebra to group |
| `xi^hat` | 4x4 skew | Hat map: converts `xi` 6-vec to 4x4 se(3) element |
| `J_l(xi)` | 6x6 | Left Jacobian of SE(3); needed for exact perturbation |

**SE(3) interpolation (geodesic / SLERP):**

```
T(s) = T_a * Exp(s * Log(T_a^{-1} * T_b)),   s in [0,1]
```

This is the formula used by CT-ICP for per-point deskew. The Jacobian of the interpolated pose with respect to the control poses propagates through the Exp/Log via chain rule. At `s = 0`, full sensitivity is to `T_a`; at `s = 1`, full sensitivity is to `T_b`. Early-scan points constrain `T_begin`; late-scan points constrain `T_end`.

**B-spline on SE(3) (cumulative, order 4):**

```
T(u) = T_0 * prod_{j=1}^{3} Exp(B_j(u) * Log(T_{j-1}^{-1} * T_j))
```

where `B_j(u)` are cumulative basis functions (not standard B-spline basis).

**GP interpolation (WNOA prior).** Between support states `(T_i, xi_i)` and `(T_{i+1}, xi_{i+1})` at times `t_i` and `t_{i+1}`:

```
T(t*) = T_i * Exp(Phi(t*,t_i) * Log(T_i^{-1} * T_{i+1}))   [simplified]
```

Exact form requires the transition matrix `Phi` and GP interpolation coefficients (Lambda, Psi) — see Barfoot RSS 2014 for closed-form expressions.

**Per-point Jacobian structure.** For a point-to-plane residual `r_i = n_i^T * (T(t_i) * p_i - m_i)`, the Jacobian with respect to trajectory parameters `theta` is:

```
dr_i / d_theta = n_i^T * d(T(t_i) * p_i) / d_theta
               = n_i^T * [d T(t_i)/d_theta] * p_i
```

For the two-pose CT-ICP parameterisation:

```
dT(t_i) / d(T_end)   ≈ (1 - s_i) * dT_end      [simplified; exact uses left/right SE(3) Jacobians]
dT(t_i) / d(T_begin) ≈  s_i      * dT_begin
```

The residual stack across all `N` points in a scan is solved jointly by Gauss-Newton or Levenberg-Marquardt.

---

## CT-ICP Deep Dive

**Dellenbach, P., Deschaud, J.-E., Jacquet, B., Goulette, F.**
"CT-ICP: Real-time Elastic LiDAR Odometry with Loop Closure."
*IEEE ICRA 2022*, Philadelphia, May 2022. Outstanding Paper Award finalist.
arXiv: 2109.12979. GitHub: https://github.com/jedeschaud/ct_icp

### Core Idea

CT-ICP introduces **combined continuity intra-scan and discontinuity inter-scan**:
- **Within each scan:** the trajectory is continuous — parameterised by exactly two control poses `T_begin` and `T_end`, with linear SE(3) interpolation for all points in between.
- **Between consecutive scans:** the trajectory is discontinuous — `T_end` of scan `k` is linked to `T_begin` of scan `k+1` only via a soft proximity constraint, not rigid equality. This "elastic" connection allows the optimizer to jointly adjust both scans' poses without enforcing strict inter-scan continuity.

This is a deliberate engineering trade-off: two poses per scan is the minimum needed for per-point deskew with zero added complexity beyond vanilla ICP, while the elastic discontinuity enables robustness to degeneracy (featureless tunnels, highways) without requiring a full sliding-window graph.

### Trajectory Parameterisation

For scan `k`, the two control poses are `T_begin^k` (start of scan k) and `T_end^k` (end of scan k), both in SE(3).

For each point `p_i` with per-point timestamp `t_i in [t_begin^k, t_end^k]`:

```
s_i = (t_i - t_begin^k) / (t_end^k - t_begin^k)    in [0, 1]

T(t_i) = T_begin^k * Exp(s_i * Log((T_begin^k)^{-1} * T_end^k))
```

The relative twist `xi = Log(T_begin^{-1} * T_end)` is a 6-vector (3 angular + 3 linear). At fraction `s_i` along the trajectory, the world-frame position of point `p_i` is:

```
q_i = T(t_i) * p_i_sensor
```

### ICP Residual and Optimisation

CT-ICP uses **point-to-plane** residuals:

```
r_i = n_i^T * (q_i - m_i)
```

where `n_i` is the local plane normal at map point `m_i` (nearest neighbour in the voxel map).

The full cost over all `N` points in the scan:

```
E(T_begin, T_end) = sum_{i=1}^{N} w_i * (n_i^T * (T(t_i; T_begin, T_end) * p_i - m_i))^2
```

Plus a **proximity constraint** between `T_end^{k-1}` and `T_begin^k` (soft equality, weighted by velocity covariance) to discourage discontinuities that exceed expected inter-scan motion.

Optimisation via Gauss-Newton or LM, typically 4-6 outer ICP iterations. The per-point Jacobians are accumulated into the Hessian block for the 12-DOF state `(T_begin, T_end)`.

### Map Structure

CT-ICP accumulates map points in a **sparse voxel hash map** (similar to KISS-ICP's iVox or VoxelMap). Each voxel stores a small set of recent points and a precomputed plane normal. The hash map enables O(1) average-case nearest-neighbour lookup per point.

### Loop Closure

CT-ICP completes the SLAM by adding loop closure via **elevation-image 2D matching**: projects the 3D map into a 2D bird's-eye intensity/elevation image and performs template matching for place recognition. Loop constraints are added to a pose graph solved via G2O or Ceres.

See [Loop Closure and Place Recognition](./loop-closure-place-recognition.md) for alternative descriptors.

---

## Other Implementations

### KISS-ICP — Degenerate CT (Constant-Velocity Deskew)

KISS-ICP (Vizzo et al., RA-L 2023) applies per-point deskew using the constant-velocity model derived from two prior frame poses:

```
p_i* = Exp(s_i * omega_t) * p_i + s_i * v_t
```

where `omega_t, v_t` are estimated from the previous inter-frame delta and `s_i in [0,1]` is the fractional timestamp within the current scan. This is an **extrapolation** using last-known velocity, not interpolation between two known current-scan poses. For smooth motion (highway, taxiway) the approximation is accurate; for aggressive turns or sudden braking it degrades faster than CT-ICP.

KITTI avg relative translation error: **0.54%** (MAD-ICP comparison table). Runtime: 38-51 Hz CPU-only, single thread.

See [KISS-ICP](./kiss-icp.md) for the full method treatment.

### FAST-LIO2 — IMU Pre-integration as Practical CT

FAST-LIO2 (Xu, Cai et al., T-RO 2022) uses backward IMU propagation to deskew each LiDAR scan: starting from the predicted end-of-scan state, the IMU is integrated backward to each point's timestamp `t_k`, yielding per-point transform `T_scan->world(t_k)`. At IMU rates of 200-1000 Hz, this is functionally equivalent to continuous-time at IMU rate.

This is not a B-spline or GP — it is discrete keyframes plus high-rate IMU interpolation between them. The practical accuracy is very high when IMU noise is low and rate is high.

Runtime: real-time on Orin/ARM embedded boards.

See [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) for the full treatment.

### B-Spline VIO (Furgale et al. / OKVIS-CT)

Cubic B-spline trajectory on SE(3); control points at fixed intervals; IMU residuals from spline derivatives; visual reprojection at exact image timestamps.

Not real-time in original batch form — primarily used for offline calibration (Kalibr) and high-accuracy post-processing. B-spline VIO produces the highest-accuracy trajectory for HD-map post-processing and is used as a reference trajectory in professional survey workflows.

Paper: Mo & Sattar, "Continuous-Time Spline VIO," arXiv:2109.09035. Furgale canonical paper: IJRR 2015.

### CLINS — Continuous-Time LiDAR-IMU SLAM

CLINS (Lv et al., IROS 2021; arXiv:2109.04687) implements true continuous-time LiDAR-IMU SLAM using 4th-order (cubic) B-splines on SO(3) x R^3. Each point's pose is queried from the B-spline at its exact timestamp — non-rigid scan registration. Uses sliding-window optimisation and also includes a two-state continuous-time correction method for loop closure.

Outperforms discrete-time methods on aggressive motion sequences.

Code: https://github.com/APRIL-ZJU/clins

### Coco-LIC — Non-Uniform B-Spline LiDAR-Inertial-Camera

Coco-LIC (Lv et al., RA-L 2023; arXiv:2309.09808) uses **non-uniform B-splines** for continuous-time tightly-coupled LiDAR-Inertial-Camera odometry. Non-uniform knot spacing places control points adaptively — more densely during fast motion — avoiding both the delay of uniform splines and over-parameterisation in slow sections. IMU, LiDAR point-to-map, and visual reprojection factors are all evaluated at exact timestamps.

Outperforms uniform-spline methods (CLIC) on dynamic sequences.

Code: https://github.com/APRIL-ZJU/Coco-LIC

See [CLIC / Coco-LIC](./clic-coco-lic.md) for the full method treatment.

### CLIC — Continuous-Time Fixed-Lag Smoothing

CLIC (Lv et al., 2022; https://github.com/APRIL-ZJU/clic) is the first system to use a continuous-time fixed-lag smoother with proper probabilistic marginalisation for LiDAR-Inertial-Camera SLAM and online time offset calibration between sensors. It is the predecessor to Coco-LIC.

See also: [Sensor Calibration and Time Synchronization](../../../10-knowledge-base/geometry-3d/sensor-calibration-time-synchronization.md).

### SLICT2 — Linear-Solver CT LIO

SLICT2 (arXiv:2402.02337) is multi-input multi-scale surfel-based LiDAR-Inertial continuous-time odometry and mapping. Its key innovation: uses an Eigen-based linear solver instead of Ceres/GTSAM — achieving up to **8x faster** solving than NLS-based CT systems while coupling feature association immediately after each optimisation step. Trajectory: uniform cubic B-spline on SE(3) with dense control points. Real-time on aggressive handheld and aerial sequences.

### DLIO — Coarse-to-Fine IMU CT

DLIO (Chen et al., ICRA 2023; arXiv:2203.03749) performs direct LiDAR-Inertial Odometry with continuous-time motion correction via coarse-to-fine IMU integration. Analytical equations parameterised solely by time enable fast parallel per-point deskewing without B-splines — instead relying on a nonlinear geometric observer plus IMU integration. Reports approximately **20% better computational efficiency** and **12% accuracy improvement** versus prior state-of-the-art.

### LIO-MARS — Non-Uniform B-Spline + GMM Surfel

LIO-MARS (Quenzel & Behnke; arXiv:2511.13985; 2025) advances the state of the art with non-uniform B-spline CT LiDAR-Inertial odometry combined with Gaussian Mixture Model (GMM) surfel alignment. Key innovations: non-uniform knot placement for real-time without scan delay; Kronecker product acceleration providing a **3.3x speedup** for covariance/GMM computation; unscented transform for surfel deskewing. Evaluated on handheld, ground, and aerial vehicle datasets.

---

## Comparison with Discrete-Time + Deskew

| Aspect | True Continuous-Time (CT-ICP, CLINS, Coco-LIC) | Discrete-Time + Deskew (KISS-ICP, early FAST-LIO2) |
|--------|------------------------------------------------|-----------------------------------------------------|
| Trajectory model | Joint estimation of trajectory params and measurement residuals | Separate: prior deskew, then rigid ICP |
| Deskew accuracy | Joint refinement — deskew improves as pose estimate improves | Fixed prior — errors in velocity estimate propagate to deskew |
| Aggressive motion | Handles well; each point has individual pose | Degrades; constant-velocity assumption breaks |
| Parameters | More (12+ DOF per scan vs. 6) | Fewer (6 DOF per scan) |
| Compute | Higher: Jacobians through interpolation | Lower: standard 6-DOF ICP Jacobians |
| Embedded suitability | Moderate; CT-ICP 60 ms/scan on laptop CPU | High; KISS-ICP <30 ms, runs on Jetson |
| Implementation complexity | High | Low |
| Map quality (survey-grade) | Superior: joint optimisation removes systematic scan-shear bias | Good for most cases; residual shear at high speed |

**Key insight.** Discrete-time plus deskew works well when the motion model (constant velocity or IMU pre-integration) is accurate. It becomes a poor approximation when:
1. Motion is highly non-uniform (aggressive braking, sharp turns).
2. The deskew velocity estimate is stale (LiDAR-only, no IMU).
3. The scan duration is long (10 Hz sensor, fast vehicle).

For airside survey drives at 10-20 km/h with a 10 Hz LiDAR, both approaches work, but CT-ICP-class deskew eliminates a systematic bias source that accumulates in long survey runs.

---

## Trade-offs

### Parameter Count

| System | DOF per scan | Notes |
|--------|-------------|-------|
| KISS-ICP | 6 | One rigid pose |
| CT-ICP | 12 | Two rigid poses |
| CLINS / Coco-LIC | 6 x N_cp | N_cp control points in sliding window (typically 4-10 per scan interval) |
| GP/STEAM | 12 x N_support | Pose + velocity at each support time |

More parameters require more data to constrain and increase degeneracy risk in featureless environments (tunnels, open aprons).

### Compute Budget

For Orin-class hardware (~275 TOPS, limited CPU cores):
- KISS-ICP: <30 ms/scan — safely real-time at 10 Hz, leaves headroom.
- CT-ICP: ~60 ms/scan single-threaded — marginal at 10 Hz; GPU acceleration or multi-threading reduces this.
- CLINS / Coco-LIC: typically 100-200 ms/scan without hardware acceleration; requires careful implementation for embedded real-time. (Unverified from primary sources.)
- GP/STEAM: typically offline or near-offline; not real-time without sparse approximations.

### Motion Robustness

| Scenario | Constant-vel deskew | CT-ICP (2-pose) | B-spline CT (full) |
|----------|--------------------|-----------------|--------------------|
| Highway, constant speed | Good | Good | Good |
| Airport taxiway, slow turn | Acceptable | Good | Good |
| Aggressive braking / acceleration | Degrades | Good | Best |
| Handheld, running | Poor | Acceptable | Good (with IMU) |
| IMU unavailable | OK | Good | Not applicable (needs IMU) |

### Embedded Deployment

KISS-ICP is the practical choice for embedded (Jetson Orin, Xavier) LiDAR-only odometry. CT-ICP is deployable with careful optimisation. Full B-spline systems (CLINS, Coco-LIC) are typically run on server-class CPUs or offline. SLICT2's linear solver reduces this gap significantly.

---

## Benchmark Results

### KITTI Odometry (Sequences 00-10)

Metric: Average Relative Pose Error (RPE), translation percentage.

| Method | Type | Avg Trans Error | Source |
|--------|------|-----------------|--------|
| CT-ICP | LiDAR-only CT | 0.53-0.59% | MAD-ICP table; arXiv:2109.12979 |
| KISS-ICP | LiDAR-only const-vel | 0.54% | MAD-ICP comparison table |
| MULLS | LiDAR-only feature | ~0.60% | MAD-ICP table |
| F-LOAM | LiDAR-only feature | ~1.25% | MAD-ICP table |
| MAD-ICP | LiDAR-only | 0.82% | arXiv:2405.05828 |

CT-ICP is first among publicly-available-code methods on the KITTI leaderboard (accessed 2022-2024). KISS-ICP's simple design achieves near-identical accuracy on this dataset, demonstrating that for automotive-speed highway sequences with smooth motion, constant-velocity deskew is nearly as good as full CT.

### Newer College Dataset (Handheld, Oxford)

Handheld sequences with aggressive motion (running, stairs, narrow corridors). IMU-aided methods significantly outperform LiDAR-only here. CT methods with proper IMU integration (CLINS, Coco-LIC, DLIO) show the largest advantages. Specific RPE numbers for CT methods on NCD were not directly verified from primary sources. (Flagged: secondary literature only.)

### Hilti SLAM Challenge 2022 (Construction Site)

Mixed construction-site sequences; handheld plus tripod. Sensor: Hesai PandarXT-32 plus IMU.

- The NPM3D team submitted a CT-ICP variant (Dellenbach et al., same group): ranked **7th overall** out of approximately 50 teams.
- Their method is described in the Hilti report as: "scans are deformed elastically to align with the map by the joint optimisation of two poses at the start and end of the scan and interpolation according to the timestamp."
- Best LiDAR-based solution achieved 16x more consistent point coverage than vision-based solutions.

### MulRan Dataset (Urban / Tunnel, Velodyne VLP-64)

Challenging urban environments. CT-ICP competitive across sequences; exact numbers vary by sequence. The MAD-ICP paper (arXiv:2405.05828) provides the most direct head-to-head table across KITTI, MulRan, Newer College, and Hilti 2021.

---

## Inputs and Outputs

| Item | Description |
|---|---|
| **Input** | Stream of 3D LiDAR scans with per-point timestamps; IMU measurements (for IMU-aided CT variants) |
| **Output: trajectory T(t)** | Continuous-time trajectory or discrete control poses evaluated per scan |
| **Output: scan-end pose T_k** | Representative SE(3) odometry pose at each scan (for downstream factor graph) |
| **Output: local map** | Voxel hash map or surfel map updated with deskewed scan points |
| **Derived output** | Aggregated point cloud: each raw scan transformed by its per-point `T(t_i)` into a common frame |

---

## Architecture

```
Input scan (raw PointCloud2, per-point timestamps)
  |
  v
[1] Trajectory prediction
    - CT-ICP: constant-velocity from previous T_begin/T_end pair
    - CLINS/Coco-LIC: B-spline extrapolation from sliding-window control points
    - FAST-LIO2: IMU forward propagation to scan end, then backward to each point
  |
  v
[2] Per-point pose interpolation
    - Evaluate T(t_i) for each point using parameterisation
    - CT-ICP: T(t_i) = T_begin * Exp(s_i * Log(T_begin^{-1} * T_end))
    - B-spline: T(u_i) = cumulative product of Exp(B_j * Log(...)) terms
    - IMU CT: T(t_i) from backward IMU integration at point timestamp
  |
  v
[3] Point transformation and correspondence search
    - q_i = T(t_i) * p_i_sensor
    - Find nearest neighbour in voxel hash map
    - Compute plane normal n_i at corresponding map point
  |
  v
[4] Residual construction
    - r_i = n_i^T * (q_i - m_i)    [point-to-plane]
    - Weight by robust kernel, range, and normal quality
    - Stack Jacobians dr_i/d(T_begin, T_end) for all points
  |
  v
[5] Trajectory optimisation (Gauss-Newton or LM)
    - Solve for delta(T_begin, T_end) from stacked Jacobian / residual
    - Apply SE(3) update multiplicatively
    - Add proximity constraint to previous scan's T_end
    - Iterate 4-6 times until convergence
  |
  v
[6] Map update
    - Insert deskewed scan points into voxel hash map
    - Evict voxels outside sliding window
  |
  v
Output: T_end (odometry pose), T_begin, T_end (control poses), updated local map
```

---

## Strengths

- **Eliminates systematic scan-shear bias.** Per-point pose interpolation removes the dominant error source in spinning-LiDAR odometry, producing geometrically correct correspondences.
- **Sensor-rate agnostic.** Works at any LiDAR rate without changing the algorithm; the 100 ms sweep is correctly modelled regardless of platform speed.
- **No IMU required (CT-ICP class).** CT-ICP achieves KITTI SOTA with LiDAR only, making it suitable for platforms without IMU or where IMU calibration is unreliable.
- **Survey-grade map quality.** Joint optimisation of trajectory and correspondences removes the per-scan bias that accumulates in long survey runs; see Aggregated-Map Suitability below.
- **Extensible to multi-sensor.** The trajectory `T(t)` can simultaneously explain LiDAR, IMU, visual, and wheel measurements at their respective timestamps — the unifying principle behind CLINS, Coco-LIC, and STEAM.
- **Principled uncertainty (GP/STEAM).** The full posterior covariance over the trajectory is available for safety-case documentation and sensor fusion quality monitoring.

---

## Failure Modes

### Geometric Degeneracy

More trajectory DOF means more data is required to constrain them. In featureless environments (tunnels, open aprons, long straight taxiways), the start and end poses may not be separately observable, causing elastic overfit — the scan deforms toward dynamic objects or map noise rather than the correct trajectory.

Handling: limit trajectory DOF, add motion priors from IMU or wheel odometry, use Hessian eigenvalue monitoring for the full trajectory block rather than just the representative pose.

### Time-Motion Ambiguity

A clock offset error or per-point timestamp corruption can mimic a velocity error in the trajectory. The solver cannot distinguish between "the platform was moving faster" and "the timestamps are wrong." Residual monitoring plotted against point time (not space) is the primary diagnostic. See [Sensor Calibration and Time Synchronization](../../../10-knowledge-base/geometry-3d/sensor-calibration-time-synchronization.md).

### Aggressive Initialisation Sensitivity

With 12 or more DOF per scan, the optimiser can converge to a poor local minimum if the trajectory prediction is far from truth. KISS-ICP's single 6-DOF pose is a more stable basin of attraction. Good initialisation from IMU or prior frame velocity is essential.

### Embedded Compute Cost

CT-ICP at 60 ms/scan on a laptop CPU is marginal for 10 Hz real-time on embedded hardware without optimisation. Full B-spline systems (CLINS, Coco-LIC) are typically not real-time on Orin without careful implementation. SLICT2's linear solver and DLIO's analytical integration are specifically designed to address this.

### Map Feedback Contamination

If corrected scans are inserted into the map immediately, a wrong trajectory estimate can pollute the map and become self-reinforcing across iterations. Do not insert scans when trajectory covariance or dynamic-object residuals are high.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| High-speed roads | Very high | Within-scan displacement can be large; CT is most beneficial |
| Urban driving | High | Turns and vibration create distortion; rich structure supports estimation |
| Indoor handheld | Very high | Rapid rotations make rigid scans poor; CT recovers structure |
| Warehouses | Medium-high | Low speed but tight turns and vibration from pavement and loads matter |
| Mines / tunnels | High | Vehicle motion and rough terrain distort scans; along-axis degeneracy remains; limit DOF |
| Airside — terminal / gate zones | High | Rich vertical geometry; tight turns near stands make deskew valuable |
| Airside — open apron | Conditional | Less geometric support; extra trajectory DOF should be strongly regularised or disabled |
| Airside — survey mapping | Very high | CT eliminates systematic scan-shear accumulation in long runs |
| Drone / aerial survey | Conditional | CT helps with aggressive manoeuvres; IMU required for B-spline variants |
| Port / logistics yard | Good | Mixed structured/open; CT helps on ramps and tight turns |
| Agriculture / construction | Good | Rough terrain distorts scans; B-spline CT with IMU is well-suited |

---

## Aggregated-Map Suitability

In a map-construction pipeline for airside HD maps, continuous-time registration quality has a three-tier hierarchy:

**Tier 1 — SAFETY-CASE-GRADE survey maps (certification-quality):**

CT-ICP-class continuous-time is the **recommended front-end** for survey drives whose output feeds a formal safety case (EASA regulatory submission, aerodrome operator certification). CT deskew eliminates the systematic per-scan shear bias that accumulates in long runs and makes map blur and change detection harder. This should be combined with a GNSS-aided back-end for absolute accuracy.

Pipeline:
```
Survey LiDAR scan stream (per-point timestamps)
  -> CT-ICP (real-time front-end, 60 ms/scan, no IMU required)
  -> Pose graph back-end (g2o, GTSAM)
  -> GNSS/RTK georeferencing
  -> Aggregated dense map
  -> Dynamic removal (ERASOR, FreeDOM)
  -> Semantic segmentation
```

**Tier 2 — FAST-LIO2 (practical IMU-tight CT, non-certification ops):**

FAST-LIO2 with IMU pre-integration is acceptable for non-certification operational mapping where IMU is available and accurately calibrated. The backward IMU propagation achieves functionally CT-equivalent deskew at IMU rate (~200 Hz), and the IEKF produces per-pose covariance for factor-graph fusion. For airside speeds and typical vibration profiles, FAST-LIO2's accuracy is very close to full B-spline CT.

See [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) for implementation notes.

**Tier 3 — KISS-ICP (OPERATIONAL non-certification runs at taxiway speeds):**

KISS-ICP constant-velocity deskew is **adequate for operational (non-certification) mapping at taxiway speeds** (5-8 m/s) where motion is smooth and IMU is unavailable. The constant-velocity assumption holds well in straight taxiway segments. However, KISS-ICP should not be used as the sole front-end for safety-case maps without explicit validation that residual scan-shear does not affect the safety-case metrics.

For short-range, single-session scans under approximately 300 m, KISS-ICP standalone is a defensible and practical choice.

**Honest assessment.** For production survey drives over a full airport apron or runway (1+ km), the practical hierarchy is: CT-ICP front-end plus pose graph plus GNSS for certification work; FAST-LIO2 plus GNSS for operational work; KISS-ICP plus GNSS for short operational scans where no CT system is available.

See [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) for the downstream pipeline that these maps feed.

---

## Implementation Notes

- **Preserve per-point timestamps in the driver.** Continuous-time registration is disabled or incorrect if timestamps are missing, quantised to frame rate, or incorrectly ordered. Validate LiDAR clock synchronisation and packet ordering before deployment. See [Sensor Calibration and Time Synchronization](../../../10-knowledge-base/geometry-3d/sensor-calibration-time-synchronization.md).

- **Set max trajectory DOF to match scene complexity.** In feature-poor environments (open apron, long straight taxiway), reduce to 2 control poses per scan (CT-ICP style) or even disable CT and use KISS-ICP. Additional DOF require additional geometric support.

- **Monitor residuals as a function of point time.** A monotonic trend in residual vs. point timestamp indicates deskew error or timing bias rather than a pose estimation problem. This is the primary diagnostic for CT-specific failure modes.

- **Use a robust motion prior.** Even LiDAR-only CT systems benefit from a proximity constraint between consecutive scan control poses. This acts as a soft motion model and prevents the optimiser from overfitting dynamic objects.

- **For airside multi-LiDAR rigs:** each sensor has its own per-point timestamps and acquisition window. The CT framework extends naturally to multi-LiDAR by querying `T(t_i)` for each sensor's point `i` at its timestamp; but per-sensor clock offsets and extrinsic calibration must be validated independently. See [Sensor Calibration and Time Synchronization](../../../10-knowledge-base/geometry-3d/sensor-calibration-time-synchronization.md).

- **Loop closure is not included in CT-ICP core.** For full SLAM, pair CT-ICP with a loop-closure backend (elevation-image matching as in CT-ICP's own loop closure module, or [Loop Closure and Place Recognition](./loop-closure-place-recognition.md) for learned alternatives). Without loop closure, drift accumulates over long traversals.

- **For covariance output:** CT-ICP and KISS-ICP do not output per-pose covariance by default. Approximate covariance from the Hessian of the final Gauss-Newton step. GP/STEAM produces analytical posterior covariance, which is the preferred choice when covariance is needed for safety-case documentation.

- **CT-ICP C++ integration:** the repository (`jedeschaud/ct_icp`, open-source) exposes both a ROS-compatible pipeline and a standalone C++ library. The Kitware/pyLiDAR-SLAM ecosystem provides Python bindings and dataset tooling.

---

## Sources

- Dellenbach, P., Deschaud, J.-E., Jacquet, B., and Goulette, F. (2022). "CT-ICP: Real-time Elastic LiDAR Odometry with Loop Closure." ICRA. DOI: `10.1109/ICRA46639.2022.9811849`; arXiv: 2109.12979. https://arxiv.org/abs/2109.12979
- CT-ICP repository (open-source C++): https://github.com/jedeschaud/ct_icp
- Kitware CT-ICP overview: https://www.kitware.com/presenting-ct-icp-a-kitware-europe-state-of-the-art-lidar-only-odometry-and-mapping-presented-at-icra-2022/
- NPM3D Hilti 2022 report (CT-ICP variant, 7th place): https://hilti-challenge.com/assets/2022/leaderboard/7/report.pdf
- Furgale, P., Tong, C.-H., Barfoot, T., Sibley, G. (2015). "Continuous-Time Batch Trajectory Estimation Using Temporal Basis Functions." IJRR. https://journals.sagepub.com/doi/10.1177/0278364915585860
- Sommer, C. et al. (2020). "Efficient Derivative Computation for Cumulative B-Splines on Lie Groups." CVPR. arXiv: 1911.08860. https://arxiv.org/abs/1911.08860
- Barfoot, T., Tong, C.-H., Sarkka, S. (2014). "Batch Continuous-Time Trajectory Estimation as Exactly Sparse GP Regression." RSS 2014. https://www.roboticsproceedings.org/rss10/p01.pdf
- Barfoot, T. (2015). "State Estimation for Robotics." Autonomous Robots. https://link.springer.com/article/10.1007/s10514-015-9455-y
- Dong, J., Boots, B., Dellaert, F. (2017). "Sparse GP Continuous-Time Trajectory Estimation on Lie Groups." arXiv: 1705.06020. https://arxiv.org/pdf/1705.06020
- Forster, C., Carlone, L. et al. (2016). "On-Manifold Preintegration for Real-Time Visual-Inertial Odometry." TRO. arXiv: 1512.02363. https://arxiv.org/pdf/1512.02363
- Lv, J. et al. (2021). "CLINS: Continuous-Time Trajectory Estimation for LiDAR-Inertial System." IROS. arXiv: 2109.04687. https://arxiv.org/abs/2109.04687
- Lv, J. et al. (2023). "Coco-LIC: Continuous-Time Tightly-Coupled LiDAR-Inertial-Camera Odometry using Non-Uniform B-spline." RA-L. arXiv: 2309.09808. https://arxiv.org/abs/2309.09808
- SLICT2: arXiv: 2402.02337. https://arxiv.org/abs/2402.02337
- Chen, K. et al. (2023). "DLIO: Direct LiDAR-Inertial Odometry." ICRA. arXiv: 2203.03749. https://arxiv.org/abs/2203.03749
- Quenzel, J. and Behnke, S. (2025). "LIO-MARS." arXiv: 2511.13985. https://arxiv.org/abs/2511.13985
- Mo, J. and Sattar, J. (2021). "Continuous-Time Spline VIO." arXiv: 2109.09035. https://arxiv.org/pdf/2109.09035
- Continuous-Time State Estimation Survey (2025). arXiv: 2411.03951. https://arxiv.org/abs/2411.03951
- GP vs. Spline CT Comparative Study (2024). arXiv: 2402.00399. https://arxiv.org/pdf/2402.00399
- MAD-ICP benchmark table (cross-dataset LO comparison). arXiv: 2405.05828. https://arxiv.org/abs/2405.05828
- Hilti SLAM Challenge 2022 leaderboard: https://hilti-challenge.com/leader-board-2022.html
- Hilti SLAM Challenge 2023 benchmark paper: arXiv: 2404.09765. https://arxiv.org/html/2404.09765v2
- Vizzo, I. et al. (2023). "KISS-ICP." RA-L. arXiv: 2209.15397. https://arxiv.org/abs/2209.15397. See also: `./kiss-icp.md`
- Xu, W. et al. (2022). "FAST-LIO2." T-RO. arXiv: 2107.06829. See also: `./fast-lio-fast-lio2.md`
- STEAM library (Barfoot Lab, UTIAS): https://github.com/utiasSTARS/steam
- Bosse, M. and Zlot, R. (2009). "Continuous 3D scan-matching with a spinning 2D laser." ICRA.
- Barfoot, T. (2024). "State Estimation for Robotics." Cambridge UP. https://www.cambridge.org/core/books/state-estimation-for-robotics/AC0E0AC229C55203B3C8F106BCB61F48
