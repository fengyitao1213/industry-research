# TEOcc

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["perception", "road-av", "fallback", "adverse-weather", "validation"]
  reason: "TEOcc is rated for radar-camera semantic occupancy and temporal robustness under degraded perception conditions."
method-priority:end -->

## What It Is

- TEOcc is a radar-camera multi-modal semantic occupancy method for autonomous-driving scene understanding.
- It adds temporal enhancement to dense 3D occupancy prediction rather than only improving the voxel representation.
- The method uses multi-view cameras and radar inputs, then trains a temporal branch to improve occupancy prediction from surrounding frames.
- The temporal enhancement branch is used during training and discarded at inference, so the runtime model stays closer to the base occupancy head cost.
- TEOcc is an occupancy predictor, not a box detector, tracker, planner, or radar-only method.

## Core Technical Idea

- Existing semantic occupancy models often focus on representation design while underusing long temporal context.
- TEOcc randomly discards one historical camera frame during training and asks the model to reconstruct its 3D occupancy from adjacent temporal and multi-modal evidence.
- A long-term temporal decoder captures broader scene evolution.
- A short-term temporal decoder captures near-frame continuity.
- Both decoders use 3D convolutional layers designed to keep temporal enhancement computationally bounded.
- A shared occupancy prediction head serves both the temporal branch and the main branch, so temporal supervision improves the main prediction pathway without adding inference-time heads.

## Inputs and Outputs

- Input: multi-view camera frames and radar features or radar-derived multi-modal features.
- Required metadata: camera/radar calibration, camera intrinsics, extrinsics, timestamps, ego-motion alignment, and image augmentations.
- Training input: temporal camera/radar sequences and semantic occupancy labels in a nuScenes-style setup.
- Output: dense 3D semantic occupancy grid in ego coordinates.
- Training-only output: reconstructed occupancy for a randomly removed historical frame through the temporal enhancement branch.
- Non-goals: instance tracks, object trajectories, open-vocabulary labels, and uncertainty-calibrated occupancy are not native outputs.

## Architecture or Pipeline

- Camera and radar encoders extract modality-specific features.
- Multi-modal fusion produces 3D occupancy features for the main branch.
- During training, one historical camera frame is randomly dropped.
- Long-term and short-term temporal decoders infer occupancy for the dropped frame using adjacent frames and multi-modal inputs.
- The temporal branch and main branch share a lightweight dense occupancy prediction head.
- At inference, the temporal enhancement branch is removed, leaving the main occupancy predictor.

## Training and Evaluation

- Primary benchmark: nuScenes occupancy prediction.
- The arXiv paper reports state-of-the-art occupancy performance on nuScenes under its experimental setup.
- The paper was accepted by ECAI 2024.
- The official repository provides code, configs, released model weights, and tested software environments.
- Evaluation should report mIoU/IoU, voxel class breakdowns, temporal-window settings, radar representation, camera count, inference branch configuration, and runtime backend.
- Deployment evaluation should include dropped frames, camera/radar timestamp skew, radar-camera calibration drift, low light, rain/fog/spray, and dynamic-object persistence.

## Strengths

- Directly targets the temporal blind spot in many camera/radar occupancy models.
- Radar input gives metric and motion cues when camera evidence is weak.
- Training-only temporal enhancement can improve robustness without adding an inference branch.
- The long/short temporal split makes it easier to reason about persistent context versus near-frame continuity.
- Dense occupancy is more planner-facing than boxes for irregular hazards and free/occupied-space decisions.
- Released code and weights make the method easier to reproduce than paper-only follow-ons.

## Failure Modes

- Temporal supervision can preserve stale occupancy after object motion or scene changes.
- Camera-radar calibration drift can produce false occupied or false free voxels.
- Radar sparsity, sidelobes, and multipath can create persistent artifacts, especially around metal structures.
- Camera-only semantic labels can smear through 3D when depth or projection is wrong.
- nuScenes evidence does not validate airside, warehouse, port, mining, construction, or agricultural object taxonomies.
- Training-only temporal branches still need inference-time stress testing because the branch is absent during deployment.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV | Strong research fit | TEOcc is built around nuScenes-style road-scene semantic occupancy with camera/radar inputs. |
| Airside | Conditional | Radar-camera occupancy is attractive for night, rain, fog, spray, and reflective aprons, but needs aircraft/GSE/FOD labels and multipath validation around aircraft and terminal glass. |
| Warehouse / logistics yard / port | Conditional | Temporal occupancy can transfer to low-speed vehicles and workers, but radar placement, clutter, and object taxonomy require site-specific evaluation. |
| Mining / construction / agriculture | Weak to conditional | Dust, vibration, terrain, vegetation, and unusual machines make direct road-trained transfer risky. |
| Delivery robot / outdoor campus | Conditional | Useful for degraded visual conditions only if the radar/camera rig has enough near-field coverage and occupancy labels. |

## Implementation Notes

- Keep camera-radar calibration and timestamp provenance attached to every training example.
- Compare TEOcc against the base occupancy model with the temporal branch disabled to isolate the benefit.
- Validate whether the training-only branch improves inference under actual camera dropout, radar dropout, and temporal desynchronization.
- Track false free-space separately from class mIoU because planning risk is asymmetric.
- Tune voxel height/range and class taxonomy before moving from road scenes to airports, yards, ports, mines, construction sites, farms, or campuses.
- Treat radar evidence as a confidence source to expose, not a black-box feature that silently overrides camera semantics.

## Local Cross-Links

- Radar-camera occupancy family: [4D Radar-Camera Occupancy](4d-radar-camera-occupancy.md).
- Radar-camera detection and depth contrasts: [RaCFormer](racformer.md), [TacoDepth](tacodepth.md), [CVFusion](cvfusion.md).
- Camera occupancy baselines: [DepthOcc](depthocc.md), [SurroundOcc](surroundocc.md), [SparseOcc](sparseocc.md), [FlashOcc](flashocc.md).
- Temporal occupancy and flow: [Cam4DOcc](cam4docc.md), [Spatiotemporal Memory Occupancy Flow](spatiotemporal-memory-occupancy-flow.md), [Dynamic Occupancy Freespace](dynamic-occupancy-freespace.md).

## Sources

- TEOcc arXiv paper: https://arxiv.org/abs/2410.11228
- Official TEOcc repository: https://github.com/VDIGPKU/TEOcc
