# BEV-LIO(LC)

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method-family"
  stage: "modern-core"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "runtime-localization", "outdoor"]
  reason: "BEV-LIO(LC) is rated for LiDAR odometry, mapping, or scan-matching coverage in AV localization stacks."
method-priority:end -->

Related method pages: [FAST-LIO and FAST-LIO2](./fast-lio-fast-lio2.md) (iter 22 — iEKF ancestor), [KISS-ICP](./kiss-icp.md) (iter 20 — 3D ICP baseline), [KISS-SLAM](./kiss-slam.md) (iter 32 — KISS-family full SLAM), [LIO-SAM](./lio-sam.md) (factor-graph LIO), [GenZ-ICP / GenZ-LIO](./genz-icp-genz-lio.md) (iter 38), [Scan Context Family](./scan-context-family.md), [Learned LiDAR Place Recognition](./learned-lidar-place-recognition.md) (iter 18), [Loop Closure and Place Recognition](./loop-closure-place-recognition.md) (iter 28), [Continuous-Time Registration](./continuous-time-registration.md) (iter 36), [LiDAR Bundle Adjustment Factors](./lidar-bundle-adjustment-factors.md) (iter 37), [GraphSLAM and Pose Graph Optimization](./graphslam-pose-graph-optimization.md).

Related overview pages: [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md).

Related KB pages: [Lie Groups SE(3) / SO(3) Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) (iter 14), [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md).

**Last updated:** 2026-05-24

**Paper:** arXiv:2502.19242 — IROS 2025 (Hangzhou, China).

