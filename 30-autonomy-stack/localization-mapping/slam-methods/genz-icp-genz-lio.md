# GenZ-ICP and GenZ-LIO

<!-- method-priority:start
priority:
  learning: 5
  deployment: 4
  type: "method-family"
  stage: "foundation"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "runtime-localization", "validation"]
  reason: "GenZ-ICP and GenZ-LIO is rated for foundational SLAM modeling, optimization, registration, or mapping concepts."
method-priority:end -->

Related method pages: [ICP](icp.md), [Point-to-Plane ICP](point-to-plane-icp.md), [KISS-ICP](./kiss-icp.md) (iter 20), [FAST-LIO and FAST-LIO2](./fast-lio-fast-lio2.md) (iter 22), [KISS-SLAM](./kiss-slam.md) (iter 32), [CT-ICP](./ct-icp.md), [Continuous-Time Registration](./continuous-time-registration.md) (iter 36), [Loop Closure and Place Recognition](./loop-closure-place-recognition.md) (iter 28), [MOLA](./mola.md), [GEODE Degenerate LiDAR Benchmark](./geode-degenerate-lidar-benchmark.md), [HERCULES Radar Benchmark](./hercules-radar-benchmark.md).

Related overview pages: [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [Production LiDAR-to-Map Localization](../overview/production-lidar-map-localization.md).

Related KB pages: [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md), [Multi-Sensor Calibration and Observability](../../../10-knowledge-base/geometry-3d/multi-sensor-calibration-observability.md) (iter 15), [Lie Groups SE(3)/SO(3) and Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) (iter 14).

**Last updated:** 2026-05-24

---

## What It Is

**GenZ-ICP** — "Generalizable and Degeneracy-Robust LiDAR Odometry Using an Adaptive Weighting" — is a LiDAR-only odometry (LO) method from **Daehan Lee, Hyungtae Lim, and Soohee Han** at the **Computational Control Engineering Laboratory (CoCEL), POSTECH, South Korea** (Lim also affiliated with LIDS, MIT at the time of submission). Published in *IEEE Robotics and Automation Letters* (RA-L) vol. 10, no. 1, pp. 152–159, 2025 (DOI: 10.1109/LRA.2024.3498779; arXiv: 2411.06766; submitted November 2024). Code is open-source at https://github.com/cocel-postech/genz-icp and installable via `pip install genz-icp`.

**GenZ-LIO** — "Generalizable LiDAR-Inertial Odometry Beyond Indoor–Outdoor Boundaries" — is the LIO extension from the same POSTECH CoCEL group (Lee, Lim, Kim, Rho, Lee, Park, Hong, Choi, Jo, Han). Submitted to arXiv March 17, 2026 (arXiv: 2603.16273, 19 pages, 11 figures). **Status: pre-print only at time of writing; not yet confirmed in a peer-reviewed venue. Benchmark numbers for GenZ-LIO should be treated as preliminary and unconfirmed until the paper is published.** Code is promised upon publication; no public repository confirmed.

Both methods address the **degenerate-environment problem**: classical ICP and NDT produce an ill-conditioned pose update when the local geometry constrains only N−1 of N translational degrees of freedom. The canonical example is a long corridor — every wall normal is perpendicular to the corridor axis, so the translational Hessian collapses to rank 2 and drift along the corridor axis is unbounded per frame. GenZ-ICP tackles this via continuous adaptive blending of point-to-plane and point-to-point residuals, requiring no explicit degeneracy detector or mode switch. GenZ-LIO extends the same hybrid residual idea into an Error-State Iterated Kalman Filter (ESIKF) and adds a PD-controlled adaptive voxel sizer for indoor-to-outdoor scale transitions.

GenZ-ICP is LiDAR-only; GenZ-LIO requires a synchronised IMU. Neither system performs loop closure. Both are training-free, geometry-only methods with no learned components.

**Key identifiers:**

| Item | GenZ-ICP | GenZ-LIO |
|---|---|---|
| arXiv | https://arxiv.org/abs/2411.06766 | https://arxiv.org/abs/2603.16273 |
| Venue | IEEE RA-L 2025 | Pre-print (2026) |
| DOI | 10.1109/LRA.2024.3498779 | — |
| Code | https://github.com/cocel-postech/genz-icp | Pending publication |
| PyPI | `pip install genz-icp` | — |

---

## The Degenerate-Environment Problem

### Why ICP Fails in Corridors

ICP solves for the relative pose `T ∈ SE(3)` that minimises a sum of point-correspondence residuals. The normal equations produce a 6×6 information matrix (Hessian):

```
H = Σ_i  J_i^T J_i        [6×6 information matrix]
Δx = H^{-1} b              [6×1 pose update]
```

For this to be well-posed, `H` must be full-rank — the environment must provide geometric constraints in all six degrees of freedom. **Degeneracy occurs when local geometry fails to constrain one or more DoF.**

In a long corridor:

- Left and right walls provide strong lateral (Y) and vertical (Z) constraints.
- Floor and ceiling reinforce Z.
- No points constrain motion along the corridor axis (X): every corridor-wall scan is equally consistent with a translated-along-X version of the map.
- The Hessian's minimum eigenvalue along the corridor axis approaches zero.
- The condition number `κ = λ_max / λ_min` grows without bound.
- Pose drift along the unconstrained axis is unbounded per frame.

This is called **long-axis degeneracy** (also: tunnel degeneracy, corridor degeneracy, 1-DoF translational degeneracy).

### Point-to-Plane vs Point-to-Point Under Degeneracy

Point-to-plane ICP uses surface normals `n_i`. In a corridor all normals point perpendicular to the corridor axis — no normal points along X. The translational Hessian block collapses to rank 2. Published condition numbers (GenZ-ICP paper, Long_Corridor sequence):

```
Point-to-plane ICP:  κ ~ 80–110   (severely ill-conditioned)
KISS-ICP (P2Po):     κ ~ 40       (better, but still drifts)
GenZ-ICP (blended):  κ ~ 15       (well-conditioned)
```

Point-to-point ICP uses the full 3-vector distance between matched points (not the normal projection), so the translational Hessian block stays closer to identity. However, point-to-point is noisier and does not exploit planar geometry in well-structured environments.

**The complementarity insight** (GenZ-ICP's core thesis): neither metric is universally superior. Point-to-plane is better in rich geometry; point-to-point is more robust in degenerate geometry. A method that uses both adaptively outperforms either alone across all environments — and pays essentially zero accuracy penalty in normal scenes.

See [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md) for the full normal-equations derivation.

---

## GenZ-ICP: Core Technical Mechanism

### Step 1: Per-Point Planarity Classification

For each point `p_i` in the incoming scan, GenZ-ICP queries a local neighbourhood and performs PCA. The three eigenvalues `λ_1 ≥ λ_2 ≥ λ_3` characterise local geometry:

```
surface_variation = λ_3 / (λ_1 + λ_2 + λ_3)
```

Low `surface_variation` with sufficient neighbours → point is **planar** (gets a point-to-plane residual with normal `n_i` from PCA). Otherwise → **non-planar** (gets a point-to-point residual). The classification thresholds `τ_planar` and `τ_num` (minimum neighbour count) are the only tunable parameters; the authors provide pre-tuned configs for standard sensor types. Numerical values are not published in the RA-L paper — use the GitHub configs for supported sensors.

### Step 2: Adaptive Blending Weight

Let `N_pl` be the planar point count and `N_po` the non-planar count. The blending weight is:

```
α = N_pl / (N_pl + N_po)
```

This is a **continuous geometric signal** derived directly from the observed scan — not a binary degeneracy-detection gate or mode switch. As planar structure collapses (degenerate geometry), α decreases automatically, increasing the point-to-point contribution.

### Step 3: Blended Hessian and Solver

The combined optimisation objective is:

```
min_{Δx}  || A Δx + b ||^2

A = α · Σ_j J_{pl,j}^T J_{pl,j}  +  (1 - α) · Σ_k J_{po,k}^T J_{po,k}

H = A^T A  =  α · H_pl  +  (1-α) · H_po
```

In corridors, planar wall points classify as planar but their normals are all perpendicular to the corridor axis — `H_pl` becomes rank-deficient in X. The non-planar points contribute a near-identity `H_po` block, raising the minimum eigenvalue of the total `H` and preventing numerical singularity. The pose update is solved via IRLS.

**Degeneracy mitigation is implicit.** GenZ-ICP does not zero any eigenvector or freeze any DoF. The blended `H` is always positive-definite as long as any non-planar points exist.

When the scene is fully structured (α → 1): degrades to standard point-to-plane ICP. When fully degenerate or noisy (α → 0): degrades to point-to-point ICP. In corridors: α is intermediate, the blend is active.

### Observability Metric

For diagnosis and tuning, the paper computes the **condition number of the translational Hessian sub-block**:

```
A_bar = [I_3  0_3] A [I_3; 0_3]    ∈ R^{3×3}
κ(A_bar) = λ_max(A_bar) / λ_min(A_bar)
```

High `κ` → degenerate. Low `κ` → well-conditioned. This is a diagnostic metric used to validate the method in the paper; it is not used to gate the solver.

See [Lie Groups SE(3)/SO(3) and Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) for the SE(3) update mechanics.

### GenZ-ICP Architecture

```
Input: LiDAR scan (PointCloud2)
  │
  ▼
[1] Deskewing / motion compensation (constant-velocity model, same as KISS-ICP)
  │
  ▼
[2] Point classification:
      For each point → local PCA → surface variation → {planar | non-planar}
      Compute α = N_pl / (N_pl + N_po)
  │
  ▼
[3] Correspondence matching against local voxel map:
      Planar:     nearest-neighbour with normal extraction (point-to-plane)
      Non-planar: nearest-neighbour, no normal (point-to-point)
  │
  ▼
[4] Build H = α·H_pl + (1-α)·H_po
    Solve Δx = H^{-1} b  (IRLS)
  │
  ▼
[5] Update pose T_t ← ΔT · T_{t-1}
  │
  ▼
[6] Update local voxel map
  │
  ▼
Output: Odometry pose T_t
```

**No IMU.** GenZ-ICP is LO only. The GenZ-ICP paper explicitly identifies extending the idea to LIO as future work — fulfilled by GenZ-LIO.

**No loop closure.** Odometry front-end only. For full SLAM, pair with [KISS-SLAM](./kiss-slam.md) or a GTSAM/g2o factor-graph back-end with a loop-closure detector.

---

## GenZ-LIO: Core Technical Mechanism

GenZ-LIO (arXiv:2603.16273, March 2026) addresses an additional challenge beyond corridor degeneracy: **indoor-to-outdoor transitions** change scene scale dramatically. Moving from a narrow hangar corridor to an open apron collapses point density, destabilises fixed-voxel-size systems, and can trigger degeneracy from a different cause — not corridor geometry but point-density collapse. GenZ-LIO introduces three contributions to handle both.

### Contribution 1: PD-Controlled Adaptive Voxel Sizing

GenZ-LIO uses a feedback controller to adapt the downsampling voxel size `d_t` each frame. The control law is:

```
Δd_t = -K_{p,t} · e_t  -  K_{d,t} · Δe_t

where:
  e_t   = N_{actual,t} - N_{desired,t}       (error: actual vs target point count)
  Δe_t  = e_t - e_{t-1}                       (derivative of error)
```

The target point count `N_{desired,t}` is scene-scale-aware: it is scaled between `N_min` and `N_max` using a function of the smoothed median range `m̄_t` across the scan. When the robot exits a hangar (dense indoor cloud → sparse outdoor cloud), the controller increases the voxel size rather than over-processing or crashing. The integral term is excluded to avoid windup with a time-varying setpoint. Gains `K_{p,t}` and `K_{d,t}` are scheduled via geometric mean interpolation based on scene scale and error magnitude.

### Contribution 2: Hybrid-Metric ESIKF Update

GenZ-LIO ports GenZ-ICP's planarity-based residual blending into an ESIKF (Error-State Iterated Kalman Filter) update step:

- **State manifold:** SO(3) × R^15, with an 18-dimensional error state.
- **Forward propagation:** IMU measurements integrated at each sample to produce state prediction `x̂_t`.
- **Correction step:** hybrid residuals combining point-to-plane (from planar correspondences) and point-to-point (from non-planar correspondences), weighted by planarity classification. Uncertainty-based weighting incorporates measurement covariance and discretisation error.

The degeneracy mitigation is implicit through the hybrid residual — no explicit degeneracy detector or mode switch. Non-planar point-to-point residuals regularise the update when planar normals collapse along a degenerate axis.

**IMU integration is the primary mechanism for true degeneracy**: when LiDAR geometry is degenerate along an axis (e.g., a long taxiway straight), the IMU prior constrains motion along that axis, preventing drift. The hybrid residuals then provide additional regularisation in partially degenerate scenes. This is the key architectural advantage of GenZ-LIO over GenZ-ICP.

See [Multi-Sensor Calibration and Observability](../../../10-knowledge-base/geometry-3d/multi-sensor-calibration-observability.md) for IMU-LiDAR extrinsics and observability theory.

### Contribution 3: Voxel-Pruned Correspondence Search

A three-stage pruning scheme reduces correspondence evaluation cost:

1. Candidate voxels selected by query-point location within root voxel (center, surface, edge, or corner case).
2. Point-to-plane matching with statistical gating (chi-squared test on residual magnitude).
3. Point-to-point with distance pruning: if minimum distance to nearest point in voxel exceeds current closest match (`d_nbr ≥ d_closest`), skip the voxel.

### GenZ-LIO Architecture

```
Input: LiDAR scan + IMU stream
  │
  ▼
[1] IMU forward propagation → state prediction x̂_t
  │
  ▼
[2] Scene scale analysis:
      Compute smoothed median range m̄_t
      Set N_desired,t = f(m̄_t)
      PD controller → adapt voxel size d_t
  │
  ▼
[3] Voxelised downsampling at d_t
  │
  ▼
[4] Point classification: planar / non-planar (same PCA as GenZ-ICP)
  │
  ▼
[5] Voxel-pruned correspondence search (3-stage)
  │
  ▼
[6] Build hybrid ESIKF update residuals:
      H_pl from planar correspondences
      H_po from non-planar correspondences
      Combined with uncertainty weighting
  │
  ▼
[7] Iterated Kalman update → corrected state x_t
  │
  ▼
[8] Update local map
  │
  ▼
Output: LiDAR-inertial state estimate, local map
```

### NarrowWide Dataset

GenZ-LIO introduces a **NarrowWide dataset** specifically designed for pronounced indoor-to-outdoor transitions: sequences moving from narrow confined spaces (corridors, rooms) to expansive outdoor areas. This is a direct analog to the airside scenario — a vehicle moving from a terminal corridor or jet bridge to an open apron. Other evaluation datasets include SuperLoc and standard public sequences. Specific ATE numbers for GenZ-LIO vs FAST-LIO2 and KISS-ICP could not be confirmed from the pre-print; flag as pending peer-review.

---

## Inputs and Outputs

| Item | GenZ-ICP | GenZ-LIO |
|---|---|---|
| **Inputs** | Stream of 3D LiDAR scans; per-point timestamps for deskewing | LiDAR scans + synchronised IMU at high rate |
| **Calibration** | None beyond sensor `max_range` | LiDAR-IMU extrinsic `T_{IL}` and IMU intrinsic (biases, noise) |
| **Output: pose** | SE(3) odometry `T_t` per scan | Full LiDAR-inertial state: `R, p, v, b_g, b_a` per scan |
| **Output: map** | Updated local voxel map | Updated local voxel map |
| **Loop closure** | Not included — pair with KISS-SLAM or factor graph back-end | Not included |
| **Training** | None | None |

Both methods are **training-free**: no learned weights, no pre-training, no GPU required, no dataset-specific fine-tuning. Degeneracy robustness comes entirely from the blended Hessian structure.

---

## Explicit Degeneracy-Family Operator Math

The degenerate-LIO family uses two complementary approaches to handle rank-deficient Hessians. Understanding both clarifies why GenZ-ICP's implicit approach is distinctive.

### Standard ICP Normal Equations

```
H Δx = b
H = Σ_i J_i^T J_i      [6×6 information matrix]
b = Σ_i J_i^T r_i       [6×1 right-hand side]
Δx = H^{-1} b           [6×1 pose update in se(3)]
```

### Eigendecomposition and Degeneracy Detection (Explicit Family: X-ICP, DAMM-LOAM)

Decompose the Hessian:

```
H = V Λ V^T

V = [v_1, ..., v_6]        eigenvectors (principal constraint directions)
Λ = diag(λ_1, ..., λ_6)   eigenvalues, ordered λ_1 ≥ ... ≥ λ_6
```

Degeneracy indicator:

```
κ = λ_max / λ_min     (global condition number; flagged if κ > threshold)
λ_i < λ_threshold     (per-direction; direction v_i is degenerate)
```

### Constrained Update (Truncated Pseudo-Inverse)

For degenerate directions, zero the corresponding gain:

```
Λ^+ = diag(λ_1^+, ..., λ_6^+)
  where λ_i^+ = 1/λ_i  if λ_i ≥ threshold, else 0

Δx_constrained = V Λ^+ V^T b
```

This **freezes** the pose update in degenerate directions while applying the full ICP update in well-constrained directions. In a corridor with X-axis degenerate: `v_1` points along X; `Λ^+` zeroes the gain on `v_1`; the estimated X-translation is zero (or replaced by IMU prior if available).

**GenZ-ICP does NOT use this explicit approach.** It achieves the same protective effect implicitly: by blending `H_pl` and `H_po`, the `H_po` contribution prevents numerical singularity without needing to identify or freeze degenerate eigenvectors. This avoids the threshold decision and the hard mode-switch.

**X-ICP and DAMM-LOAM use the explicit truncated-SVD approach**, providing more direct control but requiring a threshold and explicit degeneracy classification.

---

## Benchmark Results

### Long_Corridor (SubT-MRS — Primary Degeneracy Benchmark)

The DARPA Subterranean Challenge dataset Long_Corridor sequence is the canonical long-axis degeneracy benchmark. Numbers from the GenZ-ICP paper (Tables IV–VI) and confirmed independently by DAMM-LOAM (arXiv:2510.13287):

| Method | Mean APE (m) | Max APE (m) | Max RPE (m) | Hessian κ |
|---|---|---|---|---|
| Point-to-plane ICP (vanilla) | — | — | 12.50 | ~110 |
| CT-ICP | 44.18 | — | 7.15 | ~80 |
| DLO (G-ICP) | — | — | 22.74 | ~90 |
| KISS-ICP | 6.83 | 19.05 | 0.94 | ~40 |
| **GenZ-ICP** | **1.69** | **4.32** | **0.73** | **~15** |
| DAMM-LOAM | 1.47 | — | — | — |

GenZ-ICP achieves a **4× reduction in mean APE vs KISS-ICP** (6.83 m → 1.69 m). DAMM-LOAM achieves a further marginal improvement (1.47 m) but has no confirmed open-source release at research date.

FAST-LIO2 performance on this specific sequence is not cited in the reviewed papers. With a well-calibrated IMU, FAST-LIO2 would likely outperform GenZ-ICP on this sequence (IMU prior provides the missing constraint), but this is inference, not measured data.

### Ground-Challenge Dataset (Indoor Corridors)

| Method | Corridor1 APE (m) | Corridor2 APE (m) |
|---|---|---|
| KISS-ICP | 1.70 | 0.54 |
| GenZ-ICP | 0.19 | 0.18 |
| DAMM-LOAM | 0.05 | 0.07 |

GenZ-ICP achieves nearly an order-of-magnitude improvement over KISS-ICP on both shorter indoor corridor sequences.

### HILTI-Oxford 2022 Exp07 (Structure-Free / Staircase)

The HILTI scoring system is not a direct ATE in metres; score is a ranking metric from the HILTI evaluation framework.

| Method | Score |
|---|---|
| KISS-ICP | 0.00 (failed) |
| CT-ICP | 5.00 |
| Zhang et al. | 23.33 |
| **GenZ-ICP** | **33.33** |

### KITTI (Non-Degenerate Reference)

GenZ-ICP matches KISS-ICP on standard outdoor benchmarks, paying essentially zero accuracy penalty for its degeneracy robustness:

| Benchmark | KISS-ICP | GenZ-ICP |
|---|---|---|
| KITTI Seq 00–10 (rel. trans. err., %) | 0.50 | 0.51 |
| MulRan KAIST (rel. trans. err., %) | 2.27 | 2.27 |
| Newer College short (rel. trans. err., %) | 0.46 | 0.46 |

This is the "Generalizable" part of the name: corridor robustness at no cost in normal environments.

### GenZ-LIO Benchmarks

GenZ-LIO is evaluated on NarrowWide and SuperLoc datasets (according to the pre-print). Specific ATE numbers vs FAST-LIO2 and KISS-ICP are not confirmed from the arXiv HTML version at time of writing. **Treat all GenZ-LIO quantitative claims as preliminary until peer-reviewed.**

---

## The Degenerate-LIO Family

### Lineage

```
Besl & McKay (1992) — point-to-point ICP
    │
    ├── Zhang & Singh (2014) — LOAM: first Hessian-based degeneracy detection
    │       (minimum eigenvalue; solution remapping to lock degenerate DoF)
    │
    ├── Shan & Englot (2020) — LIO-SAM: factor graph LIO + IMU preintegration
    │
    ├── Xu et al. (2021/2022) — FAST-LIO / FAST-LIO2: ESIKF + ikd-Tree
    │       (IMU prior implicitly handles some degeneracy; no explicit detection)
    │
    ├── Vizzo et al. (2023) — KISS-ICP: minimalist point-to-point only
    │       (accidentally more corridor-robust than P2Pl; no explicit fix)
    │
    ├── Tuna et al. (2022/2023) — X-ICP [arXiv:2211.16335, IEEE TRO 2023]
    │       ETH Legged Robotics — explicit null-space localizability detection
    │       Constrained update: freezes degenerate directions
    │
    ├── Ferrari et al. (2024) — MAD-ICP [arXiv:2405.05828, IEEE RA-L 2024]
    │       PCA kd-tree structure extraction; covariance-based map management
    │       Primary advantage: staircase / vertical sequences (not corridor)
    │
    ├── Lee et al. (2024) — GenZ-ICP [arXiv:2411.06766, IEEE RA-L 2025]
    │       POSTECH CoCEL — adaptive blend P2Pl + P2Po
    │       Implicit robustness via continuous weighting; best LO on Long_Corridor
    │       (1.69 m ATE) at publication; LiDAR-only; no IMU
    │
    ├── Chandna & Kaushal (2025) — DAMM-LOAM [arXiv:2510.13287]
    │       5-class geometric feature classification
    │       Per-point eigenvalue weighting of translational Hessian
    │       1.47 m ATE on Long_Corridor (best published LO at research date)
    │       No confirmed open-source release
    │
    ├── Mason Lee et al. (2025) — LODESTAR [arXiv:2511.09142, IEEE RA-L 2026]
    │       KAIST — DA-ASKF (Schmidt-Kalman, active/fixed state classification)
    │               DA-DE (condition-number-guided data exploitation from past frames)
    │       Handles measurement sparsity AND imbalance (corridor + high-alt UAV)
    │       No confirmed public code
    │
    ├── Xu et al. (2025) — D²-LIO [arXiv:2508.14355]
    │       Directional degeneracy-aware LIO
    │       Adaptive outlier tolerance per direction; IMU covariance weighting
    │
    └── Lee et al. (2026) — GenZ-LIO [arXiv:2603.16273]
            POSTECH CoCEL — adaptive voxel sizing + hybrid ESIKF
            Indoor-outdoor transition focus; IMU-aided for degenerate axes
            Pre-print; code pending publication
```

### Method Comparison Table

| Method | Type | Degeneracy approach | IMU | Long_Corridor ATE | Code |
|---|---|---|---|---|---|
| KISS-ICP | LO | None (P2Po partially helps) | No | 6.83 m | Open |
| FAST-LIO2 | LIO | Implicit (IMU prior) | Yes | Not published for this seq. | Open |
| X-ICP | LO+map | Explicit null-space / truncated SVD | Optional | Not on SubT-MRS | Open |
| MAD-ICP | LO | PCA structure + covariance map mgmt | No | Not on SubT-MRS | Open |
| GenZ-ICP | LO | Adaptive P2Pl/P2Po blend (implicit) | No | 1.69 m | Open |
| DAMM-LOAM | LO | 5-class features + eigenvalue weighting | No | 1.47 m | Not confirmed |
| LODESTAR | LIO | DA-ASKF + DA-DE (condition number) | Yes | Not on SubT-MRS | Not confirmed |
| D²-LIO | LIO | Directional weighting + IMU covariance | Yes | Not on SubT-MRS | Not confirmed |
| GenZ-LIO | LIO | Hybrid residuals + adaptive voxel | Yes | Not yet published | Pending |

For general-performance KITTI/MulRan benchmarks, KISS-ICP and GenZ-ICP are neck-and-neck (within 0.01%); the differentiation is entirely in degenerate environments. See [KISS-ICP](./kiss-icp.md) §Known Failures and [FAST-LIO and FAST-LIO2](./fast-lio-fast-lio2.md) for the IMU-tight alternative. The [GEODE Degenerate LiDAR Benchmark](./geode-degenerate-lidar-benchmark.md) (arXiv:2409.04961, IJRR 2026; 64 trajectories, 64 km, seven degenerate-environment types) is the emerging standard for evaluating this family; GenZ-ICP predates GEODE, but GenZ-LIO is expected to evaluate on it.

---

## Strengths

- **Corridor and long-axis degeneracy robustness**: 4× APE improvement over KISS-ICP on Long_Corridor; nearly an order-of-magnitude over CT-ICP. The only published open-source LO that specifically solves the corridor-drift problem with zero normal-scene accuracy penalty.
- **No explicit degeneracy threshold**: the continuous adaptive weight α avoids brittle threshold decisions and mode switches that can create discontinuities at the degeneracy boundary.
- **Training-free and geometry-only**: no learned components, no GPU, no pre-training. Deployable to any LiDAR sensor without fine-tuning.
- **Generalizable to non-degenerate scenes**: KITTI/MulRan performance matches KISS-ICP within measurement noise. The method does not sacrifice normal-scene accuracy to gain corridor robustness.
- **Open-source with pip install**: `pip install genz-icp`; ROS2 integration; pre-tuned sensor configs in the repo.
- **GenZ-LIO adds indoor-outdoor transition robustness**: PD-controlled voxel sizing handles abrupt scale changes at hangar exits, terminal doors, and building transitions — a specific failure mode of fixed-voxel-size LIO systems including FAST-LIO2.

---

## Failure Modes

- **Multi-axis degeneracy (open apron)**: GenZ-ICP's blended Hessian can handle 1-DoF corridor degeneracy but cannot create observability where no stable structure exists in multiple directions. An open airport apron (minimal lateral geometry, flat ground, no sidewalls) creates 2-DoF or 3-DoF translational degeneracy. **RTK/GNSS is mandatory for open-apron operation regardless of which LO/LIO method is used.** Neither GenZ-ICP nor GenZ-LIO changes this requirement.
- **No loop closure**: drift accumulates over long traversals without a back-end. Pair with [KISS-SLAM](./kiss-slam.md) or a GTSAM factor graph with a loop-closure detector for sessions longer than ~300–500 m.
- **GenZ-LIO benchmark numbers unconfirmed**: the GenZ-LIO paper is a pre-print (March 2026). Quantitative ATE numbers vs FAST-LIO2 could not be confirmed from the arXiv HTML at research date. Do not rely on GenZ-LIO performance claims for deployment decisions until peer-reviewed.
- **Missing threshold parameters**: `τ_planar` and `τ_num` numerical values are not published in the RA-L paper. Use the GitHub pre-tuned configs for supported sensors; for new sensor types, empirical tuning is required.
- **GenZ-LIO code not yet available**: promised upon publication. No public repository confirmed at research date. Monitor https://github.com/cocel-postech for future release.
- **Dynamic objects**: neither method distinguishes dynamic from static points. In high-traffic airside environments (aircraft taxiing, tugs, baggage carts), upstream dynamic-object filtering is required before registration.
- **IMU dependency (GenZ-LIO)**: like all LIO systems, GenZ-LIO requires well-calibrated IMU extrinsics and intrinsics. IMU bias drift or miscalibration will degrade performance in proportion to time between updates.

---

## Domain Fit

| Domain | GenZ-ICP | GenZ-LIO | Notes |
|---|---|---|---|
| Indoor corridor / tunnel | Strong | Strong | Canonical target environment; 4× over KISS-ICP on Long_Corridor |
| Terminal / gate zone | Strong | Strong | Rich vertical geometry; degeneracy unlikely |
| Jet bridge / finger pier | Strong | Strong | 1-DoF corridor geometry; direct application target |
| Hangar-row corridor | Strong | Strong | Parallel hangar walls → long-axis degenerate |
| Long taxiway straight | Strong | Strong | Direct corridor-degeneracy analog; IMU essential for full coverage |
| Hangar-to-apron transition | Partial | Strong | GenZ-LIO PD voxel sizing designed for this transition |
| Open apron (large) | Weak | Weak | Multi-axis degeneracy; RTK/GNSS mandatory regardless of method |
| Road AV — urban structured | Strong | Strong | No accuracy penalty on KITTI vs KISS-ICP |
| Road AV — open highway | Conditional | Good | Lateral constraint from lane markings helps; IMU adds robustness |
| Warehouse / indoor flat | Strong | Strong | Dense shelf/rack geometry well-suited |
| Mining / tunnel | Strong | Strong | Tunnel = corridor; direct application |
| Drone / aerial UAV | Partial | Good | Constant-velocity deskewing may fail under aggressive manoeuvres |

---

## Aggregated-Map Suitability

Degeneracy is a first-order problem in airside map building. Taxiways and runways create exactly the long-axis corridor geometry that defeats vanilla ICP: taxiway-edge geometry is parallel to the direction of motion, providing no constraint along the heading axis. On a 1 km taxiway traversal, KISS-ICP's 6.83 m/km mean APE projects to ~70 m positional drift without any loop closure or GPS correction — unacceptable for precision airside autonomy.

GenZ-ICP/LIO directly address this. The recommended pipeline:

```
LiDAR scan stream
  │
  ├── [No IMU] → GenZ-ICP front-end
  │               (adaptive P2Pl + P2Po; corridor-robust)
  │
  ├── [With IMU] → GenZ-LIO or FAST-LIO2
  │               (IMU prior + hybrid residuals; best for transitions)
  │
  ▼
Per-scan pose estimates
  │
  ▼
Loop closure detection (KISS-Matcher, Scan-Context++)
  │
  ▼
Pose graph optimisation (GTSAM, g2o) with GPS/RTK priors
  │
  ▼
Aggregated dense point cloud
  │
  ▼
Semantic segmentation (SpherFormer, Rangeformer)
  │
  ▼
Semantic airside map (taxiway markings, obstacles, gates, apron surfaces)
```

Recommendation matrix for front-end selection:

| Scenario | Recommended front-end | Rationale |
|---|---|---|
| No IMU; corridor-like traversal (taxiways, jet bridges, finger piers) | GenZ-ICP | Deployable open-source; best available corridor-robust LO |
| With IMU; apron-to-terminal transitions | GenZ-LIO (when available) or FAST-LIO2 | IMU handles degenerate axes; GenZ-LIO adds voxel adaptation for scale transitions |
| Open apron, multi-axis degeneracy | RTK/GNSS primary; any LO as refinement | No LO/LIO method handles 2-DoF+ translational degeneracy; external constraint is mandatory |
| General map-building baseline | KISS-ICP | Simpler and open; use where corridor lengths are <200 m or GPS/RTK is always available |

Monitoring metrics during map building:
- Hessian condition number per frame (flag frames with κ > 50 as degenerate)
- Inlier ratio (drops in degenerate scenes)
- Per-frame LiDAR vs IMU agreement (GenZ-LIO mode)
- GPS/RTK consistency check at scan time

See [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) §1.1 for the full downstream segmentation pipeline.

---

## Implementation Notes

- **Benchmark against KISS-ICP and FAST-LIO2 first**: run the same deskewing and voxel policy across all three on your target sensor and environment before committing to a front-end. GenZ-ICP's advantage is largest in corridor-dominated routes; on mixed urban/outdoor routes the gap closes.
- **Use the GitHub pre-tuned configs**: `τ_planar` and `τ_num` are not published numerically. The repository provides pre-tuned configs for common Velodyne, Ouster, and Livox sensor types. For a new sensor, start from the closest config and tune on a corridor validation sequence.
- **Track Hessian condition number per frame**: flag frames with κ(A_bar) > 50 as degenerate. Use this signal to inflate pose covariance before inserting into a factor graph — do not accept low registration residuals as proof of strong observability.
- **Pair with dynamic-object filtering**: in busy airside environments (aircraft, tugs, ground crews), upstream filtering of dynamic points is required before registration. KISS-ICP, GenZ-ICP, and GenZ-LIO all insert dynamic points into the local map without distinction.
- **For GenZ-LIO**: validate the PD voxel controller during abrupt indoor-to-outdoor transitions; tune `N_min`, `N_max`, and the gain schedule on your specific sensor's range characteristics. The controller can oscillate if gains are set for a different sensor's density profile.
- **Loop closure is mandatory for long sessions**: without a back-end, drift accumulates. Connect GenZ-ICP to [KISS-SLAM](./kiss-slam.md) or a GTSAM factor graph with GPS/RTK priors or Scan-Context++ loop closure for sessions longer than ~300–500 m.
- **DAMM-LOAM achieves marginally better ATE on Long_Corridor** (1.47 m vs 1.69 m) but has no confirmed open-source release at research date. GenZ-ICP is the operationally deployable choice in this family.
- **LODESTAR** (KAIST, DA-ASKF + DA-DE) is the most principled statistical treatment of degeneracy in the family but also the most complex and lacks public code. Monitor for release.
- **GenZ-LIO code status**: monitor https://github.com/cocel-postech for release; no repository confirmed at research date. Use FAST-LIO2 as the IMU-tight fallback in production until GenZ-LIO code is confirmed.

---

## Sources

- Lee, D., Lim, H., Han, S. "GenZ-ICP: Generalizable and Degeneracy-Robust LiDAR Odometry Using an Adaptive Weighting." IEEE RA-L vol. 10 no. 1, 2025. https://arxiv.org/abs/2411.06766 · DOI: 10.1109/LRA.2024.3498779 · IEEE Xplore: https://ieeexplore.ieee.org/document/10753079
- GenZ-ICP repository (CoCEL POSTECH): https://github.com/cocel-postech/genz-icp
- Lee, D. et al. "GenZ-LIO: Generalizable LiDAR-Inertial Odometry Beyond Indoor–Outdoor Boundaries." arXiv:2603.16273, March 2026. https://arxiv.org/abs/2603.16273 — **pre-print; benchmark numbers unconfirmed**
- DAMM-LOAM (independent Long_Corridor re-measurement): https://arxiv.org/html/2510.13287v1
- X-ICP (explicit truncated-SVD degeneracy): https://arxiv.org/abs/2211.16335 · IEEE TRO 2023
- MAD-ICP (PCA structure + covariance map): https://arxiv.org/abs/2405.05828 · IEEE RA-L 2024 · https://github.com/rvp-group/mad-icp
- LODESTAR (DA-ASKF + DA-DE): https://arxiv.org/abs/2511.09142 · IEEE RA-L 2026
- D²-LIO (directional degeneracy-aware LIO): https://arxiv.org/abs/2508.14355
- GEODE dataset (heterogeneous degenerate-environment benchmark): https://arxiv.org/abs/2409.04961 · https://github.com/PengYu-Team/GEODE_dataset
- Field analysis on degeneracy-aware registration: https://arxiv.org/html/2408.11809v1
- OpenCV GenZ-ICP blog: https://opencv.org/blog/genz-icp/
- KISS-ICP (baseline; corridor failure quantification): https://arxiv.org/abs/2209.15397 · see `./kiss-icp.md`
- FAST-LIO2 (IMU-tight alternative): https://arxiv.org/abs/2107.06829 · see `./fast-lio-fast-lio2.md`
- KISS-SLAM (loop closure back-end): https://arxiv.org/abs/2503.12660 · see `./kiss-slam.md`
- CT-ICP (continuous-time comparison): https://arxiv.org/abs/2109.12979 · see `./ct-icp.md`
- Point Cloud Registration Math — ICP, NDT, GICP: `../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md`
- Multi-Sensor Calibration and Observability: `../../../10-knowledge-base/geometry-3d/multi-sensor-calibration-observability.md`
- Lie Groups SE(3)/SO(3) and Jacobians: `../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md`
- Aggregated-Map Semantic Segmentation: `../../perception/overview/aggregated-map-semantic-segmentation.md`
- Production LiDAR-to-Map Localization: `../overview/production-lidar-map-localization.md`
