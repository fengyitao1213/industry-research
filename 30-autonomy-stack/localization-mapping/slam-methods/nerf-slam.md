# NeRF-SLAM

<!-- method-priority:start
priority:
  learning: 3
  deployment: 2
  type: "method"
  stage: "frontier"
  maturity: "research"
  tags: ["slam", "mapping", "simulation", "validation"]
  reason: "NeRF-SLAM is rated for neural or Gaussian SLAM research and future dense map representation workflows."
method-priority:end -->

Related docs: [Splat-SLAM](splat-slam.md) · [GS-SLAM and MonoGS](gs-slam-monogs.md) · [MASt3R-SLAM](mast3r-slam.md) · [DROID-SLAM](droid-slam.md) · [NICE-SLAM](nice-slam.md) · [Co-SLAM and ESLAM](co-slam-eslam.md) · [KISS-ICP](kiss-icp.md) · [FAST-LIO / FAST-LIO2](fast-lio-fast-lio2.md) · [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [Gaussian Splatting for Driving](../../perception/overview/gaussian-splatting-driving.md) · [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md) · [Volume Rendering, Radiance Fields, and Gaussian Splatting](../../../10-knowledge-base/geometry-3d/volume-rendering-radiance-fields-gaussian-splatting.md)

**Last updated:** 2026-05-23

---

## What It Is

NeRF-SLAM (Rosinol, Leonard, and Carlone, IROS 2023; arXiv:2210.13641) is a real-time dense monocular SLAM system that couples a DROID-SLAM-derived visual front-end with an Instant-NGP hash-grid NeRF map back-end. The system requires only a monocular RGB camera — no depth sensor — and produces both a globally consistent camera trajectory and a dense photorealistic volumetric map of the scene.

The paper's key insight is that the bundle-adjustment posterior computed by DROID-SLAM yields not only camera poses and dense depth estimates, but also per-pixel depth uncertainty (marginal covariance). Feeding this uncertainty into the NeRF's depth supervision loss — weighting reliable pixels heavily and ignoring unreliable ones — produces up to ~179% better PSNR and ~75–86% better depth accuracy compared to competing monocular dense mapping methods.

**Full citation:** Antoni Rosinol, John J. Leonard, Luca Carlone. "NeRF-SLAM: Real-Time Dense Monocular SLAM with Neural Radiance Fields." IEEE/RSJ International Conference on Intelligent Robots and Systems (IROS), October 2023. arXiv:2210.13641. MIT DSpace: https://dspace.mit.edu/handle/1721.1/153646.

**Code:** https://github.com/ToniRV/NeRF-SLAM (BSD-2-Clause; includes DROID-SLAM and Instant-NGP as submodules, plus a Sigma-Fusion volumetric variant).

This page covers NeRF-SLAM by Rosinol et al. in depth, then documents the broader neural-implicit-mapping SLAM family from iMAP (ICCV 2021) through Loopy-SLAM (CVPR 2024). The lineage culminates in the 2024 pivot to 3DGS-SLAM, which is covered by the sibling pages [Splat-SLAM](splat-slam.md) and [GS-SLAM and MonoGS](gs-slam-monogs.md).

---

## Executive Summary

NeRF-SLAM and the family it belongs to established that a neural MLP or grid structure can serve as the sole scene representation in a real-time SLAM loop. Starting from iMAP's proof-of-concept in 2021 and culminating in Loopy-SLAM at CVPR 2024, this lineage drove indoor Replica depth L1 error from ~7.64 cm to 0.35 cm over three years.

For AV and airside applications, the honest verdict is:

- The entire standard NeRF-SLAM family is RGB-D or monocular. No system in this lineage natively consumes LiDAR.
- For outdoor/airside primary localization, LiDAR-inertial methods ([FAST-LIO2](fast-lio-fast-lio2.md), [KISS-ICP](kiss-icp.md)) remain the production baseline.
- The field pivoted to 3DGS-SLAM at CVPR 2024; 3DGS-based methods now supersede NeRF-SLAM for appearance-layer use cases (faster rendering, comparable reconstruction quality).
- LiDAR-native neural-implicit variants (NeRF-LOAM, PIN-SLAM) exist but are research-stage as of mid-2024.
- NeRF-SLAM's role today is primarily as a research baseline and historical origin of the neural-implicit-mapping concept.

---

## Core Technical Idea

NeRF-SLAM by Rosinol et al. combines two independent advances into one pipeline:

**1. Dense monocular SLAM front-end (DROID-SLAM derived).** A learned recurrent GRU estimates dense optical-flow correspondences between frames. A differentiable bundle-adjustment layer then solves for camera poses and per-pixel dense depth estimates jointly. Critically, the BA posterior also yields a per-pixel depth covariance matrix — representing how uncertain each depth estimate is. Textureless walls and sky get high variance (low reliability); well-textured edges get low variance (high reliability).

**2. Instant-NGP hash-grid NeRF back-end.** An Instant-NGP-style multi-resolution hash encoding maps 3D coordinates to density and color via a tiny MLP. This representation can be trained to convergence in seconds (vs. hours for vanilla NeRF) and is updated incrementally as new frames arrive.

**The connection:** rather than feeding raw depth into the NeRF's depth loss with uniform weight, NeRF-SLAM weights each ray's depth supervision by the inverse of the DROID-SLAM posterior covariance. This concentrates gradient signal on geometrically reliable pixels and ignores noisy estimates.

The result is a system that achieves both high photometric quality (PSNR) and high geometric accuracy (depth L1) from monocular video alone — without a depth sensor.

An alternative fusion path ("sigma-fusion") in the repository replaces the NeRF back-end with a classical TSDF volumetric fusion step that uses the same uncertainty-weighted depth, enabling faster but less appearance-rich reconstruction.

---

## Operator Mechanics

### Volume Rendering Equation

For a camera ray `r(t) = o + t·d`, the rendered colour is:

```
C(r) = integral_0^inf  T(t) * sigma(t) * c(t, d)  dt

where:
  sigma(t)  = volume density at distance t (opacity per unit length)
  c(t, d)   = emitted colour at distance t viewed from direction d
  T(t)      = exp( - integral_0^t  sigma(s) ds )
            = accumulated transmittance (fraction of light reaching
              the camera from point t)
```

**Discrete approximation** (ray march with N samples at distances t_1 < ... < t_N, intervals delta_i = t_{i+1} - t_i):

```
C_hat(r) = sum_{i=1}^{N}  T_i * (1 - exp(-sigma_i * delta_i)) * c_i

T_i = exp( - sum_{j=1}^{i-1}  sigma_j * delta_j )

alpha_i = 1 - exp(-sigma_i * delta_i)   (opacity of segment i)
```

Rendered depth:

```
D_hat(r) = sum_i  T_i * alpha_i * t_i
```

The rendering equation is fully differentiable with respect to both network parameters (sigma, c) and camera pose (through ray origin o and direction d), enabling joint optimization.

### Hash-Grid Encoding (Instant-NGP)

Instead of positional sinusoids (vanilla NeRF), Instant-NGP (Müller et al., ACM ToG 2022) uses a multi-resolution hash encoding:

```
L resolution levels (typically 16), from coarsest ~16^3 to finest ~512^3.

At each level l:
  1. Map 3D coordinate x to a voxel cell
  2. Hash the 8 corner integer coordinates into a table of size T
     (typically T = 2^19) with trainable F-dim feature vectors
  3. Trilinear interpolation of the 8 corner features
     -> level-l feature vector f_l(x)

Concatenate: f(x) = [f_1(x) || f_2(x) || ... || f_L(x)]  (L*F dims)
Pass through a tiny MLP (2-3 hidden layers, 64 units)
-> density sigma and colour c
```

Hash collisions are a known issue, but the multi-resolution structure means coarse-level collisions are corrected by fine-level features. The hash-grid parameters (feature table entries) update directly via backprop without the expensive gradient flow through a large MLP, enabling ~1000x faster convergence than vanilla NeRF.

### Tracking vs. Mapping Loss Split

All neural-implicit SLAM systems use an alternating optimization with two distinct phases:

**Tracking (camera pose optimization, network weights fixed):**

```
min_{T_t in SE(3)}  sum_{r in rays}
  [ lambda_rgb * |C_hat(r) - C_gt(r)|^2
  + lambda_depth * w(r) * |D_hat(r) - D_gt(r)|^2 ]

  where w(r) = 1 / sigma^2_depth(r)   (NeRF-SLAM uncertainty weight)
```

**Mapping (scene representation update, current-frame pose fixed):**

```
min_{theta, {T_k}_{k in KF}}  sum_{k in KF} sum_r  L_k(r; theta, T_k)
```

For SDF-based methods (ESLAM, Vox-Fusion, Co-SLAM) the loss adds free-space and TSDF-truncation terms:

```
L = L_rgb + lambda_d * L_depth + lambda_fs * L_freespace + lambda_sdf * L_sdf
```

The alternating structure mirrors classical SLAM's tracking-vs-mapping separation. Tracking runs every frame; mapping runs for a fixed number of gradient steps between frames.

---

## Inputs and Outputs

**Inputs:**
- Monocular RGB video stream (calibrated intrinsics required)
- GPU (authors note "GPU memory intensive pipeline"; tested on RTX 3090 class)
- No depth sensor required; no IMU

**Outputs:**
- Camera trajectory: per-frame SE(3) poses from DROID-SLAM BA
- Dense depth maps with per-pixel covariance (from BA posterior)
- Dense 3D NeRF map: density field + colour field queryable at any 3D point
- Novel-view RGB renders and depth renders from the NeRF map
- Optionally: TSDF mesh via sigma-fusion path

---

## Architecture

```
Monocular video
    |
    v
[DROID-SLAM front-end]
  Recurrent GRU optical-flow correlation volumes
  Differentiable bundle adjustment
  -> Camera poses T_1 ... T_t  (SE(3))
  -> Dense depth maps D_1 ... D_t
  -> Per-pixel depth covariance Sigma_depth (BA posterior)
    |
    v (per keyframe)
[Uncertainty-weighted depth loss computation]
  w(r) = 1 / sigma^2_depth(r)     for each ray r
  L_depth = sum_r  w(r) * |D_hat(r) - D_slam(r)|
    |
    v
[Instant-NGP hash-grid NeRF back-end]
  Multi-resolution hash encoding (L=16 levels)
  Tiny MLP: density sigma(x) + colour c(x, d)
  Volume rendering -> C_hat(r), D_hat(r)
  Loss: L_rgb + lambda * L_depth (uncertainty-weighted)
  Per-keyframe incremental training (few gradient steps between frames)
    |
    v
[Output]
  Dense 3D NeRF map  (or TSDF via --fusion='sigma')
  Novel-view renders
  Trajectory
```

**Keyframe selection:** new keyframe added when the frame observes a significantly new scene region (information-gain criterion), preventing catastrophic forgetting via keyframe replay.

**No loop closure** in the Rosinol et al. system. Drift accumulates on long sequences.

---

## Incremental NeRF Training During SLAM

This is the central novelty of the entire family, not just Rosinol et al. Key properties:

**Online training from scratch.** The neural map is initialized to random weights and trained live as the robot moves. There is no pre-collected dataset — the map learns the current environment in real time.

**Per-keyframe ray batches.** Each new keyframe contributes a batch of rays sampled from its image. At each step between frames, a small number of gradient steps (e.g., 60 iterations for NICE-SLAM mapping) are performed on a mix of current-frame rays and replayed keyframe rays.

**Convergence vs. speed trade-off:**

```
iMAP:     200 sampled pixels per iter, small MLP
          -> 2 Hz mapping, blurry reconstruction

NICE-SLAM: 60 gradient steps per mapping event, every 5 frames
           -> minutes per sequence, not real-time

Co-SLAM:  hash-grid fast convergence
          -> ~12 Hz mapping (near real-time)

GO-SLAM:  Instant-NGP hash-grid, per-keyframe update
          -> seconds per scene update (near real-time)
```

**Catastrophic forgetting mitigation.** The keyframe replay mechanism (iMAP's fundamental insight) continues in all successors. Without replaying past keyframes during mapping, the network overwrites earlier scene regions. Local/sparse representations (grids, voxels, points) in successors reduce cross-region interference by limiting which map parameters are updated for any given ray.

**Why hash grids change the speed equation.** Instant-NGP's hash-grid feature tables converge roughly 1000x faster than MLP weights for the same scene detail. NICE-SLAM's pre-allocated dense grids are slower than sparse allocations (Vox-Fusion, Co-SLAM, Loopy-SLAM). The jump from iMAP (2 Hz mapping) to Co-SLAM (~12 Hz) is almost entirely attributable to this shift.

---

## The Broader NeRF-SLAM Family

The following subsections document each major method in the neural-implicit-mapping SLAM lineage, ordered chronologically.

### iMAP — Sucar et al., ICCV 2021

**Citation:** Edgar Sucar, Shikun Liu, Joseph Ortiz, Andrew J. Davison. "iMAP: Implicit Mapping and Positioning in Real-Time." ICCV 2021. arXiv:2103.12352. Project: https://edgarsucar.github.io/iMAP/

**What it is:** The seminal paper proving a single MLP can serve as the only scene representation in a real-time SLAM system. The entire scene — geometry and appearance — is encoded in one small fully-connected network trained live from scratch.

**Scene model:** one MLP mapping `(x, y, z)` to density sigma and colour c. No pre-training; trained live on the current environment from an RGB-D sensor (e.g., Kinect).

**Architecture:**

```
RGB-D frames
    |
    v
[Tracking thread, ~10 Hz]
  Optimize camera pose (SE(3)) by differentiating through MLP
  Network weights held fixed during tracking
  Sample ~200 pixels/frame (loss-guided: more samples on high-loss pixels)
    |
    v
[Mapping thread, ~2 Hz]
  Joint optimize: MLP weights + keyframe poses
  Keyframe selection: information-gain criterion
  Keyframe replay: replay past keyframes to prevent forgetting
```

**Loss (both threads):**

```
L = lambda_rgb * L_rgb + lambda_depth * L_depth

L_rgb   = squared error on rendered colour
L_depth = squared error on rendered depth
```

**Benchmarks (Replica, 8 scenes):**
- Depth L1: ~7.64 cm average
- ATE RMSE: ~0.1834 m (iMAP* re-implementation used in later papers)

**Strengths:** first proof-of-concept; compact representation (few MB); smooth surface interpolation with plausible completion of unobserved regions.

**Weaknesses:** catastrophic forgetting without dense keyframe replay; the single global MLP cannot scale beyond small rooms; 2 Hz mapping is too slow for fast motion; fine geometric detail is lost.

---

### NICE-SLAM — Zhu et al., CVPR 2022

**Citation:** Zihan Zhu et al. "NICE-SLAM: Neural Implicit Scalable Encoding for SLAM." CVPR 2022. arXiv:2112.12130. GitHub: https://github.com/cvg/nice-slam

**What it is:** Replaces iMAP's single global MLP with hierarchical feature grids at multiple spatial resolutions, each decoded by a small MLP. Adds a pre-trained geometric prior at the coarse and mid levels.

**Architecture (hierarchical grids):**

```
Input: RGB-D frame
    |
    v
Four feature grid levels:
  Level 0 (coarse, ~1m res)  -- pre-trained occupancy prior
  Level 1 (mid, ~20 cm res)  -- occupancy refinement
  Level 2 (fine, ~4 cm res)  -- geometric detail
  Level 3 (colour, ~4 cm res)-- appearance

Trilinear interpolation + MLP decode -> sigma(x), c(x)
Volume rendering -> C_hat(r), D_hat(r)

Tracking:  optimize pose (grid weights locked)
Mapping:   optimize grid features + keyframe poses (current pose locked)
```

Grid memory: ~12 MB for a Replica room. Hierarchical decomposition means the coarse grid covers large volumes cheaply while the fine grid activates only near surfaces.

**Key improvements over iMAP:**
- Local grid updates reduce catastrophic forgetting substantially
- Scales to room-size and larger scenes
- 10x better ATE RMSE on Replica vs iMAP*

**Speed:** a few minutes per Replica sequence — not real-time. ~5 GB GPU memory per room.

**Benchmarks:**
- Replica ATE RMSE: ~0.0195 m average (vs iMAP* ~0.1834 m)
- Replica Depth L1: ~3.53 cm (vs iMAP* ~7.64 cm)
- TUM fr1/desk ATE: ~2.7 cm; ScanNet ATE: ~9.63 cm

---

### Vox-Fusion — Yang et al., ISMAR 2022

**Citation:** Xingrui Yang et al. "Vox-Fusion: Dense Tracking and Mapping with Voxel-based Neural Implicit Representation." ISMAR 2022. arXiv:2210.15858. GitHub: https://github.com/zju3dv/Vox-Fusion

**What it is:** Introduces sparse octree-based dynamic voxel allocation instead of NICE-SLAM's pre-allocated dense grids. Voxels are grown on-the-fly as new surfaces are observed, so only observed regions consume memory.

**Architecture:**

```
RGB-D frame
    |
    v
Sparse octree (Morton codes)
  -> allocate new leaf nodes on-the-fly at observed surfaces
  -> each node stores a 16-D feature embedding
    |
    v
Neural SDF decoder (shallow MLP, 256 hidden units, skip connection)
  -> SDF value, colour
    |
    v
Tracking:  differentiable volume rendering, 6-DoF pose via Lie algebra backprop
Mapping:   optimize embeddings + decoder weights
```

**Loss (four terms):**

```
L = L_rgb    (L1 colour)
  + L_depth  (L1 depth)
  + L_free   (MSE in free space, within truncation distance)
  + L_sdf    (MSE on SDF values near the surface)
```

**Speed:** tracking ~5 Hz (RTX 3090), mapping ~2 Hz. Multi-process framework for near real-time operation.

**Memory:** decoder ~1.04 MB, voxel embeddings ~0.149 MB — dramatically more compact than NICE-SLAM's grid levels (~238 MB).

**Benchmarks (Replica):**
- ATE RMSE: ~0.0054 m (vs NICE-SLAM ~0.0195 m, iMAP* ~0.1834 m)
- Reconstruction accuracy: ~2.37 cm (NICE-SLAM: 3.87 cm)

**Key contribution:** dynamic sparse allocation. Only observed regions consume memory. This architectural advance directly inspired ESLAM, Co-SLAM, and Point-SLAM.

---

### ESLAM — Johari et al., CVPR 2023

**Citation:** Mohammad Mahdi Johari, Camilla Carta, François Fleuret. "ESLAM: Efficient Dense SLAM System Based on Hybrid Representation of Signed Distance Fields." CVPR 2023. arXiv:2211.11704.

**What it is:** Replaces volumetric feature grids with multi-scale axis-aligned tri-plane feature planes (inspired by EG3D / TensoRF). 12 perpendicular planes at multiple resolutions: 6 for geometry, 6 for appearance. Features are obtained by projecting any 3D point onto each plane pair (XY, XZ, YZ) and bilinearly interpolating.

**Architecture:**

```
Point x = (x, y, z)
    |
    v
Tri-plane projection (12 planes at multiple scales):
  Geometry:   f_geo(x) = interp(P_xy) || interp(P_xz) || interp(P_yz)
  Appearance: f_col(x) = interp(P_xy) || interp(P_xz) || interp(P_yz)
    |
    v
Shallow MLP decoder -> TSDF value, RGB colour
TSDF-style volume rendering + depth/colour losses
```

**Loss:**

```
L = L_depth + lambda_rgb * L_rgb + lambda_free * L_freespace + lambda_sdf * L_sdf
```

No pre-training required.

**Speed:** up to 10x faster than NICE-SLAM and iMAP.

**Benchmarks:**
- Replica Depth L1: ~1.18 cm (vs NICE-SLAM ~2.97 cm)
- TUM ATE RMSE: ~7.89 cm average
- ScanNet ATE RMSE: ~11.3 cm average

---

### Co-SLAM — Wang et al., CVPR 2023

**Citation:** Hengyi Wang, Jingwen Wang, Lourdes Agapito. "Co-SLAM: Joint Coordinate and Sparse Parametric Encodings for Neural Real-Time SLAM." CVPR 2023. arXiv:2304.14377. GitHub: https://github.com/HengyiWang/Co-SLAM

**What it is:** Hybrid dual encoding — combines a multi-resolution hash grid (Instant-NGP style) for high-frequency local detail with a one-blob positional encoding for global scene coherence and hole-filling in unobserved areas.

**Architecture:**

```
Point x
    |
    +-> Multi-resolution hash grid encoding -> f_hash(x)  [fast, local, high-freq]
    |
    +-> One-blob encoding -> f_blob(x)                    [smooth, global, hole-fill]
              |
              v
        Concatenate -> two shallow MLPs
          MLP_sdf: -> SDF value
          MLP_rgb: -> RGB colour
              |
              v
        Volume rendering -> C_hat(r), D_hat(r)
```

**Global bundle adjustment:** performs BA over all keyframes simultaneously (not a windowed active set), made tractable by fast hash-grid convergence. This avoids the keyframe-windowing artifacts of ESLAM and NICE-SLAM.

**Speed:** ~10 Hz overall (tracking ~17 Hz, mapping ~12 Hz on Replica). Dramatically faster than NICE-SLAM (~1 Hz overall).

**Key properties:** the one-blob encoding fills holes in sparsely observed areas; global BA avoids active-set artifacts; scalable to larger scenes without pre-specifying an active keyframe count.

---

### GO-SLAM — Zhang et al., ICCV 2023

**Citation:** Youmin Zhang, Fabio Tosi, Stefano Mattoccia, Matteo Poggi. "GO-SLAM: Global Optimization for Consistent 3D Instant Reconstruction." ICCV 2023. arXiv:2309.02436. GitHub: https://github.com/youmi-zym/GO-SLAM

**What it is:** The first neural-implicit SLAM combining DROID-SLAM-style learned tracking, loop closure detection, and online full global bundle adjustment with a neural implicit map. Supports monocular, stereo, and RGB-D inputs.

**Architecture (three parallel threads):**

```
1. Front-end tracking
   DROID-SLAM GRU optical-flow correlation volumes
   -> per-frame pose estimate

2. Back-end tracking
   Global bundle adjustment over growing pose graph
   Loop closure triggers global BA update

3. Instant mapping
   Instant-NGP hash-grid neural implicit surface
   Updated on-the-fly; on BA update, the map warps globally
   Surface extracted via marching cubes
```

**Speed:** real-time front-end tracking; mapping update involves re-training the hash-grid NeRF for a few iterations per keyframe (fast with Instant-NGP).

**Benchmarks:**
- Replica ATE RMSE: ~0.35 cm average (second-best at time of publication; GO-SLAM's own table)
- ScanNet ATE RMSE: ~7.0 cm (better than ESLAM ~11.3 cm and Point-SLAM ~14.3 cm)

GO-SLAM handles large-scale scenes better than iMAP/NICE-SLAM due to global loop closure. The monocular mode is competitive with RGB-D methods at the cost of scale ambiguity.

---

### Point-SLAM — Sandström et al., ICCV 2023

**Citation:** Erik Sandström, Yue Li, Luc Van Gool, Martin R. Oswald. "Point-SLAM: Dense Neural Point Cloud-based SLAM." ICCV 2023. arXiv:2304.04278. GitHub: https://github.com/eriksandstroem/Point-SLAM

**What it is:** Anchors neural features not in a fixed grid (hash or voxel) but in a dynamically grown neural point cloud. Point density adapts to input information density — dense near edges and textures, sparse in smooth regions — without pre-specifying any grid resolution.

**Architecture:**

```
RGB-D frame
    |
    v
Tracking: minimize RGBD re-rendering loss w.r.t. camera pose
  (no dedicated tracking module; uses same neural point representation)
    |
    v
Point cloud growth: add new anchor points for newly observed regions
    |
    v
Feature update: optimize per-point geometry + colour descriptors
    |
    v
Render new views: query k-nearest points, interpolate features, MLP decode
```

Both tracking and mapping use the same representation and loss — no separate tracking network.

**Benchmarks (Loopy-SLAM comparison table, Replica):**
- Depth L1: 0.44 cm (second-best prior to Loopy-SLAM)
- ATE RMSE: ~0.52 cm
- PSNR: ~35.17 dB (close to Loopy-SLAM's 35.47 dB)
- TUM ATE: ~8.92 cm; ScanNet ATE: ~14.3 cm

Point-SLAM achieves the best reconstruction quality (depth L1, PSNR) in the NeRF-SLAM family prior to Loopy-SLAM.

---

### Loopy-SLAM — Liso et al., CVPR 2024

**Citation:** Lorenzo Liso, Erik Sandström, Vladimir Yugay, Luc Van Gool, Martin R. Oswald. "Loopy-SLAM: Dense Neural SLAM with Loop Closures." CVPR 2024, pp. 20363–20373. arXiv:2402.09944. GitHub: https://github.com/eriksandstroem/Loopy-SLAM

**What it is:** Extends Point-SLAM with a sub-map architecture and online loop closure. The scene is divided into overlapping neural point-cloud sub-maps; a bag-of-visual-words database triggers loop closure; pose graph optimization with robust line-process outlier rejection aligns sub-maps rigidly.

**Architecture:**

```
Scene -> overlapping neural point-cloud sub-maps
  (each sub-map = same neural point representation as Point-SLAM)
    |
    v
Global keyframe trigger:
  rotation > 20 deg OR translation > 0.3 m
    |
    v
Place recognition (bag-of-visual-words database)
  -> loop detected?
        |
        v   (if yes)
Pose graph optimization (robust, line process for outlier rejection)
Dense TSDF-fused point cloud registration
Sub-map rigid alignment
```

Since the representation is point-based (not a grid), rigid sub-map alignment corrects the entire map without storing the full frame history.

**Benchmarks (Replica — best in NeRF-SLAM family):**
- Depth L1: **0.35 cm** (vs Point-SLAM 0.44, ESLAM 1.18, NICE-SLAM 2.97)
- ATE RMSE: **0.29 cm** (vs GO-SLAM 0.35, Point-SLAM 0.52)
- PSNR: **35.47 dB** (vs Point-SLAM 35.17, ESLAM 27.8)
- TUM ATE: **3.85 cm** (vs ESLAM 7.89, Point-SLAM 8.92)
- ScanNet ATE: **7.7 cm** (vs GO-SLAM 7.0, ESLAM 11.3, Point-SLAM 14.3)

Loopy-SLAM is the apex of the NeRF-SLAM lineage on standard indoor benchmarks. It was published at the same CVPR 2024 where the field pivoted to 3DGS-SLAM (SplaTAM, MonoGS, GS-SLAM all appeared at the same conference).

---

## Benchmark Results

### Standard Benchmark Datasets

| Dataset | Type | Scenes | Primary Use |
|---|---|---|---|
| Replica | Synthetic RGB-D | 8 indoor rooms | Dense reconstruction gold standard |
| TUM RGB-D | Real RGB-D | 3 sequences | Tracking robustness, real sensor noise |
| ScanNet | Real RGB-D | 18 scenes | Large-scale real indoor |
| 7-Scenes | Real RGB-D | 7 scenes | Relocalization and tracking accuracy |

### Replica Benchmark — Full Family Comparison

Ordered by Depth L1 (smaller is better). Sources: Loopy-SLAM paper (arXiv:2402.09944) and SplaTAM paper (arXiv:2312.02126).

| Method | Venue | Depth L1 (cm) | ATE RMSE (cm) | PSNR (dB) | Representation |
|---|---|---|---|---|---|
| iMAP* | ICCV 2021 | ~7.64 | ~18.34 | ~19.7 | Single global MLP |
| NICE-SLAM | CVPR 2022 | ~2.97 | ~1.95 | ~24.4 | Hierarchical feature grids |
| ESLAM | CVPR 2023 | ~1.18 | ~0.71 | ~27.8 | Tri-plane SDF |
| Vox-Fusion | ISMAR 2022 | ~0.54 | ~0.54 | ~24.4 | Sparse voxel SDF |
| Co-SLAM | CVPR 2023 | ~0.50 | ~0.78 | ~27.0 | Hash + one-blob, global BA |
| GO-SLAM | ICCV 2023 | ~0.41 | ~0.35 | ~26.4 | Loop closure + Instant-NGP |
| Point-SLAM | ICCV 2023 | 0.44 | ~0.52 | 35.17 | Neural point cloud |
| Loopy-SLAM | CVPR 2024 | **0.35** | **0.29** | **35.47** | Sub-map loop closure |
| SplaTAM (3DGS) | CVPR 2024 | ~0.36 | ~0.31 | ~34.11 | 3DGS representation |

Notes: numbers are averages over 8 Replica scenes; per-scene values vary. SplaTAM included for 3DGS context. "iMAP*" is a re-implementation used as a baseline by later papers.

### Speed Comparison

| Method | Tracking | Mapping | Overall |
|---|---|---|---|
| iMAP | ~10 Hz | ~2 Hz | sub-real-time |
| NICE-SLAM | — | — | minutes per sequence |
| Vox-Fusion | ~5 Hz | ~2 Hz | near real-time |
| ESLAM | — | — | ~10x faster than NICE-SLAM |
| Co-SLAM | ~17 Hz | ~12 Hz | ~10 Hz overall |
| GO-SLAM | near RT | fast | near real-time |
| Point-SLAM | moderate | moderate | slower than Co-SLAM |
| Loopy-SLAM | — | — | similar to Point-SLAM |
| SplaTAM (3DGS) | — | — | ~0.3–0.5 FPS (SLAM loop) |

Observation: SplaTAM and other first-wave 3DGS-SLAM systems have faster rendering (100+ FPS for view synthesis) but the SLAM optimization loop runs at only 0.3–0.5 FPS on current hardware — slower than Co-SLAM's ~10 Hz. The primary advantage of 3DGS for SLAM is rendering speed and reconstruction quality, not SLAM-loop throughput.

### NeRF-SLAM (Rosinol) Specific Results

Evaluated on TUM RGB-D and ScanNet in monocular mode. Against competing monocular dense methods:
- Up to ~179% better PSNR
- Up to ~75–86% better depth L1 accuracy

Direct ATE comparison to iMAP/NICE-SLAM is not the paper's focus because those are RGB-D systems; Rosinol et al. compare primarily to other monocular dense SLAM pipelines.

---

## Speed and Compute

**NeRF-SLAM (Rosinol):** GPU-intensive. DROID-SLAM front-end tracks near real-time; Instant-NGP NeRF back-end is the bottleneck. The full pipeline has GPU memory pressure from both DROID's correlation volumes and the volumetric rendering buffers. Authors note "This is a GPU memory intensive pipeline." No explicit FPS quoted in the arXiv paper; IROS version claims near real-time for monocular mode on TUM/ScanNet on a modern GPU.

**Family pattern:** the jump from iMAP (2 Hz mapping) to NICE-SLAM (minutes) to Co-SLAM (12 Hz) reflects the shift from single MLP to dense grids to sparse hash grids. Instant-NGP hash grids are the key enabler of near-real-time neural implicit SLAM. LiDAR-primary competitors (FAST-LIO2, KISS-ICP) operate at 10–50 Hz on embedded hardware without GPU bottlenecks.

---

## Strengths

1. **Dense reconstruction quality.** NeRF-based maps produce smooth, complete, photorealistic meshes. Depth L1 of 0.35 cm (Loopy-SLAM) on Replica beats classical TSDF methods.
2. **Implicit completion.** Unobserved regions are filled in plausibly from the MLP/grid prior — useful for planning and digital twin construction.
3. **Differentiable end-to-end.** Camera pose, geometry, and appearance are jointly optimized via the same differentiable rendering equation.
4. **No depth sensor required** (for Rosinol et al. and GO-SLAM monocular variants). Useful for platforms where adding a depth camera is impractical.
5. **Compact storage.** Neural representations are more compact than explicit dense point clouds at equivalent resolution (e.g., 12 MB for a Replica room in NICE-SLAM).
6. **Uncertainty-weighted supervision (NeRF-SLAM, Rosinol).** Using DROID-SLAM posterior covariance to gate depth supervision is a transferable idea: weight geometric supervision by how reliable each measurement is.
7. **Historical baseline.** All 3DGS-SLAM papers (Splat-SLAM, GS-SLAM, MonoGS) benchmark against NeRF-SLAM family members. Understanding this lineage is necessary to evaluate claims of improvement.

---

## Failure Modes

**1. Compute and memory.** Training a NeRF continuously requires high-end GPU (RTX 3090 class). iMAP and NICE-SLAM are far from real-time; even hash-grid methods require high-end hardware. Not viable on embedded automotive compute platforms without radical quantization.

**2. Dynamic scenes.** NeRF assumes a static world. Moving objects (aircraft, GSE, people, vehicles) cause ghost artifacts and corrupted geometry. No native dynamic-object handling in any standard NeRF-SLAM system.

**3. Large outdoor scenes.** Single-room Replica and TUM are the standard benchmarks. Large outdoor scenes are poorly suited to single-MLP or fixed-resolution grids. Sub-map approaches (Vox-Fusion, GO-SLAM, Loopy-SLAM) partially address this but remain research-stage for outdoor scale.

**4. No native LiDAR.** All standard NeRF-SLAM methods are RGB-D or monocular. LiDAR variants (NeRF-LOAM, PIN-SLAM) exist but are architecturally separate and research-stage. For airside AV where LiDAR-primary SLAM is required, classical methods remain the production baseline.

**5. Loop closure absent in early methods.** Drift accumulates over long trajectories. GO-SLAM and Loopy-SLAM add loop closure, but this arrived late in the lineage.

**6. Scale ambiguity (monocular variants).** NeRF-SLAM by Rosinol and GO-SLAM monocular mode inherit monocular scale ambiguity. Metric depth is not recoverable without a calibrated depth sensor or IMU.

**7. Textureless surfaces.** Photometric gradient signal vanishes on blank walls, runways, and concrete aprons. Tracking and mapping both degrade. This is a fundamental architectural limit of photometric neural SLAM — not addressable within the NeRF framework without an independent geometric sensor.

**8. Reflective and transparent surfaces.** NeRF's view-dependent colour model can represent reflections but geometry becomes ambiguous. Tracking fails at glass windows and aircraft skins.

**9. Outdoor unbounded scenes.** Vanilla NeRF uses bounded scene assumptions; unbounded variants (nerfacto, mip-NeRF 360) have not been integrated into SLAM pipelines as of mid-2024.

**10. Catastrophic forgetting.** The single-MLP limit (iMAP); substantially mitigated by local structures in successors, but replay of past keyframes remains necessary in all methods.

---

## LiDAR-Specific Neural-Implicit Variants

Standard NeRF-SLAM methods are vision-primary (RGB-D or monocular). For airside and outdoor AV applications requiring LiDAR-primary pipelines, two research-stage variants exist:

### NeRF-LOAM (ICCV 2023)

**Citation:** Junyuan Deng et al. "NeRF-LOAM: Neural Implicit Representation for Large-Scale Incremental LiDAR Odometry and Mapping." ICCV 2023. arXiv:2303.10709. GitHub: https://github.com/JunyuanDeng/NeRF-LOAM

Three modules: neural odometry, neural mapping, mesh reconstruction. Separates LiDAR points into ground and non-ground to reduce Z-axis drift. Sparse octree-based voxels with neural SDF. Pre-training free; joint optimization of odometry and voxel embeddings. Designed for large-scale outdoor LiDAR sequences (KITTI, MaiCity, Newer College).

**Status:** research-stage. No production deployment known as of mid-2024.

### PIN-SLAM (TRO 2024)

**Citation:** Yue Pan et al. "PIN-SLAM: LiDAR SLAM Using a Point-Based Implicit Neural Representation for Achieving Global Map Consistency." IEEE Transactions on Robotics, 2024. arXiv:2401.09101. GitHub: https://github.com/PRBonn/PIN_SLAM

Elastic sparse neural points (analogous to Point-SLAM but for LiDAR). Alternates between incremental SDF learning and pose estimation via correspondence-free point-to-implicit-model registration. Loop closure deforms the point cloud. Runs at sensor frame rate on a moderate GPU.

**Status:** research-stage. The strongest LiDAR neural-implicit SLAM as of mid-2024, but not deployed in production.

### Assessment

LiDAR neural-implicit SLAM is 1–2 years behind vision-based NeRF-SLAM in maturity. PIN-SLAM is the most deployable but remains research-stage. For airside AV where LiDAR-primary SLAM is required, classical methods ([KISS-ICP](kiss-icp.md), [FAST-LIO2](fast-lio-fast-lio2.md)) remain the recommended production baseline. Neural-implicit LiDAR SLAM is useful for dense surface recovery as a post-processing step, not as the primary localization pipeline.

---

## Lineage and Context

The neural-implicit-mapping SLAM lineage, with the 3DGS-SLAM pivot:

```
2021
  iMAP (ICCV 2021)
    Single MLP, proof-of-concept
    10 Hz tracking / 2 Hz mapping
    Catastrophic forgetting, small scenes only

2022
  NICE-SLAM (CVPR 2022)
    Hierarchical feature grids, scalable, pre-trained priors
    10x better ATE vs iMAP; minutes per sequence, not real-time

  Vox-Fusion (ISMAR 2022)
    Sparse octree + dynamic allocation, SDF
    Better ATE; near real-time tracking

2023 (dense wave)
  ESLAM (CVPR 2023)
    Tri-plane SDF, 10x faster than NICE-SLAM, no pre-training

  Co-SLAM (CVPR 2023)
    Hash + one-blob hybrid, global BA, ~10 Hz

  GO-SLAM (ICCV 2023)
    Loop closure + global BA + Instant-NGP; monocular/stereo/RGB-D

  Point-SLAM (ICCV 2023)
    Neural point cloud, adaptive density, best PSNR before Loopy-SLAM

  NeRF-SLAM Rosinol et al. (IROS 2023)
    DROID-SLAM + Instant-NGP, monocular, uncertainty depth loss

  NeRF-LOAM (ICCV 2023)
    LiDAR-primary variant (separate lineage)

2024 (final NeRF generation + field pivot)
  Loopy-SLAM (CVPR 2024)
    Sub-map loop closure on point-cloud implicit, best Replica ATE

  PIN-SLAM (TRO 2024)
    LiDAR neural implicit, production-nearest
         |
         v   FIELD PIVOTS TO 3DGS-SLAM
  SplaTAM (CVPR 2024)          [see splat-slam.md for full page]
  GS-SLAM / MonoGS (CVPR 2024) [see gs-slam-monogs.md]
  MASt3R-SLAM (2024)           [see mast3r-slam.md]
```

The NeRF-SLAM lineage does not continue as a primary research direction after 2024. Active work is in 3DGS-SLAM and feed-forward SLAM (MASt3R-SLAM, Spann3R). NeRF-SLAM remains relevant as the historical origin of the neural-implicit-mapping SLAM concept, as a baseline in benchmark tables, and as the foundation of LiDAR-neural-implicit variants that remain active.

**Why 3DGS superseded NeRF for SLAM rendering.** NeRF uses ray-based volume rendering: march N samples per ray, query the MLP or grid N times per pixel — O(rays x samples). Even optimized NeRFs require seconds per frame at SLAM quality. 3DGS uses tile-based rasterization: project Gaussian ellipsoids onto screen tiles, alpha-composite front-to-back, CUDA-parallelized. Rasterization speed comparison on Replica: GS-SLAM rasterization alone achieves 386 FPS vs Point-SLAM (NeRF-based) at 0.42 FPS — approximately 920x faster for the rendering step alone.

However, the rendering quality advantage of 3DGS over late-stage NeRF-SLAM is smaller than often stated:
- SplaTAM PSNR on Replica: ~34.11 dB vs Point-SLAM ~35.17 dB and Loopy-SLAM ~35.47 dB
- SplaTAM ATE on Replica: ~0.31 cm — close to GO-SLAM ~0.35 cm and Loopy-SLAM ~0.29 cm

The primary reason for the pivot is engineering tractability and speed of novel-view rendering, not necessarily better SLAM accuracy.

---

## Domain Fit

| Domain | Fit | Key Notes |
|---|---|---|
| Indoor rooms / labs | Good (research) | Standard benchmark setting; Replica/TUM RGB-D representative |
| Building-scale indoor | Conditional | Loop closure needed; GO-SLAM and Loopy-SLAM handle this |
| Airside hangar / terminal (offline appearance) | Conditional | Useful for appearance digital twin only; needs LiDAR pose source |
| Airside apron (primary SLAM) | Not suitable | Low texture, dynamic GSE, no LiDAR support, scale ambiguity |
| Road AV (offline appearance layer) | Research | Camera-only; superseded by 3DGS-based offline reconstruction |
| Road AV (online primary localization) | Not suitable | Not real-time; no LiDAR; no safety-critical sensor fusion |
| Warehouse / port (short-range indoor) | Conditional | Viable in static, textured areas; dynamic fork trucks need masking |
| Agriculture / construction | Not suitable | Outdoor scale, weather, dynamic machinery, vegetation |
| Simulation asset generation | Good (research) | View synthesis, digital twin from controlled captures |

---

## Aggregated-Map Suitability: The Honest Assessment

**NeRF-SLAM is an appearance and dense reconstruction supplement, not a LiDAR-primary localization front-end.** Its role in an AV stack context:

**1. Research baseline.** All 3DGS-SLAM papers (Splat-SLAM, GS-SLAM/MonoGS, MASt3R-SLAM) benchmark against NeRF-SLAM family members. Understanding NeRF-SLAM is prerequisite to evaluating those systems.

**2. Dense surface recovery from cameras.** Where a camera-only dense 3D model is needed to supplement a LiDAR geometry map (e.g., visual appearance capture of ramp-area markings, stand structures, indoor service spaces), NeRF-SLAM-derived pipelines are relevant — but offline reconstruction (nerfstudio, Gaussian Splatting) is simpler and better quality than live SLAM for that purpose.

**3. NOT recommended for primary localization.** All NeRF-SLAM systems are RGB-D or monocular. LiDAR is not consumed. Rosinol's NeRF-SLAM uses DROID-SLAM (visual odometry) as the front-end — it degrades in low-light, fog, and jet-blast dust conditions characteristic of airside environments where LiDAR excels.

**4. 3DGS has largely superseded NeRF for the appearance-layer use case:**
- Faster rendering (view synthesis for map annotation and digital twin)
- Comparable or slightly better reconstruction quality at higher speed
- 3DGS primitives are explicit and more tractable for geometric analysis
- For the role of "visual-appearance-layer over a LiDAR map," choose 3DGS-based offline reconstruction or Gaussian-LIC/LVI-GS over NeRF-SLAM

**5. NeRF-SLAM as research baseline only.** Still used as a comparison point in 2024–2025 papers. Understanding the lineage is necessary to assess claims of improvement.

**Recommended integration path for airside digital twin** (if appearance layer is needed):

```
Step 1: LIO front-end (FAST-LIO2 or KISS-ICP)
        -> precise metric pose + dense LiDAR point cloud
        -> loop closure and global consistency from LiDAR pose graph

Step 2: 3DGS appearance layer (Gaussian-LIC or LVI-GS)
        -> use LIO poses to seed 3D Gaussians from colorized LiDAR points
        -> optimize photometric appearance with LiDAR depth supervision
        -> sky hemisphere prior; dynamic-object mask applied pre-optimization

Step 3: Output
        -> metric geometry from LiDAR (primary)
        -> photo-realistic appearance from 3DGS layer (secondary)
        -> digital twin: novel-view synthesis, semantic overlay,
           change detection, synthetic data generation
```

NeRF-SLAM's uncertainty-weighted depth supervision idea (weight geometric supervision by sensor reliability) is transferable to this LiDAR-augmented 3DGS pipeline.

See [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) for downstream use of such maps, and [Splat-SLAM](splat-slam.md) for the Gaussian-LIC/LVI-GS integration paths.

---

## Implementation Notes

- Use `ToniRV/NeRF-SLAM` (BSD-2-Clause) as research code, not a deployment component. It includes DROID-SLAM and Instant-NGP as submodules; build requires careful CUDA/PyTorch version pinning.
- The Sigma-Fusion path (`--fusion='sigma'`) swaps the NeRF back-end for classical TSDF fusion using the same uncertainty-weighted depth. Useful for faster experiments without NeRF rendering quality.
- The repository also includes GTSAM-based experimentation for pose-graph components. Document which path is being evaluated.
- For trajectory ATE comparisons: monocular systems must use Sim(3) alignment (or scale-aware alignment) before reporting ATE; SE(3) alignment produces misleading numbers for monocular pipelines.
- When evaluating reconstruction quality: report Depth L1, PSNR, SSIM, and LPIPS together — PSNR alone can hide geometric errors if the appearance model compensates.
- For airside research use: collect raw imagery with a separate metric pose source (LiDAR-inertial or RTK), use NeRF-SLAM for offline reconstruction, and validate geometry against measured depth/LiDAR before any operational use.
- For the iMAP/NICE-SLAM/Co-SLAM family (`cvg/nice-slam`, `HengyiWang/Co-SLAM`): these expect RGB-D input. Switch to Rosinol's NeRF-SLAM or GO-SLAM for monocular experiments.
- NerfBridge (arXiv:2305.09761, `javieryu/nerf_bridge`) provides a ROS2 ↔ Nerfstudio bridge for live NeRF training from a robot's camera stream with external pose (from odometry). Useful for rapid prototyping of NeRF-in-the-loop experiments; not a full SLAM system.
- PIN-SLAM (`PRBonn/PIN_SLAM`) and NeRF-LOAM (`JunyuanDeng/NeRF-LOAM`) are the recommended starting points for LiDAR neural-implicit experiments, but treat both as research code.

---

## Sources

| Resource | URL |
|---|---|
| NeRF-SLAM (Rosinol) arXiv | https://arxiv.org/abs/2210.13641 |
| NeRF-SLAM GitHub | https://github.com/ToniRV/NeRF-SLAM |
| iMAP arXiv | https://arxiv.org/abs/2103.12352 |
| iMAP project page | https://edgarsucar.github.io/iMAP/ |
| NICE-SLAM arXiv | https://arxiv.org/abs/2112.12130 |
| NICE-SLAM GitHub | https://github.com/cvg/nice-slam |
| Vox-Fusion arXiv | https://arxiv.org/abs/2210.15858 |
| Vox-Fusion GitHub | https://github.com/zju3dv/Vox-Fusion |
| ESLAM arXiv | https://arxiv.org/abs/2211.11704 |
| Co-SLAM arXiv | https://arxiv.org/abs/2304.14377 |
| Co-SLAM GitHub | https://github.com/HengyiWang/Co-SLAM |
| GO-SLAM arXiv | https://arxiv.org/abs/2309.02436 |
| GO-SLAM GitHub | https://github.com/youmi-zym/GO-SLAM |
| Point-SLAM arXiv | https://arxiv.org/abs/2304.04278 |
| Point-SLAM GitHub | https://github.com/eriksandstroem/Point-SLAM |
| Loopy-SLAM arXiv | https://arxiv.org/abs/2402.09944 |
| Loopy-SLAM GitHub | https://github.com/eriksandstroem/Loopy-SLAM |
| NeRF-LOAM arXiv | https://arxiv.org/abs/2303.10709 |
| NeRF-LOAM GitHub | https://github.com/JunyuanDeng/NeRF-LOAM |
| PIN-SLAM arXiv | https://arxiv.org/abs/2401.09101 |
| PIN-SLAM GitHub | https://github.com/PRBonn/PIN_SLAM |
| NerfBridge arXiv | https://arxiv.org/abs/2305.09761 |
| NerfBridge GitHub | https://github.com/javieryu/nerf_bridge |
| Instant-NGP | https://nvlabs.github.io/instant-ngp/ |
| Survey: NeRFs and 3DGS in SLAM | https://arxiv.org/abs/2402.13255 |
| CVPR 2024 Benchmark paper | https://arxiv.org/html/2403.19473v1 |
| awesome-NeRF-and-3DGS-SLAM | https://github.com/3D-Vision-World/awesome-NeRF-and-3DGS-SLAM |

- Local context: [Splat-SLAM](splat-slam.md) — iter-18 3DGS-SLAM deep dive; LiDAR-augmented 3DGS integration paths
- Local context: [GS-SLAM and MonoGS](gs-slam-monogs.md) — iter-26; first-wave 3DGS-SLAM
- Local context: [MASt3R-SLAM](mast3r-slam.md) — iter-24 feed-forward SLAM; successor direction
- Local context: [DROID-SLAM](droid-slam.md) — iter-25; the learned-flow front-end used by NeRF-SLAM and GO-SLAM
- Local context: [NICE-SLAM](nice-slam.md) — hierarchical-grid predecessor
- Local context: [Co-SLAM and ESLAM](co-slam-eslam.md) — hash-grid and tri-plane variants
- Local context: [KISS-ICP](kiss-icp.md) — iter-20; LiDAR-primary production odometry
- Local context: [FAST-LIO / FAST-LIO2](fast-lio-fast-lio2.md) — iter-22; LiDAR-inertial primary localization
- Local context: [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) — downstream use of appearance maps
- Local context: [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md) — iter-16 3DGS first principles
- Local context: [Volume Rendering, Radiance Fields, and Gaussian Splatting](../../../10-knowledge-base/geometry-3d/volume-rendering-radiance-fields-gaussian-splatting.md) — NeRF and 3DGS representation background
- Local context: [Gaussian Splatting for Driving](../../perception/overview/gaussian-splatting-driving.md)
