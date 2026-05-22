# RandLA-Net

<!-- method-priority:start
priority:
  learning: 5
  deployment: 4
  type: "method"
  stage: "classic-baseline"
  maturity: "fielded-pattern"
  tags: ["perception", "lidar", "segmentation", "mapping", "road-av"]
  reason: "RandLA-Net is the efficient large-scale point-cloud segmentation baseline, designed for million-point clouds and used across MLS survey workflows."
method-priority:end -->

## What It Is

- RandLA-Net is an efficient deep architecture for semantic segmentation of large-scale point clouds, introduced in "RandLA-Net: Efficient Semantic Segmentation of Large-Scale Point Clouds" (CVPR 2020 Oral, Hu et al.).
- It is built to label point clouds of millions of points directly, without the heavy pre/post-processing — block partitioning, voxelization, or projection — that earlier methods required.
- It uses an encoder-decoder structure and outputs a per-point class label.
- Its primary design priority is throughput and memory efficiency at scale: it uses **random sampling** (O(1)) rather than farthest-point sampling (O(N²)), making million-point inference tractable on commodity hardware.
- It is a widely-used baseline for MLS/ALS survey-cloud segmentation and the canonical answer to "segment a 1M-point cloud as fast as possible."
- A 2025 descendant, **DeepLA-Net** (CVPR 2025), extends the random-sampling + attentive-aggregation paradigm with deeper LFA blocks to near-transformer accuracy.

## Core Technical Idea

The primary bottleneck in large-cloud segmentation is point sampling. Farthest-point sampling (FPS) is O(N²) in time — processing 1 M points takes >200 s and is completely impractical for map-scale inference. RandLA-Net replaces FPS with **uniform random sampling** (O(1), ~0.004 s for 1 M points — approximately 50,000× faster).

The downside of random sampling is that informative points (object boundaries, thin structures, rare classes) may be discarded with no preference for what is retained. RandLA-Net compensates through an aggressive receptive-field enlargement strategy: the **Local Feature Aggregation (LFA)** module. LFA encodes rich local geometry before each subsampling step, so that even after 75% of points are discarded, the surviving points carry context from the discarded neighborhood. Two stacked LFA sub-units with a residual connection constitute a **dilated residual block** that rapidly expands the effective receptive field despite aggressive decimation.

## Operator Mechanics

### Local Spatial Encoding (LocSE)

For each query point `p_i` and its K nearest neighbors `{p_i^k}`, LocSE constructs a 10-dimensional relative position descriptor:

```
r_i^k = [p_i ; p_i^k ; (p_i − p_i^k) ; ‖p_i − p_i^k‖]
```

This concatenates: the query's absolute position (3D), the neighbor's absolute position (3D), the relative difference vector (3D), and the scalar Euclidean distance (1D). The descriptor is then processed by a shared MLP to produce a geometrically augmented feature:

```
h_i^k = MLP(r_i^k)
f̃_i^k = concat(h_i^k, f_i^k)
```

where `f_i^k` is the neighbor's existing feature vector. This fuses geometric context with learned features for every neighbor, giving the subsequent pooling step rich material to work with.

### Attentive Pooling

Rather than max-pooling (which discards most neighbor information) or mean-pooling (which dilutes distinctive features), RandLA-Net uses learned attention weights:

```
ŝ_i^k = MLP(f̃_i^k)          (shared MLP producing scalar scores per neighbor)
s_i^k = softmax(ŝ_i^k)       (normalized across K neighbors)
f̂_i = Σ_k (s_i^k ⊙ f̃_i^k)  (weighted sum)
```

The softmax attention weights emphasize informative neighbors (e.g., points near a boundary or marking) over uninformative ones (e.g., flat pavement interior). This is a lightweight learned pooling — it does not involve query-key dot products and adds very little compute, but it recovers significant accuracy compared to max/mean pooling.

### Dilated Residual Block

Two LocSE + attentive-pooling units are stacked with a skip connection:

```
f_out = MLP(concat(f̂_i^{(1)}, f̂_i^{(2)})) + MLP_skip(f_i)
```

The first sub-unit aggregates over K=16 nearest neighbors; because random subsampling at each stage thins the cloud, the second sub-unit effectively reaches neighbors at 2–4× the original distance. Stacking two such units gives a rapidly-growing receptive field even as the cloud is aggressively decimated. This dilation-by-subsampling is the key mechanism that lets random sampling work without catastrophic loss of context.

