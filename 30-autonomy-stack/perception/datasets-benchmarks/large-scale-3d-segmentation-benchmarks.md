# Large-Scale 3D Point Cloud Semantic Segmentation Benchmarks

**Last updated:** 2026-05-24

## Why It Matters

An aggregated-LiDAR-map semantic segmentation pipeline is built, pre-trained, and validated against the public 3D point cloud segmentation benchmarks — no airside-domain benchmark exists (see `../overview/aggregated-map-semantic-segmentation.md` §5.4). This page is the **evaluation-mechanics reference** for that benchmark landscape: splits, metrics, submission servers, label formats, licensing, and known issues. The companion §5 of the aggregated-map page is the *selection guide* (which dataset for what); this page is the *usage reference* (how to actually train and evaluate on them).

The practical point: these datasets shape what every 3D segmentation method reports. A "SOTA on SemanticKITTI" claim means little without knowing the split, the task variant, whether the number came from the hidden test server or a local validation set, and whether the method used multi-dataset pre-training.

## Benchmark Landscape

| Benchmark | Modality | Task variants | Eval classes | Metric | Leaderboard |
|---|---|---|---|---|---|
| SemanticKITTI | MLS (HDL-64E) | Single-scan; multi-scan (accumulated) | 19 / 25 | mIoU | Hidden test server (CodaLab) |
| SemanticTHAB | MLS (Ouster OS2-128) | Per-cloud semantic segmentation | 20 | mIoU / OA | Public Zenodo + repo; no hidden server |
| nuScenes-lidarseg | MLS (HDL-32E) | Single-frame lidarseg; panoptic | 16 | mIoU | Hidden test server (EvalAI, 3/yr cap) |
| Waymo 3D Seg | Multi-LiDAR vehicle | Per-frame semantic | 22 | mIoU | waymo.com/open |
| Semantic3D | TLS (static) | semantic-8; reduced-8 | 8 | mIoU / OA | Online server (no annual cap) |
| Paris-Lille-3D (NPM3D) | MLS | Coarse segmentation | 10 | Av.IoU | Online test server |
| Toronto-3D | MLS | Segmentation | 8 | mIoU / OA | Public split (L002 test) |
| KITTI-360 | MLS (accumulated) | 3D segmentation; 2D-3D | ~19 | mIoU | Online server (cvlibs.net) |
| DALES | ALS (airborne) | Segmentation | 8 | mIoU / OA | Public split |
| GridNet-HD | UAV LiDAR + oblique RGB imagery | 3D semantic; image segmentation; LiDAR-image fusion | 11 evaluated groups | mIoU | Hugging Face hidden-label leaderboard |
| SensatUrban | UAV photogrammetry | Segmentation | 13 | mIoU / OA | Hidden test server (CodaLab) |
| STPLS3D | Aerial photogrammetry + synthetic | Segmentation; instance | up to 18 | mIoU / AP | Public + challenge |
| CUS3D | UAV photogrammetry point cloud + mesh + imagery | 3D/mesh/2D semantic segmentation | 10 | mIoU / OA / mAcc | Paper benchmark |
| SUM / SUM Parts | Textured urban mesh | Mesh semantic; part-level segmentation | 6 / 21 | mIoU | CVPR 2025 project/code/data |
| S3DIS | RGB-D (indoor) | Semantic segmentation | 13 | mIoU / OA | Area-5 or 6-fold (no server) |
| ScanNet v2 / ScanNet200 | RGB-D mesh (indoor) | Semantic; instance | 20 / 200 | mIoU / mAP | Hidden test server |
| Point Cloud City / Open3D-ML PCC | Indoor public-safety point clouds | Semantic segmentation; label unification | collection-specific | IoU / mIoU | NIST program + Open3D-ML repo; access varies |
| FRACTAL | ALS (airborne) | Segmentation | 7 | mIoU / OA | Public split (HuggingFace) |
| GOOSE / GOOSE-Ex | LiDAR + RGB + NIR (off-road) | Segmentation (64 fine / 8 super) | 64 | mIoU | Public split; ICRA 2025 challenge |
| SemanticRail3D | MLS (railway corridor) | Semantic; instance | ~11–12 | mIoU | Public split |
| WHU-Railway3D | MLS (railway, multi-env) | Semantic | 11 | mIoU / OA | Public split |
| WHU-Urban3D | MLS + ALS | Semantic; instance; object detection | 18 MLS / 7 ALS semantic classes | mIoU / OA / mAcc + instance metrics | Benchmark page; upload currently unavailable |
| Turin3D | ALS (airborne) | Semi-supervised segmentation | ~8 | mIoU | Public (val/test only) |
| CITYLID | ALS (airborne) | Fine street-feature segmentation | 13 | qualitative only | HuggingFace open dataset |
| ECLAIR | ALS (aerial) | Semantic segmentation | 11 | mIoU | CVPRW paper + GitHub/download form |
| YUTO Semantic | ALS (aerial campus) | Semantic segmentation | 9 | OA / mIoU | Hugging Face; one mission released |
| S.MID | Livox Mid-360 hybrid-solid LiDAR | Single-frame semantic segmentation | 14 eval / 25 annotated | mIoU | Official dataset page + SFPNet repo |
| OpenTrench3D | Photogrammetric RGB point cloud | Semantic segmentation | 5 | mIoU | Public repo / Kaggle; not LiDAR |
| MLDAS | Multi-LiDAR vehicle platform | Domain-adaptation semantic segmentation | 14 | mIoU | Email-request access; license-limited |
| USCILab3D | 32-beam LiDAR + 5 cameras | Long-term campus semantic point clouds | 267 | No stable public leaderboard | Raw bags/code available; processed data pending |
| Industrial3D | TLS industrial MEP | Semantic + cross-paradigm benchmark | 12 | mIoU | Watchlist; full dataset/code pending paper acceptance |
| City-Facade | MLS building-facade point clouds | Semantic + instance segmentation | 9 facade classes | OA / mIoU | ISPRS JPRS 2026 + official repo; full access to verify |
| ZAHA | MLS facade point clouds (TUM-MLS-2016) | Facade semantic segmentation | 5 LoFG2 / 15 LoFG3 | OA / IoU / F1 | WACV 2025 + TUM2TWIN benchmark + official repo |
| SIP (Site in Pieces) | TLS (single-station) | Construction-site segmentation | 23 | mIoU | Public split |
| Waymo-4DSeg / SAM4D | Camera + LiDAR (pseudo-labeled) | Class-agnostic masklets | class-agnostic | mask metrics | Derived (Waymo Open) |

