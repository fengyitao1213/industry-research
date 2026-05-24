# Training Paradigms for 3D / LiDAR Segmentation: A Comparative Reference

**Last updated:** 2026-05-24

This page is the deep-dive companion to §7.6 (Self-Supervised Pre-Training and 3D Foundation Models) and §7.8 (Training Architecture Comparison) of the [Aggregated-Map Semantic Segmentation](aggregated-map-semantic-segmentation.md) hub page. It addresses the *how-you-train* axis: each paradigm's mechanism, cost structure, accuracy ceiling, and operational fit — independent of which backbone is used. The hub's §7.8 addresses the *which-model* axis (architecture families, benchmark rankings, inference speed); both pages are complementary and should be read together when scoping a new deployment. The airside focus is LiDAR-primary throughout; camera-assisted paradigms that distill into a LiDAR-only inference model are explicitly covered.

---

## Fully-Supervised From Scratch

Standard supervised learning: random or Kaiming weight initialization, cross-entropy loss (frequently combined with Lovász-softmax or weighted cross-entropy for class imbalance), trained end-to-end on a labeled dataset. The approach is backbone-agnostic — it applies equally to sparse-voxel architectures (Minkowski Engine, PTv3), projection-based models (RangeNet++, SalsaNext), and point-based models (KPConv, PointNet++). Every training example requires a dense per-point semantic label, and performance is directly proportional to labeled corpus size within the training distribution. When domain conditions at deployment differ from training conditions — sensor mounting height, apron geometry, rain, night — accuracy degrades sharply because no transfer mechanism compensates for distribution shift.

| Attribute | Value |
|---|---|
| Label cost | Full dense per-point labels for every training scan. SemanticKITTI scale: ~2.3 billion labeled points (19k scans × 120k pts). Airside equivalent: 8–12 months professional annotation for a new domain. |
| Accuracy ceiling | Highest in-domain ceiling when training distribution covers test conditions. PTv3 from scratch reaches ~74–76 % mIoU on SemanticKITTI. Degrades sharply under distribution shift. |
| Data requirements | ≥5,000 fully labeled outdoor scans as a practical minimum. More for uncommon airside classes (aircraft tow bars, jet bridges, ground power units). Unlabeled data is unused. |
| Compute cost | Moderate to high. PTv3 from scratch on 8× A100: ~1–2 days. Single-GPU feasible but slow (3–5 days). No amortization from pre-training. |
| When to use | Annotated data is abundant; domain is stable and well-covered; no suitable pre-trained checkpoint exists; target taxonomy differs fundamentally from any existing dataset. |
| When NOT to use | Annotated data is scarce; compute is constrained; rapid multi-site adaptation is needed; rare safety-critical classes appear in fewer than a few hundred instances. |
| Advantages | Simple pipeline with no pre-training dependencies. Full control over taxonomy — no vocabulary mismatch or negative transfer from a misaligned checkpoint. Converges to the highest possible in-domain ceiling given sufficient data. |
| Disadvantages | Data-hungry: performance degrades steeply below ~5k labeled scans. No transfer benefit — every new domain restart costs the full label budget. Rare classes (jet bridges, fuel hydrant covers) remain underfit without targeted augmentation. Convergence is slow on imbalanced outdoor scenes. |
| Representative method | PTv3 (Point Transformer V3), CVPR 2024 Oral — https://arxiv.org/abs/2312.10035 |

---

## Supervised Multi-Dataset Pre-Training

Train a single backbone jointly on multiple existing labeled datasets — SemanticKITTI, nuScenes, Waymo, S3DIS, ScanNet — to produce a strong general checkpoint, then fine-tune on the target domain. The core challenge is that each dataset defines its own class vocabulary, annotation conventions, and sensor characteristics; naive joint training causes negative transfer when, for example, "road" in SemanticKITTI includes lane markings while nuScenes does not.

**Point Prompt Training (PPT, CVPR 2024)** addresses this with two mechanisms: (1) Prompt-driven Normalization — dataset-specific learnable scale and shift parameters injected into batch-norm layers so the shared encoder adapts statistics per domain without separate decoders; (2) Language-guided Categorical Alignment — a CLIP-style text encoder embeds class names across datasets and computes cross-dataset semantic similarity, enabling the model to recognize that "vegetation" in SemanticKITTI and "plant" in S3DIS overlap conceptually while retaining domain-specific heads. One backbone weight set covers 10+ datasets; the dataset prompt token is switched at inference. **M3Net (CVPR 2024)** extends this to data, feature, and label-space alignment, achieving 75.1 / 83.1 / 72.4 % mIoU on SemanticKITTI / nuScenes / Waymo with a single parameter set. Both methods are described from a taxonomy perspective in [3D Segmentation Class Taxonomy Design](3d-segmentation-class-taxonomy-design.md) §Cross-Dataset Taxonomy Harmonization.

| Attribute | Value |
|---|---|
| Label cost | High upfront, but shared across all users. Public labeled datasets are freely available. Fine-tuning a pre-trained PPT checkpoint requires far fewer target labels than from-scratch training — as few as 500–2,000 labeled scans. |
| Accuracy ceiling | Near or above single-dataset SOTA on each constituent dataset. Outperforms SSL baselines on downstream benchmarks by 2–5 % mIoU as a pre-training step. |
| Data requirements | Access to public labeled datasets (SemanticKITTI, nuScenes, Waymo, S3DIS, ScanNet). Target fine-tuning can be effective with 500–2,000 labeled scans. |
| Compute cost | High for joint pre-training (multi-node, 3–7 days on 8× A100). Fine-tuning is cheap (hours to a few days on a single GPU). |
| When to use | A public PPT or M3Net checkpoint is available; the target domain partially overlaps with road or indoor semantics; fast deployment is needed with minimal target labels; a unified backbone is desirable across road, warehouse, and airside deployments. |
| When NOT to use | The airside taxonomy has fundamentally novel classes entirely absent from all pre-training datasets — representations frozen on road semantics may not generalize. Requires careful prompt tuning if domain gap is large. |
| Advantages | Amortizes label cost across all sites that fine-tune from the same checkpoint. Unified backbone supports road, warehouse, and airside from one weight set. Language alignment allows zero-shot exploration of new class names. |
| Disadvantages | Negative transfer if domain gaps are large and prompts are not carefully tuned. Airside-specific classes (aircraft, GSE vehicle) are absent from all public pre-training datasets — frozen representations may not generalize. Joint pre-training compute is non-trivial as a one-time cost. |
| Representative method | PPT: https://arxiv.org/abs/2308.09718 — M3Net: https://arxiv.org/abs/2405.01538 |

---

## Self-Supervised Pre-Training

Learn representations from unlabeled point clouds, then fine-tune with a small labeled set. The pre-training objective provides geometric and semantic supervision without annotation. Two major families exist:

**Contrastive methods** (pre-2023 wave): *PointContrast* (ECCV 2020) applies point-level NCE loss across two transformed views of the same scene. *SegContrast* (RA-L 2022) operates at segment level, extracting class-agnostic clusters before contrastive training — better for outdoor LiDAR than scene-level methods. *DepthContrast* (ICCV 2021) uses scene-level contrastive loss; less effective for semantic segmentation because road scenes lack diversity at scene level. *TARL* (CVPR 2023) applies temporally consistent object-level contrastive learning by tracking instances across frames — well-suited to sequential outdoor LiDAR such as airport perimeter drives.

**Masked modeling and reconstruction** (current wave): *Voxel-MAE* masks random voxels and predicts occupancy — simple and scalable. *Occupancy-MAE* (TIV 2023) uses range-aware random masking and occupancy prediction designed for sparse outdoor LiDAR, outperforming from-scratch by ~2 % mIoU while halving the labeled data requirement for detection tasks. *PonderV2* (2023/2024) uses neural rendering as a pretext task — renders 2D images from 3D features and minimizes photometric reconstruction loss, achieving SOTA across 11 benchmarks with geometry and appearance supervision requiring no annotations.

**Sonata (CVPR 2025 Highlight)** is the current generalist SSL approach for 3D, using PTv3 as backbone, trained on 140k point clouds via self-distillation. Key insight: prior SSL methods collapse to a geometric shortcut — representations encode spatial position rather than semantics because point cloud structure is sparse and positionally predictable. Sonata masks spatial coordinates during pre-training, forcing reliance on feature content. Linear probing accuracy on ScanNet jumps from 21.8 % (prior best SSL) to **72.5 %** — representing a 3.3× improvement. At 1 % label fraction, Sonata nearly doubles segmentation performance over prior SSL. See [Point Transformer V3 methods page](../methods/point-transformer-v3.md) for PTv3 architecture details. For broader context see [Self-Supervised Pre-Training for Driving](self-supervised-pretraining-driving.md) and [LiDAR Foundation Models](lidar-foundation-models.md).

