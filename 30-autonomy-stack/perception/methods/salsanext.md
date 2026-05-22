# SalsaNext

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "classic-baseline"
  maturity: "pilot-proven"
  tags: ["perception", "lidar", "segmentation", "road-av"]
  reason: "SalsaNext is the canonical real-time range-image LiDAR semantic segmenter — the fast, embedded-friendly projection baseline."
method-priority:end -->

## What It Is

- SalsaNext is a real-time **range-image LiDAR semantic segmentation** network introduced in "SalsaNext: Fast, Uncertainty-Aware Semantic Segmentation of LiDAR Point Clouds for Autonomous Driving" (Cortinhal, Tzelepi, Aksoy — ISVC 2020, Springer LNCS 12510).
- It operates on the **spherical range image** — a compact 2D projection of a full spinning-LiDAR scan (64 × 2048 pixels, 5 channels) — allowing dense 2D convolutional inference rather than sparse 3D operations.
- Its defining contributions over the predecessor SalsaNet are: residual dilated encoder blocks, pixel-shuffle upsampling, a context module, central dropout regularization, and a dual **uncertainty estimation** output (aleatoric + epistemic) via Assumed Density Filtering and Monte Carlo dropout.
- SalsaNext is the **canonical projection-family baseline** on SemanticKITTI: 59.5% test mIoU at approximately 24 Hz GPU, 6.73 M parameters, 125.68 GFLOPs.
- See also: `cylinder3d.md` for the sparse-voxel single-scan alternative; `waffleiron.md` for the other projection-based method using dense 2D projection of point features rather than a spherical range image.

## Core Technical Idea

A spinning automotive LiDAR (e.g., Velodyne HDL-64E) emits 64 vertical beams in a 360° horizontal sweep, producing a structured point cloud whose azimuth and elevation angles are discretized by the sensor geometry. This regularity makes a 2D projection possible without loss of structure: each point has a unique (azimuth, elevation) pair that maps to a pixel in a (width × height) image.

SalsaNext exploits this regularity to convert the 3D segmentation problem into a dense 2D CNN problem. Dense 2D convolution on GPU is the most optimized compute primitive in deep learning — no KD-tree neighbor lookup, no sparse voxel indexing, no graph construction. A 64 × 2048 × 5 tensor is processed exactly as a standard 2D image. This is why SalsaNext achieves approximately 24 Hz with only 6.73 M parameters. By comparison, voxel methods (Cylinder3D) typically run at 6–10 Hz on similar hardware; point methods (PointNet++, RandLA-Net) at 5–15 Hz.

The trade-off is projection artifacts — occlusion, discretization error, and boundary bleeding — mitigated here by dilated convolutions (wider receptive field) and kNN re-projection post-processing. The design thesis: accept the projection approximation and spend the saved compute on uncertainty estimation that quantifies where the approximation fails.

## Operator Mechanics

### Spherical Range-Image Projection

For a point `p = (x, y, z)` with range `r = sqrt(x^2 + y^2 + z^2)`, the pixel coordinates are:

```
u = floor( 0.5 * [1 - atan2(y, x) / pi] * w )
v = floor( [1 - (asin(z / r) + f_down) / f] * h )
```

Where:
- `u` is the column index (azimuth); `v` is the row index (elevation)
- `h, w` = image height and width (for HDL-64E: `h = 64`, `w = 2048`)
- `f = |f_down| + |f_up|` = total vertical field of view (e.g., 26.8° for HDL-64E)
- `f_down` = downward tilt angle (e.g., −24.9° for HDL-64E)

The resulting image has **5 channels per pixel**: `(x, y, z, intensity, range r)`. The full tensor is `[h × w × 5]`, fed to the 2D CNN as a standard multi-channel image.

When multiple points map to the same pixel `(u, v)` — because multiple 3D points lie along the same azimuth-elevation ray at different depths — the standard implementation retains only the nearest (minimum `r`) and discards the rest. This many-to-one collision is the primary source of the occlusion artifact (see Failure Modes).

### kNN Re-Projection (Post-Processing)

CNN inference labels each 2D pixel. Mapping labels back to 3D points:

1. For each input 3D point `p`, locate its projected pixel `(u, v)`.
2. Define a search window `W` around `(u, v)` in image space.
3. Find `k` nearest neighbors of `p` in 3D Euclidean space (using range distances from the image as a proxy) from the pool of points in `W`.
4. Assign the majority label from the `k` neighbors to `p`.

This corrects two artifact classes: discretization error (points at similar angles that competed for a pixel are separated by 3D-distance voting) and boundary bleeding (CNN label smoothing across depth discontinuities in 2D is partially reversed by 3D proximity). The kNN step adds approximately 2.65 ms to total inference time — negligible relative to CNN time. The specific `k` value follows the RangeNet++ post-processing convention; the SalsaNext paper does not state it explicitly.

## Inputs and Outputs

| Item | Detail |
|------|--------|
| Input | Single LiDAR scan as `(x, y, z, intensity)` per point |
| Projection | Spherical range image `[h × w × 5]`; for HDL-64E: `64 × 2048 × 5` |
| Output (raw) | Per-pixel class logits, then softmax → per-pixel label + probability |
| Output (post-kNN) | Per-point semantic label (3D), aligned to original point cloud |
| Optional output | Per-point aleatoric uncertainty `sigma_A` and epistemic uncertainty `sigma_epistemic` |
| Sensor assumption | Single spinning LiDAR, single ego-centric origin, per-scan |

## Architecture

### Overall Structure

An encoder-decoder CNN operating entirely on the 2D range image:

1. **Context module:** A stack of 1×1 and 3×3 convolutions applied to the input before the encoder, providing early global context aggregation across the full image.
2. **Residual dilated encoder:** Multiple blocks of dilated convolutions with dilation rates producing effective receptive fields of 3, 5, and 7. Within each block, outputs are concatenated, reduced with a 1×1 convolution, then added via a residual connection. All layers use Leaky-ReLU + Batch Normalization. Spatial downsampling between stages uses **average pooling** (replacing stride convolution) to reduce information loss during compression.
3. **Central dropout:** Spatial dropout inserted after Batch Normalization and before the skip connection, enabling the Monte Carlo dropout uncertainty estimation at inference.
4. **Pixel-shuffle decoder:** Replaces transposed convolution. Pixel-shuffle rearranges channels into spatial extent (sub-pixel convolution / depth-to-space), avoiding checkerboard artifacts common in transposed conv. Decoder stages include dilated convolutions and skip connections from the encoder.
5. **Classification head:** 1×1 convolution mapping to class logits → softmax.

The five changes from SalsaNet to SalsaNext in summary:

| Component | SalsaNet | SalsaNext |
|-----------|----------|-----------|
| Downsampling | Stride convolution | Average pooling |
| Encoder blocks | Plain ResNet | Residual dilated conv (rates 3, 5, 7) |
| Input context | None | Context module |
| Upsampling | Transposed conv | Pixel-shuffle |
| Regularization | Standard dropout | Central dropout (after BN, before skip) |

**Parameters:** 6.73 M. **FLOPs:** 125.68 GFLOPs. Encoder-decoder with 16:1 compression at the bottleneck.

### Uncertainty Estimation

SalsaNext outputs both **aleatoric** and **epistemic** uncertainty per point — uncommon in segmentation methods and practically useful for flagging predictions under sensor noise or distribution shift.

**Aleatoric uncertainty** (irreducible sensor noise): The known LiDAR sensor noise distribution `N(x, v)` is propagated through the network using **Assumed Density Filtering (ADF)**. Each activation is modeled as a Gaussian distribution. The network outputs a per-pixel mean prediction `mu` and per-pixel aleatoric uncertainty `sigma_A`, quantifying noise from the sensor itself.

**Epistemic uncertainty** (model uncertainty): Approximated via **Monte Carlo (MC) dropout** — dropout masks remain active at inference time. The network is run `n` times (the GitHub implementation defaults to approximately 30 iterations). Epistemic uncertainty per pixel:

```
sigma_epistemic = (1/n) * sum_{i=1}^{n} (y_i - y_hat)^2
```

where `y_hat` is the mean prediction over `n` trials.

**Dropout rate optimization:** The optimal dropout rate `p*` is found via grid search on `[0, 1]` post-training, minimizing the negative log-likelihood over validation data:

```
p* = argmin_{p_hat} sum_{d in D} [0.5 * log(sigma_tot^d)
     + (y^d - y_pred^d(p_hat))^2 / (2 * sigma_tot^d)]
```

**Total uncertainty = `sigma_A + sigma_epistemic`.**

Note: MC-dropout uncertainty mode runs approximately 30 forward passes rather than one — significant inference overhead. For standard (non-uncertainty) inference, one forward pass at approximately 24 Hz.

## Complexity and Compute

| Metric | Value |
|--------|-------|
| Parameters | 6.73 M |
| FLOPs | 125.68 GFLOPs |
| GPU throughput (standard inference) | ~24 Hz |
| GPU throughput (MC-dropout, ~30 passes) | substantially reduced |
| Jetson AGX Orin | near 10 Hz threshold (approximate; pre-processing 35–83% of runtime) |
| FPGA (Xilinx Kria KV260, INT8) | demonstrated in 2025 (double-head variant) |

The pre-processing bottleneck is a critical embedded deployment consideration: spherical projection (typically implemented in C++/Python) constitutes 35–83% of total runtime on Jetson AGX Orin depending on implementation quality (source: arXiv:2410.08365). Optimizing the projection step is as important as model architecture for embedded throughput.

## Training Recipe

| Hyperparameter | Value |
|----------------|-------|
| Optimizer | SGD |
| Initial learning rate | 0.01 |
| LR decay | 0.01 per epoch |
| Momentum | 0.9 |
| L2 weight decay | 0.0001 |
| Batch size | 24 |
| Spatial dropout probability | 0.2 |

**Loss function:**

```
L = L_wce + L_ls
```

- `L_wce` — weighted cross-entropy with class weights `w_i = 1 / sqrt(f_i)`, where `f_i` is class frequency. Down-weights frequent classes (road, vegetation); up-weights rare classes (person, motorcyclist).
- `L_ls` — Lovász-Softmax: a differentiable surrogate for the Jaccard index (mIoU), directly optimizing the evaluation metric. This is the single largest ablation gain: +6.2 mIoU points (56.6% → 59.5% with kNN on the final ablation configuration).

**Data augmentation** (each applied independently at 0.5 probability):
- Random rotation and translation of the point cloud
- Random flip along the Y-axis
- Random point dropping (simulates sensor degradation / adverse weather)

**Training split:** SemanticKITTI sequences 00–10 (~21,000 scans). Validation: sequence 08. Test: sequences 11–21.

## Benchmark Results

### Ablation — SemanticKITTI Val Set (Sequence 08)

Cumulative contribution of each SalsaNext design choice (mIoU without / with kNN):

| Configuration | w/o kNN | + kNN | Params | FLOPs |
|---------------|---------|-------|--------|-------|
| SalsaNet baseline | 43.5% | 44.8% | 6.58 M | 51.60 G |
| + Context module | 44.7% | 46.0% | 6.64 M | 69.20 G |
| + Central dropout | 44.6% | 46.3% | 6.64 M | 69.20 G |
| + Average pooling | 47.7% | 49.9% | 5.85 M | 66.78 G |
| + Dilated convolution | 48.2% | 50.4% | 9.25 M | 161.60 G |
| + Pixel-shuffle | 50.4% | 53.0% | 6.73 M | 125.68 G |
| + Lovász-Softmax | 56.6% | **59.5%** | 6.73 M | 125.68 G |

### Range-Image Family — SemanticKITTI Test Set Comparison

| Method | Venue / Year | mIoU (test) | FPS (GPU) | Params | Notes |
|--------|-------------|-------------|-----------|--------|-------|
| RangeNet21++ | IROS 2019 | 47.4% | ~20 Hz | ~25 M | DarkNet21 backbone |
| RangeNet53++ | IROS 2019 | 52.2% | ~12 Hz | ~50 M | DarkNet53; over-parameterized |
| SalsaNet | 2020 | 45.4% | ~26 Hz | 6.58 M | 19-class retrained |
| SalsaNext | ISVC 2020 | **59.5%** | ~24 Hz | 6.73 M | + kNN + Lovász-Softmax |
| KPRNet | arXiv 2020 | 63.1% | — | — | Keypoint post-processing |
| CENet | ICME 2022 | ~64.7% | — | — | Larger kernels, aux heads; community result 67.6% (different training config) |
| RangeViT | CVPR 2023 | 64.0% | — | — | ViT-S/B + conv stem/decoder; Cityscapes pre-train |
| RangeFormer | ICCV 2023 | 73.3% | ~6 Hz | 24.3 M | Full-cycle transformer; PQ 64.2% |
| FRNet | arXiv 2023 | 73.3% | **29.1 Hz** | 10.0 M | Frustum-range; no kNN post-proc |
| Fast-FRNet | arXiv 2023 | 72.5% | **33.8 Hz** | 7.5 M | Lighter FRNet variant |

FPS figures measured on GPU (RTX/V100-class), single forward pass (no MC-dropout). RangeViT FPS not published; estimated 5–15 Hz given ViT compute cost. CENet published mIoU is ~64.7% (ICME 2022 paper); 67.6% is a community extended result using progressive resolution training — treat separately.

### SalsaNext SemanticKITTI Test — Per-Class IoU (%)

| car | bike | moto | truck | other-veh | person | bicyclist | motorcyclist | road | parking | sidewalk | other-gnd | building | fence | veg | trunk | terrain | pole | sign | **mIoU** |
|-----|------|------|-------|-----------|--------|-----------|--------------|------|---------|----------|-----------|----------|-------|-----|-------|---------|------|------|---------|
| 91.9 | 48.3 | 38.6 | 38.9 | 31.9 | 60.2 | 59.0 | 19.4 | 91.7 | 63.7 | 75.8 | 29.1 | 90.2 | 64.2 | 81.8 | 63.6 | 66.5 | 54.3 | 62.1 | **59.5** |

Lowest per-class scores on motorcyclist (19.4%) and other-vehicle (31.9%) — thin, rare objects most vulnerable to boundary bleeding and discretization error.

## Variants and Lineage

**SalsaNet (Aksoy, Baci, Cavdar — arXiv:1909.08291, September 2019):** The predecessor. Encodes road and vehicle only (two classes) using a ResNet encoder-decoder. Explores both BEV and spherical projections. Parameters: 6.58 M; FLOPs: 51.60 G; ~26 Hz GPU; 45.4% mIoU when retrained on 19-class SemanticKITTI. SalsaNext's architectural changes are defined relative to SalsaNet. GitLab: https://gitlab.com/aksoyeren/salsanet

**RangeNet++ (Milioto et al., IROS 2019):** The founding projection segmenter on SemanticKITTI. DarkNet (21- or 53-layer) backbone on 64 × 2048 range image with 5 channels. Introduces GPU-accelerated kNN post-processing that became standard for the family. RangeNet53++: 52.2% mIoU, ~12 Hz, ~50 M parameters — over-parameterized. GitHub: https://github.com/PRBonn/lidar-bonnetal

**CENet (Cheng et al., ICME 2022):** Replaces MLP layers with larger-kernel convolutions, selects activation functions (hardswish/mish over ReLU), adds multiple auxiliary segmentation heads with intermediate supervision, and uses progressive resolution training (64×512 → 64×1024 → 64×2048). Code framework derived from SalsaNext. ~64.7% mIoU. Faster and more accurate than SalsaNext; the natural next-step upgrade.

**RangeViT (Ando et al., CVPR 2023):** First ViT-based range-image segmenter. ViT-S or ViT-B encoder with a convolutional stem and convolutional decoder. Leverages ImageNet/Cityscapes pre-training. 64.0% mIoU (SemanticKITTI), 75.2% mIoU (nuScenes val). Slower than CNN methods.

**RangeFormer (Kong et al., ICCV 2023):** Full-cycle transformer framework with full-resolution attention, Scalable Training from Range view (STR) augmentation, and range-view semantic coherence loss. First range-view method to surpass point-, voxel-, and fusion-based methods on SemanticKITTI and nuScenes simultaneously. 73.3% mIoU, 64.2% PQ. Trade-off: ~6 Hz GPU — too slow for current embedded real-time.

**FRNet (Xu et al., arXiv 2023):** Addresses projection artifacts at the architecture level — Frustum Feature Encoder (per-point MLP before projection), Frustum-Point Fusion (bidirectional 2D/3D feature fusion), Head Fusion (multi-level integration), and Range-Interpolation for sparse pixels. Eliminates kNN post-processing. 73.3% mIoU at 29.1 Hz, 10.0 M parameters. Fast-FRNet: 72.5% at 33.8 Hz, 7.5 M. The accuracy-efficiency Pareto frontier for the projection family as of 2023.

## Strengths

- **Speed:** ~24 Hz GPU at 6.73 M parameters; near real-time on Jetson AGX Orin; FPGA-deployable at INT8. No custom 3D CUDA kernels required.
- **Memory efficiency:** Dense 2D tensors require substantially less memory than sparse 3D voxel structures.
- **Mature toolchain:** Standard 2D CNN training pipeline; fully reproducible with public code and documented hyperparameters.
- **Uncertainty output:** Per-point aleatoric + epistemic uncertainty is rare in segmentation methods and directly actionable for safety margins — flag low-confidence predictions before acting on them or fusing them into a map.
- **Lovász-Softmax training:** Directly optimizes mIoU, the evaluation metric, rather than cross-entropy as a proxy — ablation shows +6.2 mIoU points from this change alone.
- **End-to-end differentiable** (except the kNN post-processing step, which is non-differentiable).
- Established baseline with well-characterized performance; straightforward to adapt CENet improvements atop the SalsaNext codebase.

## Failure Modes

**Occlusion (many-to-one mapping):** Multiple 3D points along the same azimuth-elevation ray project to the same pixel. Only the nearest point is retained; far points are silently discarded. The CNN never sees their geometric context. kNN post-processing can recover some labels for discarded points by voting from visible neighbors, but this is a heuristic, not a reconstruction. In airside or dense-infrastructure scenes — a parked jetbridge partially occluded by a terminal wall, an aircraft nose behind a ground vehicle — many points of interest are structurally invisible to the network.

**Discretization error:** Spherical projection maps continuous 3D coordinates to discrete integer pixel indices. Points near pixel boundaries are quantized to the wrong bin. Angular resolution for a 64 × 2048 image is approximately 0.4° horizontal × 0.4° vertical; points within this angular window compete for the same pixel. The error is proportional to 1/resolution.

**Boundary bleeding (label shadow effect):** CNNs interpolate across all pixels in the receptive field regardless of 3D depth discontinuities. At the boundary between a near object (e.g., a person at 5 m) and a far background (building at 20 m), adjacent 2D pixels represent geometrically discontinuous 3D regions. CNN predictions smear across this boundary — "person" labels appear on background pixels, or vice versa. kNN post-processing mitigates this by using 3D Euclidean distances, but the correction is imperfect for thin structures (motorcyclist: 19.4% IoU).

**Pre-processing bottleneck on embedded hardware:** Spherical projection constitutes 35–83% of total runtime on Jetson AGX Orin (approximate, source arXiv:2410.08365). A fast inference model with a slow projection step loses the speed advantage.

**Sparse distant regions:** At far range (>50 m), points are sparse and pixels are often empty. CNN inference over empty pixels degrades performance. FRNet's Range-Interpolation addresses this; SalsaNext does not.

**Rain/fog/dust:** Atmospheric scatter produces false near-range returns. The nearest-point-keeper rule retains these noise returns and discards valid background points, corrupting the range image.

**High-speed motion distortion:** At vehicle speeds above ~50 km/h, the 360° sweep is not contemporaneous — points from the scan start and end are offset by vehicle translation. This introduces geometric distortion that the spherical projection assumes away.

**Sensor specificity:** Image dimensions (64 × 2048 for HDL-64E) are tied to a specific LiDAR model. A 128-beam sensor or a solid-state LiDAR requires different image dimensions and retraining; solid-state sensors with non-uniform scan patterns may not project to a regular 2D grid at all.

## Domain Fit

| Domain | Fit | Note |
|--------|-----|------|
| Road AV (on-vehicle, single-scan) | strong | Designed for exactly this; the canonical projection baseline for this use case. |
| Road AV (offline / aggregated maps) | not suitable | Architecturally mismatched — see Aggregated-Map Suitability below. |
| Airside (single-scan, on-vehicle) | conditional | Viable single-scan baseline once retrained on airside data; thin-object artifacts affect aircraft geometry and GSE at range; occlusion failures matter in high-density ramp areas. |
| Airside (aggregated / static map) | not suitable | No single sensor origin; projection degenerates for multi-viewpoint data. |
| Warehouse / port / logistics-yard | conditional | Fits if sensor is a single spinning LiDAR on an ego-vehicle; weak for fused or surveyed clouds; indoor geometry and heavy occlusion increase artifact rates. |
| Mining / construction / agriculture | limited | Rough terrain and vegetation density amplify boundary-bleeding and occlusion artifacts; solid-state sensors common in these settings require retraining. |
| Per-scan pre-labeling front-end | strong | Excellent role: fast per-scan labels from SalsaNext or FRNet feed a separate 3D map integrator as a pre-labeling stage. |

## Aggregated-Map Suitability

**Range-image methods are architecturally mismatched for segmenting aggregated multi-viewpoint LiDAR maps. This is a structural incompatibility, not a solvable fine-tuning problem.**

The spherical projection is defined by a single sensor origin. The azimuth and elevation angles of every point are computed relative to the ego-vehicle position at the moment of that scan:

```
u = f(atan2(y, x))      <- azimuth from THIS sensor position
v = f(asin(z / r))      <- elevation from THIS sensor position
```

For a single scan, this is exact and lossless (up to discretization). For an **aggregated multi-scan map** — points from tens or hundreds of sensor poses — there is no single origin. Applying the projection to an aggregated map requires choosing an arbitrary reference origin, after which:

1. **The image becomes vastly sparser.** Points from 100 scan positions do not form a dense 64 × 2048 grid from any single viewpoint. Many pixels are empty; others have thousands of competing points from different passes at different distances.
2. **Image size must grow arbitrarily.** A 200 m × 200 m urban-district map cannot be represented as a 64 × 2048 spherical sweep — the elevation dimension loses meaning; azimuth density becomes non-uniform.
3. **kNN post-processing assumptions break.** kNN relies on the implicit spatial structure of the range image (nearby pixels ≈ nearby 3D points from the same scan). This is violated for multi-origin data.
4. **The pre-training distribution shifts entirely.** SalsaNext and all range-image methods are trained on single-scan data. Aggregated maps have completely different point density, overlap patterns, and occlusion structure — not a domain adaptation problem, a format incompatibility.

The correct methods for aggregated multi-viewpoint maps are voxel-based (MinkUNet, Cylinder3D with Cartesian voxels, SphereFormer), point-based (KPConv, PointTransformer), or fusion methods that operate on 3D structure directly. See `../overview/aggregated-map-semantic-segmentation.md` §7.3 for the projection family treatment and §7.8 for the model-family comparison.

**Where range-image methods ARE relevant to the overall mapping pipeline:**

- **Role 1 — Real-time on-vehicle segmenter (single-scan).** SalsaNext or FRNet run on the vehicle at 24–34 Hz, segmenting each incoming scan ego-centrically. Outputs feed dynamic object tracking, drivable-space extraction, and candidate labels for the map-building pipeline. The range-image method operates at data-collection time, not at map-segmentation time.
- **Role 2 — Short-horizon temporal accumulation (2–5 scans).** Methods like Meta-RangeSeg (arXiv:2202.13377) accumulate a small number of consecutive scans by computing range residual images. The accumulation window is short enough that the sensor origin shift is small, preserving the single-origin approximation. This improves segmentation of slow-moving or partially occluded objects. Categorically different from full map aggregation.
- **Role 3 — Per-scan pre-labeling front-end for map construction.** The aggregated map pipeline can use per-scan range-image predictions as initial semantic labels, then merge and regularize them in 3D in a separate step. Fast, high-throughput labeling per scan; a 3D map integrator handles the rest.
- **Role 4 — Uncertainty output as quality signal.** SalsaNext's per-point uncertainty estimates can flag unreliable predictions before they are fused into the map database, preventing high-uncertainty labels from corrupting map semantics.

## Implementation Notes

