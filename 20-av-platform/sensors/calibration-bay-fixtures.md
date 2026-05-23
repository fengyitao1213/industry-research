# Calibration Bay Fixtures

Physical calibration bays turn sensor calibration from an ad hoc engineering activity into a repeatable production and maintenance station. This page covers the bay, fixtures, targets, surveyed references, evidence artifacts, and release gates. It does not replace calibration math, online drift monitoring, or fleet operations pages.

## Scope

Calibration-bay fixtures answer four operational questions:

1. Is the vehicle physically in a known reference frame?
2. Are all targets, fixtures, lights, and radar reflectors in known positions?
3. Did every sensor capture the evidence needed to produce or validate a calibration package?
4. Can the resulting package be traced to the vehicle, sensor kit, serial numbers, firmware, operator, tool version, and validation run?

The bay is a controlled evidence source. The calibration solver may be Autoware/TIER IV, OpenCalib, an internal factory tool, or a targetless validation pipeline, but the bay must make the physical assumptions visible.

## Production Pattern

Zoox describes a production end-of-line flow where each robotaxi enters a calibration bay before road-readiness tests. The vehicle rotates on a turntable and collects data to calibrate the full sensor suite: LiDAR, cameras, long-wave infrared, and radar. Zoox also describes the calibration bay as the station that ensures sensors are working together to produce an accurate understanding of the surroundings.

That is the correct mental model for an AV platform page: the bay is not only a camera checkerboard. It is a multi-sensor station with controlled geometry, repeatable vehicle pose, target provenance, and a signed output package that downstream readiness gates can consume.

## Bay Layout

| Zone | Purpose | Fixture requirement |
|---|---|---|
| Vehicle datum zone | Places `base_link`, wheel centers, sensor-kit datum, and ego envelope in a measured bay frame | Wheel stops, alignment marks, turntable index marks, floor fiducials, or surveyed parking rails |
| Sensor target ring | Gives every sensor a view of shared or modality-specific targets | Rigid posts or wall rails with target IDs, surveyed coordinates, mounting height, orientation, and revision |
| Lighting and thermal zone | Makes visible and LWIR targets repeatable | Dimmable visible lighting, thermal contrast source, warm-up time, ambient temperature logging, glare control |
| Radar target zone | Provides radar range/angle checks, and RCS checks only when the target source supports them | Calibrated radar targets or reflectors with known position, orientation, and standoff distance |
| Operator station | Captures tool run, visual checks, and evidence | Calibration workstation, live topic monitor, camera/LiDAR/radar previews, tool logs, pass/fail dashboard |
| Evidence station | Produces release artifacts | Signed calibration package, raw bag/MCAP references, target layout revision, photos, residual report, compatibility manifest |

Use fixture IDs rather than informal labels. `target_left_wall_03@rev_b` is traceable; "the left board" is not.

## Target Inventory

| Target type | Sensors served | What the fixture must record |
|---|---|---|
| Checkerboard / circle grid | Visible cameras, sometimes LiDAR-camera correspondences | Pattern size, square or circle spacing, board flatness, board pose in bay frame, lighting condition |
| AprilTag / ArUco board | Cameras, camera-to-LiDAR PnP workflows, target identification | Tag family, tag size, board ID, tag layout revision, detected pose covariance if available |
| Round-hole or edge target | LiDAR-camera and LiDAR-LiDAR workflows | Hole diameter or edge geometry, material, reflective coating, target normal, pose in bay frame |
| Planar LiDAR board | LiDAR extrinsic validation | Plane dimensions, normal direction, height, reflectivity, occlusion mask |
| Radar target / reflector | Radar range and azimuth/elevation checks; RCS checks only when explicitly sourced | Target class, dimensions, pose, standoff distance, multipath controls, and RCS metadata if available |
| Heated visible target | LWIR plus visible camera registration | Heat source, temperature contrast, warm-up time, emissivity, visible pattern alignment |
| Floor fiducial / surveyed mark | Vehicle and bay reference alignment | Survey coordinate, uncertainty, datum, inspection date, damage status |

OpenCalib's repository is useful as a public reference for target diversity: it lists factory calibration tools for chessboard, circle board, vertical board, AprilTag board, ArUco marker board, and round-hole board workflows, plus calibration coverage across camera, LiDAR, IMU, and radar. TIER IV's CalibrationTools similarly lists camera, LiDAR, and radar calibration tools, including camera intrinsics, camera-LiDAR, LiDAR-LiDAR, radar-LiDAR marker calibration, and tag-based PnP flows.

## Surveyed Reference Frame

The bay needs its own frame tree, separate from the vehicle runtime TF tree:

```
bay_world
  -> turntable_center
  -> vehicle_parking_pose
  -> target_<id>
  -> floor_mark_<id>
```

At run time, the vehicle calibration package should connect:

```
bay_world
  -> vehicle_base_link
  -> sensor_kit_base_link
  -> camera_<n> / lidar_<n> / radar_<n> / thermal_<n>
```