## Encoder-Decoder Architecture

```
Input: N points (e.g., N = 65,536 for SemanticKITTI)

Encoder:
  RS(1/4) + LFA → N/4   points, 32 ch
  RS(1/4) + LFA → N/16  points, 128 ch
  RS(1/4) + LFA → N/64  points, 256 ch
  RS(1/4) + LFA → N/256 points, 512 ch

Decoder (nearest-neighbor interpolation + skip concat + MLP):
  UP → N/64  points, 256 ch
  UP → N/16  points, 128 ch
  UP → N/4   points,  32 ch
  UP → N     points,  64 ch

Head: shared FC → num_classes
```

`RS(1/4)` = uniform random subsample to 25% of remaining points. After four encoder stages the cloud is 256× smaller at the bottleneck. Decoder upsampling uses 3-NN inverse-distance weighted interpolation, the same mechanism as PointNet++ feature propagation.

## Complexity and Compute

| Component | Complexity | Notes |
|---|---|---|
| Random sampling (per stage) | O(1) | Uniform random index selection |
| K-NN search (per stage) | O(N · K) | K=16; fast with spatial hashing |
| LocSE + attentive pool | O(N · K · C) | Linear in N |
| Full 4-stage encoder | **O(N)** | N shrinks 4× per stage; total work ≈ 4/3 × O(N) |
| Memory | O(N) | No quadratic terms |

**Practical throughput**: ~23 frames/s on SemanticKITTI (65K points, RTX-class GPU). For 1 M-point inputs: ~43 ms on a data-center GPU, estimated 150–200 ms on NVIDIA Orin (at ~5 Hz — viable for low-frequency background map updates).

Contrast with FPS-based methods: FPS alone takes >200 s for 1 M points; RandLA-Net's full forward pass for 1 M points takes under 50 ms on modern hardware.

## Training Recipe

| Hyperparameter | SemanticKITTI | Semantic3D |
|---|---|---|
| Optimizer | Adam | Adam |
| Initial LR | 0.001 | 0.001 |
| LR decay | ×0.95 per epoch | ×0.95 per epoch |
| Batch size | 6 | 4 |
| Epochs | ~100 (practical convergence) | ~100 |
| Input points | 65,536 | 65,536 |
| K neighbors | 16 (each stage) | 16 (each stage) |
| Augmentations | Random flip, random rotation, scale jitter | Same |

Class-weighted cross-entropy is standard. The random sampling introduces mild run-to-run variance; averaging predictions over 5–10 random sampling instances reduces this at inference time.

For airside fine-tuning, consider Lovász-softmax loss in addition to class-weighted CE — it directly optimizes mIoU and is more robust to rare-class imbalance (markings, poles, GSE) than CE alone.

## Benchmark Results

| Dataset | mIoU | Notes | Year |
|---|---|---|---|
| SemanticKITTI (test) | **53.9%** | Val: 51.8%; SOTA for point-only at CVPR 2020 | 2020 |
| Semantic3D reduced-8 | **77.4%** (OA 94.8%) | Outperforms KPConv by +2.8 pp | 2020 |
| S3DIS 6-fold | ~70% | Less commonly cited in original paper | 2020 |
| nuScenes val | ~35% | Significant gap to modern methods | 2020 |

For longitudinal context:

| Dataset | RandLA-Net (2020) | PTv3 (2024) | Gap |
|---|---|---|---|
| SemanticKITTI val | 51.8% | **70.8%** | −19.0 pp |
| nuScenes val | ~35% | **80.4%** | −45 pp |
| Semantic3D | 77.4% | — | — |

The accuracy gap to modern transformers is large on AV-focused outdoor benchmarks. RandLA-Net's value is throughput and simplicity, not peak accuracy.

**Source**: https://arxiv.org/abs/1911.11236

## Variants and Lineage

### Semantic Query Network (SQN, 2021)
SQN extends RandLA-Net toward weakly-supervised segmentation, using semantic queries derived from sparse labels. Reduces label requirements by 10–100× while maintaining comparable accuracy. Relevant for airside where labeling cost is high.

