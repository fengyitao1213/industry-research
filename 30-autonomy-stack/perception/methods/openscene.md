# OpenScene

<!-- method-priority:start
priority:
  learning: 4
  deployment: 3
  type: "method"
  stage: "frontier"
  maturity: "research"
  tags: ["perception", "lidar", "segmentation", "road-av"]
  reason: "OpenScene is the canonical open-vocabulary 3D segmentation method — text-query the labeled cloud without fixed-taxonomy training."
method-priority:end -->

## What It Is

- OpenScene is an open-vocabulary 3D semantic segmentation method published as "OpenScene: 3D Scene Understanding with Open Vocabularies" (CVPR 2023, ETH Zürich / MPI-IS, Google Research).
- It lifts dense per-pixel CLIP-aligned feature vectors from posed RGB images (produced by 2D models LSeg or OpenSeg) into a 3D point cloud, giving every point a CLIP-space embedding without any labeled 3D training data.
- At query time, a free-form text string is encoded by CLIP's text encoder; cosine similarity between the text embedding and each point's 3D feature produces an open-vocabulary per-point segmentation score.
- A 3D-distilled variant (MinkowskiNet14D trained via feature-imitation loss) removes the camera dependency at inference, enabling LiDAR-only deployment.
- OpenScene is the first widely-cited method to turn a 3D point cloud into a text-queryable map without a fixed category taxonomy, and remains the canonical baseline for the open-vocabulary 3D segmentation lineage (RegionPLC, GGSD, Mosaic3D).

## Core Technical Idea

The core problem OpenScene addresses is the **closed-set assumption** in standard 3D segmentation: methods such as PointPillars, MinkUNet, and PTv3 train against a fixed label set — any category absent from that set collapses to "background" or "unknown." For long-tail environments such as airport aprons, warehouse interiors, or mining sites, the diversity of equipment and objects far exceeds what any practical training taxonomy covers.

OpenScene's insight is that CLIP's vision-language embedding space is inherently open-vocabulary: if CLIP has seen an object concept in internet-scale image-text training, any text description of that concept will produce a meaningful embedding close to the object's visual embedding. The method exploits this by:

1. Using 2D CLIP-aligned encoders (LSeg, OpenSeg) to produce dense per-pixel feature vectors in CLIP space — not class logits, but raw 512-dimensional CLIP embeddings — for every RGB input frame.
2. Projecting each 3D point into its visible frames via known camera intrinsics and extrinsics, and aggregating the pixel-level CLIP features onto the point (weighted multi-view averaging). The result is one 512-dim CLIP-space feature per point.
3. At query time, encoding any text string `t` with CLIP's frozen text encoder to obtain `e_t`, then scoring every point by `cosine_sim(feature_p, e_t)`. No retraining, no fixed taxonomy.

The 3D-distilled variant trains a sparse 3D convolutional network to imitate the 2D-fused features using a cosine-distance loss, so inference no longer requires images. This is the deployable path for LiDAR-only scenarios.

## Operator Mechanics

For the **2D-fused variant** (inference-time; requires posed RGB frames):

1. Run LSeg or OpenSeg on each RGB frame to produce a `(H, W, 512)` feature map per frame (CLIP ViT-L/16 space).
2. For each 3D point `p`, identify all frames where `p` is visible: in-frustum check and depth-buffer occlusion test using known camera poses.
3. Project `p` into each visible frame; bilinearly sample the pixel feature at the projection location.
4. Compute a weighted average of the sampled features across all visible frames (weights can reflect viewing angle confidence):

```
F_p^{2D} = sum_v [ w_v * feat(p, v) ] / sum_v [ w_v ]
```

5. At query time: `score(p, t) = cosine_sim(F_p^{2D}, CLIP_TextEncoder(t))`.
6. For segmentation over a label set `{t_1, ..., t_K}`, take `argmax_k score(p, t_k)` per point.

For the **3D-distilled variant** (inference-time; LiDAR-only):

1. Voxelize the input point cloud (xyz + RGB color if available) and pass to MinkowskiNet14D.
2. MinkowskiNet14D outputs a 512-dim CLIP-aligned feature per point: `F_p^{3D}`.
3. Query and score identically to the 2D-fused variant: `score(p, t) = cosine_sim(F_p^{3D}, CLIP_TextEncoder(t))`.

For the **2D–3D ensemble** (strongest variant; requires images at inference):

Both `F_p^{2D}` and `F_p^{3D}` are available. For a label set, compute per-point similarity scores under both feature sets independently, then average the similarity score vectors before taking argmax. Ensembling is done in similarity space, not feature space.

## Inputs and Outputs

| Item | Detail |
|---|---|
| **Inputs (2D-fused)** | 3D point cloud (xyz) + posed RGB-D frames (intrinsics, extrinsics, depth) |
| **Inputs (3D-distilled)** | 3D point cloud (xyz + optional RGB color), voxelized |
| **Inputs (query)** | Free-form text string (any CLIP-vocabulary concept) |
| **Outputs** | Per-point cosine similarity score to the query; argmax over a label set gives open-vocab semantic segmentation |
| **Feature dimension** | 512 (CLIP ViT-L/16 space) |
| **No 3D labels required** | Neither variant requires any 3D semantic annotation — not for open-vocab query (2D-fused) nor for distillation training |

## Architecture

### 2D-Fused Variant (training-free for open-vocab)

```
[Posed RGB frames]
       |
  LSeg (ICLR 2022) or OpenSeg (ECCV 2022)   <- frozen; CLIP ViT-L/16-aligned 2D encoder
       |
  Dense per-pixel feature maps (H x W x 512)
       |
  Projection (camera intrinsics + extrinsics + depth occlusion check)
       |
  Weighted multi-view averaging over visible frames
       |
  F_p^{2D}  per 3D point  (512-dim, CLIP space)
       |
  cosine_sim( F_p^{2D}, CLIP_TextEncoder(query) )  ->  open-vocab score
```

LSeg adds a spatial regularization block on top of a ViT image encoder, trained contrastively so pixel embeddings align to text class embeddings; zero-shot at test time by changing the text label set. OpenSeg proposes segmentation masks first, then aligns each caption word to predicted masks; it achieves +19.9 mIoU over LSeg on PASCAL and is better on rare classes — OpenScene uses OpenSeg as its stronger 2D backbone.

### 3D-Distilled Variant (deployable; LiDAR-only at inference)

```
[Point cloud: xyz + color, voxelized]
       |
  MinkowskiNet14D  (sparse 3D UNet; 8 sparse ResNet blocks)
       |
  F_p^{3D}  per 3D point  (512-dim, CLIP space)
       |
  cosine_sim( F_p^{3D}, CLIP_TextEncoder(query) )  ->  open-vocab score
```

MinkowskiNet14D is trained with a cosine-distance feature-imitation (knowledge distillation) loss against the 2D-fused teacher features:

```
L = 1 - cosine_sim( F^{3D}(p), F^{2D}(p) )
```

No labels. No classification head. The 3D network learns to reproduce the CLIP-aligned feature at every point.

### 2D–3D Ensemble at Inference

Both feature sets are computed independently. Per-point similarity score vectors (one score per candidate label) are averaged across the two variants before argmax. No additional learned parameters.

## Complexity and Compute

| Aspect | Value / Notes |
|---|---|
| **3D-distilled training cost** | ~4 days on 2× RTX 4090; no 3D labels required |
| **Optimizer** | AdamW, initial LR 0.1 |
| **Augmentations (spatial)** | Elastic distortion, horizontal flip, random translation/rotation |
| **Augmentations (photometric)** | Chromatic auto-contrast, color translation/jitter, hue-saturation translation |
| **2D-fused inference cost** | Proportional to scene size × number of input frames × LSeg/OpenSeg forward pass per frame; GPU-intensive for large scenes |
| **3D-distilled inference cost** | Single MinkowskiNet14D forward pass per point cloud; fast |
| **Ensemble inference cost** | Requires both paths; images must be available at runtime |
| **CLIP-dim feature storage** | 512 floats (float32: 2 KB) per point; for a 100 M-point airport apron map, this is ~200 GB of stored features — a real engineering constraint |
| **RegionPLC comparison** | RegionPLC requires only 5% of OpenScene's storage and 17% of its training compute |

## Training Recipe

### 3D-Distilled Variant

