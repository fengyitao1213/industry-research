# Large-Scale 3D Point Cloud Semantic Segmentation Benchmarks

**Last updated:** 2026-05-23

## Why It Matters

An aggregated-LiDAR-map semantic segmentation pipeline is built, pre-trained, and validated against the public 3D point cloud segmentation benchmarks — no airside-domain benchmark exists (see `../overview/aggregated-map-semantic-segmentation.md` §5.4). This page is the **evaluation-mechanics reference** for that benchmark landscape: splits, metrics, submission servers, label formats, licensing, and known issues. The companion §5 of the aggregated-map page is the *selection guide* (which dataset for what); this page is the *usage reference* (how to actually train and evaluate on them).

The practical point: these datasets shape what every 3D segmentation method reports. A "SOTA on SemanticKITTI" claim means little without knowing the split, the task variant, whether the number came from the hidden test server or a local validation set, and whether the method used multi-dataset pre-training.

## Benchmark Landscape

| Benchmark | Modality | Task variants | Eval classes | Metric | Leaderboard |
|---|---|---|---|---|---|
| SemanticKITTI | MLS (HDL-64E) | Single-scan; multi-scan (accumulated) | 19 / 25 | mIoU | Hidden test server (CodaLab) |
| nuScenes-lidarseg | MLS (HDL-32E) | Single-frame lidarseg; panoptic | 16 | mIoU | Hidden test server (EvalAI, 3/yr cap) |
| Waymo 3D Seg | Multi-LiDAR vehicle | Per-frame semantic | 22 | mIoU | waymo.com/open |
| Semantic3D | TLS (static) | semantic-8; reduced-8 | 8 | mIoU / OA | Online server (no annual cap) |
| Paris-Lille-3D (NPM3D) | MLS | Coarse segmentation | 10 | Av.IoU | Online test server |
| Toronto-3D | MLS | Segmentation | 8 | mIoU / OA | Public split (L002 test) |
| KITTI-360 | MLS (accumulated) | 3D segmentation; 2D-3D | ~19 | mIoU | Online server (cvlibs.net) |
| DALES | ALS (airborne) | Segmentation | 8 | mIoU / OA | Public split |
| SensatUrban | UAV photogrammetry | Segmentation | 13 | mIoU / OA | Hidden test server (CodaLab) |
| STPLS3D | Aerial photogrammetry + synthetic | Segmentation; instance | up to 18 | mIoU / AP | Public + challenge |
| S3DIS | RGB-D (indoor) | Semantic segmentation | 13 | mIoU / OA | Area-5 or 6-fold (no server) |
| ScanNet v2 / ScanNet200 | RGB-D mesh (indoor) | Semantic; instance | 20 / 200 | mIoU / mAP | Hidden test server |
| FRACTAL | ALS (airborne) | Segmentation | 7 | mIoU / OA | Public split (HuggingFace) |
| GOOSE / GOOSE-Ex | LiDAR + RGB + NIR (off-road) | Segmentation (64 fine / 8 super) | 64 | mIoU | Public split; ICRA 2025 challenge |
| SemanticRail3D | MLS (railway corridor) | Semantic; instance | ~11–12 | mIoU | Public split |
| WHU-Railway3D | MLS (railway, multi-env) | Semantic | 11 | mIoU / OA | Public split |
| Turin3D | ALS (airborne) | Semi-supervised segmentation | ~8 | mIoU | Public (val/test only) |
| CITYLID | ALS (airborne) | Fine street-feature segmentation | 13 | qualitative only | HuggingFace open dataset |
| SIP (Site in Pieces) | TLS (single-station) | Construction-site segmentation | 23 | mIoU | Public split |
| Waymo-4DSeg / SAM4D | Camera + LiDAR (pseudo-labeled) | Class-agnostic masklets | class-agnostic | mask metrics | Derived (Waymo Open) |

## Per-Benchmark Evaluation Detail

### SemanticKITTI — the AV-domain reference

- **Sensor:** Velodyne HDL-64E, 64-beam rotating LiDAR, 360° FOV, ~0.09° angular resolution. Vehicle-mounted MLS survey drives around Karlsruhe, Germany.
- **Scale:** 23 sequences, 43,000+ scans, ~4,549 million annotated points.
- **Split:** Train sequences 00–07 + 09–10 (23,201 scans); validation sequence 08 (~4,071 scans); test sequences 11–21 (~20,351 scans, labels withheld). Sequence 08 is the de-facto development reference; report it during architecture search.
- **Single-scan task — 19 evaluated classes** (raw ontology has 28; "other-structure," "other-object," and "outlier" excluded due to high intra-class variance): `road, sidewalk, parking, other-ground, building, car, truck, bicycle, motorcycle, other-vehicle, vegetation, trunk, terrain, person, bicyclist, motorcyclist, fence, pole, traffic-sign`.
- **Multi-scan / moving-object task — 25 classes:** adds moving variants (`moving-car, moving-truck, moving-other-vehicle, moving-person, moving-bicyclist, moving-motorcyclist`) — stationary and in-motion instances are distinct classes. This is the variant closest to aggregated-map segmentation.
- **Scene completion task:** same 19-class space over voxelised occupancy grids.
- **Label file format:** Binary `.label` files, one per scan, N `uint32_t` values. Bit layout: lower 16 bits = semantic class ID; upper 16 bits = temporally-consistent instance ID. Load with `np.fromfile(path, dtype=np.uint32)`. Class remapping defined in `semantic-kitti-api/config/semantic-kitti.yaml`.
- **Metric:** mIoU, TP/FP/FN aggregated globally across all test frames before dividing.
- **Submission server:** CodaLab; requires institutional or corporate email (free-provider addresses rejected). No published hard annual cap, but arXiv preprint link required — prevents anonymous score fishing.
- **Licence:** CC BY-NC-SA. Must cite both SemanticKITTI (ICCV 2019) and the KITTI Vision Benchmark.
- **Known pitfalls:** HDL-64E is discontinued; modern dense-pillar encoders gain easy points partly from its simple beam pattern. Moving-object labels were generated by tracking — short-lived motion can be mislabelled. Class imbalance is severe: "person" ~0.2%, "motorcyclist" ~0.08% of all points. Sequence 08 shares road geography with nearby training sequences, so val mIoU can overfit the geography; val numbers typically run 2–4 points above test mIoU.

