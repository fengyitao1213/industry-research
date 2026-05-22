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

- RandLA-Net is an efficient deep architecture for semantic segmentation of large-scale point clouds, introduced in "RandLA-Net: Efficient Semantic Segmentation of Large-Scale Point Clouds" (CVPR 2020).
- It is built to label point clouds of millions of points directly, without the heavy pre/post-processing (block partition, voxelization, projection) earlier methods needed.
- It uses an encoder-decoder structure and outputs a per-point class label.
- Its design priority is throughput and memory efficiency at scale — it trades some accuracy for the ability to process very large clouds fast.
- It is a widely-used baseline for MLS/ALS survey-cloud segmentation.

## Core Technical Idea

- The bottleneck in large-cloud segmentation is point sampling: farthest-point sampling and learned sampling are accurate but scale poorly in time or memory.
- RandLA-Net uses **random point sampling** to down-sample between layers — O(1) per point, almost free in time and memory — which is what makes million-point clouds tractable.
- Random sampling discards points indiscriminately and can drop useful detail, so RandLA-Net pairs it with a **local feature aggregation** module that widens the receptive field and preserves geometry as points are thinned.
- Local feature aggregation has three parts: **Local Spatial Encoding** (LocSE) explicitly encodes relative point positions; **Attentive Pooling** learns per-feature importance weights instead of max-pooling away information; and a **Dilated Residual Block** stacks LocSE + attentive pooling so each point quickly "sees" a large neighborhood.
- The net effect: random sampling supplies the speed, attentive aggregation supplies the accuracy that random sampling would otherwise cost.

## Inputs and Outputs

- Inputs: a point cloud as `(x, y, z)` plus optional per-point features — RGB colour, intensity/reflectance, or none.
- It ingests large clouds directly; no block partitioning or voxelization pre-step is required.
- Output: a per-point class label for semantic segmentation.
- It is a complete segmentation network (backbone + head), not just an operator.
- No images are used; colour, when present, is just an input channel.

## Architecture

- An encoder-decoder (U-Net-like) network.
- Encoder: alternating dilated residual blocks and random-sampling down-sampling layers — the cloud shrinks rapidly while per-point receptive field grows.
- Decoder: nearest-neighbor interpolation up-sampling with skip connections back to encoder features.
- A shared MLP head produces per-point logits.
- The architecture has no expensive learnable sampling or neighbor-search component — neighbor queries use a fixed KNN, kept cheap.
- The reference implementation covers Semantic3D, SemanticKITTI, S3DIS, and NPM3D configurations.

## Training and Evaluation

- RandLA-Net reported state-of-the-art results in 2020 on Semantic3D and SemanticKITTI, and strong results on other large-scale benchmarks.
- The authors report it processes ~1 million points in a single pass and is up to ~200× faster than some block-based baselines.
- Trained with cross-entropy (commonly class-weighted) and standard point-cloud augmentation.
- Training is stable; the random sampling introduces mild run-to-run variance.
- Evaluation uses per-class IoU and mIoU.

## Strengths

- Purpose-built for large-scale clouds — million-point inference in one pass, low memory.
- Random sampling makes it among the fastest and lightest segmentation backbones.
- No heavy pre-processing — ingests raw large clouds directly.
- Attentive pooling and dilated residual blocks recover much of the detail random sampling would lose.
- A well-reproduced, dependable baseline with survey-industry mileage.
- Scales gracefully — the same model handles small and very large clouds.

## Failure Modes

- Random sampling is indiscriminate: a rare thin structure (a thin pole, a marking sliver) can be sampled out entirely and is then unrecoverable.
- This makes RandLA-Net weaker on rare and thin classes than methods with rare-class-aware or learned sampling.
- Accuracy trails sparse-convolution, transformer, and superpoint backbones on current leaderboards.
- The random sampling adds non-determinism — repeated runs differ slightly.
- Fixed KNN neighborhoods can be sub-optimal across very non-uniform density.
- Like all 3D models, it is capped by input conditioning (registration blur, residual dynamics).

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV (offline) | strong | A standard efficient baseline on SemanticKITTI and large MLS clouds; good for fast offline auto-labeling passes. |
| Road AV (on-vehicle) | conditional | Lightweight, but designed for large clouds rather than a single sparse frame in a hard real-time loop. |
| Airside | conditional | No airside checkpoints exist; a fast, dependable baseline for offline aggregated-map segmentation once trained on airside data — watch rare-class recall. |
| Aerial / survey (ALS, TLS) | strong | Designed for and proven on large survey clouds; a common MLS/ALS baseline. |
| Warehouse / port / mining / construction / agriculture | conditional | Transfers as a generic, efficient large-cloud backbone. |

## Implementation Notes

- Add rare-class-aware tile/seed selection upstream — random sampling will otherwise statistically drown markings, poles, and other thin classes.
- Class-weight or use Lovász-softmax loss; RandLA-Net does not address class imbalance itself.
- Use it as the fast first-pass model in an aggregated-map pipeline — heavier transformers can refine where it is uncertain.
- Expect mild variance from random sampling; average results or fix seeds when benchmarking.
- For thin-class-critical maps (markings, wires), prefer or ensemble with a sparse-conv or transformer backbone.
- It pairs well as the cheap "segment-then-accumulate" prior model alongside a heavier authoritative pass.

## Sources

- RandLA-Net paper: https://arxiv.org/abs/1911.11236
- Reference implementation: https://github.com/QingyongHu/RandLA-Net
- Related repository page: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline
- Related repository page: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation
