# Static-But-Transient Point Removal from Aggregated LiDAR Maps

**Last updated:** 2026-05-24

Classical dynamic-object removal methods — ERASOR, Removert, Dynablox, FreeDOM, [BeautyMap](../../localization-mapping/slam-methods/beautymap.md), and [Raymoval](../../localization-mapping/slam-methods/raymoval.md) — operate on intra-scan visibility or scan-to-map consistency evidence: a point is flagged dynamic when later evidence contradicts the voxel, column, or region that previously contained it. The static-but-transient problem is orthogonal: it targets points that did **not** move during a survey pass and therefore survive every classical filter, yet should never be baked into the permanent map because they are temporary over a longer timescale. Stationary maintenance crew, parked belt loaders, staged ground-support equipment (GSE), snow accumulation, construction barriers, and dropped foreign-object debris (FOD) all fall into this category. Solving it requires multi-pass temporal evidence or semantic class-aware filtering — signals that do not exist inside a single scan window. This makes static-but-transient removal a map-level problem, not a scan-level problem, and it sits at the intersection of lifelong SLAM, HD-map maintenance, and operational safety.

The problem has particular severity in airside LiDAR mapping because the permanent map serves a dual purpose that creates conflicting constraints: it is both the localization reference (where map completeness improves localization robustness) and the FOD-detection baseline (where map cleanliness is the safety requirement). Any transient object incorrectly baked into the permanent layer simultaneously weakens FOD detection and risks corrupting the auto-labeling pipeline that trains future perception models. The three-layer architecture (permanent / transient-candidate / FOD-candidate) described in this page is the minimum structure needed to resolve this tension without sacrificing either requirement.

> Deep-dive companion to [Aggregated-Map Semantic Segmentation](aggregated-map-semantic-segmentation.md) (§9 conditioning, §10 post-processing). See also the pre-processing sibling [LiDAR Artifact Removal Techniques](lidar-artifact-removal-techniques.md), the intra-scan dynamic-removal sibling [LiDAR Map Cleaning and Dynamic Removal](../../localization-mapping/slam-methods/lidar-map-cleaning-dynamic-removal.md), the map-history companion [Lifelong 3D Map Version Control](../../localization-mapping/slam-methods/lifelong-3d-map-version-control.md), the heterogeneous-map merging companion [Uni-Mapper Dynamic-Aware LiDAR Map Merging](../../localization-mapping/slam-methods/uni-mapper-dynamic-aware-lidar-map-merging.md), and the single-survey semantic branch [Potentially Dynamic Object Removal by Ground Projection](../../localization-mapping/slam-methods/potentially-dynamic-object-removal-ground-projection.md).

---

## Why This Problem Is Different

### The Intra-Scan Visibility Argument Fails

Classical methods operate on a common logical foundation. Within a single aggregation session, a point is treated as dynamic if a LiDAR ray subsequently confirms the voxel is empty — proving the occupant vacated the space. Methods differ in how they detect this free-space contradiction:

ERASOR uses an egocentric pseudo-occupancy ratio: if a sector's occupancy drops below a threshold relative to a ground reference scan, the sector is purged as dynamic ([arXiv 2103.04316](https://arxiv.org/abs/2103.04316)). FreeDOM estimates conservative free space and removes any scan point that lies in confirmed free space ([arXiv 2504.11073](https://arxiv.org/abs/2504.11073)). Dynablox incrementally builds free-space and detects any occupant that enters previously free space ([arXiv 2304.10049](https://arxiv.org/abs/2304.10049)). ERASOR++ refines pseudo-occupancy thresholding for higher precision ([arXiv 2403.05019](https://arxiv.org/abs/2403.05019)).

All of these depend on the same logical foundation: within the scan window, the LiDAR observes the object absent from a location it previously occupied, generating a free-space contradiction. A person standing motionless at a runway edge for the entire 30-minute survey pass, a belt loader parked in one spot for two hours, or a snow pile accumulating overnight — none of these generate a free-space violation within that scan window. They accumulate as dense, geometrically consistent clusters in the aggregated map. Every classical dynamic-removal method treats them as static structure and retains them in the permanent layer.

### Multi-Pass or Multi-Modal Evidence Is Required

Resolving the static-but-transient problem requires at least one of the following signals, neither of which is available to single-pass, scan-window methods:

1. **Multi-pass temporal evidence** — the same location is scanned on two or more separate surveys separated in calendar time; a cluster present in pass N but absent in pass M is classified transient.
2. **Single-pass semantic evidence** — the object's semantic class is a priori known to be non-permanent (person, vehicle, GSE, dropped debris), so it is filtered from the permanent layer regardless of how long it was stationary during the survey.

The practical consequence is that the pipeline architecture must grow beyond the classical scan-processing stack. Map management, multi-session alignment, and semantic classification become first-class pipeline components rather than optional post-processing steps.

---

## The Two Complementary Signals

### Temporal (Multi-Pass) Signal

Two surveys are taken at times t₁ and t₂, separated by hours, days, or seasons. The aggregated maps M₁ and M₂ are aligned and differenced. A cluster present in M₁ but absent from M₂ has changed state between surveys:

- Present in M₁, absent in M₂ → the object was removed (transient in M₁).
- Absent in M₁, present in M₂ → the object appeared (potentially transient in M₂, or new permanent infrastructure requiring promotion monitoring).

The multi-pass signal is geometrically reliable: it does not depend on any semantic labeler. Its weakness is latency (a minimum of two surveys is needed before any transient classification can occur) and the requirement that inter-session alignment is accurate enough not to generate false differences from pose error. In environments where alignment error is comparable to the size of the objects being classified (e.g., 5–10 cm alignment error vs. a 20 cm cone), false-difference rates become high without covariance-aware thresholding. GNSS-aided alignment at airports (RTK-GNSS at 2–5 cm absolute accuracy) substantially reduces this burden compared to road-AV environments where GNSS is less reliable.

### Semantic (Single-Pass, Class-Aware) Signal

Segment the aggregated map using a 3D semantic model (Cylinder3D, RangeFormer, SphereFormer, or similar) and project predicted class labels onto map voxels. Maintain a transient class list:

```
TRANSIENT_CLASSES = {
    person, cyclist, car, truck, van,
    GSE_cart, belt_loader, aircraft_steps, fuel_bowser,
    aircraft, construction_equipment,
    vegetation_deciduous, unknown_small_object, ...
}
```

Any voxel whose dominant predicted class is on this list is placed in the transient quarantine layer rather than the permanent layer. The semantic signal operates on a single survey without needing two passes. Its weakness is misclassification risk: a bollard mislabeled as a person, or a utility pole labeled unknown_small_object, produces a false-transient error (a hole in the permanent map). In sparse airside LiDAR returns at range, class confidence is often low. The semantic signal is therefore best treated as a prior that lowers the threshold for multi-pass confirmation rather than as a hard filter in isolation.

The two signals are complementary: semantics provides early quarantine before a second pass is available; temporal differencing provides high-confidence confirmation after multiple passes.

---

## Non-Road Urban District Transfer

Static-but-transient removal is not an airside-only corner case. It is the default map-governance problem for any **managed urban district** where the map is repeatedly used for localization, inspection, safety monitoring, and data labeling. The object classes change by domain, but the permanence problem is the same: something can be stationary during survey and still be invalid as permanent map truth.

| Domain | Stationary-but-transient examples | Permanent classes that must be protected | Policy implication |
|---|---|---|---|
| Airport apron | Parked aircraft, stationary crew, belt loaders, baggage carts, GPU carts, chocks, cones, temporary FOD bins | Stand markings, lights, drains, terminal facade, jet bridge anchor geometry, blast screens | Gate-zone overlays and class hard-exclusions are mandatory; aircraft and GSE never become permanent from one survey. |
| Port terminal | Parked tractors, containers in temporary stacks, chassis, reach stackers, crane spreaders, construction barriers | Curbs, crane rails, bollards, lane markings, fixed buildings, permanent container-slot markings | Container-stack persistence must be separated from infrastructure persistence; false loops on repeated containers need rejection. |
| Logistics yard | Trailers, pallets, temporary fences, parked yard trucks, workers | Dock doors, kerbs, signs, yard lane markings, fixed racks | Movable-static layer should be first-class because parked trailers may persist for days but still move. |
| Warehouse / indoor facility | Pallets, forklifts, lift tables, carts, stationary people, temporary stock | Walls, columns, racks, dock plates, safety lines, reflectors | GNSS is absent, so over-removal of localization landmarks is costly; use object-level persistence and fiducial/rack priors. |
| Campus / pedestrian district | Stationary people, benches under maintenance, event barriers, temporary signs, seasonal vegetation, parked scooters | Building facades, lamp posts, curbs, trees marked as stable landmarks, fixed furniture | Seasonal envelopes and event-calendar overlays matter more than road-style vehicle classes. |
| Construction / utility corridor | Machinery, trench shields, temporary fencing, spoil piles, cable drums, cones | Utility poles, cables, cabinets, permanent barriers, survey monuments | Positive/negative change review is as important as removal because true infrastructure changes are frequent. |