### nuScenes-lidarseg — the multi-sensor urban reference

- **Sensor:** 1× Velodyne HDL-32E (32-beam, 360°), keyframe-only at 2 Hz. Boston (USA) and Singapore; 1,000 scenes × 20 s each.
- **Scale:** ~1.4 billion annotated LiDAR points across ~40,000 keyframes.
- **Split:** Train 700 / Val 150 / Test 150 scenes; test labels withheld.
- **16 evaluated classes:** `barrier, bicycle, bus, car, construction_vehicle, motorcycle, pedestrian, traffic_cone, trailer, truck, driveable_surface, other_flat, sidewalk, terrain, manmade, vegetation`. Mapping from raw 32-class ontology defined in `lidarseg_idx2name_mapping.json` in the nuScenes devkit.
- **Label file format:** Per-sample binary `.bin` files, one `uint8` per point (class index 0–15; 0 = void/noise). Named `{lidar_sample_data_token}_lidarseg.bin`.
- **Metric:** mIoU over 16 classes.
- **Submission server:** EvalAI. **Hard cap: 3 submissions per team per year.** This is the tightest leaderboard restriction in the major AV benchmarks — plan submissions carefully.
- **Extension — Panoptic nuScenes:** Adds per-point instance IDs for 7 thing classes; introduces PAT metric and LSTQ (LiDAR Segmentation and Tracking Quality).
- **Licence:** CC BY-NC-SA; download requires registration.
- **Known pitfalls:** No explicit "road" class — "driveable_surface" covers road plus nearby dirt, which confuses transfer to SemanticKITTI. HDL-32E has lower vertical resolution than HDL-64E; SemanticKITTI-trained methods may underperform without density augmentation. Keyframe-only (2 Hz) cannot test per-scan online inference rates. Singapore scenes use left-hand traffic convention — affects flip augmentations.

### Waymo Open Dataset — 3D Semantic Segmentation

- **Sensor:** 5× LiDARs — 1× mid-range top (64-channel, truncated to 75 m) + 4× short-range (front/sides/rear, truncated to 25 m). Two returns per beam. Diverse US cities, mixed urban/suburban/highway.
- **Scale:** ~1,150 segments; approximate split ~24,000 training / 7,000 validation / 3,000 test frames. Per-point labels added March 2022.
- **23 classes:** `car, truck, bus, other_vehicle, motorcyclist, bicyclist, pedestrian, sign, traffic_light, pole, construction_cone, bicycle, motorcycle, building, vegetation, tree_trunk, curb, road, lane_marker, other_ground, walkable, sidewalk` (22 named + implicit "undefined/void").
- **Metric:** Per-class IoU + mIoU over 22 named classes.
- **Submission:** waymo.com/open platform; challenge closes ~May each year; year-round submission permitted post-challenge. 2024 SOTA: PTv3-Extreme 72.76% test mIoU (1st); MixSeg3D 69.83% (2nd); vFusedSeg3D (3rd, camera-LiDAR fusion).
- **Licence:** Waymo Open Dataset Licence (non-commercial, no redistribution).
- **Known pitfalls:** Multi-return (two returns per ray) is unusual — most frameworks use strongest or last return only. Short-range LiDARs have a different beam pattern from the top LiDAR; naive concatenation causes density artefacts. "Lane marker" is typically the lowest per-class IoU class.

### Semantic3D — the dense static-scan reference

- **Sensor:** Static terrestrial laser scanners (TLS), multiple units; Central Europe (churches, streets, railroad tracks, squares, villages, castles).
- **Scale:** >4 billion manually labelled points. Training and test sets approximately equal in size.
- **8 classes:** `man-made terrain, natural terrain, high vegetation, low vegetation, buildings, hard scape, scanning artefacts, cars`. Each point carries (x, y, z, intensity, R, G, B, label).
- **Label file format:** Plain-text `.labels` files, one integer per line, index-aligned with `.txt` point files.
- **Two test splits:** `semantic-8` (full) and `reduced-8` (subsampled, lower submission cost). Always state which split is used — numbers are not interchangeable.
- **Train/test split:** No official validation split; community convention is to hold out a random ~20% of training tiles.
- **Metric:** mIoU (Jaccard) + per-class OA, computed server-side.
- **Submission server:** http://semantic3d.net/ — upload prediction files. No annual submission cap.
- **Licence:** Custom academic-use licence (free for non-commercial research).
- **Known pitfalls:** Static TLS viewpoint — radial density gradient from scanner origin; range-image projection methods adapted for spinning LiDAR will degrade. "Scanning artefacts" class (ghosting, multi-path returns) is highly variable. No moving objects; geometry density ranges 100–1,000 pts/m² near scanner but sparse at range — aggressive subsampling is standard.

### Paris-Lille-3D (NPM3D) — the primary MLS pre-training source

- **Sensor:** Stereopolis II MLS system (Velodyne HDL-32E). On-vehicle survey drives through Paris and Lille, France.
- **Scale:** 1,940 m total distance, 143.1 million points, two cities.
- **Class counts:** Raw ontology = 50 fine-grained classes. Benchmark uses 10 coarse classes: `Ground, Building, Pole, Bollard, Trash can, Barrier, Pedestrian, Car, Natural, Other`.
- **Label file format:** `.txt` with (x, y, z, intensity, label_id). No RGB. Coarse-class integer IDs in the benchmark split.
- **Metric:** Average IoU (Av.IoU) over 10 coarse classes. Submissions via NPM3D benchmark page at npm3d.fr.
- **Licence:** CC BY-NC-ND 3.0 — non-commercial, no derivatives.
- **Known pitfalls:** 50-class fine taxonomy is too granular for most DL pipelines; the 10-class coarse reduction loses structure that could be useful for airside transfer. Only ~143 M points — smaller than SemanticKITTI for deep network training. Urban Western-European road geometry only.

