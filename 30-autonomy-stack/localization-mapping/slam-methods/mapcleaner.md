# MapCleaner

<!-- method-priority:start
priority:
  learning: 4
  deployment: 5
  type: "method"
  stage: "deployment-pattern"
  maturity: "pilot-proven"
  tags: ["slam", "mapping", "validation", "runtime-localization", "outdoor"]
  reason: "MapCleaner is rated for dynamic-object filtering and map-cleaning workflows that protect localization maps."
method-priority:end -->

Related docs: [LiDAR Map Cleaning — Dynamic Removal](lidar-map-cleaning-dynamic-removal.md), [BeautyMap](beautymap.md), [Raymoval](raymoval.md), [ERASOR](erasor.md), [ERASOR++](erasor-plus-plus.md), [FreeDOM](freedom-dynamic-object-removal.md), [DR-Remover](dr-remover.md), [DO-Removal LIO](do-removal-lio.md), [Moves and Label-Free Map Cleaning](moves-and-label-free-map-cleaning.md), [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md), [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [LiDAR Artifact Removal Techniques](../../perception/overview/lidar-artifact-removal-techniques.md).

**Last updated:** 2026-05-23

---

## What It Is

MapCleaner is a training-free, geometry-only offline method for removing dynamic-object ghost trails from accumulated LiDAR point-cloud maps. It was published by **Hao Fu, Hanzhang Xue, and Guanglei Xie** as "MapCleaner: Efficiently Removing Moving Objects from Point Cloud Maps in Autonomous Driving Scenarios" in *Remote Sensing*, vol. 14, no. 18, article 4496, September 2022 (MDPI open access).

**Key identifiers:**
- DOI: https://doi.org/10.3390/rs14184496
- MDPI page: https://www.mdpi.com/2072-4292/14/18/4496
- PDF: https://mdpi-res.com/d_attachment/remotesensing/remotesensing-14-04496/article_deploy/remotesensing-14-04496.pdf?version=1662710639
- ADS abstract: https://ui.adsabs.harvard.edu/abs/2022RemS...14.4496F/abstract

**Author affiliation:** College of Intelligence Science and Technology, National University of Defense Technology, Changsha 410073, China.

**No official code release** from the original authors has been publicly identified as of May 2026. A hypothesis that an official repository existed under `Lab-of-AI-and-Robotics/MapCleaner` was not confirmed; no such repository was found.

**Unofficial implementation:** https://github.com/kamibukuro5756/MapCleaner_Unofficial — a C++ ROS node implementing the two-stage pipeline (PatchWork++ ground segmentation + BGK terrain fitting + per-scan voting). Outputs six PCD files: `ground.pcd`, `static.pcd`, `dynamic.pcd`, `ground_below.pcd`, `other.pcd`, `terrain.pcd`. Supports KITTI Odometry and ERASOR dataset formats; includes a GLIM trajectory plugin. The unofficial port is the primary accessible implementation path; its fidelity to the original paper's exact parameter values and inner-loop formula cannot be independently verified.

---

## Core Technical Idea

MapCleaner's central argument is statistical and one-sentence: **a dynamic-object ghost trail occupies a position above the terrain surface that is not consistently present when all scan frames that observe that region are pooled and asked to vote**.

Rather than committing to a removal decision per scan pair — as [ERASOR](erasor.md) does with its per-frame Scan Ratio Test — MapCleaner aggregates evidence across all overlapping scans before making any decision. A point high above the terrain that appears occupied in only a minority of the scans observing its grid cell is almost certainly a dynamic residual. A point consistently present across all observing scans is almost certainly structural.

This is the **cumulative-evidence** (or **voting-based aggregation**) paradigm: evidence is weak per scan but reliable in aggregate. It is architecturally distinct from the other major paradigms in the family:

- **Visibility / ray-casting** (Removert, FreeDOM): a single scan's LiDAR ray passing through a map position suffices to flag that point as dynamic, subject to conservatism rules.
- **Two-scan pseudo-occupancy** (ERASOR, ERASOR++): current-scan height span vs. map height span in the same egocentric bin; removal decided per frame.
- **Bayesian voxel occupancy** (OctoMap): log-odds accumulation over many observations; symmetric update; no terrain segregation.
- **Cumulative per-point voting** (MapCleaner): all scans in the sequence vote before any decision is made; the vote ratio is the removal criterion.

The second architectural pillar is **terrain-first design**: the method explicitly estimates the terrain surface before any dynamic-removal logic runs, partitioning the map into below-terrain noise, the terrain layer, and the above-terrain object layer. The voting stage operates exclusively on the above-terrain layer. This eliminates the need for a post-hoc ground-recovery step (ERASOR's R-GPF) and prevents ground points from ever being candidates for removal.

The paper explicitly states that MapCleaner is a learning-free method with few parameters to tune, and that it was tested on a second LiDAR sensor type beyond the Velodyne HDL-64E used for SemanticKITTI — demonstrating sensor-agnostic applicability.

---

## Inputs and Outputs

| Item | Role |
|---|---|
| Registered LiDAR point-cloud map | Aggregated map containing static structure, terrain, ghost trails, and dynamic-object residuals; must be pose-registered before MapCleaner runs |
| Individual LiDAR scans `{S_t}` | Raw per-frame point clouds that provide the per-scan voting evidence; all scans in the sequence are required |
| Per-scan global poses `{T_t}` | Required to project the global object-layer map into each scan's local coordinate frame; pose quality is a hard dependency |
| Terrain and variance-filter parameters | σ_threshold (reliable cell selection), BGK kernel bandwidth, h_above_threshold (terrain/object layer boundary) |
| `τ_vote` (dynamic ratio threshold) | Primary sensitivity control; ratio above which a point is removed as dynamic |
| **Cleaned static map** | Map after dynamic ghost trails are removed; terrain and confirmed-static above-terrain points retained |
| `terrain.pcd` | Estimated terrain surface; useful as a ground-layer input to downstream segmentation |
| `dynamic.pcd` | Removed dynamic residual points; required for QA and false-removal inspection |
| `ground_below.pcd` / `other.pcd` | Sub-terrain noise and unclassified points; useful for map audit |

---

## Architecture and Pipeline

MapCleaner is **strictly offline** — the full sequence of scans with associated poses must be available before processing begins. It operates in two sequential stages.

### Stage 1 — Dense Terrain Estimation

**Purpose:** Segregate the aggregated map into sub-terrain noise, the terrain surface, and the above-terrain object layer. The voting stage in Stage 2 operates only on the object layer; terrain and sub-terrain points are excluded and preserved by default.

**Step 1a — Initial ground extraction (Patchwork / PatchWork++).**
The original paper uses Patchwork, a zone-based ground-plane fitting algorithm operating in polar coordinates, to extract a sparse initial set of reliable ground seed points from each scan. The unofficial implementation has updated this component to PatchWork++, the improved successor. This step provides the seed point set for terrain modelling.

**Step 1b — Reliable cell identification (variance filter).**
The aggregated ground-candidate points are projected onto a 2D top-down grid. For each grid cell, the standard deviation of z-values (elevation) among all points in that cell is computed:

```
for each grid cell c:
    sigma_z(c) = std_dev{ z_k : p_k falls in c }

if sigma_z(c) < sigma_threshold  ->  reliable ground cell  (included in BGK seed set)
else                             ->  unreliable cell        (excluded)
```

Reliable cells have a consistent, well-defined elevation. Unreliable cells (e.g., a cell containing both road surface and the hood of a parked car) are excluded from the terrain model seed set. The exact value of `sigma_threshold` is not confirmed from accessible sources — see Uncertainty Flags.

**Step 1c — Dense terrain surface inference (BGK).**
Bayesian Generalized Kernel (BGK) inference is applied to the reliable cell set to produce a dense, continuous terrain surface. BGK is a non-parametric Bayesian regression technique that infers elevation over a dense grid from sparse reliable observations, using a kernel function to propagate uncertainty and smooth across the grid. The output provides a height estimate and normal vector for every grid cell, covering the full map footprint including regions with sparse scan coverage. The BGK inference step is computationally the dominant cost in Stage 1; runtime scales with the number of grid cells (map footprint), not the number of scans.

**Step 1d — Region growing with slope filter.**
A terrain mask is grown from the BGK-inferred cells. Only cells satisfying a slope criterion (normal vector within threshold of vertical) are included. A second BGK inference pass is applied to this refined set to produce the final terrain model. The two-pass approach prevents buildings or near-vertical structures from corrupting the terrain surface estimate.

**Step 1e — Layer partitioning.**
Every point in the aggregated map is classified relative to the terrain model:

```
z_p < terrain_height(x_p, y_p) - h_below_threshold
    -> below-terrain noise (discarded; likely scan-through-ground artifacts)

terrain_height - h_below_threshold <= z_p <= terrain_height + h_above_threshold
    -> terrain layer (retained unconditionally as static ground)

z_p > terrain_height + h_above_threshold
    -> object layer (input to Stage 2 voting)
```

The above-terrain threshold `h_above_threshold` separates the terrain surface from objects standing on it. Default order of magnitude is approximately 0.2–0.5 m above the fitted terrain surface; the exact value is not confirmed from accessible sources.

**Terrain stage runtimes (paper-reported, five SemanticKITTI sequences):**

| Sequence | Frames (approx.) | Terrain stage time |
|----------|------------------|--------------------|
| 00 (4390–4530, small town) | ~140 | 7.3 s |
| 01 (150–250, highway) | ~100 | 17.6 s |
| 02 (860–950, suburban) | ~90 | 14.7 s |
| 05 (2350–2670, small town) | ~320 | 5.1 s |
| 07 (630–820, rural) | ~190 | 2.1 s |

These times reflect BGK inference across the terrain grid as a one-time upfront cost per map, not a per-scan iteration. The total pipeline time (terrain + voting) is not confirmed from accessible sources; see Uncertainty Flags.

---

### Stage 2 — Per-Scan Voting (Moving Points Identification)

**Input:** the above-terrain object-layer points from the aggregated map; all individual scan frames with associated global poses.

**Core loop:**

```
for each scan S_t in the sequence:

  1. Crop: extract all map points visible from pose T_t
     (within sensor FoV and range; exact range definition not confirmed)

  2. Project and compare: for each above-terrain map point p in the crop:
       - check whether scan S_t has a return at compatible height above terrain
         at the XY grid location of p

  3. Cast a vote for p from scan S_t:
       vote_t(p) = 1  [dynamic]  if scan S_t observes the XY region of p
                                  but finds no return at compatible height
                                  (free space above terrain at that location)
       vote_t(p) = 0  [static]   if scan S_t has a return at compatible height
                                  at the XY location of p
       vote_t(p) = empty         if p is not in scan S_t's FoV
                                  (out of range, occluded, outside scan coverage)
```

After all scans have voted, each above-terrain map point has accumulated `n_dynamic` and `n_static` votes across all scans that observed it.

**Decision function:**

```
dynamic_ratio(p) = n_dynamic(p) / ( n_dynamic(p) + n_static(p) )

if dynamic_ratio(p) > tau_vote  ->  remove  (dynamic residual)
else                            ->  retain  (static structure)
```

The threshold `τ_vote` controls the trade-off between over-removal (low τ: aggressive, removes things absent in most scans) and under-removal (high τ: conservative, only removes things absent in nearly all scans). `τ_vote` is the primary operational parameter.

[UNCERTAIN — the exact mathematical form of the "consistent observation" criterion — whether height-above-terrain must match within a tolerance ε, or whether any return in the XY grid cell counts as a static vote — is not independently validated against released author code. The mechanism described above is reconstructed from the paper text/figures and the unofficial implementation README. The vote accumulation logic is consistently characterised across accessible sources, but the precise inner-loop formula remains unverified.]

---

## Operator Mechanics vs ERASOR

The structural contrast with [ERASOR](erasor.md)'s Scan Ratio Test makes the voting paradigm concrete:

```
ERASOR — per-frame, egocentric, two-scan comparison:

  scan_ratio(i,j) = Delta_h_query(i,j) / Delta_h_map(i,j)
                 = (vertical extent of points in bin from current scan)
                 / (vertical extent of points in bin from accumulated map)

  if scan_ratio < tau_SR = 0.2  ->  bin flagged as dynamic candidate

  Decision is made once per frame per bin; removal is iterative across frames.
```

```
MapCleaner — all-scan, global-frame, cumulative vote:

  vote_t(p) = 1  [dynamic]  if scan t sees region of p as empty above terrain
  vote_t(p) = 0  [static]   if scan t sees a return at p's height above terrain
  vote_t(p) = empty         if p is not in scan t's FoV

  dynamic_ratio(p) = sum{ vote_t(p) == 1 } / sum{ vote_t(p) != empty }

  Decision is made once per point, over all scans simultaneously.
```

| Dimension | ERASOR | MapCleaner |
|-----------|--------|------------|
| Decision scope | Per-scan, per-bin | Per-point, all-scan aggregate |
| Evidence accumulation | Two scans (query vs. map) | All overlapping scans |
| Spatial frame | Egocentric cylindrical (recomputed per pose) | Global map coordinates (fixed grid) |
| Terrain handling | R-GPF post-hoc ground recovery | Explicit terrain model pre-stage exclusion |
| Ground recovery mechanism | PCA plane fit per flagged bin | No recovery needed; terrain excluded in Stage 1 |
| Removable unit | Sector-ring bin (then revert ground) | Individual above-terrain map point |
| Slow-pass ghost coverage | Viewpoint-biased: ghosts seen from few angles may survive | More robust: diverse viewpoints across all passes |
| False removal of slow movers | Possible if ghost car matches current scan height | Reduced but not eliminated: static votes accumulate if object present in most scans |
| Online capability | Not designed for it (batch) | Not designed for it (batch) |

---

## Training-Free Nature

MapCleaner has zero learned components. The terrain estimation uses closed-form BGK kernel regression; the voting uses hard thresholds. No neural network weights, no training data, no semantic class labels are required.

This delivers immediate domain transfer: the same method applies to airside, mining, warehouse, port, and construction environments without any retraining or parameter fine-tuning beyond the handful of geometric thresholds. The paper explicitly states that MapCleaner was tested on a proprietary dataset collected with a different LiDAR sensor type beyond the HDL-64E used for SemanticKITTI, demonstrating sensor-agnostic applicability.

The tradeoff is that MapCleaner cannot exploit semantic class identity. A parked ground-support vehicle and a permanent wall post are indistinguishable if their spatial observation patterns are similar. All decisions are purely geometric.

---

## Benchmark Results

### Primary Benchmark — SemanticKITTI (Self-Reported)

MapCleaner evaluates on the five canonical sequences from the ERASOR benchmark lineage. Evaluation metrics are Preservation Rate (PR), Rejection Rate (RR), and F1 (harmonic mean), using voxel downsampling at 0.2 m resolution on SemanticKITTI ground-truth class labels. The paper claims to outperform all baselines on all five tested sequences.

```
PR = |retained static points| / |all true static points|
RR = |removed dynamic points| / |all true dynamic points|
F1 = 2 * PR * RR / (PR + RR)
```

| Seq | Description | MapCleaner score | ERASOR F1 (orig. paper) | MapCleaner PR | MapCleaner RR |
|-----|-------------|---------------|------------------------|---------------|---------------|
| 00 | Small town (~140 frames) | **0.9853** | 0.955 | 98.89 | 98.18 |
| 01 | Highway (~100 frames) | **0.9730** | 0.934 | 99.74 | 94.98 |
| 02 | Suburban (~90 frames) | **0.9920** | 0.921 | 99.37 | 99.03 |
| 05 | Small town (~320 frames) | **0.9852** | 0.933 | 99.14 | 97.92 |
| 07 | Rural (~190 frames) | **0.9811** | 0.948 | 98.98 | 97.25 |

MDPI's HTML version exposes the paper's Table 2, including per-sequence PR, RR, and score values. The paper's claim of outperforming the listed baselines on all five tested sequences is therefore directly source-backed for the 2022 comparison set.

**Methods compared in the MapCleaner paper (2022):** ERASOR (RA-L 2021), Removert (IROS 2020), OctoMap (ICRA 2010 / AR 2013), Peopleremover. All are pre-2022 methods.

### KTH DynamicMap Benchmark — Not Included

MapCleaner is **not included** in the KTH DynamicMap Benchmark as of May 2026. The benchmark's eight-method lineup (OctoMap, OctoMap with ground filter, Dynablox, DUFOMap, DeFlow, ERASOR, Removert, BeautyMap) does not include MapCleaner. Source: https://github.com/KTH-RPL/DynamicMap_Benchmark.

This means no standardised SA/DA/AA (point-level, shared parameter) comparison between MapCleaner and the KTH cohort exists. All MapCleaner numbers are from the original paper's self-evaluation with method-favorable parameters — the reproducibility caveat documented in [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md) §7 applies.

### Post-2022 Papers — No Quantitative Comparison Against MapCleaner

None of the following post-2022 papers include MapCleaner in their quantitative comparison tables:

| Paper | Year | Methods benchmarked | MapCleaner included? |
|-------|------|--------------------|-----------------------|
| ERASOR++ (arXiv 2403.05019) | 2024 | ERASOR vs ERASOR++ only | No |
| FreeDOM (arXiv 2504.11073) | 2025 | OctoMap, DUFOMap, Removert, ERASOR, BeautyMap | No |
| [BeautyMap](beautymap.md) (arXiv 2405.07283) | 2024 | OctoMap, OctoMap+GF, ERASOR, Removert, Dynablox, DeFlow | No |
| DUFOMap (arXiv 2403.01449) | 2024 | OctoMap, ERASOR, Removert, Dynablox | No |
| HIF (arXiv 2503.06863) | 2025 | Cites MapCleaner [5] in introduction; excludes it from evaluation | No |
| [Raymoval](raymoval.md) (arXiv 2605.08937) | 2026 | ERASOR, Removert | No |

**Practical implication:** MapCleaner's SOTA claim as of 2022 has not been tested against the 2023–2025 generation of methods under any shared evaluation protocol. BeautyMap, DUFOMap, FreeDOM, and ERASOR++ all report higher F1 than ERASOR on the same SemanticKITTI sequences, strongly suggesting MapCleaner may have been superseded — but a like-for-like comparison does not exist in the public literature. **SOTA status versus the 2023–2025 generation is unresolved.**

### Runtime Context

**Terrain stage:** 2.1–17.6 s per sequence (whole-sequence, not per-frame). Seq 01 (highway, long linear trace) takes the longest at 17.6 s; seq 07 (rural, short) the shortest at 2.1 s.

**Total pipeline runtime (terrain + voting):** not confirmed from accessible sources. The terrain stage dominates because BGK inference scales with map footprint. The voting stage is O(N_scans × N_visible_points_per_scan) and is more linear with sequence length.

Comparison on the same hardware class (approximate):

| Method | Operation | Runtime |
|--------|-----------|---------|
| ERASOR | ~0.073 s/frame (batch per-frame iteration) | ~10 s for ~140 frames |
| MapCleaner terrain (seq 00, ~140 frames) | One-time BGK inference | 7.3 s |
| MapCleaner voting (seq 00) | Not confirmed | Not confirmed |

MapCleaner's terrain stage alone approaches ERASOR's total runtime on seq 00, suggesting the full pipeline is slower than ERASOR. The paper claims "efficient" operation; the absolute total is not confirmed.

---

## Variants and Lineage

The dynamic-removal family can be read as a progression of evidence axes — each method exploits a different observable to discriminate dynamic from static:

```
Removert (IROS 2020)
  Evidence axis: per-scan visibility (a ray passes through a map point -> dynamic)
  Limitation: single-scan ray ambiguity; incidence-angle noise; expensive ray traversal

ERASOR (RA-L 2021)
  Evidence axis: two-scan pseudo-occupancy ratio (height span: query / map per bin)
  Limitation: two-scan evidence pool; flat-terrain assumption; egocentric binning

MapCleaner (Remote Sensing 2022)
  Evidence axis: cumulative per-point vote aggregation over ALL scans
  Limitation: slow movers, batch-only, needs multi-pass coverage, no official code

ERASOR++ (ICRA 2024)
  Evidence axis: height-layer bitmask encoding (information-richer per scan pair)
  Limitation: still two-scan structure; does not aggregate across all scans

FreeDOM (RA-L 2025)
  Evidence axis: conservative free-space certainty (dual spatial + temporal conservatism)
  Limitation: conservative -> may under-remove slow movers; requires many rays per voxel
```

The orthogonal evidence axes in the broader field:

| Axis | Methods |
|------|---------|
| Free-space / ray-casting (visibility) | Removert, FreeDOM, DUFOMap |
| Height-span / pseudo-occupancy (vertical structure) | ERASOR, ERASOR++, BeautyMap |
| Cumulative multi-scan voting (consistency over time) | MapCleaner |
| Void-region detection (never-occupied voxel) | DUFOMap |
| Temporal observation timestamps (appearance / disappearance) | OTD |

MapCleaner occupies a unique position: it is the only method in the ERASOR lineage that aggregates evidence across **all** scans before committing to a decision. ERASOR and ERASOR++ decide per scan pair. Removert decides per ray per scan. FreeDOM accumulates free-space incrementally but can commit per scan once the consecutive-traversal threshold is met. MapCleaner delays every decision until the complete sequence is available, maximising the vote pool at the cost of requiring the full dataset upfront.

---

## Strengths

**Cumulative noise robustness.** A single scan with unusual LiDAR return patterns (rain, dust, sun interference, incidence-angle specular reflection, momentary sensor dropout) cannot trigger a false dynamic decision. The voting aggregation dilutes noise in one scan by the evidence from dozens of other scans. ERASOR's two-scan SRT can fail if the query scan is captured under unusual atmospheric conditions; MapCleaner's vote merely shifts the dynamic ratio by 1/N_scans.

**Terrain-first architecture.** The terrain model explicitly determines what is ground before any dynamic decision is made. Ground points are never candidates for removal — they are partitioned out in Stage 1. ERASOR must delete ground points as side effects and then attempt to recover them via R-GPF; that recovery introduces errors at slope transitions and near dynamic-object footprints. MapCleaner's architecture eliminates this failure mode for terrain points by design.

**Well-suited to multi-pass surveys.** The cumulative-evidence design is strongest when the environment is revisited many times: each additional traversal adds more votes to every above-terrain map point, increasing statistical confidence in the dynamic ratio. Multi-pass surveys (typical for airside mapping, campus surveys, and logistics-yard mapping) provide exactly this coverage pattern.

**Sensor agnosticism.** The voting logic operates on 3D point heights above a terrain model, not on range-image projections or egocentric sector-ring bins. It does not require a fixed spinning pattern or uniform azimuthal coverage. The paper reports evaluation on a second LiDAR type beyond the HDL-64E, demonstrating transferability.

**Parameter-light.** The primary operational parameter is `τ_vote`. Secondary parameters are the variance filter threshold and the BGK kernel bandwidth. There are no egocentric bin dimension parameters (N_r, N_θ) to tune as in ERASOR, and no DynamicLevel hierarchy or voxel-size parameters as in FreeDOM.

**Terrain surface as a free by-product.** Stage 1 produces a dense terrain surface model as its primary output, which is independently useful: it can feed directly into downstream segmentation pipelines as the ground layer, eliminating duplicate ground estimation work.

**Learning-free.** No domain shift from training data. Applicable without retraining to new geographic regions (airside, mining, warehouse) and new sensor types.

---

## Failure Modes

### 1. Slow-Mover Over-Removal Blind Spot

An object that moves very slowly relative to the survey velocity may be present in nearly every scan that observes its grid cell. Because it accumulates mostly static votes, its dynamic ratio remains below `τ_vote` and it survives removal. This is structurally the same failure as ERASOR's SRT near 1.0 for slow movers — but MapCleaner is arguably more susceptible for very-slow objects, because the cumulative logic specifically rewards high consistent observation frequency. Contrast with FreeDOM's conservative free-space approach, which can flag an object even if it was present for most scans, as long as some scans confirmed free space above its footprint.

### 2. Static-but-Transient Blind Spot

Like all geometry-only offline methods, MapCleaner retains objects that were stationary during the entire survey window. A parked aircraft tug, staged belt loader, or maintenance trolley that did not move during the survey accumulates consistently static votes and is geometrically indistinguishable from a fixed pole or wall. This is a fundamental limitation of intra-session evidence methods, not a flaw specific to MapCleaner.

**See: [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md)** for the dedicated treatment of this problem. Operational resolution requires a quarantine layer, versioned map layers, or instance-aware trackers such as ERASOR2.

### 3. Multi-Pass Coverage Dependency

MapCleaner's statistical robustness depends on having many overlapping scans from diverse viewpoints. In a single-pass survey where each terrain cell is observed by only a small number of scans, the dynamic ratio has high variance and the method approaches the same single-observation-per-cell regime as ERASOR. The method is most powerful when the environment is traversed multiple times or at multiple speeds with dense overlap.

### 4. Terrain Model Failures in Complex Geometry

The BGK terrain model assumes the ground is a smoothly varying surface. In environments with sharp discontinuities (curb edges, loading dock steps, ramps, stacked cargo) the BGK smoothing may incorrectly extend the terrain surface into above-ground space, misclassifying valid object points into the terrain layer. At sharp terrain breaks, the height estimate relative to the local terrain model may be incorrect for above-terrain points near the edge. Once a point is classified as terrain, it is retained unconditionally — MapCleaner provides no terrain-point recovery mechanism equivalent to ERASOR's R-GPF.

### 5. Voting Threshold Sensitivity

The `τ_vote` parameter controls the aggressiveness of removal. Too low and slow-moving objects with moderate dynamic vote ratios are incorrectly removed. Too high and genuine dynamic residuals with slightly-below-threshold ratios survive. There is no published ablation study on `τ_vote` accessible from public sources; the unofficial implementation's default value is not independently verifiable against the paper's original setting.

### 6. Offline-Only Operation

MapCleaner requires the complete set of scan frames and poses before any processing begins. It cannot produce a clean map incrementally or online. It is a batch post-hoc map-cleaning tool only; it is not applicable to real-time SLAM or incremental map-building workflows.

### 7. No Standardised Benchmark Reproducibility

Published numbers are self-reported with method-favorable parameters. The paper's SOTA claim cannot be reproduced against newer methods under standardised conditions. This is a reproducibility concern, not a method flaw, but it must be qualified when citing.

---

## Domain Fit

| Domain | Fit | Notes |
|--------|-----|-------|
| Airside apron — multi-pass survey | Strong conceptual fit | Multi-pass laps maximise vote accumulation; flat apron suits BGK terrain; no official code and unresolved stale benchmarking require validation before production adoption |
| Airside — single-pass survey | Moderate | Fewer votes per cell; statistical advantage over ERASOR diminishes; consider FreeDOM or ERASOR++ |
| Airside — parked aircraft / staged GSE | Not suitable | Static-but-transient; MapCleaner retains non-moving objects regardless of movability; quarantine layer required |
| Road AV — outdoor urban | Strong | Designed and benchmarked for road-vehicle scenarios on SemanticKITTI; flat terrain assumption holds |
| Road AV — highway (single-pass) | Conditional | Single-pass reduces vote diversity; seq 01 is the proxy; outperforms ERASOR on that sequence |
| Warehouse — indoor flat | Moderate | Flat ground suits the terrain model; single-pass warehouse surveys may limit vote accumulation |
| Warehouse — multi-level / ramps | Weak | BGK terrain smoothing fails at floor-level transitions; same failure mode as ERASOR R-GPF on stairs |
| Mining / construction | Conditional | Large movers produce strong dynamic vote signals; irregular terrain degrades BGK estimation |
| Port / logistics yard | Conditional | Flat container pads suit terrain model; complex crane geometry creates BGK failure zones |
| Agriculture | Weak | Vegetation z-variability produces unreliable terrain cells; the variance filter may exclude large fractions of the grid |

---

## Aggregated-Map Suitability and §9.1 Prerequisite Chain

MapCleaner is a candidate for the **offline dynamic-removal step** in the clean-then-segment aggregated-map pipeline documented in [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) §9.1:

```
Accumulate scans (SLAM / pose graph)
  -> [Stage 1] Terrain estimation (MapCleaner Stage 1, or stand-alone PatchWork++)
  -> [Stage 2] Dynamic removal (MapCleaner voting, OR ERASOR, OR FreeDOM back-end)
  -> Static aggregated point cloud
  -> Semantic segmentation (SphereFormer, SPVCNN, etc.)
  -> Per-point labels -> back-project -> auto-label scan frames
```

For airside multi-pass surveys, MapCleaner's two-stage architecture offers a clean path: the terrain model from Stage 1 doubles as a ground segmentation output (usable directly by the downstream segmenter), and the voting produces a static map ready for semantic classification. The terrain surface can be exported as the ground layer without duplicating ground estimation work.

**Conceptual advantages for airside multi-pass surveys:**
- High revisit rate → each above-terrain point accumulates many votes → statistical confidence in the dynamic ratio is higher.
- Diverse viewpoints from multiple laps → more scans can cast votes from different angles.
- The flat apron tarmac is well-constrained by many near-identical ground observations, making BGK inference trivially accurate.

**Practical limitations for airside production adoption:**
- No official code release: only the unofficial C++ ROS port is available. Its fidelity to the paper's exact parameter values and inner-loop formula is unverified. Reproducing the paper's benchmark numbers before any production use is strongly recommended.
- Stale benchmarking context: MapCleaner has not been compared against ERASOR++, FreeDOM, BeautyMap, DUFOMap, or any 2023–2025 method. Its ranking in the current SOTA is unresolved.
- The GSE quarantine problem is not addressed: GSE stationary during the survey survives cleaning regardless of movability.

For these reasons, [ERASOR++](erasor-plus-plus.md) or [FreeDOM](freedom-dynamic-object-removal.md) are lower-risk production choices when a validated code base is required. MapCleaner is the theoretically preferable candidate for the multi-pass cumulative-evidence case; production adoption depends on validating the unofficial implementation against the paper's claims.

---

## Cascade Combinations

MapCleaner's cumulative-voting evidence axis is orthogonal to the per-frame height-span axis (ERASOR) and the free-space ray-casting axis (FreeDOM). Cascades can exploit the complementarity.

### MapCleaner + ERASOR Cascade

**Approach:** run ERASOR per-frame online during map accumulation (removes actively moving objects at time of traversal), then run MapCleaner offline on the resulting partially-cleaned map.

- ERASOR removes objects absent from the current scan at time of traversal.
- MapCleaner's aggregation then catches residuals that ERASOR missed because the dynamic object was present in the current scan by coincidence (its SRT did not trigger); the ghost still shows a high dynamic vote ratio when all scans are considered.
- The cascade reduces the false-negative rate of ERASOR's viewpoint-dependent SRT.
- Risk: MapCleaner's terrain model applied to an ERASOR-cleaned map may behave differently than on the raw map; ERASOR's R-GPF ground recovery already removed some ground points that MapCleaner's terrain stage would have classified into the terrain layer.

### MapCleaner + FreeDOM Cascade

**Approach:** run FreeDOM's conservative free-space front-end per scan, then run MapCleaner's batch voting on the residual map.

- FreeDOM's dual-conservatism free-space estimation removes objects confirmed absent by neighbourhood-consensus raycasting — high-confidence, high-PR removals.
- MapCleaner's voting then processes FreeDOM output and catches objects that were present in the FreeDOM-observed region without free-space confirmation (objects visible in most scans but with no free-space evidence because all LiDAR rays hit them from the same angle, preventing free-space traversal).
- In practice, FreeDOM alone achieves F1 99.59% on seq 02; a cascade may offer marginal additional gain primarily in environments with very dense scan overlap but high occlusion.

### Comparative Failure Mode Coverage

| Failure mode | ERASOR | MapCleaner | FreeDOM |
|--------------|--------|------------|---------|
| Actively moving car, clear sightline | Yes (SRT triggers) | Yes (dynamic ratio high) | Yes (free-space confirmed) |
| Ghost from one-pass traversal | Partial (viewpoint-dependent) | Weaker (fewer votes, lower ratio) | Strong (free-space ray suffices) |
| Slow-moving object | Weak (SRT near 1.0) | Weak (static votes dominate) | Moderate (free-space on some frames) |
| Object seen from limited angles | Partial (egocentric SRT misses far angles) | Moderate (diverse angles from revisit) | Weak (no free-space from unobserved directions) |
| Ground beneath dynamic object | R-GPF recovery (imperfect at slopes) | Terrain exclusion pre-stage (better) | Conservative neighbourhood exclusion (good) |

---

## Implementation Notes

- **The unofficial C++ ROS implementation** at https://github.com/kamibukuro5756/MapCleaner_Unofficial is the only publicly available code path. Reproduce the paper's SemanticKITTI benchmark numbers before adapting it to a new sensor or domain. If benchmark reproduction fails, treat the implementation as a research prototype, not a production tool.
- **Patchwork / PatchWork++:** the terrain stage depends on this ground segmentation component. The unofficial implementation uses PatchWork++; verify that the ground seed extraction produces sensible results on target-domain scans before investing further. PatchWork++ is separately documented and available at https://github.com/url-kaist/patchwork-plusplus.
- **BGK kernel bandwidth:** this is the primary terrain smoothing parameter. Too wide and the terrain model smooths over local discontinuities (loading docks, curb edges), misclassifying object points into the terrain layer. Too narrow and the terrain model becomes noisy in sparse-coverage regions, producing unreliable height estimates. Start with the unofficial implementation's default and validate visually on `terrain.pcd` before tuning `τ_vote`.
- **Pose quality is a hard dependency.** MapCleaner cannot fix poor registration. Ghost trails from misregistered scans are indistinguishable from genuine dynamic objects in the voting stage. Run SLAM with loop closure (KISS-ICP, LIO-SAM, or similar) and verify trajectory ATE before running MapCleaner.
- **Inspect all six output PCD files.** `dynamic.pcd` is the primary QA artifact: verify that removed points are genuine ghost trails, not static infrastructure. `terrain.pcd` and `ground_below.pcd` validate the terrain stage. `other.pcd` captures unclassified points that may indicate parameter misconfiguration.
- **Tune `τ_vote` conservatively.** Start with a conservative (high) threshold to minimise false removal of static structure. Inspect `dynamic.pcd` for static erosion before accepting a map. Reduce threshold only after confirming the removed layer contains no legitimate static infrastructure.
- **Do not update production maps automatically from one MapCleaner run.** Use a map lifecycle approval step: inspect the removed cloud, run a localization residual check on the cleaned map, and gate promotion to production.
- **Static-but-transient objects.** MapCleaner cannot solve this problem by design. If parked aircraft, docked GSE, or staged equipment must be absent from the long-term localization map, implement a quarantine layer or use ERASOR2 for instance-level motion-history checking. See [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md).
- **Compare against ERASOR and FreeDOM on the same route** before adopting MapCleaner as the default cleaner. On single-pass surveys, the cumulative-evidence advantage disappears; ERASOR or FreeDOM may outperform MapCleaner on routes where revisit count is low.
- **Multi-session maps.** For maps built from multiple separate survey sessions, accumulate all sessions into one map before running MapCleaner. This maximises vote diversity and is where the cumulative-evidence design has its strongest advantage over per-scan methods.

---

## Uncertainty Flags

The following items remain unconfirmed from accessible sources and are marked [UNCERTAIN] where applicable. Future readers verifying or extending this page should resolve these items first.

1. **Official GitHub repository** — no official repository was found. The `Lab-of-AI-and-Robotics/MapCleaner` hypothesis was not confirmed. Only `kamibukuro5756/MapCleaner_Unofficial` is publicly accessible.
2. **Exact inner-loop voting formula** — the "consistent observation" criterion (how a static vote is defined vs. a dynamic vote vs. no-observation for a given scan/point pair) is inferred from paper figures/text and the unofficial implementation README, not independently reproduced from released author code.
3. **Total pipeline runtime** — only the terrain stage timings (2.1-17.6 s for seqs 00, 01, 02, 05, 07) are confirmed. The combined terrain + voting stage total is not confirmed.
4. **Exact threshold values** — the above-terrain height threshold `h_above_threshold`, the variance filter threshold `σ_threshold`, and the BGK kernel bandwidth are not confirmed from accessible sources. Values cited in this page are estimated from the unofficial implementation and are approximate.

---

## Sources

| Item | URL |
|------|-----|
| Primary paper (MDPI) | https://www.mdpi.com/2072-4292/14/18/4496 |
| DOI | https://doi.org/10.3390/rs14184496 |
| PDF (MDPI CDN) | https://mdpi-res.com/d_attachment/remotesensing/remotesensing-14-04496/article_deploy/remotesensing-14-04496.pdf?version=1662710639 |
| ADS abstract | https://ui.adsabs.harvard.edu/abs/2022RemS...14.4496F/abstract |
| Unofficial implementation (C++ ROS) | https://github.com/kamibukuro5756/MapCleaner_Unofficial |
| KTH DynamicMap Benchmark (MapCleaner not included) | https://github.com/KTH-RPL/DynamicMap_Benchmark |
| KTH leaderboard | https://kth-rpl.github.io/DynamicMap_Benchmark/ |
| SemanticKITTI tasks | https://semantic-kitti.org/tasks.html |
| ERASOR (RA-L 2021) | https://arxiv.org/abs/2103.04316 |
| ERASOR++ (arXiv 2024) | https://arxiv.org/html/2403.05019v1 |
| FreeDOM (arXiv 2025) | https://arxiv.org/html/2504.11073v1 |
| DUFOMap (RA-L 2024) | https://arxiv.org/html/2403.01449v1 |
| BeautyMap (RA-L 2024) | https://arxiv.org/html/2405.07283 |
| HIF (arXiv 2025, cites MapCleaner) | https://arxiv.org/html/2503.06863 |
| Raymoval (RiTA 2025 / arXiv 2026) | https://arxiv.org/html/2605.08937v1 |
| Removert (IROS 2020) | https://github.com/gisbi-kim/removert |
| PatchWork++ | https://github.com/url-kaist/patchwork-plusplus |
| Related method page — ERASOR | `./erasor.md` |
| Related method page — ERASOR++ | `./erasor-plus-plus.md` |
| Related method page — FreeDOM | `./freedom-dynamic-object-removal.md` |
| Related method page — DR-Remover | `./dr-remover.md` |
| Related method page — DO-Removal LIO | `./do-removal-lio.md` |
| Related method page — Moves and Label-Free Map Cleaning | `./moves-and-label-free-map-cleaning.md` |
| Family overview | `./lidar-map-cleaning-dynamic-removal.md` |
| Benchmark protocol | `./dynamic-map-cleaning-benchmarks.md` |
| §9.1 prerequisite chain | `../../perception/overview/aggregated-map-semantic-segmentation.md` |
| Static-but-transient problem | `../../perception/overview/static-but-transient-point-removal.md` |
| Pre-processing context | `../../perception/overview/lidar-artifact-removal-techniques.md` |