- Use SalsaNext (or its CENet/FRNet successors) for the **single-scan, on-vehicle** segmentation task. Do not apply to aggregated maps — the projection assumption is the deciding factor.
- Optimize the **spherical projection pre-processing** first for embedded deployment. On Jetson AGX Orin it can consume 35–83% of total runtime; a fast CUDA or TensorRT projection kernel is as important as model optimization.
- The MC-dropout uncertainty mode (~30 forward passes) is expensive; run it selectively — useful for flagging low-confidence predictions before map fusion or for calibrating the safety margin on a new deployment environment, not for routine per-frame inference.
- Apply the Lovász-Softmax loss term; the ablation is definitive (+6.2 mIoU) and the implementation is a one-line change using the public Lovász-Softmax library.
- Class-weight the cross-entropy using `w_i = 1 / sqrt(f_i)` — essential for rare classes (motorcyclist, person) that would otherwise be drowned by road and vegetation gradients.
- Image dimensions (64 × 2048 for HDL-64E) are sensor-specific. For a different LiDAR model (128-beam, OS2-128, solid-state), compute the correct `h × w` from the sensor's vertical beam count and horizontal resolution, and retrain from scratch or fine-tune.
- For a richer baseline at similar compute cost, CENet is the natural upgrade: it derives from the SalsaNext codebase, adds larger-kernel convolutions and auxiliary heads, and gains ~5 mIoU points. For the accuracy-efficiency frontier, FRNet (73.3% at 29.1 Hz) or Fast-FRNet (72.5% at 33.8 Hz) supersede SalsaNext without requiring kNN post-processing.
- SalsaNext's uncertainty output is a practical differentiator in safety-critical contexts (airside AV, industrial AV) — expose it as a per-point quality score for downstream consumers.

## Sources

- SalsaNext paper (arXiv): https://arxiv.org/abs/2003.03653 (Cortinhal, Tzelepi, Aksoy — ISVC 2020)
- SalsaNext HTML version: https://arxiv.org/html/2003.03653v4
- SalsaNext Springer (LNCS 12510): https://link.springer.com/chapter/10.1007/978-3-030-64559-5_16
- SalsaNext GitHub: https://github.com/TiagoCortinhal/SalsaNext
- SalsaNet (predecessor): https://arxiv.org/abs/1909.08291 (Aksoy, Baci, Cavdar 2019); GitLab: https://gitlab.com/aksoyeren/salsanet
- RangeNet++ (IEEE IROS 2019): https://ieeexplore.ieee.org/document/8967762/
- RangeNet++ / lidar-bonnetal GitHub: https://github.com/PRBonn/lidar-bonnetal
- CENet (arXiv:2207.12691, ICME 2022): https://arxiv.org/abs/2207.12691; GitHub: https://github.com/huixiancheng/CENet
- RangeViT (arXiv:2301.10222, CVPR 2023): https://arxiv.org/abs/2301.10222; GitHub: https://github.com/valeoai/rangevit
- RangeFormer (arXiv:2303.05367, ICCV 2023): https://arxiv.org/abs/2303.05367; ICCV paper: https://openaccess.thecvf.com/content/ICCV2023/html/Kong_Rethinking_Range_View_Representation_for_LiDAR_Segmentation_ICCV_2023_paper.html
- FRNet (arXiv:2312.04484, 2023): https://arxiv.org/abs/2312.04484; GitHub: https://github.com/Xiangxu-0103/FRNet
- KPRNet (projection artifacts context): https://ar5iv.labs.arxiv.org/html/2007.12668
- Meta-RangeSeg (temporal range accumulation): https://arxiv.org/abs/2202.13377
- Real-time embedded benchmark (Orin pre-processing bottleneck): https://arxiv.org/abs/2410.08365
- FPGA SalsaNext (Springer Real-Time Image Processing, 2025): https://link.springer.com/article/10.1007/s11554-025-01643-9
- Lovász-Softmax loss: https://arxiv.org/abs/1705.08790 (Berman et al. CVPR 2018)
- Related overview: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline (§7.3 projection family, §7.8 training-architecture comparison)
- Related overview: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation (range-image methods §3.3)
- Related method: `./waffleiron.md` — the other projection-based method (dense 2D projection of point features, contrasted with range-image)
- Related method: `./cylinder3d.md` — the sparse-voxel single-scan alternative
