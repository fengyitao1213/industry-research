# LT-Mapper, Khronos, and Lifelong Mapping

<!-- method-priority:start
priority:
  learning: 4
  deployment: 5
  type: "method-family"
  stage: "deployment-pattern"
  maturity: "pilot-proven"
  tags: ["slam", "mapping", "validation", "runtime-localization", "outdoor"]
  reason: "LT-Mapper, Khronos, and Lifelong Mapping is rated for dynamic-object filtering and map-cleaning workflows that protect localization maps."
method-priority:end -->

Related docs: [LiDAR Map Cleaning — Dynamic Removal](lidar-map-cleaning-dynamic-removal.md) · [ERASOR](erasor.md) · [Removert](removert.md) · [Scan Context Family](scan-context-family.md) · [KISS-ICP](kiss-icp.md) · [FreeDOM](freedom-dynamic-object-removal.md) · [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md) · [Object-Level SLAM](object-level-slam.md) · [Semantic SLAM](semantic-slam.md) · [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md) · [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [HD-Map Change Detection and Maintenance](../maps/hd-map-change-detection-maintenance.md) · [ArgoTweak Self-Updating HD-Map Priors](../maps/argotweak-self-updating-hd-map-priors.md)

**Last updated:** 2026-05-23

---

## What It Is

This page gives a paired deep dive into the two strongest current frameworks for **lifelong and multi-session LiDAR mapping**: LT-Mapper and Khronos. Both address the static-but-transient sub-problem — objects that are stable within a single survey session yet are not permanent features of the environment — but from different architectural angles and at different temporal scales.

**LT-Mapper** (Kim and Kim, ICRA 2022, arXiv 2107.07712, open-source at `gisbi-kim/lt-mapper`) is a modular, outdoor LiDAR lifelong mapping framework. It chains three specialist modules — multi-session pose-graph alignment, inter-session change characterisation, and a versioned Place-Voxel map — through a file-based protocol so each can be evolved or swapped independently. It operates on day-to-year-scale session gaps and has been validated on 20-month temporal windows in urban outdoor environments.

**Khronos** (Schmid, Abate, Chang, Carlone — MIT SPARK Lab, RSS 2024 Outstanding Systems Paper, arXiv 2402.13817, open-source at `MIT-SPARK/Khronos`) introduces the Spatio-Temporal Metric-Semantic SLAM (SMS) formulation. It unifies short-term in-session dynamics (walking persons, moving objects) and long-term between-session changes (furniture moved, equipment removed) in a single factor-graph with rigorous problem decomposition. The output is a 4D spatio-temporal map that is queryable at any past or current belief time.

The two systems are complementary, not competing. For a LiDAR-primary outdoor survey platform (vehicle-mounted apron surveys), LT-Mapper is the directly applicable method. Khronos adds semantic, object-instance, and real-time short-term tracking capabilities suited to near-field RGB-D scenarios; adapting it to LiDAR requires architectural changes that have not yet been published.

## Core Idea

The core idea shared by both systems is to treat map state as time-indexed evidence rather than a single accumulated point cloud. A lifelong mapper keeps session provenance, aligns sessions robustly, identifies changes with appropriate temporal granularity, and stores map deltas or lifecycle estimates so the system can reconstruct the current map and reason about historical states.

This differs from dynamic-object removal:

- Dynamic removal removes inconsistent traces from a single map build.
- Lifelong mapping maintains a continuously changing world model across sessions separated by hours, days, months, or years.
- Dynamic removal can be a submodule of lifelong mapping (and is: LT-Removert is derived from Removert — see [Removert](removert.md) and [ERASOR](erasor.md) for the lineage), but it does not solve map versioning, long-term change persistence, negative changes, or multi-session policy.

In airside and AV settings, this distinction matters because many objects are not simply "dynamic." Aircraft, GSE, cones, belt loaders, stairs, snow piles, and construction barriers can sit still long enough to look static in one run while remaining unsafe as permanent localization anchors.

---

## Part A — LT-Mapper

### Paper Identity

- **Title:** "LT-mapper: A Modular Framework for LiDAR-based Lifelong Mapping"
- **Authors:** Giseop Kim, Ayoung Kim (DGIST — Daegu Gyeongbuk Institute of Science and Technology)
- **Venue:** IEEE ICRA 2022, pp. 7995–8002
- **arXiv:** https://arxiv.org/abs/2107.07712 (submitted July 2021)
- **IEEE Xplore:** https://ieeexplore.ieee.org/document/9811916
- **Code:** https://github.com/gisbi-kim/lt-mapper

### Architectural Thesis

Long-term outdoor 3D map maintenance decomposes into three distinct sub-problems that operate at different timescales and demand different algorithmic solutions:

1. **Multi-session spatial alignment** — bring multiple independently-acquired sessions into a shared coordinate system without requiring a good initial pose.
2. **Change characterisation** — separate high-dynamic changes (objects that moved within a session) from low-dynamic changes (objects present in session A but absent in session B, the static-but-transient class).
3. **Positive and negative map update** — incorporate confirmed changes into a persistent map that can reconstruct the world state at any past epoch.

Coupling these into one monolithic system would sacrifice modularity and make individual sub-problem improvements difficult. LT-Mapper therefore chains three modules through a **file-based I/O protocol** so each can be swapped or run independently.

### Module 1 — LT-SLAM (Multi-Session Alignment)

**Purpose:** Register N independently-recorded sessions into one shared global coordinate frame, producing a single unified pose graph.

Each session has its own intra-session pose graph G_k = (X_k, E_k) where X_k are keyframe poses and E_k contains odometry edges. Merging sessions by concatenation creates a disconnected graph with no shared reference. LT-SLAM introduces **anchor nodes** as inter-session separator variables: one anchor node is appended at the start of each session's pose graph. Global optimisation finds the offset between sessions by estimating where each anchor node lands in the global frame.

**Inter-session loop detection (SC + ICP):**

LT-SLAM relies on **Scan Context** as its LiDAR-based global descriptor for loop closure between sessions. See [Scan Context Family](scan-context-family.md) for the full descriptor specification; the summary here covers what LT-SLAM requires:

- Scan Context (IROS 2018, Kim and Kim) encodes each LiDAR scan as a 2D matrix of shape (N_r=20, N_s=60) where each bin (ring i, sector j) stores the maximum height of all points in that bin. The descriptor is invariant to yaw rotation via a column-shift trick.
- For inter-session matching, LT-SLAM builds a SC descriptor database from all keyframes in the reference session. Each keyframe in the query session is matched against this database via Ring Key L2 nearest-neighbour search followed by full cosine-distance alignment across yaw shifts.

For each candidate loop pair (x_{q,i}, x_{r,j}):

```
1. Extract raw point clouds for both keyframes.
2. Use SC yaw-shift estimate as initial heading correction.
3. Run ICP to refine the 6-DoF relative pose T_{q->r}.
4. Add inter-session loop factor e_{q,i,r,j} = (T_{q->r}, Sigma_ICP) to the global pose graph.
```

**Global optimisation:** the full multi-session graph — all anchor nodes, all intra-session edges, all inter-session loop factors — is jointly optimised with GTSAM using iSAM2 or batch Levenberg-Marquardt. A good initial alignment is NOT required; SC retrieval handles large position offsets (tens of metres) and arbitrary heading differences.

### Module 2 — LT-Removert (Change Characterisation)

**Purpose:** Given two sessions aligned by LT-SLAM, classify every map point into permanent, high-dynamic, or low-dynamic (static-but-transient).

**Removert lineage:** LT-Removert extends the single-session Removert algorithm (IROS 2020, Kim and Kim — see [Removert](removert.md)). Removert constructs a spherical range image of the accumulated scan: each return is projected into a 2D image indexed by azimuth and elevation. A point is declared dynamic if a later scan in the same session shows a shorter range along the same ray — meaning a new object appeared closer, proving the original point moved away.

```
Removert intra-session visibility test:
  For a point p at (r, theta, phi) in session k:
  A scan k' in the same session satisfies R_k'[theta, phi] < r - delta_r
  => point p is classified high-dynamic (HD)
  (delta_r ~0.1 m range tolerance)
```

The multiresolution trick: range images at coarse, medium, and fine angular resolution are compared in sequence. Coarse resolution first removes unambiguous dynamics; finer resolutions recover boundary points wrongly labelled dynamic at coarser scale.

**LT-Removert inter-session extension:**

After LT-SLAM alignment, both the query session map M_q and the reference session map M_c are in the same coordinate frame. LT-Removert proceeds:

```
Step 1 — Intra-session HD removal:
  Apply Removert independently to each session.
  Produces: M_q^static  (session q, HD points removed)
            M_c^static  (session c, HD points removed)

Step 2 — Inter-session set difference:
  Positive difference (PD):
    Points in M_q^static that have no neighbour in M_c^static within radius epsilon
    => objects that newly APPEARED between reference and query sessions

  Negative difference (ND):
    Points in M_c^static that have no neighbour in M_q^static within epsilon
    => objects that DISAPPEARED between reference and query sessions

  Together: PD + ND = the low-dynamic (LD) change set
    (These passed intra-session removal but differ between sessions)

Step 3 — Multi-session evidence (when N > 2 sessions available):
  A point is classified permanent only if it consistently appears across
  all sessions. Points with inconsistent presence are flagged LD.
```

The classification taxonomy has three classes: permanent (present in all sessions), HD-dynamic (moved within a session), LD / static-but-transient (present in one session, absent in another). See [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md) for the full treatment of the LD class across methods.

### Module 3 — LT-MAP (Place-Voxel Map State)

**Purpose:** Maintain a persistent, multi-epoch map structure that can represent the world state at any past survey epoch and efficiently propagate updates to the current live map.

**Three output products:**

| Product | Contents | Update rule |
|---|---|---|
| Live Map M_live | Current best estimate of the static environment; permanent points plus recently confirmed positive changes | Re-built each session: add PD, remove ND |
| Meta Map M_meta | Historical multi-session record; stores each session's static point cloud with session timestamp metadata | Append-only; nothing is deleted |
| Delta Map M_delta | Change between consecutive sessions: (PD_t, ND_t) for each session transition t to t+1 | Generated fresh per session pair |

**Place-Voxel (PV) data structure:**

The map is spatially indexed as a voxel grid. Each voxel v holds:

```
voxel v: {
  list of (session_id, point_count, class_label)   [one entry per session]
  permanent_flag: True if (occupied_sessions / total_sessions) >= K/N
}
```

The permanent_flag implements the **K-of-N persistence rule** from the static-but-transient framework — see [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md) for the derivation:

```
P(permanent | voxel v) = [sum over last N sessions of 1[v occupied in session i]] / N >= K/N
```

When the occupancy fraction clears the K/N threshold, the voxel is promoted to permanent in M_live. LT-Mapper does not expose a fixed (K, N) pair in the public code; the PV data structure makes the threshold straightforward to tune per deployment.

**Asymmetric update rules:**

- **Positive change** (new object appeared — PD cluster): placed in candidate-permanent state. After K confirming sessions the cluster is promoted to permanent in M_live.
- **Negative change** (object disappeared — ND voxels): demoted from permanent, placed in historical-permanent state — still present in M_meta with last-observation timestamp, removed from M_live.

This asymmetry prevents a single noisy measurement from permanently adding or removing structure. New structures require corroboration; disappeared structures are removed cautiously.

**Uncertainty note:** The detailed per-voxel state-machine equations are inferred from the abstract, GitHub README, and secondary citations. The raw PDF binary was not directly parseable; the description above is high-confidence inference, not direct equation transcription.

### Experimental Validation

**Primary dataset:** MulRan (IEEE Xplore 9197298) — 64-beam Ouster OS1 LiDAR, vehicle platform, urban South Korea.

- KAIST 01 (June 2019) and KAIST 04 (February 2021): approximately 20-month temporal gap. Detects construction walls that appeared and parking space rows that cleared.
- ParkingLot dataset: 6 sequences over three days; demonstrates day-level change detection.

**Validated temporal range:** day-level gaps to approximately 20 months. The paper's stated novelty is handling "permanent year-level variation in urban environments" while remaining modular.

**Limitation explicitly noted by authors:** LT-Mapper does not distinguish a true permanent structure from a very long-duration transient. A construction site active for 18 months looks permanent by K-of-N criteria. Resolving this class of change requires either an external operations database or longer observation horizons.

### LT-Mapper Limitations

1. **Geometry-only evidence.** No semantic model. A parked bus and a new bollard are identical in the PD/ND framework; the system cannot prioritise removal of semantically transient classes.
2. **ICP susceptibility.** Inter-session alignment is only as good as the SC + ICP pipeline. Environments with little geometric structure (flat aprons, featureless walls) can cause ICP divergence, generating spurious PD/ND detections.
3. **Voxel-granularity change detection.** Change detection resolution is bounded by voxel size. Sub-voxel geometry differences (paint wear, surface weathering) are invisible.
4. **No object-level tracking.** LT-Mapper detects that a cluster of voxels changed state; it does not track individual object instances across sessions, estimate object trajectories, or associate a disappeared cluster in session N with an appeared cluster in session N+1.
5. **No intra-session dynamic-object recovery.** Objects removed by Removert are gone. Over-aggressive intra-session HD removal can incorrectly strip permanent points near moving objects before they reach the inter-session comparison.
6. **No semantic labels.** Purely geometric. This contrasts with Khronos, which carries per-object class labels throughout.

---

## Part B — Khronos

### Paper Identity

- **Title:** "Khronos: A Unified Approach for Spatio-Temporal Metric-Semantic SLAM in Dynamic Environments"
- **Authors:** Lukas Schmid, Marcus Abate, Yun Chang, Luca Carlone (MIT SPARK Lab)
- **Venue:** Robotics: Science and Systems (RSS) 2024, Delft, paper #081
- **Award:** Outstanding Systems Paper Award, RSS 2024
- **arXiv:** https://arxiv.org/abs/2402.13817 (v2 is the published version)
- **Proceedings PDF:** https://www.roboticsproceedings.org/rss20/p081.pdf
- **Code:** https://github.com/MIT-SPARK/Khronos (ROS2 Jazzy/Iron, Ubuntu 24.04)

**Author-attribution note:** The correct author list is Schmid, Abate, Chang, Carlone. Prior research briefs for this knowledge base incorrectly cited "Andersson, Sulser, Pfreundschuh" — those names appear in related MIT-SPARK work (Pfreundschuh is first author of Panoptic Mapping) but are NOT authors of the Khronos paper. This has been corrected here.

### Problem Formulation: The SMS Problem

Prior SLAM systems treat short-term dynamics (moving persons in the current session) and long-term changes (furniture rearranged between visits) as separate problems requiring separate sub-systems. Khronos introduces the **Spatio-Temporal Metric-Semantic SLAM (SMS) problem** and shows that a single factor-graph formulation — with a well-chosen factorisation — handles both simultaneously.

The full MAP estimate:

```
(O*, X*, Y*, A*) = argmax_{O,X,Y,A}  P(O, X, Y, A | Z, Phi)
```

where Z = {Z^1, ..., Z^T} is the stream of RGB-D observations, Phi is odometry, O is the set of semantic objects each with lifecycle (tau_appear, tau_disappear), X is the robot pose trajectory, Y are object fragments (latent variables), and A is object associations across time.

**Key factorisation introducing fragments Y:**

```
P(O,X,Y,A | Z,Phi) =
    prod_i P(O_i | Y_bar_i, X)         [Fragment reconciliation]
  x P(X, A | Y, Phi)                   [SLAM + association]
  x prod_k P(Y_k | Z_bar_k, Phi_bar_k) [Local estimation]
```

A fragment Y_k is a partial view of an object collected within a short temporal window delta where both odometry error and scene change are bounded by two explicit assumptions:

```
epsilon_s: within window delta, accumulated odometry drift is small
epsilon_t: within window delta, no object enters or exits the scene
```

When either bound is violated — loop closure found, large drift detected, or object disappears — a new fragment is spawned. This creates natural temporal segmentation of the observation stream and keeps the local estimation problem tractable.

### Architecture: Three Coupled Components

#### Active Window (Local Estimation, constant time)

The active window processes the most recent delta seconds of sensor data (empirically delta ~5 s) and operates in constant time regardless of trajectory length.

**Background reconstruction via TSDF fusion:**

```
TSDF(v) <- weighted_average(TSDF(v), new_depth_reading)
```

Static background surfaces are extracted from the TSDF zero-crossing as a mesh M_BG.

**Object tracking within the active window:**

Each observation Z^t_j is a 3-tuple: (Omega^t_j, T_RZ^t_j, L^t_j) — 3D point set, sensor-to-world transform, and semantic label set (from OneFormer for closed-set, or Segment Anything + CLIP for open-set / zero-shot).

A pool of object fragment hypotheses {Y_k} is maintained. Each new observation is associated to the best-matching hypothesis via volumetric IoU in 3D:

```
IoU(Z^t_j, Y_k) = |voxels(Z^t_j) intersect voxels(Y_k)|
                / |voxels(Z^t_j) union voxels(Y_k)|
```

Association priority: (1) semantic match + best IoU; (2) dynamic observation to closest dynamic hypothesis; (3) cross-association by IoU when semantic labels differ.

Fragments exit the pool when the temporal gap exceeds delta. Exited fragments are promoted to the global stage:

```
Filtering thresholds:
  tau_Z = 15 minimum observations for a fragment to be considered valid
  tau_D = 1 m minimum total motion to classify an object as dynamic
```

Objects with total motion > tau_D are stored as **dynamic** point-cloud sequences. Others are reconstructed as **static** TSDF meshes.

**Computational performance** (laptop CPU, i7-12700H): active window runs at 22.2 FPS (45.5 ± 9.2 ms/frame), constant time regardless of map size.

#### Global Optimisation (Deformation Graph)

A deformation graph jointly optimises all long-term quantities. Node types:

| Node type | Symbol | Description |
|---|---|---|
| Robot poses | X = {x_1, ..., x_T} | 6-DoF SE(3) poses |
| Mesh control points | P_M | Sparse set controlling background mesh deformation |
| Fragment poses | T_{WY_k} | 6-DoF pose of each object fragment in world frame |

**Edge types:**

Observed edges E_obs (hard constraints):
- E_XX — odometry constraints (Gaussian noise model)
- E_{P_M P_M} — mesh smoothness and rigidity constraints
- E_{XP_M} — robot-to-mesh (points attached to nearby robot poses)
- E_{XY} — robot-to-fragment (fragment observed from specific pose)

Candidate edges E_can (soft, outlier-rejectable via TLS):
- E_{YY} — fragment-to-fragment association: same object seen in different windows, triggered when two fragments have matching semantic labels and overlapping 3D bounding boxes
- E_LC — loop closure edges from Kimera's LCD module

**Optimisation objective:**

```
T* = argmin [
    sum_{(i,j) in E_obs}  ||T_i^{-1} T_j ominus T_bar_{ij}||^2_{Lambda_{ij}}
  + sum_{(i,j) in E_can}  (omega_{ij} ||T_i^{-1} T_j ominus T_bar_{ij}||^2_{Lambda_{ij}}
                           + (1 - omega_{ij}) c_bar^2)
]

where:
  ominus  = SE(3) logarithm residual
  Lambda  = information matrix
  omega   = binary inlier/outlier variable for candidate edges (TLS)
  c_bar^2 = Truncated Least Squares outlier cost threshold
```

Fragment-to-fragment constraints use diagonal precision matrices with zero rotation weight (only centroid translation constrained) because two views of the same object may carry different orientations.

**Solver:** GTSAM with Graduated Non-Convexity (GNC) for the TLS problem. Triggered only at loop closures; typically < 1 s.

#### Reconciliation (Change Detection and Object Lifecycle)

After global optimisation, Khronos estimates when each object was present in the scene. This post-process runs each time the global map is updated.

**Ray library construction:**

For each background mesh vertex v, Khronos records all robot poses x_k from which v was observed. This builds a global free-space representation — a "library of rays" connecting background surface positions to the sensor viewpoints that confirmed them.

**Geometric evidence queries per fragment point p_f:**

```
d_r = ||(p_q - p_r) x (p_r - p_v)|| / ||p_q - p_r||   (perpendicular distance to ray)
d_d = (p_q - p_r) . (p_v - p_r) / ||p_q - p_r||        (depth distance along ray)

Evidence of presence:  d_r < 30 cm AND d_d consistent with vertex depth
Evidence of absence:   d_d > vertex depth
                       (ray passed through expected location without hitting anything)

Absence threshold: >= 60% of rays in a 5-second window must show absence
                   before the fragment is declared absent at that epoch
```

**Object lifecycle estimation:**

```
tau_appear     = midpoint between:
                  latest timestep with absence evidence before first observation
                  AND first observation timestamp

tau_disappear  = midpoint between:
                  last observation timestamp
                  AND earliest timestep with absence evidence after fragment exit
```

The midpoint assumption minimises expected error under a uniform distribution when the exact transition time is unknown. Each object receives a temporal interval [tau_appear, tau_disappear] with uncertainty bounds.

**Temporal query capability:**

The full spatio-temporal map M_T(t) represents the world as believed at robot time T with belief time t <= T:

```
t = 0,   T = current:  "What did the scene look like at mission start?"
t = T,   T = current:  "What is the current state given all gathered evidence?"
t = 300, T = current:  "Reconstruct the scene at time t = 300 s."
```

### Input Modalities and LiDAR Adaptation

**Primary input: RGB-D (not LiDAR).** Khronos uses Intel RealSense D455 depth cameras (Clearpath Jackal experiment) and depth + IMU (Boston Dynamics Spot experiment). The TSDF fusion front-end and TSDF-based change detection are designed around dense depth images.

**LiDAR adaptation path (architectural inference — not published):** The factor graph back-end (GTSAM) is sensor-agnostic. The ray library concept maps naturally to LiDAR (LiDAR rays are precisely defined). Adaptation would require:

```
1. Replace TSDF fusion front-end with a LiDAR-compatible surface reconstruction
   (VDBFusion, Voxblox+, or projective signed-distance voxel accumulator)
2. Replace OneFormer/CLIP semantic front-end with LiDAR semantic segmentation
   (Cylinder3D, SphereFormer) providing equivalent per-point label streams
3. Retain the GTSAM factor graph back-end unchanged
4. Retain the reconciliation / ray-library approach unchanged
```

The MIT-SPARK group has not published a LiDAR-native Khronos variant as of May 2026. The GitHub README references ROS2 rosbag inputs with RGBD topics; no LiDAR interface exists in the public repository. Statements about LiDAR adaptation in this page are architectural inference only.

### Benchmarks

**Simulated environments (TESSE photo-realistic simulator — not ScanNet or Replica):**

| Dataset | Duration | Trajectory | Static objects | Dynamic objects | Long-term changes |
|---|---|---|---|---|---|
| Apartment | 87 s | 39 m | 64 | 10 | 6 |
| Office | 217 s | 181 m | 196 | 6 | 8 |

Ground-truth 4D labels are generated by the simulator, enabling rigorous evaluation of change detection F1 — a metric that no other prior system was benchmarked on in this way.

**Quantitative results — Apartment scene, ground-truth poses:**

| Category | Precision | Recall | F1 |
|---|---|---|---|
| Background | 96.8% | 87.6% | 91.2% |
| Object instances | 91.4% | 83.9% | 75.3% |
| Dynamic objects | 90.4% | 78.6% | 84.1% |
| Long-term changes | 31.3% | 69.1% | **64.6%** |

**Office scene, Kimera visual-inertial odometry (not ground-truth poses):**

| Category | Precision | Recall | F1 |
|---|---|---|---|
| Background | 83.9% | 60.3% | 67.6% |
| Object instances | 98.3% | 62.4% | 73.1% |
| Dynamic objects | 59.3% | 54.7% | 53.9% |
| Long-term changes | 25.8% | 52.2% | 62.0% |

**Comparison baselines (change detection F1):**

| System | Long-term change F1 | Notes |
|---|---|---|
| Hydra (RSS 2022) | ~30–40% | No dynamic tracking; no lifecycle representation |
| Dynablox (RA-L 2023) | Undefined | Short-term detection only; no long-term change reasoning |
| Panoptic Mapping (RAL 2022) | 56.1% | Best prior baseline; long-term semantic consistency only |
| **Khronos (Apartment)** | **64.6%** | Unified short + long-term; outstanding systems award |

Khronos outperforms the best prior baseline (Panoptic Mapping 56.1%) by +8.5 percentage points on Apartment change detection F1.

**Semantic robustness test:** Open-set CLIP-based clustering vs. ground-truth semantics for change detection: GT gives 69.1% recall / 64.6% F1; CLIP gives 67.2% recall / 64.4% F1. Minimal degradation demonstrates robustness to imperfect segmentation.

**Real-world deployments:**

- Clearpath Jackal + Intel RealSense D455: mezzanine scene (medium-scale indoor area).
- Boston Dynamics Spot: university building corridor with kitchen and common area; a removed chair and an appearing/disappearing cooler were correctly tracked.

**Computational performance** (laptop CPU, i7-12700H):

| Component | Throughput / Latency |
|---|---|
| Active window (constant time) | 22.2 FPS, 45.5 ± 9.2 ms/frame |
| Fragment reconstruction | typically < 1 s per fragment |
| Global optimisation (at loop closures only) | typically < 1 s |
| Background deformation | < 1 s |

The system runs real-time on commodity hardware for environments up to 181 m trajectory length with 196 objects.

### Relation to Hydra (Predecessor)

**Hydra (RSS 2022, Hughes, Chang, Carlone):** arXiv 2201.13360. Hydra builds a 3D scene graph with nodes at multiple abstraction levels (mesh → object instances → rooms → buildings) using a deformation graph for online loop closure. Khronos extends Hydra in three key ways:

1. Adds **fragment pose nodes** T_{WY_k} as first-class graph variables.
2. Adds **fragment-to-fragment association edges** E_YY as candidate soft edges with TLS outlier rejection.
3. Adds the **reconciliation stage** (ray-library change detection) entirely absent from Hydra.

Hydra lacks dynamic-object tracking, has no long-term change representation, and cannot query "what did the scene look like at time t?" Khronos addresses all three. The GitHub organisation MIT-SPARK hosts both systems; Khronos explicitly depends on Hydra infrastructure.

---

## Part C — Integration

### Lifelong vs. Static-but-Transient: How LT-Mapper and Khronos Operationalise the K-of-N Rule

The iter-19 static-but-transient framework (see [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md)) describes two mechanisms for handling the LD problem in aggregated LiDAR maps: the **K-of-N persistence rule** and the **per-voxel temporal-presence model**. LT-Mapper and Khronos are the systems that operationalise these mechanisms.

**LT-Mapper operationalises K-of-N (discrete sessions):**

```
K-of-N persistence rule:
  P(permanent | voxel v) =
    [sum_{i in last N sessions} 1[v occupied in session i]] / N  >= K/N

LT-Mapper PV structure stores the numerator directly:
  voxel v: list of (session_id, occupied) records
  permanent_flag set when occupancy fraction >= K/N
```

LT-Mapper does not expose a configurable (K, N) interface in its current public code, but the Place-Voxel data structure makes threshold adjustment straightforward on top of the existing PD/ND framework.

**Khronos provides the continuous-time analogue:**

Rather than binary occupied/not-occupied per discrete session, Khronos estimates a probabilistic presence interval [tau_appear, tau_disappear] with midpoint estimate and uncertainty bounds. The reconciliation stage's evidence-of-absence criterion (60% of rays in a 5-second window indicate absence) is a soft K-of-N rule in continuous time: a fragment is declared absent only when a sufficient fraction of recent rays confirm it is not there.

**Comparison:**

| Aspect | LT-Mapper K-of-N | Khronos lifecycle |
|---|---|---|
| Temporal model | Discrete sessions; integer occupancy fraction | Continuous trajectory; interval with uncertainty |
| Absence evidence | Set difference after session alignment | Per-ray absence query with 60% windowed threshold |
| Output | Binary permanent/transient flag per voxel | [tau_appear, tau_disappear] with midpoint estimate |
| Precision | Voxel-granularity clusters | Per-object-instance with 3D mesh |
| Semantic content | None | Class label per object |

### The Delta Map as a Curriculum Signal for the Auto-Label Flywheel

The Delta Map M_delta — the (PD_t, ND_t) change sets between consecutive sessions — provides a natural curriculum signal for the aggregated-map auto-labelling pipeline described in [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md).

The logic is as follows:

- **Permanent voxels** (consistent geometry across sessions, high registration confidence) are auto-labelled with high reliability by projecting the consensus semantic map from previously-labelled sessions onto the new session's registered point cloud via nearest-neighbour label transfer.
- **Transient voxels** (PD/ND members) are more likely to be GSE, vehicles, construction equipment, or other operationally variable classes — precisely the classes that are underrepresented in static training sets and that benefit most from additional annotation.

The Delta Map therefore serves as a **priority queue for active learning**: transient voxels are flagged for human review in the next annotation cycle, while permanent voxels are labelled automatically. This directly operationalises the 50–80% labelling cost reduction cited in the core conclusions.

**The auto-label flywheel cycle:**

```
New survey session
  -> LT-SLAM alignment into shared coordinate frame
  -> LT-Removert: classify all voxels as permanent / PD / ND / HD
  -> K-of-N rule on PV structure: permanent vs. transient labelling
  -> Permanent voxels: auto-label via consensus from prior sessions
  -> Transient voxels (Delta Map): flag for active-learning review
  -> Human annotates transient voxels
  -> Add to training set
  -> Retrain segmenter (Cylinder3D, RangeFormer, or equivalent)
  -> Repeat with next session
```

Each cycle improves both the semantic map and the segmenter simultaneously, compounding data efficiency over time.

### Multi-Pass Survey-Drive Integration with the Aggregated-Map Pipeline

For the airside survey-drive use case, LT-Mapper naturally supports a **multi-pass integration** pattern:

```
Pass 1: Initial survey drive of full apron area
  -> SC-LIO-SAM (or FAST_LIO_SLAM + SC plugin) to produce keyframes + SC descriptors
  -> Build per-session point cloud map and pose graph

Passes 2..N: Repeated survey drives (e.g., one per week or after significant operational events)
  -> LT-SLAM: align all sessions into shared frame via SC + ICP
  -> LT-Removert: classify per-voxel as permanent / PD / ND / HD
  -> K-of-N update on PV structure (each pass adds one increment to occupancy fraction)

After K confirming passes:
  -> Promote stable PD voxels to permanent in M_live
  -> Remove ND voxels from M_live; archive in M_meta with timestamp
  -> Export Delta Map as change audit record
```

**Airside relevance — staged GSE quarantine:**

Airport ground service equipment is staged in designated areas but moves between flights. A single survey pass captures a tug or belt loader at its parked position; this point cluster is a PD candidate relative to a reference session where the bay was clear.

With multi-pass integration, the quarantine logic becomes evidence-based rather than class-assumption-based:

```
Bay clear in session 1, 3, 5 (three of five passes):
  -> occupancy fraction = 2/5 < K/N = 3/5
  -> voxel flagged transient, excluded from M_live

Bay clear in sessions 1, 2, 3, 4, 5 (all five passes):
  -> occupancy fraction = 0/5 = 0
  -> voxel flagged permanent-absence (confirmed open bay)

GSE present in sessions 1, 2, 3, 4, 5 (all five passes):
  -> occupancy fraction = 5/5 >= K/N
  -> voxel promoted permanent (semi-permanent installation)
```

This matches the operational reality of airline ramp operations where some GSE positions are truly semi-permanent (ground power units permanently docked at certain gates) while others are highly variable.

### Comparison to Dynamic-Removal Pipelines

Single-session dynamic removal methods (ERASOR, FreeDOM, Removert — see [LiDAR Map Cleaning](lidar-map-cleaning-dynamic-removal.md) and [ERASOR](erasor.md)) operate a clean-then-segment pattern: they remove high-dynamic ghost trails from a single accumulated session to produce a clean static map.

Lifelong methods extend this in a critical dimension:

| Property | Single-session cleaners | Lifelong mappers |
|---|---|---|
| Temporal scope | Single survey session | Multiple sessions; day-to-year gaps |
| What they remove | HD-dynamic: objects moving within a session | HD-dynamic + LD: objects present in some sessions but absent in others |
| Static-but-transient | Not addressed (ERASOR explicitly cannot solve this) | Core capability; K-of-N rule or lifecycle estimation |
| Output | One cleaned static map | Live Map + Meta Map + Delta Map (LT-Mapper) or 4D spatio-temporal map (Khronos) |
| Change evidence | None (single snapshot) | Multi-session occupancy history / ray library |
| Negative changes | Not tracked | ND set / disappearance time estimation |

LT-Removert is Removert-derived — it inherits the intra-session spherical range-image visibility mechanism and the "removed-then-revert" philosophy, then extends it to the inter-session comparison via set difference. This is the direct lineage from [Removert](removert.md) to [ERASOR](erasor.md) (which improved the single-session mechanism) to LT-Removert (which extends to multi-session). For the full single-session dynamic removal benchmark, see [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md).

---

## Strengths

- **Year-scale validated operation.** LT-Mapper demonstrated change detection across a 20-month gap (MulRan KAIST 01 to KAIST 04) — far beyond the capability of any single-session cleaner.
- **Genuine multi-session architecture.** The three-module file-protocol design (LT-SLAM, LT-Removert, LT-MAP) is modular: modules can be upgraded independently. This is a structural advantage for long-running production deployments where front-end SLAM or semantic methods evolve.
- **K-of-N persistence.** The Place-Voxel K-of-N rule provides a principled, tunable mechanism for promoting or demoting map elements based on multi-session evidence rather than binary present/absent from a single pass.
- **Positive and negative change records.** The Delta Map captures both what appeared (PD) and what disappeared (ND) — full bi-directional change audit rather than just removal.
- **Unified short- and long-term dynamics (Khronos).** Khronos addresses moving persons (22 FPS active window) and inter-session changes (reconciliation stage) in one factor graph — a formally justified unification rather than an ad hoc two-stack approach.
- **Object-instance lifecycle with semantic labels (Khronos).** Per-object [tau_appear, tau_disappear] intervals with class identity are directly useful for compliance and operations monitoring.
- **Outstanding Systems Paper recognition.** Khronos received the RSS 2024 Outstanding Systems Paper award, reflecting both technical depth and systems maturity.
- **Both are open-source and actively maintained.** LT-Mapper (ROS Noetic), Khronos (ROS2 Jazzy/Iron).

---

## Failure Modes

1. **Poor multi-session alignment propagates into false changes.** LT-SLAM's SC + ICP pipeline can fail on feature-sparse environments (flat aprons, featureless warehouse aisles). ICP divergence generates spurious PD/ND detections that pollute the Delta Map and eventually corrupt M_live if not caught. Alignment residual monitoring is essential before change reasoning is triggered.
2. **Repeatedly-parked movable objects become permanent.** A GSE asset parked at the same bay for K consecutive passes clears the K/N threshold and is promoted to permanent in M_live — even though it is operationally movable. This is the canonical K-of-N false positive. Mitigation: combine K-of-N evidence with semantic class priors (GSE class lowers effective K/N required for transient promotion).
3. **Rarely-observed static structure is misclassified as removed.** A structure visited in only one of N sessions (e.g., a bollard in a low-frequency route) has occupancy fraction 1/N, which may fall below K/N despite being a permanent fixture. Conservative thresholds and route coverage monitoring are required.
4. **Semantic model failure on site-specific classes.** Khronos's OneFormer/CLIP front-end has not been tested on airside-specific classes (GSE, aircraft nose gear, blast fence, VASIS lights). Open-set CLIP clustering degrades on classes distant from ImageNet/COCO distribution. Site-specific fine-tuning or LiDAR-based segmentation would be required.
5. **Temporal evidence bias.** If survey drives consistently occur at the same time of day or during the same operational phase (e.g., always during early-morning turn-arounds), the multi-session occupancy history is not representative of the full operational envelope. Objects that are only present in the missed time windows will not be detected.
6. **Delta-map complexity growth.** On a site with frequent changes (active construction, daily GSE reconfiguration), the Delta Map's (PD_t, ND_t) history grows with each session. Map publication, rollback, and audit become harder to reason about. A maximum history depth or automated delta summarisation policy is required.
7. **Khronos short-term performance degrades with odometry error.** The Office scene results (Kimera VIO, not ground-truth poses) show dynamic object F1 dropping from 84.1% to 53.9% — a significant degradation. LiDAR-inertial odometry would likely outperform camera VIO here, but no published test confirms this.
8. **LT-Mapper has no RGB channel.** Purely geometric evidence means the system cannot leverage appearance-based cues for change validation. A new wall and a long-parked vehicle are indistinguishable by geometry alone if they occupy similar voxel extent.

---

## Domain Fit

| Domain | LT-Mapper fit | Khronos fit | Notes |
|---|---|---|---|
| Road AV — outdoor urban | Strong | Conditional | LT-Mapper designed and validated here. Khronos needs LiDAR adaptation for outdoor scale. |
| Airside — vehicle-mounted LiDAR survey | Strong | Not directly deployable | LT-Mapper multi-pass quarantine pattern well-suited; Khronos RGB-D-native. |
| Airside — near-field gate-area robot | Conditional | Conditional | Khronos 22 FPS active window handles short-term dynamics; LiDAR adaptation path exists but unpublished. |
| Warehouse — indoor flat | Conditional | Good | Khronos designed and validated here; LT-Mapper lacks semantic labels for indoor asset tracking. |
| Logistics yard — outdoor semi-structured | Strong | Conditional | Multi-session GSE quarantine pattern applies; Khronos needs outdoor scale extension. |
| Port — mixed indoor/outdoor | Conditional | Conditional | Both applicable in principle; crane superstructure and open water complicate geometry-based change detection. |
| Mining / construction | Conditional | Conditional | Rapid terrain change (earthworks) creates false negatives for permanent classification; both systems benefit from site-specific thresholds. |
| Agriculture | Weak | Weak | Seasonal vegetation changes dominate; geometry-only and RGB-D both struggle with consistent feature extraction. |
| Indoor multi-level (multi-floor) | Weak | Strong | LT-Mapper 2D sector-ring structure degrades on stairs; Khronos volumetric IoU tracking is floor-agnostic. |

---

## Aggregated-Map Suitability and the Multi-Pass Survey-Drive Recipe

LT-Mapper's canonical deployment position in an aggregated-map pipeline is:

```
Accumulate sessions
  -> LT-SLAM multi-session alignment
  -> LT-Removert HD + LD classification
  -> LT-MAP K-of-N update
  -> Permanent layer -> segmentation / auto-label
  -> Transient layer (Delta Map) -> active-learning queue
```

This extends the standard single-session pipeline (Accumulate → Clean → Segment → Auto-label, documented in [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md)) by inserting multi-session evidence before segmentation. The result is that the segmentation input is not just intra-session HD-cleaned but is also LD-filtered based on multi-session persistence evidence — a qualitatively cleaner substrate for semantic annotation.

**Recommended multi-pass survey recipe for an airside apron:**

```
Prerequisites:
  - LIO front-end (FAST-LIO2 or SC-LIO-SAM) producing keyframes + SC descriptors per session
  - Minimum 3 survey passes before enabling K-of-N promotion (to avoid early false-permanent decisions)
  - Route coverage analysis: ensure each survey pass covers the full operational footprint

Per-session processing:
  1. LT-SLAM: align new session to existing multi-session graph
     - Monitor inter-session ICP residuals; flag sessions with RMSE > threshold for manual review
  2. LT-Removert: intra-session HD removal, then inter-session PD/ND detection
  3. PV update: increment occupancy counters; apply K-of-N rule
     - Suggested starting point: K/N = 3/5 for permanent promotion
     - GSE semantic class (if available from Cylinder3D): use K/N = 2/5 (lower bar to flag transient)
  4. Delta Map export: record (PD_t, ND_t) with session timestamp, pose source, and sensor ID

Map publication gate:
  5. Run localization regression on M_live against a held-out route
  6. Human review of Delta Map entries with large spatial extent (> 10 m^2)
  7. Publish M_live version with changelog and session provenance
```

For downstream change monitoring of [HD-Map Change Detection and Maintenance](../maps/hd-map-change-detection-maintenance.md), the Delta Map provides the structured change record that change-detection systems require.

---

## Implementation Notes

- **Pose quality is the primary dependency.** LT-SLAM cannot fix poor intra-session registration. Run the LIO front-end with loop closure (SC-LIO-SAM, FAST_LIO_SLAM with SC plugin, or KISS-ICP — see [KISS-ICP](kiss-icp.md)) and verify trajectory ATE before running multi-session alignment.
- **Store session provenance with every map element.** Session ID, timestamp, pose source, sensor serial, cleaner decisions, and map version must accompany each PV entry. Without this, rollback and change attribution are impossible.
- **Conservative K-of-N starting point.** For a new site, start with K/N = 4/5 and lower it if the occupancy history shows that the site is stable. An overly aggressive threshold permanently promotes transient structures into M_live.
- **Semantic class as K/N prior (recommended enhancement).** If a per-point semantic segmenter is available (Cylinder3D, SphereFormer), project class labels onto the PV grid and use class identity to modulate the effective K/N threshold. Infrastructure classes (wall, pole, ground marking) should require high occupancy fraction to be demoted; GSE and vehicle classes should require lower fraction to be flagged transient.
- **LT-Removert's intra-session spherical image parameters need site tuning.** The range tolerance delta_r and the multiresolution levels are calibrated for urban LiDAR sequences (MulRan). On an open apron with few vertical features, the coarse resolution level may generate false positives on ground returns at range. Validate on representative apron segments before production use.
- **Khronos ROS2 dependency.** The public repository requires Ubuntu 24.04 with ROS2 Jazzy or Iron, GTSAM, glog, and nlohmann-json. Pin package versions carefully; the GTSAM interface has breaking changes between versions.
- **Khronos for near-field gate scenarios.** For gate-area monitoring (robot or infrastructure-mounted RGB-D camera), Khronos's 22 FPS active window is adequate for pedestrian tracking and object lifecycle monitoring. Per-object [tau_appear, tau_disappear] records are directly useful for FOD reporting workflows and GSE accountability audits.
- **Do not update production localisation maps automatically.** Gate every M_live version update through a localisation regression test (see [HD-Map Change Detection and Maintenance](../maps/hd-map-change-detection-maintenance.md)). A single false-permanent PD cluster can degrade ICP-based localisation on subsequent passes.
- **ELite (ICRA 2025, arXiv 2502.13452) as the recommended successor.** ELite extends LT-Mapper with Bayesian ephemerality scores epsilon in [0, 1] instead of binary PD/ND classification, providing softer, probabilistic transient labelling. For new deployments where ELite is available and tested, prefer it over vanilla LT-Mapper.
- **Yang et al. 2025 lifelong framework (arXiv 2501.18110) as an alternative.** This framework avoids Scan Context (uses PCA-SHOT + NDT instead) and adds explicit map version control. Consider it for environments where SC descriptor quality is poor (feature-sparse outdoor or adversarial illumination).

---

## Sources

- LT-Mapper arXiv 2107.07712: https://arxiv.org/abs/2107.07712
- LT-Mapper IEEE Xplore (ICRA 2022, pp. 7995–8002): https://ieeexplore.ieee.org/document/9811916
- LT-Mapper GitHub (gisbi-kim/lt-mapper): https://github.com/gisbi-kim/lt-mapper
- LT-Mapper ICRA 2022 talk (YouTube): https://www.youtube.com/watch?v=pFTwZpe3a6Q
- Removert (IROS 2020) GitHub: https://github.com/gisbi-kim/removert
- Scan Context (IROS 2018): https://gisbi-kim.github.io/publications/gkim-2018-iros.pdf
- Scan Context++ (TRO 2021): https://gisbi-kim.github.io/publications/gkim-2021-tro.pdf (note: this URL returned 404 in a recent session; use arXiv or Semantic Scholar as fallback)
- MulRan dataset (IEEE Xplore 9197298): https://ieeexplore.ieee.org/document/9197298/
- Khronos arXiv 2402.13817: https://arxiv.org/abs/2402.13817
- Khronos arXiv HTML v2 (full text): https://arxiv.org/html/2402.13817v2
- Khronos RSS 2024 proceedings PDF: https://www.roboticsproceedings.org/rss20/p081.pdf
- Khronos RSS 2024 programme page: https://roboticsconference.org/2024/program/papers/81/
- Khronos RSS 2024 Outstanding Systems Paper Award: https://roboticsconference.org/2024/program/awards/
- Khronos GitHub (MIT-SPARK): https://github.com/MIT-SPARK/Khronos
- Hydra arXiv 2201.13360: https://arxiv.org/abs/2201.13360
- Hydra GitHub (MIT-SPARK): https://github.com/MIT-SPARK/Hydra
- ELite (ICRA 2025): https://arxiv.org/abs/2502.13452
- Yang et al. lifelong framework (2025): https://arxiv.org/abs/2501.18110
- POCD probabilistic object-level change detection (RSS 2022): https://arxiv.org/abs/2205.01202
- MIT AeroAstro Khronos news: https://aeroastro.mit.edu/news-impact/khronos-4d-spatio-temporal-perception-for-autonomous-robots/
- Luca Carlone MIT page: https://lucacarlone.mit.edu
- Related method page: [LiDAR Map Cleaning — Dynamic Removal](lidar-map-cleaning-dynamic-removal.md) — single-session pipeline that lifelong methods extend
- Related method page: [ERASOR](erasor.md) — canonical single-session cleaner; Removert lineage ancestor of LT-Removert
- Related method page: [Removert](removert.md) — LT-Removert is directly derived from Removert (IROS 2020)
- Related method page: [Scan Context Family](scan-context-family.md) — SC descriptor used by LT-SLAM
- Related method page: [KISS-ICP](kiss-icp.md) — recommended LIO front-end for LT-Mapper integration
- Related method page: [FreeDOM](freedom-dynamic-object-removal.md) — current best-published F1 for single-session cleaning; complements lifelong approach
- Related method page: [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md) — cross-method evaluation for single-session cleaners
- Related method page: [Object-Level SLAM](object-level-slam.md) — Khronos's fragment tracking is closely related
- Related method page: [Semantic SLAM](semantic-slam.md) — Khronos's semantic labelling path
- Related overview page: [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md) — canonical treatment of the LD problem that LT-Mapper and Khronos address
- Related overview page: [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) — downstream pipeline hub; Delta Map feeds the active-learning queue
- Related maps page: [HD-Map Change Detection and Maintenance](../maps/hd-map-change-detection-maintenance.md) — Delta Map feeds structured change records here
- Related maps page: [ArgoTweak Self-Updating HD-Map Priors](../maps/argotweak-self-updating-hd-map-priors.md) — complementary online HD-map update approach
