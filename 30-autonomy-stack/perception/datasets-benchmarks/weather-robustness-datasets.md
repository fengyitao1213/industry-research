# Weather Robustness Datasets for Perception and Artifact Removal

**Last updated:** 2026-05-23

This index summarizes adverse-weather driving datasets that are useful for validating perception degradation, LiDAR artifact removal, and sensor-fusion fallback behavior. The emphasis is not only algorithm selection, but also whether the validation data can expose failures caused by snow, rain, fog, wet-road spray, steam-like aerosol, dust-like obscurants, and asymmetric sensor degradation.

**Related research pages:** [LiDAR artifact removal techniques](../overview/lidar-artifact-removal-techniques.md), [radar-LiDAR fusion in adverse weather](../overview/radar-lidar-fusion-adverse-weather.md), [Airport-FOD3S synthetic FOD data engine](../../../50-cloud-fleet/data-platform/airport-fod3s-synthetic-data.md), [production perception systems](../overview/production-perception-systems.md)

---

## Dataset Coverage Matrix

| Dataset | Primary adverse condition | Modalities | Labels | Best validation use |
|---|---|---|---|---|
| [WADS](wads-winter-adverse-driving-dataset.md) | Falling snow, accumulated snow, whiteout-like winter driving | LiDAR, visible/NIR/LWIR cameras, radar, GNSS/IMU | Dense point-wise LiDAR labels with snow classes | Snow removal, snow segmentation, snow-aware mapping |
| [CADC / CADC+](cadc-cadc-plus.md) | Canadian winter driving, paired snow and clear sequences | 8 cameras, VLP-32C LiDAR, GNSS/INS | 3D boxes; CADC+ adds paired clear/snow evaluation | Snow domain shift, de-snowing, 3D detection degradation |
| [SemanticSTF](semanticstf.md) | Rain, snow, light fog, dense fog | LiDAR, RGB imagery, calibration/weather metadata | Dense point-wise semantic labels | All-weather 3D semantic segmentation and domain generalization |
| [REHEARSE-3D](rehearse-3d.md) | Emulated heavy rain | LiDAR-256, 4D radar, rain-characteristic metadata | Point-wise rain/no-rain annotations | LiDAR point-cloud de-raining and radar-conditioned removal |
| [RainSense](rainsense.md) | Natural rainfall with measured intensity | Camera, LiDAR, 4D mmWave radar, disdrometer | 2D/3D target boxes by 10-second case | Rain-intensity response curves and modality degradation |
| [SemanticSpray++](semantic-spray.md) | Wet road surface and road spray | Camera, VLP32C LiDAR, Ibeo LiDARs, Aptiv radar | Camera 2D boxes, LiDAR 3D boxes/semantics, radar semantics | Spray/wet-road robustness and radar-LiDAR fusion checks |
| [RADIATE](radiate.md) | Rain, fog, snow, night, clear baselines | Navtech radar, stereo camera, 32-channel LiDAR, GPS/IMU | 2D radar-image boxes for 8 actor classes | Radar-first adverse-weather detection and fusion fallback |
| [DSERT-RoLL](dsert-roll.md) | Clear, fog, rain, snow, varied lighting | Stereo RGB, event, thermal, 4D radar, dual LiDAR, GPS/IMU | 2D/3D boxes, track IDs, odometry | Cross-modal event/thermal/radar/LiDAR fusion under weather and lighting shifts |
| [CMHT Autonomous Dataset](cmht-autonomous-dataset.md) | Rain, night, highway/city scenes | RGB camera, IR camera, Velodyne LiDAR, mm-wave radar, GPS/IMU | 3D tracklets, calibration, raw ROS 2 bags | Practical radar+IR+LiDAR fusion and ROS 2 replay testing |
| [Seeing Through Fog / DENSE](seeing-through-fog-dense.md) | Fog, snow, rain, fog chamber conditions | RGB stereo, gated NIR, FIR, radar, HDL64/VLP32 LiDAR, weather station | 2D/3D boxes, weather/illumination/road-state tags | Multimodal fog/fusion validation and asymmetric failure studies |
| LIDAROC | LiDAR cover contamination including dust, water, mud, oil, and other cover states | LiDAR point clouds at 5 m, 10 m, and 20 m subsets | Clean/contaminated sample organization for robustness testing | Sensor-window contamination and dust-on-cover proxy before local airside collection |

