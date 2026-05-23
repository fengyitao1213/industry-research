# Large-Scale 3D Segmentation: Tiling, Stitching, and Throughput Engineering

**Last updated:** 2026-05-23

This page is the deep-dive companion to §8 (Tiling, Chunking, and Stitching) of the [Aggregated-Map Semantic Segmentation](aggregated-map-semantic-segmentation.md) hub page. It covers the full engineering discipline of partitioning billion-point outdoor clouds into GPU-sized tiles, merging partial predictions without seam artifacts, and achieving production-viable throughput — with particular attention to airside aerial LiDAR pipelines where no latency budget exists but accuracy and reproducibility are paramount. Readers implementing a new pipeline should also read §3 (Pipeline Architecture) and §15 (Recommended Pipeline) of the hub page alongside this document.

---

## Why Tiling Is Unavoidable

### The Memory–Scale Mismatch

A single 100 × 100 m outdoor tile at 500 points/m² contains 5 × 10⁶ points. A mapped airport apron at 1 km² with 200–1,000 pts/m² runs 2 × 10⁸ to 10⁹ points. At 16 bytes per point (XYZ + intensity, FP32), 10⁸ points occupies approximately 1.6 GB in raw coordinates alone; with 64-dimensional learned per-point features in FP32 the tensor reaches 25.6 GB — one to two orders of magnitude above a single 24 GB GPU.

Intermediate network activations multiply the requirement by 2–8×. A standard SparseConvUNet at 200k active voxels (FP32, batch size 1) already occupies approximately 6–12 GB depending on channel widths; doubling to 400k voxels roughly doubles activation memory. Even with NVLink-pooled multi-GPU configurations (up to 640 GB for 8 × H100 SXM), map-scale billion-point clouds must be partitioned. The question is how to partition without losing cross-tile context, and how to merge partial predictions without seam artifacts.

### The Fundamental Constraint

```
tile_points <= GPU_mem_budget / (bytes_per_point * feature_factor * activation_overhead)
```

Increasing tile size captures more context (better continuity at boundaries) but risks OOM. Decreasing it is safe but degrades predictions for points near tile edges where the network's receptive field is truncated. Every tiling strategy is a point on this memory-versus-context trade-off curve.

### Why Scan Aggregation Compounds the Problem

Single-frame LiDAR scans (a Velodyne HDL-64E at 10 Hz produces roughly 130k points per frame) fit comfortably on a modern GPU. The scaling problem is entirely a map-construction artefact: building a high-density static map by aggregating hundreds or thousands of frames registered against a common coordinate frame produces point densities of 500–5,000 pts/m² — one to two orders of magnitude above single-scan density. The per-point-cloud inference architecture that works for real-time AV perception is not directly applicable to map-scale annotation without tiling.

Airside maps add a compounding factor: airport aprons are large continuous open surfaces (a typical international airport apron is 1–5 km²) with minimal occlusion structure, meaning there are few natural seams that could be exploited as tile boundaries. The tiling strategy must therefore be entirely artificial, and the stitching problem is proportionally more acute than in urban environments where buildings and blocks provide natural scene structure.

For related first principles on point-cloud memory representation, see [Point-Cloud Representations and Voxelization — First Principles](../../../10-knowledge-base/geometry-3d/point-cloud-representations-voxelization-first-principles.md).

---

## Partition Strategies

Five strategies cover the production and research landscape. They differ in edge-artifact risk, density handling, determinism, and whether they dissolve tiling entirely.

### Fixed-Grid (Cartesian Box) Tiles with Overlapping Halos

The dominant production strategy. The scene bounding box is divided into a regular 2D grid in X–Y (with full Z extent, or a clamped Z slab for BEV alignment). Each tile is composed of an inner Zone of Responsibility (ZoR) plus a halo border on all sides:

```
input_tile_size = ZoR + 2 * halo
stride = ZoR   (non-overlapping outputs; overlapping inputs)
halo >= 0.5 * network_receptive_field
```

ECLAIR (SharperShape, ICCV 2024) uses exactly this: 1,246 tiles × 100 × 100 m, voxel 0.05 m, trained and inferred on AWS g5.12xlarge (4 × A10G), batch size 2 per GPU. It is the only publicly documented production-style aerial LiDAR segmentation pipeline with explicit tile dimensions.

**Strengths:** deterministic, trivially parallelisable across GPUs, simple manifest, tiles reusable across model iterations.

**Weaknesses:** axis-aligned cuts are arbitrary with respect to scene geometry; point density varies within a tile (dense near the sensor path, sparse at altitude or distance); halos bloat memory at map edges.

### Sphere / Chunk Sampling (KPConv-style)

KPConv (ICCV 2019) partitions by sampling random sphere centers, collects all points within radius r, and stacks variable-count spheres into a batch with a P-controller that caps total batch points to avoid OOM. Batch calibration keeps only 80–90 % of neighborhood points when density spikes, maintaining `avg_pts_per_sphere × spheres_in_batch ≈ target_total_pts`.

**Strengths:** naturally handles density variance; no hard edge artifacts (random center placement distributes boundary effects across many locations); sphere radius implicitly encodes the receptive field.

**Weaknesses:** stochastic — inference output varies with random sphere centers unless a fixed seed is used; overlapping spheres cause double-processing overhead.

**Determinism fix for inference:** enumerate a regular grid of sphere centers at stride < r; assign each point to its nearest center; run one forward pass per center; merge by logit-averaging in overlap zones.

### Voxel-Block Partition (Sparse-Conv Natural Unit)

Sparse-convolution frameworks (Minkowski Engine, SpConv, TorchSparse) represent scenes as hash-table sparse tensors. The natural partition is the GPU sparse-tensor memory block: voxelise the scene (typically 0.05–0.20 m resolution), extract a contiguous XY slab of B × B × H voxels, and pad to the nearest block-size multiple for memory alignment.

TorchSparse++ (MICRO 2023) achieves 2.9× speedup over MinkowskiEngine and 1.7× over SpConv v2 for full-scene inference, with 1.25× latency improvement over SpConv 2.3.5 on Orin, using this representation natively.

