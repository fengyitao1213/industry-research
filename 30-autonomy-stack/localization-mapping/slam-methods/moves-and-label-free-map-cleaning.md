# MOVES and the Label-Free Map-Cleaning Family

<!-- method-priority:start
priority:
  learning: 4
  deployment: 5
  type: "method-family"
  stage: "deployment-pattern"
  maturity: "pilot-proven"
  tags: ["slam", "mapping", "validation", "runtime-localization", "outdoor"]
  reason: "MOVES and the label-free map-cleaning family provide dynamic-object filtering and map-cleaning without requiring human-labeled training data — strategically important for airside and industrial domains."
method-priority:end -->

Related docs: [LiDAR Map Cleaning — Dynamic Removal](lidar-map-cleaning-dynamic-removal.md), [ERASOR](erasor.md), [ERASOR++](erasor-plus-plus.md), [FreeDOM](freedom-dynamic-object-removal.md), [MapCleaner](mapcleaner.md), [DR-Remover](dr-remover.md), [DO-Removal LIO](do-removal-lio.md), [Dynamic-Aware LIO / BTSA](dynamic-aware-lio-btsa.md), [SD-SLAM Semantic Dynamic LiDAR](sd-slam-semantic-dynamic-lidar.md), [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md), [LT-Mapper / Khronos Lifelong Mapping](lt-mapper-khronos-lifelong-mapping.md), [LiDAR Artifact Removal Techniques](../../perception/overview/lidar-artifact-removal-techniques.md), [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md).

**Last updated:** 2026-05-23

---

## What It Is

MOVES is a **GAN-based generative domain-translation method** for label-free LiDAR scene segmentation published by the IIT Delhi group (Prashant Kumar, Dhruv Makwana, Onkar Susladkar, Anurag Mittal, Prem Kumar Kalra).

**Full citation:**
Prashant Kumar, Dhruv Makwana, Onkar Susladkar, Anurag Mittal, Prem Kumar Kalra.
"MOVES: Movable and Moving LiDAR Scene Segmentation in Label-Free settings using Static Reconstruction."
*Pattern Recognition*, Volume 155, November 2024, article 110651.
DOI: 10.1016/j.patcog.2024.110651
arXiv: 2306.14812 (submitted June 26, 2023; revised October 15, 2023)
ScienceDirect: https://www.sciencedirect.com/science/article/abs/pii/S0031320324004023

**Disambiguation — critical accuracy note.** MOVES is NOT a "Movable Object Voxel Encoding" method. No such paper with that framing has been confirmed in the literature as of May 2026. MOVES is a GAN-based generative static-reconstruction framework — closer in spirit to image-to-image translation than to voxel classification heads. The companion preprint MOVESe (OpenReview: https://openreview.net/forum?id=tDB6QxanjU) is an earlier or parallel workshop submission by the same IIT Delhi authors; the Pattern Recognition paper is the primary peer-reviewed version. No public GitHub repository for either MOVES or MOVESe has been confirmed as of May 2026 — flag this before any deployment integration.

MOVES sits within a broader **label-free learned map-cleaning family** — methods that learn dynamic-point removal representations but do so from self-supervision signals present in raw LiDAR logs, without any human-labeled training points. This family occupies the middle ground between fully classical (geometry-only, zero training) methods such as [ERASOR](erasor.md), [FreeDOM](freedom-dynamic-object-removal.md), and [MapCleaner](mapcleaner.md), and supervised-semantic methods such as [SD-SLAM](sd-slam-semantic-dynamic-lidar.md) and SuMa++ that consume human-labeled class corpora.

---

## Core Technical Idea

MOVES frames dynamic-point removal as **generative domain translation**: given a LiDAR scan of a dynamic scene (one containing ghost points and transient objects), a trained generator produces the corresponding *static* reconstruction — what the scan would look like with all movable and moving objects removed and any occluded static structure filled in behind them.

This is architecturally distinct from ERASOR-style methods, which merely suppress geometric points that appear inconsistent across passes without filling the voids those removals leave. MOVES does two things simultaneously: (a) removes dynamic residuals and (b) inpaints the static background structure that was occluded by those objects. In narrow environments (jetbridge corridors, warehouse aisles, apron bay entrances) this inpainting materially improves localization landmark density in the cleaned map.

The supervision signal requires **paired frames** — a scan of the same location captured with and without dynamic occupants. No semantic class annotations are needed, only the geometric pairing. MOVES-MMD extends the framework with unsupervised domain adaptation (Maximum Mean Discrepancy minimisation) to handle target domains where paired correspondence data is unavailable, by transferring from a source domain where it is.

The broader label-free family exploits several different self-supervision signals that are all obtainable from raw LiDAR logs at map-build time:

1. **Free-space carving.** A later ray that passes through a region where a prior scan placed a point invalidates that point. Core to classical methods and usable as a pseudo-label source.
2. **Cross-frame temporal inconsistency.** A point present at scan t but absent at t+k signals dynamic occupancy. MOVES leverages this via the static/dynamic scan pair.
3. **Multi-traversal ephemerality.** Points that do not persist across multiple route traversals are mobile. Core to MODEST (CVPR 2022).
4. **Scene-flow motion vectors.** Self-supervised flow estimation identifies points with non-zero residual velocity after ego-motion subtraction. Used by LISO (ECCV 2024) and SeMoLi (CVPR 2024).
5. **Temporal overlapping prediction.** Pretraining on which overlapping points between adjacent scans are transiently vs. persistently occupied. Used by TOP (ICCV 2025).

---

## Operator Mechanics

### DCGAN Generator

MOVES uses a **DCGAN-style convolutional generator** operating on a range-image or BEV (bird's-eye-view) projection of the input point cloud. The generator takes the dynamic scene as input and must output the cleaned static reconstruction. Deep convolutional layers learn to identify structural regularities of the environment and suppress transient perturbations, analogous to visual inpainting but applied to sparse LiDAR geometry.

### Couple Discriminator (CoD)

Standard single-input GAN discriminators receive only the generated output and attempt to classify it as real or fake. MOVES proposes a **Couple Discriminator (CoD)** that receives both the generated static scan and the real static reference scan jointly. This paired evaluation enables the discriminator to enforce structural consistency between the generated output and the ground-truth static reference — a stricter constraint than discriminating the generated output in isolation.

### Loss Function

The total training loss integrates three components:

```
L_MOVES = L_LS_GAN(G, CoD) + lambda_CL * L_contrastive(G(d), s+, s-)

where:
  G(d)  = generator output given dynamic scan d
  s+    = paired real static scan (positive example, same location)
  s-    = static scan from a different location (hard-negative)
  lambda_CL = contrastive weight (exact published value not confirmed
              from publicly accessible metadata)
```

**Least-Squares GAN objective (LS-GAN).** Replaces binary cross-entropy with squared-error to stabilise training and reduce mode collapse on sparse LiDAR geometry.

**Contrastive triplet loss (CL).** Constructs triplets (anchor = dynamic scan, positive = co-located real static scan, negative = hard-mined static scan from a different location). The contrastive term pulls generator outputs toward the correct static scene and pushes them away from unrelated geometry, enforcing structural fidelity beyond what the adversarial term alone provides.

**Hard-Negative Mining (HNM).** Triplet negatives are not random. Structurally similar but semantically distinct scans are mined as hard negatives, focusing the contrastive signal on fine geometric distinctions that the generator must learn to respect.

### MOVES-MMD — Domain Adaptation Extension

```
L_MOVES-MMD = L_MOVES + lambda_MMD * MMD(phi_source, phi_target)

where:
  phi_source = feature distribution in source domain (paired data available)
  phi_target = feature distribution in target domain (no pairing available)
  MMD        = Maximum Mean Discrepancy across a reproducing kernel Hilbert space
```

MMD minimises the distributional distance between source and target feature spaces, allowing the generator trained on a paired source domain to produce structurally coherent static reconstructions in a target domain where only single-pass survey data exists. This is the primary mechanism for deploying MOVES in first-survey airside settings. Quantitative performance degradation versus the base paired-data MOVES has not been confirmed from public sources; treat the MMD variant as an approximation layer with unverified quality bounds.

---

## Inputs and Outputs

| Item | Role |
|---|---|
| Dynamic LiDAR scan (range image or BEV projection) | Primary input to the DCGAN generator |
| Paired static scan of the same location | Supervision signal for the Couple Discriminator and contrastive triplet positive |
| Hard-negative static scan (different location) | Contrastive triplet negative, mined for structural similarity |
| Unpaired target-domain scans | Input for MOVES-MMD domain adaptation |
| Generator output — static reconstruction | Cleaned static scene with inpainted background structure |
| Dynamic/movable mask | Residual between input dynamic scan and static reconstruction — points to remove from map |
| Cleaned aggregated map | Final product: static LiDAR map suitable for localization and semantic segmentation |

---

## Architecture

```
Input: dynamic LiDAR scan d
         |
         v
  DCGAN Generator (G)
  [convolutional encode-decode; range-image or BEV domain]
         |
         v
  Generated static reconstruction  G(d)
         |               |
         v               v
  Couple Discriminator (CoD)      Contrastive Loss module
  [G(d) + real static s+ jointly]  [triplet: G(d), s+, s-]
         |                               |
         v                               v
  L_LS_GAN                         L_contrastive (+ HNM)
         |_______________|
                  |
                  v
          L_MOVES  (base loss)
                  |
        +---------+---------+
        |                   |
  [Paired data]     [Unpaired target domain]
  Base MOVES               MOVES-MMD
                    + lambda_MMD * MMD(phi_src, phi_tgt)
```

---

## Training

**Paired-data regime (base MOVES).**
Training uses paired dynamic/static frame sets. The DCGAN generator is trained end-to-end against the Couple Discriminator using the joint LS-GAN + contrastive loss. No per-point semantic labels are needed — the pairing itself provides the supervision signal.

**Simulation.** CARLA-64 (the CARLA autonomous driving simulator, 64-beam LiDAR) provides dense, noise-free paired dynamic/static frames across four sequences, divided into train and validation splits.

**Real-world transfer.** An urban real-world LiDAR dataset (sensor type and city not specified in publicly accessible abstracts) provides real-distribution paired frames for training or fine-tuning.

**MOVES-MMD regime.**
For target domains without paired correspondence, the source-domain trained generator is extended with MMD minimisation over features extracted from source and target sequences. No paired data is needed in the target domain; only raw single-pass scans are required.

---

## Benchmark Results

**Datasets evaluated:**

| Dataset | Type | Sensor |
|---|---|---|
| CARLA-64 | Simulated urban, 64-beam LiDAR, four sequences | CARLA virtual sensor |
| Urban real-world | Real LiDAR, urban driving environment | Not specified publicly |
| Sparse industrial | Real LiDAR, challenging sparse industrial setting | Not specified publicly |

**Evaluation framing.** MOVES is evaluated as a **navigation and SLAM improvement tool**. The cleaned static reconstruction is fed into a downstream SLAM/navigation system, and the navigation performance (trajectory error, localisation quality) is measured. This differs from the PR/RR/F1 static-removal framing used on the KTH DynamicMap Benchmark by [ERASOR](erasor.md), [FreeDOM](freedom-dynamic-object-removal.md), and [MapCleaner](mapcleaner.md).

**Published claim.** MOVES "performs better than segmentation-based navigation baseline in highly dynamic and long LiDAR sequences without utilising segmentation labels." A downstream navigator fed MOVES-cleaned maps outperforms one fed label-based semantic filtering (class-based dynamic removal used as a baseline).

**Honest flag — PR/RR/F1 not confirmed.** Precise precision-recall-F1 metrics on SemanticKITTI sequences are not confirmed from publicly accessible sources as of May 2026. The full quantitative tables are in the Pattern Recognition journal paper (paywalled). MOVES has not been submitted to the KTH DynamicMap Benchmark. Direct numerical comparison with ERASOR, ERASOR++, FreeDOM, or MapCleaner on standardised removal metrics is not currently possible.

**KTH benchmark context (for reference):**

| Method | Category | Best published F1 | Notes |
|---|---|---|---|
| FreeDOM | Classical unsupervised | 99.59% (KITTI seq 02) | Online; RA-L 2025 |
| ERASOR++ | Classical unsupervised | 0.930–0.986 | Height-coded descriptor |
| OTD | Classical (observation time) | 0.975–0.988 | Online |
| MOVES | Label-free GAN | Not benchmarked on KTH or PR/RR/F1 | Pattern Recognition 2024 |
| LISO, SeMoLi | Label-free scene flow | Not benchmarked on removal PR/RR/F1 | Detection task |
| TOP | Label-free pretraining | +28.77% rel. on MOS IoU | ICCV 2025 |

---

## The Broader Label-Free Map-Cleaning Family

Label-free learned methods occupy the middle position in the training-data trilemma:

| Position | Representative methods | Training data required |
|---|---|---|
| Classical unsupervised | ERASOR, FreeDOM, Removert, MapCleaner, DR-Remover | None — pure geometry / ray-casting |
| **Label-free learned** | **MOVES, MODEST, LISO, SeMoLi, TOP, UniLiPs** | **No human labels — pseudo-labels from geometry or self-supervision** |
| Supervised semantic | SD-SLAM, SuMa++, RangeNet++, 4DMOS | Human-labeled training sets (SemanticKITTI or equivalent) |

### MODEST — Multi-Traversal Ephemerality (CVPR 2022)

**Paper:** Yurong You, Katie Z Luo, Cheng Perng Phoo, Wei-Lun Chao, Wen Sun, Bharath Hariharan, Mark Campbell, Kilian Q. Weinberger. "Learning to Detect Mobile Objects from LiDAR Scans Without Labels." CVPR 2022.
arXiv: https://arxiv.org/abs/2203.15882 | GitHub: https://github.com/YurongYou/MODEST

**Mechanism.** Requires multiple traversals of the same route. An ephemerality statistic is computed per LiDAR point characterising how much its local neighbourhood changes across traversals — points that disappear or reappear are mobile. High-ephemerality points on the ground plane seed mobile-object detections and are fitted with bounding boxes. These pseudo-labels bootstrap a 3D object detector through iterative self-training.

**Key result.** A remarkably accurate 3D mobile-object detector can be trained entirely from unlabeled data, with performance comparable to supervised counterparts on road-vehicle datasets.

**Limitation.** Multi-traversal data is required — not available at first map-build or in single-survey airside mapping. Produces detection-style output (bounding boxes), not per-point removal labels directly.

---

### LISO — Scene-Flow Self-Supervised 3D Detection (ECCV 2024)

**Paper:** Stefan Andreas Baur, Frank Moosmann, Andreas Geiger. "LISO: Lidar-only Self-Supervised 3D Object Detection." ECCV 2024.
arXiv: https://arxiv.org/abs/2403.07071 | GitHub: https://github.com/baurst/liso

**Mechanism.** Three-stage trajectory-regularised self-training:
1. Remove ground points; estimate ego-motion via KISS-ICP; compute self-supervised scene flow using the SLIM network.
2. Cluster points by residual flow magnitude (DBSCAN); fit 3D bounding boxes; track across frames; filter low-confidence tracks to produce initial pseudo-labels.
3. Train a standard object detector (CenterPoint or TransFusion-L) on pseudo-labels; re-generate improved pseudo-labels; iterate until convergence.

**Key insight.** "The single-frame object detector has no concept of motion, it generalises to detect any movable object" — after iteration, the detector finds movable objects never observed moving during training.

**Datasets.** Waymo Open, KITTI, Argoverse 2, nuScenes. Significantly outperforms prior self-supervised baselines (Oyster, SeMoLi) on detection AP; closes the gap between moving-only and movable-object detection.

**For map cleaning.** LISO outputs bounding boxes, not per-point removal masks. Detection output can serve as a masking layer applied to the accumulated point cloud, making it a functional label-free cleaning tool when composed with a removal operator.

---

### SeMoLi — Motion-Pattern Message-Passing Network (CVPR 2024)

**Paper:** Jenny Seidenschwarz, Aljoša Ošep, Francesco Ferroni, Simon Lucey, Laura Leal-Taixé. "SeMoLi: What Moves Together Belongs Together." CVPR 2024.
arXiv: https://arxiv.org/abs/2402.19463 | Project: https://research.nvidia.com/labs/dvl/projects/semoli/

**Mechanism.** Extracts long-term, class-agnostic motion trajectories from self-supervised scene flow. A **Message Passing Network (MPN)** processes a k-NN graph where node features combine position and velocity statistics from multi-frame trajectories; edge features encode spatial differences. Iterative message passing refines edge classifications (same object or not), leading to correlation clustering and 3D bounding boxes as pseudo-labels for detector training.

**Architecture note.** The graph-based clustering explicitly learns which motion patterns co-occur (Gestalt principle: things that move together belong together).

**Results.** 57.5 AP (+14 AP over prior heuristic baselines). A PointPillars detector trained on SeMoLi pseudo-labels achieves 19.5 AP at 0.4 IoU with zero labeled data. Cross-dataset generalisation to Argoverse 2 without retraining.

**Limitation.** Depends on scene-flow quality — sparse LiDAR, low vehicle density, and adverse weather degrade pseudo-label fidelity.

---

### Cortinhal et al. — Auto-Label Loop (RA-L 2022)

**Paper:** Xieyuanli Chen, Benedikt Mersch, Lucas Nunes, Rodrigo Marcuzzi, Ignacio Vizzo, Jens Behley, Cyrill Stachniss. "Automatic Labeling to Generate Training Data for Online LiDAR-based Moving Object Segmentation." RA-L 2022.
arXiv: https://arxiv.org/abs/2201.04501 | GitHub: https://github.com/PRBonn/auto-mos

**Mechanism.** Uses classical occupancy-based dynamic removal (ERASOR-style) as a map-cleaning pre-step to generate coarse dynamic-object proposals; then segments and tracks proposals with a Kalman filter; trajectory analysis distinguishes actually-moving objects from false positives (parked cars, tree trunks). The result is an auto-generated per-point MOS label set. A deep network trained on these auto-labels achieves similar performance to one trained with manual labels.

**Why important.** This is the canonical pseudo-label feedback loop: classical geometry → pseudo-labels → train network → better removal → better pseudo-labels. MOVES adopts a variation of this philosophy via paired GAN reconstruction rather than accumulate-and-track. See also [LiDAR Map Cleaning — Dynamic Removal](lidar-map-cleaning-dynamic-removal.md) for the foundational treatment.

---

### TOP — Temporal Overlapping Pretraining (ICCV 2025)

**Paper:** Ziliang Miao et al. "Temporal Overlapping Prediction: A Self-supervised Pre-training Method for LiDAR Moving Object Segmentation." ICCV 2025.
arXiv: https://arxiv.org/abs/2503.07167 | ICCV poster: https://iccv.thecvf.com/virtual/2025/poster/1645

**Mechanism.** A pretraining paradigm rather than a standalone removal method. Exploits **temporal overlapping points** — points observed by both the current scan and adjacent scans at slightly different poses. The pretraining task is to predict the occupancy state of overlapping points from current scan context, with occupancy reconstruction as an auxiliary objective. This forces the backbone to learn spatiotemporal representations encoding which regions are transiently vs. persistently occupied.

**Results.** Up to 28.77% relative improvement over supervised baselines on SemanticKITTI and nuScenes MOS benchmarks. Strong cross-sensor transferability. Novel mIoU_obj metric proposed to reduce evaluation bias toward dense or large objects.

**Practical role.** TOP provides a pretraining recipe that can initialise any MOS backbone; the resulting model requires only light fine-tuning on a small labeled set or runs as a zero-shot baseline. This is the most recent (2025) entry in the label-free learned spectrum and the most compatible with few-shot airside adaptation.

---

### UniLiPs — Geometry-Grounded Pseudo-Labeling (3DV 2026)

**Paper:** Filippo Ghilotti, Samuel Brucker, Nahku Saidy, Matteo Matteucci, Mario Bijelic, Felix Heide (TORC Robotics / Politecnico di Milano / Princeton). "UniLiPs: Unified LiDAR Pseudo-Labeling with Geometry-Grounded Dynamic Scene Decomposition." 3DV 2026.
arXiv: https://arxiv.org/abs/2601.05105

**Mechanism.** Jointly produces 3D semantic labels, 3D bounding boxes, and dense LiDAR scans without manual annotation. Detects moving objects from geometric-temporal inconsistencies in temporally accumulated LiDAR maps, then enforces iterative joint geometric-semantic consistency across detection and labeling outputs. Lifts cues from 2D vision foundation models and text into 3D via temporal-geometric priors.

**Results.** Outperforms existing pseudo-labeling methods on KITTI, nuScenes, and Long Range datasets; depth prediction improves 51.5% MAE at 80–150 m and 22.0% at 150–250 m via densified LiDAR.

**For map cleaning.** The dynamic-object detection from temporal inconsistency is directly applicable as a label-free removal signal; the unified labeling output provides both the dynamic mask and semantic labels for the static remainder in a single system — a strong candidate for the offline cleaning stage in the airside pipeline described below.

---

### MOVESe — Companion Preprint (same IIT Delhi group)

**Paper:** Prashant Kumar et al. "MOVESe: MOVablE and Moving LiDAR Scene Segmentation with Improved Navigation in Seg-label free settings." OpenReview: https://openreview.net/forum?id=tDB6QxanjU | DeepAI: https://deepai.org/publication/movese-movable-and-moving-lidar-scene-segmentation-with-improved-navigation-in-Seg-label-free-settings

MOVESe appears to be an earlier workshop submission by the same IIT Delhi authors, submitted in the same period as MOVES (June 2023). The journal paper MOVES (Pattern Recognition 2024) is the primary peer-reviewed version. The exact architectural and quantitative differences between the two versions are not confirmed from public metadata alone. MOVESe should be treated as a predecessor iteration, not an independent method.

---

## Comparison vs. Supervised Semantic Methods

See [SD-SLAM Semantic Dynamic LiDAR](sd-slam-semantic-dynamic-lidar.md) for the full SD-SLAM and SuMa++ treatment.

| Axis | Label-free learned (MOVES, LISO, MODEST) | Supervised semantic (SD-SLAM, SuMa++) |
|---|---|---|
| Training labels | None required; pseudo-labels from geometry, temporal consistency, or scan pairing | SemanticKITTI or equivalent human-labeled corpus |
| Class awareness | Class-agnostic; detects movable objects regardless of category | Class-aware; acts on pre-defined semantic categories (car, person, etc.) |
| OOD objects | Handles — any geometrically ephemeral object is a candidate, including unknown categories (FOD, unusual GSE) | Blind — objects outside the training class set are missed |
| Domain transfer | Requires geometry-based pseudo-labels or paired data in target domain; no class-label adaptation needed | Requires fine-tuning the semantic segmenter on target-domain class vocabulary |
| Inference speed | GAN inference (MOVES) or detection inference (LISO): tens to hundreds of ms/scan — typically offline | Semantic segmentation at 10–50 Hz depending on backbone; SD-SLAM/SuMa++ are online-capable |
| Airside data requirement | Needs scan pairs or self-supervised pretraining on airside sequences; no per-class annotation | Needs labeled GSE/aircraft/personnel classes in airside domain |
| Static-but-movable blind spot | MOVES explicitly targets movable (not just moving) objects; LISO generalises to movable after training | SD-SLAM three-tier: semi-static tracked but not always fully excluded from the map |
| Map completeness (inpainting) | MOVES fills occlusions behind removed objects via GAN inpainting; LISO/MODEST remove only | Removal only; no inpainting |
| Benchmark coverage | Not on KTH DynamicMap Benchmark as of May 2026; MOVES uses navigation-proxy metrics | Not on KTH PR/RR/F1 benchmark either |

**Key conclusion.** Label-free learned methods are the correct choice when human-labeled airside training data is unavailable. The MOVES GAN approach additionally provides occlusion inpainting, making it more suitable for map completeness than pure-removal methods. The class-agnostic nature means MOVES handles FOD and novel GSE categories that any fixed-vocabulary supervised method will miss.

---

## Comparison vs. Classical Unsupervised Methods

See [ERASOR](erasor.md), [ERASOR++](erasor-plus-plus.md), [FreeDOM](freedom-dynamic-object-removal.md), [MapCleaner](mapcleaner.md), [DR-Remover](dr-remover.md), [Dynamic-Aware LIO / BTSA](dynamic-aware-lio-btsa.md).

| Axis | Classical unsupervised (ERASOR, FreeDOM, Removert, MapCleaner) | Label-free learned (MOVES, LISO, TOP) |
|---|---|---|
| Training required | None — zero training, deploy immediately on any hardware | Training required (but only on unlabeled data or pseudo-labels) |
| Pseudo-label quality dependency | N/A | Quality ceiling determined by the pseudo-label generator (ERASOR, scene flow, pairing) |
| Generalisation | Tied to geometric heuristic assumptions (flat terrain, visibility geometry) | Can learn non-trivial patterns beyond heuristic design assumptions |
| Novel movers | Geometry-blind heuristic applies regardless of shape — fully general | Label-free learned may generalise to novel shapes better than geometry-only after sufficient training |
| Deployment cost | Near-zero — parameter tuning only | Requires training compute and data pipeline; MOVES also requires paired survey data |
| PR/RR/F1 (SemanticKITTI) | FreeDOM: 99.59% F1; ERASOR++: 0.930–0.986; MapCleaner: SOTA at publication | MOVES: not benchmarked on PR/RR/F1; LISO/SeMoLi: detection task, not removal |
| Online use | FreeDOM, DUFOMap: near-online | Most label-free learned methods are offline |
| Occlusion inpainting | Remove only — no inpainting | MOVES: yes (GAN reconstruction); LISO/MODEST/TOP: remove only |

**Key trade-off.** Classical methods have better-documented PR/RR/F1 numbers and deploy without training. Label-free learned methods sacrifice zero-deployment convenience for potential gains in complex geometry and OOD robustness. The pseudo-label ceiling problem means a label-free learned method trained on ERASOR-derived pseudo-labels cannot systematically exceed ERASOR's own detection quality — but it can generalise better to sensor types and environments outside ERASOR's geometric design envelope.

---

## Strengths

1. **No human labeling cost.** The supervision signal is paired static/dynamic scan frames — obtainable by surveying the same location at different occupancy states (empty vs. operational). No per-point or per-class annotation at any stage.
2. **Occlusion inpainting.** Unlike [ERASOR](erasor.md), [FreeDOM](freedom-dynamic-object-removal.md), or Removert, MOVES fills static structure behind removed objects. This matters for map completeness in narrow corridors and docked-aircraft bays where removal would otherwise create large voids.
3. **Movable-class agnostic.** The generator learns what "static structure" looks like in a given environment and removes anything deviating from that model, including object types absent from any training class list.
4. **Domain adaptation via MOVES-MMD.** Allows deployment in environments where only single-survey-pass data is available, using paired data from a different source domain as the bridge.
5. **Offline post-processing compatibility.** Suitable as a batch cleaning step applied to accumulated maps after route completion; does not require real-time per-scan operation.
6. **Family-level coverage.** The broader label-free family (MODEST, LISO, SeMoLi, TOP, UniLiPs) provides alternatives for different data availability scenarios: TOP when only single-pass unlabeled sequences exist; MODEST when multi-traversal routes exist; UniLiPs when joint semantic-plus-removal output is needed.

---

## Failure Modes

1. **Paired training data requirement.** The base MOVES needs at least one paired (dynamic scene, corresponding static scene) for the same location. In a first-deployment airside setting this may require a dedicated static-window survey (typically 02:00–05:00 during minimum traffic hours) — an operational overhead not needed by ERASOR or FreeDOM.

2. **Pseudo-label quality ceiling (family-wide).** A label-free method trained on ERASOR/Removert pseudo-labels inherits those methods' systematic errors (ground-plane misclassification near complex terrain, tree-trunk over-removal near pedestrian zones). The learned model may smoothly generalise these errors rather than correct them.

3. **No public code — deployment risk.** Reproducibility is unverified. Airside integration requires either access to the IIT Delhi authors or a full re-implementation of the DCGAN generator, Couple Discriminator, contrastive triplet loss, and MOVES-MMD adaptation pipeline. Flag this before any procurement or timeline commitment.

4. **GAN training instability.** GANs require careful hyperparameter tuning; mode collapse on sparse LiDAR point clouds (particularly solid-state LiDARs with non-uniform angular distributions common in airside deployments) is a known failure mode. MOVES uses LS-GAN to mitigate this, but residual risk — particularly when training data is limited — remains.

5. **PR/RR/F1 not confirmed.** The navigation-proxy evaluation makes it impossible to confirm whether MOVES achieves the 95%+ F1 that FreeDOM and ERASOR++ demonstrate on SemanticKITTI. Do not assume comparable static-removal quality without an independent benchmark evaluation.

6. **Static-but-transient blind spot (universal across all approaches).** A staged belt loader or temporary barrier that was present during both the static and dynamic survey windows will appear in both scenes and be treated as permanent structure. It is preserved in the cleaned map. See [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md) for the full taxonomy. This blind spot is shared with [ERASOR](erasor.md), [FreeDOM](freedom-dynamic-object-removal.md), and all classical methods; it is not specific to MOVES.

7. **Sparse industrial dataset underspecified.** The third MOVES evaluation dataset is described only as "challenging sparse industrial" — no sensor type, location, or public dataset link. The claim of outperforming segmentation baselines on this dataset cannot be independently verified.

8. **MOVES-MMD performance gap unquantified.** No quantitative comparison between base MOVES (paired data) and MOVES-MMD (no pairing) has been confirmed from public sources. The degradation from losing paired correspondence is a critical parameter for airside planning and is currently unknown.

---

## Domain Fit

| Domain | Fit | Key rationale |
|---|---|---|
| Airside / airport apron | High (strategic) | No labeled airside LiDAR corpus exists; label-free is the primary path; static-window survey feasible at low-traffic hours |
| Warehouse / logistics | Medium-High | Few labeled industrial LiDAR sets; multi-traversal available for MODEST; TOP pretraining applicable |
| Ports and logistics yards | Medium-High | Cross-airport rationale applies; crane and GSE classes absent from road datasets |
| Road AV (urban) | Medium | Labeled datasets (SemanticKITTI, Waymo, nuScenes) exist; supervised methods are an option; label-free mainly adds OOD robustness |
| Mining and construction | High | No domain-specific labeled corpus; site geometry changes continuously; label-free preferred |
| Agriculture | Medium | Vegetation removal is partly orthogonal; ephemerality signals may misfire on crop canopy |
| Indoor warehouse (dense traffic) | Medium | GAN inpainting helpful in narrow aisles; but high clutter density degrades generator generalisation |

---

## Aggregated-Map Suitability and Airside Pipeline

Label-free methods are strategically appealing for airside map building because no labeled airside LiDAR corpus exists. The cost breakdown illustrates the constraint: per-point labeling of 3D LiDAR scans runs $3–15/frame; a 30-minute airside survey session at 10 Hz yields 18,000 frames; even at 1 frame/s subsampling, annotation cost reaches $18,000 minimum per site, before cross-airport generalisation costs. Label-free methods decouple entirely from this constraint — they require only raw unlabeled LiDAR logs available from any deployed AV or robot sensor.

**Layered operational recipe for airside map cleaning:**

```
Stage 0: Online LiDAR-inertial odometry (LIO)
         -> FAST-LIO2, KISS-ICP, or similar
         -> Accumulate per-session raw map with ghost trails intact

Stage 1a [Geometry-only path — immediate deployment]:
         ERASOR++ or FreeDOM offline
         -> Remove geometric dynamic residuals
         -> No training required; deploy from day one
         -> Limitation: misses complex geometry; no inpainting behind removed objects

Stage 1b [Label-free learned path — preferred for long-term airside quality]:
         MOVES (if static-window survey is available)
         -> Requires: one paired survey (static-window scan + operational scan of same site)
         -> Produces: inpainted static map; no voids behind removed objects
         -> MOVES-MMD fallback: if only single-survey-pass data is available,
            transfer from a source-domain paired dataset
         -> Alternative: TOP pretraining + light fine-tuning if no pairing is possible at all

Stage 2: LT-Mapper / Khronos lifelong multi-session management
         -> Detects slow environmental change across weeks/months
         -> See: lt-mapper-khronos-lifelong-mapping.md

Stage 3: Semantic segmentation on cleaned static map
         -> SphereFormer, Cylinder3D, or FRNet on cleaned output
         -> Optional: UniLiPs to generate pseudo-labels for semantic segmentation
            without any manual annotation — closes the full label-free pipeline loop
```

Cross-link: [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md).

The **static-window survey** for MOVES requires a LiDAR scan of the apron with no aircraft, GSE, or personnel present. This is operationally achievable at minimum-traffic hours at most airports (approximately 02:00–05:00). The paired static/dynamic data becomes the permanent training anchor for that site's MOVES model. The one-time cost of the static survey is considerably less than annotation cost over the map's operational lifetime.

For continuous-operations airports where a static-window survey is not feasible, MOVES-MMD transfers from a source domain. MODEST is the alternative if multi-traversal apron traversals are available across days or weeks. TOP pretraining is the fallback when no pairing or multi-traversal data exists — it requires only sequential single-pass LiDAR logs.

---

## Implementation Notes

- **No public MOVES code.** Before scheduling MOVES for any integration milestone, confirm code availability with the IIT Delhi group or budget for full re-implementation. This is the single largest deployment risk.
- **Cross-check against ERASOR/FreeDOM first.** Because MOVES has not been benchmarked on standard PR/RR/F1 metrics, run ERASOR++ and FreeDOM on the target site data to establish a removal-quality baseline before committing to the GAN-based approach.
- **GAN training regime.** Expect at least 50–150 GPU-hours for initial DCGAN training depending on sequence length and batch configuration. LS-GAN loss stabilises training but does not eliminate the need for careful learning-rate scheduling and checkpoint validation.
- **Store provenance with every cleaned map.** Record model version, training domain, LiDAR sensor configuration, input representation (range image vs. BEV), and paired-data source alongside the cleaned point cloud. Map cleaning decisions must be auditable for safety case purposes.
- **Conservative removal thresholds first.** Inspect false removals of localisation anchors (runway edge markers, jetbridge pillars, permanent GSE hard-stands) before tightening the removal confidence threshold.
- **Validate via localisation regression, not visual cleanliness.** Run ATE/RPE, scan-matching inlier counts, and degeneracy metrics on routes traversed after map cleaning. A visually clean map can still degrade localisation if static landmarks are over-removed.
- **Avoid promoting GAN-inpainted structure without multi-session confirmation.** Reconstructed background points from the MOVES generator should be flagged as inferred until confirmed by a subsequent independent scan pass.
- **Layer with visibility reasoning.** Combining MOVES-cleaned output with a FreeDOM or DUFOMap visibility pass as a consistency check reduces hallucinated inpainting from propagating into the final static map.

---

## Sources

| Item | URL |
|---|---|
| MOVES (arXiv 2306.14812) | https://arxiv.org/abs/2306.14812 |
| MOVES (Pattern Recognition, ScienceDirect) | https://www.sciencedirect.com/science/article/abs/pii/S0031320324004023 |
| MOVES (ADS abstract) | https://ui.adsabs.harvard.edu/abs/2024PatRe.15510651K/abstract |
| MOVESe (OpenReview) | https://openreview.net/forum?id=tDB6QxanjU |
| MOVESe (DeepAI) | https://deepai.org/publication/movese-movable-and-moving-lidar-scene-segmentation-with-improved-navigation-in-Seg-label-free-settings |
| MODEST (arXiv 2203.15882) | https://arxiv.org/abs/2203.15882 |
| MODEST GitHub | https://github.com/YurongYou/MODEST |
| LISO (arXiv 2403.07071) | https://arxiv.org/abs/2403.07071 |
| LISO GitHub | https://github.com/baurst/liso |
| SeMoLi (arXiv 2402.19463) | https://arxiv.org/abs/2402.19463 |
| SeMoLi project (NVIDIA) | https://research.nvidia.com/labs/dvl/projects/semoli/ |
| Cortinhal auto-MOS (arXiv 2201.04501) | https://arxiv.org/abs/2201.04501 |
| Cortinhal auto-MOS GitHub | https://github.com/PRBonn/auto-mos |
| TOP temporal pretraining (arXiv 2503.07167) | https://arxiv.org/abs/2503.07167 |
| TOP (ICCV 2025 poster) | https://iccv.thecvf.com/virtual/2025/poster/1645 |
| UniLiPs (arXiv 2601.05105) | https://arxiv.org/abs/2601.05105 |
| KTH DynamicMap Benchmark | https://github.com/KTH-RPL/DynamicMap_Benchmark |
| FreeDOM (arXiv 2504.11073) | https://arxiv.org/html/2504.11073 |
| ERASOR (arXiv 2103.04316) | https://arxiv.org/pdf/2103.04316 |
| ERASOR++ (arXiv 2403.05019) | https://arxiv.org/html/2403.05019v1 |
| SD-SLAM (arXiv 2402.18318) | https://arxiv.org/abs/2402.18318 |
