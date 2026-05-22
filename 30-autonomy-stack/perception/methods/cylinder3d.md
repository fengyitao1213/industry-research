# Cylinder3D

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "classic-baseline"
  maturity: "prototype"
  tags: ["perception", "lidar", "segmentation", "road-av"]
  reason: "Cylinder3D is the cylindrical sparse-voxel baseline for single-scan spinning-LiDAR semantic segmentation."
method-priority:end -->

## What It Is

- Cylinder3D is a 3D segmentation network for **driving-scene LiDAR**, introduced in "Cylindrical and Asymmetrical 3D Convolution Networks for LiDAR Segmentation" (CVPR 2021 Oral).
- It is designed specifically for single-scan, ego-centric point clouds from spinning automotive LiDAR (Velodyne VLP-64, HDL-32, OS1-64 class).
- Its defining choice is the **cylindrical partition** — voxelizing in radius/azimuth/height instead of a uniform Cartesian grid — so that each voxel covers approximately the same solid angle as seen from the sensor origin.
- It pairs that partition with **asymmetrical 3D residual convolutions** tuned to the shapes of driving-scene objects, and a **Dimension-Decomposition Context Module (DDCM)** for lightweight global context aggregation.
- It was a leading single-scan LiDAR-segmentation baseline on SemanticKITTI and nuScenes at publication; a panoptic extension was released and ranked 1st on SemanticKITTI panoptic in late 2020.
- See also: `minkowskinet.md` for the Cartesian sparse-voxel alternative — recommended for aggregated multi-scan maps where the cylindrical assumption breaks down.

## Core Technical Idea

A spinning LiDAR produces point clouds whose density falls sharply with range: density is proportional to 1/r², where r is radial distance. A uniform Cartesian voxel grid is therefore badly matched — near-sensor voxels are crowded with hundreds of points, far-sensor voxels contain zero or one, wasting network capacity and failing to extract far-range features.

Cylinder3D voxelizes in **cylindrical coordinates** (radius, azimuth, height). Because each cylindrical voxel's volume grows with r, it subtends approximately the same solid angle from the sensor origin across all ranges — point count per voxel becomes far more uniform. The network then applies **asymmetrical residual blocks** whose kernel shape is biased toward the dominant elongated orientations of cars, buses, and other driving objects, and aggregates global context efficiently via DDCM. The design thesis: align the discretization and convolution with the physics of the sensor and the geometry of the scene.

## Inputs and Outputs

- Inputs: a single LiDAR scan as `(x, y, z, intensity)`, converted to cylindrical voxels.
- Per-point features are first encoded by an input MLP before scattering into voxels.
- The cylindrical partition is defined relative to the ego-vehicle sensor origin — the method assumes a single-origin, single-scan ego-centric cloud.
- Output: per-voxel class logits, propagated back to the contributing points; the panoptic variant adds per-instance predictions.
- The network is a complete end-to-end segmentation system, not a backbone intended for a separate head; however, its U-Net encoder can be repurposed for other tasks.

## Cylindrical Voxelization

The cylindrical coordinate transform:

```
rho = sqrt(x^2 + y^2)     (radial distance from sensor)
theta = atan2(y, x)        (azimuth angle)
z = z                       (height unchanged)
```

The space is partitioned uniformly in (rho, theta, z). A voxel at radial index k spans a radial shell of width `delta_rho`; its volume is approximately `rho_k * delta_rho * delta_theta * delta_z`, which grows linearly with `rho_k`. This compensates for the 1/r² point-density falloff so that each voxel receives a more uniform number of points.

Typical grid configuration for SemanticKITTI: **480 × 360 × 32** cylinders covering approximately ±51.2 m in xy, −3 to +5 m in z. After voxelization, the grid is treated as a 3D sparse tensor and processed by a sparse-convolution U-Net using SpConv as the backend engine.

**Why cylindrical voxels improve far-range accuracy:** At 50 m range, a 5 cm Cartesian voxel subtends roughly 0.1 mrad of solid angle. A cylindrical voxel at the same range that spans 0.5° azimuth and 25 cm radial depth has ~3× more points on average than its Cartesian counterpart at 10 m, keeping the voxel feature signal non-trivial. The ablation in the original paper confirms a direct accuracy lift from cylindrical partitioning alone: Cartesian + plain 3D U-Net scores ~60% mIoU on SemanticKITTI val; switching to cylindrical partition raises this to 61.5% before any other modification.

## Architecture

### Overall Structure

A cylindrical-voxel sparse-convolution U-Net:

1. **Input MLP:** Encodes raw per-point features `(x, y, z, intensity, rho, theta)` to a higher-dimensional representation before voxel scattering.
2. **Encoder:** Series of asymmetrical residual blocks with strided sparse downsampling. Each stage halves spatial resolution and doubles channel width.
3. **Context module:** DDCM placed at the bottleneck (lowest resolution) to aggregate long-range context.
4. **Decoder:** Sparse transposed convolutions (upsampling) + skip connections from encoder stages; asymmetrical residual blocks in each decoder stage.
5. **Head:** Per-voxel linear classifier outputs class logits; labels propagated back to points.

Built on SpConv, so it inherits the efficiency of sparse convolution (compute proportional to occupied voxels, not grid volume).

### Asymmetrical Residual Block

The standard 3×3×3 residual block (27 operations per element at each layer × C_in × C_out) is replaced by two sequential asymmetric convolutions:

```
AsymmetricBlock(x) = Conv(3x1x3)(x) -> BN -> ReLU -> Conv(1x3x3)(.) -> BN -> ReLU + x
```

Properties:
- **Receptive field:** Equivalent to 3×3×3 — the 3×1×3 and 1×3×3 kernels together cover all three spatial dimensions.
- **Compute reduction:** 3×1×3 = 9 weights per channel pair + 1×3×3 = 9 = 18 total, versus 27 for a symmetric 3×3×3 kernel. This is a **33% MAC reduction** with no receptive-field degradation.
- **Shape bias:** The decomposed factorization was inspired by the observation that driving-scene objects (cars, trucks, buses) are predominantly cuboid and elongated horizontally. The sequential row/column factorization captures elongated structures more efficiently than an isotropic kernel.
- **Ablation result:** Substituting asymmetric for symmetric blocks gives +1.5% mIoU on SemanticKITTI val (61.5% → 63.0%).

### Dimension-Decomposition Context Module (DDCM)

Global context is important for resolving ambiguous local geometries (e.g., a pedestrian vs. a vertical pole). Full 3D self-attention is expensive. DDCM decomposes the 3D context tensor into three rank-1 attention components:

```
DDCM(F) = F + sigmoid(Conv(3x1x1, F)) * F
             + sigmoid(Conv(1x3x1, F)) * F
             + sigmoid(Conv(1x1x3, F)) * F
```

Each term computes a 1D attention map along one of the three axes (rho, theta, z) and modulates features channel-wise (element-wise product). This is analogous to CP tensor decomposition: the full 3D attention map is approximated by the outer product of three independent 1D attention vectors. The result captures cross-dimensional context at much lower cost than full 3D attention.

**Ablation result:** Adding DDCM at the bottleneck gives +1.3% mIoU on SemanticKITTI val (63.0% → 64.3%).

## Training Recipe

| Parameter | Value |
|-----------|-------|
| Optimizer | Adam, LR = 0.001 |
| Loss | Weighted cross-entropy + Lovász-softmax (equal weights) |
| Backend | SpConv (cylindrical voxel → sparse tensor) |
| TTA (basic) | Flip augmentation: x-axis, y-axis, x-y-axis flip (average softmax predictions) |
| Hardware | Not specified in original paper |

**With improved training recipe (arXiv 2405.14870):** LaserMix + PolarMix data mixing augmentations, combined with TTA, raises Cylinder3D to 69.4% mIoU on SemanticKITTI val and 80.9% on nuScenes-lidarseg val — on par with or above much more complex architectures from the same period.

**Lovász-softmax:** As with MinkUNet, combining cross-entropy (per-voxel accuracy) with Lovász-softmax (direct IoU surrogate) is standard practice. For rare driving-scene classes (motorcyclist, traffic-cone, bicycle) the Lovász term provides signal that cross-entropy alone would bury under majority-class gradients.

## Variants and Lineage

### Cylinder3D Panoptic

The panoptic extension of Cylinder3D was the first entry combining instance and semantic predictions in the cylindrical-voxel framework. It ranked 1st on the SemanticKITTI panoptic leaderboard in November 2020. It adds an instance head (center regression or offset regression) on top of the semantic backbone and post-processes the cylindrical-voxel predictions to produce instance masks.

### PVKD (CVPR 2022)

Point-Voxel Knowledge Distillation uses Cylinder3D as the student network and a larger, slower teacher model to transfer knowledge during training. The distilled Cylinder3D variant achieves higher mIoU than the standard Cylinder3D training recipe without architectural changes, illustrating that the cylindrical-voxel backbone has capacity headroom that standard training does not fully exploit.

### Paper Versions

Two closely related papers document Cylinder3D's development:
1. **arXiv 2008.01550 (2020 preprint):** "Cylinder3D: An Effective 3D Framework for Driving-scene LiDAR Semantic Segmentation" — first public preprint with 64.3% val mIoU.
2. **CVPR 2021 Oral, arXiv 2109.05441:** "Cylindrical and Asymmetrical 3D Convolution Networks for LiDAR Segmentation" — final conference version; 65.9% val mIoU; added panoptic configuration and ablation detail.

## Benchmark Results

### SemanticKITTI (20 classes, mIoU)

Ablation showing incremental contribution of each design choice:

| Configuration | Val mIoU |
|---------------|----------|
| Cartesian + plain 3D U-Net baseline | ~60% |
| Cylindrical partition + 3D U-Net | 61.5% |
| + Asymmetric residual block | 63.0% |
| + DDCM | 64.3% |
| + Flip TTA | 65.2% |

Full benchmark comparisons:

| Configuration | Val mIoU | Test mIoU | Source |
|---------------|----------|-----------|--------|
| Cylinder3D (arXiv 2020) | 64.3% | 61.8% | arXiv 2008.01550 |
| Cylinder3D + flip TTA | 65.2% | — | arXiv 2008.01550 |
| Cylinder3D (CVPR 2021) | 65.9% | — | multiple reports |
| Cylinder3D + mix + TTA | 69.4% | — | arXiv 2405.14870 |
| MinkUNet + mix + TTA (reference) | 71.8% | — | arXiv 2405.14870 |
| SphereFormer + TTA (reference) | 69.0% | 74.8% | Lai CVPR 2023 |

### nuScenes-lidarseg (16 classes, mIoU)

| Configuration | mIoU | fwIoU | FPS | Source |
|---------------|------|-------|-----|--------|
| Cylinder3D (nuScenes challenge) | 77.9% | 89.9% | 10 Hz | GitHub README |
| Cylinder3D + mix + TTA | 80.9% | — | — | arXiv 2405.14870 |
| MinkUNet + mix + TTA (reference) | 80.1% | — | — | arXiv 2405.14870 |

### Panoptic segmentation

Cylinder3D ranked 1st on SemanticKITTI panoptic leaderboard, November 2020.

## Complexity and Compute

**Latency:** Cylinder3D achieves approximately 10 Hz (100 ms per frame) on nuScenes per the official GitHub. This is within the Orin ~100 ms cycle budget for on-vehicle single-scan segmentation.

**Memory:** The 480 × 360 × 32 cylindrical grid contains 5.5 M cells. At typical 0.5–2% occupancy for a single 64-beam scan, approximately 27 K–110 K voxels are active — far sparser than the corresponding Cartesian grid. Sparse convolution memory scales with active voxels, not grid size.

**Compute vs. MinkUNet:** The asymmetric block's 33% MAC reduction means Cylinder3D's encoder is lighter than an equivalent-depth MinkUNet with symmetric blocks. No direct published FLOPs comparison between Cylinder3D and MinkUNet34-W32 is available in the primary papers.

## Strengths

- The cylindrical partition **matches spinning-LiDAR density physics**, improving far-range and overall single-scan accuracy over Cartesian baselines.
- Asymmetrical convolutions spend kernel capacity on the geometry that matters for driving objects — measurable +1.5% ablation gain at 33% fewer MACs vs symmetric 3×3×3.
- DDCM provides lightweight global context aggregation (three 1D conv passes vs. full 3D self-attention).
- Efficient — built on SpConv; reaches ~10 Hz single-scan on automotive hardware.
- Well-known, well-reproduced single-scan baseline with panoptic extension and public training code.
- Strong fit for the real-time on-vehicle segmentation task in automotive driving scenes.
- With modern augmentation (LaserMix + PolarMix + TTA), competitive with or above architectures from 2022–2023.

## Failure Modes

- **Aggregated multi-scan maps:** The cylindrical frame is sensor-centric (ego-vehicle origin). Multi-scan maps have no single origin — the cylindrical partition degenerates, producing an inconsistent and distorted voxel structure. Cartesian is the only correct choice for aggregated maps. See §7.2 of `../overview/aggregated-map-semantic-segmentation.md`.
- **Solid-state LiDARs:** Livox Mid-360, Innoviz Pro, and similar sensors do not follow the 1/r² density pattern of spinning LiDAR. The cylindrical equalization logic does not apply and can even hurt. Cartesian or sensor-model-specific voxelization is required.
- **Non-automotive environments:** The asymmetric block's cuboid-shape bias is less helpful in natural terrain (mining, agriculture), indoor environments (warehouses, ports), or aircraft geometry. For airside use, the asymmetric block's assumptions are partially valid (ground vehicles) but fail for aircraft, runways, and infrastructure.
- **Far-range thin structures at large azimuth angles:** At long range (>50 m), azimuthal cells become wide in absolute terms even after cylindrical correction. Thin vertical structures (poles, fences) at far range can still be missed.
- **Accuracy ceiling:** Cylinder3D now trails the latest transformer backbones (SphereFormer, OA-CNNs) at the top of leaderboards; the cylindrical design is partially matched or exceeded by radial-window transformers (SphereFormer) that make a similar geometric assumption more flexibly.
- Voxelization caps thin-class resolution, as in any voxel method.

## Domain Fit

| Domain | Fit | Note |
|--------|-----|------|
| Road AV (on-vehicle) | strong | Designed for exactly this — single-scan spinning-LiDAR segmentation in a real-time budget. |
| Road AV (offline / maps) | weak | The cylindrical, ego-centric partition does not fit aggregated multi-viewpoint maps; use a Cartesian backbone there. |
| Airside (single-scan, on-vehicle) | conditional | Reasonable on-vehicle single-scan baseline once trained on airside data; asymmetric block is less well-matched to aircraft geometry than to road vehicles. |
| Airside (aggregated map) | not suitable | Wrong partition for accumulated multi-scan maps — see `../overview/aggregated-map-semantic-segmentation.md` §7.2. |
| Warehouse / port / mining / construction / agriculture | conditional | Fits where a single spinning LiDAR scans ego-centrically; weak for fused or surveyed clouds; outdoor vegetation and rough terrain degrade the cuboid-bias of asymmetric blocks. |

## Aggregated-Map Suitability

Cylinder3D is **not suitable** for segmenting aggregated multi-scan LiDAR maps. The breakdown is architectural and cannot be patched with fine-tuning:

**Single-origin assumption:** The cylindrical partition is defined relative to a specific ego-vehicle position. An aggregated map merges point clouds from tens or hundreds of different scan positions. There is no single origin around which to define rho and theta consistently. Any attempt to apply the cylindrical transform to an aggregated cloud requires choosing an arbitrary origin, which distributes points non-uniformly across cylindrical voxels and reintroduces the very problem that cylindrical voxelization was designed to solve.

**Density-uniformity inversion:** After aggregating many scans, the point density in a Cartesian patch is nearly uniform — accumulation of scans from many angles fills in the 1/r² gaps. The cylindrical voxel's variable-volume design (larger at larger rho) was engineered to compensate for single-scan density falloff. Applied to a dense aggregated cloud, cylindrical voxels are oversized at large radii relative to the available point density, and undersized near the arbitrarily chosen origin.

**Tiling geometry:** Large scenes must be processed in tiles. Cartesian tiles are rectangular and tile the plane without distortion. Cylindrical tiles would require radial sectors — non-rectangular, non-uniform in world-space area, and difficult to define consistent overlap halos for.

**Comparison with Cartesian sparse-voxel:**

| Property | Cylinder3D | MinkUNet / SPVCNN |
|----------|------------|-------------------|
| Coordinate frame | Sensor-ego-centric | World-frame Cartesian |
| Multi-viewpoint support | Breaks: no single origin | Natural fit |
| Density uniformity post-aggregation | Distorted | Uniform |
| Large-scene tiling | Radial sectors; non-uniform | Rectangular tiles; trivial |
| Infrastructure alignment (runways, walls) | Azimuthal slicing misaligns | Aligns naturally |
| Sensor-geometry assumption | Spinning LiDAR 1/r² | None |

**Recommendation:** For any aggregated multi-scan offline map use case — airside semantic mapping, HD map annotation, digital twin construction — use MinkUNet (or SPVCNN, OA-CNNs) with Cartesian sparse voxels. Cylinder3D's role is the single-scan, real-time, ego-centric on-vehicle segmentation problem where its design assumptions hold.

## Implementation Notes

- Use Cylinder3D for the **single-scan, on-vehicle** segmentation task, not for aggregated-map segmentation — the partition assumption is the deciding factor.
- For an aggregated map, use a Cartesian sparse-conv backbone (MinkUNet, SPVCNN, OA-CNNs) — see `minkowskinet.md`.
- Keep intensity calibrated — the network encodes it in the per-point input MLP and relies on it for appearance-defined classes (road markings, vegetation, building facades).
- Use Lovász-softmax loss to optimize IoU directly and help rare classes; combine with class-weighted cross-entropy for the most severely imbalanced categories.
- Apply LaserMix + PolarMix augmentations — the empirical study (arXiv 2405.14870) shows these are the largest single training-recipe gains available for Cylinder3D (+several mIoU points over vanilla augmentation).
- The panoptic variant is the route to instance outputs (vehicles, pedestrians) when needed; it adds modest overhead and reuses the same cylindrical-voxel backbone.
- Validate far-range behavior explicitly; azimuthal cell width at >50 m is where the partition's benefit and its limits both manifest.
- For deployment: the SpConv backend is well-supported on Jetson Orin; ensure SpConv v2 is used (v1 is deprecated and slower).
- If moving to a newer transformer backbone for on-vehicle use, SphereFormer makes a similar radial-window geometric assumption with substantially higher accuracy; Cylinder3D remains a lighter and more reproducible baseline.

## Sources

- Cylinder3D preprint: https://arxiv.org/abs/2008.01550 (Zhou et al. arXiv 2020)
- Cylinder3D CVPR 2021 (conference version): https://openaccess.thecvf.com/content/CVPR2021/papers/Zhu_Cylindrical_and_Asymmetrical_3D_Convolution_Networks_for_LiDAR_Segmentation_CVPR_2021_paper.pdf (Zhu, Zhou et al. CVPR 2021)
- Cylinder3D extended (IEEE TPAMI 2021): https://arxiv.org/abs/2109.05441
- Reference implementation: https://github.com/xinge008/Cylinder3D
- SpConv v2 (backend engine): https://github.com/traveller59/spconv
- Lovász-Softmax loss: https://arxiv.org/abs/1705.08790 (Berman et al. CVPR 2018)
- Empirical training study (LaserMix/PolarMix results): https://arxiv.org/html/2405.14870v2
- SphereFormer (radial-window transformer successor): https://arxiv.org/abs/2303.12766 (Lai et al. CVPR 2023)
- SphereFormer GitHub: https://github.com/dvlab-research/SphereFormer
- MinkUNet / Cartesian alternative: https://arxiv.org/abs/1904.08755 (Choy et al. CVPR 2019)
- Related repository page: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation
- Related repository page: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline; §7.2 on why Cylinder3D is unsuitable for multi-scan maps; §7.8 for the head-to-head model-family comparison
- Related method page: `minkowskinet.md` — Cartesian sparse-voxel baseline recommended for aggregated maps
