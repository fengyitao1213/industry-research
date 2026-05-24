# SPLIN ISDOR PPLIO

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "modern-core"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "runtime-localization", "outdoor"]
  reason: "SPLIN ISDOR PPLIO is rated for LiDAR odometry, mapping, or scan-matching coverage in AV localization stacks."
method-priority:end -->

Related docs: [TRLO Dynamic Tracking Removal LiDAR Odometry](./trlo-dynamic-tracking-removal-lidar-odometry.md), [RPOD Two-Stage Online Dynamic Removal LIO](./rpod-two-stage-online-dynamic-removal-lio.md), [DOF-LIO Lightweight Dynamic Object Filter](./dof-lio-lightweight-dynamic-object-filter.md), [Dynamic-Aware LIO BTSA](./dynamic-aware-lio-btsa.md), [DO-Removal LIO](./do-removal-lio.md), [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md), [LIO-SAM](./lio-sam.md), [ERASOR](./erasor.md), [Removert](./removert.md), [MapCleaner](./mapcleaner.md), [GenZ-ICP / GenZ-LIO](./genz-icp-genz-lio.md), [Dynamic Map Cleaning Benchmarks](./dynamic-map-cleaning-benchmarks.md), [LiDAR Map Cleaning — Dynamic Removal](./lidar-map-cleaning-dynamic-removal.md), [Scan Context Family](./scan-context-family.md), [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md), [Lie Groups SE3/SO3 and Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md).

**Last updated:** 2026-05-24

---

## What It Is

**Full title:** SPLIN: A Structured Plane-Based LiDAR-Inertial SLAM With Dynamic Object Removal

**Short name:** SPLIN

**Authors:** Jun Zhu, Weiming Mi, Hongyi Li, Tao Xue
(additional co-authors may appear in the full paper; verify from IEEE Xplore full record)

**Affiliation:** Jun Zhu — PhD student, Department of Automation, Institute of Navigation and Control (INC), Tsinghua University, Beijing, China. Remaining co-author affiliations: Tsinghua is the plausible home institution but is not confirmed for all authors from open-access metadata — verify from the full paper.

**Venue:** IEEE Transactions on Instrumentation and Measurement (IEEE T-IM)

**Publication status:** 2025, early access. Final volume/issue assignment: verify from IEEE Xplore full record — see DOI flag below.

