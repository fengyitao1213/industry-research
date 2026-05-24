# LIR-LIVO

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "modern-core"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "runtime-localization", "outdoor"]
  reason: "LIR-LIVO is rated for LiDAR odometry, mapping, or scan-matching coverage in AV localization stacks."
method-priority:end -->

Related docs: [FAST-LIVO and FAST-LIVO2](fast-livo-fast-livo2.md) · [FAST-LIO and FAST-LIO2](fast-lio-fast-lio2.md) · [R2LIVE and R3LIVE](r2live-r3live.md) · [LVI-SAM](lvi-sam.md) · [VINS-Mono and VINS-Fusion](vins-mono-vins-fusion.md) · [KISS-ICP](kiss-icp.md) · [PIN-SLAM](pin-slam-neural-lidar-mapping.md) · [TRLO Dynamic Tracking and Removal LiDAR Odometry](trlo-dynamic-tracking-removal-lidar-odometry.md) · [BEV-LIO-LC](bev-lio-lc.md) · [Loop Closure and Place Recognition](loop-closure-place-recognition.md) · [Learned LiDAR Place Recognition](learned-lidar-place-recognition.md) · [Robust Multi-Sensor Localization](../overview/robust-state-estimation-multi-sensor.md) · [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md)

Related KB pages: [Camera Projective Geometry, PnP, and Triangulation](../../../10-knowledge-base/geometry-3d/camera-projective-geometry-pnp-triangulation.md) · [Multi-Sensor Calibration and Observability](../../../10-knowledge-base/geometry-3d/multi-sensor-calibration-observability.md) · [Lie Groups SE(3)/SO(3) and Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md)

**Last updated:** 2026-05-24

---

## What It Is

LIR-LIVO ("Lightweight, Illumination-Resilient LiDAR-Inertial-Visual Odometry") is a tightly-coupled odometry system that replaces the direct photometric visual channel used in [FAST-LIVO](fast-livo-fast-livo2.md) and [R3LIVE](r2live-r3live.md) with learned sparse features — SuperPoint keypoints and LightGlue adaptive matching — while retaining the FAST-LIO2 Error-State Iterated Kalman Filter (ESIKF) as the state estimator backbone.

**Paper:** arXiv 2502.08676, submitted 12 February 2025. Category: cs.RO. As of 2026-05-24, the paper is a preprint only; no peer-reviewed conference or journal version has been confirmed.

**Authors:** Shujie Zhou, Zihao Wang, Xinye Dai, Weiwei Song, Shengfeng Gu.

**Affiliation:** Not explicitly disclosed in the arXiv abstract or paper text. The GitHub repository acknowledges FAST-LIVO (HKU MARS Lab) and AirSLAM (Carnegie Mellon University Robotics Institute) as implementation inspirations. Shengfeng Gu has an external profile associated with Wuhan University, but this affiliation cannot be confirmed from the paper text alone. [UNVERIFIED: affiliation field blank in arXiv submission.]

**GitHub:** https://github.com/IF-A-CAT/LIR-LIVO (160 stars, 20 forks as of search date; C++ 99.1%).

**Dependencies:** TensorRT 8.6.1.6, CUDA 11.1, ROS Noetic, OpenCV 4.2+, Eigen 3.

**License:** check GitHub repository for current license status before integration.

---

## Core Technical Idea

FAST-LIVO and R3LIVE perform direct photometric alignment of image patches to a colorized LiDAR map. That residual is brittle: rapid exposure change, motion blur, indoor/outdoor illumination transitions, and low-contrast scenes all degrade photometric tracking quality. When the photometric channel fails, the system falls back to LiDAR-inertial only — but the visual signal is unavailable until conditions recover.

LIR-LIVO attacks this failure mode by replacing direct photometry with **learned sparse feature matching**. SuperPoint, a CNN trained via self-supervised homographic adaptation, extracts keypoints with 256-D descriptors designed to be invariant to photometric change and homographic warp. LightGlue, a transformer-based matcher, performs adaptive feature pairing with mutual-consistency filtering. Both networks use **pre-trained, inference-only weights** — no domain-specific fine-tuning is applied.

Three design decisions distinguish LIR-LIVO from its predecessors:

1. **Learned features inside a classical ESIKF frame.** SuperPoint and LightGlue are deterministic inference modules appended to the FAST-LIO2 estimator. The state estimator and fusion logic remain classical; the learned components are a drop-in visual front-end replacement.

2. **LiDAR depth seeding for metric scale.** Each SuperPoint keypoint is assigned a depth value from the live LiDAR point cloud via 5-nearest-neighbor plane fitting in an ikd-Tree. This eliminates the triangulation delay of monocular SfM and produces metric 3D positions from the first frame. Critically, it also spreads depth coverage uniformly — direct photometric methods cluster features in high-contrast image regions that may correlate with specific depth strata, creating geometric bias in the ESIKF visual update.

3. **Symmetric visual-LiDAR fallback.** The ESIKF processes LiDAR residuals first, then visual reprojection residuals. If the visual channel degrades entirely (lens occlusion, extreme overexposure), the LiDAR-inertial estimate continues uninterrupted. The inverse also holds: if LiDAR geometry is degenerate (long corridor, open field with sparse returns), the visual reprojection residuals stabilize the estimate where LiDAR geometry alone is weak.

---

## Operator Mechanics

### Scan Recombination and Synchronization

LiDAR scanners deliver at 10-20 Hz; cameras at 10-30 Hz; IMUs at 100-400 Hz. LIR-LIVO inherits the scan-recombination step from FAST-LIVO: the incoming LiDAR stream is decomposed into raw points and recombined into synthetic sweeps whose end timestamps align with camera frame timestamps. This ensures that each LIVO update epoch has a coherent point cloud slice temporally matched to a camera image. Calibration of LiDAR-camera-IMU extrinsics and time offsets is a hard prerequisite; see [Multi-Sensor Calibration and Observability](../../../10-knowledge-base/geometry-3d/multi-sensor-calibration-observability.md).

### IMU Propagation

A discrete-time on-manifold state-transition model propagates rotation, position, velocity, gyroscope bias, accelerometer bias, and gravity between camera/LiDAR update epochs. The state lives on SO(3) x R^n. This follows FAST-LIO2 discrete propagation rather than continuous preintegration (Forster et al., IJRR 2017); both produce equivalent forward estimates between measurement epochs. See [Lie Groups SE(3)/SO(3) and Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) for the underlying manifold arithmetic.

### SuperPoint Feature Extraction

SuperPoint (DeTone et al., CVPR Workshops 2018; Magic Leap / ETH CVG) is a self-supervised CNN trained via homographic adaptation on MS-COCO images. It simultaneously outputs a dense keypoint heatmap (non-maximum suppressed to top-k keypoints) and 256-D descriptors per keypoint, trained to be invariant to homographic warp and photometric change.

In LIR-LIVO, SuperPoint is exported to ONNX and compiled with NVIDIA TensorRT in FP16 (16-bit floating-point) precision for inference. The Magic Leap / ETH CVG pre-trained weights are used as-is. **No domain-specific retraining or fine-tuning is performed.**

Runtime from the paper's Table IV: approximately 2.97-3.20 ms depending on dataset, compared with 3.12-3.57 ms for classical Shi-Tomasi corner detection. TensorRT-accelerated SuperPoint is approximately the same speed as classical detectors on the same hardware.

**Camera modality:** monocular only. No stereo configuration is reported or evaluated.

### LiDAR Depth Association

After keypoint detection, each SuperPoint keypoint receives a LiDAR-derived metric depth via the following procedure:

1. Each keypoint pixel is unprojected to a unit ray in the camera frame using the calibrated camera intrinsics (see [Camera Projective Geometry, PnP, and Triangulation](../../../10-knowledge-base/geometry-3d/camera-projective-geometry-pnp-triangulation.md)).
2. The ray is transformed to LiDAR frame using calibrated camera-LiDAR extrinsics.
3. The ikd-Tree is queried for the 5 nearest 3D LiDAR points to the ray direction.
4. A plane is fitted to the 5 nearest points via least-squares.
5. The ray-plane intersection gives a depth estimate.
6. Residual validation: the point-to-plane distance must be below 0.05 m; keypoints that fail this threshold are discarded from the visual update step.
7. Accepted keypoints carry a LiDAR-derived 3D world-frame position.

This avoids triangulation delay entirely. Metric 3D positions are available from the first frame a keypoint is observed, without a multi-view baseline. The 5-NN plane fit also produces a depth estimate that smooths LiDAR noise better than single-point association.

### LightGlue Matching

LightGlue (Lindenberger, Sarlin, Pollefeys; ICCV 2023; ETH CVG) is a lightweight transformer-based matcher designed specifically for SuperPoint descriptors. Key properties:

- Adaptive computation: self-attention and cross-attention layers applied between descriptor sets, with early exit when match confidence is high, saving compute on easy frames.
- Mutual-consistency filtering: matches are accepted only if the assignment is mutual in both directions.
- Pre-trained on MegaDepth (outdoor SfM-derived correspondences, 196 landmarks, ~1M image pairs) and synthetic homographies.

In LIR-LIVO, LightGlue uses the SuperPoint-specific pre-trained weights via TensorRT FP16 inference. **No retraining is performed.**

Runtime from Table IV: approximately 7.01-10.47 ms depending on dataset, compared with 11.43-15.01 ms for brute-force BFMatcher. LightGlue is 30-40% faster than BFMatcher for this descriptor type while producing more geometrically consistent matches. LightGlue is the dominant bottleneck in the visual front-end.

### Sliding-Window Keyframe Management

A sliding window of N=5 keyframes is maintained. Each keyframe stores the state estimate at that epoch, SuperPoint feature pixel coordinates, 256-D descriptors, and LiDAR-derived 3D positions for each feature. A new frame is selected as a keyframe based on pose change relative to the oldest keyframe (translation and rotation thresholds). This bounds memory and ensures matches remain well-conditioned across the window.

**No persistent visual landmark map is maintained.** When a keyframe leaves the window, its features are discarded. There is no loop closure, no global bundle adjustment, and no place recognition module.

### ESIKF Measurement Update

The Error-State Iterated Kalman Filter (ESIKF) — the same estimator used in FAST-LIO2 and FAST-LIVO — performs two sequential measurement update steps per epoch:

1. **LiDAR update:** Point-to-plane residuals from the current LiDAR sweep against the ikd-Tree map. This is the primary geometric constraint.
2. **Visual update:** Visual reprojection residuals computed from 3D feature positions (LiDAR-depth-initialized) re-projected through the updated pose estimate. The Jacobian of the reprojection residual with respect to the error-state is derived analytically.

Both residual sets are incorporated in the same ESIKF measurement model. The iterated refinement loop (typically 3-5 iterations) converges pose and map update jointly. The ESIKF itself takes only 0.10-0.12 ms per epoch; the computational cost is dominated by the visual front-end.

### Map Representation

The LiDAR map is maintained as a raw point cloud in an ikd-Tree (incremental k-d tree from FAST-LIO2). Points are downsampled by a voxel grid for memory efficiency. The visual map is the 5-keyframe sliding window only — no persistent 3D landmark structure. LIR-LIVO is an **odometry system**, not a mapping system in the full SLAM sense.

---

## Inputs and Outputs

**Inputs:**

- 3D LiDAR point cloud (spinning or solid-state; tested on Livox AVIA and sensor suites from NTU-VIRAL and Hilti 2022 sequences).
- Monocular camera (grayscale on NTU-VIRAL and Hilti 2022; RGB on R3LIVE-Dataset). No stereo configuration.
- IMU (accelerometer + gyroscope at 100-400 Hz).
- Pre-calibrated extrinsics: LiDAR-IMU, camera-IMU, LiDAR-camera. Camera intrinsics and distortion parameters.

**Outputs:**

- Per-scan 6-DOF pose estimate in SE(3): position and orientation in world frame.
- Cumulative LiDAR point cloud map stored in an ikd-Tree.
- Sliding-window visual feature state (transient, not a persistent 3D map).

**Not produced:** loop-closure-corrected trajectory, semantic labels, global map with relocalization index, dense reconstruction, colored point cloud, persistent visual landmark structure.

---

## System Architecture

```
Raw sensor streams
        |
        v
+---------------------------------------+
|  SCAN RECOMBINATION                   |
|  Decompose LiDAR stream;              |
|  re-align sweep end timestamps to     |
|  camera frame timestamps              |
+---------------------------------------+
        |
        v
+---------------------------------------+
|  IMU PROPAGATION (discrete-time)      |
|  Propagate state: R, p, v,            |
|  b_g, b_a, gravity                   |
|  State on SO(3) x R^n                 |
+---------------------------------------+
        |
        v
+------------------------+  +------------------------------+
|  LIDAR FRONT-END       |  |  VISUAL FRONT-END            |
|  Deskew point cloud    |  |                              |
|  ikd-Tree lookup       |  |  SuperPoint (TensorRT FP16)  |
|  Point-to-plane        |  |    -> keypoints + 256-D desc |
|  residuals             |  |  LiDAR depth association     |
|                        |  |    -> 5-NN plane fit, 0.05 m |
|  ~5.39-5.70 ms         |  |    threshold                 |
|                        |  |  LightGlue (transformer)     |
|                        |  |    -> matched feature pairs  |
|                        |  |  Sliding window (N=5 KFs)    |
|                        |  |    -> keyframe management    |
|                        |  |  Reprojection residuals      |
|                        |  |  ~11.64-15.48 ms (VIO total) |
+------------------------+  +------------------------------+
              \                        /
               v                      v
        +----------------------------------+
        |  ESIKF MEASUREMENT UPDATE        |
        |  Step 1: LiDAR residuals         |
        |  Step 2: Visual reprojection     |
        |  Iterated refinement (~3-5 itr)  |
        |  ~0.10-0.12 ms                   |
        +----------------------------------+
                        |
                        v
        +----------------------------------+
        |  MAP UPDATE                      |
        |  ikd-Tree incremental insert     |
        |  Voxel downsample                |
        |  Output: 6-DOF pose + LiDAR map  |
        +----------------------------------+

Total pipeline latency: ~17-20 ms per epoch (50-60 Hz capable)
Hardware tested: Intel Core i7-14700K + NVIDIA RTX 4080 Super + 32 GB RAM
```

---

## Training

LIR-LIVO is a system integration paper, not a learning paper. Both learned components use pre-trained, off-the-shelf weights.

**SuperPoint:** Pre-trained weights from Magic Leap / ETH CVG (DeTone et al., CVPR Workshops 2018). Training: self-supervised homographic adaptation on MS-COCO images, then real image fine-tuning. Deployed via ONNX export plus TensorRT FP16 compilation. No domain-specific fine-tuning.

**LightGlue:** Pre-trained weights from ETH CVG (Lindenberger et al., ICCV 2023). Training: synthetic homographies as pre-training, then MegaDepth fine-tuning on approximately 1 million outdoor SfM image pairs across 196 landmarks. LIR-LIVO uses the SuperPoint-specific LightGlue checkpoint as-is. No retraining.

**No end-to-end training, no domain adaptation, no custom datasets used for training.** The integration decision is the contribution; both networks are frozen at inference.

**Implication for out-of-distribution deployment:** Both models were trained predominantly on outdoor urban scenes with natural lighting and standard camera optics. Performance in strongly out-of-distribution environments — mine tunnels, hangar interiors with fluorescent or high-pressure sodium lighting, thermal cameras, retro-reflective markings, near-IR channels — is not evaluated and may degrade. No in-distribution fine-tuning option is provided or evaluated.

---

## Benchmarks

All numbers are from the paper's Tables II, III, and IV. Translation error units are RMS Absolute Translation Error (ATE) in meters unless noted. [NOTE: FAST-LIVO2 does not appear in any comparison table in this paper. The baselines are FAST-LIO2, FAST-LIVO (v1), R3LIVE, and SR-LIVO. LVI-SAM and VINS-Fusion are not included as baselines. Any comparison to those systems must come from their own papers and cannot be treated as directly comparable performance numbers on shared sequences.]

### NTU-VIRAL and Hilti 2022 (RMS ATE, meters)

| Sequence | FAST-LIO2 | R3LIVE | FAST-LIVO | SR-LIVO | LIR-LIVO |
|---|---|---|---|---|---|
| NTU eee_01 | 0.255 | 1.056 | 0.277 | 0.216 | **0.164** |
| NTU eee_02 | 0.194 | — | 0.208 | 0.229 | **0.127** |
| NTU eee_03 | 0.246 | 0.518 | 0.256 | 0.216 | 0.261 |
| NTU nya_01 | 0.242 | 0.252 | 0.307 | **0.181** | 0.152 |
| NTU nya_02 | 0.225 | 0.299 | 0.239 | **0.190** | 0.253 |
| NTU nya_03 | 0.177 | 0.327 | 0.194 | 0.203 | **0.161** |
| NTU sbs_01 | 0.254 | 0.527 | 0.257 | **0.120** | 0.152 |
| NTU sbs_02 | 0.273 | 0.268 | 0.276 | 0.222 | **0.163** |
| NTU sbs_03 | 0.251 | 0.235 | 0.257 | 0.209 | **0.140** |
| Hilti Exp06 | 0.101 | 0.051 | 0.098 | 0.075 | **0.038** |
| Hilti Exp14 | 0.152 | 0.132 | 0.111 | 0.126 | **0.107** |
| Hilti Exp16 | — | — | — | 0.753 | **0.528** |
| Hilti Exp18 | 0.828 | — | 0.196 | 0.247 | **0.168** |

Notes:

- `—` indicates the method failed or did not produce a result for the sequence.
- **Hilti Exp16 is the key illumination result.** This sequence has poor ambient lighting. FAST-LIO2, R3LIVE, and FAST-LIVO (v1) all fail entirely. SR-LIVO survives at 0.753 m; LIR-LIVO survives at 0.528 m — approximately 30% better than the only other surviving method.
- NTU nya_02 is a counterexample: LIR-LIVO (0.253 m) is worse than SR-LIVO (0.190 m), showing learned matching does not uniformly dominate hand-crafted approaches.
- NTU-VIRAL uses a UAV platform with a Leica Nova MS60 total station as the ground truth reference.

### R3LIVE-Dataset (3D End-to-End Translation Error, meters)

| Sequence | R3LIVE | FAST-LIVO | SR-LIVO | LIR-LIVO |
|---|---|---|---|---|
| hku_campus_seq_00 | 0.100 | **0.029** | 0.020 | 0.029 |
| hku_campus_seq_02 | 0.121 | 0.115 | 0.053 | **0.051** |
| hku_park_00 | **0.078** | 0.087 | 0.120 | 0.111 |
| hku_park_01 | 0.537 | 0.596 | 0.546 | **0.511** |
| degenerate_seq_00 | 0.067 | 13.003 | 0.103 | **0.049** |
| degenerate_seq_01 | 0.094 | — | 0.091 | **0.084** |
| LiDAR_Degenerate | 0.064 | 0.044 | 0.053 | 0.076 |

Notes:

- `degenerate_seq_00`: FAST-LIVO diverges catastrophically (13.003 m); LIR-LIVO is best at 0.049 m.
- **LiDAR_Degenerate reversal:** R3LIVE (0.064 m) and FAST-LIVO (0.044 m) outperform LIR-LIVO (0.076 m). When the visual texture is sufficient and the LiDAR geometry is the limiting factor, direct photometric constraints can outperform sparse learned features.
- End-to-end error measures the final-position translation error, not RMS ATE; it is not directly comparable to the Hilti/NTU numbers.

### Computation Timing (Table IV, milliseconds, RTX 4080 Super)

| Component | NTU-VIRAL | Hilti 2022 | R3LIVE-Dataset |
|---|---|---|---|
| SuperPoint extraction | 2.97 | 2.71 | 3.20 |
| Shi-Tomasi (classical comparison) | 3.23 | 3.12 | 3.57 |
| LiDAR depth association | 1.56 | 1.03 | 1.69 |
| LightGlue matching | 7.01 | 9.09 | 10.47 |
| BFMatcher (classical comparison) | 11.43 | 13.96 | 15.01 |
| ESIKF update | 0.10 | 0.12 | 0.12 |
| VIO subsystem total | 11.64 | 12.95 | 15.48 |
| LIO subsystem total | 5.70 | 5.39 | 4.09 |
| LIVO pipeline total | 17.34 | 18.34 | 19.57 |

**Hardware:** Intel Core i7-14700K, 32 GB RAM, NVIDIA GeForce RTX 4080 Super.

Key observations:

- Total cycle is 17-20 ms, giving approximately 50-60 Hz capability on this hardware.
- LightGlue at 7-10 ms is the dominant bottleneck; SuperPoint at 3 ms and ESIKF at 0.1 ms are minor by comparison.
- SuperPoint with TensorRT FP16 is marginally faster than classical Shi-Tomasi corner detection; LightGlue is 30-40% faster than BFMatcher on the same descriptor type.
- The RTX 4080 Super is a high-end consumer GPU. On a Jetson Orin (approximately 10x less GPU throughput than a discrete RTX GPU), the visual front-end time would increase by 5-10x, pushing total cycle above 100 ms and reducing throughput below 10 Hz. Deployment on small MAVs or handheld scanners without a discrete GPU is not feasible with the current codebase.

---

## Comparison Table

| Dimension | LIR-LIVO | FAST-LIO2 | FAST-LIVO (v1) | R3LIVE | SR-LIVO | LVI-SAM |
|---|---|---|---|---|---|---|
| Visual front-end | Learned sparse (SuperPoint + LightGlue) | None | Direct photometric (patch warp) | Direct photometric (FAST-based) | Direct photometric + sweep recon | Sparse hand-crafted (FAST corner + KLT) |
| State estimator | ESIKF | ESIKF | ESIKF | ESIKF | ESIKF | Factor graph (GTSAM) |
| LiDAR coupling | Tight (ESIKF unified) | Tight (LiDAR only) | Tight (ESIKF unified) | Tight (ESIKF unified) | Tight (ESIKF unified) | Loose (separate LIO + VIO in shared graph) |
| Learning | Pre-trained SP + LG (no retraining) | None | None | None | None | None |
| Illumination robustness | High — trained for photometric invariance | N/A (no vision) | Low-moderate — brittle direct | Low-moderate — brittle direct | Low-moderate — brittle direct | Moderate — KLT degrades; LiDAR helps |
| GPU required | Yes (TensorRT mandatory) | No | No | No | No | No |
| Loop closure | No | No | No | No | No | Yes (LiDAR descriptor) |
| Camera type | Monocular | None | Monocular | Monocular (RGB) | Monocular | Monocular |
| Runtime (RTX 4080 S) | 17-20 ms | ~5-8 ms | Not reported | Not reported | Not reported | Not reported |
| Code availability | Yes (IF-A-CAT/LIR-LIVO) | Yes (hku-mars/FAST_LIO) | Yes (hku-mars/FAST-LIVO) | Yes (hku-mars/r3live) | IEEE RA-L 2024 | Yes (TixiaoShan/LVI-SAM) |
| Maturity | Research preprint (2025) | Research / widely deployed (2022) | Research (IROS 2022) | Research (ICRA 2022) | Research (RA-L 2024) | Research (IROS 2021) |

[NOTE: FAST-LIVO2 is the most directly relevant successor to FAST-LIVO v1 and is not evaluated as a baseline in the LIR-LIVO paper. Performance comparison between LIR-LIVO and FAST-LIVO2 on the same sequences is not available from this paper.]

---

## Lineage

```
SuperPoint (2018, Magic Leap / DeTone et al.)
  Self-supervised homographic adaptation
  -> 256-D illumination-robust descriptor
        |
        +----> LightGlue (2023, ETH CVG / Lindenberger et al.)
               Adaptive transformer matcher for SP descriptors
               Trained on MegaDepth outdoor SfM corpus
                      |
                      v
                LIR-LIVO visual front-end (2025)
                TensorRT FP16 inference; no retraining

FAST-LIO2 (2022, HKU MARS / Xu et al.)
  ESIKF + ikd-Tree LiDAR-inertial odometry
        |
        +---> FAST-LIVO (2022, HKU MARS / Zheng et al.)
        |       Add direct photometric visual channel to FAST-LIO2
        |             |
        |             +---> FAST-LIVO2 (2024, HKU MARS)
        |             |       Redesigned: exposure est., unified voxel map
        |             |
        |             +---> SR-LIVO (2024, IEEE RA-L)
        |             |       Sweep reconstruction for improved sync
        |             |
        |             +---> LIR-LIVO (2025, affiliation unconfirmed)
        |                     Replace direct visual with SP + LG
        |                     Add LiDAR depth seeding of keypoints
        |
        +---> (LIO-only baseline for comparison throughout this line)

R3LIVE (2022, HKU MARS / Lin and Zhang)
  Parallel ESIKF: LiDAR-inertial + photometric visual map colorization

LVI-SAM (2021, CMU-MIT / Shan et al.)
  Loose-coupled LIO + VIO in shared factor graph

AirSLAM (CMU Robotics Institute)
  SuperPoint + LightGlue for aerial visual SLAM (acknowledged inspiration)
```

LIR-LIVO is best understood as FAST-LIVO with its photometric visual module surgically replaced by a learned sparse-feature module. The LiDAR-inertial ESIKF backbone is unchanged from FAST-LIO2. The contribution is the integration decision and the LiDAR depth-association design for uniform feature distribution.

---

## Strengths

**Illumination resilience is the primary demonstrated advantage.** SuperPoint was explicitly trained for photometric invariance via synthetic lighting augmentation during homographic adaptation. The Hilti Exp16 sequence — where all direct-photometric baselines fail entirely — is the key empirical validation: LIR-LIVO produces 0.528 m ATE while FAST-LIO2, R3LIVE, and FAST-LIVO (v1) produce no result. This is not a marginal improvement on an easy case; it is survival versus failure on a hard case.

**Competitive runtime for a learned system.** SuperPoint plus LightGlue in TensorRT FP16 totals approximately 10-13 ms, which is faster than the classical Shi-Tomasi plus BFMatcher combination it replaces. The pipeline runs at 50-60 Hz on the test hardware — adequate for real-time deployment on platforms with comparable GPU resources.

**Metric scale from the first frame.** LiDAR depth seeding eliminates the initialization delay of monocular triangulation. Scale is always available as long as LiDAR-camera field-of-view overlap is sufficient.

**Uniform depth distribution.** Features spread more evenly across depth strata compared with direct photometric methods that cluster in high-contrast image regions. This reduces geometric degeneracy in the ESIKF visual update where shallow foreground features dominate.

**Modular architecture.** The FAST-LIO2 LiDAR-inertial backbone is unchanged. Engineers familiar with FAST-LIO2 or FAST-LIVO can integrate LIR-LIVO without learning a new estimator. The visual front-end is a self-contained TensorRT module that could in principle be swapped for other learned feature pairs.

**Symmetric fallback.** If the visual channel fails, LiDAR-inertial continues. If LiDAR geometry is degenerate, visual reprojection residuals support the estimate. The fallback is cleaner than direct-photometric methods because learned feature matching fails gracefully to zero inliers rather than producing biased photometric residuals on poor images.

---

## Failure Modes

**GPU mandatory.** TensorRT FP16 on an RTX-class discrete GPU is a hard requirement. On CPU-only platforms or embedded systems without CUDA (e.g., ARM-only compute), the visual front-end cannot run. On a Jetson Orin (embedded GPU, approximately 10x less throughput than RTX 4080 Super), the visual front-end would require 50-130 ms, reducing total pipeline to below 10 Hz and making real-time operation marginal or infeasible at the current LightGlue model size.

**No loop closure.** Trajectory drift accumulates without bound on long routes or repeated traversal. The 5-keyframe sliding window provides no relocalization. For aggregated mapping over large areas, external loop closure (scan context, LiDAR descriptor matching, GPS/RTK aiding) is required to bound drift.

**LiDAR_Degenerate reversal.** The R3LIVE-Dataset LiDAR_Degenerate sequence shows direct photometric methods (R3LIVE: 0.064 m; FAST-LIVO: 0.044 m) outperforming LIR-LIVO (0.076 m). When visual texture is sufficient and LiDAR geometry is the limiting factor, dense photometric constraints can outperform sparse learned features. Sparse matching is not universally better.

**Pre-trained weights without in-distribution retraining.** SuperPoint and LightGlue were trained on outdoor urban daylight scenes (MS-COCO, MegaDepth). Strongly out-of-distribution appearances — fluorescent-lit corridors, retro-reflective airport markings, thermal cameras, monochrome near-IR imagers, underwater scenes — are not covered by the pre-trained weights. Performance degradation in these cases is not evaluated. No in-distribution fine-tuning option is provided.

**Calibration sensitivity at the depth association step.** LiDAR-camera extrinsic drift or time-offset error directly corrupts the depth association. Unlike direct photometric methods that can absorb small calibration errors through alignment, a bad 3D-to-2D projection poisons the feature depth and cascades into the visual residual.

**No dynamic object filtering.** The pipeline has no moving-object detection or masking. LightGlue will match features on moving vehicles, pedestrians, or swinging doors if those are among the most salient keypoints. The ESIKF has no outlier process for dynamic-point contamination beyond the 0.05 m depth residual threshold, which screens geometry noise but not dynamic-object tracks.

**Static structure assumed in sliding window.** The 5-keyframe visual model assumes that 3D feature positions are static across the window. In dynamic or semi-dynamic scenes this assumption is violated, introducing bias into the reprojection residuals.

**Preprint only.** As of 2026-05-24, no peer-reviewed venue has published this work. Results and implementation details have not undergone formal review. Affiliation of the authors is not disclosed in the paper, which limits reproducibility assessment.

**No persistent visual map.** The visual component is a transient sliding window; there is no global visual landmark structure usable for relocalization or map reuse.

---

## Domain Fit

| Domain | Suitability | Notes |
|---|---|---|
| Urban road AV | Moderate | Illumination advantage in tunnels and night; GPU requirement is feasible in an AV compute stack; no loop closure limits large-area mapping |
| Airside (apron, hangar, jet-bridge) | Good (odometry front-end only) | Primary design target for illumination transitions; GPU availability depends on survey platform |
| Warehouse / indoor logistics | Low-moderate | Low-texture interiors may reduce SuperPoint keypoint count; no loop closure problematic for repeat-route mapping |
| Mining (tunnels, dark galleries) | Low | Out-of-distribution lighting; pre-trained weights not validated in tunnel environments |
| Agricultural / outdoor field | Moderate | Natural lighting suits pre-trained weights; long routes accumulate drift without loop closure |
| Delivery robots | Low | No embedded GPU path; Jetson Orin performance marginal |
| UAV survey | Moderate | UAV platforms with RTX-class GPU (rare); NTU-VIRAL UAV sequences used in evaluation |

---

## Aggregated-Map Suitability

Airside aggregated-map building is the most illumination-challenging regular survey context. Airport aprons span the full photometric range: sun-lit open taxiways at up to 100,000 lux midday, hangar interiors at 200-500 lux under artificial lighting, jet-bridge transition zones with strong directional shadows, and night operations at 10-50 lux under perimeter lighting.

Direct-photometric LIVO systems (FAST-LIVO2, R3LIVE) experience rapid exposure adaptation cycles at these transitions, which can temporarily destabilize the visual update. LIR-LIVO's learned features are trained for photometric invariance and can maintain keypoint correspondence across the illumination jump. The Hilti Exp16 result directly supports this: only the learned-feature system survives poor ambient lighting while all direct-photometric baselines fail.

| Dimension | Assessment |
|---|---|
| Illumination resilience | High — primary design target, Hilti Exp16 is the evidence anchor |
| Day-night survey coverage | Viable in principle; pre-trained weights were not trained on night outdoor scenes, so some degradation expected, but less than direct photometric methods |
| Hangar interior (low texture, uniform walls) | Moderate — sparse features may be scarce on featureless concrete; LiDAR-only fallback remains operational |
| Apron (retro-reflective markings, high contrast) | Favorable — high-contrast markings are precisely where SuperPoint excels |
| Metric scale accuracy | Good — LiDAR depth seeding provides metric scale from first frame |
| Long-route drift | Problematic — no loop closure; drift accumulates over large survey areas and must be bounded externally |
| Aggregated map output | Not directly usable — raw point cloud without semantic labels or global optimization; requires post-processing pipeline |
| GPU availability on survey platform | Constraining — a survey vehicle or drone with a discrete RTX-class GPU can run LIR-LIVO; a small MAV or handheld scanner cannot |
| Integration into aggregated mapping pipeline | Suitable as odometry front-end for an illumination-challenging survey pass; must be coupled with GPS/RTK aiding, loop closure, and a point cloud backend |

For airside aggregated-map building where the survey platform has discrete GPU compute available, LIR-LIVO is a strong odometry front-end candidate for illumination-challenging sequences, particularly day-night transitions and hangar-to-apron transitions. It should be coupled with:

- A GPS/RTK factor (or UWB anchor network for indoor zones) to bound drift. Survey platforms with ground-truth RTK are the recommended deployment vector.
- A loop-closure module (scan context, BoW retrieval, or LiDAR descriptor matching from [Learned LiDAR Place Recognition](learned-lidar-place-recognition.md)) to correct re-traversal drift.
- A point cloud aggregation backend (ICP refinement, normal computation, voxel map) to produce the final survey product for downstream segmentation (see [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md)).

LIR-LIVO as a standalone system is unsuitable for complete aggregated mapping at airside scale due to unbounded drift and the absence of a persistent visual or semantic map structure. It is an odometry front-end, not an aggregated mapping solution.

---

## Implementation Notes

**Dependencies (from GitHub README):**

- OpenCV 4.2+
- Eigen 3
- TensorRT 8.6.1.6
- CUDA 11.1
- ROS Noetic (Ubuntu 20.04; EOL May 2025 — a ROS2 port would be required for production deployment; no ROS2 version is mentioned in the repository)

**Key integration considerations:**

- TensorRT engine files are version-specific. An engine built for TensorRT 8.6 will not load under TensorRT 8.5 or 9.x. Plan for engine re-export when upgrading the CUDA/TRT stack. CUDA 11.1 is notably older than the CUDA 11.4+ available on Jetson Orin, creating a version-mismatch risk for embedded porting.
- The ikd-Tree library from FAST-LIO2 must be compiled with the same Eigen version as the rest of the system.
- Calibration pipeline: LiDAR-camera-IMU extrinsic calibration is required. Kalibr (ETH CVG) or targetless motion-based calibration are standard choices. Extrinsic accuracy is especially critical here because errors at the depth association step propagate directly into visual residuals.
- The ONNX model for SuperPoint can be generated from the official Magic Leap / ETH weights. LightGlue provides its own ONNX export path via the cvg/LightGlue repository.
- The GitHub README explicitly acknowledges **AirSLAM** (CMU Robotics Institute) as an implementation inspiration. AirSLAM uses SuperPoint plus LightGlue for aerial visual SLAM with RGB-D or stereo. LIR-LIVO's primary novelty relative to AirSLAM is adding LiDAR as a third modality with the depth-association pattern.
- Dynamic object handling is absent; for airside deployment, explicit masking of aircraft, ground vehicles, and personnel should be added to the visual front-end before the feature extraction step. See [TRLO Dynamic Tracking and Removal LiDAR Odometry](trlo-dynamic-tracking-removal-lidar-odometry.md) for the LiDAR-side dynamic removal complement.

---

## Sources

- arXiv 2502.08676 — LIR-LIVO paper: https://arxiv.org/abs/2502.08676
- arXiv HTML full text: https://arxiv.org/html/2502.08676v1
- GitHub: IF-A-CAT/LIR-LIVO: https://github.com/IF-A-CAT/LIR-LIVO
- SuperPoint — DeTone, Malisiewicz, Rabinovich. "SuperPoint: Self-Supervised Interest Point Detection and Description." CVPR Workshops 2018. arXiv:1712.07629.
- LightGlue — Lindenberger, Sarlin, Pollefeys. "LightGlue: Local Feature Matching at Light Speed." ICCV 2023. arXiv:2306.13643.
- FAST-LIO2 — Xu, Cai, He, Lin, Zhang. IEEE T-RO 2022. arXiv:2107.06829.
- FAST-LIVO — Zheng, Zhu, Xu, Liu, Guo, Zhang. IROS 2022. arXiv:2203.00893.
- R3LIVE — Lin and Zhang. ICRA 2022. arXiv:2209.03666.
- LVI-SAM — Shan, Englot, Meyers, Wang, Ratti, Rus. IROS 2021. arXiv:2104.10831.
- VINS-Fusion — Qin, Cao, Pan, Liu, Shen. IEEE T-RO 2019. arXiv:1901.03277.
- SR-LIVO — IEEE RA-L 2024. DOI: 10.1109/LRA.2024.3377508.
- ETH CVG LightGlue weights: https://huggingface.co/ETH-CVG/lightglue_superpoint
