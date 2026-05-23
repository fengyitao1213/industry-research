# Uni-Mapper Dynamic-Aware LiDAR Map Merging

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "deployment-pattern"
  maturity: "prototype"
  tags: ["slam", "mapping", "validation", "runtime-localization", "outdoor"]
  reason: "Uni-Mapper is rated for heterogeneous-LiDAR multi-map merging where dynamic residuals, loop closure, and map alignment must be handled together."
method-priority:end -->

Related docs: [LAMM Multi-Session Point-Cloud Map Merging](lamm-multi-session-point-cloud-map-merging.md) · [MapEval Point-Cloud Map-Quality Evaluation](mapeval-point-cloud-map-quality-evaluation.md) · [LT-Mapper, Khronos, and Lifelong Mapping](lt-mapper-khronos-lifelong-mapping.md) · [Lifelong 3D Map Version Control](lifelong-3d-map-version-control.md) · [LiDAR Map Cleaning and Dynamic Removal](lidar-map-cleaning-dynamic-removal.md) · [Potentially Dynamic Object Removal by Ground Projection](potentially-dynamic-object-removal-ground-projection.md) · [KISS-Matcher](kiss-matcher.md) · [Scan Context Family](scan-context-family.md) · [Distributed Multi-Robot PGO](distributed-multi-robot-pgo.md) · [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [Map Construction Pipeline](../maps/map-construction-pipeline.md)

**Last updated:** 2026-05-23

---

## What It Is

Uni-Mapper is a dynamic-aware 3D point-cloud map-merging framework for heterogeneous LiDAR systems. The reference paper is Kang et al., "Uni-Mapper: Unified Mapping Framework for Multi-modal LiDARs in Complex and Dynamic Environments" (IEEE Transactions on Intelligent Vehicles 2025, arXiv 2507.20538). It connects three functions that are often treated separately:

1. Dynamic object removal from keyframe or session point clouds.
2. Dynamic-aware place recognition and loop closure through DynaSTD.
3. Multi-map alignment through centralized anchor-node pose graph optimization.

The important architecture point is not simply that Uni-Mapper removes dynamic points. Its contribution is that the cleaner feeds the place descriptor and the map-merging backend. Dynamic residuals are filtered before descriptor construction, so loop detection and inter-map alignment are less likely to match on cars, pedestrians, equipment, or other unstable objects. That makes it a strong fit for aggregated LiDAR map construction, where one bad inter-session loop can corrupt the map that later feeds semantic segmentation, localization, and auto-labeling.

## Pipeline Contract

```text
multiple LiDAR sessions or maps
  -> keyframe / local-map extraction
  -> coarse-to-fine free-space dynamic removal
  -> DynaSTD dynamic-aware place descriptor
  -> intra-session loop closure
  -> inter-map loop closure
  -> centralized anchor-node pose graph optimization
  -> merged static point-cloud map + loop/alignment evidence
```

## Core Modules

### 1. Dynamic Object Removal

Uni-Mapper builds a voxel-wise free-space hash map in a coarse-to-fine manner. Sequential free-space observations inside a sliding window are combined to reject points whose temporal occupancy is inconsistent with static structure. The result is a static-preserved local cloud that can be used for descriptor extraction and later map alignment.

For AV and managed-site mapping, this block sits beside ERASOR, Removert, FreeDOM, DUFOMap, MapCleaner, detector-ground projection, and lifelong version-control methods. The distinction is that Uni-Mapper couples the cleaner directly to place recognition and map merging. A map-merging loop candidate that relies on dynamic object geometry is filtered before it reaches the optimizer.

### 2. DynaSTD Dynamic-Aware Descriptor

Uni-Mapper extends the stable triangle descriptor (STD) idea into DynaSTD. Instead of constructing a place descriptor from every observed point, it first preserves static local features after free-space filtering. The paper and project page frame this as a descriptor that is robust to both:

- **Dynamic scenes:** moving or temporary objects should not dominate loop closure.
- **LiDAR modality changes:** spinning, non-repetitive, narrow-FOV, and different beam-density LiDARs produce different point distributions.

This is directly relevant to fleets whose survey hardware evolves. A first airport, yard, campus, or construction site may be mapped with one LiDAR rig; later resurvey or handheld/robot-mounted collection may use another. The descriptor must match persistent geometry, not sensor-specific density patterns.

### 3. Centralized Anchor-Node Map Merging

The backend performs pose graph optimization over intra-session and inter-map loop closures. Uni-Mapper uses a centralized anchor-node strategy to reduce intra-session drift during multi-map alignment. This keeps the method in the same conceptual family as LT-Mapper and collaborative SLAM backends, but its focus is narrower: robust merging of maps produced by heterogeneous LiDAR modalities in dynamic environments.

## Inputs and Outputs

| Interface | Required fields | Notes |
|---|---|---|
| Input maps or sessions | Keyframe clouds, local maps, or scan groups plus initial poses | The public repo supports `pcd` and `bin` scans plus KITTI, TUM, and custom pose formats. |
| LiDAR metadata | Sensor type, field of view, beam/ray pattern, timestamping, calibration | Needed to interpret modality mismatch and map alignment errors. |
| Dynamic-removal input | Sequential point clouds or local maps with enough temporal support for free-space evidence | Single isolated maps limit the cleaner's ability to detect temporal occupancy inconsistency. |
| Descriptor output | DynaSTD descriptors and loop candidates | Should be stored with descriptor parameters and candidate scores. |
| Graph output | Intra-session and inter-map loop factors, optimized anchor/node poses | Needed for QA, rollback, and false-loop review. |
| Merged map output | Unified static candidate map | Input to map semantic segmentation and publication gates. |
| Evidence output | Rejected dynamic points, loop-closure report, alignment residuals, per-map provenance | Required before any downstream semantic labels are trusted. |

## Why It Matters for Aggregated-Map Segmentation

The aggregated-map semantic segmentation pipeline assumes that the input map is already clean, globally consistent, and mostly static. Uni-Mapper improves the pre-segmentation substrate in three ways:

- **Cleaner descriptors:** loop closure uses static-preserved local features, reducing the chance that dynamic objects create false inter-map matches.
- **Cross-rig map merging:** heterogeneous LiDARs can contribute to the same map product, useful for vehicle, handheld, robot-mounted, and infrastructure survey mixtures.
- **Alignment evidence:** anchor-node optimization and loop reports become QA artifacts before semantic segmentation runs.

For non-road urban districts such as campuses, plazas, logistics yards, ports, construction sites, warehouses with outdoor aprons, and airport airside areas, the same physical site is often mapped by different platforms over time. Uni-Mapper is therefore an architecture candidate for unifying those maps before the semantic segmenter labels the final static layer.

## Static and Dynamic Object Policy

Uni-Mapper handles moving or temporarily occupied structure through dynamic-removal and dynamic-aware descriptor construction. It should not be treated as the whole static-but-transient solution.

| Object class | Uni-Mapper role | Extra policy still needed |
|---|---|---|
| Moving vehicles or people | Free-space temporal inconsistency can reject dynamic points before descriptor construction. | Preserve rejected-point evidence and validate false deletion. |
| Parked vehicles or staged GSE | May remain if no temporal contradiction exists inside the window. | Detector-ground projection, semantic quarantine, or multi-session version-control confirmation. |
| Stationary people | May remain if stationary for the observation window. | Hard semantic exclusion and reviewer/hazard routing. |
| FOD, tools, chocks, cones | Too small or policy-sensitive for generic removal. | Hazard layer and human/ops review; never silently erase. |
| New permanent infrastructure | Appears as positive change or new aligned structure. | Map lifecycle approval before permanent promotion. |
| Occluded permanent structure | May look absent in one map. | Coverage/boundary evidence and conservative negative-change handling. |

The safe production pattern is:

```text
Uni-Mapper dynamic-aware merge
  + detector/semantic movable-object quarantine
  + map-version-control diff store
  + semantic-map publication gate
```

## Domain Fit

| Domain | Fit | Why |
|---|---|---|
| Urban road AV maps | Strong research fit | Repeated surveys and changing LiDAR rigs need dynamic-aware inter-map loop closure. |
| Non-road urban districts | Strong | Campuses, plazas, depots, and construction sites mix pedestrians, movable equipment, and multiple survey platforms. |
| Airport airside | Strong architecture, unvalidated domain | Aircraft, GSE, and open apron geometry create both dynamic clutter and weak/repetitive loop evidence; needs domain taxonomy and RTK/GCP anchors. |
| Logistics yards and ports | Strong | Trailers, containers, forklifts, and cranes create large temporary structure while maps may be collected by vehicle and handheld rigs. |
| Warehouses | Conditional | Heterogeneous LiDAR and robot maps matter, but indoor repetitive aisles need careful false-loop checks. |
| Mining/construction/agriculture | Conditional | Dynamic equipment and terrain changes are common; some "changes" are valid terrain edits, not objects to remove. |

## Failure Modes

| Failure mode | Effect | Mitigation |
|---|---|---|
| Free-space cleaner over-removes static structure | Descriptor loses permanent geometry; merged map loses localization anchors | Conservative thresholds, rejected-layer audit, static preservation metrics. |
| Parked movable objects survive | Static-but-wrong objects enter the merged map | Add detector-ground projection, semantic class policy, and multi-session version control. |
| Descriptor aliasing across repetitive geometry | False loop closures corrupt map alignment | Geometric verification, robust kernels, loop quarantine, GNSS/GCP priors. |
| LiDAR modality mismatch remains too large | DynaSTD candidate quality drops across beam patterns or FOV | Per-sensor normalization, range cropping, cross-sensor benchmark slices. |
| Anchor-node optimization absorbs bad inter-map loops | Whole session/map shifts into the wrong frame | Max-mixture/GNC/PCM-style loop validation and per-loop residual heatmaps. |
| Code maturity overestimated | Integration stalls on missing configs, TODOs, or branch-specific behavior | Treat the repo as a research reference; run a contained replay before product planning. |
| GPL dependency ignored | Product embedding creates license risk | Review GPL-3.0 repository terms and ERASOR dependency before reuse. |

## Implementation Notes

1. Run Uni-Mapper after each source session has a good local trajectory. It is a map-merging framework, not a replacement for sensor calibration, deskewing, or local LIO quality control.
2. Export loop candidates, dynamic-rejected layers, and graph residuals as first-class artifacts. A merged point cloud without this evidence is not reviewable.
3. Use Uni-Mapper as a map-construction and map-maintenance component, not as a runtime localization authority.
4. Keep semantic labels out of the descriptor optimization unless they are versioned. A taxonomy change can invalidate what the descriptor considered stable.
5. Add a target-domain evaluation split: same LiDAR, cross-LiDAR, same site across time, and different site across time. These isolate modality transfer from actual environment change.
6. For airside, combine DynaSTD loop candidates with RTK/GCP or surveyed-fiducial constraints. Open aprons and repeated stands are high-risk loop-closure negatives.
7. Do not publish the merged map directly into the semantic-map pipeline. First run static preservation, dynamic residual, MapEval-style point-cloud geometry QA, alignment, and localization regression gates.

## Comparison With Adjacent Pages

| System | Main contribution | How Uni-Mapper differs |
|---|---|---|
| LAMM | Large-scale multi-session point-cloud map merging with temporal bidirectional dynamic filtering, BTC loop detection, false-positive loop filtering, and graph optimization | Uni-Mapper is more explicitly heterogeneous-LiDAR and dynamic-aware descriptor centric; LAMM is the broader multi-session map-merging architecture reference. |
| LT-Mapper | Multi-session LiDAR lifelong mapping with LT-SLAM, LT-Removert, and Place-Voxel maps | Uni-Mapper focuses on heterogeneous-LiDAR map merging and dynamic-aware descriptors. |
| Khronos | Object-aware spatio-temporal metric-semantic SLAM | Uni-Mapper is LiDAR map merging, not object-centric RGB-D temporal scene graphs. |
| Lifelong 3D Map Version Control | Base map, positive/negative diff store, reconstructable map history | Uni-Mapper is an alignment/merging method; version control is the governance layer around its output. |
| KISS-Matcher | Robust map-to-map registration | Uni-Mapper wraps dynamic-aware loop detection and anchor-node graph optimization around the merging task. |
| [MapEval](mapeval-point-cloud-map-quality-evaluation.md) | Point-cloud map-quality evaluation | Uni-Mapper produces a merged candidate map; MapEval checks whether the output geometry is consistent enough for semantic segmentation or publication. |
| ERASOR/FreeDOM/MapCleaner | Dynamic point removal | Uni-Mapper consumes/remixes removal evidence so place recognition and merging are dynamic-aware. |
| Potentially Dynamic Object Removal | Detector-ground projection for parked movable classes | Uni-Mapper is class-agnostic unless augmented; parked movable objects still need semantic policy. |

## Deployment Readiness

Uni-Mapper is source-mature enough to document as a first-class method because it has an IEEE T-IV 2025 paper, arXiv record, project page, and official repository. It is not production-proven.

The official repository states that the released branch is a generalized OpenLMM version of the Uni-Mapper work, includes map alignment and dynamic removal modules, and remains under GPL-3.0 because it includes ERASOR. It also notes limited official code release for the original paper and points users to the `workshop` branch for usage. Treat the repository as a research artifact for replay and architecture learning unless a deployment team has validated build, config, dataset, and evaluation scripts on its own maps.

## Sources

- Kang et al., "Uni-Mapper: Unified Mapping Framework for Multi-modal LiDARs in Complex and Dynamic Environments," arXiv 2507.20538: https://arxiv.org/abs/2507.20538
- Uni-Mapper project page, SPARO Lab: https://sparolab.github.io/research/uni_mapper/
- IEEE T-IV DOI metadata: https://doi.org/10.1109/TIV.2025.3583551
- Official Uni-Mapper / OpenLMM repository: https://github.com/sparolab/uni-mapper
- Uni-Mapper ICRA Workshop / construction robotics PDF: https://construction-robots.github.io/papers/67.pdf
- HeLiPR heterogeneous LiDAR dataset used by the paper: https://sites.google.com/view/heliprdataset and https://arxiv.org/abs/2309.14590
- STD place-recognition lineage: https://arxiv.org/abs/2209.12435 and https://github.com/hku-mars/STD
- MapEval point-cloud map-quality evaluation: https://doi.org/10.1109/LRA.2025.3548441 and https://github.com/JokerJohn/Cloud_Map_Evaluation
