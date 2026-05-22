# End-to-End Semantic Segmentation Pipeline for Aggregated LiDAR Maps

> The complete pipeline for assigning a semantic class to every point of a **registered, multi-scan LiDAR map** — the dense static point cloud produced by SLAM/mapping — as opposed to a single live sensor frame. Covers the aggregated-vs-single-scan distinction, pipeline architecture (tiling, inference, stitching, QA), input modalities (LiDAR geometry + intensity, colorized clouds, LiDAR+image fusion), the large-scale 3D segmentation dataset landscape, class taxonomies, model families (KPConv, RandLA-Net, sparse-conv, Point Transformer v3, Superpoint Transformer), self-supervised pre-training and 3D foundation models, pre-/post-processing, design trade-offs, industry-proven practice, evaluation, and the airside application.

**Last updated:** 2026-05-22

**Scope note:** This page is the **map-scale / offline** counterpart to `lidar-semantic-segmentation.md` (single-scan, real-time, on-vehicle). The two are complementary: the on-vehicle model labels live frames inside the Orin cycle budget; the pipeline here labels the *accumulated* map once, offline, with the heaviest models available — to produce HD-map semantic layers, auto-labeled training data, digital-twin assets, and change-detection baselines.

---

## Table of Contents

1. [Introduction and Scope](#1-introduction-and-scope)
2. [Aggregated Map vs Single-Scan Segmentation](#2-aggregated-map-vs-single-scan-segmentation)
3. [Pipeline Architecture](#3-pipeline-architecture)
4. [Input Representations and Modalities](#4-input-representations-and-modalities)
5. [Datasets and Benchmarks](#5-datasets-and-benchmarks)
6. [Class Taxonomies](#6-class-taxonomies)
7. [Model Families and SOTA Methods](#7-model-families-and-sota-methods)
8. [Tiling, Chunking, and Stitching](#8-tiling-chunking-and-stitching)
9. [Pre-Processing and Map Conditioning](#9-pre-processing-and-map-conditioning)
10. [Post-Processing and Refinement](#10-post-processing-and-refinement)
11. [Pipeline Design Trade-offs and Decision Guide](#11-pipeline-design-trade-offs-and-decision-guide)
12. [Industry-Proven Methods and Production Practice](#12-industry-proven-methods-and-production-practice)
13. [Evaluation Metrics and Quality Assurance](#13-evaluation-metrics-and-quality-assurance)
14. [Airside Application](#14-airside-application)
15. [Recommended Pipeline and Roadmap](#15-recommended-pipeline-and-roadmap)
16. [References and Related Documents](#16-references-and-related-documents)

---

## 1. Introduction and Scope

### 1.1 What Is an Aggregated LiDAR Map

An **aggregated LiDAR map** (also: accumulated cloud, fused point cloud map, registered point cloud, dense map) is the single point cloud produced by registering and merging many individual LiDAR scans into one globally consistent coordinate frame. It is the natural output of a SLAM or offline mapping pipeline:

```
N raw scans (each ~60-260k points, sensor frame)
        │  ego-motion estimation (LIO / odometry)
        │  registration (ICP / VGICP / factor graph)
        │  pose-graph / bundle optimization + loop closure
        ▼
1 aggregated map (10^7 - 10^9 points, global frame)
```

Aggregated maps come in several flavors that change everything downstream:

| Map source | Sensor pattern | Typical density | Coverage | Notes |
|---|---|---|---|---|
| **MLS** — mobile laser scanning | Vehicle-mounted spinning/solid-state LiDAR | 1k-10k pts/m² near trajectory | Road corridors | The AV/airside case; density falls sharply off-trajectory |
| **TLS** — terrestrial laser scanning | Tripod static scans, merged | 10k-100k pts/m² | Bounded sites | Very dense, near-uniform; survey-grade |
| **ALS** — airborne laser scanning | Aircraft/UAV-mounted, nadir | 5-800 pts/m² | Wide-area, city-scale | Top-down; thin verticals undersampled |
| **Photogrammetric** | Multi-view stereo from imagery | Variable, RGB-rich | UAV survey areas | Not LiDAR but the same segmentation pipeline; native colour |

For airport airside autonomous vehicles, the operative case is **MLS**: the survey-drive output described in `../../localization-mapping/maps/map-construction-pipeline.md`, registered by GTSAM + VGICP into a 5 cm-voxel apron map.

### 1.2 What "End-to-End Semantic Segmentation Pipeline" Means

Two readings of "end-to-end" coexist and both matter here:

1. **End-to-end as a learned model** — a single trained network maps the raw aggregated cloud (geometry + intensity + optional RGB) directly to per-point class labels, with no hand-engineered class-specific stages (no separate RANSAC ground extractor, no intensity threshold for markings, no image-OCR for signs). The learned core replaces a stack of heuristics.
2. **End-to-end as a pipeline** — the full production workflow from "we have a registered map" to "every point carries a verified semantic label and the result is packaged for downstream consumers." This wraps the learned model in map conditioning, tiling, batched inference, stitching, post-processing, and QA.

This document treats both: §7 covers the learned model; §3, §8-§13 cover the surrounding pipeline. The recommended design (§15) is end-to-end in **both** senses — one 3D network does the semantic work, and the pipeline around it is automated and auditable.

### 1.3 Why Segment the Aggregated Map At All

Single-scan segmentation already exists on-vehicle. Segmenting the *map* is a separate, high-value capability:

| Use case | What map segmentation delivers |
|---|---|
| **HD-map semantic layer** | Per-point or per-element labels become the L3 semantic layer of the map (`map-construction-pipeline.md` §8) — surfaces, markings, structures, hazard zones |
| **Auto-labeling / data flywheel** | A map labeled once propagates labels back onto every contributing single scan via pose look-up, generating large single-scan training sets at near-zero marginal cost |
| **Map cleaning and curation** | Separating permanent "stuff" from transient "things" lets the pipeline keep only true static structure |
| **Change detection baseline** | A semantically labeled reference map makes change detection class-aware ("a new *fence* appeared" vs "a *vehicle* moved") — see `../../localization-mapping/maps/hd-map-change-detection-maintenance.md` |
| **Digital twin / simulation assets** | Labeled maps seed semantically-aware reconstruction and simulation (`../simulation/` and 3DGS digital-twin work) |
| **Localization priors** | Class labels let localization weight stable classes (buildings, poles) over unstable ones (vegetation, parked vehicles) |
| **Audit and certification evidence** | A fully labeled site map is reviewable artifact evidence for the safety case |

The economic argument is the auto-labeling flywheel: the corpus position is that **no public airside LiDAR datasets exist** and creating the benchmark is an open opportunity. A high-quality map segmentation pipeline is the cheapest route to that benchmark — label the map, back-propagate to scans.

---

## 2. Aggregated Map vs Single-Scan Segmentation

The aggregated map is **not** just "a bigger point cloud." It is a different statistical object, and treating it as a large single scan is the most common pipeline mistake.

### 2.1 What Changes

| Dimension | Single live scan | Aggregated map |
|---|---|---|
| Point count | 6×10⁴ – 2.6×10⁵ | 10⁷ – 10⁹ |
| Latency budget | 10-100 ms (in control loop) | Minutes-hours (offline batch) |
| Density | Range-dependent, sparse far field | Dense, multi-viewpoint, but non-uniform |
| Occlusion | Heavy self/scene occlusion | Largely filled in from many viewpoints |
| Viewpoint | Single sensor origin | Many origins along the trajectory |
| Dynamic content | Present, must be reasoned about live | Should be removed; if not, leaves ghost trails |
| Geometry quality | Clean (one rigid frame) | Subject to registration error / drift blur |
| Output reuse | Consumed once, this frame | Computed once, reused indefinitely |
| Model class | Real-time architectures (range-image, FlatFormer) | Heaviest accurate architectures (transformers, deep KPConv) |

### 2.2 Advantages of Segmenting the Map

- **No latency ceiling.** The offline setting unlocks the most accurate models, multi-scale inference, test-time augmentation, ensembles, and CRF refinement — all infeasible on-vehicle.
- **Density helps thin and small structures.** Poles, wires, curbs, signs, lane paint and FOD-scale objects that a single sparse scan barely grazes become well-sampled after accumulation.
- **Occlusion is filled.** Multi-viewpoint coverage means a wall seen edge-on in one scan is fully sampled across the pass.
- **Global label consistency.** One label per region, decided once — no frame-to-frame flicker, no temporal smoothing needed.
- **Amortized cost.** Label once, reuse for the map's lifetime and for auto-labeling every contributing scan.
- **Intensity averaging.** Multiple returns per surface patch let you average/calibrate intensity, sharpening appearance-based classes (paint, manhole covers).

### 2.3 Disadvantages and Failure Modes

- **Scale forces tiling.** A city- or airport-scale map exceeds GPU memory by orders of magnitude. The pipeline *must* partition, and partition boundaries create artifacts (§8).
- **Registration error blurs geometry.** SLAM drift and imperfect loop closure produce double walls, smeared curbs, and thickened thin structures. Sub-5 cm map error is the target (`map-construction-pipeline.md` §4.5); above ~10 cm, thin-class IoU degrades sharply.
- **Dynamic ghosting.** Moving objects not removed before segmentation leave streaks that no class explains — they pollute "stuff" classes and corrupt auto-labels. Dynamic removal is a *prerequisite*, not optional (§9, and `../../localization-mapping/slam-methods/lidar-map-cleaning-dynamic-removal.md`).
- **Density non-uniformity within one map.** Near the trajectory: thousands of pts/m²; 40 m off-trajectory: tens. A model trained at one density generalizes poorly to the other — an *intra-map* domain shift.
- **Train/inference distribution gap.** Most public segmentation models are trained on *single-scan* data (SemanticKITTI single-scan). Run on an accumulated cloud, the input distribution (density, completeness, no ego-centric range pattern) is off-distribution. Either train on aggregated data or adapt (see `test-time-adaptation-airside.md`).
- **Amplified class imbalance.** Ground/building dominate; markings, poles, FOD are <0.1% of points. Aggregation does not fix this and can worsen it.
- **No instant feedback.** A bug found after a multi-hour batch costs a full re-run; pipeline observability matters more than in the live stack.

### 2.4 The "Accumulate-Then-Segment" vs "Segment-Then-Accumulate" Choice

There are two ways to obtain a labeled map, and the distinction is architectural:

- **Segment-then-accumulate** — run single-scan segmentation on each frame, then fuse labels into the map by Bayesian/voting accumulation per voxel. Reuses the on-vehicle model; labels are noisy per-frame but average out. This is how many semantic-SLAM systems build a semantic map online (see `../../localization-mapping/slam-methods/semantic-slam.md`).
- **Accumulate-then-segment** — build the geometric map first, then run one segmentation pass over the *whole* aggregated cloud. The model sees full density and completed geometry; this is the subject of this page.

Both are valid; they are not exclusive. A strong production design uses **segment-then-accumulate as a prior** (cheap, gives a per-voxel label histogram) and **accumulate-then-segment as the authoritative pass** (accurate, resolves the prior). §10.3 covers fusing the two.

---

## 3. Pipeline Architecture

### 3.1 End-to-End Data Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│           AGGREGATED-MAP SEMANTIC SEGMENTATION PIPELINE                    │
│                                                                            │
│  ┌───────────┐   ┌────────────┐   ┌────────────┐   ┌──────────────┐      │
│  │ Aggregated│──▶│ Map        │──▶│ Tiling /   │──▶│ Batched      │      │
│  │ map (SLAM)│   │ Conditioning│   │ Partition  │   │ Inference    │      │
│  │ + poses   │   │ (clean,    │   │ (overlap,  │   │ (3D seg net) │      │
│  │ + imagery │   │  colorize) │   │  context)  │   │              │      │
│  └───────────┘   └────────────┘   └────────────┘   └──────┬───────┘      │
│                                                            │              │
│  ┌───────────┐   ┌────────────┐   ┌────────────┐   ┌──────▼───────┐      │
│  │ Packaged  │◀──│ QA & Metrics│◀──│ Post-      │◀──│ Stitching /  │      │
│  │ semantic  │   │ (mIoU,     │   │ Processing │   │ Label Merge  │      │
│  │ map layer │   │  coverage) │   │ (smooth,   │   │ (overlap     │      │
│  │           │   │            │   │  panoptic) │   │  voting)     │      │
│  └───────────┘   └────────────┘   └────────────┘   └──────────────┘      │
│                                                                            │
│  Side input: per-scan poses (for auto-label back-projection)               │
│  Side input: camera imagery + extrinsics (for colorization / fusion)       │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Stage Summary

| Stage | Input | Output | Typical cost (km²-scale MLS map) | Section |
|---|---|---|---|---|
| 1. Map conditioning | Raw SLAM cloud + poses | Clean, deskewed, dynamic-free, colorized cloud | 0.5-2 h | §9 |
| 2. Tiling / partition | Conditioned cloud | Overlapping tiles or superpoint graph | 5-30 min | §8 |
| 3. Batched inference | Tiles | Per-point logits per tile | 0.5-4 h (1 GPU) | §7 |
| 4. Stitching / merge | Per-tile logits | Single per-point label set | 10-40 min | §8.4 |
| 5. Post-processing | Labels + geometry | Smoothed labels, optional instances/panoptic | 10-60 min | §10 |
| 6. QA and metrics | Labeled map + holdout | Metrics, flagged regions, report | 10-30 min | §13 |
| 7. Packaging | Verified labeled map | Map semantic layer + auto-labels | 5-20 min | §14, §15 |

### 3.3 End-to-End Learned vs Modular Heuristic

| Aspect | Modular heuristic pipeline | End-to-end learned pipeline |
|---|---|---|
| Ground | RANSAC / CSF plane fit | Network class |
| Markings | Intensity threshold + skeletonize | Network class |
| Structures | Height filter + plane segmentation | Network class |
| Signs / poles | Vertical-pole detector | Network class |
| Fine objects | Image-projected 2D detection (SAM+CLIP) | Network class |
| Tuning effort | Per-class, per-site, brittle | One training run, transfers via fine-tuning |
| New class cost | New heuristic + integration | Add label, retrain/adapt |
| Interpretability | High (each rule inspectable) | Lower (needs uncertainty/QA) |
| Accuracy ceiling | Plateau; struggles with ambiguity | Higher; improves with data |
| Cold-start (no labels) | Works immediately | Needs labels or a pre-trained backbone |

The pragmatic production answer is **hybrid**: a learned 3D network as the end-to-end core, with two cheap heuristics retained as *guards*, not as the primary classifier — a geometric ground prior (regularizes the dominant class, anchors elevation) and an intensity prior for paint (a strong, near-free signal the network should agree with). The heuristics become QA cross-checks (§13), echoing the Simplex pattern used elsewhere in this corpus: the learned path is authoritative, the classical path is the auditable check.

---

## 4. Input Representations and Modalities

The user-facing question — "is the input LiDAR, image, or both?" — has three production answers, each a different pipeline.

### 4.1 LiDAR-Only: Geometry + Intensity

The baseline. Each point carries `(x, y, z, intensity)` and, after aggregation, optionally derived per-point features:

| Per-point feature | Source | Why it helps map segmentation |
|---|---|---|
| Geometry `(x,y,z)` | Direct | Primary signal for shape-defined classes (buildings, ground, poles) |
| Intensity / reflectance | Direct (calibrate first, §9.4) | Separates paint, metal, asphalt, vegetation; near-decisive for markings |
| Surface normal | Local PCA (k≈20) | Disambiguates vertical (wall/fence) vs horizontal (ground) surfaces |
| Local height-above-ground | Ground model (§9) | Strong prior: persons/poles/vegetation by height band |
| Planarity / linearity / scattering | Eigenvalue features of local covariance | Classic dimensionality features — robust, cheap, transferable |
| Echo / return number, multi-echo | Sensor (if available) | Vegetation penetration cue; useful for ALS |
| Density / point count in voxel | Aggregation statistics | Flags trajectory-near vs far field; helps the model self-calibrate to density |

LiDAR-only is the most robust choice: it is illumination-invariant, needs no camera calibration, and the map already exists in metric 3D. It is the recommended default for airside (LiDAR-primary stack).

### 4.2 Colorized Point Cloud (LiDAR Geometry + Projected RGB)

The aggregated map is colorized by projecting camera imagery onto each point using known extrinsics and per-frame poses; each point gains `(r, g, b)`. The segmentation network then ingests `(x,y,z,intensity,r,g,b)` and runs as a standard RGB point-cloud segmenter.

- **Pros:** colour disambiguates classes that are geometrically identical (painted line colour/type, grass vs bare ground, sign faces); reuses the entire LiDAR-only model family unchanged; photogrammetric datasets (SensatUrban, STPLS3D) are natively in this form.
- **Cons:** colorization quality depends on camera–LiDAR calibration and exposure consistency; moving shadows and rolling-shutter artifacts bleed into colour; multi-pass colour conflicts must be resolved (median/most-confident projection); colour is illumination-dependent — a night-only map has poor colour.
- **Verdict:** strong accuracy gain when imagery is well-calibrated and well-lit; treat colour as an *augmenting* channel the network can learn to down-weight, never a required one.

### 4.3 Multimodal LiDAR + Image Fusion

Instead of baking colour into points, keep the image stream as a parallel modality and fuse learned features:

- **2D→3D feature lifting / distillation** — run a strong 2D image segmenter (or a vision foundation model), then transfer features to 3D points via projection. 2DPASS-style training distills 2D knowledge into the 3D branch so that *inference can be LiDAR-only* — best of both: image supervision at train time, LiDAR-only robustness at deploy time.
- **Point-pixel cross-attention** — the 3D backbone attends to image features at each point's projection. Higher accuracy, but requires imagery at inference and is sensitive to calibration.
- **Open-vocabulary lifting** — project CLIP/SAM-class features onto points to label classes never in the training set (relevant to rare airside objects); see `open-vocab-detection.md` and `mosaic3d.md`.

| Modality choice | Inference needs | Robustness | Accuracy ceiling | Best for |
|---|---|---|---|---|
| LiDAR-only | LiDAR map | Highest | Good | Default; night maps; airside |
| Colorized cloud | LiDAR map (RGB pre-baked) | High | Better | Well-lit daytime survey + calibrated cameras |
| Distillation (2DPASS-style) | LiDAR-only at deploy | Highest | Better | Want image gains without image-at-inference risk |
| Point-pixel fusion | LiDAR + imagery + calib | Medium | Best | Maximum accuracy, controlled survey conditions |

**Recommendation:** train with image distillation (gain the 2D supervision), deploy LiDAR-only (keep robustness). This matches the corpus stance that the LiDAR-primary stack should not acquire a hard camera dependency.

### 4.4 Derived Representations for the Network

Independently of modality, the network consumes the cloud in one of: **raw points** (KPConv, RandLA-Net, Point Transformer), **sparse voxels** (MinkowskiNet, SpConv backbones), **superpoints** (Superpoint Transformer), or **2D rasterization** (top-down BEV / elevation images for ALS). §7 maps these to model families; §8 maps them to tiling strategies.

---

## 5. Datasets and Benchmarks

Aggregated-map segmentation has a *richer* public dataset landscape than single-scan driving segmentation, because the surveying, remote-sensing, and photogrammetry communities have published large registered-cloud benchmarks for years. The pipeline builder should mine all four sub-communities.

### 5.1 Large-Scale 3D Semantic Segmentation Datasets

| Dataset | Modality | Points | Classes | Environment | Colour | Notes |
|---|---|---|---|---|---|---|
| **Semantic3D** | TLS (static) | ~4×10⁹ | 8 | Outdoor urban/rural (Europe) | RGB | The canonical dense static-scan benchmark; near-uniform density |
| **Paris-Lille-3D / NPM3D** | MLS | ~1.4×10⁸ | 9 coarse / 50 fine | Urban streets (France) | No | Vehicle-mounted; closest to the AV/MLS case |
| **Toronto-3D** | MLS | ~7.8×10⁷ | 8 | Urban roadway (Toronto) | RGB | Road, marking, pole, wire, car, fence — AV-relevant classes |
| **SensatUrban** | UAV photogrammetry | ~3×10⁹ | 13 | Urban-scale (3 UK cities) | RGB | City-scale; RGB-native; popular tiling benchmark |
| **DALES** | ALS (airborne) | ~5×10⁸ | 8 | Aerial, 40 km² | No | Power lines, fences, poles, buildings, trucks |
| **Hessigheim 3D (H3D)** | UAV LiDAR + mesh | ~1.3×10⁷+ | 11 | Village + farmland | RGB (mesh) | Very high density; LiDAR + textured-mesh tracks |
| **STPLS3D** | Aerial photogrammetry + synthetic | large | up to 18 | Real + synthetic terrain | RGB | Synthetic augmentation reduces labeling cost |
| **SemanticKITTI (multi-scan task)** | MLS, accumulated | per-sequence | 28 (moving variants) | Urban driving | No | The accumulated-input task: label static vs moving over a window |
| **KITTI-360** | MLS, accumulated | ~10⁹ | 19 | Suburban driving | RGB | Dense accumulated clouds + 2D/3D consistent labels |
| **nuScenes-lidarseg / Waymo** | MLS, per-scan | per-scan | 16 / 23 | Urban driving | RGB (cameras) | Single-scan, but poses allow accumulation into maps |
| **Swiss3DCities** | UAV photogrammetry | large | 5 | Swiss cities | RGB | Coarse classes; useful for pre-training |
| **WHU-Railway3D** | MLS + ALS | large | 11 | Railway corridors | varies | Corridor geometry akin to taxiways/service roads |
| **ECLAIR / LASDU / ISPRS Vaihingen-3D / DublinCity** | ALS | varies | 4-11 | Aerial urban | varies | Established ALS benchmarks; ground/veg/building/structure |
| **SUM** | Textured urban mesh | large | 6 | Urban (Helsinki) | RGB | Mesh-based; relevant if the map is meshed |
| **WildScenes / RELLIS-3D** | MLS, off-road | varies | varies | Natural / off-road | RGB | Closest public proxy for unstructured airside-adjacent terrain |

### 5.2 Per-Dataset Profiles

The table above is a selection map; the profiles below give the detail a pipeline builder needs — acquisition geometry, exact class sets, density, access terms, and **airside transfer relevance**. They are ordered by how directly they inform an airside MLS pipeline.

#### Paris-Lille-3D (NPM3D) — the primary MLS pre-training source

- **Acquisition:** mobile laser scanning — a Velodyne HDL-32E on the L3D2 survey vehicle, ~2 km of streets in Paris and Lille, France.
- **Scale & density:** ~143 M points; dense along the vehicle corridor, thinning off-path — the same density signature as an airside survey drive.
- **Classes:** 50 fine classes collapsed to ~9-10 coarse for the NPM3D benchmark — ground, building, pole, bollard, trash can, barrier, pedestrian, car, natural (vegetation).
- **Access:** free for research; LiDAR geometry + intensity only, no RGB.
- **Strengths / use:** the closest public analog to an airside MLS corridor map — same sensor class, same ground-level viewpoint. Primary supervised pre-training source for the recommended pipeline (§7.5, §14.3).
- **Limitations:** dense European streets, no open-apron analog; no colour channel.
- **Airside transfer:** **high** — ground, pole, bollard, barrier map almost one-to-one onto the airside taxonomy (§6.3).

#### Toronto-3D — AV-relevant classes including markings

- **Acquisition:** mobile mapping (Teledyne Optech Maverick MMS), ~1 km of urban roadway in Toronto.
- **Scale & density:** ~78.3 M points; corridor-dense.
- **Classes (8):** road, road marking, natural, building, utility line, pole, car, fence.
- **Access:** free for research; RGB available.
- **Strengths / use:** carries an explicit **road marking** class and **utility line** / **pole** / **fence** — the exact thin/appearance-defined classes hardest to learn and most valuable to transfer to airside markings and perimeter furniture.
- **Limitations:** small (1 km); 8 coarse classes only.
- **Airside transfer:** **high** — marking, pole, fence transfer directly; the best public source for the airside marking class.

#### Semantic3D — the dense static-scan reference

- **Acquisition:** static terrestrial laser scanning (survey-grade scanners), ~30 scans of European urban and rural scenes.
- **Scale & density:** >4 billion points; very high, near-uniform density per station (falls off with range from each tripod position). Two test splits: `semantic-8` (full) and `reduced-8` (subsampled).
- **Classes (8):** man-made terrain, natural terrain, high vegetation, low vegetation, buildings, hardscape, scanning artefacts, cars.
- **Access:** free for research; RGB from the scanners.
- **Strengths / use:** the canonical "what a heavily-accumulated cloud looks like" benchmark; clean labels; the right place to validate density-robustness at the dense extreme.
- **Limitations:** static tripod viewpoint, not vehicle MLS — the scan pattern differs; only 8 coarse classes; explicit `scanning artefacts` class is TLS-specific.
- **Airside transfer:** **moderate** — excellent for density-robust pre-training and as the high-density bracket; viewpoint mismatch with MLS.

#### SemanticKITTI (multi-scan task) — the honest accumulated-cloud proxy

- **Acquisition:** mobile laser scanning (Velodyne HDL-64E), urban driving; the **multi-scan task** accumulates a sliding window of past scans before labeling.
- **Classes:** single-scan task evaluates 19 classes; the **multi-scan task evaluates 25**, adding six *moving* variants (moving-car, -person, -bicyclist, -motorcyclist, -truck, -other-vehicle) — forcing explicit static/moving reasoning on the accumulated input.
- **Access:** free for research; LiDAR only.
- **Strengths / use:** the most honest AV-domain proxy for "segment an accumulated cloud" — it *is* accumulated-LiDAR segmentation, and its moving/static split mirrors the staged-GSE quarantine problem (§6.3, §9.1).
- **Limitations:** accumulation window is short (a few seconds), not a full survey map; urban driving scenes.
- **Airside transfer:** **high (conceptual)** — the task formulation, not the scenes, is what transfers.

#### KITTI-360 — accumulated clouds with 2D-3D label consistency

- **Acquisition:** mobile mapping (Velodyne HDL-64E + 2 SICK + 2 perspective + 2 fisheye cameras), 73.7 km of suburban Karlsruhe.
- **Scale:** ~100 k laser scans accumulated into dense semantic point clouds; ~320 k images with consistent 2D labels.
- **Classes:** a Cityscapes-aligned set (~19 evaluated) applied consistently in 2D and 3D.
- **Access:** free for research; RGB.
- **Strengths / use:** the reference for **2D-3D label consistency** and label back-projection — directly relevant to the auto-label flywheel (§10.5).
- **Airside transfer:** **high** — accumulated MLS with the multimodal setup an airside survey vehicle also has.

#### SensatUrban — city-scale tiling benchmark (photogrammetric)

- **Acquisition:** UAV photogrammetry — an RGB point cloud reconstructed from aerial imagery (**not LiDAR**), ~7.6 km² across Birmingham, Cambridge and York.
- **Scale:** ~3 billion points.
- **Classes (13):** ground, vegetation, building, wall, bridge, parking, rail, traffic road, street furniture, car, footpath, bike, water.
- **Access:** free for research; RGB-native.
- **Strengths / use:** the standard **scale and tiling** benchmark — the right dataset to harden the tiling/stitching pipeline (§8) and RGB-point models.
- **Limitations:** photogrammetric noise and density statistics differ from LiDAR; aerial-oblique viewpoint.
- **Airside transfer:** **low-moderate** — use for tiling R&D and colour pipelines, not for LiDAR-statistics transfer.

#### DALES — the sparse aerial-LiDAR bracket

- **Acquisition:** airborne laser scanning (ALS), ~40 km² of mixed urban/rural terrain.
- **Scale & density:** ~505 M points at roughly 50 pts/m² — sparse and nadir.
- **Classes (8):** ground, vegetation, cars, trucks, power lines, fences, poles, buildings.
- **Access:** free for research; LiDAR only.
- **Strengths / use:** large-area aerial coverage; clean power-line/pole/fence labels.
- **Limitations:** top-down viewpoint undersamples vertical structure — facades and thin verticals are weak.
- **Airside transfer:** **low-moderate** — viewpoint mismatch; useful as the *sparse* density bracket and for fence/pole label diversity, not as a primary source.

#### Hessigheim 3D (H3D) — high-density UAV LiDAR + mesh, multi-epoch

- **Acquisition:** UAV-borne LiDAR (RIEGL) plus a co-registered photogrammetric textured mesh; an ISPRS benchmark captured at multiple epochs.
- **Scale & density:** very high — on the order of ~800 pts/m², comparable to a well-accumulated map.
- **Classes (11):** low vegetation, impervious surface, vehicle, urban furniture, roof, facade, shrub, tree, soil/gravel, vertical surface, chimney.
- **Access:** free for research; RGB via the mesh.
- **Strengths / use:** density close to an accumulated map; paired LiDAR + mesh tracks let you study point-vs-mesh segmentation; multi-epoch capture supports change studies.
- **Airside transfer:** **moderate** — high density is representative; UAV viewpoint is not.

#### STPLS3D — synthetic augmentation for rare classes

- **Acquisition:** aerial photogrammetry; a **real** split (~1.27 km²) plus a large **synthetic** split generated with a controllable simulator.
- **Classes:** the synthetic taxonomy reaches ~18 fine classes and includes rare categories (specialized vehicles, light poles, signs) seldom found together in other benchmarks.
- **Access:** free for research; RGB.
- **Strengths / use:** the synthetic split is the interesting part — it shows how simulator-generated labels cut annotation cost and rebalance rare classes, the same lever an airside pipeline needs given the labeling gap (§5.4, §12).
- **Airside transfer:** **moderate** — the synthetic-augmentation methodology transfers even where the scenes do not.

#### Supporting and specialized datasets

- **nuScenes-lidarseg (16 classes) / Waymo Open (23 classes)** — large single-scan MLS datasets; with per-frame poses they are accumulated into local maps on demand. Best used to train the *single-scan* models that the map pipeline later auto-labels.
- **WHU-Railway3D** — large MLS+ALS railway-corridor dataset (~11 classes incl. masts and overhead lines); corridor geometry is a useful analog for taxiways and service roads.
- **Swiss3DCities** — UAV-photogrammetry, three Swiss cities, ~5 coarse classes; useful for self-supervised pre-training at scale.
- **ISPRS Vaihingen-3D, LASDU, DublinCity, ECLAIR** — established ALS urban benchmarks; supplementary label diversity for ground/vegetation/building/structure.
- **SUM** — semantic *textured-mesh* benchmark (Helsinki, 6 classes); relevant if the pipeline meshes the map before labeling.
- **WildScenes / RELLIS-3D** — off-road MLS datasets; the closest public proxy for unstructured airside-adjacent terrain (grass margins, gravel, vegetation edges).

#### Licensing and commercial-use note

Almost every dataset above is released for **research / non-commercial use** (commonly CC-BY-NC or a custom academic licence). For a commercial airside product this matters: public datasets are fine for **pre-training, architecture selection, and benchmarking**, but a model whose weights are *shipped* should have its supervised fine-tuning grounded in **owned, in-domain airside data** — which the auto-label flywheel (§2.1, §10.5, §12) is designed to produce. Verify each licence before any production use; treat the public corpus as a pre-training and evaluation asset, not a deliverable.

### 5.3 How to Read This Landscape

- **There is no airside-domain aggregated-map dataset.** Consistent with the corpus theme — no public airside LiDAR datasets exist. The pipeline must be bootstrapped from out-of-domain data and adapted.
- **Match the survey geometry, not just "outdoor."** An airside MLS apron map resembles **Paris-Lille-3D / Toronto-3D / KITTI-360** (vehicle-mounted, ground-level, corridor + open-area) far more than DALES (nadir aerial). Pre-train on MLS sources; treat ALS as supplementary.
- **Photogrammetric ≠ LiDAR.** SensatUrban/STPLS3D/Swiss3DCities are excellent for RGB-point pipelines and for scale/tiling engineering, but their noise and density statistics differ from LiDAR — use for pre-training and tiling R&D, validate on LiDAR sources.
- **The multi-scan SemanticKITTI task is the most honest proxy** for "segment an accumulated cloud" in the AV domain — it explicitly accumulates frames and forces static/moving reasoning.
- **Density spread is the transfer risk.** Semantic3D (TLS, dense, uniform) and DALES (ALS, sparse, top-down) bracket the extremes; an MLS airside map sits between and is internally non-uniform. A model picked on one density will need adaptation.

### 5.4 The Airside Benchmark Gap

No public airside aggregated-map dataset exists (§5.3) — creating one is an open opportunity and the cheapest route to closing the corpus-wide airside data gap. This section specifies a concrete minimum-viable benchmark, the annotation protocol that produces it, and the cost model that governs it.

#### Benchmark Specification

| Component | Specification |
|---|---|
| **Maps** | 3-5 registered apron/taxiway/service-road maps from ≥2 airports, ideally of differing layout and climate, to expose cross-site domain shift. |
| **Source** | MLS survey drives registered by the `../../localization-mapping/maps/map-construction-pipeline.md` process (GTSAM + VGICP), RTK-anchored. |
| **Resolution** | 5 cm working voxel; full-resolution cloud retained with a back-index (§9.3). |
| **Taxonomy** | The 11-class airside taxonomy of §6.3 — pavement, marking, terrain, kerb, building, fence/barrier, pole/mast, sign, fixed equipment, staged GSE, unknown. |
| **Scale** | Target ≥2 km² total mapped area, ≥10⁹ points before voxel downsample. |
| **Splits** | Geographic tile split — held-out tiles never seen in training; at least one entire airport held out for cross-site generalization measurement. |
| **Panoptic subset** | A fully-instanced subset (poles, signs, staged-GSE units) for Panoptic Quality evaluation. |
| **Single-scan derivative** | Labels back-projected to contributing scans (§10.5), shipping a paired single-scan benchmark at no extra annotation cost. |
| **Formats** | Labeled point cloud (per-point class + confidence), tile manifest, train/val/test split file, per-scan label index. |
| **Metadata** | Per-tile density, intensity-calibration status, dynamic-removal method, registration accuracy — so density and conditioning can be controlled for in evaluation. |

#### Annotation Protocol

Annotation is the cost driver, so the protocol is a **bootstrapped, tiered flywheel**, not a flat manual pass:

1. **Heuristic pre-label.** Run the cheap geometric/intensity guards (§3.3) — ground plane, height-banded structures, intensity-masked markings — to pre-label the high-volume "easy" classes before any human touches the map.
2. **Foundation-model-assisted pre-label.** Apply SAM/CLIP-class 2D-to-3D and open-vocabulary lifting (§4.3, §12) for appearance-defined and rare classes the heuristics miss; this cuts manual effort 50-70% (§12).
3. **Segment-then-accumulate prior.** Where a single-scan model already exists, accumulate its per-voxel label histogram (§2.4, §10.3) as a second independent pre-label.
4. **Disagreement-routed human QC.** Humans do not review uniformly — route to annotators the tiles where the three pre-label sources *disagree*, plus low-confidence and rare-class regions (§13.2). Human effort concentrates where it actually changes labels.
5. **Authoritative pass and audit.** A trained reviewer signs off each tile; safety-relevant classes (markings, fencing) get 100% review, bulk classes get sampled audit — mirroring `../../localization-mapping/maps/map-construction-pipeline.md` §8.3-8.4.
6. **Flywheel iteration.** Verified tiles train the learned model; the next map is pre-labeled by that model instead of by heuristics; human QC shrinks each round.

Tooling: a CVAT-compatible 3D project (per `map-construction-pipeline.md` §8.4) carrying per-point confidence and pre-label provenance, so reviewers see *why* each point was labeled.

#### Cost Model

| Stage | Cost driver | Relative cost | Lever |
|---|---|---|---|
| Survey + registration | Drive time, SLAM compute | Low | Amortized — the map is built anyway |
| Conditioning | Compute | Low | Automated (§9) |
| Heuristic + FM pre-label | Compute | Low | Automated; near-free per map |
| Human QC | Annotator hours | **Dominant** | Disagreement routing + flywheel cut it each round |
| Audit + sign-off | Reviewer hours | Moderate | Sampled for bulk classes, full for safety classes |

The economics: a flat manual labeling of a 2 km² map at 5 cm is infeasible by raw point count. The flywheel makes it tractable — round 1 is the most expensive (heuristics plus heavy QC); by round 3-4 the learned model pre-labels well enough that human QC is a small fraction of round 1. The first airport funds the benchmark; every airport after is progressively cheaper. This is the same auto-labeling-flywheel argument as §2.1 and `lidar-semantic-segmentation.md` §9.4.

#### Release and Licensing

If the benchmark is published, the public-corpus licensing caution of §5.2 inverts: it becomes the asset other teams pre-train on. A permissive research licence maximizes adoption, and an airside-specific benchmark with a published leaderboard would be the first of its kind and a strong community contribution. If kept proprietary, it remains the owned in-domain fine-tuning and evaluation set that a shipped commercial model needs (§5.2 licensing note).

---

## 6. Class Taxonomies

### 6.1 The "Stuff vs Things" Balance Shifts

In single-scan driving segmentation, "things" (cars, pedestrians) dominate the safety story. In an aggregated **static** map, dynamics have been removed (§9) — what remains is overwhelmingly **stuff**: ground, structures, vegetation, infrastructure furniture. The taxonomy therefore emphasizes:

- **Surface classes** — drivable pavement, painted markings, unpaved/terrain, kerb/edge.
- **Vertical structure** — building/facade, fence/barrier, wall.
- **Infrastructure furniture** — pole (light/sign/CCTV), overhead wire, sign face, bollard.
- **Vegetation** — high vegetation (canopy) vs low vegetation (grass/shrub), since they differ in permanence and traversability.
- **Permitted statics** — parked GSE / staged equipment that are static *now* but not permanent map structure — a deliberate class so the pipeline does not bake them into the HD map (see `../../localization-mapping/maps/potentially-dynamic-object-map-policy.md`).
- **Catch-all / unknown** — explicit, never silent, feeds active learning.

### 6.2 Representative Public Taxonomies

| Dataset | Classes (abbreviated) |
|---|---|
| Semantic3D (8) | man-made terrain, natural terrain, high veg, low veg, building, hardscape, scanning artefact, car |
| Toronto-3D (8) | road, road marking, natural, building, utility line, pole, car, fence |
| DALES (8) | ground, vegetation, car, truck, power line, fence, pole, building |
| Paris-Lille-3D (9 coarse) | ground, building, pole, bollard, trash can, barrier, pedestrian, car, natural |

Note the convergent core across MLS/ALS taxonomies — **ground, building, vegetation, pole, fence/barrier, wire, vehicle** — which is exactly the transferable backbone for an airside taxonomy.

### 6.3 Proposed Airside Aggregated-Map Taxonomy (Initial 11-Class)

| ID | Class | Group | Permanence | Notes |
|---|---|---|---|---|
| 0 | Pavement (apron/taxiway/service road) | Surface | Permanent | Dominant class; geometry + low intensity |
| 1 | Surface marking (paint) | Surface | Semi (repainted) | High intensity; thin — needs map density |
| 2 | Terrain / unpaved / grass | Surface | Permanent | Off-movement-area; safety boundary |
| 3 | Kerb / edge / drainage channel | Surface | Permanent | Thin; localization-relevant |
| 4 | Building / terminal / hangar facade | Structure | Permanent | Tall vertical planes |
| 5 | Fence / barrier / wall | Structure | Permanent | Thin vertical; perimeter-critical |
| 6 | Pole / mast (light, sign, CCTV) | Furniture | Permanent | Thin vertical; strong localization landmark |
| 7 | Sign / signage panel | Furniture | Permanent | Small; appearance-defined |
| 8 | Fixed equipment (jet bridge, GPU, fixed plant) | Structure | Permanent | Large but site-specific |
| 9 | Staged GSE / parked equipment | Permitted static | **Transient** | Static now, *not* map structure — quarantine class |
| 10 | Unknown / unlabeled | Catch-all | — | Explicit; drives active learning |

This taxonomy maps cleanly onto the 18-class single-scan airside taxonomy in `lidar-semantic-segmentation.md` §8 — the map taxonomy is its *static subset* plus the "staged GSE" quarantine class. Keeping the two taxonomies aligned is what makes auto-label back-projection consistent.

### 6.4 Class Imbalance

Pavement and building can be 90%+ of points; markings, poles, signs are well under 1%. Standard mitigations apply and are *more* important here because aggregation does not balance the distribution: inverse-frequency or effective-number class weighting, focal/Lovász-softmax loss, point-repeat or tile-resampling toward rare classes, and rare-class-aware tile selection (§8). Report **per-class IoU**, never accuracy — a 95%-accurate map model can have ~0 IoU on markings.

---

## 7. Model Families and SOTA Methods

The offline budget means accuracy dominates; the model families below are ordered by how well they scale to map-sized clouds.

### 7.1 Point-Based Convolution

| Method | Mechanism | Strengths | Limits |
|---|---|---|---|
| **KPConv** (ICCV 2019) | Continuous kernel-point convolution on raw points | Industry workhorse for MLS/ALS; strong on Semantic3D, NPM3D, DALES; deformable variant for fine structure | Memory-heavy; needs sphere-sampling for large clouds |
| **RandLA-Net** (CVPR 2020) | Random sampling + local feature aggregation | Designed for large-scale; processes millions of points efficiently; low memory | Random sampling can drop rare thin structures |
| **PointNet++** | Hierarchical set abstraction | Simple baseline | Slow sampling; superseded |

KPConv and RandLA-Net remain the **default baselines** for surveyed-cloud segmentation — they are stable, well-documented, widely reproduced, and have years of mapping-industry mileage.

### 7.2 Sparse Voxel Convolution

| Method | Mechanism | Strengths | Limits |
|---|---|---|---|
| **MinkowskiNet / SparseConvNet** | Submanifold sparse 3D convolution on voxelized cloud | Excellent accuracy/efficiency; the backbone under many SOTA systems | Voxel resolution trades detail vs memory |
| **SpConv-based U-Nets** | Sparse conv with faster kernels | Faster than Minkowski on modern GPUs | Same resolution trade-off |
| **Cylinder3D** | Cylindrical sparse voxels | Matches spinning-LiDAR density | Tuned for single scans; less natural for maps |

Sparse-conv U-Nets are the most common production backbone — predictable, fast, TensorRT-friendly, and the safe choice when the team wants one well-understood architecture.

### 7.3 Transformers and Superpoint Methods

| Method | Mechanism | Strengths | Limits |
|---|---|---|---|
| **Point Transformer v3 (PTv3)** | Serialized (space-filling-curve) patch attention | Top single-scan accuracy; tiles cleanly for maps; pre-training (Sonata) adds 5-10% mIoU | Heaviest; needs tiling for map scale |
| **Superpoint Transformer (SPT)** | Hierarchical superpoint partition + sparse self-attention on the superpoint graph | Built for huge scenes — segments million-point clouds with tiny models (~10²-10³× fewer params); fast train/infer | Quality bounded by superpoint partition; less standard tooling |
| **SuperCluster** | Superpoint-graph panoptic segmentation, scales to whole cities | Panoptic at city scale, training-efficient | Newer; smaller ecosystem |
| **OctFormer** | Octree-based attention | Efficient on large clouds | Octree tooling overhead |

**Superpoint methods deserve a specific call-out for this topic**: they were *designed* for the exact problem — semantic (and panoptic) segmentation of very large registered scenes — and partly dissolve the tiling problem (§8) by partitioning into a superpoint graph instead of fixed tiles. For an airport-scale map, an SPT-class model is the strongest fit; a sparse-conv U-Net is the safe, well-tooled fallback; PTv3 is the accuracy ceiling when tiling is well-engineered.

### 7.4 Representative Accuracy

Approximate mIoU, public leaderboards as of early 2026 — read as *families and ranges*, not precise rankings:

| Dataset | RandLA-Net | KPConv | Sparse-conv U-Net | PTv3 / SPT-class |
|---|---|---|---|---|
| Semantic3D (reduced-8) | ~77 | ~75 | ~76-78 | ~78-80 |
| Paris-Lille-3D (NPM3D) | ~78 | ~82 | ~82-84 | ~84-86 |
| Toronto-3D | ~81 | ~82 | ~83-85 | ~85-87 |
| SensatUrban | ~53 | ~57 | ~58-62 | ~62-66 |
| DALES | ~77 | ~81 | ~80-83 | ~83-85 |

The consistent pattern: transformer/superpoint methods lead, sparse-conv is close behind at lower engineering cost, KPConv/RandLA-Net are the robust baselines, and **pre-training matters more than the last few points of architecture** — a pre-trained backbone fine-tuned on the target domain usually beats a fancier architecture trained from scratch.

### 7.5 The Train/Inference Density Gap — and Fixes

A model trained on single-scan data and run on an accumulated map sees an off-distribution input (§2.3). Fixes, cheapest first:

1. **Train on accumulated clouds directly** — accumulate the training data the same way the map is built. Best fix when labeled accumulated data exists.
2. **Density-randomized augmentation** — randomly subsample tiles during training across the density range the map spans, so the model is density-robust.
3. **Self-supervised pre-training on unlabeled airside maps** — then fine-tune with few labels (see `self-supervised-pretraining-driving.md`, `lidar-foundation-models.md`).
4. **Test-time adaptation** — adapt batch-norm/entropy on the target map (`test-time-adaptation-airside.md`).

### 7.6 Self-Supervised Pre-Training and 3D Foundation Models

§7.4 ends on the central claim: pre-training outweighs the last few points of architecture. This subsection makes that claim operational, because for an airside pipeline it is the **single highest-leverage model decision** — in-domain labels are scarce (§5.4) while unlabeled airside maps are abundant (every survey drive produces one).

**Why pre-training is decisive here.** A 3D segmentation model trained from random initialization needs thousands of labeled tiles to reach its accuracy ceiling; a realistic airside annotation budget is hundreds. Pre-training shifts the label-efficiency curve: a backbone that has already learned generic 3D structure — planarity, verticality, object compactness, density gradients — from unlabeled or out-of-domain data reaches the same mIoU with roughly 5-20× fewer labels. The corpus stance that SSL pre-training plus active learning cut labeling cost 50-80% is precisely this lever applied to map segmentation.

**Pre-training families:**

| Family | Pretext task | Representative methods | Fit for aggregated-map segmentation |
|---|---|---|---|
| **Contrastive** (point/voxel correspondence) | Pull matching points across two views together, push non-matches apart | PointContrast, SegContrast, DepthContrast, TARL | Mature; needs registered multi-view or temporal pairs — an aggregated map *contains* them for free |
| **Masked point/voxel modeling** | Mask part of the cloud, reconstruct geometry or occupancy | Voxel-MAE, Occupancy-MAE, Point-MAE/-BERT (object-level) | Scales to unlabeled maps; needs no correspondences; the natural choice for an unlabeled airside-map corpus |
| **Neural-rendering pretext** | Render the cloud to image/depth, supervise photometrically | PonderV2 | Strong representations; heavier; benefits from imagery |
| **Image-to-LiDAR distillation** | Distill a 2D vision foundation model into the 3D backbone | SLidR, ScaLR, Seal | Brings 2D semantics in *at train time only* — deployment stays LiDAR-only (§4.3) |
| **Multi-dataset joint training** | One backbone, many datasets, dataset-specific prompts/norms | Point Prompt Training (PPT) | Turns the fragmented public-dataset landscape (§5) into one pre-training corpus |
| **Generalist SSL backbone** | Large-scale SSL producing a reusable, optionally frozen backbone | Sonata (builds on PTv3) | Current SOTA generalist; strong linear-probe and few-shot; the lead backbone candidate |

**Recommended pre-training path for airside** (consistent with §7.5, §14.3, and `self-supervised-pretraining-driving.md`, `lidar-foundation-models.md`):

1. **Start from a generalist backbone.** Initialize from a Sonata/PTv3-class checkpoint pre-trained at scale rather than random weights — it already encodes transferable 3D structure.
2. **Continue SSL on unlabeled airside maps.** Masked-voxel modeling over the airside map corpus closes the domain gap (apron geometry, airside density signature, intensity statistics) *before* any label is spent. It is effectively free — it consumes only compute and maps the survey program already produces.
3. **Fine-tune with parameter-efficient adapters.** LoRA/PointLoRA-class adapters tune a few hundred labeled airside tiles while freezing most of the backbone — fast, low-overfit, and cheap to re-run each time the flywheel (§12) grows the label set.
4. **(Optional) image distillation at train time.** With calibrated survey imagery, distill a 2D foundation model into the 3D branch so the deployed model gains 2D semantics without an inference-time camera dependency.

**Cross-dataset training — turning §5 into one corpus.** The public landscape (§5) is fragmented across sensors, taxonomies, and label conventions. Point Prompt Training-style joint training treats that fragmentation as an asset: one shared backbone trained across Paris-Lille-3D, Toronto-3D, KITTI-360, SemanticKITTI and more, with per-dataset prompts/normalization absorbing the conventions. The backbone sees far more 3D variety than any single dataset offers, which transfers better to a new domain like airside than single-dataset pre-training.

**Open-vocabulary pre-training.** Methods that align 3D features with CLIP-style text/image embeddings (OpenScene, RegionPLC, and the Mosaic3D work in `mosaic3d.md`) can name classes never present in the training taxonomy. For airside this is a **long-tail safety net** — rare objects (unusual GSE, debris types) can be flagged by description instead of silently collapsing to "unknown." Treat it as a complement to the closed-set model, not a replacement; §6.3 retains an explicit unknown class regardless.

**Caveats.** Pre-training is not free accuracy: (i) a backbone pre-trained on *single-scan* data still inherits the density gap of §7.5 — continue SSL on *accumulated* clouds to fix it; (ii) SSL gains shrink as labeled data grows — past a few thousand labeled tiles the architecture begins to matter again; (iii) frozen-backbone linear probing is a useful fast feasibility check, but a fine-tuned (even LoRA) backbone is materially better for production.

### 7.7 Model Selection Decision Guide

The §7.4 accuracy table compresses to a small set of decision rules. In practice the choice is governed less by leaderboard rank than by **map scale, label budget, team tooling maturity, and inference constraints.**

| If the dominant constraint is… | Pick | Why |
|---|---|---|
| Team new to 3D segmentation; reliability first | Sparse-conv U-Net (Minkowski/SpConv), public-pretrained | Best tooling, predictable, TensorRT-friendly; the industry default (§7.2, §12) |
| Airport/city-scale map; tiling is the pain point | Superpoint Transformer / SuperCluster | Partitioning is intrinsic, whole-scene context, tiny models (§7.3, §8.2) |
| Maximum accuracy, tiling well-engineered | PTv3 + Sonata pre-training | Accuracy ceiling on public benchmarks (§7.4) |
| In-domain labels very scarce (the airside reality) | Any of the above + invest in §7.6 | Pre-training outweighs architecture choice (§7.4) |
| Sparse far-field, off-trajectory map regions | Add SphereFormer-style radial attention or density-randomized augmentation | Handles the intra-map density gap (§2.3, §7.5) |
| A single-scan model must also ship | Keep map and on-vehicle architectures aligned | Consistent auto-label back-projection across taxonomies (§6.3) |

**The meta-rule.** For airside specifically, the honest guidance is: do not over-invest in architecture search. §7.4's pattern holds — a well-pre-trained sparse-conv or superpoint model beats a poorly-trained transformer. Pick one architecture the team can support, get §7.6 (pre-training) and §9 (conditioning) right, and let the flywheel (§12) drive accuracy. Architecture is a P4 refinement (§15.2), not a P1 decision.

### 7.8 Training Architecture Comparison: Advantages and Disadvantages

§7.1-7.3 introduced the model families; §7.4 gave accuracy ranges; §7.7 gave a selection rule. This subsection compares the families head-to-head specifically through the **training lens** — the axes that decide cost, schedule, and risk when a map segmenter is actually trained, not just which leaderboard number is highest.

**Head-to-head comparison.**

| Axis | Point-based conv (KPConv, RandLA-Net) | Sparse-voxel conv (MinkowskiNet, SpConv U-Net) | Serialized transformer (PTv3) | Superpoint transformer (SPT, SuperCluster) |
|---|---|---|---|---|
| Input representation | Raw points + local neighborhoods | Voxelized sparse tensor | Serialized point patches (space-filling curve) | Geometric superpoint graph |
| Typical parameters | 1-15 M | 5-40 M | 15-100 M+ | 0.2-1 M (≈10²-10³× fewer) |
| GPU memory at tile scale | High (neighbor search, kernel points) | Moderate, predictable | High (attention) | Very low |
| Training-data hunger | Moderate | Moderate | High from scratch; low if pre-trained | Low |
| Convergence behavior | Stable, slow; sampling adds variance | Stable, fast, well-behaved | Sensitive — needs warmup, LR schedule, often pre-training to converge well | Fast; partition is a deterministic pre-pass |
| Augmentation sensitivity | Moderate | Low — robust to standard augments | High — benefits most from heavy augmentation + TTA | Moderate; partition must be recomputed per augment |
| Pre-training ecosystem | Limited public checkpoints | Some (contrastive, MAE) | Strongest — Sonata/PPT checkpoints, the §7.6 lever | Growing but smaller |
| Tiling interaction | Sphere sampling native | Needs explicit tiling + halo | Tiles cleanly; serialization is tile-friendly | Largely dissolves tiling (§8.2) |
| Inference scaling to map | Many overlapping inferences | Tile-parallel, predictable | Tile-parallel, heaviest per tile | Best — whole-scene graph |
| Tooling / reproducibility | Mature, widely reproduced | Very mature, production-standard | Mature, active, well-maintained | Newer, smaller ecosystem |
| TensorRT / deployment | Awkward (custom ops) | Best — TensorRT-friendly | Improving; attention kernels heavier | Graph ops less standard |

**Per-architecture training characteristics:**

- **Point-based convolution.** *Advantage:* operates on raw geometry with no voxelization loss, so thin and fine structure is preserved at training time; deformable KPConv adapts kernels to local shape. *Disadvantage:* neighbor search and kernel-point bookkeeping make memory and training time high; RandLA-Net's random sampling injects run-to-run variance and can statistically drop rare thin classes from a training batch unless rare-class-aware sampling is added (§8.3). Best when the team wants a well-understood, geometry-faithful baseline and can absorb the training cost.

- **Sparse-voxel convolution.** *Advantage:* the most *predictable* family to train — stable convergence, low augmentation sensitivity, fast epochs, mature tooling, and the cleanest path to a TensorRT-deployable single-scan sibling. That predictability is exactly why it is the deployed industry baseline (§12). *Disadvantage:* voxelization caps the resolution of thin classes — markings and wires can fall below the voxel grid; the fix (finer voxels) costs memory steeply. Best as the default production choice and the safe first model.

- **Serialized transformer (PTv3).** *Advantage:* the highest accuracy ceiling, and the family with the strongest pre-training ecosystem — a Sonata/PPT-pretrained PTv3 is the §7.6 recommendation, and pre-training is what makes its otherwise-high data hunger manageable. *Disadvantage:* trained from scratch it is the most finicky — sensitive to learning-rate schedule, warmup, batch size, and augmentation; without pre-training it can underperform a sparse-conv U-Net while costing far more. Best when pre-training is in place and tiling (§8) is well-engineered.

- **Superpoint transformer.** *Advantage:* built for exactly this problem — it trains fast, fits in tiny memory, sees whole-scene context, and partly dissolves the tiling problem; the small parameter count overfits less on small label sets. *Disadvantage:* accuracy is upper-bounded by the geometric superpoint partition — a bad partition cannot be recovered by the network, and the partition must be recomputed when geometry-altering augmentation is applied; tooling is less standard. Best for airport-scale maps and small label budgets.

**The training-lens verdict.** For a first airside map segmenter, **sparse-voxel convolution** is the lowest-risk training choice — predictable, fast, well-tooled. **Superpoint transformer** is the strongest *fit* for map scale and scarce labels. **PTv3** is worth its training fragility *only* once §7.6 pre-training is in place. Point-based convolution remains a solid, geometry-faithful baseline but rarely the throughput-optimal choice for map-sized clouds. Across all four, §7.4's rule dominates: a pre-trained backbone of any family beats a from-scratch model of a fancier one.

---

## 8. Tiling, Chunking, and Stitching

This is the engineering core that distinguishes a *map* segmentation pipeline from a single-scan one. A million-to-billion-point cloud cannot enter one forward pass; the pipeline must partition, infer, and re-merge — without leaving seams.

### 8.1 Why Tiling Is Unavoidable

A 1 km² MLS apron map at 5 cm voxels is ~10⁸-10⁹ points. Even a sparse-conv backbone handles ~10⁶-10⁷ points per forward pass on a 24-48 GB GPU. The cloud must be cut into 10²-10⁴ tiles. Every tiling choice trades **context** (does the model see enough to recognize a class) against **memory** and against **seam artifacts**.

### 8.2 Partition Strategies

| Strategy | How | Pros | Cons |
|---|---|---|---|
| **Fixed grid blocks** | XY grid, e.g. 50 m × 50 m tiles | Simple; trivially parallel | Hard boundaries cut objects; class context lost at edges |
| **Overlapping grid tiles** | Grid + margin (e.g. 10-20% overlap) | Overlap region enables voting; standard | Redundant compute in overlap |
| **Sphere / cylinder sampling** | Sample a fixed-radius neighborhood around a seed point, predict only the inner core (KPConv / RandLA-Net style) | Uniform context; no axis-aligned seams; rare-class-aware seeding | Many overlapping inferences; bookkeeping |
| **Superpoint partition** | Geometric partition into superpoints; graph spans the whole scene (SPT) | Largely *dissolves* the tiling problem; whole-scene context | Partition quality caps accuracy |
| **Sparse-voxel streaming** | Stream sparse voxels region by region with halo exchange | Memory-bounded; near seam-free with halos | Implementation complexity |

### 8.3 Choosing Tile Size and Overlap

- **Tile footprint must exceed the largest class extent.** A 50 m tile cannot give context for a 65 m aircraft or a long building facade — size tiles to the scene's largest object plus margin.
- **Overlap 10-25%.** Below ~10%, seam voting is unreliable; above ~25%, compute waste dominates.
- **Coordinate normalization per tile.** Center each tile at its own origin; never feed absolute site coordinates (the network must not memorize positions). Preserve *relative* height-above-ground as a feature (§4.1) — that prior is real and worth keeping.
- **Density-aware seeding.** Seed extra tiles where rare classes (markings, poles) or low-density far field occur, so they are not statistically drowned.

### 8.4 Stitching: Merging Tile Predictions

Each point in an overlap region receives multiple predictions; the merge step resolves them:

- **Logit averaging (preferred).** Accumulate per-class logits/softmax across all tiles covering a point, then argmax once. Smooth, calibration-friendly. Optionally weight each tile's vote by the point's distance to that tile's center (down-weight edge predictions, where context is truncated).
- **Majority voting.** Argmax per tile, then vote. Simpler but discards confidence.
- **Confidence-max.** Take the most confident tile prediction. Fast; brittle to a single overconfident edge tile.

**Seam handling:** even with overlap, residual seams appear at tile borders. Restrict each tile's *committed* predictions to its inner core (the sphere-sampling pattern), and run a light geometric label smoothing across the full merged cloud afterward (§10.1) to erase remaining discontinuities.

### 8.5 Throughput Engineering

- **Spatial index once** (k-d tree / voxel hash) and reuse for tiling, neighbor queries, and stitching.
- **Out-of-core processing** — stream tiles from disk; never require the whole cloud resident in RAM.
- **Tile-level parallelism** — tiles are independent; scale across GPUs trivially. This is the pipeline's main throughput lever.
- **Mixed precision (FP16/BF16)** — offline accuracy tolerates it; roughly doubles throughput.
- **Checkpoint per tile** — a crash at tile 8,000 of 10,000 should resume, not restart. Offline batches are long; resumability is not optional.

---

## 9. Pre-Processing and Map Conditioning

Segmentation quality is capped by input quality. Conditioning runs *before* tiling.

### 9.1 Dynamic Object Removal (Prerequisite)

Moving objects captured during the survey leave ghost trails that no static class explains. Remove them *before* segmentation using multi-session/temporal-consistency methods — ERASOR, Removert, MapCleaner and successors — covered in depth in `../../localization-mapping/slam-methods/lidar-map-cleaning-dynamic-removal.md`. The multi-session voting approach in `map-construction-pipeline.md` §3.5 (keep voxels seen in ≥K of N sessions) is the simplest robust option. Caveat: aggressive removal also deletes legitimately static thin structures — tune toward conservative removal and let the "staged GSE" class (§6.3) catch the rest.

### 9.2 Deskew, Outlier Removal, Normal Estimation

- **Statistical outlier removal** — drop isolated noise (k≈30 neighbors, std-ratio ≈2.0).
- **Normal estimation** — per-point normals (k≈20), oriented toward the originating sensor pose; required for normal-based features (§4.1) and any meshing.
- **Drift-aware cleanup** — where loop closure left double surfaces, a local re-registration or surface-consistency filter reduces blur before segmentation.

### 9.3 Resampling and Voxelization

- **Uniform voxel downsample** to the working resolution (2-5 cm for airside maps) — bounds tile point counts and partially normalizes the trajectory-near/far density gap.
- **Keep an index back to full resolution** so final labels can be propagated to every original point (nearest-neighbor or learned upsampling).
- **Density-equalizing resample** (optional) — cap points per voxel to flatten the intra-map density gradient the model is sensitive to (§2.3).

### 9.4 Intensity Calibration

Raw intensity varies with range, incidence angle, and per-sensor gain. For a multi-LiDAR, multi-pass airside map this scatter destroys the marking signal unless corrected:

- Range/incidence-angle normalization to a canonical reference.
- Per-sensor gain alignment across the 4-8 LiDARs.
- Histogram matching across survey passes.

Calibrated intensity is close to decisive for the paint-marking class — it is the cheapest large accuracy gain in the whole pipeline.

### 9.5 Colorization (If Using RGB)

If the pipeline uses colorized input (§4.2): project imagery per point, resolve multi-view conflicts (median or most-confident colour, reject grazing-angle projections), and exposure-normalize across the survey. Poor colorization is worse than no colour — a miscalibrated projection paints colour onto the wrong geometry.

---

## 10. Post-Processing and Refinement

### 10.1 Geometric Label Smoothing

Raw per-point predictions are locally noisy and carry seam discontinuities. A spatial regularizer cleans them:

- **k-NN / voxel majority smoothing** — relabel each point by its neighborhood majority. Cheap, removes salt-and-pepper noise and seams.
- **Dense CRF / graph-cut** — energy minimization with a unary (network logits) and a pairwise term (encourages same label for nearby, geometrically/photometrically similar points). The offline budget makes this affordable; it sharpens boundaries the smoothing blurs.
- **Superpoint consistency** — if a superpoint backbone (§7.3) was used, enforcing one label per superpoint is a free, strong regularizer.

### 10.2 Instance and Panoptic Extraction

For "things" classes that survive into the static map (staged GSE, individual signs/poles), instances come from class-wise clustering on top of semantic labels — DBSCAN/HDBSCAN/connected components, the training-free ALPINE-style pattern documented in `lidar-semantic-segmentation.md` §6-§7. SuperCluster (§7.3) gives panoptic directly at map scale if a learned panoptic output is preferred.

### 10.3 Fusing the Segment-Then-Accumulate Prior

If single-scan labels were accumulated per voxel (§2.4), each voxel carries a label histogram. Fuse it with the accumulate-then-segment pass: use the prior as an extra unary term in the CRF (§10.1), or as a tie-breaker where the map model is low-confidence. Agreement between the two passes is also a free QA signal (§13) — disagreement regions are exactly what to route to human review.

### 10.4 Geometric and Map-Prior Constraints

Cheap, high-value sanity corrections: enforce ground continuity/flatness for the pavement class; reject "building" points below a height threshold; snap marking labels to the calibrated-intensity mask; cross-check against AMDB/HD-map geometry where available (`map-construction-pipeline.md` §7).

### 10.5 Output Products

The pipeline emits: a **labeled point cloud** (per-point class + confidence), an optional **labeled semantic mesh**, the **HD-map semantic layer** (§14, polygonized surfaces / vectorized markings / structure footprints), and **back-projected single-scan auto-labels** (per-scan labels via pose look-up — the data-flywheel output).

---

## 11. Pipeline Design Trade-offs and Decision Guide

The decisions that most shape an aggregated-map segmentation pipeline:

| Decision | Option A | Option B | Guidance |
|---|---|---|---|
| Input modality | LiDAR-only | + RGB / image fusion | LiDAR-only default; add RGB only with calibrated, well-lit imagery; prefer distillation so deploy stays LiDAR-only (§4) |
| Learned core | Sparse-conv U-Net | Transformer / superpoint | Sparse-conv = safe, well-tooled; SPT-class = best fit for map scale; PTv3 = accuracy ceiling with good tiling (§7) |
| Partitioning | Fixed/overlap grid | Superpoint / sphere sampling | Superpoint dissolves seams; grid is simplest; never use non-overlapping grid (§8) |
| Build order | Accumulate-then-segment | Segment-then-accumulate | Use both — prior + authoritative pass (§2.4, §10.3) |
| Training data | Public out-of-domain | Auto-labeled in-domain | Bootstrap on MLS public data → adapt → grow in-domain via the flywheel (§5, §7.5) |
| Refinement | k-NN smoothing | Dense CRF | CRF if boundary quality matters and budget allows; smoothing always (§10.1) |
| Heuristic guards | None (pure learned) | Ground + intensity priors as QA | Keep guards as cross-checks, not primary classifiers (§3.3) |
| Resolution | Fine (2 cm) | Coarse (5-10 cm) | Fine for markings/thin classes; coarse for throughput — or multi-resolution |

**General principles.** Conditioning quality caps everything — never skip dynamic removal or intensity calibration. Make the pipeline *resumable and observable*: offline batches are long, and a silent failure at tile 9,000 is expensive. Keep the map taxonomy aligned with the single-scan taxonomy so auto-labels are consistent. Report per-class IoU, not accuracy. And treat the pipeline as iterative — first pass auto-labels, humans correct the worst regions, retrain, repeat: the flywheel.

---

## 12. Industry-Proven Methods and Production Practice

Aggregated-map segmentation is **mature in industry** — more so than its public-research profile suggests, because the surveying and AV-mapping industries have run it at scale for years.

- **Mobile-mapping and survey industry.** Vendors of MLS systems and their software (point-cloud classification in tools used by survey and GIS firms) ship production pipelines that classify ground, vegetation, buildings, wires, poles, and road furniture from registered MLS/ALS clouds. The dominant deployed backbones are **KPConv- and RandLA-Net-class** point networks and sparse-conv U-Nets — chosen for stability and reproducibility, not novelty. This is the single strongest signal that those two families are the safe production baseline.
- **GIS platforms.** Mainstream GIS software exposes deep-learning point-cloud classification (historically PointCNN-class models, now broader) as a standard workflow over aerial and mobile LiDAR — aggregated-map segmentation as a productized, button-press feature.
- **AV offline auto-labeling / offboard perception.** Leading AV programs run **offboard / "auto-labeling" pipelines**: heavy offline models segment and detect over accumulated multi-frame clouds with full future+past context, then back-propagate labels to single frames as training data. This is precisely the accumulate-then-segment + back-projection flywheel in §2.4 / §10.5, and it is core production practice — the public-facing example pattern is Waymo's offboard 3D auto-labeling.
- **HD-map production.** Map vendors build semantic HD-map layers (lane geometry, markings, signs, poles) from accumulated survey clouds — a direct industrial instance of this pipeline; see `../../localization-mapping/maps/map-construction-pipeline.md` and `semantic-mapping-learned-priors.md`.
- **Foundation-model-assisted labeling.** SAM/CLIP-assisted and semi-automatic LiDAR labeling tools (e.g. SALT-class tools) cut annotation cost 50-70% and are now standard in the bootstrap phase.

**Takeaway for an airside pipeline:** the industry-proven recipe is *not* exotic — a KPConv/RandLA-Net or sparse-conv backbone, sphere/tile partitioning, overlap voting, geometric smoothing, and an auto-labeling flywheel. The differentiation for airside is the **data and taxonomy** (§5.4, §6.3), not the architecture.

---

## 13. Evaluation Metrics and Quality Assurance

### 13.1 Metrics

| Metric | What it measures | Why it matters here |
|---|---|---|
| **Per-class IoU** and **mIoU** | Intersection-over-union per class | The primary metric; per-class exposes rare-class collapse that mIoU/accuracy hide |
| **Overall accuracy (OA)** | Fraction of points correct | Report for comparability only — dominated by pavement/building |
| **Boundary IoU / boundary F1** | Accuracy near class transitions | Catches seam artifacts and edge blur (§8) |
| **Panoptic Quality (PQ)** | If instances/panoptic produced | For staged-GSE and furniture instances |
| **Coverage** | Fraction of map points with a confident label | Unlabeled/unknown rate; feeds active learning |
| **Calibration (ECE)** | Confidence vs correctness | Needed if confidence gates auto-label acceptance |

### 13.2 QA Gates

- **Held-out tile evaluation** — never report on tiles or scans seen in training.
- **Cross-pass consistency** — agreement between accumulate-then-segment and segment-then-accumulate (§10.3); low-agreement regions flag for review.
- **Heuristic cross-check** — disagreement with the ground/intensity guards (§3.3) flags regions.
- **Geometric plausibility** — buildings off the ground, markings off non-pavement, floating ground points → flag.
- **Seam audit** — boundary-IoU sampled along tile borders; a spike means tiling/stitching needs tuning.
- **Human spot-review** — route the lowest-confidence and highest-disagreement tiles (not random tiles) to annotators; this is the active-learning loop.
- **Stability across map versions** — when the map is re-surveyed, label churn in unchanged regions should be near zero.

### 13.3 Benchmarking Protocol and Statistical Rigor

Headline mIoU is easy to report and easy to inflate. A research-grade evaluation of an aggregated-map segmenter follows a stricter protocol:

- **Geographic, leak-free splits.** Adjacent tiles share structure — a random tile split lets the model memorize geometry that recurs across the train/test boundary. Split by geography with a buffer zone, and hold out at least one entire airport for the cross-site number (§5.4). Report in-site and cross-site mIoU separately; the gap is the real generalization signal.
- **Evaluate at full point resolution.** A voxelized model predicts per voxel; metrics computed at voxel resolution are optimistic because they ignore the within-voxel points the prediction is propagated to. Always propagate labels to the original full-resolution cloud and score there (§9.3).
- **Density-stratified reporting.** Intra-map density varies by orders of magnitude (§2.3). A single mIoU averages away far-field collapse — report mIoU bucketed by local density (trajectory-near vs. off-trajectory) so the density-gap failure (§7.5) is visible, not hidden.
- **Multiple seeds.** Models with stochastic components (RandLA-Net's random sampling, tile seeding, augmentation) vary run to run — report mean ± standard deviation over ≥3 seeds, not a single best run. A 0.5-point mIoU difference inside one standard deviation is not an improvement.
- **Per-class IoU, rare classes called out.** mIoU is reported but never alone; thin/rare classes (markings, poles, signs, wires) get their own line — a model can gain mIoU while a safety-relevant class collapses.
- **Boundary metrics at multiple tolerances.** Boundary IoU/F1 evaluated at several distance tolerances catches edge blur and seam artifacts a volumetric IoU misses (§8).
- **Fair baseline comparison.** When comparing architectures (§7.8), fix everything else — same conditioning, same tiles, same taxonomy, same augmentation, same label set — so the delta is attributable to the model, not the pipeline around it.
- **Evaluate the auto-labels, not just the map.** The pipeline's product is also back-projected single-scan labels (§10.5). Score the back-projected labels against a small manually-labeled single-scan set — auto-label quality, not just map mIoU, is what bounds the downstream on-vehicle model.

Each metric should ship with the conditions it was measured under — voxel size, dynamic-removal method, density bucket, seed count — so two results are genuinely comparable (§5.4 metadata).

---

## 14. Airside Application

### 14.1 The Airside Case

The airside aggregated map is the survey-drive product of `map-construction-pipeline.md`: a 5 cm-voxel apron/taxiway/service-road map registered by GTSAM + VGICP, anchored to RTK ground control. Segmenting it produces the **L3 semantic layer** of the airside HD map and auto-labels for the airside single-scan models — directly advancing the "no public airside dataset" gap the corpus identifies as an open opportunity.

### 14.2 Why Airside Suits This Pipeline

- **Repetitive, bounded geometry.** Airports are surveyed repeatedly along the same corridors — accumulation produces unusually dense, complete maps, and the flywheel turns fast.
- **Mostly static, structured scenes.** After dynamic removal, the apron is dominated by pavement, markings, structures, fencing, and poles — a taxonomy (§6.3) that transfers well from public MLS datasets.
- **Offline budget removes the Orin constraint.** The map pipeline runs in the cloud/depot with the heaviest models; only the *single-scan* models inherit auto-labels and must hit the Orin cycle (`lidar-semantic-segmentation.md`).

### 14.3 Airside-Specific Considerations

- **Scale extremes.** Aircraft (30-65 m) and FOD-scale objects (1-10 cm) span 3-4 orders of magnitude — tiles must be large enough for aircraft context yet resolution fine enough for markings (argues for multi-resolution, §11).
- **High-vis and specular returns.** Crew vests and wet concrete saturate or absorb intensity — intensity calibration (§9.4) must be robust to it.
- **Staged GSE quarantine.** The "staged GSE" class (§6.3, ID 9) prevents transient equipment being baked into the permanent map — coordinate with `../../localization-mapping/maps/potentially-dynamic-object-map-policy.md`.
- **Transfer path.** Pre-train on Paris-Lille-3D / Toronto-3D / KITTI-360 (MLS, ground-level), self-supervised pre-train on unlabeled airside maps, then fine-tune with a few hundred labeled airside tiles via PointLoRA-class adapters (`lidar-foundation-models.md`, `self-supervised-pretraining-driving.md`).

The airside aggregated-map benchmark specification, annotation protocol, and cost model are detailed in §5.4; the phased per-airport rollout is the roadmap in §15.2.

---

## 15. Recommended Pipeline and Roadmap

### 15.1 Recommended Pipeline

```
┌──────────────────────────────────────────────────────────────┐
│        RECOMMENDED AGGREGATED-MAP SEGMENTATION PIPELINE        │
├──────────────────────────────────────────────────────────────┤
│  Input:       MLS aggregated map (5 cm voxel) + per-scan poses │
│               LiDAR-only at inference (RGB via distillation)   │
│                              ↓                                 │
│  Conditioning: dynamic removal → SOR → normals → intensity     │
│               calibration → uniform voxel downsample           │
│                              ↓                                 │
│  Partition:   superpoint partition (SPT-class) — or            │
│               overlapping sphere sampling as the fallback      │
│                              ↓                                 │
│  Core model:  superpoint transformer OR sparse-conv U-Net,     │
│               SSL-pretrained, fine-tuned with LoRA adapters    │
│                              ↓                                 │
│  Stitch:      per-class logit averaging, center-weighted       │
│                              ↓                                 │
│  Post:        k-NN smoothing → dense CRF (prior + heuristic    │
│               unaries) → class-wise clustering for instances   │
│                              ↓                                 │
│  QA:          held-out mIoU, cross-pass + heuristic checks,    │
│               low-confidence tiles → human review              │
│                              ↓                                 │
│  Output:      HD-map L3 semantic layer + back-projected        │
│               single-scan auto-labels (data flywheel)          │
└──────────────────────────────────────────────────────────────┘
```

### 15.2 Roadmap

| Phase | Capability | Dependencies |
|---|---|---|
| P1 | Conditioning + tiling + a public-pretrained sparse-conv baseline on one airside map | Survey map, dynamic removal |
| P2 | SSL pre-training on unlabeled airside maps + LoRA fine-tune on a few hundred labeled tiles | Unlabeled map corpus, small annotation budget |
| P3 | Auto-label back-projection → single-scan training sets; first airside benchmark slice | P2 model, pose look-up |
| P4 | Superpoint/transformer core, CRF refinement, panoptic for staged-GSE instances | P3 data |
| P5 | Multi-airport transfer; published airside aggregated-map benchmark | Multi-site maps |

---

## 16. References and Related Documents

### Core Methods
- **KPConv** — Thomas et al., "KPConv: Flexible and Deformable Convolution for Point Clouds" (ICCV 2019)
- **RandLA-Net** — Hu et al., "RandLA-Net: Efficient Semantic Segmentation of Large-Scale Point Clouds" (CVPR 2020)
- **MinkowskiNet** — Choy et al., "4D Spatio-Temporal ConvNets: Minkowski Convolutional Neural Networks" (CVPR 2019)
- **Point Transformer V3** — Wu et al., "PTv3: Simpler, Faster, Stronger" (CVPR 2024) — [arxiv.org/abs/2312.10035](https://arxiv.org/abs/2312.10035)
- **Superpoint Transformer** — Robert et al., "Efficient 3D Semantic Segmentation with Superpoint Transformer" (ICCV 2023)
- **SuperCluster** — Robert et al., "Scalable 3D Panoptic Segmentation As Superpoint Graph Clustering" (3DV 2024)
- **OctFormer** — Wang, "OctFormer: Octree-based Transformers for 3D Point Clouds" (SIGGRAPH 2023)
- **2DPASS** — Yan et al., "2DPASS: 2D Priors Assisted Semantic Segmentation on LiDAR Point Clouds" (ECCV 2022)
- **SphereFormer** — Lai et al., "Spherical Transformer for LiDAR-based 3D Recognition" (CVPR 2023)

### Pre-Training and 3D Foundation Models
- **PointContrast** — Xie et al., "PointContrast: Unsupervised Pre-training for 3D Point Cloud Understanding" (ECCV 2020)
- **Point Prompt Training (PPT)** — Wu et al., "Towards Large-scale 3D Representation Learning with Multi-dataset Point Prompt Training" (CVPR 2024)
- **Sonata** — Wu et al., "Sonata: Self-Supervised Learning of Reliable Point Representations" (CVPR 2025)
- **SLidR** — Sautier et al., "Image-to-Lidar Self-Supervised Distillation for Autonomous Driving Data" (CVPR 2022)
- **ScaLR** — Puy et al., "Three Pillars Improving Vision Foundation Model Distillation for LiDAR" (CVPR 2024)
- **PonderV2** — Zhu et al., "PonderV2: Pave the Way for 3D Foundation Model with A Universal Pre-training Paradigm" (2023)
- **Voxel-MAE** — Hess et al., "Masked Autoencoders for Self-Supervised Learning on Automotive Point Clouds" (2022)

### Datasets and Benchmarks
- **Semantic3D** — Hackel et al., "Semantic3D.net: A New Large-Scale Point Cloud Classification Benchmark" (ISPRS 2017)
- **Paris-Lille-3D** — Roynard et al., "Paris-Lille-3D: A Large and High-Quality Ground-Truth Urban Point Cloud Dataset" (IJRR 2018)
- **Toronto-3D** — Tan et al., "Toronto-3D: A Large-Scale Mobile LiDAR Dataset for Semantic Segmentation of Urban Roadways" (CVPRW 2020)
- **SensatUrban** — Hu et al., "Towards Semantic Segmentation of Urban-Scale 3D Point Clouds" (CVPR 2021)
- **DALES** — Varney et al., "DALES: A Large-Scale Aerial LiDAR Data Set for Semantic Segmentation" (CVPRW 2020)
- **Hessigheim 3D (H3D)** — Kölle et al., "The Hessigheim 3D Benchmark on Semantic Segmentation of High-Resolution 3D Point Clouds and Textured Meshes" (ISPRS Open 2021)
- **STPLS3D** — Chen et al., "STPLS3D: A Large-Scale Synthetic and Real Aerial Photogrammetry 3D Point Cloud Dataset" (BMVC 2022)
- **SemanticKITTI** — Behley et al., "SemanticKITTI: A Dataset for Semantic Scene Understanding of LiDAR Sequences" (ICCV 2019)
- **KITTI-360** — Liao et al., "KITTI-360: A Novel Dataset and Benchmarks for Urban Scene Understanding in 2D and 3D" (TPAMI 2022)

### Related Repository Documents
- `30-autonomy-stack/perception/overview/lidar-semantic-segmentation.md` — single-scan / real-time on-vehicle segmentation (the complementary page)
- `30-autonomy-stack/perception/overview/lidar-foundation-models.md` — PTv3, Sonata, ScaLR, PointLoRA pre-training
- `30-autonomy-stack/perception/methods/minkowskinet.md` — MinkowskiNet deep-dive (sparse-voxel convolution U-Net baseline)
- `30-autonomy-stack/perception/methods/kpconv.md` — KPConv deep-dive (point-based convolution baseline)
- `30-autonomy-stack/perception/methods/randla-net.md` — RandLA-Net deep-dive (efficient large-scale point-based segmentation)
- `30-autonomy-stack/perception/methods/cylinder3d.md` — Cylinder3D deep-dive (cylindrical sparse-voxel, single-scan oriented)
- `30-autonomy-stack/perception/methods/point-transformer-v3.md` — PTv3 backbone deep-dive (serialized-attention 3D transformer)
- `30-autonomy-stack/perception/methods/octformer.md` — OctFormer deep-dive (octree-based transformer for large clouds)
- `30-autonomy-stack/perception/methods/superpoint-transformer.md` — Superpoint Transformer deep-dive (large-scale superpoint-graph segmentation)
- `30-autonomy-stack/perception/overview/self-supervised-pretraining-driving.md` — SSL pre-training for label-efficient fine-tuning
- `30-autonomy-stack/perception/overview/test-time-adaptation-airside.md` — closing the train/inference domain gap
- `30-autonomy-stack/localization-mapping/maps/map-construction-pipeline.md` — the offline HD-map construction pipeline that produces the aggregated map and consumes the semantic layer
- `30-autonomy-stack/localization-mapping/maps/semantic-mapping-learned-priors.md` — semantic map layers and learned priors
- `30-autonomy-stack/localization-mapping/slam-methods/lidar-map-cleaning-dynamic-removal.md` — dynamic-object removal (required pre-processing)
- `30-autonomy-stack/localization-mapping/slam-methods/semantic-slam.md` — segment-then-accumulate / online semantic mapping
- `30-autonomy-stack/localization-mapping/maps/potentially-dynamic-object-map-policy.md` — staged/transient object policy for the map
