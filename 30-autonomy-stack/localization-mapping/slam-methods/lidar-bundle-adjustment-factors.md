# LiDAR Bundle Adjustment Factors

<!-- method-priority:start
priority:
  learning: 5
  deployment: 4
  type: "architecture-pattern"
  stage: "foundation"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "runtime-localization", "validation"]
  reason: "LiDAR Bundle Adjustment Factors is rated for foundational SLAM modeling, optimization, registration, or mapping concepts."
method-priority:end -->

Related method pages: [Certifiable Pose Graph Optimization](./certifiable-pose-graph-optimization.md) (iter 34) · [Continuous-Time Registration](./continuous-time-registration.md) (iter 36) · [Loop Closure and Place Recognition](./loop-closure-place-recognition.md) (iter 28) · [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) (iter 22) · [KISS-ICP](./kiss-icp.md) (iter 20) · [KISS-SLAM](./kiss-slam.md) (iter 32) · [KISS-Matcher](./kiss-matcher.md) (iter 35) · [Kimera-RPGO and PCM](./kimera-rpgo-pcm.md) (iter 37 sibling) · [Distributed Multi-Robot PGO](./distributed-multi-robot-pgo.md) (iter 35) · [LT-Mapper / Khronos Lifelong Mapping](./lt-mapper-khronos-lifelong-mapping.md) (iter 21) · [HDL Graph SLAM](./hdl-graph-slam.md) · [MOLA](./mola.md) · [SuMa](./suma.md) · [Bundle Adjustment SLAM](bundle-adjustment-slam.md) · [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md)

Related KB pages: [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md) · [Lie Groups SE(3)/SO(3) Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) (iter 14)

**Last updated:** 2026-05-24

---

## What It Is

LiDAR bundle adjustment (BA) is the family of factor-graph factors that jointly optimize sensor poses and map elements using raw LiDAR point measurements as the direct evidence. The map elements may be planes, edges, surfels, voxel Gaussians, or polynomial surfaces. Each point in each scan contributes a residual that depends on both the scan pose and the associated feature parameters; all residuals are minimized simultaneously over the full set of poses and features.

The result is a globally consistent point-cloud map with tighter pose accuracy than sequential scan-to-scan ICP can achieve. Classical ICP pipelines process scans one at a time, compounding local errors. LiDAR BA treats the entire map and the entire pose sequence as a single coupled optimization problem, so every scan's evidence propagates to every pose that shares a geometric feature with it. The canonical implementation family is BALM / BALM2 (HKU-MARS), with HBA (hierarchical BA), Voxel-SLAM, MAD-BA, and several others extending the core idea.

The primary operational role of LiDAR BA is as an **offline, post-survey, final map refinement step**. Online LIO front-ends (FAST-LIO2, KISS-ICP, CT-ICP) build the initial trajectory and map; LiDAR BA closes residual geometric inconsistency that neither online filtering nor pose-graph optimization (PGO) alone can eliminate.

---

## Core Technical Idea

### Classical Visual BA vs LiDAR BA

Classical visual bundle adjustment minimizes reprojection error:

```text
camera pose + 3D landmark -> pixel observation residual
min_{T_i, X_j}  sum || pi(T_i, X_j) - u_{ij} ||^2
```

where `pi` is the camera projection and `u_{ij}` is the observed keypoint in image `i` for landmark `j`.

LiDAR BA replaces image observations with geometric constraints:

```text
scan pose + map feature -> point-to-feature distance residual
min_{T_i, pi_j}  sum  r(T_i * p_{ijk}, pi_j)^2
```

where `T_i` is the SE(3) pose of scan `i`, `p_{ijk}` is the k-th raw LiDAR point in scan `i` associated with feature `j`, `pi_j` are the feature parameters (plane normal + intercept, edge axis, surfel center/normal, voxel Gaussian mean/covariance), and `r(.)` is a scalar residual measuring how well the transformed point fits the feature.

The formal LiDAR BA objective is:

```text
min_{T_j in SE(3), pi_i in Feat}
    sum_i sum_{j in obs(i)} sum_k  r(T_j * p_{ijk}, pi_i)
```

### Why BA Beats Sequential ICP

Sequential scan-to-map ICP processes scans one at a time. Each scan is registered to the current map; the map is updated; the next scan is registered to the updated map. Errors in early registrations corrupt the map, which corrupts subsequent registrations. Drift compounds.

PGO (pose-graph optimization) adds loop closures to constrain the drift globally, but it optimizes only relative pose constraints between scan pairs — the map geometry is treated as fixed. Residual geometric inconsistency that arose from each individual ICP alignment is not corrected.

LiDAR BA eliminates this residual because the plane/surfel parameters are optimization variables: every raw point in every scan contributes a gradient to both the corresponding pose and the corresponding feature parameters simultaneously. When a plane parameter shifts, all scans that share that plane see updated residuals and their poses adjust. This joint coupling is what produces sub-centimetre map accuracy on large outdoor datasets.

---

## Why LiDAR BA Matters for Airside

A survey-grade airside aggregated map targets less than 5 cm absolute accuracy (per iter-13 deskew brief). The standard front-end pipeline — FAST-LIO2 or CT-ICP scan-to-map integration — yields drift on the order of 0.1 to 0.5 percent of distance traveled. Over a 2 km taxiway loop that is 2 to 10 m of cumulative drift.

Even after GTSAM pose-graph optimization with loop closures from KISS-Matcher (iter-35), residual error typically sits in the 3 to 15 cm range. PGO tightens relative pose constraints between scan pairs, but individual scan-to-map ICP alignments retain their local biases. Each scan's registration error is baked into the map; PGO cannot see inside those registrations because the map geometry is treated as fixed.

LiDAR BA applied as a final offline step eliminates this residual. Each raw LiDAR point votes on plane or surfel parameters, and that vote propagates gradients back to all contributing scan poses simultaneously. The practical consequence: sub-5 cm aggregate maps become achievable without expensive ground-truth targets, at the cost of a single offline batch optimization pass.

Reported accuracy after BA on large outdoor datasets:

- BALM on a 817 m Livox Horizon sequence: 0.031 % relative drift vs LOAM's 0.762 % — a 20x reduction (different sensor and dataset from KITTI; not a direct comparison).
- MAD-BA on KITTI sequences 00 to 10: 1.17 mm average RMS (best reported as of early 2025).
- HBA on KITTI: 2.01 mm average RMS.
- BALM2 on KITTI: 2.43 mm average RMS.
- BA-CLM on KITTI00: 1.23 m RMSE absolute trajectory (different metric from the per-sequence RMS numbers above).
- Voxel-SLAM on indoor Hilti sequences: 0.62 to 13.8 cm ATE across 13 sequences.
- Hilti SLAM Challenge 2023 top single-session LiDAR SLAM systems with BA back-ends: less than 2 cm ATE on handheld construction sequences; HBA (HKU-MARS) was runner-up in the LiDAR multi-session category.

---

## Factor Types

### Plane Factors

**Parameterization.** A plane is defined by unit normal `n in S^2` and a reference point `q` on the plane (or equivalently the signed distance from the origin `d = -n^T q`). The four-parameter homogeneous form `[n^T, d]^T` with `||n|| = 1` is standard.

**Residual (point-to-plane).** For a raw LiDAR point `p` in the local frame of scan j, transformed to the world frame as `T_j p`, the scalar residual is:

```text
r = n^T (T_j p - q)
```

The squared cost for feature `i` aggregated over all scans `j` and all points `k` associated with it is:

```text
c(pi_i, {T_j}) = (1/N_i) sum_j sum_k  [n_i^T (T_j p_{ijk} - q_i)]^2
```

**Analytical elimination (BALM).** BALM / BALM2 show that the optimal `q_i*` for fixed poses is always the centroid of all transformed points, and the optimal `n_i*` is the eigenvector of the point scatter matrix `A_i` at the smallest eigenvalue `lambda_3`:

```text
A_i = sum_j sum_k (T_j p_{ijk})(T_j p_{ijk})^T  -  N_i * p_bar_i * p_bar_i^T
```

After elimination, the per-feature cost reduces to `c_i* = lambda_3(A_i)`, a function of poses alone. The total BA objective becomes the BALM pose-only form:

```text
min_{T_j in SE(3)}  sum_i  lambda_3(A_i({T_j}))
```

No feature variables remain in the optimizer; plane geometry is implicitly enforced via the eigendecomposition.

**Cartographer-3D plane factors.** Hess et al. (ICRA 2016) use a probabilistic occupancy submap as the feature. The matching cost sums occupancy probabilities at transformed scan points, solved with a Ceres nonlinear optimizer. Loop closure inserts Sparse Pose Adjustment (SPA) edges. Cartographer is not a true BA (submap content is not jointly optimized), but its branch-and-bound scan matcher provides robust initial estimates for a downstream BA back-end.

See [Point Cloud Registration Math](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md) for background on point-to-plane distance geometry.

### Edge Factors

**Parameterization.** An edge (line) is defined by a direction unit vector `n_e` and a reference point `q_e`. The residual is the perpendicular distance from the transformed point to the line:

```text
r_e = || (I - n_e n_e^T)(T_j p_{ijk} - q_e) ||_2
```

After the same analytical eigendecomposition trick, the per-feature cost for an edge feature is `lambda_2(A_i) + lambda_3(A_i)` — the sum of the two smallest eigenvalues of the scatter matrix.

LOAM (Zhang and Singh, RSS 2014) pioneered feature-based LiDAR odometry using edge plus plane correspondences with Gauss-Newton minimization of point-to-edge and point-to-plane distances. LOAM does not jointly optimize map geometry and poses; it alternates between high-rate odometry (edge and plane matching) and lower-rate map update. BALM builds on LOAM's feature extraction and adds a genuine BA back-end.

### Surfel Factors

**Parameterization.** A surfel is an oriented disk: center `p_s in R^3`, normal `n_s in S^2`, radius `r_s > 0`. It is a compact, GPU-renderable surface primitive. The point-to-surfel residual is a weighted point-to-plane distance:

```text
e(k, s) = rho_Huber(sigma^{-1} (T_k^w n_s)^T (T_k^w p_s - p_leaf_i))
```

where `p_leaf_i` is a voxelized scan point, `T_k^w` transforms the surfel to the world frame, and `sigma` is the measurement uncertainty derived from the LiDAR beam divergence model.

**MAD-BA** (Cwian et al., IEEE RA-L 2025) implements surfel-based BA with a generalized beam-divergence uncertainty model: a cone is cast toward the leaf centroid from the sensor origin; sub-rays sampled within the cone yield standard deviation `sigma = sqrt(1/N * sum(r_i - ||p_l||)^2)`, and measurements are down-weighted by sigma. This models range-dependent noise correctly and improves accuracy over methods that ignore measurement geometry.

MAD-BA jointly updates both surfel positions and normals and poses without analytical elimination, which gives it the advantage of correcting geometric errors in the map even when initial poses are already good.

**SuMa** (Behley and Stachniss, RSS 2018) uses surfels for scan-to-model ICP with a rendered map view and detects loop closures by comparing rendered views at candidate poses. SuMa is not a BA (no joint optimization), but it provides the surfel map representation that MAD-BA's BA factors operate on. See [SuMa](./suma.md).

### Voxel-Cell / NDT Factors

**Parameterization.** In Normal Distributions Transform (NDT), each voxel cell holds a 3D Gaussian `(mu_v, Sigma_v)` fitted to the points that fall in the cell. The alignment cost is the negative sum of NDT scores:

```text
r_NDT = exp(-0.5 (T_j p - mu_v)^T Sigma_v^{-1} (T_j p - mu_v))
```

BA on voxel Gaussians jointly optimizes poses and Gaussian parameters. In practice, most NDT implementations update voxel statistics in a separate step, making it an alternating optimization rather than true simultaneous BA.

**BA-CLM** (Sensors 2024) is the closest to a voxel BA in production: it uses a multi-resolution voxel pyramid with three layers, fits planes in each voxel using eigendecomposition with planarity criterion `(lambda_1 + lambda_2) / (lambda_1 + lambda_2 + lambda_3) >= 0.9`, and formulates a multivariate LBA cost factor:

```text
e_LBA = sum_v  lambda_3(A_v)
```

where the sum runs over all voxels in the current submap. This constrains all scan poses within a submap simultaneously, making it a genuinely multivariate factor rather than a pairwise relative-pose constraint.

### Continuous-Time Factors

Iter-36 covers CT-ICP and B-spline registration in depth. The continuous-time extension for LiDAR BA represents the per-scan trajectory as a cubic B-spline over time, so every raw LiDAR point `p(t)` is associated with an interpolated pose `T(t)` computed from spline knots. The BA residual is:

```text
r = n^T (T(t) p - q)
```

where `T(t)` is a function of the B-spline control points `{K_0, K_1, ...}`. The Jacobian of `r` with respect to control point `K_i` propagates through the B-spline basis blending functions; the resulting Jacobian block for each control point has the same structure as discrete-pose BA multiplied by the scalar basis coefficient `B_{i,order}(t)`.

CT-BA naturally handles within-scan motion distortion: points at different timestamps within the same sweep have different poses `T(t)`, so the B-spline eliminates the need for a separate deskewing pass. This is particularly relevant for spinning LiDARs at airside ramp vehicle speeds (5 to 15 km/h, 10 Hz rotation) where up to 40 cm of scan shear accumulates per sweep at the higher end.

A December 2024 paper (Lamarr Institute, ICRA 2025 submission, arXiv:2412.11760) presents efficient CT LiDAR BA for multi-scan alignment using an out-of-core circular buffer to handle thousands of scans, demonstrating alignment of both handheld and vehicle-mounted LiDAR sessions.

See [Continuous-Time Registration](./continuous-time-registration.md) for the full treatment of B-spline and SLERP trajectory parameterizations.

---

## BALM / BALM2 Deep Dive

### BALM (RAL 2021) — Liu and Zhang, HKU-MARS

**Core idea.** Analytically eliminate the feature parameters — `(n, q)` for planes; `(n_e, q_e)` for edges — from the BA problem. This reduces optimization dimensionality from `6N + 4M` (poses + plane params) to `6N` (poses only). The feature geometry is implicitly enforced via the eigendecomposition of the scatter matrix.

**Adaptive voxelization.** Correspondence search uses a hash-indexed octree. Starting from a default cell size (e.g., 1 m), each cell is recursively split into eight octants if points do not satisfy a planarity or linearity criterion, until reaching a minimum size (e.g., 0.125 m). Voxels that pass planarity become plane features; those that pass linearity become edge features.

**SE(3) Jacobian.** Using left-perturbation on SE(3), the pose update is `T_j ⊞ delta T_j`. The first-order derivative of the transformed point `T_j p` with respect to the perturbation is:

```text
d(T_j p) / d(delta T_j) = [-R_j (p^hat)   I_3]  in R^{3 x 6}
```

where `p^hat` is the skew-symmetric matrix of `p` (hat operator). Combined with the chain rule through `lambda_3(A)`, the analytical gradient and Hessian of the pose-only cost are derived in closed form to second order — avoiding finite differencing and producing the efficient convergence BALM is known for.

**Theorem structure.** The elimination result is formally stated as Theorem 1 (plane feature) and Theorem 2 (edge feature) in the BALM paper. Each theorem shows that the per-feature cost, after marginalizing out the feature parameters in closed form, reduces to a function purely of the scan poses and the scatter matrix `A_i`.

**Performance on Livox Horizon (817 m).** BALM 0.038 % relative drift vs LOAM 0.762 %. Real-time at 10 Hz for a 20-scan sliding window on a standard desktop CPU.

**Datasets tested.** Livox Horizon, Velodyne VLP-16 (indoor). Open source: https://github.com/hku-mars/BALM (GPLv2). Dependencies: ROS Noetic/Melodic, PCL 1.10, Eigen 3.3.7.

**Caution from maintainers.** "If your initial pose error is too large in real-world datasets, the plane detection module may not find enough planes to BA optimization." A coarse-to-fine strategy is recommended when initial estimates are poor (e.g., after a GPS outage).

### BALM2 (TRO 2023) — Liu, Liu, Kong, Zhang, HKU-MARS

**Point cluster coordinates.** All N points associated with feature `i` in scan `j` are summarized as a 4x4 symmetric matrix (the "point cluster"):

```text
R(C) = [ P    v  ]
       [ v^T  n  ]

where P = sum_k p_k p_k^T,  v = sum_k p_k,  n = |points|
```

**Two key theorems (proven in the paper):**

- `R(T o C) = T R(C) T^T` — rigid transforms propagate linearly through cluster coordinates.
- `R(C_1 + C_2) = R(C_1) + R(C_2)` — clusters merge additively.

These allow the cost `sum_i lambda_3(A_i)` and its Jacobian and Hessian to be evaluated in O(M x N_scans) time rather than O(total raw points), making computation independent of raw point count. This is BALM2's critical speedup: a point cluster is computed once per (feature, scan) pair and reused across all optimization iterations.

**Covariance estimation.** BALM2 also estimates pose covariance by exploiting second-order information, enabling consistent uncertainty propagation — important for downstream GTSAM factor graph integration.

**Convergence.** Typically 3 to 5 iterations for a sliding-window optimization.

**Datasets tested.** Hilti Challenge, VIRAL, UrbanLoco; FAST-LIO2 used as front-end for initial poses. Open source: https://github.com/hku-mars/BALM (BALM2 is the main branch, GPLv2).

---

## Operator Mathematics

For a plane factor with residual `r = n^T (T p - q)`, the Jacobian with respect to the SE(3) pose perturbation `delta xi = [delta phi^T, delta t^T]^T in R^6` is:

```text
dr / d(delta xi) = n^T [-R (p^hat)   I_3]
                 = [-n^T R p^hat    n^T]
```

In practice, implementations (Ceres, GTSAM) use the left Jacobian on the Lie algebra so that the optimizer takes Newton steps on the SE(3) manifold directly. BALM derives this to second order in closed form. See [Lie Groups SE(3)/SO(3) Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) for the full Exp/Log/hat operator definitions.

For the BALM2 pose-only cost `f = sum_i lambda_3(A_i)`, the gradient with respect to pose `j` is:

```text
df / dT_j = sum_i  u_i u_i^T  *  dA_i / dT_j
```

where `u_i` is the unit eigenvector of `A_i` at the smallest eigenvalue. The full formula including the second-order Hessian term is derived in BALM2 Appendix A (arXiv:2209.08854).

For the plane parameter Jacobian: the gradient of `lambda_3(A_i)` with respect to a small change in plane parameters `(n, d)` traces back through the eigendecomposition. In BALM's analytical formulation this derivative is never explicitly computed — the plane parameters are eliminated and only the pose Jacobian matters.

---

## Implementations

### BALM / BALM2 (HKU-MARS)

- GitHub: https://github.com/hku-mars/BALM
- ROS Noetic/Melodic, PCL 1.10, Eigen 3.3.7
- Integrates as back-end after FAST-LIO2 front-end
- Provides: plane BA, edge BA, consistency test, virtual and real-world benchmarks
- Use `roslaunch balm2 benchmark_realworld.launch` for offline map refinement

### Cartographer-3D (Google, Hess et al., ICRA 2016)

- Not a true joint BA; uses Ceres-based scan-to-submap matching plus SPA pose-graph edges for loop closure.
- Branch-and-bound scan matcher for robust initial estimates.
- Useful as a comparison baseline and for systems already on the Cartographer stack.
- Reference: https://research.google.com/pubs/archive/45466.pdf

### HBA — Hierarchical Bundle Adjustment (HKU-MARS, RAL 2023)

- GitHub: https://github.com/hku-mars/HBA
- Paper: https://arxiv.org/abs/2209.11939
- Addresses the scalability limit of flat BALM2 on large maps (more than 1000 scans): the Hessian becomes too large to solve efficiently.
- Method: (1) bottom-up — group keyframes into submaps; within each submap solve a small BALM2 BA problem; (2) top-down — PGO over submap poses to propagate updates smoothly to all scan poses.
- Performance: globally consistent map at approximately 12 % of total sequence time vs full flat BA. Similar accuracy to flat BA.
- Datasets: KITTI, MulRan, Newer College (spinning LiDAR), self-collected solid-state.
- Hilti SLAM Challenge 2023: HBA was the runner-up back-end in the LiDAR-driven multi-session category with less than 2 cm ATE.
- License: GPLv2.

### Voxel-SLAM (HKU-MARS, 2024)

- Paper: https://arxiv.org/abs/2410.08935 (Advanced Intelligent Systems, Wiley).
- Five-module system: initialization, odometry, local mapping (sliding-window LIO-BA with 10 scans), loop closure, global mapping (hierarchical global BA).
- Local BA: LiDAR-inertial BA using BALM2 point cluster coordinates; jointly fixes states in the 10-scan window.
- Global BA: hierarchical as in HBA; triggers after loop closure detection.
- Hilti indoor benchmark: 0.62 to 13.8 cm ATE across 13 sequences.
- Most complete production-ready BA stack from HKU-MARS as of 2024.

### LIO-BA

LiDAR-inertial odometry with built-in BA refinement as a tightly coupled component. Adds an IMU preintegration factor to the BALM-style plane/edge BA. Enables real-time BA during the odometry run rather than purely offline.

### BA-LINS (2024)

- Paper: https://arxiv.org/abs/2401.11491
- Frame-to-frame BA for dead-reckoning LiDAR-inertial navigation; targets navigation accuracy rather than offline map quality.
- Plane-point factors across keyframes plus IMU preintegration in a GTSAM factor graph.
- Adaptive covariance estimation per factor.
- Reported improvement vs baseline FF-LINS: +29.5 % translation accuracy, +28.7 % efficiency.

### BA-CLM (Sensors 2024)

- Paper: https://www.mdpi.com/1424-8220/24/17/5554
- Multivariate LBA cost factor; multi-resolution voxel pyramid with three layers.
- Front-end: Faster-LIO; loop closure: Scan Context; global optimization: Ceres-based.
- Processing time: 55.3 ms per frame on a 32-line LiDAR (real-time capable).
- KITTI00: 1.23 m RMSE; M2DGR-S03: 0.118 m RMSE (beats HBA's 0.143 m on this sequence).

### MAD-BA (IEEE RA-L 2025)

- Paper: https://arxiv.org/abs/2501.03972
- Surfel-based BA with generalized beam-divergence uncertainty model (see Factor Types above).
- Jointly optimizes surfel positions, normals, and poses without analytical elimination.
- Uses Huber loss for robustness to outlier points.
- KITTI sequences 00 to 10: 1.17 mm average RMS (best reported result among compared methods as of early 2025).
- Open-source status: paper mentions open-source; exact GitHub URL not confirmed — verify at arXiv:2501.03972 author page before citing a repository link.

### PSS-BA (2024)

- Paper: https://arxiv.org/abs/2403.06124
- Progressive spatial smoothing: fits polynomial surfaces rather than planes within local tangent spaces; handles non-planar environments and large initial pose errors.
- Real-world occupancy map improvement: from 241,717 voxels (initial) to 176,480 (PSS-BA) vs 203,940 (BALM baseline).
- Suitable as an alternative when the environment lacks clear planar structure — relevant for open airside apron sections.

### Consistency-Improved LIO-BA (February 2026)

- Paper: https://arxiv.org/abs/2602.06380
- Stereographic-projection parameterization for plane and edge features; First-Estimate Jacobians (FEJ) to preserve observability and covariance consistency.
- MAP formulation with IMU preintegration. Very recent; no third-party benchmark available yet.

---

## Comparison with Pose-Graph Optimization

PGO optimizes only poses — it treats map geometry as fixed or decoupled. LiDAR BA jointly optimizes poses and map elements using raw LiDAR points as direct evidence.

| Property | PGO Only | LiDAR BA |
|---|---|---|
| Optimization variables | Poses only | Poses + map elements |
| Residuals | Relative pose between scan pairs | Point-to-plane / point-to-edge / point-to-surfel |
| Information used | Pairwise ICP constraints | All raw LiDAR points simultaneously |
| Map consistency | Not directly optimized | Directly enforced via shared feature parameters |
| Computational cost | Low (sparse, binary factors) | Higher (dense, per-point or per-cluster) |
| Scalability | Excellent (sparse linear system) | Requires hierarchical decomposition for > 500 scans |
| Accuracy on KITTI | Depends on ICP quality | BA typically 2 to 5x better ATE than PGO-only |
| Covariance estimation | Straightforward from factor graph | BALM2 provides consistent covariance via second-order information |
| Loop closure input | Required for global consistency | Optional — BA helps even without loop closure |
| Open-source maturity | GTSAM, g2o (very mature) | BALM2 / HBA / Voxel-SLAM (mature, 2021 to 2024) |

**When to use PGO only:** real-time onboard requirements, map update frequency above 1 Hz, environments with few geometric planes (long tunnels, open fields), or when the compute budget does not allow offline BA.

**When to use BA:** offline aggregated-map build, sub-5 cm accuracy target, sufficient compute (desktop or server), enough planar structure (indoor, structured outdoor, terminal facades, taxiway edges).

**Best practice.** Run PGO after loop closure for fast global consistency, then run BA as a final refinement pass on PGO-initialized poses. This is the recommended production pipeline order.

---

## Connection to Certifiable PGO (iter-34)

Certifiable PGO (SE-Sync, TEASER++, Shonan averaging) provides global optimality guarantees for the pose-graph problem via SDP relaxation — it certifies that returned poses are the global optimum of the PGO objective.

This guarantee does not extend to LiDAR BA because:

1. The BA objective `sum_i lambda_3(A_i({T_j}))` is not a sum of squared relative-pose errors. It is a sum of smallest eigenvalues of nonlinearly coupled scatter matrices. No known SDP relaxation for this form exists.
2. The BA Hessian structure (dense, feature-coupled blocks) differs fundamentally from the sparse binary-edge Hessian of PGO.

Status as of mid-2026: certifiable LiDAR BA is an open research problem. The closest work is Eigen-Factors bilevel optimization (Autonomous Robots 2025, arXiv:2304.01055), which provides a structurally cleaner bilevel formulation but does not offer global optimality certificates. Do not overstate BALM2 or HBA guarantees — they are locally convergent methods that require good initialization.

**Practical recommendation.** Initialize BA from certifiably optimal PGO poses (TEASER++ front-end + SE-Sync backend), then run BALM2 or HBA to refine map geometry. This gives the strongest combination available: certified global pose initialization followed by geometrically tighter BA refinement. See [Certifiable Pose Graph Optimization](./certifiable-pose-graph-optimization.md) for the full certifiable PGO treatment.

---

## Benchmark Results

### KITTI Odometry (Vehicle, Velodyne HDL-64E, Sequences 00-10)

| Method | Metric | Value | Notes |
|---|---|---|---|
| MAD-BA | Average RMS (all seqs) | 1.17 mm | Best reported as of early 2025; surfel BA |
| HBA | Average RMS (all seqs) | 2.01 mm | Hierarchical BA |
| BALM2 | Average RMS (all seqs) | 2.43 mm | Flat BA with point clusters |
| BA-CLM | RMSE KITTI00 absolute | 1.23 m | Different metric — absolute trajectory in meters |
| LIO-SAM (baseline) | RMSE KITTI00 absolute | 8.02 m | PGO-only baseline for comparison |

Note: the per-sequence average RMS numbers (in mm) and absolute trajectory RMSE (in meters) use different evaluation protocols and are not directly comparable to each other.

### Hilti SLAM Challenge 2023 (Construction Site, Handheld plus Helmet)

| Result | Value |
|---|---|
| Top single-session LiDAR SLAM with BA back-end | < 2 cm ATE |
| HBA (HKU-MARS) | Runner-up, LiDAR multi-session category |
| Scoring threshold | < 0.5 cm = 20 points; > 40 cm = 0 points |

Reference: arXiv:2404.09765

### Voxel-SLAM Indoor Hilti (13 Sequences)

| Configuration | ATE Range |
|---|---|
| Full system (local BA + loop closure + global hierarchical BA) | 0.62 to 13.8 cm |
| Local BA only (no global pass) | 0.8 to 15.9 cm |

### BALM Livox Horizon (817 m Outdoor)

| Method | Relative Drift |
|---|---|
| BALM | 0.038 % |
| LOAM | 0.762 % |

Note: this comparison is on a Livox Horizon sensor and a specific 817 m outdoor sequence — not directly comparable to KITTI Velodyne numbers.

---

## Strengths and Failure Modes

### Strengths

- Eliminates residual drift that PGO cannot correct because PGO does not see inside individual ICP alignments.
- Uses all raw LiDAR geometry simultaneously rather than pairwise scan-to-scan constraints.
- BALM2's analytical elimination makes large feature sets tractable; point cluster coordinates make per-iteration cost independent of total raw point count.
- HBA's hierarchical decomposition scales to large airports and multi-kilometer survey drives.
- Continuous-time BA variants (iter-36 CT framework) handle within-scan motion distortion without a separate deskew pass.
- BALM2 provides consistent pose covariance via second-order information — important for downstream factor graph integration and safety documentation.
- Works without ground-truth targets; no external infrastructure required.

### Failure Modes

- **Poor initial poses.** BALM2 plane detection requires initial poses accurate enough for voxel association. If PGO leaves more than approximately 1 m error in any loop, a coarse-to-fine BA pass is needed before the final refinement.
- **Featureless environments.** Open airside aprons with no wall features may yield too few planar voxels for reliable BALM2 optimization. Fallback: PSS-BA (polynomial surfaces), or hybrid with camera or 4D radar as auxiliary feature source.
- **Dynamic objects.** Moving vehicles, aircraft, and ground crew create inconsistent factors. Dynamic removal (ERASOR, FreeDOM) should precede BA.
- **Scalability without hierarchical decomposition.** Flat BALM2 on more than 500 to 1000 scans produces a Hessian too large for efficient direct solving. HBA is required for large surveys.
- **No certifiability.** BA convergence depends on initialization. Unlike certifiable PGO, there is no mathematical certificate that the BA solution is globally optimal.
- **Correspondence errors.** If the initial pose is poor enough that points associate with incorrect features, BA can converge to a geometrically wrong local minimum.

---

## Domain Fit

| Domain | BA Role | Fit | Notes |
|---|---|---|---|
| Airside survey mapping | Final offline refinement step | Very high | Closes residual drift after PGO; targets < 5 cm |
| Warehouse / logistics-yard | Offline HD map production | High | Rich planar structure; ISO 3691-4 map quality |
| Road AV (HD map) | Offline map-build refinement | High | Large scale requires HBA; KITTI results demonstrate viability |
| Port / terminal mapping | Post-survey batch step | High | Structured industrial environment; scale manageable per session |
| Mining / construction survey | Post-mission refinement | Medium-high | Rough terrain; robust loss (Huber) needed; Hilti results apply |
| Agricultural mapping | Offline crop-field map | Medium | Featureless open fields degrade plane detection; PSS-BA fallback |
| Online AV runtime | Not suitable | Low | Latency: use online LIO front-end instead |
| Multi-robot fleet | Per-session offline then merge | Medium | BA per session; distributed PGO for inter-robot consistency |

---

## Aggregated-Map Suitability — Airside Survey Drive

LiDAR BA is the recommended **final offline optimization step** for building a sub-5 cm airside survey aggregated map. It follows, rather than replaces, the online odometry front-end and PGO stages.

**Production-grade recommended pipeline:**

```text
[Survey drive: spinning LiDAR (Ouster OS1/OS2) + IMU]
        |
        v
  FAST-LIO2 (LIO front-end, IEKF, 100 Hz IMU, 10 Hz scan)
  or CT-ICP (continuous-time front-end, handles motion distortion natively)
        |
        v
  Deskewing (per iter-13 rolling-shutter brief, if using FAST-LIO2 discrete-time)
        |
        v
  Keyframe selection (1 keyframe per 5 m travel or 10 degree heading change)
        |
        v
  Loop closure detection: KISS-Matcher (iter-35)
  + descriptor-based verification (STD / Scan Context)
        |
        v
  GTSAM Pose-Graph Optimization (iSAM2 incremental)
  -- optionally with certifiable initialization (TEASER++ for loop pairs)
        |
        v
  BALM2 / HBA final offline bundle adjustment
  -- plane + edge features, adaptive voxelization (0.5 to 1.0 m root voxels)
  -- sliding-window local BA (HBA submap level)
  -- global hierarchical BA
        |
        v
  Dynamic removal + semantic segmentation
        |
        v
  Output: globally consistent point-cloud map, target < 5 cm ATE
```

**Configuration notes:**

- BALM2 initial pose quality is critical: PGO provides good initialization. If any loop has more than 1 m translation error after PGO, run a coarse-to-fine BA pass before the final refinement.
- Voxel resolution for BA: 0.5 to 1.0 m root voxels, subdivided to 0.125 m minimum (BALM default). For flat apron surfaces, 1 m root voxels are appropriate; for terminal facades and jet bridges, 0.5 m.
- For very large airports (survey length more than 5 km), HBA's hierarchical decomposition is mandatory to keep Hessian size tractable.
- If the survey vehicle uses a spinning LiDAR, deskew before BA. If using CT-ICP as front-end, deskewing is implicit.
- **Alternative for open apron with insufficient planar structure:** substitute PSS-BA (polynomial surface fitting) for BALM2 in the final refinement step.

See [Loop Closure and Place Recognition](./loop-closure-place-recognition.md) for KISS-Matcher loop closure context, [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) for the front-end, and [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) for the downstream semantic annotation step.

---

## Honest Uncertainties

Three flags from the research brief that should be tracked before production commitment:

1. **No certifiable BA algorithm exists.** As of mid-2026, no LiDAR BA method provides global optimality certificates analogous to SE-Sync for PGO. BALM2 and HBA are locally convergent; their quality depends on initialization. Do not frame their outputs as certified in safety-case documentation.

2. **BALM plane detection may fail on featureless airside apron surfaces.** The adaptive voxelization requires enough planar structure to produce meaningful features. An open apron with no adjacent walls, terminal facades, or ground markings may return too few voxels. No paper in the retrieved literature tests explicitly on airport apron environments; the sub-5 cm feasibility is inferred from construction (Hilti) and urban outdoor (KITTI) results on comparable geometry. Explicit airside validation is needed before regulatory submission.

3. **MAD-BA open-source status unconfirmed.** The MAD-BA paper (arXiv:2501.03972) states open-source release; the exact GitHub repository URL was not retrievable at research time. Verify the current repository link at the arXiv page before citing or depending on MAD-BA in a pipeline.

---

## Implementation Notes

- Run dynamic-object removal (ERASOR, FreeDOM) before BA. Moving vehicles and ground crew create temporally inconsistent plane factors that can corrupt the optimization.
- Validate BALM2 initial poses: run PGO first, inspect residuals, flag any segment where ICP quality was poor (dense fog, obscured apron markings), and apply coarse-to-fine BA in those regions.
- For GTSAM integration: wrap the BALM2 or HBA cost as a single custom factor rather than generating millions of scalar residual objects; this keeps the graph size manageable.
- Record BA convergence metadata alongside each map artifact: number of iterations, final cost, number of plane and edge features, voxel occupancy. Unexpectedly high residual cost after BA is a diagnostic indicator of failed associations or dynamic contamination.
- For multi-session airside mapping, run BA independently per session, then use a distributed PGO step (see [Distributed Multi-Robot PGO](./distributed-multi-robot-pgo.md)) to align sessions before a final cross-session BA pass if desired.
- The BALM2 repository includes a virtual benchmark (`roslaunch balm2 benchmark_virtual.launch`) for validating the installation against synthetic data before applying to real surveys.
- If initial poses from PGO still leave residual error above 1 m in any loop, run one iteration of coarse BALM2 with large voxels (2 to 4 m), use the result as the new initialization, then run the full fine-resolution pass.
- For lifelong mapping workflows (repeated resurvey of the same airside area), pair BA with the change-detection pipeline described in [LT-Mapper / Khronos Lifelong Mapping](./lt-mapper-khronos-lifelong-mapping.md): BA produces the reference map; subsequent survey sessions are registered to it and diffed for change detection.

---

## Sources

| Resource | URL |
|---|---|
| BALM (RAL 2021) — arXiv | https://arxiv.org/abs/2010.08215 |
| BALM IEEE Xplore | https://ieeexplore.ieee.org/document/9361125 |
| BALM / BALM2 GitHub | https://github.com/hku-mars/BALM |
| BALM2 (TRO 2023) — arXiv | https://arxiv.org/abs/2209.08854 |
| HBA (RAL 2023) — arXiv | https://arxiv.org/abs/2209.11939 |
| HBA GitHub | https://github.com/hku-mars/HBA |
| Voxel-SLAM (2024) — arXiv | https://arxiv.org/abs/2410.08935 |
| MAD-BA (RA-L 2025) — arXiv | https://arxiv.org/abs/2501.03972 |
| BA-LINS (2024) — arXiv | https://arxiv.org/abs/2401.11491 |
| BA-CLM (Sensors 2024) | https://www.mdpi.com/1424-8220/24/17/5554 |
| BA-CLM — PMC | https://pmc.ncbi.nlm.nih.gov/articles/PMC11398242/ |
| PSS-BA (2024) — arXiv | https://arxiv.org/abs/2403.06124 |
| Graph Optimality + PSS-BA (2024) | https://arxiv.org/abs/2410.14565 |
| CT LiDAR BA — arXiv (2024) | https://arxiv.org/abs/2412.11760 |
| Consistency-Improved LIO-BA (2026) | https://arxiv.org/abs/2602.06380 |
| Eigen-Factors bilevel (Auton. Robots 2025) — arXiv | https://arxiv.org/abs/2304.01055 |
| Cartographer (ICRA 2016) | https://research.google.com/pubs/archive/45466.pdf |
| LOAM (RSS 2014) | https://www.ri.cmu.edu/publications/loam-lidar-odometry-and-mapping-in-real-time/ |
| SuMa (RSS 2018) GitHub | https://github.com/jbehley/SuMa |
| Hilti SLAM Challenge 2023 — arXiv | https://arxiv.org/abs/2404.09765 |
| Hilti 2023 leaderboard | https://hilti-challenge.com/leaderboard-2023 |
| gtsam_points GitHub | https://github.com/koide3/gtsam_points |
| Koide et al., GPU-accelerated GICP (RA-L 2021) | https://doi.org/10.1109/LRA.2021.3059587 |
