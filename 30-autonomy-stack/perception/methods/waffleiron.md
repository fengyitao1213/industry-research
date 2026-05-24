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

- WaffleIron is a backbone for LiDAR point cloud semantic segmentation, introduced in "Using a Waffle Iron for Automotive Point Cloud Semantic Segmentation" (ICCV 2023, Valeo AI).
- Its design goal is **simplicity**: it is built almost entirely from standard dense 2D convolutions and pointwise MLPs — no sparse convolutions, no kernel-point operators, no custom point-cloud CUDA kernels.
- It shows that a deliberately plain architecture, using only well-optimized off-the-shelf operations, can be competitive with sparse-convolution and transformer backbones.
- It is the backbone used by the ScaLR image-to-LiDAR distillation pre-training method (DINOv2 ViT-L/14 distilled into WaffleIron across three datasets).
- It fills the **projection-based** slot in the architecture landscape — distinct from point-conv, sparse-voxel, and transformer families.
- Two size variants exist: WaffleIron-48-256 (6.8 M parameters) and WaffleIron-48-384 (15.1 M parameters).

## Core Technical Idea

- A point cloud is irregular; the usual responses are sparse convolution, point operators, or attention — all of which need specialized implementations.
- WaffleIron instead alternates two cheap, standard operations: (a) a **pointwise MLP** that mixes features per point, and (b) a **project-convolve-lift** step — project the per-point features onto a dense 2D grid along one coordinate plane, apply a **standard dense 2D convolution**, then scatter the result back to the points.
- The "waffle iron" metaphor: the cloud is repeatedly squashed flat onto a plane, pressed with a 2D convolution, and lifted back — alternating *which* plane is used so 3D structure is covered across layers.
- Because the spatial mixing is a dense 2D convolution, it runs on the most heavily-optimized GPU primitive available, with no custom kernels.
- The thesis mirrors the PTv3 lesson from the other direction: a simple, standard operator at scale beats a sophisticated specialized one.
- Crucially, no encoder-decoder hierarchy is used — all points are processed at full resolution throughout the network, which means no farthest-point sampling and no nearest-neighbour search at any stage.

## Operator Mechanics

The fundamental building block is the **WaffleIron (WI) Block**, which implements:

```
WI(F) = Inflat ∘ Conv ∘ Flat(F)
```

### Step 1 — Flat (3D → 2D projection)

Given a set of per-point feature vectors `F ∈ ℝ^{N×C}` and corresponding 3D coordinates, each point is mapped to a 2D cell on an `M×M` grid by dropping one coordinate axis. For the xy-projection, point `i` at `(x_i, y_i, z_i)` maps to cell `(floor(x_i / ρ), floor(y_i / ρ))` where `ρ` is the grid resolution in metres.

Multiple points can fall in the same cell. Their features are averaged:

```
F_grid[u, v] = mean { F_i : cell(i) = (u, v) }
```

Formally, using a sparse mapping matrix `S ∈ {0,1}^{M²×N}`:

```
Flat(F) = S · F  ⊘  (N_cell · S)
```

where `N_cell` is the per-cell point count (for normalisation) and `⊘` is element-wise division.

### Step 2 — Conv (dense 2D convolution)

A standard 3×3 dense 2D convolution with ReLU activation is applied to the `M×M×C` feature map. This is identical to a standard image convolution — no custom kernels, no sparsity bookkeeping.

### Step 3 — Inflat (2D → 3D back-projection)

Each point copies its cell's output features:

```
F_i ← F_grid[cell(i)]
```

All points in the same cell receive the same spatial feature from this step; the per-point diversity is reintroduced by the pointwise MLP in the next block.

### Axis-Cycling

The projection axis cycles across blocks in the sequence `xy → xz → yz → xy → xz → yz → ...`. This ensures that geometric structure in all three principal directions is captured: vertical structure (e.g. walls, vehicles) is captured by `xz` and `yz` projections; planar structure (e.g. ground, apron surface) by `xy`.

With L=48 blocks, each axis is visited 16 times. Geometric awareness accumulates across the depth of the network rather than through a hierarchical encoder.

### Channel-Mixing (Pointwise MLP)

Between WI blocks, a pointwise MLP with batch normalisation and residual connections mixes per-point features in the channel dimension. This step is per-point — no spatial interaction — and is the standard fully-connected layer applied independently at each point.

### No Sparse Convolution Dependency

The Flat/Inflat operations are implemented as matrix multiplications with fixed sparse matrices derived from the point-to-cell mapping. Any framework supporting dense 2D convolutions is sufficient: PyTorch, TensorFlow, TensorRT, OpenVINO, AMD ROCm. There is no dependency on MinkowskiEngine, SpConv, or torchsparse.

## Key Hyperparameters

| Parameter | Description | Typical value | Sensitivity |
|-----------|-------------|---------------|-------------|
| `ρ` | Grid resolution (metres per cell) | 40–60 cm | Stable ±1 mIoU over 40–80 cm range |
| `L` | Number of WI blocks | 48 | Deeper = better; 48 is the reference |
| `F` | Feature channel width | 256 or 384 | 384 adds ~8 M params; modest gain |
| `M` | Grid side length | Derived from `ρ` and scene extent | Set to cover the scene at resolution `ρ` |

The robustness of `ρ` over a 2× range (40–80 cm) is a practical advantage: the same checkpoint generalises to data collected at slightly different resolutions without re-tuning.

## Inputs and Outputs

- Inputs: a point cloud as coordinates `(x, y, z)` plus per-point features — intensity/reflectance and, where available, colour.
- A grid resolution for the 2D projection is a hyperparameter.
- Output: per-point feature embeddings; a segmentation head turns them into per-point class logits.
- It is a backbone, paired with a segmentation head.
- No images are required at training or inference.

## Architecture

- An embedding MLP lifts raw point features to a working feature dimension.
- A stack of L=48 WaffleIron blocks, each: pointwise MLP → project to a 2D plane → dense 2D convolution → lift back to points.
- The projection plane is alternated across blocks (xy → xz → yz) so vertical and horizontal structure are both captured.
- A final head produces per-point logits.
- No encoder-decoder down/up-sampling hierarchy — the architecture is flat, which eliminates subsampling artefacts on thin or sparse classes.
- The reference implementation covers nuScenes and SemanticKITTI; ScaLR extends it to PandaSet.

## Complexity and Compute

- **Projection cost:** O(N) per WI block — one scan over all N points to assign cells. Cell averaging is a simple accumulation.
- **Convolution cost:** O(M²·C·k²) per block, where k=3. For outdoor scenes at ρ=50 cm and a 100 m × 100 m field, M=200, so M²=40 000 — small relative to a megapixel image.
- **Memory:** All N points are kept at full resolution throughout (no downsampling). For N=10⁵ points, F=256 channels, FP32, the feature tensor is ~100 MB. At F=384, ~150 MB. Well within V100/A100 HBM budgets; fits on Orin's 64 GB unified memory.
- **Inference latency:**

| Dataset | Latency (ms) | Hardware | FPS |
|---------|-------------|----------|-----|
| nuScenes val | 92 ms | V100 | ~11 |
| SemanticKITTI val | 193 ms | V100 | ~5 |

- 1.7× slower than MinkUNet34 on SemanticKITTI, because no downsampling is applied — all points are processed at every layer.
- ScaLR fine-tuning runs at 1×V100; no multi-GPU requirement for deployment-scale inference.
- **Hardware compatibility:** Deployable on AMD GPUs (ROCm), TensorRT (no custom ops), OpenVINO, and Jetson Orin (dense conv is a first-class operator in TensorRT-Orin).

## Training Recipe

- **Optimizer:** AdamW, standard learning rate schedule (cosine or step decay).
- **Loss:** Cross-entropy with Lovász-softmax supplement, or weighted cross-entropy for class imbalance.
- **Epochs:** Reference training on SemanticKITTI: ~45 epochs, 1× V100; nuScenes: similar.
- **Augmentation:** Random rotation (yaw), random flip, jitter on per-point coordinates, random scaling. Standard point-cloud augmentations — no architecture-specific custom augmentations required.
- **Batch size:** Per-scan batching; no tile subsampling needed (full resolution throughout).
- **ScaLR pre-training:** WaffleIron is used as the 3D backbone in ScaLR, where DINOv2 ViT-L/14 features are distilled via a contrastive objective across nuScenes + SemanticKITTI + PandaSet. After ScaLR pre-training, fine-tuning on a labelled dataset yields: nuScenes 78.4%, SemanticKITTI 65.8%. ScaLR pre-training produces strong transfer even at 1% label fractions.

## Benchmark Results

| Dataset | Variant | mIoU | Notes |
|---------|---------|------|-------|
| SemanticKITTI test | WaffleIron-48-256 | **70.8%** | 2nd place at time of publication; outperforms Cylinder3D (67.8%), SPVNAS (66.4%) |
| nuScenes val | WaffleIron-48-256 | 77.6% | Competitive with RPVNet, SDSeg3D |
| nuScenes val (TTA) | WaffleIron-48-256 | **79.1%** | Test-time augmentation |
| SemanticKITTI val | ScaLR (WI backbone) | 65.8% | Cross-dataset pre-train, fine-tune |
| nuScenes val | ScaLR (WI backbone) | **78.4%** | Cross-dataset pre-train, fine-tune |

Reported per-class highlights on SemanticKITTI: bicycles 70.0%, motorcycles 69.8% — notably strong for thin/rare classes that dense projection handles well due to full-resolution processing.

## Variants and Lineage

WaffleIron belongs to the **dense 2D projection** family of LiDAR segmentation architectures, which is a small family sitting between range-image projection and full sparse-voxel methods. The key differentiator of the family is that the projection plane is defined in world-coordinate axes, not relative to a sensor origin — this is the property that makes it suitable for aggregated maps.

Within the WaffleIron family there are two size variants sharing identical structure, differing only in feature width:

| Variant | Parameters | Memory (FP32, N=10⁵ pts) | Recommended use |
|---------|-----------|--------------------------|----------------|
| WaffleIron-48-256 | 6.8 M | ~100 MB | Deployment on Orin or embedded inference |
| WaffleIron-48-384 | 15.1 M | ~150 MB | Offline map segmentation, maximum accuracy |

ScaLR uses the 48-384 variant as its 3D backbone. For TensorRT-INT8 deployment on Orin, the 48-256 variant is recommended as the starting point, with INT8 calibration on a representative scene split.

Its position relative to adjacent families:

| Family | Representative | Representation | Aggregated-map fit | WaffleIron distinction |
|--------|---------------|----------------|-------------------|----------------------|
| Range-image | RangeNet++, FRNet | Spherical range image (H×W) | Incompatible (single-origin) | WI projection is axis-aligned, not sensor-relative |
| Polar BEV | PolarNet | Polar BEV grid | Incompatible (sensor-relative) | WI uses Cartesian axis planes |
| Sparse voxel | MinkUNet, Cylinder3D | 3D sparse voxels | Very Good | WI avoids sparse conv dependency |
| Transformer | PTv3, OctFormer | Point/voxel attention | Very Good to Excellent | WI is simpler; lower accuracy ceiling |
| Dense 2D projection | **WaffleIron** | Axis-aligned 2D grids | **Very Good** | Hardware-agnostic; flat architecture |

Range-image methods (RangeNet++, SalsaNext, CENet, RangeViT, FRNet) are architecturally incompatible with aggregated maps because the spherical projection encodes a single sensor origin — a point's range-image coordinates depend entirely on which scan it came from. WaffleIron's axis-aligned projection is sensor-origin-agnostic: any 3D point cloud, regardless of how many sensor origins contributed to it, can be projected onto xyz planes.

ScaLR (Puy et al. 2024) is a direct evolution: the WaffleIron backbone is frozen and distilled with DINOv2 superpixel features, demonstrating that WaffleIron's simplicity makes it a clean target for cross-modal pre-training.

## Strengths

- Built only from standard operations (dense 2D conv, MLP) — easy to implement, profile, optimize, and deploy; no custom kernels to maintain.
- Dense 2D convolution is the best-optimized GPU primitive — strong hardware efficiency and cross-platform portability (AMD, TensorRT, OpenVINO, Orin).
- Competitive accuracy at a fraction of the implementation complexity of sparse-conv or transformer stacks.
- A clean, well-behaved target for pre-training and distillation (used by ScaLR with DINOv2).
- Grid resolution is robust over a 2× range — simplifies deployment across different sensor densities.
- No FPS, no kNN search, no subsampling — the inference graph is deterministic and easy to profile.
- Full-resolution processing benefits thin and rare classes (bicycles, motorcycles) that downsampling architectures can lose.

## Failure Modes

- Grid discretisation loses sub-cell precision; objects smaller than `ρ` (< 40–60 cm) may be conflated across neighbouring cells.
- Averaging multiple points in one cell discards intra-cell point distribution — fine-grained local geometry is smoothed.
- 2D projections along fixed axes can be confused by non-axis-aligned scene orientations: ramps, sloped runways, mine benches. The xz/yz projections partially compensate but cannot fully represent oblique surfaces.
- Higher latency than downsampling-based networks for the same mIoU: 193 ms on SemanticKITTI (~5 FPS) is not real-time for single-scan on-vehicle use on a V100.
- Accuracy ceiling is generally a few points below the top transformer backbones (PTv3, DITR).
- A smaller ecosystem and fewer pre-trained checkpoints than sparse-conv or PTv3 families.

## Aggregated-Map Suitability

**Rating: Very Good.**

WaffleIron operates on arbitrary 3D point sets — no assumption of scan origin or range-image structure. Multi-scan aggregated clouds from MLS or AV sweeps are directly processable. The fixed projection planes work well for urban environments (predominantly horizontal+vertical geometry). For airside taxiway/apron maps (flat, large-area), the xy-projection plane dominates and is well-suited.

Practical considerations for aggregated-map use:

- Tile the aggregated cloud into overlapping chunks (e.g. 100 m × 100 m, 20 m overlap) for memory-bounded inference; merge with majority vote or max-confidence fusion at tile boundaries.
- The grid resolution `ρ` should be matched to the smallest operationally significant class — for airside, ground markings (~10 cm wide) may require `ρ ≤ 20 cm`, but at the cost of a larger `M` grid.
- ScaLR pre-training on public datasets followed by fine-tuning on site-specific scans is the documented path to strong airside performance without large labelled airside datasets.
- WaffleIron's hardware-agnostic profile is especially useful for aggregated-map pipelines running on CPUs or non-NVIDIA hardware (cloud batch jobs, AMD inference clusters).

### Release-Map Controls

WaffleIron is the dependency-minimization lane. Its release evidence should focus on the projection contract rather than custom-kernel behavior:

| Control | Required evidence |
|---|---|
| Projection manifest | Grid resolution `ρ`, projection axes, tile origin, grid extents, cell aggregation rule, empty-cell policy, and back-projection tie handling. |
| Detail-loss audit | Thin marking, wire/cable, pole, fence, curb, facade-edge, and small-safety-feature recall against a sparse-conv or point-conv baseline at the same tile split. |
| Product-mode fit | Runtime semantic maps are acceptable only if projection detail loss is below the class threshold; training exports still obey release-state eligibility masks; digital-twin transfer needs point-to-surface provenance after back-projection. |
| Modality evidence | If ScaLR, colorized points, or image-derived features are used, record projection QA, teacher coverage, image capture window, and whether those features are training-only or release-time inputs. |
| Non-road transfer | For apron, campus, port, industrial, utility, facade, and terminal-interior slices, report whether axis-aligned projections fail on slopes, ramps, overhead structures, or oblique facades. |

See `../overview/aggregated-map-semantic-segmentation.md` §7.8 for head-to-head comparison of WaffleIron against the four other model families in the aggregated-map context.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV (on-vehicle) | conditional | 193 ms on V100 is below real-time; suitable for Orin with TensorRT INT8 optimisation or Thor. |
| Road AV (offline / maps) | strong | Hardware-agnostic, sensor-origin-agnostic; a natural fit for batch map segmentation pipelines. |
| Airside | conditional | No airside checkpoints; ScaLR pre-train + airside fine-tune is the recommended path. Grid resolution must be tuned to apron marking widths. |
| Warehouse / port / mining / construction / agriculture | conditional | Transfers as a generic, deployment-friendly 3D backbone; slope/ramp environments need care with axis-aligned projection assumptions. |

## Implementation Notes

- Choose WaffleIron when implementation simplicity and a clean dependency footprint matter — it needs only a standard deep-learning stack.
- Tune `ρ` to the smallest class that matters; for airside apron markings this may be 20–30 cm rather than the automotive default of 40–60 cm.
- Use class-weighted or Lovász-softmax loss for the usual class-imbalance reasons.
- WaffleIron is a strong pre-training target — ScaLR-style image-to-LiDAR distillation onto WaffleIron with DINOv2 is a documented recipe with public code.
- For aggregated-map segmentation, tile and merge as for any backbone; see `../overview/aggregated-map-semantic-segmentation.md` §8 for the tiling and stitching protocol.
- For on-vehicle deployment on Orin, compile with TensorRT: dense 2D conv maps directly to cuDNN primitives with no custom plugin needed.

## Sources

- WaffleIron paper: https://arxiv.org/abs/2301.10100
- Reference implementation: https://github.com/valeoai/WaffleIron
- ScaLR (WaffleIron + DINOv2 distillation): https://github.com/valeoai/ScaLR
- Related repository page: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline; §4.6 range-image family comparison; §7.8 compares WaffleIron head-to-head against the four other model families
- Related repository page: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation
