# FRNet

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["perception", "lidar", "segmentation", "road-av"]
  reason: "FRNet is the frustum-range network that matches RangeFormer's accuracy at roughly 5x the speed — the current real-time range-image SOTA."
method-priority:end -->

## What It Is

- FRNet is a **LiDAR semantic segmentation** network introduced in "FRNet: Frustum-Range Networks for Scalable LiDAR Segmentation" (Xu et al., arXiv December 2023; accepted IEEE Transactions on Image Processing February 2025).
- It operates on the spherical range image — the same 2D projection used by SalsaNext, CENet, and RangeFormer — but introduces a **frustum representation** that preserves all 3D points within each projected pixel's angular bin, then fuses those 3D point features bidirectionally with the 2D backbone at every encoder scale.
- Its central claim is that the accuracy/speed ceiling of the prior range-image CNN generation (RangeNet++, SalsaNext, CENet) is a structural problem: 2D-only reasoning discards or conflates points that project to the same pixel. Transformer methods (RangeFormer, RangeViT) recover accuracy through global attention but at steep latency cost. FRNet recovers the same accuracy with a 3D-aware frustum bridge at near-CNN speed.
- FRNet is the **Pareto-optimal point in the range-image family as of TIP 2025**: it matches RangeFormer's 73.3% SemanticKITTI test mIoU at 29.1 FPS versus RangeFormer's 6.2 FPS, with 10.0 M parameters versus 24.3 M (59% fewer).
- **10.0 M parameters, 73.3% SemanticKITTI test mIoU, 29.1 FPS on a GeForce RTX 2080Ti.**
- See also: `./salsanext.md` for the real-time CNN range-image sibling; `./rangeformer.md` for the accuracy-leading transformer range-image sibling; `./waffleiron.md` for the other projection-based method.

## Core Technical Idea

Range-image methods project a 3D scan onto a compact 2D spherical grid and run dense 2D convolutions — enabling the fastest LiDAR segmenters in the family (SalsaNext: ~42 Hz, CENet: ~33 Hz). The ceiling they hit is the **many-to-one pixel collision problem**: multiple 3D points at different depths but the same azimuth and elevation bin map to the same pixel. Classic solutions either discard the extra points (information loss) or apply KNN post-processing (RangeNet++) to recover approximate per-point labels. Both options degrade accuracy or add latency.

Transformer methods (RangeFormer) handle the collision problem with global self-attention — every pixel can attend to every other, resolving ambiguities that local convolutions miss — but they pay the full transformer compute cost at each attention layer, landing at 6.2 FPS even on modern hardware.

FRNet's answer: a **frustum representation** that bridges 2D efficiency with 3D-aware reasoning. A frustum is a 3D wedge anchored at the sensor origin; all points inside one angular bin (one pixel's angular extent) form a group regardless of depth. FRNet keeps every point in its frustum, learns per-point features from 3D geometry, and then exchanges those features bidirectionally with the 2D backbone feature map at each encoder stage. The 2D backbone remains the dominant compute path (dense convolutions on the H × W image); the 3D frustum branch operates on small per-pixel point groups (typically 1–3 points each). The result: no KNN post-processing, no attention overhead, and full 3D awareness recovered from lightweight MLP operations within each frustum.

## Operator Mechanics

### Frustum Definition

A **frustum** is the set of all LiDAR points that project to the same pixel (u, v) in the spherical range image. Points in a frustum share azimuth and elevation direction from the sensor but differ in range. Projection formula (standard spherical):

```
u = round(0.5 * (1 - arctan(y/x) / pi) * W)
v = round((1 - (arcsin(z/r) + fdown) / (fup + fdown)) * H)
```

Where `(fup, fdown)` is the sensor vertical FoV, `H × W` is the range-image grid, and `r` is Euclidean range. For SemanticKITTI: fdown = −25°, fup = +3°, resolution 64 × 512. For nuScenes: fdown = −30°, fup = +10°. All points with the same `(u, v)` are kept — no discarding at projection time. This is the core collision-avoidance mechanism.

The frustum count M equals the number of populated pixels (≤ H × W). Each frustum is sparse (1–3 points in practice) but the representation is geometrically lossless for the scan.

### Frustum Feature Encoder (FFE)

Groups all points by their (u, v) pixel assignment. For each frustum, computes the centroid P̃ (mean coordinate of all points in the frustum). Per-point initial features:

```
F_p^0 = MLP([P; P - P_tilde])
```

Where `P` is the raw 3D point coordinate and `P - P_tilde` is the centroid-relative offset (local geometry descriptor). Frustum-level feature via max-pooling:

```
F_f^0 = Flatten(MaxPool(F_p^0))
```

Outcome: each point holds a geometry-aware local descriptor; each frustum holds a compact aggregate. No positional encoding module is required — the raw (x, y, z) coordinates and centroid offset carry all positional information implicitly.

### Frustum-Point (FP) Fusion Module (iterative, multi-scale)

Applied at each stage of the 2D backbone, producing a bidirectional exchange between the 2D feature map and the 3D per-point features:

**Frustum-to-Point (top-down):** Inflates (scatter) the current frustum feature into per-point space, concatenates with previous per-point features, and passes through an MLP:

```
F_p^i = MLP([Inflate(F_f_tilde^{i-1}); F_p^{i-1}])
```

**Point-to-Frustum (bottom-up):** Aggregates updated per-point features back to the frustum using residual-attentive fusion:

```
F_f^i = F_f_tilde^{i-1} + sigmoid(h(F_fuse^i)) * F_fuse^i
```

Where `h` is a linear projection and `*` is element-wise product. The residual structure prevents feature collapse during deep hierarchical exchange.

This bidirectional loop runs at each backbone stage: the 2D backbone informs 3D point features (frustum-to-point), and updated point features are folded back to refine the 2D frustum representation (point-to-frustum). Every scale sees both 2D context and 3D geometry.

### Head Fusion Module

Concatenates multi-scale frustum features from all backbone stages, fuses with final per-point features:

```
F_logit = MLP(MLP(Inflate(F_f^out)) + F_p^out) + F_p^0
```

The `F_p^0` skip-connection re-injects raw point geometry as a residual anchor. Output: per-point logits over the class vocabulary (19 classes for SemanticKITTI, 16 for nuScenes). No KNN or CRF post-processing step.

## Inputs and Outputs

| Item | Detail |
|------|--------|
| Input | Single LiDAR scan as `(x, y, z, intensity)` per point |
| Projection | Spherical range image `[H × W × 5]`; channels: x, y, z, intensity, range |
| SemanticKITTI resolution | 64 × 512 |
| nuScenes resolution | 32 × 1920 (Fast-FRNet: 32 × 360) |
| Output (raw) | Per-point class logits (frustum-fused, full 3D resolution) |
| Output (final) | Per-point semantic label — no post-processing stage required |
| Sensor assumption | Single spinning LiDAR, single ego-centric origin, per-scan |
| Model size | 10.0 M parameters (standard); 7.5 M (Fast-FRNet) |

## Architecture

### Overall Structure

A 2D encoder backbone with iterative frustum-point fusion branches at each scale:

1. **Range-image input:** 5-channel spherical projection (x, y, z, intensity, range) at H × W.
2. **Frustum Feature Encoder (FFE):** Groups points by (u, v); per-point MLP on `[P; P − P̃]`; max-pool to frustum features. Runs once before the backbone.
3. **2D convolutional backbone (CENet-style, ResNet34 encoder):** Dense 2D convolutions with ASPP-style context aggregation and simple interpolation decoder. Standard-FRNet uses the full ResNet34; Fast-FRNet uses ResNet18 at 32 × 360.
4. **Frustum-Point (FP) Fusion Modules:** One per backbone stage. Each module performs a Frustum-to-Point scatter pass followed by a Point-to-Frustum attentive aggregation. Multi-scale: every encoder stage's features participate.
5. **Head Fusion Module:** Concatenates multi-scale frustum features, fuses with per-point features via skip to `F_p^0`, produces per-point logits.

**Variants:**

| Variant | Backbone | Resolution | Params | FPS | SemanticKITTI mIoU |
|---------|----------|------------|--------|-----|--------------------|
| FRNet | ResNet34 (CENet-style) | 64 × 512 | 10.0 M | 29.1 | 73.3% |
| Fast-FRNet | ResNet18 | 32 × 360 | 7.5 M | 33.8 | 72.5% |

FPS measured on a single GeForce RTX 2080Ti. Training uses 4 GPUs (4 samples per GPU). Input channels: 5 (FRNet) vs. 6 (RangeFormer adds an existence flag). No Swin attention, no shifted-window mechanism, no patch embedding — the dominant compute stays in dense 2D convolutions.

**Parameter comparison:**

| Method | Params | SemanticKITTI mIoU | FPS |
|--------|--------|--------------------|-----|
| RangeNet++ | ~50 M | 52.2% | ~15 |
| SalsaNext | 6.7 M | 59.5% | 42.3 |
| CENet | 6.8 M | 64.7% | 33.4 |
| RangeFormer | 24.3 M | 73.3% | 6.2 |
| **FRNet** | **10.0 M** | **73.3%** | **29.1** |
| Fast-FRNet | 7.5 M | 72.5% | 33.8 |

## Complexity and Compute

| Metric | FRNet | Fast-FRNet | RangeFormer | SalsaNext |
|--------|-------|------------|-------------|-----------|
| Parameters | 10.0 M | 7.5 M | 24.3 M | 6.7 M |
| SemanticKITTI mIoU | 73.3% | 72.5% | 73.3% | 59.5% |
| FPS (RTX 2080Ti) | 29.1 | 33.8 | 6.2 | 42.3 |
| Latency (approx.) | ~34 ms | ~30 ms | ~160 ms | ~12 ms |

FPS figures are for network forward pass only, measured on RTX 2080Ti. Full pipeline latency (including pre-processing, scan projection, and any post-processing) is higher. The HARP-NeXt comparison (RTX 4090) reports FRNet full-pipeline latency at ~394 ms end-to-end on nuScenes and KITTI, versus HARP-NeXt at 10–120 ms — the 29.1 FPS figure is a network-only benchmark; confirm full-stack latency for deployment planning.

**HARP-NeXt (IROS 2025, arXiv:2510.06876):** Follow-up that replaces FRNet's ResNet34 backbone with lightweight Conv-SE-NeXt (depth-wise separable) blocks and removes per-stage feature recomputation. Trades approximately 1 pp SemanticKITTI mIoU for 6–12× additional speedup on the same hardware — the latency-critical deployment path beyond FRNet.

## Training Recipe

| Hyperparameter | SemanticKITTI / ScribbleKITTI | nuScenes / SemanticPOSS |
|----------------|-------------------------------|--------------------------|
| Optimizer | AdamW | AdamW |
| Base LR | 0.01 | 0.01 |
| LR schedule | OneCycleLR | OneCycleLR |
| Epochs | 50 | 80 |
| Batch size | 4 per GPU × 4 GPUs | 4 per GPU × 4 GPUs |

**Loss function:**

```
L = L_point + lambda * L_frustum
```

- `L_point` — weighted cross-entropy on per-point predictions.
- `L_frustum` — cross-entropy + Lovász-Softmax + boundary loss applied to frustum-level pseudo-labels. Frustum pseudo-labels are generated by frequency-based majority voting: the plurality class among a frustum's points becomes the frustum label. Ambiguous (tied-vote) frustums are marked ignore and excluded from `L_frustum`.
- `lambda` is a tunable weight; the paper confirms it helps but does not disclose the exact value.

**Augmentations:**

- **FrustumMix:** Swaps entire frustum regions (along inclination or azimuth axes) between two point clouds, preserving the internal 3D geometry of each swapped block. Geometrically coherent analogue of CutMix for range images. Outperforms LaserMix on ScribbleKITTI weak-supervision by 5–10% across data regimes.
- **RangeInterpolation:** Fills empty range-image pixels by averaging coordinates of neighboring valid pixels in an m × n window. Label: if both neighbors share the same class, the interpolated point inherits it; otherwise `ignore_label`. Improves validation mIoU by ~0.5–0.6% and reduces sparsity errors at scan edges.
- Standard: random horizontal flip, random rotation, random scale.

## Benchmark Results

### SemanticKITTI Test Set — 19 Classes

| Method | Family | mIoU (%) | FPS | Params |
|--------|--------|----------|-----|--------|
| RangeNet++ (IROS 2019) | Range-Img CNN | 52.2 | ~15 | ~50 M |
| SalsaNext (RAL 2020) | Range-Img CNN | 59.5 | 42.3 | 6.7 M |
| CENet (ICME 2022) | Range-Img CNN | 64.7 | 33.4 | 6.8 M |
| RangeViT (CVPR 2023) | Range-Img ViT | 64.0 | 10.0 | 23.7 M |
| RangeFormer (ICCV 2023) | Range-Img Transformer | 73.3 | 6.2 | 24.3 M |
| **FRNet (TIP 2025)** | **Range-Img Frustum** | **73.3** | **29.1** | **10.0 M** |
| Fast-FRNet | Range-Img Frustum | 72.5 | 33.8 | 7.5 M |
| SphereFormer (CVPR 2023) | Voxel | 74.8 | 4.9 | — |
| UniSeg (2023) | Multi-View Fusion | 75.2 | 6.9 | — |

*FPS measured on RTX 2080Ti for range-image methods. Hardware parity should be confirmed before comparing range-image to voxel method FPS.*

### nuScenes-lidarseg Test Set

| Method | mIoU (%) |
|--------|----------|
| Cylinder3D | 77.9 |
| RangeFormer | 80.1 |
| Fast-FRNet | 82.1 |
| **FRNet** | **82.5** |

FRNet nuScenes validation: 79.0% mIoU; Fast-FRNet: 78.8%. FRNet outperforms RangeFormer (+2.4 pp) and Cylinder3D (+4.6 pp) on nuScenes at publication.

### ScribbleKITTI (Weak Supervision — 8.06% Labeled Points)

| Method | mIoU (%) | mAcc (%) |
|--------|----------|----------|
| **FRNet** | **63.1** | **72.3** |

The weak-supervision gap versus full supervision (~10 pp) is competitive for the range-image family. FrustumMix is the primary driver; it is shown to outperform LaserMix by 5–10 pp across data-regime ablations.

### Robustness — Robo3D Benchmark (SemanticKITTI-C / nuScenes-C)

FRNet achieves **96.8% mean corruption error (mCE)** versus 103.4% for competing methods across eight corruption types: fog, wet ground, snow, motion blur, beam missing, crosstalk, incomplete echo, cross-sensor. The frustum-level aggregation provides implicit robustness to beam-missing and incomplete-echo corruptions by averaging features over multiple points per frustum.

### Ablation — SemanticKITTI Validation Set

| Configuration | mIoU (%) |
|---------------|----------|
| FFE only (baseline) | 62.7 |
| + FP Fusion | 64.3 (+1.6) |
| + Frustum supervision (L_frustum) | 66.2 (+1.9) |
| + Fusion Head | 67.0 (+0.8) |
| + RangeInterpolation | 67.6 (+0.6) |
| + TTA (test-time augmentation) | 68.7 (+1.1) |

Full test set with TTA reaches 73.3%.

## Variants and Lineage

The range-image family traces a direct lineage from projection-CNN to transformer to frustum-hybrid:

```
RangeNet++ (IROS 2019, CNN DarkNet53, 52.2%, ~15 Hz — founded projection family)
  -> SalsaNext (RAL 2020, residual dilated CNN, 59.5%, 42 Hz — real-time branch)
    -> CENet (ICME 2022, ResNet34 + ASPP, 64.7%, 33 Hz — CNN accuracy peak)
      -> RangeViT (CVPR 2023, Valeo AI, ViT backbone, 64.0%, ~10 Hz)
      -> RangeFormer (ICCV 2023, Swin transformer + full-cycle pipeline, 73.3%, 6-27 Hz)
        -> FRNet (TIP 2025, frustum representation + iterative 3D/2D fusion, 73.3%, 29 Hz)  <- this page
          -> HARP-NeXt (IROS 2025, Conv-SE-NeXt backbone, ~72% mIoU, ~100+ Hz)
```

**How FRNet differs from pure range-image methods:** Range-image methods project each point to one pixel and either discard duplicates or recover them with KNN post-processing. FRNet keeps all points and fuses their 3D features back with the 2D backbone at every scale. The 2D grid acts as an index into 3D geometry rather than a lossy projection.

**How FRNet differs from voxel/point-cloud methods:** Voxel methods (Cylinder3D, SphereFormer) operate in 3D space throughout — they scale with O(N · resolution) memory and compute. FRNet's backbone operates on a compact H × W range image (dense 2D convolutions), then branches into per-point 3D operations only within small frustum groups (1–3 points each). The dominant compute stays 2D; 3D accuracy is recovered at marginal cost.

**HARP-NeXt (IROS 2025):** Builds on FRNet's fusion concept with lightweight Conv-SE-NeXt (depth-wise separable) blocks replacing ResNet34 and removes per-stage feature recomputation. On RTX 4090: FRNet inference 82–86 ms, HARP-NeXt 7–13 ms. Trades ~1 pp mIoU for 6–12× additional speedup — the natural successor for latency-critical deployments.

## Strengths

- **Accuracy/speed Pareto-optimal** in the range-image family as of TIP 2025: matches the best accuracy (73.3% mIoU) at near-CENet throughput (~29 FPS).
- **No post-processing required:** KNN/CRF post-processing eliminated; the frustum fusion internalizes the collision-resolution that RangeNet++ offloaded to a separate GPU kNN step.
- **Parameter-efficient:** 10.0 M parameters — 59% fewer than RangeFormer (24.3 M), comparable to CENet (6.8 M) despite substantially higher accuracy.
- **Weak-supervision friendly:** FrustumMix and frustum-level pseudo-labels are effective under sparse scribble annotations (ScribbleKITTI 63.1%); supports low-annotation domain adaptation.
- **Robustness:** Best-in-class on Robo3D corruptions (96.8% mCE); frustum-level aggregation implicitly tolerates beam-missing and echo corruption by averaging over multiple points per bin.
- **nuScenes SOTA at publication:** 82.5% test mIoU, outperforming Cylinder3D (77.9%) and RangeFormer (80.1%).
- **Open-source:** Trained models, configs, and training code publicly released.

## Failure Modes

- **Single-scan, single-origin architecture:** The frustum decomposition is anchored to one sensor viewpoint. There is no mechanism for multi-origin aggregation — see Aggregated-Map Suitability.
- **Thin structures and co-angular objects:** The frustum grouping aggregates features over depth; two objects at the same angular direction but different ranges (e.g., a pedestrian in front of a pole) land in the same frustum and may be confused. This is the main per-class failure pathway for thin vertical objects (poles, cyclists in crowds).
- **Low-density open areas:** Empty tarmac, open fields, and sparse scan edges benefit from RangeInterpolation, but inter-scan gaps at scan boundaries remain. FPS numbers assume full-density 64-beam scans; 32-beam or lower-resolution sensors reduce both coverage and accuracy.
- **Sensor generalization:** Benchmarked on Velodyne HDL-64E (SemanticKITTI) and 32-beam nuScenes. Transfer to other beam counts (128-beam Hesai, 16-beam Ouster) requires retuning of H × W resolution and fup/fdown parameters; naïve transfer degrades.
- **Full-pipeline latency gap:** The 29.1 FPS figure is network-forward-pass only. HARP-NeXt comparison data (RTX 4090) puts FRNet full-pipeline latency at ~394 ms end-to-end on nuScenes — closer to 2–3 Hz for the full stack, adequate for many systems but not ultra-low-latency closed-loop control.
- **Frustum pseudo-label noise:** The majority-vote scheme for frustum-level supervision mislabels boundary frustums where multiple classes co-occur (e.g., vehicle roof adjacent to building). Affects `L_frustum` quality on cluttered scenes.
- **No free-space or occupancy output:** Unlike occupancy-grid methods, FRNet outputs nothing for unobserved voxels; depth completion is not part of the model.

