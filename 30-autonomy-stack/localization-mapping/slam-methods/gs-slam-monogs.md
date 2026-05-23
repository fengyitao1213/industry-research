# GS-SLAM and MonoGS

<!-- method-priority:start
priority:
  learning: 3
  deployment: 2
  type: "method-family"
  stage: "frontier"
  maturity: "research"
  tags: ["slam", "mapping", "simulation", "validation"]
  reason: "GS-SLAM and MonoGS is rated for neural or Gaussian SLAM research and future dense map representation workflows."
method-priority:end -->

Related docs: [Splat-SLAM](splat-slam.md) · [MASt3R-SLAM](mast3r-slam.md) · [DROID-SLAM](droid-slam.md) · [SplaTAM](splatam.md) · [Photo-SLAM](photo-slam.md) · [NeRF-SLAM](nerf-slam.md) · [KISS-ICP](kiss-icp.md) · [FAST-LIO / FAST-LIO2](fast-lio-fast-lio2.md) · [Learned LiDAR Place Recognition](learned-lidar-place-recognition.md) · [ORB-SLAM2 / ORB-SLAM3](orb-slam2-orb-slam3.md) · [Dynamic-Object-Aware SLAM](dynamic-object-aware-slam.md) · [Semantic SLAM](semantic-slam.md) · [Production LiDAR Map Localization](../overview/production-lidar-map-localization.md) · [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [Gaussian Splatting for Driving](../../perception/overview/gaussian-splatting-driving.md) · [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md) · [Volume Rendering, Radiance Fields, and Gaussian Splatting](../../../10-knowledge-base/geometry-3d/volume-rendering-radiance-fields-gaussian-splatting.md) · [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md)

**Last updated:** 2026-05-23

---

## What It Is

GS-SLAM (Yan et al., CVPR 2024 Highlight) and MonoGS — formally "Gaussian Splatting SLAM" (Matsuki et al., CVPR 2024 Highlight + Best Demo Award) — are the two most technically distinct first-wave 3D Gaussian Splatting SLAM systems, both published at CVPR 2024. They arrived within weeks of each other and together establish two competing philosophies for how Gaussian representations can be integrated into a SLAM loop.

**GS-SLAM** focuses on RGB-D dense visual SLAM with a self-regulating map: an adaptive expansion module that grows and prunes the Gaussian map online, paired with a two-stage coarse-to-fine tracker that keeps the per-frame pose update cheap. It achieves 8.34 FPS end-to-end on Replica — the fastest among the CVPR 2024 trio — and 386 FPS rasterization-only throughput.

**MonoGS** solves a harder problem: running Gaussian SLAM from monocular video alone, with RGB-D and stereo as additional modes in a single unified framework. Its central contribution is the first analytical SE(3) Lie-group Jacobian for the 3DGS splatting model, enabling direct CUDA pose optimization without autodiff and delivering a wide convergence basin (82% success at up to 1.2 m displacement). MonoGS achieves 769 FPS rasterization and the best PSNR on Replica at CVPR 2024 time (37.50 dB), at the cost of 2.5 FPS end-to-end — the slowest of the trio.

Neither system has loop closure, outdoor testing, or ScanNet evaluation. Both are research-stage as primary AV localization. Their best-fit role in a production-adjacent stack is as an **appearance layer** (photo-realistic Gaussian digital twin) anchored to a LiDAR-primary geometry pipeline.

---

## Historical Context

The original 3D Gaussian Splatting paper (3DGS, Kerbl et al. SIGGRAPH 2023) made real-time radiance-field rendering practical by replacing implicit neural volume rendering with explicit anisotropic Gaussian primitives and a tile-based CUDA rasterizer. SLAM researchers immediately explored whether Gaussians could act as the online map in a tracking-and-mapping loop, rather than a post-hoc reconstruction target.

By late 2023, four groups submitted Gaussian SLAM papers converging at CVPR 2024: SplaTAM, GS-SLAM, MonoGS, and Gaussian-SLAM. GS-SLAM and MonoGS received Highlight; MonoGS additionally won Best Demo. Together with SplaTAM and Photo-SLAM these define the "first wave": visually compelling, GPU-bound, drift-limited, loop-closure-free systems. Subsequent work (Splat-SLAM CVPR 2025W, LoopSplat 3DV 2025, RTG-SLAM SIGGRAPH 2024, DROID-Splat ICCV 2025W) addresses the main gap — loop closure — building directly on GS-SLAM and MonoGS.

For the SE(3) Lie group math underpinning the MonoGS Jacobian see [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md). For the 3DGS representation see [Volume Rendering, Radiance Fields, and Gaussian Splatting](../../../10-knowledge-base/geometry-3d/volume-rendering-radiance-fields-gaussian-splatting.md).

---

## Part A — GS-SLAM (Yan et al., CVPR 2024)

### What It Is

**Full citation:** Chi Yan, Delin Qu, Dan Xu, Bin Zhao, Zhigang Wang, Dong Wang, Xuelong Li. "GS-SLAM: Dense Visual SLAM with 3D Gaussian Splatting." CVPR 2024 (Highlight).

- arXiv: https://arxiv.org/abs/2311.11700
- CVF Open Access: https://openaccess.thecvf.com/content/CVPR2024/html/Yan_GS-SLAM_Dense_Visual_SLAM_with_3D_Gaussian_Splatting_CVPR_2024_paper.html
- Project page: https://gs-slam.github.io/
- Custom rasterizer: https://github.com/yanchi-3dv/diff-gaussian-rasterization-for-gsslam

**Modality:** RGB-D only. No monocular mode. Requires registered depth.

**Core claim:** First SLAM system using 3D Gaussian Splatting as the sole map representation with an adaptive expansion/deletion strategy and a coarse-to-fine pose tracker, achieving 8.34 FPS end-to-end.

### Core Technical Idea

GS-SLAM has two interlocking mechanisms that distinguish it from plain per-frame Gaussian rendering:

**1. Adaptive Gaussian expansion.** Rather than treating the map as a static asset optimized offline, GS-SLAM regulates the map online with explicit add and delete criteria. New Gaussians are seeded wherever the current Gaussian field is a poor model of what the depth sensor sees; old Gaussians that are occluded or floating are opacity-decayed to zero and pruned. This keeps the map parsimonious and geometrically grounded throughout the run.

**2. Coarse-to-fine tracking.** Per-frame pose optimization against the full-resolution Gaussian map is expensive and gradient-unstable near poorly-initialized Gaussians. GS-SLAM solves this by doing a cheap coarse optimization at half resolution first, landing in the convergence basin, then refining against only those Gaussians whose rendered depth is consistent with the sensor — the "reliable subset."

Together these give GS-SLAM the fastest end-to-end throughput in the CVPR 2024 cohort.

### Inputs and Outputs

**Inputs:**
- Registered RGB-D stream (color + aligned depth)
- Known camera intrinsics
- GPU with CUDA (reported: RTX 4090 + Intel i9-13900K)

**Outputs:**
- Camera trajectory: per-keyframe SE(3) poses
- 3DGS map: per-Gaussian (mu, Sigma, Lambda, Y) tuples
- Differentiable renders: RGB, depth, silhouette

### Architecture

```
RGB-D frame
    |
    v
[Coarse-to-Fine Tracker]
  Stage 1: render at H/2 x W/2 -> pose T_c (T_c iterations)
  Stage 2: reliable Gaussians only, full resolution -> pose T_f (T_f iterations)
    |
    v
[Keyframe Selection]
  overlap / distance threshold
    |
    +--> [Adaptive Expansion Module]
    |      Add: flag pixels where T(p) < tau_T OR |D(p) - D_hat(p)| > tau_D
    |           back-project flagged pixels -> seed new Gaussian (opacity 0.5)
    |      Delete: |D(p) - dist(X_i, P_uv)| > gamma -> Lambda_i <- eta * Lambda_i
    |
    v
[Bundle Adjustment — Phased]
  K random keyframes
  Phase 1 (first half iters): optimize Gaussian params only, poses fixed
  Phase 2 (second half iters): joint Gaussian + pose optimization
    |
    v
[3DGS Map]
  per-Gaussian: mu in R^3, Sigma = R S S^T R^T, Lambda (opacity), Y in R^12 (SH-1)
    |
    v
[Differentiable Rasterizer — custom CUDA tile-based]
  alpha-blending: C_hat, D_hat at 386 FPS
```

No loop closure. No pose graph. Purely local sliding-window optimization.

### Operator Mechanics

**Scene representation.** Each Gaussian is a 7-tuple plus spherical harmonic color:
- Position: `mu_i in R^3`
- Covariance: `Sigma_i = R_i S_i S_i^T R_i^T` where `S_i = diag(s1, s2, s3)` and `R_i` is stored as a unit quaternion
- Opacity: `Lambda_i in R`
- Color: `Y_i in R^12` — degree-1 SH, 4 coefficients per RGB channel

The 3D density kernel:
```
g_i(x) = exp(-0.5 * (x - mu_i)^T * Sigma_i^{-1} * (x - mu_i))
```

Alpha-blending (front-to-back depth-sorted):
```
C_hat(p) = sum_i  c_i * alpha_i * prod_{j < i} (1 - alpha_j)
D_hat(p) = sum_i  d_i * alpha_i * prod_{j < i} (1 - alpha_j)
alpha_i  = Lambda_i * g_i(pixel p projected to 3D)
```

A light variant uses degree-0 SH (3 RGB scalars per Gaussian instead of 12), dropping memory from 198 MB to ~19 MB on Replica Room 0 with minor quality loss.

**Adaptive expansion — add criterion (Eq. 8).** A pixel `p` is flagged as unreliable if EITHER:
```
T(p) < tau_T      (accumulated transmittance too low; map under-reconstructed here)
OR
|D(p) - D_hat(p)| > tau_D   (sensor depth and rendered depth disagree)
```
Flagged pixels are back-projected and used to seed a new Gaussian with small initial scale and opacity 0.5. At the first keyframe, all H×W pixels are seeded; subsequent keyframes seed only the unreliable mask. Exact values of `tau_T`, `tau_D` are not published numerically in the paper.

**Adaptive expansion — delete criterion.** A Gaussian at world position `X_i` projecting to pixel `P_uv` is decayed if its depth residual exceeds a threshold (the Gaussian is occluded or a floater):
```
if D(p) - dist(X_i, P_uv) > gamma:
    Lambda_i <- eta * Lambda_i    (eta << 1)
```
After repeated decays the opacity falls below the rasterizer's visibility cutoff and the Gaussian is pruned. `gamma` and `eta` are implementation hyperparameters not disclosed in the paper.

**Coarse-to-fine tracking.** Stage 1 renders the Gaussian map at half resolution (H/2 × W/2) and minimizes a combined L1 photometric + depth loss to produce a rough pose `T_c` in `T_c` iterations. Stage 2 restricts the map to *reliable Gaussians* — those whose rendered depth `d_i` satisfies `|D_i - d_i| <= epsilon` with the sensor depth — and refines at full resolution for `T_f` iterations. Implementation evidence suggests `T_c ~ 5` and `T_f ~ 25`, but these are not stated in the paper.

**Tracking loss:**
```
L_track = sum_m |C_m - C_hat_m|_1  +  sum_m |D_m - D_hat_m|_1
```
Equal-weight L1 photometric + L1 depth (color and depth terms, no published lambda between them).

**Phased bundle adjustment loss:**
```
L_ba = (1/K) * sum_k sum_m [ |D_m - D_hat_m|_1 + lambda_m * |C_m - C_hat_m|_1 ]
```
`lambda_m` is a per-pixel photometric weight not numerically stated in the main text. Phasing: first half of BA iterations optimize Gaussian geometry/color/opacity with poses fixed; second half jointly optimize all. This graduated strategy prevents early pose corruption from poorly-initialized Gaussians. No isotropic regularization term — GS-SLAM relies on the adaptive delete criterion rather than shape penalties to suppress degenerate Gaussians.

### Benchmark Results

Hardware: NVIDIA RTX 4090 + Intel Core i9-13900K.

**Replica — Tracking ATE RMSE [cm]:**

| Scene | GS-SLAM | Point-SLAM | ESLAM | NICE-SLAM |
|-------|---------|-----------|-------|-----------|
| Room 0 | 0.48 | 0.61 | 0.71 | 0.97 |
| Room 1 | 0.53 | 0.41 | 0.70 | 1.31 |
| Room 2 | 0.33 | 0.37 | 0.52 | 1.07 |
| Office 0 | 0.52 | 0.38 | 0.57 | 0.88 |
| Office 1 | 0.41 | 0.48 | 0.55 | 1.00 |
| Office 2 | 0.59 | 0.54 | 0.58 | 1.06 |
| Office 3 | 0.46 | 0.69 | 0.72 | 1.10 |
| Office 4 | 0.70 | 0.72 | 0.63 | 1.13 |
| **Avg** | **0.50** | 0.53 | 0.63 | 1.07 |

**Replica — Rendering quality (averages):**

| Metric | GS-SLAM | Point-SLAM | ESLAM | NICE-SLAM |
|--------|---------|-----------|-------|-----------|
| PSNR (dB) | 34.27 | 35.17 | 28.51 | 24.42 |
| SSIM | 0.975 | 0.975 | 0.905 | 0.809 |
| LPIPS | 0.082 | 0.124 | 0.216 | 0.233 |
| Depth L1 (cm) | 1.16 | — | — | — |

**TUM RGB-D — ATE RMSE [cm]:**

| Sequence | GS-SLAM |
|----------|---------|
| fr1/desk | 3.3 |
| fr2/xyz | 1.3 |
| fr3/office | 6.6 |
| Average | 3.7 |

**Throughput and memory:**
- Rasterization only: **386.91 FPS** (100× faster than Vox-Fusion at 3.88 FPS)
- End-to-end SLAM (Replica): **8.34 FPS**
- End-to-end (TUM fr1/desk): 1.83 FPS; (fr2/xyz): 1.51 FPS
- Memory (Replica Room 0, full SH-1): **198 MB**; light SH-0 variant: 19 MB
- Comparison: NICE-SLAM ~48 MB; Co-SLAM ~6 MB

No ScanNet evaluation published. No outdoor evaluation. All sequences are room-scale indoor.

---

## Part B — MonoGS / Gaussian Splatting SLAM (Matsuki et al., CVPR 2024)

### What It Is

**Full citation:** Hidenobu Matsuki, Riku Murai, Paul H. J. Kelly, Andrew J. Davison. "Gaussian Splatting SLAM." CVPR 2024 (Highlight + Best Demo Award).

- arXiv: https://arxiv.org/abs/2312.06741
- CVF: https://openaccess.thecvf.com/content/CVPR2024/html/Matsuki_Gaussian_Splatting_SLAM_CVPR_2024_paper.html
- GitHub: https://github.com/muskie82/MonoGS
- Project page: https://rmurai.co.uk/projects/GaussianSplattingSLAM/

**Affiliation:** Dyson Robotics Lab (Matsuki, Murai) + Software Performance Optimisation Group (Kelly, Davison), Imperial College London. Same group that later produced [MASt3R-SLAM](mast3r-slam.md).

**Modality:** Monocular (primary), Stereo, or RGB-D — one unified framework for all three.

**Core claim:** First SLAM system that operates from monocular video using 3D Gaussian Splatting, enabled by the first analytical SE(3) Lie-group Jacobian for the 3DGS splatting forward model.

### Core Technical Idea

MonoGS's central contribution is mathematical: it derives the **first analytical Jacobian of SE(3) camera pose** with respect to the 3DGS EWA splatting forward model. Standard 3DGS (Kerbl et al.) optimizes Gaussian parameters given fixed poses — it does not differentiate through the rasterizer with respect to pose. MonoGS closes this gap by:

1. Deriving a compact closed-form 6-DoF SE(3) Jacobian for the rendered image with respect to camera pose, implemented directly in CUDA.
2. Adding an isotropic regularization term that prevents monocular Gaussians from elongating along the viewing ray (the main degenerate failure mode in depth-free mode).
3. Using aggressive multi-view pruning (a Gaussian must be observed from at least 3 frames in the last 3 keyframes to survive) to keep the map compact — yielding 2.6–4.0 MB per scene versus GS-SLAM's 198 MB.

The result is a direct, tracker-free pose optimizer with a wide convergence basin: empirical testing shows 82% convergence success at displacements up to 1.2 m from training views.

### Inputs and Outputs

**Inputs:**
- Monocular RGB video (primary), or RGB-D / stereo via mode flag
- Known camera intrinsics
- GPU with CUDA (reported: RTX 4090 + Intel i9-12900K)

**Outputs:**
- Camera trajectory: per-keyframe SE(3) poses
- 3DGS map: per-Gaussian (mu, Sigma, o, c)
- Differentiable renders: RGB, depth (769 FPS rasterization)

### Architecture

```
Monocular (or RGB-D / Stereo) video
         |
         v
  [Tracking Front-End]
   Direct pose optimization via SE(3) Lie Jacobian
   Minimize L_track = lambda_pho * E_pho + (1-lambda_pho) * E_geo
   100 iterations / frame; early termination if ||delta_xi|| < 1e-4
   lambda_pho = 0.9 (photometric weight)
   Monocular mode: E_geo absent (no depth sensor)
         |
         v
  [Keyframe Selection]
   IOU covisibility threshold (0.90 TUM / 0.95 Replica)
   OR relative translation > 0.08 * median_depth
         |
         v
  [Map Update Back-End]
   Gaussian insertion: monocular = sample depth from N(D_p, 0.2*sigma_D)
                       RGB-D    = back-project from sensor depth
   Geometric verification: prune if NOT seen by >= 3 frames in last 3 KFs
   Hard prune: opacity alpha < 0.7
   Mapping loss L_map: E_pho + E_geo + lambda_iso * E_iso (lambda_iso = 10)
   150 iterations; joint Gaussian + pose BA
         |
         v
  [Keyframe Window BA]
   Window W: 8 KFs (TUM) / 10 KFs (Replica) + random past KFs
   Joint optimize T_CW^k and G for all k in W
   Evict KFs with overlap < 0.3 to current frame
         |
         v
  [3DGS Gaussian Map] (2.6-4.0 MB on Replica)
         |
         v
  [Differentiable Rasterizer — CUDA tile-based]
   769 FPS render speed
```

No loop closure. No global pose graph. Purely local windowed optimization.

### Operator Mechanics

**Rendering equation:**
```
C_p = sum_{i in N}  c_i * alpha_i * prod_{j=1}^{i-1} (1 - alpha_j)
D_p = sum_{i in N}  z_i * alpha_i * prod_{j=1}^{i-1} (1 - alpha_j)

alpha_i = o_i * G_i(p)    (opacity scaled by 2D Gaussian footprint at pixel p)
T_i     = prod_{j<i}(1 - alpha_j)   (accumulated transmittance)
z_i     = distance to Gaussian mean mu_W along the camera ray
```

**SE(3) Lie-group Jacobian — the central contribution.**

Standard 3DGS takes Gaussian world-frame means `mu_W` and projects them to camera frame via `mu_C = T_CW * mu_W`. To optimize pose, one needs the derivative of the rendered image with respect to the 6-DoF pose in SE(3). MonoGS derives this analytically by differentiating in the Lie algebra (tangent space at identity).

The 3×6 Jacobian of the camera-frame mean with respect to the SE(3) Lie algebra vector `xi in se(3)`:
```
d(mu_C) / d(xi)  =  [I | -mu_C^x]
```
where `mu_C^x` is the 3×3 skew-symmetric (hat) matrix of `mu_C = (cx, cy, cz)^T`:
```
mu_C^x = [  0   -cz   cy  ]
         [  cz   0   -cx  ]
         [ -cy   cx   0   ]
```

For the projected 2D covariance `Sigma_I = J W Sigma_W W^T J^T` (W is the rotation part of T_CW; J is the projective Jacobian), the derivative of the rotation matrix rows with respect to the rotation Lie algebra:
```
d(W_{:,i}) / d(phi)  =  -W_{:,i}^x   (for each column i of W)
```

These 6-DoF minimal Jacobians match the SE(3) parameterization exactly — no redundancy from quaternion or Euler representations — and are implemented directly in the CUDA rasterizer kernels, matching the performance of the original 3DGS parameter derivatives. No PyTorch autograd is used in the pose optimization path.

**Convergence basin.** Because Gaussians are volumetric blobs rather than point features, small pose errors still produce large rendered-image overlap. A convergence funnel experiment using 9 training views on a 0.5 m grid tests convergence at radii 0.2–1.2 m:
- MonoGS with depth: **82%** success
- MonoGS without depth: **79%** success
- Neural SDF (Hash Grid): 14%; Neural SDF (MLP): 33%

This wide basin is the chief advantage over render-and-compare trackers that converge only within a narrow radius of the true pose.

For the underlying Lie group math see [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md).

**Isotropic regularization.** In monocular mode, depth is ambiguous: a Gaussian can elongate along the viewing ray to minimize photometric loss without representing real geometry. The isotropic regularization penalizes deviation from spherical shape:
```
E_iso = sum_{i=1}^{|G|}  || s_i - s_tilde_i * 1 ||_1

s_i      = (s_i1, s_i2, s_i3)   three scale parameters
s_tilde_i = mean(s_i1, s_i2, s_i3)   their scalar mean
```
The L1 penalty drives all three scales toward equal value (sphere), preventing needle-like or disk-like Gaussians from monocular view-direction ambiguity. Weight: `lambda_iso = 10` in the mapping loss.

**Loss functions.**

Tracking loss (100 iterations/frame, early termination):
```
L_track = lambda_pho * E_pho + (1 - lambda_pho) * E_geo

E_pho = sum_p || C_p - C_hat_p ||_1       (L1 photometric)
E_geo = || D(G, T_CW) - D_bar ||_1        (L1 depth; absent in mono mode)
lambda_pho = 0.9
```

Mapping loss (150 iterations, keyframe window W):
```
L_map = sum_{k in W} [ lambda_pho * E_pho_k + (1 - lambda_pho) * E_geo_k ]
        + lambda_iso * E_iso
```

Joint optimization over all Gaussian parameters G and all keyframe poses `{T_CW^k}` in window W.

**Gaussian insertion and pruning.**

Monocular insertion: for pixels with existing rendered depth estimate `D_p`, sample initial depth from `N(D_p, 0.2 * sigma_D)`; for unobserved pixels, sample from `N(D_hat, 0.5 * sigma_D)` (median scene depth). RGB-D insertion back-projects sensor depth directly.

Multi-view pruning: a Gaussian inserted in the last 3 keyframes is "on probation" and is pruned if it is NOT observed by at least 3 additional frames within that window. Hard opacity prune: `alpha < 0.7`. These two criteria together yield the 2.6–4.0 MB footprint — 50–76× smaller than GS-SLAM's full SH-1 mode.

### Benchmark Results

Hardware: NVIDIA RTX 4090 + Intel i9-12900K.

**Replica RGB-D — ATE RMSE [cm]:**

| Seq | iMAP | NICE-SLAM | Point-SLAM | MonoGS | MonoGS (sp) |
|-----|------|-----------|-----------|--------|------------|
| r0 | 3.12 | 0.97 | 0.61 | 0.44 | 0.33 |
| r1 | 2.54 | 1.31 | 0.41 | 0.32 | 0.22 |
| r2 | 2.31 | 1.07 | 0.37 | 0.31 | 0.29 |
| o0 | 1.69 | 0.88 | 0.38 | 0.44 | 0.36 |
| o1 | 1.03 | 1.00 | 0.48 | 0.52 | 0.19 |
| o2 | 3.99 | 1.06 | 0.54 | 0.23 | 0.25 |
| o3 | 4.05 | 1.10 | 0.69 | 0.17 | 0.12 |
| o4 | 1.93 | 1.13 | 0.72 | 2.25 | 0.81 |
| **Avg** | 2.58 | 1.07 | 0.53 | **0.58** | **0.32** |

"sp" = single-process deterministic mode. Multi-process has stochasticity from GPU scheduling; Office 4 is an outlier. Single-process achieves 0.32 cm average — best in its class at CVPR 2024.

**TUM RGB-D — ATE RMSE [cm]:**

| Sequence | MonoGS (mono) | MonoGS (RGB-D) | DSO (mono) | Point-SLAM (RGB-D) |
|----------|-------------|--------------|-----------|------------------|
| fr1/desk | 3.78 | 1.50 | 22.4 | 4.34 |
| fr2/xyz | 4.60 | 1.44 | 1.10 | 1.31 |
| fr3/office | 3.50 | 1.49 | 9.50 | 3.48 |
| **Average** | **3.96** | **1.47** | 11.0 | 3.04 |

MonoGS RGB-D is 2.7× more accurate than monocular mode on TUM (1.47 vs 3.96 cm). MonoGS RGB-D outperforms Point-SLAM RGB-D (3.04 cm) by 2.1×.

**Replica Rendering Quality (RGB-D, multi-process):**

| Method | PSNR (dB) | SSIM | LPIPS | Render FPS |
|--------|----------|------|-------|-----------|
| NICE-SLAM | 24.42 | 0.809 | 0.233 | 0.54 |
| Point-SLAM | 35.17 | 0.975 | 0.124 | 1.33 |
| **MonoGS** | **37.50** | **0.960** | **0.070** | **769** |

37.50 dB PSNR is highest among all methods at CVPR 2024 submission time. 769 FPS rasterization is 578× faster than Point-SLAM's inference rate.

**Memory:**

| Method | Memory (MB) |
|--------|-----------|
| iMAP | 0.8 |
| NICE-SLAM | 40.3 |
| Co-SLAM | 6.4 |
| MonoGS (mono) | 2.6 |
| MonoGS (RGB-D) | 3.97 |

**Throughput:**
- Monocular, TUM fr3/office: **3.2 FPS** end-to-end
- RGB-D, TUM fr3/office: **2.5 FPS** end-to-end
- RGB-D, Replica office1 (multi-process): 1.8 FPS
- RGB-D, Replica office1 (single-process): 1.1 FPS

MonoGS is noticeably slower than GS-SLAM (8.34 FPS) because the Lie Jacobian pose optimization (100 iterations/frame) is more expensive than GS-SLAM's coarse-to-fine renderer.

**Ablation — contribution of key components (TUM ATE [cm]):**

| Variant | ATE (mono) | ATE (RGB-D) |
|---------|-----------|-----------|
| Full system | 3.96 | 1.47 |
| w/o E_iso (no isotropic reg) | 4.83 | — |
| w/o keyframe selection | 8.73 | 1.90 |

Isotropic regularization reduces monocular ATE by 0.87 cm. Removing keyframe selection more than doubles monocular ATE to 8.73 cm — it is critical.

No ScanNet evaluation in the CVPR 2024 paper. External comparisons (MonoGS++ paper) show monocular ATE 18.69 cm on Replica in RGB-only mode — much worse than RGB-D 0.44 cm, indicating the monocular case is fragile on textured indoor benchmarks without careful motion.

---

## Part C — Comparison and Integration

### Head-to-Head: GS-SLAM vs MonoGS vs SplaTAM vs Splat-SLAM

| Attribute | GS-SLAM (Yan, CVPR24) | MonoGS (Matsuki, CVPR24) | SplaTAM (Keetha, CVPR24) | Splat-SLAM (Sandstrom, CVPR25W) |
|---|---|---|---|---|
| Input | RGB-D only | Mono / Stereo / RGB-D | RGB-D only | RGB only |
| Gaussian type | Full 3DGS, SH degree-1, 12 color params | Full 3DGS, low SH, low param count | Isotropic 3DGS, 8 params | Full 3DGS + per-KF deformation |
| Tracking mechanism | Coarse-to-fine rendering, L1 loss | Analytical SE(3) Lie Jacobian | Silhouette-masked differentiable render | Dense optical flow (DPVO) + DSPO BA layer |
| Gaussian expansion | Adaptive add/delete (opacity + depth residual) | Insertion from depth + multi-view pruning | Silhouette + depth criterion | Unproject proxy depth + scale reg |
| Regularization | None (deletion by opacity decay) | Isotropic E_iso (lambda=10) | Radius ~ depth/focal (geometric prior) | Scale regularization term |
| Keyframe / BA window | Random K keyframes, phased optimization | Sliding window 8-10 KFs + random past | Fixed: most recent + highest overlap | Dense BA + loop closure |
| Loop closure | No | No | No | Yes (pose graph + global BA) |
| Replica ATE (cm) | 0.50 | 0.58 (multi-process) / 0.32 (single) | 0.36 | 0.34 (RGB-only) |
| Replica PSNR (dB) | 34.27 | 37.50 | ~33-34 | 36.45 |
| Scene memory | 198 MB (SH-1) / 19 MB (light) | 2.6-4.0 MB | — | 5.2 MB |
| End-to-end FPS | ~8.3 FPS (Replica) | ~2.5-3.2 FPS | ~0.5 FPS | 0.8-3.7 FPS |
| Render FPS | 386 FPS | 769 FPS | — | — |
| Hardware | RTX 4090 | RTX 4090 | RTX 3080 Ti | A100 / RTX 3090 Ti |
| ScanNet | No | No | Yes (1.2 cm ATE ScanNet++) | Yes (7.6 cm ATE) |
| Loop closure | No | No | No | Yes |
| Outdoor testing | No | No | No | No |
| Publication | CVPR 2024 Highlight | CVPR 2024 Highlight + Best Demo | CVPR 2024 | CVPR 2025 Workshop |

For [Splat-SLAM](splat-slam.md)'s full 3DGS-SLAM family table (including LoopSplat, RTG-SLAM, DROID-Splat, Photo-SLAM, Gaussian-SLAM) see the iter-18 sibling page.

### Tracking Mechanism Comparison

**GS-SLAM** uses render-and-compare with a coarse-to-fine resolution schedule. Fast because Stage 2 restricts the fine optimization to geometrically reliable Gaussians. No explicit Jacobian derivation — relies on autodiff through the renderer. Achieves the best end-to-end FPS (8.3) of the three.

**MonoGS** derives an explicit analytical Jacobian for SE(3) pose in the 3DGS model, implemented directly in CUDA. The wide convergence basin (tested to 1.2 m) is its stated advantage over render-and-compare, which can be trapped in local optima near poorly-initialized Gaussians. Cost: ~2.5 FPS versus 8.3 FPS.

**SplaTAM** gates the photometric + depth loss inside the silhouette mask (rendered opacity > 0.99). Confidence-gated loss prevents ill-initialized map-boundary Gaussians from corrupting pose estimates — conceptually similar to GS-SLAM's reliable-Gaussian filter but applied as a loss mask rather than a render-set restriction. Best ATE on Replica (0.36 cm) at the cost of ~0.5 FPS throughput.

**Why MonoGS memory is 76× smaller than GS-SLAM:** GS-SLAM seeds H×W/2 Gaussians at the first keyframe with 12 SH-1 coefficients each, without aggressive pruning. MonoGS inserts on demand and applies two-stage pruning (3-frame visibility check + opacity floor), keeping the map compact and explaining MonoGS's 2× rendering FPS advantage.

### Honest Limitations

Both papers share these limitations:

- **No loop closure.** Drift is unbounded beyond the evaluated rooms; ATE figures apply only to the specific short sequences tested.
- **No outdoor evaluation.** Gaussian scale explosion in unbounded scenes (sky, terrain) is the primary outdoor failure mode; neither system addresses it.
- **No ScanNet results.** SplaTAM and Splat-SLAM report ScanNet numbers; GS-SLAM and MonoGS do not.
- **Texture-less failure.** Bare concrete, sky, uniform walls yield near-zero photometric gradient. GS-SLAM's depth-residual add criterion gives partial relief in RGB-D mode; MonoGS's isotropic regularization prevents degenerate shapes but cannot generate texture signal that does not exist.
- **Dynamic objects.** Neither system includes dynamic-object masking. Moving aircraft, GSE, or people contaminate both the map and the tracking loss.

### Variants and Lineage

**MonoGS++** (arXiv 2504.02437, BMVC 2024): Addresses MonoGS's two main weaknesses — RGB-D dependency for initialization (replaced with visual-odometry sparse points) and the 100-iteration/frame speed bottleneck (separates pose and Gaussian optimization tracks for 5.57× speedup). Adds dynamic insertion, clarity-enhancing densification (low-texture), and planar regularization. Replica: PSNR 37.79 dB / ATE 0.26 cm (vs MonoGS 29.89 dB / 18.69 cm in RGB-only mode).

**GLC-SLAM** (arXiv 2409.10982): Adds loop-closure capability to Gaussian SLAM via a place-recognition module. Directly addresses the most critical shared weakness.

**LoopSplat** (3DV 2025 Oral, arXiv 2408.10154): Loop closure via Gaussian submap registration — first native 3DGS loop closure without relying on a classical pose graph external to the Gaussian map.

**RTG-SLAM** (SIGGRAPH 2024, arXiv 2404.19706): Uses opaque-biased Gaussian rasterization to prioritize surface-like Gaussians; achieves 17.9 FPS end-to-end — the fastest published at time of writing — at the cost of lower PSNR.

**Splat-SLAM** (CVPR 2025W, arXiv 2405.16544): First RGB-only Gaussian SLAM with global pose-graph loop closure and closed-form Gaussian deformation. See [Splat-SLAM](splat-slam.md) for the full page.

---

## Strengths

**GS-SLAM:**
- Fastest end-to-end SLAM among the CVPR 2024 trio: 8.34 FPS — closest to sensor-rate processing.
- Adaptive expansion is self-regulating: the map grows and shrinks driven by reconstruction quality, not just time.
- Coarse-to-fine tracking is simple and robust without bespoke Jacobian derivation; Stage 2 reliable-Gaussian filter is an elegant noise-reduction mechanism.
- Rasterization speed (386 FPS) supports real-time rendering even as a background visualization thread.

**MonoGS:**
- Monocular capability: only an RGB camera needed — lower sensor cost, aerial and handheld deployment viable.
- Analytical SE(3) Lie Jacobian: wide convergence basin (82% at 1.2 m), robust to initialization errors that defeat render-and-compare trackers.
- Memory-efficient: 2.6 MB per room — 76× smaller than GS-SLAM full mode; favorable for storage and fleet-map transmission.
- Highest Replica PSNR at CVPR 2024 time (37.50 dB).
- Unified mono/stereo/RGB-D framework: single codebase, plug-in sensor.
- Isotropic regularization prevents degenerate needle/disk Gaussians in low-texture regions.

---

## Failure Modes

**1. Long-sequence drift.** No loop closure in either system. ATE grows without bound beyond room-scale paths. A single stand-to-stand taxi run at a midsize airport substantially exceeds the evaluated sequence lengths.

**2. Dynamic scenes.** Aircraft pushback, GSE, and baggage carts cause multi-view photometric inconsistency. Gaussians assigned to moving objects contaminate the tracking loss and corrupt the static map. Neither paper evaluates on dynamic sequences.

**3. Texture-less regions — the concrete apron problem.** Aprons, taxiways, and uniform walls yield near-zero photometric gradient. GS-SLAM's depth-residual add criterion gives partial relief in RGB-D mode; MonoGS's isotropic regularization prevents degenerate Gaussian shapes but cannot synthesize photometric information that does not exist.

**4. Outdoor and large-scale scenes.** Neither system has been tested outdoors. Gaussians grow to very large scales in unbounded scenes (sky, terrain). Neither includes a sky prior (contrast: Gaussian-LIC's hemisphere sky Gaussians).

**5. Illumination changes and nighttime.** MonoGS's `lambda_pho = 0.9` (high photometric trust) makes it especially sensitive to glare, rolling shutter, and exposure changes. Neither system includes per-keyframe exposure compensation. In low-light conditions, photometric SNR collapses; thermal/LWIR cameras would require a different rendering model.

**6. Planar symmetry failure.** Long symmetric corridors or repeated gate geometry can cause the tracker to converge to a mirror pose. MonoGS's convergence basin was tested at translational displacement; rotational symmetry failures are untested.

**7. Implementation fragility.** Custom CUDA rasterizers are sensitive to CUDA/PyTorch/driver version combinations. Production deployment requires careful dependency pinning.

---

## Domain Fit

| Domain | Fit | Key Notes |
|--------|-----|-----------|
| Indoor rooms / labs | Good | Designed for this; Replica/TUM RGB-D are representative |
| Building-scale indoor | Conditional | Loop closure needed for multi-room; neither system provides it |
| Airside hangar / terminal (offline appearance) | Conditional | Useful for digital twin if poses come from LiDAR-primary pipeline |
| Airside apron (online SLAM) | Not suitable | Low texture, dynamic GSE, sky, speed; fails on all counts |
| Road AV (offline appearance layer) | Research | Useful only as secondary appearance layer from trusted poses |
| Warehouse / port indoor | Conditional | Dynamic fork trucks need masking; RGB-D viable in static sections |
| Agriculture / construction | Not suitable | Outdoor scale, weather, dynamic machinery, vegetation |
| Delivery robot (indoor) | Conditional | Short-range room SLAM viable; long-corridor drift still applies |

---

## Aggregated-Map Suitability: The Honest Assessment

**GS-SLAM and MonoGS are NOT drop-in replacements for [FAST-LIO2](fast-lio-fast-lio2.md) or [KISS-ICP](kiss-icp.md) in any production AV localization stack.** Their appropriate production-adjacent role is as an **appearance layer** — photo-realistic Gaussian digital twin — anchored to LiDAR-primary geometry.

Structural reasons they cannot replace LIO: RGB-D range is 0.3–40 m versus 200 m for LiDAR; both drift without loop closure and were tested only on room-scale sequences; no IMU integration; texture-less apron geometry degrades tracking; 2.5–8 FPS vs LIO's 10–50 Hz; no calibrated covariance output for factor-graph fusion.

**Appropriate integration — the LiDAR-augmented 3DGS paradigm:**

```
Step 1: LIO front-end (FAST-LIO2 / LIO-SAM)
        -> accurate metric pose (SE(3)) + dense point cloud
        -> loop closure and global consistency from LiDAR pose graph

Step 2: Gaussian appearance layer (Gaussian-LIC or LVI-GS)
        -> initialize 3D Gaussians from colorized LiDAR points
        -> scale: d/f * e  (depth / focal_length * unit scale)
        -> optimize photometric appearance; LiDAR depth supervision throughout
        -> sky hemisphere prior prevents background Gaussian explosion
        -> dynamic-object semantic mask applied before optimization

Step 3: Output
        -> LiDAR geometry (primary, metric-accurate)
        -> Gaussian appearance map (secondary, photo-realistic)
        -> digital twin: novel-view synthesis, semantic overlay,
           change detection, synthetic data generation
```

GS-SLAM's adaptive expansion module can be repurposed here: the criterion `|D(p) - D_hat(p)| > tau_D` would use LiDAR depth as `D(p)`, giving metric-accurate Gaussian seeding in texture-less areas. MonoGS's multi-view pruning logic is directly reusable to suppress spurious Gaussians in sparsely observed regions.

**LiDAR-augmented references:**
- **Gaussian-LIC** (arXiv 2404.06926, ICRA 2025): LiDAR-Inertial-Camera + 3DGS; continuous-time Coco-LIC factor graph; 24.55 dB PSNR; real-time. https://github.com/APRIL-ZJU/Gaussian-LIC
- **Gaussian-LIC2** (arXiv 2507.04004, 2025): adds zero-shot depth completion for LiDAR-blind areas and photometric constraints back into the factor graph odometry.
- **LVI-GS** (arXiv 2411.02703, IEEE TIM 2025): tightly-coupled LiDAR-Visual-Inertial SLAM + 3DGS; pyramid training; LiDAR depth supervision throughout.

See [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) for downstream use.

---

## Implementation Notes

- **GS-SLAM:** rasterizer at `yanchi-3dv/diff-gaussian-rasterization-for-gsslam`. A production-grade maintained stack should not be assumed from the project page alone.
- **MonoGS:** `muskie82/MonoGS`. Mono/RGB-D/stereo via config flag; RealSense live demo guidance included.
- Pin CUDA, PyTorch, and rasterizer dependency versions tightly — version combinations outside the tested set fail to compile or produce silent numerical errors.
- For trajectory ATE comparisons, confirm SE(3) vs Sim(3) alignment: monocular systems without metric scale must use Sim(3) or reported ATE is misleading.
- Keep Gaussian maps separate from operational HD maps. Never feed Gaussian map updates directly to a vehicle controller or safety-critical localization filter.
- Apply semantic masking or motion segmentation before building the Gaussian map to prevent dynamic objects from corrupting static geometry.
- For airside survey: run Gaussian-LIC or LVI-GS rather than standalone GS-SLAM/MonoGS.
- GS-SLAM hyperparameters (tau_T, tau_D, gamma, eta) are undisclosed in the paper; document tuned values in the experiment record for reproducibility.
- MonoGS multi-process mode is non-deterministic; use single-process for reproducible benchmarking.
- Export trajectories for independent QA against LiDAR, GNSS/INS, or surveyed ground control points before any operational claim.

---

## Sources

**GS-SLAM primary:**
- Yan, Chi, et al. "GS-SLAM: Dense Visual SLAM with 3D Gaussian Splatting." CVPR 2024. arXiv: https://arxiv.org/abs/2311.11700
- CVF Open Access: https://openaccess.thecvf.com/content/CVPR2024/html/Yan_GS-SLAM_Dense_Visual_SLAM_with_3D_Gaussian_Splatting_CVPR_2024_paper.html
- Project page: https://gs-slam.github.io/
- Custom rasterizer: https://github.com/yanchi-3dv/diff-gaussian-rasterization-for-gsslam

**MonoGS primary:**
- Matsuki, Hidenobu, Riku Murai, Paul H. J. Kelly, and Andrew J. Davison. "Gaussian Splatting SLAM." CVPR 2024. arXiv: https://arxiv.org/abs/2312.06741
- CVF Open Access: https://openaccess.thecvf.com/content/CVPR2024/html/Matsuki_Gaussian_Splatting_SLAM_CVPR_2024_paper.html
- GitHub: https://github.com/muskie82/MonoGS
- Project page: https://rmurai.co.uk/projects/GaussianSplattingSLAM/

**Follow-on work:**
- MonoGS++: https://arxiv.org/abs/2504.02437
- GLC-SLAM (loop closure for Gaussian SLAM): https://arxiv.org/pdf/2409.10982
- LoopSplat (3DV 2025 Oral): https://arxiv.org/abs/2408.10154
- Splat-SLAM (CVPR 2025W): https://arxiv.org/abs/2405.16544

**LiDAR-augmented 3DGS:**
- Gaussian-LIC (ICRA 2025): https://arxiv.org/abs/2404.06926 | https://github.com/APRIL-ZJU/Gaussian-LIC
- Gaussian-LIC2 (2025): https://arxiv.org/abs/2507.04004 | https://xingxingzuo.github.io/gaussian_lic2/
- LVI-GS (IEEE TIM 2025): https://arxiv.org/abs/2411.02703
- LiV-GS (IROS 2025): https://arxiv.org/abs/2411.12185

**Context and surveys:**
- 3DGS-SLAM Survey: https://arxiv.org/abs/2402.13255
- 3DGS-SLAM Next-Gen Survey (2026): https://arxiv.org/abs/2602.04251
- awesome-NeRF-and-3DGS-SLAM: https://github.com/3D-Vision-World/awesome-NeRF-and-3DGS-SLAM

**Internal cross-links:**
- [Splat-SLAM](splat-slam.md) — iter-18 deep dive; includes full 3DGS-SLAM family table
- [MASt3R-SLAM](mast3r-slam.md) — iter-24 feed-forward SLAM; same Imperial College lab as MonoGS
- [DROID-SLAM](droid-slam.md) — learned-flow SLAM comparison baseline
- [NeRF-SLAM](nerf-slam.md) — implicit-map predecessor context
- [KISS-ICP](kiss-icp.md) — LiDAR-primary odometry for parallel stack
- [FAST-LIO / FAST-LIO2](fast-lio-fast-lio2.md) — LiDAR-inertial primary localization
- [Learned LiDAR Place Recognition](learned-lidar-place-recognition.md) — loop closure context
- [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) — downstream use of Gaussian appearance maps
- [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md) — iter-16 3DGS first-principles
- [Volume Rendering, Radiance Fields, and Gaussian Splatting](../../../10-knowledge-base/geometry-3d/volume-rendering-radiance-fields-gaussian-splatting.md) — 3DGS representation background
- [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) — iter-14 SE(3) Jacobian math used in MonoGS
