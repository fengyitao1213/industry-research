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

- OctFormer is an octree-based transformer backbone for 3D point cloud understanding, introduced in "OctFormer: Octree-based Transformers for 3D Point Clouds" (Wang, ACM SIGGRAPH / Transactions on Graphics 2023).
- It produces per-point features for downstream semantic segmentation, detection, and classification heads.
- Its purpose is to make point-cloud attention **scale to large scenes** by using an octree to organise points into fixed-size local attention windows with linear complexity.
- It belongs to the family of serialisation-based transformers (alongside PTv3) that order points along a space-filling curve and attend within contiguous windows — OctFormer uses Morton-code (Z-order) ordering derived from the octree, PTv3 uses z-order/Hilbert curves directly over voxels.
- It is built on the **O-CNN / `ocnn-pytorch`** lineage — a decade-long effort to make octree-based 3D CNNs practical — making OctFormer an evolutionary step from octree convolutions to octree attention.
- It is one of the efficient large-cloud transformer options for offline aggregated-map segmentation, with its strongest benchmark evidence on indoor ScanNet-family datasets.
- With ~39 M parameters and `O(nK)` complexity, it is reported to run **17× faster** than competing point-cloud attention methods for clouds exceeding 200 k points, while matching or exceeding MinkowskiNet accuracy on ScanNet benchmarks.

## Core Technical Idea

