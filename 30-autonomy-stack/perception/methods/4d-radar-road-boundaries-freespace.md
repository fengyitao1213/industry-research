# 4D Radar Road Boundaries and Freespace

<!-- method-priority:start
priority:
  learning: 3
  deployment: 4
  type: "method-family"
  stage: "deployment-pattern"
  maturity: "prototype"
  tags: ["perception", "fallback", "validation", "adverse-weather", "road-av"]
  reason: "4D Radar Road Boundaries and Freespace is rated for alternative-sensor perception and adverse-weather fallback evaluation."
method-priority:end -->

## What It Is

- This page covers 4D radar methods for road-boundary detection and radar-derived drivable freespace.
- The anchor method is 4DRadarRBD, a 2025 4D mmWave radar road-boundary curve detector.
- 4DRadarRBD uses radar point clouds to detect static physical edges of the available driving area, such as fences, bushes, and roadblocks.
- The broader freespace connection is that boundary curves and radar occupancy maps both define where the vehicle should not drive.
- This is separate from radar object detection and from dense 4D radar-camera occupancy.
- For dense radar occupancy, see [4D Radar-Camera Occupancy](4d-radar-camera-occupancy.md).

## Core Technical Idea

- 4D mmWave radar provides range, azimuth, elevation, and Doppler, enabling all-weather geometric sensing.
- Road boundaries reflect millimeter waves, producing radar points that can be segmented from clutter.
- 4DRadarRBD first filters noisy points using physical constraints for plausible road boundaries.
- It then performs point-wise boundary segmentation with a distance-based loss that penalizes false boundary detections far from true boundaries.
- It adds temporal dynamics by comparing each point to the motion-compensated road-boundary estimate from the previous frame.
- It fits continuous boundary curves from segmented points so planning can consume curves rather than disconnected returns.

## Inputs and Outputs

- Input: 4D mmWave radar point cloud.
- Per-point radar features: x, y, z, Doppler velocity, signal-to-noise ratio, and range.
- Vehicle-state input: velocity and yaw rate from GPS/IMU or the localization stack.
- Optional input for freespace systems: radar occupancy probabilities or BEV grid outputs.
- Output: point-wise road-boundary segmentation.
- Output: continuous left/right or multi-curve road-boundary estimates.
- Planning output: drivable corridor, freespace boundary, or boundary constraints for path planning.

## Assumptions and Boundaries

- The anchor evidence is road-driving data, so transfer to unstructured yards, aprons, mines, farms, and campuses needs local validation.
- The method assumes physical boundary objects produce enough radar returns to separate boundary points from clutter.
- Open paved areas marked only by paint, geofences, or operating rules need map and camera support; radar boundary curves alone cannot infer procedural no-go zones.
- A boundary detector does not prove that the interior corridor is clear; small-obstacle, FOD, pedestrian, and overhang detection remain separate safety requirements.
- Radar freespace confidence should degrade under multipath, low point count, calibration drift, or stale ego-motion compensation.

## Architecture or Pipeline

- Module 1: preprocess radar points, extract point-wise features, reduce noise, and fuse frames to mitigate sparsity.
- Module 2: segment boundary points using a PointNet++-style point-cloud network.
- Add a distance-based loss so far-away false positives are penalized more strongly.
- Add temporal-deviation features from the previous motion-compensated boundary estimate.
- Module 3: cluster detected boundary points and fit continuous road-boundary curves.
- For freespace use, convert boundary curves or radar occupancy maps into drivable-space polygons with confidence.
- Keep radar ghost and multipath signals visible in diagnostics rather than silently smoothing them away.

## Training and Evaluation

- 4DRadarRBD is evaluated through real-world driving tests.
- The Frontiers paper reports 93% road-boundary point segmentation accuracy.
- It reports a median distance or Chamfer error of 0.023 m and a 92.6% error reduction versus the baseline model.
- On twisting mountain-road cases, the paper reports 91.2% point-wise segmentation accuracy and a median Chamfer distance of 0.11 m.
- Evaluation should include boundary point accuracy, curve error, temporal stability, false boundary creation, and missed-boundary gaps under occlusion.
- Freespace evaluation should use both free-space precision and collision-relevant false-free metrics.

## Strengths

- Radar is robust to darkness, glare, fog, rain, and some spray conditions where cameras degrade.
- 4D elevation helps distinguish overhead structures from boundaries that block motion.
- Boundary curves provide a compact planner-friendly representation.
- Temporal features improve stability despite radar sparsity and ego motion.
- Radar freespace can complement camera lane/curb perception and LiDAR geometry.
- The method is valuable where object taxonomy is incomplete but the drivable corridor still matters.

## Failure Modes

- Radar multipath and ghost reflections can create false boundaries near metal, glass, fences, aircraft, or terminal structures.
- Large occluding vehicles can block returns from true boundaries and split curves.
- Low radar point density can miss thin cones, ropes, chocks, tow bars, hoses, or low curbs.
- Boundary-style training may not generalize to open aprons where drivable areas are marked by paint or procedures rather than physical barriers.
- Temporal propagation can carry a false boundary forward if confidence is not checked.
- A detected boundary is not a complete freespace proof; interior obstacles still need detection or occupancy.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV | strong | The primary 4DRadarRBD evidence is road-boundary detection on real driving data, with radar point segmentation and curve fitting targeted at road edges and barriers. |
| Airside | conditional | Strong adverse-weather value for service roads, stand edges, terminal curbs, fence lines, and fixed barriers, but open aprons often need maps, cones, painted limits, aircraft no-go zones, and FOD validation. |
| Logistics yard / port / warehouse yard | conditional | Useful where trailers, containers, walls, fences, and dock edges produce radar-visible boundaries; weaker where drivable corridors are policy-defined rather than physically bounded. |
| Mining / construction / agriculture | conditional | Radar can help in dust, darkness, and glare, but berms, vegetation, terrain slopes, and temporary work zones require domain-specific labeling and false-boundary tests. |
| Delivery robot / outdoor campus | weak | Low-speed robots need curb, pedestrian, and small-obstacle handling at close range; sparse 4D radar boundary curves are more likely to be an auxiliary signal than a primary freespace layer. |

## Implementation Notes

- Preserve raw radar features, SNR, Doppler, elevation, and per-point timestamps.
- Use ego-motion compensation from the production localization stack, not a loosely synchronized estimate.
- Log boundary confidence and temporal carry-over source for every fitted curve segment.
- Add airport-specific false-positive tests around aircraft stands, jet bridges, glass facades, wet pavement, and metallic GSE.
- Fuse with HD map no-go zones so radar cannot open forbidden areas.
- Validate downstream planning behavior with missing-boundary, false-boundary, and boundary-jump scenarios.

## Local Cross-Links

- Dense radar occupancy: [4D Radar-Camera Occupancy](4d-radar-camera-occupancy.md).
- Radar detection baselines: [RadarPillars](radarpillars.md), [K-Radar](k-radar.md), [V2X-Radar](v2x-radar.md).
- Current/future occupancy and freespace: [Dynamic Occupancy Freespace](dynamic-occupancy-freespace.md), [Spatiotemporal Memory Occupancy Flow](spatiotemporal-memory-occupancy-flow.md).
- Radar platform constraints: [4D Radar](../../../20-av-platform/sensors/4d-radar.md).
- Validation context: [Perception/SLAM Corruption Fault-Injection Protocol](../../../60-safety-validation/verification-validation/robustness/perception-slam-corruption-fault-injection-protocol.md).

## Sources

- 4DRadarRBD Frontiers paper: https://www.frontiersin.org/journals/signal-processing/articles/10.3389/frsip.2025.1667789/full
- 4DRadarRBD arXiv paper: https://arxiv.org/abs/2503.01930
- NVRadarNet radar freespace paper: https://arxiv.org/abs/2209.14499
- NVIDIA RadarNet overview: https://developer.nvidia.com/blog/detecting-obstacles-and-drivable-free-space-with-radarnet/
