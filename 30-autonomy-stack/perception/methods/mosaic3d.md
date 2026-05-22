# Mosaic3D

<!-- method-priority:start
priority:
  learning: 3
  deployment: 3
  type: "method-family"
  stage: "frontier"
  maturity: "research"
  tags: ["perception", "validation", "data-engine", "road-av", "mapping"]
  reason: "Mosaic3D is rated for open-vocabulary 3D segmentation, dataset leverage, and long-tail perception validation."
method-priority:end -->

## What It Is

- Mosaic3D is both a foundation dataset and a foundation model for open-vocabulary 3D segmentation, published as "Mosaic3D: Foundation Dataset and Model for Open-Vocabulary 3D Segmentation" (CVPR 2025, NVIDIA).
- The dataset — **Mosaic3D-5.6M** — contains 30 000+ annotated scenes and 5.6 million mask-text pairs, far exceeding prior open-vocabulary 3D datasets in scale.
- The model supports open-vocabulary 3D semantic segmentation and 3D instance segmentation: at query time, a natural-language description specifies the target class rather than a fixed integer label.
- Primary benchmarks are indoor RGB-D scenes (ScanNet200, Matterport3D, ScanNet++); outdoor LiDAR adaptation is not characterised in the paper.
- For AV map labelling, the most relevant contribution is the **automated data generation pipeline**: it can bootstrap labelled 3D mask-text data for new environments and class taxonomies without manual point-cloud annotation.

## Core Technical Idea

The central problem Mosaic3D addresses is the **3D annotation bottleneck** for open-vocabulary segmentation: existing 3D mask-text datasets are small (hundreds of scenes, tens of thousands of masks) compared to billion-scale 2D image-text datasets. Manual 3D annotation is 10–100× more expensive per scene than 2D annotation.

The solution is a three-stage automated pipeline:

1. **2D open-vocabulary segmentation:** Apply 2D foundation models (SAM for masks, CLIP for semantics) to every RGB frame in a multi-view scan, producing precise per-frame 2D region masks with class-agnostic boundaries.
2. **VLM captioning:** For each 2D region mask, a region-aware vision-language model generates a text description — not just a class name, but a rich natural-language label (e.g. "a stainless steel sink with a single faucet" vs. simply "sink"). This produces semantically rich supervision that spans arbitrary vocabulary.
3. **Mask lifting to 3D:** The per-frame 2D mask-text pairs are back-projected into 3D using camera geometry (intrinsics + poses). Multiple views of the same 3D region are fused to consolidate a single 3D mask with an aggregated text label. The result is a `(3D mask, text description)` pair for each semantic region in the scene.

This pipeline generates Mosaic3D-5.6M automatically from existing 3D scene collections — the only human involvement is validating the source 3D scan poses, not labelling masks.

## Data Pipeline in Detail

### Stage 1 — 2D Mask Generation

SAM (Segment Anything Model) produces class-agnostic masks on each RGB frame. The masks are dense (all visible regions are segmented, not just known categories), giving full-scene coverage without a fixed taxonomy.

### Stage 2 — Text Assignment via Region-Aware VLM

Each 2D mask is cropped and passed to a region-aware VLM (e.g. GPT-4V, LLaVA, or similar) with a prompt that asks for a descriptive label. The VLM has visual context for the masked region and surrounding scene, producing descriptions at multiple granularities:

- Coarse: "chair"
- Fine: "office chair with padded armrests and five-star base"
- Functional: "seating area near window"

The multi-granularity descriptions are all stored as text candidates per mask, enabling multi-scale query resolution at inference.

### Stage 3 — Multi-View Fusion to 3D

For a scene with `V` camera views, a 3D point (or voxel) `p` may be visible in `n_p ≤ V` views. Each view contributes a mask membership and text label. The 3D mask for region `r` is constructed as:

```
mask_3D(r) = { p : majority_vote({ mask_2D(r, v) : p visible in view v }) = True }
```

Text labels from multiple views are aggregated (deduplicated, ranked by VLM confidence). The 3D mask-text pair is stored with view-coverage metadata (number of contributing views, coverage fraction) to flag low-confidence regions.

### Dataset Statistics

| Property | Value |
|----------|-------|
| Total scenes | 30 000+ |
| Total mask-text pairs | 5.6 M |
| Scene sources | ScanNet, ScanNet++, Matterport3D (indoor RGB-D) |
| Vocabulary size | Open — arbitrary natural language |
| Prior largest 3D mask-text dataset | ~hundreds of thousands of pairs |

## Model Architecture

The Mosaic3D model has two components:

### 3D Encoder

A point cloud encoder trained with a **language-contrastive objective**: for a 3D mask `m` and its text description `t`, the encoder is trained to maximise the cosine similarity between the 3D mask feature `f_3D(m)` and the CLIP text embedding `f_text(t)`, while minimising similarity to negative text descriptions in the batch:

```
L_contrastive = -log [ exp(sim(f_3D(m), f_text(t)) / τ) /
                       Σ_{t'} exp(sim(f_3D(m), f_text(t')) / τ) ]
```

where `τ` is a temperature parameter and the sum is over all text descriptions in the batch (including negatives). This is a standard InfoNCE / CLIP-style loss applied to 3D features.

The 3D encoder backbone is based on a sparse voxel or point transformer architecture trained from the Mosaic3D-5.6M supervision. The trained encoder produces language-aligned 3D features that can be queried with arbitrary text at inference.

### Mask Decoder

A lightweight mask decoder takes a text query embedding and the 3D encoder features, and produces a binary 3D segmentation mask for the queried concept. It is computationally cheap — the heavy lifting is done by the encoder during pre-training.

### Inference Protocol

At inference time:
1. A text query (e.g. "ground vehicle", "baggage cart", "aircraft tow bar") is embedded with CLIP's text encoder.
2. The 3D encoder processes the point cloud and produces dense language-aligned features.
3. The mask decoder computes similarity between the query embedding and each 3D region's feature, thresholding to produce the segmentation mask.
4. For instance segmentation, the mask decoder produces per-instance masks rather than a single dense map.

No camera is required at inference — the 3D encoder operates on point clouds directly.

## Training Recipe

- **Pre-training data:** Mosaic3D-5.6M mask-text pairs from ScanNet, ScanNet++, Matterport3D.
- **Objective:** InfoNCE contrastive loss between 3D mask features and CLIP text embeddings (see formula above).
- **Text encoder:** Frozen CLIP (ViT-L/14 or similar) throughout pre-training — the 3D encoder learns to match CLIP's embedding space.
- **Augmentation:** Standard 3D augmentations (rotation, jitter, random crop of scene, point dropout). For multi-view consistency, augmentations that break view correspondence (large translations) are excluded during the lifting stage.
- **Fine-tuning for benchmarks:** After contrastive pre-training, a mask decoder is added and the system is fine-tuned end-to-end with segmentation supervision on the target benchmark's train split.
- **Ablations:** The CVPR paper ablates the effect of (a) dataset scale — removing half the scenes degrades mIoU significantly; (b) VLM captioning quality — replacing rich VLM descriptions with simple class names from 2D classifiers reduces open-vocabulary accuracy by several points; (c) multi-view fusion — single-view lifting produces noisier 3D masks.

## Benchmark Results

The paper reports SOTA on multiple open-vocabulary 3D segmentation benchmarks. Precise per-benchmark mIoU numbers are not included in the public abstract; the CVPR 2025 paper states SOTA on:

| Benchmark | Task | Result |
|-----------|------|--------|
| ScanNet200 | Open-vocab semantic segmentation | SOTA (outperforms prior open-vocab methods) |
| Matterport3D | Open-vocab semantic segmentation | SOTA |
| ScanNet++ | Open-vocab semantic segmentation | SOTA |

The scale of Mosaic3D-5.6M relative to prior datasets is the primary differentiator — ablations show that performance scales with dataset size, consistent with the VLM/foundation-model scaling laws.

## Variants and Lineage — Open-Vocabulary 3D Context

Mosaic3D occupies the **open-vocabulary 3D segmentation** niche, which is distinct from the closed-vocabulary (fixed taxonomy) LiDAR segmentation methods in this knowledge base. Its lineage and comparators:

| Method | Vocab | Modality | Scale | Key idea |
|--------|-------|----------|-------|----------|
| OpenMask3D (CVPR 2023) | Open (CLIP) | RGB-D | Small datasets | CLIP feature distillation per 3D instance |
| OpenScene (CVPR 2023) | Open (CLIP) | RGB-D | Moderate | CLIP feature lifting to 3D via multi-view rendering |
| **Mosaic3D (CVPR 2025)** | **Open (VLM-rich)** | **RGB-D → 3D** | **5.6 M pairs** | Automated VLM captioning + mask lifting at scale |
| SAM4D (ICCV 2025) | Class-agnostic + prompt | Camera + LiDAR (4D) | Waymo-4DSeg (45 M masks) | Cross-modal 4D foundation model with temporal memory |

The key distinction from SAM4D is modality: Mosaic3D produces language-aligned 3D features from RGB-D (indoor-focused); SAM4D targets cross-modal camera+LiDAR segmentation in autonomous driving (outdoor, temporal). For airside AV use, SAM4D is more relevant for online multi-modal segmentation, while Mosaic3D's data pipeline is more relevant for offline map labelling.

## Strengths

- Attacks the biggest bottleneck in open-vocabulary 3D segmentation: lack of large mask-text 3D data.
- Uses modern 2D segmentation (SAM) and VLM tools to scale supervision — no manual 3D annotation required for pre-training.
- Rich VLM-generated text descriptions go beyond class names: fine-grained and functional descriptions improve segmentation of visually similar but semantically distinct objects.
- Supports both semantic and instance-level 3D segmentation from the same model.
- Language-aligned 3D features are useful beyond one fixed benchmark label set — new classes are added by querying with new text prompts, no retraining.
- Official NVIDIA research and NVLabs code improve reproducibility.

## Failure Modes

- Automatically generated mask-text pairs contain projection errors (incorrect 3D mask boundaries where 2D masks are imprecise), caption errors (VLM hallucinations), and fusion errors (incorrect multi-view aggregation in textureless regions).
- Indoor scene dominance (ScanNet, Matterport3D) limits direct transfer to outdoor driving or airside LiDAR: point density, scene scale, and object categories differ substantially.
- Text descriptions can be too generic for operationally distinct equipment — a VLM may caption a belt loader and a baggage tug with similar descriptions ("yellow ground vehicle"), degrading discrimination.
- The model assumes sufficient 3D scene coverage to form valid masks; sparse long-range outdoor LiDAR (far-range returns, <1 point/m²) produces noisy 3D masks.
- Open-vocabulary segmentation accuracy depends on prompt wording and CLIP text embedding quality — prompts must be validated on the target class set.
- Dataset licensing and third-party model dependencies (SAM, CLIP, VLM) need review before commercial reuse.

## Aggregated-Map Suitability

**Rating: Indirect (data pipeline applicable; direct model transfer uncharacterised for outdoor LiDAR).**

Mosaic3D's primary value for airside AV maps is not the trained model itself, but the **data generation recipe**:

### Data Pipeline Application to Airside Maps

Airport apron environments contain a long tail of operationally significant object classes — belt loaders, tugs, fuel trucks, catering vehicles, aircraft, jetbridges, ground power units, chocks, cones — that have essentially zero representation in public LiDAR datasets. Manual annotation is expensive and slow. The Mosaic3D pipeline offers a path to bootstrapping labelled data:

1. Collect multi-view RGB imagery and 3D LiDAR scans of the apron during survey sweeps.
2. Apply SAM to RGB frames to generate class-agnostic 2D masks.
3. Apply a VLM (GPT-4V, LLaVA, or aviation-specific fine-tuned model) to generate text labels with an aviation ontology prompt (e.g. "describe this airport ground vehicle in precise operational terms").
4. Lift 2D mask-text pairs to 3D using survey camera poses.
5. Use the resulting 3D mask-text pairs as training supervision for a 3D encoder, or as pseudo-labels for fine-tuning a closed-vocabulary segmenter on airside classes.

This approach is consistent with the broader data-flywheel strategy described in the CLAUDE.md core conclusions: self-supervised pre-training + active learning + a data flywheel cut labelling cost 50–80%.

### Long-Tail and Rare-Class Coverage

For rare airside classes (e.g. aircraft tow bars, ground power unit cables, safety cones in specific configurations), Mosaic3D-style VLM captioning can generate training supervision from a small number of scanned examples — far fewer than required for manual point-by-point annotation. The open-vocabulary formulation means rare class names (including ICAO-standard ground support equipment nomenclature) are handled without dataset restructuring.

### Direct Model Transfer Caveats

Direct deployment of the Mosaic3D model on outdoor LiDAR is not recommended without adaptation:
- The model was trained on indoor RGB-D data; outdoor LiDAR has different point density, range, and clutter characteristics.
- The contrastive objective aligns 3D features to CLIP's image-text embedding space, which is predominantly trained on web images — indoor scenes, consumer objects. Aviation-specific terminology may not align well.
- Adaptation requires: (a) fine-tuning on outdoor LiDAR scan data, (b) validation of VLM caption quality on aviation classes, (c) verification that the text embedding space covers the required class vocabulary.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV (on-vehicle) | low | Model trained on indoor RGB-D; outdoor real-time LiDAR not characterised. Data pipeline applicable for rare road-object bootstrapping. |
| Road AV (offline / maps) | conditional | Data pipeline applicable for long-tail class annotation; model transfer needs outdoor adaptation. |
| Airside | conditional | Data pipeline is high-value for bootstrapping airside class labels; direct model use requires outdoor fine-tuning and aviation-vocabulary validation. |
| Warehouse / port / indoor mapping | good | Closest to the training domain (dense indoor 3D); direct model transfer most credible here. |

## Implementation Notes

- Audit generated captions with an airport ontology (IATA ground support equipment codes, ICAO apron terminology) before using them as training labels — VLM descriptions of aviation equipment are often generic without domain-specific prompting.
- Keep projection confidence and view coverage metadata with each mask-text pair; set minimum-view thresholds (e.g. visible in ≥3 views) to suppress single-view noise.
- Fine-tune or evaluate on sparse outdoor LiDAR separately from dense indoor RGB-D scans — use SemanticKITTI or nuScenes as intermediate bridge datasets before airside adaptation.
- Test text prompts at multiple granularities: "cart", "baggage cart", "ULD dolly", "baggage tug" — the open-vocabulary model's accuracy varies with prompt specificity.
- Track semantic and instance metrics separately; a model with good semantic accuracy can still merge adjacent objects (e.g., two adjacent baggage carts) at the instance level.
- Use Mosaic3D-generated features as candidates for downstream map labelling or active learning selection, not as sole obstacle evidence in safety-critical perception.
- For commercial deployment, review the licensing of SAM (Apache 2.0), CLIP (MIT), and any VLM used in the pipeline — third-party model outputs may have usage restrictions.

## Adaptation Roadmap for Airside Use

Given the indoor-to-outdoor gap, a pragmatic adaptation roadmap for deploying Mosaic3D-derived labels on an airside map:

1. **Collect multi-view RGB + LiDAR scans** of the apron using the survey vehicle (same passes that build the HD map). Ensure camera poses are accurate to < 5 cm for reliable mask lifting.
2. **Run SAM** on all RGB frames to generate class-agnostic 2D masks. Discard masks smaller than a minimum area threshold (e.g. 500 px²) to remove noise.
3. **Run a VLM** (GPT-4V or open-source equivalent, prompted with an IATA/ICAO ground-equipment ontology) on each masked crop. Collect top-3 text candidates per mask with confidence scores.
4. **Lift and fuse to 3D** using the Mosaic3D pipeline. Apply minimum-view filter (≥ 3 views) and flag low-confidence masks for human review.
5. **Validate with domain expert** — review a stratified sample (100–200 masks per class) to correct VLM errors before using as training labels.
6. **Fine-tune** a closed-vocabulary backbone (WaffleIron or 2DPASS 3D branch) on the validated airside mask-text pairs. Treat Mosaic3D encoder features as initialisation or auxiliary supervision.
7. **Iterate** using active learning: query the model on new apron scans, select highest-uncertainty regions for expert review, repeat from step 5.

This roadmap is consistent with the 500–1 000 LoRA/PointLoRA frame estimate for cross-domain transfer cited in the project CLAUDE.md, applied to the airside class set.

## Complementary Methods

Mosaic3D is part of a broader wave of VLM-driven 3D understanding methods. When scoping an open-vocabulary 3D perception system, consider it alongside:

- **SAM4D** (ICCV 2025, `../methods/sam4d.md` if present) — cross-modal foundation model for simultaneous camera+LiDAR segmentation with temporal memory; more relevant for online AV perception than offline map labelling.
- **OpenScene / OpenMask3D** — earlier open-vocabulary 3D methods using CLIP feature lifting; Mosaic3D supersedes them on all reported benchmarks due to dataset scale and VLM caption richness.
- **DITR / D-DITR** — DINOv2-based feature injection/distillation for closed-vocabulary segmentation; different use case (fixed taxonomy, higher benchmark accuracy) but complementary as a closed-vocabulary workhorse alongside Mosaic3D's open-vocabulary labelling pipeline.

For an airside map labelling workflow, the recommended combination is: use the Mosaic3D data pipeline to generate initial mask-text pseudo-labels → filter with an aviation ontology → use pseudo-labels to fine-tune a closed-vocabulary backbone (WaffleIron, 2DPASS, PTv3) → iterate with active learning on high-uncertainty regions.

## Sources

- arXiv paper: https://arxiv.org/abs/2502.02548
- CVPR 2025 paper page: https://openaccess.thecvf.com/content/CVPR2025/html/Lee_Mosaic3D_Foundation_Dataset_and_Model_for_Open-Vocabulary_3D_Segmentation_CVPR_2025_paper.html
- CVPR 2025 paper PDF: https://openaccess.thecvf.com/content/CVPR2025/papers/Lee_Mosaic3D_Foundation_Dataset_and_Model_for_Open-Vocabulary_3D_Segmentation_CVPR_2025_paper.pdf
- NVIDIA Research page: https://research.nvidia.com/labs/twn/publication/cvpr_2025_mosaic3d/
- Official GitHub repository: https://github.com/NVlabs/Mosaic3D
- SAM4D (related cross-modal 4D foundation model): https://arxiv.org/abs/2506.21547
- Related repository page: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline; §7.8 model-family comparison includes open-vocabulary methods
- Related repository page: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation
