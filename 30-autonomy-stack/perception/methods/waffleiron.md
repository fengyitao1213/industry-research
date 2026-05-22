# WaffleIron

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["perception", "lidar", "segmentation", "road-av"]
  reason: "WaffleIron is a deliberately simple LiDAR segmentation backbone built from standard dense 2D convolutions, easy to implement and deploy."
method-priority:end -->

## What It Is

- WaffleIron is a backbone for LiDAR point cloud semantic segmentation, introduced in "Using a Waffle Iron for Automotive Point Cloud Semantic Segmentation" (ICCV 2023).
- Its design goal is **simplicity**: it is built almost entirely from standard dense 2D convolutions and pointwise MLPs — no sparse convolutions, no kernel-point operators, no custom point-cloud CUDA kernels.
- It shows that a deliberately plain architecture, using only well-optimized off-the-shelf operations, can be competitive with sparse-convolution and transformer backbones.
- It is the backbone used by the ScaLR image-to-LiDAR distillation pre-training method.
- It fills the **projection-based** slot in the architecture landscape — distinct from point-conv, sparse-voxel, and transformer families.

## Core Technical Idea

- A point cloud is irregular; the usual responses are sparse convolution, point operators, or attention — all of which need specialized implementations.
- WaffleIron instead alternates two cheap, standard operations: (a) a **pointwise MLP** that mixes features per point, and (b) a **project-convolve-lift** step — project the per-point features onto a dense 2D grid along one coordinate plane, apply a **standard dense 2D convolution**, then scatter the result back to the points.
- The "waffle iron" metaphor: the cloud is repeatedly squashed flat onto a plane, pressed with a 2D convolution, and lifted back — alternating *which* plane is used so 3D structure is covered across layers.
- Because the spatial mixing is a dense 2D convolution, it runs on the most heavily-optimized GPU primitive available, with no custom kernels.
- The thesis mirrors the PTv3 lesson from the other direction: a simple, standard operator at scale beats a sophisticated specialized one.

## Inputs and Outputs

- Inputs: a point cloud as coordinates `(x, y, z)` plus per-point features — intensity/reflectance and, where available, colour.
- A grid resolution for the 2D projection is a hyperparameter.
- Output: per-point feature embeddings; a head turns them into per-point class logits.
- It is a backbone, paired with a segmentation head.
- No images are required.

## Architecture

- An embedding MLP lifts raw point features to a working feature dimension.
- A stack of WaffleIron blocks, each: pointwise MLP → project to a 2D plane → dense 2D convolution → lift back to points.
- The projection plane is alternated across blocks (e.g. the three coordinate planes) so vertical and horizontal structure are both seen.
- A final head produces per-point logits.
- No encoder-decoder down/up-sampling hierarchy is required — the architecture is largely flat, which is part of its simplicity.
- The reference implementation covers nuScenes and SemanticKITTI.

## Training and Evaluation

- WaffleIron reports accuracy competitive with sparse-convolution and transformer backbones on nuScenes lidarseg and SemanticKITTI, despite its simplicity.
- It is trained with standard cross-entropy (often class-weighted or with Lovász-softmax) and standard point-cloud augmentation.
- It is the 3D backbone in **ScaLR**, where image-foundation-model features are distilled into it — evidence that it is a clean target for pre-training.
- Evaluation uses per-class IoU and mIoU.

## Strengths

- Built only from standard operations (dense 2D conv, MLP) — easy to implement, profile, optimize, and deploy; no custom kernels to maintain.
- Dense 2D convolution is the best-optimized GPU primitive — strong hardware efficiency.
- Competitive accuracy at a fraction of the implementation complexity of sparse-conv or transformer stacks.
- A clean, well-behaved target for pre-training and distillation (used by ScaLR).
- The deployment-friendliness is a real advantage for a team that wants to avoid a sparse-conv dependency.

## Failure Modes

- The 2D projection has a resolution trade-off like voxelization — too coarse a grid loses thin classes, too fine costs memory.
- Projecting to 2D planes discards some 3D structure each block; alternating planes mitigates but does not fully remove this.
- Accuracy is competitive but generally a little below the top transformer backbones.
- A smaller ecosystem and fewer pre-trained checkpoints than sparse-conv or PTv3.
- Like any 3D model, output quality is capped by input conditioning.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV (on-vehicle) | strong | Standard-ops simplicity and dense-conv efficiency suit an embedded real-time segmenter. |
| Road AV (offline / maps) | conditional | A viable, easy-to-deploy backbone for aggregated-map segmentation, tiled; the top transformers edge it on accuracy. |
| Airside | conditional | No airside checkpoints exist; attractive when the team wants to avoid a sparse-conv/transformer dependency. |
| Warehouse / port / mining / construction / agriculture | conditional | Transfers as a generic, deployment-friendly 3D backbone. |

## Implementation Notes

- Choose it when implementation simplicity and a clean dependency footprint matter — it needs only a standard deep-learning stack.
- Tune the 2D-projection grid resolution to the smallest class that matters, as you would a voxel size.
- Use class-weighted or Lovász-softmax loss for the usual class-imbalance reasons.
- It is a strong pre-training target — ScaLR-style image-to-LiDAR distillation onto WaffleIron is a documented recipe.
- For aggregated-map segmentation, tile and merge as for any backbone (`../overview/aggregated-map-semantic-segmentation.md` §8).

## Sources

- WaffleIron paper: https://arxiv.org/abs/2301.10100
- Reference implementation: https://github.com/valeoai/WaffleIron
- Related repository page: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline
- Related repository page: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation
