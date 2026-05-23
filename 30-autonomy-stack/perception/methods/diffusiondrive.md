# DiffusionDrive

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method-family"
  stage: "frontier"
  maturity: "prototype"
  tags: ["perception", "road-av"]
  reason: "Truncated diffusion policy that makes diffusion-based end-to-end driving fast enough for real-time use."
method-priority:end -->

## What It Is

- DiffusionDrive is an end-to-end autonomous driving model that uses a truncated diffusion policy as its planner head.
- It was proposed by Liao et al. and accepted to CVPR 2025 as a Highlight.
- The method addresses the main practical limitation of diffusion-based driving policies: their denoising chains are usually too long to meet real-time inference budgets in open-world traffic.
- DiffusionDrive demonstrates that diffusion planning can be both multi-modal and fast enough for driving when the diffusion schedule is truncated and seeded from learned anchors.

## Core Technical Idea

- Treat ego planning as a multi-mode action distribution and learn it with a diffusion policy.
- Replace pure Gaussian noise initialization with prior multi-mode anchors that already cover the typical maneuver set, then run a short denoising schedule from those anchors instead of from scratch.
- Truncate the diffusion schedule so the policy only needs a handful of denoising steps, often as few as two, while still producing diverse and high-quality trajectories.
- Use a cascade diffusion decoder so each denoising step interacts efficiently with scene context features rather than treating the score model as an isolated network.

## Inputs and Outputs

- Input: multi-view surround camera images with intrinsics, extrinsics, ego pose, timestamps, and optional navigation command.
- Conditional input to the policy: scene context features from the upstream perception stack.
- Training input: ego-trajectory supervision and the standard NAVSIM planning-oriented evaluation labels.
- Output: a set of candidate ego trajectories sampled from the truncated diffusion policy, plus a selected trajectory.

## Architecture or Pipeline

- Perception backbone extracts multi-view image features; the paper uses a ResNet-34 backbone for the aligned comparison setting.
- A scene context encoder turns image features into a compact representation consumed by the policy decoder.
- Multi-mode anchors are learned or chosen so they cover dominant ego-maneuver clusters, then perturbed into the truncated diffusion starting distribution.
- A cascade diffusion decoder runs a small number of denoising steps, each conditioned on scene context features.
- The decoder emits multiple trajectory samples per inference call; selection logic chooses the final plan.

## Training and Evaluation

- Main benchmark: NAVSIM planning-oriented evaluation built around the OpenScene data and the PDM-style scoring metric.
- Reported result: 88.1 PDMS on NAVSIM with an aligned ResNet-34 backbone, setting a new record at submission time without specialized backbones or tuning tricks.
- Inference speed: 45 FPS on a single NVIDIA RTX 4090 with two denoising steps, which is roughly a ten-times reduction in denoising steps compared to a vanilla diffusion policy at similar quality.
- Qualitative results on challenging scenarios show diverse plausible trajectories rather than mode collapse.
- Comparison against vanilla diffusion policy and against regression and classification-based planners isolates the contribution of truncation, anchors, and cascade decoding.

## Strengths

- Truncated diffusion makes diffusion-based driving policies practical for real-time inference on production-class GPUs.
- Multi-mode planning naturally captures maneuvers such as nudge-left, brake-and-yield, or lane-change without collapsing to a single regression mean.
- Cascade decoder design uses scene context per step, which improves grounding compared to score networks that ignore conditioning detail.
- Strong NAVSIM result with a small ResNet-34 backbone shows the gains come from the policy design, not from a heavier encoder.
- Provides a clean baseline for combining diffusion planners with sparse or VLM-style perception stacks.

## Failure Modes

- NAVSIM is open-loop and does not capture all closed-loop safety failure modes; reported numbers should not be read as full validation.
- Multi-mode outputs require a selection step; weak selection logic can pick a low-probability but visually plausible mode.
- Truncated schedules make the policy more dependent on the quality of the anchor distribution; if anchors miss a needed maneuver class, the policy may not recover with so few denoising steps.
- Diffusion-based planners remain harder to certify than constrained optimization planners because their decision boundaries are implicit.
- Real-time numbers are reported on a desktop-class RTX 4090; in-vehicle compute may require additional optimization or larger denoising budgets.

## Domain Fit

- Road AV: primary intended domain; NAVSIM evaluation targets urban driving with realistic agent interactions.
- Airside: relevant only as a pattern; airside trajectory generation must respect aircraft separation, wing clearance, and stand geometry, which are not represented in NAVSIM. Any airside use needs a safety filter on top of the diffusion samples.
- Warehouse, yard, port, mining, construction, agriculture, delivery robot, campus: usable where multi-mode maneuver choice helps, such as around humans and equipment, but always paired with a deterministic safety envelope or rule layer.
- General: best treated as a planner pattern that complements a separate safety case rather than as a stand-alone policy.

## Implementation Notes

- Reproduce the reported NAVSIM result with the aligned ResNet-34 backbone before changing perception or backbone.
- Choose and audit the multi-mode anchors per deployment domain; anchors learned from public driving data may not cover domain-specific maneuvers such as taxiing or yard turns.
- Measure inference latency on the target compute with the production perception stack; do not rely on RTX 4090 numbers.
- Pair the diffusion policy with a safety filter, runtime monitor, or rule-based planner that can reject unsafe samples regardless of policy confidence.
- Log sampled trajectories, selected trajectory, and selection scores per frame for offline auditing and disengagement analysis.
- Evaluate in closed-loop simulation and in shadow mode on a fleet before drawing planning conclusions from open-loop scores alone.

## Sources

- DiffusionDrive paper: https://arxiv.org/abs/2411.15139
- Official DiffusionDrive repository: https://github.com/hustvl/DiffusionDrive
- NAVSIM benchmark: https://github.com/autonomousvision/navsim
