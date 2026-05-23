# Certifiable Pose Graph Optimization

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "architecture-pattern"
  stage: "modern-core"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "validation", "runtime-localization"]
  reason: "Certifiable Pose Graph Optimization is rated for robust or collaborative backend design in multi-session SLAM and validation."
method-priority:end -->

Related docs: [GraphSLAM and Pose Graph Optimization](graphslam-pose-graph-optimization.md) · [Robust Pose Graph Optimization with GNC and riSAM](robust-pgo-gnc-risam.md) · [Kimera-RPGO and PCM](./kimera-rpgo-pcm.md) · [Distributed Multi-Robot PGO](./distributed-multi-robot-pgo.md) · [Kimera-Multi](./kimera-multi.md) · [Loop Closure and Place Recognition](./loop-closure-place-recognition.md) · [Multi-Agent Neural Gaussian SLAM](./multi-agent-neural-gaussian-slam.md) · [KISS-SLAM](./kiss-slam.md) · [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) · [LT-Mapper / Khronos Lifelong Mapping](./lt-mapper-khronos-lifelong-mapping.md) · [LiDAR Bundle Adjustment Factors](./lidar-bundle-adjustment-factors.md) · [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [Lie Groups SE(3)/SO(3) Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) · [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md) · [Multi-Sensor Calibration and Observability](../../../10-knowledge-base/geometry-3d/multi-sensor-calibration-observability.md)

**Last updated:** 2026-05-24

---

## What It Is

Certifiable pose-graph optimization (certifiable PGO) is a family of SLAM backends that asks a strictly stronger question than classical backends: not only "what trajectory minimizes the graph cost?" but "can we prove this solution is the globally optimal solution for that cost?" Pose-graph optimization is non-convex because rotations live on the manifold SO(d). Classical solvers — **g2o**, **GTSAM-iSAM2**, **Ceres Solver** — minimize the graph cost via Gauss-Newton, Levenberg-Marquardt, or dogleg trust-region and converge to a **local optimum** that depends on initialization. For well-initialized, low-noise graphs the local solution is close to global; for high-noise, dense loop-closure, or multi-robot graphs with ambiguous initialization, they can and do get stuck in poor local optima. Critically, no classical solver produces a certificate — there is no principled way to bound the sub-optimality gap at termination.

Certifiable methods address this by reformulating the non-convex PGO problem as a **convex semidefinite program (SDP)** via a relaxation that, under moderate noise, is exact: the solution to the relaxed problem is also a solution to the original non-convex problem. The solver then produces a **dual certificate** — typically an eigenvalue test on a matrix derived from Lagrangian strong duality — that either confirms global optimality (zero duality gap) or quantifies the gap. When the certificate passes, the returned estimate is provably the maximum-likelihood pose graph solution, regardless of initialization.

The canonical certifiable PGO algorithm is **SE-Sync** (Rosen et al., IJRR 2019). Related work includes **Cartan-Sync** (RA-L 2017), **Shonan Rotation Averaging** (ECCV 2020), **DC2-PGO** (T-RO 2021) for distributed settings, and **DCORA** (ICRA 2025) for range-aided SLAM. This page covers all of these.

Certifiable PGO is a batch or near-batch operation. It is not a real-time odometry estimator. Its primary role in a production pipeline is as an **offline post-survey validation and audit step** that produces machine-verifiable evidence of map optimality for safety-case dossiers.

---

## Core Technical Idea

### Classical PGO and Its Failure Mode

A pose graph contains:
- **Nodes** T_1, ..., T_n in SE(d): unknown poses (rotation + translation).
- **Edges** (i, j): noisy relative pose measurements (R_ij, t_ij) with associated information matrices.

The maximum-likelihood estimate (MLE) under Gaussian/Langevin noise is a nonlinear least-squares (NLS) problem:

```
min_{R_i, t_i}  sum_{(i,j) in E}
    kappa_ij * ||R_i^T R_j - R_ij||_F^2
  + tau_ij   * ||(R_i^T (t_j - t_i)) - t_ij||^2
```

This is non-convex because R_i is constrained to SO(d). Classical solvers apply Gauss-Newton or Levenberg-Marquardt on the Lie-group tangent space and converge to a local minimum. The convergence quality depends heavily on the quality of the linearization point (initial estimate). Under the initializations typical of production SLAM (odometry, IMU propagation), they usually converge well — but there is no guarantee, and no way to verify the result.

### What "Certifiable" Means

A certifiable PGO method:
1. Computes or attempts to compute the **global minimum** of the pose-graph cost.
2. Produces a **certificate** — a dual witness derived from Lagrangian strong duality — that either confirms global optimality (zero duality gap) or quantifies the gap.
3. When the certificate passes, the solution is provably the MLE, independent of initialization.

This is a consequence of the mathematics of convex optimization applied to a carefully designed relaxation of the non-convex problem, not a heuristic.

### The SDP Relaxation

The key algebraic step lifts the problem into a higher-dimensional matrix space.

**Step 1 — Rotation subproblem.** Fixing translations, the rotation cost becomes a quadratic form in the Gram matrix P = R^T R where R is the stacked matrix of rotation columns. The SO(d) constraint is replaced by:

```
P positive semidefinite,  rank(P) = d,  P_ii = I_d for all i
```

**Step 2 — SDP relaxation.** Drop the rank constraint to obtain:

```
min_{P in S+^{dn}}  <Q_R, P>
subject to           P_ii = I_d  for all i
```

This is a convex SDP solvable in polynomial time. When its minimizer has rank exactly d, the SDP is **exact**: its solution directly yields the globally optimal rotation estimate.

**Step 3 — Full SE(d) synchronization (SE-Sync).** SE-Sync reformulates the joint rotation-translation problem as synchronization over SE(d), embedding it as:

```
min_{Y in manifold M}  <Q_tilde, Y Y^T>
```

where M is an oblique manifold and Q_tilde encodes both rotation and translation measurement information. The full SDP is again solved via relaxation.

### The Burer-Monteiro Factorization

Full SDP solvers scale as O(n^3.5) — impractical for n beyond a few hundred. The **Burer-Monteiro (BM)** trick replaces the PSD matrix Z with a low-rank factor Z = Y Y^T, Y in R^{N x r}, r << N:

```
min_{Y in R^{N x r}}  <Q, Y Y^T>
subject to             <A_i, Y Y^T> = b_i,  i = 1, ..., m
```

This is non-convex in Y, but:
- Has dimension Nr instead of N^2 / 2.
- Can be solved with Riemannian optimization on the oblique manifold.
- When r >= sqrt(2m) (the Burer-Monteiro condition), **almost all local minima of the BM problem are global minima** of the original SDP.

Increasing r gives a sequence of BM problems whose global optima converge to the SDP optimum. In practice the sequence r = d, d+1, d+2, ... is traversed until the certificate passes — this is the **Riemannian staircase**.

### The Optimality Certificate (Duality Gap Test)

The certificate exploits Lagrangian strong duality. Given a candidate primal solution Y*:

1. Solve a linear system for dual variables lambda* using Y*.
2. Form the **dual certificate matrix** S_{lambda*} = Q + sum_i lambda*_i A_i.
3. Compute lambda_min(S_{lambda*}) via Lanczos iteration.
4. **Certificate passes** if lambda_min(S_{lambda*}) >= -epsilon for small tolerance epsilon > 0.

Zero duality gap means the SDP relaxation is exact — the relaxed solution is also a solution to the original non-convex problem. Under moderate noise (below a threshold determined by the spectral gap of the measurement graph), zero duality gap is expected with high probability for robotics-scale pose graphs.

### Rounding Back to SE(d)

When the BM solution Y* has numerical rank exactly d, the globally optimal rotation estimate R* is recovered by:

1. Compute the rank-d SVD of Y*: Y* ~ U Sigma V^T.
2. Round to SO(d) via the orthogonal Procrustes solution: R* = U V^T * sign(det(U V^T)).

If Y* has higher numerical rank (certificate failed at current r), increase r and re-optimize (staircase step).

---

## Operator Mechanics — Riemannian Staircase

The Riemannian staircase is the unifying computational pattern across SE-Sync, Cartan-Sync, and Shonan averaging:

```
For r = d, d+1, d+2, ...:

  1. Solve BM problem at rank r:
       min_{Y in R^{N x r}}  <Q, Y Y^T>  s.t. constraints
     using Riemannian truncated-Newton trust-region (RTR)
     on the oblique manifold / Stiefel manifold / SO(p)^n

  2. Recover candidate solution from Y*

  3. Compute dual variables lambda* by solving linear system

  4. Form certificate matrix:
       S_{lambda*} = Q + sum_i lambda*_i A_i

  5. Compute lambda_min(S_{lambda*}) via Lanczos method

  6. If lambda_min >= -epsilon:
         CERTIFICATE PASSES -> globally optimal, exit
     Else:
         ESCALATE: r = r + 1 -> next iteration
         Use minimum eigenvector of S_{lambda*} as escape direction
         to initialize next rank level
```

In practice, certification is achieved at r = d for the vast majority of robotics-scale datasets under normal operating noise. Rank escalation (r > d) occurs primarily under extreme noise, degenerate graph topology, or high outlier fractions.

---

## Inputs and Outputs

**Inputs:**
- Complete pose graph: set of node IDs with initial estimates T_i in SE(d), and edge list with relative-pose measurements (R_ij, t_ij) and information matrices (kappa_ij, tau_ij).
- Solver settings: rank schedule, RTR tolerance, certificate eigenvalue tolerance epsilon.
- Optional: outlier-rejection weights from a prior GNC / ROBIN pass.

**Outputs:**
- Certified globally optimal pose estimates T_1*, ..., T_n* in SE(d).
- Certificate status: PASS (zero duality gap confirmed) or FAIL (gap detected or uncertified).
- Certificate matrix eigenvalue: lambda_min(S_{lambda*}) — quantifies distance from tightness.
- Final rank r* at which certification was achieved (or the maximum rank attempted).
- Residual cost at the certified solution.

The certificate status and eigenvalue should be recorded alongside the map artifact. A failed certificate is useful information — it means the graph may be in a regime where the relaxation is not exact, and the result should be treated like a standard NLS solution.

---

## Architecture

```
[Pose Graph Input]
      |
      v
[Gauge Anchoring]
      |  fix one pose or add prior; ensure graph is connected
      v
[Matrix Assembly]
      |  build Q, A_i, b_i from edge measurements + info weights
      v
[Riemannian Staircase Loop]
      |
      |-- r = d (initial rank)
      |
      |  [BM Inner Solve]  min_{Y in R^{N x r}} <Q, Y Y^T>  s.t. constraints
      |       |  Riemannian truncated-Newton trust-region (RTR)
      |       v
      |  [Candidate Solution Y*]
      |       |
      |  [Certificate Test]
      |       |  solve for lambda*, form S_{lambda*}, Lanczos eigenvalue
      |       |
      |       +-- lambda_min >= -epsilon --> CERTIFICATE PASSED
      |       |                             round Y* -> R* in SO(d)
      |       |                             recover t* by linear solve
      |       |                             OUTPUT globally optimal poses + certificate
      |       |
      |       +-- lambda_min < -epsilon  --> ESCALATE: r = r + 1
      |                                     use min-eigenvector as warm start
      |                                     loop back to BM Inner Solve
      |
      v
[Certified Pose Estimates + Certificate Record]
```

---

## Foundational Methods

### SE-Sync (Rosen et al., IJRR 2019)

**Citation:** David M. Rosen, Luca Carlone, Afonso S. Bandeira, John J. Leonard. "SE-Sync: A Certifiably Correct Algorithm for Synchronization over the Special Euclidean Group." *International Journal of Robotics Research*, 38(2-3):395-416, March 2019.

- arXiv: https://arxiv.org/abs/1612.07386
- GitHub: https://github.com/david-m-rosen/SE-Sync
- Paper page: https://david-m-rosen.github.io/publication/sesync-ijrr/

SE-Sync is the canonical certifiable SE(d) PGO algorithm. It reformulates PGO as synchronization over SE(d), constructs a sparse SDP relaxation, and solves the BM-factorized version with a Riemannian truncated-Newton trust-region (RTR) method on the oblique manifold. Optimality is tested with the eigenvalue certificate. The Riemannian staircase escalates rank r = d, d+1, ... until certified.

On standard SLAM benchmark datasets (Manhattan-world, CSAIL, MIT, Intel, Sphere), SE-Sync finds the global optimum where g2o and Gauss-Newton get stuck in local optima on higher-noise variants. On easier instances, GTSAM-iSAM2 may converge to the same solution faster. SE-Sync is claimed to run more than an order of magnitude faster than Gauss-Newton baselines on the tested benchmark datasets.

Implementation: C++ primary, MATLAB interface. Actively maintained as of 2024. MIT license.

**Critical assumption:** SE-Sync's exactness guarantee assumes **isotropic rotational noise** (Langevin/von-Mises-Fisher distribution). This is the standard assumption for LiDAR-based pose graphs with homogeneous angular uncertainty. It breaks under anisotropic measurements — see Failure Modes below.

### Cartan-Sync (Briales & Gonzalez-Jimenez, RA-L 2017)

**Citation:** J. Briales and J. Gonzalez-Jimenez. "Cartan-Sync: Fast and Global SE(d)-Synchronization." *IEEE Robotics and Automation Letters*, 2017.

- IEEE Xplore: https://ieeexplore.ieee.org/document/7962155/
- PDF: http://mapir.isa.uma.es/jbriales/publications/RAL17+supp.pdf

Cartan-Sync uses the **Cartan motion group** — a semidirect-product group structure — to derive a compact matrix formulation of the PGO MLE. It introduces a purpose-built preconditioner that accelerates convergence of the inner Riemannian optimizer. Cartan-Sync proves that sharp correspondences exist between minimizers of its relaxation and SE-Sync's relaxation, so SE-Sync's exactness guarantees transfer directly. Reported up to one order of magnitude faster than SE-Sync on certain benchmark instances due to the preconditioner. The Cartan-Sync structure is the basis for distributed certifiably correct PGO (DC2-PGO).

### Shonan Rotation Averaging (Dellaert et al., ECCV 2020)

**Citation:** Frank Dellaert, David M. Rosen, Jing Wu, Robert Mahony, Luca Carlone. "Shonan Rotation Averaging: Global Optimality by Surfing SO(p)^n." *ECCV 2020*.

- Springer: https://link.springer.com/chapter/10.1007/978-3-030-58539-6_18
- PDF: https://www.ecva.net/papers/eccv_2020/papers_ECCV/papers/123510290.pdf
- Project page: https://dellaert.github.io/ShonanAveraging/

Shonan averaging reformulates the **rotation averaging** problem as optimization over SO(p)^n for increasing p (starting at p = d = 3). This is the BM/Riemannian-staircase approach applied specifically to the rotation-synchronization subproblem. The algorithm "surfs" SO(p)^n: at p = d it solves the original rotation averaging; when the certificate fails it increases p = d+1 and re-runs, reusing existing high-performance SfM pipelines as the inner solver.

Shonan averaging is implemented in **GTSAM** as `ShonanAveraging`, merged into mainline GTSAM, and directly composable with standard SfM and SLAM factor graphs. Scope: rotation averaging only (not full SE(d)), but rotation is the hard part — translation is recovered by least-squares once rotations are fixed. This is the most practically accessible certifiable method for users already on the GTSAM stack.

---

## Distributed Certifiable PGO

### DC2-PGO (Tian et al., T-RO 2021)

**Citation:** Y. Tian, K. Khosoussi, D. M. Rosen, J. P. How. "Distributed Certifiably Correct Pose-Graph Optimization." *IEEE Transactions on Robotics*, 2021.

- arXiv: https://arxiv.org/abs/1911.03721
- PMC: https://pmc.ncbi.nlm.nih.gov/articles/PMC8819718/

DC2-PGO distributes the certifiable PGO computation across a multi-robot team without a central server:

- Uses a sparse SDP formulation that preserves graphical structure: agents communicate only with graph neighbors, not all-to-all.
- Replaces SE-Sync's dense RTR inner solver with **Riemannian Block Coordinate Descent (RBCD)**: each robot updates its own block of variables in a round-robin or asynchronous schedule.
- **RBCD++** (accelerated variant) achieves 2-3x speedup over non-accelerated RBCD.
- **Distributed verification:** Each agent participates in a distributed minimum-eigenvalue computation (accelerated power iteration / Lanczos) to certify optimality without a central authority.
- **Privacy:** Robots exchange only inter-robot loop-closure poses with graph neighbors; no robot discloses its full trajectory.

Convergence: RBCD converges to first-order critical points at rate O(1/K). On benchmark multi-robot datasets (up to 49 robots, 6,125 poses), the optimality gap reaches 10^-5.

**Connection to Kimera-Multi:** Kimera-Multi (Chang et al., 2021-2022) implements a distributed GNC extension built atop RBCD as its robust distributed PGO backend (DPGO module). This is the practical multi-robot system that sits between fully certifiable (DC2-PGO) and purely local (standard iSAM2). See [Kimera-Multi](./kimera-multi.md) for full architecture. For the neural Gaussian SLAM comparison context, see [Multi-Agent Neural Gaussian SLAM](./multi-agent-neural-gaussian-slam.md).

### DCORA: Distributed Certifiable Range-Aided SLAM (ICRA 2025)

**Citation:** Rosen group (Northeastern). "DCORA: Distributed Certifiable Range-Aided SLAM." ICRA 2025.

- arXiv: https://arxiv.org/abs/2503.03192

DCORA extends the Riemannian staircase to distributed **range-aided SLAM (RA-SLAM)** — adding point-to-point distance measurements from UWB or radar alongside standard pose-graph edges. The distributed Riemannian staircase generalizes from DC2-PGO with minimal modification. Performance matches a state-of-the-art centralized certifiable RA-SLAM algorithm on real-world multi-agent datasets. Relevant for airside deployments where UWB beacons supplement LiDAR-derived pose edges.

---

## Robust Certifiable PGO

Standard certifiable PGO (SE-Sync, Shonan) assumes the Gaussian/Langevin measurement noise model. A single outlier (spurious loop closure) can dramatically shift the global optimum to a geometrically incorrect solution. Certifiability in the presence of outliers requires combining the certifiable framework with robust estimation.

### Graduated Non-Convexity (GNC) + Certifiable Inner Solver

**Citation:** Yang & Carlone, ICRA 2020. arXiv: https://arxiv.org/abs/1909.08605

GNC replaces the quadratic (L2) loss with a robust kernel (Truncated Least Squares, Geman-McClure) and solves a sequence of convexified surrogates, graduated from convex to the target robust kernel, using a certifiable inner solver at each step. GNC-aware frameworks are robust to 70-80% outliers and outperform RANSAC on spatial perception problems. **Adaptive GNC (2023)** (arXiv: https://arxiv.org/abs/2308.11444) introduces an adaptive B-spline shape function for the robust kernel, reducing GNC iterations vs. fixed schedules while maintaining certifiable-quality inner solves.

### STRIDE: Certifiably Optimal Outlier-Robust Perception

**Citation:** H. Yang, L. Carlone (MIT). arXiv: https://arxiv.org/abs/2109.03349. GitHub: https://github.com/MIT-SPARK/CertifiablyRobustPerception

STRIDE reformulates common robust costs (Truncated Least Squares, maximum consensus) as **polynomial optimization problems (POP)**, then relaxes via sparse SDP. The STRIDE solver blends global descent on the convex SDP with fast local search on the non-convex POP, extracting a certificate when both converge to the same value. This is the most theoretically complete approach: certifiably optimal with respect to the robust cost, not just the Gaussian MLE. The certificate confirms "this is the globally optimal robust solution." STRIDE is MATLAB/C++; maintained by MIT SPARK Lab.

### ROBIN: Graph-Theoretic Outlier Rejection

**Citation:** arXiv: https://arxiv.org/abs/2011.03659

ROBIN uses the **maximum clique** of a consistency graph to identify inliers before running a certifiable inner solver. The combination ROBIN + GNC is robust to **98% outliers** — significantly better than GNC alone (which degrades above ~90%). ROBIN is a preprocessing stage compatible with any certifiable backend.

### Switchable Constraints

An earlier approach: introduce binary or soft switch variables per edge that can disable an edge during optimization. Switchable constraints are less theoretically clean than GNC/STRIDE but are natively supported in g2o and GTSAM and provide a practical first line of defense against outlier loop closures. They do not provide a global optimality certificate.

---

## Recent 2023-2025 Advances

### XM / Building Rome with Convex Optimization (2025)

**arXiv:** https://arxiv.org/abs/2502.04640 (Haoyu Han and Heng Yang, February 2025). Project page: https://computationalrobotics.seas.harvard.edu/XM/

Scaled Bundle Adjustment (SBA): lifts 2D keypoint measurements to 3D with learned depth, designs an empirically tight convex SDP relaxation for the full bundle adjustment problem, and solves via Burer-Monteiro with a **CUDA-based trust-region Riemannian optimizer**. Successfully reconstructed scenes with up to 10,155 frames within one hour. XM-SfM matches or exceeds traditional SfM pipelines in quality while being initialization-free. This demonstrates that certifiable methods can now compete in speed with non-certifiable ones on large-scale vision problems when GPU acceleration is available.

### Certifiable Factor Graph Optimization (2025)

**arXiv:** https://arxiv.org/abs/2603.01267

Unifies factor-graph notation with SDP relaxation machinery: any factor graph whose factors encode polynomial residuals can be systematically relaxed to a certifiable SDP. Directly applies to pose-graph SLAM and extends certifiability to factor graphs with heterogeneous measurement types (IMU preintegration, wheel odometry, GPS).

### Matrix-Weighted SLAM Relaxation (2023)

**arXiv:** https://arxiv.org/abs/2308.07275

Shows that **anisotropic (matrix-weighted) noise** can break tightness of standard SE-Sync-style relaxations, even at low noise levels. Redundant constraints restore tightness. This is an important negative result with direct practical consequences — see Failure Modes below.

### Certifiable Rotation Averaging via Multi-Irreducible Spectral Synchronization (2023)

Rosen et al., November 2023. Extends SE-Sync-style synchronization to multiple irreducible representations of SO(d). Handles outlier-corrupted rotation measurements without GNC, providing a "simple, flexible, computationally efficient" robust rotation-averaging approach.

### DCORA / Certifiable RA-SLAM (2024-2025)

IEEE T-RO 2024: "Certifiably Correct Range-Aided SLAM" (Rosen group, Northeastern). Extends certifiable PGO to distance-measurement-augmented graphs (UWB, radar range). ICRA 2025: DCORA distributes this across a multi-agent team (see above).

### TEASER++ — Certifiable Point Cloud Registration Front-End

**arXiv:** https://arxiv.org/abs/2001.07715. GitHub: https://github.com/MIT-SPARK/TEASER-plusplus

Not a pose-graph backend, but the upstream certifiable front-end that produces certifiably optimal relative-pose edges. TEASER decouples scale, rotation, and translation: scale and translation are solved in polynomial time via adaptive voting; rotation is solved via a tight SDP relaxation exact even under extreme outlier rates (>99% in experiments). TEASER++ avoids the full SDP via Douglas-Rachford splitting + GNC, certifying in milliseconds. This is the LiDAR scan-registration method most naturally paired with a certifiable PGO backend for a fully certifiable front-end-to-backend pipeline. See [Point Cloud Registration Math](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md) for ICP/GICP comparison.

---

## Benchmark Results

On standard SLAM benchmark datasets (Manhattan-world, CSAIL, MIT, Intel, Sphere):

| Dataset regime | g2o (LM) | GTSAM-iSAM2 | SE-Sync |
|---|---|---|---|
| Easy (good init, low noise) | Global opt. (empirical) | Global opt. (empirical) | Global opt. (certified) |
| Hard (high noise, dense loops) | Local opt. / stuck | Local opt. / stuck | Global opt. (certified) |
| Initialization-free | Fails or poor | Fails or poor | Certified globally optimal |

Compute comparison (500-node, 2000-edge graph, modern server CPU):

| Solver | Global optimality | Certificate | Typical runtime | Robust to outliers |
|---|---|---|---|---|
| g2o (Levenberg-Marquardt) | No | No | < 1 s | No (requires GNC wrapper) |
| GTSAM-iSAM2 | No | No | < 1 s incremental | No (requires GNC wrapper) |
| Ceres (LM / dogleg) | No | No | < 1 s | No (requires robust kernel) |
| SE-Sync | Yes (under noise bound) | Yes (eigenvalue test) | 5-60 s | No (clean graph assumed) |
| SE-Sync + STRIDE | Yes (robust cost) | Yes (dual witness) | Minutes | Yes (TLS / max-consensus) |
| TEASER++ (front-end only) | Yes (rotation SDP) | Yes | < 10 ms per pair | Yes (> 99% outliers) |

**Scaling behavior:**
- Up to ~1,000-2,000 nodes: SE-Sync is tractable in seconds to minutes on CPU.
- 5,000-20,000 nodes: BM trick is necessary; runtime grows to minutes to hours on CPU without GPU.
- 50,000+ nodes: requires GPU-accelerated solvers (XM-style CUDA) not yet publicly available for general PGO.
- Full dense SDP solvers (MOSEK on un-factored SDP): impractical beyond a few hundred nodes.

---

## Strengths

**Provable global optimality.** The returned estimate is the MLE (or robust-MLE) with a mathematical certificate. This is qualitatively different from any heuristic or locally-convergent method. For safety-critical map production, the difference between "our solver converged" and "global optimality is certified by a zero-duality-gap test" is material.

**Certification as machine-verifiable evidence.** The dual certificate is a checkable artifact. It can be logged with the map build, inspected by a third party, and cited in a regulatory submission or audit trail — analogous to a build hash or test report. This is not available from g2o, iSAM2, or Ceres.

**Noise robustness.** Certifiable methods find the global optimum at noise levels where gradient-based methods fail — up to an order of magnitude higher noise in SE-Sync experiments. The certificate also degrades gracefully: it either passes or fails with a quantified gap, unlike classical solvers which silently return sub-optimal solutions.

**Initialization-free.** No initial estimate is required for the certifiable relaxation. The BM factorization provides its own implicit initialization through the staircase. Practical implementations still use odometry-based initialization for the inner Riemannian solver for speed, but correctness does not depend on it.

**Modular composability.** Shonan averaging integrates into GTSAM without replacing the rest of the factor-graph pipeline. SE-Sync can be run as a post-hoc batch step on any pose graph exported from GTSAM/g2o. TEASER++ feeds certifiably optimal edges directly into any backend.

---

## Failure Modes

**SDP relaxation not tight (noise above threshold).** If measurement noise exceeds the regime where the spectral gap of the measurement graph is large enough, the minimum eigenvalue of S_{lambda*} is negative and the certificate fails. The method degrades gracefully — it returns the best solution found at the maximum rank — but that solution is unverified and may not be globally optimal. This typically occurs with very sparse pose graphs (few loop closures), very high noise, or after outlier injection.

**Isotropic noise assumption (KEY ISSUE for matrix-weighted measurements).** SE-Sync's exactness guarantee assumes isotropic rotational noise — uniform angular uncertainty in all directions, described by a scalar concentration parameter. This assumption underlies the SDP relaxation structure. When measurements have **strongly anisotropic (matrix-weighted) noise** — different variances in different rotation axes — standard SE-Sync-style relaxations can lose tightness even at low absolute noise levels (arXiv: https://arxiv.org/abs/2308.07275).

This matters specifically in the airside context if **4D radar edges** are added to the pose graph alongside LiDAR edges. 4D radar has characteristically anisotropic angular noise: range precision is good, but azimuth and elevation resolution are coarser and frequency-dependent. A pose graph combining LiDAR edges (near-isotropic) and 4D radar edges (strongly anisotropic) may violate the isotropic noise assumption. Adding **redundant constraints** (extra loop closures from cross-modality checks) can restore tightness. The Cayley-map-based certifiable estimator (arXiv: https://arxiv.org/abs/2308.12418) handles anisotropic noise more naturally. Flag this as an open integration risk if radar edges are added to the airside pose graph.

**Scalability wall.** Even with Burer-Monteiro, graphs of 10,000+ nodes require GPU-accelerated solvers (XM-style CUDA, not yet public for general PGO) or significant runtime budget. This is not a problem for offline post-survey batch processing but precludes real-time use.

**Ecosystem immaturity.** g2o, GTSAM, and Ceres have large communities, extensive ROS integration, multi-year production hardening, and active issue trackers. SE-Sync and STRIDE are primarily research code. There are fewer examples of SE-Sync running inside a production CI/CD pipeline or integrated with ROS2 lifecycle nodes.

**Numerical certificate fragility.** Tightness checks depend on eigenvalue tolerances, sparse linear algebra conditioning, and floating-point precision. Near the noise threshold boundary, false positives (certificate claims pass when the relaxation is not tight) or false negatives (certificate claims fail when the solution is actually globally optimal) can occur. Tight tolerances and robust eigenvalue methods (Lanczos) are required.

**Outlier sensitivity (without robust wrapper).** Pure SE-Sync without a GNC/STRIDE wrapper is sensitive to even a few bad loop closures. A single high-weight false-positive edge shifts the globally optimal solution away from the geometrically correct one. SE-Sync certifies that it found the global optimum of the stated cost — it does not certify that the measurements are correct.

**Degenerate graph topology.** Graphs with insufficient connectivity (tree-structured, sparse without loop closures) violate observability. SE-Sync's relaxation becomes rank-deficient; g2o also fails. Neither solver can recover a unique solution from a degenerate graph.

---

## Domain Fit

| Domain | Certifiable PGO role | Notes |
|---|---|---|
| **Airside survey mapping** | Offline post-survey audit / safety-case evidence | Best fit: batch validation of finalized LiDAR pose graph; see below |
| **Warehouse / logistics-yard** | Offline map audit for certified HD map assets | ISO 3691-4 dossier support; operational scale manageable |
| **Road AV (HD map production)** | Offline map-build validation | Scale (10k+ nodes) requires BM + server CPU or GPU; viable |
| **Mining / construction survey** | Post-mission batch step | Harsh conditions may stress noise threshold; robust wrapper needed |
| **Agricultural mapping** | Offline crop-field map validation | Small-to-medium scale; directly feasible with SE-Sync |
| **Multi-robot fleet** | Distributed via DC2-PGO / DCORA | Each robot contributes; no central server needed |
| **Online AV runtime localization** | Not suitable (latency) | Use GTSAM-iSAM2 + GNC for online operation |
| **Port / terminal mapping** | Post-survey audit | Large industrial environments; graph scale manageable per survey session |

---

## Aggregated-Map Suitability — Airside Survey Drive

### Context

An airside survey drive for HD map production:
- Drive profile: 5-15 km/h, structured aprons and taxiways, multiple laps.
- LiDAR primary: Ouster OS2-128 or equivalent; dense scan-to-scan matching provides high-quality relative-pose measurements.
- Loop closures: multiple passes over the same locations; dense inter-lap loop closures detectable from LiDAR place recognition (see [Loop Closure and Place Recognition](./loop-closure-place-recognition.md)).
- Graph scale: a medium airport survey generates O(1,000-10,000) keyframe poses. Full airside coverage may reach O(5,000-20,000) nodes.

### Production Pipeline (Standard Practice)

GTSAM-iSAM2 with incremental online updates during the drive, followed by batch GNC-robust refinement (Ceres or g2o with Geman-McClure kernel) for the final map. Fast, operationally mature, handles outlier loop closures well. Does not produce a global optimality certificate. See [KISS-SLAM](./kiss-slam.md) and [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) for the online odometry front-ends that feed this pipeline.

### Certifiable PGO as the Audit / Validation Branch

Certifiable PGO is viable as an **offline post-survey batch step** that produces machine-verifiable map-optimality evidence for safety-case dossiers:

```
Survey drive
    |
    v
[Online: FAST-LIO2 / LIO-SAM odometry + loop closure]
    |
    v
[Online: GTSAM-iSAM2 + GNC robust PGO]  <- production map
    |
    v
[Offline batch: TEASER++ on all LiDAR scan pairs]
    |   -> certifiably optimal relative-pose edges
    v
[Offline batch: SE-Sync + GNC/STRIDE on full pose graph]
    |   -> certifiably globally optimal map poses + dual certificate
    v
[Map artifact: poses + residuals + certificate eigenvalue + certificate status]
    |   -> safety-case dossier, regulatory submission, audit trail
    v
[Optional: compare to iSAM2 solution; flag discrepancies > threshold]
```

**Safety-case framing:** This aligns with SOTIF / EN 62061 / DO-178C approaches where functional correctness evidence is demanded. A certificate stating "the surveyed map achieves the minimum-cost alignment under maximum-likelihood assumptions, verified by a zero-duality-gap eigenvalue test" is a qualitatively stronger claim than "our NLS solver converged." It supports:
- Map quality audit documentation.
- Regulatory submission evidence (ISO 3691-4 dossiers for airside AGV certification).
- Sensitivity analysis: the certificate matrix S_{lambda*} encodes covariance information about the solution.
- Regression testing: run certifiable PGO on every map build; flag any build where the certificate fails or the gap increases vs. prior builds.

The **online production operation still belongs to GTSAM-iSAM2 + GNC**. Certifiable PGO is the audit and validation branch, not a replacement for the online backend. See [LT-Mapper / Khronos Lifelong Mapping](./lt-mapper-khronos-lifelong-mapping.md) for the multi-session map management layer above this pipeline, and [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) for the downstream semantic annotation step.

### Honest Assessment of Limitations

- **Runtime:** A 5,000-node pose graph with SE-Sync (BM, no GPU) may take 5-30 minutes on a server CPU. Acceptable for an offline post-survey batch job; not for real-time operation.
- **Noise model:** Airside LiDAR measurements are high-quality (centimetre-level); SE-Sync's noise threshold is unlikely to be violated under normal conditions. Under adverse weather (dense fog, heavy rain), LiDAR quality degrades; the certificate should be tested against weather-stratified data.
- **Outlier loop closures:** Pure SE-Sync (without STRIDE/GNC) is sensitive to even a few bad loop closures. The robust variant (SE-Sync + GNC or STRIDE) is required for a production pipeline.
- **4D radar edges (anisotropic noise):** If 4D radar measurements are added as additional pose-graph edges with strongly anisotropic noise, the standard SE-Sync guarantee may not hold without redundant constraints. Flag this as an open risk if radar edges are included; see the matrix-weighted failure mode above and [Multi-Sensor Calibration and Observability](../../../10-knowledge-base/geometry-3d/multi-sensor-calibration-observability.md) for calibration context.

---

## Implementation Notes

- **Run after robust outlier filtering, not before.** Certifiable PGO certifies the objective; it does not filter bad measurements. Run GNC, ROBIN, or PCM (see [Kimera-RPGO and PCM](./kimera-rpgo-pcm.md)) first.
- **Record the full certificate artifact.** Log certificate status, eigenvalue lambda_min(S_{lambda*}), final rank r*, and residual cost alongside every map build. Do not log only the trajectory.
- **Compare against the iSAM2/g2o solution.** Systematic discrepancy between the certifiable and classical solution on easy instances is a sign of a modeling error (wrong information weights, bad edge covariances).
- **Use Shonan averaging for rotation-only problems.** If the dominant ambiguity is rotation averaging in SfM or multi-camera graphs, Shonan (via GTSAM) is easier to integrate than full SE-Sync.
- **Use SE-Sync for full SE(d) problems.** When full SE(3) synchronization and PGO optimality matter (LiDAR mapping), SE-Sync is the reference implementation.
- **For collaborative SLAM across robots,** use DC2-PGO or Kimera-Multi's DPGO rather than forcing all robot data through a central machine. See [Distributed Multi-Robot PGO](./distributed-multi-robot-pgo.md).
- **GTSAM does not expose a general certifiable PGO solver.** Only Shonan averaging for the rotation sub-problem is in mainline GTSAM. A full certifiable SE(3) backend requires SE-Sync or STRIDE.
- **Ceres has no certifiable mode.** It is always locally-optimal NLS.

---

## Open-Source Implementations

| Library | Role | License / Status |
|---|---|---|
| SE-Sync (github.com/david-m-rosen/SE-Sync) | Reference C++ / MATLAB certifiable PGO | MIT, actively maintained |
| GTSAM — ShonanAveraging (borglab/gtsam) | Certifiable rotation averaging in GTSAM factor graphs | Merged mainline GTSAM |
| CertifiablyRobustPerception (MIT-SPARK) | STRIDE solver; TEASER | MIT SPARK Lab, MATLAB / C++ |
| TEASER++ (MIT-SPARK/TEASER-plusplus) | Certifiable point cloud registration, millisecond runtime | C++, ROS-compatible |
| DPGO (mit-acl/dpgo) | Distributed certifiable backend (Kimera-Multi's DPGO module) | MIT |
| MOSEK / SCS / SDPA | General-purpose SDP solvers (SE-Sync internals) | Commercial / BSD |
| g2o / iSAM2 / Ceres | Classical NLS solvers — NOT certifiable | Mature, production-grade |

---

## Sources

- Rosen, Carlone, Bandeira, Leonard. "SE-Sync: A Certifiably Correct Algorithm for Synchronization over the Special Euclidean Group." IJRR 2019: https://arxiv.org/abs/1612.07386
- SE-Sync GitHub: https://github.com/david-m-rosen/SE-Sync
- Briales, Gonzalez-Jimenez. "Cartan-Sync: Fast and Global SE(d)-Synchronization." RA-L 2017: https://ieeexplore.ieee.org/document/7962155/
- Dellaert, Rosen, Wu, Mahony, Carlone. "Shonan Rotation Averaging: Global Optimality by Surfing SO(p)^n." ECCV 2020: https://www.ecva.net/papers/eccv_2020/papers_ECCV/papers/123510290.pdf
- Shonan project page: https://dellaert.github.io/ShonanAveraging/
- Tian, Khosoussi, Rosen, How. "Distributed Certifiably Correct Pose-Graph Optimization." T-RO 2021: https://arxiv.org/abs/1911.03721
- DCORA (distributed RA-SLAM, ICRA 2025): https://arxiv.org/abs/2503.03192
- Yang, Carlone. "STRIDE: Certifiably Optimal Outlier-Robust Perception." arXiv: https://arxiv.org/abs/2109.03349
- CertifiablyRobustPerception GitHub: https://github.com/MIT-SPARK/CertifiablyRobustPerception
- ROBIN (graph-theoretic outlier rejection): https://arxiv.org/abs/2011.03659
- GNC (Graduated Non-Convexity): https://arxiv.org/abs/1909.08605
- Adaptive GNC (2023): https://arxiv.org/abs/2308.11444
- Matrix-weighted SLAM relaxation (anisotropic noise failure mode): https://arxiv.org/abs/2308.07275
- XM / Building Rome with Convex Optimization (CUDA certifiable SfM): https://arxiv.org/abs/2502.04640
- Certifiable factor graph optimization: https://arxiv.org/abs/2603.01267
- Cayley-map certifiable pose estimation (anisotropic noise): https://arxiv.org/abs/2308.12418
- TEASER: https://arxiv.org/abs/2001.07715
- DPGO distributed backend: https://github.com/mit-acl/dpgo
- GTSAM Shonan documentation: https://docs.ros.org/en/api/gtsam/html/classgtsam_1_1ShonanAveraging.html
