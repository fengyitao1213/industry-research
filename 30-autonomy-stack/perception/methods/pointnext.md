# PointNeXt

<!-- method-priority:start
priority:
  learning: 4
  deployment: 3
  type: "method"
  stage: "classic-baseline"
  maturity: "prototype"
  tags: ["perception", "lidar", "segmentation", "road-av"]
  reason: "PointNeXt is the modernized PointNet++ that shows most of the architecture-vs-transformer gap was a training-recipe artifact."
method-priority:end -->

## What It Is

- PointNeXt is a point-cloud segmentation and classification architecture introduced in "PointNeXt: Revisiting PointNet++ with Improved Training and Scaling Strategies" (Qian et al., NeurIPS 2022).
- It is a direct modernization of PointNet++: the Set Abstraction (SA) + Feature Propagation (FP) encoder-decoder backbone is preserved unchanged; a new **InvResMLP** scaling block is appended per encoder stage to enable efficient depth and width scaling.
- It outputs per-point class labels for semantic segmentation or a global feature vector for classification.
- Its central finding is methodological: most of the accuracy gap between PointNet++ and transformer-based models circa 2021 was a **training-recipe artifact**, not an inherent architectural deficit. Applying AdamW, cosine decay, label smoothing, and point-resampling raised PointNet++ from 77.9% to 86.1% OA on ScanObjectNN with zero architectural change.
- All published benchmarks are **indoor** (S3DIS, ScanNet v2) or object-level (ScanObjectNN, ModelNet40). No outdoor LiDAR results exist in the published literature.
- Codebase is distributed through the **OpenPoints** framework, which re-implements multiple baselines under a common training protocol to enforce fair comparison.

## Core Technical Idea

The thesis of PointNeXt is that prior point-cloud architecture comparisons were not apples-to-apples. Transformer-based methods had benefited from modern training practices (AdamW, cosine decay, label smoothing, aggressive data augmentation) while PointNet++ comparisons were run with an older recipe (Adam, step decay, no smoothing). When the same modern recipe is applied to PointNet++ without changing a single layer, ScanObjectNN accuracy rises by **+8.2% OA** — enough to surpass the then-state-of-the-art PointMLP.

Only after establishing this baseline does the paper introduce architecture changes. The InvResMLP block, appended after each SA stage, brings an additional accuracy increment and enables clean scaling from the lightweight PointNeXt-S to the high-accuracy PointNeXt-XL. The combined result (74.9% S3DIS 6-fold mIoU) matches or exceeds Point Transformer v1 at roughly 3× faster inference.

This has a practical implication: teams adopting PointNet++ with a legacy training pipeline may be leaving substantial accuracy on the table before any backbone switch is warranted.

## Operator Mechanics

### Preserved PointNet++ backbone (SA + FP)

PointNeXt does not modify the core PointNet++ operators:

- **Farthest Point Sampling (FPS):** selects a set of centroid points with maximal pairwise spatial coverage. Complexity is O(N²) in the naive implementation — a key scalability caveat at million-point scale.
- **Ball-query grouping:** for each centroid, gathers all points within a fixed radius `r` into a local neighborhood. The radius grows at each encoder stage, providing a hierarchical multi-scale receptive field.
- **Local MLP + max-pool:** a shared MLP is applied to grouped neighbor features; max-pooling reduces them to a single centroid feature.
- **Feature Propagation (FP):** decoder stages upsample via 3-NN inverse-distance interpolation plus skip connections from the encoder, recovering per-point predictions for dense segmentation.

### The InvResMLP block

InvResMLP is appended **after the first SA block in each encoder stage**, enabling depth scaling independently of the SA operator. Its components (each ablated individually in the paper on S3DIS Area 5):

| Component | mIoU drop if removed | Role |
|---|---|---|
| Residual connection | −6.5% | Required for stable optimization |
| Separable MLPs | −3.9% (but 3× faster) | Decouples neighbor aggregation from point-wise transform |
| Relative position normalization | −2.3% | Stabilizes optimization under weight decay |
| Inverted bottleneck (4× expansion) | −1.5% | Enriches feature extraction capacity |
| Stem MLP | −0.4% | Minor contribution |