### DeepLA-Net (CVPR 2025)
DeepLA-Net follows the RandLA-Net paradigm (random sampling + attentive aggregation) but substantially deepens the LFA blocks and adds modern training recipes. Results:
- S3DIS 6-fold: 79.8% mIoU
- ScanNet val: 75.7% mIoU

This demonstrates that the random-sampling + attentive-aggregation paradigm can approach transformer-level accuracy with sufficient depth — a significant finding for operators who prefer simpler architectures.

### PointNeXt (NeurIPS 2022) — Orthogonal Context
PointNeXt modernizes the PointNet++ FPS-based lineage (separate from RandLA-Net's random-sampling lineage) and achieves 74.9% on S3DIS by improving training recipes alone. The existence of both lineages demonstrates that both FPS-based and random-sampling-based methods benefit significantly from modern training practices.

## Aggregated-Map Suitability

### Scaling to Million-Point Maps

A 100-scan aggregated LiDAR map over a 300 m × 300 m airside area contains roughly 6.5 M–13 M points. RandLA-Net can process 1 M points in a single forward pass — making it the **fastest point-based method** for large-tile inference. Practical workflow:

- Tile the aggregated map into 500 K–1 M-point chunks with 10–20% overlap (e.g., 150 m × 150 m at 0.06 m resolution → ~750 K points).
- Run RandLA-Net on each tile; merge with logit averaging in the overlap zone.
- Total map throughput: ~10–20 tiles/s on a data-center GPU for 1 M-point tiles.

This is faster than KPConv (80–150 ms/100K pts) and much faster than PTv3 (44 ms/tile on A100 — but that requires serialization preprocessing). RandLA-Net is the recommended **speed-optimized first pass** in a multi-stage pipeline.

### Tiling with Overlap

Unlike KPConv's sphere-sampling, RandLA-Net uses rectangular crops (or spherical crops). Rectangular overlap (10–20% border) is standard:
- Use logit averaging in the overlap zone rather than "last write wins."
- Boundary artifacts are mild — the LFA module's receptive field grows rapidly, so context within 1–2 m of the crop boundary is still well-aggregated.

For very large coherent surfaces (runways, taxiways), the random sampling on thin structure at tile boundaries should be monitored. A practical mitigation: run two RandLA-Net passes with different random seeds and average predictions.

### On-Vehicle Real-Time Feasibility

RandLA-Net is the **most feasible point-based method for on-vehicle use**:

| Scenario | Input size | GPU latency | Orin estimate | Feasible? |
|---|---|---|---|---|
| Single scan | 65K pts | ~43 ms | ~150–200 ms | At 5 Hz (background) |
| Live submap (10 scans) | 650K pts | ~100 ms | ~350–500 ms | Background thread |
| Live submap (50 scans) | 3.25M pts | ~300 ms (tiled) | ~1 s (tiled) | Offline / scheduled |

For on-vehicle airside use, RandLA-Net running at 5 Hz in a background thread is viable for coarse semantic labeling of the accumulated submap (e.g., free space / pavement / structure). Fine-grained per-class accuracy (markings, thin objects) requires either a heavier model offline or a second focused pass.

### Receptive Field for Airside Classes

After four random-subsampling stages (256× reduction), the dilated residual blocks have an effective receptive field of 5–15 m depending on cloud density. For most airside surface classes this is adequate:

| Airside class | Typical extent | RandLA-Net RF | Verdict |
|---|---|---|---|
| Pavement / runway | 10s–100s m | 5–15 m (local texture suffices) | Adequate |
| Taxiway marking | 0.1–0.5 m wide | 5–15 m (nearby context captured) | Adequate |
| Ground support equipment | 1–5 m | 5–15 m | Adequate |
| Perimeter fence post | 0.05–0.1 m | Random sampling risk | **Marginal** |
| Thin poles, wires | < 0.05 m | High miss rate from random sampling | **Poor — rare class loss** |

The primary risk is random sampling removing isolated thin structures (poles, wires, fence posts). Mitigation: use importance-weighted sampling (seed extra points near high-gradient regions) or run a dedicated thin-structure detector in parallel.

### Offline vs. On-Vehicle Recommendation

| Scenario | Verdict |
|---|---|
| Offline HD-map production (speed-priority) | **Best fit among point-based methods** |
| Offline HD-map production (accuracy-priority) | Use PTv3 instead |
| Online submap annotation (10–50 scans, Orin) | **Viable at 5 Hz background** |
| On-vehicle real-time full-scan segmentation | Marginal — use sparse-conv method |
| Rare-class-critical labeling (markings, poles) | Add class-aware seeding or ensemble |

## Inputs and Outputs

- Inputs: a point cloud as `(x, y, z)` plus optional per-point features — RGB colour, intensity/reflectance, or none.
- No block partitioning or voxelization pre-step is required; the network ingests large raw clouds directly.
- Output: a per-point class label for semantic segmentation.
- It is a complete segmentation network (backbone + head), not just an operator.

## Strengths

- Fastest large-scale point-cloud segmentation among classical point-based methods — O(N) total complexity.
- Processes 1 M+ points in a single forward pass without tiling at the network level.
- Simple and easy to reproduce — no custom CUDA ops required beyond standard KNN.
- Attentive pooling and dilated residual blocks recover significant accuracy despite random sampling.
- Survey-industry pedigree — proven on Semantic3D (77.4%), the principal large-scale outdoor surveying benchmark.
- Scales gracefully: the same architecture handles 10K and 10M-point clouds by adjusting input size.
- Viable for on-vehicle background processing at 5 Hz (Orin estimate).

## Failure Modes

- Random sampling is indiscriminate: isolated thin structures (poles, wires, markings <0.1 m wide) are statistically lost and unrecoverable after subsampling.
- Accuracy gap to modern transformers is large (−19 pp on SemanticKITTI, −45 pp on nuScenes); not a suitable choice when accuracy is paramount.
- Fixed KNN neighborhoods can be sub-optimal across strongly non-uniform density (dense near-field MLS vs. sparse far-field).
- Random sampling introduces non-determinism — repeated runs differ slightly; fix seeds or average predictions when benchmarking.
- No global context mechanism; long-range disambiguation relies entirely on spatial priors from upstream map layers, not from the model.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV (offline) | strong | Standard efficient baseline on SemanticKITTI and large MLS clouds; good for fast offline auto-labeling passes. |
| Road AV (on-vehicle) | conditional | Lightweight, but designed for large clouds rather than a single sparse frame in a hard real-time loop. |
| Airside | conditional | No airside checkpoints; a fast, dependable baseline for offline aggregated-map segmentation once trained on airside data — watch rare-class recall. |
| Aerial / survey (ALS, TLS) | strong | Designed for and proven on large survey clouds (Semantic3D 77.4%); a common MLS/ALS baseline. |
| Warehouse / port / mining / construction / agriculture | conditional | Transfers as a generic, efficient large-cloud backbone. |

## Implementation Notes

- Add rare-class-aware tile/seed selection upstream — random sampling will statistically under-represent markings, poles, and other thin classes.
- Use Lovász-softmax loss or class-weighted cross-entropy; RandLA-Net does not address class imbalance internally.
- Use it as the fast first-pass model in an aggregated-map pipeline — PTv3 can refine tiles where RandLA-Net is uncertain (e.g., where per-point entropy is high).
- Average predictions from multiple random-sampling runs (5–10) to reduce variance; the cost is low because individual runs are fast.
- For thin-class-critical maps (markings, wires, poles), ensemble with a KPConv or sparse-conv pass on rare-class seeds.
- It pairs well as a cheap "segment-then-accumulate" prior model alongside a heavier authoritative PTv3 pass.
- For on-vehicle use on Orin, tune the input tile size to 65K points to keep latency under 200 ms.
- For comparison and context, see the KPConv page (`./kpconv.md`) for the O(N) grid-conv alternative and the Point Transformer V3 page (`./point-transformer-v3.md`) for the high-accuracy ceiling.

## Sources

- RandLA-Net paper (CVPR 2020 Oral): https://arxiv.org/abs/1911.11236
- Reference implementation: https://github.com/QingyongHu/RandLA-Net
- Project page: http://randla-net.cs.ox.ac.uk/
- DeepLA-Net (CVPR 2025, RandLA-Net lineage): referenced in CVPR 2025 — treat benchmark numbers as approximate until direct paper access
- Related repository page: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline; §7.8 compares point-based convolution head-to-head against the other four model families
- Related repository page: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation
- Related method pages: `./kpconv.md` (O(N) grid-conv alternative), `./point-transformer-v3.md` (high-accuracy transformer ceiling)
