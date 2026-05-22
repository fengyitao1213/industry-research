# Point Transformer V3

<!-- method-priority:start
priority:
  learning: 5
  deployment: 4
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["perception", "lidar", "segmentation", "mapping", "road-av"]
  reason: "Point Transformer V3 is the leading serialized-attention 3D backbone for large-scale point cloud semantic segmentation, including offline aggregated-map labeling."
method-priority:end -->

## What It Is

- Point Transformer V3 (PTv3) is a general-purpose backbone for 3D point cloud understanding, introduced in "Point Transformer V3: Simpler, Faster, Stronger" (CVPR 2024 Oral, Wu et al.).
- It is an encoder-decoder transformer that produces per-point features for downstream semantic segmentation, classification, and detection heads.
- Its central design choice is to trade attention-mechanism sophistication for **scale** — a simpler operator that runs faster and lets the model and receptive field grow substantially.
- It is the current reference architecture for high-accuracy 3D semantic segmentation across both indoor and outdoor (LiDAR) point clouds.
- It is modality-agnostic over point sources: terrestrial, mobile, and aerial LiDAR, RGB-D fused clouds, and aggregated multi-scan maps.
- It is the backbone of two companion frameworks: **Point Prompt Training (PPT)** for multi-dataset joint training, and **Sonata** for self-supervised pre-training — both are central to reaching its best reported numbers.

## Core Technical Idea

Earlier point transformers (PTv1/PTv2) spend the majority of their compute on two operations: KNN graph construction (~28% of PTv2 forward time) and relative positional encoding via MLPs (~26%). These operations are precise but impose hard limits on receptive field size and model scale.

PTv3's design observation: KNN construction and point-wise RPE are not justified at scale when serialization can provide similar locality at a fraction of the cost. PTv3 replaces KNN-based neighborhoods with **point cloud serialization** — sorting points along space-filling curves (Z-order, Hilbert, and transposed variants) so that spatially-near points are contiguous in a 1D sequence. Attention then runs over fixed-size contiguous **patches** of the serialized sequence. No KNN query is needed; patch formation is a simple index slice.

The consequences are:
- GPU memory drops ~10× vs. PTv2 (no NK neighborhood tensor)
- Inference latency drops ~3.3× vs. PTv2
- Receptive field per attention block grows from 16 (KNN) to 1024 (patch size)
- The model can scale to larger parameter counts on the same GPU budget

The thesis, explicitly stated in the paper: at scale, a simpler operator with a larger receptive field outperforms a sophisticated operator with a small one.

## Operator Mechanics

### Point Cloud Serialization

PTv3 converts unstructured 3D points into an ordered 1D sequence using space-filling curves. The serialization code for a point `p` is:

```
Encode(p, b, g) = (b << k) | φ⁻¹(⌊p / g⌋)
```

where:
- `p`: 3D point coordinates
- `g`: voxel grid size (quantization step)
- `b`: batch index
- `k`: number of bits for spatial encoding
- `φ`: space-filling curve function
- `⌊p / g⌋`: quantized grid coordinates

**Supported serialization patterns** (used in rotation across attention blocks):
1. **Z-order** (Morton curve): bit-interleaving of quantized x, y, z coordinates. Fast to compute but has directional artifacts near octant boundaries.
2. **Trans Z-order**: Z-order with axis traversal order permuted — rotates the artifact directions.
3. **Hilbert curve**: better spatial locality than Z-order (neighboring points in Hilbert order are always spatially adjacent); slightly more expensive to encode.
4. **Trans Hilbert**: Hilbert with transposed axis assignment.

**Why multiple patterns?** A single serialization imposes a fixed partition into patches. Adjacent points near a patch boundary will never interact within one block. By cycling through different serialization patterns across successive attention blocks (Shift Order strategy), the network ensures that points separated in one block's serialization are neighbors in another block's serialization. This gives the effective receptive field a diverse, isotropic character without requiring global attention.

### Patch Attention

Points sorted by serialization code are grouped into non-overlapping patches of size M (default M = 1024). Standard scaled dot-product attention with FlashAttention v2 is applied within each patch:

```
Attention(Q, K, V) = softmax(Q K^T / √d) V
```

This is a deliberate simplification from PTv1/PTv2's vector self-attention (subtraction-based, element-wise modulation). Standard attention maps directly to hardware-optimized kernels (FlashAttention), providing 2–4× throughput improvement on A100/H100 GPUs compared to custom attention implementations.

**Complexity**: O(M²) per patch × (N/M) patches = O(N · M). With M=1024 fixed regardless of N, this is linear in N.

### Patch Interaction Strategies

Four strategies prevent information siloing between patches:

- **Shift Order** (primary): each attention block uses a different serialization pattern from {Z, trans-Z, Hilbert, trans-Hilbert}. Cycled across blocks.
- **Shuffle Order**: randomly permute which serialization is used in each block at training time.
- **Shift Dilation**: staggered grouping that staggers patch boundaries across blocks, analogous to shifted windows in Swin Transformer.
- **Shift Patch**: sliding-window variant.

In practice, the Shift Order strategy (cycling through the four curve types) is the default and provides the best accuracy/efficiency tradeoff.

### xCPE — Enhanced Conditional Positional Encoding

PTv2 used relative positional encoding (RPE) — a per-pair distance MLP applied to all KNN pairs, consuming ~26% of forward time. PTv3 replaces this with **xCPE**:

```
x' = x + SparseConv(x)
```

A single sparse depthwise convolution with a skip connection, prepended before each attention layer. This operation is O(N) with negligible overhead, injects local spatial context into the feature stream, and replaces the expensive RPE MLP entirely. The sparse convolution leverages the quantized voxel grid already used for serialization, so no additional spatial data structure is needed.

## U-Net Architecture

PTv3 uses a standard U-Net encoder-decoder structure, with all operations (downsampling, upsampling, attention) implemented over the serialized representation:

**Encoder** (serialized pooling replaces FPS):
- Linear embedding → initial channel count
- Serialized pooling (grid voxelization, max-pool features) → 2× coarser resolution
- PTv3 attention blocks at each resolution level
- Channel widths double at each level

**Decoder** (serialized unpooling replaces interpolation):
- Nearest-neighbor unpooling over the serialized order
- Skip connections from encoder levels
- PTv3 attention blocks + xCPE at each level

**Heads**:
- Semantic segmentation: per-point linear projection → C classes
- Detection (Waymo challenge): bounding-box regression head on top of U-Net features
- Panoptic: combines segmentation head with instance clustering

## Efficiency vs. PTv1/PTv2

| Metric | PTv1 | PTv2 | PTv3 | PTv2 → PTv3 gain |
|---|---|---|---|---|
| Downsampling | FPS O(N²) | Partition O(N) | Serialization O(N log N) | — |
| Neighborhood | KNN O(NK) | KNN O(NK) | Patch O(M), M fixed | KNN eliminated |
| Positional enc. | RPE MLP | RPE+mult MLP | xCPE SparseConv | −26% forward time |
| Receptive field | 16 pts (KNN) | 16 pts (KNN) | 1024 pts (patch) | 64× larger |
| Inference (nuScenes) | — | 146 ms | **44 ms** | **3.3×** faster |
| GPU memory (nuScenes) | — | 12.3 GB | **1.2 GB** | **10.2×** reduction |
| Training latency (ScanNet) | — | 312 ms | 151 ms | 2.1× faster |
| Training memory (ScanNet) | — | 13.4 GB | 6.8 GB | 2.0× reduction |

The 10× memory reduction is particularly significant: it allows much larger batch sizes or much larger tiles on the same GPU, enabling the model to scale up in both parameters and context window.

## Training Recipe

Standard configurations from the PTv3 paper:

| Hyperparameter | Indoor (ScanNet / S3DIS) | Outdoor (nuScenes / SemanticKITTI) |
|---|---|---|
| Optimizer | AdamW | AdamW |
| LR | 5e-3 | 2e-3 |
| LR schedule | Cosine decay with warmup | Cosine decay with warmup |
| Epochs | 800 (ScanNet), 3000 (S3DIS) | 50 |
| Batch size | 12 | 24 |
| GPUs | 4 × A100 | 4 × A100 |
| Patch size M | 1024 | 1024 |
| Serialization | Z + trans-Z + Hilbert + trans-Hilbert | Same |
| Augmentations (indoor) | Random rotation, scale [0.9–1.1], flip, jitter σ=0.005, elastic distortion, grid sampling | — |
| Augmentations (outdoor) | Same + range-image augmentation | Range-image aug |
| Requirements | CUDA 11.6+, PyTorch 1.12+, FlashAttention (recommended) | Same |

FlashAttention is optional but strongly recommended — it provides 2–4× attention throughput with identical numerics.

For airside fine-tuning, start from a Sonata or PPT checkpoint and use outdoor augmentations. Expected fine-tuning epochs: 50–100 on airside data depending on dataset size.

## Benchmark Results

### Comprehensive Results Table

| Dataset | PTv3 scratch | PTv3 + PPT | PTv3 + Sonata FT | Year | Source |
|---|---|---|---|---|---|
| ScanNet v2 val mIoU | 77.5% | 78.6% | **79.4%** | 2024/25 | arXiv:2312.10035, 2503.16429 |
| ScanNet200 val mIoU | 35.3% | — | — | 2024 | arXiv:2312.10035 |
| S3DIS Area 5 mIoU | 73.6% | 75.4% | — | 2024 | arXiv:2312.10035 |
| S3DIS 6-fold mIoU | 77.7% | 80.8% | **82.3%** | 2024/25 | arXiv:2312.10035, 2503.16429 |
| nuScenes val mIoU | 80.4% | 81.2% | **81.7%** | 2024/25 | arXiv:2312.10035, 2503.16429 |
| SemanticKITTI val mIoU | 70.8% | 72.3% | — | 2024 | arXiv:2312.10035 |
| Waymo 3-frame mAPH | 73.0 | — | **72.9%** (seg) | 2024/25 | arXiv:2312.10035 |

PTv3 outperforms prior SOTA SphereFormer by +2.0 pp on nuScenes and +3.0 pp on SemanticKITTI validation. It won the 2024 Waymo Open Dataset Semantic Segmentation Challenge (arXiv:2407.15282) with an extreme ensemble/TTA configuration.

**Note**: SemanticKITTI numbers above are validation-set figures. Test-set submission results are not prominently published; treat 70.8% (val) as the primary reference.

### Longitudinal Context (SemanticKITTI val)

| Method | Year | mIoU (val) | Notes |
|---|---|---|---|
| KPConv rigid | 2019 | — (58.8% test) | ICCV 2019 SOTA |
| RandLA-Net | 2020 | 51.8% | CVPR 2020 SOTA (point-only) |
| SPVCNN | 2020 | 66.4% | Sparse-conv |
| PTv3 | 2024 | **70.8%** | CVPR 2024 Oral |
| PTv3 + PPT | 2024 | **72.3%** | Multi-dataset training |

## Variants and Lineage

### PTv1 (ICCV 2021)

Point Transformer V1 introduced **vector self-attention** for point clouds. Standard attention uses scalar dot products to produce a single attention weight per query-key pair. PTv1's weight encoding MLP `γ(·)` produces a vector of the same dimension as the value features, enabling per-channel modulation:

```
y_i = Σ_{j ∈ N(i)} ρ(γ(φ(x_i) − ψ(x_j) + δ_ij)) ⊙ (α(x_j) + δ_ij)
```

where `φ, ψ, α` are linear projections (query/key/value), `δ_ij = θ(p_i − p_j)` is an MLP-based positional encoding of the relative displacement, and `ρ` is softmax normalization. The Hadamard product `⊙` applies the vector attention weights per channel. PTv1 first exceeded 70% mIoU on S3DIS Area 5 (70.4%) — a landmark at ICCV 2021. Weakness: inherits FPS downsampling from PointNet++, making it O(N²) at the sampling step.

### PTv2 (NeurIPS 2022)

