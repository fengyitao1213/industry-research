# Semantic SLAM

<!-- method-priority:start
priority:
  learning: 4
  deployment: 3
  type: "method"
  stage: "modern-core"
  maturity: "fielded-pattern"
  tags: ["slam", "fallback", "gnss-denied", "indoor", "validation"]
  reason: "Semantic SLAM is rated for visual or visual-inertial SLAM coverage, especially fallback and GNSS-denied use."
method-priority:end -->

Related docs: [SLAM Method Library Overview](overview.md) · [SD-SLAM — Semantic Dynamic LiDAR](sd-slam-semantic-dynamic-lidar.md) · [Dynamic-Object-Aware SLAM](dynamic-object-aware-slam.md) · [LT-Mapper / Khronos Lifelong Mapping](lt-mapper-khronos-lifelong-mapping.md) · [Loop Closure and Place Recognition](loop-closure-place-recognition.md) · [Object-Level SLAM](object-level-slam.md) · [Scan Context Family](scan-context-family.md) · [Certifiable Pose-Graph Optimization](certifiable-pose-graph-optimization.md) · [Kimera-Multi](kimera-multi.md) · [Distributed Multi-Robot PGO](distributed-multi-robot-pgo.md) · [Splat-SLAM](splat-slam.md) · [GigaSLAM](gigaslam.md) · [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [LiDAR Semantic Segmentation](../../perception/overview/lidar-semantic-segmentation.md) · [OpenScene](../../perception/methods/openscene.md) · [MoSaic3D](../../perception/methods/mosaic3d.md) · [Large-Scale 3D Segmentation Benchmarks](../../perception/datasets-benchmarks/large-scale-3d-segmentation-benchmarks.md) · [Semantic Mapping and Learned Priors](../maps/semantic-mapping-learned-priors.md) · [Production LiDAR Map Localization](../overview/production-lidar-map-localization.md)

**Last updated:** 2026-05-23

---

## What It Is

Classical SLAM produces a **geometric map**: a point cloud, surfel set, voxel grid, mesh, or Gaussian field that encodes where surfaces are. Each map element carries only geometric attributes — position, normal, colour, occupancy — but nothing about what class of object or surface it represents.

**Semantic SLAM** augments every map element with a **semantic class label** drawn from a fixed vocabulary (road / sidewalk / car / person / building / vegetation / ...) or, in newer open-vocabulary systems, from a continuous CLIP-space embedding. Formally, given sensor stream `{z_t}` and vehicle poses `{x_t}`, semantic SLAM produces:

```
M = {(p_k, l_k, sigma_k)}
```

where `p_k` is the 3D position (or volumetric region) of map element `k`, `l_k` is its semantic label distribution over `C` classes, and `sigma_k` is the geometric uncertainty. The pose trajectory `{x_t}` is estimated jointly or in a tightly coupled front-end.

**Downstream applications enabled by `l_k`:**

| Application | How semantic labels help |
|---|---|
| Task-aware navigation | Plan on road-class; avoid person-class zones |
| Semantic localisation | Match observed semantic map to prior semantic map |
| Dynamic-object handling | Movable classes excluded or down-weighted from map landmarks |
| Change detection by class | New fence vs new vehicle triggers different update policy |
| Per-class auto-labelling flywheel | Semantic map feeds class-aware annotation pipelines |
| Scene-graph construction | Classes seed node types in hierarchical scene representation |
| Map QA and validation | Semantic disagreement between passes flags review regions |

For AV and airside deployments, semantic SLAM is production-useful as an **aid**: dynamic-object filtering, map QA, change detection, semantic HD-map layer maintenance, drivable-area validation, and scene understanding. As **primary localization**, it is risky — semantic predictions are closed-set, detector-dependent, hard to calibrate, and vulnerable to domain shift. The pose backbone should remain explainable geometry and multi-sensor estimation, as described in [Production LiDAR Map Localization](../overview/production-lidar-map-localization.md).

---

## Core Technical Idea and Taxonomy

Four architecturally distinct strategies exist, with partial overlap:

### Axis A — Per-Frame Label Fusion onto a Geometric Map

The most widespread approach. A geometric SLAM back-end runs at full rate; a semantic segmentation network (CNN or transformer) produces per-pixel or per-point class probability vectors from each frame. These vectors are projected onto the running map and fused via **Bayesian label voting per voxel or surfel**.

Fusion update per voxel `k` across frame `t`:

```
P(l_k | z_{1:t})  proportional to  P(z_t | l_k) * P(l_k | z_{1:t-1})
```

With a C-class categorical likelihood and Dirichlet prior, this simplifies to:

```
count_c(k) += p(l_k = c | z_t)   for each class c
P(l_k = c)  = count_c(k) / sum_c count_c(k)
```

Accumulated votes improve label confidence as more views observe the same voxel. This is the architecture of SemanticFusion (§ Visual Lineage), SuMa++ (§ LiDAR Lineage), Kimera-Semantics, and Voxblox-based systems.

**Strengths:** Decoupled — geometric SLAM runs even if segmentation fails or lags. Incremental update. Feasible on Orin with a lightweight segmentation backbone (FRNet, SalsaNext).

**Weaknesses:** Label quality bounded by per-frame segmentation; multi-class boundaries blur across voxels near object edges; label flickering in fast-moving scenes.

### Axis B — Object-Level / Scene-Graph Approaches

The map is a **hierarchical graph** whose nodes represent objects, places, rooms, and buildings — not raw voxels. Semantic class determines the node type and attributes. Edges encode spatial, adjacency, and containment relations. Developed principally by the Carlone group at MIT (Kimera → Hydra → Khronos).

**Strengths:** Compact; query-friendly; supports task planning on graph structure; deformation-aware loop closure propagates corrections through scene structure, not just through a pose trajectory.

**Weaknesses:** Relies on reliable object detection and instance segmentation; object merging across frames is complex; harder to maintain in truly cluttered environments.

### Axis C — Joint Geometric + Semantic Factor-Graph Optimisation

A single factor graph simultaneously optimises the trajectory `{x_t}` **and** the semantic landmark positions and labels. Factors include odometry factors (pose-to-pose), semantic observation factors (pose-to-object with class likelihood), loop-closure factors, and temporal-consistency factors (same object maintains consistent label across visits):

```
E = sum_t rho(r_odom_t)
  + sum_{k,t} rho(r_obs_{k,t})
  + sum_loops rho(r_loop)
  + lambda_sem * sum_k KL(l_k_t || l_k_{t-1})
```

Examples: SA-LOAM (semantic ICP factors), S-Graphs 2.0 (hierarchical room/floor factors), SlideSLAM (object-level joint trajectory-and-map optimisation).

**Strengths:** Semantic uncertainty propagates back to pose estimation; semantically informed loop closure.

**Weaknesses:** Larger factor graph; higher compute; requires stable object-level data association.

### Axis D — End-to-End Learned Semantic SLAM

Neural-implicit or Gaussian-splatting methods (NeRF-SLAM, SNI-SLAM, and related) produce both a dense scene representation and semantic features from a jointly trained network. Segmentation and geometry are not decoupled.

**Status:** Active research; state-of-the-art on indoor benchmarks (ScanNet). Substantially higher compute than classical approaches. The 2025 embedded-systems survey (arXiv:2505.12384) assessed NeRF and Gaussian-splatting methods as achieving "high semantic detail but demanding substantial computing resources, limiting their use on embedded devices." See [Splat-SLAM](splat-slam.md) for the Gaussian-splatting SLAM family. Not suitable for real-time Orin-class deployment in 2026.

---

## Visual Semantic SLAM Lineage (RGB-D)

### SemanticFusion (McCormac et al., ICRA 2017)

**Paper:** "SemanticFusion: Dense 3D Semantic Mapping with Convolutional Neural Networks"
**Authors:** John McCormac, Ankur Handa, Andrew Davison, Stefan Leutenegger (Imperial College, Dyson Robotics Lab)
**ArXiv:** https://arxiv.org/abs/1609.05130
**IEEE ICRA 2017:** https://dl.acm.org/doi/10.1109/ICRA.2017.7989538
**Project:** https://www.imperial.ac.uk/dyson-robotics-lab/projects/semanticfusion/

The canonical RGB-D semantic SLAM. Couples **ElasticFusion** (dense RGB-D SLAM with surfel map and deformable loop closure) with a convolutional neural network running on each RGB frame. Per-frame semantic probability vectors are Bayesian-fused into the ElasticFusion surfel map per-surfel. Evaluated on NYUv2: fusing multiple views improved 2D semantic labelling accuracy beyond single-frame prediction, validating the multi-view fusion principle.

**Architecture note:** Segmentation runs as a CNN on the raw RGB frame; the coupling is purely at the map fusion level. The SLAM back-end does not use semantic labels for registration or loop closure. This clean separation — geometry drives pose; semantics are a map enrichment layer — became the template for all subsequent per-frame-fusion semantic SLAM systems.

**Significance:** First large-scale demonstration that per-frame CNN predictions, when Bayesian-fused across many viewpoints, produce a high-quality dense 3D semantic map.

### MaskFusion (Rünz & Agapito, ISMAR 2018)

**Paper:** "MaskFusion: Real-Time Recognition, Tracking and Reconstruction of Multiple Moving Objects"
**Authors:** Martin Rünz, Lourdes de Agapito (UCL)
**ArXiv:** https://arxiv.org/abs/1804.09194
**GitHub:** https://github.com/martinruenz/maskfusion
**Project:** http://visual.cs.ucl.ac.uk/pubs/maskfusion/

Extends ElasticFusion to handle **independently moving objects**. Instance-level semantic segmentation (Mask R-CNN) provides object masks that allow the system to track each object as a separate rigid body with its own pose trajectory. The map is a collection of object submaps, each with a semantic label and 6-DOF pose estimate.

**Key departure from SemanticFusion:** Object-level rather than voxel-level representation. Each node in the map is an object (with class, pose, and geometry), not a voxel (with class and occupancy). This is a direct predecessor to the scene-graph approaches in § 3D Scene-Graph Approaches.

### Voxblox and Voxblox++

**Voxblox (base):** Helen Oleynikova et al., IROS 2017. https://helenol.github.io/publications/iros_2017_voxblox.pdf

**Voxblox++:** Grinvald et al., RAL+IROS 2019 — extends Voxblox TSDF with semantic and instance labels per voxel.

> **Uncertainty flag 1:** The "Voxblox++" label circulates in the community. The primary canonical publication appears to be Grinvald et al. RAL+IROS 2019 "Volumetric Instance-Aware Semantic Mapping and 3D Object Discovery." Confirm the precise arXiv number before citing the methods page directly.

Voxblox is an incremental TSDF-based volumetric mapper operating on CPU. Voxblox++ augments each TSDF voxel with a semantic probability vector over C classes, fused via Bayesian update. PanopticFusion (Narita et al., 2019) builds on Voxblox to add panoptic labels (semantic + instance ID) per voxel.

**Significance:** Established the TSDF+semantic pattern that Kimera-Semantics adopted. The CPU-runnable design — no GPU requirement for the map back-end — is practical for embedded systems.

### Kimera-Semantics (Rosinol / Carlone, ICRA 2020)

**Paper:** "Kimera: an Open-Source Library for Real-Time Metric-Semantic Localization and Mapping"
**Authors:** Antoni Rosinol, Marcus Abate, Yun Chang, Luca Carlone (MIT-SPARK Lab)
**ArXiv:** https://arxiv.org/abs/1910.02490
**GitHub (index):** https://github.com/MIT-SPARK/Kimera
**GitHub (semantics):** https://github.com/MIT-SPARK/Kimera-Semantics
**Journal version (IJRR 2021):** https://arxiv.org/abs/2101.06894

Kimera is a modular C++ system: **Kimera-VIO** (visual-inertial odometry at ~10 Hz), a **GTSAM-based pose graph optimiser** with loop closures, a **3D Mesher**, and **Kimera-Semantics** (dense metric-semantic TSDF with per-voxel Bayesian label fusion from 2D segmentation projected at current camera pose). The VIO+SLAM backbone provides poses; the semantic mesh can be queried spatially for path planning.

**Kimera extended (IJRR 2021):** Adds a 3D Dynamic Scene Graph (DSG) construction on top of the TSDF mesh — nodes represent objects, places, rooms, buildings; edges encode spatial relations. This is the bridge from per-voxel semantic maps to object-level scene graphs.

### Hydra (Hughes / Chang / Carlone, RSS 2022 / RAL 2022)

**Paper:** "Hydra: A Real-time Spatial Perception System for 3D Scene Graph Construction and Optimization"
**Authors:** Nathan Hughes, Yun Chang, Luca Carlone (MIT-SPARK Lab)
**ArXiv:** https://arxiv.org/pdf/2201.13360
**MIT DSpace:** https://dspace.mit.edu/handle/1721.1/145300
**GitHub:** https://github.com/MIT-SPARK/Hydra
**IJRR 2024:** https://journals.sagepub.com/doi/10.1177/02783649241229725

Hydra extends Kimera to produce a full **3D Scene Graph (3DSG)** in real time from sensor streams. Five layers: Buildings → Rooms → Places/Volumes ← Objects ← Agents. Each node carries semantic labels, geometric attributes (centroid, bounding box, free-space model), and relations (adjacency, containment, temporal change).

**Architecture:** Fast early/mid-level perception (metric-semantic TSDF + place/object detection) couples to a slower high-level process (room segmentation, building parcellation, scene-graph loop closure). Online accuracy is comparable to batch offline methods on large indoor environments. **Deformation-aware loop closure** propagates corrections through the scene graph, not just the pose trajectory, correcting object positions and room boundaries simultaneously.

---

## LiDAR Semantic SLAM Lineage

### SuMa++ (Chen / Stachniss, IROS 2019)

**Paper:** "SuMa++: Efficient LiDAR-based Semantic SLAM"
**Authors:** Xieyuanli Chen, Andres Milioto, Emanuele Palazzolo, Philippe Giguère, Jens Behley, Cyrill Stachniss (University of Bonn)
**ArXiv:** https://arxiv.org/abs/2105.11320
**PDF (IROS 2019):** https://www.ipb.uni-bonn.de/wp-content/papercite-data/pdf/chen2019iros.pdf
**GitHub:** https://github.com/PRBonn/semantic_suma
**IEEE IROS 2019:** https://ieeexplore.ieee.org/document/8967704

The canonical LiDAR semantic SLAM. Extends the SuMa surfel-based mapping framework (Behley & Stachniss, RSS 2018) with semantic labels from RangeNet++ trained on SemanticKITTI.

**Semantic ICP weighting:** Projective ICP is augmented with a semantic consistency term:

```
E = sum_i [ rho_geom(r_i) + lambda * indicator(s_query_i != s_map_i) ]
```

Points where the query scan's semantic label disagrees with the surfel map's stored label incur a higher penalty, down-weighting outlier correspondences that arise when dynamic objects partially overlap with static map surfels.

**Online semantic consistency checking:** Each surfel stores a label probability vector updated per-observation. When a new scan predicts a label strongly inconsistent with the stored distribution (e.g. surfel labelled `car` but scan predicts `building` at that location), the surfel is flagged for removal. This detects vehicles that moved between scans without requiring explicit motion detection. Critically, SuMa++ does NOT hard-delete all `car`-class surfels — parked cars remain as registration anchors until they demonstrate inconsistency.

> **Uncertainty flag 3:** The exact SemanticKITTI class IDs used in the dynamic-consistency check are in the full paper PDF. The confirmed behaviour is semantic consistency checking per-surfel; the specific class subset is not confirmed from the abstract alone.

**Evaluation:** KITTI odometry sequences with dense dynamic vehicle traffic. Relative translational error approximately 0.22–0.46% on highway sequences. Improvement over baseline SuMa is most pronounced on sequences 00, 05, and 08 with dense moving traffic.

**Limitations:** RangeNet++ (DarkNet-53 backbone) is KITTI-biased; domain shift to airside or warehouse degrades segmentation quality.

### SegMap / SemSegMap (Dubé / Cadena / Siegwart, RSS 2017 → IJRR 2020)

**Paper:** "SegMap: Segment-based mapping and localization using data-driven descriptors"
**Authors:** Renaud Dubé, Andrei Cramariuc, Daniel Dugas, Hannes Sommer, Juan Nieto, Roland Siegwart, Cesar Cadena (ETH Zurich ASL)
**IJRR 2020:** https://journals.sagepub.com/doi/abs/10.1177/0278364919863090
**GitHub:** https://github.com/ethz-asl/segmap

SegMap partitions LiDAR scans into **segments** (geometrically coherent clusters) and learns compact autoencoder descriptors per segment. Segments serve as map primitives for place recognition and loop closure. The descriptor encodes shape context rather than raw point coordinates, giving viewpoint invariance.

**Relation to semantic SLAM:** SegMap is primarily a place-recognition and loop-closure system. The SemSegMap extension (arXiv:2107.14715) adds semantic labels to segment descriptors, achieving class-aware place recognition. SegMap's segment-centric representation is a middle ground between point-cloud SLAM and object-level SLAM. Cross-reference: [Loop Closure and Place Recognition](loop-closure-place-recognition.md).

**Key result:** 6% recall improvement over handcrafted descriptors; drift reduction up to 50% over open-loop odometry.

### SA-LOAM (Li et al., ICRA 2021)

**Paper:** "SA-LOAM: Semantic-aided LiDAR SLAM with Loop Closure"
**Authors:** Lin Li, Xin Kong, et al.
**ArXiv:** https://arxiv.org/abs/2106.11516
**IEEE ICRA 2021:** https://dl.acm.org/doi/abs/10.1109/ICRA48506.2021.9560884

SA-LOAM extends LOAM with semantic assistance in both odometry and loop closure:

- **Semantic ICP:** Correspondence filtering uses semantic class — a scan point of class `building` only matches map points of class `building`. Reduces false correspondences in geometrically ambiguous scenes.
- **Plane constraints from semantic labels:** Floor and wall classes provide stable planar constraints that stabilise the vertical DOF of the pose estimate.
- **Semantic graph place recognition:** A spatial graph of semantic object instances is matched between candidate loop pairs, providing descriptor-level place recognition robust to viewpoint change.

Evaluated on KITTI and Ford Campus; significant improvement over LOAM baseline. SA-LOAM is explicitly a geometric quality system — it does not emphasise dynamic-object removal.

### SD-SLAM (Li et al., 2024)

**ArXiv:** https://arxiv.org/abs/2402.18318
**Journal (ScienceDirect 2024):** https://www.sciencedirect.com/science/article/abs/pii/S221457962400039X

Cross-reference: [SD-SLAM — Semantic Dynamic LiDAR](sd-slam-semantic-dynamic-lidar.md) provides the full treatment.

SD-SLAM extends SuMa++'s philosophy with three refinements: (1) **three-tier landmark classification** (dynamic / semi-static / pure static) via Kalman filter tracking of RangeNet++ clusters; (2) **class-weighted pose-graph factors** — pure-static landmarks at full weight, semi-static at reduced confidence; (3) **semantic-guided loop closure** via BoW3D restricted to the pure-static map subset to prevent false triggers from moved semi-static landmarks.

Benchmark evaluation: landmark classification achieves **F1 = 91%** distinguishing static from dynamic objects on KITTI odometry. Full ATE/RPE are in the journal version.

### SG-SLAM (IROS 2025)

**Paper:** "Leveraging Semantic Graphs for Efficient and Robust LiDAR SLAM"
**ArXiv:** https://arxiv.org/pdf/2503.11145
**Status:** Accepted IROS 2025; open source.

Dual-threaded LiDAR SLAM: one thread runs online odometry and relocalization; the other builds a semantic graph map and runs loop closure and pose graph optimisation. Avoids per-point semantic features (poor efficiency and generalisation) in favour of semantic graph nodes. Evaluated on KITTI, MulRAN, and Apollo. Directly comparable to the [Scan Context Family](scan-context-family.md) for descriptor-level place recognition, with the added benefit of semantic discrimination.

---

## 3D Scene-Graph Approaches

Scene graphs represent the environment as a **hierarchical semantic graph** rather than a flat point cloud or voxel volume. This family provides the strongest downstream usefulness for task planning and human-interpretable maps.

### Kimera DSG (ICRA 2020 + IJRR 2021)

**ArXiv (DSG / IJRR):** https://arxiv.org/abs/2101.06894

Three-layer semantic DSG: objects → places/rooms → buildings. Built on top of the Kimera-Semantics TSDF mesh. Foundational reference for the object-level SLAM family; see [Object-Level SLAM](object-level-slam.md).

### Hydra (RSS 2022)

Five-layer DSG with deformation-aware loop closure. See § Visual Semantic SLAM Lineage above. GitHub: https://github.com/MIT-SPARK/Hydra. Cross-reference: [Kimera-Multi](kimera-multi.md) for the multi-robot DSG extension.

### Khronos (RSS 2024)

**Paper:** "Khronos: A Unified Approach for Spatio-Temporal Metric-Semantic SLAM in Dynamic Environments"
**Authors:** Lukas Schmid, Marcus Abate, Yun Chang, Luca Carlone (MIT-SPARK)
**ArXiv:** https://arxiv.org/abs/2402.13817
**GitHub:** https://github.com/MIT-SPARK/Khronos
**Award:** Outstanding Systems Paper, RSS 2024, Delft.

Khronos addresses the full spatio-temporal SLAM problem, simultaneously handling **short-term dynamics** (actively moving objects in the current temporal window) and **long-term changes** (environment modifications across multiple sessions).

```
Fast process:  tracks short-term dynamics in active temporal window
               semantic labels detect inconsistencies (object present
               last visit, absent now -> change event)

Slow process:  factor graph for long-term change reasoning across sessions
               outputs a 4D spatio-temporal representation: each map
               element carries a temporal existence interval
```

**Relation to LT-mapper:** LT-mapper handles multi-session lifelong mapping via separate passes (LT-removert + scan addition). Khronos unifies short-term and long-term dynamics in a single framework. Cross-reference: [LT-Mapper / Khronos Lifelong Mapping](lt-mapper-khronos-lifelong-mapping.md).

### D-Lite / ConceptGraph / S-Graphs 2.0

**S-Graphs 2.0 (2025):**
**Paper:** "S-Graphs 2.0 — A Hierarchical-Semantic Optimization and Loop Closure for SLAM"
**Authors:** Bavle, Sanchez-Lopez, Shaheer, Civera, Voos
**ArXiv:** https://arxiv.org/abs/2502.18044
**IEEE Xplore:** https://ieeexplore.ieee.org/document/11197654/

Situational Graphs: four semantic layers — Keyframes, Walls, Rooms, Floors. Floor-level loop closure prevents false positives between visually similar areas on different floors. Hierarchical optimisation: floor-level global optimisation at loop closure; room-level local optimisation for ongoing operation. Efficiently marginalises redundant keyframes within a room while maintaining global consistency.

> **Uncertainty flag 5:** S-Graphs 2.0's four-layer hierarchy (Keyframes, Walls, Rooms, Floors) is designed for structured indoor buildings. Application to airside or outdoor environments would require redesign of the room/floor segmentation logic — the indoor assumption is structural, not incidental.

**SlideSLAM (arXiv 2024):**
**ArXiv:** https://arxiv.org/abs/2406.17249
**GitHub:** https://github.com/XuRobotics/SLIDE_SLAM

Object-level metric-semantic SLAM for multi-robot teams without GPS. Three abstraction levels: sparse landmark map (objects), mid-level geometry, low-level point cloud. Semantic-driven inter-robot place recognition: the object-level map is invariant to viewpoint and enables loop closure between heterogeneous platforms (aerial + ground). Joint back-end optimises robot trajectories and object landmark positions simultaneously. Cross-reference: [Distributed Multi-Robot PGO](distributed-multi-robot-pgo.md).

---

## Open-Vocabulary Semantic SLAM

Classic semantic SLAM uses a fixed, closed vocabulary (the C classes of a training dataset). **Open-vocabulary** systems replace discrete class vectors with continuous semantic embeddings from vision-language models (CLIP, DINO), enabling zero-shot queries using arbitrary text phrases. This directly addresses the closed-vocabulary ceiling for novel environments.

### OpenScene (Peng et al., CVPR 2023)

**Paper:** "OpenScene: 3D Scene Understanding with Open Vocabularies"
**Authors:** Songyou Peng, Kyle Genova, et al.
**ArXiv:** https://arxiv.org/abs/2211.15654
**GitHub:** https://github.com/pengsongyou/openscene

Distils CLIP features from multi-view RGB images into 3D point clouds. Per-3D-point feature vectors lie in CLIP space, enabling queries like "where is the fire extinguisher?" with zero-shot classification by text-embedding similarity. A sparse 3D conv network is trained to predict these features from geometry alone (geometry → CLIP distillation), so at inference the system does not require cameras.

**Relation to semantic SLAM:** OpenScene provides the **semantic front-end** (3D-point-level CLIP features) that replaces a fixed-vocabulary classifier in the per-frame fusion pipeline. Plugged into a geometric SLAM back-end, it produces an open-vocabulary semantic map. Cross-reference: [OpenScene](../../perception/methods/openscene.md), [LiDAR Semantic Segmentation](../../perception/overview/lidar-semantic-segmentation.md).

### ConceptFusion (RSS 2023)

**GitHub:** https://github.com/concept-fusion/concept-fusion
**Project:** https://concept-fusion.github.io/

Aggregates per-pixel CLIP features from multi-view RGB images into a 3D point cloud. Combines SAM (Segment Anything Model) with CLIP-based embeddings for region-level 3D comprehension. Enables multi-modal queries (text, click, image, audio). Outperforms supervised approaches by over 40% on 3D IoU for long-tail concepts.

**Distinction from OpenScene:** ConceptFusion operates at region level (SAM segments + CLIP embeddings) rather than dense-per-point. Semantic queries return spatial regions consistent with the query.

### ConceptGraphs (ICRA 2024)

**Paper:** "ConceptGraphs: Open-Vocabulary 3D Scene Graphs for Perception and Planning"
**ArXiv:** https://arxiv.org/abs/2309.16650
**Project:** https://concept-graphs.github.io/

Builds an open-vocabulary 3D scene graph from posed RGB-D image sequences. Per-frame: generic instance segmentation creates class-agnostic masks; CLIP features and LLM captions are extracted per segment; segments are projected to 3D and incrementally associated across views. Result: 3D object nodes with language descriptors and spatial relationship edges (derived via LLM). Enables planning queries expressed in natural language.

**Distinction from Hydra/Kimera:** Uses open-vocabulary language features rather than closed-set semantic segmentation. Does not require a fixed class set. Enables zero-shot scene-graph construction for novel environments.

> **Uncertainty flag 4:** ConceptGraphs was demonstrated on a workstation GPU. Runtime on Orin-class hardware was not reported in the paper. Treat as research-stage only for any real-time embedded deployment sections.

### Clio (IROS 2024)

Task-driven open-set 3D scene graph. Cited as real-time in the comprehensive semantic SLAM survey (arXiv:2505.12384). Positioned as a successor to ConceptGraphs with a real-time performance focus.

> **Uncertainty flag 2:** The full Clio author list, arXiv number, and paper URL were not retrieved in this research pass. Do not cite specific Clio numbers without confirming the full reference independently.

---

## Dynamic-Object Handling

Semantic SLAM provides the **primary pre-emptive signal** for identifying potentially movable map elements — acting before any geometric motion is observed. The three-tier taxonomy formalised in SD-SLAM and SuMa++ expresses the key insight:

| Tier | Criterion | Treatment |
|---|---|---|
| Actively dynamic | Movable semantic class AND high velocity residual (Kalman) | Exclude from pose-graph entirely |
| Semi-static | Movable semantic class, low velocity (stationary now) | Include at reduced confidence weight |
| Pure static | Terrain or structure class | Include at full weight |

**The semantic pre-emption advantage:** Geometry-only methods (ERASOR, FreeDOM) require the object to have displaced between frames before flagging it. Semantic SLAM flags a parked car as potentially problematic on first observation — before it moves. This reduces the burden on offline dynamic removal but cannot replace it.

**OOD / class-vocabulary ceiling:** A cardboard box, scaffold, FOD, or unknown vehicle type is invisible to semantic filtering — the system cannot flag what it cannot name. This is the fundamental limitation of closed-vocabulary semantic SLAM. Open-vocabulary systems partially address this by generalising to novel concepts, but reliable open-vocab 3D segmentation in real-time on embedded hardware remains research-stage in 2026.

Cross-references: [SD-SLAM](sd-slam-semantic-dynamic-lidar.md) §7 (quantitative SD-SLAM vs ERASOR comparison), [Dynamic-Object-Aware SLAM](dynamic-object-aware-slam.md).

---

## Lifelong Mapping and Semantic Change Detection

In multi-session lifelong mapping, semantic labels enable distinguishing **what kind of change** occurred — not just that something changed:

- **Appearance of a new vehicle** (semi-static class, high change priority): could move by next session → do not anchor map to it; flag as transient.
- **Appearance of a new fence** (structure class): likely permanent → incorporate into map with standard evidence threshold.
- **Disappearance of a structure-class element**: may indicate demolition or major construction → trigger human review.

Khronos implements this by assigning temporal existence intervals to map elements, tagged by semantic class. LT-mapper handles this at the static-map level via LT-removert (two passes: high-dynamic removal then low-dynamic removal), with semantics informing which elements are candidates for removal in each pass.

Cross-reference: [LT-Mapper / Khronos Lifelong Mapping](lt-mapper-khronos-lifelong-mapping.md) for full detail.

---

## Benchmarks

### KITTI Odometry (Geiger et al., 2012)

**URL:** http://www.cvlibs.net/datasets/kitti/
11 labelled sequences, Velodyne HDL-64E, urban and highway driving. Primary benchmark for LiDAR odometry and semantic LiDAR SLAM. SuMa++ reports relative translational error approximately 0.22–0.46% on highway sequences. SD-SLAM reports F1 = 91% landmark classification (full ATE/RPE in journal version).

### SemanticKITTI (Behley / Stachniss et al., ICCV 2019)

**PDF:** https://openaccess.thecvf.com/content_ICCV_2019/papers/Behley_SemanticKITTI_A_Dataset_for_Semantic_Scene_Understanding_of_LiDAR_Sequences_ICCV_2019_paper.pdf
**IJRR:** https://journals.sagepub.com/doi/abs/10.1177/02783649211006735
**Tasks:** https://semantic-kitti.org/tasks.html

43,000+ annotated scans, 28 semantic classes, point-level ground truth on all KITTI odometry sequences. Three benchmark tasks: (1) semantic segmentation (single-scan, multi-scan); (2) semantic scene completion; (3) panoptic segmentation. The **Moving Object Segmentation (MOS)** task provides binary moving/not-moving labels on sequences 11–21, directly benchmarking the semantic front-end quality required by SD-SLAM and SuMa++.

**Metrics relevant to semantic SLAM:** mIoU on semantic segmentation; mIoU (moving / not-moving) on MOS task; ATE on SLAM odometry evaluated separately.

Cross-reference: [Large-Scale 3D Segmentation Benchmarks](../../perception/datasets-benchmarks/large-scale-3d-segmentation-benchmarks.md).

### nuScenes

**URL:** https://www.nuscenes.org/
Multi-sensor (LiDAR + 6 cameras + radar), 1000 driving scenes, Boston and Singapore. 23 semantic classes. Used for panoptic segmentation and open-vocabulary 3D segmentation benchmarks. Less common for SLAM trajectory evaluation (GPS-dense) but used for semantic map quality evaluation.

### ScanNet (Dai et al., CVPR 2017)

**URL:** http://www.scan-net.org/
1,513 RGB-D indoor scenes, 2.5M views, 3D camera poses, surface reconstructions, instance-level semantic segmentations. Primary benchmark for RGB-D and end-to-end semantic SLAM (SemanticFusion, Kimera-Semantics, SNI-SLAM). Metrics: semantic label accuracy on reconstructed 3D mesh; instance segmentation IoU; 3D bounding box IoU.

**ScanNet++ (2023):** https://arxiv.org/abs/2308.11417 — high-fidelity successor with DSLR reference images and structured-light depth.

### Key Metrics Summary

| Metric | Task | Used in |
|---|---|---|
| ATE (Absolute Trajectory Error) | Pose estimation quality | All SLAM systems; KITTI odometry |
| RPE (Relative Pose Error) | Drift per distance | KITTI, SLAM odometry |
| mIoU (semantic seg.) | Segmentation quality on map | SemanticKITTI, ScanNet |
| PQ (Panoptic Quality) | Combined semantic + instance quality | nuScenes, ScanNet, SemanticKITTI-panoptic |
| mIoU (MOS) | Moving-object detection accuracy | SemanticKITTI MOS benchmark |
| Map label accuracy | Accuracy of per-voxel labels in final map | ScanNet (SemanticFusion, Kimera) |
| PR / RR / F1 | Dynamic point preservation / rejection | DynamicMap Benchmark (KTH-RPL) |

---

## Strengths, Weaknesses, Failure Modes by Axis

### Axis A — Per-Frame Label Fusion (SemanticFusion, SuMa++, Kimera-Semantics)

| Axis | Assessment |
|---|---|
| Real-time feasibility | High — decoupled: geometry SLAM runs at full rate; segmentation can be async |
| Label dependency | Moderate — per-frame labels noisy; Bayesian fusion over many frames smooths noise |
| Class generalisation | Poor for OOD classes; bounded by training distribution |
| Downstream usability | Moderate — voxel/surfel maps are geometric-first; semantic queries require volumetric lookup |
| Dynamic handling | Good for known dynamic classes via SuMa++ consistency checking |
| Compute on embedded | Feasible with FRNet/SalsaNext; MinkNet variants too slow for Orin at 10 Hz without INT8 |

**Primary failure modes:**
- Segmentation degradation in rain, fog, dust: noisy labels propagate to map
- Domain shift from training corpus: systematic mislabelling of entire object classes
- Object boundary bleeding: Bayesian fusion blurs labels across voxels at class boundaries
- Label flickering in dynamic scenes: fast-moving objects produce mixed labels in the map
- Projection errors from calibration or timing mistakes smear labels into wrong 3D cells

### Axis B — Scene-Graph Approaches (Kimera, Hydra, Khronos, S-Graphs)

| Axis | Assessment |
|---|---|
| Real-time feasibility | Moderate — object detection/tracking is additional cost; higher layers run slower |
| Label dependency | High — node types and relations determined by instance segmentation quality |
| Class generalisation | Moderate — object detectors can be swapped; new classes require new node-type logic |
| Downstream usability | Excellent — graph structure directly supports task planning, semantic queries, spatial reasoning |
| Dynamic handling | Strong — Khronos explicitly tracks object temporal existence |
| Compute on embedded | Moderate to high — Hydra runs on NVIDIA systems; Orin deployment feasible but not trivial |

**Primary failure modes:**
- Instance association failures in cluttered scenes (multiple objects merged or fragmented)
- False room segmentation in open-plan spaces (industrial halls, airports)
- Loop closure on the scene graph can catastrophically reorganise the graph on false positive
- S-Graphs 2.0 room/floor hierarchy breaks down in outdoor or open airside environments

### Axis C — Joint Factor-Graph Optimisation (SA-LOAM, SlideSLAM, S-Graphs)

| Axis | Assessment |
|---|---|
| Real-time feasibility | Moderate — iSAM2/GTSAM with incremental updates maintains real-time |
| Label dependency | High — semantic observation factors require reliable object-level data association |
| Class generalisation | Moderate — object models need class-specific parameterisation |
| Downstream usability | High — joint optimisation yields semantically consistent, globally optimised maps |
| Dynamic handling | Dependent on explicit dynamic-object tracking as a separate factor type |
| Compute on embedded | Moderate — factor graph scale grows with number of landmark objects |

Failure modes: data association errors compound (wrong object match creates wrong semantic factor); overconfident semantic factors bias the pose graph under domain shift; memory grows with trajectory length without aggressive marginalisation.

### Axis D — End-to-End Neural Semantic SLAM (SNI-SLAM, NeRF-SLAM)

| Axis | Assessment |
|---|---|
| Real-time feasibility | Low — NeRF/Gaussian backpropagation is 10-100x slower than geometric SLAM |
| Label dependency | None (joint training) or low (2D supervision only) |
| Class generalisation | High — implicit representations learn appearance features jointly |
| Downstream usability | Moderate — dense semantic map but not directly queryable as geometry |
| Dynamic handling | Research stage — DyNeRF, D3DGS address dynamic rendering |
| Compute on embedded | Not suitable for Orin-class deployment in 2026 |

> **Uncertainty flag 6:** The 2025 survey (arXiv:2505.12384) qualitatively assessed NeRF/GS as too compute-heavy for embedded deployment; specific Orin fps numbers require full paper access.

See [Splat-SLAM](splat-slam.md) and [GigaSLAM](gigaslam.md) for the Gaussian-splatting SLAM family.

---

## Domain Fit

| Domain | Best-fit semantic SLAM approach | Notes |
|---|---|---|
| LiDAR-primary, outdoor, busy dynamic scene (road AV, airside apron) | SuMa++ or SD-SLAM style (Axis A + dynamic filtering) | Best real-time balance on Orin; domain-adapted segmentation model required |
| Indoor structured (warehouse, airport terminal) | S-Graphs 2.0 or Kimera-Semantics | Room/wall/floor hierarchy matches building structure; S-Graphs handles multi-floor loop closure |
| Multi-robot fleet, GPS-denied, heterogeneous platforms | SlideSLAM or Hydra | Object-level map enables inter-robot place recognition; shared semantic map format |
| Offline map enrichment after aggregation | OpenScene / ConceptFusion applied to static map | Zero-shot class assignment on clean point cloud; no real-time constraint |
| Long-term / multi-session scene understanding | Khronos | Unified short-term + long-term dynamic handling; requires Hydra stack |
| Constrained embedded, CPU-only | Voxblox++ with lightweight segmentation | CPU-runnable TSDF; sacrifice model accuracy for compute |
| Mining, port, logistics yard | SuMa++ Axis A with custom vocabulary | ISO 3691-4 domains; airside-equivalent actor taxonomy for GSE/vehicle/person classes |
| Open-vocabulary novel environments | ConceptFusion or ConceptGraphs (offline) | Research-stage for real-time embedded; appropriate for map enrichment passes |

---

## For Aggregated LiDAR Map Building

For the aggregated-LiDAR-map building production pipeline, semantic SLAM provides three layered contributions:

1. **Per-frame cloud filtering** — removes dynamic-class points before aggregation, reducing offline clean-up load (ERASOR / FreeDOM workload on residual ghosts).
2. **Per-element semantic labels in the aggregated map** — each point in the final static map carries a class label, enabling: class-conditioned filtering (keep only `road` + `building` for HD map); auto-labelling of new scans against the labelled prior map; per-class quality gates (variance on `road` vs `vegetation` class).
3. **Semantic change detection across sessions** — detecting when a structure-class element has disappeared (demolition) vs a vehicle-class element has disappeared (drove away) triggers different map update policies.

**Production layered pipeline:**

```
Online stage (10 Hz LiDAR):
  SuMa++ / SD-SLAM  ->  clean dynamic-filtered frames + per-frame labels

Aggregation:
  ERASOR / FreeDOM  ->  remove residual ghosts

Lifelong:
  LT-mapper / Khronos  ->  multi-session change management

Semantic map output:
  per-point labels feed auto-labelling flywheel (hub §10)
  class-conditioned maps for HD map production (hub §12)
```

**Relationship to offline aggregated-map segmentation:** These are complementary, not competing. Semantic SLAM ("segment-then-accumulate") produces a per-voxel class histogram that the [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) pipeline ("accumulate-then-segment") fuses as an extra unary term — disagreement regions are exactly what to route to human review. Run both: semantic SLAM for the online prior and live map QA; the offline pipeline for the authoritative semantic layer and back-projected auto-labels.

**Airside note:** GSE, tow vehicles, aircraft, and ground crews are the airside-equivalent of `car / person / cyclist`. ISO 3691-4 compliance for driverless vehicles (warehouse, ports, airside) requires robust identification of dynamic actors — semantic SLAM is the enabling subsystem, but the segmentation model must be fine-tuned on domain-specific data.

---

## Implementation Notes

- **Segmentation backbone selection** governs all downstream label quality. LiDAR: FRNet or SalsaNext for Orin feasibility (INT8, ~6–10 ms); MinkNet variants exceed Orin's 100 ms cycle budget at 10 Hz without INT8. Camera: any real-time 2D segmenter (DeepLabV3+, SegFormer-B0) if calibration is tight.
- **Decoupled before coupled** — integrate semantics as a map enrichment layer first (Axis A); only add semantic factors to the pose graph (Axis C) after measuring prediction reliability on target-domain data.
- **Domain adaptation mandatory** for non-KITTI deployments. RangeNet++/SemanticKITTI vocabulary does not include aircraft, jet bridges, baggage carts, reach stackers, or straddle carriers. Fine-tuning on 500–1,000 labelled frames with LoRA/PointLoRA is a practical entry point.
- **Lifecycle policy** — without explicit management, the semantic map fills with semi-static ghosts. Implement confidence thresholds (minimum N observations), temporal expiry for movable-class elements, and cross-session evidence gates before promoting any element to the static map.
- **Export format** — prefer per-voxel class histograms in compressed (top-k) form over raw per-point labels for the offline pipeline interface; version through `semantic_map_manifest.json` with pose-graph digest, calibration hash, and uncertainty summary.
- **License review** — Kimera-Semantics, Hydra, and Khronos are MIT-SPARK open-source. Systems extending ORB-SLAM2/3 inherit GPL terms. RangeNet++ uses DarkNet-53 with separate licensing. Check CLIP model weight licenses for open-vocabulary systems.

---

## Honest Uncertainty Flags

The following items require verification before citing specific numbers in production documentation:

1. **Voxblox++ precise citation:** The "Voxblox++" label circulates in the community but the primary canonical publication is Grinvald et al. RAL+IROS 2019 "Volumetric Instance-Aware Semantic Mapping and 3D Object Discovery." Confirm the arXiv number before citing.

2. **Clio (IROS 2024) full reference:** Identified as a real-time open-set 3D scene graph. The full author list, arXiv number, and paper URL were not retrieved in this research pass. Do not cite specific Clio numbers without confirming independently.

3. **SuMa++ dynamic class IDs:** The exact SemanticKITTI class IDs used in the dynamic-consistency check are in the full paper PDF. The confirmed behaviour is semantic consistency checking per-surfel; the specific class subset is not confirmed from the abstract alone.

4. **ConceptGraphs runtime on embedded hardware:** Demonstrated on workstation GPU; runtime on Orin-class hardware was not reported. Flag as research-stage only for any real-time embedded deployment sections.

5. **S-Graphs 2.0 is indoor-specific:** Its four-layer hierarchy (Keyframes, Walls, Rooms, Floors) is designed for structured indoor buildings. Application to airside or outdoor environments would require fundamental redesign of room/floor segmentation logic.

6. **NeRF/3DGS semantic SLAM runtime on Orin:** The 2025 embedded-systems survey (arXiv:2505.12384) qualitatively assessed NeRF/GS as too compute-heavy for embedded deployment. Specific Orin fps numbers require full paper access. The qualitative conclusion (not suitable for Orin in 2026) is confirmed.

---

## Sources

- McCormac et al. "SemanticFusion: Dense 3D Semantic Mapping with CNNs." ICRA 2017. https://arxiv.org/abs/1609.05130
- Rünz & Agapito. "MaskFusion: Real-Time Recognition, Tracking and Reconstruction of Multiple Moving Objects." ISMAR 2018. https://arxiv.org/abs/1804.09194
- Oleynikova et al. "Voxblox: Incremental 3D Euclidean Signed Distance Fields." IROS 2017. https://helenol.github.io/publications/iros_2017_voxblox.pdf
- Rosinol et al. "Kimera: an Open-Source Library for Real-Time Metric-Semantic Localization and Mapping." ICRA 2020. https://arxiv.org/abs/1910.02490
- Rosinol et al. "Kimera: from SLAM to Spatial Perception with 3D Dynamic Scene Graphs." IJRR 2021. https://arxiv.org/abs/2101.06894
- Hughes, Chang, Carlone. "Hydra: A Real-time Spatial Perception System for 3D Scene Graph Construction." RSS 2022. https://arxiv.org/pdf/2201.13360
- Hughes et al. "Foundations of Spatial Perception for Robotics." IJRR 2024. https://journals.sagepub.com/doi/10.1177/02783649241229725
- Schmid et al. "Khronos: A Unified Approach for Spatio-Temporal Metric-Semantic SLAM." RSS 2024. https://arxiv.org/abs/2402.13817
- Chen et al. "SuMa++: Efficient LiDAR-based Semantic SLAM." IROS 2019. https://arxiv.org/abs/2105.11320
- Dubé et al. "SegMap: Segment-based mapping and localization using data-driven descriptors." IJRR 2020. https://journals.sagepub.com/doi/abs/10.1177/0278364919863090
- Li et al. "SA-LOAM: Semantic-aided LiDAR SLAM with Loop Closure." ICRA 2021. https://arxiv.org/abs/2106.11516
- Li et al. "SD-SLAM: A Semantic SLAM Approach for Dynamic Scenes Based on LiDAR Point Clouds." IoT 2024. https://arxiv.org/abs/2402.18318
- SG-SLAM. "Leveraging Semantic Graphs for Efficient and Robust LiDAR SLAM." IROS 2025. https://arxiv.org/pdf/2503.11145
- Bavle et al. "S-Graphs 2.0 — A Hierarchical-Semantic Optimization and Loop Closure for SLAM." 2025. https://arxiv.org/abs/2502.18044
- SlideSLAM. "Sparse, Lightweight, Decentralized Metric-Semantic SLAM for Multi-Robot Navigation." arXiv 2024. https://arxiv.org/abs/2406.17249
- Peng et al. "OpenScene: 3D Scene Understanding with Open Vocabularies." CVPR 2023. https://arxiv.org/abs/2211.15654
- ConceptFusion. "Open-set Multimodal 3D Mapping." RSS 2023. https://concept-fusion.github.io/
- ConceptGraphs. "Open-Vocabulary 3D Scene Graphs for Perception and Planning." ICRA 2024. https://arxiv.org/abs/2309.16650
- Behley et al. "SemanticKITTI: A Dataset for Semantic Scene Understanding of LiDAR Sequences." ICCV 2019. https://semantic-kitti.org/tasks.html
- Dai et al. "ScanNet: Richly-annotated 3D Reconstructions of Indoor Scenes." CVPR 2017. http://www.scan-net.org/
- Semantic SLAM comprehensive survey. arXiv:2505.12384. https://arxiv.org/html/2505.12384v1
- Yu et al. "DS-SLAM: A Semantic Visual SLAM towards Dynamic Environments." IROS 2018. https://arxiv.org/abs/1809.08379
- Nadgir, Marques, Hauser. "Memory-Efficient Real Time Many-Class 3D Metric-Semantic Mapping." IROS 2025. https://motion.cs.illinois.edu/papers/IROS2025-Nadgir-CompressedSemanticMapping.pdf
- Local context: [Semantic Mapping and Learned Priors](../maps/semantic-mapping-learned-priors.md)
- Local context: [Gaussian Splatting for Driving](../../perception/overview/gaussian-splatting-driving.md)
