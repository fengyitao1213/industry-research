# GigaSLAM: Large-Scale Monocular SLAM with Hierarchical Gaussian Splats

<!-- method-priority:start
priority:
  learning: 3
  deployment: 2
  type: "method-family"
  stage: "frontier"
  maturity: "research"
  tags: ["slam", "mapping", "simulation", "validation"]
  reason: "GigaSLAM: Large-Scale Monocular SLAM with Hierarchical Gaussian Splats is rated for neural or Gaussian SLAM research and future dense map representation workflows."
method-priority:end -->

Related docs: [GS-SLAM and MonoGS](gs-slam-monogs.md) · [Splat-SLAM](splat-slam.md) · [MASt3R-SLAM](mast3r-slam.md) · [DROID-SLAM](droid-slam.md) · [NeRF-SLAM](nerf-slam.md) · [Scan Context Family](scan-context-family.md) · [Loop Closure and Place Recognition](loop-closure-place-recognition.md) · [FAST-LIO / FAST-LIO2](fast-lio-fast-lio2.md) · [KISS-ICP](kiss-icp.md) · [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [Gaussian Splatting for Driving](../../perception/overview/gaussian-splatting-driving.md) · [3DGS Digital Twin](../../simulation/3dgs-digital-twin.md) · [SLAM benchmarking](benchmarking-metrics-datasets.md) · [ORB-SLAM2/ORB-SLAM3](orb-slam2-orb-slam3.md) · [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md) · [Volume Rendering, Radiance Fields, and Gaussian Splatting](../../../10-knowledge-base/geometry-3d/volume-rendering-radiance-fields-gaussian-splatting.md) · [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md)

**Last updated:** 2026-05-23

---

## What It Is

**Full citation:** Kai Deng, Yigong Zhang, Jian Yang, Jin Xie. "GigaSLAM: Large-Scale Monocular SLAM with Hierarchical Gaussian Splats." arXiv 2503.08071, submitted 11 March 2025; revised 10 June 2025. Accepted: **SIGGRAPH Asia 2025** (ACM DOI 10.1145/3757377.3763932).

**Author affiliations:** Kai Deng and Yigong Zhang — Nankai University, Tianjin; Jian Yang and Jin Xie — Nankai University and Nanjing University Suzhou Campus.

**Links:**
- arXiv abstract: https://arxiv.org/abs/2503.08071
- arXiv HTML v2 (full paper): https://arxiv.org/html/2503.08071v2
- GitHub (official, MIT license): https://github.com/DengKaiCQ/GigaSLAM
- ACM DL: https://dl.acm.org/doi/10.1145/3757377.3763932

GigaSLAM is the **first 3D Gaussian Splatting SLAM system evaluated at kilometre-scale outdoor urban driving.** Prior 3DGS-SLAM systems — SplaTAM, MonoGS, GS-SLAM, Splat-SLAM — were confined to room-scale or short bounded indoor trajectories (Replica, TUM-RGBD, ScanNet; trajectory lengths tens of metres). GigaSLAM extends the envelope to KITTI sequences up to 5,067 m and KITTI-360 sequences up to 11.5 km, without running out of GPU memory and without crashing.

The method is monocular RGB only. It solves the three coupled failure modes that cause flat-list 3DGS-SLAM to collapse at city scale — Gaussian count explosion, single-GPU global map limits, and trajectory drift without loop closure — through three interlocking design decisions: a 5-level hierarchical sparse voxel map with neural MLP decoders (Scaffold-GS style), a learned metric depth front-end (UniDepth V2 + DISK/LightGlue), and DBoW2 image retrieval with Sim(3) pose-graph loop closure that batch-deforms all Gaussian voxel anchors after correction.

---

## Historical Context

The original 3D Gaussian Splatting paper (Kerbl et al. SIGGRAPH 2023) made real-time radiance-field rendering practical by replacing implicit NeRF volume rendering with explicit anisotropic Gaussian primitives and a tile-based CUDA rasterizer. SLAM researchers immediately explored whether Gaussians could serve as the online map in a tracking-and-mapping loop.

By early 2024, four groups submitted Gaussian SLAM papers converging at CVPR 2024: SplaTAM, GS-SLAM, MonoGS, and Gaussian-SLAM. All four earned Highlights or Demo awards; together they define the "first wave" — visually compelling, GPU-bound, drift-limited, loop-closure-free systems evaluated exclusively at room scale. A second wave (Splat-SLAM, LoopSplat, RTG-SLAM, DROID-Splat) added loop closure but remained bounded to indoor or short outdoor sequences. Neither wave answered whether 3DGS-SLAM could run at the scale of a full urban drive.

GigaSLAM answers that question. Accepted SIGGRAPH Asia 2025 — one year after the first-wave CVPR 2024 papers — it closes the gap from rooms (~10 m) to cities (~11.5 km). A contemporaneous system, VPGS-SLAM (Deng et al., arXiv 2505.18992, May 2025), independently proposes a discrete submap architecture with online knowledge-distillation fusion; its authors note GigaSLAM as concurrent work.

For the Scaffold-GS voxel representation origin and the 3DGS tile rasterizer mechanics see [Volume Rendering, Radiance Fields, and Gaussian Splatting](../../../10-knowledge-base/geometry-3d/volume-rendering-radiance-fields-gaussian-splatting.md). For feed-forward depth prediction and splatting primitives see [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md). For the Lie-algebra math underlying Sim(3) pose-graph optimization see [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md).

---

## Core Technical Idea

### The scaling problem

Three coupled failure modes make naive flat-list 3DGS-SLAM collapse at city scale:

**1. Gaussian count explosion.** A global unstructured list of 3DGS primitives grows without bound as the camera traverses new territory. Densification heuristics from offline 3DGS (Kerbl 2023) add millions of primitives per kilometre. GPU VRAM exhausts within minutes of outdoor driving.

**2. Single-GPU global map limit.** The tile-based CUDA rasterizer sorts all Gaussians globally each frame. On a 24 GB RTX 4090 a single-level flat map (voxel size 0.1 m) reaches OOM after a few hundred frames of outdoor driving. The paper's own ablation confirms this: a 1-level flat representation consumes 22.46 GiB on the same KITTI sequences that the 5-level hierarchy handles in 8.62 GiB. Splat-SLAM hits 80 % Gaussian activation ratios at U-turns and crashes in mapping mode on outdoor sequences; MonoGS crashes after "a few hundred frames" outdoors.

**3. Drift without loop closure.** Visual SLAM accumulates pose error that compounds over long trajectories. Without explicit loop closure and a global pose-graph correction, the Gaussian map develops spatial inconsistencies that rasterization cannot hide. DROID-SLAM runs out of memory on extended KITTI-360 sequences (14,607 frames) without providing a Gaussian map at all.

### GigaSLAM's three-part answer

**(a) Hierarchical sparse voxel Gaussian map with neural decoders**

Instead of a flat list of Gaussians, the scene is represented as a hierarchy of sparse voxels at five resolution levels with voxel edge sizes `[0.1, 0.25, 1.0, 5.0, 25.0]` metres. Each voxel `v` stores a 32-dimensional feature vector `f_v` in R^32, a per-axis scaling factor `l_v` in R^3, and `k` offset vectors `O_v` in R^{k×3}. A set of shared lightweight MLPs — Fα for opacity, Fcolor for spherical-harmonic color, Fquan for rotation quaternion, Fscaling for geometric scale — decode each voxel feature into `k` explicit 3D Gaussians on the fly. Only voxels within the camera-distance range for their level and visible in the current frustum are loaded, decoded, and sent to the CUDA rasterizer.

Two scale benefits follow:
- Boundless growth: the sparse hash map grows arbitrarily as the vehicle moves; distant regions are encoded at coarse voxel resolution (25 m cubes), dramatically reducing primitive count.
- Bounded GPU memory: the 5-level LoD cuts active VRAM from 22.46 GiB (1-level flat) to 8.62 GiB on a standard RTX 4090 (24 GiB), with near-identical rendering quality (~24 dB PSNR). See ablation results below.

The voxelization follows the Scaffold-GS design: spatial deduplication uses the hash function `h(x) = (XOR_i x_i * pi_i) mod T`, providing O(1) voxel lookup and preventing redundant Gaussians in revisited regions.

**(b) Monocular metric depth plus learned feature front-end**

GigaSLAM is entirely monocular RGB — no LiDAR, no stereo, no IMU, no GNSS. Metric scale is provided by **UniDepth V2** (ViT-L or ViT-S backbone, loaded from HuggingFace), a pretrained metric monocular depth estimator. Feature matching uses **DISK** keypoint detector plus **LightGlue** matcher.

Per-frame pose computation proceeds:
1. Extract DISK keypoints from current and reference keyframe.
2. Match with LightGlue; RANSAC filters outliers.
3. Apply GRIC criterion to select homography or epipolar model depending on motion type (pure-rotation degeneracy handled explicitly).
4. Recover relative pose from Essential or Fundamental matrix decomposition.
5. Refine with PnP using UniDepth-derived 3D points from the reference keyframe.

The GRIC fallback prevents tracker collapse on wide-baseline turns and on near-degenerate straight-line highway motions.

**(c) DBoW2 loop closure with Sim(3) pose-graph optimization and Gaussian map deformation**

Loop detection uses **DBoW2** image retrieval with an ORB vocabulary (`ORBvoc.txt` from ORB-SLAM3, ~150 MB). When a loop is detected, Sim(3) optimization runs over the pose graph with two terms:

```
E = sum_{(i,j) consecutive} || log(Z_ij^{-1} * T_i^{-1} * T_j) ||^2_Omega   (smoothness)
  + sum_{(l,m) loop}        || log(Z_lm^{-1} * T_l^{-1} * T_m) ||^2_Omega   (loop constraint)
```

where `Z_ij` are relative pose measurements and `Omega` is an information matrix weighting. After pose-graph optimization, all voxel anchor points are batch-transformed:

```
p_i_new = T_new(j) * [T_old(j)]^{-1} * [p_i | 1]
```

Batch processing keeps memory bounded during the correction. After re-transforming anchors, **re-voxelization** rebuilds the spatial hash to reflect new anchor positions. The decoded Gaussian primitives then become consistent with the corrected trajectory at once.

---

## Operator Mechanics

GigaSLAM uses a **single continuous global hierarchical map** rather than discrete disjoint sub-maps. The scalability mechanism is the LoD hierarchy plus active-voxel selection, not classic sub-map handoff.

**Active voxel selection:** at each frame the renderer selects voxels within the camera-distance range for each hierarchy level. Only selected voxels are loaded, decoded (MLP forward pass), and sent to the CUDA rasterizer. Voxels outside the frustum or beyond the level-appropriate range are not decoded.

**Voxel allocation:** when the camera moves into previously unseen territory, new voxels are hash-mapped and appended to the relevant level with freshly initialized feature vectors. This is the incremental "densification" step — there is no global split/clone/prune cycle; growth is bounded by the hash map capacity and the LoD range assignment.

**Deduplication:** the spatial hash prevents duplicate voxels when the map revisits nearby locations on return passes.

**Loop closure re-voxelization:** after Sim(3) correction, voxel anchors are rigidly batch-transformed and re-inserted into the hash. This avoids per-Gaussian recomputation while keeping map geometry consistent with the corrected trajectory.

**Practical limits:** on standard KITTI sequences (400–5,000 m) the 24 GB RTX 4090 is sufficient at 8.62 GiB peak. Ultra-long sequences (4 Seasons, A2D2, 20,000+ frames) require the 48 GB L20, which is not a standard deployment GPU.

---

## Inputs and Outputs

**Inputs (required):**
- Monocular RGB image sequence (calibrated intrinsics via `.yaml` config; no depth sensor, no IMU, no GPS, no stereo)
- Pretrained weights: UniDepth V2 (HuggingFace auto-download), DISK, LightGlue, ORB vocabulary (~150 MB)

**Outputs:**
- Estimated camera trajectory (6-DOF poses per keyframe, metric scale from UniDepth)
- Hierarchical Gaussian map (voxel features + MLP weights, rendering-ready)
- Novel-view renderings at any keyframe pose (for evaluation or visual inspection)

**What GigaSLAM does NOT provide:**
- Uncertainty or covariance on poses
- Semantic labels or object segmentation
- Occupancy grid, TSDF, or drivable-area map
- IMU integration or wheel-odometry fusion
- LiDAR point cloud alignment or geometric ground truth
- Dynamic object detection or filtering

---

## Architecture

```
+----------------------------------------------------------+
|                    GigaSLAM Pipeline                     |
|                                                          |
|  Monocular RGB stream                                    |
|         |                                                |
|         v                                                |
|  +------------------------------------------+            |
|  |  FRONT-END (per frame)                   |            |
|  |  UniDepth V2 -> metric depth D_t          |            |
|  |  DISK + LightGlue -> feature matches      |            |
|  |  GRIC -> epipolar model selection         |            |
|  |  Essential/Fundamental -> relative pose   |            |
|  |  PnP + RANSAC -> refined pose T_t         |            |
|  |  Keyframe selection logic                 |            |
|  +------------------------------------------+            |
|         |                                                |
|         v                                                |
|  +------------------------------------------+            |
|  |  HIERARCHICAL GAUSSIAN MAP BACK-END      |            |
|  |  5-level sparse voxel hash               |            |
|  |  Voxel features f_v in R^32              |            |
|  |  MLPs: F_alpha, F_color, F_quat, F_scale |            |
|  |  Active voxel selection (LoD frustum)    |            |
|  |  CUDA tile rasterizer (alpha-composite)  |            |
|  |  Loss: L_render + lambda_i*L_iso         |            |
|  |        + lambda_s*L_smooth               |            |
|  +------------------------------------------+            |
|         |                                                |
|         v                                                |
|  +------------------------------------------+            |
|  |  LOOP CLOSURE MODULE                     |            |
|  |  DBoW2 image retrieval (ORB vocabulary)  |            |
|  |  Sim(3) pose-graph optimization          |            |
|  |  Batch anchor transform + re-voxelization|            |
|  +------------------------------------------+            |
|         |                                                |
|         v                                                |
|  Outputs: corrected trajectory + Gaussian map            |
+----------------------------------------------------------+
```

The codebase builds on the **MonoGS PyTorch framework** (Matsuki et al., CVPR 2024) with CUDA acceleration, adding the hierarchical voxel map, UniDepth depth, DISK/LightGlue features, DBoW2 retrieval, and Sim(3) loop correction as modular extensions. MIT license; 136 GitHub stars, 10 forks as of May 2026.

---

## Training and Optimization

### Map optimization losses

The combined per-frame mapping objective is:

```
L_total = L_render + lambda_i * L_iso + lambda_s * L_smooth
```

**L_render** — photometric fidelity:

```
L_render = L1_photometric + lambda_SSIM * SSIM_loss
```

Standard L1 + SSIM comparison between the rendered and observed RGB image at the current keyframe.

**L_iso** — isotropy regularizer: penalizes highly anisotropic Gaussians (elongated needles or disks) to promote compact, isotropic primitives. This matters for large-scale outdoor maps where floaters and degenerate geometry proliferate in sky and low-texture regions. Analogous to the `E_iso` in MonoGS but applied via the voxel MLP decoder rather than directly to per-Gaussian parameters.

**L_smooth** — edge-aware depth smoothness: uses Canny-operator edge detection on the rendered depth to apply second-order smoothness only in non-edge regions, preserving depth boundaries while suppressing oscillations on flat surfaces such as road and apron.

### Incremental voxel allocation

Unlike offline 3DGS there is no iterative split/clone/prune cycle applied globally. The LoD voxel structure replaces densification: new voxels are allocated on-the-fly as the camera moves to previously unseen areas. Feature vectors are initialized at small random values; MLPs are shared and trained jointly via backpropagation through the rendered loss. The effective "densification" is voxel addition, bounded by the LoD level resolution at that scene depth.

### Loop closure sub-map handoff criteria

There is no sub-map boundary or handoff. Loop closure triggers when DBoW2 returns a candidate frame exceeding a similarity threshold. After Sim(3) optimization, the map is deformed in one batch pass and re-voxelized. The authors note that DBoW2 loop detection degrades under fast vehicle motion or low visual texture, causing missed loops on the 4 Seasons dataset.

---

## Benchmark Results

### KITTI Odometry (sequences 00–10)

Trajectory lengths: 394–5,067 m. Frame counts: 801–4,661. Hardware: NVIDIA RTX 4090, 12 Xeon CPUs, 67 GB RAM.

**ATE RMSE (metres):**

| Method | KITTI Avg ATE (m) | Notes |
|---|---|---|
| ORB-SLAM2 | 54.816 | Classical feature SLAM; stereo mode |
| DROID-SLAM | 100.278 | Dense recurrent; no rendering |
| MonoGS | crashes | Fails after ~100 frames on outdoor |
| Splat-SLAM | crashes (most sequences) | OOM on outdoor; mapping mode failure |
| GigaSLAM (without loop closure) | 16.437 | Hierarchical Gaussian, no LC |
| **GigaSLAM (with loop closure)** | **15.576** | +DBoW2 Sim(3) loop correction |

**Rendering quality on KITTI:**

| Method | PSNR (dB) | SSIM | LPIPS |
|---|---|---|---|
| MonoGS | 11.09 | 0.38 | 0.79 |
| **GigaSLAM** | **24.22** | **0.95** | **0.31** |

PSNR range across KITTI sequences: 22.71–25.22 dB. SSIM: 0.94–0.97. LPIPS: 0.25–0.35.

### KITTI-360 (sequences up to 14,607 frames, up to ~11.5 km)

| Method | Avg ATE (m) | Notes |
|---|---|---|
| DROID-SLAM | 193.307 | OOM on most long sequences |
| **GigaSLAM (with loop closure)** | **47.107** | Stable; no OOM |

The 47 m average ATE on sequences up to 11.5 km corresponds to relative errors in the 0.4–1 % range, broadly consistent with monocular visual odometry at this scale. DROID-SLAM fails on most sequences.

### 4 Seasons and A2D2 (ultra-long)

- **4 Seasons:** multi-season long-term outdoor driving. DBoW2 had difficulty detecting loops on this dataset (acknowledged failure mode). No quantitative ATE reported.
- **A2D2:** 20,000+ frame sequences. No ground-truth poses; trajectory validated visually by projection onto Google Maps. Demonstrates scalability without claiming metric ATE. Requires the 48 GB L20.

### Ablation: contribution of each component (KITTI sequence 06)

| Configuration | ATE (m) |
|---|---|
| MonoGS baseline | 137.22 |
| MonoGS + UniDepth depth | 100.03 |
| GigaSLAM LoD only (no loop closure) | 47.33 |
| GigaSLAM without loop closure | 2.61 |
| **GigaSLAM with loop closure** | **2.11** |

The large jump from MonoGS+UniDepth (100 m) to GigaSLAM LoD (47 m) on sequence 06 is because the hierarchical map prevents OOM/crash; the further improvement to 2.11 m comes from Sim(3) loop closure on this sequence which has a clear revisit.

### GPU memory — LoD ablation (KITTI sequences, RTX 4090 24 GB)

| LoD levels | Voxel sizes (m) | Peak VRAM | PSNR |
|---|---|---|---|
| 1 level | [0.1] | 22.46 GiB | ~24 dB |
| 2 levels | [0.1, 0.25] | 15.82 GiB | ~24 dB |
| 3 levels | [0.1, 0.25, 1.0] | 11.77 GiB | ~24 dB |
| 4 levels | [0.1, 0.25, 1.0, 5.0] | 9.46 GiB | ~24 dB |
| **5 levels** | **[0.1, 0.25, 1.0, 5.0, 25.0]** | **8.62 GiB** | **~24 dB** |

The 5-level LoD reduces memory 62 % relative to the flat single-level map while maintaining rendering quality. This is the deployed default. The single-level flat map would exceed the 24 GB RTX 4090 capacity on longer sequences; the 5-level hierarchy keeps it well within bounds.

### Latency and FPS

**The paper does not report explicit FPS or per-frame latency.** This is a genuine evaluation gap. Rendering is performed at 480 px width (upsampled for evaluation metrics). All front-end steps — UniDepth forward pass, DISK+LightGlue matching, GRIC selection, epipolar recovery, PnP refinement — add substantial latency beyond pure rasterization. The system is not described as real-time. For production AV integration, the absence of a latency characterization is a significant caution flag. Compare: GS-SLAM achieves ~8 FPS end-to-end at room scale (RGB-D); GigaSLAM's larger map and monocular pipeline will be slower — no number is confirmed.

---

## Variants and Lineage

### 3DGS-SLAM family tree

| System | Venue | Input | Scale | Loop closure | Notes |
|---|---|---|---|---|---|
| 3DGS (Kerbl et al.) | SIGGRAPH 2023 | Multi-view offline | Any | n/a | Foundational; not a SLAM system |
| Scaffold-GS | CVPR 2024 | Offline | Any | n/a | Anchor-voxel + MLP decoders; GigaSLAM inherits this design |
| SplaTAM | CVPR 2024 | RGB-D | Room | No | First Gaussian SLAM; isotropic Gaussians |
| GS-SLAM | CVPR 2024 | RGB-D | Room | No | Adaptive expansion, ~8 FPS E2E |
| MonoGS | CVPR 2024 | Mono/RGB-D | Room | No | Lie-Jacobian pose opt; crashes outdoors |
| Splat-SLAM | CVPR 2025W | RGB | Room | Yes (DSPO pose-graph) | OOM on outdoor; fails most KITTI sequences |
| **GigaSLAM** | **SIGGRAPH Asia 2025** | **Mono RGB** | **km-scale** | **Yes (DBoW2 + Sim(3))** | **First km-scale 3DGS-SLAM** |

For the full first-wave comparison (SplaTAM, MonoGS, GS-SLAM technical details) see [GS-SLAM and MonoGS](gs-slam-monogs.md). For Splat-SLAM's DSPO deformable Gaussian design see [Splat-SLAM](splat-slam.md). For MASt3R-SLAM's feed-forward pointmap approach (same Imperial College lab as MonoGS) see [MASt3R-SLAM](mast3r-slam.md).

### GigaSLAM's key design differences from Splat-SLAM

Splat-SLAM uses a **DSPO dense-optical-flow factor graph** for loop closure and a **closed-form per-keyframe deformation** that rigidly shifts Gaussians anchored to each keyframe. GigaSLAM uses **DBoW2 bag-of-words retrieval** and a **Sim(3) pose-graph optimizer** that batch-transforms all voxel anchors globally. The two approaches reach different ends: Splat-SLAM's DSPO gives dense per-pixel depth estimates in indoor scenes (enabling high-PSNR indoor maps); GigaSLAM's LoD hierarchy enables outdoor km-scale operation that Splat-SLAM cannot achieve. GigaSLAM's loop closure is coarser (appearance-based retrieval vs. dense flow) but scales to km-length trajectories.

### Concurrent work: VPGS-SLAM

VPGS-SLAM (Deng et al., arXiv 2505.18992, May 2025) independently proposes a first 3DGS SLAM with explicit discrete sub-map architecture plus inter-submap knowledge distillation for fusion. It targets both indoor and outdoor large-scale scenes using 2D-3D Gaussian-based loop closure. Its authors note GigaSLAM as concurrent work. VPGS-SLAM uses sub-map handoffs where GigaSLAM uses a continuous hierarchical global map; the design tradeoff is architectural simplicity (GigaSLAM) versus modular scalability (VPGS-SLAM). License: CC-BY-NC-SA 4.0 (non-commercial).

### Successors and open directions

No confirmed direct successor as of May 2026. Active research directions implied by the paper's future-work section:
- Improved loop closure for high-speed motion (DBoW2 fragility at speed).
- Dynamic object handling in Gaussian maps.
- Adverse weather and night-time robustness.
- Integration with LiDAR or GNSS for metric anchoring (not attempted in GigaSLAM itself).

---

## Strengths

- **Scale breakthrough:** first demonstrated 3DGS-SLAM on kilometre-scale urban sequences; directly closes the gap that invalidated prior systems (MonoGS crashes, Splat-SLAM OOM on outdoor sequences).
- **Memory efficiency:** 5-level LoD hierarchy cuts VRAM 62 % versus a flat 3DGS while preserving rendering quality (PSNR stable at ~24 dB across all ablation levels).
- **Strong rendering quality:** PSNR 24.22 dB, SSIM 0.95, LPIPS 0.31 on KITTI outdoor — dramatically better than MonoGS (11 dB) which partially runs on the same data.
- **No depth sensor required:** UniDepth provides metric monocular depth; no RGB-D camera needed. Camera-only deployment is feasible for platforms where adding active sensors is impractical.
- **Explicit loop closure:** Sim(3) pose-graph correction with Gaussian map deformation — unlike room-scale systems that rely on implicit factor-graph regularization or no loop closure at all.
- **Open source, MIT license:** full implementation on GitHub with reproducible KITTI and KITTI-360 configuration files.
- **Competitive ATE vs. baselines:** 15.6 m average on KITTI at 394–5,067 m trajectories, against ORB-SLAM2 at 54.8 m and DROID-SLAM at 100.3 m on the same benchmark (both of which have no Gaussian map output).

---

## Failure Modes

| Failure mode | Mechanism | Relevance to airside |
|---|---|---|
| UniDepth domain shift | Metric depth regressor fails on unseen surface types; trained on road-domain scenes | High: wet concrete, aircraft fuselage, painted taxiway markings |
| DBoW2 loop miss | High-speed or repetitive visual content confuses BoW retrieval; reported on 4 Seasons | High: fast ramp vehicle, repetitive gate geometry |
| False loop closure | Perceptually similar but geometrically distinct views match in BoW | High: airport gates are deliberately repetitive |
| Dynamic object corruption | Moving aircraft, GSE, or vehicles fill camera view; no dynamic filtering in GigaSLAM | Very high: taxiway saturated with dynamic objects |
| GRIC degeneracy | Pure-rotation or linear motion degenerates epipolar geometry; GRIC mitigates but does not eliminate | Moderate: wide apron straight-line driving |
| VRAM exhaustion on ultra-long routes | Sequences >20,000 frames require 48 GB L20; standard RTX 4090 is insufficient | Moderate: airport perimeter drive >10 km |
| Night / low-light failure | DISK features degrade; UniDepth prediction quality drops on underexposed or high-contrast scenes | High: airside operates 24 h including low-light apron ops |
| Texture-less / sky regions | No photometric gradient; Gaussians cannot be reliably initialized or refined | High: vast low-texture apron concrete; open sky |
| Monocular scale ambiguity | Metric scale from a learned model, not a physical sensor; fails out-of-distribution | Critical: safety-rated localization requires calibrated sensor scale |
| No uncertainty output | No pose covariance or map quality score | Critical: incompatible with ASIL-rated fault detection |

---

## Domain Fit

| Domain | Fit | Key notes |
|---|---|---|
| Outdoor urban road driving (offline map) | Good | Designed for this; KITTI/KITTI-360 are the native benchmarks |
| Urban outdoor — online real-time | Research only | No FPS characterization; likely not real-time at full resolution |
| Indoor rooms | Not primary | Room-scale is better served by MonoGS/GS-SLAM/Splat-SLAM |
| Airside apron (online primary SLAM) | Not suitable | Dynamic GSE, low texture, night, scale — all break monocular system |
| Airside survey (offline appearance layer) | Conditional | Useful as visual layer if anchored to LiDAR-primary geometry; see section below |
| Airport digital twin (km-scale) | Promising | Airport apron + taxiways ~2–10 km² matches GigaSLAM's claimed scale exactly |
| Warehouse / port indoor | Not primary | Bounded indoor better served by first-wave systems |
| Agriculture / construction outdoor | Research only | Weather, vegetation, dynamics all stress monocular system |
| Delivery robot — campus outdoor | Research only | Short routes feasible; weather and dynamic pedestrians still unsolved |

---

## LiDAR-Augmented Sibling Variants

GigaSLAM itself has no LiDAR integration — it is monocular RGB only. LiDAR-augmented 3DGS-SLAM systems are a parallel development track that solves the three structural weaknesses of pure camera-based outdoor SLAM (scale ambiguity, texture-less densification, metric accuracy). For airside and outdoor industrial use these are the operationally relevant references:

| System | Sensors | Venue | Key capability |
|---|---|---|---|
| Gaussian-LIC | LiDAR + IMU + Camera | ICRA 2025 | Real-time; solid-state and spinning LiDAR; unbounded outdoor; sky + exposure modeling; 24.55 dB PSNR |
| Gaussian-LIC2 | LiDAR + IMU + Camera | arXiv 2507.04004 | Continuous-time trajectory optimization; zero-shot depth for LiDAR-blind regions; geometry + rendering simultaneously |
| LVI-GS | LiDAR + Visual + IMU | IEEE TIM 2025 | Tight fusion; pyramid training; LiDAR depth supervision throughout |
| LiHi-GS | LiDAR + Camera | 2024 | Highway driving; novel LiDAR scan synthesis; persistent LiDAR depth supervision |
| LIV-GaussMap | LiDAR + IMU + Camera | 2024 | FAST-LIO-style seeding + visual Gaussian refinement; size-adaptive voxels |
| VPGS-SLAM | Camera (no LiDAR) | arXiv 2505.18992 | Explicit submap architecture; concurrent with GigaSLAM; not LiDAR-augmented |

GigaSLAM contributes the **km-scale LoD hierarchy design concept** to this family. Gaussian-LIC and LVI-GS are the closest to the operational sensor suite for airside survey (LiDAR-primary with camera appearance). A GigaSLAM-style large-scale LoD architecture applied to a LiDAR-augmented system — using LiDAR metric depth to seed voxels and camera photometry to optimize Gaussian appearance — is the obvious and unresolved next step.

For loop closure in the LiDAR domain see [Scan Context Family](scan-context-family.md) and [Loop Closure and Place Recognition](loop-closure-place-recognition.md). For LiDAR-primary odometry see [FAST-LIO / FAST-LIO2](fast-lio-fast-lio2.md) and [KISS-ICP](kiss-icp.md).

---

## Aggregated-Map Suitability: The Honest Assessment

**GigaSLAM is NOT a replacement for FAST-LIO2 or KISS-ICP in any production AV localization stack.** Its outputs are monocular-derived and carry no calibrated sensor uncertainty. The correct role is the **large-scale APPEARANCE LAYER** in a digital twin — not the geometry-primary localization backbone.

### Why GigaSLAM cannot replace LiDAR odometry

- Trajectory ATE of 15.6 m on KITTI and 47.1 m on KITTI-360 is acceptable for reconstruction and visual appearance but not for lane-level or apron-level localization.
- Scale comes from a learned depth model (UniDepth), not a calibrated sensor. Out-of-distribution surfaces (airport apron, aircraft fuselage) can silently corrupt metric estimates.
- No pose covariance output; no health monitor; no map lifecycle management compatible with airside safety management systems.
- DBoW2 loop closure fails under fast motion and repetitive geometry — exactly the conditions at airports.

### Airport-scale digital twin: the plausible integration pattern

An airport apron plus taxiway footprint runs 2–10 km² — exactly the spatial scale GigaSLAM was designed for (KITTI-360 sequences reach ~11.5 km). For this use case the recommended architecture is:

```
Step 1: LiDAR odometry (FAST-LIO2 / KISS-ICP)
        + GNSS / RTK for global anchoring
        -> Metric HD LiDAR map (primary, safety-rated geometry)

Step 2: GigaSLAM (offline, camera-only, registered to LiDAR map)
        -> 3DGS Gaussian appearance layer (visual detail, simulator background)
        -> Anchored via ICP or surveyed control-point registration
        -> NOT in real-time control loop

Combined output:
        Airport digital twin = LiDAR geometry + GigaSLAM Gaussian appearance
        Operator uses appearance layer for:
          sim replay, map staleness detection,
          visual localization research,
          perception regression test backgrounds
```

This pattern parallels how Gaussian-LIC operates — geometry from LiDAR, appearance from camera Gaussians — but uses GigaSLAM's offline LoD map as the appearance asset rather than an online real-time fused system. GigaSLAM's 8.62 GiB VRAM footprint at 5-level LoD makes it feasible to build a full airport-scale Gaussian appearance layer on a single 24 GB workstation GPU, which no prior room-scale 3DGS-SLAM system could claim.

### Scale comparison with environments

| Environment | Scale | 3DGS-SLAM viability |
|---|---|---|
| Replica room | ~10 m | SplaTAM, MonoGS, GS-SLAM all work |
| TUM-RGBD corridor | ~30 m | MonoGS, GS-SLAM work |
| ScanNet scene | ~20–50 m | Splat-SLAM, MonoGS work |
| KITTI sequence 09 | ~394 m | GigaSLAM (first to not crash) |
| KITTI-360 sequence | up to 11.5 km | GigaSLAM (only viable method) |
| Airport apron + taxiways | ~2–10 km | GigaSLAM LoD architecture is the reference design |

See [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) for downstream use of Gaussian appearance maps and [3DGS Digital Twin](../../simulation/3dgs-digital-twin.md) for simulation applications.

---

## Implementation Notes

- **Minimum GPU: 24 GB VRAM.** The 5-level LoD peaks at 8.62 GiB on standard KITTI sequences, but backpropagation buffers, UniDepth inference, and OS overhead require headroom. An RTX 4090 (24 GB) is the minimum tested hardware. Standard consumer cards (RTX 3090 with 24 GB) should work for KITTI-length sequences; extended sequences require the 48 GB L20.
- **Ultra-long sequences need 48 GB.** 4 Seasons, A2D2, and any route exceeding ~20,000 frames require the L20 or equivalent. Plan accordingly for airport perimeter drives.
- **No monocular depth in industrial low-light.** UniDepth V2 is trained on daylight driving datasets. Night airside scenes, floodlight glare, and de-icing spray will degrade or corrupt depth predictions. There is no fallback depth sensor. Night-time mapping is not supported.
- **DBoW2 vocabulary is domain-general.** The ORB vocabulary (`ORBvoc.txt` from ORB-SLAM3) was trained on general outdoor scenes. Airport gate repetitiveness is a known false-loop risk; geometric verification should be added before accepting any loop closure near symmetric structures.
- **CUDA and PyTorch dependency pinning is critical.** The custom CUDA rasterizer (inherited from MonoGS/3DGS) is sensitive to CUDA/PyTorch/driver version combinations. Pin versions tightly and document the tested configuration for reproducibility.
- **SE(3) vs. Sim(3) ATE alignment.** GigaSLAM provides metric scale from UniDepth, so SE(3) alignment is valid for ATE evaluation. However, if UniDepth scale calibration drifts on a specific sequence, Sim(3) alignment will give optimistically lower ATE. Report alignment type explicitly.
- **Rendering resolution compromise.** The paper evaluates at 480 px width images (upsampled to native for metrics). Full-resolution rendering cost is higher and untested. For production digital twin export, verify at native sensor resolution.
- **Not a ROS2 package.** The public GitHub is research code. No ROS2 interface, no safety monitoring, no map lifecycle management, no integration with HD map formats. Product teams should expect significant engineering effort to operationalize.
- **Dynamic-object filtering must be added externally.** GigaSLAM has no built-in motion segmentation or dynamic-object masking. On sequences with moving vehicles, Gaussians assigned to dynamic objects contaminate the static map. Apply a semantic segmentation or flow-based motion mask before the map update step.

---

## Sources

1. Deng, K., Zhang, Y., Yang, J., Xie, J. "GigaSLAM: Large-Scale Monocular SLAM with Hierarchical Gaussian Splats." arXiv 2503.08071, 2025. https://arxiv.org/abs/2503.08071
2. GigaSLAM arXiv HTML v2 (full paper with all tables). https://arxiv.org/html/2503.08071v2
3. SIGGRAPH Asia 2025 proceedings entry. https://dl.acm.org/doi/10.1145/3757377.3763932
4. GigaSLAM GitHub (official, MIT license). https://github.com/DengKaiCQ/GigaSLAM
5. Kerbl, B. et al. "3D Gaussian Splatting for Real-Time Radiance Field Rendering." ACM SIGGRAPH 2023. https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/
6. Matsuki, H. et al. "Gaussian Splatting SLAM." CVPR 2024 (Highlight + Best Demo). https://arxiv.org/abs/2312.06741 | https://github.com/muskie82/MonoGS
7. Yan, C. et al. "GS-SLAM: Dense Visual SLAM with 3D Gaussian Splatting." CVPR 2024 (Highlight). https://arxiv.org/abs/2311.11700
8. Sandström, E. et al. "Splat-SLAM: Globally Optimized RGB-only SLAM with 3D Gaussians." arXiv 2405.16544, CVPR 2025W. https://arxiv.org/abs/2405.16544
9. Keetha, N. et al. "SplaTAM: Splat, Track & Map 3D Gaussians for Dense RGB-D SLAM." CVPR 2024. https://arxiv.org/abs/2312.02126
10. Murai, R. et al. "MASt3R-SLAM." CVPR 2025 Highlight. https://arxiv.org/abs/2412.12392
11. VPGS-SLAM (concurrent large-scale 3DGS SLAM). Deng, T. et al. arXiv 2505.18992, May 2025. https://arxiv.org/abs/2505.18992
12. Gaussian-LIC (LiDAR-Inertial-Camera 3DGS, ICRA 2025). https://arxiv.org/abs/2404.06926 | https://github.com/APRIL-ZJU/Gaussian-LIC
13. Gaussian-LIC2 (continuous-time, zero-shot depth). arXiv 2507.04004. https://arxiv.org/abs/2507.04004
14. UniDepth V2 (metric monocular depth, used by GigaSLAM). https://huggingface.co/lpiccinelli/unidepth-v2-vitl14
15. Awesome NeRF and 3DGS SLAM list. https://github.com/3D-Vision-World/awesome-NeRF-and-3DGS-SLAM
