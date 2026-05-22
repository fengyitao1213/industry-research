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

## Core Technical Idea

- Images carry rich texture/appearance cues that LiDAR geometry lacks; naive fusion forces the camera into the inference path, adding a calibration dependency and limiting gains to the camera field of view.
- 2DPASS moves the fusion to **training only**. During training it takes paired image patches and the point cloud, runs a 2D encoder and the 3D encoder, and fuses their multi-scale features.
- The central module — **Multi-Scale Fusion-to-Single Knowledge Distillation (MSFSKD)** — fuses 2D and 3D features at multiple scales, then distills that enhanced, fused representation back into the *pure 3D* branch.
- At inference the 2D branch and the fusion are discarded; only the 3D network runs.
- Because the boost is distilled into the 3D weights, it applies across the **whole LiDAR field of view**, not just the camera-covered region — a key advantage over inference-time fusion.

## Inputs and Outputs

- Training inputs: paired LiDAR point clouds and camera images, with calibration to project points into images.
- Inference inputs: **LiDAR point cloud only**.
- Output: per-point semantic labels.
- It is a training wrapper plus distillation loss around a 3D backbone, not a standalone network.

## Architecture

- A **3D branch** — the deployable backbone (e.g. a sparse-convolution network such as SPVCNN) that produces per-point features.
- A **2D branch** — an image encoder, used at training time only.
- **MSFSKD module** — fuses multi-scale 2D and 3D features and applies a knowledge-distillation loss that transfers the fused knowledge into the 3D branch.
- The total loss combines the standard segmentation loss on the 3D branch with the distillation loss.
- At inference, the 2D branch and MSFSKD are dropped; the 3D branch is the model.

## Training and Evaluation

- 2DPASS reported state-of-the-art LiDAR segmentation on SemanticKITTI and nuScenes lidarseg when published.
- It improves multiple 3D backbones — the gain comes from the training scheme, not a specific architecture.
- Trained with paired image+LiDAR data; evaluated LiDAR-only with per-class IoU and mIoU.
- The improvement is largest for appearance-defined classes that geometry alone separates poorly.

## Strengths

- Image supervision at train time, **LiDAR-only and full-FOV at inference** — no camera or calibration dependency at deploy.
- Backbone-agnostic — wraps an existing 3D network.
- The distilled boost covers the whole LiDAR FOV, not just the camera-covered region.
- Robust to the deployment risks of inference-time fusion (calibration drift, exposure, night).
- A clean fit for a LiDAR-primary stack that still wants 2D semantics.

## Failure Modes

- Requires paired, calibrated image+LiDAR data **during training** — if the survey has no imagery, 2DPASS gives nothing.
- Gains depend on training-time image quality and coverage; poorly-lit or sparse imagery limits the distilled benefit.
- It is a training scheme, not a backbone — a weak 3D backbone is still weak.
- Distillation adds training cost and a loss-weight hyperparameter to tune.
- The 2D-3D projection at training time is still calibration-sensitive (the error just does not reach inference).

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV (on-vehicle) | strong | SOTA single-scan segmentation with LiDAR-only deployment — ideal for an embedded LiDAR-primary stack. |
| Road AV (offline / maps) | strong | The recommended way to add image supervision to an aggregated-map segmenter without an inference-time camera. |
| Airside | conditional | No airside checkpoints exist; strongly recommended once paired airside survey imagery is available. |
| Warehouse / port / mining / construction / agriculture | conditional | Transfers wherever paired image+LiDAR training data can be collected. |

## Implementation Notes

- Use it whenever the survey vehicle also captures calibrated imagery — it is close to free accuracy bought at train time.
- Pick the 3D branch as the backbone you intend to deploy; 2DPASS does not change the deployed architecture.
- Calibration matters at training time — a bad projection corrupts the distilled signal even though it never reaches inference.
- For aggregated-map segmentation, distill from imagery captured on the same survey passes that built the map.
- It pairs naturally with the §4.3 recommendation: train with 2DPASS distillation, deploy LiDAR-only.
- SLidR-style image-to-LiDAR pre-training is complementary — pre-train, then train with 2DPASS distillation.

## Sources

- 2DPASS paper: https://arxiv.org/abs/2207.04397
- Reference implementation: https://github.com/yanx27/2DPASS
- Related repository page: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline (§4.3, §4.5 on LiDAR-image fusion)
- Related repository page: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation
