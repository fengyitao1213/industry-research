# Loop Closure and Place Recognition

<!-- method-priority:start
priority:
  learning: 5
  deployment: 4
  type: "architecture-pattern"
  stage: "foundation"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "runtime-localization", "validation"]
  reason: "Loop Closure and Place Recognition is rated for foundational SLAM modeling, optimization, registration, or mapping concepts."
method-priority:end -->

Related docs: [Learned LiDAR Place Recognition](./learned-lidar-place-recognition.md), [Scan Context Family](./scan-context-family.md), [KISS-ICP](./kiss-icp.md), [KISS-Matcher](./kiss-matcher.md), [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md), [LIO-SAM](./lio-sam.md), [LeGO-LOAM](./lego-loam.md), [LT-Mapper / Khronos Lifelong Mapping](./lt-mapper-khronos-lifelong-mapping.md), [Kimera-RPGO PCM](./kimera-rpgo-pcm.md), [Certifiable Pose-Graph Optimization](./certifiable-pose-graph-optimization.md), [Distributed Multi-Robot PGO](./distributed-multi-robot-pgo.md), [COVINS / COVINS-G](./covins-covins-g.md), [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [GTSAM Factor Graphs](../../../10-knowledge-base/state-estimation/gtsam-factor-graphs.md), [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md), [Lie Groups SE(3)/SO(3) Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md).

**Last updated:** 2026-05-23

---

## What It Is

Loop closure is the SLAM mechanism that recognises a return to a previously visited place and inserts a relative-pose constraint that corrects accumulated drift. Place recognition is the front-end retrieval problem: given the current observation, find past keyframes or map locations that are likely the same place. Geometric verification then estimates the relative transform and rejects false candidates. A robust pose-graph backend finally distributes the correction globally along the full trajectory.

Every production loop-closure system follows the same **three-stage pipeline**:

```
Keyframe stream
      |
 [Stage 1: Candidate Retrieval -- Place Recognition]
      |   descriptor distance -> top-K candidates
      |
 [Stage 2: Geometric Verification]
      |   ICP / KISS-Matcher / Quatro / RANSAC + PnP
      |   -> relative transform T_ij + inlier count
      |   reject if inlier ratio < threshold
      |
 [Stage 3: Pose-Graph Optimisation]
      |   insert verified edge (i, j, T_ij, Sigma_ij) into graph
      |   solve globally with robust kernel
      v
 Globally consistent pose graph -> consistent map
```

Stage 1 is cheap: descriptor extraction plus approximate nearest-neighbour (ANN) search. Stage 2 is expensive: point-cloud registration or feature matching. Stage 3 runs algebraically in the background.

Loop closure is essential for long missions and multi-session mapping, but it is also one of the most dangerous SLAM components. A missed loop closure leaves drift uncorrected — a recoverable failure. A false-positive loop closure can **catastrophically fold the map** — a non-trivial failure requiring manual intervention. This asymmetry drives the entire design: very high precision is required, accepting some missed closures rather than risking false positives.

---

## Core Technical Idea

### Drift and the Need for Global Constraints

A robot operating over a long trajectory accumulates **odometric drift**: each incremental pose estimate carries bounded noise, but errors compound. After 500 m of travel, a typical LiDAR-inertial odometry system (FAST-LIO2, LIO-SAM) may have drifted 0.5–5 m in position and 0.5–2° in heading, depending on environment richness and IMU quality. On a 2 km airport-apron survey loop, that drift can reach tens of metres — making the resulting map unusable for navigation.

Odometry alone produces a **locally consistent but globally inconsistent** map. Each incremental registration (ICP, NDT) is accurate relative to the previous frame, but small errors accumulate without bound. Loop closure provides **global constraints** that anchor the trajectory to itself, allowing the optimiser to redistribute accumulated error across the entire path.

### The Safety Asymmetry

The asymmetry between missed and false closures drives every design decision:

- **Missed loop closure**: drift remains; the map has a seam where the start and end of the trajectory diverge. Additional traversals can recover this.
- **False-positive loop closure**: a wrong relative-pose constraint enters the pose graph. The optimiser treats it as correct (it passed geometric verification) and deforms the rest of the trajectory to satisfy it — potentially folding the map. Recovery requires manual identification and deletion of the bad edge plus re-optimisation.

**Geometric verification (Stage 2) is the primary safety net.** Robust kernels and pairwise consistency checks (Stage 3) are the secondary net. Neither alone is sufficient; the defence-in-depth combination is the industry standard.

---

## Stage 1 — Candidate Retrieval / Place Recognition

### Visual Loop Closure: DBoW2

**DBoW2** (Gálvez-López & Tardós, TRO 2012) is the canonical visual loop-closure backend used in ORB-SLAM2/3 and RTAB-Map. It implements a **hierarchical Bag-of-Binary-Words** approach.

**Vocabulary construction (offline).** ORB descriptors (256-bit binary) are extracted from a large training image corpus and clustered in a hierarchical k-means tree. Each leaf node is a "visual word". The vocabulary typically has 10^5–10^6 words in a tree of depth 6, branching factor 10.

**Descriptor construction (runtime).** For each keyframe, ORB features are extracted and each descriptor is propagated down the vocabulary tree via Hamming-distance lookup. The word assignments are aggregated into a sparse bag-of-words (BoW) vector weighted by TF-IDF (term frequency–inverse document frequency). Rare words receive high weight; ubiquitous words receive low weight.

**Retrieval.** The BoW vector of the query keyframe is compared against all database entries using the L1 score:

```
s(v_q, v_d) = 2 * sum_k  |v_q(k)/2| + |v_d(k)/2| - |v_q(k)/2 - v_d(k)/2|
```

which simplifies to a fast inner product on sparse vectors.

**Geometric consistency check (ORB-SLAM3).** Before accepting a loop candidate, ORB-SLAM3 applies two levels of filtering: (1) **co-visibility grouping** — the candidate must be geometrically consistent with its co-visible neighbours in the map graph; (2) **ORB feature matching verification** — keypoints in the query frame are matched to map points in the candidate frame using Hamming distance with ratio test (Lowe's ratio ≤ 0.9). ORB-SLAM3 claims 100% precision on accepted loop closures via this chain.

**Atlas multi-map.** ORB-SLAM3 maintains a global Atlas of potentially disconnected submaps. When a loop closure is detected between the active map and an inactive map, the maps are merged via a welding-window bundle adjustment followed by essential-graph optimisation.

Sources: ORB-SLAM3 T-RO 2021 · DBoW2 TRO 2012 · [ORB-SLAM3 GitHub](https://github.com/UZ-SLAMLab/ORB_SLAM3)

### Visual Loop Closure: NetVLAD

**NetVLAD** (Arandjelovic et al., CVPR 2016) replaces hand-crafted BoW with a learned global image descriptor. The architecture plugs a differentiable VLAD aggregation layer into a CNN backbone (typically VGG-16 or ResNet). For K cluster centres {c_k} (K=64 typical), each local CNN feature x_i contributes:

```
V(j,k) = sum_i  a_k(x_i) * (x_i(j) - c_k(j))
```

where soft assignment `a_k(x_i) = softmax(-alpha ||x_i - c_k||^2)`. The final descriptor is the L2-normalised concatenation of all residual vectors (K × D, e.g. 64 × 512 = 32768-d, then PCA-whitened to 4096-d).

**Training.** Weakly supervised: positive pairs are Street View images of the same place; negatives are geographically distant images. Triplet loss with hard-negative mining.

**Real-time retrieval.** NetVLAD + FAISS enables sub-10 ms query time on a million-frame database, substantially outperforming DBoW2 on challenging outdoor sequences with illumination and viewpoint change.

Sources: [arXiv:1511.07247](https://arxiv.org/abs/1511.07247)

### Visual Loop Closure: AnyLoc

**AnyLoc** (IROS 2023/RA-L 2024) requires **no training on the target domain**. It extracts DINOv2 (ViT-L/14) features from overlapping image patches, applies VLAD aggregation with cluster centres from a domain-general training set, and produces a global descriptor. AnyLoc achieves strong Recall@1 across indoor, outdoor, aerial, and underwater environments without retraining.

A 2026 integration (DPV-SLAM) uses AnyLoc as the loop closure backend, replacing the classical BoW module. The result is more robust loop closure in environments where the training-domain assumption of DBoW2 is violated — e.g., industrial indoor or airside settings. Sources: [arXiv:2601.02723](https://arxiv.org/abs/2601.02723)

### Visual Loop Closure: ASMK

**ASMK** (Aggregated Selective Match Kernels, Tolias et al., ICCV 2013/IJCV 2016) bridges BoW and VLAD. Its key property is **selectivity**: a feature correspondence contributes to image similarity only if both descriptors are assigned to the same visual word (same Voronoi cell), avoiding cross-cluster false matches:

```
K(q, d) = sum_i  sum_j  sigma(x_i, y_j) * k(x_i, y_j)
```

where sigma is 1 if both descriptors share a Voronoi cell and 0 otherwise, and k is the dot product of residual vectors. ASMK achieves better precision-recall than plain BoW or VLAD on large-scale retrieval benchmarks. A Python implementation supports DELF descriptors and deep HOW local features. Sources: [GitHub: jenicek/asmk](https://github.com/jenicek/asmk)

### Classical LiDAR PR: Scan Context Family

**Scan Context** (Kim & Kim, IROS 2018) encodes a LiDAR scan as a 2D polar grid (azimuth × ring, typically 60 × 20 cells) where each cell stores the maximum height of contained points. Rotation invariance is achieved via ring-key first-stage retrieval followed by column-shift search. Fast (< 5 ms on CPU), no training required.

Key role in the three-stage pipeline: Scan Context provides the **initial rotation estimate** (column shift) as well as a retrieval score. Because it does not output a full 6-DoF transform, it must always be followed by ICP, KISS-Matcher, or Quatro to obtain a verifiable pose. The column shift provides the yaw prior that seeds global registration.

For full treatment of Scan Context++, STD, and the BEV-based successor methods, see [`./scan-context-family.md`](scan-context-family.md). Sources: [MulRan ICRA 2020](https://gisbi-kim.github.io/publications/gkim-2020-icra.pdf)

### Classical LiDAR PR: SegMap

**SegMap** (Dube et al., RSS 2018/IJRR 2020) operates at the object level. It segments the accumulated local map into 3D clusters (buildings, trees, vehicles, structural elements), encodes each segment with an autoencoder into a compact descriptor, then retrieves by segment matching against the database. Because segment descriptors are inherently view-invariant within a scene, SegMap tolerates moderate viewpoint changes better than scan-level descriptors.

Reported up to 50% reduction in open-loop trajectory error via loop closures on KITTI-like environments. **Limitation:** requires segmentable geometric objects — fails in open, flat environments (tarmac aprons, farmland, open mining pits) where there are few object-like structures. Sources: [IJRR 2020](https://journals.sagepub.com/doi/abs/10.1177/0278364919863090)

### LiDAR PR: Density-Map ORB (KISS-SLAM approach)

A method from IROS 2024 / arXiv:2501.07399 avoids learned descriptors entirely: accumulate 100 m of consecutive scans into a local map, project to BEV at 0.5 m resolution, compute normalised point density per cell, then extract **ORB descriptors** from the density image and index with HBST (Hamming distance binary search tree). Self-similarity pruning filters repetitive cells.

This method achieves highest average precision in 15/24 sequences on a multi-session evaluation across heterogeneous sensors (Ouster OS2, Livox Avia, Aeva Aeries). The BEV projection preserves floorplan-like geometric structure and generalises across sensor types without retraining — a significant advantage for heterogeneous airside fleets. Sources: [arXiv:2501.07399](https://arxiv.org/abs/2501.07399)

### Sequence Retrieval: SeqOT and SeqSLAM

Single-frame PR fails in perceptually aliased environments. **Sequence-based retrieval** matches a window of consecutive frames against database windows, exploiting trajectory context:

- **SeqSLAM** (visual): dynamic programming over a sliding window of frame-to-frame appearance differences. Tolerates illumination change; fails if travel speed is inconsistent.
- **SeqOT** (LiDAR, TIE 2022): spatial-temporal transformer over a range-image sequence of T consecutive scans. Jointly encodes azimuthal (spatial) and temporal dimensions; outperforms all single-scan methods on KITTI long-horizon retrieval. Sources: [arXiv:2209.07951](https://arxiv.org/abs/2209.07951)
- **SeqLPD** (RA-L 2019): DTW-based sequence matching over per-scan global descriptors.

**Why sequences help:** (1) Trajectory context disambiguates places that look identical at a single instant; (2) temporal averaging suppresses transient dynamic objects; (3) the accumulated geometric context from consecutive viewpoints resolves ambiguous single-scan geometry.

**Practical caveat.** Sequence PR requires the database to also store sequences. For kidnapped-robot start or session initialisation with no trajectory history, single-frame retrieval seeded by GPS coarse prior is needed first.

**Cross-link to learned descriptors.** For the full treatment of learned LiDAR place recognition — MinkLoc3D-V2, LoGG3D-Net, BEVPlace++, HOTFormerLoc, GeoAdapt domain adaptation — see [`./learned-lidar-place-recognition.md`](learned-lidar-place-recognition.md).

---

## Stage 2 — Geometric Verification

The purpose of Stage 2 is to (a) determine whether the Stage 1 candidate corresponds to a true revisit, (b) estimate the 6-DoF relative transform T_ij between query pose i and candidate pose j, and (c) reject false positives before they enter the pose graph.

### ICP Refinement (LiDAR)

**Classical ICP** iteratively finds correspondences between point clouds (nearest-neighbour) and minimises the sum of squared point-to-point (or point-to-plane) distances:

```
T* = argmin_T  sum_i  ||T x_i - y_{nn(i)}||^2
```

Converges to a local minimum; requires a good initial pose. The Stage 1 retrieval — especially Scan Context's column shift — provides this initial guess.

**KISS-ICP adaptive threshold.** KISS-ICP (IROS 2023 best paper) adapts the correspondence distance threshold dynamically based on observed odometric velocity: high-speed motion allows a larger threshold; stationary operation tightens it. This makes loop-closure ICP robust across sessions with different driving speeds. See [`./kiss-icp.md`](kiss-icp.md) for full mechanics. For the mathematical foundation of ICP, NDT, and GICP, see [`../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md`](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md).

### KISS-Matcher (Global Registration)

**KISS-Matcher** (published September 2024) is a global (initial-pose-free) point-cloud registration library. It combines three components:

1. **Faster-PFH** — an improved Fast Point Feature Histogram detector that identifies geometrically stable keypoints faster than the classical FPFH pipeline.
2. **K-core graph pruning** — correspondences are placed into a compatibility graph; edges connect pairs of correspondences that are mutually geometrically consistent. The k-core decomposition removes all nodes with degree < k, retaining only a dense clique of inlier correspondences. This replaces RANSAC for outlier rejection with lower time complexity.
3. **Pose solver** — TEASER++ or direct SVD on inlier correspondences.

KISS-Matcher achieves state-of-the-art success rate on global registration benchmarks while being substantially faster. As a global registration method, it is particularly valuable when the Stage 1 retrieval returns a candidate with unknown relative orientation — e.g., opposite-direction traversal on a taxiway. See [`./kiss-matcher.md`](kiss-matcher.md) for full treatment. Sources: [arXiv:2409.15615](https://arxiv.org/abs/2409.15615)

### Quatro

**Quatro** is a global LiDAR registration method that decouples rotation (solved via quasi-SO(3) constraint) from translation, enabling robust registration even under large initial pose errors and with up to 70% outlier correspondences. Used in the FAST-LIO-SAM-SC-QN community integration as the verification step after Scan Context candidate retrieval. Sources: [GitHub: engcang/FAST-LIO-SAM-SC-QN](https://github.com/engcang/FAST-LIO-SAM-SC-QN)

### RANSAC + PnP for Visual Loop Closure

For camera-based systems, geometric verification uses feature matching with RANSAC outlier rejection:

1. **Local feature extraction.** SuperPoint, DISK, or ALIKED extract keypoints and descriptors from both query and candidate frames.
2. **Feature matching.** Mutual nearest-neighbour matching in descriptor space, filtered by Lowe's ratio test (best-to-second-best distance ratio < 0.8).
3. **Geometric model estimation.** Two cases:
   - If 3D map points are available (SLAM case): estimate the relative pose using **PnP + RANSAC** (Perspective-n-Point). RANSAC samples minimal sets (3 points for P3P), estimates pose, counts inliers within reprojection error < 4 px. Accepted if inlier count > N_min (typically 20–50).
   - If only 2D-2D correspondences are available: estimate the **Essential Matrix E** via 5-point RANSAC, decompose via SVD to obtain {R, t} up to sign, choose the consistent solution by chirality check.
4. **Refinement.** Non-linear least squares (Ceres or g2o) over all inliers refines the pose.

Sources: [GV-Bench arXiv:2407.11736](https://arxiv.org/pdf/2407.11736)

### Heuristic Pre-Filters

Some systems apply lightweight heuristic checks before running full ICP to reduce the number of expensive registration calls by 5–10x in practice:

- **Rotation alignment check** (Scan Context): the column-shift giving minimum distance difference provides an initial yaw; if the alignment score exceeds the retrieval threshold and the shift is geometrically plausible (e.g., within ±180° of expected heading), accept for ICP.
- **Point overlap / occupancy correlation**: project both scans into a shared BEV grid; compute Pearson correlation of occupancy counts. Candidate rejected if correlation < 0.5.
- **NDT score**: fast registration quality estimate via NDT cell matching without full ICP.

### Acceptance Criteria

After ICP/KISS-Matcher, a loop candidate is accepted if:

```
fitness_score (mean squared inlier error) < threshold (e.g. 0.2-0.3 m^2)
inlier_ratio  (inliers / total correspondences) > threshold (e.g. 0.3)
rotation_residual < threshold (e.g. 3-5 degrees)
```

Tighten these thresholds for safety-critical applications. For airside map building, prefer missed closures over false positives.

### The False-Positive Cost

A single false-positive loop closure that passes geometric verification (e.g., two visually similar corridor segments that also produce a low ICP fitness score) inserts an incorrect relative-pose edge with covariance far too tight. The optimiser respects this constraint and deforms the rest of the trajectory to satisfy it, potentially folding the map. Recovery requires manual identification and deletion of the bad edge and re-optimisation.

This is why geometric verification is the **primary safety net** and robust kernels are a secondary net. Systems that run ICP verification with strict thresholds report near-zero false-positive loop-closure rates on well-structured environments.

---

## Stage 3 — Pose-Graph Optimisation

### SE(3) Pose-Graph Cost Function

The pose graph is a factor graph G = (V, E) where:

- **Nodes V** = {x_1, x_2, ..., x_N} — robot poses in SE(3), each x_i = (R_i, t_i).
- **Edges E** = odometry edges union loop-closure edges — each edge (i, j) carries a relative transform measurement z_ij and an information matrix (inverse covariance) Omega_ij.

The optimisation problem is:

```
x* = argmin_x  sum_{(i,j) in E}  rho( e_ij(x_i, x_j)^T Omega_ij e_ij(x_i, x_j) )
```

where the SE(3) error is computed in the Lie algebra:

```
e_ij = Log( z_ij^{-1} * x_i^{-1} * x_j )
```

Log is the SE(3) logarithmic map that maps a group element back to a 6-vector in the tangent space (twist). With rho = identity (squared norm, i.e. least squares), this is the standard maximum-likelihood pose graph. The system is linearised around the current estimate and solved iteratively by Gauss-Newton or Levenberg-Marquardt.

**SE(3) parameterisation.** Two conventions are common: (1) local parameterisation with exponential map (GTSAM `GTSAM_POSE3_EXPMAP=ON` required for correct Jacobians near singularities); (2) global quaternion + position. The exponential-map parameterisation has better convergence properties. For the Lie algebra derivations, see [`../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md`](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md).

### Backends: g2o, GTSAM-iSAM2, Ceres

**g2o** (Kümmerle et al., ICRA 2011). General sparse graph optimisation framework. Supports SE(2), SE(3), Sim(3) nodes and edges. Uses Cholesky factorisation (via CSparse or Eigen) to solve the normal equations. Online mode re-solves from scratch at each update — expensive for large graphs. Used in ORB-SLAM2/3 for local and global bundle adjustment. Sources: [GitHub: RainerKuemmerle/g2o](https://github.com/RainerKuemmerle/g2o)

**GTSAM + iSAM2** (Kaess et al., IJRR 2012). Incremental smoothing and mapping. Maintains a **Bayes tree** — a sparse factored representation of the posterior. Each new observation triggers only a partial re-factorisation of the affected subtree, O(log N) in practice on tree-structured graphs, O(N) in the worst case for dense loop closures. GTSAM requires the problem to be well-constrained (all poses reachable from the prior). Used in LIO-SAM, LeGO-LOAM, and the recommended FAST-LIO2 loop-closure pipeline. See [`../../../10-knowledge-base/state-estimation/gtsam-factor-graphs.md`](../../../10-knowledge-base/state-estimation/gtsam-factor-graphs.md). Sources: [GTSAM](https://gtsam.org/)

**Ceres Solver** (Agarwal et al., Google). Automatic differentiation, highly optimised sparse linear solver. Used in Cartographer (Google). More flexible than GTSAM but less purpose-built for pose graphs.

### Robust Kernels

Without robust kernels (rho = identity), a single false-positive loop closure can steer the optimiser to a wrong solution even if all other constraints are correct. Robust kernels down-weight high-residual constraints:

**Huber kernel:**

```
rho_Huber(s) = s            if s <= delta^2
rho_Huber(s) = 2*delta*sqrt(s) - delta^2  if s > delta^2
```

Transitions from quadratic (inliers) to linear (outliers) at threshold delta. Linear growth reduces but does not eliminate outlier influence. **Key limitation:** Huber alone is insufficient to reject strong false-positive loop closures in pose-graph SLAM — the optimiser can still converge to the wrong solution. Experimentally demonstrated in Sünderhauf (ICRA 2012).

**Dynamic Covariance Scaling (DCS)** (Agarwal et al., ICRA 2013). Closed-form robust weighting: for each edge, a scaling factor s_ij in [0,1] is computed as:

```
s_ij = min(1,  2*phi / (phi + chi2_ij))
```

where chi2_ij is the Mahalanobis error of constraint (i,j) and phi is a user-defined threshold. The edge information matrix is scaled by s_ij, effectively down-weighting high-error constraints. Unlike Switchable Constraints, DCS does not add extra variables. Claimed to handle up to 1000 false-positive loop closures on test datasets. Sources: [Robust Map Optimization using DCS, ICRA 2013](http://www2.informatik.uni-freiburg.de/~spinello/agarwalICRA13.pdf)

**Graduated Non-Convexity (GNC)** (Yang et al., TRO 2020). A principled approach: the robust cost function rho(s; mu) is parameterised by a control variable mu that interpolates between a convex surrogate (easy to optimise, insensitive to outliers) at mu=0 and the target non-convex robust cost (truncated least squares or Geman-McClure) at mu=1. Optimisation alternates between: solving the weighted least squares problem with current mu, then increasing mu toward 1. At the final mu=1, the solver has found a good basin of attraction for the true robust objective.

GNC is robust to up to 70–80% outlier measurements, outperforming RANSAC in the pose-graph context. **Kimera2 replaced PCM with GNC** as its primary outlier rejection method. Sources: [arXiv:1909.08605](https://arxiv.org/abs/1909.08605) · [Efficient GNC Scheduling arXiv:2310.06765](https://arxiv.org/abs/2310.06765)

**Switchable Constraints** (Sünderhauf & Protzel, IROS 2012). For each loop-closure edge (i,j), an additional **switch variable** s_ij in [0,1] is added to the factor graph. The edge is multiplied by s_ij: when s_ij → 1 the constraint is fully active; when s_ij → 0 it is effectively disabled. A prior on s_ij biases it toward 1 (believing loop closures are correct). If a closure is inconsistent with the rest of the graph, its cost drives s_ij toward 0, effectively removing the constraint.

The topology of the factor graph becomes part of the optimisation — the solver can change which edges are active. Handles up to 1000 false positives on published benchmarks. Limitation: adds N_loops extra variables, potentially slowing optimisation significantly for systems with many loop closures. Sources: [Switchable Constraints IROS 2012](https://nikosuenderhauf.github.io/assets/papers/IROS12-switchableConstraints.pdf)

### Kimera-RPGO and Pairwise Consistency Maximisation

**Kimera-RPGO** (MIT SPARK Lab, open-source) is a standalone robust pose-graph optimisation library wrapping GTSAM with **Pairwise Consistency Maximization (PCM)** outlier rejection. See [`./kimera-rpgo-pcm.md`](kimera-rpgo-pcm.md) for full treatment.

**PCM algorithm** (Mangelson et al., ICRA 2018). Each loop-closure candidate is a node in a **consistency graph** C. Two loop closures (i,j) and (k,l) are connected by an edge in C if their relative-pose measurements are mutually consistent: the composition `z_ij · z_jk ... · z_lk` closes approximately to identity under the current odometry chain. Finding the largest set of pairwise consistent loop closures is equivalent to the **maximum clique problem** on C, which Kimera-RPGO solves using an adapted maximum-clique finder. Only loop closures in the maximum clique are passed to the GTSAM optimiser.

**Practical characteristics.** PCM is robust against arbitrary false-positive rates as long as the true inlier set forms a consistent clique. It runs incrementally: as new loop closures arrive, the consistency graph is updated and the maximum clique is re-solved. Kimera2 (2024) has replaced PCM with GNC for better theoretical guarantees. Sources: [GitHub: MIT-SPARK/Kimera-RPGO](https://github.com/MIT-SPARK/Kimera-RPGO) · [Kimera2 Springer 2024](https://link.springer.com/chapter/10.1007/978-3-031-63596-0_8)

---

## Cross-Modal Loop Closure

**Motivation.** A LiDAR map might be built by one sensor type while online verification uses a camera (lighter payload on the operational vehicle), or a survey used a camera-only system but the operational robot is LiDAR-primary.

**Visual-on-LiDAR-map closure.** Project the LiDAR map into a synthetic depth or normal image. Extract visual features (SuperPoint, ORB) from the rendering; match against camera query features. Requires accurate LiDAR-to-camera calibration and accurate depth rendering.

**LiDAR-on-visual-map closure.** Convert 3D map points from visual SfM/SLAM into a sparse point cloud. Run ICP between the LiDAR query and this sparse cloud. The density mismatch makes ICP less reliable; NDT or feature-based registration is preferred.

**Multi-modal fusion.** TS-LCD (Sensors 2024) implements a two-stage cross-modal approach: Stage 1 is visual retrieval (NetVLAD or BoW); Stage 2 is LiDAR-depth geometric verification. Timestamp synchronisation between camera and LiDAR is required. A combined similarity matrix merges visual and spatial scores, reducing false positives in both modalities. Sources: [TS-LCD PMC 2024](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11207695/)

**Foundation-model approach (2025).** A multimodal pipeline uses DINOv2 for visual retrieval and a LiDAR 3D backbone for geometric verification, connected via a transformer bridge. Handles severely unstructured environments where neither modality alone achieves sufficient precision. Sources: [arXiv:2511.05404](https://arxiv.org/pdf/2511.05404)

**Practical note.** Cross-modal closure is significantly more complex than same-modal closure due to sensor resolution mismatches, calibration errors, and representation heterogeneity. For airside aggregated-map building, the recommended approach is LiDAR-to-LiDAR closure as the primary modality, relying on cross-modal only when primary-modality coverage is insufficient.

---

## Multi-Session / Lifelong Loop Closure

**Problem.** When a robot performs a new survey on a different day, the new trajectory must be anchored to the existing map. Loop closures between the new session and the stored map are **inter-session loop closures**.

**LT-Mapper** (Kim & Kim, ICRA 2022) is the canonical open-source framework for LiDAR-based lifelong mapping. It decomposes the problem into:

1. **Multi-Session SLAM (LT-SLAM)** — aligns N sessions in a shared coordinate frame using **anchor-node-based pose-graph optimisation**. Anchor nodes are keyframes from one session detected (via Scan Context or learned PR) as matching keyframes from another session; ICP provides the inter-session relative transform; GTSAM optimises the joint graph.
2. **Change detection** — after alignment, compare session submaps to detect new permanent structures (construction), removed structures (moved aircraft), and transient changes.
3. **Map update** — positive changes (new static structures) are added; negative changes (removed structures) are masked.

Full treatment is in [`./lt-mapper-khronos-lifelong-mapping.md`](lt-mapper-khronos-lifelong-mapping.md). The key loop-closure-specific insight: inter-session closures have higher false-positive risk because the environment may have changed — an area empty in session 1 may have a parked aircraft in session 2, producing a partial match that ICP incorrectly accepts. Session-aware verification (flagging closures near known-dynamic regions) is important.

**COVINS-G** (ICRA 2023) handles the collaborative multi-robot variant: multiple robots share a centralised SLAM server, each sending keyframes to the server, which detects inter-robot loop closures using multi-camera relative pose estimation and merges the joint pose graph. The architecture is front-end agnostic. See [`./covins-covins-g.md`](covins-covins-g.md). Sources: [LT-Mapper arXiv:2107.07712](https://arxiv.org/abs/2107.07712) · [COVINS-G arXiv:2301.07147](https://arxiv.org/abs/2301.07147)

---

## Failure Modes

### Perceptual Aliasing

Two geographically distinct locations produce near-identical descriptors. Classic cases: rows of identical warehouse shelving, parallel taxiway segments with repeated runway markings, identical tunnel cross-sections, uniform corridor segments.

**Consequence.** Stage 1 retrieves the wrong candidate. If Stage 2 ICP also succeeds (the point clouds look similar from both locations), the false closure enters the pose graph and corrupts the map.

**Mitigations.** (a) Sequence-based PR (SeqOT) — trajectory context disambiguates perceptually aliased locations; (b) PCM / GNC in Stage 3 — mutual consistency check rejects isolated false-positive closures; (c) tighter ICP acceptance thresholds; (d) semantic context (combining geometric PR with semantic labels eliminates aliases between e.g. a taxiway and a service road). Sources: [BoWG arXiv:2510.22529](https://arxiv.org/abs/2510.22529) · [Early Bird arXiv:2010.01421](https://arxiv.org/abs/2010.01421)

### Viewpoint Change

Traversing the same path from the opposite direction produces a scan that is geometrically reversed relative to the database entry. Many descriptors (Scan Context with column-shift, range-image descriptors) handle 180° yaw. KISS-Matcher as a global registration method handles arbitrary initial rotations.

Larger lateral offsets (different lane, different path within an apron) change the scan structure significantly. Methods that exploit multi-scan overlap geometry (OverlapTransformer) or BEV projections (BEVPlace++) are more tolerant of lateral offsets. Sources: [Early Bird arXiv:2010.01421](https://arxiv.org/abs/2010.01421)

### Season and Weather Change

Seasonal vegetation change alters point-cloud statistics (dense summer canopy vs. bare winter branches). Heavy rain causes point attenuation (fewer returns beyond 30 m) and false reflections. Snow covers ground features.

**LiDAR impact.** Less severe than for cameras (no illumination sensitivity), but non-trivial. MinkLoc3D and LoGG3D-Net, trained on Oxford (UK roads), degrade in seasonal datasets (NCLT 15-month, ROVER multi-season). GeoAdapt-style self-supervised test-time adaptation addresses this without labels.

### Dynamic Scenes

Parked aircraft, vehicles, and ground service equipment (GSE) move between survey sessions. A loop closure matched in session 1 may fail ICP in session 2 because a large GSE object is present in the query area but absent in the database (or vice versa), changing the dominant geometric structure.

**Mitigations.** (a) Dynamic point removal (ERASOR, BeautyMap) before inserting keyframes into the PR database; (b) ICP with point-to-plane metric and outlier rejection is less sensitive to missing points than point-to-point; (c) semantic segmentation masking of dynamic classes before descriptor extraction.

### The Combined Role of Stage 2 and Stage 3

- **Stage 2 (geometric verification)** catches most false positives from perceptual aliasing: even if two locations look similar in descriptor space, their point clouds are geometrically different and ICP will fail (high fitness score, low inlier count).
- **Stage 3 (robust kernels / PCM / GNC)** catches residual false positives that passed Stage 2: these are geometrically plausible but globally inconsistent closures that would require the rest of the trajectory to bend implausibly.

Neither stage alone is sufficient.

---

## Production-Grade Systems

### ORB-SLAM3

**Type.** Visual / visual-inertial / multi-map. **Loop closure.** DBoW2 retrieval → co-visibility consistency check → ORB feature matching verification → Essential-graph pose-graph optimisation + full BA. Multi-map merging via welding-window BA. **Backend.** g2o for local BA; custom pose-graph solver for essential graph. **Code.** [GitHub: UZ-SLAMLab/ORB_SLAM3](https://github.com/UZ-SLAMLab/ORB_SLAM3). Sources: ORB-SLAM3 T-RO 2021.

### LIO-SAM

**Type.** LiDAR-inertial odometry + mapping. **Loop closure.** Radius-search on historical pose positions (Euclidean proximity in pose space) → ICP between current scan and historical local map. **Backend.** GTSAM iSAM2. **Community extension.** SC-LIO-SAM replaces radius-search with Scan Context for more discriminative candidates. **Code.** [GitHub: TixiaoShan/LIO-SAM](https://github.com/TixiaoShan/LIO-SAM). See also: [`./lio-sam.md`](lio-sam.md).

### LeGO-LOAM and SC-LeGO-LOAM

**Type.** Ground-optimised LiDAR odometry + mapping. **Loop closure.** KD-tree on historical poses → ICP. SC-LeGO-LOAM replaces KD-tree proximity with Scan Context. **Code.** [GitHub: gisbi-kim/SC-LeGO-LOAM](https://github.com/gisbi-kim/SC-LeGO-LOAM). See also: [`./lego-loam.md`](lego-loam.md).

### FAST-LIO2 + SC-PGO (FAST_LIO_SLAM)

FAST-LIO2 front-end (see [`./fast-lio-fast-lio2.md`](fast-lio-fast-lio2.md)) + external Scan Context place recognition + GTSAM-based pose-graph back-end. The SC-PGO node subscribes to FAST-LIO2 odometry and point-cloud topics, builds the Scan Context database, detects loop candidates, runs ICP, and publishes the optimised map.

**Code.** [GitHub: gisbi-kim/FAST_LIO_SLAM](https://github.com/gisbi-kim/FAST_LIO_SLAM) · [GitHub: engcang/FAST-LIO-SAM-SC-QN](https://github.com/engcang/FAST-LIO-SAM-SC-QN) (with Quatro for global registration).

Community integrations: [FAST-LIO-SAM](https://github.com/engcang/FAST-LIO-SAM) adds GTSAM + radius-search LC + ICP; [better_fastlio2](https://github.com/Yixin-F/better_fastlio2) adds dynamic removal + multi-session mapping + relocalisation.

### KISS-SLAM Loop Closure

KISS-ICP v2+ adds an optional loop-closure module. The IROS 2024 follow-up paper uses **density-map ORB descriptors** for candidate retrieval followed by RANSAC-based BEV alignment for verification, composing to a full SE(3) transform for graph insertion. Works across heterogeneous sensor types without retraining. Sources: [arXiv:2501.07399](https://arxiv.org/abs/2501.07399)

### COVINS-G (Collaborative Multi-Robot)

Multi-robot collaborative SLAM with centralised back-end. Front-end agnostic (tested with Realsense T265, VINS-Mono). Detects inter-robot loop closures using multi-camera relative pose estimation. Joint pose-graph optimisation on the server. Open-source. See [`./covins-covins-g.md`](covins-covins-g.md). Sources: [arXiv:2301.07147](https://arxiv.org/abs/2301.07147)

---

## Benchmark Results

### Datasets

| Dataset | Type | Sensor | Scale | Ground Truth | Notes |
|---|---|---|---|---|---|
| **KITTI Odometry** | Urban (DE) | Velodyne HDL-64 | 11 sequences, 0.2–8 km | GPS/IMU + SfM | Sequences 00, 02, 05, 06, 07, 08 have loops; standard LC benchmark |
| **NCLT** | Campus (MI, USA) | Velodyne HDL-32 | 15-month long-term | GPS | Seasonal change; multi-session; ~1 km loops |
| **Oxford RobotCar** | Urban (UK) | Velodyne HDL-32 | 1 year, 1000 km | GPS/IMU | Designed for VPR; used for LC in PR papers; 25 m positive threshold |
| **MulRan** | Urban (KR) | Ouster OS1-64 | 3 cities × 3 runs | GPS/IMU | Dense urban; repetitive structures; 10 m positive threshold |
| **4Seasons** | Multi-weather | Camera + RTK | Urban + suburban | RTK GPS | Cross-season LC evaluation |
| **HeLiPR** | Mixed (KR) | Heterogeneous sensors | Parallel to MulRan | GPS | Cross-sensor LC evaluation |

Sources: [4Seasons arXiv:2009.06364](https://arxiv.org/abs/2009.06364) · [HeLiPR arXiv:2309.14590](https://arxiv.org/abs/2309.14590) · [NCLT dataset](http://robots.engin.umich.edu/nclt/) · [MulRan ICRA 2020](https://gisbi-kim.github.io/publications/gkim-2020-icra.pdf)

### Evaluation Metrics

**Place recognition quality:**

- **Recall@1 / Recall@N** — fraction of queries for which the rank-1 (or top-N) retrieval is a true positive (distance < threshold). Primary headline metric.
- **F1_max** — maximum F1 over all descriptor-distance thresholds; balances precision and recall without fixing an operating point. Used by LoGG3D-Net, LCDNet.
- **Average Precision (AP) / area under PR curve** — summary over all thresholds; more informative than a single threshold metric.

**Loop-closure system quality:**

- **Precision / Recall on detected loop pairs** — at the PR detection output, before ICP.
- **Post-LC absolute trajectory error (ATE) and relative pose error (RPE)** — after pose-graph optimisation with loop closures. Typical result: FAST-LIO2 without LC on a 2 km loop: ~5 m ATE; with Scan Context + ICP + GTSAM: < 0.5 m ATE.
- **Drift reduction ratio** — (ATE without LC − ATE with LC) / ATE without LC. A well-calibrated LC system reduces ATE by 80–95% on typical urban loops.
- **Map consistency** — qualitative or quantitative: number of visible map seams, overlap of repeated traversals in the merged map.

**Important caveat.** A method achieving Recall@1 = 99% on Oxford RobotCar (25 m threshold, rich urban geometry) may achieve only 60–75% on a structurally homogeneous airside apron. Do not transfer benchmark numbers directly to operational environments.

---

## For Aggregated-LiDAR-Map Building

### Why Loop Closure Is Non-Negotiable

The aggregated-map pipeline (survey vehicle traversing the operational area) relies on SLAM to build the base map. A typical airport apron survey covers 1–3 km of traversal. Without loop closure, FAST-LIO2 or similar LiDAR odometry accumulates 1–5 m of positional drift per 100 m, resulting in map seams, lane-level errors, and inconsistent building facades and taxiway edge markings. Even a single good loop closure on a 1 km loop can reduce end-point error from 5–10 m to < 0.5 m.

For the aggregated-map build pipeline context, see [`../../perception/overview/aggregated-map-semantic-segmentation.md`](../../perception/overview/aggregated-map-semantic-segmentation.md).

### Recommended Stack

For an airside aggregated-map build pipeline:

**1. Front-end:** FAST-LIO2 — tightly coupled LiDAR-IMU, fast, robust. Outputs keyframes + undistorted scans + incremental pose estimates. See [`./fast-lio-fast-lio2.md`](fast-lio-fast-lio2.md).

**2. Candidate retrieval (Stage 1):**

- Primary: Scan Context (fast, no training, provides rotation hint) OR density-map ORB (sensor-agnostic, better performance on heterogeneous fleet).
- Optional augmentation: MinkLoc3D-V2 or LoGG3D-Net learned descriptor for challenging environments (apron with few Scan Context-discriminative structures). Fine-tune on 500–1000 site-specific scan pairs from one survey drive.
- Retrieval index: FAISS IVF-PQ for sub-ms lookup on databases up to 10^5 keyframes.

**3. Geometric verification (Stage 2):**

- KISS-Matcher (global, initial-pose-free) when Scan Context column-shift provides only yaw, not full 6-DoF.
- Alternative: FAST-LIO-SAM-SC-QN pipeline (Scan Context → Quatro global registration → Nano-GICP refinement).
- Acceptance: inlier ratio > 0.30, fitness < 0.2 m², rotation residual < 3°.

**4. Pose-graph back-end (Stage 3):**

- GTSAM iSAM2 for incremental updates during the survey drive.
- Robust kernel: GNC (truncated least squares) configured with outlier threshold phi = 3 sigma of expected odometry noise.
- Alternative: Kimera-RPGO (PCM + GTSAM) if the false-positive rate from Stage 2 is non-negligible.

**5. Post-survey refinement:**

- After the full survey drive, run a final batch optimisation (g2o global BA or GTSAM batch) over the complete pose graph.
- Export the globally optimised map as a voxel map (TSDF or VDB) for operational use.

### Airside-Specific Risks

- **Open tarmac perceptual aliasing.** Parallel taxiway segments are geometric near-clones. Use sequence-based PR (SeqOT) or learned descriptors that capture terminal building silhouettes on the horizon.
- **Dynamic aircraft and GSE.** Run ERASOR or BeautyMap dynamic removal before inserting keyframes into the PR database; otherwise, parked aircraft create spurious structural features that corrupt inter-session closures.
- **Partial FoV during apron-edge runs.** If the survey vehicle tracks an apron edge with buildings on one side only, Scan Context's 360° symmetry assumption breaks. Use SOLiD or density-map approach that tolerates partial-FoV scans.
- **Cross-session consistency.** When extending the map on subsequent survey days, use LT-Mapper's inter-session anchor architecture (see [`./lt-mapper-khronos-lifelong-mapping.md`](lt-mapper-khronos-lifelong-mapping.md)) to globally register new sessions to the existing map.
- **False-positive cost is higher than urban.** In urban SLAM, a deformed map is a navigation annoyance. In an airside map used by autonomous tugs or pushback vehicles, a deformed map can cause a collision with an aircraft. Tighten verification thresholds and log every accepted loop closure with its full residual history for safety review.

---

## Related Repository Docs

- [Learned LiDAR Place Recognition](./learned-lidar-place-recognition.md) — full treatment of MinkLoc3D-V2, LoGG3D-Net, BEVPlace++, HOTFormerLoc, GeoAdapt
- [Scan Context Family](./scan-context-family.md) — Scan Context++, STD, BEV-based classical LiDAR PR
- [KISS-ICP](./kiss-icp.md) — odometry front-end; adaptive threshold mechanics
- [KISS-Matcher](./kiss-matcher.md) — global registration backend for Stage 2
- [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) — recommended odometry front-end for the aggregated-map stack
- [LIO-SAM](./lio-sam.md) — GTSAM-based LiDAR-inertial system with built-in LC
- [LeGO-LOAM](./lego-loam.md) — ground-optimised alternative
- [LT-Mapper / Khronos Lifelong Mapping](./lt-mapper-khronos-lifelong-mapping.md) — multi-session loop closure and map update
- [Kimera-RPGO PCM](./kimera-rpgo-pcm.md) — robust PCM outlier rejection library
- [Certifiable Pose-Graph Optimization](./certifiable-pose-graph-optimization.md) — formal optimality certificates for PGO
- [Distributed Multi-Robot PGO](./distributed-multi-robot-pgo.md) — decentralised collaborative approaches
- [COVINS / COVINS-G](./covins-covins-g.md) — collaborative multi-robot SLAM with centralised server
- [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) — map build pipeline context
- [GTSAM Factor Graphs](../../../10-knowledge-base/state-estimation/gtsam-factor-graphs.md) — backend mathematics
- [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md)
- [Lie Groups SE(3)/SO(3) Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md)
- [Radar Place Recognition: 4D Radar Descriptor Lineage](radar-place-recognition-4dral-sherloc.md)
- [Robust State Estimation and Multi-Sensor Localization Fusion](../overview/robust-state-estimation-multi-sensor.md)
- [LiDAR Place Recognition and Re-Localization](../overview/lidar-place-recognition-relocalization.md)

---

## Sources

| Reference | URL |
|---|---|
| ORB-SLAM3 T-RO 2021 | [PDF](https://gaoyichao.com/Xiaotu/papers/2021%20-%20ORB-SLAM3%20An%20Accurate%20Open-Source%20Library%20for%20Visual%20Visual-Inertial%20and%20Multi-Map%20SLAM.pdf) |
| DBoW2 Bags of Binary Words TRO 2012 | [ResearchGate](https://www.researchgate.net/publication/260635123_Bags_of_Binary_Words_for_Fast_Place_Recognition_in_Image_Sequences) |
| NetVLAD CVPR 2016 | [arXiv:1511.07247](https://arxiv.org/abs/1511.07247) |
| AnyLoc + DPV-SLAM 2026 | [arXiv:2601.02723](https://arxiv.org/abs/2601.02723) |
| ASMK ICCV 2013 | [Project page](http://image.ntua.gr/iva/research/asmk/) · [GitHub: jenicek/asmk](https://github.com/jenicek/asmk) |
| SegMap IJRR 2020 | [SAGE Journals](https://journals.sagepub.com/doi/abs/10.1177/0278364919863090) |
| SeqOT TIE 2022 | [arXiv:2209.07951](https://arxiv.org/abs/2209.07951) |
| KISS-ICP IROS 2023 | [arXiv:2209.15397](https://arxiv.org/abs/2209.15397) |
| KISS-Matcher arXiv 2024 | [arXiv:2409.15615](https://arxiv.org/abs/2409.15615) |
| Density-Map Loop Closure arXiv 2025 | [arXiv:2501.07399](https://arxiv.org/abs/2501.07399) |
| Switchable Constraints IROS 2012 | [PDF](https://nikosuenderhauf.github.io/assets/papers/IROS12-switchableConstraints.pdf) |
| DCS Robust Map Optimization ICRA 2013 | [PDF](http://www2.informatik.uni-freiburg.de/~spinello/agarwalICRA13.pdf) |
| GNC TRO 2020 | [arXiv:1909.08605](https://arxiv.org/abs/1909.08605) |
| Efficient GNC Scheduling IJCAS 2025 | [arXiv:2310.06765](https://arxiv.org/abs/2310.06765) |
| Adaptive GNC arXiv 2023 | [arXiv:2308.11444](https://arxiv.org/abs/2308.11444) |
| Kimera-RPGO GitHub | [GitHub: MIT-SPARK/Kimera-RPGO](https://github.com/MIT-SPARK/Kimera-RPGO) |
| PCM ICRA 2018 | [Semantic Scholar](https://www.semanticscholar.org/paper/Pairwise-Consistent-Measurement-Set-Maximization-Mangelson-Dominic/553d79fa20ed980754188105b8d91f51f8dc1e7b) |
| Kimera2 Springer 2024 | [Springer](https://link.springer.com/chapter/10.1007/978-3-031-63596-0_8) |
| LT-Mapper ICRA 2022 | [arXiv:2107.07712](https://arxiv.org/abs/2107.07712) · [GitHub](https://github.com/gisbi-kim/lt-mapper) |
| COVINS-G ICRA 2023 | [arXiv:2301.07147](https://arxiv.org/abs/2301.07147) |
| LIO-SAM GitHub | [GitHub: TixiaoShan/LIO-SAM](https://github.com/TixiaoShan/LIO-SAM) |
| SC-LeGO-LOAM GitHub | [GitHub: gisbi-kim/SC-LeGO-LOAM](https://github.com/gisbi-kim/SC-LeGO-LOAM) |
| FAST_LIO_SLAM GitHub | [GitHub: gisbi-kim/FAST_LIO_SLAM](https://github.com/gisbi-kim/FAST_LIO_SLAM) |
| FAST-LIO-SAM-SC-QN GitHub | [GitHub: engcang/FAST-LIO-SAM-SC-QN](https://github.com/engcang/FAST-LIO-SAM-SC-QN) |
| GV-Bench geometric verification arXiv 2024 | [arXiv:2407.11736](https://arxiv.org/pdf/2407.11736) |
| TS-LCD multi-modal PMC 2024 | [PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11207695/) |
| Multi-modal LCD Foundation Models arXiv 2025 | [arXiv:2511.05404](https://arxiv.org/pdf/2511.05404) |
| Bag-of-Word-Groups (BoWG) arXiv 2025 | [arXiv:2510.22529](https://arxiv.org/abs/2510.22529) |
| Early Bird opposing viewpoints arXiv 2020 | [arXiv:2010.01421](https://arxiv.org/abs/2010.01421) |
| Role of Deep Learning in Loop Closure Sensors 2021 | [MDPI](https://www.mdpi.com/1424-8220/21/4/1243) |
| MulRan ICRA 2020 | [gisbi-kim.github.io](https://gisbi-kim.github.io/publications/gkim-2020-icra.pdf) |
| HeLiPR IJRR 2024 | [arXiv:2309.14590](https://arxiv.org/abs/2309.14590) |
| 4Seasons arXiv 2020 | [arXiv:2009.06364](https://arxiv.org/abs/2009.06364) |
| FAB-MAP IJRR 2008 | [Oxford Robotics](https://www.robots.ox.ac.uk/~pnewman/papers/IJRRFabMap.pdf) |
| GTSAM | [gtsam.org](https://gtsam.org/) |
| g2o ICRA 2011 | [GitHub: RainerKuemmerle/g2o](https://github.com/RainerKuemmerle/g2o) |
| LiDAR PR Survey ACM 2024 | [ACM DL](https://dl.acm.org/doi/10.1145/3707446) |
| Loop Closure SLAM explainer | [Ignitarium](https://ignitarium.com/3d-lidar-slam-loop-closure-explained/) |
