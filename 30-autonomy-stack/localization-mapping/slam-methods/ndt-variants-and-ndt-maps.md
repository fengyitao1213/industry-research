# NDT Variants and NDT Maps

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method-family"
  stage: "deployment-pattern"
  maturity: "fielded-pattern"
  tags: ["slam", "mapping", "runtime-localization", "warehouse", "outdoor", "validation"]
  reason: "Extends core NDT into D2D registration, dynamic maps, Monte Carlo localization, and compact map representations."
method-priority:end -->

Related library pages: [Normal Distributions Transform](ndt.md), [Production LiDAR Map Localization](../overview/production-lidar-map-localization.md), and [GICP/VGICP](gicp-vgicp.md).

## Executive Summary

The main [NDT](ndt.md) page covers the core point-to-distribution scan-matching objective used for LiDAR localization. This page covers the adjacent family that often gets hidden behind the same acronym: 3D-NDT, distribution-to-distribution NDT, NDT occupancy maps, NDT Monte Carlo localization, multi-resolution NDT maps, and production dynamic-map-loading patterns.

These variants matter because NDT is not only a registration cost. It can also be a compact map representation, a probabilistic localization likelihood, a dynamic-environment map update model, or a coarse-to-fine map pyramid. That makes it useful for industrial vehicles, warehouses, mines, parking garages, road AV localization, and mapped outdoor robots that need a compact, explainable alternative or complement to ICP/GICP/VGICP.

For airside and other open outdoor AV domains, the same caution from the core NDT page still applies: smooth likelihood is not observability. Open aprons, broad flat ground, repeated facades, wet surfaces, and changed aircraft/GSE layouts can produce plausible NDT scores while leaving lateral or yaw directions weak.

## Family Map

| Variant | Main idea | Best use |
|---|---|---|
| Point-to-distribution NDT | Match live points to Gaussian cells in a target map | Mature scan-to-map localization and coarse alignment. |
| 3D-NDT | Extend NDT to 3D scan registration and loop detection | Mines, tunnels, industrial vehicles, and 3D LiDAR mapping. |
| Distribution-to-distribution NDT | Match Gaussian cells in both source and target | Faster compact registration and D2D scan-to-map matching. |
| NDT-OM | Combine NDT cell shape with occupancy probability updates | Dynamic 3D mapping and compact world models. |
| NDT-MCL | Use NDT maps and sensor likelihoods inside particle localization | Industrial AGV localization and global/recovery localization. |
| Multi-resolution NDT maps | Maintain coarse and fine NDT grids | Wide convergence basin plus precision refinement. |
| Dynamic-loaded NDT maps | Load local map tiles around the current pose | Large-scale AV localization without loading an entire point cloud map. |

## Inputs and Outputs

| Stage | Inputs | Outputs |
|---|---|---|
| NDT map construction | Static map cloud, voxel/cell resolution, minimum points per cell | Cell means, covariances, inverse covariances, occupancy/stability metadata. |
| D2D registration | Source NDT cells, target NDT cells, initial transform | Relative pose, score, Hessian/information, convergence status. |
| NDT-OM update | Range measurements, sensor model, prior cells | Updated occupancy probability plus distribution parameters. |
| NDT-MCL | Particle set, odometry proposal, NDT sensor likelihood | Weighted pose hypotheses and posterior estimate. |
| Runtime localization | Live scan, local NDT tiles, estimator prior | Pose, covariance estimate, score, valid-cell metrics, diagnostics. |

## Distribution-to-Distribution Registration

Point-to-distribution NDT evaluates transformed live points under target-map Gaussian cells. Distribution-to-distribution NDT instead summarizes both clouds as local distributions and compares cell pairs.

For a source cell `p` and target cell `q`:

```text
d = mu_q - (R mu_p + t)
S = Sigma_q + R Sigma_p R^T
cost = d^T S^-1 d + log |S|
```

The practical effect is that the registration cost uses compact cell statistics rather than every source point. It is close in spirit to GICP/VGICP, but the local distributions come from NDT cells rather than per-point neighborhoods.

Advantages:

- Fewer primitives than raw point registration.
- Natural map compression.
- Smooth score landscape for coarse alignment.
- Direct access to cell covariance and information.

Risks:

- Cell resolution controls both accuracy and runtime.
- Sparse cells produce unstable covariance.
- Gaussian cells can hide multimodal local geometry.
- Dynamic objects can become high-confidence cells if map construction is not filtered.

