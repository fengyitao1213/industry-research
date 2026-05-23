# Industry Research

Markdown-first knowledge base for autonomous vehicle technology across road, airside, warehouse, logistics yard, port, mining, construction, agriculture, delivery robot, and outdoor campus domains. Airside autonomous vehicles remain the best-developed reference ODD, not the default evaluation lens.

**Read it as a site:** https://kvynlim.github.io/industry-research/

The repository remains Markdown-first, but the VitePress reader is the intended reading surface: local search, generated sidebar navigation, clean URLs, last-updated metadata, and source links back into the repo.

## Current Shape

| Scope | Count |
|-------|-------|
| Reader pages | 851 |
| Core research documents | 847 |
| Corpus size | 390k+ lines |
| Companies covered | 25 |
| Technology domains | 9 |
| Method-level SLAM library | 154 SLAM-method documents including overview/audit |
| Method-level perception files | 138 |
| Safety and validation docs | 56 |
| AV platform docs | 41 |
| Synthesis docs | 12 |
| Knowledge base docs | 137 |
| Papers referenced | 700+ |
| Open-source repos evaluated | 90+ |
| Airport deployments documented | 15+ |

## Architecture

The corpus is being organized as an end-to-end AV knowledge base: fundamentals, platform hardware, autonomy stack, runtime systems, cloud/fleet systems, safety validation, operations domains, industry intelligence, and synthesis.

Airside is used as a detailed reference ODD where the corpus has the deepest deployment evidence. Generic autonomy-stack methods, ratings, and synthesis pages should still state how ideas transfer across road AVs, warehouses, yards, ports, mines, construction sites, farms, delivery robots, and campus systems.

## Start Here

| Need | Open |
|------|------|
| Navigate the whole corpus | [Research Index](INDEX.md) |
| Get the executive view | [Master Synthesis](90-synthesis/master/master-synthesis.md) |
| Start building from the research | [Getting Started](90-synthesis/master/getting-started.md) |
| Pick concrete POCs | [POC Proposals](90-synthesis/poc-roadmaps/poc-proposals.md) |
| Understand readiness and risk | [Technology Readiness](90-synthesis/readiness-risk/technology-readiness.md) |
| Prioritize gap-filling research | [Knowledge Gap Backlog](90-synthesis/readiness-risk/knowledge-gap-backlog.md) |
| Continue the research loop | [Continuous Research Loop](90-synthesis/readiness-risk/continuous-research-loop.md) |
| Monitor active research sources | [Active Frontier Source Registry](90-synthesis/readiness-risk/active-frontier-source-registry.md) |
| Compare the market | [Competitive Landscape](80-industry-intel/market-competitive/competitive-landscape.md) |
| Read the core system architecture | [Design Spec](90-synthesis/decisions/design-spec.md) |
| Go deep on perception methods | [Method-Level Perception Library](30-autonomy-stack/perception/methods/overview.md) |
| Go deep on SLAM methods | [Method-Level SLAM Library](30-autonomy-stack/localization-mapping/slam-methods/overview.md) |
| Check terms and abbreviations | [Glossary](GLOSSARY.md) |
| Understand how the corpus was made | [Methodology](METHODOLOGY.md) |

## High-Leverage Reading Paths

