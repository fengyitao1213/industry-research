# PolarMix

<!-- method-priority:start
priority:
  learning: 4
  deployment: 3
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["perception", "lidar", "segmentation", "road-av"]
  reason: "PolarMix is the polar-coordinate mixing augmentation that improves single-scan LiDAR segmentation and rebalances rare classes via instance rotate-paste."
method-priority:end -->

## What It Is

- PolarMix is a **training-time data augmentation** for outdoor LiDAR point cloud segmentation, introduced in "PolarMix: A General Data Augmentation Technique for LiDAR Point Clouds" (Xiao, Huang, Guan, Cui, Lu, Shao — NeurIPS 2022, main track).
- It operates **entirely in the raw point cloud** before voxelization or feature extraction, making it a pure data-space augmentation that attaches to any downstream backbone without modification.
- It defines two complementary operators: (1) scan-level polar swapping, which exchanges azimuth wedges between two training scans, and (2) instance-level rotate-paste, which inserts rotated copies of foreground instances at diverse azimuth positions around the scan center.
- Both operators respect the **polar scan pattern of a single spinning LiDAR** — exploiting the azimuth-axis geometry to produce physically plausible composites. This physics grounding distinguishes PolarMix from Cartesian mixing methods (Mix3D, PointCutMix) and from LaserMix, which mixes along the orthogonal elevation axis.
- In the original paper, PolarMix raises SemanticKITTI mIoU by +8.5–9.1 pp (MinkUNet, SPVCNN); an independent re-evaluation using different training configurations reports more modest but still consistent +2.0 pp gains. The two sets of numbers are legitimate — differences arise from baseline training configurations, not methodology errors.
- Native integration in **MMDetection3D** (v1.1+); pre-trained weights available from the official repository.

## Core Technical Idea

A spinning LiDAR collects returns by rotating its laser beams around the **azimuth axis** (Z-axis in a polar/cylindrical frame: radius r, azimuth θ, elevation φ). Each azimuth sector [α, β] captures a geometrically self-consistent wedge of the scene: LiDAR beam density and incidence angles are physically consistent within the wedge because all returns originate from the same sensor position at the same rotation stage. Swapping a wedge between two scans produces a composite scan that preserves this sensor-physics fidelity — something Cartesian region cuts (which split the scene at arbitrary XYZ planes) cannot guarantee.

**Scan-level polar mixing:** PolarMix slices along the azimuth direction θ = atan2(y, x), swapping a contiguous angular sector between two scans. The swap increases the structural variety of full scenes seen during training. Ablation results confirm that a 180° swap maximizes gains; narrow slices (45°) slightly hurt performance (−0.9 mIoU on a validation subset), likely because a small wedge introduces boundary discontinuities without meaningfully diversifying scene content.

**Instance-level rotate-paste:** PolarMix extracts foreground instances from a second scan and rotates them about the sensor Z-axis, pasting N_paste copies at distributed azimuth positions around the scan center. Rotating about Z preserves the sensor-origin distance of each instance point (unlike Cartesian XY shifts), populating otherwise empty azimuth sectors with plausible instance geometry. This is the stronger of the two operators: ablation on a SemanticKITTI validation subset attributes +4.3 mIoU to instance-paste alone versus +1.9 mIoU to scan-level swapping alone (+5.9 combined).

Both operators carry labels as point attributes — no relabelling is needed. The azimuth-axis orientation of PolarMix is orthogonal to LaserMix's elevation-axis cuts, which is the mechanistic basis for their complementarity when combined.

## Operator Mechanics

### Scan-Level Polar Swapping — Azimuth Slicing

For a point `p = (x, y, z)` in a single LiDAR scan, its azimuth angle is:

```
theta(p) = atan2(p_y, p_x)      # in (-pi, pi], mapped to [0, 2*pi)
```

**Slice-swap recipe:**

```
1. Sample scans A and B from the training set.
2. Sample a contiguous azimuth range [alpha, beta] ⊂ [0°, 360°) uniformly at random,
   subject to maximum angular width Δθ = beta - alpha  (recommended: 180°).
3. A_slice = { p ∈ A  |  theta(p) ∈ [alpha, beta] }
4. B_slice = { q ∈ B  |  theta(q) ∈ [alpha, beta] }
5. A' = (A \ A_slice) ∪ B_slice
6. Labels follow points:
     points in B_slice retain ground-truth labels from scan B;
     points in (A \ A_slice) retain ground-truth labels from scan A.
```

The boundary angles α and β are the only stochastic parameters. No reweighting or blending is applied — each point retains exactly one ground-truth label from its source scan.

### Instance-Level Rotate-Paste

```
1. In scan B, identify all instances of foreground movable classes
   (vehicle, pedestrian, cyclist, motorcyclist — classes where copy-paste
   is physically meaningful).
2. For each selected instance, extract the point set I and its label mask L.
3. For k = 1 ... N_paste  (N_paste ∈ [1, 3]):
     rotation_angle_k = k * (360° / N_paste)         # distribute around Z
     I_rotated_k = rigid-body rotation of I about Z-axis by rotation_angle_k
     (XY coordinates transform; Z coordinates unchanged)
4. Paste all N_paste rotated copies into scan A, overwriting any points
   in the occupied voxel footprint.
5. Labels follow: pasted points carry the class label from scan B.
```

Hyperparameter defaults (from DACB-PolarMix baseline documentation): `N_paste_min = 1`, `N_paste_max = 3`. Standard PolarMix applies the same count uniformly across all foreground classes; the DACB-PolarMix variant replaces this with a frequency-adaptive count (see Variants).

### Label Following and Collision / Occlusion Handling

Labels are carried as point attributes — there is no post-hoc re-labelling step. The pasted instance overwrites existing background points within its footprint, approximating sensor occlusion. The implementation does not apply explicit raycasting to remove behind-object background returns; this is a known simplification that can produce ghost returns behind pasted instances (see Failure Modes). In practice, the ablation gains confirm the approximation is sufficient for training purposes. Enhanced variants with explicit occlusion rectification have been referenced in secondary literature (status unconfirmed; see Variants).

## Inputs and Outputs

| Item | Detail |
|------|--------|
| Input | Two raw LiDAR point clouds from the training set, each with per-point `(x, y, z, intensity)` and ground-truth semantic label |
| Operation stage | Data loader, before voxelization or any network feature extraction |
| Augmented output | One composite point cloud with per-point semantic labels; a second scan may be produced symmetrically from B's perspective |
| Label output | Per-point ground-truth labels, consistent with source scans — no label blending |
| Sensor assumption | Single spinning LiDAR with a single ego-centric polar origin per scan |
| Network input | Unchanged: the augmented cloud is passed to the downstream backbone in its standard format (sparse voxels, range image, etc.) |

## Architecture

PolarMix is **architecture-agnostic**. It operates on the raw point cloud before any representation-specific processing and imposes no constraints on the downstream backbone. The original paper demonstrates this across:

| Backbone | Representation | Supported |
|---|---|---|
| MinkUNet | Sparse 3D voxels (Minkowski CNN) | Yes |
| SPVCNN | Sparse voxels + point features | Yes |
| Cylinder3D | Cylindrical voxels | Yes — via MMDetection3D |
| RangeNet++ | Spherical range-image projection | Yes (range view) |
| FRNet | Frustum range view | Yes — via MMDetection3D |

The paper states: "PolarMix can work as a plug-and-play for various 3D deep architectures." Because the augmentation occurs before voxelization, it is compatible with all representation families: point-based, voxel-based, cylindrical-voxel, and projection-based. The independent comparative study (arXiv 2405.14870) finds that PolarMix benefits point-voxel methods (MinkUNet, FRNet) more than cylindrical-voxel methods (Cylinder3D), where LaserMix is the stronger augmentation — a consequence of how internal representations align with the azimuth-vs-elevation mixing axis.

## Training Recipe

**Application regime:** PolarMix is a fully-supervised single-scan training augmentation. It is applied at data-loading time and requires no change to the model, loss function, or optimizer. Its role in a semi-supervised framework is as a data-diversity augmentation inside an SSL pipeline, not as the defining SSL objective (LaserMix's consistency-loss design serves that role).

**Augmentation order:** Apply PolarMix (and LaserMix if combining) before per-scan augmentations (random rotation, scaling, flipping, point jitter). In the 2024 Waymo challenge solution (MixSeg3D), PolarMix was applied at `p = 1.0` (every training sample), indicating the augmentation is robust enough for unconditional application without over-augmentation risk.

**Hyperparameter summary:**

| Parameter | Recommended value | Note |
|---|---|---|
| Scan-level azimuth width Δθ | 180° | Ablation maximum; 45° slightly hurts (−0.9 mIoU on subset) |
| Instance paste count N_paste | 1–3 (uniform across classes) | DACB variant replaces this with frequency-adaptive count |
| Instance classes for paste | Vehicle, pedestrian, cyclist, motorcyclist | Foreground movable objects only; background classes excluded |
| Application probability | 1.0 (every sample) | Used in Waymo 2024 challenge |
| PolarMix + LaserMix combination | Random selection at each step | Best joint result; PolarMix p=1.0, LaserMix p=0.8 in MixSeg3D |

**Compute:** Training MinkUNet or SPVCNN from scratch on SemanticKITTI on a single RTX 2080Ti takes approximately 1.5 days (per official repository). PolarMix adds negligible data-loading overhead — azimuth filtering is O(N) in point count.

## Benchmark Results

### Original Paper — SemanticKITTI Validation Set (mIoU %)

These are the original paper results (NeurIPS 2022). Two baseline values appear in the literature depending on training configuration and preprocessing version; both are shown.

| Backbone | Baseline (no aug) | + PolarMix | Gain |
|---|---|---|---|
| MinkUNet | 55.9 | 65.0 | **+9.1** |
| SPVCNN | 57.7 | 66.2 | **+8.5** |

Note: the GitHub README reports MinkUNet 58.9% → 65.0% and SPVCNN 60.7% → 66.2% (different training configuration). Both sets are cited in the literature; the +8.5–9.1 pp gain figure is consistent across configurations.

### Original Paper — Additional Datasets (mIoU %)

**nuScenes-lidarseg, validation set:**

| Backbone | Baseline | + PolarMix | Gain |
|---|---|---|---|
| MinkUNet | 67.1 | 72.0 | +4.9 |
| SPVCNN | 68.4 | 72.1 | +3.7 |

**SemanticPOSS, validation set:**

| Backbone | Baseline | + PolarMix | Gain |
|---|---|---|---|
| MinkUNet | 52.1 | 57.4 | +5.3 |
| SPVCNN | 50.7 | 58.6 | +7.9 |

### Independent Re-evaluation — SemanticKITTI (mIoU %)

Source: MMDetection3D comparative study (arXiv 2405.14870). Different training configurations from the original paper; represents an independent assessment.

| Backbone | Baseline | + PolarMix | + LaserMix | + PolarMix + LaserMix |
|---|---|---|---|---|
| MinkUNet | 66.9 | 68.9 (+2.0) | 67.7 (+0.8) | **70.4 (+3.5)** |
| Cylinder3D | 63.7 | 64.5 (+0.8) | 65.6 (+1.9) | **67.0 (+3.3)** |
| FRNet | 64.1 | 66.5 (+2.4) | 65.1 (+1.0) | — |

Key finding: PolarMix (azimuth mixing) benefits point-voxel methods (MinkUNet, FRNet) more; LaserMix (elevation mixing) benefits cylindrical-voxel methods (Cylinder3D) more. Combining both — with random selection at each training step — outperforms either alone for all tested backbones. For range-view methods, FrustumMix outperforms PolarMix individually on FRNet (+3.5% vs +2.4%).

**Interpretation note:** The independent re-evaluation reports +2.0 pp for MinkUNet versus +9.1 pp in the original paper. Both numbers are accurate; the gap reflects differences in baseline training configurations and possibly in which preprocessing or augmentation pipeline is used as the "no-aug" baseline. Neither set is wrong — cite by source and configuration.

### Instance-Paste Ablation (SemanticKITTI Validation Subset)

| Operator | mIoU gain (delta) |
|---|---|
| Scan-level swapping only | +1.9 |
| Instance rotate-paste only | +4.3 |
| Both combined (PolarMix) | +5.9 |

These are ablation deltas on a validation subset, not absolute scores.

### MixSeg3D — Waymo Open Dataset Challenge 2024 (2nd Place)

PolarMix (p=1.0) combined with LaserMix (p=0.8) on MinkUNet-101 (arXiv 2501.05472):

- Leaderboard mIoU: **69.83%**
- Validation mIoU: 74.03% (with 8× test-time augmentation)

### DACB-PolarMix — Rare-Class Gains (SemanticKITTI, MinkUNet)

| Configuration | mIoU | Delta |
|---|---|---|
| Raw baseline | 55.9% | — |
| + PolarMix | 65.0% | +9.1 vs baseline |
| + DACB-PolarMix | **67.9%** | **+2.9 vs PolarMix** |

DACB-PolarMix's +2.9 pp is the gain **over standard PolarMix**, not over the raw baseline. Qualitative improvement: DACB-PolarMix segments traffic cones and traffic signs that standard PolarMix still misclassifies.

## Variants and Lineage

**DACB-PolarMix** (Dynamic Adaptive Class-Balanced PolarMix; PLOS ONE 2025): replaces the uniform N_paste count with a class-frequency-adaptive formula:

```
rotation_count = max_count - (normalized_class_proportion * 10)
rotation_count = clamp(rotation_count, min=1, max=3)
```

Underrepresented classes receive more paste copies; dominant classes receive fewer. Results on SemanticKITTI: MinkUNet 65.0% → 67.9% (+2.9 pp over standard PolarMix); SPVCNN 66.2% → 67.5% (+1.3 pp). Smaller gain on SemanticPOSS (58.8% → 59.0%), attributed to SemanticPOSS's more balanced class distribution. Time complexity O(max(m, n)), where n = unique instance classes, m = label length. GitHub: github.com/grass2440/DACB-PolarMix.

**Class-Balanced PolarMix** (Journal of Internet Technology, NDHU): a separate contemporaneous class-balancing variant with similar goals. Distinct institution and publication from DACB-PolarMix; do not conflate without confirming author affiliations.

**MixSeg3D** (Waymo 2024 Challenge, arXiv 2501.05472): not a standalone publication — the combined PolarMix + LaserMix training strategy used in the 2024 Waymo Open Dataset Challenge 3D Semantic Segmentation Track 2nd-place solution. Applies both augmentations at data-loading time on MinkUNet-101; the combination yields 69.83% leaderboard mIoU and 74.03% validation mIoU with TTA.

**Enhanced PolarMix with occlusion rectification**: referenced in secondary literature as incorporating "rotational adjustments, height alterations, and occlusion rectifications" beyond the naive footprint-overwrite. Source attribution is not fully confirmed; may overlap with DACB-PolarMix or represent a separate Chinese-language publication. Flag for follow-up before citing.

**PolarMix axis vs LaserMix axis:** PolarMix slices the azimuth θ — a vertical wedge through the sensor, capturing all elevation rings within the angular sector. LaserMix slices the elevation φ — a horizontal cone layer capturing all azimuths within a ring of laser beams. Because LiDAR beams are symmetric in azimuth but asymmetric in elevation, the two axes produce different diversity effects: azimuth mixing changes scene content (objects, geometry) at all heights; elevation mixing changes vertical coverage density. The empirical backbone preference (MinkUNet → PolarMix; Cylinder3D → LaserMix) directly reflects internal representation alignment with each mixing axis.

**3D augmentation lineage context:**

| Method | Year | Mixing axis | Primary use |
|---|---|---|---|
| PointCutMix / CutMix-3D | 2021 | Cartesian 3D sphere/block | Generic point cloud |
| Mix3D | 2021 | Scene-level concat | Indoor/sparse scenes |
| GT-paste / Copy-Paste (3D) | 2021 | Cartesian XY shift | Object detection |
| PolarMix | 2022 | Azimuth θ (polar) | Outdoor LiDAR segmentation |
| LaserMix | 2023 | Elevation φ (inclination) | Semi-supervised segmentation |
| FrustumMix | 2023 | Frustum column (range-view) | Range-view segmentation |
| DACB-PolarMix | 2025 | Azimuth θ (as PolarMix) | Rare-class rebalancing |

## Strengths

- **Large supervised gains on sparse architectures:** +8.5–9.1 mIoU on SemanticKITTI (MinkUNet, SPVCNN) in the original paper; consistent +2.0–2.4 pp gains in independent re-evaluation across different training configurations.
- **Physics fidelity:** azimuth wedges respect the sensor beam scan pattern; label consistency is automatic because labels travel with points.
- **Zero architecture change:** pure data augmentation; no modification to model, loss, optimizer, or inference pipeline.
- **Dual-task applicability:** effective for both semantic segmentation (primary) and 3D object detection (demonstrated on PointPillar, SECOND, CenterNet3D in the original paper).
- **Composable with LaserMix:** the orthogonal azimuth/elevation axes produce complementary data diversity; combined PolarMix + LaserMix consistently outperforms either alone (+3.5 pp over PolarMix alone for MinkUNet in the independent re-evaluation).
- **Open source and production-integrated:** native MMDetection3D integration (v1.1+); pre-trained weights available; official code and training commands documented on GitHub.
- **Rare-class rebalancing:** instance rotate-paste is the stronger operator (+4.3 pp ablation) and the DACB extension amplifies gains for underrepresented classes specifically.
- **Robust at high application rate:** the Waymo challenge solution applied PolarMix at p=1.0 (every sample) without degradation, suggesting the augmentation does not cause over-augmentation instability.

## Failure Modes

- **Uniform class treatment (standard baseline):** standard PolarMix assigns the same N_paste to all foreground classes; frequent classes are effectively over-augmented relative to rare ones. DACB-PolarMix addresses this with frequency-adaptive paste counts.
- **Ghost returns behind pasted instances:** naive occlusion handling overwrites only the instance footprint; background points that should be occluded in a real sensor view behind the pasted object are not removed. This produces physically implausible point configurations near pasted boundaries and can introduce label noise at instance edges.
- **Single-scan assumption (critical structural limitation):** PolarMix assumes a single polar origin per scan. It has no direct applicability to aggregated multi-scan maps where points come from multiple sensor positions — the azimuth θ(p) is undefined relative to a single origin in an aggregated map. See Aggregated-Map Suitability below.
- **Noise amplification under label corruption:** under heavy label noise (≥50% corruption), PolarMix amplifies errors — pasting mislabelled instances propagates incorrect labels to pasted copies. Performance can collapse in extreme noise regimes (arXiv 2510.09035).
- **Range-view methods:** FrustumMix outperforms PolarMix individually for range-view architectures (FRNet: FrustumMix +3.5% vs PolarMix +2.4%); PolarMix is not the optimal sole augmentation for projection-based models.
- **Slice boundary discontinuities:** the azimuth swap boundaries (at angles α and β) create geometric discontinuities where two different scenes meet; foreground objects can be truncated mid-structure at the cut boundary.
- **Cross-sensor mixing:** mixing scans from different LiDAR configurations (beam count, angular resolution) within the same batch violates the assumption that both scans share the same beam pattern. Within-dataset augmentation is safe; cross-dataset mixing requires care.
- **Narrow angular widths:** small azimuth slices (e.g., 45°) are insufficient to diversify scene content and introduce boundary artefacts without benefit; the ablation shows a 45° swap degrades performance by −0.9 mIoU versus no augmentation on a validation subset.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV — single-scan on-vehicle | Strong | Designed for exactly this scenario; original paper benchmarks on SemanticKITTI and nuScenes. |
| Road AV — aggregated / HD map | Not applicable | Requires a single polar origin; aggregated multi-pose point clouds have no valid azimuth reference. |
| Airside (single-scan, on-vehicle) | Strong | High value: airside environments have severe rare-class imbalance (aircraft, GSE, personnel vs. taxiway); instance rotate-paste directly targets this; DACB extension amplifies the effect. |
| Airside (aggregated / static map) | Not applicable | Same structural limitation as road AV aggregated case. |
| Warehouse / port / logistics-yard | Strong | ISO 3691-4 domains with rare-class imbalance (forklifts, personnel, pallets); same rationale as airside for rotate-paste. |
| Mining / construction / agriculture | Conditional | Physics motivation holds for single-scan spinning LiDAR; solid-state or non-360° sensors require care with azimuth assumptions. |
| Domain adaptation (any domain) | Useful | Reduces source-domain overfit; effective within LiDAR-UDA and DuNe frameworks; under 10% label noise on DuNe: +11 to +22 pp across three datasets. |
| Per-scan pre-labeling front-end | Strong | Trains better per-scan segmentation models that feed map auto-labeling pipelines. |

## Aggregated-Map Suitability

PolarMix is a **single-scan training augmentation** and does not operate on aggregated multi-viewpoint maps. Both of its operators require a defined single polar origin:

- Scan-level wedge swap: `theta(p) = atan2(p_y, p_x)` is only physically meaningful relative to a single sensor position at a specific scan time.
- Instance rotate-paste: rotation about the sensor Z-axis distributes instances at diverse azimuths around a single origin; there is no meaningful sensor Z-axis for a map assembled from N pose positions.

Applying PolarMix directly to an aggregated map would require arbitrarily choosing a reference origin, which destroys the sensor-physics motivation that makes the augmentation effective.

**Role in an aggregated-map pipeline (indirect):**

1. **Single-scan model training:** map auto-labeling pipelines (MAP-Seg, pseudo-label propagation, scan-by-scan annotation) begin by training a per-scan segmentation model. PolarMix improves this model's mIoU and rare-class recall before the model is applied to raw scan sequences. Higher-quality per-scan labels produce higher-quality map labels.

2. **Rare-class rebalancing for structured environments:** airports, ports, and logistics yards have highly imbalanced class distributions — aircraft, GSE, and personnel are rare against large expanses of pavement and infrastructure. PolarMix's instance rotate-paste, and especially the DACB extension, directly target this imbalance in the training scans that seed the map label pipeline.

3. **Domain adaptation bootstrapping:** PolarMix appears in multiple domain adaptation frameworks (LiDAR-UDA, DuNe) as an augmentation that reduces source-domain overfit, improving transfer to a novel deployment domain (e.g., road → airside) and yielding large gains under distribution shift (DuNe: +11.1 pp on SemanticKITTI, +11.7 pp on nuScenes, +21.7 pp on SemanticPOSS in cross-domain with 10% label noise).

4. **Layered training recipe:** in the training paradigms recommended for this knowledge base, PolarMix and LaserMix are applied together as a layered augmentation. PolarMix (azimuth) + LaserMix (elevation) cover orthogonal data diversity axes; the MixSeg3D Waymo result (69.83%) is the benchmark anchor for this combination.

For class-imbalance data strategies in loss and training design, see `../../../10-knowledge-base/geometry-3d/point-cloud-segmentation-losses-metrics-first-principles.md`. For where PolarMix fits within the full supervised/semi-supervised/self-supervised training spectrum, see `../overview/3d-segmentation-training-paradigms.md`.

## Implementation Notes

- Apply PolarMix in the **data loader**, before voxelization or projection — this is where all existing integrations operate and where the point-level label consistency guarantee holds.
- Use **180° azimuth width** for the scan-level swap. Do not reduce below ~90° without validating on a held-out set; the 45° ablation shows performance can drop below the no-augmentation baseline at narrow widths.
- Apply at **p=1.0** (every sample) — the Waymo challenge result confirms this is stable; there is no evidence of over-augmentation instability at full application rate.
- Combine with **LaserMix** (random choice at each step) for best results. The two augmentations target orthogonal data diversity axes (azimuth vs elevation) and consistently outperform either alone. For cylindrical-voxel backbones (Cylinder3D), prioritize LaserMix; for point-voxel backbones (MinkUNet, FRNet), PolarMix contributes the larger gain.
- For range-view architectures (FRNet, RangeNet++), evaluate **FrustumMix** as an alternative or addition; it outperforms PolarMix individually on FRNet (+3.5% vs +2.4% in the comparative study).
- For **rare-class-critical deployments** (airside, warehouse, port) with highly imbalanced class distributions, use **DACB-PolarMix** rather than standard PolarMix. The frequency-adaptive paste count yields +2.9 pp over standard PolarMix on MinkUNet/SemanticKITTI and specifically recovers performance on underrepresented classes.
- MMDetection3D (v1.1+) provides production-ready PolarMix integration for Cylinder3D, MinkUNet, and SPVCNN — use the library implementation rather than re-implementing from scratch. The official standalone repo (github.com/xiaoaoran/polarmix) also includes pre-trained MinkUNet and SPVCNN weights for SemanticKITTI.
- Note the **number provenance** when reporting benchmarks: the original paper shows +8.5–9.1 pp; the independent MMDetection3D re-evaluation shows +2.0 pp on MinkUNet. Both are correct for their respective training configurations. Report the source and configuration alongside the number to avoid misrepresentation.
- PolarMix adds **negligible training overhead** — azimuth filtering and paste operations are O(N) in point count. The dominant training cost is the backbone forward/backward pass, unchanged.

## Sources

- PolarMix paper (arXiv): https://arxiv.org/abs/2208.00223 (Xiao, Huang, Guan, Cui, Lu, Shao — NeurIPS 2022)
- PolarMix NeurIPS 2022 poster: https://neurips.cc/virtual/2022/poster/55374
- PolarMix OpenReview: https://openreview.net/forum?id=wS23xAeKwSN
- PolarMix ACM DL: https://dl.acm.org/doi/10.5555/3600270.3601072
- PolarMix official GitHub: https://github.com/xiaoaoran/polarmix
- DACB-PolarMix (PLOS ONE 2025, PMC): https://pmc.ncbi.nlm.nih.gov/articles/PMC11913263/
- DACB-PolarMix GitHub: https://github.com/grass2440/DACB-PolarMix
- MMDetection3D empirical augmentation study (arXiv 2405.14870): https://arxiv.org/html/2405.14870v2
- LaserMix GitHub: https://github.com/worldbench/LaserMix
- MixSeg3D / Waymo 2024 Challenge (arXiv 2501.05472): https://arxiv.org/html/2501.05472
- Domain generalization / DuNe framework (arXiv 2510.09035): https://arxiv.org/html/2510.09035
- Class-Balanced PolarMix (Journal of Internet Technology, NDHU): https://jit.ndhu.edu.tw/article/download/3144/3169
- Related overview: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline; PolarMix role as single-scan model trainer feeding map auto-labeling
- Related overview: `../overview/3d-segmentation-training-paradigms.md` — full training paradigm spectrum; where PolarMix fits in the layered supervised/SSL recipe
- Related overview: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation context
- Related method: `./lasermix.md` — sibling augmentation on the orthogonal elevation axis; pairs with PolarMix in the layered training recipe
- KB class-imbalance data strategies: `../../../10-knowledge-base/geometry-3d/point-cloud-segmentation-losses-metrics-first-principles.md`
