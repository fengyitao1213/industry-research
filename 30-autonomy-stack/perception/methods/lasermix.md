# LaserMix

<!-- method-priority:start
priority:
  learning: 4
  deployment: 3
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["perception", "lidar", "segmentation", "road-av"]
  reason: "LaserMix is the LiDAR-aware consistency-regularization augmentation that unlocks label-efficient semi-supervised 3D segmentation."
method-priority:end -->

## What It Is

- LaserMix is a **semi-supervised learning (SSL) framework** for LiDAR semantic segmentation, introduced in "LaserMix for Semi-Supervised LiDAR Semantic Segmentation" (Kong, Ren, Pan, Liu — CVPR 2023 Highlight, top ~10% of accepted papers).
- It addresses the core cost driver in 3D perception: dense point-by-point annotation of LiDAR scans is expensive and the limiting factor for scaled deployment across new environments.
- The method defines a **physics-aware scan-mixing augmentation** that exploits the fixed inclination-angle (ring) structure of spinning LiDAR sensors. Mixed scans are used as the perturbation signal in a student-teacher consistency-regularization framework operating on a small labeled set plus a large unlabeled set.
- Core claim: competitive performance over fully-supervised counterparts with **2–5× fewer labels**; mean relative mIoU improvement of **+10.8%** over the supervised-only baseline across benchmarks.
- LaserMix is **architecture-agnostic** — it wraps any 3D segmentation backbone without modifying model internals. Supported backbones include RangeNet++, SalsaNext, FIDNet, CENet (range-view), MinkUNet, Cylinder3D, and SPVCNN (sparse-voxel).
- Code is merged into **MMDetection3D**. Official repository: https://github.com/ldkong1205/LaserMix.
- See also: `./salsanext.md` and `./cylinder3d.md` for the backbone methods LaserMix wraps; `../overview/3d-segmentation-training-paradigms.md` for the broader SSL paradigm context.

## Core Technical Idea

A spinning (mechanical) LiDAR fires laser pulses at discrete, fixed **inclination angles** — the elevation angles of the beams relative to horizontal. Each beam sweeps a horizontal ring of returns across the environment. Adjacent inclination bands sweep geometrically similar sectors: similar height above ground, similar object types, similar range distribution. This produces **low label variance within a band**: the conditional entropy H(Y | A) over a band A is small because points in the same ring tend to share semantic class (ground ring, mid-height ring, overhead ring).

LaserMix exploits this spatial prior as the foundation for a strong but geometrically valid data augmentation. The idea: split a LiDAR scan along inclination-band boundaries and swap alternating bands between two scans. The result is a mixed scan that is physically plausible (no impossible depth discontinuities within any ring) but has been strongly perturbed at the band boundaries — exactly where the model must learn to be invariant.

This mixed scan is then used as the input to a **student-teacher consistency regularization** loop. The teacher (EMA-updated copy of the student) predicts pseudo-labels on the two original unperturbed scans. The consistency loss enforces that the student's prediction on the mixed scan equals the teacher-assembled mix of predictions on the originals — a **mix-then-predict equals predict-then-mix** invariance. Minimizing this loss on unlabeled data teaches the model to be robust across band-level scene composition changes without requiring any additional annotation.

The theoretical justification in the paper formalizes this as conditional entropy minimization: minimizing H(Y | X, A) over the low-variation regions that LaserMix constructs. Inclination-band mixing is shown to outperform azimuth-based and radius-based alternatives in ablation, because only the inclination partition preserves the spatial-prior assumption (within-band homogeneity) while maximizing cross-band perturbation.

## Operator Mechanics

### Inclination-Band Partition

```
Given a scan S with N points, each point p_i has inclination angle phi_i = asin(z_i / r_i).

Step 1 — Sort:
  Sort all N points by phi_i in ascending order (most downward beam first).

Step 2 — Divide into K contiguous bands:
  Band B_k = { p_i : phi_{k-1} <= phi_i < phi_k }  for k = 1, ..., K
  Each band corresponds to one or more LiDAR rings.
  K is set at ring granularity (or small ring groups) depending on the sensor.
  For a 64-beam sensor the natural choice is K = 64 (one ring per band).

Step 3 — Interleave bands from scan A and scan B (odd/even pattern):
  Mixed scan M1: { B1_A, B2_B, B3_A, B4_B, ... }   <- odd-indexed from A, even from B
  Mixed scan M2: { B1_B, B2_A, B3_B, B4_A, ... }   <- odd-indexed from B, even from A

  Every band's spatial neighbor comes from the OTHER scan.
  This maximises the mixing perturbation while preserving within-band geometric coherence.
```

The interleaving design ensures the resulting scan is geometrically valid: each band is an intact ring from its source scan with correct range, reflectance, and internal point-to-point geometry. No depth discontinuity is introduced within a ring. Both range-image and voxel representations absorb the mixed scan without representation-specific handling — the backbone-agnostic claim follows directly from this.

### Consistency Loss

```
Teacher assembles a pseudo-label map for the mixed scan using the same band mask:
  PL_mix = Mix( T(A), T(B) )
    where T(.) = teacher softmax predictions on original scan,
    Mix(.) applies the identical odd/even band mask to the prediction tensors.

Student predicts on the mixed scan:
  P_mix = S( Mix(A, B) )

Consistency loss (cross-entropy or KL divergence):
  L_mix = CE( P_mix, PL_mix )   or   KL( P_mix || PL_mix )

Total training loss:
  L = L_sup + lambda * L_mix
    where L_sup = supervised loss (cross-entropy + Lovász-Softmax) on labeled scans,
    lambda = unsupervised loss weight.
```

**Hyperparameter flag:** The exact value of lambda and the LR schedule are **not confirmed from public web sources**. They should be retrieved from the official config files in the GitHub repository (`configs/` directory) before relying on them for reproduction. EMA decay alpha (the coefficient governing teacher weight averaging theta_T <- alpha * theta_T + (1 - alpha) * theta_S) is similarly unconfirmed from public sources; the typical range for this class of methods is 0.99–0.999.

## Inputs and Outputs

| Item | Detail |
|------|--------|
| Input — labeled | Small set of fully annotated LiDAR scans; per-point class labels |
| Input — unlabeled | Large set of unannotated LiDAR scans from the same sensor/environment |
| Scan format | Single spinning LiDAR scan per example; fixed beam count required |
| Range-image resolution (SemanticKITTI / ScribbleKITTI) | 64 × 2048 |
| Output | Per-point semantic class label over the full scan |
| Backbone output format | Unchanged from the wrapped backbone (range-image per-pixel or voxel per-cell, projected back to points) |
| Training output | Trained segmentation model with improved mIoU under the labeled fraction used |

## Architecture

LaserMix introduces no new backbone — it is a **training wrapper** that can be applied to any existing 3D segmentation model. The framework adds a two-stream student-teacher structure around the backbone.

### Student-Teacher EMA Two-Stream

```
Labeled batch  ──────────────────────▶  Student  ──▶  L_sup (CE + Lovász)
                                           │
Unlabeled scan pair (A, B):               │
  A ──▶ Teacher (EMA of Student) ──▶ T(A) ─┐
  B ──▶ Teacher (EMA of Student) ──▶ T(B) ─┤──▶ Mix(T(A), T(B)) ──▶ PL_mix
                                             │
  Mix(A, B) ──────────────────────────────▶ Student ──▶ P_mix ──▶ L_mix = CE(P_mix, PL_mix)
                                             │
  L = L_sup + lambda * L_mix ──────────────▶ Backprop through Student only
  EMA update: theta_T <- alpha * theta_T + (1 - alpha) * theta_S
```

The teacher receives no direct gradient. Its weights are a smoothed exponential moving average of the student. This stabilizes pseudo-label quality over the course of training — early training uses a noisy teacher (particularly at very low labeled fractions) and quality improves as the student learns.

### Supported Backbones

| Category | Backbone | Notes |
|----------|----------|-------|
| Range-view | RangeNet++, SalsaNext, FIDNet, CENet | Mixed scan fed as range image; band mask applied in spherical coordinates |
| Sparse-voxel | MinkUNet, Cylinder3D, SPVCNN | Mixed scan fed as voxelized point cloud; band mask applied before voxelization |

The LaserMix paper's primary backbone for SemanticKITTI range-view tables is **FIDNet**. For voxel-representation tables it uses **Cylinder3D**. MinkUNet results are reported in an independent empirical study (arXiv:2405.14870).

## Training Recipe

| Aspect | Detail |
|--------|--------|
| Labeled fractions evaluated | 1%, 10%, 20%, 50% of full labeled training set |
| Unlabeled data | Remainder of training set (labels withheld during training) |
| Range-image resolution | 64 × 2048 (SemanticKITTI, ScribbleKITTI) |
| Primary range-view backbone (paper) | FIDNet |
| Primary voxel backbone (paper) | Cylinder3D |
| Supervised loss | Cross-entropy + Lovász-Softmax |
| EMA decay alpha | **Unconfirmed** — typical range 0.99–0.999; check GitHub configs |
| Unsupervised loss weight lambda | **Unconfirmed** — check GitHub configs |
| LR schedule | **Unconfirmed** — check GitHub configs |

The three flagged hyperparameters (alpha, lambda, LR schedule) could not be retrieved from public web sources at the time of this writing. Before production use, consult the official config files at https://github.com/ldkong1205/LaserMix/tree/main/configs or the MMDetection3D integration for confirmed values.

## Benchmark Results

All numbers are **mIoU (%)**.

### SemanticKITTI — Range View (FIDNet backbone, original paper primary table)

| Method | 1% | 10% | 20% | 50% |
|--------|----|-----|-----|-----|
| Supervised-only | 36.2 | 52.2 | ~56 | ~60 |
| Mean Teacher | ~38 | ~52 | — | — |
| CutMix-Seg | ~41 | ~55 | — | — |
| **LaserMix** | **43.4** | **58.8** | **59.4** | **61.4** |

20% and 50% exact range-view values from the empirical study (arXiv:2405.14870); the paper's primary table focuses on 1% and 10%.

### nuScenes — Range View (FIDNet)

| Method | 1% | 10% | 20% | 50% |
|--------|----|-----|-----|-----|
| Supervised-only | 38.3 | 57.5 | 62.7 | 67.6 |
| Mean Teacher | ~42 | ~60 | — | — |
| CutMix-Seg | ~44 | ~64 | — | — |
| **LaserMix** | **49.5** | **68.2** | **70.6** | **73.0** |
| Improvement | +11.2 | +10.7 | +7.9 | +5.4 |

### nuScenes — Voxel (Cylinder3D)

| Method | 1% | 10% |
|--------|----|-----|
| Supervised-only | 50.9 | 65.9 |
| **LaserMix** | **55.3** | **69.9** |
| Improvement | +4.4 | +4.0 |

### ScribbleKITTI — Range View (FIDNet; weak/scribble supervision)

| Method | 1% | 10% |
|--------|----|-----|
| Supervised-only | 33.1 | 47.7 |
| **LaserMix** | **38.3** | **54.4** |
| Improvement | +5.2 | +6.7 |

### SemanticKITTI — Sparse-Voxel (MinkUNet; empirical study arXiv:2405.14870)

Numbers from a downstream empirical comparison; treat as indicative.

| Labeled % | Sup.-only | LaserMix |
|-----------|-----------|----------|
| 1% | ~53 | 60.9 |
| 10% | ~59 | 66.6 |
| 20% | ~62 | 67.2 |
| 50% | ~65 | 68.0 |

### Augmentation-Mode Results (fully-supervised + LaserMix as augmentation only; arXiv:2405.14870)

LaserMix also improves fully-supervised models when used purely as a data-augmentation technique without the SSL consistency framework:

| Backbone | Baseline mIoU (SemanticKITTI) | + LaserMix |
|----------|-------------------------------|-----------|
| MinkUNet | 66.9 | 70.4 |
| Cylinder3D | 63.7 | 67.0 |
| SPVCNN | 66.4 | 68.4 |

**Note on citing-paper numbers:** Several papers reporting updated LaserMix results (e.g., CoScene arXiv:2408.11280, CoLLiS arXiv:2605.17135) show higher absolute mIoU values. These likely reflect updated LaserMix code with stronger backbones. Use the original paper's FIDNet/Cylinder3D tables for head-to-head baseline comparisons, and treat citing-paper numbers as indicative of what an updated configuration can achieve.

**Summary:** LaserMix achieves **+10.8% relative mIoU on average** over supervised-only baselines and matches fully-supervised performance using **2–5× fewer labels**.

## Variants and Lineage

### LaserMix++ (TPAMI 2025)

Published as "Multi-Modal Data-Efficient 3D Scene Understanding for Autonomous Driving" (arXiv:2405.05258; IEEE TPAMI Vol. 47, No. 5, pp. 3748–3765, 2025). Extends the original framework in three directions:

1. **Multi-modal LaserMix operation.** The beam-mixing is extended to simultaneously mix corresponding LiDAR and camera image pairs, enabling cross-sensor consistency regularization without image annotations.
2. **Camera-to-LiDAR feature distillation.** A pretrained image segmentation teacher transfers semantic features to the LiDAR branch via cosine-distance minimization between aligned point-image feature pairs.
3. **Language-driven knowledge guidance.** CLIP vision-language embeddings generate auxiliary supervision signals on unlabeled point clouds, providing open-vocabulary semantic cues as a pseudo-supervision stream.

The LiDAR-only component of LaserMix++ is structurally identical to the original LaserMix; the camera and language branches are additive.

**LaserMix++ delta over LaserMix (mIoU pp):**

| Dataset | 1% | 10% | 20% | 50% |
|---------|----|-----|-----|-----|
| nuScenes (range view) | +2.1 | +1.6 | +1.1 | +0.7 |
| SemanticKITTI (range view) | +2.7 | +1.8 | +1.4 | +1.1 |
| ScribbleKITTI | +1.4 | +1.6 | +1.2 | +0.4 |

Gains are largest at the lowest label fractions (1%, +1.4–2.7 pp) and diminish toward 50%.

### 3D Augmentation Lineage

| Method | Mixing axis | Level | Year | Venue |
|--------|-------------|-------|------|-------|
| Copy-Paste / GT-Aug | Instance bounding box | Instance | 2020+ | Various |
| Mix3D | Full scene concatenation | Scene | 2021 | 3DV |
| CutMix-3D | Random 3D bounding box | Region | 2021 | Adapted from 2D |
| PolarMix | Azimuth angle (polar sweep) | Scene + instance | 2022 | NeurIPS 2022 |
| **LaserMix** | Inclination angle (elevation / ring) | Scene (ring-level) | 2022/2023 | CVPR 2023 |
| FrustumMix | Both inclination and azimuth (frustum units) | Sub-scene | 2023+ | — |
| **LaserMix++** | Inclination + camera + language | Multi-modal scene | 2024 | TPAMI 2025 |

**PolarMix vs. LaserMix:** PolarMix (arXiv:2208.00223, NeurIPS 2022) cuts scenes along the *azimuth* (horizontal sweep) axis and swaps sectors; it also performs instance-level rotation-and-paste. LaserMix cuts along the *inclination* (vertical beam / ring) axis, motivated by the within-band homogeneity argument. Ablation in the LaserMix paper shows inclination-based mixing outperforms azimuth-based and radius-based alternatives with the interleaved pattern providing the strongest consistency signal.

**FrustumMix:** Divides the scene into frustum regions along both inclination and azimuth and swaps corresponding frustums between scans — the most geometrically complete variant but also the most complex. Cited as a strong augmentation baseline in later work; a primary venue paper was not confirmed at writing time.

**Instance copy-paste:** Pastes foreground objects from a ground-truth database into a new scan. Augments instance diversity but does not provide the background-level or unlabeled-data leverage that scene-mixing methods offer for SSL.

## Strengths

- **Architecture-agnostic.** Wraps any backbone — range-image, sparse-voxel, hybrid. No modification to model internals is required; the mixing and consistency loss are entirely in the training loop.
- **Physics-grounded design.** The inclination-band partition derives directly from real LiDAR ring structure, giving a principled reason why the perturbation is strong enough between bands and weak enough within bands to be useful as a consistency target.
- **Theoretical backing.** The paper provides a formal conditional entropy minimization analysis — more rigorous than purely empirical augmentation proposals.
- **Strong low-data gains.** +7–11 pp mIoU at 1% labels is large; gains persist (though diminish) through 50% labeled data.
- **Broad reproducibility.** Code merged into MMDetection3D; multiple backbone configurations supported; all benchmarks are standard public datasets.
- **Complementary to backbone improvements.** LaserMix gains and backbone gains stack: the best results combine stronger backbones with LaserMix, and the two levers are largely independent.
- Ranked first on semi-supervised leaderboards of nuScenes, SemanticKITTI, and ScribbleKITTI at the time of publication (CVPR 2023).

## Failure Modes

