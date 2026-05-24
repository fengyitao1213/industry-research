# 2DPASS

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["perception", "lidar", "segmentation", "fusion", "road-av"]
  reason: "2DPASS is the reference training scheme for image-assisted LiDAR semantic segmentation with LiDAR-only inference."
method-priority:end -->

## What It Is

- 2DPASS (2D Priors Assisted Semantic Segmentation) is a *training scheme* for LiDAR point cloud semantic segmentation, introduced in "2DPASS: 2D Priors Assisted Semantic Segmentation on LiDAR Point Clouds" (ECCV 2022).
- It uses camera images to assist training, but the trained model runs **LiDAR-only at inference** — no camera and no calibration needed at deploy time.
- It is backbone-agnostic: it wraps around a 3D segmentation network rather than replacing it.
- It is the reference method for gaining 2D image supervision without acquiring a hard camera dependency.
- For aggregated-map segmentation it is the recommended fusion approach when paired imagery exists (see `../overview/aggregated-map-semantic-segmentation.md` §4.3, §4.5).
- At ECCV 2022 it achieved 1st place on SemanticKITTI (single-scan and multi-scan leaderboards) and 3rd on nuScenes-lidarseg.

## Core Technical Idea

- Images carry rich texture and appearance cues that LiDAR geometry lacks; naive inference-time fusion forces the camera into the deployment path, adding a calibration dependency and limiting gains to the camera field of view.
- 2DPASS moves the fusion to **training only**. During training it takes paired image patches and the point cloud, runs a 2D encoder and the 3D encoder, and fuses their multi-scale features.
- The central module — **Multi-Scale Fusion-to-Single Knowledge Distillation (MSFSKD)** — fuses 2D and 3D features at multiple scales, then distills that enhanced fused representation back into the *pure 3D* branch via a knowledge distillation loss.
- At inference the 2D branch and the fusion are discarded; only the 3D network runs.
- Because the boost is distilled into the 3D weights, it applies across the **whole LiDAR field of view**, not just the camera-covered region — a key advantage over inference-time fusion methods such as PointPainting or PMF.

## Operator Mechanics

### Point-to-Pixel Projection

During training, each LiDAR point `p = (x, y, z)` is projected into the calibrated camera image via:

```
[u, v, 1]ᵀ = K · [R | t] · [x, y, z, 1]ᵀ
```

where `K` is the camera intrinsic matrix and `[R | t]` is the extrinsic transform. Points outside the image boundary are masked. The image pixel at `(u, v)` provides a texture/colour feature vector for point `p`. This projection is used only during training — it requires calibration and synchronised image capture.

### 3D Branch

A standard 3D backbone (SPVCNN in the reference implementation, but the scheme is backbone-agnostic) processes the LiDAR point cloud and produces per-point feature maps at multiple scales: `{F₃D¹, F₃D², ..., F₃Dᴷ}` where `K` is the number of scale levels.

### 2D Branch

A 2D image encoder (e.g. ResNet or lightweight CNN) processes the paired camera image and produces multi-scale 2D feature maps: `{F₂D¹, F₂D², ..., F₂Dᴷ}`. For each projected point, the corresponding 2D feature is bilinearly interpolated from the image feature map at the point's projected pixel location.

### MSFSKD — Multi-Scale Fusion-to-Single Knowledge Distillation

At each of the K scale levels, the projected 2D feature for each point is concatenated with the 3D feature and passed through a fusion MLP to produce a fused multi-modal feature:

```
F_fused^k = MLP_fuse(concat(F₃D^k, F₂D^k))   for k = 1, ..., K
```

A multi-scale aggregation combines all K fused features into a single rich representation `F_fused`. The distillation loss then minimises the distance between the 3D-branch output and `F_fused`:

```
L_distill = Σ_k  ||F₃D^k − sg(F_fused^k)||²
```

where `sg(·)` is the stop-gradient operator — the 3D branch learns to match the fused representation; the fused branch is the target, not the student. The total training loss is:

```
L_total = L_seg(F₃D) + λ · L_distill
```

where `L_seg` is the standard segmentation loss (cross-entropy / Lovász) and `λ` is a distillation weight hyperparameter.

### Inference

At inference the 2D branch, the fusion MLP, and the MSFSKD module are removed entirely. Only the 3D backbone and the segmentation head are loaded. Inference is identical to running the bare 3D backbone — no camera, no projection, no extra memory.

## Inputs and Outputs

- **Training inputs:** paired LiDAR point clouds and camera images with calibration (intrinsics + extrinsics to project points into images).
- **Inference inputs:** LiDAR point cloud only.
- **Output:** per-point semantic labels.
- It is a training wrapper plus distillation loss around a 3D backbone, not a standalone network.

