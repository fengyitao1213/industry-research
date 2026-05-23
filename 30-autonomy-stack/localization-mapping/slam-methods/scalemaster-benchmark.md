# ScaleMaster Benchmark

<!-- method-priority:start
priority:
  learning: 4
  deployment: 3
  type: "benchmark"
  stage: "reference"
  maturity: "prototype"
  tags: ["slam", "validation", "data-engine", "indoor"]
  reason: "ScaleMaster is rated as a focused monocular SLAM benchmark for scale consistency and map-quality failure analysis in large indoor and multi-floor environments."
method-priority:end -->

Related docs: [SLAM Benchmarking Metrics and Datasets](benchmarking-metrics-datasets.md), [MASt3R-SLAM](mast3r-slam.md), [DROID-SLAM](droid-slam.md), [SLAM3R / VGGT Foundation SLAM](slam3r-vggt-foundation-slam.md), [Bundle Adjustment SLAM](bundle-adjustment-slam.md), and [Nonlinear Solver Diagnostics Crosswalk](../../../10-knowledge-base/optimization/nonlinear-solver-diagnostics-crosswalk.md).

**Last updated:** 2026-05-23

## Executive Summary

ScaleMaster is an ICRA 2026 monocular visual SLAM dataset and benchmark focused on scale consistency. It asks a narrow but important question: do modern deep monocular SLAM systems keep a coherent metric scale when they leave room-scale RGB-D-style settings and enter large indoor, multi-floor, repetitive, low-texture routes?

This is not a visual-inertial benchmark. It is a monocular scale and map-quality benchmark, with ARKit trajectories, RGB images, IMU logs, depth/confidence maps, optimized odometry, and LiDAR reference maps for selected sequences. Its main value for this corpus is the direct map-to-map quality framing: trajectory ATE alone can miss scale collapse, warped floors, and map inconsistency that matter for robots using visual maps for inspection or planning.

## What It Contains

The project repository describes:

- 25 sequences across libraries, large halls, parking and basement areas, stairs, stations, offices, lounges, labs, and hotel-room environments.
- Large indoor routes, including multi-floor movement, stairs, repetitive views, low texture, low light, and in-place rotations.
- RGB images from an iPhone 14 Pro at 1920x1440.
- ARKit VIO odometry, depth maps, confidence maps, and IMU measurements.
- Optimized odometry from a refinement pipeline using loop-closure verification and GTSAM pose-graph optimization.
- Seven LiDAR reference maps from a Livox HAP-based reference capture for map-quality evaluation.
- A map-evaluation script for comparing SLAM reconstructions against reference maps.

The arXiv paper reports that the benchmark evaluates both trajectory accuracy and 3D reconstruction quality, including Chamfer-distance style map-to-map comparison against high-fidelity LiDAR references.

## Evaluation Model

| Evaluation signal | What it checks | Why it matters |
|---|---|---|
| ATE over long indoor routes | Global pose error across scale-challenging sequences | Shows trajectory drift and gross failures. |
| Scale consistency | Intra-session scale drift and inter-session ambiguity | Targets the main weakness of monocular systems. |
| Map-to-map quality | Reconstruction alignment against LiDAR reference maps | Catches warped or collapsed maps even when some poses look acceptable. |
| Failure stratification | Multi-floor, repetitive, low-texture, long, and rotation-heavy sequences | Makes the source of scale failure more visible. |

Use ScaleMaster beside, not instead of, visual-inertial benchmarks such as LaMAria, Hilti x Trimble 2026, EuRoC, TUM VI, and multi-sensor datasets such as FusionPortableV2.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Deep monocular SLAM research | Strong | Directly targets scale consistency and dense-map quality. |
| Indoor service robots | Conditional | Useful as a visual map-quality stress test, but real robots should add wheel, IMU, LiDAR, fiducial, or floor-plan constraints. |
| Warehouse / depot / terminal interiors | Conditional | Repetitive views and multi-floor routes transfer; handheld capture differs from vehicle-mounted rigs. |
| Road AV | Weak | Monocular-only SLAM is not an AV pose backbone. |
| Airside | Weak | Useful only for terminal/hangar visual inspection or monocular fallback studies, not open-apron localization. |

## Failure Modes It Exposes

- Monocular scale drift over long routes.
- Catastrophic map deformation in large halls, libraries, stairwells, and repetitive interiors.
- False confidence from trajectory-only metrics when dense geometry is wrong.
- Poor handling of low texture, pure rotations, vertical motion, and loop-heavy routes.
- Overreliance on learned depth priors without independent metric constraints.

## Implementation Notes

- Treat ScaleMaster as benchmark coverage, not as generally reusable training data, unless access and license terms are confirmed for the target use.
- Report whether a method uses ARKit, depth, learned priors, IMU, or only monocular RGB.
- Keep ATE, scale drift, and map-quality metrics separate.
- Use the LiDAR reference-map subset for geometry checks; do not infer map quality from every sequence.
- Compare DROID-SLAM, MASt3R-SLAM, VGGT-SLAM-style systems, and classical monocular baselines separately because they use different priors and compute budgets.

## Limitations

- Access is request-gated through the project form.
- The repository did not expose a clear open-source license during this pass; treat redistribution and commercial reuse as unconfirmed.
- It is indoor and handheld, not a vehicle-mounted benchmark.
- It targets monocular scale consistency rather than full multi-sensor operational localization.
- It should not be used as the only evidence for planner-facing map quality.

## Sources

- ScaleMaster official repository and project content: https://github.com/JooHyoSeok/ScaleMaster-Dataset
- ScaleMaster arXiv record: https://arxiv.org/abs/2602.18174
- ScaleMaster PDF: https://arxiv.org/pdf/2602.18174
- ScaleMaster project page listed by the authors: https://scalemaster-dataset.github.io/
- Dataset access form linked by the project: https://forms.gle/C7jjz3hiT5JHppJ87

