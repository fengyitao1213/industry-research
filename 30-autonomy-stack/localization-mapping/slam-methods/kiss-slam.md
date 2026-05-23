# KISS-SLAM

<!-- method-priority:start
priority:
  learning: 4
  deployment: 5
  type: "method"
  stage: "modern-core"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "runtime-localization", "outdoor"]
  reason: "KISS-SLAM is rated for LiDAR odometry, mapping, or scan-matching coverage in AV localization stacks."
method-priority:end -->

Related method pages: [KISS-ICP](./kiss-icp.md) (iter 20 — the foundation), [KISS-Matcher](./kiss-matcher.md), [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) (IMU-tight alternative), [Loop Closure and Place Recognition](./loop-closure-place-recognition.md) (iter 28), [Scan Context Family](./scan-context-family.md), [LIO-SAM](./lio-sam.md), [SuMa](./suma.md), [MOLA](./mola.md), [ERASOR](./erasor.md) (iter 19), [ERASOR++](./erasor-plus-plus.md) (iter 22), [FreeDOM Dynamic Object Removal](./freedom-dynamic-object-removal.md) (iter 20), [LT-Mapper / Khronos Lifelong Mapping](./lt-mapper-khronos-lifelong-mapping.md) (iter 21).

Related overview pages: [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md).

Related KB pages: [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md), [Lie Groups SE(3)/SO(3) Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) (iter 14), [Rolling-Shutter LiDAR Deskew and Motion Distortion](../../../10-knowledge-base/geometry-3d/rolling-shutter-lidar-deskew-motion-distortion.md).

**Last updated:** 2026-05-24

---

## What It Is

KISS-SLAM — "A Simple, Robust, and Accurate 3D LiDAR SLAM System With Enhanced Generalization Capabilities" — is a LiDAR-only full SLAM system from the Photogrammetry & Robotics Lab (PRBonn), University of Bonn, and Sapienza University of Rome. Authors: Tiziano Guadagnino, Benedikt Mersch, Saurabh Gupta, Ignacio Vizzo, Giorgio Grisetti, and Cyrill Stachniss.

Published at IEEE/RSJ International Conference on Intelligent Robots and Systems (IROS) 2025, pages 5363–5370. arXiv: 2503.12660 (submitted 16 March 2025). Code: https://github.com/PRBonn/kiss-slam (`pip install kiss-slam`). The `IROS25` git tag preserves exact published results; the main branch continues active development.

KISS-SLAM is the **SLAM-complete realisation** of the KISS-ICP philosophy. Where KISS-ICP provides local odometry with a rolling voxel map and no loop closure, KISS-SLAM wraps that odometry with three additional components: a local mapping module that organises scans into keypose-anchored submaps, MapClosures for revisit detection without learned descriptors, and a g2o pose-graph backend for globally consistent trajectory optimisation. The system remains LiDAR-only — no IMU, no GNSS, no wheel odometry, no camera, no semantic labels, no per-dataset parameter tuning.

**Key identifiers:**
- arXiv: https://arxiv.org/abs/2503.12660
- Paper PDF (IPB): https://www.ipb.uni-bonn.de/wp-content/papercite-data/pdf/kiss2025iros.pdf
- Code: https://github.com/PRBonn/kiss-slam (MIT license)
- MapClosures dependency: https://github.com/PRBonn/MapClosures

---

## Core Technical Idea

The KISS philosophy — "Keep It Small and Simple" — was introduced by KISS-ICP (Vizzo et al., RAL 2023; see [KISS-ICP](./kiss-icp.md)). Its thesis: complexity in LiDAR odometry is not justified by demonstrated necessity. Each additional component (IMU, feature extraction, learned descriptors, per-dataset tuning) typically compensates for fragility in a prior component rather than solving the underlying problem. Fix the core and most of the compensating complexity becomes unnecessary.

KISS-SLAM extends this principle from local odometry to full SLAM:

1. **No IMU.** Constant-velocity deskewing replaces IMU integration for motion compensation.
2. **No learning.** All components — odometry, loop detection, geometric verification, pose-graph backend — are classical geometry and binary descriptors.
3. **No per-dataset parameters.** One configuration file runs across automotive, handheld, drone, and wheeled-robot sequences without re-tuning. Zero parameter changes across HeLiPR sensor transitions (competing systems require 7–16 changes).
4. **No domain assumptions.** No road-plane prior, no ground-segmentation dependency, no pre-defined scan pattern.
5. **Real-time.** Operates at or above sensor frame rate (10 Hz) on all evaluated datasets.

The IROS 2025 paper's self-description: the authors acknowledge that KISS-ICP performs well on odometry but "the lack of a loop closing and pose graph optimisation module limits its performance." KISS-SLAM is the targeted extension. KISS-ICP provides drift-bounded odometry; MapClosures detects revisits without learning; g2o provides globally consistent pose-graph optimisation without the engineering weight of GTSAM.

---

## Architecture and Pipeline

### Block Diagram

```
Raw LiDAR scans (any rotating or solid-state LiDAR)
       |
  [Front-End: KISS-ICP odometry]
       |  constant-velocity deskew -> voxel downsample
       |  Geman-McClure ICP -> incremental pose T_t
       |
  [Local Mapping Module]
       |  accumulate scans into local map (keypose-anchored voxel grid)
       |  create new local map when travel distance > splitting threshold beta
       |
  [Loop Closure Detection: MapClosures]
       |  ground-plane alignment -> BEV density projection
       |  ORB feature extraction + self-similarity pruning
       |  HBST descriptor database -> candidate retrieval
       |  RANSAC 2D geometric validation -> SE(3) recovery
       |  Szymkiewicz-Simpson overlap Gamma > 0.40 -> accept closure
       |  output: verified SE(3) relative transform T_ij as graph constraint
       |
  [Pose-Graph Backend: g2o]
       |  nodes: keypose per local map
       |  edges: odometric (sequential) + loop closure (verified)
       |  two-level optimisation: keyposes first, then scan-level redistribution
       |
  Globally consistent trajectory + dense voxel map
```

### Front-End: KISS-ICP (full treatment in kiss-icp.md)

The odometry front-end is unmodified KISS-ICP. The four mechanisms that make it work are covered fully in [KISS-ICP](./kiss-icp.md); a compact summary follows.

**Constant-velocity deskewing.** A rotating LiDAR fires each beam at a different instant over ~100 ms. For a vehicle at 10 m/s this means ~1 m of motion distortion in the raw scan. KISS-ICP estimates the inter-frame velocity from the two most recent poses and compensates each point by its normalised scan timestamp. See also: [Rolling-Shutter LiDAR Deskew and Motion Distortion](../../../10-knowledge-base/geometry-3d/rolling-shutter-lidar-deskew-motion-distortion.md).

```
Predicted pose (constant-velocity extrapolation):
  T_hat_t = T_{t-1} * DeltaT_{t-1}
  where DeltaT_{t-1} = T_{t-2}^{-1} * T_{t-1}

Per-point deskew for point p_i at normalised timestamp s_i in [0, 1]:
  p_i* = Exp(s_i * omega_t) * p_i + s_i * v_t
```

where `Exp(.)` is the SO(3) Lie exponential, `omega_t` is the estimated angular velocity, and `v_t` is the estimated translational velocity in the body frame. See [Lie Groups SE(3)/SO(3) Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) for the SE(3)/SO(3) formalism.

**Adaptive correspondence threshold.** `tau_t = 3 * sigma_t` is derived each frame from the running RMS of recent inter-frame displacement magnitudes. No manual tuning per dataset or speed.

**Geman-McClure robust kernel.** Applied to per-point ICP residuals to continuously downweight outlier correspondences (moving objects, sensor noise) without a hard rejection step:

```
rho(e) = (e^2 / 2) / (kappa_t + e^2)
per-point weight: w_i = kappa_t / (kappa_t + r_i^2)^2
```

where `kappa_t = sigma_t / 3` is the data-driven kernel scale. See [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md) for the full ICP derivation.

**Voxel-grid local map.** Spatial hash map keyed by voxel index; automatic FIFO eviction of oldest voxels; no explicit map-size parameter.

### Local Mapping Module

KISS-SLAM groups consecutive scans into **local maps** (submaps). A new local map is started when the platform has traveled a cumulative distance greater than the splitting threshold `beta`. Each local map is **keypose-anchored**: it records the global SE(3) pose of the first scan in the group and stores the aggregated point cloud in a voxel grid. The keypose becomes a node in the pose graph; scan-level poses within the local map are leaf variables that are refined during two-level pose-graph optimisation.

The splitting threshold `beta` is the single primary tunable parameter in KISS-SLAM:
- Outdoor driving: ~50–100 m recommended
- Indoor / compact environments: ~10–20 m recommended
- For compact loops (< ~30–40 m diameter): reduce `beta` aggressively to create more graph nodes (see Failure Modes — known issue)

The local map voxel representation enables efficient overlap computation for the Szymkiewicz-Simpson coefficient used in loop closure validation.

### Loop Closure Detection: MapClosures

KISS-SLAM uses MapClosures (Gupta, Guadagnino, Mersch, Vizzo, Stachniss; ICRA 2024 / IJRR 2026; arXiv:2501.07399) as its loop closure detection and geometric verification backend. MapClosures operates on **local maps** (aggregated point clouds), not individual scans.

**Stage 1 — Ground Plane Alignment.** Sample the lowest-elevation point in each 1.0 m grid cell. Fit a ground normal via PCA (cosine similarity threshold 0.95). Apply least-squares optimisation constraining to z-translation and roll/pitch only to produce a ground-aligned local map. This normalises the BEV projection even for non-planar platforms (backpacks, handheld devices).

**Stage 2 — BEV Density Projection.** Project the ground-aligned point cloud orthographically onto the xy-plane at 0.5 m/pixel resolution. Each pixel stores the point count (density), not elevation. Pixels below 5% of the maximum density in the image are zeroed to suppress transient dynamic objects.

**Stage 3 — ORB Feature Extraction with Self-Similarity Pruning.** ORB (Oriented FAST + BRIEF) features are extracted from the density image without scale invariance (orthographic projection removes scale ambiguity). A self-similarity pruning step discards features whose nearest Hamming-distance neighbour within the same image is fewer than 35 bits — this removes features on repetitive structures (fence panels, railings, long walls) that cause perceptual aliasing.

**Stage 4 — HBST Descriptor Database.** Binary 256-bit ORB descriptors are indexed in a Hamming Distance Embedding Binary Search Tree (HBST) with a 50-bit matching threshold and 100-descriptor leaf capacity. This provides O(log n) query time over large map databases.

**Stage 5 — RANSAC 2D Geometric Validation.** For each candidate pair, a 2D rigid-body alignment is computed via Kabsch-Umeyama on the matched feature pairs (minimum 5 inliers, 1.5 m outlier threshold), yielding an SE(2) transform.

**Stage 6 — SE(3) Recovery.** The full SE(3) relative transform is recovered by composing the 2D BEV transform with the stored ground alignment transforms from both maps:

```
T_ij = T_mg_i^{-1} * T_BEV * T_mg_j
```

where `T_mg` is the ground alignment transform for each local map.

**Stage 7 — Szymkiewicz-Simpson Overlap Validation (KISS-SLAM addition).** Before inserting a loop closure into the pose graph, KISS-SLAM applies a final 3D geometric sanity check using the Szymkiewicz-Simpson overlap coefficient:

```
Gamma(N_i, N_j) = |N_i intersect T_{i->j}(N_j)| / min(|N_i|, |N_j|)
```

where `N_i`, `N_j` are the voxel sets occupied in the two local maps and `T_{i->j}` is the recovered SE(3) transform. The closure is accepted only if `Gamma > 0.40`. A value of 1.0 means one map is fully contained in the other; the 0.40 threshold means at least 40% of the smaller map must be geometrically consistent with the larger after transformation. This rejects false positives that survive RANSAC but fail the full 3D consistency test.

The combined pipeline achieves cross-sensor generalization across Ouster OS1/OS2, Velodyne HDL-32E/VLP-16, Livox Avia, Aeva Aeries II, and Hesai Pandar-128 without parameter changes.

### Pose-Graph Backend: g2o

The pose-graph backend is **g2o** (Kümmerle et al., ICRA 2011) — not GTSAM or iSAM2.

**Graph structure:**
- **Nodes:** one node per local map, representing the SE(3) keypose.
- **Odometric edges:** between every pair of successive local maps; constraint is the relative transform from KISS-ICP integration across the two maps, with information matrix from ICP covariance.
- **Loop closure edges:** one per accepted closure; constraint is `T_ij` from MapClosures, with information matrix from RANSAC inlier count and the Szymkiewicz-Simpson overlap coefficient.

**Two-level optimisation (fine-grained strategy):**
1. Optimise keypose nodes (top-level graph) using standard g2o Gauss-Newton / Levenberg-Marquardt.
2. Fix the optimised keyposes and redistribute drift: re-optimise individual scan-level poses within each local map relative to the corrected keypose.

This two-level approach ensures the output is not just keypose-corrected but per-scan corrected, which matters for building dense point-cloud maps. The pose-graph cost over N keypose nodes and edge set E is:

```
F = sum over (i,j) in E of:  rho( e_ij^T * Omega_ij * e_ij )

e_ij(X_i, X_j) = Log( Z_ij^{-1} * X_i^{-1} * X_j )  in R^6
```

where `Z_ij` is the measured relative transform, `Omega_ij` is the information matrix, `Log : SE(3) -> R^6` maps to the se(3) Lie algebra (3D translation + 3D rotation), and `rho(.)` is the robust kernel. g2o minimises `F` by iteratively linearising around the current estimate and solving the resulting sparse linear system. See [Lie Groups SE(3)/SO(3) Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) for the SE(3) logarithm and Jacobians.

---

## Inputs and Outputs

| Item | Description |
|---|---|
| **Input** | Raw LiDAR scan stream; any rotating or solid-state 3D LiDAR |
| **Tested sensors** | Ouster OS1-64, OS2; Velodyne HDL-64E, HDL-32E, VLP-16; Livox Avia; Aeva Aeries II; Hesai Pandar-128 |
| **No additional sensors** | No IMU, no GNSS, no wheel odometry, no camera |
| **Single tunable parameter** | `splitting_distance` beta (outdoor: 50–100 m; indoor: 10–20 m) |
| **Output: trajectory** | Globally consistent SE(3) per-scan poses after pose-graph correction |
| **Output: map** | Globally consistent dense point-cloud map (configurable voxel resolution) |
| **Output: graph file** | g2o graph exportable for external analysis |
| **Runtime** | Faster than sensor frame rate (> 10 Hz) on all evaluated datasets |

---

## Benchmark Results

Metrics: ATE (Absolute Trajectory Error, metres) and KITTI relative translational error (%). Results represent post-loop-closure pose-graph optimisation. **Caveat: exact numerical tables for all competing systems were not accessible from available HTML excerpts; comparisons described as "superior or comparable" in paper sections. Sample numbers below are from the ar5iv HTML rendering. Treat all benchmark numbers as indicative pending full PDF verification.**

### Datasets

| Dataset | Platform | LiDAR | Key challenge |
|---|---|---|---|
| MulRan | Car | Ouster OS1-64 | Long urban loops; 4 sequences (DCC, KAIST, Riverside, Sejong) |
| HeLiPR | Car | Ouster OS2, Livox Avia, Aeva Aeries II, VLP-16 | Multi-sensor generalisation |
| Apollo | Car | Velodyne HDL-64E | Diverse urban conditions; 6 sub-sequences |
| NCLT | Segway | Velodyne HDL-32E | Non-planar motion; long-term campus traversal |
| Newer College | Handheld | Ouster OS0 | Pedestrian speed; campus; aggressive rotation |

### Sample Quantitative Results

**MulRan (car, Ouster OS1-64):**

| Sequence | ATE (m) | KITTI (%) |
|---|---|---|
| KAIST | 2.98 | 0.34 |
| Riverside | 7.96 | 0.40 |

**HeLiPR (Avia sensor):**

| Sequence | ATE (m) | KITTI (%) |
|---|---|---|
| Town | 1.99 | 0.21 |
| Roundabout | 1.18 | 0.17 |

**NCLT (Segway, 2012-01-08):**

| Metric | Value |
|---|---|
| ATE | 3.00 m |
| KITTI | 0.61% |

**Multi-sensor generalization claim:** HeLiPR evaluates the same route with four different LiDAR models in separate runs. KISS-SLAM uses zero parameter changes across sensor transitions; competing systems require 7–16 parameter changes per sensor swap.

### Competing Systems

The paper compares against LiDAR-only SLAM systems:

| System | Type | Venue |
|---|---|---|
| PIN-SLAM | Point-based implicit neural SLAM | TRO 2024 (PRBonn) |
| SuMa | Surfel-based mapping | RSS 2018 (Behley & Stachniss) |
| CT-ICP | Continuous-time ICP SLAM | ICRA 2022 |
| MULLS | Multi-metric linear least-squares SLAM | ICRA 2021 |

**Deliberate omission of IMU-tight systems:** The paper does not compare against LIO-SAM or FAST-LIO2. KISS-SLAM is LiDAR-only by design. On aggressive trajectories where IMU preintegration provides a strong motion prior, FAST-LIO2 (see [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md)) with Scan Context loop closure will typically produce lower ATE because it is not limited by the constant-velocity odometry assumption. For a fair no-IMU SLAM comparison, KISS-SLAM is the current state-of-the-art baseline.

---

## The KISS Family

KISS-SLAM is one member of a coherent research family from PRBonn / Vizzo and Stachniss group. All members share the KISS philosophy.

| Member | Venue | arXiv | Core contribution |
|---|---|---|---|
| KISS-ICP | RA-L / IROS 2023 | 2209.15397 | LiDAR-only odometry; adaptive threshold; Geman-McClure kernel |
| MapClosures | ICRA 2024 / IJRR 2026 | 2501.07399 | Loop closure via BEV density maps + ORB + HBST + RANSAC + SE(3) recovery |
| Kinematic-ICP | ICRA 2025 | 2410.10277 | KISS-ICP + kinematic constraints for differential-drive; deployed by Dexory at 100 Hz |
| KISS-Matcher | ICRA 2025 | 2409.15615 | Global point-cloud registration; Faster-PFH + k-core pruning (KAIST / MIT-SPARK, Vizzo co-author) |
| KISS-SLAM | IROS 2025 | 2503.12660 | Full SLAM: KISS-ICP front-end + MapClosures loop closure + g2o pose graph |

**Philosophical lineage:**

```
LOAM (Zhang & Singh, RSS 2014)
  feature-based LiDAR odometry; planar + edge features
    |
KISS-ICP (RAL 2023) -- iter 20
  replaces feature extraction with corrected point-to-point ICP + robust kernel
  removes planar-surface and IMU assumptions
    |
    +-- Kinematic-ICP (ICRA 2025)
    |     kinematic constraint layer for differential-drive robots
    |
    +-- KISS-Matcher (ICRA 2025) -- see kiss-matcher.md
    |     global registration via Faster-PFH + k-core pruning
    |
    +-- KISS-SLAM (IROS 2025) -- this page
          wraps KISS-ICP with MapClosures loop closure and g2o pose graph
          completes the no-IMU SLAM stack
```

**KISS-SLAM vs KISS-Matcher distinction.** These are two separate loop-closure approaches within the KISS ecosystem and must not be conflated. KISS-SLAM uses **MapClosures** (not KISS-Matcher) as its loop closure backend. MapClosures is a map-level system operating on local maps via BEV density projections and ORB descriptors. KISS-Matcher is a separate global point-cloud registration library from KAIST / MIT-SPARK providing Faster-PFH + k-core pruning — designed as the geometric verification step inside a loop-closure pipeline. KISS-SLAM uses ICP-based RANSAC from MapClosures instead. The two could in principle be combined (MapClosures for retrieval, KISS-Matcher for verification) but this is not the published configuration. See [KISS-Matcher](./kiss-matcher.md) and [Loop Closure and Place Recognition](./loop-closure-place-recognition.md).

---

## Strengths

