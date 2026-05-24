# Segmentation Post-Processing and Label Refinement for 3D / LiDAR Segmentation

**Last updated:** 2026-05-24

This page is the deep-dive companion to [Aggregated-Map Semantic Segmentation §10 (Post-Processing and Refinement)](aggregated-map-semantic-segmentation.md). It covers every stage that runs after the network emits per-point logits and before the labeled map is packaged into an HD-map semantic layer or back-projected to raw scans. The pre-processing companion — the stage that prepares the cloud before inference — is [LiDAR Artifact Removal Techniques](lidar-artifact-removal-techniques.md).

---

## Repo Cross-Links

| Topic | Link | Role |
|---|---|---|
| Hub page (§10 post-processing, §8 tiling, §13 evaluation) | [Aggregated-Map Semantic Segmentation](aggregated-map-semantic-segmentation.md) | The aggregated-map pipeline that this page supports |
| Per-scan segmentation | [LiDAR Semantic Segmentation](lidar-semantic-segmentation.md) | Single-scan inference methods |
| Pre-processing companion | [LiDAR Artifact Removal Techniques](lidar-artifact-removal-techniques.md) | Cloud conditioning before inference |
| Dynamic-object removal | [LiDAR Map Cleaning and Dynamic Removal](../../localization-mapping/slam-methods/lidar-map-cleaning-dynamic-removal.md) | Static map construction; a prerequisite |
| Calibration metrics (ECE/MCE) | [Point-Cloud Segmentation Losses and Metrics — First Principles](../../../10-knowledge-base/geometry-3d/point-cloud-segmentation-losses-metrics-first-principles.md) | Expected calibration error theory |
| SuperCluster (learned panoptic) | [SuperCluster](../methods/superpoint-transformer.md) | Graph-clustering panoptic head |
| MosaiC3D / MixSeg3D context | [Mosaic3D](../methods/mosaic3d.md) | TTA benchmark source |

---

## Why Post-Process

Raw per-point argmax on softmax probabilities has well-known failure modes that post-processing can cheaply mitigate:

| Failure mode | Root cause | Post-processing remedy |
|---|---|---|
| **Boundary noise** | Per-point classification ignores spatial context across object boundaries | CRF / kNN voting / region-based smoothing |
| **Isolated mislabels** | Low-probability noise predictions, especially on sparse returns | Connected-component cleanup, minimum-cluster-size filtering |
| **Label flicker** | Frame-to-frame prediction inconsistency at the same 3D location | Temporal / multi-scan Bayesian fusion, accumulated voxel histograms |
| **Tile-seam inconsistency** | Tiled inference runs each tile independently; context at borders is truncated | Overlap-halo inference, logit averaging in seam zones |
| **Overconfidence on rare classes** | Training imbalance; long-tailed distributions | Calibration, temperature scaling, per-class thresholds |

The computational cost of post-processing is almost always negligible relative to inference. For a map of 100 M points processed in tiles, adding kNN smoothing adds roughly 1–5 % extra wall time; CRF adds more (up to 50 % depending on iteration count) but is still cheap compared to the network forward pass. Each step below should be evaluated in isolation before adding it to the stack — not every step is beneficial for every backbone.

---

## Conditional Random Fields (CRF)

### Foundations — Dense CRF (Krähenbühl & Koltun)

