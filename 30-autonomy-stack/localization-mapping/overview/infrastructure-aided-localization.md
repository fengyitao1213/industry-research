# Infrastructure-Aided Localization

Managed autonomy sites can install localization aids that public roads cannot: UWB anchors, visual fiducials, surveyed reflectors, RFID/BLE identity cues, Wi-Fi RTT access points, magnetic maps, and private-5G positioning infrastructure. These aids are useful when GNSS, LiDAR maps, or camera features degrade, but they should be treated as health-checked measurement evidence rather than ground truth.

Infrastructure-aided localization is a site-engineering pattern. The core design question is not "which beacon is most accurate?" but "which surveyed, maintained, time-valid, and health-scored measurement should enter the estimator for this zone?"

## Related Repository Docs

- [Mapping and Localization](mapping-and-localization.md)
- [Robust State Estimation Across Multi-Sensor Localization](robust-state-estimation-multi-sensor.md)
- [Production LiDAR Map Localization](production-lidar-map-localization.md)
- [UWB and Radio Ranging SLAM](../slam-methods/uwb-radio-ranging-slam.md)
- [Fiducial and Corner Localization](../../../10-knowledge-base/geometry-3d/fiducial-corner-localization.md)
- [CM-LIUW Odometry](../slam-methods/cm-liuw-odometry.md)
- [AV / Indoor / Outdoor Localization Decision Matrix](../slam-methods/av-indoor-outdoor-decision-matrix.md)
- [Map Tile Versioning and Distribution](../maps/map-tile-versioning-distribution.md)
- [Autonomous Docking and Precision Positioning](../../planning/autonomous-docking-precision-positioning.md)
- [Sensor-to-Algorithm Readiness Contract](../../../20-av-platform/sensors/sensor-to-algorithm-readiness-contract.md)
- [Airport 5G and CBRS](../../../20-av-platform/networking-connectivity/airport-5g-cbrs.md)

## Why It Matters

Infrastructure aids can reduce ambiguity in repetitive, GNSS-denied, low-texture, or close-proximity zones:

- Warehouses, tunnels, hangars, terminals, ports, mines, and loading docks can place anchors or tags where vehicle-only sensing has weak observability.
- Docking and bay operations can use surveyed fiducials, reflectors, or UWB anchors to constrain the final pose without depending only on map matching.
- Multi-zone campuses can use coarse infrastructure identity cues to select maps, route priors, and ODD policies before high-precision localization is available.
- Fleet operators can monitor fixed assets centrally, making localization degradation partly an infrastructure maintenance problem rather than only an on-vehicle perception problem.

The main hazard is over-trust. A stale anchor survey, moved tag, occluded marker, changed access point layout, or multipath-biased range can be worse than no aid if the estimator consumes it without covariance, health, and map-version checks.

## Aid Taxonomy

| Aid family | Typical measurement | Strong fit | Main failure modes |
|---|---|---|---|
| Surveyed visual fiducials and landmarks | Marker ID, corner bearings, relative pose, landmark observation | Docking bays, calibration bays, indoor/hangar checkpoints, door/stand alignment | Occlusion, damage, repeated IDs, lighting, lens contamination, marker-to-map survey drift |
| UWB anchors | Range, time-difference-of-arrival, angle where supported | Warehouses, terminals, tunnels, mines, hangars, ports, GNSS-denied campus zones | Non-line-of-sight bias, multipath, weak anchor geometry, clock/sync errors, anchor movement |
| RFID and BLE tags/beacons | Identity, zone, proximity, RSSI, angle where supported | Gate, dock-door, pallet, tool, and workcell identity; low-cost zone disambiguation | Coarse range, tag orientation, reader placement, RF interference, asset maintenance |
| Wi-Fi RTT or fingerprints | Round-trip range, AP identity, fingerprint signature | Existing indoor/campus Wi-Fi with moderate accuracy requirements | AP relocation, channel changes, multipath, device/OS variation, stale fingerprints |
| Magnetic markers or magnetic maps | Local field signature or marker detection | Indoor, underground, repetitive corridors, controlled floors | Metal layout changes, vehicle magnetic disturbance, floor repairs, map aging |
| 5G NR and mmWave positioning | Timing, angle, channel, beam, or map-aided features | Private 5G sites, ports, mines, campuses, future V2X-integrated localization | Emerging maturity, infrastructure complexity, channel blockage, standard/profile variation |
| LiDAR/camera reflectors and retroreflective targets | Bearing/range to known target or feature | Loading docks, bay entrances, docking funnels, terminal corridors | Contamination, damage, false reflectors, saturation, repeated geometry |

