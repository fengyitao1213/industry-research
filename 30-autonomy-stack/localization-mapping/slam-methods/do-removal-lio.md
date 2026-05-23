# DO-Removal LIO

<!-- method-priority:start
priority:
  learning: 4
  deployment: 5
  type: "method"
  stage: "deployment-pattern"
  maturity: "pilot-proven"
  tags: ["slam", "mapping", "validation", "runtime-localization", "outdoor"]
  reason: "DO-Removal LIO is rated for dynamic-object filtering and map-cleaning workflows that protect localization maps."
method-priority:end -->

Related docs: [ERASOR](erasor.md), [ERASOR++](erasor-plus-plus.md), [FreeDOM](freedom-dynamic-object-removal.md), [MapCleaner](mapcleaner.md), [DR-Remover](dr-remover.md), [LiDAR Map Cleaning — Dynamic Removal](lidar-map-cleaning-dynamic-removal.md), [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md), [Dynamic-Object-Aware SLAM](dynamic-object-aware-slam.md), [Dynamic-Aware LIO BTSA](dynamic-aware-lio-btsa.md), [DOF-LIO](dof-lio-lightweight-dynamic-object-filter.md), [FAST-LIO / FAST-LIO2](fast-lio-fast-lio2.md), [SuMa / SuMa++](suma.md), [SD-SLAM Semantic-Dynamic LiDAR](sd-slam-semantic-dynamic-lidar.md), [LT-Mapper / Khronos](lt-mapper-khronos-lifelong-mapping.md), [MoVES and Label-Free Map Cleaning](moves-and-label-free-map-cleaning.md), [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [LiDAR Artifact Removal Techniques](../../perception/overview/lidar-artifact-removal-techniques.md).

**Last updated:** 2026-05-23

---

## What It Is

**Full title:** DO-Removal: Dynamic Object Removal for LiDAR-Inertial Odometry Enabled by Front-End Real-Time Strategy

**Venue:** IEEE Robotics and Automation Letters (RA-L), Vol. 11, No. 1, pp. 169–176, 2026 (published online approximately December 2024 – January 2025).

**DOI:** 10.1109/LRA.2025.3632615

**IEEE Xplore ID:** 10807109 — https://ieeexplore.ieee.org/document/10807109/

**Author list:** Not confirmed open-access at research time. Abstract text circulated via search snippets (ResearchGate, Semantic Scholar) is internally consistent across sources, suggesting a Chinese-institution group. Full attribution requires IEEE Xplore access; do not cite a specific author list without verifying against the paywall record.

DO-Removal is a front-end real-time dynamic-object removal method integrated directly inside a LiDAR-inertial odometry (LIO) loop. Its defining departure from the classical approach is the integration point: dynamic-object flagging happens before ICP correspondence computation and before local-map insertion, so the LIO map accumulates only static structure from the first scan onward. No offline post-hoc cleaning pass is required for the LIO map itself to be usable.

The method is geometry-only in its detection mechanism: ground fitting, region growing from high-curvature seed points, cluster-confidence scoring, and a novel multiline context-beam feature extractor. No trained segmentation model is needed. This makes it deployable across novel domains — including airside apron, warehouse, port, and mining environments — without labeled training data.

DO-Removal should be understood as the focal representative of a broader **online dynamic-aware LIO family**, in which dynamic filtering is embedded inside the LIO front end rather than applied as a post-processing step. The family includes at least thirteen published methods between 2019 and 2026. This page covers the focal paper, the full family, the online-versus-offline trade-off, failure modes, and the layered architecture for aggregated-map building.

**Naming note.** "DO-Removal-LIO" is an informal name used in the research notes for this family. A separate 2025 paper, "Online dynamic object removal for LiDAR-inertial SLAM via region-wise pseudo occupancy and two-stage scan-to-map optimization" (R-POD, *Displays* vol. 88, DOI 10.1016/j.displa.2025.103030, TUM-affiliated), also appears in searches. R-POD is a member of the same family and is treated in Section 4.10 below; it is not the same paper as DO-Removal.

---

## Core Technical Idea

Most LIO systems (FAST-LIO2, LIO-SAM, LOAM-class) accumulate the full raw scan into their local map. Moving objects leave ghost trails that contaminate the map incrementally — each new scan registers against ghost-polluted geometry, degrading subsequent pose estimates. Offline cleaners (ERASOR, FreeDOM) address this after the fact, but they require the complete survey to be available before cleaning can begin.

DO-Removal breaks the contamination loop by inserting a dynamic detector between the raw scan and the LIO update. The key mechanism is:

1. **Ground fitting** — a fast per-frame ground plane is fitted as a reference. Points below the height threshold are excluded from dynamic detection.
2. **Seed selection and region growing** — points with significant geometric features (high curvature, edge-like geometry) are selected as seeds; a region-growing step expands each seed to capture the full dynamic object candidate region.
3. **Cluster confidence scoring** — each grown cluster receives a confidence score derived from its size, height span, aspect ratio, and spatial consistency. High-confidence clusters are labelled dynamic.
4. **ICP exclusion gating** — dynamic-labelled cluster points are excluded from the ICP cost function, forcing pose estimation against static-only correspondences.
5. **Map insertion gating** — only static-labelled points enter the local map.
6. **Multiline context-beam feature extraction** — a novel feature-extraction step that considers context from adjacent LiDAR scan lines simultaneously rather than processing individual points in isolation, improving feature significance for the ICP matching stage.

The result is that the incremental LIO map is clean per-frame. The downstream consumer — whether it is a planner, an HD-map builder, or an offline cleaner — receives a map that has never contained actively moving objects.

---

## Inputs and Outputs

| Item | Role |
|---|---|
| Raw LiDAR scan (per frame) | Primary observation input; multiline spinning or solid-state. |
| IMU stream | Propagates LIO state between scans; compensates motion distortion. |
| Per-scan ego poses (prior/incremental) | Required to align the current scan against the local map for dynamic detection. |
| Ground plane model (per frame) | Fitted per scan; provides the height reference for non-ground candidate extraction. |
| Geometric seed points | High-curvature / edge-like points selected as region-growing starting points. |
| Cluster confidence scores | Dynamic/static confidence per grown cluster; controls ICP exclusion and insertion gating. |
| Multiline context-beam features | Context-aware LiDAR line features feeding the ICP objective. |
| **Output: 6-DOF odometry** | Pose estimate from the IEKF update computed on static-only correspondences. |
| **Output: clean incremental map** | Local map containing only static-labelled points; no dynamic ghost trails. |
| **Output: dynamic mask (per scan)** | Set of excluded points; useful for downstream QA and safety logging. |

---

## Operator Mechanics

Let p_i denote a point in the scan frame at time t. Let G_t be the fitted ground plane, parameterised as n·p + d = 0 (unit normal n, scalar offset d).

**Ground exclusion.** A point is a ground candidate if:

```
n · p_i + d  <  epsilon_g
```

where epsilon_g is the height-above-plane threshold, typically 0.15–0.30 m. Ground candidates bypass the dynamic detector and are treated as static by default.

**Non-ground candidates.** Points satisfying n · p_i + d >= epsilon_g enter the dynamic detection pipeline.

**Region growing.** For each seed point s_k (curvature above threshold tau_c), a region R_k is expanded iteratively:

```
R_k = R_k  union  { p_j  :  ||p_j - p_k|| < r_grow  AND  |n_j - n_k| < tau_n }
```

until no new points are added. The growth radius r_grow is typically 0.3–0.5 m for vehicle-scale objects.

**Cluster confidence.** For grown region R_k with N_k points, height span delta_z_k, and horizontal extent delta_xy_k:

```
confidence_k = f(N_k,  delta_z_k / H_obj_prior,  shape_score_k)
```

where H_obj_prior is a prior for typical moving-object heights and shape_score_k captures aspect-ratio plausibility. Clusters exceeding the confidence threshold are labelled dynamic.

**ICP residual exclusion.** For each dynamic-labelled cluster R_k, all ICP correspondences involving a point in R_k are removed from the cost function:

```
E = sum_{i  not in dynamic}  || T · p_i  -  q_i ||^2
```

This forces the odometry to estimate the ego-motion from static-structure correspondences only.

**Map insertion gating.** Only static-labelled points are added to the local map M_t:

```
M_{t+1} = M_t  union  { p_i  :  p_i not in any dynamic cluster R_k }
```

**IEKF update.** The iterated extended Kalman filter state update is structurally unchanged from the FAST-LIO2 formulation:

```
x_hat_k = x_bar_k + K_k · (z_k - h(x_bar_k))
```

where z_k and h(·) are computed exclusively over the static-filtered point set. This means DO-Removal can in principle be applied as a front-end wrapper to any LIO system whose ICP stage accepts a masked point set.

---

## Architecture and Pipeline

```
Raw LiDAR scan
      |
      v
[1] Ground fitting (RANSAC / PCA on lowest-height points)
      |
      v
[2] Non-ground candidate extraction (points above height threshold)
      |
      v
[3] Multiline context-beam feature extraction
    (considers adjacent scan-line context; improves feature significance)
      |
      v
[4] Seed selection (high-curvature / high-geometric-feature points)
      |
      v
[5] Region growing (flood-fill from seeds via spatial proximity)
      |
      v
[6] Cluster confidence scoring
    (cluster size, height span, aspect ratio, spatial consistency)
      |
      +------------------+
      |                  |
   DYNAMIC            STATIC
      |                  |
[7a] Exclude from     [7b] Include in
     ICP cost              ICP cost
      |                  |
[8a] Block from       [8b] Insert into
     map                   local map M_t
      |
      v
[9] IEKF state update (static-only correspondences)
      |
      v
Clean 6-DOF pose estimate + clean incremental map
```

### Comparison with FAST-LIO2 Baseline

| Stage | FAST-LIO2 | DO-Removal |
|---|---|---|
| Input scan | Raw LiDAR | Raw LiDAR filtered by dynamic mask |
| ICP correspondences | All non-ground points | Static-labelled points only |
| IEKF update | All matched correspondences | Dynamic-masked correspondences |
| Map insertion | All new points | Static-labelled new points only |
| Map state over time | Accumulates dynamic ghost trails | Stays clean per frame |

---

## Online vs Offline Dynamic Removal — The Trade-off

The online LIO-embedded family and the offline post-hoc stack (ERASOR, ERASOR++, FreeDOM, MapCleaner, DR-Remover) are complementary, not competing. They operate at different pipeline stages and handle different evidence regimes.

| Dimension | Online LIO-embedded (DO-Removal family) | Offline post-hoc (ERASOR / FreeDOM / MapCleaner) |
|---|---|---|
| When removal runs | Per frame, inside the LIO loop | After full map traversal; batch process |
| Access to future evidence | No — only past and present frames | Yes — full survey available |
| Temporal evidence | Limited (single frame or short window) | Full sequence |
| Clean map availability | Immediately, per frame | After full survey; latency = survey duration |
| Stationary-transient detection | Cannot detect (object never moves within scan window) | Cannot detect either (single-pass); needs lifelong methods |
| Pose-accuracy dependency | Uses initial / previous poses (noisier) | Uses final optimised poses (more accurate) |
| Over-removal risk | Higher — conservative flagging needed to protect odometry | Lower — can examine full trajectory before removing |
| Under-removal at high speed | Higher — fast movers may trail across frames | Lower — multi-scan evidence accumulates |
| Compute budget | Must fit within per-scan period (10–20 Hz LiDAR) | Can use offline batch compute |
| Primary metric | ATE improvement on high-dynamic sequences: 67–92% | Map quality PR/RR/F1: 0.93–0.99 on SemanticKITTI |
| Representative methods | DO-Removal, Dynamic-LIO, RF-LIO, DOR-LINS, DOF-LIO, STATIC-LIO, R-POD, Breaking-Static-Assumption | ERASOR, ERASOR++, FreeDOM, MapCleaner, Removert, DR-Remover, OTD |

**Key architecture insight.** The 67–92% ATE improvement figures quoted for the online family reflect localization accuracy in high-dynamic sequences — they measure how much cleaner the pose estimate is when dynamic points are excluded from the ICP cost. The offline stack's 0.93–0.99 F1 figures measure map point-cloud cleanliness after the fact. These are different quantities measured by different protocols, and both are needed in a production pipeline. The online method delivers a usable per-frame map; the offline method catches residual ghosts that the online pass missed because it had no future-frame evidence.

**Important caveat on DO-Removal ATE numbers.** Exact per-sequence ATE figures for DO-Removal itself are behind the IEEE Xplore paywall. The 67–92% improvement range is the aggregate across the online family (ID-LIO, RF-LIO, Dynamic-LIO, STATIC-LIO benchmarks confirmed from open-access sources). The DO-Removal paper reports competitive results against baselines; specific numbers should be verified against the IEEE RA-L record before production citation.

---

## The Online Dynamic-Aware LIO Family

Multiple papers have converged on the same integration point — a dynamic filter inside the LIO front end, not a post-hoc pass. Each differs primarily in its flagging mechanism. Thirteen methods span 2019 to 2026; the table below summarises the family, followed by extended notes on the methods with confirmed benchmark numbers or architecturally distinctive mechanisms.

| Method | Venue | Year | Flagging mechanism | Key distinction |
|---|---|---|---|---|
| SuMa++ | IROS | 2019 | RangeNet++ semantic labels; label-consistency ICP weighting | Semantic (learned); foundational predecessor |
| RF-LIO | arXiv | 2022 | Range-image differencing vs submap | +90% ATE vs LOAM on UrbanLoco |
| DOR-LINS | IEEE Sensors J. | 2023 | Ground pseudo-occupancy voxel check | Sudden-appearance test; LIO-SAM base |
| DRR-LIO | IEEE Sensors J. | 2023 | Vertical voxel height descriptor | Weighted de-emphasis, not hard exclusion; 119 ms/frame |
| LIO-DOR | IEEE ROBIO | 2023 | Cluster bounding-box collision volume | Frame-to-frame motion test; no submap lookup |
| ID-LIO | Sensors | 2023 | DON counter + pseudo-occupancy | Delayed removal; 67–85% ATE gain confirmed |
| Dynamic-LIO | IROS | 2025 | Label-consistency + nearest-neighbour map query | 1–9 ms/sweep; open-source; 68% ATE gain |
| DOF-LIO | IEEE T-IM | 2026 | Temporal visibility history + recovery step | Multi-frame evidence; see dedicated page |
| STATIC-LIO | Information Fusion | 2025 | Sliding-window terrain-assisted voting | Up to 92.4% ATE reduction |
| R-POD | Displays | 2025 | Pseudo-occupancy + two-stage optimisation | Explicitly breaks pose-detection circular dependency |
| TRLO | IEEE T-IM | 2025 | PointPillars + UKF tracking | Learned; RPE 1.10 m on KITTI seq 07; >20 Hz |
| Breaking-Static-Assumption | arXiv | 2025 | 4D spatio-temporal surface normals | Sensitive to slow movers; ~50 ms/scan |
| Dual-Stage Hierarchical | Autonomous Robots | 2026 | Range-image differencing + incidence-angle correction | Explicit grazing-surface false-positive suppression |

**SuMa++ (IROS 2019)** is the foundational predecessor. RangeNet++ semantic labels drive both ICP down-weighting for inconsistent label pairs and dynamic-class surfel filtering. The mechanism is semantic (trained model); DO-Removal is geometry-only. See [SuMa / SuMa++](suma.md).

**RF-LIO (arXiv 2022, arXiv:2206.09463, base: LIO-SAM).** Range-image differencing: the current scan's range map is compared against the submap; pixels with difference above a threshold are labelled dynamic and removed before ICP. **Results:** 90% ATE improvement vs LOAM, 70% vs LIO-SAM on UrbanLoco — the strongest open-access numbers in the family. Limitation: incidence-angle false positives on sloped surfaces.

**ID-LIO (Sensors 2023, DOI 10.3390/s23115188, open access).** Spatial pseudo-occupancy plus a Dynamic Observation Number (DON) counter: a point must be flagged in at least 3 consecutive frames before its dynamic label is confirmed. Indexed points carry keyframe IDs and DON counts; delayed removal applies near-zero weight to dynamic-scored points in the factor graph rather than hard-excluding them. **Confirmed ATE results:** UrbanLoco-CAMarketStreet +67% over LIO-SAM; UrbanNav-HK +85% RMSE, sub-1.1 m vs 7.51 m. These open-access numbers establish the lower bound of the family's 67–92% range.

**Dynamic-LIO (IROS 2025, arXiv:2407.03590, code: https://github.com/ZikangYuan/dynamic_lio).** Binarised label consistency: a point is dynamic if it has fewer than 5 nearest neighbours in the map (sudden appearance) or its ground/non-ground label contradicts its neighbours. Dual map structure: tracking-map retains all geometry for state estimation; output-map applies maximum removal. Overhead 1–9 ms per sweep — the lowest in the family. **Results (UrbanNav ULHK-CA):** 4.84 m ATE vs FAST-LIO2's 15.34 m (68% improvement). No degradation on static NCLT sequences. Preservation 90.36%, rejection 90.73% on KITTI dynamic sequences.

**STATIC-LIO (Information Fusion 2025).** Sliding-window voting accumulates per-point static/dynamic votes across frames; terrain-assisted progressive ground segmentation handles diverse LiDAR geometries. **Results:** up to 92.4% localisation-error reduction vs SOTA LIO baselines — the upper bound of the family's 67–92% range.

**R-POD (Displays 2025, DOI 10.1016/j.displa.2025.103030).** Two-stage scan-to-map optimisation: Stage 1 uses IMU-only prior for an improved initial pose; R-POD filtering then flags dynamics via region-wise pseudo-occupancy scan-ratio test; Stage 2 re-optimises using only static-region points. This is the most architecturally careful treatment of the circular dependency between pose accuracy and dynamic detection in the family.

**TRLO (IEEE T-IM 2025, arXiv:2410.13240, code: https://github.com/Yaepiii/TRLO).** Detection-before-tracking: PointPillars + UKF 3D MOT; objects with velocity above 1 m/s are masked before Fast G-ICP. **Results (KITTI seq 07):** RPE 1.10 m, APE 0.92 m at over 20 Hz. Limitation: model-dependent; unknown object categories (non-standard GSE, FOD) are invisible to the detector.

**Breaking-Static-Assumption (arXiv:2510.22313, accepted October 2025).** 4D implicit surface: the temporal component d of the 4D surface normal encodes motion velocity. Points with |d| above a threshold are classified unstable. Sensitive to slow movers via the temporal dimension. Runtime ~49.69 ms per scan. **Results on DOD sequences:** RMSE 0.79–3.04 m vs FAST-LIO2's 12.4–28.3 m.

**Dual-Stage Hierarchical (Autonomous Robots 2026, DOI 10.1007/s10514-026-10248-5).** Multi-resolution range-image differencing with explicit visibility-aware incidence-angle correction in Stage 1, followed by cluster-level reclassification in Stage 2. The incidence-angle correction is the primary advance over RF-LIO and Removert.

---

## Benchmark Results

**Honest framing of numbers in this section.** DO-Removal-specific ATE results are behind the IEEE Xplore paywall and are not reproduced from open-access sources. The table below reports confirmed open-access figures from other members of the online family, which together establish the performance envelope. The 67–92% ATE improvement range is real and sourced, but it spans multiple methods and datasets.

### ATE on High-Dynamic Sequences

| Method | Dataset | Improvement vs baseline | Baseline | Notes |
|---|---|---|---|---|
| RF-LIO | UrbanLoco | 90% | LOAM | Urban driving, heavy vehicle traffic |
| RF-LIO | UrbanLoco | 70% | LIO-SAM | Same dataset, different baseline |
| ID-LIO | UrbanLoco-CAMarketStreet | 67% ATE | LIO-SAM | DON sliding-window |
| ID-LIO | UrbanNav-HK | 85% RMSE | LIO-SAM | Sub-1.1 m vs 7.51 m |
| Dynamic-LIO | ULHK-CA (UrbanNav) | 68% (4.84 m vs 15.34 m) | FAST-LIO2 | IROS 2025 |
| STATIC-LIO | Various | up to 92.4% | SOTA LIO baselines | Upper bound in family range |
| Breaking-Static-Assumption | DOD sequences | ~80% (0.79–3.04 m vs 12.4–28.3 m) | FAST-LIO2 | 4D normal method |
| DO-Removal | Not confirmed open-access | Reported competitive | Stated vs baselines | Verify against IEEE Xplore |

### Map Quality — SemanticKITTI PR/RR/F1 (Offline Stack Reference)

Online DO-Removal methods are evaluated on ATE, not map PR/RR/F1. The offline stack owns the PR/RR/F1 benchmarks. These are provided for architectural context only — they are not directly comparable to the ATE figures above.

| Method | Type | F1 range | Notes |
|---|---|---|---|
| ERASOR | Offline | 0.921–0.955 | SemanticKITTI seq 00–07 |
| ERASOR++ | Offline | 0.930–0.986 | Higher PR than ERASOR |
| FreeDOM | Near-online + offline | 0.971–0.996 (estimated) | Best published F1 as of early 2025 |
| Dynamic-LIO | Online-LIO | 90.4% PR, 90.7% RR reported | IROS 2025; not on KTH benchmark format |

The F1 gap between online methods (roughly 0.90) and the best offline methods (0.97–0.99) reflects the structural disadvantage of the online approach: it has no access to future-frame evidence and cannot revisit a ghost that slipped through on the first pass. The offline stack's 0.93–0.99 F1 is genuinely unreachable by an online-only method. Both stacks are needed.

---

## Strengths

- **Immediate clean map.** The incremental map is free of actively moving objects from the first scan. No post-hoc cleaning pass is required to get a usable map; useful for real-time planning and obstacle avoidance systems that consume the LIO map directly.
- **Geometry-only detection.** No trained segmentation model. Works immediately on new domains (airside, warehouse, mining, port) without labeled data or retraining.
- **Works with FAST-LIO2-class LIO.** The dynamic mask is a pre-registration filter that can in principle be applied as a front-end wrapper to any LIO system accepting a masked point set.
- **No post-processing latency.** The cleaned map is available at LiDAR rate (10–20 Hz), not after a full survey traversal.
- **Multiline context-beam features.** The novel feature extractor is designed around the structure of multi-beam rotating LiDARs, potentially improving feature distinctiveness in scenes with limited vertical structure (open aprons, flat warehouses).
- **IEEE RA-L publication.** Peer-reviewed, with reported benchmark results. Provides a citable reference for production-pipeline documentation.
- **Complementary to offline stack.** Reduces the density of ghost trails entering ERASOR / FreeDOM, lowering their workload and improving their final map quality.

---

## Failure Modes

### 1. Static-but-Transient Blind Spot

This is the dominant failure mode in airside application and is not unique to DO-Removal — it applies to every method in the online family.

An object that is **stationary for the entire SLAM session** will never trigger any of the online detection mechanisms:
- It produces no range-image inconsistency (RF-LIO, DOF-LIO).
- It produces no label-consistency violation (Dynamic-LIO).
- It never accumulates a high DON count (ID-LIO).
- It never generates a collision-volume violation (LIO-DOR).
- It never appears in a suddenly-occupied voxel (DOR-LINS).
- It produces no temporal component in the 4D surface normal (Breaking-Static-Assumption).

**Airside examples.** A belt loader parked at stand 12 for the entire 40-minute survey pass; a catering truck docked to an aircraft door; boarding stairs extended and stationary; a GPU or ASU staged near a gate; a ground-power cable run across a taxilane. All of these are permanently stationary during the survey and will be baked into the static LIO map by any online DO-Removal method.

The solution requires a different layer of the stack. See [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md) for the full treatment of this problem and the available mitigations.

### 2. Slow-Mover Over-Retention

Objects moving slower than the spatial resolution of the dynamic detector per frame may not trigger flagging. A taxiing aircraft at 2 m/s, a pedestrian at 1.2 m/s, or a tug moving under 0.5 m/s can produce sub-threshold changes in range image, label consistency, or cluster position between consecutive frames. The Breaking-Static-Assumption 4D normal method is the most sensitive to low velocities in the family, via the temporal component d. STATIC-LIO's voting window also helps by accumulating evidence across more frames.

### 3. Ground Fitting Failure

The ground-fit reference can fail on ramps, kerbs, loading docks, uneven apron surfaces, and any non-flat terrain. A failed ground fit produces an incorrect height threshold, either including ground points in the dynamic detector (generating false positives on flat surfaces) or excluding non-ground candidates from detection (false negatives for objects at unusual heights). Airside aprons are generally flat but have drainage crowns, pavement joints, and irregular surfaces near stands that can perturb a simple PCA plane fit.

### 4. Semantic-Model Dependency (TRLO, SuMa++)

The learned-detector members of the family (TRLO with PointPillars, SuMa++ with RangeNet++) are bound to their trained class set. On the airside, non-standard GSE types, unusual aircraft configurations, and foreign object debris will be missed. For airside deployment the geometry-only members (DO-Removal, Dynamic-LIO, DOF-LIO, STATIC-LIO) are safer defaults.

### 5. Small and Unknown Object Misses

Region-growing and cluster-confidence methods require a minimum point count to form a reliable cluster. Small objects (cones, chocks, personnel protective equipment, FOD smaller than the LiDAR beam spacing at range) may produce too few points to form a stable cluster or to exceed the confidence threshold. These objects enter the static map as if permanent.

### 6. Over-Removal at Cluster Boundaries

Aggressive cluster growth can include adjacent static structure — ground points under a vehicle footprint, poles or bollards within the growth radius of a pedestrian cluster, walls adjacent to a slow-moving tug. DO-Removal's confidence scoring bounds this; DOF-LIO's explicit recovery step restores over-labelled static points. In practice, conservative confidence thresholds are preferred for odometry applications (a missed dynamic point damages pose accuracy less than a removed static structural point).

### 7. Compute Budget

Online methods must complete within the inter-scan period: 100 ms at 10 Hz, 50 ms at 20 Hz.

| Method | Overhead | Fits 100 ms (10 Hz) budget |
|---|---|---|
| Dynamic-LIO (label consistency) | 1–9 ms per sweep | Yes, large margin |
| Breaking-Static-Assumption (4D normal) | ~49.69 ms per scan | Yes, marginal |
| TRLO (PointPillars + UKF) | PointPillars ~5–15 ms on GPU (estimated) | Yes on GPU |
| DRR-LIO (height descriptor) | ~119.59 ms per frame | No — verify on target hardware |
| DO-Removal (region growing) | Not confirmed open-access | Likely < 50 ms (geometry-only); test before production |

### 8. Circular Dependency Between Pose and Detection

All online methods depend on a prior pose estimate to compare the current scan against the map. If the pose estimate is itself corrupted by dynamic objects, the comparison degrades. R-POD's two-stage approach directly addresses this; Dynamic-LIO's dual-map partially mitigates it. For DO-Removal, the IEKF propagation from the previous clean state provides the initial pose alignment, but a degraded prior (e.g., after a long gap in ICP coverage) can temporarily degrade detection quality.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV — outdoor urban, high traffic | Strong | The primary benchmark domain for the online family (UrbanLoco, UrbanNav, KITTI dynamic sequences). |
| Road AV — highway / open road | Good | Fewer dynamic objects; large improvement in heavy-traffic cases. |
| Airside apron — active GSE, tugs, vehicles | Candidate | Geometry-only methods handle unknown GSE types. Ground fitting needs verification on uneven apron surfaces; raise height threshold for aircraft gear. |
| Airside apron — parked / staged GSE | Not suitable (static-but-transient blind spot) | All online methods bake stationary GSE into the static map. Use instance-quarantine layer or lifelong mapping. See [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md). |
| Warehouse / indoor flat | Candidate | Works around forklifts and pedestrians if ground-ramp handling is tuned; low feature density may affect region growing. |
| Port / logistics yard | Conditional | Mix of large fast movers (good) and stationary staged equipment (static-but-transient blind spot). |
| Mining / construction | Conditional | Large machinery produces strong motion signal; irregular terrain degrades ground fitting. |
| Agriculture / outdoor vegetation | Weak | Vegetation produces false cluster candidates; ground fitting unreliable over crop rows. |
| Offline static map building | Supporting role | Reduces ghost trail density entering offline cleaners; does not replace them. |

---

## Aggregated-Map Suitability — The Layered Recipe

DO-Removal-LIO is the first stage in a layered architecture, not a replacement for the offline stack. The recipe below restates the SD-SLAM four-stage pipeline (see [SD-SLAM](sd-slam-semantic-dynamic-lidar.md) — Aggregated-Map Suitability section) in the terms of the online geometric LIO family.

```
Stage 1 — Online LIO front end with dynamic removal
  Methods: DO-Removal / Dynamic-LIO / STATIC-LIO / DOF-LIO / R-POD
  Removes: actively moving objects in real time
  Provides: clean per-frame map for real-time planning and safety functions
  Residual: slow movers, cluster boundary fragments, objects that
            slowed to a stop mid-survey, objects below point-density threshold

Stage 2 — Offline ERASOR++ / FreeDOM / MapCleaner / DR-Remover
  Runs on the full accumulated map after traversal completes
  Removes: ghost trails that survived Stage 1
  Achieves: higher PR/RR (0.93–0.99 F1) because full temporal evidence is available
  Cross-links: erasor-plus-plus.md, freedom-dynamic-object-removal.md,
               mapcleaner.md, dr-remover.md, lidar-map-cleaning-dynamic-removal.md

Stage 3 — Lifelong static-but-transient: LT-Mapper / Khronos / ELite / instance-quarantine
  Handles: temporarily stationary objects via multi-pass temporal differencing
  Operates: on calendar-time scale (hours, days, seasons)
  Cross-links: lt-mapper-khronos-lifelong-mapping.md,
               static-but-transient-point-removal.md

Stage 4 — Semantic map quality: segmentation on cleaned static map
  Semantic segmentation of the cleaned map produces per-class layers
  Dynamic contamination reduced across Stages 1–3 -> higher segmentation quality
  Cross-links: aggregated-map-semantic-segmentation.md,
               sd-slam-semantic-dynamic-lidar.md
```

**For airside application.** GSE belt loaders, catering trucks, boarding stairs, and GPU sets that are stationary for the full survey window will survive Stages 1 and 2. Only Stage 3 (lifelong / multi-pass or instance-quarantine) removes them. This is the dominant unsolved challenge in airside static-map building, and it applies to every online or offline dynamic removal method in existence today.

---

## Variants and Lineage

The online dynamic-aware LIO family does not have a single ancestor — it emerged from the convergence of several contemporaneous design decisions. The lineage below captures the main structural threads.

**Geometric offline predecessors (Removert 2020, ERASOR 2021).** Established the "removed-then-revert" paradigm and the PR/RR/F1 evaluation protocol. Did not integrate into the LIO loop.

**SuMa++ (IROS 2019).** First LiDAR SLAM with semantic-driven dynamic filtering inside the map update. The integration point (inside the SLAM loop) is the same as DO-Removal; the mechanism is semantic rather than geometric.

**Range-image in-loop methods (RF-LIO 2022, DRR-LIO 2023, Dual-Stage 2026).** Brought range-image differencing inside the LIO loop. Fast, but incidence-angle sensitive.

**Pseudo-occupancy in-loop methods (DOR-LINS 2023, R-POD 2025).** Extended the ERASOR/Removert pseudo-occupancy idea into the per-frame LIO update. R-POD's two-stage structure is the most architecturally principled within this sub-family.

**Confidence / voting methods (DO-Removal 2025, ID-LIO 2023, STATIC-LIO 2025).** Use per-cluster or per-point confidence / voting to make the dynamic decision, rather than a hard threshold. Smoother false-positive behaviour.

**4D spatio-temporal methods (Breaking-Static-Assumption 2025).** Extend the spatial normal concept to 4D (space + time), making the motion signal available without any map comparison.

**Learned-detector methods (TRLO 2025, SuMa++).** Trade domain generality for detection precision by using a trained 3D object detector or segmentor.

DO-Removal sits in the confidence/voting sub-family, with the addition of the multiline context-beam feature extractor as a distinguishing contribution.

---

## Implementation Notes

- **Paywall-limited reproducibility.** The full DO-Removal implementation details (exact confidence scoring formula, context-beam extractor architecture, parameter settings) are in the IEEE Xplore paper. Verify against the record at https://ieeexplore.ieee.org/document/10807109/ before production implementation. No official public repository was confirmed as of 2026-05-23.
- **Prototype with Dynamic-LIO first if open-source is required.** Dynamic-LIO (IROS 2025) has a public repository at https://github.com/ZikangYuan/dynamic_lio, published benchmarks, and a geometry-only mechanism comparable to DO-Removal. Use it as the open-source reference implementation while DO-Removal code availability is unconfirmed.
- **Reproduce the published benchmark setup before adapting to new sensors.** Test on UrbanLoco or UrbanNav with the same sensor configuration as the paper before moving to airside or warehouse data.
- **Tune ground-fitting parameters for the target environment.** The height threshold epsilon_g and ground-fitting inlier tolerance need validation on the deployment surface. Airside apron has drainage crowns; warehouse floors have pallet stands and ramp sections. Log the fitted ground plane per scan and inspect visually before trusting the detector output.
- **Log dynamic masks, not only binary labels.** Store the confidence score per cluster, not just the dynamic/static decision. This enables post-hoc inspection of borderline decisions and threshold adjustment without re-running the full LIO pipeline.
- **Compare against a no-removal baseline and a FAST-LIO2 baseline.** The improvement should be measurable in ATE on routes with moving objects; on static routes, the online removal should not degrade accuracy.
- **Airside-specific tests.** Inspect false removals near aircraft landing gear, jet bridges, ground markings, cones, chocks, and GSE. These have unusual geometry relative to road-vehicle training distributions and may trigger false-positive region growing.
- **Stage 2 is mandatory.** Even with online DO-Removal active, run ERASOR++ or FreeDOM on the accumulated map before map publication. Online methods do not reach offline F1 quality. This is an architectural requirement, not an optional refinement.
- **Compute budget on Orin.** The 100 ms Orin scan-cycle budget must accommodate the full LIO front end plus the dynamic detector. Dynamic-LIO's 1–9 ms overhead is safe; Breaking-Static-Assumption's ~50 ms is marginal. DO-Removal's overhead is not confirmed; benchmark on the deployment hardware before committing.

---

## Sources

| Item | Reference |
|---|---|
| DO-Removal (IEEE RA-L 2025) | https://ieeexplore.ieee.org/document/10807109/ · DOI: 10.1109/LRA.2025.3632615 (paywall) |
| RF-LIO (arXiv 2022) | https://arxiv.org/abs/2206.09463 |
| DOR-LINS (IEEE Sensors J. 2023) | https://ieeexplore.ieee.org/document/10242303 · DOI: 10.1109/JSEN.2023.3306378 |
| DRR-LIO (IEEE Sensors J. 2023) | https://ieeexplore.ieee.org/document/10112628/ |
| LIO-DOR (ROBIO 2023) | https://www.semanticscholar.org/paper/LIO-DOR:-A-Robust-LiDAR-Inertial-Odometry-with-Mao-Gao/a005121e127254d5cfac05f1c11c87cb2fdb0d0b |
| ID-LIO (Sensors 2023, open access) | https://pmc.ncbi.nlm.nih.gov/articles/PMC10255994/ · DOI: 10.3390/s23115188 |
| Dynamic-LIO / dynamic_lio (IROS 2025) | https://arxiv.org/abs/2407.03590 · https://github.com/ZikangYuan/dynamic_lio |
| DOF-LIO (IEEE T-IM 2026) | DOI: 10.1109/TIM.2026.3666055 |
| STATIC-LIO (Information Fusion 2025) | https://www.sciencedirect.com/science/article/abs/pii/S1566253525002052 |
| R-POD Two-Stage (Displays 2025) | DOI: 10.1016/j.displa.2025.103030 · https://portal.fis.tum.de/en/publications/online-dynamic-object-removal-for-lidar-inertial-slam-via-region-/ |
| TRLO (arXiv / IEEE T-IM 2025) | https://arxiv.org/abs/2410.13240 · https://github.com/Yaepiii/TRLO |
| Breaking-Static-Assumption (arXiv 2025) | https://arxiv.org/abs/2510.22313 |
| Dual-Stage Hierarchical (Autonomous Robots 2026) | DOI: 10.1007/s10514-026-10248-5 |
| SuMa++ (IROS 2019 / arXiv 2021) | https://arxiv.org/abs/2105.11320 · https://github.com/PRBonn/semantic_suma |
| ERASOR (RA-L 2021) | https://arxiv.org/abs/2103.04316 · https://github.com/LimHyungTae/ERASOR |
| FreeDOM (arXiv 2025) | https://arxiv.org/html/2504.11073v1 |
| KTH DynamicMap Benchmark (ITSC 2023) | https://github.com/KTH-RPL/DynamicMap_Benchmark |
| dblp context (xplore ID 10807109) | https://dblp.org/rec/journals/iotj/XingWSZLLZ25 |