| Attribute | Value |
|---|---|
| Label cost | Very label-efficient. Sonata-initialized models match or exceed fully supervised from-scratch at 1–10 % label fractions. Typical fine-tuning: 200–2,000 labeled scans. |
| Accuracy ceiling | Approaches or matches fully supervised ceiling with sufficient fine-tuning data. The ceiling is not higher than supervised, but the label-efficiency curve is dramatically better. |
| Data requirements | Large unlabeled corpus (100k–1M scans) for pre-training — collectible from operational logs without annotation. Fine-tuning: 200–2,000 labeled scans. |
| Compute cost | High pre-training compute (~2–5 days on 8× A100 at Sonata scale). Fine-tuning is cheap. Pre-training cost is shared across all downstream tasks. |
| When to use | Large unlabeled archives exist (airside operational logs, LiDAR mapping surveys); label budget is tight; a generalist checkpoint (Sonata, PonderV2) is available for further domain pre-training on airside scans. |
| When NOT to use | Unlabeled data available is too small (<10k scans) to pre-train meaningfully. A large high-quality labeled set already exists — supervised multi-dataset pre-training is more direct in that case. |
| Advantages | Unlabeled data is essentially free (operational logs). Geometric shortcut fix (Sonata) means representations generalize across scene types. Composable with supervised paradigm: SSL pre-train → supervised fine-tune yields additive gains. |
| Disadvantages | Pre-training compute is substantial. Out-of-domain SSL (road pre-train → airside deploy) may require domain-continuation pre-training on airside scans. Contrastive methods are sensitive to augmentation choices; poorly chosen augmentations prevent convergence. |
| Representative method | Sonata: https://arxiv.org/abs/2503.16429 — Occupancy-MAE: https://arxiv.org/abs/2206.09900 — SegContrast: https://ieeexplore.ieee.org/document/9681336 |

---

## Cross-Modal Image-to-LiDAR Distillation

A powerful 2D image model (ResNet, ViT, DINOv2) acts as teacher at training time only. Camera pixels are spatially projected onto LiDAR points using calibration; 2D teacher features are transferred to the 3D student via contrastive or regression distillation loss. At inference, the deployed model is **LiDAR-only** — no camera is required. This pattern is critically important for airside where LiDAR is primary but camera-LiDAR pairs exist in pre-training data.

**SLidR (CVPR 2022)** groups visually similar pixels into superpixels and aligns pooled point features to pooled image features via contrastive loss, gaining +8.7 mIoU at 1 % labels vs. random initialization on nuScenes. **2DPASS (ECCV 2022)** introduces multi-scale fusion-to-single knowledge distillation (MSFSKD): a fusion branch using both image and LiDAR is active only at training time and distilled into a pure 3D branch used at inference; it ranked top-1 on both SemanticKITTI and nuScenes leaderboards at time of publication. See the [2DPASS methods page](../methods/2dpass.md) for implementation details. **ScaLR (CVPR 2024)** combines a DINOv2 ViT teacher, WaffleIron 3D backbone, and mixed multi-dataset pre-training, achieving **78.4 % mIoU on nuScenes with linear probing** — with the largest improvement attributable to scaling the teacher to DINOv2 ViT-L. **Seal (NeurIPS 2023 Spotlight)** distills SAM and DINO vision foundation models into point cloud sequences without annotations in either 2D or 3D during pre-training, using spatial and temporal regularization for cross-modal alignment.

Pre-train vs distill distinction: SLidR, ScaLR, and Seal are SSL pre-training via distillation (no labels at pre-train); 2DPASS is training-time distillation that still requires point labels but enriches the 3D backbone with 2D semantics. All four produce a LiDAR-only deployed model.

| Attribute | Value |
|---|---|
| Label cost | Pre-training: zero labels (SLidR, ScaLR, Seal). Fine-tuning after distillation pre-training: 1–10 % labels typical. SLidR reports +8.7 mIoU at 1 % label fraction over random initialization. |
| Accuracy ceiling | ScaLR + WaffleIron reaches 78.4 % LP on nuScenes — competitive with fully supervised large-model results. Ceiling bounded by quality of the 2D teacher. |
| Data requirements | Calibrated, synchronized camera-LiDAR scan pairs for pre-training. No pairing required at fine-tuning or inference. Many public AD datasets provide paired data. |
| Compute cost | Moderate. Pre-training involves forward passes through a frozen large ViT (DINOv2-L) as teacher — memory-intensive but batchable offline. Fine-tuning is cheap. |
| When to use | Camera-LiDAR pairs exist in the pre-training corpus; the target deployment must be LiDAR-only; maximizing the value of existing multi-modal data collected during site survey. |
| When NOT to use | Only LiDAR data is available in the pre-training corpus (no paired images); calibration is unreliable or unavailable; point-level calibration errors are expected to be large. |
| Advantages | Transfers rich 2D semantic vocabulary (ImageNet / DINO features) into the LiDAR backbone at no label cost. Deployed model is LiDAR-only — simple, robust, no camera runtime dependency. DINOv2 teacher is freely available and of very high quality. |
| Disadvantages | Requires calibrated, synchronized camera-LiDAR pairs at pre-training. Calibration errors introduce feature misalignment and noisy distillation signal. 2D teacher has no depth perception — thin 3D structures (poles, fences, aircraft landing gear struts) may transfer poorly. Teacher is frozen; new domain visual styles not captured by teacher may not transfer. |
| Representative method | SLidR: https://arxiv.org/abs/2203.16258 — 2DPASS: https://arxiv.org/abs/2207.04397 — ScaLR: https://github.com/valeoai/ScaLR — Seal: https://arxiv.org/abs/2306.09347 |

---

## Weakly-Supervised

Provide partial or coarse labels rather than full dense per-point annotation, reducing annotation cost by 90 %+ while retaining most of the accuracy. Three main weak-label types exist in 3D LiDAR:

**Scribble labels (ScribbleKITTI, CVPR 2022 Oral):** Annotators draw 1D geometric lines across object surfaces. Only labeled line points are used as supervision; remaining points are treated as unlabeled. The SemanticKITTI scribble set covers 189M labeled points = 8.06 % of the full dataset. The training pipeline combines teacher-student consistency loss on unlabeled points, self-training with outdoor-adapted pseudo-label heuristics, and a novel point descriptor for pseudo-label quality. Result: **95.7 % of fully supervised performance at 8 % label budget**. This is the most important efficiency result for airside where sparse expert annotation time is the binding constraint.

**Box-level labels:** 3D bounding box labels for objects, sufficient for detection-derived pseudo-labels. No per-point semantic labels required.

**Sparse / click labels:** One label per object instance or one per scan sector. LESS (ECCV 2022) uses one label per superpoint, achieving near-full performance at 0.1 % label rate.

| Attribute | Value |
|---|---|
| Label cost | Scribble: 90 % annotation time reduction vs. full labels. Sparse click: ~0.1–8 % of full-label cost while retaining 90–96 % of accuracy. |
| Accuracy ceiling | 95–97 % of fully supervised ceiling (ScribbleKITTI). Gap narrows as pseudo-label quality improves. Rare-class accuracy depends on whether scribbles hit those classes. |
| Data requirements | Same scan corpus as supervised; only label density is reduced. Consistency losses benefit from access to unlabeled neighboring points. |
| Compute cost | Comparable to or slightly above fully supervised. Teacher-student training approximately doubles forward passes. |
| When to use | Human annotation budget is constrained but labelers are available for scribble-style annotation; initial deployment must be fast; airside taxonomy can be captured by geometric scribbles over aircraft, ground equipment, and pavement surfaces. |
| When NOT to use | Label quality demands are extremely high for rare safety-critical classes where even a 3–5 % accuracy gap is operationally unacceptable; weak-label signal cannot capture ambiguous boundaries (aircraft wheel-well / fuselage boundary, kerb / pavement break-of-slope). |
| Advantages | 90 % annotation time savings — practically significant for airside domain expert labelers. Scribble tools are simple to implement (line drawing over rendered range image). Composable with SSL pre-training: pre-train on unlabeled, fine-tune with scribbles. |
| Disadvantages | Residual 3–5 % accuracy gap vs. fully dense labeling. Self-training loop can accumulate errors on rare classes if initial pseudo-label quality is poor. Line scribbles miss boundary detail; per-point labels still needed for precise instance or panoptic segmentation. |
| Representative method | ScribbleKITTI: https://arxiv.org/abs/2203.08537 — LESS: https://arxiv.org/abs/2210.08064 |

