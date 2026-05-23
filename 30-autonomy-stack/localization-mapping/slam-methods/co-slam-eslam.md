# Co-SLAM and ESLAM

<!-- method-priority:start
priority:
  learning: 4
  deployment: 3
  type: "method-family"
  stage: "modern-core"
  maturity: "fielded-pattern"
  tags: ["slam", "fallback", "gnss-denied", "indoor", "validation"]
  reason: "Co-SLAM and ESLAM are the canonical CVPR 2023 neural-implicit RGB-D SLAM pair; understanding both is prerequisite for evaluating all post-2023 dense SLAM papers."
method-priority:end -->

Related docs: [NeRF-SLAM family overview](./nerf-slam.md) · [iMAP](./imap.md) · [NICE-SLAM](./nice-slam.md) · [Splat-SLAM](./splat-slam.md) · [GS-SLAM and MonoGS](./gs-slam-monogs.md) · [MASt3R-SLAM](./mast3r-slam.md) · [4DNDF](./4dndf.md) · [KISS-SLAM](./kiss-slam.md) · [GigaSLAM](./gigaslam.md) · [DROID-SLAM](./droid-slam.md) · [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md) · [Volume Rendering, Radiance Fields, and Gaussian Splatting](../../../10-knowledge-base/geometry-3d/volume-rendering-radiance-fields-gaussian-splatting.md) · [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md)

**Last updated:** 2026-05-24

---

## What It Is

Co-SLAM and ESLAM are a **paired generation** of dense neural-implicit RGB-D SLAM systems, both published at CVPR 2023. They represent parallel architectural responses to [NICE-SLAM](./nice-slam.md)'s core bottlenecks — slow optimization (~1 Hz overall), dense pre-allocated cubic memory (17.4 M params on Replica), and dependency on pre-trained ConvONet decoders — and together mark the point at which the neural-implicit SLAM family crossed the ~5 Hz usability threshold.

**Co-SLAM** (Wang, Wang, Agapito; UCL; CVPR 2023; arXiv:2304.14377) introduces a **joint coordinate and sparse parametric encoding**: a multi-resolution hash grid (Instant-NGP style) concatenated with a one-blob coordinate encoding feeds two shallow SDF/RGB MLPs. Global bundle adjustment over all keyframes runs at ~10 Hz — the fastest mapping rate in the CVPR 2023 class. The name reflects the **co-use** of coordinate and parametric encodings, not multi-agent collaboration.

**ESLAM** (Johari, Carta, Fleuret; Idiap/EPFL; CVPR 2023 Highlight; arXiv:2211.11704) introduces a **tri-plane 2D feature representation**: three axis-aligned feature planes (XY, XZ, YZ) replace NICE-SLAM's 3D dense grids, cutting memory from O(L³) to O(L²) in scene side-length. Two-scale TSDF and color decoders run at ~5 Hz overall, achieving the best depth reconstruction accuracy in the CVPR 2023 class.

**Honest framing up front:** Neither system implements loop closure. Both are RGB-D only. Both are inappropriate as the primary SLAM pipeline for any outdoor LiDAR-first context. They are valuable as research baselines, as illustrations of distinct representation design philosophies, and as required reading for any literature review covering 2023–2025 dense SLAM.

---

## Historical Context

The neural-implicit SLAM lineage opened with [iMAP](./imap.md) (Sucar et al., ICCV 2021, arXiv:2103.12352), which proved a single global MLP could serve as the sole map in a SLAM loop — but it suffered catastrophic forgetting and could not represent high-frequency surface detail. [NICE-SLAM](./nice-slam.md) (Zhu et al., CVPR 2022, arXiv:2112.12130) replaced the global MLP with four hierarchical dense 3D feature grids plus ConvONet-pretrained decoders, achieving a 3.8× ATE improvement over iMAP* on ScanNet. However NICE-SLAM's dense grids introduced cubic memory scaling, slow optimization, and pre-training dependency.

Co-SLAM and ESLAM both appeared at CVPR 2023 targeting those bottlenecks from complementary directions. Neither builds on the other. Both were superseded on quality metrics at ICCV 2023 by Point-SLAM (neural point cloud, best PSNR) and GO-SLAM (loop closure, best ATE), and on all metrics by Loopy-SLAM (CVPR 2024, arXiv:2402.09944). After CVPR 2024 the field pivoted largely to 3DGS-SLAM. See [Splat-SLAM](./splat-slam.md) (iter 18) and [GS-SLAM and MonoGS](./gs-slam-monogs.md) (iter 26) for the 3DGS continuation.

---

## Part A — Co-SLAM

### A.1 Citation and Provenance

Hengyi Wang, Jingwen Wang, Lourdes Agapito. "Co-SLAM: Joint Coordinate and Sparse Parametric Encodings for Neural Real-Time SLAM." CVPR 2023, pp. 13293–13302. arXiv:2304.14377. Affiliation: UCL.

Code: https://github.com/HengyiWang/Co-SLAM (Apache-2.0) · Project: https://hengyiwang.github.io/projects/CoSLAM

---

### A.2 Mechanism — Joint Encoding

For a 3D point `x = (x, y, z)`, Co-SLAM concatenates two independent encodings before feeding two shallow MLPs:

```
f(x) = f_hash(x) || f_blob(x)

MLP_geo : f(x) --> SDF value s(x)     [geometry decoder]
MLP_rgb : f(x) --> RGB color c(x)     [appearance decoder]
```

**Branch 1 — Multi-resolution hash grid (parametric encoding):** Follows Instant-NGP (Muller et al., ACM ToG 2022). L resolution levels (typically 16) from coarse (~16³) to fine (~512³). At each level, the 8 surrounding voxel corners are hashed to a trainable table (T = 2^19 entries, 2-dim each) and trilinearly interpolated. Provides fast convergence (direct backprop to table entries), high-frequency local detail, and sparse memory fixed at T entries regardless of scene size.

**Branch 2 — One-blob encoding (coordinate encoding):** A frequency-based positional encoding using a localized blob kernel — a smoothness prior. Nearby points receive similar features, encouraging surface completion in unobserved regions and global coherence across the scene. This is the key hole-filling mechanism absent from NICE-SLAM's grid-only approach.

**SDF and volume rendering:** SDF output `s(x)` (positive outside surface, negative inside) converts to opacity via a logistic sigmoid, following VolSDF/NeuS:

```
sigma(x) = sigmoid( -s(x) / beta )

D_hat(r) = sum_i  T_i * alpha_i * t_i     [rendered depth]
C_hat(r) = sum_i  T_i * alpha_i * c_i     [rendered color]
```

For volume rendering foundations see [Volume Rendering, Radiance Fields, and Gaussian Splatting](../../../10-knowledge-base/geometry-3d/volume-rendering-radiance-fields-gaussian-splatting.md).

---

### A.3 Tracking and Mapping Pipeline

**Tracking (~17 Hz on Replica):** All network weights frozen; pose `T_t in SE(3)` optimized by gradient descent on a render-and-compare loss. Depth-guided ray sampling biases toward depth-supervised pixels:

```
L_track = sum_{r} [  lambda_rgb * | C_hat(r) - C_gt(r) |^2
                    + lambda_d   * | D_hat(r) - D_gt(r) |^2  ]
```

For SE(3) pose Jacobians see [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md).

**Mapping (~10 Hz on Replica) — Global BA:** Co-SLAM's most distinctive choice. NICE-SLAM and ESLAM both maintain a sliding window of active keyframes. Co-SLAM instead runs global bundle adjustment over **all** keyframes simultaneously, leveraging the fast hash-grid convergence to make this tractable:

```
L_map = sum_{k in ALL_keyframes} sum_{r} [  lambda_rgb * L_rgb(r)
                                           + lambda_d   * L_depth(r)
                                           + lambda_sdf * L_sdf(r)
                                           + lambda_fs  * L_freespace(r)  ]
```

Hash-grid parameters and all keyframe poses are optimized jointly. This eliminates the windowing-forgetting artifact: when the robot revisits an area, old keyframes remain in the BA and the previously observed region does not drift.

**Architecture summary:**

```
RGB-D input (per frame)
     |
     v
Tracking thread  (~17 Hz Replica / 12.82 Hz ScanNet)
  |-- Depth-guided ray sampling, current frame
  |-- Hash grid --> f_hash(x)  |  One-blob --> f_blob(x)
  |-- MLP_geo --> SDF --> render D_hat(r)
  |-- MLP_rgb --> c(x) --> render C_hat(r)
  `-- Gradient descent on pose T_t  [weights frozen]
     |
     v
Keyframe selection (translation/rotation threshold)
     |
     v
Mapping thread  (~10.20 Hz Replica / 4.95 Hz ScanNet)
  |-- Sample rays from ALL keyframes (depth-guided)
  `-- Joint optimize: hash-grid params + ALL keyframe poses
     |
     v
Output: SDF mesh (marching cubes) + trajectory

Params: 0.26 M (Replica)  |  0.8 M (ScanNet)
```

---

### A.4 Strengths and Weaknesses — Co-SLAM

**Strengths:** Fastest mapping rate in the CVPR 2023 neural-implicit SLAM class (~10 Hz Replica). Lowest parameter count (0.26 M Replica — 35× fewer than ESLAM). Global BA eliminates windowing forgetting. One-blob encoding provides hole-filling in sparse or unobserved regions. No pre-training required.

**Weaknesses:** Depth L1 on Replica (1.51 cm) is worse than ESLAM (0.94 cm). ATE on ScanNet (9.37 cm) is worse than ESLAM (7.42 cm) — real-scene drift not resolved by global BA without loop closure. PSNR (~27.0 dB) well below point-cloud methods. No loop closure — long-trajectory drift accumulates. RGB-D only. Static world assumption — moving objects corrupt the map. Large scenes: hash collision artifacts grow and global BA becomes expensive as keyframe count scales without bound.

---

## Part B — ESLAM

### B.1 Citation and Provenance

Mohammad Mahdi Johari, Camilla Carta, Francois Fleuret. "ESLAM: Efficient Dense SLAM System Based on Hybrid Representation of Signed Distance Fields." CVPR 2023 **Highlight**, pp. 17408–17419. arXiv:2211.11704. Affiliation: Idiap Research Institute, EPFL.

Code: https://github.com/idiap/ESLAM (Apache-2.0) · Project: https://www.idiap.ch/paper/eslam/

---

### B.2 Mechanism — Tri-Plane Feature Representation

NICE-SLAM's dense 3D feature grids scale as O(L³) — a 10× larger scene costs 1000× more memory. ESLAM replaces them with **three axis-aligned 2D feature planes** (XY, XZ, YZ), which scale as O(L²): a 10× larger scene costs only 100× more memory.

**Tri-plane lookup formula:**

```
f(x, y, z) = BilinearInterp(P_XY, x, y)
           + BilinearInterp(P_XZ, x, z)
           + BilinearInterp(P_YZ, y, z)
```

Summation (not concatenation, unlike EG3D's original tri-plane) keeps the feature dimension constant and reduces decoder input size. Each plane stores 32-channel feature vectors per pixel.

**Multi-scale planes:** Two resolution scales (coarse and fine) for both geometry and appearance give 12 feature planes total (2 scales × 3 planes × 2 modalities). Coarse geometry: 24 cm voxel resolution; fine geometry: 6 cm; fine appearance: 3 cm. Coarse and fine geometry features are concatenated to form a 64-dim geometry feature; same for appearance:

```
f_geo(x) = [ f_geo_coarse(x) || f_geo_fine(x) ]   [64-dim]
f_col(x) = [ f_col_coarse(x) || f_col_fine(x) ]   [64-dim]
```

**TSDF and color decoders:** Two shallow two-layer MLPs (32 hidden units):

```
MLP_geo : f_geo(x) --> TSDF value s(x)
MLP_col : f_col(x) --> RGB color c(x)
```

TSDF clamps values to `[-delta, +delta]` (e.g., delta = 0.1 m). Points within the truncation band receive strong SDF supervision; far-field points are excluded — accelerating convergence compared to NICE-SLAM's per-point occupancy loss.

---

### B.3 Tracking and Mapping Pipeline

**Tracking (~18 Hz on Replica):** All 12 feature planes frozen; pose optimized on render-and-compare:

```
L_track = sum_{r} [  lambda_d   * | D_hat(r) - D_gt(r) |
                    + lambda_rgb * | C_hat(r) - C_gt(r) |  ]
```

**Mapping (~3.62 Hz Replica / 1.49 Hz ScanNet) — Sliding window:** Unlike Co-SLAM, ESLAM maintains a **sliding window** of active keyframes — no global BA, no loop closure. Feature planes and active keyframe poses are jointly optimized:

```
L_map = L_depth + lambda_rgb * L_rgb + lambda_free * L_freespace + lambda_sdf * L_sdf
```

The absence of loop closure is an explicit limitation noted by Loopy-SLAM as the core gap motivating its design.

**Architecture summary:**

```
RGB-D input (per frame)
     |
     v
Tracking thread  (~18 Hz Replica / 4.54 Hz ScanNet)
  |-- Project samples onto 12 planes --> bilinear interpolation
  |-- MLP_geo --> TSDF --> render D_hat(r)
  |-- MLP_col --> c(x) --> render C_hat(r)
  `-- Gradient descent on pose T_t  [planes frozen]
     |
     v
Keyframe selection (overlap threshold)
     |
     v
Mapping thread  (~3.62 Hz Replica / 1.49 Hz ScanNet)
  |-- Sample rays from active WINDOW  [not global BA]
  `-- Joint optimize: 12 feature planes + keyframe poses (window only)
     |
     v
Output: TSDF mesh (marching cubes) + trajectory

Params: 9.29 M (Replica)  |  10.5 M (ScanNet)
Memory: O(L^2) in scene side-length L
```

---

### B.4 Strengths and Weaknesses — ESLAM

**Strengths:** CVPR 2023 Highlight designation. Best depth L1 (0.94 cm) and completion ratio (96.46%) in the CVPR 2023 class. Best ATE on ScanNet (7.42 cm) among CVPR 2023 class — better than NICE-SLAM and Co-SLAM. Memory grows quadratically not cubically — enables room-to-apartment scale. No pre-training required. TSDF accelerates convergence over occupancy.

**Weaknesses (do not soften):** **No loop closure** — sliding-window keyframe management only; drift accumulates over long trajectories. Mapping FPS (3.62 Hz Replica, 1.49 Hz ScanNet) substantially slower than Co-SLAM. Parameters (9.29–10.5 M) are 10–40× larger than Co-SLAM. PSNR (~27.8 dB) far below point-cloud methods (Point-SLAM 35.17 dB). RGB-D only. Static world assumption. Quadratic memory growth still problematic at building or campus scale. Feature planes have spatially uniform density — no adaptive resolution at surfaces.

---

## Head-to-Head Comparison

| Dimension | Co-SLAM | ESLAM |
|---|---|---|
| Core innovation | Hash-grid + one-blob joint encoding | Tri-plane 2D feature planes (replace 3D grids) |
| Memory scaling | O(T) sparse hash table — fixed regardless of scene | O(L²) quadratic in scene side-length |
| Params (Replica / ScanNet) | **0.26 M / 0.8 M** | 9.29 M / 10.5 M |
| Depth L1 — Replica (cm) | 1.51 | **0.94** |
| Completion ratio — Replica | 93.44% | **96.46%** |
| ATE — Replica avg (cm) | 0.70 | 0.70 |
| ATE — ScanNet avg (cm) | 9.37 | **7.42** |
| PSNR — Replica (dB) | 27.0 | **27.8** |
| Track FPS — Replica | 17.24 Hz | **18.11 Hz** |
| Map FPS — Replica | **10.20 Hz** | 3.62 Hz |
| Overall FPS | **~10–12 Hz** | ~5–6 Hz |
| Keyframe strategy | **Global BA — all keyframes** | Sliding window only |
| Loop closure | No | **No** |
| Hole-filling | Strong (one-blob smoothness prior) | Weak |
| Pre-training | None | None |
| Status | CVPR 2023 | CVPR 2023 **Highlight** |

**Verdict:** ESLAM wins on reconstruction quality (depth L1, completion ratio) and real-scene ATE (ScanNet). Co-SLAM wins on mapping speed (~3× faster mapping) and parameter efficiency (35× fewer params). For applications where update rate matters, Co-SLAM's ~10 Hz is more practical. For offline high-quality map construction, ESLAM's denser reconstruction is preferred. Both are surpassed on all quality metrics by Point-SLAM (ICCV 2023) and Loopy-SLAM (CVPR 2024).

---

## Benchmark Tables

All numbers from the Neural SLAM Evaluation Benchmark (`JingwenWang95/neural_slam_eval`), cross-checked against SLAIM (arXiv:2404.11419) and EC-SLAM (arXiv:2404.13346). PSNR from the Loopy-SLAM comparison table (arXiv:2402.09944).

**Replica dataset (8 synthetic indoor scenes):**

| Method | Acc (cm) | Compl (cm) | Compl Ratio (%) | Depth L1 (cm) | Track FPS | Map FPS | Params |
|---|---|---|---|---|---|---|---|
| iMAP* | 3.62 | 4.93 | 80.51 | 4.64 | 9.92 | 2.23 | 0.26 M |
| NICE-SLAM | 2.37 | 2.64 | 91.13 | 1.90 | 13.70 | 0.20 | 17.4 M |
| Vox-Fusion | 1.88 | 2.56 | 90.93 | 2.91 | 2.11 | 2.17 | 0.87 M |
| ESLAM | 2.18 | **1.75** | **96.46** | **0.94** | **18.11** | 3.62 | 9.29 M |
| Co-SLAM | **2.10** | 2.08 | 93.44 | 1.51 | 17.24 | **10.20** | **0.26 M** |

ATE RMSE Replica average: Co-SLAM ~0.70 cm; ESLAM ~0.70 cm — essentially tied. PSNR: Co-SLAM ~27.0 dB; ESLAM ~27.8 dB. Both well below Point-SLAM (35.17 dB) and Loopy-SLAM (35.47 dB).

**ScanNet dataset (6 real indoor scenes):**

| Method | Avg ATE (cm) | Track FPS | Map FPS | Params |
|---|---|---|---|---|
| iMAP* | 36.67 | 0.66 | 0.07 | 0.2 M |
| NICE-SLAM | 9.63 | 1.63 | 0.13 | 10.3 M |
| Vox-Fusion | 8.22 | 1.13 | 0.78 | 1.1 M |
| ESLAM | **7.42** | 4.54 | 1.49 | 10.5 M |
| Co-SLAM | 9.37 | **12.82** | **4.95** | **0.8 M** |

**TUM RGB-D (ATE RMSE, cm):**

| Method | fr1/desk | fr2/xyz | fr3/office |
|---|---|---|---|
| NICE-SLAM | 2.7 | 1.8 | 3.0 |
| Co-SLAM | 2.4 | 1.7 | 2.4 |
| ESLAM | 2.5 | **1.1** | 2.4 |

---

## Operator Mechanics — Side-by-Side

**Co-SLAM encoding (hash-grid + one-blob):**

```
f(x) = f_hash(x) || f_blob(x)
     = [multi-res hash lookup + trilinear interp]
    || [one-blob coordinate encoding — smoothness prior]

--> MLP_geo --> SDF s(x) --> sigma(x) = sigmoid(-s(x)/beta)
--> MLP_rgb --> color c(x)
```

**ESLAM tri-plane lookup:**

```
f(x, y, z) = BilinearInterp(P_XY, x, y)    [floor-plan projection]
           + BilinearInterp(P_XZ, x, z)    [front-elevation projection]
           + BilinearInterp(P_YZ, y, z)    [side-elevation projection]

f_geo = [f_geo_coarse || f_geo_fine]  --> MLP_geo --> TSDF s(x)
f_col = [f_col_coarse || f_col_fine]  --> MLP_col --> color c(x)
```

**Shared tracking loss (pose `T_t in SE(3)`, map frozen):**

```
L_track = sum_r [ lambda_d * loss_depth(D_hat, D_gt) + lambda_rgb * loss_color(C_hat, C_gt) ]
```

**Shared mapping loss (map params + keyframe poses, current pose fixed):**

```
L_map = L_depth + lambda_rgb * L_rgb + lambda_sdf * L_sdf + lambda_fs * L_freespace
```

Both minimize tracking loss over `T_t in SE(3)` with map parameters frozen, then mapping loss over map parameters with pose fixed — the standard alternating-optimization SLAM pattern. SE(3) pose Jacobians: [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md). Volume rendering integral: [Volume Rendering, Radiance Fields, and Gaussian Splatting](../../../10-knowledge-base/geometry-3d/volume-rendering-radiance-fields-gaussian-splatting.md).

---

## Lineage — Neural Implicit SLAM Family

```
iMAP  (ICCV 2021, arXiv:2103.12352)
  Single global MLP. Catastrophic forgetting. Tiny scenes only.

NICE-SLAM  (CVPR 2022, arXiv:2112.12130)        [see nice-slam.md]
  Hierarchical dense 3D feature grids + pretrained decoders.
  ~1 Hz overall; 17.4 M params; memory O(L^3).

Vox-Fusion  (ISMAR 2022, arXiv:2210.15858)
  Sparse octree + dynamic voxel allocation; SDF.

ESLAM  (CVPR 2023 Highlight, arXiv:2211.11704)  <-- Part B this page
  Tri-plane 2D feature planes; memory O(L^2); no pretrain.
  Best depth L1 and ScanNet ATE in CVPR 2023 class. No loop closure.

Co-SLAM  (CVPR 2023, arXiv:2304.14377)          <-- Part A this page
  Hash grid + one-blob joint encoding; global BA; ~10 Hz.
  Fastest mapper in CVPR 2023 class. No loop closure.

Point-SLAM  (ICCV 2023, arXiv:2304.04278)
  Neural point cloud; adaptive density; best PSNR (35.17 dB).

GO-SLAM  (ICCV 2023, arXiv:2309.02436)
  DROID-SLAM tracking + Instant-NGP + loop closure; best ATE (0.35 cm).

Loopy-SLAM  (CVPR 2024, arXiv:2402.09944)
  Point-SLAM representation + sub-map loop closure. Apex of NeRF-SLAM.
  ATE 0.29 cm, depth L1 0.35 cm, PSNR 35.47 dB.

  --> FIELD PIVOTS TO 3DGS-SLAM (CVPR 2024) <--

SplaTAM / GS-SLAM / MonoGS  (CVPR 2024)         [see splat-slam.md, gs-slam-monogs.md]
  3D Gaussian Splatting. 100+ FPS rendering; SLAM loop 0.3-0.5 FPS.
```

---

## Shared Failure Modes

Both systems share all failure modes inherent to the neural-implicit RGB-D SLAM paradigm:

1. **RGB-D required.** No LiDAR consumption. Consumer depth sensors (RealSense, Azure Kinect) have limited range (~6–8 m), high noise, fail in direct sunlight and on reflective surfaces.
2. **Static world assumption.** Moving objects (vehicles, people, airport GSE) corrupt the map — ghost surfaces appear, tracking can diverge. No native moving-object segmentation.
3. **Small-scale indoor only in practice.** Benchmarks are single rooms (Replica ~50 m²) or small buildings (ScanNet ~200 m²). Large outdoor environments untested.
4. **No loop closure in either system.** Long-trajectory drift accumulates without correction. Revisiting areas does not correct drift.
5. **GPU-intensive.** RTX 2080 or better required for real-time operation. Not deployable on edge compute without significant quantization or pruning.
6. **Textureless surfaces.** The photometric loss `L_rgb` provides no gradient on uniform walls, ceilings, or concrete floors. Tracking becomes unreliable; shape is lost in these regions.
7. **Fast motion or motion blur.** Render-and-compare tracking assumes accurate rendering from the previous pose. Large frame-to-frame motion breaks this.
8. **Outdoor and unlit scenes.** IR-based depth sensors fail in outdoor sunlight. Neither has been demonstrated outdoors.
9. **Rendering quality ceiling.** Both achieve ~27–28 dB PSNR on Replica — well below Point-SLAM and Loopy-SLAM at ~35 dB.

---

## Domain Fit

| Domain | Fit | Key Notes |
|---|---|---|
| Indoor rooms / labs | Good (research) | Standard benchmark setting — Replica, TUM, ScanNet |
| Building-scale indoor | Conditional | No loop closure limits long trajectories; use GO-SLAM or Loopy-SLAM |
| Airside hangar / terminal (offline appearance) | Conditional | Offline appearance digital twin only; needs LiDAR primary pose source; reflective aircraft surfaces degrade performance |
| Airside apron (primary SLAM) | Not suitable | Outdoor, dynamic GSE, no LiDAR, range limits, no loop closure |
| Road AV (offline appearance layer) | Research | Superseded by offline 3DGS reconstruction (higher PSNR, simpler pipeline) |
| Road AV (online primary localization) | Not suitable | Not real-time enough; no LiDAR; not safety-critical ready |
| Warehouse / port (short-range indoor, static) | Conditional | Viable in textured static areas; dynamic equipment requires masking |
| Agriculture / construction | Not suitable | Outdoor scale, weather, dynamic machinery, vegetation |
| Simulation asset generation (indoor) | Good (research) | View synthesis and digital twin from controlled RGB-D captures |

---

## Aggregated-Map Suitability — Honest Assessment

**Neither Co-SLAM nor ESLAM is a LiDAR-primary SLAM system.** They are RGB-D SLAM systems. In an airside AV context — tarmac, taxiway, apron, stand — where LiDAR is the primary sensing modality, scenes are outdoor and large-scale (hundreds of meters), moving objects are ubiquitous, and lighting spans full sunlight to night, both systems are **inappropriate as the primary SLAM pipeline**. Their failure modes map directly onto airside operating conditions.

**Potential role — offline appearance layer only.** After LiDAR SLAM produces a registered point cloud, cameras provide RGB texture for visual lane markings, stand signage, and gate labels. This is better served by offline NeRF (nerfstudio, Instant-NGP) or 3DGS reconstruction — no real-time constraint, higher quality.

**LiDAR-native counterparts (use these for airside primary SLAM):**

- **PIN-SLAM** (TRO 2024, arXiv:2401.09101, PRBonn/PIN\_SLAM) — LiDAR neural implicit SLAM, point-based SDF, loop closure, outdoor-capable.
- **4DNDF** ([4dndf.md](./4dndf.md), iter 32) — neural distance field for LiDAR mapping.
- **KISS-SLAM** ([kiss-slam.md](./kiss-slam.md), iter 32) — classical LiDAR SLAM, production-ready.

**3DGS-SLAM has superseded the NeRF-SLAM family for appearance work.** SplaTAM, GS-SLAM, and MonoGS (all CVPR 2024) offer faster rendering and 7–8 dB higher PSNR. If a visual dense-map layer is needed alongside LiDAR, offline 3DGS reconstruction is now preferred over Co-SLAM or ESLAM. See [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md) (iter 16).

**Retain knowledge of both because:** (1) they appear in comparison tables in all downstream papers (GO-SLAM, Loopy-SLAM, SplaTAM, EC-SLAM, LRSLAM); (2) they represent distinct valid design philosophies that recur in later systems — hash-grid plus coordinate encoding (Co-SLAM), tri-plane factorization (ESLAM); (3) the tri-plane concept from ESLAM is directly relevant to 3DGS scene representation research; (4) Co-SLAM's global BA strategy is referenced and extended in EC-SLAM (arXiv:2404.13346).

For downstream use of any dense appearance map in the AV pipeline see [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md).

---

## Implementation Notes

**Co-SLAM (`HengyiWang/Co-SLAM`, Apache-2.0):** Includes configs and scripts for Replica, ScanNet, TUM RGB-D. Hash table allocates on demand — no scene bounding box required in advance (unlike NICE-SLAM). Global BA keyframe count grows without bound; monitor memory and optimization time on long sequences. Neural SLAM Evaluation Benchmark (`JingwenWang95/neural_slam_eval`) provides standardized comparison against iMAP*, NICE-SLAM, Vox-Fusion, ESLAM, and Co-SLAM.

**ESLAM (`idiap/ESLAM`, Apache-2.0):** Includes configs, visualization, ATE evaluation, and reconstruction scripts. Higher VRAM requirement than Co-SLAM (12 feature planes at 9.29 M params). LRSLAM (arXiv:2506.10567) demonstrates 87–90% parameter reduction via low-rank decomposition — consider applying for constrained deployments. No loop closure built in; for long-trajectory mapping use GO-SLAM or Loopy-SLAM instead.

**Shared recommendations for both:** Mask dynamic objects before mapping — no native motion segmentation. Use independent pose sources for navigation; treat Co-SLAM or ESLAM output as map or inspection layer only, not a safety-critical pose backbone. Validate neural map geometry against raw depth or LiDAR before any operational claim. RTX 2080 or better required for real-time performance.

---

## Sources

| Resource | URL |
|---|---|
| Co-SLAM arXiv | https://arxiv.org/abs/2304.14377 |
| Co-SLAM CVPR open access | https://openaccess.thecvf.com/content/CVPR2023/html/Wang_Co-SLAM_Joint_Coordinate_and_Sparse_Parametric_Encodings_for_Neural_Real-Time_CVPR_2023_paper.html |
| Co-SLAM GitHub | https://github.com/HengyiWang/Co-SLAM |
| Co-SLAM project page | https://hengyiwang.github.io/projects/CoSLAM |
| ESLAM arXiv | https://arxiv.org/abs/2211.11704 |
| ESLAM CVPR open access | https://openaccess.thecvf.com/content/CVPR2023/html/Johari_ESLAM_Efficient_Dense_SLAM_System_Based_on_Hybrid_Representation_of_CVPR_2023_paper.html |
| ESLAM project page | https://www.idiap.ch/paper/eslam/ |
| ESLAM GitHub | https://github.com/idiap/ESLAM |
| Neural SLAM Eval Benchmark | https://github.com/JingwenWang95/neural_slam_eval |
| SLAIM (comparison) | https://arxiv.org/abs/2404.11419 |
| EC-SLAM (Co-SLAM extension) | https://arxiv.org/abs/2404.13346 |
| LRSLAM (ESLAM compression successor) | https://arxiv.org/html/2506.10567 |
| Loopy-SLAM (apex + comparison) | https://arxiv.org/abs/2402.09944 |
| Loopy-SLAM GitHub | https://github.com/eriksandstroem/Loopy-SLAM |
| NeRFs and 3DGS in SLAM survey | https://arxiv.org/abs/2402.13255 |
| PIN-SLAM (LiDAR-primary) | https://arxiv.org/abs/2401.09101 |
| Instant-NGP (hash grid basis) | https://nvlabs.github.io/instant-ngp/ |
| EG3D (tri-plane inspiration) | https://nvlabs.github.io/eg3d/ |

- Local context: [NeRF-SLAM family overview](./nerf-slam.md) — iter 27; full neural-implicit-SLAM lineage with per-method summaries
- Local context: [iMAP](./imap.md) — single-MLP predecessor
- Local context: [NICE-SLAM](./nice-slam.md) — iter 33; hierarchical feature-grid predecessor; the direct target of both methods
- Local context: [Splat-SLAM](./splat-slam.md) — iter 18; 3DGS-SLAM with loop closure; largely supersedes this family for appearance-layer use
- Local context: [GS-SLAM and MonoGS](./gs-slam-monogs.md) — iter 26; first-wave 3DGS-SLAM at CVPR 2024
- Local context: [MASt3R-SLAM](./mast3r-slam.md) — iter 24; feed-forward SLAM successor direction
- Local context: [4DNDF](./4dndf.md) — iter 32; 4D neural distance field for LiDAR-primary neural mapping
- Local context: [KISS-SLAM](./kiss-slam.md) — iter 32; LiDAR-primary production odometry counterpart
- Local context: [GigaSLAM](./gigaslam.md) — iter 29; large-scale neural implicit SLAM successor direction
- Local context: [DROID-SLAM](./droid-slam.md) — iter 25; learned optical-flow SLAM that feeds GO-SLAM's tracking front-end
- Local context: [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) — downstream use of appearance map layers
- Local context: [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md) — iter 16; 3DGS first principles and offline reconstruction
- Local context: [Volume Rendering, Radiance Fields, and Gaussian Splatting](../../../10-knowledge-base/geometry-3d/volume-rendering-radiance-fields-gaussian-splatting.md) — NeRF and volume rendering background
- Local context: [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) — iter 14; SE(3) pose Jacobian math underlying the tracking optimization
