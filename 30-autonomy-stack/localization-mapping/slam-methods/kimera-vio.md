# Kimera-VIO

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "modern-core"
  maturity: "fielded-pattern"
  tags: ["slam", "fallback", "gnss-denied", "indoor", "validation"]
  reason: "Kimera-VIO is rated for visual or visual-inertial SLAM coverage, especially fallback and GNSS-denied use."
method-priority:end -->

Related docs: [Kimera-Multi](./kimera-multi.md) · [Kimera-RPGO and PCM](./kimera-rpgo-pcm.md) · [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) · [KISS-SLAM](./kiss-slam.md) · [ORB-SLAM2 / ORB-SLAM3](./orb-slam2-orb-slam3.md) · [OpenVINS](./openvins.md) · [OKVIS2-X](./okvis2-x.md) · [DROID-SLAM](./droid-slam.md) · [Loop Closure and Place Recognition](./loop-closure-place-recognition.md) · [Certifiable Pose Graph Optimization](./certifiable-pose-graph-optimization.md) · [Distributed Multi-Robot PGO](./distributed-multi-robot-pgo.md) · [Semantic SLAM](./semantic-slam.md) · [Dynamic Object-Aware SLAM](./dynamic-object-aware-slam.md) · [LT-Mapper / Khronos Lifelong Mapping](./lt-mapper-khronos-lifelong-mapping.md) · [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [Mapping and Localization](../overview/mapping-and-localization.md) · [Robust State Estimation and Multi-Sensor Localization Fusion](../overview/robust-state-estimation-multi-sensor.md) · [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) · [Point Cloud Registration — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md)

**Last updated:** 2026-05-24

---

## What It Is

**Kimera-VIO** is the visual-inertial odometry engine at the heart of the MIT-SPARK Kimera stack (Rosinol, Abate, Chang, and Carlone, ICRA 2020; arXiv 1910.02490). It is an open-source, real-time, modular C++ library for metric-semantic visual-inertial SLAM. The VIO component fuses stereo (or RGB-D, or monocular) images with IMU measurements into a continuous 6-DoF trajectory using a GTSAM-iSAM2 factor-graph back-end with optional loop closure through Kimera-RPGO.

Kimera-VIO is the production-grade CPU-only visual-inertial odometry benchmark. It distinguishes itself from OKVIS, VINS-Mono, and ROVIO not only through accuracy on EuRoC, but by providing integrated mesh reconstruction and semantic labeling as first-class outputs. It is the **front-end odometry provider for every downstream MIT-SPARK system**: Kimera-Semantics, Kimera-Multi, Hydra, and Khronos each consume Kimera-VIO poses without modifying its internals.

**Primary citation:** Rosinol, A., Abate, M., Chang, Y., and Carlone, L. "Kimera: an Open-Source Library for Real-Time Metric-Semantic Localization and Mapping." ICRA 2020. arXiv: https://arxiv.org/abs/1910.02490

**GitHub:** https://github.com/MIT-SPARK/Kimera-VIO · https://github.com/MIT-SPARK/Kimera-VIO-ROS

**License:** BSD (favorable; third-party dependency licenses require separate review).

---

## Core Technical Idea

Kimera-VIO is a **modular open-source VIO** built on three cooperating modules connected by lock-free queues: a frame-rate visual front-end (Shi-Tomasi + KLT), a keyframe-rate GTSAM-iSAM2 fixed-lag smoother back-end, and an optional loop-closure module (DBoW2 + RANSAC + PCM + Kimera-RPGO). The defining design choices are:

- **Structureless smart factors** — 3D landmarks are analytically marginalized per feature track via Direct Linear Transform, keeping the optimized state proportional to keyframe count rather than landmark count.
- **On-manifold IMU pre-integration** — Forster/Carlone TRO 2017 formulation; bias-decoupled, efficiently correctable without re-integrating raw measurements.
- **Fixed-lag smoothing** — states outside the lag window are marginalized into prior factors, bounding memory and compute.
- **PCM outlier rejection** — loop closures are screened by Pairwise Consistency Maximization (maximum-clique formulation) before entering the pose graph, resisting perceptual aliasing.

**Training-free.** Kimera-VIO uses no learned components. Shi-Tomasi corners, KLT optical flow, DBoW2 BoW retrieval, RANSAC, GTSAM, and PCM are all deterministic classical algorithms. Any external 2D segmentation network plugged into Kimera-Semantics is optional and not part of the VIO pipeline.

---

## Architecture

Kimera-VIO runs as a parallel pipeline of modules communicating through lock-free queues. Modules execute in separate threads; the front-end runs at frame rate; the back-end runs at keyframe rate.

```
Data Provider --> [Frontend Queue] --> Frontend --> [Backend Queue] --> Backend (iSAM2)
                                          |                                   |
                                     Loop Closure                       Kimera-RPGO
                                       (DBoW2)                     (Pose Graph Opt.)
                                          |                                   |
                                     [LCD Queue] ----------------------------+
```

### Front-End

**Feature detection and tracking (frame-rate):**

- Corner detection: Shi-Tomasi (Harris score) with Adaptive Non-Maximum Suppression (ANMS) for uniform spatial coverage.
- Temporal tracking: Lucas-Kanade (KLT) optical flow — tracks features between frames without re-detection; computationally cheap.
- Stereo matching: features from the left image are matched to the right via block matching; epipolar constraints applied.
- Intermediate frames (between keyframes): tracking only, producing high-frequency pose propagation.

**Keyframe selection:** triggered when feature tracks degrade — disparity threshold exceeded, too many lost tracks, or temporal interval elapsed.

**Geometric verification (keyframe-rate only):**

- Monocular path: 5-point RANSAC on matched feature pairs — estimates essential matrix, rejects outliers.
- Stereo path: 3-point RANSAC exploiting the known stereo baseline.
- IMU-assisted path: 2-point or 1-point RANSAC using IMU rotation priors to constrain geometry — lower cost, more robust at high angular rates.

**Timing:** ~4.5 ms per intermediate frame; ~45 ms at keyframes (detection + stereo matching + RANSAC).

### Back-End: GTSAM-iSAM2 Fixed-Lag Smoother

The VIO back-end is a **factor graph** solved incrementally by GTSAM's iSAM2 (incremental Smoothing and Mapping version 2). Fixed-lag smoothing marginalizes states outside the lag window into prior factors, maintaining a bounded estimation problem.

**State vector per keyframe k:**

```
X_k = { R_k (SO(3) rotation),  p_k (R^3 position),  v_k (R^3 velocity),
         b_a_k (R^3 accel. bias),  b_g_k (R^3 gyro. bias) }
```

**Factor types in the graph:**

1. **Preintegrated IMU Factor** — encodes all raw IMU measurements between keyframes k and k+1 as a single relative-motion constraint on (R, p, v, b_a, b_g). See Operator Mathematics section.

2. **Structureless Vision Factors (Smart Factors)** — a feature track spanning multiple keyframes is a single factor that analytically marginalizes the 3D point via DLT. Graph size stays proportional to keyframe count, not landmark count — critical for efficiency at scale.

3. **Stereo Reprojection Factor** — the stereo residual for a feature seen in frames i..k is the reprojection error in both left and right images:

   ```
   r_proj = [u_L - pi_L(R_k p_w + t_k),  u_R - pi_R(R_k p_w + t_k + t_stereo)]
   ```

   where `pi_L`, `pi_R` are the left/right camera projection models and `p_w` is the landmark in world frame.

4. **Bias Evolution Factors** — IMU biases evolve as a Gaussian random walk: `b_{k+1} = b_k + w_b` where `w_b ~ N(0, Q_b * dt)`. Encoded as a between-factor on consecutive bias states; the factor graph updates bias estimates each keyframe.

5. **Loop Closure Factor** — when a valid loop closure is accepted by PCM, a relative-pose factor between the current and a past keyframe is inserted into the graph.

**Optimization engine:** GTSAM iSAM2 performs variable reordering (COLAMD/BayesTree) and sparse Cholesky factorization, updating only affected cliques on each new measurement. Per-keyframe cost is approximately O(n) for sparse graphs.

**Implementation note:** Kimera-VIO requires GTSAM built with `GTSAM_TANGENT_PREINTEGRATION=OFF` (uses the RSS 2015 manifold preintegration). Tested with GTSAM >= 4.1.

**Back-end timing:** < 40 ms per keyframe on a standard CPU for EuRoC-scale trajectories.

### Loop-Closure Module (Optional)

Loop closure is disabled by default; enabled via `-lcd` flag or config parameter.

**Pipeline:**

1. **Appearance retrieval:** DBoW2 bag-of-words descriptor computed at each keyframe. Candidate loop keyframes retrieved by DBoW2 score above threshold.
2. **Geometric verification:** Putative correspondences between current and candidate keyframe features validated by RANSAC (essential matrix or PnP). Matches below inlier threshold are rejected.
3. **Outlier rejection — PCM:** Accepted geometric verifications are passed to Pairwise Consistent Measurement Set Maximization (PCM, Mangelson et al., ICRA 2018). PCM frames outlier rejection as a maximum clique problem: it finds the largest subset of loop closures that are mutually pairwise consistent within chi-squared thresholds. Critical for resisting perceptual aliasing in repeated-texture environments.
4. **Pose graph correction:** Accepted loop closures feed Kimera-RPGO, which re-estimates the global trajectory using GTSAM after PCM screening.

**Timing:** Kimera-RPGO averages ~55 ms on EuRoC sequences.

**Kimera2 upgrade (2024):** The Kimera2 paper (Abate et al., Springer Tracts 2024; arXiv 2401.06323) replaces PCM with Graduated Non-Convexity (GNC) for more robust rejection under high outlier rates, and extends sensor modalities to include wheel odometry. See [Certifiable Pose Graph Optimization](./certifiable-pose-graph-optimization.md) for the GNC mathematics.

---

## Inputs and Outputs

**Inputs:**

- Stereo camera pair (left + right grayscale, global-shutter preferred) synchronized with IMU, **or** RGB-D + IMU, **or** monocular + IMU (scale unobservable in mono mode).
- IMU at ~200 Hz; camera at 10–30 Hz.
- Camera intrinsics, stereo extrinsics, camera-IMU extrinsics, and accurate hardware timestamps.

**Outputs:**

- Per-frame and per-keyframe 6-DoF poses (SE(3)) in the local odometry frame.
- Sparse feature-track structure (not retained as a persistent landmark map).
- Optional: globally corrected trajectory after Kimera-RPGO loop closure.
- Consumed by downstream modules: Kimera-Semantics adds per-frame semantic-class fusion onto a Voxblox mesh; Kimera-Multi adds inter-robot distributed PGO; Hydra adds hierarchical scene graphs; Khronos adds spatio-temporal dynamics.

---

## Operator Mathematics

### IMU Pre-Integration

Kimera-VIO implements the on-manifold IMU pre-integration theory from Forster, Carlone, Dellaert, and Scaramuzza (TRO 2017; RSS 2015 presentation). See [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) for the manifold foundations.

**Raw IMU measurements** between keyframes i and j at ~200 Hz:

```
a_m(t) = R(t)^T (a_w(t) - g) + b_a(t) + n_a
omega_m(t) = omega_b(t) + b_g(t) + n_g
```

where `g` is gravity, `b_a`, `b_g` are slowly-varying biases, and `n_a`, `n_g` are white Gaussian noise.

**Pre-integrated relative quantities** accumulated in the body frame of keyframe i (bias-decoupled, reusable across linearization updates):

```
Delta_R_{ij} = prod_{k=i}^{j-1} Exp((omega_m(t_k) - b_g) * dt)    [in SO(3)]

Delta_v_{ij} = sum_{k=i}^{j-1} Delta_R_{ik} * (a_m(t_k) - b_a) * dt    [in R^3]

Delta_p_{ij} = sum_{k=i}^{j-1} [Delta_v_{ik} * dt
               + 0.5 * Delta_R_{ik} * (a_m(t_k) - b_a) * dt^2]          [in R^3]
```

**IMU factor residual** given state estimates at keyframes i and j:

```
r_R  = Log(Delta_R_{ij}^T * R_i^T * R_j)                              [SO(3) residual]
r_v  = R_i^T * (v_j - v_i - g * dt_{ij}) - Delta_v_{ij}              [velocity]
r_p  = R_i^T * (p_j - p_i - v_i * dt_{ij} - 0.5*g*dt^2) - Delta_p_{ij}  [position]
r_ba = b_a_j - b_a_i                                                   [accel. bias walk]
r_bg = b_g_j - b_g_i                                                   [gyro. bias walk]
```

where `Log(.)` is the SO(3) logarithmic map to a tangent vector.

**First-order bias correction without re-integration:** when bias estimates change between optimization iterations, the preintegrated quantities are updated analytically using Jacobians computed during the original integration pass:

```
Delta_R_{ij}(b_g') ~ Delta_R_{ij}(b_g) * Exp(J_R^bg * delta_b_g)
Delta_v_{ij}(b')   ~ Delta_v_{ij}(b) + J_v^ba * delta_b_a + J_v^bg * delta_b_g
Delta_p_{ij}(b')   ~ Delta_p_{ij}(b) + J_p^ba * delta_b_a + J_p^bg * delta_b_g
```

This avoids re-integrating hundreds of raw IMU samples whenever bias estimates shift — the core efficiency gain of the manifold pre-integration approach.

**Bias random walk:** biases are modeled as Brownian motion (integrated white noise):

```
b_a_dot = n_ba,    n_ba ~ N(0, sigma_ba^2 * I)
b_g_dot = n_bg,    n_bg ~ N(0, sigma_bg^2 * I)
```

Discrete: `b_{k+1} = b_k + w_b * sqrt(dt)`. The bias between-factor covariance: `Q_b = diag(sigma_ba^2, sigma_bg^2) * dt`.

### SE(3) Pose-Graph Factor (Loop Closure and Kimera-RPGO)

```
T_{ij}^meas = T_i^{-1} * T_j    in SE(3)

r_pose = Log(T_{ij}^meas^{-1} * T_i^{-1} * T_j)    in R^6
```

where `Log(.)` is the SE(3) logarithm returning a twist `(omega, v)` in `se(3)`. See [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) for the full derivation.

---

## Pipeline Integration: The Kimera Ecosystem

Kimera-VIO is the odometry engine consumed without modification by every downstream MIT-SPARK system.

### Kimera-Semantics (RAL 2020)

Kimera-Semantics subscribes to Kimera-VIO pose output and per-frame depth/RGB images plus semantic segmentation masks (from any 2D segmentation network). It fuses these into a volumetric map using Voxblox (TSDF voxel hashing + marching cubes). Each voxel stores a signed distance field value and a semantic class probability vector. The fast semantic TSDF integrator ray-casts depth measurements into the voxel grid and updates both geometric and semantic fields simultaneously. Throughput: ~0.1 s per keyframe update. Output: globally consistent 3D mesh with per-triangle semantic class labels.

Drift in VIO directly causes semantic map distortion; loop closure correction in RPGO can trigger mesh deformation.

GitHub: https://github.com/MIT-SPARK/Kimera-Semantics

### Hydra (RSS 2022)

Hydra adds a hierarchical 3D scene graph (DSG) above the Kimera-VIO/Kimera-Semantics layer. Layer 1 is the metric-semantic Voxblox mesh. Layer 2 (places/topological nodes) is built from ESDF skeleton extraction. Layer 3 (rooms) uses community-detection clustering of place nodes. Layer 4 (buildings) is the top-level semantic grouping. Graph edges encode metric distances. Loop closures propagate corrections through all layers simultaneously using embedded deformation graphs.

Later Hydra versions dropped Kimera-Semantics in favor of a `spatial_hash` module and integrated DBoW2 for hierarchical loop closure across scene-graph layers.

GitHub: https://github.com/MIT-SPARK/Hydra · arXiv: https://arxiv.org/abs/2201.13360

### Kimera-Multi (T-RO 2022)

Each robot runs Kimera-VIO independently as its single-robot front-end, building a local trajectory and local 3D mesh. Kimera-Multi handles distributed inter-robot loop closure detection (DBoW2 peer-to-peer), distributed PCM outlier rejection, and distributed Graduated Non-Convexity PGO (DPGO) without a central server. After trajectory correction, mesh deformation propagates pose corrections into each robot's local 3D mesh. Demonstrated at 8 robots / 8 km. See [Kimera-Multi](./kimera-multi.md) and [Distributed Multi-Robot PGO](./distributed-multi-robot-pgo.md).

### Khronos — Spatio-Temporal SLAM (RSS 2024 Outstanding Systems Paper)

Khronos extends the Hydra scene-graph framework to handle dynamic environments at two timescales: short-term (detecting and tracking moving objects in real time) and long-term (identifying persistent scene modifications across sessions). Kimera-VIO is explicitly listed as its front-end odometry source. Tested on Ubuntu 24.04 with ROS 2 Jazzy.

GitHub: https://github.com/MIT-SPARK/Khronos · See [LT-Mapper / Khronos Lifelong Mapping](./lt-mapper-khronos-lifelong-mapping.md).

### Kimera2 (Springer Tracts 2024)

Single-robot hardening pass on the full Kimera stack. Upgrades Kimera-RPGO from PCM to GNC; extends sensor modalities to include wheel odometry; broader real-world evaluation (drones, quadrupeds, wheeled robots, simulated self-driving cars). Claims to outperform VINS-Fusion and ORB-SLAM3 on multiple benchmarks.

arXiv: https://arxiv.org/abs/2401.06323

---

## MIT-SPARK Lab Ecosystem Timeline

| Year | System | Venue | Key Contribution |
|---|---|---|---|
| ICRA 2019 | Kimera-Mesher | ICRA 2019 | Incremental 3D mesh from stereo-VIO |
| ICRA 2020 | **Kimera-VIO** | ICRA 2020 | Open-source metric-semantic VIO library (arXiv 1910.02490) |
| RAL 2020 | Kimera-Semantics | RAL 2020 | Semantic TSDF fusion on Voxblox mesh |
| T-RO 2022 | Kimera-Multi | T-RO 2022 (Best Paper) | Distributed multi-robot SLAM with DPGO (arXiv 2106.14386) |
| RSS 2022 | Hydra | RSS 2022 | Real-time hierarchical 3D scene graph (arXiv 2201.13360) |
| RSS 2024 | Khronos | RSS 2024 (Outstanding Systems Paper) | Spatio-temporal SLAM in dynamic environments |
| 2024 | Kimera2 | Springer Tracts 2024 | GNC outlier rejection; multi-modal sensors; robustness hardening (arXiv 2401.06323) |

Kimera-VIO's role is fixed across all systems: it is the shared stereo-inertial odometry front-end. Downstream systems extend the map representation and multi-agent capabilities without touching the VIO internals. All repositories: https://github.com/MIT-SPARK

---

## Benchmark Results

EuRoC MAV (Burri et al., IJRR 2016) is the canonical VIO benchmark: 11 stereo-IMU sequences on a MAV in an industrial hall and machine room, ranging from easy (MH_01) to difficult (V2_03, aggressive motion).

### Kimera-VIO Paper Results (Table II, arXiv 1910.02490)

RMSE ATE [meters], stereo configuration. Source: ar5iv rendering of the paper.

| Sequence | OKVIS | ROVIO | VINS-Mono | Kimera-VIO | Kimera-RPGO |
|---|---|---|---|---|---|
| MH_01 (easy) | 0.16 | 0.21 | 0.15 | **0.11** | 0.08 |
| MH_02 (easy) | 0.22 | 0.25 | 0.15 | **0.10** | 0.09 |
| MH_03 (medium) | 0.24 | 0.25 | 0.22 | **0.16** | 0.11 |
| MH_04 (difficult) | 0.34 | 0.49 | 0.32 | **0.24** | 0.15 |
| MH_05 (difficult) | 0.47 | 0.52 | 0.30 | 0.35 | 0.24 |
| V1_01 (easy) | 0.09 | 0.10 | 0.08 | **0.05** | 0.05 |
| V1_02 (medium) | 0.20 | 0.10 | 0.11 | **0.08** | 0.11 |
| V1_03 (difficult) | 0.24 | 0.14 | 0.18 | **0.07** | 0.12 |
| V2_01 (easy) | 0.13 | 0.12 | 0.08 | 0.08 | 0.07 |
| V2_02 (medium) | 0.16 | 0.14 | 0.16 | **0.10** | 0.10 |
| V2_03 (difficult) | 0.29 | 0.14 | 0.27 | 0.21 | 0.19 |

**Key observations:**

- Kimera-VIO without loop closure beats OKVIS and VINS-Mono on 8 of 11 sequences.
- Kimera-RPGO with loop closure further reduces ATE on most sequences. Exceptions are V1_02 and V1_03, where loop closure adds a small penalty — attributed in the paper's discussion to perceptual aliasing on those sequences.
- V2_03 (fast rotations, poor lighting) is the hardest sequence: Kimera-VIO 0.21 m vs ROVIO 0.14 m. ROVIO (filter-based) is more robust here, suggesting that in extreme dynamics the fixed-lag smoother's keyframe-rate assumption creates a coverage gap.
- MH_05 (0.35 m) is the other difficult case: fast rotations cause motion blur and KLT feature loss.

### Broader Comparison Context

The following comparisons draw on arXiv 2108.01654 and OKVIS2-X results from later surveys:

| System | Architecture | EuRoC ATE range | Notes |
|---|---|---|---|
| Kimera-VIO (ICRA 2020) | Factor graph, fixed-lag smoother | 0.05–0.35 m | This page; open-source C++ |
| ORB-SLAM3 (T-RO 2021) | Relocalization + full map reuse | 0.03–0.09 m | Outperforms Kimera on nearly all sequences; full map reuse gives advantage |
| OpenVINS (ICRA 2020) | MSCKF filter | 0.05–0.35 m | Lower CPU cost; best in 4/6 RPE metrics on some splits. See [OpenVINS](./openvins.md). |
| VINS-Fusion (T-RO 2019) | Sliding window optimization | Comparable to Kimera-VIO | Similar architecture philosophy, no modular ecosystem |
| OKVIS2 (arXiv 2022) | Keyframe BA + scalable loop closure | Claims best open-source EuRoC accuracy | 41% ATE reduction vs. OpenVINS/Kimera2 in VIO-only comparison; -X variant adds LiDAR and GNSS. See [OKVIS2-X](./okvis2-x.md). |
| Basalt (RA-L 2020) | Non-linear factor graph with VI pre-integration | ~0.03 m on V1_01 | Competitive; not commonly integrated in full semantic stacks |

**Practical usability note (arXiv 2108.01654 comparative study):** Kimera was described as having "a nice modular concept with great opportunities but low usability" and "hard to launch on datasets other than EuRoC." Build-system friction — GTSAM version pinning, DBoW2 vocabulary file paths, OpenCV version sensitivity — is a real deployment barrier compared to ORB-SLAM3 or OpenVINS.

---

## Strengths

**Open-source and modular — BSD license.** Clean C++ with ROS1 interface. VIO-only operation is valid without mesh or semantics. Actively maintained by MIT SPARK Lab through Kimera2, Khronos (2024–2025 releases).

**Production-grade GTSAM back-end.** iSAM2 is the gold-standard incremental factor-graph smoother. Fixed-lag smoothing bounds memory and compute; smart factors keep graph size manageable; numerically robust on EuRoC-class trajectories.

**Canonical IMU pre-integration theory.** Uses the Forster-Carlone manifold pre-integration — the same formulation adopted by GTSAM's `ImuFactor` and widely validated across the VIO community. Bias random walk model is principled and auditable.

**Modular ecosystem interface.** Kimera-VIO exposes a well-defined pose + keyframe interface consumed without modification by Kimera-Semantics, Kimera-Multi, Hydra, and Khronos. This makes it a stable substrate for adding semantic, multi-robot, and spatio-temporal capabilities incrementally.

**Loop closure quality.** DBoW2 + RANSAC + PCM (or GNC in Kimera2) is robust to perceptual aliasing relative to pure appearance-based methods. The maximum-clique consistency check is the same mechanism used in Kimera-Multi's inter-robot loop closure pipeline. See [Loop Closure and Place Recognition](./loop-closure-place-recognition.md).

---

## Failure Modes

| Failure Mode | Trigger | Severity |
|---|---|---|
| Feature starvation | Texture-poor walls, reflective floors, overexposed/underexposed regions | Fatal — VIO diverges |
| Motion blur | Fast aggressive rotations; reported on V2_03 at ~180+ deg/s with EuRoC-class cameras | Severe — KLT tracking drops; IMU-only propagation drifts |
| Scale drift (mono) | Monocular mode without stereo baseline | Moderate — scale unobservable; use stereo or RGB-D |
| False loop closures | Repeated visual patterns (symmetrical terminals, identical gate areas) | Moderate — PCM/GNC mitigates but does not eliminate |
| IMU initialization failure | Insufficient static period before motion; large accelerometer bias | Severe — bad bias initialization corrupts entire trajectory |
| Illumination change | Day/night transition or sudden direct sunlight during long survey | Moderate — DBoW2 appearance descriptors are illumination-sensitive |
| Build system friction | GTSAM version mismatch, DBoW2 vocabulary path, OpenCV version | Operational — prevents deployment outside EuRoC-tested configurations |
| Large-scale compute growth | Multi-kilometer trajectories with intermittent loop closures | Moderate — fixed-lag marginalization accumulates covariance fill-in |

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Indoor inspection — textured environments | High | Core use case; stereo + IMU handles GPS-denied zones; mesh output useful |
| Outdoor campus / urban survey (stereo + IMU) | High | Demonstrated use case; adequate texture from facades, signs, infrastructure |
| Warehouse / logistics-yard multi-robot mapping | Moderate | Adequate texture in most warehouses; ROS1 dependency is friction; LiDAR fleets prefer FAST-LIO2 + Swarm-SLAM |
| Airside survey — visual-inertial cross-check | Moderate | Parallel cross-check alongside FAST-LIO2; indoor sub-zones with GPS-denied areas |
| Airside survey — LiDAR-primary | Low | Not LiDAR-native; use [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) or [KISS-SLAM](./kiss-slam.md) as primary |
| Port / logistics-yard | Low | LiDAR preference; Swarm-SLAM + DPGO more appropriate |
| Underground / mining | Not suitable | No LiDAR; lighting conditions defeat visual tracking |
| Delivery robots — GPS-denied indoor | Moderate | Scale fits; GPU not required; ROS1 is friction |

---

## Aggregated-Map Suitability: Honest Assessment

### What Kimera-VIO Is

A **visual-inertial odometry front-end**. It produces 6-DoF poses at camera/keyframe rate. Its native output is a trajectory plus an optional 3D mesh colored by semantic labels. It is not a LiDAR SLAM system. It does not process point clouds, does not perform scan-to-map registration, and cannot exploit the geometric richness of LiDAR returns in environments with repetitive visual texture but distinctive 3D structure.

### For LiDAR-Primary Airside Survey

The primary front-end options for LiDAR-primary survey — [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) and [KISS-SLAM](./kiss-slam.md) — are the correct tools. These systems:

- Directly process 3D point clouds (Ouster OS1/OS2, Velodyne VLP-32C, Hesai QT64) at 10–20 Hz.
- Fuse IMU within an Iterated Extended Kalman Filter (FAST-LIO2) or KISS-ICP registration loop (KISS-SLAM).
- Achieve cm-level ATE on flat outdoor environments where visual systems degrade: featureless apron, rain, direct sunlight, aircraft skin reflections.

For point cloud registration mathematics see [Point Cloud Registration — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md).

### Kimera-VIO's Legitimate Roles in an Airside Survey Pipeline

**Role 1 — Parallel visual-inertial cross-check.** Run Kimera-VIO alongside FAST-LIO2 on a survey robot carrying both camera+IMU and LiDAR. Fuse the two trajectory estimates (factor graph or EKF-level fusion) for mutual validation and graceful degradation when one sensor is occluded or fails.

**Role 2 — Per-robot front-end in Kimera-Multi.** If the survey uses multiple ground vehicles sweeping terminal zones, each vehicle runs Kimera-VIO as its local odometry source, and Kimera-Multi handles inter-robot loop closure and distributed PGO. The per-robot mesh can be semantically labeled by any 2D segmentation model covering airside classes.

**Role 3 — Camera-based semantic annotation of LiDAR maps.** Kimera-Semantics overlays 2D semantic segmentation onto the VIO-aligned mesh. Even if the primary map is LiDAR-derived, camera-based semantic labels (using Kimera-VIO poses for camera localization) can enrich the map with class labels that LiDAR geometry alone cannot provide. See [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) and [Semantic SLAM](./semantic-slam.md).

**Role 4 — Indoor GPS-denied sub-zones.** Inside terminal buildings, jetways, or cargo holds where LiDAR returns are poor (dense reflective glass, low ceiling clutter), Kimera-VIO may provide adequate short-duration odometry for these constrained sub-tasks.

### Summary Judgment

For LiDAR-primary aggregated map building in the airside domain, Kimera-VIO is **complementary, not primary**. Its value is the Kimera ecosystem's modular integration (semantic mesh, multi-robot, scene graph) and visual-inertial cross-reference capability. Any deployment plan should flag this distinction clearly to avoid mis-application. See also [Dynamic Object-Aware SLAM](./dynamic-object-aware-slam.md) for the dynamic-environment overlay that the Kimera stack currently lacks natively.

---

## Implementation Notes

- **ROS 1 dependency is real friction.** The reference stack targets ROS Noetic. ROS 2 integration requires wrapping and porting work. For ROS 2 native multi-robot LiDAR SLAM, Swarm-SLAM is the off-the-shelf alternative.
- **Start with single-robot VIO validation before adding semantics or multi-robot.** Per-robot odometry quality must be solid before inter-robot loop closures or semantic mesh outputs are meaningful.
- **GTSAM version pinning.** Build with `GTSAM_TANGENT_PREINTEGRATION=OFF`. Mismatched GTSAM versions are the most common build failure. Pin to GTSAM >= 4.1 as tested.
- **DBoW2 vocabulary file path.** The loop-closure module requires the DBoW2 vocabulary binary at a configured path; missing this is the second most common launch failure on new environments.
- **Camera-IMU calibration dominates performance.** Intrinsics, stereo extrinsics, camera-IMU extrinsics, and time offset all affect accuracy. Re-calibrate after mechanical service. Validate on-site before any survey run.
- **IMU vibration on ground-support equipment.** EuRoC IMU noise parameters are tuned for MAV vibration profiles. Ground-support equipment (tugs, belt loaders) may introduce different vibration signatures. Tune `sigma_ba`, `sigma_bg` and IMU noise density parameters on the actual vehicle.
- **Semantic label domain adaptation.** Kimera-Semantics propagates labels from any 2D segmentation network. Cityscapes-trained models do not contain airside classes (taxiway markings, aircraft stands, apron zones, ground equipment). A model covering these classes must be substituted.
- **Loop closure threshold tuning.** The default DBoW2 similarity threshold and RANSAC inlier threshold (15) were tuned on campus outdoor sequences. Tighten thresholds in new environments to reduce false-positive loop closures near visually similar stands and gate areas. Treat loop closure as disabled or advisory until false-positive rates are measured.
- **Dynamic object contamination.** Kimera-Multi has no native dynamic object detection. Moving vehicles, aircraft, and ground crew will be fused into the static mesh. Pair with a motion-segmentation front-end. See [Dynamic Object-Aware SLAM](./dynamic-object-aware-slam.md).
- **Audit all sub-repo versions together.** The index repo (MIT-SPARK/Kimera) pins specific commits of all sub-repos. Pulling sub-repos at HEAD independently typically breaks the integration.
- **BSD license is favorable.** Third-party dependency licenses (GTSAM, DBoW2, OpenCV, Kimera-RPGO) still require separate review before any product use.

---

## Datasets and Metrics

**Reference datasets:**

- EuRoC MAV: the canonical VIO benchmark for Kimera-VIO; all paper results above are from EuRoC.
- TUM-VI: high-resolution fisheye visual-inertial sequences; Kimera examples are EuRoC-centered.
- KITTI Odometry: vehicle-scale stereo VO comparisons; not a direct VIO benchmark.
- Custom airport/airside datasets are required for any airside deployment claims.

**Metrics:**

- ATE / APE RMSE in meters after SE(3) alignment.
- RPE over fixed time and distance intervals.
- Drift per 100 m and per minute.
- Initialization success rate and time to initialize.
- Feature tracking uptime and reset rate.
- Bias convergence and IMU residual consistency.
- Loop-closure precision/recall and false-positive rate.
- Pose-graph correction magnitude after loop closure.
- Mesh accuracy and completeness when dense reconstruction is evaluated.
- Runtime, CPU load, frame latency, and IMU-rate output availability.

Airside-specific metrics: pose error during GNSS outages, covariance growth under terminal cover, false loop closures across visually similar stands, mesh artifacts from aircraft and moving GSE, localization error near stand stop lines, hold markings, and service-road boundaries.

---

## Sources

**Primary paper and repository:**

- Rosinol, Abate, Chang, Carlone. "Kimera: an Open-Source Library for Real-Time Metric-Semantic Localization and Mapping." ICRA 2020. https://arxiv.org/abs/1910.02490
- Kimera-VIO GitHub: https://github.com/MIT-SPARK/Kimera-VIO
- Kimera-VIO-ROS GitHub: https://github.com/MIT-SPARK/Kimera-VIO-ROS
- Kimera-RPGO GitHub: https://github.com/MIT-SPARK/Kimera-RPGO
- MIT SPARK Lab blog: https://web.mit.edu/sparklab/2019/10/13/Kimera__an_Open-Source_Library_for_Real-Time_Metric-Semantic_Localization_and_Mapping.html

**IMU pre-integration theory:**

- Forster, Carlone, Dellaert, Scaramuzza. "On-Manifold Preintegration for Real-Time Visual-Inertial Odometry." TRO 2017 (RSS 2015). https://rpg.ifi.uzh.ch/docs/TRO16_forster.pdf
- GTSAM IMU Factor Example: https://gtbook.github.io/gtsam-examples/ImuFactorExample101.html

**Kimera ecosystem papers:**

- Kimera-Semantics (RAL 2020): https://github.com/MIT-SPARK/Kimera-Semantics
- Kimera-Multi (T-RO 2022): https://arxiv.org/abs/2106.14386 · https://github.com/MIT-SPARK/Kimera-Multi
- Hydra (RSS 2022): https://arxiv.org/abs/2201.13360 · https://github.com/MIT-SPARK/Hydra
- Khronos (RSS 2024): https://github.com/MIT-SPARK/Khronos
- Kimera2 (Springer Tracts 2024): https://arxiv.org/abs/2401.06323

**Loop closure and outlier rejection:**

- PCM (Mangelson et al., ICRA 2018): https://ieeexplore.ieee.org/document/8460217/
- Kimera-RPGO Semantic Scholar: https://www.semanticscholar.org/paper/Pairwise-Consistent-Measurement-Set-Maximization-Mangelson-Dominic/553d79fa20ed980754188105b8d91f51f8dc1e7b

**Comparison systems and benchmarks:**

- OKVIS2 (arXiv 2022): https://arxiv.org/abs/2202.09199
- Modern VIO comparison (arXiv 2108.01654): https://ar5iv.labs.arxiv.org/html/2108.01654
- Kimera-VIO-Evaluation: https://github.com/MIT-SPARK/Kimera-VIO-Evaluation
- EuRoC MAV dataset: https://projects.asl.ethz.ch/datasets/doku.php?id=kmavvisualinertialdatasets

**Internal cross-links:**

- [Kimera-Multi](./kimera-multi.md)
- [Kimera-RPGO and PCM](./kimera-rpgo-pcm.md)
- [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md)
- [KISS-SLAM](./kiss-slam.md)
- [ORB-SLAM2 / ORB-SLAM3](./orb-slam2-orb-slam3.md)
- [OpenVINS](./openvins.md)
- [OKVIS2-X](./okvis2-x.md)
- [DROID-SLAM](./droid-slam.md)
- [Loop Closure and Place Recognition](./loop-closure-place-recognition.md)
- [Certifiable Pose Graph Optimization](./certifiable-pose-graph-optimization.md)
- [Distributed Multi-Robot PGO](./distributed-multi-robot-pgo.md)
- [Semantic SLAM](./semantic-slam.md)
- [Dynamic Object-Aware SLAM](./dynamic-object-aware-slam.md)
- [LT-Mapper / Khronos Lifelong Mapping](./lt-mapper-khronos-lifelong-mapping.md)
- [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md)
- [Mapping and Localization](../overview/mapping-and-localization.md)
- [Robust State Estimation and Multi-Sensor Localization Fusion](../overview/robust-state-estimation-multi-sensor.md)
- [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md)
- [Point Cloud Registration — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md)
- [VINS-Mono and VINS-Fusion](vins-mono-vins-fusion.md)
- [DPVO](dpvo.md)
- [MASt3R-SLAM](mast3r-slam.md)
