# DROID-SLAM

<!-- method-priority:start
priority:
  learning: 4
  deployment: 3
  type: "method"
  stage: "modern-core"
  maturity: "fielded-pattern"
  tags: ["slam", "fallback", "gnss-denied", "indoor", "validation"]
  reason: "DROID-SLAM is rated for visual or visual-inertial SLAM coverage, especially fallback and GNSS-denied use."
method-priority:end -->

Related docs: [Splat-SLAM](splat-slam.md) · [MASt3R-SLAM](mast3r-slam.md) · [KISS-ICP](kiss-icp.md) · [FAST-LIO / FAST-LIO2](fast-lio-fast-lio2.md) · [GS-SLAM and MonoGS](gs-slam-monogs.md) · [NeRF-SLAM](nerf-slam.md) · [DPVO](dpvo.md) · [ORB-SLAM2 and ORB-SLAM3](orb-slam2-orb-slam3.md) · [LSD-SLAM and DSO](lsd-slam-dso.md) · [VINS-Mono and VINS-Fusion](vins-mono-vins-fusion.md) · [Kimera-VIO](kimera-vio.md) · [OpenVINS](openvins.md) · [Learned LiDAR Place Recognition](learned-lidar-place-recognition.md) · [Loop Closure and Place Recognition](loop-closure-place-recognition.md) · [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [Mapping and Localization](../overview/mapping-and-localization.md) · [Robust State Estimation and Multi-Sensor Localization Fusion](../overview/robust-state-estimation-multi-sensor.md) · [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md) · [Camera Projective Geometry — PnP and Triangulation](../../../10-knowledge-base/geometry-3d/camera-projective-geometry-pnp-triangulation.md) · [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md)

---

## What It Is

DROID-SLAM — **D**ifferentiable **R**ecurrent **O**ptimization-**I**nspired **D**esign for SLAM — is a deep visual SLAM system from Princeton University, published by Zachary Teed and Jia Deng at **NeurIPS 2021** (oral presentation, pp. 16558–16569). It unifies monocular, stereo, and RGB-D camera modalities under a single trained model by replacing hand-crafted feature detectors with a **learned dense optical-flow tracker** derived from RAFT and coupling it to a differentiable geometric solver called the **Dense Bundle Adjustment (DBA) layer**.

Full citation: Zachary Teed and Jia Deng. "DROID-SLAM: Deep Visual SLAM for Monocular, Stereo, and RGB-D Cameras." *Advances in Neural Information Processing Systems 34 (NeurIPS 2021)*. arXiv: <https://arxiv.org/abs/2108.10869>. GitHub: <https://github.com/princeton-vl/DROID-SLAM>.

The central thesis: classical visual SLAM (ORB-SLAM3, DSO) relies on handcrafted detectors (ORB, FAST) and sparse keypoint matching. DROID-SLAM replaces this front-end with a dense flow estimator refined recurrently across all tracked frame pairs, then solves for globally consistent poses and per-pixel depths via the DBA layer. The result is end-to-end differentiable — gradients flow through the geometric solver at training time, so the network learns flow predictions that specifically improve the downstream geometric outcome.

The NeurIPS oral selection places DROID-SLAM among the top ~1% of accepted submissions that year, reflecting the scope of its results: state-of-the-art accuracy on EuRoC, TUM-RGBD, and ETH3D-SLAM at publication, with substantially fewer catastrophic failures than any prior system.

---

## The RAFT Lineage

DROID-SLAM is the direct architectural successor of **RAFT** (Recurrent All-Pairs Field Transforms for Optical Flow), also authored by Teed and Deng and published at **ECCV 2020** (Best Paper Award). Understanding RAFT is essential for understanding DROID-SLAM.

**RAFT arXiv:** <https://arxiv.org/abs/2003.12039>. **GitHub:** <https://github.com/princeton-vl/RAFT>.

### What RAFT Does (2-frame case)

Given two frames I₁ and I₂:

1. Extract per-pixel feature maps f_a, f_b at 1/8 resolution using a shared CNN encoder.
2. Build a **4D correlation volume** C[i,j,k,l] = f_a(i,j)^T f_b(k,l) — all pairs of pixel positions across both frames.
3. Average-pool C over the last two dimensions at 4 scales (strides 1, 2, 4, 8) to form a 4-level correlation pyramid.
4. Maintain a hidden state h and iterate a **ConvGRU** update operator that looks up the pyramid at the current flow estimate, updates h, and predicts a flow correction delta_f.
5. After K iterations (typically 12), the flow field converges.

RAFT achieved a 16% error reduction on KITTI (F1-all: 5.10%) and a 30% reduction on Sintel over prior art. The GRU iteration mimics a fixed-point solver: each step refines flow using current-location lookups in the correlation pyramid, not a single feed-forward prediction.

### How DROID-SLAM Extends RAFT

RAFT operates on exactly two frames and outputs 2D optical flow. DROID-SLAM extends this to the full SLAM problem in three ways:

- **Many frames simultaneously.** Maintain a frame graph of (i, j) keyframe pairs; run GRU updates for all pairs jointly, not just one pair.
- **Output 3D quantities.** Instead of only refining 2D flow, the GRU also outputs camera pose updates delta_G in se(3) and per-pixel inverse-depth updates delta_d.
- **Geometric coupling via DBA.** The GRU-predicted flow revisions feed a Dense Bundle Adjustment layer that converts them into geometrically consistent pose and depth updates. This couples the optical-flow estimator to the 3D state of the map.

The key insight: RAFT's iterative refinement structure is compatible with the recurrent structure of bundle adjustment. DROID converts RAFT's 2-frame, 2D flow estimation into an N-frame, 3D-consistent pose-and-depth estimator.

---

## Core Technical Idea

Classical visual SLAM has a sharp architectural boundary: a feature-based front-end (detect, describe, match keypoints) hands sparse correspondences to a back-end optimizer (bundle adjustment, pose-graph). This boundary limits joint learning because the front-end and back-end are not differentiably coupled.

DROID-SLAM eliminates this boundary. A recurrent neural network simultaneously acts as the front-end (estimating dense correspondences via the GRU update operator) and drives the back-end (the DBA layer converts flow outputs into pose and depth updates). The two components see each other's outputs at every GRU iteration:

```
For each GRU iteration k:
  1. Look up correlation pyramid at current flow estimate (front-end sensing)
  2. ConvGRU updates hidden state h
  3. Predict flow revision r_ij and confidence w_ij per edge (front-end output)
  4. DBA layer converts {r_ij, w_ij} into delta_G (pose) and delta_d (depth)
  5. New flow estimate = old flow + delta_r informed by updated geometry
```

This tight coupling means the network learns what flow revisions actually improve the geometric solution after DBA solves — not what flow is "correct" in isolation.

---

## Inputs and Outputs

**Inputs:**
- Monocular, stereo, or RGB-D video (time-ordered, sufficient visual overlap).
- Known camera calibration (intrinsics) in standard format. Unlike [MASt3R-SLAM](mast3r-slam.md), DROID-SLAM is not calibration-free.
- A CUDA-capable GPU with at least 11 GB VRAM for inference.

**Outputs:**
- Per-keyframe 6-DOF poses in SE(3).
- Per-pixel inverse depth maps for each keyframe (dense depth estimate).
- Keyframe graph structure with edges denoting co-visible frame pairs.
- Dense 3D point cloud derived from back-projected depth and optimized poses.
- Optionally: loop-closure-corrected global trajectory from the backend thread.

Stereo and RGB-D inputs are integrated at **test time without retraining** by adding virtual edges to the keyframe graph (stereo) or adding a depth regularization term to the DBA objective (RGB-D). This modality-agnostic design is a significant practical advantage over systems that require per-modality training.

---

## Architecture

The DROID-SLAM architecture has six interconnected components. The code is 71.6% Python, 22.8% CUDA, and 2.5% C++.

```
RGB frames (mono / stereo / RGB-D)
    |
    v
[Feature Encoder — CNN, 1/8 resolution, D=128, instance norm]
[Context Encoder — CNN, 1/8 resolution, D=256, no norm]
    |
    v
[Correlation Pyramid — 4D volume per edge, 4-level pooled]
    |
    v
[ConvGRU Update Operator — per-edge flow revision + confidence]
    |
    v
[Dense Bundle Adjustment (CUDA) — Schur complement, pixelwise damping]
    |
    v
[Keyframe Graph — frontend (local, 4 iters) + backend (global, 8 iters)]
    |
    v
Poses (SE3) + Inverse Depth Maps + Dense Point Cloud
```

### Feature Encoder and Context Encoder

Two separate CNNs with the same macro-structure (6 residual blocks, 3 downsampling layers, output at 1/8 input resolution):

- **Feature encoder:** 128 output channels; instance normalization per feature map (removes photometric variation across frames). Used to build correlation volumes.
- **Context encoder:** 256 output channels; no normalization (preserves absolute intensity statistics needed for GRU state initialization). Used to seed the GRU hidden state.

For a 480×640 input, both encoders produce 60×80 feature maps. Each encoder runs once per new frame.

### Correlation Pyramid (4D)

For each directed edge (i, j) in the frame graph representing co-visible keyframe pair:

1. Compute 4D correlation volume: C[u, v, u', v'] = f_i(u,v)^T f_j(u',v'), where (u,v) ranges over all H/8 × W/8 positions in frame i and (u',v') over all positions in frame j.
2. Pool C along (u',v') dimensions at 4 levels (stride 1, 2, 4, 8).
3. At each GRU iteration, look up the pyramid at positions given by the current flow estimate via bilinear sampling — the volume is never fully materialized, keeping memory tractable.

### GRU Update Operator

A 3×3 ConvGRU maintains a hidden state h_k in R^{H/8 × W/8 × 128} per frame (not per edge). At each iteration k, for each edge (i,j):

```
Input assembly:
  x_t = [correlation features at current flow, current flow estimate r_ij, hidden state h]

GRU update (standard gated form):
  z_t = sigmoid(Conv([x_t, h_{t-1}]))         -- update gate
  r_t = sigmoid(Conv([x_t, h_{t-1}]))         -- reset gate
  h_tilde_t = tanh(Conv([x_t, r_t * h_{t-1}]))
  h_t = (1 - z_t) * h_{t-1} + z_t * h_tilde_t

Output heads (two convolutional decoders on h_t):
  r_ij  in R^{H/8 x W/8 x 2}   -- flow revision field per edge
  w_ij  in R^{H/8 x W/8 x 2}   -- per-pixel anisotropic confidence
```

The GRU runs on all edges simultaneously, but the hidden state h is maintained per-frame — information from all associated edges is pooled before the per-frame update. This allows information to flow across the frame graph without growing state size with edge count.

### Dense Bundle Adjustment (DBA) Layer

The geometric core of DROID-SLAM. After the GRU produces flow revisions {r_ij} and confidence weights {w_ij}, the DBA layer converts them into updates to poses {G_i} in SE(3) and per-pixel inverse depths {d_i} in R^{H×W}.

**Objective.** For each edge (i, j) and each pixel p in frame i, DBA minimizes:

```
E = sum_{(i,j) in edges} sum_p  w_ij(p) * || p_ij(p) - (r_ij(p) + pi(G_ij, d_i(p), p)) ||^2
```

where:
- `pi(G_ij, d_i(p), p)` is the projected position of pixel p from frame i into frame j using the relative pose G_ij = G_j composed G_i^{-1} and inverse depth d_i(p).
- `r_ij(p)` is the GRU-predicted flow revision (target flow correction).
- `w_ij(p)` is the GRU-predicted per-pixel confidence weight.
- `p_ij(p)` is the accumulated flow estimate from all previous iterations.

See [Camera Projective Geometry — PnP and Triangulation](../../../10-knowledge-base/geometry-3d/camera-projective-geometry-pnp-triangulation.md) for the projection function pi and [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) for the SE(3) pose parameterization.

**Gauss-Newton linearization.** Linearize around current estimates:

```
H delta_x = b

delta_x = [delta_xi_1, ..., delta_xi_N, delta_d_1, ..., delta_d_N]^T
          stacks pose updates in se(3) and per-pixel depth updates
H = assembled from Jacobians J = d_pi / d(xi, d)
```

**Schur complement (block structure).** The depth variables d_i(p) are pixel-local — each depth residual involves only one depth variable. This makes the Hessian block-diagonal in the depth block:

```
H = [H_xi_xi    H_xi_d ]
    [H_xi_d^T   H_d_d  ]

H_d_d is block-diagonal (one small block per pixel).

Schur complement eliminates depth:
  S_xi = H_xi_xi - H_xi_d (H_d_d + lambda*I)^{-1} H_xi_d^T
  b_xi = b_xi  - H_xi_d (H_d_d + lambda*I)^{-1} b_d

Solve: S_xi delta_xi = b_xi
Back-substitute: delta_d from the depth block
```

**Pixelwise damping.** A per-pixel damping factor lambda is predicted by the network (via softplus activation, ensuring lambda > 0). This replaces the fixed Levenberg-Marquardt damping of classical BA and allows the network to learn where to trust the geometric estimate vs. the learned flow.

**CUDA kernel at inference.** A custom CUDA kernel exploits the block-sparse Schur complement structure for speed. The Schur solve is O(N_frames × W × H) for depth elimination and O((6 × N_frames)^2) for the reduced pose system.

**End-to-end differentiability.** Gradients flow through the DBA layer during training via implicit-function differentiation applied to the fixed-point condition of the Gauss-Newton solve. This is the key property that allows the GRU to learn flow predictions that improve the geometric result after DBA solves.

### Keyframe Graph and System-Level Flow

The system maintains a frame graph G = (V, E) where V is the set of keyframe indices and E is the set of directed edges (i, j) representing co-visible frame pairs.

**Frontend (tracking):** New frames are processed by the feature encoder. A new keyframe is added when the frame differs sufficiently from the last keyframe (measured by optical flow magnitude). On keyframe addition, edges are created to temporal neighbors and close-in-3D neighbors. The frontend runs **4 GRU iterations** on the local subgraph (approximately 10 frames), yielding fast local tracking.

**Backend (global BA + loop closure):** Runs asynchronously on a second thread (or second GPU). Maintains the full keyframe graph and runs **8 GRU iterations** on the global graph. Detects loop closures when the camera revisits a previously mapped area; adds long-range edges and runs global BA to correct accumulated drift. In the two-GPU configuration used in the paper, frontend runs on GPU 0 and backend runs on GPU 1. The asynchronous mode is non-deterministic but yields better results.

---

## Training

### Dataset

**TartanAir** — a large-scale synthetic photorealistic dataset from AirLab CMU, designed specifically for SLAM training. Features indoor and outdoor environments, ground-truth per-frame 6-DOF pose and per-pixel depth, multiple traversal patterns, weather conditions, and lighting. The system is trained on **monocular sequences only** despite generalizing to stereo/RGB-D at test time. Dataset URL: <https://theairlab.org/tartanair-dataset/>

### Training Procedure

| Parameter | Value |
|-----------|-------|
| Gradient steps | 250,000 |
| Batch size | 4 sequences |
| Clip length | 7 keyframes per training clip |
| Input resolution | 384 × 512 |
| GRU iterations unrolled | 15 per training clip |
| Learning rate | 0.00025 |
| Hardware | 4 × RTX 3090 (24 GB each) |
| Training time | Approximately 1 week |

### Loss Function

Supervised on both pose and flow simultaneously, weighted by GRU iteration:

```
L = sum_k  gamma^{K-k} * (lambda_pose * || log(G_k* compose G_k^{-1}) ||_2
                         + lambda_flow * sum_{(i,j)} || f_ij_k - f_ij_k* ||_2)

where:
  k      = GRU iteration index
  gamma  < 1, typically ~0.85 (later iterations weighted more)
  G_k*   = ground-truth pose
  f_ij_k* = ground-truth optical flow for edge (i,j)
```

Gradients flow through the DBA layer via implicit differentiation. The combined pose and flow supervision ensures both tracking and geometric reasoning improve jointly. Covisibility between all frame pairs for training is cached after first computation to reduce subsequent overhead.

---

## Compute and Inference

### Hardware Requirements

| Mode | GPU Memory |
|------|-----------|
| Inference (single GPU) | >= 11 GB |
| Inference (dual GPU, async backend) | ~11 GB per GPU |
| Training | >= 24 GB per GPU (4x RTX 3090) |

### Inference Speed

- KITTI sequences at 1240×368 resolution: approximately **3.6 FPS** (660 frames in ~3 minutes on dual-GPU setup, including backend BA).
- The MINI-DROID-SLAM replication study reports 7.75 iterations/second on a single RTX 3070 (8 GB) with 6.2 GB memory utilization — confirming reduced-resolution operation on a consumer card.
- Frontend local tracking runs at multi-FPS rates; backend global BA runs asynchronously and introduces latency but not throughput bottleneck.

### Memory Scaling

GPU memory scales with the number of active edges in the keyframe graph. For approximately 100 keyframes with 300 active edges and 480×640 input, this is approximately 6–10 GB. Longer sequences require periodic keyframe marginalization to keep memory bounded. This is a known architectural constraint compared to the follow-up DPVO and DPV-SLAM systems.

### Software Dependencies

- Python 3, PyTorch (tested to 2.7).
- CUDA for the DBA block-sparse Schur complement kernel.
- `lietorch` for Lie group SE(3) pose parameterization.
- `pytorch_scatter` for scatter operations in graph construction.

---

## Benchmark Results

*ATE = Absolute Trajectory Error (RMSE, meters unless noted). Numbers from the DROID-SLAM NeurIPS 2021 paper and follow-up replication studies.*

### EuRoC MAV — Monocular ATE (meters)

EuRoC is the most-cited indoor-flight benchmark (stereo + IMU, 11 sequences, evaluated here in monocular visual-only mode).

| Sequence | ORB-SLAM3 | DSO | DROID-SLAM |
|----------|-----------|-----|------------|
| MH01 | 0.035 | 0.044 | 0.015 |
| MH02 | 0.018 | 0.046 | 0.013 |
| MH03 | 0.024 | fails | 0.035 |
| MH04 | 0.085 | 0.109 | 0.048 |
| MH05 | 0.052 | 0.110 | 0.040 |
| V101 | 0.035 | 0.089 | 0.037 |
| V102 | 0.025 | 0.107 | 0.011 |
| V103 | 0.061* | fails | 0.020 |
| V201 | 0.041 | 0.044 | 0.018 |
| V202 | 0.028 | 0.094 | 0.015 |
| V203 | 0.521* | fails | 0.017 |
| **Average** | ~0.084* | — | **0.022** |

*ORB-SLAM3 marked * = partial tracking or rescue required. DROID-SLAM reduces monocular EuRoC error by ~43% over sequences where ORB-SLAM3 also succeeds, and shows zero failures across all 11 sequences. On stereo EuRoC, DROID-SLAM reduces error by **71%** over ORB-SLAM3.*

### TUM RGB-D — Monocular ATE (meters)

9 sequences evaluated; DROID-SLAM successfully tracks all 9. ORB-SLAM3 and DSO fail on several due to rolling shutter and aggressive rotation.

| Sequence | DROID-SLAM ATE (m) |
|----------|--------------------|
| desk | 0.018 |
| desk2 | 0.042 |
| floor | 0.021 |
| plant | 0.016 |
| room | 0.049 |
| rpy | 0.026 |
| teddy | 0.048 |
| xyz | 0.012 |

DROID-SLAM achieves 83% lower ATE than DeepFactors and 90% lower than DeepV2D on TUM-RGBD. Source for per-sequence numbers: MINI-DROID-SLAM replication study (<https://pmc.ncbi.nlm.nih.gov/articles/PMC12431227/>).

### ETH3D-SLAM (RGB-D, 32 sequences)

DROID-SLAM successfully tracks **30 of 32** sequences. The next-best method at publication time tracked only **19 of 32**. This robustness result was a headline claim of the paper.

### TartanAir SLAM Competition

DROID-SLAM reduced trajectory error by **62%** over the best prior result on the monocular track and **60%** on the stereo track.

### KITTI Visual Odometry

DROID-SLAM was not KITTI-SOTA at publication — classical methods optimized for KITTI (LOAM-style, DSO with KITTI parameters) remain competitive for outdoor large-scale driving. Approximate throughput: **3.6 FPS** on KITTI at 1240×368. The follow-up DPV-SLAM (ECCV 2024) substantially improves KITTI performance (see Follow-Up Family below).

### Method Comparison at Publication (NeurIPS 2021)

| System | Type | Mono | Stereo | RGB-D | Loop Closure | Requires GPU |
|--------|------|------|--------|-------|--------------|-------------|
| ORB-SLAM3 | Feature-based SLAM | Yes | Yes | Yes | Yes | No |
| DSO | Direct SLAM | Yes | Yes | — | No | No |
| NICE-SLAM | Neural SLAM (NeRF) | — | — | Yes | No | Yes |
| TartanVO | Learned VO | Yes | — | — | No | Yes |
| DeepV2D | Learned SLAM | — | — | Yes | No | Yes |
| **DROID-SLAM** | **Learned SLAM** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** |

DROID-SLAM is the only system in this table that is simultaneously learned, supports all three modalities, and includes loop closure.

---

## The Follow-Up Family

DROID-SLAM has spawned a direct lineage of systems by the same Princeton team and by the broader community:

```
RAFT (ECCV 2020, Best Paper) — 2-frame dense optical flow, ConvGRU
  └─> DROID-SLAM (NeurIPS 2021, oral) — N-frame, 3D-consistent, DBA layer [THIS PAGE]
       ├─> DPVO (NeurIPS 2023) — per-patch tracking, 60 FPS, VO only
       │    └─> DPV-SLAM (ECCV 2024) — adds loop closure, 4x less memory
       ├─> DROID-Splat (ICCVW NeuSLAM 2025) — DROID front-end + 3DGS back-end
       └─> Splat-SLAM (CVPR 2025W, iter-18) — DROID-style flow + DSPO + 3DGS
```

### DPVO — Deep Patch Visual Odometry (NeurIPS 2023)

Teed et al. "Deep Patch Visual Odometry." *NeurIPS 2023*. arXiv: <https://arxiv.org/abs/2208.04726>. GitHub: <https://github.com/princeton-vl/DPVO>.

**Key innovation.** Replace DROID-SLAM's dense (all-pixel) correspondence with sparse **patch tracking**. Each frame is represented by a set of P×P patches (typically 3×3) sampled at semi-random positions. The patches are tracked across frames by a recurrent architecture similar to DROID-SLAM's GRU, but operating on patch-level features rather than per-pixel features. The BA layer operates on patch inverse depths and poses, not dense per-pixel depths.

**Performance vs. DROID-SLAM:**

| Metric | DROID-SLAM | DPVO | DPVO-light |
|--------|-----------|------|------------|
| Speed (EuRoC) | ~20 FPS | 60 FPS | 120 FPS |
| GPU memory | ~20 GB | ~4.9 GB | ~2.5 GB |
| EuRoC accuracy | — | 43% lower error than DROID-VO | Best on most sequences |

DPVO is pure odometry — no loop closure, no global map. Suitable for real-time trajectory estimation where dense reconstruction is not required.

### DPV-SLAM — Deep Patch Visual SLAM (ECCV 2024)

Lahav Lipson, Zachary Teed, and Jia Deng. "Deep Patch Visual SLAM." *ECCV 2024*. arXiv: <https://arxiv.org/abs/2408.01654>.

Extends DPVO with global BA and two loop closure modes to form a full SLAM system:

1. **Proximity loop closure** — detects loops by camera proximity; uni-directional edges; 0.1–0.18 s vs. DROID-SLAM's 0.5–5 s backend.
2. **Classical loop closure (DPV-SLAM++)** — dBoW2 image retrieval with ORB features; structure-only BA; Sim(3) pose-graph optimization on CPU for very large loops.

**DPV-SLAM vs. DROID-SLAM:**

| Dataset | DPV-SLAM ATE | DROID-SLAM ATE | DPV notes |
|---------|-------------|---------------|-----------|
| EuRoC | 0.024 m | 0.022 m | 50 FPS, 5.0 GB |
| TUM-RGBD | 0.054 m | 0.038 m | 30 FPS, 6.0 GB |
| TartanAir | 0.16 m | 0.24 m | DPVO base outperforms |
| KITTI | 25.76 m avg | 118.7 m avg | Major outdoor improvement |

DPV-SLAM achieves competitive accuracy to DROID-SLAM with 2.5× faster speed and 4× lower memory. The KITTI improvement is especially notable and corrects the main production weakness of DROID-SLAM on outdoor driving sequences.

### DROID-Splat (ICCVW NeuSLAM 2025)

Homeyer et al. "DROID-Splat: Combining end-to-end SLAM with 3D Gaussian Splatting." *ICCV 2025 Workshop NeuSLAM*. arXiv: <https://arxiv.org/abs/2411.17660>. GitHub: <https://github.com/ChenHoy/DROID-Splat>.

Integrates DROID-SLAM's dense optical-flow tracker as the **tracking front-end** with a **3D Gaussian Splatting (3DGS)** map as the **rendering back-end**. Key extensions:
- Renderer outputs (novel-view renderings) feed back into the tracker as a **render-then-track** refinement loop — not present in original DROID-SLAM.
- Integrates monocular depth prediction priors.
- Supports cameras without known intrinsics.
- Parallel threads: frontend / backend / loop closure / renderer.

Achieves state-of-the-art tracking and rendering on TUM-RGBD and Replica in both monocular and RGB-D modes.

### Splat-SLAM — DSPO Layer (CVPR 2025W, iter-18 in this KB)

Sandström et al. "Splat-SLAM: Globally Optimized RGB-only SLAM with 3D Gaussians." arXiv 2405.16544.  GitHub: <https://github.com/google-research/Splat-SLAM>. See [Splat-SLAM](splat-slam.md) for the full method page.

Uses a DROID-style recurrent optical-flow front-end but replaces the DBA layer with a custom **DSPO (Disparity, Scale and Pose Optimization)** layer that adds a second optimization objective integrating monocular depth priors:

```
DSPO Objective 1 (dense BA):
  Minimize reprojection error from flow predictions to optimize
  pose and per-pixel disparity jointly in a sliding-window factor graph.

DSPO Objective 2 (monocular depth integration):
  For reliable pixels (multi-view count >= 2):
    D_proxy = theta * D_mono + gamma   (scale + shift fitted to multi-view disparity)
  For unreliable pixels:
    D_proxy = theta * D_mono + gamma   (scale/shift from nearby reliable region)

Weighting: alpha_1 < alpha_2 ensures multi-view disparities guide scale/shift calibration.
```

DSPO outputs a proxy depth map combining multi-view disparity with learned monocular depth. The 3DGS map is built from these proxy depths and optimized via photometric re-rendering loss. Best PSNR on Replica (36.45 dB) operating RGB-only; ATE 0.35 cm.

### MASt3R-SLAM — Calibration-Free Competitor (CVPR 2025 Highlight, iter-24)

Murai et al. "MASt3R-SLAM: Real-Time Dense SLAM with 3D Reconstruction Priors." *CVPR 2025 Highlight*. arXiv: <https://arxiv.org/abs/2412.12392>. See [MASt3R-SLAM](mast3r-slam.md) for the full method page.

Architecturally distinct from DROID-SLAM — uses a two-view 3D reconstruction network (MASt3R pointmaps) as the geometric prior rather than learned dense optical flow:

| Dimension | DROID-SLAM | MASt3R-SLAM |
|-----------|-----------|-------------|
| Matching foundation | Learned dense optical flow (RAFT-style GRU) | MASt3R pointmaps (DUSt3R family) |
| Camera model | Parametric pinhole (requires calibration) | Generic central (no calibration needed) |
| Pose representation | SE(3) | Sim(3) |
| Tracking speed | Per-pair GRU iterations + DBA | ~2 ms ray-space projective matching |
| Depth output | Dense per-pixel inverse depth | Dense pointmap per keyframe |
| Global optimization | Gauss-Newton on poses + per-pixel depth | Sparse Cholesky Gauss-Newton on Sim(3) |
| Loop closure | Proximity + global BA | ASMK inverted-file retrieval + MASt3R verification |
| Training data | TartanAir synthetic | Off-the-shelf MASt3R (large pretraining) |
| Speed | ~3.6–20 FPS (resolution dependent) | ~15 FPS on RTX 4090 |

Select benchmark comparison:

| Dataset | DROID-SLAM ATE | MASt3R-SLAM ATE |
|---------|---------------|----------------|
| TUM RGB-D | 0.038 m | 0.030 m |
| 7-Scenes | 0.049 m | 0.047 m |
| EuRoC | 0.023 m | 0.041 m |

MASt3R-SLAM outperforms on geometry-heavy benchmarks (TUM, 7-Scenes); DROID-SLAM retains an edge on EuRoC. The calibration-free operation of MASt3R-SLAM is a practical deployment advantage.

---

## Strengths

1. **Robustness to failure.** 30/32 ETH3D sequences vs. 19/32 for the next-best method at NeurIPS 2021 publication. The learned GRU recovers from brief feature loss that causes ORB-SLAM3 to fail outright.

2. **Accuracy.** State-of-the-art on monocular visual SLAM at NeurIPS 2021; remains a strong baseline through 2025 on EuRoC and TUM-RGBD.

3. **Modality flexibility.** A single trained model handles monocular, stereo, and RGB-D at test time without retraining. The test-time modality extension is architecturally clean.

4. **End-to-end differentiability.** Gradients flow through DBA at training time via implicit-function differentiation. The network learns flow predictions that specifically improve the geometric solution — a tighter coupling than pipelines that train the flow estimator and the geometric solver independently.

5. **Dense depth output.** Unlike sparse-feature systems, produces dense per-pixel depth maps suitable for 3DGS or NeRF back-ends (as exploited by DROID-Splat and Splat-SLAM).

6. **Active research platform.** Has spawned DPVO, DPV-SLAM, DROID-Splat, Splat-SLAM, and influenced many concurrent learned-SLAM works. Well-documented open-source code and reproducible results make it the standard learned-SLAM baseline.

---

## Failure Modes

**1. Monocular scale unobservability.**
In monocular mode, the camera trajectory is recoverable only up to a similarity transform (scale ambiguous). Scale drift accumulates over long sequences. The ScaleMaster benchmark (arXiv 2602.18174) documents severe failures on extended indoor trajectories exceeding 200 m. External scale — stereo baseline, depth sensor, or IMU — is required for metric accuracy in production use.

**2. GPU requirement.**
Minimum 11 GB GPU for inference; not deployable on MCU, CPU, or small embedded processors. This contrasts with ORB-SLAM3 which runs on CPU and is compatible with embedded ARM hardware. For airside vehicles with tight compute budgets shared with perception networks, GPU contention is a real deployment concern.

**3. Memory growth with keyframe count.**
GPU memory scales linearly with the number of active edges in the keyframe graph. For sequences with hundreds of keyframes, GPU memory can become a bottleneck without aggressive marginalization. DPV-SLAM achieves 4× lower memory by switching to patch-level (not pixel-level) tracking.

**4. Dynamic objects.**
The rigid-scene assumption underlying optical flow and bundle adjustment is violated by dynamic objects. Moving aircraft, ground vehicles, or workers corrupt the flow predictions for affected edges. "DROID-SLAM in the Wild" (arXiv 2603.19076) documents this and proposes per-pixel dynamic uncertainty weighting as a mitigation — but this requires additional semantic or motion segmentation prior to flow estimation.

**5. Texture-less surfaces.**
The feature encoder (1/8 resolution CNN) fails to produce discriminative features on planar, texture-free surfaces such as bare concrete aprons, white walls, or smooth aircraft fuselages. The GRU correspondences become unreliable, and the DBA update diverges or produces large errors. This is a fundamental limitation for airside outdoor deployment.

**6. Scale inconsistency on complex trajectories.**
Documented "intra-session scale inconsistency" in multi-floor, stair, and long-trajectory sequences. Loop closure partially mitigates this but can become trapped by accumulated drift before a loop is detected.

**7. Initialization fragility.**
Early frames before the keyframe graph has sufficient nodes produce unreliable pose estimates. "DROID-SLAM in the Wild" explicitly notes initialization-phase vulnerability, requiring warm-up frames before reliable tracking begins.

**8. KITTI outdoor underperformance.**
On outdoor driving, DROID-SLAM underperforms compared to LiDAR-SLAM and even some classical visual odometry methods tuned for KITTI. DPV-SLAM (ECCV 2024) corrects this substantially (25.76 m avg vs. DROID-SLAM's 118.7 m avg on KITTI). If outdoor driving is the primary target, DPV-SLAM is the preferred descendant.

**9. No IMU integration.**
Unlike ORB-SLAM3-IMU or VINS-Mono, DROID-SLAM does not fuse inertial measurements. This limits applicability in fast-dynamics, high-vibration scenarios (e.g., taxiing aircraft, construction machinery). IMU must be fused externally in a multi-sensor estimator.

---

## Domain Fit

| Domain | Fit | Key Constraints |
|--------|-----|----------------|
| Indoor rooms / labs (RGB-D) | Good | Designed for this; ETH3D, TUM-RGBD, Replica representative. Enough texture, stable lighting. |
| Indoor MAV / drone | Good | EuRoC-representative; stereo preferred for metric scale. |
| Road AV (offline benchmark) | Moderate | KITTI underperformance corrected in DPV-SLAM; use as learned-SLAM baseline. |
| Road AV (production primary) | Not suitable | GPU contention, no IMU, scale drift, no certified covariance output. |
| Warehouse (indoor, structured) | Moderate | Dynamic fork trucks need masking; texture on shelving helps; corridor repetition risks false loops. |
| Airside survey (visual cross-check) | Conditional | See aggregated-map section; stereo or RGB-D only; dynamic masking required; LiDAR as primary. |
| Airside survey (primary localization) | Not suitable | Texture-less aprons, dynamic aircraft/GSE, glare, monocular scale unacceptability. |
| Port / logistics yard (outdoor) | Research | Scale, texture, weather, large dynamic vehicles all stress camera-only methods. |
| Agriculture / construction | Not suitable | Outdoor scale, dynamic objects, vegetation, and weather exceed camera-only SLAM limits. |

---

## Aggregated-Map Suitability: The Honest Assessment

**DROID-SLAM is not a drop-in replacement for KISS-ICP or FAST-LIO2 in a LiDAR-primary airside stack.** It has no LiDAR data path. It cannot serve as the primary localization front-end for an airside survey vehicle relying on LiDAR-registered maps in GPS-denied apron environments. It is not the method of choice for ATE-metric pose accuracy on long outdoor trajectories without GPS or external scale.

Its value in an airside or AV stack is precise and limited to three legitimate roles:

**Role A — Visual cross-check of LiDAR SLAM.** Run DROID-SLAM (or the more calibration-tolerant MASt3R-SLAM) on onboard camera streams in parallel with KISS-ICP or FAST-LIO2 on LiDAR. Compare 6-DOF trajectories continuously: large divergence between the two trajectory streams signals LiDAR degeneration (e.g., open apron with few vertical LiDAR-returnable features) or camera failure (glare, rain, dynamic-scene flooding). This cross-check role does not require DROID-SLAM to be metrically accurate — it requires it to be independently corrupted so that joint failure of both streams is improbable.

**Role B — Dense tracking front-end for 3DGS survey layer.** For high-fidelity visual survey beyond the point cloud, DROID-SLAM's dense per-pixel depth and pose output feeds a 3DGS back-end (as in DROID-Splat or Splat-SLAM). The result is a photorealistic 3D model of gates, stands, ground markings, and equipment — complementing the metric point cloud from LiDAR with appearance. LiDAR provides the metric anchor; DROID-SLAM/3DGS provides the visual layer. See [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) for the downstream use of such hybrid maps, and [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md) for the 3DGS geometry background.

**Role C — Reference baseline for benchmark comparisons.** When evaluating any new visual or visual-LiDAR SLAM variant on airside datasets, DROID-SLAM is the standard learned-SLAM baseline to compare against — as ORB-SLAM3 is the standard classical baseline.

**Airside risk flags when using DROID-SLAM in any capacity:**

- **Texture-less concrete aprons.** Large uniform apron surfaces are the worst case for the correlation pyramid — feature encoder produces non-discriminative features; GRU correspondences diverge.
- **Dynamic objects.** Aircraft moving on taxiways, ground support vehicles, jetways rotating, and baggage streams all violate the rigid-scene assumption underlying DBA.
- **Glare and reflections.** Intense sunlight on aircraft fuselage and glass saturates pixel values; bilinear sampling in the correlation volume degrades on saturated regions.
- **Scale ambiguity.** Monocular mode with no external scale is unacceptable for metric mapping even when trajectory shape is qualitatively correct. Stereo or RGB-D is required for any metric application.

If deployed in an airside stack, DROID-SLAM must be run in stereo or RGB-D mode, with explicit dynamic-object masking applied before flow estimation, and with LiDAR SLAM as the authoritative primary localization source.

---

## Implementation Notes

- Use the official repository (<https://github.com/princeton-vl/DROID-SLAM>, BSD-3-Clause license) as the method reference. Community Docker files exist but dependency pinning (PyTorch, CUDA, lietorch, pytorch_scatter) is required for reproducibility.
- The repository includes evaluation scripts for EuRoC, TUM-RGBD, ETH3D, and KITTI. Use these before any custom dataset adaptation to confirm a correct baseline.
- When evaluating monocular results, align trajectory with Sim(3) (scale-free) rather than SE(3) to report meaningful ATE. Penalizing scale in monocular evaluation conflates scale drift with pose error.
- DROID-SLAM is not ROS-native. Integration into a ROS2 stack requires defining coordinate frame conventions (body frame, camera frame, world frame), timestamp behavior (frontend latency vs. backend latency), covariance/quality output format, and failure gating (track reset detection).
- The asynchronous two-thread mode (frontend on one GPU, backend on a second) is non-deterministic but produces better results than single-thread mode. For offline evaluation, accept non-determinism; for reproducible ablation studies, disable asynchronous mode.
- For airside use: run in shadow mode against RTK-GNSS, LiDAR scan-to-map, wheel odometry, and a classical VIO baseline. Monitor frame rate, GPU memory, graph size, tracking resets, trajectory discontinuities, and disagreement against other sensors. Log raw images and calibration so failures can be replayed.
- Apply semantic dynamic-object masking (aircraft, vehicles, pedestrians) before or during flow estimation to reduce dynamic-scene pollution of the DBA objective.
- For follow-on dense reconstruction: DROID-Splat and Splat-SLAM are the most production-adjacent integrations of DROID-style tracking with 3DGS rendering. For LiDAR-primary geometry, use Gaussian-LIC or LVI-GS instead.
- Memory management: periodically marginalize old keyframes to keep GPU memory bounded. The default repository configuration does not aggressively marginalize; long sequences will exhaust 11 GB without tuning the marginalization window.
- If KITTI outdoor performance matters, use DPV-SLAM instead of DROID-SLAM directly — it reduces KITTI average error from 118.7 m to 25.76 m while using 4× less memory and running 2.5× faster.

---

## Sources

### Primary Papers and Repositories

- Teed and Deng. "DROID-SLAM: Deep Visual SLAM for Monocular, Stereo, and RGB-D Cameras." NeurIPS 2021 (oral). arXiv: <https://arxiv.org/abs/2108.10869>
- NeurIPS 2021 proceedings: <https://proceedings.neurips.cc/paper/2021/hash/89fcd07f20b6785b92134bd6c1d0fa42-Abstract.html>
- NeurIPS 2021 oral session: <https://neurips.cc/virtual/2021/oral/27265>
- Official GitHub: <https://github.com/princeton-vl/DROID-SLAM>

### RAFT (Lineage)

- Teed and Deng. "RAFT: Recurrent All-Pairs Field Transforms for Optical Flow." ECCV 2020 (Best Paper). arXiv: <https://arxiv.org/abs/2003.12039>
- RAFT GitHub: <https://github.com/princeton-vl/RAFT>

### Follow-Up Family

- Teed et al. "Deep Patch Visual Odometry." NeurIPS 2023. arXiv: <https://arxiv.org/abs/2208.04726>. GitHub: <https://github.com/princeton-vl/DPVO>. NeurIPS page: <https://neurips.cc/virtual/2023/poster/70997>
- Lipson, Teed, and Deng. "Deep Patch Visual SLAM." ECCV 2024. arXiv: <https://arxiv.org/abs/2408.01654>. HTML: <https://arxiv.org/html/2408.01654v1>
- Homeyer et al. "DROID-Splat: Combining end-to-end SLAM with 3D Gaussian Splatting." ICCVW NeuSLAM 2025. arXiv: <https://arxiv.org/abs/2411.17660>. GitHub: <https://github.com/ChenHoy/DROID-Splat>
- Sandström et al. "Splat-SLAM: Globally Optimized RGB-only SLAM with 3D Gaussians." CVPR 2025W. arXiv: <https://arxiv.org/abs/2405.16544>. GitHub: <https://github.com/google-research/Splat-SLAM>
- Murai et al. "MASt3R-SLAM: Real-Time Dense SLAM with 3D Reconstruction Priors." CVPR 2025 Highlight. arXiv: <https://arxiv.org/abs/2412.12392>

### Datasets, Benchmarks, and External Studies

- TartanAir dataset: <https://theairlab.org/tartanair-dataset/>
- EuRoC MAV dataset: <https://projects.asl.ethz.ch/datasets/doku.php?id=kmavvisualinertialdatasets>
- TUM RGB-D dataset: <https://cvg.cit.tum.de/data/datasets/rgbd-dataset>
- ETH3D benchmark: <https://www.eth3d.net/>
- KITTI Odometry: <https://www.cvlibs.net/datasets/kitti/eval_odometry.php>
- MINI-DROID-SLAM replication (PMC): <https://pmc.ncbi.nlm.nih.gov/articles/PMC12431227/>
- ScaleMaster benchmark (monocular scale failure, 200+ m): arXiv 2602.18174
- DROID-SLAM in the Wild (dynamic scenes): arXiv 2603.19076

### Internal Cross-Links

See the Related docs line at the top of this page for the full link list. Key relationships: [Splat-SLAM](splat-slam.md) (iter-18) and [MASt3R-SLAM](mast3r-slam.md) (iter-24) are the primary system-level comparators; [KISS-ICP](kiss-icp.md) (iter-20) and [FAST-LIO / FAST-LIO2](fast-lio-fast-lio2.md) (iter-22) are the LiDAR-primary front-ends that DROID-SLAM cross-checks; [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md) (iter-16), [Camera Projective Geometry — PnP and Triangulation](../../../10-knowledge-base/geometry-3d/camera-projective-geometry-pnp-triangulation.md) (iter-15), and [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) (iter-14) are the foundational geometry KB pages referenced inline above.
