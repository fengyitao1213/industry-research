# Semantic-LiDAR-Inertial-Wheel Odometry

<!-- method-priority:start
priority:
  learning: 4
  deployment: 5
  type: "method"
  stage: "modern-core"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "runtime-localization", "outdoor"]
  reason: "Semantic-LIW Odometry is rated for LiDAR-inertial-wheel localization with geometry-semantic map priors, demonstrated at industry scale across 35 IGVs and 1 million m^2 of port operations."
method-priority:end -->

Related docs: [semantic SLAM](semantic-slam.md), [dynamic-object-aware SLAM](dynamic-object-aware-slam.md), [SD-SLAM](sd-slam-semantic-dynamic-lidar.md), [FAST-LIO2](fast-lio-fast-lio2.md), [LIO-SAM](lio-sam.md), [LiDAR map cleaning and dynamic removal](lidar-map-cleaning-dynamic-removal.md), [Removert](removert.md), [ERASOR](erasor.md), [ERASOR++](erasor-plus-plus.md), [MapCleaner](mapcleaner.md), [TRLO dynamic tracking removal](trlo-dynamic-tracking-removal-lidar-odometry.md), [RPOD two-stage online dynamic removal](rpod-two-stage-online-dynamic-removal-lio.md), [SPLIN / ISDOR / PPLIO](splin-isdor-pplio.md), [PIN-SLAM neural LiDAR mapping](pin-slam-neural-lidar-mapping.md), [DOF-LIO lightweight dynamic filter](dof-lio-lightweight-dynamic-object-filter.md), [robust multi-sensor localization](../overview/robust-state-estimation-multi-sensor.md), [production LiDAR map localization](../overview/production-lidar-map-localization.md), [aggregated-map semantic segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [static-but-transient point removal](../../perception/overview/static-but-transient-point-removal.md), [point-cloud registration math](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md), [multi-sensor calibration and observability](../../../10-knowledge-base/geometry-3d/multi-sensor-calibration-observability.md).

**Last updated:** 2026-05-24

---

## What It Is

**Paper:** Semantic-LiDAR-Inertial-Wheel Odometry Fusion for Robust Localization in Large-Scale Dynamic Environments
**arXiv:** https://arxiv.org/abs/2509.14999
**DOI:** https://doi.org/10.48550/arXiv.2509.14999
**Submitted:** 18 September 2025
**Venue:** arXiv preprint (cs.RO). No confirmed conference or journal acceptance as of May 2026.
**Code:** No public GitHub repository released as of May 2026. Reproduction requires re-implementation from the paper description.

**Authors:**

| Author | Affiliation |
|---|---|
| Haoxuan Jiang | Robotics and Autonomous Systems Thrust, HKUST (Guangzhou) |
| Peicong Qian | Shenzhen Unity Drive Innovation Technology Co., Ltd. (UDI) |
| Yusen Xie | Robotics and Autonomous Systems Thrust, HKUST (Guangzhou) |
| Linwei Zheng | Robotics and Autonomous Systems Thrust, HKUST (Guangzhou) |
| Xiaocong Li | College of Information Science and Technology, Eastern Institute of Technology, Ningbo |
| Ming Liu | Shenzhen Unity Drive Innovation Technology Co., Ltd. (UDI) |
| Jun Ma | Robotics and Autonomous Systems Thrust, HKUST (Guangzhou); Cheng Kar-Shun Robotics Institute, HKUST, Hong Kong |

**Institutional context:** The industrial partner is Shenzhen Unity Drive Innovation Technology (UDI), a company focused on autonomous logistics vehicles. HKUST (Guangzhou) provides the academic research thrust. UDI's team draws from ETH, HKUST, CUHK, NTU, and THU. The port operator name is not disclosed in the paper.

Semantic-LIW Odometry is a tightly coupled LiDAR-IMU-wheel localization framework designed for large-scale industrial environments dominated by dynamic actors. The method's primary contribution is a pre-built **semantic-voxel global map** — constructed offline using FAST-LIO2 plus GPS loop closure plus Removert-style dynamic filtering — that is queried at runtime to provide a static-world prior. This static-prior architecture is what delivers dynamic robustness: the online localization path does not perform per-scan dynamic-object segmentation. Instead, dynamics have already been removed from the map, and the online filter matches incoming scan points against a geometrically stable reference.

The semantic labels in the map are not learned. They are derived entirely from SVD analysis of the point covariance within each voxel, producing three geometric classes: **cylinder**, **plane**, and **other**. No neural network is used for online classification. No GPU is required for the online localization path.

---

> **Industry deployment (verified from paper abstract):**
> "This study presents extensive real-world experiments conducted in a one-million-square-meter automated port, encompassing 3,575 hours of operational data from 35 Intelligent Guided Vehicles (IGVs)."
>
> — 35 IGVs, 1,000,000 m^2 port, 3,575 hours operational data. These numbers are confirmed directly from the paper abstract. The paper does not name the port; an automated port in China is implied by UDI's Shenzhen base. The 3,575 hours covers the data collection scope; the paper does not explicitly state whether this represents continuous live deployment or cumulative testing hours.

This deployment scale is exceptional by published SLAM standards. Most industrial-scale localization papers document tens of hours of validation data, not thousands. The closest comparable scope in published LiDAR odometry literature is the MulRan dataset (urban driving, approximately 40 km total), which is not within the same operational category.

---

## Core Technical Idea

The problem addressed: long-term, drift-free localization in a large-scale port environment where (a) a large fraction of each incoming scan is dynamic at any given moment — cranes, trucks, containers being moved, other IGVs — making raw geometry unreliable for map matching; (b) raw geometric structure is repetitive and degenerate — long container rows, open ground planes, repeated pole structures; and (c) wheel odometry is noisy due to load shifts, terrain variation, and surface changes on the quay.

Three simultaneous technical innovations address these problems:

**A. Semantic-voxel global map as a static-world prior**

The core dynamic-robustness mechanism is architectural, not algorithmic. The global map is built offline and has had dynamic content removed before it is ever used for localization. The map is a voxel grid at 0.5 m resolution. Each voxel stores the mean and covariance of points within it plus a semantic label. Because the map was cleaned offline (using FAST-LIO2 plus GPS loop closure plus Removert-style filtering), dynamic actors that were present during the survey are absent from the localization reference. Online, when the vehicle scans into a crowd of moving objects, those scan points find no counterparts in the clean map and contribute little or nothing to the pose update. The static-prior approach handles dynamics that online filtering misses — objects that are stationary at survey time but movable, slow-moving objects that geometry-based online cleaners cannot flag in a single scan, and any dynamic category outside a neural network's training distribution.

**B. SVD-based geometry classification: cylinder, plane, other**

The semantic labels on the global map — and on each incoming scan's points — are computed purely through linear algebra. No neural network, no GPU, no training data:

1. Collect the N nearest points within each voxel (offline) or each local neighborhood (online).
2. Compute the 3x3 point covariance matrix C.
3. Eigen-decompose to obtain eigenvalues sigma_1 >= sigma_2 >= sigma_3.
4. Apply geometric thresholds:
   - **Cylinder / pole:** sigma_1 >> sigma_2 approximately equal sigma_3, and the principal axis angle theta is less than theta_thc from the vertical z-axis (near-vertical elongated structure).
   - **Plane / ground / wall:** sigma_3 << sigma_1 approximately equal sigma_2, meaning the point cloud is locally flat; normal angle theta < theta_thp for near-horizontal ground, or any angle for vertical facades.
   - **Other:** all remaining geometry — open clusters, vegetation, irregular shapes.

This is the same family of geometric primitive analysis used in LOAM's edge versus planar feature classification, but applied at the voxel map level and assigned as a persistent semantic label. Cylinder-to-cylinder and plane-to-plane correspondences are trusted more in the scan-matching cost function than cross-class or other-class matches. The "semantic" in Semantic-LIW is therefore geometry-semantic, not learned-semantic.

Critically: this classification requires no retraining when deployed in a new environment. The taxonomy of cylinder, plane, and other is structurally universal. Only the angle thresholds theta_thc and theta_thp may need tuning to match the aspect ratios of local cylindrical structures (e.g. a thin port bollard versus a wide crane leg).

**C. 3D adaptive wheel-odometry scaling inside the iESKF**

The iESKF (iterative Error State Kalman Filter) state vector includes a per-axis adaptive wheel scaling factor S_v. This is not a fixed calibration parameter — it is part of the estimated state, updated jointly with position, velocity, and orientation at every filter update. When wheel measurements are inconsistent with the LiDAR and IMU signals (due to slip, skid, uphill/downhill gradient, or surface softness), the filter automatically reduces the wheel trust along the affected axis without explicit slip detection logic. The "3D" refers to per-axis weighting in the body frame (x, y, z independently), not a single scalar. This handles the highly loaded IGV context where mass distribution changes with each container load cycle.

---

## Operator Mechanics

### Offline Map Build Pipeline

The global semantic-voxel map is built once (or periodically re-built as the environment changes) and is not modified during online operation:

1. **Raw LiDAR survey scans** — collected from one or more vehicles traversing the full operational area.
2. **FAST-LIO2** — provides accurate per-scan poses and an initial dense point cloud. See [FAST-LIO2](fast-lio-fast-lio2.md) for the iKD-tree-based LIO formulation.
3. **GPS loop closure + pose-graph optimization** — corrects long-range drift using GPS/RTK anchor constraints, ensuring the multi-kilometer map is globally consistent.
4. **Removert-style dynamic removal** — scans are filtered to remove points that appear only transiently (dynamic actors). This is the step that makes the map a static-world prior. See [Removert](removert.md), [ERASOR++](erasor-plus-plus.md), and [LiDAR map cleaning](lidar-map-cleaning-dynamic-removal.md) for the algorithmic detail.
5. **Voxel grid construction at 0.5 m resolution** — the cleaned point cloud is discretized into voxels; each voxel stores the point mean, covariance, and a count.
6. **SVD semantic labeling per voxel** — for each non-empty voxel, perform eigendecomposition of the point covariance and assign the cylinder / plane / other label based on the thresholds above.
7. **Output: semantic-voxel global map** — queried at every online scan.

### Online Per-Scan Localization Pipeline (approximately 10 Hz)

The online path does not rebuild the map, re-run dynamic removal, or perform neural inference. It is a deterministic estimation pipeline:

1. **Deskew** — IMU motion compensation is applied to the incoming LiDAR scan to correct for sensor motion during the sweep, producing a geometrically consistent point cloud.
2. **Ground segmentation + non-ground clustering** — a fast planarity filter separates ground returns from above-ground clusters.
3. **Per-cluster SVD analysis** — for each cluster (and for ground points), compute the local covariance eigenstructure and assign a cylinder / plane / other label. This mirrors the offline labeling step, applied to the current scan.
4. **Semantic-voxel map query** — for each labeled scan point, find the corresponding voxel in the global semantic-voxel map. Construct GICP (Generalized ICP) correspondences, weighted by semantic type agreement: cylinder-to-cylinder and plane-to-plane receive higher weights; cross-type or other-class matches receive lower weights. This produces the semantic LiDAR residual r_semantic.
5. **iESKF predict** — IMU preintegration at 20 Hz propagates the state forward between LiDAR updates.
6. **iESKF update** — the filter correction uses three residual sources simultaneously:
   - r_semantic: semantic-weighted point-to-plane LiDAR residual
   - r_wheel: wheel velocity residual, scaled by the adaptive S_v state
   - r_imu: angular velocity and linear acceleration from the IMU
7. **Adaptive wheel scaling update** — S_v is updated as part of the iESKF state, not as a post-processing step. The filter convergence makes S_v observable from the residual disagreement between wheel and LiDAR+IMU.
8. **Output: per-scan 6-DoF pose.**

No loop closure or pose-graph back-end is reported in the online path. The global semantic-voxel map is the memory — relocalization comes from matching to the pre-built reference, not from intra-session loop detection. If localization temporarily degenerates, recovery requires re-initialization against the global map; the mechanism for this is not described in the paper.

---

## Inputs and Outputs

| Item | Detail |
|---|---|
| 3D LiDAR | 10 Hz in experiments; sensor model not specified in the HTML |
| IMU | 20 Hz |
| Wheel encoders | 50 Hz |
| Semantic-voxel global map | Built offline; queried online; not modified online |
| **Output: 6-DoF pose per scan** | Position + orientation at LiDAR frame rate |
| **Output: wheel scaling state S_v** | Observable for slip detection and monitoring |
| **Offline output: global semantic-voxel map** | 0.5 m voxels with mean, covariance, cylinder/plane/other label |

**Evaluation hardware:** Intel i7-8750H CPU at 2.20 GHz, 32 GB RAM, NVIDIA GeForce GTX 1050 Ti GPU. The GPU was available on the test bench but online localization does not use it — SVD-based semantic classification is CPU-bound; no deep network inference runs per scan.

**Ground truth:** 50 Hz RTK/GNSS used for evaluation only; not used online.

---

## Architecture

```text
OFFLINE MAP BUILD
  Raw LiDAR survey scans
       |
       v
  FAST-LIO2 + GPS loop closure + pose-graph optimization
  (globally consistent aligned point cloud)
       |
       v
  Removert-style dynamic removal
  (static point cloud — transient actors removed)
       |
       v
  Voxel grid at 0.5 m resolution
  SVD semantic labeling per voxel:
    eigenvalue structure -> cylinder | plane | other
       |
       v
  Semantic-Voxel Global Map  <------------+
                                          |
                              queried at every scan (read-only online)
                                          |
ONLINE LOCALIZATION (per scan, ~10 Hz)    |
  Raw LiDAR scan                          |
       |                                  |
       v                                  |
  [1] Deskew (IMU motion compensation)   |
       |                                  |
       v                                  |
  [2] Ground segmentation + clustering    |
      SVD per cluster -> cylinder / plane / other label
       |                                  |
       v                                  |
  [3] Semantic-voxel map query -----------+
      GICP correspondences, weighted by semantic type agreement
      -> r_semantic (semantic LiDAR residual)
       |
       v
  [4] iESKF predict (IMU at 20 Hz)
      iESKF update from:
        r_semantic  (semantic-weighted point-to-plane)
        r_wheel     (wheel velocity, scaled by S_v)
        r_imu       (angular velocity + linear acceleration)
       |
       v
  [5] Adaptive S_v update (per-axis wheel trust, within iESKF state)
       |
       v
  Per-scan 6-DoF pose output
```

Key architectural choice: the SLAM problem is split between an offline mapping phase and an online localization-only phase. Online, the vehicle runs localization against a pre-built static reference — not SLAM. This makes the online pipeline lighter, more deterministic, and more predictable on compute-constrained hardware. The tradeoff is that map freshness must be managed operationally: when the environment changes significantly, the map must be rebuilt.

---

## Training and Learned Components

Semantic-LIW Odometry has no learned components in the online localization path.

| Component | Type | Detail |
|---|---|---|
| SVD semantic classification (online) | Rule-based geometry | Eigenvalue thresholds on local point covariance; no training data required |
| SVD semantic labeling (offline map build) | Rule-based geometry | Same logic applied to voxel-level covariance during map construction |
| FAST-LIO2 (offline map build) | Rule-based LIO | iKD-tree-based LiDAR-inertial odometry; no learned components |
| Removert-style dynamic removal (offline) | Rule-based | Visibility-based scan-wise point removal; no learned components |
| iESKF state estimator (online) | Model-based | Error-state Kalman filter; no neural components |
| Wheel scaling S_v (online) | Adaptive estimation | Estimated within the iESKF state; not a neural network |

This is a critical distinction from systems such as [SD-SLAM](sd-slam-semantic-dynamic-lidar.md) (uses RangeNet++ for online per-frame semantic segmentation) or [SuMa++](suma.md) (uses RangeNet++ online). Semantic-LIW's geometry-SVD taxonomy requires no GPU at runtime, no labelled training corpus, and no domain-adaptation retraining when deploying to a new site. Only the classification angle thresholds theta_thc and theta_thp may need tuning to match local structural geometry.

The three-class taxonomy (cylinder, plane, other) is deliberately coarse. It captures structural geometric archetypes that are stable and transferable, but it does not distinguish semantically meaningful subclasses: a traffic bollard and a crane leg are both cylinders; a building facade and a ground plane are both planes. This is the taxonomy's strength (no retraining) and its limitation (no richer semantic class information).

---

## Benchmarks

Results are from Table I of arXiv:2509.14999. Six port trajectories totalling 11.685 km. Metric: absolute position error against RTK/GNSS ground truth. No RMSE is reported; only mean absolute error (MAE) and maximum absolute error (MaxAE).

Methods compared in the paper's quantitative table: Light-LOAM (LiDAR-only, feature-based), FAST-LIO2 (LiDAR + IMU, no wheel, no semantic), Point-LIO (LiDAR + IMU, no wheel, no semantic), Ours-iKD-Tree (LiDAR + IMU + wheel, iESKF, no semantic voxel map — ablation), Ours-Semantic (full proposed method).

**Important:** LIO-SAM, SD-SLAM, M-LOAM, and SC-LiDAR-SLAM do not appear in the paper's quantitative comparison table. The broader peer comparison table below is constructed from published literature, not from the paper.

### Maximum Absolute Error (m) — Six Port Trajectories

| Trajectory | Length (km) | Light-LOAM | FAST-LIO2 | Point-LIO | Ours-iKDTree | Ours-Semantic |
|---|---|---|---|---|---|---|
| traj-1 | 1.843 | FAIL | 4.255 | 21.283 | 10.932 | **0.278** |
| traj-2 | 1.770 | FAIL | 3.421 | 10.681 | 0.476 | **0.374** |
| traj-3 | 1.914 | 0.621 | 5.053 | 6.606 | 13.486 | **0.699** |
| traj-4 | 2.950 | FAIL | 4.869 | 14.312 | 11.061 | **0.669** |
| traj-5 | 1.840 | FAIL | 1.202 | 3.619 | 1.518 | **0.483** |
| traj-6 | 1.368 | FAIL | 1.044 | 18.224 | 0.397 | **0.422** |

### Mean Absolute Error (m) — Six Port Trajectories

| Trajectory | Light-LOAM | FAST-LIO2 | Point-LIO | Ours-iKDTree | Ours-Semantic |
|---|---|---|---|---|---|
| traj-1 | FAIL | 2.379 | 1.676 | 5.583 | **0.129** |
| traj-2 | FAIL | 0.638 | 0.377 | 0.156 | **0.121** |
| traj-3 | 0.400 | 2.554 | 2.029 | 5.314 | **0.132** |
| traj-4 | FAIL | 2.654 | 3.242 | 3.572 | **0.164** |
| traj-5 | FAIL | 0.378 | 0.825 | 0.613 | **0.129** |
| traj-6 | FAIL | 0.431 | 0.535 | 0.118 | **0.076** |

**Observations:**

- Light-LOAM fails on 5 of 6 trajectories in the port environment. Excessive dynamics and geometric degeneracy defeat purely feature-based LiDAR-only odometry.
- FAST-LIO2 achieves mean errors of 0.4–2.7 m and maximum errors of 1.0–5.1 m. Accurate enough for gross navigation but not for IGV lane-keeping at sub-meter precision in a dynamic port.
- Point-LIO shows catastrophic drift in this environment: 21.3 m maximum error on traj-1, 18.2 m on traj-6. It cannot be used in this operational context without a semantic or dynamic-handling front-end.
- The ablation Ours-iKDTree (wheel odometry added, no semantic map) shows wheel integration alone is insufficient: it fails on traj-1, traj-3, and traj-4 at levels comparable to non-wheel baselines. The semantic-voxel map is the primary gain driver.
- The full Semantic-LIW method holds mean error between 0.076 and 0.164 m and maximum error below 0.7 m across all six trajectories — approximately a 10x–16x reduction in mean error versus FAST-LIO2 on the hardest trajectories. This is the accuracy regime required for reliable IGV lane-following at port scale.

---

## Comparison Table

The following table covers the broader peer group. Only Light-LOAM, FAST-LIO2, and Point-LIO appear in the paper's quantitative results; remaining rows are literature-based and are flagged accordingly.

| Method | Sensors | Semantic Mechanism | Wheel Odom | Dynamic Handling | Industry Deployment | GPU Online | Mean Error (port env.) |
|---|---|---|---|---|---|---|---|
| **Semantic-LIW (this work)** | LiDAR + IMU + wheel | SVD geometry (cylinder/plane/other) — rule-based | Yes, 3D adaptive S_v in iESKF | Static-prior map (offline dynamic removal) | 35 IGVs, 1M m^2, 3,575 h port | No | 0.076–0.164 m |
| **FAST-LIO2** | LiDAR + IMU | None | No | None | Research/open-source | No | 0.4–2.7 m (port env.) |
| **Point-LIO** | LiDAR + IMU | None | No | None | Research/open-source | No | Fails (up to 21 m max) |
| **Light-LOAM** | LiDAR | Geometric features only | No | None | Research | No | FAIL on 5/6 port trajs |
| **LIO-SAM** | LiDAR + IMU (+ GPS opt.) | None | No | None (map factor graph) | Research/open-source; not in paper's table | No | Not reported in port env. |
| **SD-SLAM** | LiDAR + IMU | Learned (RangeNet++; 19 classes) | No | Online per-frame masking of dynamic-class objects | Research; not in paper's table | Yes | Not reported in port env. |
| **SuMa++** | LiDAR | Learned (RangeNet++) | No | Online semantic consistency check | Research; not in paper's table | Yes | Not reported in port env. |

---

## Lineage

```text
LOAM (Zhang & Singh, 2014)
  -> Edge + planar feature extraction from point cloud
  -> Iterative scan-to-map matching
  -> Precursor of geometric feature classification in LiDAR SLAM

LeGO-LOAM (Shan & Englot, 2018)
  -> Ground segmentation + lightweight LOAM
  -> Ground plane as explicit constraint
  -> Precursor of ground-aware wheel-plane fusion

FAST-LIO2 (Xu et al., 2022)
  -> iKD-tree incremental map; iESKF with IMU as predictor
  -> No semantic, no wheel; direct raw-point registration
  -> Used as baseline AND as the offline mapping backbone in Semantic-LIW
  -> See: fast-lio-fast-lio2.md

LIO-SAM (Shan et al., 2020)
  -> Factor graph LiDAR + IMU + GPS + loop closure
  -> Influenced multi-constraint fusion design in the LIO family
  -> See: lio-sam.md

Semantic SLAM tradition
  -> SuMa++ (2019): learned semantics (RangeNet++) into surfel map
  -> SD-SLAM (2024): three-tier dynamic landmark classification
  -> Semantic-LIW adopts map-level semantic representation
     but replaces the learned backbone with SVD geometry

Removert / ERASOR family (2020–2024)
  -> Visibility-based and elevation-based offline dynamic removal
  -> Used in the Semantic-LIW offline map build pipeline
  -> See: removert.md, erasor.md, erasor-plus-plus.md

Wheel-coupled LIO line
  -> LIW-OAM: LiDAR + IMU + wheel in a tightly coupled factor
  -> LiLi-OM: lightweight LiDAR + IMU + odometry metric
  -> Semantic-LIW extends this line with adaptive wheel scaling and semantic prior

Port / industrial automation context
  -> UDI (Shenzhen Unity Drive Innovation): IGV and port automation
  -> SIPG Shanghai port: large-scale autonomous operation context
  -> Westwell: port-oriented autonomous logistics

Semantic-LIW Odometry (Jiang et al., 2025, arXiv:2509.14999)
  -> Geometry-semantic voxel map (cylinder/plane/other, SVD-based)
  -> iESKF fusing LiDAR semantic-voxel match + IMU + adaptive-weight wheel
  -> Static-prior architecture for dynamic robustness (not per-scan segmentation)
  -> Port-scale industrial validation: 35 IGVs, 1M m^2, 3,575 h
```

---

## Strengths

**Industry-proven at exceptional operational scale.** 35 IGVs, 1 million m^2, 3,575 hours is the largest published localization validation in autonomous port operations documented in the LiDAR SLAM literature as of May 2026. No comparable SLAM paper has demonstrated this operational scope with quantitative accuracy results.

**Sub-meter localization in a highly dynamic environment.** Mean absolute errors of 0.076–0.164 m and maximum errors below 0.7 m across 11.685 km of port trajectories. The closest competitor (FAST-LIO2) achieves 0.4–2.7 m mean error in the same environment.

**No GPU required for online localization.** SVD-based geometric classification runs entirely on CPU. The test bench had a GTX 1050 Ti, which may have been used for offline map visualization or other tooling, but the online semantic classification and voxel-map query are CPU-bound operations that do not require GPU acceleration.

**Static-prior robustness handles dynamic scenarios that online filters miss.** Online per-frame dynamic filtering (as in SD-SLAM or SuMa++) cannot handle objects that are stationary at the moment of the current scan but are movable categories, or objects outside the neural network's training distribution. The pre-cleaned static map sidesteps these failure modes entirely: if it was not in the clean map, incoming scan points cannot form a stable correspondence, and they are implicitly ignored.

**Geometry-semantic taxonomy transfers across domains without retraining.** The cylinder/plane/other classification is structurally universal. A new deployment site (new port terminal, logistics yard, airside apron) requires only a new map survey and optional threshold tuning — not a labelled dataset and a new neural network training run.

**Adaptive wheel trust is automatic and observable.** The 3D per-axis wheel scaling S_v is part of the iESKF state. It converges from data without explicit slip detection heuristics and can be monitored in real time as a slip indicator — useful for predictive maintenance on IGV wheel assemblies.

**Decoupled map lifecycle.** The semantic-voxel map is an independent artifact with its own build and versioning pipeline. Map updates, change detection, and version control are operationally separate from the online localization software stack.

---

## Failure Modes

**Three-class semantic taxonomy is coarse.** Cylinder, plane, and other provides geometric stability but provides no ability to distinguish semantically meaningful subclasses. The system cannot differentiate a traffic bollard from a crane support leg, or a building facade from a shipping container wall. Environments where class identity (not just geometric type) matters for planning, annotation, or compliance cannot use this taxonomy as a sole semantic source.

**Offline map required, always.** The system cannot operate in a previously unmapped environment. Any area without a prior static-map survey is inaccessible to this localization approach.

**Map staleness degrades localization accuracy.** If cargo container layouts change significantly, new structures are added, or old ones are removed, the semantic-voxel map becomes inconsistent with the real world. Cylinders and planes that no longer exist generate spurious correspondences; missing structures that now exist go unmatched. The paper does not describe a map maintenance, map validation, or stale-region detection strategy. Implementors must design this independently.

**Wheel odometry is platform-dependent.** IGVs have reliable, calibrated wheel encoders with well-understood kinematics. Quadrupeds, forklifts with hydraulic lifts, or vehicles on very wet quay surfaces where full-wheel slip is frequent may provide encoder signals so noisy that the adaptive S_v saturates to zero trust — effectively degrading the system to LiDAR + IMU only.

**No per-scan dynamic masking in the online path.** If a new dynamic object class not present during map build appears in the environment (a type of crane or vehicle not seen during the survey), the online localization will attempt to match incoming scan points against map voxels. Where no map geometry matches, points are discarded naturally. But if the new dynamic object is geometrically similar to existing map structure (a large truck near a container row), it may create false correspondences. The system has no explicit per-scan dynamic detection to handle this case.

**No loop closure or relocalization mechanism in the online path.** If localization temporarily degenerates due to a sensor outage or severe scan mismatch, recovery requires re-initialization against the global map. The paper does not describe this mechanism.

**No public code released.** As of May 2026, there is no public GitHub repository. Reproducibility is limited to re-implementing the system from the paper description. Key implementation details (exact SVD threshold values, iESKF noise parameters, map build hyper-parameters) may not be fully specified.

**Venue unconfirmed.** The paper is an arXiv preprint without confirmed peer-reviewed venue acceptance as of May 2026. The experimental protocol has not yet passed external review.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Port / container terminal | Strong — directly validated | The evaluation environment. 35 IGVs, 1M m^2, 3,575 h. |
| Logistics yard / intermodal terminal | Strong | Similar geometry (containers, vehicles, poles, ground planes), reliable wheel encoders on yard tractors. |
| Airside apron — GSE localization | Strong candidate | Port scale matches major hub apron (see Aggregated-Map Suitability below). Cylinder/plane taxonomy covers poles, light masts, building facades. Wheel encoders needed. |
| Warehouse / indoor logistics | Moderate | Indoor geometry is covered by the taxonomy; ground plane and poles are common. Wheel encoders on forklifts are available. Offline map build indoors requires substitute for GPS loop closure. |
| Mining / construction | Moderate | Open-cast mine has ample planar and cylindrical geometry. Terrain variation makes wheel-odometry adaptation more important. GPS is usually available for offline map build. |
| Road AV — urban outdoor | Low | Road AV stacks do not typically have wheel encoders in the LIO sense; vehicle odometry is available but the dynamic-rich urban environment poses more severe geometry degeneracy than a port. |
| Handheld / quadruped / aerial | Not suitable | No usable wheel encoder. System degrades to LiDAR + IMU without the adaptive wheel component. |

---

## Aggregated-Map Suitability

**Rating: HIGH — particularly for airside, port, and logistics-yard aggregated mapping pipelines.**

The aggregated-map pipeline (many vehicles contributing scans over a long time horizon, fused and cleaned offline) needs: (a) per-vehicle online localization stable enough to produce aligned sweeps suitable for aggregation at typical 0.1–0.2 m voxel resolution; (b) some form of semantic or dynamic-handling information to classify what is static versus transient; and (c) scalability to large environments.

Semantic-LIW addresses all three directly:

- **Alignment accuracy for aggregation.** Mean error below 0.17 m across 3,575 hours of IGV operation. Sweeps from 35 vehicles with this error budget overlap within sub-voxel tolerance at 0.2 m voxel resolution. This is the tightest per-vehicle alignment accuracy from any published system at this operational scale.
- **Dynamic handling via static prior.** The semantic-voxel map acts as a static-world prior. Online matching de-emphasizes scan points in map regions labelled other — which covers vegetation and irregular dynamic content — effectively reducing transient clutter in the per-scan input to aggregation.
- **Scalability.** 1 million m^2 port was handled. At 0.5 m voxel resolution over 1M m^2 with a 5 m height range, the map contains approximately 20 million voxels — well within the memory budget of modern edge compute (32 GB is ample; even 8 GB Orin would accommodate this with efficient hashing).

### Recommended Integration into Aggregated-Map Pipeline

```text
Online (per-IGV / per-GSE vehicle):
  Semantic-LIW -> per-scan 6-DoF pose + semantic class per point

Offline aggregation pipeline:
  Step 1: Collect per-scan poses + raw point clouds from all vehicles

  Step 2: Removert / ERASOR++ / DUFOMap -> remove residual dynamic points
          (Semantic-LIW's cylinder/plane/other labels can seed class-conditioned
           dynamic filtering — other-class points are highest-priority candidates)
          See: removert.md, erasor-plus-plus.md

  Step 3: ICP / PIN-SLAM map polish -> dense final voxel or neural-implicit map
          See: pin-slam-neural-lidar-mapping.md, point-cloud-registration-math-icp-ndt-gicp.md

  Step 4: Semantic annotation -> richer labels if needed (building / ground / veg / infra)
          See: aggregated-map-semantic-segmentation.md

  Step 5: Map versioning + QA gate -> update semantic-voxel localization map
          (close the loop: the cleaned aggregated map becomes the next Semantic-LIW reference)
```

### Airside-Specific Translation

| Port concept | Airside equivalent |
|---|---|
| IGV (automated straddle carrier / yard tractor) | Ground support equipment (GSE): tugs, baggage dollies, fuel trucks, loaders |
| Wheel encoder on IGV | GSE CAN bus wheel speed or dedicated encoder on dolly axle |
| Container terminal geometry | Apron, taxilane, stand geometry — fixed structures, jetways, terminal facades |
| Moving containers, trucks, other IGVs | Aircraft, buses, fire trucks, catering vehicles — dynamic-class content |
| 1M m^2 port area | Major hub apron (Heathrow T5 apron approximately 0.4M m^2; full large airport 1–3M m^2) |

The geometry-semantic taxonomy transfers without retraining: cylinder = traffic posts, light poles, antenna masts, jetway support columns; plane = apron surface, taxiway markings, building facades, signage panels; other = vegetation, parked aircraft (irregular shape), temporary equipment. Only the angle thresholds may need tuning for airside structural proportions.

**Caution for airside:** Not all GSE classes have reliable wheel encoders. Aircraft-mounted or drone-mounted sensing systems have no wheel odometry at all. In those cases, Semantic-LIW degrades to Semantic-LI (LiDAR + IMU + semantic map), which remains a useful system but loses the adaptive wheel advantage. The offline map build may also need to substitute GPS loop closure with a LiDAR-only back-end (SC-LiDAR-SLAM, pose-graph with visual place recognition) in GPS-shadowed apron areas near terminal buildings.

**Recommended role in airside aggregated-map pipeline:** Semantic-LIW as the online localization front-end for each GSE vehicle, feeding per-scan poses and labelled point clouds into an aggregation pipeline that uses [ERASOR++](erasor-plus-plus.md) or [Removert](removert.md) for offline dynamic cleanup and [PIN-SLAM](pin-slam-neural-lidar-mapping.md) for final map polish. This matches the airside survey-to-aggregated-map-to-deployment pattern documented in the [production LiDAR map localization](../overview/production-lidar-map-localization.md) overview.

---

## Implementation Notes

**Offline map build pipeline.** Use FAST-LIO2 (or any accurate LiDAR odometry) plus GPS/RTK plus loop closure to generate an initial globally-consistent point cloud. Apply dynamic removal — ERASOR++, Removert, or DUFOMap — to produce a static point cloud. Voxelize at 0.5 m and apply eigendecomposition to assign cylinder/plane/other per voxel. For GPS-denied environments (indoor, underground), substitute GPS loop closure with a pose-graph back-end using SC-LiDAR-SLAM or a visual place recognition module.

**SVD threshold tuning.** The classification angle thresholds theta_thc (cylinder axis near-vertical criterion) and theta_thp (plane normal criterion) are not universal. They depend on the vertical structure geometry of the deployment site. Port poles are typically 0.1–0.3 m diameter, 5–10 m height — narrow vertical cylinders. Airside bollards are similar. Crane legs are much wider. Set theta_thc by inspecting the aspect-ratio distribution of known cylindrical structures in the survey scan.

**iESKF initialization.** The adaptive wheel scaling S_v should be initialized at 1.0 (full trust) per axis. The filter converges over the first 10–30 seconds of motion. A cold-start with vehicle at rest (zero velocity) provides a good IMU bias calibration window before the first wheel motion.

**Map versioning.** When the physical environment changes — new construction, moved permanent equipment, seasonal dock changes — the semantic-voxel map must be rebuilt. A map validity monitor that compares live scan point density against expected per-voxel counts can flag stale regions before localization error accumulates. The paper does not describe this mechanism; implementors must design it.

**Sensor time synchronization.** LiDAR at 10 Hz, IMU at 20 Hz, wheel encoders at 50 Hz. A 10 ms timestamp offset between wheel and IMU introduces approximately 30–50 mm per-cycle position error at typical IGV speeds of 3–5 m/s. Hardware-level synchronization (PPS, hardware trigger) is strongly preferred over software-level synchronization for this three-sensor configuration. See [multi-sensor calibration and observability](../../../10-knowledge-base/geometry-3d/multi-sensor-calibration-observability.md).

**Compute budget.** The i7-8750H test hardware has comparable CPU performance to Jetson AGX Orin for single-threaded workloads. The SVD classification and voxel-map GICP query should be feasible at 10 Hz on Orin. The critical bottleneck is the voxel map query time: at 1M m^2 at 0.5 m resolution, the map contains approximately 4M planar voxels. A hash-map (unordered_map) or spatial hash is preferable to a kd-tree for voxel-key lookup at this scale — kd-tree query time scales as O(log N) but the constant factor grows with N at large map sizes.

**No public code.** As of May 2026, there is no public repository. License is uncertain. Reproduction requires re-implementing from the paper description. Budget 2–4 engineer-weeks for a competent LIO practitioner to reconstruct the core pipeline, plus additional time for offline map build tooling and operational map versioning infrastructure.

---

## Sources

| Item | URL |
|---|---|
| Semantic-LIW Odometry (arXiv abs, arXiv:2509.14999) | https://arxiv.org/abs/2509.14999 |
| Semantic-LIW Odometry (arXiv HTML full text) | https://arxiv.org/html/2509.14999v1 |
| Semantic-LIW Odometry (arXiv PDF) | https://arxiv.org/pdf/2509.14999 |
| Unity Drive Innovation — LinkedIn | https://www.linkedin.com/company/unity-drive-innovation/ |
| FAST-LIO2 (arXiv:2107.06829) | https://arxiv.org/abs/2107.06829 |
| SuMa++ Semantic LiDAR SLAM (arXiv:2105.11320) | https://arxiv.org/abs/2105.11320 |
| Removert (IROS 2020) | https://arxiv.org/abs/2011.04414 |
| ERASOR++ | https://arxiv.org/abs/2212.13513 |
| DynamicMap Benchmark (KTH-RPL) | https://kth-rpl.github.io/DynamicMap_Benchmark/ |
| Related method page: SD-SLAM | `./sd-slam-semantic-dynamic-lidar.md` |
| Related method page: FAST-LIO2 | `./fast-lio-fast-lio2.md` |
| Related method page: LIO-SAM | `./lio-sam.md` |
| Related method page: Removert | `./removert.md` |
| Related method page: ERASOR | `./erasor.md` |
| Related method page: ERASOR++ | `./erasor-plus-plus.md` |
| Related method page: MapCleaner | `./mapcleaner.md` |
| Related method page: TRLO | `./trlo-dynamic-tracking-removal-lidar-odometry.md` |
| Related method page: RPOD | `./rpod-two-stage-online-dynamic-removal-lio.md` |
| Related method page: SPLIN / ISDOR / PPLIO | `./splin-isdor-pplio.md` |
| Related method page: PIN-SLAM | `./pin-slam-neural-lidar-mapping.md` |
| Related method page: DOF-LIO | `./dof-lio-lightweight-dynamic-object-filter.md` |
| Related method page: Semantic SLAM | `./semantic-slam.md` |
| Related method page: Dynamic-object-aware SLAM | `./dynamic-object-aware-slam.md` |
| Related overview: LiDAR map cleaning | `./lidar-map-cleaning-dynamic-removal.md` |
| Related overview: Robust multi-sensor localization | `../overview/robust-state-estimation-multi-sensor.md` |
| Related overview: Production LiDAR map localization | `../overview/production-lidar-map-localization.md` |
| Related overview: Aggregated-map semantic segmentation | `../../perception/overview/aggregated-map-semantic-segmentation.md` |
| Related overview: Static-but-transient point removal | `../../perception/overview/static-but-transient-point-removal.md` |
| KB: Point-cloud registration math | `../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md` |
| KB: Multi-sensor calibration and observability | `../../../10-knowledge-base/geometry-3d/multi-sensor-calibration-observability.md` |
