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
- It is implemented in the Minkowski Engine, an auto-differentiation library for sparse tensors; faster drop-in replacements (SpConv v2, TorchSparse++) are standard in production.
- See also: `cylinder3d.md` for the sensor-geometry-aligned cylindrical alternative (single-scan only).

## Core Technical Idea

- A point cloud is quantized to a voxel grid, but a dense 3D tensor would be almost entirely empty and far too large — so MinkowskiNet stores only **active sites**: pairs of integer coordinates and feature vectors.
- **Sparse convolution** computes outputs only at active sites, using a kernel map that lists which input sites contribute to which output sites.
- The **submanifold / generalized sparse** formulation keeps the active-site set from dilating layer over layer, preserving sparsity and bounding compute.
- Because compute scales with the number of occupied voxels, not the volume, large outdoor scenes become tractable.
- The same operator extends to 4D, convolving across time as well as space for sequence models.
- The design trades a fixed voxel discretization for predictable, GPU-efficient computation.

## Inputs and Outputs

- Inputs: a point cloud quantized to voxel coordinates, with per-voxel features — intensity/reflectance, RGB colour, normals, or aggregation statistics (mean, max).
- A voxel size is a required hyperparameter; it sets the resolution/memory trade-off.
- Output: per-voxel features, mapped back to per-point class logits for semantic segmentation (each point inherits its voxel's prediction).
- It is a backbone; it pairs with segmentation, panoptic, or detection heads.
- No images are required; colour is an optional input channel.

## Sparse Convolution Mechanics

### Generalized Sparse Convolution

Choy et al. (CVPR 2019) define generalized sparse convolution as:

```
x_u_out = sum over i in N^D(u, C_in) of: W_i * x_{u+i}_in   for u in C_out
```

Where `C_in` and `C_out` are arbitrary sets of active (non-empty) coordinates in integer D-dimensional space, `N^D(u, C_in)` is the kernel neighborhood of point `u` intersected with `C_in`, and `W_i` are per-offset weight matrices. This formulation subsumes all standard convolutions as special cases:

- **Dense convolution**: `C_in = C_out = Z^D` (full integer lattice)
- **Sparse convolution**: `C_in` sparse, `C_out` = every output site where at least one kernel offset touches an input active site (active set expands)
- **Submanifold sparse convolution**: `C_in = C_out` exactly (active set is preserved unchanged)

### Submanifold Sparse Convolution

Graham and van der Maaten (2017) introduced the key constraint: an output site is active if and only if the corresponding input site is active — i.e., the kernel center must land on an active site. This solves the "submanifold dilation problem": with regular sparse convolution, a single occupied voxel after a 3×3×3 kernel produces up to 27 active outputs, which doubles roughly each layer. Submanifold convolution keeps the active set identical to the input, which is essential during the encoder phases of the U-Net where sparsity must be preserved.

In practice: the kernel is padded by `floor((f-1)/2)` so the output spatial size matches the input, and computation at each output site only occurs when the kernel center coincides with an occupied voxel.

### Kernel Map / Rule Book

The key data structure enabling efficient GPU execution is the **kernel map** (also called a "rule book"):

```
M = { (I_i, O_i) }   for each kernel offset i in N^D
```

where `I_i` and `O_i` are ordered lists of input and output voxel indices that participate in computation at kernel offset `i`.

Construction proceeds in three steps:
1. **Hash-table lookup**: for each occupied input site `u`, query a hash table for `u + i` in `C_out`
2. **Store matched pairs**: `(u, u+i)` are appended to the rule book entry for offset `i`
3. **GPU dispatch**: for each kernel offset `i`, run a batched matrix multiplication across all matched `(I_i, O_i)` pairs

The rule book plays the same role as `im2col` in dense CNNs but is sparse — it converts scattered coordinate lookups into scheduled atomic operations that can be parallelized on the GPU. For offline aggregated-map inference the rule book can in principle be cached if the occupancy pattern does not change between tiles; in practice each tile has a distinct layout so rebuilding is required, but build time is typically 1–5% of total inference time.

Two major GPU dataflow patterns exist:

- **Gather-GEMM-Scatter (GMS)**: gather input features by rule book, run a GEMM per kernel offset, scatter results to output. Conceptually simple but causes many small GEMM calls with high kernel-launch overhead.
- **Implicit GEMM**: fuses the gather step into the GEMM itself — input features are fetched by index during the matrix multiply, intermediates live in shared memory. Eliminates the expanded `im2col` buffer and reduces global-memory traffic substantially. SpConv v2 and TorchSparse++ use implicit GEMM as their primary path.

### Complexity

| Method | Memory | Multiply-adds |
|--------|--------|---------------|
| Dense 3D conv (kernel K, grid N) | O(N^3) | O(N^3 * K^3) |
| Sparse conv (M occupied voxels) | O(M) | O(M * K^3) |
| Submanifold sparse conv | O(M) | O(M * avg_neighbors * C_in * C_out) |

For outdoor LiDAR at 5 cm voxels over a 100 m × 100 m × 4 m volume the grid is 2000 × 2000 × 80 ≈ 320 M cells. Typical outdoor occupancy is 0.01–0.1%, so M / N^3 ≈ 0.001 — roughly 1000× fewer multiply-adds than dense convolution on the same volume.

## Architecture

### MinkUNet Variants

MinkUNet is a U-Net adapted for sparse tensors. The encoder uses strided sparse convolutions (stride 2) for downsampling; submanifold sparse convolutions within each block maintain the active-site count. The decoder uses sparse transposed convolutions for upsampling, with skip connections from the encoder at each resolution level. A final per-voxel linear classification head outputs semantic logits.

Each block is either a BasicBlock (two 3×3×3 submanifold convolutions + BN + ReLU with residual) or a Bottleneck (1×1×1, 3×3×3, 1×1×1 + BN + ReLU). Depth and width are varied across published variants:

| Variant | Depth | Stage counts | Base channels |
|---------|-------|--------------|---------------|
| MinkUNet18-W16 | 18 | (2,2,2,2,2,2,2,2) | 16 |
| MinkUNet18-W32 | 18 | (2,2,2,2,2,2,2,2) | 32 |
| MinkUNet34-W32 | 34 | (2,3,4,6,2,2,2,2) | 32 |
| MinkUNet34v2-W32 | 34 | (2,3,4,6,2,2,2,2) | 32 |

MinkUNet34-W32 at ~37.9 M parameters is the most common production variant. The first layer uses a 5×5×5 sparse convolution (analogous to the 7×7 stem in 2D ResNet).

### 4D Extension

For spatio-temporal tasks (multi-scan moving-object segmentation, temporal consistency), MinkowskiNet natively handles 4D coordinates. The 4D kernel uses a **hybrid design** — a cubic spatial kernel cross-shaped in the temporal dimension — which reduces parameters compared to a full 4D tesseract kernel while maintaining temporal receptive field.

### Engine Options

The same MinkUNet architecture can be instantiated with three production sparse-convolution engines:

| Engine | Dataflow | Key strength | Embedded story |
|--------|----------|--------------|----------------|
| Minkowski Engine v0.5.4 | GMS + hash lookup | Richest API; research reference | Not suitable for Orin production |
| SpConv v2 (traveller59) | Implicit GEMM, fp16, int8 | Widest ecosystem; TensorRT C++ path | Deployed on Orin via pure C++ library |
| TorchSparse++ (MIT HAN Lab) | Sparse Kernel Generator + Autotuner | Fastest on A100 and Orin benchmarks | Best measured Orin perf (MICRO 2023) |

SpConv v2 is the most widely deployed in production AV stacks (OpenPCDet, mmdetection3d, CenterPoint). TorchSparse++ is the fastest measured option: on A100 it runs 2.9× faster than Minkowski Engine, 3.3× faster than SpConv 1.2, and 1.7× faster than SpConv v2.3.5; on Jetson Orin it is 1.25× faster than SpConv 2.3.5 on AV detection workloads. The Minkowski Engine is the academic reference and the right choice when prototyping novel kernel geometries or 4D models.

**Kernel-map construction accelerator:** Minuet (arXiv 2401.06145) replaces hash-table coordinate lookups with a cache-conscious sorted binary-search scheme plus a GPU-cache-aware data layout. It targets the rule-book build step specifically and is relevant when kernel-map construction is the latency bottleneck (e.g., highly irregular occupancy patterns).

## Variants and Lineage

**SPVCNN / SPVNAS (ECCV 2020)** adds a parallel high-resolution point branch to the MinkUNet voxel branch. At each resolution level, voxel features are trilinearly interpolated back to point coordinates and fused with per-point MLP features. The point branch adds less than 5% overhead to FLOPs but improves thin-structure accuracy (poles, cyclists). SPVNAS applies 3D Neural Architecture Search to find a latency-accuracy Pareto front. See §7.8 of `../overview/aggregated-map-semantic-segmentation.md` for a direct comparison.

**(AF)²-S3Net (CVPR 2021)** adds attention-based multi-branch feature fusion in the encoder and adaptive feature selection in the decoder to a Minkowski Engine backbone, reaching 69.7% mIoU on SemanticKITTI test — then-state-of-the-art — and demonstrating that attention augmentation substantially lifts over plain MinkUNet.

**2DPASS (ECCV 2022)** uses MinkowskiNet or SPVCNN as its 3D backbone and distills 2D image features into it during training via multi-scale fusion-to-single knowledge distillation. At inference only the LiDAR 3D network runs; the 2D stream is training-only. This is directly applicable to offline aggregated maps where paired camera imagery is available for annotation training.

**OA-CNNs (CVPR 2024)** adds two plug-in modules to any sparse CNN: adaptive receptive fields (multi-scale voxel pyramid with learned scale-preference weights) and Adaptive Relation Convolution (ARConv) with dynamic kernel weights per voxel. It reaches 70.6% mIoU on SemanticKITTI val while being less than 5× slower than simpler point-transformer alternatives — the current best sparse-CNN result.

## Training Recipe

The following recipe reflects mmdetection3d and the empirical study (arXiv 2405.14870):

| Parameter | Value |
|-----------|-------|
| Optimizer | AdamW |
| Initial LR | 0.01 (OneCycle schedule) or 0.24 (cosine annealing) |
| LR schedule | OneCycle or cosine annealing |
| Batch size | 2 per GPU, typically 8× GPUs |
| Epochs | 50 (SemanticKITTI) or 80 (nuScenes-lidarseg) |
| Voxel size | 0.05 m for both benchmarks |
| Loss | Cross-entropy + Lovász-softmax (equal weight) |
| Augmentations | Global: random rotation, translation, scaling, flip; per-cloud: LaserMix + PolarMix |
| Data mixing | LaserMix + PolarMix combined gives +3.5% mIoU over vanilla augmentation |
| Test-time augmentation (TTA) | Multi-transform voting: +1.4% mIoU; 108× inference cost — offline only |

**Why Lovász-softmax?** Cross-entropy optimizes per-voxel accuracy; the evaluation metric (mIoU) is the mean Jaccard index, which is non-differentiable. Lovász-softmax (Berman et al. CVPR 2018, arXiv 1705.08790) is the convex Lovász extension of the Jaccard index — a tractable IoU surrogate. Common practice is to train initial epochs with cross-entropy, then fine-tune with Lovász, or to use both at equal weight throughout. This matters especially for rare airside classes (edge lights, markings) where per-voxel accuracy would be satisfied by ignoring them.

**LaserMix** and **PolarMix** are LiDAR-specific copy-paste mixing augmentations that operate on laser-beam partitions or polar regions of the scan, effectively synthesizing new scene configurations. Their combined application to MinkUNet yields the largest single augmentation gain in the arXiv 2405.14870 study.

## Benchmark Results

### SemanticKITTI (20 classes, mIoU)

| Variant | Val mIoU | Test mIoU | Conditions | Source |
|---------|----------|-----------|------------|--------|
| MinkowskiNet (original 2019) | 73.3% | — | baseline | Choy et al. CVPR 2019 |
| MinkUNet18-W32 | 63.1% | — | 15 epochs, TorchSparse | mmdetection3d |
| MinkUNet34-W32 | 69.2–69.3% | — | 3× LR, Minkowski/SpConv | mmdetection3d |
| MinkUNet34v2-W32 | 70.3% | — | 3× LR, TorchSparse, LaserPolarMix | mmdetection3d |
| MinkUNet + mix + TTA | 71.8% | — | AdamW, 50 ep, A100 ×8 | arXiv 2405.14870 |
| (AF)²-S3Net | — | 69.7% | attention-augmented | Cheng CVPR 2021 |
| 2DPASS (6s-256d) + TTA | 72.0% | — | with 2D distillation | Yan ECCV 2022 |
| OA-CNNs | 70.6% | — | adaptive receptive field | Peng CVPR 2024 |

### ScanNet v2 (20 classes, mIoU — indoor 3D reconstruction)

| Variant | Val mIoU | Voxel size | Source |
|---------|----------|------------|--------|
| MinkowskiNet42 (5 cm) | 67.9% | 5 cm | Choy et al. CVPR 2019 |
| MinkowskiNet42 (2 cm) | 73.4% | 2 cm | Choy et al. CVPR 2019 |
| OA-CNNs | 76.1% | — | Peng CVPR 2024 |

### S3DIS Area 5 (13 classes, mIoU — indoor scans)

| Variant | mIoU | Source |
|---------|------|--------|
| MinkUNet20 | 62.60% | Choy et al. CVPR 2019 |
| MinkUNet32 | 65.35% | Choy et al. CVPR 2019 |

### nuScenes-lidarseg (16 classes, mIoU)

| Variant | Val mIoU | Conditions | Source |
|---------|----------|------------|--------|
| MinkUNet + mix + TTA | 80.1% | AdamW, 80 ep | arXiv 2405.14870 |

### SPVCNN / SPVNAS reference (SemanticKITTI val, for context)

| Variant | GMACs | mIoU | Source |
|---------|-------|------|--------|
| MinkowskiNet@29G | 29 | 58.9% | Tang ECCV 2020 |
| SPVCNN@119G | 119 | 63.7 ± 0.4% | Tang ECCV 2020 |
| SPVNAS@65G | 65 | 64.7% | Tang ECCV 2020 |

Note: the SPVCNN/SPVNAS numbers reflect the original ECCV 2020 training recipe; mmdetection3d reproductions with improved recipes yield higher baselines for both families.

## Complexity and Compute

**Inference latency (MinkUNet34-W32):** ~28.7 FPS on an unspecified GPU (arXiv 2405.14870). On Jetson Orin with SpConv v2 or TorchSparse++ backend, estimated 3–8 FPS at 5 cm voxels for a typical single 64-beam scan (extrapolated from engine benchmarks; no direct published figure confirmed at time of writing).

**Memory scaling for aggregated maps:** For a 100 m × 100 m × 20 m tile at 10 cm voxels, the grid is 1000 × 1000 × 200 = 200 M cells. At 0.1–1% occupancy this yields 200 K–2 M active voxels. Feature memory at 32 channels in fp32 per layer is approximately 2 M × 32 × 4 bytes = 256 MB; the full U-Net requires 4–8 GB GPU memory per tile at these settings, which is feasible on A6000 or H100 but marginal on A10G.

**Voxel size vs. active voxel count:** Halving voxel size (e.g., 10 cm → 5 cm) increases active voxels by up to 8× for a dense aggregated cloud. Memory and compute scale linearly with active voxel count, not with the grid volume, so sparse convolution remains tractable but the constant factor matters when sizing GPU hardware.

## Strengths

- Excellent accuracy-to-efficiency ratio and the most **predictable** family to train — stable convergence, fast, low-surprise.
- Mature, production-grade tooling (Minkowski Engine, TorchSparse, SpConv) and years of reproduction across multiple codebases.
- The cleanest path to a TensorRT-deployable single-scan sibling — the same backbone can serve offline map and on-vehicle models.
- Memory scales with occupied voxels, so large outdoor scenes are tractable; a 500 m × 500 m × 20 m volume at 5 cm is feasible in sparse representation.
- Extends to 4D for spatio-temporal tasks such as moving-object segmentation and temporal consistency.
- The de facto industry-baseline backbone — broad ecosystem support (OpenPCDet, mmdetection3d) and well-understood failure behavior.
- Cartesian coordinate frame matches aggregated multi-scan maps naturally — no single sensor origin assumed.

## Failure Modes

- Voxelization caps the resolution of thin classes — markings, wires, and kerbs can fall below the voxel grid and be lost before the network sees them.
- Finer voxels recover detail but raise memory and compute steeply — the central resolution/memory trade-off.
- Quantization merges points within a voxel, discarding sub-voxel geometry that point-based methods keep.
- Accuracy now trails transformer and superpoint backbones at the top of leaderboards, though the gap is modest (OA-CNNs partially closes it while remaining sparse-CNN efficient).
- The original Minkowski Engine has had maintenance and build-compatibility friction; most teams migrate to TorchSparse or SpConv.
- Spinning-LiDAR density mismatch: near-sensor voxels may contain hundreds of points while far-sensor voxels contain one or two — the network sees the same voxel feature regardless, but the implicit confidence differs.
- No geometry-aware neighborhoods: fixed cubic kernels are applied regardless of local surface orientation, unlike KPConv or PointTransformer; this can cause confusion between geometrically similar but semantically different structures at the same range.

## Domain Fit

| Domain | Fit | Note |
|--------|-----|------|
| Road AV (offline) | strong | A standard, stable backbone on SemanticKITTI and nuScenes; reliable for offline auto-labeling and HD-map semantic layers. |
| Road AV (on-vehicle) | strong | Sparse convolution is the most embedded-friendly family; the realistic backbone for a real-time single-scan segmenter. |
| Airside (aggregated map) | strong | Cartesian frame aligns with world-coordinate map; tiled processing handles the large apron area; recommended architecture for airside semantic mapping. |
| Airside (on-vehicle) | conditional | No airside checkpoints exist; the lowest-risk training choice once airside data exists, for both offline map and on-vehicle models. |
| Aerial / survey (ALS, TLS) | strong | Handles dense registered survey clouds well at a chosen voxel resolution. |
| Warehouse / port / mining / construction / agriculture | conditional | Transfers as a generic, deployable 3D backbone across registered-cloud and embedded tasks. |

## Aggregated-Map Suitability

MinkowskiNet / MinkUNet is the **primary recommendation** for 3D semantic segmentation of aggregated multi-scan LiDAR maps. The reasons are structural:

**Coordinate frame alignment:** An aggregated map is assembled from multiple scans registered to a world coordinate frame (via SLAM, ICP, or pose-graph optimization). The resulting point cloud has no single sensor origin. Cylindrical methods (Cylinder3D, SphereFormer, PolarNet) define their voxelization relative to an ego-vehicle origin — that assumption breaks entirely for multi-viewpoint clouds. Cartesian voxels partition the world frame directly and impose no assumption about where points came from.

**Density uniformity after aggregation:** Single-scan cylindrical voxels are designed to counteract the 1/r² density falloff of a spinning LiDAR. After aggregating many scans from different positions, density becomes nearly uniform across the scene — the original motivation for cylindrical voxels disappears, and their radial distortion becomes a liability.

**Rectangular tiling:** Large-scene inference is tiled by subdividing the world bounding box. Cartesian tiles are axis-aligned rectangles — straightforward to define, overlap, and stitch. Cylindrical tiling requires clipping to radial sectors, which does not tile uniformly over a 2D map.

**Infrastructure class alignment:** Flat surfaces (runways, taxiways, apron, floor slabs) have normals along the z-axis. Cartesian kernels process z uniformly. Cylindrical kernels apply azimuthal slicing that is geometrically misaligned with these horizontal surfaces.

**Voxel size selection for airside:**

| Scenario | Recommended voxel | Rationale |
|----------|-------------------|-----------|
| High-detail annotation (markings, edge lights) | 2–5 cm | Matches scan resolution; preserves structures < 10 cm |
| HD map construction (roads, buildings) | 10 cm | Memory tractable for 1 km²; retains GSE and aircraft detail |
| Large campus / full airport apron | 15–20 cm | Required for GPU memory with MinkUNet34 at full scene |
| 500 m × 500 m × 20 m at 5 cm | ~4 × 10^9 grid cells, ~4 M occupied | Feasible with sparse conv on A100-class GPU |
| 500 m × 500 m × 20 m at 20 cm | ~250 M grid cells, ~2.5 M occupied | Very fast; appropriate for first-pass annotation |

**Tiling procedure:**
1. Divide the world-frame bounding box into tiles of 80–100 m × 80–100 m × 20 m.
2. Add a 5–10 m overlap halo between adjacent tiles to prevent context discontinuity at edges.
3. Process each tile independently through MinkUNet.
4. For points in the overlap zone, average softmax scores from the two tiles.
5. Assemble the final per-point label map from tile outputs.

**Recommended airside config:** MinkUNet34-W32 (or OA-CNNs for adaptive receptive fields on flat/complex transitions), 10–15 cm voxels, CE + Lovász loss, classes: runway, taxiway, apron, building, aircraft, GSE, vehicle, pedestrian, vegetation, marking, edge-light, fence.

## Implementation Notes

- Choose the voxel size deliberately — 2–5 cm for high-detail airside maps (markings, edge lights); 10–15 cm for large-area coverage. Too coarse and the marking/wire classes are lost; too fine and memory blows up.
- Prefer a maintained, optimized library over the original Minkowski Engine for new work unless an existing pipeline depends on it — **TorchSparse++** is the current high-performance default (1.7–3.3× A100 inference speedups over older sparse-conv libraries); SpConv v2 and TorchSparse remain solid production choices.
- For TensorRT deployment on Jetson Orin, use SpConv v2's pure C++ library; pre-built Orin artifacts are available at [SilvesterHsu/spconv-builder](https://github.com/SilvesterHsu/spconv-builder).
- Use Lovász-softmax or class-weighted cross-entropy — voxelization does not fix class imbalance, and rare airside classes (edge lights, markings) need explicit loss weighting.
- For aggregated maps, tile with halo regions and merge by per-class logit averaging; checkpoint per tile so long batches are resumable.
- Keep a voxel-to-point index so labels propagate back to full-resolution points.
- Multi-resolution or two-stage refinement helps thin classes without globally shrinking the voxel size.
- LaserMix + PolarMix augmentations give the largest single gain (+3.5% mIoU) and should be included in any production training run.
- TTA (multi-transform voting) adds ~1.4% mIoU at 108× inference cost — use for offline map annotation, not on-vehicle inference.
- SPVCNN/SPVNAS can be substituted for MinkUNet when thin-structure accuracy (poles, pedestrians) is critical; the dual-branch point+voxel design preserves sub-voxel geometry detail.

## Sources

- MinkowskiNet paper: https://arxiv.org/abs/1904.08755 (Choy et al. CVPR 2019)
- Submanifold sparse convolution: https://arxiv.org/abs/1706.01307 (Graham & van der Maaten 2017)
- Submanifold sparse conv 3D segmentation: https://arxiv.org/abs/1711.10275 (Graham, Engelcke, van der Maaten CVPR 2018)
- Minkowski Engine GitHub: https://github.com/NVIDIA/MinkowskiEngine
- Minkowski Engine sparse tensor docs: https://nvidia.github.io/MinkowskiEngine/sparse_tensor_network.html
- SpConv v2 GitHub: https://github.com/traveller59/spconv
- SpConv pure C++ / Jetson Orin builder: https://github.com/SilvesterHsu/spconv-builder
- TorchSparse++ paper (MICRO 2023): https://arxiv.org/abs/2311.12862
- TorchSparse GitHub: https://github.com/mit-han-lab/torchsparse
- SPVCNN / SPVNAS paper (ECCV 2020): https://arxiv.org/abs/2007.16100
- SPVNAS GitHub: https://github.com/mit-han-lab/spvnas
- (AF)²-S3Net paper (CVPR 2021): https://arxiv.org/abs/2102.04530
- 2DPASS paper (ECCV 2022): https://arxiv.org/abs/2207.04397
- OA-CNNs paper (CVPR 2024): https://arxiv.org/abs/2403.14418
- Lovász-Softmax loss: https://arxiv.org/abs/1705.08790 (Berman et al. CVPR 2018)
- Minuet paper (2024): https://arxiv.org/abs/2401.06145
- Empirical training study: https://arxiv.org/html/2405.14870v2
- mmdetection3d MinkUNet config README: https://huggingface.co/gntmky/mm3dtest/blob/main/configs/minkunet/README.md
- How sparse convolution works: https://towardsdatascience.com/how-does-sparse-convolution-work-3257a0a8fd1/
- Sparse submanifold convolutions explainer: https://medium.com/geekculture/3d-sparse-sabmanifold-convolutions-eaa427b3a196
- Related repository page: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline; §7.8 compares sparse-voxel conv head-to-head against the other four model families
- Related repository page: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation
- Related method page: `cylinder3d.md` — cylindrical sparse-voxel baseline; its limitations for aggregated maps are the mirror image of the strengths described here
