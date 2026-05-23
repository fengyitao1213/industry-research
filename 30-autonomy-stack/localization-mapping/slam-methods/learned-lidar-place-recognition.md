# Learned LiDAR Place Recognition

<!-- method-priority:start
priority:
  learning: 5
  deployment: 4
  type: "architecture-pattern"
  stage: "foundation"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "runtime-localization", "validation"]
  reason: "Learned LiDAR Place Recognition is rated for foundational SLAM modeling, optimization, registration, or mapping concepts."
method-priority:end -->

Related docs: [Scan Context Family](scan-context-family.md), [Loop Closure and Place Recognition](loop-closure-place-recognition.md), [BEV-LIO(LC)](bev-lio-lc.md), [LiDAR map cleaning](lidar-map-cleaning-dynamic-removal.md), and [GraphSLAM and Pose Graph Optimization](graphslam-pose-graph-optimization.md).

**Last updated:** 2026-05-23

---

## What It Is

Learned LiDAR place recognition (PR) is the task of determining, from a query LiDAR scan, which previously mapped location it most closely corresponds to. Given a query scan `q` and a geo-tagged database `D = {(s_i, p_i)}` of collected scans paired with known 6-DoF or GPS poses `p_i`, the system finds the database entry whose pose is geographically nearest to the query's true pose.

This is a **retrieval problem**, not a pose-estimation problem. The canonical pipeline has four stages:

1. **Descriptor extraction** — encode each raw scan (or accumulated submap) into a compact, fixed-length global descriptor vector `d in R^n`. A learned backbone maps the point cloud to this vector end-to-end.
2. **Nearest-neighbor (NN) search** — at query time, compute L2 or cosine distance between `d_query` and all `d_i` in the database; find top-K candidates. FAISS or similar approximate nearest-neighbor (ANN) libraries handle million-entry databases in under 10 ms. See also: [`../../../10-knowledge-base/geometry-3d/correspondence-search-data-structures.md`](../../../10-knowledge-base/geometry-3d/correspondence-search-data-structures.md) for kNN structures in descriptor space.
3. **Top-K retrieval** — return candidates ranked by embedding distance. Recall@K is the primary evaluation metric: the fraction of queries for which at least one of the K returned candidates is a true positive (within a defined geographic distance threshold).
4. **Geometric verification (re-ranking)** — run ICP or feature-based RANSAC between the query scan and each candidate to estimate a 6-DoF transform; accept if inlier ratio exceeds a threshold, reject false positives. Verified candidates provide a pose seed for downstream localization.

The method sits at the interface between map building and runtime localization: it is the retrieval layer that feeds loop-closure edges into pose-graph SLAM systems ([KISS-ICP](kiss-icp.md), [FAST-LIO/FAST-LIO2](fast-lio-fast-lio2.md), [LIO-SAM](lio-sam.md)) and enables global re-localization in pre-built maps. It is also the inter-session anchor step for the aggregated-map build pipeline described in [`../../perception/overview/aggregated-map-semantic-segmentation.md`](../../perception/overview/aggregated-map-semantic-segmentation.md).

---

## Core Technical Idea

### The Deep-Learning Shift

Classical LiDAR place recognition relied on handcrafted global descriptors: maximum-height polar histograms (Scan Context), FPFH bag-of-words, or segment-level autoencoders (SegMap). These methods work from fixed design decisions about what is "salient" in a scene. Their structural weaknesses:

- They do not learn scene-discriminative features; the descriptor design fixes what the network can see.
- They degrade under seasonal or weather changes not anticipated at design time.
- They do not generalise across LiDAR sensor models — a descriptor computed on a 64-beam scanner differs in structure from one on a 32-beam scanner.

The deep-learning paradigm replaces the hand-designed descriptor with an end-to-end learned mapping:

```
f_theta: scan -> d in R^n
```

trained so that descriptors of the **same place** are similar (small L2 distance) and descriptors of **different places** are dissimilar (large L2 distance). This is metric learning: the loss function directly shapes the geometry of the embedding space.

### Canonical Architecture Block

```
Raw scan (N x 3 or N x 4 with intensity)
        |
  [3D Backbone]         <- sparse-conv (MinkowskiNet) /
        |                  PointNet++ / transformer
  Local feature map
        |
  [Global Pooling]      <- NetVLAD / GeM / MAC / second-order
        |
  Global descriptor d in R^n  (L2-normalised)
        |
  [Metric learning loss]  <- triplet / contrastive / quadruplet
```

The backbone extracts local per-point or per-voxel features that capture local geometric structure. The pooling layer aggregates these into a single fixed-length vector that is invariant to the number of input points. The metric loss shapes the embedding space during training.

---

## Operator Mechanics

### Global Pooling Methods

**NetVLAD** (Arandjelovic et al. 2016, applied to LiDAR in PointNetVLAD):

For K cluster centres `{c_k}`, the VLAD vector is:

```
V(j, k) = sum_i  a_k(x_i) * (x_i(j) - c_k(j))
```

where `a_k(x_i)` is the soft assignment of local descriptor `x_i` to cluster `k`, computed via softmax over distances to each cluster centre. The full descriptor is the concatenation of K residual vectors `V(:, k)`, L2-normalised per cluster then globally. Dimensionality: K × D (e.g. 32 × 32 = 1024-d). NetVLAD is expressive but the VLAD quantisation step is lossy and the cluster centres must be initialised from the training data.

**GeM pooling** (Radenovic et al. 2018, adopted by MinkLoc3D):

```
f = (1/|X| * sum_i  x_i^p)^(1/p)
```

where `p` is a learnable parameter initialised at p = 3. At p → infinity reduces to max-pooling; at p = 1 reduces to average-pooling. Produces a compact, single-level descriptor with good retrieval properties and no cluster-centre quantisation. Simpler than NetVLAD and empirically more discriminative for the retrieval task.

**MAC pooling** (maximum activation of convolutions): selects the maximum activation per channel from a spatial feature map, producing a compact vector that captures the most salient local response. Less commonly used in LiDAR PR than in image retrieval.

**Second-order pooling** (LoGG3D-Net): outer product of the mean local feature vector with itself, followed by eigenvalue power normalisation. Captures feature co-occurrence statistics; more expressive than first-order pooling for fine-grained geometric discrimination.

### Metric Learning Losses

**Lazy triplet loss** (used in PointNetVLAD):

```
L_triplet = max(0, m + d(q, p) - d(q, n))
```

where `q` = query, `p` = positive (same place, within threshold), `n` = hard negative (different place), `m` = margin. "Lazy" means the loss only back-propagates through the hardest negative in the batch, avoiding trivial zero-loss triplets that contribute no gradient.

**Quadruplet loss** (PointNetVLAD extension): adds a second term penalising the proximity of two randomly chosen negative descriptors `(n1, n2)`:

```
L_quad = L_triplet + max(0, m2 + d(q, p) - d(n1, n2))
```

This encourages the negative embeddings to be spread apart, improving global embedding geometry.

**InfoNCE / contrastive variants**: treat every other sample in the batch as a negative. Enables large-batch training with many negatives per gradient step, stabilising training significantly. Used in more recent work (2022+).

### Distance Metric and Database Lookup

Descriptors are L2-normalised after training, so cosine distance and L2 distance are equivalent. At retrieval time, L2 distance is computed via FAISS IndexFlatL2 or IndexIVFFlat (approximate). A match is accepted as a true positive if the database candidate's ground-truth pose is within a dataset-defined threshold of the query's ground-truth pose (25 m for Oxford RobotCar; 10 m for MulRan; 3 m for Wild-Places).

---

## Inputs and Outputs

**Inputs:**
- Single LiDAR scan or accumulated local submap (N × 3 points, optionally N × 4 with intensity or N × 5 with range).
- For range-image methods (OverlapTransformer): cylindrical range image (H × W, where H = number of laser beams, W = azimuth resolution).
- For BEV methods (BEVPlace++): top-down projection of height or density (H_bev × W_bev).
- Training: sets of scan triplets with place-label supervision (GPS or ground-truth trajectory within threshold distance).

**Outputs:**
- Compact place descriptor `d in R^n` (typically n = 256 or n = 512), L2-normalised.
- Top-K database candidates ranked by embedding distance.
- For joint-learning methods (EgoNN, BEVPlace++): optional 3-DoF or 6-DoF coarse pose estimate from the same forward pass.
- Downstream: a candidate loop-closure or re-localization measurement for a SLAM backend; the actual accepted constraint is produced only after geometric verification.

---

## Architecture Lineage

### Classical Baselines

**Scan Context** (Kim and Kim, IROS 2018): encodes a scan as a 2D azimuth × ring polar grid where each bin stores the maximum height of points within it. Rotation invariance via column-shift matching (ring key for first-stage retrieval, brute-force shift for re-scoring). Fast (<10 ms on CPU), no training. Key limitation: no elevation or density encoding; fails when viewpoint elevation changes or in structurally repetitive environments (long corridors, uniform runways). See [`./scan-context-family.md`](scan-context-family.md) for full treatment.

**SegMap** (Dubé et al., RSS 2018 / IJRR 2020): segments the point cloud into 3D clusters (buildings, vehicles, trees) and encodes each segment with a compact autoencoder descriptor; retrieves by segment matching. Achieves up to 50% reduction in open-loop odometry drift via loop closures. Fails in unstructured environments (open tarmac, farmland) with few segmentable objects.

**FPFH-based global descriptors**: Fast Point Feature Histograms describe local geometry around each point; global descriptors are formed by Bag-of-Words or VLAD aggregation over FPFH. Computationally expensive for full-scan retrieval; sensitive to point density and noise; no learning.

**Limits of handcrafted approaches**: fixed descriptor design, no generalisation to sensor models not envisioned at design time, no learning from data, no adaptation to scene statistics.

---

### Foundational Learned Methods

#### PointNetVLAD (CVPR 2018)
**Authors:** Mikaela Angelina Uy, Gim Hee Lee.
**Paper:** [arXiv:1804.03492](https://arxiv.org/abs/1804.03492) · **Code:** [github.com/mikacuy/pointnetvlad](https://github.com/mikacuy/pointnetvlad)

The first widely adopted end-to-end learned LiDAR global descriptor. Uses a PointNet backbone (shared MLP per point, global max-pool for permutation invariance) followed by a NetVLAD aggregation layer, producing a 256-d descriptor. Trained with lazy triplet and quadruplet losses on the Oxford RobotCar LiDAR splits — splits that later papers uniformly adopted as the standard evaluation protocol.

Weaknesses: PointNet's global max-pool discards local spatial structure; performance plateaus on difficult viewpoint or weather changes; architecture scales poorly to large point counts (capped at 4096 points per scan to avoid memory explosion). Recall@1 on Oxford RobotCar: ~80% (baseline split), ~92% (refined split).

#### PCAN — Point Contextual Attention Network (CVPR 2019)
**Paper:** [arXiv:1904.09793](https://arxiv.org/abs/1904.09793) · **Code:** [github.com/XLechter/PCAN](https://github.com/XLechter/PCAN)

Direct extension of PointNetVLAD using a learned attention map over local point features to weight their contributions to the NetVLAD aggregation. Built on PointNet++, which captures local neighbourhoods hierarchically. The attention mechanism forces the network to focus on geometrically salient, task-relevant regions (corners, edges) rather than flat surfaces that are discriminatively useless. Improves Recall@1 over PointNetVLAD on all Oxford and in-house splits. Established attention-augmented VLAD as a standard pattern for subsequent work.

#### MinkLoc3D (WACV 2021) and MinkLoc3D-V2 (WACV 2022)
**Paper:** [arXiv:2011.04530](https://arxiv.org/abs/2011.04530) · **Code:** [github.com/jac99/MinkLoc3D](https://github.com/jac99/MinkLoc3D) / [jac99/MinkLoc3Dv2](https://github.com/jac99/MinkLoc3Dv2)

The key architecture shift: replaces PointNet with a **sparse voxel backbone** (MinkowskiEngine-based 3D sparse ResNet/UNet). The input scan is voxelised (typical voxel size 0.2 m); only occupied voxels are stored and processed by sparse convolutions, giving O(occupied voxels) compute rather than O(grid volume). A feature pyramid aggregates multi-scale features; GeM pooling compresses the per-voxel feature map to a single descriptor (256-d or 512-d).

Why the jump? Sparse convolutions natively capture local geometric structure (walls, edges, lamp posts) that global max-pooling in PointNet suppresses. GeM pooling is more discriminative than NetVLAD for the retrieval task because it avoids the lossy VLAD quantisation step.

Recall@1 on Oxford RobotCar:
- MinkLoc3D: ~97.9% (baseline split), ~98.5% (refined split) — large margin over PointNetVLAD.
- MinkLoc3D-V2: >99% on the refined Oxford split with ranking-based loss and larger batches.

**MinkLoc3D-SI** (IEEE Transactions 2022): adds spherical coordinate encoding and intensity as a fourth channel, improving performance on MulRan (Korean urban environments).

---

### Transformer-Based Methods (2021–2023)

#### TransLoc3D (arXiv 2021 / 2022)
**Paper:** [arXiv:2105.11605](https://arxiv.org/abs/2105.11605)

Combines **adaptive receptive field** blocks (deformable convolution-inspired) with **external attention** (efficient global attention, O(N) rather than O(N²)). Multi-scale features from different receptive field sizes are fused via a learned attention map, then aggregated with NetVLAD. Addresses the fact that informative geometric structures in outdoor LiDAR scans vary dramatically in scale (a building vs. a bollard).

#### OverlapTransformer (RA-L / IROS 2022)
**Paper:** [arXiv:2203.03397](https://arxiv.org/abs/2203.03397) · **Code:** [github.com/haomo-ai/OverlapTransformer](https://github.com/haomo-ai/OverlapTransformer)

Takes a **range-image** representation (cylindrical projection, height × azimuth) and processes it through a lightweight transformer to capture long-range azimuthal context while being inherently yaw-invariant. Inference < 2 ms per frame on a standard GPU — fast enough for real-time loop closure. Evolved from OverlapNet (2021), which predicted pairwise scan overlap using a Siamese network; OverlapTransformer replaces pairwise inference with a single-pass global descriptor.

#### EgoNN (RA-L 2022)
**Code:** [github.com/jac99/Egonn](https://github.com/jac99/Egonn)

Targets city-scale 6-DoF re-localization, not just place retrieval. Jointly learns (a) a global descriptor for retrieval (GeM pooling over sparse conv features) and (b) a set of **keypoints** with associated local descriptors for 6-DoF pose estimation via feature matching + RANSAC. Keypoint extraction fails in unstructured environments (forests, open tarmac) with no repeatable geometric corners or edges — success rate drops to ~68.7% in dense forest.

#### LoGG3D-Net (ICRA 2022)
**Paper:** [arXiv:2109.08336](https://arxiv.org/abs/2109.08336) · **Code:** [github.com/csiro-robotics/LoGG3D-Net](https://github.com/csiro-robotics/LoGG3D-Net)

Key innovation: the **local consistency loss**. For each pair of scans at the same place, after finding point-to-point correspondences (using ground-truth relative pose), maximise cosine similarity between corresponding points' local features and minimise similarity between non-corresponding points. This forces the backbone to produce locally repeatable features even across revisits from slightly different viewpoints — a stronger signal than triplet loss alone. Architecture: SparseConv U-Net backbone; second-order pooling followed by eigenvalue power normalisation. Results: F1_max 0.939 on KITTI, 0.968 on MulRan — SOTA at time of publication.

#### CASSPR — Cross Attention Single Scan Place Recognition (ICCV 2023)
**Paper:** [arXiv:2211.12542](https://arxiv.org/abs/2211.12542) · **Code:** [github.com/Yan-Xia/CASSPR](https://github.com/Yan-Xia/CASSPR)

Dual-branch architecture: (1) a **sparse voxel branch** for multi-scale spatial context, (2) a **point-wise branch** for fine-grained local detail. A **hierarchical cross-attention transformer (HCAT)** fuses the two branches: voxel features query point features and vice versa. Softmax attention replaced by cosine-similarity with positional encoding — up to 91% memory reduction, 62% time reduction vs. standard self-attention. Recall@1 ~85.6% on TUM dataset, ~15% above prior SOTA at time of publication.

#### BoxNet
Sparse voxel backbone with box-level attention pooling. Explores using object-level spatial context (bounding-box proposals over sparse features) as the pooling basis for the global descriptor. Less commonly adopted than CASSPR but illustrates the trend of combining detection-style spatial priors with retrieval descriptors.

---

### 2024–2026 SOTA Methods

#### BEVPlace / BEVPlace++ (ICCV 2023 / T-RO 2025)
**Papers:** [arXiv:2302.14325](https://arxiv.org/abs/2302.14325) / [arXiv:2408.01841](https://arxiv.org/abs/2408.01841) · **Code:** [github.com/zjuluolun/BEVPlace2](https://github.com/zjuluolun/BEVPlace2)

Converts LiDAR to a Bird's Eye View (BEV) image (top-down projection of height or density), then applies **group convolution** for rotation-equivariant local feature extraction and NetVLAD for a rotation-invariant global descriptor. BEVPlace++ (T-RO 2025) extends to full 3-DoF pose estimation after retrieval: a Rotation Equivariant and Invariant Network (REIN) cascades equivariant features with NetVLAD. Trained with only 3000 KITTI frames; generalises to seven public datasets. Lightweight: runs real-time. Strong fit for ground vehicles where vertical variation is minimal and BEV projection is information-lossless. Vertical discriminative structure (e.g. tall buildings) is discarded by the BEV projection — a limitation in environments where height variation is the primary discriminative cue.

#### SALSA — Swift Adaptive Lightweight Self-Attention (arXiv July 2024)
**Paper:** [arXiv:2407.08260](https://arxiv.org/abs/2407.08260)

**Sphereformer backbone** + adaptive self-attention pooling. The Sphereformer uses **radial window attention** that scales attention window size with distance from the sensor origin, addressing the density fall-off problem in long-range LiDAR. An adaptive self-attention layer pools local descriptors into a small set of scene tokens, and an MLP Mixer aggregates tokens into the final descriptor. The local descriptors are also used for geometric re-ranking. Real-time capable; outperforms prior SOTA on multiple PR datasets.

#### SOLiD — Spatially Organised and Lightweight Global Descriptor (RA-L 2024 / ICRA 2025)
**Repo:** [github.com/sparolab/solid](https://github.com/sparolab/solid)

Designed specifically for **FOV-constrained LiDARs** (solid-state, non-repetitive scanning patterns, limited FOV). Traditional descriptors built on full 360° scans fail when only a partial hemisphere is scanned. SOLiD builds a spatially organised histogram in both azimuth and elevation that is valid under partial-FOV conditions. Integrates with existing LiDAR odometry systems; handles intra-session loop closure, inter-session re-localization, and multi-robot scenarios.

#### HOTFormerLoc (CVPR 2025)
**Paper:** [arXiv:2503.08140](https://arxiv.org/abs/2503.08140)

**Hierarchical Octree Transformer** for place recognition across both ground and aerial viewpoints. Uses an octree-based multi-scale attention mechanism with cylindrical attention windows (matching the radial density distribution of spinning LiDAR). Introduces **relay tokens** for global-local information exchange across octree levels, reducing O(N²) attention to manageable complexity. Introduces the **CS-Wild-Places** dataset with aerial + ground LiDAR scan pairs in forests. Averages +4.9% over prior SOTA across urban and forest benchmarks; +5.5%–11.5% top-1 recall on CS-Wild-Places. Relevant for airside applications where drone-based survey scans might be matched to ground-vehicle operational scans.

#### GeoAdapt — Self-Supervised Test-Time Adaptation (RA-L November 2023)
**Paper:** [arXiv:2308.04638](https://arxiv.org/abs/2308.04638)

Not a new descriptor architecture but a **domain-adaptation wrapper**. At deployment in a new environment (new sensor, new weather, new environment type), GeoAdapt generates pseudo-labels via geometric consistency (scans that ICP-align well are assumed to be the same place) and uses them to fine-tune the descriptor network in a self-supervised manner. Significantly boosts PR performance under moderate-to-severe domain shifts without requiring ground-truth labels in the new environment. Directly applicable to the urban-train → airside-deploy scenario.

---

## Sequence and Multi-Scan Place Recognition

Single-scan PR is fundamentally limited by the information in one snapshot. A corridor or a taxiway apron can look identical from multiple distinct positions if only the immediate scan is considered.

**SeqLPD** (RA-L 2019): early sequence-based approach. Matches sequences of scan descriptors using dynamic programming (DTW or sliding-window similarity), analogous to visual sequence matching in SeqSLAM. Improves recall in structurally repetitive environments. Two-stage: encode each scan individually, then match sequences.

**SeqOT — Sequential OverlapTransformer** (IEEE TIE 2022):
**Paper:** [arXiv:2209.07951](https://arxiv.org/abs/2209.07951) · **Code:** [github.com/BIT-MJY/SeqOT](https://github.com/BIT-MJY/SeqOT)

Replaces the two-stage encode-then-match-sequence approach with a single transformer that jointly encodes spatial (within-scan) and temporal (across-scan) information. A range-image sequence of T consecutive scans (e.g. 5–10 scans) is stacked and processed by a spatial-temporal attention mechanism. The resulting T-scan descriptor is compared against database T-scan descriptors. Key result: outperforms all single-scan methods on KITTI long-horizon retrieval. Generalises across different environments without retraining.

**Why sequences help:**
1. Trajectory context breaks the symmetry of perceptually aliased locations — two similar-looking corridors are in different places relative to the recent scan history.
2. Temporal averaging suppresses transient dynamic clutter (passing vehicles, parked aircraft).
3. Accumulated geometric context from consecutive viewpoints resolves ambiguous single-scan observations.

**Relevance to re-localization:** sequence matching requires that the database also be built from sequences, adding storage and indexing overhead. For the kidnapped-robot case (robot starts cold with no history), pure sequence matching is inapplicable; a hybrid approach (single-scan PR to get a candidate, then optionally sequence verification) is more practical.

---

## Heterogeneous-LiDAR Transfer

Most PR models are trained and evaluated on a single sensor model (e.g. Velodyne HDL-64 on Oxford RobotCar). At deployment, a different sensor model (Ouster OS1-128, Livox Avia, FMCW 4D radar LiDAR) produces scans with different point density, different FOV, different scanning pattern, and for FMCW sensors a velocity channel. A descriptor network trained on one sensor cannot reliably embed scans from another.

**HeLiPR dataset** (IJRR 2024): the first benchmark explicitly designed for inter-LiDAR (cross-sensor) place recognition. Includes parallel trajectories with multiple heterogeneous sensors (non-repetitive + spinning LiDARs; different FOVs; varying ray counts; NIR and reflectivity channels from FMCW LiDARs). Trajectories run parallel to the MulRan sequences for cross-referencing. All existing methods tested (SC, RING++, BTC, LoGG3D-Net) degrade substantially on cross-sensor queries.
**Paper:** [arXiv:2309.14590](https://arxiv.org/abs/2309.14590)

**HeLiOS** (2025): PR method specifically designed for heterogeneous LiDAR. Uses overlap-based learning (like OverlapTransformer) plus a local spherical transformer to produce sensor-agnostic descriptors.
**Paper:** [arXiv:2501.18943](https://arxiv.org/abs/2501.18943)

**Practical implication for airside:** an airside AV might carry an Ouster OS2 (spinning) while the survey vehicle used to build the prior map used a Velodyne VLP-32. Sensor-agnostic methods or fine-tuning with a few cross-sensor pairs (GeoAdapt-style) are required. Solid-state LiDARs (Livox Horizon / Avia) used on compact airside robots have non-repetitive scan patterns that break range-image-based descriptors (OverlapTransformer) and require FOV-tolerant approaches (SOLiD).

---

## Cross-Domain Transfer

**Domain gap.** Training on Oxford RobotCar (dense urban UK driving, Velodyne HDL-32, 40 km of traversals) and deploying in: (a) an airside apron (open flat geometry, few vertical structures, ground markings); (b) an industrial warehouse (indoor, structured but different scale); (c) off-road or mining sites (unstructured, vegetation). The gap involves both geometry statistics (point density, height range) and semantic content (buildings vs. taxiway markings vs. trees).

**Observed degradation:** PointNetVLAD and MinkLoc3D trained on Oxford degrade significantly on Wild-Places (natural forests, CSIRO, ICRA 2023) — performance drops from >95% urban Recall@1 to below 50% in some forest traversals without retraining.

**Wild-Places** (ICRA 2023): eight LiDAR sequences, handheld sensor, 67K undistorted submaps, 14 months of collection, Queensland forests. Captures seasonal appearance change (vegetation growth, dry/wet season). Demonstrates both intra-sequence loop closure and inter-sequence re-localization challenges. Deep learned methods significantly outperform handcrafted on this benchmark but absolute recall is far below urban performance, underscoring the domain gap.
**Paper:** [arXiv:2211.12732](https://arxiv.org/abs/2211.12732)

**SSL pre-training for PR.** Self-supervised contrastive pre-training on unlabelled point clouds (using augmentation-based positives and random negatives) provides a better backbone initialisation than random init; fine-tuning on a small labelled set in the target domain (a few hundred labelled pairs) then achieves competitive performance. GeoAdapt is the clearest example of SSL adaptation at test time. BEVPlace++'s generalisation from 3000 training frames to seven datasets also reflects this principle: strong architectural inductive biases (rotation equivariance, BEV projection) reduce the labelled-data requirement.

---

## Training Recipe

**Dataset construction.**
- Positive pairs: scans within a distance threshold (e.g. 10 m) on the same map.
- Hard negatives: scans beyond a negative threshold (e.g. 50 m) whose descriptor is closest to the query — selected by mining within the batch or in a global mining step per epoch.
- Training on Oxford RobotCar (~22k submaps) is the standard baseline; refined splits exclude dynamically changing sequences.

**Triplet mining.** Hard negative mining is critical: random negatives are trivially easy and produce near-zero gradient. Mining the hardest batch negative (or nearest non-positive database entry) provides meaningful gradient signal and drives Recall@1 gains of 5–15 percentage points vs. random negatives.

**Batch sampling.** A standard batch contains Q query scans, each with P positive examples and N negative examples, giving a batch of Q × (P + N) total scans. Typical values: Q = 8–16, P = 2–4, N = 4–12. Large batches with many negatives support InfoNCE-style contrastive losses that stabilise training.

**Fine-tuning for deployment.** Starting from an Oxford-trained checkpoint, fine-tuning on 500–1000 site-specific scan pairs (achievable in one survey drive over the target area) substantially closes the domain gap from Oxford-trained baselines. This is the recommended operational approach for airside or non-urban deployments. GeoAdapt provides a self-supervised variant where even ground-truth labels on the new pairs are not required — ICP-verified pairs generate pseudo-labels.

**Data augmentation.** Random point dropout, jitter, rotation about the vertical axis (yaw), and random flipping along ground-parallel axes improve generalisation. Intensity perturbation helps for intensity-aware variants (MinkLoc3D-SI).

---

## Benchmark Results

Recall@1 (%) across standard benchmarks. Thresholds: Oxford RobotCar / KITTI / NCLT at 25 m; MulRan at 10 m; Wild-Places at 3 m; HeLiPR at 10 m.

| Method | Oxford (ref) | KITTI | NCLT | MulRan | Wild-Places | HeLiPR (cross) |
|---|---|---|---|---|---|---|
| Scan Context (handcrafted) | ~60-65% | ~75% | ~55% | ~60% | ~30% | degrades |
| PointNetVLAD (CVPR 2018) | ~92% | ~80% | ~70% | ~75% | ~40% | degrades |
| MinkLoc3D (WACV 2021) | ~98.5% | ~94% | ~88% | ~83% | ~55% | degrades |
| MinkLoc3D-V2 (WACV 2022) | >99% | ~96% | ~91% | ~87% | ~60% | degrades |
| LoGG3D-Net (ICRA 2022) | ~98.5% | F1=0.939 | — | F1=0.968 | ~62% | degrades |
| CASSPR (ICCV 2023) | ~99% | — | — | ~90% | — | — |
| BEVPlace++ (T-RO 2025) | ~99% | ~97% | — | ~92% | ~65% | — |
| HOTFormerLoc (CVPR 2025) | ~99.5% | ~98% | — | ~93% | ~78% | — |
| HeLiOS (2025) | — | — | — | — | — | strong |

Notes:
- Wild-Places uses 3 m threshold — considerably more demanding than the 25 m Oxford threshold; absolute recall numbers are not directly comparable across datasets.
- HeLiPR cross-sensor results: all methods trained on homogeneous data show large degradation; HeLiOS specifically addresses this case.
- F1_max (LoGG3D-Net on KITTI/MulRan) is not directly comparable to Recall@1.
- Numbers from original papers; evaluation protocols differ across papers — use with caution for cross-method comparisons.

---

## Loop Closure Integration

Loop closure is the primary downstream consumer of PR in SLAM systems. See also: [`./loop-closure-place-recognition.md`](loop-closure-place-recognition.md) for the full treatment.

**Standard integration pattern in modern LIO/SLAM:**

1. **LiDAR odometry front-end** — [KISS-ICP](kiss-icp.md), [FAST-LIO2](fast-lio-fast-lio2.md), or [LIO-SAM](lio-sam.md) incrementally builds a local map and tracks pose. Accumulates drift over distance.
2. **Place recognition module** — runs periodically (every N keyframes) against the database of past keyframes. Returns top-K candidates by embedding distance.
3. **Geometric verification** — for each candidate, compute an ICP alignment between the query scan and the candidate scan; accept if inlier ratio > threshold (e.g. 0.3) and fitness score < threshold. This step rejects PR false positives.
4. **Loop closure constraint insertion** — the verified relative transform is added as a 6-DoF edge in the pose graph.
5. **Graph optimisation** — GTSAM or g2o solves the full pose graph including the new loop edge, distributing error correction along the trajectory.

**LIO-SAM** implements this pattern explicitly using Scan Context for PR and ICP for verification. Replacing Scan Context with a learned descriptor (MinkLoc3D or LoGG3D-Net) is a common research enhancement with measurable improvement on challenging datasets.

**FAST-LIO2** does not include a built-in PR module; community extensions (FAST-LIO-SLAM, FAST-LIO-LC) add a PR step (Scan Context or learned) followed by ICP.

**KISS-ICP** v2+ adds an optional loop closure module; upstream uses density-map-based candidate generation, though learned PR can be substituted.

**The false-positive cost.** A missed loop closure leaves drift uncorrected — correctable by additional traversals. A false positive inserts a wrong relative-pose constraint that can introduce a fold or tear in the map, potentially unrecoverable without manual intervention. This asymmetry drives PR design: precision > recall. Systems operate at very high precision thresholds (reject any candidate where geometric verification fails) at the cost of lower recall. In airside context (high-reliability requirement), operating the PR module conservatively is mandatory.

---

## Global Re-Localization

**Use case.** A vehicle starts a new operational session without a known pose (cold start), or recovers from tracking failure (kidnapped robot). Global re-localization finds its position in an existing map from scratch, without GPS.

**Two-stage global re-localization pipeline:**

1. **Place retrieval** — query the descriptor database with the current scan; get top-K candidates by embedding distance.
2. **Pose refinement** — run ICP between the query scan and each candidate map scan or local submap to get a 6-DoF transform; the best-fitting alignment (lowest ICP fitness + residual) is the output pose.

This seeds the LiDAR odometry front-end with a prior, enabling rapid re-convergence.

**Airside cold-start use case.** An autonomous baggage tug starting its shift needs to localise within an apron map built during a survey drive. GPS is unreliable in the shadow of terminal buildings and jetways. The PR step matches the startup scan against the map database; ICP verifies and refines to sub-10 cm (depending on map quality and scan quality). The aggregated-map pipeline described in [`../../perception/overview/aggregated-map-semantic-segmentation.md`](../../perception/overview/aggregated-map-semantic-segmentation.md) produces the database; PR is the runtime lookup mechanism.

**Multi-session map anchoring.** When new survey drives are used to extend or update the map, PR finds anchor points where old and new sessions overlap; ICP provides the precise relative transform; the global pose graph is then optimised with both old and new trajectory nodes and their inter-session loop closures. This is how aggregated maps grow without losing global consistency.

---

## Strengths

- **Illumination invariance** — LiDAR is active and range-based; learned LiDAR descriptors are completely unaffected by lighting changes that destroy image-based PR. Night, fog, and direct sun cause no degradation in the descriptor.
- **Geometric richness** — 3D structure encodes unambiguous spatial information unavailable in 2D images.
- **Large-scale scalability** — compact descriptors (256-d to 512-d) enable FAISS-indexed databases with millions of entries queryable in under 10 ms.
- **Trainable discrimination** — end-to-end learning captures scene-discriminative features that handcrafted methods cannot engineer, including fine-grained structural differences that Scan Context misses.
- **Domain adaptability** — GeoAdapt and SSL fine-tuning enable deployment in environments far from the training distribution without full re-labelling.
- **Multi-session and fleet applicability** — a shared descriptor database enables map merging across sessions and across multiple vehicles.

---

## Failure Modes

| Failure mode | Mechanism | Severity |
|---|---|---|
| **Viewpoint change** | Large lateral offset (different lane) or heading reversal changes the scan structure significantly; learned descriptors trained on forward-traversal pairs do not generalise to opposite-direction traversals. | High for 6-DoF recovery |
| **Perceptual aliasing** | Long uniform corridors (airport taxiways, warehouse aisles, tunnels) produce near-identical descriptors from multiple distinct positions. | High in apron / hangar |
| **Seasonal / weather change** | Vegetation growth or loss changes point cloud statistics; heavy rain causes point attenuation and false reflections; snow covers ground features. | Moderate in outdoor |
| **Dynamic objects** | Vehicles, people, aircraft create spurious geometric features; at query time the same location has different dynamic content. | Moderate |
| **Sensor domain gap** | A descriptor trained on one sensor model degrades on another (see HeLiPR section). | High for cross-sensor ops |
| **Sparse environments** | Open flat aprons with few vertical structures produce low-density scans with minimal discriminative geometry. | High for airside open areas |
| **Indoor repetitive geometry** | Repetitive shelving and similar-width corridors in warehouses create aliasing analogous to tunnel problems. | High for warehouse aisles |
| **False-positive cost** | A single accepted false-positive loop closure can deform or fold the map irreparably. | Critical |

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV — urban | Strong | Designed and benchmarked for urban outdoor driving; building facades, intersections, and varied 3D structure make good discriminative geometry. |
| Road AV — highway / motorway | Moderate | Reduced structural variety; long uniform sections create aliasing; sequence methods (SeqOT) help. |
| Warehouse / indoor | Conditional | Structured but repetitive geometry; strong context gates (map zone, odometry) are required; CASSPR or SeqOT improve discrimination. |
| Logistics yard / port | Conditional | Mix of open and structured areas; crane structures and building facades help retrieval in dense areas; open yard areas alias. |
| Mining / construction | Conditional | Unstructured terrain; performance drops substantially vs. urban baseline; fine-tuning and GeoAdapt adaptation are required. |
| Agriculture / off-road | Weak | Dense vegetation and open fields approach the Wild-Places worst case; deep learned methods still outperform handcrafted but absolute recall is low. |
| Airside — terminal / jetway zone | Conditional | Jetway structures and terminal facades provide some discriminative geometry; still requires ICP verification and conservative thresholds. |
| Airside — open apron | Weak | Near-worst case for geometric LiDAR PR — see Aggregated-Map Suitability section below. |
| Airside — hangar interior | Conditional | Structured steel geometry provides discriminative features but repetitive bay structure creates aliasing; context gates (GPS zone, heading) are required. |

---

## Aggregated-Map Suitability and Airside Note

### Aggregated-Map Build Pipeline

The aggregated-map build pipeline runs a survey vehicle through the operational area and accumulates scans via LiDAR odometry (KISS-ICP or similar). Map quality depends critically on loop closures: without them, long single-pass trajectories accumulate drift (often 1–5 m per 100 m). PR detects revisits within the survey drive, enabling graph optimisation that corrects drift. In a large airport apron (1+ km traversals), missing loop closures produces maps with metre-scale errors — unacceptable for autonomous vehicle navigation.

Recommended recipe for aggregated-map build:
1. Learned PR descriptor (MinkLoc3D-V2 or LoGG3D-Net) → top-K retrieval
2. ICP alignment on matched scan pair → 6-DoF pose, sub-10 cm accuracy
3. Pose graph edge insertion and graph optimisation (GTSAM or g2o)
4. Iterate over full trajectory including all inter-session revisits

### Airside Apron — An Honest Assessment

**Open flat airside aprons are near-worst-case environments for geometric LiDAR place recognition.** The fundamental problem is discriminability:

- Flat tarmac with few vertical structures (no buildings, no lamp posts) produces low-density scans with minimal discriminative 3D geometry.
- Repeating painted markings (taxiway centre lines, holding position bars, gate numbers) are 2D features that LiDAR captures only as minor height discontinuities — insufficient for PR.
- Large stand areas have identical geometry: the same gate geometry repeated at 30–60 m intervals.
- Parked aircraft are discriminative but are a dynamic element — the aircraft at gate 14 during the survey may not be present during operation.
- The primary discriminative cue — terminal building silhouettes — is only visible from certain scan positions; large areas of the apron are outside the line of sight to buildings.

**Consequence:** Methods achieving >99% Recall@1 on Oxford RobotCar may achieve only 60–75% on a structurally repetitive airside apron without site-specific adaptation. The Oxford 25 m threshold also means a method can return a scan from the adjacent gate stand and still count as correct — actual operational precision requirements are far tighter.

**Mandatory operational practices:**

1. **Always apply ICP or RANSAC verification after PR retrieval.** Never accept a loop closure on descriptor distance alone in an airside environment.
2. **Operate at high precision thresholds.** Accept a loop closure only when geometric verification passes convincingly (inlier ratio > 0.4, ICP fitness score < 0.15 m); do not tune for recall at the expense of precision.
3. **Apply context gates.** GPS/RTK zone, heading, and map-section gates narrow the candidate set dramatically before geometric verification runs. A query scan from the western apron should not retrieve candidates from the eastern apron.
4. **Use sequence PR (SeqOT) when trajectory history is available.** The trajectory context breaks the geometric symmetry between identical-looking gate stands that happen to be adjacent but distinct places.
5. **Fine-tune on site-specific data.** A single survey drive over the target apron, producing 500–1000 scan pairs, is sufficient for fine-tuning an Oxford-trained checkpoint to the site geometry. This is the single highest-impact action for improving PR performance at an airside deployment.
6. **Combine with Scan Context as a fallback.** Scan Context is complementary (fast, deterministic) and can serve as a validation layer or fallback retrieval when the learned descriptor confidence is low.
7. **Track false-positive loop closure events in production.** Log all rejected candidates and all inserted loop closures; monitor the rate of post-optimisation map residuals that require rollback.

---

## Implementation Notes

- Evaluate retrieval and backend impact separately: top-K recall, registration success rate after retrieval, false-positive loop rate after all gates, and trajectory ATE/RPE improvement.
- For Oxford-trained baselines, always re-evaluate on the target domain before trusting published Recall@1 numbers.
- Build hard-negative training sets from repeated gates, similar stands, parallel service roads, and depot aisles that are known aliasing points in the target environment.
- Train or fine-tune on the actual LiDAR model and mounting geometry. Descriptor quality is sensitive to both: a 32-beam sensor at 0.9 m mount height produces a very different scan profile from a 64-beam sensor at 1.8 m.
- Remove dynamic objects before descriptor extraction for persistent-map applications. Dynamic object removal improves both training stability and inference reliability — see [`./lidar-map-cleaning-dynamic-removal.md`](lidar-map-cleaning-dynamic-removal.md).
- Keep descriptor databases versioned and aligned with map tiles and route zones. A descriptor database built from an outdated map version will produce incorrect loop-closure candidates after the environment changes.
- Use descriptor matches to initialise registration, not to bypass it. The PR step provides a coarse spatial prior (~25 m accuracy); ICP refines to sub-10 cm. Skipping ICP defeats the entire safety argument.
- For MinkowskiEngine-based models (MinkLoc3D, LoGG3D-Net): ensure MinkowskiEngine v0.5+ is used; the 0.4.x series has known memory leaks under batch inference. CUDA 11.3+ required.
- For FAISS database indexing: IndexFlatL2 is exact and appropriate up to ~100k entries; IndexIVFFlat with nlist = sqrt(N) is recommended for > 500k entries; re-training the quantiser when the database grows by >50% is advisable.
- SOLiD is the preferred choice when the operational vehicle carries a solid-state LiDAR (Livox Avia / Horizon / Mid-360) — range-image methods and max-height BEV projections lose information from non-repetitive scan patterns.

---

## Sources

- Uy and Lee, "PointNetVLAD: Deep Point Cloud Based Retrieval for Large-Scale Place Recognition," CVPR 2018: https://arxiv.org/abs/1804.03492
- Komorowski, "MinkLoc3D: Point Cloud Based Large-Scale Place Recognition," WACV 2021: https://arxiv.org/abs/2011.04530
- Official MinkLoc3D repository: https://github.com/jac99/MinkLoc3D
- MinkLoc3D-V2 repository: https://github.com/jac99/MinkLoc3Dv2
- MinkLoc3D-SI: https://ieeexplore.ieee.org/document/9661423/
- Vidanapathirana et al., "LoGG3D-Net: Locally Guided Global Descriptor Learning for 3D Place Recognition," ICRA 2022: https://arxiv.org/abs/2109.08336
- Official LoGG3D-Net repository: https://github.com/csiro-robotics/LoGG3D-Net
- Xia et al., "CASSPR: Cross Attention Single Scan Place Recognition," ICCV 2023: https://arxiv.org/abs/2211.12542
- Official CASSPR repository: https://github.com/Yan-Xia/CASSPR
- Luo et al., "BEVPlace++: Fast, Robust, and Lightweight LiDAR Global Localization for Unmanned Ground Vehicles," T-RO 2025: https://arxiv.org/abs/2408.01841
- Official BEVPlace repository: https://github.com/zjuluolun/BEVPlace2
- Chen et al., "OverlapTransformer: An Efficient and Rotation-Invariant Transformer Network for LiDAR-Based Place Recognition," RA-L/IROS 2022: https://arxiv.org/abs/2203.03397
- Official OverlapTransformer repository: https://github.com/haomo-ai/OverlapTransformer
- Jang et al., "SeqOT: A Spatial-Temporal Transformer Network for Place Recognition Using Sequential LiDAR Data," IEEE TIE 2022: https://arxiv.org/abs/2209.07951
- Official SeqOT repository: https://github.com/BIT-MJY/SeqOT
- EgoNN (Komorowski, RA-L 2022): https://github.com/jac99/Egonn
- Cao et al., "SALSA: Swift Adaptive Lightweight Self-Attention for Enhanced LiDAR Place Recognition," arXiv 2024: https://arxiv.org/abs/2407.08260
- SOLiD (RA-L 2024 / ICRA 2025): https://github.com/sparolab/solid
- HOTFormerLoc (CVPR 2025): https://arxiv.org/abs/2503.08140
- Laconte et al., "GeoAdapt: Self-Supervised Test-Time Adaptation in LiDAR Place Recognition Using Geometric Consistency," RA-L 2023: https://arxiv.org/abs/2308.04638
- Jung et al., "HeLiPR: Heterogeneous LiDAR Dataset for Inter-LiDAR Place Recognition," IJRR 2024: https://arxiv.org/abs/2309.14590
- HeLiOS (2025): https://arxiv.org/abs/2501.18943
- Knights et al., "Wild-Places: A Large-Scale Dataset for Lidar Place Recognition in Unstructured Natural Environments," ICRA 2023: https://arxiv.org/abs/2211.12732
- Cattaneo, Vaghi, and Valada, "LCDNet: Deep Loop Closure Detection and Point Cloud Registration for LiDAR SLAM": https://arxiv.org/abs/2103.05056
- TransLoc3D: https://arxiv.org/abs/2105.11605
- BEVPlace (ICCV 2023): https://arxiv.org/abs/2302.14325
- LiDAR Place Recognition Survey, ACM 2024: https://dl.acm.org/doi/10.1145/3707446
- Global LiDAR Localization Survey, IJCV: https://arxiv.org/abs/2302.07433
- MulRan Dataset, ICRA 2020: https://gisbi-kim.github.io/publications/gkim-2020-icra.pdf
- Dubé et al., "SegMap: Segment-based Mapping and Localization using Data-Driven Descriptors," IJRR 2020: https://journals.sagepub.com/doi/abs/10.1177/0278364919863090
- GeM Pooling: https://arxiv.org/abs/1811.00202
- Loop Closure and Place Recognition: [./loop-closure-place-recognition.md](loop-closure-place-recognition.md)
- Scan Context Family (classical sibling): [./scan-context-family.md](scan-context-family.md)
- KISS-ICP: [./kiss-icp.md](kiss-icp.md)
- FAST-LIO / FAST-LIO2: [./fast-lio-fast-lio2.md](fast-lio-fast-lio2.md)
- LIO-SAM: [./lio-sam.md](lio-sam.md)
- Aggregated-map semantic segmentation (re-localization context): [../../perception/overview/aggregated-map-semantic-segmentation.md](../../perception/overview/aggregated-map-semantic-segmentation.md)
- Correspondence search and kNN data structures: [../../../10-knowledge-base/geometry-3d/correspondence-search-data-structures.md](../../../10-knowledge-base/geometry-3d/correspondence-search-data-structures.md)
