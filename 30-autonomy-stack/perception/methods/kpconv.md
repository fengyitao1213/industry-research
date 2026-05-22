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

- KPConv (Kernel Point Convolution) is a continuous-space convolution operator that acts directly on raw 3D points, introduced in "KPConv: Flexible and Deformable Convolution for Point Clouds" (ICCV 2019, Thomas et al.).
- It generalizes image convolution to unstructured point clouds without voxelizing or projecting them — the kernel lives in continuous R³ rather than on a discrete grid.
- It is most often used as the backbone of **KP-FCNN**, an encoder-decoder network for 3D semantic segmentation, and KP-CNN for shape classification.
- It is a long-standing, widely-reproduced baseline and a documented workhorse of the mobile- and airborne-laser-scanning (MLS/ALS) surveying industry.
- It comes in two forms — **rigid** and **deformable** — the latter learning per-input offsets so the kernel bends toward relevant local geometry.
- A modernized successor, **KPConvX** (CVPR 2024), preserves the geometric kernel structure while adding kernel-point attention and depthwise modulation.

## Core Technical Idea

- A KPConv kernel is defined by K **kernel points** {ξ_k} placed in a local spherical neighborhood; each kernel point carries a learnable weight matrix W_k.
- To convolve at a query point, every neighbor within radius r is weighted by a **linear influence function** that decreases with distance to each kernel point — closer neighbor → stronger contribution from that kernel point's weights.
- Each neighbor's features are transformed by the distance-weighted sum of W_k matrices and accumulated — a direct analog of grid convolution where kernel-point positions play the role of pixel offsets.
- Rigid KPConv fixes the kernel-point positions in a regular spatial arrangement (e.g., on a sphere of radius σ); the weight matrices alone are learned.
- Deformable KPConv adds a sub-network that predicts per-location offsets Δξ_k, bending the kernel toward locally-relevant geometry.
- Density is regularized by **grid subsampling** rather than raw points, giving stable neighborhood sizes and roughly uniform spatial coverage.

## Operator Mechanics

### Continuous Convolution Formula

The KPConv operator at query point x over neighborhood N(x) = {y_i : ‖y_i − x‖ ≤ r} is:

```
(F * g)(x) = Σ_{y_i ∈ N(x)} h(y_i − x, K) · f_i
```

where `f_i` is the feature of neighbor y_i and the influence function h is:

```
h(y, K) = Σ_{k=1}^{K} max(0, 1 − ‖y − ξ_k‖ / σ) · W_k
```

- `ξ_k ∈ R³`: kernel-point positions (K = 15 typically)
- `σ`: influence radius — controls how far a kernel point reaches into the neighborhood
- `W_k ∈ R^{C_in × C_out}`: per-kernel-point weight matrix
- `max(0, 1 − r/σ)`: linear tent function (a Gaussian variant is also supported)

The correlation scalar `max(0, 1 − ‖y − ξ_k‖ / σ)` ranges from 1 (neighbor coincident with kernel point) to 0 (neighbor at or beyond distance σ). This is differentiable everywhere except at the zero crossing, and the network learns through backprop into W_k.

### Rigid vs. Deformable Kernels

**Rigid KPConv**: {ξ_k} are fixed after initialization (e.g., on a unit sphere uniformly distributed via a relaxation algorithm). Only W_k are learned. This is sufficient for most large-scale segmentation tasks.

**Deformable KPConv**: A separate rigid KPConv sub-branch predicts offset vectors {Δξ_k} for each input location. The effective kernel points become `ξ_k^eff = ξ_k + Δξ_k`. A regularization term penalizes excessive deformation:

```
L_reg = (1/K) Σ_k max(0, ‖Δξ_k‖ − 1.5 σ)
```

This prevents kernels from collapsing to a single location while allowing meaningful adaptation to curved surfaces and irregular structures.

### Grid Subsampling

Points are down-sampled to a regular spatial grid of cell size `dl` before each encoder stage. Each occupied grid cell is represented by its centroid (average position) and averaged features. This is O(N) via a grid hash map and provides near-uniform density, stable neighborhood sizes, and a deterministic receptive field.

Encoder stage `i` uses grid cell size `dl_i = dl_0 × 2^i` with `dl_0 = 0.06 m` for outdoor scenes. Convolution radius at each stage is `r_i = 2.5 × dl_i`. At level 5 the receptive field covers `0.06 × 2^5 × 2.5 ≈ 4.8 m` radius — appropriate for most airside surface classes.

## KP-FCNN Architecture

KP-FCNN (Kernel Point Fully Convolutional Network) is the standard encoder-decoder segmentation model built from KPConv layers:

**Encoder** (5 levels):
- Level 0: KPConv block → grid-subsample (dl₀ = 0.06 m) → 64 ch
- Level 1: KPConv block → grid-subsample (dl₁ = 0.12 m) → 128 ch
- Level 2: KPConv block → grid-subsample (dl₂ = 0.24 m) → 256 ch
- Level 3: KPConv block → grid-subsample (dl₃ = 0.48 m) → 512 ch
- Level 4: KPConv block (bottleneck) → 1024 ch

Each KPConv block is: `BatchNorm → LeakyReLU → KPConv → BatchNorm → LeakyReLU`.

**Decoder** (nearest-neighbor upsampling):
- Upsample + skip concat + 1×1 KPConv for each level
- 1×1 KPConv is simply a per-point linear projection, not a neighborhood operation

**Head**: Final linear layer → softmax over C classes.

Rigid KPConv is used in shallow stages; deformable KPConv is typically reserved for deeper encoder stages where geometric adaptivity has the most impact.

## Complexity and Compute

| Component | Complexity | Notes |
|---|---|---|
| Grid subsampling | O(N) | Hash-map based; fast in practice |
| Neighborhood search | O(N) | Grid hash; no KNN sort needed |
| KPConv forward pass | O(N · K · C_in · C_out) | K=15, linear in N |
| Total forward | **O(N)** | All stages remain O(N) |
| Memory | O(N) | Linear in input cloud size |

KPConv's O(N) complexity (enabled by grid subsampling + hash-map radius queries) is a defining strength. Contrast with PointNet++'s FPS bottleneck at O(N²) and PTv2's KNN construction at O(NK log N).

**Practical latency** (A100-class GPU):
- 100K points: ~80–150 ms (SemanticKITTI crop)
- 1M points (tiled to 100K sub-scenes): offline batch throughput ~5–10 scenes/s

On NVIDIA Orin (embedded AV compute), estimated latency is 300–500 ms per 100K-point tile — practical for background offline map processing but not on-vehicle real-time perception.

## Training Recipe

Standard SemanticKITTI configuration from the original paper:

| Hyperparameter | Value |
|---|---|
| Optimizer | SGD + Momentum 0.98 |
| Initial LR | 0.01 |
| LR decay | ×0.1^(1/150) per epoch (exponential) |
| Max epochs | 800 (500 steps/epoch) |
| Batch size | 8 |
| Input points per crop | 100,000 |
| Convolution radius | 4.0 m (level-0) |
| First grid size dl₀ | 0.06 m |
| Kernel points K | 15 |
| KP influence function | Linear |
| Augmentations | Vertical rotation, anisotropic scale [0.8–1.2], Gaussian noise σ=0.001, color jitter ±0.8 |

For aggregated-map fine-tuning, the grid size and convolution radius should be adapted to match the target point density. MLS survey clouds are often denser than SemanticKITTI; a dl₀ of 0.03–0.05 m better preserves markings and thin structures.

## Benchmark Results

| Dataset | Method | mIoU | Year | Notes |
|---|---|---|---|---|
| SemanticKITTI (test) | KPConv rigid | 58.8% | 2019 | SOTA for point-only at ICCV 2019 |
| S3DIS Area 5 | KPConv rigid | 69.6% | 2019 | |
| S3DIS Area 5 | KPConv deformable | **70.6%** | 2019 | |
| Semantic3D reduced-8 | KPConv | 74.6% (OA 92.9%) | 2019 | |
| ScanNet v2 val | KPConvX | 72.4% | 2024 | Modernized variant |
| S3DIS Area 5 | KPConvX | 73.5% | 2024 | Near-parity with PTv3 (73.6%) |

