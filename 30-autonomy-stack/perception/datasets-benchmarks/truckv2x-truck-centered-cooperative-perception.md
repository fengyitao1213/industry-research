# TruckV2X Truck-Centered Cooperative Perception

**Last updated:** 2026-05-23

TruckV2X is a 2025 IEEE Robotics and Automation Letters dataset for truck-centered cooperative perception. It is useful because most V2X perception datasets focus on light vehicles or paired vehicle-infrastructure scenes, while long articulated trucks create different blind zones, trailer occlusions, and cooperator roles.

**Related pages:** [V2X large-range and sequential datasets](v2x-large-range-sequential-datasets.md), [infrastructure cooperative perception](../overview/infrastructure-cooperative-perception.md), [collaborative fleet perception](../overview/collaborative-fleet-perception.md), [SparseCoop](../methods/sparsecoop.md), [QuantV2X](../methods/quantv2x.md), [V2X-Radar](../methods/v2x-radar.md), [autonomous trucking lane operations](../../../70-operations-domains/road-av/operations/autonomous-trucking-lane-operations.md)

---

## Scope

| Item | TruckV2X coverage |
|---|---|
| Primary domain | Synthetic autonomous trucking cooperative perception |
| Source status | IEEE RA-L 2025 article, arXiv record, official project page, and Hugging Face dataset |
| Simulator | CARLA with Unreal Engine semi-trailer truck modeling |
| Agents | Tractor, trailer, connected autonomous vehicle, and roadside unit |
| Scale | 64 scenarios, 88,396 LiDAR frames, and 1.18M 3D bounding boxes on the project page |
| Core question | How tractor-trailer geometry changes occlusion, sensing, and cooperation benefit |

TruckV2X should be read as a benchmark and occlusion-analysis dataset, not as a cooperative perception model. It owns the truck-centered dataset gap; method pages such as [SparseCoop](../methods/sparsecoop.md), [QuantV2X](../methods/quantv2x.md), [CoSDH](../methods/cosdh.md), and [CoopTrack](../methods/cooptrack.md) own the algorithmic fusion choices.

---

## Sensors And Labels

| Agent | Sensors |
|---|---|
| Tractor and trailer | 64-channel LiDARs plus multi-camera RGB coverage; the project page lists 2 LiDARs and 5 cameras for tractor/trailer configurations. |
| CAV | 64-channel LiDAR plus four-camera coverage. |
| RSU | 64-channel LiDAR plus camera sensing from a fixed roadside viewpoint. |

Dataset records include synchronized point clouds, RGB images, per-agent metadata, calibration/pose information, and 3D object annotations. The public Hugging Face release is MIT licensed and includes train, validation, and test folders plus a dataset loading script; the dataset viewer currently cannot inspect it directly because the release uses a custom Python dataset script.

Labels support cooperative 3D object detection and truck-specific occlusion studies. The paper/project group evaluation around light vehicles, heavy vehicles, and vulnerable road users.

---

## Truck-Specific Questions

| Question | Why it matters |
|---|---|
| Tractor self-perception | Long hood, high cab, trailer articulation, and large blind zones change what onboard sensors can see. |
| Trailer as cooperator | Trailer-mounted sensing can recover rear-quarter and side occlusions that tractor-only datasets miss. |
| Truck as occluder | Large trucks block CAV and RSU views differently from passenger vehicles. |
| Truck as mobile infrastructure | A truck can become a useful remote sensing platform for nearby road users. |
| Articulation angle | Trailer pivot changes occlusion and sensor overlap during turns and yard-style maneuvers. |

The project page reports that tractor-trailer combinations create substantially more occluded area than passenger cars within short range and that trailer pivot can worsen blind zones during large turns. Treat these as dataset-analysis findings for the TruckV2X simulator, then re-check them on target fleets or real yards before using them as operational evidence.

---

## Tasks And Metrics

