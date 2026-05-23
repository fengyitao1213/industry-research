# GaussianFlowOcc

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["perception", "road-av", "validation", "mapping"]
  reason: "GaussianFlowOcc is rated for sparse, weakly supervised semantic occupancy with explicit temporal Gaussian flow."
method-priority:end -->

## What It Is

- GaussianFlowOcc is an ICCV 2025 semantic occupancy method that represents a driving scene with sparse 3D Gaussians rather than a dense voxel feature grid.
- It is designed for weakly supervised occupancy estimation from camera data, avoiding dense 3D voxel annotation during training.
- The method estimates temporal flow for each Gaussian so the representation carries scene dynamics instead of treating occupancy as a single-frame static field.
- It is distinct from [GaussianOcc](gaussianocc.md), which emphasizes fully self-supervised projection and pose-scale learning, and from [Streaming Gaussian Occupancy](streaming-gaussian-occupancy.md), which carries a persistent streaming state.
- The official code comes from Bosch Research and is released under AGPL-3.0, which matters for product teams evaluating reuse.

## Core Technical Idea

- Dense 3D convolutions spend memory and compute on mostly empty road-scene volume.
- GaussianFlowOcc replaces the dense internal volume with a sparse set of 3D Gaussians processed by a Gaussian Transformer.
- Each Gaussian carries occupancy/semantic evidence and a temporal flow estimate, allowing the model to represent motion without building a dense 4D voxel tensor.
- Training uses weak supervision and pseudo-label pipelines instead of costly dense occupancy annotation as the primary learning signal.
- Gaussian splatting makes the sparse representation compatible with occupancy-style rendering and evaluation.
- The deployment-facing promise is a lower-cost occupancy representation that still produces planner-readable semantic occupancy outputs.

## Inputs and Outputs

- Input at inference: synchronized surround-camera images plus calibrated camera intrinsics and extrinsics.
- Training input: nuScenes-style camera sequences, ego/camera calibration, pseudo depth, pseudo semantics, and dataset metadata.
- The official repository prepares pseudo depth with Metric3D and pseudo semantics with GroundedSAM-style tooling.
- Evaluation input can include Occ3D-nuScenes occupancy labels for benchmark scoring, even though dense voxel labels are not the core training dependency.
- Output: semantic 3D occupancy predictions derived from sparse Gaussian scene elements.
- Intermediate output: sparse 3D Gaussians with temporal-flow information.
- Non-output: no native LiDAR map, object-track API, free-space safety certificate, or long-term persistent map.

## Architecture or Pipeline

- Prepare nuScenes camera data, calibration metadata, pseudo depth, and pseudo semantic labels.
- Lift camera evidence into a sparse Gaussian scene representation instead of a dense voxel tensor.
- Use Gaussian Transformer blocks to refine Gaussian features, geometry, and semantic evidence.
- Estimate temporal flow per Gaussian during training so dynamic scene content can be modeled directly.
- Splat or decode the sparse Gaussian state into the occupancy output expected by semantic occupancy benchmarks.
- Evaluate against nuScenes/Occ3D-style occupancy metrics while keeping the weak-supervision budget explicit.

## Training and Evaluation

- The paper was accepted to ICCV 2025 and the CVF page lists the proceedings version.
- The arXiv version reports GaussianFlowOcc as weakly supervised semantic occupancy on nuScenes.
- The paper reports that it outperforms previous weakly supervised occupancy methods on nuScenes in the authors' setup.
- The paper also reports inference speed that is 50 times faster than the cited state of the art in that comparison.
- The official repository includes installation and data-preparation scripts for nuScenes, Occ3D-nuScenes labels for evaluation, pseudo depth generation, and pseudo semantic generation.
- Comparisons should separate weakly supervised occupancy from fully supervised voxel-label methods because the label budget and training assumptions differ.
- Deployment triage should measure not just IoU/mIoU but temporal flicker, flow consistency, small-object recall, free-space conservatism, and latency on the target edge computer.

## Strengths

- Avoids dense voxel compute for mostly empty 3D space.
- Reduces dependence on expensive dense 3D occupancy labels.
- Adds explicit temporal flow at the Gaussian level rather than smoothing outputs after the fact.
- Uses a representation that can potentially be inspected and compared with other Gaussian occupancy methods.
- The official repository makes reproduction more practical than paper-only frontier methods.
- AGPL licensing is explicit, so reuse risk can be identified early instead of late in a product evaluation.

## Failure Modes

- Weak supervision inherits errors from pseudo depth and pseudo semantic generators.
- Camera-only evidence remains vulnerable to occlusion, glare, darkness, reflective surfaces, and long-range depth ambiguity.
- Temporal flow can create coherent but wrong motion when camera timing, ego-motion, or calibration is off.
- Sparse Gaussians can underrepresent rare small hazards if allocation is dominated by large visible surfaces.
- Strong nuScenes results do not prove robustness for airside, warehouse, port, mine, construction, agricultural, delivery-robot, or campus ODDs.
- AGPL-3.0 code may be unsuitable for direct proprietary integration without legal review or a clean-room reimplementation.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV | Strong research fit | The method is benchmarked on driving data and targets camera semantic occupancy. |
| Airside | Conditional | Useful for label-scarce apron occupancy research, but must be audited on aircraft, GSE, wet pavement, floodlights, and small FOD. |
| Warehouse / logistics yard / port | Conditional | Sparse occupancy can transfer if cameras see enough structure and local pseudo-label quality is validated. |
| Mining / construction / agriculture | Weak to conditional | Dust, terrain, vegetation, and unusual objects increase pseudo-label and small-object risk. |
| Delivery robot / outdoor campus | Conditional | Near-field geometry may benefit from sparse occupancy, but low camera height and pedestrian clutter need separate validation. |

## Implementation Notes

- Reproduce the official nuScenes setup before changing the camera rig, voxel range, or class set.
- Keep weak-supervision provenance with every run: pseudo-depth model, pseudo-semantic model, prompt set, checkpoint, and generation date.
- Audit temporal-flow errors separately from semantic occupancy errors.
- Treat speed claims as configuration-specific until measured on the target hardware and voxel/output resolution.
- Add planning-facing checks for false free space, stale moving objects, thin obstacles, and unknown-space handling.
- If product integration is considered, decide early whether AGPL-3.0 is acceptable or whether the paper should be used only as a reimplementation reference.

## Local Cross-Links

- Sparse Gaussian occupancy neighbors: [GaussianFormer](gaussianformer.md), [GaussianOcc](gaussianocc.md), [Streaming Gaussian Occupancy](streaming-gaussian-occupancy.md), [GaussTR](gausstr.md).
- Rendering and projection supervision: [RenderOcc](renderocc.md), [GaussRender](gaussrender.md).
- Planner-facing occupancy context: [Dynamic Occupancy and Freespace](dynamic-occupancy-freespace.md), [Spatiotemporal Memory Occupancy Flow](spatiotemporal-memory-occupancy-flow.md).
- Broad synthesis: [3D Gaussian Splatting for Driving](../overview/gaussian-splatting-driving.md), [Occupancy World Models](../../world-models/occupancy-world-models.md).

## Sources

- GaussianFlowOcc arXiv paper: https://arxiv.org/abs/2502.17288
- ICCV 2025 paper page: https://openaccess.thecvf.com/content/ICCV2025/html/Boeder_GaussianFlowOcc_Sparse_and_Weakly_Supervised_Occupancy_Estimation_using_Gaussian_Splatting_ICCV_2025_paper.html
- Official GaussianFlowOcc repository: https://github.com/boschresearch/GaussianFlowOcc
- Occ3D-nuScenes dataset reference used in the official setup: https://github.com/Tsinghua-MARS-Lab/Occ3D
