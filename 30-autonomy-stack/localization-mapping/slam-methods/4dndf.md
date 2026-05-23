# 4dNDF

<!-- method-priority:start
priority:
  learning: 3
  deployment: 2
  type: "method"
  stage: "frontier"
  maturity: "research"
  tags: ["slam", "mapping", "simulation", "validation"]
  reason: "4dNDF is rated for neural or Gaussian SLAM research and future dense map representation workflows."
method-priority:end -->

Related docs: [NeRF-SLAM](nerf-slam.md) · [Splat-SLAM](splat-slam.md) · [KISS-ICP](kiss-icp.md) · [FAST-LIO / FAST-LIO2](fast-lio-fast-lio2.md) · [ERASOR](erasor.md) · [FreeDOM Dynamic Object Removal](freedom-dynamic-object-removal.md) · [MapCleaner](mapcleaner.md) · [LT-Mapper / Khronos Lifelong Mapping](lt-mapper-khronos-lifelong-mapping.md) · [LiDAR Map Cleaning and Dynamic Removal](lidar-map-cleaning-dynamic-removal.md) · [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md) · [Aggregated Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md) · [Volume Rendering, Radiance Fields, and Gaussian Splatting](../../../10-knowledge-base/geometry-3d/volume-rendering-radiance-fields-gaussian-splatting.md)

**Last updated:** 2026-05-24

---

## What It Is

4dNDF ("3D LiDAR Mapping in Dynamic Environments using a 4D Implicit Neural Representation") is a CVPR 2024 paper by Xingguang Zhong, Yue Pan, Cyrill Stachniss, and Jens Behley from the PRBonn lab at the University of Bonn (arXiv:2405.03388, proceedings pp. 15417–15427). The official implementation lives at github.com/PRBonn/4dNDF.

The method learns a continuous **time-dependent truncated signed distance function (TSDF)** over a LiDAR scan sequence, then uses the temporal dimension to separate static geometry from moving objects. The output is a clean static 3D map and a per-point dynamic segmentation of the original sequence.

**Critical framing — what 4dNDF is and is not:**

- It is a **mapping backend**, not a SLAM system. Poses are supplied externally (e.g., from KISS-ICP or FAST-LIO2); 4dNDF does not estimate them.
- It operates **offline/batch**. The full sequence must be present before training begins; there is no incremental or online mode.
- It is **LiDAR-native**: supervision comes entirely from range measurements, with no camera or photometric loss.
- It is a **research candidate** for the map-cleaning layer of a larger pipeline, not a replacement for FAST-LIO2 or KISS-ICP as a localization front-end.

**Disambiguation — three papers that share initials or lab:**

| Paper | Group | Goal | Do not confuse |
|---|---|---|---|
| **4dNDF** (arXiv:2405.03388, CVPR 2024) | PRBonn (Zhong, Pan, Stachniss, Behley) | Static-map extraction + dynamic removal from LiDAR | This page |
| **LiDAR4D** (arXiv:2404.02742, CVPR 2024) | Zheng et al. (different group) | Novel-view *synthesis* for driving simulation | Different paper, different goal |
| **NDF-SLAM** (Measurement 2025, doi:10.1016/j.measurement.2025.126310) | Not PRBonn | Registration + loop closure via NDF | Unrelated 2025 journal paper |

The PRBonn lab also produced SHINE-Mapping (ICRA 2023, static LiDAR SDF mapping) and PIN-SLAM (TRO 2024, full SLAM with loop closure at 10 Hz). 4dNDF sits between them — it inherits the SDF supervision paradigm from SHINE-Mapping and adds a temporal axis, but it does not advance toward the full-SLAM capabilities that PIN-SLAM delivers.

---

## Core Technical Idea

4dNDF models the entire scan sequence as a single continuous function:

```
F(p, t) : R^3 x R -> R
```

This function takes a spatial position p = (x, y, z) and a continuous time value t and returns the signed distance to the nearest surface at that location and time. Time is not a discrete frame index; it is a fourth real-valued coordinate, giving the method its "4D" label (spatial 3D plus temporal).

**Why this framing matters.** Classical TSDF fusion treats each scan as a static snapshot and accumulates measurements into a fixed volume; the result smears moving objects into ghost geometry. Neural static SDF methods (SHINE-Mapping) face the same problem. By making the field time-dependent, 4dNDF can represent the state of the scene at any continuous time value, letting static geometry appear as time-invariant (low temporal variance in F) while moving objects produce high temporal variation.

**Primary product.** After training, querying where F(p, t) varies strongly over t identifies dynamic content. Querying where it is temporally stable yields the clean static map. The static mesh is extracted by running marching cubes on F(p, t_static) for any stable time value.

**What "4D" does not mean here.** The "4D" label echoes 4D radar terminology (range + Doppler + azimuth + elevation) but has a different meaning: it denotes a space-time field with one temporal dimension, not a four-spatial-axis structure.

---

## Operator Mechanics

### Time-Dependent TSDF Formulation

The field is factored as a sum of K = 32 temporal basis functions weighted by location-dependent coefficients:

```
F(p, t) = sum_{k=1}^{K}  w_k(p) * phi_k(t)
```

where:

- `phi_k(t)` are K = 32 **shared discrete cosine transform (DCT) basis functions**, precomputed and fixed throughout training. They span a frequency space over the sequence timeline; `phi_1` is time-independent (constant), so `w_1(p)` encodes the static-geometry component.
- `w_k(p)` are K location-dependent scalar weights **decoded from spatial features by a shallow MLP** (2 layers, 64 hidden units).

This factorization separates spatial and temporal concerns. Spatial resolution is handled by the voxel feature grid and MLP; temporal dynamics are encoded by the DCT basis without requiring per-frame feature grids. Memory therefore grows with scene size, not sequence length.

### Sparse Voxel Feature Grid

The scene is encoded by a **multi-resolution sparse voxel feature grid** with two resolution levels. Each active voxel corner stores an 8-dimensional learned feature vector. For any query point p, the spatial feature f(p) is obtained by trilinear interpolation of the 8 surrounding corner features at each level; the two levels are concatenated before the MLP decoder.

Sparse allocation means only voxels containing observed LiDAR returns are activated. This keeps memory proportional to observed scene extent, not bounding-box volume.

### MLP Decoder

The shallow MLP receives f(p) and outputs the K = 32 weight coefficients {w_k(p)}. Taking the dot product of these weights with the precomputed DCT basis vectors evaluated at query time t gives F(p, t). The full decode pipeline per query:

```
1. Trilinear interpolation of voxel corner features -> f(p)   [spatial]
2. MLP: f(p) -> {w_1(p), ..., w_K(p)}                        [temporal weights]
3. F(p, t) = sum_k  w_k(p) * phi_k(t)                        [field value]
```

### Dynamic Removal Application

After training, dynamic content is identified by computing the **temporal variance of F(p, t)** at each query point over a set of uniformly spaced time values spanning the sequence. Points or map voxels where variance exceeds a threshold are flagged as dynamic and excluded from the final static map. The threshold is a configuration parameter and can be tuned to trade off false positives (static geometry classified as dynamic) against false negatives (dynamic objects retained in the static map).

This approach is unsupervised and label-free: no bounding boxes, no segmentation network, no class labels. It relies solely on the temporal consistency of the learned SDF.

---

## Inputs and Outputs

| Item | Role |
|---|---|
| LiDAR scan sequence (N scans) | Primary supervision signal; provides range measurements along rays |
| Per-scan 6-DoF poses (externally supplied) | Required; produced by KISS-ICP, FAST-LIO2, GNSS+INS, or any reliable odometry source |
| Voxel resolution and training config | Controls spatial detail, sampling density, loss weights, and optimizer schedule |
| GPU-capable environment (PyTorch + CUDA) | Required for practical training; no embedded deployment path in the published code |
| Timestamp per scan | Required; the temporal basis is indexed against these timestamps |
| Static mesh or point cloud | Primary output: clean static map with dynamic objects removed |
| Dynamic point segmentation | Per-point labels classifying which input scan points belong to dynamic objects |
| Time-specific SDF queries | Supports querying the learned field at any (p, t); useful for research visualization |

**What 4dNDF does not produce:** poses, odometry, loop-closure corrections, or any localization output. All of these must come from the external odometry front-end.

---

## Pipeline

```
External SLAM front-end (KISS-ICP / FAST-LIO2 / GNSS+INS)
  -> per-scan 6-DoF poses + timestamps
        |
        v
4dNDF offline batch training
  1. Transform all scans into a common reference frame using poses
  2. Initialize sparse voxel feature grid (2 resolution levels)
  3. Sample spatial-temporal points along rays (5 near-surface + 15 free-space per ray)
  4. Optimize voxel features + MLP weights via piecewise SDF losses + Eikonal reg
        |
        v
Post-training query phase
  5. Query F(p, t) at candidate surface points over timeline
  6. Compute per-point temporal variance of F
  7. Classify static (low variance) vs. dynamic (high variance)
  8. Run marching cubes on static field -> static mesh
  9. Export dynamic segmentation + static point cloud / mesh
```

---

## Architecture

| Component | Specification |
|---|---|
| Spatial representation | Multi-resolution sparse voxel grid, 2 levels |
| Feature dimension per voxel corner | 8-dimensional vector |
| Temporal basis functions | K = 32, discrete cosine transform (DCT), precomputed and fixed |
| MLP decoder | 2 layers, 64 hidden units; outputs K weight coefficients |
| Sampling per ray | 5 near-surface samples + 15 free-space samples |
| Pose input | External (not estimated by 4dNDF) |
| Implementation | Python 3.8 / PyTorch 1.13 / CUDA 11.6 / Ubuntu 22.04 |
| Key dependencies | Open3D 0.17, PyTorch3D, scikit-image, pykdtree, plyfile |
| Entry point | `python static_mapping.py config/test/test.yaml` |

The factored representation `F(p, t) = sum w_k(p) * phi_k(t)` is the key architectural innovation. Compared to approaches that store per-frame feature grids or per-frame SDFs, the shared DCT basis makes memory sub-linear in sequence length.

---

## Training Recipe

**Self-supervised — no labels required.** All supervision comes from LiDAR range measurements.

**Optimization:** Adam; jointly optimizes sparse voxel corner features and the MLP decoder weights. DCT basis functions are precomputed and held fixed.

### TSDF Supervision Signal

For a LiDAR return at measured range d along ray direction r, the ground-truth TSDF value at a sample point p_i at depth d_i along the same ray is:

```
phi_GT(p_i) = clip( d - d_i,  -tau,  +tau )
```

where tau is the truncation distance. Free-space points in front of the surface have positive values; points at the surface have near-zero values; points behind the surface have negative values.

### Piecewise Near-Surface Loss

A naive per-point L2 TSDF loss would assign contradictory supervision to the same static wall observed from multiple poses at different depths. 4dNDF uses a **piecewise loss** that enforces sign-correctness rather than exact values across the full truncation band:

```
Behind surface (d_i > d):
  penalize if F(p, t) > +epsilon   (should be negative or near zero)

Free-space in front of surface (d_i < d):
  penalize if F(p, t) < 0          (should be positive)

Near-surface band |d - d_i| < delta:
  L2 supervision against phi_GT    (full signal)
```

### Free-Space Loss

For points far from any surface (depth well below measured range):

```
L_free = || F(p, t) ||_1     subject to d_i << d
```

Enforces that clear free space registers as clearly positive SDF.

### Eikonal Regularization

```
L_eik = ( ||grad_p F(p, t)|| - 1 )^2
```

Enforces the fundamental property of a valid signed distance field: the spatial gradient magnitude equals 1 everywhere. Computed via numerical differentiation with a scheduled epsilon reduction during training.

### Total Loss

```
L = lambda_sdf * L_near-surface + lambda_free * L_free + lambda_eik * L_eik
```

All three terms are unsupervised with respect to semantic labels; supervision comes entirely from LiDAR range measurements.

---

## Benchmark Results

### Datasets

| Dataset | Content | Evaluation purpose |
|---|---|---|
| Co-Fusion ToyCar3 | Indoor tabletop LiDAR with moving toy cars | Surface reconstruction quality (ground-truth mesh available) |
| Newer College Dataset | Outdoor campus LiDAR sequences | Static map reconstruction quality |
| KTH DynamicMap Benchmark | Driving sequences (KITTI 00, KITTI 05, Argoverse2) with annotated dynamic/static labels | Dynamic object segmentation accuracy |

### Static Map Reconstruction — Co-Fusion ToyCar3

| Method | Completeness (cm) | Accuracy (cm) | Chamfer-L1 (cm) | F-Score (%) |
|---|---|---|---|---|
| **4dNDF** | **0.438** | **0.468** | **0.452** | **98.35** |
| SHINE-Mapping | 0.583 | 0.626 | 0.605 | 98.01 |
| VDB-Fusion | 0.574 | 0.481 | 0.528 | 97.95 |

4dNDF outperforms both classical TSDF fusion (VDB-Fusion) and the static neural baseline (SHINE-Mapping) on surface reconstruction where ground-truth geometry is available.

### Dynamic Object Segmentation — KTH DynamicMap Benchmark

| Sequence | Static Accuracy (%) | Dynamic Accuracy (%) | Associated Accuracy (%) |
|---|---|---|---|
| KITTI 00 | 99.46 | 98.47 | 98.97 |
| KITTI 05 | 99.54 | 98.36 | 98.95 |
| Argoverse2 | 99.17 | 95.91 | 97.53 |

4dNDF achieves best-in-class static/dynamic classification accuracy across all three sequences, outperforming Octomap variants, ERASOR, and SHINE-Mapping on this benchmark.

### What Is Not Benchmarked

4dNDF does **not** report pose accuracy (ATE, RMSE trajectory) because poses are assumed pre-given. Comparison to FAST-LIO2, KISS-ICP, or CT-ICP for localization accuracy is not applicable — those comparisons belong to PIN-SLAM and NeRF-LOAM. For aggregated-map reconstruction benchmarks that compare LIO + classical TSDF against neural SDFs, PIN-SLAM's TRO 2024 paper is the primary reference.

---

## Family Context — LiDAR Neural-Implicit SLAM Lineage

4dNDF belongs to a specific branch of the neural-implicit SLAM family: LiDAR-native methods that use signed distance fields rather than photometric (NeRF/3DGS) representations. The parent family (NeRF-SLAM from RGB-D inputs) is covered by [NeRF-SLAM](nerf-slam.md); the 3DGS branch is covered by [Splat-SLAM](splat-slam.md).

```
DeepSDF (CVPR 2019, Park et al.)
  Neural SDF for shape representation; auto-decoder architecture
  Established the MLP-parameterized SDF paradigm
        |
        +--> iSDF / NICE-SLAM (2021-2022)
        |     Camera-based neural-SDF SLAM (RGB-D input)
        |
        +--> SHINE-Mapping (ICRA 2023, Zhong/Pan/Behley/Stachniss)
        |     LiDAR-native neural-SDF mapping; sparse octree + shallow MLP
        |     No pose estimation; offline/incremental; static scenes only
        |
        +--> NeRF-LOAM (ICCV 2023, Deng et al.)
        |     Full LiDAR SLAM (poses estimated internally)
        |     Octree voxel embeddings + MLP SDF
        |     Ground/non-ground separation for Z-drift reduction
        |     Research-stage; unoptimized Python; not real-time
        |
        +--> PIN-SLAM (TRO 2024, Pan/Zhong/Wiesmann/Posewsky/Behley/Stachniss)
        |     Full LiDAR SLAM with loop closure
        |     Point-based implicit neural map; 10 Hz on NVIDIA A4000
        |     Correspondence-free point-to-implicit registration
        |
        +--> 4dNDF (CVPR 2024, Zhong/Pan/Stachniss/Behley)
              Mapping backend (external poses required); offline batch
              4D spatio-temporal SDF
              Focus: dynamic-object removal + accurate static map
```

### DeepSDF (CVPR 2019)

Park et al. (Facebook/Meta). arXiv:1901.05103. Seminal paper establishing the auto-decoder neural SDF paradigm: a continuous SDF for a class of shapes is encoded as a latent code decoded by an MLP. All downstream LiDAR-native neural-SDF methods inherit the SDF supervision concept from this work.

### SHINE-Mapping (ICRA 2023)

Zhong, Pan, Behley, Stachniss (Univ. Bonn). arXiv:2210.02299. GitHub: PRBonn/SHINE_mapping. Hierarchical sparse octree stores optimizable implicit features decoded to SDF by a shallow MLP. Supports incremental mapping with continual-learning regularization. No pose estimation; static-world assumption. 4dNDF is the direct temporal extension of SHINE-Mapping from the same lab and shares the supervision paradigm.

### NeRF-LOAM (ICCV 2023)

Deng et al. arXiv:2303.10709. Full LiDAR odometry + neural SDF mapping. Back-propagates through the neural SDF to estimate 6-DoF pose. Morton-code octree for dynamic voxel allocation. Ground/non-ground separation to reduce Z-axis drift. Mesh via marching cubes. MaiCity: accuracy 3.15 cm, Chamfer-L1 4.00 cm, F-score 92.96% at 10 cm threshold. KITTI sequence 00 RMSE ~1.34 m. Unoptimized Python; not real-time; no loop closure; research-stage as of mid-2024.

### PIN-SLAM (TRO 2024)

Pan, Zhong, Wiesmann, Posewsky, Behley, Stachniss (Univ. Bonn). arXiv:2401.09101. GitHub: PRBonn/PIN_SLAM. IEEE Transactions on Robotics 2024, vol. 40, pp. 4045–4064. Elastic sparse neural points — each stores a latent geometry feature. Pose estimated via correspondence-free point-to-implicit-model registration. Loop closure deforms the neural point cloud. Operates at 10 Hz on NVIDIA A4000. Accuracy on par with or better than FAST-LIO2, KISS-ICP, and CT-ICP on KITTI, MulRan, Newer College. Static-world SDF assumption; dynamic objects degrade registration.

### Family Summary Table

| Method | Venue | Poses | Online | Dynamic handling | Benchmark highlight |
|---|---|---|---|---|---|
| SHINE-Mapping | ICRA 2023 | External | No | No | Best static SDF reconstruction (MaiCity, Newer College) |
| NeRF-LOAM | ICCV 2023 | Internal | No (Python) | No | Accuracy 3.15 cm MaiCity |
| PIN-SLAM | TRO 2024 | Internal (loop) | Yes (10 Hz) | No | On-par with FAST-LIO2/KISS-ICP odometry |
| **4dNDF** | **CVPR 2024** | **External** | **No** | **Yes (temporal variance)** | **Best dynamic removal (KTH benchmark)** |
| NDF-SLAM | Measurement 2025 | Internal | Partial | No | Loop closure + registration via NDF (unrelated paper) |

### Relation to NeRF-SLAM and 3DGS-SLAM

| Family | Map primitive | Sensor input | Geometry encoding |
|---|---|---|---|
| NeRF-SLAM (iMAP, NICE-SLAM, etc.) | Volume density / RGB radiance | RGB or RGB-D | Volumetric NeRF |
| 3DGS-SLAM (MonoGS, SplaTAM, Splat-SLAM) | 3D Gaussian splats | RGB or RGB-D | Gaussian primitives |
| **4dNDF / PIN-SLAM / NeRF-LOAM** | Implicit SDF | **LiDAR range** | **Neural signed distance field** |

The LiDAR-native SDF family is architecturally distinct because LiDAR directly measures surface distances (zero-crossings of the SDF), whereas NeRF and 3DGS were designed around photometric rendering losses from cameras. See [Volume Rendering, Radiance Fields, and Gaussian Splatting](../../../10-knowledge-base/geometry-3d/volume-rendering-radiance-fields-gaussian-splatting.md) and [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md) for the broader representation background.

---

## Strengths

1. **Best-in-class dynamic-object removal accuracy.** CVPR 2024 KTH benchmark: 98–99% accuracy on KITTI 00 and KITTI 05; best among ERASOR, Octomap variants, and SHINE-Mapping. This is the primary reason to consider 4dNDF in a map-cleaning pipeline.

2. **Continuous SDF representation — no voxel discretization artifacts.** Unlike classical TSDF fusion, 4dNDF represents surfaces at sub-voxel precision. The continuous field enables smooth mesh extraction and sub-centimetre surface accuracy (Chamfer-L1 0.452 cm vs. SHINE-Mapping's 0.605 cm on ToyCar3).

3. **Dynamic-object removal without semantic labels.** Temporal variance in F(p, t) cleanly separates static from dynamic content without bounding-box annotations or segmentation networks. Applicable to object classes that would be absent from a training set.

4. **LiDAR-native geometry supervision.** Range measurements directly supervise the SDF zero-crossing; no camera, no photometric loss, no texture requirement. Works in low-light and adverse-weather environments where cameras degrade.

5. **DCT temporal factorization is parameter-efficient.** Shared K = 32 basis functions avoid storing K separate per-frame feature grids; memory is sub-linear in sequence length.

6. **Same-lab pedigree as PIN-SLAM and SHINE-Mapping.** Code maintained at PRBonn; consistent codebase conventions with other PRBonn neural-SDF tools; relatively well-documented for a research implementation.

---

## Failure Modes

**1. Not a SLAM system — poses must be pre-computed.** Requires an external odometry front-end such as [KISS-ICP](kiss-icp.md) or [FAST-LIO2](fast-lio-fast-lio2.md). Cannot be deployed standalone for localization. This is the most operationally significant limitation. Calibration errors or drift in the external SLAM front-end propagate directly into the neural field as geometric inconsistency; 4dNDF has no loop-closure correction.

**2. Offline/batch processing only.** The full scan sequence must be available before training begins. Cannot be used for real-time or online mapping. Incompatible with mission-critical closed-loop navigation requirements.

**3. Large-scale memory pressure.** Sparse hash-grid memory grows with scene size. Large outdoor environments — airport aprons of several km², multi-kilometre survey routes — will exhaust GPU memory faster than classical voxel maps without submap decomposition. This is the main scaling bottleneck explicitly noted in the paper.

**4. Slowly-moving objects may not register as dynamic.** Temporal variance requires sufficient temporal change across the sequence. Ground-support equipment sitting in the same spot for extended periods then moving (a common airside scenario) may not accumulate high variance before the movement and could be retained in the static map.

**5. Fast-moving objects can corrupt nearby static geometry.** Objects crossing multiple voxels within a single scan frame introduce high-frequency temporal signals that can spread geometric artifacts into adjacent static field regions.

**6. Severe occlusion degrades dynamic classification.** Objects partially observed from limited viewpoints have incomplete temporal coverage, producing ambiguous static/dynamic decisions.

**7. Calibration and pose accuracy sensitivity.** Neural SDF training is sensitive to external pose quality. Drift in the SLAM front-end degrades geometric consistency of the trained field in ways that are difficult to diagnose or correct post-hoc.

**8. GPU-heavy Python stack — not embeddable.** PyTorch + PyTorch3D dependencies are substantially heavier than optimized C++ SLAM front-ends. Not suitable for embedded or edge deployment without significant re-engineering.

**9. Repeated structure with small temporal differences.** Airport taxiway markings or uniform wall surfaces scanned at slightly different times with sensor motion may produce spurious temporal variance signals, causing false-positive dynamic classifications.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Airside apron / service roads (offline map cleaning) | Research candidate | Offline GSE removal via temporal SDF is technically well-suited; scale and pose requirements unvalidated at apron scale |
| Outdoor road / campus (KITTI-style) | Best validated | Tested on KITTI 00, KITTI 05, Argoverse2; strongest benchmark evidence |
| Outdoor campus static reconstruction | Good research fit | Tested on Newer College Dataset; competitive surface reconstruction |
| Indoor dynamic scenes (bounded) | Good research fit | Co-Fusion ToyCar3 evaluation; good pose coverage conditions |
| Large fleet map factory (automated pipeline) | Caution | Compute, reproducibility, and explainability require proven integration before adoption |
| Real-time / online SLAM | Not applicable | Offline batch by design; no incremental mode in published code |

---

## Aggregated-Map Suitability

### Role in the Layered Pipeline

4dNDF is a **map-cleaning backend**, not a SLAM front-end. In the context of the four-stage layered pipeline for aggregated LiDAR map building:

```
Stage 1: Odometry and pose estimation
         FAST-LIO2 or KISS-ICP (see fast-lio-fast-lio2.md, kiss-icp.md)
         -> per-scan 6-DoF poses at sensor frame rate

Stage 2: Dynamic object removal  <-- 4dNDF candidate role
         Classical option: ERASOR++ or FreeDOM (see erasor.md, freedom-dynamic-object-removal.md)
         Neural option:    4dNDF (offline batch; requires Stage 1 poses)
         -> static point cloud with dynamic objects filtered

Stage 3: Static map consolidation and merging
         LT-Mapper / Khronos (see lt-mapper-khronos-lifelong-mapping.md)
         MapCleaner (see mapcleaner.md)
         -> globally consistent static map

Stage 4: Semantic segmentation and annotation
         (see aggregated-map-semantic-segmentation.md)
         -> annotated HD map
```

4dNDF is an alternative to ERASOR++ or FreeDOM at Stage 2, with the trade-off of higher accuracy for dynamic removal (CVPR 2024 best-in-class results) at the cost of significantly higher compute and an offline-only constraint.

### Temporal Dimension and Static-but-Transient Objects

The time-dependent SDF partially addresses the "static-but-transient" category of objects discussed in [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md) (iter-19). Objects such as parked vehicles, temporarily placed barriers, or ground-support equipment that is present in some survey passes but absent in others can in principle be identified by their temporal inconsistency across survey epochs — if the temporal sampling (survey frequency) is sufficient and the time dimension is indexed across epochs rather than within a single session. Whether this extends cleanly to multi-session multi-day survey data rather than single-session scan sequences is an open research question.

### Honest Assessment for Airside Use

**What 4dNDF offers at airside:** a principled neural-implicit framework for removing temporally inconsistent actors — aircraft, fuel trucks, baggage carts, ground vehicles — from aggregated LiDAR maps of aprons, taxiways, and service roads. This directly mirrors the car-removal task in the KITTI benchmark. The continuous SDF representation also enables precise collision-geometry queries for taxiing AV path planning.

**Honest limitations:**

- Not validated on airside data. All published benchmarks are KITTI, Co-Fusion, and Newer College.
- Scale: a large international airport apron (several km²) will hit GPU memory limits for the sparse hash-grid without explicit submap decomposition.
- External poses required: the airside pipeline still needs a robust LiDAR odometry front-end or GNSS+INS; 4dNDF sits on top of that front-end and its accuracy ceiling is set by it.
- GSE temporal separation is an untested edge case: GSE sitting in the same position for extended periods before moving is harder than a car driving through a KITTI sequence at video frame rate.
- Classical alternatives are mature: FAST-LIO2 + VDB-Fusion for TSDF, combined with ERASOR/ERASOR2 for dynamic removal, is a proven production-grade pipeline. 4dNDF does not yet demonstrate comparable deployment robustness.

**Verdict:** 4dNDF is the most technically elegant published approach for building a clean static LiDAR map from sequences containing dynamic actors, with CVPR 2024 best-in-class dynamic-removal accuracy. Its appropriate role is as a **research candidate** for the map-cleaning stage, to be evaluated alongside ERASOR++ and FreeDOM, not as a drop-in SLAM replacement. It should not be adopted before offline validation on target-domain data with reliable input poses.

---

## Implementation Notes

- **Reproduce the sanity test first.** The repository documents a sanity test that trains on 20 KITTI sequence 00 frames and outputs a static mesh and dynamic segmentation visualization. Run this before any custom data evaluation.
- **Store provenance.** Record the exact config file, git commit hash, input pose source, and training logs alongside any generated maps.
- **Input pose quality is the dominant accuracy driver.** Establish a reliable external odometry pipeline (KISS-ICP or FAST-LIO2) and validate its trajectory before running 4dNDF. Residual pose error in a closed campus loop is much smaller than in an open airport apron without loop closure.
- **Compare against classical baselines using identical input poses.** Run ERASOR, Removert, FreeDOM, and MapCleaner with the same input scans and poses as 4dNDF to isolate the contribution of the neural temporal SDF from the effect of pose quality.
- **Keep raw scans and dynamic segmentation outputs.** Do not archive only the final static mesh; retain the per-point dynamic labels for manual review and reprocessing.
- **Treat output as a QA candidate, not a production map.** Until localization testing on scan-matching benchmarks confirms that the 4dNDF-cleaned map improves or at least preserves localization accuracy relative to ERASOR-cleaned maps, treat 4dNDF output as an additional candidate layer.
- **GPU memory budget.** Monitor hash-grid memory allocation during training on new sequences. The paper notes this is the limiting factor for large-scale scenes; consider route segmentation into submaps if memory pressure is observed.
- **No loop closure in 4dNDF.** If the external odometry source has significant drift (e.g., long unlooped survey routes), consider running a separate loop-closure and pose-graph optimization step on the external trajectory before feeding poses into 4dNDF.
- **Python and dependency versions.** PyTorch 1.13 / CUDA 11.6 / Open3D 0.17 / PyTorch3D are the tested versions. Newer PyTorch/CUDA combinations may require code adjustments; pin versions in a conda environment file.

---

## Sources

| Resource | URL |
|---|---|
| 4dNDF arXiv | https://arxiv.org/abs/2405.03388 |
| 4dNDF arXiv DOI | https://doi.org/10.48550/arXiv.2405.03388 |
| 4dNDF CVPR 2024 record | https://openaccess.thecvf.com/content/CVPR2024/html/Zhong_3D_LiDAR_Mapping_in_Dynamic_Environments_using_a_4D_Implicit_CVPR_2024_paper.html |
| 4dNDF CVPR DOI | https://doi.org/10.1109/CVPR52733.2024.01460 |
| 4dNDF GitHub | https://github.com/PRBonn/4dNDF |
| PIN-SLAM arXiv | https://arxiv.org/abs/2401.09101 |
| PIN-SLAM GitHub | https://github.com/PRBonn/PIN_SLAM |
| PIN-SLAM TRO | https://dl.acm.org/doi/10.1109/TRO.2024.3422055 |
| SHINE-Mapping arXiv | https://arxiv.org/abs/2210.02299 |
| SHINE-Mapping GitHub | https://github.com/PRBonn/SHINE_mapping |
| NeRF-LOAM arXiv | https://arxiv.org/abs/2303.10709 |
| NeRF-LOAM ICCV 2023 | https://ieeexplore.ieee.org/document/10377635/ |
| DeepSDF arXiv | https://arxiv.org/abs/1901.05103 |
| DeepSDF CVPR 2019 | https://openaccess.thecvf.com/content_CVPR_2019/html/Park_DeepSDF_Learning_Continuous_Signed_Distance_Functions_for_Shape_Representation_CVPR_2019_paper.html |
| LiDAR4D arXiv (disambiguation) | https://arxiv.org/abs/2404.02742 |
| NDF-SLAM Measurement 2025 (disambiguation) | https://www.sciencedirect.com/science/article/abs/pii/S0263224125012631 |