### Dataset Selection Protocol for Aggregated-Map Segmentation

Do not rank datasets by leaderboard prestige alone. For an aggregated-map semantic layer, the first question is whether the public benchmark exercises the same *map-production failure mode* as the target product. A SemanticKITTI or Waymo score is useful for single-scan LiDAR semantics; it is not sufficient evidence that a model will preserve taxiway markings, terminal frontage details, utility poles, construction equipment, or stationary-but-transient clutter in a registered multi-session map.

Use the following protocol before choosing a pre-training or validation pool:

1. **Match acquisition geometry first.** Vehicle MLS and accumulated mobile-mapping datasets are the highest-value sources for ground-robot maps; ALS/UAV datasets are site-survey complements; TLS/indoor datasets are managed-building or terminal-interior proxies; mesh/photogrammetry datasets are digital-twin transfer aids rather than LiDAR sensor-noise evidence.
2. **Match the class pressure second.** Choose datasets that contain the failure-critical classes: road markings, kerbs, poles, wires, signs, facade openings, utilities, workers, temporary equipment, rail/corridor furniture, or industrial MEP. A generic "outdoor" class set is not enough.
3. **Separate training evidence from release evidence.** Photogrammetric and mesh corpora are acceptable for pre-training features or taxonomy stress, but release claims for a LiDAR map need LiDAR validation data with comparable density, intensity behavior, registration quality, and sensor pose.
4. **Require split discipline.** Favor spatially disjoint geographic splits over random point splits. Aggregated maps leak context easily: adjacent tiles can share the same facade, road marking, or pole-line pattern even when point IDs differ.
5. **Audit license and access before planning.** Several useful 2025-2026 additions are email-gated, challenge-gated, non-commercial, or still pending full release. Treat them as research proxies until download, redistribution, and commercial-use terms are verified.
6. **Score map hygiene separately.** Datasets built for semantic segmentation rarely label dynamic residuals, static-but-transient objects, or false deletions. Pair this page with moving/static and map-cleaning benchmarks whenever the target product is a publishable map, not a per-frame perception output.

| Release question | Primary dataset evidence | Secondary evidence | What still needs in-house validation |
|---|---|---|---|
| Can a model label a ground-level registered LiDAR map? | KITTI-360, Paris-Lille-3D, Toronto-3D, WHU-Urban3D, SemanticRail3D, WHU-Railway3D | SemanticKITTI multi-scan, SemanticTHAB, MLDAS | Site-specific registration drift, map tiling, intensity calibration, and static/transient quarantine |
| Can it preserve non-road managed-site classes? | Point Cloud City / Open3D-ML PCC, SIP, S.MID, Industrial3D, USCILab3D | S3DIS, ScanNet200, CUS3D | Outdoor transfer, vehicle-mounted density, safety-critical minority classes, operational clutter |
| Can it use LiDAR plus image evidence without requiring camera at release time? | GridNet-HD, KITTI-360, CUS3D, H3D | 2DPASS/ScaLR-style distillation papers, SAM4D pseudo-labels | Calibration residuals, projection provenance, image-unavailable fallback, LiDAR-only artifact compatibility |
| Can it handle facade and terminal-frontage semantics? | ZAHA, City-Facade, SUM Parts, CUS3D, WHU-Urban3D | H3D, Toronto-3D | Full-site ground classes, facade-to-ground boundary policy, BIM/digital-twin handoff rules |
| Can it handle overhead/long-thin infrastructure? | GridNet-HD, ECLAIR, WHU-Railway3D, SemanticRail3D, DALES | OpenTrench3D for utility taxonomy pressure | Wire/pole recall at target sensor density, false deletion during map cleaning, camera projection visibility |
| Can it support airside, port, depot, or industrial-yard rollout? | GOOSE-Ex, SIP, S.MID, Industrial3D, WHU-Urban3D, KITTI-360 | STPLS3D, CUS3D, SemanticTHAB | Airport/yard-specific objects, GSE/vehicle vocabulary, FOD exclusion, stationary people, staged equipment |
| Can it produce a releaseable semantic-map artifact? | No public dataset is sufficient by itself | MapBench, SceneEdited, HKCD, moving/static datasets, map-hygiene protocols | A held-out, manually reviewed site map with semantic labels, removal labels, provenance, and publication gates |

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

### SemanticTHAB — modern high-resolution MLS sensor proxy

- **Sensor:** Ouster OS2-128 Rev7, a modern high-resolution 128-channel spinning LiDAR rather than the older HDL-64/HDL-32 units common in the canonical driving benchmarks.
- **Scale:** 4,750 labelled 3D LiDAR point clouds from urban autonomous-driving environments.
- **20 semantic classes:** The Zenodo record lists road, car, pedestrian, and building among the class set; use the repository taxonomy before building a loader.
- **Access:** Zenodo v3, published 2025-02-21; associated repository `kav-institute/SemanticLiDAR`.
- **Metric:** Intended for SemanticKITTI-style semantic-segmentation evaluation, but without a hidden public leaderboard.
- **Known pitfalls:** This is a high-resolution *single-cloud* sensor proxy, not an aggregated-map benchmark. Its value for an airside map pipeline is density and modern-beam-pattern coverage, not map-scale tiling or multi-session change handling.

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

### GridNet-HD — multimodal utility-infrastructure LiDAR/image benchmark

- **Sensor / acquisition:** UAV LiDAR plus high-resolution oblique RGB imagery with camera poses and calibration files. The official dataset card describes 36 geographic zones, each with images, masks, LiDAR, and pose folders.
- **Scale:** 7,694 images and 2,448,762,950 LiDAR points across the official train/test split.
- **11 evaluated semantic groups:** `pylon, conductor cable, structural cable, insulator, high vegetation, low vegetation, herbaceous vegetation, rock/gravel/soil, impervious soil/road, water, building`; the unassigned/unlabeled group is ignored.
- **Tasks and baselines:** LiDAR-only Superpoint Transformer, image-vote projection, and late-fusion MLP baselines are released. The dataset card reports 66.90 mIoU for SPT, 69.10 for ImageVote, and 74.22 for late fusion.
- **Access and license:** Hugging Face dataset and leaderboard; CC-BY-4.0. The card recommends `huggingface_hub.snapshot_download` rather than the auto-converted Parquet dataset view.
- **Benchmark role:** Best current public proxy for long-thin utility infrastructure and calibrated LiDAR-image fusion in a large dense point cloud. It is relevant to poles, masts, cables, gantries, and overhead/edge infrastructure in non-road sites.
- **Known pitfalls:** UAV utility-corridor acquisition is not vehicle-mounted MLS and is not airside. Treat it as a thin-class and fusion stress test, not as validation for pavement semantics, FOD retention, GSE, or dynamic map cleaning.

### SensatUrban — the scale / tiling benchmark

- **Sensor:** Photogrammetric dense point clouds (SfM + MVS from UAV oblique imagery — NOT direct LiDAR pulses). The dataset paper reports Birmingham, Cambridge, and York, covering 7.6 km²; benchmark descriptions may refer to the labelled two-city release subset.
- **Scale:** Nearly 3 billion annotated points.
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

### CUS3D and SUM Parts — urban mesh / photogrammetric map references

- **CUS3D acquisition:** UAV photogrammetry from 10,840 aerial images, reconstructed into a 2.85 km² urban/rural scene with point cloud, triangular mesh, and high-resolution 2D imagery.
- **CUS3D scale and labels:** 152,298,756 labelled 3D points, 289,404,088 labelled triangles, and 10 semantic categories: building, road, grass, car, high vegetation, playground, water, building site, farmland, and ground.
- **CUS3D benchmark role:** Not a LiDAR dataset. Its value is a geometry+RGB+mesh reference for pipelines that colorize a LiDAR map, mesh it for inspection/simulation, or compare point-cloud and mesh segmentation heads. The paper reports KPConv as the best of six tested 3D methods with 59.72% mIoU, 89.42% OA, and 97.88% mAcc.
- **SUM Parts acquisition:** Textured urban meshes, derived from the SUM mesh lineage, with part-level semantic annotations over about 2.5 km².
- **SUM Parts classes:** 21 part-level classes, including terrain, high/low vegetation, water, car, boat, wall, roof surface, facade surface, chimney, dormer, balcony, roof installation, window, door, impervious surface, road, road marking, cycle lane, and sidewalk.
- **Benchmark role:** SUM Parts is the right proxy when the release artifact is a textured mesh or a digital twin layer rather than a raw point cloud. It is especially useful for class-taxonomy design around markings, sidewalks, facades, roofs, and other map-product surfaces that do not map cleanly onto a simple road/ground/building ontology.
- **Known pitfalls:** Photogrammetric and mesh datasets do not reproduce LiDAR pulse noise, multi-return behaviour, intensity calibration, or vehicle-height occlusion. Treat them as RGB/mesh pipeline references and annotation-schema pressure tests, not as LiDAR-statistics substitutes.

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

### WHU-Urban3D — MLS + ALS urban semantic and instance benchmark