| Path | Best Entry Point | Why |
|------|------------------|-----|
| World models for autonomous driving | [World Models Overview](30-autonomy-stack/world-models/overview.md) | Frames diffusion, occupancy, self-supervised occupancy flow, UniScene-style occupancy-centric generation, tokenized, JEPA, RL, and LiDAR-native approaches. |
| Airport airside operations | [Airside Industry Overview](70-operations-domains/airside/operations/industry-overview.md) | Connects the AV stack to pushback, turnaround, FOD, jet blast, airport data systems, and GSE. |
| Cross-domain deployment signals | [2024-2026 Autonomy Deployment Index](80-industry-intel/deployments/2024-2026-autonomy-deployment-index.md) | Compares airside, yard, warehouse, mining, delivery, and road ADS deployment evidence without treating one ODD as the default. |
| Safety case and certification | [Certification Guide](60-safety-validation/standards-certification/certification-guide.md) | Pulls together ISO 3691-4, UL 4600, SOTIF, runtime monitoring, fail-operational design, and validation. |
| Production deployment | [Deployment Playbook](70-operations-domains/deployment-playbooks/deployment-playbook.md) | Turns research into staged rollout, shadow mode, OTA, fleet management, and operational procedures. |
| Fleet economics | [Fleet TCO Business Case](70-operations-domains/airside/business-case/fleet-tco-business-case.md) | Tracks vehicle CAPEX, labor savings, certification costs, operator ratios, and break-even logic. |
| Edge hardware choices | [NVIDIA Orin Technical](20-av-platform/compute/nvidia-orin-technical.md) | Grounds model choices in compute, power, TensorRT, DLA, and sensor constraints. |
| Perception stack | [Production Perception Systems](30-autonomy-stack/perception/overview/production-perception-systems.md) | Compares production AV approaches and the perception patterns that transfer across road, airside, and managed-site autonomy. |
| Method-level perception | [Perception Method Library](30-autonomy-stack/perception/methods/overview.md) | Splits BEV, sparse-query detection, occupancy, GaussianFlowOcc/GaussTR/GS-Occ3D/VOGS-CP-style Gaussian occupancy and label curation, LiDAR-camera/radar-camera fusion, dynamic Gaussian/3DGS/4DGS, point-cloud Mamba/SSM backbones, LOSC-style LiDAR pseudo-label consolidation, LiDAR MOS, scene flow, 4D radar, FMCW LiDAR, open-world occupancy/attributes including SpaCeFormer-style open-vocabulary 3D instance segmentation, robust fusion, QuantV2X/SparseCoop-style V2X compression and sparse-query cooperation, latency, and data-engine methods into single-technique research pages. |
| Aggregated-map semantic segmentation | [Aggregated-Map Semantic Segmentation](30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md) | Routes the full registered-map labeling pipeline: LiDAR/image inputs, large-scale datasets, class-taxonomy design, model-family tradeoffs, compact proxy/input/training selector, point-cloud SSM efficiency frontiers, LOSC-style pseudo-label consolidation, training architectures, tiling/stitching, post-processing, map cleaning handoff, map-hygiene ground-truth workflow, and non-road urban-district transfer. |
| LiDAR artifact removal | [LiDAR Artifact Removal Techniques](30-autonomy-stack/perception/overview/lidar-artifact-removal-techniques.md) | Connects LIORNet, learned denoisers, classical outlier filters, weather artifacts, ghost/multipath behavior, map cleaning, datasets, and safety validation. |
| Dynamic and static object removal | [LiDAR Map Cleaning and Dynamic Removal](30-autonomy-stack/localization-mapping/slam-methods/lidar-map-cleaning-dynamic-removal.md) | Connects ERASOR, Removert, MapCleaner, ERASOR++, 4dNDF, FreeDOM, STATIC-LIO, MOVES, detector-based potentially dynamic object removal, Uni-Mapper dynamic-aware heterogeneous-LiDAR map merging, RTMap/DUFOMap, LT-mapper/Khronos, lifelong map version control, MOS/scene-flow methods, moved-object datasets, and false-deletion validation. |
| Perception coverage gaps | [Perception Coverage Audit](30-autonomy-stack/perception/overview/coverage-audit-2026.md) | Tracks missing first-class perception pages across BEV, occupancy, Gaussian/3DGS, LiDAR/radar/thermal, open-world/OOD, V2X, robustness, and benchmarks. |
| Localization and mapping | [Mapping and Localization](30-autonomy-stack/localization-mapping/overview/mapping-and-localization.md) | Covers HD maps, LiDAR SLAM, map-free driving, map maintenance, infrastructure-aided localization, and occupancy grids. |
| Photoreal city-scale 4D reconstruction | [Photoreal city-scale 4D reconstruction](30-autonomy-stack/localization-mapping/overview/photoreal-city-scale-4d-reconstruction.md) | Links Gaussian SLAM, VGGT/feed-forward reconstruction, dynamic 4D Gaussian/NeRF methods, and digital-twin simulation coverage. |
| Method-level 3D SLAM | [SLAM Library Overview](30-autonomy-stack/localization-mapping/slam-methods/overview.md) | Breaks classical, LiDAR including RKO-LIO sensor-agnostic LIO, LIVO, visual, dense, neural, Gaussian, radar, learned 4D radar odometry, radar place-recognition descriptors, radar RIO correspondence/uncertainty, Doppler radar-LiDAR bridge SLAM, raw GNSS factor fusion, wheel/vehicle-motion factors, radar-GNSS/visual mapping, multi-sensor, SLAM Toolbox, NDT variants, static-map lifecycle/removal and heterogeneous map-merging methods, and current SLAM benchmark coverage into focused method files. |
| GLIM and GTSAM pipeline | [GLIM and GTSAM Pipeline Hub](30-autonomy-stack/localization-mapping/slam-methods/glim-gtsam-pipeline-hub.md) | Maps GLIM pipeline stages to GTSAM objects, Bayes-tree updates, Hessians, sparse elimination, marginalization, and the supporting KB math pages. |
| SLAM coverage gaps | [SLAM Coverage Audit](30-autonomy-stack/localization-mapping/slam-methods/coverage-audit-2026.md) | Tracks promoted and remaining first-class SLAM pages, including May 2026 sweeps across LIO, LIVO, raw GNSS factor fusion, wheel/vehicle-motion factors, 4D radar, Gaussian/foundation SLAM, backends, collaborative SLAM, alternative sensors, and benchmarks. |
| First-principles estimator math | [Nonlinear Solver Diagnostics Crosswalk](10-knowledge-base/optimization/nonlinear-solver-diagnostics-crosswalk.md) | Routes estimator failures across residuals, Jacobians, scaling, damping, rank, covariance, constrained KKT/QP/SQP mechanics, robust-loss covariance consistency, fiducial/corner localization, two-view epipolar/homography verification, optical/scene-flow motion fields, and sparse backend choices, with links back into probability, optimization, numerical linear algebra, geometry, and state estimation foundations. |
| Machine learning foundations | [Machine Learning Foundations](10-knowledge-base/machine-learning/overview.md) | Starts from linear models and gradients through CNN/RNN/transformer/SSM foundations, self-supervision, world models, AV data-evaluation contracts, calibration, evaluation, and deployment review. |
| Control and decision foundations | [Control Foundations](10-knowledge-base/controls/overview.md) | Starts the foundations path for closed-loop tracking, vehicle dynamics, MPC/iLQR, constraints, MDP/POMDP decision models, safety filters, and planner-controller review. |
| Sensor and estimation fundamentals | [Sensor Foundations](10-knowledge-base/sensors/overview.md) | Starts the sensor-model foundation path, with supporting links into geometry, thermal IR radiometry, ultrasonic proximity sensing, state estimation, signal processing, timing, calibration, and wheel odometry. |
| Sensor readiness before algorithms | [Sensor-to-Algorithm Readiness Contract](20-av-platform/sensors/sensor-to-algorithm-readiness-contract.md) | Consolidates calibration, synchronization, preprocessing, health, provenance, and fail-closed gates before perception, fusion, SLAM, tracking, occupancy, mapping, or planning consumes sensor-derived inputs. |
| Perception validation datasets | [FOD and Airport Apron Detection Datasets](30-autonomy-stack/perception/datasets-benchmarks/fod-and-airport-apron-detection-datasets.md) | Connects MUSES, DSERT-RoLL, CMHT, [EmbodiedScan/MMScan](30-autonomy-stack/perception/datasets-benchmarks/embodiedscan-mmscan-embodied-3d-benchmarks.md), STU 3D anomaly segmentation, RCP-Bench, TruckV2X, V2X datasets, sensor-corruption benchmarks, open-world/OOD anomaly segmentation, FOD datasets, Airport-FOD3S synthetic data-engine routing, synthetic FOD validation, FOD validation, public-proxy boundary caveats, and knowledge-base evaluation protocols. |
| End-to-end architecture gaps | [Knowledge Gap Backlog](90-synthesis/readiness-risk/knowledge-gap-backlog.md) | Tracks P0/P1/P2 missing research files across fundamentals, platform, autonomy, runtime/cloud, safety, operations, and industry intelligence. |

## Corpus Map

| Section | Docs | Start At | What It Holds |
|---------|------|----------|---------------|
| `00-start-here/` | 4 | [Reading Guide](00-start-here/reading-guide.md) | Reader entry points and orientation material. |
| `10-knowledge-base/` | 137 | [Probability and Statistics Foundations](10-knowledge-base/probability-statistics/overview.md) | First-principles technical notes: probability/statistics, optimization, constrained KKT/QP/SQP solver mechanics, numerical linear algebra, geometry, mapping, state estimation, sensor likelihoods, thermal IR radiometry, ultrasonic proximity sensing, signal processing, controls, robotics, ML including AV data-evaluation contracts, calibration, timing, continuous-time trajectories, robust covariance consistency, fiducial/corner localization, two-view epipolar/homography verification, optical/scene-flow motion fields, and detection/tracking evidence. |
| `20-av-platform/` | 41 | [NVIDIA Orin Technical](20-av-platform/compute/nvidia-orin-technical.md) | Compute, sensors, sensor-to-algorithm readiness, connectivity, drive-by-wire, power, diagnostics, ruggedization, and edge-cloud architecture. |
| `30-autonomy-stack/` | 453 | [World Models Overview](30-autonomy-stack/world-models/overview.md) | World models, perception, method-level perception, planning, localization, infrastructure-aided localization, SLAM, simulation, VLA/VLM, E2E driving, and multi-agent systems. |
| `40-runtime-systems/` | 23 | [Production ML Deployment](40-runtime-systems/ml-deployment/production-ml-deployment.md) | ML deployment, ROS/Autoware, observability, teleoperation, software operations, and vehicle-side data logging. |
| `50-cloud-fleet/` | 32 | [Cloud Backend Infrastructure](50-cloud-fleet/data-platform/cloud-backend-infrastructure.md) | Data engines, fleet data loops, MLOps, OTA/SUMS, observability, map operations, data governance, perception/SLAM reliability telemetry, and fleet management. |
| `60-safety-validation/` | 56 | [Certification Guide](60-safety-validation/standards-certification/certification-guide.md) | Safety case, standards, runtime assurance, verification, validation, robustness, cybersecurity, incident reporting, reliability evidence, and evidence traceability. |
| `70-operations-domains/` | 27 | [Airside Industry Overview](70-operations-domains/airside/operations/industry-overview.md) | Airside, warehouse, yard, port, mining, agriculture, construction, road AV, delivery robot, deployment, business-case, and safety operations. |
| `80-industry-intel/` | 62 | [Company Index](INDEX.md#a-specific-company) | AV, airside, simulation, teleoperation, autonomy company profiles, market intelligence, and regulations. |
| `90-synthesis/` | 12 | [Master Synthesis](90-synthesis/master/master-synthesis.md) | Executive synthesis, POCs, readiness, risk, decision framework, architecture, gap backlog, continuous research loop, and active frontier source registry. |

## Domain Snapshot

| Technology | Docs |
|------------|------|
| World models | 18 |
| Perception | 211 |
| Method-level perception library | 138 |
| Planning | 16 |
| Localization and mapping | 180 |
| Method-level SLAM library | 154 SLAM-method documents including overview/audit |
| Simulation | 8 |
| VLA / VLM | 7 |
| Multi-agent and V2X | 7 |
| Robustness validation files | 9 |
| E2E driving | 6 |

| Operations | Docs |
|------------|------|
| Safety and validation | 56 |
| Deployment | 13 |
| Airside operations | 11 |
| Cross-domain operations | 9 |
| Teleoperation | 1 |

| AV Platform | Docs |
|-------------|------|
| Compute | 9 |
| Sensors | 19 |
| Networking/connectivity | 6 |
| Drive-by-wire | 2 |
| Power/electrical | 1 |
| Diagnostics | 2 |
| Ruggedization | 1 |
| Thermal | 1 |

## Reader Notes

- The static reader is generated from this repository with VitePress and deployed through GitHub Pages.
- `README.md` becomes the site home page.
- `INDEX.md` is served as `/INDEX/` in the reader to avoid a Windows case-insensitive output collision with the homepage.
- Research content is source-of-truth Markdown; the generated site is just a browser-friendly layer over the same files.
- Internal implementation notes under `docs/superpowers/`, `.claude/`, and `.superpowers/` are excluded from the static reader.
