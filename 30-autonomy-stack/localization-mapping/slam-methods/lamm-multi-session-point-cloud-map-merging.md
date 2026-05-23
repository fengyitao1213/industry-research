# LAMM Multi-Session Point-Cloud Map Merging

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "deployment-pattern"
  maturity: "prototype"
  tags: ["slam", "mapping", "validation", "runtime-localization", "outdoor", "lidar"]
  reason: "LAMM is rated for large-scale multi-session LiDAR map merging where dynamic filtering, loop validation, and graph optimization condition maps before segmentation."
method-priority:end -->

Related docs: [Uni-Mapper Dynamic-Aware LiDAR Map Merging](uni-mapper-dynamic-aware-lidar-map-merging.md) · [LiDAR Map Cleaning and Dynamic Removal](lidar-map-cleaning-dynamic-removal.md) · [Lifelong 3D Map Version Control](lifelong-3d-map-version-control.md) · [Potentially Dynamic Object Removal by Ground Projection](potentially-dynamic-object-removal-ground-projection.md) · [Scan Context Family](scan-context-family.md) · [Learned LiDAR Place Recognition](learned-lidar-place-recognition.md) · [Robust PGO / GNC / riSAM](robust-pgo-gnc-risam.md) · [Map Construction Pipeline](../maps/map-construction-pipeline.md) · [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md)

**Last updated:** 2026-05-24

---

## Executive Summary

LAMM is a large-scale multi-session 3D LiDAR point-cloud map-merging framework from Wei et al., "Large-Scale Multi-Session Point-Cloud Map Merging" (IEEE Robotics and Automation Letters, 2025, DOI `10.1109/LRA.2024.3504317`). It is relevant to this corpus because it combines three functions that directly affect whether an aggregated LiDAR map is safe to segment:

1. Temporal bidirectional moving-object filtering before place recognition.
2. BTC-style LiDAR place description and loop-closure search across sessions.
3. False-positive loop filtering, connectivity grouping, and graph optimization for the final merged map.

LAMM is not a semantic segmentation method, not a dataset, and not a release-label source. Its role is upstream map-substrate governance: merge multiple LiDAR sessions or submaps into a cleaner, globally consistent static candidate map, while preserving loop, rejected-point, and residual evidence for review before semantic segmentation or map publication.

The fit is strongest when a site is mapped by multiple agents, repeated survey sessions, or different LiDAR scanning patterns. That is common in non-road urban districts: campuses, plazas, logistics yards, ports, construction sites, terminal frontages, and airport aprons often mix vehicle, backpack, handheld, robot-mounted, and infrastructure surveys over time.

## What It Is

LAMM accepts point-cloud scans or submaps plus initial poses from a front-end SLAM system, then builds a merged point-cloud map across sessions. The paper evaluates KITTI, HeLiPR, WildPlaces, and a self-collected Shenzhen colored point-cloud dataset. The official repository is a C++ / ROS Noetic research artifact with build instructions, a linked test-data package, and no top-level release packaging.

The method is best read as an offline map-merging architecture:

```text
per-session LiDAR scans or local maps
  + initial poses from FAST-LIO2, R3LIVE, or another front-end
  -> temporal bidirectional moving-object filtering
  -> BTC place descriptor extraction
  -> inter-session loop closure detection
  -> false-positive loop filtering
  -> connectivity grouping into sub-pose graphs
  -> graph optimization
  -> merged static candidate map + alignment evidence
```

The first architectural insight is that dynamic filtering is placed before descriptor and loop evidence. Moving cars, pedestrians, GSE, equipment, and other temporary objects should not become the geometric signal that causes two sessions to match. The second insight is that false loops are explicitly filtered before optimization, because a few bad inter-session matches can distort the whole map.

## Inputs and Outputs

| Interface | Required fields | Why it matters |
|---|---|---|
| Source sessions | LiDAR scans or submaps, session IDs, and local frame definitions | Multi-session merging only works if every source map can be traced back to its session. |
| Initial poses | Per-scan poses from a front-end such as FAST-LIO2; colored-map variants may use R3LIVE-style poses | LAMM refines and merges maps; it is not a complete replacement for local odometry or deskewing. |
| LiDAR metadata | Sensor model, field of view, scan pattern, calibration, timestamping, and intensity/reflectivity treatment | Cross-LiDAR and cross-rig matching depends on scanning-pattern differences. |
| Dynamic-filter evidence | Bidirectional moving-object decisions and rejected-point layer | Downstream review needs to know what was removed before place recognition. |
| Loop evidence | BTC descriptors, loop candidates, inlier/outlier state, residuals, and connectivity groups | False-loop quarantine is the critical safety artifact for map merging. |
| Optimized map | Merged point cloud and optimized poses in each connected component | Input to map conditioning, geodetic alignment, semantic segmentation, and localization regression. |
| Release evidence | Alignment residuals, dynamic residual rate, static preservation checks, and manifest hashes | Required before a semantic map or runtime map package consumes the result. |

## Core Modules

### 1. Temporal Bidirectional Filtering

LAMM uses a moving-object filtering module based on the M-Detector lineage. The paper's key twist is bidirectional temporal reasoning: run the temporal evidence forward and backward so moving objects that are only obvious in one direction are less likely to survive. This improves the point cloud that later feeds place recognition.

For AV map construction, treat this as dynamic-residual conditioning, not as a full static-map policy. A person who stands still for the full survey window, a parked tug, a staged cone, or an aircraft parked through every lap may not be contradicted by temporal free-space evidence. Those objects still need semantic quarantine, map-hygiene review, or multi-session lifecycle governance.

### 2. BTC Place Recognition

LAMM builds on BTC, the binary triangle combined descriptor, for 3D LiDAR place recognition. This places it near [Scan Context Family](scan-context-family.md) and [Learned LiDAR Place Recognition](learned-lidar-place-recognition.md) in the library: the descriptor is the candidate-generator layer for inter-session loop closure, not the final registration authority.

The deployment point is that descriptor quality must be measured after dynamic filtering. A high-scoring match caused by a parked bus, construction equipment, a crowd, or staged GSE is worse than no match because it gives the optimizer a confident but wrong constraint.

### 3. False-Positive Loop Filtering

LAMM filters detected loop closures before graph optimization. The paper describes a RANSAC-style outlier-removal mechanism over inferred sequence alignment hypotheses, then keeps the loop constraints that are consistent with the inlier group. It also checks sequence connectivity and splits disconnected data into separate sub-pose graphs instead of forcing every sequence into one global map.

That behavior matters for managed sites. A campus, apron, or port can have disconnected areas, repeated facades, long fences, and visually similar service roads. The correct output may be several connected map components with honest residual reports, not one overfit map that hides ambiguous geometry.

### 4. Graph Optimization

After filtering and grouping, LAMM optimizes the remaining inter-session constraints to produce the merged map. This places it in the same backend family as robust pose-graph optimization, multi-robot SLAM, and offline HD-map construction. The map product should retain the optimized pose graph, rejected loop set, and per-session transform history so later QA can audit how each source session moved.

## Where It Fits in Aggregated-Map Segmentation

LAMM belongs before the learned segmenter:

```text
source scans / local maps
  -> local SLAM and calibration QA
  -> LAMM-style multi-session merge
  -> dynamic residual and false-loop review
  -> geodetic alignment / map-prior conditioning
  -> tiling, segmentation, stitching
  -> semantic-map manifest and runtime export
```

The semantic segmenter assumes its input geometry is already mostly static, globally consistent, and reviewable. LAMM improves that substrate by reducing dynamic-loop evidence, exposing false-loop decisions, and merging repeated sessions into one candidate map. It does not decide class labels. Its outputs should feed the semantic-map manifest as source-map conditioning evidence, for example through a `dynamic_removal_output_digest`, loop-report digest, or `prior_inputs` entry, not as ground-truth labels.

