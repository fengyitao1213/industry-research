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

Dynamic removal is also a hard **prerequisite** before semantic segmentation of any aggregated map: ghost trails left by moving objects pollute static classes and corrupt the back-projected auto-labels that drive MOS and semantic-segmentation training pipelines. The pipeline order is fixed — **clean → condition → segment** — and cannot safely be reversed without a pre-existing class-specific detector.

Core methods include ERASOR, Removert, MapCleaner, ERASOR++, FreeDOM, DUFOMap, [BeautyMap](beautymap.md), OTD, [Raymoval](raymoval.md), detector-based potentially dynamic object removal, dynamic-aware and multi-session map merging through [Uni-Mapper](uni-mapper-dynamic-aware-lidar-map-merging.md) and [LAMM](lamm-multi-session-point-cloud-map-merging.md), lifecycle governance, and post-cleaning geometry QA through [MapEval](mapeval-point-cloud-map-quality-evaluation.md). MOS-style evaluation such as LiDAR-MOS and HeLiMOS scores moving/static labels; MapEval scores the resulting point-cloud map geometry. The safest map lifecycle separates four layers:

- **Static persistent map**: surveyed structure used for localization.
- **Movable-static layer**: aircraft, GSE, cones, barriers, and staged equipment.
- **Dynamic layer**: moving objects observed during a run.
- **Artifact layer**: weather, ghost, multipath, saturation, and sensor contamination.

## Point-Cloud Removal Problem Decomposition

The phrase "remove dynamic points" is too narrow for an aggregated-map pipeline. A production map cleaner must decide which points are **valid permanent map evidence**, which points are **valid observations but not permanent map truth**, and which points are **sensor or reconstruction artifacts**. The distinction is operationally important because the permanent layer feeds localization, map-change detection, semantic segmentation, and auto-label generation.

| Removal target | Typical examples | Why classical dynamic removal misses it | Required evidence | Correct map action |
|---|---|---|---|---|
| Dynamic residual points | Moving vehicles, pedestrians, GSE ghost trails, moving aircraft sweeps | It catches these only when later scans provide free-space contradiction or time-distribution evidence | Free-space ray evidence, pseudo-occupancy drop, timestamp distribution, MOS label, scene flow, Doppler | Remove from permanent map; preserve in dynamic/rejected evidence layer |
| Stationary-but-transient objects | Stationary people, parked aircraft, parked belt loader, staged baggage carts, temporary barriers | No free-space contradiction occurs during the survey because the object never moves in the observation window | Semantic class, operational zone, K-of-N persistence, later absence, permit/flight/stand schedule | Quarantine in movable-static or transient-candidate layer; do not back-project as permanent training truth |
| Static points that do not belong in the map | FOD, snow pile, construction material, puddle reflection, de-icing residue, moved chock, temporary cone | It is genuinely static in the scan sequence, so geometry alone cannot know it is non-permanent | Class policy, TTL, future absence, FOD rule, operations log, human review | Route to FOD-candidate, artifact, or change-review layer |
| True permanent thin structure | Poles, signs, kerbs, fences, drains, painted markings, apron edge lights | Aggressive cleaners can delete these while chasing dynamic points | Multi-pass persistence, stable class, geometry QA, localization utility | Preserve; false deletion is often worse than residual clutter |
| Real infrastructure change | New fence, removed bollard, changed stand marking, construction completion | Looks like a contradiction between map versions, not a moving object | Multi-session positive/negative change evidence, map authority, reviewer decision | Promote through map-change workflow, not through dynamic cleaner alone |

This decomposition aligns the dynamic-cleaning page with the [ML-related SLAM research scope](../overview/ml-related-slam-research-scope.md), [Static-But-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), and the [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) hub. It also clarifies why a single published benchmark score is insufficient: a method with excellent dynamic rejection can still be unsafe if it erases permanent thin structures or bakes stationary GSE into the localization map.

### Non-Road Urban and Managed-Site Implications

Road AV datasets under-represent the exact removal cases that matter in managed districts. Airports have stationary aircraft and GSE. Ports have staged containers, chassis, reach stackers, and cranes. Warehouses have pallets, forklifts, and people that can stand still for long periods. Campuses and pedestrian districts have benches, temporary signs, stationary crowds, vegetation changes, and construction material. Utility corridors have poles, cables, insulators, vegetation, trenches, and maintenance equipment.

The cleaner therefore needs a **map-layer policy** rather than a binary static/dynamic classifier:

- permanent: repeatedly confirmed infrastructure that supports localization and semantic map publication;
- movable-static: objects that can be static during the survey but should not be permanent map truth;
- dynamic: objects with motion or free-space contradiction evidence;
- artifact: sensor/weather/reconstruction noise;
- FOD-candidate or hazard-candidate: small ground-level objects that require a safety workflow rather than map promotion;
- change-review: candidate infrastructure changes that may become permanent after review.

For non-road urban districts, the safest default is conservative deletion plus explicit quarantine. Under-removal can be reviewed and removed later; over-removal of thin permanent structure directly weakens localization and rare-class semantic segmentation.

---

## Why Dynamic Removal is a Hard Prerequisite for Segmentation

When a robot traverses an environment and accumulates sequential LiDAR scans into a single global point cloud, every moving object — vehicles, pedestrians, GSE tuggers, belt loaders — contributes points at each scan in which it is visible. Because the object moves between scans, these contributions are spatially distinct: the result is a "ghost trail" or "smear" scattered along the object's trajectory, localized at no single position.

**Ghost trails corrupt aggregated-map segmentation in two ways:**

1. **Class-label pollution.** Ghost-trail points carry the geometry of cars, people, or GSE but occupy free airspace or overprint static structure (tarmac, walls). Stuff classes such as `road`, `terrain`, `ground`, and `building` absorb these stray points as false positives; object classes acquire spatially incoherent clusters. Segmentation mIoU degrades because the model must reconcile geometrically anomalous points that belong to no stable semantic class.

2. **Auto-label corruption.** When a cleaned aggregated map is back-projected onto individual scan frames to generate pseudo-labels for MOS or semantic-segmentation training, ghost-trail points project nonsensical labels onto raw scan frames. Segment a dirty map and the error propagates into every downstream training set. Cortinhal et al. (2022) use ERASOR as the map-cleaning pre-step before occupancy-grid-based auto-label generation, explicitly because a dirty map propagates erroneous dynamic-class labels through the entire training-data pipeline.

**The clean-then-segment ordering** removes dynamic traces first, yielding a geometrically consistent point cloud in which every point belongs to a stable, permanently occupied structure. The segmenter then runs on a map where "stuff" classes are genuinely stuff and object geometry reflects actual static objects.

**Alternative — segment-then-clean** is workable if a reliable per-class dynamic-object segmenter already exists: remove all points classified as `car`, `person`, etc. before accumulation. However, this requires a trained model, commits to a fixed class set, and misses unlabeled or atypical movers (e.g., non-standard GSE). Geometry-only removers are class-agnostic and safer as a first pass.

**Cross-reference:** `../../perception/overview/aggregated-map-semantic-segmentation.md` — §9.1 treats dynamic removal as non-optional pre-processing; §2.4 describes the accumulate-then-segment pipeline ordering. Also see `../../perception/overview/lidar-artifact-removal-techniques.md` for the complementary artifact-removal pass that removes weather, multipath, and sensor-contamination points.

---

## Technique Taxonomy

| Family | Methods | Main evidence | Best use |
|---|---|---|---|
| Visibility / range-image cleaning | Removert, [Raymoval](raymoval.md) | Query-to-map range inconsistency and multiresolution revert | Offline map cleaning with pose uncertainty. |
| Pseudo-occupancy cleaning | ERASOR | Egocentric pseudo-occupancy ratio and ground refinement | Removing object traces from accumulated maps. |
| Enhanced height coding | ERASOR++ | Height coding descriptor and dynamic-bin tests | More precise occupancy-based dynamic bin identification. |
| Occupancy / voxel-ray | OctoMap, DUFOMap, Dynablox | Bayesian voxel or void-region free-space detection | Online or offline; DUFOMap preferred for tuning-free operation. |
| Conservative free-space | FreeDOM | Raycast enhancement + DynamicLevel hierarchy | Online + offline; best published F1 as of early 2025. |
| Timestamp / observation-timing | OTD | First/last observation time difference per voxel | Low-latency online removal on tight compute budgets. |
| Spatiotemporal timestamp distribution | DynPurge (watchlist) | Distribution differences in global-map point timestamps | Promising for global-scale map cleanup, but not atomic-page ready without public code or metric tables. |
| Terrain and voting cleaning | MapCleaner | Terrain model, object-part separation, local observation voting | Learning-free map cleaning with ground-aware processing. |
| Binary voxel matrix | [BeautyMap](beautymap.md) | Bitwise column comparison | Fast offline cleaning with high static preservation. |
| Neural implicit 4D mapping | 4dNDF | Time-dependent TSDF, sparse feature grids, learned static extraction | Research-grade dynamic scene reconstruction and map extraction. |
| Online MOS | LiDAR-MOS, 4DMOS, MambaMOS, HeLiMOS-style | Moving/static point labels over time | Runtime masking and dataset evaluation. |
| Instance-level and semantic removal | ERASOR2, Potentially Dynamic Object Removal by Ground Projection | 3D detection, ground segmentation, projection, and geometry fallback | Handles parked-but-movable objects when the detector/taxonomy covers them. |
| Learning / scene flow | DeFlow | GRU-refined scene flow; dynamics from predicted motion | Research/evaluation; degrades under domain shift. |
| Dynamic-aware and multi-session map merging | [Uni-Mapper](uni-mapper-dynamic-aware-lidar-map-merging.md) / DynaSTD; [LAMM](lamm-multi-session-point-cloud-map-merging.md) / BTC | Dynamic filtering before place descriptors, false-loop filtering, and graph optimization | Merging heterogeneous or repeated LiDAR sessions without trusting dynamic objects or false loops as map-alignment evidence. |
| Post-cleaning map-quality evaluation | [MapEval](mapeval-point-cloud-map-quality-evaluation.md) | AC, COM, CD, MME, AWD, SCS over estimated and reference point-cloud maps | Verifying that cleaned or merged maps are geometrically consistent before semantic segmentation, localization regression, or publication. |
| Multi-session consensus and version control | Fleet map lifecycle, Lifelong 3D Map Version Control | Persistence across days / shifts, PD/ND diffs, reconstructable map versions | Production promotion, rejection, rollback, and queryable map-change history. |

### Semantic-Map Removal Stack Selector

Use this selector before publishing an aggregated semantic map or exporting map-derived training labels. It turns the method taxonomy into an ordered removal stack and avoids the common mistake of asking one algorithm to solve dynamic residuals, stationary people, FOD, and infrastructure change at the same time.

| Dominant condition | Primary method stack | Secondary evidence | Default release state | Guardrail |
|---|---|---|---|---|
| Weather, ghost, multipath, or registration artifact | Classical/learned artifact filters plus ghost/multipath diagnostics | Raw-vs-filtered point evidence, weather slice, pose residual, sensor health | `artifact` | Do not train semantic positives or localization references from filtered artifact clusters. |
| In-session dynamic residual | FreeDOM, ERASOR++, Raymoval, BeautyMap, DUFOMap, OTD, MOS, scene flow | Free-space contradiction, timestamp spread, motion label, rejected-layer digest | `dynamic_residual` | Preserve ground, markings, poles, fences, drains, and edge lights with static-preservation tests. |
| Stationary person or crew | Human semantic/detector/thermal cue plus policy hard exclusion | Reviewer label, privacy policy, zone/camera evidence | `static_transient` | No persistence, K-of-N rule, or localization utility may promote a person into permanent map truth. |
| Parked movable asset | Detector-ground projection, semantic class, multi-session absence, asset registry | GSE/vehicle/aircraft/container class, stand schedule, operations log | `movable_static` | May be retained only as low-weight context; never as default training-positive or FOD baseline evidence. |
| Small unknown ground object or FOD candidate | Ground-cluster rule plus FOD workflow | Size/height, no prior support, inspection ticket, short TTL | `fod_candidate` | Do not erase as noise and do not promote into pavement; publication must keep it outside the permanent layer. |
| Real infrastructure change | Multi-session map version control, MapEval, map authority review | Positive/negative change evidence, registration covariance, work order | `unknown_review` until approved | Dynamic cleaners can propose a change region but cannot approve permanent promotion alone. |
| Protected permanent thin structure | Static-preservation audit plus semantic/taxonomy checks | Multi-pass support, localization contribution, rare-class label, manual sample | `permanent_static` | Over-cleaning is blocked if rare/thin-class recall or localization residual regresses. |

### Removal Gate Matrix for Semantic Map Production

The cleaning output should not be a binary "kept vs removed" point cloud. A releaseable semantic map needs a gate matrix that explains **why** each point was retained, removed, or quarantined, because downstream segmentation, localization, FOD detection, and auto-labeling use the same map differently.