- **Sensor / acquisition:** Mixed MLS and ALS point clouds over large road and urban scenes.
- **Scale:** Official site reports 3.6 × 10^6 m² and more than 300 million points, with point-wise semantic and instance labels.
- **Tasks:** Semantic segmentation, instance segmentation, and object detection; countable classes also carry 3D bounding boxes.
- **Semantic benchmark classes:** Current benchmark page reports 18 MLS semantic classes and 7 ALS semantic classes. The MLS class list includes tree, non-driveway, building, box, light, electrical/municipal poles, low vegetation, board, driveway, mark, vehicle, pedestrian, traffic light, detector, fence, wire, and pole; the ALS list is coarser.
- **Metrics / submission:** Semantic segmentation reports oAcc, mAcc, and mIoU; instance segmentation reports coverage, precision/recall, F1, and semantic metrics. The benchmark page currently states result upload is not available.
- **Airside transfer:** High for dense urban district mapping, service-road corridors, and urban non-road campus environments because it combines ground-level MLS and aerial ALS views. It is also a good stress test for the "same place, different acquisition geometry" problem that airside survey and site-survey products will face.
- **Known pitfalls:** Licence and redistribution terms are not explicit in the public landing page. Use it for research benchmarking unless terms are confirmed.

### Recent additions: non-road, site-survey, utility, campus, and industrial proxies

