# SPVCNN

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "classic-baseline"
  maturity: "prototype"
  tags: ["perception", "lidar", "segmentation", "road-av"]
  reason: "SPVCNN's sparse point-voxel convolution is the efficient point-voxel-hybrid baseline for real-time LiDAR semantic segmentation."
method-priority:end -->

## What It Is

- SPVCNN is a 3D LiDAR semantic segmentation network introduced in "Searching Efficient 3D Architectures with Sparse Point-Voxel Convolution" (ECCV 2020, MIT Han Lab).
- Its defining contribution is the **SPVConv operator**: a dual-branch block that fuses a sparse-voxel branch (broad spatial context via sparse 3D convolution) with a lightweight point-MLP branch (fine per-point resolution preserved at all scales).
- The hand-designed SPVCNN network stacks SPVConv blocks into a 3D U-Net and outperforms MinkowskiNet at matched compute budgets on SemanticKITTI.
- The same paper introduces **SPVNAS**, an evolutionary 3D neural architecture search over the SPVConv design space, which further improves the accuracy-efficiency Pareto frontier by 8–23× compute reduction versus prior methods at equal mIoU.
- SPVCNN is widely adopted as a standard comparison baseline in subsequent work (2DPASS, PolarMix, Point-to-Voxel KD) and is available in mmdetection3d with independently maintained configs.
- The official repository (`mit-han-lab/spvnas`) was archived in July 2024; the NAS search code was never released.
- See also: `minkowskinet.md` for the pure sparse-voxel sibling; `./point-transformer-v3.md` for the transformer alternative.

## Core Technical Idea

At ECCV 2020, outdoor LiDAR semantic segmentation faced two families of models with a hard trade-off:

**Pure sparse-voxel (MinkowskiNet):** Sparse 3D convolution over occupied voxels is computationally tractable for outdoor-scale point clouds (100 k+ points, 100+ m range). However, voxelization is a lossy quantisation step — two points that fall in the same voxel cell become indistinguishable in the voxel branch. At the resolutions required for tractable inference, small objects (pedestrians, cyclists) routinely share voxels, suppressing fine-grained boundary and instance detail.

**Pure point-based (KPConv, PointNet++):** Operates at full point resolution, but irregular memory access and O(N·k) neighborhood search make these methods too slow for real-time outdoor inference on single-scan clouds.

SPVCNN's answer: **keep sparse convolution as the voxel backbone for scale efficiency, and add a parallel lightweight point MLP branch that never loses point-level resolution**. The two branches are fused element-wise at each block. The point branch adds ~1–2 GMACs to a ~29–30 GMAC model — negligible overhead, measurable accuracy gain. The resulting architecture sits squarely between MinkowskiNet (pure voxel) and KPConv (pure point) on the accuracy-efficiency plane, consistently outperforming MinkowskiNet at matched compute.

## Operator Mechanics

The SPVConv operator is the repeating unit of both SPVCNN and SPVNAS. For an input point set `P` with `N` points, coordinates `(x_i, y_i, z_i)` and per-point features `f_i`:

**Notation:**
- `r` — voxel grid resolution (side length in voxels; common setting ~0.05 m)
- `V` — sparse voxel tensor after voxelization; `|V| << r^3` (typically 1–5% occupancy for single-scan outdoor LiDAR)
- `W_s` — sparse conv kernel weights, shape `K^3 x C_in x C_out` (typically K=3)

**Voxel branch:**

```
V       = Voxelize(P, r)              # aggregate points -> sparse tensor; cells with no
                                       # points have zero memory cost
V_prime = SparseConv(V, W_s)          # sparse 3D conv over occupied cells only
p_v     = TrilinearDevoxelize(V_prime, P, r)
                                       # project voxel features back to each point i
                                       # via trilinear interpolation from 8 surrounding
                                       # voxel corners; O(8N) -- effectively free
```

**Point branch:**

```
p_p = SharedMLP(f_i for each i in P)  # 1x1 conv = Linear -> BN -> ReLU per point;
                                        # always operates at full N-point resolution
```

**Fusion:**

```
p_out_i = p_v_i + p_p_i               # element-wise addition; concat used in some variants
```

This is applied per SPVConv block. The voxel branch provides large receptive field context (sparse conv aggregates across spatially distant occupied cells in `K^3` neighborhoods). The point branch preserves per-point identity lost by voxel quantisation — two points in the same voxel receive the same `p_v` but distinct `p_p`, so the fused `p_out` is still point-discriminative.

**Complexity per SPVConv block:**
- Voxel conv: `O(K^3 * C_in * C_out * |V|)` — scales with occupied voxels, not grid volume
- Point MLP: `O(N * C_in * C_out)` — linear in point count, small constants
- Devoxelize: `O(8N)` — negligible
- Memory: dominated by the sparse tensor; point branch is N-linear

## Inputs and Outputs

- **Input:** A single LiDAR scan as a point set `(x, y, z, intensity/remission)` in Cartesian world-frame or ego-frame coordinates; `N` typically 50 k–130 k points for a 64-beam outdoor scan.
- **Coordinate frame:** Cartesian (world or ego), not sensor-centric cylindrical — SPVCNN is correct for both single-scan and aggregated-map Cartesian inputs at the operator level.
- **Output:** Per-point class logits → argmax to per-point semantic label; 19 classes for SemanticKITTI, 16 for nuScenes-lidarseg.
- No multi-scan temporal fusion; no instance prediction (semantic only in the base model).

## Architecture

SPVCNN stacks SPVConv blocks into a **3D U-Net** encoder-decoder with residual connections.

**Channel configuration:** Base channels `[32, 32, 64, 128, 256, 256, 128, 96, 96]` scaled by a compression ratio `cr` (e.g., `cr=0.5` → half channels for lighter variants; `cr=1.0` for full model). mmdetection3d exposes this as the `W` suffix (W16, W20, W32).

**Encoder (4 downsampling stages):**
- **Stem:** Two `BasicConvolutionBlock` units (sparse Conv3d → BN → ReLU) on the raw 4D input.
- **Stages 1–4:** Each stage applies stride-2 downsampling via a sparse stride-2 Conv3d, followed by `ResidualBlock`s (two 3×3 sparse convs with a skip connection). Resolution coarsens 1×, 2×, 4×, 8× across the four stages; channel width grows correspondingly.

**Decoder (4 upsampling stages):**
- Each stage applies a sparse transposed convolution (deconvolution) to upsample, concatenates the corresponding encoder skip-connection features, then applies residual refinement blocks.
- **Dropout 0.3** applied to voxel features before decoding stages.

**Point transform MLPs:**
Three shared-weight linear → BN → ReLU MLPs fuse voxel features at different U-Net scales back into the running per-point representation:
- `point_transform_1` — fuses stem-scale voxel features into point repr
- `point_transform_2` — fuses mid-encoder voxel features
- `point_transform_3` — fuses full decoder output into final point features

**Final classifier:** A linear layer applied per-point over the merged point features produces `C` class logits.

**Backbone engine:** TorchSparse (released by the same lab), providing high-performance sparse tensor operations and underpinning both SPVCNN inference and SPVNAS search.

## Complexity and Compute

| Model | GMACs | Params (M) | mIoU (val, SemanticKITTI) |
|-------|-------|------------|---------------------------|
| MinkUNet@29GMACs | ~29 | 5.5 | 59.3% |
| SPVCNN@30GMACs | ~30 | 5.5 | 60.8 ± 0.5% |
| SPVCNN@47GMACs | ~47 | — | 61.5 ± 0.2% |
| SPVCNN@119GMACs | ~119 | 21.8 | 63.8% |
| SPVNAS@20GMACs | ~20 | 3.3 | 58.9% |
| SPVNAS@65GMACs | ~65 | 10.8 | 64.7% |

**Latency:** ~73 ms per scan on SemanticKITTI reported in a follow-up community comparison (≈14 Hz throughput). PVCNN (the dense predecessor) ran on Jetson Nano; SPVCNN on NVIDIA Orin at reduced resolution settings is expected to be feasible for on-vehicle deployment at current AV compute budgets.

**Point branch overhead:** The point MLP adds ~1–2 GMACs to a ~29–30 GMAC model — confirmed by the paper's MAC tables. The "negligible overhead" claim is well-supported.

**Memory:** Dominated by the sparse tensor. Single-scan outdoor LiDAR typically achieves 1–5% voxel occupancy, so memory scales with occupied voxels, not the full grid.

## Training Recipe

| Hyperparameter | Value / Range | Confidence |
|----------------|---------------|------------|
| Optimizer | Adam — not confirmed in official YAML; torchpack YAML not publicly readable | Low — flag |
| Learning rate | Two-phase: LR=0.24 for first 15 epochs → LR=0.096 for next 15 epochs (reported in issue #40) | Medium |
| Epochs | ~15–30 (two-phase official); mmdet3d provides 15e and 3× schedule variants | Medium |
| Batch size | Effective batch 16 (8 GPUs × 2 per GPU, from mmdet3d config `8xb2`) | Medium |
| Hardware (official) | 8× NVIDIA RTX 2080Ti | High |
| Loss function | Cross-entropy + Lovász-Softmax (confirmed in issue #40 and downstream implementations) | High |
| Augmentations (standard) | Random flip, random rotation, random scale; train on SemanticKITTI sequences 00–07, 09–10; val on seq 08 | High |
| Augmentations (advanced) | LaserMix + PolarMix for SPVCNN-W32 3× schedule variant | High |
| Voxel resolution | Not fixed in paper; common practice ~0.05 m | Medium |
| Test-time augmentation | None reported in official model zoo | High |

**mmdetection3d variant:** Uses AdamW optimizer and CyclicLR scheduler — diverges from the original authors' recipe and is independently maintained. The W32 + 3× schedule + LaserMix/PolarMix config achieves the strongest published SPVCNN result (68.7% mIoU on SemanticKITTI val).

**NAS search code:** Never released. The official repo was archived July 2024 with "coming soon" for the search code. Practitioners can use the released SPVCNN hand-designed architecture and searched SPVNAS checkpoints but cannot re-run the architecture search.

## Benchmark Results

### SemanticKITTI — Validation Set (seq 08)

Numbers from the official SPVNAS repo model zoo (mIoU %):

| Model | GMACs | Params (M) | mIoU (val) |
|-------|-------|------------|------------|
| MinkUNet@29GMACs | ~29 | 5.5 | 59.3 |
| SPVCNN@30GMACs | ~30 | 5.5 | 60.8 ± 0.5 |
| MinkUNet@47GMACs | ~47 | — | 60.0 |
| SPVCNN@47GMACs | ~47 | — | 61.5 ± 0.2 |
| SPVCNN@119GMACs | ~119 | 21.8 | 63.8 |
| SPVNAS@20GMACs | ~20 | 3.3 | 58.9 |
| SPVNAS@65GMACs | ~65 | 10.8 | 64.7 |

### SemanticKITTI — Test Set

At publication (ECCV 2020), SPVNAS ranked **1st** on the SemanticKITTI 3D semantic segmentation leaderboard, outperforming MinkowskiNet by **3.3 mIoU points**. The paper reports 8–23× computation reduction and 3× measured speedup versus MinkowskiNet and KPConv at this result. Exact test-set mIoU is not confirmed from accessible sources (paper PDF is binary-unreadable via web fetch); community reproductions suggest the test-set figure lies in the 60–63% range. Do not treat the absolute test number as verified.

### mmdetection3d Variants (SemanticKITTI val, independently maintained)

| Config | mIoU (val) | GPU memory |
|--------|------------|------------|
| SPVCNN-W16, 15e | 61.8% | 3.9 GB |
| SPVCNN-W20, 15e | 62.6% | — |
| SPVCNN-W32, 15e | 64.3% | — |
| SPVCNN-W32, 3× + LaserMix + PolarMix | **68.7%** | 7.2 GB |

### nuScenes-lidarseg

A SPVNAS-based system won **First Prize** in the 6th AI Driving Olympics (ICRA 2021) nuScenes semantic segmentation track. No confirmed mIoU figure is available from accessible sources — the competition win is stated on the project page without the numeric result.

### Efficiency vs. Baselines

| Method | GMACs | mIoU (val) | Speedup vs. MinkUNet |
|--------|-------|------------|----------------------|
| MinkUNet@29GMACs | ~29 | 59.3% | 1× (baseline) |
| SPVCNN@30GMACs | ~30 | 60.8% | ~1.1× |
| SPVNAS@20GMACs | ~20 | 58.9% | ~2.7× |
| SPVNAS@65GMACs | ~65 | 64.7% | 3× (measured) |

Source: GitHub README, `mit-han-lab/spvnas`.

## Variants and Lineage

### PVCNN — the Dense Predecessor (NeurIPS 2019, Spotlight)

PVCNN ("Point-Voxel CNN for Efficient 3D Deep Learning", arXiv 1907.03739) introduced the dual-branch point + voxel design. Its voxel branch uses **dense** 3D convolutions bounded by cubic memory scaling — it was validated on indoor benchmarks (S3DIS, ShapeNet) and demonstrated 10× GPU memory reduction versus dense voxel baselines and 7× speedup versus point-based models. PVCNN ran successfully on Jetson Nano.

**PVCNN's outdoor scaling limit:** Dense 3D convolution does not scale to outdoor driving scenes because the grid volume (`r^3`) explodes with scene extent even though most cells are empty. SPVCNN directly addresses this by replacing the dense voxel branch with sparse convolution (via TorchSparse / MinkowskiEngine-style kernel maps), making the cost proportional to occupied voxels rather than grid volume.

### SPVCNN — Hand-Designed Sparse Upgrade

SPVCNN is PVCNN upgraded to sparse convolution. The dual-branch concept is identical; only the voxel branch changes from dense to sparse, which is what enables outdoor-scale LiDAR segmentation.

### SPVNAS — 3D Neural Architecture Search

SPVNAS applies evolutionary NAS over the SPVConv U-Net design space — variable number of layers and channels per stage, with weight sharing across sub-architectures (slimmable/once-for-all style). The search is resource-constrained by a MACs budget using mutation and crossover over architecture encodings. Multiple Pareto-optimal models are found at 20, 30, 47, 65, and 114 GMACs. SPVNAS consistently outperforms hand-designed SPVCNN at equal or lower compute; the searched architectures tend to concentrate capacity in early encoder stages rather than following the standard channel-doubling-per-stage pyramid. The TPAMI journal extension ("3D Neural Architecture Search with Point-Voxel Convolution") is indicated but not confirmed from accessible sources.

### Relation to MinkowskiNet

MinkowskiNet (Choy et al., CVPR 2019) uses generalised sparse convolution as its sole branch. SPVCNN's voxel branch uses the same sparse conv engine (via TorchSparse) — the voxel branch is architecturally equivalent to a MinkowskiNet sub-network. SPVCNN adds the point MLP branch on top, which is architecturally free relative to MinkowskiNet at the same GMACs but consistently improves accuracy. The two methods share the same Cartesian coordinate frame and the same suitability profile for aggregated-map work.

| Architecture | Voxel Branch | Point Branch | Outdoor LiDAR Scale |
|---|---|---|---|
| PointNet++ | — | Set abstraction MLP | Limited (slow at large N) |
| KPConv | — | Kernel point convolution | Yes, but slow |
| MinkowskiNet | Sparse 3D conv only | — | Yes, efficient |
| PVCNN | Dense 3D conv | SharedMLP | No (memory limited) |
| **SPVCNN** | **Sparse 3D conv** | **SharedMLP** | **Yes** |
| **SPVNAS** | **Sparse 3D conv (searched)** | **SharedMLP (searched)** | **Yes** |

## Strengths

- **Dual-branch solves the voxelization detail-loss problem at negligible cost** — the point branch adds ~1–2 GMACs to a ~30 GMAC model and consistently improves mIoU over MinkowskiNet at matched compute.
- **Sparse convolution backbone** makes outdoor-scale scenes (100 k+ points, 100+ m range) tractable on single-scan inference hardware; memory and compute scale with occupied voxels, not grid volume.
- **SPVNAS delivers Pareto-superior trade-offs** over hand-designed alternatives across the full 20–114 GMACs range — a result rarely achieved convincingly in NAS papers.
- **Cartesian coordinate frame** means the architecture is naturally compatible with aggregated multi-scan maps (unlike cylindrical methods), world-frame tile-based processing, and infrastructure-aligned semantic classes.
- **Strong baseline adoption:** SPVCNN is used as a standard comparison baseline in 2DPASS, PolarMix, Point-to-Voxel KD, and other subsequent work — provides good community validation of the published numbers.
- **TorchSparse ecosystem:** the authors released TorchSparse as a standalone high-performance sparse tensor library, widely adopted beyond SPVCNN.
- **mmdetection3d integration** provides independently reproducible configs (SPVCNN-W32 3× achieves 68.7% mIoU with augmentation).
- **nuScenes competition win (ICRA 2021)** demonstrates generality beyond a single benchmark.

## Failure Modes

- **Small instance recognition is partially improved but not solved** — at typical outdoor voxel resolutions, very small objects (pedestrians at distance, cyclists) still share voxel cells; the point branch mitigates but does not eliminate this.
- **Fixed voxel resolution couples resolution with memory and compute** — increasing resolution to improve small-object detail grows `|V|` and cost superlinearly; no adaptive or hierarchical resolution scheme exists in the base architecture.
- **NAS code never released** — the 3D architecture search procedure is unreproducible; practitioners can only use hand-designed SPVCNN or the pre-searched SPVNAS checkpoints.
- **Sparsity advantage diminishes on aggregated maps** — multi-pass accumulated maps can reach 30–80%+ voxel occupancy at 10 cm resolution; at that density the sparse conv skip-empty-voxel benefit largely disappears and dense conv may be comparably fast.
- **Quantisation error in voxelization** — trilinear devoxelization recovers a smooth approximation but cannot restore sub-voxel geometry precisely; a source of noise on fine structures (fence slats, thin poles, ground markings).
- **Single-scan design** — no built-in temporal fusion or multi-scan accumulation module; map-scale use requires explicit tiling and external stitching.
- **Dated accuracy ceiling** — SemanticKITTI state-of-the-art has advanced beyond 70+ mIoU using 2D-3D fusion, range-view + voxel fusion, and transformer backbones. SPVCNN without heavy augmentation sits at 60–64% and is now a mid-tier baseline.
- **Training hardware requirement** — the official recipe uses 8× RTX 2080Ti; the NAS search is even more expensive and unreproducible.

## Domain Fit

| Domain | Fit | Note |
|--------|-----|------|
| Road AV (on-vehicle, real-time) | Strong | Designed for this — single-scan outdoor LiDAR segmentation in a real-time budget; ~14 Hz throughput; compatible with Orin-class hardware. |
| Road AV (offline map labelling) | Moderate | Cartesian frame is correct for aggregated maps; efficiency advantage wasted in offline use — heavier accurate methods are preferable where compute time is unconstrained. |
| Airside (on-vehicle, single-scan) | Conditional | Viable on-vehicle single-scan baseline at 14–20 Hz on Orin; requires airside domain fine-tuning; Cartesian frame handles aircraft, infrastructure, and ground-vehicle geometry without the cylindrical assumption issues of Cylinder3D. |
| Airside (aggregated map, offline) | Weak | Cartesian frame is correct, but efficiency advantage is wasted offline; sparsity benefit degrades on dense accumulated maps; prefer KPConv or Minkowski transformer-based methods for accuracy-first offline processing. |
| Warehouse / port / mining / logistics | Conditional | Single-scan ego-centric scanning fits well; dense indoor or multi-viewpoint scanned environments reduce sparsity advantage; fine-tuning required for non-road object classes. |

## Aggregated-Map Suitability

SPVCNN is a **moderate fit** for aggregated multi-scan LiDAR map segmentation, better than Cylinder3D but not the primary recommendation for accuracy-first offline workflows.

**Where the dual-branch design helps:**
- The point branch operates at full point density regardless of voxel resolution, so it remains informative in regions where multiple scan passes accumulate high point density. For thin structures common in airside environments (jet bridges, stair units, taxiway markings, vehicle livery), per-point resolution is a genuine advantage over pure-voxel methods.
- The Cartesian coordinate frame aligns naturally with world-frame tile-based processing; rectangular tiles tessellate the scene without distortion and can carry consistent overlap halos.

**Where SPVCNN is strained on aggregated maps:**
- **Sparsity assumption breaks down.** A 10-pass airside map at 10 cm voxel resolution may reach 50–80% occupancy. The sparse conv engine's skip-empty-voxel benefit largely disappears; at that occupancy dense convolution is comparably fast and simpler.
- **No multi-scan provenance.** SPVConv has no concept of scan origin or viewpoint; aggregated maps need preprocessing (subsampling, re-voxelization) to bring them into a density regime that approximates single-scan statistics.
- **Memory at map scale.** A 500 m × 500 m airside area at 5 cm resolution with 15 m height headroom implies ~10^9 nominal voxel cells; sparse occupancy reduces the active count, but large map tiles still require careful chunking.
- **Out-of-distribution density.** The model was trained on SemanticKITTI/nuScenes single scans; aggregated map density is out-of-distribution and requires fine-tuning on representative dense-map samples.

**Recommended mitigation:** Tile the aggregated map into chunks sized to match single-scan scale (~100 m radius or equivalent area), process each tile independently through SPVCNN, and merge per-tile predictions with overlap averaging. This recovers the sparsity assumption and allows on-vehicle checkpoints to be applied with minimal fine-tuning. For accuracy-first offline processing without latency constraints, prefer MinkowskiNet (with or without transformer head), KPConv, or OA-CNNs.

**Verdict:** Best fit for single-scan or sliding-window map inference where latency matters and compute is constrained. For offline batch processing of dense accumulated maps where accuracy is paramount and compute time is unconstrained, SPVCNN is not the primary recommendation.

## Implementation Notes

- Use SPVCNN for **single-scan, on-vehicle** real-time segmentation; treat it as the efficient Cartesian baseline. For offline map labelling, evaluate whether the efficiency advantage is needed before committing to SPVCNN over heavier alternatives.
- **Backend:** TorchSparse (preferred; from the same lab, actively maintained as of 2024) or mmdetection3d's integrated implementation. Do not use the official spvnas repo directly for new projects — it is archived.
- **Loss function:** Cross-entropy + Lovász-Softmax (equal weighting). The Lovász term directly optimises the IoU surrogate and provides gradient signal for rare classes (pedestrians, cyclists, thin infrastructure) that cross-entropy alone would suppress.
- **Augmentation:** Apply LaserMix + PolarMix augmentations for maximum mIoU gain on SemanticKITTI-style data — the mmdet3d W32 3× config shows these are the largest single training-recipe lever available (+several mIoU over vanilla augmentation).
- **Compression ratio:** Start with `cr=0.5` (W16) for memory-constrained platforms (3.9 GB GPU memory); move to `cr=1.0` (W32) when GPU memory allows for the best accuracy.
- **Voxel resolution:** ~0.05 m is the community-standard starting point for SemanticKITTI-scale scenes; for airside environments with larger sparse areas, a coarser resolution (0.1 m) may be preferable to keep `|V|` manageable.
- **Domain fine-tuning:** For airside, warehouse, or port deployment, fine-tune from a SemanticKITTI or nuScenes checkpoint using 500–1,000 target-domain labelled frames with LoRA or full fine-tuning; cross-domain transfer requires only modest labelled data per the broader knowledge base findings.
- **Tile-based inference for maps:** For any aggregated-map inference, pre-tile the cloud into ~100 m radius chunks, run SPVCNN per tile, and merge with overlap averaging. This is necessary both for memory management and to keep voxel occupancy in the training-distribution range.
- **Competing baselines:** On SemanticKITTI, SPVCNN@30GMACs beats MinkUNet@29GMACs by 1.5 mIoU with equal compute — a solid argument for always preferring SPVCNN over plain MinkUNet when TorchSparse is available. For on-vehicle use on NVIDIA Orin with transformer headroom, consider Point Transformer V3 as the next step up.

## Sources

- SPVCNN / SPVNAS paper (ECCV 2020): https://arxiv.org/abs/2007.16100
- ECVA proceedings: https://link.springer.com/chapter/10.1007/978-3-030-58604-1_41
- Official GitHub (archived July 2024): https://github.com/mit-han-lab/spvnas
- SPVCNN model implementation: https://github.com/mit-han-lab/spvnas/blob/master/core/models/semantic_kitti/spvcnn.py
- Project page: https://hanlab.mit.edu/projects/spvnas
- PVCNN predecessor (NeurIPS 2019): https://arxiv.org/abs/1907.03739
- PVCNN GitHub: https://github.com/mit-han-lab/pvcnn
- PVCNN PVConv implementation: https://github.com/mit-han-lab/pvcnn/blob/master/modules/pvconv.py
- NVIDIA blog on PVCNN / Jetson: https://developer.nvidia.com/blog/point-voxel-cnn-3d/
- mmdetection3d SPVCNN configs: https://github.com/open-mmlab/mmdetection3d/tree/main/configs/spvcnn
- Training recipe discussion (issue #40): https://github.com/mit-han-lab/spvnas/issues/40
- Test performance discussion (issue #7): https://github.com/mit-han-lab/spvnas/issues/7
- Lovász-Softmax loss: https://arxiv.org/abs/1705.08790
- MinkUNet / MinkowskiEngine: https://arxiv.org/abs/1904.08755
- Related method page: `./minkowskinet.md` — pure sparse-voxel sibling; same Cartesian frame, no point branch
- Related method page: `./point-transformer-v3.md` — transformer alternative for higher-accuracy on-vehicle use
- Related overview: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation pipeline
- Related overview: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline (§7.2 sparse-voxel family; §7.8 training-architecture comparison)