**Relative position normalization:** neighbor coordinates relative to the centroid are divided by the ball-query radius:

```
p_rel = (p_j - p_i) / r
```

This normalizes input scale so raw relative coordinates are not near-zero values that require large weights to learn, which destabilizes convergence under weight decay.

**Separable MLPs** (inspired by MobileNet / ASSANet): the MLP is split into (a) a single-layer MLP applied to **neighborhood features** between grouping and reduction, and (b) a two-layer MLP applied to **point features** after reduction. This decouples neighborhood aggregation from point-wise transformation, reducing cost while preserving expressiveness.

**Inverted bottleneck:** the second MLP expands channels by **4×** before projecting back down — following the MobileNetV2/EfficientNet design pattern of expanding in the residual branch.

## Inputs and Outputs

- **Input:** a point cloud as `(x, y, z)` per point; optional additional per-point features (intensity, RGB, normals). No voxelization, projection, or block partitioning required.
- **Input size (segmentation):** 24,000 points per batch item at training time (S3DIS); inference tiles are sized to match.
- **Output:** per-point class label for semantic segmentation; global descriptor for classification.
- PointNeXt is a complete segmentation or classification network (backbone + head), not a standalone operator.

## Architecture

PointNeXt uses a **hierarchical encoder-decoder** built from SA stages (downsampling) and FP stages (upsampling):

```
Input: N points

Encoder:
  SA stage 1: FPS + ball-query + local MLP → N/4 points
    + InvResMLP × B_1
  SA stage 2: FPS + ball-query + local MLP → N/16 points
    + InvResMLP × B_2
  SA stage 3: FPS + ball-query + local MLP → N/64 points
    + InvResMLP × B_3
  SA stage 4: FPS + ball-query + local MLP → N/256 points
    + InvResMLP × B_4

Decoder:
  FP: 3-NN interp + skip-concat + MLP  (×4, restoring to N)

Head: shared FC → num_classes (per-point)
```

### Scaling rules

Two independent scaling axes:

- **Width:** increase `C` (stem MLP channel size).
- **Depth:** increase `B` (number of InvResMLP blocks per SA stage).

Naive scaling (widening or deepening the SA blocks directly, without InvResMLP) degrades performance — naive width −11.1% and naive depth −7.1% mIoU on S3DIS compared with InvResMLP-based variants.

**Published segmentation variants:**

| Variant | C | B (blocks per stage) | S3DIS 6-fold mIoU |
|---|---|---|---|
| PointNeXt-S | 32 | 0 (no InvResMLP) | 68.0% |
| PointNeXt-B | 32 | (1, 2, 1, 1) | 71.5% |
| PointNeXt-L | 32 | (2, 4, 2, 2) | 73.9% |
| PointNeXt-XL | 64 | (3, 6, 3, 3) | 74.9% |

## Complexity and Compute

| Component | Complexity | Notes |
|---|---|---|
| FPS (per SA stage) | O(N²) naive | Dominant bottleneck for large-N inputs |
| Ball-query grouping | O(N · K) | K = neighborhood count; fast with spatial indexing |
| Local MLP + max-pool | O(N · K · C) | Linear in N after indexing |
| InvResMLP block | O(N' · C) | N' is subsampled point count; cheap |
| Full encoder-decoder | O(N²) dominated by FPS | |

**Published speed benchmarks (NVIDIA Tesla V100 32 GB):**

- PointNeXt-L on S3DIS segmentation: approximately **3× faster** than Point Transformer v1 at comparable or better mIoU. Specific reported figures: PointNeXt-XL ~46 instances/sec vs. Point Transformer v1 ~34 instances/sec.
- PointNeXt-S classification: **10× faster** than PointMLP while exceeding it by 2.3% OA.

The FPS bottleneck is the critical scalability constraint. For million-point aggregated maps it is computationally prohibitive; tiling into ~24–50K-point blocks is required before any forward pass. RandLA-Net's O(1) random sampling was specifically designed to avoid this cost.

## Training Recipe

The training recipe is the core contribution of the paper. The cumulative effect on ScanObjectNN OA (PointNet++ baseline, no architectural change):

| Intervention | Cumulative OA |
|---|---|
| Baseline PointNet++ (original recipe) | 77.9% |
| + Point resampling augmentation | ~80.4% (+2.5%) |
| + Label smoothing (CE loss) | ~81.7% (+1.3%) |
| + AdamW optimizer | ~82.3% (+0.6%) |
| + Cosine LR decay | ~82.8% (+0.5%) |
| **Total training-only gain** | **86.1% (+8.2%)** |

**General hyperparameters (most tasks):**

| Parameter | Value |
|---|---|
| Optimizer | AdamW |
| Initial LR | 0.001 |
| LR schedule | Cosine decay |
| Weight decay | 1e-4 |
| Loss | CrossEntropy with label smoothing |
| Batch size | 32 |

**S3DIS segmentation specifics:**

| Parameter | Value |
|---|---|
| Initial LR | 0.01 |
| Epochs | 100 (training set repeated 30× per epoch) |
| Batch size | 8 |
| Input points | 24,000 per batch item |

**ScanObjectNN classification:** 250 epochs, weight decay 0.05, 1,024 input points.

**Published augmentation set:** random rotation, random scaling, translation jitter, height appending, color auto-contrast, color drop, and **point resampling** (randomly resample N points from the input rather than always using the first N; this single augmentation contributes +2.5% OA alone).

## Benchmark Results

### Semantic segmentation (indoor)

**S3DIS 6-fold cross-validation:**

| Method | mIoU | OA | mAcc |
|---|---|---|---|
| PointNet++ (original) | 54.5% | — | — |
| PointNet++ (improved training only) | 68.1% | — | — |
| Point Transformer v1 | ~74.5% | — | — |
| **PointNeXt-XL** | **74.9%** | 90.3% | 83.0% |

**ScanNet v2:**

| Method | val mIoU | test mIoU |
|---|---|---|
| PointNet++ (original) | 53.5% | — |
| Point Transformer v1 | — | 68.6% |
| CBL | — | 70.5% |
| **PointNeXt-XL** | **71.5%** | **71.2%** |

### Classification (ScanObjectNN, hardest split PB_T50_RS)

| Method | OA |
|---|---|
| PointNet++ | 77.9% |
| PointMLP | 85.4% |
| **PointNeXt-S** | **87.7%** |

### Outdoor / driving benchmarks

**No published results exist.** The PointNeXt paper evaluates exclusively on indoor scenes (S3DIS, ScanNet v2) and object-level benchmarks (ScanObjectNN, ModelNet40, ShapeNetPart). There are no published PointNeXt results on SemanticKITTI, nuScenes, Waymo Open Dataset, or any other outdoor driving or surveying benchmark as of 2025. Any claim of outdoor performance requires independent empirical validation.

## Variants and Lineage

### Family lineage

| Model | Year | Key change |
|---|---|---|
| PointNet (Qi et al.) | 2017 | First deep net on raw points; shared MLP + global max-pool; no local structure |
| PointNet++ (Qi et al.) | 2017 | Hierarchical SA with ball-query + FPS; introduces local receptive fields |
| PointNeXt (Qian et al.) | 2022 | Modernized training recipe + InvResMLP scaling block on PointNet++ |

### Relation to adjacent methods

- **KPConv (Thomas et al., 2019):** continuous-kernel convolution placing learnable kernel points in 3D space. A different design philosophy — convolution rather than MLP hierarchy — with proven outdoor (SemanticKITTI) performance. More memory-intensive; see `./kpconv.md`.
- **RandLA-Net (Hu et al., CVPR 2020):** replaces FPS with O(1) random sampling, enabling tractable million-point inference. Trades spatial coverage for throughput. Outdoor-validated. See `./randla-net.md`.
- **Point Transformer v1 (Zhao et al., 2021):** self-attention on local neighborhoods; strong S3DIS results; significantly slower than PointNeXt. PointNeXt-XL matches or exceeds it at ~3× the throughput.
- **PointMLP (Ma et al., 2022):** aggressive pure-MLP classification network; PointNeXt-S surpasses it by 2.3% OA at 10× faster inference.
- **Point Transformer v3 (2024):** post-PointNeXt attention-based model with outdoor benchmark coverage (SemanticKITTI, nuScenes); the current high-accuracy ceiling. See `./point-transformer-v3.md`.

### The "architecture vs. training recipe" question

PointNeXt triggered a broader community re-evaluation. Several transformer papers that claimed large gains over PointNet++ were found to be smaller than initially reported once training recipes were equalized. The OpenPoints framework was released alongside the paper specifically to enforce fair comparison by retraining all methods from scratch under a common protocol. This remains the authoritative reference for understanding how much accuracy is attributable to architecture versus training regime.

## Strengths

- **Raw-point fidelity:** no voxelization step means thin structures (runway markings, poles, taxiway edge lights) are preserved at full resolution in principle.
- **Speed-accuracy Pareto:** faster than Point Transformer v1 at comparable or better S3DIS accuracy; 10× faster than PointMLP on classification.
- **Interpretable scaling:** C and B parameters give a clear, ablated dial from lightweight (PointNeXt-S) to high-accuracy (PointNeXt-XL) without architecture redesign.
- **Well-documented training recipe:** AdamW + cosine decay + label smoothing is widely stable; reproduced via OpenPoints with published hyperparameters.
- **Hierarchical receptive field:** ball-query radius grows at each SA stage, providing natural multi-scale geometric context.
- **No O(N²) attention:** pure MLP architecture avoids the quadratic cost of self-attention; inference scales better than transformer variants for moderate-N inputs.
- **Benchmark credibility:** 74.9% S3DIS 6-fold and 71.2% ScanNet v2 test are meaningful reference numbers within the indoor point-cloud segmentation literature.

## Failure Modes

- **Indoor-only validation:** all published benchmarks are indoor or object-level. Outdoor LiDAR statistics differ substantially — sparser return density, wider dynamic range, dominant ground-plane structure, long-range thin features. Transfer quality to outdoor scenes is unvalidated.
- **FPS is O(N²):** farthest-point sampling dominates cost at large N; for aggregated maps of even moderate size (> 200K points), FPS over the full cloud is impractical. Tiling is required.
- **Fixed ball-query radius:** does not adapt to variable point density. Aggregated maps combine dense near-ground returns with sparse higher-altitude returns; density-adaptive methods (KPConv deformable kernels) are better-matched to multi-density scenes.
- **No long-range context:** ball-query limits each layer to a fixed neighborhood; global context accumulates only through depth. Transformer-based methods aggregate globally at every layer.
- **Tiling seam artifacts:** like all PointNet++-lineage methods, large maps require tiling into overlapping blocks; inter-tile context is lost and seam artifacts require post-processing to resolve.
- **Thin-class outdoor performance unknown:** raw-point processing preserves thin classes structurally, but the absence of outdoor benchmark numbers means runway-marking or signage segmentation accuracy is unvalidated.
- **Superseded at scale:** PTv2 and PTv3 (post-2022) exceed PointNeXt-XL on S3DIS and extend to outdoor benchmarks; for new projects with accuracy requirements, they are the stronger choice.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV (offline) | conditional | No SemanticKITTI / nuScenes results; credible MLP-hierarchy baseline but unvalidated outdoors — use MinkUNet or PTv3 for outdoor maps. |
| Road AV (on-vehicle) | conditional | FPS bottleneck limits real-time use on full scans; S-variant may be viable on subsampled inputs. |
| Airside (offline maps) | conditional | Raw-point fidelity is attractive for thin airside structures, but zero outdoor validation — lower confidence than MinkUNet or PTv3. |
| Indoor / large building | strong | Primary validated domain; S3DIS and ScanNet results are state-of-the-art for the MLP-hierarchy family. |
| Warehouse / port / logistics-yard | conditional | Transfers as a generic efficient backbone; indoor-validated domain statistics are closer to structured indoor environments than open outdoor. |
| Aerial survey (ALS, TLS) | weak | No published ALS/TLS benchmarks; RandLA-Net (Semantic3D 77.4%) is the better-validated point-based baseline for large outdoor survey clouds. |

## Aggregated-Map Suitability

### Why it is credible

- **Raw-point processing** avoids voxelization loss of thin-structure resolution — relevant for runway markings, taxiway edge lights, and pole objects in airport aggregated maps.
- **Hierarchical SA** naturally handles multi-scale geometry: dense tarmac surfaces at one scale, sparse overhead structures at another.
- **Ball-query receptive field** provides a physically interpretable 3D neighborhood filter, appropriate for structured infrastructure geometry.
- **Computational efficiency** relative to transformers reduces per-tile inference cost once tiling is in place.

### Why caution is warranted

**Zero published outdoor validation.** PointNeXt's S3DIS and ScanNet results are entirely indoor. Outdoor LiDAR has qualitatively different characteristics — sparser density, dominant planar ground returns, longer-range thin structures — and the degree of transfer is unknown. Compared alternatives are better validated:

- **MinkUNet** (sparse voxel convolution) has direct SemanticKITTI and nuScenes results and is the established outdoor segmentation baseline.
- **Point Transformer v3** extends to outdoor benchmarks with state-of-the-art accuracy.

PointNeXt is a credible but **less proven** option for outdoor and aggregated-map use relative to MinkUNet or PTv3.

### Tiling strategy

Standard approach for PointNet++-family methods on million-point maps:

1. Divide the aggregated map into **overlapping spatial tiles** (e.g., 20–50 m tiles with 5–10 m overlap).
2. **Subsample each tile** to ~24–48K points before inference (matching training distribution).
3. Run PointNeXt forward pass per tile.
4. **Merge predictions** in overlap zones via majority vote or confidence-weighted average.
5. Post-process with connected-component filtering or CRF for boundary consistency.

This matches the S3DIS Area inference approach and is operationally established, but it increases engineering complexity and introduces latency proportional to map area. For speed-critical pipelines, RandLA-Net processes larger tiles without subsampling.

**Airside-specific classes** (aircraft stands, FATO markings, GSE, jet bridges, apron taxiway markings) appear in no published training set. Domain adaptation — either fine-tuning with airside-annotated data or LoRA-style adapter layers — is required regardless of backbone choice.

## Implementation Notes

- Use the **OpenPoints framework** (`https://github.com/guochengqian/openpoints`) rather than standalone PointNet++ repos — it provides the correct training recipe and fair-comparison baselines.
- Apply the full training recipe (AdamW + cosine decay + label smoothing + point resampling) before making any architectural decisions; the recipe alone is worth +8.2% OA.
- For segmentation, tile large point clouds into ~24K-point blocks with overlap before inference; do not attempt full-cloud FPS at million-point scale.
- Use class-weighted cross-entropy or Lovász-softmax loss for airside fine-tuning — both address rare-class imbalance (markings, poles, GSE) that standard CE does not handle.
- Monitor FPS compute time when scaling tile sizes; above ~100K points per tile, FPS dominates and PointNeXt-S or RandLA-Net may be preferable for throughput.
- For thin-class-critical maps (markings, wires, poles), consider ensembling with a KPConv pass — KPConv's continuous-kernel convolution handles irregular density better.
- Choose the variant to match your compute budget: PointNeXt-S for speed-priority use; PointNeXt-XL for accuracy-priority; B and L variants for intermediate trade-offs.
- Benchmark outdoor performance empirically before committing to PointNeXt for an outdoor deployment — the indoor results do not transfer by assumption.

## Sources

- PointNeXt paper (NeurIPS 2022): https://arxiv.org/abs/2206.04670
- NeurIPS 2022 proceedings: https://proceedings.neurips.cc/paper_files/paper/2022/hash/9318763d049edf9a1f2779b2a59911d3-Abstract-Conference.html
- OpenReview: https://openreview.net/forum?id=EAcWgk7JM58
- Official GitHub (PointNeXt): https://github.com/guochengqian/PointNeXt
- OpenPoints library (training framework): https://github.com/guochengqian/openpoints
- Project page / docs: https://guochengqian.github.io/PointNeXt/
- Related repository pages:
  - `../overview/aggregated-map-semantic-segmentation.md` — §7.1 point-based convolution family; §7.8 training-architecture comparison across model families
  - `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation context
  - `./randla-net.md` — sibling efficient point-based method (random sampling, O(N) scaling, outdoor-validated)
  - `./kpconv.md` — continuous-kernel point convolution alternative; outdoor-validated; density-adaptive
  - `./point-transformer-v3.md` — attention-based alternative; outdoor benchmarks; current high-accuracy ceiling