### Toronto-3D — the road-marking reference

- **Sensor:** Teledyne Optech Maverick mobile laser scanner (vehicle-mounted, 32-channel equivalent) + RGB camera. ~1,000 pts/m² on road surfaces.
- **Scale:** ~78.3 million points, 4 segments (L001–L004) over ~1 km of Spadina Avenue, Toronto.
- **Split:** Standard — 3 segments train, 1 segment test; the community commonly uses L002 as test.
- **8 classes:** `Road, Road marking, Natural, Building, Utility line, Pole, Car, Fence`.
- **Label file format:** LAS/LAZ with (x, y, z, R, G, B, intensity, GPS time, scan angle rank, label) as integer attribute.
- **Metric:** mIoU + Overall Accuracy.
- **Licence:** Open; research use.
- **Known pitfalls:** Only 1 km of a single road in one city — minimal geographic diversity. "Utility line" and "Road marking" are very sparse (<1% of points each); mIoU masks poor rare-class performance. Single MLS run; no multi-season or weather variation.

### KITTI-360 — the accumulated MLS map reference

- **Sensor:** 2× Velodyne HDL-64E (one spinning, one pushbroom/FARO-style) + fisheye + perspective cameras. Vehicle-mounted, ~73.7 km of suburban drives in Karlsruhe.
- **Scale:** >150,000 images; ~1 billion annotated 3D points in the accumulated, registered multi-scan map.
- **Classes:** 37 raw semantic/instance labels; 3D segmentation benchmark evaluates over ~19 Cityscapes-aligned classes. Full 37-class annotation in `.xml` bounding-box and dense point-cloud layers.
- **Aggregated-map nature:** KITTI-360 is an explicitly accumulated, registered point cloud (all scans fused into a single metric map with per-point timestamps) — more directly relevant for MLS survey-map segmentation than per-scan benchmarks.
- **Label file format:** LAS-style binary with semantic + instance labels; loaded via the KITTI-360 devkit.
- **Metric:** mIoU; leaderboard at cvlibs.net/datasets/kitti-360/.
- **Licence:** CC BY-NC-SA.
- **Known pitfalls:** Pushbroom LiDAR produces a different scan pattern than rotating scanners. Large area means ground/building dominates class distribution. Annotations were semi-automated (2D-to-3D lifted from camera labels) with known artefacts at annotation boundaries.

### DALES — the airborne LiDAR density bracket

- **Sensor:** Airborne LiDAR system (ALS), fixed-wing platform, ~500 m altitude. Dayton, Ohio, ~10 km² of mixed urban/suburban/commercial.
- **Scale:** >500 million hand-labelled points, 40 scenes (~0.25 km² each).
- **8 classes:** `Ground, Vegetation, Cars, Trucks, Power lines, Fences, Poles, Buildings`.
- **Split:** Typically 30 scenes train / 10 scenes test. No official validation split — community convention varies.
- **Label file format:** LAS files with class attribute; intensity and return-number available.
- **Metric:** Mean IoU, per-class IoU, Class Consistency Index (CCI), Overall Accuracy. Extension: DALES Objects (2021) adds instance-level annotations.
- **Licence:** Open for research.
- **Known pitfalls:** Aerial nadir viewpoint — density drops severely for vertical objects (poles, fences). "Power lines" are extremely sparse (one return per line segment); all existing methods achieve very low IoU on this class. US Midwest geography only.

### SensatUrban — the scale / tiling benchmark

- **Sensor:** Photogrammetric dense point clouds (SfM + MVS from UAV oblique imagery — NOT direct LiDAR pulses). Two UK cities — Birmingham and Cambridge — ~6 km² total.
- **Scale:** ~2.8 billion annotated points.
- **13 classes:** `Ground, Vegetation, Building, Wall, Bridge, Parking, Rail, Traffic Road, Street Furniture, Car, Footpath, Bike, Water`.
- **Split:** Train/test by tile as provided in the repository; no formal validation split.
- **Label file format:** PLY files with per-point integer class label.
- **Metric:** mIoU; CodaLab submission (competitions.codalab.org/competitions/31519). Urban3D Challenge hosted at ECCV 2022.
- **Licence:** Academic use; requires registration.
- **Known pitfalls:** Photogrammetric point clouds — different noise and density distribution from spinning LiDAR; intensity not available. "Rail," "Bridge," and "Bike" classes are rare; mIoU can mask near-zero performance on them.

### STPLS3D — synthetic-to-real aerial

- **Sensor (real):** DJI Phantom 4 Pro, 75–85% image overlap, 25–70 m altitude, SfM+MVS reconstruction. 4 real sites.
- **Sensor (synthetic):** Unreal Engine 4 / AirSim rendering, Bentley ContextCapture reconstruction — 3 synthetic versions (SyntheticV1–V3) totalling ~16 km².
- **Scale:** 1.27 km² real + 16 km² synthetic.
- **18 classes (SyntheticV3):** `Building, Low vegetation, Medium vegetation, High vegetation, Passenger car, Truck, Aircraft, Military vehicle, Bike, Motorcycle, Light pole, Street sign, Clutter, Fence, Road, Grass, Window, Dirt`. Real data uses a subset.
- **Split:** Real test = WMSC site; generalisation tested on Fort Drum cantonment.
- **Label file format:** Point-wise semantic + instance annotation, compatible with ScanNet/S3DIS loading conventions.
- **Metric:** Semantic mIoU + OA; instance mAP, mAP50, mAP25.
- **Licence:** Academic research use.
- **Known pitfalls:** Synthetic-to-real gap persists despite pipeline-level simulation; domain adaptation needed. "Aircraft" class appears only in synthetic data (USC airport proximity) — not well-represented in real tiles. Real tiles are small (1.27 km²) relative to synthetic.

### S3DIS — the indoor structural reference

Architecture papers routinely report on S3DIS for benchmarking backbone generality. Cross-reference with the method pages before assuming numbers are comparable to outdoor benchmarks.

- **Sensor:** Matterport RGB-D cameras + structured-light scanners. 6 large indoor areas across 3 Stanford buildings; 271 rooms total.
- **Scale:** 695 million reconstructed points, per-point (x, y, z, R, G, B) + label.
- **13 classes:** `ceiling, floor, wall, beam, column, window, door, table, chair, sofa, bookcase, board, clutter`.
- **Evaluation protocol:** Two conventions appear in the literature — always specify which:
  - *Standard:* Area 5 held out for test, Areas 1,2,3,4,6 for train. Report mIoU.
  - *Alternate:* 6-fold cross-validation (each area held out once), report mean mIoU and mean OA.
- **Label file format:** Per-point `.txt` annotation files.
- **Metric:** mIoU (primary), OA. No hidden test server — evaluation is reproducible locally.
- **Licence:** Non-commercial academic.
- **Known pitfalls:** RGB-D fused reconstruction differs from LiDAR pulse data — colour features matter here but are absent in most outdoor benchmarks. Area 5 is disproportionately large, making train/test size asymmetric. Near-perfect Area 5 performance does not generalise to real-world interior MLS scans.

### ScanNet v2 / ScanNet200 — the long-tail indoor reference

Architecture papers consistently report on ScanNet v2 and ScanNet200 for head/tail class performance. Required for cross-reference with the method pages.

- **Sensor:** BundleFusion structured-light depth sensor + RGB camera, handheld scanning. 1,513 scans of 707 distinct indoor spaces.
- **Scale (v2):** 1,613 training / 312 validation / 100 test scans; evaluated on 20 object classes.
- **ScanNet v2 — 20 benchmark classes** (selected from 40 annotated categories): common indoor objects.
- **ScanNet200:** Extends to 200 classes grouped as Head (66) / Common (68) / Tail (66). mIoU is evaluated per group to expose tail-class collapse — report all three group scores alongside the aggregate.
- **Label file format:** Volumetric mesh + per-vertex labels; also provided as fused voxel grids at 2 cm resolution.
- **Metric:** mIoU (semantic); mAP at IoU 25%, 50%, 50–95% (instance). Hidden test-server submission at ScanNet portal.
- **Licence:** Non-commercial academic.
- **Known pitfalls:** Handheld scan — non-uniform density, noisy depth — very different from vehicle-mounted or UAV LiDAR. ScanNet200 Tail classes may have only 1–3 training scans; few-shot generalisation is the real challenge. v1/v2 distinction matters: v2 has cleaner annotations; some papers still cite v1 numbers without flagging this.

### FRACTAL — the large ALS corpus

- **Sensor:** Leica, Riegl, and Teledyne/Optech ALS platforms (French Lidar HD national programme, ~10 pulses/m², ~37 pts/m²). Colourised from ORTHO HR 0.20 m NRGB imagery.
- **Scale:** 250 km² total, 9,261 million points, 100,000 tiles of 50×50 m from 5 spatial domains in southern France.
- **7 classes:** `Ground, Vegetation, Building, Water, Bridge, Permanent structure, Other`.
- **Split:** 80/10/10 (train 225 km² / val 25 km² / test 25 km²). Test from geographically separate areas.
- **Label file format:** LAZ 1.4 with (x, y, z, intensity, return info, scan angle, colour channels NRGB).
- **Metric:** mIoU (primary), OA (secondary). Baseline (RandLa-Net): mIoU 77.5%, OA 86.7%.
- **Access:** HuggingFace `IGNF/FRACTAL`. Licence: permissive open (French government open-data compatible).
- **Known pitfalls:** Southern France only — forest and scrubland dominate the vegetation class. Imagery and LiDAR are not co-temporal (up to 3-year lag) — RGB/NIR features may be misaligned. "Other" class is semantically ill-defined. Very coarse taxonomy — no vehicles, poles, or infrastructure detail.

### GOOSE / GOOSE-Ex — the off-road / unstructured-environment pair

- **Sensor (GOOSE, MuCAR-3 vehicle):** 1× Ouster OS1-128 (128-channel spinning LiDAR), 2× Ouster OS1-32, front-facing RGB+NIR camera. Mixed outdoor environments — forest, gravel roads, fields, campus, paved areas. Germany-based.
- **Sensor (GOOSE-Ex):** Liebherr R924 excavator + Boston Dynamics Spot quadruped. Excavator: 3× Ouster OS1-64 + 1× Ouster OS1-128 at boom + prism cameras. 4 environmental settings: construction, quarry, landfill, open terrain.
- **Scale:** GOOSE 10,000 annotated frame pairs; GOOSE-Ex 5,000 annotated multimodal frames (2,800 excavator + 2,200 Spot), 100+ sequences. Combined ~13,076+ labeled clouds.
- **Ontology:** 64 classes hierarchically organised (8 superclasses); ~90% of annotated area is vegetation/terrain/sky. Classes with <20 occurrences excluded from evaluation. GOOSE-Ex subset uses 36 classes present in the distribution.
- **Label format:** SemanticKITTI-compatible point-wise label files. Per-point labels produced from multiple frames merged by platform odometry — i.e., aggregated clouds, same accumulation regime as an aggregated map.
- **Split (GOOSE-Ex):** Train 3,989 / Val 407 / Test 604 (test labels withheld).
- **Metric:** mIoU. GOOSE 3D Semantic Segmentation Challenge hosted at ICRA 2025 (arXiv:2506.06995).
- **Licence:** Open at goose-dataset.de.
- **Known pitfalls (GOOSE-Ex):** Excavator top-mounted LiDAR observes mostly ground-plane geometry; vertical objects appear at extreme angles — architectures trained on standard vehicle-height sensor configurations will encounter inverted density profiles.