Practical voxel-size guidance:

| Domain | Voxel size | Active voxels (typical) |
|---|---|---|
| Indoor (ScanNet) | 0.02–0.05 m | Typically fits GPU unpartitioned |
| Outdoor driving (SemanticKITTI, ~70 × 70 m) | 0.05–0.10 m | ~200k |
| Map-scale (> 500 m extent) | 0.10–0.20 m | Mandatory tiling |

**Strengths:** integrates directly with existing training pipelines; no extra pre/post steps beyond normal voxelisation.

**Weaknesses:** edge voxels lack context from adjacent tiles unless halo voxels are explicitly included.

### Superpoint Partition — SPT and EZ-SP (Intrinsic Partition)

Superpoint methods dissolve fixed tiling by replacing the spatial grid with a geometry-driven over-segmentation. Points with similar geometric attributes (planarity, curvature, colour) are grouped into superpoints; a transformer then operates on superpoints rather than individual points.

**SPT (ICCV 2023):** uses the cut-pursuit algorithm on a nearest-neighbour graph; partition pre-computed on CPU; achieves up to 200× model-size reduction versus standard methods while matching or exceeding accuracy.

**EZ-SP (Dec 2025):** replaces SPT's CPU cut-pursuit with a learnable GPU partitioning module (< 60k parameters, < 2 MB VRAM), achieving 13× faster partitioning than prior CPU-based methods, 72× faster inference than point-based SOTA, and 5.3× faster than SPT end-to-end. Scales to multi-million-point scenes; validated on DALES aerial LiDAR — the closest public proxy to airside data.

For architectural details see [Superpoint Transformer](../methods/superpoint-transformer.md).

**Why this dissolves tiling:** superpoints are scene-adaptive; there are no fixed tile boundaries for artifacts to form at. The partition is intrinsic to the geometry.

**Strengths:** no seam artifacts; compact representation enables full-scene processing; state-of-the-art accuracy on aerial benchmarks.

**Weaknesses:** partition quality depends on accurate normals and geometry estimates; SPT pre-processing is CPU-bound (largely addressed by EZ-SP); harder to parallelise tile-independently.

### BEV Tile Slabs with Z Extent

A variant of fixed-grid relevant to outdoor and driving domains: project to Bird's-Eye View, tile in X–Y, retain full Z extent (ground to maximum structure height). Cylindrical-voxel methods such as Cylinder3D and PolarNet use polar (ρ, θ, z) coordinates rather than Cartesian X–Y — a natural fit for rotating-head LiDAR where angular resolution is uniform.

Cylinder3D uses approximately 480 × 360 × 32 voxels for a 50 m range per single LiDAR scan, fitting comfortably on a single GPU; extending to multi-scan aggregation requires expanding the radial range and switching to tiling.

**Partition strategy trade-off summary:**

| Strategy | Edge Artifacts | Density Handling | Determinism | Partition Reuse | Memory Scaling |
|---|---|---|---|---|---|
| Fixed-grid (Cartesian) | Yes — halo mitigates | Poor | Yes | Yes | Linear in tiles |
| Spherical sampling | Mild — random diffused | Good | Seed-fixed only | Partial | Linear in spheres |
| Voxel-block | Yes — halo mitigates | Native sparse | Yes | Yes | Depends on resolution |
| Superpoint (SPT/EZ-SP) | None | Excellent | Yes | Yes | Sub-linear |
| BEV/cylindrical slab | Mild — Z is full | Good for radial data | Yes | Yes | Linear in tiles |

---

## Tile Size and Overlap Selection

### Memory Budget Formula

```
max_tile_voxels = (GPU_mem_budget_bytes * utilisation_fraction) /
                  (bytes_per_voxel * channel_width * activation_multiplier)
```

Typical values for sparse-conv UNet: `bytes_per_voxel` ≈ 4–8 B sparse index plus 4 × C feature bytes; `activation_multiplier` ≈ 4–6× for a UNet with skip connections; `utilisation_fraction` ≈ 0.70 (leave headroom for framework overhead).

Example for a 24 GB GPU, FP16, 32-channel UNet, activation multiplier 5:

```
max_tile_voxels ≈ (24e9 * 0.70) / ((8 + 8*32) * 0.5) ≈ ~600k active voxels
```

At 0.10 m voxel resolution, 600k voxels correspond to roughly 6,000 m³ volume. For a 3 m height slab (ground ± 1.5 m) that yields approximately a 45 × 45 m XY footprint — somewhat smaller than ECLAIR's 100 × 100 m tiles because ECLAIR uses finer 0.05 m voxels on hardware with four GPUs sharing the load.

**Worked sizing example for an airside apron:**

```
Target: A10G 24 GB GPU, Minkowski ResUNet14C (similar to ECLAIR)
Architecture: 4-level sparse UNet, ~64 channels at first level
activation_multiplier = 5 (UNet with skip connections)
bytes_per_voxel = 8 B index + 4*64 feature bytes = 264 B/voxel
utilisation_fraction = 0.70

max_tile_voxels = (24e9 * 0.70) / (264 * 5) = ~12.7M

At 0.05 m voxel: 12.7M voxels at 0.05m each = volume of 1,587 m^3
  For 5 m height extent: XY footprint ≈ 317 m^2 ≈ 18 x 18 m  -- too small
  Reduce to 0.10m: footprint ≈ 127 m^2 ≈ 56 x 56 m  -- viable
  Add 10 m halo on each side: input tile = 76 x 76 m, ZoR = 56 x 56 m
```

This sizing exercise explains why ECLAIR's 100 × 100 m tiles require 4 GPUs at batch size 2 — scaling the ZoR to 100 m at 0.05 m voxels demands distributing the activation memory across the batch dimension and GPU count.

### Halo Width: Half the Receptive Field

The consensus from both the NIST exact-tile literature and the point-cloud segmentation community is:

```
halo >= 0.5 * network_receptive_field_radius
```

This guarantees that every output point in the ZoR has full context as if processed in a single full-scene forward pass. Points within ½ RF of the tile edge receive truncated context if halo is zero; with halo = ½ RF they are fully covered.

**Architecture-specific guidelines (outdoor, 0.10 m voxels):**

| Architecture | Typical Receptive Field | Recommended Halo |
|---|---|---|
| Sparse ConvUNet 3-level | 3–5 m | 2.5–3 m (25–30 voxels) |
| Sparse ConvUNet 4-level | 5–8 m | 4–5 m |
| KPConv (r = 2 m, 4 layers) | ~4 m | 2–3 m |
| Point Transformer V3 (patch 1024) | ~6–10 m | 5–6 m |
| Superpoint (SPT / EZ-SP) | N/A — full-scene context | N/A — no fixed tiles |

For Point Transformer V3 (space-filling curve serialisation with patch-grouped attention), the effective receptive field is essentially global across the patch. Tiles of 50–100 m with 10 m halos are a practical starting point pending empirical seam-consistency verification.

**Safe rule of thumb:** use halo = 1.5 × (½ RF) — a 50 % safety margin — and verify with the seam-consistency metric defined below.

**Halo budget impact:** a 10 m halo on a 50 × 50 m ZoR expands the input tile area by approximately 44 % (70 × 70 m input versus 50 × 50 m output). At constant voxel resolution this directly increases per-tile memory cost. Quantify the halo tax before finalising tile configuration:

```
halo_area_fraction = (ZoR + 2*halo)^2 / ZoR^2 - 1
  for ZoR=50m, halo=10m: (70/50)^2 - 1 = 0.96  -- halo doubles the tile area
  for ZoR=100m, halo=10m: (120/100)^2 - 1 = 0.44 -- 44% overhead
```

Larger ZoR amortises the halo tax; this is another reason to prefer larger tiles on high-memory hardware.

---

## Stitching and Label Merge

Stitching is where partition decisions become visible in output quality. Seam artifacts appear when adjacent tiles produce inconsistent predictions for points near their shared boundary. Three root causes: (1) truncated receptive field from undersized halos; (2) normalization-layer statistics that differ tile-by-tile; (3) double-counting or double-processing of halo points.

### Hard Crop (ZoR Only)

Discard all predictions outside each tile's ZoR. No averaging, no overlap zone. Simple, deterministic, O(N) post-processing. Correct when halo ≥ ½ RF — the condition guarantees every ZoR point has full context, so no additional blending is needed.

**Limitation:** if the halo is borderline insufficient, seam artifacts appear as sharp prediction discontinuities. There is no smoothing to mask the error.

### Per-Point Label Voting

For points in an overlap zone, collect class predictions from all tiles covering that point and take a majority vote. Common in remote-sensing literature; low implementation complexity.

**Limitation:** voting on hard labels discards probability mass. A wrong-but-high-confidence tile can dominate the vote. Not recommended when logits are accessible.

### Logit Averaging (Preferred)

When the network exposes raw logits (pre-softmax scores), average logits across all tiles covering each point, then apply argmax once:

```
logit_merged[p] = (1 / N_tiles_covering_p) * sum_over_t(logit_tile_t[p])
label[p] = argmax(softmax(logit_merged[p]))
```

Equivalent to ensemble averaging in probability space but numerically more stable. Outperforms hard-vote and single-tile methods on remote-sensing segmentation benchmarks.

**Gaussian-weighted variant:** weight each tile's contribution by distance from its center:

```
w_t(p) = exp( -||p - centre_t||^2 / (2 * sigma^2) )
sigma = ZoR / 2
```

Central points receive full weight; edge points blend contributions from adjacent tiles. This is the approach used by nnU-Net's sliding-window inference in the image domain; the principle transfers directly to 3D point clouds. The stitching/merge step is post-processing-adjacent — readers implementing this should also consult [Segmentation Post-Processing and Label Refinement](segmentation-post-processing-label-refinement.md).

### Zone-of-Responsibility Split to Avoid Double-Counting

The ZoR / halo split is the clean solution to double-counting: each tile owns exactly its ZoR; halo points are used as input context but their predictions are discarded. This is the protocol from the NIST exact-tile method and is the appropriate default when the hard-crop correctness condition (halo ≥ ½ RF) is verified.

### Seam-Consistency Metrics

- **Tile mismatch score:** `median(1 - Dice)` computed in the overlapping strip between each adjacent tile pair. Target: < 0.02. Values > 0.05 indicate a systematic seam problem requiring investigation.
- **Train/eval disparity:** `1 - Dice(P_train_global, P_eval_tiled)` — the gap between predictions generated in a single large forward pass versus tiled inference. A large disparity indicates normalization-induced shift (see below).
- **Boundary IoU:** compute IoU restricted to the ±halo strip around each tile boundary, reported per class. Surfaces classes (pavement, terrain) and thin linear classes (kerb, fence) will typically show the largest boundary IoU drop.

---

## Normalization-Layer Tile Artifacts

Tiling artifacts have a second root cause beyond truncated receptive fields: tile-wise normalization statistics.

**InstanceNorm tile-dependency:** InstanceNorm computes mean and variance per channel per sample at inference time. When a tile is processed in isolation, its normalization statistics reflect only that tile's point distribution — which differs from what they would be if the tile were processed as part of the full scene. This produces a consistent per-tile feature shift that manifests as visible seam artifacts even when the halo is correctly sized.

**Diagnostic:** compute train/eval disparity (above). If disparity is large even with a generous halo, normalization is the likely cause.

**Fix — BatchRenorm:** replace InstanceNorm with BatchRenorm, which uses running global statistics consistently at inference rather than tile-local statistics. This eliminates normalization-induced seam artifacts even at halo = 0. An alternative is GroupNorm or LayerNorm, both of which are independent of the number of input samples and produce consistent statistics regardless of tile size.

This finding was documented in 2025 work on tiling artifacts and feature normalization (arXiv 2503.19545). Practitioners using pre-trained models with InstanceNorm should test the train/eval disparity metric before assuming the halo is the bottleneck.

---

## Batched Inference Orchestration

### Variable-Density Tile Packing

LiDAR point density varies 10–100× across a map: dense along the sensor flight path or vehicle trajectory, sparse at altitude or in occlusion shadows, zero inside enclosed structures. Tiles at the same nominal spatial size contain wildly different point counts. Naive batching by tile count wastes GPU memory when sparse tiles leave most of the allocated memory unfilled.

**The SST padding problem:** the Sparse Self-attention Transformer (SST) pads each spatial window to a fixed maximum point count, wasting compute on padding tokens. Measured overhead: SST is approximately 3× slower than a sparse-conv baseline (CenterPoint) despite competitive accuracy.

**FlatFormer fix:** sort all points by a 1D space-filling key, partition into groups of equal point count rather than equal spatial extent. This eliminates padding waste while preserving spatial locality — see [FlatFormer](../methods/flatformer.md) for the method detail.

FlatFormer achieves:
- 4.6× speedup over SST
- 1.4× speedup over CenterPoint
- First point-cloud transformer achieving real-time throughput on Orin-class hardware

**Practical batch packing for map-scale inference:**

1. Pre-compute point counts for all tiles from the manifest.
2. Sort tiles by point count (descending) to cluster tiles of similar density.
3. Greedily pack tiles into the GPU memory budget using a bin-packing heuristic.
4. Pad each pack to the maximum count within that pack (small overhead when tiles are similar density).

### GPU Memory Budgeting Per Tile

```
available_activation_mem = total_GPU_mem * 0.70 - model_param_bytes
```

Empirical reference points from published benchmarks:

| Hardware | Model | Config | Latency |
|---|---|---|---|
| RTX 4090 (24 GB), batch 1 | PTv3-Extreme | Full scene | 253 ms/frame |
| 4 × A10G (24 GB each), batch 2/GPU | Minkowski ResUNet14C | 100×100 m tile, 0.05 m voxel | ~500 ms/tile (est.) |
| Orin (32 GB), batch 1 | TorchSparse++ | CenterPoint 3-frame | 1.25× faster than SpConv 2.3.5 |

All numbers are either directly from the cited papers or clearly labelled as estimates derived from paper context.

### Pipelined Data-Loading

Classic producer–consumer overlap:

- **CPU workers** (multiprocessing): decompress LAZ/LAS, voxelise, compute halo boundaries, serialise to tensor.
- **GPU**: inference on the previous batch simultaneously.
- `pin_memory=True` plus CUDA async copy enables DMA transfer while GPU is computing.
- `prefetch_factor=2–4` in PyTorch DataLoader prevents GPU stalls.

**Target:** CPU preprocessing time < GPU inference time. If CPU preprocessing dominates, add workers or cache pre-voxelised tiles to NVMe. If GPU inference dominates, batch packing (above) is the primary lever.

---

## Throughput Engineering

### Multi-GPU Tile-Level Parallelism

Tiles are independent after partition — the cleanest unit of parallelism. Assign the tile manifest to N workers:

```
worker_i processes tiles { manifest[j] : j % N == i }
```

No inter-GPU communication is required during inference; merge occurs only at the stitch step. This scales linearly in principle; in practice, I/O becomes the bottleneck at large N.

**SparsePipe (NeurIPS 2020)** formalises intra-batch spatial parallelism: input data is partitioned across GPUs with inter-batch pipelining to overlap communication and computation; demonstrated on an 8-GPU platform with improved per-sample throughput.

Published observations indicate that scaling from a single optimised GPU to a 100-GPU cluster can yield > 40× speedup for segmentation inference — consistent with near-linear tile-level scaling with I/O overhead eroding the last factor.

### Mixed Precision

- TorchSparse++ outperforms MinkowskiEngine by 2.9× across all precisions on A100.
- FP16 versus FP32: approximately 1.5–2× memory reduction enabling correspondingly larger tiles per GPU.
- BF16 is preferred over FP16 for training stability (larger dynamic range); FP16 is the standard choice at inference.

**Critical caveat for 3D sparse models:** TensorRT does not natively support sparse convolution. Most production pipelines use TorchSparse++ or SpConv as the inference backend rather than TensorRT for 3D volumetric models. Range-image and BEV-projection models (SalsaNext, RangeDet) are TensorRT-exportable and benefit from INT8 quantisation; sparse-conv models currently are not.

### SSM Backbones Do Not Remove the Tiling Contract

[Point-Cloud Mamba / SSM Backbones](../methods/point-cloud-mamba-ssm-backbones.md) reduce the per-token modeling cost inside a tile by replacing attention-heavy blocks with serialized state-space sequence modeling. That can make larger tiles or halos feasible, especially for long facades, service corridors, vegetation boundaries, and non-road urban districts where context matters. It does **not** remove the map-scale engineering contract:

- source clouds still need partition manifests, deterministic coordinate frames, and tile provenance;
- LAZ/LAS/COPC I/O, preprocessing, and cache layout can dominate wall-clock time even if the model is cheaper;
- overlap, no-clipping-point policy, seam metrics, and logit merging remain necessary because serialized sequence models still see truncated context at tile borders;
- serialization order becomes a new reproducibility field: store curve/order id, quantization, local origin, random seed, and model config with each run.

Treat SSMs as a throughput experiment alongside sparse-conv, PTv3, and SPT baselines, not as a reason to bypass tile QA or release manifests.

### Checkpointing for Long Batches

A 4-hour batch processing 1,000 tiles must be resumable without restarting from zero:

1. Write a tile manifest (CSV or JSON) with one row per tile: `{tile_id, status: pending|done|failed, output_path}`.
2. Atomically write output (`.npy` or `.las`) to `output_path` and update `status` to `done` only on confirmed write success.
3. On restart, skip tiles where `status == done`; re-queue `failed` tiles.
4. Idempotent by design: same partition seed + same model weights → same output.

A simple SQLite or flat-JSON manifest is sufficient for fewer than 500 tiles. For large deployments (10,000+ tiles), Dagster or Prefect asset-based orchestration provides retry logic, lineage tracking, and monitoring dashboards.

### I/O Patterns for Billion-Point Clouds

| Format | Compression | Random Access | Read Speed | Notes |
|---|---|---|---|---|
| LAS (raw) | None | Byte offset | Very fast | 7–14× disk versus LAZ |
| LAZ | Entropy (7–25 % of LAS size) | Block-based | Moderate | De facto standard; random access requires block decompression |
| Memory-mapped LAS | None | Full | RAM-speed | Viable only if RAM ≥ scene size |
| Octree-compressed | OctSqueeze | Hierarchical | Fast for region queries | Better suited for city-scale streaming |

**Production recommendation:** store tiles pre-extracted as uncompressed LAS or NPZ on NVMe for active inference; maintain cold-archive as LAZ. Avoid decompressing LAZ on-the-fly during inference — decompress to ramdisk once per tile batch at the start of each inference session.

### Throughput Reference Points (Approximate, 2024 Hardware)

The following numbers are order-of-magnitude estimates derived from hardware specs and published model benchmarks. Vendor production pipeline throughput is not publicly disclosed; treat these as planning estimates only.

| Architecture | Tile / Frame Size | Hardware | Batch/GPU | Est. ms/tile | Est. tiles/hr/GPU |
|---|---|---|---|---|---|
| Minkowski ResUNet14C | 100×100 m, 0.05 m vox | A10G 24 GB | 2 | ~500 | ~7,200 |
| SparseConvUNet (SpConv) | 50×50 m, 0.10 m vox | A100 40 GB | 4 | ~150 | ~24,000 |
| PTv3-Extreme | Full scan (~100 m range) | RTX 4090 | 1 | 253 | ~14,200 |
| FlatFormer | Waymo scan frame | Orin 32 GB | 1 | ~50 | ~72,000 |
| EZ-SP (superpoint) | Multi-million point scene | Any | 1 | < 2 MB VRAM overhead | Real-time capable |

---

## Pipeline Operations and Reproducibility

### Tile Manifest Format

A minimal manifest schema for a production batch:

```json
{
  "manifest_id": "apron-west-2026-05",
  "model_id": "minkowski-resnet14c-v3",
  "partition_spec": {
    "zor_size_m": 100.0,
    "halo_m": 10.0,
    "voxel_size_m": 0.05,
    "coordinate_origin": [0.0, 0.0, 0.0],
    "random_seed": 42
  },
  "tiles": [
    {
      "tile_id": "x0200_y0100",
      "input": "s3://bucket/apron/x0200_y0100.las",
      "output": "s3://bucket/preds/x0200_y0100_pred.npy",
      "status": "done",
      "checksum_input": "sha256:abc...",
      "checksum_output": "sha256:def..."
    }
  ]
}
```

Key fields: `tile_id` is deterministic from grid coordinates; `partition_spec` encodes every parameter needed to reproduce the exact tile set; `model_id` links to a model registry entry with checkpoint hash; `status` enables resumable processing; checksums enable integrity verification.

### Deterministic Partition Seeds

For sphere/random-centre sampling, fix `random_seed` in the manifest's partition spec. For grid tiles, IDs are deterministic from XY origin and ZoR size — no seed required. Document partition parameters in the manifest header; this is the partition specification that lets anyone reproduce the exact tile set from the raw point cloud.

### Per-Tile Result Caching

Cache pre-voxelised tiles separately from model outputs. Pre-voxelisation is the expensive CPU step and is model-agnostic — the same voxelised tile is reusable across model iterations.

```
cache_key = hash(raw_point_file_path + voxel_size + coordinate_normalisation_params)
```

On NVMe, caching pre-voxelised tiles reduces per-tile CPU preprocessing from seconds to milliseconds on re-runs, significantly improving iteration speed during model development.

### Fault-Tolerant Orchestration

| Scale | Tool | Notes |
|---|---|---|
| < 500 tiles | Shell loop + SQLite status table | Minimum viable; no external dependencies |
| 500–5,000 tiles | Prefect or Dagster | Per-tile assets with retry; lineage tracking |
| > 5,000 tiles | Dagster with partitioned assets | Per-tile assets + sensor-based triggering; S3 or GCS backed |
| Enterprise | Airflow 2.3+ dynamic task mapping | Task-per-tile via dynamic mapping; weaker native lineage |

### Lineage Tracking

Every prediction output must be traceable to: raw input file + model checkpoint hash + inference config hash. Store this provenance in a per-tile sidecar JSON. Enables auditable re-labelling when a model is updated, and satisfies traceability requirements if the segmentation outputs feed into a safety case or map certification process.

---

## Multi-Resolution and Hierarchical Segmentation

### Coarse-then-Fine Sweep

The standard strategy for maps with thin or rare classes (fence poles, light masts, kerb edges, pavement markings):

1. **Pass 1 — coarse:** large tiles (100 × 100 m), coarse voxels (0.15–0.20 m), fast model. Generate a coarse class-probability map. Identify regions predicted to contain thin-class objects above a confidence threshold.
2. **Pass 2 — fine:** extract sub-tiles (20 × 20 m) centred on predicted thin-class regions; fine voxels (0.05 m), full-resolution model. Re-label only those sub-tiles.

If thin classes occupy 5 % of the map area, Pass 2 costs approximately 5 % of a naive full-resolution single-pass cost. In practice the sub-tile overhead (loading, halo computation) raises this somewhat; 10–15 % of single-pass cost is a reasonable planning estimate.

### Multi-Scale Test-Time Augmentation (TTA)

Apply inference at multiple voxel resolutions and average logits across scales:

```
scales = [0.05 m, 0.08 m, 0.12 m]
logit_final = uniform_average(logit_scale_1, logit_scale_2, logit_scale_3)
```

The 2024 Waymo challenge 2nd-place solution (MixSeg3D) showed that 8-fold TTA (rotations, flips, scales) improved mIoU from approximately 72 % to 74 % on validation, at 8× inference cost. Their own assessment: "not practical for deployment." The common production compromise is 4-fold TTA (2 rotations × 2 flips at a single scale): approximately 3–4 % mIoU gain at 4× cost.

For an airside mapping pipeline with no latency constraint, 4-fold TTA is a cost-justified quality improvement during the initial map generation run. For incremental updates, single-pass is typically sufficient.

### Whole-Scene Context vs Detail Summary

| Approach | Whole-scene context | Fine detail | Compute cost |
|---|---|---|---|
| Single large tile (64+ m, 0.05 m vox) | Good | Good | Very high |
| Fixed grid + large halo (50 m ZoR, 10 m halo) | Moderate | Good | High |
| Superpoint (SPT/EZ-SP) | Excellent | Good | Low–Moderate |
| PTv3 (SFC serialisation) | Global within patch | Good | Moderate |
| Coarse-then-fine hierarchical | Coarse, then targeted | High for thin classes | Medium |

---

## Cost Model

### Published Benchmarks

**ECLAIR (SharperShape, ICCV 2024):** 1,246 tiles × 100 × 100 m = 12,460 km² equivalent tile coverage. Trained and inferred on 4 × A10G (24 GB) at batch size 2 per GPU. Inference throughput approximately 500 ms/tile is an estimate derived from training-infrastructure details in the paper — per-km² inference cost is **not explicitly published** in the paper.

At 500 ms/tile on 4 GPUs: 1,246 tiles ÷ 4 GPUs ÷ 7,200 (tiles/GPU-hr) ≈ **0.04 GPU-hours per km²** for a single forward pass. This is an estimate, not a vendor figure.

**Waymo 3D Auto-Labeling (CVPR 2021):** 64 TPUs, 43,000 training steps. At inference, TTA with 10 rotation angles is described as "parallelisable across multiple devices." No per-km² cost is published.

**SensatUrban (CVPR 2021):** approximately 3 billion points over 7.6 km² (≈ 395M pts/km²). No compute cost is published.

### Rough Cloud Cost Model (2026 Pricing Estimates)

Assumed spot pricing: A10G ≈ $1.20/GPU-hr; A100 ≈ $2.50/GPU-hr. These are planning estimates; actual pricing varies by cloud provider and reservation type.

| Architecture | Est. throughput | Est. $/km² (A10G spot) | Notes |
|---|---|---|---|
| Minkowski ResUNet (0.05 m) | ~7,200 tiles/GPU-hr | ~$0.17 | 100×100 m tiles; 1 km² ≈ 100 tiles |
| SparseConvUNet (0.10 m) | ~24,000 tiles/GPU-hr | ~$0.05 | Coarser voxels |
| With 4× TTA | ÷4 | 4× above | |

**Dominant costs in practice are not GPU time.** In mature programs, ML inference is under 10 % of total pipeline cost. The dominant costs are: human QA and re-labelling of edge cases, survey data I/O (LAS transfer from field drives to cloud), and annotation of hard classes that the model still fails on. Cost modelling that focuses on GPU-hours alone will systematically underestimate total program cost.

**Airside-specific cost note:** an airport apron survey mission with a UAV or helicopter-mounted scanner typically covers 1–5 km² at 0.05 m point density. Data transfer from on-site drive to cloud can exceed the ML compute budget if storage is not co-located with inference workers. Pre-staging NVMe caches at a cloud region adjacent to the survey origin minimises this.

The per-km² estimates above assume a single-pass without TTA and without pseudo-label generation. A full map production run with ensemble-based pseudo-labelling (as in ECLAIR, which generated pseudo-labels for half of its tiles) roughly doubles the inference cost, bringing the effective cost to approximately $0.34/km² for the Minkowski ResUNet configuration on A10G spot.

---

## Industry-Proven Practice

### What Is Published

**ECLAIR (SharperShape, ICCV 2024):** the only publicly documented production-style aerial LiDAR segmentation pipeline with explicit tiling parameters. Uses 100 × 100 m tiles, 0.05 m voxel resolution, Minkowski ResUNet14C backbone, 4 × A10G on AWS g5.12xlarge, batch size 2 per GPU, and pseudo-label generation from model ensemble (622 pseudo-label tiles out of 1,246 total). This is the template for airside aerial LiDAR pipelines — adapt the class taxonomy for airside infrastructure while preserving the tiling and infrastructure pattern.

**Waymo Offboard 3D Auto-Labeling (CVPR 2021):** aggregates multi-scan temporal sequences (not single-frame), uses 64 TPUs for training, and applies TTA with 10 rotation angles parallelised across devices. Achieves performance on par with human annotators. Key insight: offboard = no latency constraint = full temporal context and TTA are both available.

**DetZero (ICCV 2023, 1st on Waymo leaderboard):** extends offboard detection to long-term (> 20 frame) sequence aggregation with an offline tracker + multi-frame detector + attention-based refiner; 85.15 mAPH(L2). Demonstrates that production pipelines increasingly aggregate entire trajectories, not single scenes.

**UniLiPs (3DV 2026):** demonstrates zero-annotation pseudo-label generation for semantic segmentation at scale using geometry-grounded scene decomposition — indicating that the offline pseudo-labeling research frontier is moving toward fully automated label generation.

### What Is Not Published

**Waymo, Tesla, HERE, TomTom internal pipeline details** — tile sizes, GPU counts, per-km² cost — are proprietary. Specific numbers from these companies appearing in blog posts or secondary sources are unverified. Do not cite them as reference values.

**Throughput numbers** in this document are extrapolated from hardware specifications and published model benchmarks, not from first-party pipeline disclosures.

**Airside-specific map segmentation pipelines:** no public literature exists for dedicated airside LiDAR semantic segmentation at map scale. ECLAIR (urban aerial LiDAR) is the closest published proxy. Airport practitioners should treat the urban aerial LiDAR pipeline as the template, adapting the class taxonomy for airside infrastructure per the 14-class taxonomy in [Semantic Class Taxonomy Design](3d-segmentation-class-taxonomy-design.md) and the airside domain notes in [Aggregated-Map Semantic Segmentation](aggregated-map-semantic-segmentation.md).

---

## Recommended Tiling Pipeline

An ordered recipe for a new large-scale airside segmentation run:

1. **Determine tile size.** Apply the memory budget formula. Start with 50 × 50 m ZoR at 0.10 m voxel resolution on the target GPU. Verify by running a single tile; adjust if OOM.
2. **Set halo width.** Use architecture lookup table above. When uncertain, use halo = 1.5 × (½ RF). Record the value in the partition spec.
3. **Generate tile manifest.** Deterministic from coordinate origin, ZoR, and halo. Assign `status: pending` to all tiles. Record partition spec, model ID, and random seed in manifest header.
4. **Pre-voxelise and cache.** Run CPU voxelisation for all tiles in parallel using multiprocessing. Cache to NVMe. Key: hash(raw file + voxel size + normalisation params).
5. **Check normalization layers.** Confirm model uses BatchRenorm, GroupNorm, or LayerNorm — not InstanceNorm. If InstanceNorm is present, measure train/eval disparity and evaluate whether retraining or fine-tuning with BatchRenorm is necessary.
6. **Run batched inference.** Sort tiles by point count, pack into GPU memory budget using bin-packing, run with FP16, prefetch factor 2–4.
7. **Write outputs atomically.** Update manifest status to `done` only after confirmed write. Record output checksum.
8. **Stitch.** Use ZoR hard crop if halo ≥ ½ RF is confirmed. Use Gaussian-weighted logit averaging in overlap zones if halo is borderline.
9. **Compute seam-consistency metric.** Compute `median(1 - Dice)` in overlap strips. If > 0.02, investigate halo width and normalization before proceeding.
10. **Apply coarse-then-fine sweep** for thin classes (poles, kerb, markings) if initial pass shows low boundary IoU on those classes.
11. **Run QA pass.** Human review of seam regions and low-confidence predictions; update manifest with QA status.
12. **Record provenance.** Write per-tile sidecar JSON with raw input hash + model checkpoint hash + inference config hash.

---

## Trade-offs

| Dimension | Low end | High end | Key consideration |
|---|---|---|---|
| Memory vs context | Small tiles (< 30 m), no OOM risk | Large tiles (> 100 m), OOM risk | Use memory budget formula; prefer larger tiles for thin linear classes |
| Halo width vs throughput | Narrow halo (fast, seam risk) | Wide halo (slow, full context) | Minimum = ½ RF; verify with seam metric |
| Hard-label vs logit fusion | Label voting (fast, lossy) | Logit averaging (slower, lossless) | Logit averaging always preferred when logits are accessible |
| Normalisation choice | InstanceNorm (common pre-trained) | BatchRenorm / GroupNorm | InstanceNorm causes seams; switch before production deployment |
| Fixed grid vs superpoint | Fixed grid (simple, parallel) | SPT/EZ-SP (no seams, compact) | Superpoint preferred for accuracy; fixed grid preferred for simple parallelism |
| Single-pass vs TTA | Single-pass (fast, lower mIoU) | 4-fold TTA (4× cost, +3–4 % mIoU) | Map generation (offline): 4-fold TTA is cost-justified; online updates: single-pass |
| Coarse vs fine voxels | 0.20 m (fast, misses thin classes) | 0.05 m (slow, resolves thin classes) | Coarse-then-fine hierarchical sweep is the production compromise |

---

## Implementation Notes

- **Always write partition spec into the manifest.** Tile IDs are meaningless without knowing the ZoR, halo, voxel size, and coordinate origin that generated them. A partition spec is the reproducibility primitive.
- **Test halo sufficiency empirically.** Run two tiles with a shared 20 m overlap zone: tile A owns the left half, tile B the right half. Compare predictions in the overlap zone — discrepancies beyond class-boundary regions indicate insufficient halo or normalization issues.
- **Pre-voxelise before inference sessions.** The CPU voxelisation step is often the wall-clock bottleneck for the first run. Caching it eliminates this from all subsequent model iteration runs.
- **Do not use LAZ decompression inside the inference loop.** Decompression throughput is typically 50–200 MB/s; on NVMe, raw LAS reads at 3–7 GB/s. Pre-extract tiles to uncompressed LAS before inference.
- **Separate tile-level QA from global QA.** Check seam-consistency metrics per tile pair first; do not wait for a full mosaic to diagnose seam problems. A single bad tile type (e.g., all tiles near map edges) reveals a systematic issue faster at tile level.
- **Version the model ID in the manifest.** When the model checkpoint is updated, old manifests remain valid as historical records. Reprocess status-done tiles only if the model update affects that class (partial re-labelling is a significant cost saving).
- **Log GPU memory utilisation per tile.** A sudden utilisation spike on certain tiles reveals outlier-density regions that could cause OOM in future runs. Catch these during first-pass validation.
- **Freeze coordinate normalisation parameters.** The voxelisation step typically normalises coordinates to a unit cube or to zero-mean per tile. These normalisation parameters (mean, scale) must be fixed from the first run and stored in the partition spec. Allowing them to be recomputed per tile produces different input distributions and invalidates tile-level caching.
- **For airside maps, treat pavement markings as a first-class thin class.** Markings are the primary localisation anchors in airside HD maps and appear at approximately 2–5 % of apron surface area — enough to train on, but thin enough that default tile sizing at 0.10 m voxels will degrade their recall. Verify marking recall separately using boundary IoU on annotated sections before accepting pipeline outputs for HD map production.
- **Plan for iterative re-tiling.** As the model improves across release versions, optimal tile size and halo width may change — a larger model with a wider receptive field requires a proportionally larger halo. Design the manifest schema and partition spec so that re-tiling is a manifest regeneration step, not a full pipeline rewrite.

---

## Failure Modes

| Symptom | Probable Cause | Diagnostic |
|---|---|---|
| Visible seam lines between adjacent tiles in segmentation output | Halo too narrow (< ½ RF) or InstanceNorm tile-level statistics shift | Measure `median(1-Dice)` in overlap strip; compare with a run using 2× halo; check normalisation layer type |
| High overall accuracy but consistent misclassification of points near tile edges | Halo exactly at ½ RF with no safety margin | Increase halo to 1.5 × (½ RF); re-run seam metric |
| Train mIoU substantially higher than tiled-inference mIoU on same data | Normalization-induced distribution shift (InstanceNorm) | Compute train/eval disparity metric; retrain or fine-tune with BatchRenorm |
| GPU OOM on certain tiles despite tile size meeting formula budget | Density outlier tiles (dense urban returns or overlapping flight strips); activation memory underestimated | Log per-tile point count; add a 10 % memory safety margin; reject tiles above max count |
| Throughput collapses on sparse-tile batches | Padding waste from equal-tile-count batching on variable-density tiles | Switch to bin-packing by point count; implement FlatFormer-style equal-size grouping |
| Pipeline fails partway through a 1,000-tile batch with no restart capability | No manifest-based checkpointing; naive sequential loop | Implement tile manifest with atomic status updates; re-queue failed tiles |
| Thin classes (poles, kerb, markings) correctly labelled in isolation but missing in stitched mosaic | Thin classes appear only in halo regions of most tiles; ZoR hard crop discards them | Use coarse-then-fine sweep; ensure thin-class points appear in at least one tile's ZoR |
| Pseudo-labels generated by ensemble model show systematic class confusion at tile boundaries | Ensemble members see different tile contexts; logit averaging not applied across ensemble | Ensure ensemble members tile identically; average logits before argmax across both tiles and ensemble members |
| Reproducibility failure: re-running the pipeline produces different tile-level predictions | Random sphere-centre sampling without fixed seed; variable floating-point ordering | Fix `random_seed` in partition spec; use deterministic CUDA ops (`torch.use_deterministic_algorithms(True)`) |
| Sidecar provenance JSON missing or incomplete | Lineage not written atomically alongside output | Write provenance JSON as part of the same atomic output step; verify checksum covers both output and sidecar |

---

## Sources

**Cross-links (this knowledge base):**
- [Aggregated-Map Semantic Segmentation](aggregated-map-semantic-segmentation.md) — §3 Pipeline Architecture, §8 Tiling and Stitching, §15 Recommended Pipeline
- [LiDAR Semantic Segmentation](lidar-semantic-segmentation.md) — single-scan context and per-frame inference
- [Semantic Class Taxonomy Design](3d-segmentation-class-taxonomy-design.md) — airside 14-class taxonomy, stuff/things design
- [Segmentation Post-Processing and Label Refinement](segmentation-post-processing-label-refinement.md) — logit averaging and label merge as post-processing
- [LiDAR Artifact Removal Techniques](lidar-artifact-removal-techniques.md) — pre-processing companion: motion distortion, multi-return, noise
- [Point-Cloud Representations and Voxelization — First Principles](../../../10-knowledge-base/geometry-3d/point-cloud-representations-voxelization-first-principles.md) — voxelisation math and sparse-tensor representation
- [Superpoint Transformer](../methods/superpoint-transformer.md) — SPT and EZ-SP intrinsic partition method detail
- [FlatFormer](../methods/flatformer.md) — equal-size grouping and padding-free batching
- [Point-Cloud Mamba / SSM Backbones](../methods/point-cloud-mamba-ssm-backbones.md) — SSM serialization and long-context backbone candidates

**Primary papers:**
- ECLAIR aerial LiDAR pipeline (arXiv 2404.10699): https://arxiv.org/html/2404.10699v1
- Tiling artifacts and feature normalization (arXiv 2503.19545): https://arxiv.org/html/2503.19545v1
- NIST exact-tile / halo / ZoR (PMC 10914126): https://pmc.ncbi.nlm.nih.gov/articles/PMC10914126/
- Tiling and stitching in remote sensing (arXiv 1805.12219): https://arxiv.org/abs/1805.12219
- KPConv spherical batch sampling (arXiv 1904.08889): https://arxiv.org/pdf/1904.08889
- SPT superpoint partition (arXiv 2306.08045): https://arxiv.org/pdf/2306.08045
- EZ-SP GPU superpoint (arXiv 2512.00385): https://arxiv.org/abs/2512.00385
- FlatFormer equal-size grouping (arXiv 2301.08739): https://arxiv.org/abs/2301.08739
- TorchSparse++ MICRO 2023 (arXiv 2311.12862): https://arxiv.org/abs/2311.12862
- PTv3 space-filling curve serialisation (arXiv 2312.10035): https://arxiv.org/html/2312.10035v2
- Pamba point-cloud SSM segmentation (AAAI 2025): https://ojs.aaai.org/index.php/AAAI/article/view/32540
- PointMamba point-cloud SSM baseline (arXiv 2402.10739): https://arxiv.org/abs/2402.10739
- PTv3-Extreme Waymo 2024 (arXiv 2407.15282): https://arxiv.org/html/2407.15282v1
- MixSeg3D TTA Waymo 2024 (arXiv 2501.05472): https://arxiv.org/html/2501.05472v1
- Waymo offboard 3D auto-labeling CVPR 2021 (arXiv 2103.05073): https://arxiv.org/pdf/2103.05073
- DetZero offboard ICCV 2023 (arXiv 2306.06023): https://arxiv.org/pdf/2306.06023
- SparsePipe multi-GPU NeurIPS 2020 (arXiv 2012.13846): https://arxiv.org/abs/2012.13846
- SensatUrban CVPR 2021: https://openaccess.thecvf.com/content/CVPR2021/papers/Hu_Towards_Semantic_Segmentation_of_Urban-Scale_3D_Point_Clouds_A_Dataset_CVPR_2021_paper.pdf
- UniLiPs auto-label (3DV 2026; arXiv 2601.05105): https://arxiv.org/html/2601.05105
- LAS file format (Wikipedia): https://en.wikipedia.org/wiki/LAS_file_format
