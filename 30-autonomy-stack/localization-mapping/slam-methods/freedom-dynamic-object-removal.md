# FreeDOM Dynamic Object Removal

<!-- method-priority:start
priority:
  learning: 4
  deployment: 5
  type: "method"
  stage: "deployment-pattern"
  maturity: "pilot-proven"
  tags: ["slam", "mapping", "validation", "runtime-localization", "outdoor"]
  reason: "FreeDOM Dynamic Object Removal is rated for dynamic-object filtering and map-cleaning workflows that protect localization maps."
method-priority:end -->

Related docs: [LiDAR Map Cleaning — Dynamic Removal](lidar-map-cleaning-dynamic-removal.md), [ERASOR](erasor.md), [ERASOR++](erasor-plus-plus.md), [MapCleaner](mapcleaner.md), [DR-Remover](dr-remover.md), [DO-Removal LIO](do-removal-lio.md), [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md), [LiDAR Artifact Removal Techniques](../../perception/overview/lidar-artifact-removal-techniques.md), [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md).

**Last updated:** 2026-05-23

---

## What It Is

FreeDOM is an online dynamic-object-removal framework for static LiDAR map construction, published by Chen Li, Wanlei Li, Wenhao Liu, Yixiang Shu, and Yunjiang Lou from the School of Intelligence Science and Engineering / College of Artificial Intelligence at Harbin Institute of Technology Shenzhen (HITSZ), research group LC-Robotics.

**Full citation:**
Chen Li, Wanlei Li, Wenhao Liu, Yixiang Shu, Yunjiang Lou.
"FreeDOM: Online Dynamic Object Removal Framework for Static Map Construction Based on Conservative Free Space Estimation."
*IEEE Robotics and Automation Letters*, vol. 10, no. 6, pp. 5577–5584, June 2025.
DOI: 10.1109/LRA.2025.3560881 | arXiv: 2504.11073 (submitted 15 April 2025)
Code: https://github.com/LC-Robotics/FreeDOM (MIT license, C++/ROS/catkin)

FreeDOM frames dynamic removal as a real-time static map construction problem: rather than running an offline batch cleaner over an already-built map, it constructs a clean static map concurrently as scans arrive and refines that map in a back-end pass as new free-space evidence accumulates. The method is fully training-free, class-agnostic, and does not assume a flat ground plane, making it suitable across a wide range of sensor types and environmental geometries.

The defining contribution over prior raycasting approaches (Removert, DUFOMap) is **dual conservatism**: both a spatial neighborhood requirement (all 26 neighboring voxels must also be ray-traversed) and a temporal persistence requirement (traversal must hold for at least τ_f consecutive scans) must be satisfied before a voxel is declared free. This two-axis conservatism suppresses false positives from incidence-angle ambiguity and sensor noise while retaining the high removal recall that raycasting methods enable. A **retroactive map-refinement back-end** then revisits already-stored map points using the ever-growing free-space history, catching residual ghost points that the scan-by-scan front-end missed during an object's initial dwell.

As of early 2026, FreeDOM reports the highest published F1 on the SemanticKITTI and HeLiMOS benchmarks among the five methods tested in its paper — 99.59% F1 on KITTI seq 02 and 99.08% on an indoor corridor. Compared with [ERASOR](erasor.md) (the dominant baseline from 2021), FreeDOM is both more accurate and genuinely online; compared with [ERASOR++](erasor-plus-plus.md) and OTD (ICRA 2024), a direct head-to-head has not been published — see the Benchmark Results section for the precise scope of the comparison.

---

## Core Technical Idea

FreeDOM's governing insight is one sentence: **a LiDAR ray that passes through a spatial location without hitting anything is evidence that the location is free**. If a map point occupies that location and multiple subsequent scans continue to ray-traverse the same region without hitting anything, that point is a dynamic residual from an object that has already departed.

This is a raycasting approach in the lineage of Removert (IROS 2020) and DUFOMap (RA-L 2024), but with two innovations that distinguish it:

**1. Dual conservatism.** Earlier raycasting methods can falsely declare a location free because a single scan's ray grazes a surface edge at a steep incidence angle, or because a momentary sensor dropout leaves a direction unobserved. FreeDOM requires:
- **Spatial conservatism:** all 26 voxel neighbors in the Moore neighborhood (N_m(v), the full 3D 3×3×3 cube minus the center) must also have been traversed. An isolated traversal of a single voxel — the signature of a grazing near-miss — does not qualify.
- **Temporal conservatism:** the traversal condition must hold across at least τ_f **consecutive** scans (τ_f = 3 for sparse/fast configurations; τ_f = 6 for dense sensors or slower traversals).

**2. Retroactive map-refinement back-end.** The front-end handles objects actively moving during the current scan sequence. But objects that were already in motion when the vehicle first arrived — or objects that linger in one spot long enough to be partially mapped before moving — leave residual ghost points that the scan-by-scan test cannot catch retroactively. The back-end addresses this: whenever a new block of free space is confirmed, it queries the static map for points that overlap that block, recovers the original scan timestamps for those insertions, and re-evaluates those historical scan voxels under the now-confirmed free-space evidence, applying the full DynamicLevel hierarchy retroactively.

**3. Four-level DynamicLevel hierarchy.** Removal is not binary. Scan voxels are assigned one of four levels — conservative (direct free-space overlap), moderate (27-neighborhood of conservative), aggressive (125-neighborhood of moderate), static (none of the above) — and only static-labeled SubVoxels are integrated into the final map. This graduated pruning captures boundary points of dynamic objects that straddle the free-space edge rather than leaving a halo of residual points around the confirmed removal zone.

**4. Fully training-free.** FreeDOM contains no learned parameters and no pre-trained model. The authors state explicitly: "FreeDOM does not rely on any environmental assumptions or pre-trained models, making it robust to various dynamic object classes and environments." All decisions are geometric, with six interpretable scalar parameters (voxel sizes, thresholds, range limit).

---

## Operator Mechanics

### Multi-Resolution Map Structure

FreeDOM maintains two co-registered voxel layers at a 4:1 resolution ratio (outdoor configuration):

| Layer | Voxel size (outdoor) | Voxel size (indoor) | Purpose |
|---|---|---|---|
| FreeSpace (coarse) | s_v = 0.4 m | 0.2 m | Stores per-voxel free-status and traversal counters {f, n_f, n_o} |
| StaticSpace (fine) | s_s = 0.1 m | 0.05 m | Stores final cleaned static map at high detail |
| Blocks (index) | s_b = 3.2 m | — | Spatial hash indexing for O(1) lookup |

The hierarchy is defined by the power-of-2 relation `s_j = 2^(d_j − d_i) × s_i`, and index mapping uses bitwise right-shift (`I_j = I_i >> (d_j − d_i)`), enabling O(1) lookup from any StaticSpace SubVoxel to its parent FreeSpace voxel. The coarser 0.4 m FreeSpace grid is intentional: structures thinner than 0.4 m (fence wires, thin poles) are unlikely to fill a full voxel, reducing the risk that a legitimate static thin structure triggers the free-space test.

### FreeVoxel State Fields

Each voxel in the FreeSpace layer stores three fields:

```
FreeVoxel v = { f,  n_f,  n_o }

  f    ∈ {0,1}  :  current confirmed free status
  n_f  ≥ 0      :  count of consecutive scans in which v was traversed
                   (ray passed through without hitting)
  n_o  ≥ 0      :  count of consecutive scans in which v was occupied
                   (point return landed in v)
```

### Free-Space Confirmation Test

A voxel v becomes free at time t if and only if every member of its 27-connected Moore neighborhood has individually exceeded the temporal threshold:

```
f(v, t) = 1   iff   for all v' in N_m(v):  n_f(v', t) >= tau_f
f(v, t) = 0   otherwise
```

This is the dual-conservatism rule. A single scan that traverses v but not all 26 neighbors (e.g., a near-grazing ray) does not satisfy the condition. Only sustained, spatially consistent traversal confirms free space.

**Parameter values:**

| Parameter | Value | Context |
|---|---|---|
| τ_f (free confirmation threshold) | 3 | Sparse sensors (VLP-16), high-speed platforms, fast traversals |
| τ_f (free confirmation threshold) | 6 | Dense sensors (Ouster OS2-128, Livox), slow platforms |
| τ_r (re-occupation recovery threshold) | 20 | If a confirmed-free voxel accumulates n_o >= 20 consecutive occupied observations, free status resets — handles re-occupation by a genuinely static object that was previously occluded |
| r_max (max raycast enhancement range) | 50 m | Cap on synthetic free-space boundary extension |

### Raycast Enhancement for No-Return Directions

Some LiDAR directions produce no depth return: low-reflectivity surfaces (black asphalt, wet tarmac, dark rubber), maximum-range regions, and scan gaps. A naive raycaster leaves these directions untraversed, creating holes in free-space coverage and suppressing recall.

FreeDOM projects each scan onto a spherical depth image I. Pixels with no return (empty measurement set P_ij^S = ∅) are identified. For each such pixel, the method performs a weighted average of neighboring valid depth values to estimate a synthetic free-space boundary, applies a safety margin r_m (a small backward buffer), and clamps to r_max = 50 m. The synthetic boundary points are then used in the raycast step alongside real returns.

The practical effect: raycast enhancement adds 1–3% recall improvement on sequences with large low-reflectivity regions, specifically benefiting wide-open apron environments and long featureless corridors where substantial scan directions return nothing.

### DynamicLevel Hierarchy

After the free-space confirmation step, every scan voxel and its associated SubVoxels receive a DynamicLevel label:

| Level | Condition | Action |
|---|---|---|
| conservative (c) | Scan voxel falls directly inside a FreeVoxel with f = 1 | Immediately excluded from map |
| moderate (m) | Voxel is in the 27-neighborhood of a conservative voxel | Excluded; catches boundary points straddling the free-space edge |
| aggressive (a) | Voxel is in the 125-neighborhood (radius-2 Moore cube) of a moderate voxel | Excluded; catches outlier static points at the outer edge of dynamic clusters |
| static (s) | None of the above conditions hold | Retained and integrated into StaticSpace |

Ordering: {static ≺ aggressive ≺ moderate ≺ conservative}. When map integration resolves conflicts between scans contributing to the same SubVoxel, the classification with the **lower** DynamicLevel wins — meaning a point already classified as moderate is preserved unless a later scan provides positive conservative evidence. This "prefer static" tie-breaking is the primary over-removal guard: a point is removed only when positive free-space evidence is available, not merely because no confirmation has arrived.

---

## Inputs and Outputs

| Item | Role |
|---|---|
| Streaming LiDAR scans P_t | Per-scan point clouds; any rotating or solid-state LiDAR supported |
| Estimated poses T_t | From odometry or SLAM; required to register FreeSpace and StaticSpace in world frame; quality is a hard dependency |
| LiDAR FoV and scan pattern | Used for depth-image projection and raycast enhancement |
| s_v (FreeSpace voxel size) | Controls conservatism of free-space grid; 0.4 m outdoor, 0.2 m indoor |
| s_s (StaticSpace subvoxel size) | Controls final map resolution; 0.1 m outdoor, 0.05 m indoor |
| τ_f (free confirmation threshold) | Temporal conservatism; 3 for sparse/fast, 6 for dense/slow |
| τ_r (re-occupation recovery) | Resets free status after prolonged re-occupation; default 20 |
| Online static point-cloud map | Output: cleaned static map, continuously updated; dynamic residuals removed |
| Per-point DynamicLevel labels | Output: static / aggressive / moderate / conservative label per SubVoxel for QA and downstream use |

---

## Architecture and Pipeline

FreeDOM operates in two concurrent stages: a per-scan front-end and a triggered back-end.

```
Input:
  - Per-scan LiDAR point clouds P_t
  - Pose estimates (odometry or SLAM) T_t

Stage A — Scan-Removal Front-End (per scan, real-time):
  1. Project P_t onto spherical depth image I.
  2. Raycast enhancement: identify empty depth-image pixels;
     apply weighted neighbor averaging to estimate synthetic boundary;
     clamp to r_max = 50 m with safety margin r_m.
     Result: augmented scan P_enhanced.
  3. Raycast from sensor origin through I + P_enhanced;
     mark traversed voxels V_f^t (traversed) and V_o^t (occupied).
  4. Update n_f and n_o counters for all voxels in V_f^t and V_o^t.
     Reset counters when traversal state changes (non-consecutive break).
  5. Apply free-space confirmation test:
     for all v in V_f^t:
       if all v' in N_m(v) have n_f(v') >= tau_f: set f(v) = 1
     Apply re-occupation reset:
       if n_o(v) >= tau_r: set f(v) = 0, reset n_f.
  6. Assign DynamicLevel to each scan voxel:
     conservative → voxel in FreeVoxel with f=1
     moderate     → 27-neighborhood of conservative set
     aggressive   → 125-neighborhood of moderate set
     static       → remainder
  7. Insert static-classified SubVoxels into StaticSpace map
     with timestamp t and DynamicLevel = static.

Stage B — Map-Refinement Back-End (triggered by new free-space increments):
  1. Extract incremental FreeSpace delta_F_t:
     voxels newly set to f=1 at this timestep.
  2. Query StaticSpace for SubVoxels spatially overlapping delta_F_t;
     retrieve their insertion timestamps T_q.
  3. For each historical timestamp t_q in T_q:
     a. Collect scan voxels from timestep t_q intersecting delta_F_t.
     b. Mark them conservative.
     c. Grow moderate zone (27-neighborhood of conservative set).
     d. Grow aggressive zone (125-neighborhood of moderate set).
     e. Downgrade DynamicLevel of associated SubVoxels toward conservative.
  4. Remove from StaticSpace all SubVoxels whose DynamicLevel < static.

Output:
  - Cleaned static point-cloud map (dynamic residuals removed online)
  - Continuously updated; >10 Hz throughput for dense sensors, ~56 Hz for sparse Livox
```

The front-end handles objects actively dynamic during the current traversal. The back-end handles residuals left behind by objects that were already moving when first observed — the "ghost before confirmation" window. Together they produce a map that is both clean in real time and retroactively refined.

**Online vs. offline modes.** The front-end is strictly online: it processes each scan as it arrives and updates the map immediately. The back-end can be run incrementally (triggered after each new free-space block) or deferred to post-hoc batch mode where the full accumulated FreeSpace history is applied to the static map in a single pass. For the clean-then-segment pipeline (see Aggregated-Map Suitability below), the offline back-end-only mode is the most natural deployment: run the front-end to accumulate the map, then run the back-end once on the final accumulated scan set.

---

## Training-Free Nature

FreeDOM is fully classical — no learned components of any kind. The complete parameter set:

| Parameter | Description | Typical value |
|---|---|---|
| s_v | FreeSpace voxel size | 0.4 m outdoor, 0.2 m indoor |
| s_s | StaticSpace subvoxel size | 0.1 m outdoor, 0.05 m indoor |
| τ_f | Free confirmation threshold (scans) | 3 sparse/fast, 6 dense/slow |
| τ_r | Re-occupation recovery threshold (scans) | 20 |
| r_max | Max raycast enhancement range | 50 m |
| r_m | Safety margin for enhancement (buffer subtracted from synthetic boundary depth) | Paper-specific small value |

No training data is required. No domain-specific fine-tuning is needed. This delivers domain-transfer at zero cost: a configuration tested on outdoor road sequences can be applied to airside apron, warehouse, or port environments without any re-training, with only the voxel-size and τ_f scalar adjustments needed to match sensor density and platform speed.

The tradeoff is the absence of semantic priors: FreeDOM cannot exploit knowledge that an object is a vehicle vs. infrastructure vs. a transient occurrence. All removal decisions are purely geometric.

---

## Benchmark Results

### Evaluation Protocol

The PR/RR/F1 protocol introduced by ERASOR (RA-L 2021) is the community standard:

```
PR = |retained static points| / |all true static points|
RR = |removed dynamic points| / |all true dynamic points|
F1 = 2 * PR * RR / (PR + RR)
```

PR rewards preservation of static structure; RR rewards rejection of dynamic ghost trails; F1 is the harmonic mean. SemanticKITTI ground-truth class labels provide per-point dynamic/static truth. HeLiMOS provides ground truth for a pedestrian-rich campus environment captured with four sensor types simultaneously.

### SemanticKITTI Sequence 02 (Velodyne VLP-64, outdoor road)

| Method | PR (%) | RR (%) | F1 (%) |
|---|---|---|---|
| OctoMap | 79.71 | 99.97 | 88.70 |
| DUFOMap | 96.68 | 99.84 | 98.23 |
| Removert | 92.30 | 98.64 | 95.37 |
| ERASOR | 95.52 | 99.78 | 97.60 |
| BeautyMap | 92.93 | 99.33 | 96.02 |
| **FreeDOM** | **99.50** | **99.69** | **99.59** |

### SemanticKITTI Sequence 07 (Velodyne VLP-64, outdoor road)

| Method | PR (%) | RR (%) | F1 (%) |
|---|---|---|---|
| OctoMap | 79.70 | 88.73 | 83.97 |
| DUFOMap | 95.02 | 80.86 | 87.37 |
| Removert | 91.17 | 57.79 | 70.74 |
| ERASOR | 91.87 | 98.74 | 95.18 |
| BeautyMap | 96.22 | 84.58 | 90.02 |
| **FreeDOM** | **98.76** | **97.90** | **98.33** |

Seq 07 is considered the harder benchmark: it features a longer re-traversal loop where objects have moved between survey passes, and DUFOMap's RR collapses to 80.86% while Removert's falls to 57.79%. The retroactive back-end is the primary driver of FreeDOM's +3.15 pp F1 advantage over ERASOR here.

### HeLiMOS Crowded Sequence (Ouster OS2-128)

| Method | PR (%) | RR (%) | F1 (%) |
|---|---|---|---|
| OctoMap | 83.07 | 94.11 | 88.24 |
| DUFOMap | 92.41 | 91.62 | 92.01 |
| Removert | 83.19 | 90.14 | 86.53 |
| ERASOR | 91.42 | 91.58 | 91.50 |
| BeautyMap | 94.27 | 88.86 | 91.49 |
| **FreeDOM** | **98.01** | **95.74** | **96.86** |

### Indoor Corridor (Livox Mid-360)

| Method | PR (%) | RR (%) | F1 (%) |
|---|---|---|---|
| OctoMap | 88.04 | 97.84 | 92.69 |
| DUFOMap | 97.59 | 96.25 | 96.92 |
| Removert | 91.43 | 92.67 | 92.05 |
| ERASOR | 87.05 | 90.10 | 88.55 |
| BeautyMap | 77.60 | 83.46 | 80.42 |
| **FreeDOM** | **99.59** | **98.57** | **99.08** |

### Indoor Stairs (Livox Mid-360)

| Method | PR (%) | RR (%) | F1 (%) |
|---|---|---|---|
| OctoMap | 89.59 | 95.18 | 92.30 |
| DUFOMap | 96.03 | 94.60 | 95.31 |
| Removert | 92.27 | 95.53 | 93.87 |
| ERASOR | 63.79 | 76.67 | 69.64 |
| BeautyMap | 54.27 | 21.63 | 30.93 |
| **FreeDOM** | **99.48** | **95.11** | **97.25** |

The staircase result is the most diagnostic: ERASOR's flat-terrain R-GPF collapses (69.64%) and BeautyMap's ground-extraction anchor fails catastrophically (30.93%), while FreeDOM's geometry-only free-space test is entirely unaffected by non-horizontal ground planes.

### HeLiMOS Multi-Sensor Summary (All Four Sensor Types, TABLE II)

| Sensor | FreeDOM PR (%) | FreeDOM RR (%) | FreeDOM F1 (%) |
|---|---|---|---|
| Ouster OS2-128 (128-ch) | 98.28 | 96.05 | **97.15** |
| Velodyne VLP-16 (16-ch, sparse) | 98.50 | 83.97 | **90.66** |
| Livox Mid-360 (solid-state) | 97.85 | 92.78 | **95.25** |
| Aeva Aeries II (FMCW) | 97.34 | 90.02 | **93.54** |

FreeDOM leads all four sensor types in its paper's comparison. The VLP-16 result (F1 90.66%) is the notable weak point: precision remains very high (98.50%) but recall drops to 83.97%, reflecting the sparse-sensor limitation — fewer rays per voxel per scan make satisfying τ_f more difficult. Even so, FreeDOM leads the second-best competitor on VLP-16 by BeautyMap at 81.42% RR.

### Important Scope Corrections

The benchmark comparisons in the FreeDOM paper include exactly five methods: OctoMap, DUFOMap, Removert, ERASOR, and BeautyMap. The following methods were **not** compared in the paper:

- **ERASOR++** (arXiv 2403.05019): not compared; likely achieves higher F1 on KITTI seq 02 than ERASOR alone (ERASOR++ seq 07 F1 = 98.6% in its own paper)
- **OTD** (ICRA 2024): not compared; OTD reports F1 0.975–0.988 on SemanticKITTI — would be close competition
- **Dynablox** (RA-L 2023): not compared
- **MapCleaner** (Remote Sensing 2022): not compared
- **DR-Remover**: not compared

The stated "+9.7% average F1 improvement" in the FreeDOM paper is computed against the five methods above, not against the full 2025 SOTA field. Whether FreeDOM outperforms ERASOR++, OTD, or Dynablox on a shared benchmark is an open question as of May 2026.

