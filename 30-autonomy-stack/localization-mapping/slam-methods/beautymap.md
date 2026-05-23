# BeautyMap

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "deployment-pattern"
  maturity: "prototype"
  tags: ["slam", "mapping", "validation", "runtime-localization", "outdoor"]
  reason: "BeautyMap is rated as a fast, training-free dynamic-point removal method for conditioning static LiDAR maps before localization, map QA, and semantic segmentation."
method-priority:end -->

Related docs: [LiDAR Map Cleaning and Dynamic Removal](lidar-map-cleaning-dynamic-removal.md), [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md), [Raymoval](raymoval.md), [ERASOR](erasor.md), [ERASOR++](erasor-plus-plus.md), [Removert](removert.md), [MapCleaner](mapcleaner.md), [FreeDOM](freedom-dynamic-object-removal.md), [DR-Remover](dr-remover.md), [Static-But-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [LiDAR Artifact Removal Techniques](../../perception/overview/lidar-artifact-removal-techniques.md).

**Last updated:** 2026-05-23

---

## What It Is

BeautyMap is a 2024 RA-L dynamic-point removal method for global point-cloud maps. Its full title is "BeautyMap: Binary-Encoded Adaptable Ground Matrix for Dynamic Points Removal in Global Maps." The method is training-free, offline, and intended to remove dynamic-object ghost tracks from an already registered global LiDAR map while preserving static structure for localization and planning.

The key design move is to compress vertical occupancy columns into binary-encoded 2D matrices. Instead of raycasting every voxel or projecting each global-map point into an egocentric range image, BeautyMap compares a scan matrix against the corresponding global-map submatrix with bitwise operations, then applies coarse-to-fine ground handling and static restoration.

This makes BeautyMap useful in the aggregated-map semantic segmentation pipeline: it is a fast conditioning stage before "clean -> condition -> segment". It should be evaluated against ERASOR, Removert, FreeDOM, DUFOMap, MapCleaner, and any site-specific movable-object quarantine branch before publishing a map layer.

Source maturity:

| Item | Status |
|---|---|
| Paper | IEEE RA-L 2024 / arXiv 2405.07283 |
| Code | Official Python repository: `github.com/MKJia/BeautyMap` |
| Benchmark routing | Included in the KTH DynamicMap Benchmark method family |
| Deployment status | Research prototype, not production-certified |

---

## Core Technical Idea

BeautyMap asks a simple question in global-map coordinates: does the current scan support the vertical occupancy pattern stored in the map at this XY location?

It stores each map column as a binary number over height bins. A bit is set when any point occupies that height layer. A scan is encoded the same way after being transformed into the global frame. A bitwise comparison then highlights height bins that exist in the global map but are absent in the current scan. Those bins are candidate dynamic residuals.

The method adds two safeguards around this fast comparison:

1. **Adaptable ground matrix:** the base height of each vertical column is adjusted from neighboring low points, so slopes and uneven terrain do not get treated as floating dynamic objects.
2. **Static restoration:** visibility masks and reverse virtual ray casting protect static points that the current scan simply could not see. This is the over-removal guard.

The result is a differential map cleaner with a global coordinate representation. It is adjacent to ERASOR/ERASOR++ because it reasons about vertical occupancy, but it is more matrix-oriented and less egocentric. It is adjacent to Removert/[Raymoval](raymoval.md) because it uses visibility restoration, but it does not make raycasting the main detection mechanism.

---

## Inputs and Outputs

| Interface | Required fields | Notes |
|---|---|---|
| Global point-cloud map | Registered static-map candidate, map frame, voxel/grid settings | Built by SLAM or multi-session registration before BeautyMap runs. |
| Per-scan point clouds | Raw or deskewed LiDAR scans, timestamps, poses into map frame | The method compares each scan to the corresponding global-map region. |
| Grid parameters | XY cell size, height-bin resolution, distance range | Paper examples use KITTI and semi-indoor settings; tune under local validation. |
| Ground adaptation | Neighbor low-point statistics and hierarchical height resolution | Prevents terrain thickness and slope from becoming false dynamic evidence. |
| Visibility restoration | LiDAR FoV, highest observed column, reverse virtual ray casting | Restores map points that are outside the current scan's visible support. |
| Output labels | Static/dynamic decision for map points or regions | Use as a rejected dynamic layer, not as a runtime obstacle-clearance decision. |
| Clean map | Filtered point cloud for localization, QA, and segmentation | Should retain raw/rejected evidence for false-deletion review. |

---

## Pipeline

```text
Input:
  - Global point-cloud map M
  - Registered LiDAR scans S_i
  - Poses T_i from each scan to the map frame

1. Encode the global map:
   - Partition XY into grid cells.
   - For each cell, encode vertical occupancy bins into a binary column.
   - Store the columns as a 2D matrix over the map.

2. Adapt the ground reference:
   - Estimate coarse ground cells from neighboring low points.
   - Shift each column's starting height to match local terrain.
   - Re-encode ground-adjacent regions at finer vertical resolution.

3. Encode each query scan:
   - Transform scan points into the global frame.
   - Build the query matrix over the same grid support.

4. Detect candidate dynamic regions:
   - Compare query and map matrices with bitwise operations.
   - Mark map regions that are present in M but unsupported by S_i.

5. Recover near-ground dynamics:
   - Use fine ground segmentation to separate low dynamic objects from thick ground bands.

6. Restore static points:
   - Protect regions outside the scan's visible support.
   - Use reverse virtual ray casting to avoid deleting occluded static cells.

7. Export:
   - Cleaned map.
   - Dynamic/rejected layer.
   - Parameters and scan/map provenance for validation replay.
```

---

## Benchmark Evidence

BeautyMap reports point-level Static Accuracy (SA), Dynamic Accuracy (DA), and Harmonic Accuracy (HA). These are the KTH/DUFOMap/BeautyMap-lineage metrics, not the ERASOR/Raymoval voxel-wise PR/RR/F1 metrics.

Representative reported results from BeautyMap Table I:

| Dataset | SA [%] | DA [%] | HA [%] | Notes |
|---|---:|---:|---:|---|
| KITTI 00 | 96.76 | 98.38 | 97.56 | VLP-64, SemanticKITTI-derived labels |
| KITTI 01 | 99.17 | 92.99 | 95.98 | Runtime table uses this sequence |
| KITTI 05 | 96.34 | 98.29 | 97.31 | Strong dynamic removal on the reported road sequence |
| Semi-indoor | 93.69 | 90.67 | 92.16 | VLP-16 semi-indoor benchmark |

The paper reports 0.046 seconds per point cloud on KITTI sequence 01 with an Intel i9-12900KF CPU, faster than the comparison rows for Removert, ERASOR, OctoMap, OctoMap with ground filtering, and Dynablox in that paper's Table II.

Benchmark caveat:

- BeautyMap's SA/DA/HA values should be compared with KTH/DUFOMap/BeautyMap-style point-level evaluations.
- Do not directly rank BeautyMap's HA against Raymoval's PR/RR/F1 or FreeDOM's independent voxel-wise F1 unless all methods are rerun under the same poses, split, voxelization, and evaluator.
- The public benchmarks remain road, campus, and semi-indoor proxies. They do not prove airport-apron performance on aircraft-scale movable objects, chocks, FOD, wet-apron multipath, or GSE staging.

---

## Comparison With Adjacent Cleaners

| Method | Primary evidence | Strength relative to BeautyMap | Weakness relative to BeautyMap |
|---|---|---|---|
| ERASOR | Egocentric pseudo-occupancy ratio | Mature baseline, strong dynamic rejection | More static over-removal in some settings; ground recovery is a separate step. |
| ERASOR++ | Height-coded pseudo-occupancy | Better vertical structure than ERASOR | Paper comparison scope is mostly ERASOR-family, not a unified benchmark against BeautyMap. |
| Removert | Range-image remove-then-revert | Clean visibility logic and open implementation | Lower DA/HA in BeautyMap's reported KTH-style comparison. |
| FreeDOM | Conservative free-space with online and back-end stages | More sensor-agnostic and stronger on non-flat/stair-like settings in its own paper | Not in KTH benchmark; heavier ray/free-space state machinery. |
| MapCleaner | Terrain-first cumulative voting | Strong multi-scan evidence idea | No official implementation and no KTH inclusion as of this refresh. |
| DR-Remover | Dual-resolution occupancy grids | Adjacent coarse/fine count-grid branch | Less public benchmark visibility and runtime detail than BeautyMap. |
| [Raymoval](raymoval.md) | Az-el raycasting and spatial validation | Current 2026 paper; handles partial-FoV concerns qualitatively | Paper-only; uses different PR/RR/F1 harness, so do not rank directly against BeautyMap. |

---

## Fit in the Aggregated-Map Segmentation Pipeline

BeautyMap is a good candidate for the **conditioning** stage before map-scale semantic segmentation:

```text
registered scans -> dynamic map cleaner -> artifact filters -> normals/intensity -> tiling -> segmenter
```

Why it fits:

- It is offline and map-scale, matching depot/cloud survey processing rather than runtime obstacle avoidance.
- It is training-free, avoiding a domain-labeling dependency before the first semantic map exists.
- It is fast enough to include in local ablation sweeps across cell sizes and cleanup policies.
- It produces a clean-map candidate that can be compared against ERASOR/FreeDOM disagreement regions before annotation or pseudo-label export.

What it does not solve:

- Stationary people, parked GSE, aircraft, cones, barriers, or FOD that never move during the survey can still look like valid static structure. Route those through [Static-But-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [Potentially Dynamic Object Removal by Ground Projection](potentially-dynamic-object-removal-ground-projection.md), and [Lifelong 3D Map Version Control](lifelong-3d-map-version-control.md).
- It does not replace adverse-weather artifact filtering. Dust, snow, rain, retroreflector bloom, and wet-apron multipath belong in the LiDAR artifact-removal and validation path.
- It is not runtime free-space evidence. A cleaned static map can support localization and annotation, but it cannot certify that a real-time scene is clear.

---

## Domain Fit

| Domain | Fit | Reason |
|---|---|---|
| Road AV mapping | Strong research fit | KITTI-style evidence matches mobile mapping with dynamic vehicles and pedestrians. |
| Airside apron mapping | Useful but unproven | Good for removing moving GSE/personnel trails before segmentation; needs local holdouts for FOD, chocks, staged equipment, aircraft, and adverse weather. |
| Urban district / non-road campus | Strong candidate | Large static maps, mixed pedestrians/vehicles, and repeated survey passes match the intended global-map use. |
| Warehouse / indoor logistics | Conditional | Semi-indoor result is encouraging, but ramps, racks, pallets, and forklifts require stationary-transient policy. |
| Ports, mines, construction | Conditional | Dynamic heavy equipment creates ghost trails, but non-flat terrain and temporary infrastructure need local validation. |
| Agriculture/off-road | Weak to conditional | Vegetation and ground variation stress the ground-matrix assumptions; validate before adopting. |

---

## Failure Modes

| Failure mode | What happens | Mitigation |
|---|---|---|
| Pose or registration error | The scan matrix and map matrix disagree for the wrong reason, creating false dynamic candidates. | Run after SLAM QA; inspect residuals and loop-closure consistency before cleaning. |
| Ground discontinuities | Curbs, ramps, loading docks, drainage channels, and stairs can break the ground adaptation. | Add terrain class masks, local slope tests, and disagreement review against FreeDOM or ERASOR++. |
| Occlusion/out-of-sight ambiguity | Static points may be absent from the current scan because they are occluded, not dynamic. | Keep static restoration enabled and preserve the rejected layer for manual review. |
| Stationary movable objects | Parked or staged objects remain in the map if never observed absent. | Use semantic quarantine, multi-session version control, or detector-ground projection. |
| Thin static structures | Poles, fences, signs, wires, blast screens, and railings can be eroded by coarse grid settings. | Validate per-class recall and run false-deletion tests on thin-structure holdouts. |
| Metric mismatch | HA/SA/DA gets compared to PR/RR/F1 from other papers. | Use the benchmark page; rerun under one evaluator before claiming ranking. |
| Airport direct-data gap | Public road/semi-indoor datasets miss airside adverse slices and FOD hazards. | Treat public benchmark wins as proxy screening only; require target-site holdouts before release. |

---

## Implementation Notes

1. Keep raw, cleaned, and rejected maps side by side. A clean map without rejected evidence is not reviewable.
2. Log the scan poses, map hash, XY cell size, height-bin resolution, distance range, and static-restoration settings into the semantic-map manifest.
3. Run BeautyMap as one cleaner in an ablation matrix, not as a single source of truth. Compare disagreement regions against ERASOR/ERASOR++, FreeDOM, and detector/quarantine outputs.
4. Score false deletion as seriously as false retention. Removing a pole, chock, cone, hose, FOD item, or low barrier can damage localization or hide a safety-relevant object.
5. For aggregated-map segmentation, rerun tile mIoU and boundary metrics after cleaning. A cleaner that improves visual map quality can still erase rare classes and reduce safety-class recall.
6. Do not treat the official Python repository as production software. Review dependencies, data format assumptions, runtime bounds, license, and reproducibility before operational use.

---

## Sources

| Source | URL | Notes |
|---|---|---|
| BeautyMap arXiv | https://arxiv.org/abs/2405.07283 | Paper metadata, submission date, abstract, and code link. |
| BeautyMap HTML | https://arxiv.org/html/2405.07283v1 | Method details, Table I SA/DA/HA, Table II runtime, and ablations. |
| Official BeautyMap repository | https://github.com/MKJia/BeautyMap | Python implementation, setup/run examples, data links, and citation. |
| KTH DynamicMap Benchmark | https://kth-rpl.github.io/DynamicMap_Benchmark/ | Benchmark method routing; includes BeautyMap as an offline prior-map method. |
| KTH DynamicMap Benchmark repo | https://github.com/KTH-RPL/DynamicMap_Benchmark | Evaluation scripts and reproducible benchmark context. |
| Local benchmark context | dynamic-map-cleaning-benchmarks.md | Metric definitions and cross-method caveats. |
