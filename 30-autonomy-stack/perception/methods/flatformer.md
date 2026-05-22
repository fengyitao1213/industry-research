# FlatFormer

<!-- method-priority:start
priority:
  learning: 4
  deployment: 3
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["perception", "lidar", "segmentation", "road-av"]
  reason: "FlatFormer's flattened window attention is the first point-cloud transformer to run real-time on edge GPUs — an efficiency reference for embedded LiDAR backbones."
method-priority:end -->

## What It Is

- FlatFormer ("Flattened Window Attention for Efficient Point Cloud Transformer") is a BEV-pillar transformer backbone for real-time 3D LiDAR processing, introduced by Zhijian Liu, Xinyu Yang, Haotian Tang, Shang Yang, and Song Han (MIT Han Lab) at CVPR 2023.
- Its central contribution is **Flattened Window Attention (FWA)** — an operator that replaces spatial window partitioning with a sort-then-equal-size-group strategy, eliminating padding waste and mapping attention entirely to dense tensor operations.
- It was introduced and benchmarked for 3D **object detection** on Waymo. No semantic segmentation benchmarks appear in the paper or official repository as of August 2025 — its use as a segmentation backbone is architecturally plausible but unpublished.
- It is the first point-cloud transformer to achieve real-time performance on an edge GPU (16 FPS on NVIDIA Jetson AGX Orin), beating the sparse-convolution CenterPoint baseline by 1.2× on the same device.
- FlatFormer belongs to the serialization-based attention family alongside PTv3, but differs in key ways: pillar-based BEV design vs. PTv3's full-3D space-filling-curve serialization; detection-tuned vs. segmentation-tuned.
- The two methods are complementary rather than competing when use cases are separated: FlatFormer for the on-vehicle real-time perception loop on Orin-class hardware; PTv3 for the offline aggregated-map labeling pipeline where 3D fidelity and published segmentation SOTA matter more than per-frame latency.

## Core Technical Idea

Point-cloud transformers (SST, SWFormer) preserve full spatial resolution and capture long-range context via attention, making them more accurate than strided sparse convolutions on small objects. But they run **3× slower** than sparse-conv methods in practice, blocking deployment on resource-constrained edge hardware.

The root cause is **window-padding waste**. When space is divided into fixed-size windows, the number of points per window varies widely across a scene. To batch these windows into a dense GPU tensor for multi-head self-attention, every window must be padded to the maximum-occupancy count. On Waymo, SST's measured padding overhead is **1.7×** — 70% of MHSA computation is on zeros. SWFormer's spatial partitioning step alone takes ~18 ms per scene, slower than CenterPoint's entire forward pass.

FlatFormer's thesis: **trade strict spatial proximity for computational regularity**. If every group always contains exactly G points, there is zero padding, and the full attention computation maps to dense batched matrix-multiply — the GPU's native fast path. Spatial proximity is maintained well enough by first sorting points in window order; the attention operator is robust to the minority of cross-boundary points that end up in the same group after the equal-size cut.

The padding problem is severe precisely because LiDAR point density is strongly non-uniform: windows near objects (vehicles, buildings) are dense; windows over empty road or sky are nearly empty. On a Waymo sequence the maximum-occupancy window can hold 300+ points while the median window holds fewer than 30. Padding every window to 300+ means that for an average window, ~90% of MHSA is wasted. Fixed spatial windows are structurally unable to avoid this; only an operator that defines groups by point count rather than spatial extent can eliminate it.

## Operator Mechanics

### Voxelization

Input point cloud is pillar-voxelized at **0.32 m × 0.32 m** BEV resolution, following the PointPillars convention. Each non-empty pillar (collapsed along z) becomes a single entity at the pillar center, with an MLP-encoded feature vector. For a Waymo scene at ±75 m range the BEV grid is 468 × 468; occupied pillars form the sparse working set (~30 k–150 k tokens).

### Sort

Each occupied pillar is assigned a 2D window index and local residual:

```
wx = floor(x / Wx),   wy = floor(y / Wy)
lx = x mod Wx,        ly = y mod Wy
```

All pillars are sorted lexicographically, primarily by window index `(wx, wy)` then by local coordinate `lx` within the window. This is an O(N log N) GPU radix sort over flat integer keys — fast in practice and produces a spatially-coherent sequence where consecutive pillars are very likely neighbours.

For alternating layers (see below) the primary sort axis switches to y: sort by `(wy, wx, ly)`.