PTv2 addresses two PTv1 weaknesses. First, **grouped vector attention (GVA)** reduces overfitting from PTv1's full C-to-C attention weight mapping by grouping channels — a block-diagonal weight matrix with g groups (g = 8 or 16), plus both additive and multiplicative positional encodings. Second, **partition-based pooling** replaces FPS with O(N) grid voxelization + max-pool, achieving ~3–4× faster downsampling. The KNN construction and RPE remain, capping scalability. PTv2 achieves 75.2% on ScanNet val and 71.6% on S3DIS Area 5.

### Point Prompt Training — PPT (CVPR 2024)

PPT trains a single PTv3 backbone on multiple datasets simultaneously, defeating negative transfer via two mechanisms:

**Prompt-Driven Normalization (PDNorm)**: Each dataset `d` gets learnable domain prompts `p_d ∈ R^D` that condition all normalization layers to produce dataset-specific scale and shift:

```
PDNorm(x, p_d) = γ(p_d) · (x − μ) / σ + β(p_d)
```

**Language-Guided Categorical Alignment**: Point representations are aligned with CLIP text embeddings of category names via InfoNCE loss, unifying heterogeneous label spaces across datasets. A single shared backbone trained on {ScanNet, S3DIS, ScanNet200} outperforms per-dataset-trained models.

Outdoor PPT results: SemanticKITTI 71.4% mIoU, nuScenes 78.6% mIoU, Waymo 70.4% mIoU. For airside fine-tuning, PPT initialization is preferred over scratch training because the shared backbone has seen diverse outdoor geometry.

### Sonata — SSL Pre-training (CVPR 2025 Highlight)

Sonata is a self-supervised pre-training framework for PTv3 (encoder-only, 108 M parameters). The SSL objective is point self-distillation with an EMA teacher:
- Student processes challenging local/masked views of the point cloud
- Teacher processes global views
- Loss: Sinkhorn-Knopp centering + KoLeo regularization + cluster assignment matching
- Point pairs matched across views using original 3D coordinates before augmentation

**Pre-training data**: 140K point clouds (86.7× larger than PointContrast), mixing real indoor scans and synthetic scenes. **Training cost**: 200 epochs, batch 96, 32 GPUs.

Sonata fine-tuning results vs. supervised PTv3:

| Benchmark | Supervised PTv3 | Sonata FT | Gain |
|---|---|---|---|
| ScanNet mIoU | 77.6% | **79.4%** | +1.8 pp |
| S3DIS 6-fold mIoU | 77.7% | **82.3%** | +4.6 pp |
| nuScenes mIoU | 80.4% | **81.7%** | +1.3 pp |
| Waymo mIoU | 71.2% | **72.9%** | +1.7 pp |

Linear probing (< 0.2% learnable parameters) achieves 72.5% on ScanNet — demonstrating strong representation quality. For airside applications where labeled data is scarce, Sonata initialization followed by fine-tuning on 500–1000 labeled airside scenes is the recommended starting point.

## Aggregated-Map Suitability

### Scaling to Million-Point Maps

A full-airport LiDAR map (5 km × 5 km) can exceed 500 M points. PTv3 cannot process this in a single pass, but its memory efficiency (1.2 GB for a nuScenes tile vs. 12.3 GB for PTv2) makes large-tile inference practical:

- PTv3 can handle tiles of 500K+ points on a 16 GB GPU in FP16.
- At 44 ms per tile (A100), a 100-tile tiling of a 300 m × 300 m zone completes in ~4.4 s — practical for offline HD-map production.
- A full airport (5 km × 5 km, ~1000 tiles at 150 m spacing) completes in ~45 s on a single A100.

This makes PTv3 the **highest-accuracy option** for offline airside map labeling, with throughput that is compatible with production pipelines.

### Tiling Strategy

Recommended approach for offline aggregated-map labeling with PTv3:

1. Grid the map into overlapping tiles of 150 m × 150 m with 20–30 m overlap (20% border).
2. Normalize per-tile coordinates (subtract tile centroid) — serialization assumes bounded coordinates.
3. Apply PTv3 with all four serialization patterns (Z + trans-Z + Hilbert + trans-Hilbert) active across blocks.
4. Merge tile predictions in the overlap zone with logit averaging.
5. Optional: apply a CRF or superpixel smoothing pass on large coherent regions (runway, apron).

