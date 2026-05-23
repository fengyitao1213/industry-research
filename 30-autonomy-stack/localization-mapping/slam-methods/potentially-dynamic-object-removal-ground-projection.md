# Potentially Dynamic Object Removal by Ground Projection

<!-- method-priority:start
priority:
  learning: 4
  deployment: 5
  type: "method"
  stage: "deployment-pattern"
  maturity: "prototype"
  tags: ["slam", "mapping", "perception", "validation", "outdoor"]
  reason: "Potentially Dynamic Object Removal by Ground Projection is rated for static-map construction workflows that remove parked or movable-class objects before map publication."
method-priority:end -->

Related docs: [Potentially Dynamic Object Map Policy](../maps/potentially-dynamic-object-map-policy.md) · [Static-But-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md) · [LiDAR Map Cleaning and Dynamic Removal](lidar-map-cleaning-dynamic-removal.md) · [ERASOR](erasor.md) · [Removert](removert.md) · [Raymoval](raymoval.md) · [FreeDOM](freedom-dynamic-object-removal.md) · [MapCleaner](mapcleaner.md) · [BeautyMap](beautymap.md) · [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) · [Map Construction Pipeline](../maps/map-construction-pipeline.md)

**Last updated:** 2026-05-23

---

## What It Is

"No More Potentially Dynamic Objects" (Woo, Jung, Kim, arXiv 2407.01073) is a static point-cloud map generation pipeline that removes not only currently moving objects but also objects that are stationary during mapping yet belong to a movable class. The method uses LiDAR 3D object detection to find potentially dynamic objects, ground segmentation to recover traversable surface context, and ground projection to replace object points with ground points before stacking the map.

The paper targets the common failure of geometry-only map cleaners: a parked vehicle, staged cart, or stationary person can remain still for the entire survey and therefore never creates the free-space contradiction that ERASOR, Removert, MapCleaner, FreeDOM, DUFOMap, or STATIC-LIO need. A detector can still identify the object class and route the points away from the permanent map.

## Core Pipeline

```text
LiDAR frames
  -> 3D object detector
  -> movable-class boxes
  -> ground segmentation
  -> object-point projection to ground
  -> SLAM / mapping on projected frames
  -> static point-cloud map + rejected-object evidence
```

The public implementation describes a concrete road-AV stack:

- KITTI-format LiDAR input.
- VoxelNeXt as the 3D object detector.
- Patchwork++ for ground segmentation.
- Ground-projection scripts for detected object regions.
- SC-A-LOAM for mapping projected point clouds.

Those implementation choices are not the only possible stack. In an AV or non-road urban deployment, the detector could be CenterPoint, TransFusion, PV-RCNN, OpenPCDet, a camera-LiDAR detector, or a domain-specific apron/yard detector. The architectural contract is the important part: movable-class object geometry is withheld from the permanent map before accumulation, and the ground continuity beneath it is reconstructed conservatively.

## Why It Is Different from Classical Dynamic Removal

| Method family | Evidence type | Handles moving residuals? | Handles parked-but-movable objects? |
|---|---|---:|---:|
| ERASOR / ERASOR++ | Pseudo-occupancy drop and ground restoration | Yes | No, unless the object later leaves during the observation window. |
| [Removert](removert.md) / [Raymoval](raymoval.md) | Range-image ray contradiction | Yes | No, unless free-space contradiction appears. |
| FreeDOM / DUFOMap | Conservative free-space or void evidence | Yes | No, if the object is never observed absent. |
| MapCleaner / [BeautyMap](beautymap.md) | Terrain, observation voting, or binary matrix comparison | Yes | Limited; stationary movable objects can vote as static. |
| Detector + ground projection | Semantic object class plus local ground model | Yes, if detector sees the class | Yes, for classes covered by detector/taxonomy. |
| Lifelong map version control | Multi-session positive/negative changes | Yes after multiple passes | Yes after multi-session evidence or policy quarantine. |

Detector-ground-projection methods are therefore best seen as the single-survey semantic branch of static-but-transient removal. They are complementary to multi-session methods: the detector quarantines movable-class objects before the second survey exists, while lifelong version control confirms or rejects changes across time.

## Inputs and Outputs

| Interface | Required fields | Notes |
|---|---|---|
| LiDAR frames | Raw point clouds, timestamps, calibration, ego poses or SLAM front-end input | Works before or during accumulation. |
| Object detections | 3D boxes, class, confidence, detector version, class taxonomy | Class policy determines which boxes are removable. |
| Ground segmentation | Ground/non-ground mask, plane or patch model, quality flags | Needed to avoid holes after object removal. |
| Projection output | Modified frame with object points projected to estimated ground | Should be tagged as synthetic/conditioned geometry. |
| Rejected evidence | Original object points, boxes, classes, confidence, frame IDs | Required for audit, FOD review, and false-deletion debugging. |
| Static map | Accumulated map from projected frames | Input to localization, semantic segmentation, or annotation. |

## Ground-Projection Contract

Removing a parked object from a mapping scan creates two risks:

1. The object footprint can become a hole or false obstacle in the ground surface.
2. Projecting the object points to ground can create false evidence that the space is currently clear.

The safe contract is:

- Projection fills map geometry only for the **static-map product**.
- The projected ground is not treated as live free-space evidence.
- Original object points remain available in a rejected-object layer.
- The map manifest records the detector class, confidence, box geometry, ground model, and projection method.
- FOD-like small objects and unknown objects are routed to review instead of being projected away.

This is especially important for airside and industrial yards. A chock, tool, cone, cable, or dropped debris item might be small and removable, but it is also safety-relevant. It should not be erased by a generic movable-object cleaner.

## Class Policy