| Point category | Typical evidence | Default action | Why | Release validation |
|---|---|---|---|---|
| Permanent static infrastructure | Repeated observations, stable geometry, permanent semantic class, low cleaner disagreement | Keep in permanent layer | Localization and change detection need these points | Per-class static preservation, localization residual, MapEval completeness, reviewer sampling |
| In-session dynamic residual | Free-space contradiction, range-image/raycast mismatch, MOS/scene-flow motion, timestamp spread | Remove from permanent; preserve in rejected/dynamic layer | Ghost trails corrupt segmentation labels and scan matching | Dynamic rejection rate, residual ghost clusters per tile, raw-vs-cleaned localization comparison |
| Stationary person | Semantic `person` or human detector/thermal evidence, even if no motion | Hard exclude from permanent; quarantine or discard according to privacy policy | A person is never map truth; persistence within one survey is irrelevant | 100% reviewed exclusion on human-labeled validation tiles; no K-of-N override |
| Parked vehicle / staged GSE / aircraft | Movable-object class, detector box, operational zone, or multi-session absence | Quarantine as movable-static unless explicitly registered as permanent infrastructure | Can be useful soft localization evidence but must not define the permanent map | Movable-static precision/recall; cross-session absence checks; class-list version audit |
| Temporary works or construction material | Work-zone metadata, cone/barrier/material class, low permanence confidence | Quarantine with TTL and work-order link | May persist for weeks but is not permanent without authority | TTL expiry audit; permit/work-order reconciliation; false-permanent review |
| FOD candidate / small unknown ground object | Small cluster, ground-level unknown label, no prior map support | Route to FOD-candidate layer, not permanent | Promoting debris into the map suppresses future FOD alarms | FOD retention test; false-deletion review; short TTL enforcement |
| Sensor/weather artifact | Ghost/multipath pattern, rain/spray/snow signature, low multi-view support | Artifact layer or discard | Should not train semantic classes or affect localization | Artifact-rate monitoring; weather-stratified QA |
| Static-but-wrong map point | Present in current release but absent in repeated future passes, or contradicted by surveyed permanent asset inventory | Demote through change-control, not one-pass deletion | Avoid erasing real infrastructure due to a bad pass or registration error | Negative-change review, registration covariance check, rollback-ready map version |

This matrix is deliberately conservative about promotion. Dynamic residual removal is an *evidence-removal* problem; static-but-transient handling is a *map-governance* problem. The first can be solved within a survey pass by ERASOR/FreeDOM/BeautyMap/Raymoval-style evidence; the second needs semantic policy, multi-session history, or operator authority.

For release packaging, route the matrix through the reason-coded decision table in [Static-But-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md): every non-permanent point should land in `dynamic_residual`, `movable_static`, `static_transient`, `fod_candidate`, `artifact`, or `unknown_review` with a reason code. A binary cleaned cloud is insufficient for semantic-map publication because it cannot explain whether a removed point was a moving ghost, a stationary person, a parked aircraft, a FOD candidate, or an artifact.

### Minimum Removal Sidecar for Semantic Maps

Every cleaner that contributes to a releaseable aggregated map should emit a sidecar table or parquet/JSONL record keyed by point digest, voxel digest, or cluster ID. The sidecar is the bridge between algorithm output and map publication: it lets downstream segmentation, localization, FOD detection, and training-export tools know whether a point was deleted, quarantined, retained, or sent to review.

| Field | Meaning | Why it is required |
|---|---|---|
| `source_point_or_cluster_id` | Stable point, voxel, component, or cluster key | Lets QA trace a release decision back to the raw cloud |
| `proposed_release_state` | One of `permanent_static`, `dynamic_residual`, `movable_static`, `static_transient`, `fod_candidate`, `artifact`, `unknown_review` | Prevents binary keep/remove outputs from hiding the map-hygiene state |
| `reason_code` | `free_space_contradiction`, `mos_scene_flow`, `human_exclusion`, `movable_asset_quarantine`, `small_ground_unknown`, `sensor_or_registration_artifact`, etc. | Makes the decision explainable without replaying the full pipeline |
| `semantic_evidence` | Class logits, detector box ID, open-vocabulary candidate, or reviewer class | Separates semantic class from permanence decision |
| `geometric_evidence` | Ray/free-space votes, view count, timestamp distribution, pose residual, MapEval region ID | Shows whether the point is unsupported, stale, or geometrically risky |
| `policy_evidence` | Zone polygon, TTL policy, asset registry match, work-order or inspection ticket | Captures non-ML reasons why stationary objects are not permanent |
| `downstream_permissions` | Allowed uses: localization reference, soft context, training positive, training negative, review only, publish blocked | Stops a point that is useful for one consumer from contaminating another |
| `review_state` | Auto accepted, reviewer accepted, reviewer rejected, waiver, pending | Supports audit and safety-case traceability |

The sidecar does not need to be point-level when clusters are the decision unit, but it must be reproducible: same source map, cleaner config, policy file, and reviewer state should regenerate the same release-state layers and reason-code counts.

---

## Method Families — Detailed

### Visibility / Ray-casting Based

**Core argument:** if a later scan observes a region as free space (the LiDAR ray passes through it), any map point sitting in that region is no longer supported by evidence and is likely a dynamic residual. A static wall cannot be ray-cast through by a later scan; a ghost car can.

**Removert** (IROS 2020) — "Remove, then Revert."
- Mechanism: each LiDAR scan is projected to a range image. A multi-resolution range-image stack (coarse → fine) is compared scan by scan. If the range value of a map point is *greater* than what the current scan returns along that ray, the map point is declared dynamic and removed. After removal at coarse resolution, a revert step at finer resolution recovers static points accidentally removed due to resolution-induced ambiguity.
- Math: for a map point `p` projected to pixel `(u,v)` in scan `s`, if `d_map(u,v) > d_scan(u,v) + ε`, mark `p` dynamic.
- Strengths: well-matched to omnidirectional spinning LiDAR; open-source; strong static preservation (high PR) on KITTI highway sequences.
- Limits: fails near object centers where occlusion is ambiguous; incidence-angle ambiguity on slanted surfaces generates false positives; range-image resolution degrades with distance; partial-FoV solid-state LiDARs require adaptation.
- Benchmark (SemanticKITTI): PR ~50.7%, RR ~82.3%, avg F1 ~0.836 (Raymoval 2025 comparison).
- See also: [`removert.md`](removert.md) for full method notes.

[**Raymoval**](raymoval.md) (RiTA 2025 / arXiv 2026) — extends Removert with azimuth-elevation projection plus spatial consistency validation.
- Mechanism: az-el grid projection → range-adaptive threshold comparison vs map first-hit raycasting → cluster-level reclassification (size, diameter, coverage overlap filters) that recovers boundary points and suppresses fragments.
- Results on SemanticKITTI: avg F1 ~0.927, PR ~93.2%, RR ~92.6%. Consistently outperforms Removert; slightly below ERASOR on averaged F1 but achieves higher PR on individual sequences. The paper qualitatively demonstrates partial-FoV construction-site robustness, but public numeric benchmark evidence remains SemanticKITTI.

### Occupancy / Voxel-Ray Based

**OctoMap** (ICRA 2010 / AR 2013)
- Mechanism: probabilistic octree. Each voxel accumulates Bayesian log-odds: hit → increment; ray passes through without hit → decrement. Dynamic points are those in voxels that flip from occupied to free over time.
- Strengths: foundational, mature, many variants.
- Limits: very slow (~2.98 s/frame on KITTI); probabilistic accumulation requires many scans to flip a voxel; misclassifies ground plane due to near-grazing incidence. Typical benchmark: F1 ~0.46 (RR ≈ 99.8% but PR ≈ 30% — canonical over-remover).

**DUFOMap** (RA-L 2024) — Dual Free-space Occupancy Map.
- Mechanism: void-region detection. Voxels are classified as *hit*, *intersected* (ray passed through), or *unknown*. A void voxel requires all neighbors to be hit/intersected first (conservative confirmation). Dynamic points = points falling into previously void voxels. Single-observation logic, unlike OctoMap's probabilistic accumulation.
- Speed: ~0.062 s/frame on KITTI (vs OctoMap's 2.98 s); sustains 20 Hz on a 4-core Intel NUC i7. Three universal parameters (voxel 0.1 m, ds = 0.2 m sensor noise margin, dp = 1 voxel localization error) — **no per-dataset tuning**.
- Results: 98.34% AA on KITTI vs ERASOR's 81.07% AA; outperforms Dynablox on semi-indoor sparse VLP-16 data.
- Key airside property: tuning-free operation eliminates the validation burden when no airside ground-truth cleaning data exists.

**Dynablox** (RA-L 2023) — TSDF-based ever-free space detection.
- Mechanism: Voxblox TSDF volumetric map maintained in a sliding window. "Ever-free" voxels are identified by thresholding TSDF values across sequential updates — a voxel once observed as free space cannot be permanently occupied, so any later points there are dynamic.
- Strengths: works in complex indoor environments; no appearance assumptions; diverse object types; 86% IoU at 17 FPS.
- Limits: conservative in labeling dynamic grids (high SA, weaker DA); under 10 Hz on sparse few-channel LiDARs; sliding window loses long-term history.

**M-Detector** (Nature Communications 2024) — occlusion-principle, point-by-point online.
- Mechanism: exploits occlusion geometry without a prior map. For each incoming LiDAR point, checks whether it falls in a region previously ray-observable. If a new point appears in such a region, it is moving. Single-point latency ~microseconds.
- Strengths: no prior map required; extremely low latency; works with diverse LiDAR sensors.

### Height / Pseudo-Occupancy / Scan-Ratio Based

**ERASOR** (RA-L 2021) — Egocentric Ratio of Pseudo Occupancy.
- Mechanism: the map region is organized into an egocentric cylindrical grid of N_r radial rings × N_θ azimuthal sectors = sector-ring bins S(i,j). Pseudo occupancy = vertical extent: `Δh(i,j) = sup{Z} − inf{Z}`. The Scan Ratio Test (SRT) compares Δh in the current scan to Δh in the accumulated map:

```
Scan Ratio = Δh_query / Δh_map
```

  If ratio < τ_SR (empirically 0.2), the bin is flagged: a large structure in the map is absent in the current scan → ghost. Flagged bins undergo Region-wise Ground Plane Fitting (R-GPF): PCA on lowest-height seed points → fitted ground plane within τ_g = 0.15 m → ground points restored; remaining non-ground points rejected.
- Strengths: 10× faster than Removert/OctoMap (~0.073 s/iteration); ground recovery avoids over-removal of terrain; handles occlusion.
- Limits: 2D descriptor loses height-layer information; under-performs on complex terrain (slopes, ramps); sensitive to z-axis odometry error; can remove tree trunks near pedestrian detections.
- Benchmark (SemanticKITTI): PR ~88–94%, RR ~95–99%, F1 ~0.921–0.955 across sequences 00–07.
- See also: [`erasor.md`](erasor.md) for full method notes.

**ERASOR++** (arXiv 2024) — Height Coding Plus Egocentric Ratio.
- Mechanism: replaces ERASOR's simple Δh descriptor with three new components:
  1. *Height Coding Descriptor (HCD)*: combines height-difference with a bitwise-encoded height-layer occupancy descriptor — each height layer in the bin is a bit, so middle-height occupancy is preserved.
  2. *Height Stack Test (HST)*: replaces SRT; analyzes layer-wise overlap between query and map while excluding ground layers.
  3. *Ground Layer Test (GLT)* + *Surrounding Points Test (SPT)*: GLT auto-identifies ground reference under z-axis odometry uncertainty; SPT corrects isolated false-positive dynamic bins by checking whether neighbors also flag (true dynamic objects cluster, noise does not).
- Results: PR 87–98% vs ERASOR's 81–93%; F1 0.930–0.986 vs ERASOR's 0.891–0.961; comparable runtime (~0.10–0.14 s/frame).
- See also: [`erasor-plus-plus.md`](erasor-plus-plus.md) for full method notes.

### Conservative Free-Space Based

**FreeDOM** (arXiv 2025) — online framework with conservative free-space estimation.
- Mechanism: two-stage pipeline.
  - *Scan-removal front-end*: raycast enhancement recovers depth in directions with no background hits (addresses the "too far = no return" failure mode); labels scan points by DynamicLevel `{static ≺ aggressive ≺ moderate ≺ conservative}`; only conservative-level free voxels (all neighbors consistently traversed ≥ τ_f times) are committed.
  - *Map-refinement back-end*: uses accumulated incremental free-space to eliminate residual dynamic map points in a second pass.
- Multi-resolution: FreeSpace at voxel resolution, StaticSpace at sub-voxel resolution.
- Results: avg F1 improvement of +9.7% over prior SOTA; KITTI seq 02 F1 = 99.59%, seq 07 = 98.33%; HeLiMOS Ouster = 97.15%; indoor corridor = 99.08%. Runs >10 Hz on laptop CPU; sensor-agnostic (Velodyne, Ouster, Livox, Aeva). Best published overall as of early 2025.
- See also: [`freedom-dynamic-object-removal.md`](freedom-dynamic-object-removal.md) for full method notes.

### Segmentation / Learning Based

**ERASOR2** (2023) — Instance-Aware Dynamic Removal.
- Mechanism: uses 3D instance segmentation to work at the instance level — all points belonging to a detected and tracked moving instance are flagged. Handles erroneous segmentation through fallback geometry checks for uncertain instances.
- Improvement over ERASOR: substantially higher PR and RR on crowded sequences; HeLiMOS F1 = 0.974–0.984. Handles parked vehicles gracefully: if a vehicle is *never observed moving*, it is preserved.

**YOLO + LiDAR integration** (Sensors 2024) — camera-based detection projected to 3D.
- Mechanism: YOLOv4 detects vehicles in camera images; detections projected to LiDAR cloud via extrinsic calibration; matched 3D clusters removed before accumulation. YOLOv5-MobileNetV3 variant for embedded deployment (F1 = 0.845).
- Limits: camera-LiDAR calibration required; blind to objects outside camera FoV; class-specific.

**LMNet / MOS family** (RA-L / IROS 2021+) — learned per-point moving/static classification.
- Mechanism: LMNet takes residual range images (difference between consecutive scans) as additional input, allowing per-frame moving/static discrimination. Subsequent methods (MotionSeg3D, 4DMOS, MambaMOS, SegNet4D) extend to dual-branch spatial-temporal fusion, 4D sparse convolutions, and Mamba SSM architectures.
- Key role: MOS models run on each scan *before* accumulation, flagging moving points; clean scans are then merged into the map ("online pre-removal").
- MambaMOS (2024): U-Net + serialized 4D sequence + Mamba SSM; robust on sparse point clouds.
- Benchmark: SemanticKITTI-MOS task; best models achieve IoU_MOS > 75%.

**DeFlow** (ICRA 2024) — scene flow for dynamic removal.
- Mechanism: GRU-based refinement of scene flow estimation; classifies voxels by flow magnitude — zero-flow = static, nonzero = dynamic. Novel loss function handles static/dynamic imbalance. Included in KTH DynamicMap Benchmark as the sole learning-based method.
- Caveat: degrades under train/test domain shift; no airside training data exists; treat as research/evaluation only.

See also: [`dr-remover.md`](dr-remover.md), [`moves-and-label-free-map-cleaning.md`](moves-and-label-free-map-cleaning.md).

### Terrain-First and Binary Matrix Methods

**MapCleaner** (Remote Sensing 2022)
- Mechanism: (1) dense continuous terrain surface estimation divides the map into below-terrain noise, terrain, and above-terrain objects; (2) moving-point identification algorithm on the object layer. Learning-free, few parameters.
- Results: outperforms prior SOTA on all five SemanticKITTI sequences at time of publication.
- Key property: terrain points are never candidates for removal — ground-contact failure mode is avoided by design.
- See also: [`mapcleaner.md`](mapcleaner.md) for full method notes.

**[BeautyMap](beautymap.md)** (RA-L 2024)
- Mechanism: 3D binary-encoded matrix (vertical occupancy compressed to bitwise columns) → adaptable ground extraction using MAD outlier removal + ground ratio segmentation → bitwise XOR-style comparison between scan and map matrices.
- Performance: SA 99.17%, DA 92.99%, HA 95.98% on KITTI seq 01; runtime 0.046 s/frame (vs ERASOR's 0.718 s — ~15× faster). Best static accuracy with competitive dynamic accuracy among offline methods benchmarked as of 2024.

### Observation-Timing Based

**OTD** (ICRA 2024) — Observation Time Difference.
- Mechanism: tracks voxel first/last observation timestamps. Downward retrieval: a non-ground voxel that appeared significantly *later* than the ground below it → suddenly-appear dynamic. Upward retrieval: ground observed alone later → suddenly-disappear dynamic. Static restoration via observation-frequency comparison.
- Results: F1 0.975–0.988 on SemanticKITTI at 23.8 ms/frame; 60%+ faster than compared alternatives. Online, no prior map needed.
- Bridges the online/offline gap: current-frame scope limits long-horizon evidence for slow or briefly stationary actors, but its speed makes it the best candidate for a runtime dynamic-mask role on tight compute budgets.

**DynPurge** (IEEE RA-L 2025, DOI `10.1109/LRA.2025.3623005`) — watchlist-only global-map cleaner. Accessible publisher, DBLP, and supplementary GitHub evidence describe a spatiotemporal distribution-range method that uses timestamp-distribution differences in accumulated global LiDAR maps to separate dynamic from static points. The public repository contains pseudocode and qualitative result images for SemanticKITTI, MCD, and Argoverse 2, but no runnable implementation, license, releases, or machine-readable metric tables. Treat it as a source-mature candidate to monitor, not as a production-ready page: do not compare its "classification accuracy" claims against PR/RR/F1 or SA/DA/HA tables until the full paper or artifacts expose metric definitions, splits, baselines, and evaluation granularity. Its likely failure modes are timestamp/provenance loss, stationary objects that persist for the survey window, slow parked movable objects, and false deletion of structures seen in narrow time windows.

See also: [`do-removal-lio.md`](do-removal-lio.md) for related dynamic-removal-integrated LIO work.

---

## Online (In-SLAM) vs Offline Post-Hoc

| Dimension | Online (in-SLAM) | Offline post-hoc |
|---|---|---|
| When it runs | Per frame, concurrently with odometry | After full map is built |
| Access to future scans | No | Yes |
| Typical accuracy | Lower (no future context) | Higher |
| Map latency | Zero (clean map available immediately) | Full traversal required |
| Representative methods | DUFOMap, Dynablox, M-Detector, OTD, FreeDOM front-end | ERASOR, Removert, BeautyMap, MapCleaner, FreeDOM back-end, ERASOR2 |
| Airside deployment role | Runtime mask for path planning | Map conditioning before segmentation |

**Practical hybrid:** FreeDOM's two-stage design explicitly separates an online scan-removal front-end (conservative per-frame classification) from an offline map-refinement back-end (incremental free-space accumulated from the full traversal). This makes it a natural fit for a two-pass map lifecycle: rough online removal for reactive planning, followed by offline refinement for the static map used in segmentation and auto-labeling.

For robot deployments requiring immediate clean maps (warehouse AGVs, port AGVs), online methods (DUFOMap, OTD, Dynablox) are preferred, accepting slightly lower cleaning quality for zero-latency map availability. Major HD-map vendors (Waymo, Mobileye, HERE) use offline post-hoc removal as standard pipeline: accumulate full traversals → run cleaning → segment → auto-label.

---

## Method Comparison Table

| Method | Type | Offline/Online | PR (KITTI) | RR (KITTI) | F1 / HA (KITTI) | Speed | Key Limit |
|---|---|---|---|---|---|---|---|
| OctoMap | Voxel-ray Bayesian | Both | ~30% | ~99.8% | ~0.46 | ~2.98 s/fr | Extreme over-removal |
| Removert | Range-image visibility | Offline | ~50.7% | ~82.3% | ~0.836 | ~0.134 s | Incidence angle FP; resolution |
| ERASOR | Pseudo-occupancy + R-GPF | Offline | ~88–94% | ~95–99% | ~0.921–0.955 | ~0.073 s | Flat terrain assumed |
| ERASOR++ | Height-coded pseudo-occ | Offline | 87–98% | — | 0.930–0.986 | ~0.10–0.14 s | Slightly slower than ERASOR |
| MapCleaner | Terrain + moving-id | Offline | — | — | SOTA at pub. | — | Learning-free; terrain assumption |
| [BeautyMap](beautymap.md) | Binary voxel matrix | Offline | SA 99.2% | DA 93% | HA 96% | 0.046 s | Offline only |
| Dynablox | TSDF ever-free | Online | SA 96.3% | DA 68% | HA 79.7% | 17 FPS | Sparse LiDAR weak DA |
| DUFOMap | Void-region detection | Online | AA 98.3% | AA 98.3% | — | 0.062 s | Semi-indoor limits |
| OTD | Observation timestamp | Online | — | — | 0.975–0.988 | 23.8 ms | Ground contact required |
| DynPurge (watchlist) | Timestamp-distribution cleaner | Offline | — | — | — | — | No public code or comparable metric tables |
| FreeDOM | Conservative free-space | Online + Offline | — | — | 97.1–99.6% | >10 Hz | 2025; newest |
| [Raymoval](raymoval.md) | Az-el raycasting + cluster | Offline | ~93.2% | ~92.6% | ~0.927 | 0.094 s | RiTA 2025 / arXiv 2026; paper-only |
| ERASOR2 | Instance segmentation | Offline | — | — | 0.974–0.984 | — | Requires detector |
| DeFlow | Scene flow (learned) | Offline | — | — | — | — | Data-dependent; domain shift |

Note: metrics are not directly comparable across rows — different papers report PR/RR, SA/DA, HA/AA, or F1 with different voxel sizes and dataset splits. Re-measure on target-domain data before relying on these figures.

---

## Benchmarks and Metrics

### Primary Metrics

**Preservation Rate (PR):** fraction of true static map points retained after removal.
```
PR = |retained static| / |total static|
```
High PR → map completeness. Low PR → holes, over-removal, degraded localization observability.

**Rejection Rate (RR):** fraction of true dynamic map points removed.
```
RR = 1 − (|retained dynamic| / |total dynamic|)
```
High RR → clean map. Low RR → residual ghost trails.

**F1 / Harmonic Mean:**
```
F1 = 2 · PR · RR / (PR + RR)
```
Captures the PR/RR trade-off; favors methods that balance both.

**Alternative metric vocabulary** used in different papers:
- *Static Accuracy (SA)* / *Dynamic Accuracy (DA)* / *Harmonic Accuracy (HA)* — same concept, different nomenclature (BeautyMap, DUFOMap, KTH Benchmark papers).
- *Associated Accuracy (AA)* — DUFOMap's combined metric.
- *IoU_MOS* — for per-frame moving object segmentation evaluation on SemanticKITTI-MOS task.

### Benchmark Datasets

**SemanticKITTI** — primary standard for outdoor LiDAR dynamic removal.
- Sensor: Velodyne HDL-64E. Standard test sequences: 00, 01, 02, 05, 07.
- Dynamic classes: car, person, bicyclist, motorcycle; others are static.
- Ground-truth dynamic labels available from semantic annotations.

**KTH DynamicMap Benchmark** (ITSC 2023, continuously updated).
- 5 datasets: Semantic-KITTI (VLP-64), Argoverse 2.0 (VLP-32), UDI-Plane (VLP-16), KTH-Campus (Leica RTC360), Indoor-Floor (Livox Mid-360).
- 8+ methods benchmarked: DUFOMap, OctoMap, OctoMap w GF, Dynablox, DeFlow, [BeautyMap](beautymap.md), ERASOR, Removert under one refactored codebase and one evaluation protocol.
- This benchmark is the canonical way to report cleaning results. For airside work it is also a methodology template: a single harness running several cleaners on the same data is exactly the "compare multiple cleaners and inspect disagreement" step in the Map Lifecycle Pipeline.
- UDI-Plane (warehouse/industrial indoor) and KTH-Campus offer closer analogs to airside geometry than KITTI road sequences.
- Repository: https://github.com/KTH-RPL/DynamicMap_Benchmark

**HeLiMOS** (IROS 2024) — heterogeneous LiDAR moving-object segmentation.
- 12,188 labeled point clouds; 4 sensor types (VLP-16, Ouster OS2-128, Livox Avia, Aeva Aeries II).
- Annotated categories: buses, pedestrians, bicyclists, cars. Built on KAIST05 sequence from HeLiPR.
- Metrics: IoU_MOS for segmentation; PR/RR/F1 for static map building.
- ERASOR2 achieves F1 = 0.974–0.984 on crowded HeLiMOS sequences; FreeDOM on HeLiMOS Ouster = 97.15%.
- HeLiMOS-style multi-LiDAR evaluation is directly relevant for airside rigs with heterogeneous sensor arrays.

**Argoverse 2.0** — used in KTH benchmark; VLP-32 dual LiDAR, US urban scenes, high dynamic density.

See also: [`dynamic-map-cleaning-benchmarks.md`](dynamic-map-cleaning-benchmarks.md) for extended benchmark and dataset notes.

---

## The Core Trade-off: Over-Removal vs Under-Removal

### Over-Removal (high RR, low PR)

A method too aggressively marks free space or pseudo-occupancy changes. Effects:
- Holes in the static map: walls, pillars, posts near roads become partially erased.
- Ground loss near curb edges and pedestrian zones (ERASOR's known failure mode).
- Tree trunks adjacent to moved pedestrians removed (documented in ERASOR++ paper).
- Surface normals and segmentation features degrade in eroded regions; rare-class IoU collapses.

OctoMap is the canonical over-remover: RR ≈ 99.8% but PR ≈ 30% → F1 ≈ 0.46. This failure profile illustrates why F1 is the right comparison metric — DA or RR alone would make OctoMap appear optimal.

**From the segmentation perspective**, over-cleaning is the most damaging failure mode: it deletes thin static structure — poles, fences, kerbs, painted markings — which are precisely the rare, hard, high-value classes whose IoU is already fragile in segmentation benchmarks. The resolution is to clean conservatively and let the segmentation taxonomy's quarantine class absorb residue.

### Under-Removal (low RR, high PR)

Method too conservative; residual ghosts survive. Effects:
- Ghost trails of vehicles produce phantom "car"-class clusters at multiple map positions.
- Ground planes acquire floating-point fragments above the surface (pollutes `ground`/`road` class).
- Localization systems match to ghost features, reducing odometry consistency.
- Auto-labels back-projected from a dirty map acquire erroneous dynamic-class labels.

Dynablox tends toward under-removal on sparse sensors (high SA, weaker DA).

### Ground Points as a Failure Case

Ground points are the hardest to handle correctly in all geometry-based methods:
- Dynamic objects contact the ground, so their footprints partially overlap ground geometry.
- Aggressive removal erases the ground beneath the object's trajectory (holes in the map).
- Ray-casting methods accumulate free-space from above the object, not beneath it — ground points are ambiguous.
- ERASOR's R-GPF explicitly reverts ground points; ERASOR++'s GLT extends this to uncertain z-axis conditions.
- FreeDOM's conservative neighborhood confirmation reduces ground false positives.
- MapCleaner's terrain-first approach explicitly segregates terrain from objects before applying the moving-point identification — ground points are never candidates for removal.

### Static-but-Movable Objects (Parked Vehicles, Staged GSE)

**The hardest semantic question in map cleaning.** A parked aircraft tug or a staged belt loader is:
- Geometrically: indistinguishable from a moving one (same shape; no velocity in the scan).
- Semantically: genuinely static *at the time of mapping* but potentially absent in future traversals.
- Scan-ratio / pseudo-occupancy methods: will NOT remove a parked object — its pseudo-occupancy is identical in map and query.
- Ray-casting methods: will NOT remove it either — no scan ever ray-casts through it.

Two engineering approaches:
1. **Quarantine / versioned map layers**: flag movable-class objects (detected via 3D bounding box detection) and store them in a separate removable layer. The base map minus the movable layer is used for segmentation and localization. This is the "potentially dynamic object removal" approach — relevant arXiv: 2407.01073.
2. **Accept them in the base map, track changes**: treat the map as a living document; update the movable-object layer when a new traversal detects changed positions. Appropriate for maps that are periodically refreshed (e.g., airside pre-push map updates).

ERASOR2's instance-level approach handles this more gracefully: if a parked vehicle was *never observed moving*, it is preserved; only instances with detected motion trajectories are removed. The *movable-static layer* defined in this page's Executive Summary maps one-to-one onto the segmentation taxonomy's "staged GSE / permitted-static" class — keeping the layer definition and the class definition aligned lets the cleaner's output and the segmenter's output agree.

---

## Relation to Semantic Segmentation

### Clean-then-Segment (Recommended Ordering)

1. **Accumulate** raw scans into a global point cloud (with pose graph).
2. **Clean** with a dynamic remover (FreeDOM, ERASOR, OTD, or similar).
3. **Segment** the cleaned map with a 3D semantic segmenter (e.g., SphereFormer, SPVCNN, Cylinder3D).
4. **Back-project** per-point class labels onto original scan frames for auto-label generation.

Benefits: segmenter sees only stable geometry; class boundaries are sharp; auto-labels are coherent.

### Segment-then-Clean (MOS-Aided Variant)

1. Run a per-frame MOS model (LMNet, 4DMOS, MambaMOS) to flag moving points at scan time.
2. Discard flagged points before accumulation.
3. Accumulate and segment the clean map.

Benefits: moving points never enter the map; works with any downstream segmenter; latency is per-scan rather than post-hoc. Risk: MOS model errors (false negatives) let ghost points through; false positives erase valid points.

### Mutual Reinforcement

Geometry-based removal and learned segmentation are complementary:
- A cleaned map provides cleaner training data for the segmenter via auto-labeling.
- A trained segmenter can aid instance-level removal (ERASOR2 approach).
- MOS models trained on auto-labels generated from ERASOR-cleaned maps (Cortinhal et al. 2022) achieved performance comparable to manually labeled training data.

The feedback loop: geometry-clean map → auto-label → train MOS → better per-scan cleaning → cleaner maps for the next generation of labels.

### MOS as Both Remover and Segmentation Task

Moving Object Segmentation on SemanticKITTI-MOS is a recognized benchmark task. MOS models produce per-point moving/static binary labels that are *directly usable* as a dynamic removal signal: discard all `moving` points before map accumulation. Thus a strong MOS model (IoU_MOS > 75%) doubles as a map cleaner — but requires labeled training data and generalizes imperfectly across domains (road → airside). This is the "segment-then-clean" variant in operational form.

**Cleaning feeds segmentation QA.** Once a learned segmentation model exists it becomes a downstream validator of cleaning quality: a region the model labels with persistently low confidence, or that no class explains, is a strong candidate for incomplete cleaning or ghosting. Agreement between per-point map-layer assignment (static / movable-static / dynamic / artifact) and semantic label is a free cross-check — it complements the "cleaner disagreement → manual QA" rule in Deployment Decision Rules.

**Cross-reference:** `../../perception/overview/aggregated-map-semantic-segmentation.md` §9.1 and §2.4.

---

## Map Lifecycle Pipeline

1. Collect synchronized LiDAR, pose, GNSS/INS, wheel/IMU, weather, and sensor-health logs.
2. Produce a high-quality trajectory using LIO/SLAM plus loop closure and control points.
3. Build an initial raw map and preserve raw scan provenance.
4. Apply runtime dynamic masks if available, but do not trust them as final map truth.
5. Run offline cleaning with ERASOR, Removert, MapCleaner, ERASOR++, FreeDOM, [BeautyMap](beautymap.md), [Raymoval](raymoval.md), or DUFOMap — compare at least two methods and inspect disagreement.
6. Assign map points to static, movable-static, dynamic, artifact, or unknown layers.
7. Apply semantic hard-exclusion and quarantine gates for stationary people, staged movable assets, construction material, FOD candidates, and artifacts.
8. Validate localization on the cleaned map and on the raw-map baseline.
9. Segment the cleaned map; use segmentation confidence as a downstream cleaning QA signal.
10. Publish a map package with cleaner configuration, diagnostics, layer membership, and QA evidence.
11. Update production maps only through change-control and multi-session evidence.

---

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
| No airside ground-truth cleaning data available | Prefer DUFOMap (tuning-free) or [BeautyMap](beautymap.md) (high SA) over ERASOR/Removert. |

---

## Industry-Proven Practice and Airside Relevance

### Industry Practice

Major HD-map and AV-map vendors (Waymo, Mobileye, HERE) use offline post-hoc removal as the standard pipeline: accumulate full traversals → run cleaning → segment → auto-label. The map is versioned; dynamic removal is re-run when a significant environment change is detected. For robot deployments requiring online clean maps (warehouse AGVs, port AGVs), online methods (DUFOMap, OTD, Dynablox) are preferred, accepting slightly lower cleaning quality for zero-latency map availability.

### Airside Relevance

Airport apron environments present a distinctive dynamic-object profile:
- **High density of movable-but-stationary objects**: gate-parked tugs, belt loaders, catering trucks, boarding stairs — all large metallic objects with strong LiDAR returns, temporarily parked in fixed positions but frequently repositioned.
- **Genuine dynamic objects**: taxiing aircraft (massive return, slow-moving), active GSE vehicles, fuel bowsers, personnel.
- **Regulatory precision requirement**: ISO 3691-4 driverless industrial truck certification demands a verified static map as input to path planning; ghost trails in the map constitute a safety-critical artifact.

**Specific implications:**

1. **GSE quarantine layer**: staged equipment (belt loaders at stand, stair trucks docked) must be stored in a removable layer separated from permanent airside infrastructure (terminal walls, taxiway markings, fixed lights). Standard scan-ratio removal will NOT remove them. Instance-level methods (ERASOR2) or explicit movable-class bounding-box detection are required to populate this layer.

2. **Ground handling dynamics window**: the apron between push-back and departure involves dense, rapidly moving GSE over a 15–30 minute window. Mapping during this window without removal produces heavy ghosting. Maps should be captured during a quiescent period or cleaned with a high-RR method (FreeDOM, ERASOR2) after the fact.

3. **4D radar complement**: radar adds Doppler velocity per point — Doppler-based moving-point flagging before accumulation is a natural first pass that geometry-only LiDAR methods lack. A pre-filter that discards points with non-zero Doppler velocity reduces the number of ghost points that geometry-based methods must subsequently remove.

4. **Cross-domain transfer**: standard SemanticKITTI-trained removal methods may under-perform on airside geometry (wide flat aprons, low-profile vehicles, taxiway vs road surface). The KTH benchmark's UDI-Plane (warehouse/industrial indoor) and KTH-Campus sequences offer closer analogs. Airside-specific fine-tuning with 500–1,000 annotated frames (per the PointLoRA data-efficiency finding) should be budgeted for learned components; for geometry-only methods, DUFOMap's universal parameter set is the lowest-risk starting point.

5. **Apron navigation without SLAM mapping**: current lightweight apron navigation implementations (MDPI Sensors 2024) use 2D LiDAR + virtual channel delineation, avoiding traditional SLAM mapping entirely. A 3D LiDAR-based approach with proper dynamic removal would substantially improve the situational model but requires solving the staged-GSE quarantine problem first.

### Airside Validation Guidance

Build validation sets from:
- Quiet survey passes and busy operational passes on the same route.
- Stands with aircraft present and absent.
- GSE staging areas across multiple shifts.
- Wet and dry apron captures.
- Night and day captures with reflective markings.
- De-icing and winter operations where allowed.
- Repeated gate layouts to test localization aliasing.

Metrics to report:
- Static preservation rate by infrastructure class.
- Dynamic rejection rate by actor class.
- Movable-static classification accuracy.
- Map ghost rate per 100 m or per stand.
- Localization ATE/RPE, residual, inlier count, and degeneracy.
- Change-detection precision across map versions.
- Manual QA burden per kilometer or per stand.

---

## Failure Modes

- Dynamic objects parked during mapping become persistent static clutter.
- Temporarily absent static objects are interpreted as removed infrastructure.
- Static erosion removes thin or low structures needed by localization (poles, kerbs, markings).
- Ground segmentation mistakes remove ramps, curbs, chocks, tow bars, or aircraft gear.
- Pose error creates false disagreement and aggressive removal.
- Learned dynamic masks fail on airport-specific classes not present in road datasets.
- Cleaned maps improve appearance but reduce scan-matching observability if over-cleaned.
- Scan-ratio methods leave parked GSE as permanent map features; they require a separate quarantine layer.
- Ray-casting methods accumulate free-space from above dynamic objects, leaving their ground-contact footprints ambiguous.

---

## Implementation Notes

- Store point provenance: source scan, timestamp, pose, cleaner decision, and map layer. This allows a mis-segmented region to be traced back to the cleaner decision that produced it.
- Use a rejected-points review workflow; do not discard dynamic or artifact layers.
- Compare ERASOR and Removert as complementary baselines before adopting a single default.
- Use DUFOMap or [BeautyMap](beautymap.md) as the conditioning pass before segmentation where conservative, repeatable cleaning over large multi-pass surveys matters more than per-frame latency.
- Use MapCleaner/ERASOR++/FreeDOM as evaluation candidates where their assumptions match the data.
- Use [Uni-Mapper](uni-mapper-dynamic-aware-lidar-map-merging.md) when the site must merge heterogeneous LiDAR sessions or maps. Use [LAMM](lamm-multi-session-point-cloud-map-merging.md) when the dominant gap is large-scale multi-session point-cloud map merging with dynamic filtering, BTC loop discovery, false-loop rejection, and connected-component graph optimization. Treat both as map-alignment support, not as complete static-but-transient policy for parked movable objects.
- Treat 4dNDF and DeFlow as offline research/QA until runtime, uncertainty, and maintainability are proven.
- Use HeLiMOS-style labels to evaluate multi-LiDAR rigs separately and after sensor fusion.
- The movable-static layer definition and the segmentation taxonomy's "staged GSE / permitted-static" class must stay aligned across the map lifecycle. Route detector-based single-survey quarantine through [Potentially Dynamic Object Removal by Ground Projection](potentially-dynamic-object-removal-ground-projection.md) and multi-session PD/ND governance through [Lifelong 3D Map Version Control](lifelong-3d-map-version-control.md).

---

## Sources

- ERASOR paper: https://arxiv.org/abs/2103.04316
- ERASOR repository: https://github.com/LimHyungTae/ERASOR
- Removert repository: https://github.com/gisbi-kim/removert
- Removert paper record: https://snu.elsevierpure.com/en/publications/remove-then-revert-static-point-cloud-map-construction-using-mult
- MapCleaner: https://www.mdpi.com/2072-4292/14/18/4496
- ERASOR++: https://arxiv.org/abs/2403.05019
- ERASOR2: https://erasor2.github.io/
- 4dNDF paper: https://arxiv.org/abs/2405.03388
- 4dNDF repository: https://github.com/PRBonn/4dNDF
- Dynamic Points Removal Benchmark paper: https://arxiv.org/abs/2307.07260
- Dynamic Points Removal Benchmark repository: https://github.com/KTH-RPL/DynamicMap_Benchmark
- Potentially Dynamic Object Removal by Ground Projection: https://arxiv.org/abs/2407.01073
- Lifelong 3D Mapping Framework for Hand-held & Robot-mounted LiDAR Mapping Systems: https://arxiv.org/abs/2501.18110
- Uni-Mapper paper: https://arxiv.org/abs/2507.20538
- Uni-Mapper project page: https://sparolab.github.io/research/uni_mapper/
- Uni-Mapper / OpenLMM repository: https://github.com/sparolab/uni-mapper
- DUFOMap paper: https://arxiv.org/abs/2403.01449
- DUFOMap paper (extended): https://arxiv.org/html/2403.01449v1
- BeautyMap paper: https://arxiv.org/abs/2405.07283
- Observation Time Difference (OTD) paper: https://arxiv.org/abs/2406.15774
- OTD code: https://github.com/NEU-REAL/OTD
- DeFlow paper: https://arxiv.org/abs/2401.16122
- DeFlow code: https://github.com/KTH-RPL/DeFlow
- HeLiMOS dataset: https://sites.google.com/view/helimos/dataset
- HeLiMOS toolbox: https://github.com/url-kaist/HeLiMOS-PointCloud-Toolbox
- HeLiMOS paper: https://arxiv.org/html/2408.06328v1
- Dynablox paper: https://arxiv.org/abs/2304.10049
- Dynablox code: https://github.com/ethz-asl/dynablox
- FreeDOM paper: https://arxiv.org/html/2504.11073
- Raymoval paper: https://arxiv.org/html/2605.08937v1
- M-Detector paper: https://www.nature.com/articles/s41467-023-44554-8
- M-Detector code: https://github.com/hku-mars/M-detector
- LAMM paper: https://doi.org/10.1109/LRA.2024.3504317
- LAMM official repository: https://github.com/hku-mars/LAMM
- LiDAR-MOS / LMNet: https://github.com/PRBonn/LiDAR-MOS
- MambaMOS: https://arxiv.org/html/2404.12794v2
- Auto-label with ERASOR (Cortinhal et al. 2022): https://arxiv.org/abs/2201.04501
- GSE apron navigation framework (Sensors 2024): https://pmc.ncbi.nlm.nih.gov/articles/PMC10781360/
- SemanticKITTI MOS task: https://semantic-kitti.org/tasks.html
