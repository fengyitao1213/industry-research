# Point-Cloud Mamba / SSM Backbones

<!-- method-priority:start
priority:
  learning: 4
  deployment: 3
  type: "method-family"
  stage: "frontier"
  maturity: "research"
  tags: ["perception", "lidar", "segmentation", "mapping", "outdoor"]
  reason: "Emerging linear-complexity SSM backbones for large point-cloud segmentation and map-scale labeling, with limited production evidence."
method-priority:end -->

## What It Is

Point-cloud Mamba / state-space-model (SSM) backbones adapt the selective state-space sequence model family to unordered 3D point clouds. The shared pattern is:

1. Serialize a point cloud into one or more 1D point sequences using a spatial ordering rule.
2. Run Mamba/SSM blocks over the sequence to model long-range dependencies with roughly linear token complexity.
3. Add local geometry modules, multi-order scans, pooling, or bidirectional passes to compensate for the fact that raw SSMs are sequence models, not native geometric operators.
4. Decode per-point or per-voxel semantic labels for segmentation, part segmentation, instance segmentation, or classification.

This page is about **semantic-segmentation backbones** for LiDAR and aggregated point-cloud maps. It is not the same as [MambaMOS](mambamos.md), which applies Mamba-style temporal modeling to moving-object segmentation, and it is not a replacement for map-cleaning pages such as [LiDAR Map Cleaning and Dynamic Removal](../../localization-mapping/slam-methods/lidar-map-cleaning-dynamic-removal.md).

## Why It Matters for Aggregated LiDAR Maps

An aggregated map segmentation pipeline is dominated by token count. A registered urban district, airport apron, logistics yard, or campus map can contain 100 million to 1 billion points before downsampling. Tiling solves the memory problem outside the model, while SSM backbones attack the cost inside the model by reducing dependence on quadratic attention over large token windows.

The practical attraction is not that SSMs are already the safest production default. The attraction is that they offer a credible efficiency frontier:

- Larger tiles or halos may fit in the same GPU memory, reducing stitching artifacts.
- Long-range context can span larger static structures: building facades, kerbs, fences, vegetation rows, rail/platform edges, aircraft stands, or yard boundaries.
- Map-scale non-road environments can benefit from context beyond a road-lane frame, especially where "drivable", "walkway", "service lane", "loading zone", "vegetation", and "temporary equipment" are visually and geometrically adjacent.
- A LiDAR-only pipeline can evaluate SSMs without requiring camera calibration, while LiDAR-plus-image pipelines can add image-derived features before serialization.

Treat the family as **P3/P4 architecture research** today: useful for benchmark experiments and cost-reduction studies, not a substitute for a sparse-conv, KPConv/RandLA-Net, Superpoint Transformer, or PTv3 baseline in a first deployment.

## Core Technical Pattern

### Serialization

Mamba expects an ordered sequence. Point clouds are unordered. Every point-cloud SSM method therefore defines a serialization strategy:

- **Space-filling curves:** Morton/Z-order, Hilbert, or related curves preserve approximate spatial locality after voxel quantization.
- **Octree ordering:** points are sorted through an octree or z-order path to satisfy the causal ordering assumptions of SSM blocks while retaining local neighborhoods.
- **Consistent traverse serialization:** multiple `x/y/z` traversal orders produce several sequences from the same cloud; the model learns across the set rather than trusting one brittle ordering.
- **Multi-path serialization:** several orderings are used in parallel or across layers to reduce directional artifacts.

The design question is not "which ordering is correct". The deployment question is "which ordering gives stable labels under rotation, density variation, and tile-boundary overlap".

### Local-Global Blocks

Raw SSM layers are strong at long sequence modeling but weak at local 3D geometry unless augmented. Point-cloud SSM papers add:

- local pooling or local-norm pooling for near-neighbor shape cues;
- sparse/depthwise convolution before or inside SSM blocks;
- bidirectional scans or channel-reverse scans to reduce one-way causal bias;
- hierarchical grid pooling to handle segmentation-resolution pyramids;
- conditional positional encoding or coordinate embeddings to keep absolute and relative spatial information available.

This mirrors the PTv3 lesson: sequence modeling alone is not enough. The winning model is usually a serialization strategy plus a local geometry operator plus a decoder that preserves point-level detail.

## Representative Architectures

| Method | Main idea | Evidence signal | Map-pipeline interpretation |
|---|---|---|---|
| **PointMamba** | Space-filling-curve point tokenization plus a simple non-hierarchical Mamba encoder. | NeurIPS 2024; reports lower FLOPs/memory than transformer alternatives across point-cloud tasks; official repository updated in 2025. | Useful as the clean baseline for "SSM instead of attention" experiments, but not yet a complete map-scale production recipe. |
| **Point Mamba** | Octree / z-order causality-aware ordering over irregular points. | Reports 75.7 mIoU on ScanNet semantic segmentation and released ScanNet segmentation code/checkpoints. | Strongest source for how ordering choices affect semantic segmentation rather than only classification. |
| **Point Cloud Mamba (PCM)** | Consistent traverse serialization with six coordinate-order variants, point prompts, and coordinate positional encoding. | Official code and weights available; reports strong classification, part segmentation, and S3DIS segmentation results. | Good design reference for multi-order robustness and for checking whether a single serialization is too brittle. |
| **Mamba3D** | Local Norm Pooling plus bidirectional SSM to strengthen local geometry and global features. | ACM MM 2024; official code and weights available for classification/part-style tasks. | Useful evidence that local geometry modules are mandatory; less directly map-segmentation-focused than Pamba or Serialized Point Mamba. |
| **Pamba** | Multi-path serialization plus ConvMamba block for local geometry and bidirectional/global interaction. | AAAI 2025; reports results on ScanNet v2, ScanNet200, S3DIS, and nuScenes. | Most relevant to road-scale LiDAR semantic segmentation among the family; still needs map-scale and non-road validation. |
| **Serialized Point Mamba** | Staged point-cloud sequence learning, grid pooling, and conditional positional encoding for semantic and instance segmentation. | Reports ScanNet/S3DIS semantic segmentation and ScanNetv2 instance segmentation metrics with low latency relative to other Mamba segmentation variants. | Best fit when the pipeline needs an encoder-decoder segmentation model rather than a classification backbone. |
| **PoinTramba** | Hybrid Transformer-Mamba model: Transformer groups capture intra-group detail; Mamba handles inter-group context with bidirectional importance-aware ordering. | Reports classification/part-analysis results on ScanObjectNN, ModelNet40, and ShapeNetPart with public code link in the paper. | Useful caution: pure SSM blocks often need attention/local modules for fine geometry; less directly semantic-map focused. |
| **Spectral Informed Mamba** | Graph-Laplacian spectral traversal and MAE token placement for robust point-cloud Mamba pre-training and segmentation. | CVPR 2025; reports classification, segmentation, and few-shot improvements. | Relevant to label-efficient map segmentation research because it attacks traversal robustness and self-supervised pre-training, but not yet AV-map-release evidence. |
| **Urban-scale PointMamba** | Applies PointMamba-style SSM segmentation to mobile laser scanning urban scenes. | 2025 ICA proceedings paper reports Toronto3D overall accuracy 93.94% and mIoU 66.03%. | Early urban-district proxy evidence: closer to non-road map labeling than indoor-only benchmarks, but still not a production AV map-release study. |

## Inputs and Outputs

| Interface | Expected contract |
|---|---|
| Input geometry | Registered point cloud tile, single scan, or point/voxel block with `x, y, z`; optional intensity, elongation, timestamp/sweep id, height above ground, return number, or normal/curvature features. |
| Optional image features | Camera-derived semantic embeddings can be projected onto points before serialization, but most cited SSM papers are LiDAR/point-cloud-first rather than image-fusion-first. |
| Labels | Per-point semantic class; sometimes instance labels or part labels depending on decoder. For map work, labels should be converted into persistent map layers only after confidence, temporal consistency, and map-cleaning gates. |
| Output artifact | Point/voxel logits, class probabilities, uncertainty proxy, serialized-order metadata, tile id, model/checkpoint id, and post-processing status. |
| Downstream consumers | Aggregated-map semantic layer, map QA dashboard, static/transient removal review, detector auto-label loop, and validation evidence case. |

## Training and Evaluation Fit

Point-cloud SSMs can use the same training paradigms as other 3D segmentation backbones:

- **Fully supervised:** easiest to reproduce; suitable for ScanNet/S3DIS/SemanticKITTI/nuScenes-style baselines and for first site-specific experiments.
- **Multi-dataset pre-training:** promising but immature for SSMs compared with PTv3/PPT/Sonata ecosystems.
- **Self-supervised pre-training:** conceptually attractive because Mamba handles long sequences, but no point-cloud SSM currently has the same mature, broadly validated pre-training stack as PTv3 + Sonata.
- **Image-to-LiDAR distillation:** possible by appending image-derived point features before serialization, but evidence is stronger for 2DPASS, SLidR, ScaLR, Seal, and PTv3/WaffleIron-style students.
- **Weak/semi-supervised:** useful for rare non-road classes, but the SSM backbone does not remove the need for pseudo-label quality gates.

For a professional aggregated-map pipeline, compare SSMs against:

| Family | Advantage over SSMs today | SSM advantage to test |
|---|---|---|
| Sparse-conv U-Net / MinkowskiNet | Mature tooling, fielded pattern, predictable map-scale deployment. | Longer context per memory budget if serialization is stable. |
| KPConv / RandLA-Net | Strong geometry priors and survey-industry precedent. | More global context without expensive neighbor graphs. |
| Point Transformer V3 | Stronger ecosystem, PTv3-Extreme, PPT, Sonata, and challenge evidence. | Linear sequence modeling may reduce the tile-size pressure of large attention windows. |
| Superpoint Transformer | Whole-scene graph context and tiny memory footprint. | Avoids superpoint partition dependence and can stay closer to raw points. |
| Projection models / WaffleIron | Simple kernels and edge-friendly deployment. | Preserves more 3D structure than repeated 2D projection if serialization is robust. |

## Architecture Guidance for Aggregated-Map Segmentation

Use SSM backbones as a candidate branch in the architecture, not as the only path:

1. **Baseline first:** establish sparse-conv, KPConv/RandLA-Net, SPT, or PTv3 reference numbers on the same map tiles and class taxonomy.
2. **Tile with stable serialization:** keep tile coordinates local, quantize consistently, store serialization curves/order ids, and evaluate multiple orderings under rotation and density changes.
3. **Keep halos larger than the SSM receptive artifact scale:** a linear model can process long sequences, but boundary artifacts still happen when a facade, fence, or lane-edge sequence is cut.
4. **Run per-class error audits:** SSMs can look good on large "stuff" classes while missing thin objects such as poles, signs, rails, bollards, hydrants, tow bars, or temporary barriers.
5. **Separate map cleaning from map labeling:** do not let the segmenter delete stationary people, parked vehicles, movable barriers, or equipment from the persistent map. Route those labels through the static/transient review and map-version-control flow.
6. **Treat images as optional training signals:** project camera features into points only when calibration quality is proven. For LiDAR-only deployments, evaluate whether SSM gains persist without RGB.
7. **Publish reproducible artifacts:** checkpoint, serialization config, tile manifest, dataset split, label map, post-processing version, and confidence calibration must travel with the map release.

## Failure Modes

| Risk | Why it matters | Mitigation |
|---|---|---|
| Serialization bias | One ordering can create artificial neighbors and split true neighbors at sequence boundaries. | Test multiple curves/orders; use rotation augmentation; compare per-class stability across orderings. |
| Local detail loss | SSM global context may blur small objects if local geometry modules are weak. | Add local pooling/sparse-conv blocks; audit thin and rare classes separately. |
| Tile-boundary seams | Long sequence context does not eliminate map tiling artifacts. | Use overlap, no-clipping-point policy, logit averaging, and boundary-specific QA. |
| Density shift | MLS, ALS, handheld, and vehicle LiDAR produce different density/noise patterns. | Normalize density, include sensor-source features only when intended, and validate per source. |
| Overclaiming production readiness | Most evidence is research benchmark evidence, not AV map-release evidence. | Keep as experimental branch until map QA, field review, and safety validation match mature baselines. |
| Static-transient confusion | Stationary people, parked vehicles, carts, cones, and temporary work zones can be labeled as persistent map classes. | Couple with [Static-But-Transient Point Removal](../overview/static-but-transient-point-removal.md) and versioned map review gates. |

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV | Conditional | Pamba includes nuScenes-style evidence, but runtime, calibration, and map-release artifacts still need stack-specific validation. |
| Urban district / campus / non-road public space | Conditional | Urban-scale PointMamba on Toronto3D is directly relevant as a proxy; validate curbs, plazas, vegetation, facades, stairs, service roads, and pedestrian-heavy zones. |
| Airside | Weak-to-conditional | Geometry transfers, but no public airside SSM segmentation benchmark exists; rare GSE, jet bridge, aircraft, FOD, cone, and stand-marking classes need targeted data. |
| Warehouse / logistics yard / port | Conditional | Long-range context may help racks, containers, trailers, barriers, and loading zones; dynamic/static object separation remains a separate map-cleaning problem. |
| Mining / construction / agriculture | Insufficient evidence | Large outdoor point clouds fit the efficiency argument, but terrain deformation, dust, vegetation, and unstructured classes need dedicated validation. |

## Readiness Verdict

Point-cloud SSM backbones are worth tracking because they attack the map-scale token-cost problem directly. They are not yet the default architecture for an end-to-end semantic map pipeline. A professional evaluation should position them as an experimental branch beside PTv3/SPT/sparse-conv baselines, then decide with:

- class-balanced mIoU and boundary F1;
- rare/thin-object recall;
- per-domain confusion matrices for non-road urban classes;
- tile-seam rate and overlap disagreement;
- inference cost per square kilometer or per 100 million points;
- calibration/uncertainty quality;
- map-release artifact completeness.

## Sources

- PointMamba, "PointMamba: A Simple State Space Model for Point Cloud Analysis", NeurIPS 2024: https://arxiv.org/abs/2402.10739
- PointMamba official repository: https://github.com/LMD0311/PointMamba
- Point Mamba, "A Novel Point Cloud Backbone Based on State Space Model with Octree-Based Ordering Strategy": https://arxiv.org/abs/2403.06467
- Point Mamba official repository: https://github.com/IRMVLab/Point-Mamba
- Point Cloud Mamba, "Point Cloud Learning via State Space Model": https://arxiv.org/abs/2403.00762
- Point Cloud Mamba official repository: https://github.com/SkyworkAI/PointCloudMamba
- Mamba3D, "Enhancing Local Features for 3D Point Cloud Analysis via State Space Model", ACM MM 2024: https://arxiv.org/abs/2404.14966
- Mamba3D official repository: https://github.com/xhanxu/Mamba3D
- Pamba, "Enhancing Global Interaction in Point Clouds via State Space Model", AAAI 2025: https://arxiv.org/abs/2406.17442
- Pamba AAAI proceedings record: https://ojs.aaai.org/index.php/AAAI/article/view/32540
- Serialized Point Mamba, "A Serialized Point Cloud Mamba Segmentation Model": https://arxiv.org/abs/2407.12319
- PoinTramba, "A Hybrid Transformer-Mamba Framework for Point Cloud Analysis": https://arxiv.org/abs/2405.15463
- Spectral Informed Mamba, CVPR 2025: https://openaccess.thecvf.com/content/CVPR2025/html/Bahri_Spectral_Informed_Mamba_for_Robust_Point_Cloud_Processing_CVPR_2025_paper.html
- Urban-scale PointMamba / Toronto3D MLS segmentation proxy: https://ica-proc.copernicus.org/articles/7/16/2025/