---

## Coverage by Airside Hazard

| Airside hazard | Strongest public proxies | What to validate |
|---|---|---|
| Falling snow | WADS, SemanticSTF, CADC | Snowflake clutter removal, snowbank segmentation, detection drop under sparse returns |
| Accumulated snow and ice | WADS, CADC/CADC+ | Drivable-area ambiguity, snowbank map drift, clear-vs-snow domain adaptation |
| Natural rain | RainSense, RADIATE, SemanticSTF | Point-density loss, camera blur, radar stability, rain-rate operating limits |
| Heavy rain artifacts | REHEARSE-3D, RainSense | Point-wise raindrop removal and radar-conditioned filtering |
| Wet-road spray | SemanticSpray++, RADIATE | Spray clutter, wet-surface reflection, radar/LiDAR disagreement |
| Fog and steam-like aerosol | Seeing Through Fog/DENSE, RADIATE, SemanticSTF, DSERT-RoLL | Visibility reduction, LiDAR wobble/clutter, gated/FIR/radar/event/thermal fallback |
| Night and low light | RADIATE, DSERT-RoLL, CMHT | RGB degradation, thermal/IR support, radar-primary fallback, over-exposure handling |
| Dust and sand | LIDAROC for dust-on-cover, plus fog/spray/snow-dust public proxies | Treat as partial sensor-contamination and particle proxies; collect airside dust/jet-blast samples |
| De-icing mist and glycol spray | SemanticSpray++, REHEARSE-3D, Seeing Through Fog/DENSE, LIDAROC | Short-duration LiDAR occlusion, radar-primary fallback, sensor-cleaning trigger thresholds, cover-contamination response |

The key gap is dust/steam/de-icing fluid realism. Existing public data provides useful particle, aerosol, wet-surface, and sensor-cover contamination proxies, but an airside validation program still needs local recordings around jet blast, de-icing trucks, apron dust, rubber residue, glycol film, wet-apron multipath, and sensor-window contamination.

Evidence boundary: public road-weather and sensor-contamination datasets are screening and training proxies. They may justify model selection, stress-test design, degraded-mode thresholds, and sensor-cleaning triggers, but they do not close an airside safety claim for de-icing mist, glycol film, jet-blast dust/FOD entrainment, steam, heat shimmer, apron floodlighting, wet-apron multipath, standing-water reflection, or retroreflector bloom without direct target-airside validation.

---

## Recommended Validation Stack

1. **Point-level removal first:** use WADS for falling/accumulated snow, REHEARSE-3D for rain-point removal, and SemanticSTF for all-weather semantic segmentation stress tests.
2. **Object-level degradation next:** use CADC/CADC+ for snow-vs-clear 3D detection, RainSense for measured rain-rate curves, RADIATE for radar-first adverse-weather detection, and SemanticSpray++ for wet-road spray.
3. **Fusion robustness last:** use Seeing Through Fog/DENSE and RADIATE to validate that radar, gated NIR, FIR, camera, and LiDAR degrade asymmetrically rather than assuming one weather scalar applies to every sensor.
4. **Airside transfer gate:** after public-dataset screening, require a proprietary airside set with aircraft, GSE, cones, baggage carts, jet bridges, reflective markings, de-icing mist, dust, heated exhaust plumes, wet-apron multipath, and do-not-delete hazard labels before production claims. LIDAROC is a LiDAR cover-contamination proxy, not proof that free-air dust, glycol mist, or wet-apron multipath is handled.

---

## Practical Selection Guidance

| If the model does this | Start with | Then add |
|---|---|---|
| LiDAR snow removal | WADS | SemanticSTF, CADC |
| LiDAR rain removal | REHEARSE-3D | RainSense |
| Weather-aware semantic segmentation | SemanticSTF | WADS |
| Snow domain adaptation or de-snowing | CADC+ | WADS |
| Radar fallback in adverse weather | RADIATE | RainSense, SemanticSpray++ |
| Event/thermal/radar multimodal fusion | DSERT-RoLL | CMHT, MUSES |
| ROS 2 replay for radar+IR fusion | CMHT | RADIATE, RainSense |
| Fog/steam sensor fusion | Seeing Through Fog/DENSE | RADIATE |
| Spray robustness | SemanticSpray++ | RainSense, REHEARSE-3D |

---

## Source Notes

- WADS source records: [Michigan Tech dataset page](https://digitalcommons.mtu.edu/all-datasets/20/) and [Michigan Tech publication record](https://digitalcommons.mtu.edu/michigantech-p/16990/)
- CADC/CADC+: [CADC arXiv paper](https://arxiv.org/abs/2001.10117), [CADC+ project page](https://uwaterloo.ca/waterloo-intelligent-systems-engineering-lab/cadc-plus), [CADC+ arXiv paper](https://arxiv.org/abs/2506.16531)
- SemanticSTF: [GitHub](https://github.com/xiaoaoran/SemanticSTF), [Hugging Face](https://huggingface.co/datasets/AR-X/SemanticSTF), [CVPR 2023 arXiv paper](https://arxiv.org/abs/2304.00690)
- REHEARSE-3D: [arXiv paper](https://arxiv.org/abs/2504.21699), [Sensors article](https://www.mdpi.com/1424-8220/26/2/728)
- RainSense: [SAE paper record](https://saemobilus.sae.org/papers/rainsense-autonomous-driving-environmental-perception-dataset-rain-intensity-annotations-2025-01-7311), [GitHub release repository](https://github.com/IVtest-Lab/RainSense)
- SemanticSpray++: [project page](https://semantic-spray-dataset.github.io/), [arXiv paper](https://arxiv.org/abs/2406.09945)
- RADIATE: [project page](https://pro.hw.ac.uk/radiate/), [dataset documentation](https://pro.hw.ac.uk/radiate/doc/dataset/), [arXiv paper](https://arxiv.org/abs/2010.09076)
- DSERT-RoLL: [project page](https://jeongyh98.github.io/dsert-roll/), [arXiv paper](https://arxiv.org/abs/2604.03685), [GitHub repository](https://github.com/jeongyh98/DSERT-RoLL-Dataset), [Hugging Face dataset card](https://huggingface.co/datasets/jeongyh98/DSERT-RoLL)
- CMHT: [ScienceDirect article](https://www.sciencedirect.com/science/article/pii/S2352340925002847), [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC12175244/), [data DOI](https://doi.org/10.20383/103.01024), [MacDrive data link](https://macdrive.mcmaster.ca/d/2d54f23bc41f48bd9a2d/)
- Seeing Through Fog/DENSE: [GitHub](https://github.com/princeton-computational-imaging/SeeingThroughFog), [Princeton dataset page](https://light.princeton.edu/datasets/automated_driving_dataset/), [DENSE dataset page](https://www.uni-ulm.de/en/in/institute-of-measurement-control-and-microtechnology/research/data-sets/dense-datasets/)
- LIDAROC: [20m Zenodo dataset](https://zenodo.org/doi/10.5281/zenodo.12800632), [10m Zenodo dataset](https://zenodo.org/records/12800559), [5m Zenodo dataset](https://zenodo.org/records/12800039), [IEEE Sensors Letters paper record](https://doi.org/10.1109/LSENS.2024.3434624)
