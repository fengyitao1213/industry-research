# Lifelong 3D Map Version Control

<!-- method-priority:start
priority:
  learning: 4
  deployment: 5
  type: "architecture-pattern"
  stage: "deployment-pattern"
  maturity: "pilot-proven"
  tags: ["slam", "mapping", "validation", "runtime-localization", "outdoor"]
  reason: "Lifelong 3D Map Version Control is rated for multi-session LiDAR map governance, positive/negative change reconstruction, and static-map lifecycle workflows."
method-priority:end -->

Related docs: [LT-Mapper, Khronos, and Lifelong Mapping](lt-mapper-khronos-lifelong-mapping.md) · [RTMap, DUFOMap, and Recursive Map Maintenance](rtmap-dufomap-recursive-maintenance.md) · [LiDAR Map Cleaning and Dynamic Removal](lidar-map-cleaning-dynamic-removal.md) · [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md) · [Static-But-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md) · [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [HD-Map Change Detection and Maintenance](../maps/hd-map-change-detection-maintenance.md) · [Map Construction Pipeline](../maps/map-construction-pipeline.md)

**Last updated:** 2026-05-23

---

## What It Is

Lifelong 3D map version control is a backend architecture for maintaining a clean 3D LiDAR map across many mapping sessions without storing every raw input map as a separate product. The reference system is Yang et al., "Lifelong 3D Mapping Framework for Hand-held & Robot-mounted LiDAR Mapping Systems" (IEEE RA-L 2024, arXiv 2501.18110). It combines four modules:

1. Sensor-setup agnostic dynamic point removal.
2. Multi-session map alignment.
3. Positive and negative map-change detection.
4. A version-control store that keeps the current base map plus change and boundary artifacts.

This is not a replacement for [LT-Mapper, Khronos, and Lifelong Mapping](lt-mapper-khronos-lifelong-mapping.md). It fills a different architectural gap: a cloud-native, source-agnostic way to update a base point-cloud map, reconstruct earlier clean session maps, and query differences between arbitrary sessions without keeping all original session maps online.

## Why It Matters for Aggregated LiDAR Maps

An aggregated LiDAR semantic map is only useful if the map product has a clear lifecycle. The segmentation model can label points, but it cannot decide by itself whether a vanished car should delete part of the localization map, whether a newly appeared barrier should become permanent, or whether an occluded wall should remain in the base map until a later survey confirms it.

Version control creates that missing control plane:

- **Base map:** the current clean static map used by localization, annotation, and map QA.
- **Positive differences:** new observed geometry that may represent construction, moved assets, new signs, vegetation growth, or temporary clutter.
- **Negative differences:** geometry that disappeared from the base map and may represent removed clutter, changed infrastructure, or occluded regions.
- **Boundary records:** per-session spatial coverage used to reconstruct old session maps and avoid deleting areas that were not actually observed.
- **Manifest metadata:** session ID, sensor rig, SLAM front end, alignment residuals, cleaner parameters, semantic taxonomy version, policy version, and approval state.

For urban districts that are not conventional road environments - campuses, plazas, logistics yards, airport aprons, depots, construction areas, industrial parks - this matters more than lane-centric HD-map updates. The world changes through parked equipment, work zones, temporary fences, vegetation, movable furniture, pedestrians, vendor stands, and maintenance assets. A base-map plus diff-store architecture lets those changes be reviewed, reverted, and queried instead of silently overwriting the map.

## Pipeline Contract

```text
session maps + poses
  -> dynamic point removal
  -> clean session maps
  -> multi-session alignment
  -> positive/negative change detection
  -> base map + diff store + boundary records
  -> reconstructable map versions + change queries
```

### 1. Dynamic Point Removal

The RA-L framework starts by creating cleaner static session maps before alignment. The published pipeline uses OctoMap-style static/dynamic/unknown separation, plane regression to restore planar structures such as ground and building facades, K-nearest-neighbor voting for unknown points, statistical outlier removal, and radial filtering. This choice is important because the framework targets both hand-held LiDAR mapping devices and robot-mounted LiDAR SLAM logs. It avoids assumptions that break when the sensor is not mounted horizontally on a vehicle.

For AV-style deployment, this dynamic-removal block can be replaced or supplemented with ERASOR++, FreeDOM, DUFOMap, MapCleaner, STATIC-LIO, MOVES, or a learned MOS model. The version-control architecture is the larger contract: every cleaner must emit not only a cleaned map but also rejected-point evidence and its confidence.

### 2. Multi-Session Alignment

The framework aligns incoming clean maps into the base-map reference frame using a two-stage registration strategy:

- Extract keypoints and PCA-SHOT descriptors from downsampled point clouds.
- Use RANSAC to form an initial alignment from descriptor matches.
- Refine with Normal Distributions Transform (NDT).
- Select the best hyperparameter configuration by Chamfer-distance quality.

The design is a practical alternative when Scan Context loop closure is weak or brittle, for example in repetitive parking structures, plazas with weak vertical texture, airside stands with repeated ground markings, or facility interiors where range-image descriptors produce false loop constraints.

### 3. Positive and Negative Change Detection

After alignment, the system computes:

- **Positive difference (PD):** geometry present in the incoming session and absent from the current base map.
- **Negative difference (ND):** geometry present in the current base map and absent from the incoming session.

The paper uses spatial filtering and bird's-eye-view descriptors to detect positive and negative changes. The reported mean precision/recall across XGrid-Outdoor, LT-ParkingLot, XGrid-Parking, and MulRan DCC favors the proposed method over KNN and PCL octree baselines, with mean PD precision 0.885 and mean ND precision 0.920.

For aggregated-map semantic segmentation, PD and ND should not be treated as automatic map edits. They are review candidates:

- PD could be new permanent infrastructure, a parked vehicle, a temporary barrier, staged equipment, vegetation growth, a crowd, or a scanning artifact.
- ND could be true removal, occlusion, missed scan coverage, localization drift, vegetation trimming, or a previously parked object leaving.

### 4. Version-Control Store

The core store keeps:

| Artifact | Purpose |
|---|---|
| Current base map | The latest accepted clean map state. |
| Positive diffs | New geometry that appeared in an incoming session. |
| Negative diffs | Geometry that disappeared from the previous base map. |
| Session boundaries | Spatial crop/coverage records used to reconstruct previous clean maps. |
| Alignment report | Transform, residuals, overlap, and failure flags. |
| Cleaner report | Dynamic-removal method, thresholds, rejected-point layer, and preservation metrics. |
| Semantic/policy manifest | Taxonomy version, movable-object policy, FOD policy, and approval state. |

Yang et al. report that this representation can reconstruct previous clean session maps and query changes between sessions without storing all raw session maps. On 27 NCLT maps, the paper reports 94.2% storage efficiency after downsampling, illustrating why this pattern matters for fleet-scale and city-scale map operations.

## Inputs and Outputs

| Interface | Required fields | Notes |
|---|---|---|
| Input session map | Point cloud, keyframe poses, frame provenance, sensor rig metadata | Can come from hand-held mapping, robot-mounted SLAM, or survey vehicles. |
| Cleaner input | Raw or accumulated points, poses, optional dynamic masks, optional semantic masks | Cleaner must preserve enough evidence for audit. |
| Alignment input | Clean incoming map, base map, keypoint/downsampling settings | Requires overlap and stable static structure. |
| Change input | Aligned clean map pair and valid coverage boundaries | Must distinguish "not observed" from "observed empty". |
| Base-map output | Accepted static point cloud in the canonical frame | Used by localization, segmentation, annotation, and QA. |
| Diff output | PD, ND, boundary, and metadata artifacts | Needed for rollback, reconstruction, and review. |
| Review output | Accepted, rejected, quarantined, or pending change states | Prevents silent publication of transient objects or false deletions. |

## Static-But-Wrong Map Policy

Version control is the correct control plane for points that are static during one survey but wrong for the long-term map:

| Problem | Version-control handling |
|---|---|
| Dynamic residual points | Cleaner rejects them before base-map alignment; evidence is retained for QA. |
| Stationary people | Semantic or detector policy keeps them out of the permanent base map even if no free-space contradiction exists. |
| Parked vehicles or GSE | Positive evidence enters a movable-static quarantine state unless ops policy explicitly promotes the class. |
| Chocks, cones, tools, debris | Route to FOD/hazard review instead of permanent-map promotion or silent deletion. |
| Construction barriers | Keep as temporary restriction or work-zone layer until work-order policy promotes or expires it. |
| Occluded permanent structure | Boundary records prevent deletion unless the region was actually observed and contradiction is persistent. |

The key rule is that map version control should never collapse all changed geometry into one "update" operation. It must preserve why the point changed, how it was observed, whether the class is movable, and which policy authorized publication.

## Domain Fit

| Domain | Fit | Why |
|---|---|---|
| Urban road AV | Strong | Multi-session road surveys need rollback, diff inspection, and construction/change review. |
| Non-road urban districts | Strong | Plazas, campuses, depots, and pedestrian zones have many temporary static objects and irregular routes. |
| Airport airside | Strong with domain taxonomy | Aircraft, GSE, cones, chocks, FOD, and stand equipment require policy-aware quarantine. |
| Warehouse and logistics yard | Strong | Pallets, forklifts, racks, and parked trailers change slowly and need versioned lifecycle state. |
| Mining/construction/agriculture | Conditional | Large terrain changes are real map edits, but dust, machines, piles, and vegetation need careful class policy. |
| Indoor robot mapping | Strong | Hand-held and robot-mounted LiDAR support is directly relevant; multi-floor boundaries need extra metadata. |

## Failure Modes

| Failure mode | Effect | Mitigation |
|---|---|---|
| Weak inter-session overlap | Bad alignment creates false PD/ND changes | Minimum-overlap gate, residual heatmap, manual GCP/RTK constraints. |
| Descriptor aliasing | Repetitive structures create false alignment | Cross-check PCA-SHOT/NDT with Scan Context, GNSS, IMU priors, and loop-closure consistency. |
| Cleaner false deletion | Static features disappear from the base map | Preserve rejected layer, run localization regression, and require false-deletion tests. |
| Cleaner false retention | Dynamic residuals enter the base map | Run map-cleaning benchmark metrics and semantic quarantine before segmentation. |
| Occlusion treated as deletion | Unobserved areas are removed | Require coverage/boundary evidence and explicit observed-empty support. |
| Class policy drift | Movable classes are promoted after taxonomy changes | Version the semantic taxonomy and map-publication policy in every manifest. |
| Diff-store bloat | Small noisy diffs dominate storage and review | Cluster, tile, threshold by evidence, and expire low-confidence pending changes. |
| Rollback cannot reconstruct semantics | Geometry can roll back but labels cannot | Store semantic label version, confidence, annotator/model ID, and tile-level label diffs. |

## Implementation Notes

1. Treat the map store like a release artifact, not a scratch point cloud. Every tile needs a manifest that says which base-map version, cleaner, segmenter, taxonomy, and policy produced it.
2. Keep rejected dynamic points and quarantined movable-static objects in separate layers. They are not trash; they are evidence for debugging, FOD review, and policy audits.
3. Compute map diffs after alignment but before semantic-map publication. Segmentation should consume a conditioned map plus quarantine layers, not a single overwritten cloud.
4. Use tile-local diffs for city-scale operation. A global monolithic base map makes review, rollback, and cache invalidation too expensive.
5. Require localization regression before publication. A visually cleaner map can still reduce scan-to-map convergence if it removes poles, edges, walls, curb faces, or high-return reflectors.
6. For non-road urban districts, include non-vehicle class policy: kiosks, planter boxes, bollards, benches, temporary fencing, market stalls, crowds, and construction materials.

## What It Adds Beyond LT-Mapper and Khronos

| System | Main contribution | Gap filled by this page |
|---|---|---|
| LT-Mapper | Modular LiDAR lifelong mapping with LT-SLAM, LT-Removert, and LT-Map | Strong lifelong mapping baseline, but less explicit as a cloud map-version-control artifact contract. |
| Khronos | 4D spatio-temporal metric-semantic SLAM with object lifecycle reasoning | Strong online/near-field temporal semantics, but not a direct point-cloud version-control store for arbitrary session maps. |
| Yang et al. framework | Sensor-setup agnostic cleaning, PCA-SHOT/NDT alignment, PD/ND detection, and base-map/diff/boundary storage | Explicit reconstructable map history and change-query architecture for hand-held and robot-mounted LiDAR maps. |

## Deployment Readiness

Use this architecture when any of the following are true:

- Multiple mapping sessions are expected before a tile is published.
- The map must support rollback or reconstruction of previous clean session states.
- Movable-static objects are common and should be quarantined rather than overwritten.
- A semantic segmentation pipeline needs a stable, reviewable static-map input.
- Storage or review burden makes full raw-session retention impractical.

Do not use it as a substitute for safety review. The version-control store makes changes inspectable; it does not prove that a change is safe to publish.

## Sources

- Yang, Prakhya, Zhu, and Liu, "Lifelong 3D Mapping Framework for Hand-held & Robot-mounted LiDAR Mapping Systems," IEEE RA-L 2024 / arXiv 2501.18110: https://arxiv.org/abs/2501.18110
- arXiv HTML full text for module details, evaluation, PD/ND metrics, and memory-efficiency results: https://arxiv.org/html/2501.18110
- LT-Mapper baseline: https://arxiv.org/abs/2107.07712
- Khronos RSS 2024: https://arxiv.org/abs/2402.13817
- NCLT dataset reference used in the evaluation: https://robots.engin.umich.edu/nclt/
