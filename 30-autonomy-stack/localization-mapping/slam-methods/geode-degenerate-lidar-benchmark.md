# GEODE Degenerate LiDAR Benchmark

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "benchmark"
  stage: "reference"
  maturity: "fielded-pattern"
  tags: ["slam", "validation", "data-engine", "outdoor"]
  reason: "GEODE Degenerate LiDAR Benchmark is rated as a SLAM benchmark or reference page for comparing methods and deployments."
method-priority:end -->

Related method pages: [GenZ-ICP and GenZ-LIO](./genz-icp-genz-lio.md) (iter 38), [KISS-ICP](./kiss-icp.md) (iter 20), [FAST-LIO and FAST-LIO2](./fast-lio-fast-lio2.md) (iter 22), [KISS-SLAM](./kiss-slam.md) (iter 32), [Continuous-Time Registration](./continuous-time-registration.md) (iter 36), [MOLA](./mola.md), [LIO-SAM](./lio-sam.md), [Dynamic Map Cleaning Benchmarks](./dynamic-map-cleaning-benchmarks.md) (iter 21), [Benchmarking Metrics and Datasets](./benchmarking-metrics-datasets.md).

Related overview pages: [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [Large-Scale 3D Segmentation Benchmarks](../../perception/datasets-benchmarks/large-scale-3d-segmentation-benchmarks.md) (iter 2).

Related KB pages: [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md), [Multi-Sensor Calibration and Observability](../../../10-knowledge-base/geometry-3d/multi-sensor-calibration-observability.md) (iter 15).

**Last updated:** 2026-05-24

---

## What It Is

**GEODE** — short for the project tagline "Extending the Robustness of LiDAR SLAM to Geometrically Degenerate Scenarios" — is a heterogeneous multi-LiDAR benchmark dataset for evaluating robust localization in environments where standard scan-matching collapses. The full paper title is:

> **"Heterogeneous LiDAR Dataset for Benchmarking Robust Localization in Diverse Degenerate Scenarios"**

**Citation:**

| Field | Value |
|---|---|
| Short name | GEODE |
| Authors | Zhiqiang Chen, Yuhua Qi (corresponding), Dapeng Feng, Xuebin Zhuang, Hongbo Chen, Xiangcheng Hu, Jin Wu, Kelin Peng, Peng Lu |
| Affiliations | Sun Yat-sen University; University of Hong Kong; HKUST; University of Science and Technology Beijing |
| arXiv ID | 2409.04961 (v1: September 8 2024; v2: September 10 2024) |
| Journal | International Journal of Robotics Research (IJRR) |
| Published online | June 9, 2025 |
| Issue | IJRR Volume 45, Issue 1, pages 6–22 (January 2026) |
| DOI | https://doi.org/10.1177/02783649251344967 |
| arXiv | https://arxiv.org/abs/2409.04961 |
| arXiv HTML v2 | https://arxiv.org/html/2409.04961v2 |
| GitHub | https://github.com/PengYu-Team/GEODE_dataset |
| Project website | https://thisparticle.github.io/geode/ |
| Google Drive | https://drive.google.com/drive/folders/1hEn3sBAvQhSdUFnGMZCCv-W0Ynj2rWBs |
| China mirror | Baidu NetDisk pan.baidu.com/s/19t2WhhUvNnNqKX0zLDhRIA (password: sysu) |
| Evaluation script | `rmse.py` in the GitHub repository |

**Disambiguation note:** The word "GEODE" does not appear in the IJRR title, but the GitHub repository name `PengYu-Team/GEODE_dataset`, the project website `thisparticle.github.io/geode`, and the community universally use "GEODE" as the canonical handle. There is no other dataset matching the description (heterogeneous multi-LiDAR, degenerate-environment benchmark, September 2024 IJRR submission). The placeholder URL `geode.github.io` returns "Hello World" and is not the project site; use `thisparticle.github.io/geode`.

---

## Core Technical Idea

### The Gap in Existing Benchmarks

Standard LiDAR SLAM benchmarks are recorded in environments with rich geometric structure. When the local scene provides dense orthogonal constraints in all six degrees of freedom, the ICP Hessian `H = Σ J_i^T J_i` is well-conditioned and even vanilla point-to-plane ICP succeeds. The problem is hidden.

The degenerate case is structurally different. In a long corridor, metro tunnel, or bridge span, wall normals all point perpendicular to the motion axis. The translational Hessian block collapses in the along-axis direction. The condition number `κ = λ_max / λ_min` of the Hessian grows without bound. Per-frame drift along the unconstrained axis is unbounded, and over hundreds of metres this produces trajectory errors measured in tens of metres. See [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md) for the normal-equations derivation.

GEODE fills the benchmark gap by providing 64 trajectories across seven degeneracy-type categories, three heterogeneous LiDAR sensor configurations, and four platform types — enabling systematic evaluation of where SLAM methods succeed and where they fail. The paper explicitly positions itself as **"the first publicly available dataset that integrates multiple LiDARs, various scenarios, and is specifically designed to highlight LiDAR degeneracies."**

### Connection to GenZ-ICP/LIO

The benchmark is the natural evaluation complement for degeneracy-aware methods such as those described in [GenZ-ICP and GenZ-LIO](./genz-icp-genz-lio.md) (iter 38). GenZ-ICP (submitted November 2024, one month after GEODE v1) pre-dates the dataset and uses SubT-MRS Long_Corridor and Ground-Challenge corridors as its primary degeneracy benchmarks. GenZ-LIO (March 2026 pre-print) is expected to evaluate on GEODE but this was not confirmed at research date. D²-LIO (arXiv:2508.14355, 2025), a directional-degeneracy LIO that is architecturally similar to GenZ-LIO, explicitly evaluates on five GEODE sequences and is currently the strongest published method on the tunnel subset.

---

## Dataset Composition

### Summary Statistics

| Statistic | Value |
|---|---|
| Total sequences | 64 trajectories |
| Total distance | > 64 km |
| Total duration | > 25,000 seconds (~7 hours) |
| Platforms | 4 (handheld, UGV, sailboat, traditional vehicle) |
| LiDAR configurations | 3 heterogeneous devices (α, β, γ) |
| Scenario categories | 7 |
| Total dataset size | 494.4 GB |

### Scenario Breakdown

| Scenario | Sequences | Size (GB) | Duration (s) | Distance (m) | Degeneracy type |
|---|---|---|---|---|---|
| Flat Ground | 2 | 1.5 | 170 | 108 | 2 translational + 1 rotational |
| Stairs | 3 | 17.6 | 1,066 | 902 | 1 translational |
| Metro Tunnels | 23 | 153.1 | 6,615 | 7,525 | 1 translational + 1 rotational |
| Offroad | 21 | 152.0 | 8,112 | 12,829 | 2 translational + 1 rotational |
| Inland Waterways | 9 | 147.3 | 7,436 | 15,869 | 1 translational |
| Urban Tunnel | 3 | 10.6 | 961 | 12,975 | 1 translational |
| Bridges | 3 | 12.3 | 1,174 | 14,324 | 1 translational |
| **Total** | **64** | **494.4** | **25,534** | **64,532** | |

### Metro Tunnel Sub-types

The metro tunnel category (23 sequences, the largest in the dataset) is sub-divided by construction method. This distinction matters because it determines the severity of degeneracy:

**Shield-method tunnels** — smooth circular concrete walls from tunnel-boring machine construction. These represent extreme degeneracy: nearly all evaluated methods fail completely. The smooth lining provides no planar variation along the tunnel axis, making this the closest real-world analog to the idealised "infinite cylinder" degeneracy model.

**Mine-tunneled sections** — irregular rock and concrete profile. Moderate degeneracy: the irregular surfaces provide partial geometric constraint along the axis. Methods achieve 0.11–0.27 m ATE on mine-tunneled sequences when they do not fail entirely.

This distinction is directly relevant to airside applications — a jet-bridge interior is geometrically closer to the shield-tunnel end of the spectrum (smooth metal walls, uniform rectangular cross-section, featureless ceiling) than to the mine-tunneled variant.

### Sensor Specifications

GEODE uses three heterogeneous LiDAR acquisition devices sharing a common camera and IMU backbone. The heterogeneous design tests whether degeneracy-robust algorithms generalise across rotating (sequential scan) and non-repetitive (Livox) scan patterns.

**Common to all three devices:**
- Stereo camera: HikRobot MV-CS050-10GC — 1224 × 1024 px, 10 Hz, global shutter
- External IMU: Xsens MTi-30 AHRS — 100 Hz; gyro noise 0.03 °/s/√Hz; accel noise 60 µg/√Hz
- Hardware synchronisation: FPGA-based via GNSS 1 PPS signal

**Device α — Velodyne VLP-16:**
- 16 scan lines; range 120 m; vertical FOV 30°; horizontal FOV 360°; 10 Hz

**Device β — Ouster OS1-64:**
- 64 scan lines; range 100 m; vertical FOV 45°; horizontal FOV 360°; 10 Hz
- Embedded IMU: InvenSense ICM-20948 at 100 Hz

**Device γ — Livox AVIA (non-repetitive scan pattern):**
- Range 450 m; vertical FOV 30°; horizontal FOV 360°; 10 Hz
- Embedded IMU: BMI088 at 200 Hz

**Livox vs spinning sensors in degeneracy.** Livox's non-repetitive pattern accumulates denser coverage over time (the beam direction rotates within the FOV per frame), which can theoretically build up constraint along degenerate axes that a spinning scanner sees only from fixed angular offsets. In practice, the GEODE results show Livox (Device γ) failing completely on staircase sequences where Device β (OS1-64) achieves 0.38–0.41 m ATE. The non-repetitive pattern does not generically solve degeneracy. See [Multi-Sensor Calibration and Observability](../../../10-knowledge-base/geometry-3d/multi-sensor-calibration-observability.md) for observability analysis across sensor types.

### Data Format

ROS bag files with timestamped point clouds (x, y, z, intensity and sensor-specific fields), stereo camera images, IMU readings, and per-device calibration parameters. FPGA-based hardware synchronisation via GNSS 1 PPS signal ensures sub-millisecond timestamp alignment at the hardware level; software timestamp assignment introduces variable but bounded latency.

### Ground Truth by Scenario

| Scenario | Ground-truth method | Accuracy |
|---|---|---|
| Flat Ground | Vicon motion capture (Vero 2.2, 330 Hz max) | ±1 mm |
| Stairs | Leica RTC360 3D laser scanner + PALoc map-based SLAM | mm-level |
| Metro Tunnels | Leica Nova MS60 laser tracker at 10 Hz + hand-eye calibration | ±1 mm |
| Offroad / Waterways / Urban Tunnels / Bridges | CHCNAV CG610 RTK-INS, 100 Hz, 6-DoF | ±1 cm position |

The ground-truth approach is matched to what is achievable per environment: mm-level laser tracker for indoor tunnels where GNSS is unavailable; RTK-INS for outdoor sequences where 1 cm absolute accuracy is achievable and sufficient.

---

## Evaluation Metrics

### Primary Metric: Absolute Trajectory Error (ATE)

GEODE uses **Absolute Trajectory Error (ATE)** in metres — root-mean-square error over all timestamped poses after 6-DoF alignment. Computed via the `rmse.py` script in the GitHub repository. ATE is an aggregate metric: it does not decompose drift by axis or direction.

**Important limitation:** The GEODE paper does not report relative pose error (RPE) or per-axis drift. The evaluation framework does not decompose error into constrained versus unconstrained Hessian eigenvector directions. This means a method that drifts entirely along the degenerate axis (the expected failure mode) is not separated from a method that drifts uniformly in all directions. Future benchmarks in this class should adopt per-axis drift reporting decomposed along the constrained and unconstrained eigenvectors of the ICP Hessian — as proposed implicitly in the GenZ-ICP condition-number analysis ([GenZ-ICP/LIO](./genz-icp-genz-lio.md) iter 38, section on observability metrics).

### Degeneracy Classification (Table 3 in Paper)

Rather than per-axis drift decomposition, GEODE uses a qualitative classification of which DoF are degenerate per scenario:

| Scenario | Degenerate axes |
|---|---|
| Flat Ground | 2 translational (X, Y) + 1 rotational (yaw) |
| Stairs | 1 translational (along-stair axis) |
| Metro Tunnels | 1 translational (along-tunnel) + 1 rotational (roll/pitch) |
| Offroad | 2 translational + 1 rotational (sparse open terrain) |
| Inland Waterways | 1 translational (along-channel) |
| Urban Tunnel | 1 translational (along-tunnel) |
| Bridges | 1 translational (along-bridge) |

This classification aligns with the Hessian eigendecomposition framework: a degenerate axis corresponds to a near-zero eigenvalue direction in the translational Hessian sub-block.

### Failure Detection

Binary failure indicator: methods that fail to complete trajectory estimation or produce anomalously high ATE are marked with a failure symbol (✗) in the results tables. No partial-trajectory or recoverable-failure distinction is made.

### No Online Leaderboard

GEODE does not maintain an online leaderboard. Results are evaluated as a static table in the published paper. This limits tracking of new methods against a living standard, unlike the KITTI odometry leaderboard or the KTH DynamicMap Benchmark GitHub leaderboard ([Dynamic Map Cleaning Benchmarks](./dynamic-map-cleaning-benchmarks.md) iter 21). Community adoption will depend on authors self-reporting against the published baselines using the provided `rmse.py` script.

---

## Evaluated Methods and Benchmark Results

### Methods Tested in the GEODE Paper

The GEODE paper evaluates seven to eight state-of-the-art LIO and multi-sensor SLAM systems. The arXiv v1 abstract lists seven; the project website lists eight (adding FAST-LIVO and Coco-LIC); the IJRR published version (pages 6–22) likely contains the most complete set. The best freely accessible source is the arXiv HTML v2 (`arxiv.org/html/2409.04961v2`).

| Method | Fusion | Degeneracy handling |
|---|---|---|
| FAST-LIO2 | LiDAR + IMU | None explicit; IMU prior implicitly constrains degenerate axes |
| LIO-SAM | LiDAR + IMU | Optimization-based detection + pose remapping |
| DLIO | LiDAR + IMU | None explicit; continuous-time trajectory estimation |
| COIN-LIO | LiDAR + IMU + Intensity | Geometric patch selection using reflectivity |
| R3LIVE | LiDAR + IMU + Camera | None explicit; RGB-coloured point map fusion |
| LVI-SAM | LiDAR + IMU + Camera | Optimization-based detection + pose remapping |
| RELEAD | LiDAR + IMU + Camera | Explicit 6-DoF degeneracy detection + CESIKF + failure-tolerant multi-sensor fusion |

See [LIO-SAM](./lio-sam.md) and [FAST-LIO and FAST-LIO2](./fast-lio-fast-lio2.md) for the individual method details.

### Representative Results (ATE in metres; ✗ = failure/did not complete)

**Offroad sequences (Device β, OS1-64):**
- FAST-LIO2: 0.09–0.39 m (best performer on offroad)
- RELEAD: 0.08–0.25 m (competitive)
- LIO-SAM: failed on 6 of 7 sequences

**Metro tunnel — mine-tunneled sections (moderate degeneracy):**
- Most methods: 0.11–0.27 m ATE
- Shield-method sequences (severe): universal failure across all methods except RELEAD, which achieved 1.43–79.63 m (highly variable; essentially unreliable at the severe end)

**Inland waterways:**
- FAST-LIO2: up to 70.26 m on long sequences (water surface reflections plus absence of vertical constraints cause catastrophic drift)
- DLIO: 0.15–13.25 m
- RELEAD: 5.59–22.81 m

**Stairs (Device β):**
- FAST-LIO2: 4.69 m
- DLIO: 0.38–0.41 m
- RELEAD: 0.21–0.57 m
- Device γ (Livox AVIA): complete failure

**Bridges and urban tunnels:**
- Comprehensive failure across all evaluated methods. Geometric repetitiveness and feature sparsity defeat all approaches.

**Flat ground:**
- Only RELEAD succeeded (0.26–1.17 m with Device γ).

### Central Finding

The benchmark's most important result: **even SLAM methods specifically designed for robustness — RELEAD with its explicit 6-DoF degeneracy detection, LIO-SAM with its pose-remapping module — fail comprehensively on the most severe degenerate sequences** (shield tunnels, bridges, flat ground). No single method reliably handles all seven scenario categories. This is the gap the dataset exposes.

### D²-LIO: Best Published Results on GEODE (Subsequent Paper)

D²-LIO (arXiv:2508.14355, 2025) — a directional-degeneracy-aware LIO — explicitly evaluates on five GEODE sequences as a primary benchmark and currently holds the best published ATE on the tunnel subset:

| Sequence | FAST-LIO2 | LIO-SAM | PV-LIO | VoxelMap | D²-LIO |
|---|---|---|---|---|---|
| Tunnel-2 | 0.14 m | 0.13 m | 0.16 m | 0.13 m | **0.10 m** |
| Tunnel-3 | 0.17 m | 0.17 m | 0.22 m | 0.19 m | **0.14 m** |
| Offroad-1 | 0.12 m | 0.15 m | 0.26 m | 0.19 m | **0.12 m** |
| Offroad-3 | 0.34 m | — | 0.24 m | 0.22 m | 0.75 m |
| Water-short | 0.29 m | 0.32 m | 0.12 m | — | 0.31 m |

D²-LIO leads on the tunnel sequences but is not uniformly best; FAST-LIO2 and PV-LIO outperform it on Offroad-3 and Water-short respectively.

### GenZ-ICP and GenZ-LIO Status on GEODE

**GenZ-ICP** (arXiv:2411.06766, RA-L 2025) pre-dates GEODE and evaluated on SubT-MRS Long_Corridor (1.69 m ATE) and Ground-Challenge corridors. GEODE was not available at GenZ-ICP submission time; GEODE evaluation has not been confirmed in subsequent publications at research date.

**GenZ-LIO** (arXiv:2603.16273, pre-print March 2026) was not confirmed to benchmark on GEODE in the pre-print at research date. Given the architectural alignment (ESIKF with hybrid residuals for degenerate axes), GenZ-LIO is a strong candidate for GEODE evaluation in a future revised or published version. Monitor the arXiv page and https://github.com/cocel-postech.

### RELEAD: Best Baseline in the Original Paper

RELEAD (arXiv:2402.18934) is the most competitive method in the GEODE paper's own evaluation. It is a co-developed method from overlapping author networks. Key features:

- **6-DoF degeneracy detection module:** analyses alignment strength per DoF using Hessian eigendecomposition.
- **CESIKF** (Constrained Error-State Iterated Kalman Filter): combines ill-conditioned direction detection with constrained filter updates, freezing degenerate axes — similar in spirit to X-ICP's explicit null-space approach.
- **Failure-tolerant multi-sensor fusion:** falls back to camera plus IMU when LiDAR is degenerate.

RELEAD is not a pure LiDAR method — it requires camera and IMU as fallback sensors. Its GEODE results still show failure or high variability on the most severe sequences. No open-source code confirmed at research date.

---

## Comparison with Other LiDAR Benchmarks

### Benchmark Landscape Table

| Benchmark | Year | Sequences | Sensors | Primary use case | Degeneracy coverage | Ground truth |
|---|---|---|---|---|---|---|
| KITTI | 2012 | 22 | Velodyne HDL-64E | Urban AV odometry | None (rich geometry) | GNSS/INS |
| MulRan | 2020 | 12 | Velodyne VLP-16, OS1 | Multi-session urban | Minimal | GNSS/INS |
| Newer College | 2020 | 9 | OS1-64 | Campus indoor/outdoor | Partial (short corridors) | Leica survey |
| SubT-MRS | 2022 | ~30 | Multiple (mainly spinning) | Underground mines/caves | Long_Corridor (1 sequence) | Varies |
| Hilti SLAM | 2022 | 36 | Rotating + solid-state | Construction sites | Partial (Exp07 incidentally) | Leica tracker |
| HeLiPR | 2023 | 144 | Ouster/Velodyne/Livox/Aeva | Cross-sensor place recognition | None | GNSS/INS |
| KTH DynamicMap (iter 21) | 2023 | ~30 | Ouster OS0-128 | Dynamic object removal | None (dynamic focus) | Aerial LiDAR survey |
| GEODE | 2024 | 64 | VLP-16 / OS1-64 / Livox AVIA | Degeneracy-diverse SLAM | Comprehensive (7 types) | RTK/INS + Leica + Vicon |

**HeLiMOS** (IROS 2024) targets moving-object segmentation across heterogeneous LiDARs — complementary to both GEODE and KTH DynamicMap but on a different axis (dynamic actors vs degenerate geometry). It is referenced in [Dynamic Map Cleaning Benchmarks](./dynamic-map-cleaning-benchmarks.md) (iter 21).

### Key Differentiators

**GEODE vs KITTI/MulRan.** GEODE is not a driving benchmark. It does not replace KITTI for normal-scene odometry evaluation. It exposes failures that KITTI cannot reveal because KITTI's rich urban geometry keeps the ICP Hessian full-rank throughout.

**GEODE vs SubT-MRS Long_Corridor.** SubT-MRS provides one canonical corridor sequence with one LiDAR type in an underground mine environment. GEODE provides 23 tunnel sequences across three LiDAR types and two tunnel construction methods, plus six other degeneracy categories. For the specific problem of corridor-type degenerate SLAM, GEODE is a strict superset of what Long_Corridor covers. Long_Corridor remains the standard for rapid method comparison because it is a single well-known sequence; GEODE is the comprehensive evaluation.

**GEODE vs Hilti SLAM Challenge.** Hilti targets construction-site platforms (handheld, legged robot) and is not structured around degeneracy axis classification. The Exp07 sequence is incidentally challenging but the benchmark as a whole does not systematically probe degenerate geometry.

**GEODE vs HeLiPR.** HeLiPR covers heterogeneous LiDAR place recognition in urban driving environments. Complementary scope, different objective, no degeneracy coverage.

**GEODE vs KTH DynamicMap (iter 21).** KTH DynamicMap targets dynamic object removal and map cleaning in pedestrian-rich urban scenes. Completely orthogonal scope to GEODE. A production SLAM stack needs to pass both: clean maps (KTH DynamicMap family) and degenerate-environment robustness (GEODE). Neither substitutes for the other.

---

## Strengths and Limitations

### Strengths

- **First publicly available multi-LiDAR degenerate-environment benchmark.** No prior dataset systematically covers diverse degeneracy types across heterogeneous sensor configurations.
- **Seven distinct degeneracy categories** spanning single-DoF (along-tunnel) to three-DoF (flat open ground) failure modes, enabling per-category analysis that single-corridor datasets cannot provide.
- **Heterogeneous sensor design** (VLP-16, OS1-64, Livox AVIA) tests cross-sensor generalisability of degeneracy-robust algorithms in a way that single-sensor datasets cannot.
- **High-accuracy ground truth** — Leica laser tracker (±1 mm) in tunnels, Vicon (±1 mm) for flat ground, RTK-INS (±1 cm) for outdoor sequences. Ground truth is matched to environment constraints.
- **Large scale** — 64 trajectories, 64 km, 7 hours of data across four platform types.
- **Evaluation tooling** — `rmse.py` provided; ROS bag format compatible with standard SLAM evaluation infrastructure.

### Limitations

- **No per-axis drift metric.** Only aggregate ATE is reported. The benchmark does not decompose error along constrained versus unconstrained ICP Hessian eigenvectors, which would be the most informative metric for degeneracy-aware methods.
- **No online leaderboard.** Results are a static paper table. New methods must self-report against the published baselines; there is no community-maintained ranking.
- **Camera exposure fixed.** Fixed camera exposure settings cause underexposure in low-light tunnel sequences. Visual-inertial methods are disadvantaged by this.
- **Single calibration per device.** Calibration performed once across a week-long collection campaign. Recalibration is recommended for high-precision use. See [Multi-Sensor Calibration and Observability](../../../10-knowledge-base/geometry-3d/multi-sensor-calibration-observability.md).
- **Software timestamp latency.** GNSS 1 PPS synchronises hardware clocks, but software timestamp assignment introduces variable latency not fully characterised in the paper.
- **No airside sequences.** Airport taxiways, runways, jet bridges, and terminal corridors are not directly included. The mapping to airside scenarios requires analogical reasoning from the existing scenario types (see below).
- **Full per-sequence tables behind paywall.** Complete per-sequence ATE for all 64 trajectories are in the IJRR paper. The arXiv v2 HTML provides per-scenario ranges but not all individual sequence numbers.

---

## Use Cases in the Research Community

### How Papers Use GEODE

Papers published after September 2024 cite GEODE in two roles:

**Primary benchmark for new degeneracy-aware methods.** D²-LIO (arXiv:2508.14355, 2025) uses five GEODE sequences as its central degeneracy evaluation, reporting the best available ATE on the tunnel subset. This is the expected use pattern for new LIO designs targeting degenerate environments.

**Motivation and gap justification.** Papers frame the GEODE results — specifically the universal failure on shield-tunnel and bridge sequences — as motivation for new methods. The lack of any method achieving robust performance across all seven categories creates an open benchmark target.

### Notable Non-Use

**LODESTAR** (arXiv:2511.09142, RA-L November 2025) — despite being a degeneracy-aware LIO — does not evaluate on GEODE. LODESTAR benchmarks on 2021 HILTI, 2022 HILTI, NTU-VIRAL, Newer College, and SubT-MRS. This may reflect timeline (LODESTAR submitted November 2024, one month after GEODE) or a deliberate benchmark choice. GEODE evaluation of LODESTAR would be informative.

---

## Domain Fit

### Scenario Analog Table

| Domain | Relevant GEODE scenarios | Primary degeneracy | Notes |
|---|---|---|---|
| Airside — jet bridge / finger pier | Metro tunnel (shield method) | 1 translational (along-pier) | Smooth metal walls, uniform cross-section; closest analog to shield tunnel |
| Airside — terminal approach tunnel | Urban Tunnel | 1 translational (along-tunnel) | Direct match |
| Airside — elevated taxiway / runway over-crossing | Bridge | 1 translational (along-span) | Repetitive linear structure |
| Airside — taxiway straight / runway | Flat Ground | 1–2 translational + 1 rotational | Open tarmac harder than GEODE offroad (no surface variation) |
| Airside — open apron | Offroad (partial) | 2 translational + 1 rotational | Apron is harder; no vegetation, no surface variation; RTK mandatory |
| Warehouse — long aisle | Metro tunnel (mine-tunneled) | 1 translational (along-aisle) | Rack geometry provides moderate constraint |
| Mining — underground tunnel | Metro tunnel (shield / mine) | 1 translational + 1 rotational | Direct match |
| Construction — corridor / ramp | Stairs, Urban Tunnel | 1 translational | Partial match depending on geometry |
| Road AV — underpass / bridge | Urban Tunnel, Bridge | 1 translational | Short degeneracy episodes; KITTI methods generally sufficient |

### Airside Detail

**The shield-tunnel failure mode is the most directly relevant to airside SLAM.** Every currently evaluated SLAM method fails on GEODE shield-tunnel sequences. A jet bridge is functionally a moving shield-tunnel: smooth metallic walls, uniform cross-section, featureless ceiling, no ground surface variation.

**Open apron is harder than GEODE offroad.** The GEODE offroad category represents sparse vegetation and uneven terrain. An open airport apron provides only 2D texture from painted markings (no 3D geometry variation on smooth asphalt). The 2 translational + 1 rotational degeneracy classification for offroad applies to open aprons, but the actual geometric constraint is weaker. RTK/GNSS remains mandatory for open-apron navigation; LiDAR odometry alone will fail regardless of method.

---

## Aggregated-Map Suitability

GEODE is not a mapping method — it is a **pre-deployment evaluation gate** for selecting and validating LIO and scan-matching front-ends before they are used in aggregated-map-building pipelines.

### Recommended Evaluation Protocol for Airside SLAM

A minimum viable airside degeneracy evaluation should include:

1. **GEODE shield-tunnel sequences** — simulates jet bridge interior and terminal finger pier
2. **GEODE flat-ground sequences** — simulates taxiway straight
3. **GEODE bridge sequences** — simulates elevated taxiway
4. **SubT-MRS Long_Corridor** — the established 1-DoF corridor baseline for comparison
5. **Ground-Challenge Corridor1/Corridor2** — shorter indoor corridors (terminal passages)

Methods to evaluate against this suite:

| Stack configuration | Recommended front-end | Rationale |
|---|---|---|
| LiDAR-only (no IMU) | GenZ-ICP | Best available open-source corridor-robust LO; 4× over KISS-ICP on Long_Corridor |
| LiDAR + IMU | GenZ-LIO (when available) or FAST-LIO2 | IMU prior constrains degenerate axes; GenZ-LIO adds adaptive voxel sizing for scale transitions |
| Multi-sensor (LiDAR + IMU + camera) | RELEAD | Only published method with explicit 6-DoF degeneracy detection + fallback; note partial failure on most severe sequences |
| RTK-aided (open apron) | RTK/GNSS primary, any LO as refinement | No LO/LIO handles multi-DoF translational degeneracy; external constraint is mandatory |

For RTK-aided stacks, test with and without GPS corrections to quantify the IMU prior's contribution on degenerate axes. A stack that passes GEODE without GPS corrections is genuinely degeneracy-robust; one that relies on RTK in tunnel sequences is using the GPS to paper over the degeneracy.

### Pipeline Position

```
[GEODE evaluation gate]
  |
  ├── Shield-tunnel sequences  → LIO candidate selection
  ├── Flat-ground sequences    → taxiway-analog validation
  ├── Bridge sequences         → elevated-structure validation
  |
  ▼
Selected LIO front-end (e.g. GenZ-ICP or FAST-LIO2)
  |
  ▼
Aggregated point cloud (post loop closure + RTK prior)
  |
  ▼
Semantic segmentation and map QA
  |
  ▼
Airside semantic map (markings, obstacles, gates, apron surfaces)
```

Cross-reference: [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) for the downstream segmentation pipeline.

---

## Implementation Notes

- **Use arXiv HTML v2 for baseline numbers.** The arXiv v2 HTML (`arxiv.org/html/2409.04961v2`) is the best freely accessible source and contains per-scenario ATE ranges. Full per-sequence tables for all 64 trajectories are in the IJRR paper (institutional access or author pre-print required).
- **Download via Google Drive or Baidu NetDisk.** The Google Drive link (`drive.google.com/drive/folders/1hEn3sBAvQhSdUFnGMZCCv-W0Ynj2rWBs`) is the primary download. China-region users should use the Baidu NetDisk mirror (password: sysu).
- **Use the provided `rmse.py` script** for ATE evaluation to ensure comparability with published numbers. Do not use a different ATE implementation unless reporting results alongside numbers from `rmse.py` for cross-check.
- **Report sensor subset explicitly.** Because GEODE provides three LiDAR configurations, any new evaluation must clearly state which device (α/β/γ, i.e., VLP-16/OS1-64/Livox AVIA) was used and whether the external IMU, embedded IMU, or no IMU was used. Numbers from different device/IMU combinations are not directly comparable.
- **Recalibrate if using for high-precision work.** The dataset uses a single calibration per device across a week-long collection. For precision LiDAR-inertial odometry, verify or re-derive LiDAR-IMU extrinsics on a local calibration target before deployment.
- **Flag shield-tunnel sequences separately.** The universal failure on shield-tunnel sequences means they should be treated as a distinct evaluation tier (pass/fail detection and ATE when not failing) rather than averaged into a per-category mean. A method that achieves 0.15 m on mine-tunneled sequences but ✗ on shield-tunnel sequences is not a "metro tunnel" method — it is a mine-tunnel method.
- **Monitor for GenZ-LIO evaluation.** GenZ-LIO is the strongest candidate for GEODE tunnel sequences (ESIKF with hybrid residuals; IMU prior for degenerate axes). Track the arXiv page and the POSTECH CoCEL GitHub for updated pre-print or RA-L submission containing GEODE numbers.
- **No leaderboard: self-report against paper baselines.** Use the project website (`thisparticle.github.io/geode`) and the `rmse.py` evaluation script. Report results alongside the published RELEAD and FAST-LIO2 numbers as reference points.

---

## Sources

- GEODE paper (arXiv): https://arxiv.org/abs/2409.04961
- GEODE paper (arXiv HTML v2): https://arxiv.org/html/2409.04961v2
- GEODE paper (IJRR DOI): https://doi.org/10.1177/02783649251344967
- GEODE GitHub dataset repository: https://github.com/PengYu-Team/GEODE_dataset
- GEODE project website: https://thisparticle.github.io/geode/
- GEODE Google Drive download: https://drive.google.com/drive/folders/1hEn3sBAvQhSdUFnGMZCCv-W0Ynj2rWBs
- D²-LIO (directional degeneracy LIO, GEODE evaluator): https://arxiv.org/abs/2508.14355
- RELEAD (best GEODE baseline): https://arxiv.org/html/2402.18934v2
- GenZ-ICP (degeneracy-aware LO, SubT-MRS baseline): https://arxiv.org/abs/2411.06766
- GenZ-LIO (degeneracy-aware LIO, GEODE evaluation pending): https://arxiv.org/abs/2603.16273
- LODESTAR (does not evaluate on GEODE): https://arxiv.org/abs/2511.09142