**KTH DynamicMap Benchmark:** FreeDOM has **not** been submitted to the KTH leaderboard. The KTH benchmark (https://kth-rpl.github.io/DynamicMap_Benchmark/) currently covers DUFOMap, OctoMap, Dynablox, DeFlow, BeautyMap, ERASOR, and Removert. Any prior text suggesting FreeDOM competed against ERASOR++ or Dynablox on the KTH benchmark is inaccurate and should not be cited.

---

## Variants and Lineage

### Pseudo-Occupancy / Raycasting Lineage

**Removert (IROS 2020)** — direct ancestor of the raycasting branch. Uses per-scan range-image visibility: if the map's recorded range at a depth-image pixel exceeds the current scan's range, the map point is behind something that has moved. Limitation: range-image resolution coarseness; incidence-angle false positives on oblique surfaces; no spatial neighborhood conservatism.

**DUFOMap (RA-L 2024)** — most direct predecessor. Void-region logic: a voxel traversed once (with confirmed neighbors) is declared void; any point in a void voxel is dynamic. Faster and simpler than FreeDOM but less conservative — no τ_f consecutive-scan requirement. DUFOMap achieves F1 98.23% on KITTI seq 02 but drops to 87.37% on seq 07 where ghosting from partial traversals is more prevalent.

**FreeDOM (RA-L 2025)** — adds dual conservatism (spatial neighborhood + τ_f consecutive scans) over DUFOMap, and adds the retroactive back-end. Sits between DUFOMap (single-shot confirmation) and OctoMap (probabilistic many-shot accumulation): τ_f is deterministic count-based, not probabilistic.

### Separate Lineage: Pseudo-Occupancy Descriptor Branch

**ERASOR (RA-L 2021)** — uses sector-ring height-extent descriptors (no per-ray raycasting); offline batch processor. Faster than Removert but loses height-layer information and assumes flat terrain. See [ERASOR](erasor.md).

**ERASOR++ (arXiv 2024)** — adds Height Coding Descriptor and bitwise layer tests; addresses flat-terrain and z-drift failures. See [ERASOR++](erasor-plus-plus.md).

### 2024–2025 SOTA Context

| Method | Venue | Type | Best reported F1 |
|---|---|---|---|
| **FreeDOM** | RA-L 2025 | Online + retroactive raycasting | 99.59% (KITTI seq 02) |
| OTD | ICRA 2024 | Online timestamp-based | 97.5–98.8% (KITTI) |
| ERASOR++ | arXiv 2024 | Offline pseudo-occupancy | 93.1–98.6% (KITTI) |
| [BeautyMap](beautymap.md) | RA-L 2024 | Offline binary matrix | up to 95.98% HA (KITTI) |
| DUFOMap | RA-L 2024 | Online void-region | 98.23% (KITTI seq 02) |
| Raymoval | RiTA 2025 / arXiv 2026 | Offline az-el raycast | avg 0.927 F1 (SemanticKITTI) |

FreeDOM leads on the specific sequences tested in its paper. Direct head-to-head against OTD and ERASOR++ on the same evaluation split has not been published as of May 2026.

---

## Strengths

**Dual conservatism — high static preservation.** The 27-neighborhood spatial confirmation prevents isolated ray transits from triggering false removal. Thin static structures (sign poles, fence posts, traffic cones) that a grazing ray might barely miss are protected: the neighboring voxels remain untraversed even if the central voxel is. This is the primary reason FreeDOM achieves PR > 98% consistently across all tested environments.

**Retroactive back-end — high dynamic rejection.** The back-end is the primary driver of FreeDOM's advantage on KITTI seq 07 (F1 98.33% vs ERASOR 95.18%). ERASOR has no equivalent retroactive step; ghost points from objects that were present during early map accumulation but departed before enough free-space evidence accumulated are cleaned up retroactively as the vehicle re-traverses the area.

**Sensor agnosticism.** Works across Velodyne VLP-64, Ouster OS2-128, Livox Mid-360, and Aeva Aeries II FMCW without parameter retraining. The only sensor-specific parameter is τ_f (3 or 6), a single integer. No model weights, no domain fine-tuning.

**Indoor and non-flat applicability.** ERASOR F1 collapses to 69.64% on stairs; BeautyMap to 30.93%. FreeDOM achieves 97.25%. The free-space raycasting test has no ground-plane assumption and no height-extent descriptor — it operates equally well in any geometry where the sensor can traverse free space above and around objects.

**Genuine online operation.** The front-end runs at >10 Hz on a laptop CPU for dense Ouster data and ~56 Hz for sparse Livox. This is genuinely incremental, unlike ERASOR's ~0.073 s/frame batch mode which requires the full accumulated map to be loaded at each iteration.

**Training-free, zero domain-transfer cost.** No labeled data, no annotation pipelines, no semantic classes. Deploy on a new sensor or domain immediately. The entire configuration is documented in six interpretable scalar parameters.

---

## Failure Modes

### 1. Sparse Sensors — Degraded Recall

On Velodyne VLP-16 (16-channel), recall drops to 83.97% — the weakest result in the paper. Sparse sensors produce fewer rays per voxel per scan; with only 16 vertical channels, many voxels receive at most one or two rays per scan. The τ_f consecutive-traversal requirement becomes hard to satisfy at distance, allowing ghost points to persist until the vehicle makes multiple close-range passes. Reducing τ_f to 2 could help but increases false-positive risk.

### 2. Slow-Moving Objects

The temporal conservatism τ_f is essential but creates a blind window for slowly moving objects. A ground-handler walking at 0.5 m/s or a pushback tug creeping at 1 m/s may linger within the same voxel footprint long enough that each scan sees the object occupying the space — suppressing n_f accumulation — and the free-space threshold is never reached until long after the object departs. The moderate and aggressive DynamicLevel zones partially compensate at the periphery, but the object's core ghost points may persist through several scan cycles.

### 3. Localization Drift

If pose estimation drifts significantly, static objects appear to shift in the map frame, potentially moving into previously confirmed FreeSpace voxels and triggering false removal. This is particularly relevant for large-scale outdoor surveys (airport apron maps spanning hundreds of meters) where LiDAR odometry drift without GNSS correction can reach decimeters. FreeDOM inherits the same pose-quality hard dependency as all raycasting methods.

### 4. Low-Reflectivity Surface Overreach

Raycast enhancement estimates synthetic free-space boundaries in directions with no return, benefiting coverage on dark tarmac and wet surfaces. However, if the safety margin r_m is insufficient, the synthetic boundary may extend through a low-reflectivity static surface (a dark painted wall, a rubber bumper), generating false free-space evidence beyond it. The safety margin design mitigates this, but the risk is non-zero in heavily absorbing environments.

### 5. Ground False Positives at Scan Seams

Ground voxels at the footprint boundary of a dynamic object share spatial adjacency with confirmed-free voxels from the DynamicLevel moderate zone. In very flat, open environments this can produce thin ground-surface erosion near the paths of moving objects. The prefer-static tie-breaking rule and the 0.4 m coarse voxel grid reduce this, but it is not eliminated.

### 6. Static-but-Transient Blind Spot

FreeDOM shares the fundamental limitation of all geometry-only dynamic removal methods: **objects that do not actually move during the mapping session are not removed.** A parked ground-support vehicle, staged belt loader, or temporarily positioned equipment stands will be retained in the static map because no scan ray ever traverses the voxels it occupies during the survey window.

This is geometrically correct — the object was genuinely occupying that space at map-capture time — but produces a stale map as soon as the equipment repositions in operations. For airside mapping, GSE parked at a stand during the mapping window will survive in the static map, potentially blocking path-planning corridors that are operationally clear most of the time.

This is not a fixable failure mode for any classical geometry-only method. For the mitigation strategy, see [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md). The recommended approach is a versioned movable-object quarantine layer: detect known movable classes (GSE, aircraft, vehicles) with bounding-box detectors, store those points separately from permanent infrastructure, and expire or version them on a policy clock rather than relying on removal evidence.

**Failure mode summary:**

| Failure mode | Mechanism | Severity |
|---|---|---|
| Ghost persistence on sparse sensors (VLP-16) | τ_f not met with few rays per voxel | Moderate (RR ~84%) |
| Slow-mover retention | Insufficient free-space evidence per scan interval | Moderate |
| Pose-drift-induced false removal | Drift moves static geometry into confirmed FreeSpace | Scenario-dependent; high at scale without GNSS |
| Low-reflectivity surface overreach | Raycast enhancement propagates boundary through absorbing surfaces | Low (r_m margin mitigates) |
| Ground erosion at scan seams | Moderate DynamicLevel zone adjacency to ground | Low–moderate |
| Static-but-transient objects not removed | No movement = no free-space evidence | Universal blind spot; requires quarantine layer |

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Airside apron and service roads | Strong candidate | Training-free, sensor-agnostic, excellent on dense sensors; class-agnostic free-space logic handles aircraft and GSE. Raycast enhancement helps on wet/dark tarmac. Sparse sensor (VLP-16) degrades RR to ~84% — use 32-ch or 64-ch minimum. |
| Airside — parked aircraft / staged GSE | Not suitable (static-but-transient) | Geometry-only method cannot remove non-moving objects; quarantine layer required. |
| Indoor terminal / jet-bridge / warehouse | Strong | No flat-ground assumption; indoor F1 99.08% corridor, 97.25% stairs — best of any tested method. |
| Outdoor road / urban campus | Strong | Designed and benchmarked for SemanticKITTI/HeLiMOS; best-in-class on tested sequences. |
| Port / logistics yard (flat) | Conditional | Flat-area raycasting works well; dense sensor needed for recall; slow-moving forklifts and reach stackers are marginal cases. |
| Mining / construction | Conditional | Large movers produce strong free-space trails (good RR); irregular terrain does not affect the method (no ground assumption); localization drift in GPS-poor areas is the primary risk. |
| Agriculture | Conditional | Vegetation creates sparse mixed returns; τ_f may need tuning; no fundamental incompatibility but not benchmarked. |
| Real-time fleet map maintenance | Candidate with QA gate | Front-end enables online incremental maps; back-end refines on re-traversal; production map publication should require map-diff review and localization residual gate. |

---

## Aggregated-Map Suitability

FreeDOM is a strong candidate for the **dynamic-removal prerequisite step** in the clean-then-segment aggregated-map pipeline documented in [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) §9.1:

```
Raw accumulated scans
        |
[DYNAMIC REMOVAL]  <-- FreeDOM
        |
Clean static map
        |
3D semantic segmentation (SphereFormer, SPVCNN, etc.)
        |
Per-point class labels -> back-project -> auto-label scan frames
```

FreeDOM's two-mode architecture maps cleanly onto this pipeline:

- **Online (front-end only) mode:** Clean the map incrementally during survey data collection. At the end of the survey run, the static map is already cleaned, with no separate post-hoc pass required. Useful for real-time fleet mapping.
- **Offline (back-end batch) mode:** Run the front-end to accumulate the map, then apply the back-end once over the full accumulated scan set. Equivalent to a post-hoc map cleaner from the outside, but leverages the complete traversal history for maximal back-end coverage. This is the natural deployment mode for the segmentation pipeline.

**Advantages over ERASOR in this role:**
- Higher F1 on all tested environments, especially indoor/structured (97.25% stairs vs ERASOR 69.64%).
- Genuinely online; does not require batch re-processing of the entire map per scan iteration.
- No flat-terrain assumption; applicable to multi-floor and ramp environments without parameter overhaul.

**Static-but-transient GSE — quarantine layer mitigation.** As with all classical methods, parked GSE survives the FreeDOM cleaning step. For an airside segmentation pipeline, the recommendation is to stage FreeDOM output into two layers before segmentation:
1. **Confirmed static infrastructure:** points surviving FreeDOM with DynamicLevel = static and confirmed absent from movable-class bounding-box detections. Feed to segmentation.
2. **Quarantine layer:** points surviving FreeDOM that fall within movable-class bounding-box detections (GSE categories, vehicles, containers). Version-timestamp these separately; expire on a fleet-operations policy clock (e.g., 4 hours) rather than treating them as permanent infrastructure.

This two-layer staging prevents parked-GSE geometry from being auto-labeled as permanent infrastructure and then back-propagated as incorrect training labels into the fleet perception model.

---

## Implementation Notes

- **Start from the official MIT-licensed ROS1/catkin C++ implementation** at https://github.com/LC-Robotics/FreeDOM. The repo includes ROS launch files for SemanticKITTI, HeLiMOS, and indoor datasets with documented parameter files. Reproduce the dataset benchmarks before adapting to a new sensor.
- **Pose quality is the primary dependency.** Run SLAM with loop closure (KISS-ICP, LIO-SAM, or GNSS-aided LIO for large outdoor surveys) and verify trajectory ATE before running FreeDOM. Dynamic removal quality cannot compensate for misregistered scans.
- **Sensor and platform speed drive τ_f.** Use τ_f = 3 for VLP-16 or fast platforms; τ_f = 6 for Ouster OS2-128 or slow indoor platforms. Start at τ_f = 6 and reduce only if recall on known dynamic objects is insufficient. τ_r = 20 is the recommended recovery threshold; reduce for environments with frequent re-occupation of previously cleared voxels.
- **Windows / non-ROS deployment.** The catkin package build system requires adaptation for non-ROS pipelines. The C++ core is platform-independent; the ROS PointCloud2 message handling would need replacement with a custom scan-reader interface. Estimated porting effort: low-to-moderate for a team with C++ robotics experience.
- **Airside LiDAR selection.** The VLP-16 sparse-sensor limitation (RR ~84%) is operationally significant: a 16% ghost-persistence rate on taxiing aircraft and GSE is unacceptable for ISO 3691-4 compliant path planning. Use a 32-channel or 64-channel sensor minimum for airside AV applications. Ouster OS2-128 gives the strongest FreeDOM result (F1 97.15%) and is the benchmark sensor for airside dense-LiDAR surveys.
- **Version configuration with map artifacts.** Store the FreeDOM parameter set (s_v, s_s, τ_f, τ_r, r_m) in the map metadata alongside the map version hash. Changing parameters produces a different cleaned map; downstream localization and segmentation systems must know which version they depend on.
- **Preserve DynamicLevel layers in map output.** Do not export only a binary static/dynamic split. The four-level output (conservative / moderate / aggressive / static) enables downstream QA: inspect the aggressive zone for structures that were nearly-but-not-quite removed; inspect the conservative zone to confirm it contains only genuine ghost trails and not static infrastructure.
- **Compare against ERASOR and MapCleaner on the same route** before adopting FreeDOM as the default cleaner for production. FreeDOM leads on indoor and mixed-sensor environments; MapCleaner's terrain-surface approach may outperform FreeDOM's free-space approach on very dense outdoor routes with complex terrain. See [LiDAR Map Cleaning — Dynamic Removal](lidar-map-cleaning-dynamic-removal.md) for the full method selection framework.
- **Map lifecycle gate before production.** Do not automatically publish FreeDOM output to production localization maps. Use a map lifecycle approval step: inspect the rejected dynamic cloud for static erosion, run a localization residual check on the cleaned map against a reference route, and gate promotion to production. FreeDOM's online output is a cleaned candidate map, not a certified production map.

---

## Sources

| Item | URL |
|---|---|
| arXiv preprint | https://arxiv.org/abs/2504.11073 |
| arXiv HTML | https://arxiv.org/html/2504.11073v1 |
| IEEE RA-L DOI | https://doi.org/10.1109/LRA.2025.3560881 |
| IEEE Xplore record | https://ieeexplore.ieee.org/document/10964854/ |
| GitHub repository (MIT, C++/ROS) | https://github.com/LC-Robotics/FreeDOM |
| KTH DynamicMap Benchmark (FreeDOM not included) | https://kth-rpl.github.io/DynamicMap_Benchmark/ |
| KTH Benchmark repository | https://github.com/KTH-RPL/DynamicMap_Benchmark |
| ERASOR (RA-L 2021) | https://arxiv.org/abs/2103.04316 |
| ERASOR++ (arXiv 2024) | https://arxiv.org/abs/2403.05019 |
| DUFOMap (RA-L 2024) | https://arxiv.org/abs/2403.01449 |
| Dynablox (RA-L 2023) | https://arxiv.org/abs/2304.10049 |
| BeautyMap (RA-L 2024) | https://arxiv.org/abs/2405.07283 |
| Removert (IROS 2020) | https://github.com/gisbi-kim/removert |
| OTD (ICRA 2024) | https://arxiv.org/abs/2406.15774 |
| Raymoval (arXiv 2025) | https://arxiv.org/abs/2605.08937 |
| RH-Map (RA-L 2023) | https://github.com/YZH-bot/RH-Map |
| DR-Remover | https://github.com/zhongbusishaonianyou/DR-REMOVER |
| HeLiMOS (IROS 2024) | https://arxiv.org/abs/2408.06328 |
| SemanticKITTI tasks | https://semantic-kitti.org/tasks.html |
