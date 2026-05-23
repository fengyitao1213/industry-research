# SparseDrive

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method-family"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["perception", "road-av"]
  reason: "Fully sparse end-to-end driving stack that unifies detection, tracking, online mapping, and motion planning."
method-priority:end -->

## What It Is

- SparseDrive is a fully sparse end-to-end autonomous driving stack proposed by Sun et al. in 2024.
- It unifies detection, tracking, online mapping, motion prediction, and planning inside a single differentiable model.
- Unlike earlier end-to-end stacks such as UniAD and VAD, SparseDrive removes the dense BEV feature map and operates on sparse queries throughout the pipeline.
- The design is motivated by the cost of dense BEV features and the limitations of cascaded prediction-then-planning heads.

## Core Technical Idea

- Replace dense BEV features with a symmetric sparse perception module that shares query design across detection, tracking, and online mapping.
- Treat motion prediction and planning as the same kind of multi-modal trajectory generation problem and run them in parallel from a shared scene representation rather than chained sequentially.
- Generate multiple candidate ego trajectories and select among them with a hierarchical, collision-aware re-scoring strategy that biases toward safe and rational plans.
- Train the full stack end-to-end on planning-oriented supervision in addition to per-task losses.

## Inputs and Outputs

- Input: multi-view surround camera images with intrinsics, extrinsics, ego pose, and timestamps.
- Optional input: high-level navigation command or destination signal for the planner.
- Training input: 3D detection, tracking, online map, motion-forecasting, and ego-trajectory labels from nuScenes.
- Output: per-frame 3D agent detections, track identities, online map elements such as lanes and crossings, multi-modal agent forecasts, and a selected ego-trajectory plan.

## Architecture or Pipeline

- Image backbone extracts multi-scale per-camera features.
- A symmetric sparse perception module runs three query streams that share the same encoder design: an agent query stream for detection and tracking, and a map query stream for online mapping elements.
- Agent and map queries refine 3D anchors through transformer decoder layers and propagate features across frames for temporal consistency and track identity.
- A parallel motion planner head takes agent and map queries as scene context and generates multi-modal motion forecasts for other agents and multi-modal ego-trajectory candidates simultaneously.
- A hierarchical planning selection stage scores ego candidates with a collision-aware re-scoring module that penalizes trajectories likely to collide with predicted agent futures.
- The selected ego trajectory is the final planner output; intermediate per-task outputs remain available for monitoring and interfacing.

## Training and Evaluation

- Main benchmark: nuScenes open-loop planning, detection, tracking, and online mapping.
- Reported gains over UniAD and VAD in detection NDS, tracking AMOTA, online-map AP, motion-forecasting metrics, and planning L2 and collision-rate metrics, with substantially lower training cost.
- Ablations isolate the contribution of the symmetric sparse perception module, the parallel motion planner, and the collision-aware hierarchical planning selection.
- The paper reports faster training and inference than dense BEV end-to-end baselines because the model never materializes a full BEV feature tensor.

## Strengths

- Fully sparse pipeline avoids the dominant compute and memory cost of dense BEV end-to-end stacks.
- Parallel motion-and-plan head reduces error accumulation that can occur when planning is conditioned on a frozen, brittle prediction stage.
- Collision-aware hierarchical selection adds an explicit safety bias to plan choice rather than treating the planner as a regression problem only.
- Modular per-task outputs make it possible to monitor perception, mapping, and prediction quality separately from plan quality.
- Strong starting point for sparse end-to-end driving research, including downstream integration of diffusion or VLM-style planners.

## Failure Modes

- Open-loop nuScenes planning metrics are weak proxies for closed-loop safety; SparseDrive numbers should not be over-interpreted without closed-loop or sim-based evaluation.
- Camera-only sensing inherits depth ambiguity, occlusion sensitivity, and adverse-weather degradation.
- Sparse online maps may miss faint or atypical road structure; planning that trusts these outputs can fail at unusual intersections or temporary layouts.
- Collision-aware re-scoring depends on the quality of agent forecasts; systematically biased forecasts can pass through to plan selection.
- End-to-end training couples all tasks; regressions in one head can degrade others, and root-cause analysis is harder than with a fully decoupled stack.

## Domain Fit

- Road AV: primary intended domain; covers urban driving, intersections, and multi-agent interactions on standard road layouts.
- Airside: limited direct fit; lane-style mapping does not capture taxi guidelines, stop bars, and stand markings, and the agent set excludes aircraft, GSE, and ground crew. Useful as a reference for the sparse end-to-end pattern, not as a deployable airside stack.
- Warehouse, yard, port, mining, construction, agriculture, delivery robot, campus: applicable as a design pattern rather than as a drop-in stack; each domain needs new agent classes, map primitives, and safety constraints.

## Implementation Notes

- Reproduce open-loop nuScenes numbers as a sanity baseline before changing the architecture or training mix.
- Replace nuScenes online-map elements with the relevant ones for the target domain, including stop bars, crosswalks, or domain-specific guidance lines.
- Tune query budgets, anchor priors, and class lists per deployment domain; do not reuse nuScenes settings.
- Keep all intermediate task outputs and log them in production so the end-to-end stack can be monitored, not only inspected through plan metrics.
- Pair with a runtime safety filter or simplex-style monitor; the collision-aware selection inside SparseDrive is not a substitute for an external safety case.
- Evaluate in closed-loop simulation in addition to open-loop nuScenes before drawing planning conclusions.

## Sources

- SparseDrive paper: https://arxiv.org/abs/2405.19620
- Official SparseDrive repository: https://github.com/swc-17/SparseDrive
- nuScenes planning, detection, tracking, and mapping benchmarks: https://www.nuscenes.org