- **Fixed beam structure required.** LaserMix is meaningful only for sensors with a fixed, uniform beam pattern (mechanical spinning LiDAR with known ring count). Solid-state LiDAR (e.g., Livox Avia, Innoviz) fires in non-uniform, non-ring patterns. Cross-sensor domain shift (e.g., training on 64-beam Velodyne, deploying on 32-beam Ouster) is not addressed.
- **Single-scan only.** LaserMix operates on individual scans. Once scans are aggregated and registered into a global frame, the ring structure in the raw spherical coordinate frame is destroyed and the band partition loses meaning.
- **Pseudo-label noise at very low fractions.** At 1% labeled data the teacher is poorly initialized; EMA propagates noisy pseudo-labels. Subsequent work (CoScene, temporal SSL methods) outperforms LaserMix at very low fractions specifically due to better pseudo-label quality, not because the mixing idea is flawed.
- **Outdoor driving scene bias.** All benchmarks are outdoor road or urban scenes at 1–2 m sensor mounting height with 32–64 beam sensors and clear line of sight. In confined industrial or tunnel environments with high clutter density, the within-band homogeneity assumption may weaken, reducing the quality of the consistency signal.
- **Class imbalance not addressed.** The consistency loss treats all points equally. Rare classes (bicycles, motorcycles) that drive overall mIoU sensitivity are not given higher weight. Subsequent class-imbalanced SSL methods address this explicitly.
- **No temporal consistency.** LaserMix does not exploit scan-to-scan sequential coherence. Methods using temporal correlation (e.g., arXiv:2410.06893) substantially outperform LaserMix on benchmarks where sequential scans are available.
- **Gain compression at high label fractions.** At 50% labeled data the improvement over supervised-only shrinks to +3–5 pp (nuScenes range view: +5.4 pp; SemanticKITTI voxel with Cylinder3D: near zero). The method's primary value is the low-data regime.

## Domain Fit

| Domain | Fit | Note |
|--------|-----|------|
| Road AV — on-vehicle SSL training | strong | Designed for exactly this; standard spinning LiDAR, abundant unlabeled scan pools. |
| Airside — on-vehicle SSL training | conditional | Viable if the sensor is a mechanical spinning LiDAR with consistent ring geometry; re-validate within-band homogeneity assumption in high-clutter ramp/apron geometry before deploying at very low label fractions. |
| Airside / aggregated static map | not applicable | LaserMix does not operate on aggregated maps; see Aggregated-Map Suitability. |
| Warehouse / port / logistics-yard | conditional | Fits single-scan SSL with spinning LiDAR on an ego-vehicle; indoor geometry and dense clutter may weaken homogeneity assumption compared to open-road scenes. |
| Mining / construction / agriculture | limited | Non-uniform terrain, dense vegetation, and widespread solid-state sensor use reduce applicability; band-homogeneity assumption less reliable. |
| Fully-supervised augmentation (any domain) | moderate | LaserMix improves fully-supervised models as a pure augmentation technique (+3–4 pp mIoU on MinkUNet/Cylinder3D), independent of the SSL framework, wherever spinning LiDAR is used. |

## Aggregated-Map Suitability

**LaserMix is a single-scan training augmentation. It does not operate on aggregated multi-viewpoint maps, and it is not designed to.**

Its role in an aggregated-map semantic segmentation pipeline is indirect but important, structured as a three-stage chain:

**Stage 1 — Train the single-scan model with LaserMix SSL.** The labeled set is the (small) pool of individually annotated scans. LaserMix exploits the large unlabeled scan pool to train a stronger single-scan segmentation model with fewer labels.

**Stage 2 — Auto-label at map scale.** The trained model is run over every registered scan in the aggregated map to produce per-point pseudo-labels. Better single-scan models (due to LaserMix) translate directly to higher-quality auto-labels in the map, reducing the error rate before any map-level fusion step.

**Stage 3 — Map-level fusion (no LaserMix role).** Aggregated label maps require multi-scan voting, temporal averaging, and dynamic object removal. LaserMix has no role here.

**Key constraint:** The model trained with LaserMix operates on single scans at inference time. It cannot directly segment an aggregated voxel map — the band-mixing assumptions break in a globally registered coordinate frame. If the map pipeline segments by fusing per-scan outputs (the standard approach), this constraint is automatically satisfied.

