# FAST-LIVO and FAST-LIVO2

<!-- method-priority:start
priority:
  learning: 4
  deployment: 5
  type: "method-family"
  stage: "modern-core"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "runtime-localization", "outdoor"]
  reason: "FAST-LIVO and FAST-LIVO2 is rated for LiDAR odometry, mapping, or scan-matching coverage in AV localization stacks."
method-priority:end -->

Related docs: [FAST-LIO and FAST-LIO2](fast-lio-fast-lio2.md), [LVI-SAM](lvi-sam.md), [R2LIVE and R3LIVE](r2live-r3live.md), [GLIM](glim.md), [KISS-ICP](./kiss-icp.md), [LIO-SAM](./lio-sam.md), [LOAM](./loam.md), [CT-ICP](./ct-icp.md), [Scan Context Family](./scan-context-family.md), [Learned LiDAR Place Recognition](./learned-lidar-place-recognition.md), [SplatSLAM](./splat-slam.md), [ERASOR](./erasor.md), and [robust state estimation and multi-sensor localization fusion](../overview/robust-state-estimation-multi-sensor.md).

Related overview pages: [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) (§1.1 map aggregation pipeline that FAST-LIVO2 feeds).

Related KB pages: [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md), [Rolling-Shutter LiDAR Deskew and Motion Distortion](../../../10-knowledge-base/geometry-3d/rolling-shutter-lidar-deskew-motion-distortion.md), [Sensor Calibration and Time Synchronization](../../../10-knowledge-base/geometry-3d/sensor-calibration-time-synchronization.md), [Lie Groups SE(3)/SO(3) and Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md).

**Last updated:** 2026-05-23

---

## What It Is

FAST-LIVO and FAST-LIVO2 are tightly-coupled LiDAR-Inertial-Visual Odometry (LIVO) frameworks from the **Mechatronics and Robotic Systems (MaRS) Laboratory**, Department of Mechanical Engineering, **University of Hong Kong**, under Prof. **Fu Zhang**.

**FAST-LIVO** (Zheng, Zhu, Xu, Liu, Guo, Zhang; IROS 2022; arXiv:2203.00893) added a sparse-direct visual branch to the FAST-LIO2 backbone. Instead of extracting ORB or FAST corners and tracking them with optical flow, it performs **direct photometric alignment of image patches to a colorized LiDAR map**. LiDAR provides per-point absolute depth, eliminating monocular scale ambiguity. The photometric residuals are fed directly into the same Iterated Error-State Kalman Filter (IEKF) as the LiDAR point-to-plane residuals — making it a **true tight coupling** rather than a loosely concatenated LIO + VIO pair.

**FAST-LIVO2** (Zheng, Xu, Zou, Hua, Yuan, He, Zhou, Liu, Lin, Zhu, Ren, Wang, Meng, Zhang; IEEE T-RO 2025; arXiv:2408.14035; DOI: 10.1109/TRO.2024.3502198) is a complete redesign released January 2025. It introduces a sequential Error-State IEKF (ESIKF) that runs LiDAR and visual updates in sequence rather than jointly, a unified hash-indexed voxel map, per-voxel plane priors used inside the affine image warp, dynamic reference patch scoring, and online camera exposure estimation.

FAST-LIVO2 is the **de-facto production-grade LIVO baseline** for survey-drive mapping (ground vehicles, slow UAVs) when LiDAR + IMU + camera are available. Its colorized voxel map is the closest off-the-shelf output to a survey-drive aggregated map ready for downstream segmentation. For pure LiDAR-only odometry without IMU or camera see [KISS-ICP](./kiss-icp.md); for the IMU-tight LIO baseline this family builds on see [FAST-LIO and FAST-LIO2](fast-lio-fast-lio2.md).

**Key identifiers:**

| Paper | Venue | arXiv | DOI / repo |
|---|---|---|---|
| FAST-LIO | IEEE RA-L 2021 | 2010.08196 | github.com/hku-mars/FAST_LIO |
| FAST-LIO2 | IEEE T-RO 2022 vol 38(4) 2053–2073 | 2107.06829 | same repo |
| FAST-LIVO | IROS 2022 | 2203.00893 | github.com/hku-mars/FAST-LIVO |
| FAST-LIVO2 | IEEE T-RO 2025 | 2408.14035 | github.com/hku-mars/FAST-LIVO2 |

---

## The FAST-LIO / FAST-LIO2 Baseline

Every FAST-LIVO system inherits the FAST-LIO2 LIO core. Understanding it is prerequisite to understanding the visual extension.

### Motivation

LOAM (2014) and its descendants (LIO-SAM, LeGO-LOAM) hand-engineer edge and planar feature extraction before running scan-to-map ICP variants. This creates two problems: the feature extractor is environment-specific, and feature matching imposes a computational bottleneck.

**FAST-LIO** (Xu, Zhang; RA-L 2021) addressed this with a tightly-coupled IEKF that absorbs IMU measurements and LiDAR edge/plane features together. Its key efficiency innovation: a Kalman gain reformulation whose cost depends on **state dimension** (~24) rather than **measurement dimension** (thousands of points), reducing the update from O(N²) in measurements to O(n_state²).

**FAST-LIO2** (Xu, Cai, He, Lin, Zhang; T-RO 2022) dropped feature extraction entirely and introduced:
1. **Direct raw-point registration** — all scan points used without edge/plane labeling.
2. **ikd-Tree** — an incremental k-d tree supporting insert/delete/rebalance without rebuilding.

### State Vector

The state lives on the manifold `SO(3) × ℝ³ × ℝ³ × ℝ³ × ℝ³ × S²`:

```
x = [ R_G^I,  p_G^I,  v_G^I,  b_g,  b_a,  g_G ]^T
```

`R_G^I ∈ SO(3)` is IMU-to-world rotation; `p`, `v` are position and velocity in the world frame; `b_g, b_a` are gyroscope and accelerometer biases; `g_G ∈ S²` is gravity direction (two effective DoF). Dimension: 18. FAST-LIVO2 extends this to 19D by adding online exposure time `τ`.

On-manifold arithmetic uses boxplus (⊞) and boxminus (⊟) operators. These are encapsulated in the **IKFoM** toolkit (He, Xu, Zhang; arXiv:2102.03804; github.com/hku-mars/IKFoM), which provides C++ templates for `ℝⁿ × SO(3) × S²` manifold products so the IEKF is implemented "just like a normal ℝⁿ filter." See also: [Lie Groups SE(3)/SO(3) and Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md).

### IMU Forward Propagation

Between LiDAR scans the state is propagated via discrete on-manifold kinematic integration:

```
R_{i+1} = R_i ⊞ (ω_m - b_g - n_g) Δt         [so(3) exponential map]
p_{i+1} = p_i + v_i Δt + ½(R_i (a_m - b_a - n_a) + g_G) Δt²
v_{i+1} = v_i + (R_i (a_m - b_a - n_a) + g_G) Δt
b_g, b_a, g_G: random walk noise
```

`ω_m, a_m` are gyroscope and accelerometer measurements; `n_g, n_a` are white Gaussian noise. The propagated state and covariance become the prior for the IEKF update.

### Backward IMU Propagation for Per-Point Deskewing

A LiDAR scan accumulates points over 50–100 ms while the platform moves. FAST-LIO/LIO2 applies **backward IMU propagation**: starting from the predicted end-of-scan state, the IMU is integrated backward to each point's timestamp `t_k`, yielding per-point transform `T_scan→world(t_k)`. This projects each point into the world frame at a common reference epoch before registration — critical for UAVs, fast vehicles, and vibrating platforms. See also: [Rolling-Shutter LiDAR Deskew and Motion Distortion](../../../10-knowledge-base/geometry-3d/rolling-shutter-lidar-deskew-motion-distortion.md).

### IEKF Update — Point-to-Plane Residual

For each raw LiDAR point `p_k` in the current scan, FAST-LIO2 finds the 5-nearest neighbors in the ikd-Tree map and fits a local plane with normal `n_j` and centroid `q_j`.

Point-to-plane residual:
```
r_k = n_j^T (R_G^I p_k^I + p_G^I - q_j)  ≈  0
```

Linearizing around the current estimate `x̂^κ` gives the measurement Jacobian `H_k^κ`. The iterated update at each IEKF iteration `κ`:

```
K^κ = P̂ (H^κ)^T [ H^κ P̂ (H^κ)^T + R ]^{-1}
x̂^{κ+1} = x̂^0 ⊞ K^κ (z - h(x̂^κ) - H^κ (x̂^0 ⊟ x̂^κ))
```

Via the matrix inversion lemma this is equivalent to:
```
K^κ = [ (H^κ)^T R^{-1} H^κ + P̂^{-1} ]^{-1} (H^κ)^T R^{-1}
```

The left factor has dimension `(n_state × n_state)` rather than `(n_meas × n_meas)` — dropping cost from O(N²) in measurement count to O(n_state²). Iterations run until `||x̂^{κ+1} ⊟ x̂^κ|| < ε` (typically ε ~0.001 rad / 0.001 m). See also: [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md).

### ikd-Tree

Paper: Cai, Xu, Zhang, "ikd-Tree: An Incremental K-D Tree for Robotic Applications," arXiv:2102.10808. Code: github.com/hku-mars/ikd-Tree.

An incremental k-d tree supporting insert, delete, box-delete, and partial rebalancing via a background thread — consuming ~4% of the CPU time of a full static k-d tree rebuild. On-tree downsampling (voxel-grid filter integrated into the structure) avoids the need for a separate pre-processing pass. The ikd-Tree maintains a **local sliding map**: points beyond a configurable radius (default ~200–300 m) are evicted, keeping memory bounded. FAST-LIVO2 replaces the ikd-Tree with a hash-indexed voxel map (see below), but the ikd-Tree remains the map structure in FAST-LIO2 standalone and FAST-LIVO.

---

## Core Technical Idea

FAST-LIVO / FAST-LIVO2 extends FAST-LIO2 by adding a **VIO subsystem that performs sparse direct photometric alignment to the colorized LiDAR map** instead of feature tracking. The key design decisions are:

1. **No feature extraction.** No ORB corners, no FAST keypoints, no optical flow. The photometric residual is computed directly from pixel-level image intensity differences between the current frame and a reference patch stored with each LiDAR map point.

2. **LiDAR depth eliminates scale ambiguity.** Each map point has an absolute 3D position from LiDAR; the camera patch is anchored to that geometry. There is no need for triangulation or scale initialization.

3. **Inverse-compositional Jacobian.** The photometric Jacobian is pre-computed in the reference patch frame (Baker-Matthews, IJCV 2004), avoiding re-linearization at each IEKF iteration and making the visual update cheap relative to the LiDAR update.

4. **True tight coupling.** Photometric residuals enter the **same IEKF state** as LiDAR point-to-plane residuals, not a separate error-state estimator. Visual measurements constrain the same `[R, p, v, b_g, b_a, g_G]` state vector as LiDAR.

5. **Unified colorized voxel map (FAST-LIVO2).** The map is a single hash-indexed voxel structure where each voxel stores both the LiDAR plane fit and the camera patch pyramid. Geometry and appearance are co-located and mutually supporting.

---

## Operator Mechanics

### FAST-LIVO Photometric Residual

For each selected map point `p_j` with stored reference patch `T_r(u)` around pixel `u_r`:

**Affine warp** from reference frame to current frame, using the local LiDAR plane normal `n` and point depth `p`:

```
A_r^i = P · (R_{I_r}^{I_i} + t_{I_r}^{I_i} · (1 / (n^T · p)) · n^T) · P^{-1}
```

where `P` is the camera intrinsic matrix, `R_{I_r}^{I_i}, t_{I_r}^{I_i}` are the relative pose between reference frame `r` and current frame `i`.

**Photometric error** summed over the sparse selection `S` of map points and their patch pixels:

```
e_vis = Σ_{j ∈ S} Σ_{u ∈ patch_j} || I_i(A_r^i · u_r) - I_r(u_r) ||₂
```

This is linearized via the inverse-compositional SE(3) Jacobian `∂e_vis / ∂ξ` (where `ξ ∈ se(3)`) and fed into the IEKF as an additional measurement residual alongside the LiDAR point-to-plane residuals.

**Outlier rejection:** map points near depth discontinuities (detected by comparing LiDAR neighbor depths) or outside the image frustum are masked before computing the photometric residual.

### FAST-LIVO2 Sequential ESIKF

FAST-LIVO treated LiDAR and visual measurements in a joint update. FAST-LIVO2 introduces **sequential Bayesian fusion** to handle the dimension and noise-statistic mismatch:

**Step 1 — LiDAR IEKF update:**
Run the IEKF with point-to-plane residuals from the current LiDAR scan. Produces updated state `x̂_L` and covariance `P_L`.

**Step 2 — Visual IEKF update:**
Initialize from `x̂_L, P_L` and run IEKF with photometric residuals from visible map points in the current image (multi-level pyramid). Produces final state `x̂` and `P`.

Under statistical independence of LiDAR and image noise (proven in the T-RO paper), this is **theoretically equivalent to a joint update**, but is numerically more stable, allows different iteration counts per modality, and avoids forming the combined Jacobian.

Algorithm sketch (Algorithm 1 from paper):
```
1. IMU propagation: predict x̂^0, P̂ from last state
2. LiDAR block:
   κ = 0
   while ||x̂^{κ+1} ⊟ x̂^κ|| > ε_L:
       compute H_L, r_L from point-to-plane residuals
       update via state-dim Kalman gain
       κ += 1
3. Visual block:
   for each pyramid level l (coarse to fine, 3 levels):
       while ||x̂^{κ+1} ⊟ x̂^κ|| > ε_V:
           compute affine warp A_r^i using LiDAR plane normals
           compute H_V, r_V from photometric residuals
           update via state-dim Kalman gain
           κ += 1
4. Update unified voxel map with new scan points and patches
```

Coarse-to-fine pyramid: 3 levels, base 8×8 pixels, halved per level. This stabilizes large-baseline photometric matching.

### FAST-LIVO2 Unified Voxel Map

FAST-LIVO2 replaces the ikd-Tree with a **hash-indexed voxel map**:
- Root voxels: 0.5 × 0.5 × 0.5 m cells in a hash table
- Up to 3 octree subdivision layers per root voxel (leaf ~6 cm)
- Each voxel stores plane fit: centroid `q`, normal `n`, covariance `Σ_{n,q}` (via incremental SVD)
- Visual map points are selected from LiDAR points that have significant image gradient and are spatially distributed (grid-based selection at 30×30 px resolution)
- Each selected visual point stores a **3-level patch pyramid** (reference image coordinates)
- **Ring-buffer eviction:** voxels farther than `L` meters from the sensor are evicted to bound memory (default ~200 m edge length in the resource-constrained variant)

The co-location of LiDAR plane geometry and camera patches in the same voxel is what enables the LiDAR plane normal `n` to be used directly inside the affine warp `A_r^i`.

### Plane-Prior Warping

FAST-LIVO assumed all pixels in a reference patch share the same depth (frontoparallel assumption). FAST-LIVO2 uses the voxel plane normal for a per-pixel depth correction via the homography:

```
A_r^i = P · (R_{I_r}^{I_i} + t_{I_r}^{I_i} · (1 / (n^T · p)) · n^T) · P^{-1}
```

The normal `n` is also **refined online** by minimizing photometric error over the current frame set, allowing the surface orientation to be jointly estimated with pose.

### Dynamic Reference Patch Scoring

Rather than keeping the first visible frame as the reference patch, FAST-LIVO2 scores candidate reference frames by:

```
S(f, g_i) = (1 - ω₁) · (1/n) Σ NCC(f, g_i) + ω₁ · c
```

where `NCC(f, g_i)` is normalized cross-correlation between the current patch and candidate frame `i`, `c = n · p / ||p||` is cosine similarity between the surface normal and the viewing direction (favoring orthogonal view angles), and `ω₁` is weighted by `trace(Σ_n)` (plane uncertainty). This selects high-parallax, high-texture, accurate-geometry reference patches, reducing failures on repeating textures and featureless surfaces.

### On-Demand Voxel Raycasting

Livox Avia and similar sensors have a minimum range (~0.1–0.5 m) and a blind zone near the sensor. When the sensor is close to an obstacle, nearby map voxels may not receive new LiDAR returns even though they are visible in the image. FAST-LIVO2 adds on-demand raycasting that synthesizes map depth values for these voxels from the current pose, keeping the visual measurement model valid in confined spaces.

---

## Inputs and Outputs

| Item | Description |
|---|---|
| **LiDAR** | 3D point cloud per sweep; per-point timestamps required for backward deskewing |
| **IMU** | 6-axis or 9-axis at ≥200 Hz; tight coupling — not optional |
| **Camera** | Monocular RGB; hardware-synchronized to LiDAR (FAST-LIVO); relaxed in FAST-LIVO2 |
| **Output: odometry T_t** | SE(3) pose at each LiDAR scan; full 6-DoF trajectory |
| **Output: colorized voxel map** | Hash-indexed voxels with per-voxel plane fit, normals, and camera patches; the aggregated survey-drive map |
| **Output: covariance P** | IEKF posterior covariance; suitable for factor-graph fusion |
| **Derived output** | Colorized point cloud (each scan transformed by `T_t`, with color from associated camera patches) |

FAST-LIVO2 also supports downstream dense reconstruction — NeRF and Gaussian Splatting scene reconstruction are demonstrated in the T-RO paper, using the colorized voxel map as initialization.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Sensors: LiDAR (10 Hz) + IMU (200 Hz) + Camera (10-30 Hz)     │
└───────────────┬────────────────────────────────────────────────-┘
                │
         [IMU propagation]
         Predict x̂^0, P̂ via on-manifold kinematic integration
                │
         [Backward IMU deskew]
         Per-point pose T(t_k) for each LiDAR point
                │
                ├──────────────────────────────────────────────────┐
                │                                                  │
         [LiDAR IEKF update]                              [Visual IEKF update]
         Point-to-plane residuals                         Photometric residuals
         r_k = n_j^T (R p_k + p - q_j)                  e_vis = Σ ||I_i(A·u) - I_r(u)||
         5-NN in hash voxel map                           3-level patch pyramid
         state-dim Kalman gain                            affine warp with LiDAR normal
         iterate until ||Δx|| < ε_L                      iterate until ||Δx|| < ε_V
                │                                                  │
                └──────────────── sequential ──────────────────────┘
                │
         [Map update]
         Insert new LiDAR points into voxel map
         Update plane fits (incremental SVD)
         Select, score, and update visual patches
         Evict distant voxels (sliding window)
                │
         Output: T_t pose + P covariance + colorized voxel map
```

**State vector (FAST-LIVO2, 19D):**
```
x = [ R_G^I ∈ SO(3),  p_G^I ∈ ℝ³,  v_G^I ∈ ℝ³,  b_g ∈ ℝ³,  b_a ∈ ℝ³,  g_G ∈ S²,  τ ∈ ℝ ]
```

`τ` is inverse camera exposure time, modeled as a random walk. Estimating it online allows FAST-LIVO2 to handle illumination variation and automatic exposure changes without injecting photometric error into the pose estimate.

**Asynchronous processing timing:** LiDAR, IMU, and camera arrive at different rates. IMU integration runs at the IMU rate (200 Hz); the IEKF update is triggered by each LiDAR scan (~10 Hz for Livox Avia); the visual update runs on the camera image that is temporally closest to the LiDAR scan. No synchronization barrier between camera and LiDAR is required in FAST-LIVO2 (contrast with FAST-LIVO which required hard hardware sync).

---

## FAST-LIVO2 Contributions over FAST-LIVO

| Aspect | FAST-LIVO (2022) | FAST-LIVO2 (2025) |
|---|---|---|
| IEKF strategy | Joint LiDAR+Visual update | Sequential LiDAR then Visual (ESIKF) |
| Map structure | ikd-Tree (point cloud) + attached patches | Hash voxel map with plane fits + patches |
| Patch depth assumption | Constant depth per patch (frontoparallel) | LiDAR plane normal per voxel (homography) |
| Reference patch | Fixed (first visible frame) | Dynamic scored selection (NCC + viewing angle) |
| Exposure time | Not estimated | Estimated online as state variable τ |
| Blind-zone handling | None | On-demand voxel raycasting |
| Camera sync | Hard hardware sync required | Relaxed — time offset not explicitly estimated but no hard-sync requirement in the repo |
| Camera model | Pinhole | Pinhole + fisheye |
| Accuracy (Hilti avg RMSE) | Not directly reported | ~3.4 cm average on Hilti 16-sequence set |
| Memory | Not reported separately | ~2.5 GB full; ~1.7 GB resource-constrained variant |

---

## Computational Performance

### FAST-LIO2 Standalone

CPU-only; no GPU anywhere in the pipeline. Runs at >100 Hz odometry + mapping on Intel i7/i9 class processors. Reliable in real-time on ARM Cortex-A76 class (RK3588, Jetson Orin NX). FAST-LIO2's CPU-only fame is a primary reason the lineage is widely deployed on mobile platforms without discrete GPUs.

### FAST-LIVO2 on x86

Benchmark from the resource-constrained variant paper (arXiv:2501.13876), hardware: **Intel Core i9-13900HX**:

| Component | Mean latency | Std dev | Implied rate |
|---|---|---|---|
| LiDAR update | 23.36 ms | ±2.36 ms | — |
| Visual update | 2.64 ms | ±1.12 ms | — |
| **Total per-frame** | **25.99 ms** | **±3.22 ms** | **~38 Hz** |

The visual component is fast because only a sparse set of map points (~100–200, grid-sampled) are used for photometric alignment — not the full image.

### FAST-LIVO2 on ARM (RK3588)

Hardware: ~$100 RK3588 8-core (A76+A55 @ 2.4 GHz), **CPU-only**:

| Component | Mean latency | Std dev | Implied rate |
|---|---|---|---|
| LiDAR update | 53.83 ms | ±5.35 ms | — |
| Visual update | 3.99 ms | ±1.80 ms | — |
| **Total per-frame** | **57.82 ms** | **±6.75 ms** | **~17 Hz** |

Real-time operation well within a 100 ms budget (10 Hz Livox Avia). Jetson Orin NX (A78AE cores, faster per-core than RK3588 A76) is expected to perform closer to the x86 figure — no published Orin benchmark has been found as of May 2026.

### Resource-Constrained Variant

arXiv:2501.13876 reports a variant achieving **33% lower runtime** and **47% lower memory** versus full FAST-LIVO2, at the cost of Hilti average RMSE increasing from ~3.4 cm to ~6.3 cm. This variant uses a reduced voxel map eviction radius and reduced patch pyramid levels.

### GPU Usage

The standard FAST-LIVO2 repository makes no mention of GPU acceleration. The visual component runs entirely on CPU. GPU acceleration is not required for real-time operation at typical LiDAR rates.

---

## Key Parameters

| Parameter | Default / Range | Description |
|---|---|---|
| Root voxel size | 0.5 m | Hash-map voxel side length; smaller = denser, slower |
| Octree depth | 3 levels | Subdivision layers per root voxel; leaf ~6 cm |
| Visual point grid | 30×30 px | Grid cell size for map point selection from camera |
| Patch pyramid levels | 3 | Base 8×8 px; halved per level |
| IEKF ε_L | ~0.001 rad / 0.001 m | LiDAR IEKF convergence threshold |
| IEKF ε_V | ~0.001 rad / 0.001 m | Visual IEKF convergence threshold |
| Sliding map radius | ~200 m (edge) | Voxel eviction radius; resource-constrained variant reduces this |
| IMU rate | ≥200 Hz | Minimum for reliable backward deskewing |
| IEKF max iterations (LiDAR) | typically 3–5 | Cap on IEKF iterations; trades accuracy for latency |

---

## Benchmark Results

### Hilti SLAM Challenge (16 Sequences, RMSE ATE in meters)

From arXiv:2501.13876, comparing full FAST-LIVO2 against the efficient variant and other systems. Ground truth from total station (millimeter-accurate).

| Sequence | FAST-LIVO2 RMSE (m) | Efficient variant (m) |
|---|---|---|
| Construction Ground | 0.010 | — |
| Long Corridor | 0.067 | — |
| Outside Building | 0.035 | — |
| Stairs | 0.018 | — |
| **Average (16 sequences)** | **0.034** (~3.4 cm) | **0.063** (~6.3 cm) |

FAST-LIVO2 is the best system in the comparison. The Long Corridor sequence shows the highest RMSE (0.067 m) due to geometric degeneracy along the corridor axis — one competing system in the paper achieved 0.054 m there by adaptively disabling vision when LiDAR constraints were sufficient.

### NTU-VIRAL

After the January 2025 update, FAST-LIVO2 reports approximately **2 cm RMSE** on NTU-VIRAL (UAV platform, Singapore campus, spinning LiDAR + stereo cameras + IMU, 25 sequences). Earlier versions achieved ~6 cm.

### MARS-LVIG (UAV Aerial Dataset)

HKU MaRS group's own aerial dataset: 21 sequences, UAV at 80–130 m altitude, downward-looking Livox solid-state LiDAR, global-shutter RGB camera, RTK GNSS ground truth. Environments: aero-model airfield, island, rural town, valley. Max path 7.148 km, max scan area 577,000 m², speeds 3–12 m/s.

FAST-LIO2 (LIO-only) underperforms multi-modal systems in sequences with LiDAR degradation (sparse returns at high altitude over open flat ground). R3LIVE and FAST-LIVO2 show distinct improvement over FAST-LIO2 in those sequences. This is directly relevant to airside mapping over wide-open aprons.

### Comparison vs. Representative Systems

| System | Type | Hilti avg RMSE | Notes |
|---|---|---|---|
| **FAST-LIVO2** | LiDAR+IMU+Camera, direct | **~3.4 cm** | T-RO 2025; best in comparison |
| FAST-LIO2 standalone | LiDAR+IMU, direct | Not reported on Hilti | Degrades in LiDAR-degenerate sections |
| R3LIVE | LiDAR+IMU+Camera, loosely coupled | Not directly comparable | Weaker pose coupling than FAST-LIVO2 |
| LVI-SAM | LiDAR+IMU+Camera, factor graph | Not compared here | Includes loop closure |
| KISS-ICP | LiDAR only, no IMU | Not evaluated on Hilti | See kiss-icp.md |
| CT-ICP | LiDAR only, continuous-time | Competitive on KITTI | See ct-icp.md |
| LIO-SAM | LiDAR+IMU, factor graph | Competitive | Requires loop closure for long drives |

---

## The Lineage

```
2014  LOAM (Zhang, Singh, RSS)
        ↓  edge + plane feature ICP
2018  LIO-SAM (Shan, Englot) — pose-graph + loop closure, spinning LiDAR
        ↓
2021  FAST-LIO (Xu, Zhang, RA-L) — IEKF, state-dim Kalman gain, feature-based LIO
      ikd-Tree (Cai, Xu, Zhang, arXiv:2102.10808) — incremental k-d tree
      IKFoM (He, Xu, Zhang, arXiv:2102.03804) — on-manifold IEKF toolkit
        ↓
2022  FAST-LIO2 (Xu, Cai et al., T-RO) — direct raw-point + ikd-Tree
      FAST-LIVO (Zheng et al., IROS) — + sparse-direct visual branch
      R3LIVE (Lin, Zhang, ICRA) — parallel LIVO from same group, different VIO arch.
        ↓
2023  KISS-ICP (Vizzo et al., RA-L) — minimal ICP, no IMU, robust baseline
      R3LIVE++ (Lin et al.) — + radiance field reconstruction
        ↓
2024  FAST-LIVO2 (Zheng et al., T-RO 2025) — sequential ESIKF, unified voxel map
2025  Resource-constrained FAST-LIVO2 (arXiv:2501.13876) — 33% faster, 47% less memory
```

Related pages: [LOAM](./loam.md), [LIO-SAM](./lio-sam.md), [FAST-LIO and FAST-LIO2](fast-lio-fast-lio2.md), [R2LIVE and R3LIVE](r2live-r3live.md), [KISS-ICP](./kiss-icp.md), [CT-ICP](./ct-icp.md).

---

## R3LIVE vs. FAST-LIVO — The Same-Group Distinction

Both are from HKU MaRS (Fu Zhang PI; R3LIVE led by **Jiarong Lin**, FAST-LIVO led by **Chunran Zheng**). They are distinct systems:

| Aspect | R3LIVE (ICRA 2022) | FAST-LIVO (IROS 2022) |
|---|---|---|
| LIO backbone | FAST-LIO (feature-based) | FAST-LIO2 (direct raw-point) |
| VIO approach | Separate VIO subsystem renders color onto LiDAR-geometry map | Tightly-coupled: photometric residuals fed directly into IEKF |
| Visual coupling | Loosely coupled to LIO (separate state estimator) | Tightly coupled (same IEKF state) |
| Map representation | Point cloud + per-point color | ikd-Tree + per-point patches |
| Primary claim | Mapping quality (dense colorized map) | Pose accuracy |

R3LIVE++ (2022/23) extends R3LIVE with Neural Radiance Field reconstruction. FAST-LIVO2 also demonstrates NeRF and Gaussian Splatting as downstream outputs from its colorized voxel map.

The key distinction: R3LIVE's VIO uses a separate error-state estimator that does not directly constrain the LiDAR-inertial IEKF. FAST-LIVO/2 feeds photometric residuals directly into the same IEKF state — true tight coupling — which is why FAST-LIVO2's pose accuracy benchmarks exceed R3LIVE on standard datasets.

---

## MaRS Lab Ecosystem

| Repo | URL | Role |
|---|---|---|
| hku-mars/FAST_LIO | github.com/hku-mars/FAST_LIO | FAST-LIO + FAST-LIO2 combined |
| hku-mars/FAST-LIVO | github.com/hku-mars/FAST-LIVO | FAST-LIVO IROS 2022 |
| hku-mars/FAST-LIVO2 | github.com/hku-mars/FAST-LIVO2 | FAST-LIVO2 T-RO 2025 |
| hku-mars/ikd-Tree | github.com/hku-mars/ikd-Tree | Incremental k-d tree |
| hku-mars/IKFoM | github.com/hku-mars/IKFoM | On-manifold IEKF toolkit |
| hku-mars/r3live | github.com/hku-mars/r3live | R3LIVE ICRA 2022 |
| xuankuzcr/LIV_handhold | github.com/xuankuzcr/LIV_handhold | Hardware sync rig, CAD + STM32 source |

**Downstream uses of the MaRS ecosystem:**
- **ikd-Tree** is used in dozens of downstream SLAM papers as a drop-in dynamic map.
- **IKFoM** is adopted by LIMOncello, Super-LIO, and many academic variants.
- **better_fastlio2** — community extension adding dynamic removal (T-GRS 2024), multi-session mapping, object-level map updates, and online relocalization.
- **FAST-LIO-COLOR-MAPPING** (YWL0720) — community fork adding RGB colorization to FAST-LIO2 output by fusing camera post-hoc, used before FAST-LIVO2 was released.
- Downstream use in: Voxblox-style dense mapping initialization, multi-robot relative localization, NeRF/3DGS scene reconstruction priors, precision agriculture UAV navigation.

The MaRS group's open-source pattern: paper + code + dataset released together, with active GitHub maintenance. FAST-LIVO2 code was released January 23, 2025, aligned with T-RO acceptance.

---

## Strengths

- **No visual feature extraction** — immune to FAST corner detector failures in low-texture scenes (photometric methods still need gradient for convergence, but the failure mode is graceful degradation to LIO, not a tracking failure with spurious constraints).
- **True tight coupling** — vision corrects LiDAR drift continuously through the IEKF state; not a loosely concatenated LIO + VIO pair.
- **Direct use of LiDAR depth** — eliminates monocular scale ambiguity entirely; no triangulation or scale initialization required.
- **Exposure compensation** — online τ estimation handles auto-exposure flicker and gradual illumination changes.
- **CPU-only, real-time** — no GPU required; 38 Hz on x86 i9, 17 Hz on sub-$100 ARM RK3588.
- **Colorized map output** — the FAST-LIVO2 voxel map is the closest off-the-shelf output to a survey-drive aggregated map ready for downstream semantic segmentation, without a separate post-processing colorization step.
- **Simultaneous robustness to LiDAR and visual degeneracy** — the sequential ESIKF allows each modality to rescue the other: vision helps in LiDAR-degenerate sections (open aprons), LiDAR helps when the image is partly occluded or motion-blurred.
- **Validated on aerial platforms** — MARS-LVIG demonstrates survey-grade performance on airfield-class environments at 80–130 m altitude.
- **Downstream reconstruction** — demonstrated as initialization for NeRF and Gaussian Splatting, making it a direct input to photorealistic scene reconstruction pipelines.

---

## Failure Modes

### Geometric Degeneracy (Long Corridors, Tunnels)

FAST-LIO2 diverges in extended self-similar environments (tunnel, long uniform corridor) where point-to-plane residuals become rank-deficient along the corridor axis. The visual branch in FAST-LIVO2 partially rescues this if texture is present. In a painted concrete corridor, the camera provides little additional constraint. Quantified: the "Long Corridor" Hilti sequence achieves 0.067 m RMSE with FAST-LIVO2 — a competing system reached 0.054 m there by adaptively disabling vision. For the corridor degeneracy failure mode quantified on a pure LiDAR system, see [KISS-ICP](./kiss-icp.md) (GenZ-ICP comparison: 6.83 m APE on Long_Corridor). FAST-LIVO2 is substantially better in corridors than KISS-ICP, but the failure mode is not fully eliminated.

### Low-Light and Night Operation

The photometric branch requires an adequately exposed image. Under dark conditions (nighttime apron, unlit hangar interior), the camera provides no useful residuals. FAST-LIVO2's τ estimator helps with gradual changes but cannot handle step-function darkness. In this regime the system degrades to FAST-LIO2 (LIO only) — acceptable if LiDAR constraints are sufficient, but the colorized map benefit disappears.

### Overexposure

The Hilti "Outside Building" sequence (near windows, direct sunlight) shows FAST-LIVO2 RMSE of 0.035 m versus 0.010 m in controlled indoor — a 3.5× degradation. Overexposed regions saturate image gradients; photometric residuals become numerically zero, effectively dropping those map points.

### Texture-Less Environments

Featureless painted walls, white snow, uniform concrete provide zero image gradient. The patch selection filter (gradient threshold) removes these points from the visual measurement set, leaving only LiDAR constraints. This is handled gracefully (degrades to LIO) but means the visual branch provides no benefit in the most common airport-surface scenario: wide open asphalt apron. The LiDAR branch also has limited planar structure on open aprons, potentially compounding.

### Retroreflectors and LiDAR Intensity Saturation

Retroreflective airport markings (runway centerlines, apron edge markings) can return intensity values that saturate the LiDAR receiver (range measurement valid but intensity invalid). FAST-LIO2 uses only geometry (point-to-plane), so intensity saturation does not affect the LIO core. However, if the visual branch attempts to align image patches over retroreflective markings, the image pixels may be overexposed — the exposure estimator will attempt to compensate, potentially introducing bias. No specific paper treatment found; flagged as an operational concern for airside deployment.

### Aggressive Maneuvers

For rotation rates above 1000 deg/s, IMU gyroscopes may saturate. Below this limit, FAST-LIO2 has demonstrated reliable tracking at 1000 deg/s. This threshold is not typically encountered in ground survey vehicles or slow-UAV survey platforms.

### Local Map Only — No Loop Closure

The voxel map maintains a sliding local window (~200 m). No loop closure or global bundle adjustment is included. In long survey drives (>1 km), drift accumulates. For the airside survey use case, post-processing with a global ICP refinement step or scan-matching backend (LIO-SAM-style pose graph, ScanContext descriptor — see [Scan Context Family](./scan-context-family.md) and [Learned LiDAR Place Recognition](./learned-lidar-place-recognition.md)) is recommended to build the final aggregated map.

### Memory

Full FAST-LIVO2 uses ~2.5 GB RAM on Hilti sequences. For onboard embedded platforms this may require the resource-constrained variant (arXiv:2501.13876), which reduces to ~1.7 GB at the cost of ~6.3 cm average RMSE.

### Hard Synchronization (FAST-LIVO)

FAST-LIVO's original release **requires hardware-synchronized camera and LiDAR**. The README states: "can only work in the hard synchronized LiDAR-Inertial-Visual dataset because time offset estimation between camera and IMU is unimplemented." FAST-LIVO2 relaxes this requirement. See also: [Sensor Calibration and Time Synchronization](../../../10-knowledge-base/geometry-3d/sensor-calibration-time-synchronization.md).

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Airside — terminal / jetway zone | Strong | Rich vertical geometry (terminal facades, jetways, signage); camera texture abundant; LiDAR and vision both strong |
| Airside — open apron mapping | Conditional | LiDAR geometry sparse at distance; visual texture mostly ground markings; IMU integration helps, but both modalities partially degrade; supplement with GNSS anchoring or loop closure |
| Airside — hangar interior | Good | Textured walls and structure; watch overexposure near bay doors; good LiDAR constraint from walls |
| Warehouse / indoor flat | Strong | Textured walls, shelving, structured geometry; demonstrated use case |
| UAV aerial survey (low altitude) | Strong | MARS-LVIG is the primary validation dataset; IMU essential for aggressive maneuvers |
| Urban road AV | Good | Standard outdoor SLAM use case; rich LiDAR geometry and visual texture |
| Mining / construction | Good | Hilti construction sequences are the primary benchmark; diverse geometry |
| Long straight traversal (runway, highway) | Conditional | Corridor degeneracy risk; supplement with GPS/RTK |
| Night / unlit environments | Weak | Degrades to LIO only; photometric residuals unusable |
| Handheld survey | Good | Demonstrated use case; hardware sync rig available (LIV_handhold) |
| Port / logistics yard | Good | Mixed structured geometry; crane infrastructure provides LiDAR targets |

---

## Aggregated-Map Suitability

For a ground survey vehicle or slow UAV mapping an airport apron with LiDAR + IMU + camera, FAST-LIVO2 is typically the preferred choice over KISS-ICP when:

1. **IMU integration matters** — FAST-LIVO2 integrates IMU at 200 Hz, providing robustness to vibration and brief LiDAR outages. KISS-ICP uses a constant-velocity model that degrades on rough taxiway surfaces or during turns.

2. **Colored map output is needed** — FAST-LIVO2 outputs a voxel map with per-voxel plane geometry and associated image patches. With texture-blending post-processing, this is directly usable as a colorized point cloud for semantic segmentation. See [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) §1.1.

3. **LiDAR-degenerate sections exist** — wide-open apron has sparse point returns at distance; open-field areas near runway ends may have insufficient planar structure for pure LiDAR ICP. The visual branch provides additional constraints in these sections.

4. **Survey accuracy** — 3.4 cm average RMSE on the Hilti construction dataset is consistent with professional survey-grade requirements for infrastructure mapping.

**Honest notes on production deployment:**

- **No GNSS fusion.** FAST-LIVO2 is pure dead-reckoning from LiDAR + IMU + camera. For large airside surveys (full runway at 3 km), drift accumulates without global anchoring. MARS-LVIG uses RTK as ground truth but not as a live input to FAST-LIVO2. Consider GNSS-aided anchoring at known reference points or a post-processing pose-graph with GPS/RTK priors.

- **Local map only.** The ~200 m sliding window means that a closed survey loop (vehicle returning to start) will not automatically close. Add a scan-matching loop-closure step (ScanContext, learned place recognition) on top of the FAST-LIVO2 trajectory for large-area surveys.

- **Hard sync requirement in FAST-LIVO.** Use FAST-LIVO2, which relaxes this. Confirm against the repository whether hardware trigger is still recommended for best accuracy.

- **Map density.** The voxel map (0.5 m root voxels, ~6 cm leaf) may be coarser than needed for precise segmentation of painted markings. Consider storing raw accumulated LiDAR points in a parallel high-density `pcl::PointCloud` alongside the FAST-LIVO2 pose trajectory for full-resolution segmentation.

- **Dynamic objects.** Aircraft, GSE, and service vehicles on the apron will corrupt voxel map patches if not masked. Upstream dynamic-object filtering or downstream map cleaning ([ERASOR](./erasor.md)) is required for long-term map reuse.

**As the de-facto production LIVO baseline:** as of early 2025, FAST-LIVO2 is the most complete open-source tightly-coupled LIO+camera system that directly outputs a colorized voxel map without a separate post-processing colorization step. For pure LIO (no camera), FAST-LIO2 remains the CPU-only, no-GPU, no-frills production baseline — the de-facto community standard against which new LIO papers benchmark. See [FAST-LIO and FAST-LIO2](fast-lio-fast-lio2.md) for the standalone LIO baseline.

---

## Library Ecosystem

**GitHub repositories (all GPLv2, commercial licensing available from HKU):**
- FAST-LIVO2: https://github.com/hku-mars/FAST-LIVO2 (released January 23, 2025)
- FAST-LIVO: https://github.com/hku-mars/FAST-LIVO
- FAST_LIO (FAST-LIO + FAST-LIO2): https://github.com/hku-mars/FAST_LIO
- Hardware sync rig: https://github.com/xuankuzcr/LIV_handhold (CAD files + STM32 source)

**ROS integration:** all repos provide ROS launch files, rviz configs, and bag-file replay support. Standard topics: `/livox/lidar`, `/livox/imu`, `/camera/image_raw`. ROS 1 (Melodic/Noetic) primary; ROS 2 integration requires community wrappers.

**Supported LiDARs (FAST-LIVO2):** Livox Avia (primary test platform), MID-70, Horizon; any spinning LiDAR via `sensor_msgs/PointCloud2` with standard ring/time fields (Velodyne, Ouster).

**Supported cameras:** monocular RGB (pinhole); fisheye model supported in FAST-LIVO2.

**Key dependencies:**
- Ubuntu 18.04–20.04; ROS Melodic/Noetic
- Eigen ≥3.3.4, PCL ≥1.8, OpenCV ≥4.2
- Sophus (double-only version), Vikit (`rpg_vikit` flavor — different from FAST-LIVO1)
- livox_ros_driver for Livox sensors

**Dataset compatibility:**
- NTU-VIRAL: supported (GitHub issue #192 provides configuration files)
- Hilti: supported (evaluated in T-RO paper)
- MARS-LVIG: supported (HKU group's own dataset)
- KITTI: FAST-LIO2 supports KITTI; FAST-LIVO2 KITTI support not confirmed

**Calibration tooling:** FAST-Calib (github.com/hku-mars/FAST-Calib) is the recommended LiDAR-camera extrinsic calibration workflow from the same group. See also: [Sensor Calibration and Time Synchronization](../../../10-knowledge-base/geometry-3d/sensor-calibration-time-synchronization.md).

---

## Implementation Notes

- **Use FAST-LIVO2, not FAST-LIVO, for new deployments.** FAST-LIVO2 relaxes the hard hardware sync requirement, adds online exposure estimation, and achieves ~3.4 cm Hilti RMSE vs. no reported figure for FAST-LIVO.

- **Validate the LiDAR-only (FAST-LIO2) mode first.** Confirm that the LIO subsystem is tracking correctly before enabling the visual branch. A clean LIO trajectory is prerequisite for good photometric patch alignment.

- **Calibrate extrinsics carefully.** Direct photometric methods are highly sensitive to LiDAR-to-IMU and camera-to-IMU extrinsic calibration errors. Use FAST-Calib or an equivalent validated workflow. Even a few millimeters of translation error will degrade patch alignment accuracy.

- **Set IMU noise and bias parameters.** The IEKF propagation quality is directly determined by the IMU noise density and bias instability parameters in the config YAML. Use manufacturer datasheet values as a starting point and refine by running static initialization.

- **Configure camera intrinsics and distortion accurately.** The affine warp (`A_r^i`) depends on the projection matrix `P`. Incorrect intrinsics will cause systematic patch misalignment across the image frame.

- **Monitor per-frame residual statistics.** LiDAR residual mean and visual photometric residual mean are the primary health indicators. A rising LiDAR residual indicates LiDAR degeneracy or map inconsistency. A rising visual residual indicates lighting change, calibration drift, or dynamic-object contamination of patches.

- **Mask dynamic objects upstream.** Aircraft, GSE, and moving vehicles will corrupt voxel map patches if they appear in multiple frames at different positions. Consider running a motion-segmentation filter on the camera images before patch update, or using [ERASOR](./erasor.md) on the accumulated point cloud for post-hoc map cleaning.

- **Loop closure is not included.** For survey drives longer than ~500 m, pair FAST-LIVO2 with a pose-graph backend. Connect [Scan Context](./scan-context-family.md) or a [learned place recognition](./learned-lidar-place-recognition.md) module to detect revisited locations and add loop-closure constraints to a GTSAM or g2o factor graph.

- **ROS 1 / ROS 2 migration.** The reference implementation is ROS 1 (catkin). For ROS 2 AV stacks, use a bridge node or a community ROS 2 port. Confirm message timestamp alignment when bridging.

- **GPLv2 licensing.** Review before product integration; commercial licensing available from HKU MaRS.

---

## Sources

- Zheng et al., "FAST-LIVO2: Fast, Direct LiDAR-Inertial-Visual Odometry." IEEE T-RO 2025, DOI: 10.1109/TRO.2024.3502198. arXiv: https://arxiv.org/abs/2408.14035
- FAST-LIVO2 arXiv HTML (full paper): https://arxiv.org/html/2408.14035v2
- Zheng et al., "FAST-LIVO: Fast and Tightly-coupled Sparse-Direct LiDAR-Inertial-Visual Odometry." IROS 2022. arXiv: https://arxiv.org/abs/2203.00893
- Xu et al., "FAST-LIO2: Fast Direct LiDAR-Inertial Odometry." IEEE T-RO 2022 vol 38(4). arXiv: https://arxiv.org/abs/2107.06829
- Xu and Zhang, "FAST-LIO: A Fast, Robust LiDAR-Inertial Odometry Package." IEEE RA-L 2021. arXiv: https://arxiv.org/pdf/2010.08196
- He et al., "IKFoM: Iterated Kalman Filters on Manifolds." arXiv: https://arxiv.org/abs/2102.03804
- Cai et al., "ikd-Tree: An Incremental K-D Tree for Robotic Applications." arXiv: https://arxiv.org/abs/2102.10808
- Resource-constrained FAST-LIVO2 variant. arXiv: https://arxiv.org/abs/2501.13876
- FAST-LIVO2 IEEE T-RO DOI: https://ieeexplore.ieee.org/document/9697912/
- GitHub hku-mars/FAST-LIVO2: https://github.com/hku-mars/FAST-LIVO2
- GitHub hku-mars/FAST-LIVO: https://github.com/hku-mars/FAST-LIVO
- GitHub hku-mars/FAST_LIO: https://github.com/hku-mars/FAST_LIO
- GitHub hku-mars/ikd-Tree: https://github.com/hku-mars/ikd-Tree
- GitHub hku-mars/IKFoM: https://github.com/hku-mars/IKFoM
- GitHub xuankuzcr/LIV_handhold: https://github.com/xuankuzcr/LIV_handhold
- MARS-LVIG dataset paper (IJRR 2024): https://journals.sagepub.com/doi/abs/10.1177/02783649241227968
- MARS-LVIG IJRR preprint: https://lawrence-cn.github.io/files/IJRR-LVIG.pdf
- MARS-LVIG dataset download: https://mars.hku.hk/dataset.html
- NTU-VIRAL dataset: https://ntu-aris.github.io/ntu_viral_dataset/
- Hilti SLAM Challenge 2021: https://arxiv.org/abs/2109.11316
- R3LIVE++ arXiv: https://arxiv.org/pdf/2209.03666
- FAST-Calib (LiDAR-camera calibration): https://github.com/hku-mars/FAST-Calib