## Measurement Contract

Every infrastructure observation handed to localization should carry enough metadata to be rejected or downweighted. For the visual-marker and board measurement model behind these fields, use [Fiducial and Corner Localization](../../../10-knowledge-base/geometry-3d/fiducial-corner-localization.md).

| Field | Why it is required |
|---|---|
| `aid_id` and `aid_type` | Prevents anonymous landmarks from silently aliasing across zones. |
| Surveyed pose and covariance | Keeps installation uncertainty visible to the estimator. |
| Frame and datum | Joins the aid to the active map, site, tile, and vehicle frame tree. |
| Map or site version | Blocks anchors and markers from crossing into an incompatible map release. |
| Source timestamp and receive timestamp | Supports stale-data rejection, latency compensation, and replay evidence. |
| Measurement covariance and validity state | Lets the estimator weight UWB NLOS, marker corner quality, Wi-Fi RTT scatter, or BLE/RFID coarseness. |
| Health and maintenance state | Exposes damaged, moved, dirty, occluded, or overdue-inspection infrastructure. |
| Calibration and clock provenance | Joins antenna lever arms, camera intrinsics, reader configs, and time-sync state to release artifacts. |

Infrastructure observations should fail closed when the ID, frame, map version, survey version, timestamp, or health state is unknown.

## Fusion Handoff Patterns

| Handoff | Estimator use | Notes |
|---|---|---|
| Pose prior | Adds a prior or soft reset candidate near a known bay, marker, or zone | Use only with covariance and compatibility checks; avoid hard resets from single aids. |
| Range factor | Adds UWB/radio range residuals to a factor graph | Needs anchor geometry, tag extrinsics, clock/time model, and NLOS handling. |
| Bearing or landmark factor | Adds marker corner, reflector, or landmark observations | Needs marker-size/survey provenance, camera/LiDAR calibration, and outlier rejection. |
| Zone or topology constraint | Selects a map tile, route branch, or geofence region | Useful for RFID/BLE/Wi-Fi identity; usually too coarse for final pose. |
| Identity cue | Confirms dock, stand, pallet, tool, charger, or fixture identity | Keeps semantic identity separate from metric pose confidence. |
| Integrity monitor | Compares vehicle-local pose against infrastructure evidence | Good for drift detection; should not automatically override stronger onboard evidence. |

## Domain Fit

| Domain | Good uses | Cautions |
|---|---|---|
| Warehouses and factories | UWB, fiducials, reflectors, RFID/BLE zone identity, magnetic maps | Infrastructure ownership is strong, but aisle changes and moved fixtures must update the map. |
| Loading docks and yards | Dock-door fiducials, reflectors, RFID/BLE identity, UWB around covered docks | Outdoor weather, truck bodies, and metal can degrade visual and RF cues. |
| Ports and mines | UWB/5G positioning, reflectors, surveyed landmarks | Large vehicles, metal, dust, and sparse infrastructure increase maintenance burden. |
| Airport aprons and hangars | Fiducials in controlled bays, UWB or reflectors in GNSS-denied hangars, 5G/CBRS for connectivity-adjacent positioning | Do not assume public-airside installation rights; safety case must treat aids as additional evidence. |
| Campuses and terminals | Wi-Fi RTT, BLE, UWB, visual landmarks, private 5G | Access-point drift, multipath, and mixed indoor/outdoor transitions require map-version discipline. |
| Public roads | Limited: temporary work-zone markers, V2I, mapped reflectors in constrained corridors | Infrastructure coverage and ownership are inconsistent; vehicle-only fallback remains mandatory. |

## Lifecycle Controls

1. **Survey:** Record aid pose, covariance, frame, map tile, installer, instrument, date, and environmental notes.
2. **Commission:** Validate observations from multiple vehicle poses and compare against LiDAR/visual/IMU localization residuals.
3. **Publish:** Ship the aid manifest with the map release, calibration release, and runtime manifest.
4. **Monitor:** Track observation rate, residual distributions, NLOS/occlusion flags, clock quality, and health events.
5. **Inspect:** Schedule physical inspection for damaged markers, moved anchors, dirty reflectors, AP relocation, battery state, and water/dust exposure.
6. **Recalibrate:** Re-survey after facility changes, floor repair, anchor replacement, AP relocation, or repeated residual drift.
7. **Retire or rollback:** Remove aids from active manifests when health is red, survey is stale, or the associated map tile is rolled back.

