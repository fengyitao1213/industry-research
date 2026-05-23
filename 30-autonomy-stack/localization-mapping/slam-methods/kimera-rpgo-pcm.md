# Kimera-RPGO and Pairwise Consistency Maximization

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method-family"
  stage: "modern-core"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "validation", "runtime-localization"]
  reason: "Kimera-RPGO and Pairwise Consistency Maximization is rated for robust or collaborative backend design in multi-session SLAM and validation."
method-priority:end -->

Related docs: [Kimera-VIO](./kimera-vio.md) · [Kimera-Multi](./kimera-multi.md) · [Certifiable Pose Graph Optimization](./certifiable-pose-graph-optimization.md) · [Distributed Multi-Robot PGO](./distributed-multi-robot-pgo.md) · [Loop Closure and Place Recognition](./loop-closure-place-recognition.md) · [KISS-Matcher](./kiss-matcher.md) · [Scan Context Family](./scan-context-family.md) · [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) · [LIO-SAM](./lio-sam.md) · [HDL Graph SLAM](./hdl-graph-slam.md) · [Robust Pose Graph Optimization with GNC and riSAM](./robust-pgo-gnc-risam.md) · [GraphSLAM and Pose Graph Optimization](./graphslam-pose-graph-optimization.md) · [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) · [Point Cloud Registration — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md)

**Last updated:** 2026-05-24

---

## What It Is

**Kimera-RPGO** is the robust pose-graph optimization (PGO) backend of the MIT SPARK Lab Kimera ecosystem. Its central job is to take a stream of odometry edges and loop-closure candidate edges from any SLAM front-end and produce a globally consistent trajectory by accepting true loop closures and discarding outliers. The outlier rejection mechanism is **Pairwise Consistency Maximization (PCM)**, originally published by Mangelson, Dominic, Eustice, and Vasudevan (ICRA 2018) in the context of multi-robot map merging.

PCM is categorically different from single-edge robust kernels (Huber, Cauchy, DCS, Switchable Constraints). A single-edge kernel looks at each loop closure in isolation — asking whether its residual under the current state estimate is large. PCM asks whether a collection of loop closures is **globally consistent with each other and with the odometry structure**. This global consistency test is the correct tool when the danger is not one rogue measurement but a cluster of perceptually aliased false closures that appear individually plausible yet collectively corrupt the map.

Kimera-RPGO is released under BSD-2-Clause at https://github.com/MIT-SPARK/Kimera-RPGO. The backend is written in C++ (~95%) with a GTSAM factor-graph core and supports PCM, Graduated Non-Convexity (GNC), or both in sequence. As of Kimera2 (2024, arXiv:2401.06323), GNC is the default for single-robot scenarios; PCM remains available and is recommended for adversarial-cluster environments or when hard binary accept/reject decisions are needed for map quality control.

**Primary citations:**
- Mangelson, Dominic, Eustice, Vasudevan. "Pairwise Consistent Measurement Set Maximization for Robust Multi-Robot Map Merging." ICRA 2018. DOI: 10.1109/ICRA.2018.8460217
- Rosinol, Abate, Chang, Carlone. "Kimera: an Open-Source Library for Real-Time Metric-Semantic Localization and Mapping." ICRA 2020. arXiv:1910.02490

---

## Core Technical Idea

### Why Outlier Loop Closures Are Catastrophic

Pose-graph SLAM accumulates robot poses as nodes connected by two types of edges: **odometry edges** (sequential, reliable, low drift per step) and **loop-closure edges** (long-range, high uncertainty, frequently wrong). A single incorrect loop closure injected into the graph and weighted alongside correct ones can warp the entire trajectory to satisfy a false geometric constraint. The optimizer has no reason to reject it — a single bad edge with plausible covariance looks indistinguishable from a correct edge.

Single-edge robust kernels (Huber, Cauchy, Geman-McClure, DCS, Switchable Constraints) down-weight or de-activate individual edges based on their own residual after optimization. This has a critical failure mode: **if a cluster of mutually consistent false loop closures is present** — produced by perceptual aliasing from a repetitive environment — the cluster can overwhelm the inlier signal. Every false closure in the cluster looks geometrically consistent with the others, so per-edge reweighting cannot distinguish it from the true inlier set.

### The Adversarial Cluster Problem

Consider a repetitive airport apron with identical taxiway markings every 200 m. A descriptor-based loop closure detector may produce ten false candidates between visually similar but geometrically wrong locations. These ten false candidates may all be geometrically consistent with each other — they map the same-looking region to the same-looking region in a way that is internally coherent. An edge-level robust kernel sees ten residuals that are all small after optimization, misclassifies all ten as inliers, and the trajectory collapses.

PCM: each false candidate is checked against all true inlier candidates via the odometry backbone. Because false candidates do not compose correctly with the true odometry, they fail the chi-squared cycle test against the true loop closures. They may form a small clique among themselves, but a smaller clique than the true inlier set.

PCM was originally motivated by multi-robot SLAM, where two robots mapping independently must determine which inter-robot loop closures are real overlaps. In this regime there is often no reliable shared odometry connecting the two maps, making single-edge methods even weaker.

---

## Operator Mechanics — PCM in Detail

### Notation

- Robot trajectory: poses in SE(3) (or SE(2) for 2D).
- **Odometry measurement:** relative transform between consecutive poses, composable via dead-reckoning into a path estimate `T_ab^odom` for any pair (a, b).
- **Loop-closure candidate:** purported relative transform `z_ac` between non-consecutive poses a and c, returned by place recognition and geometric verification.

For the underlying SE(3) Lie-group mathematics used throughout see [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md).

### Pairwise Consistency Test

Two loop closures `z_ac` and `z_bd` (where a, c and b, d are poses in the robot's chain, or from two different robots) are **pairwise consistent** if composing them around the quadrilateral they form — using odometry to bridge gaps — yields a result close to the identity. The composed cycle transformation is:

```
e_cycle = z_ac^{-1}  o  T_ab^{odom}  o  z_bd  o  T_dc^{odom,-1}
```

where `o` denotes SE(3) composition. If both loop closures are correct, the cycle closes to the identity: `e_cycle ≈ I`. In the Lie algebra, the cycle residual is:

```
eps = log(e_cycle)  in  R^6
```

(three rotation + three translation components via the SE(3) logarithm map). The **consistency test** is a Mahalanobis distance test:

```
eps^T  Sigma_cycle^{-1}  eps  <=  chi2_{6, alpha}
```

where `Sigma_cycle` is the propagated covariance around the cycle (accumulated from odometry and both loop-closure noise models) and `chi2_{6, alpha}` is the chi-squared threshold at significance level alpha with 6 degrees of freedom.

In Kimera-RPGO's implementation the threshold is set via two separate parameters — a **translation threshold** (meters) and a **rotation threshold** (radians) — applied to the Euclidean norms of the translation and rotation parts of `eps` independently (`setPcm3DParams(t_thresh, R_thresh)`). Thresholds below zero disable the corresponding check.

### The Consistency Graph and Maximum Clique

1. Collect all n loop-closure candidates from the front-end.
2. Build an **undirected consistency graph** `G_C = (V, E)`:
   - Each candidate loop closure is a node `v_i` in V.
   - An edge `(v_i, v_j)` is added if and only if loop closures i and j pass the pairwise consistency test.
3. Find the **maximum clique** of `G_C`: the largest subset of nodes that are all mutually connected — every pair within the subset is pairwise consistent.
4. The maximum clique is the **inlier set**. All remaining loop closures are rejected.

The intuition: real loop closures all agree with the true geometry, so they form a large mutual clique. False loop closures may be individually consistent with a few others by chance, but a large fully-connected set of mutually consistent false closures is statistically very unlikely.

The inlier selection problem is:

```
maximize |S|
subject to: A_ab = 1 for all a, b in S
```

where `A_ab = 1` iff loop closures a and b are pairwise consistent. This is the maximum clique problem, NP-hard in general but tractable in practice for SLAM graphs — see Computational Efficiency below.

---

## Architecture and Pipeline

### Full Stack (Single Robot, Online)

```
LiDAR / Camera front-end
    |  keyframe poses + descriptors
    v
Place Recognition
    (Scan Context, DBoW2, NetVLAD, KISS-Matcher)
    |  loop closure candidates (i, j, T_rel, Sigma_lc)
    v
Geometric Verification
    (RANSAC / ICP refinement -> refined T_rel + covariance)
    |
    v
[Kimera-RPGO]
    |-- Odometry factor graph (incremental, trusted)
    |-- PCM Filter:
    |       build/update consistency graph G_C
    |       run incremental max-clique search -> inlier set S
    |-- GTSAM Optimizer (Levenberg-Marquardt or Gauss-Newton):
    |       optimize over odometry edges + edges in S
    |       +/- GNC robust kernel on remaining edges
    v
Globally consistent pose graph -> 3D map / mesh
```

### Front-End Interface

Kimera-RPGO is front-end agnostic. It expects:
- **Odometry factors:** `BetweenFactor<Pose3>` in GTSAM notation, sequential pose pairs with covariance.
- **Loop-closure candidates:** `BetweenFactor<Pose3>` with relative transform and covariance, indexed by pose keys.

Primary API:
- `pgo->update(new_factors, new_values)` — incremental add and optimize.
- `pgo->loadGraph(factors, values)` — batch initialization.
- `pgo->addGraph(factors, values)` — multi-robot merge.

### GTSAM Build Requirements

Required GTSAM compile flags:

```
-DGTSAM_POSE3_EXPMAP=ON
-DGTSAM_ROT3_EXPMAP=ON
-DSLOW_BUT_CORRECT_BETWEENFACTOR=ON   # correct Jacobians for loop closures
```

GTSAM version tested: commit `686e16aaae26c9a4f23d4af7f2d4a504125ec9c3` (approximately GTSAM 4.2a8). Solvers available: Levenberg-Marquardt (default), Gauss-Newton.

---

## Inputs and Outputs

**Inputs:** Odometry factors (`BetweenFactor<Pose3>` with covariance); loop-closure candidates (relative-pose constraints with covariance); PCM threshold parameters (translation threshold in m, rotation threshold in rad); solver selection (`setNoRejection()`, `setPCM()`, `setGNC()`, or PCM pre-filter + GNC).

**Outputs:** Consistent inlier subset of accepted loop closures; globally optimized pose graph (keyframe SE(3) poses); per-edge GNC weights via `pgo->getGncWeights()`; rejected-candidate log exportable via `pgo->saveData(output_dir)` in g2o format.

---

## Robust Kernels Integrated

### GNC — Graduated Non-Convexity

GNC (Yang, Antonante, Tzoumas, Carlone — RA-L 2020) formulates outlier rejection as a continuous relaxation of a combinatorial problem. Each measurement is assigned an inlierness weight `w_i` in [0, 1]. A regularization term begins convex and is gradually made more non-convex (via a control parameter mu) to drive weights toward binary values.

For the **Geman-McClure kernel**:

```
rho_mu(r^2) = mu * r^2 / (mu + r^2)
```

As mu decreases from large (approximately least-squares) to small (approximately hard threshold), the kernel transitions from convex to deeply non-convex. At each mu value a weighted least-squares problem is solved; weights from the previous step initialize the next. The schedule is analytic — no manual step size tuning. GNC was integrated into Kimera-RPGO and Kimera-PGMO in the Kimera2 update (arXiv:2401.06323, 2024), replacing PCM as the default outlier rejection method for single-robot scenarios.

### PCM + GNC: Two-Layer Robustness

The two methods are complementary and can be stacked:

| Layer | Method | What it rejects | When it runs |
|---|---|---|---|
| 1 — Global pre-filter | PCM (max clique) | Globally inconsistent loop closures | Before optimization |
| 2 — Local per-edge | GNC (graduated weights) | Residual outliers with large per-edge cost | During optimization |

Layer 1 (PCM) dramatically reduces the number of outliers passed to the optimizer. Layer 2 (GNC) handles residual false positives that survived PCM — closures that are consistent with the odometry chain but still slightly wrong — and provides smooth convergence. In Kimera-Multi T-RO 2022, the distributed back-end uses GNC-on-top-of-PCM: PCM filters inter-robot loop closures, then distributed GNC (built on the RBCD solver) handles final optimization with per-edge weights.

### Other Kernels Supported

`RobustSolverParams` exposes three modes: **No rejection** (vanilla LS, debugging); **GNC only** (Kimera2 default); **PCM only** (original Kimera default). Historic per-edge alternatives — DCS (Agarwal, ICRA 2013), Switchable Constraints (Sunderhauf, IROS 2012), Huber/Cauchy in GTSAM — all lack global consistency and fail under adversarial clusters.

---

## Computational Efficiency

### Incremental PCM

Batch PCM (re-solve maximum clique from scratch with every new candidate) is impractical for online operation. Kimera-RPGO implements **incremental PCM**:

1. When a new loop-closure candidate `v_new` arrives, compute its pairwise consistency with all existing candidates.
2. Update the consistency graph `G_C` by adding node `v_new` and edges to consistent partners.
3. Key observation: if `v_new` is not connected to any member of the current maximum clique, the previous clique remains optimal. Only if `v_new` is connected to at least one clique member is a re-search needed — and the search is restricted to the neighborhood of `v_new`.
4. Use knowledge of the previous clique size to prune the branch-and-bound search tree.

This reduces outlier-rejection runtime to **1–10 ms per new candidate** in practice. (Note: this figure comes from the general literature on incremental max-clique solvers; no specific Kimera-RPGO profiling number was found in public documentation — treat as an approximate order-of-magnitude estimate.)

### Max-Clique Solver

The maximum clique problem is NP-hard in general, but SLAM consistency graphs are sparse and the clique structure is simple in practice: a large inlier clique plus scattered false edges. Kimera-RPGO uses a **fast maximum clique solver** adapted from Pattabiraman et al. "Fast Algorithms for the Maximum Clique Problem on Massive Graphs" (Internet Mathematics, 2013/2014), developed at Northwestern. It uses graph coloring to compute upper bounds on clique size and prune the branch-and-bound tree efficiently.

| Operation | Typical cost |
|---|---|
| Pairwise consistency check (one pair) | < 0.1 ms (matrix compose + chi-squared test) |
| Incremental max-clique update (new candidate, moderate graph) | 1–10 ms (approximate) |
| Batch max-clique re-solve (N ~100 candidates) | tens of ms to low seconds |
| GTSAM LM optimization (after PCM, typical graph) | 10–100 ms |

---

## Implementations

### MIT-SPARK/Kimera-RPGO

**URL:** https://github.com/MIT-SPARK/Kimera-RPGO
**Language:** C++ (95.7%), CMake (4.3%)
**License:** BSD-2-Clause

Key classes:
- `RobustSolver` — main backend; inherits `GenericSolver`; wraps GTSAM `NonlinearFactorGraph` and `Values`.
- `OutlierRemoval` — abstract interface; concrete implementations: `PCM`, `GNC`.
- `RobustSolverParams` — configuration struct.

Key methods:

```cpp
pgo->update(new_factors, new_values);           // incremental add + optimize
pgo->loadGraph(factors, values);                // batch initialization
pgo->addGraph(factors, values);                 // multi-robot merge
pgo->removeLastLoopClosure(prefix_a, prefix_b); // undo by robot pair
pgo->ignorePrefix(prefix);                      // disable one robot's loop closures
pgo->getGncWeights();                           // retrieve per-edge GNC weights
pgo->saveData(output_dir);                      // export g2o + outlier log
```

Standalone testing: `./RpgoReadG2o [2d|3d] <file.g2o> <thresholds> <output-dir>`

**ROS wrapper:** Not included in Kimera-RPGO itself. ROS integration is handled by Kimera-VIO-ROS and Kimera-Distributed packages. The wrapper situation for LiDAR-only ROS 2 deployments should be independently verified — no confirmed native ROS 2 support was found in available documentation.

**Kimera-Multi sub-repos:** https://github.com/MIT-SPARK/Kimera-Multi (index) · https://github.com/MIT-SPARK/Kimera-Distributed (distributed PGO + PCM) · https://github.com/MIT-SPARK/Kimera-Multi-LCD (loop closure detection)

**Third-party reference:** https://github.com/U-AMC/PCM_gtsam — lightweight Python/GTSAM example of the PCM cycle-consistency formula; useful before using the C++ library.

---

## For Multi-Robot: Distributed PCM

### DOOR-SLAM — Foundational Distributed PCM

DOOR-SLAM (Lajoie, Ramtoula et al., arXiv:1909.12198) demonstrated distributed PCM for multi-robot teams: each robot runs a local PCM instance; robots exchange only BoW descriptors (not raw scans) and request 3D keypoints for geometric verification on BoW match; verified loop closures (at least 15 RANSAC inliers) are admitted to the distributed PCM graph. Communication cost: 21–38% of centralized bandwidth.

### Kimera-Multi ICRA 2021 — Incremental Distributed PCM

Kimera-Multi ICRA 2021 (arXiv:2011.04087) extended DOOR-SLAM with an incremental maximum-clique heuristic for lower latency. Protocol:

1. Robot `R_a` detects a putative inter-robot loop closure to `R_b`, requests 3D keypoints via peer-to-peer comms.
2. `R_b` sends keypoints; `R_a` runs Arun's 3-point RANSAC; if at least 15 inliers, admits as a candidate.
3. Candidate entered into `R_a`'s PCM graph; incremental max-clique update.
4. Accepted inter-robot loop closures broadcast to the team.
5. RBCD solver runs distributed PGO on the combined factor graph.

The incremental heuristic "significantly reduces the outlier rejection runtime while producing cliques of comparable size" to the batch maximum clique. See [Kimera-Multi](./kimera-multi.md) for the full multi-robot architecture.

### Kimera-Multi T-RO 2022 — Distributed GNC Replaces PCM

The T-RO 2022 paper (arXiv:2106.14386) replaced the PCM-only approach with a two-stage distributed GNC:
- Stage 1: GNC estimates relative frame transforms between each robot pair (coarse alignment).
- Stage 2: Distributed GNC built on RBCD for joint PGO with per-edge weights.

The paper notes that pure PCM "has low recall" — it tends to reject some true inter-robot loop closures whose odometry chain is uncertain, making the chi-squared test conservative. Distributed GNC relaxes this by operating in probability space rather than making hard binary decisions. Scale: up to 8 robots, 8 km total trajectories. King-Sun Fu Memorial Best Paper Award, IEEE T-RO 2022. See [Distributed Multi-Robot PGO](./distributed-multi-robot-pgo.md) for the full treatment of the RBCD and DPGO solvers.

---

## Benchmark Results

### EuRoC — Threshold Sensitivity (Kimera ICRA 2020)

Testing on EuRoC V1_01 with the DBoW2 score threshold alpha varied:

| alpha | ATE without PCM | ATE with PCM |
|---|---|---|
| 10 (conservative) | 0.05 m | 0.05 m |
| 0.001 (permissive, many false positives) | 1.59 m | 0.049 m |

PCM neutralizes the effect of front-end threshold choice over a 10,000x range. Kimera is "fairly insensitive to the choice of alpha" when PCM is active — critical in production deployments where the optimal threshold is environment-dependent.

EuRoC ATE by sequence with PCM active (Table II, ICRA 2020 paper):

| Sequence | ATE RMSE |
|---|---|
| MH_1 | 0.08 m |
| MH_2 | 0.09 m |
| MH_3 | 0.11 m |
| V1_1 | 0.05 m |

### Multi-Robot — Kimera-Multi ICRA 2021

| Dataset | RBCD ATE | DGS ATE | SE-Sync (centralized) ATE |
|---|---|---|---|
| Camp (sim, 3 robots) | 2.28 m | 2.58 m | 2.28 m |
| City (sim, 3 robots) | 2.38 m | 2.62 m | 1.46 m |
| EuRoC VR1 (3-robot) | 0.317 m | 0.346 m | 0.308 m |
| EuRoC VR2 (3-robot) | 0.453 m | 0.503 m | 0.453 m |

PCM-based outlier rejection was a prerequisite for all these results; without it, RBCD and DGS diverge on the simulated datasets with injected outliers.

### PCM vs. Competing Outlier Rejection Methods (Mangelson ICRA 2018)

PCM was benchmarked against DCS, SCGP (Spatial Consistency Graph Partitioning), and RANSAC on synthetic and real-world multi-robot datasets. The paper reports PCM **significantly outperforms all three** on both precision (fewer incorrectly accepted outliers) and recall (more true inliers accepted). DCS and SCGP fail particularly on adversarial clustered false positives; PCM's global consistency criterion rejects these.

Note: exact precision/recall numbers are not reproduced here — they are in Table I of the ICRA 2018 paper, which is behind the IEEE paywall. The relative performance claims are from the paper's own summary.

Note: No confirmed benchmark of Kimera-RPGO specifically on KITTI with LiDAR was found. The EuRoC results above are visual-inertial. For LiDAR deployments, practitioners should evaluate on their own dataset.

---

## Strengths

**Global consistency, not per-edge residual.** PCM checks all candidate loop closures simultaneously before optimization — categorically more powerful than single-edge reweighting when adversarial clusters are present.

**Two-layer stack with GNC.** PCM eliminates globally inconsistent clusters; per-edge GNC handles residual noise. Neither alone is as strong as both together.

**Threshold-insensitive front-end.** A 10,000x range in DBoW2 threshold produces identical ATE when PCM is active, decoupling front-end tuning from backend correctness.

**Tractable in practice.** The Pattabiraman solver with incremental updates keeps per-candidate cost at 1–10 ms despite NP-hard worst case.

**BSD-2-Clause license.** Integration-friendly; dependency audit still required.

---

## Failure Modes

**Consistent false cluster (adversarial clique).** If the environment is repetitive enough that many false loop closures are mutually consistent with each other and form a clique larger than the true inlier set, PCM will accept the wrong set. Repetitive airport aprons or identical storage aisles are the highest-risk environments.

**Bad covariance thresholds.** Loose thresholds admit outliers to the consistency graph; tight thresholds reject true closures under drift. Threshold must be tuned per sensor and environment.

**Low recall in multi-robot scenarios.** The T-RO 2022 Kimera-Multi paper notes that pure PCM "has low recall" for inter-robot loop closures when the odometry backbone is uncertain. The chi-squared test becomes conservative and rejects genuine closures. Distributed GNC is preferred in this regime.

**Weak odometry backbone.** Pairwise consistency checks use the dead-reckoning path between loop-closure endpoints. Severe odometry drift or disconnected robot subgraphs degrade the cycle residual test.

**Dynamic scene geometry.** Moving aircraft, vehicles, and temporary equipment can make wrong closures appear geometrically plausible and pass the consistency test if they contaminate the odometry-estimated cycle.

**ROS 2 / LiDAR-only wrapper status unconfirmed.** No native ROS 2 wrapper is included in Kimera-RPGO. The MIT-SPARK ecosystem provides ROS 1 integration via Kimera-VIO-ROS and Kimera-Distributed, but the wrapper status for standalone LiDAR-only deployments should be independently verified.

**PCM + GNC combined configuration undocumented.** Both modes are exposed in the `RobustSolverParams` interface and can be composed, but the Kimera-RPGO README does not explicitly document a two-layer PCM+GNC configuration. Confirm with source code inspection or direct testing.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Airside survey — LiDAR primary | High | Recommended PCM layer for repetitive apron/taxiway environments; see Aggregated-Map Suitability below |
| Warehouse / logistics-yard | High | Repetitive shelving and aisles create adversarial clusters; PCM is the correct rejection layer |
| Port terminal survey | High | Large-scale repetitive infrastructure; PCM + GNC robust stack recommended |
| Road AV — multi-session mapping | High | Multi-session graph merging with uncertain cross-session odometry is PCM's original design case |
| Multi-robot fleet (visual-inertial) | High | Distributed PCM via Kimera-Multi; upgrade to distributed GNC for better recall |
| Indoor inspection — textured environments | Moderate | PCM works well; DBoW2 false positives from repetitive corridors are the risk |
| Mining / construction | Moderate | Dust and dynamic objects degrade front-end; PCM still adds value if covariances are realistic |
| Agricultural mapping | Moderate | Crop row repetition creates false closures; PCM helps if odometry is reliable |
| Online AV runtime localization | Low | PCM is a batch/incremental consistency filter, not a real-time odometry estimator |

---

## Aggregated-Map Suitability — Airside Survey

PCM is the recommended **loop-closure outlier rejection layer** in a production LiDAR SLAM pipeline for airside aggregated map building. The complete robust loop-closure stack:

```
LiDAR Odometry
    (KISS-ICP or FAST-LIO2)
    |
    v
Scan Context++ / KISS-Matcher
    (descriptor-based candidate retrieval; high recall, imperfect precision)
    |
    v
Geometric Verification
    (ICP / GICP refinement; point-to-plane covariance for chi-squared test)
    |
    v
PCM Filter (Kimera-RPGO)
    (consistency graph + incremental max-clique -> inlier set)
    |
    v
GTSAM iSAM2 + GNC robust kernel
    (joint optimization over odometry + inlier loop closures)
    |
    v
Globally consistent keyframe poses -> aggregate LiDAR map
```

For ICP refinement math underpinning the covariance estimates fed to PCM see [Point Cloud Registration — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md). For place-recognition candidate retrieval see [Scan Context Family](./scan-context-family.md) and [KISS-Matcher](./kiss-matcher.md).

**Why this combination:** Scan Context / KISS-Matcher retrieves candidates with high recall but imperfect precision. ICP refinement provides accurate relative transform plus point-to-plane covariance for the PCM chi-squared test. PCM rejects globally inconsistent candidates before they enter the optimizer — critical on airside aprons with repetitive taxiway markings, jet bridges, and identical stand configurations. GNC handles residual outliers that survived PCM. iSAM2 enables incremental re-linearization without full batch re-solve.

**Parameter guidance:**
- PCM translation threshold: 0.5–2.0 m depending on LiDAR odometry noise level.
- PCM rotation threshold: 0.05–0.1 rad (approximately 3–6 degrees).
- Minimum geometric inliers for LiDAR loop-closure admission: 50–100 point correspondences (vs. 15 for visual RANSAC).
- GNC kernel: Geman-McClure with mu schedule from 1e4 down to 1e-2, approximately 20 iterations.

**Multi-vehicle aggregation.** For airside fleets mapping in parallel (ground service vehicles, marshallers, tugs with LiDAR), Kimera-Multi's distributed PCM protocol scales to 8 or more robots without centralized compute. Each vehicle runs local SLAM and PCM; cross-vehicle loop closures are exchanged peer-to-peer; distributed GNC merges trajectories. See [Kimera-Multi](./kimera-multi.md) and [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md).

---

## Evolutionary Timeline

| Year | Milestone |
|---|---|
| 2018 | Mangelson et al. PCM (ICRA 2018) — foundational algorithm; max-clique formulation for multi-robot map merging |
| 2019–2020 | DOOR-SLAM (arXiv:1909.12198) — distributed PCM for multi-robot teams; 21–38% bandwidth vs. centralized |
| 2020 | Kimera (ICRA 2020) — PCM adapted for single-robot online SLAM; Kimera-RPGO released open-source |
| 2021 | Kimera-Multi ICRA 2021 — incremental max-clique heuristic; RBCD distributed PGO |
| 2022 | Kimera-Multi T-RO 2022 — distributed GNC replaces PCM as primary method; noted PCM has low recall in inter-robot scenarios; T-RO Best Paper Award |
| 2024 | Kimera2 (arXiv:2401.06323) — GNC becomes default in single-robot Kimera-RPGO; PCM still available |
| 2024 | Group-k consistent measurement maximization (IJRR 2024, Forsgren, Kaess, Mangelson) — extends PCM from pairwise to k-wise consistency via hypergraph max clique |

**Current recommendation:** Use GNC as the primary robust kernel for single-robot production deployment. Use PCM or PCM + GNC when operating in environments with high adversarial-cluster risk (repetitive structures, perceptual aliasing) or when hard binary loop-closure accept/reject decisions are required for map quality control. In multi-robot fleet scenarios, distributed GNC (Kimera-Multi T-RO 2022) is preferred for better recall.

---

## Implementation Notes

- **Require specific GTSAM build flags:** `GTSAM_POSE3_EXPMAP`, `GTSAM_ROT3_EXPMAP`, and `SLOW_BUT_CORRECT_BETWEENFACTOR` all `ON`. Missing flags produce incorrect Jacobians for loop-closure factors.
- **Run PCM after geometric verification, not on raw place-recognition matches.** Admit only candidates with RANSAC-verified relative pose and realistic covariance; raw descriptor matches are too noisy for a calibrated chi-squared test.
- **Incremental PCM uses the Pattabiraman max-clique solver** (Northwestern, 2013/2014), which applies graph coloring for upper-bound pruning. Polynomial-time in practice despite NP-hard worst case.
- **Use GTSAM C++ API for custom front-ends.** `BetweenFactor<Pose3>` with `noiseModel::Gaussian::Covariance` is the correct factor type; `addGraph()` handles multi-robot merge.
- **Log rejected candidates.** The g2o export via `saveData()` includes an outlier log. A rising rejection rate over time signals degrading place-recognition precision.
- **Bound candidate count before PCM** via temporal, spatial, and semantic gating. The max-clique cost grows with candidate count.
- **Treat the PCM inlier set as a selection, not a certificate.** For a certified globally optimal solution, pair the PCM-filtered graph with a certifiable backend — see [Certifiable Pose Graph Optimization](./certifiable-pose-graph-optimization.md) (SE-Sync / Shonan / DC2-PGO family).
- **For the Kimera-VIO front-end** producing the per-robot local pose graph, see [Kimera-VIO](./kimera-vio.md).

---

## Related Repository Docs

- [Kimera-VIO](./kimera-vio.md)
- [Kimera-Multi](./kimera-multi.md)
- [Certifiable Pose Graph Optimization](./certifiable-pose-graph-optimization.md)
- [Distributed Multi-Robot Pose Graph Optimization](./distributed-multi-robot-pgo.md)
- [Loop Closure and Place Recognition](./loop-closure-place-recognition.md)
- [Robust Pose Graph Optimization with GNC and riSAM](./robust-pgo-gnc-risam.md)
- [GraphSLAM and Pose Graph Optimization](./graphslam-pose-graph-optimization.md)
- [KISS-Matcher](./kiss-matcher.md)
- [Scan Context Family](./scan-context-family.md)
- [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md)
- [LIO-SAM](./lio-sam.md)
- [HDL Graph SLAM](./hdl-graph-slam.md)

---

## Sources

- Mangelson, Dominic, Eustice, Vasudevan. "Pairwise Consistent Measurement Set Maximization for Robust Multi-Robot Map Merging." ICRA 2018. https://ieeexplore.ieee.org/document/8460217/ · Semantic Scholar: https://www.semanticscholar.org/paper/Pairwise-Consistent-Measurement-Set-Maximization-Mangelson-Dominic/553d79fa20ed980754188105b8d91f51f8dc1e7b
- Rosinol, Abate, Chang, Carlone. "Kimera: an Open-Source Library for Real-Time Metric-Semantic Localization and Mapping." ICRA 2020. https://arxiv.org/abs/1910.02490 · paper PDF: https://www.mit.edu/~arosinol/papers/Rosinol20icra-Kimera.pdf
- Chang, Tian et al. "Kimera-Multi: a System for Distributed Multi-Robot Metric-Semantic SLAM." ICRA 2021. https://arxiv.org/abs/2011.04087
- Tian, Chang et al. "Kimera-Multi: Robust, Distributed, Dense Metric-Semantic SLAM for Multi-Robot Systems." T-RO 2022. https://arxiv.org/abs/2106.14386
- Rosinol et al. "Kimera2: Robust and Accurate Metric-Semantic SLAM in the Real World." arXiv 2024. https://arxiv.org/abs/2401.06323
- DOOR-SLAM (distributed PCM): https://arxiv.org/abs/1909.12198
- Yang, Antonante, Tzoumas, Carlone. GNC RA-L 2020. https://arxiv.org/abs/1909.08605
- Forsgren, Vasudevan, Kaess, McLain, Mangelson. "Group-k consistent measurement set maximization via maximum clique over k-Uniform hypergraphs." IJRR 2024. https://journals.sagepub.com/doi/10.1177/02783649241256970
- MIT-SPARK/Kimera-RPGO GitHub: https://github.com/MIT-SPARK/Kimera-RPGO
- PCM-GTSAM Python example: https://github.com/U-AMC/PCM_gtsam
- Note on seed-source hygiene: the URLs https://arxiv.org/abs/2003.12932 and https://arxiv.org/abs/1711.08632 resolve to unrelated papers and are not used as evidence for Kimera-RPGO or PCM.
