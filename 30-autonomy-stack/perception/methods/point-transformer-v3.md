# Point Transformer V3

<!-- method-priority:start
priority:
  learning: 5
  deployment: 4
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["perception", "lidar", "segmentation", "mapping", "road-av"]
  reason: "Point Transformer V3 is the leading serialized-attention 3D backbone for large-scale point cloud semantic segmentation, including offline aggregated-map labeling."
method-priority:end -->

## What It Is

- Point Transformer V3 (PTv3) is a general-purpose backbone for 3D point cloud understanding, introduced in "Point Transformer V3: Simpler, Faster, Stronger" (CVPR 2024, Oral).
- It is an encoder-decoder transformer that produces per-point features for downstream semantic segmentation, classification, and detection heads.
- Its central design choice is to trade attention-mechanism sophistication for **scale** — a simpler operator that runs faster and lets the model and receptive field grow.
- It is the current reference architecture for high-accuracy 3D semantic segmentation across both indoor and outdoor (LiDAR) point clouds.
- It is modality-agnostic over point sources: terrestrial, mobile, and aerial LiDAR, RGB-D fused clouds, and aggregated multi-scan maps.

## Core Technical Idea

- Earlier point transformers (PTv1/PTv2) spend most of their compute on precise neighbor search (KNN) and intricate local attention; this caps how large the model and receptive field can be.
- PTv3 replaces precise neighborhoods with **point cloud serialization**: points are ordered along space-filling curves (Z-order and Hilbert curves, plus transposed variants) that keep spatially-near points near each other in the 1D sequence.
- Attention then runs over fixed-size contiguous **patches** of the serialized sequence — no KNN, no ball query — which is far cheaper and maps cleanly to dense tensor operations.
- Different serialization patterns are shuffled across layers so the effective receptive field is diverse rather than axis-biased.
- The result reported by the authors: roughly **3× faster and ~10× more memory-efficient than PTv2**, which lets the receptive field grow from ~16 to ~1024 points and the model scale up.
- The thesis is explicit: at scale, a simpler operator with a larger receptive field beats a sophisticated operator with a small one.

## Inputs and Outputs

- Inputs: a point cloud as coordinates `(x, y, z)` plus per-point features — any of intensity/reflectance, RGB colour, surface normal, or other channels.
- Assumes points can be voxelized/gridded for serialization; works from sparse to dense clouds.
- Output: a per-point feature embedding; a task head converts it to per-point class logits (segmentation), a global label (classification), or detection outputs.
- It is a backbone, not a task model — it is paired with a segmentation head, and optionally a panoptic or detection head.
- No camera images are required; it is natively a point-geometry model, though colour channels are used when available.

## Architecture

- A U-Net-style encoder-decoder built from serialized attention blocks.
- **Serialization** module: maps points to one or more space-filling-curve orders and encodes order as integer codes.
- **Patch attention**: self-attention within contiguous patches of the serialized sequence; patch grouping replaces KNN grouping.
- **xCPE** (enhanced conditional positional encoding): a lightweight sparse-convolution-based positional encoding that injects local geometric detail cheaply.
- **Serialized pooling/unpooling**: down- and up-sampling implemented over the serialized representation, replacing farthest-point sampling.
- Trained well with **Point Prompt Training (PPT)** — multi-dataset joint training with per-dataset prompts/normalization — which is what drives its broad SOTA.
- Reference implementation lives in the Pointcept framework.

## Training and Evaluation

- PTv3 reports state-of-the-art results across 20+ indoor and outdoor benchmarks, including ScanNet / ScanNet200, S3DIS, nuScenes lidarseg, SemanticKITTI, and Waymo semantic segmentation.
- Multi-dataset joint training (PPT) is central to the strongest numbers — one backbone trained across many datasets generalizes better than per-dataset training.
- Self-supervised pre-training on PTv3 is provided by **Sonata** (CVPR 2025), which yields strong linear-probe and few-shot performance and is the recommended initialization when labels are scarce.
- For aggregated-map segmentation, PTv3 is typically trained on tiles (overlapping blocks); serialization is tile-friendly, so the architecture imposes little extra tiling cost.
- The evaluation metric for segmentation is per-class IoU and mIoU; report per-class IoU because rare thin classes are easily hidden by mIoU.

## Strengths

- Highest accuracy ceiling among widely-reproduced 3D segmentation backbones.
- Large receptive field — important for big, coherent classes (long facades, large pavement regions, aircraft-scale objects).
- Fast and memory-efficient relative to earlier point transformers, so map-sized tiles are tractable.
- The strongest pre-training ecosystem in 3D (PPT for multi-dataset training, Sonata for SSL) — pre-training is what makes its data hunger manageable.
- Unified indoor + outdoor + aerial backbone — one architecture transfers across point-cloud sources.
- Serialization tiles cleanly, which suits offline aggregated-map pipelines.

## Failure Modes

- High data hunger when trained from scratch — without pre-training it can underperform a sparse-convolution U-Net while costing far more.
- Training is sensitive to learning-rate schedule, warmup, batch size, and augmentation — the most finicky family to tune.
- Serialization approximates locality; pathological geometries can place spatial neighbors far apart in the sequence, weakening local detail unless multiple curve orders are used.
- Heaviest per-tile inference cost of the common families — not suited to the on-vehicle real-time budget without distillation or pruning.
- Quality still depends on input conditioning: registration blur and un-removed dynamics degrade it like any 3D model.
- Less TensorRT-mature than sparse-convolution backbones; embedded deployment needs extra engineering.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV (offline) | strong | SOTA on nuScenes, SemanticKITTI, Waymo segmentation; ideal for offline auto-labeling and HD-map semantic layers. |
| Road AV (on-vehicle) | conditional | Accurate but heavy; needs distillation/pruning/quantization to fit an embedded real-time budget. |
| Airside | conditional | No airside-trained checkpoints exist; strong once pre-trained (Sonata/PPT) and fine-tuned on airside data — the accuracy ceiling for offline aggregated-map segmentation. |
| Warehouse / port / mining / construction / agriculture | conditional | Transfers as a generic 3D backbone; needs domain data and fits offline mapping better than embedded loops. |

## Implementation Notes

- Start from a pre-trained checkpoint (Sonata/PPT); training PTv3 from scratch on a small dataset is the most common way to underperform a simpler model.
- For aggregated-map segmentation, tile into overlapping blocks, normalize coordinates per tile, and merge with logit averaging — serialization does not remove the need for tiling at map scale.
- Use multiple serialization orders (Z-order + Hilbert + transposed) so the receptive field is not axis-biased.
- Budget GPU memory for the largest tile; mixed precision (FP16/BF16) roughly doubles offline throughput.
- For any embedded use, plan a distillation step to a sparse-convolution student rather than deploying PTv3 directly.
- Report per-class IoU; pre-training gains are largest exactly on the rare thin classes that mIoU hides.

## Sources

- PTv3 paper: https://arxiv.org/abs/2312.10035
- Pointcept framework (reference implementation): https://github.com/Pointcept/Pointcept
- Sonata (SSL pre-training for PTv3): https://arxiv.org/abs/2503.16429
- Point Prompt Training / PPT (multi-dataset training): https://arxiv.org/abs/2308.09718
- Related repository page: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline; §7.8 compares PTv3 head-to-head against the other four model families
- Related repository page: `../overview/lidar-foundation-models.md` — 3D pre-training and foundation models
- Related repository page: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation
