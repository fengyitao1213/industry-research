# LiDAR Map Cleaning and Dynamic Removal

<!-- method-priority:start
priority:
  learning: 4
  deployment: 5
  type: "method-family"
  stage: "deployment-pattern"
  maturity: "pilot-proven"
  tags: ["slam", "mapping", "validation", "runtime-localization", "outdoor"]
  reason: "LiDAR Map Cleaning and Dynamic Removal is rated for dynamic-object filtering and map-cleaning workflows that protect localization maps."
method-priority:end -->

## Executive Summary

LiDAR map cleaning removes transient, dynamic, ghost, and artifact points from accumulated point-cloud maps so localization, planning, QA, and annotation operate on a stable representation of the environment. It is broader than online moving-object segmentation. A production airside stack needs both runtime dynamic masks and offline static-map cleaning.

Core methods include ERASOR, Removert, MapCleaner, ERASOR++, 4dNDF, and MOS-style evaluation such as LiDAR-MOS and HeLiMOS. The safest map lifecycle separates four layers:

- Static persistent map: surveyed structure used for localization.
- Movable-static layer: aircraft, GSE, cones, barriers, and staged equipment.
- Dynamic layer: moving objects observed during a run.
- Artifact layer: weather, ghost, multipath, saturation, and sensor contamination.

## Technique Taxonomy

| Family | Methods | Main evidence | Best use |
|---|---|---|---|
| Visibility/range-image cleaning | Removert | Query-to-map range inconsistency and multiresolution revert | Offline map cleaning with pose uncertainty. |
| Pseudo-occupancy cleaning | ERASOR | Egocentric pseudo-occupancy ratio and ground refinement | Removing object traces from accumulated maps. |
| Terrain and voting cleaning | MapCleaner | Terrain model, object-part separation, local observation voting | Learning-free map cleaning with ground-aware processing. |
| Enhanced occupancy coding | ERASOR++ | Height coding descriptor and dynamic-bin tests | More precise occupancy-based dynamic bin identification. |
| Neural implicit 4D mapping | 4dNDF | Time-dependent TSDF, sparse feature grids, learned static extraction | Research-grade dynamic scene reconstruction and map extraction. |
| Online MOS | LiDAR-MOS, 4DMOS, HeLiMOS-style evaluation | Moving/static point labels over time | Runtime masking and dataset evaluation. |
| Multi-session consensus | Fleet map lifecycle | Persistence across days/shifts | Production promotion or rejection of map changes. |

## Map Lifecycle Pipeline

1. Collect synchronized LiDAR, pose, GNSS/INS, wheel/IMU, weather, and sensor-health logs.
2. Produce a high-quality trajectory using LIO/SLAM plus loop closure and control points.
3. Build an initial raw map and preserve raw scan provenance.
4. Apply runtime dynamic masks if available, but do not trust them as final map truth.
5. Run offline cleaning with ERASOR, Removert, MapCleaner, ERASOR++, or another validated method.
6. Compare multiple cleaners or parameter sets and inspect disagreement.
7. Assign map points to static, movable-static, dynamic, artifact, or unknown layers.
8. Validate localization on the cleaned map and on raw-map baseline.
9. Publish a map package with cleaner configuration, diagnostics, and QA evidence.
10. Update production maps only through change-control and multi-session evidence.

## Deployment Decision Rules

| Scenario | Rule |
|---|---|
| Single survey pass with aircraft present | Do not promote aircraft surfaces into the static localization map. |
| Same object appears across one shift | Keep in movable-static or unknown until cross-session policy confirms persistence. |
| Cleaner removes static stand equipment | Reject or retune the map build; static erosion is a localization risk. |
| Cleaner disagreement is high | Route segment needs manual QA or more data. |
| Dynamic ratio is high in a segment | Add a dedicated quiet survey or use multi-session cleaning. |
| Open apron has low static inlier count after cleaning | Use additional anchors, GNSS/INS, radar, or map landmarks; do not over-clean. |
| Wet or reflective artifacts appear in map | Use artifact layer and avoid training/localization on those points. |

## Method Comparison

Report cleaner results in the metric vocabulary established by **The Dynamic Points Removal Benchmark** (see Recent Methods, below): point-level **Static Accuracy (SA)** — fraction of true-static points preserved — **Dynamic Accuracy (DA)** — fraction of true-dynamic points removed — and the **Harmonic / Associated Accuracy (HA / AA)** that combines the two. SA captures the static-erosion failure mode; DA captures residual ghosting; HA is the single comparison number. Numbers below are from the cited papers on SemanticKITTI / KITTI sequences and are indicative only — re-measure on airside data before relying on them.

| Method | Strength | Weakness | Airside note |
|---|---|---|---|
| ERASOR | Fast, explainable pseudo-occupancy and ground-aware removal | Can erode static structure under pose/sparsity issues; per-dataset parameter tuning | Strong baseline for vehicle/person traces; validate around aircraft gear and stand objects. |
| Removert | Revert stage helps recover false removals from pose/projection error | Needs good poses and range-image adaptation; multiresolution thresholds need tuning | Good for preserving static airport geometry after aggressive removal. |
| MapCleaner | Terrain model plus observation voting; learning-free | Terrain assumptions can fail with ramps, curbs, and unusual apron equipment | Useful where ground/object separation is reliable. |
| ERASOR++ | Adds height coding and tests to improve bin decisions | Newer research baseline; implementation maturity must be checked | Promising for complex vertical structure. |
| 4dNDF | Learns a time-dependent implicit representation and extracts static map | GPU/optimization cost and research-stage deployment | Useful for offline QA and future dense reconstruction, not first production cleaner. |
| DUFOMap | Online ray-casting; one scene-independent parameter set across ODDs/sensors | Ray-casting cost; depends on observation coverage of empty space | Best fit where no airside tuning data exists — avoids per-dataset retuning entirely. |
| BeautyMap | Offline; binary-matrix voxel-column encoding, very fast (~0.046 s/cloud); high SA/DA/HA | Offline only; voxel-column model assumes near-vertical structure | Strong default offline cleaner; speed suits large multi-pass apron surveys. |
| OTD | Online, current-frame-only via ground-contact observation timing; low latency (~24 ms/frame) | Relies on ground-contact cue; current-frame scope limits long-horizon evidence | Candidate for runtime masking on the airside rig where per-frame budget is tight. |
| DeFlow | Learning-based scene-flow network; SOTA Argoverse 2 scene flow; dynamics from predicted motion | Degrades under train/test domain shift; needs representative training data | Not a first choice airside — no airside training data; treat as research/eval only. |
| MOS networks | Runtime dynamic labels; can catch moving actors early | Training-domain and sensor-pattern sensitivity | HeLiMOS-style multi-LiDAR evaluation is valuable for airside rigs. |

## Recent Methods (2024-2026)

The five core methods above remain valid baselines, but 2023-2026 work has narrowed two practical gaps for airside use: removing per-dataset parameter tuning, and establishing a shared way to report results.

### The Dynamic Points Removal Benchmark (ITSC 2023)

The standard open benchmark for this method family — *Benchmarking and Refactoring Dynamic Removal SLAM Methods* (https://arxiv.org/abs/2307.07260, repo https://github.com/KTH-RPL/DynamicMap_Benchmark). It unifies ERASOR, Removert, Octomap, dynablox, DUFOMap, BeautyMap, and DeFlow under one refactored codebase and one evaluation protocol, scoring each at the point level with **Static Accuracy (SA)**, **Dynamic Accuracy (DA)**, and the combined **Harmonic / Associated Accuracy (HA / AA)**. This SA/DA/HA vocabulary is the canonical way to report cleaning results and is the basis for the Method Comparison table above. For airside work it also matters as a methodology template: a single harness that runs several cleaners on the same data is exactly the "compare multiple cleaners and inspect disagreement" step in the Map Lifecycle Pipeline, and it should be the starting point for an airside cleaning evaluation rather than re-implementing each method.

### DUFOMap — single-parameter-set online removal (RA-L 2024)

*DUFOMap: Efficient Dynamic Awareness Mapping* (https://arxiv.org/abs/2403.01449, IEEE RA-L 2024). An online ray-casting method that classifies a region as dynamic only after confirming it as a **fully observed empty region** — empty space that has been positively observed, not merely unobserved. Its decisive property is that **one scene-independent parameter set transfers across ODDs and sensors** with no per-dataset tuning, in contrast to ERASOR and Removert, which expect per-dataset threshold tuning. For airside this is the single most useful trait on offer: there is no airside tuning data and no public airside benchmark, so a method that does not need tuning removes a whole class of validation risk.

### BeautyMap — fast offline removal via binary matrices (RA-L 2024)

*BeautyMap: Binary-Encoded Adaptable Ground Matrix for Dynamic Points Removal in Global Maps* (https://arxiv.org/abs/2405.07283, IEEE RA-L 2024). An offline method that encodes each voxel column as a binary matrix and detects dynamics by **bitwise comparison** between query and map columns. On KITTI Sequence 01 it reports SA 99.17 / DA 92.99 / HA 95.98, ahead of ERASOR (98.12 / 90.94 / 94.39) and Removert, at roughly 0.046 s per cloud. The combination of high static preservation and low cost makes it a strong default offline cleaner; the voxel-column model assumes near-vertical structure, which is a reasonable fit for apron buildings and GSE but should be checked against ramps and sloped equipment.

### Observation Time Difference (OTD) — low-latency online removal (2024)

*Dynamic Object Removal for Point Cloud Map Construction Based on Observation Time Difference* (https://arxiv.org/abs/2406.15774). An online method that operates on the **current frame only**, using the observation timing of ground-contact points to separate dynamic returns. It reports F1 of 0.972-0.988 on SemanticKITTI at about 23.8 ms per frame — over 60% faster than the methods it compares against. The current-frame scope and low per-frame cost make it a candidate for the runtime dynamic-mask role on the airside rig, where the Orin cycle budget is tight; the trade-off is that current-frame-only evidence is weaker for slow or briefly stationary actors than multi-frame methods.

### DeFlow — learning-based removal via scene flow (ICRA 2024)

*DeFlow: Decoder of Scene Flow Network in Autonomous Driving* (https://arxiv.org/abs/2401.16122, ICRA 2024). A learning-based approach: a scene-flow network predicts per-point motion and dynamic points are derived from the predicted flow. It reports state-of-the-art results on Argoverse 2 scene flow and is included in the Dynamic Points Removal Benchmark. The honest caveat is the one that applies to every learned method here: **scene-flow networks degrade under train/test domain shift.** With no airside training data and airport-specific classes (aircraft, GSE, tow bars) absent from road datasets, DeFlow should be treated as a research/evaluation candidate, not a first production cleaner — consistent with the "learned dynamic masks fail on airport-specific classes" failure mode below.

## Failure Modes

- Dynamic objects parked during mapping become persistent static clutter.
- Temporarily absent static objects are interpreted as removed infrastructure.
- Static erosion removes thin or low structures needed by localization.
- Ground segmentation mistakes remove ramps, curbs, chocks, tow bars, or aircraft gear.
- Pose error creates false disagreement and aggressive removal.
- Learned dynamic masks fail on airport-specific classes not present in road datasets.
- Cleaned maps improve appearance but reduce scan-matching observability.

## Airside Validation Guidance

Build validation sets from:

- Quiet survey passes and busy operational passes on the same route.
- Stands with aircraft present and absent.
- GSE staging areas across multiple shifts.
- Wet and dry apron captures.
- Night and day captures with reflective markings.
- De-icing and winter operations where allowed.
- Repeated gate layouts to test localization aliasing.

Metrics:

- Static preservation rate by infrastructure class.
- Dynamic rejection rate by actor class.
- Movable-static classification accuracy.
- Map ghost rate per 100 m or per stand.
- Localization ATE/RPE, residual, inlier count, and degeneracy.
- Change-detection precision across map versions.
- Manual QA burden per kilometer or per stand.

## Map Cleaning as a Prerequisite for Map Segmentation

Cleaning is not only a localization concern — it is a hard **prerequisite for end-to-end semantic segmentation of the aggregated map** (see `../../perception/overview/aggregated-map-semantic-segmentation.md`, which treats dynamic removal as non-optional pre-processing). The relationship runs both ways.

**Cleaning feeds segmentation.** Ghost trails left by un-removed dynamic objects belong to no semantic class. A segmentation model forced to label them pollutes the dominant "stuff" classes (ground, building) and — worse — corrupts the single-scan auto-labels back-projected from the map. Segment a dirty map and the error propagates into every downstream training set.

**The aggressiveness trade-off, seen from the segmentation side.** The "static erosion" failure mode above is precisely the failure that hurts segmentation most: over-cleaning deletes thin static structure — poles, fences, kerbs, painted markings — which are exactly the rare, hard, high-value classes whose IoU is already fragile. Under-cleaning leaves residue. The resolution is the one the segmentation taxonomy assumes: **clean conservatively, and let the segmentation taxonomy's quarantine class absorb the residue.** The *movable-static layer* defined in this page's Executive Summary maps one-to-one onto the segmentation taxonomy's "staged GSE / permitted-static" class. Keeping the layer definition and the class definition aligned is what lets the cleaner's output and the segmenter's output agree.

**Segmentation feeds cleaning QA.** Once a learned segmentation model exists it becomes a downstream *validator* of cleaning quality: a region the model labels with persistently low confidence, or that no class explains, is a strong candidate for incomplete cleaning or ghosting. Agreement between the per-point map-layer assignment (static / movable-static / dynamic / artifact) and the semantic label is a free cross-check — it complements the "cleaner disagreement → manual QA" rule in Deployment Decision Rules.

**Ordering and provenance.** The pipeline order is fixed: **clean → condition → segment**. The point provenance recommended in Implementation Notes (source scan, timestamp, pose, cleaner decision, map layer) should carry through to the labeled map, so a mis-segmented region can be traced back to the cleaner decision that produced it.

**Cleaner choice for the offline conditioning pass.** Among the Recent Methods, DUFOMap's single scene-independent parameter set (no per-dataset tuning) and BeautyMap's high static preservation at ~0.046 s/cloud make both strong candidates for the offline conditioning pass that precedes segmentation, where conservative, repeatable cleaning over large multi-pass surveys matters more than per-frame latency.

## Implementation Notes

- Store point provenance: source scan, timestamp, pose, cleaner decision, and map layer.
- Use a rejected-points review workflow; do not discard dynamic or artifact layers.
- Compare ERASOR and Removert as complementary baselines before adopting a single default.
- Use MapCleaner/ERASOR++/4dNDF as evaluation candidates where their assumptions match the data.
- Treat 4dNDF as offline research/QA until runtime, uncertainty, and maintainability are proven.
- Use HeLiMOS-style labels to evaluate multi-LiDAR rigs separately and after fusion.

## Sources

- ERASOR paper: https://arxiv.org/abs/2103.04316
- ERASOR repository: https://github.com/LimHyungTae/ERASOR
- Removert repository: https://github.com/gisbi-kim/removert
- Removert paper record: https://snu.elsevierpure.com/en/publications/remove-then-revert-static-point-cloud-map-construction-using-mult
- MapCleaner: https://www.mdpi.com/2072-4292/14/18/4496
- ERASOR++: https://arxiv.org/abs/2403.05019
- 4dNDF paper: https://arxiv.org/abs/2405.03388
- 4dNDF repository: https://github.com/PRBonn/4dNDF
- Dynamic Points Removal Benchmark paper: https://arxiv.org/abs/2307.07260
- Dynamic Points Removal Benchmark repository: https://github.com/KTH-RPL/DynamicMap_Benchmark
- DUFOMap paper: https://arxiv.org/abs/2403.01449
- BeautyMap paper: https://arxiv.org/abs/2405.07283
- Observation Time Difference (OTD) paper: https://arxiv.org/abs/2406.15774
- DeFlow paper: https://arxiv.org/abs/2401.16122
- HeLiMOS dataset: https://sites.google.com/view/helimos/dataset
- HeLiMOS toolbox: https://github.com/url-kaist/HeLiMOS-PointCloud-Toolbox
