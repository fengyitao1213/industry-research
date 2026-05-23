# DETR4D

<!-- method-priority:start
priority:
  learning: 4
  deployment: 3
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["perception", "road-av", "validation"]
  reason: "DETR4D is rated as a foundational sparse-query camera 3D detection baseline for temporal multi-view perception."
method-priority:end -->

## What It Is

- DETR4D is a transformer-based multi-view camera 3D object detector for autonomous driving.
- It extends sparse DETR-style object queries into temporal surround-view 3D detection.
- The method directly queries image features from 3D object hypotheses instead of constructing a dense BEV feature map.
- It is a box detector, not a dense occupancy, freespace, segmentation, or open-vocabulary method.
- It is most useful as a baseline for understanding projective sparse attention and temporal query/image fusion.

## Core Technical Idea

- DETR4D uses projective cross-attention for query-image interaction.
- Instead of sampling only projected object centers, it predicts 3D sampling offsets around each object query and projects those samples into camera views.
- Heatmap-based query initialization bridges 2D image features and 3D object locations by creating objectness priors in BEV space.
- Hybrid temporal modeling fuses both past object queries and past image features through a memory bank.
- This keeps the detector in the sparse-query family while adding more geometric context and temporal evidence than single-frame DETR3D-style sampling.

## Inputs and Outputs

- Input: synchronized surround-view camera images.
- Required metadata: camera intrinsics, extrinsics, ego-motion transforms, timestamps, and image augmentation records.
- Optional runtime state: cached past object queries and image features.
- Training labels: nuScenes-style 3D boxes, classes, velocity, and orientation.
- Output: 3D object boxes with class probabilities, centers, dimensions, orientation, and velocity.
- Non-goals: dense BEV occupancy, freespace confidence, track IDs, and semantic map layers are outside the native output contract.

## Architecture or Pipeline

- Image backbone extracts features for each camera view.
- A lightweight BEV heatmap generation step estimates objectness and initializes object queries.
- Transformer decoder layers update object queries through sparse projective cross-attention into image features.
- Projective cross-attention predicts 3D sampling locations before projecting them into images, giving each query a richer geometric support region.
- A temporal memory bank stores past object queries and image features.
- Query aggregation and cross-frame feature aggregation fuse temporal information with low additional computation.
- Detection heads refine the final 3D boxes and classes after transformer updates.

## Training and Evaluation

- Primary benchmark: nuScenes 3D object detection.
- The arXiv paper reports validation and test comparisons against FCOS3D, PGD, PETR, BEVFormer, DETR3D, and PolarDETR variants.
- Under the paper's setup, DETR4D reports 0.509 validation NDS and 0.422 validation mAP for the main multi-frame model.
- The same paper reports 0.530 test NDS and 0.452 test mAP for the main DETR4D model.
- Fair comparison must match backbone, pretraining, number of frames, memory-bank policy, image resolution, and online versus offline assumptions.
- Deployment evaluation should include camera dropout, calibration perturbation, long-range depth error, cross-view object truncation, low light, glare, rain/fog, and timestamp skew.

## Strengths

- The sparse projective attention design is easier to reason about than opaque dense BEV fusion blocks.
- Query initialization with a BEV objectness heatmap reduces reliance on purely random query starts.
- Hybrid temporal fusion uses both object-level and image-feature evidence.
- The method gives a useful bridge from DETR3D-style query projection toward later sparse-query detectors.
- It can be cheaper than dense BEV encoders when query count and sampling budgets are controlled.
- The object-centric design aligns naturally with downstream tracking and prediction interfaces.

## Failure Modes

- Sparse queries can still miss low, thin, rare, or non-box-like hazards.
- Camera-only depth ambiguity remains a primary risk for long-range and partially occluded objects.
- Projective attention can fail silently when calibration, ego-motion, or image augmentation transforms are wrong.
- Temporal memory can reinforce stale false positives or preserve missed-object bias after occlusion.
- The method does not provide dense path-clearance evidence.
- Road-trained classes and dimensions may not cover airside, yard, port, construction, or agricultural equipment without retraining.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV | Strong research fit | DETR4D is built and evaluated for nuScenes-style surround-view road driving. |
| Airside | Conditional | The projective sparse-query pattern can detect vehicle-like GSE and people, but needs new classes, apron geometry tests, and separate occupancy/FOD safety evidence. |
| Warehouse / logistics yard / port | Conditional | Useful for actor detection when cameras cover the site, but class priors, object sizes, and occlusion patterns differ from road driving. |
| Mining / construction / agriculture | Weak to conditional | Dust, terrain, vibration, and unusual machines make direct transfer uncertain. |
| Delivery robot / outdoor campus | Conditional | Sparse queries can be useful for actors, but close-range small-object safety needs denser sensing or occupancy. |

## Implementation Notes

- Validate camera projection math with synthetic perturbations before trusting benchmark metrics.
- Keep memory-bank reset rules explicit for dropped frames, localization jumps, camera faults, and scene changes.
- Track false-negative rates by range, object size, truncation, and cross-view visibility.
- Use DETR4D as a detector component in a fused perception stack rather than a standalone planner safety signal.
- Compare against DETR3D, BEVFormer, SparseBEV, Sparse4D, and dense BEV baselines under matched image resolution and temporal windows.
- Add domain-specific class priors before transferring from nuScenes to airside, yard, port, construction, mining, agriculture, campus, or delivery-robot ODDs.

## Local Cross-Links

- Sparse-query family overview: [Sparse Query Camera 3D Detection](../overview/sparse-query-camera-3d-detection.md).
- Related sparse methods: [SparseBEV](sparsebev.md), [Sparse4D](sparse4d.md), [ForeSight](foresight.md).
- Dense and depth-aware BEV contrasts: [BEVDet](bevdet.md), [BEVDepth](bevdepth.md), [BEVStereo](bevstereo.md), [SOLOFusion](solo-fusion.md).
- Planning-facing contrast: [Dynamic Occupancy Freespace](dynamic-occupancy-freespace.md), [SparseOcc](sparseocc.md), [SurroundOcc](surroundocc.md).

## Sources

- DETR4D arXiv paper: https://arxiv.org/abs/2212.07849
- nuScenes detection benchmark: https://www.nuscenes.org/object-detection
- DETR3D arXiv paper for lineage context: https://arxiv.org/abs/2110.06922