- **Parameter-free in practice.** One `splitting_distance` beta is the only tunable. Voxel size, ICP iteration count, loop-closure score thresholds, feature counts — all derived or fixed. No per-dataset manual tuning.
- **Multi-sensor generalisation.** Same binary, no recompile, no parameter change across Ouster, Velodyne, Livox, Aeva, Hesai. Zero sensor-transition changes on HeLiPR vs. 7–16 for competing systems. This is the stated "enhanced generalization" claim in the paper title.
- **No IMU required.** Deployable on any LiDAR-only platform — survey backpacks, retrofitted vehicles, airside survey carts, any platform lacking a calibrated MEMS IMU.
- **Classical and inspectable.** No neural network, no GPU required for inference, no learned components with opaque failure modes. All intermediate outputs (local maps, loop-closure candidates, g2o graph file) are exportable and inspectable.
- **Real-time.** Operates above 10 Hz sensor rate on all evaluated datasets; suitable for online deployment, not just offline post-processing.
- **Open-source, pip-installable.** `pip install kiss-slam` with a `IROS25` git tag for reproducibility.
- **Non-planar motion.** Ground alignment in MapClosures relaxes the planar-motion assumption; validated on handheld backpacks with pitch/roll variation.
- **Built on proven components.** KISS-ICP (production-validated by Kinematic-ICP at 100 Hz in Dexory warehouses), MapClosures (standalone ICRA/IJRR publication), g2o (ICRA 2011, widely used).

---

## Failure Modes

### Geometric Degeneracy

**Long corridors and tunnels.** Point-to-point ICP is ill-conditioned when local geometry lacks constraints in one or more directions. A long uniform corridor provides no positional constraints along the corridor axis. The constant-velocity model helps short-term but cannot recover from sustained degeneracy. GenZ-ICP (arXiv:2411.06766) explicitly addresses this with adaptive point-to-point / point-to-plane switching; KISS-ICP and KISS-SLAM do not include degeneracy detection.

Airside context: apron areas are geometrically rich (aircraft surfaces, jetways, gate structures, ground markings). Taxiways adjacent to long uniform terminal walls can be borderline degenerate. KISS-SLAM should be validated against FAST-LIO2 + Scan Context on such sequences before committing to production airside use.

### No IMU — Aggressive Motion

The constant-velocity deskewing model fails under:
- High angular velocity turns (tight warehouse turns, aircraft pushback manoeuvres)
- Vibration (forklift on warehouse floor, vehicle on rough surface)
- Intermittent LiDAR blanking or dropout

Without IMU, aggressive motion causes inter-scan misregistration that compounds into odometric drift. If the resulting drift exceeds the RANSAC basin of attraction in MapClosures, loop closure will fail to close the loop even when a valid revisit occurs. IMU-tight systems (see [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md), [LIO-SAM](./lio-sam.md)) are more robust here. The failure is typically non-catastrophic — KISS-ICP reports higher translation error rather than diverging — but map quality degrades.

### No Native Dynamic Object Handling

KISS-SLAM has no built-in mechanism to remove or mask dynamic objects. Moving vehicles, ground staff, aircraft with spinning fans, and baggage tugs all contribute points to the local map. The 5% density filter in MapClosures BEV projection suppresses sparse transient points but dense moving objects (a parked aircraft that has departed, a cargo vehicle present in one pass but not the next) are retained and can corrupt the static map.

This is the primary limitation for airside aggregated map building where the environment changes between passes. Practical mitigation: run KISS-SLAM for globally consistent pose estimation, then apply ERASOR or ERASOR++ post-processing to the final map output to extract the static layer. See [ERASOR](./erasor.md) (iter 19), [ERASOR++](./erasor-plus-plus.md) (iter 22), and [FreeDOM Dynamic Object Removal](./freedom-dynamic-object-removal.md) (iter 20). For long-term incremental updates with change detection, see [LT-Mapper / Khronos Lifelong Mapping](./lt-mapper-khronos-lifelong-mapping.md) (iter 21).

### Known Issue: Compact Loop Pose-Graph No-Effect Bug

