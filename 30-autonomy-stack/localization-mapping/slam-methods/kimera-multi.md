# Kimera-Multi

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "modern-core"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "validation", "runtime-localization"]
  reason: "Kimera-Multi is rated for robust or collaborative backend design in multi-session SLAM and validation."
method-priority:end -->

Related docs: [Kimera-VIO](kimera-vio.md) · [Kimera-RPGO and PCM](kimera-rpgo-pcm.md) · [Distributed Multi-Robot PGO](distributed-multi-robot-pgo.md) · [Loop Closure and Place Recognition](loop-closure-place-recognition.md) · [COVINS / COVINS-G](covins-covins-g.md) · [D2-SLAM](d2slam.md) · [Multi-Agent Neural Gaussian SLAM](multi-agent-neural-gaussian-slam.md) · [Certifiable Pose Graph Optimization](certifiable-pose-graph-optimization.md) · [Semantic SLAM](semantic-slam.md) · [Dynamic Object-Aware SLAM](dynamic-object-aware-slam.md) · [LT-Mapper / Khronos Lifelong Mapping](lt-mapper-khronos-lifelong-mapping.md) · [FAST-LIO / FAST-LIO2](fast-lio-fast-lio2.md) · [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) · [Point Cloud Registration — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md)

**Last updated:** 2026-05-24

---

## What It Is

**Kimera-Multi** is a production-grade distributed metric-semantic multi-robot SLAM system developed at MIT SPARK Lab (Tian, Chang, Lopez-Carrillo, Daher, Hughes, Carlone et al.). Published in *IEEE Transactions on Robotics* (T-RO) in 2022 and awarded the **IEEE T-RO King-Sun Fu Memorial Best Paper Award** — the highest recognition awarded to a single paper in that journal for that year.

The system simultaneously satisfies three properties that no prior multi-robot SLAM system had achieved together:

1. **Fully peer-to-peer.** No central server. Each robot holds a complete local map; computation and map merging are distributed across the team.
2. **Robust to outlier loop closures.** A two-stage pipeline — incremental maximum-clique filtering followed by distributed Graduated Non-Convexity (GNC) optimization — identifies and rejects incorrect inter-robot loop closures without human intervention, even at up to 80% spurious loop closure rates in simulation.
3. **Dense metric-semantic 3D mesh output.** Every mesh face carries a semantic label (road, vegetation, building, etc.), built in real time and shared across the robot team.

Demonstrated at **8 robots / 8 km** on MIT campus outdoor environments (arXiv resilience study, 2023). This is the production-grade classical multi-robot SLAM benchmark against which neural alternatives are evaluated: the best multi-agent neural Gaussian SLAM system (GRAND-SLAM, RA-L 2025) achieves 4.99 m ATE on the Kimera-Multi outdoor dataset, while Kimera-Multi achieves approximately 2.28 m ATE on comparable outdoor sequences. See [Multi-Agent Neural Gaussian SLAM](multi-agent-neural-gaussian-slam.md) for the full comparison.

**Primary citation:** Y. Tian, Y. Chang, F. Herrera Arias, C. Nieto-Granda, J. P. How, L. Carlone. "Kimera-Multi: Robust, Distributed, Dense Metric-Semantic SLAM for Multi-Robot Systems." *IEEE Transactions on Robotics*, 2022. arXiv: https://arxiv.org/abs/2106.14386

**System paper (ICRA 2021):** Y. Chang, Y. Tian, et al. "Kimera-Multi: a System for Distributed Multi-Robot Metric-Semantic SLAM." arXiv: https://arxiv.org/abs/2011.04087

**Resilience / large-scale study (2023):** Y. Tian et al. "Resilient and Distributed Multi-Robot Visual SLAM: Datasets, Experiments, and Lessons Learned." arXiv 2304.04362.

---

## Core Technical Idea

Multi-robot SLAM is hard not primarily because distributed optimization is slow, but because **inter-robot loop closures are unreliable**. Perceptual aliasing — visually similar but geometrically distinct scenes — causes false positive loop closure detections. When these false positives are trusted, they catastrophically corrupt the shared map by connecting unrelated parts of the pose graph.

Kimera-Multi's central engineering claim is production-grade reliability under three simultaneous adversarial conditions: communication intermittency, outlier loop closures from perceptual aliasing, and adversarial environments (tunnels, repetitive hallways, outdoor campus). The solution is a two-stage robustness pipeline:

- **Front-end stage:** Incremental maximum-clique outlier rejection (Pairwise Consistency Maximization, PCM) screens geometrically inconsistent loop closures before they enter the optimizer.
- **Back-end stage:** Distributed Graduated Non-Convexity (DGNC) soft-reweights all residuals during optimization, driving false-positive edge weights toward zero even if PCM admitted them.

