# LaMAria City-Scale Visual-Inertial SLAM Benchmark

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "benchmark"
  stage: "reference"
  maturity: "fielded-pattern"
  tags: ["slam", "validation", "data-engine", "outdoor", "indoor"]
  reason: "Current visual-inertial SLAM benchmark for egocentric motion, city-scale routes, low light, moving platforms, and control-point evaluation."
method-priority:end -->

Related docs: [SLAM Benchmarking Metrics and Datasets](benchmarking-metrics-datasets.md), [OpenVINS](openvins.md), [VINS-Mono and VINS-Fusion](vins-mono-vins-fusion.md), [ORB-SLAM2 and ORB-SLAM3](orb-slam2-orb-slam3.md), [MASt3R-SLAM](mast3r-slam.md), and [SLAM3R / VGGT Foundation SLAM](slam3r-vggt-foundation-slam.md).

**Last updated:** 2026-05-23

## Executive Summary

LaMAria is an ICCV 2025 egocentric visual-inertial SLAM dataset and benchmark from ETH Zurich, Meta Reality Labs Research, Google, and Microsoft Spatial AI Lab. It was built to test a failure mode that classic EuRoC/TUM-style VIO benchmarks do not cover well: long, city-scale wearable motion with dynamic visual content, low-light sections, vehicle or moving-platform segments, and time-varying calibration.

The key value is not that LaMAria looks like a road AV sensor suite. It does not. Its value is that it gives SLAM researchers a much harder visual-inertial metric benchmark with control-point based ground truth at city scale. For AV, warehouse, campus, and airside readers, it is a stress test for visual-inertial fallback and map-inspection pipelines, not a replacement for LiDAR-inertial or scan-to-map localization validation.

## What It Contains

The official dataset page describes:

- 23 training sequences and 63 test sequences.
- Raw Aria recordings, Aria calibration, pinhole-converted ASL format data, ROS 1 bags, and pinhole calibration files.
- Sparse control-point ground truth and pseudo-dense ground truth for training sequences.
- Closed test-set ground truth with benchmark submission through the website.
- Sequence categories spanning controlled experiments, additional short/medium/long routes, low-light routes, and moving-platform routes.
- Code under the public `cvg/lamaria` repository for downloading and working with the dataset.

The paper frames the benchmark around glasses-like egocentric sensors rather than vehicle-mounted cameras. That matters: wide head/body motion, short-range visual clutter, occlusions, and moving people create different failure patterns from a rigid AV roof sensor bar.

## Evaluation Model

LaMAria exposes two complementary evaluation styles:

| Evaluation signal | What it measures | Why it matters |
|---|---|---|
| Sparse control-point alignment | Drift against centimeter-accurate surveyed control points | Allows long trajectory evaluation without dense ground truth everywhere. |
| Dense pseudo-ground-truth pose recall | Fraction of keyframes within a position-error threshold after sparse alignment | Catches failures over long city routes, including low-light and moving-platform sections. |
| Benchmark tracks | Different difficulty levels and held-out test data | Reduces overfitting and makes immature systems easier to diagnose. |
| Calibration variants | Raw device model plus pinhole-converted data | Separates algorithm limitations from camera-model support limitations. |

For this corpus, report LaMAria results separately from EuRoC, TUM VI, KITTI, and Hilti-style construction benchmarks. The domain, camera geometry, and motion profile are different enough that averaging scores would hide the actual failure mode.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Visual-inertial SLAM research | Strong | Directly tests city-scale egocentric VIO/SLAM under dynamic content and long routes. |
| Indoor service robots / warehouses | Conditional | Useful for low-light, dynamic, and calibration stress; not a floor-plan or wheel-odometry benchmark. |
| Outdoor campus robots | Conditional | Long routes and lighting variation transfer; wearable motion and sensor placement differ. |
| Road AV | Weak to conditional | Useful for camera/IMU fallback studies and visual map QA, but not a vehicle sensor-suite benchmark. |
| Airside | Weak to conditional | Good for visual-inertial failure analysis; does not test aircraft, wet apron, repeated stands, LiDAR maps, RTK, or radar. |

## Failure Modes It Exposes

- Visual-inertial tracking loss under low light and dynamic visual clutter.
- Scale or drift accumulation over long routes when metric constraints are weak.
- Calibration sensitivity for unusual camera models and time-varying device behavior.
- Overconfident pose estimates that look smooth locally but diverge at control points.
- Benchmark overfitting when only a small indoor VIO dataset is used.

## Implementation Notes

- Treat the closed test ground truth as part of the benchmark contract; do not tune directly on test feedback.
- Preserve the distinction between raw Aria data and pinhole-converted data when comparing methods.
- Report whether a method uses IMU, map priors, learned depth, retrieval, or external scale cues.
- Compare against OpenVINS/VINS/ORB-style classical baselines and foundation-model visual SLAM baselines separately.
- Use LaMAria as a visual-inertial stress benchmark beside, not instead of, LiDAR/radar/RTK benchmarks for AV localization.

## Limitations

- It is an egocentric wearable dataset, not a vehicle-mounted AV dataset.
- It does not validate 3D LiDAR map construction, scan-to-map localization, radar localization, or vehicle dynamics.
- Test-set ground truth is intentionally closed for benchmark integrity.
- Large downloads and format variants make reproducibility dependent on exact preprocessing.
- It should not be used to claim airside or road AV readiness without target-domain data.

## Sources

- LaMAria official project page: https://www.lamaria.ethz.ch/
- LaMAria dataset page: https://lamaria.inf.ethz.ch/slam_datasets
- LaMAria documentation: https://lamaria.inf.ethz.ch/slam_documentation
- LaMAria official repository: https://github.com/cvg/lamaria
- Krishnan et al., "Benchmarking Egocentric Visual-Inertial SLAM at City Scale", ICCV 2025: https://openaccess.thecvf.com/content/ICCV2025/papers/Krishnan_Benchmarking_Egocentric_Visual-Inertial_SLAM_at_City_Scale_ICCV_2025_paper.pdf
- arXiv record: https://arxiv.org/abs/2509.26639
