# ERASOR

<!-- method-priority:start
priority:
  learning: 4
  deployment: 5
  type: "method"
  stage: "deployment-pattern"
  maturity: "pilot-proven"
  tags: ["slam", "mapping", "validation", "runtime-localization", "outdoor"]
  reason: "ERASOR is rated for dynamic-object filtering and map-cleaning workflows that protect localization maps."
method-priority:end -->

Related docs: [LiDAR Map Cleaning — Dynamic Removal](lidar-map-cleaning-dynamic-removal.md), [ERASOR++](erasor-plus-plus.md), [Removert](removert.md), [MapCleaner](mapcleaner.md), [DR-Remover](dr-remover.md), [FreeDOM](freedom-dynamic-object-removal.md), [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md), [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [Dynamic-Object-Aware SLAM](dynamic-object-aware-slam.md).

**Last updated:** 2026-05-23

---

## What It Is

ERASOR — Egocentric Ratio of Pseudo Occupancy-based Dynamic Object Removal — is a training-free, geometric offline method for removing dynamic-object ghost trails from accumulated LiDAR point-cloud maps. It was published by Hyungtae Lim, Sungwon Hwang, and Hyun Myung (KAIST) in IEEE Robotics and Automation Letters, vol. 6, no. 2, pp. 2272–2279, 2021, presented with ICRA 2021.

The method's core purpose is static map building: given a raw accumulated map that contains ghost trails from moving vehicles, pedestrians, and equipment, ERASOR produces a cleaned static map suitable for localization, navigation, and semantic annotation. It does not perform real-time detection or tracking; it operates as an offline post-hoc batch processor over the full accumulated map.

ERASOR introduces two canonical evaluation metrics for this task — Preservation Rate (PR) and Rejection Rate (RR) — that have since been adopted as the standard benchmark protocol across the dynamic-map-cleaning research community.

**Key identifiers:**
- arXiv: https://arxiv.org/abs/2103.04316
- DOI: https://doi.org/10.1109/LRA.2021.3061363
- Official repository: https://github.com/LimHyungTae/ERASOR

---

## Core Technical Idea

ERASOR's central argument is geometric and one-sentence: a dynamic-object ghost trail produces a bin in the accumulated map that the current scan cannot reproduce, because the object has moved away and left only free space — the ratio of current-scan vertical extent to map vertical extent in that bin is therefore near zero.

This insight separates ERASOR from its two main predecessors:

- **Removert (IROS 2020)** uses per-scan range-image ray-based visibility checks: if a map point is occluded in the current scan's range image, it is flagged as potentially dynamic. This requires per-scan ray traversal through the full map — expensive and incidence-angle-sensitive.
- **OctoMap** uses volumetric Bayesian occupancy updating: cells accumulate evidence over time and flip from occupied to free. This is slow and asymmetric: many observations are needed before a cell is declared dynamic.

ERASOR instead computes a single pair of descriptors per bin — one from the current scan, one from the map — and compares their vertical extent. The comparison is O(1) per bin, deterministic, and robust to pose error because both descriptors use relative height span rather than absolute altitude. This makes ERASOR approximately 10× faster than Removert and 15× faster than OctoMap on benchmark sequences while achieving higher Preservation Rate.

The pipeline is described as "removed-then-revert," a framing coined by Removert: candidate dynamic bins are first marked for removal, then a region-wise ground-plane fitting step reverts ground-contact points back into the map. ERASOR replaces Removert's visibility-based mechanism with a scan-ratio check and its multi-resolution range-image revert with a PCA-based ground fit.

---

## Inputs and Outputs

| Item | Role |
|---|---|
| Raw accumulated map `M` | All registered LiDAR scans aggregated into one point cloud; contains ghost trails from dynamic objects. |
| Per-scan ego-poses `{T_t}` | Required to transform each scan into the map frame; must come from a SLAM or survey system. Pose quality is a hard dependency. |
| Individual LiDAR scans `{S_t}` | Raw point clouds that provide the current-scan pseudo-occupancy evidence against the map. |
| VoI and bin parameters | `L_max`, `H_min`, `H_max`, `N_r`, `N_θ` — define the spatial scope and resolution of processing. |
| Scan-ratio threshold `τ_SR` | Main sensitivity control; default 0.2. |
| R-GPF inlier threshold `τ_g` | Ground-plane fitting inlier distance; default 0.15 m. |
| **Output: cleaned static map `M'`** | Accumulated map with dynamic-object ghost trails removed; ground points under dynamic regions reverted. |
| **Output: rejected dynamic points** | Complement of `M'`; useful for QA, relabeling, safety investigation, and map lifecycle management. |

---

## Spatial Partition: Volume of Interest and Sector-Ring Bins

### Volume of Interest

Only points within a cylindrical region around the current ego-pose are processed per scan frame:

```
ρ_k < L_max   AND   H_min < z_k < H_max
```

Default values from the ERASOR GitHub configuration:

```
L_max   = 80.0 m    (maximum radial distance)
H_min   = −1.0 m    (below ground to capture slope variation)
H_max   =  3.0 m    (covers vehicles and pedestrians; excludes overhanging structure)
```

Points outside the VoI are passed through unchanged — neither tested nor removed. This makes the method both efficient (processes only the locally relevant region per scan) and conservative (distant or very tall structure is never touched).

### Bin Definition

The VoI is divided into a polar grid of `N_r` radial rings × `N_θ` azimuthal sectors. A bin `S(i,j)` contains all VoI points satisfying:

```
(i−1)·L_max/N_r  ≤  ρ_k  <  i·L_max/N_r
(j−1)·2π/N_θ − π  ≤  θ_k  <  j·2π/N_θ − π
```

where `ρ_k = sqrt(x_k² + y_k²)` and `θ_k = arctan2(y_k, x_k)` are the in-plane polar coordinates of point `k` in the ego-centric frame.

The ERASOR paper does not publish canonical default values for `N_r` and `N_θ` in the body text. The GitHub configuration files use example values of approximately `N_r = 30` rings and `N_θ = 60` sectors for the SemanticKITTI sequences, but these are user-set and tunable. Finer bins improve spatial localization of dynamic regions but increase sensitivity to sparsity at far range. Coarser bins are more robust to sparse returns but may merge adjacent static and dynamic regions.

---

## Region-wise Pseudo Occupancy Descriptor (R-POD)

For each bin `S(i,j)`, the pseudo-occupancy is the vertical extent of all points in the bin:

```
Δh(i,j) = sup{ z_k : p_k ∈ S(i,j) }  −  inf{ z_k : p_k ∈ S(i,j) }
```

This is computed separately for two descriptor sets:

- **Query descriptor** `Δh^Q(i,j)`: from the current scan's points projected into the bin.
- **Map descriptor** `Δh^M(i,j)`: from the accumulated map's points in the same bin.

The "pseudo" qualifier is deliberate: this metric does not measure true 3D occupancy (no voxelisation, no ray traversal). It approximates occupancy through the vertical footprint of points — a tall structure fills height; an empty bin or a ground-only bin has near-zero Δh.

**Why height span works.** A vehicle parked during a survey scan contributes roughly 1.5–2 m of `Δh^M` (tyres to roof). After it drives away, the query scan of the same bin contains only ground, giving `Δh^Q ≈ 0`. The ratio reveals the discrepancy immediately.

**Key design choice.** Using height span (sup − inf) rather than point count makes R-POD robust to angular resolution variation with distance and robust to partial scan overlap. A far bin with few points but spanning 2 m is treated identically to a near bin with many points spanning 2 m. This property is what allows ERASOR to perform well across the full 80 m VoI radius without range-dependent parameter tuning.

---

## Scan Ratio Test (SRT)

The SRT compares the query and map R-POD values per bin:

```
scan_ratio(i,j) = Δh^Q(i,j) / Δh^M(i,j)
```

A bin is flagged as potentially dynamic if:

```
scan_ratio(i,j) < τ_SR
```

where the default threshold is `τ_SR = 0.2`, determined by ablation in the original paper (sweeping {0.10, 0.15, 0.20, 0.25, 0.30}; Fig. 6).

### Asymmetry of the Test

The test is one-sided (asymmetric). Only bins where the map has more occupancy than the scan are flagged. If the scan has more occupancy than the map (`scan_ratio > 1`), no action is taken — this could be a new static object or a sensor artifact, and ERASOR conservatively preserves it.

The asymmetry is deliberate:
- Under-counting (map richer than scan) is the geometric signature of a ghost trail: the object was there during accumulation but is absent in the query scan.
- Over-counting (scan richer than map) could indicate a genuinely new permanent feature; removing it would destroy valid map content.

### Edge Cases

- Bin where the **map has no points** (`Δh^M = 0`): ratio undefined; bin skipped (no map content to protect).
- Bin where the **scan has no points** (`Δh^Q = 0`) and `Δh^M > 0`: `scan_ratio = 0 < τ_SR` → flagged. This is the canonical ghost-trail case.
- Bin with **thin static structure** (kerb, rail, painted edge): `Δh^M` may be small but consistent; the ratio is preserved unless `Δh^Q` is near zero. This is a limit of the method — see Failure Modes.

---

## Region-wise Ground Plane Fitting (R-GPF) — the Revert Step

Flagged bins contain all the map points in that sector-ring. Not all of these are dynamic: the ground surface under the ghost trail is genuine static structure. R-GPF recovers those ground points.

**Algorithm per flagged bin `S(i,j)` — 3-iteration PCA refinement:**

```
1. Seed selection:
   Extract initial seed points as the lowest-z subset:
   { p_k ∈ S^M(i,j) : z(p_k) < z_mean + τ_seed }
   where z_mean is the per-bin mean z.

2. Covariance estimation:
   C = Σ (p_j − p_mean)(p_j − p_mean)^T
   over the seed set.

3. PCA:
   Extract ground normal n = eigenvector corresponding to the
   smallest eigenvalue of C.

4. Inlier selection:
   Retain points satisfying: distance_to_plane(p_k, n) < τ_g
   Default τ_g = 0.15 m.

5. Repeat steps 2–4 for 3 iterations with the updated inlier set.

6. Revert: ground inlier points → kept in output map M'.
   Non-ground points in the flagged bin → rejected.
```

R-GPF is the "revert" half of the removed-then-revert pipeline. Without it, the SRT would delete the ground surface along every vehicle trajectory — catastrophic for localization.

**Limits of R-GPF.** The PCA plane fit assumes locally flat ground. On ramps, kerbs, and uneven terrain, the fitted plane may exclude valid ground points (under-revert) or include dynamic points near ground level (over-revert). This is the primary driver of ERASOR's degradation in non-flat environments. The FreeDOM paper (arXiv 2504.11073) quantifies this: ERASOR F1 drops to 0.696 on indoor stairs vs. 0.886 in flat corridors, consistent with the indoor-stairs result of 69.64% F1 on the KTH DynamicMap Benchmark.

---

## Full Pipeline Architecture

```
Input: raw accumulated map M,
       set of individual scans {S_t},
       per-scan ego-poses {T_t}

For each scan S_t:
  1. Transform S_t to map frame using T_t
  2. Compute VoI for current ego-pose (L_max, H_min, H_max)
  3. Encode M_VoI into R-POD map descriptor  {Δh^M(i,j)}
  4. Encode S_t_VoI into R-POD query descriptor {Δh^Q(i,j)}
  5. Apply SRT: flag bins where Δh^Q / Δh^M < τ_SR = 0.2
  6. For each flagged bin:
       run R-GPF (3 iterations) → partition into ground inliers and non-ground
  7. Mark non-ground points in flagged bins as dynamic candidates
  8. Revert ground inlier points to static

Output: cleaned static map M' = M minus dynamic candidates plus reverted ground points
        rejected point cloud = complement of M' (for QA)
```

The pipeline processes the full accumulated map in batch. There is no online frame-by-frame incremental update; ERASOR is an **offline post-hoc** cleaner. It does not modify the SLAM trajectory or re-estimate poses; external pose quality is a hard dependency.

---

## Training-Free Nature

ERASOR has zero learned components. The algorithm is entirely geometric:
- No neural network weights.
- No training data required.
- No semantic class labels used or produced.
- No per-object detection or tracking.

**Strengths of the training-free design:**
- Works immediately on any new domain (airside, warehouse, mining, port) without retraining or labeled data.
- Fully explainable: every removed or retained point can be traced to a specific bin's `scan_ratio` value and the R-GPF decision.
- No domain transfer issues: the same parameters that work on SemanticKITTI road sequences apply directly to airside apron data, with only VoI height and bin resolution adjustments.

**Limits of the training-free design:**
- Cannot leverage class identity. A parked car and a permanent wall look the same if their scan-ratio patterns are similar. A pedestrian walking alongside a wall creates an ambiguous bin.
- Cannot reason about motion history or temporal patterns. A slowly-moving object whose ghost trail accumulates gradually will have a scan-ratio that only gradually falls below `τ_SR`.
- Semantic-class-agnostic: all objects receive identical treatment regardless of whether they are vehicles, people, or infrastructure.

---

## Key Parameters

| Parameter | Default | Effect |
|---|---|---|
| `L_max` | 80.0 m | Maximum radial range for VoI; reduce to 40–60 m for constrained apron routes |
| `H_min` | −1.0 m | Lower height bound for VoI; below-ground captures slope variation |
| `H_max` | 3.0 m | Upper height bound; consider 4.5–5.0 m for aircraft gear and tug superstructure |
| `τ_SR` (scan_ratio_threshold) | 0.2 | Main sensitivity knob; higher = more aggressive removal; start at 0.15 for conservative runs |
| `τ_g` | 0.15 m | R-GPF plane-inlier distance; reduce for very flat terrain |
| `N_r` | ~30 (tunable) | Number of radial rings; finer = better spatial resolution, higher sparsity sensitivity |
| `N_θ` | ~60 (tunable) | Number of azimuthal sectors; coarser reduces false positives from sparse returns |
| R-GPF iterations | 3 | Plane-fit refinement cycles |

---

## Benchmark Results

### Evaluation Metrics

ERASOR introduced the canonical PR/RR/F1 protocol:

```
PR = |retained static points| / |all true static points|
RR = |removed dynamic points| / |all true dynamic points|
F1 = 2·PR·RR / (PR + RR)
```

PR rewards not deleting static structure; RR rewards removing dynamic ghost trails. F1 is the harmonic mean. Evaluation uses voxel downsampling at 0.2 m resolution on SemanticKITTI ground-truth class labels.

### SemanticKITTI (Paper-Reported, Primary Benchmark)

ERASOR results (voxel 0.2 m):

| Seq | PR (%) | RR (%) | F1 |
|---|---|---|---|
| 00 | 93.98 | 97.08 | 0.955 |
| 01 | 91.49 | 95.38 | 0.934 |
| 02 | 87.73 | 97.01 | 0.921 |
| 05 | 88.73 | 98.26 | 0.933 |
| 07 | 90.62 | 99.27 | 0.948 |

*Source: ERASOR paper Table II and GitHub README. Note: the GitHub master-branch re-run shows minor variations (e.g., seq 07 PR 93.88%, F1 0.963) due to implementation refinements after publication.*

Comparison with baselines on Sequence 00:

| Method | PR (%) | RR (%) | F1 |
|---|---|---|---|
| Peopleremover | 37.5 | 89.1 | 0.528 |
| OctoMap-0.05 | 76.7 | 99.1 | 0.865 |
| Removert-RM3 | 85.5 | 99.4 | 0.919 |
| **ERASOR** | **93.98** | **97.08** | **0.955** |

Runtime comparison on Sequence 01:

| Method | Time per iteration (s) |
|---|---|
| Peopleremover | ~1,000 |
| OctoMap | 1.077 |
| Removert | 0.831 |
| **ERASOR** | **0.073** |

ERASOR is approximately 10× faster than Removert and 15× faster than OctoMap on this sequence.

### KTH DynamicMap Benchmark (Secondary Source via FreeDOM Paper)

The following numbers are sourced from Table I in the FreeDOM paper (arXiv 2504.11073), which benchmarks ERASOR as a comparison baseline across the KTH DynamicMap Benchmark datasets. Note that voxel size and evaluation protocol may differ from ERASOR's original SemanticKITTI evaluation.

| Dataset | ERASOR PR (%) | ERASOR RR (%) | ERASOR F1 |
|---|---|---|---|
| SemanticKITTI seq 02 | 95.52 | 99.78 | 97.60% |
| SemanticKITTI seq 07 | 91.87 | 98.74 | 95.18% |
| HeLiMOS Ouster | 90.37 | 92.99 | 91.66% |
| Indoor corridor | 87.05 | 90.10 | 88.55% |
| Indoor stairs | 63.79 | 76.67 | 69.64% |

*Source: arXiv:2504.11073 Table I (secondary source). Verify against the primary KTH Benchmark paper (arXiv:2307.07260) when a text-accessible version is available.*

The indoor-stairs result (F1 = 69.64%) confirms that the flat-terrain assumption in R-GPF is the hard limit in non-flat environments.

---

## Variants and Lineage

### Predecessor: Removert (IROS 2020)

- **Authors:** Giseop Kim, Ayoung Kim (SNU / KAIST)
- **Repository:** https://github.com/gisbi-kim/removert
- **Mechanism:** per-scan range-image projection; if the map's range at pixel `(u,v)` exceeds the scan's range by a threshold, the map point is occluded → flagged dynamic. Multi-resolution revert step at finer resolution recovers false positives.
- ERASOR benchmarks against Removert and outperforms it on PR and runtime. Removert achieves higher RR on some sequences (fewer false negatives near object centers) but runs 10× slower and has incidence-angle false positives on highly reflective or tilted surfaces.
- The "removed-then-revert" pipeline name was coined by Removert; ERASOR adopts the architecture but replaces the visibility-check mechanism with a scan-ratio check.
- See also: `./removert.md`

### ERASOR (RA-L 2021)

This page. Pseudo-occupancy scan ratio replaces ray-based visibility; R-GPF revert replaces multi-resolution range-image revert.

### ERASOR++ (ICRA 2024)

- **Authors:** Jiabao Zhang, Yu Zhang
- **arXiv:** https://arxiv.org/abs/2403.05019
- **ERASOR++ has its own page at `./erasor-plus-plus.md`** — the brief below is a summary only; the dedicated page can be deepened in a future iteration.

ERASOR++'s motivation: ERASOR's R-POD uses only a single scalar (`Δh`) per bin, losing internal height-layer information. Two failure modes follow: (1) a bin with ground points and sparse canopy at 2.5 m gets the same `Δh` regardless of whether the middle layers are occupied; (2) z-axis odometry uncertainty (typically 2–5× larger than x/y in LiDAR SLAM) shifts all bin z-values, inflating or deflating `Δh` relative to ground truth.

ERASOR++ addresses these via three new tests built on a Height Coding Descriptor (HCD):

**Height Coding Descriptor (HCD).** Replaces the scalar `Δh` with a two-part descriptor per bin:

```
D^D_ij = max{z_k} − min{z_k}     (height difference — same as ERASOR Δh)

D^E_ij = Σ_{α=1}^{N_l}  O_ij(α) · 2^(α-1)   (bitwise height-layer encoding)
```

where `O_ij(α) = 1` if any point falls in height layer `α`, else 0. `D^E` encodes which height layers contain points — a bin with ground + middle + canopy produces a different `D^E` than a bin with only ground + canopy, even if both have the same `D^D`.

**Height Stack Test (HST).** Replaces the SRT. Computes the bitwise AND of current-scan and map `D^E` with ground-layer bits masked out:

```
H_t = [D^E_t(Curr) AND D^E_t(Map)] AND (NOT Layer(Ground))
```

If the count of co-occurring non-ground layers exceeds a threshold, the bin is considered occupied and the dynamic-object content is preserved. HST addresses the key ERASOR failure where a static wall is temporarily blocked at ground level by a dynamic object — ERASOR would flag the wall; HST preserves it because the wall's upper layers still appear in both descriptors.

**Ground Layer Test (GLT).** Identifies ground-layer encoding per ring from point concentration statistics, independently of z-axis pose uncertainty. More robust than ERASOR's absolute-height seed, especially on traversals with z-drift.

**Surrounding Points Test (SPT).** Post-processing step: isolated single-bin dynamic flags (likely noise or vegetation-edge artifacts) are reclassified as static if none of their 3×3 neighbourhood bins are also flagged.

ERASOR++ benchmark results on SemanticKITTI (voxel 0.2 m):

| Seq | ERASOR PR (%) | ERASOR F1 | ERASOR++ PR (%) | ERASOR++ F1 |
|---|---|---|---|---|
| 00 | 92.15 | 0.946 | 96.83 | 0.965 |
| 01 | 91.90 | 0.932 | 98.99 | 0.962 |
| 02 | 80.90 | 0.891 | 87.89 | 0.931 |
| 05 | 86.96 | 0.921 | 96.53 | 0.971 |
| 07 | 93.48 | 0.961 | 98.58 | 0.986 |

*Source: ERASOR++ paper Table I (arXiv 2403.05019). Note: ERASOR was re-run under the ERASOR++ evaluation harness; minor differences from original ERASOR paper numbers are expected. The relative improvement is the meaningful comparison.*

PR improvement: +3 to +8 percentage points. The largest gain is on seq 01 (+7.09 pp) where ERASOR's ground-seed failure in highway vegetation was the dominant failure mode. Runtime: comparable to ERASOR (~0.10–0.14 s/frame); the HST computation is offset by reduction in R-GPF iterations.

**No confirmed public repository for ERASOR++** as of 2026-05-23. The arXiv paper does not link a public repo. The ERASOR2 site (https://erasor2.github.io/) covers the separate instance-level version. Verify before citing implementation availability.

### ERASOR2 (2023, Instance-Aware)

- **Site:** https://erasor2.github.io/
- Uses 3D instance segmentation (detection + tracking) to label and remove entire object instances. Handles parked vehicles by checking motion history — a vehicle never observed moving is preserved. Bridges geometric removal to the learned-instance approach, partially addressing the static-but-transient problem that ERASOR and ERASOR++ cannot solve.

### Learned and Voxel-Based Successors

| Method | Venue | Mechanism | arXiv |
|---|---|---|---|
| Dynablox | RA-L 2023 | TSDF-based ever-free detection; online; Voxblox integration | 2304.10049 |
| DUFOMap | RA-L 2024 | Void-region detection; tuning-free; 0.062 s/frame | 2403.01449 |
| FreeDOM | arXiv 2025 | Conservative free-space + raycast enhancement; best published F1 as of early 2025 | 2504.11073 |
| DR-Remover | — | Terrain-first approach | see `./dr-remover.md` |
| MapCleaner | Remote Sensing 2022 | Dense terrain surface estimation before dynamic classification; high static preservation | see `./mapcleaner.md` |
| BeautyMap | RA-L 2024 | Bitwise binary matrix; ~0.046 s/frame; SA 99.2% | 2405.07283 |

The evolution follows a clear trajectory: geometric-only (Removert, ERASOR) → height-augmented geometric (ERASOR++) → conservative free-space (DUFOMap, FreeDOM) → instance-aware (ERASOR2) → online/offline hybrid (FreeDOM). Each step trades simplicity for accuracy in specific failure regimes.

See also: `./lidar-map-cleaning-dynamic-removal.md` for the full family overview and `./dynamic-map-cleaning-benchmarks.md` for cross-method evaluation.

---

## Strengths

- **No training required.** Works immediately on any domain — airside, warehouse, port, mining, construction — without labeled data or retraining.
- **Fast.** ~0.073 s per scan iteration on SemanticKITTI seq 01; ~10× faster than Removert, ~15× faster than OctoMap.
- **Explainable.** Every removal decision traces to a specific bin's `scan_ratio` value and the R-GPF ground inlier classification. No black-box behavior.
- **Pose-error-tolerant.** R-POD uses relative height span, not absolute altitude; moderate z-drift does not catastrophically flip bin decisions.
- **Ground preservation.** R-GPF revert step protects the ground surface under dynamic-object ghost trails, which is critical for navigation map integrity.
- **PR/RR F1 > 0.92** on all tested SemanticKITTI sequences; higher PR than Removert at comparable RR.
- **Published metrics and reference implementation.** Reproducible benchmarks on SemanticKITTI; official ROS/PCL implementation at https://github.com/LimHyungTae/ERASOR.
- **Canonical status.** ERASOR is the standard comparison baseline for all subsequent map-cleaning methods; any competitive method must beat it. Its evaluation protocol (PR/RR/F1) is now the community standard.

---

## Failure Modes

### 1. Slow-Moving Objects (Short Ghost Trail)

A vehicle moving at < 1 m/s (aircraft tug in a tight turn, pedestrian on a slope) accumulates a ghost trail whose bins spatially overlap with the current-scan observation. Both `Δh^Q` and `Δh^M` are positive and their ratio is near 1.0 → `scan_ratio ≥ τ_SR` → **not flagged**. The ghost trail remains. This is a fundamental geometric limit of any scan-ratio approach: slow dynamics look like static occupancy.

### 2. Parked and Static-but-Transient Objects

A parked aircraft tug occupies a fixed position throughout the entire survey run. At every query scan, `Δh^Q ≈ Δh^M` because the object is present in both. `scan_ratio ≈ 1.0` → **never flagged, never removed.** ERASOR is geometrically blind to the distinction between a permanently fixed structure and a parked movable object.

This is the canonical "static-but-transient" problem: objects that are static during the survey but movable (and eventually moved) in operations. Neither ERASOR nor ERASOR++ address it — neither method has access to motion history or semantic class identity.

**See: `../../perception/overview/static-but-transient-point-removal.md`** for the dedicated treatment of this problem. Operational resolution requires ERASOR2 (instance-level tracking), quarantine layers, or versioned map layers where known movable-class instances are flagged regardless of their motion state during the survey.

### 3. Ground Point Oversensitivity

R-GPF's PCA plane fit may include dynamic-object points at ground contact level as "ground inliers" (under-cleaning of low-lying ghost). Conversely, near kerbs, chocks, or runway raised markings, the fit may classify the structure as ground (over-removal of legitimate low-structure). The ERASOR++ ablation (variant without GLT) shows increased false positives in this regime.

### 4. Thin Static Structures (Near-Flagging)

A kerb, lane-marking edge, or rack upright produces `Δh^M` that is small but persistent. If a dynamic object briefly passes through the same bin (`Δh^Q ≈ 0` for that query scan), `scan_ratio` transiently falls below `τ_SR` → the structure is flagged. R-GPF recovers the ground component but not the above-ground structure. This produces "ground-contact preservation with upper-structure erosion." Documented in the ERASOR++ paper as a residual limitation of the height-difference-only R-POD.

### 5. z-Axis Odometry Sensitivity

LiDAR SLAM and LIO typically have larger z-direction errors than x/y (vertical observability is weaker for horizontal spinning LiDARs). A +10 cm z-drift shifts all bin z-values, compressing or expanding `Δh` relative to the ground model. ERASOR's `τ_seed` is absolute-height-based. ERASOR++'s GLT partially mitigates this by identifying ground per ring from point concentration rather than absolute z.

### 6. Dense Vegetation

Vegetation has highly variable `Δh` between scan sessions (wind, growth, seasonal change). A dense tree canopy present in the map but partially absent in the query scan (different approach angle) produces `scan_ratio < τ_SR` → false positive removal of canopy points. Documented explicitly in the ERASOR paper as the "seq 01 highway vegetation" failure mode and as the first limitation in the ERASOR++ paper.

### 7. Multi-Level Indoor Environments

ERASOR's 2D polar grid with a 1D height descriptor is fundamentally a 2.5D representation. Multi-level environments (stairs, mezzanines, parking garages) create bins where the "ground" changes height with range or where two distinct floors project into the same sector-ring. ERASOR significantly under-performs on such geometry; the KTH benchmark indoor-stairs result (F1 = 69.64%) quantifies the degradation.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV — outdoor urban | Strong | Designed and benchmarked for outdoor LiDAR map cleaning with road vehicles and pedestrians; flat assumption holds. |
| Road AV — highway | Strong | Open road, few vertical features; scan-ratio test works well for fast-moving vehicles. |
| Airside — taxiing aircraft and active GSE | Strong | Large, fast-enough movers; scan-ratio drops cleanly to near zero on revisit. Raise `H_max` to 4.5–5.0 m. |
| Airside — parked aircraft / staged GSE | Not suitable | Static-but-transient; ERASOR cannot distinguish parked aircraft from permanent infrastructure. Use ERASOR2 or quarantine layer. |
| Airside — open apron survey | Conditional | Works for active objects; sparse vertical features mean bins have low `Δh^M` naturally — consider raising `τ_SR` slightly. |
| Warehouse / indoor flat | Conditional | Flat assumption holds; low dynamic traffic → fewer ghost trails to clean; binning may need adjustment for shorter-range scanners. |
| Warehouse / indoor multi-level | Weak | Stairs and mezzanines degrade R-GPF significantly; see KTH benchmark indoor-stairs result. |
| Mining / construction | Conditional | Large moving machinery = strong ghost trails → good RR; irregular terrain degrades R-GPF → moderate PR. |
| Agriculture / outdoor vegetation | Weak | Vegetation variability creates systematic false positives; seq 01 highway result is the proxy benchmark. |
| Port / logistics yard | Conditional | Mix of flat areas (good) and complex crane/infrastructure geometry (difficult for thin-structure near-flagging). |

---

## Aggregated-Map Suitability and Role as Segmentation Prerequisite

ERASOR's canonical deployment position is **before** the segmentation and annotation stage:

```
Accumulate → ERASOR (clean) → Segment → Auto-label
```

The ordering is documented in `./lidar-map-cleaning-dynamic-removal.md` and `../../perception/overview/aggregated-map-semantic-segmentation.md` §9.1, where dynamic removal is listed as non-optional preprocessing for aggregated-map segmentation pipelines.

The reason is straightforward:
1. Ghost trails carry vehicle/pedestrian geometry but occupy free space or overprint static structure. Segmentation models assign these stray points to incorrect classes (road/ground absorb them as false positives; object classes acquire spatially incoherent clusters).
2. Auto-labels back-projected from a dirty map propagate erroneous dynamic-class labels into every downstream training set that uses the map.

Cortinhal et al. (2022, arXiv 2201.04501) use ERASOR as the explicit map-cleaning pre-step before occupancy-grid-based auto-label generation. This is the leading published demonstration of ERASOR's role in a production auto-label pipeline.

ERASOR is the lowest-barrier entry point for this role: no training data, no semantic labels, single-pass, fast (~0.073 s/frame), and fully reproducible.

**Input requirements for this role:**
- GT poses from a completed SLAM or survey processing pipeline (not incremental online poses).
- Raw individual scans (not just the final aggregated cloud) — the R-POD query descriptor requires per-scan data.
- The accumulated map itself.

---

## Implementation Notes

- **Pose quality is the primary dependency.** ERASOR cannot fix poor registration; ghost trails from misregistered scans cannot be distinguished from genuine dynamic objects. Run SLAM with loop closure (KISS-ICP, LIO-SAM, or similar) and verify trajectory ATE before running ERASOR.
- **Start conservative.** Use `τ_SR = 0.15` on the first run. Inspect the rejected dynamic point cloud for static erosion (ground, poles, kerbs, infrastructure). Increase `τ_SR` only after confirming acceptable static preservation.
- **Store the ERASOR configuration alongside the map version.** Parameters directly affect map content; downstream systems must know what version of the map they depend on.
- **Airside `H_max` adjustment.** The default 3.0 m covers road vehicles but not aircraft gear or large tug superstructure. Use 4.5–5.0 m for apron maps. This also increases the chance of a loaded bin having non-zero `Δh^M` for tall aircraft-infrastructure, so test `τ_SR` carefully.
- **Multi-session cleaning.** ERASOR processes one query-scan-vs-map pair per iteration. For multi-session surveys, run ERASOR separately per session or accumulate all sessions into one map before cleaning. The latter produces better ghost-trail elimination for short-occupancy objects but may be dominated by objects present in most sessions (parked aircraft — exactly the static-but-transient failure mode).
- **Compare against Removert and MapCleaner on the same route before adopting ERASOR as the default cleaner.** On routes with many thin structures or highly vegetated environments, MapCleaner's terrain-first approach may outperform ERASOR's scan-ratio approach.
- **Do not update production maps automatically from one ERASOR run.** Use a map lifecycle approval step: inspect the rejected cloud, run a localization residual check on the cleaned map, and gate promotion to production.
- **ERASOR++ as the upgrade path.** For the same pipeline with improved PR (especially where vegetation, z-drift, or ground-contact ambiguity is causing false positives), ERASOR++ is a drop-in conceptual replacement. Pending a public repository release, ERASOR++ may require custom implementation from the arXiv paper.
- **Static-but-transient objects.** ERASOR cannot solve this problem by design. If parked aircraft, docked GSE, or staged equipment must be absent from the long-term localization map, implement a quarantine layer (flag all points in known movable-class bounding volumes) or use ERASOR2 for instance-level motion-history checking. See `../../perception/overview/static-but-transient-point-removal.md`.

---

## Sources

- ERASOR paper (arXiv): https://arxiv.org/abs/2103.04316
- ERASOR paper (RA-L DOI): https://doi.org/10.1109/LRA.2021.3061363
- ERASOR official repository: https://github.com/LimHyungTae/ERASOR
- ERASOR++ paper (arXiv): https://arxiv.org/abs/2403.05019
- ERASOR++ HTML: https://arxiv.org/html/2403.05019v1
- KTH DynamicMap Benchmark paper: https://arxiv.org/abs/2307.07260
- KTH DynamicMap Benchmark repository: https://github.com/KTH-RPL/DynamicMap_Benchmark
- FreeDOM paper (source for KTH benchmark ERASOR numbers): https://arxiv.org/html/2504.11073v1
- Removert repository: https://github.com/gisbi-kim/removert
- ERASOR2: https://erasor2.github.io/
- Cortinhal et al. auto-label pipeline using ERASOR: https://arxiv.org/abs/2201.04501
- Dynablox: https://arxiv.org/abs/2304.10049
- DUFOMap: https://arxiv.org/abs/2403.01449
- FreeDOM: https://arxiv.org/abs/2504.11073
- MapCleaner: https://www.mdpi.com/2072-4292/14/18/4496
- BeautyMap: https://arxiv.org/abs/2405.07283
- Related method page: `./erasor-plus-plus.md` — ERASOR++ deep dive (can be further deepened in a future iteration)
- Related method page: `./removert.md` — predecessor visibility-based cleaner
- Related method page: `./mapcleaner.md` — terrain-first alternative
- Related method page: `./dr-remover.md` — terrain-first successor
- Related method page: `./freedom-dynamic-object-removal.md` — best-published-F1 learned successor (2025)
- Related method page: `./dynamic-map-cleaning-benchmarks.md` — cross-method evaluation and protocol
- Related method page: `./lidar-map-cleaning-dynamic-removal.md` — family overview; §9.1 prerequisite framing
- Related overview page: `../../perception/overview/aggregated-map-semantic-segmentation.md` — §9.1 non-optional preprocessing; §2.4 accumulate-then-segment pipeline ordering
- Related overview page: `../../perception/overview/static-but-transient-point-removal.md` — canonical treatment of the parked/staged object problem that ERASOR cannot solve
- Dynamic-object-aware SLAM context: `./dynamic-object-aware-slam.md`