| Task | Metric or output |
|---|---|
| Cooperative 3D object detection | AP and mAP at IoU 0.3, 0.5, and 0.7 |
| Ego-role comparison | Truck, CAV, RSU, tractor, and trailer cooperation modes |
| Occlusion recovery | Occlusion Recovery Rate for objects that an ego agent misses but cooperators observe |
| Class-sliced detection | Light vehicle, heavy vehicle, and VRU performance |
| Fusion comparison | Early, intermediate, late, and no-fusion baselines |

The project page reports benchmark experiments across eight cooperative perception methods. It highlights early fusion as strongest for truck ego at IoU 0.5 and notes that vulnerable-road-user detection remains difficult because small objects generate sparse LiDAR evidence.

---

## Best Use

Use TruckV2X to:

- test whether cooperative perception methods handle articulated heavy vehicles rather than only passenger-car scenes;
- benchmark truck, trailer, CAV, and RSU collaboration modes separately;
- measure occlusion recovery around a truck instead of only global AP;
- prototype data schemas for trailer-mounted sensors and truck-as-cooperator messages;
- compare against general V2X datasets before collecting real yard, port, highway, or airside data.

It is especially useful when a project has large, articulated, or high-occlusion vehicles but lacks a target-domain dataset.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV / trucking | Strong research fit | Directly targets autonomous trucking and heavy-vehicle cooperative perception, but it is synthetic. |
| Airside AV | Conditional proxy | Long GSE, baggage trains, catering trucks, fuel trucks, and fixed infrastructure create analogous occlusion patterns; aircraft geometry, GSE classes, FOD, wet aprons, jet blast, and ramp rules are missing. |
| Logistics yards and ports | Moderate to strong proxy | Articulated and heavy equipment plus fixed infrastructure transfer conceptually, but local layouts and object taxonomies differ. |
| Mining and construction | Conditional | Large-machine occlusion transfers, while terrain, dust, slopes, buckets, workers, and site geometry need local data. |
| Warehouses and campuses | Limited | Cooperative-agent ideas transfer, but road-scale trucks, CARLA scenes, and sensor geometry are less representative. |

For airside or industrial transfer, do not treat TruckV2X as final evidence. Use it to design sensor placement, cooperator roles, and occlusion metrics before collecting target-domain logs.

---

## Limitations

- It is synthetic CARLA/Unreal data, not real-world trucking logs.
- It does not include airport-specific aircraft, GSE, stand markings, jet bridges, FOD, chocks, cones, hoses, glycol film, or wet-apron multipath.
- It does not by itself validate V2X bandwidth, latency, packet loss, trust, cybersecurity, or time synchronization.
- Dataset licensing and generated-asset constraints should be reviewed before commercial reuse.
- AP/mAP can hide rare safety-critical failures; report occlusion, class, ego-role, and distance slices.
- Trailer-sensor value depends on mounting, calibration, wiring, maintenance, and operational coupling that may differ from real fleets.

---

## Implementation Notes

1. Keep tractor, trailer, CAV, and RSU as separate agents in data manifests.
2. Preserve articulation angle, relative pose, timestamp, calibration, and agent role fields.
3. Report truck ego, tractor ego, CAV ego, and RSU ego scores separately before averaging.
4. Add latency and packet-drop replay if using TruckV2X to evaluate deployable V2X methods.
5. For trucking operations, pair the dataset with lane-operation evidence, terminal handoff rules, inspection logs, and weather ODD gates.
6. For airside or yard transfer, add classes for local equipment and use occlusion-zone metrics around large vehicles, containers, aircraft, or fixed structures.

---

## Sources

- TruckV2X official project page: https://xietenghu1.github.io/TruckV2X/
- TruckV2X Hugging Face dataset: https://huggingface.co/datasets/XieTenghu1/TruckV2X
- TruckV2X arXiv record: https://arxiv.org/abs/2507.09505
- TruckV2X arXiv PDF: https://arxiv.org/pdf/2507.09505
- IEEE DOI: https://doi.org/10.1109/LRA.2025.3592884
