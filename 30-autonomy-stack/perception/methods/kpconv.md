# KPConv

<!-- method-priority:start
priority:
  learning: 5
  deployment: 4
  type: "method"
  stage: "classic-baseline"
  maturity: "fielded-pattern"
  tags: ["perception", "lidar", "segmentation", "mapping", "road-av"]
  reason: "KPConv is the point-based-convolution workhorse for large-scale MLS/ALS point cloud semantic segmentation and a proven baseline for aggregated-map labeling."
method-priority:end -->

## What It Is

- KPConv (Kernel Point Convolution) is a convolution operator that acts directly on raw 3D points, introduced in "KPConv: Flexible and Deformable Convolution for Point Clouds" (ICCV 2019).
- It generalizes image convolution to unstructured point clouds without voxelizing or projecting them.
- It is most often used as the backbone of KP-FCNN, an encoder-decoder network for 3D semantic segmentation, and KP-CNN for shape classification.
- It is a long-standing, widely-reproduced baseline and a workhorse of the mobile- and airborne-laser-scanning (MLS/ALS) surveying industry.
- It comes in two forms — rigid and deformable — the latter adapting its kernel to local geometry.

## Core Technical Idea

- A KPConv kernel is defined by a set of **kernel points** placed in a local spherical neighborhood; each kernel point carries a learnable weight matrix.
- To convolve at a query point, every neighbor within a radius is assigned to the kernel points by a **correlation function** of Euclidean distance (closer neighbor → stronger weight from that kernel point).
- Each neighbor's features are transformed by the distance-weighted combination of kernel-point weight matrices and summed — a direct point-space analog of a grid convolution.
- **Rigid KPConv** fixes the kernel points in a regular arrangement; **deformable KPConv** learns per-location offsets so the kernel bends toward relevant local structure.
- Density is regularized by **grid subsampling** rather than raw points, giving stable neighborhoods and roughly uniform sampling.
- Because the kernel lives in continuous 3D space, KPConv preserves geometric detail that voxelization would discretize away.

## Inputs and Outputs

- Inputs: a point cloud as coordinates `(x, y, z)` and per-point features — a constant 1 if no features exist, or intensity/reflectance, RGB colour, normals.
- Pre-processing computes grid-subsampled points and radius neighborhoods; these are part of the data pipeline, not the network.
- Output: a per-point feature embedding; KP-FCNN's head turns it into per-point class logits for semantic segmentation.
- KP-CNN instead outputs a single label for shape classification.
- It is a backbone/operator, not a task model — it is paired with a segmentation, classification, or detection head.

## Architecture

- **KP-FCNN**: a U-Net-style encoder-decoder of KPConv layers with grid-subsampling pooling, nearest-upsampling, and skip connections — the standard segmentation network.
- Each encoder stage increases the subsampling grid size (coarser) and the convolution radius, growing the receptive field.
- Rigid KPConv layers are typical in shallow stages; deformable KPConv is used where fine adaptivity helps.
- A leaky-ReLU + batch-norm block follows each KPConv, as in image CNNs.
- Reference implementations exist in TensorFlow (original) and PyTorch (KPConv-PyTorch); the operator also ships inside several point-cloud frameworks.
- A modernized successor, **KPConvX** (CVPR 2024), adds kernel-point attention and depthwise modulation for higher accuracy at lower cost.

## Training and Evaluation

- KPConv reported state-of-the-art results in 2019 on Semantic3D, S3DIS, ScanNet, Paris-Lille-3D (NPM3D), and ShapeNetPart, and remains a strong, stable baseline.
- It is trained with standard cross-entropy (often class-weighted) plus point-cloud augmentation — rotation, scaling, jitter, and dropout.
- Training is stable but comparatively slow; convergence is reliable rather than fast.
- Evaluation uses per-class IoU and mIoU; KPConv is a common reference point on MLS/ALS leaderboards.
- For aggregated-map segmentation it is trained on sphere-sampled neighborhoods, which doubles as a natural tiling strategy — predict only the inner core of each sampled sphere.

## Strengths

- Operates on raw geometry — no voxelization or projection loss, so thin and fine structure is preserved.
- The deformable variant adapts the kernel to local shape, helping irregular and fine-grained classes.
- Stable, well-documented, and reproduced for years — a low-surprise baseline.
- Sphere-sampling inference is a built-in answer to large-cloud tiling, with uniform context and no axis-aligned seams.
- Proven mileage in the surveying/MLS industry — strong evidence it transfers to registered survey clouds.
- Works from a constant feature when no intensity/colour is available — robust to feature-poor inputs.

## Failure Modes

- Memory-heavy: radius neighbor search and kernel-point bookkeeping make it costly on large clouds, forcing sphere sampling.
- Slower than sparse-convolution backbones on modern GPUs, which matters for large offline batches.
- Grid subsampling can still under-sample very rare thin classes unless rare-class-aware seeding is added.
- Accuracy now trails transformer and superpoint backbones on most benchmarks.
- Custom neighbor-search ops make it less TensorRT-friendly than sparse-convolution for embedded deployment.
- Sensitive to the grid-subsampling size and convolution radius — these hyperparameters need tuning per density regime.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV (offline) | strong | Long-standing baseline on Paris-Lille-3D and other MLS benchmarks; solid for offline auto-labeling. |
| Road AV (on-vehicle) | weak | Memory and latency cost make it a poor fit for the embedded real-time budget. |
| Airside | conditional | No airside checkpoints exist; a dependable baseline once trained on airside data, and a natural fit for offline aggregated-map segmentation. |
| Aerial / survey (ALS, TLS) | strong | A documented workhorse of the MLS/ALS surveying industry for ground/vegetation/building/structure classification. |
| Warehouse / port / mining / construction / agriculture | conditional | Transfers as a generic geometry-faithful backbone; better offline than embedded. |

## Implementation Notes

- Set the grid-subsampling size to the resolution of the smallest class that matters — too coarse and markings/wires vanish before the network sees them.
- Use sphere sampling for map-scale clouds and commit only inner-core predictions, then merge with overlap voting.
- Reserve deformable KPConv for deeper stages; rigid KPConv is cheaper and adequate shallow.
- Class-weight the loss and seed extra spheres on rare classes — KPConv does not fix class imbalance on its own.
- Consider KPConvX if a modernized, more efficient point-convolution baseline is wanted.
- For embedded use, prefer a sparse-convolution backbone or distill KPConv into one rather than deploying it directly.

## Sources

- KPConv paper: https://arxiv.org/abs/1904.08889
- Original implementation (TensorFlow): https://github.com/HuguesTHOMAS/KPConv
- PyTorch implementation: https://github.com/HuguesTHOMAS/KPConv-PyTorch
- KPConvX (CVPR 2024 successor): https://arxiv.org/abs/2405.13194
- Related repository page: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline; §7.8 compares point-based convolution head-to-head against the other four model families
- Related repository page: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation
