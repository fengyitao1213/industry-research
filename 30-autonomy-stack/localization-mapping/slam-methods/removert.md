# Removert

<!-- method-priority:start
priority:
  learning: 4
  deployment: 5
  type: "method"
  stage: "deployment-pattern"
  maturity: "pilot-proven"
  tags: ["slam", "mapping", "validation", "runtime-localization", "outdoor"]
  reason: "Removert is rated for dynamic-object filtering and map-cleaning workflows that protect localization maps."
method-priority:end -->

Related docs: [LiDAR Map Cleaning — Dynamic Removal](lidar-map-cleaning-dynamic-removal.md), [ERASOR](erasor.md), [ERASOR++](erasor-plus-plus.md), [MapCleaner](mapcleaner.md), [DR-Remover](dr-remover.md), [FreeDOM](freedom-dynamic-object-removal.md), [RTMap/DUFOMap Recursive Maintenance](rtmap-dufomap-recursive-maintenance.md), [LT-Mapper / Khronos Lifelong Mapping](lt-mapper-khronos-lifelong-mapping.md), [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md), [Scan Context Family](scan-context-family.md), [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [Point Cloud Registration Math](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md), [LiDAR Working Principles and Noise Models](../../../10-knowledge-base/geometry-3d/lidar-working-principles-noise-models.md).

**Last updated:** 2026-05-24

---

## What It Is

Removert is the founding method in the range-image-based dynamic-removal lineage for LiDAR map cleaning. Its full title is **"Remove, then Revert: Static Point cloud Map Construction using Multiresolution Range Images"**, published by **Giseop Kim and Ayoung Kim** (KAIST IRAP Lab) at the **IEEE/RSJ International Conference on Intelligent Robots and Systems (IROS) 2020**, Las Vegas, Nevada (held virtual), October 2020.

**Key identifiers:**
- IEEE DOI: https://doi.org/10.1109/IROS45743.2020.9340856
- IEEE Xplore: https://ieeexplore.ieee.org/document/9340856/
- Author PDF: https://gisbi-kim.github.io/publications/gkim-2020-iros.pdf
- GitHub (canonical): https://github.com/irapkaist/removert
- GitHub (mirror): https://github.com/gisbi-kim/removert
- License: **CC BY-NC-SA 4.0** — non-commercial use only; commercial deployment requires a separate agreement with the IRAP Lab.
- ArXiv status: **No preprint identified.** The IROS 2020 proceedings at IEEE Xplore is the sole citable record.

The method's core purpose is **offline post-hoc map cleaning**: given a raw accumulated LiDAR map that contains ghost trails from moving vehicles, pedestrians, and equipment, Removert produces a cleaned static map suitable for localization, navigation, and semantic annotation. It does **not** perform SLAM, estimate poses, or build a map; it is applied after a full SLAM pipeline has produced both an accumulated map and a per-scan pose sequence.

Removert is the required baseline in the KTH DynamicMap Benchmark (ITSC 2023) and is explicitly cited by every major successor method (ERASOR, ERASOR++, BeautyMap, DUFOMap, FreeDOM, MapCleaner) as the foundational range-image-based removal approach.

---

## Authors and Affiliation

**Giseop Kim** — Ph.D. student at KAIST (2017–2021), **Intelligent Robotic Autonomy and Perception (IRAP) Lab**, Department of Civil and Environmental Engineering, Daejeon, South Korea. Advisor: Ayoung Kim. Known for Scan Context (IROS 2018), Scan Context++ (IEEE T-RO 2021), and LT-mapper (ICRA 2022). Removert shares the same IRAP Lab codebase and GitHub organization (`irapkaist`) as Scan Context — the two methods are complementary: Scan Context provides LiDAR loop-closure/place recognition; Removert provides map cleaning.

**Ayoung Kim** — Professor, head of the IRAP Lab at KAIST at time of publication; currently Professor, Seoul National University (SNU), Department of Mechanical Engineering.

---

## Core Technical Idea

Removert's thesis in one sentence: **a map point is a dynamic ghost trail if a later scan, observed from the same pose, can see through it — its ray is shorter than the map point's recorded depth in the same range-image pixel — and the "remove-then-revert" structure first removes all such points aggressively, then recovers static points whose removal was a false positive caused by pose error, occlusion, or projection quantization.**

The name encodes the two-stage pipeline: **Remove** dynamic candidates, then **Revert** false positives back into the static map.

The two-stage design addresses an asymmetric cost structure:
- **Leaving a dynamic ghost trail** corrupts localization (fake obstacle occupancy) and degrades semantic auto-labels back-projected from the map.
- **Over-removing a static point** (a fence post, docking aid, signboard pole) erodes the localization fingerprint and removes real obstacles from the map.

A purely aggressive single-pass removal achieves high dynamic rejection but poor static preservation. Removert's key innovation is the **revert step**: a second pass at coarser range-image resolution that recovers points initially flagged as dynamic but likely static, by exploiting the fact that small pose errors and projection quantization shift a point by only 1–2 pixels at fine resolution, while at coarser resolution the point and its neighbors collapse into the same pixel and the apparent inconsistency disappears.

---

## Operator Mechanics

### Remove Step — Dynamic Candidate Detection

For each query scan at pose T_t:

1. **Project the accumulated map** into the spherical range image at pose T_t, at resolution (H_rm x W_rm). The projected depth at pixel (u, v) is d_map(u, v).

2. **Project the current scan** into the same range image at the same pose. The depth at pixel (u, v) is d_scan(u, v).

3. **Compute the range difference.** A map point is flagged as dynamic if:

   ```
   d_map(u, v) > d_scan(u, v) + epsilon
   ```

   Interpretation: the current scan sees something **closer** than where the map point sits. The map point is being "seen through" — it sits behind the current measurement. This is the geometric signature of a dynamic-object ghost trail: the map recorded a point where an object once was; the current scan penetrates that location because the object has since moved.

   The threshold `epsilon` prevents flagging from normal sensor noise. Typical LiDAR range noise is 2–5 cm; epsilon values of 0.1–0.3 m are used in the implementation. The exact values used in the IROS 2020 paper benchmarks are not confirmed from accessible secondary sources (see Sources).

4. **Collect flagged points** as the dynamic candidate set M_removed.

### Revert Step — False-Positive Recovery

The remove step flags too many points when:
- Pose error of 5–10 cm lateral or 0.1–0.2 degrees angular shifts a map point's projection by 1–3 pixels at fine resolution, creating apparent range inconsistencies for genuinely static points.
- A static point is at the boundary of a previously dynamic region (e.g., a fence post behind a pedestrian) and was partially occluded in the reference frame.
- Thin structures (masts, poles, sign uprights) produce only a few pixels in the range image; nearby dynamic object projections can overlap their columns.

The revert step uses a **coarser range-image resolution** (H_rv x W_rv, where H_rv < H_rm and W_rv < W_rm) to re-examine the removed candidate set:

1. Re-project the dynamic candidates and the current scan at the coarser resolution.
2. A removed point is **reverted** (restored to the static map) if, at the coarser resolution, the range-image comparison is consistent with static membership — i.e., the apparent range discrepancy that triggered removal at fine resolution disappears when examined at coarser resolution.

The intuition: at coarse resolution each pixel covers a larger solid angle. Small registration errors that shifted the projection by 1–2 fine-resolution pixels now no longer matter — the point and its neighbors fall into the same coarse pixel. The range difference is re-evaluated at the granularity where pose error is negligible.

### Multi-Resolution Configuration — RM3 and RM3+RV1

Parameters are set in `config/params.yaml`:

- **`remove_resolution_list`**: list of angular resolution levels (in degrees per pixel or equivalent) at which the remove step runs. Multiple entries = multiple passes at different resolutions.
- **`revert_resolution_list`**: analogous list for the revert step. Coarser than the finest remove resolution.

Example for 64-channel rotating LiDAR:
```
remove_resolution_list: [2.5, 2.0, 1.5]   # finer values = higher resolution = more aggressive
revert_resolution_list: [3.0]              # coarser than the finest remove level
```

The ERASOR benchmark paper defines two canonical Removert configurations:

- **RM3**: 3-level remove only, no revert pass. Higher rejection rate (fewer ghost trails remain) but lower preservation rate (more static points removed as false positives).
- **RM3+RV1**: 3-level remove followed by 1-level revert. Higher preservation rate but lower rejection rate (the revert step recovers some genuine dynamic points along with static false positives).

This RM3 vs. RM3+RV1 trade-off is the clearest illustration of the remove-revert tension and the primary configuration choice in practice.

### Batch Processing

Removert processes scans in batches (the README recommends 50–100 scans per batch). Each scan contributes a remove/revert vote against the accumulated map. After all scans in a batch are processed, the final static map and the removed dynamic submap are written out as PCD files. The algorithm runs fully offline, single-pass over the scan sequence.

---

## Inputs and Outputs

| Item | Format | Notes |
|---|---|---|
| Accumulated LiDAR map | PCL PCD | Pre-built from SLAM; the map to be cleaned |
| Individual scan frames | Binary KITTI format (.bin) or ROS PointCloud2 | One file per scan epoch |
| Per-scan poses | SE(3) text file, 12 numbers per line (KITTI 3x4 rotation-translation, row-major) | Must be from external SLAM with loop closure; pose quality is a hard dependency |
| Range-image parameters | `config/params.yaml` | Resolution lists, epsilon, batch size |
| **Cleaned static map** | PCD | Primary output; dynamic ghost trails removed |
| **Removed dynamic submap** | PCD | Points classified as dynamic; for QA and inspection |

Removert is **not a SLAM frontend**. It does not estimate poses, build a map, or perform loop closure. It is a **post-hoc offline batch cleaner** that takes an already-built map and already-estimated poses and produces a cleaned map. Output quality is upper-bounded by input pose quality.

---

## Architecture

```
Input: accumulated map M, scan sequence {S_t}, pose sequence {T_t}

For each batch of scans:
  For each scan S_t in batch:

    [REMOVE MODULE] — fine range-image resolution (H_rm x W_rm)
    1. Transform S_t to map frame using T_t
    2. Project M into range image at pose T_t  -> d_map(u, v)
    3. Project S_t into range image at same pose -> d_scan(u, v)
    4. Flag map points where d_map(u,v) > d_scan(u,v) + epsilon
       -> M_removed (dynamic candidates)

    [REVERT MODULE] — coarser range-image resolution (H_rv x W_rv)
    5. Re-project M_removed and S_t at coarser resolution
       -> d_map_coarse, d_scan_coarse
    6. For each removed point: if range comparison at coarse resolution
       is consistent with static membership -> restore to M_static
       -> M_reverted (false positives recovered)

  Update M_static  := M_static ∪ M_reverted
  Update M_dynamic := M_removed \ M_reverted

Output:
  M_static  — cleaned static map
  M_dynamic — dynamic residual submap
```

No online or incremental update capability exists in the base implementation. Multiple batch runs with different configurations can be composed but require a manual workflow.

---

## Training

**Removert is rule-based and contains zero learned components.** There are no neural network weights, no training data, and no domain-specific labels. The algorithm requires only:
- Sensor geometry (angular resolution of the LiDAR, for range-image projection)
- Range-difference threshold `epsilon` (hand-tuned, typically 0.1–0.3 m)
- Resolution lists for remove and revert passes (tuned to sensor channel count and deployment scenario)

This means Removert transfers to any new domain — airside, warehouse, mining, port, construction — without retraining. The cost is that all failure modes are purely geometric: no semantic context is available to distinguish a parked vehicle from a permanent wall, or a person from a thin pole.

---

## Benchmark Results

### Evaluation Metrics

ERASOR (Lim et al. 2021) introduced the canonical metrics for static map building evaluation, now standard across the lineage:

```
PR (Preservation Rate) = |retained static points| / |all true static points|
RR (Rejection Rate)    = |removed dynamic points|  / |all true dynamic points|
F1                     = 2 * PR * RR / (PR + RR)
```

Ground truth is derived from SemanticKITTI per-point semantic class labels on KITTI odometry sequences.

### SemanticKITTI — ERASOR Paper Table II

Source: ERASOR paper (arXiv 2103.04316 / RA-L 2021), Table II. Removert numbers were produced by the ERASOR authors under their evaluation harness.

| Sequence | Method | PR (%) | RR (%) | F1 |
|---|---|---|---|---|
| 00 | Removert RM3 | 85.50 | 99.35 | 0.919 |
| 00 | Removert RM3+RV1 | 86.83 | 90.62 | 0.887 |
| 00 | ERASOR | 93.98 | 97.08 | 0.955 |
| 01 | Removert RM3 | 94.22 | 93.61 | 0.939 |
| 01 | Removert RM3+RV1 | 95.82 | 57.08 | **0.715** |
| 01 | ERASOR | 91.49 | 95.38 | 0.934 |
| 02 | Removert RM3 | 76.32 | 96.80 | 0.853 |
| 02 | Removert RM3+RV1 | 83.29 | 88.37 | 0.858 |
| 02 | ERASOR | 87.73 | 97.01 | 0.921 |
| 05 | Removert RM3 | 86.90 | 87.88 | 0.874 |
| 05 | Removert RM3+RV1 | 88.17 | 79.98 | 0.839 |
| 05 | ERASOR | 88.73 | 98.26 | 0.933 |
| 07 | Removert RM3 | 80.69 | 98.82 | 0.888 |
| 07 | Removert RM3+RV1 | 82.04 | 95.50 | 0.883 |
| 07 | ERASOR | 90.62 | 99.27 | 0.948 |

**Key observations:**

1. RM3 achieves high RR (>93% on seq 00, 01, 07) — aggressive removal catches most ghost trails — but lower PR on seq 00, 02 (~76–86%), meaning significant static structure is lost.

2. RM3+RV1 improves PR on seq 00, 02, 07 by 3–7 pp, confirming the revert step is recovering false positives as intended.

3. **Sequence 01 is the pathological case:** RM3+RV1 collapses RR to 57.08% (F1 = 0.715 — the worst result across all configurations). Seq 01 is the KITTI highway sequence with dense roadside vegetation; the revert step at coarser resolution re-admits dynamic points along vegetated sections as "probable static" — a classic over-revert failure. ERASOR achieves F1 = 0.934 on the same sequence.

4. ERASOR outperforms both Removert configurations on F1 across all five sequences.

### Runtime Comparison — ERASOR Paper, Sequence 01

| Method | Time per scan (seconds) |
|---|---|
| Peopleremover | ~1,000 |
| OctoMap-0.05 | 1.077 |
| Removert | 0.831 |
| ERASOR | 0.073 |

Removert is approximately **11x slower** than ERASOR per scan on KITTI sequence 01. The bottleneck is repeated spherical image projection over the full accumulated map for each query scan.

### KTH DynamicMap Benchmark (ITSC 2023)

The KTH benchmark uses three different metrics: **SA (Static Accuracy)**, **DA (Dynamic Accuracy)**, **AA = (SA + DA) / 2**. Numbers below are from the DUFOMap paper (arXiv 2403.01449), Table III, which re-reports KTH benchmark results.

| Dataset | Removert SA (%) | Removert DA (%) | Removert AA (%) |
|---|---|---|---|
| KITTI seq 00 (small town) | 99.44 | 41.53 | 64.26 |
| KITTI seq 01 (highway) | 97.81 | 39.56 | 62.20 |
| Argoverse 2 (big city) | 98.97 | 31.16 | 55.53 |
| Semi-indoor | 99.96 | 12.15 | 34.85 |

**Pattern:** Removert achieves near-perfect SA (97–100%) — almost no static points are lost — but catastrophically low DA (12–42%) — the large majority of dynamic points are not removed. This is RM3+RV1 behavior: the revert step pulls most dynamic candidates back into the static map, resulting in a highly conservative output that leaves most dynamic content in the map. The KTH SA/DA framework exposes the extreme end of the preservation-vs-rejection trade-off more clearly than ERASOR's PR/RR.

The BeautyMap paper (arXiv 2405.07283) characterizes the low DA as a structural issue: "Removert incorrectly recovered dynamic points near the ground with the coarse range image." At coarse resolution, ground-contact points from dynamic objects merge with legitimate ground returns, and the revert step cannot distinguish them.

### FreeDOM Benchmark (arXiv 2504.11073, Table I)

| Dataset / Scene | Removert PR (%) | Removert RR (%) | Removert F1 (%) |
|---|---|---|---|
| SemanticKITTI seq 02 | 92.30 | 98.64 | 95.37 |
| SemanticKITTI seq 07 | 91.17 | 57.79 | 70.74 |
| HeLiMOS Ouster (crowded) | 83.19 | 90.14 | 86.53 |
| Indoor corridor (Livox) | 91.43 | 92.67 | 92.05 |
| Indoor stairs (Livox) | 92.27 | 95.53 | 93.87 |

Source: FreeDOM paper (arXiv 2504.11073) Table I.

Notable: Removert performs reasonably on indoor sequences (F1 = 92–94% on corridors and stairs) compared with ERASOR, which collapses on stairs (F1 = 69.64%). The range-image mechanism is less reliant on a flat ground-plane assumption than ERASOR's R-GPF, giving Removert an advantage in non-horizontal geometries. The severe drop on KITTI seq 07 (F1 = 70.74%) matches the highway vegetation failure documented in the ERASOR evaluation.

---

## Cross-Method Comparison

| Dimension | Removert | ERASOR | Dynablox | DUFOMap | FreeDOM | MapCleaner |
|---|---|---|---|---|---|---|
| Representation | Flat point cloud + range image | Flat point cloud + polar bins | TSDF voxel grid | Voxel grid with ray counters | Occupancy voxel + spatial graph | Flat point cloud + 2D grid |
| Core mechanism | Per-ray range-image visibility check | Sector-ring height-span ratio | Ever-free voxel detection (TSDF) | Void-region ray traversal | Conservative free-space + raycast enhancement | Multi-scan cumulative per-point voting |
| Online / offline | Offline only | Offline only | Online | Online-capable | Online-capable | Offline only |
| Learning required | None | None | None | None | None | None |
| Speed (KITTI) | 0.831 s/scan | 0.073 s/scan | Online (real-time) | 0.062 s/scan | — | Per-sequence (BGK + voting) |
| Ground assumption | Implicit (see-through) | Explicit R-GPF plane fit | TSDF free-space | Voxel traversal | Spatial conservatism | Explicit terrain model (BGK) |
| Indoor performance | F1 ~92–94% (stairs/corridors) | F1 ~70% (stairs) — degrades | Good (3D TSDF) | Good | Best published | Moderate |
| Key trade-off | High SA, low DA; slow; pose-sensitive | Faster, better F1, flat-terrain assumption | Online but needs TSDF memory | High DA, fast, near-tuning-free | Best published F1, complex retroactive back-end | High static preservation, slow, batch-only |

---

## Lineage

### Predecessor

**Peopleremover** (Schauer and Nuchter, ICRA 2018): ray casting through occupancy space to identify map points occluded by later scans. Extremely slow (~1000 s/scan on KITTI seq 01) — used as a baseline in both the Removert and ERASOR papers. Removert's key improvement: range-image projection is far faster than full 3D ray traversal, and the explicit multi-resolution revert step addresses false positives structurally.

### The Removert Lineage (2020–2025)

| Method | Year | Venue | Key innovation over Removert |
|---|---|---|---|
| ERASOR (Lim et al.) | 2021 | RA-L / ICRA | Sector-ring pseudo-occupancy; 11x faster; better F1 on mixed scenes |
| LT-removert (Kim et al.) | 2022 | ICRA (LT-mapper) | Multi-session extension; cross-session change detection |
| MapCleaner (Fu et al.) | 2022 | Remote Sensing | Terrain surface estimation first; cumulative per-point voting |
| ERASOR2 | ~2023 | erasor2.github.io | Instance-level segmentation + motion tracking; handles parked vehicles |
| ERASOR++ (Zhang et al.) | 2024 | ICRA | Height Coding Descriptor (HCD); bitwise height-layer test; better PR |
| BeautyMap (Zheng et al.) | 2024 | RA-L | Binary column bitmap; ~0.046 s/frame; high SA |
| DUFOMap (Zhang et al.) | 2024 | RA-L | Void-region detection; near-tuning-free; higher DA than Removert |
| FreeDOM (Li et al.) | 2025 | RA-L | Dual-conservative raycasting + retroactive back-end; best published F1 |

All of these methods cite Removert as the foundational range-image-based dynamic-removal method. The KTH DynamicMap Benchmark (ITSC 2023) includes Removert as a mandatory baseline.

### LT-mapper / LT-removert

LT-mapper (Kim and Kim, ICRA 2022) is a modular lifelong mapping framework by the same IRAP Lab authors that integrates a component called **LT-removert**. LT-removert takes two aligned map sessions (a central reference session + one or more query sessions) and applies Removert-style range-image comparison to detect:

- **High-dynamic points**: ghost trails from moving objects within a session (classic Removert task).
- **Low-dynamic changes**: point-cloud regions that differ between sessions (e.g., a parked truck in session 1 that is absent in session 2).

LT-removert extends Removert from within-session ghost removal to cross-session change detection, making it the closest published use of Removert for long-term operational map maintenance. See [LT-Mapper / Khronos Lifelong Mapping](lt-mapper-khronos-lifelong-mapping.md).

---

## Strengths

- **No training required.** Works immediately on any domain (airside, warehouse, mining, port, construction) without labeled data or retraining. Transfers via parameter adjustment only.
- **Fine-grained spatial resolution.** Range-image pixel-level comparison resolves thin structures and boundaries more precisely than coarser bin-domain methods (ERASOR) in some scenarios.
- **Indoor-capable.** Unlike ERASOR, the range-image mechanism does not require a flat horizontal ground plane; the FreeDOM benchmark shows F1 = 92–94% on indoor corridor and stair sequences.
- **Mature, well-documented codebase.** The canonical repository is actively used as a research baseline. Both irapkaist and gisbi-kim mirrors are available.
- **Reproducible baseline.** Removert's results appear in nearly every subsequent dynamic-removal paper; it is the established comparison anchor for the field.
- **Interpretable.** Every removal and revert decision traces to a specific range-image pixel comparison; no black-box behavior.
- **Removed dynamic submap.** The output M_dynamic is useful for QA: it provides a spatial record of ghost trails from moving objects during the survey, useful for operational analysis and cross-checking.
- **Complementary to LiDAR-MOS.** The repository explicitly recommends combining Removert with a LiDAR moving-object segmentation (MOS) front-end: MOS removes obviously moving points online; Removert handles the residual static-coordinate ghost trails that MOS misses.

---

## Failure Modes

### 1. Pose Sensitivity (Critical)

Removert's entire mechanism depends on projecting map points and scan points onto the same range-image pixels. A pose error of even 5–10 cm lateral shift or 0.1–0.2 degrees angular rotation can move a map point's projection by 1–3 pixels at fine resolution, creating apparent range discrepancies for genuinely static points. The revert step partially compensates by using coarser resolution, but systematic pose error (e.g., accumulated LiDAR odometry drift without loop closure) propagates into systematic false positives. **Removert should only be applied after full SLAM with loop closure correction, not on raw odometry-grade poses.**

### 2. Revert Step Non-Monotonic Trade-off

As shown in the sequence 01 data (RM3+RV1: RR drops from 93.61% to 57.08% while PR only improves from 94.22% to 95.82%), the revert step can cause a large RR degradation for a small PR gain. This makes configuration selection brittle: the optimal remove/revert resolution combination is dataset-specific and cannot be predicted from first principles without empirical testing on the target scenario.

### 3. Highway Vegetation Over-Revert

Sequence 01 is the canonical failure: dense roadside vegetation at coarser range-image resolution merges dynamic-object projections with vegetation pixels, causing the revert step to recover dynamic points as "probable static." RM3+RV1 F1 = 0.715 on this sequence. If the deployment environment has similar vegetation-dense boundaries, the RM3-only configuration (no revert pass) is preferable.

### 4. Offline Only

The implementation is batch-processing offline. It is not designed for online incremental map update. For live operational AV fleets that need real-time map maintenance, online alternatives (DUFOMap, FreeDOM, Dynablox) are required.

### 5. Slow on Large Maps

The full map is projected into the range image for every query scan. Projection cost scales O(N_map). On large-scale maps (millions of points), this becomes prohibitive. The implementation mitigates this by processing in scan batches (50–100 scans), but the fundamental scaling is less favorable than voxel-grid methods (DUFOMap) or sparse bin representations (ERASOR).

### 6. Fixed Thresholds Require Scenario Tuning

The `epsilon` (range-difference threshold) and the `remove_resolution_list` / `revert_resolution_list` must be tuned per sensor model and scenario. A 64-channel rotating LiDAR has different angular resolution and noise characteristics from a 32-channel or 128-channel sensor, or from a solid-state LiDAR. Indoor environments with short ranges and dense coverage require different settings than wide-open aprons with long ranges and sparse returns. There is no principled automatic tuning procedure; practitioners must run ablation sweeps on scenario-specific data and version the parameters alongside the map.

### 7. Cannot Handle Static-but-Transient Objects

Removert removes only **dynamic ghost trails** — residue from objects that moved during the survey window. An object stationary throughout the entire scan sequence (a parked vehicle, staged GSE, or any permanently immobile-during-survey object) accumulates only static evidence and is correctly preserved by Removert. This is not a bug but a fundamental scope limitation. Addressing static-but-transient objects requires either multi-session comparison (LT-removert / LT-mapper) or instance-level object detection and motion tracking (ERASOR2). See [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md).

### 8. Incidence-Angle False Positives

Points at high incidence angles (grazing rays on reflective surfaces) have noisy depth returns. A map point at 85 degrees incidence may have a measured depth differing from the scan's depth at the same pixel by more than `epsilon` due to surface-normal-dependent ranging error, not due to any dynamic change. The revert step recovers some of these but not systematically. The FreeDOM paper explicitly names this as a structural weakness of range-image methods.

### 9. Thin Vertical Structure Erosion

Masts, poles, sign posts, and fence uprights occupy only a few pixels in the range image. If an adjacent dynamic object's projection overlaps the static structure's pixels (due to finite angular resolution), the structure can be flagged as dynamic. The revert step is less reliable here: at coarser resolution the thin structure and the dynamic object merge into the same pixel, making the coarse-resolution comparison ambiguous. Observed failure modes include partial erosion of fence lines and marker posts in parking and apron environments.

### 10. No Semantic Context

Removert cannot leverage class labels to distinguish "pedestrian-class pixel, should be removed" from "tree-class pixel, should be preserved." All decisions are purely geometric. A leafy tree canopy viewed from a slightly different angle between map accumulation and query scan will produce range-image discrepancies that Removert cannot disambiguate from a genuine dynamic object.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV — outdoor urban | Strong | Validated on SemanticKITTI; works well on mixed scenes with vehicles and pedestrians |
| Road AV — highway | Conditional | Vegetation-heavy roadsides cause RM3+RV1 over-revert failure (seq 01); use RM3 only |
| Airside — active GSE and taxiing aircraft | Conditional | Effective for ghost trail removal; pose accuracy requirement is demanding near buildings; range-image does not require flat ground plane |
| Airside — parked aircraft / staged GSE | Not suitable | Static-but-transient; requires LT-removert multi-session or ERASOR2 instance tracking |
| Airside — vegetation borders (hangar surrounds) | Conditional | Risk of RM3+RV1 over-revert on vegetation-heavy sequences; prefer RM3-only configuration |
| Warehouse / indoor flat | Conditional | FreeDOM benchmark shows F1 = 92% on corridors; better than ERASOR; default outdoor parameters need re-tuning for short-range indoor LiDARs |
| Warehouse / indoor multi-level | Moderate | Range-image mechanism handles non-flat geometry better than ERASOR; KTH semi-indoor DA only 12% with default parameters |
| Mining / construction | Conditional | Large movers produce clean ghost trails; irregular terrain does not degrade the range-image mechanism (unlike ERASOR R-GPF) |
| Port / logistics yard | Conditional | Flat areas suit the mechanism; crane metalwork at high incidence angles produces false positives |
| Agriculture | Weak | Vegetation variability produces systematic range inconsistencies indistinguishable from dynamic objects |

---

## Aggregated-Map Suitability

### Pipeline Position

Removert's canonical position in the aggregated-map-building pipeline is:

```
Raw LiDAR scans + SLAM poses (loop-closed)
        |
Scan accumulation -> raw map M (with dynamic ghost trails)
        |
[REMOVERT or ERASOR / FreeDOM]
        |
Cleaned static map M_static
        |
3D semantic segmentation (SphereFormer, SPVCNN, SalsaNext)
        |
Per-point class labels -> back-project -> auto-label scan frames
```

This ordering is documented in [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) as non-optional preprocessing: ghost trails carry vehicle and pedestrian geometry but occupy free space, causing segmentation models to assign incorrect classes and propagating erroneous labels into every downstream training set built from the map.

### Role as Evaluation Baseline

**Removert is the recommended baseline in any map-cleaning evaluation.** It is the oldest method with published benchmarks across multiple evaluation frameworks (ERASOR paper Table II, KTH DynamicMap Benchmark, FreeDOM paper Table I, BeautyMap paper), making it the most reliable anchor for comparison. Any new method or domain-specific parameter tuning should begin with Removert as the lower-bound reference point.

Removert is usable as a final offline cleanup step on top of online dynamic-aware SLAM (e.g., after Dynamic-Object-Aware SLAM or LiDAR-MOS pre-filtering).

### Airside Aggregated Mapping

Removert is the **right shape** for airside aggregated mapping: offline, post-SLAM, batch cleaning. However, several considerations apply:

- **Pose accuracy is the critical dependency.** GPS-denied areas near terminal buildings require high-quality LiDAR-inertial SLAM with loop closure before Removert can be applied. Accumulated drift without loop closure will produce systematic false positives.
- **Sensor parameters require calibration.** Airside sensors often use 32- or 128-channel LiDARs (e.g., Ouster OS1-128, Velodyne VLP-32C). The range-image resolution and noise characteristics differ significantly from KITTI's 64-channel VLP-64. Threshold calibration on representative airside data is required before production use.
- **Large open apron geometry.** Long-range, large open aprons push the per-scan projection cost higher. Consider batching conservatively (25–50 scans) and using coarser `remove_resolution_list` values.
- **Vegetation at hangar surrounds.** If hangar or terminal perimeter vegetation is present, RM3-only configuration (no revert pass) is preferable to avoid the sequence 01-style over-revert failure.
- **Static-but-transient parked GSE** (gate-assigned tugs, belt loaders, stair trucks) survives Removert. These require a separate quarantine-layer workflow: detect parked objects with bounding-box detectors, store as a movable-class layer separate from permanent infrastructure.
- **FreeDOM and ERASOR as alternatives.** FreeDOM achieves F1 = 99.59% on KITTI seq 02 vs. Removert's 95.37% and handles background-observation gaps better via its raycast enhancement. If cleaned-map quality is the primary criterion for a new deployment, FreeDOM or ERASOR are preferable production choices; Removert remains the required evaluation baseline.

---

## Implementation Notes

### Code and Build

- **Repository:** https://github.com/irapkaist/removert (canonical). Mirror at https://github.com/gisbi-kim/removert. Both point to the same code.
- **Language:** C++17
- **Build system:** catkin (ROS Melodic, tested on Ubuntu 18.04). Does not build natively on Windows without significant adaptation — the ROS1 dependency requires either a Linux VM, WSL2, or Docker. The PCL and Eigen core is portable but the catkin package structure must be adapted.
- **Key dependencies:** ROS Melodic+, Eigen3, PCL (Point Cloud Library), OpenMP (for parallel projection).
- **License:** CC BY-NC-SA 4.0 — non-commercial use only. Academic research and internal lab use are within scope; embedded deployment in a commercial product requires a separate license from the IRAP Lab / Ayoung Kim (now at SNU). Current contact for licensing: the repository README lists paulgkim@kaist.ac.kr (verify for SNU affiliation).

### Input Preparation

Two documented input paths:

1. **KITTI-format binary scans + KITTI odometry pose file** (12 numbers per line, 3x4 matrix): the best-documented path and recommended starting point.
2. **SC-LIO-SAM or SC-A-LOAM pose/scan saver**: these tools export KITTI-compatible data from ROS bag files, providing a bridge from live ROS operation to offline Removert processing.

The MulRan dataset (KAIST, Riverside, Sejong sequences) is also documented in the README — same sensors and format as KITTI.

### Key Parameters

| Parameter | Notes |
|---|---|
| `remove_resolution_list` | List of angular resolution values (degrees). More entries = more remove passes. Start: [2.5, 2.0, 1.5] for outdoor 64-channel LiDAR |
| `revert_resolution_list` | List for revert passes. Typically [3.0] or [5.0] — coarser than the finest remove level. Omit for RM3-only (no revert) |
| `epsilon` (range difference threshold) | 0.1–0.2 m for 64-channel LiDARs; 0.2–0.4 m for 32-channel or longer-range sensors |
| Batch size | 50–100 scans per batch (documented recommendation) |
| Scan directory and pose file paths | Must be configured before compilation or via launch file arguments |

Version all parameters alongside the map package. A change in resolution list invalidates previous cleaning runs and requires re-running from raw scans.

### Quality Assurance Workflow

1. Run Removert on the full scan sequence with the chosen configuration (RM3 or RM3+RV1).
2. Inspect the **dynamic submap** (M_dynamic) in CloudCompare or RViz. This should contain vehicle traces, pedestrian clusters, and moving equipment. Obvious static structure in M_dynamic (fences, poles, road markings) indicates over-removal; lower `epsilon` or add a coarser revert pass.
3. Inspect the **static output map** (M_static). Look for ghost trails remaining (vehicles visible as elongated clusters along traversal routes). Residual ghost trails indicate under-removal; raise `epsilon` or remove more aggressively.
4. Cross-check against semantic labels if available (SemanticKITTI-style or LiDAR-MOS output). Use LiDAR-MOS as a pre-filter before Removert: MOS removes obviously moving points online; Removert handles the residual ghost trails that MOS misses (explicitly recommended in the README).
5. Version the cleaned map with the Removert configuration hash and the input pose file version.
6. Do not promote maps to production automatically. Use a map lifecycle approval step: inspect the removed cloud, run a localization residual check on the cleaned map, then gate promotion.

### Integration with Downstream Segmentation

After Removert cleans the map, M_static feeds to a 3D semantic segmentation model (SphereFormer, SPVCNN, SalsaNext, FRNet). Dynamic points removed by Removert should be excluded from the segmentation input. The removed dynamic submap can optionally be passed through a separate dynamic-object classifier if labeled training data for moving classes is needed.

Back-projection of semantic labels from M_static to individual scans S_t uses the same poses T_t that Removert consumed, ensuring geometric consistency between the clean map and the scan-frame labels.

---

## Sources

| Item | URL |
|---|---|
| Removert IROS 2020 (IEEE Xplore) | https://ieeexplore.ieee.org/document/9340856/ |
| Removert author PDF | https://gisbi-kim.github.io/publications/gkim-2020-iros.pdf |
| Removert GitHub (canonical) | https://github.com/irapkaist/removert |
| Removert GitHub (mirror) | https://github.com/gisbi-kim/removert |
| ERASOR paper (arXiv) | https://arxiv.org/abs/2103.04316 |
| ERASOR paper (RA-L DOI) | https://doi.org/10.1109/LRA.2021.3061363 |
| ERASOR GitHub | https://github.com/LimHyungTae/ERASOR |
| ERASOR++ (arXiv) | https://arxiv.org/abs/2403.05019 |
| FreeDOM (arXiv) | https://arxiv.org/abs/2504.11073 |
| BeautyMap (arXiv) | https://arxiv.org/abs/2405.07283 |
| DUFOMap (arXiv) | https://arxiv.org/abs/2403.01449 |
| KTH DynamicMap Benchmark (arXiv) | https://arxiv.org/abs/2307.07260 |
| KTH DynamicMap Benchmark GitHub | https://github.com/KTH-RPL/DynamicMap_Benchmark |
| LT-mapper / LT-removert (ResearchGate) | https://www.researchgate.net/publication/353330570_LT-mapper |
| LT-mapper GitHub | https://github.com/gisbi-kim/lt-mapper |
| Scan Context (IROS 2018) | https://dl.acm.org/doi/10.1109/IROS.2018.8593953 |
| Scan Context GitHub | https://github.com/irapkaist/scancontext |
| MapCleaner (Remote Sensing 2022) | https://www.mdpi.com/2072-4292/14/18/4496 |
| ERASOR2 | https://erasor2.github.io/ |
| Ayoung Kim (SNU faculty) | https://me.snu.ac.kr/en/snu__professor/kim-ayoung/ |
| Semantic Scholar record | https://www.semanticscholar.org/paper/Remove,-then-Revert:-Static-Point-cloud-Map-using-Kim-Kim/0ef63c7e64f6aea9d1ec4d28364f5ccca67c1add |

**BibTeX:**
```bibtex
@INPROCEEDINGS{gskim-2020-iros,
  AUTHOR    = {Giseop Kim and Ayoung Kim},
  TITLE     = {Remove, then Revert: Static Point cloud Map Construction
               using Multiresolution Range Images},
  BOOKTITLE = {Proc. IEEE/RSJ Int. Conf. Intelligent Robots and Systems (IROS)},
  YEAR      = {2020},
  DOI       = {10.1109/IROS45743.2020.9340856}
}
```

**Open questions / uncertainties:**
- No ArXiv preprint confirmed. The IROS 2020 proceedings at IEEE Xplore (DOI 9340856) is the sole citable record.
- The exact `epsilon` values used in the original paper's SemanticKITTI benchmarks are not confirmed from secondary sources. Verify from the IEEE Xplore full text.
- The specific angular resolution values constituting RM3 and RV1 appear in the ERASOR paper's benchmark notation but are not fully documented in the Removert repository itself. Check the ERASOR paper appendix or supplementary material for the exact configuration.
- The repository's last confirmed active commit period is 2021–2022; compatibility with ROS Noetic or ROS 2 has not been verified.