## Domain Fit

| Domain | Fit | Note |
|--------|-----|------|
| Road AV (on-vehicle, single-scan) | strong | Real-time at 29.1 FPS, no post-processing, 73.3% mIoU. The production deployment choice at this accuracy tier. |
| Road AV (offline / aggregated maps) | not suitable | Architecturally mismatched — single-origin frustum assumption degenerates for multi-viewpoint data. |
| Airside AV (on-vehicle, real-time) | conditional | Fits the 100 ms Orin compute cycle at 29 FPS; robustness to beam-missing (Robo3D 96.8% mCE) is relevant to jet-wash and rain. Domain adaptation (~500–1,000 labeled scans) required for airside classes (aircraft, jetways, markings, pavement, GSE). |
| Airside AV (aggregated / static map) | not suitable | No single sensor origin; frustum projection is incoherent over multi-viewpoint aggregated apron/taxiway maps. |
| Warehouse / port / logistics-yard | conditional | Effective for single-scan ego-centric inference; indoor occlusion amplifies co-angular confusion; multi-viewpoint fused maps require a separate method. |
| Mining / construction / agriculture | limited | Irregular-beam and solid-state sensors are common; rough terrain and dense vegetation amplify boundary and depth-collision failures; sensor generalization requires retraining. |
| Per-scan pre-labeling front-end (map pipeline) | strong | At 29 FPS, efficient offline per-scan pre-labeler; labeled point clouds feed downstream voxel-based map integrators. The correct role in an aggregated-map workflow. |
| Accuracy benchmark / research baseline | strong | Well-documented per-class results, clean ablations, public code; the natural deployment-accuracy ceiling reference for the range-image family. |

## Aggregated-Map Suitability

**For direct offline map segmentation: architecturally unsuitable.**

The frustum representation is geometrically defined by a single sensor origin. An aggregated multi-scan map contains points from dozens to thousands of sensor poses. There is no sensible frustum grid for such a map:

- The H × W pixel grid is specific to one angular vantage — applying it to an aggregated cloud would require an arbitrary reference origin that loses the geometric meaning of azimuth and elevation bins.
- The FP Fusion module's scatter and gather operations assume a single coherent (u, v) grid; points from other viewpoints would collide incoherently or require re-projection that discards multi-scan coverage.
- Range values (`r`) for aggregated-map points no longer measure distance from the original sensor, breaking the range-image input channel.

This is not a domain-adaptation gap — it is a format incompatibility at the architectural level.

**The correct role: per-scan real-time front-end.**

FRNet fits naturally as the on-vehicle real-time lane of a hybrid segmentation pipeline:

1. Vehicle runs FRNet at ~29 FPS per incoming scan (or Fast-FRNet at ~34 FPS for tighter latency budgets).
2. Per-scan predictions (with confidence scores) are projected back to 3D points.
3. Labeled point clouds are forwarded to a separate map integrator — a voxel-based aggregator using Bayesian occupancy fusion or feature averaging — that accumulates labels across scans into the persistent map.
4. The map integrator handles multi-viewpoint consistency; FRNet handles single-scan classification quality.