For non-road urban districts, this is especially important because the same physical site is often surveyed by different platforms over time. Vehicle MLS may cover roads and open aprons; backpack or handheld LiDAR may cover covered walkways, terminal fronts, and narrow service passages; infrastructure LiDAR may cover fixed zones. LAMM-like merging is a candidate for unifying those inputs before the aggregated-map segmentation pipeline labels the final static layer.

## Dynamic and Static Residual Policy

| Residual type | LAMM role | Extra policy still needed |
|---|---|---|
| Moving vehicles and people | Temporal bidirectional filtering can remove many moving points before descriptors and loops are built. | Preserve rejected points and measure false deletion by class. |
| Dynamic ghost trails | Cleaner input reduces descriptor contamination and map blur. | Run independent map-cleaning baselines such as ERASOR, Removert, BeautyMap, Raymoval, or FreeDOM if release quality requires it. |
| Parked or staged movable objects | May survive if they are temporally consistent. | Detector-ground projection, semantic quarantine, or map-hygiene reviewer disposition. |
| Stationary people | May survive if no motion evidence appears. | Hard semantic exclusion and reviewer/hazard routing before publication. |
| FOD, tools, chocks, cones | Not safe to delete by generic map merging. | Hazard and do-not-delete holdout policy; do not silently erase safety-relevant objects. |
| New permanent infrastructure | Appears as new structure in a later session. | Promote through map version-control and change-approval workflow. |
| Disconnected areas | LAMM can form separate connected components. | Publish separate map components or require new survey overlap/GCPs. |

## Architecture Comparison

| System | Main contribution | Best use | Main caveat |
|---|---|---|---|
| LAMM | Multi-session point-cloud map merging with temporal bidirectional dynamic filtering, BTC loop detection, false-loop filtering, and graph optimization | Large sites where multiple LiDAR sessions or agents must be merged before semantic segmentation or map publication | Research artifact, no top-level license clarity, depends on good input odometry and overlap. |
| [Uni-Mapper](uni-mapper-dynamic-aware-lidar-map-merging.md) | Dynamic-aware heterogeneous-LiDAR map merging with DynaSTD and anchor-node optimization | Cross-rig map merging where descriptor construction itself must be dynamic-aware | Also research/prototype; parked movable objects still need semantic policy. |
| [Lifelong 3D Map Version Control](lifelong-3d-map-version-control.md) | Reconstructable base map plus positive/negative diff history | Production governance, rollback, and map lifecycle audit | Does not solve registration or dynamic filtering by itself. |
| [KISS-Matcher](kiss-matcher.md) | Robust map-to-map registration | Focused pairwise registration and loop verification | Needs surrounding lifecycle and dynamic-residual policy. |
| LEMON-Mapping | Loop-enhanced point-cloud fusion with spatial bundle adjustment and global consistency propagation | Follow-on candidate for geometric map-quality improvement in overlaps | As of this pass, source-backed by arXiv but not promoted here as a code-mature atomic page. |
| ERASOR / Removert / BeautyMap / Raymoval / FreeDOM | Dynamic point removal and static preservation | Cleaning one accumulated map or scan sequence | Do not merge multiple sessions or own graph-level false-loop governance. |

## Domain Fit

| Domain | Fit | Why |
|---|---|---|
| Urban road AV maps | Strong research fit | Repeated survey drives, cross-day mapping, and LiDAR rig changes need multi-session merge evidence. |
| Non-road urban districts | Strong | Campuses, plazas, depots, ports, and terminal frontages mix pedestrians, fixed infrastructure, and movable equipment across surveys. |
| Airport airside | Strong architecture, unvalidated domain | Airside needs repeated low-speed survey passes, but open aprons and repeated stands raise false-loop risk and require RTK/GCP constraints. |
| Logistics yards and ports | Strong | Containers, trailers, forklifts, and cranes create temporary geometry; multiple mapping platforms are plausible. |
| Construction and mining | Conditional | Dynamic equipment and terrain changes are common, but some changes are valid site evolution rather than objects to remove. |
| Warehouses | Conditional | Multi-robot maps and repeated aisles fit the method, but repetitive geometry can create false loops without strong verification. |

## Failure Modes

| Failure mode | Effect | Mitigation |
|---|---|---|
| Bad input odometry | Loop search and graph optimization start from weak priors | Run local SLAM QA, deskew checks, and per-session residual gates before merging. |
| Insufficient overlap | Sessions split into disconnected components or align on weak evidence | Require survey-overlap targets, fiducials, GCPs, or additional passes. |
| False loop survives filtering | Whole map component can bend or shift | Store rejected loops, use robust PGO/GNC/PCM checks, and inspect residual heatmaps. |
| Dynamic filter over-removes static points | Descriptors lose stable geometry; final map has holes | Tune for static preservation and keep rejected-point review layers. |
| Stationary movable objects survive | Parked equipment or people enter the static candidate map | Add semantic movable-object quarantine and human disposition. |
| Cross-LiDAR density mismatch | Descriptor and registration quality degrade across scanning patterns | Normalize range, density, and voxel scale; evaluate same-LiDAR and cross-LiDAR splits separately. |
| License or packaging assumed safe | Product embedding creates legal or maintenance risk | Treat the public repo as research reference until legal, build, and replay reviews are complete. |

## Implementation Notes

1. Run LAMM after every source session has passed local SLAM, calibration, timestamp, and deskew checks.
2. Preserve source-session provenance: source scan ID, session ID, local pose, optimized pose, sensor metadata, and map component ID.
3. Export dynamic-rejected points, false-loop candidates, retained loops, residual histograms, and connected-component summaries as first-class artifacts.
4. Do not let semantic labels silently steer map merging unless the taxonomy, model checkpoint, prompt/candidate source, and prior-input contract are versioned.
5. Measure map quality separately for same-sensor, cross-sensor, same-site-cross-time, and different-site splits.
6. For airside and other open repetitive domains, combine LAMM loop evidence with RTK, GCPs, surveyed reflectors, fiducials, or map-prior georeferencing.
7. Before semantic segmentation, run static preservation, dynamic residual, localization regression, and map-hygiene review gates. The output should be a static candidate map plus evidence layers, not just a cleaned `.pcd`.
8. Record the output in the semantic map manifest as upstream conditioning evidence, not as semantic ground truth.

## Deployment Readiness

LAMM is source-mature enough for a first-class method page because it has a peer-reviewed RA-L 2025 article, DOI metadata, an official HKU-MARS repository, and public build/test-data instructions. It is not production-proven. The public repository should be treated as a replay and architecture reference until a team verifies:

- top-level license terms and third-party dependencies,
- ROS Noetic / Ubuntu 20.04 build reproducibility,
- test data access and deterministic replay,
- input pose format and frame conventions,
- output graph/map artifacts,
- failure behavior on target-domain survey data.

The repo card does not show a top-level license for LAMM, while several included HKU-MARS dependencies have their own licenses. Review licensing before embedding code into product software or a commercial map pipeline.

## Sources

- Wei et al., "Large-Scale Multi-Session Point-Cloud Map Merging," IEEE Robotics and Automation Letters 10(1):88-95, 2025, DOI `10.1109/LRA.2024.3504317`: https://doi.org/10.1109/LRA.2024.3504317
- HKUST research portal record: https://researchportal.hkust.edu.hk/en/publications/large-scale-multi-session-point-cloud-map-merging/
- Author PDF: https://renyunfan.cn/papers/2024ral_lamm.pdf
- Official LAMM repository: https://github.com/hku-mars/LAMM
- M-Detector repository and moving-object detection lineage: https://github.com/hku-mars/M-detector
- BTC descriptor repository: https://github.com/hku-mars/btc_descriptor
- LEMON-Mapping follow-on candidate: https://arxiv.org/abs/2505.10018
