# VOGS-CP

<!-- method-priority:start
priority:
  learning: 4
  deployment: 3
  type: "method"
  stage: "frontier"
  maturity: "prototype"
  tags: ["perception", "road-av", "validation"]
  reason: "VOGS-CP is rated for collaborative Gaussian semantic occupancy because it exchanges sparse 3D semantic Gaussian primitives instead of dense voxel or planar V2X features."
method-priority:end -->

## What It Is

VOGS-CP is an AAAI 2026 vision-only collaborative semantic occupancy method for connected autonomous vehicles.

The full title is "Vision-Only Gaussian Splatting for Collaborative Semantic Occupancy Prediction."

It turns each agent's camera observations into sparse 3D semantic Gaussian primitives, sends aligned Gaussian primitives from collaborators, fuses them in the ego frame, and splats the fused set back into a 3D semantic occupancy grid.

This makes VOGS-CP the current method-level reference for collaborative Gaussian semantic occupancy. It is adjacent to [CoHFF](cohff.md), but CoHFF shares hybrid planar/task features, while VOGS-CP uses explicit 3D Gaussian primitives as the communication representation.

## Core Technical Idea

Collaborative semantic occupancy has two competing requirements:

- It needs 3D geometry and semantics, not only boxes or BEV segmentation.
- It cannot send dense 3D voxel tensors over a V2X link at practical bandwidth.

VOGS-CP uses sparse semantic Gaussians as the middle representation. Each Gaussian carries geometry and semantic information, so collaborators can transmit structured 3D evidence rather than raw images, dense voxels, or compressed planar features.

The important design choices are:

1. **Gaussian communication primitive:** agents share 3D semantic Gaussians rather than dense voxel or BEV feature maps.
2. **Rigid spatial alignment:** neighbor Gaussians are transformed into the ego frame before fusion.
3. **Region-of-interest culling:** only Gaussians relevant to the ego region are transmitted.
4. **Neighborhood-based cross-agent fusion:** local Gaussian neighborhoods are fused to remove duplicates and suppress noisy or inconsistent collaborator predictions.
5. **Gaussian-to-voxel splatting:** the fused primitive set is decoded into a standard semantic occupancy grid for evaluation and downstream use.

## Inputs And Outputs

Inputs:

- Surround-view RGB images for each connected vehicle.
- Camera intrinsics and extrinsics.
- Relative poses or transforms between ego and collaborator agents.
- V2X messages containing sparse semantic Gaussian primitives.
- Semantic occupancy labels during supervised training.
- Communication budget or Gaussian-count settings for bandwidth experiments.

Intermediate outputs:

- Agent-local sparse 3D semantic Gaussian primitives.
- Transformed collaborator Gaussians in the ego frame.
- Fused Gaussian primitives after neighborhood-based cross-agent fusion.

Final outputs:

- Ego-frame 3D semantic occupancy grid.
- BEV semantic segmentation output for downstream evaluation.
- Communication-volume measurements under Gaussian-pruning settings.

VOGS-CP is not a 3D object detector, tracker, raw V2X protocol, trust layer, or map-reconstruction method. Its primary output is collaborative semantic occupancy.

## Architecture Or Pipeline

The VOGS-CP pipeline follows a Gaussian-native collaborative occupancy flow:

1. Extract multi-scale visual features from each agent's surround cameras.
2. Use an image-to-Gaussian module to refine an initial Gaussian set into scene-aligned semantic primitives.
3. Transform neighbor-agent Gaussians into the ego coordinate frame using relative pose metadata.
4. Cull transmitted Gaussians to the ego region of interest.
5. Fuse ego and collaborator Gaussian sets with a neighborhood-based cross-agent fusion module.
6. Convert fused Gaussians into semantic occupancy through Gaussian-to-voxel splatting.
7. Evaluate the resulting occupancy grid with IoU and mIoU, and optionally evaluate BEV semantic segmentation.

The public repository is built on an OpenCOOD-style workflow and includes dataset preparation for OPV2V / Semantic-OPV2V, environment setup, single-agent training, collaborative training, and collaborative occupancy inference commands.

## Training And Evaluation

The AAAI paper evaluates VOGS-CP on collaborative semantic occupancy prediction and compares it against single-agent and collaborative baselines.

Reported paper/project claims include:

- +8.42 mIoU over single-agent perception.
- +3.28 mIoU over baseline collaborative methods.
- +5.11 IoU and +22.41 IoU improvements in the reported comparison settings.
- A reduced-transmission setting that still reports +1.9 mIoU improvement while using 34.6% communication volume.

Treat these as paper claims until reproduced with the target backbone, camera resolution, V2X middleware, network delay, packet loss, pose covariance, and domain-specific class taxonomy.

## Strengths

- Moves collaborative perception beyond boxes and BEV feature fusion into 3D semantic occupancy.
- Uses explicit 3D Gaussian primitives, which are easier to align and inspect than opaque planar feature tensors.
- Avoids sending full dense voxel features.
- Keeps the final output compatible with planner-facing occupancy grids.
- Directly complements GaussianFormer-style single-agent semantic Gaussians by using Gaussians as the exchanged collaborative message.
- Public paper, project page, AAAI proceedings record, and repository make the method reviewable.

## Failure Modes

- Vision-only depth ambiguity can misplace Gaussians under glare, poor texture, night lighting, weather, or camera calibration drift.
- Relative pose or timestamp error can make collaborator Gaussians appear confidently wrong in the ego frame.
- Region-of-interest culling can drop useful evidence before fusion.
- Sparse Gaussian budgets can miss small, rare, or thin hazards such as debris, cones, cables, chocks, or worker tools.
- Neighborhood fusion can suppress true but uncommon evidence if collaborators disagree for legitimate viewpoint reasons.
- Semantic-OPV2V-style road simulation does not prove transfer to real roads, airports, ports, yards, mines, construction sites, or warehouses.
- VOGS-CP does not solve authentication, malicious collaborator filtering, stale-message rejection, or packet-loss handling by itself.

## AV Relevance

VOGS-CP is relevant when cooperative perception needs a structured 3D occupancy message rather than only detections or BEV features.

It is especially useful for:

- Occlusion-heavy V2V scenes where another vehicle sees behind a bus, trailer, building corner, aircraft, container stack, or large machine.
- Bandwidth-limited collaboration where dense voxel sharing is infeasible.
- Research systems comparing collaborative occupancy against [CoHFF](cohff.md), [QuantV2X](quantv2x.md), [SparseCoop](sparsecoop.md), and [V2X-ReaLO](v2x-realo.md).
- Gaussian occupancy stacks that already use [GaussianFormer](gaussianformer.md), [GaussianOcc](gaussianocc.md), [GaussianFlowOcc](gaussianflowocc.md), or [GaussTR](gausstr.md) as single-agent references.

For production autonomy, VOGS-CP should be treated as an advisory collaborative perception layer. Safety-critical occupancy still needs ego-sensor confirmation, freshness checks, sender identity, pose uncertainty, and fallback behavior when V2X is unavailable.

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV | Strong research fit | The method is built for connected-vehicle collaborative semantic occupancy and has AAAI 2026 / arXiv / code artifacts. |
| Airside | Conditional | Useful for apron occlusions around aircraft, buses, tugs, belt loaders, and service vehicles, but needs airside classes, real logs, and low-speed safety gates. |
| Warehouse / yard / port | Conditional | Sparse collaborative occupancy could help around racks, trailers, containers, and blind intersections, but camera placement, lighting, and non-road actors need new data. |
| Mining / construction | Watch | Large occluders and limited bandwidth are relevant, but dust, terrain, and heavy-equipment geometry are outside the published evidence. |
| Agriculture | Weak to conditional | Sparse cooperative occupancy may help convoys or shared-field perception, but crop rows, dust, and seasonal visual appearance require separate validation. |
| Delivery robots / campus | Conditional | Useful where multiple robots share indoor/outdoor perception, but small-object recall and privacy constraints become central. |

## Implementation Notes

- Reproduce the official Semantic-OPV2V setup before changing sensor layouts, class taxonomies, Gaussian counts, or occupancy ranges.
- Log every accepted collaborator message with sender ID, timestamp, pose covariance, Gaussian count, region-of-interest bounds, and fusion weight.
- Evaluate ego-only, naive Gaussian fusion, neighborhood fusion, CoHFF-style planar feature fusion, and late-fusion object outputs on the same scenario slices.
- Add latency, packet-drop, stale-message, and pose-noise replay before claiming deployability.
- For non-road domains, define semantic classes before training; otherwise rare obstacles can be forced into road-scene labels.
- Pair with [RCP-Bench Cooperative Corruption Robustness](../datasets-benchmarks/rcp-bench-cooperative-corruption-robustness.md) and [V2X Large-Range Sequential Datasets](../datasets-benchmarks/v2x-large-range-sequential-datasets.md) style robustness checks.

## Related Pages

- [CoHFF](cohff.md)
- [GaussianFormer](gaussianformer.md)
- [GaussianOcc](gaussianocc.md)
- [GaussianFlowOcc](gaussianflowocc.md)
- [GaussTR](gausstr.md)
- [QuantV2X](quantv2x.md)
- [SparseCoop](sparsecoop.md)
- [V2X-ReaLO](v2x-realo.md)
- [Infrastructure Cooperative Perception](../overview/infrastructure-cooperative-perception.md)
- [Collaborative Fleet Perception](../overview/collaborative-fleet-perception.md)
- [3D Gaussian Splatting for Driving](../overview/gaussian-splatting-driving.md)

## Sources

- AAAI proceedings page: https://ojs.aaai.org/index.php/AAAI/article/view/37269
- AAAI paper PDF: https://ojs.aaai.org/index.php/AAAI/article/view/37269/41231
- arXiv record: https://arxiv.org/abs/2508.10936
- Official project page: https://chengchen2020.github.io/VOGS-CP/
- Official repository: https://github.com/ChengChen2020/VOGS-CP
- DOI: https://doi.org/10.1609/aaai.v40i4.37269
