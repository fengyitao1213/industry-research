# SparseBEV

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["perception", "road-av", "validation"]
  reason: "SparseBEV is rated for efficient sparse-query multi-camera 3D detection where dense BEV memory is costly."
method-priority:end -->

## What It Is

- SparseBEV is a multi-camera 3D object detection method for autonomous-driving video.
- It keeps the detector sparse instead of first building a dense BEV feature map.
- Candidate objects are represented by sparse queries that adapt in BEV space and image space.
- The method is part of the camera-only BEV detection family, but it targets boxes rather than dense occupancy or freespace.
- Its deployment question is whether sparse object queries can recover dense-BEV accuracy with lower memory and latency.

## Core Technical Idea

- SparseBEV argues that sparse detectors need adaptability in both BEV and image space to close the gap with dense BEV detectors.
- Scale-adaptive self-attention lets object queries aggregate features with different receptive-field scales in BEV space.
- Adaptive spatio-temporal sampling generates image sampling locations under query guidance instead of using a fixed local projection.
- Adaptive mixing decodes sampled multi-view and temporal features with dynamic weights produced from the queries.
- The detector therefore spends most computation on object-relevant samples rather than on every cell of a dense BEV grid.

## Inputs and Outputs

- Input: synchronized multi-view camera images or video sweeps.
- Required metadata: camera intrinsics, camera-to-ego extrinsics, image augmentations, timestamps, and ego-motion alignment.
- Training labels: 3D boxes, class labels, orientation, dimensions, velocity, and nuScenes-style detection metadata.
- Output: 3D bounding boxes with class scores, centers, dimensions, orientation, and velocity.
- Non-goals: dense semantic occupancy, freespace proof, open-vocabulary classes, and point-level segmentation are not native outputs.

## Architecture or Pipeline

- Image backbone and neck extract multi-scale image features from each camera.
- Sparse object queries represent candidate objects in BEV-aligned 3D space.
- Scale-adaptive self-attention lets each query attend with an adaptive BEV receptive field.
- Adaptive spatio-temporal sampling chooses multi-view and temporal image locations conditioned on each query.
- Adaptive mixing fuses the sampled features with query-dependent weights.
- Detection heads iteratively refine class scores and 3D boxes.
- The official implementation includes pretrained weights, visualization scripts, and both CUDA and native PyTorch sparse-sampling paths.

## Training and Evaluation

- Primary benchmark: nuScenes 3D object detection.
- The ICCV 2023 paper reports 67.5 NDS on the nuScenes test split.
- It also reports 55.8 NDS on the validation split while maintaining 23.5 FPS under the paper's reported configuration.
- The official repository reports model-zoo variants with different backbones, resolutions, training costs, and validation/test NDS values.
- Fair comparison must match backbone pretraining, image resolution, query count, number of temporal frames, precision mode, and runtime implementation.
- For AV release triage, split evaluation by small object, long-range, occlusion, calibration perturbation, camera dropout, and path-corridor false-negative cases.

## Strengths

- Avoids the memory cost of dense BEV feature construction.
- Computation scales more directly with query count and sampled features than with BEV grid area.
- Temporal sampling is built into the sparse detector design.
- The reported nuScenes results make it a strong reference point for efficient camera-only 3D detection.
- It is easier to combine with object-centric tracking and prediction than dense-only BEV features.
- The official repository and model zoo make reproduction more concrete than paper-only sparse-query methods.

## Failure Modes

- Sparse query budgets can miss small, low-contrast, rare, or oddly shaped objects.
- Camera-only geometry remains underconstrained at long range, under occlusion, and in low texture.
- Projection and temporal sampling are sensitive to calibration, timestamp, ego-motion, and augmentation bookkeeping errors.
- Object boxes do not prove freespace or arbitrary obstacle absence.
- Road-domain taxonomies can underrepresent cones, chocks, hoses, tow bars, luggage, ground equipment, debris, and overhanging hazards.
- Runtime claims may not transfer across hardware, image resolution, compiler backend, and custom CUDA availability.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV | Strong research fit | SparseBEV is evaluated on nuScenes and directly targets road-scale multi-camera 3D detection. |
| Airside | Conditional | Useful for vehicle-like GSE, buses, tugs, and personnel, but needs apron labels, aircraft-proximity objects, glare/night/weather tests, and a dense safety layer for FOD and clearance. |
| Warehouse / logistics yard / port | Conditional | Sparse camera detection can transfer to vehicle and pedestrian actors if camera geometry and object priors are retrained for the site. |
| Mining / construction / agriculture | Weak to conditional | Dust, vibration, terrain, unusual machinery, and non-road layouts require validation beyond nuScenes-style evidence. |
| Delivery robot / outdoor campus | Conditional | Smaller rigs and close-range hazards may need different query priors and stronger near-field freespace checks. |

## Implementation Notes

- Treat camera calibration, timestamps, augmentation transforms, and ego-motion as part of the model contract.
- Keep query count, image resolution, and temporal history explicit in benchmark reports.
- Validate the native PyTorch fallback if custom CUDA sparse sampling is hard to deploy.
- Stress test false negatives for thin, low, non-boxy, and partially visible obstacles.
- Do not use SparseBEV as a standalone safety layer for path clearance; feed it into tracking, fusion, and occupancy/freespace checks.
- Compare against dense BEV baselines such as BEVDet, BEVDepth, BEVFormer-family methods, and SOLOFusion under matched runtime constraints.

## Local Cross-Links

- Sparse-query family overview: [Sparse Query Camera 3D Detection](../overview/sparse-query-camera-3d-detection.md).
- Related sparse methods: [DETR4D](detr4d.md), [Sparse4D](sparse4d.md), [ForeSight](foresight.md).
- Camera BEV baselines: [BEVDet](bevdet.md), [BEVDepth](bevdepth.md), [BEVStereo](bevstereo.md), [SOLOFusion](solo-fusion.md).
- Planning-facing contrast: [Dynamic Occupancy Freespace](dynamic-occupancy-freespace.md), [SparseOcc](sparseocc.md), [FlashOcc](flashocc.md).

## Sources

- SparseBEV arXiv paper: https://arxiv.org/abs/2308.09244
- SparseBEV CVF paper PDF: https://openaccess.thecvf.com/content/ICCV2023/papers/Liu_SparseBEV_High-Performance_Sparse_3D_Object_Detection_from_Multi-Camera_Videos_ICCV_2023_paper.pdf
- SparseBEV official repository: https://github.com/MCG-NJU/SparseBEV
- nuScenes detection benchmark: https://www.nuscenes.org/object-detection
