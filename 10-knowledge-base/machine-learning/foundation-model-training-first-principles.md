# Foundation Model Training: First Principles

<!-- kb-visual:start -->
![Foundation Model Training: First Principles curated visual](../_assets/visuals/machine-learning-foundation-model-training-first-principles.svg)

*Visual: foundation-model lifecycle from data mixture through tokenization, pretraining objective, optimizer stability, adaptation, evaluation, and contamination control.*
<!-- kb-visual:end -->

## Scope

This note explains the training principles behind modern foundation models and adapts them to AV perception, SLAM, mapping, and world models — with particular depth on 3D point-cloud and LiDAR-primary pipelines. It covers what makes a model a foundation model, pre-training objectives and their 3D analogues, scaling laws, data diversity, compute infrastructure, optimization, fine-tuning strategies, evaluation, and the pitfalls specific to 3D. It is not a replacement for implementation-specific MLOps docs. It links to [self-supervised-learning-first-principles.md](self-supervised-learning-first-principles.md), [vqvae-tokenization.md](vqvae-tokenization.md), [transformer-world-models.md](transformer-world-models.md), and [world-models-first-principles.md](world-models-first-principles.md).

---

## Related Docs

- [Self-Supervised Learning: First Principles](self-supervised-learning-first-principles.md)
- [VQ-VAE Tokenization](vqvae-tokenization.md)
- [Attention and Transformers: First Principles](attention-transformers-first-principles.md)
- [World Models: First Principles](world-models-first-principles.md)
- [JEPA Latent Predictive Learning](jepa-latent-predictive-learning.md)
- [3D Segmentation Training Paradigms](../../30-autonomy-stack/perception/overview/3d-segmentation-training-paradigms.md)
- [Self-Supervised Pre-Training for Driving](../../30-autonomy-stack/perception/overview/self-supervised-pretraining-driving.md)
- [LiDAR Foundation Models](../../30-autonomy-stack/perception/overview/lidar-foundation-models.md)
- [Aggregated-Map Semantic Segmentation — §7.6 density gap](../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md)
- [Model Compression and Edge Deployment](../../30-autonomy-stack/perception/overview/model-compression-edge-deployment.md)
- [Transfer Learning Operations](../../50-cloud-fleet/mlops/transfer-learning.md)

---

## Why It Matters

| Choice | Effect | Risk if wrong |
|---|---|---|
| Pre-training objective | Determines what the backbone learns to represent before any task labels. | Wrong objective → backbone provides no benefit; fine-tuning from scratch wins. |
| Pre-training data distribution | Must subsume the target domain for the pre-train → fine-tune contract to hold. | Insufficient coverage → density/domain gap; diminished transfer. |
| Scaling allocation | Balance between parameters, tokens, and compute defines efficiency. | Undertrained large model underperforms smaller well-trained one. |
| Fine-tuning strategy | Full FT, LLRD, LoRA, adapters — each trades compute for stability and data efficiency. | Aggressive FT on small target set → catastrophic forgetting. |
| Evaluation protocol | LP + few-shot + full FT together reveal representation quality vs. adaptation capacity. | LP alone or fine-tune alone gives incomplete picture. |

---

## 1. What Makes a Model a Foundation Model

Bommasani et al. (2021) coined the term "foundation model" to describe **any model trained on broad data at scale that can be adapted to a wide range of downstream tasks**. Two defining properties:

| Property | Meaning |
|---|---|
| **Emergence** | Capabilities are implicitly induced by training, not explicitly engineered; e.g., GPT-3's in-context learning appeared without specific training for it. |
| **Homogenization** | A single pre-trained backbone is reused across many tasks and modalities, centralizing the cost of representation learning. |

**The pre-train → fine-tune contract:**

```text
Pre-training  :  task-agnostic objective, large unlabeled (or weakly labeled) corpus
                 -> general-purpose representation
Fine-tuning   :  task-specific labeled data (usually smaller)
                 -> specialization of the backbone
```

The contract only holds when pre-training data distribution is broad enough to subsume the fine-tuning domain. When that fails — a recurrent 3D problem (Section 10) — the contract degrades and fine-tuning may yield little benefit over training from scratch.

**Emergent capabilities** appear as a function of scale: performance on certain tasks remains near chance below a threshold, then rises sharply. This non-linearity motivates large-scale investment in compute and data even before any downstream task is defined.

**Data and compute prerequisites** (empirically): at minimum hundreds of millions of parameters trained on billions of tokens or equivalent multimodal pairs. For vision, ImageNet-21k (~14M images) enabled the first reliable ViT foundations; CLIP used 400M image-text pairs. For 3D point clouds, the current largest pre-training corpus is Sonata's 140k scans — orders of magnitude smaller.

For AVs, a foundation model may be:

- A vision encoder for camera perception.
- A LiDAR or point-cloud encoder (the primary focus here).
- A BEV encoder shared by detection, occupancy, mapping, and planning.
- A video or occupancy world model.
- A multimodal model that aligns camera, LiDAR, radar, text, maps, and actions.

The value comes from amortizing representation learning across tasks and domains.

---

## 2. Pre-Training Objectives

### 2.1 Self-Supervised — Contrastive

**InfoNCE loss** (Noise Contrastive Estimation applied to mutual information):

```text
L_InfoNCE = -log [ exp(sim(z_i, z_j) / tau) / sum_k exp(sim(z_i, z_k) / tau) ]
```

`tau` is a temperature hyperparameter (typically 0.07–0.2) that controls distribution sharpness. Smaller `tau` → harder, more discriminative task; too small → training instability.

- **SimCLR** (Chen et al. 2020): two augmented views per image, InfoNCE on normalized embeddings, large batch required (4096+).
- **MoCo** (He et al. 2020, v2/v3): momentum encoder plus queue memory bank decouples batch size from the number of negatives; MoCo v3 adapts to ViT backbone.

**3D-specific contrastive:**

- **PointContrast** (Xie et al. 2020): positive pairs are point correspondences under rigid transformations; InfoNCE over point-level features on 3D scans. SSL pre-training on unlabeled 3D scans improves downstream scene understanding.
- **SegContrast** (Nunes et al. 2022): contrastive loss at segment level (class-agnostic over-segmentation rather than individual points); discriminates between structurally similar vs. dissimilar segments; produces more transferable representations across datasets.
- **SLidR** (Sautier et al. 2022): image-to-LiDAR distillation; 2D image superpixel features from ViT/DINO distilled into a 3D LiDAR backbone via cross-modal InfoNCE; pioneered image → point-cloud knowledge transfer on nuScenes.
- **ScaLR**: scaled-up SLidR with a larger dataset and larger model; same image-to-LiDAR distillation paradigm with better coverage.

**Key challenge for 3D contrastive:** point clouds are sparse and structurally redundant in different ways than images. Augmentations that work for images (color jitter, blur) are often irrelevant for LiDAR; geometry-based augmentations (point jitter, global scale, rotation) dominate. Positive-pair definition requires careful handling of rigid-body transformations and occlusion.

### 2.2 Self-Supervised — Masked Modeling (MAE / BERT-style)

**BERT** (Devlin et al. 2019): mask 15% of tokens, predict masked tokens from bidirectional context.

**MAE** (He et al. 2022): mask 75% of image patches; lightweight decoder reconstructs raw pixels. High masking ratio is justified by image spatial redundancy. Fine-tuning is robust across 40–80% masking ratios; 75% is optimal for linear probing.

**3D-specific masked modeling:**

- **Point-MAE** (Pang et al. 2022): divides the point cloud into patches via farthest-point sampling plus kNN grouping; randomly masks patches; reconstructs masked point coordinates via a lightweight transformer decoder. Primarily demonstrated on object-scale datasets (ShapeNet, ScanNet).
- **Voxel-MAE** (Chen et al. 2022): converts a point cloud to voxels and randomly masks voxels; prediction target is binary occupancy classification rather than coordinate regression. A **90% masking ratio is effective** for large outdoor scans due to high spatial redundancy; improves nuScenes detection by +1.75 mAP and requires only 40% of annotated data to match full supervision.
- **MaskPoint** and related: predict binary occupancy of masked voxels.

Large outdoor LiDAR scans tolerate and benefit from higher masking ratios (75–90%) than indoor object models (~60–75%) because outdoor scans have more spatial redundancy per unit area.

### 2.3 Self-Supervised — Predictive / Distillation

**JEPA** (Joint Embedding Predictive Architecture; LeCun 2022, I-JEPA 2023): a predictor network predicts the latent embedding of a target region from a context region — entirely in abstract representation space, not pixel space. This avoids the pixel-reconstruction bias that forces MAE to learn low-level texture features. I-JEPA uses ViT encoders. For AV applications, JEPA-style objectives are well-suited when semantics matter more than pixel-level fidelity. See [jepa-latent-predictive-learning.md](jepa-latent-predictive-learning.md).

**Self-distillation (DINO, DINOv2, iBot):** student network predicts outputs of a momentum teacher; teacher weights are an exponential moving average (EMA) of the student. No negative samples needed. DINOv2 scales to 142M parameters on 142M curated images; produces strong linear probing features widely used as a vision backbone in 3D perception via cross-modal distillation.

**PonderV2** (Zhu et al. 2023/2025, T-PAMI): uses differentiable neural rendering as the reconstruction objective — the encoder predicts SDF and color along rays; 2D RGB-D images are the supervision signal. Achieves SOTA on 11+ benchmarks (nuScenes 73.2 NDS, ScanNet 77.0 mIoU). Robust to masking ratios 0–90%.

**Sonata** (Wu et al., CVPR 2025; Meta/Pointcept): self-distillation on 140k point clouds; solves the **geometric shortcut problem** — 3D encoders trained with naive SSL objectives collapse to trivial spatial-coordinate representations rather than semantic features (see Section 10.6). Sonata's two-pronged fix: (a) obscure spatial coordinates during pre-training, (b) enhance dependence on input features such as color and intensity. Result: ScanNet linear probing improves from 21.8% to **72.5%** (3.3× improvement); near-doubles performance with only 1% training data.

### 2.4 Supervised at Scale

ImageNet supervised pre-training established the fine-tuning paradigm; larger datasets (JFT-300M, ALIGN 1.8B) extended it. Multi-task supervised pre-training — one head per dataset — is used in 3D with PPT (see Section 4.3). For AV, supervised pre-training at scale requires either a massive proprietary fleet dataset or multi-dataset joint training to amortize annotation cost.

### 2.5 Cross-Modal Objectives

**CLIP** (Radford et al. 2021): image encoder plus text encoder, symmetric InfoNCE on 400M image-text pairs. Temperature `tau` is learned as a scalar log-parameter. Creates a shared embedding space enabling zero-shot visual inference with text queries.

**OpenScene** (Peng et al. 2023, CVPR): distills CLIP features from posed 2D images into a 3D sparse conv network. For each 3D point, back-projects into multiple camera views and aggregates CLIP pixel features. The 3D network is trained to match these CLIP features. Enables zero-shot 3D semantic segmentation — query any text label, find matching 3D points — without requiring labeled 3D data.

**Image-to-LiDAR Relational Distillation** (D-DITR, arXiv 2409.00845): enforces intra- and cross-modal structural constraints during distillation, bridging representation gaps between 2D and 3D more tightly than naive feature matching.

The trajectory in 2D-to-3D cross-modal work mirrors the 2D SSL trajectory: moving from raw pixel reconstruction toward semantic feature-space targets (CLIP/DINO embeddings), which carry richer transferable representations.

---

## 3. Scaling Laws

### 3.1 Language Model Scaling (Kaplan and Chinchilla)

**Kaplan et al. (2020)** established empirical power-law scaling: loss decreases predictably with parameter count N, dataset size D, and compute C:

```text
L(N) proportional to N^{-alpha}    (alpha approx 0.076 for transformers)
L(D) proportional to D^{-beta}
```

Implication from the original Kaplan analysis: for a fixed compute budget, scale parameters preferentially (data is cheap relative to model size). This recommendation was later revised.

**Chinchilla / Hoffmann et al. (2022, NeurIPS):** refit the scaling analysis; found GPT-3 was undertrained. Optimal allocation: **approximately 20 tokens per parameter**. A 70B parameter model needs approximately 1.4T tokens. Smaller, well-trained models beat larger undertrained ones on the same compute budget.

Subsequent reconciliation work (2024) showed the apparent Kaplan–Chinchilla discrepancy arose from differences in counting non-embedding vs. total parameters and from extrapolating from small-scale experiments.

**First-principles lesson:**

```text
Do not only increase parameters. Increase high-quality data and training tokens
in proportion, or the model becomes compute-inefficient.
```

For AVs, "more tokens" also means more scenario diversity. Ten million near-duplicate highway frames are less useful than fewer frames covering weather, geography, actors, edge cases, and operational domains.

### 3.2 3D-Specific Scaling — Honest Assessment

**No published paper has established clean scaling laws for 3D point cloud models** analogous to Kaplan or Chinchilla. The key obstacles:

- No standardized large-scale 3D corpus (no "ImageNet of point clouds") makes controlled scaling experiments hard to design.
- Point cloud datasets vary significantly in sensor type, density, scene type, and annotation schema — heterogeneity confounds clean power-law fits.
- Current largest 3D pre-training corpora (e.g., Sonata's 140k scans) are orders of magnitude smaller than text or image pre-training corpora.
- Compute-per-sample varies dramatically based on point count and voxelization resolution, making "tokens per step" an ill-defined unit.

**Practical implication:** 3D researchers cannot reliably predict whether doubling model size or doubling data will yield greater improvement — empirical trial dominates planning decisions. This is a known gap in the 3D foundation model literature as of mid-2025.

---

## 4. Data Scale, Diversity, and the 3D Fragmentation Problem

### 4.1 Why Pre-Training Data Dominates

Pre-training on broad data establishes the feature hierarchy. Fine-tuning only adjusts the top of that hierarchy toward the target task. When fine-tuning data is small, the quality of pre-trained features determines the ceiling. This is why self-supervised pre-training on large unlabeled corpora — which are much cheaper to obtain than labeled ones — can beat fully supervised training on small labeled sets.

For AVs, data axes include: geography, weather, time of day, sensor rig, speed regime, operational domain (road, airside, warehouse), object taxonomy, rare events, map version, and controller behavior. A model trained mostly on sunny urban roads will not transfer to airport stands, de-icing zones, aircraft wings, or baggage cart trains without explicit domain coverage.

### 4.2 The 3D Fragmentation Problem

The 3D ecosystem lacks a single large-scale curated corpus:

- **Modality diversity**: rotating LiDAR (Velodyne HDL-64), solid-state LiDAR, FARO terrestrial scanner, and RGB-D sensors all produce different density and noise profiles.
- **Taxonomy mismatch**: SemanticKITTI, nuScenes, Waymo Open Dataset, ScanNet, and S3DIS each define different semantic classes. "Road", "Driveable surface", and "Ground" are not identical but overlap substantially.
- **Scene domain fragmentation**: outdoor driving, indoor rooms, construction sites, airports, and factories have very different geometric statistics.

Consequence: a model pre-trained on nuScenes (single-scan, 32-beam, highway) encounters a **density gap** when fine-tuned on aggregated multi-scan, 128-beam airport maps. Point density, spatial extent, and object occupancy statistics all differ. This mismatch is a first-order pitfall for the airside AV use case (see Section 10.1 and `aggregated-map-semantic-segmentation.md` §7.6).

### 4.3 Multi-Dataset Joint Training as Partial Solution

**PPT — Point Prompt Training** (Wu et al., CVPR 2024): trains one model simultaneously on ScanNet, S3DIS, nuScenes, Waymo, and others. Two key mechanisms:

- **Prompt-driven Normalization**: dataset-specific learnable prompt vectors adapt batch normalization statistics, preventing any one domain from dominating training.
- **Categorical Alignment**: leverages text embeddings of class label names to unify disjoint label spaces across datasets (e.g., maps "road surface" in dataset A to "driveable surface" in dataset B).

Result: a single model achieves SOTA on each constituent dataset individually, and the pre-trained backbone transfers well to 10+ downstream tasks.

**M3Net** (CVPR 2024): universal LiDAR segmentation via multi-space alignment — sensor space, point space, and semantic space. Unlike PPT which fine-tunes a separate head per dataset, M3Net maintains a truly universal model head.

**SSL on unlabeled corpora**: Sonata's 140k-scan corpus is assembled from unlabeled scans across diverse environments. Self-distillation on this corpus transfers well to labeled benchmarks with very few labels, demonstrating that raw scan diversity matters even without taxonomy.

### 4.4 Tokens and Training Examples for AV Foundation Models

Language models count text tokens. AV models need a comparable unit:

- Image patches.
- Video patches or BEV grid cells.
- VQ-VAE code indices.
- LiDAR points or voxels.
- Object tokens or map elements.
- Action tokens and latent embeddings.

Tokenization affects compute significantly:

```text
tokens per example * examples per batch * sequence length

64 x 64 BEV  = 4096 tokens per frame
128 x 128 BEV = 16384 tokens per frame
8 frames at 128 x 128 = 131072 tokens before sparsity
```

This is why AV foundation models usually need token compression, sparse attention, patching, or factorized temporal modeling. For LiDAR specifically: a single nuScenes frame is approximately 30k points; a 10-second aggregated sequence is 300k–1M points after pose-fused accumulation. Transformer attention at full resolution is O(N²) — voxelization or windowed attention (SphereFormer, FlatFormer) is required.

---

## 5. Compute and Infrastructure

### 5.1 Distributed Training Primitives

| Technique | Purpose | Key Detail |
|---|---|---|
| **Mixed precision (BF16/FP16 + FP32)** | Reduce memory, increase throughput. | Parameters and activations in BF16; gradient accumulation and optimizer states in FP32 for numerical stability. FSDP supports per-layer mixed-precision policy. |
| **ZeRO-3 / FSDP** | Shard model state across GPUs. | Parameters, gradients, and optimizer states all sharded: memory scales as 1/N where N = GPU count. PyTorch FSDP is equivalent to DeepSpeed ZeRO Stage 3. Essential for models >= 10B parameters on <= 80 GB GPUs. |
| **Gradient checkpointing (activation recomputation)** | Reduce activation memory. | Stores only checkpoint activations; recomputes intermediate activations during the backward pass. Approximately 20–30% compute overhead for approximately 60–80% activation memory reduction. Transformer block is the standard checkpoint granularity. |
| **Gradient accumulation** | Simulate large batch with small GPU memory. | Accumulate gradients over K micro-batches before the optimizer step. Effective batch size = micro-batch × K × GPU count. |

### 5.2 3D-Specific Infrastructure Considerations

- **GPU voxelization**: sparse convolution frameworks (spconv, MinkowskiEngine, torchsparse) perform voxelization and hash-table indexing on GPU. The memory bottleneck is often the sparse tensor hash map, not parameter storage. This is qualitatively different from image models where batch size is the primary memory driver.
- **Variable point count**: point clouds do not batch naturally — different scenes have different point counts. Common solutions: fixed-count subsampling (FPS), voxel-based batching (each voxel batch has a uniform grid size), or padding with masking. Each choice affects training efficiency and GPU utilization.
- **Point cloud data loaders**: I/O is a frequent bottleneck for large scan corpora. Preprocessing (normal estimation, voxelization, FPS) should be cached; on-the-fly augmentation is cheap relative to loading. Store shards in zarr, HDF5, or WebDataset for sequential read throughput.
- **Outdoor scene scale**: a single nuScenes frame is approximately 30k points; a 10-second aggregated sequence is 300k–1M points after pose-fused accumulation. See `point-cloud-representations-voxelization-first-principles.md` for representation trade-offs at scale.
- **Teacher-feature caching**: for distillation objectives (SLidR, Sonata), computing 2D DINO/CLIP features on-the-fly is expensive. Cache teacher features per scan during a preprocessing pass; distillation then reads cached targets.
- **Checkpoint storage**: a full FP32 optimizer state for a 300M parameter model requires approximately 3.6 GB. With ZeRO-3 across 8 GPUs, each node holds ~450 MB of optimizer state. Plan checkpoint storage for multi-epoch pre-training runs accordingly.

---

## 6. Optimizer and Schedule

### 6.1 AdamW

The standard optimizer for foundation model training. Key update equations:

```text
m_t = beta1 * m_{t-1} + (1 - beta1) * g_t             # first moment
v_t = beta2 * v_{t-1} + (1 - beta2) * g_t^2           # second moment
theta_t = theta_{t-1} - lr * m_hat_t / (sqrt(v_hat_t) + eps) - lr * lambda * theta_{t-1}
                                                         # weight decay decoupled
```

Typical values: beta1=0.9, beta2=0.999, eps=1e-8, weight decay lambda=0.01–0.1. LayerNorm parameters and bias terms are conventionally excluded from weight decay.

**Why AdamW over Adam + L2:** standard Adam applies L2 regularization through the gradient, which interacts with adaptive scaling; AdamW decouples weight decay, making its regularization effect consistent regardless of gradient magnitude. This matters especially during fine-tuning where some layers move little and others move a lot.

### 6.2 Learning Rate Schedule

**Linear warmup**: increase LR from 0 (or 1e-7) linearly over the first 1–5% of steps. Purpose: allow Adam's first/second moment estimates to stabilize before large parameter updates.

**Cosine decay**: after warmup, LR decays as:

```text
lr_t = lr_min + 0.5 * (lr_max - lr_min) * (1 + cos(pi * t / T))
```

**Linear LR scaling rule** (Goyal et al. 2017): when multiplying batch size by k, multiply LR by k. Works up to batch approximately 8k; above that, use square-root scaling.

**LARS / LAMB**: layer-wise adaptive rate scaling — normalizes the update by the ratio of weight norm to gradient norm per layer. Enables BERT training in 76 minutes with batch size 32k. Useful when 3D pre-training uses very large batches.

### 6.3 A Standard AV Foundation Pre-Training Config

```text
Optimizer:  AdamW (beta1=0.9, beta2=0.999, lambda=0.05)
Schedule:   Linear warmup 5% of steps, cosine decay to 1e-6
Gradient clip: max norm 1.0
Weight decay: excluded from LayerNorm and bias parameters
Mixed precision: BF16 forward/backward, FP32 optimizer states
```

---

## 7. Loss Design for Pre-Training

### 7.1 Contrastive Temperature

The temperature `tau` in InfoNCE is critical and requires tuning:

- Too high (`tau` → 1): distribution flattens, learning signal disappears.
- Too low (`tau` → 0): only the hardest negative matters; training becomes unstable.
- CLIP learns `tau` as a log-scalar; practical range 0.07–0.2.
- 3D contrastive methods typically inherit `tau` ≈ 0.07 from SimCLR but may need tuning given different negative geometry in 3D scenes — in a single LiDAR scan, most point pairs are "far" in embedding space already, potentially over-saturating the contrastive signal.

### 7.2 Masking Ratios for MAE-style Objectives

| Domain | Optimal masking ratio | Rationale |
|---|---|---|
| Image patches (MAE) | 75% | Spatial redundancy; forces semantic reasoning. |
| Outdoor LiDAR voxels (Voxel-MAE) | 75–90% | Even higher spatial redundancy in large scenes. |
| Object-scale point patches (Point-MAE) | ~60–75% | Smaller objects have less redundancy. |

For linear probing quality, accuracy increases monotonically with masking ratio up to a plateau. For fine-tuning, performance is insensitive across the 40–80% range. The practical choice: 75% is safe; 90% is justified for outdoor scans.

### 7.3 Reconstruction Target Choice

The choice of what to reconstruct shapes what the model learns:

- **Raw coordinate regression** (Point-MAE): simple but biased toward low-level geometry.
- **Occupancy binary classification** (Voxel-MAE): easier to learn; tolerates higher masking ratios.
- **Neural rendering / RGB-D** (PonderV2): richest signal; ties 3D geometry to photometric cues; requires posed images.
- **CLIP/DINO feature distillation** (SLidR, Sonata): skips low-level reconstruction bias; directly targets semantic embeddings.

The trajectory in 3D SSL is moving from coordinate reconstruction toward feature-space targets, mirroring the 2D SSL transition from pixel-reconstruction to DINO/CLIP features.

### 7.4 Curriculum and Auxiliary Heads

Curriculum masking (easy → hard progression) has shown marginal benefit in 3D; most published methods use random masking for simplicity. Auxiliary heads (e.g., a detection head during pre-training in PonderV2-style pipelines) improve multi-task generalization. PonderV2 combines reconstruction (SDF + RGB rendering) with auxiliary semantic heads. When labeled data is partially available, mixing supervised auxiliary losses during pre-training can accelerate convergence.

---

## 8. Fine-Tuning Strategies

### 8.1 Full Fine-Tuning

All parameters updated. Highest adaptation capacity. Standard when the downstream labeled dataset is large relative to the model. Primary risks: catastrophic forgetting (Section 10.2) and high compute cost for iterative experimentation.

### 8.2 Linear Probing

Freeze the backbone; train only a linear head. Tests whether the backbone has already learned target-relevant features. Poor linear-probing (LP) accuracy indicates weak pre-training, not a fine-tuning problem. LP is an important diagnostic but underperforms fine-tuning in practice unless pre-training distribution closely matches the target.

**3D LP landmark**: prior to Sonata (2025), the best 3D LP accuracy on ScanNet semantic segmentation was ~21.8 mIoU. Sonata achieves 72.5 mIoU — a 3.3× improvement — establishing a new bar for what self-supervised 3D features can represent before any task-specific adaptation.

### 8.3 Layer-wise LR Decay (LLRD)

Apply higher LR to top layers and lower LR to bottom layers (e.g., decay multiplier 0.65 per layer from top to bottom). Rationale: lower layers capture generic features (should be stable); upper layers are more task-specific (need more adaptation). LLRD mitigates catastrophic forgetting while allowing meaningful adaptation. Commonly used in DINOv2, ViT fine-tuning, and 3D transformer adaptation.

### 8.4 Parameter-Efficient Fine-Tuning (PEFT)

**LoRA** (Hu et al. 2022): decomposes the weight update into a low-rank product:

```text
delta_W = A * B    where A in R^{d x r}, B in R^{r x k}, r << min(d, k)
```

Only A and B are trained; the base weights are frozen. For r=8 and d=k=768, reduces trainable parameters by approximately 99%. Inserted into attention projection matrices (Q, K, V, O) and optionally MLP layers. Zero added inference latency when the trained LoRA weights are merged into the base weights.

**PointLoRA** (Wang et al., CVPR 2025): applies LoRA to point cloud transformer attention layers, combined with multi-scale token selection (FPS-based hierarchical sampling) to extract local geometry prompts. Achieves competitive performance with **only 3.43% of trainable parameters** vs. full fine-tuning across multiple 3D benchmarks. This is the recommended PEFT approach for adapting 3D pre-trained models to domain-specific deployments such as airside maps.

**Point-PEFT** (AAAI 2024): broader PEFT framework for 3D pre-trained models including adapters and prompt tuning.

**Partial unfreezing**: unfreeze only the last K transformer blocks; good middle ground when labeled data is moderate and full fine-tuning is too aggressive.

**Prefix-tuning / Prompt-tuning**: prepend learnable virtual tokens to the input sequence; only these tokens are trained. Effective for NLP; less established for 3D point clouds.

**Adapter modules**: small bottleneck modules inserted between transformer layers; inject task-specific adaptation without modifying base weights.

### 8.5 Practical Guidance for Airside AV Adaptation

```text
Step 1:  Domain-adaptive SSL (no labels).
         Continue pre-training on unlabeled airside LiDAR scans
         to close the density and scene-statistics gap before
         any supervised fine-tuning.

Step 2:  PEFT supervised fine-tuning.
         PointLoRA (r=8) or lightweight adapters trained on
         labeled airside tiles. Start with a frozen backbone;
         thaw top 2-3 blocks if performance plateaus.

Step 3:  Full fine-tuning (optional).
         Only if labeled budget exceeds a few thousand tiles and
         domain-adaptive SSL has already been done; use LLRD to
         protect lower-layer representations.
```

---

## 9. Evaluation of Foundation Models

### 9.1 Linear Probing as Quality Indicator

Linear probing (LP) accuracy with a frozen backbone is the standard probe of representation quality in SSL research. A well-trained foundation model should yield high LP accuracy without any fine-tuning. This disentangles feature quality from fine-tuning capacity, making LP a diagnostic that reveals what was actually learned during pre-training.

Prior to Sonata, the best 3D LP on ScanNet was ~21.8 mIoU. Sonata achieves 72.5 mIoU — establishing a new reference point for the state of self-supervised 3D representation learning.

### 9.2 Three-Track Evaluation Protocol

Evaluate pre-trained 3D models on all three tracks, not just fine-tuning mIoU:

| Track | What it measures | When to report |
|---|---|---|
| Linear probing (frozen backbone) | Intrinsic representation quality. | Always; primary SSL quality indicator. |
| Few-shot (1%, 5%, 10% labels) | Data efficiency; practical label cost. | Always for industrial deployment decisions. |
| Full fine-tuning mIoU | Maximum achievable accuracy. | Always; upper-bound reference. |

Reporting only full fine-tuning mIoU obscures whether pre-training was useful at all.

### 9.3 Standard 3D Transfer Benchmarks

- **ScanNet v2**: 3D semantic segmentation, instance segmentation (indoor).
- **ScanNet200**: 200-class taxonomy (harder long-tail evaluation).
- **nuScenes**: 3D object detection, panoptic segmentation (outdoor, autonomous driving).
- **Waymo Open Dataset**: 3D detection, tracking.
- **S3DIS**: large-scale indoor segmentation.
- **SemanticKITTI**: outdoor LiDAR semantic segmentation (single-scan and multi-scan tracks).

No single benchmark covers aggregated multi-scan airport airside environments. This is a gap: LP scores on ScanNet do not predict LP scores on dense, multi-scan, flat-apron geometry.

### 9.4 Data Efficiency as the Primary Deployment Metric

For industrial deployment where annotation budgets are constrained, data-efficiency results are often more practically meaningful than peak fine-tuning mIoU:

- Sonata: near-doubles prior performance using only 1% of ScanNet labels.
- Voxel-MAE: matches full supervision with 40% of annotated data.

These numbers directly translate to annotation cost savings. At airside scale (few thousand labeled scan tiles), the difference between needing 100% vs. 10% of labels can be 6–12 months of annotation effort.

---

## 10. Pitfalls

### 10.1 Pre-Training / Fine-Tuning Distribution Mismatch — the Density Gap

When a backbone pre-trained on single-scan, 32-beam, highway-driving LiDAR (e.g., nuScenes) is fine-tuned on aggregated multi-scan, 128-beam, low-speed airside maps, it faces:

- **Density gap**: multi-scan maps have 5–20× more points per unit area; per-point receptive field geometry changes.
- **Geometry statistics shift**: airport surfaces are predominantly planar (aprons, taxiways) vs. road scenes with vertical clutter (buildings, trees).
- **Motion artifact distribution**: multi-scan maps contain ghost trailing artifacts from moving aircraft and GSE; pre-training data contains none.
- **Semantic taxonomy mismatch**: no "aircraft stand markings", "jet bridge", or "baggage belt" categories exist in any public pre-training corpus.

Practical consequence: LP accuracy will be misleadingly low; full fine-tuning may still improve somewhat but the backbone provides less benefit than expected. Mitigation: domain-adaptive pre-training (unsupervised SSL) on unlabeled airside scans before supervised fine-tuning (the pipeline in Section 8.5).

### 10.2 Catastrophic Forgetting During Fine-Tuning

Aggressive full fine-tuning on a small target dataset overwrites pre-trained representations. The model achieves good in-distribution performance but loses generalizable features. Symptoms: LP accuracy post-fine-tuning collapses; out-of-distribution robustness degrades.

Mitigations:
- PEFT (LoRA, adapters) — backbone weights frozen or barely shifted.
- LLRD — lower learning rate for early layers.
- Elastic Weight Consolidation (EWC) — penalizes parameter movement away from pre-trained values weighted by estimated importance.
- Feature-space regularization — match pre-trained and fine-tuned feature distributions across samples.

### 10.3 Evaluation Contamination

If pre-training data includes examples from evaluation benchmarks (directly or via crawled web data), benchmark scores are inflated. In 3D, this is currently a smaller risk than in NLP (3D scan datasets are not available at web scale), but as multi-dataset joint training (PPT, M3Net) becomes common, test splits of individual datasets must be explicitly excluded from pre-training corpora. Log which dataset splits were excluded; audit this at each pre-training data curation step.

### 10.4 Linear Probe vs. Fine-Tune Trade-off

LP accuracy does not reliably predict fine-tuning accuracy. A backbone with lower LP but richer fine-tuning potential can outperform one with high LP but narrow features. MoCo v3 vs. DINO is a documented case in 2D. For 3D: do not select pre-training methods by LP score alone. Use the three-track protocol (Section 9.2) and report all three.

### 10.5 From-Scratch Sometimes Wins

For domain-specific datasets with statistics sufficiently different from pre-training data, training from scratch with the full labeled target dataset can match or exceed fine-tuned models. One documented LiDAR case: from-scratch at 100% labels achieves 70.84 mAP vs. fine-tuned 68.29 mAP. The surprise is label-count dependent: the fewer the labels, the more pre-training helps; with many labels and a large domain gap, from-scratch can close in. Airside implication: if an airside-specific labeled corpus is ever large (>50k labeled tiles), evaluate from-scratch as a serious competitor.

### 10.6 Geometric Shortcut Problem (3D-specific)

3D encoders trained with naive SSL objectives learn to recognize points by their absolute or relative spatial coordinates rather than by semantic content. This is because 3D scenes have strong spatial structure: floors are at z ≈ 0, ceilings at z ≈ 3m, aircraft fuselages at z ≈ 3–8m, etc. The encoder exploits positional shortcuts rather than developing semantic features. Sonata (2025) identifies and names this explicitly, and addresses it by masking positional encodings during pre-training — forcing the model to use feature channels (intensity, color, surface normals) instead of coordinate shortcuts.

For outdoor aggregated maps, an open question remains: whether absolute coordinate masking is equally critical when vertical structure is already very informative (a flat apron is always near z = 0; a terminal building is always above z = 5m). This is a research gap as of mid-2025.

### 10.7 Continual Domain Change

AV models face continual domain change: new airport, new sensor calibration, construction zone, seasonal weather, new GSE equipment, map update. Continual training must avoid catastrophic forgetting. Use replay buffers from old domains, frozen base plus adapters, evaluation gates for previous domains, dataset versioning, and canary tests for safety-critical rare cases. Do not push a continually trained backbone into planning without regression testing its closed-loop behavior on prior domains.

---

## 11. The 3D-Specific Reality

### 11.1 Why 3D Lags Image Foundation Models

| Factor | Image Models | 3D Point Cloud Models |
|---|---|---|
| Pre-training corpus size | Billions of images (LAION-5B, ALIGN 1.8B, JFT-300M). | Largest: Sonata 140k scans; PPT covers ~10 public datasets. |
| Modality standardization | PNG/JPEG pixels, fixed H×W. | Heterogeneous formats (bin, las, ply); variable density, sensor-dependent. |
| Taxonomy standardization | ImageNet 21k / COCO as common anchors. | No universal taxonomy; disjoint class sets across datasets. |
| Annotation cost | Crowdsourcing at scale (Amazon MTurk). | Requires LiDAR experts and 3D tools; 10–100× more expensive per label. |
| Compute per sample | Fixed spatial resolution. | Variable point count; sparse ops harder to parallelize efficiently. |
| Web-scale availability | Images are abundant on the internet. | Point cloud captures require physical sensor deployment. |

### 11.2 Current Best-Known Recipe (as of mid-2025)

Based on synthesizing Sonata, PonderV2, PPT, SLidR/ScaLR, and PointLoRA:

```text
1. DATA:  Large unlabeled corpus of 3D scans (100k+ scans; diverse scene types).
          Cross-dataset curation; explicitly exclude target-domain test splits.

2. ARCHITECTURE: Sparse 3D transformer (e.g., SparseUNet + Transformer)
                 or voxel-based backbone with window attention (SphereFormer,
                 FlatFormer). Object-scale models (Point-MAE) do not transfer
                 directly to outdoor scene-scale tasks.

3. PRE-TRAINING OBJECTIVE (in approximate preference order, 2025):
   a. Self-distillation with positional masking (Sonata-style) to avoid the
      geometric shortcut.
   b. Cross-modal distillation from 2D CLIP/DINO features (SLidR/ScaLR) when
      paired calibrated images are available.
   c. Neural rendering (PonderV2-style) when posed RGB-D is available.
   d. Voxel-MAE / Point-MAE as a fallback when only raw point clouds exist.

4. MULTI-DATASET JOINT TRAINING: PPT-style prompt-driven normalization plus
   categorical alignment to handle dataset heterogeneity without one domain
   dominating.

5. DOMAIN ADAPTATION (target domain):
   Continue SSL (unsupervised) on unlabeled airside scans first.
   Then supervised fine-tuning with PEFT (PointLoRA, r=8 adapters).

6. OPTIMIZER: AdamW (beta1=0.9, beta2=0.999, lambda=0.05), cosine LR decay,
              linear warmup 5% of steps. Mixed precision BF16.

7. EVALUATION: LP accuracy (frozen backbone) + few-shot (1%, 10% labels)
               + full fine-tune mIoU — all three, not just fine-tune mIoU.
```

### 11.3 Unresolved Questions and Uncertainty Flags

- **3D scaling laws**: No published paper; unknown whether parameter scale or data scale dominates for point clouds. *Flag: uncertain; empirical trial required.*
- **Optimal masking ratio for aggregated multi-scan maps**: Voxel-MAE shows 90% effective for single-scan outdoor; aggregated maps are even more spatially redundant overall but have different density profiles near scan origins. *Flag: not studied as of this writing.*
- **Geometric shortcut in outdoor aggregated maps**: Sonata's fix validated indoors (ScanNet). Whether coordinate masking is equally important in large-scale outdoor maps where height is already a strong semantic cue is open. *Flag: research gap.*
- **Multi-scan temporal modeling**: whether pre-training on temporal LiDAR sequences (video-MAE style) beats static-scene SSL for aggregated maps is unexplored. *Flag: research gap.*
- **PEFT ceiling for large domain gaps**: PointLoRA achieves 3.43% trainable parameters matching full FT on standard benchmarks; whether this holds when the pre-training domain and fine-tuning domain are highly dissimilar (e.g., highway pre-training → airside fine-tuning with no domain-adaptive SSL) is not established. *Flag: uncertain.*

---

## 12. A Practical AV Foundation Training Stack

A staged approach:

```text
Stage 1: Broad SSL pre-training
  camera, LiDAR, radar, maps, video, occupancy
  (cross-modal distillation when paired data available)

Stage 2: Domain adaptation
  unlabeled target-domain logs (e.g., airport airside scans)
  continue pre-training objective without labels

Stage 3: Supervised multi-task fine-tuning
  detection, segmentation, occupancy, map elements, tracking
  PEFT preferred; full FT only with sufficient labeled data

Stage 4: World-model training
  future occupancy, token prediction, JEPA, diffusion, or SSM dynamics

Stage 5: Planner integration
  cost heads, uncertainty, closed-loop evaluation

Stage 6: Edge distillation and deployment
  smaller student, quantization, TensorRT, safety fallback
```

---

## Implementation Notes

- Split pre-training data by scan-sequence or geographic area, not randomly by frame. Adjacent frames from the same run share geometry and would contaminate validation.
- Cache teacher features (DINO, CLIP) for distillation objectives before the pre-training loop; computing them on-the-fly multiplies GPU requirements by the teacher model size.
- Use `point_idx -> voxel_idx` lookup tables throughout the forward pass; required to map voxel-space predictions back to original points at evaluation.
- For large outdoor scans in masked modeling, set masking ratios to 75–90% not the 75% default from image MAE — outdoor LiDAR is more spatially redundant.
- Exclude LayerNorm parameters and biases from AdamW weight decay; these are small in count but the exclusion matters for training stability.
- Monitor per-layer gradient norms to detect early signs of catastrophic forgetting during fine-tuning; a sharp drop in gradient norm in early layers indicates the lower backbone is being destabilized.
- When using LoRA for 3D transformer adaptation, apply to both the attention projection matrices and the feed-forward layers; attention-only LoRA can be insufficient for point-cloud backbones where the FFN carries significant geometric processing.
- Track LP accuracy throughout pre-training (every 10% of steps) as a real-time diagnostic of whether the objective is producing usable features. A plateau in LP early suggests the objective has saturated; consider switching reconstruction targets or increasing data diversity.
- Apply the geometric-shortcut mitigation from Sonata (positional masking during pre-training) by default for 3D SSL; this adds minimal engineering cost for a 3× improvement in LP accuracy.
- For airside adaptation: before running labeled fine-tuning, verify domain-adaptive SSL (Stage 2) has run for at least 10k steps on airside scans. Run LP accuracy before and after domain-adaptive SSL; a measurable LP improvement confirms the backbone is adjusting toward airside geometry.

---

## Failure Modes

| Symptom | Likely cause | Diagnostic |
|---|---|---|
| Fine-tuning mIoU barely improves over random init. | Pre-training domain too distant from target; contract failed. | Check LP accuracy before fine-tuning; if LP < 10 mIoU, pre-training provided no useful features. |
| High fine-tune mIoU but LP score is low. | Model has high fine-tuning capacity but weak pre-trained features. | Report all three evaluation tracks; LP exposes brittle features. |
| Performance collapses after continual fine-tuning. | Catastrophic forgetting. | Measure LP accuracy post fine-tuning; switch to PEFT or add EWC. |
| 3D SSL loss decreases but features encode position, not semantics. | Geometric shortcut: model exploits (x,y,z) coordinates. | Apply positional masking during pre-training (Sonata approach); check feature t-SNE colored by class vs. colored by height. |
| From-scratch training matches or beats pre-trained fine-tuning. | Large domain gap between pre-training and target; too many labeled target samples. | Domain-adaptive SSL first; reduce domain gap before declaring pre-training futile. |
| Multi-dataset joint training degrades individual dataset performance. | One dataset dominates batch statistics; taxonomy conflicts. | Use PPT-style prompt normalization; audit per-dataset gradient contribution. |
| LP accuracy plateaus early during pre-training. | Objective saturated; insufficient data diversity. | Switch reconstruction target (coordinates → features → CLIP); add more diverse scan sources. |
| Masking ratio of 75% produces worse features than 50% for outdoor scans. | Object-scale MAE setting applied to outdoor LiDAR; should be 75–90%. | Check masking ratio config; outdoor Voxel-MAE needs higher masking. |
| LoRA fine-tuning leaves accuracy unchanged. | Rank r too low or LoRA not applied to FFN layers. | Increase r (8 → 16 → 32); extend LoRA scope to MLP layers. |
| Domain-adaptive SSL shows no LP improvement on target domain. | Objective still targets pre-training distribution; positional masking missing. | Verify the positional masking flag is active; confirm scans in the domain-adaptation corpus are actually from the target domain. |

---

## Sources

- Bommasani et al., "On the Opportunities and Risks of Foundation Models." arXiv:2108.07258. https://arxiv.org/pdf/2108.07258
- Kaplan et al., "Scaling Laws for Neural Language Models." arXiv:2001.08361. https://arxiv.org/abs/2001.08361
- Hoffmann et al., "Training Compute-Optimal Large Language Models" (Chinchilla). NeurIPS 2022. https://proceedings.neurips.cc/paper_files/paper/2022/file/c1e2faff6f588870935f114ebe04a3e5-Paper-Conference.pdf
- Reconciling Kaplan/Chinchilla (2024): https://arxiv.org/pdf/2406.12907
- Radford et al., "Learning Transferable Visual Models From Natural Language Supervision" (CLIP). https://arxiv.org/abs/2103.00020
- He et al., "Masked Autoencoders Are Scalable Vision Learners." CVPR 2022. https://openaccess.thecvf.com/content/CVPR2022/papers/He_Masked_Autoencoders_Are_Scalable_Vision_Learners_CVPR_2022_paper.pdf
- Chen et al., "Voxel-MAE." arXiv:2206.09900. https://arxiv.org/abs/2206.09900
- Pang et al., "Point-MAE." ECCV 2022.
- Nunes et al., "SegContrast." IEEE RA-L 2022. https://ieeexplore.ieee.org/document/9681336/
- Sautier et al., "SLidR." CVPR 2022. https://github.com/valeoai/SLidR
- Peng et al., "OpenScene." CVPR 2023. https://arxiv.org/abs/2211.15654
- Zhu et al., "PonderV2." T-PAMI 2025. https://arxiv.org/abs/2310.08586
- Assran et al., "Self-Supervised Learning from Images with a Joint-Embedding Predictive Architecture" (I-JEPA). arXiv:2301.08243. https://arxiv.org/abs/2301.08243
- Wu et al., "Point Prompt Training" (PPT). CVPR 2024. https://openaccess.thecvf.com/content/CVPR2024/papers/Wu_Towards_Large-scale_3D_Representation_Learning_with_Multi-dataset_Point_Prompt_Training_CVPR_2024_paper.pdf
- Liu et al., "M3Net." CVPR 2024. https://ldkong.com/PDF/2024_cvpr_M3Net.pdf
- Hu et al., "LoRA: Low-Rank Adaptation of Large Language Models." arXiv:2106.09685. https://arxiv.org/abs/2106.09685
- Wang et al., "PointLoRA." CVPR 2025. https://arxiv.org/abs/2504.16023
- Wu et al., "Sonata." CVPR 2025. arXiv:2503.16429. https://arxiv.org/abs/2503.16429
- Point-PEFT (AAAI 2024): https://ojs.aaai.org/index.php/AAAI/article/view/28323
- LAMB optimizer: https://arxiv.org/pdf/1904.00962
- PyTorch FSDP: https://arxiv.org/pdf/2304.11277
- Fine-tuning vs. from-scratch LiDAR: https://arxiv.org/html/2410.01319
- Contrastive SSL for 3D review: https://arxiv.org/pdf/2301.07283
- Survey: 3D Foundation Models 2025. arXiv:2501.18594. https://arxiv.org/abs/2501.18594
- Oquab et al., "DINOv2: Learning Robust Visual Features without Supervision." arXiv:2304.07193. https://arxiv.org/abs/2304.07193