The dense metric-semantic mesh is not an afterthought — it is a first-class output requirement, constructed incrementally from each robot's stereo-inertial front-end and corrected after distributed PGO via a mesh deformation layer.

---

## Architecture

Kimera-Multi is a five-module pipeline executed independently on each robot. All inter-robot communication is peer-to-peer only.

```
Each Robot
   |
   +-- [Module 1] Kimera-VIO
   |     Stereo-inertial odometry, IMU preintegration (GTSAM)
   |     5-point relative pose, DBoW2 intra-robot loop closure
   |     Output: local pose graph G_i = (X_i, E_i^odom)
   |
   +-- [Module 2] Kimera-Semantics
   |     Voxblox TSDF integration of keyframe depth
   |     Per-voxel semantic label fusion from 2D segmentation masks
   |     Marching cubes -> per-robot labeled 3D mesh
   |
   +-- [Module 3] Kimera-Multi-LCD (distributed front-end)
   |     Exchange BoW vectors (DBoW2, ORB features) with neighbors
   |     Geometric verification: Arun's method + 3-point RANSAC, >=15 inlier threshold
   |     Incremental maximum-clique PCM outlier rejection
   |     Output: set of accepted inter-robot loop closure constraints
   |
   +-- [Module 4] DPGO (distributed back-end)
   |     Distributed Riemannian Block Coordinate Descent (RBCD)
   |     Distributed Graduated Non-Convexity (DGNC) for robust optimization
   |     Exchanges only public poses (those incident to cross-robot loop closure edges)
   |     Output: globally consistent per-robot trajectory in a common reference frame
   |
   +-- [Module 5] Kimera-PGMO (Local Mesh Optimization)
         Mesh deformation graph (embedded deformation technique)
         Corrects per-robot semantic mesh after DPGO convergence
         Gauss-Newton solver via GTSAM
         Output: globally corrected semantically labeled 3D mesh
```

**Sub-repositories:**
- [MIT-SPARK/Kimera-VIO](https://github.com/MIT-SPARK/Kimera-VIO) — per-robot stereo-inertial front-end
- [MIT-SPARK/Kimera-Semantics](https://github.com/MIT-SPARK/Kimera-Semantics) — TSDF + semantic labeling
- [MIT-SPARK/Kimera-Distributed](https://github.com/MIT-SPARK/Kimera-Distributed) — communication protocol + pose-graph coarsening
- [MIT-SPARK/Kimera-Multi-LCD](https://github.com/MIT-SPARK/Kimera-Multi-LCD) — BoW matching + geometric verification
- [mit-acl/dpgo](https://github.com/mit-acl/dpgo) + [mit-acl/dpgo_ros](https://github.com/mit-acl/dpgo_ros) — distributed PGO back-end
- [MIT-SPARK/Kimera-PGMO](https://github.com/MIT-SPARK/Kimera-PGMO) — mesh deformation
- [MIT-SPARK/Kimera-Multi-Data](https://github.com/MIT-SPARK/Kimera-Multi-Data) — datasets

**OS / ROS:** Ubuntu 20.04 + ROS Noetic (originally Ubuntu 18.04 + Melodic).

---

## Inputs and Outputs

**Inputs (per robot):**
- Stereo camera images (left + right, grayscale, keyframe-triggered by motion)
- IMU measurements (integrated in Kimera-VIO preintegration)
- 2D semantic segmentation masks (from any off-the-shelf pixel-level network, e.g., Mask2Former, applied per keyframe — not trained as part of Kimera-Multi)

**Outputs:**
- Per-robot SE(3) trajectory, globally consistent across the team after DPGO convergence
- Per-robot semantically labeled 3D mesh, warped to the corrected trajectory by Local Mesh Optimization
- Shared implicit understanding of inter-robot relative poses (encoded in the accepted loop closure graph)

**No LiDAR input** in the base system. See the LiDAR Adaptation section for extension strategies.

**Training-free system.** Kimera-Multi is entirely classical — no neural network is trained as part of the SLAM pipeline. ORB features, DBoW2, GTSAM, RANSAC, and the mesh deformation solver are all deterministic. The 2D semantic segmentation model (plugged in externally) may be a trained network, but Kimera-Multi treats it as a black-box oracle.

---

## Operator Mechanics

### Kimera-VIO Front-End

Each robot runs Kimera-VIO independently: stereo feature tracking with RANSAC-based outlier rejection, 5-point relative pose estimation from stereo keypoints, and IMU preintegration via GTSAM factor graphs (Forster et al. preintegration factor, 2017). Produces a local pose graph `G_i = (X_i, E_i^odom)` where `X_i = {T_1^i, ..., T_n^i}` are poses in the robot's own frame and `E_i^odom` are odometry factors.

For the SE(3) Lie-algebra mathematics used in factor graph optimization see [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md).

### Distributed Loop Closure Detection (Kimera-Multi-LCD)

**Stage 1 — Place recognition.** Robot `a` sends its BoW vector `v_a^k` for keyframe `k` to robot `b`. DBoW2 with ORB features. Robot `b` searches its own database for candidates with normalized visual similarity `s(v_a^k, v_b^m) >= 0.5`. Because ORB descriptors are computed locally on each robot's imagery, no raw image transmission is needed.

**Stage 2 — Geometric verification.** If a candidate passes the similarity threshold, robots exchange 3D keypoints and descriptors for the two candidate keyframes. Descriptor matching (NN ratio test) followed by Arun's 3-point RANSAC, yielding relative transform `T_{ab}`. Loop closure is accepted if RANSAC finds at least 15 inliers.

**Stage 3 — PCM outlier rejection (incremental).** Pairwise Consistency Maximization builds an undirected graph `G_LC` where each detected loop closure is a node. Two nodes share an edge if their relative-transform measurements are mutually consistent — i.e., the composition of the two transforms respects the chain rule within a tolerance. The maximum clique of `G_LC` is the largest mutually consistent set — retained; all others rejected.

Rather than recomputing the full maximum clique on each update, the system uses an incremental search that only expands the current clique when a new loop closure is added, reducing computational cost from exponential-batch complexity to near-linear in practice. This comes at the cost of finding a locally optimal (not globally largest) clique — see Failure Modes.

See [Kimera-RPGO and PCM](kimera-rpgo-pcm.md) for the full mathematical treatment of the maximum-clique formulation.

### Distributed Pose Graph Optimization (DPGO)

**Problem formulation.** Each robot `i` has a local pose graph. Inter-robot loop closures inject cross-robot edges. The global PGO problem is:

```
min_{X_1,...,X_N}
    sum_i  sum_{(a,b) in E_i^odom}  rho( ||T_a^i oplus T_b^i ominus T_hat_{ab}^i|| )
  + sum_{(i,j) cross-robot}         rho( ||T_a^i ominus T_b^j ominus T_hat_{ab}^{ij}|| )
```

where `oplus`/`ominus` are SE(3) composition/difference, `T_hat_{ab}` is the measured relative transform, and `rho(.)` is a robust cost kernel (Cauchy or Geman-McClure) applied via GNC. This is a non-convex problem over `SE(3)^N_poses`.

**RBCD solver.** Kimera-Multi uses Riemannian Block Coordinate Descent on the rank-restricted SDP relaxation (connection Laplacian formulation, related to SE-Sync and [Certifiable Pose Graph Optimization](certifiable-pose-graph-optimization.md)). Each robot `i` holds and updates only its block of the lifted variable `Y_i` in `R^{r x d_i}` (default rank `r = 5`). The update for robot `i` at each iteration:

```
Y_i  <-  proj_{S^r}( Y_i - step * grad_{Y_i} L(Y_1,...,Y_N) )
```

where `grad_{Y_i} L` involves only public poses shared with neighbors. After convergence, each robot projects `Y_i` back to SE(3) via rounding. RBCD runtime: 2–6 seconds per optimization cycle, comparable to centralized SE-Sync (2–4 s).

**DGNC (Distributed GNC).** GNC replaces the robust kernel `rho` with a sequence of surrogate costs `rho_mu` parameterized by `mu`, solving from convex (large `mu`) toward the original non-convex cost (small `mu`). At each GNC step, per-edge weights `w_{ab}` are updated:

```
w_{ab}  <-  rho'_mu( r_{ab} ) / r_{ab}
```

where `r_{ab}` is the residual at the current solution. Incorrect loop closures converge toward `w_{ab} -> 0`, effectively pruning them from the optimization. Convergence requires approximately 10–30 outer GNC steps, each with approximately 50 RBCD iterations.

**Privacy.** Only "public poses" — those incident to inter-robot loop closure edges — are shared between robots. Private trajectory segments remain local. The paper reports that Kimera-Multi transmits approximately 21–38% of what a fully centralized system would transmit.

**Key math symbols:**

| Symbol | Meaning |
|---|---|
| `T_k^i in SE(3)` | Pose of robot i at keyframe k in its local frame |
| `T_hat_{ab}^{ij}` | Measured relative transform between robot i frame a and robot j frame b |
| `rho(.)` | Robust cost; weight converges to 0 for outliers under GNC |
| `w_{ab}` | Per-edge GNC weight; outlier edges drive toward 0 |
| `Y_i in R^{r x d_i}` | Lifted variable for robot i in rank-r relaxation (default r = 5) |
| `PCM clique` | Maximum consistent set of loop closures; inconsistent ones pruned |
| `d_k` | Deformation node displacement after DPGO (mesh correction) |

### Local Mesh Optimization (Kimera-PGMO)

After DPGO converges, each robot's trajectory has been corrected globally. The local semantic mesh (built during exploration from the uncorrected trajectory) must be warped to match. The deformation graph has two node types: **mesh vertices** (actual 3D points on the mesh) and **keyframe vertices** (pose estimates from VIO). Edges connect mesh vertices to their k-nearest keyframe vertices.

The objective minimizes three terms:

```
min_{d}
    sum_k  ||T_k^DPGO - T_k^VIO - d_k||^2        (anchor deformation to DPGO solution)
  + sum_{mesh edges (u,v)}  ||R_u(v_u - u_u) - (v_v - u_v)||^2  (local rigidity)
  + sum_{(k,v) obs. edges}  ||R_k v_k^VIO + t_k - v_k^mesh||^2  (keyframe-vertex consistency)
```

Solved by Gauss-Newton in GTSAM. Effect: semantic mesh faces move smoothly to reflect the globally corrected trajectory without requiring re-integration of the TSDF.

**Semantic accuracy improvement (ICRA 2021, simulation):** City simulation: 67.91% -> 83.93% mesh accuracy after LMO; Camp outdoor: 94.22% -> 95.13%.

---

## Benchmark Results

### Core ATE Results (ICRA 2021 system paper)

| Sequence | Method | ATE (m) |
|---|---|---|
| City sim | Local (no collaboration) | 6.09 |
| City sim | Kimera-Multi RBCD | 2.38 |
| Camp outdoor | Local (no collaboration) | ~8.0 |
| Camp outdoor | Kimera-Multi RBCD | **2.28** |
| EuRoC VR1 | Local | 0.491 |
| EuRoC VR1 | Kimera-Multi RBCD | 0.317 |
| EuRoC VR2 | Local | 0.694 |
| EuRoC VR2 | Kimera-Multi RBCD | 0.453 |

RBCD runtime (50 iterations): 2–6 s per optimization cycle, comparable to centralized SE-Sync at 2–4 s. ATE with Kimera-Multi approaches centralized baseline performance on all sequences.

### Large-Scale Resilience (arXiv 2304.04362, 2023)

| Dataset | Robots | Max trajectory | Environment |
|---|---|---|---|
| MIT campus multi-robot | up to 8 | up to 8 km | Outdoor campus + tunnels + hallways |

Ground truth generated via GPS + total-station-assisted LiDAR SLAM (LOCUS + LAMP). Sensor suite per robot: Intel D455 stereo RGB-D + integrated IMU + Velodyne VLP-16 (LiDAR recorded but not used by Kimera-Multi's visual-inertial front-end). Key finding: the system remains functional but requires careful handling of communication intermittency and severe visual aliasing in tunnels and hallways with repeating patterns.

### Direct Comparison: Kimera-Multi vs Multi-Agent Neural Gaussian SLAM

The Kimera-Multi outdoor dataset is used as the benchmark in GRAND-SLAM (RA-L 2025, see [Multi-Agent Neural Gaussian SLAM](multi-agent-neural-gaussian-slam.md)), providing a direct cross-paradigm comparison:

| Method | ATE RMSE (m) | Notes |
|---|---|---|
| ORB-SLAM3 (single-robot baseline) | 10.58 | No multi-robot collaboration |
| MAGiC-SLAM (neural Gaussian, CVPR 2025) | 60.79 | Centralized server, 3DGS, RGB-D |
| GRAND-SLAM (neural Gaussian, RA-L 2025) | 4.99 | Best neural Gaussian multi-agent result |
| Kimera-Multi (classical, T-RO 2022) | ~2.28 | Camp sequence, comparable outdoor conditions |

**Verdict:** Kimera-Multi is the production baseline. Even the best multi-agent neural Gaussian SLAM system (GRAND-SLAM) achieves 4.99 m ATE on outdoor data — roughly 2.2x worse than Kimera-Multi on comparable outdoor sequences, while operating on RGB-D (not stereo-inertial), not running in real time, and requiring a centralized server.

---

## The Kimera Family

Kimera-Multi is one node in a progression of MIT SPARK Lab systems, each adding a layer of abstraction to metric-semantic spatial understanding.

### Kimera (ICRA 2020 / IJRR 2021)

**Citation:** A. Rosinol, M. Abate, Y. Chang, L. Carlone. "Kimera: an Open-Source Library for Real-Time Metric-Semantic Localization and Mapping." ICRA 2020 / IJRR 2021. arXiv: https://arxiv.org/abs/2101.06894

First open-source system combining VIO, mesh reconstruction, and semantic labeling in a single real-time single-robot pipeline. Introduced the Kimera-VIO + Kimera-Semantics + Kimera-RPGO triad. Demonstrated 3D dynamic scene graphs as an output representation.

### Kimera-VIO

**Repo:** https://github.com/MIT-SPARK/Kimera-VIO

Stereo-inertial odometry front-end using GTSAM factor graphs with IMU preintegration (Forster et al.), 5-point relative pose from stereo keypoints, DBoW2 for intra-robot loop closure. The per-robot odometry module used inside Kimera-Multi. See [Kimera-VIO](kimera-vio.md).

### Kimera-Semantics (RA-L 2020)

**Repo:** https://github.com/MIT-SPARK/Kimera-Semantics

Voxblox-based TSDF integration with per-voxel semantic label fusion (Bayesian update over CNN segmentation outputs). Marching cubes extracts the final labeled mesh. Kimera-Multi runs this module on each robot to build the local semantic mesh that is later corrected by PGMO.

### Kimera-RPGO (Robust PGO)

**Repo:** https://github.com/MIT-SPARK/Kimera-RPGO

Single-robot robust pose-graph optimization: Pairwise Consistent Measurement Set Maximization (PCM) + maximum clique for outlier rejection, then GTSAM Levenberg-Marquardt optimizer. Used inside Kimera-VIO for intra-robot loop closures. Kimera-Multi extends PCM to the inter-robot case. Kimera2 (2024) upgrades the outlier rejection from PCM to GNC. See [Kimera-RPGO and PCM](kimera-rpgo-pcm.md).

### Kimera-Multi (T-RO 2022) — This page

The multi-robot extension of Kimera. Distributes PGO across robots; adds inter-robot loop closure detection; produces a shared semantic 3D mesh. T-RO Best Paper Award 2022.

### Hydra (RSS 2022)

**Citation:** N. Hughes, Y. Chang, L. Carlone. "Hydra: A Real-time Spatial Perception System for 3D Scene Graph Construction and Optimization." RSS 2022. arXiv: https://arxiv.org/abs/2201.13360

**Repo:** https://github.com/MIT-SPARK/Hydra

Builds a hierarchical 3D scene graph (DSG) in real time: places -> rooms -> buildings, with objects and agents. Runs on top of Kimera-Semantics; adds ESDF-based place graph construction, room segmentation, and DSG-level loop closure optimization. Single-robot. The scene-graph layer that Kimera-Multi's mesh output could be promoted to.

### Khronos (RSS 2024)

**Citation:** L. Schmid, M. Abate, Y. Chang, L. Carlone. "Khronos: A Unified Approach for Spatio-Temporal Metric-Semantic SLAM in Dynamic Environments." RSS 2024. arXiv: https://arxiv.org/abs/2402.13817

**Repo:** https://github.com/MIT-SPARK/Khronos

Adds a temporal dimension to the Kimera map. Uses "object fragments" (partial views within short time windows) as the factorization unit, separating sensing noise, trajectory drift, and scene changes. Tracks short-term dynamics (moving people) and long-term changes (furniture rearrangement, structural changes). Maintains a 4D belief: "at time t given observations through robot-time T." Single-robot; the temporal extension that peers with Kimera-Multi in the family. See [LT-Mapper / Khronos Lifelong Mapping](lt-mapper-khronos-lifelong-mapping.md).

### Kimera2 (arXiv 2024, ISRR 2024)

**Citation:** M. Abate, Y. Chang, et al. "Kimera2: Robust and Accurate Metric-Semantic SLAM in the Real World." arXiv 2401.06323. https://arxiv.org/abs/2401.06323

Upgrades single-robot Kimera: enhanced Kimera-VIO with monocular/stereo/RGB-D/wheel odometry fusion; Kimera-RPGO upgraded from PCM to GNC; broader real-world evaluation (drones, quadrupeds, wheeled robots, simulated self-driving cars). Outperforms VINS-Fusion and ORB-SLAM3 on multiple benchmarks.

---

## Distributed Multi-Robot SLAM Context

Kimera-Multi sits in a competitive field. The table below summarizes the key systems.

| System | Architecture | Sensor | Dense map | LiDAR | ROS 2 | Notes |
|---|---|---|---|---|---|---|
| CCM-SLAM (JFR 2019) | Centralized server | Monocular | No | No | No | First multi-UAV collaborative SLAM; ORB-SLAM2 agents; scale-ambiguous |
| COVINS-G (ICRA 2023) | Centralized server | Visual-inertial | No | No | No | Front-end-agnostic; any VIO; keyframe streaming to server |
| Kimera-Multi (T-RO 2022) | Fully distributed P2P | Stereo + IMU | Semantic mesh | No | No | T-RO Best Paper; 8 robots, 8 km; outlier-robust |
| Swarm-SLAM (RA-L 2024) | Fully decentralized | LiDAR / stereo / RGB-D | Sparse PC | Yes | Yes | Loop closure prioritization; 5 datasets; real 3-robot |
| DiSCo-SLAM (RA-L 2022) | Distributed | LiDAR | No | Yes | No | Scan Context inter-robot detection; unknown init positions |
| LAMP 2.0 (DARPA SubT) | Centralized | LiDAR | No | Yes | No | 10+ robots in underground environments; DARPA SubT reference |
| DPGO (T-RO 2021) | Back-end only | Any | No | Agnostic | — | Certifiably correct distributed PGO; adopted by Kimera-Multi |

**COVINS-G vs Kimera-Multi:** COVINS-G requires a server; Kimera-Multi is fully distributed. COVINS-G is front-end-agnostic; Kimera-Multi is tied to Kimera-VIO. COVINS-G does not produce a dense 3D mesh. See [COVINS / COVINS-G](covins-covins-g.md).

**Swarm-SLAM vs Kimera-Multi:** Swarm-SLAM supports LiDAR natively and runs on ROS 2, making it the preferred off-the-shelf choice for LiDAR-primary multi-robot deployments. Kimera-Multi provides the denser semantic mesh and has the larger demonstrated scale (8 km vs Swarm-SLAM's published real-robot 3-robot experiment). The two are complementary — Kimera-Multi for visual-inertial semantic mapping; Swarm-SLAM for LiDAR-primary geometric mapping.

See [Distributed Multi-Robot PGO](distributed-multi-robot-pgo.md) for the full treatment of DPGO and distributed PGO solvers.

---

## Strengths

**Fully distributed — no single point of failure.** Each robot holds a complete local map. The team continues to operate even if one robot drops from the network. On re-contact, the distributed PGO resumes from the last solution rather than restarting.

**Robust to outlier loop closures.** Two-layer rejection demonstrated at up to 80% spurious loop closure rates in simulation: (a) incremental PCM maximum-clique rejects geometrically inconsistent candidates before they enter the PGO; (b) DGNC soft-reweights all residuals, driving false-positive edges toward zero weight during optimization.

**Dense semantic output.** Mesh faces carry semantic labels (road, building, vegetation, ground) — unavailable from sparse-map distributed SLAM systems (COVINS-G, DPGO alone). Enables downstream planning and change-detection applications. See [Semantic SLAM](semantic-slam.md) and [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md).

**Communication-efficient.** Transmits approximately 21–38% of what a centralized system would require. No raw image streaming — only BoW vectors, keypoint batches for verified loops, and public pose updates cross robot boundaries.

**Production deployment scale.** 8 robots, 8 km trajectories, real outdoor campus environments. IEEE T-RO Best Paper Award 2022. The canonical production benchmark for multi-robot metric-semantic SLAM.

**Modular.** Can run without semantics (standard 3D reconstruction), without mesh (trajectory only), or without inter-robot loops (single-robot Kimera on each robot). Each component is a standalone sub-repository.

---

## Failure Modes

**Perceptual aliasing at large scale.** In tunnels or hallways with repeating patterns, even the maximum-clique PCM filter may accept locally consistent but globally incorrect loop closures — the "false clique" problem. The 2023 resilience paper (arXiv 2304.04362) identifies this as the primary remaining failure mode at large scale.

**Incremental PCM is approximate.** The incremental maximum-clique search finds a clique containing at least one new loop closure but not necessarily the globally largest clique. Under heavy outlier load, this may admit more false positives than the batch maximum clique.

**Communication partition.** If two robots never come within communication range, their maps cannot be merged. In a large coverage area with non-overlapping sectors, this is the expected default. Pre-planned rendezvous waypoints or mesh networking (e.g., via UWB relays) are required.

**RBCD convergence time grows with inter-robot edges.** Each new inter-robot loop closure adds a cross-robot edge. With N robots and O(N^2) potential cross-robot edges, RBCD per-iteration cost grows. Practical at 8 robots; scalability beyond 15–20 robots is unverified.

**No LiDAR native support.** Kimera-VIO operates on stereo camera images plus IMU. In LiDAR-primary deployments (airside, ports, mining), a separate front-end must be substituted. See LiDAR Adaptation section below.

**RGB camera dependency.** Loop closure via BoW requires visual texture. Textureless environments (white corridors, airport aprons, desert terrain) cause missed loop closures and unbounded drift.

**Semantic label quality is bounded by the segmentation network.** Kimera-Semantics propagates external CNN segmentation output into 3D. Domain shift (airside labels not in Cityscapes or COCO training data) degrades label accuracy. Fine-tuning or retraining the 2D segmentation model is required for airside deployment.

**ROS 1 / Ubuntu 20.04.** The current repo targets ROS Noetic. No official ROS 2 migration. Swarm-SLAM is the ROS 2 alternative.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Outdoor campus / urban mapping (stereo + IMU) | High | Core demonstrated use case; 8 robots, 8 km |
| Indoor multi-robot inspection (textured) | High | Semantic mesh useful for change detection |
| Warehouse multi-robot mapping | Moderate | Texture generally adequate; ROS 1 dependency; LiDAR fleet would prefer Swarm-SLAM |
| Airside survey (visual-inertial) | Moderate | Apron texture may be sparse; domain adaptation needed for semantic labels |
| Airside survey (LiDAR-primary) | Low | Not LiDAR-native; use Swarm-SLAM or DPGO + FAST-LIO2 |
| Port / logistics-yard | Low | LiDAR preference; Swarm-SLAM more appropriate |
| Underground / mining | Not suitable | No LiDAR; lighting conditions defeat visual-inertial |
| Delivery robots (shared indoor map) | Moderate | Scale fits; GPU + ROS 1 are friction points |

---

## LiDAR Adaptation

Kimera-Multi does not natively support LiDAR. For LiDAR-primary multi-vehicle surveys, three strategies exist.

**Strategy A: DPGO back-end with LiDAR front-end.**
Replace Kimera-VIO with [FAST-LIO2](fast-lio-fast-lio2.md) or LIO-SAM per robot. Use Kimera-Distributed's communication layer to exchange Scan Context descriptors (from LiDAR ring images) for inter-robot loop closure detection. Feed accepted loop closures into DPGO. This approach retains the certifiably correct DPGO back-end and gains LiDAR accuracy. No off-the-shelf integrated implementation exists — requires custom integration work. For the point cloud registration math underlying inter-robot alignment see [Point Cloud Registration — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md).

**Strategy B: Swarm-SLAM with LiDAR (recommended off-the-shelf).**
Swarm-SLAM (ROS 2, https://github.com/MISTLab/Swarm-SLAM) natively supports LiDAR front-ends (via LOAM family), is fully decentralized, and provides inter-robot loop closure prioritization. Does not produce a dense semantic mesh but provides a consistent sparse point cloud map and trajectory. This is the recommended off-the-shelf LiDAR multi-robot SLAM choice as of 2024.

**Strategy C: DiSCo-SLAM.**
For LiDAR multi-robot SLAM with robust inter-robot loop detection from range data specifically, DiSCo-SLAM (RA-L 2022) uses Scan Context plus two-stage PGO. Handles unknown initial relative positions — common in multi-robot deployment.

**Strategy D: LAMP 2.0.**
For underground or GPS-denied large-scale LiDAR multi-robot SLAM (demonstrated at DARPA SubT with 10+ robots), LAMP 2.0 is the highest-maturity reference. Not directly applicable to airside open-sky environments but demonstrates what is achievable at scale with LiDAR.

---

## Aggregated-Map Suitability

Kimera-Multi is the **production-grade visual-inertial multi-robot SLAM benchmark**. For airside or outdoor multi-vehicle survey with stereo cameras plus IMU, Kimera-Multi is the recommended visual-inertial choice. For LiDAR-primary multi-vehicle survey (the more common airside deployment scenario), use Swarm-SLAM or DPGO plus FAST-LIO2.

Multi-agent neural Gaussian SLAM (see [Multi-Agent Neural Gaussian SLAM](multi-agent-neural-gaussian-slam.md), iter 31) is the active research frontier. It produces photorealistic renderings rather than geometric meshes, is not real-time, is mostly centralized, and has not matched Kimera-Multi on outdoor trajectory accuracy (best result: GRAND-SLAM at 4.99 m vs Kimera-Multi at ~2.28 m on comparable outdoor sequences). For any production deployment as of 2026, Kimera-Multi or Swarm-SLAM are the correct technology choices for multi-robot metric-semantic mapping.

For single-robot spatio-temporal extension of the Kimera family, see [LT-Mapper / Khronos Lifelong Mapping](lt-mapper-khronos-lifelong-mapping.md) (Khronos, RSS 2024).

---

## Implementation Notes

- **ROS 1 dependency is real friction.** All Kimera-Multi sub-repos target ROS Noetic. If the deployment target is ROS 2, either use Swarm-SLAM (native ROS 2) or budget significant porting effort.
- **Start with single-robot Kimera-VIO + Kimera-RPGO before adding multi-robot modules.** Validate per-robot odometry quality first — inter-robot loop closures are useless if the local front-end is unreliable.
- **Set conservative place recognition thresholds in new environments.** The default DBoW2 similarity threshold (0.5) and RANSAC inlier threshold (15) were tuned on campus outdoor sequences. Tighter thresholds reduce false positive loop closures at the cost of fewer accepted inter-robot constraints.
- **Semantic label domain adaptation is required outside standard classes.** Kimera-Semantics propagates labels from any 2D segmentation network. For airside use, a model covering taxiway markings, aircraft stands, aprons, and ground equipment must be substituted — Cityscapes-trained models do not contain these classes.
- **Communication intermittency is expected behavior, not an error.** The distributed PGO accumulates loop closures incrementally. Design the network stack to buffer loop closure data during communication gaps and flush on re-contact.
- **Dense mesh resolution scales with voxel size and volume.** For large outdoor environments, coarsen the voxel resolution (e.g., 0.2–0.5 m) to keep TSDF integration within memory and compute budgets. The mesh output is not suitable for centimeter-level precision tasks at this resolution.
- **Dynamic object contamination.** Kimera-Multi has no native dynamic object detection. Moving vehicles, people, and ground service equipment will be integrated into the static mesh. For dynamic environments pair with a motion-segmentation front-end before TSDF integration. See [Dynamic Object-Aware SLAM](dynamic-object-aware-slam.md).
- **Audit all sub-repo versions together.** The index repo (MIT-SPARK/Kimera-Multi) pins specific commits of all sub-repos. Pulling sub-repos at HEAD independently is likely to break the integration.
- **Ground-truth generation for evaluation.** The 2023 resilience study used GPS plus total-station-assisted LiDAR SLAM (LOCUS + LAMP) to generate ground truth. Replicate this approach for in-house evaluation — VIO alone is not accurate enough as a reference.

---

## Sources

**Primary papers:**
- Kimera-Multi (T-RO 2022): https://arxiv.org/abs/2106.14386
- Kimera-Multi (ICRA 2021, system paper): https://arxiv.org/abs/2011.04087
- Kimera-Multi (MIT DSpace): https://dspace.mit.edu/handle/1721.1/145301
- Kimera-Multi resilience + datasets (arXiv 2023): https://arxiv.org/abs/2304.04362
- SPARK Lab project page: https://web.mit.edu/sparklab/2023/08/25/Kimera-Multi__Robust_Distributed_Dense_Metric-Semantic_SLAM_for_Multi-Robot-Systems.html

**GitHub:**
- Kimera-Multi index: https://github.com/MIT-SPARK/Kimera-Multi
- Kimera-Multi dataset: https://github.com/MIT-SPARK/Kimera-Multi-Data
- Kimera-VIO: https://github.com/MIT-SPARK/Kimera-VIO
- Kimera-Semantics: https://github.com/MIT-SPARK/Kimera-Semantics
- Kimera-Distributed: https://github.com/MIT-SPARK/Kimera-Distributed
- Kimera-Multi-LCD: https://github.com/MIT-SPARK/Kimera-Multi-LCD
- Kimera-PGMO: https://github.com/MIT-SPARK/Kimera-PGMO
- Kimera-RPGO: https://github.com/MIT-SPARK/Kimera-RPGO
- DPGO: https://github.com/mit-acl/dpgo
- DPGO-ROS: https://github.com/mit-acl/dpgo_ros

**Kimera family:**
- Kimera (IJRR 2021): https://arxiv.org/abs/2101.06894 / https://github.com/MIT-SPARK/Kimera
- Kimera2 (2024): https://arxiv.org/abs/2401.06323
- Hydra (RSS 2022): https://arxiv.org/abs/2201.13360 / https://github.com/MIT-SPARK/Hydra
- Khronos (RSS 2024): https://arxiv.org/abs/2402.13817 / https://github.com/MIT-SPARK/Khronos

**Distributed PGO:**
- DPGO certifiably correct (T-RO 2021): https://arxiv.org/abs/1911.03721
- Asynchronous DPGO (RA-L 2020): referenced in DPGO repo README

**Comparison systems:**
- COVINS-G (ICRA 2023): https://arxiv.org/abs/2301.07147 / https://github.com/VIS4ROB-lab/covins
- Swarm-SLAM (RA-L 2024): https://arxiv.org/abs/2301.06230 / https://github.com/MISTLab/Swarm-SLAM
- DiSCo-SLAM (RA-L 2022): https://par.nsf.gov/servlets/purl/10333956 / https://github.com/RobustFieldAutonomyLab/DiSCo-SLAM
- LAMP 2.0: https://arxiv.org/abs/2205.13135
- CCM-SLAM (JFR 2019): https://github.com/VIS4ROB-lab/ccm_slam

**Multi-agent neural Gaussian SLAM comparison:**
- GRAND-SLAM (RA-L 2025): https://arxiv.org/abs/2506.18885
- MAGiC-SLAM (CVPR 2025): https://arxiv.org/abs/2411.16785
- Collaborative GS-SLAM survey: https://arxiv.org/abs/2510.23988
