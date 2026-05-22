# Correspondence Search Data Structures: First Principles

<!-- kb-visual:start -->
![Correspondence Search Data Structures curated visual](../_assets/visuals/geometry-3d-correspondence-search-data-structures.svg)

*Visual: correspondence-search comparison showing query point, KD-tree partition, voxel hash buckets, candidate gating, residual construction, and rejected matches.*
<!-- kb-visual:end -->

Most geometric perception problems need to answer the same question many times:
which map point, voxel, feature, surface patch, or track is compatible with this
measurement? Correspondence search is the data-structure layer behind ICP,
feature matching, clustering, occupancy updates, ray casting, map lookup, and
multi-sensor fusion. The math can be correct and still fail in production if
the search structure returns stale, biased, or poorly gated matches.

Wall-clock profiling consistently places neighbor search at 40–95% of end-to-end
latency depending on architecture. Accelerating it is the primary systems-level
lever in both per-scan inference and large-map post-processing pipelines.

---

## 1. Related Docs

- [Point Cloud Registration Math: ICP, GICP, VGICP, and NDT](point-cloud-registration-math-icp-ndt-gicp.md)
- [Camera Projective Geometry, PnP, and Triangulation](camera-projective-geometry-pnp-triangulation.md)
- [Occupancy Bayes, Evidential, and Dynamic Grids](../mapping/occupancy-bayes-evidential-dynamic-grids.md)
- [Sparse Attention for 3D Perception](../machine-learning/sparse-attention-3d-perception.md)
- [Point Cloud Representations and Voxelization: First Principles](point-cloud-representations-voxelization-first-principles.md)
- [Point Cloud Segmentation Losses and Metrics: First Principles](point-cloud-segmentation-losses-metrics-first-principles.md)
- [MinkowskiNet / Sparse Conv Engines](../../30-autonomy-stack/perception/methods/minkowskinet.md)
- [KPConv](../../30-autonomy-stack/perception/methods/kpconv.md)
- [RandLA-Net](../../30-autonomy-stack/perception/methods/randla-net.md)
- [Point Transformer V3](../../30-autonomy-stack/perception/methods/point-transformer-v3.md)
- [Superpoint Transformer](../../30-autonomy-stack/perception/methods/superpoint-transformer.md)

---

## 2. Why It Matters

| Choice | Effect | Risk if wrong |
|---|---|---|
| Search structure | Determines query latency, memory, and update cost. | Wrong structure can make a correct algorithm 100× too slow for real-time. |
| Exact vs. approximate | Exact guarantees correct neighbors; approximate trades recall for speed. | Low ANN recall silently biases pose estimates if missed correspondences are spatially non-uniform. |
| kNN vs. radius search | kNN gives fixed neighbor count; radius gives fixed spatial scale. | Wrong choice mismatches receptive field to object scale or creates memory explosions in dense regions. |
| Sampling strategy | FPS vs. random determines which points survive downsampling. | FPS bottlenecks latency on large clouds; random sampling drops geometric structure at boundaries. |
| Serialization order | Space-filling curves improve cache locality and patch coherence. | Poor ordering increases cache misses by 2–4× and RPE computation overhead dominates attention layers. |
| Coordinate map vs. dense grid | Sparse map avoids 95–99% wasted FLOPs on empty voxels. | Dense 3D conv is infeasible for LiDAR resolution at real-time rates. |
| Scale strategy | Tile-based chunking vs. in-memory tree determines map size ceiling. | A single KD-tree for a 500M-point airport map requires 20–40 GB RAM. |

---

## 3. Why Correspondence Search Is the Inner Loop

Every major point-cloud operation reduces to: *for each query point, find its
geometric neighbors in O(1)–O(log N) time.* Four operator classes make this the
dominant cost.

### 3.1 Point-Based Network Operators

**PointNet++ ball-query / FPS grouping.** Each set-abstraction layer issues
radius queries for every surviving point. On a 65k-point cloud this is ~65k
separate radius searches per layer, per forward pass. The ball-query radius
defines the physical receptive field in metric space.

**KPConv.** Range search over a support radius `r` locates all supporting
points. Correlation with kernel positions is an inner product, but the range
query dominates latency on CPU at inference scale.

**RandLA-Net Local Feature Aggregation (LFA).** kNN query inside each
attentive-pooling stage. Despite replacing FPS with random down-sampling, kNN
cost still dominates at 10^6 points.

**Point Transformer v1 / v2.** Self-attention on kNN neighborhoods with
relative position encodings (RPE) computed inside the kNN set. RPE computation
consumed 26% of PTv2 forward time; this is entirely eliminated in PTv3 by
replacing neighbor search with space-filling-curve patch attention (see §9).

### 3.2 Registration: ICP Inner Loop

The original Besl and McKay ICP analysis found that roughly 95% of run-time is
consumed by the correspondence-search step, not the transformation solve. Each
ICP iteration issues one full nearest-neighbor pass over the source cloud against
a KD-tree of the target. For fine LiDAR maps this means millions of queries per
iteration, repeated over dozens of iterations.

### 3.3 Dynamic Removal: Ray-Casting and kNN Voting

OctoMap-based dynamic-removal pipelines (e.g., Arora et al. ECMR 2021)
perform two search-intensive steps per incoming scan:

1. **Ray-casting** — probabilistic occupancy update via ray traversal through
   the octree; each ray visits O(depth) nodes.
2. **kNN voting** — for each uncertain voxel, find k nearest points from the
   static/dynamic partition and vote by majority. Both stages touch neighbor
   structures on every incoming scan.

### 3.4 Post-Processing: Label Propagation

Softmax-label refinement propagates predicted labels from down-sampled points
back to full-resolution clouds — one kNN lookup per full-resolution point.
This step appears in virtually every sparse-voxel backbone: MinkowskiEngine,
Cylinder3D, and MaskPLS all terminate inference with a kNN voting pass over the
original cloud.

---

## 4. Exact Methods

### 4.1 KD-Tree

**Mechanism.** A binary tree that recursively partitions R^d by alternating
coordinate axes. At each node, points are split by the median of the
widest-spread dimension. Leaf nodes store a small bucket (default 10–32 points
in FLANN).

**Complexity:**

```text
build:   O(N log N)  -- one median-find pass per level, log N levels
kNN query:  O(log N) average for d <= 10
             degrades toward O(N) as d grows or data is highly non-uniform
radius query: O(log N + k)  where k = result count
```

Non-uniform density causes elongated cells (dense clusters → narrow, deep
subtrees), triggering extensive backtracking during kNN search. The
sliding-midpoint splitter in FLANN mitigates but does not eliminate this.

**Implementations:**

- **FLANN** — Fast Library for Approximate Nearest Neighbors; the underlying
  engine for both PCL's `KdTreeFLANN` and Open3D's `KDTreeFlann`. Supports
  exact kNN, radius search, and approximate kNN with an error-bound parameter.
- **nanoflann** — header-only C++11 drop-in; lower memory overhead than FLANN.
  Used by PCL when FLANN is unavailable; preferred for embedded or edge
  deployments where dependency count matters.
- **Open3D** exposes three search primitives:
  ```text
  search_knn_vector_3d(pt, k)          -- exact kNN
  search_radius_vector_3d(pt, r)       -- all points within radius r
  search_hybrid_vector_3d(pt, r, k)    -- RKNN: at most k neighbors within r
  ```
  RKNN (hybrid) is the primary workhorse throughout Open3D's own pipelines,
  combining the spatial-scale guarantee with a memory cap.

**Failure modes on LiDAR clouds:**

- **Non-uniform density.** Ground-scan LiDAR has dense returns near the sensor
  and sparse returns at range. No splitter strategy fully prevents degenerate
  cells; profiling radius-query neighbor counts by range bin is essential.
- **Dynamic insertion.** KD-trees are static; incremental inserts degrade
  balance. PCL's `Octree2BufBase` is preferred when the map updates
  scan-by-scan.
- **Memory wall.** A 100M-point KD-tree at ~40–80 bytes/node occupies 4–8 GB.
  A full airport airside map at 5 mm resolution can exceed 500M points,
  requiring 20–40 GB for a single tree. Chunked tile-based strategies (§11)
  are mandatory at billion-point scale.

### 4.2 Octree

**Mechanism.** Each internal node subdivides a cubic voxel into 8 equal
children. Subdivision continues until a leaf contains at most
`max_points_per_voxel` points or `max_depth` is reached. Leaf address is a
bit-string Morton code (see §9).

**Supported queries in PCL:**

```text
voxel search   -- all points sharing the same leaf as the query
kNN search     -- hierarchical traversal with distance-ordered node queue
radius search  -- prune octants whose bounding cube falls outside the sphere
```

Radius search is generally faster than KD-tree for uniform clouds because
spatial subdivision directly prunes octants outside the sphere. Over-subdivision
causes path lengths that outweigh this advantage on non-uniform data.

**Complexity:**

```text
insert:        O(log N) per point (depth-first to leaf)
radius search: O(log N + k) for uniform clouds;
               O(N) worst-case for clustered non-uniform clouds
```

**Change detection.** PCL's `Octree2BufBase` maintains two octrees in memory
simultaneously (double-buffering), enabling scan-to-scan change detection
without rebuilding. Critical for dynamic object removal in airside maps.

**OctoMap.** Probabilistic occupancy mapping; each node stores a log-odds
occupancy value updated via ray-casting. Supports serialization to binary `.bt`
files and lazy subtree loading for out-of-core access. The implicit spatial
index is an octree, so all neighbor queries benefit from the same hierarchical
pruning. Used in dynamic-removal pipelines (§3.3) and as a map representation
for airside path planning.

**O-CNN connection.** O-CNN (Wang et al., 2017) stores feature vectors at
octree nodes rather than individual points, enabling sparse 3D convolution
without explicit voxelization. This is a conceptual precursor to
MinkowskiEngine's coordinate-map approach.

### 4.3 Ball Tree and Cover Tree

**Ball tree.** Partitions data into nested hyper-spheres (balls) rather than
axis-aligned hyperrectangles. Each node's bounding ball is computed from its
children. Query prunes a subtree when:

```text
dist(query, ball_center) - ball_radius > current_best_dist
```

- Build: more expensive than KD-tree (centroid computation + ball fitting per
  node).
- Query: O(log N) average, but tighter pruning in moderate-to-high dimensions
  (d = 10–50) compared to axis-aligned boxes.
- Scikit-learn uses ball trees by default for `KNeighborsClassifier` when
  d > 20.
- For raw 3D LiDAR (d = 3) ball trees offer no advantage over KD-trees. They
  become relevant in *descriptor space* (FPFH = 33-D, DINOv2 features =
  384–1024-D).

**Cover tree.** Theoretically stronger: O(c^6 N log N) build and O(c^12 log N)
exact nearest-neighbor query, where c is the expansion constant (intrinsic
dimensionality measure). Achieves linear space regardless of dimensionality.
Preferred for general metric spaces (geodesic distance on a mesh, edit distance).
Rarely used for raw 3D point clouds because c is large and constants dominate.

---

## 5. Approximate Methods

### 5.1 Locality-Sensitive Hashing (LSH)

Projects points with random hyperplanes; points landing in the same bucket are
candidate neighbors with high probability.

```text
build:  O(N * L * k)  -- L hash tables, k hash functions per table
query:  O(L * k + candidates)
```

Recall is tunable by L and k. Low recall (0.7–0.8) suffices for many
label-propagation tasks where misses are spatially random. LSH is rarely used
for raw 3D queries (spatial hashing is simpler and faster) but appears in
descriptor matching and place recognition pipelines.

### 5.2 Spatial Hashing and Coordinate Maps

**Voxel-grid bucketing.** Points are quantized to a regular grid cell; neighbor
candidates are the 27 immediately adjacent cells. Post-filtering by exact
distance yields kNN or radius results.

```text
ix = floor((x - origin_x) / resolution)
key = hash(ix, iy, iz)
bucket[key] -> list of point indices
```

Build: O(N) hash insertion. Query: O(1) hash lookup + O(bucket_size) distance
sort. Throughput collapses when bucket occupancy is highly non-uniform (a single
dense cluster serializes the sort step).

**Sparse-voxel coordinate map.** The data structure underlying MinkowskiEngine,
SpConv, and TorchSparse. Integer-quantized 3D coordinates `(x, y, z)` are
hashed into a flat hash table mapping coordinate tuple → index into a feature
tensor.

```text
occupied voxels are typically 1-5% of bounding-box volume (submanifold sparsity)

neighbor query for a 3x3x3 kernel:
  for each offset delta in {-1, 0, 1}^3:       -- 27 offsets
    look up hash(voxel_coord + delta)            -- O(1) amortized
  collect valid (input_idx, output_idx, kernel_offset) triples
  -> this set is the kernel map / rule book
```

The kernel map is built once per layer per forward pass and reused for the
actual sparse GEMM. SpConv v2's "hashmap_on_the_fly" rebuilds it each forward
pass to save memory at the cost of recomputation time.

**CUDA hash tables.** ASH (A Modern Framework for Parallel Spatial Hashing in
3D Perception) implements GPU-native open-addressing hash maps supporting
concurrent insertion and lookup, underpinning real-time dense SLAM at voxel
hash granularity. The same principle applies to NVIDIA's voxel-hashing SLAM
(Nießner et al., 2013).

### 5.3 Graph-Based ANN: HNSW and IVF

**HNSW (Hierarchical Navigable Small World).** Multi-layer proximity graph.
Layer 0 contains all points; each upper layer is a random sub-sample with
longer-range edges. Greedy search navigates from the top layer downward.

```text
build:   O(N log N) -- each insert runs greedy search to find M neighbors
query:   sub-linear; empirically O(log N) to O(log^2 N) for Euclidean spaces
recall@10 >= 0.95 with ef_search = 100-200 (tunable parameter)
```

FAISS bundles HNSW and IVF as CPU implementations. FAISS GPU provides
IVF-Flat and IVF-PQ with 5–20× speedup over CPU FAISS.

**IVF (Inverted File).** Cluster the dataset into `nlist` Voronoi cells
(k-means); at query time search only `nprobe` cells.

```text
comparisons per query: O(nprobe * N / nlist)  -- tunable recall vs speed
IVF-PQ adds Product Quantization: 4-8x memory compression
```

**HNSW vs. IVF for point clouds.** HNSW wins on recall at low latency; IVF-PQ
wins on memory when the index must fit in GPU VRAM for billion-vector datasets.

**NSG (Navigating Spreading-out Graph).** Sparser than HNSW — targets
Monotonic Relative Neighborhood Graph property. Lower memory than HNSW; faster
search for recall@1 tasks.

---

## 6. GPU Implementations and Parallel kNN

### 6.1 FAISS-GPU

Flat L2 (exact brute-force) on GPU via tiled matrix multiplication:

```text
Q queries, N database vectors, d dimensions:
cost = O(Q * N * d) FLOPs, parallelized across CUDA threads

throughput: single Pascal-class GPU achieves 5-20x over CPU FAISS
            P100 can build k=10 NN-graph for 1B x 96-D vectors in < 12 hours
```

GPU IVF-Flat and IVF-PQ are also included; IVF-PQ achieves 5–20× speedup
over CPU FAISS at the cost of recall tuning.

### 6.2 NVIDIA cuVS / CAGRA

CAGRA is NVIDIA's GPU-native graph-based ANNS algorithm in the cuVS library
(successor to RAFT). IVF-PQ and IVF-Flat are also included. IVF-RaBitQ (2025)
achieves 2.2× higher QPS than CAGRA at Recall ≥ 0.95 on billion-scale
benchmarks. cuVS is the current recommended GPU vector search library for
production AV and mapping pipelines.

### 6.3 GGNN and BANG

**GGNN (Graph-based GPU Nearest Neighbor Search).** Builds the index on-GPU
using information propagation on approximate neighbor graphs. Claimed to
surpass CPU and GPU state-of-the-art in build-time, accuracy, and search speed
(as of 2022).

**BANG (Billion-Scale ANN on Single GPU).** Stores the graph index in host
RAM; streams neighborhoods to GPU for search. Decouples index size from VRAM
limit. Enables billion-scale ANNS on a single A100 where the full graph
otherwise does not fit in 80 GB VRAM. Relevant for aggregated airport maps
(§11).

### 6.4 Grid-Hash GPU kNN (FRNN-Style)

```text
1. Parallel scatter: insert all N points into flat 3D grid hash on GPU
2. For each query, fetch 27 neighboring cells in parallel warps
3. Compute distances in parallel; bitonic sort within each warp gives top-k

throughput: ~100-500M query-neighbor pairs/second on RTX 4080-class hardware
            for 3D point clouds with uniform density
            collapses on non-uniform clouds (single dense bucket serializes)
```

FRNN exposes this as a PyTorch CUDA extension with radius and kNN interfaces.
torch-cluster provides similar functionality integrated with PyTorch Geometric
autograd graphs.

### 6.5 Open3D ML kNN

`open3d.ml.torch.ops.knn_search` provides a CUDA-native kNN kernel integrated
with PyTorch autograd, used by 3D-MPA and PointTransformer-based Open3D-ML
models.

---

## 7. Radius Search vs. kNN — When Each Is Right

| | Radius search | kNN |
|---|---|---|
| Guarantees | Fixed spatial scale | Fixed neighbor count |
| Density sensitivity | Neighbor count varies with local density | Adaptive — always returns k |
| Use in networks | KPConv, PointNet++ ball-query (receptive field is metric ball) | RandLA-Net LFA, Point Transformer |
| GPU memory | Unpredictable; dense regions cause memory spikes | Predictable: always k outputs per query |
| Risk | Dense regions → huge neighborhoods → memory explosion or truncation | Sparse regions → far neighbors dilute features |
| Hybrid (RKNN) | At most k neighbors within radius r | Combines spatial-scale and memory-cap guarantees |

**Receptive field implications.** Ball-query at fixed radius `r` gives
scale-consistent features across a scan: the operator sees the same physical
extent regardless of local point density. PointNet++ explicitly motivates this
for shape understanding. However, ball-query requires an upper cap (`nsample`
parameter) — if the cap is hit in dense regions, points are truncated,
introducing sampling bias.

kNN at fixed k gives density-adaptive features: in dense regions the
neighborhood is spatially tight; in sparse regions it is wide. RandLA-Net
argues this is preferable for large outdoor scenes where density varies by two
or more orders of magnitude from the sensor origin.

KPConv uses radius search with a fixed support radius; this is the defining
parameter of its receptive field. Changing the support radius directly changes
which physical structures are grouped together — a 0.5 m radius will fuse
ground and wheel, where 0.1 m separates them.

---

## 8. Farthest-Point Sampling (FPS)

### 8.1 Algorithm

```text
initialize: seed = random point; selected = {seed}; dist[i] = inf for all i
for step t = 1 to M:
    update dist[i] = min(dist[i], d(i, last_selected)) for all i
    select point j = argmax_i dist[i]
    selected = selected + {j}
output: M-point set with near-uniform spatial coverage
```

FPS guarantees a coverage disk of radius ≤ 2 × (optimal coverage radius),
significantly better than random sampling for preserving geometric structure
at object boundaries.

### 8.2 Complexity and GPU Acceleration

```text
naive:        O(N * M) -- update all N distances after each selection
with KD-tree: O(N log N) amortized (candidate pruning)
GPU tile-based (cuFPS, bucket-based FPS): 3-4x over naive GPU
```

Tile-based GPU FPS partitions the cloud into spatial buckets; each bucket
computes local farthest-point selection in parallel, then a global merge pass
reconciles bucket boundaries. This reduces the serial bottleneck from O(M)
serial steps to O(M / T) where T is the number of tiles.

### 8.3 Why RandLA-Net Replaced FPS

FPS on 10^6 points requires iterating 1000 times to sub-sample to 10^3 points,
each iteration updating distances for ~10^6 points. Even with GPU acceleration
this dominates end-to-end latency. RandLA-Net replaces FPS with random
sampling (O(N) uniform draw) and compensates with a stronger LFA module and
residual connections. The accuracy penalty is modest on large outdoor scenes
where density is approximately uniform on average and the LFA's attentive
pooling recovers discriminative neighborhood context.

---

## 9. Sparse-Voxel Coordinate Maps

### 9.1 Core Concept

When a LiDAR cloud is voxelized, occupied voxels are typically 1–5% of the
bounding-box volume (the *submanifold sparsity* assumption). Dense 3D
convolution wastes 95–99% of the FLOP budget on empty voxels. The coordinate
map stores only occupied voxels as integer-coordinate tuples:

```text
key: (batch, x, y, z) -- integer coordinates after voxelization
value: row index in the feature tensor

feature tensor F: shape [N_occupied, C]
                  where N_occupied << total_voxels
```

### 9.2 Kernel-Map / Rule-Book Construction

Before a sparse convolution with kernel size K^3, for every occupied voxel V_i
and every kernel offset delta in {-K/2 .. K/2}^3:

```text
if hash(V_i + delta) is in the coordinate map:
    emit triple (input_index, output_index, kernel_offset)

this set of triples = kernel map (SpConv) = rule book (MinkowskiEngine)
cost: O(N * K^3) hash probes per layer per forward pass
```

The kernel map is built once per layer and then reused for the sparse GEMM.

### 9.3 Implementations: Hash-Table Approach

MinkowskiEngine's `CoordsManager` is the internal C++ struct managing the
coordinate hash table. SpConv v2's "hashmap_on_the_fly" rebuilds the map each
forward pass, trading pre-computation for reduced peak memory. TorchSparse uses
a hash map plus a Sparse Autotuner that searches tiling/warp configurations:

```text
TorchSparse++ vs MinkowskiEngine on A100: 2.9x inference speedup
TorchSparse++ vs SpConv v2: 1.7x inference speedup
validated across seven AV benchmarks (TorchSparse++ MICRO 2023)
```

### 9.4 Binary-Search Approach (Minuet, 2024)

Minuet sorts occupied coordinates using GPU radix sort (NVIDIA CUB) and
constructs the kernel map via Segmented Sorting Double-Traversed Binary Search
instead of hash probes. This avoids hash-collision overhead and achieves lower
build-time than prior engines, especially for large kernels. The key insight:
for a sorted coordinate array, checking whether a neighbor coordinate exists
is a binary search — O(log N) per probe but with better cache behavior than
hash lookups under collision-heavy conditions.

### 9.5 Engine Comparison

| | MinkowskiEngine | SpConv v2 | TorchSparse++ | Minuet (2024) |
|---|---|---|---|---|
| Coordinate system | `[x,y,z,batch]` | `[batch,x,y,z]` | `[batch,x,y,z]` (v2.1) | sorted coordinate array |
| Kernel map strategy | Hash table (CoordsManager) | hashmap_on_the_fly | Hash map + Autotuner | Radix sort + binary search |
| Negative coords | Supported | Supported | Supported (v2.1) | Supported |
| Inference speed (A100) | Baseline | ~1.7× vs ME | ~2.9× vs ME | lower build overhead esp. large K |

---

## 10. Serialization: Space-Filling-Curve Ordering

### 10.1 Morton (Z-Order) Code

Interleave bits of the three integer coordinates:

```text
given x = b2 b1 b0,  y = c2 c1 c0,  z = d2 d1 d0
Morton code = d2 c2 b2  d1 c1 b1  d0 c0 b0

computed in O(1) per point via BMI2 CPU instructions or CUDA __brev
```

Points with nearby Morton codes are spatially close, but the Z-curve has
discontinuities at quadrant boundaries — points that are spatially adjacent
can have very different Morton codes if they straddle a quadrant edge.

### 10.2 Hilbert Curve

A continuous space-filling curve with strictly better locality than Morton:
neighboring points in Hilbert order are always spatially adjacent (no
quadrant-jump discontinuities). Encoding requires a rotation lookup table
and is more expensive than Morton, but:

```text
Hilbert ordering reduces cache misses by 25-75% vs Morton
runtime reduction for radius-neighbor queries on large clouds: up to 50%
(SFC paper arXiv 2603.06771)
```

### 10.3 Transposed Variants and Linear Octree

PTv3 uses Trans Z-order (y-axis prioritized before x) and Trans Hilbert,
created by permuting axis traversal order. This creates four distinct
serialization orderings (Z, Trans-Z, Hilbert, Trans-Hilbert). Successive
transformer layers rotate through them so any two points that share a patch
in one layer are non-locally connected in the next, expanding the effective
receptive field without increasing computational cost.

A linear octree represents the octree implicitly as a sorted array of
Morton-coded leaf node addresses with no explicit pointers. Range queries
become binary search on the sorted array followed by a spatial filter:

```text
linear octree: 2-4x faster radius queries for > 10M points
               vs pointer-based octrees (reduced memory + better cache)
```

### 10.4 PTv3 Patch Attention: Eliminating Neighbor Search

PTv3 replaces explicit kNN queries entirely with space-filling-curve patch
attention:

```text
1. Sort all LiDAR points along SFC (Morton or Hilbert order)
2. Group into non-overlapping fixed-size patches (16-4096 points)
3. Apply local multi-head attention within each patch -- no kNN query issued
4. Alternate between Z, Trans-Z, Hilbert, Trans-Hilbert orderings across layers

effect vs PTv2:
  3.3x inference speedup
  10.2x memory reduction
  RPE computation (26% of PTv2 forward time) fully eliminated
```

The locality guarantee comes from the SFC sort rather than explicit neighbor
lookup. This is the most significant structural change in transformer-based
3D segmentation since PTv1.

---

## 11. Aggregated Maps at Scale: Million-to-Billion-Point Search

### 11.1 The Memory Wall

```text
100M-point KD-tree (FLANN, float32 XYZ, ~40-80 bytes/node): 4-8 GB RAM
airport airside map at 5mm resolution: > 500M points
single KD-tree for full airport map: 20-40 GB (exceeds single GPU VRAM)
single KD-tree at 1B points: 40-80 GB (often exceeds single-node RAM)
```

No single-tree exact neighbor search is feasible for full-resolution airside
maps. Three strategies address this.

### 11.2 Chunked / Tile-Based Neighbor Search

Partition the map into spatial tiles (e.g., 50 m × 50 m × 10 m). Build a
KD-tree per tile with a small overlap margin. At query time:

```text
1. Coarse spatial index (octree or 2D grid) over tiles -- O(1) tile lookup
2. Load only the tiles whose bounding box overlaps the query radius
3. Issue exact kNN / radius query against those per-tile trees
```

This is the standard approach in HD-map production ICP refinement pipelines.
The overlap margin (typically 5–10% of tile size) ensures no query misses
cross-boundary neighbors.

### 11.3 OctoMap Streaming

OctoMap supports lazy loading of subtrees from `.bt` binary files, enabling
out-of-core access for maps that exceed RAM. Useful for airside static-map
queries at low frequency (map validation, offline annotation); not suitable
for real-time scan-to-map correspondence which requires the full index hot in
memory.

### 11.4 Billion-Scale ANN: BANG

BANG keeps the HNSW graph on host RAM and streams micro-batches to GPU for
distance computation. This decouples index size from VRAM limit:

```text
full HNSW graph for 1B points: >> 80 GB (cannot fit in A100 VRAM)
BANG: streams neighborhoods to GPU; achieves billion-scale search on single A100
tradeoff: PCIe bandwidth becomes the bottleneck for high-QPS workloads
```

### 11.5 Superpoint Methods: Sidestep Dense Search

The Superpoint Graph (SPG) pipeline partitions the input cloud into
geometrically homogeneous superpoints — clusters of ~20–200 points sharing
similar normal, planarity, and linearity attributes — using VCCS-style
voxel-seeded region growing on an octree.

```text
raw cloud:   N points    -- kNN search O(N log N) per query
SPG graph:   N/s nodes   -- s = average superpoint size (~20-200 points)
                            3-5 orders of magnitude fewer nodes
per-node neighbor queries: O(K) in adjacency graph, K ≈ 4-12 edges -- nearly free
```

Graph convolution and semantic inference operate on SPG nodes, not individual
points. The cost is a one-time graph construction (octree build + region
growing), amortized across many inference passes on the same static map. The
Superpoint Transformer (Robert et al., 2023) extends this with learned
superpoint features and inter-superpoint attention, maintaining the same O(K)
per-node search structure.

---

## 12. Algorithm Steps: Choosing and Using a Search Structure

### 12.1 Selection Decision Tree

```text
Query type?
  |
  +-- exact geometric (3D Euclidean, d <= 3) and N <= 50M?
  |     -> KD-tree (FLANN / nanoflann / PCL KdTreeFLANN)
  |        exact radius: Open3D search_radius_vector_3d
  |        bounded radius+count: Open3D search_hybrid_vector_3d (RKNN)
  |
  +-- exact geometric and N > 50M (map scale)?
  |     -> chunked tile-based KD-trees (§11.2)
  |        or OctoMap streaming for low-frequency queries (§11.3)
  |
  +-- approximate geometric, GPU, real-time inference?
  |     -> FRNN or torch-cluster for kNN/radius in PyTorch autograd
  |        grid-hash GPU kNN for uniform-density point clouds
  |
  +-- sparse convolution backbone?
  |     -> SpConv v2 (industry standard) or TorchSparse++ (research SOTA)
  |        coordinate map + kernel map construction is internal to the engine
  |        Minuet for large-kernel or memory-constrained settings
  |
  +-- descriptor matching / feature-space ANN (d = 33-1024)?
  |     -> FAISS HNSW (CPU, single machine) or cuVS/CAGRA (GPU)
  |        IVF-PQ for billion-scale with memory constraint
  |
  +-- billion-scale, single GPU?
        -> BANG (graph on host RAM, stream to GPU)
```

### 12.2 Gating Before Matching

Use gates before accepting a candidate match:

```text
spatial distance    < d_max
normal angle        < angle_max
range difference    < range_max
time difference     < dt_max
semantic class      compatible
Mahalanobis dist    < chi_square_threshold
```

For tracking or calibrated fusion, Mahalanobis gating is more correct than
Euclidean gating:

```text
d2 = (z - h(x))^T * S^-1 * (z - h(x))
```

where S includes measurement and prediction uncertainty. Spatial gates reduce
the candidate set before the more expensive Mahalanobis check.

---

## 13. Implementation Notes

- Use squared distances internally to avoid unnecessary square roots. All PCL
  and FLANN kNN interfaces accept a max-distance-squared parameter for this
  reason.
- Rebuild KD-trees when many points move or are deleted. For per-frame point
  clouds, rebuilding is often cheaper than maintaining a balanced dynamic tree.
- For voxel grids, store both resolution and origin in map metadata. Changing
  either changes every cell key; this breaks reproducibility across runs.
- Use 64-bit integer keys for large maps. Floating-point world coordinates are
  poor hash keys due to precision noise and negative-index wraparound.
- For rolling maps, separate local metric coordinates from global geodetic map
  tile IDs to avoid precision loss far from the origin.
- Tune voxel size jointly with sensor noise, point density, registration
  threshold, and map update rate.
- ANN indexes need recall tests on the actual descriptor distribution, not only
  standard benchmark vectors; outdoor LiDAR descriptor distributions differ
  significantly from deep-learning embedding benchmarks.
- Ensure thread-safe reads if registration, mapping, and planning query the
  same map concurrently. PCL KD-trees are read-safe but not write-safe.
- For sparse-conv engines: profile kernel-map build time separately from GEMM
  time. On small batches, kernel-map construction dominates; on large batches,
  GEMM dominates. TorchSparse's Autotuner switches strategy at a profiled
  crossover point.
- When FPS is required (PointNet++ training), use tile-based GPU FPS for
  N > 50k; for N > 500k, prefer random sampling + stronger LFA (RandLA-Net
  pattern) unless coverage uniformity is safety-critical.

---

## 14. Failure Modes and Diagnostics

| Symptom | Likely cause | Diagnostic |
|---|---|---|
| ICP residual is low but pose is wrong. | Nearest-neighbor search returns repeated-structure matches (symmetry, long corridors). | Visualize correspondence lines and semantic labels; add normal-angle gate. |
| Runtime spikes in dense scenes. | Radius search returns too many neighbors; no `nsample` cap. | Log neighbor-count percentiles by range bin and scene type. |
| Map has seams at tile boundaries. | Voxel key origin or projection differs between tiles; no overlap margin. | Query identical world points in adjacent tiles and compare cell IDs. |
| Object clustering fragments at long range. | Fixed metric radius ignores range-dependent point density. | Plot neighbor counts vs. range; switch to kNN or angular-bin grouping. |
| ANN feature matching loses rare landmarks. | Approximate search recall is uneven across descriptor regions. | Compare ANN matches to brute force on labeled validation queries. |
| Non-deterministic regression outputs. | Hash iteration order affects tie-breaking in label voting. | Sort candidates by stable key before resolving ties. |
| Sparse-conv training OOM. | Kernel map for large K^3 expands N_occupied × K^3 triples. | Reduce K, use submanifold sparse conv for encoder layers, or switch to Minuet. |
| FPS bottleneck in PointNet++ inference. | Naive O(N·M) FPS dominates at N > 100k. | Profile FPS vs. rest of forward pass; replace with random sampling + stronger LFA. |
| KD-tree build stalls at map scale. | N > 100M points; single-tree build exceeds available RAM. | Switch to chunked tile-based trees with coarse spatial index over tiles. |
| PTv2 attention slow despite kNN caching. | RPE computation inside kNN set dominates; 26% of forward time. | Upgrade to PTv3 SFC-patch attention which eliminates explicit kNN and RPE. |

---

## 15. Library Landscape

| Library | Primary focus | Neighbor search primitives | GPU | Notes |
|---|---|---|---|---|
| **FLANN** | C++ ANN for moderate N | KD-tree, LSH, k-means tree | No | Used inside PCL and Open3D |
| **nanoflann** | Header-only KD-tree | KD-tree only | No | Zero-dependency; preferred for embedded/edge |
| **Open3D** | 3D geometry + ML | KDTreeFlann (kNN, radius, RKNN), ML knn_search (CUDA) | Partial | Full pipeline from raw cloud to mesh; RKNN is the workhorse |
| **PCL** | Robot perception | KdTreeFLANN, Octree (voxel/kNN/radius), OctreeChangeDetection | No | Gold standard for ROS/Autoware pipelines |
| **FAISS** | High-dim vector search | IVF-Flat, IVF-PQ, HNSW, GPU brute-force | Yes | Best for feature-space ANN (FPFH, DINOv2); not 3D-specific |
| **NVIDIA cuVS** | GPU-native vector search | CAGRA, IVF-Flat, IVF-PQ, IVF-RaBitQ | GPU-native | Successor to RAFT; billion-scale; 2.2× over CAGRA at Recall≥0.95 |
| **FRNN** | GPU radius search | Fixed-radius NN (grid hash) | GPU | PyTorch interface; brute force beats it for N < 10k |
| **torch-cluster** | PyG graph ops | kNN, radius, FPS | CUDA | Standard in PyTorch Geometric pipelines |
| **ANN** (Arya et al.) | C++ ANN | KD-tree (approximate) | No | Historical reference; largely superseded by FLANN |
| **Minuet** | Sparse conv kernels | Binary-search kernel map | GPU | Not a general neighbor library; specific to sparse conv |

**Positioning notes:**

- For *backbone training / inference* (KPConv, RandLA-Net, PointNet++): use
  **torch-cluster** or **FRNN** for GPU kNN/radius inside PyTorch autograd.
- For *map-level offline queries* (ICP, SPG construction, label propagation):
  use **PCL KdTreeFLANN** or **Open3D** on CPU; tile the map for N > 50M.
- For *feature-matching ANN* (descriptor matching, place recognition): use
  **FAISS** (CPU HNSW) or **cuVS/CAGRA** (GPU).
- For *sparse convolution backbone*: **SpConv v2** (AV industry standard) or
  **TorchSparse++** (research SOTA throughput); coordinate-map hash tables are
  internal to both.
- For *billion-scale aggregated map search*: **BANG** (single GPU, host-RAM
  index) or tile-based chunked KD-trees (multi-node, exact search).

---

## 16. Sources

- Jon Louis Bentley, "Multidimensional Binary Search Trees Used for Associative Searching": https://cacm.acm.org/research/multidimensional-binary-search-trees-used-for-associative-searching/
- Bentley KD-tree PDF copy: https://www.cs.rpi.edu/~cutler/classes/advancedgraphics/S23/papers/bentley_kdtree_1975.pdf
- Point Cloud Library KD-tree search tutorial: https://pointclouds.org/documentation/tutorials/kdtree_search.html
- PCL KdTreeFLANN class: https://pointclouds.org/documentation/classpcl_1_1_kd_tree_f_l_a_n_n.html
- PCL octree tutorial: https://pointclouds.org/documentation/tutorials/octree.html
- PCL supervoxel / VCCS tutorial: https://pointclouds.org/documentation/tutorials/supervoxel_clustering.html
- Marius Muja and David G. Lowe, "Fast Approximate Nearest Neighbors with Automatic Algorithm Configuration": https://www.scitepress.org/papers/2009/17878/pdf/index.html
- FLANN project repository and references: https://github.com/flann-lib/flann
- nanoflann (deepwiki PCL search structures): https://deepwiki.com/PointCloudLibrary/pcl/5.3-search-structures
- OctoMap project: https://octomap.github.io/
- Open3D KDTreeFlann API: https://www.open3d.org/docs/release/python_api/open3d.geometry.KDTreeFlann.html
- Open3D KDTree tutorial: https://www.open3d.org/docs/latest/tutorial/Basic/kdtree.html
- Open3D ML knn_search: https://www.open3d.org/docs/release/python_api/open3d.ml.torch.ops.knn_search.html
- PointNet++ paper arXiv 1706.02413: https://arxiv.org/pdf/1706.02413
- KPConv diagram / range search comparison (ResearchGate): https://www.researchgate.net/figure/Comparison-between-SPConv-and-KPConv-For-a-query-point-a-range-search-is-performed-to_fig1_354867427
- RandLA-Net CVPR 2020: https://openaccess.thecvf.com/content_CVPR_2020/papers/Hu_RandLA-Net_Efficient_Semantic_Segmentation_of_Large-Scale_Point_Clouds_CVPR_2020_paper.pdf
- RandLA-Net arXiv 1911.11236: https://arxiv.org/pdf/1911.11236
- Point Transformer V3 CVPR 2024: https://openaccess.thecvf.com/content/CVPR2024/papers/Wu_Point_Transformer_V3_Simpler_Faster_Stronger_CVPR_2024_paper.pdf
- PTv3 arXiv 2312.10035: https://arxiv.org/html/2312.10035v2
- HNSW paper (Malkov & Yashunin): https://arxiv.org/pdf/1603.09320
- FAISS — Engineering at Meta: https://engineering.fb.com/2017/03/29/data-infrastructure/faiss-a-library-for-efficient-similarity-search/
- FAISS docs: https://faiss.ai/index.html
- NVIDIA cuVS: https://rapids.ai/cuvs/
- NVIDIA cuVS IVF-PQ deep dive: https://developer.nvidia.com/blog/accelerating-vector-search-nvidia-cuvs-ivf-pq-deep-dive-part-1/
- NVIDIA cuVS blog (RAFT): https://developer.nvidia.com/blog/accelerating-vector-search-using-gpu-powered-indexes-with-rapids-raft/
- IVF-RaBitQ paper arXiv 2602.23999: https://arxiv.org/pdf/2602.23999
- GGNN paper arXiv 1912.01059: https://ar5iv.labs.arxiv.org/html/1912.01059
- BANG paper arXiv 2401.11324: https://arxiv.org/html/2401.11324v4
- FRNN GitHub: https://github.com/lxxue/FRNN
- torch-cluster FPS discussion: https://github.com/rusty1s/pytorch_cluster/issues/102
- bucket-based FPS GitHub: https://github.com/hanm2019/bucket-based_farthest-point-sampling_GPU
- cuFPS GitHub: https://github.com/hova88/cuFPS.example
- ACM GPU ICP benchmark 2025: https://dl.acm.org/doi/10.1145/3716875
- MinkowskiEngine docs: https://nvidia.github.io/MinkowskiEngine/source/MinkowskiEngine.html
- TorchSparse++ arXiv 2311.12862: https://arxiv.org/pdf/2311.12862
- TorchSparse++ MICRO 2023 (MIT HAN Lab): https://hanlab.mit.edu/projects/torchsparse
- TorchSparse v2.1 changes: https://torchsparse-docs.github.io/getting_started/changes.html
- Minuet arXiv 2401.06145: https://arxiv.org/pdf/2401.06145
- Minuet LinkedIn explainer: https://www.linkedin.com/pulse/unlocking-power-binary-search-sparse-convolutions-christina-giannoula-hjenc
- SPG CVPR 2018: https://openaccess.thecvf.com/content_cvpr_2018/papers/Landrieu_Large-Scale_Point_Cloud_CVPR_2018_paper.pdf
- Z-order / Morton Wikipedia: https://en.wikipedia.org/wiki/Z-order_curve
- Morton bit-interleaving blog (Jeroen Baert): https://www.forceflow.be/2013/10/07/morton-encodingdecoding-through-bit-interleaving-implementations/
- SFC + linear octree paper arXiv 2603.06771: https://arxiv.org/pdf/2603.06771
- SFC memory mapping blog: https://sai-yeswanth-g.github.io/posts/z_order_curve/
- ASH spatial hashing (CMU): https://www.cs.cmu.edu/~kaess/pub/Dong23pami.pdf
- Voxel hashing (Nießner 2013): https://niessnerlab.org/papers/2013/4hashing/niessner2013hashing.pdf
- Dynamic removal — Arora et al. ECMR 2021: https://www.ipb.uni-bonn.de/wp-content/papercite-data/pdf/arora2021ecmr.pdf
- MRPT ICP docs: https://docs.mrpt.org/reference/latest/tutorial-icp-alignment.html
- LearnOpenCV ICP explainer: https://learnopencv.com/iterative-closest-point-icp-explained/
- MIT LSH home: https://www.mit.edu/~andoni/LSH/
- LSH Wikipedia: https://en.wikipedia.org/wiki/Locality-sensitive_hashing
- Pinecone HNSW explainer: https://www.pinecone.io/learn/series/faiss/hnsw/
- scikit-learn nearest neighbors: https://scikit-learn.org/stable/modules/neighbors.html
- Cover tree paper (Beygelzimer et al. ICML 2006): https://faculty.cc.gatech.edu/~isbell/reading/papers/cover-tree-icml.pdf
- TorchSparse paper arXiv 2204.10319: https://arxiv.org/pdf/2204.10319