### SemanticRail3D — the MLS corridor reference

- **Sensor:** Optech LYNX Mobile Mapper (two LiDARs on MLS), ~980 pts/m², 5 mm precision.
- **Scale:** 87.6 km total, 438 × 200 m segments, ~2.8 billion annotated points.
- **Classes:** 11 or 12 semantic classes plus instance labels. The v1/v2 distinction introduces a possible class count discrepancy — verify in the Scientific Data publication before citing exact numbers.
- **Split:** 5 training shards + validation + held-out test (labels reviewed by railway domain experts).
- **Label file format:** LAZ with (x, y, z, intensity, class, instance_id).
- **Metric:** mIoU (implied; not explicitly stated in public documentation — verify in full paper).
- **Licence:** Not confirmed in open documentation — check before use.

### WHU-Railway3D — the multi-environment railway reference

- **Sensor:** 3 Mobile Mapping Systems: Optech Lynx (urban), HiScan-Z dual-sensor MLS (rural), 32-line rMMS (plateau, China).
- **Scale:** 4.6 billion annotated points, 120 tiles across 3 environments (urban/rural/plateau).
- **11 classes:** `Rails, Track bed, Masts, Support devices, Overhead lines, Fences, Poles, Vegetation, Buildings, Ground, Others`.
- **Split:** 60/20/20 per environment (tile-based).
- **Label file format:** `.npy` files, `uint8`, values 0–10.
- **Metric:** mIoU, per-class IoU, Overall Accuracy.
- **Licence:** Not specified (IEEE TITS paper) — verify before use.

### Recent additions: Turin3D, CITYLID, SIP, Waymo-4DSeg

- **Turin3D** — ALS, ~1.43 km², ~70 M points, central Turin. Training set is unlabeled by design; only validation and test sets are annotated. Purpose-built for semi-supervised and domain-adaptation evaluation, not a fully-supervised leaderboard. Classes not enumerated in public abstract — verify in arXiv:2504.05882.
- **CITYLID** — Citywide ALS of Berlin (1,060 tiles, ~15 billion points). 13 classes: 3 standard (`ground, buildings, trees`); 5 fine street features (`medians, driveways, bikepaths, walkways, on-street parking`); 5 shadow bins (0–3, 3–5, 5–7, 7–10, 10–12 h). Licence: DL-DE (allows commercial + research use, redistribution). No quantitative DL benchmark — visual/qualitative validation only; the researcher must define their own splits and metrics. Access: HuggingFace `Deepank/CITYLID`.
- **SIP (Site in Pieces)** — TLS single-station, 40 scenes (27 indoor, 13 outdoor construction sites), ~140–200 M total points, 23 classes covering structural elements, temporary objects, and site context. Single-station viewpoint preserves radial density decay and self-occlusion — the explicit counterpoint to aggregated maps. Licence: publicly available (terms in arXiv:2512.09062).
- **Waymo-4DSeg / SAM4D** — Pseudo-labeled, cross-modal (camera + LiDAR) masklet dataset (~30 M LiDAR masks). Labels are class-agnostic (instance/masklet identity, not a fixed taxonomy). Pre-training and promptable-segmentation resource, not a closed-taxonomy leaderboard. Released as part of SAM4D (arXiv:2506.21547).

## Cross-Dataset Taxonomy Mismatch

Naively combining datasets from different sources introduces label conflicts that can degrade performance — measured as negative transfer. The PTv3 Point Prompt Training paper documents −3.3% to −2.1% mIoU degradation from naive multi-dataset joint training vs. single-dataset baselines.

### Core incompatibilities

| Issue | Example |
|---|---|
| Coarser vs. finer granularity | nuScenes "manmade" vs. SemanticKITTI's separate building, fence, pole, traffic-sign classes |
| Different ground definitions | nuScenes has no "road" class; "driveable_surface" is broader than SemanticKITTI "road" |
| Moving-object labelling | SemanticKITTI has explicit moving-variant classes; nuScenes and Waymo use instance IDs instead |
| Vegetation hierarchy | Waymo separates "vegetation" and "tree_trunk"; SemanticKITTI merges them |
| Evaluation class count | SemanticKITTI evaluates 19/25; nuScenes 16; Waymo 22 — no universal set |

Safe cross-dataset class overlap across SemanticKITTI, nuScenes, and Waymo is approximately 10 classes: `car, bicycle, motorcycle, truck, other_vehicle, pedestrian, driveable_surface/road, sidewalk, terrain, vegetation`. Only SemanticKITTI, SemanticUSL, and SemanticSTF share label definitions directly.

### Label-mapping approaches

**Coarse common-class mapping (standard practice):** Reduce all datasets to the lowest-common-denominator 7–10 class subset for unified training. Simplest to implement; loses fine-grained structure.

**Union label space (M3Net / UniSeg approach):** Train with a union of all class labels, keeping dataset-specific heads but sharing a backbone. Requires negative-sample masking — only the source dataset's class space is valid for each sample. M3Net (CVPR 2024) reports 72.0% mIoU on SemanticKITTI and 80.9% on nuScenes using this strategy. Source: arXiv:2405.01538.

**Language-guided alignment (Point Prompt Training / PPT):** Use CLIP text embeddings of class names to find semantic correlations across datasets, enabling soft label transfer between semantically similar classes. Demonstrated for indoor datasets (ScanNet + S3DIS + Structured3D) at CVPR 2024. The same principle can be applied to outdoor driving datasets.

**OmniLiDAR harmonisation:** Aggregates 12 public driving datasets (~22 million raw scans, 15 distinct sensor models) with standardised label spaces and raw-scan normalisation. Enables cross-domain ground segmentation (TerraSeg). Source: arXiv:2603.27344.

