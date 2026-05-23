# SD-SLAM — Semantic Dynamic LiDAR SLAM

<!-- method-priority:start
priority:
  learning: 4
  deployment: 5
  type: "method"
  stage: "deployment-pattern"
  maturity: "pilot-proven"
  tags: ["slam", "mapping", "validation", "runtime-localization", "outdoor"]
  reason: "SD-SLAM Semantic Dynamic LiDAR is rated for dynamic-object filtering and map-cleaning workflows that protect localization maps."
method-priority:end -->

Related docs: [ERASOR](erasor.md), [ERASOR++](erasor-plus-plus.md), [FreeDOM](freedom-dynamic-object-removal.md), [LT-mapper / Khronos](lt-mapper-khronos-lifelong-mapping.md), [LiDAR Map Cleaning — Dynamic Removal](lidar-map-cleaning-dynamic-removal.md), [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md), [Loop Closure and Place Recognition](loop-closure-place-recognition.md), [SuMa / SuMa++](suma.md), [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [SalsaNext](../../perception/methods/salsanext.md), [FRNet](../../perception/methods/frnet.md), [SegNet4D](../../perception/methods/segnet4d.md), [LiDAR MOS](../../perception/methods/lidar-mos.md), [4DMOS](../../perception/methods/4dmos.md).

**Last updated:** 2026-05-23

---

## What It Is

**Paper:** "SD-SLAM: A Semantic SLAM Approach for Dynamic Scenes Based on LiDAR Point Clouds"
**Authors:** Feiya Li, Chunyun Fu, Dongye Sun, Jian Li, Jianwen Wang
**ArXiv:** https://arxiv.org/abs/2402.18318 (submitted 2024-02-28)
**Journal:** ScienceDirect / Internet of Things, May 2024 — https://www.sciencedirect.com/science/article/abs/pii/S221457962400039X (DOI: 10.1016/j.iot.2024.101209)
**License:** CC BY-NC-ND 4.0

SD-SLAM is a LiDAR-based SLAM system purpose-built for dynamic outdoor environments. It is the most recent single-paper representative of a decade-long family of semantic-dynamic SLAM methods, applied here to a LiDAR-primary pipeline with a three-tier landmark classification scheme.

The core thesis is that **semantic class is the strongest available prior for dynamic potential**. A cluster labelled `car`, `person`, or `cyclist` might be stationary right now, but it belongs to a movable category and must be tracked separately from terrain-class geometry. This is the key conceptual distinction from purely geometry-driven dynamic removal such as ERASOR or FreeDOM: geometry-based methods need to observe the object actually moving across frames before flagging it; semantics acts pre-emptively on category alone. As a result SD-SLAM handles the first frame of a newly appearing dynamic object in a way that geometry-only offline cleaners cannot.

The system achieves three things simultaneously in each frame:

1. A **pose estimate** clean of dynamic-object contamination.
2. A **semantic map** with per-point class labels across multiple SemanticKITTI classes.
3. A **per-cluster landmark classification** — dynamic, semi-static, or pure static — that governs how each observation contributes to the SLAM back-end.

Benchmark evaluation uses the KITTI odometry dataset. The landmark classification step achieves **F1 = 91%** distinguishing static from dynamic objects. Full quantitative ATE/RPE numbers are in the journal version; they are not publicly reproduced in the arXiv preprint.

---

## Core Technical Idea

Most LiDAR SLAM systems treat dynamic-object handling as binary: either they ignore dynamics entirely (risking ghost contamination of the map) or they detect and remove dynamic points geometrically (needing observed motion, which is unavailable on the very first frame). SD-SLAM takes a third path: use semantic class membership as a first-order signal for *dynamic potential*, then use a Kalman filter to assess *actual motion state*, and combine both signals into a three-tier landmark classification.

The three tiers matter operationally because the correct treatment of each is different:

| Landmark tier | Membership criterion | Treatment in SLAM back-end |
|---|---|---|
| Dynamic | Dynamic-semantic class AND currently moving (high Kalman velocity/position deviation) | Excluded from pose-graph entirely |
| Semi-static | Dynamic-semantic class BUT currently stationary (Kalman velocity ≈ 0) | Included with reduced confidence weight `w_s < 1` |
| Pure static | Terrain / structure semantic class | Included at full weight |

A **parked car** is semi-static, not pure static. If the same vehicle cluster is absent in the next session, it was pseudo-static and should not have seeded permanent map landmarks. This nuance — keeping movable-class objects as low-confidence anchors rather than unconditionally promoting or unconditionally removing them — is SD-SLAM's principal contribution over earlier binary include/exclude approaches such as SuMa++ (see the family section below).

A secondary contribution is that loop closure is restricted to the **pure-static subset** via an improved BoW3D formulation, preventing false loop triggers from semi-static landmarks that may have changed state between the query time and the prior visit.

---

## Operator Mechanics

### Per-Frame Pipeline

```
LiDAR scan (t)
      |
      v
[1] RangeNet++ semantic segmentation
      -> per-point class label (19-class SemanticKITTI vocabulary)
      |
      v
[2] DBSCAN instance clustering (per semantic class, tunable epsilon / minPts)
      -> labelled point-cloud clusters
      |
      +------------------------------------------------+
      |  Dynamic-class clusters                        |
      |  (car, truck, bus, motorcycle, bicycle,        |
      |   person, rider)                               |
      |  -> enter Landmark Motion Classification       |
      |                                                |
      |  Static-class clusters                         |
      |  (road, building, vegetation, pole …)          |
      |  -> directly feed SLAM odometry backbone       |
      +------------------------------------------------+
      |                          |
      v                          v
[3] Landmark Motion           [4] Convex-hull matching
    Classification                preliminary pose estimate
    (Kalman filter, CTRV model)
    -> label each dynamic-class cluster:
         DYNAMIC      – currently moving
         SEMI_STATIC  – still now, movable later
         PURE_STATIC  – parked/background, stable
      |
      v
[5] Precise 6-DOF pose estimation
    (pure-static at full weight; semi-static at w_s < 1; dynamic excluded)
      |
      v
[6] Loop closure via improved BoW3D (pure-static subset only)
      |
      v
[7] Pose-graph back-end + semantic map update
```

### Semantic Segmentation: RangeNet++

RangeNet++ projects the 3D point cloud onto a spherical range image (2D, H×W), runs a 2D CNN segmentation network with a DarkNet-53 backbone, and post-processes with kNN to back-project semantic labels onto 3D points. Operating on a 2D range image is far faster than 3D voxel-based segmentation. Training corpus: SemanticKITTI 19-class labels (sequences 00–10, approximately 23,000 annotated scans).

### Instance Clustering: DBSCAN

After per-point labelling, SD-SLAM groups points of the same semantic class using DBSCAN. `epsilon` and `minPts` are tuned per class — persons cluster tightly; vehicles cluster with larger inter-point spacing. This yields per-object cluster proposals analogous to instance segmentation without a dedicated Mask R-CNN pass.

### Landmark Motion Classification: Kalman Filter

Each cluster is tracked frame-to-frame with a **constant turn-rate (CTRV) motion model** Kalman filter. The filter maintains predicted position `x_hat` and velocity `v_hat` per cluster. Classification combines three signals:

- **Velocity discrepancy** `|v_hat - v_measured|` — is this cluster accelerating?
- **Position discrepancy** `|x_hat_t - x_t|` — does it deviate from the predicted static position?
- **Semantic class membership** — is this an inherently movable class?

The classification decision expressed in pseudocode:

```
if s_i in {car, truck, bus, motorcycle, bicycle, person, rider}:
    candidate_dynamic = True
else:
    candidate_dynamic = False

if candidate_dynamic:
    delta_v = |v_hat_i(t) - (p_i(t) - p_i(t-1)) / dt|
    delta_p = |p_i(t) - p_hat_i(t)|   # p_hat = Kalman prediction

    if delta_v > tau_v  OR  delta_p > tau_p:
        label = DYNAMIC          # actively moving -> exclude
    else:
        label = SEMI_STATIC      # movable but still -> use with weight w_s < 1
else:
    label = PURE_STATIC          # terrain / structure -> use at full weight
```

### Pose-Graph Factor Weighting

```
E_pose = sum_{i: PURE_STATIC}  w_i   * rho(r_i)
       + sum_{i: SEMI_STATIC}  w_s   * rho(r_i)   # w_s in (0, 1), tunable
       + 0  (dynamic clusters omitted entirely)
```

where `rho(·)` is a robust kernel (Huber or Cauchy) and `r_i` is the point-to-plane ICP residual for cluster `i`.

### Loop Closure: BoW3D on Pure-Static Subset

Loop closure uses an improved BoW3D (bag-of-words on 3D line features). The SD-SLAM modification restricts loop candidates to the pure-static subset of the map, preventing false loop triggers from semi-static landmarks that have changed state between the prior visit and the query.

---

## Inputs and Outputs

| Item | Role |
|---|---|
| LiDAR point cloud (per frame) | Primary geometric observations at 10 Hz |
| RangeNet++ labels | Per-point semantic class from 19-class SemanticKITTI vocabulary |
| DBSCAN clusters | Per-class instance groupings for tracking |
| CTRV Kalman filter state | Per-cluster position and velocity estimate for motion classification |
| Convex-hull preliminary pose | Scan-to-scan initial alignment before semantic-weighted refinement |
| Pose-graph back-end | Weighted ICP factor graph; landmark types govern factor weights |
| BoW3D loop candidates | 3D line-feature bag-of-words on pure-static subset |
| **Output: 6-DOF trajectory** | Pose estimate cleaned of dynamic-object contamination |
| **Output: static semantic map** | Per-point labelled LiDAR map (multiple SemanticKITTI classes) |
| **Output: landmark tier labels** | Dynamic / semi-static / pure-static classification per cluster |

---

## Architecture

| Component | Implementation in SD-SLAM |
|---|---|
| Semantic front-end | RangeNet++ (DarkNet-53 backbone on range image; SemanticKITTI-trained) |
| Instance grouping | DBSCAN per semantic class, tunable epsilon / minPts |
| Dynamic tracking | Constant-turn-rate (CTRV) Kalman filter per cluster |
| Odometry backbone | **Custom convex-hull feature matching (scan-to-scan)** — see note below |
| Pose-graph back-end | Weighted ICP + factor graph with three-tier landmark weights |
| Loop closure | Improved BoW3D restricted to pure-static subset |
| Output map | Static semantic LiDAR map with per-point class labels |

**Important:** The paper does **not** use LOAM, FAST-LIO, or LIO-SAM as the backbone. It builds its own convex-hull-based preliminary pose estimator before the semantic-aware refinement. This is a notable departure from most recent LiDAR SLAM work. The journal version (ScienceDirect, DOI: 10.1016/j.iot.2024.101209) would clarify the precise implementation details of the convex-hull estimator. Do not represent SD-SLAM as LOAM/FAST-LIO-based without consulting the journal paper.

---

## Training

SD-SLAM has one learned component and the rest is rule-based:

- **Learned:** RangeNet++ semantic segmentation, pre-trained on SemanticKITTI (sequences 00–10, approximately 23,000 annotated scans, 19 classes). No online adaptation; the model is frozen at deployment.
- **Rule-based:** DBSCAN clustering, CTRV Kalman filter, convex-hull pose estimator, factor weighting, BoW3D loop closure. All parameters (epsilon / minPts, Kalman noise covariances, tau_v / tau_p classification thresholds, w_s semi-static weight) are manually tuned.

Domain adaptation therefore requires fine-tuning RangeNet++ (or substituting a different segmentation front-end) on target-domain data. The Kalman filter thresholds may also need re-tuning for different dynamic object speeds (e.g. slow aircraft tugs vs. fast highway vehicles).

---

## Benchmark Results

**KITTI odometry dataset.** SD-SLAM evaluates on standard KITTI sequences. The landmark classification step achieves **F1 = 91%** distinguishing static from dynamic objects. This is the primary reported number in the arXiv preprint.

**Caveat on trajectory error numbers:** Explicit ATE (Absolute Trajectory Error) and RPE (Relative Pose Error) numbers are reported in the journal version (ScienceDirect, May 2024) and are not fully reproduced in the arXiv preprint. Avoid citing specific odometry error numbers without journal access. The paper states qualitatively that SD-SLAM "mitigates adverse effects from dynamic objects, improves vehicle localization and mapping in dynamic scenes, and constructs a static semantic map with multiple semantic classes."

**No head-to-head benchmark between SD-SLAM and SuMa++ on the same sequences** has been identified in the public literature as of May 2026. SuMa++ remains the most commonly cited LiDAR semantic SLAM comparison baseline in this space.

**SD-SLAM is not yet included in the KTH DynamicMap Benchmark** (arXiv 2307.07260), which was the standard unified framework for dynamic removal evaluation as of 2024. For comparative PR/RR/F1 numbers across online and offline dynamic removal methods, see [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md).

---

## The Broader Semantic-Dynamic SLAM Family

The following methods constitute the lineage of semantic-aware dynamic handling in SLAM, from the canonical visual predecessors through to the current LiDAR SOTA. SD-SLAM sits near the end of this lineage, inheriting design patterns from each generation.

### SuMa++ — Canonical LiDAR Semantic SLAM (IROS 2019)

**Paper:** Chen, Milioto, Palazzolo, Giguère, Behley, Stachniss, "SuMa++: Efficient LiDAR-based Semantic SLAM," IROS 2019.
**ArXiv:** https://arxiv.org/abs/2105.11320
**GitHub:** https://github.com/PRBonn/semantic_suma
**PDF:** https://www.ipb.uni-bonn.de/wp-content/papercite-data/pdf/chen2019iros.pdf

This is the **canonical LiDAR semantic-dynamic SLAM** — the direct ancestor of SD-SLAM's design philosophy, and a citation classic. SuMa++ extends the surfel-based SuMa framework with two semantic-driven mechanisms.

**Semantic ICP weighting.** The point-to-plane ICP loss is augmented with a semantic consistency term:

```
E = sum_i [ rho_geom(r_i) + lambda * rho_sem(s_query_i != s_map_i) ]
```

Points where query and map semantics disagree contribute higher residuals, down-weighting outliers that are either dynamic objects or category boundaries.

**Online semantic consistency checking.** When updating surfel labels, SuMa++ checks whether the incoming scan's semantic prediction for a surfel matches the stored label. If a surfel is labelled `car` in the map but the scan predicts `background` at that location (because the car drove away), the surfel is flagged as dynamic and removed. Critically, SuMa++ does *not* simply delete all `car`-class points — doing so would remove parked cars that are valuable registration anchors. It keeps potentially-movable-class surfels while they remain consistent, and removes them when they become inconsistent across frames.

Semantic labels come from RangeNet++ trained on SemanticKITTI. SuMa++ achieves relative translational errors of approximately 0.22%–0.46% on KITTI highway sequences (the advantage over baseline SuMa is most visible on sequences with dense moving vehicles).

SD-SLAM's contributions over SuMa++ are: (1) the three-tier landmark classification — dynamic / semi-static / pure static — rather than SuMa++'s binary include/exclude, (2) explicit Kalman tracking of cluster motion state across frames, and (3) the semantic-guided loop closure via BoW3D restricted to pure-static landmarks.

### DynaSLAM — Visual Semantic-Dynamic, Canonical Predecessor (RA-L + IROS 2018)

**Paper:** Bescos et al., "DynaSLAM: Tracking, Mapping and Inpainting in Dynamic Scenes," RA-L + IROS 2018.
**ArXiv:** https://arxiv.org/abs/1806.05620
**GitHub:** https://github.com/BertaBescos/DynaSLAM

Built on ORB-SLAM2. Uses Mask R-CNN to detect and mask dynamic objects (persons, vehicles). For monocular and stereo configurations it additionally applies multi-view geometric consistency. Unique feature: **background inpainting** fills occluded static background behind removed dynamic regions via deep completion. Demonstrated order-of-magnitude ATE reduction on TUM RGB-D dynamic sequences. RGB-D only; no LiDAR. The canonical proof-of-concept that semantic segmentation can clean the SLAM map of dynamic contamination in real time, without waiting for geometric observation of actual motion.

### DS-SLAM — RGB-D + Semantic + Moving Consistency Check (IROS 2018)

**Paper:** Yu et al., "DS-SLAM: A Semantic Visual SLAM towards Dynamic Environments," IROS 2018.
**ArXiv:** https://arxiv.org/abs/1809.08379
**GitHub:** https://github.com/ivipsourcecode/DS-SLAM

Extends ORB-SLAM2 with a parallel semantic segmentation thread (SegNet) running asynchronously so the tracking thread does not stall. Key innovation: combines semantic mask with a **moving consistency check** — only segments that both (a) belong to a dynamic semantic class AND (b) show multi-view optical flow inconsistency are removed. This dual-gate design prevents removing parked cars from the map (they pass the geometric consistency check even if semantically dynamic). Produces dense semantic octo-tree maps. Evaluated on TUM RGB-D with one order of magnitude ATE improvement over ORB-SLAM2 in dynamic scenes. RGB-D; no LiDAR. The dual-gate semantic-plus-geometric classification is the visual predecessor of SD-SLAM's semantic-class-plus-Kalman-state approach.

### Detect-SLAM — Detection-SLAM Mutual Benefit (WACV 2018)

**Paper:** Zhong, Wang, Zhang, Zhou, Wang, "Detect-SLAM: Making Object Detection and SLAM Mutually Beneficial," WACV 2018.

Uses bounding-box object detections to mask dynamic regions from feature extraction. Key contribution: object detections improve SLAM (by removing dynamic features from the tracking input) and SLAM improves object detection (temporal consistency confirms detections across frames). Predates the full semantic segmentation wave; uses bounding-box-level rather than pixel-level masking. Visual only. Establishes the bi-directional benefit pattern that subsequent work extends to segmentation-level granularity.

### ClusterSLAM and ClusterVO — Instance-Aware Rigid Body Clustering (ICCV 2019, CVPR 2020)

**ClusterSLAM:** Huang et al., ICCV 2019. https://openaccess.thecvf.com/content_ICCV_2019/papers/Huang_ClusterSLAM_A_SLAM_Backend_for_Simultaneous_Rigid_Body_Clustering_and_ICCV_2019_paper.pdf
**ClusterVO:** Huang et al., CVPR 2020. https://openaccess.thecvf.com/content_CVPR_2020/papers/Huang_ClusterVO_Clustering_Moving_Instances_and_Estimating_Visual_Odometry_for_Self_CVPR_2020_paper.pdf

These take an **instance-centric** rather than class-centric approach. ClusterSLAM builds a noise-aware motion affinity matrix over SLAM landmarks and uses agglomerative clustering to discover rigid bodies automatically, without semantic labels. ClusterVO adds multi-level probabilistic association combining semantic, spatial, and motion cues in a CRF. Both systems simultaneously estimate ego-motion and per-object motions. ClusterVO achieves lower ATE than DynaSLAM on KITTI raw sequences. Stereo visual; no LiDAR. The instance-centric formulation is architecturally different from SD-SLAM's class-centric approach but addresses the same core problem.

### RDS-SLAM — Real-Time Async Semantic Thread (IEEE Access 2021)

**Paper:** Liu and Miura, "RDS-SLAM: Real-Time Dynamic SLAM Using Semantic Segmentation Methods," IEEE Access 2021, DOI: 10.1109/ACCESS.2021.3050617.
**GitHub:** https://github.com/yubaoliu/RDS-SLAM

Built on ORB-SLAM3. The key engineering contribution is making the semantic thread fully asynchronous: tracking does not wait for segmentation results. Instead, the latest available semantic mask is applied, decoupling segmentation latency from odometry latency. Supports plug-in of any segmentation backend (Mask R-CNN, SegNet). This pattern — decouple the semantic thread from the odometry cycle — is directly applicable to SD-SLAM's RangeNet++ integration on compute-constrained hardware such as Orin. RGB-D visual; not LiDAR.

### SegMap — Segment-Based LiDAR Mapping and Localization (IJRR 2020)

**Paper:** Dubé, Cramariuc, Dugas et al., "SegMap: Segment-based mapping and localization using data-driven descriptors," IJRR 2020.
**ArXiv:** https://arxiv.org/abs/1909.12837

SegMap partitions the LiDAR point cloud into geometrically coherent segments, learns compact data-driven descriptors per segment via an autoencoder, and uses those descriptors for global localisation and loop closure. Result: approximately 6% recall improvement over handcrafted descriptors; drift reduction up to 50% over open-loop odometry. SegMap is not primarily a dynamic-handling system but operates at segment-level granularity, meaning transient dynamic objects naturally produce isolated segments that fail to match map descriptors and are thus implicitly rejected. The SemSegMap extension (arXiv:2107.14715, 2021) adds semantic labels to segment descriptors. Related to the SD-SLAM family through the segment-centric LiDAR SLAM thread.

### Semantics Aware Dynamic SLAM — 3D MODT (Sensors 2021)

**Paper:** Sualeh and Kim, "Semantics Aware Dynamic SLAM Based on 3D MODT," Sensors 2021.
**PMC:** https://pmc.ncbi.nlm.nih.gov/articles/PMC8512852/

A visual-LiDAR hybrid. Uses YOLO-v3 for 2D visual detection and IMM-UKF-JPDAF (Interacting Multiple Model + Unscented Kalman Filter + Joint Probabilistic Data Association) for 3D LiDAR tracking. Dynamic masks are generated by projecting tracked LiDAR clusters onto the image plane, then passed to ORB-SLAM2. Classification is temporal (tracked clusters) rather than frame-wise, reducing flicker. Achieves ATE 0.906 m vs. ORB-SLAM2's 1.812 m on KITTI tracking dataset, outperforming DynaSLAM (1.02 m) and ClusterVO. Runtime approximately 100 ms on Core i7 + GTX 1060. The loosely coupled architecture (SLAM and MODT can continue if one subsystem degrades) is a useful design pattern for airside deployment where fault tolerance is required.

### SA-LOAM — Semantic-Aided LiDAR SLAM with Loop Closure (ICRA 2021)

**Paper:** Li et al., "SA-LOAM: Semantic-aided LiDAR SLAM with Loop Closure," ICRA 2021.
**ArXiv:** https://arxiv.org/abs/2106.11516

Extends LOAM with semantic assistance in both odometry and loop closure. Semantic ICP restricts matching to same-class correspondences, reducing false matches in geometrically ambiguous areas. Plane constraints from floor/wall labels stabilise the vertical DOF. Loop closure uses a semantic graph-based place recognition approach: the spatial graph of semantic object instances is matched between frames, robust to viewpoint change. Evaluated on KITTI and Ford Campus with significant improvement over the LOAM baseline. SA-LOAM emphasises geometric quality gains from semantics rather than dynamic-object handling specifically — a complementary use of semantic information to SD-SLAM.

### SegNet4D and 2024–2026 Integration Trends

**SegNet4D** (Wang et al., IEEE T-ASE 2025): https://arxiv.org/abs/2406.16279
GitHub: https://github.com/nubot-nudt/SegNet4D

SegNet4D solves the joint problem of per-point semantic class labelling and moving-vs-static classification in a single network. The pipeline converts sequential LiDAR scans to BEV images, computes BEV residuals between frames to capture motion cues, and runs two heads — semantic segmentation and MOS (Moving Object Segmentation) — fused via a motion-semantic fusion module. Achieves real-time throughput significantly cheaper than 4D convolution approaches.

SegNet4D (and similar 4D semantic-MOS networks) represents the next integration step for SD-SLAM-style systems. Instead of the separate chain:

```
RangeNet++ (semantic) -> DBSCAN -> Kalman filter (motion state)
```

a single 4D network produces both semantic class and per-point dynamic/static classification in one forward pass. This reduces compute, removes hand-tuned Kalman thresholds, and improves consistency between the semantic and motion predictions. The LiDAR SLAM backbone receives the static-labelled subset directly. Related methods: [LiDAR MOS](../../perception/methods/lidar-mos.md), [4DMOS](../../perception/methods/4dmos.md).

---

## Real-Time-on-Orin Constraint

RangeNet++ with its DarkNet-53 backbone runs at approximately 50 Hz on an Nvidia RTX-class desktop GPU for a 64-beam LiDAR scan. On Jetson AGX Orin (approximately 100 ms per-frame budget for the full autonomy stack), the situation is constrained:

| Segmentation model | mIoU (SemanticKITTI) | Approx. latency on Orin | Fits 100 ms budget? |
|---|---|---|---|
| SalsaNext | 54.4% | ~84–109 ms | Barely (tight) |
| RangeNet++ (DarkNet-53) | ~71% | >100 ms (est.) | No without quantisation |
| MinkNet / SPVCNN | 63–65% | 170–250 ms | No without INT8 |
| FRNet | 73.3% | ~5× faster than comparable SOTA on RTX GPU; Orin not yet confirmed | Candidate — see note |

**SalsaNext** (see [SalsaNext](../../perception/methods/salsanext.md)) is the only model with a confirmed near-real-time result on Orin (~84 ms for 2048×64 input) at 54.4% mIoU. This is the safe conservative choice for an SD-SLAM-style front-end today.

**FRNet** (Frustum-Range Networks, arXiv:2312.04484 / TIP 2025; see [FRNet](../../perception/methods/frnet.md)) achieves 73.3% mIoU on SemanticKITTI and runs approximately 5× faster than comparable-accuracy methods on RTX-class GPU. It is the **strongest candidate for the real-time front-end on Orin**, but this claim requires direct confirmation on Orin hardware — the 2024 real-time benchmark (arXiv:2410.08365) evaluated SalsaNext and MinkNet but not FRNet specifically.

**Practical options for Orin deployment:**

1. **Swap RangeNet++ for SalsaNext** and accept the mIoU reduction from ~71% to 54.4%. Lower segmentation accuracy increases false negatives (dynamic objects not detected as dynamic-class) and false positives (static objects mislabelled, then incorrectly excluded from the map).
2. **Decouple the semantic thread** — run segmentation at 5–10 Hz on a dedicated GPU thread, fuse asynchronously with the 10 Hz LiDAR odometry front-end using the latest available semantic labels (RDS-SLAM pattern). This recovers higher segmentation quality at the cost of occasional stale-label transients.
3. **Replace the entire RangeNet++ + Kalman chain with SegNet4D** or a comparable 4D semantic-MOS network when Orin-compatible quantised versions become available, collapsing two components into one.

---

## Online Semantic-Aware vs. Offline Dynamic Removal — Comparison and Complementarity

SD-SLAM-style online semantic filtering and offline geometric cleaners (ERASOR, FreeDOM) are complementary, not competitive. They attack different failure modes.

| Axis | SD-SLAM / SuMa++ (online, semantic) | ERASOR / FreeDOM (offline / near-online, geometry) |
|---|---|---|
| Trigger | Semantic class prior — acts on *potential* to move | Geometric evidence — object must *have moved* across frames |
| Timing | Per-frame, inside the SLAM loop | Post-SLAM on accumulated map (ERASOR); scan-level before aggregation (FreeDOM) |
| First-frame handling | Flags dynamic-class object on frame 1 | Needs at least 2 frames showing displacement |
| False positive risk | Mis-classifies parked car as dynamic if segmenter is wrong | Removes static points in occluded regions; ERASOR++ notes vegetation / wall erosion |
| False negative risk | OOD / unknown objects invisible to semantic filter | Detects motion regardless of class; catches OOD objects if they have moved |
| Map-building benefit | Cleaner per-frame cloud fed to aggregation → reduces ERASOR/FreeDOM workload | Cleans the aggregated map after the fact; catches ghosts SD-SLAM missed |
| Compute cost | Adds segmentation + DBSCAN + Kalman per frame | ERASOR: offline batch; FreeDOM: two-stage, near-online |
| Benchmark F1 (seq 07) | Not in KTH benchmark as of 2024 | FreeDOM F1 = 98.33%, ERASOR F1 = 95.18% (KTH benchmark) |
| Domain coverage | Only known semantic classes | All objects with observed motion, class-agnostic |

**Recommended layered pipeline:**

```
LiDAR scans (10 Hz)
    -> SD-SLAM / SuMa++ (online semantic-dynamic SLAM)
         -> clean per-frame cloud + pose estimate
         -> removes: actively dynamic known-class objects
         -> handles: semi-static parked vehicles (tracked, down-weighted)
         -> cannot handle: OOD objects, static-but-transient, slow-changing scene
    -> aggregate into session map
    -> ERASOR++ or FreeDOM (offline / near-online dynamic removal)
         -> removes: residual ghost points that survived the online filter
         -> removes: semi-static objects that moved between sessions
    -> LT-mapper / Khronos (multi-session lifelong cleanup)
         -> manages: slow environmental change (construction, seasonal, moved furniture)
    -> segmentation-ready static map
```

See [ERASOR](erasor.md), [ERASOR++](erasor-plus-plus.md), [FreeDOM](freedom-dynamic-object-removal.md), and [LT-mapper / Khronos](lt-mapper-khronos-lifelong-mapping.md) for each layer's detailed treatment.

---

## The Static-but-Transient Consequence

Semantic-aware SLAM handles dynamic **classes** — categories the model was trained to recognise as potentially movable. It **cannot** handle:

- A cardboard box or dropped tool on the taxiway (no matching semantic training class).
- A scaffold or temporary construction barrier.
- An unknown vehicle type outside the training distribution.
- **FOD (foreign object debris)** in airside environments — the highest-priority static-but-transient concern for airside safety.
- Any object that is semantically invisible because the model was not trained on its class.

These objects are incorporated into the static map as if they are permanent structures. If the object is then removed (FOD cleared, scaffold dismantled), the ghost lingers until a geometry-based post-pass (ERASOR, FreeDOM) or lifelong mapping (LT-mapper, Khronos) detects the absence.

**This is the primary residual failure mode of semantic-aware SLAM.** The offline dynamic removal and lifelong mapping layers exist precisely to address what the online semantic filter cannot.

Cross-reference: [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md) for the full taxonomy of static-but-transient object types, the SLAM failure modes they create, and the operational mitigations available.

---

## Strengths

- **Pre-emptive filtering.** Removes dynamic-class points even when they are momentarily still, preventing their incorporation as map landmarks that will later become ghost trails. Geometry-only methods cannot do this on the first frame.
- **Three-tier landmark classification.** The dynamic / semi-static / pure-static hierarchy gracefully handles parked vehicles by retaining them as low-confidence registration anchors rather than unconditionally removing or including them.
- **Rich semantic map output.** The output map carries per-point class labels, enabling downstream semantic path planning, class-conditioned queries, and auto-labelling pipelines.
- **Temporal consistency.** The CTRV Kalman filter adds frame-to-frame consistency to semantic decisions, reducing flicker from per-frame segmentation noise.
- **Pure-static loop closure.** Restricting BoW3D loop candidates to the pure-static subset reduces false loop triggers from semi-static landmarks that have changed state.
- **LiDAR-primary.** Geometry-based; completely unaffected by lighting changes, camera overexposure, or lens flare. Relevant for 24/7 airside operations.
- **No post-processing required for frame-level cleanliness.** Online filtering means the accumulated map starts cleaner than a raw aggregation, reducing the workload on offline dynamic removal stages.

---

## Failure Modes

### 1. Semantic Segmentation Front-End Failure

If RangeNet++ (or the substitute segmentation model) mis-classifies, the SLAM suffers directly. A person mis-labelled as a pole stays in the map. A building mis-labelled as vegetation may be down-weighted in the pose-graph. Rain, dust, and fog degrade range-image quality, causing noisy semantic labels and allowing dynamic objects to survive into the map.

### 2. Unknown and OOD Object Categories

Objects not in the SemanticKITTI training distribution are invisible to the semantic filter. In airside environments: GSE not resembling any road-vehicle class, unusual aircraft types, FOD, and temporary equipment all fall into this gap. The semantic filter provides **zero protection** against these objects. This is a fundamental limitation, not an engineering shortcoming.

### 3. Fast-Moving Objects

Objects moving faster than the scan rate (or faster than the Kalman filter can track reliably) leave motion blur in the range image, potentially confusing both the semantic front-end and the instance clustering step. The cluster may be partially misclassified or incorrectly bounded.

### 4. Crowded and Occluded Scenes

Overlapping pedestrians or closely spaced vehicles create merged DBSCAN clusters that confuse the per-cluster Kalman tracker. A merged cluster of two pedestrians may be tracked as a single large entity, producing incoherent velocity estimates that lead to mis-classification.

### 5. Semi-Static Object Persistence

If a parked vehicle is classified as semi-static and used with reduced weight, and the vehicle then remains stationary for an extended period, it may gradually accumulate enough weight in the pose-graph to behave like a pure-static anchor. If it subsequently moves, the ghost persists until the offline cleaning stage removes it. The cross-session promotion policy must be carefully designed to prevent this.

### 6. Sparse Pure-Static Landmark Scenes

The BoW3D loop closure relies on the pure-static subset of the map. In scenes with few permanent structures (open tarmac, agricultural fields, mining haul roads), the pure-static subset may be too sparse to produce reliable loop-closure candidates. This can leave uncorrected drift in the pose-graph.

### 7. Compute Budget on Orin

As detailed in the Real-Time-on-Orin section: the as-published RangeNet++ front-end does not fit the 100 ms Orin scan cycle without quantisation or decoupling. Deploying SD-SLAM as published requires engineering work to replace or decouple the segmentation model.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV — outdoor urban | Strong | KITTI evaluation directly applies; vehicles, pedestrians, cyclists are SemanticKITTI classes; building facades and road structure provide pure-static anchors. |
| Road AV — highway | Good | Open road with fewer dynamic object types; dynamic removal benefits are highest in dense traffic. |
| Airside apron — active GSE and vehicles | Research reference with adaptation | GSE, pushback tugs, and catering vehicles are analogous to road vehicles; semantic model must be fine-tuned to include airside-specific classes. Aircraft are not in SemanticKITTI. |
| Airside apron — FOD and static-but-transient objects | Not suitable | Semantic filter provides no protection for unknown-class objects. See Static-but-Transient section. |
| Indoor warehouse | Research reference with adaptation | Forklift, pallet jack, and pedestrian are partially covered; forklifts not in SemanticKITTI. Indoor geometry is structurally different from outdoor road scenes. |
| Port / logistics yard | Research reference with adaptation | RTG cranes and straddle carriers are outside the SemanticKITTI vocabulary; significant re-training required. |
| Mining / construction | Research reference | Heavy equipment, haul trucks partially covered; open terrain has few pure-static vertical features for loop closure. |
| Production static maps | Use cautiously | Semi-static landmarks should not be promoted without explicit cross-session evidence policy. |

---

## Aggregated-Map Suitability

SD-SLAM's role in the aggregated-map pipeline is **online pre-cleaner**, not a replacement for offline cleaning. Its contribution to map quality is to reduce the per-frame dynamic contamination that the offline layer must subsequently process.

**What SD-SLAM improves:**

- The accumulated map entering ERASOR / FreeDOM has fewer ghost trails from known-class dynamic objects.
- Per-frame pose estimates are more accurate (dynamic objects excluded from the ICP/factor-graph), which in turn produces a more accurately registered accumulated map before offline cleaning.
- The semantic labels on the output map enable class-conditioned downstream processing (e.g. separate dynamic vs. infrastructure layers for annotation).

**What SD-SLAM does not replace:**

- ERASOR / FreeDOM offline cleaning: residual ghosts from semi-static objects, OOD objects, and segmentation errors remain and require geometry-based post-processing.
- Lifelong mapping (LT-mapper / Khronos): slow environmental changes (construction, seasonal changes, moved furniture) are outside SD-SLAM's per-session scope.
- FOD and static-but-transient detection: requires a dedicated pipeline operating on raw point cloud or image data, not semantic class filtering.

**Full layered pipeline:**

```
Stage 1: SD-SLAM / SuMa++ (online semantic-dynamic SLAM)
  -> Removes: actively dynamic known-class objects (cars, persons, cyclists)
  -> Handles: semi-static parked vehicles (tracked, down-weighted)
  -> Cannot handle: OOD objects, static-but-transient, slow scene change

Stage 2: ERASOR++ / FreeDOM (offline dynamic removal) on aggregated map
  -> Removes: residual ghost points surviving Stage 1
  -> Removes: semi-static objects that moved between sessions
  -> Best practice: ERASOR++ > ERASOR for complex geometry; FreeDOM for non-flat scenes

Stage 3: LT-mapper / Khronos (lifelong mapping) across multiple sessions
  -> Manages: slow environmental change, construction, seasonal shifts
  -> LT-mapper: multi-session SLAM + LT-removert + live map
  -> Khronos: unified spatio-temporal SLAM for short-term dynamics and long-term changes

Stage 4: Segmentation on cleaned static map
  -> Dynamic contamination substantially reduced -> per-class segmentation quality higher
  -> Auto-labelling on the cleaned map avoids propagating dynamic-class errors
```

See [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) for the full pipeline framing and the segmentation prerequisite ordering.

---

## Implementation Notes

- **Treat semantic labels as uncertain measurements, not ground truth.** Design the landmark classification so that a segmentation error in one frame does not permanently corrupt the map.
- **Maintain three separate map layers: dynamic, semi-static, and pure-static.** Never merge semi-static observations into the production localization layer without cross-session evidence.
- **Define a cross-session promotion policy for semi-static landmarks.** A landmark should only be promoted to pure-static if it has been consistently observed across multiple independent sessions.
- **Evaluate per-class segmentation quality before measuring aggregate trajectory error.** A model with high overall mIoU but low recall on pedestrians will pass aggregate evaluation but fail in pedestrian-dense scenes.
- **On Orin: prototype with SalsaNext (54.4% mIoU) first to validate the pipeline architecture.** Upgrade to FRNet once Orin-specific latency has been confirmed. Decouple the segmentation thread from the odometry thread using the RDS-SLAM async pattern to avoid throttling odometry to the segmentation rate.
- **For airside deployment: fine-tune the segmentation front-end on target-domain data.** A SemanticKITTI-trained model is biased toward road-vehicle environments. Airside-specific classes (GSE, pushback tugs, aircraft, jetway equipment, ground crew, FOD barriers) require annotated fine-tuning data. Budget 500–2000 annotated airside frames minimum.
- **The BoW3D loop closure requires sufficient pure-static landmarks.** On open apron areas with few vertical structures, supplement SD-SLAM's loop closure with a dedicated place recognition module (MinkLoc3D, LoGG3D-Net; see [Loop Closure and Place Recognition](loop-closure-place-recognition.md)).
- **Consider SegNet4D as a drop-in replacement** for the RangeNet++ + DBSCAN + Kalman chain once a quantised Orin-compatible version is available. The joint semantic + MOS output collapses two pipeline stages into one forward pass.
- **Run ERASOR++ or FreeDOM as a mandatory post-processing step** even when SD-SLAM is active online. SD-SLAM reduces but does not eliminate the need for offline dynamic removal.
- **Compare against SuMa++** on the target domain before committing to SD-SLAM's custom convex-hull backbone. SuMa++ has a published, maintained open-source implementation; SD-SLAM's code availability was not confirmed as of 2026.

---

## Sources

| Item | URL |
|---|---|
| SD-SLAM (arXiv 2402.18318) | https://arxiv.org/abs/2402.18318 |
| SD-SLAM (ScienceDirect journal) | https://www.sciencedirect.com/science/article/abs/pii/S221457962400039X |
| SD-SLAM (ResearchGate) | https://www.researchgate.net/publication/380436098_SD-SLAM_A_Semantic_SLAM_Approach_for_Dynamic_Scenes_Based_on_LiDAR_Point_Clouds |
| SuMa++ (arXiv 2105.11320) | https://arxiv.org/abs/2105.11320 |
| SuMa++ (IROS 2019 PDF) | https://www.ipb.uni-bonn.de/wp-content/papercite-data/pdf/chen2019iros.pdf |
| SuMa++ GitHub (PRBonn) | https://github.com/PRBonn/semantic_suma |
| DynaSLAM (arXiv 1806.05620) | https://arxiv.org/abs/1806.05620 |
| DynaSLAM GitHub | https://github.com/BertaBescos/DynaSLAM |
| DS-SLAM (arXiv 1809.08379) | https://arxiv.org/abs/1809.08379 |
| DS-SLAM GitHub | https://github.com/ivipsourcecode/DS-SLAM |
| Detect-SLAM (WACV 2018) | https://www.youtube.com/watch?v=eqJiyU9ebaY |
| ClusterSLAM (ICCV 2019) | https://openaccess.thecvf.com/content_ICCV_2019/papers/Huang_ClusterSLAM_A_SLAM_Backend_for_Simultaneous_Rigid_Body_Clustering_and_ICCV_2019_paper.pdf |
| ClusterVO (CVPR 2020) | https://openaccess.thecvf.com/content_CVPR_2020/papers/Huang_ClusterVO_Clustering_Moving_Instances_and_Estimating_Visual_Odometry_for_Self_CVPR_2020_paper.pdf |
| RDS-SLAM (IEEE Access 2021) | https://ieeexplore.ieee.org/document/9318990/ |
| RDS-SLAM GitHub | https://github.com/yubaoliu/RDS-SLAM |
| Semantics Aware 3D MODT (PMC 2021) | https://pmc.ncbi.nlm.nih.gov/articles/PMC8512852/ |
| SA-LOAM (ICRA 2021, arXiv 2106.11516) | https://arxiv.org/abs/2106.11516 |
| SegMap (IJRR 2020) | https://journals.sagepub.com/doi/abs/10.1177/0278364919863090 |
| SegNet4D (arXiv 2406.16279 / T-ASE 2025) | https://arxiv.org/abs/2406.16279 |
| SegNet4D GitHub | https://github.com/nubot-nudt/SegNet4D |
| FRNet (arXiv 2312.04484 / TIP 2025) | https://arxiv.org/abs/2312.04484 |
| FRNet GitHub | https://github.com/Xiangxu-0103/FRNet |
| FreeDOM (arXiv 2504.11073) | https://arxiv.org/html/2504.11073 |
| Dynamic removal benchmark (ITSC 2023) | https://arxiv.org/abs/2307.07260 |
| Dynamic removal benchmark GitHub | https://github.com/KTH-RPL/DynamicMap_Benchmark |
| LiDAR semantic segmentation on Orin (arXiv 2410.08365) | https://arxiv.org/html/2410.08365v1 |
| SemanticKITTI tasks | https://semantic-kitti.org/tasks.html |
| LT-mapper (arXiv 2107.07712) | https://arxiv.org/abs/2107.07712 |
| Khronos (spatio-temporal SLAM) | https://github.com/MIT-SPARK/Khronos |
| Awesome Dynamic SLAM list | https://github.com/zhuhu00/Awesome_Dynamic_SLAM |
| Related method page: ERASOR (iter 19) | `./erasor.md` |
| Related method page: ERASOR++ (iter 22) | `./erasor-plus-plus.md` |
| Related method page: FreeDOM (iter 20) | `./freedom-dynamic-object-removal.md` |
| Related method page: LT-mapper / Khronos (iter 21) | `./lt-mapper-khronos-lifelong-mapping.md` |
| Related method page: LiDAR map cleaning overview (iter 5) | `./lidar-map-cleaning-dynamic-removal.md` |
| Related method page: Dynamic map cleaning benchmarks (iter 21) | `./dynamic-map-cleaning-benchmarks.md` |
| Related method page: SuMa / SuMa++ | `./suma.md` |
| Related method page: Loop closure / place recognition | `./loop-closure-place-recognition.md` |
| Related overview: Static-but-Transient Point Removal (iter 19) | `../../perception/overview/static-but-transient-point-removal.md` |
| Related overview: Aggregated-Map Semantic Segmentation | `../../perception/overview/aggregated-map-semantic-segmentation.md` |
| Related method: SalsaNext | `../../perception/methods/salsanext.md` |
| Related method: FRNet | `../../perception/methods/frnet.md` |
| Related method: SegNet4D | `../../perception/methods/segnet4d.md` |
| Related method: LiDAR MOS | `../../perception/methods/lidar-mos.md` |
| Related method: 4DMOS | `../../perception/methods/4dmos.md` |