This layered recipe is described in `../overview/3d-segmentation-training-paradigms.md` under the semi-supervised training paradigm section. LaserMix is the specific mechanism that reduces single-scan labeling cost before the auto-labeling step feeds the offline map pipeline. The map-level segmentation strategy itself (backbone selection, aggregation approach, dynamic removal) is covered in `../overview/aggregated-map-semantic-segmentation.md` §7.6 (pre-training and label-efficiency) and §12 (production practice).

## Implementation Notes

- Use LaserMix when the available labeled-scan budget is below ~20% of the full training corpus. The gains are largest at 1–10% labeled data; above 50% the method becomes marginally useful compared to fully-supervised training alone.
- The **fixed ring structure** of the sensor is a hard prerequisite. Before applying LaserMix to a new sensor, confirm it is a mechanical spinning LiDAR with a well-defined, consistent beam-elevation pattern. Solid-state or MEMS sensors require a different mixing strategy or none at all.
- Start from the **MMDetection3D integration** rather than the standalone repo for new projects — it is the most maintained code path and integrates with standard backbone configurations.
- The three unconfirmed hyperparameters (EMA decay alpha, unsupervised loss weight lambda, LR schedule) must be verified against the GitHub configs before relying on reproduction numbers. Do not set them by analogy from other SSL papers without checking.
- For range-view backbones: the LaserMix band-mask operates in spherical coordinates before projection. Ensure the mixing step precedes the spherical projection in the data pipeline, not after.
- For voxel backbones: the mixing step precedes voxelization. The mixed point cloud is voxelized normally; no changes to the backbone are needed.
- **Combine with Lovász-Softmax** in the supervised loss branch (as done in the paper). The loss combination (cross-entropy + Lovász) is important for rare-class performance; see `./salsanext.md` for ablation context.
- **Class-imbalance is not handled by LaserMix itself.** For rare classes (in airside contexts: workers, vehicles in tight clearance, foreign object debris categories), apply class-weighted supervised loss in L_sup or consider subsequent class-imbalanced SSL methods as an upgrade.
- For the airside domain: validate the within-band homogeneity assumption empirically on collected airside scans before committing to a low-labeled-fraction regime. Open-apron geometry may satisfy the assumption reasonably well; cluttered terminal-area geometry warrants a check.
- **LaserMix++ is the natural upgrade path** when camera data is available alongside LiDAR. The LiDAR-only behavior is identical; the camera distillation and CLIP branches are additive.

## Sources

- LaserMix arXiv: https://arxiv.org/abs/2207.00026 (Kong, Ren, Pan, Liu — CVPR 2023 Highlight)
- LaserMix CVPR 2023 open access: https://openaccess.thecvf.com/content/CVPR2023/html/Kong_LaserMix_for_Semi-Supervised_LiDAR_Semantic_Segmentation_CVPR_2023_paper.html
- LaserMix project page: https://ldkong.com/LaserMix
- LaserMix GitHub: https://github.com/ldkong1205/LaserMix
- LaserMix++ arXiv: https://arxiv.org/abs/2405.05258
- LaserMix++ TPAMI (IEEE Xplore): https://ieeexplore.ieee.org/document/10856442/
- LaserMix++ HTML (full text): https://arxiv.org/html/2405.05258v1
- PolarMix arXiv: https://arxiv.org/abs/2208.00223 (NeurIPS 2022)
- Empirical SOTA LiDAR segmentation study: https://arxiv.org/html/2405.14870v1
- CoScene (temporal SSL, citing LaserMix): https://arxiv.org/html/2408.11280v1
- Spatio-temporal SSL (citing LaserMix): https://arxiv.org/html/2410.06893v1
- CoLLiS (collaborative SSL, citing LaserMix): https://arxiv.org/html/2605.17135
- Related overview — aggregated-map pipeline: `../overview/aggregated-map-semantic-segmentation.md` (§7.6 pre-training and label-efficiency; §12 production practice)
- Related overview — semi-supervised paradigm: `../overview/3d-segmentation-training-paradigms.md` (semi-supervised training paradigm section; layered airside recipe)
- Related overview — single-scan methods: `../overview/lidar-semantic-segmentation.md`
- Knowledge base — class imbalance and data strategies: `../../../10-knowledge-base/geometry-3d/point-cloud-segmentation-losses-metrics-first-principles.md`
