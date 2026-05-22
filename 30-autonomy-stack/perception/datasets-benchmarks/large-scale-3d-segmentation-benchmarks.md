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

No airside aggregated-map benchmark exists. For an airside pipeline the transfer-relevant subset is the **MLS, ground-level** group — Paris-Lille-3D, Toronto-3D, KITTI-360, and the SemanticKITTI multi-scan task — which match a survey-drive viewpoint far better than the nadir aerial benchmarks (DALES) or photogrammetric ones (SensatUrban). The full selection rationale and the proposed airside benchmark spec are in `../overview/aggregated-map-semantic-segmentation.md` §5.3-§5.4.

## Sources

- SemanticKITTI: Behley et al., "SemanticKITTI: A Dataset for Semantic Scene Understanding of LiDAR Sequences" (ICCV 2019) — http://semantic-kitti.org
- Semantic3D: Hackel et al., "Semantic3D.net: A New Large-Scale Point Cloud Classification Benchmark" (ISPRS 2017) — http://www.semantic3d.net
- Paris-Lille-3D: Roynard et al., "Paris-Lille-3D: A Large and High-Quality Ground-Truth Urban Point Cloud Dataset" (IJRR 2018) — https://npm3d.fr
- Toronto-3D: Tan et al., "Toronto-3D: A Large-Scale Mobile LiDAR Dataset for Semantic Segmentation of Urban Roadways" (CVPRW 2020)
- KITTI-360: Liao et al., "KITTI-360: A Novel Dataset and Benchmarks for Urban Scene Understanding in 2D and 3D" (TPAMI 2022) — https://www.cvlibs.net/datasets/kitti-360
- DALES: Varney et al., "DALES: A Large-Scale Aerial LiDAR Data Set for Semantic Segmentation" (CVPRW 2020)
- SensatUrban: Hu et al., "Towards Semantic Segmentation of Urban-Scale 3D Point Clouds" (CVPR 2021)
- STPLS3D: Chen et al., "STPLS3D: A Large-Scale Synthetic and Real Aerial Photogrammetry 3D Point Cloud Dataset" (BMVC 2022)
- Local context: `../overview/aggregated-map-semantic-segmentation.md` §5 (dataset selection guide), §13.3 (benchmarking rigor)