The cross-domain rule is: **do not encode operational convenience as permanence**. A parked object can be useful as a short-term obstacle observation, but if it is allowed into the permanent layer it will degrade future localization, hide FOD/hazards, and poison auto-labels. The [ML-related SLAM research scope](../../localization-mapping/overview/ml-related-slam-research-scope.md) routes this problem through learned dynamic evidence, semantic labels, lifelong map version control, and downstream segmentation QA.

### Research Questions for Learned Removal

The open research frontier is not simply "better dynamic segmentation." The needed capability is a learned or hybrid **permanence estimator** that predicts whether a cluster belongs in the permanent map, given geometry, class, time, operational zone, and multi-pass evidence.

| Research question | Practical test |
|---|---|
| Can a model learn permanence independent of motion? | Hold out stationary movable objects that never move within a survey but disappear in future passes. |
| Can semantic labels reduce false promotion without increasing false deletion? | Compare permanent thin-structure recall before and after semantic hard-exclusion policies. |
| Can cleaner disagreement predict review burden? | Measure whether ERASOR/FreeDOM/BeautyMap/Raymoval disagreement regions correlate with human corrections. |
| Can future absence be used without leaking evaluation labels? | Define time-ordered train/validation/test splits where future passes are allowed only for map governance, not model evaluation. |
| Can open-vocabulary labels propose new transient classes safely? | Route open-vocabulary candidates into review, then promote only to a closed versioned taxonomy. |

The desired output is a three-layer decision, not a binary mask:

```
permanent
transient-candidate
confirmed-transient
```

This preserves useful short-term observations while preventing unverified objects from entering the permanent map or the auto-labeling corpus.

---

## Method Families

The method families below span the full spectrum from geometry-only multi-pass differencing to semantic-class filtering to learned change detection. For an airside deployment, all families are typically combined in a single layered pipeline rather than used in isolation. The table below summarises the primary options before the per-family detail:

| Method family | Requires 2+ passes? | Requires semantic model? | Primary strength | Primary weakness |
|---|---|---|---|---|
| Multi-pass map differencing, map merging, and version control (LT-Mapper, ELite, Uni-Mapper, Lifelong 3D Map Version Control) | Yes | No | Geometry-reliable; reconstructable history; no class confusion | Latency; needs accurate alignment and diff governance |
| Lifelong SLAM (Khronos) | Yes | Partial | Handles moving + static-transient in one framework | Computationally heavy; research maturity |
| Semantic-aware filtering and detector-ground projection | No | Yes | Operates on single survey; catches parked/movable classes before a second pass exists | Misclassification risk; sparse returns at range; taxonomy must match the site |
| Probabilistic decay (OctoMap, K-of-N) | Partial (decay = no; K-of-N = yes) | No | Principled uncertainty; tunable timescale | Decay model choice is environment-specific |
| Per-object probabilistic (POCD) | Yes | Partial | Instance-level stationarity scores | Validated on warehouse only; not airside |
| Free-space update across passes | Yes | No | Highest geometric reliability | Needs accurate alignment; 3D ray-marching cost |
| Learned multi-pass models | Yes | Partial | Potential for end-to-end optimization | Does not yet exist for LiDAR transient-removal |

### Multi-Pass Map Differencing and Change Detection