**Negative-transfer risk:** Any multi-dataset training that omits explicit alignment (label-mapping layer, negative-sample masking, or language-guided alignment) risks measurable mIoU degradation on every target domain. Always ablate single-dataset vs. multi-dataset baselines before deploying a multi-source training pipeline.

## Synthetic Datasets and Sim-to-Real

Synthetic data addresses two problems: (1) pre-training on large corpora without annotation cost, and (2) rare-class rebalancing — real datasets have insufficient examples of uncommon objects (motorcyclists, cyclists, pedestrians) to train reliable detectors.

### SynLiDAR — large-scale pre-training corpus

- **Generator:** Custom purpose-built LiDAR simulator (not CARLA), virtual urban/suburban worlds.
- **Scale:** 13 sequences, ~19 billion points, ~20,000 scans. 32 classes (superset of SemanticKITTI + additional categories). Class definitions in `annotations.yaml`.
- **Label format:** `.label` files, SemanticKITTI-compatible (`uint32`).
- **Licence:** MIT.
- **Sim-to-real results:** Adding SynLiDAR to SemanticKITTI training improves mIoU; Point Cloud Translator (PCT) reduces the domain gap further. Effective as a pre-training corpus before fine-tuning on real data. Source: arXiv:2107.05399 (AAAI 2022).

### RareBoost3D — CARLA-based rare-class rebalancing

- **Generator:** CARLA v0.9.15 (Unreal Engine). Simulated Velodyne HDL-64E: 64 channels, ~125k–138k pts/scan.
- **Scale:** 8 sequences × 60,000 scans = 480,000 scans total. Environments: rural (Map 7), small towns (Maps 1,2,4), large cities (Maps 3,5,6,10).
- **Classes:** 29 raw labels mapped to 16 unified evaluation classes aligned to SemanticKITTI.
- **Sim-to-real technique:** Cross-domain Semantic Consistency (CSC) loss — contrastive alignment of feature representations across domains.
- **Gains:** +2.5% mIoU on SemanticKITTI val (MinkUNet baseline); rare classes see +3–10% per-class IoU improvement.
- Source: arXiv:2510.10876.

### SynthmanticLiDAR — SemanticKITTI-aligned CARLA dataset

- **Generator:** Modified CARLA simulator with additional classes and consistent labelling with SemanticKITTI.
- **Nature:** Designed specifically for sim-to-real transfer to SemanticKITTI; sequential point cloud dataset.
- **Access:** Dataset + simulator code on GitHub. Source: arXiv:2501.19035.

### KITTI-CARLA — domain adaptation benchmark

- **Generator:** CARLA v0.9.10, KITTI-like output format.
- **Purpose:** Transfer-learning benchmark from synthetic to real (SemanticKITTI). Purpose-built for evaluating domain adaptation methods. Source: ResearchGate 2021.

### STPLS3D synthetic split — aerial sim-to-real

The STPLS3D synthetic split (SyntheticV1–V3, ~16 km², up to 18 classes) is the primary aerial photogrammetry sim-to-real resource. See the STPLS3D section above for sensor and format details. The "Aircraft" class in the synthetic split is particularly relevant for airside pre-training, though it is not represented in the real tiles.

### Sim-to-real considerations for airside use

No purpose-built airside synthetic LiDAR dataset exists. The closest available resources are STPLS3D synthetic (aerial, includes "Aircraft" class), RareBoost3D (ground-vehicle, rare-class rebalancing methodology transferable to airside GSE), and SynLiDAR (large-scale urban pre-training). Any sim-to-real airside pipeline will require: (1) domain-specific world building (apron geometry, aircraft stands, GSE classes), (2) an explicit sim-to-real alignment step (CSC loss, style transfer, or domain randomisation), and (3) validation on real airside scans before deployment.

## Metrics and Reporting Conventions

### Primary metric: mIoU

Mean Intersection-over-Union is the standard primary metric across all benchmarks. Always report **per-class IoU** alongside the aggregate mIoU — a benchmark with one dominant class (ground, building) hides rare-class collapse behind a healthy headline number. On SemanticKITTI, "person" and "motorcyclist" IoU are the most informative single-class indicators of rare-object performance.

For ScanNet200, report mIoU separately for the Head, Common, and Tail groups — aggregate mIoU alone is meaningless for tail-class analysis.

### Secondary metrics

- **Overall accuracy (OA):** reported for comparability on Semantic3D, DALES, Toronto-3D; dominated by ground/building and should not be used as a primary ranking metric.
- **Instance segmentation metrics:** mAP at IoU thresholds 25%, 50%, 50–95% used by ScanNet, STPLS3D (instance task), and DALES Objects.
- **Panoptic metrics:** PAT, LSTQ (nuScenes Panoptic); PQ/SQ/RQ (ScanNet panoptic). Report all three components when available.

### Submission-limit and leaderboard-hygiene rules

| Benchmark | Annual submission cap | Notes |
|---|---|---|
| nuScenes-lidarseg (EvalAI) | **3 per team per year** | Tightest cap; plan submissions carefully |
| SemanticKITTI (CodaLab) | No published hard cap | Institutional email required; arXiv link required — prevents anonymous score fishing |
| Waymo 3D Seg (waymo.com) | Challenge closes ~May each year | Year-round submission permitted post-challenge |
| SensatUrban (CodaLab) | No confirmed cap | Standard CodaLab convention |
| Semantic3D | No annual cap | Online prediction upload |

**Validation-vs-test discipline:** On SemanticKITTI, val mIoU typically runs 2–4 points above test mIoU because sequence 08 is geographically close to training sequences and is often used for hyperparameter selection. Always develop against a fixed validation split, submit to the server sparingly, and never select hyperparameters on the test set.

