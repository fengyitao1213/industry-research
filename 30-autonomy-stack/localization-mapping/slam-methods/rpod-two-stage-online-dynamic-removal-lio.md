# R-POD: Two-Stage Online Dynamic Removal LIO

<!-- method-priority:start
priority:
  learning: 4
  deployment: 5
  type: "method"
  stage: "deployment-pattern"
  maturity: "pilot-proven"
  tags: ["slam", "mapping", "validation", "runtime-localization", "outdoor"]
  reason: "R-POD Two-Stage Online Dynamic Removal LIO is rated for dynamic-object filtering and map-cleaning workflows that protect localization maps."
method-priority:end -->

Related docs: [ERASOR](erasor.md), [ERASOR++](erasor-plus-plus.md), [Removert](removert.md), [MapCleaner](mapcleaner.md), [DOF-LIO](dof-lio-lightweight-dynamic-object-filter.md), [Dynamic-Aware LIO BTSA](dynamic-aware-lio-btsa.md), [DO-Removal LIO](do-removal-lio.md), [TRLO](trlo-dynamic-tracking-removal-lidar-odometry.md), [FreeDOM](freedom-dynamic-object-removal.md), [DR-Remover](dr-remover.md), [LiDAR Map Cleaning — Dynamic Removal](lidar-map-cleaning-dynamic-removal.md), [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md), [FAST-LIO / FAST-LIO2](fast-lio-fast-lio2.md), [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [Point Cloud Registration Math](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md), [Point Cloud Representations and Voxelization](../../../10-knowledge-base/geometry-3d/point-cloud-representations-voxelization-first-principles.md).

**Last updated:** 2026-05-24

---

## Disambiguation

**RPOD / R-POD is not an acronym for the paper's title.** It is the name of the core descriptor introduced in the body of the paper: **Region-wise Pseudo Occupancy Descriptor**. The knowledge-base page is named after this descriptor abbreviation, following the same convention used for ERASOR (Egocentric Ratio of Pseudo Occupancy-based Dynamic Object Removal).

The canonical paper is:

| Field | Value |
|---|---|
| Full title | Online dynamic object removal for LiDAR-inertial SLAM via region-wise pseudo occupancy and two-stage scan-to-map optimization |
| Short page name | R-POD (after the Region-wise Pseudo Occupancy Descriptor) |
| Journal | Displays (Elsevier) |
| Volume / Article number | Vol. 88, article 103030 |
| Year | July 2025 |
| DOI | 10.1016/j.displa.2025.103030 |
| ScienceDirect | https://www.sciencedirect.com/science/article/abs/pii/S0141938225000678 |
| TUM FIS record | https://portal.fis.tum.de/en/publications/online-dynamic-object-removal-for-lidar-inertial-slam-via-region-/ |
| Semantic Scholar | https://www.semanticscholar.org/paper/Online-dynamic-object-removal-for-LiDAR-inertial-Yin-Sun/5981c4627cbca93237b5e9972f8b72c10b86dd2a |
| arXiv preprint | Not identified. No preprint was found. The paper appears to be a direct journal submission. |
| GitHub | Not publicly confirmed. No code repository link was found in any accessible source. Verify with authors before citing code availability. |

**Alternative interpretations the page name might have implied (resolved):**

- "Recursive Probabilistic Online Dynamic-removal" — does not match any known paper. Discard.
- A paper from a Chinese university group (CSU, ZJU, BUAA, HIT, NUDT) — the R-POD paper is from TUM and Tongji University, not those institutions. No confusion with a separate NUDT/HIT/ZJU paper was identified. If a second paper emerges using the acronym RPOD, naming must be disambiguated at that point.

---

## What It Is

R-POD is an **online LiDAR-inertial odometry (LIO) front-end** that removes dynamic-object points from each scan before they enter the growing map, producing a cleaner per-frame pose estimate alongside a dynamic-free incremental map from the first frame onward.

The paper was published in **Displays** (Elsevier), vol. 88, article 103030, July 2025, DOI 10.1016/j.displa.2025.103030. Displays is a general display and visualization journal with a broad scope — an unusual venue for a SLAM paper compared with IEEE RA-L or T-IM, which may limit community visibility.

### Authors and Affiliation

| Author | Affiliation |
|---|---|
| Huilin Yin | Chair of Human-Machine Communication, Technical University of Munich (TUM), Germany |
| Mina Sun | Technical University of Munich (TUM), Germany |
| Linchuan Zhang | Tongji University, Shanghai, China |
| Gerhard Rigoll | Chair of Human-Machine Communication, Technical University of Munich (TUM), Germany |

Gerhard Rigoll is a senior full professor at TUM with a long publication record in computer vision and human-machine interaction. The TUM-Tongji collaboration is consistent with established Germany-China academic exchange programs. Linchuan Zhang (DBLP record confirmed at Tongji) appears to be the primary technical contributor on the SLAM and point-cloud side.

---

## Core Technical Idea

### The Circular Dependency Problem

All online LIO dynamic-removal systems face the same circular dependency: detecting dynamic objects requires a reliable pose to compare the query scan against the local map, but dynamic objects in the scan contaminate the pose estimate used to build that comparison. The two dominant prior strategies handle this trade-off differently:

- **Remove first, then register (RF-LIO style).** Use a rough IMU-propagated initial pose to detect dynamic points, then run ICP/IEKF on the cleaned scan. If the initial pose is noisy — due to slow IMU, abrupt motion, or a scan dominated by large dynamic objects — the removal stage mislabels static points as dynamic or misses fast-moving objects. Removal quality depends heavily on the quality of the rough pose.
- **Register first, then remove (offline post-hoc).** Run full ICP without removal to get a good pose, then clean dynamic points from the accumulated map in a separate offline step (Removert, ERASOR, FreeDOM). This yields high removal quality but allows dynamic ghost trails to enter the live map before they are cleaned, and the method is not real-time capable.

### R-POD's Resolution: Two Explicit Stages

R-POD interleaves registration and removal in two explicit scan-to-map passes:

1. Run an **initial scan-to-map optimization** against the local map to get a better-than-IMU-only pose estimate. This estimate may still be biased by dynamic-point correspondences, but it is substantially better than the raw IMU prior.
2. Use that improved pose to construct a **volume of interest (VOI)** around the query frame, encode both the query scan and the local map slice into **R-POD descriptors**, and apply a **scan ratio test (SRT)** to identify dynamic regions.
3. Run a **second scan-to-map optimization** on the dynamic-point-cleaned query scan to refine the pose further.

The key insight is that the first-stage pose is good enough to align the R-POD descriptor bins reliably, even if some dynamic contamination remains. The second-stage registration over the cleaned scan then produces a more accurate final pose than either a remove-first or a register-first approach alone.

### The R-POD Descriptor

R-POD is a region-wise occupancy descriptor that encodes **height difference in the z-direction** within each spatial bin of a defined volume of interest. Conceptually it is a 2.5D structure: each bin captures whether a vertical column of space is occupied, and to what height extent. For bin (i, j):

```
delta_h(i, j) = max{ z_k : p_k in bin(i,j) }  -  min{ z_k : p_k in bin(i,j) }
```

This is computed separately for two descriptor sets:

- **Query R-POD**: from the current scan's points projected into the VOI bins using the Stage 1 pose.
- **Map R-POD**: from local-map points within the same VOI bins.

The "pseudo occupancy" qualifier is deliberate: this metric does not measure true 3D voxel occupancy. It approximates occupancy through the vertical footprint of points — a tall structure fills height; an empty bin or ground-only bin has near-zero delta_h. See [Point Cloud Representations and Voxelization](../../../10-knowledge-base/geometry-3d/point-cloud-representations-voxelization-first-principles.md) for the voxelization fundamentals underlying this representation.

**Why height span works.** A pushback tractor present during a previous survey contributes approximately 2–3 m of delta_h^M (tyres to cab roof). After it moves away, the query scan of the same bin sees only ground, giving delta_h^Q near zero. The scan ratio immediately reveals the discrepancy.

### Cartesian VOI vs ERASOR's Egocentric Radial Grid

This is a local adaptation of the ERASOR pseudo-occupancy concept with one key structural difference. Where ERASOR uses an **egocentric radial polar grid** (sector-ring bins centered on the robot), R-POD uses a **Cartesian VOI** that spans the local map region visible from the query frame. This means the descriptor is tied to the current scan's viewing geometry rather than a fixed polar grid. The practical effect is that bin alignment is more directly related to Cartesian registration error, which simplifies the Stage 1 pose quality requirement.

### Scan Ratio Test (SRT)

The SRT compares the query and map R-POD bin by bin:

```
scan_ratio(i, j) = delta_h^Q(i, j) / delta_h^M(i, j)
```

Bins where `scan_ratio(i, j) < tau_SR` (a tunable threshold) are flagged as containing dynamic objects. Points within flagged bins are masked before Stage 2 registration. Like ERASOR's SRT, the test is one-sided: only bins where the map has more occupancy than the query scan are flagged. If the query shows more occupancy than the map, no action is taken — this could be a new static object or a sensor artifact, and R-POD conservatively preserves it.

**Lineage note.** ERASOR (arXiv 2103.04316, RA-L 2021, KAIST) introduced the scan ratio test and R-GPF (Region-wise Ground Plane Fitting) as an offline map-cleaning pipeline. R-POD directly adapts the occupancy-comparison concept and the scan ratio test name to an online two-stage LIO context — the direct online successor of the ERASOR principle. See [ERASOR](erasor.md) for the founding descriptor mechanics.

---

## Operator Mechanics — Per-Scan Inner Loop

For each incoming LiDAR scan, R-POD executes the following steps:

1. **IMU propagation.** Pre-integrate IMU measurements to produce a motion prior for the new scan timestamp. This is the same bootstrapping used by FAST-LIO2 and LIO-SAM class systems.
2. **Deskew.** Apply IMU-based motion compensation to the raw scan to correct for sensor rotation during the sweep. See [Point Cloud Registration Math](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md) for the underpinning kinematics.
3. **Voxelize.** Downsample the deskewed scan to a uniform voxel grid for registration efficiency. Voxel resolution is a tunable parameter.
4. **Stage 1: Initial scan-to-map optimization.** Run an iterative IEKF (FAST-LIO2 style) or ICP step against the local voxel map. This gives a pose estimate that is better than IMU-only but may still be biased by dynamic objects in the scan.
5. **VOI definition.** Using the Stage 1 pose, define a 3D Cartesian volume of interest covering the region of overlap between the query scan and the local map.
6. **R-POD encoding (query).** Discretize the VOI into Cartesian bins. For each bin, compute delta_h of query-scan points within it. This forms the query R-POD.
7. **R-POD encoding (map).** Repeat for local-map points within the same VOI bins to form the map R-POD.
8. **Scan ratio test.** Compare query and map R-POD bin by bin. Bins where `scan_ratio < tau_SR` are marked as containing dynamic objects.
9. **Dynamic mask application.** Remove all query-scan points that fall in flagged bins from the scan.
10. **Stage 2: Second scan-to-map optimization.** Re-run the iterative optimization (IEKF or ICP) using only the cleaned (dynamic-masked) query scan against the local map. Produce the refined pose estimate.
11. **Map update.** Insert static points from the cleaned scan into the local voxel map. Publish pose estimate and map update.

**Timing budget.** Both scan-to-map stages plus the R-POD descriptor construction must complete within one scan period: 100 ms at 10 Hz LiDAR, 50 ms at 20 Hz. The R-POD computation sits between the two registration stages and adds a descriptor-building cost. Whether this combined pipeline fits within the embedded hardware budget is **not confirmed from open-access sources** (see Benchmarks).

---

## Inputs and Outputs

| Signal | Type | Role |
|---|---|---|
| LiDAR scan | Per-sweep 3D point cloud | Query for registration and R-POD encoding |
| IMU stream | High-rate inertial measurements | Motion prior, deskewing |
| Local voxel map | Accumulated static points | Reference for both scan-to-map stages and map R-POD |
| Volume of Interest (VOI) | 3D Cartesian bounding volume | Spatial scope for R-POD descriptor construction |
| Query R-POD | Height-coded Cartesian bin grid | Descriptor for the current scan |
| Map R-POD | Height-coded Cartesian bin grid | Descriptor for the local map within VOI |
| Dynamic mask | Per-bin binary flag set | Points excluded from Stage 2 registration |
| Refined pose | SE(3) transform | Per-scan odometry output |
| Cleaned scan | Filtered 3D point cloud | Used for map update; dynamic-free contribution |

---

## Architecture

```
LiDAR raw scan          IMU stream
       |                     |
       v                     v
  [Deskew + Voxelize] <-- [IMU pre-integration]
       |
       v
  [Stage 1: Initial scan-to-map optimization]
  (IEKF or ICP vs. local voxel map)
       |
       v
  [VOI definition]  <-- Stage 1 pose estimate
       |
       +-----> [R-POD encoding: query scan]  ---+
       |                                        |
       +-----> [R-POD encoding: local map]  ----+
                                                |
                                                v
                                    [Scan Ratio Test (SRT)]
                                    (bin-by-bin comparison)
                                                |
                                                v
                                     [Dynamic mask]
                                     (flag dynamic bins)
                                                |
                                                v
  [Masked query scan] (dynamic points removed)
       |
       v
  [Stage 2: Refined scan-to-map optimization]
  (IEKF or ICP vs. local voxel map, static points only)
       |
       v
  [Refined pose output + Local map update]
```

**Block count.** Five primary processing blocks: deskew/voxelize, Stage 1 registration, R-POD encoding + SRT, dynamic mask, Stage 2 registration — plus one map management block.

---

## Training

R-POD is **rule-based and learning-free.** There are no trained neural network components confirmed in any available source. All components are hand-engineered and deterministic:

- **R-POD descriptor:** deterministic height-difference binning within Cartesian VOI bins.
- **Scan ratio test:** threshold comparison of descriptor bins (tau_SR).
- **VOI definition:** geometric bounding volume derived from Stage 1 pose.
- **Both scan-to-map stages:** iterative numerical optimization (standard IEKF or ICP).

This means there is no GPU dependency at inference time, no training dataset required for the removal component, and no per-environment fine-tuning via gradient-based optimization. Parameters are design choices: VOI dimensions, bin resolution, scan ratio threshold, local map window size.

**Important flag.** The paper was not accessible full-text due to the Elsevier paywall. If any learned component (e.g., a learned bin threshold or learned SRT weighting) exists in the full paper, it is not confirmed from any open-access source. Treat the method as rule-based unless confirmed otherwise by obtaining and reading the full paper.

Operationally, the training-free design means R-POD is class-agnostic: any moving object that produces a detectable height-occupancy difference between query and map is flagged, regardless of class or shape. This is a key advantage over learned methods such as TRLO, which requires PointPillars inference and carries class-coverage limits (see Comparison Table below).

---

## Benchmarks

### Datasets Used

| Dataset | Type | Sensor | Dynamic Content |
|---|---|---|---|
| MulRan | Urban driving, Korea | Ouster OS1-64 | Heavy pedestrian and vehicle traffic |
| UrbanLoco | Urban driving, San Francisco and Hong Kong | Velodyne HDL-32E | Dense urban dynamic scenes |

**Note.** KITTI sequences were not mentioned as a benchmark dataset in any accessible source for R-POD. This differentiates it from most peers (TRLO, DOF-LIO, DO-Removal) which primarily benchmark on KITTI. The MulRan and UrbanLoco pair focuses on denser urban environments with more complex dynamic distributions than the highway-heavy KITTI sequences. See [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md) for the broader benchmark landscape.

### Quantitative Results — Verification Status

**IMPORTANT: All specific ATE RMSE, Precision, Recall, and F1 numbers reported in the paper are not confirmed from any open-access source.** The full paper is behind the Elsevier paywall and was not accessible for direct extraction. The following is the extent of what was found from the abstract and aggregator metadata:

- The paper "demonstrated good mapping results and accuracy across multiple sequences in both the MulRan and UrbanLoco datasets" (paraphrase from accessible abstract summary via Semantic Scholar, DBLP).
- The two-stage strategy is explicitly presented as more accurate than single-stage scan-to-map optimization in dynamic scenes.
- No specific numerical ATE RMSE or removal F1 values were recoverable without paywall access.

**[UNVERIFIED — acquire full paper to confirm]:** Reviewers of Displays submissions for SLAM papers typically require comparison against at least FAST-LIO2 (as a baseline with no dynamic removal) and at least one prior dynamic-removal method. The likely comparisons are FAST-LIO2 (no removal), a single-stage removal baseline, and possibly ERASOR-style or DO-Removal. Exact numbers unknown.

**Runtime.** Not confirmed from open-access sources. The two-stage approach doubles the number of scan-to-map optimization passes per cycle and adds the R-POD descriptor computation. For context: FAST-LIO2 alone runs well under 50 ms per scan on embedded hardware; ERASOR (offline) runs approximately 73 ms per scan iteration; DOF-LIO and TRLO run at or above 20 Hz. Whether R-POD's combined two-stage plus descriptor overhead remains under 100 ms per scan on typical embedded hardware is not confirmed and is the primary engineering risk for deployment on 10–20 Hz LiDAR systems.

### Context: Verified Numbers from Peer Methods

The following numbers from related papers are confirmed from open-access sources and are included to provide relative positioning. They are not R-POD numbers.

**ERASOR on SemanticKITTI (offline cleaner, arXiv 2103.04316, verified):**

| Sequence | PR (%) | RR (%) | F1 | Runtime |
|---|---|---|---|---|
| KITTI 00 | 93.98 | 97.08 | 0.955 | — |
| KITTI 01 | 91.49 | 95.38 | 0.934 | — |
| KITTI 02 | 87.73 | 97.01 | 0.921 | — |
| KITTI 05 | 88.73 | 98.26 | 0.933 | — |
| KITTI 07 | 90.62 | 99.27 | 0.948 | ~73 ms/iter |

**TRLO on KITTI and UrbanLoco (arXiv 2410.13240, verified):**

| Sequence | F1 | PR (%) | RR (%) |
|---|---|---|---|
| KITTI 00 | 0.956 | 96.46 | 94.72 |
| KITTI 05 | 0.909 | 92.45 | 89.32 |
| KITTI 07 | 0.908 | 91.70 | 91.85 |
| ATE (KITTI 07) | 0.92 m | — | — |
| Runtime | 24.28 ms/scan | — | — |

**DUFOMap on KITTI (arXiv 2403.01449, verified):**

| Method | KITTI 00 Absolute Accuracy |
|---|---|
| DUFOMap | 98.34% |
| ERASOR | 81.07% |
| Removert | 64.26% |
| DUFOMap runtime | ~62 ms/frame |

---

## Comparison Table: R-POD and Peer Methods

| Method | Paradigm | Online / Offline | Dynamic Detector | Learning | Runtime | Key Trade-off | Code |
|---|---|---|---|---|---|---|---|
| **R-POD (Displays 2025)** | Two-stage scan-to-map: register, R-POD filter, re-register | Online (LIO front-end) | R-POD descriptor + Scan Ratio Test | None | Unknown [unverified; paywall] | Two-stage overhead vs single-stage; class-agnostic; no code | Not confirmed |
| **Removert (IROS 2020)** | Offline map cleaner: multi-resolution range-image reversion | Offline | Per-ray range-image visibility vs map | None | ~831 ms/scan | High SA, low DA; slow; pose-sensitive | Public (irapkaist/removert; CC BY-NC-SA 4.0) |
| **ERASOR (RA-L 2021)** | Offline map cleaner: pseudo-occupancy radial grid + R-GPF | Offline | SRT + R-GPF ground fit | None | ~73 ms/iter | F1 0.92–0.96 on KITTI; flat-terrain assumption | Public (LimHyungTae/ERASOR) |
| **Dynablox (RA-L 2023)** | Online: TSDF-based ever-free volumetric detection | Online | Incremental free-space confidence | None | ~17 FPS | Strong on SemanticKITTI+HeLiMOS; TSDF memory cost | Public (ethz-asl/dynablox) |
| **DUFOMap (RA-L 2024)** | Online/offline void-space ray-casting | Both | Ray-cast void detection | None | ~62 ms/frame | High AA; near-tuning-free | Public (KTH-RPL/dufomap) |
| **DO-Removal (RA-L 2025)** | Online LIO: ground fit + region grow + cluster confidence | Online | Ground fit + region-growing + cluster scoring | None | Not confirmed | Single-scan spatial clustering; no prior map needed for seeding | Not confirmed |
| **DOF-LIO (T-IM 2026)** | Online LIO: visibility check vs ikd-Tree + voxel suppression | Online | Visibility-based range comparison + voxel clustering | None | Not confirmed (est. low) | Lightweight; no GPU; slow-mover weakness | Not confirmed |
| **TRLO (T-IM 2025)** | Online LO: detection + UKF tracking + removal | Online (no IMU required) | PointPillars + UKF tracking (speed threshold 1 m/s) | Yes (PointPillars) | 24.28 ms/scan (verified) | Class-coverage limits; GPU needed; strong benchmark numbers | Public (Yaepiii/TRLO) |
| **BTSA (RA-L 2025)** | Online LIO: 4D spatio-temporal normals in ICP | Online | Spatio-temporal normals + spatial consistency | None | ~49.69 ms/scan | Best slow-mover sensitivity; no prior pose needed; marginal at 20 Hz | Public (thisparticle/btsa) |

**Metric legend:** PR = Preservation Rate (static points kept, higher is better); RR = Rejection Rate (dynamic points removed, higher is better); F1 = harmonic mean of PR and RR; AA = Absolute Accuracy metric used by DUFOMap.

---

## Lineage

R-POD sits at the intersection of two lineages.

### Occupancy-Based Map Cleaning Lineage (Offline to Online)

```
ERASOR (RA-L 2021, KAIST)
  Egocentric radial pseudo-occupancy + R-GPF + SRT
  Offline map cleaner; O(1) per bin; ~73 ms/iter
      |
      | (adapt occupancy concept to online LIO context)
      | (move from egocentric polar grid to Cartesian VOI)
      | (embed descriptor comparison between two registration passes)
      v
R-POD (Displays 2025, TUM / Tongji)
  Region-wise pseudo-occupancy in VOI + two-stage scan-to-map
  Online LIO front-end; per-scan real-time operation
```

**Direct concept inheritance.** R-POD uses the same pseudo-occupancy height-difference binning principle as ERASOR. The scan ratio test (SRT) is directly named in both papers. R-POD extends ERASOR by making it online-compatible through two-stage registration scaffolding and by replacing the egocentric polar grid with a Cartesian VOI.

**Lateral extension.** ERASOR++ (arXiv 2403.05019) extends ERASOR with a Height Coding Descriptor (HCD) and bitwise height-layer encoding for improved offline map cleaning. ERASOR++ does not move to online LIO operation; it remains an offline post-hoc cleaner. See [ERASOR++](erasor-plus-plus.md).

### Two-Stage Registration Lineage

The pattern of inserting a dynamic-removal step between two scan-to-map registration passes appears in several systems:

- **RF-LIO (2022):** removal before registration using adaptive range-image differencing. One stage (remove first), not explicitly two-stage, but the ancestor of the insert-removal-into-LIO concept.
- **DO-Removal (RA-L 2025):** ground-fit region-growing removal inserted between initial detection and final registration. See [DO-Removal LIO](do-removal-lio.md).
- **BTSA (RA-L 2025):** 4D spatio-temporal normals embedded directly in the ICP objective without a prior pose estimate — a different resolution of the same circular dependency. See [Dynamic-Aware LIO BTSA](dynamic-aware-lio-btsa.md).

R-POD's distinctive contribution is the use of the occupancy-descriptor approach (from the ERASOR lineage) rather than range-image differencing (Removert lineage) or spatial clustering (DO-Removal lineage) as the removal mechanism inserted between the two passes.

---

## Strengths

**Extends a well-validated ERASOR descriptor to online operation.** The pseudo-occupancy height-difference binning has extensive empirical validation across SemanticKITTI, MulRan, and KTH benchmark datasets in the ERASOR and ERASOR++ papers. R-POD leverages this validated geometric intuition in a new online context rather than introducing an untested representation.

**Class-agnostic.** Any moving object that produces a detectable height-occupancy difference between the query scan and the local map is flagged, regardless of class or shape. There are no class-coverage limits of the type that constrain learned detectors like TRLO's PointPillars (which is trained on specific object classes). Novel dynamic objects — unusual GSE configurations, oversized vehicles, custom airside equipment — are handled without retraining.

**Two-stage registration converges better than single-stage in dynamic scenes.** When the initial pose is noisy due to IMU drift or a scan dominated by large dynamic objects, a single-stage remove-then-register approach can produce a degraded final pose because the removal mask was generated under a poor initial pose. The two-stage approach uses the first registration to get a better pose for the descriptor comparison, then uses the cleaner scan for the second registration. The ordering is architecturally more principled than either pure remove-first or pure register-first strategies.

**No GPU inference dependency.** The full pipeline — descriptor construction, SRT, both IEKF stages — runs on CPU-class embedded hardware. This is the same profile as DOF-LIO and BTSA and is directly relevant for embedded survey vehicles.

**Online operation prevents ghost accumulation.** Dynamic-object points are masked before entering the growing map, preventing ghost trail accumulation from the first frame. Offline cleaners (Removert, ERASOR, FreeDOM) allow ghosts to accumulate and then require a retrospective cleanup pass.

---

## Failure Modes

### Stage 1 Pose Error Propagates to Descriptor Alignment

If Stage 1 scan-to-map optimization is significantly corrupted by dynamic-point dominance — a scan taken while surrounded by a dense crowd or a large moving vehicle — the R-POD descriptors will be computed under a misaligned pose. Misaligned descriptors produce misaligned bin-to-bin comparisons in the SRT. This can cause static structure to be masked (false positive removals, few valid correspondences for Stage 2) or dynamic points to remain unmasked (false negatives, Stage 2 still partially contaminated). This is the **primary unresolved failure mode** shared with all two-stage approaches that depend on an initial pose estimate before removal.

### Slow-Moving Dynamic Objects

Objects moving at velocities close to the sensor sweep integration time may not appear as detectable occupancy differences between the query R-POD and the map R-POD. Slow vehicles, parking-lot trolleys, or baggage tugs decelerating to stop at approximately 0.5–1 m/s may leave residual dynamic ghost points in the map because their occupancy in the query scan closely matches their occupancy in the accumulated local map. This is the same slow-mover blind spot shared by DOF-LIO, Dynamic-LIO, and all single-pass visibility methods. BTSA (approximately 2-second temporal window) has superior slow-mover sensitivity.

### Small Dynamic Objects Below Bin Resolution

The region-wise binning operates at a fixed bin resolution. Small dynamic objects — pedestrians at range beyond 20 m, small drones, delivery robots — may not produce detectably different occupancy within a single bin. The bin resolution versus detection sensitivity trade-off is not confirmed from open-access sources; specific bin sizes used in the paper are behind the paywall.

### Local Map Ghost Contamination

If the local map has already accumulated dynamic-object ghost points — during map initialization in a busy scene, or when the removal filter briefly fails — the map R-POD for those regions will reflect those ghosts. Subsequent query scans comparing against a contaminated map R-POD may see reduced occupancy ratios in the flagged regions and incorrectly treat dynamic objects as static because both query and map show similar occupancy. Recovery from this state requires either a map reset or an offline cleaning pass.

### Stage 2 Latency Budget on Embedded Hardware

The two-stage approach requires two complete scan-to-map optimization passes per cycle plus the R-POD descriptor construction step. On compute-constrained embedded hardware (NVIDIA Jetson Orin) at 10–20 Hz LiDAR input, the combined latency may exceed one scan period. This is **not confirmed from any open-access source** and is the primary engineering risk for airside deployment on real-time survey vehicles.

### No Confirmed Public Code

Without a public implementation, the following are empirically unverifiable at this time: actual runtime on Orin or comparable embedded hardware; sensitivity to VOI dimension parameters; behavior at sequence transitions (initialization, loop closure, U-turns); compatibility with FAST-LIO2 or LIO-SAM backends. Reproduction requires either obtaining the full-text paper and re-implementing from description, or correspondence with the authors.

### Paywall-Limited Reproducibility

The full implementation details — exact VOI parameters, bin resolution settings, scan ratio threshold values, benchmark tables with specific ATE RMSE and PR/RR/F1 numbers — are in the Elsevier Displays paper. No public code is confirmed. Reproducibility requires institutional access to the DOI 10.1016/j.displa.2025.103030 record before production implementation can begin.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV — outdoor urban, high traffic | Strong candidate | MulRan and UrbanLoco are close to the intended operating regime. Dense dynamic content matches the paper's test conditions. |
| Road AV — highway | Good | Fewer dynamic objects; largest gains in dense-traffic cases. |
| Airside apron — actively moving GSE and tugs | Candidate | Class-agnostic; handles non-standard GSE without retraining. Large objects (pushback tractors, aircraft) produce clear bin-level occupancy differences. Validate VOI extent and tau_SR on apron-scale topology. Slow taxiing aircraft and tug maneuvers are in the slow-mover risk zone. |
| Airside apron — parked / staged GSE | Not suitable | Static-but-transient blind spot applies. Stationary transients are baked into the static map by R-POD and every online method. Use Stage 3 lifelong removal. See [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md). |
| Indoor warehouse | Moderate | Region-wise occupancy can help around forklifts and pallets; tune VOI for narrow aisles and shorter operating ranges. |
| Port / logistics yard | Conditional | Large fast movers (straddle carriers, cranes) produce strong signal. Slow movers and stationary equipment are the same blind spots as airside. |
| Mining / construction | Conditional | Large machinery produces clear range inconsistency. Irregular terrain does not degrade the descriptor directly (unlike ERASOR's R-GPF flat-terrain assumption). |
| Offline static map building | Supporting role (Stage 1) | Use as online front-end to reduce ghost-trail density before an offline cleaner pass with ERASOR++ or FreeDOM. Does not replace the offline stack. |

---

## Aggregated-Map Suitability

### Online Removal Before Ghosting

R-POD operates at the LIO front-end, meaning it removes dynamic-object points from each scan **before they are inserted into the growing map.** This is directly preferable for aggregated-map building compared to offline cleaners, which allow ghost trails to accumulate and then require a retrospective cleanup pass. For airside aggregated mapping — pushback tractors, baggage tugs, catering vehicles, aircraft on taxiways — an online dynamic-removal front-end allows the map to remain clean throughout the survey rather than requiring a separate offline post-processing stage.

### Airside-Specific Assessment

| Factor | Assessment |
|---|---|
| Object size | Pushback tractors and aircraft are large — likely detectable by R-POD region-wise bins at reasonable bin resolution. Pedestrians and small GSE at long range are a risk (see Failure Modes: Small Dynamic Objects). |
| Object velocity | Taxiing aircraft: very slow (2–5 km/h). Pushback tractors: 2–5 km/h. Both fall in the slow-mover risk zone; the scan ratio may not drop cleanly if the map R-POD already absorbed ghost content from early passes. |
| Scene density | Airside is typically sparse during controlled survey windows. Reduced dynamic density lowers Stage 1 corruption risk, making the two-stage approach more reliable than in a dense-traffic urban environment. |
| Parameter tuning | VOI extent and scan ratio threshold were validated on MulRan/UrbanLoco urban sequences. Airside apron topology (large open areas, longer sensor ranges, fewer vertical features) requires re-tuning. VOI extent of ±20 m used in urban settings may be too small for an apron; tau_SR may need adjustment for the different occupancy statistics of airport objects. |
| Sensor compatibility | R-POD expects LiDAR + IMU. Airside survey rigs typically use spinning LiDAR (VLP-32, Ouster OS1-64) + IMU. Compatible. |
| Local-map contamination | Calibration targets (cones, reflectors) placed during survey are static-but-transient; R-POD treats them as static and inserts them into the map. Separate offline tagging is required if they must be absent from the final map. |

### Recommended Layered Strategy for Airside Aggregated Mapping

```
Stage 1 — Online LIO front-end (per-frame, embedded compute)
  Candidate: R-POD [class-agnostic, no class-coverage gap, two-stage]
  Alternative: DOF-LIO [lightweight, geometry-only, confirmed low overhead]
  Alternative: BTSA [best slow-mover sensitivity, higher compute cost]
  Removes: actively moving GSE, vehicles, taxiing aircraft
  Residual: slow movers below tau_SR; static-but-transient (parked GSE, staged equipment)

Stage 2 — Offline cleaning (post-survey, cloud or workstation)
  ERASOR++ / FreeDOM / MapCleaner / DR-Remover
  Catches residual ghosts from Stage 1 slow-mover failures
  Achieves PR/RR F1 of 0.93–0.99 with full temporal evidence
  Cross-links: erasor-plus-plus.md, freedom-dynamic-object-removal.md,
               mapcleaner.md, dr-remover.md

Stage 3 — Lifelong static-but-transient removal
  LT-Mapper / Khronos / ELite / instance quarantine
  Removes objects stationary throughout the survey
  (parked GSE, boarding stairs, catering trucks, staged equipment)
  Mandatory for airside: the apron is dominated by stationary transients that
  neither R-POD nor any online or single-pass offline method can remove
  Cross-links: static-but-transient-point-removal.md

Stage 4 — Semantic map quality
  Segmentation on the cleaned static map for per-class annotation layers
  Cross-links: aggregated-map-semantic-segmentation.md
```

**Code availability is the current barrier.** R-POD is the right shape for the online layer — online operation, class-agnostic, two-stage for better pose/descriptor coupling — but the lack of public code means any deployment requires re-implementation from the paper description. DOF-LIO (while also lacking confirmed public code) has a more accessible family of open-source analogues (Dynamic-LIO at github.com/ZikangYuan/dynamic_lio). Obtain the full paper before committing engineering effort to R-POD reproduction.

---

## Implementation Notes

### Parameters to Version Control

| Parameter | Effect | Recommended Practice |
|---|---|---|
| VOI dimensions (x, y, z extent) | Larger VOI captures more context but increases descriptor computation cost | Start at ±20 m x, y and 0–5 m z for outdoor urban; tune per environment; consider larger for open airside aprons |
| Bin resolution | Coarser bins are faster but miss small objects; finer bins improve sensitivity but increase SRT cost | Ablate at 0.5 m, 1.0 m, 2.0 m; select based on minimum detectable object size |
| Scan ratio threshold (tau_SR) | Sensitivity/specificity trade-off for the SRT | Run an F1 sweep on a representative validation sequence; aim for F1 peak; ERASOR default is 0.2 |
| Local map window (N frames) | More frames give more stable map R-POD but risk slow-mover ghost accumulation | Use sliding window; tune window length to the dynamic density of the environment |
| IEKF tuning | Same as standard FAST-LIO2 | Use manufacturer IMU noise specifications as priors |

### Ablation Design for Validation

To isolate R-POD's contribution over single-stage alternatives:

- **Baseline A:** FAST-LIO2, no dynamic removal.
- **Baseline B:** FAST-LIO2 + single-stage R-POD filter before registration (remove-then-register, no Stage 2).
- **Baseline C:** FAST-LIO2 + single-stage R-POD filter after registration (register-then-remove, no second registration pass).
- **Full R-POD:** two-stage as described.

Report ATE RMSE, PR, RR, F1, and runtime per scan for each variant. The Baseline B vs Full R-POD comparison is the primary test of whether Stage 2 refinement adds measurable benefit. The Baseline A vs Baseline B comparison validates whether the descriptor removal itself helps.

### Integration Path

R-POD is conceptually straightforward to integrate into any FAST-LIO2-compatible system:

1. After the first ICP/IEKF update step, intercept the aligned scan.
2. Build VOI and R-POD descriptors (query and map) using the Stage 1 pose.
3. Apply the SRT mask to remove flagged bins.
4. Feed the cleaned scan back into the second ICP/IEKF update step.
5. Proceed with standard map update on the cleaned output.

If code is not publicly available (current status), the descriptor construction and SRT are implementable from the paper description using standard voxel-grid operations. The primary unknowns from the paper's accessible portions are the exact VOI parameterization and the scan ratio threshold values — both require full-text access or correspondence with the authors (Huilin Yin or Linchuan Zhang).

### Verify Paywall Record First

The full algorithm description, parameter values, and benchmark tables are in the Elsevier Displays paper (DOI 10.1016/j.displa.2025.103030). No public code is confirmed. Do not begin implementation without obtaining and reading the full paper via institutional Elsevier access. The TUM FIS record at the portal link in the Disambiguation section also provides contact information for the corresponding author.

### Use Dynamic-LIO or DOF-LIO as Open-Source Reference

While the R-POD implementation is unavailable, the FAST-LIO2-class IEKF backbone and the voxel-hash infrastructure can be prototyped using Dynamic-LIO (IROS 2025, github.com/ZikangYuan/dynamic_lio) or the DOF-LIO family structure. This allows the system integration and airside hardware validation to proceed while R-POD paper access is secured.

---

## Sources

| Item | Reference |
|---|---|
| R-POD paper (Elsevier Displays, paywall) | https://doi.org/10.1016/j.displa.2025.103030 |
| ScienceDirect abstract | https://www.sciencedirect.com/science/article/abs/pii/S0141938225000678 |
| TUM FIS publication record | https://portal.fis.tum.de/en/publications/online-dynamic-object-removal-for-lidar-inertial-slam-via-region-/ |
| Semantic Scholar record | https://www.semanticscholar.org/paper/Online-dynamic-object-removal-for-LiDAR-inertial-Yin-Sun/5981c4627cbca93237b5e9972f8b72c10b86dd2a |
| ERASOR (arXiv 2103.04316, RA-L 2021) | https://arxiv.org/abs/2103.04316 |
| ERASOR ar5iv HTML | https://ar5iv.labs.arxiv.org/html/2103.04316 |
| TRLO (arXiv 2410.13240 HTML) | https://arxiv.org/html/2410.13240v1 |
| DUFOMap (arXiv 2403.01449v2 HTML) | https://arxiv.org/html/2403.01449v2 |
| BTSA (arXiv 2510.22313) | https://arxiv.org/abs/2510.22313 |
| KTH DynamicMap Benchmark GitHub | https://github.com/KTH-RPL/DynamicMap_Benchmark |
| DO-Removal-LIO family brief | iter26-r2 (local) |
| DOF-LIO brief | iter29-r2 (local) |
| BTSA brief | iter27-r2 (local) |
| Removert brief | iter40-r1 (local) |

**Flags — not confirmed from open-access sources:**

- Full paper PDF (paywall): specific ATE RMSE and PR/RR/F1 numbers are unverified.
- GitHub URL: no public code repository found as of 2026-05-24.
- arXiv preprint: not found; no preprint appears to have been posted.
- Exact VOI dimensions and tau_SR values used in the paper benchmarks.
- Runtime per scan on embedded hardware.