- Self-attention over raw points is quadratic and infeasible for million-point clouds; OctFormer makes it tractable with an **octree**.
- Points are stored in an octree and sorted by their **shuffled Morton-code keys** (a space-filling-curve order), so spatially-near points become contiguous in memory.
- **Octree attention** partitions the sorted sequence into local windows that each contain a **fixed number of points** `K` — not a fixed spatial volume. Because window size is by point count, attention cost is constant per window regardless of how dense or sparse that region is.
- **Dilated octree attention** enlarges the receptive field by grouping non-contiguous points — skipping every `d` octree siblings before grouping — analogous to dilated convolution. This provides long-range context without increasing window size or compute.
- The two attention variants are **interleaved every other block** (similar to Swin Transformer's shifted-window strategy), ensuring distant points can exchange information within two attention layers.
- Complexity is `O(nK)` where `K` is the fixed window size: linear in point count for fixed `K`. Reported to be **17× faster** than competing point-cloud attention methods for `n > 200 k` points.

## Operator Mechanics

### Octree Construction

1. Build a spatial octree over the input point cloud to a configurable depth (default ~8 levels for indoor scenes at ScanNet scale).
2. At each leaf node level, assign points to octree cells; each cell holds approximately the same number of points by construction at a given depth.
3. Sort all points by **shuffled Morton-code key** — this is a bijective mapping from 3D integer coordinates to a 1D integer that preserves Z-order locality. After sorting, nearby 3D points are adjacent in the 1D sequence.

### Octree-Based Windowed Attention

```
# Pseudocode for one OctFormer attention block
sorted_points = sort_by_morton_key(points)          # 1D ordering
windows = split_into_fixed_size_windows(             # K points each
    sorted_points, window_size=K)
for each window:
    output = multihead_self_attention(window)        # O(K²) per window
# Total: O(n/K · K²) = O(nK) — linear in n for fixed K
```

Window size options: `K ∈ {16, 32, 48, 64}`, default `K=32`. The fixed-K window means computation per window is identical regardless of scene position, enabling efficient batched GPU execution.

### Dilated Octree Attention

```
# Dilated variant: skip d octree siblings before grouping
dilated_points = select_every_d_siblings(sorted_points, d=4)
windows = split_into_fixed_size_windows(dilated_points, K)
for each window:
    output = multihead_self_attention(window)
```

With dilation factor `d=4`, each dilated window spans a region roughly `d` times larger than a standard window, capturing context at a larger spatial scale with the same `O(K²)` per-window cost. Because dilated and standard blocks alternate, every point gains both local detail (standard) and long-range context (dilated) within two transformer layers.

### Conditional Positional Encoding

OctFormer injects fine geometric detail via a conditional positional encoding (CPE) computed from each point's local neighbourhood, consistent with other point transformers. This compensates for the coarse spatial information carried by Morton-code ordering alone.

### Architecture Details

- Base channel dimension: 96
- Block configuration: `{2, 2, 18, 2}` — four stages with skip connections, U-Net style
- Encoder stages downsample via octree pooling (coarser octree levels); decoder upsamples via unpooling
- Parameters: ~39 M (comparable to MinkowskiNet's 38 M)
- Implementation requires only ~10 lines of code using the O-CNN library once the octree is constructed

## Complexity and Compute

- **Complexity:** `O(nK)` — linear in point count for fixed `K`. 17× faster than competing attention methods for `n > 200 k` points.
- **Training:** 15 hours on 4× NVIDIA RTX 3090 GPUs; 13 GB GPU memory per card on ScanNet. This is substantially more expensive than SPT (3 h on 1× A40) for a comparable parameter budget.
- **Octree construction:** additional pre-processing step; octree depth must be set to match scene scale and desired spatial resolution.
- **Memory:** ~39 M parameters at FP32 is ~150 MB; activation memory during training scales with `n` and batch size. The 13 GB per GPU on ScanNet represents typical transformer training overhead.
- **Inference latency:** not explicitly benchmarked in the paper for ScanNet scenes; the 17× speedup claim applies to attention computation only, relative to naive all-pairs attention at `n > 200 k`. End-to-end inference including octree construction, sorting, and head prediction is not separately quantified in the published results.

## Benchmark Results

| Dataset | OctFormer mIoU | Notes |
|---------|---------------|-------|
| ScanNet val | 74.5% (no test-time voting) / 75.7% (with voting) | Indoor RGB-D |
| ScanNet test | **76.6%** | Strong indoor result |
| ScanNet200 (all 200 classes) | **32.6%** | vs. ~25.3% MinkowskiNet (+7.3 pp) |
| ScanNet200 — Head (66 classes) | 53.9% | Common frequent classes |
| ScanNet200 — Common (68 classes) | 26.5% | Medium-frequency classes |
| ScanNet200 — Tail (66 classes) | 13.1% | Rare classes; ~2× prior SOTA |

The ScanNet200 results are particularly notable: the 66 tail classes represent rare fine-grained categories (e.g., blinds, shower, clothes), and 13.1% mIoU is approximately double the prior SOTA on these rare classes. This suggests OctFormer's adaptive-density windowing captures small objects more reliably than fixed-resolution alternatives.

**Important caveat:** The OctFormer paper does not report SemanticKITTI or outdoor mobile-mapping dataset results. All primary benchmarks are indoor RGB-D (ScanNet family). Outdoor LiDAR performance is uncharacterised in the published literature.

The reference implementation repository lists SemanticKITTI in its supported configurations, suggesting the authors experimented with outdoor data; however, competitive mIoU numbers for SemanticKITTI are not included in the published paper and should not be assumed without independent verification. For outdoor AV datasets, consult the PTv3 and SPT papers for empirically validated numbers on SemanticKITTI, nuScenes, KITTI-360, and DALES.

Source: https://arxiv.org/abs/2305.03045

## Training Recipe

| Hyperparameter | ScanNet (indoor) | Notes |
|---------------|-----------------|-------|
| Hardware | 4× RTX 3090 | 13 GB VRAM per GPU |
| Training time | ~15 hours | — |
| Loss | Cross-entropy + Lovász-softmax | Lovász for mIoU-calibrated rare-class optimisation |
| Optimizer | AdamW | Standard for transformers |
| Augmentation | Random rotation, scale, jitter, colour drop | Standard point-cloud augmentations |
| Octree depth | ~8 (ScanNet scale) | Must be re-tuned for outdoor scenes |
| Window size K | 32 (default) | Tune up for outdoor, sparser scenes |

For ScanNet200 (200-class fine-grained segmentation), training follows the same recipe but with a longer schedule and class-balanced sampling to prevent head-class dominance. The ~2× improvement on tail classes (13.1% vs. ~6% prior SOTA) comes from the model architecture, not special loss weighting.

**Outdoor adaptation note:** No published training recipe exists for OctFormer on SemanticKITTI or mobile-mapping datasets. Adapting from ScanNet weights requires adjusting octree depth (outdoor scenes are ~10–100× larger spatial extent), window size `K`, and likely the data augmentation suite (outdoor LiDAR augmentation differs from indoor RGB-D).

## Variants and Lineage

### O-CNN Lineage (2017–2022)

OctFormer is the latest in a decade-long series of octree-based 3D network architectures from the same research group:

- **O-CNN (SIGGRAPH 2017):** Octree-based 3D CNNs for shape analysis. Introduced efficient octree convolution operators; established the `ocnn-pytorch` library.
- **Adaptive O-CNN (SIGGRAPH 2018):** Adaptive octree representations for shape reconstruction.
- **O-CNN for large-scale segmentation (2022):** Scaled octree convolutions to SemanticKITTI and indoor datasets.
- **OctFormer (SIGGRAPH 2023):** Replaces convolutions with transformer attention blocks, keeping the octree structure for sorting and pooling.

The octree library (`ocnn-pytorch` / `https://github.com/octree-nn/ocnn-pytorch`) is a prerequisite for OctFormer and provides all octree construction, Morton-code sorting, and pooling/unpooling operators. This lineage gives OctFormer a relatively mature implementation compared to newer one-off research code, but it means adding `ocnn-pytorch` as a dependency.

### Relationship to PTv3 and Serialisation-Based Transformers

PTv3 (Point Transformer V3, 2024) covers overlapping ground: both use space-filling-curve ordering and fixed-size windowed attention. PTv3 directly sorts over a flat voxel grid using z-order or Hilbert curves; OctFormer builds an explicit octree first then sorts by Morton key. The practical differences are:

- OctFormer's explicit octree provides a ready-made multi-resolution pooling hierarchy without a separate subsampling step.
- PTv3 has a richer pre-training ecosystem (PPT multi-dataset, Sonata SSL) and has overtaken OctFormer in adoption.
- OctFormer's implementation is more deeply tied to the `ocnn` library; PTv3 is more framework-agnostic.

## Aggregated-Map Suitability

**Rating: Good for indoor maps; untested for outdoor AV maps**

OctFormer has properties that are theoretically well-suited to aggregated maps, but its benchmark evidence is limited to indoor RGB-D datasets:

**Linear complexity is essential.** A pre-registered airside map covering a full apron and taxiway system may contain 100 M–1 B points. Any quadratic-attention method is ruled out at that scale; OctFormer's `O(nK)` complexity keeps per-block cost proportional to point count. This property holds regardless of whether the input is indoor or outdoor.

**Adaptive density windowing.** Aggregated maps from multi-pass AV LiDAR have extreme density variation: highly dense overlapping sweeps at road-level, sparse at range extremes. The fixed-K octree window adapts to density by assigning geometrically similar spatial volumes to windows; denser regions get smaller spatial extent per window, sparser regions larger. This is preferable to fixed-voxel windows that either over-segment sparse regions or coarsely group dense ones.

**Octree pooling hierarchy.** The octree provides a natural multi-scale representation. For a map segmentation task with objects spanning several orders of magnitude in spatial size (pavement markings at 0.1 m scale, aircraft fuselage at 30 m scale), multi-scale context is critical. OctFormer's encoder-decoder exploits this natively.

**Outdoor LiDAR limitations.** The octree depth hyperparameter must be tuned per scene scale. Indoor ScanNet rooms at ~5–10 m scale and outdoor KITTI-360 scenes at ~100–500 m scale require fundamentally different depth settings. No published guidance exists for OctFormer on outdoor mobile-mapping data. Fixed-K windows that work well for ScanNet's ~25 k–100 k points per scene may not be well-calibrated for outdoor scenes with 100 k–10 M points.

**No outdoor LiDAR evidence.** Unlike SPT (validated on KITTI-360 and DALES), OctFormer has no published results on outdoor AV or MLS datasets. For airside AV work specifically, this is a meaningful gap — the claim of suitability is theoretical, not empirically grounded.

**Practical recommendation:** OctFormer is a reasonable fallback if the SPT partition approach fails (e.g., extremely sparse high-altitude aerial LiDAR where geometric descriptors are weak), or if an existing O-CNN pipeline is already in use. For new outdoor deployments, SPT or PTv3 are lower-risk choices with established outdoor benchmarks.

## Comparison with SPT for Map Use Cases

For offline aggregated-map segmentation — the primary use case in this knowledge base — SPT and OctFormer represent two different design philosophies:

| Dimension | OctFormer | SPT |
|-----------|-----------|-----|
| Representation | Octree + windowed attention | Superpoint graph + graph-aware attention |
| Compression | Octree depth controls resolution; no explicit point reduction | ℓ₀-Cut Pursuit reduces ~10⁸ points to ~10³–10⁴ tokens |
| Parameter count | ~39 M | ~212 k (full) / ~26 k (nano) |
| Training cost | 15 h / 4× RTX 3090 | 3 h / 1× A40 |
| Outdoor benchmark evidence | None published | KITTI-360 63.5%, DALES 79.6% |
| Indoor benchmark evidence | ScanNet test 76.6%, ScanNet200 32.6% | S3DIS 76.0% (6-fold) |
| Density adaptation | Fixed-K windows adapt spatially | Superpoint size adapts to local density |
| Panoptic support | Not natively | SuperCluster extension (209 k params) |
| Pre-training ecosystem | Minimal (no public multi-dataset checkpoints) | Minimal (no public multi-dataset checkpoints) |

**Decision guidance:** If the target map is predominantly indoor or enclosed (warehouse, maintenance hangar, terminal airside) and the O-CNN library is acceptable as a dependency, OctFormer is competitive. For outdoor exposed areas (apron, taxiway, runway edge), SPT's direct evidence on MLS and ALS datasets makes it the lower-risk default. Both architectures lack public airside-specific checkpoints; any deployment will require fine-tuning from available checkpoints on in-domain labelled data.

## Inputs and Outputs

- Inputs: a point cloud as coordinates `(x, y, z)` plus per-point features — intensity/reflectance, RGB colour, or normals.
- An octree is built over the cloud as pre-processing; octree depth sets the spatial resolution.
- Output: per-point feature embeddings; a task head turns them into per-point class logits for semantic segmentation.
- It is a backbone, paired with a segmentation, detection, or classification head.
- No images are required; colour is an optional input channel.

## Strengths

- The octree gives efficient spatial sorting and a ready-made multi-resolution pooling hierarchy in one structure.
- Fixed-point-count attention windows self-adapt to the non-uniform density of accumulated maps.
- Dilated octree attention supplies long-range context at the same per-window compute cost.
- `O(nK)` complexity — scales to large scenes and big tiles.
- Strong on ScanNet200 rare classes (13.1% tail mIoU), suggesting good handling of fine-grained categories.
- Mature O-CNN library dependency; implementation is ~10 lines once the octree infrastructure is in place.

## Failure Modes

- Octree construction and the `ocnn-pytorch` operator library add tooling overhead and a hard dependency most teams do not already carry.
- A smaller ecosystem and fewer pre-trained checkpoints than PTv3 or sparse-convolution backbones.
- The serialisation-based PTv3 covers similar ground and has overtaken OctFormer in adoption and pre-training ecosystem (PPT, Sonata).
- Octree depth caps spatial resolution in a manner analogous to a voxel-size trade-off; requires manual tuning per scene type.
- Fixed-K windows can mix semantically unrelated points in very irregular or sparse point clouds.
- Training cost (15 h on 4× RTX 3090) is non-trivial compared to SPT (3 h on 1× A40) for comparable parameter budgets.
- Primary benchmarks are indoor RGB-D (ScanNet family); outdoor LiDAR performance is unstated and unverified.
- Quality degrades with registration noise and residual dynamic objects, as with any transformer over aggregated maps.
- The 17× speed advantage applies to the attention kernel computation; end-to-end latency including octree construction, Morton-key sorting, and task-head prediction is not separately characterised in published results — production benchmarking should measure the full pipeline.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV (offline) | conditional | Competitive on SemanticKITTI/nuScenes in principle; PTv3 is the more common choice with established outdoor checkpoints. |
| Road AV (on-vehicle) | weak | A large-cloud transformer; not aimed at the embedded real-time budget. |
| Airside | conditional | No airside checkpoints exist; a reasonable efficient-transformer option for offline aggregated-map segmentation, but unproven outdoors. SPT is the stronger architectural fit. |
| Aerial / survey (ALS, TLS) | conditional | Linear complexity and adaptive windowing suit non-uniform survey clouds; outdoor depth tuning required. |
| Warehouse / port / mining / construction / agriculture | conditional | Transfers as a generic large-cloud 3D backbone; indoor-scale configurations work well for confined environments. |

## Implementation Notes

- Budget the `ocnn-pytorch` library dependency early — it is the main integration cost relative to a sparse-conv or PTv3 pipeline.
- Set octree depth to the resolution of the smallest class that matters, as you would a voxel size. For airside maps (~0.1 m minimum feature: painted markings), depth 8–9 is a starting point.
- Tune window size `K` for the expected point density of your map tiles. For outdoor LiDAR tiles at 50 m radius, `K=64` or larger may be needed to capture meaningful neighbourhood context.
- For aggregated-map segmentation, tile into overlapping blocks and merge with logit averaging; octree ordering does not remove the need for tiling at full-map scale.
- Compare directly against SPT and a sparse-conv baseline (MinkowskiNet or PTv3) before committing — all three occupy similar ground, and ecosystem maturity often decides in practice.
- Use mixed-precision (FP16/BF16) for offline throughput improvement; the 13 GB/GPU training footprint can be reduced substantially.
- Report per-class IoU; linear complexity does not by itself help the rare thin classes — examine tail-class IoU explicitly.
- If adapting to airside-specific classes, consider fine-tuning from ScanNet200 weights (the richest publicly available checkpoint) rather than training from scratch, given the absence of outdoor pre-trained OctFormer checkpoints.

## Sources

- OctFormer paper (SIGGRAPH 2023 / ACM TOG): https://arxiv.org/abs/2305.03045
- Reference implementation: https://github.com/octree-nn/octformer
- Project page: https://wang-ps.github.io/octformer
- O-CNN / octree library lineage: https://github.com/octree-nn/ocnn-pytorch
- Related overview: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline; §7.8 compares the transformer family head-to-head against the other four model families
- Related overview: `../overview/lidar-semantic-segmentation.md` — broad survey of LiDAR segmentation architectures
- Related method: `point-transformer-v3.md` — the serialisation-based transformer covering similar ground with a stronger outdoor pre-training ecosystem
