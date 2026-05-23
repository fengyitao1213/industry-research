# DSERT-RoLL

**Last updated:** 2026-05-23

DSERT-RoLL is a CVPR 2026 road-scene dataset for robust multimodal perception under diverse weather and lighting. It is notable because it combines stereo event, RGB, and thermal cameras with 4D radar, two LiDARs, ego odometry, calibration, 2D/3D boxes, and track IDs in one benchmark.

**Related pages:** [weather robustness datasets](weather-robustness-datasets.md), [AevaScenes](../methods/aevascenes.md), [K-Radar](../methods/k-radar.md), [4D radar sensor overview](../../../20-av-platform/sensors/4d-radar.md), [night operations and thermal fusion](../overview/night-operations-thermal-fusion.md)

---

## Scope

| Item | DSERT-RoLL coverage |
|---|---|
| Primary domain | Road driving under clear, fog, rain, snow, and varied lighting |
| Scale | 190 sequences and 21,679 frames in the public repository statistics |
| Core question | How stereo event/RGB/thermal, 4D radar, and dual-LiDAR sensors compare and fuse under adverse conditions |
| Tasks | 2D and 3D object detection, tracking-aware evaluation, modality ablation, multimodal fusion |
| Access | Hugging Face gated-access dataset, official project page, GitHub repository, and arXiv paper |

The dataset is useful because it brings several frontier sensors into the same synchronized driving scenes. Event cameras, thermal cameras, and 4D radar are often studied separately; DSERT-RoLL makes it easier to compare them under the same weather, lighting, object, and calibration conditions.

---

## Sensors And Labels

| Asset | Notes |
|---|---|
| Stereo RGB cameras | 2 x BFS-U3-51S5C cameras with 2448 x 2048 imagery at 10 FPS |
| Stereo event cameras | 2 x Prophesee EVK4 sensors with 1280 x 720 event streams |
| Stereo thermal cameras | 2 x FLIR A65 cameras with 640 x 512 thermal imagery at 30 FPS |
| 4D radar | RETINA-4FN radar with range, angular coverage, and Doppler-style radar point support |
| Long-range LiDAR | Livox HAP point cloud stream |
| Short-range LiDAR | Ouster OS0-128 point cloud stream |
| GPS/IMU | Microstrain 3DM-GX5-45 pose source |
| Labels | 2D and 3D bounding boxes, object IDs, calibration, per-frame pose, and sensor paths |

The GitHub repository structures data by weather condition and sequence, with labels and calibration in `label.pkl`. That makes the dataset practical for reproducible modality-ablation experiments instead of one-off fusion demos.

---

## Weather And Lighting

| Slice | Use |
|---|---|
| Clear | Baseline clean-weather performance and calibration checks |
| Fog | Camera and LiDAR degradation, thermal/event/radar compensation |
| Light and heavy rain | Wet-scene fusion, radar stability, event-camera behavior under streaks and reflections |
| Light and heavy snow | Sparse return degradation, thermal contrast, radar/event fallback behavior |
| Normal, low light, over-exposed, and HDR lighting | Exposure robustness and thermal/event camera complementarity |

The project comparison table lists DSERT-RoLL as covering clear, rain, fog, and snow while also including LiDAR, 4D radar, RGB, event, thermal, 3D boxes, tracking IDs, and odometry. That combination fills a gap between older camera/LiDAR datasets and single-new-sensor benchmarks.

---

## Best Use

Use DSERT-RoLL to:

- compare event, RGB, thermal, radar, and LiDAR evidence under the same scenes;
- test whether a fusion model remains robust when one visual modality degrades;
- benchmark radar/event/thermal add-ons against strong RGB/LiDAR baselines;
- evaluate cross-modal 2D and 3D object detection under weather and lighting shifts;
- design target-domain sensor suites before collecting expensive airport or industrial-site data.

For an AV stack, DSERT-RoLL is especially useful before committing to non-standard sensors such as event cameras or thermal stereo. It can show which sensor actually helps a specific failure mode instead of assuming that every extra modality improves robustness.

---

## Airside And Cross-Domain Transfer

| Domain | Fit | Notes |
|---|---|---|
| Road AV | Strong | Direct public-road driving benchmark with adverse-condition splits. |
| Airside vehicles | Moderate proxy | Good for sensor behavior, weak for aircraft, GSE, FOD, jet blast, glycol, and ramp geometry. |
| Warehouses and indoor robots | Limited | Event/thermal lessons may transfer, but weather and object taxonomy do not. |
| Yards, ports, mines, construction | Moderate proxy | Useful for low-light, weather, and radar/thermal fusion before local data collection. |
| Delivery robots and campuses | Moderate proxy | Sensor behavior transfers better than road-scale object distribution. |

Airside use should treat DSERT-RoLL as a public screening benchmark, not final evidence. Airport deployment still needs local logs with aircraft, tugs, belt loaders, carts, cones, personnel, reflective markings, wet concrete, de-icing activity, jet exhaust, and site-specific radar multipath.

---

## Limitations

- The dataset is road-scene data, not airport, warehouse, yard, port, mine, or construction data.
- The Hugging Face dataset is gated and uses CC BY-NC 4.0 terms, so commercial use needs license review.
- It is large enough for method comparison, but still smaller than the largest mature road datasets.
- It does not directly cover airside dust, steam, glycol film, jet blast shimmer, or wet-apron multipath.
- New sensor modalities can expose calibration and synchronization failures; scores should be reported with calibration-version provenance.

---

## Implementation Notes

1. Start with single-modality baselines before full fusion: RGB, event, thermal, radar, Livox, and Ouster.
2. Report per-condition scores instead of only aggregate AP.
3. Keep calibration and timestamp validation as first-class checks because event/radar/thermal fusion is sensitive to small alignment errors.
4. Build modality dropout tests: RGB missing, thermal saturated, radar sparse, LiDAR degraded, event noisy.
5. For airside transfer, map labels into a smaller safety ontology and measure whether rare/small hazards are preserved, not just vehicle AP.
6. Treat thermal and event cameras as complementary evidence for low light and HDR, not as safety authorities without uncertainty calibration.

---

## Sources

- [DSERT-RoLL project page](https://jeongyh98.github.io/dsert-roll/)
- [DSERT-RoLL arXiv paper](https://arxiv.org/abs/2604.03685)
- [DSERT-RoLL GitHub repository](https://github.com/jeongyh98/DSERT-RoLL-Dataset)
- [DSERT-RoLL Hugging Face dataset card](https://huggingface.co/datasets/jeongyh98/DSERT-RoLL)

