# SparseBEV

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method-family"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["perception", "road-av"]
  reason: "Reference fully-sparse camera 3D detector that closes the accuracy gap with dense BEV at lower compute."
method-priority:end -->

## What It Is

- SparseBEV is a fully sparse, query-based multi-view camera 3D object detector for surround-view rigs.
- It avoids constructing a dense BEV feature tensor and instead refines a small set of 3D object queries directly from multi-view image features.
- Published at ICCV 2023 by Liu et al., it was the first fully sparse camera 3D detector to outperform its dense BEV counterparts on nuScenes while preserving real-time speed.
- The paper argues that the prior accuracy gap between sparse and dense BEV detectors comes from limited adaptability of sparse queries, not from the sparse representation itself.

## Core Technical Idea

- Represent the scene as a fixed set of sparse 3D queries with learnable 3D anchors.
- Use scale-adaptive self-attention so each query aggregates BEV context with a receptive field tuned to the object scale it tracks.
- Drive sampling location prediction from the queries themselves with adaptive spatio-temporal sampling across views, scales, and frames.
- Mix sampled features with adaptive weights generated per query, so each query decodes its own evidence rather than sharing static decoder weights.
- Refine queries iteratively through a stack of decoder layers and emit 3D boxes directly, without an explicit BEV feature map.

## Inputs and Outputs

- Input: multi-view surround camera images, camera intrinsics and extrinsics, ego pose, and frame timestamps.
- Input across frames: a short temporal window of past frames warped into the current ego frame.
- Training input: 3D bounding boxes, classes, velocities, and attribute labels in the nuScenes-style 10-class setting.
- Output: 3D bounding boxes with class probability, location, dimension, orientation, and velocity.
- Output does not include dense BEV features, occupancy, or semantic map layers by default.

## Architecture or Pipeline

- Image backbone such as ResNet-50, ResNet-101, or V2-99 produces multi-scale features for each camera.
- A small set of object queries with explicit 3D anchor parameters enters a transformer decoder.
- Scale-adaptive self-attention modulates attention range per query based on predicted object scale.
- Adaptive spatio-temporal sampling samples a set of 3D points around each query, projects them into multi-view, multi-scale, and multi-timestamp image features, and aggregates the sampled vectors.
- Adaptive mixing combines the sampled features using weights produced from the query itself.
- Decoder layers iteratively refine the query and 3D anchor and emit detection outputs after the final layer.

## Training and Evaluation

- Main benchmark: nuScenes 3D object detection on the validation and test splits.
- Reported metrics: NDS, mAP, mATE, mASE, mAOE, mAVE, and mAAE.
- Validation: 55.8 NDS with ResNet-50 at 256x704 input while running at 23.5 FPS, according to the paper.
- Test: 67.5 NDS with a V2-99 backbone and larger input, setting state of the art among camera-only detectors at submission time.
- Ablations isolate the contribution of scale-adaptive attention, adaptive sampling, and adaptive mixing, and show that all three are needed to close the gap with dense BEV detectors.
- Comparisons against dense baselines such as BEVFormer and BEVDet require matching backbone, pretraining, image resolution, and temporal window.

## Strengths

- Fully sparse computation scales with the number of queries rather than the area of a BEV grid, which helps on embedded compute.
- Adaptive sampling lets the same architecture handle small and large objects without separate heads or anchor scales.
- Real-time inference with a ResNet-50 backbone makes it a credible camera-only baseline for production-style stacks.
- Pure camera input avoids LiDAR cost and calibration burden where LiDAR is not available.
- Provides a clean foundation for sparse temporal and end-to-end extensions, including Sparse4D and SparseDrive-style designs.

## Failure Modes

- Camera-only depth remains underconstrained at long range, in low light, and under heavy weather.
- A fixed query budget can miss small, dense, or rare object classes that fall outside training priors.
- Adaptive sampling depends on accurate camera calibration and ego-pose alignment; calibration drift or stale extrinsics degrade silently.
- The method does not emit freespace or occupancy, so it cannot by itself prove absence of obstacles.
- Reported headline numbers depend on temporal window, image resolution, and backbone pretraining; deployment variants can underperform leaderboard variants substantially.

## Domain Fit

- Road AV: strong fit as a camera-only 3D detector for vehicles, pedestrians, and cyclists at typical driving ranges.
- Airside: useful for vehicle-like apron traffic such as tugs, buses, and baggage tractors; weak as a sole perception layer near aircraft because it lacks dense clearance evidence and does not natively handle irregular GSE shapes.
- Warehouse, yard, port, mining, construction, agriculture: usable where surround cameras dominate and object classes can be re-trained; pair with range sensors when small obstacles or low-clearance equipment must be detected.
- Delivery robot and campus: relevant as a camera-only object detector when LiDAR is not affordable, but reduced range and depth ambiguity may force lower operating speeds.

## Implementation Notes

- Tune the query budget, anchor priors, and class set to the deployment domain rather than reusing nuScenes defaults.
- Validate camera calibration and image augmentation bookkeeping carefully; adaptive sampling failures from projection errors can be silent.
- Measure runtime on the target compute with the actual temporal window and resolution, not only on the reference 256x704 setting.
- Track recall on small or partially visible objects separately from mAP; sparse detectors can hide systematic misses inside aggregate metrics.
- Combine with LiDAR or radar occupancy where the safety case requires evidence of free space, not just detected objects.
- Verify the official deformable-style aggregation kernel in the deployment runtime, including ONNX or TensorRT exports.

## Sources

- SparseBEV paper: https://arxiv.org/abs/2308.09244
- Official SparseBEV repository: https://github.com/MCG-NJU/SparseBEV
- nuScenes 3D detection benchmark: https://www.nuscenes.org/object-detection