## Architecture

- A **3D branch** — the deployable backbone (e.g. SPVCNN) that produces per-point features at multiple scales.
- A **2D branch** — an image encoder used at training time only.
- **MSFSKD module** — fuses multi-scale 2D and 3D features and applies a knowledge-distillation loss that transfers the fused knowledge into the 3D branch.
- The total loss combines the standard segmentation loss on the 3D branch with the distillation loss.
- At inference, the 2D branch and MSFSKD are dropped; the 3D branch is the deployed model.
- The 6-scale variant uses K=6 fusion scales; the 4-scale variant K=4. More scales improve mIoU at the cost of training memory.

## Complexity and Compute

- **Training cost:** Adding the 2D branch and MSFSKD increases training time versus the bare 3D backbone; the overhead is roughly proportional to the number of distillation scales K. No multi-GPU requirement in principle, but the 6-scale variant with 45.6 M parameters benefits from ≥32 GB GPU memory.
- **Inference cost:** Identical to the bare 3D backbone. No overhead from 2DPASS at inference — the 2D branch is absent.
- **Parameter count:** 45.6 M (6-scale variant, SPVCNN backbone). The backbone itself is smaller; the 2D branch parameters are discarded after training.
- **Latency at inference:** Determined entirely by the chosen 3D backbone; 2DPASS adds zero inference latency.

## Training Recipe

- **Optimizer:** AdamW.
- **Learning rate schedule:** Cosine annealing with warmup.
- **Epochs:** ~64 epochs on SemanticKITTI; ~36 on nuScenes.
- **Loss:** Cross-entropy segmentation loss + MSFSKD distillation loss; λ (distillation weight) is a key hyperparameter — values around 0.1–1.0 are typical.
- **Augmentation:** Standard LiDAR augmentations (random rotation, flip, jitter) plus image augmentations on the 2D branch (colour jitter, random crop). The point-to-pixel projection is applied after 3D augmentation with a correspondingly updated projection matrix.
- **Calibration requirement:** Accurate camera intrinsics and extrinsics must be available for training data. Errors in calibration degrade the distilled signal proportionally.
- **Paired data:** Training requires LiDAR and camera to be temporally synchronised and spatially calibrated. For aggregated-map use, survey passes must capture both modalities simultaneously.

## Benchmark Results

| Dataset | Variant | mIoU (vanilla) | mIoU (TTA) | Notes |
|---------|---------|---------------|-----------|-------|
| SemanticKITTI val | 2DPASS-4scale | 68.7% | 70.0% | SPVCNN backbone |
| SemanticKITTI val | 2DPASS-6scale | 70.7% | **72.0%** | 45.6 M params |
| nuScenes val | 2DPASS-6scale | 78.0% | **80.5%** | — |

Context within the cross-modal distillation family at SemanticKITTI val:

| Method | mIoU | Camera at inference | Paradigm |
|--------|------|--------------------|--------------------|
| 2DPASS-6scale (TTA) | **72.0%** | No | Supervised distillation |
| D-DITR (distilled) | 69.8% | No | SSL distillation (DINOv2) |
| ScaLR (WaffleIron) | 65.8% | No | SSL distillation (DINOv2) |
| SLidR (1% labels) | 44.6% | No (inference) | SSL contrastive pre-train |

2DPASS-6scale at 72.0% val is the highest published LiDAR-only inference result from the cross-modal distillation family on SemanticKITTI.

## Variants and Lineage — Fusion Family Comparison

2DPASS belongs to the **multi-modal LiDAR + image fusion** family. The family is usefully stratified by whether the camera is required at inference:

| Method | Fusion stage | Camera at inference | Key idea | Pro | Con |
|--------|-------------|--------------------|---------|----|-----|
| PointPainting (CVPR 2020) | Input-level (early) | **Yes** | Paint LiDAR points with 2D seg scores before 3D detector | Simple; modular | Cascades 2D errors; calibration drift; camera must be synchronised |
| PMF (ICCV 2021) | Feature-level (range-view) | **Yes** | Residual attention fusion in range-image space between RGB and LiDAR | Perceptually-aware cross-modal complementarity | Inherits range-image single-origin limit; camera required at inference |
| **2DPASS (ECCV 2022)** | Training-time distillation | **No** | MSFSKD distills fused 2D+3D features into 3D branch | Full-FOV LiDAR-only inference; backbone-agnostic | Needs paired calibrated cam+LiDAR data at training time |
| SLidR (CVPR 2022) | SSL pre-training | **No** | Contrastive matching of LiDAR regions to image superpixels | No labels for pre-training; strong low-data fine-tune | Paired unlabelled camera+LiDAR corpus needed; frozen 2D teacher |
| ScaLR (2024) | SSL pre-training | **No** | Scales SLidR with DINOv2 ViT-L/14 across 3 datasets | Cross-sensor transfer at 1% labels | Large pre-training compute; WaffleIron backbone only |
| DITR (2025) | Feature injection (inference) | **Yes** | DINOv2 patch features added to PTv3 decoder skip connections | State-of-the-art with camera; no pre-training needed | Camera required at inference; invisible points get zero features |
| D-DITR (2025) | SSL pre-training (distillation) | **No** | Distills DINOv2 point features into 3D backbone via cosine loss | Outperforms injection mode on SemanticKITTI | Pre-training compute; PTv3 backbone required |

See `../overview/aggregated-map-semantic-segmentation.md` §4.5 for the full fusion-family comparison in the aggregated-map context and §4.6 for the range-image family exclusion rationale.

## Strengths

- Image supervision at train time, **LiDAR-only and full-FOV at inference** — no camera or calibration dependency at deploy.
- Backbone-agnostic — wraps any existing 3D network without changing its architecture.
- The distilled boost covers the whole LiDAR FOV, not just the camera-covered region (unlike PointPainting or PMF which are limited to pixels in-frame).
- Robust to the deployment risks of inference-time fusion: calibration drift, exposure variation, darkness, camera failure.
- A clean fit for a LiDAR-primary stack that still wants 2D semantics embedded in the 3D weights.
- ECCV 2022 SOTA: 1st on SemanticKITTI both single-scan and multi-scan leaderboards.

## Failure Modes

- Requires paired, calibrated image+LiDAR data **during training** — if the survey has no imagery, 2DPASS gives no benefit.
- Gains depend on training-time image quality and coverage; poorly-lit, occluded, or sparse imagery limits the distilled benefit.
- It is a training scheme, not a backbone — a weak 3D backbone is still weak; the gain is additive, not multiplicative.
- Distillation adds training cost and a loss-weight hyperparameter `λ` to tune; wrong `λ` can hurt segmentation loss.
- The 2D-3D projection at training time is calibration-sensitive — errors in extrinsics corrupt the distilled signal even though they never reach inference.
- Cannot leverage unlabelled LiDAR from rigs without cameras (e.g., LiDAR-only survey vehicles, historical scans).

## Aggregated-Map Suitability

**Rating: Very Good (LiDAR-only inference).**

2DPASS is the recommended fusion approach for aggregated-map segmentation when the map-building survey also captures calibrated imagery. The train-with-image / deploy-LiDAR-only pattern is a direct fit for the aggregated-map workflow:

1. Map-building sweeps collect synchronised LiDAR + camera data.
2. 2DPASS training uses those paired sweeps — calibration is achievable once per survey rig.
3. The deployed segmentation model is LiDAR-only — it runs on the aggregated point cloud with no per-point camera dependency.
4. The distilled semantic features improve rare-class segmentation (appearance-defined classes that LiDAR geometry alone separates poorly).

For **airside maps**, this is especially valuable: apron equipment (belt loaders, tugs, fuel trucks, jetbridges) has highly distinctive visual appearance but ambiguous LiDAR geometry. 2DPASS-distilled features can encode colour and texture cues into the LiDAR backbone weights, improving discrimination without requiring a camera at map-query time.

Complementary pre-training stack:
- Pre-train with SLidR or ScaLR (image-to-LiDAR SSL distillation) on large public datasets.
- Fine-tune with 2DPASS (supervised distillation) on site-specific paired survey data.
- Deploy LiDAR-only.

This two-stage approach combines the label efficiency of SSL pre-training with the accuracy ceiling of supervised distillation.

### Map-Release Distillation Contract

2DPASS should be treated as a training-time modality contract, not just a model score improvement. A semantic-map manifest should record:

| Contract item | Required evidence |
|---|---|
| Image dependency class | State explicitly that imagery is training-only and that released inference consumes LiDAR points only. If any image feature remains in the deployed graph, the product becomes image-dependent fusion rather than 2DPASS-style distillation. |
| Projection QA | Camera intrinsics/extrinsics version, time-sync window, per-camera coverage, occlusion mask policy, reprojection residuals, and rejected-frame list. |
| Distillation lineage | 3D backbone, 2D teacher/encoder, distillation scales K, loss weight, image augmentations, paired-survey capture IDs, and whether SLidR/ScaLR pre-training preceded supervised 2DPASS. |
| Label-use permissions | Distilled labels can improve semantic logits, but map-derived training exports still require semantic class plus release-state labels; non-`permanent_static` points stay masked, auxiliary, or active-learning candidates. |
| Acceptance checks | Compare the distilled model against the same LiDAR-only backbone without distillation, reporting rare appearance-defined classes, night/day or exposure slices, calibration-stress slices, seam disagreement, ECE, and false-permanent contamination. |

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV (on-vehicle) | strong | SOTA single-scan segmentation with LiDAR-only deployment — ideal for an embedded LiDAR-primary stack. |
| Road AV (offline / maps) | strong | The recommended way to add image supervision to an aggregated-map segmenter without an inference-time camera. |
| Airside | conditional | No airside checkpoints exist; strongly recommended once paired airside survey imagery is available. High value for appearance-defined equipment classes. |
| Warehouse / port / mining / construction / agriculture | conditional | Transfers wherever paired image+LiDAR training data can be collected. |

## Implementation Notes

- Use 2DPASS whenever the survey vehicle also captures calibrated imagery — it is near-free accuracy bought at train time.
- Pick the 3D branch as the backbone you intend to deploy; 2DPASS does not change the deployed architecture.
- Calibration matters at training time — verify extrinsic accuracy with a checkerboard or ground-plane method before generating training data.
- For aggregated-map segmentation, distill from imagery captured on the same survey passes that built the map; avoid using imagery from different sensor rigs or time periods.
- SLidR/ScaLR pre-training is complementary — pre-train with SSL distillation on public data, then train with 2DPASS supervised distillation on site-specific data.
- At inference, the deployed model is the bare 3D backbone — profile and optimise as you would any vanilla 3D segmentation network; no 2DPASS-specific inference code is needed.
- For the 6-scale variant, monitor GPU memory during training — the 2D branch and K fusion MLPs increase peak memory; gradient checkpointing may be needed on 16 GB cards.

## Choosing the Distillation Scale (K)

The number of distillation scales K is the primary accuracy-vs-training-cost knob. The 4-scale and 6-scale variants share the same 3D backbone and differ only in how many intermediate feature levels participate in the MSFSKD loss:

| Variant | K | SemanticKITTI val (vanilla) | nuScenes val (vanilla) | Training memory |
|---------|---|----------------------------|----------------------|----------------|
| 2DPASS-4scale | 4 | 68.7% | — | Lower |
| 2DPASS-6scale | 6 | 70.7% | 78.0% | Higher |

The 6-scale variant adds roughly 2 mIoU points at the cost of higher GPU memory during training. For a first airside deployment, the 4-scale variant is recommended to establish the training pipeline, then upgrade to 6-scale once memory and training time budgets are confirmed.

## Benchmark Context — Fusion Family at nuScenes

For completeness, the cross-modal distillation family performance on nuScenes val (all LiDAR-only inference at deployment):

| Method | nuScenes val mIoU | Camera at inference | Year |
|--------|------------------|--------------------|----|
| 2DPASS-6scale (TTA) | **80.5%** | No | 2022 |
| ScaLR (WaffleIron backbone) | 78.4% | No | 2024 |
| D-DITR (distilled PTv3) | — (SemanticKITTI primary) | No | 2025 |
| SLidR (fine-tune 100% labels) | 74.6% | No | 2022 |

2DPASS-6scale holds the highest reported nuScenes val figure among LiDAR-only inference methods in the distillation family as of the knowledge cut-off. DITR-injection (camera at inference) reaches 84.2%, illustrating the accuracy cost of removing the camera at runtime.

## Sources

- 2DPASS paper: https://arxiv.org/abs/2207.04397
- Reference implementation: https://github.com/yanx27/2DPASS
- SLidR (complementary SSL pre-training): https://arxiv.org/abs/2203.16258
- ScaLR (scaled SSL pre-training, WaffleIron backbone): https://github.com/valeoai/ScaLR
- DITR / D-DITR (2025 DINOv2 fusion family): https://arxiv.org/abs/2503.18944
- PointPainting (input-level fusion baseline): https://arxiv.org/abs/1911.10150
- PMF (feature-level range-view fusion): https://openaccess.thecvf.com/content/ICCV2021/papers/Zhuang_Perception-Aware_Multi-Sensor_Fusion_for_3D_LiDAR_Semantic_Segmentation_ICCV_2021_paper.pdf
- Related repository page: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline (§4.3, §4.5 fusion family; §4.6 range-image family exclusion)
- Related repository page: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation
