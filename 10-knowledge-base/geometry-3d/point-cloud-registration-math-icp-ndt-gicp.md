# Point Cloud Registration Math: ICP, GICP, VGICP, and NDT

<!-- kb-visual:start -->
![Point Cloud Registration Math: ICP, GICP, VGICP, and NDT curated visual](../_assets/visuals/geometry-3d-point-cloud-registration-math-icp-ndt-gicp.svg)

*Visual: registration iteration loop comparing ICP correspondences, GICP covariances, NDT grid cells, residual model, solve step, and local-minimum failure.*
<!-- kb-visual:end -->

Point cloud registration estimates the rigid transform that aligns one scan or
submap to another. The core problem is geometric maximum likelihood under
uncertain correspondences. ICP assigns nearest-neighbor correspondences and
optimizes a distance metric. GICP adds local surface covariance. VGICP
voxelizes GICP-style distributions for speed. NDT represents space as voxel
Gaussians and optimizes the probability of transformed points under those
distributions. For aggregated multi-scan maps, registration is not an auxiliary
step — it is the map construction mechanism itself: every pose in the trajectory
graph is the output of a registration solve, and every segmentation result
downstream is gated on the registration accuracy achieved here.

---

## 1. Related Docs

- [LiDAR Working Principles and Noise Models](lidar-working-principles-noise-models.md)
- [Correspondence Search Data Structures](correspondence-search-data-structures.md) — kNN and voxel hashing are the inner loop of every ICP family method
- [Lie Groups SE(3), SO(3), Adjoints, and Jacobians](lie-groups-se3-so3-jacobians.md)
- [Coordinate Frames, Projections, and SE(3)](coordinate-frames-projections-se3.md)
- [Rolling Shutter / LiDAR Deskew and Motion Distortion](rolling-shutter-lidar-deskew-motion-distortion.md) — motion distortion must be corrected before registration
- [Aggregated-Map Semantic Segmentation — §1.1 map construction](../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md) — the aggregated map produced here is the direct input to the segmentation pipeline

---

## 2. Why It Matters for AV, Perception, SLAM, and Mapping

| Workflow | Registration role | Risk if wrong |
|---|---|---|
| LiDAR odometry | Register current scan to previous scan or local map. | Drift grows in corridors, flat roads, rain, or dynamic traffic. |
| Localization | Match live LiDAR to prior map. | Vehicle localizes to a nearby but incorrect lane or structure. |
| HD mapping | Align passes into consistent submaps. | Ghost curbs, duplicated poles, and blurred lane boundaries. |
| Aggregated-map segmentation | Every scan pose comes from registration; map is re-aggregated on corrected poses. | Sub-5 cm ATE is the practitioner target; at ~10 cm error, thin-class IoU degrades sharply (⚠️ practitioner threshold — see §11). |
| Multi-sensor calibration | Align overlapping LiDARs or depth sensors. | Extrinsic bias propagates into fusion and labeling. |
| Change detection | Compare live scan to map. | Registration residual is mistaken for scene change. |
| Airside apron mapping | Align repeated survey passes, docking structures, jetways. | Symmetric apron geometry causes false loop closures; dynamic aircraft contaminate the static map. |

---

## 3. The Registration Problem

Given a **source** cloud `P = {p_i}` and a **target** `Q = {q_j}`, find
`T ∈ SE(3)` (rotation `R ∈ SO(3)`, translation `t ∈ R^3`) minimising:

```text
T* = arg min_T  sum_i  d(T p_i, Q)^2
```

The distance function `d(·, Q)` distinguishes every algorithm family:

| Variant | d(·) | Inner solve | Convergence |
|---|---|---|---|
| Point-to-point ICP | norm(T p_i − q_i) | SVD (Horn 1987) | Linear |
| Point-to-plane ICP | (T p_i − q_i) · n_i | 6×6 linear LS (Chen & Medioni 1991) | Faster on planes |
| GICP | Mahalanobis under local covariances | BFGS | Superlinear |
| NDT | Neg. log-likelihood under voxel Gaussians | Newton | Smooth landscape |
| VGICP | Mahalanobis, voxel-aggregated covariances | Gauss-Newton / GPU | 30 Hz capable |

The problem is **non-convex**; all methods converge only within a basin of
attraction. An initial prior from IMU, odometry, or global registration is
required. Point-to-point ICP needs orientation error roughly below 30°; NDT's
smooth Gaussian landscape extends the basin further. Optimization perturbs T on
the SE(3) manifold (`T_new = Exp(delta) * T` or right-perturbation form) so the
update remains a valid rigid transform; Jacobians must match the convention. See
[Lie Groups SE(3), SO(3), Adjoints, and Jacobians](lie-groups-se3-so3-jacobians.md).

---

## 4. Classical ICP (Besl & McKay 1992)

```text
Input: P (source), Q (target), T_init
1. Apply T_init to P -> P'
2. Repeat:
   a. DATA ASSOCIATION:  for each p'_i find q_i = NN(p'_i, Q)
   b. OUTLIER REJECTION: discard pairs with norm(p'_i - q_i) > tau
   c. SOLVE:             compute T_step minimising sum d(T_step p'_i, q_i)^2
   d. UPDATE:            P' <- T_step * P'
3. Until norm(T_step - I) < eps or max_iter reached
```

**Data association**: k-d tree (O(log N) per query) on the target; voxel hashing
for large maps (O(1) lookup). Besl & McKay found ~95% of run-time is in NN search
— see [Correspondence Search Data Structures](correspondence-search-data-structures.md)
for k-d tree variants, ANN, and ikd-Tree (FAST-LIO2).

**Outlier rejection**: distance threshold tau (KISS-ICP adapts to 3σ of current
residuals); normal compatibility (reject pairs with normal angle > 45°); reciprocal
correspondences (keep only mutual-best matches); **Trimmed ICP / TrICP
(Chetverikov et al. 2002)** — minimise only the lowest-rho fraction of pairs,
effective for partial-overlap loop closure.

**Closed-form solve (Horn 1987 / Kabsch SVD)**: with fixed correspondences,
demean both sets, form 3×3 cross-covariance H:

```text
H  = sum_i  (p_i - p_bar) * (q_i - q_bar)^T
[U S V^T] = svd(H)
R* = V U^T        (flip last column of V if det(R*) < 0)
t* = q_bar - R* p_bar
```

O(N) once correspondences are known. **Convergence**: monotonically non-increasing
error per iteration (proof in Besl & McKay 1992); linear convergence, typically
10–50 outer iterations. Local minima at ambiguous geometry: symmetric apron
concrete, long taxiways, equally-spaced runway lights.

---

## 5. Error Metrics: Point-to-Point, Point-to-Plane, and Symmetric

### 5.1 Point-to-Point

```text
E_pp = sum_i norm(R p_i + t - q_i)^2
```

Pros: closed form via SVD; no normals required.
Cons: slow convergence on planar surfaces; very sensitive to initial pose;
sliding along a plane is penalized as strongly as motion perpendicular to it.

### 5.2 Point-to-Plane (Chen & Medioni 1991)

```text
E_pn = sum_i [(R p_i + t - q_i) · n_i]^2
```

where `n_i` is the surface normal at target point `q_i`. Linearise the
rotation as `R ≈ I + [omega]_x` (small-angle approximation, omega ∈ R^3 is
the axis-angle). Substituting produces a **6×6 linear least-squares** system
in `x = [omega_1 omega_2 omega_3 t_1 t_2 t_3]^T`:

```text
A x = b

Each row (one correspondence):
  a_i = [ (p_i × n_i)^T,  n_i^T ]     (1×6)
  b_i = (q_i - p_i) · n_i              (scalar)
```

Solve by `(A^T A) x = A^T b` or by QR. The linearisation is valid per
iteration; large displacements require re-linearising at each step. On planar
surfaces, point-to-plane converges **2–3 times faster** than point-to-point
because motion tangent to the surface is unconstrained (zero gradient), and
only the normal component is minimized. Standard choice for structured
environments: floors, walls, taxiway markings, jetway faces.

### 5.3 Symmetric ICP (Rusinkiewicz 2019)

Uses normals from **both** source and target:

```text
E_sym = sum_i [(R p_i + t - q_i) · (n_pi + n_qi)]^2
```

The symmetric Jacobian has a wider convergence basin and faster convergence
than either point-to-point or point-to-plane at comparable computational cost.
Exact under perfect correspondences. Particularly useful when both clouds have
comparable quality normals, as in scan-to-submap matching with dense overlap.

---

## 6. GICP — Generalized ICP (Segal, Haehnel & Thrun 2009)

Each point `a_i` in source A is modelled with local Gaussian mean `mu_i^A`
and covariance `C_i^A` (from k-NN). Likewise for target B. The GICP objective:

```text
T* = arg min_T  sum_i  (d_i)^T  [C_i^B + T C_i^A T^T]^{-1}  d_i
     where  d_i = mu_i^B - T mu_i^A
```

This is a **Mahalanobis distance** over both clouds' uncertainty. The combined
covariance is held constant per inner step (IRLS reweighting).

**GICP unifies prior metrics** by choice of covariance shape:

| C_i^A and C_i^B | Reduces to |
|---|---|
| lambda * I (isotropic) | Point-to-point ICP |
| diag(eps, 1, 1), eps → 0 (planar patch normal-to-surface) | Point-to-plane ICP |
| Full eigendecomposed neighbourhood covariance | GICP plane-to-plane |

Covariance is estimated via eigendecomposition of the k-neighbourhood; the
eigenvalue along the surface normal is set to a small constant (e.g., 0.001).
**Optimisation**: BFGS with FLANN k-d tree (PCL); superlinear convergence;
superior accuracy on structured environments.
**Cons**: O(kN) covariance estimation; BFGS stalls on degenerate flat geometry.

---

## 7. NDT — Normal Distributions Transform (Biber & Strasser 2003)

### 7.1 Target Model

Voxelize the **target** cloud Q into a regular 3D grid. For each occupied
voxel c containing n_c points, compute:

```text
mu_c    = (1/n_c) * sum_{x in c}  x
Sigma_c = (1/n_c) * sum_{x in c}  (x - mu_c)(x - mu_c)^T
```

The voxel represents a smooth local density:

```text
p_c(x)  proportional to  exp(-0.5 * (x - mu_c)^T Sigma_c^{-1} (x - mu_c))
```

### 7.2 Objective

Find T = (R, t) that maximises the log-likelihood of the source cloud P under
the target NDT:

```text
T* = arg min_{R,t}  -sum_i  exp(-0.5 * (T p_i - mu_{c(i)})^T Sigma_{c(i)}^{-1} (T p_i - mu_{c(i)}))
```

where `c(i)` is the voxel containing `T p_i`. No explicit point-to-point
correspondence is formed; a source point "votes" for the Gaussian of whichever
voxel it falls into. This is the fundamental difference from the ICP family:
the association is voxel-level, not point-level.

### 7.3 Optimisation

Newton's method (as derived in Magnusson's 2009 PhD thesis, 3D-NDT). Gradient
and Hessian are computed analytically per source point. Step size is controlled
by a line search. To reduce discretisation sensitivity, the 2D implementation
used 4 overlapping grids (shifted by half the cell size in each dimension); in
3D this generalises to 8 overlapping voxel grids.

### 7.4 Properties and Tradeoffs

- **Larger basin of attraction** than ICP: a source point contributes a
  nonzero gradient even when it falls into the "wrong" voxel, because the
  Gaussian score decays smoothly rather than jumping to zero at a threshold.
- **O(1) query**: correspondence is a voxel hash lookup, not a k-d tree search.
  This is faster than ICP at high point densities.
- **Sensitive to voxel size**: too large loses fine structure; too small
  produces underpopulated voxels with unstable covariance estimates.
- Competitive with ICP on runtime; often faster when point density is high and
  the k-d tree query budget dominates ICP.
- 3D-NDT is implemented in PCL (`pcl::NormalDistributionsTransform`) and in
  `ndt_omp` (Koide's OpenMP multi-thread fork, 4–10× speed-up).

---

## 8. VGICP — Voxelized GICP (Koide et al. 2021, ICRA)

### 8.1 Motivation

Vanilla GICP's bottleneck is per-point k-d tree lookup (O(log N) per query)
for both correspondence finding and per-point covariance estimation. VGICP
**voxelizes the target** to remove the k-d tree from the inner loop entirely.

### 8.2 Objective

```text
T* = arg min_T  sum_i  (mu_i^{A'} - mu_{c(i)}^B)^T  (C_i^{A'} + C_{c(i)}^B)^{-1}  (mu_i^{A'} - mu_{c(i)}^B)

where:
  mu_i^{A'}    = R mu_i^A + t          (transformed source point mean)
  C_i^{A'}     = R C_i^A R^T           (transformed source covariance)
  mu_{c(i)}^B, C_{c(i)}^B = precomputed voxel mean and covariance of target voxel c(i)
```

**Key difference from NDT**: NDT computes each voxel's distribution purely
from point positions within the voxel. VGICP aggregates the distribution of
each individual source point (with its own covariance) into the target voxel
bookkeeping, so the voxel covariance captures genuine surface orientation even
at low point density. This makes VGICP covariance estimates more stable than
NDT at the edges of lidar coverage.

### 8.3 Performance (Koide et al. 2021 on KITTI)

| Configuration | Latency | Notes |
|---|---|---|
| CPU single thread | ~33 ms/scan | Accuracy equivalent to GICP |
| CPU multi-thread (OMP/TBB) | ~8 ms/scan | 30 Hz real-time |
| GPU (CUDA) | ~6 ms/scan | 120 Hz; suitable for on-vehicle mapping |

VGICP is the practical scan-matching core of many modern LiDAR-inertial
odometry systems. FAST-LIO2 uses a related incremental k-d tree (ikd-Tree)
variant; LIO-SAM uses a voxel-map operator. The small_gicp library (JOSS 2024)
provides a header-only C++ implementation with TBB/OMP multi-thread scaling
up to 128 threads.

---

## 9. Global / Coarse Alignment

Local methods (ICP, NDT, GICP) require the initial pose error to be inside
their basin of attraction. When the error is large — loop closure candidate
from place recognition, first-flight map initialisation, or recovery from
localisation loss — a **global registration** step provides a coarse prior.

### 9.1 FPFH + RANSAC

1. Downsample both clouds; estimate normals.
2. Compute **Fast Point Feature Histograms** (FPFH, 33-dimensional) at each
   keypoint.
3. Match features by nearest-neighbor in descriptor space.
4. **RANSAC**: sample 3 correspondences, estimate T via SVD, count inliers
   (distance to transformed source below tau); repeat 50k–1M iterations.
5. Return best-inlier T as prior for ICP or GICP refinement.

Robust to roughly 70–80% outlier correspondences; slow due to RANSAC
iterations. Open3D: `registration_ransac_based_on_feature_matching()`.

### 9.2 FastGlobalRegistration (Zhou, Park & Koltun, ECCV 2016)

Replaces RANSAC with a **scaled Geman-McClure robust estimator** on the
feature-matched correspondence set. Optimises without sampling, approximately
100× faster than RANSAC at comparable accuracy. No RANSAC hyperparameters.

### 9.3 TEASER / TEASER++ (Yang et al. 2020)

Decouples registration into scale → translation → rotation sub-problems;
solves each via Graduated Non-Convexity (GNC) or SDP relaxation. Tolerates
up to **99% outlier correspondences**. Provides a **certificate of global
optimality** — the first algorithm to do so — via the SDP bound. Higher
computational cost than FGR but dramatically more robust; preferred when the
place recognition module may produce many false correspondence seeds.

### 9.4 Learned Global Registration

**DGR (Choy et al., CVPR 2020):** FCGF features → 6D conv inlier/outlier
confidence → differentiable Weighted Procrustes → SE(3) refinement.

**PREDATOR (Huang et al., CVPR 2021 Oral):** overlap-attention conditions each
cloud's encoding on the other; raises recall on low-overlap 3DLoMatch by >20%.

**GeoTransformer (Qin et al., CVPR 2022):** transformer on pairwise distances
and triplet angles; superpoint matching without RANSAC; ~100× faster than
RANSAC-based learned methods; 17–30 pp inlier-ratio gain on 3DLoMatch.

All three require domain-transfer validation before airside deployment (trained
on indoor RGB-D benchmarks with different density and reflectance statistics).

---

## 10. Robust Loss / Outlier Handling

Pure LS `sum_i r_i^2` is dominated by dynamic objects, multi-path returns,
and vegetation. **M-estimators** replace the quadratic with `rho(norm(r_i)/sigma)`:

| Kernel | Behaviour |
|---|---|
| Huber | Quadratic near 0, linear beyond k — the standard robust choice |
| Tukey biweight | **Zero weight** beyond sigma — hard truncation |
| Geman-McClure | Aggressive suppression; near-zero weight for large residuals; used in FGR and TEASER++ |
| Cauchy / Welsch | Heavy-tailed variants; smooth down-weighting |

**Graduated Non-Convexity (GNC)**: start with a convex surrogate (Huber-like)
and progressively tighten toward Geman-McClure or Tukey. Used in FGR and
TEASER++ to avoid local minima during annealing.

**KISS-ICP adaptive threshold**: estimates sigma adaptively from the 3σ of the
current residual distribution; works without scene-specific tuning.

Additional rejection: **reciprocal correspondences** (keep (p_i, q_j) only if
q_j is also the nearest neighbor of p_i in source); **normal compatibility
filter** (reject pairs with angle(n_i, n_j) > 30–45°, essential at edges).

---

## 11. Aggregated Map Building — Registration as the Map Foundation

This section is the primary reason this page exists in the knowledge base:
registration is not background math for SLAM. It is the pipeline step that
constructs the aggregated map which the segmentation network operates on.

### 11.1 Full Pipeline

```text
Raw scans
  -> [Motion deskew (IMU pre-integration or CT-ICP)]
  -> [Scan-to-local-map registration (VGICP or NDT-OMP at 30 Hz)]
  -> [Incremental pose graph update (GTSAM iSAM2)]
  -> [Loop closure detection (Scan Context / OverlapNet)]
  -> [Loop closure re-registration (GICP + robust kernel)]
  -> [Pose graph optimisation (iSAM2 or g2o)]
  -> Globally consistent pose trajectory
  -> [Re-aggregate raw scans using corrected poses]
  -> Aggregated multi-scan map
  -> [Segmentation network inference (§1.1 aggregated-map-semantic-segmentation.md)]
```

### 11.2 Accuracy Target and the Registration-to-Segmentation Chain

Segmentation performance is **map-quality-gated**. Practitioners and survey
mapping literature consistently cite **sub-5 cm absolute trajectory error
(ATE)** as the target for HD LiDAR maps used for semantic labelling. ⚠️ The
specific claim that ~10 cm registration error causes sharp thin-class IoU
degradation (poles, kerb edges, airside ground markings) appears in field
reports but was not confirmed in a peer-reviewed paper during research for
this page. Treat both numbers as practitioner guidance requiring verification.

LiDAR survey systems can reach sub-centimetre accuracy. Commercial mobile
LiDAR with IMU plus post-processing SLAM achieves 2–5 cm ATE. The chain from
registration error to segmentation degradation is:

1. Scan-to-scan odometry errors accumulate into trajectory drift.
2. Without loop closure, drift appears as **ghosting** — two copies of the
   same structure separated by the drift distance.
3. Ghosted structures create **mixed-class voxels** at class boundaries; the
   segmentation network sees geometrically ambiguous input.
4. Loop closure plus pose graph optimisation distributes the correction,
   producing a consistent trajectory.
5. Re-aggregating raw scans from corrected poses (rather than using the
   incrementally built map) further sharpens voxel occupancy.

### 11.3 Recommendation Table for Airside Map Building

| Phase | Recommended method | Rationale |
|---|---|---|
| Deskewing | IMU pre-integration or CT-ICP | Airside vehicles move continuously; spinning LiDAR accumulates 3–5 cm beam displacement per scan at 20 km/h |
| Scan-to-local-map | VGICP or NDT-OMP | 30 Hz capable on CPU; handles planar taxiway surfaces; O(1) voxel lookup |
| Loop closure detection | Scan Context or OverlapNet | Rotation-invariant; robust to repeated structure (runway lights, stands) |
| Loop closure registration | GICP with robust kernel | Coarse pose from place recognition; GICP accuracy exceeds NDT for large relative rotations |
| Pose graph backend | GTSAM iSAM2 or g2o | Real-time incremental; supports GPS/GNSS absolute pose factors |
| Global coarse init | FPFH + FGR or TEASER++ | Used for first-flight or map re-initialisation only |

### 11.4 LiDAR-IMU and Airside Considerations

IMU provides three independent benefits: (1) coarse pose prior per scan extends
the VGICP/NDT-OMP basin of attraction; (2) per-point deskewing sharpens target
geometry (see [Rolling Shutter / LiDAR Deskew](rolling-shutter-lidar-deskew-motion-distortion.md));
(3) gravity direction constrains roll/pitch drift. Tight coupling (FAST-LIO2,
LIO-SAM) fuses IMU pre-integration into the same factor graph. On flat aprons,
IMU is essential for yaw during featureless straight segments — point-to-plane
on level concrete has no yaw gradient.

Airside-specific map considerations:
- **Taxiway markings** (5–30 cm wide) require map resolution ≤ 2.5 cm and ATE
  ≤ 5 cm; above 5 cm the marking smears into surrounding pavement voxels.
- **Apron clutter** (GSE, aircraft, jetways): use robust kernel or trimmed ICP
  with a dynamic-object pre-pass to keep moving vehicles out of the static map.
- **Open concrete**: add GPS/GNSS absolute pose factors; no scan-matching method
  recovers yaw drift on featureless flat surfaces alone.
- **Repeated structure** (runway lights, identical gate stands): use Scan Context
  or OverlapNet (density-pattern descriptors) over histogram methods; false loop
  closures from identical structure corrupt entire map segments.

---

## 12. Pose-Graph Optimisation and Loop Closure

Sequential scan-matching accumulates drift. A **pose graph** treats each
registration result as a soft edge constraint and jointly optimises all poses.

**Nodes**: poses `T_k ∈ SE(3)`, one per scan keyframe.
**Edges**: relative transform constraints `T_{ij}` from scan matching, weighted
by information matrix `Omega_{ij} = registration_covariance^{-1}`.
**Objective** (MAP, least squares on the manifold):

```text
T* = arg min_T  sum_{(i,j) in E}  norm( log(T_i^{-1} T_{ij} T_j) )^2_{Omega_{ij}}
```

**Loop closure**: when the vehicle revisits a prior location, a place recognition
module (Scan Context, OverlapNet, or learned embedding) detects the candidate;
GICP or NDT re-registers the pair with a robust kernel; the resulting constraint
closes drift accumulated over the loop. False loop closures from repeated apron
geometry are a primary failure risk; mutual-best-match verification mitigates this.

**Solvers**: **g2o** (sparse Cholesky, batch; used in LeGO-LOAM); **GTSAM / iSAM2**
(factor graph, incremental O(affected variables) per new factor, GPS/IMU factors;
used in LIO-SAM); **Ceres** (custom cost functors, robust kernel integration).

⚠️ True LiDAR bundle adjustment (jointly optimising poses and map points) is
less mature than visual BA. Pose graph + loop closure + raw-scan re-aggregation
is the current production approach.

---

## 13. Continuous-Time and Motion-Deskew Registration

A spinning LiDAR (e.g., Velodyne HDL-64E) completes one revolution in ~100 ms.
A vehicle at 20 km/h travels ~56 cm in that time, so each beam is acquired at a
different sensor pose. Treating the entire scan as rigid causes **motion blur** in
the map — a key source of thin-object IoU degradation. Full treatment in
[Rolling Shutter / LiDAR Deskew](rolling-shutter-lidar-deskew-motion-distortion.md).

**Discrete deskewing (KISS-ICP)**: warp each point from its acquisition timestamp
to the scan-end timestamp using a constant-velocity model or IMU pre-integration.
Simple and effective at moderate speeds; degrades at sharp manoeuvres.

**CT-ICP (Dellenbach et al. 2022)**: represent the trajectory within a scan as a
smooth SE(3) curve parameterised by two keyframe poses (scan-start and scan-end).
Each point `p_i` is transformed by its per-timestamp interpolated pose:

```text
T(t_i) = T_start  oplus  (t_i / T_scan) * (T_end  ominus  T_start)
E_CT   = sum_i  rho( [(T(t_i) p_i - q_{NN(i)}) · n_{NN(i)}] )
```

Inter-scan discontinuities preserve robustness to vibrations. CT-ICP ranked first
on KITTI odometry among open-code systems at publication (0.59% RTE).

⚠️ Gaussian Process motion priors (CT-LIO, CP-LIO) are more principled but
computationally heavier; research-grade as of 2025.

---

## 14. Algorithm Steps

**ICP family (general):**
1. Remove invalid returns; crop to overlapping region.
2. Deskew source scan using ego-motion and timestamps.
3. Downsample with voxel grids; preserve edges if needed.
4. Estimate normals and local covariances at appropriate radius.
5. Initialize from odometry, IMU pre-integration, GNSS/INS, or global registration.
6. Assign correspondences (k-d tree, projective, or voxel association).
7. Reject outliers by distance, normal angle, semantic class, or robust weighting.
8. Solve SE(3) update (SVD / linear LS / BFGS / Gauss-Newton); apply via manifold update.
9. Repeat until update norm, cost change, or iteration budget stops.
10. Report fitness score, inlier RMSE, overlap ratio, Hessian condition number.

**NDT:**
1. Build voxel grid over target; keep voxels with ≥5–7 points.
2. Regularize covariances (add epsilon × I to avoid singularity).
3. Transform source points; look up containing voxel.
4. Accumulate likelihood, gradient, and Hessian per source point.
5. Newton step with line search; validate by score and step length.

---

## 15. Implementation Libraries

| Library | What it provides |
|---|---|
| **PCL** `pcl::IterativeClosestPoint` / `WithNormals` / `GeneralizedICP` / `NormalDistributionsTransform` | Reference implementations; single-threaded; good for prototyping. [ICP tutorial](https://pcl.readthedocs.io/projects/tutorials/en/latest/interactive_icp.html) |
| **Open3D** `registration_icp` / `registration_colored_icp` / `registration_ransac_based_on_feature_matching` / `registration_fgr_based_on_feature_matching` | Python + C++ + CUDA; covers ICP variants, GICP, coloured ICP, global alignment. [docs](https://www.open3d.org/docs/latest/tutorial/pipelines/icp_registration.html) |
| **KISS-ICP** | Minimal sensor-agnostic LiDAR odometry: point-to-point ICP + adaptive Huber threshold + voxel map + constant-velocity deskewing; works across Velodyne/Ouster/Livox without tuning. [GitHub](https://github.com/PRBonn/kiss-icp) |
| **fast_gicp / small_gicp** (Koide) | Multi-thread GICP, VGICP, CUDA; small_gicp is header-only C++17, ~2.4× faster than PCL GICP single-thread, scales to 128 OMP/TBB threads, Python bindings. KITTI seq-00 APE ≈ 6.1 m (odometry only; needs pose-graph backend for map accuracy). [small_gicp](https://github.com/koide3/small_gicp) |
| **GTSAM / iSAM2** | Factor-graph backend: SE3 pose nodes, BetweenFactor (registration), ImuFactor, GPSFactor; incremental O(affected variables) updates. Used in LIO-SAM. |
| **libpointmatcher** | Modular ICP pipeline with pluggable matchers and outlier filters (TrimmedDist, MedianDist, VarTrimmedDist); backed by libnabo. [Outlier filter docs](https://libpointmatcher.readthedocs.io/en/latest/OutlierFiltersFamilies/) |

---

## 16. Implementation Notes

- Registration is local; a poor initial guess can converge to a plausible but
  wrong alignment with no error signal. Always provide a prior.
- Use multi-resolution matching: coarse voxels first, then fine alignment.
- Deskew spinning LiDAR scans before registration; otherwise the optimizer
  attributes motion distortion to pose error and biases the transform.
- Remove dynamic objects or reduce their weight using semantics, tracking, or
  temporal persistence scoring. At airside locations, aircraft near gates are
  the dominant contamination source.
- Set robust-loss sigma and maximum correspondence distance from the sensor
  noise model — see [LiDAR Working Principles and Noise Models](lidar-working-principles-noise-models.md).
- Monitor Hessian eigenvalues; flat apron and long taxiways leave yaw weakly
  constrained — add GPS absolute factors in these segments.
- Store the transform direction explicitly (e.g., `T_map_lidar`) to avoid
  inversion bugs downstream.
- For map building, re-aggregate raw scans from corrected poses after pose graph
  optimisation rather than using the incrementally built map, which carries
  accumulated uncertainty from every intermediate registration.

---

## 17. Failure Modes and Diagnostics

| Symptom | Likely cause | Diagnostic |
|---|---|---|
| Converges to the wrong lane or wall | Initialization outside basin of attraction or repeated geometry | Run multiple seeds; compare score, overlap, and semantic consistency |
| Strong yaw drift on flat taxiways | Geometry weakly constrains yaw; normals are near-vertical everywhere | Inspect Hessian eigenvalues; add GPS absolute factor; use buildings/jetways as anchor |
| Alignment looks good visually but map is blurred over time | Small systematic extrinsic bias or deskew error | Compare residual direction versus azimuth, range, and scan time; check calibration |
| NDT jumps between poses | Voxel resolution too coarse or too fine; underpopulated voxels | Sweep resolution; plot score landscape around estimate; check voxel point counts |
| ICP slows or diverges in traffic | Dynamic objects dominate correspondences | Segment moving actors; compare registration with and without them |
| Point-to-plane residual biased near edges | Normals estimated across discontinuities | Visualize normals; reject high-curvature or mixed-neighbourhood points |
| Ghost structures in aggregated map | Loop closure missed; drift not corrected | Check place recognition recall; verify loop closure registration fitness |
| False loop closure corrupts map | Repeated geometry (runway lights) triggers wrong match | Verify loop closure with mutual best-match criterion; use stricter inlier ratio threshold |
| Thin markings (taxiway lines) disappear in aggregated map | ATE above 5 cm; voxel size too coarse | Reduce voxel size to 2–3 cm; verify ATE before running segmentation |

---

## 18. Sources

- P. J. Besl and N. D. McKay, "A Method for Registration of 3-D Shapes": https://doi.org/10.1117/12.57955
- Y.-C. Chen and G. Medioni, "Object modelling by registration of multiple range images" (point-to-plane ICP): https://doi.org/10.1016/0262-8856(92)90066-C
- B. K. P. Horn, "Closed-form solution of absolute orientation using unit quaternions" (SVD closed form): https://doi.org/10.1364/JOSAA.4.000629
- Szymon Rusinkiewicz and Marc Levoy, "Efficient Variants of the ICP Algorithm": https://www.cs.princeton.edu/~smr/papers/fasticp/fasticp_paper.pdf
- S. Rusinkiewicz, "A Symmetric Objective Function for ICP" (2019): https://gfx.cs.princeton.edu/pubs/Rusinkiewicz_2019_ASO/symm_icp.pdf
- Aleksandr Segal, Dirk Haehnel, and Sebastian Thrun, "Generalized-ICP" (RSS 2009): https://www.roboticsproceedings.org/rss05/p21.pdf
- Peter Biber and Wolfgang Strasser, "The Normal Distributions Transform" (2003): https://www.researchgate.net/publication/4045903_The_Normal_Distributions_Transform_A_New_Approach_to_Laser_Scan_Matching
- M. Magnusson, "The Three-Dimensional Normal-Distributions Transform" (2009 PhD thesis): https://www.diva-portal.org/smash/get/diva2:276162/FULLTEXT02.pdf
- Kenji Koide et al., "Voxelized GICP for Fast and Accurate 3D Point Cloud Registration" (ICRA 2021): https://staff.aist.go.jp/shuji.oishi/assets/papers/preprint/VoxelGICP_ICRA2021.pdf
- Kenji Koide, "small_gicp: Efficient and parallel algorithms for point cloud registration" (JOSS 2024): https://joss.theoj.org/papers/10.21105/joss.06948
- D. Dellenbach et al., "CT-ICP: Real-Time Elastic LiDAR Odometry" (ICRA 2022): https://arxiv.org/abs/2109.12979
- W. Xu and F. Zhang, "FAST-LIO2: Fast Direct LiDAR-Inertial Odometry": https://arxiv.org/abs/2010.08196
- T. Shan et al., "LIO-SAM: Tightly-coupled Lidar Inertial Odometry via Smoothing and Mapping": https://arxiv.org/abs/2007.00258
- Heng Yang et al., "TEASER: Fast and Certifiable Point Cloud Registration": https://arxiv.org/abs/2001.07715
- Q.-Y. Zhou, J. Park, and V. Koltun, "Fast Global Registration" (ECCV 2016): https://github.com/isl-org/FastGlobalRegistration
- C. Choy et al., "Deep Global Registration" (CVPR 2020): https://github.com/chrischoy/DeepGlobalRegistration
- S. Huang et al., "PREDATOR: Registration of 3D Point Clouds with Low Overlap" (CVPR 2021): https://overlappredator.github.io/
- Z. Qin et al., "GeoTransformer: Fast and Robust Point Cloud Registration" (CVPR 2022): https://arxiv.org/abs/2308.03768
- KISS-ICP (Vizzo et al., 2023): https://arxiv.org/abs/2209.15397
- PCL GeneralizedIterativeClosestPoint documentation: https://pointclouds.org/documentation/classpcl_1_1_generalized_iterative_closest_point.html
- PCL Normal Distributions Transform tutorial: https://pcl-docs.readthedocs.io/en/latest/pcl/doc/tutorials/content/normal_distributions_transform.html
- Open3D ICP registration tutorial: https://www.open3d.org/docs/release/tutorial/pipelines/icp_registration.html
- Analysis of robust functions for registration (Babin et al., 2018): https://arxiv.org/pdf/1810.01474