For context: RandLA-Net (2020) reached 77.4% on Semantic3D, outperforming KPConv by 2.8 pp. PTv3 (2024) reaches 70.8% on SemanticKITTI val (vs. KPConv's 58.8% test). The accuracy gap to modern transformers is significant on outdoor AV benchmarks.

**Important caveat**: KPConvX (2024) has no published SemanticKITTI or nuScenes results — it was benchmarked on indoor datasets only. Its outdoor applicability must therefore be evaluated empirically before relying on it for AV pipelines.

## Variants and Lineage

### KP-CNN (Classification)
The classification variant of the KP-FCNN backbone. Global max-pooling after the encoder yields a shape descriptor for object classification (ShapeNetPart, ModelNet40). Less relevant for map-scale semantic segmentation.

### KPConvX (CVPR 2024)
KPConvX modernizes KPConv in two steps. First, **KPConvD** (depthwise) factorizes W_k from a full C_in×C_out matrix to a per-channel scalar vector w_k ∈ R^C, reducing parameters:

```
h_D(y, K) = Σ_k max(0, 1 − ‖y − ξ_k‖ / σ) · diag(w_k)
```

Then **KPConvX** adds **kernel attention** — scalars a_k(f) computed from aggregated neighborhood features that modulate the depthwise weights:

```
h_X(y, K, f) = Σ_k a_k(f) · max(0, 1 − ‖y − ξ_k‖/σ) · diag(w_k)
```

This makes the effective kernel shape input-dependent, combining KPConv's geometric inductive bias with dynamic weight modulation. KPConvX also adopts modern macro design: InvRes-style expansion blocks, LayerNorm instead of BatchNorm, GELU activations, and cosine LR schedules. The result is a pure point-convolution method roughly on par with PTv3 on S3DIS (73.5% vs. 73.6%) while maintaining O(N) complexity.

### PointNeXt (NeurIPS 2022) — Related Context
PointNeXt modernizes PointNet++ rather than KPConv but is a useful comparison point. It shows that much of the accuracy gap between CNN-style methods and transformers on S3DIS was due to inferior training recipes rather than architecture — InvResMLP blocks + AdamW + cosine LR + label smoothing brought PointNeXt-XL to 74.9% on S3DIS Area 5, surpassing PTv1. This context argues that KPConvX's modernization approach is on firm ground.

## Aggregated-Map Suitability

### Scaling to Million-Point Maps

A 100-scan aggregated LiDAR map over a 300 m × 300 m airside area contains roughly 6.5 M–13 M points (Velodyne VLP-32C at 200 m range). A full airport map (5 km × 5 km) can exceed 500 M points. No method processes this in a single forward pass; tiling is mandatory.

KPConv is the **best-suited classical point-conv method** for aggregated-map processing because:

1. Grid subsampling at dl₀ = 0.06 m naturally reduces a 10 M-point tile to ~1–2 M grid cells before the network sees it.
2. O(N) complexity means each tile's compute cost scales linearly — there is no quadratic FPS penalty.
3. Sphere-sampling inference (sample random seed points, extract spheres of radius r_max) is a built-in tiling strategy with no axis-aligned seams. Predictions are committed only for the inner core of each sphere (reducing boundary artifacts).

### Tiling Strategy

Recommended approach for offline map labeling:

1. Sample seed points uniformly across the map at stride `0.5 × r_max` (e.g., every 2 m for a 4 m inference radius).
2. Extract a sphere of radius `r_max = 4 m` around each seed. Accept only the inner-core predictions (r < 2 m from seed).
3. Accumulate per-point predictions with logit averaging where cores overlap.
4. Apply a superpixel-based CRF pass for spatial consistency on large coherent regions (aprons, runways).

The sphere-sampling approach naturally handles variable density (MLS/TLS near objects are denser) and avoids the axis-aligned boundary artifacts of rectangular tiles.

### Receptive Field for Airside Classes

KPConv's level-5 receptive field covers ~4.8 m radius. For most airside surface classes this is adequate:

| Airside class | Typical extent | KPConv receptive field | Verdict |
|---|---|---|---|
| Pavement / runway surface | 10s–100s m | 4.8 m (local texture suffices) | Adequate |
| Taxiway / apron markings | 0.1–1 m wide | 4.8 m (captures stripe context) | Adequate |
| Aircraft stand | 20–40 m | 4.8 m (needs multiple overlapping spheres) | Adequate with tiling |
| Ground support equipment | 1–5 m | 4.8 m | Adequate |
| Perimeter fence / wire | 0.02–0.05 m wide | Grid at 0.03 m dl₀ needed | Marginal — tune dl₀ |
| Terminal building facade | 50–200 m | 4.8 m (local patch suffices for classification) | Adequate |

Long-range context is generally not needed for airside class labeling — pavements, markings, and structures are locally distinguishable. KPConv's convolution radius is sufficient.

### Offline vs. On-Vehicle Feasibility

| Scenario | Verdict | Notes |
|---|---|---|
| Offline HD-map production | **Good fit** | O(N), sphere-sampling, MLS industry pedigree |
| Online submap annotation (10–50 scans) | Marginal | 80–150 ms/100K pts on data-center GPU; background thread feasible |
| On-vehicle real-time (Orin) | Not suitable | ~300–500 ms/tile; use RandLA-Net instead |
| Once-per-airport full labeling | **Good fit** | Batch over tiles; GPU memory ~8–12 GB per 100K-pt tile |

For an airport digital-twin pipeline, the recommended workflow is: KPConv as the O(N) fast pass for initial semantic labeling → PTv3 refinement on uncertain tiles → human QA on rare-class segments.

## Inputs and Outputs

- Inputs: point cloud as `(x, y, z)` plus optional per-point features — intensity/reflectance, RGB colour, normals, or a constant-1 feature if none are available.
- Grid subsampling and radius neighborhood construction are part of the data pipeline, not the network; they execute on CPU/GPU ahead of the forward pass.
- Output: per-point class logits; a softmax head converts them to class probabilities.
- KP-FCNN is a complete segmentation model (backbone + head). KP-CNN is a classification variant.

## Strengths

- O(N) complexity via grid subsampling — scales to arbitrarily large scenes without FPS bottleneck.
- Explicit geometric kernel structure — kernel-point positions encode spatial relationships, giving a geometric inductive bias absent from transformer methods.
- Deformable variant adapts to curved and irregular surfaces without extra supervision.
- Sphere-sampling inference is a built-in large-cloud tiling strategy with no axis-aligned seams.
- Survey-industry pedigree — used extensively in MLS/ALS and TLS workflows; known transfer to registered survey clouds.
- Robust to feature-poor inputs — works from a constant feature channel when no intensity or colour is available.
- Stable, well-documented; convergence is reliable rather than finicky.

## Failure Modes

- Accuracy now trails transformer and superpoint-graph backbones on most leaderboards; the gap to PTv3 is ~12 pp on SemanticKITTI.
- Slower than sparse-convolution backbones on modern GPUs; not suitable for on-vehicle real-time budgets.
- Grid subsampling can under-sample very rare thin classes (markings <0.05 m wide) unless dl₀ is reduced and rare-class-aware seeding is added.
- Hyperparameter-sensitive: dl₀ and convolution radius r require per-dataset tuning; wrong values degrade both speed and accuracy.
- Custom neighbor-search ops are less TensorRT-friendly than sparse-convolution kernels — embedded deployment needs extra engineering.
- No global context: purely convolutional, no attention; disambiguation of globally-similar but spatially-distinct classes requires external priors.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV (offline) | strong | Long-standing baseline on Paris-Lille-3D and other MLS benchmarks; solid for offline auto-labeling. |
| Road AV (on-vehicle) | weak | Memory and latency cost make it a poor fit for the embedded real-time budget. |
| Airside | conditional | No airside checkpoints exist; a dependable baseline once trained on airside data, and a natural fit for offline aggregated-map segmentation. |
| Aerial / survey (ALS, TLS) | strong | A documented workhorse of the MLS/ALS surveying industry for ground/vegetation/building/structure classification. |
| Warehouse / port / mining / construction / agriculture | conditional | Transfers as a generic geometry-faithful backbone; better offline than embedded. |

## Implementation Notes

- Set dl₀ to the resolution of the smallest class that matters — a marking of width 0.1 m requires dl₀ ≤ 0.05 m to survive grid subsampling.
- Use sphere-sampling inference for map-scale clouds; commit only inner-core predictions (r < 0.5 × r_max from seed) and merge overlapping predictions with logit averaging.
- Reserve deformable KPConv for deeper encoder stages; rigid KPConv is cheaper and adequate in shallow stages.
- Class-weight the cross-entropy loss and seed extra spheres on rare-class regions — KPConv does not address class imbalance internally.
- Consider KPConvX (arXiv:2405.13194) if a modernized, more accurate point-convolution baseline is preferred over the 2019 original.
- For embedded deployment, distill KPConv into a sparse-convolution student rather than deploying it directly.
- For comparison and context, see the RandLA-Net page (`./randla-net.md`) for the alternative O(N) baseline and the Point Transformer V3 page (`./point-transformer-v3.md`) for the high-accuracy ceiling.

## Sources

- KPConv paper (ICCV 2019): https://arxiv.org/abs/1904.08889
- ICCV page: https://openaccess.thecvf.com/content_ICCV_2019/html/Thomas_KPConv_Flexible_and_Deformable_Convolution_for_Point_Clouds_ICCV_2019_paper.html
- Original implementation (TensorFlow): https://github.com/HuguesTHOMAS/KPConv
- PyTorch implementation: https://github.com/HuguesTHOMAS/KPConv-PyTorch
- KPConvX paper (CVPR 2024): https://arxiv.org/abs/2405.13194
- KPConvX CVPR page: https://openaccess.thecvf.com/content/CVPR2024/html/Thomas_KPConvX_Modernizing_Kernel_Point_Convolution_with_Kernel_Attention_CVPR_2024_paper.html
- Apple ML Research page on KPConvX: https://machinelearning.apple.com/research/kpconvx
- PointNeXt (NeurIPS 2022, training-recipe context): https://arxiv.org/abs/2206.04670
- Related repository page: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline; §7.8 compares point-based convolution head-to-head against the other four model families
- Related repository page: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation
- Related method pages: `./randla-net.md` (O(N) random-sampling baseline), `./point-transformer-v3.md` (high-accuracy transformer ceiling)
