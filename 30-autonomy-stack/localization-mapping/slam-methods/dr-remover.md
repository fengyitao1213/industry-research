# DR-REMOVER

<!-- method-priority:start
priority:
  learning: 4
  deployment: 5
  type: "method"
  stage: "deployment-pattern"
  maturity: "pilot-proven"
  tags: ["slam", "mapping", "validation", "runtime-localization", "outdoor"]
  reason: "DR-REMOVER is rated for dynamic-object filtering and map-cleaning workflows that protect localization maps."
method-priority:end -->

Related docs: [LiDAR Map Cleaning — Dynamic Removal](lidar-map-cleaning-dynamic-removal.md), [BeautyMap](beautymap.md), [Raymoval](raymoval.md), [ERASOR](erasor.md), [ERASOR++](erasor-plus-plus.md), [FreeDOM](freedom-dynamic-object-removal.md), [MapCleaner](mapcleaner.md), [DO-Removal LIO](do-removal-lio.md), [Moves and Label-Free Map Cleaning](moves-and-label-free-map-cleaning.md), [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md), [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [LiDAR Artifact Removal Techniques](../../perception/overview/lidar-artifact-removal-techniques.md).

**Last updated:** 2026-05-23

---

## What It Is

DR-REMOVER — Dual-Resolution Occupancy Grid Remover — is a training-free, offline dynamic-object remover for static 3D point-cloud map construction. Its full title is "DR-REMOVER: An Efficient Dynamic Object Remover Using Dual-Resolution Occupancy Grids for Constructing Static Point Cloud Maps."

**Key identifiers:**

| Field | Value |
|---|---|
| Authors | Zhang, Guangyi; Zhang, Tao; Wang, Rui; Hou, Lanhua |
| Venue | IEEE Transactions on Intelligent Vehicles (T-IV) |
| Year | 2024 |
| DOI / IEEE doc ID | 10540294 |
| IEEE Xplore | https://ieeexplore.ieee.org/document/10540294/ |
| Official repository | https://github.com/zhongbusishaonianyou/DR-REMOVER |

The name is unambiguous in the literature. It does not refer to a "Dynamic Residual Remover" or "Distance-Range Remover" — neither published method exists. It is not related to the Pomerleau-group Peopleremover, which predates this work by approximately six years and is based on voxel traversal rather than occupancy-grid counting.

DR-REMOVER is closely related to [ERASOR](erasor.md) and [Removert](removert.md) but occupies its own distinct axis in the family tree: a dual-resolution count-based 2D occupancy grid, applying coarse-flag / fine-revert logic in grid space rather than in a range-image or egocentric height-span framework.

---

## Core Technical Idea

Dynamic objects create transient occupancy in an accumulated map: they appear in some scans but not others, leaving inconsistent count patterns across their traversal footprint. DR-REMOVER exploits this with a two-level grid hierarchy:

1. **Coarse grid (low resolution):** quickly identify bins where the scan's occupancy count is inconsistent with the map's accumulated count — flagging them as dynamic candidates. The coarse cell size is large enough that even sparse far-field LiDAR returns contribute enough points per cell for a stable count estimate.

2. **Fine grid (high resolution):** within each flagged coarse cell, instantiate a nested high-resolution grid to verify which sub-cells are genuinely dynamic and which are static or ground. Sub-cells that appear consistently across scans are reverted back to static; sub-cells near the locally fitted ground surface are protected unconditionally.

This coarse-then-verify architecture directly targets two documented failure modes of prior methods:

**ERASOR's ground-point over-removal.** ERASOR's Scan Ratio Test (SRT) flags an entire sector-ring bin when the query scan's height span falls below the map's height span. In bins containing both a moving vehicle (large height contribution) and ground points, the test correctly identifies the bin as dynamic — but the subsequent Region-wise Ground Plane Fitting (R-GPF) sometimes fails to recover all ground points under the vehicle's footprint, creating holes in the map along vehicle trajectories. DR-REMOVER addresses this by running per-cell ground fitting at fine resolution inside the verification stage, protecting ground contacts before any removal is committed.

**Sparsity-instability at range.** At far range, LiDAR point density drops as 1/r². ERASOR's fixed-angular-width sector-ring bins contain very few points at distance, making the SRT ratio noise-dominated. Removert's range-image cells encounter a symmetric problem: at distance, a single pixel covers a large solid angle, merging returns from multiple objects. DR-REMOVER's coarse grid is deliberately sized so that even distant returns contribute multiple points per cell, stabilising the count-consistency test across the full working range.

The coarse-flag / fine-revert concept is borrowed from Removert's multi-resolution range-image pipeline, but applied entirely in 3D occupancy grid space rather than in projected range-image space.

---

## Inputs and Outputs

| Item | Role |
|---|---|
| Raw accumulated map | Full aggregated LiDAR point cloud from all traversal scans; contains ghost trails from dynamic objects. Built using the ERASOR map-building pipeline (the repository README explicitly instructs users to run ERASOR's map-builder before running DR-REMOVER). |
| Per-scan ego-poses `{T_t}` | 6-DOF pose for each scan frame, from a prior SLAM or LiDAR-odometry pass. Pose quality is a hard dependency; DR-REMOVER cannot correct misregistration. |
| Individual LiDAR scans `{S_t}` | Raw per-frame point clouds used to populate the occupancy grids frame-by-frame and provide scan-consistency evidence. |
| Grid and threshold parameters | `L_max`, `min_h`, `max_h`, `N_x`, `N_y`, `minimum_num_pts`, `Thres`, `Kappa`, `gf_dist_thr`, `gf_iter_times` — see Operator Mechanics. |
| **Output: cleaned static map** | Accumulated map with dynamic-object ghost trails removed and falsely-flagged static and ground points reverted; ready for localization, planning, or semantic annotation. |
| **Output: removed dynamic points** | Complement of the cleaned map; useful for QA, map lifecycle inspection, and false-removal audit. |

---

## Operator Mechanics

The following reconstruction is based on the public repository README and the method description accessible without full paper access. Items marked [inferred] are consistent with the described behaviour but not directly quoted from the IEEE T-IV paper body.

### Height Working Interval

All occupancy calculations are constrained to a global vertical working range:

```
min_h  <=  z_k  <=  max_h
```

Points outside this interval are neither counted nor removed. Defaults approximate −1 m to +3 m, matching road-vehicle environments. The README explicitly flags that this fixed global interval is "more suitable for wide road scenes" and that environments with significant vertical extent require manual adjustment. This is the primary tuning knob for non-road domains.

### Stage 1 — Coarse Grid: Dynamic Candidate Flagging

The full map volume is discretised into a 2D top-down grid at coarse (low) resolution. Each coarse cell covers a horizontal area of `L_max × L_max`. Let `G_c(i, j)` denote coarse cell (i, j).

For scan frame `t`, the coarse grid is populated:

```
n_scan(i, j, t) = count of scan points in cell (i, j) with z in [min_h, max_h]
n_map(i, j)     = total accumulated map points in cell (i, j) with z in [min_h, max_h]
```

Cells where `n_scan(i, j, t) < minimum_num_pts` are treated as unobserved — insufficient evidence to test.

**Dynamic candidate detection [inferred]:**

```
dynamic_candidate(i, j) = 1
    if  n_scan(i, j, t) >= minimum_num_pts
    AND ratio(i, j, t) < Thres
```

where `ratio(i, j, t)` encodes the inconsistency between the current scan's occupancy count and the map's accumulated occupancy in cell (i, j). The exact functional form — whether it mirrors ERASOR's pseudo-occupancy height ratio, uses a direct count ratio, or a normalised difference — is paywalled; the public README confirms the parameter names `Thres` and `minimum_num_pts` as the primary sensitivity controls for this stage.

The coarse resolution is intentionally chosen so that sparse far-field returns contribute multiple points per cell, preventing the single-return instability that plagues finer bins at distance.

### Stage 2 — Fine Grid: Verification and Static Reversion

For each flagged coarse dynamic-candidate cell, a nested high-resolution grid is instantiated over the same horizontal footprint. Each sub-cell covers a small fraction of the coarse cell area.

**Persistence-based verification [inferred]:**

```
persistence(i', j') = (number of scan frames in which sub-cell (i', j') has >= 1 point)
                    / (total scan frames observing the parent coarse cell)
```

Sub-cells with high persistence are consistently occupied across scans — evidence for static structure. Sub-cells with low persistence appear only occasionally — evidence for dynamic content.

**Static reversion [inferred]:**

```
revert_to_static(i', j')
    if  persistence(i', j') > tau_persist
    OR  distance_to_ground(i', j') < gf_dist_thr
```

Sub-cells satisfying either condition are reclassified as static and their associated map points are retained in the output. Sub-cells failing both conditions are confirmed as dynamic and removed.

**Ground plane fitting:**

Within each coarse cell, the ground surface is estimated using iterative plane fitting with `gf_iter_times` iterations and inlier threshold `gf_dist_thr`. Points within `gf_dist_thr` of the fitted plane are unconditionally reverted — they are not removed regardless of the fine-grid persistence result. This is the mechanism that directly addresses ERASOR's ground-overremoval failure mode.

**Neighbourhood smoothing:**

The parameter `Kappa` controls a spatial smoothing step at the high-resolution stage. Isolated fine sub-cells flagged as dynamic but surrounded by consistently-occupied static sub-cells are reverted to static, suppressing false positives from sensor noise and minor localisation error. This is functionally analogous to ERASOR++'s Surrounding Points Test (SPT).

### Key Parameters

| Parameter | Role | Note |
|---|---|---|
| `L_max` | Coarse cell size (horizontal) | Larger = faster but loses spatial detail; sparsity-limited at far range |
| `min_h` / `max_h` | Vertical working range | Typically −1 m to +3 m; must be tuned per site; primary concern for non-flat domains |
| `N_x`, `N_y` | Grid dimensions | |
| `minimum_num_pts` | Min points per coarse cell for a valid observation | Filters noise cells; should match expected point density at operating range |
| `Thres` | Coarse dynamic-candidate detection threshold | Main sensitivity knob; higher = more aggressive flagging |
| `Kappa` | Neighbourhood consistency smoothing factor | Suppresses isolated false-positive fine sub-cells |
| `gf_dist_thr` | Ground-plane inlier distance | Controls how tightly the ground fit protects near-ground points |
| `gf_iter_times` | Ground fitting iterations | More iterations = tighter plane estimate; diminishing returns beyond 3 |

---

## Pipeline Architecture

```
Input: raw accumulated map M, per-scan ego-poses {T_t}, individual scans {S_t}

1. [ERASOR map-builder] -> initial accumulated map M with ghost trails

2. Coarse grid population
   For each scan S_t: transform to map frame; count points per coarse cell (i, j)
   with z in [min_h, max_h] -> n_scan(i, j, t)

3. Dynamic candidate flagging
   Flag cell (i, j) if n_scan(i, j, t) >= minimum_num_pts AND ratio(i, j, t) < Thres

4. Fine grid verification (for each flagged coarse cell)
   Build nested high-resolution grid; compute persistence(i', j') per sub-cell
   Fit ground plane (gf_iter_times iterations, inlier threshold gf_dist_thr)
   Revert sub-cells: high persistence OR distance_to_ground < gf_dist_thr

5. Neighbourhood smoothing (Kappa)
   Revert isolated fine-grid false-positive sub-cells

6. Output: cleaned static map M'; rejected dynamic cloud (for QA)
   Trigger saveflag -> write to disk or publish as ROS topic
```

---

## Training-Free Nature

DR-REMOVER is entirely training-free. All decisions are based on occupancy counts and spatial ratios derived from point-cloud geometry and poses. No neural network weights, no training data, no GPU, no semantic class labels.

This places it in the same category as [ERASOR](erasor.md), [ERASOR++](erasor-plus-plus.md), [MapCleaner](mapcleaner.md), [FreeDOM](freedom-dynamic-object-removal.md), Removert, [BeautyMap](beautymap.md), and DUFOMap — geometry-only offline cleaners.

**Implications:**

- Works immediately on any new domain — airside, warehouse, port, mining — without retraining, labeled data, or sensor-specific fine-tuning.
- Every removal decision is traceable to the coarse-grid ratio and fine-grid persistence values of the containing cells. No black-box behaviour.
- Cannot exploit semantic class identity. A parked aircraft tug and a permanent wall anchor are indistinguishable if their occupancy patterns over the survey window are similar.
- Cannot reason about motion history across survey sessions. Evidence is limited to what is geometrically observable in a single accumulated map.

---

## Benchmark Results

**Critical honesty flag:** All numbers below are self-reported in the IEEE T-IV paper. DR-REMOVER is **not** included in the KTH DynamicMap Benchmark leaderboard, **not** compared in FreeDOM's (arXiv 2504.11073) Table I, **not** compared in Raymoval's (arXiv 2605.08937) comparison table, and **not** compared in the HIF evaluation (arXiv 2503.06863). No independent third-party validation of these figures exists in the accessible literature. The metric conventions (PR/RR/F1 on SemanticKITTI) are consistent with the ERASOR benchmark protocol but are not evaluated under the standardised KTH benchmark harness. Cite with appropriate qualification.

### SemanticKITTI (Self-Reported, Velodyne HDL-64E)

PR = Preservation Rate (fraction of true static points retained); RR = Rejection Rate (fraction of true dynamic points removed); F1 = harmonic mean.

| Seq | PR (%) | RR (%) | F1 |
|---|---|---|---|
| 00 | 98.09 | 98.42 | 0.983 |
| 01 | 99.35 | 94.78 | 0.970 |
| 02 | 95.33 | 97.39 | 0.963 |
| 05 | 99.16 | 99.01 | 0.991 |
| 07 | 95.49 | 98.70 | 0.971 |

All five sequences exceed 95% on both PR and RR. F1 range: 0.963–0.991. The paper claims that ERASOR fails to achieve PR > 95% and RR > 94% simultaneously on all five sequences with default parameters — particularly seq 02 (suburban) where ERASOR's R-GPF ground-recovery fails more frequently.

### Apollo (Self-Reported, ApolloScape Subset — Urban China, Dense Traffic)

| Seq | PR (%) | RR (%) | F1 |
|---|---|---|---|
| 00 | 99.11 | 97.81 | 0.985 |
| 01 | 98.69 | 99.01 | 0.989 |
| 02 | 99.11 | 99.18 | 0.991 |
| 03 | 99.04 | 98.27 | 0.987 |
| 04 | 98.47 | 99.76 | 0.991 |

F1 range: 0.985–0.991. The high PR in dense-traffic scenes is notable: many methods degrade on PR when dynamic-object ghost trails overlap and contaminate static points in adjacent cells. The paper claims excellent performance on a third dataset — a UGV dataset with highly crowded environments (up to 8+ pedestrians per frame, consistent with the SemanticPOSS campus dataset profile). Specific numeric scores from the UGV dataset are reported in the IEEE paper body but are not reproduced in the public repository README.

### Cross-Benchmark Context

ApolloScape is not a widely adopted dynamic-removal benchmark. DR-REMOVER is absent from the KTH DynamicMap Benchmark, FreeDOM (arXiv 2504.11073), Raymoval (arXiv 2605.08937), and HIF (arXiv 2503.06863) comparison tables. The metric space difference (PR/RR/F1 vs KTH SA/DA/AA) means the self-reported SemanticKITTI numbers are not directly comparable to KTH leaderboard entries.

---

## Variants and Lineage

### Taxonomy Position

DR-REMOVER occupies a distinct axis in the dynamic-removal family tree — dual-resolution count-occupancy grid — that does not map to any existing method axis:

| Axis | Representative Methods | DR-REMOVER |
|---|---|---|
| Visibility / ray-casting | Removert, Raymoval, Peopleremover | No |
| Pseudo-occupancy (height ratio) | ERASOR, ERASOR++, BeautyMap | No — uses count ratio, not height ratio |
| Free-space (conservative) | FreeDOM, DUFOMap | No |
| TSDF ever-free | Dynablox | No |
| Bayesian voxel occupancy | OctoMap | No |
| Terrain-first segregation | MapCleaner | No |
| Cumulative multi-scan voting | MapCleaner | Partial — per-cell across frames |
| **Dual-resolution count occupancy** | **DR-REMOVER** | **Yes — own axis** |
| Learned / instance | ERASOR2, MOS family, DeFlow | No |

The method is best understood as a hybrid: it adopts the top-down 2D grid structure and the "flag then revert" pipeline architecture from ERASOR, but replaces the height-span ratio (Δh_scan / Δh_map) with a count-consistency test and adds a second fine-resolution verification layer borrowed conceptually from Removert's multi-resolution revert step.

### Closest Ancestors

**ERASOR (RA-L 2021):** shared top-down bin-flagging structure and the removed-then-revert pipeline. DR-REMOVER literally uses ERASOR's map-building code as its first stage. The coarse grid corresponds to ERASOR's sector-ring bins; DR-REMOVER adds fine verification and replaces R-GPF's post-hoc ground recovery with per-cell ground fitting inside the fine-grid pass.

**Removert (IROS 2020):** shared coarse-flag / fine-revert concept. Removert applies this in range-image space; DR-REMOVER applies it in 3D occupancy grid space. The result is that DR-REMOVER does not require per-scan range-image projection or ray traversal, making it less sensitive to incidence angle and sensor occlusion geometry.

**[BeautyMap](beautymap.md) (RA-L 2024):** concurrent work occupying adjacent conceptual space. BeautyMap uses binary bitwise column encoding (height-layer occupancy bitmap) rather than dual-resolution count grids; both are offline, training-free, and target static-map dynamic-point removal. BeautyMap achieves ~0.046 s/frame runtime; DR-REMOVER's runtime is not published.

### Family Tree

```
OctoMap (2010, voxel Bayesian)
│
├── Dynablox (2023, TSDF ever-free)
│
Removert (2020, range-image visibility, multi-res revert)
│
ERASOR (2021, pseudo-occupancy top-down, R-GPF)
├── ERASOR++ (2024, height-coded bins, HST + GLT + SPT)
├── ERASOR2 (2023, instance-segmentation aided)
└── DR-REMOVER (2024, dual-resolution 2D count grid,
                fine verification + per-cell ground recovery)
│
BeautyMap (2024, binary-encoded vertical occupancy top-down) [parallel branch]
│
FreeDOM (2025, conservative free-space, sensor-agnostic)
DUFOMap (2024, void-region single-observation)
OTD (2024, observation-timestamp online)
[Raymoval](raymoval.md) (RiTA 2025 / arXiv 2026, azimuth-elevation raycasting + cluster validation)
```

---

## Strengths

**Simultaneous high PR and high RR.** All reported sequences exceed 95% on both metrics simultaneously — architecturally difficult: OctoMap achieves RR ~99.8% but PR ~30-76%; Removert achieves high RR but lower PR on crowded sequences. The dual-resolution design specifically targets this trade-off by deferring removal until the fine-grid verification step has recovered false-positive static content.

**Ground-point preservation by design.** Per-cell ground fitting runs inside the fine-resolution verification stage, before any removal is committed. This contrasts with ERASOR's R-GPF, a post-hoc approximation that sometimes fails to recover ground points under a vehicle footprint because the dynamic-object geometry dominates the PCA seed selection.

**Sparsity-aware coarse grid.** `L_max` and `minimum_num_pts` gate computation on whether sufficient points exist for a reliable estimate; cells with too few observations are skipped rather than producing noise-dominated statistics, preventing the far-range instability that affects fixed-resolution methods.

**Crowded-scene robustness (self-reported).** The claimed excellent performance on high-pedestrian-density environments (8+ pedestrians per frame) is attributed to the fine-grid verification: in dense crowds, adjacent dynamic-object footprints overlap in a single coarse bin, but the fine grid can still resolve individual sub-cell patterns.

**Training-free, immediately portable.** No GPU, no dataset-specific training. The parameter space is small and interpretable; any engineer familiar with ERASOR can apply DR-REMOVER without additional ML infrastructure.

**Offline full-trajectory access.** Operating post-hoc with all scans available allows future-scan evidence to resolve ambiguous bins — an advantage over online methods that commit removal decisions with only past observations.

---

## Failure Modes

### 1. Fixed Global Height Interval

The `[min_h, max_h]` height interval is a single global parameter. The README explicitly flags this as a limitation: DR-REMOVER is "more suitable for wide road scenes." Environments with significant vertical extent — aircraft stands with jet-bridge gantries (4–8 m), elevated walkways, multi-storey structures, or tunnels — require either per-region interval tuning or a hierarchical decomposition the current implementation does not provide. If `max_h` is set too conservatively (e.g., 3 m on an apron with tall GSE cranes), upper-structure ghost trails are invisible to the method. If set too broadly, the coarse-grid count statistics mix ground-level and elevated-object returns, destabilising the consistency test.

### 2. Static-but-Transient Objects

Like all geometry-only offline methods, DR-REMOVER cannot remove objects that were stationary throughout the entire survey window. A parked GSE vehicle observed in all scan frames has consistent occupancy across scans — its count ratio does not deviate, its fine-grid persistence is high, and it survives both the coarse flagging and the fine verification unchanged. This is not a flaw specific to DR-REMOVER; it is a fundamental limitation of intra-session scan-consistency evidence.

**See [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md)** for the dedicated treatment of this problem. Operational resolution requires a quarantine layer, versioned map layers, or instance-aware trackers such as ERASOR2 that check motion history.

### 3. No Third-Party Validation

All self-reported figures have not been independently reproduced under any shared evaluation harness. The KTH DynamicMap Benchmark, FreeDOM, Raymoval, HIF, and ERASOR++ comparison tables all omit DR-REMOVER. The relative claim of outperforming ERASOR on PR is plausible given the architectural improvements to ground recovery, but remains self-asserted against 2023–2025 generation methods.

### 4. Runtime Unknown

The repository and IEEE abstract do not report per-frame or per-sequence runtime. ERASOR runs approximately 0.073 s/frame on SemanticKITTI seq 01; BeautyMap approximately 0.046 s/frame. DR-REMOVER's dual-resolution processing adds a fine-grid pass for every flagged coarse cell, logically increasing per-scan computation relative to ERASOR. Whether it is faster or slower than BeautyMap is unknown — an information gap for throughput-constrained pipelines.

### 5. Parameter Sensitivity for Non-Road Domains

The default parameters (`L_max`, `Thres`, `min_h`, `max_h`, `minimum_num_pts`) are calibrated for SemanticKITTI and ApolloScape road-width scenes. Wide open apron environments with sparse LiDAR density over large flat surfaces, or indoor warehouse aisles with dense rack structure at close range, may require non-trivial re-tuning. There is no published ablation study or parameter-sensitivity analysis accessible from the public README.

### 6. ROS Noetic / Ubuntu 20.04 Dependency

The released implementation is tied to ROS Noetic. No ROS 2 port, Python standalone, or Docker container is published. Porting to a non-ROS pipeline or ROS 2 requires refactoring the ROS node interface.

### 7. Apollo Dataset Not a Community Standard

Unlike SemanticKITTI, ApolloScape dynamic-removal evaluation is not widely adopted by subsequent methods in this lineage. The Apollo numbers cannot be compared to any other published method's results under a shared evaluation protocol.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV — outdoor urban | Strong | Calibrated for this environment; SemanticKITTI and ApolloScape results are the primary evidence base. |
| Road AV — highway (single-pass) | Strong | Open road, large fast-moving vehicles create clear count inconsistency in coarse bins. |
| Airside — taxiing GSE and active vehicles | Strong candidate | Transient occupancy from actively moving GSE is the design target. Requires height-interval tuning; see Aggregated-Map Suitability. |
| Airside — parked aircraft / staged GSE | Not suitable | Static-but-transient; consistent occupancy survives both coarse flagging and fine verification. Quarantine layer required. |
| Airside — open apron (flat) | Conditional | Wide flat surfaces with sparse LiDAR density per cell may require `L_max` and `minimum_num_pts` tuning. Fixed height interval is primary concern. |
| Warehouse — indoor flat | Moderate | Flat ground and lower dynamic traffic; method is applicable but grid parameters need adjustment for shorter-range scanners and dense rack structure. |
| Warehouse — multi-level / ramps | Weak | Fixed global height interval fails in multi-level environments; same fundamental limitation as ERASOR. |
| Mining / construction | Conditional | Large movers produce strong coarse-grid count inconsistency; irregular terrain may degrade the per-cell ground fitting. |
| Port / logistics yard | Conditional | Flat container pads are compatible; complex crane / gantry geometry at elevated heights lies outside default working range. |
| Agriculture / outdoor vegetation | Weak | Vegetation height variability creates count inconsistency between scans due to wind and growth, not just dynamic objects. |

---

## Aggregated-Map Suitability and §9.1 Prerequisite Chain

DR-REMOVER is a viable candidate for the **offline dynamic-removal step** in the clean-then-segment pipeline documented in [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) §9.1:

```
Raw scans + poses
  -> [ERASOR map-builder or equivalent] -> Initial accumulated map
  -> [DR-REMOVER: coarse grid pass] -> Dynamic candidate bins
  -> [DR-REMOVER: fine grid pass + per-cell ground recovery] -> Cleaned static map
  -> [Semantic segmenter: SphereFormer / SPVCNN] -> Labeled map
  -> [Back-projection] -> Per-scan auto-labels
```

The repository explicitly uses ERASOR's map-building code as its upstream step, which is already a standard practice documented in the iter-5 brief §6 and consistent with the Cortinhal et al. (2022) pipeline. DR-REMOVER therefore drops into the existing ERASOR-prefixed pipeline without requiring a new map-accumulation strategy.

**Recommended parameter configuration for airside apron use:**

| Parameter | Airside Setting | Rationale |
|---|---|---|
| `min_h` | −0.5 m | Apron surface close to sensor height; avoid cutting legitimate low GSE detail near the tarmac surface. |
| `max_h` | +5 m | Captures GSE vehicles (typically 2–4 m tall), ground crew, vehicle cabins; excludes aircraft fuselage above standing height while covering the active dynamic zone. |
| `L_max` | 0.3–0.5 m coarse cell | Apron has high horizontal extent with lower point density than urban canyons; larger coarse cells accumulate more returns per cell. |
| `minimum_num_pts` | Lower than road default | Apron surface is flat and far from sensor trajectory; per-cell point density is lower. Reduce to match expected sparsity. |
| `Thres` | Conservative (higher than road default) | Prefer under-removal on first pass; follow with a second-pass higher-sensitivity run if ghost residuals persist. |
| `gf_dist_thr` | 0.1–0.2 m | Apron tarmac is nearly planar; tight tolerance avoids ground-point loss from the per-cell fit. |

**Height interval note.** For a LiDAR mounted on a vehicle traversing the apron at approximately 1.5 m sensor height, `max_h` of +5 m (≈ 3.5 m above sensor) captures most dynamic GSE without including elevated aircraft undercarriage structure above that range. Aircraft parked above 5–6 m height relative to the apron surface would be missed by the working interval, but those points are unlikely to constitute dynamic ghost residuals — aircraft move slowly relative to scan frequency and their geometry is stable during a traversal event. Fine-tuning is required before production adoption.

**What DR-REMOVER handles well in this pipeline position:**
- Taxiing GSE vehicles (transient occupancy in some scans, absent in others → coarse flag triggers, fine verification confirms, ground below preserved).
- Dense pedestrian / ground crew clusters in movement.
- Ground surface preservation under dynamic object footprints (per-cell ground fitting).

**What DR-REMOVER does not handle in this position:**
- Parked aircraft and staged ground equipment (consistent occupancy throughout survey → never flagged).
- Jet-bridge gantries and elevated walkways above `max_h`.
- 4D radar point clouds (the method is designed for LiDAR photon-return density; Doppler-augmented radar clouds have very different sparsity characteristics requiring different `minimum_num_pts` calibration).

**Comparison recommendation.** The lack of third-party benchmark validation means DR-REMOVER should not be adopted as the default cleaner for the §9.1 pipeline without a local benchmarking exercise. Run it alongside [FreeDOM](freedom-dynamic-object-removal.md) (best community-validated F1 as of early 2025; sensor-agnostic), [BeautyMap](https://arxiv.org/abs/2405.07283) (similar top-down approach; faster; better community coverage), and [ERASOR++](erasor-plus-plus.md) (strongest pseudo-occupancy baseline). DR-REMOVER is the best-documented representative of the dual-resolution coarse-fine count-occupancy-grid approach and is worth including as a distinct architectural variant in any benchmarking exercise.

---

## Implementation Notes

- **Start with ERASOR's map-builder.** The DR-REMOVER repository README explicitly instructs users to build the initial accumulated map using the ERASOR map-building code before running DR-REMOVER. Do not skip this; DR-REMOVER's occupancy statistics assume a properly accumulated map in the ERASOR format.
- **Height interval is the primary tuning concern for non-road domains.** Validate `[min_h, max_h]` visually on the target environment before running a full map pass. Plot the working-range slice from a sample scan to confirm it captures the dynamic objects of interest without including elevated static structure.
- **Tune `minimum_num_pts` for your sensor and range.** On an open apron at 60–80 m range, a 32-beam LiDAR produces fewer points per horizontal cell than a 64-beam scanner in an urban canyon. The default `minimum_num_pts` from the road-calibrated README may classify too many cells as unobserved, reducing coverage.
- **Run conservatively first.** Set `Thres` higher than default on the first pass to prefer under-removal. Inspect the rejected dynamic point cloud for false static erosion — ground holes, thin GSE structure, apron marking edges — before tightening the threshold.
- **No third-party validation.** All self-reported numbers are from the paper authors. Reproduce at least the SemanticKITTI sequences 00 and 02 from the public repository before adopting the tool in any production decision chain. Sequence 02 is the most diagnostic for ground-overremoval failures.
- **Store the full parameter configuration alongside each map version.** Grid parameters directly affect which points survive or are removed. Downstream localization and segmentation systems must know exactly which configuration produced the map they depend on.
- **Inspect both output layers.** The static output map is the primary product; the removed dynamic point cloud is the primary QA artifact. Visualise the dynamic cloud on every new site or parameter setting to catch systematic false positives before they propagate into auto-label pipelines.
- **Pose quality is a hard dependency.** DR-REMOVER cannot correct misregistration. Ghost trails from poorly-registered scans are geometrically indistinguishable from genuine dynamic objects. Run LiDAR SLAM with loop closure (KISS-ICP, LIO-SAM, or equivalent) and verify trajectory accuracy before running DR-REMOVER.
- **ROS Noetic dependency.** Port the ROS node interface before attempting integration into a non-ROS or ROS 2 stack. No containerised or ROS-2-native version is published as of May 2026.
- **Static-but-transient objects.** DR-REMOVER cannot solve this problem by design. If parked aircraft, docked GSE, or staged equipment must be absent from the long-term localization map, implement a quarantine layer or use ERASOR2 for instance-level motion-history checking. See [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md).

---

## Comparison Summary

| Criterion | DR-REMOVER | ERASOR | FreeDOM | ERASOR++ | MapCleaner |
|---|---|---|---|---|---|
| Mechanism axis | Dual-res count-occupancy grid | Pseudo-occ height ratio | Conservative free-space | Height-coded bin bitmap | Terrain + cumulative voting |
| Training-free | Yes | Yes | Yes | Yes | Yes |
| Online / Offline | Offline | Offline | Both | Offline | Offline |
| Ground recovery | Per-cell GF at fine grid | Post-hoc R-GPF | Conservative neighbourhood exclusion | GLT + SPT | Terrain pre-exclusion |
| Sparsity handling | Explicit (`minimum_num_pts`) | Implicit | Implicit | Implicit | Implicit |
| Crowded-scene PR | High (self-reported) | Moderate (drops on seq 02) | High | High | High |
| 3rd-party benchmark | Not found | Wide (KTH, FreeDOM, etc.) | Wide (KTH primary) | Moderate | Not included (KTH) |
| Runtime | Unknown | ~0.073 s/frame | >10 Hz capable | ~0.10–0.14 s | Unknown (terrain: 2–18 s/seq) |
| Fixed height interval concern | Yes — primary fragility | Yes | No (3D volumetric) | Yes | No (terrain-first) |

---

## Sources

| Item | URL / Path |
|---|---|
| IEEE Xplore (paywall) | https://ieeexplore.ieee.org/document/10540294/ |
| DOI | https://doi.org/10.1109/TIV.2024.3406334 |
| Official repository | https://github.com/zhongbusishaonianyou/DR-REMOVER |
| TRID record | https://trid.trb.org/View/2591781 |
| dblp record | https://dblp.org/rec/journals/tiv/ZhangZWH24 |
| SemanticKITTI tasks | https://semantic-kitti.org/tasks.html |
| ApolloScape dataset | https://arxiv.org/abs/1803.06184 |
| KTH DynamicMap Benchmark (DR-REMOVER not included) | https://github.com/KTH-RPL/DynamicMap_Benchmark |
| FreeDOM (arXiv 2025) | https://arxiv.org/html/2504.11073v1 |
| ERASOR (arXiv 2021) | https://arxiv.org/pdf/2103.04316 |
| ERASOR++ (arXiv 2024) | https://arxiv.org/html/2403.05019v1 |
| BeautyMap page | `beautymap.md` |
| BeautyMap (arXiv 2024) | https://arxiv.org/html/2405.07283v1 |
| MapCleaner (MDPI 2022) | https://www.mdpi.com/2072-4292/14/18/4496 |
| Raymoval (RiTA 2025 / arXiv 2026; omits DR-REMOVER from comparison) | https://arxiv.org/html/2605.08937v1 |
| HIF (arXiv 2025; omits DR-REMOVER from comparison) | https://arxiv.org/html/2503.06863v1 |
| Related method — ERASOR deep dive | `./erasor.md` |
| Related method — ERASOR++ deep dive | `./erasor-plus-plus.md` |
| Related method — FreeDOM deep dive | `./freedom-dynamic-object-removal.md` |
| Related method — MapCleaner deep dive | `./mapcleaner.md` |
| Related method — DO-Removal LIO | `./do-removal-lio.md` |
| Related method — Moves and Label-Free Map Cleaning | `./moves-and-label-free-map-cleaning.md` |
| Family overview | `./lidar-map-cleaning-dynamic-removal.md` |
| Benchmark protocol | `./dynamic-map-cleaning-benchmarks.md` |
| §9.1 prerequisite chain | `../../perception/overview/aggregated-map-semantic-segmentation.md` |
| Static-but-transient problem | `../../perception/overview/static-but-transient-point-removal.md` |
| LiDAR artifact removal context | `../../perception/overview/lidar-artifact-removal-techniques.md` |
