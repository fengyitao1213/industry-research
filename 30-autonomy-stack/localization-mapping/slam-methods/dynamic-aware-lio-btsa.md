# Dynamic-Aware LIO BTSA

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "modern-core"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "runtime-localization", "outdoor"]
  reason: "Dynamic-Aware LIO BTSA is rated for LiDAR odometry, mapping, or scan-matching coverage in AV localization stacks."
method-priority:end -->

Related docs: [DO-Removal LIO](do-removal-lio.md), [ERASOR](erasor.md), [ERASOR++](erasor-plus-plus.md), [FreeDOM](freedom-dynamic-object-removal.md), [MapCleaner](mapcleaner.md), [DR-Remover](dr-remover.md), [LiDAR Map Cleaning — Dynamic Removal](lidar-map-cleaning-dynamic-removal.md), [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md), [Dynamic-Object-Aware SLAM](dynamic-object-aware-slam.md), [SD-SLAM Semantic-Dynamic LiDAR](sd-slam-semantic-dynamic-lidar.md), [SuMa / SuMa++](suma.md), [FAST-LIO / FAST-LIO2](fast-lio-fast-lio2.md), [LT-Mapper / Khronos](lt-mapper-khronos-lifelong-mapping.md), [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [LiDAR Artifact Removal Techniques](../../perception/overview/lidar-artifact-removal-techniques.md).

**Last updated:** 2026-05-23

---

## What It Is

**Full title:** Breaking the Static Assumption: A Dynamic-Aware LIO Framework Via Spatio-Temporal Normal Analysis

**Short name:** BTSA (derived from the GitHub repository name `thisparticle/btsa`)

**Authors:** Zhiqiang Chen, Cedric Le Gentil, Fuling Lin, Minghao Lu, Qiyuan Qiao, Bowen Xu, Yuhua Qi, Peng Lu

**Affiliations:** Dept. of Mechanical Engineering, University of Hong Kong (Chen, Lin, Lu M., Qiao, Xu, Lu P.); Autonomous Space Robotics Lab, UTIAS, University of Toronto (Le Gentil); School of Systems Science and Engineering, Sun Yat-sen University, Guangzhou (Qi)

**Venue:** IEEE Robotics and Automation Letters (RA-L)

**Accepted:** October 12, 2025

**arXiv:** https://arxiv.org/abs/2510.22313

**IEEE Xplore:** https://ieeexplore.ieee.org/document/11207655/

**GitHub:** https://github.com/thisparticle/btsa

**License:** GPL-2.0

BTSA is a dynamic-aware LiDAR-inertial odometry (LIO) framework. Its defining contribution is the use of **4D spatio-temporal surface normals** — computed from raw, timestamped point-cloud geometry across a short temporal sliding window — to detect and exclude dynamic points inside the LIO registration loop, with no dependency on a prior pose estimate and no learned components. The paper title is a direct statement of the method's goal: to eliminate the static-world assumption embedded in classical ICP-based LIO.

BTSA builds on a lineage of spatio-temporal normal research by co-author Cedric Le Gentil:

- Falque, Le Gentil, Sukkar (2023) — "Dynamic Object Detection in Range data using Spatiotemporal Normals," arXiv 2310.13273. Original formulation of spatiotemporal normals for learning-free dynamic detection in LiDAR and depth-camera data.
- Le Gentil, Falque, Vidal-Calleja (IROS 2024) — "Real-Time Truly-Coupled Lidar-Inertial Motion Correction and Spatiotemporal Dynamic Object Detection," arXiv 2410.05152. Tightly-coupled LIO with IMU-preintegration motion correction and spatiotemporal dynamic detection.

BTSA embeds this lineage into a complete IEKF-based LIO system with spatial consistency verification and a three-map architecture.

---

## Core Technical Idea

Standard LIO systems — FAST-LIO2, LIO-SAM, iG-LIO — assume a static world. Their ICP objective minimises a sum over all scan points:

```
E = sum_i || n_i^T (T * p_i - q_i) ||^2
```

where every source point p_i contributes equally regardless of whether it corresponds to a moving object. In dynamic scenes this contaminates the pose estimate. Dynamic-point ghosts also pollute the local map, degrading future scan registration.

The classical mitigation — detect dynamic objects first, then register — immediately encounters a **circular dependency**: reliable dynamic detection needs an accurate prior pose to compare the scan against the map, but the prior pose is only accurate if dynamic points were already excluded from the ICP that produced it. This loop is the core problem BTSA addresses.

**BTSA's resolution** is to compute dynamic evidence directly from raw, un-registered point clouds. The 4D spatio-temporal normal is derived purely from the geometry and timestamps of points in a sliding window. No map comparison, no prior pose alignment, and no learned model are required. Dynamic flags are available before any ICP step. The flagging is then embedded inside the IEKF iteration, updating with each correction step.

The phrase "breaking the static assumption" means replacing the unconditional assumption that all scan points are static with per-point evidence. Points without temporal displacement evidence remain in the ICP objective; points with measurable temporal displacement are excluded.

---

## Operator Mechanics

### 4D Spatio-Temporal Normal — Formulation

A static surface in 3D satisfies an implicit equation g(x, y, z) = 0 with a 3D normal n = (a, b, c). If the surface is viewed across time, a 4D implicit function g(x, y, z, t) = 0 describes its spatio-temporal geometry. The gradient is the 4D normal:

```
n_tilde = (a, b, c, d)
```

For a purely static surface the temporal component d tends to zero. For a moving surface |d| > 0, encoding the projection of local velocity onto the spatial normal direction:

```
d = -(a*v_x + b*v_y + c*v_z)
```

where (v_x, v_y, v_z) is the local surface velocity. This relationship makes d a direct, calibrated proxy for motion.

### Covariance Construction

For each query point p_ij in the distortion-corrected scan, the local neighborhood N_ij is collected across both spatial neighbors (current and recent frames within the ~2 s sliding window) and temporal neighbors (prior frames in the window). Each neighbor point is augmented into a 4D vector:

```
[p_uv ; t_uv]    where p_uv in R^3, t_uv in R
```

The 4D mean:

```
m_ij = (1/|N_ij|) * sum_{u,v in N_ij} [p_uv^T, t_uv]^T
```

The 4D covariance matrix:

```
cov_ij = (1/|N_ij|) * sum_{u,v in N_ij}
         ([p_uv ; t_uv] - m_ij) * ([p_uv ; t_uv] - m_ij)^T
```

This is a 4x4 matrix.

### Eigendecomposition and Normal Extraction

PCA on cov_ij yields four eigenvectors. The eigenvector corresponding to the smallest eigenvalue is the 4D surface normal n_tilde = (a, b, c, d). The spatial part (a, b, c) is the classical 3D surface normal; d encodes velocity.

### Dynamic Flagging Threshold

A point is labelled **unstable** (candidate dynamic) when:

```
|d| > d_thr    (equivalently: |d| / ||n_tilde|| > sin(theta_thr))
```

The angular interpretation: theta_thr = 5.7 degrees means the temporal component of the 4D normal may be at most approximately 10% of its spatial magnitude before the point is flagged. At ||n_tilde|| = 1, this corresponds to d_thr = 0.1. The paper uses this threshold across all experiments.

**Note on the term "unstable".** The paper deliberately uses "unstable" rather than "dynamic." Newly observed static regions — a wall visible for the first time as the robot turns a corner — also generate non-zero d because their temporal neighborhood is one-sided in time. The spatial consistency verification step (see Architecture section) disambiguates genuinely-dynamic unstable points from newly-seen static ones.

---

## Inputs and Outputs

| Item | Role |
|---|---|
| LiDAR point cloud (per frame) | Primary geometric observation; spinning multi-beam or solid-state |
| IMU stream | Propagation between scans; motion-distortion correction (deskewing) |
| Temporal sliding-window map M_t | ~2 s of recent frames providing spatio-temporal neighborhood for 4D normal estimation |
| Long-term voxel map M_v | Accumulated static geometry (VoxelMap-style spatial planes); ICP registration reference |
| Spatial consistency check map M_scc | Lightweight sliding voxel map of confirmed static areas for disambiguating unstable points |
| **Output: 6-DOF odometry** | Pose estimate from IEKF computed on stable-point correspondences only |
| **Output: clean incremental static map** | M_v populated with static-only points; no actively-moving-object ghosts |
| **Output: dynamic mask (per scan)** | Set of excluded points; useful for downstream QA and safety logging |

---

## Architecture and Pipeline

BTSA maintains three concurrent map structures:

| Map | Contents | Role |
|---|---|---|
| M_t | ~2 s of recent LiDAR scans | Spatio-temporal neighborhood for 4D normal estimation |
| M_v | All accumulated static geometry (VoxelMap spatial planes) | ICP registration reference |
| M_scc | Lightweight sliding voxel map of confirmed static areas | Disambiguates dynamic vs newly-observed unstable points |

M_t is implemented with an iKd-Tree (incremental KD-Tree from FAST-LIO2) and uses a double-ended queue for oldest-frame eviction.

### IEKF Front End

BTSA's front end is a FAST-LIO2-style Iterated Extended Kalman Filter (IEKF) estimating system state x_j containing pose T^j, velocity v^j, and IMU biases (accelerometer and gyroscope). Preintegration propagates the prior state using IMU data between scans; the IEKF update corrects the state using ICP residuals.

Pre-processing per incoming scan:

1. Propagate prior state with IMU preintegration.
2. Correct motion distortion (deskewing) using the current pose estimate.
3. Voxel downsampling to reduce point density while preserving surface coverage.

### 4D Normal Computation Module

For each point p_ij in the distortion-corrected scan, M_t is queried for k-nearest spatio-temporal neighbors. The 4D covariance cov_ij is computed and decomposed via SVD. Points with |d| > 0.1 are flagged unstable.

Unstable points undergo the Spatial Consistency Verification (SCV) step described below. Confirmed-dynamic points are **hard-rejected** from the ICP objective — not soft-weighted. The cost function becomes:

```
E = sum_{i: stable} || n_i^T (T * p_i - q_i) ||^2   (stable points only)
```

The IEKF update uses only stable-point residuals:

```
x_hat_k = x_bar_k + K_k * (z_k - h(x_bar_k))
```

where z_k and h(·) are constructed exclusively from stable-point matched correspondences.

### Spatial Consistency Verification (SCV)

Newly observed regions also produce non-zero d (one-sided temporal neighborhood). SCV resolves this:

1. Nearest-neighbor upsample the sparse unstable-point candidates to denser clusters.
2. DBSCAN cluster the upsampled unstable points in 3D space.
3. Enclose each cluster in an axis-aligned bounding box.
4. Discard clusters exceeding object-size priors (unrealistically large — noise or FoV boundary artefacts).
5. Compute volumetric overlap between each candidate cluster bounding box and M_scc. Substantial overlap with confirmed static voxels -> reclassify as newly-seen static. Minimal overlap -> confirm as genuinely dynamic.

SCV compute cost: 6.08 ms per scan (core dynamic-state estimation contributes 37.38 ms; total pipeline ~49.69 ms).

### Full Pipeline

```
Raw LiDAR scan (new frame)
     |
     v
[IMU preintegration + deskewing]         <- prior pose used for distortion correction
     |
     v
[Voxel downsampling]
     |
     v
[4D spatio-temporal normal computation]  <- query M_t per point; compute cov_ij; extract d
     |
[Threshold |d| > 0.1]
     |
  UNSTABLE              STABLE
     |                    |
     v                    |
[Spatial consistency verification]       <- DBSCAN + overlap check vs M_scc
     |                    |
  DYNAMIC   NEWLY-SEEN    |
     |          |         |
  [REJECT]  [treat as STABLE] --------> |
                                         v
                         [ICP / IEKF update vs M_v]
                                         |
                                         v
                         [State estimate x_hat_k]
                                         |
                         [Insert stable points into M_v, M_t, M_scc]
```

---

## Training-Free Nature

BTSA contains no learned components. Every step — 4D covariance construction, PCA/SVD, threshold comparison, DBSCAN clustering, bounding-box overlap check — is geometric and rule-based. There are no pre-trained weights and no labelled training data are required. This is the key operational advantage over SuMa++ (which depends on RangeNet++) and TRLO (which depends on PointPillars): BTSA deploys immediately on novel domains — airside, warehouse, port, mining — without annotated target-domain data.

The flip side is that threshold parameters (d_thr = 0.1; temporal window ~2 s; DBSCAN radius; bounding-box size prior) must be validated on target-hardware data before production use.

---

## Benchmark Results

**Honest framing.** BTSA is evaluated on custom GEODE sequences, public ECMD, and UrbanNav sequences, and on the Helimos static-map benchmark. It is **not evaluated on KITTI or SemanticKITTI** — this limits direct comparison against SuMa++, ERASOR, and FreeDOM on community-standard datasets.

### Odometry — ATE RMSE (metres)

**Geometrically Rich (GR) scenes** — urban environments with abundant planar surfaces. Dynamic objects are not geometrically dominant; BTSA matches baselines.

| Sequence | FAST-LIO2 | iG-LIO | TRLO | BTSA |
|---|---|---|---|---|
| D_1 Promenade01 | 2.15 | 1.98 | 3.37 | 3.65 |
| D_2 Promenade02 | fail | fail | 0.54 | 0.64 |
| E_1 Dense street day difficult | 1.97 | 1.61 | 8.82 | 1.98 |
| E_2 Dense street day medium a | 1.60 | fail | 1.23 | 1.47 |
| E_3 Dense street day medium b | 1.16 | 1.18 | 1.21 | 0.89 |
| U_1 UrbanNav-HK-20190428 | 4.11 | 3.91 | 11.96 | 3.43 |
| U_2 UrbanNav-HK-20200314 | 1.13 | 0.92 | 0.94 | 0.91 |

Dynamic-LIO is not reported in these GR sequences (noted as an implementation constraint in the paper).

**Dynamic-Object Dominated (DOD) scenes** — sequences where a majority of scan points are on moving objects; the hardest category. FAST-LIO2 diverges catastrophically (12–28 m ATE).

| Sequence | FAST-LIO2 | iG-LIO | TRLO | BTSA |
|---|---|---|---|---|
| D_4 MountainTopPark01 | 12.40 | 0.74 | 0.80 | 0.79 |
| D_5 MountainTopPark02 | 28.33 | fail | 1.91 | 1.83 |
| D_6 MountainTopPark03 | 16.99 | fail | 2.82 | 3.04 |

BTSA achieves 0.79–3.04 m ATE on DOD sequences versus 12.4–28.3 m for FAST-LIO2.

**Geometrically Degenerate (GD) scenes** — tunnel and long bridge sequences where scan geometry is near-planar (underconstrained ICP). All baselines diverge; BTSA is the only method that does not. BTSA achieves 0.46 m ATE on G_2 (Urban_tunnel03, 6749 m). The dynamic-detection mechanism provides implicit geometric robustness: removing dynamic-point noise reduces the chance of a degenerate ICP alignment. This is among the most compelling results in the paper.

### Runtime Breakdown

| Component | Time (ms) |
|---|---|
| Core dynamic-aware state estimation (4D normals + IEKF) | 37.38 |
| Spatial consistency verification (SCV) | 6.08 |
| Other (preprocessing, map update) | ~6.23 |
| **Total per scan** | **~49.69** |

Budget fits within 100 ms (10 Hz LiDAR). At 20 Hz (50 ms budget), the margin is essentially zero — not safe to deploy at 20 Hz on Jetson Orin without optimising the SVD computation or reducing the temporal window. Dynamic-LIO (1–9 ms) is the compute-constrained alternative.

### Static Map Quality — Helimos Dataset

Helimos evaluates static map building accuracy across four LiDAR sensors with metrics SA (Static Accuracy), DA (Dynamic Accuracy), and HA (Harmonic mean of SA and DA). Online comparison methods: MCDOD, Dynablox, OTD. Offline methods: BeautyMap, DUFOMap.

**Aeva (FMCW 4D LiDAR):**

| Method | SA (%) | DA (%) | HA (%) |
|---|---|---|---|
| BeautyMap (offline) | 69.34 | 79.98 | 74.12 |
| DUFOMap (offline) | 91.93 | 79.33 | 84.57 |
| MCDOD (online) | 61.60 | 94.71 | 74.21 |
| Dynablox (online) | 97.64 | 64.78 | 75.81 |
| OTD (online) | 80.74 | 43.22 | 54.26 |
| **BTSA (online)** | **91.50** | **77.77** | **82.50** |

BTSA is the best online method on the Aeva sensor (HA 82.50%), ahead of all online baselines and within 2 points of the best offline method (DUFOMap HA 84.57%).

**Avia:**

| Method | SA (%) | DA (%) | HA (%) |
|---|---|---|---|
| OTD | 93.80 | 76.66 | 83.20 |
| BTSA | 93.66 | 67.64 | 75.87 |
| DUFOMap | 96.30 | 72.33 | 80.43 |

**Ouster128:**

| Method | SA (%) | DA (%) | HA (%) |
|---|---|---|---|
| DUFOMap | 90.06 | 90.23 | 89.99 |
| BTSA | 95.46 | 72.07 | 81.80 |

**Velodyne VLP16 — sparse-sensor degradation:**

| Method | SA (%) | DA (%) | HA (%) |
|---|---|---|---|
| BeautyMap | 76.62 | 84.73 | 80.10 |
| **BTSA** | **74.15** | **48.93** | **57.79** |

The VLP16 collapse from HA 82.50% (Aeva) to 57.79% (VLP16) is significant. The paper attributes this directly to sparse point distribution: "sensors with sparse point distributions challenge the assumption of local uniformity needed for accurate normal vector estimation, increasing false positive rates." The 16-beam VLP16 does not provide enough neighbors per local neighborhood to reliably estimate the 4D covariance and extract a stable temporal component.

### Ablation Study

| Variant | GR RMSE (m) | GD RMSE (m) | DOD RMSE (m) |
|---|---|---|---|
| Without dynamic detection | 0.79 | 35.84 | 6.14 |
| Sequential detection (no 4D temporal window) | 0.59 | 0.60 | 1.01 |
| **Full BTSA (4D normal + SCV)** | **0.64** | **0.46** | **0.79** |

The GD result is the most informative: removing dynamic detection entirely causes 35.84 m RMSE in the tunnel sequence (catastrophic divergence); a frame-by-frame alternative without the spatio-temporal window gives 0.60 m; the full 4D integration gives 0.46 m. The temporal window provides a measurable, material improvement over single-frame approaches in degenerate scenes.

---

## Variants and Lineage

BTSA occupies a specific niche in the online dynamic-aware LIO family. The key dimension of comparison is the dynamic flagging mechanism.

### SuMa++ — Semantic Label Consistency (IROS 2019)

RangeNet++ assigns class labels to each LiDAR point. ICP correspondence weight w_i = 0 if the point belongs to a dynamic class (car, person, cyclist) or if map and scan label are inconsistent. Detection is semantic and model-bound. BTSA is model-free and class-agnostic; SuMa++ is the anchor for the learned branch of the family. See [SuMa / SuMa++](suma.md).

### RF-LIO — Range-Image Differencing (arXiv 2022)

Current scan's range image is compared against the aligned submap; pixels with range difference above a threshold are flagged dynamic. Requires a prior pose to align scan and submap — subject to the circular dependency BTSA resolves. Reports 90% ATE improvement versus LOAM on UrbanLoco but is vulnerable to incidence-angle false positives on sloped surfaces.

### DO-Removal-LIO — Region-Growing Cluster Confidence (RA-L 2025)

Ground fitting -> seed selection -> region growing -> cluster confidence scoring. Geometry-only; no learned model; no prior pose required for the ground-fit step (fitted from the current scan only). Multiline context-beam feature extractor for ICP. Uses single-scan spatial clustering confidence; BTSA uses temporal evidence across multiple frames. DO-Removal is faster (region-growing is O(n) over the scan); BTSA's 4D SVD over temporal neighbors is heavier (~49 ms). See [DO-Removal LIO](do-removal-lio.md).

### Dynamic-LIO — Label-Consistency O(1) Voxel Queries (IROS 2025)

Binary ground/non-ground label per point. Voxel-location nearest-neighbor lookup in global map at O(1) cost. Dynamic if fewer than 5 neighbors in map (sudden appearance) or label-inconsistent with ground-map neighbors. Overhead 1–9 ms per sweep — the lowest in the family. At 20 Hz, Dynamic-LIO is the only online method with comfortable margin. Requires a prior map for comparison; not circular-dependency-free in the same sense as BTSA. Code: https://github.com/ZikangYuan/dynamic_lio.

### SegNet4D-in-SLAM — Semantic + MOS Unified (Research Direction)

Not a single published LIO paper but the trajectory of combining 4D semantic segmentation (SegNet4D, MambaMOS, MotionSeg3D) with LIO front ends to produce both semantic class and moving-object-segmentation labels in a single forward pass. Represents the learned end of the detection spectrum; highest accuracy but most compute-intensive. BTSA and Dynamic-LIO are the geometry-only counterparts.

### Summary Comparison

| Method | Mechanism | Prior pose needed? | Model-free? | Compute overhead | Slow-mover sensitivity | Venue |
|---|---|---|---|---|---|---|
| SuMa++ | Semantic soft exclusion | Yes (map projection) | No | Medium (inference) | Moderate | IROS 2019 |
| RF-LIO | Range-image differencing | Yes | Yes | Low | Low | 2022 |
| DO-Removal | Region-grow + cluster confidence | Partial (ground fit only) | Yes | Low-medium | Low-medium | RA-L 2025 |
| Dynamic-LIO | Label consistency O(1) voxel | Yes (map lookup) | Yes | Very low (1–9 ms) | Low | IROS 2025 |
| **BTSA** | **4D spatio-temporal normal SVD** | **No** | **Yes** | **~49 ms** | **High** | **RA-L 2025** |

---

## Strengths

**No prior pose required for dynamic detection.** The 4D normal is computed from raw timestamped point clouds in the temporal window. No dependency on a prior pose estimate. This directly resolves the circular-dependency problem common to range-image and map-comparison methods.

**Model-free and class-agnostic.** No learned segmentation or detection network. Any moving object — regardless of class or shape — that displaces local geometry within the ~2 s temporal window generates a non-zero d component. This is the key advantage over SuMa++ and TRLO in open-world and novel-domain settings (airside, warehouse, mining, port) where labeled training data are absent.

**High velocity sensitivity, including slow movers.** The temporal component d is a continuous, calibrated proxy for velocity. A surface moving at any velocity that produces detectable displacement within the ~2 s window will produce |d| > 0. This makes BTSA more sensitive to low-velocity movers than range-image (frame-to-frame) or label-consistency methods, which require a larger per-frame displacement to trigger a flag.

**Geometric degenerate scene robustness.** Removing dynamic noise from the ICP cost before alignment reduces the chance of spurious correspondences causing divergence in tunnels, bridges, and open corridors where any bad match can cause catastrophic drift. The ablation result (35.84 m -> 0.46 m RMSE in the tunnel sequence) is among the strongest evidence for this effect.

**Integrated into the LIO loop.** The flagging is embedded inside the IEKF iteration, not applied as a separate pre-processing stage. The dynamic mask updates with each correction step, improving with each IEKF iteration within the same scan.

**Public code and dataset links.** GPL-2.0 code at https://github.com/thisparticle/btsa. Enables reproduction and adaptation without paywall access.

---

## Failure Modes

### 1. Sparse LiDAR — VLP16 Collapse

The 4D covariance construction assumes local uniformity of the point neighborhood: enough points must exist to accurately estimate the local surface normal and the temporal direction. Sensors with sparse point distributions — Velodyne VLP16 at 16 beams and ~300k points/s — violate this assumption near object surfaces and at range boundaries, producing unreliable d estimates and elevated false-positive rates.

The Helimos Velodyne results confirm this quantitatively: HA drops from 82.50% on Aeva to 57.79% on VLP16. This is not a tuning problem; it is a geometric sampling density problem fundamental to the 4D normal estimator.

**Implication for deployment.** Airside LiDAR systems typically use 32-beam or 64-beam sensors. 32-beam sensors fall in a grey zone. 64-beam sensors approach the density level where BTSA is reliable. For production airside use, 64-beam or higher is the safe baseline.

### 2. Stationary Objects Within the Temporal Window — Critical Limitation

A vehicle, GSE unit, or any physical object that is **completely stationary** throughout the entire ~2 s temporal window will produce d approximately 0 at all points, regardless of whether it is a permanent fixture or a temporarily parked object. The 4D normal cannot detect objects that have not moved during the observation window. Specific airside examples:

- A parked GSE belt loader at an aircraft stand (stationary for 30+ minutes)
- Boarding stairs extended to an aircraft door
- A catering truck docked to a galley door
- A GPU or ASU staged near a gate
- A ground-power cable run across a taxilane

All are treated as static structure by BTSA and inserted into M_v as permanent map points.

This is not a deficiency unique to BTSA — it is a fundamental property of any motion-detection method. Objects that never move during the observation window cannot be detected by observing their motion.

Cross-link: [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md) covers this class of problem and the lifelong-mapping mitigations (LT-Mapper, Khronos, instance quarantine). BTSA cannot substitute for Stage 3 of the layered pipeline.

### 3. Slow Movers Below the Effective Velocity Threshold

If an object moves less than approximately one voxel width (typically 0.1–0.2 m) over the full ~2 s temporal window, d may remain below 0.1. A vehicle traveling at 0.05 m/s moves only 0.1 m in 2 seconds — near the detection floor. Pedestrians above ~0.5 m/s are reliably detected; very slow-moving GSE at under 0.1 m/s may not be.

This is better than single-frame range-image methods, which test frame-to-frame displacement rather than integrated 2 s displacement. But the window is finite and slow movers can slip through.

### 4. Temporal Window Edge Effects — Residual False Positives

Newly observed static regions generate non-zero d because their temporal neighborhood is one-sided. The SCV step mitigates this via overlap with M_scc, but the mitigation is approximate. Very recently confirmed static regions may not yet be in M_scc, creating transient false positives (static structure excluded from ICP) at the onset of new observations as the robot rounds a corner or enters a previously unseen space.

### 5. Compute Overhead — Marginal at 20 Hz

At 10 Hz (100 ms budget): ~49.69 ms leaves approximately 50 ms for IEKF convergence, map updates, and downstream consumers. Acceptable on modern hardware.

At 20 Hz (50 ms budget): essentially no margin. BTSA cannot safely run at 20 Hz on Jetson Orin without optimising the SVD computation or reducing the temporal window. Dynamic-LIO (1–9 ms) is far better positioned for high-frequency or resource-constrained deployments.

### 6. No KITTI / SemanticKITTI Benchmark

The paper does not evaluate on KITTI odometry sequences or SemanticKITTI's standard dynamic-map removal benchmark (PR/RR/F1). Direct comparison against SuMa++, ERASOR, FreeDOM, and other community-standard baselines is therefore limited. The results on GEODE/Helimos are strong, but external validation on the most-cited community datasets is absent.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV — outdoor urban, high traffic | Strong research fit | Matches the paper's primary motivation; DOD results directly applicable. No KITTI benchmark limits cross-comparison. |
| Road AV — highway / open road | Good | Fewer dynamic objects; largest gains on high-dynamic sequences. |
| Airside apron — active GSE, tugs, vehicles | Conditional | Geometry-only; handles unknown GSE types without retraining. Requires 64-beam or higher LiDAR. Compute at ~50 ms marginal for 20 Hz airside sensors. |
| Airside apron — parked / staged GSE | Not suitable (static-but-transient blind spot) | Stationary transients are invisible to BTSA. Use instance-quarantine or lifelong mapping for Stage 3. |
| Indoor warehouse | Candidate | Handles pedestrians and forklifts class-agnostically. Validate on actual warehouse sensor density and layout. |
| Port / logistics yard | Conditional | Large fast movers (cranes, straddle carriers) produce strong signal. Staged/parked equipment is static-but-transient blind spot. |
| Mining / construction | Conditional | Large machinery produces strong motion signal. Irregular terrain does not degrade BTSA directly (no ground-fitting step). |
| Agriculture / outdoor vegetation | Weak research candidate | Vegetation motion in wind can generate false d signals; evaluate carefully. |
| Offline static map building | Supporting role (Stage 1) | Use as front-end online LIO; always follow with offline ERASOR++ / FreeDOM at Stage 2. |

---

## Aggregated-Map Suitability — Layered Pipeline Position

BTSA is the **Stage 1 online LIO** component of a four-stage layered aggregated-map-building pipeline. It is not a replacement for the offline or lifelong stages. For compute-constrained deployments, Dynamic-LIO (1–9 ms) is the Stage 1 alternative.

```
Stage 1 — Online LIO (real-time, per-frame)
  Candidates: BTSA | DO-Removal | Dynamic-LIO | STATIC-LIO
  Removes: actively moving objects during the survey
  Residual: slow movers (below d threshold), objects that stopped,
            false-negative DBSCAN clusters, sparse-sensor false positives
  BTSA advantage: best slow-mover sensitivity; no prior-pose circular dependency
  BTSA disadvantage: ~50 ms compute; sparse-LiDAR unreliable below 32 beams
  Dynamic-LIO alternative: 1-9 ms; use when compute is constrained or LiDAR is 32-beam

Stage 2 — Offline cleaning (post-survey, after full traversal)
  ERASOR++ / FreeDOM / MapCleaner / DR-Remover
  Removes: residual dynamic ghosts from Stage 1, boundary fragments
  Achieves higher PR/RR F1 (0.93-0.99) because full temporal evidence is available
  Cross-links: erasor-plus-plus.md, freedom-dynamic-object-removal.md,
               mapcleaner.md, dr-remover.md, lidar-map-cleaning-dynamic-removal.md

Stage 3 — Lifelong static-but-transient removal
  LT-Mapper / Khronos / ELite / instance-quarantine
  Removes: objects stationary for the full survey window (parked GSE, staged equipment)
  Operates on calendar-time scale (hours, days, sessions)
  Mandatory for airside: apron is dominated by stationary transients that no
  online or single-pass offline method can remove
  Cross-links: lt-mapper-khronos-lifelong-mapping.md,
               static-but-transient-point-removal.md

Stage 4 — Semantic map quality
  Segmentation on the cleaned static map produces per-class layers
  Dynamic contamination reduced across Stages 1-3 -> higher segmentation quality
  Cross-links: aggregated-map-semantic-segmentation.md,
               sd-slam-semantic-dynamic-lidar.md
```

**Airside guidance.** Use BTSA at Stage 1 if the LiDAR is 64-beam or higher and the compute budget allows ~50 ms/scan (10 Hz). Use Dynamic-LIO at Stage 1 if compute is constrained or LiDAR is 32-beam. Stage 2 (offline) always follows regardless of online method. Stage 3 is mandatory for airside: the airport apron is dominated by stationary transients that neither BTSA nor any online method can remove.

---

## Implementation Notes

- **Reproduce the published benchmark first.** Run the official repository (https://github.com/thisparticle/btsa) on the provided GEODE or Helimos dataset flows before modifying parameters or porting to new sensors. Confirm the ~49.69 ms per-scan runtime on the target hardware.
- **Validate LiDAR density before committing.** The VLP16 collapse (HA 57.79%) is a hardware-compatibility signal, not a tuning problem. Profile per-point neighborhood density at deployment range before assuming BTSA is viable. 64-beam minimum is the safe threshold; 32-beam requires empirical validation on target sequences.
- **Version temporal-window length, d_thr, DBSCAN radius, and bounding-box priors.** These parameters interact. A shorter window improves compute at the cost of slow-mover sensitivity. A higher d_thr reduces false positives on noisy sensors at the cost of missing faster movers. Always document parameter versions alongside benchmark results.
- **Store removed points as a QA layer.** Do not discard dynamic-flagged points. Log them per scan with their d values and cluster IDs. This enables post-hoc inspection of borderline removals and threshold adjustment without re-running the full pipeline.
- **Monitor static inlier count after filtering.** A cleaner map is not useful if ICP becomes underconstrained because too many points were removed. Track the ratio of stable-to-total points per scan and alert if it falls below a threshold (domain-specific; approximately 30–40% stable for urban scenes).
- **Benchmark at 10 Hz before considering 20 Hz.** The ~49.69 ms total leaves no margin at 50 ms. If 20 Hz is required, profile the SVD computation on the deployment chip (Orin vs desktop GPU), reduce the temporal window, or switch to Dynamic-LIO as the Stage 1 online method.
- **Stage 2 is mandatory.** Even with BTSA active, run ERASOR++ or FreeDOM on the accumulated map before map publication. BTSA reduces ghost-trail density entering the offline cleaner; it does not reach offline F1 quality (0.93–0.99). See [ERASOR++](erasor-plus-plus.md) and [FreeDOM](freedom-dynamic-object-removal.md).
- **For airside: Stage 3 is non-negotiable.** Parked GSE, boarding stairs, docked catering trucks, and staged fuel equipment are the dominant map-contamination sources on an active apron. All are stationary transients invisible to BTSA. Budget for LT-Mapper or instance-quarantine before declaring map quality sufficient for safety-critical navigation.
- **Compare against a Dynamic-LIO baseline** before committing to BTSA in compute-constrained configurations. Dynamic-LIO's 1–9 ms overhead is categorically safer for 20 Hz deployments and embedded hardware. BTSA's advantage is sensitivity to slow movers and no prior-pose dependency; confirm these advantages matter for the deployment before paying the compute cost.

---

## Sources

| Item | URL |
|---|---|
| BTSA paper (arXiv 2510.22313) | https://arxiv.org/abs/2510.22313 |
| BTSA HTML paper | https://arxiv.org/html/2510.22313v1 |
| BTSA IEEE Xplore (doc 11207655) | https://ieeexplore.ieee.org/document/11207655/ |
| BTSA GitHub (GPL-2.0) | https://github.com/thisparticle/btsa |
| BTSA ResearchGate | https://www.researchgate.net/publication/396968226 |
| Spatio-temporal normals precursor (Falque, Le Gentil, Sukkar 2023) | https://arxiv.org/abs/2310.13273 |
| Truly-coupled LIO + spatiotemporal normals (Le Gentil, Falque, Vidal-Calleja, IROS 2024) | https://arxiv.org/abs/2410.05152 |
| Dynamic-LIO (Yuan et al., IROS 2025) | https://arxiv.org/abs/2407.03590 |
| Dynamic-LIO GitHub | https://github.com/ZikangYuan/dynamic_lio |
| RF-LIO (Qian et al., 2022) | https://arxiv.org/abs/2206.09463 |
| SuMa++ (Chen et al., IROS 2019 / arXiv 2021) | https://arxiv.org/abs/2105.11320 |
| SuMa++ GitHub | https://github.com/PRBonn/semantic_suma |
| DO-Removal (IEEE RA-L 2025) | https://ieeexplore.ieee.org/document/10807109/ |
| FAST-LIO2 (basis for BTSA front end) | https://arxiv.org/abs/2107.06829 |