**LT-Mapper (ICRA 2022)** — Kim et al. The canonical open-source framework for LiDAR lifelong mapping. Divides the problem into three sub-problems: (i) Multi-Session SLAM (LT-SLAM) aligns sessions without requiring a good initial pose; (ii) LT-Removert distinguishes high-dynamic changes (objects that moved within a session) from low-dynamic changes (objects present in session A but absent in session B); (iii) LT-Map manages positive changes (new permanent structure) and negative changes (removed permanent structure), maintaining a live map and a meta-map. Validated at year-level temporal gaps. ([arXiv 2107.07712](https://arxiv.org/abs/2107.07712))

> See [LT-Mapper and Khronos Lifelong Mapping](../../localization-mapping/slam-methods/lt-mapper-khronos-lifelong-mapping.md) for full method coverage.

**Lifelong 3D Map Version Control (RA-L 2024 / arXiv 2501.18110)** — Yang et al. Adds a cloud-native map lifecycle architecture around dynamic point removal, PCA-SHOT/NDT multi-session alignment, positive/negative change detection, and a base-map/diff/boundary store. It is especially relevant when the map product must reconstruct prior clean session maps or query changes between arbitrary sessions without keeping every raw session map online. ([arXiv 2501.18110](https://arxiv.org/abs/2501.18110); see [Lifelong 3D Map Version Control](../../localization-mapping/slam-methods/lifelong-3d-map-version-control.md))

**Uni-Mapper (IEEE T-IV 2025 / arXiv 2507.20538)** — Kang et al. Targets dynamic-aware heterogeneous LiDAR map merging. It is not a full static-but-transient policy, but its free-space dynamic filtering and DynaSTD loop retrieval prevent dynamic residuals from becoming inter-map loop evidence when maps are collected by different LiDAR types or rigs. Use it before lifecycle governance when a fleet merges handheld, robot-mounted, vehicle, or infrastructure LiDAR maps. ([arXiv 2507.20538](https://arxiv.org/abs/2507.20538); see [Uni-Mapper Dynamic-Aware LiDAR Map Merging](../../localization-mapping/slam-methods/uni-mapper-dynamic-aware-lidar-map-merging.md))

**ELite — Ephemerality meets LiDAR-based Lifelong Mapping (ICRA 2025)** — Gil, Lee, Kim, Kim. Current SOTA for LiDAR lifelong mapping. Introduces a two-stage ephemerality score ε ∈ [0, 1] where higher ε indicates greater transience. Local ephemerality εₗ is propagated within a single session via Bayesian ray-casting:

```
εₗ,new = f(x) · εₗ,prev / [f(x) · εₗ,prev + (1 − f(x)) · (1 − εₗ,prev)]
```

where f(x) is a distance-weighted occupancy/free-space function with parameters α = 0.5, β = 0.1. Global ephemerality εg accumulates across sessions. For coexisting points (seen in both sessions):

```
εg_t = [εg_{t-1} · εl_t] / [εg_{t-1} · εl_t + (1 − εg_{t-1}) · (1 − εl_t)]
```

For deleted points (absent in the new session), the local score is replaced by an objectness factor γᵢ = ρᵢ^(1/3) based on point density — a dense cluster is more likely a removed object than registration noise. ELite maintains three parallel maps: a lifelong map (full accumulation with εg scores), a static map (filtered subset where εg < τg), and a delta map (inter-session change map). The GICP alignment step weights points by (1 − εg,i) so permanent structures dominate registration. ([arXiv 2502.13452](https://arxiv.org/abs/2502.13452); [GitHub dongjae0107/ELite](https://github.com/dongjae0107/elite))

**City-Scale LiDAR Change Detection (2025)** — Subiaco dataset comparing 2023 vs. 2025 captures. Two-stage pipeline: multi-resolution NDT + point-to-plane ICP alignment → per-point detection confidence from registration covariance and surface roughness → semantic + instance segmentation → class-constrained bipartite assignment for split-merge cases → instance-level decisions integrating overlap, displacement, and volumetric difference. Achieves 95.3 % accuracy, 90.8 % mF1, 82.9 % mIoU across built structures and urban greenery. Tiled processing bounds memory for city-scale applications. ([arXiv 2510.21112](https://arxiv.org/abs/2510.21112))

**Long-Term Map Maintenance Pipeline (2020)** — Berrio et al. Validates across 18+ months of USyd campus data. Detects and removes transient features based on geometric relationships with vehicle pose across multiple passes; continuously updates the localization map by purging out-of-date features. ([arXiv 2008.12449](https://arxiv.org/abs/2008.12449))

> See also: [HD-Map Change Detection and Maintenance](../../localization-mapping/maps/hd-map-change-detection-maintenance.md) for the broader HD-map update context.

### Lifelong and Multi-Epoch Mapping

**Khronos (RSS 2024 Outstanding Systems Paper)** — MIT SPARKlab. Unified spatio-temporal metric-semantic SLAM with a two-process architecture. The fast process (active window δ) tracks short-term dynamics via incremental surface reconstruction and object fragment hypotheses — handles moving persons in real-time. The slow process (pose graph) reasons over long-term changes via deformable change detection: a library of rays from background vertices to robot viewpoints is maintained; when revisiting, the system checks whether fragment surfaces align with (presence), conflict with (absence), or occlude these rays. Object change timing is estimated via uniform probability between last-absence timestamp and first-observation timestamp. Handles permanent, slow-permanent, and dynamic objects in one framework. ([arXiv 2402.13817](https://arxiv.org/abs/2402.13817))

**POCD — Probabilistic Object-Level Change Detection (RSS 2022)** — University of Toronto. Specifically targets semi-static scenes (warehouse and industrial environments). Maintains a per-object probabilistic state combining a stationarity score and a TSDF change measure per object. Bayesian update rule incorporates both geometric and semantic information. Validated on warehouse and ToyCar datasets; outperforms SOTA on reconstruction quality of semi-static environments. The warehouse setting (pallets, forklifts) is structurally analogous to airside apron GSE staging. ([arXiv 2205.01202](https://arxiv.org/abs/2205.01202))

### Semantic-Aware Static-Map Filtering

The implementation order matters. The two canonical choices produce different trade-offs:

**Detector + ground projection (No More Potentially Dynamic Objects, 2024)**: run a LiDAR 3D detector on survey frames, remove or project the points inside movable-class object boxes to the local ground model, and then accumulate the conditioned frames into the static map. This is the single-survey counterpart to multi-pass differencing: it can quarantine a parked car, stationary worker, or staged GSE before the object ever generates free-space contradiction. The trade-off is detector/taxonomy dependence, so it must preserve rejected-object evidence and never serve as the sole FOD-clearance signal. ([arXiv 2407.01073](https://arxiv.org/abs/2407.01073); see [Potentially Dynamic Object Removal by Ground Projection](../../localization-mapping/slam-methods/potentially-dynamic-object-removal-ground-projection.md))

**Clean-then-segment**: run classical dynamic removal (ERASOR++/FreeDOM) on the raw aggregated cloud first, then segment the surviving points to build a semantic permanent map. Advantages: cleaner input to the segmenter; easier to train; less noise in class boundaries. Disadvantage: stationary-transient objects that survived classical removal are passed to the segmenter as clean structure — the segmenter must catch them.

**Segment-then-clean**: run 3D semantic segmentation on the full aggregated cloud; remove all voxels whose dominant class is on the transient class list. Advantages: operates on a single survey; fast. Disadvantage: map-level segmentation of sparse aggregated point clouds is harder than scan-level segmentation because spatial density varies widely.

**Three-class pipeline (recommended for airside)**: the full pipeline should maintain three classes at every point:

```
permanent | transient-candidate | confirmed-transient
```

A point graduates from permanent to confirmed-transient via either (a) multi-pass absence or (b) semantic class vote below a confidence threshold. This avoids collapsing the problem into a binary filter and preserves soft evidence for the localization stack.

The operational principle is evidenced in HD-map review papers ([arXiv 2409.09726](https://arxiv.org/abs/2409.09726)): semantic point cloud data is vectorized after denoising and clustering; results are matched with the prior HD map to confirm unchanged elements and flag changed ones. Semi-dynamic obstacles that were static during mapping but move during localization degrade relocalization if retained in the map — stated motivation for semantic-class filtering in A Chef's KISS ([arXiv 2504.02086](https://arxiv.org/abs/2504.02086)) and several autonomous-driving SLAM systems.

For MOS-based semantic signal inputs, see [LiDAR-MOS](../methods/lidar-mos.md), [SegNet4D](../methods/segnet4d.md), and [4DMOS](../methods/4dmos.md).

### Probabilistic and Occupancy-Grid Temporal Decay

**Time-aware OctoMap variants** maintain a log-odds occupancy value per voxel that decays exponentially when the voxel is not re-observed:

```
L(v_x, t) = L(v_x, t - dt) * exp(-lambda * dt) + z(v_x, t)
```

where λ is a decay constant (timescale ~hours to weeks depending on environment) and z(v_x, t) is the measurement update. A voxel with L(v_x, t) below threshold is pruned from the permanent layer. OHM (GPU-accelerated OctoMap variant) supports decay-rate models natively. The decay approach is appropriate when re-surveys are frequent (daily or multiple-per-day); for week-scale gaps the naive exponential is numerically unstable and a step-decay or binomial model is preferred.

**Bayesian persistence filter (K-of-N rule)**: a voxel is promoted to permanent status only if it has been observed occupied in at least K of the last N survey passes within a time window T:

```
P(permanent | v_x) = sum([v_x occupied in pass i] for i in last N passes) / N >= K/N
```

Typical starting parameters from road-AV practice (informal): K = 3, N = 5, T = 2 weeks. For airside apron GSE staging, where equipment patterns change shift-by-shift, K/N should be higher (≥ 4/5) and T should be shorter (24–72 hours). No published paper has formally characterized optimal (K, N, T) for airside environments; this remains an open parameter-selection problem.

### Re-Observation and Persistence Rules

If pass N+1 ray-casts cleanly through a cluster that pass N considered occupied — without any new object blocking the LiDAR — that is direct geometric evidence of absence. This is LT-Mapper's negative-change signal and ELite's deleted-point εg update. It requires accurate inter-session pose alignment (NDT + ICP, or GNSS-aided at the survey level) and is the most geometrically reliable signal because it does not depend on any semantic model.

For airside applications, the recommended starting parameters for the K-of-N persistence rule are:

| Zone | K | N | T |
|---|---|---|---|
| Apron GSE staging areas | 4 | 5 | 48 hours |
| Gate bounding boxes (aircraft) | 5 | 5 | 6 hours |
| Perimeter / taxiway edge | 3 | 5 | 7 days |
| Construction zones | 1 | 1 | 0 (always transient pending OPS annotation) |
| Ground-level unclassified small objects | 4 | 5 | 48 hours |

These are starting points. No published airside study has calibrated them empirically; operator field data should be used for refinement.

### Free-Space Update Across Passes

The cross-pass free-space check is the most geometrically reliable transient-detection signal. Any voxel in the permanent layer through which a subsequent survey casts clean rays (no intervening return) receives an absence vote. After a configurable number of absence votes within window T, the voxel is demoted to the transient layer. This mechanism requires no semantic model and is robust to class confusion, but does require accurate inter-session alignment.

The free-space check is implemented as a ray-marching pass over the new survey's scan lines. For each beam endpoint, the voxels traversed between the sensor origin and the endpoint are marked as observed-free in the new pass. Any voxel in the permanent layer that falls on a traversed-free ray in pass N+1 increments its absence counter. This is computationally similar to the map-update step in an OctoMap, and GPU-accelerated implementations (OHM) can process a full survey at batch speed. The primary parameter is the ray-diameter tolerance: too narrow misses borderline absence evidence from alignment-shifted beams; too wide generates false absence signals on wide permanent structures observed at oblique angles.

### Learned Multi-Pass and Restoration Models

No source-mature learned architecture for static-but-transient removal in LiDAR maps is ready to replace lifecycle, quarantine, and reviewer evidence as of May 2026. The closest analogues are:

**ELite's learned εg update**: supervised on multi-epoch LiDAR datasets; the objectness factor γ is computed from local geometry rather than learned end-to-end.

**ExelMap (ECCV 2024)**: element-level HD map change detection via insertion/deletion classification heads built on top of LaneSegNet. Evaluated on Argoverse 2 Map Change Dataset, specifically pedestrian crossings (infrastructure-level changes, not object-level transients). Demonstrates learned element-wise change detection that is more interpretable than pixel-level differencing. ([arXiv 2409.10178](https://arxiv.org/abs/2409.10178))

> See [ExelMap — Element-Based HD Map Change and Update](../../localization-mapping/maps/exelmap-element-based-hd-map-change-update.md).

**ArgoTweak (ICCV 2025)**: first dataset providing the triplet (prior map, current sensor data, ground-truth updated map) for realistic map-prior integration. Bijective mapping framework decomposes large-scale changes into atomic operations: geometry modifications, lane marking changes, type changes, connectivity changes, insertions, deletions. ([arXiv 2509.08764](https://arxiv.org/abs/2509.08764))

> See [ArgoTweak — Self-Updating HD Map Priors](../../localization-mapping/maps/argotweak-self-updating-hd-map-priors.md).

**Point Restoration Network (PRN, Engineering Applications of Artificial Intelligence 2025)**: transformer-based point restoration for filtering temporarily static objects and restoring occluded regions, with a CARLA-generated dataset pipeline. This is relevant as a research signal because it targets exactly the "object was static during mapping but should not stay in the map" failure mode. It is not yet a publication-gate-safe map-cleaning method in this corpus: public evidence is paper-level, road/simulation-oriented, and does not provide the operational audit trail needed for airside or managed-site map release. Treat PRN output as a candidate restoration proposal that must stay behind reviewer, K-of-N, raw/rejected-evidence, and do-not-delete hazard gates. ([ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0952197625022924); [DOI 10.1016/j.engappai.2025.112284](https://doi.org/10.1016/j.engappai.2025.112284))

A dedicated source-mature learned model taking a (prior_map, new_survey) pair and predicting release-ready transient voxels directly does not yet exist in public, reproducible form. This is a concrete research gap.

The closest cross-domain analogue at conceptual level is learned change detection in satellite and aerial imagery (e.g., ChangeFormer, BIT for remote sensing), where paired before-and-after images are processed jointly to produce a change mask. The adaptation challenge for LiDAR is that the representation is 3D and sparse rather than 2D and dense, inter-session pose differences are a confounding factor, and the change categories of interest (parked vehicle, GSE, person) are at very different spatial scales from satellite change detection use cases (buildings, construction, land use). Transferring this class of architectures to LiDAR lifelong mapping is an open problem.

---

## Sub-Categories of Static-But-Transient

### Stationary People

**Why it matters for airside**: maintenance crew, cleaning crew, marshallers standing beside a parked aircraft — all stationary during a survey pass. Zero tolerance for inclusion in the permanent map.

**Handling**: The primary mechanism is a hard semantic exclusion rule — class = person is on the hard-exclusion list with no K-of-N override. No person point ever enters the permanent layer. Secondary: ERASOR/FreeDOM handles people in motion; the semantic filter covers stationary persons. Airside crew wear high-vis vests; thermal/LWIR segmentation performs well here since a stationary person has a distinct thermal signature distinct from concrete even when LiDAR geometry is ambiguous (thin vertical return cluster).

**Safety note**: persons must simultaneously be detectable in the live perception model against the clean static map. If a standing person's points are baked into the permanent map, the runtime detector looking for "new points above ground" misses the live instance because it matches the map. Permanent-map exclusion is therefore safety-critical, not merely a map-quality concern.

### Parked Vehicles and GSE Between Passes

The most common airside case: belt loaders, baggage carts, dollies, fuel trucks, aircraft stairs trucks. Stationary for hours or days, then repositioned.

**Handling tier 1 — semantic filter**: class = car, truck, van, GSE → transient quarantine regardless of pass count. GSE-specific classes (belt loader, aircraft steps, baggage train) should be added to the segmenter's class vocabulary or mapped from a coarser class where confidence is sufficient.

**Handling tier 2 — K-of-N persistence**: if semantic confidence is low (LiDAR return from a cart at 60 m is sparse), apply the multi-pass K-of-N rule with K = 4/N = 5 and T = 48 hours. An object consistently in the same voxels across K of N passes within T = 48 hours becomes permanent; absent or inconsistent = transient.

**Designated parking vs. random staging**: airside maps may include designated GSE parking bays from the aerodrome chart. Objects in designated parking bays are known GSE and should always route to the transient layer. Objects outside bays receive the same semantic filter but with location context informing the confidence threshold.

POCD is the closest published method to this scenario, validated in warehouse environments with per-object stationarity score and TSDF change measure ([arXiv 2205.01202](https://arxiv.org/abs/2205.01202)). The warehouse-to-airside analogy is structurally sound: warehouse pallets and forklifts have the same semi-static behavioral pattern as apron GSE — consistently present for hours or days in predictable staging zones, then relocated during operations. The key difference is that airside GSE is typically larger (belt loaders are vehicle-scale) and the operational environment is safety-certified, raising the evidence standard for any false-permanent error.

### Seasonal Vegetation and Snow

**Characteristics**: long timescale (week to month), spatially broad, surface-level height change rather than an isolated cluster.

Multi-season LiDAR surveys show that leaf-off versus leaf-on conditions alter LiDAR penetration through vegetation from approximately 18 % to 24 % of canopy height, producing surface height differences of decimetres. Snow adds 2–14 cm elevation offset depending on vegetation context. ([seasonal LiDAR study, 2026](https://tc.copernicus.org/articles/20/2169/2026/))

**Handling**: the permanent layer should represent bare-earth plus permanent infrastructure. Seasonal surveys (minimum: one summer, one winter) build envelope models — min/max elevation per ground voxel across seasons. At runtime, points within the seasonal envelope are not flagged as change. Tall grass and snow piles are placed in the long-timescale transient layer with survey date timestamp.

Seasonal changes are well-suited to the exponential-decay OctoMap variant with a long decay constant (λ corresponding to weeks to months). A voxel containing summer vegetation that is absent in the winter survey will naturally decay below the permanence threshold between seasonal surveys without requiring an explicit "vegetation is transient" semantic rule.

**Airside note**: grass height at airside perimeter areas is managed by airport maintenance schedules (typically mowed to < 20 cm for bird-strike reduction per ICAO Doc 9137). This reduces but does not eliminate seasonal variation. Snow clearance operations can rapidly remove accumulations, so the transition from occupied to clear can occur within a single shift — requiring the K-of-N window to be appropriately short for perimeter zones during winter operations.

### Construction and Temporary Infrastructure

**Characteristics**: may last weeks to months; physically large; semantically ambiguous (cones resemble bollards; scaffolding resembles building structure).

**Handling**: if possible, integrate with a transient-zone layer maintained by operations — when a construction area is declared, all points within that bounding polygon are placed in the transient layer regardless of semantic class. This approach requires no segmentation and is the most reliable.

In the absence of prior zone annotation: multi-pass differencing with a new-structure candidate state. A large cluster not present in the previous survey enters "new-structure candidate"; it only graduates to permanent after being present for > T_perm (e.g., 90 days of consistent observation), otherwise it becomes confirmed-transient and is dropped.

**Airside-specific integration**: airport NOTAMs (Notices to Airmen) and airside safety permits are issued for construction activity. Integrating NOTAM-derived zone polygons as transient-zone priors is architecturally clean and authoritative — no semantic segmenter required for these zones. A NOTAM typically specifies an affected area (coordinates or standard location code), an active time window, and a type code (e.g., obstacle-related). The AV map management system can subscribe to the NOTAM feed (via ATIS, AODB, or direct airport operations integration), convert the affected area to a bounding polygon in the map coordinate frame, and mark all voxels within that polygon as transient-candidate for the NOTAM validity period plus an operational margin. This operational-data-driven approach is complementary to the geometry-driven K-of-N mechanism: for declared construction zones, the transient classification is instantaneous on NOTAM publication rather than requiring N observation passes; for undeclared changes (a piece of equipment left outside a declared zone), the K-of-N mechanism provides the backstop.

### Dropped FOD (Foreign Object Debris)

This is the most safety-critical sub-category and requires special treatment.

**Why it is different from all others**: FOD is the adversarial target. The entire purpose of a clean static map for airside AV is to detect FOD against it by finding new points not in the permanent map. If a piece of FOD is baked into the permanent layer during a survey pass, it becomes invisible to the runtime change detector — a direct safety failure. FOD ranges from sub-centimetre (bolt, nut, fragment) to tens of centimetres (panel, tool). The smallest items are at or below LiDAR resolution (a 64-channel LiDAR at 50 m returns approximately 1 point per 3 cm² on the ground).

**Handling principles**:

1. Never promote small unclassified ground-level points to permanent by default. Any small cluster (volume < V_fod_thresh, no clear semantic class, lying on the ground plane) goes to the transient layer by default, not the permanent layer. The default should be "unknown = transient" for ground-plane small objects.
2. K-of-N with very high K/N: a ground-level small object requires K ≥ 4 of N = 5 passes for permanent promotion. A real permanent marking (painted threshold, stud) will pass this test; a dropped wrench will not survive two shift changes.
3. Dedicated FOD-candidate layer: in addition to permanent and transient-candidate, maintain an explicit FOD-candidate layer for small ground-level unrecognized returns with a very short TTL (hours). Detection algorithms compare live scans against the permanent layer only, never against the FOD-candidate layer.
4. **The LiDAR-based static map is not the primary FOD detection modality in current airport systems.** Dedicated millimetre-wave radar (TARSYS, FOD:BOSS) and camera-based systems (Xsight Zamir) handle FOD detection. A 2025 review confirms that millimetre-wave radar and high-resolution optical systems remain the primary modalities; LiDAR maps are a complementary reference but not the primary sensor for objects smaller than approximately 5 cm. ([MDPI Remote Sensing 2025](https://www.mdpi.com/2072-4292/17/2/225)) The map must not occlude the primary FOD detectors — the correct role of the static map is providing a clean reference baseline, not performing detection itself.

### Workers' Tools and Cables

Hose reels, cable carts, cleaning equipment, mobile work stands, electrical ground power cables, aircraft chocks, and wheel wedges. All transient by class. No permanent layer. Short TTL (1 hour typical).

**LiDAR detectability note**: many of these objects are small (chocks are typically 15–30 cm; cables on the ground can be < 5 cm in diameter). At survey speeds and typical LiDAR range, small tools may generate only 1–3 returns per scan frame, making semantic classification unreliable. For these objects, the "unknown small ground object = FOD-candidate layer" rule (see §Dropped FOD above) provides a safer fallback than attempting semantic classification.

**Integration opportunity**: maintenance crew operations often correlate with NOTAMs or airside work permits. Integrating work permit data as transient-zone priors reduces the burden on the semantic segmenter and provides higher-confidence classification than geometry alone. A work permit covering a specific apron stand and time window can automatically mark all ground-level returns in that polygon as transient-candidate for the permit duration plus a 2-hour margin, without requiring any geometric analysis.

### Aircraft Parked at Gates

Aircraft are the largest objects on the apron and will dominate the LiDAR return. They are also transient on a 1–4 hour timescale (typical gate turn time).

**Handling**: class = aircraft is always transient. Gate-zone overlay: define gate bounding polygons from the aerodrome chart or survey. Within a gate polygon, all returns above a height threshold (e.g., > 2 m) are placed in the transient layer by default. Movement priors from flight schedule data (gate occupied between pushback minus 1 hour and landing plus 2 hours) provide a high-confidence transient flag for gate-polygon points during known occupancy windows, with no LiDAR analysis required.

The permanent layer within the gate zone should reflect only empty-stand geometry (pavement, jetway, fixed infrastructure) so the AV localizes consistently regardless of aircraft presence or absence.

---

## Architecting the Pipeline

### Layered Map Architecture

```
+------------------------------------------------------------------+
|  PERMANENT LAYER                                                 |
|  Pavement, fixed structures, taxiway geometry, permanent marks  |
|  Source: K-of-N passed, semantic class confirmed-permanent       |
|  Role: localization reference and FOD change-detection baseline  |
+------------------------------------------------------------------+
|  TRANSIENT / QUARANTINE LAYER                                    |
|  Objects present in >= 1 pass but not meeting K-of-N threshold  |
|  OR semantic class on transient list                             |
|  Annotated with: survey timestamp, class label, epsilon_g score |
|  TTL: configurable per class (hours for GSE, weeks for seasonal) |
|  Role: soft evidence for localization; NOT the FOD baseline      |
+------------------------------------------------------------------+
|  FOD-CANDIDATE LAYER                                             |
|  Small ground-level unclassified clusters                        |
|  Very short TTL (hours); never promoted to permanent without     |
|  K >= 4 of N = 5 pass confirmations                             |
|  Role: handed to dedicated FOD detection pipeline only           |
+------------------------------------------------------------------+
|  RUNTIME LAYER (live perception, not stored in static map)       |
|  All objects seen in the current sensor window                   |
|  Compared against permanent layer to detect changes              |
+------------------------------------------------------------------+
```

The permanent layer is the localization reference and the baseline for change detection. The transient and FOD-candidate layers carry timestamped uncertainty and expire; they are not used as the localization reference.

**Relationship to localization**: the layered architecture has a direct impact on scan-to-map localization quality. A localization system (NDT, ICP, or learned relocalization) uses the permanent layer as the reference cloud. If the permanent layer is contaminated with transient objects, two failure modes arise: (i) when the transient object is present in the live scan and the map, the localization converges to the transient object as a landmark — correct in the short term but fragile when the object moves; (ii) when the transient object is in the map but absent from the live scan, ICP or NDT residuals increase, potentially causing localization divergence or increased position uncertainty. The transient layer, by contrast, can be used as a soft constraint: if the live scan detects structure that matches the transient layer (the GSE is back in its usual spot), this provides supplementary pose evidence without making the localization depend on a non-permanent landmark. This use of the transient layer as soft evidence is architecturally distinct from the permanent-layer hard constraint and should be implemented as a separate factor in a factor-graph localization stack.

### Three-Class Pipeline and Processing Order

The recommended processing order is:

1. Classical dynamic removal (FreeDOM / ERASOR++) on raw scan aggregation — removes moving objects from within the session.
2. 3D semantic segmentation on the surviving aggregated cloud — assigns class labels per voxel.
3. Semantic transient filter — moves all class-on-transient-list voxels to the transient layer.
4. Multi-pass differencing on the semantically filtered cloud — detects between-session changes; updates εg or K-of-N counters.
5. K-of-N promotion — permanent layer receives only K-of-N-passing, confirmed-permanent voxels.

The clean-then-segment order gives the segmenter cleaner input than segment-then-clean. The exception is that the segmenter sometimes catches slowly-moving objects that ERASOR misses; running segmentation before and after dynamic removal is architecturally defensible for safety-critical applications at the cost of doubled segmentation compute.

### Hard-Exclusion and Static-Wrong Gate Policy

Static-but-transient handling needs policy gates in addition to model predictions. Some semantic classes can never become permanent map truth from survey evidence alone. A person standing still for an entire scan session is not a permanent asset; neither is a belt loader, aircraft, road cone, pallet, or maintenance tool. Persistence is evidence, not authorization.

| Gate | Trigger | Action | Why |
|---|---|---|---|
| Human hard exclusion | `person`, crew detector, thermal human cue, or reviewer human label | Exclude from permanent layer with no K-of-N override | Human geometry in a map creates safety, privacy, and auto-label contamination risk |
| Movable asset quarantine | Vehicle/GSE/aircraft/container/forklift/pallet class or detector box | Store as movable-static with TTL and source scans | May help localization only as low-weight soft evidence; not a permanent reference |
| Zone override | Gate stand, loading bay, construction zone, temporary storage, event area | Raise promotion threshold or disable automatic promotion | Operational zones can keep temporary objects in the same place for many passes |
| Asset-inventory exception | Object ID exists in authoritative permanent-asset registry | Permit promotion after geometry and reviewer checks | Some equipment-like geometry is actually fixed infrastructure |
| Static-wrong demotion | Previously permanent point contradicted by repeated future free-space evidence | Demote through change-control, not immediate deletion | Protects against registration errors and one bad survey pass |
| FOD-candidate guard | Small unknown ground cluster, recent appearance, no asset support | Keep in FOD-candidate layer with short TTL | FOD must remain detectable; promotion into permanent map suppresses future alerts |

For map publication, the release artifact should expose the gate that decided each non-permanent point: `dynamic_residual`, `human_exclusion`, `movable_static`, `zone_quarantine`, `fod_candidate`, `artifact`, or `static_wrong_demotion`. This makes later QA tractable: a reviewer can ask "why was this cluster removed?" or "why did this stationary object not become permanent?" without replaying the entire pipeline.

### Multi-Pass Survey Protocol

Practical parameters derived from LT-Mapper, ELite, and HD-map update literature:

| Parameter | Road AV practice (informal) | Airside (recommended starting point) |
|---|---|---|
| Minimum passes to commit permanent | 3 | 4–5 |
| Window T for K-of-N (GSE areas) | 7–14 days | 48–72 hours |
| Window T for K-of-N (perimeter) | 7–14 days | 7 days |
| Session alignment method | LT-SLAM or NDT + ICP | GNSS-aided ICP (centimetre RTK) |
| Minimum temporal gap between passes | 4–24 hours | 1 shift (~8 hours) |
| Seasonal re-survey | 2× per year | 4× per year (quarterly) |

GNSS-aided alignment at airports is a significant advantage: RTK-GNSS achieves 2–5 cm absolute accuracy, reducing the inter-session alignment burden and lowering the false-difference rate from pose error compared to road-AV environments.

### Per-Voxel Temporal-Presence Model (Pseudo-Code)

```python
TRANSIENT_CLASSES = {'person', 'vehicle', 'gse', 'aircraft', ...}
K_PERM = 4         # passes required for permanent promotion
N_WINDOW = 5       # pass window for K-of-N check
T_WINDOW = 172800  # 48 hours in seconds (adjust per zone)
ABSENCE_THRESHOLD = 2  # absence votes before demotion from permanent

for each survey pass t = 1..N:
    scan_t = aggregate_lidar_session(pass_t)
    scan_t = classical_dynamic_removal(scan_t)     # ERASOR++ / FreeDOM
    labels_t = semantic_segmentation(scan_t)        # 3D segmenter

    for each voxel v in scan_t:
        if labels_t[v] in TRANSIENT_CLASSES:
            map.transient_layer.add(v,
                timestamp=t, class=labels_t[v])
            continue

        if is_small_ground_object(v) and labels_t[v] == 'unknown':
            map.fod_candidate_layer.add(v, timestamp=t, ttl=3600)
            continue

        # Update K-of-N counter
        voxel_state[v].n_observed += 1
        voxel_state[v].last_seen = t

        recent = passes_within_window(t, T_WINDOW)
        if voxel_state[v].n_observed >= K_PERM and len(recent) >= N_WINDOW:
            map.permanent_layer.add(v)
        else:
            map.transient_layer.add(v, timestamp=t)

    # Cross-pass free-space check
    for each voxel v_prev in map.permanent_layer:
        if raycast_free(scan_t, v_prev):
            voxel_state[v_prev].n_absent += 1
            if voxel_state[v_prev].n_absent >= ABSENCE_THRESHOLD:
                map.permanent_layer.remove(v_prev)
                map.transient_layer.add(v_prev,
                    reason='cross_pass_absence', timestamp=t)

    # TTL expiry
    map.transient_layer.expire(max_age=TTL_PER_CLASS)
    map.fod_candidate_layer.expire(max_age=3600)
```

### Interaction with the Auto-Label Flywheel

A critical downstream consequence of static-but-transient handling is its effect on the auto-labeling pipeline that generates training data for the perception stack. The permanent layer is the pseudo-ground-truth reference against which live sensor data is compared to produce automatic labels ("this point cluster is new relative to the map, therefore it is an obstacle / FOD candidate"). If the permanent layer contains transient objects, the auto-label pipeline produces systematically incorrect training examples:

- A parked GSE unit baked into the permanent layer means that the same unit in the same position during a future deployment pass does not trigger the "new point" detector — the auto-labeler sees no change and generates no label. The vehicle is rendered invisible to the training pipeline.
- A person who happened to stand still during a survey will, if baked in, appear in the permanent map as a low surface cluster. Future instances of people standing in that approximate location match the map and are not flagged, corrupting the person-detection training signal.
- Conversely, if aggressive false-transient errors create holes in the permanent layer, every survey pass that covers those zones generates spurious "new point" labels — inflating the false-positive rate in the training data for the obstacle detector.

The correct safeguard is strict layer provenance in the auto-label pipeline: labels must be tagged with the source layer (permanent / transient / FOD-candidate), and only permanent-layer mismatches should feed the obstacle detection training loop. Transient-layer content should feed a separate "known transient class" detection training loop if desired, keeping the two training signals orthogonal. This separation is architecturally clean but requires deliberate data-pipeline design; it does not emerge automatically from a single-layer map representation.

**False-transient (Type I error)**: a real permanent structure is incorrectly flagged transient → voxel is removed from the permanent layer → holes in the reference map → localization drift; false positive obstacle alerts; incorrect baseline for FOD detection.

**False-permanent (Type II error)**: a transient object is incorrectly baked into the permanent layer → wrong reference for change detection → (a) the FOD detection system misses objects that match the baked-in map; (b) the auto-label flywheel for training generates ground-truth labels that include non-permanent objects, poisoning training data for future surveys.

In airside environments, Type II errors (false-permanent) carry higher safety risk because they directly affect FOD detection and obstacle detection. The correct operating point is biased toward Type I — prefer to quarantine uncertain objects rather than bake them in. This is the opposite of conservative behavior in localization (where retaining map points is preferred), creating a genuine system-level tension. The resolution is the three-layer architecture: uncertain points go to the transient layer and remain available to the localization stack as soft evidence, but are excluded from the permanent reference used for change detection.

---

## Benchmarks

### SceneEdited (2024)

First city-scale dataset for 3D HD-map updating via image-guided change detection. 800+ scenes, 73 km driving, ~3 km² urban area, 23,000+ synthesized changes across 2,000+ stale-map versions. Uses Argoverse 2 LiDAR scans. Change types: infrastructure additions and deletions (bollards, signs, buildings, tunnels, overpasses, trees). Evaluation metrics: Chamfer Distance, Hausdorff Distance, Modified Hausdorff Distance, Median Point Distance. Limitation: synthesized changes (not real survey-to-survey differences), and focus on infrastructure-scale objects rather than object-level transients (people, GSE). Relevance to airside: indirect; demonstrates evaluation methodology for map-update benchmarks. ([arXiv 2511.15153](https://arxiv.org/abs/2511.15153); [GitHub ScenePoint-ETK](https://github.com/ChadLin9596/ScenePoint-ETK))

> See [SceneEdited — 3D HD Map Updating Benchmark](../../localization-mapping/maps/sceneedited-3d-hd-map-updating-benchmark.md).

### Argoverse 2 Map Change Dataset (ExelMap and ArgoTweak)

200 of 1,000 scenarios depict real-world HD map changes (pedestrian crossings, lane modifications). ExelMap evaluates element-wise insertion/deletion detection; ArgoTweak provides the first realistic prior-map triplet (prior map + current sensor data + ground-truth updated map). Limitation: road-centric, lane-level changes; no object-level transients. Relevance to airside: methodology for element-level change detection is transferable; content is not.

> See [ExelMap](../../localization-mapping/maps/exelmap-element-based-hd-map-change-update.md) and [ArgoTweak](../../localization-mapping/maps/argotweak-self-updating-hd-map-priors.md).

### MapBench (NeurIPS 2024)

Evaluates HD map constructor robustness under sensor corruptions: 29 corruption scenarios (8 camera, 8 LiDAR, 13 multi-sensor combinations), 3 severity levels, 31 models tested. Focus is on sensor failure robustness, not temporal change. Does not address temporal map drift or static-but-transient objects. Relevance to airside: useful for choosing a robust map constructor for the survey vehicle stack; not directly relevant to transient removal. ([arXiv 2406.12214](https://arxiv.org/abs/2406.12214))

> See [MapBench — HD Map Construction Robustness](../../localization-mapping/maps/mapbench-hd-map-construction-robustness.md).

### HKCD — Urban 3D Point Cloud Change Detection

City-scale LiDAR change detection benchmark. Evaluates multi-session pair differencing for built-environment changes. Covers structural changes in urban settings. Relevance to airside: structural change methodology transfers; object-level transient handling is not explicitly evaluated.

> See [HKCD — Urban 3D Point Cloud Change Detection](../../localization-mapping/maps/hkcd-urban-3d-point-cloud-change-detection.md).

### KITTI-Based Dynamic Map Cleaning Baselines

SemanticKITTI and KITTI-360 are used by ERASOR, Removert, FreeDOM, and DR-Remover for evaluating within-session dynamic object removal. These benchmarks measure how well scan-level removal methods preserve static points and remove dynamic ones. They explicitly do not capture between-session static-but-transient objects. No public benchmark exists that specifically evaluates static-but-transient removal (objects stationary within a session but absent in subsequent surveys). This is a confirmed research gap.

### HeLiMOS

Multi-session outdoor LiDAR dataset with heterogeneous sensor types. Used to evaluate cross-sensor dynamic removal. Contains some temporal variation but is not specifically designed for static-but-transient evaluation. Limited to outdoor campus environments.

### What Is Missing

No published benchmark as of May 2026 provides:

- Paired multi-session LiDAR surveys of an airside or industrial environment with operational GSE staging.
- Ground-truth labels distinguishing permanent / static-but-transient / dynamic categories verified from operational knowledge (not synthesized).
- Evaluation metrics specifically for static-but-transient removal: precision and recall on the transient class with ground truth from future survey passes showing what actually moved.

A purpose-built airside benchmark with 4–8 survey passes over 2–4 weeks, ground-truthed from operational records of GSE movement and construction activity, would be highly valuable and does not yet exist. Constructing such a benchmark would require: (a) access to an operational airfield for repeat survey passes, (b) synchronized operational records (GSE movement logs, construction permits, gate occupancy) as ground-truth for transient labels, (c) LiDAR sensor and GNSS survey infrastructure capable of centimetre-level inter-session alignment, and (d) community agreement on evaluation metrics beyond simple point-level precision/recall (instance-level recall of transient clusters and false-permanent rate on confirmed infrastructure are more operationally meaningful). The SceneEdited benchmark provides the closest evaluation methodology reference, though its synthesized changes and road-AV scope do not transfer directly.

---

## Industry-Proven Practice

### Mobileye REM (Road Experience Management)

Crowdsourced HD mapping from 125+ million production vehicles. Map updates are continuous: each vehicle with a Mobileye EyeQ chip logs sparse landmark observations (road marks, signs, poles) and uploads diffs. The REM pipeline aggregates multi-vehicle observations to vote on which map elements have changed. The implicit consensus mechanism is a form of K-of-N: an observation is promoted when multiple independent vehicles agree. Transient handling relies on the fact that people and other vehicles do not appear in REM-style sparse landmark maps (the feature extractor targets structural landmarks). For HD-map object layers (parked vehicles, construction), crowdsourced voting provides multi-pass consensus. ([Mobileye REM](https://www.mobileye.com/technology/rem/))

### HERE and TomTom

Both vendors use dedicated LiDAR survey vehicles plus crowdsourced camera data from fleet vehicles. Map update cycles have been reduced from quarterly to weekly (Baidu Maps reports weekly city-scale updates as of 2024). The semantic point cloud data is vectorized after denoising and clustering; vectorized elements are matched against the prior map to confirm unchanged elements and flag changed ones. Parked vehicles are handled by semantic filtering in the LiDAR processing pipeline before vectorization. The general pipeline structure is described in survey papers ([arXiv 2409.09726](https://arxiv.org/abs/2409.09726)) but precise parameters (K-of-N thresholds, class lists, TTL policies) are proprietary and not published.

### Waymo and Aurora

Both companies build and maintain HD maps for AV deployment with regular re-survey cadences. Waymo publicly states that vehicles automatically upload change detections that are merged into the fleet map after optional human review ([Waymo mapping blog, 2020](https://waymo.com/blog/2020/09/the-waymo-driver-handbook-mapping/)). A Chef's KISS ([arXiv 2504.02086](https://arxiv.org/abs/2504.02086)) demonstrates that filtering parked vehicles by semantic class from the SLAM map improves relocalization quality — reflecting standard practice in the AV industry. The implicit mechanism is exactly segment-then-filter applied at the SLAM-map level: the relocalization system benefits from a permanent layer that excludes semi-dynamic landmarks (parked vehicles) that were present during mapping but may be absent during deployment.

**Honest uncertainty**: no AV company has published specific static-but-transient parameters (K, N, T, class lists) for their production maps. The academic literature (LT-Mapper, ELite) is the closest open proxy.

### Stability-Plasticity Trade-off in Production Lifelong Maps

The theoretical framing for the operational tension in multi-pass map management is the stability-plasticity dilemma, reviewed comprehensively in the context of robot mapping in ([lifelong map stability-plasticity review, 2023](https://onlinelibrary.wiley.com/doi/full/10.1002/rob.22170)). A map that is too stable (high permanence threshold) fails to incorporate real changes (new taxiway marking, removed bollard), degrading localization accuracy over time. A map that is too plastic (low permanence threshold) evicts points at the first absence signal, making it vulnerable to survey-pass artifacts and alignment noise. The optimal operating point is domain-specific and time-varying: airside environments change on multiple timescales simultaneously (shift-level GSE staging, quarterly construction, annual seasonal cycles), requiring a multi-timescale map architecture rather than a single decay constant. ELite's two-level ephemerality design (local εₗ within session, global εg across sessions) is the clearest published formalization of this principle.

### Airside Literature Sparsity

**Honest caveat on airside literature sparsity**: The peer-reviewed literature on static-but-transient removal in airside environments specifically is sparse. No paper as of May 2026 has published a multi-session LiDAR mapping study of an airport apron with explicit treatment of GSE staging patterns, aircraft gate occupancy, or FOD-exclusion from the permanent map. The methods above are drawn from road-AV and industrial-robot mapping literature and transfer to airside with the following caveats:

- The assumption of frequent re-surveys is more readily met at airports (fixed patrol routes, operational survey vehicles) than on open roads.
- GNSS availability is better at airports (open sky, RTK infrastructure often present).
- The class vocabulary for the semantic filter must be extended to include GSE-specific classes not present in standard road-AV semantic segmenters (belt loaders, aircraft steps, GPU carts, FOD carts, fuel bowsers).
- Regulatory context: ISO 3691-4 governs driverless industrial trucks at airports and implicitly requires that the reference map used for navigation is accurate. The static-but-transient problem is a map accuracy problem directly relevant to certification under this standard.

---

## Airside-Specific Prescription

### GSE: The Dominant Case

Belt loaders, baggage trains, steps trucks, and GPU carts may be staged in the same apron stand spot for hours or days, then repositioned. A map built from a single survey bakes in the GSE at its staged position, creating a phantom obstacle for subsequent AV navigation and an invisible region for FOD detection.

**Pipeline recipe**:
1. Semantic filter: all voxels labelled GSE (or parent class vehicle/truck) → transient layer, not permanent. Apply regardless of confidence.
2. K-of-N check: if semantic confidence < 0.6 due to sparse returns, apply K = 4/N = 5 with T = 48 hours. GSE staged in the same spot for two consecutive shifts will have K = 2 over two passes; it does not reach K = 4 within the short window and remains transient.
3. Gate-zone priors: define bounding polygons for each aircraft stand. Any large mobile object within a gate-zone bounding box is automatically flagged transient regardless of semantic class — the zone is inherently dynamic on an hours timescale by operational design.

### Parked Aircraft at Gates

**Pipeline recipe**:
- Class = aircraft: always transient. Never promote aircraft-class points to permanent.
- Gate-zone overlay: within a gate polygon, ALL returns above 2 m height are placed in the transient layer by default, pending K-of-N confirmation over multiple passes.
- Flight schedule integration: gate occupancy priors from flight plan data (occupied between pushback − 1 h and landing + 2 h) provide high-confidence transient flags with no LiDAR analysis.
- The permanent layer within the gate zone reflects empty-stand geometry only. The AV must localize consistently whether an aircraft is at the stand or not.

### Maintenance and Cleaning Crew Tools

Route to transient layer. Short TTL (1 hour). Integrate with work permit data where available as transient-zone priors.

### FOD on Apron and Taxiways

The architectural rule is explicit and non-negotiable:

> Any point cluster that (a) lies on the ground plane, (b) is not semantically identified as a permanent structure (pavement marking, stud, drainage grate), and (c) has not been confirmed across K ≥ 4 of 5 passes within 48 hours, goes to the FOD-candidate layer with TTL of 1–4 hours.

The FOD-candidate layer is passed to the FOD detection pipeline (which uses dedicated radar or camera sensors for confirmation). It is never used as input to the localization stack.

The clean permanent layer then consists only of truly permanent, repeatedly confirmed infrastructure. Any new point appearing in the live sensor feed that is NOT in the permanent layer is a potential obstacle or FOD — the correct trigger for the detection system.

---

## Implementation Notes

- Treat the permanent layer and the transient layer as separate data structures with separate indexing, TTL management, and query APIs. Mixing them in a single voxel map with a binary flag is an antipattern that leads to TTL management bugs and accidental promotion of transient points into permanent queries.
- Store at minimum: survey timestamp, class label, observation count, last-seen pass ID, and absence vote count per voxel. The εg score from ELite is the most information-rich single summary statistic but requires multi-pass Bayesian infrastructure to compute.
- Inter-session alignment error is the dominant source of false transient detections in multi-pass differencing. Quantify alignment uncertainty (registration covariance) per session and propagate it as a threshold modifier: require a larger absence-cluster spatial extent before voting absence when alignment uncertainty is high.
- The semantic transient class list must be versioned alongside the map. If the class list changes between surveys, re-process the affected voxels against the new list before computing K-of-N statistics.
- TTL policies per class should be set conservatively (shorter) initially and lengthened based on operational data. It is easier to re-observe a true permanent structure after a conservative quarantine than to retroactively identify and remove a baked-in transient from a production localization map.
- For the auto-label flywheel: only the permanent layer should be used as pseudo-ground-truth for training downstream segmentation or detection models. The transient and FOD-candidate layers must be excluded from any auto-labeling pipeline that generates training data. Including transient-layer points as training labels for a permanent-class detector poisons future model iterations. See [Aggregated-Map Semantic Segmentation §10](aggregated-map-semantic-segmentation.md) for the post-processing context in which the permanent layer feeds back into the training loop.
- Khronos-style change timing estimation (uniform probability between last-absence and first-observation timestamps) is useful for reconstructing when an object appeared or disappeared, which can feed operational analytics on GSE staging patterns.
- When the semantic transient filter disagrees with the K-of-N persistence rule (e.g., an object with class = vehicle has K = 5/5 consistent observations), always default to the semantic class rule: K-of-N can be fooled by a permanently-staged piece of GSE that operationally never moves, but the semantic class correctly characterizes it as non-permanent infrastructure. Human operator review is warranted for any voxel where the two signals disagree after N ≥ 5 passes.
- The distinction between "transient-candidate" and "confirmed-transient" in the three-class pipeline matters for operational use: transient-candidate points can still contribute as soft constraints in localization (e.g., in a factor graph with low confidence weight); confirmed-transient points should be actively suppressed from localization to avoid misleading the pose estimator with stale geometry.

---

## Failure Modes

| Symptom | Probable cause | Diagnostic |
|---|---|---|
| Belt loaders appear as permanent obstacles after a single survey | No semantic transient filter; GSE class not in transient list or segmenter missing GSE vocabulary | Audit transient class list; verify segmenter output on GSE returns; check K-of-N parameters |
| FOD disappears from detection output after initial scan | FOD cluster promoted to permanent via overly low K-of-N threshold | Verify that ground-level unclassified small objects route to FOD-candidate layer only; audit K/N and T parameters |
| Holes in permanent map in areas where aircraft park | Aircraft-class points being removed but no gate-zone overlay replacing the permanent geometry; aircraft absent during all survey passes used for K-of-N | Ensure permanent layer includes empty-stand geometry from aircraft-free passes; add gate-zone overlay logic |
| False change detections after seasonal re-survey | Inter-session alignment error exceeds seasonal change magnitude; or seasonal envelope model not updated | Quantify registration covariance; refresh seasonal envelope model; use RTK-GNSS for alignment at airports |
| Localization drift in GSE staging areas | GSE baked into permanent layer; runtime scan no longer matches permanent reference (GSE has moved) | Audit permanent layer contents; check that GSE was correctly routed to transient layer at map build time |
| Static map missing kerbs and fencing after aggressive transient filtering | Conservative K-of-N threshold combined with low survey pass count; or semantic segmenter misclassifying permanent infrastructure | Increase N_WINDOW first; audit segmenter recall on infrastructure classes; validate that permanent-class list includes fence/kerb/pole |
| Auto-label training data degrading over successive model generations | Transient-layer points leaking into auto-labeling pipeline | Enforce strict layer separation in the auto-label pipeline; audit label source at model training time |
| K-of-N parameters from road AV practice applied directly to airside | GSE staging patterns on aprons change on hours timescale, not days; road AV T = 14 days is far too long for apron zones | Set T = 48 hours for apron GSE areas; calibrate empirically from operational GSE movement records |
| New construction persists in permanent layer for months | T_perm (time to graduate new structure to permanent) set too short; construction equipment present consistently across passes within the window | Use transient-zone layer from NOTAM/permit data; do not rely solely on geometric persistence for construction zones |

---

## Sources

**Cross-links (this knowledge base):**
- [Aggregated-Map Semantic Segmentation](aggregated-map-semantic-segmentation.md) — hub page; §9 conditioning, §10 post-processing
- [LiDAR Artifact Removal Techniques](lidar-artifact-removal-techniques.md) — pre-processing sibling covering scan-level conditioning
- [LiDAR Map Cleaning and Dynamic Removal](../../localization-mapping/slam-methods/lidar-map-cleaning-dynamic-removal.md) — intra-scan dynamic removal methods (ERASOR, Removert, FreeDOM, Raymoval)
- [LT-Mapper and Khronos Lifelong Mapping](../../localization-mapping/slam-methods/lt-mapper-khronos-lifelong-mapping.md) — full coverage of LT-Mapper and Khronos
- [Lifelong 3D Map Version Control](../../localization-mapping/slam-methods/lifelong-3d-map-version-control.md) — base-map/diff/boundary lifecycle architecture for reconstructable clean maps
- [Uni-Mapper Dynamic-Aware LiDAR Map Merging](../../localization-mapping/slam-methods/uni-mapper-dynamic-aware-lidar-map-merging.md) — heterogeneous-LiDAR map merging with dynamic-aware loop evidence
- [Potentially Dynamic Object Removal by Ground Projection](../../localization-mapping/slam-methods/potentially-dynamic-object-removal-ground-projection.md) — detector-based single-survey quarantine for parked/movable-class objects
- [HD-Map Change Detection and Maintenance](../../localization-mapping/maps/hd-map-change-detection-maintenance.md) — broader HD-map update context
- [ExelMap — Element-Based HD Map Change and Update](../../localization-mapping/maps/exelmap-element-based-hd-map-change-update.md)
- [ArgoTweak — Self-Updating HD Map Priors](../../localization-mapping/maps/argotweak-self-updating-hd-map-priors.md)
- [HKCD — Urban 3D Point Cloud Change Detection](../../localization-mapping/maps/hkcd-urban-3d-point-cloud-change-detection.md)
- [SceneEdited — 3D HD Map Updating Benchmark](../../localization-mapping/maps/sceneedited-3d-hd-map-updating-benchmark.md)
- [MapBench — HD Map Construction Robustness](../../localization-mapping/maps/mapbench-hd-map-construction-robustness.md)
- [LiDAR-MOS](../methods/lidar-mos.md) — moving-object segmentation (semantic signal for transient filtering)
- [SegNet4D](../methods/segnet4d.md) — 4D spatio-temporal segmentation
- [4DMOS](../methods/4dmos.md) — 4D moving object segmentation

**Primary papers:**
- LT-Mapper (ICRA 2022): https://arxiv.org/abs/2107.07712
- ELite — Ephemerality meets LiDAR Lifelong Mapping (ICRA 2025): https://arxiv.org/abs/2502.13452
- ELite GitHub: https://github.com/dongjae0107/elite
- Lifelong 3D Mapping Framework for Hand-held & Robot-mounted LiDAR Mapping Systems: https://arxiv.org/abs/2501.18110
- Uni-Mapper: https://arxiv.org/abs/2507.20538
- Uni-Mapper project page: https://sparolab.github.io/research/uni_mapper/
- No More Potentially Dynamic Objects: https://arxiv.org/abs/2407.01073
- Khronos (RSS 2024): https://arxiv.org/abs/2402.13817
- POCD semi-static scenes (RSS 2022): https://arxiv.org/abs/2205.01202
- ERASOR: https://arxiv.org/abs/2103.04316
- ERASOR++: https://arxiv.org/abs/2403.05019
- FreeDOM: https://arxiv.org/abs/2504.11073
- Dynablox: https://arxiv.org/abs/2304.10049
- ExelMap (ECCV 2024): https://arxiv.org/abs/2409.10178
- ArgoTweak (ICCV 2025): https://arxiv.org/abs/2509.08764
- SceneEdited benchmark: https://arxiv.org/abs/2511.15153
- SceneEdited GitHub / toolkit: https://github.com/ChadLin9596/ScenePoint-ETK
- MapBench (NeurIPS 2024): https://arxiv.org/abs/2406.12214
- City-scale LiDAR change detection 2025: https://arxiv.org/abs/2510.21112
- Long-term map maintenance pipeline (Berrio et al., 2020): https://arxiv.org/abs/2008.12449
- HD map update survey: https://arxiv.org/abs/2409.09726
- A Chef's KISS (semantic SLAM): https://arxiv.org/abs/2504.02086
- Mobileye REM: https://www.mobileye.com/technology/rem/
- Waymo mapping blog (2020): https://waymo.com/blog/2020/09/the-waymo-driver-handbook-mapping/
- FOD detection review (MDPI Remote Sensing 2025): https://www.mdpi.com/2072-4292/17/2/225
- Seasonal LiDAR snow and vegetation (2026): https://tc.copernicus.org/articles/20/2169/2026/
- Lifelong map stability-plasticity review (2023): https://onlinelibrary.wiley.com/doi/full/10.1002/rob.22170
