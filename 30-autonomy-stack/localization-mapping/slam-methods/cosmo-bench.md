# COSMO-Bench

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "benchmark"
  stage: "reference"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "validation", "data-engine", "outdoor"]
  reason: "COSMO-Bench is rated as a collaborative SLAM optimization benchmark for comparing multi-robot backends and deployment assumptions."
method-priority:end -->

Related docs: [Distributed Multi-Robot Pose Graph Optimization](distributed-multi-robot-pgo.md), [Kimera-Multi](kimera-multi.md), [COVINS/COVINS-G](covins-covins-g.md), [D2SLAM](d2slam.md), [Kimera-RPGO and Pairwise Consistency Maximization](kimera-rpgo-pcm.md), and [SLAM Benchmarking Metrics and Datasets](benchmarking-metrics-datasets.md).

**Last updated:** 2026-05-22

## Executive Summary

COSMO-Bench is a benchmark suite for collaborative SLAM optimization. It is not a perception dataset or a complete robot stack benchmark; it is aimed at the backend problem that appears after local SLAM front ends have produced odometry, intra-robot loop closures, and inter-robot loop closures.

The benchmark matters because multi-robot SLAM papers often compare on private graphs, synthetic graphs, or single-robot datasets converted after the fact. COSMO-Bench provides public multi-robot factor-graph datasets derived from real LiDAR data, with communication-model variants and explicit loop-closure outlier labels.

## What It Contains

- 24 COSMO-Bench datasets derived from real-world LiDAR data and a baseline distributed C-SLAM front end.
- Dataset variants generated under Wi-Fi and Pro-Radio communication models.
- JSON Robot Log (JRL) files containing per-robot measurements, reference solutions, initializations, potential outlier factors, and actual outlier factors.
- Intra-robot loop closures and inter-robot loop closures with reported counts and outlier rates.
- Checksum files so downloaded datasets can be validated before experiments.
- Additional Nebula multi-robot datasets converted into the same JRL format for convenience.

## Benchmark Role

Use COSMO-Bench when the question is:

- Can a centralized or distributed multi-robot backend converge from realistic initializations?
- How sensitive is the backend to false intra-robot and inter-robot loop closures?
- How much communication does a distributed method need under different link models?
- Does a robust backend improve residuals without over-pruning useful loop closures?
- Can the evaluation separate odometry quality from multi-robot graph optimization quality?

Do not use COSMO-Bench as the only evidence for a full autonomy stack. It does not validate perception, tracking, planning, local obstacle avoidance, or vehicle-level safety behavior.

## Data Model

Each dataset records robot-indexed data:

- `name`: dataset name.
- `robots`: participating robot identifiers.
- `measurements`: timestamped measurements per robot.
- `groundtruth`: reference solution per robot for quantitative evaluation.
- `initialization`: initial estimate from LOAM odometry.
- `potential_outlier_factors`: candidate loop-closure factors that may be outliers.
- `outlier_factors`: factors labeled as actual outliers for evaluation.

This structure is useful for backend evaluation because it lets a method test both optimization quality and outlier handling without rebuilding the front end.

## Front-End Assumptions

The official configuration page documents the baseline front end used to generate the measurements:

- High-rate odometry is sub-sampled into keyframes.
- Keyframes are selected by distance; the documented threshold is 2 m.
- Intra-robot and inter-robot loop-closure candidates use Scan Context.
- Inter-robot loop closure involves exchanging LiDAR scans between teammates.
- Loop-closure measurements are computed with KISS-Matcher.
- KISS-Matcher rejects many bad matches, but realistic spurious measurements remain, which is intentional for benchmark stress.

These assumptions matter because COSMO-Bench evaluates backend robustness under a specific front-end design. A production team should still test its own place recognition, registration, communication, and covariance models.

## Evaluation Signals

Recommended metrics:

- Absolute and relative trajectory error after optimization.
- Per-robot and joint-graph residuals.
- Inlier/outlier loop-closure precision and recall.
- Sensitivity to inter-robot loop outlier rate.
- Convergence iterations and failure rate.
- Communication bytes per optimization step or per final accuracy improvement.
- Centralized reference result versus distributed backend result.
- Runtime and memory by robot count and graph size.

Report Wi-Fi and Pro-Radio variants separately. Communication model differences can change which inter-robot constraints are available, so averaging across variants can hide the exact failure mode.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Multi-robot research | Strong | Directly targets collaborative SLAM backend optimization and outlier handling. |
| Warehouse / logistics yard / port | Conditional | Useful for backend design and fleet map merging, but local sensor front ends and floor-plan constraints need separate tests. |
| Airside | Conditional | Relevant to collaborative survey and fleet map alignment, but not a substitute for airport-specific repeated-stand, aircraft, GSE, wet-tarmac, and GNSS-multipath validation. |
| Road AV fleet mapping | Conditional | Helpful for multi-session and multi-vehicle backend experiments; public road map release still needs HD-map QA, geodetic anchors, and privacy controls. |
| Single-robot SLAM | Weak | The benchmark is over-scoped if the method has no inter-robot or distributed optimization component. |

## Failure Modes It Exposes

- Inter-robot loop closures that pass descriptor matching but are geometrically wrong.
- Backends that converge on local minima after accepting a small number of bad cross-robot constraints.
- Distributed solvers that need too much communication for field use.
- Methods that perform well centrally but degrade under delayed or limited communication.
- Overconfident loop-closure covariances that dominate local odometry.
- Evaluation scripts that hide per-robot failure by reporting only aggregate error.

## Limitations

- It is an optimization benchmark, not a raw sensor benchmark for perception or front-end SLAM.
- It inherits the baseline front-end choices, including Scan Context and KISS-Matcher behavior.
- LiDAR-derived datasets do not cover camera-only, radar-only, thermal, or event-camera collaborative SLAM.
- Public communication models are useful abstractions but do not replace site-specific wireless tests.
- Airside, mining, ports, and warehouses still need their own dynamic-object, map-change, and safety validation sequences.
- Dataset correction notes and checksums should be treated as part of the benchmark contract.

## Implementation Notes

- Start with centralized optimization to establish a reference for each graph before testing a distributed method.
- Validate dataset checksums before running experiments.
- Keep inter-robot loop closures, intra-robot loop closures, and odometry residuals separated in logs.
- Use the labeled outlier factors for evaluation, but do not train or tune directly on test labels if reporting benchmark results.
- Track convergence per communication byte for distributed methods.
- Compare robust kernels, PCM/GNC-style filtering, switchable constraints, and explicit outlier rejection on the same graphs.
- Preserve robot frame conventions and timestamp semantics when converting JRL data into GTSAM, Ceres, g2o, or custom solvers.

## Sources

- COSMO-Bench official dataset site: https://www.cosmobench.com/
- COSMO-Bench front-end configuration: https://www.cosmobench.com/front-end.html
- COSMO-Bench arXiv paper: https://arxiv.org/abs/2508.16731
- COSMO-Bench data DOI from arXiv: https://doi.org/10.1184/R1/29652158
- JSON Robot Log repository: https://github.com/DanMcGann/jrl
