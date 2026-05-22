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

- Superpoint Transformer (SPT) is an architecture for **efficient large-scale 3D semantic segmentation**, introduced in "Efficient 3D Semantic Segmentation with Superpoint Transformer" (ICCV 2023).
- Instead of operating on raw points or voxels, it operates on a **hierarchical partition of the cloud into superpoints** — geometrically homogeneous groups of points.
- It is designed for very large scenes: it can segment point clouds of millions of points in a single forward pass, without tiling.
- Its defining property is size — the model has on the order of 200k parameters, one to three orders of magnitude smaller than typical competitors, and trains in a few hours on one GPU.
- A panoptic extension, **SuperCluster** (3DV 2024), reframes panoptic segmentation as superpoint-graph clustering and scales to whole cities.

## Core Technical Idea

- Most of a large point cloud is geometrically redundant — large planar or smoothly-curved regions can be summarized by a single token without losing semantic content.
- SPT first computes a **hierarchical superpoint partition**: points are grouped into small superpoints, which are grouped into larger ones, by an efficient adjacency-graph partition that favours geometric homogeneity.
- A transformer with self-attention then runs over the **superpoint graph** — orders of magnitude fewer tokens than points — so global, whole-scene context is affordable.
- Each superpoint carries handcrafted features (geometric descriptors such as linearity/planarity/scattering, elevation, colour statistics) summarizing its member points.
- The network predicts a class per superpoint; the label is propagated back to every member point.
- The efficiency comes from the partition: compute scales with the number of superpoints, not the number of points.

## Inputs and Outputs

- Inputs: a point cloud with coordinates and optional features (intensity, RGB); the pipeline computes per-point geometric features and the superpoint partition as a pre-processing step.
- Assumes the cloud is dense and registered enough for a meaningful geometric partition — a good fit for aggregated maps and survey scans, less so for very sparse single frames.
- Output: a per-point semantic label (predicted per superpoint, propagated to points); SuperCluster additionally outputs panoptic instances.
- Intermediate output: the hierarchical superpoint graph, which is itself a compact, reusable scene representation.

## Architecture

- **Stage 1 — partition**: an efficient, parameter-light hierarchical partition of the cloud into nested superpoints, computed once as pre-processing.
- **Stage 2 — Superpoint Transformer**: self-attention over the superpoint graph, with the hierarchy giving multi-scale context; the network is intentionally tiny.
- Handcrafted per-superpoint features replace the heavy learned local encoders other architectures need.
- **SuperCluster** adds a panoptic head that clusters the superpoint graph into instances, trained as a graph-clustering objective.
- The partition is deterministic given the geometry, so the same partition is reused across training epochs unless geometry-altering augmentation is applied.
- The reference implementation is the `superpoint_transformer` repository, which covers both SPT and SuperCluster.

## Training and Evaluation

- SPT reports accuracy on par with or better than far larger models on large-scale benchmarks — S3DIS, KITTI-360, and DALES — at a fraction of the parameters and training cost.
- Training to convergence takes a few hours on a single GPU, versus days for large point/voxel transformers.
- Because the model is tiny, it overfits less on small labeled datasets — an advantage when in-domain labels are scarce.
- Evaluation uses per-class IoU and mIoU for semantics, and Panoptic Quality for the SuperCluster panoptic setting.
- The accuracy ceiling is set by the partition: if two semantically different regions are merged into one superpoint, no downstream attention can separate them.

## Strengths

- Built for exactly the large-registered-scene problem — segments million-point clouds whole, with global context and no tiling seams.
- Extremely small and fast — trains in hours on one GPU, low memory, easy to iterate.
- Small parameter count resists overfitting on small label sets — useful where labeled data is limited.
- The superpoint hierarchy is a reusable, compact scene representation, not just an intermediate.
- SuperCluster extends the same idea to panoptic segmentation at city scale.
- Largely dissolves the tiling/stitching engineering that dominates other large-cloud pipelines.

## Failure Modes

- Accuracy is upper-bounded by the geometric partition — a partition error (merging distinct classes) cannot be recovered by the network.
- The partition assumes geometric homogeneity implies semantic homogeneity; this breaks for thin or appearance-defined classes that are geometrically similar to their surroundings (paint on pavement).
- Geometry-altering augmentation forces the partition to be recomputed, complicating the training pipeline.
- Handcrafted superpoint features can underperform learned features on subtle classes.
- Sparse single-scan clouds give weaker partitions than dense maps — SPT is a map/scan-scale method, not a real-time on-vehicle one.
- A smaller tooling and pre-trained-checkpoint ecosystem than sparse-convolution or PTv3 backbones.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV (offline) | strong | Strong on KITTI-360 and large urban clouds; well suited to HD-map semantic layers and offline auto-labeling. |
| Road AV (on-vehicle) | weak | Designed for large registered scenes, not single sparse frames inside a real-time budget. |
| Airside | conditional | No airside checkpoints exist; the strongest architectural fit for airport-scale aggregated-map segmentation once trained on in-domain data. |
| Aerial / survey (ALS, TLS) | strong | DALES results and the whole-scene design fit airborne and terrestrial survey clouds well. |
| Warehouse / port / mining / construction / agriculture | conditional | Transfers to any large registered-cloud mapping task; weak for embedded real-time perception. |

## Implementation Notes

- Tune the partition first — it sets the accuracy ceiling; inspect superpoints for class-merging errors before blaming the network.
- For appearance-defined classes (painted markings), feed colour or calibrated intensity into the per-superpoint features, since geometry alone will not separate paint from pavement.
- Recompute the partition when applying geometry-altering augmentation; budget this in the training loop.
- The tiny model trains fast — exploit this for rapid iteration on taxonomy and features.
- For panoptic outputs (instances of staged equipment, individual poles/signs), use SuperCluster rather than bolting clustering onto SPT semantics.
- Pair with conservative dynamic removal upstream — residual ghost points distort the partition and create superpoints no class explains.

## Sources

- Superpoint Transformer paper: https://arxiv.org/abs/2306.08045
- SuperCluster (panoptic extension) paper: https://arxiv.org/abs/2401.06704
- Reference implementation (SPT + SuperCluster): https://github.com/drprojects/superpoint_transformer
- Superpoint Graph predecessor: Landrieu and Simonovsky, "Large-scale Point Cloud Semantic Segmentation with Superpoint Graphs" (CVPR 2018)
- Related repository page: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline
