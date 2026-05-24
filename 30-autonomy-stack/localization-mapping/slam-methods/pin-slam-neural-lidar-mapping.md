# PIN-SLAM: Point-Based Implicit Neural LiDAR SLAM

<!-- method-priority:start
priority:
  learning: 3
  deployment: 2
  type: "method"
  stage: "frontier"
  maturity: "research"
  tags: ["slam", "mapping", "simulation", "validation"]
  reason: "PIN-SLAM is rated for neural or Gaussian SLAM research and future dense map representation workflows."
method-priority:end -->

Related docs: [NeRF-SLAM](nerf-slam.md) · [NICE-SLAM](nice-slam.md) · [Co-SLAM and ESLAM](co-slam-eslam.md) · [Splat-SLAM](splat-slam.md) · [GS-SLAM and MonoGS](gs-slam-monogs.md) · [4DNDF](4dndf.md) · [KISS-ICP](kiss-icp.md) · [FAST-LIO and FAST-LIO2](fast-lio-fast-lio2.md) · [KISS-SLAM](kiss-slam.md) · [Loop Closure and Place Recognition](loop-closure-place-recognition.md) · [Scan Context Family](scan-context-family.md) · [Removert](removert.md) · [TRLO Dynamic Tracking and Removal LiDAR Odometry](trlo-dynamic-tracking-removal-lidar-odometry.md) · [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md) · [MASt3R-SLAM](mast3r-slam.md) · [DROID-SLAM](droid-slam.md) · [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md) · [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) · [Point Cloud Representations, Voxelization, First Principles](../../../10-knowledge-base/geometry-3d/point-cloud-representations-voxelization-first-principles.md)

**Last updated:** 2026-05-24

---

## What It Is

PIN-SLAM ("LiDAR SLAM Using a Point-Based Implicit Neural Representation for Achieving Global Map Consistency") is a full LiDAR SLAM system that represents the map as a sparse set of optimizable neural points, each encoding a local implicit signed distance field (SDF). The system estimates per-scan poses via correspondence-free point-to-implicit registration, detects loops using learned neural point features, and achieves global map consistency by elastically deforming the neural point positions and features after pose-graph optimization — a capability that prior implicit neural SLAM systems did not have.

**Full citation:** Yue Pan, Xingguang Zhong, Louis Wiesmann, Thorbjorn Posewsky, Jens Behley, Cyrill Stachniss. "PIN-SLAM: LiDAR SLAM Using a Point-Based Implicit Neural Representation for Achieving Global Map Consistency." IEEE Transactions on Robotics (T-RO), vol. 40, pp. 4045–4064, 2024. DOI: 10.1109/TRO.2024.3422055. arXiv: 2401.09101 [cs.RO] — submitted 17 Jan 2024 (v1), revised 2 Jul 2024 (v2).

**Code:** https://github.com/PRBonn/PIN_SLAM (MIT license). Python 3.10, PyTorch 2.5.1, CUDA 11.8. Docker container and ROS 1 wrapper provided.

All six authors are from the **Photogrammetry and Robotics Lab (PRBonn)**, University of Bonn. Yue Pan is the lead architect and corresponding author. Cyrill Stachniss leads PRBonn; Jens Behley co-supervises neural mapping work. PRBonn also produced KISS-ICP, SHINE-Mapping, LocNDF, 4DNDF, and (in 2025) PINGS — making it the most sustained single source for production-relevant LiDAR neural SLAM methods.

---

## Successor: PINGS (RSS 2025)

**PINGS** (Pan et al., Robotics: Science and Systems 2025, arXiv 2502.05752, also at https://github.com/PRBonn/PINGS) extends PIN-SLAM's neural point map to also carry Gaussian splatting radiance alongside the SDF. Each neural point becomes a joint SDF anchor and a Gaussian primitive, enabling photo-realistic rendering and LiDAR-visual joint optimization from the same representation. PINGS degenerates to PIN-SLAM when only LiDAR is available — the SDF path is identical, and the Gaussian component is simply not activated.

PINGS surface accuracy on Oxford-Spires Blenheim Palace 05: PIN-SLAM Accuracy 0.078 m, Chamfer Distance 0.107 m, F-score 0.739; PINGS achieves slight improvement on the same sequence because camera data adds photometric supervision. These numbers are extracted from the PINGS HTML arXiv paper and provide the clearest publicly available surface-metric comparison for PIN-SLAM on a real outdoor dataset.

---

## Core Technical Idea

PIN-SLAM answers one hard question: how do you close loops and achieve global map consistency when your map is a neural implicit representation?

Classical SLAM systems with explicit maps — voxels, surfels, point clouds — correct loop closure by shifting coordinate frames or re-integrating scans into a corrected global volume. NeRF-based and neural SDF systems typically bake geometry into a fixed network or a grid tied to global coordinates. When global poses shift, there is no mechanism to propagate the correction through the representation without retraining.

PIN-SLAM solves this by making the map sparse and point-anchored. The map primitive is a **neural point**:

```
neural point = position (3D) + orientation (quaternion) + learned latent feature + support metadata
```

The collection of neural points implicitly defines a continuous SDF over the environment. Because geometry is anchored to explicit 3D points rather than encoded in a monolithic global network, the map deforms by moving the neural points and re-querying the SDF from their new positions. Local SDF queries are made relative to each neural point's own coordinate frame, so the field is defined by the anchor geometry — not by global coordinates.

This gives PIN-SLAM a property no prior implicit neural SLAM achieved: **elastic global consistency**. Loop closure no longer requires discarding or retraining the neural representation. It requires only moving the neural point anchors.

The registration step is also structurally different from conventional ICP. Rather than searching for nearest-neighbor correspondences between two explicit point sets, PIN-SLAM minimizes SDF residuals at incoming scan point positions, treating the implicit surface as the target. This is faster for large maps (no nearest-neighbor search) and more robust to uneven scan density.

---

## Five-Step Operator Pipeline

### Step 1 — Incremental Local SDF Learning

At each frame, the incoming LiDAR sweep is downsampled to two resolution levels: a finer mapping resolution (voxel size `v_m`) and a coarser registration resolution (`v_r > v_m`). Nearby neural points within a local spatial window are retrieved via a voxel hash index (hash table resolution `v_p`).

For each query location, the SDF value is predicted by a shared shallow MLP decoder that takes as input the interpolated latent features from the K nearest neural points, expressed in their local coordinate frames. The MLP is trained online each frame using samples from three zones per ray: surface zone (near the measured range), free-space zone (along the ray before the surface), and behind-surface zone (just past the measured range). This mirrors ray-marching in NeRF but operates in SDF space.

Loss: a clamped TSDF-style SDF loss plus an Eikonal regularizer enforcing unit-norm SDF gradients near surfaces. This is strictly online — no pretraining.

### Step 2 — Pose Estimation via Levenberg-Marquardt

Pose is estimated by minimizing SDF residuals at each incoming scan point position under the current pose estimate. The objective is:

```
minimize  sum_i  phi(q_i(T))^2
```

where phi is the SDF value at scan point q_i transformed by pose T. When the pose is correct, scan points lie on the zero-level set of the SDF (phi near zero).

Optimization uses **Levenberg-Marquardt (LM)** — not Gauss-Newton. Analytical SDF gradients via autodifferentiation of the MLP provide the Jacobian for each LM step efficiently. A robust kernel down-weights outlier scan points. Motion initialization uses a constant-velocity model, or IMU deskewing if available. The Jacobians propagate through the SE(3) pose parameterization; see [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) for the underlying math.

Because there is no nearest-neighbor search, registration is faster than conventional ICP for large maps and is not sensitive to map sparsity or point density variations across the scan.

### Step 3 — Map Growth (Neural Point Addition)

After pose estimation, the system decides where to grow the map. A neural point is created in a voxel if that voxel is unoccupied and the scan observes geometry there. Existing neural points are updated (feature gradient descent) in regions where the new scan provides new observations. Neural points that have not been observed for a long period and have low stability values can be pruned to keep memory bounded.

This dynamic growth mechanism allows the map to grow incrementally with exploration rather than requiring a pre-specified bounding box (unlike grid-based methods such as NICE-SLAM). See [Point Cloud Representations, Voxelization, First Principles](../../../10-knowledge-base/geometry-3d/point-cloud-representations-voxelization-first-principles.md) for background on voxel hashing.

### Step 4 — Loop Detection via Polar Context

Loop candidates are identified using a **Polar Context** descriptor (`U_t`) computed from the local neural point map. Polar Context encodes geometry in a polar grid histogram and is rotation-tolerant, making it suitable for detecting revisits with unknown heading offset. See [Scan Context Family](scan-context-family.md) for the descriptor family.

When a candidate loop is detected, it is geometrically verified by running point-cloud registration between the current scan and the neural-point-derived local map at the candidate pose. Only geometrically verified loops enter the pose graph. The key difference from classical loop closure: descriptors are derived from the learned neural point features, not raw point-cloud statistics — the loop detector is coupled to the map representation.

### Step 5 — Elastic Deformation After Pose-Graph Optimization

When a loop closes:

1. The pose graph is optimized using a standard factor-graph solver.
2. Each neural point is associated with the frame (or keyframe) that created it.
3. Neural points are moved and rotated according to the updated pose of their associated frame. Within each frame's local coordinate, the neural points are rigid. Globally, the map deforms to absorb the loop correction.
4. Because the SDF is defined relative to each neural point's local frame, the SDF field updates automatically when the anchor points move.

This is the central contribution. In prior implicit SLAM systems, the neural field was a fixed function of global coordinates — a loop correction had no mechanism to propagate through the representation. PIN-SLAM's anchor-based design solves this. See [Loop Closure and Place Recognition](loop-closure-place-recognition.md) for the broader loop-closure context.

---

## Architecture

```
LiDAR Sweep
     |
     v
[Preprocessing]
 deskew (--deskew flag), downsample
 to v_m (mapping) and v_r (registration)
     |
     +-----------> [Voxel Hash Index]
     |                    |
     |             K-NN neural point lookup
     |                    |
     v                    v
[Pose Estimation] <--- [SDF Query via shared MLP]
 Levenberg-Marquardt         |
 SDF residuals               |  iterates to convergence
 analytical gradient (autodiff)
 robust kernel on outliers
     |
     v
[Pose Accepted]
     |
     +-----> [Map Update]
     |        - Sample TSDF rays: surface / free-space / behind-surface zones
     |        - Update existing neural point features (gradient descent)
     |        - Add new neural points in unoccupied voxels
     |        - Prune low-stability neural points
     |
     v
[Loop Detection]
 Polar Context descriptor U_t from local neural point map
     |
 Compare against descriptor database
     |
 Geometric verification (point-cloud registration)
     |
 If loop accepted -> Pose Graph Optimization
     |
     v
[Elastic Deformation]
 Move each neural point with its associated frame's pose correction
     |
     v
[Map Products]
 Neural points (.ply with features) | Mesh (marching cubes) | Dense cloud | Trajectory
```

---

## Inputs and Outputs

| Item | Detail |
|---|---|
| Primary input | LiDAR sweeps (.ply, .pcd, .las, .bin; also rosbag / mcap / pcap) |
| Sensor support | Spinning LiDAR (Velodyne, Ouster), solid-state LiDAR, RGB-D depth cameras |
| Optional input | IMU for motion initialization and deskewing |
| Optional input | RGB images for colorized map output |
| Optional input | Pre-computed semantic labels (metric-semantic mode) |
| Output — pose | Per-frame 6-DOF sensor pose; trajectory (KITTI or TUM format) |
| Output — map | Sparse neural point cloud (.ply) with latent features attached |
| Output — mesh | Surface mesh via marching cubes at user-specified resolution |
| Output — dense cloud | Optional merged dense point cloud from estimated poses (flag -p) |

---

## Training and Implementation Details

**Online learning, no pretraining.** The shared MLP decoder and neural point feature vectors are initialized randomly and trained from scratch as the system runs. There is no offline training dataset, no foundation model dependency, and no domain-shift problem.

**MLP architecture.** The decoder is a shallow MLP (denoted M_mlp in the paper) shared across all neural points. Feature vectors per point carry the spatial geometry; the shared MLP decodes interpolated features to SDF values. The design is intentionally lightweight to permit frame-rate operation.

**Feature interpolation.** Each query point finds its K nearest neural points (typically K = 8 in a N_n x N_n x N_n voxel neighborhood). Features are interpolated using inverse-distance weighting expressed in the neural points' local coordinate frames (positions expressed relative to each anchor's position and orientation). This local-frame encoding is what makes the SDF invariant to local rigid transformations and is the mathematical foundation for elastic deformation — the SDF query result is the same regardless of where the anchor has been globally translated.

**Loss function.** Clamped SDF (TSDF-style) loss plus Eikonal regularizer. Samples drawn from three zones per ray: surface, free-space, and behind-surface.

**Hardware target.** Frame-rate (10 Hz) on an NVIDIA RTX 3080 (10 GB VRAM) or similar mid-range GPU. CPU-only mode is available but far too slow for real-time use. The README specifies minimum 4 GB GPU VRAM; 10 GB or more recommended for large outdoor sequences.

**Software stack.** Python 3.10, PyTorch 2.5.1, CUDA 11.8. ROS 1 wrapper available via `pin_slam_ros.py`. Docker container provided. No native ROS 2 support in the initial release (noted as future work in the README); bridge via `ros1_bridge` for ROS 2 infrastructure.

---

## Benchmarks

The full numerical tables are in the paper (T-RO vol. 40, pp. 4045–4064, DOI 10.1109/TRO.2024.3422055). Per-sequence ATE values from the paper's Table I are **paywalled** and not reproduced here; the evaluation notebooks at https://nbviewer.org/github/YuePanEdward/PIN_evaluation/ are the authoritative public source for per-dataset benchmark numbers and can be re-run on custom sequences.

**Datasets evaluated in the paper:**

| Dataset | Type | Sequences |
|---|---|---|
| KITTI Odometry | Outdoor road, spinning LiDAR | 00-10 |
| MulRan | Outdoor urban (Ouster LiDAR) | KAIST01, DCC01, others |
| Newer College Dataset (64-beam) | Outdoor campus (Ouster 64) | Short and long sequences |
| Newer College Dataset 2021 (128-beam) | Outdoor campus (Ouster 128) | stairs, math, quad |
| Replica | Indoor synthetic (RGB-D mode) | room0-room4, office0-office3 |

**Reported outcomes (from abstract and README, not paywalled):**

- PIN-SLAM achieves pose estimation accuracy "better or on par with state-of-the-art LiDAR odometry or SLAM systems" on KITTI, comparing against KISS-ICP, CT-ICP, FAST-LIO2, and similar classical baselines.
- Map consistency measured by reconstructing meshes before and after loop closure and computing Chamfer distance / F-score — compared with PIN LiDAR odometry alone (no loop closure) as the ablation baseline.

**PINGS surface accuracy comparison, Oxford-Spires Blenheim Palace 05** (from PINGS arXiv 2502.05752 HTML, PIN-SLAM column):

| System | Accuracy (m) | Chamfer (m) | F-score |
|---|---|---|---|
| PIN-SLAM | 0.078 | 0.107 | 0.739 |
| PINGS (LiDAR+camera) | slight improvement | slight improvement | slight improvement |

These numbers are the clearest publicly available surface-metric comparison for PIN-SLAM on a real large-scale outdoor sequence.

**Ablation studies** in the paper cover: correspondence-free vs. correspondence-based registration; neural features for loop detection vs. raw-cloud descriptors; elastic deformation on vs. off; online learning rate and sampling strategies.

---

## Comparison Table

| Criterion | PIN-SLAM | NICE-SLAM | Co-SLAM / ESLAM | Splat-SLAM / GS-SLAM | 4DNDF | KISS-ICP | FAST-LIO2 |
|---|---|---|---|---|---|---|---|
| **Paradigm** | Point-implicit SDF SLAM | Dense feature-grid NeRF SLAM | Hash-based neural SDF SLAM | 3DGS visual SLAM | Neural SDF mapping backend | Classical ICP odometry | Classical LIO (iVox) |
| **Map type** | Sparse neural points (implicit SDF) | Dense 3D feature grids (NeRF) | Hash-based neural SDF / feature grid | 3D Gaussian splats | Neural SDF (static structure) | Explicit voxel / point cloud | iVox / adaptive voxel |
| **Primary sensor** | LiDAR; RGB-D extension | RGB-D only | RGB-D only | RGB-D / monocular | LiDAR only | LiDAR only | LiDAR + IMU |
| **Loop closure** | Yes — Polar Context + elastic deformation | Yes (pose graph) | Partial (ESLAM has LC; Co-SLAM limited) | Yes (pose graph + global BA) | No — needs external poses | No (odometry only) | No (odometry only) |
| **Global consistency** | Yes — elastic neural point deformation | Yes — pose graph with grid warp | Limited / per-submap | Yes — closed-form Gaussian deformation | N/A — offline batch | No | No |
| **Dynamic scenes** | No — static assumption | No | No | No | No (temporal variation detection, offline) | No | Partial (iKFoM filter) |
| **Online / offline** | Online (frame-rate) | Online but slow (minutes/sequence) | Online | Online (~0.8-3.7 FPS) | Offline / batch | Online | Online |
| **GPU required** | Yes (>= 4 GB) | Yes | Yes | Yes | Yes | No | No (GPU accelerates) |
| **Mesh output** | Yes — marching cubes from SDF | Yes — NeRF volume rendering | Yes | Yes — Gaussian rasterization | Yes — marching cubes | No | No |
| **Map compactness** | High — sparse neural points | Low — dense pre-allocated grid | Medium — hash grid | Medium — per-surface Gaussians | High — sparse neural SDF | Low — explicit points | Low — explicit voxels |
| **Real-time (10 Hz)** | Yes on RTX 3080 | No | Partial | No at full quality | No | Yes on CPU | Yes on CPU |
| **Large-scale outdoor** | Yes (KITTI, MulRan tested) | No — memory explosion | Limited | No — texture-less failure | Yes (outdoor LiDAR) | Yes | Yes |
| **Pre-training** | None required | Coarse/mid decoders from ConvONet | None required | None required | None required | None required | None required |

---

## Lineage

PIN-SLAM sits at the convergence of three research streams.

**Neural implicit SDF mapping (RGB-D lineage).**
iSDF (Ortiz et al., 2022) was an early online SDF learning system for RGB-D. NICE-SLAM (Zhu et al., CVPR 2022) introduced hierarchical feature grids for dense NeRF-based SLAM with loop closure — the first scalable neural-implicit SLAM, and the standard baseline all successors measure against (see [NICE-SLAM](nice-slam.md)). Co-SLAM (Wang et al., CVPR 2023) and ESLAM (Johari et al., CVPR 2023) accelerated neural SLAM via hash-based representations (see [Co-SLAM and ESLAM](co-slam-eslam.md)). All these systems are RGB-D-centric and cannot handle LiDAR natively.

**Point-based neural representations.**
Point-NeRF (Xu et al., CVPR 2022) demonstrated that anchoring a NeRF to explicit 3D points — rather than a monolithic dense grid — yields better generalization and editing properties. PIN-SLAM adopts the anchor-point concept for SDF rather than radiance, and adds the coordinate-frame-relative encoding that makes elastic deformation possible.

**LiDAR-native neural SDF.**
SHINE-Mapping (Zhong et al., ICRA 2023, PRBonn) built large-scale LiDAR SDF maps using hierarchical octree-based feature grids. 4DNDF (Zhong et al., CVPR 2024, PRBonn) extended this to dynamic environments using a 4D space-time SDF (see [4DNDF](4dndf.md)). Both are offline mapping backends that require pre-computed poses. PIN-SLAM adds the full SLAM loop — odometry, loop detection, global optimization — on top of a neural SDF map, and introduces the elastic deformation mechanism that makes the neural map survivable under loop-closure corrections. The lineage within PRBonn is: SHINE-Mapping (static LiDAR SDF, offline) → 4DNDF (dynamic SDF, offline) → PIN-SLAM (full LiDAR SLAM, online, elastic) → PINGS (LiDAR+Gaussian, online).

The successor is **PINGS** (Pan et al., RSS 2025, arXiv 2502.05752, PRBonn), which extends PIN-SLAM's neural point map to also encode a Gaussian splatting radiance field alongside the SDF, enabling LiDAR-visual SLAM with photo-realistic rendering. PINGS degenerates to PIN-SLAM when only LiDAR is available, and the SDF core is identical. See also [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md) for 3DGS background.

---

## Strengths

**1. Elastic global consistency.** The first implicit neural SLAM to support loop-closure-induced map deformation without discarding or retraining the neural representation. This is a structural advance over all prior neural and NeRF SLAMs, which treat the neural field as fixed in global coordinates.

**2. Compact implicit map.** A sparse set of neural points with latent features is significantly smaller than accumulated raw point clouds for the same environment, particularly in areas of repeated coverage. Memory grows only where new geometry is observed, not proportional to total scene volume.

**3. Mesh reconstruction at any resolution.** The SDF is continuous and queryable anywhere. Marching cubes can be run at any desired resolution post-SLAM, producing clean watertight surfaces — useful for simulation mesh generation, inspection, and change detection. Classical LiDAR SLAM produces no mesh without a separate reconstruction step.

**4. No pre-training.** The system learns online from the sensor stream with no domain-shift problem. There is no offline training dataset or foundation model dependency. Compare with NICE-SLAM's coarse/mid decoders pre-trained on ConvONet synthetic data.

**5. Sensor versatility.** LiDAR and RGB-D depth share the same pipeline with minor configuration changes. Most neural SLAM systems hard-code one sensor type.

**6. Voxel hashing for scalability.** Neural point indexing via spatial hashing avoids the memory explosion of dense pre-allocated grids. Large outdoor sequences (KITTI, MulRan) are handled within reasonable GPU memory.

**7. Correspondence-free registration.** Pose estimation via point-to-implicit SDF residuals does not require explicit nearest-neighbor search. This is faster for large maps and more robust to sparse or uneven scan distributions.

**8. PRBonn maintenance and successor work.** The lab continues developing this line (PINGS, ENM-MCL), so the code and methodology are actively maintained and extended.

---

## Failure Modes

**1. GPU dependency.** Frame-rate operation requires a mid-range GPU (RTX 3080 class, minimum 4 GB VRAM). Not deployable on embedded platforms such as NVIDIA Jetson Orin at 10 Hz without significant engineering effort. CPU mode exists but is far too slow for practical use. This rules out the method for real-time on-vehicle deployment in current embedded compute configurations.

**2. Static-scene assumption.** Dynamic objects — vehicles, pedestrians, GSE, pushback tractors, deicing trucks, baggage tugs — are fused into the neural SDF as persistent geometry. This corrupts the map in high-traffic scenes. PIN-SLAM does not include online dynamic-object detection or removal. For aggregated airside maps, [Removert](removert.md), ERASOR2, DUFOMap, or [TRLO](trlo-dynamic-tracking-removal-lidar-odometry.md) must be applied before PIN-SLAM ingests the data.

**3. Thin-structure over-smoothing.** SDF-based representations with MLP decoders tend to over-smooth thin geometry — poles, signs, fence chains, FOD-like objects. The MLP's smoothing bias causes these features to vanish in the reconstructed mesh even if present in the raw point cloud. This is a known limitation of the SDF representation paradigm, not specific to PIN-SLAM.

**4. Loop-closure dependency for global consistency.** Without loops, PIN-SLAM is a neural LiDAR odometry system. In environments with little revisiting — long straight corridors, one-way outdoor traversals — the elastic deformation provides no benefit over simpler systems such as KISS-ICP or FAST-LIO2.

**5. Map integrity opaqueness.** Latent features and MLP weights are not interpretable. Map quality is assessed by reconstructed mesh accuracy, not by reasoning over explicit map features. This makes certification and safety-case argumentation harder than with explicit maps. There is no per-pose covariance output in a form usable for downstream safety reasoning beyond what the LM solver provides internally.

**6. Training instability at high speed or high density.** Online gradient descent can diverge if the motion model provides poor pose initialization, or if scans are extremely dense (128-beam at high speed). The system is sensitive to the local spatial window radius and hash resolution parameters.

**7. Memory growth at large scale.** Neural points accumulate over long sequences. While voxel hashing limits spatial redundancy, long-duration outdoor mapping can still produce hundreds of thousands of neural points. Pruning heuristics help but are not fully characterized for extreme-duration sequences.

**8. No uncertainty quantification.** There is no per-pose or per-map-region uncertainty output usable for downstream safety reasoning. This is a generic limitation of neural SLAM methods at the current research stage.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Offline airside map building (apron, hangar, taxiway) | Good (research) | Elastic loop closure useful for large-area survey; static-scene requirement must be met first via dynamic removal |
| Airside real-time on-vehicle SLAM | Not suitable | GPU dependency; embedded compute not feasible at 10 Hz |
| Road AV (offline map building) | Good (research) | KITTI / MulRan are representative; production deployment needs explicit-map alternative |
| Road AV (online real-time) | Not suitable | Not certifiable; GPU required; no uncertainty output |
| Indoor warehouse / hangar | Conditional | GPU on survey cart; dynamic objects (forklifts, trolleys) must be pre-filtered |
| Port / logistics yard | Conditional | Same caveat as airside; large outdoor area is fine; moving vehicles must be removed |
| Mining / construction | Conditional | Works on static geometry; deformable terrain or moving machinery require pre-filtering |
| Agriculture | Conditional | Static field mapping viable; moving machinery or dynamic vegetation problematic |
| Simulation asset generation | Good | Mesh extraction directly usable; SDF-based surfaces are clean for sim |

---

## Aggregated-Map Suitability for Airside

**Use case: offline high-fidelity airside map building.**

PIN-SLAM is relevant for airside aggregated LiDAR map building in a specific offline role: producing a globally consistent implicit map and extractable mesh from a recorded survey drive of the apron, hangar interior, or taxiway corridor. The elastic deformation after loop closure is particularly useful for large apron surveys where multiple passes create long-range drift — the corrected mesh is more usable for simulation and change detection than a drift-accumulated point cloud.

**The static-scene requirement is non-negotiable.** Dynamic ground-support equipment — pushback tractors, deicing trucks, baggage tugs, fuel bowsers, catering vehicles — will be fused into the neural SDF as persistent static geometry if not removed first. For airside aggregated mapping, dynamic objects must be eliminated via a pre-processing pass before PIN-SLAM ingests the scan sequence. Recommended tools: [TRLO](trlo-dynamic-tracking-removal-lidar-odometry.md) (iter 41), [Removert](removert.md) (iter 40), ERASOR2, or DUFOMap. See [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md) for comparative evaluation of these tools.

**Recommended pipeline for airside aggregated mapping with PIN-SLAM:**

```
Raw LiDAR log (ground survey or handheld)
    |
    v
[Dynamic Object Removal]
 TRLO / ERASOR2 / Removert / DUFOMap
    |
    v
[Temporal Deskewing]
 timestamp-based per-scan deskew (--deskew flag)
    |
    v
[PIN-SLAM] — offline, full sequence, loop closure enabled
    |
    +-----> Neural point map (.ply with features)
    |
    +-----> Surface mesh (marching cubes, e.g. 0.2 m resolution)
    |
    +-----> Globally consistent trajectory
    |
    v
[Map Validation]
 Chamfer distance / F-score vs. independent reference scan
 Thin-structure inspection (poles, stand markings, apron signage)
 Overlay on aeronautical chart for georeferencing
```

**Comparison with alternatives for this use case:**

| Alternative | Competes with PIN-SLAM? | Trade-off |
|---|---|---|
| KISS-ICP + CloudCompare meshing | Simpler, no GPU | No loop closure; manual meshing; not elastic |
| GLIM (GPU LiDAR mapping) | Closest explicit-map competitor | Explicit submaps; faster; no neural SDF compactness |
| 4DNDF (PRBonn, CVPR 24) | Complementary | 4DNDF is a mapping backend — needs poses from PIN-SLAM or FAST-LIO2 as input |
| PINGS (PRBonn, RSS 25) | Direct successor | Adds photo-realistic rendering; same SDF core; prefer if camera data is available |
| LIO-SAM + LOAM | Mature, deployable | No implicit map; separate meshing step required; no elastic deformation |

**Where PIN-SLAM does not fit airside:**

- Online localization for production AV operations — KISS-ICP, FAST-LIO2, or GLIM remain the appropriate choice for real-time LiDAR odometry with mature deployability and no GPU dependency.
- Environments with active dynamic traffic during the mapping drive where pre-filtering cannot remove all movers.
- Airside scenes with heavy glass (terminal facades, jetbridges) — both LiDAR geometry and SDF reconstruction will have artefacts in these regions regardless of the SLAM system.

See [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) for downstream use of such maps.

---

## Implementation Notes

1. Confirm the sensor is a supported spinning LiDAR (Velodyne or Ouster strongly preferred). Solid-state LiDAR requires careful configuration.
2. Apply temporal deskewing before PIN-SLAM using the `--deskew` flag if the spinning LiDAR is mounted on a moving vehicle.
3. Remove dynamic objects from the scan sequence before feeding to PIN-SLAM. Use [TRLO](trlo-dynamic-tracking-removal-lidar-odometry.md) or ERASOR2 as first-choice tools.
4. Use the provided dataset-specific config files as starting points. Key parameters to tune: `v_m` (mapping voxel size), `v_r` (registration voxel size), `v_p` (neural point hash resolution), and the local spatial window radius `r_l`.
5. For mesh quality: smaller marching cubes resolution (e.g. 0.1 m instead of 0.2 m) improves detail at the cost of memory and run time.
6. Evaluate reconstructed mesh against an independent LiDAR reference scan using Chamfer distance and F-score, as done in the paper and in the PINGS comparisons.
7. Store the raw point cloud alongside the neural map for auditability. The neural map alone is not sufficient for a safety-case evidence package.
8. For large sequences (more than 5 km), monitor GPU memory. If VRAM exceeds limits, increase voxel sizes or reduce the neural point hash table size.
9. ROS 1 integration is provided via `pin_slam_ros.py`. For ROS 2 infrastructure, bridge through `ros1_bridge` until native ROS 2 support is added.
10. The evaluation notebooks at `YuePanEdward/PIN_evaluation` (nbviewer link above) are the authoritative source for per-dataset benchmark numbers. Re-run them on custom sequences to obtain site-specific accuracy estimates. Per-sequence ATE numbers from Table I of the paper are paywalled.
11. PINGS extension is available at https://github.com/PRBonn/PINGS. If camera data is available alongside LiDAR, PINGS is the preferred system — the SDF core is identical and the Gaussian component adds appearance at negligible odometry cost.

---

## Sources

- Pan, Y.; Zhong, X.; Wiesmann, L.; Posewsky, T.; Behley, J.; Stachniss, C. "PIN-SLAM: LiDAR SLAM Using a Point-Based Implicit Neural Representation for Achieving Global Map Consistency." IEEE Transactions on Robotics, vol. 40, pp. 4045–4064, 2024. DOI: 10.1109/TRO.2024.3422055. arXiv: 2401.09101.
- Official repository: https://github.com/PRBonn/PIN_SLAM (MIT license; README and eval/ notebooks verified May 2026).
- Evaluation notebooks: https://nbviewer.org/github/YuePanEdward/PIN_evaluation/ — authoritative benchmark numbers per dataset.
- PINGS (successor): Pan et al., "PINGS: Gaussian Splatting Meets Distance Fields within a Point-Based Implicit Neural Map." RSS 2025. arXiv: 2502.05752. https://github.com/PRBonn/PINGS — surface accuracy numbers for Oxford-Spires extracted from HTML arXiv version.
- PRBonn related works confirmed via README: SHINE-Mapping (ICRA 23), LocNDF (RAL 23), KISS-ICP (RAL 23), 4DNDF (CVPR 24), ENM-MCL (ICRA 25), PINGS (RSS 25).
