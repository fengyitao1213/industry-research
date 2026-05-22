# Superpoint Transformer

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["perception", "lidar", "segmentation", "mapping"]
  reason: "Superpoint Transformer is rated for large-scale 3D semantic segmentation of registered point clouds where whole-scene context and very small models matter."
method-priority:end -->

## What It Is

- Superpoint Transformer (SPT) is an architecture for **efficient large-scale 3D semantic segmentation**, introduced in "Efficient 3D Semantic Segmentation with Superpoint Transformer" (Robert, Raguet & Landrieu, ICCV 2023).
- Instead of operating on raw points or voxels, it operates on a **hierarchical partition of the cloud into superpoints** — geometrically homogeneous groups of points that share similar local surface properties.
- It is designed for very large scenes: it can segment point clouds of millions to hundreds of millions of points in a single forward pass, without tiling.
- Its defining property is size — the standard model has ~212 k parameters, one to three orders of magnitude smaller than typical competitors, and trains in a few GPU-hours on a single GPU.
- The partition compression is extreme: a 919 M-point KITTI-360 cloud reduces to ~16 M level-1 superpoints (~57× reduction), then to ~3 M level-2 superpoints; the transformer operates at this compressed scale.
- A panoptic extension, **SuperCluster** (3DV 2024 Oral), reframes panoptic segmentation as superpoint-graph clustering and scales to whole cities.

## Core Technical Idea

- Most of a large point cloud is geometrically redundant — large planar or smoothly-curved regions can be summarised by a single token without losing semantic content.
- SPT first computes a **hierarchical superpoint partition**: points are grouped into small superpoints (`P1`), then those are grouped into larger superpoints (`P2`), by an efficient adjacency-graph partition that favours geometric homogeneity.
- A U-Net transformer then runs self-attention over the **superpoint graph** — orders of magnitude fewer tokens than points — so global, whole-scene context is affordable.
- Each superpoint carries handcrafted geometric descriptors (linearity, planarity, scattering, verticality) plus optional radiometric features (RGB, intensity), summarising its member points.
- The network predicts a semantic class per superpoint; the label is propagated back to every member point.
- Efficiency derives entirely from the partition: all downstream compute scales with superpoint count, not point count.
- This contrasts with voxel-based transformers (PTv3, OctFormer) that reduce compute by limiting attention windows but still process O(n) tokens: SPT reduces the token count itself by 2–3 orders of magnitude before any network runs.

## Operator Mechanics

### Superpoint Partition (ℓ₀-Cut Pursuit)

The partition solves a regularised piecewise-constant signal approximation on a k-NN graph:

```
J(e; f, G, λ) = ‖e − f‖² + λ · Σ_{(u,v) ∈ E} w_{u,v} · [e_u ≠ e_v]
```

- `f` — per-point feature vector: geometry descriptors (linearity, planarity, scattering, verticality) plus optional RGB/intensity
- `e` — piecewise-constant signal to recover (the partition assignment)
- `λ` — regularisation strength; higher λ → coarser, fewer superpoints
- `w_{u,v}` — edge weights from the k-NN adjacency graph
- `[e_u ≠ e_v]` — ℓ₀ penalty: penalises any two adjacent points assigned to different superpoints

The solver is **ℓ₀-Cut Pursuit**: a graph-cut algorithm that runs in `O(n log n)` for graph construction plus `O(n)` per iteration. It is CPU-bound but highly parallelisable and processed once per dataset (not per inference call).

Compression ratios on three benchmarks:

| Dataset | Raw points | Subsampled | Level-1 superpoints | Level-2 superpoints |
|---------|-----------|-----------|---------------------|---------------------|
| S3DIS | 274 M | 32 M | 979 k | 292 k |
| KITTI-360 | 919 M | 432 M | 16.2 M | 2.98 M |
| DALES | 492 M | 449 M | 14.8 M | 2.56 M |

Adjacency between level-1 superpoints uses an **Approximate Superpoint Gap** heuristic: two superpoints are connected if their nearest-pair points lie within a distance `ε1`. This avoids expensive Delaunay triangulation while preserving proximity topology.

### Hierarchical Superpoint Graph and U-Net Transformer

The transformer is a U-Net with 3 encoder stages and 1 decoder:

- **Token representation:** each superpoint at `P1` is represented by max-pooled point features; hierarchical pooling repeats for `P2`.
- **Attention type:** sparse, graph-aware self-attention restricted to the graph neighbourhood `N(p)`:

```
att(Q, K, V) = Vᵀ · softmax(Q ⊙ K · 1/√|N(p)|)
```

- **Adaptive queries:** each neighbour `q` of superpoint `p` receives its own query features `a_{p,q}^{que}`, encoding the pairwise relationship, not just the node features.
- **Neighbourhood normalisation:** the softmax denominator uses neighbour count `|N(p)|` rather than key dimension — stabilises attention for superpoints with highly variable degree.
- **Adjacency encoding:** an 18-dimensional handcrafted edge feature vector per superpoint pair (interface area, length ratio, pose offset) is used instead of learned positional embeddings, further reducing parameter count.
- **Attention heads:** 16 heads, key dimension `D_key = 4`.

Model sizes:

| Variant | Parameters | Comparison |
|---------|-----------|------------|
| SPT (full) | 212 k | Up to 196× smaller than PointNeXt-XL |
| SPT-nano | 26 k | ~300× smaller than KPConv |

## Complexity and Compute

- **Preprocessing (CPU, one-time):** 12.4 min on 48-core CPU for S3DIS; 117 min for KITTI-360; 148 min for DALES. Preprocessing is per-dataset and amortised across all downstream inference or training epochs — it is not on the inference critical path.
- **Training:** 3.0 GPU-hours per S3DIS fold on a single A40. This is ~70× faster than Stratified Transformer (216 GPU-hours) for the same benchmark. SPT-nano trains in under 1 GPU-hour per fold.
- **Inference:** ~2 s per scene on S3DIS Area 5 (~32 k superpoints at P1 level); SPT-nano ~1 s. These are offline-map latencies — not intended for real-time single-scan on-vehicle use.
- **Memory:** the tiny parameter count means the model fits comfortably in under 1 GB of GPU memory; the primary memory cost is storing superpoint features for very large maps.

## Training Recipe

| Hyperparameter | S3DIS (indoor) | Outdoor (KITTI-360, DALES) |
|---------------|----------------|---------------------------|
| Optimizer | AdamW | AdamW |
| Learning rate | 0.1 (10× lower for attention) | 0.01 |
| Epochs | 200 | 200 |
| LR schedule | Cosine annealing after 20-epoch warmup | Same |
| Batch | 4 random tiles, 7 m radius | 4 random tiles, 50 m radius |

**Augmentations:** superpoint dropout (`p=0.2` per level), random rotation, coordinate jitter, handcrafted-feature dropout.

**Point sampling per superpoint:** `tanh(n/128)` scaling, minimum 32 points sampled — prevents superpoints with very large point counts from dominating GPU memory while preserving statistical representativeness.

**Loss:** weighted cross-entropy, with optional Lovász-softmax for mIoU-calibrated training.

## Benchmark Results

| Dataset | Split | SPT mIoU | Nearest competitor | Competitor mIoU |
|---------|-------|----------|--------------------|-----------------|
| S3DIS | 6-fold | **76.0%** | PointNeXt-XL | 74.9% |
| S3DIS (SPT-nano) | 6-fold | 70.8% | KPConv / MinkowskiNet | ~69–70% |
| KITTI-360 | val | **63.5%** | MinkowskiNet | 58.3% |
| DALES | test | **79.6%** | ConvPoint | 67.4% |

SPT-nano (26 k parameters) matches KPConv and MinkowskiNet on S3DIS at ~300× lower parameter count. The KITTI-360 and DALES results are especially significant for aggregated-map work: both are multi-pass MLS or airborne LiDAR datasets that structurally resemble pre-registered AV maps.

The +12.2 pp DALES gap (79.6% vs. 67.4% for ConvPoint) is the largest competitive gap in the table and confirms that the superpoint representation is particularly well-matched to outdoor large-area ALS datasets — the density and planarity of such clouds produce clean superpoint partitions.

Source: https://arxiv.org/abs/2306.08045

## Variants and Lineage

### Predecessor: Superpoint Graph (SPG, CVPR 2018)

The intellectual precursor is Landrieu and Simonovsky's "Large-scale Point Cloud Semantic Segmentation with Superpoint Graphs" (CVPR 2018). SPG introduced the idea of partitioning a cloud into geometrically homogeneous superpoints and building a graph over them. SPT replaces SPG's GRU-based graph network with a modern transformer and introduces the two-level hierarchy and improved partition algorithm.

### SPT (ICCV 2023) — Semantic Segmentation

The core SPT model as described above. 212 k parameters, U-Net transformer, graph-aware attention over two-level superpoint hierarchy.

### SuperCluster (3DV 2024 Oral) — Panoptic Extension

SuperCluster extends SPT from semantic to **panoptic segmentation** (semantic labels + unique instance IDs for "thing" classes). Key design choices:

1. The SPT backbone produces per-superpoint **semantic logits** and per-superpoint **instance offset vectors** — 3D offsets pointing toward the instance centre.
2. A **graph clustering step** groups adjacent superpoints with compatible offsets and semantic labels into instances.
3. Training uses only **local auxiliary tasks** (per-superpoint centre-ness and offset regression) — no global instance matching (Hungarian algorithm) is needed during training, which is the main source of scalability.
4. At inference, the entire scene (millions of points, thousands of objects) is processed as a single graph without windowing.

SuperCluster benchmark results (Panoptic Quality — PQ):

| Dataset | SuperCluster PQ | Prior SOTA PQ | Improvement |
|---------|----------------|---------------|-------------|
| S3DIS Area 5 | **50.1** | ~42.3 | +7.8 |
| ScanNetV2 | **58.7** | ~33.5 | +25.2 |
| KITTI-360 | first established SOTA | — | — |
| DALES | first established SOTA | — | — |

SuperCluster efficiency: 209 k parameters (30× smaller than competing panoptic methods); up to 15× faster training than the next-best method; S3DIS Area 5 (9.2 M points, 1 863 objects) processed in 3.3 s on a single V100-32 GB.

Source: https://arxiv.org/abs/2401.06704

## Aggregated-Map Suitability

**Rating: Excellent**

The superpoint partition architecture was designed for exactly this problem class. Several properties make it the strongest fit among current methods for large aggregated LiDAR maps:

**Sensor-origin independence.** The ℓ₀-Cut Pursuit partition operates on a k-NN graph over geometry and handcrafted descriptors. It does not assume a single sensor origin, a spherical projection, or a scan timestamp. Multi-pass MLS, airborne LiDAR, and AV scan stacks are all geometrically equivalent inputs.

**Compression scales to map size.** On KITTI-360 (919 M raw points), the two-level hierarchy reduces the token count to ~3 M before any deep network runs. For an airside map covering a full apron or taxiway system, the same compression applies proportionally. The transformer's compute grows with superpoint count, not point count.

**Preprocessing amortisation.** The 117 min CPU preprocessing for KITTI-360 is a one-time cost per map version. Once computed, the superpoint graph can be stored and queried repeatedly — for labelling, map updates, and inference — without rerunning the partition. This exactly matches the map-pipeline workflow where the same registered cloud is processed many times.

**Validated on aggregated-map datasets.** KITTI-360 is a multi-pass MLS street-level dataset; DALES is multi-return airborne LiDAR. Both are structurally aggregated maps (not single-scan data), and SPT achieves the strongest published mIoU on both. No other method in this family has this direct evidence base.

**Density variation handling.** Aggregated maps have extreme density variation — dense at slow vehicle passes, sparse at high-altitude returns. The partition naturally handles this: dense regions produce small tight superpoints; sparse regions produce larger superpoints. Fixed-resolution voxelisation discards density variation; SPT encodes it through superpoint size and shape.

**Airside-specific considerations:** Airport apron maps include highly planar surfaces (pavement, taxiways), thin structures (poles, signage), large curved objects (aircraft fuselage), and small equipment (belt loaders, tugs). The partition's linearity/planarity features will strongly segment pavement from structures, but painted runway markings (co-planar with surface) will require colour or intensity features in the superpoint feature vector to avoid merging with the surface. Dynamic object residuals (aircraft taxiing between map passes) may straddle superpoint boundaries and require upstream dynamic removal.

**SuperCluster for instance-level maps:** Where the map requires instance-level labelling (individual parked aircraft, unique jetbridge positions), SuperCluster's graph-clustering panoptic head scales directly to the map size and eliminates per-instance matching overhead.

## Inputs and Outputs

- Inputs: a registered point cloud with coordinates and optional features (intensity, RGB). The pipeline computes per-point geometric features and the superpoint partition as pre-processing.
- Assumes the cloud is dense and registered enough for a meaningful geometric partition — a good fit for aggregated maps and survey scans, less so for very sparse single frames.
- Output: a per-point semantic label (predicted per superpoint, propagated to points); SuperCluster additionally outputs panoptic instances.
- Intermediate output: the hierarchical superpoint graph, which is itself a compact, reusable scene representation suitable for storing alongside the map.

## Label Propagation and Post-Processing

Prediction happens at the superpoint level and must be propagated back to raw points. SPT uses a simple assignment: every point inherits the semantic class of its parent `P1` superpoint. This is lossless within the partition's resolution — two points in the same superpoint always get the same label, which is correct if the partition is accurate.

For the `P2` level, predictions are similarly propagated down: `P2` superpoint class → `P1` superpoints within it → raw points. The U-Net decoder refines predictions at `P1` resolution using skip connections from the encoder, so the final prediction is at `P1` granularity, not `P2`. This is the primary reason SPT uses a two-level hierarchy rather than a single coarse level: `P2` provides global context, `P1` provides fine-grained boundaries.

**Handling class boundaries:** When the geometric partition is accurate, semantic boundaries coincide with superpoint boundaries and label propagation is trivially correct. When the partition merges two classes (e.g., a thin pole touching a wall), the label of the merged superpoint is determined by the class with more member-point influence on the aggregated features — the minority class is silently absorbed. Inspecting partition quality near class-boundary superpoints is therefore the primary diagnostic step when mIoU falls short of expectations.

**SuperCluster instance propagation:** For panoptic tasks, SuperCluster assigns each "thing"-class superpoint an instance offset vector; graph clustering groups superpoints into instances. Each raw point then receives both a semantic class and an instance ID from its parent superpoint's cluster assignment.

## Strengths

- Built for exactly the large-registered-scene problem — segments hundred-million-point clouds whole, with global context and no tiling seams.
- Extremely small and fast to train — 3 GPU-hours on one A40, low memory, rapid iteration.
- Small parameter count resists overfitting on small label sets — an advantage where labelled airside data is limited.
- The superpoint hierarchy is a reusable, compact scene representation, not merely an intermediate.
- SuperCluster extends the same idea to panoptic segmentation at city scale.
- Largely dissolves the tiling/stitching engineering that dominates other large-cloud pipelines.
- Preprocessing is a one-time cost per map version, not per inference run.

## Failure Modes

- Accuracy is upper-bounded by the geometric partition — a partition error (merging distinct semantic classes) cannot be recovered by the downstream network.
- The partition assumes geometric homogeneity implies semantic homogeneity; this breaks for thin or appearance-defined classes that are geometrically similar to their surroundings (painted runway markings on flat pavement, road-surface wear patterns).
- Handcrafted partition features (linearity/planarity) can fail for noisy or low-density scans — far-range aerial LiDAR returns or single-pass at high speed produce weak geometric descriptors.
- Does not natively handle dynamic objects: moving pedestrians or taxiing aircraft in aggregated maps may straddle superpoint boundaries and produce ambiguous superpoints.
- Preprocessing CPU time is long for very large datasets (148 min for DALES); unsuitable for real-time single-scan inference.
- Geometry-altering augmentation forces the partition to be recomputed, complicating the training pipeline.
- Smaller tooling and pre-trained-checkpoint ecosystem than PTv3 or sparse-convolution backbones.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV (offline) | strong | Strong on KITTI-360 and large urban clouds; well suited to HD-map semantic layers and offline auto-labelling. |
| Road AV (on-vehicle) | weak | Designed for large registered scenes, not single sparse frames inside a real-time budget. |
| Airside | conditional | No airside checkpoints exist; the strongest architectural fit for airport-scale aggregated-map segmentation once trained on in-domain data. |
| Aerial / survey (ALS, TLS) | strong | DALES results and the whole-scene design fit airborne and terrestrial survey clouds well. |
| Warehouse / port / mining / construction / agriculture | conditional | Transfers to any large registered-cloud mapping task; weak for embedded real-time perception. |

## Implementation Notes

- Tune the partition first — it sets the accuracy ceiling; inspect superpoints visually for class-merging errors before blaming the network.
- For appearance-defined classes (painted markings, surface coatings), feed colour or calibrated intensity into the per-superpoint features, since geometry alone will not separate paint from pavement.
- Recompute the partition when applying geometry-altering augmentation; budget this cost in the training loop.
- The tiny model trains fast — exploit this for rapid iteration on taxonomy and feature engineering.
- For panoptic outputs (instances of staged equipment, individual poles/signs, parked aircraft), use SuperCluster rather than bolting post-hoc clustering onto SPT semantics.
- Pair with conservative dynamic removal upstream — residual ghost points from moving objects distort the partition and create superpoints that no class cleanly explains.
- Store the computed superpoint graph alongside the map for reuse — recomputing for every downstream query wastes the one-time preprocessing investment.
- For airside-specific deployments, pre-train on KITTI-360 or DALES to initialise weights, then fine-tune with PointLoRA or full fine-tune on a small labelled airside dataset (500–1 000 frames is sufficient per CLAUDE.md estimates).

## Sources

- Superpoint Transformer paper (ICCV 2023): https://arxiv.org/abs/2306.08045
- SuperCluster panoptic extension (3DV 2024): https://arxiv.org/abs/2401.06704
- Reference implementation (SPT + SuperCluster): https://github.com/drprojects/superpoint_transformer
- Superpoint Graph predecessor (CVPR 2018): Landrieu and Simonovsky, "Large-scale Point Cloud Semantic Segmentation with Superpoint Graphs"
- Related overview: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline; §7.8 compares the superpoint family head-to-head against the other four model families
- Related overview: `../overview/lidar-semantic-segmentation.md` — broad survey of LiDAR segmentation architectures
