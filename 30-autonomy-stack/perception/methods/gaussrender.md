# GaussRender

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["perception", "road-av", "validation", "mapping"]
  reason: "GaussRender is rated for improving 3D occupancy geometry through efficient projective Gaussian-rendering supervision."
method-priority:end -->

## What It Is

- GaussRender is a 3D occupancy learning module for improving geometric consistency in semantic occupancy models.
- It uses Gaussian splatting to render predicted and ground-truth occupancy into camera views, then applies 2D projection supervision.
- The module is designed to plug into existing 3D occupancy models rather than replacing the whole architecture.
- It adds training-time supervision and requires no inference-time architecture modification.
- GaussRender is not a streaming world model, a self-supervised pose method, or a radar/camera fusion method.

## Core Technical Idea

- Voxel-wise losses such as cross-entropy can produce floating artifacts and poor surface localization because they do not directly enforce visible 2D-3D consistency.
- GaussRender transforms occupancy voxels into Gaussian primitives before rendering depth and semantic projections.
- It projects both predicted and ground-truth 3D occupancy into 2D camera views.
- The loss penalizes 3D occupancy configurations that render inconsistently in image space.
- Gaussian splatting makes the projective loss efficient enough to use as an added module across multiple occupancy backbones.
- The main value is better geometric fidelity, especially on surface-sensitive metrics such as RayIoU.

## Inputs and Outputs

- Input at training: predicted 3D semantic occupancy from a base model.
- Required metadata: camera intrinsics, extrinsics, image sizes, voxel grid geometry, and camera-view projection records.
- Supervision input: ground-truth 3D occupancy or occupancy labels that can be rendered into 2D views.
- Training output: added projection-consistency losses over rendered depth/semantic views.
- Inference output: unchanged output contract from the base occupancy model.
- Non-goals: runtime occupancy forecasting, open-vocabulary semantics, instance tracking, and sensor-fusion confidence are outside the module.

## Architecture or Pipeline

- A base occupancy model such as TPVFormer, SurroundOcc, or Symphonies predicts semantic occupancy.
- GaussRender converts the predicted voxel occupancy into Gaussian primitives.
- The module renders depth and semantic views from the Gaussianized occupancy field.
- It applies projective 2D losses against rendered ground-truth occupancy views.
- The resulting loss is combined with the base model's occupancy training objective.
- At inference, GaussRender is removed; the base model runs normally.

## Training and Evaluation

- The ICCV 2025 paper evaluates on SurroundOcc-nuScenes, Occ3D-nuScenes, and SSCBench-KITTI360.
- Reported base models include TPVFormer, SurroundOcc, and Symphonies.
- The project page reports Occ3D-nuScenes improvements such as TPVFormer mIoU increasing from 27.83 to 30.48 and SurroundOcc mIoU increasing from 29.21 to 30.38 under the authors' setup.
- The same page reports RayIoU improvements for TPVFormer and SurroundOcc on Occ3D-nuScenes.
- Evaluation should distinguish the base model, dataset, voxel resolution, supervision labels, camera projection setup, and whether metrics emphasize volumetric IoU, semantic mIoU, or surface-sensitive RayIoU.
- Deployment triage should test whether improved projection fidelity reduces false-free-space and floating-object artifacts in downstream planning slices.

## Strengths

- Adds geometric consistency without forcing a new inference architecture.
- Reuses camera projection geometry that occupancy stacks already need.
- Works across multiple base occupancy models in the published experiments.
- Gaussian rendering is more efficient for this projective loss than heavier volumetric rendering.
- Surface-sensitive metrics make it easier to detect floating artifacts that aggregate mIoU can hide.
- Useful when a team wants to improve an existing occupancy model without changing runtime deployment code.

## Failure Modes

- Bad camera calibration or voxel-to-camera projection metadata can train the model toward wrong geometry.
- If ground-truth occupancy labels are noisy, rendered supervision will faithfully propagate those errors.
- Projection consistency mostly supervises visible surfaces; occluded or unobserved voxels can remain ambiguous.
- Better RayIoU or mIoU does not automatically prove conservative free-space behavior.
- The method does not solve domain-specific semantic label gaps for airside, warehouse, port, mining, construction, agricultural, or campus ODDs.
- Custom differentiable Gaussian rendering dependencies can complicate training reproducibility.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV | Strong research fit | GaussRender is evaluated on driving occupancy benchmarks and plugs into road-scene occupancy backbones. |
| Airside | Conditional | Helpful for reducing floating geometry in apron occupancy, but needs airside labels, reflective-surface tests, and clearance-focused validation. |
| Warehouse / logistics yard / port | Conditional | Projective consistency transfers if the camera rig, voxel grid, and labels match the site geometry. |
| Mining / construction / agriculture | Weak to conditional | Dust, terrain, vegetation, and unusual objects make label and projection QA more important than the module itself. |
| Delivery robot / outdoor campus | Conditional | Useful for camera occupancy training if near-field labels and camera calibration are strong enough. |

## Implementation Notes

- Treat GaussRender as a training module; do not add runtime dependencies unless the base model requires them.
- Reproduce one published base-model experiment before plugging the module into a different occupancy architecture.
- Version the voxel grid, camera projection code, and occupancy-label generator together.
- Track RayIoU or another surface-sensitive metric in addition to class mIoU.
- Add planning-facing slices for false free-space, overhanging structures, thin objects, and floating artifacts.
- Compare against RenderOcc and GaussianOcc because all three use rendering ideas but with different supervision and runtime contracts.

## Local Cross-Links

- Rendering-supervised occupancy: [RenderOcc](renderocc.md), [GaussianOcc](gaussianocc.md).
- Camera occupancy backbones: [TPVFormer](tpvformer.md), [SurroundOcc](surroundocc.md), [SparseOcc](sparseocc.md), [FlashOcc](flashocc.md).
- Gaussian occupancy and temporal state models: [Streaming Gaussian Occupancy](streaming-gaussian-occupancy.md), [GaussianFormer](gaussianformer.md), [GaussianOcc](gaussianocc.md).
- Planning-facing contrast: [Dynamic Occupancy Freespace](dynamic-occupancy-freespace.md), [Spatiotemporal Memory Occupancy Flow](spatiotemporal-memory-occupancy-flow.md).

## Sources

- GaussRender arXiv paper: https://arxiv.org/abs/2502.05040
- GaussRender project page: https://valeoai.github.io/publications/gaussrender/
- Official GaussRender repository: https://github.com/valeoai/GaussRender
- ICCV 2025 paper page: https://openaccess.thecvf.com/content/ICCV2025/html/Chambon_GaussRender_Learning_3D_Occupancy_with_Gaussian_Rendering_ICCV_2025_paper.html
