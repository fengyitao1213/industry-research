# Distributed Multi-Robot Pose Graph Optimization

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "architecture-pattern"
  stage: "modern-core"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "validation", "runtime-localization"]
  reason: "Distributed Multi-Robot Pose Graph Optimization is rated for robust or collaborative backend design in multi-session SLAM and validation."
method-priority:end -->

Related docs: [Kimera-Multi](./kimera-multi.md) · [Certifiable Pose Graph Optimization](./certifiable-pose-graph-optimization.md) · [Kimera-RPGO and PCM](./kimera-rpgo-pcm.md) · [Multi-Agent Neural Gaussian SLAM](./multi-agent-neural-gaussian-slam.md) · [Loop Closure and Place Recognition](./loop-closure-place-recognition.md) · [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) · [KISS-ICP](./kiss-icp.md) · [KISS-SLAM](./kiss-slam.md) · [KISS-Matcher](./kiss-matcher.md) · [D2-SLAM](./d2slam.md) · [COVINS / COVINS-G](./covins-covins-g.md) · [Scan Context Family](./scan-context-family.md) · [Learned LiDAR Place Recognition](./learned-lidar-place-recognition.md) · [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) · [GraphSLAM and Pose Graph Optimization](graphslam-pose-graph-optimization.md) · [Robust Pose Graph Optimization with GNC and riSAM](robust-pgo-gnc-risam.md) · [COSMO-Bench](cosmo-bench.md)

**Last updated:** 2026-05-24

---

## What It Is

**Distributed multi-robot pose graph optimization (DPGO)** is the backend problem behind collaborative SLAM: each robot independently builds a local pose graph — a factor graph whose nodes are SE(3) poses and whose edges encode odometry constraints (wheel encoders, LiDAR-IMU odometry) and intra-robot loop closures. When two robots observe the same place they generate **inter-robot loop closures** — measurements of the relative transformation between a node in robot i's graph and a node in robot j's graph. Adding all inter-robot edges connects N individual graphs into a single joint pose graph.

The DPGO goal is to solve the joint maximum-likelihood pose estimate **without routing all raw measurements through a central server**. Each robot optimizes its own trajectory block and exchanges only a sparse set of shared poses with its graph neighbors, never its full local trajectory or raw sensor data.

Three structural tensions define the problem space:

- **Communication bandwidth** — each consensus iteration requires sharing pose state between neighbors; raw point clouds cannot be shared economically.
- **Intermittent connectivity** — robots are often out of radio range; the algorithm must be robust to missing or delayed messages.
- **Computational scalability** — a team of N robots each with T local poses creates an NT x NT Hessian; centralized solvers scale cubically in NT.

The leading modern line is the **DC2-PGO framework** (Tian, Khosoussi, Rosen, How, IEEE T-RO 2021): distributed pose graph optimization based on sparse semidefinite relaxation, low-rank Riemannian block-coordinate descent (RBCD), and distributed optimality verification. It extends the certifiable PGO idea from [Certifiable Pose Graph Optimization](./certifiable-pose-graph-optimization.md) to the collaborative setting. Asynchronous extensions (ASAPP) handle intermittent connectivity. Robust systems such as [Kimera-Multi](./kimera-multi.md) combine DPGO with incremental maximum-clique outlier rejection and distributed Graduated Non-Convexity (GNC).

This page is distinct from single-robot [GraphSLAM and Pose Graph Optimization](graphslam-pose-graph-optimization.md) and from single-graph robust methods such as [Robust Pose Graph Optimization with GNC and riSAM](robust-pgo-gnc-risam.md).

---

## Centralized vs. Distributed PGO

### Centralized (single-server)

All robots forward their raw odometry factors and loop closure factors to a server. The server assembles the full factor graph and runs a batch nonlinear least-squares solver (GTSAM, g2o, Ceres, or SE-Sync for globally certifiable solutions). Kimera-Multi's single-server variant sends only keyframe descriptors and optimized poses — not all raw measurements — but the optimization is centralized.

**Advantages:** maximum information; certifiably optimal with SE-Sync; no inter-robot synchronization needed.

**Disadvantages:** single point of failure; full trajectory exposure (privacy); server bandwidth scales as O(N); impractical if uplink is intermittent.

### Distributed

Each robot solves a local subproblem over its own pose block, treating neighbors' poses as fixed or incorporating the latest received estimate. Robots exchange only **public poses** — a sparse subset of their trajectory — at each consensus iteration. No robot ever transmits its full local graph.

**Advantages:** O(1) per-robot communication in sparse graphs; privacy-preserving; robust to single-robot failure; natural parallelism.

**Disadvantages:** convergence requires multiple communication rounds; no global optimality guarantee without distributed certification; sensitive to initialization in highly non-convex landscapes.

### Practical Hybrid (Kimera-Multi T-RO 2022)

Kimera-Multi uses a two-phase approach: a lightweight centralized GNC step to initialize the global reference frames (robust to outliers, one round-trip per robot pair), followed by fully distributed RBCD iterations on the joint graph. This avoids the hardest initialization problem while preserving distributed scalability at scale.

---

## Mathematical Formulation

### Problem Notation

Let robot alpha in {1...N} own poses x_alpha = {T_alpha,1 ... T_alpha,n_alpha} with T_alpha,k in SE(3). Define:

- E_alpha — intra-robot edges (odometry + intra-robot loops)
- E_alpha_beta — inter-robot edges between robots alpha and beta ("cross-links")
- T_tilde_alpha_i,beta_j — measured relative transform with information matrix Omega_alpha_beta

The joint cost is:

```
f(x) = sum_alpha f_alpha(x_alpha) + sum_{alpha < beta} f_alpha_beta(x_alpha, x_beta)
```

where f_alpha is the private intra-robot residual sum and f_alpha_beta sums squared Mahalanobis residuals over all cross-link edges. The coupling term f_alpha_beta makes the problem non-separable. DPGO algorithms decompose it so that each robot only stores and communicates **shared (public) poses** — those nodes that appear in at least one inter-robot edge.

### Maximum-Likelihood Cost

The full PGO cost over SE(3) poses:

```
min_{T}  sum_{(i,j) in E}
    kappa_ij * ||R_j - R_i * R_tilde_ij||^2_F
  + tau_ij   * ||t_j - t_i - R_i * t_tilde_ij||^2_2
```

where (R_i, t_i) in SO(3) x R^3 are rotation and translation of pose i, and (R_tilde_ij, t_tilde_ij) is the measured relative transform with precision weights kappa, tau. For the SO(3)/SE(3) Lie-group mathematics underlying these Mahalanobis residuals see [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md).

### SDP Relaxation (Riemannian Staircase)

Non-convexity of SO(3) constraints makes the problem NP-hard in general. SE-Sync (Rosen et al. 2019) and DC2-PGO lift to a sparse SDP: introduce Z = Y^T Y where Y in St(r, d)^n (block-Stiefel manifold, r >= d), obtaining:

```
min_Y   <Q, Y^T Y>    s.t.   Y in St(r,d)^n
```

For r = d this is the original problem; for r > d the SDP relaxation is often tight (globally optimal) under moderate noise — formally proven for SE-Sync and inherited by DC2-PGO under the same noise bound. After solving for Y, the physical SE(3) solution is recovered by rounding (SVD projection onto SO(3)).

### Block Decomposition for Distribution

Robot alpha owns block Y_alpha (rows corresponding to its poses). The full cost factorizes:

```
f(Y) = sum_alpha <Q_alpha_alpha, Y_alpha^T Y_alpha>
     + 2 * sum_{alpha < beta} <Q_alpha_beta, Y_alpha^T Y_beta>
```

Robot alpha's reduced local cost given fixed neighbors Y_{-alpha}:

```
f_alpha(Y_alpha) = <Q_alpha_alpha, Y_alpha^T Y_alpha> + 2 <F_alpha, Y_alpha> + const
```

where F_alpha = sum_{beta in N(alpha)} Q_alpha_beta Y_beta aggregates neighbor contributions. Each robot needs only F_alpha — computed from received public poses — not the full Q matrix.

### Consensus via ADMM

An alternative formulation introduces consensus variables z_alpha_beta = Y_alpha (at shared poses) with matching constraints enforced by Lagrange multipliers lambda_alpha_beta. The augmented Lagrangian:

```
L_rho = f(Y)
      + sum_{(alpha,beta)} [ <lambda_alpha_beta, Y_alpha - z_alpha_beta>
                            + (rho/2) * ||Y_alpha - z_alpha_beta||^2_F ]
```

ADMM alternates: (1) each robot minimizes L_rho over Y_alpha; (2) consensus update on z_alpha_beta = (Y_alpha + Y_beta) / 2; (3) dual ascent on lambda_alpha_beta. ADMM converges for convex f; for non-convex PGO convergence to stationary points is established empirically and locally for strongly convex subproblems.

---

## Algorithm Catalog

### RBCD — Riemannian Block-Coordinate Descent

**Paper:** Tian, Khosoussi, Rosen, How. "Distributed Certifiably Correct Pose-Graph Optimization." IEEE T-RO 2021. arXiv: https://arxiv.org/abs/1911.03721. GitHub: https://github.com/mit-acl/dpgo

**Mechanism.** At each iteration, one robot alpha (selected uniformly at random or greedily) updates its pose block Y_alpha by minimizing f_alpha(Y_alpha) given current neighbors' estimates. The subproblem is an unconstrained quadratic over R^{r x n_alpha} followed by projection (retraction) back onto the Stiefel manifold via QR decomposition. Update rule:

```
Y_alpha <- Retr_{Y_alpha}( -gamma * grad_{Y_alpha} f )
```

where grad_{Y_alpha} f = 2 (Q_alpha_alpha Y_alpha + F_alpha) is the Euclidean gradient lifted to the manifold via the Riemannian gradient. The retraction is a QR-based projection onto the Stiefel manifold — O(r^2 n_alpha) per step.

**Convergence theorem (Theorem 4, DC2-PGO).** Under uniform sampling:

```
min_{0 <= k <= K-1} E[ ||grad f(Y^k)||^2 ]
    <= 4N (f(Y^0) - f*) / (K * min_alpha lambda_alpha)
```

Sublinear O(1/K) rate. Greedy (Gauss-Southwell) selection achieves the same deterministic rate. Accelerated variant **RBCD++** adds Nesterov momentum and converges substantially faster in practice (roughly 2-3x over non-accelerated RBCD on multi-robot benchmarks).

**Distributed verification.** After RBCD converges, each robot locally computes a slice of the dual certificate matrix S(Y) = Q - SymBlockDiag_d^+(Y^T Y Q). If distributed power iteration certifies S(Y) is positive semidefinite, the solution is globally optimal. Otherwise the minimum eigenvector provides a saddle-escape direction for Riemannian staircase ascent, triggering rank increase and re-optimization.

**Benchmark (DC2-PGO, 9 robots, 125 poses each):** RBCD++ reaches 10^-5 optimality gap in ~100 iterations; runtime per block update ~23 ms on a standard laptop. Scales to 49 robots (6125 poses total); gradient norm reaches 10^-2 in ~400 iterations.

**Role in Kimera-Multi:** RBCD (relaxation rank r=5) is the joint optimization backend after GNC frame initialization. See the Benchmark Results section for ATE comparison.

### DGS — Distributed Gauss-Seidel

**Origin:** Choudhary et al. "Distributed Mapping with Privacy and Communication Constraints," RSS 2017. Adopted by DOOR-SLAM (Lajoie et al. 2020): https://arxiv.org/abs/1909.12198

**Mechanism.** DGS decouples PGO into two sequential stages:

1. **Rotation sub-problem.** Relaxes SO(3) constraints to R^{3x3}, solving a linear least-squares system; then projects back via SVD (nearest rotation matrix).
2. **Translation sub-problem.** Given fixed rotations, translation is a linear least-squares problem solved exactly.

Each stage runs Gauss-Seidel iterations: robot alpha updates its block while holding all others fixed. Robots exchange current estimates of shared (public) poses between blocks. Convergence requires iterating until inter-robot updates change below a threshold.

**Limitations.** DGS does not operate on the convex relaxation — it is a local heuristic with no global optimality guarantee. GeoD (Cristofalo et al. 2020) converges 20x faster with 3.4x less error on equivalent problems, and over 100x faster on graphs with more than 1,000 poses.

**Why it persists:** DGS has an extremely simple implementation; it is used as the baseline in nearly all DPGO benchmarks, and is the backend in DCL-SLAM and DiSCo-SLAM.

### ASAPP — Asynchronous and Parallel Distributed PGO

**Paper:** Tian, Koppel, Bedi, How. IEEE RA-L 2020. arXiv: https://arxiv.org/abs/2003.03281

**Mechanism.** ASAPP extends RBCD to an **asynchronous** setting. Each robot alpha executes gradient updates on its local manifold block using stale neighbor estimates (up to B iterations old):

```
g_alpha(x_alpha) = h_alpha(x_alpha) + sum_{j in N(alpha)} f_alpha_j(x_alpha, x_hat_j)  [stale x_hat_j]
eta_alpha = grad g_alpha(x_hat_alpha)
x_alpha <- Retr_{x_hat_alpha}( -gamma * eta_alpha )
```

**Convergence (Theorem 1).** Under bounded delay B >= 0, ASAPP achieves global first-order convergence O(1/K) with stepsize:

```
gamma_bar = ( sqrt(1 + 8 rho_alpha^2 B^2) - 1 ) / (4 rho_alpha^2 B^2 L)
```

where rho = Delta/n (graph sparsity), L is the Lipschitz constant, alpha is a retraction constant. When B=0, gamma_bar = 1/L — matching synchronous algorithms exactly.

**Benchmark (Table 1, ASAPP paper):** On CSAIL 2D (1045 poses): cost 31.51 vs Cartan-Sync reference 31.47. On Intel 2D (1228 poses): cost matches reference (393.7). On Manhattan 2D (3500 poses): cost 227.7 vs reference 193.9 (gradient norm 5.42 — not fully converged in 60 s). Rotation RMSE typically < 0.02 rad; translation RMSE < 1.2 m across datasets. Resilient to 0.1 s fixed communication delays without per-dataset tuning.

**Relevance:** ASAPP is the preferred backend for **intermittently connected** teams — for example, vehicles entering and leaving WiFi coverage during an airside survey sweep.

### DC2-PGO — Distributed Certifiably Correct PGO

**Paper:** Tian, Khosoussi, Rosen, How. IEEE T-RO 2021. arXiv: https://arxiv.org/abs/1911.03721. PMC: https://pmc.ncbi.nlm.nih.gov/articles/PMC8819718/. GitHub: https://github.com/mit-acl/dpgo. **Award:** Honorable Mention, IEEE T-RO King-Sun Fu Memorial Best Paper Award.

DC2-PGO is the parent framework containing RBCD as its optimization engine. Its specific contribution beyond RBCD is the complete **certifiability pipeline**:

1. Sparse SDP relaxation — provably tight under moderate noise (same guarantee as centralized SE-Sync).
2. RBCD / RBCD++ distributed optimization on the Riemannian staircase.
3. Distributed verification — robots collectively check S(Y) is PSD via distributed power iteration (accelerated power iteration with momentum beta ≈ lambda_2^2 / 4).
4. Distributed saddle escape — if verification fails, the minimum eigenvector triggers rank increase and re-optimization.

DC2-PGO is thus the certifiably correct end-to-end system; RBCD is the inner optimizer. The library also provides Kimera-Multi's ROS wrapper: https://github.com/mit-acl/dpgo_ros

### DCORA — Distributed Certifiable Range-Aided SLAM

**Paper:** Thoms, Papalia, Velasquez, Rosen. IEEE ICRA 2025. GitHub: https://github.com/adthoms/dcora

DCORA extends the DC2-PGO certifiability framework to **range-aided SLAM** — where robots carry ultra-wideband (UWB) ranging sensors in addition to odometry. The repository bundles both DC2-PGO (multi-robot, pose-only) and CORA (single-robot, range-aided). The range measurements add scalar distance constraints into the SDP, requiring augmented block structure in RBCD. Theoretical contribution: new exactness conditions for the expanded SDP that account for both pose and range factors. Implementation dependencies: SuiteSparse, Boost, Eigen3, Google Glog.

**Airside relevance:** UWB beacons are deployed in many airport infrastructure projects. DCORA provides a path to certifiably correct multi-robot localization that fuses LiDAR odometry, inter-robot loop closures, and UWB range constraints in a single convex relaxation.

### IRBCD — Improved RBCD with Multi-Level Partitioning

**Paper:** Li et al. "Distributed Pose-Graph Optimization with Multi-Level Partitioning for Collaborative SLAM." arXiv 2401.01657 (2024). https://arxiv.org/abs/2401.01657

**Contribution.** Extends DC2-PGO with (a) a multi-level graph partitioning preprocessing step and (b) Nesterov-accelerated RBCD with adaptive restart.

Partitioning pipeline: (1) Coarsening — merge high-coupling nodes using edge-weight scoring. (2) Balanced partitioning via KaHIP ("Highest" config achieves less than 1% cut edges). (3) Refinement — fine-tune subgraph assignments. IRBCD then runs three coupled sequences Y^k (target), P^k (intermediate), V^k (momentum) with auxiliary scalars alpha_k, beta_k, gamma_k. Adaptive restart triggers when the objective increases beyond c_1 * ||grad f(Y^k)||^2.

**Benchmark (Table II):** Sphere (3D): IRBCD achieves objective 1687 in 18 iterations at 106.8 ms/iteration; Sequential+RBCD requires ~329 iterations for the same convergence. Communication factor reduced from 0.34 to 0.29 (Rim dataset) through partitioning.

### ROBO — Riemannian Overlapping Block Optimization

**Paper:** arXiv 2603.03499 (2025). https://arxiv.org/abs/2603.03499

**Core idea.** Extends RBCD's non-overlapping blocks by introducing overlap parameter omega — robot alpha solves an augmented subproblem over all nodes within omega graph-hops of its owned poses. This leverages the exponential decay of solution sensitivity with graph distance to accelerate information propagation.

**Performance (22 benchmark datasets, 5 simulated robots):** ROBO-3 (omega=3) achieves 3.1x faster convergence in iterations vs state-of-the-art AMM-PGO#; communication overhead 36 KB/iteration (worst case ~250 KB, well within 100 Mbps WiFi). omega > 3 shows diminishing returns. Asynchronous mode is robust to 1 s delays.

---

## Robust DPGO — Outlier Rejection

Outlier inter-robot loop closures are more dangerous than outlier intra-robot closures: a single false cross-robot edge connects unrelated trajectory segments and can corrupt the entire joint map. State-of-practice combines a pre-filter (PCM) with a soft in-optimizer reweighting (GNC).

### Pairwise Consistency Maximization (PCM)

**Origin:** Mangelson et al. ICRA 2018. https://ieeexplore.ieee.org/document/8460217/. Used in: [Kimera-Multi](./kimera-multi.md) (T-RO 2022), DOOR-SLAM (2020), SKiD-SLAM (2025). See also [Kimera-RPGO and PCM](./kimera-rpgo-pcm.md) for the full mathematical treatment.

**Mechanism.** Build an undirected graph G_PCM where nodes are candidate inter-robot loop closures LC_k = (alpha_i, beta_j, T_tilde) and an edge (k, l) exists iff LC_k and LC_l are pairwise consistent: the composed transformation T_tilde_k composed with T_tilde_l^-1 lies within a Mahalanobis distance bound of the identity — meaning the two measurements agree with each other up to odometry uncertainty. Finding the largest mutually consistent set is the **maximum clique problem** (NP-hard in general; solved in near-real-time via incremental approximate maximum clique for typical SLAM graph sizes). The inlier set is then passed to PGO.

**Kimera-Multi implementation:** Incremental maximum clique that updates the current clique as new loop closures arrive without full re-search. This is a locally optimal (not globally largest) clique, which is the primary limitation under very high outlier fractions.

### Distributed GNC — Graduated Non-Convexity

**Reference:** Yang et al. ICRA 2020 (GNC general). Kimera-Multi's distributed variant in T-RO 2022.

**Mechanism.** Replace each loop closure residual rho(r) with a robust kernel rho_mu(r) parameterized by mu. For large mu, rho_mu is approximately constant (ignores outliers); as mu approaches 0, rho_mu approaches L2. GNC anneals mu from large to small, maintaining a warm start at each step. Per-edge weights w_ab are updated:

```
w_ab <- rho'_mu( r_ab ) / r_ab
```

where r_ab is the residual at the current solution. Incorrect loop closures converge toward w_ab -> 0, effectively pruning them from the optimization.

**Distributed variant in Kimera-Multi (Stage 1 — frame initialization):** Applied pairwise between robot pairs to estimate the SE(3) frame alignment T_alpha->beta. This is a 6-DOF problem per pair (not the full joint graph) so the GNC outer loop is inexpensive. Each robot sends only its public poses' best current estimate; the pair runs GNC locally. The two-stage approach (GNC for initialization + RBCD for joint refinement) is reported robust to more than 50% outlier loop closures in simulation experiments.

### Distributed Switchable Constraints

**Origin:** Sünderhauf and Protzel, IROS 2012. Adapted to multi-robot by augmenting the factor graph with per-edge switch variables s_e in [0,1]:

```
f_robust = sum_e  s_e * rho(r_e)  +  sum_e (1 - s_e)^2
```

In the distributed setting, switch variables on inter-robot edges are held by the robot that detected the loop closure. During DPGO iterations, s_e is updated locally alongside the pose block. Less communication overhead than GNC but can get trapped at local optima. Used in DRACo-SLAM (acoustic SLAM): https://arxiv.org/pdf/2210.00867

**Recommendation:** PCM as a pre-filter (removes gross outliers before optimization enters) combined with GNC inside RBCD (handles remaining moderate outliers) is the state-of-practice combination as of 2024-2025.

---

## Communication Efficiency

### What Is Exchanged

Per RBCD iteration, robot alpha sends to each neighbor beta in N(alpha):

- **Public poses** — the SE(3) poses of nodes that appear in inter-robot edges: 7 floats per pose (quaternion + translation) = 28 bytes x n_pub poses.
- No raw sensor data, no local subgraph structure, no private poses.

For a robot with 10 shared poses: ~280 bytes per neighbor per iteration. For a 5-robot team with 5 shared poses per pair: ~5.6 KB total per iteration — negligible on WiFi (100 Mbps) or even 900 MHz radio (250 Kbps sufficient). Kimera-Multi transmits approximately 21-38% of what a centralized system would require.

### Descriptor Exchange for Loop Closure Detection

The communication bottleneck is not pose exchange but **point cloud descriptor exchange** for inter-robot place recognition:

| Descriptor | Approx. size | Used in |
|---|---|---|
| Scan Context (full) | ~40 KB | DiSCo-SLAM |
| LiDAR Iris | ~2-5 KB | DCL-SLAM |
| SOLiD | 20-1000x lighter than full Scan Context | SKiD-SLAM 2025 |

SKiD-SLAM (2025) reports 0.05-0.06 s latency over WiFi mesh for SOLiD descriptor transmission. [KISS-Matcher](./kiss-matcher.md) is used for the registration step (coarse-to-fine: global descriptor to local ICP refinement). For the full place recognition taxonomy see [Loop Closure and Place Recognition](./loop-closure-place-recognition.md) and [Scan Context Family](./scan-context-family.md).

### Sparsification of Inter-Robot Edges

Not all detected inter-robot loop closures should enter the pose graph. Redundant closures add communication cost without improving accuracy. Approaches:

- **Algebraic connectivity maximization (Khosoussi et al. 2019):** Select the subset of k edges that maximizes the second eigenvalue of the graph Laplacian (Fiedler value), ensuring connectivity without redundancy. Problem is NP-hard; greedy submodular approximation achieves (1 - 1/e) factor. https://arxiv.org/pdf/1901.05925
- **Loop closure prioritization (Sartipi and Tron, IROS 2022):** Ranks candidate edges by estimated pose uncertainty reduction; selects top-k within bandwidth budget. https://arxiv.org/pdf/2205.12402
- **Multi-level partitioning (IRBCD 2024):** KaHIP partitioning reduces the communication factor (sum external neighbors / total poses) from ~0.34 to 0.18 on tested datasets.

### ROBO Bandwidth

ROBO-3 (omega=3, overlap 3 graph-hops): 36 KB average per iteration; worst case 250 KB. All tested scenarios fit within 100 Mbps WiFi at at least 20 Hz optimization rate.

---

## Convergence Analysis

### Local-Optimum Guarantees

**RBCD / ASAPP / DGS:** Converge to first-order critical points (gradient norm approaches 0) at sublinear O(1/K) rate. No global optimality guarantee from the optimizer alone.

**DC2-PGO / DCORA:** The SDP relaxation is tight (globally optimal) under moderate measurement noise — formally when noise is below a problem-specific threshold. After RBCD converges, distributed verification certifies global optimality or triggers saddle escape. In practice the relaxation is tight on most real-world SLAM datasets.

**ROBO:** Inherits RBCD's O(1/K) rate; the speedup is in constant factor from better information propagation, not asymptotic rate change.

### Rate vs. Centralized

| Algorithm | Rate | vs. Centralized SE-Sync |
|---|---|---|
| DGS | O(1/K) local | ~10-100x slower iterations |
| RBCD | O(1/K) certified | Matches SE-Sync quality; ~3-10x more iterations |
| RBCD++ | O(1/K) + momentum | ~2x faster than RBCD |
| ASAPP | O(1/K) async | Comparable to sync under B <= 10 delay |
| GeoD | O(1/K) geodesic | 20x faster than DGS; near SE-Sync quality |
| ROBO-3 | O(1/K) overlapping | 3.1x faster iterations than AMM-PGO# |

Wall-clock convergence in Kimera-Multi: City dataset — RBCD 34.9 s (500 iterations) vs early-stopped RBCD (50 iterations): 2.76 s. Vicon Room 1 — RBCD 3.0 s (95 iterations); early-stopped: 1.5 s.

---

## Benchmark Results

### Kimera-Multi ATE (T-RO 2022 / arXiv 2011.04087)

Datasets: DCIST simulation (City, Camp) and EuRoC Vicon Room 1 and 2. Metric: ATE RMSE (meters) averaged across all robot trajectories.

| Dataset | Local PGO only | DGS | RBCD (full) | RBCD (ES-50 iter) | Centralized SE-Sync |
|---|---|---|---|---|---|
| City | 6.09 m | 2.62 m | **2.38 m** | 2.88 m | 1.46 m |
| Camp | 2.81 m | 2.58 m | **2.28 m** | 2.52 m | 2.28 m |
| Vicon Rm 1 | 0.455 m | 0.346 m | **0.317 m** | 0.348 m | 0.308 m |
| Vicon Rm 2 | 0.473 m | 0.503 m | **0.453 m** | 0.413 m | 0.453 m |

**Key finding:** Full RBCD matches or approaches centralized SE-Sync on all four datasets (Camp: 2.28 m vs 2.28 m; Vicon Rm 1: 0.317 m vs 0.308 m). Early-stopped RBCD (50 iterations) trades 10-20% ATE increase for 10-15x faster wall clock. Communication reduction vs naive centralized: 70% on Vicon Room 2.

### ASAPP Benchmarks (arXiv 2003.03281)

On 7 standard SLAM datasets (CSAIL 2D to Torus 3D), ASAPP achieves cost within 0.01-2% of the reference (Cartan-Sync) within 60 s. Translation RMSE < 1.2 m; rotation RMSE < 0.02 rad. Resilient to 0.1 s communication delays without parameter tuning.

### DC2-PGO Certification Benchmarks

9 robots, 125 poses each: RBCD++ reaches 10^-5 optimality gap in ~100 iterations (23 ms per block update). 49 robots (6125 poses total): gradient norm reaches 10^-2 in ~400 iterations. Killian Court dataset: distributed power iteration matches centralized Lanczos in convergence to machine-precision eigenvalues.

### SKiD-SLAM ATE (arXiv 2505.08230, 2025)

Two-robot teams across diverse outdoor, underground, and aerial field environments using SOLiD + KISS-Matcher + PCM + distributed PGO:

| Environment | Robot alpha ATE | Robot beta ATE |
|---|---|---|
| Aerial | 1.191 m | 1.058 m |
| Underground | 0.339 m | 0.403 m |
| Off-road | 0.300 m | 0.925 m |
| Planetary emulation | 0.198 m | 1.046 m |

WiFi mesh latency: 0.05-0.06 s per descriptor transmission.

---

## Inputs and Outputs

**Inputs (per robot):**
- Intra-robot pose graph: odometry factors (from [FAST-LIO2](./fast-lio-fast-lio2.md), [KISS-SLAM](./kiss-slam.md), LIO-SAM, or similar front-end) and intra-robot loop closure factors.
- Inter-robot loop closure factors: relative transform T_tilde_alpha_i,beta_j with information matrix, after geometric verification and outlier rejection.
- Public-pose indices: which local nodes are shared.

**Outputs:**
- Globally consistent SE(3) trajectory per robot, in a common reference frame.
- Convergence metrics: gradient norm, optimality gap, iteration count.
- Optional: dual certificate eigenvalue lambda_min(S(Y)) confirming or quantifying global optimality (DC2-PGO only).
- Aggregated map frame: each robot can transform its local LiDAR scan accumulation into the joint frame for global map merging.

---

## Architecture

The per-robot DPGO processing pipeline:

```
Per robot alpha:
  [Local SLAM front-end]
  |   (FAST-LIO2 / KISS-SLAM / LIO-SAM)
  |   -> local pose graph G_alpha = (X_alpha, E_alpha^odom)
  |
  [Keyframe extraction]
  |   every N meters or delta-yaw threshold
  |
  [Global descriptor extraction]
  |   (SOLiD / Scan Context / LiDAR Iris)
  |
  [Inter-robot loop closure detection]
  |   P2P descriptor broadcast to neighbors
  |   geometric verification via KISS-Matcher or TEASER++
  |
  [PCM outlier pre-filter]
  |   incremental maximum clique on pairwise consistency graph
  |   -> inlier cross-robot edges
  |
  [DPGO-RBCD backend (DC2-PGO)]
  |   receive F_alpha = sum_{beta in N(alpha)} Q_alpha_beta Y_beta
  |   update: Y_alpha <- Retr_{Y_alpha}(-gamma * grad f)
  |   exchange updated public poses Y_alpha^pub to neighbors
  |   (optional: GNC reweighting inside each RBCD step)
  |   (optional: distributed verification for DC2-PGO certificate)
  |
  [Joint optimized trajectory]
  |   project Y_alpha -> (R_alpha, t_alpha) in SE(3)
  |
  [Aggregated LiDAR map]
      voxel merge of per-robot scans in corrected frame
```

**Reference implementations:**
- FAST-LIO2: https://github.com/hku-mars/FAST_LIO
- DC2-PGO / DPGO-ROS: https://github.com/mit-acl/dpgo / https://github.com/mit-acl/dpgo_ros
- DCL-SLAM (FAST-LIO2 + distributed PGO): https://arxiv.org/abs/2210.11978
- DiSCo-SLAM (LIO-SAM + Scan Context + DGS): https://github.com/RobustFieldAutonomyLab/DiSCo-SLAM
- SKiD-SLAM (SOLiD + KISS-Matcher + PCM + DPGO): https://arxiv.org/abs/2505.08230

---

## Strengths and Failure Modes

### Strengths

**No single point of failure.** Each robot holds a complete local map. The team continues to operate even if one robot drops from the network; on re-contact, distributed PGO resumes from the last solution rather than restarting.

**Certifiable optimality (DC2-PGO).** Under moderate noise, RBCD + distributed verification produces a machine-checkable certificate confirming the solution matches the centralized SE-Sync global optimum. This is the only distributed backend offering this guarantee.

**Communication-efficient.** Public pose exchange is tens to hundreds of bytes per robot per iteration. Kimera-Multi transmits 21-38% of what a fully centralized system requires. ROBO-3's worst-case bandwidth is 250 KB per iteration — easily within 100 Mbps WiFi.

**Privacy-preserving.** Private trajectory segments never leave the owning robot. Only public poses (nodes incident to cross-robot edges) are shared, which is a strict subset of each robot's full history.

**Asynchronous operation (ASAPP).** O(1/K) convergence is maintained even with up to B iterations of staleness in neighbor estimates. Resilient to 0.1 s communication delays without parameter tuning.

**Outlier robustness (PCM + GNC).** Two-layer rejection demonstrated at more than 50% spurious loop closure rates in Kimera-Multi simulation experiments. See [Kimera-Multi](./kimera-multi.md) for the 80% outlier simulation result.

### Failure Modes

**Bad inter-robot loop closures.** A few false cross-robot factors can corrupt the entire team map if they pass both PCM and GNC. The "false clique" problem — locally consistent but globally incorrect loop closures — is identified as the primary remaining failure mode at large scale.

**Disconnected communication or measurement graph.** Robots without inter-robot links cannot be globally aligned. Pre-planned rendezvous waypoints or mesh networking (UWB relays) are required.

**Initialization sensitivity.** Some distributed methods are sensitive to initial frame offsets. DC2-PGO's SDP relaxation is initialization-free in principle, but the Kimera-Multi two-stage approach (GNC frame initialization first) is the recommended engineering practice.

**RBCD convergence time grows with inter-robot edges.** Each new cross-robot loop closure adds a coupling term. With N robots and O(N^2) potential cross-robot edges, per-iteration cost grows. Practical at 8-10 robots; scalability beyond 15-20 robots is unverified in field conditions.

**Network delay and packet loss.** Synchronous RBCD stalls on slow robots or weak links. Use ASAPP for intermittently connected teams.

**Geometric ambiguity (feature-poor environments).** Airport aprons, tunnels, and featureless corridors produce spurious loop closures that challenge PCM. Semantic-aided descriptors or GNSS-prior constraints are required mitigations.

**ROS 1 dependency in reference systems.** DCL-SLAM, DiSCo-SLAM, and Kimera-Multi target ROS 1. Swarm-SLAM is the ROS 2 native alternative for LiDAR-primary teams.

**Certificate failure under anisotropic noise.** If pose-graph edges carry strongly anisotropic (matrix-weighted) noise — e.g., combining LiDAR edges (near-isotropic) with 4D radar edges (anisotropic in azimuth/elevation) — the SDP relaxation can lose tightness even at low absolute noise. Adding redundant constraints restores tightness. See [Certifiable Pose Graph Optimization](./certifiable-pose-graph-optimization.md) for the matrix-weighted failure mode.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Outdoor campus / urban survey (stereo + IMU) | High | Kimera-Multi demonstrated at 8 robots / 8 km |
| Multi-robot LiDAR survey (outdoor, structured) | High | DCL-SLAM, SKiD-SLAM; swap DGS backend for RBCD |
| Airside survey (LiDAR multi-vehicle) | Moderate-High | FAST-LIO2 + SOLiD + PCM + DPGO-RBCD is the architecturally sound stack; geometric ambiguity on apron is a research-stage gap |
| Indoor warehouse (multi-AGV mapping) | Moderate | ISO 3691-4 context; LiDAR-primary; DGS backends adequate; RBCD preferred for audit trail |
| Port / logistics-yard multi-vehicle | Moderate | Large structured environments; scale manageable; antenna range on open yards favorable |
| Underground / mining multi-robot | Moderate | DARPA SubT reference (LAMP 2.0 centralized LiDAR); distributed LiDAR DPGO feasible but not demonstrated at SubT scale |
| Agricultural multi-robot | Moderate | Open-sky GNSS assists frame initialization; team size typically small |
| Delivery robot shared indoor map | Low-Moderate | Small teams; ROS 2 and privacy constraints are friction; Swarm-SLAM preferred |
| Online AV runtime localization | Not suitable | Iterative convergence latency incompatible with 10 Hz control loop; use GTSAM-iSAM2 |

---

## Aggregated-Map Suitability — Airside Multi-Vehicle Survey

### Architecturally Sound LiDAR Stack

For airside (apron, taxiway, terminal) multi-vehicle survey, the following combination is the architecturally sound LiDAR multi-vehicle distributed mapping stack:

```
Per vehicle:
  FAST-LIO2 (iter-22)
  |   LiDAR-IMU front-end, tightly coupled iEKF
  |   -> local keyframe pose graph
  |
  SOLiD or Scan Context descriptor
  |   compact global place signature for loop closure detection
  |   SOLiD: 20-1000x lighter than full Scan Context
  |
  KISS-Matcher (iter-35 sibling)
  |   coarse-to-fine point cloud registration
  |   geometric verification of inter-vehicle loop closure candidates
  |
  PCM outlier rejection (Kimera-RPGO pattern)
  |   maximum clique on pairwise consistency graph
  |   -> verified cross-vehicle loop closure edges
  |
  DPGO-RBCD backend (DC2-PGO)
  |   distributed joint pose-graph optimization
  |   optional: DC2-PGO distributed certificate for audit dossier
  |
  Aggregated LiDAR map
      global voxel hash-map with pose-corrected insertion
```

This stack draws on [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) for the front-end, [KISS-Matcher](./kiss-matcher.md) for registration, [Scan Context Family](./scan-context-family.md) or SOLiD for place recognition, and [Kimera-RPGO and PCM](./kimera-rpgo-pcm.md) for outlier rejection, feeding into DPGO-RBCD as the certifiable joint backend.

### Closest Off-Shelf System: DCL-SLAM

DCL-SLAM (Zhong et al. 2024, IEEE Sensors Journal) is front-end agnostic; [FAST-LIO2](./fast-lio-fast-lio2.md) is one of its tested front-ends. It uses LiDAR Iris descriptors (~2-5 KB) for bandwidth-efficient inter-robot loop closure, and a DGS-based distributed PGO backend with spurious loop rejection. Published ATE outperforms DiSCo-SLAM and DGS-only baselines on tested datasets.

**Recommended integration path:** Fork DCL-SLAM's modular architecture; swap the DGS backend for dpgo_ros RBCD; integrate SOLiD descriptors; add PCM pre-filter before optimization.

### Airside-Specific Considerations

**Geometric ambiguity.** Airport aprons are predominantly flat, open, and geometrically repetitive (taxiway markings, aircraft stands). LiDAR loop closure based purely on geometric descriptors finds spurious matches between similar-looking apron sections. Mitigations: (1) semantic-aided descriptors integrating apron marking labels from the perception stack (see [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md)); (2) GNSS-prior soft constraints where GNSS is reliable; (3) timing-based rejection — two vehicles cannot have been at the same location if their timestamps differ by more than the feasible transit time.

**Bandwidth.** Airside vehicles typically operate within 802.11ac WiFi on airport infrastructure. 100 Mbps is achievable within the apron area. RBCD pose exchange (< 1 KB per robot per iteration) is negligible. SOLiD descriptor exchange (~100 bytes) is trivial. [KISS-Matcher](./kiss-matcher.md) verification happens locally after descriptor matching; no raw point cloud transmission is required.

**Team size.** A typical airside survey involves 2-4 vehicles (pushback tractors, baggage tractors, survey UTVs). DC2-PGO scales well to this team size; SKiD-SLAM demonstrates two-robot performance in analogous outdoor environments (see Benchmark Results).

**Map merging.** Cross-vehicle map merging — combining individual robot voxel maps after DPGO convergence — requires a global voxel hash-map with pose-corrected insertion rather than naively concatenating transformed point clouds (which introduces duplicate points). This is analogous to FAST-LIO2's ikd-tree but shared across robots.

### Honest Maturity Assessment

**Centralized visual-inertial [Kimera-Multi](./kimera-multi.md)** (iter-33 reference system): Production-level maturity; tested on MIT campus 8 km trajectories; well-maintained; strong community.

**LiDAR multi-robot distributed DPGO:** Research-stage but feasible. Key gaps as of mid-2026:

- No single system combines FAST-LIO2 + RBCD + certifiable verification in a ROS2-native, production-ready package.
- DCL-SLAM and DiSCo-SLAM use DGS (not certified RBCD); DC2-PGO is certified but tested only in simulation at scale.
- SKiD-SLAM (2025) is the closest to an outdoor multi-robot LiDAR system with modern components but not validated in airside geometry.
- **Airside geometric ambiguity** (repetitive apron structure) is a research-stage gap with no published solution for DPGO-specific loop closure disambiguation in airport environments.

For comparison with the neural-Gaussian approach to multi-agent mapping, see [Multi-Agent Neural Gaussian SLAM](./multi-agent-neural-gaussian-slam.md) (iter-31) — as of 2026 the best multi-agent neural Gaussian result (GRAND-SLAM at 4.99 m ATE) is approximately 2.2x worse than Kimera-Multi (2.28 m) on comparable outdoor sequences, while requiring a centralized server and not running in real time.

---

## Implementation Notes

- **Start with centralized optimization as a reference solution.** Run a centralized SE-Sync or GTSAM-iSAM2 solution on all robot data, then compare distributed convergence, communication cost, and ATE. Any systematic discrepancy signals a modeling error.
- **DPGO is C++ with a ROS 1 wrapper.** The dpgo library provides synchronous and asynchronous distributed PGO examples. dpgo_ros is the ROS wrapper used by Kimera-Multi. No official ROS 2 migration. Swarm-SLAM is the native ROS 2 alternative for LiDAR-primary teams.
- **Use one canonical transform convention for all inter-robot factors.** Cross-robot transforms are easy to invert, timestamp incorrectly, or apply in the wrong frame. Encode the convention in tests before integration.
- **Set conservative place recognition thresholds in new environments.** Default descriptor similarity thresholds and RANSAC inlier thresholds are tuned on benchmark sequences. Tighter thresholds reduce false positive loop closures at the cost of fewer accepted inter-robot constraints.
- **Bound graph growth with submaps or keyframes.** Full keyframe sharing can become expensive at high rates. Trigger keyframe extraction on motion threshold (e.g., 1-2 m translation or 5-10 degree rotation).
- **Measure communication bytes per iteration, not only final ATE.** In bandwidth-constrained environments (900 MHz radio, satellite uplink), the descriptor exchange is the bottleneck, not pose exchange.
- **Separate map optimization from live control-frame pose publication.** The distributed optimization loop runs asynchronously; the vehicle's live odometry frame must remain smooth regardless of backend convergence state. Publish a corrected global frame transform; do not inject PGO corrections into the odometry integrator.
- **Log communication delay, accepted cross-robot edges, and graph corrections for audit.** In airside deployments, regulatory dossiers (ISO 3691-4) require traceability of map construction steps.
- **Use COSMO-Bench for evaluation.** Provides collaborative optimization datasets in JSON Robot Log format with intra-robot and inter-robot loop closure labels, including outlier factors. https://www.cosmobench.com/

---

## Related Repository Docs

- [Kimera-Multi](./kimera-multi.md) — production-grade distributed visual-inertial multi-robot SLAM system using DPGO-RBCD as its backend
- [Certifiable Pose Graph Optimization](./certifiable-pose-graph-optimization.md) — SE-Sync, Shonan, DC2-PGO, and DCORA certifiability framework
- [Kimera-RPGO and PCM](./kimera-rpgo-pcm.md) — robust single/multi-robot PGO with pairwise consistency maximization
- [Multi-Agent Neural Gaussian SLAM](./multi-agent-neural-gaussian-slam.md) — neural Gaussian SLAM multi-agent alternative; cross-paradigm comparison context
- [Loop Closure and Place Recognition](./loop-closure-place-recognition.md) — descriptor families and geometric verification for inter-robot loop closure detection
- [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) — LiDAR-IMU front-end odometry for each robot in the stack
- [KISS-ICP](./kiss-icp.md) — lightweight scan-to-scan LiDAR odometry alternative
- [KISS-SLAM](./kiss-slam.md) — full-stack single-robot LiDAR SLAM front-end
- [KISS-Matcher](./kiss-matcher.md) — coarse-to-fine point cloud registration for inter-robot loop closure verification
- [Scan Context Family](./scan-context-family.md) — ring-based LiDAR place recognition descriptors
- [Learned LiDAR Place Recognition](./learned-lidar-place-recognition.md) — neural place recognition for robust inter-robot loop closure detection
- [D2-SLAM](./d2slam.md) — decentralized distributed SLAM system comparison
- [COVINS / COVINS-G](./covins-covins-g.md) — centralized server multi-robot SLAM comparison
- [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) — downstream semantic annotation of the aggregated multi-robot map
- [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) — mathematical foundations for SE(3) pose graph optimization
- [GraphSLAM and Pose Graph Optimization](graphslam-pose-graph-optimization.md) — single-robot pose graph backend foundations
- [Robust Pose Graph Optimization with GNC and riSAM](robust-pgo-gnc-risam.md) — single-graph robust optimization methods
- [COSMO-Bench](cosmo-bench.md) — collaborative SLAM optimization benchmark and dataset

---

## Sources

**Primary papers:**
- Tian, Khosoussi, Rosen, How. "Distributed Certifiably Correct Pose-Graph Optimization." IEEE T-RO 2021: https://arxiv.org/abs/1911.03721
- DC2-PGO PMC full text: https://pmc.ncbi.nlm.nih.gov/articles/PMC8819718/
- Tian, Koppel, Bedi, How. "Asynchronous and Parallel Distributed Pose Graph Optimization." IEEE RA-L 2020: https://arxiv.org/abs/2003.03281
- Tian, Chang, et al. "Kimera-Multi: Robust, Distributed, Dense Metric-Semantic SLAM for Multi-Robot Systems." IEEE T-RO 2022: https://arxiv.org/abs/2106.14386
- Kimera-Multi system paper (ICRA 2021): https://arxiv.org/abs/2011.04087
- Li et al. "Distributed Pose-Graph Optimization with Multi-Level Partitioning for Collaborative SLAM." arXiv 2401.01657 (2024): https://arxiv.org/abs/2401.01657
- ROBO (Riemannian Overlapping Block Optimization, 2025): https://arxiv.org/abs/2603.03499
- Thoms, Papalia, Velasquez, Rosen. "DCORA: Distributed Certifiable Range-Aided SLAM." ICRA 2025: https://github.com/adthoms/dcora
- SKiD-SLAM (2025): https://arxiv.org/abs/2505.08230
- DOOR-SLAM (Lajoie et al. 2020): https://arxiv.org/abs/1909.12198
- PCM (Mangelson et al. ICRA 2018): https://ieeexplore.ieee.org/document/8460217/
- ADMM-PGO (Springer 2025): https://link.springer.com/article/10.1007/s10846-025-02257-w
- ADMM tutorial: https://arxiv.org/pdf/2410.03753

**GitHub repositories:**
- DPGO library: https://github.com/mit-acl/dpgo
- DPGO ROS wrapper: https://github.com/mit-acl/dpgo_ros
- Kimera-Multi: https://github.com/MIT-SPARK/Kimera-Multi
- Kimera-RPGO: https://github.com/MIT-SPARK/Kimera-RPGO
- DCL-SLAM: https://arxiv.org/abs/2210.11978
- DiSCo-SLAM: https://github.com/RobustFieldAutonomyLab/DiSCo-SLAM
- DCORA: https://github.com/adthoms/dcora
- FAST-LIO2: https://github.com/hku-mars/FAST_LIO
- COSMO-Bench: https://www.cosmobench.com/

**Communication sparsification:**
- Algebraic connectivity maximization: https://arxiv.org/pdf/1901.05925
- Loop closure prioritization: https://arxiv.org/pdf/2205.12402

**Related algorithms:**
- GeoD (Cristofalo et al. 2020): https://arxiv.org/abs/2010.00156
- SE-Sync (Rosen et al. IJRR 2019): https://arxiv.org/pdf/1612.07386
- McGann, Potokar, Kaess. "COSMO-Bench: A Benchmark for Collaborative SLAM Optimization." 2025: https://arxiv.org/abs/2508.16731
