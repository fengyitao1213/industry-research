# Cylinder3D

<!-- method-priority:start
priority:
  learning: 4
  deployment: 4
  type: "method"
  stage: "classic-baseline"
  maturity: "prototype"
  tags: ["perception", "lidar", "segmentation", "road-av"]
  reason: "Cylinder3D is the cylindrical sparse-voxel baseline for single-scan spinning-LiDAR semantic segmentation."
method-priority:end -->

## What It Is

- Cylinder3D is a 3D segmentation network for **driving-scene LiDAR**, introduced in "Cylindrical and Asymmetrical 3D Convolution Networks for LiDAR Segmentation" (CVPR 2021).
- It is designed specifically for single-scan, ego-centric point clouds from spinning automotive LiDAR.
- Its defining choice is the **cylindrical partition** — voxelizing in radius/azimuth/height instead of a uniform Cartesian grid.
- It pairs that partition with **asymmetrical 3D convolutions** tuned to the shapes of driving-scene objects.
- It was a leading single-scan LiDAR-segmentation baseline on SemanticKITTI and nuScenes, and has a panoptic variant.

## Core Technical Idea

- A spinning LiDAR produces point clouds whose density falls sharply with range — points are dense near the sensor and sparse far away.
- A uniform Cartesian voxel grid is therefore badly matched: near voxels are crowded, far voxels nearly empty, wasting capacity and resolution.
- Cylinder3D voxelizes in **cylindrical coordinates** (radius, azimuth, height); cylindrical cells grow with range, so the number of points per cell is far more balanced across the scene.
- It then applies **asymmetrical residual blocks** — convolution kernels elongated to match the dominant orientations of cars, pedestrians, and other objects — to use the kernel budget where object structure actually lies.
- A **dimension-decomposition context modeling** module aggregates global context cheaply by decomposing it along the three axes.
- The thesis: align the discretization and the convolution with the physics of the sensor and the geometry of the scene.

## Inputs and Outputs

- Inputs: a single LiDAR scan as `(x, y, z, intensity)`, converted to cylindrical voxels.
- It assumes an ego-centric scan with a single sensor origin — the cylindrical partition is defined relative to that origin.
- Output: per-point/per-voxel semantic labels; the panoptic variant adds instances.
- It is a complete segmentation network built on sparse 3D convolution.

## Architecture

- A cylindrical-voxel sparse-convolution U-Net.
- An input MLP encodes per-point features, which are scattered into cylindrical voxels.
- Asymmetrical residual blocks form the encoder-decoder, with the dimension-decomposition context module aggregating long-range context.
- A per-voxel head predicts class logits, propagated back to points.
- Built on sparse convolution, so it inherits the efficiency of that operator family.
- The reference implementation covers SemanticKITTI and nuScenes lidarseg, plus a panoptic configuration.

## Training and Evaluation

- Cylinder3D was state-of-the-art for single-scan LiDAR segmentation on SemanticKITTI when published and remained a strong nuScenes lidarseg baseline.
- It is trained with cross-entropy and/or Lovász-softmax loss plus standard LiDAR augmentation.
- Evaluation uses per-class IoU and mIoU; the panoptic variant uses Panoptic Quality.
- Its accuracy advantage is most visible in the **far range**, where the cylindrical partition keeps cells populated.

## Strengths

- The cylindrical partition matches spinning-LiDAR density, improving far-range and overall single-scan accuracy.
- Asymmetrical convolutions spend kernel capacity on the geometry that matters for driving objects.
- Efficient — built on sparse convolution.
- A well-known, well-reproduced single-scan baseline with a panoptic extension.
- Strong fit for the real-time on-vehicle segmentation task.

## Failure Modes

- The cylindrical partition is defined around a **single sensor origin** — it does not match an aggregated map built from many viewpoints, where there is no single origin.
- For map-scale or multi-viewpoint clouds, a Cartesian sparse-conv backbone (MinkowskiNet-style) is the more natural choice.
- Azimuthal cells become very wide at long range — far-range thin structures can still be merged.
- Tuned to automotive spinning-LiDAR geometry; solid-state or non-spinning sensors weaken the assumption.
- Voxelization caps thin-class resolution, as in any voxel method.
- Accuracy now trails the latest transformer backbones.

## Domain Fit

| Domain | Fit | Note |
|---|---|---|
| Road AV (on-vehicle) | strong | Designed for exactly this — single-scan spinning-LiDAR segmentation in a real-time budget. |
| Road AV (offline / maps) | weak | The cylindrical, ego-centric partition does not fit aggregated multi-viewpoint maps; use a Cartesian backbone there. |
| Airside (single-scan) | conditional | No airside checkpoints exist; a reasonable on-vehicle single-scan baseline once trained on airside data. |
| Airside (aggregated map) | weak | The wrong partition for accumulated maps — see `../overview/aggregated-map-semantic-segmentation.md` §7.2. |
| Warehouse / port / mining / construction / agriculture | conditional | Fits where a single spinning LiDAR scans ego-centrically; weak for fused or surveyed clouds. |

## Implementation Notes

- Use Cylinder3D for the **single-scan, on-vehicle** segmentation task, not for aggregated-map segmentation — the partition assumption is the deciding factor.
- For an aggregated map, prefer a Cartesian sparse-conv, point, transformer, or superpoint backbone.
- Keep intensity calibrated — the network leans on it for appearance-defined classes.
- Use Lovász-softmax loss to optimize IoU directly and help rare classes.
- The panoptic variant is the route to instance outputs (vehicles, pedestrians) when needed.
- Validate far-range behavior explicitly; azimuthal cell width is where the partition's benefit and its limits both show.

## Sources

- Cylinder3D paper: https://arxiv.org/abs/2011.10033
- Reference implementation: https://github.com/xinge008/Cylinder3D
- Related repository page: `../overview/lidar-semantic-segmentation.md` — single-scan on-vehicle segmentation
- Related repository page: `../overview/aggregated-map-semantic-segmentation.md` — offline aggregated-map segmentation pipeline (§7.2 on why Cylinder3D is less natural for maps; §7.8 for the head-to-head model-family comparison)