The fully-connected (dense) CRF introduced in Krähenbühl & Koltun, NIPS 2011 ([arXiv:1210.5644](https://arxiv.org/abs/1210.5644)) defines a pairwise Gibbs energy over all pairs of nodes. For a labeling `x` of points `{1…N}`:

```
E(x) = Σ_i ψ_u(x_i)  +  Σ_{i<j} ψ_p(x_i, x_j)
```

**Unary potential** `ψ_u(x_i) = -log P(x_i | obs_i)` — the negative log of the network softmax for point `i`. This is the network's classification signal.

**Pairwise potential** `ψ_p(x_i, x_j) = μ(x_i, x_j) · k(f_i, f_j)` where `μ` is a label compatibility matrix (learned or Potts model) and `k` is a mixture of Gaussian kernels over a feature vector `f = [x, y, z, intensity, ...]`:

```
k(f_i, f_j) = w1 · exp(-|Δxyz|²/2σ_xyz² - |Δfeat|²/2σ_feat²)
            + w2 · exp(-|Δxyz|²/2σ_smooth²)
```

The first kernel (bilateral) enforces that nearby, feature-similar points receive the same label. The second (proximity) enforces smoothness regardless of feature similarity. The `σ` bandwidths are tunable hyperparameters per class.

**Mean-field inference** approximates the posterior `Q(x) ≈ P(x | obs)` with a factored distribution, updating each `Q_i` iteratively:

1. Message passing: convolve `Q` with the Gaussian kernels (efficient via permutohedral lattice — O(N·d) per step, not O(N²)).
2. Reweighting: apply `w1`, `w2` weights.
3. Compatibility transform: apply `μ`.
4. Add unary: `Q_i ← softmax(−ψ_u − Σ_j …)`.
5. Repeat 3–10 iterations until convergence.

Python implementation: [`lucasb-eyer/pydensecrf`](https://github.com/lucasb-eyer/pydensecrf) (covers point cloud inputs beyond images).

### CRF Applied to 3D Point Clouds

**DCRF post-processing ([MDPI Sensors 2021](https://www.mdpi.com/1424-8220/21/8/2731)):** A fast deep neural network plus DCRF pipeline applies DCRF as a downstream step on network output, using XYZ + intensity as the Gaussian feature vector. The dense CRF optimizes semantic segmentation results while the network supplies the unary.

**Continuous CRF convolution ([arXiv:2110.06085](https://arxiv.org/pdf/2110.06085)):** Reformulates CRF inference as a message-passing graph convolution over a continuous quadratic energy model, enabling integration into the backbone as a differentiable layer.

**SqueezeSeg ([arXiv:1710.07368](https://arxiv.org/pdf/1710.07368)):** Range-image LiDAR segmentation that appends a recurrent CRF (CRF-as-RNN) layer after the CNN to refine range-image predictions before back-projecting to 3D points. Demonstrated 8.7 ms/frame on an NVIDIA GPU in 2017 — making CRF-as-RNN cost practical for real-time.

**SEGCloud ([arXiv:1710.07563](https://arxiv.org/pdf/1710.07563)):** Voxel-grid PointNet → trilinear interpolation back to raw points → FC-CRF (implemented as a differentiable RNN for joint training). The CRF enforces global spatial consistency on back-projected point labels.

### CRF-as-RNN

Zheng et al., ICCV 2015 ([arXiv:1502.03240](https://arxiv.org/pdf/1502.03240)) formulate each iteration of mean-field inference as an RNN step, making the CRF differentiable end-to-end so gradients flow through inference during training. Applied to 3D by SEGCloud and SqueezeSeg. The practical value: rather than running CRF only at inference, the network learns unaries that are already CRF-aware.

### When CRF Helps vs. Hurts

- **Helps:** projection-based / range-image methods where 2D CNN predictions are blurry when projected back to 3D; sparse regions with few neighbors; scenes with strong geometric boundaries (walls, floors, vehicles).
- **Hurts / neutral:** point-based or voxel-based methods that already use 3D context (KPConv, SparseConv); very thin structures (wires, poles, railings) where bilateral smoothing will over-smooth across class boundaries; compute-constrained edge deployments with more than 10 CRF iterations.
- **KPRNet observation ([arXiv:2007.12668](https://arxiv.org/pdf/2007.12668)):** "Finding a good balance between over- and under-smoothing the 3D labels with [kNN / CRF] can be difficult." KPRNet replaces post-hoc kNN/CRF with a learned KPConv 3D module as the final layer, achieving better results with no manual tuning.

---

## Geometric and Graph-Based Label Smoothing

### kNN Majority Voting

The simplest spatial post-processor: for every point `p`, find its `k` nearest neighbors in 3D Euclidean space (typically `k=5–20`) and assign `p` the plurality label among those neighbors. Applied as the standard back-projection post-processor in projection-based methods — RangeNet++ uses GPU-accelerated kNN with `k=7`. Cost: O(N·k) after a KD-tree build (O(N·log N)).

**Variants:**
- Confidence-weighted voting: weight each neighbor's vote by its network confidence `max(softmax(z))`.
- Bi-directional: include only neighbors whose own classification agrees with at least 50 % of their neighbors, reducing propagation of false-positive islands.

### Superpoint / Region-Based Smoothing

The Superpoint Graph (SPG) framework ([Landrieu & Simonovsky, CVPR 2018, arXiv:1711.09869](https://arxiv.org/pdf/1711.09869)) partitions the point cloud into geometrically homogeneous superpoints — contiguous connected components with similar local geometry. Each superpoint receives one label via GNN over the SPG. This is both a network architecture choice and an implicit post-processor: label disagreement within a superpoint is impossible.

**As pure post-processing:** after any per-point segmentation, group points into superpoints (Euclidean or voxel-based) and assign each superpoint the majority or highest-confidence label from all contained points. Enforces intra-region consistency without retraining. See also: [SuperCluster](../methods/superpoint-transformer.md) for a learned extension.

**Over-smoothing risk:** superpoints that span class boundaries (e.g., ground/wall edge) will force the entire superpoint into one class. Thin classes — catenary wire, fence post, road marking stripe — frequently fit inside one superpoint with mostly-correct labels but can be entirely erased if even one heavily-weighted neighbor is wrong.

### Connected-Component Cleanup

After argmax, build a connectivity graph (edges between points within distance `d_thresh`, same-class pairs only). Find connected components using union-find (O(N)). Remove or re-classify via kNN any component with fewer than `N_min` points, where `N_min` is class-specific: an isolated 5-point cluster labeled "vehicle" is almost certainly noise; 5 points labeled "road marking" may be legitimate. Applied as a final cleanup step in many production LiDAR pipelines.

### Graph Label Propagation

For weakly-supervised settings, label propagation on a kNN graph spreads known labels to unlabeled points via random-walk weights. As a post-processor it can fill in low-confidence points by diffusing from high-confidence neighbors. Risk: label pollution if the graph contains wrong edges — points from different objects that happen to be spatially proximate.

---

## Test-Time Augmentation (TTA)

TTA generates multiple augmented copies of the input, runs inference on each, and averages the resulting probability distributions (soft-vote) before the final argmax.

### Augmentation Types for LiDAR

| Augmentation | How applied | Notes |
|---|---|---|
| **Rotation** | Yaw rotations about vertical axis (±90°, ±180°, random) | Most effective; rotationally non-equivariant models benefit most |
| **Scaling** | Uniform scale factor (0.95–1.05) | Small gain; can distort height features |
| **Flip** | Mirror about X or Y axis | Useful for road-side asymmetry artifacts |
| **Shift / translation** | Small XY shifts | Helps tile-boundary sensitivity |
| **Multi-crop / subsampling** | Multiple random subsamples of dense input | Less common for map segmentation |

### Aggregation

Soft (logit/probability) averaging is strictly better than hard majority-vote averaging because it preserves uncertainty:

```
p_ensemble(c | x) = (1/T) · Σ_t softmax(z_t(x))
```

where `z_t` are the logits under augmentation `t`. Final label = argmax of the averaged probability.

### Reported Gains

From the 2024 Waymo Open Dataset Challenge (3D Semantic Segmentation track), MixSeg3D solution ([arXiv:2501.05472](https://arxiv.org/pdf/2501.05472)):

| TTA iterations | mIoU (SemanticKITTI-style eval) |
|---|---|
| 1× (no TTA) | 72.06 % |
| 3× | 72.41 % (+0.35) |
| 6× | 72.67 % (+0.61) |
| **8×** | **74.03 % (+1.97)** |
| 10× | 73.67 % (+1.61) |

Peak gain: approximately +2 mIoU at 8× TTA with diminishing returns beyond 8×. The authors explicitly note the approach is "not very practical in terms of actual deployment" due to 8× inference cost. Rule of thumb: TTA is worth using for offline map production where latency is not a constraint; not practical for real-time AV perception.

---

## Model Ensembling

### Multi-Checkpoint / Multi-Model Averaging

Average the softmax outputs (or logits) of `M` independently trained or differently-initialized models:

```
p_ens(c | x) = (1/M) · Σ_m softmax(z_m(x))
```

Reduces variance from stochastic training. In practice, 3–5 models is the sweet spot — diminishing returns beyond 5. Competitive leaderboard solutions routinely ensemble 3–5 checkpoints.

**Pseudo-label use:** Ensemble voting across multiple models produces more reliable pseudo-labels and mitigates single-model biases during domain adaptation ([arXiv:2507.18176](https://arxiv.org/pdf/2507.18176)). This is the key production use case: ensemble at the annotation or map-build stage, then deploy a single model.

**Test-time checkpoint averaging (EMA):** Averaging weights over the training trajectory is cheaper than full multi-model ensembling and typically yields 0.3–0.8 mIoU gain.

**Cost vs. gain:** `M`× inference cost for roughly 0.5–2.0 mIoU gain. Practical for map production; impractical for on-vehicle real-time inference.

---

## Instance and Panoptic Extraction from Semantic Output

Semantic segmentation assigns per-point class labels; panoptic additionally assigns unique instance IDs to countable "thing" classes (vehicles, pedestrians, ground-support equipment) while treating "stuff" classes (ground, tarmac, structure) as amorphous regions.

### Training-Free: ALPINE

**ALPINE (A Light Panoptic INstance Extractor)** ([arXiv:2503.13203](https://arxiv.org/abs/2503.13203) / [valeoai/Alpine](https://github.com/valeoai/Alpine)) is a drop-in instance head requiring zero instance annotations or training:

1. Filter to "thing" class points from the semantic output.
2. Project to Bird's Eye View (BEV) independently per class.
3. Build a 2D k-NN graph (`k=32`) with a distance-threshold edge filter.
4. Extract connected components to produce candidate clusters.
5. Apply recursive **box splitting**: if a cluster's bounding box exceeds a per-class size prior (obtainable from dataset statistics), bisect via binary threshold search and repeat.

**Complexity:** O(n_c · k · log n_c) — substantially faster than DBSCAN (O(n²)) or HDBSCAN. **Runtime:** 14.4 Hz on a single-threaded CPU for SemanticKITTI (DBSCAN: 3.2 Hz; HDBSCAN: 4.5 Hz; D&M: 0.5 Hz).

**Performance (SemanticKITTI validation):** PQ 64.2–65.9 (depending on semantic backbone); RQ 74.1–75.5; SQ 84.4. Ranks #1 on the SemanticKITTI official panoptic leaderboard when paired with a SOTA semantic backbone. **nuScenes:** PQ 76.9–79.5 (81.8 with ensembling).

ALPINE's key design parameter is the per-class object size prior — only a rough estimate of typical object footprint is required, with no instance-level annotations.

### DBSCAN and HDBSCAN

**DBSCAN:** Groups points with at least `minPts` neighbors within radius `ε` into clusters; the remainder are noise. Parameters must be tuned per class (pedestrian: small `ε`; aircraft: large `ε`). Adaptive-ε variants estimate `ε` automatically ([MDPI Sensors 2019](https://www.mdpi.com/1424-8220/19/1/172)).

**HDBSCAN:** Hierarchical extension; handles variable-density clusters better. Used in TARL-Seg and 4D-Seg for spatio-temporal clustering over short scan windows.

**Class-specific thresholds are critical for airside:** an aircraft cluster has a footprint 10–100× larger than a ground vehicle. A single `ε` value will over-merge pedestrians or under-merge aircraft. The standard approach: run DBSCAN or ALPINE separately per semantic class with class-tuned parameters.

### Learned Panoptic: SuperCluster

**SuperCluster** ([arXiv:2401.06704](https://arxiv.org/abs/2401.06704), 3DV 2024 Oral) reframes panoptic segmentation as scalable graph clustering on superpoints:

- Groups points into superpoints, then constructs a superpoint graph where edge features encode spatial and semantic affinity.
- A tiny GNN (209 k parameters, 30× smaller than competing methods) predicts edge cut/keep probabilities → graph partitioning → instances.
- Trained with only local auxiliary tasks, eliminating costly global instance matching during training.
- 15× faster training; processes millions of points in a single inference pass.

Performance: S3DIS Area 5 → 50.1 PQ (+7.8 vs. prior SOTA); ScanNetV2 → 58.7 PQ (+25.2); first benchmarked on KITTI-360 and DALES (large outdoor mobile mapping). See [SuperCluster method page](../methods/superpoint-transformer.md) for implementation details.

### BEV-Projected Clustering

Several panoptic methods (Panoptic-PolarNet, Panoptic-PHNet) project semantic features into a polar or Cartesian BEV, predict centroid offsets, and cluster offset-shifted points. BEV projection simplifies clustering to 2D. **Vertical over-segmentation** is a known failure mode: points at different heights from the same tall object get separated in BEV. The fix: perform initial clustering in BEV, then merge vertically adjacent clusters of the same class.

---

## Confidence and Uncertainty Handling

### Per-Point Confidence

The raw confidence of a per-point classification is:

```
conf_i = max_c softmax(z_i)[c]
```

This is a necessary but not sufficient reliability signal. Deep networks are systematically overconfident, especially in sparse and long-range regions. Calib3D ([arXiv:2403.17010](https://arxiv.org/abs/2403.17010), WACV 2025 Oral) benchmarks 28 SOTA 3D models across 10 datasets and confirms that "despite achieving impressive accuracy, existing models frequently fail to provide reliable uncertainty estimates." Models are worst-calibrated at long range.

**Entropy as uncertainty:**

```
H_i = -Σ_c p_i(c) · log p_i(c)
```

High entropy signals high uncertainty and can be used directly as an uncertainty map for downstream QA.

### Calibration: Temperature Scaling

Post-hoc calibration divides logits by a scalar temperature `T > 1` before softmax:

```
p_i(c) = softmax(z_i / T)[c]
```

`T` is fit on a validation set by minimizing NLL. Higher T produces a flatter distribution and less overconfidence. Reported ECE improvements from Calib3D:

- RangeNet++ on SemanticKITTI: 4.01 % → 3.12 % ECE with standard temperature scaling; 2.33 % with DeptS (depth-aware scaling).
- FRNet on nuScenes: 2.27 % → 2.17 % ECE.

**DeptS — Depth-aware Scaling:** adjusts T as a function of point range; farther points receive higher T (more smoothing) because long-range detections are structurally more uncertain. Directly relevant to large-scale maps with 100+ m range points.

**Parameterized Temperature Scaling (PTS) ([arXiv:2102.12182](https://arxiv.org/pdf/2102.12182)):** learns a small network to predict per-sample T, addressing the fact that a single scalar T cannot fix miscalibration that varies across data-point types.

**Sampling-free confidence estimation ([arXiv:2411.11935](https://arxiv.org/pdf/2411.11935)):** estimates aleatoric uncertainty from a single forward pass without MC dropout, enabling per-point confidence maps at real-time inference rates.

See [Point-Cloud Segmentation Losses and Metrics](../../../10-knowledge-base/geometry-3d/point-cloud-segmentation-losses-metrics-first-principles.md) for ECE and MCE definitions and calibration theory.

### Confidence Thresholding / Abstention

Points with `conf_i < τ` or entropy `H_i > H_max` can be assigned to a designated `unknown` or `void` class rather than a noisy categorical prediction. This is especially important for safety-critical map production:

- The map layer marks such points as "uncertain" for downstream consumers (path planning, obstacle avoidance).
- Threshold `τ` is class-sensitive: a low-confidence "runway" prediction is more dangerous to promote than a low-confidence "taxiway" prediction.
- **OOD / open-set:** OOD detection via hierarchical GMMs ([arXiv:2510.08631](https://arxiv.org/abs/2510.08631)) models per-class feature distributions and flags epistemic outliers, avoiding conflation of aleatoric ambiguity with true OOD objects. Neural distribution prior approaches ([arXiv:2604.09232](https://arxiv.org/html/2604.09232)) and open-set panoptic segmentation ([arXiv:2506.13265](https://arxiv.org/html/2506.13265v1)) extend this to reject and segment unknown instances.

### Uncertainty Maps for QA and Active Learning

Per-point entropy maps are the primary signal for:

- **Map QA:** visualizing high-uncertainty zones that require human review.
- **Active learning sample selection:** LiDAL ([arXiv:2211.05997](https://arxiv.org/pdf/2211.05997)) selects new annotation candidates based on inter-frame uncertainty divergence, achieving 95 % of full-supervision performance with fewer than 5 % of labeled points.

---

## Geometric and Map-Prior Constraints

### Ground-Plane Prior

LiDAR ground segmentation estimates the ground plane or a piecewise-planar ground model in a 2D grid ([survey: PMC 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC9862692/)). Post-hoc: any point labeled "vehicle / pedestrian / GSE" but sitting at ground-plane elevation (within tolerance) that also lacks supporting evidence of a 3D object shape can be relabeled to "ground." Conversely, any point labeled "ground" but at significant height above the fitted plane is suspect.

### Height-Band Priors

Most semantic classes occupy predictable height bands in airside / outdoor scenes:

| Class | Typical Z range |
|---|---|
| Ground / apron | −0.3 to +0.2 m above terrain |
| Ground-support equipment | +0.2 to +4 m |
| Aircraft fuselage (parked) | +1 to +6 m |
| Aircraft wing | +2 to +10 m |
| Building facade / jetway | +0 to +20 m |
| Overhead wires / lighting | +5 to +15 m |

A point labeled "ground" at +8 m is physically implausible and can be corrected by nearest-neighbor re-classification within the correct height band's dominant label. Note: height-only filters will over-segment tall objects that span multiple bands — apply them conservatively.

### Intensity / Reflectance Priors

LiDAR intensity encodes surface reflectance. Road markings have high reflectance (0.7–0.9 normalized); asphalt has low reflectance (0.1–0.2) ([arXiv:2211.01105](https://arxiv.org/html/2211.01105v2)). Post-hoc: points labeled "road marking" with intensity below a threshold are suspect (likely shadow noise or thin return). Points labeled "ground" but with very high intensity in a stripe pattern can be promoted to "road marking."

**Reflectivity (calibrated) vs. raw intensity:** raw intensity depends on range and incidence angle; calibrated reflectivity is range-angle-corrected and more reliable as a class prior ([arXiv:2403.13188](https://arxiv.org/html/2403.13188v1)). Where the hardware provides a calibrated reflectivity channel (Ouster, Livox), prefer it.

### Physically-Implausible Label Correction

Systematic rule-based passes after classification can fix structural errors cheaply (O(N)):

- Any point labeled "sky" in a LiDAR scan → relabel to `unknown` (LiDAR does not see sky).
- Any enclosed cluster labeled "aircraft" that is less than 1 m in maximum extent → too small; relabel to `vehicle` or `GSE`.
- Isolated point labeled "building" surrounded entirely by "ground" points → noise, relabel to `ground`.

These rules are domain-specific and must be compiled from operational experience. They carry zero false-negative cost as long as rules are conservative.

---

## Fusing Multi-Pass Predictions

### The Two-Pass Problem

For large-scale map production there are two natural working modes:

- **Pass A: segment-then-accumulate.** Run segmentation on each individual scan, then accumulate per-scan labels into the map. Fast and online-capable, but accumulated predictions carry label noise from each scan's pose uncertainty and limited per-scan context.
- **Pass B: accumulate-then-segment.** Register all scans into a dense aggregated map first, then run segmentation on the full map. Higher accuracy due to denser context, but requires the complete map and is offline-only.

Pass B is the authoritative map; Pass A provides a cheap prior. Fusing them reduces both flicker noise and computation.

### Bayesian / Voting Fusion

**Voxel-histogram approach:** discretize the map into voxels. For each voxel, maintain a label histogram counting how many per-scan predictions (Pass A) assigned each class. The histogram is equivalent to a Dirichlet-distributed posterior; the MAP estimate is the plurality-label voxel. Before running Pass B, initialize the voxel histogram from Pass A results; Pass B then updates it.

**OctoMap-style log-odds update:** for binary occupancy this is `l_t = l_{t-1} + log(P(z|occ)/P(z|free))`. For semantic classes, extend to a per-class log-odds vector: `l_t[c] = l_{t-1}[c] + log P(obs|class=c)`. Normalize at query time via softmax. Recurrent-OctoMap ([arXiv:1807.00925](https://arxiv.org/abs/1807.00925)) extends this with a recurrent feature fusion layer for long-term consistency. Camera-LiDAR probabilistic fusion ([arXiv:2007.05490](https://arxiv.org/pdf/2007.05490)) applies Bayesian semantic fusion across sensor modalities.

**P2Net temporal consistency ([arXiv:2212.00567](https://arxiv.org/pdf/2212.00567)):** trains a small refinement network on per-scan predictions to learn inter-frame consistency constraints. On SemanticKITTI, PointNet++ mIoU improved from 10.8 % to 15.9 % as a post-processing add-on.

### Weighted Fusion

When Pass A and Pass B produce conflicting labels, confidence-weighted fusion prefers the higher-confidence prediction:

```
p_final(c | voxel) ∝ conf_A · p_A(c) · (1 − conf_A) + conf_B · p_B(c)
```

In practice this is often implemented as "take Pass B except where its confidence is below threshold τ, then fall back to Pass A majority vote."

---

## Tile Stitching and Label Merge

### The Seam Problem

Networks trained on tiles of fixed spatial extent (e.g., 50 m × 50 m tiles for a large airport map) lack context at tile boundaries. Predictions within roughly 5–10 % of the tile edge are systematically less accurate than the tile interior.

### Overlap-Halo Strategy

Standard practice in image segmentation, directly applicable to 3D:

1. Tile the map with a **halo** border equal to roughly half the model's receptive field (or a fixed spatial margin such as 5 m).
2. Run inference on each tile with halo. All output points are predicted.
3. For the **interior zone** (non-halo), accept predictions as-is.
4. For the **halo zone** (overlap between adjacent tiles), average the logits or probabilities from the two tiles:

```
p_seam(x) = 0.5 · p_tile_A(x) + 0.5 · p_tile_B(x)
```

5. Apply a final argmax.

**Distance-weighted halo:** weight by distance from each tile's center (Gaussian or linear taper) so points closer to Tile A's center receive higher weight from Tile A's prediction, smoothly transitioning at the midpoint.

**Exact tile inference ([NIST JRES 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC10914126/)):** selects the halo to be exactly half the network receptive field so output tiles join at seams without any overlap, saving memory at the cost of knowing the receptive field precisely.

**Normalization consistency:** batch norm running statistics must be computed over the full dataset, not per-tile, to ensure seam consistency. Per-tile batch normalization produces visible seam artifacts. Use accumulated running-average stats (inference-mode batch norm) or layer norm.

**Uncertainty flag — literature coverage:** robust tile-stitching methodology for 3D LiDAR map segmentation specifically is not well documented in the peer-reviewed literature as of the research date. The halo-overlap principles above are directly applicable but are largely extrapolated from 2D image segmentation practice (particularly biomedical U-Net tiling) and general best-practice engineering judgment. Treat the specific halo-size guidance as a reasonable starting point requiring empirical validation on the target map scale and backbone. See [Aggregated-Map Semantic Segmentation §8](aggregated-map-semantic-segmentation.md) for the hub discussion.

---

## Output Products

### Per-Point Label + Confidence

The primary deliverable: each 3D point in the map carries:

- `label`: integer class ID (post-processed argmax).
- `conf`: float in [0, 1], the calibrated confidence `p(label | point)` after temperature scaling.
- Optionally: `entropy`: float, the predictive entropy.

### HD-Map Semantic Layer

The semantic point cloud is aggregated into the HD-map semantic layer. Typical representations:

- **Semantic voxel grid:** each occupied voxel carries a label plus confidence. Resolution: 5–20 cm for static mapping.
- **Semantic mesh / surface:** triangulated surface with per-face class labels, used for simulation and localization.
- **Semantic BEV raster:** top-down projection, used for planning and cross-validation with camera-derived HD maps.

The HD-map semantic layer supports downstream tasks: localization (matching live scan semantic labels to map), planning (drivable area, obstacle zones), and map-change detection.

### Map-Hygiene Layer Products

For aggregated maps, post-processing must emit more than one label array. The semantic label answers what the point is; the map-hygiene label answers whether that point is publishable permanent geometry, a movable/static-transient object, a FOD candidate, an artifact, or an unknown/review region.

| Output layer | Typical source signals | Publication meaning |
|---|---|---|
| `permanent_static` | High-confidence static infrastructure classes, stable across sessions, low residual error | Eligible for released base-map geometry and localization priors |
| `movable_static` | Parked vehicles, staged GSE, parked aircraft, containers, movable barriers | Soft context or quarantine only; not fused into permanent map truth |
| `static_transient` | Stationary people, temporary work equipment, event furniture, short-lived clutter | Hard exclusion from permanent map; retain evidence for review and training negatives |
| `dynamic_residual` | Ghost trails, motion-smears, inconsistent scan support, MOS/scene-flow disagreement | Removal evidence and map-conditioning defect signal |
| `fod_candidate` | Small isolated objects on operational surfaces, cones/chocks/tools/cables, open-set hazard candidates | Operational inspection or safety-review layer, never structural map geometry |
| `artifact` | Multipath, weather returns, scan shadows, registration doubles, impossible height/intensity combinations | Exclude and count against source-map or conditioning quality |
| `unknown_review` | Low-confidence, high-entropy, OOD, open-vocabulary candidates without taxonomy promotion | Human review or active-learning queue |

This layer split is the post-processing counterpart to [Semantic Class Taxonomy Design](3d-segmentation-class-taxonomy-design.md): a correctly labeled `person`, `staged GSE`, or `cable` can still be a wrong base-map point. The release bundle should therefore package semantic labels, calibrated confidence, and hygiene labels together, with digests recorded in `semantic_map_manifest.json`.

### Release-State-Preserving Refinement

Most post-processing algorithms were designed to improve semantic smoothness. They should not be allowed to overwrite publication state unless the rule is explicit and auditable. Run kNN, CRF, TTA, and ensemble fusion on semantic logits or candidate labels; then apply release-state policy with guard masks, source evidence, and reviewer state. If a refinement step changes a release-state label, record the rule trigger and before/after digest in the tile ledger.

| Refinement step | Safe use | Unsafe use |
|---|---|---|
| kNN / CRF smoothing | Smooth semantic labels inside a trusted `permanent_static` region | Smoothing `fod_candidate`, `static_transient`, or `unknown_review` into surrounding pavement |
| Connected-component cleanup | Remove tiny low-confidence semantic islands after checking class-specific minimum sizes | Deleting FOD-like or artifact-like clusters before global tile merge and reviewer evidence retention |
| Superpoint smoothing | Harmonize labels inside geometry-homogeneous surfaces | Letting one superpoint span movable-static equipment and fixed infrastructure |
| Height/intensity sanity rules | Flag impossible labels to `unknown_review` or `artifact` with a reason code | Promoting an uncertain object to `permanent_static` only because it fits a height band |
| TTA / ensemble fusion | Average logits and confidence for semantic class selection | Treating ensemble agreement as proof of permanence without map-hygiene evidence |
| Open-vocabulary relabeling | Produce `candidate_label` metadata and active-learning candidates | Creating new release labels or permanent classes without taxonomy promotion |

Post-processing should be fail-closed for release state: ambiguity moves points to `unknown_review`, not to the nearest high-frequency class. This is especially important in non-road urban districts where movable assets and temporary operational objects sit directly on top of permanent surfaces.

### Auto-Label Back-Projection to Single Scans

Once the aggregated map is labeled (typically with higher accuracy due to dense context), those labels can be back-projected to individual raw scans for training-data generation:

1. For each scan, find each scan point's map voxel via nearest-neighbor lookup.
2. Copy the map-voxel label to the scan point.
3. Optionally: propagate map-confidence as a label weight for loss weighting during training.

This is the auto-labeling / data flywheel mechanism. Back-projection from aggregated map to single scans cuts annotation cost while improving training data quality ([arXiv:1804.09915](https://arxiv.org/pdf/1804.09915)). See also [Aggregated-Map Semantic Segmentation §13](aggregated-map-semantic-segmentation.md) for evaluation of auto-labeled data.

---

## Recommended Post-Processing Pipeline

For **production HD-map labeling** (airside or urban AV), the industry-aligned stack:

```
1. Accumulate-then-segment (Pass B) as the primary inference mode.
   - Register all scans to a static map before segmenting.
   - Conditioning prerequisite: see lidar-artifact-removal-techniques.md.

2. Overlap-halo tiling with logit averaging at seam zones.
   - Halo ≈ half the model's receptive field or 5 m fixed, whichever is larger.
   - Distance-weighted averaging preferred over hard-cut.

3. kNN majority vote (k=7–10) as the first post-processor.
   - Confidence-weighted variant where per-point confidences are available.
   - Applied after back-projection from range-image / voxel methods.

4. Temperature-scaled calibration (DeptS preferred for long-range maps).
   - Fit T on a held-out validation tile of the target environment.
   - Store calibrated confidence per point in output.

5. Connected-component cleanup with class-specific N_min.
   - Vehicle: N_min ≈ 50. Road marking: N_min ≈ 5. Aircraft: N_min ≈ 500.
   - Low-confidence components below N_min → assign to `unknown`.

6. ALPINE (or per-class DBSCAN) instance extraction for thing classes.
   - Run per semantic class with class-specific object size priors.
   - Output: per-point instance ID in addition to semantic label.

7. Height-band and intensity sanity checks as a final rule-based pass.
   - Class-height violations → nearest-neighbor re-classification or `unknown`.
   - Road marking / reflectance cross-check using calibrated intensity.

8. Emit semantic, confidence, and map-hygiene layers.
   - `permanent_static` may feed base-map publication.
   - `movable_static`, `static_transient`, `dynamic_residual`, `fod_candidate`, `artifact`, and `unknown_review` remain separate quarantine/review layers.
   - Smoothing rules may change semantic IDs only inside allowed release-state masks; release-state changes require reason codes.
   - Record layer digests and map-hygiene metrics in the semantic-map manifest.

9. Back-projection of map labels to individual raw scans for data flywheel.
   - Propagate map-voxel label and confidence to scan points.
   - Do not back-project quarantine layers as clean permanent labels; use them as negatives, review tasks, or exclusion masks.
   - Label weight in training proportional to map confidence.
```

TTA (8×) and model ensembling (3–5 models) are applied for the **annotation quality** run — executed once per map update where 8× cost is tolerable for maximum-quality ground truth — not in the online inference loop.

---

## Trade-offs

| Step | Compute cost | Typical gain | When to apply | Key risk |
|---|---|---|---|---|
| kNN majority vote | Very low O(N·k) | +0.5–2 mIoU | Always; especially after range-image methods | Erodes thin classes |
| CRF post-hoc (5 iter) | Low–medium | +0.5–1.5 mIoU | Noisy boundaries; not for KPConv/SparseConv | Over-smoothing; σ tuning |
| CRF-as-RNN end-to-end | Low marginal at inference | +1–3 mIoU | If retraining is possible | Training complexity |
| Superpoint smoothing | Very low | +0.3–1 mIoU | Dense planar-surface-rich scenes | Destroys fine detail at boundaries |
| Connected-component cleanup | Very low O(N) | Removes FPs | Always; cheap | Risk of deleting sparse legitimate clusters |
| TTA (8×) | 8× inference cost | +1.5–2 mIoU | Offline map production only | Not viable real-time |
| Ensemble 3–5 models | 3–5× inference cost | +1–2 mIoU | Map production; auto-labeling | Cost; models must be independent |
| ALPINE instance extraction | Very low CPU 14.4 Hz | Adds panoptic | Any pipeline needing instances without annotation | Requires object-size prior |
| Temperature calibration | Negligible | −30–40 % ECE | Always | None; pure upside |
| DeptS depth-aware scaling | Negligible | Better than scalar TempS at range | Long-range maps | Requires depth-split calibration set |
| Confidence thresholding | Negligible | Removes low-conf noise | Safety-critical maps | Increases void fraction; τ must be set carefully |
| Bayesian voxel fusion | Low | Reduces flicker | Multi-pass / online pipelines | Log-odds diverges with badly wrong priors |
| Overlap-halo stitching | ~10–20 % extra inference | Eliminates seam artifacts | Any tiled-inference pipeline | Halo size must match receptive field |
| Height/intensity prior checks | Very low | Removes implausible labels | Domain-specific maps | Rules must be validated per environment |
| Hygiene-layer emission | Low | Prevents semantic labels from becoming wrong permanent map truth | Every aggregated-map release | Requires maintained policy table and manifest digests |

---

## Implementation Notes

- **KD-tree reuse.** Build a single KD-tree on the accumulated map at the start of the post-processing pass and reuse it for kNN voting, connected-component distance queries, and back-projection lookups. On a 100 M point map at 5 cm voxel resolution (after downsampling: ~8 M voxels), a single tree build takes 2–5 s on CPU; queries are then sub-millisecond per point.
- **Voxel grid indexing.** For maps stored as voxel grids, replace KD-tree lookups with direct hash-grid addressing where points are pre-assigned to voxels. Reduces back-projection cost from O(N·log N) to O(N).
- **ALPINE parameter tables.** Object size priors (maximum bounding-box dimension per class) for airside must be constructed from operational knowledge. Approximate starting values: pedestrian 2 m, ground vehicle 6 m, aircraft 80 m, GSE 8 m. ALPINE's box-splitting then subdivides oversize clusters automatically.
- **Calibration data.** Temperature scaling requires a held-out tile of the target environment — not just a random split of training data. Using a tile from a different time of day or weather condition tests generalization. Depth-split calibration requires enough far-range (>50 m) labeled points in the calibration set; verify this before using DeptS.
- **Connected-component thresholds.** Set `N_min` values conservatively — it is worse to delete a genuine sparse cluster than to retain a small false-positive. Validate against a labeled test tile before applying to production maps.
- **Batch norm at inference.** When running tiled inference with halo overlap, freeze batch norm statistics (use stored running-average stats, not per-tile batch stats). This is the single most common source of seam artifacts in practice.
- **Logging.** Store pre- and post-processed label arrays plus per-point confidences for every production map build. Post-processing bugs are often discovered only when downstream tasks (localization, planning) expose map inconsistencies.
- **Layer digests.** Hash semantic, confidence, and hygiene layers after every post-processing stage that can change labels. The final manifest should identify which rule set, calibration file, connected-component thresholds, and abstention policy produced each released digest.

---

## Failure Modes

| Symptom | Likely cause | Diagnostic |
|---|---|---|
| Thin classes (wires, railings, road markings) systematically mislabeled after post-processing | kNN voting or superpoint smoothing over-smoothing into dominant neighbor class | Disable post-processing steps one at a time; measure per-class IoU before/after each step |
| Visible seam lines in semantic map (class changes along tile boundaries) | Per-tile batch norm or missing overlap-halo | Check batch norm mode; confirm halo is >= half receptive field; visualize logit magnitudes at seams |
| High void fraction in output map | Confidence threshold τ set too high, or calibration T too large | Inspect entropy map; plot confidence histogram; re-fit T on a representative validation tile |
| Instance merging of separate same-class objects | ALPINE/DBSCAN ε or object-size prior too large | Inspect BEV cluster visualization; reduce per-class ε or tighten size prior |
| Instance over-splitting of a single large object | ALPINE object-size prior too small for class | Expand size prior; check for fragmented superpoints |
| Spurious aircraft-scale clusters labeled as single instance | Missing or wrong per-class DBSCAN/ALPINE parameterization | Confirm class-specific object size priors; verify that class isolation step (filter to thing class before clustering) runs correctly |
| Calibration makes accuracy worse | Calibration set is out-of-distribution relative to inference map | Validate calibration tile matches target scene type; check for class imbalance in calibration set |
| Label flicker in multi-session maps | Bayesian voxel fusion prior initialized with wrong Pass A labels | Inspect voxel histogram distributions; check for systematic per-scan misclassification before fusion |
| Auto-labeled scan points receive wrong class from map back-projection | Poor scan-to-map registration at voxel resolution | Inspect point-to-voxel assignment; tighten registration quality gate or increase voxel resolution |
| Correctly labeled movable/static-transient points become permanent map geometry | Post-processing exports a single semantic layer without a hygiene-layer split | Emit `movable_static`, `static_transient`, `fod_candidate`, `artifact`, and `unknown_review` layers and block publication if they are fused into `permanent_static` |
| Physically implausible labels survive to output | Rule-based sanity pass not covering the domain | Extend rule table from operational observation; apply after every map build and log rule-triggered changes |

---

## Sources

### Primary References

- Krähenbühl & Koltun, dense CRF: [arXiv:1210.5644](https://arxiv.org/abs/1210.5644) / [pydensecrf](https://github.com/lucasb-eyer/pydensecrf)
- SqueezeSeg (CRF-as-RNN on LiDAR): [arXiv:1710.07368](https://arxiv.org/pdf/1710.07368)
- SEGCloud (trilinear interp + FC-CRF): [arXiv:1710.07563](https://arxiv.org/pdf/1710.07563)
- CRF-as-RNN (Zheng et al., ICCV 2015): [arXiv:1502.03240](https://arxiv.org/pdf/1502.03240)
- Continuous CRF convolution: [arXiv:2110.06085](https://arxiv.org/pdf/2110.06085)
- DCRF for 3D point cloud: [MDPI Sensors 21(8) 2021](https://www.mdpi.com/1424-8220/21/8/2731)
- KPRNet (replacing kNN/CRF with learned 3D module): [arXiv:2007.12668](https://arxiv.org/pdf/2007.12668)
- Superpoint Graphs (Landrieu & Simonovsky, CVPR 2018): [arXiv:1711.09869](https://arxiv.org/pdf/1711.09869)
- ALPINE training-free panoptic: [arXiv:2503.13203](https://arxiv.org/abs/2503.13203) / [GitHub valeoai/Alpine](https://github.com/valeoai/Alpine)
- SuperCluster learned panoptic (3DV 2024 Oral): [arXiv:2401.06704](https://arxiv.org/abs/2401.06704)
- TTA Waymo 2024 / MixSeg3D: [arXiv:2501.05472](https://arxiv.org/pdf/2501.05472)
- Unsupervised domain adaptation pseudo-label ensembling: [arXiv:2507.18176](https://arxiv.org/pdf/2507.18176)
- P2Net temporal post-processing: [arXiv:2212.00567](https://arxiv.org/pdf/2212.00567)
- Recurrent-OctoMap: [arXiv:1807.00925](https://arxiv.org/abs/1807.00925)
- Camera-LiDAR probabilistic fusion: [arXiv:2007.05490](https://arxiv.org/pdf/2007.05490)
- Calib3D (WACV 2025 Oral): [arXiv:2403.17010](https://arxiv.org/abs/2403.17010)
- Parameterized Temperature Scaling: [arXiv:2102.12182](https://arxiv.org/pdf/2102.12182)
- Sampling-free confidence estimation: [arXiv:2411.11935](https://arxiv.org/pdf/2411.11935)
- LiDAL active learning: [arXiv:2211.05997](https://arxiv.org/pdf/2211.05997)
- OOD detection via hierarchical GMMs: [arXiv:2510.08631](https://arxiv.org/abs/2510.08631)
- Neural distribution prior / open-set: [arXiv:2604.09232](https://arxiv.org/html/2604.09232)
- Open-set panoptic segmentation: [arXiv:2506.13265](https://arxiv.org/html/2506.13265v1)
- Auto-labeling via cross-modal back-projection: [arXiv:1804.09915](https://arxiv.org/pdf/1804.09915)
- DBSCAN for LiDAR (improved eps): [MDPI Sensors 19(1) 2019](https://www.mdpi.com/1424-8220/19/1/172)
- Road marking reflectivity: [arXiv:2211.01105](https://arxiv.org/html/2211.01105v2)
- Reflectivity-first segmentation: [arXiv:2403.13188](https://arxiv.org/html/2403.13188v1)
- Ground segmentation survey: [PMC 9862692](https://pmc.ncbi.nlm.nih.gov/articles/PMC9862692/)
- Overlap-tile exact inference: [PMC 10914126](https://pmc.ncbi.nlm.nih.gov/articles/PMC10914126/)

### Cross-Links (Internal)

- [Aggregated-Map Semantic Segmentation](aggregated-map-semantic-segmentation.md) — hub page: §8 Tiling/Stitching, §10 Post-Processing, §13 Evaluation
- [LiDAR Semantic Segmentation](lidar-semantic-segmentation.md) — per-scan inference methods
- [LiDAR Artifact Removal Techniques](lidar-artifact-removal-techniques.md) — pre-processing companion (prerequisite to this page)
- [LiDAR Map Cleaning and Dynamic Removal](../../localization-mapping/slam-methods/lidar-map-cleaning-dynamic-removal.md) — static map construction; dynamic removal before segmentation
- [Point-Cloud Segmentation Losses and Metrics — First Principles](../../../10-knowledge-base/geometry-3d/point-cloud-segmentation-losses-metrics-first-principles.md) — ECE/MCE calibration metric theory
- [SuperCluster method page](../methods/superpoint-transformer.md) — learned graph-clustering panoptic head
- [Mosaic3D method page](../methods/mosaic3d.md) — TTA benchmark context (MixSeg3D / Waymo 2024)
