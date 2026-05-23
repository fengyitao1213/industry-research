# Splat-SLAM

<!-- method-priority:start
priority:
  learning: 3
  deployment: 2
  type: "method"
  stage: "frontier"
  maturity: "research"
  tags: ["slam", "mapping", "simulation"]
  reason: "Useful Gaussian SLAM reference, but not a runtime pose backbone."
method-priority:end -->

Related docs: [GS-SLAM and MonoGS](gs-slam-monogs.md) · [SplaTAM](splatam.md) · [WildGS-SLAM](wildgs-slam.md) · [MASt3R-SLAM](mast3r-slam.md) · [DROID-SLAM](droid-slam.md) · [NICE-SLAM](nice-slam.md) · [NeRF-SLAM](nerf-slam.md) · [Multi-Agent Neural Gaussian SLAM](multi-agent-neural-gaussian-slam.md) · [Gaussian Splatting for Driving](../../perception/overview/gaussian-splatting-driving.md) · [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [3DGS Digital Twin](../../simulation/3dgs-digital-twin.md) · [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md) · [Volume Rendering, Radiance Fields, and Gaussian Splatting](../../../10-knowledge-base/geometry-3d/volume-rendering-radiance-fields-gaussian-splatting.md)

## What It Is

Splat-SLAM (Sandström et al., arXiv 2405.16544, CVPR 2025 Workshop VOCVALC) is the first RGB-only SLAM system that combines a **dense 3D Gaussian Splatting back-end** with **globally optimized tracking via loop closure and full bundle adjustment**. Prior first-wave Gaussian SLAM systems — SplaTAM, MonoGS, GS-SLAM — all use local frame-to-model tracking without a global pose graph; their Gaussian maps look visually coherent locally but drift unboundedly on longer sequences.

Splat-SLAM addresses this directly. It marries a robust **dense optical-flow tracking front-end** (with a joint pose and per-pixel disparity Bundle Adjustment layer called DSPO) to an **incremental 3DGS map back-end** that can deform analytically whenever global pose or depth estimates are corrected. The result is a map that is simultaneously dense, photo-realistic, and globally consistent — loop-closure-correct Gaussian SLAM, not just local Gaussian mapping.

A monocular depth estimator fills depth in multi-view-unreliable regions, so the system operates depth-sensor-free. RGB-D input is also supported and adds a depth supervision term to the mapping loss.

**Authors:** Erik Sandström, Keisuke Tateno, Michael Oechsle, Michael Niemeyer, Luc Van Gool, Martin R. Oswald, Federico Tombari (Google Research / ETH Zurich / MPI-IS, 2024).

## Executive Summary

Splat-SLAM is a globally optimized RGB-only Gaussian SLAM method. Its main contribution is making the Gaussian map adapt analytically to globally optimized keyframe poses and depth updates, so tracking, mapping, and rendering all benefit from global corrections — including loop closure. The Gaussian deformation is closed-form and requires no re-training after pose-graph updates.

For AV and airside autonomy, Splat-SLAM is best treated as a **research reference for RGB-only dense mapping and global Gaussian map correction**. It is not a production localization stack. It has no native IMU, LiDAR, radar, wheel, GNSS, HD-map, safety covariance, or adverse-weather robustness. Its most practical role in a survey-drive workflow is as the **appearance layer** (photo-realistic digital twin) anchored to a LiDAR-primary geometry — specifically via LiDAR-augmented variants Gaussian-LIC or LVI-GS.

## Core Technical Idea

The central thesis: a Gaussian map should follow global bundle-adjustment updates instead of staying fixed after local insertion. The two technical contributions that enable this are:

**1. DSPO (Disparity, Scale and Pose Optimization) front-end.**
A dense recurrent optical-flow network (DPVO-style) estimates frame-to-frame flow. The DSPO layer augments this with joint optimization of camera poses and per-pixel disparities in a sliding-window factor graph. Loop closure adds edges to the factor graph; global BA runs periodically over all keyframes. This gives Splat-SLAM globally consistent poses rather than purely local pose estimates.

**2. Closed-form deformable Gaussian back-end.**
When the tracker updates a keyframe's pose or depth, all Gaussians anchored to that keyframe deform analytically: mean position shifts, rotation updates by the relative frame rotation, and scale adjusts by the depth-change ratio. No gradient descent or re-training is needed after a loop closure. The deformation takes milliseconds, making it compatible with real-time global optimization.

Together these ensure that the Gaussian map's geometry and appearance remain consistent with the globally best pose estimates at all times.

## Inputs and Outputs

**Inputs:**
- Monocular RGB video (primary; operates depth-sensor-free)
- Known camera intrinsics (focal length, principal point)
- Optional: registered depth (RGB-D mode adds depth supervision loss)
- Monocular depth prior network (DPT-based) for per-pixel proxy depth in unreliable regions

**Outputs:**
- Globally optimized keyframe poses (SE(3))
- Dense 3D Gaussian map: per-Gaussian mean, covariance, opacity, color (SH coefficients)
- Differentiable renderings: RGB novel views, rendered depth, silhouette/opacity maps
- Trajectory with absolute trajectory error comparable to the best RGB-D-based methods

## Architecture

The pipeline has four tightly coupled components: a dense tracking front-end, a 3D Gaussian map back-end, a pose-graph optimizer, and a deformation layer.

```
RGB frames
    |
    v
[Dense Optical Flow Front-End]
    |  frame-to-frame flow, keyframe selection
    v
[DSPO Layer — Dense Bundle Adjustment]
    |  joint pose + per-pixel disparity optimization
    |  sliding-window factor graph
    |  loop detection (flow magnitude vs. threshold)
    v
[Pose Graph + Loop BA / Global BA]
    |  loop edges, global consistency
    v
[Gaussian Map Back-End]
    |  initialization from proxy depth
    |  60-iter per-keyframe photometric optimization
    |  differentiable rasterizer (alpha-compositing)
    v
[Closed-Form Deformation Layer]
    |  analytical mean/rotation/scale update on pose correction
    v
Dense 3D Gaussian Map + Globally Consistent Trajectory
```

### Front-End: Dense Optical Flow + DSPO

The tracker is a dense recurrent optical-flow network operating frame-to-frame. The key extension over plain DPVO is the **DSPO layer** (Disparity, Scale and Pose Optimization):

- Jointly optimizes camera poses and per-pixel disparities in a factor graph via Dense Bundle Adjustment (DBA).
- DBA minimizes reprojection error between keyframes using predicted optical flow within a sliding window.
- **Monocular depth prior integration:** A DPT-based monocular depth estimator produces `D_mono`. Pixels are classified as reliable (multi-view count `nc >= 2`) or unreliable.

```
For reliable pixels (nc >= 2):
  scale theta and shift gamma fitted via least-squares:
  D_proxy = theta * D_mono + gamma   (calibrated to multi-view depth)

For unreliable pixels:
  D_proxy = theta * D_mono + gamma   (scale/shift from nearby reliable region)
```

Disparities are normalized for numerical stability before BA:

```
d_norm = d / d_mean
```

**Keyframe selection and loop closure:**
- Loop detection compares optical flow magnitude between frame pairs against threshold `tau_loop = 25.0` and enforces a minimum temporal gap `tau_t = 20` frames to avoid redundant edges.
- On loop detection: edges added to pose graph; loop BA performed on extended graph.
- Global BA executed every 20 keyframes over all keyframes.

### Back-End: 3D Gaussian Map

Each 3D Gaussian is parameterized by:

```
G_i = {
  mu_i          -- 3D mean (position)
  Sigma_i       -- covariance = R_i S_i S_i^T R_i^T  (rotation R_i, diagonal scale S_i)
  o_i           -- opacity
  c_i           -- color (spherical harmonics coefficients)
}

Density: g(x) = exp(-0.5 * (x - mu_i)^T Sigma_i^{-1} (x - mu_i))
```

**Gaussian initialization (per new keyframe):**
- New Gaussians are created by unprojecting proxy depth `D_proxy` at new keyframe pixels.
- Downsampled by factor `theta = 32` (first frame: `theta = 16`) for tractable Gaussian count.

**Rendering (front-to-back alpha-compositing, sorted by depth):**

```
Color:  C = sum_i  c_i * alpha_i * prod_{j<i}(1 - alpha_j)
Depth:  D^r = sum_i  d_hat_i * alpha_i * prod_{j<i}(1 - alpha_j)

where alpha_i = o_i * G_i(pixel)  (per-pixel Gaussian contribution)
```

### Pose-Graph and Loop Closure

The pose graph stores all keyframe poses as nodes and tracks edges from (a) sequential motion, (b) detected loop pairs. On a loop detection event:

1. New loop edge added to pose graph.
2. DBA run on expanded graph → updated poses and depths for affected keyframes.
3. Deformation layer applied to all Gaussians anchored to updated keyframes.
4. Global BA (every 20 keyframes): all keyframes jointly re-optimized.

Post-loop refinement runs ~2,000 mapping iterations (~15 s on RTX 3090 Ti) to restore photometric consistency after deformation.

### Closed-Form Gaussian Deformation

When the tracker updates pose `omega -> omega'` and depth `D -> D'` for a keyframe, all anchored Gaussians deform analytically:

```
Mean shift:
  mu_i' = (1 + [D'(u,v) - D(u,v)] / (omega^{-1} mu_i)_z) * omega' omega^{-1} mu_i

Rotation update:
  R_i' = R' R^{-1} R_i          (relative frame rotation composition)

Scale update:
  s_i' = (1 + depth_adjustment_factor) * s_i

For Gaussians outside viewing frustum:
  rigid-only deformation (no scale change)
```

This is entirely closed-form and analytical — no gradient descent after loop closure. Deformation completes in milliseconds.

## Mapping Loss

Mapping minimizes a combined photometric + depth + scale-regularization loss over selected keyframes:

```
L = sum_k [
    (lambda / N_k)       * |a_k C_k + b_k - C_k_gt|_1       (L1 photometric)
  + ((1 - lambda) / N_k) * |D_k^r - D_k|_1                  (L1 depth)
  + (lambda_reg / |G|)   * sum_i |s_i - s_tilde_i|_1        (scale regularization)
]

lambda = 0.8       (color weight)
lambda_reg = 10.0  (scale regularization weight)
```

- Per-keyframe **exposure compensation** via affine transform `(a_k, b_k)` applied to rendered color handles lighting variation.
- 60 mapping iterations per keyframe update.
- Scale regularization prevents Gaussians from growing unbounded (key for stability in textureless regions).

## Benchmark Results

### Replica (8 synthetic indoor scenes, RGB-only mode)

| Metric | Splat-SLAM |
|--------|-----------|
| ATE RMSE | 0.34 cm |
| PSNR | 36.45 dB |
| SSIM | 0.95 |
| LPIPS | 0.06 |
| Depth L1 | 2.41 cm |
| Avg. Gaussians | ~102,000 |
| Map size | 5.2 MB |

Map compactness comparison on Replica: Splat-SLAM 5.2 MB vs GlORIE-SLAM 382.4 MB vs MonoGS 10.8 MB.

### TUM RGB-D (5 scenes, real data, RGB-only mode)

| Metric | Value |
|--------|-------|
| ATE RMSE (keyframes) | 2.05 cm |
| PSNR | 25.85 dB |

### ScanNet (6 scenes, real indoor, RGB-only mode)

| Metric | Value |
|--------|-------|
| ATE RMSE | 7.6 cm |
| PSNR | 29.48 dB |
| Avg. Gaussians | ~123,000 |

Note: Splat-SLAM operates RGB-only (harder task without depth sensor), yet achieves best or on-par ATE and highest PSNR on Replica compared to RGB-D methods such as SplaTAM (0.36 cm) and GS-SLAM (0.50 cm).

### Compute

| Hardware | Speed | Notes |
|----------|-------|-------|
| NVIDIA A100 | — | Experimental evaluation |
| RTX 3090 Ti, Replica room 0 | ~0.81 FPS (1.24 s/frame) | Default quality |
| RTX 3090 Ti, relaxed keyframe thresholds | ~3.67 FPS | Quality trade-off |
| RTX 3090 Ti, post-loop refinement | ~15 s / 2,000 iters | After loop closure |

Not real-time at default quality. Comparable to offline photogrammetry workflows; suited to survey-drive post-processing rather than closed-loop real-time navigation.

## The Broader 3DGS-SLAM Family

Splat-SLAM sits within a dense wave of 3DGS-SLAM work from 2023–2025. The table below characterizes the family by tracking approach, map representation, sensor input, loop-closure capability, and practical speed.

| Method | Venue | Tracking | Map | Input | Loop Closure | Speed | Notes |
|--------|-------|----------|-----|-------|--------------|-------|-------|
| **SplaTAM** | CVPR 2024 | Silhouette-guided differentiable render | Isotropic 3DGS (8-param) | RGB-D | No | ~0.5–2.5 FPS | First published 3DGS-SLAM; simple isotropic Gaussians |
| **MonoGS** | CVPR 2024 Highlight | Direct pose optim on Gaussians (Lie group Jacobians) | Full 3DGS | Mono/Stereo/RGB-D | No | 3 FPS (mono) / 10 FPS (fast) | Best Demo Award; monocular pioneer |
| **GS-SLAM** | CVPR 2024 | Coarse-to-fine rendering | Full 3DGS (SH deg-1) | RGB-D | No | 8.43 FPS | Adaptive Gaussian expansion + deletion |
| **Photo-SLAM** | arXiv 2311.16728 | ORB-SLAM3 (classical VO) | Hyper primitives + 3DGS | Mono/Stereo/RGB-D | Via ORB-SLAM3 | Real-time | Hybrid classical pose + Gaussian map |
| **Gaussian-SLAM** | 2023/2024 | Photometric + geometric loss | 3DGS submaps | RGB-D | No | Interactive | Submap decomposition for scalability |
| **RTG-SLAM** | SIGGRAPH 2024 | Opaque/transparent rasterization | Opaque-biased Gaussians | RGB-D | No | ~17.9 FPS | 2× speed, ½ memory vs NeRF-SLAM |
| **LoopSplat** | 3DV 2025 (Oral) | Gaussian frame-to-model | 3DGS submaps | RGB-D | Yes (submap registration) | Online | First native 3DGS loop closure via submap registration |
| **DROID-Splat** | ICCV 2025W | DROID-SLAM end-to-end tracker | 3DGS rendering | Mono | Yes (via DROID) | Fast | Decouples tracker quality from renderer quality |
| **Splat-SLAM** | CVPR 2025W | Dense optical flow + DSPO DBA | Full 3DGS + deformation | RGB-only | Yes (pose graph + global BA) | 0.81–3.67 FPS | First globally optimized RGB-only 3DGS-SLAM |

Key differentiators of Splat-SLAM vs. the field:
- Only RGB-only system with a differentiable 3DGS back-end **and** global pose-graph loop closure.
- Gaussian deformation is analytical (closed-form), not gradient-based — loop corrections are instant.
- Best PSNR on Replica (36.45 dB) while operating without a depth sensor.

## NeRF-SLAM Context

3DGS-SLAM emerged as a direct response to the speed limitations of NeRF-based dense SLAM. Understanding the gap contextualizes why 3DGS-SLAM is preferred for near-real-time applications.

### Key NeRF-SLAM Predecessors

| Method | Year | Representation | Speed | Key Characteristic |
|--------|------|----------------|-------|-------------------|
| iMAP | 2021 | Single MLP | ~0.1 FPS | First NeRF-SLAM; catastrophic forgetting |
| NICE-SLAM | 2022 | Hierarchical voxel grid + pretrained MLP | ~0.1–1 FPS | Multi-level features; scalable vs. iMAP |
| ESLAM | CVPR 2023 | Multi-scale axis-aligned feature planes + TSDF | ~12–21 FPS | 10× faster than iMAP/NICE-SLAM; no pretraining |
| Co-SLAM | CVPR 2023 | Coordinate + hash grid hybrid | ~15–17 FPS | Joint BA with sparse ray sampling |
| NeRF-SLAM | 2022 | Instant NGP + TSDF | minutes per frame | Dense NeRF map from monocular; offline |

See [NICE-SLAM](nice-slam.md) and [NeRF-SLAM](nerf-slam.md) for method-level pages.

### Why 3DGS Supersedes NeRF-SLAM on Speed

NeRF-SLAM uses **ray-based volume rendering**: march N samples per ray, query MLP or grid N times per pixel. Cost scales as O(rays × samples). Even optimized NeRFs require seconds per frame at SLAM quality.

3DGS uses **tile-based rasterization**: project Gaussian ellipsoids onto screen tiles, alpha-composite front-to-back, CUDA-parallelized over tiles. This renders 1000× more pixels per iteration than NeRF baselines at faster overall throughput.

```
Rasterization speed comparison (Replica):
  GS-SLAM rasterization only: 386 FPS
  Point-SLAM (NeRF-based) inference: 0.42 FPS
  -- ~920× faster for rasterization alone
```

The bottleneck in 3DGS-SLAM is not rendering but per-frame Gaussian optimization — still 0.5–20 FPS end-to-end vs. sub-1 FPS for NeRF-SLAM.

**Summary tradeoffs:**

| Property | NeRF-SLAM | 3DGS-SLAM |
|----------|-----------|-----------|
| Rendering speed | Slow (volume ray march) | Fast (tile rasterization) |
| Training per frame | Seconds–minutes | 0.05–2 s |
| Surface quality | Smooth, implicit | Noisy blobs; mesh extraction non-trivial |
| Memory | Lower (MLP or compact grid) | Higher (per-Gaussian params) |
| Editability | Hard (implicit) | Explicit; inspectable |
| Loop closure maturity | Limited | Growing (Splat-SLAM, LoopSplat) |

## LiDAR-Augmented 3DGS-SLAM

Pure camera-based 3DGS-SLAM faces three structural problems for outdoor and airside use:

1. Scale ambiguity in monocular mode (no metric depth).
2. Photometric-gradient-driven densification fails in texture-less regions (walls, runways, concrete aprons).
3. Drift in outdoor large-scale scenes without loop closure.

LiDAR solves all three: metric depth (no scale ambiguity), geometrically precise Gaussian seeding in texture-less areas, and loop-closure-compatible geometric constraints.

### LIV-GaussMap (arXiv 2401.14857)

LiDAR-Inertial-Visual fusion for real-time 3D radiance field mapping. LiDAR-inertial odometry (FAST-LIO style) with size-adaptive voxels seeds surface Gaussians at LiDAR surface hits; IMU initializes Gaussian body attitude. Visual photometric gradients refine Gaussian quality post-seeding. Supports solid-state and mechanical LiDAR.

### LiHi-GS (arXiv 2412.15447)

Targets **highway driving** — sparse sensor views and monotone backgrounds where camera-only methods fail entirely. Initializes from voxel-downsampled LiDAR point cloud map + COLMAP sparse points. Crucially, LiDAR depth supervision continues throughout optimization, not just at initialization. Also synthesizes novel LiDAR scans (not just RGB views) for sensor simulation.

### LI-GS (arXiv 2409.12899)

Large-scale offline multi-scan reconstruction using **2D Gaussian surfels** (disk-shaped, better surface alignment than volumetric ellipsoids). Converts LiDAR point clouds to plane-constrained Gaussian Mixture Models (GMMs) for initialization and optimization-stage supervision. Reports +52.6% over LiDAR-only and +68.7% over Gaussian-only methods on large-scale benchmarks.

### Gaussian-LIC (arXiv 2404.06926)

The most complete sensor fusion system in this family: **real-time LiDAR-Inertial-Camera photo-realistic SLAM** with two parallel modules — (1) Coco-LIC continuous-time factor graph front-end (LiDAR + visual + IMU factors) and (2) 3DGS mapping back-end.

Gaussian initialization from LiDAR:

```
Project LiDAR points onto camera FoV; assign color from image
Initial scale: d/f * e   (depth / focal_length * unit vector)
Larger scales for distant points
Fill outside-LiDAR-FoV regions (e.g., vegetation) via online visual SfM
Sky: background hemisphere Gaussians prevent sky fitting errors
Exposure compensation: 3x4 affine matrix per frame
```

Results: avg PSNR 24.55 dB; real-time throughput matching sequence duration; outperforms NeRF-SLAM, MonoGS, SplaTAM on rendering quality from estimated poses.

**This is one of the two most practical integration paths for an airside survey-drive workflow** — the LIC odometry front-end provides the accurate metric pose backbone while the Gaussian back-end handles appearance.

### LVI-GS (arXiv 2411.02703)

Tightly-coupled LiDAR-Visual-Inertial SLAM with 3DGS. Initializes 3D Gaussians from colorized LiDAR points. Pyramid-based multi-level training; LiDAR depth supervision throughout. Custom CUDA acceleration for real-time map updates. Claims superior performance over state-of-the-art 3D reconstruction systems.

**This is the second most practical integration path** for a LiDAR-primary survey workflow requiring real-time output.

### LiV-GS (arXiv 2411.12185)

Outdoor SLAM with covariance bridging: shares Gaussian covariance attributes between LiDAR alignment and visual rendering — a single geometric representation for both sensor modalities. Introduces a Conditional Gaussian Constraint (CGC) that aligns Gaussians with nearest reliable ones, enabling high-quality reconstruction outside the LiDAR FoV. Results on NTU4DRadLM (6 sequences): 7.98 FPS, SSIM 0.775 vs Gaussian-SLAM 0.665, lowest ATE on low-speed sequences.

### LiDAR Integration Summary

| Method | Sensor Fusion | Outdoor | Real-Time | Key Contribution |
|--------|--------------|---------|-----------|-----------------|
| LIV-GaussMap | LiDAR + IMU + Camera | Yes | Yes | Fast-LIO seeding + visual refinement |
| LiHi-GS | LiDAR + Camera | Highway | Near | LiDAR supervision throughout; novel LiDAR synthesis |
| LI-GS | LiDAR + Camera | Yes (large-scale) | No (offline) | 2D surfel + GMM supervision |
| Gaussian-LIC | LiDAR + IMU + Camera | Yes | Yes | Continuous-time LIC factor graph + 3DGS |
| LVI-GS | LiDAR + Vision + IMU | Yes | Yes | Tightly-coupled LVI with pyramid training |
| LiV-GS | LiDAR + Vision | Outdoor | Yes (~8 FPS) | Covariance bridge + CGC |

## Strengths

1. **Photo-realistic rendering:** 36.45 dB PSNR on Replica — far exceeding point clouds or voxel grids for digital twin visualization.
2. **Global consistency in an RGB-only system:** Loop closure and global BA give Splat-SLAM trajectory quality competitive with RGB-D methods, a unique capability in the RGB-only Gaussian SLAM space.
3. **Closed-form deformation:** Gaussian map adapts to loop closures analytically in milliseconds — no re-training, no latency spike.
4. **Compact maps:** 5.2 MB per room (Replica), 70× smaller than GlORIE-SLAM and roughly 2× smaller than MonoGS — favorable for storage and transmission in fleet-mapping workflows.
5. **Explicit, editable representation:** Gaussians are inspectable, can be filtered (remove dynamic objects), segmented by projecting 2D labels, or diffed between survey runs for change detection.
6. **Differentiable pipeline:** Photometric gradients flow through the rasterizer to both Gaussian parameters and camera poses simultaneously.
7. **Depth-sensor-free operation:** Useful for platforms where adding a depth camera is not feasible; monocular depth prior fills gaps.

## Failure Modes

**1. Drift without loop closure on long sequences**
SplaTAM, MonoGS, and GS-SLAM have no loop closure — ATE grows without bound beyond ~100 m traversal or multi-room environments. Splat-SLAM and LoopSplat address this, but global BA is not free: it imposes a post-refinement cost of ~15 s per loop event.

**2. Dynamic scenes**
Moving objects (aircraft marshalling vehicles, baggage carts, ground support equipment, pedestrians) create inconsistent multi-view photometric constraints. Gaussians assigned to moving objects produce ghost/blob artifacts in the static map. Dynamic regions dominate photometric residuals, biasing pose estimates. Active research area (GARAD-SLAM, DGS-SLAM, WildGS-SLAM use segmentation masks or motion probability models). For airside use, dynamic GSE and aircraft movement are both problematic.

**3. Texture-less regions — the concrete apron problem**
Uniform walls, runways, concrete aprons, taxiways, and snow-covered terrain produce minimal photometric gradient. Gaussians cannot be reliably initialized or densified in these regions — producing holes in the map or poorly-constrained floating Gaussians. This is a fundamental architectural limit of purely photometric Gaussian SLAM. LiDAR supervision (LiHi-GS, LI-GS, Gaussian-LIC) directly addresses this, but pure camera-based Splat-SLAM does not.

**4. Large-scale / city-scale outdoor**
Indoor rooms: ~100K Gaussians, 5–200 MB. City-scale: naive linear scaling implies billions of Gaussians and tens of GB. Hierarchical approaches (submap paging, LoD, bounded spatial extent) are active research areas in 2024–2026; no production city-scale 3DGS-SLAM system exists as of mid-2026.

**5. Sky and unbounded scenes**
Background sky has no depth constraint — Gaussians grow to infinite scale. Gaussian-LIC's hemisphere sky model mitigates this; outdoor methods generally need explicit unbounded scene modeling (mip-NeRF 360-style tricks). Splat-SLAM does not include a native sky model.

**6. Not real-time at full quality**
End-to-end at full quality: 0.81–3.67 FPS on RTX 3090 Ti. For a survey vehicle at 30 km/h, this rules out closed-loop real-time SLAM. Suitable as an offline post-processing step after a survey drive.

**7. Surface reconstruction quality**
3DGS was designed for novel-view synthesis, not surface reconstruction. Gaussians represent blurry density blobs, not sharp surfaces. Mesh extraction from Gaussians is non-trivial and produces artifacts (requires opacity thresholding or surfel-based representations like LI-GS). For precision engineering measurements, NeRF-based SLAM or photogrammetry-grade point clouds are more appropriate.

**8. Motion blur and illumination change**
Photometric consistency breaks under fast rotation, motion blur, or rapid exposure change. Per-keyframe exposure compensation (affine `(a_k, b_k)`) partially addresses slow illumination drift; abrupt lighting changes (tunnel entry, strobe lights, headlights) still corrupt the photometric loss.

## Domain Fit

| Domain | Fit | Key Notes |
|--------|-----|-----------|
| Indoor rooms / labs | Good | Designed for this; Replica/TUM-RGBD are representative. Enough texture, stable lighting. |
| Building-scale indoor | Conditional | Loop closure needed for multi-room; global BA in Splat-SLAM helps but post-refinement is slow. |
| Road AV (offline) | Research | Camera-only; no IMU/wheel/GNSS/LiDAR. Useful as an appearance layer from trusted poses. |
| Road AV (online) | Not suitable | Not real-time; no safety-critical sensor fusion; no fault monitoring. |
| Airside survey (offline, appearance layer) | Conditional | See section below; useful only with LiDAR-primary geometry + Gaussian appearance hybrid. |
| Airside survey (online, primary localization) | Not suitable | Texture-less aprons, dynamic GSE, sky, and speed requirements all fail camera-only Gaussian SLAM. |
| Warehouse / port (indoor) | Conditional | Indoor with sufficient texture; dynamic fork trucks/vehicles need masking. |
| Agriculture / construction | Not suitable | Outdoor scale, dynamic objects, vegetation, and weather all stress camera-only methods. |

## Aggregated-Map Suitability: The Honest Assessment

**3DGS-SLAM is NOT a drop-in replacement for LiDAR-Inertial Odometry (LIO) in airside survey.**

Its value is precisely and only as an **APPEARANCE LAYER** (photo-realistic digital twin) anchored to LiDAR-primary geometry. The limitations are structural:

- **Texture-less concrete aprons**: Photometric loss yields zero gradient on uniform surfaces. Gaussians cannot be reliably initialized or refined without depth supervision. The vast majority of an airside apron is low-texture painted concrete.
- **Dynamic GSE and aircraft movement**: Moving objects corrupt both pose estimation and the static map. Splat-SLAM has no native dynamic-object handling.
- **Sky**: Unbounded background with no depth constraint; Gaussians grow to infinite scale without a sky model.
- **Scale and metric accuracy**: Monocular RGB has inherent scale ambiguity. Splat-SLAM's depth proxy is a learned estimate, not a calibrated sensor measurement. For centimeter-accurate survey, LiDAR is the only reliable primary.
- **Certification and integrity**: No covariance output, no health monitor, no map lifecycle management compatible with airside safety management.

**Recommended integration path for airside digital twin:**

```
Step 1: LIO front-end (FAST-LIO2 or LIO-SAM)
        → precise metric pose + dense LiDAR point cloud map
        → loop closure and global consistency from LiDAR pose graph

Step 2: Gaussian-LIC or LVI-GS
        → use LIO poses to seed 3D Gaussians from colorized LiDAR points
        → optimize photometric appearance with LiDAR depth supervision
        → sky hemisphere prior; dynamic-object mask applied pre-optimization

Step 3: Output
        → metric-accurate geometry from LiDAR (primary)
        → photo-realistic appearance from Gaussian layer (secondary)
        → digital twin asset: novel-view synthesis, semantic overlay,
          change detection, synthetic data generation
```

Gaussian-LIC and LVI-GS are the most practical integration paths for this survey-drive workflow because they run the LiDAR-Inertial-Camera factor graph as the authoritative pose source, and confine 3DGS to the appearance role it is actually suited for.

See [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) for the downstream use of such maps and [3DGS Digital Twin](../../simulation/3dgs-digital-twin.md) for simulation applications.

## Implementation Notes

- Use the official repository (`google-research/Splat-SLAM` or `eriksandstroem/Splat-SLAM`) as research code, not as a deployment component.
- Pin CUDA, PyTorch, diff-Gaussian-rasterization, and dependency versions carefully — the custom CUDA rasterizer is sensitive to version combinations.
- When evaluating: record whether trajectory alignment uses SE(3), Sim(3), or scale-only; monocular RGB systems must align with Sim(3) to report meaningful ATE without penalizing scale.
- Keep generated Gaussian maps separate from operational HD maps; never feed Gaussian map updates directly to a vehicle controller.
- Run dynamic-object filtering (semantic masking or motion segmentation) before building the Gaussian map to prevent dynamic objects from corrupting static geometry.
- Treat monocular depth-estimator outputs as depth priors with unknown calibration; validate against LiDAR or GNSS/INS ground truth before using for any metric application.
- For airside survey: apply LiDAR geometric supervision via Gaussian-LIC or LVI-GS rather than running Splat-SLAM standalone.
- For post-processing: the post-loop refinement step (~15 s per loop closure) is acceptable offline but incompatible with real-time use.
- Export trajectories and maps for independent QA against LiDAR, GNSS/INS, or surveyed ground control points.
- If scaling to larger scenes: consider submap-based approaches (LoopSplat, Gaussian-SLAM) which keep GPU memory bounded by not requiring all Gaussians in VRAM simultaneously.
- For downstream semantic labeling of the Gaussian map: project 2D semantic segmentation labels into 3D using the same differentiable rasterizer; see [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) for the aggregated-map pipeline.

## Sources

- Sandström, Tateno, Oechsle, Niemeyer, Van Gool, Oswald, Tombari. "Splat-SLAM: Globally Optimized RGB-only SLAM with 3D Gaussians." arXiv 2405.16544. https://arxiv.org/abs/2405.16544
- Splat-SLAM CVPR 2025 Workshop open-access paper. https://openaccess.thecvf.com/content/CVPR2025W/VOCVALC/papers/Sandstrom_Splat-SLAM_Globally_Optimized_RGB-only_SLAM_with_3D_Gaussians_CVPRW_2025_paper.pdf
- Official Splat-SLAM repository (Google Research). https://github.com/google-research/Splat-SLAM
- Author repository. https://github.com/eriksandstroem/Splat-SLAM
- SplaTAM: Keetha et al. arXiv 2312.02126. https://arxiv.org/abs/2312.02126 | https://github.com/spla-tam/SplaTAM
- MonoGS: Matsuki et al. CVPR 2024. arXiv 2312.06741. https://arxiv.org/abs/2312.06741 | https://github.com/muskie82/MonoGS
- GS-SLAM: Yan et al. CVPR 2024. arXiv 2311.11700. https://arxiv.org/abs/2311.11700 | https://gs-slam.github.io/
- Photo-SLAM: Huang et al. arXiv 2311.16728. https://arxiv.org/abs/2311.16728
- Gaussian-SLAM: Yugay et al. arXiv 2312.10070. https://arxiv.org/abs/2312.10070 | https://github.com/VladimirYugay/Gaussian-SLAM
- RTG-SLAM: SIGGRAPH 2024. arXiv 2404.19706. https://arxiv.org/abs/2404.19706 | https://github.com/MisEty/RTG-SLAM
- LoopSplat: 3DV 2025 Oral. arXiv 2408.10154. https://arxiv.org/abs/2408.10154 | https://github.com/GradientSpaces/LoopSplat
- DROID-Splat: ICCV 2025W. arXiv 2411.17660. https://arxiv.org/abs/2411.17660 | https://github.com/ChenHoy/DROID-Splat
- LIV-GaussMap: arXiv 2401.14857. https://arxiv.org/abs/2401.14857
- LiHi-GS: arXiv 2412.15447. https://arxiv.org/abs/2412.15447
- LI-GS: arXiv 2409.12899. https://arxiv.org/abs/2409.12899 | https://changjianjiang01.github.io/LI-GS/
- Gaussian-LIC: arXiv 2404.06926. https://arxiv.org/html/2404.06926v2
- LVI-GS: arXiv 2411.02703. https://arxiv.org/abs/2411.02703
- LiV-GS: arXiv 2411.12185. https://arxiv.org/abs/2411.12185
- NeRF/3DGS SLAM Survey: arXiv 2402.13255. https://arxiv.org/abs/2402.13255
- 3DGS-SLAM Next-Gen Survey (2026): arXiv 2602.04251. https://arxiv.org/abs/2602.04251
- awesome-NeRF-and-3DGS-SLAM list. https://github.com/3D-Vision-World/awesome-NeRF-and-3DGS-SLAM
- Local context: [GS-SLAM and MonoGS](gs-slam-monogs.md)
- Local context: [SplaTAM](splatam.md)
- Local context: [DROID-SLAM](droid-slam.md)
- Local context: [NICE-SLAM](nice-slam.md)
- Local context: [NeRF-SLAM](nerf-slam.md)
- Local context: [Multi-Agent Neural Gaussian SLAM](multi-agent-neural-gaussian-slam.md)
- Local context: [Gaussian Splatting for Driving](../../perception/overview/gaussian-splatting-driving.md)
- Local context: [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md)
- Local context: [3DGS Digital Twin](../../simulation/3dgs-digital-twin.md)
- Local context: [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md)
- Local context: [Volume Rendering, Radiance Fields, and Gaussian Splatting](../../../10-knowledge-base/geometry-3d/volume-rendering-radiance-fields-gaussian-splatting.md)
