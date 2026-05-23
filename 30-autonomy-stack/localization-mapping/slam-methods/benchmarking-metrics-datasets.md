# SLAM Benchmarking Metrics and Datasets

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "benchmark"
  stage: "reference"
  maturity: "fielded-pattern"
  tags: ["slam", "validation", "data-engine", "outdoor"]
  reason: "SLAM Benchmarking Metrics and Datasets is rated as a SLAM benchmark or reference page for comparing methods and deployments."
method-priority:end -->

SLAM benchmarking is easy to do badly. A single ATE number can hide scale alignment, loop-closure jumps, bad covariance, relocalization failures, compute spikes, and map artifacts that make a method unusable in a production AV or indoor robot. This guide defines the metrics and dataset choices that should be used across the method-level SLAM library.

## Repo Cross-Links

| Related area | Link | Benchmark relevance |
|---|---|---|
| LiDAR method details | [LiDAR SLAM Algorithms](../overview/lidar-slam-algorithms.md) | Provides method-specific performance notes for [KISS-ICP](kiss-icp.md), [LIO-SAM](lio-sam.md), [FAST-LIO2](fast-lio-fast-lio2.md), Faster-LIO-style voxel LIO, [CT-ICP](ct-icp.md), and [Point-LIO](point-lio.md). |
| Production localization metrics | [Production LiDAR Map Localization](../overview/production-lidar-map-localization.md) | Adds scan-to-map fitness, degeneracy, covariance, and runtime acceptance gates. |
| Loop/relocalization metrics | [LiDAR Place Recognition and Re-Localization](../overview/lidar-place-recognition-relocalization.md) | Defines retrieval recall, precision, top-K verification, and kidnapped-robot recovery success. |
| Survey map QA | [Map Construction Pipeline](../maps/map-construction-pipeline.md) | Connects SLAM trajectory metrics to final HD map QA, GCP alignment, and packaging. |
| Point-cloud map QA | [MapEval Point-Cloud Map-Quality Evaluation](mapeval-point-cloud-map-quality-evaluation.md) | Adds direct map-geometry metrics such as AC, COM, CD, MME, AWD, and SCS before semantic segmentation or map publication trusts the aggregated cloud. |
| Estimator consistency | [Robust State Estimation Multi-Sensor](../overview/robust-state-estimation-multi-sensor.md) | Covers NEES/NIS, innovation gating, sensor dropout, and fallback validation. |
| Factor graph residuals | [GTSAM Factor Graphs](../../../10-knowledge-base/state-estimation/gtsam-factor-graphs.md) | Explains how factors, covariances, robust kernels, and iSAM2 updates should be inspected. |
| Collaborative backend benchmarks | [COSMO-Bench](cosmo-bench.md) | Adds multi-robot C-SLAM optimization graphs, communication-model variants, and loop-outlier labels. |
| Current visual/VIO benchmarks | [LaMAria](lamaria-city-scale-visual-inertial-slam-benchmark.md), [Hilti x Trimble 2026](hilti-trimble-slam-challenge-2026.md), and [ScaleMaster](scalemaster-benchmark.md) | Adds city-scale egocentric VIO, construction-site 360-degree VI localization with floor-plan priors, and monocular scale-consistency/map-quality stress tests. |
| Dense/neural map evaluation | [Gaussian Splatting for Driving](../../perception/overview/gaussian-splatting-driving.md) | Adds reconstruction, rendering, semantic, and simulation-quality metrics for Gaussian/neural SLAM. |
| Coverage audit | [SLAM Coverage Audit and Backlog](coverage-audit-2026.md) | Tracks benchmark/dataset gaps and matrix-covered follow-ons such as Oxford Spires, IILABS 3D, SMapper-light, FusionPortableV2, S3E, HeLiPR, ETH3D SLAM, VBR, M2DGR, NTU VIRAL, and UrbanLoco. |

## Metric Taxonomy

| Metric | Measures | Best for | Formula/implementation notes | Report as | Common misuse |
|---|---|---|---|---|---|
| Absolute Trajectory Error (ATE) | Global trajectory consistency after alignment | SLAM with ground truth | Align estimated and ground-truth trajectories, then compute pose error over timestamps | RMSE/mean/median/max in m; optionally yaw/rot error | Hiding drift by using Sim(3) scale alignment for stereo/LiDAR methods that should have metric scale |
| Relative Pose Error (RPE) | Local drift over a fixed time/distance segment | Odometry and loop-free front ends | Compare relative motion over windows such as 1s, 10m, 100m | Translation %, rotation deg/m or deg/100m | Reporting only ATE after loop closure, which can hide poor local odometry |
| KITTI odometry t_rel/r_rel | Average drift on subsequences | Outdoor vehicle odometry | KITTI averages translational and rotational errors over subsequences of 100-800m | t_rel %, r_rel deg/m | Comparing KITTI numbers to short indoor datasets without normalization |
| Segment drift curve | Error versus path length | AV and long-route mapping | Compute RPE over multiple segment lengths | Table/plot at 10, 50, 100, 200, 400, 800m | Reporting only one length and missing long-range drift |
| Loop-closure precision/recall | Candidate retrieval quality | Place recognition and graph SLAM | Precision after geometric verification; recall at top-K | Precision@K, Recall@K, F1, false positives/km | High recall without verifying false positives that destroy maps |
| Relocalization success | Recovery from unknown pose | Startup/kidnapped robot | Candidate found, verified, and accepted within pose threshold | Success %, time-to-localize, false accepts | Measuring only descriptor recall, not full pose recovery |
| Map consistency | Agreement between overlapping submaps, sessions, or reference maps | Survey mapping | Cloud-to-cloud distance, wall thickness, double-surface rate, GCP residual; MapEval-style AC/COM/CD/MME/AWD/SCS | cm RMSE, P95, max, AWD/SCS, visual QA flags | Relying on trajectory ATE when final map has double walls |
| GCP/RTK residual | Geodetic map accuracy | Airside/road HD maps | Compare optimized map landmarks/trajectory to surveyed anchors | East/north/up RMSE and P95 | Treating local SLAM frame as geodetically valid without anchors |
| Scan-matching health | Current registration quality | Runtime localization | Fitness/inlier ratio, residual distribution, Hessian eigenvalues | Time series and thresholds | Using a single scalar fitness that ignores degeneracy direction |
| Estimator consistency | Whether covariance is honest | Sensor fusion and safety | NEES/NIS compared to chi-square bounds | NEES/NIS time series and violation rate | Publishing small covariance because pose looked smooth |
| Robustness score | Recovery under degradation | Production testing | Count tracking loss, reinitializations, skipped factors, fallback duration | Failures/hour, safe-stop events, recovery time | Removing hard sequences from benchmark averages |
| Runtime latency | Real-time viability | Embedded deployment | End-to-end and stage timings; include P95/P99 | ms mean/P95/P99, deadline misses | Reporting desktop average only, not target hardware P99 |
| Resource use | Deployability | Embedded/ROS systems | CPU, GPU, memory, map size, bandwidth | Peak/steady values | Ignoring map growth over long missions |
| Determinism | Predictable behavior | Safety-critical runtime | Re-run same bag and compare outputs/timing | Pose diff, timing jitter, nondeterministic failures | Accepting stochastic variation without bounds |
| Dense reconstruction | Surface quality | RGB-D/Gaussian/neural SLAM | Accuracy, completeness, Chamfer/F-score, render PSNR/SSIM/LPIPS | Metric per scene plus failure cases | Treating nice rendering as reliable metric pose |

## Alignment Rules

| Method type | Allowed alignment | Why | Report separately |
|---|---|---|---|
| Monocular visual odometry without scale source | Sim(3) may be fair for research comparison | Scale is unobservable from monocular geometry alone | Also report scale drift if method estimates scale later |
| Stereo, RGB-D, LiDAR, LiDAR-inertial | SE(3), not Sim(3) | Metric scale should be observable from sensors | Any scale correction indicates calibration or estimator problem |
| GNSS/RTK/georeferenced maps | Fixed geodetic frame or SE(3) with known datum transform | Absolute position matters operationally | East/north/up residuals and map datum residual |
| Multi-session SLAM | Per-session and joint-frame metrics | A good per-session trajectory can still merge badly | Cross-session overlap error and loop factor residuals |
| Runtime localization | No post-hoc global alignment for pass/fail | The vehicle must localize online in the correct map frame | Initial convergence time and false accept rate |

## Public Dataset Matrix

| Dataset/benchmark | Domain | Sensors | Ground truth | Best for | Weakness for airside/AV production |
|---|---|---|---|---|---|
| KITTI Odometry | Urban/suburban driving | Stereo, Velodyne LiDAR, GPS/IMU ground truth | Training sequences 00-10 with GT; test 11-21 hidden | Outdoor vehicle odometry, KITTI t_rel/r_rel, LiDAR/stereo baselines | Old 64-beam setup, limited adverse weather, not a full HD-map localization benchmark |
| KITTI-360 | Urban driving and scene understanding | Cameras, Velodyne, GPS/IMU, semantic annotations | Accurate localization and annotations | Semantic SLAM, long sequence mapping, dense/novel-view work | Not airport-like; benchmark tasks are broader than odometry |
| MulRan | Urban place recognition and odometry | LiDAR, radar | 6D baseline trajectories | LiDAR/radar place recognition, reverse revisits, long-term gaps | Place-recognition oriented; not all sequences have survey-grade truth |
| NCLT | Long-term campus indoor/outdoor | Omnidirectional cameras, 3D LiDAR, planar LiDAR, GPS/RTK, IMU | Ground-truth pose in one frame | Long-term localization, seasonal change, mixed indoor/outdoor | Segway/campus dynamics differ from AVs; huge data volume |
| Oxford RobotCar | Long-term road autonomy | Cameras, LiDAR, radar extension, GPS/INS | Route repetitions; RTK reference release | Long-term road localization, weather/time changes | Sensor suite and route are urban road, not airside; exact SLAM GT varies by subset |
| Boreas | Multi-season driving | 128-beam LiDAR, Navtech radar, camera, GNSS/INS | Centimeter post-processed poses | All-weather LiDAR/radar odometry and metric localization | Newer ecosystem; not indoor or airport-specific |
| Newer College | Handheld indoor/outdoor campus | Stereo-inertial and LiDAR | Precise 3D map/trajectory from survey pipeline | Handheld LiDAR/VIO, loop closure, mixed open/vegetated areas | Walking speeds and handheld motion differ from vehicle dynamics |
| Hilti SLAM Challenge | Construction, underground, multi-session | Multi-camera rigs, LiDAR, IMU; handheld and robot platforms | Challenge truth, single/multi-session scoring | Robust indoor/construction SLAM and cross-session mapping | License restrictions; construction geometry differs from airport apron |
| [Hilti x Trimble SLAM Challenge 2026](hilti-trimble-slam-challenge-2026.md) | Active construction sites and floor-plan localization | 360-degree camera plus embedded IMU; LiDAR-derived hidden ground truth | Hidden challenge GT plus five early-release GT runs | Visual-inertial SLAM and localization against imperfect floor-plan priors | Noncommercial license; construction-site geometry is not an apron or road ODD |
| [LaMAria](lamaria-city-scale-visual-inertial-slam-benchmark.md) | City-scale egocentric motion | Aria-style visual-inertial recordings with raw, ASL, and ROS bag formats | Control points and dense pseudo-GT for train; closed test GT | Long-route VIO/SLAM stress under dynamic content, low light, moving platforms, and calibration variation | Wearable motion and camera placement differ from vehicle rigs |
| [ScaleMaster](scalemaster-benchmark.md) | Large indoor and multi-floor monocular SLAM | iPhone RGB, ARKit odometry/depth/confidence, IMU logs, selected LiDAR reference maps | Optimized odometry and seven LiDAR reference maps | Scale consistency and map-to-map quality for deep monocular SLAM | Request-gated access and unclear reuse license; not a VIO or vehicle benchmark |
| EuRoC MAV | Indoor drone | Stereo global-shutter cameras, IMU | Motion-capture/laser tracker GT | Visual-inertial odometry, initialization, fast camera motion | Small indoor MAV scale; no LiDAR and no AV dynamics |
| TUM VI | Indoor/outdoor visual-inertial | Wide-FOV stereo cameras, IMU | Motion capture at start/end sections | VIO robustness, long indoor/outdoor walks | Partial GT for long sequences; camera-first benchmark |
| TUM RGB-D | Indoor RGB-D | RGB-D camera | Motion-capture GT | RGB-D SLAM, ATE/RPE tools, dense mapping | Short-range indoor only; not useful for LiDAR AV stack selection |
| Argoverse 2 Sensor/LiDAR | Road AV data and maps | LiDAR, cameras, maps, ego pose | Map-aligned poses | Learning, map automation, sensor-domain research | Not a standard SLAM odometry leaderboard; use carefully for custom tests |
| nuScenes | Urban AV perception | Cameras, LiDAR, radar, maps, ego pose | Offline localized ego poses | Multi-modal perception and localization research | Short snippets; localization GT not designed as pure SLAM benchmark |
| [COSMO-Bench](cosmo-bench.md) | Multi-robot C-SLAM backend | LiDAR-derived pose graphs and loop closures | Per-robot reference solutions plus outlier labels | Distributed and centralized collaborative SLAM optimization | Not a raw sensor or full-stack autonomy benchmark |
| Oxford Spires | Large landmark/campus-scale LiDAR-visual localization, reconstruction, and radiance fields | Three global-shutter fisheye cameras, automotive 3D LiDAR, IMU, TLS reference maps | Millimetre-accurate TLS maps for reconstruction; centimetre-accurate LiDAR-registered trajectories for core sequences | LiDAR-visual localization, reconstruction, novel-view synthesis, and neural/Gaussian map stress tests | Handheld/backpack platform, noncommercial academic license, and core-sequence trajectory GT only; not road or airside production data |
| IILABS 3D | Indoor 3D LiDAR SLAM | Four heterogeneous 3D LiDARs, IMU, wheel odometry, wheeled mobile robot | Motion-capture ground truth | Indoor LiDAR/LIO algorithm comparison across spinning and non-repetitive LiDARs | Controlled lab ODD with limited outdoor, road, weather, and vehicle-dynamics transfer |
| SMapper-light | Indoor/outdoor multimodal SLAM platform dataset | Ouster 3D LiDAR, RealSense RGB-D, multiple high-resolution cameras, IMUs, ROS 2 MCAP topics | Offline LiDAR-SLAM-derived sub-centimeter trajectories and dense reconstructions | Reproducible visual, LiDAR, visual-inertial, and multimodal SLAM benchmarking from an open-hardware platform | Ground truth is not independent survey/MoCap; public dataset is short and platform/tooling-centric |
| [FusionPortableV2](fusionportablev2-multiplatform-slam.md) | Generalized multi-platform SLAM | Handheld Ouster LiDAR, stereo RGB/event cameras, IMU, GNSS/INS; UGV wheel encoders; legged-robot proprioception; vehicle sequences | Ground-truth trajectories plus RGB point-cloud maps | Cross-platform generalization across handheld, legged, UGV, and vehicle data | Some dynamic objects remain in ground-truth maps; not airside-specific and map-quality scoring needs contamination checks |
| S3E | Multi-robot multimodal C-SLAM raw-sensor data | Three UGVs with 16-beam 3D LiDAR, stereo cameras, IMU, UWB relative observations, dual-antenna RTK | RTK-equipped multi-robot runs with synchronized and calibrated streams | Full-stack collaborative SLAM, inter-robot sensing, UWB-aided C-SLAM, and raw-sensor complement to COSMO-Bench pose graphs | Small UGV fleet and campus-style indoor/outdoor scenes; keep distinct from backend-only C-SLAM benchmarks |

## Benchmark Suite by Method Family

| Method family | Minimum public tests | Airside/private tests to add | Must report |
|---|---|---|---|
| [KISS-ICP](kiss-icp.md)-style LiDAR odometry | KITTI, MulRan, Newer College | Open apron loops, repeated stands, wet/night scans, multi-LiDAR merged clouds | KITTI drift, ATE/RPE, degeneracy stats, runtime P99 |
| [FAST-LIO2](fast-lio-fast-lio2.md)/[Point-LIO](point-lio.md)-style LIO | KITTI/NCLT/Newer College/Hilti depending platform; add IILABS 3D, SMapper-light, and FusionPortableV2 for indoor and multi-platform regression | IMU vibration, sync offsets, multi-LiDAR extrinsic stress, GPS-denied loops | ATE/RPE, IMU residuals, bias behavior, failure/recovery count |
| [LIO-SAM](lio-sam.md)-style factor-graph SLAM | KITTI, NCLT, MulRan, Hilti, FusionPortableV2, Oxford Spires when LiDAR-visual localization or reconstruction is in scope | GCP-anchored airport survey, loop closure false positives near similar gates | Pre/post-loop ATE, loop precision/recall, graph residuals, map overlap |
| [Cartographer](cartographer-3d.md)/2D SLAM | MIT/Intel-style 2D sets, office/warehouse bags | Warehouse aisles, docking lanes, pallet changes | Occupancy map consistency, localization success, CPU, map update behavior |
| [ORB-SLAM3](orb-slam2-orb-slam3.md)/visual SLAM | EuRoC, TUM VI, TUM RGB-D, KITTI stereo | Night/glare, rolling shutter, low texture, rain-on-lens | Tracking loss, ATE/RPE, feature count, initialization failures |
| [OpenVINS](openvins.md)/[VINS-Fusion](vins-mono-vins-fusion.md) | EuRoC, TUM VI, UZH-FPV, KITTI | Camera-IMU temporal error, vehicle vibration, low texture | ATE/RPE, NEES, bias, initialization time |
| Runtime scan-to-map localization | KITTI-derived map split, Boreas localization, custom map | Airport HD map, degraded LiDAR, wrong initial pose, changed stands | Convergence basin, false accept rate, covariance, matching score P99 |
| Collaborative SLAM backends | COSMO-Bench for pose-graph optimization; S3E for raw multi-robot multimodal data; custom multi-vehicle surveys | Multi-vehicle airport or warehouse survey, intermittent wireless, repeated places | Per-robot ATE/RPE, loop outlier precision/recall, convergence, communication bytes |
| Aggregated point-cloud map QA | [MapEval](mapeval-point-cloud-map-quality-evaluation.md), FusionPortableV2, Newer College, GEODE, local TLS/GCP reference maps | Airport/campus/yard/port reference scans, held-out GCPs, LAMM/Uni-Mapper merged maps, dynamic-cleaned maps | AC, COM, CD, MME, AWD, SCS, density/coverage maps, failure-region exports |
| Gaussian/neural SLAM | Replica/TUM RGB-D/ScanNet if supported; Oxford Spires for large-scale LiDAR-visual reconstruction/radiance fields | Airside map QA captures, static/dynamic split, simulation replay | ATE/RPE plus reconstruction/rendering metrics and compute |

