# ML-Related SLAM Research Scope for Semantic Aggregated Maps

**Last updated:** 2026-05-24

This page defines the research scope for **ML-related SLAM** as it contributes to an end-to-end semantic segmentation pipeline for aggregated LiDAR maps. It is not a claim that learned SLAM should replace geometric SLAM in production. The stronger architecture is a hybrid: classical or factor-graph SLAM produces a measurable, auditable map substrate; learned components improve registration robustness, loop retrieval, dynamic removal, semantic map construction, dense reconstruction, and label generation where they can be validated.

For the downstream map-labeling pipeline, start with [End-to-End Semantic Segmentation Pipeline for Aggregated LiDAR Maps](../../perception/overview/aggregated-map-semantic-segmentation.md). For the method-level SLAM library, start with [SLAM Method Library Overview](../slam-methods/overview.md).

---

## Scope Boundary

ML-related SLAM in this corpus means any localization, mapping, map-maintenance, or dense-reconstruction method where a learned model materially changes the map or pose-estimation workflow. The scope includes:

- learned registration, learned correspondence, learned feature weighting, and degeneracy-aware ICP support;
- learned place recognition, loop closure retrieval, and relocalization descriptors;
- semantic, object-level, and dynamic-aware SLAM;
- learned moving-object segmentation, scene flow, and map-cleaning signals;
- neural implicit maps and differentiable mapping;
- Gaussian SLAM and LiDAR/RGB Gaussian map representations;
- learned map priors, online vector-map construction, and neural spatial memory;
- auto-labeling loops that use a SLAM map as supervision for perception models.

The scope excludes generic neural perception that never affects pose, map state, map cleanup, relocalization, or map publication. A LiDAR semantic segmenter is ML, but it enters this page only when it feeds semantic SLAM, dynamic removal, map-layer creation, or the aggregated-map segmentation pipeline.

---

## Research Architecture

The research architecture should be read from left to right. Each block can be classical, learned, or hybrid, but the publication gate should remain evidence-driven.

```
Raw LiDAR / image / radar / IMU / GNSS logs
        |
        v
Survey odometry and registration
        |      learned support: learned weights, saliency, correspondence, descriptors
        v
Loop closure, multi-session alignment, and global optimization
        |      learned support: place recognition, robust loop candidate ranking
        v
Aggregated point-cloud map
        |      learned support: MOS, scene flow, semantic dynamic filters
        v
Dynamic residual and static-but-transient quarantine
        |      learned support: semantic classes, object permanence, change detection
        v
MapEval / geometry QA / localization regression
        |
        v
Aggregated-map semantic segmentation
        |
        v
Semantic map layer, vectorized physical layers, auto-labels, digital-twin assets
```

The production rule is simple: learned modules may propose, rank, filter, or refine map evidence, but the map package must preserve the diagnostics needed to reproduce the decision. That means source scans, poses, calibration versions, cleaner outputs, semantic logits or confidence summaries, and map-quality metrics remain part of the release evidence.

---

## Functional Research Map