The 20–30 m overlap is more generous than for KPConv or RandLA-Net because PTv3's 1024-point patch at typical outdoor density covers ~15–20 m diameter — a 20 m overlap ensures that boundary-zone points appear in the central patch of at least one tile.

### Receptive Field for Airside Classes

PTv3's 1024-point patch at 0.06 m grid resolution covers a spatial region of roughly 15–20 m diameter. This is substantially larger than KPConv (~4.8 m radius) or RandLA-Net (~5–15 m effective RF):

| Airside class | Typical extent | PTv3 patch RF | Verdict |
|---|---|---|---|
| Pavement / runway | 10s–100s m | 15–20 m diameter | Adequate; multiple overlapping patches |
| Taxiway marking | 0.1–0.5 m wide | 15–20 m patch | Excellent — full line in one patch |
| Aircraft stand | 20–40 m | 15–20 m patch | Good; 2–3 patches cover full stand |
| Terminal building facade | 50–200 m | 15–20 m patch (local appearance) | Adequate for per-point labeling |
| Ground support equipment | 1–5 m | 15–20 m patch | Excellent — full object in patch |
| Perimeter fence post | 0.05–0.1 m | Depends on serialization locality | Good in dense scans |

The large patch size makes PTv3 particularly effective for disambiguating classes with similar local appearance but different spatial context (e.g., apron vs. taxiway vs. runway) — surrounding points within the 1024-point patch provide the contextual signal.

### On-Vehicle Real-Time Feasibility

| Scenario | Data-center GPU latency | Orin estimate | Feasible? |
|---|---|---|---|
| nuScenes-scale tile (44 ms / A100) | 44 ms | ~200–400 ms | Background thread |
| Single scan (65K pts) | ~20 ms est. | ~100–200 ms | At 5–10 Hz background |
| Large tile (500K pts) | ~100 ms est. | ~400–800 ms | Offline / scheduled |

PTv3 at 44 ms (A100) corresponds to roughly 200–400 ms on Orin — feasible in a background thread at 2–5 Hz, but not in the primary real-time perception loop. For on-vehicle airside use, the dominant use case is querying a pre-labeled semantic map rather than running PTv3 on-vehicle. Live map updates (accumulated 10–50 scans) are better handled by RandLA-Net on Orin, with PTv3 running in an offline lane when the vehicle is docked.

### Offline vs. On-Vehicle Recommendation

| Scenario | Verdict |
|---|---|
| Offline HD-map production (accuracy-priority) | **Best fit — highest accuracy ceiling** |
| Offline HD-map production (speed-priority) | Use RandLA-Net or KPConv instead |
| Online submap annotation with pre-training | **Good fit — Sonata init reduces data need** |
| On-vehicle real-time perception (Orin) | Not suitable — use sparse-conv baseline + distilled student |
| Few-shot fine-tuning on new airside domain | **Best fit — Sonata linear probe viable at < 1K labels** |

## Inputs and Outputs

- Inputs: a point cloud as `(x, y, z)` plus per-point features — intensity/reflectance, RGB colour, surface normal, or other channels.
- Assumes points can be quantized into a voxel grid for serialization; works from sparse to dense clouds.
- Output: per-point feature embedding; a task head converts it to per-point class logits (segmentation), a global label (classification), or detection outputs.
- It is a backbone, not a task model — paired with a segmentation head, optionally a panoptic or detection head.

## Strengths

- Highest accuracy ceiling among widely-reproduced 3D segmentation backbones; SOTA on ScanNet, S3DIS, nuScenes, SemanticKITTI, and Waymo.
- Large receptive field (1024-point patch, ~15–20 m diameter) — important for big coherent classes and contextual disambiguation.
- 3.3× faster and 10× more memory-efficient than PTv2; map-sized tiles are tractable.
- Strongest pre-training ecosystem in 3D: PPT for multi-dataset training, Sonata for SSL — pre-training is what makes its data hunger manageable in low-label regimes.
- Serialization tiles cleanly, with no axis-aligned bias when multiple curve orders are used.
- FlashAttention compatibility gives direct access to hardware-optimized attention kernels on A100/H100.
- Unified indoor + outdoor + aerial backbone — one architecture transfers across point-cloud sources.