### Equal-Size Grouping

After sorting, the sequence is partitioned into **consecutive groups of exactly G pillars** (G is a hyperparameter; the paper uses G = 69, approximately 85% of a 9 × 9 window). The last partial group is handled by **Drop Residual** — up to G−1 pillars (< 0.1% of the scene) are dropped rather than padded.

The result is a regular tensor of shape `[num_groups, G, D]`. There are no masks, no padded rows, and no custom sparse kernels — every row is live data.

**Spatial-proximity quality:** Consecutive points in the sorted sequence share a window coordinate and are therefore spatially close, but the equal-size cut can straddle a window boundary. The paper quantifies this cost: an ablation replacing equal-size groups with exact spatial windows (accepting padding) shows a ~0.6 mAPH gap — small enough that the efficiency gain justifies it. For segmentation tasks with fine class boundaries the tolerance for cross-boundary mixing may be lower; this is an open question with no published evidence either way.

### Group Self-Attention

Within each group, standard multi-head self-attention is applied with absolute positional encoding on the raw (x, y) pillar-center coordinates as a position bias:

```
F' = F + MHSA(LN(F), PE(C))
F'' = F' + FFN(LN(F'))
```

Complexity is O(N · G · D) — linear in pillar count N, with G fixed as a constant (~69). Compare to SST's padded effective K up to 300+. Because G is small and fixed, MHSA maps to dense batched `bmm` on cuBLAS, the highest-throughput CUDA path. FlashAttention is used within each group for an additional 1.7× speedup.

### Alternating-Axis Sorting

If every layer sorts on the x-axis, pillars sharing `floor(y/Wy)` but differing `floor(x/Wx)` never appear in the same group — receptive field collapses to an x-aligned strip. FlatFormer alternates the primary sort axis across consecutive FWA layers:

- Odd layers (1, 3, 5, 7): sort by `(wx, wy, lx)` — x-axis primary
- Even layers (2, 4, 6, 8): sort by `(wy, wx, ly)` — y-axis primary

After two layers every region receives signal from both axes. This is FlatFormer's spatial mixing mechanism, analogous to row/column attention in Axial Transformer but achieved purely by reordering, with no structural partitioning.

### Window Shift

Every other FWA block translates all coordinates by `(Wx/2, Wy/2)` before sorting, shifting group boundaries by half a window. Pillars separated by a stable boundary in one block can exchange information in the next. Borrowed directly from Swin Transformer.

### Sort Reuse

Recomputing the sort key at every layer is non-trivial. FlatFormer reuses the sort permutation from one layer for the subsequent same-axis layer, reducing sorting overhead by approximately 50%.

## Inputs and Outputs

- Input: a raw point cloud (x, y, z, intensity) covering the sensor range; standard Waymo configuration is ±74.88 m in x/y, [−2, 4] m in z.
- Internal representation: BEV pillars at 0.32 m resolution; z-axis is **collapsed** into an MLP-encoded feature during voxelization. Full 3D height structure is not retained.
- Output: a dense BEV feature map after the 8-layer backbone; passed to a SECOND+SECONDFPN neck for detection. For a segmentation use case, a BEV semantic decoder or per-pillar classification head would be attached in place of the detection neck — this is architecturally straightforward but has not been demonstrated in the published literature.
- The backbone is task-agnostic: FWA makes no detection-specific assumptions.

## Architecture

FlatFormer is a **single-scale, single-stride BEV backbone** — no spatial downsampling across the 8 FWA layers. The published detection configuration:

```
Point cloud
  → Voxelization (0.32 m × 0.32 m BEV; z: [-2, 4] m, 6 m bin)
  → MLP pillar encoder
  → FlatFormer backbone: 8 × FWA blocks
       alternating x / y sort axis per layer
       window shift every other block
       window shape: 9 × 9 voxels, group size G = 69
       8 attention heads; 2 encoder blocks per stage
  → Dense BEV feature map
  → SECOND + SECONDFPN neck  [output channels: 64, 128]
  → CenterPoint-style center-based detection head
       GaussianFocalLoss (classification)
       L1 loss ×2 (bounding box regression)
```

Multi-frame fusion is handled by stacking sweeps into the pillar feature before the MLP encoder; the backbone is identical for 1-, 2-, and 3-sweep inputs.

**Design note for segmentation adaptation:** The backbone's BEV-pillar design collapses the z-axis. Attaching a per-pillar or BEV-decoded segmentation head is mechanically feasible, but any per-point label that requires height-differentiated classes (ground vs. facade vs. overhead obstacle) cannot be recovered from a pillar-only feature without explicit height binning or multi-resolution pillar stacking. PTv3 operates in full 3D and avoids this constraint.

## Complexity and Compute

**Benchmark hardware:** NVIDIA Quadro RTX A6000 (FP16) unless noted.

| Model | Type | Latency (ms) | Mean L2 mAPH |
|---|---|---|---|
| CenterPoint | Sparse conv | 14.6 | 65.5 |
| SST | Transformer | 45.5 | 64.8 |
| SWFormer | Transformer | 20.0 | ~67 (est.) |
| **FlatFormer 1-frame** | **Transformer** | **10.8** | **67.2** |
| FlatFormer 2-frame | Transformer | 11.9 | 71.2 |
| **FlatFormer 3-frame** | **Transformer** | **12.7** | **72.0** |

Key ratios on A6000:
- vs. SST: **4.6× faster** (45.5 → 10.8 ms)
- vs. CenterPoint: **1.4× faster** (14.6 → 10.8 ms)
- FlatFormer uses 1.7× more MACs than CenterPoint yet runs faster — the hardware-efficiency advantage of regular dense tensor ops over sparse scatter/gather.

**Backbone acceleration decomposition (vs. SST):**
- Overall: 2.9× backbone speedup
- FlashAttention within groups: 1.7× MHSA speedup
- Fused linear+activation FFN (Triton kernel): 1.2× speedup
- Sort reuse: ~50% reduction in sorting overhead
- Post-backbone neck + head run with TensorRT 8.4

**Edge GPU — NVIDIA Jetson AGX Orin:** FlatFormer achieves **16 FPS** on Orin, which is 1.2× faster than CenterPoint on the same device. No competing point-cloud transformer (SST, SWFormer) reaches real-time on Orin in the paper's comparisons. 16 FPS ≈ 62.5 ms per frame — within the ~100 ms Orin cycle budget.

**TensorRT:** FWA attention operates on standard dense tensors; no custom sparse CUDA kernels in the critical path. The paper confirms TRT 8.4 deployment for all modules downstream of the 3D encoder. FlashAttention and Triton FFN kernels are compatible with standard quantization and TRT export flows.

**Efficiency in context:** The 4.6× speedup over SST and 1.4× over CenterPoint demonstrates a counter-intuitive result: higher MAC count does not imply higher latency when the computation is register-friendly. SST's padded sparse ops spend ~70% of MHSA cycles on masked zeros; FlatFormer's regular dense ops achieve near-peak cuBLAS utilisation throughout. This is the primary lesson for embedded backbone design: hardware utilisation rate matters more than raw operation count. ScatterFormer (2024) pushes the same insight further with linear attention, reducing attention latency below 1 ms on A100 — but at the cost of a more complex operator that is less straightforward to export via TensorRT.

## Training Recipe

All numbers from the official config `flatformer_waymo_D1_2x_3class_3f.py` and the mmdet3d `cosine_2x` base schedule.

| Parameter | Value |
|---|---|
| Framework | MMDetection3D (mmdet3d) |
| PyTorch | 1.9 – 1.10.2 |
| Python | 3.6 – 3.7 |
| Epochs | 24 (2× schedule: 2 × 12 epochs) |
| Batch size | 1 per GPU |
| GPUs | 8 × (distributed) |
| Precision | FP16 (loss scale 32.0) |
| Optimizer | AdamW (inferred from `cosine_2x` convention; confirm in `configs/_base_/schedules/cosine_2x.py`) |
| LR schedule | Cosine annealing (inferred from config name) |
| Voxel size | 0.32 m × 0.32 m BEV; z: 6 m bin |
| Point cloud range | [−74.88, −74.88, −2] → [74.88, 74.88, 4] m |
| Sweeps | 1, 2, or 3 (separate configs) |
| Detection classes | Car, Pedestrian, Cyclist |
| Classification loss | GaussianFocalLoss (mean reduction) |
| Regression loss | L1 loss, weight = 2.0 |
| Max objects / scene | 500 |
| Augmentations | GT sampling paste; random flip, rotation, scaling (parameters in non-visible base config) |
| Pre-trained weights | Not released (Waymo Dataset License Agreement restriction) |