## Failure Modes

- **NLOS UWB range bias:** A blocked path produces a plausible but biased range that can pull the estimate through walls or vehicles.
- **Multipath and RF interference:** Metal-rich sites can create range or RSSI signatures that vary with vehicle orientation and traffic.
- **Marker ambiguity:** Reused IDs, symmetric layouts, partial occlusion, and repeated docking patterns can produce wrong landmark associations.
- **Survey drift:** A moved anchor or reflector remains electronically alive but no longer matches the map.
- **Map-version mismatch:** Vehicle uses a tile release that does not contain the current infrastructure manifest.
- **Clock-domain mismatch:** TDoA, Wi-Fi RTT, 5G, camera, IMU, and vehicle clocks are fused with inconsistent timestamps.
- **Health invisibility:** Dirty, damaged, battery-low, or disconnected infrastructure is not represented in the localization input.
- **Over-constrained fusion:** Multiple weak aids are treated as independent precise measurements even though they share the same stale survey or RF environment.

## Implementation Checklist

- Keep infrastructure manifests versioned with map tiles, not as an independent spreadsheet.
- Include survey covariance and inspection state in the runtime artifact, not only in offline CAD/GIS data.
- Model aid measurements as factors with covariance, residual diagnostics, and outlier gates.
- Keep semantic identity cues separate from metric pose measurements.
- Require vehicle-only or degraded fallback behavior when an aided zone goes offline.
- Re-run localization regression after anchor moves, marker replacement, AP relocation, or magnetic-map refresh.
- Log accepted and rejected infrastructure observations with aid ID, map version, residual, health, and rejection reason.
- Validate across site archetypes: open yard, covered dock, terminal corridor, hangar, reflective metal area, and close-proximity docking bay.

## Boundary With Adjacent Pages

This page is the integration contract for site-installed localization aids. Use [Fiducial and Corner Localization](../../../10-knowledge-base/geometry-3d/fiducial-corner-localization.md) for AprilTag, ArUco, ChArUco, checkerboard, planar PnP, and marker-map pose evidence; [UWB and Radio Ranging SLAM](../slam-methods/uwb-radio-ranging-slam.md) for range-factor mechanics; [CM-LIUW Odometry](../slam-methods/cm-liuw-odometry.md) for camera/LiDAR/IMU/UWB odometry details; [Autonomous Docking and Precision Positioning](../../planning/autonomous-docking-precision-positioning.md) for final-approach control; and [Map Tile Versioning and Distribution](../maps/map-tile-versioning-distribution.md) for publishing aid manifests with map releases.

## Sources

- IEEE 802.15.4z standard page: https://standards.ieee.org/ieee/802.15.4z/10230/
- Range-SLAM with UWB range measurements (2024): https://arxiv.org/abs/2409.09763
- Continuous-Time Visual-Inertial-Ranging SLAM (CT-VIR, 2026): https://arxiv.org/abs/2604.14545
- All-UWB SLAM (2025): https://arxiv.org/abs/2507.15474
- AprilTag official repository: https://github.com/AprilRobotics/apriltag
- OpenCV ArUco marker detection tutorial: https://docs.opencv.org/4.x/d5/dae/tutorial_aruco_detection.html
- ROS 2 `apriltag_ros` package docs: https://docs.ros.org/en/humble/p/apriltag_ros/
- Android Wi-Fi RTT documentation: https://source.android.com/docs/core/connect/wifi-rtt
- Bluetooth Direction Finding overview: https://www.bluetooth.com/learn-about-bluetooth/feature-enhancements/direction-finding/
- MIT Media Lab RFID localization publication (2024): https://www.media.mit.edu/publications/reinforcement-learning-for-rfid-localization/
- IDF-MFL magnetic field localization (2024): https://arxiv.org/abs/2411.06182
- 3GPP location and positioning technology page: https://www.3gpp.org/technologies/location-and-positioning
- 3GPP Release 18 RAN1 notes: https://www.3gpp.org/technologies/ran1-rel18
- 5G NR active mmWave SLAM (2025): https://arxiv.org/abs/2507.04662