The 3D-distilled variant is the only variant that requires training; the 2D-fused variant is entirely training-free.

- **Teacher:** Pre-computed 2D-fused features `F^{2D}` generated from frozen LSeg or OpenSeg on multi-view RGB-D scans (ScanNet, Matterport3D, Replica provided in the repo).
- **Student:** MinkowskiNet14D initialized from scratch; takes voxelized point cloud (xyz + color) as input.
- **Loss:** Cosine-distance imitation: `L = 1 - cosine_sim(F^{3D}(p), F^{2D}(p))`, averaged over all points in the batch. No cross-entropy, no label supervision.
- **Optimizer:** AdamW, initial LR 0.1.
- **Schedule:** Not specified in the paper; training converges in ~4 days on 2× RTX 4090.
- **Spatial augmentations:** Elastic distortion, horizontal flip, random translation and rotation.
- **Photometric augmentations:** Chromatic auto-contrast, color translation/jitter, hue-saturation translation.
- **Pretrained checkpoints:** Available from the GitHub repo for ScanNet, Matterport3D, and Replica — enabling direct deployment without retraining on target-domain data (with the caveat that domain gap must be assessed).

### 2D-Fused Variant

Training-free: LSeg and OpenSeg are used as frozen pre-trained models; no gradient update occurs. The open-vocabulary capability is entirely a consequence of the CLIP feature-space design.

## Benchmark Results

**Caveat:** Open-vocabulary 3D segmentation benchmarks are still evolving as of 2025–2026. Evaluation protocols differ substantially across papers — held-out class count, seen vs. unseen splits, full dataset vs. subset — making cross-paper comparison unreliable. Treat the numbers below as approximate reference points, not absolute rankings.

### Annotation-Free Semantic Segmentation (all 20 classes, reported by GGSD 2024)

| Method | ScanNet mIoU | ScanNet mAcc |
|---|---|---|
| OpenScene (2D–3D ensemble) | 54.2 | 66.6 |
| OpenScene (3D-distilled only) | 52.9 | 63.2 |
| RegionPLC CVPR 2024 (SparseUNet32) | ~59.6 | — |
| GGSD ECCV 2024 | 56.5 | 68.6 |

Closed-set supervised methods (PTv3, MinkUNet) achieve 70–80 mIoU on the same data. OpenScene is a supplement to closed-set segmentation, not a replacement.

### nuScenes (reported by GGSD 2024)

| Method | nuScenes mIoU | nuScenes mAcc |
|---|---|---|
| OpenScene (2D–3D ensemble) | 42.1 | 61.8 |
| OpenScene (3D-distilled only) | 42.9 | 57.1 |
| GGSD ECCV 2024 | 46.1 | 59.2 |

### Matterport3D — Vocabulary-Scale Degradation (reported by GGSD 2024)

| Classes evaluated | OpenScene (3D-distilled) mIoU |
|---|---|
| 21 classes | 36.0 |
| 160 classes | ~6.0 |

This is the most important number for long-tail deployment planning: **performance degrades from 36.0 to ~6.0 mIoU as the class count scales from 21 to 160**. The CLIP/LSeg embedding space conflates visually similar but semantically distinct sub-categories at fine granularity.

### Attribute Understanding (OpenScan benchmark, AAAI 2026)

| Method | mIoU | mAcc |
|---|---|---|
| OpenScene | 0.45 | 1.87 |

Near-zero performance on abstract attribute queries (texture, function, affordance). CLIP features encode category identity, not fine-grained attributes. This is a hard ceiling for any CLIP-feature-based method on attribute queries.

### Lighting Robustness (OSMa-Bench 2025)

- OpenScene average f-mIoU on ReplicaCAD: 0.478 — "the most stable method among those tested" across lighting conditions.
- Stability is a byproduct of CLIP pre-training on internet-scale diverse images.

### Zero-Shot on ScanNet Held-Out 4-Class Subset (original paper protocol)

| Method | mIoU (4-class held out) |
|---|---|
| 3DGenZ | 7.7 |
| MSeg Voting | 53.4 |
| OpenScene (LSeg variant) | ~62.8 |
| OpenScene (OpenSeg variant) | ~51.2 |

Note: these are over 4 unseen classes, not all 20. This is a favorable evaluation protocol; results do not generalize to full-vocabulary performance.

## Variants and Lineage

OpenScene sits at the origin of the open-vocabulary 3D segmentation lineage. The full progression:

```
LSeg (ICLR 2022) + OpenSeg (ECCV 2022) + CLIP (2021)
         |
   OpenScene (CVPR 2023)   <- first open-vocab 3D seg; 2D feature lifting; canonical baseline
         |
   PLA (CVPR 2023)          concurrent; caption-based 3D-language learning (no direct feature lifting)
         |
   RegionPLC (CVPR 2024)   region-level pairs; 17% training cost; 5% storage; +17.2% semantic
   GGSD (ECCV 2024)         geometry-guided superpoints fix 2D teacher noise; EMA voting
   OpenMask3D (NeurIPS 2023) extends to instance segmentation
         |
   Mosaic3D (CVPR 2025)    foundation model; 5.6 M mask-text pairs; SOTA across benchmarks
```

| Method | Year | Vocab | Key idea | mIoU vs. OpenScene |
|---|---|---|---|---|
| LSeg | 2022 | Open (CLIP) | Dense pixel-CLIP alignment | — (2D predecessor) |
| OpenSeg | 2022 | Open (CLIP) | Mask-caption CLIP alignment; +19.9 over LSeg | — (2D predecessor) |
| **OpenScene** | **2023** | **Open (CLIP)** | **2D feature lifting to 3D; feature imitation** | **baseline** |
| PLA | 2023 | Open (CLIP) | 3D-caption contrastive learning | ~comparable |
| RegionPLC | 2024 | Open (CLIP) | Region-level; plug-in on OpenScene | +17.2% semantic |
| GGSD | 2024 | Open (CLIP) | Superpoint geometry-guided distillation | +3.6% ScanNet |
| Mosaic3D | 2025 | Open (VLM-rich) | VLM captioning + mask lifting; 5.6 M pairs | SOTA |

## Strengths

1. **No labeled 3D data required.** The open-vocabulary query capability requires zero 3D annotations — a fundamental advantage over closed-set methods where every category must be labeled.
2. **Training-free 2D-fused variant.** New frozen 2D backbones can be substituted immediately. No retraining when the vocabulary changes or a better CLIP model is released.
3. **Truly open vocabulary.** Text queries are arbitrary: "fuel hose nozzle," "reflective vest," "hydraulic arm," "ground support equipment." CLIP's embedding space supports semantic similarity, not only exact class match.
4. **Multi-attribute coverage in a single model.** Objects, materials, affordances, activities, and zone types can all be queried from the same set of per-point features — no multi-head or multi-taxonomy overhead.
5. **LiDAR-only inference path.** The 3D-distilled variant deploys on bare point clouds at inference — no cameras needed. This matters for night scans, LiDAR-only survey vehicles, and onboard AV pipelines.
6. **Relative lighting robustness.** CLIP pre-training on internet-scale images imparts stability to lighting variation (OSMa-Bench 2025: most stable method tested).
7. **Plug-and-play baseline.** RegionPLC, GGSD, and other follow-ups improve OpenScene's 3D-distilled features without replacement — the distilled model functions as an initialization or auxiliary teacher for downstream methods.

## Failure Modes

1. **Inherits 2D model failures.** The most fundamental limitation: LSeg/OpenSeg suffer from occlusion, lighting artifacts, and perspective distortion. These errors propagate directly into the 3D features during distillation. GGSD (ECCV 2024) is explicit: OpenScene "basically imitates the 2D models and inherits their limitations."
2. **Long-tail and fine-grained vocabulary degradation.** Matterport3D falls from 36.0 to ~6.0 mIoU as class count grows from 21 to 160. On ScanNet200 (198 fine-grained classes) performance degrades substantially. CLIP/LSeg conflates visually similar sub-categories.
3. **Near-zero attribute understanding.** On OpenScan abstract attributes (texture, function, affordance): 0.45 mIoU, 1.87 mAcc. CLIP encodes category identity, not fine-grained attributes — a hard ceiling for attribute queries.
4. **2D-fused variant requires camera coverage.** Multi-view RGB-D coverage of every 3D point is mandatory for the 2D-fused path. LiDAR-only night maps or single-scan captures cannot use this variant.
5. **Domain-specific terminology outside CLIP's reliable vocabulary.** CLIP was trained on internet images. Terms not well-represented in that distribution — "deboarding stairs," "pushback tug," "catering vehicle," "belt loader" — may produce weak or unreliable embeddings. Empirical evaluation in the target domain is required before deployment.
6. **Blurry segmentation boundaries.** OpenScene produces a continuous cosine-similarity heatmap, not crisp instance masks. OSMa-Bench (2025): "the quality of the constructed semantic masks is quite poor." Not suitable for tight 3D bounding-box extraction.
7. **High storage cost for large scenes.** 512-dim float32 features per point: ~200 GB for a 100 M-point airport apron map. RegionPLC requires only 5% of OpenScene's storage. Prohibitive for km-scale outdoor aggregated maps without compression.
8. **Ensemble variant requires images at inference.** The strongest 2D–3D ensemble requires LSeg/OpenSeg on all input images at inference — GPU-intensive and slow. Downstream methods (GGSD, FOLK) explicitly drop the ensemble for this reason.
9. **Not a closed-set replacement.** ScanNet annotation-free: OpenScene 54.2 mIoU vs. closed-set PTv3/MinkUNet 70–80 mIoU. Open-vocab capability trades segmentation precision for vocabulary flexibility.

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV (offline map labelling) | conditional | Long-tail safety net for unknown objects; 3D-distilled variant deployable on LiDAR-only maps; storage cost per km² must be planned |
| Road AV (online, on-vehicle) | low | Inference latency of 2D-fused path unsuitable for real-time; 3D-distilled is feasible but open-vocab adds little to well-covered road taxonomy |
| Airside (offline survey maps) | conditional | High-value for GSE long-tail queries; 2D-fused requires camera-equipped MLS; 3D-distilled needs airside fine-tuning; domain-specific GSE terms need vocabulary validation |
| Warehouse / indoor | good | Closest to ScanNet/Matterport3D training distribution; indoor RGB-D workflow matches 2D-fused requirements; strongest transfer fidelity |
| Port / logistics yard | conditional | Similar to airside; industrial outdoor scale; camera-LiDAR survey feasible; CLIP vocabulary coverage of port equipment uncertain |
| Mining / construction | low-conditional | Open-air, highly variable geometry; extreme domain gap from indoor training; custom equipment vocabulary likely outside CLIP's reliable range without fine-tuning |
| Environment mapping (urban 3D reconstruction) | conditional | Text-queryable survey maps for urban elements; 2D-fused variant integrates well with camera+LiDAR MLS survey; storage cost is a constraint |

## Aggregated-Map Suitability

**Pattern: LONG-TAIL SAFETY NET complementing the closed-set primary.**

The recommended integration for any aggregated semantic map pipeline is a two-tier architecture:

```
Primary: PTv3 / MinkUNet closed-set segmentation
   -> high-confidence labeled points (known taxonomy)
   -> low-confidence / unknown points flagged

Secondary: OpenScene open-vocab cross-check (on flagged points only)
   -> text query: "unusual ground equipment," "debris," "obstacle"
   -> cosine similarity heatmap -> operator review queue
```

This preserves the speed and boundary precision of the closed-set model while adding qualitative text-search for the long tail — without retraining when new equipment types appear on the apron.

**2D-fused variant requirements:** Registered RGB frames covering the survey area are mandatory. Multi-view camera + LiDAR MLS survey workflow is required. Night surveys or LiDAR-only scans must fall back to the 3D-distilled variant.

**3D-distilled variant requirements:** The distilled model must be trained on point clouds from the target environment. ScanNet-trained weights deployed on outdoor airside maps involve substantial domain gap — open-air geometry, vehicle-scale objects, flat surfaces, and sparse long-range returns differ from dense indoor scans. Fine-tuning or re-distilling on airport-domain scan data is recommended before deployment.

**Airside vocabulary adaptation:** Open-vocab queries for well-represented CLIP categories (vehicles, cones, stairs, fences) will transfer reasonably. Domain-specific GSE subtypes — "pushback tug," "belt loader," "GPU cable," "catering vehicle" — may produce unreliable embeddings. Validate query discriminability empirically before relying on results for safety-critical flagging. CLIP fine-tuning on aviation-domain image-text pairs (IATA/ICAO ontology prompt-engineering or adapter fine-tuning) is the recommended mitigation.

**Storage engineering note:** For km-scale airside maps at production point density, pre-computing and storing 512-dim float32 features per point is prohibitive without compression. Options include: (a) quantizing to float16 or int8; (b) computing features on-demand for flagged regions only; (c) replacing with RegionPLC's region-level features (5% storage of OpenScene); (d) using Mosaic3D's compressed mask-level features for offline map queries.

## Implementation Notes

- Use OpenSeg rather than LSeg as the 2D backbone — it is consistently stronger on long-tail and rare classes; OpenScene's best published numbers use OpenSeg.
- Pre-compute and cache `F^{2D}` teacher features before starting 3D distillation training — the 2D forward passes are the bottleneck, and caching avoids repeated computation.
- Apply a minimum-visibility filter (point visible in ≥ 2 frames with confidence above threshold) before aggregation; single-view features from near-grazing projections introduce high noise.
- For airside vocabulary validation: prepare a fixed probe set of text queries for known GSE types and measure cosine-similarity score distributions against labeled point clouds before deploying as a safety net.
- Test prompts at multiple granularities: "vehicle," "ground vehicle," "airport ground vehicle," "belt loader" — cosine similarity varies with prompt specificity, and CLIP's embedding space is not monotonic with specificity level.
- Integrate downstream into active-learning pipelines: use low-confidence open-vocab regions (all candidate labels below a similarity threshold) to surface novel object candidates for human review.
- For closed-set fine-tuning, the 3D-distilled features can serve as initialization for a supervised segmentation head — this is the RegionPLC plug-in pattern; it combines open-vocab feature quality with closed-set precision.
- Pretrained checkpoints for ScanNet, Matterport3D, and Replica are available from the GitHub repo; use these as a starting point for distillation on domain-specific scan data rather than training from scratch.
- Track semantic and instance metrics separately — OpenScene's semantic heatmaps are not instance-segmented; adjacent same-class objects merge. Do not use raw OpenScene output for instance-level safety checks.

## Sources

- arXiv paper: https://arxiv.org/abs/2211.15654
- CVPR 2023 open access: https://openaccess.thecvf.com/content/CVPR2023/html/Peng_OpenScene_3D_Scene_Understanding_With_Open_Vocabularies_CVPR_2023_paper.html
- Project page: https://pengsongyou.github.io/openscene
- GitHub repository: https://github.com/pengsongyou/openscene
- CVPR 2023 poster: https://cvpr.thecvf.com/virtual/2023/poster/22442
- MPI-IS publication page: https://is.mpg.de/publications/pengscvpr23
- LSeg (predecessor, ICLR 2022): https://arxiv.org/abs/2201.03546
- OpenSeg (predecessor, ECCV 2022): https://arxiv.org/abs/2112.12143
- PLA (contemporaneous, CVPR 2023): https://arxiv.org/abs/2211.16312
- RegionPLC (follow-up, CVPR 2024): https://arxiv.org/abs/2304.00962
- GGSD (follow-up, ECCV 2024): https://arxiv.org/html/2407.13362v1
- Mosaic3D (current SOTA, CVPR 2025): https://arxiv.org/abs/2502.02548
- OSMa-Bench lighting robustness (2025): https://arxiv.org/html/2503.10331v1
- OpenScan attribute benchmark (AAAI 2026): https://arxiv.org/html/2408.11030v4
- Related repository page: `../overview/aggregated-map-semantic-segmentation.md` — §6 class taxonomies (open-vocab as long-tail safety net); §7.6 pre-training; §13 evaluation
- Related repository page: `../overview/3d-segmentation-class-taxonomy-design.md` — open-set / unknown class handling
- Related repository page: `../overview/open-vocab-detection.md`
- Modern open-vocab successor: `./mosaic3d.md` — Mosaic3D (CVPR 2025); supersedes OpenScene on all reported benchmarks
- Image-to-LiDAR distillation sibling: `./2dpass.md` — 2DPASS; same distillation-from-2D pattern applied to closed-set segmentation
