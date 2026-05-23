# QuantV2X

<!-- method-priority:start
priority:
  learning: 3
  deployment: 4
  type: "method"
  stage: "deployment-pattern"
  maturity: "prototype"
  tags: ["perception", "road-av", "validation"]
  reason: "QuantV2X is rated for deployment-oriented cooperative perception because it quantizes model execution and transmitted V2X feature messages."
method-priority:end -->

## What It Is

QuantV2X is a fully quantized multi-agent cooperative perception system for V2X intermediate fusion.

It addresses two deployment bottlenecks in cooperative perception:

- Full-precision neural inference is expensive on resource-constrained edge hardware.
- Full-precision BEV feature communication is expensive over V2X links.

The method quantizes both sides of the system: the neural network modules and the transmitted cooperative messages. The result is an intermediate-fusion design that is closer to real-time deployment constraints than methods that optimize only offline mAP.

## Core Technical Idea

QuantV2X uses a three-stage pipeline:

1. **Full-precision pretraining:** train a cooperative perception backbone that can produce useful BEV features.
2. **Codebook learning:** learn a compact codebook so agents can transmit codebook indices instead of dense full-precision BEV feature tensors.
3. **Post-training quantization:** quantize model weights/activations and the communication representation so compute, memory, and bandwidth are reduced together.

The important distinction is full-stack quantization. A model-only quantizer can reduce local inference cost while leaving V2X messages large. A communication-only compressor can reduce payload size while leaving local and fusion models too slow. QuantV2X treats model execution and message representation as one system budget.

## Inputs And Outputs

Inputs:

- Local RGB-image or LiDAR-derived perception features from multiple V2X agents.
- Agent poses and relative transforms for cooperative alignment.
- Intermediate BEV features from the cooperative backbone.
- Learned codebook entries and quantized feature indices.
- Deployment configuration for model precision, TensorRT export, and dataset-specific cooperative perception setup.

Outputs:

- Cooperative 3D object detections.
- Quantized intermediate messages for V2X communication.
- Decoded approximate BEV features for fusion.
- Deployment metrics including local inference latency, communication latency, fusion latency, and AP/mAP under the selected precision budget.

QuantV2X is not an occupancy method, tracker, V2X protocol, or security layer. Its primary output is cooperative 3D detection under a smaller compute and communication budget.

## Architecture Or Benchmark Protocol

The official project describes three main deployment-facing components:

- **Quantized codebook communication:** agents send compact codebook indices rather than full-precision BEV feature maps.
- **Alignment module:** cooperative features are geometrically corrected before fusion to reduce pose-error effects.
- **Unified end-to-end quantization:** neural modules and communication features are quantized together.

The public repository is built on the HEAL and V2X-Real codebase line, and supports:

- Full-precision baseline training and inference on V2X-Real.
- Codebook learning training and inference.
- Post-training quantization.
- OPV2V, OPV2V-H, DAIR-V2X-C, and V2X-Real dataset workflows.
- TensorRT export/deployment tutorials.

This makes QuantV2X more implementation-facing than watchlist-only cooperative compression papers that do not publish code or deployment scripts.

## Training And Evaluation

The paper reports deployment-oriented improvements in addition to accuracy:

- 3.2x end-to-end system speedup over full-precision baselines.
- +9.5 mAP30 over full-precision baselines under the paper's deployment-oriented metric.
- Project-page PTQ table on DAIR-V2X reports 4/8-bit QuantV2X at 74.2 AP30 and 66.7 AP50, compared with full precision at 75.1 AP30 and 68.2 AP50.
- The project-page latency breakdown reports component speedups of 1.6x local inference, 5.3x communication, and 2.5x fusion.

These numbers should be treated as paper/project claims until reproduced on the target hardware, middleware, and V2X network. The result is still valuable because it evaluates system latency rather than only offline detection accuracy.

## Strengths

- Compresses both inference and transmitted cooperative messages.
- Preserves most reported accuracy under low-bit constraints.
- Directly targets memory, compute, communication, and latency budgets.
- Public codebase includes TensorRT deployment support.
- Supports multiple common cooperative perception datasets.
- Codebook communication is more deployable than dense full-precision BEV feature sharing.
- Alignment module acknowledges pose errors and geometric inconsistency rather than assuming perfect cooperation.

## Failure Modes

- Quantization can amplify rare-class or low-confidence errors that are not visible in aggregate AP.
- Codebook indices may omit weak evidence that would have survived in full-precision features.
- Sender/receiver codebook, PTQ cache, TensorRT engine, feature schema, or ontology mismatch can decode plausible but wrong remote features.
- Alignment quality depends on pose, timestamp, and calibration integrity.
- V2X packet loss or stale messages can make decoded features confidently wrong.
- Dataset results are road/V2X-centric; airside ground equipment, aircraft, and FOD are out of distribution.
- TensorRT export does not prove safety-case readiness; P99 latency, WCET, memory contention, and network jitter still need validation.
- A malicious, compromised, or misconfigured cooperative agent can transmit compact but harmful features; QuantV2X is not a trust or authentication mechanism.

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV | Strong research fit | Evaluated on road cooperative perception datasets and directly addresses real-time V2X bottlenecks. |
| Airside AV | Conditional | Useful for private-airport V2V/V2I cooperation if retrained on airport classes and validated under apron geometry, low-speed stop-and-go motion, multipath, and blocked sightlines. |
| Warehouse / yard / port | Conditional | Attractive when many vehicles or fixed sensors share a constrained wireless channel; needs domain data and non-road object classes. |
| Mining / construction | Conditional | Bandwidth reduction is relevant for large sites, but dust, vibration, terrain, and non-road actors require fresh validation. |

## Deployment Notes

- Evaluate QuantV2X with online latency, not just offline mAP.
- Track local inference, encode/decode, transmit, receive, align, fuse, and detection-head latency separately.
- Verify P50, P95, P99, and worst-case message size under the actual network stack.
- Treat codebook version as a runtime artifact. All cooperating agents need compatible codebooks, model versions, coordinate frames, and quantization settings.
- Add health gates for stale messages, missing agents, pose uncertainty, clock skew, packet loss, and decode failure.
- Compare ego-only, late-fusion, full-precision intermediate-fusion, and QuantV2X outputs on the same locked scenario slices before accepting a deployment delta.
- Require per-class and per-ODD slice checks after quantization; aggregate mAP can hide calibration drift for rare people, FOD, cones, dollies, or low-profile equipment.
- Log accepted and rejected cooperative messages with sender ID, codebook/model manifest ID, packet age, pose covariance, fusion weight, and monitor decision.
- Compare against CoSDH-style region selection and CoopTrack-style sparse instance messages; the best communication primitive depends on whether the task is detection, tracking, occupancy, or planning.
- For safety cases, pair QuantV2X with RCP-Bench-style corruption tests and online V2X-ReaLO-style latency replay.

## How It Differs From Nearby Pages

- **CoSDH:** chooses where to communicate by supply/demand region selection and hybrid intermediate/late fusion. QuantV2X focuses on quantizing the model and feature message representation.
- **V2X-ReaLO:** evaluates online V2X latency and replay realism. QuantV2X is a method that can be evaluated inside such an online framework.
- **CoopTrack:** sends sparse instance features for tracking continuity. QuantV2X sends quantized intermediate features for cooperative detection.
- **mmCooper / CoST / CoopDETR:** focus on collaboration-robust fusion, spatiotemporal fusion, or query transmission. QuantV2X focuses on full-stack quantization of model execution and BEV feature communication.
- **VOGS-CP:** transmits sparse semantic Gaussian primitives for collaborative occupancy. QuantV2X instead compresses model execution and intermediate feature messages for cooperative detection.
- **RCooper / HoloVIC / CoInfra:** provide real infrastructure-cooperative data and benchmarks. QuantV2X is a compression/deployment method that can use V2X datasets.
- **Model compression pages:** cover general edge compression. QuantV2X is specific to cooperative perception where communication bandwidth and model quantization interact.

## Related Repository Docs

- [CoSDH](cosdh.md)
- [V2X-ReaLO](v2x-realo.md)
- [CoopTrack](cooptrack.md)
- [VOGS-CP](vogs-cp.md)
- [RCooper](rcooper.md)
- [HoloVIC](holovic.md)
- [CoInfra](coinfra.md)
- [Collaborative Fleet Perception](../overview/collaborative-fleet-perception.md)
- [Infrastructure Cooperative Perception](../overview/infrastructure-cooperative-perception.md)
- [Model Compression and Edge Deployment](../overview/model-compression-edge-deployment.md)
- [RCP-Bench Cooperative Corruption Robustness](../datasets-benchmarks/rcp-bench-cooperative-corruption-robustness.md)
- [V2X Large-Range Sequential Datasets](../datasets-benchmarks/v2x-large-range-sequential-datasets.md)
- [Perception-SLAM Runtime Interface Contract](../../../40-runtime-systems/ml-deployment/perception-slam-runtime-interface-contract.md)
- [Sensor Dropout, Latency, and Jitter Stress Protocol](../../../60-safety-validation/verification-validation/sensor-dropout-latency-jitter-stress-protocol.md)

## Sources

- QuantV2X arXiv paper: https://arxiv.org/abs/2509.03704
- QuantV2X project page: https://quantv2x.github.io/QuantV2X/
- QuantV2X official repository: https://github.com/ucla-mobility/QuantV2X