**IEEE Xplore document ID:** 11298356
(URL: https://ieeexplore.ieee.org/document/11298356/)

**DOI flag:** Two values appear in circulation:
- DOI cited in this knowledge base on first entry: 10.1109/TIM.2025.3643083
- IEEE Xplore document 11298356 is the canonical record.
- Early-access articles in IEEE T-IM sometimes appear under a temporary early-access number that changes when the issue is paginated. These two DOI values may refer to the same paper at different editorial stages, or one may be erroneous. Verify the final DOI, volume, issue, and page range from IEEE Xplore before citing in any formal document.

**arXiv preprint:** None found as of 2026-05-24. No arXiv ID appears in any search result or in the GitHub README. SPLIN is an IEEE T-IM journal-direct submission.

**GitHub:** https://github.com/zhujun3753/splin
(GPLv2 license; code release was pending final acceptance as of 2026-05-24 — confirm before cloning)

**ResearchGate record:** https://www.researchgate.net/publication/398603188_SPLIN_A_Structured_Plane-based_LiDAR-Inertial_SLAM_with_Dynamic_Object_Removal

**Author personal page (Jun Zhu, THU):** https://zhujun3753.github.io/

---

## Disambiguation — PPLIO as Both Standalone and Submodule

A separate paper titled "PPLIO: Plane-to-Plane LiDAR-Inertial Odometry with Multi-View Constraint in Real-Time" also exists (IEEE Xplore document 10960446, ResearchGate record 390652933). This is a standalone publication describing the core plane-feature iEKF odometry engine.

SPLIN integrates PPLIO as its frontend odometry module (augmented with ISDOR and a back-end factor graph), making PPLIO simultaneously a stand-alone published method and the LIO submodule of SPLIN.

The exact relationship — whether SPLIN builds directly on the standalone PPLIO codebase, refines it, or inherits it via co-authorship — should be clarified from the full papers. Do not conflate the two when citing: cite the standalone PPLIO paper (IEEE Xplore 10960446) for the odometry component only, and the SPLIN T-IM paper for the full dynamic-removal-plus-backend system.

---

## Core Technical Idea

SPLIN integrates three tightly coupled components into a single LiDAR-inertial SLAM system:

| Module | Role |
|---|---|
| ISDOR | Incremental Static-referenced Dynamic Object Removal. Frame-level dynamic-point suppressor. Runs before pose estimation. |
| PPLIO | Point-Plane LiDAR-Inertial Odometry. Tightly coupled iEKF using both point-to-plane and point-to-point residuals. |
| Back-end factor graph | Uncertainty-aware global optimization for long-horizon drift reduction via loop closure or keyframe-graph. |

The key architectural choice that distinguishes SPLIN from prior work is the combination of:

1. Online dynamic removal tightly coupled to the frontend estimator — not applied as post-processing. ISDOR suppresses dynamic-object points before they enter the iEKF update, so the pose estimate is never contaminated by moving-object correspondences.
2. Plane features as first-class measurements. Structured scenes (buildings, floors, roads, aprons, hangar walls) provide dominant planar geometry that point-only methods cannot fully exploit. PPLIO's plane residuals improve observability in these environments.
3. Covariance-aware back-end. The iEKF's output uncertainty propagates into the factor graph as information-matrix weights, so poorly constrained poses contribute less to global optimization.

SPLIN is especially targeted at environments with dominant planar geometry that are also traversed by moving objects — warehouse floors with active forklifts, urban aprons with GSE, campuses with pedestrians and vehicles.

---

## ISDOR Mechanics

### Role

Detect and suppress dynamic-object points at the frame level before they are passed to PPLIO. Operates incrementally on an evolving static reference, so removal quality improves as the map matures.

### Mechanism

Full algorithmic detail is behind the IEEE T-IM paywall. What is confirmed from open-access abstract descriptions:

- ISDOR compares incoming scan points against an "incremental static reference" — a continuously updated representation of the static scene built from previous clean frames.
- Points inconsistent with the static reference are flagged as dynamic candidates and suppressed from the measurement set before the iEKF update.
- The static reference is updated only with points not flagged as dynamic, limiting contamination to at most the first frame a new dynamic object appears.
- The "incremental" descriptor indicates the static reference grows over time rather than being rebuilt from scratch per frame.

Likely internal mechanism (inferred from naming and the broader online-removal literature — FLAG: not confirmed from full paper): incoming scan points are projected against the current static reference using a voxel-occupancy structure or range-image consistency check. Points occupying voxels that should be free, or exhibiting range discrepancy above a threshold, are flagged as candidates. A spatial clustering step (voxel-hash or connectivity-based) suppresses isolated false-positive flags. Flagged points are removed before the PPLIO update. Do not assert a specific mechanism without reading the full paper.

### Key Properties

- Rule-based, geometry-driven. No learned components confirmed.
- Frame-level (scan-by-scan), not map-level post-processing — dynamic objects are handled before they propagate into the accumulated map.
- Lightweight: the runtime reduction figure below indicates a substantial efficiency advantage over comparable baselines.
- Shares the static-but-transient blind spot common to all static-reference methods: a parked vehicle or stationary GSE incorporated into the reference during an early frame will not be flagged as dynamic unless it subsequently moves.

### ISDOR Benchmark (open-access, verified from abstract)

| Metric | Value | Source note |
|---|---|---|
| F1 improvement vs baselines (avg) | +13.47% | Open-access abstract |
| Best-F1 sequences | 15 / 17 | Open-access abstract |
| Precision gain (avg) | +26.67% | Open-access abstract |
| Runtime reduction vs baselines | 64.26% | Open-access abstract |
| Evaluation datasets | Not confirmed from open access | Verify from full paper |
| Baseline methods compared | Not confirmed from open access | Verify from full paper |

Full per-sequence F1, precision-recall curves, and comparison-method details are behind the IEEE paywall.

---

## PPLIO Mechanics

### Role

Tightly coupled LiDAR-inertial odometry that fuses plane features with point features in an iterated Extended Kalman Filter (iEKF), exploiting structural plane geometry alongside raw point correspondences.

### iEKF Formulation

State vector: robot pose (rotation on SO(3) + translation in R³) plus IMU biases — standard tightly coupled LIO state. See [Lie Groups SE3/SO3 and Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) for the SE(3) perturbation framework underlying this state representation.

Propagation: IMU pre-integration between LiDAR scans.

Update step: iEKF linearizes and iterates over the joint measurement Jacobian. Measurement residuals include:

- Point-to-plane distances: plane features extracted from the current scan are matched against map planes; the residual is the signed distance from a scan point to its matched plane.
- Point-to-point distances: conventional nearest-neighbor point correspondences (same as FAST-LIO2 backbone).

The combined point-plane residual is:

```
E = sum_{plane features} (n_i^T (T * p_i - q_i))^2  +  sum_{point features} || T * p_j - q_j ||^2
```

See [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md) for the foundational registration objective. Plane features provide stronger geometric constraints in structured scenes, improving observability compared to point-only methods such as FAST-LIO2.

### Plane Extraction

Described as an "efficient plane extraction module" integrated into the real-time pipeline. Likely implementation, consistent with the T-IM paper family and the standalone PPLIO paper (FLAG: specific algorithm not confirmed from open-access sources): PCA on local voxel neighborhoods to estimate surface normals; planes accepted where the eigenvalue ratio indicates a dominant flat structure. Region-growing or voxel-based aggregation groups co-planar points into coherent plane segments. RANSAC is possible but less common in real-time LIO due to computational cost. Do not assert a specific plane extraction algorithm without reading the full paper.

### Adaptive Downsampling

PPLIO applies adaptive downsampling to the filtered point-plane set, adjusting resolution to scene scale and structure density. This prevents over-dense measurement sets in feature-rich areas and preserves sparse structure in open scenes. The specific downsampling policy (distance-based, voxel-based, density-based) is not confirmed from open-access sources.

---

## Back-End Factor Graph

### Role

Correct long-term drift accumulated by the iEKF frontend over extended trajectories.

### Confirmed Properties

- "Uncertainty-aware" factor graph: factors weighted by covariance or information matrices derived from the iEKF's output uncertainty. Poorly constrained poses contribute less to the global optimization, reducing the impact of high-uncertainty keyframes on the final trajectory.
- Loop closure is implied by the back-end description and by the MulRan evaluation (a dataset commonly used with place-recognition-based loop closure).
- Specific loop closure descriptor not confirmed from open-access sources. Scan Context (see [Scan Context Family](./scan-context-family.md)) is a likely candidate given the MulRan benchmark and the T-IM publication family — FLAG: unconfirmed.
- Back-end graph structure (sliding window, full pose graph, or hierarchical) not confirmed.

### Interaction with ISDOR

Because ISDOR suppresses dynamic points before PPLIO, keyframe point clouds passed to the back-end are cleaner. Cleaner keyframes reduce false loop closure matches caused by movable objects that change their position between survey passes over the same location.

---

## Inputs and Outputs

| Item | Direction | Notes |
|---|---|---|
| LiDAR scan (spinning or solid-state) | Input | Deskewed with IMU before ISDOR |
| IMU stream | Input | Tightly coupled; provides state propagation |
| Incremental static reference map | Internal state | Maintained by ISDOR; grows over time |
| Dynamic-suppressed point cloud | ISDOR to PPLIO | Moving points removed before estimation |
| Extracted plane features | PPLIO internal | Structural measurement set for iEKF |
| Adaptive downsampled point-plane set | PPLIO internal | Efficient measurement set for filter update |
| iEKF pose + covariance | PPLIO to back-end | Per-scan state estimate with uncertainty |
| Loop closure / back-end constraint | Back-end to trajectory | Drift correction |
| Corrected odometry trajectory | Output | Globally consistent pose sequence |
| Static aggregated map | Output | Clean point cloud or plane map free of dynamic ghost trails |

---

## Architecture — Block Diagram

```
Raw LiDAR scan
      |
      v
[IMU Pre-integration / Deskew]
      |
      v
+-----------------------------+
|           ISDOR             |  <-- Incremental Static-referenced Dynamic
|  Incremental static         |      Object Removal
|  reference (voxel map /     |      Frame-level; rule-based geometry filter
|  occupancy — inferred)      |      Maintains evolving static scene reference
|                             |      Flags and suppresses dynamic points
+-----------------------------+
      |
      | Dynamic-suppressed point cloud
      v
+-----------------------------+
|           PPLIO             |  <-- Point-Plane LiDAR-Inertial Odometry
|  1. Plane extraction        |      PCA / voxel-based (specific method TBC)
|  2. Adaptive downsampling   |      Adjusts resolution by scene density
|  3. iEKF update             |      Point-to-plane + point-to-point residuals
|     (point-plane residuals) |      IMU propagation between scans
+-----------------------------+
      |
      | Pose estimate + covariance
      v
+-----------------------------+
|   Back-end Factor Graph     |  <-- Uncertainty-aware global optimization
|  Covariance-aware factors   |      Loop closure (descriptor TBC — likely
|  Loop closure / keyframe    |      Scan Context)
|  graph optimization         |      Corrects long-term drift
+-----------------------------+
      |
      v
Corrected Trajectory + Static Aggregated Map
```

---

## Training

SPLIN is a classical-algorithmic system. No learned components are confirmed from any open-access source.

| Component | Nature |
|---|---|
| ISDOR | Rule-based geometry filter; deterministic; no neural network |
| PPLIO iEKF | Conventional iterated Kalman filter; no neural components |
| Plane extraction | PCA or region-growing (inferred); parameter-driven |
| Back-end factor graph | Nonlinear least-squares (e.g., GTSAM or Ceres style); information-weighted; no neural components |

SPLIN does not require training data or GPU inference at runtime. No domain-specific annotation is needed to deploy it on a new environment.

FLAG: If any learned component (neural plane segmenter, learning-based place recognizer) is present in the full paper, this section must be updated. From open-access sources, no such component is described.

---

## Benchmarks

All quantitative results below are sourced from open-access portions of the abstract, abstract summaries, and the public GitHub README. Full comparison tables are behind the IEEE Xplore paywall.

### ISDOR Dynamic Removal (open-access, verified)

| Metric | Value | Note |
|---|---|---|
| F1 improvement vs baselines (avg) | +13.47% | Open-access abstract |
| Best-F1 sequences | 15 / 17 evaluation sequences | Open-access abstract |
| Precision gain (avg) | +26.67% | Open-access abstract |
| Runtime reduction vs baselines | 64.26% | Open-access abstract |
| Evaluation datasets | Not confirmed | Verify from full paper |
| Baseline methods compared | Not confirmed | Verify from full paper |

### SPLIN Localization (open-access, verified from abstract and GitHub README)

| Metric | Value | Note |
|---|---|---|
| Best-ATE sequences | 28 / 34 | Open-access abstract |
| Runtime range | 6.94 – 36 ms / frame | Open-access abstract |
| Primary evaluation datasets | MulRan, NCLT | Confirmed from GitHub README |
| MulRan DCC01 RMSE (SPLIN) | 4.768 m | GitHub README — FLAG: confirm from paper |
| MulRan DCC01 RMSE (FAST-LIO-SC) | 7.58 m | GitHub README — FLAG: confirm from paper |
| MulRan DCC01 RMSE (LIO-SAM-SC) | 8.62 m | GitHub README — FLAG: confirm from paper |
| MulRan DCC01 RMSE (LTA-OM) | 5.34 m | GitHub README — FLAG: confirm from paper |
| MulRan DCC01 runtime (SPLIN) | 29.77 ms | GitHub README — FLAG: confirm from paper |
| KITTI dynamic sequences | Not confirmed | Verify from full paper |

Full per-sequence ATE tables, per-sequence dynamic removal F1, and formal comparison-method details are all behind the IEEE paywall. GitHub README numbers are included as the best publicly available quantitative evidence but must be corroborated against the final paper before formal citation.

---

## Comparison Table

| Property | SPLIN | DOF-LIO | BTSA | TRLO | RPOD-LIO | FAST-LIO2 |
|---|---|---|---|---|---|---|
| Dynamic removal paradigm | ISDOR: incremental static-reference comparison, frame-level | Visibility check vs ikd-Tree + voxel suppression + static boundary recovery | Spatio-temporal normal analysis in iEKF; 4D SVD sliding window | PointPillars + UKF tracker; remove by bounding box | Region-wise pseudo occupancy + two-stage scan-to-map | None |
| Plane features | Yes — point-to-plane + point-to-point in iEKF | No — point-only ikd-Tree | No — point-only iEKF | No — Fast G-ICP on cleaned point cloud | Not confirmed | No — direct point-to-map ikd-Tree |
| Estimator | iEKF (tightly coupled LIO) | FAST-LIO2 iEKF (tightly coupled LIO) | iEKF (tightly coupled LIO) | Two-stage Fast G-ICP (LiDAR odometry only, no IMU required) | LIO-SAM-style factor graph frontend | iEKF, ikd-tree map |
| Back-end | Uncertainty-aware factor graph | None (frontend only) | Long-term voxel map + spatial consistency | Hash-based keyframe graph; no explicit back-end graph | Factor graph (LIO-SAM inherited) | None (frontend only) |
| Learned components | None (rule-based geometry) | None (visibility + clustering) | None (spatio-temporal geometry) | PointPillars detector (GPU required) | None confirmed | None |
| GPU dependency | None | None | None | Yes (3D object detection, TensorRT) | None | None |
| Static-but-transient blind spot | Parked vehicle not flagged until it moves | Same — no temporal window | Partial coverage if spatio-temporal signal present; parked objects missed | Covered if PointPillars detects the class; otherwise missed | Covered if occupancy inconsistency observed; slow movers partially missed | N/A — no removal |
| Venue | IEEE T-IM 2025 | IEEE T-IM 2026 | arXiv Oct 2025 (RA-L 2025) | IEEE T-IM 2025 | Displays 2025 | IEEE T-RO 2022 |
| Code | Pending (GPLv2, github.com/zhujun3753/splin) | Not confirmed | github.com/thisparticle/btsa | github.com/Yaepiii/TRLO | Not confirmed | github.com/hku-mars/FAST_LIO |
| Primary benchmarks | MulRan, NCLT | KITTI, UrbanLoco | ECMD, UrbanNav, custom DOD sequences | KITTI, UrbanLoco | MulRan, UrbanLoco | KITTI, NTU VIRAL, Hilti |
| Runtime | 6.94 – 36 ms / frame | Not confirmed (estimated low — geometry-only) | ~49.69 ms / scan | ~24.28 ms / scan (GPU-assisted detection) | Not confirmed | Not stated; well under 50 ms on test hardware |

Notes on baselines:

- DOF-LIO: IEEE RA-L vol. 11 no. 1, 2026, DOI 10.1109/LRA.2025.3632615. Visibility-based filter evolved from ERASOR-style approaches with voxel clustering for false-positive suppression. See [DOF-LIO](./dof-lio-lightweight-dynamic-object-filter.md).
- BTSA: "Breaking the Static Assumption" (Chen et al., HKU / Toronto / Sun Yat-sen, arXiv 2510.22313). Temporal sliding window (~2 s) builds 4D spatio-temporal normals; instability encoded in temporal normal component. Processes at ~49.69 ms/frame. FAST-LIO2 fails (>12 m error) on dynamic-dominated sequences; BTSA achieves 0.46–0.79 m. See [Dynamic-Aware LIO BTSA](./dynamic-aware-lio-btsa.md).
- TRLO: (Jia et al., CAS / NUDT, arXiv 2410.13240, T-IM 2025). PointPillars + UKF tracker; GPU required. 24.28 ms total. 39.3% accuracy improvement on KITTI07 vs point-cloud-only baseline. No IMU; pure LiDAR odometry. See [TRLO](./trlo-dynamic-tracking-removal-lidar-odometry.md).
- RPOD-LIO: (Yin, Sun, Zhang, Rigoll — TUM / Tongji, Displays 2025, DOI 10.1016/j.displa.2025.103030). Builds on LIO-SAM; region-wise pseudo-occupancy descriptor (R-POD) + scan ratio test; two-stage scan-to-map. See [RPOD Two-Stage Online Dynamic Removal LIO](./rpod-two-stage-online-dynamic-removal-lio.md).
- FAST-LIO2: No dynamic removal; degrades in highly dynamic scenes; point-only (no plane features); state-of-the-art baseline for low-dynamic performance. See [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md).

---

## Lineage

### Plane-Feature LIO Line

```
LOAM (Zhang & Singh, 2014)
  plane + edge features in scan-to-scan matching
      |
LeGO-LOAM (Shan & Englot, 2018)
  ground-plane-based segmentation; lightweight outdoor LIO
      |
LiLi-OM (Li et al., 2021)
  solid-state LiDAR; plane features in tightly coupled LIO
      |
PPLIO standalone (IEEE Xplore 10960446, 2025)
  plane-to-plane multi-view constraint in iEKF; real-time
      |
SPLIN / PPLIO (Zhu et al., IEEE T-IM 2025)
  PPLIO + ISDOR dynamic removal + uncertainty-aware back-end
```

### Dynamic-Removal-During-LIO Line

```
RF-LIO (Chen et al., arXiv 2206.09463, 2022)
  removal-first tightly coupled LIO; early online removal idea
      |
ERASOR (Lim et al., RA-L 2021)
  egocentric pseudo-occupancy ratio; offline map cleaner baseline
  (see [ERASOR](./erasor.md))
      |
Removert (Kim et al., IROS 2020)
  range-image reversion; offline cleaner
  (see [Removert](./removert.md))
      |
RPOD-LIO / Yin et al. (Displays 2025)
  region-wise pseudo occupancy, two-stage scan-to-map, online
      |
DOF-LIO (IEEE T-IM 2026)
  visibility-based online filter; tight LIO integration; lightweight
      |
ISDOR in SPLIN (IEEE T-IM 2025)
  incremental static reference, frame-level suppression
  couples removal to plane-based estimator and back-end graph
      |
BTSA (arXiv / RA-L 2025)
  spatio-temporal normals integrated directly into iEKF
  (most tightly integrated removal mechanism to date)
```

SPLIN sits at the intersection of these two lines. It is among the first systems to combine online frame-level dynamic removal with a plane-feature iEKF and a covariance-aware factor graph in a single tight system. GenZ-LIO (iter 38, see [GenZ-ICP / GenZ-LIO](./genz-icp-genz-lio.md)) addresses degeneracy on flat surfaces from a different angle — degeneracy-aware weighting rather than dynamic removal — and is a relevant comparison on flat airside and warehouse surfaces.

---

## Strengths

**Simultaneous dynamic removal and plane-feature odometry.** Coupling ISDOR with PPLIO means the estimator never sees dynamic-object points, and plane constraints improve observability. The two improvements are synergistic: cleaner input and stronger geometry both reduce drift.

**Strong performance across diverse scenes.** Best ATE on 28/34 sequences is a breadth result that covers a range of conditions beyond the specific dataset the method was tuned for.

**Runtime competitive with FAST-LIO2.** 6.94–36 ms/frame on CPU-compatible hardware with no GPU dependency. The 6.94 ms lower bound indicates performance on simple scenes; 36 ms is the upper bound on complex or large scenes. Both are within standard 20 Hz (50 ms) and 10 Hz (100 ms) LiDAR budgets.

**No learned components.** Deployable without GPU; no domain-shift risk from a trained detector encountering a new environment. Any moving object that produces a geometric inconsistency against the static reference is handled, regardless of class or shape.

**Uncertainty-aware back-end.** Covariance propagation from iEKF into the factor graph is methodologically sound. Reduces drift accumulation relative to unweighted graph approaches.

**Plane features benefit structured environments.** Buildings, floors, tunnels, aprons, and warehouse shelving all present dominant planar structure that PPLIO exploits for stronger observability than point-only methods.

**Open code under GPLv2** (pending final acceptance). The GitHub repository is public and tracked.

---

## Failure Modes

**Plane extraction unreliable in unstructured scenes.** Vegetation, dense ground support equipment, construction rubble, and irregular outdoor terrain do not yield stable planes. In these scenes PPLIO falls back to point-to-point residuals; the observability advantage over point-only methods is reduced or absent. Mining, construction, and heavily vegetated environments are the highest-risk domains.

**ISDOR pose sensitivity.** The static reference comparison requires a reasonably accurate pose to register incoming scans for comparison. Aggressive maneuvers or prolonged IMU-only propagation can misalign scans against the static reference, producing false dynamic classifications (removing real static structure) or missed detections (retaining dynamic points).

**Static-but-transient blind spot.** Objects that stop — parked vehicle, idle forklift, stopped GSE — are incorporated into the static reference as clean structure. When they later move, they leave ghost artifacts in the map until ISDOR flags their departure. This is a shared failure mode across all static-reference methods. See [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md) for the dedicated treatment of this class of problem.

**First-frame contamination.** On the first scan or first few scans before the static reference is populated, ISDOR has no reference to compare against. Objects moving in the initial frames may not be flagged and can be incorporated as static structure. Recommended mitigation: begin survey from a cleared static area.

**Loop closure false matches from movable structures.** In environments with large movable objects (aircraft, trucks) that change position between survey passes, loop closure descriptors computed on partially-changed scenes may produce incorrect back-end constraints, corrupting the factor graph.

**Full paper paywalled.** Exact algorithmic details — ISDOR comparison mechanism, plane extraction algorithm, back-end graph structure, full benchmark tables — cannot be verified without IEEE Xplore access. This is a reproducibility constraint.

**Code release pending.** As of 2026-05-24, the GitHub repository at zhujun3753/splin is public but code is not yet released (pending final paper acceptance). Implementation cannot begin from code alone; full paper is required.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Airside apron and taxiways | Strong | Planar geometry (concrete apron, terminal facades, hangar walls) is ideal for PPLIO. Moving GSE is the primary dynamic class ISDOR targets. See Aggregated-Map Suitability below. |
| Indoor warehouse | Strong | Floors, walls, shelving racks, loading docks are plane-extraction targets. Moving forklifts and pedestrians are the expected dynamic objects. |
| Outdoor campus / urban road | Moderate to Strong | Buildings provide planes; parked and moving vehicles are ISDOR targets. Open intersections or tree-lined streets reduce plane availability. |
| Port and logistics yard | Conditional | Large movers (straddle carriers, trucks) are detectable. Crane structures provide plane-like surfaces. Irregular terrain reduces plane extraction yield. |
| Mining and construction | Weak | Terrain is largely unstructured. Bench faces and rock walls may yield some planes but extraction is unreliable. ISDOR has fewer clean structural references. |
| Agriculture | Weak | Open fields provide no planar structure for PPLIO. Moving agricultural machinery is relatively large — ISDOR may still help — but the estimator's advantage over point-only baselines is reduced. |
| Long-route outdoor mapping | Conditional | Back-end factor graph handles long-horizon drift when loop closures are available. On routes without revisited areas, back-end provides limited benefit. |

---

## Aggregated-Map Suitability

### Overall Assessment

SPLIN is a strong candidate for online survey-time dynamic removal in structured environments. Its role in the aggregated-map pipeline is as a Stage 1 front-end that removes actively moving objects per scan, producing a cleaner input for both real-time navigation and post-survey offline QA.

**ISDOR removes dynamic object ghost trails before they enter the accumulated point cloud.** This is the critical function for map quality: offline cleaners ([ERASOR](./erasor.md), [Removert](./removert.md), [MapCleaner](./mapcleaner.md)) can be applied afterward, but front-end removal by ISDOR reduces the contamination load and may catch objects that offline methods miss due to pose error or single-pass temporal evidence limitations.

**PPLIO's plane features provide regularization against degenerate scan-matching.** In structured outdoor and indoor scenes, plane constraints reduce drift, improving geometric consistency of the aggregated map. This complements degeneracy-aware methods like [GenZ-LIO](./genz-icp-genz-lio.md) that address the same flat-surface problem through adaptive weighting rather than explicit plane constraints.

### Airside (Apron, Taxiways, Hangar Approaches)

Fit: STRONG for this environment family.

Airside geometry is dominated by planes: concrete apron, taxiway surfaces, hangar walls, terminal facades, control tower faces, and jet bridge structures. These are ideal inputs for PPLIO's plane extractor.

Dynamic objects on an active apron — pushback tractors, fuel trucks, baggage carts, catering vehicles, deicing trucks, aircraft towing — are large, slow-to-moderately-moving, and exactly the type ISDOR targets with geometric inconsistency detection.

Specific airside advantages:
- ISDOR removes GSE ghost trails during dynamic apron scanning.
- PPLIO's plane constraints provide stronger localization anchors than point-only methods on flat, feature-sparse apron surfaces.
- The plane regularization may compete with degeneracy-aware methods like [GenZ-LIO](./genz-icp-genz-lio.md) on flat featureless stretches, but SPLIN adds ISDOR's dynamic-removal dimension that GenZ-LIO does not provide.
- Aircraft hulls — large curved surfaces — do not yield plane features directly, but surrounding infrastructure does. If an aircraft is static during survey, it enters the static reference and is mapped normally; if moving, ISDOR should flag it (velocity-dependent).

Caution: apron expansion joints, painted markings, and runway grooving may not yield consistent plane normals. Grass infields and irregular arresting gear areas are unstructured. Slow-taxiing aircraft (2–5 km/h) and slow GSE near stands are in the slow-mover risk zone — ISDOR's ability to flag them depends on whether their per-frame displacement exceeds the static-reference comparison threshold.

### Warehouse and Indoor

Fit: STRONG.
Floors, walls, shelving racks, and loading docks are ideal plane-extraction targets. Moving forklifts, pallets, and workers are exactly the dynamic objects ISDOR is designed for. Tight narrow aisles may reduce the back-end loop closure opportunity.

### Outdoor Campus and Urban Road

Fit: MODERATE to STRONG.
Buildings provide planes; parked and moving vehicles are well-handled by ISDOR. Open intersections, tree-lined streets, or roundabout approaches reduce plane availability and force fallback to point-only residuals.

### Mining and Construction

Fit: WEAK.
Terrain is unstructured; bench faces and rock walls may yield some planes but extraction is unreliable. ISDOR has fewer clean structural references to compare against on irregular terrain.

### Map QA Pipeline Integration

SPLIN's cleaned trajectory and dynamic-suppressed point cloud can feed into offline QA (ERASOR, Removert, BTSA post-processing) as a pre-cleaned input, reducing the burden on later-stage cleaners and improving the starting quality before offline F1 optimization. The recommended multi-stage strategy follows the same pattern established in DOF-LIO and RPOD-LIO documentation:

```
Stage 1 — Online LIO front-end (per-frame, survey vehicle embedded compute)
  Candidate: SPLIN [plane-feature iEKF + ISDOR removal; no GPU; 6.94–36 ms]
  Alternative: DOF-LIO [lighter; no plane features; simpler visibility filter]
  Alternative: BTSA [best slow-mover sensitivity; ~50 ms; marginal at 20 Hz]
  Removes: actively moving objects (vehicles, GSE, aircraft in motion)
  Residual: slow movers below ISDOR threshold; static-but-transient (parked GSE)

Stage 2 — Offline cleaning (post-survey, cloud or workstation)
  ERASOR++ / FreeDOM / MapCleaner
  Catches residual ghosts from Stage 1 slow-mover failures
  Achieves PR/RR F1 0.93–0.99 with full temporal evidence

Stage 3 — Lifelong static-but-transient removal
  LT-Mapper / Khronos / instance quarantine
  Removes objects stationary throughout the survey window
  Mandatory for airside: parked GSE, boarding stairs, catering trucks,
  docked GPU sets dominate the apron contamination that no online
  or single-pass offline method can remove

Stage 4 — Semantic map quality
  Segmentation on the cleaned static map for per-class annotation layers
  Cross-links: aggregated-map-semantic-segmentation.md
```

---

## Implementation Notes

**GitHub:** https://github.com/zhujun3753/splin — GPLv2. As of 2026-05-24, code release is pending final paper acceptance. Monitor the repository for availability before starting integration work.

**Full paper access:** IEEE T-IM 2025 early access, document 11298356. The full algorithmic details (ISDOR internal mechanism, plane extraction specifics, back-end graph structure, full benchmark tables) require IEEE Xplore access. Obtain and read the full paper before committing to reproduction or production integration.

**Ablation recommendation:** when code becomes available, run three ablation configurations before committing to the full system:
1. ISDOR-off, PPLIO only (no dynamic removal, with plane features)
2. ISDOR-on, point-only iEKF (dynamic removal, no plane features)
3. Full SPLIN (ISDOR + PPLIO planes + back-end)

This isolates the contribution of each module and identifies whether dynamic removal, plane features, or the back-end graph is the dominant gain in the target environment.

**Threshold versioning:** ISDOR's static-reference comparison threshold and cluster size for false-positive filtering are environment-specific tuning parameters. Version these explicitly alongside the deployment environment configuration. Changes to scene density, dynamic object mix, or sensor model can all shift the optimal threshold.

**Plane extraction monitoring:** log the fraction of points classified as planar per scan. A drop below a stable baseline indicates the environment is becoming unstructured (e.g., survey vehicle entering a vegetation area or open lot). If planar fraction drops below approximately 20–30%, the plane-feature advantage over pure point-based baselines is likely negligible.

**Comparison baseline:** before adopting SPLIN, compare against FAST-LIO2 (no dynamic removal baseline) and BTSA (strongest geometry-only dynamic-aware alternative without GPU) on representative target sequences. This establishes the marginal value of SPLIN's plane features and ISDOR over the simpler alternatives.

**Dynamic removal labels:** retain ISDOR's suppressed-point labels in the output pipeline. Do not discard them before offline QA. These labels enable post-hoc inspection of removal decisions and warm-start for Stage 2 offline cleaning passes.

**DOI disambiguation:** the knowledge-base originally cites DOI 10.1109/TIM.2025.3643083; IEEE Xplore document number is 11298356. Verify the final DOI, volume, issue, and page range from IEEE Xplore before citing in any formal document.

**ROS compatibility:** exact ROS version not confirmed from open-access sources. Based on the 2025 publication date, likely ROS1 Noetic or ROS2 Humble. Confirm from the GitHub repository once code is released.

**Hardware profile:** no GPU required. Compatible with Jetson Orin (or equivalent embedded SoC) for the odometry and ISDOR stages. Back-end factor graph optimization may benefit from the Orin's CPU cores for pose graph solves.

---

## Sources

| Item | Reference |
|---|---|
| SPLIN IEEE Xplore (document 11298356) | https://ieeexplore.ieee.org/document/11298356/ |
| SPLIN DOI (early access) | https://doi.org/10.1109/TIM.2025.3643083 |
| SPLIN Semantic Scholar | https://www.semanticscholar.org/paper/SPLIN:-A-Structured-Plane-Based-LiDAR%E2%80%93Inertial-SLAM-Zhu-Mi/580cbd4fd8d4568b09c2f769aa3f79390f1a9895 |
| SPLIN GitHub repository | https://github.com/zhujun3753/splin |
| SPLIN ResearchGate abstract | https://www.researchgate.net/publication/398603188_SPLIN_A_Structured_Plane-based_LiDAR-Inertial_SLAM_with_Dynamic_Object_Removal |
| Author personal page (Jun Zhu, THU) | https://zhujun3753.github.io/ |
| Standalone PPLIO paper (IEEE Xplore 10960446) | https://ieeexplore.ieee.org/document/10960446/ |
| BTSA paper (arXiv 2510.22313) | https://arxiv.org/abs/2510.22313 |
| TRLO paper (arXiv 2410.13240) | https://arxiv.org/abs/2410.13240 |
| RPOD-LIO / Yin et al. (Semantic Scholar) | https://www.semanticscholar.org/paper/Online-dynamic-object-removal-for-LiDAR-inertial-Yin-Sun/5981c4627cbca93237b5e9972f8b72c10b86dd2a |
| DOF-LIO (ResearchGate) | https://www.researchgate.net/publication/401128605_DOF-LIO_LiDAR-Inertial_Odometry_with_Lightweight_Dynamic_Object_Filter |
| FAST-LIO2 (arXiv 2107.06829) | https://arxiv.org/abs/2107.06829 |
| KTH DynamicMap Benchmark | https://github.com/KTH-RPL/DynamicMap_Benchmark |
