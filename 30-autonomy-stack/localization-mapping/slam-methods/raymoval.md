# Raymoval

<!-- method-priority:start
priority:
  learning: 4
  deployment: 3
  type: "method"
  stage: "frontier"
  maturity: "research"
  tags: ["slam", "mapping", "validation", "outdoor"]
  reason: "Raymoval is a paper-backed raycasting cleaner for dynamic residuals in static LiDAR maps, useful for partial-FoV visibility checks before production map cleaning."
method-priority:end -->

Related docs: [LiDAR Map Cleaning and Dynamic Removal](lidar-map-cleaning-dynamic-removal.md), [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md), [Removert](removert.md), [ERASOR](erasor.md), [ERASOR++](erasor-plus-plus.md), [BeautyMap](beautymap.md), [FreeDOM](freedom-dynamic-object-removal.md), [Static-But-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md).

**Last updated:** 2026-05-24

---

## What It Is

Raymoval is a paper-backed dynamic-object-removal method for static 3D LiDAR mapping. Its full title is "Raymoval: Raycasting-based Dynamic Object Removal for Static 3D Mapping." The paper was submitted to arXiv on 2026-05-09 and is listed as presented at RiTA 2025.

Raymoval belongs to the visibility/raycasting family next to [Removert](removert.md). It compares a current scan against the first occupied map point along the same viewing direction. If a scan point lies in front of the map's first-hit distance, the map evidence behind it is likely inconsistent with the current free-space observation and can be marked as a dynamic residual.

Treat Raymoval as a **research-frontier cleaner**, not as a deployment default:

| Item | Status |
|---|---|
| Paper | RiTA 2025 / arXiv 2605.08937v1, submitted 2026-05-09 |
| Code | No official public implementation found in this pass |
| Benchmark | SemanticKITTI PR/RR/F1 against OctoMap, Peopleremover, Removert, and ERASOR |
| Production status | Paper-only; no reproducible package, license, issue history, or target-site validation |

---

## Core Technical Idea

Raymoval replaces Removert-style range-image comparison with an azimuth-elevation raycasting representation:

1. Project each LiDAR scan into a uniform azimuth-elevation grid.
2. Transform each viewing direction into the map frame using the scan pose.
3. Raycast through a prior voxelized map and store the first-hit distance for each direction.
4. Compare the nearest scan range in each bin with a lower-quantile first-hit map reference from a small neighboring window.
5. Use a range-adaptive margin to mark foreground inconsistencies as dynamic candidates.
6. Refine candidates with spatial consistency validation so thin structures and boundary points are not over-removed.

The design goal is to preserve per-ray visibility consistency while improving robustness to partial field of view, self-occlusion, and boundary fragmentation. The paper's custom construction-site experiment is qualitative, but it is important because it uses a solid-state LiDAR setup where omnidirectional assumptions become brittle.

---

## Inputs and Outputs

| Interface | Required fields | Notes |
|---|---|---|
| Registered scans | Deskewed LiDAR scans, timestamps, poses in a common map frame | Pose quality is a hard dependency; drift creates false visibility contradictions. |
| Prior map | Voxelized map candidate and occupied voxel boundaries | The map is the raycasting target for first-hit distances. |
| Sensor model | Azimuth/elevation bounds, range limit, angular bins | Paper reports grid size `(720, 450)` and range limit `60 m`. |
| Raycasting parameters | Voxel size, neighborhood window, lower quantile, range margin | Paper reports `0.2 m` voxel size and fixed parameters across datasets. |
| Spatial validation | Range-adaptive clustering, group-wise reclassification, dilated static-map support | Restores fragments, thin structures, and supported boundary regions. |
| Output labels | Static/dynamic point labels | Use as a map-cleaning decision layer, not as runtime obstacle clearance. |
| Clean map | Static-map candidate with dynamic residuals removed | Preserve rejected points for QA and false-deletion review. |

---

## Pipeline

```text
Input:
  - Prior voxelized map M
  - Registered scan S_i
  - Pose T_i from scan frame to map frame

1. Project S_i to an azimuth-elevation grid.
2. Raycast from the scan origin through M and cache the first-hit distance per grid bin.
3. For each scan bin, compute a robust map reference from neighboring first-hit distances.
4. Compare nearest scan range against the map reference with a range-adaptive margin.
5. Mark foreground inconsistencies as dynamic candidates.
6. Cluster candidates using range-adaptive size/diameter thresholds.
7. Reclassify groups that overlap a dilated static map or look like thin supported structures.
8. Export static/dynamic labels, cleaned map, rejected layer, and parameter provenance.
```

---

## Benchmark Evidence

Raymoval reports SemanticKITTI results using the ERASOR-lineage preservation rate (PR), rejection rate (RR), and F1 metrics. The five evaluated segments are sequences 00, 01, 02, 05, and 07.

| Metric | Raymoval avg | ERASOR avg | Removert RM3+RV1 avg | Interpretation |
|---|---:|---:|---:|---|
| PR [%] | 93.217 | 90.510 | 50.700 | Raymoval preserves more static map structure than the compared baselines in this table. |
| RR [%] | 92.566 | 97.401 | 82.310 | ERASOR rejects more dynamic residuals on average. |
| F1 | 0.927 | 0.938 | 0.836 | Raymoval beats ERASOR on seq 02 and 05, but not on average. |

Reported Raymoval runtime is 93.83 ms per scan on a single Intel Core i9-13900 CPU thread, or about 10.6 Hz. The raycasting cache dominates runtime at 87.11 ms, roughly 92.9 percent of total processing time.