## Airside Private Benchmark Design

| Test class | Required sequences | Pass/fail signals | Why it is needed |
|---|---|---|---|
| Open apron degeneracy | Straight and curved traversals across low-feature tarmac | Covariance inflation in weak axes; no overconfident lateral/yaw jumps | Public datasets underrepresent airport-scale open flat spaces. |
| Repeated stand aliasing | Adjacent gates/stands with similar geometry | No false loop closure; relocalization top-K ambiguity handled | Airports have deliberate repetition that defeats naive place recognition. |
| Dynamic aircraft/GSE | Same stand with aircraft present/absent, buses/carts/fuel trucks | Dynamic objects not fused into permanent map; scan-to-map residual localized | Static maps must survive large moving objects. |
| Weather and lighting | Dry/wet tarmac, rain/fog/de-icing spray, day/night/glare | Tracking loss rate, fallback duration, sensor health flags | Airside operations run across weather and shifts. |
| GPS/RTK degradation | Terminal overhang, aircraft shadowing, multipath zones | Estimator rejects bad GNSS and does not corrupt map/localization | State fusion must handle false absolute measurements. |
| Multi-LiDAR health | Disable/misalign one LiDAR, timestamp offsets, partial blockage | Fault isolated to one sensor; pose degrades gracefully | Multi-sensor AVs need per-sensor diagnostics. |
| Map staleness | Changed barriers/markings, construction, temporary closures | Change is flagged rather than absorbed silently | Fleet maps must be versioned and maintained. |
| Relocalization | Startup at unknown pose, vehicle towed, pose intentionally perturbed | Correct global pose accepted; wrong hypotheses rejected | Startup/recovery is as important as steady-state tracking. |