**Multi-dataset pre-training disclosure:** Increasingly, top-performing entries (e.g., PTv3-Extreme in the 2024 Waymo Challenge) use pre-training on multiple datasets before fine-tuning on the target benchmark. The label-mapping layer used for pre-training is often not disclosed. When citing leaderboard results, note whether the method uses: (a) single-dataset training only, (b) multi-dataset joint training, or (c) a large-scale 2D/3D pre-trained backbone (DINOv2, PointMAE, etc.).

**Overfitting risk:** CodaLab and EvalAI leaderboards that display individual score updates enable iterative tuning against the held-out test set. Scores are sometimes rounded (e.g., to 2 decimal places) to reduce exploitation. The SemanticKITTI leaderboard's arXiv-link requirement and nuScenes' 3-submission annual cap exist precisely to prevent this.

A SOTA claim is only meaningful with the **task variant, split, evaluation source, and pre-training regime** all stated. See `../overview/aggregated-map-semantic-segmentation.md` §13.3 for the full benchmarking-rigor protocol.

## Data Formats and Label Conventions

| Benchmark | Format | Point fields | Label encoding |
|---|---|---|---|
| SemanticKITTI | `.bin` + `.label` | float32 (x,y,z,intensity) | `uint32`: lower 16 bits = semantic, upper 16 bits = instance |
| nuScenes-lidarseg | `.bin` | float32 | `uint8` class index (0 = void) |
| Waymo 3D Seg | tfrecord via devkit | (x,y,z,intensity, return) | per-point class index |
| Semantic3D | `.txt` + `.labels` | (x,y,z,intensity,R,G,B) | one integer per line in `.labels` |
| Paris-Lille-3D | `.txt` | (x,y,z,intensity,label_id) | integer class index; no RGB |
| Toronto-3D | LAS/LAZ | (x,y,z,R,G,B,intensity,GPS time,scan angle,label) | integer attribute |
| KITTI-360 | LAS-style binary | (x,y,z,intensity,timestamp) | semantic + instance via devkit |
| DALES / FRACTAL | LAS / LAZ 1.4 | (x,y,z,intensity,return info,colour) | class attribute |
| SensatUrban | PLY | per-point | integer class label |
| GOOSE / GOOSE-Ex | SemanticKITTI-compatible | point-wise | SemanticKITTI label files |
| SemanticRail3D | LAZ | (x,y,z,intensity,class,instance_id) | explicit class + instance fields |
| WHU-Railway3D | `.npy` | per-point | `uint8` values 0–10 |
| S3DIS | `.txt` | (x,y,z,R,G,B,label) | per-point integer |
| ScanNet v2/200 | mesh + voxel grid | per-vertex | 2 cm voxel grid labels |

**Key compatibility point:** SemanticKITTI-compatible format (SynLiDAR, GOOSE, RareBoost3D) enables direct reuse of SemanticKITTI data loaders. LAS/LAZ files (FRACTAL, DALES, SemanticRail3D, Toronto-3D, KITTI-360) require the `laspy` or `pdal` library. Mesh-based formats (ScanNet) require a separate voxelisation or subsampling step before point-wise inference.

Taxonomies do not align across datasets. Cross-dataset training requires an explicit label-mapping layer. See the Cross-Dataset Taxonomy Mismatch section above and `../overview/aggregated-map-semantic-segmentation.md` §5.2 for the selection-guide framing.

## Licensing

| Benchmark | Licence | Production use |
|---|---|---|
| SemanticKITTI | CC BY-NC-SA | Non-commercial only |
| nuScenes-lidarseg | CC BY-NC-SA | Non-commercial only |
| Waymo Open Dataset | Waymo custom | Non-commercial; no redistribution |
| Semantic3D | Custom academic | Non-commercial research |
| Paris-Lille-3D | CC BY-NC-ND 3.0 | Non-commercial, no derivatives |
| Toronto-3D | Open (research) | Research use |
| KITTI-360 | CC BY-NC-SA | Non-commercial only |
| DALES | Open (research) | Research use |
| SensatUrban | Academic (registration) | Research use; check before commercial |
| FRACTAL | French open-data (permissive) | Commercial + research |
| CITYLID | DL-DE | Commercial + research + redistribution |
| GOOSE / GOOSE-Ex | Open (goose-dataset.de) | Research use |
| SynLiDAR | MIT | Commercial permissible |
| S3DIS | Non-commercial academic | Research only |
| ScanNet v2/200 | Non-commercial academic | Research only |
| WHU-Railway3D | Not specified | Verify before use |
| SemanticRail3D | Not confirmed | Verify before use |

Almost every benchmark is released for **research / non-commercial use**. They are appropriate for pre-training, architecture selection, and benchmarking, but a model whose weights are shipped in a product should have its supervised fine-tuning grounded in owned in-domain data. Verify each licence before production use — see `../overview/aggregated-map-semantic-segmentation.md` §5.2.

## Airside Transfer

No airside aggregated-map benchmark exists — the 2023–2026 additions above confirm rather than close that gap: none is airport-specific. For an airside pipeline the transfer-relevant analysis starts from acquisition paradigm.

**MLS ground-level, accumulated-map group** (Paris-Lille-3D, Toronto-3D, KITTI-360, SemanticRail3D, WHU-Railway3D): These datasets share a survey-drive viewpoint — a vehicle-mounted multi-beam LiDAR driving a linear corridor, building a registered multi-scan map — that most closely matches a taxiway or apron survey drive. SemanticRail3D and WHU-Railway3D add a constrained linear ODD with structured trackside infrastructure (catenary poles, masts, overhead lines, track-bed marking) that is a closer analog to airside taxiway corridor furniture than open urban road geometry. SemanticKITTI multi-scan task adds explicit static/moving reasoning useful for mixed-traffic apron scenarios.

**Per-domain transfer assessment:**

