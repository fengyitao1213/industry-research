# RangeFormer

<!-- method-priority:start
priority:
  learning: 4
  deployment: 3
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["perception", "lidar", "segmentation", "road-av"]
  reason: "RangeFormer is the range-image transformer that first made range-image projection competitive with voxel and fusion methods on LiDAR semantic segmentation."
method-priority:end -->

## What It Is

- RangeFormer is a **range-image LiDAR semantic segmentation** framework introduced in "Rethinking Range View Representation for LiDAR Segmentation" (Kong et al. — ICCV 2023, NUS / Shanghai AI Lab).
- It operates on the **spherical range image** — the same 2D projection used by SalsaNext and CENet — but replaces the CNN backbone with a **Swin-style hierarchical vision transformer**, and surrounds it with a curated full-cycle pipeline: range-image-specific augmentation (RangeAug), sub-cloud post-processing (RangePost), and a memory-efficient training strategy (STR).
- Its central claim is that range-image projection has been systematically undervalued: prior accuracy gaps versus voxel and fusion methods were caused by weak CNN backbones, insufficient augmentation, and naive post-processing — not by the representation itself.
- RangeFormer is the **first range-image method to surpass all other representation families** (point-based, voxel-based, multi-view fusion) on SemanticKITTI, nuScenes-lidarseg, and ScribbleKITTI simultaneously (as of ICCV 2023).
- **24.3 M parameters, 73.3% SemanticKITTI test mIoU, approximately 6–27 FPS** depending on hardware and configuration (see Complexity and Compute for the honest account of this discrepancy).
- See also: `./salsanext.md` for the real-time range-image sibling; `./waffleiron.md` for the other projection-based method; `./cylinder3d.md` for the sparse-voxel single-scan alternative.

## Core Technical Idea

Range-image projection maps a 3D LiDAR scan onto a compact 2D spherical grid, enabling dense 2D inference (no sparse 3D kernels) and historically the fastest segmenters in the family (SalsaNext: 83 Hz, CENet: 33 Hz). But accuracy lagged behind voxel and fusion methods until 2023.

RangeFormer's thesis: three structural limitations held range-image CNNs back, and a transformer backbone addresses all three more naturally than dilated convolutions do:

1. **Many-to-one mapping.** Multiple 3D points project to the same 2D pixel (occlusion, discretization). CNNs have limited receptive fields for resolving collisions; transformers see the entire image in every attention layer.
2. **Semantic incoherence.** Nearby pixels in 2D range space can belong to semantically distant objects. Local convolution conflates them; global self-attention discriminates them.
3. **Shape deformation.** Cylindrical projection distorts object geometry differently at different elevations and ranges. Transformers are more tolerant of geometric deformation than fixed-kernel CNNs.

The performance gain — +8.6 pp over CENet (73.3% vs. 64.7%) — is not attributable to the transformer alone. The paper's ablation shows that RangeAug adds +1.1 mIoU and RangePost adds +0.9 mIoU independently. The headline contribution is a **full-cycle rethink**: backbone, augmentation, and post-processing all matter, and prior range-image work under-invested in the latter two.

## Operator Mechanics

### Spherical Projection

Each 3D point `p = (p_x, p_y, p_z)` with depth `p_d = sqrt(p_x^2 + p_y^2 + p_z^2)` is projected to 2D pixel coordinates:

```
u_n = (1/2) * [1 - arctan(p_y, p_x) / pi] * W
v_n = [1 - (arcsin(p_z / p_d) + phi_down) / xi] * H
```

Where `phi_down` is the downward tilt of the sensor FoV, `xi = |phi_down| + |phi_up|` is the total vertical FoV, `H` is image height, and `W` is image width.

**Input channels (6):** `(x, y, z)`, depth `p_d`, intensity `p_i`, existence flag `p_e ∈ {0, 1}` (SalsaNext uses 5; the flag marks valid vs. padded pixels for STR slice boundaries).

**Resolutions:** `H=64 × W∈{512, 1024, 2048}` (SemanticKITTI); `H=32 × W=1920` (nuScenes). Full W=2048 gives peak accuracy; STR trains at effective W≈384 per slice (Z=5 slices, 80% memory reduction).

### Range Embedding Module (REM)

A 3-layer MLP applied per pixel before the transformer stages:

```
6 -> 64 -> 128 -> 128  (BatchNorm + GELU after each layer)
```

Projects raw 6-channel inputs to a 128-d token embedding at full spatial resolution — analogous to patch embedding in a ViT, but per-pixel rather than per-patch.

### Hierarchical Transformer Encoder

The backbone is a **Swin-style hierarchical vision transformer** (not a plain ViT). Four stages apply shifted-window self-attention with progressive spatial downsampling:

| Stage | Spatial size | Channel dim | Heads | Downsample |
|-------|-------------|-------------|-------|------------|
| 1 | H × W | 128 | 3 | 1× |
| 2 | H/2 × W/2 | 128 | 4 | 2× |
| 3 | H/4 × W/4 | 320 | 6 | 4× |
| 4 | H/8 × W/8 | 512 | 3 | 8× |

Shifted-window attention provides both local and global context without quadratic cost. The strongly asymmetric aspect ratio (H≪W) is handled natively by 2D window partitioning. Positional encoding uses standard 2D learnable embeddings; the range-image's `(u, v)` coordinates implicitly encode azimuth and elevation, so no explicit spherical encoding is applied.

## Inputs and Outputs

| Item | Detail |
|------|--------|
| Input | Single LiDAR scan as `(x, y, z, intensity)` per point |
| Projection | Spherical range image `[H × W × 6]`; SemanticKITTI: `64 × 2048 × 6` |
| Output (raw) | Per-pixel class logits → softmax → per-pixel label |
| Output (post-RangePost) | Per-point semantic label (3D), re-aligned to original point cloud |
| Sensor assumption | Single spinning LiDAR, single ego-centric origin, per-scan |
| Model size | 24.3 M parameters |

## Architecture

### Overall Structure

An encoder-decoder transformer operating on the 2D range image:

1. **Range Embedding Module (REM):** 3-layer MLP (`6 → 64 → 128 → 128`, BN + GELU) producing a 128-d token per pixel.
2. **4-stage Swin-style hierarchical encoder:** Shifted-window self-attention at each stage with progressive 2× spatial downsampling; feature maps at 1×, 2×, 4×, and 8× reduced resolution.
3. **Multi-scale MLP decoder:** Each stage's feature map is projected to a unified 256-d channel via a per-stage linear layer, bilinearly upsampled to full `H × W`, then concatenated. Two MLP layers produce per-pixel class logits.
4. **Deep supervision (training only):** Auxiliary MLP head on each encoder stage. Supervision is discarded at inference.

**Model size:** 24.3 M parameters — considerably smaller than Cylinder3D (56.3 M) at higher accuracy.

### RangeAug — Range-Image-Specific Augmentations

Four augmentations applied on top of standard point-level transforms (rotation, jitter, flip, random drop):

| Augmentation | Mechanism | Probability |
|---|---|---|
| **RangeMix** | Splits two scans into k∈{2,3,4,5,6} equal azimuth bands; swaps corresponding bands between scans; preserves the spatial structure of the range image | 0.9 |
| **RangeUnion** | Fills empty (unoccupied) pixels in the range image with points from a second scan; k_union=0.5 (50% of empty pixels filled) | 0.2 |
| **RangePaste** | Copies rare-class objects from a second scan into the current scan's range image; targets the long-tail class distribution problem | 0.9 |
| **RangeShift** | Slides the entire scan along the azimuth direction by a random offset in [W/4, 3W/4]; disrupts positional overfitting | 1.0 |

Ablation: RangeAug adds +1.1 mIoU on SemanticKITTI validation.

### RangePost — Sub-Cloud Inference Post-Processing

Addresses the many-to-one mapping problem at inference time without KNN search:

1. Sub-sample the input point cloud into `num_sub=3` interleaved sub-clouds (every 3rd point).
2. Rasterize each sub-cloud into a separate range image — fewer collision conflicts per image.
3. Run the model on all 3 sub-images simultaneously (batched forward pass).
4. Stitch predictions back to original point positions.

Mitigates discretization artifacts more cleanly than SalsaNext's kNN voting. Ablation: +0.9 mIoU. The sub-cloud batching adds inference latency — part of the reason "~6 FPS" appears in some configurations (see Complexity and Compute).

### STR — Scalable Training from Range View

A divide-and-conquer strategy for training at high resolution without prohibitive GPU memory:

1. Partition each scan into Z non-overlapping azimuth slices (Z=5 for SemanticKITTI, giving effective W_train = 2048/5 ≈ 384 per slice; Z=2 for nuScenes).
2. Train on individual slices.
3. At inference, process all Z slices in a single batch and merge predictions.

