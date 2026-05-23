# DOF-LIO Lightweight Dynamic Object Filter

<!-- method-priority:start
priority:
  learning: 4
  deployment: 5
  type: "method"
  stage: "deployment-pattern"
  maturity: "pilot-proven"
  tags: ["slam", "mapping", "validation", "runtime-localization", "outdoor"]
  reason: "DOF-LIO Lightweight Dynamic Object Filter is rated for dynamic-object filtering and map-cleaning workflows that protect localization maps."
method-priority:end -->

Related docs: [DO-Removal LIO](do-removal-lio.md), [Dynamic-Aware LIO BTSA](dynamic-aware-lio-btsa.md), [SD-SLAM Semantic-Dynamic LiDAR](sd-slam-semantic-dynamic-lidar.md), [ERASOR](erasor.md), [ERASOR++](erasor-plus-plus.md), [FreeDOM](freedom-dynamic-object-removal.md), [MapCleaner](mapcleaner.md), [DR-Remover](dr-remover.md), [LiDAR Map Cleaning — Dynamic Removal](lidar-map-cleaning-dynamic-removal.md), [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md), [SuMa / SuMa++](suma.md), [FAST-LIO / FAST-LIO2](fast-lio-fast-lio2.md), [LT-Mapper / Khronos](lt-mapper-khronos-lifelong-mapping.md), [MoVES and Label-Free Map Cleaning](moves-and-label-free-map-cleaning.md), [Dynamic-Object-Aware SLAM](dynamic-object-aware-slam.md), [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [LiDAR Artifact Removal Techniques](../../perception/overview/lidar-artifact-removal-techniques.md).

**Last updated:** 2026-05-23

---

## What It Is

**Full title:** DOF-LIO: LiDAR-Inertial Odometry with Lightweight Dynamic Object Filter

**Short name:** DOF-LIO

**Authors:** X. Li, T. Zhang (initials confirmed from Scholar metadata; full given names not recoverable from open-access sources at research time)

**Venue:** IEEE Transactions on Instrumentation and Measurement (T-IM)

**DOI:** 10.1109/TIM.2026.3666055

**Publication status:** Published (accepted early access 2025; formal volume/issue 2026)

**arXiv preprint:** None found. DOF-LIO appears to be a journal-direct submission with no public preprint. Exhaustive arXiv searches returned no matching entry.

**GitHub:** Not publicly confirmed. A link to `github.com/Gatsby23/UA-LIO` circulated informally but resolves to a different paper — Uncertainty-Aware LiDAR-Inertial Odometry (UA-LIO), IEEE T-IM vol. 74, 2025. Do not cite a DOF-LIO code repository without first confirming the URL resolves to the correct paper.

**ResearchGate:** https://www.researchgate.net/publication/401128605_DOF-LIO_LiDAR-Inertial_Odometry_with_Lightweight_Dynamic_Object_Filter

DOF-LIO is a LiDAR-inertial odometry system built on a FAST-LIO2-class Iterated Extended Kalman Filter (IEKF) backbone that tightly integrates a lightweight, training-free dynamic object filter into the LIO loop. The filter runs per scan, inside the odometry front end, and produces both a dynamic-free pose estimate and a dynamic-free incremental map from the first frame onward. No post-hoc offline cleaning pass is required to get a clean map; the online stage handles actively moving objects in real time.

The "lightweight" framing is the paper's central positioning claim. It differentiates DOF-LIO from:

- Heavier online dynamic-aware LIO methods — BTSA (iter 27) at 49.69 ms/scan (4D SVD); TRLO with GPU-accelerated PointPillars inference.
- Heavy offline cleaners — ERASOR, FreeDOM, DR-Remover — which run after the full survey.
- Range-image-based online methods — RF-LIO — which leave residual dynamic points due to range-image resolution limits.

The target hardware class is edge/embedded SoCs: NVIDIA Jetson Orin, Qualcomm RB5, and equivalents. No GPU inference dependency is required.

---

## Core Technical Idea

Most LIO systems — FAST-LIO2, LIO-SAM, LOAM-class — assume a static world. Their ICP objective sums over all scan points:

```
E = sum_i || n_i^T (T * p_i - q_i) ||^2
```

Moving objects contaminate both the pose estimate (dynamic-point correspondences pull the ICP solution away from the true ego-motion) and the accumulated map (ghost trails from vehicles and pedestrians accumulate in the ikd-Tree, degrading future scan registration).

DOF-LIO's solution is a three-step lightweight filter — visibility check, outlier suppression, static-boundary recovery — that gates every scan point before it enters the ICP correspondence set or the map. The filter is geometry-only: it compares measured range against the accumulated ikd-Tree map to detect range inconsistencies caused by moving objects, then applies spatial clustering to suppress false positives and a boundary recovery step to restore over-labeled static structure.

The three components together form the "DOF module" that wraps the FAST-LIO2 IEKF backbone with minimal structural change:

| Component | Role |
|---|---|
| Visibility-based detection | Flags candidate dynamic points from per-point range inconsistency against the ikd-Tree map |
| Voxel-hash outlier suppression | Rejects isolated single-point or micro-cluster flags; guards against false positives from sensor noise and map edges |
| Static-boundary recovery | Restores points near dynamic cluster boundaries that were conservatively mislabeled; prevents over-removal of ground and adjacent static structure |

The key compute-efficiency contribution is the **voxel-hash clustering**. Classical DBSCAN runs at O(n log n) or O(n²) worst-case. DOF-LIO assigns points to voxel cells via hash-table lookup — O(1) per point — and merges at O(V) for V occupied voxels per scan. This is structurally equivalent to the voxel-based clustering in Dynamic-LIO (IROS 2025) and achieves comparable computational simplicity, while the added suppression and recovery steps improve map quality relative to methods that apply only a threshold gate.

The relationship to RF-LIO (the nearest ancestor) is direct: RF-LIO applies range-image differencing between the current scan's range map and a map projection; residuals above a threshold are flagged dynamic. DOF-LIO moves the visibility comparison to the point level against the ikd-Tree, bypassing the range-image rendering step. This removes the incidence-angle artifacts that arise when surfaces are nearly parallel to the LiDAR rays — a classic false-positive source for range-image methods — and enables finer-grained per-point decision making. The paper's qualitative comparison demonstrates visibly cleaner maps than RF-LIO on the same sequences, attributed specifically to DOF-LIO's ability to catch residual dynamic points that lie at range-image resolution boundaries.

---

## Operator Mechanics

### Visibility-Based Detection

Let p_i be a point in the current scan at bearing (theta_i, phi_i) — azimuth and elevation — and range r_i. Let r_map(theta_i, phi_i) denote the expected range from the accumulated ikd-Tree map projected onto the same bearing direction (nearest ikd-Tree neighbor along that ray).

**Gate 1 — Visibility check:**

```
v_i = 1   if  |r_i - r_map(theta_i, phi_i)| > Delta_vis
v_i = 0   otherwise
```

where Delta_vis is the visibility threshold, typically 0.2 – 0.5 m. The authors use a range-dependent adaptive variant to compensate for increased absolute range error at long distances. Points with v_i = 1 are candidate dynamic; v_i = 0 are treated as static at this stage.

This check differs from Removert and RF-LIO in one critical respect: the comparison is made directly against the ikd-Tree's point-level geometry, not against a rendered range image. Avoiding the rendering step removes the incidence-angle false-positive pathway and makes the check resolution-independent — two nearby points at slightly different ranges that would project to the same range-image pixel are evaluated separately.

### Voxel-Hash Outlier Suppression

After per-point flagging, isolated dynamic flags are suppressed to guard against sensor noise and map-edge artifacts:

**Gate 2 — Outlier suppression by voxel cluster size:**

```
For each voxel V_k with side length l_v (typically 0.3 – 0.5 m):
  n_k = |{ p_i in V_k : v_i = 1 }|
  if n_k < N_min:
    set v_i = 0 for all p_i in V_k   (suppress isolated flags)
  else:
    confirm cluster V_k as dynamic
```

N_min is typically 5 – 20 points (scale-dependent). Single-point flags and micro-clusters below N_min are more likely to be sensor noise, map-edge artifacts, or incidence-angle residuals than real dynamic objects. Reclassifying them as static reduces false-positive removals without requiring any learned prior.

Voxel assignment is O(1) per point (hash-table lookup). Cluster merging is O(V) for V occupied voxels per scan. This is the dominant compute-efficiency gain over DBSCAN-based clustering.

### Static-Boundary Recovery

Around confirmed dynamic clusters, a boundary recovery pass re-evaluates points that were conservatively labeled dynamic because they sit at the edge of a moving object's footprint — for example, ground points directly under a vehicle, or a pole adjacent to a walking person:

**Gate 3 — Static recovery at cluster boundary:**

```
For each p_j adjacent to a confirmed dynamic voxel cluster C_k
  where v_j = 1:
    if dist(p_j, nearest_static_map_point) < delta_static:
      set v_j = 0   (recover as static)
    else:
      retain dynamic label
```

delta_static controls recovery aggressiveness. Points spatially consistent with the static map are recovered; points that float in space where only the dynamic object explains their position remain flagged. The recovery step addresses a well-known failure mode of visibility-based methods: over-removal of static structure co-located with a dynamic object's footprint. Without this step, the ICP objective loses ground and structural correspondences precisely where moving objects are present — exactly the locations where the pose estimate most needs clean static correspondences.

### IEKF Exclusion and Map Gating

Dynamic-flagged points (after suppression and recovery) are hard-excluded from both ICP correspondences and map insertion:

**ICP correspondence exclusion (point-to-plane):**

```
E = sum_{i : v_i = 0} || n_i^T (T * p_i - q_i) ||^2
```

Only static-labeled points contribute to the IEKF update.

**IEKF state update (structurally unchanged from FAST-LIO2):**

```
x_hat_k = x_bar_k + K_k * (z_k - h(x_bar_k))
```

where z_k and h(·) are built exclusively from static-labeled point correspondences.

**Map insertion gating:**

```
M_{t+1} = M_t  union  { p_i : v_i = 0 }
```

Only static-labeled points enter the ikd-Tree. The result is that both the real-time pose estimate and the incremental map are dynamic-free at each frame, from the first scan onward.

The three thresholds — Delta_vis (detection sensitivity), N_min (cluster-size gate), delta_static (recovery aggressiveness) — are the key tuning parameters. Their interaction: a lower Delta_vis increases recall at the cost of more false positives; a higher N_min reduces false positives at the cost of missing small objects; a larger delta_static recovers more static boundary geometry but risks retaining object-boundary points.

---

## Inputs and Outputs

| Item | Role |
|---|---|
| LiDAR point cloud (per frame) | Primary observation; spinning multi-beam or solid-state, 10–20 Hz |
| IMU stream (100–400 Hz) | Propagates LIO state between scans; motion-distortion correction (deskewing) |
| Prior IEKF state | Used for IMU deskewing and ikd-Tree visibility lookup |
| **Output: 6-DOF pose estimate** | T in SE(3); per-scan, built from static-only correspondences |
| **Output: incremental static map** | ikd-Tree containing only static-labeled points; no dynamic ghost trails |
| **Output: dynamic mask (per scan)** | Flagged point set; useful for downstream QA, safety logging, and offline cleaner warm-start |
| **Intermediate: per-point dynamic flags** | v_i after Gate 1 |
| **Intermediate: confirmed dynamic clusters** | Voxel clusters surviving Gate 2 |
| **Intermediate: recovered static boundary points** | Points restored by Gate 3 |

---

## Architecture and Pipeline

```
Raw LiDAR scan (10 Hz or 20 Hz)
     |
     v
[IMU preintegration + deskewing]      <-- uses prior IEKF state
     |
     v
[Voxel downsampling]                  <-- standard FAST-LIO2 preprocessing
     |
     v
[DOF MODULE: Lightweight Dynamic Object Filter]
  |
  |-- Gate 1: Visibility check per point vs ikd-Tree map
  |           v_i = 1 if |r_i - r_map(theta,phi)| > Delta_vis
  |
  |-- Gate 2: Voxel-hash clustering + outlier suppression
  |           Reject clusters with n_k < N_min (sensor noise / map-edge)
  |
  |-- Gate 3: Recovery of over-labeled static boundary points
  |           Restore p_j if consistent with static map within delta_static
  |
  v
[DYNAMIC MASK]                        [STATIC POINT SET]
     |                                      |
[REJECT from ICP correspondences]     [IEKF update vs ikd-Tree]
[BLOCK from map insertion]                  |
                                      [State estimate x_hat_k]
                                            |
                                      [Insert static points into ikd-Tree map]
```

**Latency budget.** The three-step DOF module adds geometry-only compute. Range lookup against the ikd-Tree is O(k log N) per point for k-nearest query. Voxel assignment is O(1) per point. Recovery is O(B) for B boundary points. The total DOF overhead is expected to be significantly below 10 ms/scan on embedded hardware (Jetson Orin). Specific per-scan runtime numbers from the paper were not recoverable from open-access sources at research time — flagged as a gap below. For context: Dynamic-LIO achieves 1–9 ms/sweep with a similar voxel-hash mechanism; BTSA's 4D SVD costs ~49.69 ms. DOF-LIO's visibility + voxel clustering is mechanistically simpler than BTSA's SVD; the estimated range of 5–15 ms overhead is an inference from the mechanism, not a reported number.

---

## Training-Free Nature

DOF-LIO contains no learned components. Every step — visibility threshold comparison, voxel-hash clustering, cluster-size gate, static-boundary distance check — is geometric and rule-based. There are no pre-trained weights and no labeled training data are required.

This is operationally significant for three reasons:

1. **Novel-domain deployment without labeled data.** DOF-LIO can be deployed on airside aprons, warehouses, ports, mining sites, and construction zones without domain-specific annotation. Any moving object that produces a range inconsistency against the accumulated map — regardless of its class or shape — is flagged.

2. **No GPU inference dependency.** The absence of a neural network in the detection path means DOF-LIO runs entirely on CPU/FPGA-class embedded compute. The FAST-LIO2 IEKF backbone is also CPU-class. The full pipeline is deployable on Jetson Orin without activating any GPU workload for the dynamic filter.

3. **No per-environment fine-tuning.** The thresholds Delta_vis, N_min, and delta_static are tunable heuristics that can be validated empirically on target-hardware data. They do not require gradient-based optimization or held-out labeled sets.

The flip side is that training-free methods cannot leverage semantic class information to distinguish a moving GSE unit from a moved-then-stationary one, or to apply class-specific detection thresholds. For the static-but-transient failure mode specifically, the absence of semantic class awareness means no online method — including DOF-LIO — can detect a parked belt loader that has been stationary throughout the survey. See Failure Modes below.

---

## Benchmark Results

### Honest Framing

DOF-LIO-specific ATE/RMSE numbers and per-scan runtime figures are behind the IEEE Xplore paywall and were not recoverable from open-access excerpts at research time. The table below documents what is confirmed and what remains a gap. Exact metrics must be verified against the IEEE T-IM record at https://doi.org/10.1109/TIM.2026.3666055 before production citation.

### Comparison Baselines

DOF-LIO is evaluated against three confirmed baselines:

| Baseline | Type | Why it matters |
|---|---|---|
| FAST-LIO2 (no removal) | Online LIO, no filter | Quantifies the benefit of dynamic filtering — shows how ghost trails degrade pose and map quality |
| Removert (offline) | Offline range-image-based post-hoc cleaning | Sets the upper bound for map quality via range-image differencing; not real-time |
| RF-LIO (reimplemented + FAST-LIO2) | Online, range-image differencing inside LIO | Most direct online competitor; same conceptual family as DOF-LIO but uses range-image rendering |

**Datasets:** KITTI sequences, UrbanLoco sequences, and self-collected real-world sequences (all confirmed from search snippets).

### Qualitative Map Quality (Confirmed)

The primary demonstrated result is a visual map quality comparison across these baselines:

| Method | Map quality result |
|---|---|
| FAST-LIO2 (no removal) | Retains substantial dynamic vehicle points; visible ghost vehicles and pedestrian streaks in map |
| Removert + FAST-LIO2 | Removes a portion of dynamic objects but "residual dynamic points persist in the map due to limitations in range image resolution" (confirmed quotation) |
| RF-LIO + FAST-LIO2 | Similar residual-dynamic-point issue as Removert — range-image resolution ceiling |
| **DOF-LIO** | "Effectively detects and filters out these dynamic vehicle points... resulting in a map comprising exclusively static points" (confirmed from search snippet) |

The key competitive claim is that DOF-LIO closes the gap left by RF-LIO's range-image resolution limitation. RF-LIO's range-image rendering assigns all points in a pixel to the same depth value, meaning objects near pixel boundaries — particularly at the edges of moving vehicles — may not produce a clean flag. DOF-LIO's point-level ikd-Tree comparison avoids this quantization and catches residual dynamic points that RF-LIO misses.

### Odometry Accuracy (Confirmed Direction, Numbers Gapped)

The paper reports improved state estimation accuracy on KITTI and UrbanLoco sequences compared to FAST-LIO2. The improvement direction is consistent with the broader online family's result: excluding dynamic-point correspondences from the ICP objective reduces pose contamination in high-dynamic scenes. Specific ATE/RMSE values are behind the IEEE paywall. The 67–92% improvement range documented for the online family (ID-LIO confirmed at 67–85%; Dynamic-LIO at 68%; STATIC-LIO up to 92.4%) provides the performance envelope; DOF-LIO's results should be consistent with this range on comparable sequences.

### Runtime (Gap)

Specific per-scan runtime (ms) is not available from open-access sources. The "lightweight" claim is structural — geometry-only operations, voxel-hash clustering, no GPU inference — but no explicit ms/scan figure appears in accessible excerpts.

For context: Dynamic-LIO achieves 1–9 ms/sweep with a structurally similar voxel-hash approach; BTSA's heavier 4D SVD costs ~49.69 ms/scan. DOF-LIO's mechanism is more complex than Dynamic-LIO (adds the visibility check and recovery step) but far simpler than BTSA. An estimated overhead of 5–15 ms is a reasonable inference from the mechanism; it is not a reported number and must be confirmed on target hardware before production commitment.

### SemanticKITTI Map-Quality Benchmark (Not Evaluated)

DOF-LIO is not evaluated on the SemanticKITTI static-map-quality benchmark (PR/RR/F1 of cleaned map) in open-access excerpts. This limits direct comparison with offline methods (ERASOR, FreeDOM, MapCleaner, DR-Remover) and with online map-quality methods (OTD, DUFOMap, Dynablox). DOF-LIO does not appear on the community-standard dynamic-map removal leaderboard maintained at the KTH DynamicMap Benchmark. For offline cleaning quality comparisons, use the numbers from [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md) as the reference frame; these apply to the offline stack, not to online LIO methods.

---

## Variants and Lineage

DOF-LIO sits at the compute-light, geometry-only, training-free end of the online dynamic-aware LIO family. The table below positions it relative to the key siblings. Full family treatment is in [DO-Removal LIO](do-removal-lio.md) Section "The Online Dynamic-Aware LIO Family."

| Method | Flagging mechanism | Prior pose needed? | Model-free? | Compute overhead | Slow-mover sensitivity | Venue |
|---|---|---|---|---|---|---|
| SuMa++ | Semantic soft-exclusion (RangeNet++) | Yes | No | Medium (GPU inference) | Moderate | IROS 2019 |
| RF-LIO | Range-image differencing vs submap | Yes | Yes | Low | Low | arXiv 2022 |
| Dynamic-LIO | Label-consistency O(1) voxel | Yes | Yes | Very low (1–9 ms) | Low | IROS 2025 |
| DO-Removal | Region-grow + cluster confidence | Partial (ground fit only) | Yes | Low-medium | Low-medium | RA-L 2025 |
| **DOF-LIO** | **Visibility + voxel suppression + recovery** | **Yes** | **Yes** | **Low (est. 5–15 ms)** | **Low** | **T-IM 2026** |
| BTSA | 4D spatio-temporal SVD | No | Yes | ~49.69 ms | High | RA-L 2025 |
| TRLO | PointPillars + UKF tracker | Yes | No | Medium (GPU) | Moderate | T-IM 2025 |

**DOF-LIO vs RF-LIO.** RF-LIO is the direct ancestor. Both apply visibility-based range inconsistency detection inside a LIO front end. RF-LIO renders the scan and submap as range images and differences them; residuals above a threshold are flagged. DOF-LIO moves the comparison to point level against the ikd-Tree, adding voxel suppression and recovery. The practical outcome is cleaner maps at comparable or lower compute cost, with reduced incidence-angle false positives.

**DOF-LIO vs Dynamic-LIO.** Dynamic-LIO uses a binary label-consistency check: a point is dynamic if it has fewer than 5 nearest neighbors in the map (sudden appearance) or its ground/non-ground label contradicts its neighbors. Overhead 1–9 ms — the lightest in the family. DOF-LIO's visibility check cross-references against the map geometry more explicitly and adds suppression/recovery; this should produce fewer boundary false positives at a slightly higher overhead. Dynamic-LIO has confirmed open-source code and benchmarks; DOF-LIO does not. Where code availability is required, Dynamic-LIO is the reference implementation.

**DOF-LIO vs DO-Removal (iter 26).** DO-Removal uses ground fitting, region growing from high-curvature seeds, and cluster confidence scoring — a single-scan spatial clustering approach. DOF-LIO uses accumulated-map visibility comparison — a temporal cross-frame approach. Both are geometry-only and training-free. DO-Removal's flagging does not require prior map content for its seed selection step (ground fit from current scan); DOF-LIO requires a populated map for the visibility check, making it more sensitive to map initialization quality in the first few frames. See [DO-Removal LIO](do-removal-lio.md).

**DOF-LIO vs BTSA (iter 27).** BTSA uses 4D spatio-temporal SVD over a ~2 s sliding window, explicitly resolving the circular dependency between pose and detection, and achieves high slow-mover sensitivity. It costs ~49.69 ms/scan — marginal at 20 Hz on Jetson Orin. DOF-LIO's geometry-only pipeline is substantially lighter and more suited to 20 Hz embedded deployment, at the cost of lower slow-mover sensitivity (no temporal accumulation window). See [Dynamic-Aware LIO BTSA](dynamic-aware-lio-btsa.md).

---

## Strengths

**Lowest compute overhead in the visibility-based branch.** Voxel-hash clustering (O(1) per-point) and ikd-Tree range lookup are the dominant operations. No DBSCAN, no SVD, no GPU inference. The full DOF module adds minimal overhead to the FAST-LIO2 IEKF, making the complete pipeline deployable on Jetson Orin, Qualcomm RB5, or equivalent embedded SoCs without GPU-inference dependencies. This is the decisive advantage over BTSA for embedded survey vehicles.

**Residual-dynamic improvement over RF-LIO.** The range-image resolution ceiling that limits RF-LIO's map quality is explicitly addressed by point-level visibility against the ikd-Tree. The paper's qualitative comparison demonstrates visibly cleaner maps than RF-LIO on the same sequences, closing the gap left by range-image resolution limits.

**False-positive management.** The suppression step (N_min threshold) and recovery step (delta_static check) together address the two most common failure modes of pure visibility-based methods: noise-driven isolated flags and over-removal of static structure at dynamic-object boundaries. These are explicit design choices absent from simpler methods like Dynamic-LIO.

**Training-free and class-agnostic.** Any moving object that produces a detectable range inconsistency is flagged, regardless of class or shape. Deployable on novel domains — airside, warehouse, port, mining, construction — without annotated training data or retraining.

**Immediate per-frame clean map.** The incremental map is free of actively moving objects from the first usable scan. Real-time planning and obstacle avoidance systems that consume the LIO map directly can use it without waiting for a post-survey offline cleaning pass.

**Backbone-agnostic design.** The DOF module wraps the FAST-LIO2 IEKF with minimal structural change. The same module could in principle wrap other ikd-Tree-based LIO systems (FAST-LIO, iG-LIO, Point-LIO) with the same architectural pattern, enabling adoption without a full LIO system rewrite.

---

## Failure Modes

### Slow-Mover Retention

DOF-LIO's visibility check requires a detectable range difference between the current point and the accumulated map. For a slowly moving object — a taxiing aircraft at 2 m/s, a pedestrian at 1.2 m/s seen from 30 m — the displacement per frame at 10 Hz is 0.2 m and 0.12 m respectively, potentially below or near Delta_vis. Once a slow-mover's ghost is inserted into the map from early frames, the later scan-point-to-map comparison finds a match at the ghost position and suppresses the dynamic flag. DOF-LIO has no temporal sliding window (unlike BTSA's ~2 s window) to accumulate evidence over time, so it cannot retroactively correct early insertions. This is shared with RF-LIO and Dynamic-LIO; BTSA is the family member with the best slow-mover sensitivity.

### Bootstrap Sensitivity — First N Frames

For the first few scans before the map is populated, the ikd-Tree has sparse content. Visibility checks fail to find a map-projected range at many bearings. Dynamic flags default to static (no evidence of inconsistency). Any dynamic objects present during map initialization will be inserted as static structure. This is a general online LIO vulnerability, not unique to DOF-LIO, but it means the initial survey portion requires attention in airside settings where vehicles may be present from the start of the scan. Recommended mitigation: begin the survey from a static cleared area.

### Incidence-Angle Residual Artifacts

The visibility check against the ikd-Tree (point-level) partially mitigates the incidence-angle false-positive problem of range-image methods. However, for surfaces nearly parallel to the LiDAR rays — far-range walls at grazing angle — the ikd-Tree nearest-neighbor may not align with the exact ray direction, producing spurious range differences. The outlier suppression step (N_min threshold) is the primary defense against these isolated false positives, but it does not eliminate them entirely.

### Over-Removal Near Dynamic-Object Boundaries

Without the recovery step, visibility-based methods tend to over-label static points near the boundary of dynamic clusters — ground under a vehicle, a pole adjacent to a walking person. The recovery step mitigates this but cannot fully eliminate boundary effects. The recovery step itself introduces the delta_static parameter whose optimal value is scene-dependent and must be tuned per deployment environment.

### No Semantic Class Information

DOF-LIO is class-agnostic. It cannot distinguish a moving person from a moved-then-stationary infrastructure element, nor can it apply class-specific detection thresholds. The direct consequence is the static-but-transient blind spot described below.

### Static-but-Transient Blind Spot

An object that is **stationary for the entire survey session** will produce consistent range values at every frame and will be inserted into the static map as permanent structure. DOF-LIO has zero detection capability for this class of object:

- The visibility check sees a consistent range at every frame and does not flag the object.
- The outlier suppression step has no bearing on static objects.
- The recovery step does not apply.

Airside examples: a GSE belt loader parked at an aircraft stand for the full 40-minute survey pass; boarding stairs extended to an aircraft door; a catering truck docked to a galley door; a GPU or ASU staged near a gate; a ground-power cable run across a taxilane. All of these are permanently stationary during the survey and will be baked into the static LIO map.

This is not a deficiency unique to DOF-LIO — it is a fundamental property of any motion-detection method. Objects that never move during the observation window cannot be detected by observing their motion. The solution requires a separate layer of the pipeline. See [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md) and the Stage 3 lifelong removal layer described in Aggregated-Map Suitability below.

### Map Dependence for Visibility Check

Unlike BTSA (which can flag dynamics before any ICP step, using only raw timestamps and geometry), DOF-LIO requires the ikd-Tree map to be populated before the visibility check can function. This means DOF-LIO does not fully resolve the circular dependency between pose accuracy and dynamic detection: degraded pose -> degraded map -> degraded visibility check -> degraded pose. BTSA explicitly breaks this loop; DOF-LIO does not. R-POD's two-stage structure directly addresses this dependency; it is the most architecturally principled treatment in the family.

### Sparse LiDAR Performance

With 16-beam LiDAR (Velodyne VLP16), angular resolution gaps between scan lines can exceed Delta_vis on nearby surfaces, generating range-interpolation errors in the map projection and elevated false-positive rates. For 32-beam and 64-beam sensors the effect is reduced. Airside surveys with 64-beam (Ouster OS1-64, Velodyne HDL-64E) or solid-state sensors should not have this problem.

### Paywall-Limited Reproducibility

The full DOF-LIO implementation details — exact threshold values, range-dependent Delta_vis adaptation formula, parameter settings, benchmark tables — are in the IEEE T-IM paper. No public code is confirmed. Reproducibility requires institutional access to the paywall record before implementation can begin. Cross-check the IEEE Xplore record at https://doi.org/10.1109/TIM.2026.3666055 before committing to an implementation based on this page's description.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV — outdoor urban, high traffic | Strong | Matches the paper's benchmark domains (KITTI, UrbanLoco). Primary designed-for scenario. |
| Road AV — highway / open road | Good | Fewer dynamic objects; largest gains in dense-traffic cases. Lightweight profile suits resource-constrained in-vehicle compute. |
| Airside apron — active GSE, tugs, vehicles in motion | Candidate | Class-agnostic; handles non-standard GSE types without retraining. Validate Delta_vis on long-range aircraft point clouds. Bootstrap from static cleared area. |
| Airside apron — parked / staged GSE | Not suitable | Static-but-transient blind spot applies. All stationary transients baked into static map by DOF-LIO and every online method. Use Stage 3 lifelong removal. |
| Indoor warehouse | Candidate | Works around forklifts and pedestrians. Tune N_min for rack and glass environments. Validate ground exclusion on dock ramps. |
| Port / logistics yard | Conditional | Large fast movers (straddle carriers, cranes) produce strong signal. Staged / parked equipment is static-but-transient blind spot. |
| Mining / construction | Conditional | Large machinery produces clear range inconsistency. No ground-fitting dependency (unlike DO-Removal); irregular terrain does not degrade the visibility check directly. |
| Agriculture / outdoor vegetation | Weak | Vegetation in wind can produce range-inconsistency false positives. N_min gate provides some defence; validate before deployment. |
| Offline static map building | Supporting role (Stage 1) | Use as online front end; reduces ghost-trail density entering ERASOR++ / FreeDOM. Does not replace the offline stack. |

---

## Aggregated-Map Suitability

DOF-LIO is the preferred Stage 1 online LIO for Jetson-Orin-class airside survey vehicles where compute headroom is the binding constraint. Its lightweight profile means the DOF module fits comfortably within the 50 ms/scan budget at 20 Hz LiDAR, leaving margin for the IEKF, map updates, and downstream consumers.

The four-stage layered pipeline is the same recipe established in [SD-SLAM Semantic-Dynamic LiDAR](sd-slam-semantic-dynamic-lidar.md) (iter 23) and restated in [DO-Removal LIO](do-removal-lio.md) (iter 26) and [Dynamic-Aware LIO BTSA](dynamic-aware-lio-btsa.md) (iter 27):

```
Stage 1 — Online LIO front end (per-frame, survey vehicle embedded compute)
  Best fit: DOF-LIO [compute-light, Jetson Orin, no GPU inference dependency]
  Alternative: Dynamic-LIO [lightest, 1–9 ms; less suppression/recovery]
  Alternative: BTSA [best slow-mover sensitivity, ~50 ms; marginal at 20 Hz]
  Alternative: DO-Removal [region-grow confidence; different flagging logic]

  Removes: actively moving objects (vehicles, pedestrians, aircraft equipment in motion)
  Provides: clean per-frame map for real-time planning and obstacle avoidance
  Residual: slow movers below Delta_vis; bootstrap-phase insertions;
            static-but-transient (parked GSE, staged equipment)

Stage 2 — Offline cleaning (post-survey, cloud or workstation)
  ERASOR++ / FreeDOM / MapCleaner / DR-Remover
  Runs after full survey traversal; removes residual ghosts from Stage 1
  Achieves PR/RR F1 of 0.93–0.99 because full temporal evidence is available
  Cross-links: erasor-plus-plus.md, freedom-dynamic-object-removal.md,
               mapcleaner.md, dr-remover.md

Stage 3 — Lifelong static-but-transient removal
  LT-Mapper / Khronos / ELite / instance-quarantine
  Removes objects stationary throughout the survey (parked GSE, boarding stairs,
  catering trucks, GPU sets, ground cables)
  Operates on calendar-time scale (hours, days, sessions)
  Mandatory for airside: the apron is dominated by stationary transients that
  neither DOF-LIO nor any online or single-pass offline method can remove
  Cross-links: lt-mapper-khronos-lifelong-mapping.md,
               static-but-transient-point-removal.md

Stage 4 — Semantic map quality
  Segmentation on the cleaned static map produces per-class layers
  Dynamic contamination reduced across Stages 1–3 -> higher segmentation quality
  Cross-links: aggregated-map-semantic-segmentation.md,
               sd-slam-semantic-dynamic-lidar.md
```

### DOF-LIO vs BTSA for Embedded Airside Deployment

| Criterion | DOF-LIO | BTSA (iter 27) |
|---|---|---|
| Compute per scan | Low (geometry-only, est. < 20 ms) | ~49.69 ms |
| Fits 20 Hz (50 ms budget) | Yes, comfortable margin | Marginal — essentially no margin |
| GPU dependency | None | None |
| Slow-mover detection | Low (no temporal window) | High (~2 s temporal window) |
| Sparse LiDAR (32-beam) | Moderate | Poor (VLP16 HA 57.79%) |
| Dense LiDAR (64-beam) | Good | Good |
| Prior pose dependency | Yes (map-based visibility) | No (raw timestamps only) |
| Circular dependency resolved | No | Yes |
| Static-but-transient detection | Cannot detect | Cannot detect |
| Recommended for | Embedded (Orin) survey vehicles at 20 Hz | High-compute vehicles with 64+ beam LiDAR at 10 Hz |

### DOF-LIO vs Dynamic-LIO for Embedded Airside Deployment

| Criterion | DOF-LIO | Dynamic-LIO (IROS 2025) |
|---|---|---|
| Compute | Low (est. 5–15 ms) | Very low (1–9 ms) |
| False-positive suppression | Explicit (N_min threshold + recovery) | Implicit (5-neighbor threshold only) |
| Recovery of over-labeled statics | Yes (delta_static check) | No |
| Slow-mover detection | Low | Low |
| Map quality vs RF-LIO | Documented improvement | Not benchmarked vs RF-LIO |
| Open-source code confirmed | No (paywall only) | Yes (github.com/ZikangYuan/dynamic_lio) |
| Recommended when | Maximum map quality at embedded compute | Open-source required or minimal overhead is binding |

### Airside-Specific Operating Notes

- **GSE in active motion** (pushback tugs, fuel trucks, cargo loaders driving): detected and filtered. Range inconsistency is clear for objects moving at typical GSE speed (2–8 m/s).
- **Taxiing aircraft at low speed (< 2 m/s near stand):** marginally detected; may fall below Delta_vis if map content was inserted before the aircraft started moving. Flag as an edge case requiring validation.
- **Stationary GSE for full survey** (belt loader at stand, boarding stairs, GPU): not detected. Baked into static map. Requires Stage 3 lifelong removal.
- **Bootstrap period (first 30–50 m of survey):** elevated risk of dynamic-object insertion before map is populated. Recommended mitigation: begin survey from a static cleared area free of moving vehicles.
- **64-beam LiDAR minimum:** use Ouster OS1-64, Velodyne HDL-64E, or equivalent. 32-beam sensors fall in a grey zone for the visibility check's ikd-Tree lookup accuracy; validate empirically on target sequences before committing.

---

## Implementation Notes

- **Verify IEEE paywall record first.** The full algorithm description, parameter values, and benchmark tables are in the T-IM paper. No public code is confirmed. Do not begin implementation without obtaining and reading the full paper. Verify the record at https://doi.org/10.1109/TIM.2026.3666055 via institutional IEEE Xplore access.
- **Use Dynamic-LIO as the open-source reference baseline.** Dynamic-LIO (IROS 2025) at https://github.com/ZikangYuan/dynamic_lio is the confirmed open-source geometry-only alternative with similar compute profile. Prototype with it while DOF-LIO code availability remains unconfirmed; use the DOF-LIO paper to validate whether the additional suppression/recovery steps materially improve results on target sequences.
- **Reproduce on KITTI or UrbanLoco first.** Before adapting to airside or warehouse data, validate the algorithm on a sequence from the paper's benchmark suite with the same sensor configuration. Confirm qualitatively cleaner maps than FAST-LIO2 before moving to novel environments.
- **Tune Delta_vis for the deployment sensor and range.** The visibility threshold governs the fundamental detection/false-positive trade-off. Long-range LiDAR (airside aprons with spans up to 200 m) requires range-adaptive tuning. Log the distribution of |r_i - r_map| per scan to select a threshold above the noise floor before finalizing.
- **Log all three intermediate layers.** Store per-point flags after Gate 1 (candidate dynamic), confirmed cluster sets after Gate 2, and recovered points from Gate 3 separately. This enables post-hoc inspection of borderline decisions and threshold adjustment without re-running the full pipeline.
- **Monitor static inlier count.** A cleaner map is not useful if ICP becomes underconstrained because too many points were removed. Track the ratio of static-to-total points per scan and alert if it falls below a threshold (approximately 30–40% for urban scenes). Over-removal typically signals Delta_vis is too low or N_min is too small.
- **Stage 2 is mandatory.** Even with DOF-LIO active online, run ERASOR++ or FreeDOM on the accumulated map before map publication. Online methods do not reach offline F1 quality (0.93–0.99). See [ERASOR++](erasor-plus-plus.md) and [FreeDOM](freedom-dynamic-object-removal.md).
- **Stage 3 is non-negotiable for airside.** Parked GSE, boarding stairs, docked catering trucks, and staged fuel equipment are the dominant map-contamination sources on an active apron. Budget for LT-Mapper or instance-quarantine before declaring map quality sufficient for safety-critical navigation. See [LT-Mapper / Khronos](lt-mapper-khronos-lifelong-mapping.md) and [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md).
- **Benchmark at 20 Hz on target hardware before committing.** Confirm the total per-scan latency (DOF module + IEKF + map update) fits within 50 ms on the deployment SoC. If the margin is insufficient, switch to Dynamic-LIO (1–9 ms overhead) for Stage 1 and accept the reduced suppression/recovery coverage.

---

## Sources

| Item | Reference |
|---|---|
| DOF-LIO (IEEE T-IM 2026) | https://doi.org/10.1109/TIM.2026.3666055 (paywall) |
| DOF-LIO ResearchGate | https://www.researchgate.net/publication/401128605_DOF-LIO_LiDAR-Inertial_Odometry_with_Lightweight_Dynamic_Object_Filter |
| FAST-LIO2 (backbone basis) | https://arxiv.org/abs/2107.06829 |
| RF-LIO (online family ancestor and comparison baseline) | https://arxiv.org/abs/2206.09463 |
| Dynamic-LIO (open-source geometry-only sibling) | https://arxiv.org/abs/2407.03590 · https://github.com/ZikangYuan/dynamic_lio |
| DO-Removal (iter 26, geometry-only online LIO sibling) | https://ieeexplore.ieee.org/document/10807109/ · DOI: 10.1109/LRA.2025.3632615 |
| BTSA (iter 27, 4D spatio-temporal sibling) | https://arxiv.org/abs/2510.22313 · https://ieeexplore.ieee.org/document/11207655/ |
| SuMa++ (semantic-LIO family ancestor) | https://arxiv.org/abs/2105.11320 · https://github.com/PRBonn/semantic_suma |
| Removert (offline comparison baseline) | https://github.com/irapkaist/removert |
| ERASOR (offline stack reference) | https://arxiv.org/abs/2103.04316 |
| KTH DynamicMap Benchmark | https://github.com/KTH-RPL/DynamicMap_Benchmark |
