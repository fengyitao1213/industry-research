# DepthOcc

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["perception", "road-av", "validation", "mapping"]
  reason: "DepthOcc is rated for BEV, occupancy, or freespace modeling that feeds planning-facing autonomy stacks."
method-priority:end -->

## What It Is

- DepthOcc is a vision-based 3D semantic occupancy method for autonomous-driving scene understanding.
- It targets the real-time camera-occupancy setting where dense 3D voxel networks are too expensive but planning still needs occupied/free space and semantic class evidence.
- The method improves lightweight occupancy pipelines by fusing monocular and stereo depth cues before view transformation.
- It also adds temporal enhancement so frame history contributes more than simple feature concatenation.
- DepthOcc is a semantic occupancy predictor, not a detector, tracker, or radar-camera fusion method.

## Core Technical Idea

- Lightweight camera occupancy models often lose information in two places: depth estimation for image-to-BEV lifting and coarse temporal fusion.
- DepthOcc addresses the depth side with a Multi-Depth Fused View Transformer that jointly uses monocular depth compensation and stereo cost-volume geometry.
- It applies perspective transformations over the depth layers and fuses the resulting BEV features.
- DepthOcc addresses the temporal side with a Temporal Enhancement Occupancy Head that performs multi-temporal interaction before the final occupancy prediction.
- The design keeps the model in the real-time camera-occupancy family while improving depth precision and temporal consistency.

## Inputs and Outputs

- Inputs: synchronized multi-view camera frames.
- Required calibration: camera intrinsics, extrinsics, and ego-motion metadata for view transformation and temporal alignment.
- Training labels: semantic 3D occupancy labels compatible with Occ3D-nuScenes or a similar voxel-label format.
- Output: 3D semantic occupancy grid with occupied/free-space semantics by voxel.
- Intermediate outputs: fused depth representation, BEV features, and temporally enhanced occupancy features.
- Non-goals: instance IDs, object trajectories, uncertainty calibration, and open-vocabulary classes are not native outputs.

## Architecture

- Image backbone extracts per-camera image features.
- Multi-depth estimation predicts complementary monocular and binocular stereo depth evidence.
- Multi-Depth Fused View Transformer lifts image features through the fused depth representation into BEV or voxel-aligned features.
- BEV feature fusion combines transformed features from multiple depth layers.
- Temporal Enhancement Occupancy Head models interactions across temporal features instead of only concatenating aligned frames.
- Occupancy head predicts semantic occupancy logits over the target voxel grid.

## Training and Evaluation

- Primary reported benchmark: Occ3D-nuScenes semantic occupancy.
- The ScienceDirect article reports 43.5% mIoU and 10.3 FPS on Occ3D-nuScenes, with a 3.5 mIoU gain over its baseline under the paper's setup.
- Occ3D-nuScenes is derived from nuScenes and evaluates camera-visible voxels with semantic occupancy labels.
- Evaluation should report mIoU, FPS, hardware/backend, input resolution, camera count, temporal window, and whether inference uses PyTorch, TensorRT, or another runtime.
- Compare against BEVDepth, BEVStereo, FlashOcc, SurroundOcc, SparseOcc, Cam4DOcc, and spatiotemporal-memory occupancy baselines.
- For deployment triage, split false occupied, false free-space, dynamic-object, vertical-object, and near-field errors instead of relying only on aggregate mIoU.

## Strengths

- Directly targets the depth-estimation bottleneck in camera-only occupancy.
- Combines monocular and stereo cues, which can reduce single-depth failure modes.
- Temporal enhancement can stabilize occupancy compared with frame-local prediction.
- Reported runtime is in the real-time range under the paper's benchmark conditions.
- It fits stacks that already use BEVDet/BEVDepth-family geometry and Occ3D-style occupancy labels.
- The output is planner-facing because it estimates space occupancy rather than only bounding boxes.

## Failure Modes

- Camera calibration and timestamp errors can corrupt both depth fusion and temporal enhancement.
- Stereo cues can be weak under low texture, glare, darkness, weather, or rolling-shutter motion.
- Monocular depth compensation can hallucinate plausible but unsafe geometry in rare layouts.
- Temporal enhancement can preserve stale occupancy after an object leaves or after an occluded object appears.
- Occ3D-nuScenes evidence is road-scene evidence; transfer to airports, mines, ports, or warehouses needs new labels and validation.
- Thin, reflective, transparent, elevated, or overhanging hazards can be underrepresented by road-centric semantic occupancy labels.
- Reported FPS may not transfer across hardware, runtime backend, resolution, or batch size.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV | Strong research fit | DepthOcc is evaluated on a road AV semantic occupancy benchmark and targets camera-centric 3D scene understanding. |
| Airside | Conditional | Useful as a camera occupancy candidate, but needs apron labels for aircraft overhangs, GSE, FOD, cones, personnel, glare, wet pavement, and night operations. |
| Warehouse / logistics yard / port | Conditional | Geometry and temporal cues can transfer, but camera placement, object taxonomy, and close-range occlusion need domain-specific validation. |
| Mining / construction / agriculture | Weak to conditional | Dust, mud, vibration, non-road terrain, and unusual object classes make direct road-trained transfer risky. |
| Delivery robot / outdoor campus | Conditional | Smaller rigs and lower camera baselines may reduce stereo quality; near-field false-free-space errors need focused tests. |

## Implementation Notes

- Treat camera calibration, time synchronization, and ego-motion compensation as part of the model contract.
- Preserve the benchmark configuration when comparing numbers: backbone, input resolution, temporal frames, grid size, and runtime backend.
- Log depth confidence or proxy uncertainty so the planner can distinguish observed free space from inferred free space.
- Stress test camera dropout, camera misalignment, low-light, rain/fog/spray, wet reflective surfaces, and dirty lenses.
- Tune voxel height bins and class taxonomy before adapting to airside or industrial domains.
- Compare against a simpler FlashOcc or BEVDepth-based occupancy baseline before adding DepthOcc complexity.
- Do not route DepthOcc into radar-camera queues unless a separate fusion method adds radar inputs.

## Local Cross-Links

- Camera depth and BEV foundations: [BEVDepth](bevdepth.md), [BEVStereo](bevstereo.md), [BEVDet](bevdet.md).
- Camera semantic occupancy: [FlashOcc](flashocc.md), [SurroundOcc](surroundocc.md), [SparseOcc](sparseocc.md), [TPVFormer](tpvformer.md), [SelfOcc](selfocc.md).
- Temporal occupancy and flow: [Cam4DOcc](cam4docc.md), [Spatiotemporal Memory Occupancy Flow](spatiotemporal-memory-occupancy-flow.md), [Dynamic Occupancy Freespace](dynamic-occupancy-freespace.md).
- Multimodal occupancy contrast: [LiDAR-Camera Occupancy Fusion](lidar-camera-occupancy-fusion.md), [4D Radar-Camera Occupancy](4d-radar-camera-occupancy.md).

## Sources

- DepthOcc article: https://www.sciencedirect.com/science/article/pii/S1077314226000378
- DepthOcc DOI: https://doi.org/10.1016/j.cviu.2026.104670
- Occ3D NeurIPS 2023 paper page: https://papers.nips.cc/paper_files/paper/2023/hash/cabfaeecaae7d6540ee797a66f0130b0-Abstract-Datasets_and_Benchmarks.html
- Occ3D project page: https://tsinghua-mars-lab.github.io/Occ3D/
- Occ3D repository: https://github.com/Tsinghua-MARS-Lab/Occ3D