| Class family | Default action in static-map build | Reason |
|---|---|---|
| Cars, vans, trucks, buses | Exclude or project ground under footprint | Movable road objects are poor static anchors. |
| Pedestrians, cyclists, workers | Exclude; do not create permanent geometry | Safety actor and not map structure. |
| Aircraft and large GSE | Exclude from permanent layer; keep current-occupancy layer | Can remain stationary for hours but should not anchor long-term maps. |
| Cones, barriers, temporary signs | Quarantine unless work-order policy says otherwise | May be temporary restriction, not permanent infrastructure. |
| Chocks, tools, debris, FOD | Review/hazard layer; do not silently project away | Small hazards must remain actionable. |
| Fixed poles, walls, curbs, buildings | Preserve | Permanent localization structure. |
| Vegetation | Policy dependent | Trees can be long-lived; branches/leaves can change seasonally. |
| Unknown object | Quarantine or review | Unknown does not mean safe to erase. |

## Failure Modes

| Failure mode | Effect | Mitigation |
|---|---|---|
| Detector false negative | Parked/movable object remains in the permanent map | Use multi-session differencing, semantic segmentation, and targeted domain classes. |
| Detector false positive | Fixed infrastructure is removed or projected to ground | Require class-specific geometry checks and static-feature preservation tests. |
| Box leakage | Parts of the object remain outside the detection box | Dilate boxes cautiously, cluster residuals, and inspect rejected evidence. |
| Ground segmentation error | Projection creates ramps, holes, or false surfaces | Use ground-quality flags, multi-frame smoothing, and no-publish thresholds for weak ground models. |
| Taxonomy mismatch | Road classes miss GSE, aircraft, cones, chocks, pallets, carts | Train domain classes and version the class policy with the map manifest. |
| False-free-space interpretation | Planner assumes a live obstruction is absent | Keep projected geometry isolated from runtime occupancy and FOD clearance. |
| Domain shift | KITTI-trained detector underperforms in depots, campuses, aprons, or night/weather | Use domain data, active learning, confidence calibration, and review queues. |
| Localization regression | Removing large parked objects reduces scan-to-map constraints | Run localization A/B tests and preserve enough fixed infrastructure around object footprints. |

## Domain Fit

| Domain | Fit | Required adaptation |
|---|---|---|
| Urban road AV | Strong | Mature vehicle/person detector classes and road-ground priors. |
| Campus or plaza mapping | Conditional | Add classes for benches, kiosks, crowds, bicycles, vendor stalls, and temporary fences. |
| Airport airside | Strong architecture, high taxonomy burden | Add aircraft, belt loaders, tugs, carts, dollies, stairs, cones, chocks, and FOD policy. |
| Logistics yards and ports | Strong | Add trailers, containers, forklifts, pallets, and blocked-lane policy. |
| Warehouse indoor | Conditional | Ground projection may fail under racks, mezzanines, and stacked pallets. |
| Construction/mining | Conditional | Many "objects" are actually changing terrain or valid temporary works; policy review is mandatory. |

## Where It Sits in an End-to-End Semantic Map Pipeline

Detector-ground-projection should run before aggregated-map semantic segmentation:

```text
raw LiDAR/RGB survey
  -> synchronization, calibration, SLAM
  -> dynamic residual cleaning
  -> detector-based movable-class quarantine/projection
  -> static candidate map
  -> semantic segmentation and label refinement
  -> publication gate with rejected-object evidence
```

The segmentation model then sees a cleaner static candidate map, while the publication gate still has access to the original rejected objects. This avoids a common failure where a segmentation model learns parked cars, staged GSE, or stationary people as permanent map structure.

## Implementation Notes

1. Treat the detector as a policy input, not an oracle. A class and confidence should route points to permanent, transient-candidate, FOD/hazard, or reviewer states.
2. Keep original object points in object-space and map-space coordinates. Reviewers need to see what was removed and where it came from.
3. Log detector model version, training domain, class set, and calibration state. A taxonomy change can invalidate old map-cleaning behavior.
4. Separate static-map projection from runtime occupancy. A projected ground patch is useful for map continuity, but it is not proof that the area is clear now.
5. Validate on object footprints and behind-object infrastructure. The cleaner must preserve fixed poles, walls, signs, curb edges, jet-bridge geometry, terminal edges, and other static anchors near parked movable objects.
6. Use multi-session version control as a backstop. Detector-based removal is strongest before the second pass exists; PD/ND lifecycle evidence is stronger after repeated surveys.

## Validation Gates

| Gate | Pass condition |
|---|---|
| Movable-object removal | Movable-class objects are absent from the permanent map or routed to quarantine. |
| Static preservation | Fixed infrastructure near detections is preserved within tolerance. |
| Ground continuity | Object footprints do not create holes, bumps, or false walls in the static candidate map. |
| Hazard retention | FOD-like or unknown objects are retained in review/hazard outputs. |
| Localization regression | Scan-to-map localization error does not worsen after removal. |
| Evidence audit | Every removed/projected cluster can be traced to detector, ground model, and frame IDs. |
| Domain-slice test | Night, rain, glare, sparse returns, dense clutter, and non-road classes have separate metrics. |

## Sources

- Woo, Jung, and Kim, "No More Potentially Dynamic Objects: Static Point Cloud Map Generation based on 3D Object Detection and Ground Projection," arXiv 2407.01073: https://arxiv.org/abs/2407.01073
- Public implementation: https://github.com/woo-soojin/no_more_potentially_dynamic_objects
- VoxelNeXt detector used by the public implementation: https://arxiv.org/abs/2303.11301
- Patchwork++ ground segmentation lineage: https://arxiv.org/abs/2207.11919
- SC-A-LOAM mapping implementation referenced by the public implementation: https://github.com/gisbi-kim/SC-A-LOAM