A reported GitHub issue (PRBonn/kiss-slam #42) describes detected loop closures having negligible effect on the pose graph for compact circular trajectories (~30 x 40 m with VLP-16). The logged chi-squared residual drops to ~0.000041, indicating the optimiser treats the graph as already near-optimal.

Root cause: over a small compact loop, if `splitting_distance` beta is large relative to the loop diameter, only a few keypose nodes are created. With few nodes and few odometric edges, the pose graph has insufficient structure for meaningful drift redistribution. The loop closure edge is accepted but has almost no lever arm.

**Workaround:** Reduce `local_mapper.splitting_distance` (e.g., 10–20 m for indoor compact loops) to force more keypose nodes and create a graph with enough structure. This issue does not affect large outdoor loops where the graph has many nodes.

### Single-Session Only (Current Release)

KISS-SLAM is designed for single-session mapping. For multi-session map extension (returning to a partially mapped site with new scans), there is no explicit session-merge mechanism in the IROS 2025 release. The MapClosures IJRR 2026 extension adds multi-session inter-map detection, but KISS-SLAM's g2o backend does not yet implement cross-session welding. Check the GitHub main branch and open issues for current multi-session support status.

### IMU-Tight Honest Assessment

For production deployments where (a) a high-quality calibrated MEMS IMU is available, (b) the trajectory includes aggressive motion, and (c) survey accuracy at sub-0.5 m is required — **FAST-LIO2 + Scan Context or ScanWise loop closure is the production-grade choice.** IMU preintegration provides a motion prior that is substantially more accurate than constant-velocity for anything beyond gentle cruising.

KISS-SLAM is the correct choice when:
- No IMU is available or reliable
- Plug-and-play deployment with zero calibration is required
- Multi-sensor generalisation is needed (swap LiDAR model without reconfiguring)
- The no-IMU SLAM baseline against which a custom stack is benchmarked is needed

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV — structured urban | Strong | Long outdoor loops with rich 3D geometry; MulRan KAIST result (0.34% KITTI) confirms |
| Road AV — highway, open road | Conditional | Lateral constraints may be weak on straight sections; supplement with GNSS or loop closure |
| Airside — service roads, cargo areas, terminal edges | Good | Structured geometry; multi-LiDAR fleet vehicles benefit from sensor-agnostic tuning |
| Airside — open apron, long straight traversal | Conditional | Geometric degeneracy risk on long straight sections; validate loop closure coverage |
| Airside — no IMU available | Best available | KISS-SLAM is the only production-ready no-IMU LiDAR SLAM with loop closure |
| Warehouse / indoor flat | Good | Reduce `beta` to 10–20 m; mitigate compact-loop issue proactively |
| Warehouse / long symmetric aisles | Conditional | Corridor degeneracy; perceptual aliasing in MapClosures BEV on identical-shelf aisles |
| Handheld / backpack survey | Good | Newer College handheld result confirms non-planar motion handling |
| Mining / construction | Conditional | Irregular terrain reduces ground-plane normalisation reliability |
| Port / logistics yard | Good | Dense infrastructure provides rich geometry; active vehicle traffic requires ERASOR post-processing |
| Agriculture / open fields | Weak | Insufficient structural geometry for ICP and BEV-ORB loop detection |

---

## Aggregated-Map Suitability

In a map-construction pipeline, KISS-SLAM's role is the **SLAM backend that provides globally consistent per-scan poses** for aggregating a dense static map. KISS-ICP alone produces locally consistent poses that drift over long traversals; KISS-SLAM's loop closure corrects that drift.

**Recommended pipeline for LiDAR-only survey mapping:**

```
Raw LiDAR scans
  -> KISS-SLAM (globally consistent poses, > 10 Hz, CPU-only)
  -> Aggregated point cloud (each scan transformed by corrected T_t into map frame)
  -> ERASOR++ or FreeDOM (dynamic object removal -> static layer extraction)
  -> LT-Mapper / Khronos (lifelong map update for multi-session change detection)
  -> Voxelised dense static map
  -> Semantic segmentation (Rangeformer, SpherFormer, etc.)
```

See [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) for the full segmentation pipeline.

**Recommendation matrix for airside survey-drive:**

| Condition | Recommended choice |
|---|---|
| No IMU available | KISS-SLAM — only viable no-IMU LiDAR SLAM with loop closure |
| IMU available, quality MEMS, gentle motion | KISS-SLAM or FAST-LIO2 + loop closure; near parity |
| IMU available, aggressive motion or vibration | FAST-LIO2 + Scan Context or SC-LIO-SAM |
| Mixed-LiDAR fleet (different sensor models per vehicle) | KISS-SLAM — unique sensor-agnostic advantage |
| Active apron with aircraft movement during survey | KISS-SLAM + ERASOR++ post-processing |
| Compact indoor terminal area (< 100 m loop) | Reduce `beta`; monitor for compact-loop issue |
| Multi-session incremental update | MapClosures IJRR 2026 + custom session merge; KISS-SLAM alone insufficient |

**Summary position:** KISS-SLAM is the **no-IMU production-ready LiDAR SLAM with loop closure** and the plug-and-play baseline against which custom stacks are compared. With a good IMU available, FAST-LIO2 + Scan Context is still the production-grade choice for aggressive trajectories. Without a good IMU, KISS-SLAM is the recommended choice.

---

## Implementation Notes

- **Install:** `pip install kiss-slam`; use the `IROS25` git tag when reproducing paper results — the main branch continues active development and may diverge.
- **Parameter-free is the headline.** The only recommended tuning is `splitting_distance` beta. For outdoor automotive or airside: default (50–100 m). For indoor warehouse or compact campus: reduce to 10–20 m.
- **Compact-loop mitigation:** If the loop is smaller than ~100 m in any dimension, proactively set `beta` to ~10–15 m. Do not wait for the no-effect symptom to appear in production.
- **Dynamic scene:** KISS-SLAM provides no online dynamic filtering. Run ERASOR++, FreeDOM, or an equivalent static-extraction method on the output map before using it for localisation or segmentation.
- **Multi-session:** For sites that need incremental multi-session updates (airside HD map maintenance, warehouse inventory change detection), KISS-SLAM standalone is insufficient. Pair with LT-Mapper or Khronos after static extraction.
- **Export the g2o graph.** The graph file is the full record of loop closure decisions. Archive it alongside the map for audit and reprocessing.
- **Covariance:** KISS-SLAM does not output calibrated per-pose covariance by default. Approximate from ICP residual statistics or from the pose-graph Hessian diagonal if needed for factor-graph fusion downstream.
- **Cross-reference with KISS-ICP notes.** All KISS-ICP implementation notes apply to the KISS-SLAM front-end: set `max_range` to match the sensor; enable per-point timestamps; monitor correspondence count and ICP residual as front-end health indicators. See [KISS-ICP](./kiss-icp.md).

---

## Sources

- Guadagnino, T., Mersch, B., Gupta, S., Vizzo, I., Grisetti, G., Stachniss, C. "KISS-SLAM: A Simple, Robust, and Accurate 3D LiDAR SLAM System With Enhanced Generalization Capabilities." IROS 2025, pp. 5363–5370. https://arxiv.org/abs/2503.12660
- KISS-SLAM PDF (IPB): https://www.ipb.uni-bonn.de/wp-content/papercite-data/pdf/kiss2025iros.pdf
- KISS-SLAM GitHub: https://github.com/PRBonn/kiss-slam
- Gupta, S., Guadagnino, T., Mersch, B., Vizzo, I., Stachniss, C. "Effectively Detecting Loop Closures using Point Cloud Density Maps." ICRA 2024 / IJRR 2026. https://arxiv.org/abs/2501.07399
- MapClosures GitHub: https://github.com/PRBonn/MapClosures
- Vizzo, I., Guadagnino, T., Mersch, B., Wiesmann, L., Behley, J., Stachniss, C. "KISS-ICP: In Defense of Point-to-Point ICP." IEEE RA-L vol. 8 no. 2, 2023. https://arxiv.org/abs/2209.15397
- KISS-ICP GitHub: https://github.com/PRBonn/kiss-icp
- Kinematic-ICP arXiv: https://arxiv.org/abs/2410.10277 · GitHub: https://github.com/PRBonn/kinematic-icp
- KISS-Matcher arXiv: https://arxiv.org/abs/2409.15615 · GitHub: https://github.com/MIT-SPARK/KISS-Matcher
- Kümmerle, R. et al. "g2o: A General Framework for Graph Optimization." ICRA 2011. https://github.com/RainerKuemmerle/g2o
- ar5iv HTML rendering of KISS-SLAM (full paper): https://ar5iv.labs.arxiv.org/html/2503.12660
- GitHub issue #42 (pose-graph no-effect on compact loops): https://github.com/PRBonn/kiss-slam/issues/42
- IPB Tiziano Guadagnino publications: https://www.ipb.uni-bonn.de/people/tiziano-guadagnino/index.html