Benchmark caveats:

- Raymoval is **not** currently included in the KTH DynamicMap Benchmark method list.
- Raymoval PR/RR/F1 should not be ranked directly against KTH/DUFOMap/BeautyMap SA/DA/AA/HA results.
- FreeDOM also reports PR/RR/F1-style numbers, but with an independent evaluator and dataset setup; do not treat FreeDOM and Raymoval numbers as one shared leaderboard without rerunning under one protocol.
- The custom partial-FoV construction-site result is qualitative in the paper and should not be cited as a public numeric benchmark.

---

## Fit in the Aggregated-Map Segmentation Pipeline

Raymoval is a map-conditioning option before aggregated-map semantic segmentation:

```text
registered scans -> raycasting dynamic-residual cleaner -> artifact filters -> tiling -> segmenter
```

It is useful when the map contains ghost trails or dynamic residual points that later scans provide free-space evidence against. It is especially relevant to a cleaner-comparison matrix where [Removert](removert.md), [ERASOR](erasor.md), [BeautyMap](beautymap.md), [FreeDOM](freedom-dynamic-object-removal.md), and [DUFOMap](rtmap-dufomap-recursive-maintenance.md) disagree.

It does **not** solve static-but-transient map policy. Parked vehicles, staged equipment, stationary people, aircraft, cones, barriers, or FOD can remain if they never generate a free-space contradiction during the survey. Route those cases through [Static-But-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [Potentially Dynamic Object Removal by Ground Projection](potentially-dynamic-object-removal-ground-projection.md), and [Lifelong 3D Map Version Control](lifelong-3d-map-version-control.md).

---

## Domain Fit

| Domain | Fit | Reason |
|---|---|---|
| Road AV mapping | Strong research fit | SemanticKITTI evaluation directly matches road mobile mapping with moving vehicles and pedestrians. |
| Urban district / outdoor campus | Strong candidate | Ghost trails, partial FoV, and changing pedestrian/vehicle occupancy match the visibility-cleaning problem. |
| Airside apron mapping | Useful but unproven | Moving GSE/personnel/aircraft residuals fit the method, but no target-airside or FOD evidence is public. |
| Warehouse / logistics yard / port | Conditional | Good for movers observed absent; parked forklifts, pallets, trailers, or containers require static-transient policy. |
| Construction / mining | Conditional | Qualitative construction-site result is relevant, but rough terrain, occlusion, and pose drift need local validation. |
| Agriculture / vegetation-heavy off-road | Weak to conditional | Vegetation and deformable surfaces can violate static-map assumptions and produce ambiguous support. |

---

## Failure Modes

| Failure mode | What happens | Mitigation |
|---|---|---|
| Pose or map registration error | Static map points appear inconsistent with the scan and may be removed. | Run after SLAM QA; gate on loop residuals, scan-matching inliers, and control-point error. |
| Static-but-transient objects | Parked or staged movable objects remain because no scan ray traverses their occupied space. | Use semantic quarantine, detector-ground projection, or multi-session map versioning. |
| Thin static structures | Poles, fences, signs, cables, chocks, and cones can be mistaken for fragments. | Review rejected layers; use spatial validation and class-specific false-deletion holdouts. |
| Partial-FoV overclaim | The paper qualitatively demonstrates partial-FoV robustness but does not provide a public numeric partial-FoV benchmark. | Treat solid-state support as promising, not production-proven. |
| Runtime bottleneck | Raycasting cache dominates CPU runtime. | Cache map rays by tile/pose where safe; profile on target map size before adopting. |
| Metric mixing | PR/RR/F1 can be compared incorrectly with KTH SA/DA/HA or FreeDOM independent F1. | Use one evaluator for leaderboard claims; keep per-paper tables separate. |
| Paper-only maturity | No public official code or release process is available. | Reimplement only as a research baseline; log assumptions, tests, and license/provenance separately. |

---

## Implementation Notes

1. Keep raw, cleaned, and rejected point layers together. A dynamic-cleaner output without rejected evidence is not reviewable.
2. Store the map hash, scan-pose source, voxel size, angular grid, range limit, quantile/window settings, margin rule, and spatial-validation thresholds in the map manifest.
3. Reproduce the paper's SemanticKITTI split before using Raymoval as a baseline in a local benchmark.
4. Compare against at least one conservative cleaner and one high-recall cleaner. Raymoval's profile is higher static preservation but lower average dynamic rejection than ERASOR in Table 2.
5. For aggregated-map segmentation, score rare static classes after cleaning. Improved ghost removal is not acceptable if poles, markings, FOD candidates, barriers, or low-profile safety objects disappear.
6. Keep Raymoval out of production-default wording until an official implementation or independent benchmark integration exists.

---

## Sources

| Source | URL | Notes |
|---|---|---|
| Raymoval arXiv | https://arxiv.org/abs/2605.08937 | Metadata, submission date, title, authors, comments, DOI routing. |
| Raymoval HTML | https://arxiv.org/html/2605.08937v1 | Method details, SemanticKITTI Table 2, runtime Table 3, custom dataset discussion. |
| KOASAS record | https://koasas.kaist.ac.kr/handle/10203/339232 | KAIST repository record and RiTA 2025 indexing. |
| KTH DynamicMap Benchmark | https://kth-rpl.github.io/DynamicMap_Benchmark/ | Current supported-method list and metric lineage context; Raymoval not listed as of this pass. |
| Local benchmark context | dynamic-map-cleaning-benchmarks.md | PR/RR/F1 versus SA/DA/HA caveats and cross-method comparison notes. |