- **Turin3D** — ALS, ~1.43 km², ~70 M points, central Turin. Training set is unlabeled by design; only validation and test sets are annotated. Purpose-built for semi-supervised and domain-adaptation evaluation, not a fully-supervised leaderboard. Classes not enumerated in public abstract — verify in arXiv:2504.05882.
- **CITYLID** — Citywide ALS of Berlin (1,060 tiles, ~15 billion points). 13 classes: 3 standard (`ground, buildings, trees`); 5 fine street features (`medians, driveways, bikepaths, walkways, on-street parking`); 5 shadow bins (0–3, 3–5, 5–7, 7–10, 10–12 h). Licence: DL-DE (allows commercial + research use, redistribution). No quantitative DL benchmark — visual/qualitative validation only; the researcher must define their own splits and metrics. Access: HuggingFace `Deepank/CITYLID`.
- **SIP (Site in Pieces)** — TLS single-station, 40 scenes (27 indoor, 13 outdoor construction sites), ~140–200 M total points, 23 classes covering structural elements, temporary objects, and site context. Single-station viewpoint preserves radial density decay and self-occlusion — the explicit counterpoint to aggregated maps. Licence: publicly available (terms in arXiv:2512.09062).
- **Waymo-4DSeg / SAM4D** — Pseudo-labeled, cross-modal (camera + LiDAR) masklet dataset (~30 M LiDAR masks). Labels are class-agnostic (instance/masklet identity, not a fixed taxonomy). Pre-training and promptable-segmentation resource, not a closed-taxonomy leaderboard. Released as part of SAM4D (arXiv:2506.21547).
- **ECLAIR** — Aerial LiDAR over urban/utility corridors, covering about 10 km² with close to 600 M points, 11 semantic classes, colorized points, and 1,246 tiles (ground-truth plus pseudo-label tiles). Strong aerial/site-survey and utility-infrastructure proxy; not ground-level MLS and not direct airside acceptance evidence.
- **YUTO Semantic** — ALS campus dataset over York University, with approximately 738 M points over 9.46 km² and 9 semantic classes. Use it as a campus-scale aerial/site-survey proxy; do not treat it as ground-vehicle MLS.
- **S.MID** — Industrial substation LiDAR dataset captured by an industrial robot with Livox Mid-360 hybrid-solid LiDAR: 38,904 frames, 25 annotated categories merged to 14 single-frame evaluation classes, and SemanticKITTI-like `.bin` / `.label` files. Use it as an industrial hybrid-solid LiDAR proxy, not as map-scale aggregated segmentation evidence.
- **OpenTrench3D** — 310 photogrammetric RGB point clouds of open utility trenches, totaling about 528 M points and 5 utility/trench classes. It is useful for underground-utility, works-zone, and RGB point-cloud taxonomy pressure, but it is not LiDAR and should not be used as LiDAR sensor-noise evidence.
- **MLDAS** — Multi-LiDAR domain-adaptation dataset with 31,875 synchronized 128/64/32-beam LiDAR scans across campus and urban-street scenarios, annotated into 14 classes. Use it for sensor-transfer and density-robustness experiments; access is email-gated and non-commercial.
- **USCILab3D** — Long-term USC campus robot dataset with 5 cameras, 32-beam 360° LiDAR, pose-stamped data, foundation-model-assisted 2D-to-3D semantic labels, and reported 267 semantic categories. Treat it as a high-interest campus/label-backprojection watch item because the project site says raw bags and processing code are available while processed data is still coming soon.
- **Industrial3D** — 2026 TLS industrial-infrastructure benchmark with 612.7 M labeled points at 6 mm resolution, 12 MEP/structure classes, and cross-paradigm baselines. The public repository still marks full dataset/code release as tied to paper acceptance, so keep it as a watchlist/proxy note until the full release is available.
- **Point Cloud City / Open3D-ML PCC** — NIST public-safety indoor point-cloud collections from Enfield, Memphis Map901, and Hancock County, routed through an Open3D-ML integration with dataset processing, SemanticKITTI-style conversion, KPConv/RandLA-Net configuration examples, and TensorFlow/PyTorch semantic-segmentation pipelines. The 2026 NIST WF-PST publication analyzes Enfield/Memphis label unification and KPConv-compatible IoU evaluation, and explicitly warns that class imbalance and small safety-critical features remain hard. Use it as a managed-building, terminal-interior, and label-harmonization proxy; do not treat it as outdoor AV, airside, or leaderboard-grade evidence. The GitHub repository is no longer maintained by NIST, and collection access varies by awardee.
- **City-Facade** — 2026 ISPRS JPRS MLS building-facade dataset from Xiamen, China, with approximately 200 M labeled points over more than 60 km of roads for semantic and instance segmentation of facade elements. The official repository describes labeled facade clouds with 9 classes plus unlabeled street-landscape clouds, and the paper lists wall, window, door, roof, advertisement, air conditioner, rain shed, balcony, and other/unclassified labels. Use it as a vertical-structure, terminal-frontage, BIM/digital-twin, and facade-sublabel proxy; do not treat it as a full map benchmark for roads, markings, poles, vegetation, vehicles, or dynamic-object removal. Verify full train/test access and license terms before benchmark-grade or production claims.
- **ZAHA** — WACV 2025 / TUM2TWIN facade benchmark derived from real mobile laser scans over Munich/TUM campus facades, with 601 M annotated points across 66 facades. Its Level of Facade Generalization (LoFG) hierarchy evaluates both five coarse LoFG2 groups (`floor`, `decoration`, `structural`, `opening`, `other elements`) and 15 fine LoFG3 classes (`wall`, `window`, `door`, `balcony`, `molding`, `deco`, `column`, `arch`, `stairs`, `ground surface`, `terrain`, `roof`, `blinds`, `interior`, `other`). Use it as the strongest public facade-hierarchy stress test for terminal frontage, BIM/digital-twin, and vertical-structure sublabels; do not treat it as a road/yard/apron benchmark, a LiDAR-image benchmark, or a dynamic-object-removal source.

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
| SemanticTHAB | Zenodo `.zip` + repo tools | OS2-128 point clouds | 20-class semantic labels; verify exact field layout in repo |
| nuScenes-lidarseg | `.bin` | float32 | `uint8` class index (0 = void) |
| Waymo 3D Seg | tfrecord via devkit | (x,y,z,intensity, return) | per-point class index |
| Semantic3D | `.txt` + `.labels` | (x,y,z,intensity,R,G,B) | one integer per line in `.labels` |
| Paris-Lille-3D | `.txt` | (x,y,z,intensity,label_id) | integer class index; no RGB |
| Toronto-3D | LAS/LAZ | (x,y,z,R,G,B,intensity,GPS time,scan angle,label) | integer attribute |
| KITTI-360 | LAS-style binary | (x,y,z,intensity,timestamp) | semantic + instance via devkit |
| DALES / FRACTAL | LAS / LAZ 1.4 | (x,y,z,intensity,return info,colour) | class attribute |
| GridNet-HD | LAS + images + masks + poses | LiDAR point cloud with `ground_truth` field plus RGB projection assets | grouped semantic class IDs; test labels hidden for leaderboard |
| ECLAIR | LAZ point clouds + `labels.json` | aerial LiDAR points with colorized attributes | 11-class semantic labels; ground-truth and pseudo-label tile split |
| YUTO Semantic | LAS/LAZ-style release via Hugging Face | aerial LiDAR points with intensity, returns, GPS time, scan angle, and class | 9 semantic classes; one mission currently released |
| S.MID | SemanticKITTI-like `.bin` + `.label` | Livox Mid-360 hybrid-solid LiDAR points | 25 raw categories merged to 14 evaluation labels |
| OpenTrench3D | PLY-style photogrammetric point clouds | XYZRGB point clouds from smartphone-video photogrammetry | 5 utility/trench classes; `Misc` ignored in training/evaluation |
| MLDAS | synchronized multi-LiDAR frame packages | OS128 / OS64 / XT32 LiDAR scans | 14 semantic classes; labels propagated from the 128-beam reference LiDAR |
| USCILab3D | raw ROS bags; processed point clouds pending | 32-beam LiDAR + 5 cameras + poses | 267 projected semantic categories reported; processed semantic release to verify |
| Industrial3D | TLS point-cloud release pending | dense terrestrial industrial MEP scans | 12 semantic classes; full release and licence still pending |
| Point Cloud City / Open3D-ML PCC | collection packages plus Open3D-ML conversion scripts | indoor point clouds and associated project imagery where available | collection-specific labels; Open3D-ML PCC tools support SemanticKITTI-style conversion and unified-label experiments |
| City-Facade | `.txt` facade point-cloud segments | x, y, z, LiDAR intensity, instance label, semantic label | integer facade semantic labels plus instance IDs; full train/test package access to verify |
| ZAHA | TUM2TWIN / official download package | mobile-laser-scan facade points in local and global UTM coordinate frames | LoFG2 and LoFG3 semantic labels; verify exact loader/package layout before training |
| SensatUrban | PLY | per-point | integer class label |
| CUS3D | Point cloud + mesh + 2D imagery | RGB geometry from UAV reconstruction | 10 semantic classes on 3D points, mesh triangles, and 2D images |
| SUM / SUM Parts | Textured mesh | mesh faces + texture pixels | 6-class SUM; 21-class SUM Parts with face/pixel label variants |
| GOOSE / GOOSE-Ex | SemanticKITTI-compatible | point-wise | SemanticKITTI label files |
| SemanticRail3D | LAZ | (x,y,z,intensity,class,instance_id) | explicit class + instance fields |
| WHU-Railway3D | `.npy` | per-point | `uint8` values 0–10 |
| WHU-Urban3D | Benchmark upload uses `.h5` | coordinates + labels per scene | semantic and instance labels in `labels` key; raw package format to verify |
| S3DIS | `.txt` | (x,y,z,R,G,B,label) | per-point integer |
| ScanNet v2/200 | mesh + voxel grid | per-vertex | 2 cm voxel grid labels |