**Effect:** ~80% memory reduction; 13.5% faster training. Accuracy cost: 72.2% STR vs. 73.3% full (SemanticKITTI test). STR is an explicit compute-efficiency variant, not the accuracy peak.

## Complexity and Compute

| Metric | Value |
|--------|-------|
| Parameters | 24.3 M |
| Latency (A100, per FRNet comparison table) | ~37 ms / ~27 FPS |
| Latency (alternate reported figure) | ~160 ms / ~6 FPS |
| FRNet (same benchmark) | ~34 ms / 29.1 FPS |
| SalsaNext (range-image real-time baseline) | ~12 ms / ~83 Hz |
| CENet (prior range-image CNN peak) | ~30 ms / ~33 FPS |

**Latency discrepancy — honest account:** Both figures appear in the literature attributed to RangeFormer. 37 ms / ~27 FPS is from the FRNet benchmark comparison table on A100. ~160 ms / ~6 FPS likely reflects full-resolution W=2048 + complete RangePost stack on a V100 or STR overhead. The paper does not reconcile this cleanly — always specify hardware when citing. Safe characterization: **6–27 FPS depending on config**, substantially slower than SalsaNext or CENet, not suitable for hard real-time closed-loop control. At 37 ms, RangeFormer is still 2–5× faster than voxel and fusion methods at equal or better accuracy — validating the range-image efficiency advantage at transformer scale.

## Training Recipe

| Hyperparameter | Value |
|----------------|-------|
| Optimizer | AdamW |
| Learning rate | 1×10⁻³ |
| Scheduler | OneCycleLR |
| Batch size | 32 |
| SemanticKITTI epochs | 60 |
| nuScenes epochs | 100 |
| Pre-training | Cityscapes (20 epochs) |
| Hardware | Single NVIDIA A100 or V100 |
| Training time | ~32 hours |

**Loss function:**

```
L = L_wce + L_dice + L_lovasz + L_boundary
```

- `L_wce` — weighted cross-entropy; down-weights road/vegetation, up-weights rare classes.
- `L_lovasz` — Lovász-Softmax; differentiable mIoU surrogate, directly optimizes the evaluation metric (cf. +6.2 mIoU in SalsaNext's ablation).
- `L_dice` — Dice loss for class-balance regularization.
- `L_boundary` — Boundary loss penalizing edge errors; counteracts range-image boundary-blur.

Augmentation: standard point-level transforms (rotation, jitter, flip, random drop) plus all four RangeAug augmentations (see Architecture).

## Benchmark Results

### SemanticKITTI Test Set — 19 Classes

| Method | Family | mIoU (%) | FPS | Params |
|---|---|---|---|---|
| **RangeFormer** | Range-Img (Transformer) | **73.3** | ~6–27 | 24.3 M |
| RangeFormer + STR | Range-Img (Transformer) | 72.2 | ~7+ | 24.3 M |
| FRNet (2023) | Range-Img (Frustum) | 73.3 | 29.1 | 10.0 M |
| Fast-FRNet | Range-Img (Frustum) | 72.5 | 33.8 | 7.5 M |
| 2DPASS | Multi-View Fusion | 72.9 | 8.4 | — |
| RPVNet | Multi-View Fusion | 70.3 | — | 24.8 M |
| GASN | Voxel | 70.7 | — | — |
| Cylinder3D | Sparse Voxel | 65.9 | 6.2 | 56.3 M |
| RangeViT (CVPR 2023) | Range-Img (ViT) | 64.0 | ~10 | — |
| CENet (ICME 2022) | Range-Img (CNN) | 64.7 | 33.4 | 6.8 M |
| SalsaNext (ISVC 2020) | Range-Img (CNN) | ~55.8 | ~83 | 6.73 M |
| RangeNet++ (IROS 2019) | Range-Img (CNN) | 52.2 | 12.0 | — |

**Gap over prior range-image SoTA (CENet):** +8.6 pp (64.7% → 73.3%).
**Gap over prior voxel SoTA (Cylinder3D):** +7.4 pp at 3–4× faster inference.
**Note on SalsaNext mIoU:** 55.5–59.5% across sources depending on post-processing config; ~55.8% is cited in RangeFormer-context comparisons (±2% uncertainty, see research brief).

### nuScenes-lidarseg Test Set

| Method | mIoU (%) |
|---|---|
| **RangeFormer** | **80.1** |
| FRNet | 82.5 |
| 2DPASS | 80.8 |
| Cylinder3D | 77.9 |
| RPVNet | 77.6 |
| RangeViT | ~75 (val only) |

RangeFormer nuScenes val=78.1%; test=80.1% — ensure consistent split when comparing against papers that report val only.

### Weak Supervision — ScribbleKITTI (8.06% Labeled Points)

| Method | mIoU (%) |
|---|---|
| **RangeFormer** | **63.0** |
| CENet | 60.8 |
| Cylinder3D | 57.0 |

Demonstrates that the architecture and augmentation advantage persists under label scarcity — directly relevant for new-domain deployment where full annotation budgets are not available.

### Panoptic Segmentation — SemanticKITTI Test

Panoptic-RangeFormer extends RangeFormer with an instance head (near-trivial extension):

| Metric | Panoptic-RangeFormer | PHNet (prior SoTA) |
|---|---|---|
| PQ | 64.2% | 61.5% |
| PQ† | 69.5% | 67.9% |
| RQ | 75.9% | 72.1% |

## Variants and Lineage

The range-image family traces a clean lineage from CNN to transformer to frustum-hybrid:

```
RangeNet++ (IROS 2019, CNN, DarkNet53, 52.2%, ~12 Hz)
  -> SalsaNext (ISVC 2020, residual dilated CNN, ~55.8%, ~83 Hz — real-time branch)
    -> CENet (ICME 2022, larger-kernel CNN + aux heads, 64.7%, 33 Hz — CNN accuracy peak)
      -> RangeViT (CVPR 2023, Valeo AI, ViT + conv stem/decoder, 64.0%, ~10 Hz)
      -> RangeFormer (ICCV 2023, Swin-style hierarchical transformer, 73.3%, 6-27 Hz)  <- this page
        -> FRNet (late 2023, Frustum-Range encoder + point fusion, 73.3%, 29 Hz)
```

**RangeNet++ (IROS 2019):** Founded the projection family. DarkNet53 CNN on 64×2048 range image + GPU kNN post-processing. ~50 M parameters; the kNN convention became standard for the family.

**SalsaNext (ISVC 2020):** Real-time branch. Residual dilated encoder, pixel-shuffle decoder, uncertainty estimation. 83 Hz GPU; the canonical embedded-deployment baseline. See `./salsanext.md`.

**CENet (ICME 2022):** CNN accuracy peak. Larger-kernel convolutions, multiple auxiliary heads, progressive resolution training. 64.7% at 33 Hz — the CNN ceiling before transformers.

**RangeViT (CVPR 2023, Valeo AI):** First ViT-based range-image segmenter. ViT backbone (Cityscapes init) + convolutional stem and decoder. Shows 2D pre-training transfers to range-image LiDAR. SemanticKITTI: 64.0% — transformer backbone alone does not close the gap; the full-cycle pipeline matters.

**RangeFormer (ICCV 2023):** This page. Swin-style hierarchical transformer + RangeAug + RangePost + STR. 73.3%; first range-image method to beat all other representation families simultaneously.

**FRNet (late 2023):** Practical successor. Frustum Feature Encoder + Frustum-Point Fusion + FrustumMix + Range-Interpolation. Matches 73.3% at 29.1 FPS with 10.0 M parameters — the accuracy-efficiency Pareto frontier as of late 2023. RangeFormer retains an advantage in ablation clarity, panoptic extension, and weak-supervision documentation.

## Strengths

- **Representation vindication.** Definitively demonstrates that the range-image accuracy gap was a pipeline problem, not a representation problem. Opens the door to the full transformer ecosystem for range-image methods.
- **Full-cycle thinking.** RangeAug (+1.1 mIoU), RangePost (+0.9 mIoU), and the transformer backbone are separately ablated with clean results — each component earns its place.
- **Speed vs. other high-accuracy methods.** At ~37 ms (A100), RangeFormer is 2–5× faster than voxel and fusion methods at equal or better accuracy. Cylinder3D (65.9%, ~170 ms) is both less accurate and slower.
- **Weak-supervision robustness.** 63.0% mIoU with 8% labels suggests strong generalization from sparse annotations — relevant for new-domain deployment (airside, warehouse, mining) where full annotation is expensive.
- **Panoptic extension.** Near-trivial extension to panoptic segmentation (add instance head): state-of-the-art PQ 64.2% with no architectural surgery.
- **Single-GPU training (STR).** ~80% memory reduction via STR makes full training accessible on a single A100 or V100 — no multi-GPU cluster required, at a modest 72.2% vs. 73.3% accuracy cost.

## Failure Modes

- **Not real-time.** 6–27 FPS is insufficient for a 10 Hz LiDAR sensor in closed-loop control. SalsaNext (83 Hz), CENet (33 Hz), or FRNet (29 FPS) are required for real-time or production use.
- **Single-origin assumption.** Spherical projection is ego-centric — defined by a single sensor origin per scan. Core architectural constraint for aggregated maps (see Aggregated-Map Suitability).
- **Resolution vs. memory.** Full accuracy requires W=2048; STR reduces to 72.2% mIoU. Limits edge deployment.
- **Boundary artifacts and occlusion.** Range-image boundary blur (±180° seam) and many-to-one mapping under dense overlap are partially mitigated by RangePost but not eliminated; voxel methods handle heavy occlusion more robustly.
- **Long-tail rare classes.** Motorcyclist, bicycle, person remain the per-class bottlenecks; RangePaste helps but thin rare-object IoU is lower than point-based methods in some evaluations.
- **FPS ambiguity.** Both ~37 ms (A100) and ~160 ms (V100 + full RangePost) appear in the literature without full reconciliation — always specify hardware when citing.
- **Superseded by FRNet for production.** FRNet matches 73.3% at 29 FPS with 10.0 M parameters. RangeFormer's role is accuracy reference and ablation benchmark.
- **Code availability.** No confirmed public repository as of May 2026; `ldkong.com/RangeFormer` returns 404.

## Domain Fit

| Domain | Fit | Note |
|--------|-----|------|
| Road AV (on-vehicle, single-scan) | moderate | Accurate but not real-time; FRNet is the better production choice at the same accuracy tier. |
| Road AV (offline / aggregated maps) | not suitable | Architecturally mismatched — see Aggregated-Map Suitability. |
| Airside AV (on-vehicle, single-scan) | conditional | Viable accuracy reference and pre-labeling front-end once retrained on airside data; not real-time for closed-loop use; thin GSE structures and aircraft geometry are vulnerable to boundary-blur and occlusion artifacts. |
| Airside AV (aggregated / static map) | not suitable | No single sensor origin; projection degenerates for multi-viewpoint aggregated map data. |
| Warehouse / port / logistics-yard | conditional | Fits for single-scan ego-centric inference; weak for fused or surveyed point clouds; indoor occlusion density amplifies many-to-one failures. |
| Mining / construction / agriculture | limited | Solid-state and irregular-scan sensors common in these settings require retraining; rough terrain and vegetation density amplify boundary-bleeding. |
| Offline pre-scan labeling front-end | strong | At 6–27 FPS, suitable as an offline per-scan pre-labeler producing pseudo-labels for map points before voxel-based map refinement. |
| Accuracy benchmark / research baseline | strong | Clean ablation, documented pipeline, well-reported per-class results; the natural family reference for evaluating range-image methods against voxel and fusion baselines. |

## Aggregated-Map Suitability

**Range-image methods are architecturally mismatched for segmenting aggregated multi-viewpoint LiDAR maps. This applies to RangeFormer as it does to all projection-family methods.**

The spherical projection is defined by a single sensor origin. Every channel — azimuth, elevation, depth `p_d`, and the 2D spatial layout that the transformer's attention exploits — is computed relative to the ego-vehicle position at the moment of a single scan:

```
u_n = f(arctan(p_y, p_x))    <- azimuth from THIS sensor position
v_n = f(arcsin(p_z / p_d))   <- elevation from THIS sensor position
```

For an **aggregated multi-scan map** from tens or hundreds of sensor poses, there is no single valid origin. Applying the projection to aggregated data produces catastrophic sparsity (no dense 64×2048 grid exists from any arbitrary reference), a meaningless depth channel (`p_d` no longer measures distance from the original sensor), broken Swin attention locality (nearby pixels no longer imply nearby scene points), and a training distribution incompatibility — not a domain adaptation gap, but a format mismatch.

**Verdict:** RangeFormer is not suitable as the primary segmentation method for aggregated multi-scan LiDAR maps. Voxel-based (Cylinder3D, SphereFormer, PTv3) or point-based (PointTransformer, PTv3) methods are the correct choice.

**Where RangeFormer IS relevant to the aggregated-map workflow:**

| Role | Relevance | Notes |
|------|-----------|-------|
| Per-scan real-time on-vehicle segmentation | low | Not real-time; SalsaNext or FRNet are better choices for this role |
| Offline pre-scan labeling front-end | medium | At 6–27 FPS, suitable for producing high-accuracy per-scan pseudo-labels that are subsequently merged and refined in 3D by a voxel-based map integrator |
| Short-horizon temporal accumulation (2–5 scans) | medium | Feasible for small T windows where sensor-origin shift is small; temporal channel extension has been demonstrated in the broader range-image family |
| Accuracy benchmark / ceiling reference | high | 73.3% provides a documented accuracy ceiling for the range-image family; useful for calibrating voxel-method targets in offline map-building pipelines |

For airside AV — where the target is segmenting aggregated taxiway and apron maps rather than ego-vehicle single-scan output — voxel or point-based methods should be primary. In the range-image family: SalsaNext (~56%, 83 Hz) and CENet (65%, 33 Hz) are better real-time and high-throughput offline labeling choices respectively; FRNet (73.3%, 29 FPS) is the more deployment-ready offline pre-labeler; RangeFormer sits as the accuracy reference and ablation benchmark for the family.

## Implementation Notes

- Do not apply RangeFormer to aggregated multi-viewpoint maps — the projection assumption is the deciding constraint (see Aggregated-Map Suitability).
- For **production deployment at 73.3% accuracy**, prefer FRNet (29.1 FPS, 10.0 M parameters): faster, smaller, no kNN post-processing. RangeFormer is a research reference, not a production baseline.
- For **offline per-scan pre-labeling** in a map construction pipeline, RangeFormer is viable; CENet or FRNet may be preferable on throughput grounds.
- Swin Transformer backbone available in timm and mmdetection3d; REM (3-layer MLP) and MLP decoder are straightforward additions if implementing from scratch.
- Apply all four **RangeAug** augmentations — ablation confirms they are not optional for reaching 73.3%.
- Use the full **loss combination** (WCE + Lovász + Dice + Boundary): Lovász-Softmax directly optimizes mIoU; Boundary loss addresses range-image boundary blur.
- The weak-supervision result (63.0% at 8% labels) supports domain adaptation via partial annotation for new deployments (airside, warehouse); the 500–1,000 frame fine-tuning threshold from the broader knowledge base applies.
- **STR** (Z=5 slices, 1.1 pp cost) enables single-GPU training — practical for constrained retraining budgets. Use full-resolution for final evaluation.

## Sources

- **Paper (ICCV 2023):** https://openaccess.thecvf.com/content/ICCV2023/html/Kong_Rethinking_Range_View_Representation_for_LiDAR_Segmentation_ICCV_2023_paper.html
- **arXiv (v3, Sep 2023):** https://arxiv.org/abs/2303.05367
- **Author GitHub:** https://github.com/ldkong1205 (RangeFormer code not confirmed as of May 2026; project page ldkong.com/RangeFormer returns 404)
- **Semantic Scholar:** https://www.semanticscholar.org/paper/b65f49eda22357efd8de011ab5e6e5d734b5c221
- **FRNet (follow-up, Dec 2023):** https://arxiv.org/abs/2312.04484 — primary source for FRNet vs. RangeFormer FPS comparison table
- **RangeViT (CVPR 2023, Valeo AI):** https://arxiv.org/abs/2301.10222 | GitHub: https://github.com/valeoai/rangevit
- **CENet (arXiv:2207.12691, ICME 2022):** https://arxiv.org/abs/2207.12691 | GitHub: https://github.com/huixiancheng/CENet
- **SalsaNext (arXiv:2003.03653, ISVC 2020):** https://arxiv.org/abs/2003.03653 | GitHub: https://github.com/TiagoCortinhal/SalsaNext
- **RangeNet++ (IROS 2019):** https://ieeexplore.ieee.org/document/8967762
- **Lovász-Softmax loss:** https://arxiv.org/abs/1705.08790 (Berman et al., CVPR 2018)
- Related overview: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline (§7 model families, §7.8 training-architecture comparison)
- Related overview: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation (range-image methods §3.3)
- Related method: `./salsanext.md` — the real-time range-image sibling; directly comparable family context
- Related method: `./waffleiron.md` — the other projection-based method (dense 2D projection of point features)
- Related method: `./cylinder3d.md` — the sparse-voxel single-scan alternative
