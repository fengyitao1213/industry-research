# CLIC and CoCo-LIC

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method-family"
  stage: "modern-core"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "runtime-localization", "outdoor"]
  reason: "CLIC and CoCo-LIC is rated for LiDAR odometry, mapping, or scan-matching coverage in AV localization stacks."
method-priority:end -->

Related method pages: [Continuous-Time Registration](./continuous-time-registration.md) (iter 36, CT-ICP, CLINS, B-spline foundations), [FAST-LIVO and FAST-LIVO2](./fast-livo-fast-livo2.md) (iter 22, discrete-time LIC comparator), [KISS-ICP](./kiss-icp.md) (iter 20), [KISS-SLAM](./kiss-slam.md) (iter 32), [CT-ICP](./ct-icp.md), [LIO-SAM](./lio-sam.md), [Loop Closure and Place Recognition](./loop-closure-place-recognition.md) (iter 28), [LiDAR Bundle Adjustment Factors](./lidar-bundle-adjustment-factors.md) (iter 37).

Related overview pages: [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md).

Related KB pages: [Lie Groups SE(3)/SO(3) and Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) (iter 14), [Rolling-Shutter LiDAR Deskew and Motion Distortion](../../../10-knowledge-base/geometry-3d/rolling-shutter-lidar-deskew-motion-distortion.md) (iter 13), [Sensor Calibration and Time Synchronization](../../../10-knowledge-base/geometry-3d/sensor-calibration-time-synchronization.md) (iter 13).

**Last updated:** 2026-05-24

---

## What It Is

**CLIC** and **CoCo-LIC** are a closely related pair of continuous-time multimodal SLAM systems from the **APRIL Lab** (Autonomous Perception and Robotics Intelligent Lab) at **Zhejiang University (ZJU)**, China. Both are GPL-3.0 open-source.

| System | Full title | Authors (first / PI) | Venue | arXiv | GitHub |
|--------|-----------|---------------------|-------|-------|--------|
| CLIC | Continuous-Time Fixed-Lag Smoothing for LiDAR-Inertial-Camera SLAM | Jiajun Lv / Xingxing Zuo | IEEE/ASME TMECH 2023 | [2302.07456](https://arxiv.org/abs/2302.07456) | [APRIL-ZJU/clic](https://github.com/APRIL-ZJU/clic) |
| CoCo-LIC | Continuous-Time Tightly-Coupled LiDAR-Inertial-Camera Odometry using Non-Uniform B-spline | Xiaolei Lang / Xingxing Zuo | IEEE RA-L 2023 | [2309.09808](https://arxiv.org/abs/2309.09808) | [APRIL-ZJU/Coco-LIC](https://github.com/APRIL-ZJU/Coco-LIC) |

The author crossover is direct: Jiajun Lv is first author of CLIC and co-author of CoCo-LIC; Xiaolei Lang is second author of CLIC and first author of CoCo-LIC. CoCo-LIC is the cited "successive work" of CLIC in the RA-L paper. The acronym CLIC is not expanded in the title; community reading is **C**ontinuous-time **LI**DAR-Inertial-**C**amera.

---

## Lineage

The APRIL Lab has produced a clean development arc sharing a common continuous-time B-spline engine:

```
Furgale, Tong, Barfoot, Sibley (IJRR 2015)
  Canonical B-spline CT SLAM on SE(3); cumulative basis functions.
    |
  Sommer et al. (CVPR 2020 / arXiv:1911.08860)
    Efficient O(k) Jacobians for order-k B-splines on Lie groups.
    |
  CLINS (Lv et al., IROS 2021 / arXiv:2109.04687)
    First APRIL CT system: LiDAR-IMU, uniform 4th-order B-spline,
    non-rigid per-point pose query, loop closure.
    No marginalisation — reprocesses raw data every step; 7-8x slower than CLIC.
    |
  CLIC (Lv et al., TMECH 2023 / arXiv:2302.07456)
    Extends CLINS to LiDAR-Inertial-Camera (LIC).
    Fixed-lag smoother + Schur-complement probabilistic marginalisation.
    Uniform cubic B-spline (control point spacing Dt = 0.03 s).
    Online time-offset calibration for camera and IMU.
    |
  CoCo-LIC (Lang et al., RA-L 2023 / arXiv:2309.09808)
    Replaces uniform knot spacing with IMU-motion-intensity-driven
    adaptive non-uniform B-splines.
    Replaces visual feature triangulation with frame-to-map LiDAR depth.
    ~3x faster per-step optimisation; better accuracy under aggressive motion.
```

For the broader CT family (CT-ICP, CLINS, GP/STEAM) see [Continuous-Time Registration](./continuous-time-registration.md).

---

## Core Technical Idea

Both systems represent the 6-DOF trajectory as a **continuous-time B-spline `T(t) : R -> SE(3)`** queryable at any timestamp. This is the defining departure from discrete-time LIC systems such as [FAST-LIVO2](./fast-livo-fast-livo2.md), which snap measurements to keyframes and deskew LiDAR points using a separately propagated IMU prior.

A typical LIC sensor suite has LiDAR at 10 Hz (100 ms per sweep, per-point timestamps), camera at 20-30 Hz, and IMU at 200-400 Hz. In CLIC/CoCo-LIC the IMU sample at `t_imu`, the camera frame at `t_cam`, and each LiDAR point at `t_pt` all contribute residuals to the **same factor-graph** evaluated at their exact timestamps. No IMU pre-integration is needed — the spline derivatives supply angular velocity and linear acceleration analytically.

**Differentiation from FAST-LIVO:**

| Aspect | CLIC / CoCo-LIC | FAST-LIVO / FAST-LIVO2 |
|--------|----------------|------------------------|
| Trajectory model | Continuous B-spline on SE(3) | Discrete ESIKF keyframes |
| IMU handling | Spline derivatives vs raw IMU | IMU pre-integration |
| Per-point deskew | Each point queries `T(t_pt)`; jointly refined with pose | Fixed backward IMU propagation prior |
| Scan deskew–pose coupling | Joint: deskew improves over LM iterations | Decoupled: fixed prior; errors propagate |
| Online time-offset calibration | Yes (CLIC) | Not in standard config |
| Optimiser | Levenberg-Marquardt (Ceres) | ESIKF |
| Compute | Higher | Lower |
| Real-time on embedded | Sub-real-time on i7-8700 (0.74-0.81x) | Yes — ARM RK3588 at 17 Hz |

---

## CLIC — Mechanism

### Trajectory and Window

CLIC uses a **uniform cubic (order-4) B-spline** with split representation — rotation on SO(3) and translation on R^3 separately. Control points are uniformly spaced at `Dt = 0.03 s`; the temporal sliding window spans four intervals (`η * Dt = 0.12 s`). A visual keyframe buffer holds 10 frames.

**Cumulative B-spline on SO(3):**

```
R(u) = R_{i-3}
       * Exp( B_1(u) * Log(R_{i-3}^{-1} * R_{i-2}) )
       * Exp( B_2(u) * Log(R_{i-2}^{-1} * R_{i-1}) )
       * Exp( B_3(u) * Log(R_{i-1}^{-1} * R_i    ) )
```

`u = (t - t_i) / Dt` is normalised time within a knot interval; `B_j(u)` are **cumulative** basis functions (cumulative sums of standard cubic B-spline basis from index `j` up). These ensure `C^2` continuity: smooth position, velocity, and acceleration everywhere.

**Translation:** `p(t) = sum_j b_j(u) * p_j` — standard Euclidean B-spline weighted sum.

### Fixed-Lag Smoothing and Marginalisation

The key innovation over CLINS is **Schur-complement probabilistic marginalisation**. When old control points leave the window, they are not discarded — raw measurements associated with removed states are compressed into a compact **prior factor** that encodes their accumulated information. Future steps inherit this without reprocessing raw data.

This bounds memory and computation regardless of trajectory length, while preserving measurement information (unlike naive truncation). CLIC runs the NTU-VIRAL `eee_01` sequence (397 s) in 295 s on i7-8700, versus CLINS at 1602 s — a 7-8x speedup from marginalisation alone.

### Multi-Modal Factor Graph

```
X_hat = argmin_X  [ r_imu + r_lidar + r_camera + r_prior ]
```

- **IMU `r_imu`:** Spline derivatives vs raw gyro/accelerometer at each IMU timestamp. No pre-integration.
- **LiDAR `r_lidar`:** Each point `p_L` at time `t_pt` transformed via `T(t_pt)` from the spline; point-to-plane distance to voxel map: `r_l = n_pi^T * T(t_pt) * p_L + d_pi`.
- **Camera `r_camera`:** Features triangulated across the 10-frame keyframe buffer; reprojection at exact frame time: `r_c = pi(T(t_cam) * p_landmark) - [u,v]^T`.
- **Prior `r_prior`:** Schur-complement prior from marginalised states.

Solver: Levenberg-Marquardt via Ceres.

### Online Time-Offset Calibration

CLIC estimates `t_offset_imu` and `t_offset_cam` online as optimisation state variables. Adjusting a time offset shifts which spline pose is queried for each measurement; the Jacobian propagates through the spline interpolation. Convergence from ±20 ms initialisation error to stable calibration takes approximately 3 seconds. See [Sensor Calibration and Time Synchronization](../../../10-knowledge-base/geometry-3d/sensor-calibration-time-synchronization.md).

---

## CoCo-LIC — Mechanism

### Adaptive Non-Uniform B-Splines

CLIC's uniform 30 ms spacing is simultaneously too dense during slow motion (unnecessary computation) and too sparse during fast motion (under-resolved trajectory). CoCo-LIC replaces the uniform grid with **IMU-motion-intensity-driven adaptive knot placement**.

Every 0.1 s, two intensity metrics are computed over accumulated IMU readings:

```
N_m = (1/n) * || sum_{i=1}^{n}  R_mi^{IG} * omega_mi^I  ||      (angular intensity)

N_a = (1/n) * || sum_{i=1}^{n}  (R_mi^{IG} * a_mi^I  -  g^G) ||  (linear-accel intensity)
```

The pair `(N_m, N_a)` indexes a lookup table that returns a control-point count `n_cp` for the interval. Fast aggressive motion yields higher `n_cp` (finer resolution); slow cruising yields lower `n_cp` (lower cost).

**Non-uniform cumulative B-spline on SO(3):**

```
R(t) = R_{i-k} * prod_{j=1}^{k}  Exp( lambda_j(t) * Log(R_{i-k+j-1}^{-1} * R_{i-k+j}) )
```

`lambda_j(t)` are the **non-uniform cumulative basis functions** derived from the de Boor-Cox algorithm at the local knot spacings — replacing CLIC's fixed uniform `B_j(u)`. The structural form is identical; the mathematics differ because `lambda_j` depends on locally variable knot spacing.

### Frame-to-Map Camera Integration

Rather than triangulating visual features over a multi-frame keyframe window, CoCo-LIC assigns depth to tracked keypoints from the accumulated **global LiDAR voxel map** (0.1 m resolution). KLT optical flow tracks keypoints forward; LiDAR map points are projected into the image; associations form frame-to-map reprojection factors:

```
r_c = pi_c( p_sc_hat / (e_3^T * p_sc_hat) )  -  [u_s, v_s]^T
      where  p_sc_hat = T(t_cam) * p_s_G
```

`p_s_G` is the LiDAR map point; `T(t_cam)` is the spline-queried camera pose. Depth comes from LiDAR — not from the optimisation state. This shortens the sliding window (no separate visual keyframe buffer), avoids triangulation uncertainty, and allows graceful fallback to LiDAR+IMU when the camera degrades.

### Joint Cost

```
argmin_theta  sum_l ||r_l||^2_Sigma  +  sum_c ||r_c||^2_Sigma  +  sum_i ||r_i||^2_Sigma  +  r_prior
```

`r_l`: LiDAR point-to-plane; `r_c`: frame-to-map visual reprojection; `r_i`: raw IMU residual; `r_prior`: marginalised prior (same as CLIC). Solved by Levenberg-Marquardt via Ceres.

---

## Operator Math Reference

| Symbol | Space | Meaning |
|--------|-------|---------|
| `R in SO(3)` | 3x3 | Pure rotation |
| `T in SE(3)` | 4x4 | Rigid pose `[R | p; 0 | 1]` |
| `Exp(omega)` | so(3)->SO(3) | Matrix exponential (Rodrigues) |
| `Log(R)` | SO(3)->so(3) | Matrix logarithm |
| `B_j(u)` | scalar | Uniform cumulative B-spline basis (CLIC) |
| `lambda_j(t)` | scalar | Non-uniform cumulative basis (CoCo-LIC); de Boor-Cox |

**IMU residuals from spline derivatives:**

```
r_gyro(t_k)  = R^T(t_k) * d/dt R(t_k)   -  (omega_meas(t_k) - b_g)
r_accel(t_k) = d^2/dt^2 p(t_k)          -  R^T(t_k) * (a_meas(t_k) - b_a)  -  g^G
```

No pre-integration; the spline provides derivatives analytically on demand.

**Per-residual Jacobian chain rule:**

```
dr/dR_j = (dr/dT(t))  *  (dT(t)/dlambda_j)  *  (dlambda_j/dR_j)
```

`dT(t)/dlambda_j` is computed via the Sommer et al. (CVPR 2020) O(k) method. Jacobians are pre-derived symbolically and hard-coded — analytical, not numerical.

See [Lie Groups SE(3)/SO(3) and Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) and [Continuous-Time Registration](./continuous-time-registration.md) §Operator Mathematics.

---

## Inputs and Outputs

| Item | Description |
|------|-------------|
| **LiDAR** | Spinning or solid-state; per-point timestamps required; Livox supported |
| **IMU** | 6-axis at 200-400 Hz; tightly coupled; required |
| **Camera** | Stereo (CLIC, for triangulation) or monocular (CoCo-LIC, LiDAR depth) |
| **Output: trajectory** | B-spline control points over the sliding window; queryable at any `t` |
| **Output: per-point cloud** | Each LiDAR return placed at its acquisition-time world pose |
| **Output: voxel map** | Incrementally built global map (CoCo-LIC: 0.1 m voxels) |
| **Output: calibration** | Online-estimated LiDAR-IMU and camera-IMU time offsets (CLIC) |

---

## Architecture

**CLIC:** MsgCache timestamps-aligns streams -> Sliding Window Manager (temporal: 4 control points at Dt=0.03 s; visual: 10 keyframes) -> Factor Graph Builder (IMU + LiDAR + camera + prior factors) -> Levenberg-Marquardt (Ceres) -> Marginalisation (Schur complement -> prior factor) -> Map update and publish.

**CoCo-LIC adds two targeted changes:**

1. **Adaptive control-point manager** replaces the uniform scheduler: every 0.1 s, compute `(N_m, N_a)` from IMU, look up `n_cp`, place control points at uniform sub-intervals within the block. Window length varies across blocks.
2. **Visual module restructure**: KLT optical flow replaces feature triangulation; LiDAR map depth replaces visual depth estimation; frame-to-map factors replace landmark reprojection factors; no separate visual keyframe buffer.

**Dependencies:** ROS Noetic, Eigen 3.3.7, Ceres 2.0.0, OpenCV 4, PCL >= 1.13, livox_ros_driver.

---

## Benchmark Results

### CLIC — NTU-VIRAL

Hardware: Intel i7-8700 @ 3.2 GHz, 32 GB RAM.

| System | NTU-VIRAL avg RMSE ATE (m) | Type |
|--------|---------------------------|------|
| CLIC (LIC) | **0.035** | CT LiDAR-Inertial-Camera |
| CLIO (LI only) | **0.034** | CT LiDAR-Inertial |
| CLINS | 0.036 | CT LiDAR-Inertial, no camera |
| LIO-SAM | 0.096 | Discrete-time LI |

CLIC on LVI-SAM dataset (outdoor handheld): 2.56 m vs LVI-SAM 7.87 m.

**Runtime — NTU-VIRAL eee_01 (397 s sequence):**

| System | Wall time | Real-time ratio |
|--------|-----------|----------------|
| CLINS  | 1602 s | 0.25x (4x slower) |
| CLIC (LIC) | 295 s | 0.74x |
| CLIO (LI) | 218 s | 0.55x |

### CoCo-LIC — UrbanNav and Degenerate Sequences

Hardware: same i7-8700.

| System | UrbanNav Medium ATE (m) | UrbanNav Harsh ATE (m) |
|--------|------------------------|----------------------|
| CoCo-LIC | **6.031** | **2.189** |
| CLIC | 6.923 | — |
| FAST-LIVO | 7.331 | — |
| FAST-LIO2 | — | 2.820 |

CoCo-LIC beats FAST-LIO2 by 22% on the aggressive-motion Harsh sequence.

**Degenerate sensor sequences (motion-capture ground truth at 120 Hz):**

| Sequence | CoCo-LIC (m / deg) | R3LIVE | FAST-LIVO |
|----------|--------------------|--------|-----------|
| degenerate_seq_00 (camera fail) | **0.016 / 0.428** | 0.035 / 0.405 | 0.420 / 3.621 |
| Visual_Challenge (visual degraded) | **0.166 / 0.889** | 0.234 / 0.751 | — |

**Per-step optimisation timing — UrbanNav Medium (785-second sequence):**

| Component | CoCo-LIC | CLIC |
|-----------|----------|------|
| LiDAR association | 31.46 ms | — |
| Visual association | 18.90 ms | — |
| Optimisation (per step) | 9.09 ms | 29.05 ms |
| Total wall time | ~639 s (0.81x real-time) | > 785 s |

CoCo-LIC is approximately 3.2x faster per optimisation step than CLIC from: (a) fewer average control points via adaptive placement; (b) no depth variables in the state (frame-to-map replaces triangulation).

---

## Strengths

- **Premium accuracy under aggressive motion.** Per-point B-spline poses jointly refined with deskew eliminate the fixed-prior bias in discrete-time systems during fast or erratic motion. CoCo-LIC achieves 22% lower ATE than FAST-LIO2 on the UrbanNav Harsh sequence.
- **Natural asynchronous multi-sensor fusion.** All sensor streams contribute at their exact timestamps — no sync barrier, no interpolation approximation.
- **Online time-offset calibration (CLIC).** Sensor clock offsets estimated as optimisation state; converges from ±20 ms error in ~3 s.
- **Adaptive trajectory resolution (CoCo-LIC).** Non-uniform control-point placement balances accuracy and compute: dense during fast manoeuvres, sparse during cruise.
- **Graceful sensor degradation (CoCo-LIC).** LiDAR-IMU backbone continues uninterrupted when camera fails; camera resumes automatically.
- **Clean open-source lineage.** GPL-3.0; single sustained APRIL-ZJU team across CLINS -> CLIC -> CoCo-LIC.

---

## Failure Modes

**Compute cost — sub-real-time on embedded hardware.** On i7-8700: CoCo-LIC at 0.81x, CLIC at 0.74x real-time. Neither system has published Jetson Orin benchmarks. For embedded real-time deployment, [FAST-LIVO2](./fast-livo-fast-livo2.md) (17 Hz on RK3588 ARM) is the correct choice.

**Requires complete multi-modal sensor suite.** LiDAR + IMU + camera all present and calibrated. If the camera is absent, neither system falls back to a LiDAR-only path — use CLINS, FAST-LIO2, or [KISS-ICP](./kiss-icp.md) instead.

**Spline degeneracy in feature-poor environments.** More trajectory DOF require more measurements. Open aprons, long straight taxiways, uniform corridors can leave control points under-constrained, causing elastic overfit. Mitigate by reducing `n_cp` thresholds and monitoring Hessian eigenvalues.

**Time-motion ambiguity.** Clock offset errors mimic velocity errors; the solver cannot distinguish the two. Monitor residual magnitude as a function of point timestamp (not spatial position) — a monotonic trend indicates timing bias. See [Rolling-Shutter LiDAR Deskew and Motion Distortion](../../../10-knowledge-base/geometry-3d/rolling-shutter-lidar-deskew-motion-distortion.md).

**Research code maturity.** Both repos target ROS 1 (catkin). Production integration requires ROS 2 porting, deterministic compute budgets, GPL-3.0 license review, and map lifecycle work.

---

## Domain Fit

| Domain | Fit | Notes |
|--------|-----|-------|
| Airside — survey mapping (offline, post-processed) | Very high | Per-point poses eliminate scan shear; online time-offset calibration; adaptive splines handle mixed taxi/maneuver dynamics |
| Airside — real-time embedded AV navigation | Low | Sub-real-time on tested hardware; use FAST-LIVO2 |
| Urban road AV | Conditional | CT accuracy gain under aggressive motion; embedded deployment blocked by compute |
| Drone / handheld survey | High | Aggressive rotation is where CT gains most; server-class CPU required |
| Warehouse / indoor | Medium | Low-speed; CT advantage small; compute unjustified |
| Mining / construction | High | Rough terrain, aggressive motion; post-processing pipeline suitable |
| Agriculture / outdoor terrain | High | Similar to mining profile |
| Port / logistics yard | Medium-high | Mixed structured/open; post-processing suitable |
| Highway / long straight | Low | Smooth motion; FAST-LIO2 or KISS-ICP preferred |

---

## Aggregated-Map Suitability

Within the tier hierarchy from [Continuous-Time Registration](./continuous-time-registration.md):

| Tier | System | Compute mode |
|------|--------|-------------|
| CT LiDAR-only | CT-ICP | Real-time |
| CT LI | CLINS | Sub-RT post-process |
| CT LIC uniform | CLIC | Sub-RT post-process |
| **CT LIC adaptive — premium** | **CoCo-LIC** | **Sub-RT post-process** |
| DT LIC — embedded | FAST-LIVO2 | Embedded real-time |

**CoCo-LIC is the CONTINUOUS-TIME MULTIMODAL PREMIUM TIER for survey-grade airside HD map production:**

1. **Eliminates scan shear.** At 5-8 m/s taxi speed with a 10 Hz LiDAR, the 100 ms sweep generates 50-80 cm of positional smear per scan under naive discrete-time treatment. CoCo-LIC assigns each return its spline-queried acquisition-time pose.
2. **Removes timing errors.** Online time-offset calibration (inherited from CLIC) handles LiDAR-camera and LiDAR-IMU offsets that drift with temperature or differ between runs.
3. **Camera stabilises trajectory over featureless apron sections.** Terminal facades, painted markings, and gate signage provide reprojection constraints where LiDAR planar structure is sparse.
4. **Non-uniform B-spline handles mixed airside dynamics.** Slow taxi cruise and aggressive turns near stands each get appropriate control-point density automatically.

**Honest caveat:** CoCo-LIC requires post-processing on a server-class workstation, not embedded real-time deployment. For operational real-time AV navigation on airside, FAST-LIVO2 localises against the CoCo-LIC-produced map. This decouples map accuracy (offline, premium algorithm) from navigation latency (online, efficient algorithm).

**Recommended airside survey pipeline:**

```
Survey vehicle run
  -> ROS bag: raw LiDAR (per-point timestamps) + IMU + camera
  -> CoCo-LIC post-processed on server-class x86
  -> Continuous-time trajectory + per-point aggregated cloud
  -> Loop closure + global pose graph (lio-sam-style backend)
  -> GNSS/RTK georeferencing at control points
  -> Semantic labelling: markings, lights, signs
  -> Safety-case HD map deliverable
```

Downstream segmentation: see [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md). For refining the resulting trajectory with bundle adjustment: see [LiDAR Bundle Adjustment Factors](./lidar-bundle-adjustment-factors.md).

---

## Implementation Notes

- **Preserve per-point LiDAR timestamps in the driver.** CT registration is disabled or biased without them. Validate LiDAR clock synchronisation before any deployment. See [Sensor Calibration and Time Synchronization](../../../10-knowledge-base/geometry-3d/sensor-calibration-time-synchronization.md).
- **Use CLIC when sensor time offsets are unknown; CoCo-LIC otherwise.** CLIC's online calibration is its primary advantage when timing is uncertain. CoCo-LIC trades that for faster per-step cost.
- **Monitor residuals vs point timestamp.** A monotonic trend indicates timing bias, not a pose estimation problem — the primary CT-specific diagnostic.
- **Tune CoCo-LIC motion intensity thresholds to your platform.** Log `n_cp` per interval during a representative test run; the high-density thresholds may never fire on slow airside platforms.
- **Loop closure is not included.** Pair with a loop-closure backend for traversals longer than ~500 m. See [Loop Closure and Place Recognition](./loop-closure-place-recognition.md).
- **GPL-3.0 license.** Requires review before closed-source product integration.
- **Dynamic objects contaminate the map.** Aircraft, GSE, and service vehicles must be filtered upstream or cleaned from the aggregated map before use for localisation or safety-case documentation.
- **ROS 1 / ROS 2.** Both repos are catkin-based. ROS 2 requires porting or a bridge.

---

## Sources

### Papers

| Paper | Authors | Venue | arXiv | DOI |
|-------|---------|-------|-------|-----|
| CLINS | Lv, Hu, Xu, Liu, Ma, Zuo | IROS 2021 | [2109.04687](https://arxiv.org/abs/2109.04687) | — |
| CLIC | Lv, Lang, Xu, Wang, Liu, Zuo | TMECH 2023 | [2302.07456](https://arxiv.org/abs/2302.07456) | [10.1109/TMECH.2023.3245154](https://ieeexplore.ieee.org/document/10045587) |
| CoCo-LIC | Lang, Chen, Tang, Ma, Lv, Liu, Zuo | RA-L 2023 | [2309.09808](https://arxiv.org/abs/2309.09808) | [10.1109/LRA.2023.3315542](https://ieeexplore.ieee.org/document/10251629) |
| Furgale et al. CT Batch | Furgale, Tong, Barfoot, Sibley | IJRR 2015 | — | [10.1177/0278364915585860](https://journals.sagepub.com/doi/10.1177/0278364915585860) |
| Sommer et al. B-spline Jacobians | Sommer et al. | CVPR 2020 | [1911.08860](https://arxiv.org/abs/1911.08860) | — |
| FAST-LIVO2 | Zheng et al. | T-RO 2025 | [2408.14035](https://arxiv.org/abs/2408.14035) | [10.1109/TRO.2024.3502198](https://ieeexplore.ieee.org/document/9697912/) |
| MARS-LVIG dataset | Li et al. | IJRR 2024 | — | [10.1177/02783649241227968](https://journals.sagepub.com/doi/abs/10.1177/02783649241227968) |

### GitHub Repositories

| System | URL | License |
|--------|-----|---------|
| CLINS | https://github.com/APRIL-ZJU/clins | CC-BY-4.0 |
| CLIC | https://github.com/APRIL-ZJU/clic | GPL-3.0 |
| CoCo-LIC | https://github.com/APRIL-ZJU/Coco-LIC | GPL-3.0 |
| FAST-LIVO2 | https://github.com/hku-mars/FAST-LIVO2 | GPL-2.0 |

### Evaluation Datasets

| Dataset | URL |
|---------|-----|
| NTU-VIRAL | https://ntu-aris.github.io/ntu_viral_dataset/ |
| UrbanNav | https://github.com/IPNL-POLYU/UrbanNavDataset |
| MARS-LVIG | https://mars.hku.hk/dataset.html |
| Newer College Dataset | https://ori-drs.github.io/newer-college-dataset/ |
