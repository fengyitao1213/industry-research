# CMHT Autonomous Dataset

**Last updated:** 2026-05-23

The CMHT autonomous dataset is a 2025 Data in Brief multimodal driving dataset from McMaster University's Centre for Mechatronics and Hybrid Technologies. It combines color camera, infrared camera, Velodyne LiDAR, mm-wave radar, GPS/IMU, synchronized data, raw ROS 2 bags, and 3D tracklet labels across rain, night, highway, and city scenarios.

**Related pages:** [weather robustness datasets](weather-robustness-datasets.md), [RADIATE](radiate.md), [RainSense](rainsense.md), [radar-LiDAR fusion in adverse weather](../overview/radar-lidar-fusion-adverse-weather.md), [thermal IR cameras](../../../20-av-platform/sensors/thermal-ir-cameras.md)

---

## Scope

| Item | CMHT coverage |
|---|---|
| Primary domain | Road driving in highway and city scenes |
| Scale | More than 9000 frames recorded at 10 to 20 Hz |
| Core question | Multisensor fusion with radar and infrared support under poor weather and lighting |
| Data formats | Synchronized sensor folders and raw ROS 2 bag recordings |
| Labels | 3D tracklets for detected objects, with class, size, pose, rotation, and object ID |
| Access | ScienceDirect article, PMC full text, MacDrive data, and Federated Research Data Repository record |

CMHT is smaller than datasets such as Waymo or nuScenes, but it is useful because it provides radar and infrared camera data together with LiDAR and RGB camera streams in an accessible ROS 2-oriented format.

---

## Sensors And Labels

| Asset | Notes |
|---|---|
| Color camera | 1280 x 720 RGB images |
| Infrared camera | 640 x 480 grayscale IR images |
| Velodyne LiDAR | PCD point clouds with `x`, `y`, `z`, and intensity fields |
| mm-wave radar | PCD point clouds with `x`, `y`, `z`, and velocity fields |
| GPS/IMU | Measurement stream associated with the Velodyne LiDAR unit |
| Calibration | Intrinsic and extrinsic matrices for camera projections |
| Labels | JSON 3D tracklet labels for car, truck, van, pedestrian, bus, and long vehicle classes |
| Raw data | ROS 2 bag ZIPs for replay and pipeline testing |

The ROS 2 bag release is important for applied AV work. It lets teams test synchronization, playback, sensor-fusion nodes, and data ingestion behavior rather than only training from extracted image and point-cloud files.

---

## Weather And Lighting

| Slice | Use |
|---|---|
| Rain | Radar/IR/LiDAR fusion under wet conditions |
| Night | Camera and infrared complementarity under poor lighting |
| Highway scenes | Long-range detection and tracking behavior |
| City scenes | Mixed objects, occlusions, and traffic complexity |

The Data in Brief article emphasizes poor weather and lighting, especially rain and night, rather than full coverage of snow, fog, spray, dust, or airside obscurants. Use CMHT as a practical radar+IR fusion benchmark, not as a complete all-weather dataset.

---

## Best Use

Use CMHT to:

- test ROS 2 data ingestion, synchronization, and replay for multimodal perception;
- compare RGB, IR, LiDAR, radar, and fused 3D detection under rain and night;
- evaluate tracking continuity from 3D tracklet labels;
- prototype radar and IR fallback logic before moving to larger datasets;
- validate that a pipeline can preserve calibration provenance across extracted files and raw bags.

CMHT is also useful as a bridge between academic datasets and fleet-data infrastructure because it includes raw ROS 2 recordings. That makes it closer to vehicle-log processing than image-only benchmark releases.

---

## Airside And Cross-Domain Transfer

| Domain | Fit | Notes |
|---|---|---|
| Road AV | Moderate | Direct road data with radar, IR, LiDAR, and camera streams. |
| Airside vehicles | Moderate proxy | Useful for rain/night fusion and ROS 2 replay; weak for aircraft, GSE, FOD, glycol, and apron multipath. |
| Warehouses | Limited | IR and radar lessons may transfer to low-light docks, but outdoor rain scenarios do not. |
| Yards and ports | Moderate proxy | Radar/IR/LiDAR fusion under night and weather can inform industrial-yard perception. |
| Mines and construction | Limited to moderate | Sensor behavior transfers better than object taxonomy or road geometry. |

For airside autonomy, CMHT can support early rain/night sensor-fusion experiments. It cannot validate de-icing mist, steam, glycol film, jet blast, dust, wet-apron radar multipath, or aircraft/GSE taxonomy. Those remain target-domain data-collection gaps.

---

## Limitations

- The dataset is smaller than the largest driving datasets because manual labeling limits frame count.
- The LiDAR is a 32-channel Velodyne unit and may not represent newer high-resolution LiDAR configurations.
- The sensor overlap is mainly front-facing, which limits full-surround fusion studies.
- Pedestrian data is limited according to the article's limitations section.
- Rain/night are useful, but the dataset does not directly cover fog, snow, dust, steam, de-icing spray, or glycol residue.
- Road classes do not cover airport equipment, aircraft, cones, chocks, dollies, jet bridges, or workers in ramp-specific poses.

---

## Implementation Notes

1. Use the raw ROS 2 bags to test actual playback and synchronization paths before converting data into training tensors.
2. Keep both extracted synchronized files and raw bags in the experiment manifest so failures can be traced to preprocessing.
3. Report rain/night performance separately from aggregate scores.
4. Treat radar velocity as a distinct input, not just another sparse point cloud.
5. Pair CMHT with [RADIATE](radiate.md), [RainSense](rainsense.md), and [DSERT-RoLL](dsert-roll.md) when building an adverse-weather fusion evidence set.
6. For airside transfer, add local labels for reflective markings, wet concrete, GSE, FOD, personnel, and aircraft structures before making operational claims.

---

## Sources

- [CMHT Data in Brief article on ScienceDirect](https://www.sciencedirect.com/science/article/pii/S2352340925002847)
- [CMHT full text on PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12175244/)
- [CMHT data DOI](https://doi.org/10.20383/103.01024)
- [CMHT MacDrive data link](https://macdrive.mcmaster.ca/d/2d54f23bc41f48bd9a2d/)