| Function | ML-related families | Repository pages | Production stance |
|---|---|---|---|
| Survey odometry support | Learned feature weighting, learned correspondence, degeneracy-aware learned ICP, learned LiDAR odometry | [GenZ-ICP and GenZ-LIO](../slam-methods/genz-icp-genz-lio.md), [RegFormer](../slam-methods/regformer-learned-registration.md), [LO-Net](../slam-methods/lo-net-learned-lidar-odometry.md), [LiDAR SLAM Algorithms](lidar-slam-algorithms.md) | Useful as a robustness layer or comparison signal; do not use as sole map truth without classical residual/covariance checks. |
| Loop closure and recovery | Learned LiDAR descriptors, overlap prediction, visual foundation descriptors, retrieval plus geometric verification | [Learned LiDAR Place Recognition](../slam-methods/learned-lidar-place-recognition.md), [Loop Closure and Place Recognition](../slam-methods/loop-closure-place-recognition.md), [LiDAR Place Recognition and Re-Localization](lidar-place-recognition-relocalization.md) | Strong fit: learned retrieval is low-risk when every candidate is geometrically verified before entering the factor graph. |
| Semantic and dynamic SLAM | Semantic constraints, dynamic masks, object-level maps, semantic surfels, moving/static split | [Semantic SLAM](../slam-methods/semantic-slam.md), [SD-SLAM](../slam-methods/sd-slam-semantic-dynamic-lidar.md), [Dynamic-Object-Aware SLAM](../slam-methods/dynamic-object-aware-slam.md), [Object-Level SLAM](../slam-methods/object-level-slam.md) | Good research-to-pilot lane where semantics improves robustness, but class-list and domain-shift failures must be tracked. |
| Dynamic residual removal | MOS, scene flow, learned dynamic occupancy, 4D segmentation, learned static extraction | [LiDAR Map Cleaning and Dynamic Removal](../slam-methods/lidar-map-cleaning-dynamic-removal.md), [4dNDF](../slam-methods/4dndf.md), [MOVES](../slam-methods/moves-and-label-free-map-cleaning.md), [Scene Flow for Dynamic Object Removal](../../world-models/scene-flow-for-dynamic-object-removal.md) | Use learned signals beside geometry-based cleaners. Geometry-only disagreement remains the manual QA trigger. |
| Static-but-transient removal | Semantic movable-object quarantine, multi-pass persistence scoring, learned object permanence, map-change models | [Static-But-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [Lifelong 3D Map Version Control](../slam-methods/lifelong-3d-map-version-control.md), [LT-Mapper and Khronos](../slam-methods/lt-mapper-khronos-lifelong-mapping.md), [Potentially Dynamic Object Removal](../slam-methods/potentially-dynamic-object-removal-ground-projection.md) | High-value gap for airports, ports, yards, campuses, and warehouses. Multi-pass evidence is safer than a single semantic decision. |
| Multi-session map merging | Learned or dynamic-aware descriptors, heterogeneous-LiDAR matching, false-loop rejection | [LAMM](../slam-methods/lamm-multi-session-point-cloud-map-merging.md), [Uni-Mapper](../slam-methods/uni-mapper-dynamic-aware-lidar-map-merging.md), [MapEval](../slam-methods/mapeval-point-cloud-map-quality-evaluation.md) | Strong upstream conditioning lane before aggregated-map segmentation. Alignment QA gates are mandatory. |
| Neural implicit mapping | Differentiable fields, neural TSDF/SDF, RGB-D neural SLAM, LiDAR implicit maps | [NeRF SLAM](../slam-methods/nerf-slam.md), [iMAP](../slam-methods/imap.md), [NICE-SLAM](../slam-methods/nice-slam.md), [Co-SLAM and ESLAM](../slam-methods/co-slam-eslam.md), [PIN-SLAM](../slam-methods/pin-slam-neural-lidar-mapping.md) | Useful for dense reconstruction and differentiable QA; immature as certified pose backbone for large outdoor maps. |
| Gaussian SLAM and 3DGS maps | 3D Gaussian SLAM, LiDAR-camera Gaussian maps, dynamic 4D Gaussian maps, radar Gaussian maps | [Neural/Gaussian SLAM Surveys](../slam-methods/neural-gaussian-slam-surveys.md), [Splat-SLAM](../slam-methods/splat-slam.md), [Splat-LOAM](../slam-methods/splat-loam.md), [Gaussian-LIC](../slam-methods/gaussian-lic.md), [GS-LIVM](../slam-methods/gs-livm.md), [Dynamic 4D Gaussian SLAM](../slam-methods/dynamic-4d-gaussian-slam.md), [RadarSplat-RIO](../slam-methods/radarsplat-rio.md) | Promising for inspection, simulation, semantics, and digital twins. Needs uncertainty and map-change governance before pose-critical use. |
| Learned map priors | Neural map prior, vector prior encoding, prior-assisted online mapping, learned spatial memory | [Semantic Mapping and Learned Priors](../maps/semantic-mapping-learned-priors.md), [Neural Online Mapping SOTA](../maps/neural-online-mapping-sota.md), [Mapping and Localization](mapping-and-localization.md) | Good companion to explicit maps; strongest where fleet revisits are frequent and priors are versioned. |
| Map-scale semantic labeling | 3D segmentation backbones, LiDAR-image distillation, open-vocabulary consolidation, pseudo-labeling | [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [Training Paradigms](../../perception/overview/3d-segmentation-training-paradigms.md), [LOSC](../../perception/methods/losc.md), [Point-Cloud Mamba/SSM Backbones](../../perception/methods/point-cloud-mamba-ssm-backbones.md) | This is the downstream consumer. It should receive a clean, georeferenced, QA-passed aggregated map, not raw SLAM output. |

---

## Architecture Families Compared

| Family | Primary input | Output | Advantages | Disadvantages | Best role in this corpus |
|---|---|---|---|---|---|
| Classical LIO plus learned weighting | LiDAR + IMU, optional GNSS/wheel | Trajectory and geometric map | Keeps auditable factors while using learned saliency to suppress weak geometry | Learned weights can fail silently under domain shift | Survey odometry in weak-geometry sites such as open aprons, plazas, yards, and campuses |
| Learned registration | Point-cloud pair or scan-to-map pair | Relative pose | Handles partial overlap and nonlocal correspondences better than nearest-neighbor ICP in some cases | Needs training data; slower; generalization is limited | Cold-start alignment, loop verification support, offline QA comparison |
| Learned place recognition | LiDAR, image, or multi-modal descriptors | Candidate loop/relocalization matches | High recall at city/site scale; cheap to run before expensive geometry verification | False positives are catastrophic if inserted without verification | Retrieval-only stage before ICP/NDT/GICP verification |
| Semantic/dynamic SLAM | LiDAR or RGB-D plus semantic model | Pose plus semantic/dynamic map | Can reject dynamic objects and weight stable classes | Taxonomy mismatch; class-confidence calibration burden | Research and pilot lane for semantic-weighted localization and map cleaning |
| Neural implicit SLAM | RGB-D, mono/RGB, LiDAR, or hybrid | Continuous field or dense reconstruction | Differentiable rendering, compact dense maps, simulation/novel-view reuse | Compute-heavy; scale and uncertainty remain hard | Dense QA, local reconstruction, digital twin, inspection overlays |
| Gaussian SLAM | RGB/RGB-D/LiDAR-camera/radar variants | Gaussian scene representation plus poses | Explicit editable primitives; fast rendering; semantic attributes can attach to Gaussians | Dynamic artifacts, scale ambiguity in camera-only variants, weak certification story | Photoreal QA, semantic 3DGS, simulation assets, map-change visualization |
| Learned map priors | Fleet observations plus map tiles | Prior features, vectors, or neural spatial memory | Improves adverse-condition online mapping; amortizes fleet data | Prior staleness and versioning can create hidden failure modes | Fleet-maintained semantic maps and online map refinement |
| Map segmentation as SLAM supervision | Aggregated map plus poses | Pseudo-labeled scans and semantic map layer | Converts one expensive map-labeling pass into many scan labels | SLAM drift back-projects label errors; dirty maps poison training | Data flywheel for LiDAR segmentation, MOS, and static-map policy |

---

## Inputs and Modality Choices

### LiDAR-only

LiDAR-only is the default for map substrate construction because it gives metric geometry directly and remains robust to lighting. Learned SLAM contributions usually appear as point features, correspondence weights, MOS labels, or learned descriptors. This is the strongest path for airside, ports, yards, mining haul roads, construction sites, and utility corridors.

### LiDAR plus image

Camera imagery helps with semantics, texture, markings, and digital-twin reconstruction. In the map pipeline, image inputs should usually be train-time or offline-map-time signals, not required runtime dependencies. Examples include colorized point clouds, LiDAR-image distillation into a LiDAR-only segmenter, semantic Gaussian attributes, and 2D foundation-model candidate labels consolidated into 3D.

### Radar plus LiDAR

Radar brings Doppler velocity and adverse-weather robustness. Its strongest ML-SLAM contribution is dynamic evidence: motion from Doppler can prevent moving objects from entering the static LiDAR map. Radar Gaussian and radar-inertial SLAM remain research-stage, but radar-to-LiDAR map localization is worth tracking for weather-degraded sites.

### GNSS, wheel, IMU, and prior maps

ML-related SLAM should not obscure the importance of conventional constraints. RTK-GNSS, wheel odometry, IMU preintegration, GCPs, AMDB/AIXM priors, OpenLiDARMap/FlexCloud-style georeferencing, and MapEval-style geometry QA determine whether the downstream semantic labels are spatially trustworthy.

---

## Non-Road Urban District and Managed-Site Transfer

The target is broader than public-road HD mapping. The same architecture applies to airport aprons, ports, logistics yards, warehouses, campuses, pedestrian districts, industrial facilities, construction sites, rail corridors, utility corridors, and facade-rich urban districts. These domains stress different failure modes:

| Domain | Map-cleaning pressure | Segmentation pressure | SLAM pressure |
|---|---|---|---|
| Airport apron | Stationary aircraft, GSE, crew, FOD, wide flat pavement | Markings, jet bridges, aircraft-adjacent infrastructure, low-profile objects | Open-space degeneracy; RTK/GNSS helps but aircraft cause multipath |
| Port and logistics yard | Containers, chassis, cranes, staged trucks, moved barriers | Container rows, lane paint, rail, pavement damage | Repetitive structures and false loop closures |
| Warehouse and indoor yard | Pallets, forklifts, people, changed racks | Racks, dock doors, floor zones, pallet classes | GNSS-denied; high aliasing; wheel/fiducial support important |
| Campus or pedestrian district | Stationary people, benches, temporary signs, vegetation change | Sidewalk, curb, facade, furniture, vegetation | Seasonal change and visual appearance shift |
| Construction or utility corridor | Machinery, trenches, temporary fencing, cables | Thin structures, soil, pipes, barriers, safety zones | Non-repeatable geometry; survey revisions frequent |
| Facade-rich urban district | Parked vehicles, scaffolding, pedestrians | Facade parts, windows, doors, street furniture | GNSS urban canyon; vertical structure is strong but repeated |

The key research rule is to separate **permanence** from **motion**. A point can be static during the survey yet invalid for the permanent map. Stationary people, staged equipment, parked aircraft, pallets, temporary barriers, and construction materials need a static-but-transient policy, not just a dynamic-object detector.

---

## Point-Cloud Removal Research Scope

Point-cloud removal for aggregated maps has three distinct objectives:

| Removal target | Example | Evidence needed | Output policy |
|---|---|---|---|
| Dynamic residual points | Ghost trail from a moving tug, pedestrian smear, moving car trail | Free-space contradiction, MOS label, scene flow, Doppler, timestamp distribution | Remove from permanent map; preserve in rejected/dynamic evidence layer |
| Static-but-transient points | Stationary person, parked GSE, parked aircraft, staged pallet, temporary barrier | Semantic class, operational zone, K-of-N multi-pass persistence, future absence | Quarantine as transient-candidate until confirmed; never use for auto-label ground truth |
| Static points that do not belong in the aggregated map | Snow pile, construction material, debris, wet-reflection artifact, dropped object | Class policy, TTL, FOD rule, operational record, map-change evidence | Route to FOD-candidate, artifact, or change-review layer |

The open research problem is not just removal accuracy. It is **map-layer governance**: how to keep localization useful while preventing stale or unsafe objects from becoming permanent map truth. See [Static-But-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [LiDAR Map Cleaning and Dynamic Removal](../slam-methods/lidar-map-cleaning-dynamic-removal.md), and [Airside Map Hygiene Ground Truth Protocol](../maps/airside-map-hygiene-ground-truth-protocol.md).

---

## Validation and Safety Evidence

Every ML-related SLAM contribution should be evaluated on two axes:

1. **Pose/map substrate quality**: trajectory ATE/RPE, loop-closure precision, map consistency, point-cloud completeness, local map entropy, MapEval-style geometry metrics, localization regression on the resulting map.
2. **Semantic-map downstream quality**: per-class IoU, boundary IoU, thin-class recall, map-cleaning false-deletion/false-retention, transient-object leakage, auto-label precision, calibration, and human QA burden per square kilometer or per operational zone.

An ML module is useful only if it improves one axis without hiding unacceptable regressions on the other. For example, an aggressive learned cleaner that improves dynamic rejection but deletes poles, curbs, signs, and markings is a net loss for semantic map publication.

Recommended evidence package:

- raw data manifest: sensors, calibration, timestamps, poses, source-map hash;
- SLAM manifest: method, parameters, trajectory covariance, loop closures, rejected loops;
- cleaner manifest: method decisions, removed-point layer, uncertainty, disagreement regions;
- map QA report: MapEval-style metrics, localization regression, alignment residuals;
- segmentation report: metrics, confidence, class-wise error decomposition, taxonomy version;
- map contract: semantic-map manifest, runtime map contract, OTA compatibility matrix.

---

## Research Backlog

| Priority | Research item | Why it matters |
|---|---|---|
| P0 | Static-but-transient benchmark for airside, port, yard, or campus maps | Current benchmarks measure dynamic removal better than stationary-but-temporary object removal. |
| P0 | Joint cleaner plus segmenter disagreement protocol | Cleaner disagreement and segmentation uncertainty are complementary QA signals, but most pipelines evaluate them separately. |
| P0 | Map-scale LiDAR-image distillation with LiDAR-only deployment | Uses rich imagery during offline training while keeping runtime map consumption simple. |
| P1 | Learned permanence scoring for objects and clusters | Motion labels alone cannot decide whether a stationary object belongs in the permanent map. |
| P1 | Non-road urban district taxonomy mapping | Ports, campuses, airports, warehouses, and utility corridors share map problems but not class names. |
| P1 | Differentiable map QA for neural/Gaussian maps | Neural maps need uncertainty and map-change checks before they can carry safety-critical semantics. |
| P1 | Semantic-weighted localization regression | Verify whether a semantic layer improves scan matching by weighting stable classes and downweighting vegetation, vehicles, or movable equipment. |
| P2 | Open-vocabulary candidate promotion to closed taxonomy | Foundation labels are useful for discovery, but production maps need closed, versioned class IDs. |
| P2 | Radar Doppler-aided map cleaning | Doppler can remove moving points before LiDAR map accumulation, but cross-sensor calibration and false-motion policies need evidence. |

---

## Page Contribution Map

Use this route to improve the topic across the corpus:

1. **Pipeline hub:** [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) defines the full map-labeling pipeline.
2. **SLAM substrate:** [SLAM Method Library Overview](../slam-methods/overview.md), [LiDAR SLAM Algorithms](lidar-slam-algorithms.md), [GLIM/GTSAM Pipeline Hub](../slam-methods/glim-gtsam-pipeline-hub.md), and [Map Construction Pipeline](../maps/map-construction-pipeline.md) define how the aggregated map is built.
3. **Map cleaning:** [LiDAR Map Cleaning and Dynamic Removal](../slam-methods/lidar-map-cleaning-dynamic-removal.md), [Static-But-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [Potentially Dynamic Object Removal](../slam-methods/potentially-dynamic-object-removal-ground-projection.md), [MOVES](../slam-methods/moves-and-label-free-map-cleaning.md), and [Lifelong 3D Map Version Control](../slam-methods/lifelong-3d-map-version-control.md) define removal and quarantine.
4. **Map merging and QA:** [LAMM](../slam-methods/lamm-multi-session-point-cloud-map-merging.md), [Uni-Mapper](../slam-methods/uni-mapper-dynamic-aware-lidar-map-merging.md), and [MapEval](../slam-methods/mapeval-point-cloud-map-quality-evaluation.md) define multi-session substrate readiness.
5. **Semantic model and training:** [3D Segmentation Training Paradigms](../../perception/overview/3d-segmentation-training-paradigms.md), [Class Taxonomy Design](../../perception/overview/3d-segmentation-class-taxonomy-design.md), [Large-Scale 3D Segmentation Benchmarks](../../perception/datasets-benchmarks/large-scale-3d-segmentation-benchmarks.md), and [Tiling and Throughput](../../perception/overview/large-scale-3d-segmentation-tiling-and-throughput.md) define model and data choices.
6. **Validation and release:** [Airside Map Hygiene Ground Truth Protocol](../maps/airside-map-hygiene-ground-truth-protocol.md), [Map Publication Gates](../../../50-cloud-fleet/map-operations/map-publication-gates-airside-hygiene.md), [Semantic Map Release Contracts](../../../schemas/semantic-map-manifest.schema.json), and [Perception-SLAM Artifact Compatibility Matrix](../../../50-cloud-fleet/ota/perception-slam-artifact-compatibility-matrix.md) define release evidence.

---

## Sources

Primary source links are maintained in the method pages above. The most important starting points are:

- KISS-ICP, LIO-SAM, FAST-LIO2, GLIM, GTSAM, and scan-matching baselines: [SLAM Method Library Overview](../slam-methods/overview.md)
- Neural/Gaussian SLAM methods and surveys: [Neural/Gaussian SLAM Surveys](../slam-methods/neural-gaussian-slam-surveys.md)
- Dynamic removal and point-cloud map cleaning: [LiDAR Map Cleaning and Dynamic Removal](../slam-methods/lidar-map-cleaning-dynamic-removal.md)
- Aggregated-map semantic segmentation methods, datasets, and training references: [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md)
- Map publication and safety evidence: [Airside Map Hygiene Ground Truth Protocol](../maps/airside-map-hygiene-ground-truth-protocol.md) and [Map Publication Gates](../../../50-cloud-fleet/map-operations/map-publication-gates-airside-hygiene.md)
