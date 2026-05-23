# Dynamic Map Cleaning Benchmarks

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "benchmark"
  stage: "reference"
  maturity: "fielded-pattern"
  tags: ["slam", "validation", "data-engine", "outdoor"]
  reason: "Dynamic Map Cleaning Benchmarks is rated as a SLAM benchmark or reference page for comparing methods and deployments."
method-priority:end -->

**Last updated:** 2026-05-24

Related docs: [LiDAR Map Cleaning — Dynamic Removal](lidar-map-cleaning-dynamic-removal.md), [BeautyMap](beautymap.md), [ERASOR](erasor.md), [ERASOR++](erasor-plus-plus.md), [FreeDOM](freedom-dynamic-object-removal.md), [MapCleaner](mapcleaner.md), [DR-Remover](dr-remover.md), [DO-Removal-LIO](do-removal-lio.md), [MOVES and Label-Free Map Cleaning](moves-and-label-free-map-cleaning.md), [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [Static-But-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [LiDAR Artifact Removal Techniques](../../perception/overview/lidar-artifact-removal-techniques.md), [Large-Scale 3D Segmentation Benchmarks](../../perception/datasets-benchmarks/large-scale-3d-segmentation-benchmarks.md), [HeLiMOS Heterogeneous LiDAR MOS](../../perception/datasets-benchmarks/helimos-heterogeneous-lidar-mos.md), [Point Cloud Segmentation Losses and Metrics](../../../10-knowledge-base/geometry-3d/point-cloud-segmentation-losses-metrics-first-principles.md).

---

## Why It Matters

Dynamic map cleaning removes ghost trails, parked-then-removed objects, moving actors, and transient clutter from point-cloud maps. It is not the same as runtime obstacle detection. A cleaned map is used for localization, simulation, annotation, map QA, and change control, so false deletion of static structure can be as damaging as leaving dynamic ghosts behind.

For airside autonomy, the risk is amplified: aircraft, tugs, carts, buses, cones, barriers, and service equipment can dominate a survey pass but should not automatically become permanent localization structure.

This page is the **evaluation-mechanics reference** for the dynamic-map-cleaning method family. It defines the canonical metrics, explains why published numbers from different papers cannot be naively compared, describes the two major benchmark frameworks, and tabulates reported numbers across the main methods. Individual method pages (ERASOR, ERASOR++, FreeDOM, DUFOMap, [BeautyMap](beautymap.md), Removert, MapCleaner, DR-Remover) should link here for metric definitions and cross-method context.

---

## 1. Why a Unified Benchmark Matters

Dynamic-object-removal methods are notoriously hard to compare because different papers:

- Define "ground-truth static" and "ground-truth dynamic" differently — semantic-class subset vs. full MOS labeling vs. manual annotation.
- Use different sequences (KITTI seq 00, 01, 02, 05, 07 — but not always all five).
- Report different metrics (PR/RR, SA/DA/AA, IoU_MOS) that are numerically incomparable even when the underlying datasets are the same.
- Choose method-favorable parameters on the same data used for evaluation — a reproducibility pathology documented by the KTH benchmark authors.
- Mix voxel-level and point-level evaluation, making cross-paper F1 comparisons misleading even when sequences match.

Before 2023, each paper introduced its own evaluation scaffold. ERASOR (RA-L 2021) introduced PR and RR for static map building but only compared itself against OctoMap and Peopleremover. Removert (IROS 2020) evaluated only on KITTI using internally generated ground truth. MapCleaner (Remote Sensing 2022) added sequences 02 and 07 but still used a proprietary scoring script. There was no shared evaluation code, no fixed parameter budget, and no common definition of "ground truth."

The KTH DynamicMap Benchmark (Zhang et al., ITSC 2023) was the first community-agreed, open-source, multi-method, multi-dataset evaluation harness. It standardised the evaluation pipeline from "run method → export clean map → compare to labeled ground truth → compute scores" in a reproducible Python/C++ chain. Its release ended the era of method-favorable private evaluations and made cross-paper comparison possible for the first time.

Source: [arXiv 2307.07260](https://arxiv.org/abs/2307.07260).

---

## 2. Metric Definitions

### 2.1 Preservation Rate (PR) and Rejection Rate (RR) — ERASOR Lineage

Introduced by Kim and Kim (ERASOR, RA-L 2021). Used by ERASOR, ERASOR++, Removert's original-family comparisons, Raymoval, MapCleaner, and FreeDOM in their own voxel-wise or private-evaluator result tables. KTH/DUFOMap/BeautyMap use the point-level SA/DA/AA or SA/DA/HA lineage instead, even when the same methods appear as baselines.

**Formal definitions (voxel-wise, 0.2 m voxel grid):**

```
PR = |kept_static| / |true_static|
   = (number of true-static voxels retained in the cleaned map)
     / (total number of true-static voxels in the raw accumulated map)

RR = |removed_dynamic| / |true_dynamic|
   = 1 - |preserved_dynamic| / |true_dynamic|
   = (number of true-dynamic voxels removed from the clean map)
     / (total number of true-dynamic voxels in the raw accumulated map)
```

`true_static` and `true_dynamic` are derived from SemanticKITTI per-point semantic labels. "Dynamic" means points annotated with the **moving-object class IDs**: 252 (moving-car), 253 (moving-bicyclist), 254 (moving-person), 255 (moving-motorcyclist), 256 (moving-on-rails), 257 (moving-bus), 258 (moving-truck), 259 (moving-other-vehicle). Everything else — road, building, pole, fence, vegetation, ground — is "static."

The voxelization is applied uniformly to both the raw map and the cleaned output before comparison. This reduces sensitivity to per-point density variations but introduces a granularity artifact: a voxel containing any true-dynamic point is counted as dynamic; a partially-eroded voxel is not counted as removed unless it is fully absent. ERASOR and its benchmark use a 0.2 m voxel side length for outdoor sequences.

**F1 (harmonic mean of PR and RR):**

```
F1 = 2 * PR * RR / (PR + RR)
```

F1 is the de-facto single-number ranking metric in most papers. It balances over-removal (low PR) and under-removal (low RR). When PR and RR are similar, F1 is close to their arithmetic mean. When they diverge strongly — for example OctoMap with PR ~30–77% and RR ~99.7% — F1 punishes the extreme over-remover even though RR appears very high.

Source: [ar5iv ERASOR 2103.04316](https://ar5iv.labs.arxiv.org/html/2103.04316).

### 2.2 Static Accuracy (SA), Dynamic Accuracy (DA), and Associated Accuracy (AA) — KTH / DUFOMap Lineage

The KTH DynamicMap Benchmark and papers from the KTH RPL lab (DUFOMap, BeautyMap) adopt a point-level variant:

```
SA = proportion of correctly labeled static points
   ≈ PR evaluated at point level (not voxel level) without
     downsampling the ground-truth map

DA = proportion of correctly labeled dynamic points
   ≈ RR at point level

AA = sqrt(SA * DA)   [geometric mean]
```

BeautyMap (RA-L 2024) introduces **HA (Harmonic Accuracy)** as an alternative to AA:

```
HA = 2 * SA * DA / (SA + DA)   [identical to F1 computed from SA and DA]
```

**Point-level vs. voxel-level.** Evaluating at point level without downsampling amplifies the contribution of dense map regions — e.g., slow-sweep segments where many scan sweeps land in the same static area. It makes numbers less sensitive to voxel-size choices but introduces density bias. The KTH group and DUFOMap explicitly state "point level without downsampling the ground-truth map" as their protocol. ERASOR uses voxel-wise 0.2 m. The two approaches are **not numerically equivalent**: SA/DA/AA values differ from PR/RR/F1 values even on the same dataset. Cross-paper comparisons between the two lineages must flag this distinction.

Source: [arXiv DUFOMap 2403.01449v2](https://arxiv.org/html/2403.01449v2); [arXiv BeautyMap 2405.07283v1](https://arxiv.org/html/2405.07283v1).

### 2.3 Static IoU and Dynamic IoU — MOS Task Lineage

The SemanticKITTI multi-scan (MOS) task reports:

```
IoU_static  = TP_static / (TP_static + FP_static + FN_static)
IoU_moving  = TP_moving  / (TP_moving  + FP_moving  + FN_moving)
mIoU        = (IoU_static + IoU_moving) / 2
```

HeLiMOS (IROS 2024) uses `IoU_MOS = TP / (TP + FP + FN)` for the moving class. The MOS IoU metric is **not** the same as PR or RR: it penalises both missed detections and false alarms simultaneously, whereas PR and RR treat each error direction independently. MOS IoU is the right metric for evaluating scan-level moving-object segmentors (LMNet, 4DMOS, MapMOS); PR/RR/F1 are the right metrics for evaluating static-map-building quality. The two can intersect: a MOS model used to generate "ground-truth" labels that feed a map-cleaning evaluation (as ERASOR2 does in HeLiMOS), but the metrics measure different things and should not be directly compared.

Source: [SemanticKITTI tasks](https://semantic-kitti.org/tasks.html); [arXiv HeLiMOS 2408.06328](https://arxiv.org/abs/2408.06328).

### 2.4 Ground-Truth Label Generation — Three Strategies

**Semantic-class-based (ERASOR lineage).** Use the existing SemanticKITTI per-point class labels. Moving-class IDs 252–259 are dynamic; everything else is static. No additional annotation is needed. Limitation: moving-class IDs capture objects that were moving at any point in the sequence; objects labelled with the static version of the same class (car = 10 vs. moving-car = 252) are treated as static even if briefly stationary. ERASOR uses exactly this split for sequences 00 (frames 4390–4530), 01 (150–250), 02 (860–950), 05 (2350–2670), and 07 (630–820).

**MOS-task-based (HeLiMOS / ERASOR2 lineage).** Use a MOS model or manual annotation to label each point at each scan as moving or static, tracked over multiple scans. A car static for 90% of the sequence but driving away in 10% accumulates both moving and static labels at different timestamps. This is more precise but requires either a trained MOS model (with its own errors) or expensive manual labeling.

**Manual annotation (KTH campus, Indoor).** Some KTH DynamicMap Benchmark datasets (KTH-Campus, Indoor-Floor) use human-labeled ground truth because no semantic segmentation ground truth exists. These are most accurate but non-scalable.

---

## 3. The Two Incompatible Metric Lineages

This is the most important practical warning on this page.

**Published dynamic-removal numbers are NOT directly comparable across the two lineages, even when the underlying dataset is the same.**

| Dimension | ERASOR lineage | KTH / DUFOMap lineage |
|---|---|---|
| Granularity | Voxel-wise, 0.2 m grid | Point-level, no downsampling |
| Aggregation | Count of clean/dynamic voxels | Count of correctly labelled points |
| Metric names | PR, RR, F1 | SA, DA, AA or HA |
| Evaluation script | ERASOR's own eval or per-paper scripts | KTH's `evaluate_all.py` (Python) + `export_eval_pcd` (C++) |
| Dynamic label source | SemanticKITTI moving-class IDs 252–259 | Same IDs for KITTI datasets; human labels for campus/indoor |
| Density bias | Downsampled — less bias | Raw point level — density-biased |
| Comparable to | ERASOR, ERASOR++, Removert (original), Raymoval, MapCleaner; FreeDOM only as an independent-evaluator reference | DUFOMap, BeautyMap, OctoMap w/ GF, Dynablox (KTH runs), DeFlow |

The effect is substantial and empirically visible. Compare ERASOR on KITTI seq 00 under each:

```
ERASOR voxel-wise (ERASOR paper):     PR=93.98%, RR=97.08%, F1=0.955
ERASOR point-level (DUFOMap paper):   SA=66.70%, DA=98.54%, AA=81.07%
```

These are the same method, same dataset, different metric lineages. The divergence (SA 66.70% vs. PR 93.98%) is not a contradiction — it reflects that the KTH point-level evaluation is density-weighted toward areas where many scans accumulate, and that the voxel-level evaluation compresses high-density regions before scoring. Neither is wrong; both are internally self-consistent.

**The practical implication:** do not claim "method A beats method B" by comparing a voxel-wise F1 from one paper against a point-level HA from another, even if both report results on KITTI seq 00.

**FreeDOM as a third independent case.** FreeDOM (RA-L 2025) uses its own voxel-wise evaluation scripts distinct from both ERASOR's original harness and the KTH benchmark pipeline. FreeDOM's numbers (KITTI seq 02 F1 = 99.59%, seq 07 F1 = 98.33%) were obtained with an independent setup. See §11.5 and the correction in §11.10 for details.

---

## 4. The KTH DynamicMap Benchmark

**Paper:** Qingwen Zhang, Daniel Duberg, Ruoyu Geng, Mingkai Jia, Lujia Wang, Patric Jensfelt. "A Dynamic Points Removal Benchmark in Point Cloud Maps." ITSC 2023 (7 pp, CC BY 4.0).

**Attribution note:** The lead author and first-named correspondent is **Qingwen Zhang**, not Daniel Adolfsson. An earlier informal internal KTH document associated with Adolfsson circulated before publication; the published ITSC 2023 benchmark paper is correctly attributed to Zhang et al.

- arXiv: [2307.07260](https://arxiv.org/abs/2307.07260)
- GitHub: [github.com/KTH-RPL/DynamicMap_Benchmark](https://github.com/KTH-RPL/DynamicMap_Benchmark)
- GitHub Pages (leaderboard/tutorial): [kth-rpl.github.io/DynamicMap_Benchmark/](https://kth-rpl.github.io/DynamicMap_Benchmark/)
- Affiliation: KTH Royal Institute of Technology, Stockholm (Daniel Duberg = senior; Patric Jensfelt = PI)

### 4.1 Evaluation Protocol

1. Download prepared datasets from Zenodo (includes pre-computed ground-truth labels).
2. Run any supported method using the provided shell scripts (`0_run_methods_all.sh`).
3. Run C++ utility `export_eval_pcd` to extract ground-truth labels from the clean map output — handles any internal downsampling a method may perform.
4. Run `scripts/py/eval/evaluate_all.py` to compute SA, DA, AA scores.
5. Optionally run `figure_plot.ipynb` for visualisations.

The benchmark scores at **point level without downsampling** — the KTH lineage metric (SA/DA/AA), not the ERASOR voxel-level PR/RR. It enforces single shared parameter sets across all datasets for each method, substantially reducing the method-favorable parameter-tuning pathology documented in earlier papers.

### 4.2 Datasets

| Dataset | LiDAR | Environment | GT type |
|---|---|---|---|
| Semantic-KITTI (seq 01, 05) | Velodyne HDL-64E | Outdoor small-town / highway | SemanticKITTI labels (moving-class IDs) |
| Argoverse 2.0 | Velodyne VLP-32C (+ 5-beam ring) | Outdoor US cities | AV2 semantic labels |
| UDI-Plane | Velodyne VLP-16 | Open plane / campus outdoor | Custom human labels |
| KTH-Campus | Leica RTC360 3D laser scanner | Multi-building outdoor campus | Human-labeled |
| Indoor-Floor | Livox mid-360 | Indoor multi-floor | Human-labeled |

Two additional datasets are listed as demo only with no ground truth in the benchmark. The benchmark is **continuously updated** — newer methods can be submitted for inclusion.

### 4.3 Methods in the Initial Release (8 total)

| Category | Methods |
|---|---|
| Online (no prior map) | OctoMap (ICRA 2010 / AR 2013), OctoMap w/ Ground Fitting (ITSC 2023), Dynablox (RA-L 2023), DUFOMap (RA-L 2024) |
| Learning-based | DeFlow (ICRA 2024) |
| Offline (requires prior map) | ERASOR (RA-L 2021), Removert (IROS 2020), BeautyMap (RA-L 2024) |

### 4.4 Reproducibility Significance

The KTH benchmark paper explicitly documents the pre-benchmark practice of each method selecting its own parameter settings on the evaluation data, then reporting those as "published results." Refactored methods in the benchmark use a single shared parameter set across all datasets. As a consequence, KTH benchmark numbers for ERASOR, Removert, and OctoMap sometimes differ from the numbers in those methods' original papers — the original papers reported method-favorable parameters, while the KTH benchmark uses standardised parameters.

This partially explains the observable discrepancy between ERASOR's self-reported F1 (0.955 on seq 00) and the SA/DA/AA numbers from DUFOMap's evaluation (ERASOR SA=66.70, DA=98.54, AA=81.07 on seq 00). The two numbers are not contradictory; they reflect different metric choices and potentially different parameter settings.

---

## 5. SemanticKITTI Dynamic-Map Sequences

**Source:** Behley et al., "SemanticKITTI: A Dataset for Semantic Scene Understanding of LiDAR Sequences," ICCV 2019.

**Sensor:** Velodyne HDL-64E (64 channel, 10 Hz, ~120k points/scan). Sequences 00–10 have public labels; 11–21 have withheld test labels (used for the online MOS task leaderboard).

### 5.1 De-Facto Canonical Evaluation Sequences

The following five sub-sequences were selected by the ERASOR authors because they contain frequent dynamic actors in varied environments. They are now the de-facto canonical test set for offline dynamic-removal benchmarking.

| Sequence | Frame range | Environment |
|---|---|---|
| 00 | 4390–4530 | Small-town intersections, heavy pedestrian and vehicle traffic |
| 01 | 150–250 | Highway, high-speed vehicles, vegetation corridor |
| 02 | 860–950 | Suburban street, moderate traffic |
| 05 | 2350–2670 | Small town, heavier traffic, complex intersections |
| 07 | 630–820 | Rural road, mix of vehicles and sparse pedestrians |

### 5.2 Ground-Truth Label Derivation

SemanticKITTI assigns each point a single semantic label per scan. Moving-object classes carry IDs 252–259 (moving variants of car, bicyclist, person, motorcyclist, on-rails, bus, truck, other-vehicle). The ERASOR benchmark accumulates all scans in a sequence sub-window, assigns "dynamic" to any point whose label falls in {252–259}, and "static" to everything else. The accumulated raw map is the input; the evaluation measures what fraction of each label set was correctly handled.

**SemanticKITTI sequences 00–07 are used for dynamic-map evaluation** because their ground-truth labels are public. The MOS task test set (sequences 11–21) withholds labels; methods are evaluated by IoU_MOS via the SemanticKITTI submission server on Codalab.

---

## 6. HeLiMOS — Heterogeneous-LiDAR MOS Benchmark

**Paper:** Hyungtae Lim, Seoyeon Jang, Benedikt Mersch, Jens Behley, Hyun Myung, Cyrill Stachniss. "HeLiMOS: A Dataset for Moving Object Segmentation in 3D Point Clouds From Heterogeneous LiDAR Sensors." IROS 2024.

- arXiv: [2408.06328](https://arxiv.org/abs/2408.06328)
- GitHub: [github.com/url-kaist/HeLiMOS-PointCloud-Toolbox](https://github.com/url-kaist/HeLiMOS-PointCloud-Toolbox)
- Affiliations: KAIST (Lim, Jang, Myung) + University of Bonn (Mersch, Behley, Stachniss)

### 6.1 Dataset Composition

All four sensors are synchronized on the same platform on the KAIST05 sequence from the HeLiPR dataset (urban setting with revisited scenes). Total: **12,188 labeled point clouds** across 4 sensors. Train/Val/Test split: 68% / 16% / 16% sequential. Dynamic-point ratio: approximately 9–16% per sensor, substantially higher than SemanticKITTI's 1–4%.

| Sensor | Type | Channels | Scan pattern |
|---|---|---|---|
| Ouster OS2-128 (O) | Omnidirectional spinning | 128 | Regular |
| Velodyne VLP-16 (V) | Omnidirectional spinning | 16 | Regular |
| Livox Avia (L) | Solid-state | — | Irregular non-repetitive |
| Aeva Aeries II (A) | Solid-state | — | Narrow FoV |

### 6.2 Labeling Pipeline

Four-stage semi-automatic labeling:

1. Topology-based trajectory clustering + pose correction (submap ICP).
2. Instance-aware initial annotation using ERASOR2 "cluster-then-detect."
3. Tracking-based false-label filtering with bounding-box augmentation (reduces false negatives via interpolation).
4. Human-in-the-loop refinement.

### 6.3 The Cross-Sensor Generalisation Gap

HeLiMOS reveals a critical failure mode for MOS models trained on the 64-channel SemanticKITTI scanner: performance collapses on the Velodyne VLP-16 (16-channel, sparse). Published results for models trained on SemanticKITTI and evaluated across sensors (Table 2, mean IoU per sensor):

| Method | Livox (L) | Aeva (A) | Ouster (O) | Velodyne (V) | Total |
|---|---|---|---|---|---|
| 4DMOS online | 52.08% | 54.01% | 64.17% | 4.69% | 43.74% |
| 4DMOS delayed | 58.99% | 58.30% | 70.44% | 5.41% | 48.28% |
| MapMOS Scan | 58.93% | 63.15% | 81.43% | 4.33% | 51.96% |
| MapMOS Volume | 62.70% | 66.58% | 82.87% | 5.77% | 54.48% |

IoU_MOS on the Velodyne VLP-16 drops from ~81% (Ouster OS2-128) to ~5% — a near-total failure. This generalisation gap is the primary motivating result of the HeLiMOS paper. Solid-state LiDARs (Livox Avia, Aeva) also show degraded performance, though less severe than VLP-16, because their irregular scan patterns are incompatible with range-image-based methods trained on rotating spinners.

**Significance for the airside domain:** airport ground support tends to involve lower-cost or lighter-weight LiDARs (solid-state and 16-channel spinners), the exact sensors where SemanticKITTI-trained models degrade most.

### 6.4 Static Map Building Quality (HeLiMOS Crowded Sequences)

HeLiMOS also reports ERASOR-lineage PR/RR/F1 for static map building quality (Table 5), using ERASOR2 vs. ERASOR vs. Removert:

| Frames | Method | PR [%] | RR [%] | F1 |
|---|---|---|---|---|
| 2250–2500 | Removert | 85.07 | 47.17 | 0.607 |
| 2250–2500 | ERASOR | 95.33 | 82.49 | 0.884 |
| 2250–2500 | ERASOR2 | 99.52 | 95.34 | 0.974 |
| 8600–8800 | Removert | 80.58 | 71.97 | 0.760 |
| 8600–8800 | ERASOR | 91.61 | 84.29 | 0.878 |
| 8600–8800 | ERASOR2 | 99.53 | 93.74 | 0.965 |
| 11070–11300 | Removert | 82.85 | 81.30 | 0.821 |
| 11070–11300 | ERASOR | 93.97 | 89.96 | 0.919 |
| 11070–11300 | ERASOR2 | 99.68 | 97.18 | 0.984 |

These HeLiMOS map-building experiments use ERASOR-lineage PR/RR/F1 and are therefore directly comparable to the SemanticKITTI PR/RR results in §10.1–10.2, but NOT to the KTH point-level SA/DA/AA in §10.3.

FreeDOM (RA-L 2025) used HeLiMOS Ouster as a secondary evaluation dataset (PR 98.28%, RR 96.05%, F1 97.15% on Ouster; see §10.5).

---

## 7. MOS Benchmarks Adjacent to Dynamic Removal

| Benchmark | Task | Metric | Primary sequences |
|---|---|---|---|
| SemanticKITTI multi-scan MOS | Per-point moving/static prediction, single scan + N history | IoU_MOS (moving class) | Seq 11–21 (test, withheld) |
| HeLiMOS IROS 2024 | Per-point MOS across 4 heterogeneous sensors | IoU_MOS per sensor, cross-sensor generalisation | KAIST05 subset |
| LiDAR-MOS (LMNet, RA-L/IROS 2021) | Range-image residual-based MOS training benchmark | IoU_MOS | SemanticKITTI 00–10 (train) / 11–21 (test) |

**Where MOS and map-cleaning evaluation overlap:**

- Both require a ground-truth label for each point as "moving" or "static."
- Both use the SemanticKITTI moving-class IDs (252–259) as the canonical dynamic label.
- A MOS segmentor (4DMOS, MapMOS) can be used upstream of map accumulation to generate a pre-cleaned map, which then skips separate offline cleaning — the "online pre-removal" pattern.

**Where they diverge:**

| Dimension | MOS task | Map-cleaning task |
|---|---|---|
| Input | One scan (+ optional history) | Full accumulated map |
| Output | Per-point moving/static mask per frame | Clean static map |
| Metric | IoU_MOS | PR / RR / F1 (or SA / DA / AA) |
| Future evidence available | No | Yes (offline) |
| Failure mode | Misses stationary-but-moving objects | Leaves ghost trails; over-removes structure |

A method that scores high on IoU_MOS (good online detector) may not produce a clean map because ghost trails accumulate from imperfect per-frame labeling. Conversely, an offline cleaner like ERASOR can achieve high PR/RR on the accumulated map even without per-frame labeling capability.

---

## 8. Leaderboards and Reproducibility Tools

**KTH DynamicMap Benchmark:**
- GitHub: [github.com/KTH-RPL/DynamicMap_Benchmark](https://github.com/KTH-RPL/DynamicMap_Benchmark)
- GitHub Pages: [kth-rpl.github.io/DynamicMap_Benchmark/](https://kth-rpl.github.io/DynamicMap_Benchmark/)
- Data hosted on Zenodo (linked from the README download section).
- Evaluation scripts: `scripts/py/eval/evaluate_all.py` (Python); `export_eval_pcd` (C++ utility for GT label extraction).
- No separate Paperwithcode or external leaderboard identified; ranking is maintained in the GitHub README and GitHub Pages site.

**SemanticKITTI MOS submission server:**
- [semantic-kitti.org/tasks.html](https://semantic-kitti.org/tasks.html) — test-set IoU_MOS ranking for online MOS methods.

**HeLiMOS toolbox:**
- [github.com/url-kaist/HeLiMOS-PointCloud-Toolbox](https://github.com/url-kaist/HeLiMOS-PointCloud-Toolbox) — data processing software and labeling pipeline code.

**Reproducibility issues in the field.** The KTH benchmark paper explicitly addresses the pre-benchmark practice of each method selecting its own parameter settings on the evaluation data, then reporting those as "published results." The refactored methods in the benchmark use a single shared parameter set across all datasets. The consequence is that KTH benchmark numbers for ERASOR, Removert, and OctoMap sometimes differ from those methods' original papers. Any method comparison between KTH-benchmarked numbers and original-paper numbers must flag the parameter setting difference.

---

## 9. Over-Removal vs. Under-Removal Trade-off

**The PR–RR trade-off:** every dynamic-removal method operates on a threshold. Lower the threshold → more points removed → RR rises (fewer dynamic ghosts) but PR falls (more static structure eroded). Raise the threshold → PR rises (structure preserved) but RR falls (more ghosts remain). No method simultaneously maximises both; there is no free-lunch operating point.

**OctoMap as the canonical over-remover.** OctoMap's probabilistic log-odds model tends to flag any voxel whose occupancy dips below the threshold as free. On seq 00 it achieves RR approximately 99.7% (removes essentially all dynamic points) but PR approximately 30–68% (removes most of the static structure too). Its F1 approximately 0.46–0.87 depending on sequence. This makes OctoMap unsuitable as a map-cleaning method for localization maps but demonstrates that RR alone is an inadequate metric.

**Removert as the canonical under-remover on complex sequences.** Removert achieves very high SA/PR (≥97%) on most sequences but DA/RR as low as 22–41% on sequences 00 and 05 (DUFOMap evaluation). Range-image projection artifacts near object boundaries cause false-negative dynamic classifications. Its F1 / HA is therefore low despite excellent static preservation.

**F1 as de-facto single-number ranking.** F1 (equivalent to HA when SA≈PR and DA≈RR) is the standard ranking number. Its limitation: it treats over-removal (low PR) and under-removal (low RR) as equally bad. For a localization map, over-removal of rare geometric features — poles, pillars, curb edges, airside markings — is more damaging than the equal-F1 implication, because localization degeneracy is driven by loss of specific geometric features rather than bulk point counts. A per-class PR breakdown (PR for poles, PR for ground, PR for walls) would be more safety-informative but is not yet standard in published benchmarks.

**Operating point reporting.** When a new method is reported, the PR–RR trade-off curve should be reported across the full threshold range, not just at a single operating point. The KTH benchmark does not yet enforce this; most papers report a single best operating point. ERASOR's sensitivity analysis (reported in the original paper) shows sharper PR increment at low threshold and sharper RR decrement at high threshold, confirming the non-linear sensitivity.

---

## 10. The Static-But-Transient Gap in Current Benchmarks

**What current benchmarks measure.** KTH DynamicMap, HeLiMOS, and SemanticKITTI dynamic-map evaluation all measure **intra-scan dynamic objects** — objects that moved (or were moving) within the accumulation window of a single survey session. A map point is "dynamic" only if a LiDAR ray from within the same session confirmed the voxel was later empty. Methods are scored on how well they remove these intra-session ghost trails.

**What they do not measure.** Objects that were **stationary for the entire survey session** but are temporary over calendar time:

- A belt loader parked at a gate for a 6-hour survey.
- Staged ground-support equipment (GSE) — GPU carts, chocks, stairs — that will not be there next week.
- Stationary maintenance crew on an apron.
- Snow or debris accumulation between surveys.
- Parked aircraft on remote stands during a maintenance window.

These objects accumulate as dense, geometrically consistent clusters. Every classical dynamic-removal method — ERASOR, Removert, Dynablox, FreeDOM, DUFOMap — treats them as static and retains them in the permanent map layer. No false-positive is generated from the perspective of intra-scan visibility evidence.

**No public multi-session transient-removal benchmark exists** as of 2026-05. The closest adjacent work:

- LT-Mapper (ICRA 2022): multi-session lifelong mapping with low-dynamic change detection, validated at year-level temporal gaps on urban campus sequences ([arXiv 2107.07712](https://arxiv.org/abs/2107.07712)).
- ELite (ICRA 2025): ephemerality-score-based lifelong mapping with temporal evidence propagation.
- MS-Mapping (ICRA@40, 2024): multi-session LiDAR mapping with BeautyMap integration for lifelong dynamic removal.
- These are road/campus datasets; no airside (apron, taxiway, gate) multi-session ground truth exists.

**Airside has zero benchmark coverage.** The absence is not incidental — airside operations involve the exact static-but-transient objects (parked aircraft, staged GSE) that current benchmarks exclude by design. Any method claiming airside-readiness must be evaluated on airside-specific multi-session data with explicit annotation of known-transient objects.

**Cross-reference:** `../../perception/overview/static-but-transient-point-removal.md` is the dedicated deep dive on this problem and its candidate solutions. The hub page `aggregated-map-semantic-segmentation.md` §9.1 treats this gap as an unresolved prerequisite.

---

## 11. Reported Numbers Across Methods

**Important caveat before reading this table.** The numbers below come from multiple papers using different metric lineages (§3). ERASOR-lineage numbers (PR/RR/F1, voxel-wise) in §11.1, §11.2, §11.5–11.8 are **not** directly comparable to KTH-lineage numbers (SA/DA/AA or HA, point-level) in §11.3–11.4. FreeDOM uses a third independent evaluation script (§11.5, §11.10).

### 11.1 SemanticKITTI — ERASOR Lineage (Voxel-wise PR / RR / F1)

From ERASOR (RA-L 2021) original paper (5 sequences, 0.2 m voxel). Source: [ar5iv 2103.04316](https://ar5iv.labs.arxiv.org/html/2103.04316), Table II.

| Seq | Method | PR [%] | RR [%] | F1 |
|---|---|---|---|---|
| 00 | OctoMap (voxel 0.05) | 76.73 | 99.12 | 0.865 |
| 00 | OctoMap (voxel 0.20) | 34.57 | 99.98 | 0.514 |
| 00 | Peopleremover | 37.52 | 89.12 | 0.528 |
| 00 | Removert (RM3) | 85.50 | 99.35 | 0.919 |
| 00 | Removert (RM3+RV1) | 86.83 | 90.62 | 0.887 |
| 00 | ERASOR | 93.98 | 97.08 | 0.955 |
| 01 | OctoMap (0.05) | 53.16 | 99.66 | 0.693 |
| 01 | OctoMap (0.20) | 20.78 | 99.86 | 0.344 |
| 01 | Peopleremover | 36.35 | 93.12 | 0.523 |
| 01 | Removert (RM3) | 94.22 | 93.61 | 0.939 |
| 01 | Removert (RM3+RV1) | 95.82 | 57.08 | 0.715 |
| 01 | ERASOR | 91.49 | 95.38 | 0.934 |
| 02 | OctoMap (0.05) | 54.11 | 98.77 | 0.699 |
| 02 | OctoMap (0.20) | 23.75 | 99.79 | 0.384 |
| 02 | Peopleremover | 29.04 | 94.53 | 0.444 |
| 02 | Removert (RM3) | 76.32 | 96.80 | 0.853 |
| 02 | Removert (RM3+RV1) | 83.29 | 88.37 | 0.858 |
| 02 | ERASOR | 87.73 | 97.01 | 0.921 |
| 05 | OctoMap (0.05) | 76.34 | 96.79 | 0.854 |
| 05 | OctoMap (0.20) | 33.90 | 99.88 | 0.506 |
| 05 | Peopleremover | 38.50 | 90.63 | 0.540 |
| 05 | Removert (RM3) | 86.90 | 87.88 | 0.874 |
| 05 | Removert (RM3+RV1) | 88.17 | 79.98 | 0.839 |
| 05 | ERASOR | 88.73 | 98.26 | 0.933 |
| 07 | OctoMap (0.05) | 77.84 | 96.94 | 0.863 |
| 07 | OctoMap (0.20) | 38.18 | 99.57 | 0.552 |
| 07 | Peopleremover | 34.77 | 91.98 | 0.505 |
| 07 | Removert (RM3) | 80.69 | 98.82 | 0.888 |
| 07 | Removert (RM3+RV1) | 82.04 | 95.50 | 0.883 |
| 07 | ERASOR | 90.62 | 99.27 | 0.948 |

### 11.2 ERASOR++ vs. ERASOR — SemanticKITTI (Voxel-wise PR / RR / F1)

From ERASOR++ (arXiv 2403.05019, 2024). Source: [arXiv 2403.05019v1](https://arxiv.org/html/2403.05019v1).

Note: ERASOR numbers in the ERASOR++ paper differ slightly from the ERASOR original paper. This is consistent with the reproducibility issue (§8) — re-evaluation with updated scripts or different parameter settings produces slightly different PR/RR values.

| Seq | Method | PR [%] | RR [%] | F1 |
|---|---|---|---|---|
| 00 | ERASOR | 92.15 | 97.21 | 0.946 |
| 00 | ERASOR++ | 96.83 | 96.10 | 0.965 |
| 01 | ERASOR | 91.90 | 94.56 | 0.932 |
| 01 | ERASOR++ | 98.99 | 93.64 | 0.962 |
| 02 | ERASOR | 80.90 | 99.20 | 0.891 |
| 02 | ERASOR++ | 87.89 | 98.90 | 0.931 |
| 05 | ERASOR | 86.96 | 97.92 | 0.921 |
| 05 | ERASOR++ | 96.53 | 97.67 | 0.971 |
| 07 | ERASOR | 93.48 | 98.89 | 0.961 |
| 07 | ERASOR++ | 98.58 | 98.65 | 0.986 |

### 11.3 KTH DynamicMap Benchmark — SA / DA / AA (Point-level, DUFOMap Paper)

From DUFOMap (RA-L 2024, arXiv 2403.01449v2), Table I, across 4 datasets. Source: [arXiv 2403.01449v2](https://arxiv.org/html/2403.01449v2).

**These are KTH-lineage point-level numbers. Do not compare to §11.1 PR/RR/F1.**

| Dataset | Method | SA [%] | DA [%] | AA [%] |
|---|---|---|---|---|
| KITTI 00 | Removert | 99.44 | 41.53 | 64.26 |
| KITTI 00 | ERASOR | 66.70 | 98.54 | 81.07 |
| KITTI 00 | OctoMap | 68.05 | 99.69 | 82.37 |
| KITTI 00 | Dynablox | 96.76 | 90.68 | 93.67 |
| KITTI 00 | **DUFOMap** | **97.96** | **98.72** | **98.34** |
| KITTI 01 | Removert | 97.81 | 39.56 | 62.20 |
| KITTI 01 | ERASOR | 98.12 | 90.94 | 94.46 |
| KITTI 01 | OctoMap | 55.55 | 99.59 | 74.38 |
| KITTI 01 | Dynablox | 96.33 | 68.01 | 80.94 |
| KITTI 01 | **DUFOMap** | **98.09** | **94.20** | **96.12** |
| AV2 | Removert | 98.97 | 31.16 | 55.53 |
| AV2 | ERASOR | 77.51 | 99.18 | 87.68 |
| AV2 | OctoMap | 69.04 | 97.50 | 82.04 |
| AV2 | Dynablox | 96.08 | 92.87 | 94.46 |
| AV2 | **DUFOMap** | **96.67** | **88.90** | **92.70** |
| Semi-Indoor | Removert | 99.96 | 12.15 | 34.85 |
| Semi-Indoor | ERASOR | 94.90 | 66.26 | 79.30 |
| Semi-Indoor | OctoMap | 88.97 | 82.18 | 85.51 |
| Semi-Indoor | Dynablox | 98.81 | 36.49 | 60.05 |
| Semi-Indoor | **DUFOMap** | **99.64** | **83.00** | **90.94** |

### 11.4 BeautyMap — SA / DA / HA (Point-level, BeautyMap Paper)

From BeautyMap (RA-L 2024, arXiv 2405.07283), Table I. Source: [arXiv 2405.07283v1](https://arxiv.org/html/2405.07283v1).

**These are KTH-lineage point-level numbers. Do not compare to §11.1–11.2 PR/RR/F1.**

Note: 4DMOS and MapMOS (data-driven, trained on KITTI seqs 0–10) were not evaluated on KITTI 00, 01, 05 to avoid evaluation-on-training-data bias.

| Dataset | Method | SA [%] | DA [%] | HA [%] |
|---|---|---|---|---|
| KITTI 00 | Removert | 99.44 | 41.53 | 58.59 |
| KITTI 00 | ERASOR | 66.70 | 98.54 | 79.55 |
| KITTI 00 | OctoMap | 68.05 | 99.69 | 80.89 |
| KITTI 00 | OctoMap w/ GF | 93.06 | 98.67 | 95.78 |
| KITTI 00 | Dynablox | 96.76 | 90.68 | 93.62 |
| KITTI 00 | DeFlow | 99.43 | 81.68 | 89.69 |
| KITTI 00 | **BeautyMap** | **96.76** | **98.38** | **97.56** |
| KITTI 01 | Removert | 97.81 | 39.56 | 56.33 |
| KITTI 01 | ERASOR | 98.12 | 90.94 | 94.39 |
| KITTI 01 | OctoMap | 55.55 | 99.60 | 71.28 |
| KITTI 01 | OctoMap w/ GF | 80.64 | 97.27 | 88.18 |
| KITTI 01 | Dynablox | 96.33 | 68.01 | 79.73 |
| KITTI 01 | DeFlow | 99.19 | 81.25 | 89.33 |
| KITTI 01 | **BeautyMap** | **99.17** | **92.99** | **95.98** |
| KITTI 05 | Removert | 99.42 | 22.28 | 36.40 |
| KITTI 05 | ERASOR | 69.40 | 99.06 | 81.62 |
| KITTI 05 | OctoMap | 66.28 | 99.24 | 79.48 |
| KITTI 05 | OctoMap w/ GF | 93.54 | 92.48 | 93.01 |
| KITTI 05 | Dynablox | 97.80 | 88.68 | 93.02 |
| KITTI 05 | DeFlow | 99.48 | 50.85 | 67.30 |
| KITTI 05 | **BeautyMap** | **96.34** | **98.29** | **97.31** |
| Semi-Indoor | ERASOR | 94.90 | 66.26 | 78.04 |
| Semi-Indoor | OctoMap | 88.97 | 82.18 | 85.44 |
| Semi-Indoor | OctoMap w/ GF | 96.79 | 73.50 | 83.55 |
| Semi-Indoor | Dynablox | 98.81 | 36.49 | 53.30 |
| Semi-Indoor | **BeautyMap** | **93.69** | **90.67** | **92.16** |

### 11.5 FreeDOM — PR / RR / F1 (Voxel-wise, Independent Evaluation Script)

From FreeDOM (RA-L 2025, arXiv 2504.11073), Table I and Table II. Source: [arXiv 2504.11073v1](https://arxiv.org/html/2504.11073v1).

**Important: FreeDOM was NOT evaluated using the KTH DynamicMap Benchmark framework.** FreeDOM uses its own voxel-wise evaluation scripts, independent of both the ERASOR original harness and the KTH pipeline. Numbers below are not KTH-benchmarked. See §11.10 for the explicit correction.

Primary results:

| Dataset | Method | PR [%] | RR [%] | F1 [%] |
|---|---|---|---|---|
| KITTI seq 02 | FreeDOM | 99.50 | 99.69 | 99.59 |
| KITTI seq 07 | FreeDOM | 98.76 | 97.90 | 98.33 |
| HeLiMOS Ouster | FreeDOM | 98.01 | 95.74 | 96.86 |
| Corridor (indoor) | FreeDOM | 99.59 | 98.57 | 99.08 |
| Stairs (indoor) | FreeDOM | 99.48 | 95.11 | 97.25 |

Cross-sensor results (Table II):

| LiDAR | PR [%] | RR [%] | F1 [%] |
|---|---|---|---|
| Ouster (dense 128ch) | 98.28 | 96.05 | 97.15 |
| Velodyne (sparse 16ch) | 98.50 | 83.97 | 90.66 |
| Livox (non-repetitive solid-state) | 97.85 | 92.78 | 95.25 |
| Aeva (narrow FoV solid-state) | 97.34 | 90.02 | 93.54 |

FreeDOM's VLP-16 F1 of 90.66% is substantially better than MOS models on HeLiMOS VLP-16 (IoU_MOS ~5%) — because FreeDOM is a geometric free-space method rather than a range-image learned model, it degrades more gracefully across sensor densities.

### 11.6 [Raymoval](raymoval.md) — PR / RR / F1 (SemanticKITTI)

From Raymoval (RiTA 2025 / arXiv 2605.08937, submitted 2026), Table 2. Source: [arXiv 2605.08937v1](https://arxiv.org/html/2605.08937v1).

| Seq | Method | PR [%] | RR [%] | F1 |
|---|---|---|---|---|
| 00 | ERASOR | 93.980 | 97.081 | 0.955 |
| 00 | Raymoval | 94.046 | 90.428 | 0.922 |
| 01 | ERASOR | 91.487 | 95.383 | 0.934 |
| 01 | Raymoval | 91.854 | 92.051 | 0.920 |
| 02 | ERASOR | 87.731 | 97.008 | 0.921 |
| 02 | Raymoval | 95.144 | 93.181 | 0.942 |
| 05 | ERASOR | 88.730 | 98.262 | 0.933 |
| 05 | Raymoval | 93.394 | 95.636 | 0.945 |
| 07 | ERASOR | 90.624 | 99.271 | 0.948 |
| 07 | Raymoval | 91.645 | 91.534 | 0.916 |
| Avg (5 seqs) | ERASOR | 90.510 | 97.401 | 0.938 |
| Avg (5 seqs) | Raymoval | 93.217 | 92.566 | 0.927 |

Summary: Raymoval improves PR over ERASOR on all five tested segments, but has lower average RR and lower average F1; it wins F1 on seq 02 and 05 only. Table 3 reports 93.83 ms/scan on one Intel Core i9-13900 CPU thread, with raycasting cache about 92.9% of runtime.

### 11.7 MapCleaner

MapCleaner (Remote Sensing 2022, Fu, Xue, Xie) reports PR/RR/score on the same five SemanticKITTI dynamic-map windows used by the ERASOR lineage. These numbers come from MapCleaner's self-evaluation, not the later KTH benchmark.

| Seq | PR [%] | RR [%] | Score |
|---|---|---|---|
| 00 | 98.89 | 98.18 | 0.9853 |
| 01 | 99.74 | 94.98 | 0.9730 |
| 02 | 99.37 | 99.03 | 0.9920 |
| 05 | 99.14 | 97.92 | 0.9852 |
| 07 | 98.98 | 97.25 | 0.9811 |

The MDPI HTML version exposes Table 2, so these values are now directly source-backed. They should still be treated as a 2022 self-evaluation because MapCleaner is not included in the KTH DynamicMap Benchmark method list.

### 11.8 DR-Remover

DR-Remover ("DR-REMOVER: An Efficient Dynamic Object Remover Using Dual-Resolution Occupancy Grids for Constructing Static Point Cloud Maps") — IEEE Transactions on Intelligent Vehicles 2024, Zhang Guangyi et al. Evaluated on KITTI and Apollo datasets, not the SemanticKITTI canonical sequences specifically. GitHub: [github.com/zhongbusishaonianyou/DR-REMOVER](https://github.com/zhongbusishaonianyou/DR-REMOVER). Specific PR/RR/F1 numbers on SemanticKITTI sequences 00–07 were not found in public sources; the paper is in T-IV (paywalled). Flagged as uncertain — DR-Remover may use its own evaluation datasets rather than the canonical sequences.

### 11.9 BTSA ("Breaking the Static Assumption")

BTSA (arXiv 2510.22313, accepted Oct 2025) is a **dynamic-aware LIO framework** (odometry + mapping), not a standalone map-cleaning method. It reports SA / DA / HA metrics for static map building quality, compared against BeautyMap, DUFOMap, MCDOD, Dynablox, and OTD on ECMD / UrbanNav / GEODE / HeLiMOS datasets. It does **not** evaluate on SemanticKITTI. Its primary contribution is odometry accuracy in dynamic environments; the map-cleaning evaluation is secondary. Source: [arXiv 2510.22313v1](https://arxiv.org/html/2510.22313v1).

### 11.10 FreeDOM — KTH Benchmark Correction

**FreeDOM was not evaluated under the KTH DynamicMap Benchmark framework.** The FreeDOM paper (RA-L 2025) uses its own voxel-wise evaluation scripts and does not cite or invoke the KTH benchmark pipeline. Its KITTI sequence 02 and 07 results (F1 99.59% and 98.33%) were obtained with an independent evaluation setup. These must not be presented as "KTH-benchmarked" numbers. As of 2026-05, FreeDOM does not appear in the KTH GitHub methods list or benchmark results table.

### 11.11 DynPurge — Metadata-Verified Watchlist Only

DynPurge ("Dynamic Point Removal via Spatiotemporal Distribution Range in Global-Scale LiDAR Maps") has a verified IEEE RA-L 2025 bibliographic record, DBLP record, and a public supplementary GitHub repository. The accessible sources describe evaluation on SemanticKITTI, MCD, and Argoverse 2 and frame the method around timestamp-distribution differences between static and dynamic map points. The public repository contains only README text, pseudocode imagery, and qualitative result images; it does not provide runnable code, releases, a license, numeric tables, metric definitions, or benchmark scripts.

Do not insert DynPurge into the quantitative comparison tables yet. Its abstract-level "classification accuracy" and efficiency claims are not enough to determine whether the reported values are voxel-wise PR/RR/F1, point-level SA/DA/AA/HA, MOS IoU, or a private classification metric. It becomes table-eligible only after full paper access or public artifacts expose dataset windows, label derivation, evaluation granularity, baselines, and metric formulas.

---

## 12. For Aggregated-LiDAR-Map Segmentation

This benchmark page is the **evaluation reference** for the following repo pages:

- **Hub:** `lidar-map-cleaning-dynamic-removal.md` — method-family overview linking back here for metric definitions and the comparative table.
- **Segmentation companion:** `../../perception/overview/aggregated-map-semantic-segmentation.md` §9.1 (dynamic removal as non-optional preprocessing).
- **Individual method pages** (each should link here for standard metric definitions):
  - `beautymap.md` — BeautyMap (RA-L 2024), binary-encoded ground matrix and SA/DA/HA in §11.4
  - `erasor.md` — ERASOR (RA-L 2021), SemanticKITTI PR/RR/F1 in §11.1
  - `erasor-plus-plus.md` — ERASOR++ (arXiv 2024), numbers in §11.2
  - Removert — numbers in §11.1 and §11.3
  - Dynablox — SA/DA/AA in §11.3–11.4
  - DUFOMap — numbers in §11.3
  - `mapcleaner.md` — MapCleaner (Remote Sensing 2022), see §11.7
  - `dr-remover.md` — DR-Remover (T-IV 2024), see §11.8
  - `freedom-dynamic-object-removal.md` — FreeDOM (RA-L 2025), numbers in §11.5; **not KTH-benchmarked**
  - `raymoval.md` — Raymoval (RiTA 2025 / arXiv 2026), numbers in §11.6
  - DynPurge — watchlist-only; see §11.11 before adding any metric row
  - BTSA (if created) — see §11.9

**Key metric-definition cross-links:**
- PR / RR / F1 (voxel-wise): §2.1 (ERASOR lineage)
- SA / DA / AA / HA (point-level): §2.2 (KTH / DUFOMap lineage)
- IoU_MOS: §2.3 (MOS task)
- Ground-truth label derivation: §2.4
- The two incompatible lineages: §3
- Static-but-transient gap: §10 and `../../perception/overview/static-but-transient-point-removal.md`

---

## Dataset / Benchmark Table

| Benchmark / method | Source URL | Scope | Evaluation style | Best use | Main transfer risk |
|---|---|---|---|---|---|
| KTH Dynamic Map Benchmark | https://kth-rpl.github.io/DynamicMap_Benchmark/ | Unified dynamic-point removal benchmark for point-cloud maps; includes KITTI, Argoverse 2, KTH campus, semi-indoor, and two-floor sequences | Methods output clean maps; evaluation extracts labels from the output cloud and compares against labeled ground truth using point-level SA/DA/AA | Reproducible comparison across offline and online cleaners: OctoMap variants, ERASOR, Removert, Dynablox, DUFOMap, BeautyMap, DeFlow | Some sequences have no ground truth; road/campus/semi-indoor data does not capture aircraft-scale movable objects |
| ERASOR | https://github.com/LimHyungTae/ERASOR | Egocentric pseudo-occupancy ratio and ground-aware refinement for static 3D map building | Voxel-wise PR/RR/F1 on SemanticKITTI-derived labels (ERASOR lineage) | Strong explainable offline baseline for removing dynamic traces while preserving ground | Pose error, sparse scan patterns, and ground-plane assumptions can erode ramps, curbs, low objects, or aircraft gear |
| Removert | https://github.com/gisbi-kim/removert | Multiresolution range-image remove-then-revert map construction | Validated on KITTI using SemanticKITTI labels as dynamic/static ground truth | Complementary baseline that explicitly recovers likely false removals | Requires good poses and projection parameters; parked objects seen consistently can remain static |
| HeLiMOS | https://github.com/url-kaist/HeLiMOS-PointCloud-Toolbox | Heterogeneous 4-sensor MOS benchmark (Ouster 128ch, Velodyne VLP-16, Livox Avia, Aeva Aeries II) | IoU_MOS per sensor + PR/RR/F1 for map building quality (ERASOR lineage) | Cross-sensor generalisation testing; reveals collapse on sparse/solid-state LiDARs | VLP-16 and solid-state results are not interchangeable with HDL-64E-based SemanticKITTI numbers |
| MapCleaner | https://www.mdpi.com/2072-4292/14/18/4496 | Terrain modeling plus local-observation voting for moving-point identification | Reports PR, RR, and F1 on SemanticKITTI sequences 00, 01, 02, 05, 07 | Learning-free map cleaning with explicit terrain/object separation | Terrain model can fail on non-road surfaces, overhangs, ramps, and apron equipment |

---

## Validation Guidance

1. Benchmark at least ERASOR, Removert, and MapCleaner on the same input maps before selecting a default cleaner.
2. Use the KTH benchmark pipeline when comparing online methods (OctoMap variants, Dynablox, DUFOMap) to offline methods — it is the only framework that evaluates both categories under shared parameters.
3. Do not mix ERASOR-lineage and KTH-lineage numbers in the same comparison table without explicitly flagging the lineage difference.
4. Preserve raw scans, poses, and rejected points. A production map package should be auditable back to the source observations and cleaner decisions.
5. Run cleaning on both quiet survey passes and busy operational passes. A cleaner that only works on sparse dynamics is not enough for aircraft stands.
6. Compare localization on raw, cleaned, and over-cleaned maps. Reject a cleaner if the map looks cleaner but localization residuals, degeneracy, or relocalization failures worsen.
7. Keep movable-static objects in a separate quarantine layer until cross-session evidence decides whether they are persistent infrastructure, temporary equipment, or dynamic clutter.
8. For airside deployment: report results on your local multi-session dataset with explicit transient-object annotation. No published benchmark covers this regime (§10).
9. Add [MapEval](mapeval-point-cloud-map-quality-evaluation.md) or an equivalent cloud-to-reference QA suite after dynamic cleaning when the output feeds semantic segmentation or localization. Dynamic-cleaning PR/RR/F1 says whether moving points were removed; MapEval-style AC/COM/CD/MME/AWD/SCS says whether the cleaned map geometry is still consistent and complete.

---

## Airside / Indoor / Outdoor Transfer

| Domain | What transfers | What must be revalidated |
|---|---|---|
| Road driving | Dynamic vehicle and pedestrian trails, SemanticKITTI/KITTI formatting, range-image and occupancy baselines | Aircraft geometry, low-speed GSE, repetitive stands, reflective paint, open concrete, and temporary ramp equipment |
| Campus / semi-indoor | People around platforms, clutter, repeated scans, non-road movement | Airside traffic rules, large moving aircraft, equipment staging, and apron weather exposure |
| Indoor multi-floor | Irregular LiDAR patterns, non-road structure, vertical complexity | Long-range outdoor map quality, GNSS/INS alignment, and geodetic map control |
| Airside | Map lifecycle policy, movable-static layering, aircraft-present/absent comparisons | Must be measured with local sensors, local ODD, and airport operations constraints; no public benchmark covers this domain |

---

## Sources

- KTH DynamicMap Benchmark paper: [arXiv 2307.07260](https://arxiv.org/abs/2307.07260)
- KTH DynamicMap Benchmark GitHub: [github.com/KTH-RPL/DynamicMap_Benchmark](https://github.com/KTH-RPL/DynamicMap_Benchmark)
- KTH DynamicMap Benchmark GitHub Pages: [kth-rpl.github.io/DynamicMap_Benchmark/](https://kth-rpl.github.io/DynamicMap_Benchmark/)
- HeLiMOS paper: [arXiv 2408.06328](https://arxiv.org/abs/2408.06328)
- HeLiMOS toolbox: [github.com/url-kaist/HeLiMOS-PointCloud-Toolbox](https://github.com/url-kaist/HeLiMOS-PointCloud-Toolbox)
- ERASOR paper (ar5iv): [ar5iv.labs.arxiv.org/html/2103.04316](https://ar5iv.labs.arxiv.org/html/2103.04316)
- ERASOR++ paper: [arXiv 2403.05019v1](https://arxiv.org/html/2403.05019v1)
- DUFOMap paper: [arXiv 2403.01449v2](https://arxiv.org/html/2403.01449v2)
- BeautyMap paper: [arXiv 2405.07283v1](https://arxiv.org/html/2405.07283v1)
- FreeDOM paper: [arXiv 2504.11073v1](https://arxiv.org/html/2504.11073v1)
- Raymoval paper: [arXiv 2605.08937v1](https://arxiv.org/html/2605.08937v1)
- MapEval point-cloud map-quality framework: [doi.org/10.1109/LRA.2025.3548441](https://doi.org/10.1109/LRA.2025.3548441) and [github.com/JokerJohn/Cloud_Map_Evaluation](https://github.com/JokerJohn/Cloud_Map_Evaluation)
- BTSA paper: [arXiv 2510.22313v1](https://arxiv.org/html/2510.22313v1)
- MapCleaner paper: [mdpi.com/2072-4292/14/18/4496](https://www.mdpi.com/2072-4292/14/18/4496)
- DR-Remover GitHub: [github.com/zhongbusishaonianyou/DR-REMOVER](https://github.com/zhongbusishaonianyou/DR-REMOVER)
- SemanticKITTI MOS task: [semantic-kitti.org/tasks.html](https://semantic-kitti.org/tasks.html)
- SemanticKITTI ICCV 2019 paper: [openaccess.thecvf.com](https://openaccess.thecvf.com/content_ICCV_2019/papers/Behley_SemanticKITTI_A_Dataset_for_Semantic_Scene_Understanding_of_LiDAR_Sequences_ICCV_2019_paper.pdf)
- Static-but-transient repo page: `../../perception/overview/static-but-transient-point-removal.md`
- LT-Mapper: [arXiv 2107.07712](https://arxiv.org/abs/2107.07712)