## Acceptance Gates for Production-Oriented SLAM Evaluation

| Gate | Target for airside map construction | Target for runtime localization | Notes |
|---|---|---|---|
| Local odometry drift | Less than 0.5-1.0% before loop closure on airport-like loops | Fallback only; must be time-limited | Exact threshold depends on safe-stop policy and map coverage. |
| Global map accuracy | GCP/RTK residual P95 less than 10cm for navigation layers; tighter for docking zones | N/A | Docking/aircraft proximity may need local survey refinement. |
| Runtime pose accuracy | N/A | Typical steady-state less than 5-10cm lateral and less than 0.2deg yaw in validated map zones | Must be validated against vehicle-level safety margins. |
| False loop closures | Zero accepted false positives in safety benchmark | Zero accepted false relocalizations | A single false closure can invalidate the map or pose. |
| Tracking loss | Documented and recoverable | Safe fallback or safe stop within safety budget | "No output" can be safer than wrong output. |
| Deadline misses | Offline acceptable if bounded | P99 under localization cycle budget | Report on target hardware, not workstation only. |
| Covariance consistency | NEES/NIS within expected bounds on instrumented tests | Same, with fault injection | Overconfidence is a safety bug. |
| Map artifact rate | No double walls/ghost aircraft in operational layers | N/A | Visual inspection plus MapEval-style cloud-distance, AWD/SCS, and coverage diagnostics. |

## Reporting Template for Method Pages

| Section | Required content |
|---|---|
| Dataset table | Public datasets used, sequence IDs, sensor subset, preprocessing, alignment mode |
| Metrics table | ATE, RPE/segment drift, loop metrics if applicable, runtime, memory, failure counts |
| Hardware table | CPU/GPU, ROS version, compiler/build mode, thread count, target embedded result if available |
| Calibration assumptions | Intrinsics/extrinsics/time sync source; whether online calibration is enabled |
| Failure analysis | At least three failure modes with detection and mitigation |
| Production fit | License, ROS 1/2 support, API stability, diagnostics, hot-path determinism |
| Airside extrapolation | What public datasets do not test and which private sequences are required |

## Metric Pitfalls

| Pitfall | Why it misleads | Better practice |
|---|---|---|
| Averaging across easy and hard sequences without stratification | A method can look strong by dominating easy sequences and failing rare critical cases | Report per-sequence and by condition bucket. |
| Using final ATE only after loop closure | A loop can hide poor odometry until recovery is impossible | Report pre-loop odometry drift and post-loop global consistency. |
| Ignoring false positive loops | Recall improvements can destroy maps | Report precision after geometric verification and robust kernel behavior. |
| Reporting mean latency only | Embedded systems fail at P99/P999 | Report stage timing distributions and deadline misses. |
| Comparing methods with different alignment freedoms | Sim(3) can forgive metric-scale errors | State SE(3)/Sim(3)/fixed-frame alignment explicitly. |
| Treating map and trajectory as interchangeable | Good trajectory can produce a poor dense map | Measure map overlap, surface thickness, and dynamic artifacts. |
| Ignoring estimator consistency | Smooth pose with false covariance can corrupt fusion | Report NEES/NIS and innovation gating outcomes. |
| Benchmarking only public datasets | Public data rarely matches the target ODD | Add domain-specific private tests and fault injection. |

## Sources

- KITTI odometry benchmark official page and evaluation protocol: https://www.cvlibs.net/datasets/kitti/eval_odometry.php
- KITTI dataset paper, Geiger et al., "Vision meets Robotics: The KITTI Dataset", IJRR 2013: https://www.cvlibs.net/publications/Geiger2013IJRR.pdf
- KITTI-360 paper and project: https://arxiv.org/abs/2109.13410 and https://www.cvlibs.net/datasets/kitti-360/
- TUM RGB-D benchmark tools and ATE/RPE scripts: https://cvg.cit.tum.de/data/datasets/rgbd-dataset/tools
- Sturm et al., "A Benchmark for the Evaluation of RGB-D SLAM Systems", IROS 2012: https://cvg.cit.tum.de/_media/spezial/bib/sturm12iros.pdf
- OpenVINS evaluation metrics documentation for ATE, RPE, RMSE, and NEES: https://docs.openvins.com/eval-metrics.html
- EuRoC MAV dataset paper, Burri et al., "The EuRoC micro aerial vehicle datasets", IJRR 2016: https://projects.asl.ethz.ch/datasets/doku.php?id=kmavvisualinertialdatasets
- TUM VI benchmark official page and paper: https://cvg.cit.tum.de/data/datasets/visual-inertial-dataset and https://arxiv.org/abs/1804.06120
- Newer College Dataset official page and paper: https://ori-drs.github.io/newer-college-dataset/ and https://arxiv.org/abs/2003.05691
- MulRan Dataset official page and paper: https://sites.google.com/view/mulran-pr/dataset and https://gisbi-kim.github.io/publications/gkim-2020-icra.pdf
- University of Michigan NCLT dataset official repository: https://deepblue.lib.umich.edu/data/concern/data_sets/h128nf37h
- Oxford RobotCar Dataset official site: https://robotcar.org.uk/
- Boreas dataset official site and AWS registry: https://www.boreas.utias.utoronto.ca/ and https://registry.opendata.aws/boreas/
- Hilti SLAM Challenge 2023 official dataset page: https://www.hilti-challenge.com/dataset-2023
- Hilti x Trimble SLAM Challenge 2026 official page and repository: https://hilti-trimble-challenge.com/ and https://github.com/Hilti-Research/hilti-trimble-slam-challenge-2026
- LaMAria official project, dataset, and repository: https://www.lamaria.ethz.ch/, https://lamaria.inf.ethz.ch/slam_datasets, and https://github.com/cvg/lamaria
- ScaleMaster arXiv record and repository: https://arxiv.org/abs/2602.18174 and https://github.com/JooHyoSeok/ScaleMaster-Dataset
- Argoverse 2 official dataset page: https://www.argoverse.org/av2.html
- nuScenes official dataset and paper: https://www.nuscenes.org/ and https://arxiv.org/abs/1903.11027
- evo trajectory evaluation tool metrics documentation: https://github.com/MichaelGrupp/evo/wiki/Metrics
- COSMO-Bench official dataset site and paper: https://www.cosmobench.com/ and https://arxiv.org/abs/2508.16731
- Oxford Spires official dataset site and paper: https://dynamic.robots.ox.ac.uk/datasets/oxford-spires/ and https://arxiv.org/abs/2411.10546
- IILABS 3D benchmark site, dataset record, and DOI: https://jorgedfr.github.io/3d_lidar_slam_benchmark_at_iilab/, https://rdm.inesctec.pt/dataset/nis-2025-001, and https://doi.org/10.1109/ACCESS.2025.3643753
- SMapper/SMapper-light documentation and paper: https://snt-arg.github.io/smapper_docs/, https://snt-arg.github.io/smapper_docs/datasets/smapper-light/, and https://arxiv.org/abs/2509.09509
- FusionPortableV2 official dashboard and paper: https://fusionportable.github.io/dataset/fusionportable_v2/ and https://arxiv.org/abs/2404.08563
- S3E official project and RA-L paper: https://pengyu-team.github.io/S3E/ and https://arxiv.org/abs/2210.13723
- MapEval RA-L 2025 point-cloud map-quality framework, official repository, and arXiv record: https://doi.org/10.1109/LRA.2025.3548441, https://github.com/JokerJohn/Cloud_Map_Evaluation, and https://arxiv.org/abs/2411.17928
