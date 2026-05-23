# Dynamic-Object-Aware SLAM

<!-- method-priority:start
priority:
  learning: 4
  deployment: 5
  type: "method"
  stage: "deployment-pattern"
  maturity: "pilot-proven"
  tags: ["slam", "mapping", "validation", "runtime-localization", "outdoor"]
  reason: "Dynamic-Object-Aware SLAM is rated for dynamic-object filtering and map-cleaning workflows that protect localization maps."
method-priority:end -->

Related docs: [SD-SLAM Semantic-Dynamic LiDAR](./sd-slam-semantic-dynamic-lidar.md), [DO-Removal LIO](./do-removal-lio.md), [Dynamic-Aware LIO BTSA](./dynamic-aware-lio-btsa.md), [DOF-LIO](./dof-lio-lightweight-dynamic-object-filter.md), [MoVES and Label-Free Map Cleaning](./moves-and-label-free-map-cleaning.md), [SuMa / SuMa++](./suma.md), [ERASOR](./erasor.md), [ERASOR++](./erasor-plus-plus.md), [FreeDOM](./freedom-dynamic-object-removal.md), [MapCleaner](./mapcleaner.md), [DR-Remover](./dr-remover.md), [LiDAR Map Cleaning — Dynamic Removal](./lidar-map-cleaning-dynamic-removal.md), [Dynamic Map Cleaning Benchmarks](./dynamic-map-cleaning-benchmarks.md), [LT-Mapper / Khronos Lifelong Mapping](./lt-mapper-khronos-lifelong-mapping.md), [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md), [KISS-ICP](./kiss-icp.md), [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [LiDAR Artifact Removal Techniques](../../perception/overview/lidar-artifact-removal-techniques.md).

**Last updated:** 2026-05-24

---

## What It Is

Dynamic-object-aware SLAM is a family of systems that explicitly model or suppress moving objects so that pose estimation and map construction remain accurate in real-world environments where the static-world assumption fails. Classical SLAM systems — ORB-SLAM, LOAM, FAST-LIO2, LIO-SAM — derive their estimation objectives under the assumption that every measured point belongs to a permanent, immovable surface. In practice, 5–30% of points in a typical urban or airside scan belong to moving actors: vehicles, pedestrians, GSE, aircraft, and temporary infrastructure.

This fraction violates two algebraic assumptions simultaneously.

**ICP static-scene assumption.** The standard ICP objective is:

```
E(T) = sum_i rho( ||T * p_i - q_i||^2 )
```

where p_i are source scan points, q_i are corresponding map points, and T is the ego transform being estimated. Points from moving objects contribute residuals not caused by ego-motion. Minimising E over all points biases T toward a compromise between static and dynamic structure, degrading the pose estimate in proportion to the dynamic fraction of the scan.

**Map accumulation assumption.** After ICP, all registered source points are inserted into the local map. Ghost trails from moving vehicles, pedestrians, and equipment accumulate. Future scans register against ghost-contaminated geometry, compounding pose error — a positive feedback loop that grows with survey duration.

**Airside severity.** At an active airport apron, large objects — aircraft, pushback tugs, catering trucks, belt loaders, fuel bowsers — can occupy 20–40% of LiDAR scan volume near stands. Survey missions often last 20–60 minutes during operations. Without dynamic awareness, the resulting map is unusable for precision localisation.

Dynamic-object-aware SLAM is **production-useful** as an aid to map cleanliness, scan matching, long-term localisation, and change detection. The production backbone should remain validated scan-to-map localisation and LiDAR-inertial odometry — the dynamic-aware layer protects and improves that backbone rather than replacing it.

---

## Core Technical Idea — Five-Axis Taxonomy

The field has converged on five structurally distinct approaches. The choice between them drives compute cost, labelling requirements, and failure modes. Each axis is a different answer to the question: "How do you identify which points should be excluded from ICP and map insertion?"

| Axis | Detection Signal | Label Cost | Typical Latency | Key Limitation |
|---|---|---|---|---|
| Geometric-only | Range/normal/temporal inconsistency | Zero | 1–50 ms | Cannot detect stationary transients |
| Semantic-aware | Class-prior ICP weighting | High (500–2000 annotated frames) | 84–300 ms | OOD objects invisible |
| Object-level | Detect-and-track bounding boxes | High (custom detector training) | ~5–15 ms GPU | Missed detections, novel classes |
| Motion-prior / scene-flow | Per-point flow vs ego-motion | Moderate to high | Expensive (flow nets) | Maturity gap for LiDAR |
| Label-free learned | Self-supervised pseudo-labels | Minimal | Varies | Below supervised accuracy |

---

## The Five-Axis Taxonomy

### Axis 1 — Geometric-Only (Visibility / Free-Space / 4D Normals)

No semantic model. Dynamic evidence comes from geometric inconsistency between the current scan and either an accumulated map or a temporal window of recent scans.

**Sub-variants:**

**Range-image differencing.** The current scan's spherical range image is projected and compared pixel-by-pixel against the submap projection. Pixels exceeding a range-difference threshold Δ_r are flagged dynamic before ICP. Fast (O(pixels)); resolution-limited by range-image resolution; incidence-angle false positives on surfaces nearly parallel to LiDAR rays. Representative: RF-LIO (arXiv:2206.09463).

**Visibility check (ikd-Tree point-level).** Per point p_i, the bearing direction (θ_i, φ_i) is used to look up the nearest ikd-Tree entry in the map along that direction. If the measured range r_i satisfies |r_i - r_map(θ_i, φ_i)| > Δ_vis, the point is flagged dynamic. Finer resolution than range-image comparison because the comparison is at point level; no rendering step required; O(log n) tree lookup. Representative: DOF-LIO (IEEE T-IM 2026, DOI:10.1109/TIM.2026.3666055).

**Region-growing cluster confidence.** Ground-plane fitting provides a height reference. High-curvature points are selected as seeds; region growing by spatial proximity and normal consistency expands each seed into a cluster. A confidence score derived from cluster size, height span, and aspect ratio determines dynamic/static labelling. Operates entirely on current-scan geometry — no map comparison required for the flagging step. Representative: DO-Removal (RA-L 2025, DOI:10.1109/LRA.2025.3632615).

**4D spatio-temporal normals.** A 4D surface normal n = (a, b, c, d) is computed from a local neighbourhood of timestamped points in a sliding temporal window (~2 s). For a static surface, the temporal component d → 0. For a moving surface, |d| > 0 where d = -(a*v_x + b*v_y + c*v_z). Threshold |d| > 0.1 flags points as unstable. A Spatial Consistency Verification (SCV) step uses DBSCAN plus overlap with a confirmed-static map layer to distinguish genuinely dynamic unstable points from newly-observed static geometry, which also generates non-zero d due to one-sided temporal neighbourhoods. Critical advantage: circular-dependency-free — 4D normals are computed from raw timestamped point clouds before any ICP step. Representative: BTSA (RA-L 2025, arXiv:2510.22313).

**Pros:** No training data; domain-agnostic; deployable on novel environments immediately without labelled data.

**Cons:** Cannot reason about object class; stationary transients are entirely invisible; slow movers may elude frame-to-frame detectors; sparse sensor densities degrade 4D normal estimation.

**Relevant pages:** [DO-Removal LIO](./do-removal-lio.md) (iter-26), [Dynamic-Aware LIO BTSA](./dynamic-aware-lio-btsa.md) (iter-27), [DOF-LIO](./dof-lio-lightweight-dynamic-object-filter.md) (iter-29).

---

### Axis 2 — Semantic-Aware (Class-Prior ICP Weighting)

A semantic segmentation model (RangeNet++, SalsaNext) labels points or surfels with class identities. Dynamic-class points (car, person, cyclist) are downweighted or excluded from ICP. Stationary-but-movable objects are kept with reduced weight.

**Pros:** Pre-emptive — flags dynamic-class objects even on frame 1 before any motion has been observed. Produces a labelled output map as a by-product for downstream semantic queries.

**Cons:** Bound to training-distribution classes. Out-of-distribution objects (airside GSE, FOD, unusual vehicle types) are entirely invisible to the filter. Labelling cost is non-trivial: airside fine-tuning requires 500–2000 annotated frames. RangeNet++ DarkNet-53 exceeds 100 ms without quantisation on Jetson Orin; SalsaNext ranges 84–109 ms.

**Representatives:** SuMa++ (IROS 2019, arXiv:2105.11320, https://github.com/PRBonn/semantic_suma); SD-SLAM (arXiv:2402.18318, ScienceDirect DOI:10.1016/j.iot.2024.101209).

**Relevant pages:** [SD-SLAM Semantic-Dynamic LiDAR](./sd-slam-semantic-dynamic-lidar.md) (iter-23), [SuMa / SuMa++](./suma.md).

---

### Axis 3 — Object-Level (Detect-and-Track)

A 3D or 2D detector produces bounding boxes per object instance. A tracker (Kalman, UKF, particle filter) propagates instance state across frames. Points inside dynamic-object boxes are excluded from ICP; object tracks can be published separately for planning and situational awareness.

**Pros:** Temporally consistent — per-instance tracks across frames reduce flicker in the dynamic mask. Object-level reasoning enables velocity estimation. False positives are bounded by box geometry; a false positive flags a specific region, not an arbitrary point cloud neighbourhood.

**Cons:** Hard dependency on a trained detector; unknown classes are completely invisible. GPU inference for PointPillars or Mask R-CNN adds 5–15 ms on a GPU but is expensive on CPU-only embedded systems. Airside retraining cost is high because standard detectors are trained on road-vehicle classes.

**Representatives:** TRLO (arXiv:2410.13240, https://github.com/Yaepiii/TRLO); ClusterSLAM (ICCV 2019); ClusterVO (CVPR 2020); DynaSLAM visual lineage (see Section 3).

---

### Axis 4 — Motion-Prior / Scene-Flow

Per-point 3D motion is estimated — via scene flow, optical flow, or epipolar geometry — to identify points whose 3D displacement is inconsistent with the estimated ego-motion. Points with anomalous residuals are flagged dynamic.

**Pros:** Can detect motion even for object classes not present in any training vocabulary, provided sufficient temporal density exists to estimate per-point flow.

**Cons:** Scene-flow estimation adds significant compute overhead. Optical flow is camera-only; generalisation to LiDAR requires either range-image projection or 3D flow networks, both of which are active research areas. DS-SLAM's moving-consistency check is a lightweight 2D approximation that provides reasonable performance without full scene flow.

**Representative approaches:** DynaVINS (visual-inertial VINS variant); DS-SLAM's moving consistency check (Section 3); InsMOS.

---

### Axis 5 — Label-Free Learned (Self-Supervised Pseudo-Labels)

A network produces dynamic/static pseudo-labels from multi-scan geometric consistency without manual annotation. The network learns to separate moving points using temporal occupancy evidence or flow fields derived from the data itself.

**Pros:** No manual labels required. Can generalise to novel domains via self-supervised fine-tuning on the target-domain sensor data. Avoids class-vocabulary constraints of semantic-aware methods.

**Cons:** Still below supervised methods at equivalent compute budget. Pseudo-label quality depends on motion diversity in the training sequence. Not yet production-proven in safety-critical localisation applications.

**Representatives:** MOVES (arXiv, iter-28); MODEST (self-supervised LiDAR moving-object segmentation).

**Relevant page:** [MoVES and Label-Free Map Cleaning](./moves-and-label-free-map-cleaning.md) (iter-28).

---

## Visual Dynamic-SLAM Lineage

Visual methods form the conceptual foundation of the field. Their design patterns — semantic mask plus geometric consistency plus multi-body tracking — recur in LiDAR systems. Understanding the visual lineage reveals the design decisions that the LiDAR family later inherited or departed from.

### DynaSLAM (Bescos et al., RA-L + IROS 2018)

**Paper:** "DynaSLAM: Tracking, Mapping and Inpainting in Dynamic Scenes"
**ArXiv:** https://arxiv.org/abs/1806.05620
**GitHub:** https://github.com/BertaBescos/DynaSLAM
**Sensor:** Monocular, stereo, RGB-D (ORB-SLAM2 backbone)

Mask R-CNN detects potentially dynamic objects using COCO classes. For monocular and stereo modes, multi-view geometric consistency cross-validates which detected objects are actually moving by checking whether matched features violate the fundamental matrix under the static assumption. Points inside confirmed dynamic regions are removed from the feature set before pose estimation. A deep inpainting network fills the occluded static background behind removed regions, preserving a complete appearance model for loop closure.

**Results.** Order-of-magnitude ATE reduction on TUM RGB-D dynamic sequences: sequence `walking_xyz` drops from ORB-SLAM2 0.608 m to DynaSLAM 0.019 m ATE RMSE. The canonical proof that semantic masks can protect visual SLAM from dynamic contamination at test time.

**Limitation.** Mask R-CNN inference is the bottleneck (~200–300 ms per frame on GPU at time of publication). RGB-D range limitation (~4 m for Kinect). No LiDAR support.

### DS-SLAM (Yu et al., IROS 2018)

**Paper:** "DS-SLAM: A Semantic Visual SLAM towards Dynamic Environments"
**ArXiv:** https://arxiv.org/abs/1809.08379
**GitHub:** https://github.com/ivipsourcecode/DS-SLAM
**Sensor:** RGB-D (ORB-SLAM2 backbone)

SegNet (lighter than Mask R-CNN) runs on a parallel thread decoupled from the odometry thread — no stall. Dual-gate filtering: only segments that (a) belong to a dynamic semantic class AND (b) fail the moving-consistency check (optical flow inconsistency or epipolar geometry violation) are removed. Parked cars pass the consistency check and remain as map structure. Output: dense semantic octo-tree map.

**Key innovation.** The dual-gate — semantic class as necessary but not sufficient condition for removal — prevents the classic over-removal failure where parked vehicles are purged from the localisation map. This design pattern is the direct visual ancestor of SD-SLAM's three-tier landmark classification (dynamic / semi-static / pure-static).

**Results.** One order of magnitude ATE improvement over ORB-SLAM2 on TUM RGB-D walking sequences; faster than DynaSLAM at comparable accuracy.

### Detect-SLAM (Zhong et al., WACV 2018)

Bounding-box-level object detection (not pixel-level segmentation) to mask dynamic regions from feature extraction. Key contribution: bi-directional benefit — SLAM improves detection (temporal consistency confirms cross-frame detections) and detection improves SLAM (dynamic features are removed). Establishes the pattern later exploited at finer granularity by DynaSLAM and DS-SLAM.

### RDS-SLAM (Liu and Miura, IEEE Access 2021)

**Paper:** DOI 10.1109/ACCESS.2021.3050617
**GitHub:** https://github.com/yubaoliu/RDS-SLAM
**Sensor:** RGB-D (ORB-SLAM3 backbone)

Engineering contribution: the semantic segmentation thread is fully asynchronous — odometry does not wait for segmentation results. The latest available semantic mask is applied, decoupling segmentation latency from pose-estimation latency entirely. This async-thread pattern is directly applicable to LiDAR semantic SLAM including SD-SLAM on compute-constrained hardware such as Jetson Orin where RangeNet++ may exceed the 10 Hz scan period.

### ClusterSLAM / ClusterVO (Huang et al., ICCV 2019 / CVPR 2020)

**ClusterSLAM:** ICCV 2019
**ClusterVO:** CVPR 2020

Instance-centric approach requiring no semantic labels. A noise-aware motion affinity matrix is constructed over SLAM landmarks. Agglomerative clustering discovers rigid bodies automatically. ClusterVO adds a CRF probabilistic association combining semantic, spatial, and motion cues. ClusterVO achieves lower ATE than DynaSLAM on KITTI raw sequences. The instance-centric paradigm does not require semantic class knowledge — any rigid body with enough features is discoverable, including unknown object types. This is the visual ancestor of geometry-only cluster-confidence methods in the LiDAR family.

### DynaVINS

Visual-inertial SLAM variant extending VINS-Mono to handle dynamic scenes via semantic masking and robust cost functions. Represents the tight coupling of dynamic handling with IMU preintegration — the pattern applied in the LiDAR-inertial family by BTSA and DOF-LIO.

---

## LiDAR Dynamic-SLAM Lineage

### SuMa++ — Canonical Semantic LiDAR SLAM (IROS 2019)

**Paper:** Chen, Milioto, Palazzolo, Giguère, Behley, Stachniss, "SuMa++: Efficient LiDAR-based Semantic SLAM"
**ArXiv:** https://arxiv.org/abs/2105.11320
**GitHub:** https://github.com/PRBonn/semantic_suma

Extends SuMa (surfel-based LiDAR SLAM). RangeNet++ provides per-point semantic labels by projecting onto a spherical range image and running a 2D CNN. Two semantic mechanisms are applied simultaneously:

1. **Semantic ICP weighting.** Correspondences where the scan point's label and the map surfel's label disagree receive higher cost, acting as soft exclusion of semantically inconsistent points including dynamic-class objects.
2. **Online consistency checking.** When a surfel was labelled `car` in the map but the current scan predicts `background` at that location (car drove away), the surfel is flagged dynamic and removed. Surfels are not deleted on class membership alone — they are deleted when scan-map label consistency fails, which prevents purging parked cars.

**Results.** Relative translational error approximately 0.22%–0.46% on KITTI highway sequences. The advantage over baseline SuMa is highest on sequences with dense moving vehicles. SuMa++ is the foundational published LiDAR semantic SLAM benchmark with available code. DO-Removal, BTSA, and DOF-LIO all cite it as the predecessor they depart from by removing the learned segmentation dependency.

**Relevant page:** [SuMa / SuMa++](./suma.md).

### RF-LIO (arXiv:2206.09463, 2022)

Range-image differencing brought inside the LIO loop. The current scan's range map is compared to the submap projection; pixels above a range-difference threshold are flagged dynamic before ICP. Published numbers: 90% ATE improvement vs LOAM, 70% vs LIO-SAM on UrbanLoco. Primary limitation: incidence-angle false positives on surfaces nearly parallel to LiDAR rays. The direct ancestor of DOF-LIO's visibility mechanism.

### SD-SLAM — Semantic Three-Tier LiDAR SLAM (iter-23)

**Paper:** "SD-SLAM: A Semantic SLAM Approach for Dynamic Scenes Based on LiDAR Point Clouds"
**ArXiv:** https://arxiv.org/abs/2402.18318
**Journal:** ScienceDirect/IoT, DOI:10.1016/j.iot.2024.101209

RangeNet++ semantic segmentation plus DBSCAN instance clustering plus a CTRV Kalman filter per cluster produces a three-tier landmark classification:

- **Dynamic:** dynamic-class label AND Kalman velocity/position deviation above threshold — hard-excluded from the pose graph.
- **Semi-static:** dynamic-class label AND Kalman shows stationary — included at weight w_s < 1.
- **Pure-static:** terrain or structure class — full weight.

Loop closure is restricted to the pure-static subset via improved BoW3D.

Key contribution over SuMa++: the three-tier scheme treats parked vehicles as semi-static registration anchors (useful with caution) rather than unconditionally excluding or promoting them. Cross-session evidence is required before a semi-static landmark is promoted to pure-static.

**Results.** Landmark classification F1 = 91% on KITTI odometry. Trajectory ATE/RPE numbers in the journal version (ScienceDirect) only — not reproduced in arXiv preprint. Not yet on KTH DynamicMap Benchmark.

**Airside notes.** SemanticKITTI vocabulary covers road vehicles and pedestrians; airside GSE, aircraft, pushback tugs, and FOD are out-of-distribution. Fine-tuning RangeNet++ on 500–2000 annotated airside frames is required before semantic filtering provides airside coverage.

**Relevant page:** [SD-SLAM Semantic-Dynamic LiDAR](./sd-slam-semantic-dynamic-lidar.md).

### DO-Removal-LIO — Region-Growing Cluster Confidence (iter-26)

**Paper:** "DO-Removal: Dynamic Object Removal for LiDAR-Inertial Odometry Enabled by Front-End Real-Time Strategy"
**Venue:** IEEE RA-L, Vol. 11 No. 1, pp. 169–176, 2026
**DOI:** 10.1109/LRA.2025.3632615 (paywall)

Geometry-only, no trained model. Per-scan pipeline: fast ground-plane fit as height reference; seed selection from high-curvature points; region growing by spatial proximity and normal consistency; cluster confidence scoring from cluster size, height span, and aspect ratio; dynamic clusters hard-excluded from ICP cost and map insertion; multiline context-beam feature extractor uses adjacent scan-line context to improve feature significance for ICP.

The key architectural departure from SuMa++ and SD-SLAM: dynamic flagging runs entirely without a semantic network. Only current-scan geometry and a fitted ground plane are needed — making the method domain-agnostic and deployable without labelled data.

**Results.** Competitive against baselines on KITTI and UrbanLoco; specific ATE numbers behind IEEE Xplore paywall. The broader online geometric family achieves 67–92% ATE improvement over non-dynamic-aware LIO baselines on comparable sequences (see Benchmark Results section). No confirmed public repository as of 2026-05-24.

**Relevant page:** [DO-Removal LIO](./do-removal-lio.md).

### Dynamic-LIO (IROS 2025)

**ArXiv:** https://arxiv.org/abs/2407.03590
**GitHub:** https://github.com/ZikangYuan/dynamic_lio

Binary label-consistency: a point is dynamic if it has fewer than 5 nearest neighbours in the map (sudden appearance) or its ground/non-ground label contradicts neighbours. Dual map: tracking-map retains all geometry; output-map applies maximum removal. Overhead: 1–9 ms per sweep — the lightest in the family, safe at 20 Hz. Results on UrbanNav ULHK-CA: 4.84 m ATE vs FAST-LIO2 15.34 m (68% improvement). Preservation 90.36%, rejection 90.73% on KITTI dynamic sequences. Recommended open-source Stage-1 prototype when code availability is the binding constraint.

### BTSA — 4D Spatio-Temporal Normals (iter-27)

**Paper:** "Breaking the Static Assumption: A Dynamic-Aware LIO Framework Via Spatio-Temporal Normal Analysis"
**Venue:** IEEE RA-L (accepted October 2025)
**ArXiv:** https://arxiv.org/abs/2510.22313
**GitHub:** https://github.com/thisparticle/btsa (GPL-2.0)

4D surface normal n = (a, b, c, d) computed from timestamped point neighbourhoods in a ~2 s sliding window. For static surfaces, d → 0; for moving surfaces, |d| > 0. Spatial Consistency Verification step uses DBSCAN plus overlap with a confirmed-static map layer to separate genuinely dynamic points from newly-observed static geometry.

**Results.** DOD sequences: BTSA 0.79–3.04 m ATE vs FAST-LIO2 12.4–28.3 m. Geometrically degenerate (tunnel) sequence: BTSA 0.46 m RMSE vs no-dynamic-detection 35.84 m. HeLiMOS benchmark on Aeva FMCW LiDAR: HA = 82.50% — best online method, within 2% of best offline method (DUFOMap HA = 84.57%). VLP-16 sparse sensor: HA drops to 57.79% — fundamental limitation of the 4D normal estimator at sparse point densities.

**Runtime.** ~49.69 ms per scan. Fits 10 Hz (100 ms budget); marginal at 20 Hz (50 ms).

**Relevant page:** [Dynamic-Aware LIO BTSA](./dynamic-aware-lio-btsa.md).

### DOF-LIO — Visibility + Voxel-Hash + Recovery (iter-29)

**Paper:** "DOF-LIO: LiDAR-Inertial Odometry with Lightweight Dynamic Object Filter"
**Venue:** IEEE Transactions on Instrumentation and Measurement (T-IM), 2026
**DOI:** 10.1109/TIM.2026.3666055 (paywall)

Three-gate pipeline wrapping a FAST-LIO2 IEKF backbone:

1. **Gate 1 — Visibility check.** Per-point: |r_i - r_map(θ_i, φ_i)| > Δ_vis. Comparison made at point level against the ikd-Tree, removing incidence-angle artifacts.
2. **Gate 2 — Voxel-hash outlier suppression.** Points assigned to voxels via O(1) hash lookup; voxels with fewer than N_min flagged points are de-flagged, guarding against sensor noise and map-edge artifacts.
3. **Gate 3 — Static-boundary recovery.** Points near dynamic cluster boundaries that are spatially consistent with the static map within δ_static are restored, preventing over-removal of ground under vehicles.

Lighter than BTSA (~49 ms) because no SVD over temporal window. Finer resolution than RF-LIO because point-level ikd-Tree vs range-image. More complete than Dynamic-LIO because explicit suppression and recovery stages. Preferred Stage-1 online LIO for Jetson Orin-class embedded survey vehicles at 20 Hz. Specific ATE numbers are behind IEEE Xplore paywall; no confirmed public repository.

**Relevant page:** [DOF-LIO](./dof-lio-lightweight-dynamic-object-filter.md).

---

## The Online + Offline Layered Four-Stage Pipeline

Online LIO-embedded dynamic filtering and offline post-hoc cleaning are complementary. They operate at different pipeline stages and handle different temporal evidence regimes.

| Dimension | Online LIO-embedded | Offline post-hoc |
|---|---|---|
| When | Per frame, inside LIO loop | After full survey traversal |
| Temporal evidence | Limited (single frame or short window) | Full sequence available |
| Clean map available | Immediately, per frame | After survey completes |
| Stationary-transient detection | Cannot detect | Cannot detect (single pass) |
| Pose-accuracy dependency | Uses noisier prior poses | Uses final optimised poses |
| Over-removal risk | Higher (conservative thresholds needed) | Lower (can examine full trajectory) |
| PR/RR metric target | Not applicable (ATE is the metric) | F1 0.93–0.99 on SemanticKITTI |
| Representative methods | DO-Removal, BTSA, DOF-LIO, Dynamic-LIO | ERASOR++, FreeDOM, MapCleaner, DR-Remover |

### Recommended Four-Stage Architecture

```
Stage 1 — Online LIO front end (per-frame, survey vehicle)
  Candidates: DOF-LIO [embedded, Orin, 20 Hz, visibility+voxel-hash+recovery]
              Dynamic-LIO [lightest 1-9 ms, open-source, 10 Hz or 20 Hz]
              BTSA [best slow-mover sensitivity, ~50 ms, 10 Hz only, 64-beam min]
              DO-Removal [region-grow confidence, geometry-only]
              SD-SLAM / SuMa++ [for known-class semantic coverage]
  Removes: actively moving objects during the survey
  Provides: clean per-frame map for planning and obstacle avoidance
  Residual: slow movers, cluster-boundary fragments, objects that
            stopped mid-survey, objects below point-density threshold

Stage 2 — Offline cleaning (post-survey, cloud/workstation)
  Methods: ERASOR++ / FreeDOM / MapCleaner / DR-Remover
  Runs after full traversal; achieves F1 0.93-0.99 (SemanticKITTI)
  because full temporal evidence is available; catches ghosts Stage 1 missed
  Cross-links: ERASOR++ (iter-22), FreeDOM (iter-20), MapCleaner (iter-24),
               DR-Remover (iter-25)

Stage 3 — Lifelong static-but-transient removal (multi-session)
  Methods: LT-Mapper / Khronos / ELite / instance-quarantine
  Removes: objects stationary throughout the entire survey session
  Operates on calendar-time scale (hours, days, sessions)
  MANDATORY for airside — see Static-but-Transient Blind Spot section below
  Cross-links: LT-Mapper/Khronos (iter-21), static-but-transient (iter-19)

Stage 4 — Semantic map quality
  Segmentation on the cleaned static map (SalsaNext or FRNet on Orin)
  produces per-class layers for downstream queries
  Contamination reduced across Stages 1-3 feeds higher segmentation quality
  Cross-links: SD-SLAM (iter-23), aggregated-map semantic segmentation
```

**The F1 gap is real and structural.** Online methods reach roughly F1 0.90; offline methods reach 0.97–0.99. The gap arises because the online method has no future-frame evidence at registration time. Stages 1 and 2 are both required in production — Stage 1 for a clean per-frame map, Stage 2 for a publishable survey product.

---

## Static-but-Transient Blind Spot

This is the dominant unresolved failure mode for all online methods **and** all single-pass offline methods in airside application.

**Definition.** An object that is stationary for the entire SLAM session will never trigger any detection mechanism:

- No range-image inconsistency (RF-LIO, DOF-LIO)
- No label-consistency violation (Dynamic-LIO, SuMa++)
- No DON counter accumulation (ID-LIO)
- No temporal component in the 4D surface normal (BTSA — d = 0 for stationary objects)
- No geometric cluster motion (DO-Removal)
- No pseudo-occupancy disagreement (ERASOR, FreeDOM)

This is not a threshold-tuning problem. It is a fundamental information-theoretic limitation: single-session methods have no signal distinguishing a permanent wall from an object that happened to be parked throughout the survey.

**Airside examples.** Belt loader parked at stand for the full 40-minute survey; boarding stairs extended to an aircraft door; catering truck docked to galley; GPU/ASU staged near a gate; ground-power cable laid across a taxilane. All are baked into the static LIO map by any Stage-1 or Stage-2 method.

**Scope.** ALL five online geometric methods (geometric-only, semantic-aware, object-level, scene-flow, label-free learned) share this blind spot. Single-pass offline cleaners (ERASOR, FreeDOM, MapCleaner, DR-Remover) share it equally. The blind spot is not a property of a specific approach — it is a property of operating within a single survey session.

**Only Stage 3 (lifelong / multi-session) addresses this class.** A parked object absent in a later survey pass is detectable via multi-session temporal differencing: LT-Mapper's LT-Removert module; Khronos's spatio-temporal volumetric representation. Instance quarantine — tagging all object-class point clusters with a provisional status requiring multi-pass confirmation before static promotion — is the operational mitigation strategy.

**Stage 3 is non-optional for airside.** An airport apron map that has not undergone multi-session cleaning will systematically contain stationary GSE and aircraft from the survey period baked into the static localisation layer. Navigation decisions based on this map will be made against phantom obstacles. This is not a recoverable failure at runtime — it requires a map rebuild.

**Cross-reference:** [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md) covers the full taxonomy, failure modes, and mitigations in depth.

---

## Benchmark Results

### KITTI Odometry (Geiger et al., CVPR 2012)

22 sequences; 11 with ground truth. Standard ATE/RPE evaluation. Dynamic sequences (00, 01, 05, 06, 07) include moving vehicles and pedestrians at various densities. Used by LOAM, LIO-SAM, FAST-LIO2, SD-SLAM, TRLO (seq 07: RPE 1.10 m, APE 0.92 m at >20 Hz), DOF-LIO, RF-LIO. Limitation: no per-point dynamic labels; dynamic fraction varies per sequence; sequence 01 (highway) is heavily dynamic but has sparse features.

### SemanticKITTI Dynamic-Map (Behley et al., ICCV 2019)

Per-point semantic labels over KITTI odometry sequences including `moving-car`, `moving-person`, `moving-cyclist` classes, enabling precise precision/recall/F1 evaluation of map quality. The standard benchmark for the offline stack.

| Method | Type | F1 range | Notes |
|---|---|---|---|
| Removert | Offline | ~0.87–0.91 | Sequences 00, 01, 05, 07 |
| ERASOR | Offline | 0.921–0.955 | Sequences 00–07 |
| ERASOR++ | Offline | 0.930–0.986 | Higher PR than ERASOR |
| FreeDOM | Near-online + offline | 0.971–0.996 (estimated best) | KTH format |
| Dynamic-LIO | Online | 90.4% PR, 90.7% RR | KITTI dynamic sequences |

SemanticKITTI is not the right benchmark for online LIO ATE evaluation — it measures map point-cloud cleanliness, not pose accuracy. The two metric families are complementary, not interchangeable.

### KTH DynamicMap Benchmark (ITSC 2023)

**Paper:** arXiv:2307.07260
**GitHub:** https://github.com/KTH-RPL/DynamicMap_Benchmark
**Live leaderboard:** https://kth-rpl.github.io/DynamicMap_Benchmark/

Unified framework for dynamic point removal evaluation. Metrics: Precision (P), Recall (R), F1 on static/dynamic point classification. Datasets: KITTI seq 00, 05; Argoverse 2.0; semi-indoor. Currently includes 8+ state-of-the-art methods: Octomap, ERASOR, Removert, OctoMap+GF, FreeDOM, DR-Remover, MapCleaner. SD-SLAM and the online geometric LIO family are not yet included in the leaderboard.

### HeLiMOS Dataset (IROS 2024)

**Paper:** arXiv:2408.06328
**GitHub:** https://github.com/url-kaist/HeLiMOS-PointCloud-Toolbox

Heterogeneous LiDAR sensors (Aeva FMCW 4D, Avia solid-state, Ouster OS1-128, Velodyne VLP-16) with ground-truth annotations for moving objects. Metrics: SA (Static Accuracy), DA (Dynamic Accuracy), HA (Harmonic mean). Key results from BTSA evaluation:

| Sensor | Method | HA | Notes |
|---|---|---|---|
| Aeva FMCW | BTSA | 82.50% | Best online method |
| Aeva FMCW | DUFOMap | 84.57% | Best offline method (reference) |
| VLP-16 | BTSA | 57.79% | Sparse-sensor degradation |

HeLiMOS is the first benchmark to expose sensor density as a first-order variable in online dynamic-detection performance. The VLP-16 result is a direct warning for deployments on sparse-ring-count LiDARs.

### UrbanLoco / UrbanNav ATE Summary (Online LIO Geometric Branch)

**Honest framing:** DO-Removal and DOF-LIO specific ATE numbers are behind the IEEE paywall. The figures below are sourced from open-access papers in the same family; do not cite a single number as representative of the whole family without attribution.

| Method | Dataset | ATE improvement vs baseline | Baseline | Open source |
|---|---|---|---|---|
| RF-LIO | UrbanLoco | 90% | LOAM | No |
| RF-LIO | UrbanLoco | 70% | LIO-SAM | No |
| ID-LIO | UrbanLoco-CAMarketStreet | 67% | LIO-SAM | Yes (PMC) |
| ID-LIO | UrbanNav-HK | 85% RMSE (0.9 m vs 7.5 m) | LIO-SAM | Yes |
| Dynamic-LIO | ULHK-CA (UrbanNav) | 68% (4.84 m vs 15.34 m) | FAST-LIO2 | Yes |
| STATIC-LIO | Various | up to 92.4% | SOTA LIO | No (journal) |
| BTSA | DOD (MountainTopPark) | ~80% (0.79–3.04 m vs 12–28 m) | FAST-LIO2 | Yes (GPL-2.0) |

The 67–92% ATE improvement range over non-dynamic-aware LIO baselines is sourced from open-access ID-LIO, Dynamic-LIO, and STATIC-LIO figures. DO-Removal and DOF-LIO specific numbers require IEEE Xplore access.

---

## Strengths, Weaknesses, and Failure Modes by Approach Axis

### Geometric-Only (DO-Removal, DOF-LIO, BTSA, Dynamic-LIO)

| Criterion | Assessment |
|---|---|
| Label cost | Zero — no annotated data required |
| Domain generality | Maximum — unknown objects trigger on any detectable range/normal inconsistency |
| Slow-mover sensitivity | Variable: BTSA (4D temporal ~2 s window, best); DOF-LIO / Dynamic-LIO (single-frame, lower) |
| Compute | Dynamic-LIO 1–9 ms; DOF-LIO est. 5–15 ms; DO-Removal est. <50 ms; BTSA ~50 ms |
| False-positive risk | Incidence-angle (range-image methods); sparse-sensor normal instability (BTSA on VLP-16) |
| Circular dependency | BTSA resolves; DOF-LIO partially (ikd-Tree comparison uses prior map); others do not |
| Static-but-transient | Cannot detect — fundamental limitation |

### Semantic-Aware (SuMa++, SD-SLAM)

| Criterion | Assessment |
|---|---|
| Label cost | High — SemanticKITTI training; airside fine-tuning 500–2000 frames |
| First-frame detection | Pre-emptive — flags dynamic-class objects before motion observed |
| Domain generality | Bound to training vocabulary; OOD objects invisible |
| Output map | Rich semantic labels usable downstream for class-conditioned queries |
| Compute | RangeNet++ DarkNet-53 >100 ms without quantisation on Orin; SalsaNext ~84–109 ms |
| False-negative risk | Unknown GSE types, FOD, novel equipment categories entirely missed |
| Three-tier vs binary | SD-SLAM semi-static handling reduces over-removal vs SuMa++ binary include/exclude |

### Object-Level (TRLO, ClusterSLAM, ClusterVO)

| Criterion | Assessment |
|---|---|
| Temporal consistency | Best — per-instance tracks across frames reduce dynamic-mask flicker |
| Unknown class handling | Zero for detector-based (TRLO); reasonable for instance-clustering-based (ClusterVO) |
| Compute | GPU inference for PointPillars or Mask R-CNN adds ~5–15 ms on GPU |
| Failure mode | Missed detections for novel object classes; merged instances during occlusion |
| Airside retraining cost | High — custom GSE/aircraft detector training required |

### Motion-Prior / Scene-Flow

| Criterion | Assessment |
|---|---|
| Class dependency | None if using purely geometric flow estimation |
| Compute | Scene-flow networks expensive; optical flow camera-only |
| Maturity | Research-stage for LiDAR in production SLAM; DS-SLAM's consistency check is a lightweight 2D approximation |
| LiDAR 3D flow | Active research area; not yet production-proven |

### Label-Free Learned (MOVES, MODEST)

| Criterion | Assessment |
|---|---|
| Label cost | Minimal — pseudo-labels from geometric consistency |
| Accuracy | Still below supervised methods at equivalent compute |
| Production readiness | Research-stage; not yet validated for safety-critical localisation |
| Fine-tuning path | Self-supervised on target-domain data; domain adaptation without annotation cost |

---

## Domain Fit

| Domain | Primary Challenge | Recommended Axis | Stage 3 Mandatory |
|---|---|---|---|
| Urban road AV | Dense moving vehicles, cyclists | Geometric-only or semantic-aware | No (road changes slow) |
| Airside apron | Large stationary GSE, aircraft; OOD object vocabulary | Geometric-only Stage 1 + semantic Stage 1 (conditional) | YES — parked GSE/aircraft |
| Warehouse / logistics yard | Forklifts, pallets, people; controlled vocabulary | Semantic-aware or object-level | Conditional (pallet staging) |
| Port terminal | Cranes, heavy vehicles, ISO containers | Geometric-only (large geometric signal) | Conditional |
| Mining / construction | Large earthmovers, debris piles; no semantic labels | Geometric-only | Conditional |
| Indoor robot | People, movable furniture | RGB-D semantic (mature) | No (small environments) |
| Delivery robot | Pedestrians, cyclists on footpath | Semantic-aware (standard vocabulary) | No |

---

## Recommended Stack for Airside Survey-Drive Front-End

**Use case:** aggregated LiDAR map building on an active airport apron. Survey vehicle makes one or more passes during reduced or active operations. GSE, aircraft, and ground crew are present. Primary sensor: 64-beam spinning LiDAR (Ouster OS1-64 or Velodyne HDL-64E). Compute: Jetson Orin AGX.

### Stage 1 — Online LIO (per frame, on-vehicle)

**Primary recommendation: DOF-LIO** ([iter-29](./dof-lio-lightweight-dynamic-object-filter.md), DOI:10.1109/TIM.2026.3666055)
- Visibility + voxel-hash suppression + static-boundary recovery
- Estimated overhead < 20 ms — comfortable margin at 20 Hz on Orin
- No GPU inference; no training data; class-agnostic; fine-grained ikd-Tree comparison

**Alternative if open-source is required: Dynamic-LIO** (IROS 2025, https://github.com/ZikangYuan/dynamic_lio)
- 1–9 ms overhead; confirmed benchmarks; 90.4% preservation / 90.7% rejection on KITTI dynamic sequences

**Alternative if slow-mover sensitivity is critical: BTSA** ([iter-27](./dynamic-aware-lio-btsa.md), https://github.com/thisparticle/btsa)
- ~50 ms; 10 Hz only; requires 64-beam minimum; handles pedestrians and slow GSE better than single-frame methods
- HA 82.50% on Aeva FMCW — best online method in its class

**Conditional addition — semantic layer:** SD-SLAM or SuMa++ for known-class GSE coverage
- Requires airside-specific fine-tuning (~500–2000 annotated frames) before providing useful coverage
- Adds semantic labels to map as a by-product; enables class-conditioned downstream queries
- Use async segmentation thread (RDS-SLAM pattern) to avoid throttling odometry on Orin
- Run in parallel as a filter, not as the sole pose estimator

### Stage 2 — Offline Cleaning (post-survey, workstation/cloud)

ERASOR++ or FreeDOM on the accumulated map. Both achieve F1 0.93–0.99 on SemanticKITTI. FreeDOM is preferred for non-flat surfaces and inclined apron sections. Always run Stage 2 even when Stage 1 is active — online methods cannot achieve offline map-quality F1.

Cross-links: [ERASOR++](./erasor-plus-plus.md) (iter-22), [FreeDOM](./freedom-dynamic-object-removal.md) (iter-20), [MapCleaner](./mapcleaner.md) (iter-24), [DR-Remover](./dr-remover.md) (iter-25).

### Stage 3 — Lifelong Static-but-Transient Removal (multi-session, mandatory for airside)

LT-Mapper or Khronos for multi-pass temporal differencing. The apron is dominated by stationary transients — parked aircraft, staged GSE, extended boarding stairs — that no Stage-1 or Stage-2 method can detect. Multi-session evidence is the only signal that distinguishes a permanent taxilane fixture from GSE that happened to be parked during the survey. This stage is not optional.

Cross-links: [LT-Mapper / Khronos Lifelong Mapping](./lt-mapper-khronos-lifelong-mapping.md) (iter-21), [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md) (iter-19).

### Stage 4 — Semantic Map Segmentation

Segmentation of the cleaned static map (SalsaNext or FRNet on Orin) produces per-class layers. Contamination reduced across Stages 1–3 feeds higher segmentation quality and reduces per-class confusion from ghost-trail interference.

Cross-links: [SD-SLAM Semantic-Dynamic LiDAR](./sd-slam-semantic-dynamic-lidar.md) (iter-23), [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md).

---

## Implementation Notes

**Compute budget on Jetson Orin AGX (100 ms per scan at 10 Hz; 50 ms at 20 Hz).**

- Dynamic-LIO (1–9 ms) fits comfortably at 20 Hz with margin.
- DOF-LIO (estimated < 20 ms) fits at 20 Hz.
- BTSA (~50 ms) is marginal at 20 Hz; safe at 10 Hz.
- Semantic segmentation (>84 ms on Orin without quantisation) requires async threading or INT8 quantisation to avoid throttling the pose loop.

**Sensor density constraint.** BTSA's 4D normal estimation degrades on sensors below 32 beams (VLP-16: HA 57.79% vs Aeva FMCW HA 82.50%). For embedded deployments with sparse LiDARs, DOF-LIO or Dynamic-LIO are the correct geometric alternatives.

**Open-source availability summary.**

| Method | Open source | License | Notes |
|---|---|---|---|
| Dynamic-LIO | Yes | — | https://github.com/ZikangYuan/dynamic_lio |
| BTSA | Yes | GPL-2.0 | https://github.com/thisparticle/btsa |
| SuMa++ | Yes | — | https://github.com/PRBonn/semantic_suma |
| DynaSLAM | Yes | — | https://github.com/BertaBescos/DynaSLAM |
| DS-SLAM | Yes | — | https://github.com/ivipsourcecode/DS-SLAM |
| TRLO | Yes | — | https://github.com/Yaepiii/TRLO |
| DO-Removal | Not confirmed | — | No confirmed repository as of 2026-05-24 |
| DOF-LIO | Not confirmed | — | No confirmed repository as of 2026-05-24 |
| RF-LIO | No | — | Research reference only |

**Integration pattern.** Deploy Dynamic-LIO as the open-source Stage-1 prototype; substitute DOF-LIO once the paywall paper is licensed; add BTSA as a parallel slow-mover path if 10 Hz is acceptable; schedule offline Stage-2 cleaning in the cloud pipeline after each survey; implement Stage-3 multi-session differencing after the second survey pass.

**Failure mode to monitor.** Log the dynamic-fraction metric (percentage of scan points flagged dynamic) per scan. Values consistently above 30% on an active apron indicate heavy contamination; values consistently at zero on an active apron indicate the filter threshold may be too conservative or the method is not functioning.

---

## Sources

| Reference | URL |
|---|---|
| DynaSLAM (Bescos et al., RA-L + IROS 2018) | https://arxiv.org/abs/1806.05620 |
| DynaSLAM GitHub | https://github.com/BertaBescos/DynaSLAM |
| DS-SLAM (Yu et al., IROS 2018) | https://arxiv.org/abs/1809.08379 |
| DS-SLAM GitHub | https://github.com/ivipsourcecode/DS-SLAM |
| RDS-SLAM (Liu and Miura, IEEE Access 2021) | https://ieeexplore.ieee.org/document/9318990/ |
| RDS-SLAM GitHub | https://github.com/yubaoliu/RDS-SLAM |
| ClusterSLAM (Huang et al., ICCV 2019) | https://openaccess.thecvf.com/content_ICCV_2019/papers/Huang_ClusterSLAM_A_SLAM_Backend_for_Simultaneous_Rigid_Body_Clustering_and_ICCV_2019_paper.pdf |
| ClusterVO (Huang et al., CVPR 2020) | https://openaccess.thecvf.com/content_CVPR_2020/papers/Huang_ClusterVO_Clustering_Moving_Instances_and_Estimating_Visual_Odometry_for_Self_CVPR_2020_paper.pdf |
| SuMa++ (Chen et al., IROS 2019 / arXiv 2021) | https://arxiv.org/abs/2105.11320 |
| SuMa++ GitHub | https://github.com/PRBonn/semantic_suma |
| RF-LIO (Qian et al., arXiv 2022) | https://arxiv.org/abs/2206.09463 |
| ID-LIO (Sensors 2023, open access) | https://pmc.ncbi.nlm.nih.gov/articles/PMC10255994/ |
| SD-SLAM (arXiv 2402.18318, IoT 2024) | https://arxiv.org/abs/2402.18318 |
| SD-SLAM ScienceDirect | https://www.sciencedirect.com/science/article/abs/pii/S221457962400039X |
| DO-Removal (IEEE RA-L 2025/26) | https://ieeexplore.ieee.org/document/10807109/ |
| BTSA (arXiv 2510.22313, RA-L 2025) | https://arxiv.org/abs/2510.22313 |
| BTSA GitHub | https://github.com/thisparticle/btsa |
| DOF-LIO (IEEE T-IM 2026) | https://doi.org/10.1109/TIM.2026.3666055 |
| Dynamic-LIO (IROS 2025, arXiv 2407.03590) | https://arxiv.org/abs/2407.03590 |
| Dynamic-LIO GitHub | https://github.com/ZikangYuan/dynamic_lio |
| STATIC-LIO (Information Fusion 2025) | https://www.sciencedirect.com/science/article/abs/pii/S1566253525002052 |
| R-POD Two-Stage (Displays 2025) | https://doi.org/10.1016/j.displa.2025.103030 |
| TRLO (arXiv 2410.13240, T-IM 2025) | https://arxiv.org/abs/2410.13240 |
| TRLO GitHub | https://github.com/Yaepiii/TRLO |
| ERASOR (RA-L 2021) | https://arxiv.org/abs/2103.04316 |
| KTH DynamicMap Benchmark (ITSC 2023) | https://arxiv.org/abs/2307.07260 |
| KTH Benchmark GitHub | https://github.com/KTH-RPL/DynamicMap_Benchmark |
| HeLiMOS Dataset (IROS 2024) | https://arxiv.org/html/2408.06328v1 |
| HeLiMOS GitHub | https://github.com/url-kaist/HeLiMOS-PointCloud-Toolbox |
| SemanticKITTI tasks | https://semantic-kitti.org/tasks.html |
| SegNet4D (arXiv 2406.16279 / T-ASE 2025) | https://arxiv.org/abs/2406.16279 |
| Awesome Dynamic SLAM (community list) | https://github.com/zhuhu00/Awesome_Dynamic_SLAM |
| 3D LiDAR dynamic object filtering review (Sensors 2024) | https://www.mdpi.com/1424-8220/24/2/645 |
