# KISS-ICP: Keep It Small and Simple ICP

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["slam", "mapping", "outdoor"]
  reason: "Strong LiDAR-only odometry baseline for evaluating registration stacks."
method-priority:end -->

Related localization docs: [SLAM algorithms](../overview/lidar-slam-algorithms.md), [production LiDAR map localization](../overview/production-lidar-map-localization.md), and [map construction pipeline](../maps/map-construction-pipeline.md).

Related method pages: [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) (IMU-tight alternative), [CT-ICP](./ct-icp.md), [LIO-SAM](./lio-sam.md), [LOAM](./loam.md), [LeGO-LOAM](./lego-loam.md), [SuMa](./suma.md), [KISS-Matcher](./kiss-matcher.md), [KISS-SLAM](./kiss-slam.md), [Scan Context Family](./scan-context-family.md), [Learned LiDAR Place Recognition](./learned-lidar-place-recognition.md).

Related overview pages: [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [Large-Scale 3D Segmentation — Tiling and Throughput](../../perception/overview/large-scale-3d-segmentation-tiling-and-throughput.md).

Related KB pages: [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md), [Rolling-Shutter LiDAR Deskew and Motion Distortion](../../../10-knowledge-base/geometry-3d/rolling-shutter-lidar-deskew-motion-distortion.md).

**Last updated:** 2026-05-23

---

## What It Is

KISS-ICP — "In Defense of Point-to-Point ICP: Simple, Accurate, and Robust Registration If Done the Right Way" — is a minimalist LiDAR-only odometry (LO) system from Ignacio Vizzo, Tiziano Guadagnino, Benedikt Mersch, Louis Wiesmann, Jens Behley, and Cyrill Stachniss (Photogrammetry & Robotics Lab, University of Bonn). Published in *IEEE Robotics and Automation Letters* (RA-L), vol. 8, no. 2, pp. 1029–1036, February 2023 (DOI: 10.1109/LRA.2023.3236571; arXiv: 2209.15397), presented at IROS 2023.

The paper's thesis is deliberately provocative: the LiDAR odometry literature of 2018–2022 moved consistently toward more complex systems — IMU integration, feature extraction, surfel maps, learned components, loop closure optimizers — not because that complexity was demonstrated to be necessary, but because each added component was compensating for fragile behavior in an earlier component. If you fix ICP correctly, the complexity is unwarranted.

KISS-ICP is **LO only**: no IMU, no wheel odometry, no learned features, no loop closure, no per-dataset tuning, no semantic priors. Seven parameters govern the entire system, none of which need to be changed between an automotive dataset, a drone dataset, a segway, or a handheld device. The paper's direct quote: *"By removing a majority of parts and focusing on the core elements, we obtain a surprisingly effective system that is simple to realize."*

The result outperforms SuMa++ (49 parameters, surfel representation), F-LOAM, LeGO-LOAM, and LOAM on KITTI; wins all four MulRan sequences over MULLS (107 parameters); runs at 38–51 Hz on a single CPU core; and spawned a family of follow-on systems — KISS-Matcher (ICRA 2025), KISS-SLAM (IROS 2025), and Kinematic-ICP (2024, deployed in production warehouse robots).

**Key identifiers:**
- arXiv: https://arxiv.org/abs/2209.15397
- DOI: https://doi.org/10.1109/LRA.2023.3236571
- Code: https://github.com/PRBonn/kiss-icp (MIT license)
- Paper PDF (IPB): https://www.ipb.uni-bonn.de/pdfs/vizzo2023ral.pdf

---

## Core Technical Idea

The authors identify four specific failure modes of vanilla point-to-point ICP (Besl & McKay, 1992) and argue that fixing those four failures — and only those — is sufficient to match or beat far more complex LIO systems on standard benchmarks:

1. **Scan distortion.** A spinning LiDAR accumulates each point at a different time instant within the ~100 ms sweep window. Without compensation, all points referenced to the sweep start carry motion distortion that corrupts correspondences. Most LIO systems fix this with IMU; KISS-ICP fixes it with a constant-velocity model from two prior poses.

2. **Fixed correspondence thresholds.** Every published LIO system as of 2022 hardcodes a correspondence distance `tau` or tunes it per dataset. Too tight → ICP fails during rapid motion. Too loose → spurious correspondences. KISS-ICP derives `tau` automatically each frame from the observed history of inter-frame displacements.

3. **Outlier sensitivity.** Without a robust kernel, a single bad correspondence dominates the ICP residual. Systems respond by adding feature extraction (LOAM's edge/plane pipeline) to pre-filter. KISS-ICP responds by applying a Geman-McClure kernel directly to raw point-to-point residuals.

4. **Normal estimation noise.** Point-to-plane ICP requires per-point surface normals. On rotating LiDARs with ring gaps, mixed pixels, and varying density, normals are unreliable. KISS-ICP drops normals entirely and uses point-to-point error.

The cumulative argument — the **bias-everywhere thesis** — is that complex LIO systems exist not because IMU or learning are inherently necessary but because those additions paper over broken ICP. Fix ICP first; most of the accuracy benefit follows with none of the engineering debt.

---

## Operator Mechanics

### Component 1: Per-Point Motion Compensation (Constant-Velocity Deskew)

A rotating LiDAR fires each beam at a different instant across the scan window. For a 10 Hz sensor this means ~100 ms between first and last point. A vehicle moving at 10 m/s travels 1 m during that window, introducing ~1 m of motion distortion into the raw scan. See also: [Rolling-Shutter LiDAR Deskew and Motion Distortion](../../../10-knowledge-base/geometry-3d/rolling-shutter-lidar-deskew-motion-distortion.md).

KISS-ICP estimates the inter-frame velocity from the two most recent pose estimates `T_{t-2}` and `T_{t-1}` (each `T ∈ SE(3)`, `T = [R | t]`) and uses it to predict the current frame's pose:

```
Predicted pose for frame t (constant-velocity extrapolation):

T_hat_t = T_{t-1} · ΔT_{t-1}
        where ΔT_{t-1} = T_{t-2}^{-1} · T_{t-1}   [last incremental transform repeated]
```

This is the body-frame constant-velocity model: the current incremental transform equals the previous incremental transform. Equivalently written as `T_hat_t = T_{t-1} · (T_{t-2}^{-1} · T_{t-1})`.

Per-point deskew for point `p_i` with normalised timestamp `s_i ∈ [0, 1]` within the sweep:

```
p_i* = Exp(s_i · ω_t) · p_i + s_i · v_t
```

where `Exp(·)` is the SO(3) Lie group exponential, `ω_t` is the estimated angular velocity, and `v_t` is the estimated translational velocity in the body frame. Points at `s_i = 0` (sweep start) receive no correction; points at `s_i = 1` (sweep end) receive the full frame-to-frame motion correction.

**Why not IMU?** The constant-velocity assumption holds as long as platform acceleration over a single sweep (~100 ms) is small. For ground vehicles and most aerial platforms this is valid. The authors demonstrate results comparable to IMU-integrated deskewing, without requiring IMU calibration, bias estimation, or time synchronisation.

---

### Component 2: Voxel-Based Local Map

The local map is a spatial hash (`VoxelHashMap`) of fixed voxel size `v`. Each voxel stores at most `N_max = 20` points. Incoming points that fall into an already-full voxel are discarded (random sampling, not centroid averaging), **preserving original point coordinates** and avoiding the quantisation bias that centroid averaging introduces.

Two resolution scales are used for two distinct purposes:

```
Map-update voxel size: α·v   where α = 0.5   (finer — for inserting the new scan into the map)
ICP registration voxel size: β·v  where β = 1.5  (coarser — reduces registration compute)
```

The voxel size is set as a fraction of the sensor's maximum range:

```
v = 0.01 · r_max
```

For a 100 m range sensor this gives v ≈ 1 m. The sliding window removes voxels outside a fixed neighbourhood of the current pose, bounding map memory regardless of trajectory length.

**Why one point per voxel (approximately)?** Centroid averaging changes point positions, introducing an effective measurement error proportional to voxel size. Storing raw points capped at `N_max` avoids this bias. KISS-ICP's total map parameter count is four (`N_max`, `v`, `α`, `β`) — compared to 49 in SuMa and 107 in MULLS.

---

### Component 3: Adaptive Correspondence Threshold

Hardcoded correspondence thresholds are a pervasive failure mode: every dataset has a different motion profile and a different sensor range. KISS-ICP derives the threshold automatically each frame from the distribution of observed inter-frame displacements.

**Displacement bound** for a single frame-to-frame transform `ΔT = (ΔR, Δt)`:

```
δ(ΔT) = δ_rot(ΔR) + δ_trans(Δt)

δ_rot(ΔR)   = 2 · r_max · sin(θ/2)    where θ = arccos( (tr(ΔR) − 1) / 2 )
δ_trans(Δt) = ‖Δt‖_2
```

`r_max` bounds the maximum point radius; `δ_rot` is the maximum tangential displacement any point could experience due to rotation alone.

**Adaptive sigma** over the window `M_t` of recent displacement measurements:

```
σ_t = sqrt( (1 / |M_t|) · Σ_{i ∈ M_t} δ(ΔT_i)^2 )
```

**Correspondence threshold and robust kernel scale parameter:**

```
τ_t = 3 · σ_t          [three-sigma threshold; all pairs beyond this distance are rejected]
κ_t = σ_t / 3          [scale for Geman-McClure kernel]
```

Both `τ_t` and `κ_t` are data-driven and updated each frame. High-speed motion → larger threshold and looser kernel scale; slow motion → tighter threshold. No per-dataset manual tuning is required.

---

### Component 4: Robust Point-to-Point ICP with Geman-McClure Kernel

Point-to-plane ICP requires surface normals — unreliable on rotating LiDARs with ring gaps and varying density. KISS-ICP drops normals entirely and uses raw point-to-point error.

**Geman-McClure robust kernel:**

```
ρ(e) = (e^2/2) / (κ_t + e^2)
```

This corresponds to per-correspondence weights:

```
w_i = κ_t / (κ_t + r_i^2)^2
```

where `r_i = ‖T_hat_t · s_i − q_i‖_2` is the residual for correspondence pair `(s_i, q_i)` and `κ_t = σ_t / 3` (updated per frame). Large residuals are downweighted smoothly; there is no hard rejection threshold — the kernel handles outliers continuously. The paper uses Geman-McClure specifically (not Cauchy, which is sometimes mistakenly cited in secondary literature).

**Registration objective:**

```
ΔT_est = argmin_{T ∈ SE(3)}  Σ_{(s,q) ∈ C(τ_t)}  ρ( ‖T · s − q‖_2 )
```

Solved via iteratively reweighted least squares (IRLS). The SE(3) update is applied multiplicatively: `T_hat_t ← ΔT_ICP · T_hat_t`. Termination when per-iteration correction `‖ΔT − I‖ < γ = 10^{-4}` rather than a fixed iteration count — this adapts naturally to difficult frames.

See also: [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md).

---

## Inputs and Outputs

| Item | Description |
|---|---|
| **Input** | Stream of 3D LiDAR scans (`sensor_msgs/PointCloud2` or equivalent); per-point relative timestamps for deskewing (optional but recommended) |
| **Output: T_t** | SE(3) odometry pose at each scan; the full trajectory is the accumulated sequence of `T_t` |
| **Output: local map** | Updated `VoxelHashMap` for the next frame's registration |
| **Derived output** | Aggregated point cloud: transform each raw scan by its `T_t` into a common frame → dense survey cloud for segmentation or map building |

No IMU, no wheel odometry, no GNSS, no edge/plane features, no semantic labels, no learned components, no loop closure.

---

## Architecture

```
Input scan (raw PointCloud2, per-point timestamps)
  │
  ▼
[1] Deskew: per-point pose interpolation from constant-velocity T_hat_t
            (Lie group interpolation using estimated ω_t, v_t)
  │
  ▼
[2] Dual voxel subsample:
      α·v  for map update   (finer, preserves detail for insertion)
      β·v  for registration (coarser, reduces ICP cost)
  │
  ▼
[3] Compute adaptive τ_t and κ_t from window M_t of past displacement deltas
  │
  ▼
[4] NN lookup in VoxelHashMap — build correspondence set C(τ_t)
    reject pairs with distance > τ_t
  │
  ▼
[5] Robust IRLS: minimise Geman-McClure loss → ΔT_ICP
    (iterate until ‖ΔT_ICP − I‖ < 10^{-4})
  │
  ▼
[6] Compose: T_t = ΔT_ICP · T_hat_t
  │
  ▼
[7] Update VoxelHashMap with deskewed scan (at α·v resolution)
    evict voxels outside sliding window
  │
  ▼
Output: T_t (odometry pose), updated local map
```

The pipeline is **purely sequential** — one pass per scan. No IMU preintegration, no semantic segmentation, no learned features, no keyframe selection, no loop closure, no pose graph. This is also why the method is fast and auditable.

---

## Why It Works: The Bias-Everywhere Argument

The central claim is not that KISS-ICP is uniquely clever but that most prior LO systems were **worse than they needed to be** because their ICP implementation was broken in four specific ways, and each added component was a workaround rather than a fix.

The causal chain:

1. Undeskewed scans create apparent motion even when the platform is stationary. Corrupted correspondences degrade every downstream step — so systems add IMU to compensate. KISS-ICP deskews instead.

2. Fixed correspondence thresholds are necessarily dataset-specific: set too tight for fast-motion frames, too loose for slow-motion frames. Outlier correspondences bleed into the pose estimate — so systems add feature extraction (LOAM edges/planes) to pre-filter correspondences. KISS-ICP adapts `τ_t` instead.

3. Without a robust kernel, one bad correspondence can dominate the ICP residual — so systems add more feature extraction or downweight by normal alignment quality. KISS-ICP applies Geman-McClure instead.

4. Normal estimation from a sparse rotating LiDAR is unreliable — so systems switch to surfel representations (SuMa) or range-image warping (IMLS-SLAM) to recover stable normals. KISS-ICP drops normals entirely.

The cumulative result: a system with exactly four engineering decisions (deskewing, adaptive threshold, robust kernel, voxel map) that beats systems with 49 and 107 parameters on the same benchmarks. The engineering complexity of LIO/LO literature was driven by **accumulated compensation debt**, not by demonstrated necessity.

---

## Key Parameters

| Parameter | Value | Description |
|---|---|---|
| `v` (voxel size) | `0.01 · r_max` | Map voxel side length; scales with sensor range |
| `N_max` | 20 | Maximum points per voxel |
| `α` | 0.5 | Map-update voxel size multiplier (finer) |
| `β` | 1.5 | Registration voxel size multiplier (coarser) |
| `τ_t` | `3 · σ_t` | Adaptive correspondence rejection distance |
| `κ_t` | `σ_t / 3` | Geman-McClure kernel scale parameter |
| `γ` | 10^{-4} | IRLS convergence criterion |

Total parameter count: seven. The authors explicitly state that users should not need to change any of these across datasets or sensor types. This is the primary operational advantage over all prior LO systems.

---

## Computational Performance

| Configuration | Runtime |
|---|---|
| Without deskewing | ~51 Hz (desktop CPU, single core, KITTI HDL-64) |
| With deskewing | ~38 Hz (same hardware) |

Both exceed the 10–20 Hz sensor frame rate of typical spinning LiDARs. Real-time operation with significant margin on a single CPU core — no GPU required.

**Design-performance connection.** The minimal component set is not just philosophically appealing; it is the mechanism by which real-time performance is achieved. Each eliminated component is a latency reduction. MULLS (107 parameters, full feature extraction pipeline) requires substantially more compute per scan.

**Embedded / Jetson relevance.** The Python package (`pip install kiss-icp`) and the C++ core are designed for portability. No published benchmarks for KISS-ICP on NVIDIA Jetson Orin specifically have been located ⚠️, but 38–51 Hz on a desktop CPU implies the method is well within Orin's compute budget (which targets a ~100 ms control cycle at ~100 TOPS for the full AV stack) with significant headroom for other tasks.

**Kinematic-ICP production data point.** The Kinematic-ICP derivative (see KISS Family section) runs at **100 Hz on a single CPU core** in Dexory's warehouse robot fleet across warehouses of 0.35–9.45 ha — the strongest available evidence that the KISS-ICP core is deeply inside embedded compute budgets.

---

## Training Recipe

KISS-ICP has no learned components and no training step. There is nothing to train, no pre-trained weights, no GPU for training, and no dataset-specific fine-tuning.

All seven parameters are set from the sensor's specified maximum range and the default values in Table I of the paper. The adaptive threshold `τ_t` self-initialises from the first few frame-to-frame displacement observations. After approximately 5–10 frames, the adaptive mechanism is fully operational.

**Operational deployment:** clone the repository, install via pip, point at a ROS2 `PointCloud2` topic, launch. No configuration file changes required for a new sensor as long as the `max_range` parameter is set to match the sensor's specified range.

---

## Benchmark Results

### KITTI Odometry (Relative Translational Error, %)

Table II from the paper (mean relative translational error, KITTI metric):

| Method | Seq. 00–10 (%) | Seq. 11–21 (%) | IMU? |
|---|---|---|---|
| **KISS-ICP** | **0.50** | **0.61** | No |
| CT-ICP | 0.53 | 0.59 | No |
| SuMa++ | 0.80 | 1.39 | No |
| LOAM | ~0.72 | ~1.10 ⚠️ | No |
| F-LOAM | ~1.0 | ~1.2 ⚠️ | No |
| LeGO-LOAM | ~1.4 | ~1.8 ⚠️ | No |

KISS-ICP ranks 2nd among open-source systems on KITTI (behind CT-ICP by ~0.03%) and 9th overall including closed-source submissions. It outperforms SuMa++ (surfel representation, 49 parameters) and far outperforms LeGO-LOAM.

FAST-LIO2 and LIO-SAM are LiDAR-inertial systems and use IMU; direct KITTI comparison is not straightforward because the standard KITTI setup does not use IMU-aided ground truth registration. FAST-LIO2 typically achieves 0.3–0.5% on sequences where clean IMU data is available — nominally better, but with additional sensor requirements.

⚠️ Values marked ⚠️ are approximate readings from secondary literature; verify against the full PDF Table II.

### MulRan Dataset (Ouster OS1-64, 10 Hz)

Table III — relative translational error, four sequences:

| Sequence | MULLS (%) | SuMa (%) | F-LOAM (%) | **KISS-ICP (%)** |
|---|---|---|---|---|
| KAIST | 2.94 | 5.59 | 3.43 | **2.28** |
| DCC | 2.96 | 5.20 | 3.83 | **2.34** |
| Riverside | 5.42 | 13.86 | 5.47 | **2.89** |
| Sejong | 5.93 | — ⚠️ | 7.87 | **4.69** |

KISS-ICP **wins all four MulRan sequences** despite using no map-level optimisation or IMU. MulRan is challenging because it uses a spinning LiDAR on a vehicle with significant heading changes — exactly the scenario the constant-velocity deskew was designed for. The Riverside result (2.89% vs. MULLS 5.42%) is the most striking, demonstrating robustness to varied urban geometry.

### Newer College Dataset (Handheld Ouster)

Table IV:

| Sequence | CT-ICP (%) | **KISS-ICP (%)** |
|---|---|---|
| Short (Cloister) | 0.48 | 0.51 |
| Long | 0.58 | 0.96 |

The ~0.5% gap on the Short sequence is noise-floor; the larger gap on the Long sequence is attributable to loop closure: CT-ICP includes optional loop closure, KISS-ICP does not. Without loop closure, drift accumulates over kilometres. This is expected behaviour, not a failure of the core registration.

### NCLT Segway Dataset

KISS-ICP achieves ~1.27% relative translational error versus CT-ICP's ~1.17% on a non-automotive segway platform — validating the sensor- and platform-agnostic claim. The authors note the NCLT dataset has known ground-truth inconsistencies (missing frames, misaligned poses) and **explicitly discourage using NCLT as a primary odometry benchmark**.

### Known Failure: Long_Corridor (Geometric Degeneracy)

The GenZ-ICP paper (arXiv:2411.06766) benchmarks KISS-ICP on a `Long_Corridor` sequence: KISS-ICP achieves **6.83 m mean APE with peaks at 19.05 m**, compared to GenZ-ICP's 1.69 m. GenZ-ICP adaptively combines point-to-point and point-to-plane registration to exploit the along-corridor normal constraint that KISS-ICP's point-to-point metric cannot leverage. This is the canonical failure mode quantification.

### Known Failure: Stairs Sequence (Aggressive Dynamics)

The MAD-ICP paper (arXiv:2405.05828) benchmarks KISS-ICP on the Newer College `stairs` sequence: KISS-ICP fails catastrophically (**17903% relative translational error**) while MAD-ICP achieves 0.91%. The failure is attributed to the combination of aggressive non-planar motion and the fixed-voxel representation losing geometric support during staircase traversal.

---

## The KISS Family and Lineage

### Genealogy

```
Besl & McKay (1992) — point-to-point ICP
    │
Zhang & Singh (2014) — LOAM: edge + plane features
    │
    ├── Shan & Englot (2018) — LeGO-LOAM: ground-optimised LOAM
    │
    ├── Behley & Stachniss (2018) — SuMa → SuMa++ (semantic surfels, 2019)
    │
    ├── Xu et al. (2021/2022) — FAST-LIO / FAST-LIO2: tightly-coupled LIO
    │                            ikd-Tree, IMU EKF preintegration
    │
    ├── Shan et al. (2020) — LIO-SAM: factor graph LIO + IMU preintegration
    │
    ├── Dellenbach et al. (2022) — CT-ICP: continuous-time ICP, elastic SLAM
    │
    └── Vizzo et al. (2023) — KISS-ICP: strip everything back to corrected ICP
            │
            ├── Kinematic-ICP (2024) — unicycle kinematic constraints; deployed by Dexory
            │
            ├── MAD-ICP (2024) — PCA-kd-tree map; beats KISS-ICP in staircase/sparse
            │
            ├── GenZ-ICP (2024) — adaptive P2P + P2Plane; addresses corridor degeneracy
            │
            ├── KISS-Matcher (ICRA 2025) — global registration complement
            │
            └── KISS-SLAM (IROS 2025) — adds loop closure + pose graph on KISS-ICP base
```

### KISS-Matcher (ICRA 2025)

**Citation:** Lim, H., Kim, D., Shin, G., Shi, J., Vizzo, I., Myung, H., Park, J., Carlone, L. "KISS-Matcher: Fast and Robust Point Cloud Registration Revisited." ICRA 2025. arXiv: 2409.15615.
**Code:** https://github.com/MIT-SPARK/KISS-Matcher

KISS-Matcher provides **global (place-recognition-level) point cloud registration** without an initial pose estimate — the loop-closure pose estimation that KISS-ICP cannot supply. Four-stage pipeline:

1. *Geometric suppression* — filters repetitive structural elements (ground, ceiling, walls) that generate outlier correspondences.
2. *Faster-PFH* — accelerated FPFH with single radius search and linearity filtering; ~4.5× faster than standard FPFH in single-threaded mode.
3. *k-Core graph pruning* — replaces TEASER++'s exponential-complexity max-clique solver with linear-time k-core decomposition; handles >1,000 correspondences where TEASER++ degrades.
4. *Graduated Non-Convexity (GNC) solver* — robust pose estimation that validates registration via final inlier cardinality.

Parameters are voxel-relative (`r = k·v`), inheriting KISS-ICP's tuning-free philosophy. Benchmark: 100% success rate on KITTI 10 m test; ~14 Hz CPU speed; >20× faster than TEASER++ at 200K+ points. After G-ICP refinement: RTE 1.10 cm, RRE 0.02°.

See also: [KISS-Matcher](./kiss-matcher.md).

### KISS-SLAM (IROS 2025)

**Citation:** Guadagnino, T., Mersch, B., Gupta, S., Vizzo, I., Grisetti, G., Stachniss, C. "KISS-SLAM: A Simple, Robust, and Accurate 3D LiDAR SLAM System With Enhanced Generalization Capabilities." IROS 2025. arXiv: 2503.12660.
**Code:** https://github.com/PRBonn/kiss-slam

Full SLAM by adding loop closure and pose graph optimisation on top of KISS-ICP. The authors acknowledge: *"Although KISS-ICP performs well regarding pose error while tracking, the lack of a loop closing and pose graph optimisation module limits its performance."*

Four modules:
1. *LiDAR odometry* — KISS-ICP as the front-end.
2. *Local mapping* — keypose-anchored local maps; new map created when travelled distance exceeds threshold `β`.
3. *Loop closure detection* — ORB descriptors on bird's-eye view density projections (ground aligned); RANSAC geometric validation; Szymkiewicz-Simpson overlap coefficient `Γ > 0.40` acceptance threshold. Note: this is a classical geometric detector, not a learned descriptor — for a learned alternative see [Learned LiDAR Place Recognition](./learned-lidar-place-recognition.md) or [Scan Context Family](./scan-context-family.md).
4. *Fine-grained pose graph optimisation* — fixes keypose nodes, redistributes drift among scan-level poses within each local map chunk.

Performance: NCLT 3.00 m ATE / 0.61% KITTI metric; real-time across MulRan, HeLiPR, Apollo, Newer College, NCLT with zero parameter changes across HeLiPR sensor transitions (competing systems require 7–16 changes); handles loops >9 km.

See also: [KISS-SLAM](./kiss-slam.md).

### Kinematic-ICP (2024, Deployed)

**Citation:** arXiv:2410.10277
**Code:** https://github.com/PRBonn/kinematic-icp

Extends KISS-ICP with unicycle kinematic constraints for differential-drive wheeled robots on planar surfaces. Wheel odometry provides the initial pose guess; LiDAR refines via the standard KISS-ICP registration. An adaptive regularisation mechanism weights sensor contributions dynamically.

**Production deployment:** Dexory warehouse robot fleet, worldwide, on 32-beam LiDAR platforms, across warehouses of 0.35–9.45 ha. Runtime: **100 Hz on a single CPU core**. This is the clearest available evidence that the KISS-ICP core registration engine is production-viable in an industrial robotics context.

---

## Strengths

- **Zero parameter tuning per dataset or sensor.** Seven parameters, none requiring manual changes across automotive, aerial, handheld, and segway platforms. This is the primary operational advantage over LOAM, SuMa, and MULLS.
- **No IMU, no additional sensors.** Works on any 3D spinning or solid-state LiDAR. Eliminates IMU calibration, extrinsics estimation, bias modelling, and time synchronisation.
- **Platform and sensor agnostic.** Car, drone, segway, handheld — same parameters, validated empirically. Unusual in LO research and a major advantage for mixed-sensor fleets.
- **Fast, CPU-only, real-time.** 38–51 Hz on commodity hardware without GPU. Kinematic-ICP derivative demonstrates 100 Hz on embedded hardware.
- **Compact, auditable implementation.** The core C++ codebase is small enough to read in an afternoon. ROS2 wrapper, Python bindings, and Open3D visualiser are provided.
- **Standard ablation baseline.** The minimal design makes KISS-ICP the canonical reference point for ablation studies. Any paper testing a new LO component measures gain over KISS-ICP — the cleanest possible baseline.
- **Robust kernel handles diverse scans.** MulRan (Ouster OS1-64) and Newer College (handheld, irregular motion) confirm cross-sensor and cross-motion-profile validity.
- **Spawned a productive research family.** KISS-Matcher, KISS-SLAM, and Kinematic-ICP all build directly on the KISS-ICP core, demonstrating its modularity.

---

## Failure Modes

### Geometric Degeneracy

**Long corridors and tunnels.** Point-to-point ICP requires correspondences in all three translation directions. In a featureless corridor or tunnel, there is no geometric constraint along the corridor axis. KISS-ICP has no explicit degeneracy detection or axis-specific down-weighting.

Quantified evidence: `Long_Corridor` sequence (GenZ-ICP paper, arXiv:2411.06766) — KISS-ICP achieves **6.83 m mean APE with peaks at 19.05 m**; GenZ-ICP achieves 1.69 m (4× improvement by adaptively combining point-to-point and point-to-plane to leverage along-corridor normals).

Airside relevance: taxiways and runways have significant lateral geometry (aircraft, terminal walls, ground markings) but runway centrelines can be geometrically degenerate in one axis on long straight sections. KISS-ICP should not be the sole odometry source for extended straight-line traversals of 200+ m without supplementary constraints (GPS/RTK, loop closure, or IMU).

### Constant-Velocity Assumption Violations

The deskewing model assumes constant linear and angular velocity over each ~100 ms sweep. Failure conditions:

- High-g acceleration events (emergency braking, drone lift-off).
- Fast heading changes (spin-in-place manoeuvres common in warehouse differential-drive robots and some airside GSE).
- Prolonged high-jerk trajectories.

In these cases the predicted `T_hat_t` will be a poor initialisation, potentially landing ICP in the wrong basin of attraction. Unlike FAST-LIO2, there is no high-rate IMU measurement to correct the initialisation before the ICP step. See [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) for the IMU-tight alternative.

### No Loop Closure

KISS-ICP provides odometry only. Drift accumulates without bound over long traversals. At the KITTI mean error of 0.5%/100 m, a 1 km loop accumulates ~5 m position error at the return point without loop closure. This is acceptable for a map-building front-end (where a back-end corrects poses) but not for long-range single-session localisation. For full SLAM, use KISS-SLAM or connect KISS-ICP to a factor graph back-end (GTSAM, g2o) with a loop-closure module.

### Staircase and Aggressive Vertical Dynamics

The MAD-ICP paper (arXiv:2405.05828) notes that KISS-ICP's multiple voxelisation layers risk "potential loss of support during scan registration" in challenging vertical or staircase sequences. Newer College `stairs` result: KISS-ICP **17903% error** (catastrophic) vs. MAD-ICP 0.91%.

The failure mechanism: aggressive 3D motion on stairs causes the predicted `T_hat_t` to be far from the true pose; the voxel map may not have sufficient geometric support near the extrapolated location; ICP diverges.

### Sparse or Low-Beam LiDARs

Point-to-point ICP is sensitive to sparsity. With 16-beam LiDARs or at long range where points thin out, the adaptive threshold expands and correspondence quality degrades. The system is best validated with 32- to 128-beam sensors. The KISS-ICP GitHub issue tracker documents sparse-data struggles.

### No Dynamic-Object Handling

KISS-ICP does not distinguish dynamic from static points. In scenes where aircraft, buses, tugs, or crowds dominate the scan, ICP may align to moving objects rather than the static background, introducing corruption into both the pose estimate and the local map. Upstream dynamic-object filtering (or downstream map cleaning — see [ERASOR](./erasor.md)) is required for robust map building in high-traffic environments.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV — structured urban | Strong | Designed and benchmarked for automotive outdoor use; buildings and intersections provide rich 3D geometry. |
| Road AV — highway | Good | Open road reduces lateral constraints; constant-velocity model holds well at highway speeds. |
| Airside — low-speed GSE and ground vehicles | Good | Low speed helps constant-velocity deskewing; multi-LiDAR rigs provide overlap; validated on similar platforms in KITTI/MulRan. |
| Airside — open apron, long straight traversal | Conditional | Risk of along-axis drift over 200+ m; supplement with GPS or loop closure. |
| Airside — terminal / jetway zone | Good | Rich vertical geometry (terminal facades, jetways, signage) reduces degeneracy risk. |
| Warehouse / indoor flat | Good | Wall, shelf, and column geometry well-suited to point-to-point ICP; Kinematic-ICP derivative confirms. |
| Warehouse / stairs / multi-level | Weak | Catastrophic failure documented on Newer College stairs; use MAD-ICP for vertical environments. |
| Drone / aerial survey | Conditional | Constant-velocity model works at steady flight; aggressive manoeuvres (hover transitions, fast yaw) will degrade deskewing. |
| Handheld survey / wand mapping | Good | Newer College handheld results are competitive with CT-ICP on short sequences. |
| Mining / construction | Conditional | Irregular terrain reduces ground-plane reliability; large open areas create degeneracy risk. |
| Port / logistics yard | Conditional | Mixed structured/open areas; crane infrastructure helps registration where visible. |

---

## Aggregated-Map Suitability

In a map-construction pipeline, KISS-ICP's canonical role is the **odometry front-end**: it produces per-scan `T_t` poses that are then used to transform each raw scan into a common reference frame, producing the aggregated point cloud that feeds semantic segmentation. See [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) §1.1 and [Large-Scale 3D Segmentation — Tiling and Throughput](../../perception/overview/large-scale-3d-segmentation-tiling-and-throughput.md).

**Typical pipeline position:**

```
Raw LiDAR scans
  → KISS-ICP (pose estimation, ~40 Hz, CPU-only)
  → Aggregated point cloud (each scan transformed by T_t into map frame)
  → [optional] Dynamic object removal (ERASOR, FreeDOM)
  → [optional] Pose-graph back-end (KISS-SLAM, g2o, GTSAM) for loop closure correction
  → Voxelised dense map
  → Semantic segmentation (Rangeformer, SpherFormer, Cylinder3D, etc.)
```

**Honest assessment of production use.** For production-grade survey mapping over large areas (>500 m traversal length), **FAST-LIO2-class IMU-tight methods typically give better global consistency** because the IMU constrains the deskewing model over aggressive motion and the tight coupling reduces accumulated drift per unit distance. KISS-ICP is the appropriate choice when:

- No IMU is available or IMU calibration is unreliable.
- The survey platform is retrofitted (no IMU mount or time synchronisation).
- A clean, no-dependency baseline is needed for ablation or comparison.
- The traversal is short (<300–500 m) or the environment has abundant loop closure opportunities.
- A second-pass back-end (KISS-SLAM or factor graph) will correct residual drift.

For short-range, single-session survey scans — hangar mapping, gate-area scanning, apron segment surveys under ~300 m — KISS-ICP standalone is a defensible and practical choice with no additional sensors.

See also: [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) for the IMU-tight alternative in production survey contexts.

---

## Library Ecosystem

**GitHub:** https://github.com/PRBonn/kiss-icp
Repository tagline: "A LiDAR odometry pipeline that just works."
License: MIT.

**Languages:** C++ core (CMake, Eigen, TBB, pybind11); Python bindings generated via pybind11.

**Python install:**
```
pip install kiss-icp
```
No ROS environment required for offline processing. Full offline pipeline can be run from a Python script against a bag file or a directory of PCD files.

**ROS2 wrapper:** under `kiss-icp/ros/`; supports ROS Humble, Iron, Jazzy. Subscribe to a standard `sensor_msgs/PointCloud2` topic. ROS1 support deprecated in newer releases; older versions remain available for legacy systems.

**C++ component headers:**
- `kiss-icp/cpp/kiss_icp/VoxelHashMap.hpp` — spatial hash map with sliding window
- `kiss-icp/cpp/kiss_icp/Threshold.hpp` — adaptive τ_t / κ_t computation
- `kiss-icp/cpp/kiss_icp/Registration.hpp` — IRLS Geman-McClure registration

These are exposed individually, which is why Kinematic-ICP, MAD-ICP, and GenZ-ICP can cleanly inherit and replace individual components.

**Open3D visualisation:** optional Python dependency for live odometry inspection during development.

**Rerun integration:** https://rerun.io/examples/robotics/kiss-icp — stream live poses and point cloud into Rerun for debugging and recording.

**PyPI:** https://pypi.org/project/kiss-icp/

**Ouster SDK integration:** KISS-ICP is the documented localisation example in the Ouster SDK (https://zread.ai/ouster-lidar/ouster-sdk/25-localization-with-kiss-icp).

---

## Implementation Notes

- **Set `max_range` to match the sensor.** The voxel size `v = 0.01 · r_max` and the correspondence threshold `τ_t` both scale from `r_max`. An incorrect `max_range` will produce under-sized or over-sized voxels and a miscalibrated threshold. Use the sensor's specified range, not the 95th-percentile observed range.

- **Enable per-point timestamps for deskewing.** Most ROS2 LiDAR drivers publish relative timestamps in the `PointCloud2` fields (as `time` or `t`). Confirm the field name matches what KISS-ICP expects. Without timestamps, the deskewing step is disabled and performance degrades on fast-moving platforms (~38 Hz → ~51 Hz but with more motion blur).

- **Long straight traversals need supplementary constraints.** On airside runways or warehouse aisles longer than 200–300 m, run KISS-ICP inside KISS-SLAM or connect to a GTSAM factor graph with GPS/RTK priors or scan-context loop closure. Standalone KISS-ICP on a 1 km straight traversal will accumulate ~5 m of position error.

- **Monitor correspondence count and ICP residual per frame.** These are the primary health indicators. A sudden drop in correspondence count indicates scan overlap failure (occlusion, aggressive turn, sensor dropout). A rising residual indicates convergence to a poor local minimum. Gate odometry quality on these metrics before inserting poses into a map or factor graph.

- **For multi-LiDAR rigs:** merge scans upstream before feeding to KISS-ICP, ensuring all beams share a common timestamp reference and are transformed into the vehicle frame. KISS-ICP does not handle multi-sensor fusion internally.

- **Static map building: add dynamic removal downstream.** KISS-ICP inserts all points — including dynamic objects — into the aggregated cloud. Run ERASOR, FreeDOM, or an equivalent dynamic-map cleaner on the aggregated cloud before segmentation. See [LiDAR Map Cleaning — Dynamic Removal](./lidar-map-cleaning-dynamic-removal.md).

- **For covariance estimation for factor-graph fusion:** KISS-ICP does not output per-pose covariance by default. Approximate covariance from the Hessian of the IRLS objective or from ICP residual statistics. Check community extensions (KISS-ICP-LC forks) for Hessian-based covariance output.

- **ROS1 legacy systems:** use a pinned older release of kiss-icp that retains the ROS1 wrapper. The current main branch has deprecated ROS1 support. Check the GitHub release history for the last stable ROS1 version.

- **Python offline processing pattern:**
  ```python
  from kiss_icp.pipeline import OdometryPipeline
  pipeline = OdometryPipeline(sensor_hz=10, max_range=100.0)
  for points, timestamps in scan_loader:
      pose = pipeline.register_frame(points, timestamps)
  ```

---

## Sources

- Vizzo, I., Guadagnino, T., Mersch, B., Wiesmann, L., Behley, J., Stachniss, C. "KISS-ICP: In Defense of Point-to-Point ICP — Simple, Accurate, and Robust Registration If Done the Right Way." IEEE RA-L vol. 8 no. 2, 2023. https://arxiv.org/abs/2209.15397
- KISS-ICP paper DOI (IEEE RA-L): https://doi.org/10.1109/LRA.2023.3236571
- KISS-ICP paper PDF (IPB): https://www.ipb.uni-bonn.de/pdfs/vizzo2023ral.pdf
- PRBonn/kiss-icp repository (MIT): https://github.com/PRBonn/kiss-icp
- PyPI package: https://pypi.org/project/kiss-icp/
- Stachniss Lab Medium post: https://medium.com/stachnisslab/kiss-icp-in-defense-of-point-to-point-icp-accurate-and-robust-3d-point-cloud-registration-bd8a21cae3d8
- KISS-Matcher (ICRA 2025): https://arxiv.org/html/2409.15615v1 · GitHub: https://github.com/MIT-SPARK/KISS-Matcher
- KISS-SLAM (IROS 2025): https://arxiv.org/abs/2503.12660 · GitHub: https://github.com/PRBonn/kiss-slam · PyPI: https://pypi.org/project/kiss-slam/
- Kinematic-ICP (arXiv 2024): https://arxiv.org/html/2410.10277v1 · GitHub: https://github.com/PRBonn/kinematic-icp
- MAD-ICP (comparative, staircase failure): https://arxiv.org/html/2405.05828v1
- GenZ-ICP (corridor degeneracy quantification): https://arxiv.org/html/2411.06766v1
- LiPO (ICP comparison framework): https://arxiv.org/html/2410.08097v1
- Rerun KISS-ICP example: https://rerun.io/examples/robotics/kiss-icp
- Ouster SDK KISS-ICP localisation: https://zread.ai/ouster-lidar/ouster-sdk/25-localization-with-kiss-icp
- CT-ICP (continuous-time comparison): https://arxiv.org/abs/2109.12979 · see also: `./ct-icp.md`
- FAST-LIO2 (IMU-tight alternative): https://arxiv.org/abs/2107.06829 · see also: `./fast-lio-fast-lio2.md`
- LIO-SAM (factor graph LIO comparison): https://arxiv.org/abs/2007.00258 · see also: `./lio-sam.md`
- LOAM (feature-based predecessor): see `./loam.md`
- LeGO-LOAM (ground-optimised comparison): see `./lego-loam.md`
- SuMa / SuMa++ (surfel comparison, 49 parameters): see `./suma.md`
- Scan Context Family (loop closure for KISS-SLAM): `./scan-context-family.md`
- Learned LiDAR Place Recognition (alternative loop-closure detector): `./learned-lidar-place-recognition.md`
- Aggregated-Map Semantic Segmentation (§1.1 map aggregation pipeline): `../../perception/overview/aggregated-map-semantic-segmentation.md`
- Large-Scale 3D Segmentation — Tiling and Throughput: `../../perception/overview/large-scale-3d-segmentation-tiling-and-throughput.md`
- Point Cloud Registration Math — ICP, NDT, GICP (registration math background): `../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md`
- Rolling-Shutter LiDAR Deskew and Motion Distortion (deskew background): `../../../10-knowledge-base/geometry-3d/rolling-shutter-lidar-deskew-motion-distortion.md`
