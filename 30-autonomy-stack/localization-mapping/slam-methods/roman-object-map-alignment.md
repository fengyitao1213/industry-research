# ROMAN: Open-Set Object Map Alignment for Robust View-Invariant Global Localization

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["slam", "mapping", "validation", "multi-robot", "open-set", "place-recognition"]
  reason: "ROMAN is rated for multi-session and multi-robot loop closure workflows — particularly relevant for airside aggregated mapping where viewpoint-invariant object-level alignment is required."
method-priority:end -->

Related docs: [Object-Level SLAM](object-level-slam.md) · [Semantic SLAM](semantic-slam.md) · [Loop Closure and Place Recognition](loop-closure-place-recognition.md) · [Distributed Multi-Robot PGO](distributed-multi-robot-pgo.md) · [Kimera-Multi](kimera-multi.md) · [Kimera-RPGO / PCM](kimera-rpgo-pcm.md) · [Kimera-VIO](kimera-vio.md) · [Learned LiDAR Place Recognition](learned-lidar-place-recognition.md) · [Scan Context Family](scan-context-family.md) · [KISS-Matcher](kiss-matcher.md) · [Certifiable Pose Graph Optimization](certifiable-pose-graph-optimization.md) · [LT-Mapper / Khronos Lifelong Mapping](lt-mapper-khronos-lifelong-mapping.md) · [Removert](removert.md) · [PIN-SLAM Neural LiDAR Mapping](pin-slam-neural-lidar-mapping.md) · [MASt3R-SLAM](mast3r-slam.md) · [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [Static-But-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md) · [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) · [Foundation Model Training First Principles](../../../10-knowledge-base/machine-learning/foundation-model-training-first-principles.md)

**Last updated:** 2026-05-24

---

## What It Is

**ROMAN** — full published title: **"ROMAN: Open-Set Object Map Alignment for Robust View-Invariant Global Localization"** — is a global localization and cross-session/multi-robot loop closure method that aligns object-level submaps rather than raw point clouds, image descriptors, or dense visual features.

- Published at **Robotics: Science and Systems (RSS) 2025**, Paper 29.
- arXiv 2410.08262 (submitted October 2024; revised April 2025).
- PDF: https://www.roboticsproceedings.org/rss21/p029.pdf
- GitHub (core): https://github.com/mit-acl/roman
- GitHub (ROS wrapper): https://github.com/mit-acl/roman_ros
- Project page: https://acl.mit.edu/roman

**Note on the name:** "Robust Object Map Alignment Anywhere" is an informal backronym only. The exact published title is as stated above.

**Authors and affiliations:**

| Author | Affiliation at paper time |
|---|---|
| Mason B. Peterson | MIT Aerospace Controls Laboratory (MIT-ACL) |
| Yi Xuan (Yixuan) Jia | MIT Aerospace Controls Laboratory |
| Yulun Tian | MIT / UCSD postdoc; now Asst. Prof., U. Michigan Robotics (Scalable Spatial Intelligence Lab) |
| Annika Thomas | MIT Aerospace Controls Laboratory |
| Jonathan P. How | MIT Aerospace Controls Laboratory (PI) |

**Lab:** MIT-ACL is the **Aerospace Controls Laboratory** (Jonathan How's group). This is NOT the SPARK Lab, which is Luca Carlone's group at MIT. MIT-ACL is also the home of Kimera-Multi, CLIPPER, and related multi-robot SLAM work.

**Funding:** Ford Motor Company, DSTA, ONR, ARL DCIST CRA.

**Current code release:** RGB-D primary (Intel RealSense D455 + Kimera-VIO front-end demonstrated). LiDAR-native operation is architecturally feasible but is not in the released codebase.

---

## Core Technical Idea

ROMAN solves global localization and cross-session / multi-robot loop closure by aligning **object-level submaps** rather than dense point clouds, image patches, or compressed descriptors.

Two observations motivate the design:

1. **Objects are more viewpoint-stable than keypoints.** A traffic sign, light mast, or jet bridge has a recognisable shape, volume, and semantic identity from many viewing angles. An ORB keypoint or scan-context ring descriptor does not.

2. **Pairwise object distances are approximately preserved under large viewpoint changes.** The spatial arrangement of objects constrains which correspondences are geometrically consistent, enabling robust global data association without needing to know which object is which in advance.

Given two object submaps — one from a prior session or a different robot, one from the current robot — ROMAN solves a **graph-theoretic global data association** problem that finds a maximally consistent set of object correspondences and then estimates the SE(3) relative transform from those correspondences.

Key design choices that differentiate ROMAN from prior work:

- **Open-set objects.** FastSAM segments arbitrary image regions without a fixed class list. CLIP provides view-invariant semantic embeddings for each segment. No per-domain annotation or retraining is required.
- **Unified affinity matrix.** Shape similarity, semantic similarity, and geometric consistency are combined into a single edge-weight formulation before solving the densest-subgraph problem, not applied as a sequential filter pipeline.
- **Gravity-direction prior.** The in-plane (x-y) alignment is decoupled from the vertical (z) component using an IMU or VIO gravity estimate. This eliminates a large fraction of impossible 3D configurations before the graph optimization begins.
- **Submap scope.** Objects are accumulated over a bounded spatial window, limiting the scale of the matching problem and enabling scalable multi-robot loop closure with interpretable classical optimization.

---

## Foundation Models Used

ROMAN does **not** use DINOv2, GroundingDINO, SAM2, or any learned place-recognition backbone. The exact foundation model stack, as verified from the published paper, is:

| Model | Role in ROMAN | Training status |
|---|---|---|
| **FastSAM** | Open-set image segmentation — generates segment proposals for each RGB frame | Pre-trained on COCO / SA-1B; no fine-tuning required |
| **CLIP** (OpenAI ViT) | Semantic descriptor — cosine-similarity embedding extracted from the minimal bounding-box crop of each segment | Pre-trained on internet image-text pairs; no fine-tuning required |
| **YOLO-V7** | Pedestrian filtering — removes dynamic human segments before object accumulation in the submap | Pre-trained on COCO; no fine-tuning required |

The graph-theoretic matching core is **CLIPPER extended** — a classical densest-subgraph optimizer (Lusk et al., MIT-ACL) augmented with shape, semantic, and gravity terms. CLIPPER is not a learned model; it is a classical numerical optimizer with no gradient-based training.

**Practical consequence:** ROMAN inherits zero-shot generalization from FastSAM and CLIP. Deployment in a new environment requires no labeled data collection. Out-of-distribution degradation (extreme illumination, industrial or underground scenes significantly outside COCO/internet training distribution) is a risk but not a fundamental blocker for typical airside surface environments.

See [Foundation Model Training First Principles](../../../10-knowledge-base/machine-learning/foundation-model-training-first-principles.md) for discussion of zero-shot transfer limits and when fine-tuning is necessary.

---

## Operator Mechanics — Step-by-Step Pipeline

```
RGB-D stream + odometry/VIO
        |
        v
[1] FastSAM segmentation per frame
    - open-set, zero-shot image segmentation
    - returns variable segments per image
    - image resolution controls segment density:
        128 px -> ~4 segments / frame
        256 px -> ~11 segments / frame
        512 px -> ~19 segments / frame
        |
        v
[2] Depth projection + voxelization
    - project each 2D segment mask to 3D using the depth channel
    - voxel-grid occupancy representation per segment
        |
        v
[3] YOLO-V7 pedestrian filter
    - detect pedestrian bounding boxes in RGB image
    - suppress any segment overlapping a detected pedestrian bbox
    - prevents dynamic humans from entering the object map
        |
        v
[4] CLIP semantic embedding per segment
    - extract CLIP feature vector from minimal bounding-box crop
    - L2-normalize embedding
        |
        v
[5] Frame-to-frame segment tracking
    - voxel IOU matching + global nearest-neighbour assignment
    - segments tracked across frames; embeddings averaged across views
        |
        v
[6] Segment merging / object consolidation
    - merge segments with high voxel IOU or high 2D projection overlap
    - reject non-object segments (ground planes, large walls) via
      planarity / volume filters
        |
        v
[7] Object state: centroid + shape attributes + mean CLIP embedding
    - shape: volume, linearity, planarity, scattering (PCA eigenvalue ratios)
    - semantic: mean of L2-normalized CLIP embeddings across observations
        |
        v
[8] Submap accumulation
    - collect objects observed over a bounded spatial window (route segment)
    - each submap = set of object states {centroid, shape, CLIP embedding}
        |
        v
[9] Cross-submap CLIPPER-extended matching
    - form putative object pairs (a_i from submap A, b_j from submap B)
    - build consistency graph:
        node  = putative pair (a_i, b_j)
        edge  = geometric consistency (Gaussian kernel on centroid-distance delta)
        weight incorporates:
          * pairwise geometric consistency (CLIPPER base formulation)
          * shape similarity = geometric mean of volume / linearity /
            planarity / scattering ratios
          * semantic similarity = rescaled CLIP cosine similarity
          * gravity prior = reject associations inconsistent with
            gravity direction
    - solve densest subgraph -> maximally consistent association set
        |
        v
[10] SE(3) pose estimation
    - Arun's method (SVD-based point-set registration) from matched centroids
    - yields relative transform T_AB between submaps
        |
        v
[11] Pose graph integration
    - ROMAN factor inserted as inter-session or inter-robot edge
    - backend: Kimera-RPGO with robust outlier rejection (PCM)
    - trajectory optimization with GTSAM
```

The critical insight in step 9 is that CLIPPER's classical densest-subgraph formulation is **interpretable**: the accepted association set is the largest mutually geometrically consistent hypothesis, not a black-box network output. This makes ROMAN's loop closures auditable — a requirement for airside safety cases.

See [Lie Groups — SE(3), SO(3), Jacobians](../../../10-knowledge-base/geometry-3d/lie-groups-se3-so3-jacobians.md) for the SE(3) estimation math behind step 10.

---

## Inputs and Outputs

**Inputs:**

- RGB-D stream (demonstrated: Intel RealSense D455; any depth-enabled camera with intrinsic calibration is compatible)
- Per-frame odometry (demonstrated: Kimera-VIO; any VIO or LIO front-end providing pose + IMU-gravity estimate is acceptable)
- IMU or VIO gravity direction estimate (required for gravity prior in step 9)

**Outputs:**

- 3D open-set object map (set of object states: centroid, shape attributes, mean CLIP embedding)
- Cross-session / cross-robot relative transform candidates with confidence score
- Object correspondence set per alignment (auditable)
- Loop-closure or inter-robot factor for downstream pose graph optimization

**ROMAN does not replace:**

- Front-end odometry (LiDAR ICP, VIO, LIO). ROMAN proposes global constraints; it does not provide incremental motion estimates.
- Dense map reconstruction. Object submaps are sparse landmark representations, not surface maps.
- Semantic segmentation for inventory or classification tasks. Object identity is encoded via CLIP embeddings, not structured class labels.

**LiDAR note:** The published paper and released code use RGB-D as the primary depth source. The architecture is compatible with LiDAR-derived depth for 3D object voxelization, but LiDAR-native operation (scan-based segment extraction without a camera) is not in the released codebase. The GitHub README notes additional depth sources as "in development."

---

## Architecture Block Diagram

```
+----------------------+       +----------------------+
| Session A  (RGB-D)   |       | Session B  (RGB-D)   |
| + VIO odometry       |       | + VIO odometry       |
+----------+-----------+       +----------+-----------+
           |                              |
    [FastSAM seg]                  [FastSAM seg]
    [Depth proj]                   [Depth proj]
    [YOLO-V7 ped filter]           [YOLO-V7 ped filter]
    [CLIP embed]                   [CLIP embed]
    [Track / merge / filter]       [Track / merge / filter]
           |                              |
    [Object map A]                 [Object map B]
    (centroid, shape,              (centroid, shape,
     CLIP embedding)                CLIP embedding)
           |                              |
           +-------------+  +------------+
                         |  |
                  [Submap A]  [Submap B]
                         |  |
                  +------+  +------+
                         v  v
          [Consistency Graph Construction]
            putative pairs as nodes
            geometric consistency as edges
            shape + semantic + gravity weighting
                         |
          [Densest Subgraph Optimization]
            CLIPPER extended framework
            (classical, not learned)
                         |
          [Accepted object correspondences]
                         |
          [SE(3) estimation — Arun's method]
                         |
          [Relative transform T_AB + confidence]
                         |
          [Kimera-RPGO pose graph backend]
            PCM outlier rejection + GTSAM
                         |
          [Optimized multi-session trajectory]
```

---

## Training Regime

ROMAN requires **no application-specific training**. All learned components are pre-trained foundation models:

| Component | Weights source | Fine-tuning required |
|---|---|---|
| FastSAM | COCO / SA-1B pretrained release | No |
| CLIP | OpenAI ViT pretrained release | No |
| YOLO-V7 | COCO pretrained release | No |
| CLIPPER extended | Classical numerical optimizer | N/A — no gradient-based training |

Practical deployment implications:

- Drop-in deployment without labeled data collection in the new domain.
- FastSAM and CLIP may produce degraded outputs in environments significantly out-of-distribution from their training data — e.g., extreme industrial interiors, underground tunnels, or runways at night under infrared illumination. Assess segment quality offline before production deployment.
- No task-specific fine-tuning pathway is described or released in the codebase as of the arXiv revision (April 2025). CLIP contrastive fine-tuning on domain-specific image pairs is feasible as an afterthought engineering step but is not documented.

---

## Benchmarks and Quantitative Results

All results are from arXiv 2410.08262 / RSS 2025 Paper 29. Numbers are extracted from the HTML version of the paper.

### Global Localization — MIT Campus (Kimera-Multi Outdoor Dataset)

Multi-robot outdoor urban environment. 120,000+ submap pairs tested; 420 pairs with >=2/3 area overlap used for recall analysis.

Success threshold: translation error <= 5 m AND rotation error <= 10 deg.

**Recall by relative viewpoint angle (Table II):**

| Viewpoint range | CLIPPER/Prune | MASt3R (GT scale) | ROMAN-XL |
|---|---|---|---|
| Same direction (0–60 deg) | 0.43 | 0.775 | 0.745 |
| Perpendicular (60–120 deg) | 0.11 | 0.152 | 0.457 |
| Opposite direction (120–180 deg) | **0.108** | **0.297** | **0.405** |

ROMAN-XL achieves **45% improvement over MASt3R** in opposite-direction scenarios. MASt3R with ground-truth scale is a strong dense visual baseline; ROMAN matches or exceeds it for non-same-direction traversals. Opposite-direction recall at 0.405 vs. CLIPPER/Prune at 0.108 is a 3.7x improvement.

Note: [MASt3R-SLAM](mast3r-slam.md) uses ground-truth scale as an oracle here — an advantage not available in blind deployment.

### Multi-Robot SLAM Trajectory Accuracy — Kimera-Multi Dataset

6–8 robot collaborative SLAM on tunnel, hybrid, and outdoor sequences. Metric: RMS Absolute Trajectory Error (ATE) in metres. Compared against [Kimera-Multi](kimera-multi.md) (visual BoW loop closure baseline).

**Challenging robot combinations:**

| Scenario | Kimera-Multi ATE | ROMAN ATE | Improvement |
|---|---|---|---|
| Hybrid robots 1, 2, 3 | 10.34 m | 6.91 m | 33% |
| Hybrid robots 4, 5 | 6.11 m | 2.80 m | **54%** |
| Outdoor robots 1, 2 | 10.12 m | 7.67 m | 24% |
| Overall (all sequences) | baseline | — | 7.6% ATE reduction |
| Difficult sequences only | baseline | — | **37% ATE reduction** |

These numbers establish a **24–54% ATE improvement on difficult Kimera-Multi sequences**, with 7.6% overall.

### Ground-Aerial Cross-View (Indoor Cluttered)

20 trajectory pairs. Ground robot + aerial robot in manually constructed cluttered indoor environment. Metric: recall for alignment success (translation <=5 m, rotation <=10 deg).

| Method | Recall |
|---|---|
| **ROMAN** | **0.60** |
| TEASER++/Prune | 0.55 |
| RANSAC-1M | 0.45 |
| CLIPPER (base, no shape/semantic) | ~0.35 |

Association accuracy on this dataset: ROMAN 71.2% vs. CLIPPER base 34.7% — demonstrating that the shape + semantic extensions in CLIPPER-extended are load-bearing.

### Off-Road Forested Environment

Platform: Clearpath Jackals with RealSense D455 + Kimera-VIO. Result: successful loop closure in opposite-direction traversals where all visual-feature methods fail. Qualitative result only; ATE not reported numerically for this environment in the published paper.

---

## Comparison Table

| Dimension | ROMAN | Scan Context | Kimera-Multi (visual LC) | Object-SLAM (closed-set) | MinkLoc3D / LoGG3D-Net | NetVLAD / Patch-NetVLAD |
|---|---|---|---|---|---|---|
| Paradigm | Object submap alignment | 2D range-image descriptor retrieval | Visual BoW / ORB loop closure | Object graph SLAM | Learned LiDAR global descriptor | Learned image global descriptor |
| Landmark type | Open-set 3D segments (arbitrary objects) | Ring-shaped LiDAR scan signature | ORB keypoints / BoW vocabulary | Closed-set class instances | Pointcloud submaps | Image patches |
| Open / closed set | Open-set (FastSAM + CLIP, no class list) | N/A — geometry only | Closed vocabulary (ORB-BoW) | Closed-set — predefined classes required | Geometry-only, no semantic class list | Closed-vocabulary — trained on place images |
| Sensor | RGB-D primary (LiDAR adaptable, not released) | LiDAR (2D or 3D) | RGB + IMU | RGB-D or LiDAR | LiDAR | Camera |
| Cross-viewpoint robustness | High — designed for opposite-direction traversals; 0.405 recall at 120–180 deg | Low — heading-sensitive | Low — ORB features fail under large viewpoint change | Medium — object identity survives viewpoint, descriptor may not | Medium — submap descriptor somewhat heading-sensitive | Low — appearance changes drastically with viewpoint |
| Multi-session | Native — core use case | Yes (retrieval-based) | Limited — designed for concurrent operation | Partial | Yes (retrieval-based) | Yes (retrieval-based) |
| Multi-robot | Native — heterogeneous platforms; 24–54% ATE gain on Kimera-Multi difficult sequences | No — same platform assumed | Yes — homogeneous robot fleets | Limited | No | No |
| Training required | None — pre-trained CLIP + FastSAM + YOLO-V7 | None | None — handcrafted ORB + BoW | Domain-specific class training | Full supervised training on LiDAR dataset | Supervised training on place image dataset |
| Open-set generalization | Yes — novel objects without retraining | N/A | No | No — fails on unknown classes | No — geometry generalized, no semantics | No — trained on specific place appearance |
| Runtime | Slower (FastSAM + CLIP + YOLO-V7 GPU inference; ~10s of seconds per submap match) | Very fast (~ms per scan) | Fast (ORB + BoW lookup) | Variable | Fast after embedding (~ms) | Fast after embedding (~ms) |
| Output | SE(3) relative transform + PGO factor | Similarity score + candidate pose | Relative pose (PnP) | Relative pose | Candidate place + similarity score | Candidate place + similarity score |
| Perceptual aliasing | Good — shape + semantic + geometric consistency combined | Poor — similar-looking scans collide | Poor in repetitive environments | Moderate — semantic label helps | Moderate — learned descriptor may generalize | Poor — appearance aliases easily |
| Aggregated-map fit | High — multi-session survey workflows | Medium — good for initial place retrieval | Low — concurrent-only design | Medium — needs class list per domain | Medium — geometry-only, no semantic | Low — camera-only, not production LiDAR |

See [Scan Context Family](scan-context-family.md), [Learned LiDAR Place Recognition](learned-lidar-place-recognition.md), [Kimera-Multi](kimera-multi.md), [Object-Level SLAM](object-level-slam.md), and [Loop Closure and Place Recognition](loop-closure-place-recognition.md) for deeper treatment of the competing methods.

---

## Lineage and Related Work

ROMAN sits at the intersection of four research lines:

### Open-vocabulary segmentation line

CLIP (Radford et al., OpenAI 2021) -> FastSAM (Zhao et al., 2023) -> SAM2 (Meta, 2024) -> GroundedSAM (community). ROMAN uses FastSAM (not SAM2 or GroundedSAM) for its real-time efficiency profile at the submap accumulation rate.

### CLIPPER matching line

CLIPPER (Lusk et al., MIT-ACL 2021) is the base densest-subgraph global data association framework. ROMAN extends CLIPPER with shape similarity, CLIP semantic similarity, and gravity-direction weighting. The CLIPPER line is entirely classical optimization — interpretable, no training, and the closest family to formal verification. See [Certifiable Pose Graph Optimization](certifiable-pose-graph-optimization.md) for the related certifiably-correct optimization framing.

### Object-level SLAM line

QuadricSLAM (Nicholson et al.) -> CubeSLAM (Yang & Scherer) -> Voxblox++ -> Hydra (Hughes et al., MIT-SPARK) -> ROMAN. Each step in this line relaxed the closed-set class assumption. ROMAN removes it entirely via FastSAM + CLIP. See [Object-Level SLAM](object-level-slam.md).

### Multi-robot loop closure line

Kimera-Multi (Tian et al., MIT-ACL 2022) -> distributed PGO (DPGO) -> ROMAN. ROMAN is designed as a drop-in inter-robot loop-closure front-end for the Kimera-Multi / Kimera-RPGO backend. See [Kimera-Multi](kimera-multi.md), [Kimera-RPGO / PCM](kimera-rpgo-pcm.md), and [Distributed Multi-Robot PGO](distributed-multi-robot-pgo.md).

Closest baselines evaluated in the paper:

- **MASt3R** — dense visual matching with ground-truth scale (oracle). ROMAN exceeds MASt3R on opposite-direction traversals. See [MASt3R-SLAM](mast3r-slam.md).
- **TEASER++** — certifiable point-set registration baseline. ROMAN's ground-aerial recall (0.60) exceeds TEASER++/Prune (0.55).
- **SegMap** (Dube et al., ETH 2020) — segment-based descriptor retrieval. ROMAN supersedes SegMap by introducing open-set semantics and CLIPPER-extended matching.

---

## Strengths

1. **Viewpoint invariance.** The only method in this review explicitly evaluated under opposite-direction traversal with verified quantitative recall. At 120–180 deg viewpoint difference, ROMAN achieves 0.405 recall vs. 0.297 (MASt3R) and 0.108 (CLIPPER/Prune).

2. **Open-set, no per-class retraining.** FastSAM + CLIP provide zero-shot generalization — deployable in a new domain without any labeled data. Novel object categories encountered at runtime are handled naturally.

3. **Multi-session and multi-robot natively.** Designed for asynchronous, heterogeneous multi-robot scenarios — cross-vehicle and ground-aerial loop closure demonstrated. Not limited to concurrent same-platform operation.

4. **Compact map representation.** Object submaps are orders of magnitude smaller than dense point clouds or 3D Gaussian maps. Inter-robot communication bandwidth is minimal — relevant for airside radio-constrained uplinks.

5. **Gravity-prior efficiency.** Decoupling z-axis from x-y alignment dramatically prunes the search space before graph optimization. Well-suited to ground vehicles where roll/pitch are approximately stable.

6. **Interpretable matching.** CLIPPER-extended is a classical densest-subgraph solver. The accepted correspondence set is auditable — a property relevant to safety-case argumentation.

7. **Demonstrated domain breadth.** Indoor, urban (MIT campus), forested off-road, and ground-aerial cross-modal — not tuned to a single scenario.

8. **Production-ready integration path.** ROS 1 and ROS 2 wrappers released (`mit-acl/roman_ros`). Kimera-RPGO integration documented.

---

## Failure Modes and Limitations

**Author-stated limitations (from paper):**

1. **Segmentation ambiguity.** Determining what constitutes a discrete object is unsolved with open-set segmentation. FastSAM may generate duplicate representations — a car as one object AND its doors as separate objects. This creates map noise and false matches.

2. **Non-object segment loss.** ROMAN filters ground planes, walls, and ceilings because they are not discrete objects. Potentially useful geometric structure in those surfaces is discarded.

3. **Scalability ceiling.** Current evaluation covers ~8 robots and ~1,000 m trajectories. Longer routes or more robots require growing submap registrations with "significant computation." No hierarchical indexing or compression is implemented.

4. **Centroid-level precision only.** Pose estimation uses object centroids, not full surface geometry. Errors grow when objects are nearly collinear, coplanar, or when centroids are noisy due to partial occlusion.

**Additional limitations (derived from architecture):**

5. **Foundation model out-of-distribution.** FastSAM (COCO/SA-1B) and CLIP (internet image-text) degrade in extreme industrial, underground, or nocturnal-infrared environments. No domain adaptation pathway is released.

6. **Object-sparse environments.** Open fields, clear runways, desert terrain, and snow-covered surfaces have few discrete objects above ground. ROMAN produces no loop closures in these areas. This is a fundamental coverage gap for airside taxiway-only traversal without GSE or fixtures nearby.

7. **Dynamic object pollution.** Parked aircraft, baggage carts, belt loaders, cones, and fuel trucks will be treated as persistent landmarks unless filtered upstream. A static object map must be pre-computed. The YOLO-V7 filter handles pedestrians only — vehicle and equipment filtering requires separate upstream processing.

8. **GPU required.** FastSAM and CLIP inference are GPU-dependent for real-time or near-real-time operation. CPU fallback removes semantic computation and significantly degrades matching quality.

9. **RGB-D primary.** Depth from structured-light or time-of-flight camera is the primary 3D source. LiDAR-native operation (no camera) is not released; integration requires engineering work beyond the published codebase.

10. **Repetitive layouts.** Gate rows, identical terminal bays, uniform warehouse racking, and identical light mast spacings create spatial and semantic aliasing. ROMAN's geometric consistency check is necessary but does not eliminate false positives in highly repetitive environments.

11. **Runtime cost.** Submap matching is slower than scan-context or descriptor-retrieval methods — on the order of tens of seconds per submap pair per the brief. This is acceptable for post-session processing but limits real-time loop closure triggering rates.

---

## Domain Fit

| Domain | Fit | Rationale |
|---|---|---|
| Urban outdoor multi-robot | High | MIT campus evaluation; heterogeneous viewpoints and sessions |
| Airside (infrastructure-rich zones) | High | Jet bridges, signs, light masts, hydrants, fixed GSE staging areas — stable, diverse objects; multi-session survey natural use case |
| Airside (open taxiway / runway) | Low | Object-sparse; ROMAN provides no coverage without GNSS or scan-context bridging |
| Indoor (terminal, baggage hall) | High | Stable infrastructure, multi-session traversal from different vehicle types |
| Warehouse | Medium | Repetitive racking is high-aliasing; mixed results expected |
| Forested off-road | Medium | Qualitative success demonstrated; no numeric ATE |
| Underground / mine | Low | FastSAM and CLIP may fail out-of-distribution; also object-sparse |
| Ground-aerial cross-modal | High | Demonstrated: 0.60 recall vs. 0.55 (TEASER++) |

---

## Aggregated-Map Suitability for Airside Multi-Session Survey

**Overall rating: HIGH for static infrastructure zones; LOW for open taxiway and runway-only segments.**

### Why ROMAN fits multi-session airside survey

Airside maps are updated over weeks and months. Survey runs happen at different times of day, from different vehicles (ground robots, elevated platforms, forklifts, maintenance vehicles), and sometimes in opposite directions along taxiways or aprons. These are exactly the failure scenarios for image-feature loop closure that ROMAN addresses.

The airside static object vocabulary — jet bridges, gate signs, taxiway signs, PAPI arrays, light masts, fire hydrants, terminal wall fixtures, hangar structural members, fixed GSE staging markers, apron barrier walls — is stable, visually distinctive, and spatially distributed. FastSAM + CLIP handle this vocabulary without per-class annotation.

### The critical upstream dependency: static map cleansing

ROMAN's object map must contain only static objects. In airside environments, the following MUST be excluded before ROMAN alignment. See [Removert](removert.md) (iter 40), [Static-But-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), and [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) for upstream filtering methods.

| Object category | Classification | Required action |
|---|---|---|
| Parked aircraft (body, tail, engines) | Highly transient | Remove via Removert / DUFOMap before ROMAN |
| Belt loaders, fuel trucks, baggage carts | Short-term transient | Dynamic removal upstream |
| Ground crew and service vehicles | Dynamic | YOLO-V7 handles pedestrians; vehicle filter needed separately |
| Traffic cones, temporary barriers | Session-specific transient | Change detection between sessions |
| Jet bridges (extended vs. retracted) | Semi-static | Allow with observation-count threshold; positional state must be tracked |

Recommended upstream pipeline: Removert (iter 40) or DUFOMap static-map extraction produces a clean static point cloud. ROMAN then operates on objects extracted from that static cloud.

### Specific airside strengths

- ROMAN's opposite-direction traversal capability is directly applicable: survey vehicles traverse taxiways in both directions on different operational days.
- Cross-platform loop closure (ground survey robot to elevated maintenance platform) is demonstrated in the ground-aerial indoor experiment — a direct analogue to airside cross-vehicle mapping.
- Compact object maps suit airside fleet data uplink constraints (limited bandwidth on airside radios).
- The gravity prior is well-suited to ground vehicles, where fixed roll/pitch assumptions are approximately valid.

### Coverage gap: open taxiway segments

Taxiway center sections between fixture clusters, runway clear zones, and open apron areas without GSE or edge infrastructure have insufficient objects for ROMAN loop closure. These gaps require:

- LiDAR scan-context bridging (see [Scan Context Family](scan-context-family.md))
- GNSS / RTK absolute positioning constraints
- Or LiDAR odometry front-end alone with accepted drift until the next object cluster

### Integration architecture for airside aggregated mapping

```
Raw LiDAR survey data (multi-session, multi-vehicle)
        |
[Removert / DUFOMap — static map extraction]
        |
[Static point cloud per session]
        |
        +---> [LiDAR odometry front-end — KISS-ICP / PIN-SLAM]
        |             |
        |     [VIO / INS gravity estimate]
        |             |
        +---> [ROMAN object mapping — RGB-D or camera-depth fusion]
                      |
              [YOLO-V7 pedestrian filter + vehicle filter (custom)]
                      |
              [Open-set object submap per session]
                      |
              [ROMAN CLIPPER-extended cross-submap alignment]
                      |
              [Loop closure factors — multi-session + multi-vehicle]
                      |
              [Kimera-RPGO / certifiable PGO backend]
                (see Kimera-RPGO / PCM, Certifiable PGO)
                      |
              [Consistent multi-session aggregated map]
                      |
              [Semantic layer: fixed infrastructure inventory]
```

See [LT-Mapper / Khronos Lifelong Mapping](lt-mapper-khronos-lifelong-mapping.md) for the long-horizon map management layer above this pipeline, and [PIN-SLAM Neural LiDAR Mapping](pin-slam-neural-lidar-mapping.md) (iter 42) for a neural alternative front-end.

---

## Implementation Notes for Production Integration

1. **Static object filter.** Define allowed object categories for persistent landmark inclusion. Maintain an object lifetime counter; objects observed in fewer than N sessions (e.g., 3) are not promoted to stable landmarks.

2. **GPU budget.** FastSAM at 512 px resolution produces ~19 segments per image. CLIP inference per segment on a mobile GPU (Orin dGPU or discrete GPU) adds latency. Batch inference across frames per submap window is more efficient than frame-by-frame embedding.

3. **Kimera-RPGO integration.** ROMAN is designed for Kimera-RPGO's PCM outlier rejection. Connecting to a different PGO backend requires re-implementing the factor interface. See [Kimera-RPGO / PCM](kimera-rpgo-pcm.md).

4. **Submap windowing.** Submap size (spatial extent and number of objects) controls matching complexity. The paper does not publish a hard recommendation; tune based on environment object density and available compute budget.

5. **ROS deployment.** `mit-acl/roman_ros` provides ROS 1 (`ros1` branch) and ROS 2 wrappers. Kimera-VIO is the documented odometry integration path; other VIO or LIO inputs require topic remapping.

6. **LiDAR adaptation path.** To use LiDAR as depth source, replace the RGB-D voxelization step with LiDAR-projected depth images or use LiDAR ground segmentation to extract above-ground object clusters as ROMAN segment inputs. This is not in the released code and requires engineering effort.

7. **Complement with geometric verification.** Insert a LiDAR ICP or KISS-Matcher consistency check (see [KISS-Matcher](kiss-matcher.md)) after ROMAN alignment to filter false positives before committing loop closure to the pose graph.

8. **Airside domain assessment.** Before production deployment, run FastSAM + CLIP offline on a sample of airside images across illumination conditions (dawn, day, dusk, artificial night lighting). If CLIP embeddings for key landmark categories (taxiway signs, light masts) are incoherent or unstable across illuminations, consider CLIP contrastive fine-tuning on airside image pairs as a pre-deployment step.

9. **License.** Verify license terms for `mit-acl/roman` and `mit-acl/roman_ros` before commercial integration. MIT-ACL repositories have historically used MIT or BSD-style licenses but confirm against the current repository header.

---

## Sources

- Peterson, Jia, Tian, Thomas, How. "ROMAN: Open-Set Object Map Alignment for Robust View-Invariant Global Localization." RSS 2025, Paper 29. https://arxiv.org/abs/2410.08262
- arXiv HTML version (primary technical extraction source): https://arxiv.org/html/2410.08262v1
- RSS 2025 paper listing: https://roboticsconference.org/program/papers/29/
- PDF: https://www.roboticsproceedings.org/rss21/p029.pdf
- GitHub core: https://github.com/mit-acl/roman
- GitHub ROS wrapper: https://github.com/mit-acl/roman_ros
- MIT-ACL project page: https://acl.mit.edu/roman
- Yulun Tian affiliation: https://www.tianyulun.com/
- ROS 2 release announcement: https://discourse.openrobotics.org/t/roman-ros-2-open-set-object-mapping-global-localization-code-release/41178
