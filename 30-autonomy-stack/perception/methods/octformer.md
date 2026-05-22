# OctFormer

<!-- method-priority:start
priority:
  learning: 4
  deployment: 3
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["perception", "lidar", "segmentation", "mapping"]
  reason: "OctFormer is an octree-based transformer for efficient semantic segmentation of large 3D point clouds and registered maps."
method-priority:end -->

## What It Is

- OctFormer is an octree-based transformer backbone for 3D point cloud understanding, introduced in "OctFormer: Octree-based Transformers for 3D Point Clouds" (SIGGRAPH 2023 / ACM TOG).
- It produces per-point features for downstream semantic segmentation, detection, and classification heads.
- Its purpose is to make point-cloud attention **scale to large scenes** by using an octree to organize points efficiently.
- It is a contemporary of the serialization-based transformers (PTv3) and shares their core trick — order points along a space-filling curve, then attend over contiguous windows.
- It is one of the efficient large-cloud transformer options for offline aggregated-map segmentation.

## Core Technical Idea

- Self-attention over raw points is quadratic and infeasible for million-point clouds; OctFormer makes it tractable with an **octree**.
- Points are stored in an octree and sorted by their octree **shuffle keys** (a space-filling-curve order), so spatially-near points become contiguous in memory.
- **Octree attention** partitions the sorted sequence into local windows that each contain a **fixed number of points** — not a fixed spatial volume. Because window size is by point count, attention cost is constant per window regardless of how dense or sparse that region is.
- **Dilated octree attention** enlarges the receptive field by grouping non-contiguous points (analogous to dilated convolution), so the model sees long-range context without larger windows.
- The fixed-point-count window is the key property for non-uniform clouds: it self-adapts to the density variation that an aggregated map always has.
- Complexity is near-linear in the number of points, so the backbone scales to large scenes.

## Inputs and Outputs

- Inputs: a point cloud as coordinates `(x, y, z)` plus per-point features — intensity/reflectance, RGB colour, or normals.
- An octree is built over the cloud as pre-processing; octree depth sets the spatial resolution.
- Output: per-point feature embeddings; a task head turns them into per-point class logits for semantic segmentation.
- It is a backbone, paired with a segmentation, detection, or classification head.
- No images are required; colour is an optional channel.

## Architecture

- A U-Net-style encoder-decoder of octree-attention blocks.
- The octree provides both the spatial sorting for attention windows and the pooling/unpooling hierarchy (coarser octree levels = down-sampled stages).
- Octree-attention and dilated-octree-attention blocks alternate so each point gains both local detail and long-range context.
- A conditional positional encoding injects fine geometric detail, as in other point transformers.
- Built on the author's octree library (the O-CNN / `ocnn` lineage), which supplies efficient octree construction and operators.
- The reference implementation covers ScanNet, ScanNet200, SemanticKITTI, S3DIS, and nuScenes configurations.

## Training and Evaluation

- OctFormer reports accuracy competitive with sparse-voxel and earlier transformer backbones across ScanNet, ScanNet200, SemanticKITTI, S3DIS, and nuScenes, at high efficiency on large clouds.
- It is trained with cross-entropy (often class-weighted) plus standard point-cloud augmentation.
- Its efficiency claim is the headline: near-linear scaling and low memory let it process large scenes that quadratic attention cannot.
- Evaluation uses per-class IoU and mIoU.
- For aggregated-map segmentation it is trained on tiles; the octree ordering, like serialization, is tile-friendly.

## Strengths

- The octree gives efficient spatial sorting and a ready-made pooling hierarchy in one structure.
- Fixed-point-count attention windows self-adapt to the non-uniform density of accumulated maps.
- Dilated octree attention supplies a large receptive field cheaply.
- Near-linear complexity — scales to large scenes and big tiles.
- A clean efficiency-oriented transformer alternative when sparse-voxel detail is insufficient.

## Failure Modes

- Octree construction and the octree operator library add tooling overhead and a dependency most teams do not already run.
- A smaller ecosystem and fewer pre-trained checkpoints than PTv3 or sparse-convolution backbones.
- The serialization-based PTv3 covers very similar ground and has overtaken it in adoption and pre-training ecosystem (PPT, Sonata).
- Octree depth caps spatial resolution, similar to a voxel-size trade-off.
- Like any transformer, training is more sensitive to schedule and augmentation than sparse-convolution.
- Quality is still capped by input conditioning — registration blur and residual dynamics degrade it.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV (offline) | conditional | Competitive on SemanticKITTI/nuScenes segmentation; a viable efficient transformer for offline auto-labeling, though PTv3 is the more common choice. |
| Road AV (on-vehicle) | weak | A large-cloud transformer; not aimed at the embedded real-time budget. |
| Airside | conditional | No airside checkpoints exist; a reasonable efficient-transformer option for offline aggregated-map segmentation once trained on airside data. |
| Aerial / survey (ALS, TLS) | conditional | The octree and fixed-count windows suit large, non-uniform survey clouds. |
| Warehouse / port / mining / construction / agriculture | conditional | Transfers as a generic large-cloud 3D backbone. |

## Implementation Notes

- Budget the octree-library dependency early — it is the main integration cost relative to a sparse-conv pipeline.
- Set octree depth to the resolution of the smallest class that matters, as you would a voxel size.
- For aggregated-map segmentation, tile into overlapping blocks and merge with logit averaging; octree ordering does not remove the need for tiling at map scale.
- Compare directly against a PTv3 and a sparse-conv baseline before adopting — the three occupy similar ground, and ecosystem maturity often decides.
- Use mixed precision for offline throughput.
- Report per-class IoU; efficiency does not by itself help the rare thin classes.

## Sources

- OctFormer paper: https://arxiv.org/abs/2305.03045
- Reference implementation: https://github.com/octree-nn/octformer
- O-CNN / octree library lineage: https://github.com/octree-nn/ocnn-pytorch
- Related repository page: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline
- Related repository page: `point-transformer-v3.md` — the serialization-based transformer covering similar ground
