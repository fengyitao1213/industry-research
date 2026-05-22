# MinkowskiNet

<!-- method-priority:start
priority:
  learning: 5
  deployment: 5
  type: "method"
  stage: "classic-baseline"
  maturity: "fielded-pattern"
  tags: ["perception", "lidar", "segmentation", "mapping", "road-av"]
  reason: "MinkowskiNet sparse-convolution U-Nets are the deployed industry-baseline backbone for 3D semantic segmentation, including offline aggregated-map labeling."
method-priority:end -->

## What It Is

- MinkowskiNet is a family of sparse 3D convolutional networks for point cloud understanding, introduced in "4D Spatio-Temporal ConvNets: Minkowski Convolutional Neural Networks" (CVPR 2019).
- It applies convolution to **sparse tensors** — only the non-empty voxels of a discretized cloud are stored and processed.
- Its segmentation network, **MinkUNet**, is a U-Net of sparse 3D convolutions and is the most common production backbone for 3D semantic segmentation.
- It generalizes sparse convolution to arbitrary dimensions, including **4D** (3D space + time), enabling spatio-temporal models.
- It is implemented in the Minkowski Engine, an auto-differentiation library for sparse tensors.

## Core Technical Idea

- A point cloud is quantized to a voxel grid, but a dense 3D tensor would be almost entirely empty and far too large — so MinkowskiNet stores only **active sites**: pairs of integer coordinates and feature vectors.
- **Sparse convolution** computes outputs only at active sites, using a kernel map that lists which input sites contribute to which output sites.
- The **submanifold / generalized sparse** formulation keeps the active-site set from dilating layer over layer, preserving sparsity and bounding compute.
- Because compute scales with the number of occupied voxels, not the volume, large outdoor scenes become tractable.
- The same operator extends to 4D, convolving across time as well as space for sequence models.
- The design trades a fixed voxel discretization for predictable, GPU-efficient computation.

## Inputs and Outputs

- Inputs: a point cloud quantized to voxel coordinates, with per-voxel features — intensity/reflectance, RGB colour, normals, or aggregation statistics.
- A voxel size is a required hyperparameter; it sets the resolution/memory trade-off.
- Output: per-voxel features, mapped back to per-point class logits for semantic segmentation (each point inherits its voxel's prediction).
- It is a backbone; it pairs with segmentation, panoptic, or detection heads.
- No images are required; colour is an optional input channel.

## Architecture

- **MinkUNet**: an encoder-decoder U-Net of sparse 3D convolutions with residual blocks and skip connections; common depths are denoted MinkUNet14/18/34.
- Strided sparse convolutions down-sample; sparse transposed convolutions up-sample; skip connections carry fine detail.
- The Minkowski Engine provides the sparse convolution, pooling, and broadcast operators with autodiff.
- Faster alternative sparse-convolution libraries — **TorchSparse** and **SpConv** — implement the same operator family with optimized kernels and are widely used in its place.
- The backbone underlies many later systems: 3D detectors, panoptic-segmentation heads, and self-supervised pre-training pipelines.

## Training and Evaluation

- MinkowskiNet was state-of-the-art on ScanNet in 2019 and remains a strong, stable baseline on SemanticKITTI, nuScenes, Semantic3D, and S3DIS.
- It is trained with cross-entropy (often class-weighted or Lovász-softmax) plus standard augmentation — rotation, scaling, flip, elastic distortion, voxel dropout.
- Training is fast and well-behaved — stable convergence, low augmentation sensitivity, predictable epochs — which is a large practical advantage.
- Evaluation uses per-class IoU and mIoU.
- For aggregated-map segmentation it is trained on overlapping tiles with halo regions; tile-level parallelism across GPUs is the main throughput lever.

## Strengths

- Excellent accuracy-to-efficiency ratio and the most **predictable** family to train — stable, fast, low-surprise.
- Mature, production-grade tooling (Minkowski Engine, TorchSparse, SpConv) and years of reproduction.
- The cleanest path to a TensorRT-deployable single-scan sibling — the same backbone can serve offline map and on-vehicle models.
- Memory scales with occupied voxels, so large outdoor scenes are tractable.
- Extends to 4D for spatio-temporal tasks such as moving-object segmentation.
- The de facto industry-baseline backbone — broad ecosystem support and well-understood failure behavior.

## Failure Modes

- Voxelization caps the resolution of thin classes — markings, wires, and kerbs can fall below the voxel grid and be lost before the network sees them.
- Finer voxels recover detail but raise memory and compute steeply — the central resolution/memory trade-off.
- Quantization merges points within a voxel, discarding sub-voxel geometry that point-based methods keep.
- Accuracy now trails transformer and superpoint backbones at the top of leaderboards, though the gap is modest.
- The original Minkowski Engine has had maintenance and build-compatibility friction; many teams migrate to TorchSparse or SpConv.
- Like any 3D model, output quality is capped by input conditioning — registration blur and un-removed dynamics still hurt.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV (offline) | strong | A standard, stable backbone on SemanticKITTI and nuScenes; reliable for offline auto-labeling and HD-map semantic layers. |
| Road AV (on-vehicle) | strong | Sparse convolution is the most embedded-friendly family; the realistic backbone for a real-time single-scan segmenter. |
| Airside | conditional | No airside checkpoints exist; the lowest-risk training choice once airside data exists, for both offline map and on-vehicle models. |
| Aerial / survey (ALS, TLS) | strong | Handles dense registered survey clouds well at a chosen voxel resolution. |
| Warehouse / port / mining / construction / agriculture | conditional | Transfers as a generic, deployable 3D backbone across registered-cloud and embedded tasks. |

## Implementation Notes

- Choose the voxel size deliberately — 2-5 cm for airside maps; too coarse and the marking/wire classes are lost, too fine and memory blows up.
- Prefer TorchSparse or SpConv over the original Minkowski Engine for new work unless an existing pipeline depends on it.
- Use Lovász-softmax or class-weighted loss — voxelization does not fix class imbalance.
- For aggregated maps, tile with halo regions and merge by per-class logit averaging; checkpoint per tile so long batches are resumable.
- Keep a voxel-to-point index so labels propagate back to full-resolution points.
- Multi-resolution or two-stage refinement helps thin classes without globally shrinking the voxel size.

## Sources

- MinkowskiNet paper: https://arxiv.org/abs/1904.08755
- Minkowski Engine: https://github.com/NVIDIA/MinkowskiEngine
- TorchSparse (optimized sparse-conv library): https://github.com/mit-han-lab/torchsparse
- SpConv (optimized sparse-conv library): https://github.com/traveller59/spconv
- SparseConvNet / submanifold sparse convolution: Graham et al., "3D Semantic Segmentation with Submanifold Sparse Convolutional Networks" (CVPR 2018)
- Related repository page: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline
- Related repository page: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation
