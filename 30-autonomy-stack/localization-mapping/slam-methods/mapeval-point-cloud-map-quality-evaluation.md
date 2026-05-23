# MapEval Point-Cloud Map-Quality Evaluation

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "benchmark"
  stage: "reference"
  maturity: "prototype"
  tags: ["slam", "mapping", "validation", "data-engine", "outdoor", "lidar"]
  reason: "MapEval is rated as a point-cloud map-quality evaluation reference for gating aggregated LiDAR maps before semantic segmentation, localization regression, or map publication."
method-priority:end -->

Related docs: [SLAM Benchmarking Metrics and Datasets](benchmarking-metrics-datasets.md) · [Map Construction Pipeline](../maps/map-construction-pipeline.md) · [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [LAMM Multi-Session Point-Cloud Map Merging](lamm-multi-session-point-cloud-map-merging.md) · [Uni-Mapper Dynamic-Aware LiDAR Map Merging](uni-mapper-dynamic-aware-lidar-map-merging.md) · [LiDAR Map Cleaning and Dynamic Removal](lidar-map-cleaning-dynamic-removal.md)

**Last updated:** 2026-05-24

---

## Executive Summary

MapEval is an open-source framework from Hu et al., "MapEval: Towards Unified, Robust and Efficient SLAM Map Evaluation Framework" (IEEE Robotics and Automation Letters, 2025, DOI `10.1109/LRA.2025.3548441`). It evaluates the geometry of large point-cloud maps, not semantic labels. Its role in this corpus is therefore a publication gate: decide whether the aggregated LiDAR map is geometrically stable enough before semantic segmentation, pseudo-label consolidation, map packaging, localization regression, or downstream planning consumes it.

The page matters because the repo already covers SLAM trajectory metrics, dynamic-map cleaning metrics, semantic-map QA, LAMM/Uni-Mapper map merging, and map-hygiene ground truth. The missing layer was direct point-cloud map-quality evaluation: global geometric accuracy, local structural consistency, completeness, double surfaces, drift blur, and local map deformation.

MapEval's main contribution is a voxelized Gaussian approximation that makes Wasserstein-style map comparison practical on million-scale point clouds. It adds two complementary metrics:

| Metric | Intended signal | Operational use |
|---|---|---|
| Average Wasserstein Distance (AWD) | Global geometric accuracy in voxelized map space | Detects drift, warped geometry, and poor alignment against a reference map. |
| Spatial Consistency Score (SCS) | Local consistency of neighboring voxel errors | Flags locally distorted areas, blurred overlaps, and loop-closure side effects. |

Traditional metrics remain useful but incomplete: accuracy (AC), completeness (COM), Chamfer Distance (CD), and Mean Map Entropy (MME) cover point distance, coverage, bidirectional cloud mismatch, and local entropy. MapEval is valuable because it frames them as one map-QA suite rather than a collection of ad hoc numbers.

## Pipeline Slot

MapEval belongs after map construction and before semantic release:

```text
raw survey sessions
  -> local SLAM / LIO / deskew / calibration QA
  -> multi-session map merging (LAMM, Uni-Mapper, GLIM/GTSAM, or equivalent)
  -> dynamic residual and static-transient cleanup
  -> MapEval-style geometric map QA
  -> aggregated-map semantic segmentation
  -> semantic QA, reviewer gates, and artifact manifests
  -> runtime map export and publication
```

This ordering is important. A segmentation model can produce high mIoU on a geometrically bad map if the labels are locally consistent with distorted geometry. MapEval answers a different question: whether the geometry itself is fit to become a source map.

## Inputs and Outputs

| Interface | Required fields | Notes |
|---|---|---|
| Estimated map | Point-cloud map produced by a SLAM, map-merging, or map-cleaning pipeline | Usually a dense `.pcd`, `.ply`, `.las`, or equivalent map product. |
| Reference map | Dense ground-truth or high-quality reference map when available | Required for AC, COM, CD, AWD, and SCS in the full evaluation mode. |
| Initial transform | Initial alignment between estimated and reference maps | External registration quality can dominate the score; record the transform and method. |
| Voxel and threshold config | Voxel size, correspondence distance threshold, MME radius, and filtering policy | Thresholds should be domain-specific and stored with the QA report. |
| Optional no-GT mode | Estimated maps only | The public README warns that without a reference map, only MME is available; use this as a weak local-consistency signal, not a release gate. |
| Outputs | Scalar metrics, error maps, voxel diagnostics, visualization artifacts, and pass/fail evidence | These should be attached to the map manifest or QA report. |

## Metric Suite

| QA target | MapEval or adjacent metric | What it catches | What it does not prove |
|---|---|---|---|
| Global drift and deformation | AWD, AC, CD, GCP residuals | Map bend, shifted corridors, warped submaps, poor geodetic alignment | Semantic correctness or dynamic-object removal quality |
| Local consistency | SCS, MME, local surface thickness | Double walls, loop-closure blur, overlap distortion, inconsistent local geometry | Absolute position without a reference frame |
| Coverage | COM, density maps, occlusion maps | Missing regions and sparse reference overlap | Whether covered points are labeled correctly |
| Dynamic residuals | Before/after point counts, temporal occupancy, class-specific cleaning F1 | Moving-object trails and ghost surfaces when paired with cleaning labels | Stationary people, parked equipment, or staged objects by itself |
| Static-transient contamination | Persistence across sessions, semantic quarantine, reviewer disposition | Parked vehicles, staged GSE, crowds, movable signs, equipment left during survey | Automatic safety approval to delete or publish objects |
| Semantic readiness | Class coverage, unknown rate, mIoU, boundary F1, confidence calibration | Whether the semantic layer is ready after geometry passes | Underlying map geometry if MapEval is skipped |

Treat the metrics as complementary. A map can score well on global geometry and still contain a stationary person. A map can be clean of dynamic objects and still fail local consistency because loop closure bent a wall or doubled a curb.

## Publication Gates

| Gate | Pass evidence | Fail action |
|---|---|---|
| Geometry gate | AWD/AC/CD/GCP residuals below domain thresholds; no uncontrolled high-error regions | Re-run alignment, improve GCPs, rerun local SLAM, or split map components. |
| Local-consistency gate | SCS/MME and surface-thickness diagnostics stable across overlaps | Inspect loop closures, LAMM/Uni-Mapper residuals, and map-merging constraints. |
| Coverage gate | COM and tile density meet operational coverage targets | Re-survey missing plazas, alleys, terminal frontages, service corridors, utility edges, or apron corners. |
| Dynamic-residual gate | Cleaning evidence shows ghost trails and moving-object artifacts are below thresholds | Run ERASOR/Removert/BeautyMap/Raymoval/FreeDOM-style cleanup or route to review. |
| Static-transient gate | Movable-static and do-not-delete objects have reviewer disposition | Quarantine region or mark as non-publishable until a human decides keep/delete/unknown. |
| Semantic-entry gate | Source-map geometry passes before segmentation mIoU is trusted | Do not report semantic model quality against a distorted or unverified source map. |
| Runtime-publication gate | QA report, metrics config, source-map hash, transform, reference-map hash, and failure regions appear in the map manifest | Block signed map release or restrict the affected ODD region. |

For non-road urban districts, explicitly track plazas, sidewalks, courtyards, transit forecourts, building frontages, stairs, ramps, railings, utility infrastructure, loading docks, parked bicycles/scooters, movable signage, and service alleys. Road-driving thresholds and class coverage are not enough for those spaces.

## Architecture Comparison

| Architecture | Where MapEval helps | Advantage | Caveat |
|---|---|---|---|
| Segment-then-fuse | Scores the accumulated geometric map that receives fused labels | Reuses live perception labels and gives cross-pass consistency | Frame labels can hide geometry drift if map QA is skipped. |
| Fuse-map-then-segment | Gates the source map before the heavy map-scale segmenter runs | Best fit for aggregated-map semantic segmentation | Needs dense reference or high-quality control geometry for full metrics. |
| LiDAR-only map pipeline | Evaluates geometry independent of camera calibration | Robust to lighting and privacy constraints | Cannot evaluate color/texture correctness or image-derived label evidence. |
| LiDAR+image map pipeline | Separates geometric QA from colorization/projection QA | Prevents image features from masking poor geometry | Camera-LiDAR calibration, exposure, and rolling-shutter errors still need separate gates. |
| Foundation-model-assisted pseudo-labeling | Provides a source-map gate before candidate labels are trusted | Keeps SAM/CLIP/LOSC/SALT/SAM4D-style outputs from becoming release truth too early | Does not score prompt quality or semantic taxonomy mapping. |
| QA-gated active learning loop | Turns high-error tiles into recollection/relabeling tasks | Efficiently targets the worst geometry and label regions | Needs thresholds, reviewer queues, and manifest fields to be operational. |

## Domain Fit

| Domain | Fit | Why |
|---|---|---|
| Urban road AV mapping | Strong | Directly checks MLS map geometry before HD-map semantic layers and localization maps are published. |
| Non-road urban districts | Strong | Campuses, plazas, terminal frontages, sidewalks, courtyards, and service alleys need geometry QA outside road-only metrics. |
| Airport airside | Strong architecture, private-data dependent | Open aprons and repeated stands require GCP/RTK plus map-quality diagnostics before semantic-map release. |
| Logistics yards and ports | Strong | Containers, trailers, movable equipment, and repeated lanes make transient contamination and local consistency checks essential. |
| Construction and mining | Conditional | Map evolution may be legitimate terrain change rather than mapping error; use change policy before failing the map. |
| Warehouses and indoor service robots | Conditional | Dense geometry and reference scans make MapEval useful, but repeated aisles and movable racks need strong static-transient policy. |

## Failure Modes

| Failure mode | Effect | Mitigation |
|---|---|---|
| Sparse or partial reference map | Metrics understate errors outside reference overlap | Report COM and reference-coverage maps; do not score unobserved regions as good. |
| Bad initial alignment | MapEval reports alignment error rather than map-construction error | Store transform provenance and rerun with independent registration or GCP anchors. |
| Loop-closure deformation | Global ATE improves while local surfaces thicken or bend | Use SCS/MME and surface-thickness diagnostics next to trajectory metrics. |
| MME-only no-GT comparison overused | Local entropy becomes a weak proxy for full map quality | Treat no-GT MME as screening only; require reference/control evidence for publication. |
| Dynamic object removal scored as geometry | Ghost trails may look like plausible local structure | Pair MapEval with dynamic-cleaning PR/RR/F1 and map-hygiene labels. |
| Stationary people or parked objects persist | Geometry may score well because the object is consistent | Add semantic quarantine, temporal persistence, and reviewer disposition. |
| Seasonal vegetation and construction changes | Real changes look like errors against an old reference | Separate map-quality failure from approved site evolution through version-control policy. |
| Glass, wet pavement, and reflective surfaces | Sparse/noisy returns distort local metrics | Add artifact-removal evidence and sensor-condition metadata. |
| Repetitive architecture | False loops can produce locally plausible but globally wrong maps | Inspect loop evidence, robust PGO diagnostics, and repeated-place negatives. |
| Camera-LiDAR projection errors | LiDAR+image labels may look wrong despite good geometry | Keep projection QA separate from MapEval geometry QA. |

## Implementation Notes

1. Store MapEval config beside the map QA report: voxel size, thresholds, MME radius, alignment transform, reference-map hash, and filtering policy.
2. Evaluate maps before semantic segmentation and again after dynamic/static cleanup if cleanup can alter geometry or coverage.
3. Run the full reference-map metric suite where survey-grade TLS, GCP-aligned MLS, Leica scans, or dense prior maps exist. Use MME-only mode only as a screening signal.
4. Report metrics per region and tile, not just globally. A good airport- or campus-wide average can hide a failed hold-short zone, frontage, stair, or alley.
5. Keep semantic metrics separate: mIoU, boundary F1, unknown rate, and class recall belong to the semantic layer; AWD/SCS/AC/COM/CD/MME belong to the source map.
6. For LAMM and Uni-Mapper outputs, attach retained/rejected loop evidence and connected-component IDs so MapEval failures can be traced back to the merge step.
7. For dynamic-object removal outputs, pair map-quality metrics with static-preservation and false-deletion evidence; a cleaner map is not automatically a safer map.
8. For LiDAR+image maps, require a separate projection/calibration QA record before using colorized points or image-derived pseudo-labels.

## Deployment Readiness

MapEval is source-mature enough for a first-class reference page: it has an IEEE RA-L 2025 paper, DOI metadata, a public repository, C++/Python implementation, build instructions, test-data links, visualization scripts, and active README updates. It is still a research/evaluation artifact, not a production map-certification standard.

Before embedding it in a production map-release pipeline, verify:

- exact repository license file and dependency licenses, even though the README reports MIT licensing,
- deterministic build and replay on the map-processing image,
- metric threshold calibration for each ODD and map resolution,
- reference-map acquisition and alignment procedure,
- behavior on no-reference regions,
- integration of failure regions into the semantic-map manifest and publication gates.

## Sources

- Hu et al., "MapEval: Towards Unified, Robust and Efficient SLAM Map Evaluation Framework," IEEE Robotics and Automation Letters 10(5):4228-4235, 2025, DOI `10.1109/LRA.2025.3548441`: https://doi.org/10.1109/LRA.2025.3548441
- arXiv record and HTML: https://arxiv.org/abs/2411.17928 and https://ar5iv.org/html/2411.17928v2
- Official repository: https://github.com/JokerJohn/Cloud_Map_Evaluation
- HKUST research portal record: https://researchportal.hkust.edu.hk/en/publications/mapeval-towards-unified-robust-and-efficient-slam-map-evaluation-/
- LEMON-Mapping follow-on using MME context: https://arxiv.org/abs/2505.10018
- NIST colored point-cloud AV sensor-fusion quality evaluation: https://www.nist.gov/publications/quality-evaluation-colored-point-clouds-produced-autonomous-vehicle-sensor-fusion