**Code:** [HxCa1/BEV-LIO-LC](https://github.com/HxCa1/BEV-LIO-LC).

---

## What It Is

BEV-LIO(LC) — full title "BEV-LIO(LC): BEV Image Assisted LiDAR-Inertial Odometry with Loop Closure" — is a LiDAR-inertial odometry and SLAM system from Haoxin Cai, Shenghai Yuan, Xinyi Li, Junfeng Guo, and Jianqi Liu at NTU Singapore (Shenghai Yuan's ARIS lab). It was accepted to IEEE/RSJ IROS 2025 (Hangzhou, China) and is publicly available at arXiv:2502.19242 (submitted 26 Feb 2025; revised v2 17 Jul 2025). Code is released at GitHub [HxCa1/BEV-LIO-LC](https://github.com/HxCa1/BEV-LIO-LC) in C++ (97%) with a thin Python wrapper (3%) under ROS Noetic.

The name convention: the paper renders the system as "BEV-LIO(LC)" with parentheses to signal the loop-closure variant; "BEV-LIO-LC" is the repository shorthand. Both refer to the same work. This page uses "BEV-LIO(LC)" when referring to the paper's terminology and "BEV-LIO-LC" when referring to the repository or code artifacts.

The defining characteristic is that BEV-LIO(LC) departs from the 3D voxel/ikd-tree approach shared by [FAST-LIO2](./fast-lio-fast-lio2.md) and [KISS-ICP](./kiss-icp.md) and instead projects every incoming undistorted LiDAR sweep into a 2D density-normalised Bird's-Eye-View (BEV) image, discarding the z-axis entirely and working in the horizontal plane. All registration features and loop-closure descriptors are derived from this single 2D projection. The iEKF front end fuses BEV reprojection residuals with classical point-to-plane residuals; the loop-closure backend uses the same BEV global descriptors for retrieval. The result is a **representation-homogeneous pipeline**: one BEV projection serves both odometry and place recognition.

---

## Core Technical Idea

Classical LIO methods work in 3D:

- [FAST-LIO2](./fast-lio-fast-lio2.md) — iEKF front-end, ikd-tree of raw 3D points; all registration residuals are point-to-plane in R³.
- [KISS-ICP](./kiss-icp.md) — adaptive-threshold point-to-point ICP over a downsampled 3D voxel map.
- [LIO-SAM](./lio-sam.md) — curvature-based 3D edge/plane feature extraction + GTSAM factor graph.

BEV-LIO(LC) replaces the 3D operating domain with a 2D top-down image at the front end. Each LiDAR sweep, after IMU-based motion undistortion, is projected orthographically onto a BEV plane. Point density per grid cell is recorded and normalised; the z-coordinate is deliberately discarded. From this 2D image the system extracts:

- **FAST keypoints** — classical Harris-corner-like 2D feature detector, fast to compute.
- **REIN local descriptors** — lightweight CNN features from BEVPlace++ (arXiv:2408.01841), rotation-equivariant under SO(2), matched frame-to-frame for reprojection residuals.
- **REIN global descriptors** — NetVLAD-aggregated vectors used for loop-closure database queries.

The front-end update step in the iterated extended Kalman filter (iEKF) combines the new BEV reprojection residuals with the standard point-to-plane geometric residuals, weighted by a scalar λ. This is identical to FAST-LIO2's iEKF state structure (position, orientation on SO(3), velocity, gyro bias, accelerometer bias) but extends the measurement model to include 2D image geometry.

The loop-closure module uses the global BEV descriptor of each keyframe, stored in a KD-tree database. At query time the system retrieves the top-k nearest keyframes by L2 distance, gates them by pose distance τ, runs RANSAC on matched local descriptors to estimate a coarse SE(2) transform, lifts it to SE(3), refines with ICP on the 3D undistorted point clouds, and inserts the verified relative pose as a loop factor into a FAST-LIO-SAM style GTSAM pose-graph backend.

The key properties that follow from this 2D design:

1. BEV images are computationally cheaper to search than a 3D ikd-tree (no incremental tree rebalancing per scan).
2. REIN descriptors are rotation-equivariant and viewpoint-invariant under horizontal rotation — well-suited to loop closure where approach angles vary.
3. The pipeline is homogeneous: the same BEV image feeds both the odometry residual and the loop-closure database, avoiding the mismatch between separately-designed 3D registration and 2D place recognition modules common in systems that bolt a descriptor database onto an unrelated odometry front end.

---

## Operator Mechanics

### BEV Projection

For each LiDAR point `P_i = [x_i, y_i, z_i]^T` in the undistorted sweep, the BEV pixel coordinates are:

```
(u_i, v_i) = ( floor((y_max - y_i) / mu),  floor((x_max - x_i) / mu) )
```

where `mu` [m/pixel] is the BEV image resolution parameter and `x_max`, `y_max` are the scan extent bounds in the local LiDAR frame.

The `z_i` coordinate is **deliberately discarded**. The paper states explicitly: *"By disregarding point distribution along the z-axis, our BEV image retains the rigid structures on the x-y plane."* This is the central design choice and also the central limitation — see Failure Modes.

### Density Normalisation

Pixel intensity encodes normalised point density, not height or reflectance:

```
I(u,v) = min(N_i, N_m) / N_m
```

where `N_i` is the point count in cell `(u,v)` and `N_m` is the global maximum point density in the scan. Dense regions saturate to 1.0; sparse single-return cells are suppressed. This encoding is LiDAR-type-agnostic — it works for both spinning and solid-state LiDARs without sensor-specific tuning, and avoids the scale distortion of spherical range images.

### FAST Keypoints and REIN Descriptors

From the BEV image, a standard FAST corner detector extracts 2D keypoints. Each keypoint is described with a REIN local descriptor from the pre-trained BEVPlace++ CNN. BEVPlace++ uses a Rotation Equivariant Module (REM) to extract features that are equivariant under SO(2) rotation; global vectors are produced by NetVLAD aggregation. The network was pre-trained on 3000 KITTI frames with place labels and is used frozen in BEV-LIO(LC). It requires CUDA and LibTorch (PyTorch C++ API) at runtime — this is the GPU dependency that prevents bare-metal embedded deployment.

### Combined iEKF Residual

The front-end update step assembles a combined measurement vector from both geometric (point-to-plane) and image (BEV reprojection) residuals:

```
H = [H_1^geo, ..., H_m^geo,   lambda * H_1^proj, ..., lambda * H_n^proj]^T
z = [z_1^geo, ..., z_m^geo,   lambda * z_1^proj, ..., lambda * z_n^proj]^T
```

The Kalman gain is:

```
K = (H^T R^{-1} H + P^{-1})^{-1} H^T R^{-1}
```

`lambda` is a scalar weight balancing the two residual families; the paper does not disclose the exact value. A standard manifold-aware IESKF update on SO(3) x R³ follows. The state vector tracks position, orientation (on SO(3)), velocity, and IMU biases — identical to FAST-LIO2's state definition. See [Lie Groups SE(3) / SO(3) Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) for the manifold update algebra.

### Motion Undistortion

Point cloud undistortion applies ego-motion compensation via IMU-propagated incremental poses:

```
P_i = T_{L_i I_i} * T_{I_i I_{i-1}} * T_{I_{i-1} L_{i-1}} * P_{i-1}
```

This is identical to FAST-LIO2's deskew procedure. The BEV image is built from the undistorted sweep, so motion distortion does not corrupt the 2D feature extraction.

### Pose-Graph Backend

Verified loop constraints are inserted as binary factors into a GTSAM pose graph alongside sequential odometry factors. The GTSAM backend solves the factor graph using iSAM2-style incremental smoothing. Each odometry factor carries the relative 6-DOF transform and an associated covariance derived from the iEKF; each loop factor carries the ICP-refined relative transform and an ICP-based covariance. After graph optimisation the corrected trajectory replaces the raw iEKF trajectory, redistributing accumulated drift across the full history.

The backend is architecturally identical to [LIO-SAM](./lio-sam.md)'s factor-graph design and shares the FAST-LIO-SAM reference implementation pattern. The difference is the descriptor source: LIO-SAM uses Scan Context; BEV-LIO(LC) uses REIN BEVPlace++. For a detailed treatment of factor-graph SLAM backends see [GraphSLAM and Pose Graph Optimization](./graphslam-pose-graph-optimization.md) and [LiDAR Bundle Adjustment Factors](./lidar-bundle-adjustment-factors.md) (iter 37).

### SE(2) Coarse Alignment and SE(3) Lift

In the loop-closure branch, RANSAC on matched BEV keypoints estimates a 2D rigid transform (rotation `theta`, pixel translations `t_u`, `t_v`). This is lifted to an SE(3) initial guess:

```
T_rq = [cos(theta),  sin(theta),  mu * t_u]
       [-sin(theta), cos(theta),  mu * t_v]
       [0,           0,           1       ]
```

(3x3 homogeneous form, x-y plane only). The z-translation and roll/pitch components are not recovered from BEV — they are inherited from the prior pose or set to zero. This is the algebraic consequence of the z-collapse: z, roll, and pitch are unobservable from BEV alone. ICP over the undistorted 3D point clouds then refines this coarse transform in full SE(3). See [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md) for the ICP refinement formulation.

---

## Inputs and Outputs

| Item | Detail |
|---|---|
| **LiDAR input** | Rotating 3D point cloud; tested: Ouster OS1-64, OS1-128, Velodyne VLP-32C, Livox series |
| **IMU input** | 6-axis (accelerometer + gyroscope) at high rate; used for propagation and deskewing |
| **Calibration** | LiDAR-IMU extrinsic transform; per-point timestamps for undistortion |
| **Output: per-scan pose** | 6-DOF pose estimate from the iEKF state at each scan |
| **Output: keyframe database** | BEV global descriptors in a KD-tree; enables re-localization queries |
| **Output: pose graph** | Globally consistent trajectory after FAST-LIO-SAM-style GTSAM backend optimization |
| **No output** | A directly usable dense 3D map is not output by default; the user assembles one by transforming stored point clouds into the optimized reference frame |

**Output notes.** The per-scan iEKF pose is available at front-end rate (~16 Hz); the globally consistent pose graph is available asynchronously after loop-closure events trigger graph optimization. Downstream consumers that require a consistently-timed pose stream (e.g., a real-time controller) should consume the iEKF output and accept occasional discrete jumps when the graph backend applies a loop correction — the same architectural pattern used by [LIO-SAM](./lio-sam.md). The keyframe BEV descriptor database persists across sessions if serialised to disk; this enables re-localisation on a prior map by querying the stored KD-tree without re-running the full odometry pipeline.

---

## Architecture

The pipeline is five functional modules in sequence, with a parallel loop-closure branch from the BEV descriptor stream:

```
LiDAR sweep (raw)
       |
   IMU pre-integration (FAST-LIO2 iEKF propagation)
       |
   Motion undistortion → undistorted point cloud
       |
   BEV projection (density normalised, z discarded)
       |                              |
   FAST keypoint detection         BEVPlace++ / REIN global descriptor
   + REIN local descriptor         (NetVLAD aggregation)
       |                              |
   Frame-to-frame reprojection     KD-tree keyframe DB query
   residual z^proj                 (L2 distance, top-k candidates)
       |                              |
   Unified iEKF update             Pose-distance gate (tau threshold)
   (geometric + lambda*reprojection)     |
       |                          RANSAC on local BEV descriptors
   State: position, rotation,     -> coarse SE(2) -> SE(3) T_rq
   velocity, IMU biases               |
       |                          ICP refinement (3D point clouds)
   Odometry factor                     |
       |                          Loop closure factor
       +----------------------------------+
                  |
           FAST-LIO-SAM style pose-graph backend
           (GTSAM >= 4.0; odometry + loop factors)
                  |
           Globally consistent pose graph + trajectory
```

**REIN / BEVPlace++** (arXiv:2408.01841):

- Rotation Equivariant Module (REM) extracts local features equivariant under SO(2) rotation.
- NetVLAD aggregation produces a rotation-invariant global descriptor over the full BEV image.
- Descriptor dimension and NetVLAD cluster count follow the BEVPlace++ defaults; the paper does not disclose the exact vector dimensionality used.
- Pre-trained on 3000 KITTI frames with place labels; used frozen inside BEV-LIO(LC).
- Requires CUDA + LibTorch (PyTorch C++ API) — this is the hard GPU dependency.
- For context on the broader landscape of learned LiDAR place recognition see [Learned LiDAR Place Recognition](./learned-lidar-place-recognition.md) (iter 18) and [Scan Context Family](./scan-context-family.md) for the classical (non-GPU) alternative descriptor family.

**Software stack**: Ubuntu 20.04, ROS Noetic, PCL >= 1.8, Eigen >= 3.3.4, GTSAM >= 4.0, CUDA + LibTorch 2.7.1, livox_ros_driver.

---

## Training

BEV-LIO(LC) has no user-facing training stage. The REIN network is used with pre-trained BEVPlace++ weights, frozen. No fine-tuning on target-domain data is required or exposed in the repository.

**Pre-trained weights.** The BEVPlace++ REIN model was trained on approximately 3000 KITTI-sequence frames annotated with place-recall labels. The training used a rotation-equivariant contrastive objective that encourages the global descriptor to be invariant to yaw while remaining discriminative between distinct places. Because the training set is KITTI-derived (structured urban roads, campus environments), the descriptor's distribution may not perfectly cover significantly different structural vocabularies such as:

- Large open apron environments with sparse discrete landmarks.
- Heavily industrialised port zones dominated by container stacks.
- Underground parking or basement environments.
- Agricultural terrain with minimal man-made structure.

Performance in these out-of-distribution environments is not characterised by the paper. Domain gap is a real concern for the loop-closure precision metric in environments structurally unlike the KITTI training distribution.

**Runtime requirements.** LibTorch 2.7.1 is required. This is a large binary dependency (~1.5 GB installed). The livox_ros_driver dependency gates use with Livox LiDARs; for Velodyne/Ouster-only deployments the driver can be removed from the build but requires CMakeLists.txt modification.

**No online adaptation.** There is no self-supervised or incremental update of the REIN network during operation. The descriptor quality is fixed at deployment time. Systems operating in rapidly changing environments (e.g., a busy apron where aircraft positions change between sessions) should periodically re-verify that previously stored keyframe descriptors remain discriminative after environmental changes.

**Dependency version sensitivity.** LibTorch 2.7.1 is specified; breaking API changes between LibTorch minor versions are common in the 2.x series. If upgrading the host CUDA toolkit or PyTorch version, revalidate that the frozen REIN weights load and produce identical descriptors before redeploying. Pin the LibTorch version in the build system explicitly.

---

## Benchmarks and Quantitative Results

### Datasets Evaluated

| Dataset | Platform | LiDAR | Coverage |
|---|---|---|---|
| MCD (Multi-Campus Dataset) | Handheld, ATV, ground robot | Ouster OS1-64/128 | NTU Singapore, KTH Stockholm, TUHH Hamburg |
| NCD (Newer College Dataset) | Handheld | Ouster OS1-64 | Oxford — cloister, underground, quad |
| M2DGR (Multi-modal Multi-scenario) | Ground robot | Velodyne VLP-32C | Gate, street, park sequences |

**KITTI, MulRan, and HeLiPR are not evaluated.** This is an important honest qualification: direct ATE comparison with [FAST-LIO2](./fast-lio-fast-lio2.md) or [KISS-ICP](./kiss-icp.md) on the canonical outdoor benchmarks is absent from the paper. Any comparison between BEV-LIO(LC) and those baselines on KITTI/MulRan numbers found elsewhere is extrapolated, not directly measured.

### Comparison Methods

Front-end (odometry only): FAST-LIO2, DLIO, iG-LIO, COIN-LIO.
Back-end with loop closure: LIO-SAM, LIO-SAM-SC, FAST-LIO-SC, FAST-LIO-STD.

### Selected ATE Results

The paper reports ATE across 9 sequences in Tables I and II:

| Sequence | Dataset | BEV-LIO(LC) | FAST-LIO2 | Notes |
|---|---|---|---|---|
| cloister | NCD | 0.053 m | 0.062 m | ~14% improvement |
| MCD KTH sequences (avg) | MCD | — | — | 29.3% avg improvement over FAST-LIO2 |
| gate_03 | M2DGR | — | — | 0.09 m ATE reduction |
| street_08 | M2DGR | — | — | 0.05 m ATE reduction |
| ntu_08 | MCD | improved | — | 0.409 m reduction (22.6%) from loop closure |

Loop closure improves 77.8% of tested sequences relative to the front-end-only variant. iG-LIO diverges on the cloister and underground NCD sequences; BEV-LIO(LC) remains stable on both, attributed to image-level structural constraints providing regularisation where 3D point geometry is degenerate.

COIN-LIO is the closest technical competitor: it also augments FAST-LIO2 with complementary image features. BEV-LIO(LC) outperforms COIN-LIO on sparse-channel LiDARs because BEV density encoding is less sensitive to per-beam intensity variation than COIN-LIO's intensity-image approach.

**Quantitative caveat:** the paper does not publish a single comprehensive ATE table in a format easily cross-referenced here. The `lambda` weight value is not disclosed. Per-component runtime breakdown is not provided. Precise per-sequence numbers require reading the PDF tables directly.

**Scope of the benchmark honest note.** Because KITTI, MulRan, and HeLiPR are absent, comparing BEV-LIO(LC) to [FAST-LIO2](./fast-lio-fast-lio2.md) or [KISS-ICP](./kiss-icp.md) using canonical numbers from their respective papers would be comparing different datasets. Any claim that BEV-LIO(LC) "beats FAST-LIO2" or "beats KISS-ICP" on KITTI is not supported by this paper; the paper shows improvement over FAST-LIO2 on MCD, NCD, and M2DGR only.

### Runtime

Average: **62.7 ms/frame (~16 Hz)** on AMD Ryzen 7 6800H + NVIDIA RTX 3060 (laptop GPU). The GPU is required for LibTorch/REIN descriptor inference. No published characterisation on Jetson AGX Orin or other embedded hardware exists.

For contrast: [FAST-LIO2](./fast-lio-fast-lio2.md) runs at up to 100 Hz on similar hardware without GPU; [KISS-ICP](./kiss-icp.md) runs at 38–51 Hz on a single CPU core without GPU. The 16 Hz rate and GPU requirement of BEV-LIO(LC) reflect the added cost of CNN inference.

---

## Strengths

**Representation homogeneity.** BEV serves dual purpose: registration front-end and loop-closure descriptor. One projection, two uses. This avoids the mismatch between 3D registration and separately-computed 2D place recognition descriptors common in systems that bolt a descriptor database onto an independent odometry front end.

**LiDAR-type agnostic.** Density-normalised BEV generalises across spinning and solid-state LiDARs without sensor-specific tuning. Demonstrated on Ouster (64-beam and 128-beam) and Velodyne (32-beam) in the same pipeline without parameter changes.

**Rotation equivariance.** REIN local and global descriptors are robust to yaw rotation, important for loop closure under approach-angle variation — common in all ground-vehicle SLAM domains.

**Structural regularisation in degenerate scenes.** BEV image features provide constraints that help where 3D point geometry is sparse or degenerate. The system remains stable on NCD underground and cloister sequences where iG-LIO diverges.

**Complete SLAM pipeline.** Built-in loop closure means no separate post-processing step; the system produces a globally consistent trajectory end-to-end from a single launch. Contrast with [FAST-LIO2](./fast-lio-fast-lio2.md), which requires bolting on a separate backend (FAST-LIO-SAM, g2o, GTSAM with Scan Context) to achieve global consistency.

**Flat-environment efficiency.** For planar operating domains (roads, aprons, warehouse floors, logistics yards), the z-discard is not a loss — it is a simplification that sharpens the 2D structural features that actually discriminate locations. On flat terrain the BEV geometry is the operationally relevant geometry.

**Sensor-type generality within the flat-environment regime.** The density-normalised BEV encoding is sensor-agnostic within the tested LiDAR types. Systems based on ring-indexed spherical images (e.g., LiDAR intensity images used by COIN-LIO) require per-sensor beam-pattern calibration. BEV density requires only a range bound and a resolution setting.

---

## Failure Modes

### The Height-Collapse Problem

This is the central structural limitation. The BEV projection discards all z-axis information. Consequences:

- **z, roll, and pitch are unobservable from BEV alone.** The system recovers only (x, y, yaw) from BEV features; z and tilt come entirely from the geometric (point-to-plane) residual and IMU integration.
- In richly vertical scenes — forests, indoor multi-story buildings, construction sites, mining pits, harbourside crane infrastructure — the BEV image is a poor summary of scene geometry. Points from different heights collapse to the same pixel, creating ambiguous density patterns.
- Multi-story structures appear as a single flat blob in BEV. Bridges, overpasses, and elevated walkways are indistinguishable from ground-level structures.
- **Loop-closure false match risk:** two locations with the same horizontal layout but different vertical structure (e.g., a tunnel approach vs. an open road of the same width) may produce similar BEV global descriptors. The ICP refinement step is the primary guard against false matches; it does not guarantee rejection.

### GPU Dependency

Requires CUDA and LibTorch for REIN inference at runtime. Not deployable on CPU-only embedded platforms. Jetson AGX Orin has CUDA and could in principle run LibTorch, but no characterised runtime on Orin has been published. Bare-metal microcontrollers and safety-certified ASIL-D channels without GPU runtime cannot host BEV-LIO(LC) as published. The authors name "eliminating CNN dependence for real-time improvements" as future work.

### Ground-Plane Assumption

The paper explicitly assumes *"motion on a rough plane within a local area"* for the 3-DOF SE(2) optimisation in loop-closure coarse alignment. This is valid for road vehicles, AGVs, and apron service vehicles but fails for:

- Legged robots or UAVs with significant z-translation.
- Steep ramps and inclines beyond a few degrees.
- Handheld devices with large pitch excursions.

### Dataset Scope — No Canonical-Benchmark Direct Comparison

Only evaluated on MCD, NCD, and M2DGR — campus and urban environments. Not evaluated on KITTI, MulRan, or HeLiPR. Direct numerical comparison with [FAST-LIO2](./fast-lio-fast-lio2.md), [KISS-ICP](./kiss-icp.md), or [LIO-SAM](./lio-sam.md) on canonical outdoor benchmarks is absent, leaving outdoor high-speed vehicle performance uncharacterised.

### Aircraft-Fuselage BEV Ambiguity (Airside-Specific)

Large aircraft are highly non-flat objects. A LiDAR sweeping along an aircraft fuselage sees a curved surface that BEV collapses to a dense horizontal line. Descriptors built from adjacent nose-on positions of different aircraft may be similar. This failure mode is not tested in the paper; it is an extrapolated risk for airside deployment that must be empirically verified.

### Loop-Closure ICP Latency

The coarse-to-fine LC pipeline (RANSAC on BEV, then ICP on 3D) adds latency when a loop is triggered. The 62.7 ms/frame figure includes front-end processing; loop-closure verification adds additional load. At 16 Hz the system is real-time capable on a gaming laptop; headroom on embedded hardware (Orin) is uncharacterised.

### No Ablation Study

The paper does not decompose the contribution of the BEV reprojection residual independently from the geometric residual. The value of `lambda` is not disclosed. The marginal benefit of the BEV front-end features relative to a pure FAST-LIO2 front end with BEVPlace++ loop closure added separately is not quantified.

---

## Lineage and Context

BEV-LIO(LC) sits at the intersection of two mature research lines.

**Line 1: BEV as the canonical ground-vehicle representation.** The road-AV community adopted BEV as its primary spatial abstraction (PointPillars, BEVFusion, BEV occupancy prediction). BEV-LIO(LC) imports this 2D representation into SLAM. The intuition is the same: ground vehicles operate on an approximately flat manifold, so the top-down view captures the operationally relevant geometry compactly.

**Line 2: LiDAR place recognition via BEV images.** BEVPlace (2023) showed that BEV density images encode enough spatial structure for robust place recognition on KITTI and MulRan. BEVPlace++ (arXiv:2408.01841, 2024) added rotation equivariance (REIN) and made the descriptor lightweight and sensor-agnostic. BEV-LIO(LC) takes BEVPlace++'s pre-trained REIN and integrates it tightly into an LIO front end rather than using it only as a post-hoc loop-closure module.

**LIO ancestor.** [FAST-LIO2](./fast-lio-fast-lio2.md) (2022) defined the iEKF-on-ikd-tree architecture that BEV-LIO(LC) adopts as its IMU pre-integration and state propagation backbone. [LIO-SAM](./lio-sam.md) (2020) established the factor-graph backend pattern with loop closure. COIN-LIO (2023) is the closest prior competitor, augmenting FAST-LIO2 with intensity-image complementary information; BEV-LIO(LC) outperforms COIN-LIO on sparse-channel LiDARs because BEV density is less sensitive to per-beam intensity variation.

**Parallel work.** BEV-LSLAM (ResearchGate:388214677, 2025) is a distinct parallel work also using BEV-based LiDAR SLAM; the BEV-LIO(LC) paper notes it was unavailable for comparison at submission time. Both systems represent a nascent BEV-SLAM sub-family that should be tracked together. A third related direction is [KISS-SLAM](./kiss-slam.md) (iter 32, IROS 2025), which uses BEV density projections with classical ORB descriptors (no learned CNN) for loop detection — making it a CPU-deployable alternative to BEV-LIO(LC)'s learned REIN approach, at the cost of reduced rotation equivariance.

For the loop-closure descriptor foundations see [Learned LiDAR Place Recognition](./learned-lidar-place-recognition.md) and [Loop Closure and Place Recognition](./loop-closure-place-recognition.md). For the alternative KISS-family approach to adding loop closure to a minimal front end see [KISS-SLAM](./kiss-slam.md) (iter 32), which uses BEV density projections with classical ORB descriptors rather than learned REIN. For the GenZ approach to addressing geometric degeneracy with adaptive registration see [GenZ-ICP / GenZ-LIO](./genz-icp-genz-lio.md) (iter 38). For factor graph backend formulation see [LiDAR Bundle Adjustment Factors](./lidar-bundle-adjustment-factors.md) (iter 37) and [Continuous-Time Registration](./continuous-time-registration.md) (iter 36).

### Differentiators vs. Closest Competitors

| Dimension | BEV-LIO(LC) | FAST-LIO2 + FAST-LIO-SAM | KISS-SLAM (iter 32) | LIO-SAM |
|---|---|---|---|---|
| Front-end registration | BEV reprojection + point-to-plane | Point-to-plane only | Point-to-point ICP | 3D edge/plane features |
| Loop-closure descriptor | Learned REIN (BEVPlace++) | User-chosen (SC, BEVPlace++) | Classical ORB on BEV | Scan Context |
| GPU required | Yes (LibTorch REIN) | No | No | No |
| Flat-environment optimisation | Yes (SE(2) coarse align) | No | No | No |
| Canonical benchmark coverage | MCD, NCD, M2DGR only | KITTI, MulRan, etc. | KITTI, MulRan, HeLiPR | KITTI, various |
| Runtime | 62.7 ms / 16 Hz (GPU) | <10 ms / 100 Hz (CPU) | ~50 Hz (CPU) | ~20–40 Hz (CPU) |

The table highlights BEV-LIO(LC)'s unique position: the only system in this comparison with a tightly integrated learned place descriptor in the front-end residual, and the only one explicitly optimised for flat-ground SE(2) loop alignment — at the cost of GPU dependency and narrower benchmark coverage.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV — structured urban | Good | BEV captures road layout, building facades, lane markings well; loop closure helps on long routes. |
| Road AV — highway | Conditional | Open highway reduces lateral BEV structure; risk of along-axis drift on straight-line segments. |
| Airside — apron / taxiway (flat) | Good (by design) | Ground-plane assumption valid; BEV captures apron geometry and markings; built-in loop closure needed for large perimeters. Aircraft fuselage ambiguity is an untested failure mode. |
| Airside — terminal / jetway zone | Good | Rich vertical structure (terminal wall, jetway columns) provides 3D geometric residual constraint even as BEV features thin. |
| Warehouse / flat floor | Good | Floor grid, rack structure, and wall returns captured well in BEV; loop closure critical for large facilities. |
| Warehouse / multi-level / stairs | Weak | Height collapse discards multi-level structure; SE(2) loop closure fails on ramp transitions. |
| Logistics yard / port (flat areas) | Good | Similar to apron: flat, structured, large perimeter benefits from loop closure. |
| Port — crane / tall structure zones | Conditional | Crane superstructure collapses in BEV; loop-closure descriptors may alias near similar crane geometries. |
| Mining / construction | Weak | Non-flat terrain, steep ramps, vertical cuts — all undermine the SE(2) ground-plane assumption. |
| Indoor handheld / multi-story | Weak | Stairwells and multi-floor transitions are height-collapsed; system not designed for these. |
| Drone / UAV survey | Not suitable | Significant z-translation violates SE(2) loop closure; no 3D DoF recovery from BEV alone. |

---

## Aggregated-Map Suitability

In a map-construction pipeline, BEV-LIO(LC) occupies the combined odometry-front-end + loop-closure-backend position, producing a globally consistent pose graph whose trajectory can be used to aggregate raw scans into a dense point cloud. See [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) for how pose graphs feed downstream semantic labelling pipelines.

**Conceptual pipeline position:**

```
Raw LiDAR + IMU
  -> BEV-LIO(LC) front-end (iEKF, ~16 Hz, requires GPU)
  -> BEV keyframe database (KD-tree, REIN global descriptors)
  -> Loop closure (RANSAC SE(2) + ICP refinement)
  -> FAST-LIO-SAM pose graph (GTSAM backend)
  -> Globally consistent trajectory
  -> Aggregated point cloud (each scan at optimised pose)
  -> [optional] Dynamic removal (ERASOR, FreeDOM)
  -> Segmentation / HD map labelling
```

**Airside assessment.** Airport aprons and taxiways are among the flattest large-scale outdoor environments. Elevation change across a full apron is typically under 1 m over hundreds of metres; roll and pitch of ground support vehicles stay within ±3°. Under these conditions the z-collapse is not a loss — the BEV image captures precisely the geometry that defines airside topology. Built-in loop closure is operationally important for multi-kilometre apron perimeters where odometry drift accumulates.

**Honest caveats for airside use:**

1. Not evaluated on airside data. The MCD, NCD, and M2DGR sequences are campus/urban. Airside performance is extrapolated from flat-environment design intent, not demonstrated.
2. 3D-voxel LIO ([FAST-LIO2](./fast-lio-fast-lio2.md), [KISS-ICP](./kiss-icp.md)) remains more general. For airside it also works well, and does not carry the GPU dependency or the SE(2) loop-closure constraint.
3. Aircraft fuselage BEV ambiguity is untested. Large aircraft present curved non-flat surfaces that may confuse loop-closure descriptors near different nose-on positions.
4. GPU dependency is a deployment concern. Aviation-grade embedded compute certifiable to DO-254 / DO-178C does not typically include CUDA runtimes. BEV-LIO(LC) as published is not directly embeddable on bare-metal safety channels.
5. No 4D radar integration. The system is LiDAR + IMU only. The knowledge base identifies 4D radar as primary in adverse weather for airside; BEV-LIO(LC) has no radar path.

**Comparison for airside map building:**

| Method | Loop closure | Flat assumption | GPU required | KITTI/MulRan benchmarked | Notes |
|---|---|---|---|---|---|
| FAST-LIO2 (iter 22) | No (front-end only) | None | No | Yes | Needs separate LC backend |
| LIO-SAM | Yes (Scan Context) | None | No | Indirect | Feature extraction degenerates in sparse scenes |
| KISS-ICP (iter 20) | No | None | No | Yes | Fails in degenerate featureless areas |
| KISS-SLAM (iter 32) | Yes (BEV ORB) | None | No | Yes | Classical descriptor; no GPU needed |
| BEV-LIO(LC) | Yes (REIN BEVPlace++) | SE(2) ground plane | Yes | No | GPU required; flat-environment focus |

---

## Implementation Notes

**GPU dependency is non-negotiable as published.** LibTorch REIN inference requires a CUDA-capable device. On a development laptop with RTX 3060 the system runs at 16 Hz. Embedding on Jetson AGX Orin (which has CUDA) is plausible but uncharacterised; note that Jetson's CUDA context startup adds latency to the first descriptor extraction. CPU-only embedded platforms cannot run the system without replacing the REIN module.

**Software prerequisites:** Ubuntu 20.04, ROS Noetic, PCL >= 1.8, Eigen >= 3.3.4, GTSAM >= 4.0, CUDA, LibTorch 2.7.1, livox_ros_driver. Verify GTSAM version compatibility with the FAST-LIO-SAM backend before building; GTSAM 4.x API changes between minor versions can break compilation.

**Loop-closure parameter tuning:** the pose-distance gate τ and the top-k retrieval count are the primary knobs. For large apron environments (>500 m traversal), τ may need widening to allow long-range loop detection; too wide a gate increases false-positive rate. Validate loop-closure acceptance by monitoring RANSAC inlier count and ICP fitness score before accepting a loop factor.

**Keyframe database growth:** the KD-tree keyframe database grows without bound as the vehicle traverses new territory. For multi-shift operations over large facilities, implement a keyframe cull strategy (distance-based subsampling) to bound memory and query latency.

**BEV resolution setting:** the resolution parameter `mu` [m/pixel] governs feature density. Coarser resolution (larger `mu`) speeds up FAST detection and REIN inference but reduces discrimination in areas with fine geometric structure (stand markings, gate labels). Tune against the feature scale of the target environment.

**Dynamic object management:** aircraft, GSE, and ground personnel appear in BEV unless filtered. Use temporal consistency filters or segmentation-based masking before BEV projection in high-traffic areas. Unlike FAST-LIO2 where 3D dynamic points corrupt the ikd-tree map, here the risk is that transient BEV density blobs are stored as keyframe descriptors and trigger false loop retrievals later.

**Comparing against baselines:** pair BEV-LIO(LC) directly against [FAST-LIO2](./fast-lio-fast-lio2.md) with a bolted-on BEVPlace++ loop closure (FAST-LIO-SAM + BEVPlace++ retrieval) to isolate the contribution of the fused BEV reprojection residual in the front end. Without this ablation, it is unclear how much improvement comes from the tighter front-end integration vs. the shared BEVPlace++ descriptor.

**CPU-only fallback design:** if a GPU is unavailable at deployment time, one viable degraded configuration is to replace the REIN descriptor with a classical BEV descriptor (ORB on BEV density image, as used in [KISS-SLAM](./kiss-slam.md)) for loop closure, while retaining the FAST-LIO2-style iEKF front end without the BEV reprojection residual. This yields a system closer to FAST-LIO-SAM with BEV-based loop closure — losing the front-end BEV integration but shedding the GPU requirement. This is an engineering tradeoff to evaluate on a per-deployment basis.

**Covariance for factor-graph fusion:** the iEKF state covariance is available at each scan. For downstream integration into a broader sensor-fusion backend (RTK, wheel odometry, map matching), extract the position and orientation covariance blocks from the iEKF P matrix after the update step and pass them as the odometry factor noise model. The paper does not describe a specific interface for this; implementation requires reading the internal state from the FAST-LIO2-inherited state structure.

---

## Practical Recommendation

Use BEV-LIO(LC) as the primary LIO candidate when all of the following hold:

1. The operating environment is predominantly flat (apron, logistics yard, warehouse floor, structured road).
2. A CUDA-capable GPU (or Jetson AGX Orin with GPU runtime) is available for deployment.
3. A complete integrated loop-closure pipeline is needed without building a separate descriptor database module on top of a bare front-end like FAST-LIO2.
4. The mission includes repeated traversal of known areas (multi-shift operations, patrol routes) where accumulated odometry drift is the primary accuracy concern.

Use [FAST-LIO2](./fast-lio-fast-lio2.md) or [KISS-ICP](./kiss-icp.md) instead when:

- No GPU is available.
- The environment has significant vertical structure (multi-level, ramps, crane zones) where BEV z-collapse loses discriminative geometry.
- Canonical KITTI/MulRan benchmark comparisons are required for system acceptance tests — BEV-LIO(LC) cannot provide these.
- A bare odometry front-end is preferred and loop closure will be handled by a separately validated module.

Use [KISS-SLAM](./kiss-slam.md) (iter 32) instead when a full SLAM pipeline with loop closure is needed but GPU deployment is not possible — KISS-SLAM uses classical BEV ORB descriptors and is CPU-deployable.

For production airside stacks, treat BEV-LIO(LC) as a well-motivated research baseline that is not yet deployment-characterised for aviation environments. The flat-environment design intent aligns with apron geometry; the GPU dependency, absent canonical benchmarks, and untested aircraft-fuselage ambiguity are concrete gaps to close before committing to this method in a safety case.

A staged evaluation approach is recommended: (1) run BEV-LIO(LC) alongside [FAST-LIO2](./fast-lio-fast-lio2.md) on the same sensor logs, comparing ATE before and after loop closure; (2) evaluate loop-closure precision and recall specifically in areas with repetitive layout (multiple identical gate stands, parallel taxiways); (3) characterise GPU headroom on the target embedded platform; (4) test near large aircraft to expose fuselage BEV ambiguity empirically. Only after these four steps does committing to BEV-LIO(LC) over a simpler GPU-free pipeline become justifiable.

---

## Sources

- Cai, H., Yuan, S., Li, X., Guo, J., Liu, J. "BEV-LIO(LC): BEV Image Assisted LiDAR-Inertial Odometry with Loop Closure." IROS 2025. arXiv:2502.19242. https://arxiv.org/abs/2502.19242
- Paper HTML v2: https://arxiv.org/html/2502.19242v2
- Paper PDF: https://arxiv.org/pdf/2502.19242
- Official repository (HxCa1/BEV-LIO-LC): https://github.com/HxCa1/BEV-LIO-LC
- BEVPlace++ / REIN (arXiv:2408.01841): https://arxiv.org/abs/2408.01841
- BEV-LSLAM (parallel work, ResearchGate): https://www.researchgate.net/publication/388214677
- FAST-LIO-SAM reference implementation: https://github.com/engcang/FAST-LIO-SAM
- Local context: [FAST-LIO and FAST-LIO2](./fast-lio-fast-lio2.md)
- Local context: [KISS-ICP](./kiss-icp.md)
- Local context: [KISS-SLAM](./kiss-slam.md)
- Local context: [LIO-SAM](./lio-sam.md)
- Local context: [Learned LiDAR Place Recognition](./learned-lidar-place-recognition.md)
- Local context: [Loop Closure and Place Recognition](./loop-closure-place-recognition.md)
- Local context: [Scan Context Family](./scan-context-family.md)
- Local context: [GenZ-ICP / GenZ-LIO](./genz-icp-genz-lio.md)
- Local context: [Continuous-Time Registration](./continuous-time-registration.md)
- Local context: [LiDAR Bundle Adjustment Factors](./lidar-bundle-adjustment-factors.md)
- Local context: [GraphSLAM and Pose Graph Optimization](./graphslam-pose-graph-optimization.md)
- Local context: [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md)
- KB: [Lie Groups SE(3) / SO(3) Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md)
- KB: [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md)