## Failure Modes

- High data hunger when trained from scratch — without pre-training, PTv3 can underperform a sparse-convolution U-Net while costing far more.
- Serialization approximates locality; points near space-filling-curve boundaries may be assigned to different patches, weakening local interactions. Multiple curve orders mitigate but do not eliminate this.
- Training is sensitive to learning-rate schedule, warmup, batch size, and augmentation — the most finicky family to tune correctly.
- Heaviest per-tile inference cost of the common families — not suitable for on-vehicle real-time budgets without distillation.
- Less TensorRT-mature than sparse-convolution backbones; embedded deployment requires extra engineering effort.
- Quality degrades with registration blur in aggregated maps (residual dynamics, misaligned scans) — same as all 3D models, but PTv3's large receptive field amplifies rather than smooths misregistration.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV (offline) | strong | SOTA on nuScenes, SemanticKITTI, Waymo segmentation; ideal for offline auto-labeling and HD-map semantic layers. |
| Road AV (on-vehicle) | conditional | Accurate but heavy; needs distillation/pruning/quantization to fit an embedded real-time budget. |
| Airside | conditional | No airside-trained checkpoints exist; strong once pre-trained (Sonata/PPT) and fine-tuned on airside data — the accuracy ceiling for offline aggregated-map segmentation. |
| Warehouse / port / mining / construction / agriculture | conditional | Transfers as a generic 3D backbone; needs domain data; fits offline mapping better than embedded loops. |

## Implementation Notes

- Start from a Sonata or PPT checkpoint — training PTv3 from scratch on a small airside dataset is the most common way to underperform a simpler KPConv or RandLA-Net baseline.
- For aggregated-map segmentation, tile into 150 m × 150 m overlapping blocks (20–30 m overlap), normalize coordinates per tile, and merge with logit averaging.
- Use all four serialization orders (Z + trans-Z + Hilbert + trans-Hilbert) — do not use only one; the diversity is what gives the effective RF its isotropic character.
- Mixed precision (FP16/BF16) roughly halves memory and doubles offline throughput with negligible accuracy loss.
- For any embedded deployment, plan a distillation step to a sparse-convolution student (e.g., SPVCNN) rather than deploying PTv3 directly.
- Report per-class IoU alongside mIoU — Sonata's pre-training gains are largest exactly on the rare thin classes (markings, poles, wires) that mIoU dilutes.
- For comparison and context, see the KPConv page (`./kpconv.md`) for the O(N) grid-conv baseline and the RandLA-Net page (`./randla-net.md`) for the speed-optimized large-cloud baseline.

## Sources

- PTv3 paper (CVPR 2024 Oral): https://arxiv.org/abs/2312.10035
- PTv3 CVPR page: https://openaccess.thecvf.com/content/CVPR2024/html/Wu_Point_Transformer_V3_Simpler_Faster_Stronger_CVPR_2024_paper.html
- Pointcept framework (reference implementation): https://github.com/Pointcept/PointTransformerV3
- Pointcept (all models including PPT, Sonata): https://github.com/Pointcept/Pointcept
- PTv1 (ICCV 2021): https://arxiv.org/abs/2012.09164
- PTv2 (NeurIPS 2022): https://arxiv.org/abs/2210.05666
- PTv2 code: https://github.com/Pointcept/PointTransformerV2
- Point Prompt Training / PPT (CVPR 2024): https://arxiv.org/abs/2308.09718
- Sonata SSL pre-training (CVPR 2025 Highlight): https://arxiv.org/abs/2503.16429
- PTv3 Extreme — 2024 Waymo Challenge winner: https://arxiv.org/abs/2407.15282
- FlatFormer (serialization inspiration): https://arxiv.org/abs/2301.08739
- Related repository page: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline; §7.8 compares PTv3 head-to-head against the other four model families
- Related repository page: `../overview/lidar-foundation-models.md` — 3D pre-training and foundation models
- Related repository page: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation
- Related method pages: `./kpconv.md` (O(N) grid-conv baseline), `./randla-net.md` (speed-optimized large-cloud baseline)