Every target pose should include:

- Coordinate frame and datum.
- Survey method and estimated uncertainty.
- Target revision and physical dimensions.
- Last inspection date.
- Damage, movement, or replacement status.
- Environmental condition if it changes measurements, such as temperature, lighting, or floor wetness.

For airport or industrial fleets, the same principle applies to site survey control. The bay frame should not silently drift from the map, stand, depot, or maintenance-cell coordinate system used for validation evidence.

## Run Workflow

| Step | Action | Evidence |
|---|---|---|
| 1. Vehicle intake | Confirm vehicle ID, platform, sensor-kit ID, sensor serials, firmware, active runtime version, and physical maintenance ticket | Intake record and inventory scan |
| 2. Bay setup check | Confirm target layout revision, target inspection status, lighting/thermal state, floor cleanliness, and radar reflector placement | Bay readiness checklist |
| 3. Vehicle positioning | Place vehicle on turntable, rails, wheel stops, or marked pose; record parking residual | Vehicle pose record and photos |
| 4. Data capture | Record synchronized images, point clouds, radar detections, thermal frames, IMU/GNSS/wheel state if required | Bag/MCAP ID, topic list, timestamp/clock state |
| 5. Solver or validator run | Run calibrated toolchain and store residuals, covariance/confidence, selected correspondences, rejected measurements, and warnings | Tool log and residual report |
| 6. Cross-modal preview | Save projection or registration previews for camera-LiDAR, radar-LiDAR, thermal-visible, and multi-LiDAR overlaps | Before/after visual evidence |
| 7. Package signing | Write calibration package with frame tree hash, sensor serials, firmware, target layout revision, tool version, and operator/pipeline ID | Signed calibration artifact |
| 8. Release gate | Check package against readiness, validation, and fleet compatibility rules before autonomous use | Pass/fail report and manifest update |

Autoware's LiDAR-camera tutorial shows the kind of implementation detail the bay workflow must preserve: the launch configuration names image, camera-info, pointcloud, frame, and calibration-output paths; the interactive calibrator requires matched image/LiDAR points; and the saved transform is written back into the sensor-kit calibration parameters. A production bay should make those inputs auditable rather than relying on an operator remembering which topics and frames were active.

## Acceptance Gates

| Gate | Minimum condition | Fails when |
|---|---|---|
| B0 bay readiness | Target layout, survey revision, lighting state, radar reflectors, and floor marks match the approved configuration | Target moved, missing, damaged, uninspected, or replaced without a revision |
| B1 vehicle identity | Vehicle, sensor kit, serials, firmware, and maintenance ticket match the intended calibration job | Package could be applied to the wrong vehicle or physical sensor |
| B2 time validity | Sensor timestamps, clock source, trigger mode, and bag replay policy are recorded | Host receipt time or mixed clock domains are used without approval |
| B3 geometry observability | Every calibrated pair has enough shared targets, overlap, or motion excitation for the solver used | Flat walls, occlusion, weak target coverage, or insufficient correspondences dominate |
| B4 residual envelope | Per-modality residuals and uncertainty are inside the release threshold for the platform and ODD | Residuals pass globally but fail for a safety-critical pair or near-field zone |
| B5 cross-modal preview | Human- or tool-reviewable projections/registrations are stored for release evidence | Numeric pass has no inspectable evidence |
| B6 compatibility | Package is compatible with active vehicle geometry, runtime, map, sensor firmware, and route/site manifest | Old package, wrong frame tree, incompatible firmware, or unapproved target revision |
| B7 maintenance recovery | Post-maintenance recalibration links to the replaced part, torque/fixture checks, photos, and before/after residuals | Vehicle returns to service without physical root-cause evidence |

The exact numeric thresholds belong to platform-specific validation. The existing multi-LiDAR calibration page uses sub-centimeter / sub-0.1-degree examples for target-based initialization, but a bay page should treat those as release targets to validate per sensor stack, range, ODD, and safety case.

## Airside And Industrial Fit

| Domain | Bay implication |
|---|---|
| Road robotaxi | Turntable or target ring can cover full-surround perception and end-of-line production flow. Include LWIR/radar if installed, not only RGB/LiDAR. |
| Airport airside | Add near-field ground targets, apron-marking and stand-geometry proxies, wet-apron/retroreflector checks, worker-height targets, and strong evidence capture after sensor strikes or bracket maintenance. FAA airport-marking standards cover runways, taxiways, and aprons; local apron/ramp practices still need site-specific modeling. |
| Industrial yard / port | Add mast, trailer, container, pallet, and dock-height targets; record dust, vibration, and washdown exposure before accepting residuals. |
| Indoor AMR / warehouse | Use smaller surveyed cells, floor fiducials, rack/corner targets, near-field safety scanner checks, and battery/charging-dock pose validation. |

Airside transfer should be explicit. A road-style target ring may be insufficient if the vehicle operates around aircraft skins, jet-bridge shadows, glycol film, wet concrete, retroreflective stand markings, and personnel at close range. Those effects do not necessarily change calibration math, but they change what the bay must validate and archive.

## Fixture Failure Modes

| Failure mode | Symptom | Control |
|---|---|---|
| Target movement | Residuals shift across many vehicles after a maintenance event | Target survey check, fixture tamper mark, target revision bump |
| Lighting drift | Camera or thermal calibration looks unstable by time of day | Controlled lighting state, warm-up timer, ambient logs, glare rejection |
| Radar multipath | Radar reflector appears at wrong range/angle or with ghost returns | Absorber/spacing policy, reflector standoff control, empty-bay background scan |
| Floor contamination | Wheel stops or targets are covered by water, glycol, dust, or debris | Bay readiness checklist and cleaning gate |
| Wrong frame names | Calibration package numerically fits but writes transforms under the wrong frame | Frame whitelist, TF tree hash, runtime manifest compatibility check |
| Operator point-pick error | Interactive correspondence set produces plausible but wrong extrinsics | Minimum points, saved correspondences, second-review preview, outlier report |
| Stale target model | Tool assumes old board dimensions or tag layout | Target model version pinned in the package |
| Incomplete evidence | Vehicle passes calibration but release cannot be audited later | Require raw logs, previews, residuals, tool version, target layout, and signatures |

## Implementation Notes

- Design the bay as a controlled measurement cell, not a storage area with boards.
- Keep target geometry in source-controlled files or a calibration asset database.
- Put QR/RFID labels on targets and fixtures so the tool can verify the physical layout revision.
- Capture a background scan for radar and LiDAR multipath checks after fixture changes.
- Store calibration bags separately from release packages; packages should point back to immutable raw evidence.
- Keep thermal targets warm long enough to reach stable contrast before collecting LWIR evidence.
- Run a known-good vehicle through the bay after target moves, lighting changes, turntable service, or floor repairs.
- Treat temporary field fixtures as a degraded bay. They need explicit uncertainty, photos, and review before release use.
- For airside validation, include wet or high-retroreflective marking checks when the ODD includes night rain or wet apron operations. FAA research found retroreflective pavement markers improved visual guidance under rainy, wet nighttime conditions, so the bay should not assume dry matte floor markings are the only relevant surface.

## Related Repository Docs

- [Sensor-to-Algorithm Readiness Contract](sensor-to-algorithm-readiness-contract.md)
- [Multi-LiDAR Extrinsic Calibration](multi-lidar-calibration.md)
- [Calibration and Synchronization Tracking](calibration-tracking.md)
- [LiDAR Timestamping, PTP/GPS Sync, Deskew, and Provenance](lidar-timestamping-ptp-gps-deskew-provenance.md)
- [Camera PTP, Trigger, Exposure, and Timestamp Semantics](camera-ptp-trigger-exposure-timestamp-semantics.md)
- [Radar Frame Timestamping and Doppler Integration](radar-frame-timestamping-doppler-integration.md)
- [Sensor Degradation Detection and Health Monitoring](sensor-degradation-health-monitoring.md)
- [Sensor Calibration and Time Synchronization Fundamentals](../../10-knowledge-base/geometry-3d/sensor-calibration-time-synchronization.md)
- [Multi-Sensor Calibration Observability](../../10-knowledge-base/geometry-3d/multi-sensor-calibration-observability.md)
- [Active Calibration Experiment Design](../../10-knowledge-base/geometry-3d/active-calibration-experiment-design.md)
- [Sensor Calibration Fleet Operations](../../40-runtime-systems/software-operations/sensor-calibration-fleet-ops.md)
- [Multi-Sensor Calibration Release Benchmark](../../60-safety-validation/verification-validation/multi-sensor-calibration-release-benchmark.md)

## Sources

- Zoox end-of-line testing and calibration bay: https://zoox.com/journal/zoox-end-of-line-testing-manufacturing
- Zoox serial production facility and EOL calibration bay: https://zoox.com/journal/zoox-robotaxi-serial-production-facility
- FAA AC 150/5340-1M, Standards for Airport Markings: https://www.faa.gov/airports/resources/advisory_circulars/index.cfm/go/document.current/documentnumber/150_5340-1
- FAA evaluation of retroreflective pavement markers under wet nighttime conditions: https://www.airporttech.tc.faa.gov/Products/Airport-Safety-Papers-Publications/Airport-Safety-Detail/evaluation-of-retroreflective-pavement-markers-for-precision-and-nonprecision-runways
- Autoware LiDAR-camera calibration tutorial: https://autowarefoundation.github.io/autoware-documentation/main/tutorials/integrating-autoware/creating-vehicle-and-sensor-model/calibrating-sensors/lidar-camera-calibration/
- TIER IV CalibrationTools: https://github.com/tier4/CalibrationTools
- OpenCalib SensorsCalibration: https://github.com/PJLab-ADG/SensorsCalibration
