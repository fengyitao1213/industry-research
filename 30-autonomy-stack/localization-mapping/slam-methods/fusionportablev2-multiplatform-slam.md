# FusionPortableV2 Multi-Platform SLAM Dataset

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "benchmark"
  stage: "reference"
  maturity: "fielded-pattern"
  tags: ["slam", "validation", "data-engine", "outdoor", "indoor"]
  reason: "FusionPortableV2 Multi-Platform SLAM Dataset is rated as a SLAM benchmark or reference page for comparing methods and deployments."
method-priority:end -->

Related method pages: [GEODE Degenerate LiDAR Benchmark](./geode-degenerate-lidar-benchmark.md) (iter 39), [Benchmarking Metrics and Datasets](./benchmarking-metrics-datasets.md), [M2DGR / M3DGR Ground Fusion](./ground-fusion-m2dgr-m3dgr.md), [FAST-LIO and FAST-LIO2](./fast-lio-fast-lio2.md), [KISS-ICP](./kiss-icp.md), [DROID-SLAM](./droid-slam.md), [LO-Net Learned LiDAR Odometry](./lo-net-learned-lidar-odometry.md), [GenZ-ICP and GenZ-LIO](./genz-icp-genz-lio.md) (iter 38), [BEV-LIO-LC](./bev-lio-lc.md) (iter 39), [Continuous-Time Registration](./continuous-time-registration.md), [LVI-SAM](lvi-sam.md), [FAST-LIVO2](fast-livo-fast-livo2.md), [Event-Camera VIO/SLAM](event-camera-vio-slam.md).

Related overview pages: [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [Large-Scale 3D Segmentation Benchmarks](../../perception/datasets-benchmarks/large-scale-3d-segmentation-benchmarks.md).

Related KB pages: [Multi-Sensor Calibration and Observability](../../../10-knowledge-base/geometry-3d/multi-sensor-calibration-observability.md).

**Last updated:** 2026-05-24

---

## What It Is

FusionPortableV2 is the second-generation multi-platform, multi-sensor SLAM benchmark from HKUST RAM-LAB. It extends the original FusionPortable (IROS 2022) with a fourth platform class, ten additional sequences, broader environment coverage, upgraded ground-truth instruments, and platform-specific proprioceptive streams. The dataset is designed to stress-test SLAM generalization across four qualitatively distinct motion regimes — handheld jitter, quadruped gait shock, UGV Ackermann dynamics, and high-speed vehicle — using a shared, calibrated sensor suite.

### FusionPortable v1 (lineage origin)

| Field | Value |
|---|---|
| Full title | FusionPortable: A Multi-Sensor Campus-Scene Dataset for Evaluation of Localization and Mapping Accuracy on Diverse Platforms |
| Lead author | Jianhao Jiao et al., RAM-LAB, HKUST |
| Venue | IEEE/RSJ IROS 2022, Kyoto |
| arXiv | [2208.11865](https://arxiv.org/abs/2208.11865) |
| Dataset page | https://fusionportable.github.io/dataset/fusionportable/ |

V1 introduced 17 sequences across three platforms (handheld, Unitree A1 quadruped, one Apollo vehicle), using OptiTrack motion capture (120 Hz) for indoor lab sequences and RTK-GPS for outdoor sequences. The ZED-F9P single-antenna GNSS unit served as the primary outdoor positioning source.

### FusionPortableV2 (primary reference)

| Field | Value |
|---|---|
| Full title | FusionPortableV2: A Unified Multi-Sensor Dataset for Generalized SLAM Across Diverse Platforms and Scalable Environments |
| Lead author | Hexiang Wei (HKUST); Jianhao Jiao (UCL, second author) |
| Affiliations | Dept. of ECE, HKUST; Thrust of Robotics and Autonomous Systems, HKUST (Guangzhou); Shenzhen Key Lab of Robotics and CV, Southern University of Science and Technology; Dept. of CS, University College London |
| Journal | The International Journal of Robotics Research (IJRR) |
| Volume / Issue / Pages | Vol. 44, Issue 7, pp. 1093–1116 |
| Published online | December 17, 2024; issue date June 1, 2025 |
| DOI | [10.1177/02783649241303525](https://doi.org/10.1177/02783649241303525) |
| arXiv | [2404.08563](https://arxiv.org/abs/2404.08563) |
| Dataset page | https://fusionportable.github.io/dataset/fusionportable_v2/ |
| Tools / SDK | https://github.com/fusionportable/fusionportable_dataset_tools |

Authorship note: Jianhao Jiao, the lead author of v1, is listed as second author of v2 and is affiliated with UCL as of 2024. Hexiang Wei leads v2. The RAM-LAB affiliation (HKUST) remains the institutional home.

---

## Why It Matters

Most public SLAM benchmarks are locked to a single platform class. KITTI is vehicle-only on urban/highway roads. Newer College Dataset and Hilti are handheld or backpack-mounted in campus or construction environments. Neither stress-tests cross-platform SLAM generalization. FusionPortableV2 fills this gap by exposing four mechanically distinct motion regimes under a unified, calibrated sensor suite:

- **Handheld jitter** — slow speed, high angular velocity, operator tremor, frequent stop-and-go.
- **Quadruped gait shock** — periodic 8–12 Hz vertical impulse from foot contact; IMU saturation risk; LiDAR motion blur between steps.
- **UGV Ackermann dynamics** — smooth ground contact, moderate speed, wheel odometry available, non-holonomic constraint.
- **High-speed vehicle** — fast translation (up to highway speed), large inter-frame LiDAR displacement, GPS-available but tunnel GNSS gaps.

A SLAM algorithm that succeeds on one regime and fails on another has not generalized; FusionPortableV2 makes that failure visible in a single evaluation session. This property is particularly valuable for ML-SLAM research where training and test platform distributions must be deliberately mismatched.

FusionPortableV2 also bridges two families of benchmarks that rarely share data. Vehicle-oriented datasets (KITTI, HeLiPR, HeLiMOS) are the standard for large-scale outdoor evaluation. Handheld datasets (Newer College, Hilti) are the standard for indoor/campus evaluation with high-accuracy total-station ground truth. Neither family includes legged robots or cross-platform calibration. FusionPortableV2 is the first dataset at reasonable scale (38.7 km, 27 sequences) to span all four platform classes with a single sensor rig.

---

## Dataset Composition

### Platform and Sequence Summary

| Platform | Count | Total distance | Duration | Environments |
|---|---|---|---|---|
| Handheld suite | 6 | ~46–500 m per seq (est.) | ~79–200 s per seq (est.) | Indoor room, escalator, grass, underground parking |
| Legged robot (Unitree A1) | 5 | ~100–600 m per seq (est.) | ~100–300 s per seq (est.) | Grass, indoor room, indoor/outdoor transition, underground |
| UGV (Ackermann) | 10 (includes 2 transition seqs) | ~200–1,000 m per seq (est.) | ~100–400 s per seq (est.) | Parking lot, campus road, indoor/outdoor transition |
| Vehicle (high-speed) | 6 | 1,000–9,349 m per seq | 200–694 s per seq | Campus, street, tunnel, downhill, highway, multi-story |
| **Total** | **27** | **38.7 km** | **~2.5 h** | **12+ environment types** |

Note: per-sequence distance and duration ranges for handheld, legged, and UGV platforms are derived from paper totals and the described sequence list. Exact per-sequence figures appear in Table 1 of the IJRR paper (DOI above); verify individual rows from the paper PDF if precise numbers are required.

### Named Sequences (v2)

**Handheld (6):** handheld_grass00, handheld_room00, handheld_room01, handheld_escalator00, handheld_escalator01, handheld_underground00.

**Legged (5):** legged_grass00, legged_grass01, legged_room00, legged_transition00, legged_underground00.

**UGV (10):** ugv_parking00, ugv_parking01, ugv_parking02, ugv_parking03, ugv_campus00, ugv_campus01, ugv_transition00, ugv_transition01, and two additional sequences (verify remaining two names from the IJRR Table 1 — the dashboard lists 8 named sequences plus 2 transition entries totalling 10).

**Vehicle (6):** vehicle_campus00, vehicle_campus01, vehicle_street00, vehicle_tunnel00, vehicle_downhill00, vehicle_highway00. (The arXiv HTML also lists vehicle_multilayer00 and vehicle_highway01; the IJRR paper counts 6 vehicle sequences — verify the final list from the IJRR table.)

### Named Sequences (v1, for reference)

**Handheld outdoor (7):** canteen_night, canteen_day, garden_night, garden_day, corridor_day, escalator_day, building_day.

**Handheld indoor — MCR lab with OptiTrack (3):** MCR_slow, MCR_normal, MCR_fast.

**Quadruped indoor — MCR lab (6):** MCR_slow_00, MCR_slow_01, MCR_normal_00, MCR_normal_01, MCR_fast_00, MCR_fast_01.

**Vehicle (1):** campus_road_day (Apollo platform).

**Total v1: 17 sequences.** V2 does not include the MCR-lab OptiTrack sequences; they exist only in v1.

---

## Sensor Suite

Both v1 and v2 share a common core sensor suite. The table below records the v2 specification; v1 differences are noted.

| Sensor | Model | Rate | Key Specs | V1 Difference |
|---|---|---|---|---|
| 3D LiDAR | Ouster OS1-128 Gen5 | 10 Hz | 128 beams, 45° vertical FOV, 360° horizontal, 120 m range | Same family in v1 (OS1-128) |
| LiDAR-internal IMU | ICM20948 | 100 Hz | Mounted inside Ouster; used for motion undistortion | — |
| Stereo frame cameras | FLIR BFS-U3-31S4C | 20 Hz | 1024×768, global shutter, color | Same in v1 |
| Stereo event cameras | DAVIS346 | 30 Hz | 346×240 resolution; integrated frame + event stream | Same in v1 |
| Event-camera IMU | MPU6150 | — | Integrated with DAVIS346 cameras | Same in v1 |
| Primary IMU | Sensonor STIM300 | 200 Hz | Tactical-grade; gyro bias instability 0.3°/h; accel bias 0.04 mg | Same in v1 |
| INS / GNSS | MicroStrain 3DM-GQ7 | 10 Hz poses; 200 Hz IMU | Dual-antenna, RTK-capable; ~1.4 cm horizontal RTK accuracy | V1 used ZED-F9P (single-antenna) |
| UGV wheel encoder | Omron E6B2-CWZ6C | 100 Hz | 1000 pulses/revolution | New in v2 |
| Legged proprioception | Unitree A1 built-in | — | Joint encoders, contact sensors, platform IMU | New in v2 |

Hardware temporal synchronization: FPGA/PPS-based triggering locks LiDAR rotation phase to camera capture. Non-triggerable sensors (wheel encoders, legged proprioception) carry internal timestamps that may have offsets relative to the trigger reference — see calibration files before running any tight-coupling evaluation. See [Multi-Sensor Calibration and Observability](../../../10-knowledge-base/geometry-3d/multi-sensor-calibration-observability.md) for the time-offset and extrinsic-calibration theory.

The STIM300 is the highest-quality IMU in the rig. Its 0.3°/h gyro bias instability places it solidly in tactical-grade territory, comparable to the IMUs found in survey-grade systems. This is unusual for a public SLAM dataset — most benchmarks use consumer-grade MEMS (MPU9250, ICM-42688) that limit the accuracy ceiling for tightly-coupled LiDAR-inertial methods.

---

## Ground Truth

FusionPortableV2 uses different ground-truth strategies depending on platform speed and environment.

| Environment / Platform | GT Method | Accuracy | Notes |
|---|---|---|---|
| Outdoor slow (handheld, legged, UGV) | Leica MS60 total station | 1 mm (3-DoF position) | Position-only; no 6-DoF orientation GT from this source |
| Outdoor / vehicle GPS-available | MicroStrain 3DM-GQ7 INS + RTK-GNSS | ~1.4 cm horizontal (6-DoF pose) | UGV outdoor + all vehicle sequences |
| Dense reference maps | Leica RTC360 + BLK360 laser scanners | <5.3 mm (RTC360 at 40 m); 4 mm (BLK360 at 10 m) | ~0.3 km² RGB point-cloud maps; used for map-quality evaluation |
| Indoor lab — v1 only | OptiTrack motion capture | <1 mm (6-DoF) at 120 Hz | MCR-lab sequences only; not present in v2 |
| Indoor non-lab — v1 | 6-DoF NDT localization in prior map | cm-level | Non-MCR indoor sequences where OptiTrack unavailable |

Important caveats:

- V2 does not retain OptiTrack-based indoor motion-capture GT. The MCR-lab sequences from v1 are not included in v2. Indoor sequences in v2 (e.g., handheld_room00, legged_room00) rely on total-station (3-DoF position) or INS, which provides less accurate 6-DoF orientation indoors where GNSS is denied.
- Total-station GT is 3-DoF (XYZ position), not 6-DoF (pose). This is sufficient for ATE in position but does not support independent evaluation of rotational drift.
- The dense RGB reference maps were generated by separate survey scans, not from SLAM output. The dashboard warns that some dynamic objects remain in the ground-truth maps; use v1 maps for clean-map experiments if dynamic-object contamination is a concern (see also [Dynamic Map Cleaning Benchmarks](./dynamic-map-cleaning-benchmarks.md)).
- For vehicle sequences, INS/RTK is the sole GT source (1.4 cm horizontal). On highway-speed sequences, error from initialization and GNSS satellite geometry may degrade effective GT quality.

---

## Evaluated Baselines

### V2 Paper — Four Representative Methods

The v2 paper evaluates four systems spanning different sensor modalities:

| Method | Modality | Type |
|---|---|---|
| DROID-SLAM | Monocular frame camera | Deep learning end-to-end (dense optical flow) |
| VINS-Fusion (with loop closure) | IMU + stereo frame cameras | Classical optimization-based VIO |
| FAST-LIO2 | IMU + LiDAR | Classical LiDAR-inertial (iterated EKF, ikd-Tree) |
| R3LIVE | IMU + LiDAR + left frame camera | Classical LiDAR-visual-inertial |

The paper additionally describes monocular depth estimation experiments using the VisionFactory framework as a downstream perception task. Methods mentioned in the related-works discussion include VILENS and Gaussian Splatting SLAM, though these are not in the primary ATE evaluation table.

See [FAST-LIO and FAST-LIO2](./fast-lio-fast-lio2.md) and [DROID-SLAM](./droid-slam.md) for method-level coverage.

### V1 Paper — Six Baseline Methods

The v1 IROS 2022 paper evaluated:

| Method | Modality | Type |
|---|---|---|
| VINS-Fusion | IMU + stereo frame cameras | Classical VIO |
| ESVO | Stereo event cameras | Event-based odometry |
| A-LOAM | LiDAR-only | ICP / scan-matching |
| LIO-Mapping | IMU + LiDAR | Early LiDAR-inertial |
| LIO-SAM | IMU + LiDAR + GPS | LiDAR-inertial with factor graph |
| FAST-LIO2 | IMU + LiDAR | Iterated EKF, ikd-Tree |

Note: ORB-SLAM3 and LVI-SAM are sometimes associated with this dataset in community discussions but are **not confirmed** to appear in v1 Table IV. They may appear in third-party evaluations using this dataset but this was not verified at research date.

---

## Representative ATE Results

All values are from the v2 paper (arXiv 2404.08563 / IJRR 2025). Units: meters. These four sequences were selected in the brief as representative rows; the full per-sequence table is in the IJRR paper. "Failed" means the method lost tracking and did not produce a complete trajectory.

| Sequence | R3LIVE (m) | FAST-LIO2 (m) | VINS-Fusion LC (m) | DROID-SLAM (m) |
|---|---|---|---|---|
| handheld_room00 | 0.057 | 0.058 | 0.063 | 0.118 |
| legged_grass00 | 0.069 | 0.327 | 1.801 | 7.011 |
| ugv_campus00 | 1.486 | 1.617 | 1.866 | 43.869 |
| vehicle_campus00 | 10.070 | 8.584 | 66.428 | Failed |

Key findings from the paper:

- LiDAR-based methods (FAST-LIO2, R3LIVE) consistently outperform vision-based methods across all platforms.
- Legged sequences are the hardest for LiDAR-inertial: gait-induced vibration causes IMU saturation and LiDAR motion blur between scans. Even FAST-LIO2 degrades from 0.058 m on handheld_room00 to 0.327 m on legged_grass00 — a five-fold increase.
- Vision-only and visual-inertial methods degrade severely on legged and vehicle sequences, with DROID-SLAM reaching 43.8 m ATE on ugv_campus00 and failing entirely on vehicle_campus00.
- Indoor room sequences are manageable for all four methods; outdoor and vehicle sequences expose the ceiling of visual methods under scale and speed.

For v1 representative ATE context: LIO-SAM achieved 0.063 m on canteen_night and 0.146 m on building_day. The v1 corridor_day sequence is explicitly identified in the v1 paper as the hardest — failing all methods to varying degrees because the indoor corridor is both textureless (camera) and structureless (LiDAR). This is a useful degenerate-environment reference, complementary to the tunnel and corridor sequences in [GEODE](./geode-degenerate-lidar-benchmark.md).

---

## Comparison with Other SLAM Benchmarks

| Dataset | Year | Platforms | LiDAR | Cameras | IMU | GT method | Seqs | Distance | Env focus | Multi-platform |
|---|---|---|---|---|---|---|---|---|---|---|
| KITTI | 2012 | Vehicle | Velodyne HDL-64E | Stereo gray + color | Low-grade | GPS + velodyne RT | 22 | ~39 km | German urban / highway | No |
| Newer College | 2021 | Handheld | Ouster OS0-64 | Stereo | ICM-20689 | Leica total station | 6 | ~4.5 km | Oxford campus, vegetation | No |
| Hilti-Oxford | 2021–2023 | Handheld (backpack, pole) | Hesai PandarXT-32, Livox MID-70 | Stereo + others | — | Leica total station | ~20–30 | Short | Construction sites, indoor | No |
| GEODE | 2024 / IJRR 2026 | Handheld + UGV | OS2-128, VLP-16, Livox Avia, Aeva AeriesII | Stereo + RGB | Xsens MTi-300, SPAN-CPT7 | RTK + total station | ~64 | >64 km | Tunnels, corridors, open fields (degenerate geometry) | No (single rig, 4 LiDARs) |
| HeLiPR | IJRR 2024 | Vehicle-like | 4 heterogeneous LiDARs | Cameras | IMU | GNSS | — | Long | Urban roads, highway | No (single platform) |
| HeLiMOS | RA-L 2024 | Vehicle | Heterogeneous LiDARs | — | IMU | GNSS | — | — | Urban dynamic scenes | No |
| M2DGR | 2021 / 2022 | Ground robot | 16-beam LiDAR | 6x fisheye + sky + infrared + event | IMU | RTK + GNSS | 36 | ~18 km | Campus, indoor, elevator | No |
| M3DGR | 2024 | Ground robot | LiDAR | Rich cameras | IMU | RTK | ~30 | — | Campus + induced degradation | No |
| MCD (NTU/NUS) | CVPR 2024 | Handheld + UGV + Vehicle | Multiple LiDARs | Multiple cameras | IMU | RTK | ~30 | — | Singapore campus, urban | Yes (3 platforms) |
| FusionPortable v1 | IROS 2022 | Handheld + Quadruped + Vehicle (3) | Ouster OS1-128 | Stereo FLIR + stereo DAVIS event | STIM300 + ZED-F9P | OptiTrack (indoor) + RTK (outdoor) | 17 | <10 km (est.) | HKUST campus, MCR lab | Yes (3 platforms) |
| **FusionPortableV2** | **IJRR 2025** | **Handheld + Legged + UGV + Vehicle (4)** | **Ouster OS1-128 Gen5** | **Stereo FLIR + stereo DAVIS event** | **STIM300 + 3DM-GQ7** | **Leica MS60 + RTK-INS** | **27** | **38.7 km** | **HKUST campus, tunnels, urban, highway** | **Yes (4 platforms)** |

Key differentiation:

- **KITTI** — vehicle-only, outdoor only, no event cameras, dated LiDAR; the standard for scale but not generalization.
- **Newer College / Hilti** — handheld/backpack only; high-accuracy total-station GT but no vehicle, no legged, short distances.
- **GEODE** — specifically targets degenerate geometry (tunnels, corridors); strongest benchmark for degenerate-LiDAR robustness but single rig with no platform diversity. See [GEODE](./geode-degenerate-lidar-benchmark.md).
- **HeLiPR** — heterogeneous LiDAR sensors on a single platform; best for cross-LiDAR-type evaluation; not multi-platform.
- **M2DGR / M3DGR** — rich camera suite (fisheye, infrared, event); single ground-robot; best for degraded visual modalities; no platform diversity. See [M2DGR / M3DGR Ground Fusion](./ground-fusion-m2dgr-m3dgr.md).
- **MCD** — closest structural competitor to FusionPortableV2; 3 platforms including vehicle; Singapore urban. FusionPortableV2 adds legged robot, event cameras, higher-grade INS (STIM300 vs. unspecified), and proprioceptive streams not present in MCD.
- **FusionPortableV2** — unique combination of 4 distinct platform kinematics, event cameras, platform proprioception (legged joints, wheel encoder), and 12+ environment types at 38.7 km.

### V1 vs V2 Summary

| Capability | V1 (IROS 2022) | V2 (IJRR 2025) |
|---|---|---|
| Platforms | Handheld, quadruped, 1 vehicle | Handheld, legged (A1), UGV, high-speed vehicle |
| Sequences | 17 | 27 |
| Total distance | <10 km (estimated) | 38.7 km |
| Primary LiDAR | Ouster OS1-128 | Ouster OS1-128 Gen5 |
| GNSS/INS | ZED-F9P single-antenna | 3DM-GQ7 dual-antenna RTK |
| Wheel odometry | None | Omron encoder (UGV) |
| Legged proprioception | None | Unitree A1 joints + contact + platform IMU |
| Indoor motion-capture GT | OptiTrack MCR-lab sequences | Not included in v2 |
| Ground-truth survey | RTK-GPS + NDT localization | Leica MS60 total station + RTK-INS |
| Dense reference maps | Limited | ~0.3 km² RGB point-cloud via Leica RTC360/BLK360 |
| Environment types | HKUST campus + MCR lab | 12+ types: tunnels, highway, multi-story, escalator |
| Anonymization | Not mentioned | ONNX Runtime face + license-plate blurring |
| Python SDK | Not mentioned | Provided |
| Evaluated methods | 6 (v1 paper) | 4 representative + downstream tasks (v2 paper) |

---

## Use for ML-SLAM Evaluation

FusionPortableV2 is well-suited for stress-testing learned LiDAR-inertial and visual-inertial odometry because it exposes failure modes that campus-only or vehicle-only datasets hide.

**Platform generalization.** A model trained on vehicle dynamics (smooth, fast, wheel odometry available) and tested on legged-robot sequences (periodic gait shock, joint encoder instead of wheel, intermittent stationarity between steps) will reveal whether the learned motion model or IMU pre-integration handles non-holonomic constraints and gait patterns. Sequences like legged_grass00 specifically probe this. Methods to evaluate: [LO-Net](./lo-net-learned-lidar-odometry.md), [KISS-ICP](./kiss-icp.md), [FAST-LIO2](./fast-lio-fast-lio2.md).

**IMU diversity.** The dataset provides the STIM300 (tactical-grade, high quality), ICM20948 (LiDAR-integrated, lower grade), and MPU6150 (event-camera-integrated). Evaluating learned inertial models (TLIO-style networks, IMU factor networks) across these IMUs within the same dataset is unusual and valuable — most benchmarks expose only one IMU type.

**Event camera integration.** FusionPortableV2 retains stereo DAVIS346 data with paired frame cameras across all four platforms. This makes it one of the few datasets where learned event-camera odometry or event-visual-inertial methods can be evaluated across multiple platforms in the same session format. DROID-SLAM is the one deep learning method evaluated in the v2 paper, establishing a baseline for learned monocular methods on this platform diversity.

**Degenerate environments within a multi-platform context.** Sequences like handheld_underground00, legged_underground00, vehicle_tunnel00, and ugv_parking00–03 introduce LiDAR degeneracy (corridor geometry) and visual degradation (low light, repetitive patterns). Unlike GEODE, which isolates degenerate environments as its primary contribution, FusionPortableV2 embeds degenerate sequences within a broader multi-platform suite — allowing comparison of how the same method fails differently depending on platform dynamics and motion speed. See [GEODE](./geode-degenerate-lidar-benchmark.md) for the dedicated degenerate-LiDAR benchmark.

**Methods recommended for evaluation on FusionPortableV2:**

- [KISS-ICP](./kiss-icp.md) — point-to-point registration; legged vibration stress test.
- [LO-Net](./lo-net-learned-lidar-odometry.md) / DMLO — deep LiDAR odometry; test cross-platform drift.
- [FAST-LIO2](./fast-lio-fast-lio2.md) — established LiDAR-inertial baseline; already evaluated in v2 paper.
- [DROID-SLAM](./droid-slam.md) — deep monocular baseline; already evaluated in v2 paper.
- [GenZ-ICP / GenZ-LIO](./genz-icp-genz-lio.md) — degeneracy-aware LiDAR-inertial; underground and tunnel sequences are relevant.
- [BEV-LIO-LC](./bev-lio-lc.md) — BEV-space LiDAR-inertial with loop closure; campus and UGV sequences.
- [Continuous-Time Registration](./continuous-time-registration.md) — gait shock handling via continuous-time IMU preintegration.
- Event-camera VIO networks — DAVIS346 stereo streams available across all platforms.
- Proprioceptive-fusion models — legged joint encoder + LiDAR combination.

For map-quality evaluation, use the Leica RTC360/BLK360 reference maps with the Cloud_Map_Evaluation tooling referenced in the dataset repository. Note the dynamic-object contamination caveat above.

---

## Strengths and Limitations

### Strengths

- **Unique platform-kinematic diversity.** No other public dataset at this scale includes handheld, quadruped gait, Ackermann UGV, and high-speed vehicle in a single unified sensor suite with shared calibration.
- **Unified sensor suite.** The same Ouster OS1-128, STIM300, FLIR, and DAVIS346 hardware is carried across all platforms (with platform-specific additions), enabling controlled comparison of SLAM robustness to platform dynamics rather than sensor differences.
- **High-grade ground truth.** Leica MS60 total station (1 mm) and RTC360 scanner (<5.3 mm) are among the highest-accuracy GT sources used in any public SLAM benchmark.
- **Scale.** 38.7 km across 27 sequences is large relative to handheld-only datasets (Newer College: ~4.5 km) and sufficient to observe long-range drift in vehicle sequences.
- **Event cameras on all platforms.** Retaining stereo DAVIS346 across all platforms with synchronized frame data makes this dataset valuable for the event-camera SLAM community.
- **Proprioceptive streams.** Joint encoders, contact sensors, and wheel odometry provide inputs for tightly-coupled proprioceptive SLAM variants that almost no other public dataset offers.
- **Open tooling.** Python SDK, EVO-compatible evaluation scripts, anonymization tools (ONNX Runtime face + plate blurring), and calibration files are publicly released.

### Limitations

- **Campus-scale only.** The outdoor environments are centered on HKUST campus and nearby urban streets, mountain roads, and a short highway stretch. No long-distance highway driving. Not suitable for city-scale mapping, large-loop closure, or multi-session accumulation.
- **Ground-truth availability varies.** Vehicle sequences use INS/RTK (1.4 cm), not total station; 6-DoF rotational GT is less accurate for vehicles than the 3-DoF total-station approach for slow platforms. V2 indoor sequences lack the high-accuracy OptiTrack that v1's MCR lab provided.
- **No true underground or mine environment.** Underground parking and tunnel sequences are GPS-denied but geometrically simple compared to mine drift or long urban tunnels. Contrast with GEODE, which includes long tunnel drives specifically designed to trigger scan-matching collapse.
- **No airside, industrial, or port environment.** No airport taxiways, warehouse aisles, ship terminals, or equivalent specialized industrial settings.
- **Dynamic object contamination in maps.** Ground-truth RGB point-cloud maps contain residual dynamic objects; map-quality experiments must account for this or use the v1 clean maps.
- **Single-LiDAR design.** One Ouster OS1-128 per rig. No heterogeneous multi-LiDAR evaluation (contrast with GEODE's four-LiDAR rig or HeLiPR's heterogeneous setup).
- **License not explicitly stated.** The paper and dataset page do not prominently declare a Creative Commons or MIT license; academic use is implied by the public release. Verify from the dataset page before integrating into a commercial or production training pipeline.

---

## For Airside Aggregated-Mapping Use

FusionPortableV2 is not an airside dataset. No apron, taxiway, hangar, or runway sequences exist. However, three aspects transfer to airside aggregated-mapping workflows:

**Multi-platform survey mapping.** Airside surveys commonly combine a ground vehicle (taxiway lane sweeps), a handheld rig (hangar interior, jetway), and potentially an elevated or drone platform (apron markings, elevated structures). FusionPortableV2 is the primary public benchmark that stress-tests SLAM under exactly this multi-platform scenario. Methods validated here are more likely to generalize across an airside multi-platform fleet than methods validated only on KITTI or Newer College.

**Sensor degeneracy analogues.** Underground parking sequences (visual dark, LiDAR corridor geometry) approximate hangar interiors where visual texture is poor and LiDAR may see repetitive wall and ceiling geometry. Tunnel sequences approximate long jetway corridors. These are not exact analogues, but they are closer than urban driving sequences. For the dedicated degenerate-geometry analysis, pair FusionPortableV2 evaluation with [GEODE](./geode-degenerate-lidar-benchmark.md) tunnel sequences.

**Legged-robot dynamics as proxy for unstable platforms.** Airside mapping may use cart-mounted rigs on uneven apron surfaces, stairway-climbing platforms, or conveyor belt vehicles. Legged-robot sequences (periodic gait shock, intermittent contact, IMU saturation risk) provide a conservative proxy for mechanically noisy platforms common at airports.

**Limitation for airside.** GNSS denial in hangar interiors means RTK-based GT methods are unavailable, and FusionPortableV2's indoor GT relies on total-station (3-DoF only) rather than indoor motion-capture. For hangar-interior evaluation, supplementing with Newer College (high-accuracy total-station) or a custom indoor dataset with motion-capture or reference laser scan remains necessary. See [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) for the downstream processing context and [Large-Scale 3D Segmentation Benchmarks](../../perception/datasets-benchmarks/large-scale-3d-segmentation-benchmarks.md) for segmentation evaluation after map assembly.

---

## Implementation Notes

### Data Access

- Dataset page: https://fusionportable.github.io/dataset/fusionportable_v2/
- Download: Google Drive (primary) and Baidu Wang Pan (code: byj8, China mirror).
- Format: ROS bag files compressed in 7z format; KITTI-format extracts also available.
- Tools: https://github.com/fusionportable/fusionportable_dataset_tools — Python SDK, EVO-compatible trajectory evaluation, calibration loading, anonymization pipeline.

### License

No explicit open-data license (Creative Commons, MIT, etc.) is declared on the dataset page or in the paper as of research date 2026-05-24. Academic research use is implied by the public release. Verify licensing with the authors (hexiangwei@connect.ust.hk or through the dataset page) before using in a commercial context or integrating into a production training pipeline.

### Calibration Files

Calibration files are organized by platform group with calibration-specific sequences: 20230403_calib for handheld, 20230426_calib for UGV, 20230618_calib for vehicle, 20230912_calib for legged. These must be loaded to correctly align LiDAR, frame cameras, event cameras, IMU, and GNSS in a common sensor frame before running any evaluation. See [Multi-Sensor Calibration and Observability](../../../10-knowledge-base/geometry-3d/multi-sensor-calibration-observability.md) for the observability and degeneracy conditions that govern multi-sensor extrinsic calibration.

### Evaluation Tools

The GitHub repository integrates with EVO (https://github.com/MichaelGrupp/evo) for ATE/RPE trajectory evaluation. Cloud_Map_Evaluation is referenced for point-cloud map quality assessment. The dataset page provides ATE-format ground-truth trajectory files needed to run EVO directly. See [Benchmarking Metrics and Datasets](./benchmarking-metrics-datasets.md) for metric definitions and cross-dataset comparison conventions.

---

## Citation

```bibtex
% FusionPortable v1
@inproceedings{jiao2022fusionportable,
  title={FusionPortable: A Multi-Sensor Campus-Scene Dataset for Evaluation of
         Localization and Mapping Accuracy on Diverse Platforms},
  author={Jianhao Jiao and Hexiang Wei and Tianshuai Hu and Xiangcheng Hu and
          Yilong Zhu and Zhijian He and Jin Wu and Jingwen Yu and Xupeng Xie and
          Huaiyang Huang and Ruoyu Geng and Lujia Wang and Ming Liu},
  booktitle={IEEE/RSJ International Conference on Intelligent Robots and Systems (IROS)},
  year={2022}
}

% FusionPortableV2
@article{wei2024fusionportablev2,
  title={FusionPortableV2: A Unified Multi-Sensor Dataset for Generalized SLAM
         Across Diverse Platforms and Scalable Environments},
  author={Hexiang Wei and Jianhao Jiao and Xiangcheng Hu and Jingwen Yu and
          Xupeng Xie and Jin Wu and Yilong Zhu and Yuxuan Liu and Lujia Wang and Ming Liu},
  journal={The International Journal of Robotics Research},
  volume={44},
  number={7},
  pages={1093--1116},
  year={2025},
  doi={10.1177/02783649241303525}
}
```

---

## Sources

- arXiv 2404.08563 (FusionPortableV2): https://arxiv.org/abs/2404.08563
- arXiv 2404.08563 HTML: https://arxiv.org/html/2404.08563v1
- IJRR publication: https://journals.sagepub.com/doi/10.1177/02783649241303525
- arXiv 2208.11865 (FusionPortable v1): https://arxiv.org/abs/2208.11865
- Dataset page (v2): https://fusionportable.github.io/dataset/fusionportable_v2/
- Dataset page (v1): https://fusionportable.github.io/dataset/fusionportable/
- Dataset tools GitHub: https://github.com/fusionportable/fusionportable_dataset_tools
- RAM-LAB HKUST: https://ram-lab.com/
- Jianhao Jiao (UCL): https://gogojjh.github.io/