This mirrors the established pattern in the SemanticKITTI online evaluation track: the segmentation network runs per-scan; aggregation and smoothing happen downstream.

**Practical airside AV relevance:** Airside environments (taxiways, aprons, stands) are large, relatively open, and contain infrastructure classes absent from SemanticKITTI and nuScenes. Domain adaptation via fine-tuning on ~500–1,000 labeled airside scans is required. At 29.1 FPS on a 2080Ti, FRNet comfortably fits a 100 ms vehicle compute cycle (Jetson Orin maximum-power mode). The Robo3D robustness result (beam-missing, fog, wet ground) is directly relevant to airside conditions including rain, mist, and jet-wash-induced point loss.

## Implementation Notes

- Do not apply FRNet to aggregated multi-viewpoint maps — the frustum origin assumption is the deciding architectural constraint (see Aggregated-Map Suitability).
- For **on-vehicle real-time deployment at 73.3% accuracy**, FRNet is the production baseline in the range-image family. Prefer it over RangeFormer (slower, larger, no confirmed public code) and over CENet (8.6 pp lower accuracy at similar speed).
- Use **Fast-FRNet** (7.5 M params, 33.8 FPS, 72.5% mIoU) when latency is tighter or hardware is more constrained than a 2080Ti equivalent.
- For **ultra-low-latency** requirements beyond ~30 FPS network throughput, evaluate HARP-NeXt (arXiv:2510.06876) which achieves 6–12× speedup at ~1 pp accuracy cost.
- Include both **FrustumMix and RangeInterpolation** during training — ablations show FrustumMix is the larger driver for ScribbleKITTI weak supervision; RangeInterpolation adds ~0.5–0.6 pp mIoU on validation at minimal cost.
- Apply the full **loss combination** (`L_point` WCE + `L_frustum` [cross-entropy + Lovász + boundary]): the Lovász-Softmax term directly optimizes mIoU and the frustum supervision contributes +1.9 pp per ablation.
- The weak-supervision result (63.1% at 8% labels via ScribbleKITTI) supports domain adaptation via partial annotation for new deployment domains; the 500–1,000 frame fine-tuning threshold from the broader knowledge base applies here.
- Official implementation: AdamW + OneCycleLR; 50 epochs on SemanticKITTI with 4× GPU parallelism. Single-GPU training is feasible via gradient accumulation or batch-size reduction, at modest accuracy cost.
- Confirm full-pipeline latency (including scan projection and pre-processing) before citing 29.1 FPS in a deployment context; network-only throughput and system throughput diverge on constrained hardware.

## Sources

- **arXiv preprint (v2):** https://arxiv.org/abs/2312.04484
- **arXiv HTML full text (v2):** https://arxiv.org/html/2312.04484v2
- **IEEE TIP 2025 (PubMed indexed):** https://pubmed.ncbi.nlm.nih.gov/40095829/
- **Official GitHub:** https://github.com/Xiangxu-0103/FRNet
- **Project page:** https://xiangxu-0103.github.io/FRNet
- **HuggingFace paper page:** https://huggingface.co/papers/2312.04484
- **HARP-NeXt (IROS 2025 follow-up):** https://arxiv.org/abs/2510.06876
- **RangeFormer (ICCV 2023):** https://openaccess.thecvf.com/content/ICCV2023/papers/Kong_Rethinking_Range_View_Representation_for_LiDAR_Segmentation_ICCV_2023_paper.pdf
- **SalsaNext (arXiv:2003.03653):** https://arxiv.org/pdf/2003.03653
- **Lovász-Softmax loss:** https://arxiv.org/abs/1705.08790 (Berman et al., CVPR 2018)
- Related overview: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline (§7 model families, §7.8 training-architecture comparison)
- Related overview: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation (range-image methods §3.3)
- Related method: `./salsanext.md` — the real-time CNN range-image sibling
- Related method: `./rangeformer.md` — the accuracy-leading transformer range-image sibling
- Related method: `./waffleiron.md` — the other projection-based method