| Dataset | Paradigm match | Transfer value for airside |
|---|---|---|
| KITTI-360 | MLS accumulated, registered | High — best viewpoint + density match for taxiway survey drive |
| Paris-Lille-3D / Toronto-3D | MLS accumulated | High — survey-drive viewpoint; no airside-specific classes |
| SemanticRail3D / WHU-Railway3D | MLS accumulated, constrained corridor | High — corridor geometry, trackside infrastructure analog |
| GOOSE-Ex | Aggregated clouds, large-vehicle platform | Moderate-high — relevant for GSE/construction-zone ODD |
| SemanticKITTI (multi-scan) | MLS per-scan sequences + motion | Moderate — per-scan, but 4D labelling available |
| FRACTAL | ALS nadir, large-area | Moderate for site surveys; wrong viewpoint for ground-vehicle |
| DALES | ALS nadir | Low for ground-vehicle; nadir density profile |
| SensatUrban / STPLS3D | UAV photogrammetric | Low — no LiDAR pulse noise, aerial viewpoint |
| nuScenes / Waymo | Per-frame, no map accumulation | Low — per-scan paradigm only |

Three additions are worth singling out for airside work specifically:

- **GOOSE-Ex** is the most directly relevant new resource — built on odometry-merged aggregated clouds (same accumulation regime as an airside apron map) and covers unstructured large-vehicle scenes (excavator, quadruped) sharing more with apron/movement-area operations than any urban-road benchmark. It is the primary public pre-training source for the mining and construction ODDs and a reasonable off-road transfer source for airside.
- **SemanticRail3D** adds a large MLS corridor reference; railway-domain classes (catenary poles, rails, trackbed, masts, overhead lines) directly parallel airside ground-lighting arrays, taxiway edge structures, and jet-bridge infrastructure.
- **FRACTAL** is the strongest ALS pre-training source — a 250 km², statistically balanced, geometry-only corpus useful for nadir-scanned site-survey models, though its airborne viewpoint still differs from a ground survey-drive.

The full selection rationale and the proposed airside benchmark specification are in `../overview/aggregated-map-semantic-segmentation.md` §5.3–§5.4.

## Sources

- SemanticKITTI: Behley et al., ICCV 2019 — http://semantic-kitti.org · https://github.com/PRBonn/semantic-kitti-api · arXiv:1904.01416
- nuScenes-lidarseg: Caesar et al., arXiv:2109.03805 — https://github.com/nutonomy/nuscenes-devkit
- Waymo 3D Seg: waymo.com/open · 2024 challenge 1st place arXiv:2407.15282 · 2nd place arXiv:2501.05472
- Waymo Panoramic Panoptic (4DSeg): arXiv:2206.07704
- SAM4D: arXiv:2506.21547
- Semantic3D: Hackel et al., ISPRS 2017 — http://semantic3d.net · arXiv:1704.03847
- Paris-Lille-3D: Roynard et al., IJRR 2018 — https://npm3d.fr/paris-lille-3d
- Toronto-3D: Tan et al., CVPRW 2020 — arXiv:2003.08284
- KITTI-360: Liao et al., PAMI 2022 — https://www.cvlibs.net/datasets/kitti-360 · arXiv:2109.13410
- DALES: Varney et al., CVPRW 2020 — arXiv:2004.11985
- SensatUrban: Hu et al., CVPR 2021 — arXiv:2201.04494 · https://github.com/QingyongHu/SensatUrban
- H3D (Hessigheim): arXiv:2102.05346 · ISPRS Open Journal 2021
- STPLS3D: Chen et al., BMVC 2022 — arXiv:2203.09065
- S3DIS: Armeni et al., CVPR 2016 — http://buildingparser.stanford.edu/dataset.html · arXiv:1702.01105
- ScanNet v2: Dai et al., CVPR 2017 — http://www.scan-net.org · arXiv:1702.04405
- ScanNet200: Rozenberszki et al., ECCV 2022 — arXiv:2204.07761 · https://rozdavid.github.io/scannet200
- FRACTAL: Gaydon et al., 2024 — arXiv:2405.04634 · HuggingFace `IGNF/FRACTAL`
- GOOSE: Mortimer et al., 2023 — arXiv:2310.16788 · https://goose-dataset.de
- GOOSE-Ex: Hagmanns et al., 2024 — arXiv:2409.18788
- SemanticRail3D: Nature Scientific Data, Dec 2025 — https://www.nature.com/articles/s41597-025-06392-9 · https://github.com/Arshia-Gha/SemanticRail3D_Dataset
- WHU-Railway3D: IEEE TITS 2024 — https://dl.acm.org/doi/10.1109/TITS.2024.3469546 · https://github.com/WHU-USI3DV/WHU-Railway3D
- Turin3D: CVPR Workshops 2025 — arXiv:2504.05882
- CITYLID: Environment and Planning B (SAGE), 2025 — https://journals.sagepub.com/doi/full/10.1177/23998083241312273 · HuggingFace `Deepank/CITYLID`
- SIP: arXiv:2512.09062
- ECLAIR: arXiv:2404.10699
- RELLIS-3D: ICRA 2021 — https://dl.acm.org/doi/10.1109/ICRA48506.2021.9561251
- SynLiDAR: arXiv:2107.05399 (AAAI 2022) · https://github.com/xiaoaoran/SynLiDAR
- RareBoost3D: arXiv:2510.10876
- SynthmanticLiDAR: arXiv:2501.19035
- KITTI-CARLA: ResearchGate 2021
- M3Net (union taxonomy): arXiv:2405.01538
- PPT (language-guided multi-dataset training): CVPR 2024 — https://openaccess.thecvf.com/content/CVPR2024/papers/Wu_Towards_Large-scale_3D_Representation_Learning_with_Multi-dataset_Point_Prompt_Training_CVPR_2024_paper.pdf
- OmniLiDAR / TerraSeg: arXiv:2603.27344
- Panoptic nuScenes: arXiv:2109.03805
- Local context: `../overview/aggregated-map-semantic-segmentation.md` §5 (dataset selection guide), §13.3 (benchmarking rigor)
