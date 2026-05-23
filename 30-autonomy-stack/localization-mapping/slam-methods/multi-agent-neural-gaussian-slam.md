# Multi-Agent Neural and Gaussian SLAM

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method-family"
  stage: "modern-core"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "validation", "runtime-localization"]
  reason: "Multi-Agent Neural and Gaussian SLAM is rated for robust or collaborative backend design in multi-session SLAM and validation."
method-priority:end -->

Related docs: [Distributed Multi-Robot PGO](distributed-multi-robot-pgo.md) · [COVINS / COVINS-G](covins-covins-g.md) · [Kimera-Multi](kimera-multi.md) · [CO-SLAM / ESLAM](co-slam-eslam.md) · [Gaussian SLAM / MonoGS](gs-slam-monogs.md) · [SplaTAM](splatam.md) · [Splat-SLAM](splat-slam.md) · [GigaSLAM](gigaslam.md) · [MASt3R-SLAM](mast3r-slam.md) · [DROID-SLAM](droid-slam.md) · [NeRF-SLAM](nerf-slam.md) · [D2-SLAM](d2slam.md) · [Loop Closure and Place Recognition](loop-closure-place-recognition.md) · [Learned LiDAR Place Recognition](learned-lidar-place-recognition.md) · [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md) · [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md)

**Last updated:** 2026-05-24

---

## What It Is

**Multi-agent neural Gaussian SLAM** is a family of SLAM systems in which N robots each run a local neural-implicit or 3D Gaussian Splatting (3DGS) front-end, then combine their per-robot submaps into a single globally consistent dense representation. There is no single canonical paper — the literature is distributed across at least six concurrent research threads that appeared between NeurIPS 2023 and mid-2026, each claiming "first" status along a different dimension. The survey (Nguyen et al., arXiv 2510.23988, October 2025) is the best current aggregator and explicitly notes that "none of the existing datasets fully capture requirements for benchmarking collaborative Gaussian SLAM."

This page covers the full family: CP-SLAM (first complete pipeline, NeurIPS 2023), MAGiC-SLAM (centralized 3DGS, CVPR 2025), MAC-Ego3D (consensus-based 3DGS, CVPR 2025), GRAND-SLAM (first outdoor multi-agent 3DGS, RA-L 2025), MNE-SLAM (distributed peer-to-peer implicit, CVPR 2025), and Coko-SLAM (bandwidth-reduction focus, arXiv April 2026). Each addresses a distinct sub-problem. No single system addresses all four.

**Research stage.** All surveyed systems operate on RGB-D (or in one case RGB-only) indoor sequences. LiDAR-primary multi-agent Gaussian SLAM does not exist as a published system as of mid-2026. For multi-vehicle outdoor survey the production-grade choices remain classical multi-robot SLAM: Swarm-SLAM (RA-L 2024) or Kimera-Multi (T-RO 2022), both with LiDAR-capable front-ends.

---

## Historical Context

Single-agent 3DGS-SLAM (SplaTAM, GS-SLAM, MonoGS — all CVPR 2024) demonstrated that an explicit Gaussian map can serve as the online reconstruction target in a tracking-and-mapping loop. Those first-wave systems were limited to room-scale, loop-closure-free, single-camera operation. The multi-agent extension asks a harder question: can N independently operating robots merge their Gaussian submaps into one coherent global scene?

The attempt at an answer arrived quickly. CP-SLAM (NeurIPS 2023) predated the first-wave single-agent systems and established the baseline pipeline with a neural-point (not 3DGS) representation. By CVPR 2025, at least three 3DGS multi-agent papers appeared simultaneously: MAGiC-SLAM, MAC-Ego3D, and MNE-SLAM. GRAND-SLAM (RA-L 2025) then became the first to show outdoor results. Coko-SLAM (April 2026) followed with the first explicit bandwidth-budget treatment.

For the 3DGS rendering model underlying all of these see [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md) and the single-agent systems [GS-SLAM and MonoGS](gs-slam-monogs.md) and [GigaSLAM](gigaslam.md). For the Lie-algebra mathematics used in pose-graph optimization see [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md).

---

## Core Technical Idea

Multiple robots simultaneously build local neural or Gaussian maps. The goal is a single globally consistent dense map suitable for novel-view synthesis, inspection, and digital-twin construction. Four central challenges govern every design decision in this family.

**Challenge 1 — Communication bandwidth.** A 3DGS submap for a single room contains millions of Gaussians, each described by a 3D mean, a 6-parameter covariance, an opacity scalar, and spherical-harmonic color coefficients. Raw submap size: 50–100 MB per room. At multiple submaps per robot per session, naive transmission saturates any WiFi link and is impractical even on wired networks for large fleets. Neural-implicit (NeRF / hash-grid) representations are even heavier: the per-scene MLP or feature-grid block is not transmissible in real time.

**Challenge 2 — Cross-robot map alignment.** Until two robots find a relative SE(3) transform T_{ij} connecting their local coordinate frames, their submaps cannot be fused. This "rendezvous detection" or "inter-robot loop closure" problem requires detecting when two robots have observed the same region. In Gaussian SLAM the map is a rendering-optimized object, not a feature-sparse graph, so detection must operate on rendered images or extracted point clouds rather than directly on Gaussian parameters.

**Challenge 3 — Map fusion under representation overlap.** When two robots have independently reconstructed the same corridor, their Gaussians representing it have different densities, different initializations, and different SH coefficients. Naive concatenation creates double-density artifacts and inflates memory. Reconciliation requires a visibility or depth-consistency test to identify and prune co-located redundant Gaussians.

**Challenge 4 — Global pose-graph consistency.** After inter-robot loop closures are detected, all submap poses must be corrected jointly via distributed or centralized pose-graph optimization (PGO). Rigidly transforming a Gaussian submap after PGO — updating means and covariances — corrects geometry but does not correct the SH color coefficients that were optimized in the old frame. Novel-view synthesis quality degrades after large corrections and may require a fine-tuning pass.

---

## Family Survey

### CP-SLAM — NeurIPS 2023 (Neural Point, not 3DGS)

**Citation:** Jiarui Hu, Mao Mao, Hujun Bao, Guofeng Zhang, Zhaopeng Cui. "CP-SLAM: Collaborative Neural Point-based SLAM System." NeurIPS 2023.
**Links:** arXiv 2311.08013 · https://zju3dv.github.io/cp-slam/

**Representation:** Neural points — each 3D point carries a learnable feature vector anchored to a keyframe. Differentiable ray marching over the point field renders depth and color. This is not 3DGS and not a NeRF hash-grid; it is a distinct point-anchored neural feature representation.

**Architecture:** Each robot runs an odometry front-end on RGB-D input, producing a local submap (neural point cloud + keyframe poses). Inter-robot loop detection uses NetVLAD global descriptors; matched keyframes trigger submap fusion. The strategy is distributed-to-centralized: agents compute independently, then a central server fuses submaps by averaging shared MLPs (a federated learning step) and fine-tuning across all keyframes. Global refinement is a keyframe-centric bundle-adjustment-style PGO.

**Measured performance:**
- Disk per submap: ~54 MB; peak GPU per agent: ~9.7 GiB
- Mapping time per frame: ~16.95 s — far below real-time
- ReplicaMultiagent (2 agents) ATE RMSE: ~0.65 cm; PSNR: ~22.71 dB; SSIM: ~0.69

**Significance:** First complete multi-agent neural implicit SLAM with all four modules (odometry, loop detection, submap fusion, global refinement). Establishes the baseline against which all subsequent work is measured.

**Limitations:** Far below real-time, high GPU memory, centralized server required, no LiDAR support.

---

### MAGiC-SLAM — CVPR 2025 (3DGS, centralized)

**Citation:** Vladimir Yugay, Theo Gevers, Martin R. Oswald. "MAGiC-SLAM: Multi-Agent Gaussian Globally Consistent SLAM." CVPR 2025.
**Links:** arXiv 2411.16785 · https://github.com/VladimirYugay/MAGiC-SLAM

**Representation:** 3D Gaussian Splatting with rigidly deformable Gaussian submaps. The first complete 3DGS multi-agent SLAM system.

**Architecture:**
- Per-agent front-end: local tracking + mapping on RGB-D stream; a new submap is triggered every 50 frames (Replica) or 20 frames (Aria).
- Communication trigger: on submap creation, the agent extracts DINOv2 features from the submap's first keyframe and transmits them to a central server along with the submap Gaussians. Critically, only Gaussians invisible in the current camera frustum (opacity near zero) are dispatched, reducing bandwidth.
- Central server: receives features → retrieves top-k nearest-neighbor submaps via DINOv2 cosine similarity → coarse-to-fine registration using FPFH features + ICP on rendered / depth point clouds → PGO with G2O (Gauss-Newton), minimizing a weighted sum of squared SE(3) residuals.
- Map fusion: corrected poses are applied as rigid transforms to Gaussian parameters (means and covariances), followed by a 3 000-iteration fine-tuning pass to remove double-density artifacts.

**Measured performance:**
- Disk per submap: ~54 MB; GPU per agent: ~1.12 GiB (vs CP-SLAM 9.7 GiB — 8.7× lower)
- Mapping time: ~0.71 s/frame (vs CP-SLAM 16.95 s/frame — 24× faster)
- ReplicaMultiagent (2 agents): ATE RMSE **0.27 cm** (vs CP-SLAM 0.65 cm); PSNR **34.26 dB** (vs 22.71 dB); SSIM **0.97** (vs 0.69); Depth L1 **1.30 cm** (vs 22.98 cm)
- AriaMultiagent (3 agents, real-world): ATE RMSE **0.90 cm**; PSNR **22.61 dB**

**Failure modes acknowledged:** Sub-1 FPS tracking (not real-time); no dynamic-object handling; loop detection fails in textureless or repetitive environments; centralized server is single point of failure; scalability tested to 3 agents only; loop closure requires a reasonable initial relative pose estimate — Coko-SLAM (2026) explicitly addresses this gap.

---

### MAC-Ego3D — CVPR 2025 (3DGS, distributed consensus)

**Citation:** Xiaohao Xu, Feng Xue, Shibo Zhao, Yike Pan, Sebastian Scherer, Xiaonan Huang. "MAC-Ego3D: Multi-Agent Gaussian Consensus for Real-Time Collaborative Ego-Motion and Photorealistic 3D Reconstruction." CVPR 2025.
**Links:** arXiv 2412.09723 · https://github.com/Xiaohao-Xu/MAC-Ego3D

**Key distinction:** Consensus-based rather than PGO-based. Agents exchange compact vectorized image embeddings at communication interval T_comm; similarity score s(v_i, v_j) = dot product; if s > tau = 0.8, loop closure is detected. Gaussian correspondence matching then solves for a rigid transform T that minimizes weighted Euclidean distance between Gaussian means (covariance-weighted), replacing the FPFH+ICP registration pipeline used by MAGiC-SLAM and GRAND-SLAM.

**Intra-agent consistency:** Local coherence enforced by Mahalanobis-distance pose alignment — each observed point Gaussian must be consistent with the nearest map Gaussian within a Mahalanobis distance derived from the map covariances.

**Measured performance:**
- ReplicaMultiagent (2 agents): ATE RMSE **0.14 cm** (vs CP-SLAM 1.23 cm); PSNR **40.04 dB** (+10.71 dB vs CP-SLAM)
- Speed: 15× faster than prior SOTA at the time of publication

**Limitations:** Tested on 2 agents, single room only; multi-room association not addressed; outdoor mapping not explored; memory overhead for Gaussian storage requires compression for deployment.

---

### GRAND-SLAM — RA-L 2025 (3DGS, first outdoor multi-agent)

**Citation:** Annika Thomas, Aneesa Sonawalla, Alex Rose, Jonathan P. How. "GRAND-SLAM: Local Optimization for Globally Consistent Large-Scale Multi-Agent Gaussian SLAM." IEEE Robotics and Automation Letters, 2025.
**Links:** arXiv 2506.18885

**Significance:** First multi-agent 3DGS SLAM achieving outdoor, large-scale global consistency. Benchmarked on the Kimera-Multi outdoor dataset — the same dataset used to evaluate classical multi-robot SLAM — giving a direct comparison against the state of the art in that family.

**Architecture:**
- Submap initialization: a new submap is triggered when the pose exceeds a translation threshold d_max or rotation threshold theta_max relative to the submap origin. This bounds the active optimization area and enables scalability.
- Tracking: two-stage per submap — coarse frame-to-frame hybrid color-depth odometry, followed by frame-to-model refinement via rendering-based optimization in local frame (avoids gradient imbalance at large distances from world origin). Gaussian parameters are frozen during tracking.
- Loop closure (intra + inter robot): NetVLAD keyframe descriptors → top-k retrieval by cosine similarity with spatial baseline check → dense RGB-D registration (hybrid depth-color loss) → point-to-plane ICP → quality filter on fitness and inlier RMSE.
- PGO: GTSAM Levenberg-Marquardt minimizing the SE(3) log-map norm of relative pose residuals weighted by edge information matrices (see Operator Mechanics section). After PGO, submaps are rigidly transformed to the global frame.

**Measured performance:**
- ReplicaMultiagent: ATE RMSE **0.25 cm** (comparable to MAGiC-SLAM 0.26 cm); PSNR **41.35 dB** (vs MAGiC-SLAM 34.26 dB — +28%)
- Kimera-Multi outdoor: ATE RMSE **4.99 m** (vs MAGiC-SLAM 60.79 m — 91% lower; vs ORB-SLAM3 10.58 m — better); PSNR **27.44 dB** (vs 15.88 dB); SSIM **0.97** (vs 0.50)

**Limitations:** Communication overhead is uncharacterized — the authors identify compression as future work. No LiDAR; relies on visual texture for loop closure. The 91% outdoor ATE improvement is the single largest performance gap reported in this literature, but the system is still RGB-D only.

---

### MNE-SLAM — CVPR 2025 (Neural implicit, distributed peer-to-peer)

**Citation:** Tianchen Deng et al. "MNE-SLAM: Multi-Agent Neural SLAM for Mobile Robots." CVPR 2025, pp. 1485–1494.
**Links:** CVF open access · https://github.com/dtc111111/MNESLAM

**Representation:** Neural implicit with two-scale parametric-coordinate encoding — avoids the cubic memory growth of voxel grids by encoding scene features at coarse and fine scales separately. Not 3DGS.

**Architecture:** Fully distributed, peer-to-peer communication only with no central server. Intra-to-inter loop closure: intra-robot loop closure first achieves local consistency per agent; inter-robot loops detected via matched keyframe features then trigger cross-agent submap alignment. Multi-submap fusion proceeds via online distillation in which knowledge is transferred between neural fields, avoiding naive parameter averaging.

**Dataset contribution:** Introduces the first real-world indoor neural SLAM (INS) dataset with ground-truth 3D mesh and continuous-time camera trajectory covering both single- and multi-agent scenarios at room-to-large-scale.

**Significance:** The only published paper in this family claiming fully peer-to-peer (no server) architecture. Important for deployments where a central server is impractical.

**Follow-on — MCN-SLAM (arXiv June 2026):** The same lead author published MCN-SLAM (arXiv 2506.18678) with a triplane-grid hybrid representation and a new Dense SLAM Dataset (DES). These are distinct papers; MCN-SLAM is the 2026 follow-on and is preprint only as of mid-2026.

---

### Coko-SLAM — arXiv April 2026 (3DGS, bandwidth-first)

**Citation:** Monica M.Q. Li, Pierre-Yves Lajoie, Jialing Liu, Giovanni Beltrame. "Compact Keyframe-Optimized Multi-Agent Gaussian Splatting SLAM." arXiv 2604.00804, April 2026.
**Links:** arXiv 2604.00804 · https://github.com/lemonci/coko-slam

**Key contribution:** The first system to treat bandwidth reduction as the primary design objective, formalizing Gaussian compaction as a constrained optimization problem. The GaussianSPA step uses a Lagrangian dual formulation: alternating optimization and sparsification via proximal operators, active from iteration 700–950 of 1 000 mapping iterations. Keyframe selection uses DINOv2-Small features with a minimum feature-distance threshold that replaces environment-specific heuristics.

**Loop closure without initial pose estimate:** Unlike MAGiC-SLAM, Coko-SLAM does not require an initial relative pose between robots. Two modes: rendered-depth (renders depth from Gaussians → point cloud → FPFH + RANSAC + ICP) and camera-depth (uses stored depth for additional Gaussian pruning of co-visible points).

**Measured bandwidth (per-submap transmission):**

| Dataset | Coko-SLAM (rendered-depth) | MAGiC-SLAM |
|---|---|---|
| Replica Office-0 | ~100 MB | ~2 050 MB |
| Aria Room0 | ~85 MB | ~540 MB |

Reduction: **85–95%** versus MAGiC-SLAM.

**Rendering quality (Replica):** PSNR 26.66–39.29 dB; SSIM 0.906–0.991 (vs MAGiC-SLAM SSIM ~0.295 in configurations without initial poses, where MAGiC-SLAM degrades substantially).

**Limitations:** Rendered-depth registration degrades at low camera resolution (e.g., 512×512 Aria images); centralized server still required; depth rendering is a compute bottleneck.

---

## Operator Mechanics

### Inter-Robot Rendezvous Detection

Agents detect spatial overlap via learned global descriptors. For DINOv2 or NetVLAD embeddings f_i and f_j:

```
s(i,j) = cosine(f_i, f_j) = (f_i · f_j) / (||f_i|| * ||f_j||)
```

A loop candidate is accepted if `s > tau_sim` and the spatial baseline `||t_i - t_j|| > delta_min`. The spatial baseline check prevents false positives between nearby robots in the same region that already share a relative transform estimate.

### SE(3) Alignment from Cross-Robot Keyframe Matches

Given point sets {p_k} from submap i and {q_k} from submap j (from ICP / FPFH+RANSAC correspondence):

```
T*_{ij} = argmin_{T in SE(3)}  sum_k  w_k * ||T p_k - q_k||^2
```

Closed-form via SVD on the weighted cross-covariance matrix `W = sum_k w_k (p_k - p_bar)(q_k - q_bar)^T`. Factor `W = U S V^T`, then `R = V U^T` and `t = q_bar - R p_bar`. This is the standard Procrustes / Umeyama alignment applied to 3D point sets. For the SE(3) Lie-algebra framing used in GTSAM-based PGO see [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md).

### Pose-Graph Optimization

PGO minimizes over all submap poses {T_i} in SE(3):

```
L_graph = sum_{(i,j) in E}  ||log(T_hat_{ij}^{-1} · T_i^{-1} · T_j)||^2_{Omega_{ij}}
```

where `T_hat_{ij}` is the measured relative transform from ICP/registration, `Omega_{ij}` is the information matrix (inverse covariance of measurement noise), and `log(·)` is the SE(3) logarithmic map yielding a 6-vector in R^6. GRAND-SLAM uses GTSAM Levenberg-Marquardt; MAGiC-SLAM uses G2O Gauss-Newton. See [Distributed Multi-Robot PGO](distributed-multi-robot-pgo.md) for the full treatment of distributed vs centralized PGO solvers used in classical multi-robot SLAM.

### Gaussian Rigid Transform After PGO

Given pose correction T_i^c in SE(3) for submap i (rotation R_i^c, translation t_i^c):

```
mu_k     <-  R_i^c * mu_k + t_i^c
Sigma_k  <-  R_i^c * Sigma_k * (R_i^c)^T
```

Spherical harmonic color coefficients encode view-dependent appearance in the old coordinate frame and must be rotated separately (applying the Wigner D-matrix for SH rotation) or re-optimized in a fine-tuning pass. This is the primary reason post-PGO rendering quality degrades after large corrections — the rendering loss must be minimized again to realign appearance with the corrected geometry.

### Bandwidth-Efficient Gaussian Summary

MAGiC-SLAM: transmit only Gaussians with opacity `o < epsilon_invisible` (not rendered in current frustum) — a frustum-culling-based selection that reduces transmission to geometrically novel submaps.

Coko-SLAM: Lagrangian Gaussian compaction — minimize rendering loss subject to a Gaussian count budget K:

```
min_{Theta}  L_render(Theta) + lambda * max(|Theta| - K, 0)
```

solved by proximal alternating optimization. Active from iteration 700–950 of 1 000 mapping iterations. Reduces submap size 85–95% versus naive transmission. The dual variable lambda adjusts automatically to enforce the sparsity budget.

---

## Inputs and Outputs

**Per-robot inputs:**
- RGB-D stream (color + registered depth) — all published systems except MAGS-SLAM (2026, RGB only)
- Known camera intrinsics
- GPU with CUDA (most systems: RTX 4090 or equivalent; minimum ~10 GiB VRAM per agent)

**Communication channel:**
- Keyframe descriptor embeddings (DINOv2 / NetVLAD feature vectors) — low bandwidth
- Compressed Gaussian submaps — 85–2 050 MB per submap depending on system and compaction setting
- Loop closure transform estimates and confidence scores
- Corrected pose broadcasts from server back to agents (centralized systems)

**Outputs per robot:**
- Per-robot SE(3) trajectory in a shared global frame (ATE RMSE metric)

**Shared joint map outputs:**
- Globally consistent 3DGS or neural-implicit map supporting novel-view synthesis
- Per-submap corrected poses after PGO
- Rendered RGB, depth, and silhouette images at any registered viewpoint

---

## Architecture

```
Per-Robot Front-End (RGB-D or RGB)
    |
    +-- Tracking: rendering-based or ICP-based pose estimation
    +-- Mapping: Gaussian / neural-implicit submap construction
    +-- Keyframe selection: distance / overlap threshold
    +-- Descriptor extraction: DINOv2 / NetVLAD embeddings
         |
         v
Inter-Robot Communication Layer
    |
    +-- Descriptor exchange --> overlap detection (cosine similarity)
    +-- Submap transmission (frustum-culled or Lagrangian-compacted Gaussians)
    +-- Loop closure registration: FPFH+RANSAC --> ICP --> SE(3) T_{ij}
         |
         v
Central Server (CP-SLAM / MAGiC-SLAM / GRAND-SLAM / Coko-SLAM)
OR Distributed Coordinator (MAC-Ego3D / MNE-SLAM)
    |
    +-- Pose-graph construction + optimization (GTSAM / G2O)
    +-- Corrected pose broadcast back to agents
    +-- Map fusion: rigid transform of Gaussians + fine-tuning / distillation
```

**Centralized systems** (CP-SLAM, MAGiC-SLAM, GRAND-SLAM, Coko-SLAM): a server handles PGO and fusion. More tractable for heavy neural optimization but constitutes a single point of failure. All currently published 3DGS multi-agent systems with the best benchmark results use centralized coordination.

**Distributed systems** (MAC-Ego3D, MNE-SLAM): peer-to-peer; consensus-based alignment; no server. More robust to server failure and more scalable in principle, but global consistency is harder to guarantee and current results cover only 2-agent single-room scenarios.

---

## Training and Optimization

Multi-agent neural Gaussian SLAM has four distinct optimization stages that must run in coordination across robots.

**Stage 1 — Per-robot local mapping.** Each agent minimizes the combined photometric and depth rendering loss over its RGB-D stream:

```
L_local = L1_photometric + lambda_depth * L1_depth + lambda_reg * L_regularizer
```

The regularizer is isotropic (penalizing anisotropic Gaussians) in monocular systems and absent or weaker in RGB-D systems. This is the standard single-agent 3DGS-SLAM objective (see [GS-SLAM and MonoGS](gs-slam-monogs.md) for full derivation).

**Stage 2 — Rendezvous detection + cross-robot alignment.** Cosine similarity on DINOv2 or NetVLAD keyframe descriptors triggers loop closure candidates. Each candidate is verified via point-cloud registration (FPFH+RANSAC or rendered-depth ICP), yielding a relative transform `T_{ij}` and an information matrix `Omega_{ij}` encoding registration confidence.

**Stage 3 — Global PGO.** All accepted inter-robot and intra-robot loop constraints are fused in a single PGO over the full submap pose graph. GTSAM or G2O minimize the SE(3) log-map residuals weighted by information matrices. Distributed PGO (DPGO, as used in Kimera-Multi) is an alternative for the MNE-SLAM / MAC-Ego3D class of systems. See [Distributed Multi-Robot PGO](distributed-multi-robot-pgo.md).

**Stage 4 — Map deformation and fine-tuning.** PGO-corrected poses are applied as rigid transforms to Gaussian means and covariances. Because SH color coefficients were optimized in the pre-correction frame, a 3 000-iteration fine-tuning pass (MAGiC-SLAM) or online distillation step (MNE-SLAM) re-minimizes the rendering loss in the corrected frame to restore appearance quality.

---

## Benchmark Results

### Datasets Used

| Dataset | Type | Agents | Sensor | Notes |
|---|---|---|---|---|
| ReplicaMultiagent | Synthetic indoor | 2 | RGB-D | Derived from Replica; Office-0, Apartments; primary indoor benchmark |
| ReplicaMultiagent Plus | Synthetic indoor | 2+ | RGB only | Introduced by MAGS-SLAM (2026) for monocular evaluation |
| AriaMultiagent | Real indoor | 3 | RGB-D (Project Aria) | Larger scale; used in MAGiC-SLAM |
| 7-Scenes | Real indoor | 1–2 | RGB-D | Small-scale real-world check |
| Kimera-Multi outdoor | Real outdoor | 2 | Stereo + IMU | ~800 m trajectories; large-scale; originally classical multi-robot SLAM benchmark |
| INS dataset | Real indoor | multi | RGB-D | Introduced by MNE-SLAM (CVPR 2025); single + multi-agent |
| DES (Dense SLAM) | Real indoor + outdoor | multi | RGB-D | Introduced by MCN-SLAM (2026) |
| S3E | Real multi-robot | multi | LiDAR + camera + IMU | Air-ground heterogeneous; none of the surveyed neural/Gaussian systems use it |

The survey (arXiv 2510.23988) explicitly concludes: "None of the existing datasets fully capture requirements for benchmarking collaborative Gaussian SLAM" — gaps include outdoor scale, heterogeneous sensors, and long-duration sequences.

### Metrics

- **Per-robot ATE RMSE (cm or m):** absolute trajectory error versus ground truth; primary localization metric.
- **Joint-map consistency:** multi-agent ATE after PGO correction; tests whether cross-robot loop closures produce correct global alignment.
- **Rendering quality:** PSNR (dB), SSIM, LPIPS on training views and novel views.
- **Depth L1 (cm):** geometric accuracy of reconstructed depth map.
- **Communication bandwidth:** total MB transmitted per agent or per submap; reduction ratio versus baseline.
- **Runtime:** seconds per frame for tracking, mapping, merging, and PGO.

### Head-to-Head Comparison (ReplicaMultiagent, 2 agents)

| System | ATE RMSE (cm) | PSNR (dB) | SSIM | Disk/submap (MB) | GPU/agent (GiB) | Map time (s/frame) |
|---|---|---|---|---|---|---|
| CP-SLAM (NeurIPS 2023) | 0.65 | 22.71 | 0.69 | ~54 | ~9.7 | ~16.95 |
| MAGiC-SLAM (CVPR 2025) | 0.27 | 34.26 | 0.97 | ~54 | ~1.12 | ~0.71 |
| MAC-Ego3D (CVPR 2025) | 0.14 | 40.04 | — | — | — | ~0.07 (tracking) |
| GRAND-SLAM (RA-L 2025) | 0.25 | 41.35 | — | — | — | — |
| Coko-SLAM (2026, rendered-depth) | — | 26.66–39.29 | 0.906–0.991 | ~100 | — | — |

### Outdoor Comparison (Kimera-Multi outdoor dataset)

| System | ATE RMSE (m) | PSNR (dB) | SSIM |
|---|---|---|---|
| MAGiC-SLAM | 60.79 | 15.88 | 0.50 |
| ORB-SLAM3 | 10.58 | — | — |
| **GRAND-SLAM** | **4.99** | **27.44** | **0.97** |

GRAND-SLAM's 91% lower ATE versus MAGiC-SLAM on the outdoor dataset is the largest performance gap in the literature. However, GRAND-SLAM's bandwidth overhead on the outdoor dataset is not reported.

---

## Classical Multi-Robot SLAM Context

Understanding where multi-agent neural Gaussian SLAM sits requires comparison with the mature classical multi-robot SLAM family.

| System | Modality | Architecture | Key feature |
|---|---|---|---|
| CCM-SLAM (Schmuck & Chli, JFR 2019) | Monocular | Centralized | First multi-UAV collaborative monocular SLAM; ORB-SLAM2 agents offload to server |
| COVINS / COVINS-G (ETH, 2021/2023) | Visual-Inertial | Centralized server, generic front-end | Any VIO front-end; multi-camera relative pose for loop closure |
| Kimera-Multi (Tian et al., T-RO 2022) | Stereo-inertial | Fully distributed | Dense metric-semantic 3D mesh; DPGO back-end; robust to outlier loops; T-RO Best Paper 2022 |
| Swarm-SLAM (Lajoie & Beltrame, RA-L 2024) | LiDAR / stereo / RGB-D | Fully decentralized | Sparse, ROS 2, multi-sensor, inter-robot loop closure prioritization; 5 datasets + real 3-robot |
| DPGO (Tian et al., T-RO 2021) | Back-end only | Distributed | Certifiably correct distributed PGO; used as back-end in Kimera-Multi |

See [Kimera-Multi](kimera-multi.md), [COVINS / COVINS-G](covins-covins-g.md), and [Distributed Multi-Robot PGO](distributed-multi-robot-pgo.md) for full treatments.

**How neural/Gaussian variants differ from classical:**

1. **Map density:** Classical multi-robot SLAM stores sparse keyframe pose graphs and feature maps (megabytes total). Neural/Gaussian SLAM stores dense appearance submaps (tens to hundreds of MB per submap). This is the core bandwidth tension.

2. **Loop closure inputs:** Classical methods use binary descriptors (BoW, DBoW3) on raw keyframes. Neural/Gaussian methods use learned global descriptors (DINOv2, NetVLAD) on rendered or stored images plus ICP on rendered point clouds.

3. **Map representation after fusion:** Classical → sparse 3D mesh or point cloud, usable for geometric navigation. Neural/Gaussian → photorealistic splat or NeRF supporting novel-view synthesis — useful for inspection but not needed for geometry-only navigation.

4. **Maturity:** Classical multi-robot SLAM (Swarm-SLAM, Kimera-Multi) has ROS 2 integrations, real-robot deployments, and outdoor evaluation at hundreds of meters. Neural/Gaussian multi-agent SLAM is largely synthetic-dataset research (2024–2026); outdoor results exist only from GRAND-SLAM on a ~100 m scale dataset.

5. **Sensor:** Classical systems — especially Swarm-SLAM — natively support LiDAR front-ends. No neural/Gaussian multi-agent SLAM system as of mid-2026 has a LiDAR-primary front-end.

---

## Variants and Lineage

The family tree from classical multi-robot SLAM to the current generation:

```
Classical sparse multi-robot SLAM (ORB-SLAM2 multi-agent, CCM-SLAM, ~2016-2019)
    |
    +-- Classical dense multi-robot SLAM: Kimera-Multi, COVINS (2021-2022)
    |   LiDAR/VIO front-ends; distributed PGO back-end; sparse-to-semi-dense maps
    |
    +-- Neural-implicit collaborative: CP-SLAM (NeurIPS 2023)
    |   Point-anchored neural features; first complete collaborative neural pipeline
    |
    +-- 3DGS single-agent: SplaTAM, GS-SLAM, MonoGS (CVPR 2024)
    |   Explicit Gaussian primitives; room-scale; no loop closure
    |
    +-- 3DGS single-agent with loop closure: Splat-SLAM, LoopSplat (2024-2025)
    |   Adds pose-graph correction to single-agent Gaussian systems
    |
    +-- 3DGS multi-agent: MAGiC-SLAM, MAC-Ego3D, GRAND-SLAM,
        MNE-SLAM, Coko-SLAM (CVPR 2025 / RA-L 2025 / arXiv 2026)
        Explicit Gaussian submaps; inter-robot loop closure; PGO or consensus fusion
```

The most direct single-agent precursors are [GS-SLAM and MonoGS](gs-slam-monogs.md) (iter 26) and [GigaSLAM](gigaslam.md) (iter 29). GigaSLAM's hierarchical LoD submap architecture is conceptually relevant for handling large-scale outdoor multi-agent scenes, though no multi-agent extension of GigaSLAM exists yet. For loop closure methods that underpin inter-robot rendezvous detection see [Loop Closure and Place Recognition](loop-closure-place-recognition.md) (iter 28) and [Learned LiDAR Place Recognition](learned-lidar-place-recognition.md) (iter 18).

---

## Strengths

**Collaborative scene coverage.** Multiple robots cover a large area faster than a single robot, and jointly reconstruct areas that no individual robot's trajectory fully observes.

**Photorealistic shared map.** The shared 3DGS map supports novel-view synthesis — useful for inspection (visual comparison across survey runs), synthetic data generation, and digital twin visualization in a way that sparse point clouds do not.

**Rich appearance representation with concrete bandwidth handles.** The Gaussian explicit representation is differentiable and prunable. Frustum culling (MAGiC-SLAM) and Lagrangian compaction (Coko-SLAM) reduce submap sizes by 85–95%, giving concrete engineering levers unavailable in NeRF-based approaches.

**PGO back-end is shared with classical SLAM.** The pose-graph optimization used by GRAND-SLAM (GTSAM), MAGiC-SLAM (G2O), and Kimera-Multi (DPGO) is mathematically identical — the same SE(3) log-map residuals and information matrix weighting. Teams familiar with classical multi-robot SLAM can reuse the entire PGO module and need only swap the front-end representation.

**Growing benchmark coverage.** With GRAND-SLAM's Kimera-Multi outdoor evaluation, the family now has a direct comparison point against classical multi-robot SLAM on a shared outdoor dataset.

---

## Failure Modes

| Failure mode | Mechanism | Severity |
|---|---|---|
| Communication-bandwidth bottleneck | Even with 85–95% compaction, multi-vehicle survey of a large space generates gigabytes; no system measures continuous streaming | Critical for outdoor fleet |
| Rendezvous-detection sensitivity | If two robots never share overlapping views (textureless tarmac, non-overlapping sectors), no loop closure detectable; submaps remain in disjoint frames | Critical for outdoor survey |
| No LiDAR support | All surveyed systems assume RGB-D or stereo RGB input; no LiDAR-primary front-end exists | Critical for industrial deployment |
| RGB-D depth range limitation | Active depth sensors (RealSense, Kinect) saturate at 5–10 m; useless for outdoor survey ranges | Critical for airside |
| Post-PGO rendering degradation | Rigid transform corrects geometry but SH color coefficients optimized in old frame degrade novel-view quality; requires fine-tuning | Moderate for inspection |
| Sub-real-time mapping | MAGiC-SLAM: 0.71 s/frame; CP-SLAM: 16.95 s/frame; only MAC-Ego3D approaches real-time for tracking (~0.07 s/frame) | High for online deployment |
| Scalability ceiling | All results involve 2–3 agents on indoor sequences of minutes; no published evaluation of 10+ agents or kilometer-scale outdoor | High for fleet use |
| Centralized server dependency | MAGiC-SLAM, GRAND-SLAM, Coko-SLAM require a server; server failure = no global consistency | Moderate for resilient systems |
| Dynamic object corruption | No surveyed system includes dynamic-object masking; moving objects contaminate map and tracking loss | Very high for airside GSE |
| Scale ambiguity (monocular) | RGB-only systems (MAGS-SLAM) require additional geometric priors for cross-agent metric alignment | High for metric accuracy |

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Indoor terminal / hangar (offline appearance) | Conditional | Most viable application; RGB-D range matches; use LiDAR for poses |
| Indoor hangar (multi-robot inspection) | Research | Useful after LiDAR survey; appearance re-mapping with coordinated robots |
| Airside apron (primary multi-vehicle SLAM) | Not suitable | No LiDAR, sub-real-time, RGB-D range too short, dynamic GSE |
| Outdoor large-scale survey | Research only | GRAND-SLAM shows feasibility at ~100 m; not production-grade |
| Warehouse multi-robot mapping | Research | Classical multi-robot SLAM is more mature and LiDAR-compatible |
| Port / logistics-yard survey | Not suitable | Scale and LiDAR requirements match classical systems better |
| Road AV digital twin | Research | GigaSLAM is the relevant single-agent reference at km scale |
| Agriculture / construction outdoor | Not suitable | Weather, vegetation, scale all exceed system capabilities |
| Delivery robot (indoor, shared map) | Research | Most plausible deployment context; scale fits; GPU budget is a concern |

---

## Aggregated-Map Suitability: The Honest Assessment

Multi-agent neural Gaussian SLAM is research-stage RGB-D work. For an airside multi-vehicle LiDAR survey, it is not a production-grade choice for four structural reasons:

1. **LiDAR geometry is the survey deliverable, not RGB appearance.** Neural Gaussian maps optimize for photometric rendering quality; LiDAR-primary pipelines (LIO-SAM, FAST-LIO2, LiLi-OM) produce direct georeferenced point clouds without neural optimization overhead and at a fraction of the GPU cost.

2. **Classical multi-robot SLAM is production-ready for multi-vehicle survey.** Swarm-SLAM (RA-L 2024, open-source ROS 2) supports LiDAR + stereo + RGB-D, is fully decentralized, and has been tested on five datasets including real 3-robot experiments. Kimera-Multi handles outdoor 800 m trajectories with metric-semantic 3D mesh output. These are the correct technology choices for multi-vehicle airside survey.

3. **Scale mismatch.** Airside apron surveys span hundreds to thousands of meters. All neural/Gaussian multi-agent SLAM papers operate on submeter to tens-of-meters indoor scenes, with GRAND-SLAM as the single exception at ~100 m outdoor scale.

4. **No LiDAR front-end in any published system.** Multi-agent neural Gaussian SLAM as of mid-2026 is camera-only. The closest published outdoor result (GRAND-SLAM on Kimera-Multi outdoor) uses a dataset originally captured with stereo + IMU — a sensor modality that is itself inadequate for production airside survey.

**Recommended production path for multi-vehicle airside survey:**

```
Step 1: Classical multi-robot SLAM (Swarm-SLAM or Kimera-Multi + LiDAR front-end)
        + RTK/GNSS for global anchoring
        -> Globally consistent LiDAR point cloud (primary, metric-accurate)
        -> Distributed or centralized PGO back-end

Step 2 (optional — appearance layer):
        Per-vehicle cameras run 3DGS mapping using LiDAR-derived poses as ground truth
        -> Multi-agent 3DGS coordination can be applied here, with LiDAR decoupled
        -> Result: photorealistic Gaussian appearance layer registered to LiDAR geometry
        -> Use cases: digital twin visualization, inspection image comparison,
           synthetic training data, change detection

Combined output:
        Airport digital twin = LiDAR geometry (primary, safety-rated)
                             + 3DGS appearance layer (visualization, inspection)
        The two pipelines are decoupled: LiDAR for geometry/navigation,
        3DGS for appearance/visualization.
```

This decoupled architecture is consistent with how Gaussian-LIC and LVI-GS operate (LiDAR for geometry, cameras for appearance Gaussians) and can absorb any future multi-agent 3DGS advancement without requiring changes to the safety-critical LiDAR pipeline.

---

## Implementation Notes

- **Do not expect real-time operation.** MAGiC-SLAM maps at ~0.71 s/frame, CP-SLAM at ~16.95 s/frame. Only MAC-Ego3D reports near-real-time tracking (0.07 s/frame). Treat these as offline or slow-online mapping systems. Design data collection missions accordingly.
- **GPU budget per agent is substantial.** CP-SLAM requires ~9.7 GiB per agent; MAGiC-SLAM ~1.12 GiB. For a 3-agent setup on a shared server, budget at least 6–10 GiB for the coordination overhead plus per-agent maps. An RTX 4090 (24 GiB) handles 2–3 agents simultaneously in the MAGiC-SLAM configuration.
- **Centralized architecture is the current best-performing choice.** The distributed systems (MAC-Ego3D, MNE-SLAM) have been tested only at 2-agent single-room scale. For any multi-agent deployment with more than 2 robots, use a centralized architecture and accept the single-point-of-failure risk.
- **DINOv2 descriptor quality depends on visual texture.** Loop closure detection fails in textureless environments (uniform walls, apron concrete, painted runways). For indoor airport environments add GeM or NetVLAD fallback; for outdoor add scan-context-style geometric descriptors from LiDAR (see [Learned LiDAR Place Recognition](learned-lidar-place-recognition.md)).
- **Implement loop closure verification before map merging.** False inter-robot loop closures couple independent maps and are especially damaging — harder to detect and correct than single-agent false loops. Use point-to-plane ICP fitness + inlier RMSE thresholds (as in GRAND-SLAM) as a quality gate, and log all accepted/rejected loop candidates for audit.
- **Budget for fine-tuning after every PGO correction.** Rigid Gaussian transforms fix geometry but degrade appearance. MAGiC-SLAM's 3 000-iteration fine-tuning pass is the minimum to restore rendering quality. For inspection use cases where appearance matters, this cost must be factored into the mission timeline.
- **Custom CUDA rasterizer dependency pinning is critical.** All 3DGS systems inherit the tile-based CUDA rasterizer from Kerbl et al. (SIGGRAPH 2023). Version combinations outside the tested CUDA/PyTorch/driver set fail to compile or produce silent numerical errors. Pin versions tightly and document the tested configuration.
- **Agent identity and clock synchronization are first-class requirements.** Keyframe timestamps, agent IDs, and coordinate frame conventions must be consistent across all robots before attempting any submap fusion. Use a centralized timestamp authority or NTP-synchronized clocks with bounded drift.
- **No ROS 2 integration in any surveyed system.** All published implementations are research Python/PyTorch code without robot middleware integration. Significant engineering effort is required to bridge from paper code to a ROS 2-compatible deployment.
- **Evaluate per-agent ATE, bandwidth, loop false-positive rate, and recovery after communication loss as separate metrics.** Single aggregate ATE numbers hide the failure modes that matter most in deployment (communication failures, agent reconnection, partial loop closure detection).

---

## Sources

**Core papers:**
- CP-SLAM (NeurIPS 2023): https://arxiv.org/abs/2311.08013 — Hu, Mao, Bao, Zhang, Cui
- CP-SLAM project page: https://zju3dv.github.io/cp-slam/
- MAGiC-SLAM (CVPR 2025): https://arxiv.org/abs/2411.16785 — Yugay, Gevers, Oswald
- MAGiC-SLAM GitHub: https://github.com/VladimirYugay/MAGiC-SLAM
- GRAND-SLAM (RA-L 2025): https://arxiv.org/abs/2506.18885 — Thomas, Sonawalla, Rose, How
- MAC-Ego3D (CVPR 2025): https://arxiv.org/abs/2412.09723 — Xu, Xue, Zhao, Pan, Scherer, Huang
- MAC-Ego3D GitHub: https://github.com/Xiaohao-Xu/MAC-Ego3D
- Coko-SLAM (arXiv April 2026): https://arxiv.org/abs/2604.00804 — Li, Lajoie, Liu, Beltrame
- Coko-SLAM GitHub: https://github.com/lemonci/coko-slam
- MNE-SLAM (CVPR 2025): https://openaccess.thecvf.com/content/CVPR2025/html/Deng_MNE-SLAM_Multi-Agent_Neural_SLAM_for_Mobile_Robots_CVPR_2025_paper.html — Deng et al.
- MNE-SLAM GitHub: https://github.com/dtc111111/MNESLAM
- MCN-SLAM (arXiv June 2026): https://arxiv.org/abs/2506.18678 — Deng, Shen et al.
- MAGS-SLAM (arXiv May 2026): https://arxiv.org/abs/2605.10760 — Cao, Shao, Zhai, Zhang, Nguyen, Huang
- Di-NeRF (RA-L 2024): https://arxiv.org/abs/2402.01485 — Asadi, Zareinia, Saeedi

**Survey:**
- Collaborative GS-SLAM Survey (arXiv Oct 2025): https://arxiv.org/abs/2510.23988

**Classical multi-robot SLAM:**
- Kimera-Multi (T-RO 2022): https://arxiv.org/abs/2106.14386 · https://github.com/MIT-SPARK/Kimera-Multi
- Swarm-SLAM (RA-L 2024): https://arxiv.org/abs/2301.06230 · https://github.com/MISTLab/Swarm-SLAM
- COVINS-G (ICRA 2023): https://arxiv.org/abs/2301.07147 · https://github.com/VIS4ROB-lab/covins
- CCM-SLAM (JFR 2019): https://github.com/VIS4ROB-lab/ccm_slam
- DPGO (T-RO 2021): https://github.com/mit-acl/dpgo_ros
