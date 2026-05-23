# Object-Level SLAM

<!-- method-priority:start
priority:
  learning: 4
  deployment: 3
  type: "method"
  stage: "modern-core"
  maturity: "fielded-pattern"
  tags: ["slam", "fallback", "gnss-denied", "indoor", "validation"]
  reason: "Object-Level SLAM is rated for visual or visual-inertial SLAM coverage, especially fallback and GNSS-denied use."
method-priority:end -->

Related docs: [Semantic SLAM](semantic-slam.md) · [Dynamic-Object-Aware SLAM](dynamic-object-aware-slam.md) · [SD-SLAM — Semantic Dynamic LiDAR](sd-slam-semantic-dynamic-lidar.md) · [LT-Mapper / Khronos Lifelong Mapping](lt-mapper-khronos-lifelong-mapping.md) · [SuMa / SuMa++](suma.md) · [Loop Closure and Place Recognition](loop-closure-place-recognition.md) · [GS-SLAM / MonoGS](gs-slam-monogs.md) · [Splat-SLAM](splat-slam.md) · [Kimera-VIO](kimera-vio.md) · [Kimera-Multi](kimera-multi.md) · [Multi-Agent Neural Gaussian SLAM](multi-agent-neural-gaussian-slam.md) · [ORB-SLAM2/ORB-SLAM3](orb-slam2-orb-slam3.md) · [Factor Graph / iSAM2 / GTSAM](factor-graph-isam2-gtsam.md) · [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md) · [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [3D Segmentation Class Taxonomy Design](../../perception/overview/3d-segmentation-class-taxonomy-design.md) · [Production LiDAR Map Localization](../overview/production-lidar-map-localization.md) · [Semantic Mapping and Learned Priors](../maps/semantic-mapping-learned-priors.md) · [Gaussian Splatting for Driving](../../perception/overview/gaussian-splatting-driving.md)

**Last updated:** 2026-05-24

---

## What It Is

Classical SLAM maps the environment as a collection of geometric primitives — feature points (ORB, SURF), surfels, voxels, or occupancy grids. Every measurement populates a densely sampled geometric structure. **Object-level SLAM** instead asks: what are the objects in the scene, where are they, and what do they look like? Each detected object instance becomes a **node** in the SLAM factor graph, and each detection of that instance becomes a **factor** linking the camera pose node to the object node.

The map is therefore a set of object instances, each carrying:

- A categorical identity (class label)
- A 6-DoF pose in the world frame
- A shape descriptor (cuboid dimensions, quadric matrix, latent code, or Gaussian cluster)
- An optional dynamic state (velocity, presence probability)

Object-level SLAM is also called **object-oriented SLAM** or **object-based SLAM** in the literature. The seminal framing is Salas-Moreno et al. (CVPR 2013); the field has grown continuously through 2024–2026.

---

## Core Technical Idea

Five motivations make the object-level representation attractive relative to point-cloud or voxel maps.

**Semantic understanding.** The map carries categorical identity, not just geometry. Downstream planners can query "all blue trolleys near gate B4" rather than searching raw points. This matters for both task planning and human-readable map QA.

**Object permanence and tracking.** An object persists as a single node across frames even when partially occluded; the pose-graph encodes its continuous identity. Classical SLAM loses this — a partially occluded truck is just a set of points with no identity binding across frames.

**Dynamic-object handling.** Moving objects (vehicles, aircraft, personnel) can be factored out of the static map and tracked simultaneously as separate dynamic nodes. They pollute point-cloud SLAM with spurious geometry unless explicitly handled (see [Dynamic-Object-Aware SLAM](dynamic-object-aware-slam.md)).

**Compact representation.** A scene of 50 objects requires 50 nodes plus their shape parameters, rather than millions of points. This enables loop closure at the object level — re-observing the same object triggers a loop-closure constraint even when low-level features disagree.

**Task-oriented planning.** Object nodes are first-class entities that planners can reason about: park adjacent to aircraft stand X, avoid this specific GSE unit, verify the jetbridge is retracted.

The object-level map also forms the perception input to spatial scene graphs (Section 6), which lift object nodes into hierarchical representations of rooms, buildings, and environments.

---

## Object Representation Taxonomy

Six representation families are in active use, each trading expressiveness for computational cost and robustness.

### Cuboids

Each object is approximated as an axis-aligned or oriented 3D bounding box with 9 DoF: position (3), orientation (3 Euler angles), and half-extents (3). The cuboid is intuitive, directly constrainable from 2D bounding boxes and vanishing points, and supports efficient collision checks.

**CubeSLAM** (Yang & Scherer, TRO 2019) is the primary cuboid object SLAM. It uses single-image 3D cuboid detection by sampling vanishing points and scoring proposals against image edge alignment, then integrates the detected cuboids as landmarks in a monocular bundle adjustment. The tight coupling of camera-pose, point-landmark, and cuboid-landmark nodes in one BA graph allows the cuboids to provide long-range metric scale constraints — critical for monocular systems which otherwise accumulate scale drift.

The cuboid reprojection residual projects the 8 box corners to image coordinates and measures distance from projected corners to the observed 2D bounding box edges:

```
For cuboid with pose T_obj, dimensions (w, h, l):
corners_3d = cuboid_corners(T_obj, w, h, l)   [8x3]
corners_2d = project(K, corners_3d)            [8x2]
r_cuboid   = dist(corners_2d, observed_box_edges)
```

Additional vanishing-point consistency residuals can be added to exploit the Manhattan-world structure of many man-made environments.

- Paper: https://arxiv.org/pdf/1806.00557
- Code: https://github.com/shichaoy/cube_slam

### Dual Quadrics (Ellipsoids)

A **dual quadric** Q* is a symmetric 4×4 positive-semidefinite matrix that encodes an ellipsoidal surface. The primal quadric Q satisfies `x^T Q x = 0` for surface points x in homogeneous coordinates; the dual Q* = Q^{-1} (or adjugate Q) satisfies `pi^T Q* pi = 0` for tangent planes pi.

A constrained dual quadric has 9 DoF: 3 for 3D centroid, 3 for orientation (eigenvectors of Q*), and 3 for semi-axis lengths a, b, c. The ellipsoidal shape is a reasonable approximation for many man-made objects (vehicles, barrels, tanks) and provides a natural uncertainty bound.

Under a camera P (3×4 projection matrix), a 3D dual quadric Q* projects to a 2D dual conic C* in image space:

```
C* = P · Q* · P^T          (3x3 dual conic)
```

A detected 2D bounding box is represented as four lines l_i (in homogeneous line form); each tangent line satisfies `l^T C* l = 0`. The residual for the QuadricSLAM factor is:

```
r_k = l_k^T · C*_{tj} · l_k     k = 1..4   (scalar, should be ≈ 0 for tangent line)
```

Four bounding-box lines give four scalar residuals. The Jacobians with respect to Q* and P are derived analytically for use in Gauss-Newton optimization inside GTSAM.

**QuadricSLAM** (Nicholson, Milford & Sünderhauf, RA-L 2019) is the standard formulation. It handles partial visibility by suppressing residuals from lines not actually tangent (edge cases where the bounding box extends beyond the image border). An orientation factor (arXiv:1809.06977) breaks the rotational degeneracy of pure bounding-box constraints.

**DQO-MAP** (Li et al., arXiv 2503.02223, 2025) is a recent system that uses dual quadrics for object pose estimation and 3D Gaussians for photometric reconstruction — a hybrid that gets precise pose from the quadric factor and high-fidelity appearance from the Gaussian splats, with real-time performance.

- Paper: https://arxiv.org/abs/1804.04011
- Code: https://github.com/qcr/quadricslam
- DQO-MAP: https://github.com/LiHaoy-ux/DQO-MAP

### DeepSDF / Implicit Shape Priors (DSP-SLAM, NeuSE)

**DeepSDF** (Park et al., CVPR 2019) learns a category-specific decoder `f_theta(z, x) -> SDF value`, where z is a low-dimensional (32–64D) latent code and x is a 3D query point. At test time, given partial observations, the latent code z is optimized to match observations while decoder weights stay frozen. This yields a **prior-constrained shape**: the recovered object must lie on the learned shape manifold.

**DSP-SLAM** (Wang, Rünz & Agapito, 3DV 2021) integrates DeepSDF into an ORB-SLAM2 backbone. Instance segmentation (Mask R-CNN) identifies object regions; a 3D point cloud segment from stereo/LiDAR is used to optimize z via a rendering loss. The object-aware bundle adjustment has camera pose nodes (SE3), sparse point-landmark nodes, and object nodes (6-DoF pose + latent code z in R^64). The object factor residual is:

```
r_i = f_theta(z_j, T_j^{-1} * x_i) - 0
```

where f_theta is the frozen decoder. The residual is the predicted SDF value (should be ≈ 0 at observed surface points). DSP-SLAM runs at 10 FPS on stereo or stereo+LiDAR.

**NF-SLAM** (arXiv 2503.11199, 2025) replaces the DeepSDF latent space with a normalizing flow network, reducing the latent code to 16D while improving shape diversity coverage, targeting automotive car instances.

- DSP-SLAM paper: https://arxiv.org/abs/2108.09481
- DSP-SLAM code: https://github.com/JingwenWang95/DSP-SLAM
- NF-SLAM: https://arxiv.org/abs/2503.11199

### Per-Object MLPs (vMAP, FroDO)

**vMAP** (Kong, Liu, Taher & Davison, CVPR 2023) represents each object instance as a **separate small MLP** encoding a truncated SDF or occupancy field. As an RGB-D camera browses the scene, instance segmentation detects new objects and each gets its own randomly initialized MLP. All object MLPs are **trained in parallel via vectorized PyTorch operations** — effectively a batched MLP where the batch dimension indexes objects. Key result: up to 50 simultaneous objects at 5 Hz map update on a single GPU. No category prior is required.

**FroDO** (Runz et al., CVPR 2020) is an earlier approach combining Mask R-CNN detections with DeepSDF-encoded shape priors and an encoder-decoder architecture for per-object 3D reconstruction from monocular video, recovering a latent code z by optimizing against 2D detections across frames.

- vMAP paper: https://arxiv.org/abs/2302.01838
- vMAP code: https://github.com/kxhit/vMAP

### Mesh / Per-Object SDF Volumes

**Fusion++** (McCormac et al., 3DV 2018) and **NodeSLAM** combine per-object truncated SDF volumes with pose-graph SLAM. Each object is represented as a small TSDF volume; ICP-style matching between frames and per-object volumes provides the measurement residual. **MaskFusion** and **MID-Fusion** handle multiple moving objects with RGB-D data, maintaining a separate TSDF volume and 6-DoF pose node per tracked instance.

Strengths: dense object reconstruction; precise at short range. Limitations: RGB-D sensor range, high compute for many simultaneous objects, and data-association fragility when object TSDF volumes overlap.

### Per-Object Gaussian Splat Clusters

**OpenGS-SLAM** (ICRA 2025, arXiv 2503.01646) is a dense semantic SLAM that assigns semantic labels to individual Gaussians via 2D foundation models (SAM/CLIP), then groups Gaussians by instance. **Gaussian Voting Splatting** renders a 2D label map at 5–7 FPS (RTX 4090). This produces per-object Gaussian clusters without explicit per-object optimization loops.

**DQO-MAP** uses per-object Gaussian clusters for appearance reconstruction after quadric-based pose estimation. The two-stage approach sidesteps the chicken-and-egg of Gaussian initialization: the quadric gives a coarse object frame, then Gaussians are seeded within it.

For context on Gaussian-based scene representations see [GS-SLAM / MonoGS](gs-slam-monogs.md) and [Splat-SLAM](splat-slam.md).

- OpenGS-SLAM code: https://github.com/YOUNG-bit/open_semantic_slam

---

## Foundational Methods

### SLAM++ (Salas-Moreno et al., CVPR 2013)

The seminal paper. Uses a hand-held RGB-D camera in environments where known object models exist (CAD models from a database). As the camera moves: (1) a real-time 3D object recognizer identifies known objects in the depth map; (2) recognized objects yield 6-DoF camera-to-object constraints; (3) these constraints feed a **pose-graph of object nodes** that is continuously optimized; (4) ICP tracking against predicted object surfaces improves frame-to-frame camera tracking.

Core insight: once you know which object you are looking at, the object's 3D model gives far richer geometric constraints than any set of feature points. The result is a compact, object-centric map that supports predictions of occluded regions.

**Limitation:** requires a database of known 3D object models — a strong assumption that fails for open-world or novel-category objects. This motivated all subsequent work on learned shape priors and category-level parameterizations.

- Paper: https://openaccess.thecvf.com/content_cvpr_2013/html/Salas-Moreno_SLAM_Simultaneous_Localisation_2013_CVPR_paper.html

### CubeSLAM (Yang & Scherer, TRO 2019)

Single-camera object SLAM based on 3D cuboid detection. Two tightly coupled components: (1) single-image cuboid detection by sampling vanishing points, generating cuboid proposals, and scoring against image edge alignment; (2) multi-view bundle adjustment simultaneously optimizing camera poses T_c, point landmarks x_p, and cuboid landmarks (pose T_obj + dimensions w, h, l) using an ORB-SLAM2-style backend.

Cuboid factors improve scale in monocular SLAM because the object size provides a metric constraint. Dynamic objects are handled via a motion model: if a cuboid moves between frames, its motion is parameterized and tracks are estimated jointly.

- Paper: https://arxiv.org/abs/1806.00557
- Code: https://github.com/shichaoy/cube_slam

### QuadricSLAM (Nicholson, Milford & Sünderhauf, RA-L 2019)

The standard quadric object SLAM (full math in the Object Representation Taxonomy section above). Key contributions: derives the full Jacobian of the bounding-box residual with respect to both camera pose P and quadric parameters Q* for gradient-based factor graph optimization in GTSAM; shows that 10 DoF of the symmetric 4×4 matrix collapse to 9 DoF when sign ambiguity is removed and the positive-definite condition enforced; handles partial visibility at image borders; achieves accurate object landmark estimation and camera localization on room-scale RGB sequences.

- Paper: https://arxiv.org/abs/1804.04011
- Code: https://github.com/qcr/quadricslam

### OrcVIO (Shan, Feng & Atanasov, IROS 2020 / T-RO)

**Object Residual Constrained Visual-Inertial Odometry** tightly couples object semantics with IMU preintegration factors. The state vector includes camera/IMU state, sparse point-feature state, and per-object state (6-DoF pose + shape parameters as structured ellipsoid or cuboid). Object factors include a bounding-box reprojection residual (predicted object silhouette vs. detected box) and a semantic keypoint residual (object-specific keypoints back-projected into the image). OrcVIO demonstrates accurate trajectory estimation and object-level mapping from monocular+IMU data alone; metric scale is provided by IMU gravity.

OrcVIO-Lite (lighter variant) uses only bounding boxes without semantic keypoints.

- Paper: https://arxiv.org/abs/2007.15107
- Code: https://github.com/shanmo/OrcVIO-Lite

---

## Object-Level Dynamic Handling

The standard approach in most SLAM systems is to discard dynamic-object measurements as outliers (e.g., ORB-SLAM masks moving features). Object-level SLAM instead **assigns dynamic objects their own state nodes** and estimates their trajectories simultaneously with ego pose.

### DynaSLAM (Bescos et al., RA-L + IROS 2018)

Uses Mask R-CNN to segment "a priori dynamic" categories (people, cars, bikes) and removes those pixels before ORB-SLAM feature tracking. Result: a static, reusable map. Inpaints masked regions for visualization. This is not true object-level SLAM — objects are discarded not modeled — but it is the base-class approach that motivated dynamic object tracking.

- Code: https://github.com/BertaBescos/DynaSLAM

### VDO-SLAM (Zhang, Henein, Mahony & Ila, arXiv 2020)

The most complete visual dynamic object-aware SLAM. Does not require prior knowledge of object shape or geometry. Tracks both static structure and dynamic objects simultaneously:

- **Static map**: ORB-style feature map for background.
- **Dynamic object nodes**: each tracked rigid-body cluster has a full SE(3) state node per time step. Between consecutive frames, an SE(3) motion factor constrains the object trajectory.
- **Output**: camera trajectory + per-object SE(3) trajectory (full 6-DoF motion).
- **Linear velocity estimates** are derived from the estimated SE(3) motions — directly useful for collision prediction in AV planning.

Evaluated on TUM RGB-D and KITTI; substantially outperforms dynamic-blind SLAM on ATE.

- Paper: https://arxiv.org/abs/2005.11052
- Code: https://github.com/halajun/vdo_slam

### ClusterVO (Huang et al., CVPR 2020)

Stereo visual odometry that jointly clusters moving rigid bodies and estimates their 6-DoF motions. Uses a multi-level probabilistic association with a heterogeneous CRF combining semantic, spatial, and motion cues to infer cluster segmentations online. Sliding-window optimization solves camera and object poses simultaneously.

Key differentiator: does not require semantic object categories — clusters are defined by rigid-body motion consistency, making it robust to novel object types.

- Paper: https://arxiv.org/abs/2003.12980

### DS-SLAM and Related

DS-SLAM combines ORB-SLAM2 with a semantic segmentation thread and an edge-based moving consistency check. Moving-object pixels are excluded from the bundle adjustment. Less sophisticated than VDO-SLAM but runs in real time. For a fuller treatment of the dynamic-object filtering family see [Dynamic-Object-Aware SLAM](dynamic-object-aware-slam.md) and [SD-SLAM — Semantic Dynamic LiDAR](sd-slam-semantic-dynamic-lidar.md).

---

## Object-Level Scene Graphs

Object-level SLAM is the perception primitive that feeds spatial scene-graph construction. The scene graph lifts the object-node map into a **hierarchical graph** of semantic entities. The MIT-SPARK group at Carlone Lab has developed the primary open-source lineage: Kimera → Hydra → Khronos.

### Kimera (Rosinol, Abate, Chang & Carlone, ICRA 2020 / IJRR 2021)

Kimera is a modular metric-semantic SLAM library combining [Kimera-VIO](kimera-vio.md) (visual-inertial odometry with GTSAM pose-graph), Kimera-Mesher (dense 3D metric-semantic mesh from the VIO trajectory), Kimera-RPGO (robust pose-graph optimization with Pairwise Consistent Measurement Sets), and a **3D Dynamic Scene Graph (DSG)**. The DSG is a hierarchical graph with layers for metric-semantic mesh, objects, places, rooms, and buildings.

Object nodes in the DSG represent detected 3D instances (bounding boxes / segmented regions); place nodes represent navigable areas. Edges encode spatial relationships (object-in-room, object-near-place). The scene graph enables semantic queries for planning. See also [Kimera-Multi](kimera-multi.md) for the multi-robot extension.

- GitHub: https://github.com/MIT-SPARK/Kimera

### Hydra (Hughes, Chang & Carlone, RSS 2022)

Hydra builds and optimizes a 3D scene graph online in real time. Architecture layers: (1) Places (volumetric free-space nodes derived from ESDF); (2) Objects (instance-segmented mesh clusters); (3) Rooms (detected from room-scale topology); (4) Buildings. Object nodes are created from 3D instance segmentations on the dense mesh. When a new loop closure is detected, all nodes in the graph are re-optimized. The scene-graph layer adds approximately 10 ms overhead to the underlying VIO backbone.

- Paper: https://arxiv.org/abs/2201.13360

### Khronos (Schmid et al., RSS 2024 — Outstanding Systems Paper Award)

Khronos extends the scene-graph to **4D spatio-temporal**: it simultaneously handles short-term dynamics (moving objects tracked frame-to-frame) and long-term changes (objects that appear, disappear, or relocate between sessions). Key factorization:

- **Fast process**: active temporal window tracks short-term dynamics (moving people, vehicles) as transient object nodes with SE(3) motion factors.
- **Slow process**: factor-graph reasoning over long-term changes, comparing current observations with the persistent world model to detect object additions/removals.

Runs at 22 FPS on a laptop CPU (Intel i7-12700H). Demonstrated on building-floor-scale environments with furniture rearrangement, object appearance/disappearance, and human motion. Khronos is directly relevant to airside apron monitoring; for further discussion see [LT-Mapper / Khronos Lifelong Mapping](lt-mapper-khronos-lifelong-mapping.md).

- Paper: https://arxiv.org/abs/2402.13817
- Code: https://github.com/MIT-SPARK/Khronos

---

## Recent Learned Object SLAM (2020–2026)

### FroDO (Runz et al., CVPR 2020)

**From Detections to 3D Objects.** Combines Mask R-CNN detections with DeepSDF-encoded shape priors and an encoder-decoder architecture for per-object 3D reconstruction from monocular video. An early proof-of-concept for learned priors in the SLAM pipeline, preceding DSP-SLAM.

### DSP-SLAM (Wang, Rünz & Agapito, 3DV 2021)

State-of-the-art for prior-constrained object SLAM as of 2021–2023. Operates at 10 FPS; monocular/stereo/stereo+LiDAR. Shape is a 64D DeepSDF latent code per object. See Object Representation Taxonomy — DeepSDF section for full technical details.

- Code: https://github.com/JingwenWang95/DSP-SLAM

### vMAP (Kong et al., CVPR 2023)

No shape prior required; each object is a small MLP trained from scratch per instance. 50 objects at 5 Hz. The vectorized training trick (batching all object MLPs together) is the key engineering insight.

- Code: https://github.com/kxhit/vMAP

### NeuSE (Fu, Du, Singh, Tenenbaum & Leonard, RSS 2023 / IJRR 2026)

Learns **SE(3)-equivariant** object embeddings from partial point-cloud observations. The embedding satisfies: if the object moves by T, the embedding transforms predictably by the same T. This means relative camera-object transforms can be inferred directly from embedding comparisons without explicit pose optimization — generating loop-closure constraints compatible with standard GTSAM pose-graph optimization.

Evaluated on sequences with changed objects (objects moved between sessions); shows improved localization with a compact object-centric map.

- Paper: https://arxiv.org/abs/2303.07308
- Project: https://neuse-slam.github.io/neuse/

### ObVi-SLAM (Long-Term Object-Visual SLAM, RA-L 2024)

Addresses multi-session, long-term deployment across different weather/lighting conditions. Uses low-level visual features for short-term frame-to-frame odometry and a separate **persistent object map** (bounding-box landmarks) for global consistency. After each deployment session, the object map is updated: objects that have moved or disappeared are revised; new objects are inserted.

Evaluated on 16 sessions with varying appearance. Especially relevant to outdoor long-term deployments (airside, outdoor yard environments).

- Paper: https://arxiv.org/abs/2309.15268
- Code: https://github.com/ut-amrl/ObVi-SLAM

### DQO-MAP (Li et al., arXiv 2503.02223, 2025)

Dual quadrics for pose estimation combined with 3D Gaussians for photometric reconstruction. Real-time object-level mapping. See Object Representation Taxonomy for full details.

- Code: https://github.com/LiHaoy-ux/DQO-MAP

### OpenGS-SLAM (ICRA 2025, arXiv 2503.01646)

Open-set semantic Gaussian-splatting SLAM with per-object labeling via SAM/CLIP. Gaussian Voting Splatting at 5–7 FPS (RTX 4090).

- Code: https://github.com/YOUNG-bit/open_semantic_slam

### NF-SLAM (arXiv 2503.11199, 2025)

Normalizing-flow shape priors (16D latent) in object SLAM for automotive car instances. Smaller latent code than DSP-SLAM; better coverage of the shape manifold.

- Paper: https://arxiv.org/abs/2503.11199

---

## LiDAR Considerations

Object-level SLAM is predominantly developed for RGB-D or RGB cameras. LiDAR-based object-level SLAM is less common because LiDAR is sparse at distance — a distant vehicle may produce only tens of points, insufficient for shape reconstruction — and LiDAR object-level systems tend to use instance segmentation as a preprocessing step and then represent clusters with simple primitives.

### SuMa++ (Chen et al., IROS 2019)

SuMa++ extends the Surfel-based Mapping (SuMa) pipeline with semantic segmentation from RangeNet++. Each surfel in the map carries a semantic label. Dynamic objects (segmented as "moving" classes) are filtered from the map to prevent ghost surfels. This is **semantic-class-level, not instance-level**, but it is the closest LiDAR predecessor to instance-aware object SLAM. SuMa++ improves scan matching accuracy by using semantic constraints (matching surfels of the same class) in addition to geometric ICP. See [SuMa / SuMa++](suma.md) for full details.

- Paper: https://arxiv.org/abs/2105.11320
- Code: https://github.com/PRBonn/semantic_suma

### LiSTA (Oxford, arXiv 2403.02175, 2024)

**LiDAR Spatio-Temporal Analysis** for geometric object-based change detection in cluttered environments. Uses multi-mission LiDAR SLAM (LIO/NDT backbone), volumetric differencing between missions, object-instance description via learned descriptors, and correspondence grouping to detect which objects have been added, removed, or relocated. Tested on a quadruped robot monitoring an industrial facility.

Directly relevant to the **airside static-but-transient** sub-problem (see [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md)): each survey mission builds an object-level diff against the prior map. LiSTA is LiDAR-native and operates on an open set of objects (no category priors required — only geometric change signals).

- Paper: https://arxiv.org/abs/2403.02175

### InsMOS / 3D Moving Object Segmentation

**InsMOS** (arXiv 2303.03909) performs instance-aware moving object segmentation in LiDAR data, predicting which specific instances (not just points) are moving. Output feeds into LiDAR SLAM to remove dynamic objects from the static map — the LiDAR equivalent of DynaSLAM's masking step.

### Note on Pure LiDAR Object SLAM

As of 2025, no published system provides full object-level pose + shape optimization purely from LiDAR with the sophistication of QuadricSLAM or DSP-SLAM from camera. The standard LiDAR-SLAM approach for dynamic objects remains moving-object segmentation (MOS) + static-map building + object tracking as a separate 3D MOT pipeline. DSP-SLAM's stereo+LiDAR mode is currently the most principled LiDAR-integrated object SLAM, though it operates on a camera-primary pipeline with LiDAR as a range enhancer.

---

## Factor Graph Mathematics

### Factor Graph Structure

Object-level SLAM adds two node types to the standard pose-graph:

```
Standard nodes:  x_1, x_2, ..., x_T   (camera/robot SE3 poses)
Object nodes:    o_1, o_2, ..., o_M   (object state: pose + shape)
```

Factor types:

- **Odometry factor**: between consecutive camera poses (from wheel encoder / IMU / visual odometry)
- **Point-landmark factor**: between camera pose x_t and point landmark p_i (standard reprojection error)
- **Object factor**: between camera pose x_t and object o_j — encodes residual between predicted object appearance/geometry and actual detection at time t

The total cost function minimized by GTSAM / g2o is:

```
F(x, o) = sum_t  ||f_odom(x_t, x_{t+1})||^2_Sigma_odom
         + sum_{t,i} ||f_point(x_t, p_i) - z_{ti}||^2_Sigma_pt
         + sum_{t,j} ||f_obj(x_t, o_j) - z^obj_{tj}||^2_Sigma_obj
```

where Sigma_* are the covariance matrices of each factor type.

### Quadric Factor (QuadricSLAM)

Given camera pose x_t as projection matrix P_t and dual quadric Q*_j:

```
C*_{tj} = P_t · Q*_j · P_t^T          (3x3 dual conic)

Bounding-box lines l_1..l_4 (homogeneous line form):
r_k = l_k^T · C*_{tj} · l_k           k = 1..4

Residual vector: r = [r_1, r_2, r_3, r_4]^T  in R^4
```

The Jacobian d_r / d_[P, Q*] is computed analytically via the chain rule. Implementation uses GTSAM with a custom QuadricSLAM factor type. The symmetric 4×4 Q* is stored as a 10-vector (upper triangle).

### DeepSDF Object Factor (DSP-SLAM)

Object state: T_j in SE(3) (object-world pose) + z_j in R^64 (shape latent code). For an observed 3D point x_i assigned to object j (transformed to object frame as p_i = T_j^{-1} * x_i):

```
r_i = f_theta(z_j, p_i) - 0
```

where f_theta is the frozen DeepSDF decoder. The residual is the predicted SDF value (should be ≈ 0 at observed surface points). Optimized jointly with camera pose via second-order (Gauss-Newton) in the ORB-SLAM2 bundle adjustment.

### Cuboid Corner Reprojection Residual (CubeSLAM)

Object pose T_j in SE(3), dimensions (w, h, l). The 8 corners of the cuboid project to the image; residual is the distance from projected corners to the observed 2D bounding box edges:

```
corners_world = T_j * cuboid_corners(w, h, l)    [8x3]
corners_image = K * [R|t] * corners_world          [8x2]
r_cuboid      = sum_k dist(corners_image[k], bbox_edge_k)
```

Additional vanishing-point consistency residuals can be added for Manhattan-world environments.

---

## Benchmarks and Evaluation

### KITTI Tracking Dataset

Twelve outdoor sequences with annotated 3D bounding boxes for cars, pedestrians, cyclists. Ground-truth 3D box poses allow evaluation of:

- **Ego ATE** (Absolute Trajectory Error) — after aligning to GPS ground truth
- **Object trajectory ATE** — RMSE of estimated 3D box center position vs. ground truth, matched by 3D bounding-box IoU (threshold 25% overlap) across frames
- **CLEAR MOT metrics** — MOTA (Multiple Object Tracking Accuracy), MOTP (Precision), ID switches

Used by: VDO-SLAM, ClusterVO, OrcVIO.

### TUM RGB-D

Indoor sequences with annotated camera trajectories (no 3D object ground truth). Used primarily for ego-pose evaluation. DynaSLAM and vMAP evaluate on TUM fr3/walking sequences.

### Custom Indoor Object-Rich Scenes

vMAP uses the Replica dataset (photo-realistic indoor rooms); DSP-SLAM uses ShapeNet-based synthetic sequences plus KITTI for outdoor. No single standard benchmark covers all aspects of object-level SLAM.

### Long-Term / Multi-Session Datasets

ObVi-SLAM's 16-session outdoor dataset (UT campus) is the only published long-term object SLAM benchmark with appearance variation. POV-SLAM uses a 4-month warehouse dataset.

### Metrics Summary

| Metric | Measures | Typical Tool |
|---|---|---|
| ATE (ego) | Camera/robot trajectory accuracy | TUM evaluation scripts |
| Object ATE | Mean object centroid RMSE | Custom, per-paper |
| Object shape RMSE | Chamfer distance from GT mesh | DSP-SLAM, vMAP |
| MOTA / MOTP | Multi-object tracking accuracy/precision | MOTChallenge |
| ID switches | Track identity consistency | MOTChallenge |
| Loop closure recall | Re-identifying known objects | ObVi-SLAM |

---

## Strengths

- **Semantic compactness**: entire object encoded as a single node; the map is orders-of-magnitude smaller than a point-cloud map for the same scene.
- **Dynamic-object unification**: moving objects are first-class citizens in the same factor graph as ego pose — no need for a separate MOT pipeline.
- **Loop closure at the object level**: recognizing the same object in a new session closes a loop even when low-level features change (lighting, weather, season).
- **Task-oriented planning interface**: planners can query object nodes directly (e.g., "is GSE unit #47 currently at stand B3?").
- **Semi-static handling**: when objects persist with high certainty but occasionally relocate, object-level nodes handle this naturally (update the node pose rather than corrupting the point map).

---

## Failure Modes

- **Unknown / uncategorized objects**: methods requiring shape priors (DSP-SLAM, OrcVIO) fail on objects outside the training category set. vMAP sidesteps this but requires sufficient texture.
- **Sparse objects at distance**: at 100 m+ LiDAR range, a vehicle may return 5–20 points — too few to constrain a quadric or DeepSDF code robustly.
- **Occlusion**: deeply occluded objects accumulate high pose uncertainty. The quadric/cuboid remains in the map but its shape estimate may degenerate without sufficient multi-view coverage.
- **Data association ambiguity**: two objects of the same category (two identical blue ground-power units) are hard to distinguish by appearance alone; incorrect association corrupts both nodes. Multi-hypothesis tracking and IoU-based gating help.
- **Initialization degeneracy**: quadric initialization from a single bounding box is degenerate; at least 3 views are needed for robust initialization.
- **Deformable / articulated objects**: object-level SLAM assumes rigid objects. Aircraft with moving control surfaces, or forklifts with raised/lowered forks, violate rigidity; multi-part articulated object SLAM is an open research problem.
- **Scale ambiguity in monocular**: cuboid and quadric SLAM constrain shape size but monocular cameras have scale ambiguity; metric scale requires IMU (OrcVIO) or known object sizes.
- **Computational cost of neural priors**: DeepSDF optimization at test time (DSP-SLAM) runs at 10 FPS only with GPU; vMAP's 5 Hz is borderline for real-time AV operation. Quadric SLAM is fast (CPU-only GTSAM).
- **Detector false positives**: create phantom landmarks that corrupt the pose-graph if robustness gating is absent.

---

## Domain Fit

| Domain | Object-Level SLAM Fit | Notes |
|---|---|---|
| Road AV | Moderate | Cars/pedestrians as dynamic nodes; infrastructure sparse |
| Warehouse / logistics | High | Known GSE classes; static-but-transient pallet racks |
| Airside apron | High | Aircraft + GSE as object nodes; multi-session presence tracking |
| Ports | High | Container stacks, cranes, vehicles; large semi-static objects |
| Indoor (office/retail) | High | Origin domain; chairs/tables/shelves well studied |
| Mining / construction | Moderate | Novel object categories; occlusion and dust |
| Agriculture | Low–Moderate | Few compact rigid objects; terrain-dominated scenes |
| Delivery robots | Moderate | Furniture / door / person in structured indoor/outdoor |

---

## Airside Bridge

### What Object-Level SLAM Gives the Map Builder

When the goal is building a persistent, task-usable map of an airside environment (gates, stands, taxiways, GSE fleet, personnel zones), object-level SLAM produces:

1. **A semantic, instance-aware map** — each parked GPU (ground power unit), pushback tug, baggage loader, or aircraft stand is a named, localized object node. The map is queryable by category, identity, and position: "park at the green truck."
2. **Explicit handling of the static-but-transient sub-problem** (see [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md)) — GSE that is present during one mapping session and absent in the next is modeled as an object node with a presence probability. Multi-session systems (ObVi-SLAM, LiSTA, Khronos) provide exactly this: they track which object nodes are "active" vs. "removed" across survey missions.
3. **No static-map contamination** — VDO-SLAM / DynaSLAM-style approaches prevent moving aircraft and ground vehicles from leaving ghost geometry in the static infrastructure map.
4. **Loop closure reliability** — re-entering a gate area and recognizing the same jetbridge or fixed bollard as an object node triggers a map-consistent loop closure even if visual appearance has changed (different lighting, different time of day).

The object taxonomy required for airside differs substantially from indoor or road-AV training sets. A custom class taxonomy covering aircraft, jetbridges, pushback tugs, belt loaders, fuel bowsers, baggage carts, chocks, and cones is needed; see [3D Segmentation Class Taxonomy Design](../../perception/overview/3d-segmentation-class-taxonomy-design.md) and [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) for how that taxonomy integrates with the LiDAR pipeline.

### The Static-but-Transient Pattern (GSE as Object Nodes)

Each parked GSE unit can be modeled as:

```
Object node o_k: {category: "GPU", serial: #47, pose: T_k in SE(3), presence: p_k in [0,1]}
```

Between mapping surveys, p_k decays toward 0. Observing the object resets p_k to 1 and updates T_k. This is exactly the **probabilistic semi-static object map** pattern from POV-SLAM (warehouse, 4 months) and ObVi-SLAM (campus, 16 sessions). The pattern transfers directly to airside apron environments.

Aircraft at stands are a special case: known shape (CAD model available from manufacturer data) plus known parking envelope means SLAM++-style ICP-based tracking could support high-precision stand-relative pose hypotheses when CAD model, surveyed stand frame, sensor calibration, and independent scan-to-map validation exist. Do not treat that as production localization evidence without target-domain validation.

### Recommended System Stack for Airside Object-Level Mapping

**Near term (proven):**

- LiDAR moving-object segmentation (InsMOS or ERASOR++) to produce a clean static map, then standard LIO (KISS-ICP / LIO-SAM) for ego-pose
- Separately: 3D MOT (CenterPoint + Kalman filter) for dynamic objects during mapping session
- Object-level annotation: run DSP-SLAM or QuadricSLAM on camera data to assign semantic object nodes to known GSE categories; fuse with LiDAR map via known camera-LiDAR extrinsics

**Emerging (2024–2026):**

- LiSTA-style multi-mission LiDAR change detection to track GSE node presence/absence across surveys
- Khronos-style spatio-temporal scene graph for simultaneous short-term dynamics and long-term changes; see [LT-Mapper / Khronos Lifelong Mapping](lt-mapper-khronos-lifelong-mapping.md)
- DQO-MAP hybrid (quadric pose + Gaussian appearance) for photo-realistic object-level maps navigable in simulation

The [Multi-Agent Neural Gaussian SLAM](multi-agent-neural-gaussian-slam.md) work (iter 31) is a complementary direction for multi-robot collaborative object-level mapping of large apron environments.

---

## Implementation Notes

Two integration patterns are common in production:

```
Pattern A — Objects as landmarks:
  Object observations constrain camera pose and map simultaneously.
  Risk: detector failure becomes localization failure.

Pattern B — Objects as map products:
  Camera pose comes from normal metric SLAM; objects are extracted afterward.
  Safer for production; object layer is degradation-tolerant.
```

Pattern B is recommended for safety-critical deployments. The object factor should be robustly gated: a wrong object association is equivalent to a false loop closure and can pull the trajectory into a plausible but wrong configuration.

For production pose in AV and airside systems, the object-level constraints should be secondary factors or map QA outputs, not the highest-trust pose source. The primary pose backbone should remain validated scan-to-map LiDAR localization as described in [Production LiDAR Map Localization](../overview/production-lidar-map-localization.md).

Airside deployment should distinguish object categories by persistence:

| Category | Persistence class | Map treatment |
|---|---|---|
| Poles, blast fences, terminal walls | Permanent | Static HD-map landmarks |
| Jetbridges, fixed stand equipment | Semi-permanent | Update on structural changes only |
| ULD racks, barriers in maintained zones | Semi-persistent | Object node with slow decay |
| Aircraft, pushback tugs, fuel trucks | Operational dynamic | Dynamic node; never static landmark |
| Chocks, cones, FOD items | Small transient | Detect-and-log; no persistent node |

---

## Sources

| System | Venue | URL |
|---|---|---|
| SLAM++ | CVPR 2013 | https://openaccess.thecvf.com/content_cvpr_2013/html/Salas-Moreno_SLAM_Simultaneous_Localisation_2013_CVPR_paper.html |
| CubeSLAM | TRO 2019 | https://arxiv.org/abs/1806.00557 |
| QuadricSLAM | RA-L 2019 | https://arxiv.org/abs/1804.04011 |
| OrcVIO | IROS 2020 | https://arxiv.org/abs/2007.15107 |
| DynaSLAM | RA-L 2018 | https://github.com/BertaBescos/DynaSLAM |
| VDO-SLAM | arXiv 2020 | https://arxiv.org/abs/2005.11052 |
| ClusterVO | CVPR 2020 | https://arxiv.org/abs/2003.12980 |
| FroDO | CVPR 2020 | (ResearchGate / conference proceedings) |
| DSP-SLAM | 3DV 2021 | https://arxiv.org/abs/2108.09481 |
| vMAP | CVPR 2023 | https://arxiv.org/abs/2302.01838 |
| NeuSE | RSS 2023 | https://arxiv.org/abs/2303.07308 |
| ObVi-SLAM | RA-L 2024 | https://arxiv.org/abs/2309.15268 |
| Kimera | ICRA 2020 / IJRR 2021 | https://github.com/MIT-SPARK/Kimera |
| Hydra | RSS 2022 | https://arxiv.org/abs/2201.13360 |
| Khronos | RSS 2024 | https://arxiv.org/abs/2402.13817 |
| SuMa++ | IROS 2019 | https://arxiv.org/abs/2105.11320 |
| LiSTA | arXiv 2024 | https://arxiv.org/abs/2403.02175 |
| POV-SLAM | arXiv 2023 | https://arxiv.org/abs/2307.00488 |
| DQO-MAP | arXiv 2025 | https://arxiv.org/abs/2503.02223 |
| OpenGS-SLAM | ICRA 2025 | https://arxiv.org/abs/2503.01646 |
| NF-SLAM | arXiv 2025 | https://arxiv.org/abs/2503.11199 |
| InsMOS | arXiv 2023 | https://arxiv.org/abs/2303.03909 |
| Fusion++ | 3DV 2018 | https://arxiv.org/abs/1808.08378 |
| MID-Fusion | ICRA 2019 | https://arxiv.org/abs/1812.07976 |

**Community lists:**
- Awesome Dynamic SLAM: https://github.com/zhuhu00/Awesome_Dynamic_SLAM
- Awesome NeRF+3DGS SLAM: https://github.com/3D-Vision-World/awesome-NeRF-and-3DGS-SLAM
- SemanticSLAM.ai (Niko Sünderhauf, QUT): https://nikosuenderhauf.github.io/semanticslam.ai/quadricslam.html