Users must train from scratch; no checkpoint download is available. For a segmentation adaptation, expect the same 24-epoch regime with a replacement loss (cross-entropy per pillar or per decoded BEV cell) and a matching head; no published recipe exists to reference, so the training details would need to be established empirically.

## Benchmark Results

### Waymo Open Dataset — Single-Stage Detection (Validation)

| Config | mAP L1 | mAPH L1 | mAP L2 | mAPH L2 |
|---|---|---|---|---|
| FlatFormer 1-sweep | 76.1 | 73.4 | — | — |
| FlatFormer 2-sweep | 78.9 | 77.3 | — | — |
| FlatFormer 3-sweep | 79.6 | 78.0 | 73.5 | 72.0 |

Per-class L1/L2 mAPH (3-sweep):

| Class | L1 mAPH | L2 mAPH |
|---|---|---|
| Vehicle | 79.2 | 71.0 |
| Pedestrian | 78.7 | 71.3 |
| Cyclist | 76.1 | 73.7 |

### Waymo — Two-Stage (FlatFormer + FSD Second Stage)

| Frames | Latency (ms) | Mean L2 mAPH |
|---|---|---|
| 1 | 39.3 | 70.5 |
| 2 | 51.8 | 73.8 |
| 3 | 60.6 | 74.8 |

### FlatFormer vs. PTv3 — Detection (Waymo val, same protocol, from PTv3 paper)

| Model | Frames | mAP L2 |
|---|---|---|
| FlatFormer | 1 | 69.0 |
| PTv3 | 1 | 71.2 |
| FlatFormer | 3 | 70.8 |
| PTv3 | 3 | 72.5 |

PTv3 surpasses FlatFormer by 1–3 mAP on detection; PTv3's 3D design generalises better to segmentation. The gap is narrow on the detection task but the architectural difference — full 3D operation vs. BEV-pillar collapse — becomes more significant when the task demands per-point labeling across height classes.

### Segmentation Benchmarks

**None published.** FlatFormer was evaluated exclusively on 3D object detection. No nuScenes, SemanticKITTI, or other segmentation results appear in the CVPR 2023 paper or the official repository. Adapting FlatFormer for segmentation requires attaching a segmentation head and retraining; this is architecturally plausible but has not appeared in the published literature as of August 2025. Do not cite segmentation mIoU numbers for FlatFormer — none exist.

## Variants and Lineage

The sparse-voxel transformer efficiency line relevant to this backbone:

- **SST** (Fan et al., CVPR 2022, arXiv:2112.06375): single-stride sparse window transformer; preserves full BEV resolution; 45.5 ms 1-frame (57.8 ms 3-frame) on A6000. Root cause of FlatFormer — SST pads every window to its maximum-occupancy count, producing 1.7× padding overhead measured on Waymo; 70% of MHSA cycles compute on zeros.
- **SWFormer** (Sun et al., ECCV 2022, arXiv:2210.07372, Waymo Research): hierarchical sparse window attention with bucketing; ~18 ms spatial-partitioning step per scene; 20 ms total 1-frame. FlatFormer beats it at 10.8 ms while matching or exceeding accuracy.
- **FlatFormer** (Liu et al., CVPR 2023, arXiv:2301.08739): eliminates padding via equal-size grouping; 10.8 ms 1-frame, 16 FPS Orin; detection only.
- **PTv3** (Wu et al., CVPR 2024, arXiv:2312.10035): both FlatFormer and PTv3 belong to the serialization-based attention family, but PTv3 uses space-filling curves (Z-order + Hilbert) rather than flat BEV sorting, operates in full 3D, scales patch size to 1024 points, and is designed for semantic segmentation as its primary use case. PTv3 explicitly notes that FlatFormer "lacks scalability in the receptive field and is more suited to pillar-based 3D object detectors."
- **ScatterFormer** (ECCV 2024, arXiv:2401.00912): argues that FlatFormer's equal-size grouping "loses spatial proximity and incurs extensive computational overhead in grouping and sorting"; proposes Scattered Linear Attention (SLA); achieves 73 mAP L2 on Waymo at 28 FPS on A100 with < 1 ms attention latency. Represents the next generation in the sparse-voxel transformer efficiency line.

## Strengths

- **Hardware efficiency via regularity.** Equal-size groups = zero padding = dense cuBLAS bmm. This single design insight drives all downstream speedups: FlatFormer uses 1.7× more MACs than CenterPoint yet beats it in wall-clock time.
- **First real-time transformer on edge GPU.** 16 FPS on Orin; 10.8 ms on RTX A6000. No competing point-cloud transformer achieves real-time on Orin in the published comparisons.
- **No custom sparse CUDA kernels.** Standard attention with FlashAttention + Triton FFN; TensorRT-compatible downstream pipeline (TRT 8.4 confirmed).
- **Single-stride backbone.** No spatial downsampling preserves small-object detail — particularly relevant for pedestrians and small GSE in airport environments.
- **Multi-frame native.** Stacking sweeps adds only ~2 ms latency; 3-frame config gains +5 mAPH over single-frame.
- **TensorRT-friendly export path.** Dense tensor ops in the critical path make quantization and TRT export more straightforward than sparse-kernel-heavy alternatives.

## Failure Modes

- **Segmentation use is unproven.** Application to semantic segmentation is architecturally plausible but has no published benchmarks, no community replication, and no released segmentation checkpoints as of August 2025. Treat segmentation performance as unknown.
- **Pillar collapse limits full-3D label quality.** FlatFormer collapses the z-axis into a single pillar feature. Per-point labeling requiring height-differentiated classes (ground, wall, overhead obstacle, elevated structure) is intrinsically limited by this design. PTv3 and SphereFormer operate in full 3D.
- **Spatial proximity not guaranteed at group boundaries.** Equal-size cuts can straddle window edges, mixing spatially distant pillars. The paper reports a ~0.6 mAPH ablation cost; for segmentation with fine class boundaries this trade-off may be less benign.
- **Drop Residual introduces labeling gaps.** Up to G−1 pillars (< 0.1% of scene) are dropped per frame. Negligible for detection; for dense per-point segmentation this introduces small systematic omissions in the final group of each sorted sequence.
- **Limited receptive field depth.** Group size G ≈ 69 pillars; effective spatial context is ~one 9 × 9 window (~2.9 m radius at 0.32 m voxels). Large-context understanding requires 8+ stacked layers. PTv3 achieves 1024-point windows more efficiently.
- **Framework pinned to old stack.** Official code requires PyTorch 1.9 – 1.10.2 and mmcv 1.4.0 (2021-era); not compatible with PyTorch 2.x out of the box. Community forks exist but are unsupported.
- **No pre-trained weights released.** Waymo license prevents distribution; training from scratch requires ~24 epochs on 8 GPUs.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV — on-vehicle, real-time | **strong** | 16 FPS Orin confirmed; 10.8 ms A6000; efficient detection backbone; segmentation unproven but efficiency transfers. |
| Airside AV — on-vehicle, real-time | **conditional** | Same efficiency profile as road AV; no airside-specific benchmarks; detection-trained only. |
| Warehouse / logistics-yard / port | **conditional** | Pillar design handles flat indoor/semi-outdoor environments; no published results outside Waymo. |
| Offline aggregated-map segmentation | **weak** | Pillar collapse loses 3D structure; no segmentation benchmarks; PTv3 is the stronger published choice for this use case. |
| Mining / construction / agriculture | **weak** | No results; pillar collapse limits uneven terrain labeling quality. |

## Aggregated-Map Suitability

FlatFormer is a real-time, single-frame detection backbone. Its design properties interact poorly with the offline aggregated-map segmentation use case in three ways:

1. **Scale mismatch.** Aggregated map clouds are 10–100× denser than a single Waymo frame (150k pillars → 10 M+ pillars in tiled regions). FlatFormer can in principle tile arbitrarily large clouds — FWA is stateless, memory grows linearly, and GPU radix sort scales to millions of points — but this mode has not been tested.

2. **Pillar collapse is the hard constraint.** Map-scale segmentation for airside environments requires assigning per-point labels distinguishing ground, markings, facades, overhead cabling, and elevated infrastructure. A pure BEV-pillar backbone cannot recover full 3D height structure without additional height binning or multi-level pillar features explicitly designed for it.

3. **No segmentation benchmarks.** There is no published evidence that FlatFormer attached to any segmentation head produces competitive semantic segmentation results on any dataset.

### On-Vehicle vs. Offline Comparison

| Criterion | FlatFormer (on-vehicle) | FlatFormer (offline map-scale) | PTv3 (offline map-scale) |
|---|---|---|---|
| Latency | 10.8 ms / frame (A6000) | N/A — tile throughput | Seconds per tile (high accuracy) |
| Edge (Orin) | 16 FPS confirmed | Not applicable | Not applicable |
| 3D label quality | Limited — pillar collapse | Limited — pillar collapse | Full 3D |
| Segmentation benchmarks | None published | None published | nuScenes, SemanticKITTI SOTA |
| Aggregated-cloud scale | Not tested | Theoretically tileable | Tested on large outdoor scenes |
| Framework maturity | PyTorch 1.x / mmdet3d | Same | PyTorch 2.x, modern stack |

**Recommendation:** For offline aggregated-map segmentation, **PTv3 is the stronger published choice** — it benchmarks at SOTA on nuScenes, SemanticKITTI, and Waymo segmentation; operates in full 3D; supports large-tile inference (500 K+ points on a 16 GB GPU); and has a mature pre-training ecosystem (PPT, Sonata). FlatFormer and PTv3 are complementary when use cases are separated: FlatFormer for the on-vehicle real-time perception loop; PTv3 for the offline map-labeling pipeline. See `./point-transformer-v3.md` for the full PTv3 analysis.

## Implementation Notes

- FlatFormer's efficiency benefit is realised specifically with a dense-tensor MHSA backend (cuBLAS bmm, FlashAttention). Do not substitute a sparse or custom attention kernel — that would nullify the core design advantage.
- For TensorRT export: FWA blocks are dense-tensor compatible. Confirm TRT operator support for FlashAttention at the target TRT version; TRT 8.4 was validated in the paper. On Orin the TRT path covers the SECOND neck and CenterPoint head; the FWA blocks run via the Triton/FlashAttention path, which requires separate validation against the Orin TRT plugin set.
- Memory footprint on Orin: a 1-frame scene (~100k pillars, G=69, 8 FWA blocks) fits comfortably within 4 GB DRAM in FP16. Multi-sweep stacking doubles the pillar-feature tensor before the encoder; 3-frame at 0.32 m voxel is still well within the 64 GB unified memory on Orin AGX.
- Group size G is a hyperparameter; larger G increases receptive field but also increases MHSA cost quadratically per group. The paper ablates G = 69 as optimal for the 9 × 9 window at 0.32 m voxels.
- For multi-sweep use: stack N-sweep pillar features before the MLP encoder; the backbone is sweep-count-agnostic. Each additional sweep adds ~1 ms of latency at 0.32 m resolution.
- For segmentation adaptation (experimental, no published baseline to compare against): replace the SECOND neck + CenterPoint head with a BEV semantic decoder; use multi-level pillar features if height-class separation is needed; expect to re-run the full 24-epoch training cycle.
- Framework migration: PyTorch 2.x compatibility requires patching mmcv and mmdet3d version pins. Check community forks before attempting migration; the mmdet3d API changed substantially between 1.x and 2.x.
- To reproduce detection results: the official repo uses mmdet3d-style distributed training; the Waymo dataset preprocessing (tfrecord → kitti-bin) must follow the mmdet3d Waymo pipeline exactly.

## Sources

- arXiv: https://arxiv.org/abs/2301.08739
- ar5iv full text: https://ar5iv.labs.arxiv.org/html/2301.08739
- CVPR 2023 proceedings: https://openaccess.thecvf.com/content/CVPR2023/html/Liu_FlatFormer_Flattened_Window_Attention_for_Efficient_Point_Cloud_Transformer_CVPR_2023_paper.html
- CVPR 2023 poster: https://cvpr.thecvf.com/virtual/2023/poster/21308
- GitHub (MIT Han Lab): https://github.com/mit-han-lab/flatformer
- Training config (3-frame): https://github.com/mit-han-lab/flatformer/blob/main/configs/flatformer/flatformer_waymo_D1_2x_3class_3f.py
- Project page (MIT Han Lab): https://hanlab.mit.edu/projects/flatformer/
- SST (predecessor, CVPR 2022): https://arxiv.org/abs/2112.06375
- SWFormer (predecessor, ECCV 2022): https://arxiv.org/abs/2210.07372
- PTv3 (successor / segmentation analog, CVPR 2024): https://arxiv.org/abs/2312.10035
- ScatterFormer (follow-on, ECCV 2024): https://arxiv.org/abs/2401.00912
- Related repository page: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline (§7.8 training-architecture comparison)
- Related repository page: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation (FlatFormer appears in its real-time §5)
- Related method page: `./point-transformer-v3.md` — serialization-based transformer; the stronger published choice for map segmentation
