# Large-Scale 3D Point Cloud Semantic Segmentation Benchmarks

**Last updated:** 2026-05-22

## Why It Matters

An aggregated-LiDAR-map semantic segmentation pipeline is built, pre-trained, and validated against the public 3D point cloud segmentation benchmarks — no airside-domain benchmark exists (see `../overview/aggregated-map-semantic-segmentation.md` §5.4). This page is the **evaluation-mechanics reference** for that benchmark landscape: splits, metrics, submission servers, label formats, licensing, and known issues. The companion §5 of the aggregated-map page is the *selection guide* (which dataset for what); this page is the *usage reference* (how to actually train and evaluate on them).

The practical point: these datasets shape what every 3D segmentation method reports. A "SOTA on SemanticKITTI" claim means little without knowing the split, the task variant, and whether the number came from the hidden test server or a local validation set.

## Benchmark Landscape

| Benchmark | Modality | Task variants | Eval classes | Metric | Leaderboard |
|---|---|---|---|---|---|
| SemanticKITTI | MLS (HDL-64E) | Single-scan; multi-scan (accumulated) | 19 / 25 | mIoU | Hidden test server |
| Semantic3D | TLS (static) | semantic-8; reduced-8 | 8 | mIoU / OA | Online server |
| Paris-Lille-3D (NPM3D) | MLS | Coarse segmentation | ~9-10 | mIoU | Online test server |
| Toronto-3D | MLS | Segmentation | 8 | mIoU / OA | Public split (L002 test) |
| KITTI-360 | MLS (accumulated) | 3D segmentation; 2D-3D | ~19 | mIoU | Online server |
| DALES | ALS (airborne) | Segmentation | 8 | mIoU / OA | Public split |
| SensatUrban | UAV photogrammetry | Segmentation | 13 | mIoU / OA | Hidden test server |
| STPLS3D | Aerial photogrammetry + synthetic | Segmentation; instance | up to 18 | mIoU / AP | Public + challenge |
| FRACTAL | ALS (airborne) | Segmentation | 7 | mIoU | Public split |
| GOOSE / GOOSE-Ex | LiDAR + RGB + NIR (off-road) | Segmentation (8 superclasses / 64 fine) | 64 | mIoU | Public split |
| SemanticRail3D | MLS (railway corridor) | Semantic; instance | ~11-12 | mIoU | Public split |
| Turin3D | ALS (airborne) | Segmentation (semi-supervised) | ~8 | mIoU | Public (val/test only) |
| CITYLID | ALS (airborne) | Segmentation | ~10+ fine street | mIoU / OA | Public split |
| SIP (Site in Pieces) | TLS (single-station) | Segmentation | construction classes | mIoU | Public split |
| Waymo-4DSeg | Camera + LiDAR (pseudo-labeled) | Class-agnostic masklets; 4D segmentation | class-agnostic | mask metrics | Derived (Waymo Open) |

## Per-Benchmark Evaluation Detail

### SemanticKITTI — the AV-domain reference

- **Built on** the KITTI odometry benchmark: 22 sequences. Sequences 00-10 are training (08 is the de-facto validation sequence), 11-21 are the held-out test set.
- **Single-scan task** evaluates **19 classes** (28 are labeled; rare/ambiguous ones are merged or ignored).
- **Multi-scan task** evaluates **25 classes** — it accumulates a short window of past scans and adds six *moving* variants, forcing explicit static/moving reasoning. This is the variant that most resembles aggregated-map segmentation.
- **Point clouds**: `.bin`, float32 `(x, y, z, intensity)`. **Labels**: `.label`, per-point `uint32` — lower 16 bits semantic, upper 16 bits instance.
- **Test labels are withheld**; results come from an online server. Never tune on the test set; report validation (sequence 08) during development.

### Semantic3D — the dense static-scan reference

- Terrestrial laser scanning, >4 billion points, **8 classes** (man-made/natural terrain, high/low vegetation, buildings, hardscape, scanning artefacts, cars).
- Two test splits: **semantic-8** (full) and **reduced-8** (subsampled, cheaper to submit) — always state which.
- **Format**: `.txt` per cloud (`x y z intensity r g b`) with paired `.labels` files.
- Online evaluation server; the dense, near-uniform density makes it the high-density bracket for density-robustness checks.

### Paris-Lille-3D (NPM3D) — the primary MLS pre-training source

- Mobile laser scanning, ~143 M points; 50 fine classes collapsed to ~9-10 coarse for the NPM3D benchmark.
- **Format**: `.ply`; LiDAR geometry + intensity, **no RGB**.
- Online test server with held-out labels. The closest public analog to an airside MLS corridor map.

### Toronto-3D, KITTI-360, DALES, SensatUrban, STPLS3D

- **Toronto-3D** — MLS, ~78 M points, 8 classes including an explicit *road marking* class; `.ply` with RGB; the public split commonly uses section L002 as test.
- **KITTI-360** — accumulated MLS, ~19 Cityscapes-aligned classes, consistent 2D and 3D labels; the reference for label back-projection / 2D-3D consistency.
- **DALES** — airborne LiDAR, ~505 M points, 8 classes, nadir viewpoint; the sparse-aerial density bracket.
- **SensatUrban** — UAV photogrammetric RGB cloud (not LiDAR), ~3 billion points, 13 classes, hidden test server; the standard scale/tiling benchmark.
- **STPLS3D** — aerial photogrammetry with a real and a large synthetic split (up to ~18 classes); supports semantic and instance tasks.

### Recent (2023-2026) benchmarks

- **FRACTAL** — the largest open **airborne LiDAR (ALS)** benchmark for 3D semantic segmentation: **100,000 dense point clouds**, **~9.3 billion points**, totalling **250 km²** sampled from France's IGN *Lidar HD* national program. **7 classes**, ~37 pts/m², geometry + intensity, **no RGB**. Tiles are deliberately sampled to maximise landscape and rare-class diversity rather than collected as contiguous strips — it is the high-coverage, statistically-balanced bracket for ALS-trained models and the closest large public analog to a nadir-scanned site survey. On Hugging Face as `IGNF/FRACTAL`.
- **GOOSE / GOOSE-Ex** — off-road / unstructured-environment segmentation. **GOOSE** provides a **64-class hierarchy** (8 superclasses) with synchronised **RGB + NIR + LiDAR**; **GOOSE-Ex** extends the same taxonomy to a robotic **excavator and a quadruped** operating in construction, quarry, and landfill scenes. Per-point labels are produced from **multiple frames merged by platform odometry** — i.e. aggregated clouds, the same accumulation regime as an aggregated map. Combined ~13,076 labeled clouds. The most directly relevant public pair for the **mining and construction ODDs** and for off-road generalisation tests.
- **SemanticRail3D** — a **mobile-LiDAR (MLS)** railway-corridor benchmark: **438 point clouds**, **~2.8 billion points**, **~11-12 classes plus instance labels**, with per-point **intensity**. It complements WHU-Railway3D and adds a second large rail-corridor reference; corridor geometry (a constrained linear ODD with structured trackside infrastructure) is a useful transfer source for any guided-path AV.
- **Turin3D** — a small **airborne-LiDAR** dataset of central Turin (**~1.43 km²**, **~70 M points**) built specifically for the **label-scarcity regime**: only the validation and test sets are labeled, the training set is **unlabeled by design**. It is a purpose-built testbed for **semi-supervised and domain-adaptation** methods rather than a fully-supervised leaderboard.
- **CITYLID** — a **citywide ALS** dataset covering all of Berlin (**1,060 km-tiles**). Beyond standard urban classes it adds **fine street-feature classes** — driveways, medians, bikepaths, walkways, on-street parking — semi-automatically categorised. The reference for fine-grained street-furniture and ground-surface taxonomy at city scale. *(Total point count not yet verified.)*
- **SIP (Site in Pieces)** — a **terrestrial-LiDAR (TLS)** construction-site dataset that deliberately **preserves single-station, non-aggregated scan characteristics** — radial density decay, self-occlusion, viewpoint-dependent coverage. It is the explicit counterpoint to aggregated maps: a model that only ever saw uniform aggregated density is exposed here to the raw single-scan statistics it will see at inference.
- **Waymo-4DSeg** — a large **pseudo-labeled, cross-modal (camera + LiDAR)** masklet dataset built by combining vision-foundation-model segmentation with **4D LiDAR reconstruction**, yielding **~30 M LiDAR masks**. Labels are **class-agnostic** (instance/masklet identity, not a fixed taxonomy), released as part of the *SAM4D* work. It is a pre-training / promptable-segmentation resource rather than a closed-taxonomy leaderboard.

## Metrics and Reporting Conventions

- **mIoU is the primary metric**; always report **per-class IoU** alongside it — a benchmark with one dominant class hides rare-class collapse behind a healthy mIoU.
- **Overall accuracy (OA)** is reported for comparability only; it is dominated by ground/building.
- **Hidden test servers** (SemanticKITTI, Semantic3D, NPM3D, SensatUrban) limit submissions — develop against a fixed validation split, submit to the server sparingly, and never select hyperparameters on the test set.
- A SOTA claim is only meaningful with the **task variant, split, and evaluation source** stated — see `../overview/aggregated-map-semantic-segmentation.md` §13.3 for the full benchmarking-rigor protocol.

## Data Formats and Label Conventions

- Point clouds appear as `.bin` (KITTI family), `.ply` (NPM3D, Toronto-3D, DALES), or `.txt` (Semantic3D) — a loader per format is unavoidable.
- Label encodings differ: SemanticKITTI packs semantic + instance into one `uint32`; others use a plain per-point class index or a separate `.labels` file.
- **Taxonomies do not align across datasets.** Cross-dataset training (e.g. Point Prompt Training) needs an explicit label-mapping layer; a single unified taxonomy across benchmarks does not exist.

## Licensing

Almost every benchmark here is released for **research / non-commercial use** (CC-BY-NC or a custom academic licence). They are fine for pre-training, architecture selection, and benchmarking, but a model whose weights are *shipped* should have its supervised fine-tuning grounded in owned in-domain data — see `../overview/aggregated-map-semantic-segmentation.md` §5.2. Verify each licence before production use.

## Airside Transfer

No airside aggregated-map benchmark exists — the 2023-2026 additions above confirm rather than close that gap: none is airport-specific. For an airside pipeline the transfer-relevant subset is the **MLS, ground-level** group — Paris-Lille-3D, Toronto-3D, KITTI-360, and the SemanticKITTI multi-scan task — which match a survey-drive viewpoint far better than the nadir aerial benchmarks (DALES) or photogrammetric ones (SensatUrban).

Three of the recent additions are worth singling out:

- **GOOSE-Ex** is the most directly relevant new resource — it is built on **odometry-merged aggregated clouds** (the same accumulation regime as an aggregated airside map) and covers unstructured, large-vehicle scenes that share more with apron/movement-area operations than any urban-road benchmark; it is the primary public pre-training source for the mining/construction ODDs and a reasonable off-road transfer source for airside.
- **FRACTAL** is the strongest ALS pre-training source — a 250 km², statistically-balanced LiDAR-only corpus useful for nadir-scanned site-survey models, though its airborne viewpoint still differs from a ground survey-drive.
- **SemanticRail3D** adds a large MLS corridor reference; a constrained linear ODD with structured trackside infrastructure is a closer analog to a taxiway corridor than open urban road.

The full selection rationale and the proposed airside benchmark spec are in `../overview/aggregated-map-semantic-segmentation.md` §5.3-§5.4.

## Sources

- SemanticKITTI: Behley et al., "SemanticKITTI: A Dataset for Semantic Scene Understanding of LiDAR Sequences" (ICCV 2019) — http://semantic-kitti.org
- Semantic3D: Hackel et al., "Semantic3D.net: A New Large-Scale Point Cloud Classification Benchmark" (ISPRS 2017) — http://www.semantic3d.net
- Paris-Lille-3D: Roynard et al., "Paris-Lille-3D: A Large and High-Quality Ground-Truth Urban Point Cloud Dataset" (IJRR 2018) — https://npm3d.fr
- Toronto-3D: Tan et al., "Toronto-3D: A Large-Scale Mobile LiDAR Dataset for Semantic Segmentation of Urban Roadways" (CVPRW 2020)
- KITTI-360: Liao et al., "KITTI-360: A Novel Dataset and Benchmarks for Urban Scene Understanding in 2D and 3D" (TPAMI 2022) — https://www.cvlibs.net/datasets/kitti-360
- DALES: Varney et al., "DALES: A Large-Scale Aerial LiDAR Data Set for Semantic Segmentation" (CVPRW 2020)
- SensatUrban: Hu et al., "Towards Semantic Segmentation of Urban-Scale 3D Point Clouds" (CVPR 2021)
- STPLS3D: Chen et al., "STPLS3D: A Large-Scale Synthetic and Real Aerial Photogrammetry 3D Point Cloud Dataset" (BMVC 2022)
- FRACTAL: Gaydon et al., "FRACTAL: An Ultra-Large-Scale Aerial Lidar Dataset for 3D Semantic Segmentation of Diverse Landscapes" (2024) — arXiv 2405.04634; Hugging Face `IGNF/FRACTAL`
- GOOSE: Mortimer et al., "The GOOSE Dataset for Perception in Unstructured Environments" (2023) — arXiv 2310.16788
- GOOSE-Ex: Hagmanns et al., "Excavating in the Wild: The GOOSE-Ex Dataset for Semantic Segmentation" (2024) — arXiv 2409.18788
- SemanticRail3D: "SemanticRail3D: A mobile-LiDAR railway-corridor point cloud dataset for semantic and instance segmentation" — Nature Scientific Data (2025), https://www.nature.com/articles/s41597-025-06392-9
- Turin3D: "Turin3D: Evaluating Adaptation Strategies under Label Scarcity in Urban LiDAR Segmentation" (CVPR Workshops 2025) — arXiv 2504.05882
- CITYLID: "CITYLID: A citywide airborne LiDAR dataset of Berlin for fine-grained street-feature segmentation" — Environment and Planning B (2025)
- SIP: "SIP (Site in Pieces): A terrestrial-LiDAR construction-site dataset preserving single-station scan characteristics" (2025) — arXiv 2512.09062
- Waymo-4DSeg: "SAM4D: Segment Anything in Camera and LiDAR Streams" (2025) — arXiv 2506.21547
- Local context: `../overview/aggregated-map-semantic-segmentation.md` §5 (dataset selection guide), §13.3 (benchmarking rigor)
