# SphereFormer

<!-- method-priority:start
priority:
  learning: 4
  deployment: 3
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["perception", "lidar", "segmentation", "road-av"]
  reason: "SphereFormer's radial-window attention targets the sparse far-range density gap in single-scan LiDAR semantic segmentation."
method-priority:end -->

## What It Is

- SphereFormer is a **single-scan LiDAR semantic segmentation** (and detection) network introduced in "Spherical Transformer for LiDAR-based 3D Recognition" (Lai et al., CVPR 2023).
- It is designed for ego-centric point clouds from automotive spinning LiDAR scanners (nuScenes 32-beam, SemanticKITTI 64-beam, Waymo 64-beam class).
- Its defining innovation is **radial-window self-attention** in spherical coordinates (r, θ, φ): attention windows span the full radial depth of the scene while remaining narrow angularly, so that dense near-range tokens and sparse far-range tokens attend to each other directly.
- It pairs radial-window attention with a SparseConv U-Net backbone and a dynamic dual-head mechanism that also retains standard cubic-window (local) attention.
- At publication (CVPR 2023) it held **#1 on the nuScenes lidarseg test** (81.9 mIoU) and **#1 on SemanticKITTI test** (74.8 mIoU) simultaneously.
- See also: `cylinder3d.md` for the cylindrical-partition baseline that targets the same density problem with convolutions instead of attention; `minkowskinet.md` and `point-transformer-v3.md` for origin-agnostic alternatives appropriate for aggregated maps.

## Core Technical Idea

A spinning LiDAR produces a **radial density imbalance**: a 32- or 64-beam scanner places dense returns within roughly 20 m of the sensor and dramatically fewer beyond 50 m, because the same angular resolution covers far greater arc-length at larger radius. Cubic-window attention (3D-SWin-style networks) partitions space into equal-side Cartesian boxes. At long range, an entire box may contain only 1–3 points, leaving distant tokens with essentially no neighbours for self-attention and a near-zero effective receptive field. A pure SparseConv baseline on nuScenes lidarseg scores only **13.3 mIoU** on the distant bin (>50 m) — the baseline is genuinely broken at range.

SphereFormer's diagnosis is geometric: LiDAR is naturally organised in spherical coordinates (r, θ, φ), not Cartesian. Distant points are sparse in Cartesian space but lie on dense iso-angle shells in spherical space. A window aligned with azimuth θ and elevation φ spans the **entire radial depth** of the scene while remaining narrow angularly — collecting dense near-range and sparse far-range points into the same window. Dense near tokens act as context sources for distant sparse tokens within the same angular cone, which is precisely the information flow the architecture needs.

The result: on nuScenes lidarseg val, the distant bin improves from **13.3 → 30.4 mIoU** (+17.1 pp) with radial-window attention added to the SparseConv baseline. No other architectural change was required to achieve this gain.

## Operator Mechanics

### Spherical Coordinate Conversion

Each occupied voxel centre (x, y, z) is converted to spherical coordinates, with the sensor placed at (0, 0, 0):

```
r   = sqrt(x² + y² + z²)
θ   = arctan2(y, x)          # azimuth
φ   = arcsin(z / r)           # elevation
```

### Radial Window Partition

Windows are defined by **partitioning only along θ and φ** with fixed angular step sizes (Δθ, Δφ). All voxels sharing the same discrete cell `(⌊θ/Δθ⌋, ⌊φ/Δφ⌋)` are assigned to the same window regardless of radial distance r. This produces long, narrow **pyramid-shaped** windows extending from the sensor origin to the maximum range of the scanner:

- nuScenes / SemanticKITTI: radial extent 120 m, angular step [2°, 2°]
- Waymo: radial extent 80 m, angular step [1.5°, 1.5°]

Each window mixes dozens of dense near-range tokens with a handful of distant tokens; they attend to each other directly, transmitting dense local geometry as context to the sparsely sampled far-range points.

### Exponential Splitting for Radial Position Encoding

Because a radial window spans >50 m, naively binning the relative radial displacement `r_ij` into uniform integer indices produces metre-scale buckets for distant pairs. SphereFormer applies **exponential splitting** for the radial lookup index:

```
idx_r(r_ij) =
  -max(0, ceil(log2(-r_ij / a))) - 1   if r_ij < 0
   0                                    if r_ij = 0
  +max(0, ceil(log2( r_ij / a)))        if r_ij > 0
```

where `a` is a small base scale parameter. This is a log-scale ruler: centimetre-precision bins near the query point (small |r_ij|), metre-scale bins at 50 m. The sign convention preserves directionality. Indices are offset by L/2 so lookup into a learnable table `t^r ∈ ℝ^{L × (h·d)}` is always non-negative.

For θ and φ, standard uniform splitting is used: `idx_θ(θ_ij) = ⌊θ_ij / interval_θ⌋`.

The rationale is physically grounded: LiDAR range noise also scales roughly with distance, so exponential binning is not merely convenient — it matches the sensor's actual precision profile at range.

### Windowed Attention with Decomposed Position Bias

Multi-head self-attention within each window:

```
Attn_k = softmax(Q_k · K_k^T + PosBias_k)
Out     = Attn_k · V_k
```

The positional bias is decomposed across three spherical axes:

```
PosBias_{k,i,j} = q_{k,i} · p_k^T  +  k_{k,j} · p_k^T
where  p = p^r_{ij} + p^θ_{ij} + p^φ_{ij}
```

Each component `p^r, p^θ, p^φ` is looked up from independent learnable embedding tables `t^r, t^θ, t^φ ∈ ℝ^{L × (h·d)}`. There is no absolute position encoding; raw xyz coordinates are injected as point-level input features before the transformer stages.

**Complexity:** O(n²) per window in the number of tokens n in the window. Windows are small angularly so n is bounded, but n is highly variable — near-range angular cells can contain hundreds of tokens, making the O(n²) cost front-loaded in dense near-field regions. The SpTr (SparseTransformer) library handles the variable-length window batching efficiently.

### Dynamic Dual-Head Split

Attention heads are split into two groups: **the first half** run radial-window attention (far-field global context); **the remaining half** run standard cubic-window attention (dense local context). Outputs are concatenated and linearly projected. This lets each token dynamically weight far-range vs. local information through the learned projection. Ablation on nuScenes val: adding dynamic selection over pure radial-window attention adds **+0.81 pp mIoU**, resolving a small interaction cost that arises when radial windows and exponential splitting are combined without the head split.

## Inputs and Outputs

- **Input:** A single LiDAR scan as raw points `(x, y, z, intensity)`, voxelized at 0.1 m (nuScenes/Waymo) or 0.05 m (SemanticKITTI).
- Per-point features are encoded before voxel scattering; xyz coordinates enter the transformer as raw input features (no absolute encoding in attention bias).
- The partition is defined relative to the ego-vehicle sensor origin — the method assumes a single origin, single scan, ego-centric cloud.
- **Output:** Per-voxel class logits propagated back to contributing points; per-class semantic labels.
- For detection: the same backbone feeds a CenterPoint head outputting 3D bounding boxes with class and velocity.

## Architecture

SphereFormer is a **SparseConv U-Net with appended transformer blocks** — not a pure transformer. The backbone is a 5-stage sparse-voxel encoder using the spconv library, with channel widths [32, 64, 128, 256, 256]. Radial-window transformer modules are **appended at the end of each encoding stage** as plug-in modules; they do not replace convolutions. This modularity means SphereFormer transformer blocks can be bolted onto any SparseConv backbone with negligible additional parameter count.

The encoder-decoder structure:

1. **Input MLP:** Per-point feature encoding before voxel scatter (xyz, intensity, spherical coordinates).
2. **Encoder stages (×5):** Strided sparse downsampling + asymmetric residual blocks; SphereFormer transformer block appended at each stage output.
3. **Decoder stages:** Sparse transposed convolutions + skip connections; no transformer blocks in the decoder.
4. **Head:** Per-voxel linear classifier for segmentation; CenterPoint head for detection.

For detection, a shallower 4-stage backbone ([16, 32, 64, 128]) with SphereFormer applied at stages 2–3 is used.

**Key dependencies (official repo):** PyTorch 1.8.0, CUDA 11.1, GCC 7.5.0, spconv-cu114 2.1.21, SparseTransformer (SpTr) library for variable-length sparse attention, torch_scatter, torch_sparse, torch_geometric.

## Complexity and Compute

- **Window attention:** O(n²) per window; n varies from <5 (far-range angular cells) to hundreds (dense near-range cells). The SpTr library handles variable-length padding and batching without materialising empty tokens.
- **Memory:** Near-field large windows dominate memory. At high voxel resolution (0.05 m, SemanticKITTI), near-range 2°×2° cells can be large; a token-count cap or window sub-sampling is needed in practice.
- **Training hardware:** 4× RTX 3090 (24 GB each) for all three datasets. Batch size 16 (nuScenes), 8 (SemanticKITTI / Waymo).
- **No published inference latency figure** for a single GPU in the primary paper. The SparseConv backbone portion is fast; the transformer blocks add overhead proportional to occupied-voxel count. For on-vehicle Orin deployment, the tight CUDA 11.1 / spconv dependency chain would require porting work before a reliable cycle-time figure can be established.

## Training Recipe

| Hyperparameter | nuScenes | SemanticKITTI | Waymo |
|---|---|---|---|
| Optimizer | AdamW | AdamW | AdamW |
| Learning rate | 0.006 | 0.006 | 0.006 |
| Weight decay | 0.01 | 0.01 | 0.01 |
| LR schedule | Poly (power 0.9) | Poly (power 0.9) | Poly (power 0.9) |
| Epochs | 50 | 50 | 50 |
| Batch size | 16 | 8 | 8 |
| GPUs | 4× RTX 3090 | 4× RTX 3090 | 4× RTX 3090 |
| Voxel size | 0.1 m | 0.05 m | 0.1 m |

**Loss function:** Weighted cross-entropy combined with Lovász-softmax loss, consistent with the prevailing practice in LiDAR segmentation at the time. The exact weighting ratio is specified in the repository config YAML files (`config/nuscenes/*.yaml`) rather than in the main paper text — verify against repo configs before reproducing.

**Data augmentations** (standard for LiDAR seg; exact flags in repo config YAML):
- Random point flip (x-axis, y-axis)
- Random rotation (around z-axis)
- Random scaling
- Point jitter / dropout

No explicit data-mixing augmentations (LaserMix, PolarMix) are reported for the main SphereFormer results, though the architecture is compatible with them.

## Benchmark Results

### nuScenes LiDAR Semantic Segmentation (16 classes)

| Split | mIoU | Close (<20 m) | Medium (20–50 m) | Distant (>50 m) |
|---|---|---|---|---|
| Val (no TTA) — SparseConv baseline | 75.21 | 78.79 | 51.54 | 13.28 |
| Val (no TTA) — SphereFormer | 78.41 | 80.80 | 60.78 | 30.38 |
| Val (TTA) — SphereFormer | 79.5 | — | — | — |
| **Test — SphereFormer** | **81.9** | — | — | — |

The distant-bin improvement (13.3 → 30.4 mIoU, +17.1 pp) is the primary empirical claim. SphereFormer ranked **#1 on nuScenes lidarseg test** at publication.

### SemanticKITTI (20 classes)

| Split | mIoU | Close | Medium | Distant |
|---|---|---|---|---|
| Val (no TTA) | 67.8 | 68.6 | 60.4 | 17.8 |
| Val (TTA) | 69.0 | — | — | — |
| **Test** | **74.8** | — | — | — |

Distant-bin improvement on SemanticKITTI is more modest (val distant: 17.8%) than on nuScenes — sparser far-range labels and fewer distant annotated points in SemanticKITTI partially mask the architectural benefit. SphereFormer ranked **#1 on SemanticKITTI test** at publication.

### Waymo Open Dataset Semantic Segmentation

| Split | mIoU | Close | Medium | Distant |
|---|---|---|---|---|
| Val (no TTA) | 69.9 | 70.3 | 68.6 | 61.9 |
| Val (TTA) | **70.8** | — | — | — |

Pre-trained Waymo weights are **not released** due to Waymo dataset licence terms.

### nuScenes Object Detection (bonus task)

| Metric | Score | Rank at publication |
|---|---|---|
| NDS | 72.8% | 3rd |
| mAP | 68.5% | 3rd |

### Ablation on nuScenes Val

| Configuration | mIoU | Close | Medium | Distant |
|---|---|---|---|---|
| SparseConv baseline | 75.21 | 78.79 | 51.54 | 13.28 |
| + Radial windows | 76.31 | 78.95 | 57.21 | 26.67 |
| + Exp. splitting only | 77.60 | 79.92 | 61.09 | 31.10 |
| + Radial windows + exp. splitting | 77.05 | 79.51 | 58.94 | 28.95 |
| + Dynamic dual-head selection | **78.41** | **80.80** | 60.78 | **30.38** |

Note: "radial + exp. splitting without dynamic selection" (77.05) falls slightly below "exp. splitting alone" (77.60), indicating a small interaction cost between the two components when heads are not split — dynamic selection resolves this. Radial windows vs. cubic windows (full model): **78.41 vs. 76.19 mIoU** (+2.22 pp).

## Variants and Lineage

**SphereFormer → Point Transformer V3 (PTv3, CVPR 2024):** From the same group (dvlab-research). PTv3 replaces radial windows with serialised point-order (space-filling curve) attention, scales to larger models, and achieves approximately 82.7% on SemanticKITTI test — surpassing SphereFormer. PTv3 is **origin-agnostic** (no sensor-relative coordinate dependency) and more directly applicable to aggregated multi-scan maps. SphereFormer's radial-window idea was a demonstrated stepping stone toward PTv3's more general design.

**SpTr library:** SphereFormer motivated the SparseTransformer (SpTr) library for efficient variable-length sparse attention, which has been reused by subsequent works beyond the dvlab group.

**Multi-frame PTv3-EX (2024, Waymo challenge):** Adds past-frame accumulation on top of PTv3, directly addressing multi-scan fusion — the trajectory SphereFormer conceptually pointed toward but did not implement natively.

**Cylinder3D (CVPR 2021):** A convolution-based predecessor that targets the same radial density problem with a cylindrical partition. SphereFormer replaces the convolutional solution with attention and achieves substantially higher accuracy; both share the single-origin partition assumption and both fail on aggregated maps for the same structural reason.

## Strengths

- **Targeted fix for a demonstrated failure mode.** The +17.1 pp distant-bin gain on nuScenes (13.3 → 30.4 mIoU) addresses exactly the regime where prior art was broken, with a principled geometric argument for why.
- **Plug-in module design.** Transformer blocks append to any SparseConv backbone without re-architecture; adoption friction is low.
- **Dual-head dynamic selection.** Combining radial and cubic attention heads gives both far-field and near-field context adaptively with no per-point manual weighting.
- **Exponential splitting is physically principled.** Log-scale relative-position encoding matches LiDAR's range-proportional noise profile — the design choice is justified beyond empirical ablation.
- **Multi-task.** The same backbone achieves competitive detection results (3rd nuScenes NDS) without architectural changes beyond the head — the representation is richer than segmentation-only designs.
- **State-of-the-art at publication** on two major benchmarks simultaneously, and still a strong reference baseline for the single-scan segmentation task.

## Failure Modes

- **Sensor-origin dependency (critical for maps — see Aggregated-Map Suitability).** Radial-window partitioning presupposes a single sensor origin; the (r, θ, φ) conversion and all window assignments are meaningless without one. This is not patchable by fine-tuning.
- **O(n²) within-window cost in dense near-field regions.** At close range, a 2°×2° angular cell may contain hundreds of voxels — memory and compute spike. The SpTr library mitigates this but does not eliminate the quadratic scaling.
- **SemanticKITTI distant-bin gains are modest.** Distant mIoU at val reaches only 17.8%, far below the nuScenes result. Label scarcity at range in SemanticKITTI partially masks the architectural benefit.
- **No temporal or multi-frame fusion.** SphereFormer is strictly single-scan; PTv3-EX adds past-frame accumulation, which further improves distant performance via temporal context unavailable to SphereFormer.
- **Engineering complexity.** Tight version pinning (PyTorch 1.8, CUDA 11.1, spconv-cu114 2.1.21, SpTr compiled extensions) makes porting to newer or embedded stacks non-trivial; Jetson Orin integration requires forward-porting work before a reliable latency figure is achievable.
- **Waymo weights withheld.** Dataset licence terms prevent releasing trained models, limiting reproducibility for Waymo-domain evaluation.
- **Fixed angular window width.** The 2° step size means a window spans roughly 70 cm at 20 m but 3.5 m at 100 m in Euclidean terms; the window is not isotropic in Cartesian space, creating inconsistent spatial scale for fine-grained classes at large ranges.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV (single-scan, on-vehicle) | strong | Designed for this — spinning-LiDAR ego-centric segmentation at the leading edge of single-scan accuracy. |
| Road AV (offline / aggregated maps) | not suitable | Origin-anchored partition; geometrically invalid on multi-scan clouds — see Aggregated-Map Suitability below. |
| Airside (single-scan, on-vehicle) | conditional | Per-scan inference on a vehicle-mounted scanner is appropriate once retrained on airside data; no published airside results. |
| Airside (aggregated semantic map) | not suitable | Same structural limitation as road-AV maps; use PTv3 or MinkUNet for the assembled map. |
| Warehouse / port / logistics-yard | conditional | Fits where a single-origin spinning LiDAR scans ego-centrically in real time; not applicable to aggregated surveyed clouds. |
| Mining / construction / agriculture | conditional | On-vehicle single-scan use is reasonable; outdoor terrain and irregular structures do not match the automotive training distribution. |

## Aggregated-Map Suitability

SphereFormer is **not directly applicable** to aggregated multi-scan LiDAR maps. The limitation is structural and cannot be resolved by fine-tuning or configuration change.

**The single-origin assumption.** Radial windows are defined by the partition `(⌊θ/Δθ⌋, ⌊φ/Δφ⌋)` where θ and φ are measured from a **single sensor origin**. In an aggregated map built from SLAM-aligned scans across an airside area, logistics yard, or urban district, there is no such origin — points have been accumulated from tens or hundreds of scanner poses, each with its own position and orientation. Choosing an arbitrary virtual origin (e.g., map centroid or first scan pose) destroys the physical meaning of the partition: points that were angularly close to their original scanner but angularly distant from the virtual origin are scattered across separate windows, breaking the intended near-to-far information flow.

This is structurally identical to the limitation that affects Cylinder3D's cylindrical partition, which this knowledge base's hub page §7.2 documents in detail. Both coordinate systems are sensor-relative, not world-relative. The difference is that Cylinder3D's cylindrical voxels become inconsistently sized; SphereFormer's radial windows become geometrically meaningless. In both cases the fundamental premise of the architecture — that the sensor origin is a fixed, meaningful reference — is violated.

**The hub-page §7.7 recommendation, precisely interpreted.** The aggregated-map segmentation hub (`../overview/aggregated-map-semantic-segmentation.md`) §7.7 recommends "SphereFormer-style radial attention" for sparse far-field map regions. This recommendation refers to **per-scan inference**, not direct inference on the assembled map. The correct reading is:

1. Run SphereFormer on each raw scan with its own pose as origin → per-scan logits with strong far-range accuracy.
2. Project per-scan logits into the world-coordinate map and aggregate by label voting or probabilistic fusion.
3. Optionally apply a world-frame re-segmentation pass (PTv3 cubic/serialised attention, or MinkUNet) on the assembled map for final consistency — these architectures carry no sensor-origin assumption.

In step 1, SphereFormer's radial attention is entirely appropriate and achieves its designed benefit for distant scan points. In step 3, SphereFormer is the wrong tool.

The phrase "borrowing the radial-context idea" in the hub page refers to architectures that apply radial position encoding to per-scan intermediate features before aggregation — not to running SphereFormer's window partition on the assembled multi-scan cloud.

| Use context | Radial-window attention | Assessment |
|---|---|---|
| Per-scan inference (single sensor origin) | Origin is well-defined; mechanism works as designed | Recommended — SOTA far-range behaviour |
| Per-scan inference for subsequent map aggregation | Same; use per-scan logits as intermediate stage | Valid pipeline stage |
| Direct inference on assembled multi-scan map | No single origin; partition is geometrically meaningless | Not applicable |
| Far-field / off-trajectory map sub-regions | Trajectory origin as proxy; captures local density gradient | Partial benefit; workaround, not native support |
| Dense multi-view overlap region in map | Radial windows mix points from incompatible view geometries | Counter-productive |

**For aggregated-map segmentation**, use MinkUNet or Point Transformer V3 — Cartesian or serialisation-order attention with no sensor-origin dependency. See `minkowskinet.md` and `point-transformer-v3.md`.

## Implementation Notes

- Use SphereFormer for **single-scan, on-vehicle** segmentation tasks where a known sensor origin exists; do not apply it directly to aggregated multi-scan maps.
- For map construction, use SphereFormer at the **per-scan inference stage** to maximise far-range label quality before world-frame fusion; feed per-scan logits into a voting or probabilistic map update, then run a world-frame model (PTv3, MinkUNet) for final refinement if needed.
- Verify loss configuration against `config/nuscenes/*.yaml` in the repository — the main paper does not state the cross-entropy / Lovász-softmax weighting ratio explicitly; it is inferred from standard practice.
- The tight version stack (PyTorch 1.8, CUDA 11.1, spconv-cu114 2.1.21) is the primary deployment barrier for Jetson Orin or newer workstations. Budget porting effort before committing SphereFormer to a production pipeline; PTv3 from the same group has more recent dependency support.
- For airside training, no published airside domain adaptation exists — expect standard domain-shift issues (aircraft geometry, apron clutter, ground markings) relative to the nuScenes training distribution. Active learning or LoRA-style fine-tuning on 500–1,000 labelled airside frames should be explored.
- Apply LaserMix / PolarMix augmentations during training — empirical results on Cylinder3D show large gains from data-mixing augmentations that are compatible with SphereFormer's architecture.
- Validate far-range class accuracy explicitly (>50 m bin) during evaluation; this is where SphereFormer's design pays off and where standard mIoU averages can mask both improvements and remaining failures.
- If moving to a more map-compatible successor, PTv3 from the same lab is the direct upgrade path and retains the attention-based high-accuracy profile without the origin-anchored window constraint.

## Sources

- Primary paper: Lai et al., "Spherical Transformer for LiDAR-based 3D Recognition," CVPR 2023 — https://arxiv.org/abs/2303.12766
- CVPR HTML: https://openaccess.thecvf.com/content/CVPR2023/html/Lai_Spherical_Transformer_for_LiDAR-Based_3D_Recognition_CVPR_2023_paper.html
- CVPR PDF: https://openaccess.thecvf.com/content/CVPR2023/papers/Lai_Spherical_Transformer_for_LiDAR-Based_3D_Recognition_CVPR_2023_paper.pdf
- Supplemental PDF: https://openaccess.thecvf.com/content/CVPR2023/supplemental/Lai_Spherical_Transformer_for_CVPR_2023_supplemental.pdf
- ar5iv render (ablation detail): https://ar5iv.labs.arxiv.org/html/2303.12766
- Reference implementation: https://github.com/dvlab-research/SphereFormer
- SpConv v2 (SparseConv backend): https://github.com/traveller59/spconv
- Lovász-Softmax loss: https://arxiv.org/abs/1705.08790 (Berman et al. CVPR 2018)
- Related method page: `./cylinder3d.md` — the other single-origin partition method (cylindrical vs. radial); same aggregated-map limitation
- Related method page: `./minkowskinet.md` — Cartesian sparse-voxel alternative; recommended for direct aggregated-map segmentation
- Related method page: `./point-transformer-v3.md` — origin-agnostic serialised-attention successor from the same lab; preferred for both maps and high-accuracy single-scan use
- Related overview: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation pipeline context
- Related overview: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline; §7.7 model selection (SphereFormer-style radial attention for per-scan stage); §7.8 training-architecture comparison