---

## Semi-Supervised

A small labeled set (1–10 % of scans) combined with a large unlabeled set. The model is trained on labeled data while a consistency or pseudo-label signal propagates supervision to unlabeled scans. Critically suited to operational environments where data accumulates continuously but annotation resources are limited.

**Mean-teacher / consistency regularization:** A student model is trained on labeled data; an exponential-moving-average teacher generates pseudo-labels for unlabeled scans. Consistency loss penalizes divergence between student predictions on augmented versions of the same scan. **LaserMix (CVPR 2023)** is the LiDAR-specific extension: laser beams from two scans are interleaved by exploiting the radial ring structure of rotating LiDAR sensors. Mixed scans are fed to the student; the teacher generates targets. Consistency is enforced between original and mixed predictions. LaserMix outperforms vanilla MeanTeacher on SemanticKITTI across all label fractions; at 1 % labeled data, it outperforms fully supervised training with 2× the labeled data under naive labeling schemes. **MixSeg3D** applies voxel-level mixing with cross-scan consistency. **RepL (2025)** refines pseudo-labels via iterative graph-based correction for outdoor LiDAR semi-supervised segmentation.

| Attribute | Value |
|---|---|
| Label cost | 1–10 % of full labels. LaserMix at 1 % labeled data outperforms fully supervised training with 2× labels under naive labeling. |
| Accuracy ceiling | Approaches but does not reach fully supervised ceiling. Gap is 2–4 % mIoU at 10 % labels; narrows with better pseudo-label quality or larger unlabeled pools. |
| Data requirements | Small labeled set (e.g., 190 scans for 1 % of SemanticKITTI) plus a large unlabeled set. Airside: hundreds of thousands of operational scans available over time. |
| Compute cost | 1.5–2× supervised cost due to dual forward passes (student + teacher). Unlabeled batch processing increases memory; gradient checkpointing recommended. |
| When to use | Operational LiDAR logs are available in abundance but annotation budget is small; the model needs to improve progressively as scans accumulate; airside data collection is ongoing during normal operations. |
| When NOT to use | Label distribution of the small labeled set is severely imbalanced and pseudo-labels will propagate class bias; unlabeled data comes from a different domain, creating pseudo-label noise that degrades training stability. |
| Advantages | Scales naturally with operational data collection — more logs yield a better model. LaserMix is architecture-agnostic and applies to any 3D backbone. Synergizes with SSL pre-training: use SSL checkpoint as teacher initialization for stronger pseudo-labels. |
| Disadvantages | Pseudo-label error accumulation on rare or ambiguous classes. Requires careful consistency augmentation design for LiDAR (rotation, flip, scaling — not arbitrary spatial transforms). Training instability if labeled set is too small or class imbalance is severe. |
| Representative method | LaserMix: https://openaccess.thecvf.com/content/CVPR2023/papers/Kong_LaserMix_for_Semi-Supervised_LiDAR_Semantic_Segmentation_CVPR_2023_paper.pdf — RepL: https://arxiv.org/abs/2604.06825 |

---

## Domain Adaptation and Test-Time Adaptation

Transfer a trained model from a source domain (where labels exist) to a target domain (limited or no labels). Two sub-types serve different operational scenarios:

**Unsupervised Domain Adaptation (UDA):** *xMUDA (CVPR 2020)* performs cross-modal UDA: 2D and 3D networks mutually mimic each other's predictions on the target domain via KL-divergence loss, tested for day→night, country→country, and dataset→dataset shifts, consistently improving both modalities. *DODA (ECCV 2022)* is data-oriented sim-to-real UDA: virtual scan simulation imitates real sensor patterns, and tail-aware cuboid mixing addresses interior context gaps, surpassing prior UDA methods by >13 % mIoU on 3D-FRONT → ScanNet / S3DIS.

**Test-Time Adaptation (TTA):** Model parameters adapt at inference using the current scan's statistics, without access to source data. *APCoTTA (2025)* is the first continual TTA method explicitly for airborne LiDAR point cloud segmentation, using three modules: Dynamic Selection of Trainable Layers (DSTL), Entropy-Based Consistency Loss (EBCL), and Randomized Parameter Interpolation (RPI). Benchmarked on ISPRSC and H3DC datasets with 7 corruption types — directly relevant to airside operations where sensor degradation, weather, and lighting shift are constant. *D3CTTA (CVPR 2025)* applies domain-dependent decorrelation for continual TTA of 3D LiDAR segmentation. *GIPSO (ECCV 2022)* uses geometrically informed propagation for online adaptation.

| Attribute | Value |
|---|---|
| Label cost | UDA: labels only in source domain (public datasets, zero new cost). TTA: zero labels in target domain. |
| Accuracy ceiling | UDA: 60–80 % of target supervised ceiling depending on domain gap. TTA: lower ceiling (50–70 %) but requires zero labels at deployment. |
| Data requirements | UDA: labeled source data plus unlabeled target data. TTA: only inference-time target scans; no training data required post-deployment. |
| Compute cost | UDA training: comparable to supervised (dual-stream). TTA: lightweight adaptation steps at inference; APCoTTA selective layer update has modest overhead. |
| When to use (UDA) | Existing road, logistics, or warehouse model to be transferred to a new airside site; sim-to-real gap needs bridging after SynLiDAR pre-training. |
| When to use (TTA) | Deployed model encounters sensor degradation, weather shifts, or a new airport site; retraining budget is unavailable; graceful degradation in adverse conditions is required. |
| When NOT to use | Domain gap is too large for the UDA objective to close without at least some target labels — consider few-shot fine-tuning instead of pure UDA. New airside classes not present in the source vocabulary will be silently missed. |
| Advantages | Zero (TTA) or minimal (UDA) target labels. TTA handles sensor drift and weather corruption in real time without access to source data. APCoTTA is the only published TTA method validated specifically for airborne LiDAR. |
| Disadvantages | Accuracy gap vs. target-supervised fine-tuning — safety-critical classes may remain underfit. Continual TTA risks catastrophic forgetting (error accumulation) without careful regularization. UDA assumes shared label vocabulary; novel airside classes absent from source will be missed entirely. |
| Representative method | xMUDA: https://arxiv.org/abs/1911.12676 — DODA: https://arxiv.org/abs/2204.01599 — APCoTTA: https://arxiv.org/abs/2505.09971 |

---

## Synthetic / Sim-to-Real Pre-Training

Generate unlimited labeled point clouds from a simulator (CARLA, GTA-V, custom rendering engines), pre-train on synthetic data, then adapt to real data. The primary challenge is the sim-to-real gap: synthetic sensors produce noise-free, overly regular scans while real LiDAR exhibits range noise, dropouts, beam divergence, and multi-echo effects. Critically, synthetic data enables controlled rare-class over-sampling at near-zero cost — indispensable for airside classes such as jet bridges, fuel trucks, ground crew, and wildlife hazards that appear rarely in real operational logs and cannot be densely annotated.

**SynLiDAR**: 20k scans, 32 semantic classes, CARLA-derived; a GAN-based point cloud appearance and density translator aligns synthetic distribution to real-world targets. **SynthmanticLiDAR (2025)**: extended CARLA-based synthetic dataset for semantic segmentation on LiDAR imaging. **RareBoost3D (2025)**: explicitly designed for the long-tail problem; provides high-density synthetic instances of rare classes (motorcyclists, traffic cones, specific industrial equipment) with a paired cross-domain semantic alignment loss (CSC loss) reporting ~2–3 % mIoU gain. **STPLS3D**: synthetic-to-real for large-scale aerial and urban 3D scenes, including photorealistic synthetic aerial point clouds — relevant for UAV-based airside survey data.

| Attribute | Value |
|---|---|
| Label cost | Near zero for synthetic (programmatic labels from simulator ground truth). Domain adaptation from synthetic to real requires 100–1,000 real labeled scans. |
| Accuracy ceiling | Sim-only: 40–60 % of real-data ceiling (large gap). Sim pre-train + real fine-tune: 85–95 % of fully supervised real-data training, especially for common classes. Rare classes benefit most. |
| Data requirements | Simulator access (CARLA is open source; photorealistic rendering requires GPU). Airside-specific GSE and aircraft assets must be built or adapted from road assets. Real fine-tuning: 100–2,000 labeled scans. |
| Compute cost | Simulation data generation is parallelizable — cheap per sample. Pre-training cost similar to SSL. The GAN-based domain translator adds compute. |
| When to use | Target domain has rare classes that cannot be adequately represented in real labeled datasets; no labeled real data is available at project start; safety cases require coverage of corner-case scenarios (aircraft taxi obstruction, ground vehicle intrusion at threshold). |
| When NOT to use | Simulator cannot represent the specific sensor model or environment geometry (specific apron geometry, jet blast, ground effect on LiDAR returns); the sim-to-real gap is too large to bridge with available real adaptation data. |
| Advantages | Unlimited labeled samples at near-zero cost. Controlled rare-class over-sampling for safety-critical scenarios. Can generate physically impossible-to-collect edge cases (e.g., aircraft partial obstruction, wildlife on runway). |
| Disadvantages | Sim-to-real gap requires careful domain adaptation; naively fine-tuning on sim data degrades real performance. Airside-specific simulators (apron geometry, GSE assets) must be built or adapted. Synthetic sensor models diverge from real hardware quirks (multi-echo, intensity calibration, atmospheric scattering). |
| Representative method | SynLiDAR: https://arxiv.org/abs/2107.05399 — RareBoost3D: https://arxiv.org/abs/2510.10876 — SynthmanticLiDAR: https://arxiv.org/abs/2501.19035 |

---

## Parameter-Efficient Fine-Tuning (PEFT)

Freeze most of a large pre-trained model and insert small trainable modules. This enables adaptation to new sites or sensor configurations at a fraction of the compute and storage cost of full fine-tuning, and allows multiple site-specific adapters to coexist on a single shared backbone.

**LoRA (Low-Rank Adaptation)** adds rank-r factorized update matrices to frozen weight matrices. In plain-text notation:

```
W_new = W_0 + delta_W
delta_W = B @ A
where B has shape [d, r], A has shape [r, k], r << min(d, k)
Only A and B are trained; W_0 is frozen.
Parameter savings: (d*k - r*(d+k)) / (d*k)
```

**PointLoRA (CVPR 2025)** extends LoRA to point cloud transformers with token selection: LoRA layers are inserted into the most parameter-intensive attention blocks; multi-scale token selection extracts salient local tokens as prompts for fine-tuning, complementing the global context captured by LoRA. PointLoRA achieves **competitive performance with only 3.43 % of trainable parameters** across ModelNet40, ScanObjectNN, and ShapeNetPart benchmarks. **Geometry-Enhanced PEFT (2025)** extends adapters with geometry-aware modules for 3D scene segmentation specifically, addressing the gap left by PointLoRA which targets object-level tasks. **Adapters** (small MLP bottleneck layers inserted in transformer blocks) are less parameter-efficient than LoRA but easier to tune. For per-site deployment the LoRA adapter files are lightweight and swappable without reloading the backbone. See [Foundation Model Training First Principles](../../../10-knowledge-base/machine-learning/foundation-model-training-first-principles.md) for LoRA derivation and adapter theory.

| Attribute | Value |
|---|---|
| Label cost | Same as the fine-tuning paradigm used (supervised or semi-supervised), but fewer labeled examples needed due to reduced overfitting risk from fewer trainable parameters. Works well with 200–1,000 labeled scans. |
| Accuracy ceiling | At 3.43 % trainable parameters, PointLoRA matches or approximates full fine-tune accuracy. Gap increases for tasks very distant from the pre-training distribution. Dense outdoor scene segmentation results for PointLoRA specifically are pending; Geometry-Enhanced PEFT addresses this gap. |
| Data requirements | Same as fine-tuning; reduced data needs because fewer trainable parameters reduce overfitting. Effective with 200–1,000 labeled scans per site. |
| Compute cost | Very low. 3.43 % trainable parameters yields approximately 97 % memory savings in optimizer states. Enables fine-tuning on a single mid-range GPU (RTX 4090) where full fine-tuning would require multi-A100 setups. |
| When to use | Adapting one strong pre-trained checkpoint (PPT, Sonata, ScaLR) to multiple airports or multiple sensor configurations; compute and storage budget is constrained; frequent model updates are needed as new labeled data arrives; per-site adapters must be maintained and swapped at inference. |
| When NOT to use | The backbone is a small, lightweight model that is already efficient to fully fine-tune; the domain shift is so large that only a small fraction of frozen layers is beneficial and full fine-tuning is necessary. |
| Advantages | 97 % reduction in trainable parameters — massive compute and storage savings. Multiple PEFT adapters can be maintained per site and swapped at inference. Prevents catastrophic forgetting of general features when adapting to narrow domains. Compatible with quantization (INT8 backbone + FP32 LoRA adapters). |
| Disadvantages | Rank r is a hyperparameter requiring tuning; too-small r limits representational capacity. PointLoRA's token selection adds small overhead vs. vanilla LoRA. Dense outdoor segmentation validation of PointLoRA is on object-level datasets; results on outdoor LiDAR scene segmentation are pending. |
| Representative method | PointLoRA: https://arxiv.org/abs/2504.16023 — Geometry-Enhanced PEFT: https://arxiv.org/abs/2505.22444 |

---

## Active Learning

Given a fixed annotation budget, actively select the most informative scans, points, or tiles to label next. The model is retrained iteratively after each labeling round. Active learning achieves the same accuracy as full labeling with 5–20 % of annotations in practice, by steering the annotation budget toward uncertainty and coverage gaps rather than random sampling.

Key selection strategies: **Uncertainty-based** — entropy of softmax predictions, margin uncertainty, or Monte Carlo Dropout variance. **Diversity / coverage-based** — select samples that maximize coverage of feature space via core-set selection or submodular maximization. **Spatial / structural** — for LiDAR, select at disc (full 360° sweep) or voxel level rather than point level to respect point density variation.

**LiDAL (2022)** compares predictions across overlapping frames; inter-frame inconsistency signals uncertainty, outperforming single-frame uncertainty measures. **Annotator (NeurIPS 2023)** uses Voxel Confusion Degree (VCD) to jointly capture uncertainty and spatial diversity within a voxel grid. **DiscwiseAL (DiAL, 2023)** acquires full LiDAR discs (sweeps), respects variable point count, and selects scans maximizing information coverage. **SELECT (2025)** applies voxel-centric submodular maximization for scalable active LiDAR labeling, explicitly addressing class imbalance — directly applicable to airside rare-class coverage.

| Attribute | Value |
|---|---|
| Label cost | Goal: match fully supervised accuracy with 5–20 % of labels. Active learning achieves parity with random labeling at 2–5× fewer annotations in practice. |
| Accuracy ceiling | Same ceiling as fully supervised, reached with far fewer labels. Ceiling benefit depends on acquisition function quality at identifying informative samples. |
| Data requirements | The full unlabeled pool (operational scans). A small initial labeled seed set (~100–500 scans). An oracle labeler available for iterative queries. |
| Compute cost | Per round: full model training plus forward pass on the entire unlabeled pool for uncertainty scoring. With disc-level selection, pool passes can use a smaller model. Overhead is modest (~10–20 % above standard training per round, spread across multiple rounds). |
| When to use | A human annotation pipeline already exists and can be queried iteratively; rare classes are underrepresented and targeted selection can oversample them; the operational system is live and new data arrives continuously as in ongoing airport operations. |
| When NOT to use | Annotation process has high per-query overhead (annotator must physically attend the site); initial labeled seed is too small to train a reliable uncertainty estimator (cold-start problem); annotation latency is too high for an iterative loop. |
| Advantages | Asymptotically as accurate as full labeling at a fraction of the budget. Continuously adaptable — each deployment round refines the model on exactly the scenarios that matter. Synergizes with semi-supervised: combine active-selected labels with unlabeled consistency training. |
| Disadvantages | Requires labeling infrastructure capable of targeted, on-demand annotation (not batch). Early rounds have noisy uncertainty estimates due to cold-start. Inter-frame uncertainty methods require temporal alignment across overlapping scan pairs. |
| Representative method | LiDAL: https://arxiv.org/abs/2211.05997 — Annotator: https://arxiv.org/abs/2310.20293 — SELECT: https://arxiv.org/abs/2505.11516 |

---

## Auto-Labeling from the Aggregated Map

The aggregated multi-scan map is a much richer annotation surface than individual sparse scans: accumulation fills occlusions, increases point density, and provides multi-view consistency that makes semantic class boundaries clearer and cheaper to verify. A high-quality model segments the map; those labels are back-projected to every contributing scan, transforming a one-time mapping effort into a continuous label source. This paradigm is the primary enabler of scalable label acquisition for airside environments, which are semi-static (buildings, taxiway markings, stands are stable across months) and already mapped for localization. See the [Aggregated-Map Semantic Segmentation](aggregated-map-semantic-segmentation.md) hub §12 production practice and §14.4 airside path for the production context.

Pipeline: (1) **Map construction** — SLAM or pose-graph optimization accumulates thousands of scans into a colorized, high-density point map. (2) **Map segmentation** — a large, accurate model (PTv3 ensemble or human-corrected segmentation) labels the aggregated map; human verification of the map is 10–20× cheaper per point than per-scan annotation because aggregation makes ambiguous points unambiguous. (3) **Back-projection** — each scan's labeled voxels are looked up in the map via nearest-neighbor voxel matching with overlap consistency checks. (4) **Dynamic object filtering** — moving objects (vehicles, aircraft in motion, ground crew) are removed from the static map before back-projection (see the [LiDAR Semantic Segmentation](lidar-semantic-segmentation.md) single-scan page for dynamic removal methods). (5) **Quality filtering** — per-point confidence scores based on view-count and multi-scan agreement; low-confidence pseudo-labels are discarded or downweighted.

**LESS (ECCV 2022)** performs multi-scan distillation — an aggregated scan model provides denser labels to boost the single-scan model. **UniLiPs (3DV 2026)** implements the full pipeline: SLAM → dynamic point removal → 2D VFM pseudo-label projection → 3D accumulation → back-projection of semantic labels and 3D bounding boxes to individual scans, with no manual annotation.

| Attribute | Value |
|---|---|
| Label cost | Map-level human verification is ~10–20× cheaper per point than per-scan annotation (most map points are unambiguous in the aggregated view). Pseudo-label coverage can approach 100 % of scan points for static classes. |
| Accuracy ceiling | Near fully supervised ceiling for static classes. Moving and dynamic objects require separate handling and remain the weak spot of this paradigm. |
| Data requirements | SLAM pipeline (standard for any LiDAR mapping system); the aggregated site map; a map-level segmentation model (pretrained model with minimal fine-tuning at map scale). |
| Compute cost | SLAM computation is moderate and one-time per site. Map-level segmentation is high compute but one-time. Back-projection is fast (voxel hash lookup). |
| When to use | Operating in a well-mapped, semi-static environment (airport apron — mostly static: buildings, taxiway markings, stands, fixed GSE); SLAM pipeline is already running for localization; a site map exists or can be built during initial survey. |
| When NOT to use | Environment is highly dynamic (cargo handling areas, active gates during pushback); SLAM accuracy is poor (GPS-denied, featureless surfaces) and map drift introduces back-projection errors; labels are needed before a full site map can be built. |
| Advantages | Converts a one-time mapping effort into a continuous label source. Leverages the aggregated map's data richness without per-scan annotation. Compounds with active learning: auto-label cheaply, human-verify rare or uncertain cases. Directly applicable to airside: airports are well-surveyed environments with stable layouts and existing survey data. |
| Disadvantages | SLAM drift and dynamic-object contamination propagate label errors at scale. Static-world assumption breaks at active gates and during pushback; special handling required. Map quality determines pseudo-label quality — poor SLAM means noisy labels and a degraded downstream model. Moving object removal must be robust; missed aircraft or GSE in the map corrupts static-class labels for surrounding points. |
| Representative method | UniLiPs: https://arxiv.org/abs/2601.05105 — LESS: https://arxiv.org/abs/2210.08064 |

---

## Comparison Table

This table compares **training regimes**, not backbone families. Use [Aggregated-Map Semantic Segmentation](aggregated-map-semantic-segmentation.md) §7.8 for the architecture choice among sparse-conv, KPConv/RandLA, SPT, PTv3/Sonata, projection, and SSM/Mamba backbones; use this page to decide how much supervision, pre-training, pseudo-labeling, adaptation, and active learning each backbone should receive.

| Paradigm | Label cost | Accuracy ceiling | Data requirements | Compute | Key advantage | Key disadvantage |
|---|---|---|---|---|---|---|
| Fully-supervised scratch | Full labels — 100 % of corpus | Highest in-domain | Large labeled corpus (≥5k scans) | Moderate | Simple; full taxonomy control | Data-hungry; no transfer |
| Supervised multi-dataset pre-train | Full labels on public datasets; 500–2k for fine-tune | Near SOTA | Public datasets + small target set | High pre-train; low fine-tune | Unified backbone; language alignment | Negative transfer; airside classes absent from public data |
| Self-supervised pre-train | 1–10 % labels for fine-tune | Matches supervised ceiling | Large unlabeled (100k+) + small labeled | High pre-train; low fine-tune | Unlabeled data is free; Sonata 72.5 % vs 21.8 % LP | Pre-train compute; domain-continuation needed for airside |
| Cross-modal distillation | Zero pre-train; 1–10 % fine-tune | ~78 % LP nuScenes (ScaLR) | Calibrated cam+LiDAR pairs at pre-train | Moderate (ViT teacher) | LiDAR-only at inference; free 2D semantics | Calibration required; thin 3D structures transfer poorly |
| Weakly supervised | ~8 % scribble; 0.1 % click | 95–97 % of supervised | Same corpus; reduced label density | ~1.5× supervised | 90 % annotation time savings | 3–5 % accuracy gap; rare class misses |
| Semi-supervised | 1–10 % labeled + unlabeled pool | 95–98 % of supervised | Small labeled + large unlabeled | 1.5–2× supervised | Scales with operational logs | Pseudo-label error accumulation on rare classes |
| Domain adaptation / TTA | Zero (TTA); source labels only (UDA) | 60–80 % of target-supervised (UDA); 50–70 % (TTA) | Labeled source + unlabeled target | Moderate UDA; low TTA | Zero target labels; handles sensor drift in production | Accuracy gap; cannot handle vocabulary-novel airside classes |
| Sim-to-real pre-training | Near zero synthetic; 100–1k real for adaptation | 85–95 % with real fine-tune | Simulator + few real scans | Moderate render + real fine-tune | Rare class coverage; no annotation cost | Sim-to-real gap; airside simulator must be built |
| PEFT (LoRA / PointLoRA) | Same as fine-tune paradigm used | ~= full fine-tune (3.43 % params) | 200–1k labeled scans per site | Very low | Multi-site adapter; 97 % storage savings | Rank r tuning; outdoor segmentation validation pending for PointLoRA |
| Active learning | 5–20 % of full budget | = supervised (given budget) | Full unlabeled pool + iterative labeler | Moderate + pool scoring | Targets rare / uncertain classes first | Cold-start; needs iterative annotation pipeline |
| Auto-label from map | Map verification only (~10–20× cheaper/point) | Near supervised for static classes | SLAM map + map-level segmentation model | Moderate SLAM + map seg (one-time) | Turns site mapping into free labels | SLAM drift; dynamic object contamination |

### Aggregated-Map Shortcut Selector

The operational shortcut for end-to-end semantic segmentation of registered LiDAR maps now lives in [Aggregated-Map Semantic Segmentation](aggregated-map-semantic-segmentation.md) §11. Use that selector to choose the proxy dataset pool, input modality, and training route together; use this page when you need the deeper trade-offs behind each training paradigm.

| Operating condition | Default regime | Why | Main caveat |
|---|---|---|---|
| Label-scarce but large unlabeled survey archive | SSL/generalist checkpoint -> domain-continuation SSL -> supervised or PEFT fine-tune | Survey maps are the free corpus; Sonata/PTv3/PPT/ScaLR-style initialization reduces the cold-start penalty | Public checkpoints are not proof of airside or non-road performance; validate with linear probing before committing |
| Calibrated camera+LiDAR is available, but release should be LiDAR-only | SLidR/ScaLR/2DPASS-style image-to-LiDAR distillation | Uses 2D semantics during training while keeping the deployed artifact LiDAR-only | Calibration, exposure, and viewpoint errors become training-data quality risks |
| Existing SLAM map and small review budget | Auto-label from map -> reviewer correction -> pseudo-label consolidation -> semi-supervised scan refinement | Map-level verification is cheaper than per-scan annotation and produces back-projected training labels | SLAM drift, dynamic ghosts, and static-but-wrong objects can scale into label errors |
| Multi-site rollout with one strong backbone | PEFT adapters after the site-specific fine-tune | Per-site adapter files are cheap to train and version | Rank selection and adapter/backbone compatibility must be release-gated |
| Rare safety classes dominate risk | Active learning on top of the current best model | Annotation budget goes to uncertain, rare, and high-impact regions first | Cold-start uncertainty is weak; seed with class-stratified random labels before relying on acquisition scores |

### Map-Scale Architecture x Training Route Matrix

The tables above compare supervision regimes. For an aggregated LiDAR map, the training decision is only complete after choosing the backbone family and the release contract together. The same training paradigm has different risk depending on whether the backbone is sparse-conv, PTv3/Sonata, SPT, projection-based, or an emerging SSM/Mamba model.

| Backbone family | Default training route | Why this pairing fits map segmentation | Advantages | Disadvantages / controls |
|---|---|---|---|---|
| Sparse-conv U-Net / MinkowskiNet / SpConv | Supervised or semi-supervised fine-tune from public LiDAR pre-training, then map auto-label flywheel | Sparse tensors are predictable on tiles and align with voxelized release artifacts | Strong production baseline, mature tooling, stable convergence, clear TensorRT path | Thin classes can vanish at coarse voxel sizes; run rare-class sampling and wire/marking recall gates |
| KPConv / RandLA-Net | Fully supervised or weakly supervised baseline plus active learning | Raw-point neighborhoods preserve geometry where voxel grids blur fine structure | Good reference for poles, kerbs, wires, facade edges, and markings | Neighbor search and sampling cost are high; enforce class-balanced sampling so rare structures are not dropped |
| Superpoint Transformer / SuperCluster | Weak/semi-supervised or map auto-label route after geometry partition QA | Superpoints match the object/surface granularity of registered maps and reduce tile fragmentation | Efficient whole-scene context, low memory, strong small-label-budget fit | Partition errors are upstream errors; validate superpoint boundary recall before trusting model metrics |
| PTv3 / Sonata / PPT-style transformer | SSL or supervised multi-dataset pre-training -> domain-continuation SSL -> PEFT/full fine-tune | High-capacity transformer pays off only when pre-training absorbs the label hunger | Highest ceiling, strongest 2024-2026 checkpoint ecosystem, good LiDAR-only inference path | Finicky from scratch; require linear probe, warmup schedule, tile-halo ablation, and domain-specific validation |
| Projection / WaffleIron-style | Cross-modal distillation or supervised LiDAR-only training with strong deployment tests | Dense 2D operations are easy to optimize and audit | Clean dependency footprint, simple inference, good edge-deployment candidate | Projection resolution is a hard detail limit; validate facade/vertical and long-thin infrastructure classes |
| LiDAR-image late/feature fusion | Train-time distillation when possible; direct fusion only for offline map-labeling jobs | Images help appearance-defined classes but should not be mandatory for runtime map loading unless the product contract says so | Better color/texture semantics, useful for GridNet-HD-like assets and facade labels | Calibration and image coverage become data-quality risks; store projection provenance and provide LiDAR-only fallback |
| SSM / Mamba point backbones | Experimental branch initialized from strongest available checkpoint, evaluated with same tile manifests as mature baselines | Linear sequence cost may increase context radius without transformer memory growth | Attractive for large urban districts where seams and context loss dominate | Research-stage; audit ordering sensitivity, rotation robustness, density shift, and stitching consistency before production use |

Two rules keep this matrix practical:

- **Start conservative, then add capacity.** A sparse-conv or SPT baseline with clean tiles, labels, and map hygiene usually beats a larger model trained on contaminated maps. Upgrade to PTv3/Sonata or SSM only after the source-map QA and split discipline are stable.
- **Make camera use a training decision, not a hidden runtime dependency.** Cross-modal distillation, map colorization, and image-assisted review are excellent for offline learning; a released semantic map should still declare whether its labels can be reproduced from LiDAR-only evidence or require RGB provenance.

---

## Recommended Layered Recipe for Airside

The following staged pipeline maximizes segmentation accuracy while minimizing manual annotation cost for a greenfield airport apron deployment. Each stage builds on the previous; the ordering reflects both technical dependencies and practical scheduling constraints. See [Aggregated-Map Semantic Segmentation](aggregated-map-semantic-segmentation.md) §14.4 airside path for the production-readiness context.

Backbone selection is deliberately left to the aggregated-map hub (§7.8 and §11). This recipe assumes the project has already chosen a conservative LiDAR-only sparse-conv or SPT baseline, then optionally swaps in PTv3/Sonata after pre-training evidence exists. The stages below are the supervision and adaptation ladder around that backbone.

Cost, schedule, and output quantities in this staged airside recipe are internal planning estimates for a rollout scenario, not reported UniLiPs, SALT, or LaserMix benchmark results.

**Stage 0 — Foundation pre-training (before site deployment)**
Start from a publicly available PPT checkpoint (pre-trained on SemanticKITTI, nuScenes, Waymo, S3DIS). Optionally continue SSL pre-training via Sonata-style self-distillation on any available unlabeled LiDAR logs from road or logistics domains to strengthen geometric representations. Cost: zero new labels; compute is a one-time investment. Output: a strong backbone that understands geometric structures, surfaces, and common outdoor classes before any airside data is collected.

**Stage 1 — Sim-to-real rare-class bootstrapping (weeks 1–4)**
Build or adapt a CARLA-based airside simulator (reuse road models; add aircraft, GSE vehicle, jet bridge, taxiway marking, and fuel hydrant assets). Generate 20k synthetic labeled scans with RareBoost3D-style rare-class over-sampling for aircraft, fuel trucks, ground crew, wildlife, and jet bridges. Pre-train the Stage 0 backbone on synthetic data. Cost: simulator build as engineering effort; near-zero annotation cost. Output: a model that can recognize airside-specific vocabulary even before seeing real data, particularly for rare safety-critical classes.

**Stage 2 — SLAM map construction and auto-labeling (weeks 4–8)**
Run SLAM during initial site survey drives (or use existing survey data). Segment the aggregated map using the Stage 0/1 model plus human correction at map level — not per scan. Apply dynamic object filtering (moving aircraft, GSE, ground crew). Back-project labels to all constituent scans using UniLiPs-style pipeline. Apply per-point confidence filtering based on view-count and multi-scan agreement. Cost: approximately 1 human-day of map-level verification per apron zone versus months of per-scan annotation. Output: 50k–200k pseudo-labeled scans of the target airport at near-zero marginal annotation cost.

**Stage 3 — LaserMix semi-supervised refinement on ~1k human labels (weeks 6–10)**
Sample 500–2,000 human-verified scans actively (prioritizing high-uncertainty regions — see Stage 4) as the labeled set. Use the full pseudo-labeled corpus from Stage 2 as the unlabeled pool. Train with LaserMix consistency plus teacher-student, with the Stage 0/1 SSL checkpoint as teacher initialization. Cost: 500–2,000 fully labeled scans. Output: model approaching 90–95 % of fully supervised ceiling on site-specific classes.

**Stage 4 — Active learning loop (ongoing)**
Score remaining unlabeled operational logs by model uncertainty using LiDAL inter-frame uncertainty or SELECT submodular acquisition. Route high-uncertainty scans — weather conditions, night operations, rare GSE configurations, novel obstacles — to human annotators. Retrain incrementally after each labeling round. Each round costs a fixed annotation budget (e.g., 100 human-labeled scans per week); uncertainty targeting ensures rare safety-critical cases are covered first rather than wasting budget on easy common-class scans. Output: continuous improvement with guaranteed coverage of novel scenarios as they appear during live operations.

**Stage 5 — PointLoRA PEFT adapters per airport (per-site, ongoing)**
When deploying to a second or subsequent airport, freeze the Stage 3/4 backbone. Insert LoRA adapters at rank r = 8–16 and train only these on 200–500 site-specific labeled scans. Each airport maintains its own lightweight adapter file swappable at inference without reloading the backbone. Cost: ~200–500 labeled scans and hours of compute per site. Output: per-airport specialized models at 3.43 % of trainable parameter cost with no full retraining required.

**Stage 6 — Continual TTA in production (real-time)**
Deploy the Stage 5 model with a lightweight TTA module (D3CTTA or APCoTTA-style) that adapts batch-norm or final-layer statistics to current weather, lighting, and sensor conditions in real time. No labels are required. Cost: inference overhead only (~5–10 ms per scan on Orin). Output: graceful degradation handling for adverse conditions including rain, fog, bird-strike debris on the apron, and night operations.

```
Stage 0: PPT multi-dataset checkpoint (public, zero new labels)
Stage 1: Sim pre-training for airside rare classes (engineering cost, zero annotation)
Stage 2: SLAM map auto-labeling with UniLiPs back-projection (10–20x cheaper than per-scan)
Stage 3: LaserMix semi-supervised fine-tune on ~1k human labels + large pseudo-labeled pool
Stage 4: Active learning loop — ongoing, budget-controlled, rare-class targeted
Stage 5: PointLoRA PEFT adapters per airport site (200–500 labels and hours/site)
Stage 6: Continual TTA in production for distribution shift (no labels, ~5–10 ms/scan)
```

This layered approach front-loads the most expensive work (map construction, which is needed for localization in any case) and reduces per-scan annotation cost to the absolute minimum while maintaining a clear path to high accuracy on safety-critical classes. Total human annotation for a new airport: approximately 500–2,000 verified scans for Stage 3 plus ongoing active-learning budget — compared with the 8–12 months of annotation that fully supervised from-scratch training would require for the same domain.

### Stage-by-stage cost and output summary

| Stage | Paradigm used | Labels required | Compute | Output |
|---|---|---|---|---|
| 0 | Supervised multi-dataset pre-train (PPT) + optional SSL continuation | Zero new labels (public data) | One-time, high | Strong general backbone |
| 1 | Sim-to-real synthetic pre-training (RareBoost3D) | Near zero (synthetic GT) | Moderate render | Airside-vocab model |
| 2 | Auto-label from aggregated SLAM map (UniLiPs) | Internal planning estimate: ~1 human-day/zone (map review) | One-time SLAM + map seg | Internal planning target: 50k–200k pseudo-labeled scans |
| 3 | LaserMix semi-supervised | 500–2,000 fully labeled scans | 1.5–2× supervised | 90–95 % of supervised ceiling |
| 4 | Active learning (LiDAL / SELECT) | ~100/week ongoing budget | Moderate + pool scoring | Continuous rare-class coverage |
| 5 | PointLoRA PEFT per airport | 200–500 labeled scans/site | Very low (RTX 4090 class) | Per-site adapter, no full retrain |
| 6 | Continual TTA (APCoTTA / D3CTTA) | Zero | ~5–10 ms/scan overhead | Graceful adverse-condition handling |

### Data flywheel progression

The recipe above implements a data flywheel: each operational kilometer driven or flight serviced generates new unlabeled scans; the auto-labeling pipeline converts those scans into pseudo-labeled training data; the semi-supervised and active learning stages refine quality; PEFT adapters propagate improvements to new sites at low cost. The flywheel is self-reinforcing — model quality improves over time without proportional growth in annotation cost, which is the defining property that makes large-scale airside deployment economically viable.

Key flywheel metrics to track:
- Pseudo-label precision on rare classes (target: >70 % before using for training)
- Per-class IoU trajectory across active learning rounds (target: monotonically increasing for safety-critical classes)
- Per-site adapter fine-tune data efficiency (track labeled-scans-required vs. mIoU gain curve per airport)
- TTA entropy trend over deployment time (rising entropy signals model staleness; trigger retraining)

### Paradigm interaction map

The stages above are not the only valid combination. The following table summarizes which paradigms compose cleanly together:

| Paradigm A | Paradigm B | Compatibility |
|---|---|---|
| SSL pre-train (Sonata) | Supervised fine-tune (any) | Composable — SSL checkpoint initializes supervised fine-tune |
| Cross-modal distillation (ScaLR) | PEFT (PointLoRA) | Composable — distilled checkpoint fine-tuned with LoRA adapters |
| Sim-to-real pre-train | Domain adaptation (UDA) | Composable — sim pre-train + UDA bridges sim-to-real gap |
| Weakly supervised (scribbles) | SSL pre-train | Composable — SSL initializes model; scribble fine-tune is label-efficient |
| Semi-supervised (LaserMix) | Active learning | Composable — active labels form the supervised component of LaserMix |
| Auto-label from map | Semi-supervised | Composable — map pseudo-labels serve as the unlabeled pool in LaserMix |
| TTA (APCoTTA) | Any fine-tuned model | Composable — TTA is a post-deployment wrapper on any trained checkpoint |
| Supervised multi-dataset pre-train | SSL pre-train (same backbone) | Sequential: SSL → supervised fine-tune yields additive gains |
| Weakly supervised | Auto-label from map | Caution — both produce noisy labels; combining amplifies error accumulation |
| Sim-to-real | Auto-label from map | Caution — sim pre-train + map labels may double-count domain adaptation steps; validate carefully |

---

## Trade-offs and Pitfalls

**Pseudo-label error propagation.** Both semi-supervised and auto-labeling from map paradigms use pseudo-labels, which accumulate errors preferentially on rare and ambiguous classes. Mitigation: apply per-point confidence thresholding; use active learning to prioritize rare-class human verification; monitor per-class IoU on a held-out verified set at each training round rather than only overall mIoU.

**Domain-continuation neglect.** SSL and cross-modal distillation pre-training on road data (the dominant source) may produce representations that do not generalize to airside geometry. The geometric shortcut fix in Sonata helps, but continuation pre-training on unlabeled airside scans is strongly recommended before fine-tuning on labeled airside data. Do not assume road-pre-trained checkpoints are ready for fine-tuning without validation on airside validation scans.

**Taxonomy mismatch at fine-tuning.** Supervised multi-dataset checkpoints (PPT, M3Net) use road and indoor vocabularies. Fine-tuning on airside data requires remapping the existing head to the new taxonomy. Novel classes (aircraft, jet bridge, GSE vehicle types) that have no counterpart in the pre-trained head require new classifier heads initialized from scratch — which partially negates the transfer benefit for those classes. Design the label map before starting fine-tuning, not after.

**SLAM drift under pseudo-label back-projection.** Back-projected labels are only as accurate as the SLAM pose estimates. In large airports where SLAM drift accumulates over long mapping runs, a 20–50 cm pose error translates to systematic point misassignment at class boundaries (pavement / terrain, pavement / marking). Mitigation: use loop-closure-optimized pose graphs and validate map registration accuracy before back-projection; apply a per-point minimum-view-count threshold to suppress label propagation in drift-affected zones.

**Cold-start in active learning.** The first active learning round has no reliable uncertainty estimates — the initial model is underfit. Mitigation: start with random sampling for the first 200–500 labeled scans, then switch to uncertainty-based acquisition once the model has sufficient coverage of the class distribution. DiscwiseAL and SELECT are explicitly designed to handle early-round instability.

**PEFT rank underspecification.** LoRA rank r controls representational capacity. For large distribution shifts (road → airside), r = 4 is likely too small; r = 16–32 is recommended as a starting point. Validation on a held-out airside set is essential; do not assume convergence based on training loss alone.

**Safety metric gap.** Overall mIoU is the standard benchmark metric but is not a safety metric. Rare safety-critical classes (ground crew near aircraft, wildlife on runway) can have near-zero IoU while overall mIoU appears acceptable. Always report per-class IoU for safety-critical classes separately and apply Importance-Aware Loss or inverse-frequency weighting for those classes during training. See [3D Segmentation Class Taxonomy Design](3d-segmentation-class-taxonomy-design.md) §Safety-Criticality Weighting.

**TTA catastrophic forgetting.** Continual TTA adapts model parameters without access to source data, creating the risk of forgetting general features as distribution continues to shift. APCoTTA's Randomized Parameter Interpolation (RPI) module specifically addresses this. Without RPI or an equivalent replay mechanism, long-running TTA can degrade significantly on classes that become rare in the recent stream.

**Weakly supervised rare-class miss.** ScribbleKITTI's 95.7 % figure is computed over the full 19-class SemanticKITTI taxonomy where dominant stuff classes carry most of the mIoU weight. Rare airside classes (jet bridges, ground power units, wildlife) may not be represented at all in the scribble annotation pass if annotators skip rare objects. Mitigation: during scribble annotation, provide mandatory coverage targets per class — require annotators to draw at least one scribble over every rare-class instance visible in each scan rather than allowing selective labeling of easy-to-reach classes. Combine with active scan selection to ensure rare-class scans appear in the scribble annotation pool.

**Negative transfer in naive multi-dataset joint training.** M3Net confirms that naive joint training across SemanticKITTI, nuScenes, and Waymo causes significant mIoU degradation without the language-guided alignment and union label-space management. If using PPT or M3Net checkpoints, do not strip the prompt mechanism and treat the checkpoint as a plain supervised model — the prompt token is load-bearing. Fine-tuning without prompts will partially destroy the multi-domain representations.

**Sim-to-real over-reliance.** Synthetic pre-training is powerful for rare classes but creates a risk of anchoring the model to synthetic sensor geometry. If the real deployment sensor differs substantially from the CARLA sensor model (beam pattern, vertical resolution, intensity encoding), the model may learn features that are irrelevant or misleading on real data. Always validate sim pre-trained models on a held-out real validation set before Stage 2 map labeling; if validation mIoU is below 30 % on common classes, the synthetic pre-training may be doing more harm than good and should be used only for fine-tuning initialization, not for map-level segmentation.

**Semi-supervised instability at very low label fractions.** LaserMix and MixSeg3D both assume that the small labeled set is reasonably class-balanced. At 1 % label fractions, a random sample of 190 SemanticKITTI scans may contain zero instances of person or bicyclist. For airside, a 1 % random sample may similarly exclude all jet bridge or GSE scans. Use class-stratified sampling when constructing the initial labeled set — ensure that every taxonomy class appears in at least 5–10 labeled scans before beginning semi-supervised training. This constraint is especially binding for taxonomies with 10+ airside-specific classes.

---

## Implementation Notes

- **Checkpoints first.** Before committing to any from-scratch or SSL pre-training, verify whether a public PPT, Sonata, or ScaLR checkpoint covers your target domain sufficiently for fine-tuning. For airside, download the checkpoint and run linear probing on 100–200 labeled airside scans; if LP mIoU exceeds 35–40 % across common classes, the checkpoint is worth fine-tuning from.
- **Validate pseudo-label quality before training.** For both auto-labeling from map and semi-supervised training, compute pseudo-label precision and recall against a small hand-labeled validation set (50–100 scans) before using pseudo-labels for training. Noisy pseudo-labels are worse than no pseudo-labels for rare classes.
- **LaserMix implementation detail.** LaserMix interleaves laser rings from two scans, not arbitrary point samples. The ring-interleaving implementation assumes a rotating multi-beam LiDAR with well-defined ring IDs. Solid-state LiDAR (MEMS-based, flash) does not have ring structure — use MixSeg3D's voxel-level mixing instead.
- **LoRA integration with quantization.** For on-vehicle inference on NVIDIA Orin, quantize the frozen backbone to INT8 and keep LoRA adapter weights in FP32. The adapter contributes only 3.43 % of parameters, so FP32 adapter overhead is negligible while avoiding quantization-induced degradation of the fine-tuned representations.
- **Dynamic object removal before map back-projection.** Do not skip dynamic removal. Even a single aircraft in motion in the map creates a smeared ghost that corrupts pavement labels in its sweep area. Use a moving object segmentation model or a simple consistency-count filter (points visible in fewer than N scans are candidates for removal) before map-level segmentation.
- **Active learning acquisition frequency.** Running uncertainty scoring over a large unlabeled pool (100k+ scans) at every training epoch is prohibitively expensive. Recommended practice: score the pool every 5–10 training epochs; select a fixed budget batch; send to annotation. Scoring on a representative subset (10 % of pool, sampled by diversity) reduces cost further.
- **Monitor per-class IoU at every stage.** Do not rely on overall mIoU as the single training signal. Safety-critical classes (ground crew, wildlife, GSE near aircraft) can be silently underfit while overall mIoU appears healthy. Set per-class IoU thresholds as minimum criteria for stage advancement, not aggregate metrics.
- **TARL for airside sequential pre-training.** If multi-scan temporal sequences are available during SSL pre-training, prefer TARL over PointContrast / DepthContrast for outdoor LiDAR. TARL tracks instances across frames to build temporally consistent object-level representations, which is particularly valuable for GSE vehicles that appear repeatedly in similar configurations across operational log sequences.
- **Staged deployment of adapters.** When deploying PointLoRA adapters per airport, maintain a registry mapping airport ICAO code → adapter file path and backbone hash. The backbone hash ensures adapter–backbone version compatibility across OTA updates; a mismatch will produce corrupted predictions without an obvious failure signal.
- **Calibration stability for cross-modal distillation.** LiDAR-camera extrinsic calibration drifts with temperature, mechanical vibration, and maintenance cycles. Distillation pre-training with calibration errors > 5 cm / 0.5° introduces systematic feature misalignment. Validate calibration residuals before distillation runs; use a robust calibration protocol and store calibration version alongside the pre-training checkpoint.
- **Evaluation split discipline.** Pseudo-labeled scans must never leak into the validation or test split. When building the training corpus from Stage 2 map auto-labeling, define the held-out validation set from manually labeled scans before beginning pseudo-label generation and exclude those validation scan timestamps from the back-projection pipeline. Cross-contamination between pseudo-labeled training data and the validation split produces optimistic metrics that do not reflect real deployment accuracy.
- For tiling and throughput considerations in large-scale map segmentation see [Large-Scale 3D Segmentation Tiling and Throughput](large-scale-3d-segmentation-tiling-and-throughput.md). For open-vocabulary handling of novel airside classes see [MoSaic3D](../methods/mosaic3d.md).

---

## Sources

**Cross-links (this knowledge base):**
- [Aggregated-Map Semantic Segmentation](aggregated-map-semantic-segmentation.md) — §7.6 self-supervised pre-training; §7.8 model-family training-lens comparison; §12 production practice; §14.4 airside path
- [LiDAR Semantic Segmentation](lidar-semantic-segmentation.md) — single-scan perception context and dynamic removal methods
- [Self-Supervised Pre-Training for Driving](self-supervised-pretraining-driving.md) — driving-domain SSL survey
- [LiDAR Foundation Models](lidar-foundation-models.md) — foundation model landscape for 3D
- [3D Segmentation Class Taxonomy Design](3d-segmentation-class-taxonomy-design.md) — taxonomy design, safety-criticality weighting, cross-dataset harmonization
- [Large-Scale 3D Segmentation Tiling and Throughput](large-scale-3d-segmentation-tiling-and-throughput.md) — map-scale inference and tiling
- [Foundation Model Training First Principles](../../../10-knowledge-base/machine-learning/foundation-model-training-first-principles.md) — LoRA derivation, adapter theory
- [Point Transformer V3](../methods/point-transformer-v3.md) — PTv3 architecture and Sonata details
- [2DPASS](../methods/2dpass.md) — cross-modal distillation implementation
- [MoSaic3D](../methods/mosaic3d.md) — open-vocabulary 3D segmentation for novel airside classes

**Related pages (adjacent topics):**
- [Large-Scale 3D Segmentation Benchmarks](../datasets-benchmarks/large-scale-3d-segmentation-benchmarks.md) — cross-dataset taxonomy mismatch table and benchmark leaderboards

**Primary papers:**
- PPT (CVPR 2024): https://arxiv.org/abs/2308.09718
- M3Net (CVPR 2024): https://arxiv.org/abs/2405.01538
- Sonata (CVPR 2025 Highlight): https://arxiv.org/abs/2503.16429
- PTv3 (CVPR 2024 Oral): https://arxiv.org/abs/2312.10035
- PointLoRA (CVPR 2025): https://arxiv.org/abs/2504.16023
- Geometry-Enhanced PEFT (2025): https://arxiv.org/abs/2505.22444
- ScribbleKITTI (CVPR 2022 Oral): https://arxiv.org/abs/2203.08537
- LESS (ECCV 2022): https://arxiv.org/abs/2210.08064
- LaserMix (CVPR 2023): https://openaccess.thecvf.com/content/CVPR2023/papers/Kong_LaserMix_for_Semi-Supervised_LiDAR_Semantic_Segmentation_CVPR_2023_paper.pdf
- RepL (2025): https://arxiv.org/abs/2604.06825
- SLidR (CVPR 2022): https://arxiv.org/abs/2203.16258
- 2DPASS (ECCV 2022): https://arxiv.org/abs/2207.04397
- ScaLR (CVPR 2024): https://github.com/valeoai/ScaLR
- Seal (NeurIPS 2023 Spotlight): https://arxiv.org/abs/2306.09347
- xMUDA (CVPR 2020): https://arxiv.org/abs/1911.12676
- DODA (ECCV 2022): https://arxiv.org/abs/2204.01599
- APCoTTA (2025): https://arxiv.org/abs/2505.09971
- D3CTTA (CVPR 2025): (see paper for URL)
- Occupancy-MAE (TIV 2023): https://arxiv.org/abs/2206.09900
- PonderV2 (2023/2024): https://arxiv.org/abs/2310.08586
- SegContrast (RA-L 2022): https://ieeexplore.ieee.org/document/9681336
- RareBoost3D (2025): https://arxiv.org/abs/2510.10876
- SynLiDAR: https://arxiv.org/abs/2107.05399
- SynthmanticLiDAR (2025): https://arxiv.org/abs/2501.19035
- UniLiPs (3DV 2026): https://arxiv.org/abs/2601.05105
- LiDAL (2022): https://arxiv.org/abs/2211.05997
- Annotator (NeurIPS 2023): https://arxiv.org/abs/2310.20293
- DiscwiseAL / DiAL (2023): https://arxiv.org/abs/2309.13276
- SELECT (2025): https://arxiv.org/abs/2505.11516
