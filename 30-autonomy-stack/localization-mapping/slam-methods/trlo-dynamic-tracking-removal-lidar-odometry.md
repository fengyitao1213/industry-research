# TRLO Dynamic Tracking Removal LiDAR Odometry

<!-- method-priority:start
priority:
  learning: 4
  deployment: 5
  type: "method"
  stage: "deployment-pattern"
  maturity: "pilot-proven"
  tags: ["slam", "mapping", "validation", "runtime-localization", "outdoor"]
  reason: "TRLO Dynamic Tracking Removal LiDAR Odometry is rated for dynamic-object filtering and map-cleaning workflows that protect localization maps."
method-priority:end -->

Related docs: [DOF-LIO Lightweight Dynamic Object Filter](./dof-lio-lightweight-dynamic-object-filter.md), [Dynamic-Aware LIO BTSA](./dynamic-aware-lio-btsa.md), [DO-Removal LIO](./do-removal-lio.md), [RPOD Two-Stage Online Dynamic Removal LIO](./rpod-two-stage-online-dynamic-removal-lio.md), [SD-SLAM Semantic-Dynamic LiDAR](./sd-slam-semantic-dynamic-lidar.md), [ERASOR](./erasor.md), [Removert](./removert.md), [MapCleaner](./mapcleaner.md), [FreeDOM Dynamic Object Removal](./freedom-dynamic-object-removal.md), [Dynamic Map Cleaning Benchmarks](./dynamic-map-cleaning-benchmarks.md), [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md), [GenZ-ICP / GenZ-LIO](./genz-icp-genz-lio.md), [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md), [Multi-Sensor Calibration and Observability](../../../10-knowledge-base/geometry-3d/multi-sensor-calibration-observability.md).

**Last updated:** 2026-05-24

---

## What It Is

**Full title:** TRLO: An Efficient LiDAR Odometry with 3D Dynamic Object Tracking and Removal

**Short name:** TRLO

**Authors:** Yanpeng Jia (first author, lead implementer), Ting Wang (corresponding author), Xieyuanli Chen, Shiliang Shao

**Affiliations:**
- Yanpeng Jia, Ting Wang, Shiliang Shao: Shenyang Institute of Automation, Chinese Academy of Sciences (SIA, CAS) / University of Chinese Academy of Sciences (UCAS)
- Xieyuanli Chen: National University of Defense Technology (NUDT), Changsha — associate professor with a well-established record in LiDAR SLAM and range-image-based place recognition

**Venue:** IEEE Transactions on Instrumentation and Measurement (T-IM)

**Accepted:** April 2025

**IEEE DOI:** https://doi.org/10.1109/TIM.2025.3561381

**IEEE Xplore:** https://ieeexplore.ieee.org/document/10981980/

**arXiv ID:** 2410.13240 (submitted October 17, 2024)

**arXiv URL:** https://arxiv.org/abs/2410.13240

**GitHub:** https://github.com/Yaepiii/TRLO

**Project page:** https://yaepiii.github.io/TRLO/

TRLO is a LiDAR odometry front end that integrates 3D dynamic-object detection, tracking, and removal into the scan-matching loop. The central premise is that static-world LiDAR odometry systems (A-LOAM, LeGO-LOAM, DLO, LIO-SAM, FAST-LIO2) fail in dynamic urban scenes because moving objects corrupt both the pose estimate and the accumulated map. TRLO addresses this by detecting object bounding boxes with a deep-learning detector (PointPillars + CenterHead via TensorRT), tracking them through time with a UKF tracker, classifying tracks as dynamic or semi-static by velocity, masking dynamic-labeled points out of each scan before registration, and then running a two-stage Fast G-ICP solver on the cleaned static scan.

TRLO is an **online** dynamic-removal method — it filters each scan at survey time, so ghost trails never enter the keyframe database. This distinguishes it structurally from offline post-pass cleaners such as [Removert](./removert.md), [ERASOR](./erasor.md), [MapCleaner](./mapcleaner.md), and [FreeDOM](./freedom-dynamic-object-removal.md), which clean an accumulated map after a full traversal. Within the online family, TRLO occupies the detect-track-remove sub-paradigm, in contrast to geometry-only or visibility-based methods such as [DOF-LIO](./dof-lio-lightweight-dynamic-object-filter.md) and [BTSA](./dynamic-aware-lio-btsa.md).

TRLO appeared in the same T-IM cycle as DOF-LIO (DOI 10.1109/TIM.2026.3666055), both representing the current state of the art in online dynamic-aware LIO published in that journal.

---

## Core Technical Idea

Most LiDAR odometry systems assume a static world. Their ICP objective sums over all scan points:

```
E = sum_i || n_i^T (T * p_i - q_i) ||^2
```

Moving objects contaminate this objective, pulling the pose estimate toward a false consensus. Dynamic-object ghost trails also accumulate in the submap, degrading future scan registration.

TRLO's architectural answer is a **detect-track-remove-register** pipeline:

1. A GPU-accelerated PointPillars + CenterHead detector identifies 3D bounding boxes around dynamic-class objects in each scan.
2. A UKF tracker with nearest-neighbour (NN) data association maintains object identity across frames, building velocity estimates.
3. Tracks whose estimated speed is at or above 1 m/s are classified dynamic; those below the threshold are semi-static.
4. Dynamic tracks' bounding-box volumes are used to mask all LiDAR returns within those boxes out of the scan.
5. The cleaned static scan is registered against the previous scan (Stage 1) and against a local submap (Stage 2) using Fast G-ICP.
6. Detected bounding boxes are reused as a posture consistency constraint: box centres are projected to the ground plane to anchor roll, pitch, and (on flat terrain) z-translation.

Three features distinguish TRLO from its peer family:

- **Class-specific precision:** The PointPillars detector operates on pre-defined classes (vehicle, cyclist); only detected-class points are removed. This avoids the over-removal of vegetation or static walls that can degrade ICP observability in visibility-based methods.
- **Temporal coherence via UKF:** Brief detection gaps (occlusion, detector miss) do not immediately corrupt the static scan; the tracker maintains the track and its velocity estimate between frames.
- **Bounding-box posture constraint:** A geometric novelty — ground-plane roll/pitch/z regularization derived from detected box centres — that suppresses z-drift on flat terrain.

TRLO is explicitly faster than its tracking-coupled predecessors: approximately 2x faster than LIMOT (~88 ms/scan) and 5x faster than LIO-SEGMOT (~135 ms/scan), achieved through TensorRT-compiled inference and the Fast G-ICP solver.

---

## Operator Mechanics — Per-Scan Pipeline

### Preprocessing

- Incoming raw LiDAR scan is received (optional IMU stream accepted alongside).
- Voxel downsampling: 0.25 m voxel filter on the full scan provides the detection input.
- Box-filter outlier removal at 0.5 m.
- Motion-distortion correction (deskewing): IMU pre-integration if IMU is enabled; constant-velocity assumption otherwise.

### 3D Object Detection — PointPillars + CenterHead via TensorRT

- Input: voxelized point cloud from the preprocessing stage.
- Model: PointPillars backbone (pillar-based pseudo-image encoding) plus a Center-based detection head (CenterPoint style).
- Classes: vehicles and cyclists — the dominant dynamic classes in KITTI and UrbanLoco. Pedestrian detection is possible but harder for pillar-based detectors at range.
- Confidence threshold: 0.75.
- Output: a set of 3D oriented bounding boxes with class label and confidence score.
- Inference engine: TensorRT 8.5.3.1 compiled against CUDA 11.3 and cuDNN 8.2.1. A GPU is required.
- Ground segmentation is implicit: PointPillars encodes pillar height statistics, so above-ground points form the pillar features without a separate ground-fitting step.

The detector is pretrained on KITTI-class or nuScenes-class data and used off-the-shelf; no retraining occurs inside TRLO's loop.

### 3D Multi-Object Tracking — UKF + Nearest Neighbour

State vector per track: `[x, y, z, theta, v, l, w, h]` — 3D position, yaw angle, speed, box dimensions.

Motion model: constant-velocity (CV). Per scan: (1) UKF sigma-point prediction; (2) nearest-neighbour association — unmatched detections spawn new tracks, unmatched tracks accumulate a miss counter; (3) UKF measurement update with centroid and box pose; (4) dynamic classification: speed >= 1 m/s -> dynamic, else semi-static (retained for ICP). The 1 m/s threshold is the key tuning parameter.

### Dynamic Point Removal and Hash-Based Keyframe Database

All scan points within confirmed dynamic track bounding boxes (with a small inflation for margin) are removed. Semi-static tracks are not removed; their points contribute to ICP. Keyframes are stored in a hash table (O(1) lookup) and selected per submap using K-NN + convex-hull + concave-hull neighbours, adapting to environmental feature density.

### Two-Stage Fast G-ICP Registration

**Stage 1 — Scan-to-Scan:** the cleaned current scan is registered to the previous cleaned scan to produce an initial relative transform estimate.

**Stage 2 — Scan-to-Map:** the cleaned current scan is registered against the local submap assembled from the keyframe database, using the Stage 1 estimate as initialisation.

Both stages use Fast G-ICP (generalised ICP with covariance-weighted point-to-plane residuals minimising `sum_i (T p_i - q_i)^T (Sigma_p + Sigma_q)^(-1) (T p_i - q_i)`). Registering on cleaned scans at both stages prevents a single dynamic-contaminated estimate from propagating into the submap. See [Point Cloud Registration Math](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md).

### Posture Consistency Constraint — Bounding-Box Ground Anchor

This is TRLO's most architecturally distinctive component:

- **Assumption:** all detected dynamic objects rest on a planar ground.
- **Projection:** detected bounding-box centres are projected to the ground (z = 0 in the body frame).
- **Ground-plane fit:** the ground-plane normal `n` is fitted from the projected centres.
- **Roll/pitch constraint:** `n` constrains roll and pitch as a soft residual term in the final pose optimisation.
- **Z-translation constraint:** if the mean z-change of box centres between consecutive frames is less than 0.1 m, z-translation is also anchored to near-zero within a sliding window (flat-terrain assumption).

The constraint is applied as an additional residual in pose optimisation, not as a hard geometric lock. Its impact is quantified in the paper's ablation: translation accuracy on KITTI 07 improves by 39.3% and on UrbanLoco 05 by 30.4% when the constraint is active, compared with TRLO without the constraint. The ground-plane assumption makes this constraint particularly well-suited to flat apron and taxiway airside topologies.

---

## Inputs and Outputs

| Item | Type | Notes |
|---|---|---|
| LiDAR scan | Required input | 3D point cloud; tested on Velodyne HDL-64-class sensors on KITTI and UrbanLoco |
| IMU stream | Optional input | Requires 3 s gravity alignment at startup if enabled; improves deskewing |
| PointPillars + CenterHead weights | Required model | Pretrained on KITTI-class objects; domain-specific retraining needed for non-road actors |
| TensorRT engine | Runtime dependency | GPU + CUDA / cuDNN / TensorRT stack required; must be rebuilt if GPU or CUDA version changes |
| Per-scan cleaned point cloud | Internal | All scan points outside confirmed dynamic bounding boxes |
| Object tracks | Internal | UKF state vectors with velocity, pose, class per track |
| Pose estimate | Primary output | 6-DOF ego-vehicle pose per scan |
| Trajectory | Primary output | Sequence of poses saved for evaluation |
| Clean static map | Primary output | Accumulated keyframes free of dynamic ghost trails |

---

## Architecture — Block Diagram

```
Raw LiDAR scan (+optional IMU)
         |
         v
  [Preprocessing]
  voxel filter (0.25 m) + box-filter outlier removal (0.5 m)
  deskew (IMU-assisted or constant-velocity)
         |
         v
  [3D Object Detector]
  PointPillars backbone + CenterHead
  via TensorRT (GPU, 0.75 conf threshold)
  classes: vehicle, cyclist
  output: 3D oriented bounding boxes
         |
         |-------------------------+
         v                        |
  [UKF Multi-Object Tracker]      |
  state: [x,y,z,theta,v,l,w,h]   |
  motion model: constant velocity |
  association: nearest neighbour  |
  output: track set + velocities  |
         |                        |
         v                        |
  [Dynamic Classifier]            |
  speed >= 1 m/s -> dynamic       |
  speed < 1 m/s  -> semi-static   |
         |                        |
         v                        v
  [Dynamic Point Mask]  [Bounding-Box Posture Constraint]
  remove points inside   ground-plane fitting from box
  dynamic track boxes    centres -> roll/pitch/z anchor
         |                        |
         v                        |
  [Cleaned Static Scan]           |
         |                        |
         v                        |
  [Hash-Based Keyframe DB]        |
  keyframe selection:             |
  K-NN + convex + concave hull    |
         |                        |
         v                        |
  [Two-Stage Fast G-ICP]          |
  Stage 1: scan-to-scan           |
  Stage 2: scan-to-map            |
         |                        |
         v                        v
  [Pose Optimization]
  G-ICP residual + posture consistency constraint
         |
         v
  Ego-vehicle pose + clean map output
```

---

## Training and Model Requirements

TRLO is not fully rule-based — it has a learned component in the detection stage and classical components everywhere else.

| Component | Nature | Notes |
|---|---|---|
| PointPillars + CenterHead detector | Learned — pretrained | Pretrained on KITTI/nuScenes-class data; used off-the-shelf in paper experiments |
| UKF tracker | Classical | No training; constant-velocity model |
| NN data association | Classical | Euclidean centroid distance |
| Fast G-ICP solver | Classical | Iterative covariance-weighted optimisation |
| Keyframe selection | Heuristic | K-NN + convex/concave hull |
| Posture consistency constraint | Geometric heuristic | Ground-plane fit from box centres |

**No end-to-end training loop.** TRLO is a classical-plus-pretrained-detector system, not a neural SLAM architecture.

**TensorRT compilation:** the PointPillars model is compiled into a TensorRT engine for real-time inference. Users must rebuild the TensorRT engine if the GPU model, CUDA version, or cuDNN version changes. Engine files are not portable across hardware configurations.

**Domain transfer:** for non-road domains (airside, warehouse, ports, mining), the PointPillars detector must be retrained on domain-appropriate annotated data. The UKF tracker, G-ICP solver, and posture constraint all transfer without modification.

---

## Benchmarks

**Datasets evaluated:**
- KITTI odometry benchmark: sequences 00 (low dynamics), 05 (low dynamics), 07 (medium dynamics)
- UrbanLoco benchmark: sequences 01 (high dynamics), 03 (medium dynamics), 05 (high dynamics)

TRLO is not evaluated on the KITTI Tracking benchmark, Oxford RobotCar, nuScenes, or KTH DynamicMap Benchmark. All numbers below are from the arXiv HTML version (arxiv.org/html/2410.13240v1).

### Odometry Accuracy — RMSE (Table I)

| Sequence | Dynamics | Metric | TRLO | DLO | LIO-SEGMOT | LIMOT |
|---|---|---|---|---|---|---|
| KITTI 00 | Low | RPE (m) | **1.15** | 1.19 | 1.32 | 1.24 |
| KITTI 00 | Low | APE (m) | **3.29** | 6.67 | 6.67 | 6.46 |
| KITTI 07 | Medium | RPE (m) | **1.10** | 1.11 | 1.32 | 1.24 |
| UrbanLoco 05 | High | RPE (m) | **3.42** | 3.81 | 3.47 | 3.49 |
| UrbanLoco 05 | High | APE (m) | **1.23** | 1.72 | 1.59 | 1.34 |

The UrbanLoco 01 sequence numbers are reported in the paper but are not individually confirmed in the open-access HTML excerpt reviewed here; readers should verify from the IEEE Xplore full text.

### Mapping Quality — Precision, Recall, F1 (Table II)

Metric: Precision Rate (PR), Recall Rate (RR), F1-Score computed using voxel-based static/dynamic point evaluation against ground truth.

| Sequence | Metric | TRLO | LIO-SEGMOT | LIMOT | RF-A-LOAM |
|---|---|---|---|---|---|
| KITTI 00 | PR (%) | **96.46** | 93.28 | 92.35 | 83.91 |
| KITTI 00 | RR (%) | 94.72 | 92.51 | **93.98** | 94.42 |
| KITTI 00 | F1 | **0.956** | 0.929 | 0.932 | 0.888 |
| KITTI 07 | F1 | 0.908 | **0.910** | 0.907 | 0.869 |

**Notes on these results:**
- TRLO's recall rate (94.72%) is slightly below LIMOT's (93.98% — very close) on KITTI 00, meaning TRLO occasionally fails to remove all dynamic ghost points. The PR/F1 advantage reflects fewer false removals of static structure.
- On KITTI 07, TRLO and LIO-SEGMOT are essentially tied (0.908 vs 0.910 F1). TRLO's advantage on this sequence appears primarily on APE/RPE odometry accuracy rather than map-cleaning quality.

### Runtime — Per-Scan Breakdown (Table V)

| Component | Time (ms) |
|---|---|
| Preprocessing | 3.42 |
| UKF Tracker | 6.34 |
| Fast G-ICP Odometry | 14.72 |
| **Total per scan** | **24.28** |
| Equivalent ceiling Hz | **~41 Hz (reported >20 Hz)** |

LIMOT runs at approximately 88.68 ms/scan (~11 Hz); LIO-SEGMOT runs at approximately 135.70 ms/scan (~7 Hz). TRLO is roughly 2x faster than LIMOT and 5x faster than LIO-SEGMOT. The speed advantage comes from TensorRT-compiled detection inference and the Fast G-ICP solver versus the heavier optimisation formulations in those predecessors.

**Hardware caveat:** runtime was measured on an unspecified GPU + CPU configuration. GPU type is not stated in the open-access version. TensorRT implies an NVIDIA GPU, likely an RTX-class workstation GPU. Jetson Orin performance has not been confirmed in the paper.

### Ablation and Ground Segmentation (Tables III, IV)

Ablation (Table III, approximate): removing the posture constraint degrades KITTI 07 RPE by ~39.3% and UrbanLoco 05 APE by ~30.4%; removing dynamic removal degrades UrbanLoco 05 APE from 1.23 m to 1.45 m. These figures are back-calculated from percentage claims in the paper text — confirm from the IEEE Xplore PDF.

Ground segmentation comparison (Table IV): TRLO's flat-ground projection costs 0.37 ms/scan (KITTI 07 RPE = 1.10 m); RANSAC costs 24.50 ms/scan (RPE = 0.99 m) — marginally better accuracy at 66x higher latency. A deliberate trade-off for real-time operation.

---

## Comparison Table — TRLO vs Peer Methods

| Method | Venue / Year | Detection mechanism | Tracker | DL dependency | Removal point | Odometry backend | Runtime |
|---|---|---|---|---|---|---|---|
| TRLO | T-IM 2025 | PointPillars + CenterHead (learned) | UKF + NN | Yes — PointPillars + TRT, GPU required | Before registration | Fast G-ICP 2-stage | ~24 ms (~41 Hz ceiling) |
| DOF-LIO | T-IM 2025–26 | Visibility-based voxel clustering (rule-based) | None | No | Before registration | FAST-LIO2 IEKF | Not stated; claimed lightweight |
| DO-Removal-LIO | RA-L 2025 | Ground fitting + seed region-growing + cluster confidence | None | No | Before registration | LIO-SAM-style | Not stated; real-time claimed |
| BTSA | RA-L 2025 | 4D spatio-temporal normals (rule-based, pose-free) | None | No | Before IEKF | IEKF + dual-map | ~49.69 ms (~20 Hz ceiling) |
| RPOD-LIO | Displays 2025 | Region-wise pseudo-occupancy descriptor + scan ratio test | None | No | Before scan-to-map stage | 2-stage scan-to-map | Not stated |
| LIO-SEGMOT | ICRA 2023 | Asynchronous object tracking (tightly coupled with segmentation) | Kalman-based | Partial (segmentation) | Before scan-matching | LIO-SAM-style | ~135 ms (~7 Hz) |
| LIMOT | RA-L 2024 | Trajectory-based dynamic feature filtering from tracking | Multi-object tracker | Partial | Before scan-matching | LIO tight-coupling | ~88 ms (~11 Hz) |

**Paradigm summary:**

| Paradigm | Methods | Key trade-off |
|---|---|---|
| Detect-track-remove (box-based) | TRLO, LIO-SEGMOT, LIMOT | High precision on detected classes; class-coverage hard limit; GPU required |
| Visibility / occupancy-based (rule-based) | DOF-LIO, RPOD-LIO, ERASOR (offline) | No GPU; no class coverage limit; struggles with slow movers |
| Spatio-temporal normal (pose-free) | BTSA | Resolves circular dependency; no GPU; heavier compute; best slow-mover sensitivity |
| Semantic segmentation-based | SuMa++, SD-SLAM | Dense per-point labels; high GPU cost; strong if domain matches |

---

## Lineage

TRLO extends the tracking-coupled LIO lineage: LOAM/A-LOAM established the scan-to-scan + scan-to-map ICP paradigm; PointPillars (2019) and CenterPoint (2020–21) provided the detection backbone; LIO-SEGMOT (ICRA 2023) first tightly coupled object tracking with LIO; LIMOT (RA-L 2024) tightened the coupling further. TRLO adds a PointPillars + CenterHead detector, UKF tracker, two-stage Fast G-ICP, and the bounding-box posture constraint — improving on LIO-SEGMOT's speed (5x) and LIMOT's speed (2x). Concurrent parallel threads: DOF-LIO (T-IM 2025–26, rule-based visibility), BTSA (RA-L 2025, 4D normal pose-free), RPOD-LIO (Displays 2025, pseudo-occupancy).

---

## Strengths

**Class-aware dynamic removal.** PointPillars distinguishes vehicles and cyclists from vegetation, poles, and static walls — avoiding the over-removal of ICP features that can degrade visibility-based methods (DOF-LIO, RPOD-LIO).

**UKF tracking robustness to short occlusions.** The constant-velocity UKF maintains track state between frames. Brief detection gaps do not release dynamic-object points back into the static scan, providing temporal coherence that single-frame removal methods cannot achieve.

**Bounding-box posture constraint.** The ground-plane roll/pitch/z anchor suppresses z-drift at 0.37 ms/scan vs 24.50 ms for RANSAC ground fitting. Particularly relevant for flat apron and taxiway airside topology.

**Real-time above 20 Hz.** At 24.28 ms/scan total, TRLO fits within the 50 ms (20 Hz) budget. LIO-SEGMOT (7 Hz) and LIMOT (11 Hz) are substantially slower — TRLO is the fastest published tracking-coupled LIO.

**Public code.** GitHub (Yaepiii/TRLO) provides ROS Noetic / C++ code with documented build instructions, unlike DOF-LIO (paywall-only).

---

## Failure Modes

### Detector Class Coverage Is a Hard Ceiling

TRLO detects vehicles and cyclists only. Any dynamic object outside these classes — pedestrians, forklifts, AGVs, pushback tractors, baggage tugs, deicing trucks, belt loaders, jet bridges, catering trucks — passes through undetected and enters the static map as a ghost trail. This is a complete miss, not a soft degradation. The system requires retraining PointPillars on annotated data for novel classes, or addition of a second-stage class-agnostic filter ([DOF-LIO](./dof-lio-lightweight-dynamic-object-filter.md), [BTSA](./dynamic-aware-lio-btsa.md)).

**Severity:** High for non-road domains. Medium for road use (pedestrians partially uncovered).

### Slow-Moving Dynamics Treated as Semi-Static

Objects moving below 1 m/s are classified semi-static and retained in the cleaned scan. If they remain in place for multiple scans they accumulate as static structure in the keyframe database. Deliberate design to preserve ICP features, but a failure mode for consumers requiring fully clean static maps.

**Severity:** Medium on roads. High in airside and warehouse environments with parked or slow-moving GSE.

### False-Positive Removals and ICP Observability

A false-positive detection removes real static structure from the scan. If enough features are stripped, Fast G-ICP may degenerate (insufficient correspondences) or drift. The 0.75 confidence threshold guards against this but is imperfect. Feature-sparse environments (corridors, tunnels, open aprons) are most vulnerable.

**Severity:** Low in feature-rich urban scenes. High in corridors, tunnels, or open aprons.

### GPU and TensorRT Dependency

TRLO requires CUDA + cuDNN + TensorRT and is not CPU-embeddable without a GPU inference path. TensorRT engine files are not portable across CUDA or cuDNN versions — any hardware change requires rebuilding the engine. For platforms without GPU inference, [DOF-LIO](./dof-lio-lightweight-dynamic-object-filter.md) or [BTSA](./dynamic-aware-lio-btsa.md) are the geometry-only alternatives.

**Severity:** Medium for research. High for production embedded deployment.

### UKF Tracker Under Occlusion and Crowds

The constant-velocity UKF drifts under non-CV motion (sharp turns, sudden stops) and frequent occlusions cause track ID switches. During the gap between track death and re-instantiation, object points may briefly re-enter the static scan. NN association also degrades in dense scenes where two objects pass within each other's centroid neighbourhood.

**Severity:** Medium on roads. High in crowded pedestrian zones or dense GSE staging areas.

### Loop Closure Not Integrated

TRLO disables loop closure in experiments for fair comparison. Without it, trajectory drift accumulates over long routes. An external loop-closure or pose-graph backend is required for large-area aggregated-map building.

**Severity:** High for large-area mapping. Not a limitation for short-route odometry.

### Ground Flatness Assumption

The posture constraint assumes flat terrain. On ramps, slopes, or taxiways with crown or grade, the flat-ground projection introduces incorrect roll/pitch anchors that can degrade pose accuracy.

**Severity:** Low on flat roads and aprons. Medium–High on sloped or multi-level environments.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV — urban high-traffic | Strong research fit | KITTI and UrbanLoco match the intended setting; vehicles and cyclists are the dominant dynamic classes |
| Road AV — highway | Conditional | Pedestrians are the uncovered class; vegetation false-positives are rare; tracker handles high-speed vehicles well |
| Airside apron — active road-like GSE | Conditional | Class-agnostic retrain required; see Aggregated-Map Suitability below |
| Airside apron — pushback tugs, baggage carts, deicing trucks | Not suitable without retraining | All are out-of-distribution for KITTI-trained detector; ghost trails pass through untouched |
| Indoor warehouse — forklifts and pedestrians | Conditional | Forklifts are structurally similar to small vehicles; partial generalisation possible but must be validated empirically |
| Port / logistics yard | Conditional | Cranes and straddle carriers are out-of-distribution; road vehicles inside yards may partially match |
| Mining / construction | Weak | Heavy machinery and dump trucks are outside KITTI class distribution; rule-based alternative preferred |
| Agriculture | Not suitable | No relevant classes in KITTI/nuScenes; class-agnostic filter is the appropriate tool |
| Offline map cleaning | Not applicable | TRLO is an online front end; it reduces ghost-trail density entering ERASOR / FreeDOM but does not replace offline cleaning |

---

## Aggregated-Map Suitability

### Online vs Offline Pattern

TRLO is an **online** filter: it cleans each scan at survey time so ghost trails never enter the keyframe database, and the pose estimate is computed on clean scans. This is preferable to offline post-pass cleaners ([ERASOR](./erasor.md), [Removert](./removert.md), [FreeDOM](./freedom-dynamic-object-removal.md)) that accumulate ghost trails during the survey and clean them afterward. The tradeoff: the online filter is only as reliable as the detector. If the detector misses a class, an offline cleaning pass remains necessary as a safety net.

### Recommended Layered Stack for Aggregated Maps

| Layer | Role | Tool |
|---|---|---|
| Survey-time online removal | Remove detected dynamic objects per scan | TRLO (if GPU available and class coverage matches) |
| Survey-time fallback | Catch detector misses with geometry-only filter | [DOF-LIO](./dof-lio-lightweight-dynamic-object-filter.md) in parallel, or [BTSA](./dynamic-aware-lio-btsa.md) for slow-mover coverage |
| Post-survey offline cleaning | Remove residual ghosts and slow-movers | [ERASOR](./erasor.md) / [Removert](./removert.md) / [FreeDOM](./freedom-dynamic-object-removal.md) |
| Cross-session consistency | Detect map-level changes over time | [MapCleaner](./mapcleaner.md) / lifelong mapping |

### Airside Suitability

TRLO's PointPillars detector is trained for road vehicles and cyclists. Airside GSE actors — pushback tractors, belt loaders, baggage tugs, deicing trucks, catering vehicles, ground power units, jet bridges — are all **outside the KITTI/nuScenes training distribution**. Deployed without retraining, TRLO would preserve ghost trails for all GSE, defeating its purpose.

The bounding-box posture constraint is, however, well-suited to airside geometry: airport aprons and taxiways are among the flattest natural operating surfaces, where the flat-ground projection holds cleanly.

**Airside recommendation:**
- **Option A — Retrain on airside-relevant classes.** Collect and annotate 500–1,000 labeled 3D frames of GSE actors; fine-tune or retrain PointPillars. Produces a class-aware filter that retains TRLO's precision advantage.
- **Option B — Class-agnostic alternative as primary Stage 1.** Use [DOF-LIO](./dof-lio-lightweight-dynamic-object-filter.md) or [BTSA](./dynamic-aware-lio-btsa.md) as the primary filter; add retrained TRLO as a supplementary tracking layer for covered classes.

In both options, an offline Stage 2 pass ([ERASOR](./erasor.md) / [Removert](./removert.md) / [FreeDOM](./freedom-dynamic-object-removal.md)) and a lifelong Stage 3 pass for static-but-transient objects remain mandatory.

### Warehouse and Logistics-Yard Suitability

Forklifts are structurally similar to small vehicles; partial generalisation is possible but must be validated empirically on target sequences. Testing TRLO against a rule-based baseline ([DOF-LIO](./dof-lio-lightweight-dynamic-object-filter.md)) on representative site data is the minimum due diligence before production commitment.

---

## Implementation Notes

**Software stack:** Ubuntu 20.04 + ROS Noetic, C++14, CMake >= 3.22.3, OpenMP >= 4.5, PCL >= 1.10.0, Eigen >= 3.3.7, Ceres 1.14.0, CUDA 11.3, cuDNN 8.2.1, TensorRT 8.5.3.1.

**Key build steps:** (1) modify `CMakeLists.txt` line 61 with the correct TensorRT path; (2) set `pointcloud_topic` and `imu_topic` ROS parameters; (3) set `trlo/imu: true/false`; (4) allow 3 s static gravity alignment at startup if IMU is enabled.

**TensorRT engine management:** engine files are not portable across GPUs or CUDA versions — rebuild the engine on every distinct hardware configuration and version it alongside the configuration file.

**Parameter sensitivity:**
- `0.75` confidence threshold: lowering increases recall; raising reduces false removals.
- `1 m/s` dynamic velocity threshold: decreasing catches slower movers but risks removing stopped actors useful for ICP.
- `0.1 m` z-change threshold: tune for terrain grade; increase for sloped environments.

**Reproducibility:** log bounding boxes, tracks, removed points, and static points separately. Compare against a no-removal baseline (DLO) and a geometry-only baseline ([DOF-LIO](./dof-lio-lightweight-dynamic-object-filter.md)) on domain sequences. For airside/warehouse adaptation, collect 500–1,000 labeled 3D frames of domain actors; retrain PointPillars; re-benchmark.

**License:** verify terms from the GitHub repository before commercial deployment.

---

## Sources

| Item | Reference |
|---|---|
| TRLO arXiv abstract | https://arxiv.org/abs/2410.13240 |
| TRLO arXiv HTML (full paper) | https://arxiv.org/html/2410.13240v1 |
| TRLO IEEE Xplore | https://ieeexplore.ieee.org/document/10981980/ |
| TRLO IEEE DOI | https://doi.org/10.1109/TIM.2025.3561381 |
| TRLO arXiv DOI | https://doi.org/10.48550/arXiv.2410.13240 |
| TRLO GitHub repository | https://github.com/Yaepiii/TRLO |
| TRLO project page | https://yaepiii.github.io/TRLO/ |
| Semantic Scholar record | https://www.semanticscholar.org/paper/TRLO:-An-Efficient-LiDAR-Odometry-With-3-D-Dynamic-Jia-Wang/ea44508c9bfb4e7b7cee88e1a3f4a84ba51a8507 |
| Xieyuanli Chen profile | https://www.researchgate.net/profile/Xieyuanli-Chen |
| LIO-SEGMOT (ICRA 2023) | https://github.com/StephLin/LIO-SEGMOT |
| LIMOT (RA-L 2024) | https://arxiv.org/abs/2305.00406 |
| RPOD-LIO | https://www.sciencedirect.com/science/article/abs/pii/S0141938225000678 |
| DOF-LIO (T-IM 2026) | https://doi.org/10.1109/TIM.2026.3666055 |
| BTSA (RA-L 2025) | https://arxiv.org/abs/2510.22313 |
| DO-Removal-LIO (RA-L 2025) | https://ieeexplore.ieee.org/document/10807109/ |
| Removert (IROS 2020) | https://ieeexplore.ieee.org/document/9340856/ |
| ERASOR (RA-L 2021) | https://arxiv.org/abs/2103.04316 |
