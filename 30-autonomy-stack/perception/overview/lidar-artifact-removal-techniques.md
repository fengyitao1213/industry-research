# LiDAR Artifact Removal Techniques

## Executive Summary

LiDAR artifact removal is a layered stack, not a single filter. It covers classical outlier removal, weather denoising, sensor health diagnostics, ghost and multipath suppression, dynamic-object masking, and static-map cleaning. The correct safety question is not "which method removes the most points?" but "which method removes false measurements without hiding real hazards or weakening localization observability?"

Artifact removal and point-cloud conditioning runs **before** semantic segmentation. Every stage in the pipeline downstream — ground segmentation, feature extraction, network inference — operates on the output of this stack. Garbage in, garbage out: un-cleaned or over-cleaned clouds systematically degrade segmentation accuracy regardless of the quality of the segmentation model itself.

For airside autonomous vehicles, the broad removal layer should include:

- Classical filters: SOR, ROR, DROR, DSOR, LIOR, DDIOR, D-LIOR, IDSOR, DVIOR, SDOR, LIDSOR.
- Learned weather removal where supported: LIORNet and related denoisers, validated against classical baselines.
- Sensor artifact handling: ghost, multipath, retroreflector blooming, sun/receiver saturation, blockage, and dust.
- Dynamic map cleaning: ERASOR, Removert, MapCleaner, ERASOR++, 4dNDF, and MOS-style evaluation.
- Safety validation: raw-vs-filtered evidence, target-domain labels, SOTIF argumentation, and ODD degradation rules.

## Repo Cross-Links

| Topic | Link | Role |
|---|---|---|
| Classical filters | [Classical LiDAR Outlier Removal](../methods/classical-lidar-outlier-removal.md) | Baseline and deterministic weather filters. |
| Weather artifacts | [LiDAR Weather Artifact Removal](../methods/lidar-weather-artifact-removal.md) | Snow, rain, fog, dust, spray, mist, and wet-surface artifacts. |
| LIORNet | [LIORNet](../methods/liornet.md) | Self-supervised U-Net++ desnower; 43.5 Hz on-vehicle capable. |
| LiSnowNet | [LiSnowNet](../methods/lisnownet.md) | Wavelet CNN desnower; 201 Hz; self-supervised. |
| TripleMixer | [TripleMixer](../methods/triplemixer.md) | Three-branch geometry/frequency/channel mixer; top WADS accuracy. |
| 3D-OutDet | [3D-OutDet](../methods/3d-outdet.md) | Memory-efficient 3D learned desnower; −99.9 % memory vs baseline. |
| DenoiseCP-Net | [DenoiseCP-Net](../methods/denoisecp-net.md) | Joint denoising + detection; V2X cooperative-perception focus. |
| AdverseNet | [AdverseNet](../methods/adversenet.md) | Adversarial weather augmentation and robustness evaluation. |
| Sensor ghosts | [LiDAR Ghost and Multipath Artifacts](../../../20-av-platform/sensors/lidar-ghost-multipath-artifacts.md) | Reflective surfaces, multipath, bloom, and saturation. |
| Safety validation | [LiDAR Artifact Removal Validation](../../../60-safety-validation/verification-validation/robustness/lidar-artifact-removal-validation.md) | Evidence plan and airside validation gates. |
| Dynamic map cleaning | [LiDAR Map Cleaning and Dynamic Removal](../../localization-mapping/slam-methods/lidar-map-cleaning-dynamic-removal.md) | Static map construction and dynamic clutter removal. |
| ERASOR | [ERASOR](../../localization-mapping/slam-methods/erasor.md) | Pseudo-occupancy dynamic object removal. |
| Removert | [Removert](../../localization-mapping/slam-methods/removert.md) | Remove-then-revert static map cleaning. |
| Map segmentation conditioning | [Aggregated-Map Semantic Segmentation](aggregated-map-semantic-segmentation.md) | Artifact removal is a map-conditioning prerequisite (§9) before segmenting the aggregated cloud. |
| Segmentation pipeline | [LiDAR Semantic Segmentation](lidar-semantic-segmentation.md) | The downstream task this conditioning serves. |
| Point-cloud representations | [Point-Cloud Representations and Voxelization](../../../10-knowledge-base/geometry-3d/point-cloud-representations-voxelization-first-principles.md) | Voxel grids, sparse tensors, range images — data structures underpinning conditioning stages. |

---

## 1. Why Conditioning Matters

### 1.1 Position in the Pipeline

Conditioning is the first processing tier after raw LiDAR packets are decoded. It sits upstream of every downstream consumer: scan-to-map registration, segmentation networks, object detection, and map aggregation. A point that enters the network is implicitly treated as a real surface measurement; there is no mechanism inside PointNet++, SPVCNN, or Cylinder3D to retroactively identify and discount sensor noise or weather returns. This is the garbage-in-garbage-out constraint.

The segmentation context tightens the requirement further. Aggregated-map segmentation (see [Aggregated-Map Semantic Segmentation §9](aggregated-map-semantic-segmentation.md)) processes clouds assembled from N scan passes. Uncorrected artifacts from each pass accumulate multiplicatively: M scans × F artifacts/scan = M×F ghost points in the final map. A level of artifact density that is tolerable in single-scan inference becomes a class-imbalance and false-structure problem at map scale.

### 1.2 The Over-Cleaning vs Under-Cleaning Trade-off

Both failure modes are safety-relevant:

**Under-cleaning:** Residual snow/rain/mist points are classified as "small obstacle" or inflate background clutter, raising false-positive rates. Un-deskewed motion smear creates ghost walls that corrupt localization and inflate apparent object size. Ghost points behind glass surfaces generate phantom obstacles in the static map.

**Over-cleaning:** Aggressive statistical filters remove sparse legitimate structure at long range — thin runway-edge light poles, airside fencing, cone delineators. Aggressive weather filters at low intensity thresholds can strip out personnel hi-vis vest returns or faint runway marking returns. Removing too much weakens localization observability (fewer scan-to-map correspondences).

Validation against labelled airside test clips is mandatory before any filter is deployed as safety evidence. Raw, filtered, and removed clouds must all be logged for post-hoc inspection.

### 1.3 Relationship to Segmentation Accuracy

A preprocessing study on long-range semantic segmentation ([arxiv 2405.10046](https://arxiv.org/html/2405.10046v1)) showed that 5 cm voxel downsampling with distance-aware resampling improves mIoU from 58.8 % to 64.6 % at 20–50 m and from 16.2 % to 25.4 % beyond 50 m, by redistributing the severe density imbalance in raw LiDAR data (default: ~74 % close / 22 % medium / 4 % far points). Conditioning is thus not merely a noise-removal step but a data-distribution shaping step that directly determines what the network learns and how well it generalises across range.

---

## 2. Artifact Taxonomy

| Artifact class | Examples | Primary symptom | Best first response |
|---|---|---|---|
| Isolated statistical outliers | Random invalid returns, edge speckle | Sparse points away from surfaces | SOR/ROR with diagnostics. |
| Weather particles | Snow, rain, dust, spray | Near-field false points, attenuation, low persistence | DROR/DSOR/SDOR/LIOR variants plus temporal checks. |
| Aerosol volume | Fog, steam, de-icing mist | Range collapse, volumetric backscatter | ODD degradation and radar-primary mode. |
| Reflective ghosts | Glass, wet ground, polished aircraft skin | Mirrored or behind-surface points | Reflective-surface reasoning, waveform/multi-return, map consistency. |
| Saturation/bloom | Retroreflective signs, vests, markings, direct sun | Inflated target, angular dropout, high intensity | Per-sector intensity and receiver health checks. |
| Sensor blockage | Dirt, glycol film, ice, bug splat | No-return sectors, depth-image holes | Autoware-style blockage diagnostics and cleaning. |
| Dynamic objects | Aircraft, tugs, carts, buses, people | Trails in accumulated maps, scan-to-map residuals | MOS, ERASOR, Removert, MapCleaner, 4dNDF. |
| Map staleness | Construction, moved stand equipment | Persistent disagreement with map | Change detection and map lifecycle workflow. |

---

## 3. Classical Outlier Filters

### 3.1 Statistical Outlier Removal (SOR)

**Mechanism.** For each point `p_i`, compute the mean distance `d_i` to its `k` nearest neighbours. Build a global distribution over all `d_i`: mean `μ` and standard deviation `σ`. A point is marked an outlier when:

```
d_i > μ + s_g · σ
```

where `s_g` is the user-supplied standard-deviation multiplier (the "std ratio"). The threshold is global and uniform across the entire cloud.

**Parameters.**
- `k` (nb_neighbors) — typical range 10–50; larger `k` smooths the statistic but increases KD-tree query cost.
- `s_g` (std_ratio) — typical 1.0–3.0; lower = more aggressive; 2.0 is the Open3D default.

**What it catches.** Isolated points far from any surface — instrument noise, dust flecks, very sparse sensor artefacts in free space.

**What it misses.** Dense noise clusters (e.g., snowflake swarms that are mutually close to each other), and range-dependent effects: at long range the inter-point spacing widens legitimately, so `d_i` grows naturally, causing the fixed threshold to pass distant noise and over-remove far legitimate structure.

**Implementations.**
- PCL: `pcl::StatisticalOutlierRemoval<PointT>` — `setMeanK(k)`, `setStddevMulThresh(s_g)`.
- Open3D: `pcd.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)` — returns `(cleaned_cloud, ind)`.

### 3.2 Radius Outlier Removal (ROR)

**Mechanism.** A point is an outlier when the number of neighbours within a sphere of radius `r` is fewer than threshold `n_min`:

```
|N(p_i, r)| < n_min  →  remove
```

Most implementations use a KD-tree for the neighbourhood query.

**Parameters.**
- `r` (radius) — must be tuned to the expected local point density.
- `n_min` (nb_points) — Open3D default example uses 16.

**What it catches.** Stray points with no local neighbourhood — good for sensor noise in otherwise dense regions.

**What it misses.** Same range-dependency problem as SOR: a legitimate sparse cluster at 80 m can have fewer than `n_min` neighbours even at a sensible radius if the voxel spacing is large. ROR is brittle under non-uniform density unless the radius is scaled with range.

**Implementations.**
- PCL: `pcl::RadiusOutlierRemoval<PointT>` — `setRadiusSearch(r)`, `setMinNeighborsInRadius(n_min)`.
- Open3D: `pcd.remove_radius_outlier(nb_points=16, radius=0.05)`.

**Comparison note.** An empirical comparison in a multi-scan urban study found ROR precision (71.5 %) higher than SOR in isolation, but DSOR outperformed both on recall for falling snow ([DSOR paper](https://arxiv.org/abs/2109.07078)).

### 3.3 When to Use SOR vs ROR

Use SOR when the cloud density is reasonably uniform and the goal is catching globally isolated points. Use ROR when the noise is spatially clustered in otherwise dense regions and a density-based criterion is more interpretable. For adversarial-weather scenarios (§4), neither SOR nor ROR is the primary method — use the range-adaptive variants described below, with SOR/ROR as a post-pass clean-up at conservative parameters (k=20, s_g=2.5).

See also: [Classical LiDAR Outlier Removal](../methods/classical-lidar-outlier-removal.md).

---

## 4. Adverse-Weather Artifact Removal

### 4.1 The Problem

Falling snow, rain, fog, and spray (including de-icing mist on airport aprons) create high-density spurious returns between the sensor and real targets. Snowflakes return short-range, low-intensity pulses; rain droplets produce very short-range, moderate-intensity hits; fog returns diffuse near-range scatter; vehicle wheel-spray and de-icing fluid mist both produce spatially extended low-intensity hazes. On airside, jet-blast can carry fine ice crystals and de-icing propylene glycol mist across ground-vehicle sensor cones.

Neither SOR nor ROR handles these scenarios well because weather particles often form mutual clusters — they are not isolated in the statistical sense, but their intensity and spatial distribution differ from hard-surface returns.

### 4.2 Classical Weather Filters

**DROR — Dynamic Radius Outlier Removal.**
Scales the search radius with range: `r(d) = α·d + β`. This compensates for the decreasing point density at distance. DROR achieves good performance in light snowfall but degrades in heavy snow or distant-scene scenarios where noise points form their own dense clusters.
- Precision 71.5 %, Recall 91.9 % on WADS ([DSOR paper](https://arxiv.org/abs/2109.07078)).
- Speed: ~0.3 Hz on a full 64-beam scan on a single CPU core — too slow for real-time ([LIORNet benchmark](https://arxiv.org/html/2603.19936v1)).

**DSOR — Dynamic Statistical Outlier Removal.**
Adapts the SOR standard-deviation multiplier as a function of range: `s_g(d) = a·d + b`. Coefficients `a, b` are fit to a reference dataset. Achieves recall 95.6 % vs DROR 91.9 %, precision 65.1 %, and runs 28 % faster than the prior SOTA at time of publication (2021). Dataset: WADS (3.6 billion labelled points, >7 GB).

**LIOR — Low-Intensity Outlier Removal (Park et al., 2020).**
Uses the physical observation that snowflakes have very low backscatter. Applies a fixed intensity threshold to flag snow candidates, then uses a Radius Inlier Saving (RIS) step to restore misclassified points near real surfaces. Precision ~82.7 %, Recall ~90.8 %; 4.8 Hz.

**D-LIOR — Dynamic LIOR.**
Replaces the fixed intensity threshold with a dynamically estimated one via regression over sampled snow data. ~3.2× faster and 11 % higher precision than LIOR; 8.7 Hz.

**DVIOR — Dynamic Vertical and Low-Intensity Outlier Removal.**
Extends D-LIOR with vertical height filtering: snow noise concentrates close to the sensor in the near-horizontal band. Combining height and intensity discrimination reduces false-positive removal.

**IDSOR — Intensity- and Distance-Aware SOR (2025).**
Most recent published classical approach. Models weather-induced returns as a Gamma distribution (k=2.15, θ=2.38 fitted from data). Per-point adaptive threshold:

```
T_IDSOR(p_i) = s · T_g · (1 − α_i · h_i)
```

where `α_i = ρ f_r(r_i) / (ρ f_r(r_i) + 1)` is a range-dependent outlier probability weight; `h_i = 1 − i_norm,i` is high for low-intensity (likely weather) points; `T_g` is the global SOR baseline. Near range: intensity dominates; far range: geometry dominates.
- Result: 91 % precision / 93 % recall, outperforming DSOR (83/93) and DROR (87/87) on WADS while preserving fine structure such as railway tracks.

### 4.3 Learned Desnowers

**WeatherNet (Heinzler et al., 2020).**
First CNN-based framework for adverse-weather LiDAR denoising. Operates on 2D spherical range images (range + intensity channels). Trained on synthetic + real data. Higher accuracy than classical methods but depends on paired clean-snowy data; limited generalisation across sensor types.

**LiSnowNet (2022).**
Multi-level wavelet CNN with a sparsity loss that allows self-supervised training (no point-wise labels required). Operates on range images. Precision 95.1 %, Recall 84.2 %; **201 Hz** — fastest of all reviewed methods. Good cross-dataset generalisation to CADC and WADS. Lower recall in heavy snowfall. Self-supervised training makes it a strong candidate for domains without existing weather labels, including airside.
- Method detail: [LiSnowNet](../methods/lisnownet.md).

**3D-OutDet (2023).**
Processes 3D point clouds directly, not range images. Novel convolution over nearest neighbours only, dramatically cutting memory. Vs a full-featured baseline: −99.92 % memory, −96.87 % FLOPs, −82.84 % inference time per cloud, at the cost of only −0.16 % mIoU on WADS. Suited for resource-constrained on-vehicle hardware (Jetson Orin class).
- Method detail: [3D-OutDet](../methods/3d-outdet.md).

**TripleMixer (2024).**
Three-branch mixer architecture:
1. Geometry Mixer (GMX) — K-NN voxel mixing capturing local shape context.
2. Frequency Mixer (FMX) — lifting wavelet on YZ/XZ/XY planes, separating high-frequency noise from low-frequency surface structure.
3. Channel Mixer (CMX) — reprojects 2D features back to 3D via group convolution.

- WADS (real snow): mIoU **90.73 %**, Recall 93.93 %, F1 95.13 %.
- Weather-KITTI (synthetic): avg mIoU **96.31 %** (snow/fog/rain) — +16.2 pp vs 4DenoiseNet.
- Weather-NuScenes: avg mIoU **97.21 %** — +15.2 pp vs 4DenoiseNet.
- Introduces Weather-KITTI (130K frames, 64-beam) and Weather-NuScenes (84K frames, 32-beam) synthetic datasets.
- Method detail: [TripleMixer](../methods/triplemixer.md).

**4DenoiseNet.**
Exploits spatiotemporal correlations across consecutive frames. mIoU 98.18 % but requires 3.53 GiB GPU memory and high latency — hard to deploy in real-time single-vehicle inference.

**DenoiseCP-Net (2025).**
Jointly performs denoising and 3D object detection in a shared sparse-conv backbone. Operates on voxel grids. Snow denoising accuracy 99.73 %, Rain 99.77 %, Dense Fog 99.87 %; reduces cooperative-perception bandwidth by up to 23.6 %. Not a standalone map-conditioning tool — primarily a V2X/cooperative-perception architecture.
- Method detail: [DenoiseCP-Net](../methods/denoisecp-net.md).

**LIORNet (2025, self-supervised).**
U-Net++ on 3D range-intensity-reflectivity images; no manual labels needed. Pseudo-label pipeline: (1) range-dependent intensity threshold; (2) near-zero-reflectivity snow flag; (3) edge-aware restoration; (4) density-based cluster exclusion. Five uncertainty-weighted loss terms. Recall **92.0 %**; precision 67.2 %; **43.5 Hz** — adequate for 20 Hz LiDAR in on-vehicle use.
- Method detail: [LIORNet](../methods/liornet.md).

### 4.4 Learned Desnower Comparison

| Method | Type | mIoU / Recall | Speed | Memory | Key limitation |
|---|---|---|---|---|---|
| DROR | Classical | Recall 91.9 % | ~0.3 Hz CPU | Low | Slow; heavy snow fails |
| DSOR | Classical | Recall 95.6 % | ~15 Hz CPU | Low | Precision 65.1 % |
| IDSOR | Classical | 91 % / 93 % | Moderate | Low | Gamma-dist assumption |
| WeatherNet | CNN (range img) | Better than classical | Moderate | Moderate | Needs paired data; sensor-specific |
| LiSnowNet | Wavelet CNN | 95.1 % / 84.2 % | **201 Hz GPU** | Low | Lower recall heavy snow |
| 3D-OutDet | 3D NN | ~WADS SOTA −0.16 pp | Fast (low mem) | **−99.9 %** | No temporal context |
| TripleMixer | 3-branch mixer | **90.73 % mIoU WADS** | Moderate | Moderate | Newer; less field validation |
| 4DenoiseNet | Temporal NN | 98.18 % mIoU | Slow | 3.53 GiB | Not real-time |
| LIORNet | Self-sup U-Net++ | Recall 92.0 % | **43.5 Hz GPU** | Moderate | Precision 67.2 % |
| DenoiseCP-Net | Joint voxel NN | 99.7–99.9 % | Moderate | Moderate | V2X architecture; not standalone |

### 4.5 Airside Relevance

Airport apron conditions that introduce spurious points: (a) de-icing glycol/water mist from Type I/IV spray trucks; (b) jet-blast carrying fine ice/snow crystals; (c) exhaust condensation plumes; (d) dust on unpaved maintenance roads. DVIOR and IDSOR are the best classical options when labels are unavailable. LiSnowNet's self-supervised training and TripleMixer's real-world WADS accuracy make them candidates for fine-tuning on apron-collected data. *Uncertainty flag: no published benchmark specifically covers de-icing mist; the nearest analogy is wheel-spray noted in augmentation work as causing phantom-braking artefacts.*

Public adverse-weather datasets are screening proxies here, not direct airside evidence. SemanticSpray++, RADIATE, Seeing Through Fog/DENSE, REHEARSE-3D, DSERT-RoLL, CMHT, and LIDAROC can support stress-test design, radar-primary fallback, and sensor-cover contamination checks, but de-icing mist, glycol film, jet-blast dust, steam, wet-apron multipath, and retroreflector bloom still need target-airside clips or explicit ODD/degraded-mode exclusions.

---

## 5. Ghost Points, Multipath, and Specular Artifacts

### 5.1 Retroreflector Blooming

High-reflectivity targets (road signs, runway threshold markings, retroreflective safety tape, hi-vis vest tape) cause two distinct artefacts:

- **Saturation / pulse clipping.** Near-range high-reflectivity objects exceed the detector dynamic range; the peak is truncated, giving a systematically short range reading and smearing intensity. Multiple "phantom" points appear behind the true surface.
- **Blooming.** Far-range retroreflectors scatter enough energy to fire adjacent detector pixels; the point-cloud outline dilates outward, appearing larger than reality. This is documented in patents (US 11619725, US 12449548) and in RoboSense's defect analysis ([RoboSense tech blog](https://www.robosense.ai/en/tech-show-55)).

**Mitigation.** Adaptive attenuation (adjusting emission power or receiver gain for flagged high-intensity returns); deep learning estimation of the blooming boundary from synthetic training data ([LiDAR Blooming DL, 2024](https://www.researchgate.net/publication/387925721)).

**Hi-vis vests on airport aprons.** The retroreflective strips on airside PPE can momentarily saturate nearest-beams at <5 m, creating a small halo of spurious points around personnel. This is handled via intensity-capping in sensor firmware on some platforms; no dedicated public method exists specifically for the airside scenario. *Uncertainty: limited peer-reviewed literature; inference from general retroreflector saturation physics.*

### 5.2 Multipath and Ghost Points from Glass and Mirrors

When the laser hits a glass pane (terminal windows, aircraft windshields, hangar doors), part of the energy transmits, reflects off an object behind the glass, and returns through the glass — appearing as a "ghost" behind the glass at an incorrect depth.

**Ghost-FWL (2025).** Full-waveform LiDAR (FWL) captures the complete temporal echo profile, giving cues to distinguish genuine from spurious returns. Dataset: 24,000 frames, 10 scenes, 7.5 billion labelled peak annotations. FWL-MAE masked autoencoder for self-supervised feature extraction.
- SLAM trajectory error reduction: **66 %**.
- Object detection: **50× reduction** in false positives.

**GRASS (2025).** For standard (non-FWL) multi-return LiDARs: projects 3D points onto a 2D count map; detects pixels with double echoes (first return = glass, second = object behind); applies planar segmentation to identify glass panels; removes virtual (ghost) points in the mirror space behind the glass plane.

**Multi-echo transparent surface rule.** In multi-return scanners, a point with a last-return significantly behind a first-return on the same beam is likely on a semi-transparent or contour surface. The Householder-matrix reflection symmetry test (academic, TLS-oriented) can map ghost clusters to their specular mirror image to confirm them.

### 5.3 Specular Surfaces and Void Zones

Polished metal aircraft fuselages and wet apron pavement can act as specular reflectors at certain angles: the laser reflects away from the receiver, producing a void (missing data) or a multibounce return at an entirely wrong position. Detection via analysis of multibounce returns is described in the specular detection literature. In aggregated maps, voids from specular surfaces leave persistent holes; flagging them as "uncertain" in the semantic label is safer than interpolating across the void.

---

## 6. Motion Distortion and Deskewing

### 6.1 The Rolling-Shutter Effect in Spinning LiDAR

A mechanical spinning LiDAR (e.g., Velodyne VLP-32C, Ouster OS2) emits beams sequentially; at 10 Hz rotation, one full sweep spans 100 ms. If the platform moves at 1 m/s, the sensor translates 10 cm during the sweep, so the first and last beam-columns see the world from different positions. For static-map accumulation, this creates "double walls" and smeared curbs visible in accumulated clouds — visually similar to registration-error blur (§9.1) but distinct in origin.

### 6.2 Correction Formulation

For each point `p_i` with individual timestamp `t_i` within the sweep `[t_0, t_0+T]`, the corrected position in the reference frame at `t_0` is:

```
p_i_corrected = T(t_0 ← t_i) · p_i_sensor
```

where `T(t_0 ← t_i)` is the sensor pose at `t_i` relative to `t_0`, obtained by interpolating the continuous 6-DoF trajectory.

**IMU-based approach (most common).**
IMU provides high-frequency (≥200 Hz) angular velocity and linear acceleration. Preintegrated rotation `ΔR` and position `Δp` are computed from IMU data over `[t_0, t_i]`:

```
p_i_corrected = ΔR_{t_0}^{t_i} · p_i + Δp_{t_0}^{t_i}
```

DLIO (Direct LiDAR-Inertial Odometry, 2022) models the continuous trajectory analytically; state = {accel bias (3), gyro bias (3), initial velocity (3), gravity (2)} = 11 variables.

**Residual distortion (AC-LIO, 2024).** After coarse IMU deskewing, residual distortion remains because real motion does not perfectly follow the interpolated model. AC-LIO applies Rauch-Tung-Striebel smoothing to backpropagate refined trajectory corrections to each point iteratively.

**Timing accuracy.** Many LiDAR SDK packets include per-point or per-column timestamps (Ouster `timestamp` field, Velodyne `time` field in PCAP). Accurate time-sync between LiDAR and IMU (hardware trigger or PTP) is critical; even 1 ms error at 10°/s yaw rate causes ~0.17 mm error per point, but at 100°/s (aggressive manoeuvre) it becomes 1.7 mm.

### 6.3 Why Deskewing Matters Before Map Accumulation

In an aggregated map built from N scans, un-deskewed scans contribute smear artifacts that compound with each additional scan. The "double wall" artifact is one of the most visually obvious signs of inadequate deskew in accumulated maps. Ground segmentation and normal estimation both suffer from this smear. For airside GSE moving at up to 40 km/h (~11 m/s), the per-sweep distortion is ~110 mm — significant relative to the ~50 mm voxel sizes used in semantic segmentation preprocessing.

Deskewing must occur **before** scan-to-map registration, consistent with LIO-SAM, DLIO, and Autoware pipeline ordering.

---

## 7. Normal Estimation

### 7.1 Local PCA / Eigen-decomposition

For point `p_i`, collect the `k`-nearest neighbours `{p_j}`. Build the 3×3 covariance matrix:

```
C = (1/k) Σ_j (p_j − p̄)(p_j − p̄)ᵀ
```

where `p̄` is the centroid. Eigen-decompose `C` → eigenvalues `λ_0 ≤ λ_1 ≤ λ_2` and eigenvectors `e_0, e_1, e_2`. The normal is `n_i = e_0` (eigenvector of the smallest eigenvalue = direction of minimum variance = surface normal). Linearity `σ_L = (λ_2 − λ_1)/λ_2` and planarity `σ_P = (λ_1 − λ_0)/λ_2` descriptors characterise local geometry and are useful features in their own right.

### 7.2 K-Neighbourhood Selection

- **Fixed-k:** fast; misses scale variation. Typical k=10–30 for dense urban LiDAR.
- **Adaptive radius:** normalises for point density variation — important in aggregated maps where near/far density varies 10:1.
- **Multi-scale:** compute normals at several k values; select the most planar estimate (lowest `λ_0/λ_2`).

**Orientation consistency.** PCA normals are unsigned (±). Orient them consistently by propagating the sign along a minimum spanning tree (Hoppe et al. classic approach), or by enforcing that all normals point toward the sensor origin (reliable for single-scan; less reliable in accumulated maps where the sensor origin varies). PCL's `pcl::NormalEstimationOMP` supports sensor-origin orientation.

### 7.3 Edge and Irregular Points

Urban and airside environments contain trees, fencing, and equipment with irregular geometry. PCA normals on edge points or tree returns are unreliable (high `λ_0`). Octree-guided multi-scale detection can reject irregular-object neighbourhoods before normal computation, preserving normal quality on planar surfaces.

### 7.4 Normals as Segmentation Features

Normal vector `(n_x, n_y, n_z)` + curvature scalar are standard input features for PointNet++, RandLA-Net, and SPVCNN variants. A per-point feature vector `[x, y, z, intensity, n_x, n_y, n_z, curvature]` gives the segmenter both geometric context and orientation information. Incorporating normals has been shown to improve segmentation accuracy by ~2–4 % mIoU on structured outdoor clouds. The `σ_P` planarity descriptor is particularly useful for distinguishing paved surfaces from vegetation and metallic equipment.

---

## 8. Intensity and Reflectance Calibration

### 8.1 Range-and-Incidence-Angle Dependence

Raw LiDAR intensity `I_raw` depends on:

```
I_raw ∝ ρ · cos(θ) / r²
```

where `ρ` is the surface albedo (the discriminative feature), `θ` is the incidence angle (beam–surface normal angle), and `r` is the range. Without correction, the same painted taxiway line reads very different intensities at 5 m (near-perpendicular) vs 30 m (oblique). A physics-based correction for pulsed LiDARs that independently factors out range `r` and incidence angle `θ` demonstrated 70–92.7 % improvement in intensity consistency over r = 0.52–5.34 m, θ = 0–74°.

### 8.2 Correction Methods

**Range-only polynomial fit.** Fit `I_corr = I_raw · f(r)` where `f(r)` is a polynomial or exponential calibrated on a flat reference panel. Simple, fast, effective when incidence angle variation is limited.

**Oren-Nayar reflectance model.** Accounts for surface roughness; useful for geology/lithology classification where surface texture varies significantly.

**Fine-grained MLS correction (2024).** Mobile laser scanning captures thousands of angles and ranges automatically; fine-grained sample screening builds a dense (r, θ, I) lookup table. Eliminates the manual calibration stage. Applicable to airside MLS map collection runs.

**Generalised LiDAR intensity normalisation for lane markings.** Blinn-Phong model for angle correction + distance polynomial. After correction, lane-marking detection F1 improved significantly — directly applicable to airside pavement marking classification.

### 8.3 Why It Matters for Airside Segmentation

Airport pavement markings (holding position, runway edge, taxiway centreline, RESA) are painted retroreflective lines. Their raw intensity varies 3–5× depending on beam angle and range. After calibration, intensity becomes a stable discriminative feature that segmentation networks can rely on for paint-vs-asphalt classification — a crucial distinction for airside map labelling.

### 8.4 Reflectivity vs Raw Intensity

Some modern LiDARs (Ouster, Livox) output a separate calibrated **reflectivity** channel that approximates Lambertian surface albedo independently of range and incidence angle. Where available, prefer the reflectivity channel over raw intensity as a segmentation feature input. This is the pragmatic engineering shortcut when the hardware supports it. See also: [Point-Cloud Representations and Voxelization](../../../10-knowledge-base/geometry-3d/point-cloud-representations-voxelization-first-principles.md).

---

## 9. Downsampling and Resampling

### 9.1 Voxel-Grid Downsampling

Partition space into axis-aligned voxels of side `v`. Replace all points in each voxel with their centroid (or the closest actual point to the centroid). Result: approximately uniform spacing, O(N) with hash-grid, deterministic output. This is the standard offline pre-processing step before map-level segmentation.

**Voxel size selection.** For semantic segmentation of aggregated airside maps: 5 cm is the reference choice on SemanticKITTI (fine structure preserved); 10 cm on nuScenes (sparser raw data). The preprocessing study referenced in §1.3 showed that 5 cm voxels with distance-aware resampling significantly improves long-range mIoU, primarily by equalising the default density bias (74 % close / 22 % medium / 4 % far → redistributed to 50/40/10).

**Keep a back-index.** Store the original point index (or indices) for each voxel representative. This allows propagating voxel-level semantic labels back to the full-resolution cloud for downstream use (mesh texturing, fine inspection, safety evidence logging).

### 9.2 Farthest Point Sampling (FPS)

Iteratively selects the point farthest from the already-selected set. Maximises spatial coverage; commonly used as the set-abstraction layer in PointNet++. O(N·M) where M is the target count — infeasible above ~10⁵ points at inference time. Not recommended for full-resolution map preprocessing; use as a local sub-sampling within a model layer only.

### 9.3 Distance-Aware / Density-Aware Resampling

The core problem is that raw LiDAR density falls off as `~1/r²` with range, causing networks trained on naively downsampled maps to learn close-range-biased representations. Distance-aware approaches subdivide the range axis into bands (e.g., 0–20 m, 20–50 m, >50 m) and apply target point counts per band, oversampling the far-range voxels. This produces the 50/40/10 redistribution that drives the mIoU gains in §1.3.

Recent learned sampling methods (AVS-Net 2024, Hierarchical Adaptive Voxel-guided Sampling 2023) learn sampling distributions from data. These are model-internal operations rather than offline preprocessing steps and are not yet standard practice in production pipelines.

---

## 10. Ground Segmentation as a Conditioning Step

### 10.1 Purpose

Ground is the dominant plane in outdoor LiDAR maps. Separating ground from non-ground before running a segmentation network provides three benefits: (a) it reduces class imbalance (ground points are 40–70 % of a typical scan); (b) it simplifies the segmentation task for non-ground classes; (c) it supplies a reference elevation plane for height-above-ground features, which are strongly discriminative for class categories such as poles, vehicles, and personnel.

**Critically: ground segmentation here is a conditioning prior, not the final semantic label.** The segmenter still classifies ground-flagged points into pavement, grass, marking, concrete slab, etc. The ground flag is an input feature, not an output classification.

### 10.2 RANSAC Plane Fitting

Repeatedly sample 3 points, fit a plane, count inliers within distance threshold `δ` (typically 10–20 cm for outdoor). Terminate at a confidence threshold. Simple, no parameters to train. **Limitation:** assumes single-plane ground — fails on ramps, drainage slopes, and crowned surfaces. Multiple-region RANSAC (separate sectors) improves this at the cost of complexity.

### 10.3 Cloth Simulation Filter (CSF)

Simulates a virtual cloth draped over an inverted point cloud. The cloth settles to the ground surface. Points within a height threshold of the settled cloth = ground. Strong for complex terrain and LiDAR forestry (DTM extraction). Handles moderate slopes well but is slower than RANSAC — not real-time on large clouds.

### 10.4 Patchwork and Patchwork++

Concentric Zone Model (CZM) divides the scan into ring sectors. For each sector:
- **Reflected Noise Removal (RNR):** uses the LiDAR reflection model to discard virtual noise below the ground plane.
- **Region-wise Ground Fitting:** fits a plane per sector using incremental covariance estimation.
- **Adaptive Ground Likelihood Estimation (A-GLE):** uses historical statistics to adapt thresholds per sector.
- **Temporal Ground Revert (TGR):** restores misclassified ground points using temporal context.

- F1 **96.51 %** on SemanticKITTI; outperforms RANSAC, GPF, and original Patchwork.
- Real-time capable; adopted in Autoware and OpenPCDet.
- Patchwork++ is the de-facto ground segmenter in open-source AV stacks.

### 10.5 Airside Note

Airport taxiway and apron surfaces have very low slope but feature drainage crowns of 1–2 % and expansion joints every few metres. Patchwork++ handles these well via its ring-sector adaptive fitting. The apron also has painted markings that produce intensity outliers within the ground plane — these should not be excluded by the ground segmenter (they are genuine surface returns). Height-above-ground features derived from Patchwork++ output are particularly useful for distinguishing airside objects: chocks and cones are <0.5 m, belt loaders 1–2 m, aircraft 3–15 m.

---

## 11. Aggregated-Map-Specific Conditioning

The steps in §3–§10 apply to individual scans. When N scans are accumulated into a static map (the input to aggregated-map segmentation — see [Aggregated-Map Semantic Segmentation §9](aggregated-map-semantic-segmentation.md)), additional map-level conditioning is required.

### 11.1 Registration-Error Blur

When N scans are accumulated via SLAM or ICP registration, residual pose errors translate into spatial blur. A systematic 5 cm translation error across 100 scans can produce a "double wall" artifact (two parallel planes instead of one) or smeared curbs ~10 cm wide. This is visually similar to un-deskewed data but originates from scan-to-scan registration error rather than intra-scan motion.

**Detection.** Compute local planarity `σ_P` on a downsampled map; surfaces with `σ_P` below threshold but point-spread above expected sensor noise flag registration-error candidates.

**Mitigation.**
(a) Retroactively refine the pose graph via loop-closure — the root-cause fix, at SLAM level.
(b) Multi-pass ICP or NDT refinement per submap before accumulation.
(c) Outlier removal with a tighter radius threshold on the final accumulated map to prune stranded duplicate-wall points.
(d) Conservative SOR (k=50, s_g=1.5) to flag multi-modal distributions around planar surfaces.

See also: [LiDAR Map Cleaning and Dynamic Removal](../../localization-mapping/slam-methods/lidar-map-cleaning-dynamic-removal.md).

### 11.2 Multi-Pass Intensity Averaging

In an aggregated map where the same ground patch is visited by M scans from varying angles, averaging the intensity per voxel reduces incidence-angle noise (each beam angle samples a different incidence → the average converges toward the true albedo). Formally:

```
I_avg(v) = (1/M) Σ_m I_m(v)
```

For road and apron markings, this multi-scan averaging is more accurate than per-scan intensity correction alone because it samples across the full incidence angle distribution. Retain the per-hit intensity distribution variance per voxel as an uncertainty estimate — high variance flags either a poorly calibrated sensor or a high-gloss surface.

### 11.3 Normal Recomputation on the Map

Normals estimated per-scan are oriented toward each scan's sensor origin. In an accumulated map, sensor origins vary across scans, so per-scan normals are inconsistent. Recompute normals on the accumulated (downsampled) cloud using map-level PCA, then re-orient using viewpoint consistency: for each point, the nearest scan origin in the pose graph is used to orient the normal hemisphere. This gives globally consistent surface normals essential for both ground segmentation and segmentation network feature input.

### 11.4 Density Equalisation

Close-range areas receive more scan coverage and thus higher point density in the accumulated map; distant areas are underrepresented. The distance-aware voxel resampling from §9.3 is the standard fix. A 50/40/10 % split (close/medium/far) produces more balanced class distributions and prevents networks from over-fitting to close-range geometry.

### 11.5 Dynamic Object Removal from Maps

Dynamic objects (aircraft, GSE, personnel) must be stripped from the static map before it is used for semantic segmentation or localisation. The map otherwise contains trails of dynamic actors as spurious static structure. Methods: ERASOR (pseudo-occupancy), Removert (remove-then-revert), MapCleaner, 4dNDF. For airside maps built from busy operational shifts, multi-session consensus (keeping only points observed in ≥K sessions) is the most reliable approach to avoid promoting temporary parked equipment into the long-term map. See [LiDAR Map Cleaning and Dynamic Removal](../../localization-mapping/slam-methods/lidar-map-cleaning-dynamic-removal.md) for full coverage.

---

## 12. Technique Taxonomy

| Layer | Techniques | Output | Safety role |
|---|---|---|---|
| Input sanity | NaN removal, crop boxes, min/max range, vehicle-body masking | Valid raw cloud | Prevents impossible data from entering the stack. |
| Classical filtering | SOR, ROR, DROR, DSOR, LIOR, DDIOR, D-LIOR, IDSOR, DVIOR, SDOR, LIDSOR | Clean cloud plus removed cloud | Explainable baseline and weather control. |
| Learned denoising | LIORNet, LiSnowNet, TripleMixer, 3D-OutDet, WeatherNet, 4DenoiseNet | Per-point noise probability | Better complex weather handling, but needs validation and uncertainty. |
| Sensor health | Blockage, dust, sector coverage, intensity drift, max range | Degradation state | Drives cleaning, speed limiting, and ODD enforcement. |
| Ghost handling | Reflective plane detection, Ghost-FWL, GRASS, PCL ShadowPoints | Ghost mask | Prevents false objects and false map structure. |
| Motion correction | IMU deskew, DLIO, AC-LIO RTS smoothing | Temporally consistent scan | Required before registration and map accumulation. |
| Dynamic masks | LiDAR-MOS, 4DMOS, HeLiMOS-style MOS | Moving/static labels | Protects localization and maps from moving actors. |
| Static map cleaning | ERASOR, Removert, MapCleaner, ERASOR++, 4dNDF | Static map plus rejected dynamic layer | Creates long-term localization maps. |

---

## 13. Recommended Conditioning Pipeline

### 13.1 Stage Order (Single-Scan to Map)

```
[Per-scan, real-time]
1. Deskew (motion distortion correction via IMU / DLIO)
2. Adverse-weather filter (DROR/IDSOR/LiSnowNet per operating conditions)
3. Retroreflector / ghost-point removal (intensity cap + GRASS if glass surfaces present)

[Per-scan or per-registration]
4. Voxel-grid downsample at working resolution (5–10 cm)
5. SOR/ROR conservative pass (k=20, s_g=2.5) — catch residual stray points

[Map-level, offline]
6. Dynamic object removal (ERASOR / Removert / multi-session consensus)
7. Normal estimation on accumulated cloud
8. Ground segmentation (Patchwork++) — flag, do not remove
9. Registration-error blur detection and tighter local outlier removal
10. Multi-pass intensity averaging per voxel
11. Final density equalisation (distance-aware resampling 50/40/10)
12. Intensity calibration (range + incidence correction) if raw intensity used as feature

[Input to segmenter]
13. Assemble per-point feature vector: [x, y, z, I_cal, n_x, n_y, n_z, σ_P, h_ground_flag]
```

### 13.2 Indicative Cost Estimates (64-beam, ~120K pts/scan)

| Stage | Typical throughput | Notes |
|---|---|---|
| Deskew (IMU) | >100 Hz | KD-tree free; direct transform |
| DSOR | ~15 Hz | PCL KD-tree; Python slower |
| LiSnowNet | 201 Hz | GPU required |
| Voxel downsample | >100 Hz | Hash-grid O(N) |
| SOR (k=20) | 20–40 Hz | KD-tree query |
| Normal est. (OMP, k=30) | 5–20 Hz | Parallelised on CPU |
| Patchwork++ | ~25 Hz | Real-time on CPU |
| Map-level intensity avg. | Offline | One-time per map build |

### 13.3 Over-Cleaning vs Under-Cleaning

**Over-cleaning risks:**
- Aggressive SOR/ROR removes sparse legitimate structure at range (thin poles, fencing, runway edge lights).
- Aggressive weather filters strip runway markings or low-intensity personnel returns.
- Recommendation: validate recall on labelled airside test patches before deploying aggressive classical filters as safety evidence.

**Under-cleaning risks:**
- Residual snow/mist points mislead segmenters — classified as "small object" or inflate clutter class.
- Un-deskewed smear inflates apparent object size and creates ghost walls that degrade localisation.
- Ghost points behind glass (hangar doors, terminal glazing) create phantom obstacles in the semantic map.
- Dynamic actor trails corrupt the static map and cause false-positive detections during localisation.

### 13.4 Industry-Aligned Practice

Published pipelines (LIO-SAM, DLIO, Autoware) all perform deskew before registration. The preprocessing study ([arxiv 2405.10046](https://arxiv.org/html/2405.10046v1)) demonstrates statistically significant gains from distance-aware resampling before segmentation. Patchwork++ is the de-facto ground segmenter in open-source AV stacks (Autoware, OpenPCDet). Intensity calibration is less standardised — Ouster's reflectivity channel is the pragmatic shortcut where hardware supports it.

---

## 14. Deployment Decision Rules

| Situation | Recommended behavior | Avoid |
|---|---|---|
| Clear weather, healthy sensor | Light SOR/ROR and artifact diagnostics. | Aggressive weather filters that reduce useful map geometry. |
| Light snow or rain | Range-aware DROR/DSOR/SDOR plus intensity-aware checks. | Fixed global ROR/SOR thresholds as the only protection. |
| Heavy snow, fog, dust, or de-icing mist | Reduced speed, radar-primary perception, sensor health alerts. | Claiming LiDAR is clean because a denoiser returned a dense-looking cloud. |
| Wet apron or reflective terminal area | Ground-model and multipath diagnostics, camera/radar agreement. | Treating below-ground points as real obstacles or deleting all low returns. |
| Retroreflective apron markings | Intensity saturation checks and known-object geometry bounds. | Letting bloom enlarge object boxes or map features. |
| Static map build | Combine dynamic masks, ERASOR/Removert/MapCleaner, multi-session consensus. | Building a localisation map from a single busy operational shift. |
| FOD-sensitive map cleaning | Export low-height debris, chocks, cones, hoses, tools, stationary people, staged GSE, and unknown sparse clusters to hazard/review layers with raw evidence. | Letting a cleaner, semantic filter, or threshold silently delete a small/stationary hazard. |
| Runtime localisation | Downweight dynamic/artifact points but monitor static inlier count. | Removing so many points that scan matching becomes unobservable. |

---

## 15. Failure Modes

- False deletion of small real obstacles under aggressive weather filtering.
- False retention of coherent artifacts such as spray sheets, glass ghosts, or wet-surface mirrors.
- Intensity threshold transfer failure across sensor vendors or sensor covers.
- Removing dynamic objects from maps but accidentally eroding static ground, poles, gate equipment, and aircraft stand features.
- Cleaner-induced domain shift for detectors trained on raw clouds.
- ODD monitor blind spot: the filter removes many points but no one notices the sensor is no longer adequate for the vehicle speed.
- Map lifecycle error: temporary parked aircraft or GSE is promoted into the long-term static map.
- Un-deskewed scans accumulated into a map: double-wall and smear artifacts that look like registration errors but survive ICP refinement.
- Normal inconsistency in accumulated maps from using per-scan sensor-origin orientation rather than recomputing at map level.

---

## 16. Airside-Specific Validation Guidance

Airside validation needs target-domain clips and point labels. Include:

- Weather: heavy rain, snowfall, fog, dust, road spray, de-icing mist, steam, and glycol cover contamination.
- Reflective conditions: wet concrete, painted stand markings, retroreflective signs, cones, high-vis clothing, aircraft fuselage, terminal glass.
- Dynamic scenes: moving and parked aircraft, tugs, buses, belt loaders, dollies, fuel trucks, chocks, cones, and ground crew.
- Localisation stress: open apron, repeated gates, terminal-edge multipath, wet night operations, and GNSS-challenged areas.
- Map lifecycle: same stand across shifts, aircraft present/absent, construction, temporary barriers, and seasonal snow banks.

Minimum evidence package:
- Raw, filtered, and removed point clouds.
- Per-artifact confusion matrix.
- Detector and tracker before/after metrics.
- Localisation inlier, residual, and degeneracy metrics.
- Static map ghost rate and static preservation rate.
- Do-not-delete hazard retention, including raw and removed-layer provenance for any low-height or movable-static candidate.
- ODD transition logs showing speed reduction, radar-primary mode, cleaning, or controlled stop.

---

## Sources

- Open3D outlier removal: https://www.open3d.org/docs/latest/tutorial/Advanced/pointcloud_outlier_removal.html
- PCL filters: https://pointclouds.org/documentation/group__filters.html
- DSOR and WADS: https://arxiv.org/abs/2109.07078
- DDIOR: https://www.mdpi.com/2072-4292/14/6/1468
- DVIOR: https://www.mdpi.com/2079-9292/14/18/3662
- IDSOR: https://arxiv.org/html/2602.05876v1
- SDOR: https://www.nature.com/articles/s41598-026-38674-6
- LIORNet: https://arxiv.org/html/2603.19936v1
- TripleMixer: https://arxiv.org/html/2408.13802v1
- LiSnowNet: https://ar5iv.labs.arxiv.org/html/2211.10023
- 3D-OutDet: https://www.researchgate.net/publication/374762279
- DenoiseCP-Net: https://arxiv.org/html/2507.06976
- Ghost-FWL: https://arxiv.org/abs/2603.28224
- GRASS: https://www.mdpi.com/2072-4292/18/2/332
- WeatherNet: https://www.researchgate.net/publication/339153135
- ERASOR: https://arxiv.org/abs/2103.04316
- ERASOR repository: https://github.com/LimHyungTae/ERASOR
- Removert repository: https://github.com/gisbi-kim/removert
- 4dNDF: https://arxiv.org/abs/2405.03388
- 4dNDF repository: https://github.com/PRBonn/4dNDF
- HeLiMOS dataset: https://sites.google.com/view/helimos/dataset
- HeLiMOS toolbox: https://github.com/url-kaist/HeLiMOS-PointCloud-Toolbox
- Patchwork++ (arxiv): https://arxiv.org/pdf/2207.11919
- Patchwork++ (emergentmind): https://www.emergentmind.com/papers/2207.11919
- DLIO deskew: https://arxiv.org/pdf/2203.03749
- AC-LIO deskew: https://arxiv.org/html/2412.05873v3
- Normal estimation (urban): https://pmc.ncbi.nlm.nih.gov/articles/PMC6427512/
- Normals for segmentation: https://academic.oup.com/jcde/article/10/6/2332/7419878
- Intensity calibration (incidence+range): https://opg.optica.org/ao/abstract.cfm?uri=ao-63-10-A86
- Intensity normalisation for lane markings: https://www.mdpi.com/2072-4292/14/17/4393
- Fine-grained MLS intensity correction: https://www.techscience.com/cmc/v83n1/60131/html
- Preprocessing for long-range segmentation: https://arxiv.org/html/2405.10046v1
- CSF ground filter (GitHub): https://github.com/jianboqi/CSF
- RoboSense defect overview: https://www.robosense.ai/en/tech-show-55
- Multi-echo transparent/specular: https://researchgate.net/publication/319412162
- Multibounce specular detection: https://arxiv.org/pdf/2209.03336
- Map merging (registration error): https://renyunfan.cn/papers/2024ral_lamm.pdf
- Intensity-enhanced SLAM: https://www.oaepublish.com/articles/ces.2024.06
- Retroreflector blooming DL: https://www.researchgate.net/publication/387925721
- FAST radius outlier variant: https://www.mdpi.com/2306-5729/8/10/149
- Autoware blockage diagnostics: https://autowarefoundation.github.io/autoware_universe/pr-10077/sensing/autoware_pointcloud_preprocessor/docs/blockage-diag/
- FAA AC 150/5200-30D Airport Field Condition Assessments and Winter Operations Safety: https://www.faa.gov/airports/resources/advisory_circulars/index.cfm/go/document.current/documentNumber/150_5200-30
- FAA AC 150/5300-14D Design of Aircraft Deicing Facilities: https://www.faa.gov/airports/resources/advisory_circulars/index.cfm/go/document.current/documentNumber/150_5300-14
- LIDAROC LiDAR cover contamination dataset: https://zenodo.org/records/12800039
- SemanticSpray++ dataset: https://semantic-spray-dataset.github.io/
- RADIATE dataset documentation: https://pro.hw.ac.uk/radiate/doc/dataset/
- ISO 21448 SOTIF: https://www.iso.org/standard/77490.html
- Oren-Nayar reflectance model: https://www.sciencedirect.com/science/article/abs/pii/S0924271615002658