## NDT Occupancy Maps

NDT-OM adds occupancy probability to the NDT cell representation. Instead of storing only whether a voxel is occupied, a cell stores both occupancy and a Gaussian distribution over observed points. This gives the map a compact shape model while preserving occupancy-style updates.

The representation is useful when the system needs:

- 3D maps that are more compact than dense occupancy grids.
- Probabilistic updates in dynamic industrial environments.
- A shared representation for mapping and localization.
- Multi-resolution behavior from the recursive update equations.

The key deployment concern is map semantics. Occupancy probability can update faster than the Gaussian shape estimate, so dynamic objects, parked equipment, and temporary structures must be handled deliberately. In fleet map operations, store the map version, update policy, observation counts, and decay model along with the NDT cells.

## NDT-MCL

NDT-MCL replaces a conventional grid-map likelihood field with an NDT representation inside Monte Carlo localization. Each particle is scored by how well the observed scan fits the NDT map under that particle pose.

This is useful for:

- Industrial AGV localization where repeatability matters.
- Recovery from larger initial uncertainty than a local optimizer can tolerate.
- Comparing particle hypotheses before committing to one scan-matching basin.
- Warehouse or factory routes where the map is stable but repeated structures cause ambiguity.

For AV-scale use, NDT-MCL is more likely to be a startup/relocalization aid than the normal high-rate pose source. The particle set must be bounded, map lookup must be fast, and the accepted mode should still pass estimator innovation and scene-consistency checks.

## Multi-Resolution and Dynamic Map Loading

Large mapped domains need more than one NDT map resolution. A typical production pipeline uses:

```text
coarse NDT map:
  wider convergence basin, global startup, lower memory

medium NDT map:
  normal localization and fallback

fine NDT map or VGICP:
  final scan-to-map refinement where structure supports it
```

Autoware's current NDT scan matcher documentation is a useful production reference because it exposes regularization, initial-pose estimation service behavior, diagnostics, real-time covariance topics, and dynamic map loading. Dynamic map loading requests nearby pointcloud map tiles around the current pose so large maps do not have to be held in memory as one file.

For road, yard, port, airport, and campus systems, dynamic NDT map loading should be treated as part of the map product:

- Tile size and radius must match vehicle speed and localization uncertainty.
- The localizer should know which map version and tile set produced the pose.
- Loading failures should degrade localization confidence, not silently reuse stale tiles.
- Large map chunks can fail operational assumptions even if they fit on disk.
- Tile boundaries need overlap or hysteresis to avoid score discontinuities.

## Failure Modes

| Failure mode | Why it matters | Mitigation |
|---|---|---|
| Cell underpopulation | Covariances become singular or overfit noise | Minimum point count, eigenvalue regularization, cell rejection. |
| Over-large cells | Small structures are blurred and multiple poses look valid | Coarse-to-fine refinement and fine-level acceptance gates. |
| Repeated structure | Similar cell distributions create aliasing | Particle/global hypotheses, semantic priors, route constraints, place recognition. |
| Dynamic map contamination | Temporary objects become strong Gaussian cells | Multi-session filtering, temporal decay, dynamic-object masks, map QA. |
| Degenerate open areas | Ground-dominant cells constrain vertical axes but not lateral/yaw | Hessian eigenvalue checks, covariance inflation, GNSS/wheel/IMU priors. |
| Bad regularization prior | GNSS or route prior pulls NDT into wrong basin | Innovation gating, source health checks, robust prior weighting. |
| Tile loading gap | Local map is missing or stale | Map-loader diagnostics, local fallback, conservative covariance, safe speed reduction. |

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV | Strong as runtime reference | Autoware-style NDT is a mature localization reference, especially with diagnostics and map loading. |
| Warehouse / AGV | Strong | NDT-MCL and compact maps transfer well where infrastructure-like repeatability matters. |
| Mining / tunnels | Strong | 3D-NDT has direct mining-vehicle lineage; longitudinal degeneracy still needs checks. |
| Outdoor campus | Good | Compact maps and recovery hypotheses help long routes, but seasonal change needs map maintenance. |
| Ports and logistics yards | Good | Useful for mapped outdoor/indoor transitions with GNSS aids and controlled routes. |
| Airside | Conditional | Good as coarse/fallback localization near structure; weak as sole pose source on open apron. |
| Construction | Conditional | Map changes quickly; NDT maps need freshness and dynamic-change handling. |
| Agriculture | Conditional | Vegetation dynamics and sparse structure weaken stable Gaussian maps. |

## Implementation Notes

| Implementation | Role | License / caveat |
|---|---|---|
| PCL `NormalDistributionsTransform` | Reference point-to-distribution NDT implementation | BSD-3-Clause PCL ecosystem. |
| Autoware `ndt_scan_matcher` | Production-oriented ROS 2 NDT localization with diagnostics and map loading | Apache-2.0 ecosystem; interface conventions matter. |
| `fast_gicp` `NDTCuda` | CUDA D2D NDT-style registration path | BSD-3-Clause repository; useful for GPU comparison. |
| `ndt_omp` | OpenMP accelerated NDT implementation | BSD-2-Clause repository; common ROS ecosystem reference. |
| MOLA NDT metric maps | Metric-map representation and localization research path | Check module license and dependencies before product use. |

Implementation checklist:

1. Define which NDT role is being used: map, local optimizer, global/localization likelihood, or fallback.
2. Store cell resolution, covariance regularization, minimum point count, and map version in logs.
3. Record valid-cell ratio, score, iteration count, Hessian spectrum, and prior terms with every accepted pose.
4. Benchmark perturbation recovery separately from normal tracking accuracy.
5. Compare NDT acceptance against VGICP/ICP or an independent odometry source on the same replay.
6. Treat map loading and tile freshness as localization health inputs.

## Practical Recommendation

Use the core [NDT](ndt.md) page when the question is "how does NDT scan matching work?" Use this page when the question is "which NDT representation or deployment variant should I evaluate?"

Recommended split:

```text
Normal tracking:
  estimator prior -> local NDT or VGICP -> covariance/diagnostic gate

Startup and recovery:
  NDT-MCL or multi-hypothesis NDT -> ICP/VGICP verification -> estimator reset

Large maps:
  dynamic-loaded map tiles -> multi-resolution NDT -> map-version logging

Dynamic environments:
  NDT-OM or NDT map maintenance -> temporal filtering -> map QA before release
```

NDT variants remain valuable because they are compact, interpretable, mature, and easy to diagnose compared with many learned localization methods. Their main risk is overconfidence in weak or stale geometry.

## Sources

- Biber, P. and Strasser, W. (2003). "The Normal Distributions Transform: A New Approach to Laser Scan Matching." IROS. DOI: `10.1109/IROS.2003.1249285`. https://ieeexplore.ieee.org/document/1249285/
- Magnusson, M., Lilienthal, A., and Duckett, T. (2007). "Scan registration for autonomous mining vehicles using 3D-NDT." Journal of Field Robotics. DOI: `10.1002/rob.20204`. https://doi.org/10.1002/rob.20204
- Magnusson, M. (2009). "The Three-Dimensional Normal-Distributions Transform - an Efficient Representation for Registration, Surface Analysis, and Loop Detection." Orebro University PhD thesis. https://www.diva-portal.org/smash/get/diva2:276162/FULLTEXT02.pdf
- Stoyanov, T., Magnusson, M., Andreasson, H., and Lilienthal, A. J. (2012). "Fast and accurate scan registration through minimization of the distance between compact 3D NDT representations." IJRR. DOI: `10.1177/0278364912460895`. https://journals.sagepub.com/doi/10.1177/0278364912460895
- Saarinen, J., Andreasson, H., Stoyanov, T., and Lilienthal, A. J. (2013). "3D normal distributions transform occupancy maps: An efficient representation for mapping in dynamic environments." IJRR. DOI: `10.1177/0278364913499415`. https://journals.sagepub.com/doi/10.1177/0278364913499415
- Saarinen, J., Andreasson, H., Stoyanov, T., and Lilienthal, A. J. (2013). "Normal distributions transform Monte-Carlo localization (NDT-MCL)." IROS. DOI: `10.1109/IROS.2013.6696380`. https://doi.org/10.1109/IROS.2013.6696380
- Autoware `ndt_scan_matcher` documentation. https://autowarefoundation.github.io/autoware_core/latest/localization/autoware_ndt_scan_matcher/
- PCL NDT tutorial. https://pointclouds.org/documentation/tutorials/normal_distributions_transform.html
- Koide `fast_gicp` repository. https://github.com/koide3/fast_gicp
- Koide `ndt_omp` repository. https://github.com/koide3/ndt_omp