**Key compatibility point:** SemanticKITTI-compatible format (SynLiDAR, GOOSE, RareBoost3D, S.MID) enables direct reuse of SemanticKITTI-style data loaders after label remapping. LAS/LAZ files (FRACTAL, DALES, ECLAIR, YUTO Semantic, SemanticRail3D, Toronto-3D, KITTI-360) require the `laspy` or `pdal` library. Mesh-based formats (ScanNet) require a separate voxelisation or subsampling step before point-wise inference. Release-maturity watch items (USCILab3D processed data, Industrial3D full data/code, and email-gated MLDAS) should be represented in experiments by a dataset manifest that records access date, licence, available modalities, and exact class-map evidence.

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
| GridNet-HD | CC-BY-4.0 | Commercial + research with attribution; verify downstream model/data redistribution rules |
| ECLAIR | CC BY-NC-SA 4.0 for data; code MIT | Dataset is non-commercial; contact owner for commercial cases |
| YUTO Semantic | CC BY-NC 4.0 | Non-commercial only |
| S.MID | CC BY-NC-SA 4.0 | Non-commercial research only |
| OpenTrench3D | CC BY-NC 4.0 | Non-commercial only |
| MLDAS | Custom email-gated licence | Non-commercial, non-transferable; no commercial model training |
| USCILab3D | Processed-data licence unclear | Verify before redistribution or model release |
| Industrial3D | Dataset licence pending; repo GPL-3.0 for code | Treat as watchlist until full release/licence is explicit |
| Point Cloud City / Open3D-ML PCC | Collection-specific public-safety data access; repo licence visible on GitHub | Verify each collection's access terms; Open3D-ML PCC code is no longer NIST-maintained |
| City-Facade | Open-access paper; dataset/full-release terms to verify | Treat as research proxy until full train/test access and license terms are explicit |
| ZAHA | Official repo is CC0-1.0; dataset/download terms to record per package | Strong research proxy for facade taxonomy; verify dataset terms before commercial training or redistribution |
| SensatUrban | Academic (registration) | Research use; check before commercial |
| CUS3D | Open-access paper; data terms to verify | Research use until data licence is confirmed |
| SUM / SUM Parts | Project/code/data released; data terms to verify | Research use until data licence is confirmed |
| FRACTAL | French open-data (permissive) | Commercial + research |
| CITYLID | DL-DE | Commercial + research + redistribution |
| GOOSE / GOOSE-Ex | Open (goose-dataset.de) | Research use |
| SynLiDAR | MIT | Commercial permissible |
| S3DIS | Non-commercial academic | Research only |
| ScanNet v2/200 | Non-commercial academic | Research only |
| WHU-Railway3D | Not specified | Verify before use |
| WHU-Urban3D | Not specified on landing page | Verify before use |
| SemanticRail3D | Not confirmed | Verify before use |
| SemanticTHAB | Zenodo open dataset | Verify exact Zenodo licence metadata before production |

Almost every benchmark is released for **research / non-commercial use**. They are appropriate for pre-training, architecture selection, and benchmarking, but a model whose weights are shipped in a product should have its supervised fine-tuning grounded in owned in-domain data. Verify each licence before production use — see `../overview/aggregated-map-semantic-segmentation.md` §5.2.

## Airside Transfer

No airside aggregated-map benchmark exists — the 2023–2026 additions above confirm rather than close that gap: none is airport-specific. For an airside pipeline the transfer-relevant analysis starts from acquisition paradigm.

**MLS ground-level, accumulated-map group** (Paris-Lille-3D, Toronto-3D, KITTI-360, SemanticRail3D, WHU-Railway3D, WHU-Urban3D): These datasets share a survey-drive viewpoint — a vehicle-mounted multi-beam LiDAR driving a linear corridor, building a registered multi-scan map — that most closely matches a taxiway or apron survey drive. SemanticRail3D and WHU-Railway3D add a constrained linear ODD with structured trackside infrastructure (catenary poles, masts, overhead lines, track-bed marking) that is a closer analog to airside taxiway corridor furniture than open urban road geometry. WHU-Urban3D adds a mixed MLS/ALS urban-district case for non-road campus-style mapping. SemanticKITTI multi-scan task adds explicit static/moving reasoning useful for mixed-traffic apron scenarios.

**Per-domain transfer assessment:**

| Dataset | Paradigm match | Transfer value for airside |
|---|---|---|
| KITTI-360 | MLS accumulated, registered | High — best viewpoint + density match for taxiway survey drive |
| Paris-Lille-3D / Toronto-3D / WHU-Urban3D | MLS accumulated or MLS+ALS urban | High — survey-drive viewpoint; urban-district furniture and marking classes |
| SemanticRail3D / WHU-Railway3D | MLS accumulated, constrained corridor | High — corridor geometry, trackside infrastructure analog |
| SemanticTHAB | High-resolution MLS single-cloud | Moderate-high — modern OS2-128 density proxy; not map-scale |
| GOOSE-Ex | Aggregated clouds, large-vehicle platform | Moderate-high — relevant for GSE/construction-zone ODD |
| City-Facade | MLS facade-level point clouds | Moderate — strong for terminal/building-frontage vertical structures, weak for ground, markings, movers, and open areas |
| Point Cloud City / Open3D-ML PCC | Indoor managed-building point clouds | Moderate — useful for terminal-interior, public-safety, small-object, and label-unification lessons; wrong outdoor geometry |
| SemanticKITTI (multi-scan) | MLS per-scan sequences + motion | Moderate — per-scan, but 4D labelling available |
| FRACTAL | ALS nadir, large-area | Moderate for site surveys; wrong viewpoint for ground-vehicle |
| DALES | ALS nadir | Low for ground-vehicle; nadir density profile |
| ZAHA | MLS facade-only point clouds | Moderate for terminal/frontage slices — strong LoFG facade hierarchy, weak for full-site map validation |
| GridNet-HD | UAV LiDAR + oblique imagery, utility corridor | Low-moderate for airside; strong for thin overhead/edge infrastructure and LiDAR-image fusion stress |
| CUS3D / SUM Parts / SensatUrban / STPLS3D | UAV photogrammetric or textured mesh | Low-moderate — excellent for RGB/mesh/tiling design; no LiDAR pulse noise |
| nuScenes / Waymo | Per-frame, no map accumulation | Low — per-scan paradigm only |

**Urban-district / non-road proxy matrix:**

| Target condition | Best public proxies | Use in the pipeline |
|---|---|---|
| Railway, taxiway, or service-road corridor | SemanticRail3D, WHU-Railway3D | Stress linear-infrastructure classes, overhead/edge structures, corridor tiling, and constrained-route geometry |
| Dense urban district, campus, or depot map | WHU-Urban3D, KITTI-360, Paris-Lille-3D, Toronto-3D, SemanticTHAB, MLDAS, USCILab3D | Pre-train MLS backbones and validate markings, poles, wires, road/driveway, building, and low-vegetation confusion; use MLDAS for sensor-transfer stress and USCILab3D only after release-maturity checks |
| Managed-building, terminal-interior, or public-safety facility map | Point Cloud City / Open3D-ML PCC, S3DIS, ScanNet200, USCILab3D | Stress indoor/managed-site label harmonization, emergency-response safety features, small minority classes, and point-cloud-to-map annotation workflows; do not transfer outdoor dynamics from these sources |
| Building frontage, facade, or vertical-structure-heavy district | ZAHA, City-Facade, SUM Parts, CUS3D, WHU-Urban3D, Toronto-3D | Validate LoFG-style facade hierarchy, wall/window/door/roof/balcony/HVAC-like sublabels, facade continuity, vertical tiling, BIM/digital-twin handoff, and terminal-frontage QA |
| Utility, trench, overhead-line, perimeter, or gantry infrastructure | GridNet-HD, ECLAIR, OpenTrench3D, DALES, Toronto-3D, WHU-Railway3D | Stress pylon/cable/insulator/pole/wire/trench classes, LiDAR-image projection, and rare long-thin recall; OpenTrench3D is photogrammetric-only |
| Construction, quarry, apron works, industrial plant, and large equipment | GOOSE-Ex, SIP, S.MID, Industrial3D, CUS3D, STPLS3D | Cover unstructured terrain, temporary equipment, substation/MEP clutter, works-zone geometry, and simulator/synthetic rare-class augmentation |
| Aerial/site-survey layer | FRACTAL, DALES, ECLAIR, YUTO, CITYLID, CUS3D | Train or validate nadir/site-survey products that complement the ground survey map |
| Mesh or digital-twin release product | SUM, SUM Parts, CUS3D, H3D | Validate point-to-mesh transfer, textured-map annotation, road-marking/cycle-lane/sidewalk surfaces, and facade/roof class splits |

Three additions are worth singling out for airside work specifically:

- **GOOSE-Ex** is the most directly relevant new resource — built on odometry-merged aggregated clouds (same accumulation regime as an airside apron map) and covers unstructured large-vehicle scenes (excavator, quadruped) sharing more with apron/movement-area operations than any urban-road benchmark. It is the primary public pre-training source for the mining and construction ODDs and a reasonable off-road transfer source for airside.
- **SemanticRail3D** adds a large MLS corridor reference; railway-domain classes (catenary poles, rails, trackbed, masts, overhead lines) directly parallel airside ground-lighting arrays, taxiway edge structures, and jet-bridge infrastructure.
- **GridNet-HD** adds the strongest current LiDAR-image utility-infrastructure proxy. It does not match airside geometry, but its pylon/cable/insulator split is a useful stress test for whether a taxonomy and model can preserve long, thin, safety-relevant static infrastructure instead of merging it into generic pole or vegetation classes.
- **FRACTAL** is the strongest ALS pre-training source — a 250 km², statistically balanced, geometry-only corpus useful for nadir-scanned site-survey models, though its airborne viewpoint still differs from a ground survey-drive.
- **Point Cloud City / Open3D-ML PCC** adds the managed-building/public-safety proxy that was missing from this page. Its value is not outdoor transfer; it is label-unification, minority safety-feature behavior, and reproducible Open3D-ML training/format-conversion evidence for terminal interiors or facility maps.
- **City-Facade** adds an MLS facade proxy where the existing facade evidence was mostly mesh or photogrammetry. It is useful when the release map needs finer building-frontage semantics or digital-twin handoff, but it is not a substitute for full-site road/yard/apron validation.
- **ZAHA** adds the current largest public point-cloud facade benchmark and a standards-oriented LoFG hierarchy. It complements City-Facade: City-Facade is a city-road frontage benchmark with semantic and instance labels; ZAHA is a facade-generalization stress test with two nested class levels. Use both for terminal-frontage and vertical-structure taxonomy design, not as substitutes for site-wide map acceptance evidence.

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
- GridNet-HD: Carreaud et al., 2026 — https://arxiv.org/abs/2601.13052 · https://huggingface.co/datasets/heig-vd-geo/GridNet-HD · [GridNet-HD page](gridnet-hd-power-line-lidar-image-segmentation.md)
- ECLAIR: Melekhov et al., CVPRW 2024 — https://openaccess.thecvf.com/content/CVPR2024W/USM/html/Melekhov_ECLAIR_A_High-Fidelity_Aerial_LiDAR_Dataset_for_Semantic_Segmentation_CVPRW_2024_paper.html · https://github.com/SharperShape/eclair-dataset
- YUTO Semantic: ISPRS GSW 2023 dataset card — https://huggingface.co/datasets/ausmlab/yuto-semantic · https://yutosemantic.ausmlab.com/
- S.MID / SFPNet: Wang et al., ECCV 2024 — https://github.com/Cavendish518/SFPNet · https://www.semanticindustry.top/dataset
- OpenTrench3D: Hansen et al., 2024 — https://arxiv.org/abs/2404.07711 · https://github.com/SimonBuusJensen/OpenTrench3D
- MLDAS: Chen et al., IJCAI 2024 — https://sychen320.github.io/projects/MLDAS/ · https://www.ijcai.org/proceedings/2024/0072.pdf
- USCILab3D: Lekkala et al., NeurIPS 2024 Datasets and Benchmarks — https://proceedings.neurips.cc/paper_files/paper/2024/hash/628433f240414517fd95164b4275f5cc-Abstract-Datasets_and_Benchmarks_Track.html · https://sites.google.com/usc.edu/uscilab3d/
- Industrial3D: Yin et al., 2026 — https://arxiv.org/abs/2603.28660 · https://github.com/pointcloudyc/Industrial3D
- SensatUrban: Hu et al., CVPR 2021 — arXiv:2201.04494 · https://github.com/QingyongHu/SensatUrban · https://point-cloud-analysis.cs.ox.ac.uk/
- H3D (Hessigheim): arXiv:2102.05346 · ISPRS Open Journal 2021
- STPLS3D: Chen et al., BMVC 2022 — arXiv:2203.09065
- CUS3D: Gao et al., Remote Sensing 2024 — https://www.mdpi.com/2072-4292/16/6/1079
- SUM Parts: Gao, Nan, and Ledoux, CVPR 2025 — https://arxiv.org/abs/2503.15300 · https://tudelft3d.github.io/SUMParts/
- S3DIS: Armeni et al., CVPR 2016 — http://buildingparser.stanford.edu/dataset.html · arXiv:1702.01105
- ScanNet v2: Dai et al., CVPR 2017 — http://www.scan-net.org · arXiv:1702.04405
- ScanNet200: Rozenberszki et al., ECCV 2022 — arXiv:2204.07761 · https://rozdavid.github.io/scannet200
- FRACTAL: Gaydon et al., 2024 — arXiv:2405.04634 · HuggingFace `IGNF/FRACTAL`
- GOOSE: Mortimer et al., 2023 — arXiv:2310.16788 · https://goose-dataset.de
- GOOSE-Ex: Hagmanns et al., 2024 — arXiv:2409.18788
- SemanticRail3D: Nature Scientific Data, Dec 2025 — https://www.nature.com/articles/s41597-025-06392-9 · https://github.com/Arshia-Gha/SemanticRail3D_Dataset
- WHU-Railway3D: IEEE TITS 2024 — https://dl.acm.org/doi/10.1109/TITS.2024.3469546 · https://github.com/WHU-USI3DV/WHU-Railway3D
- WHU-Urban3D: https://whu3d.com/dataset/ · https://whu3d.com/benchmark.html
- SemanticTHAB: https://zenodo.org/records/14906179 · https://github.com/kav-institute/SemanticLiDAR
- Point Cloud City / Open3D-ML PCC: https://www.nist.gov/services-resources/software/point-cloud-city-open3d-ml-repository · https://www.nist.gov/publications/cross-dataset-semantic-segmentation-performance-analysis-unifying-nist-point-cloud-city · https://github.com/alexdimopoulos/PointCloudCity-Open3D-ML
- City-Facade: Chen et al., ISPRS JPRS 2026 — https://doi.org/10.1016/j.isprsjprs.2026.01.003 · https://github.com/SYSU-3DSTAILab/City-Facade
- ZAHA: Wysocki et al., WACV 2025 — https://openaccess.thecvf.com/content/WACV2025/html/Wysocki_ZAHA_Introducing_the_Level_of_Facade_Generalization_and_the_Large-Scale_WACV_2025_paper.html · https://github.com/OloOcki/zaha · https://tum2t.win/datasets/pc-mls · https://tum2t.win/benchmarks/pc-fac
- Turin3D: CVPR Workshops 2025 — arXiv:2504.05882
- CITYLID: Environment and Planning B (SAGE), 2025 — https://journals.sagepub.com/doi/full/10.1177/23998083241312273 · HuggingFace `Deepank/CITYLID`
- SIP: arXiv:2512.09062
- YUTO Semantic: https://www.ausmlab.com/datasets/dataset · https://huggingface.co/datasets/ausmlab/yuto-semantic
- Industrial3D: https://arxiv.org/abs/2603.28660 · https://github.com/pointcloudyc/Industrial3D
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
