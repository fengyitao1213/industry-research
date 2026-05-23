# Sensor Calibration Fleet Operations

**Last updated:** 2026-05-23

## Purpose

This page defines fleet operations for sensor calibration after vehicles leave the lab. Calibration is treated as a controlled artifact with release gates, telemetry, drift response, maintenance triggers, rollback rules, and safety-case evidence. The goal is to prevent calibration drift from becoming a silent perception, localization, or free-space failure.

## Calibration Scope

| Calibration item | Examples | Runtime dependency |
|---|---|---|
| Intrinsics | Camera intrinsics/distortion, LiDAR beam correction, radar mounting model | Projection, detection, segmentation, calibration monitors |
| Extrinsics | LiDAR-camera, LiDAR-LiDAR, LiDAR-IMU, radar-camera, sensor-kit-to-base | Fusion, SLAM, occupancy, obstacle shape, localization |
| Time offsets | Sensor hardware timestamp offset, trigger skew, IMU/LiDAR temporal alignment | Deskew, tracking, scan matching, velocity estimation |
| Vehicle geometry | Base frame, wheelbase, ego box, sensor occlusion mask | Collision envelope, projection masks, route clearance |
| Map alignment | Sensor kit to map frame, datum, map tile transform | Localization, geofence, docking, stand clearance |

## Operating Model

1. Factory or installation calibration creates the baseline package.
2. Commissioning verifies the package on the target vehicle, route, map, and sensor firmware.
3. Runtime monitors watch calibration health continuously or periodically.
4. Fleet operations classify drift as green, yellow, red, or unknown.
5. Maintenance recalibrates or physically repairs the vehicle.
6. Release management signs a new calibration package and updates the compatibility manifest.

Calibration updates follow the same SUMS discipline as software because they can change vehicle behavior.

## Calibration Package Lifecycle

| State | Meaning | Allowed transition |
|---|---|---|
| Draft | Tool output exists but provenance, schema, and evidence links are incomplete. | Candidate after manifest validation and operator review |
| Candidate | Package is signed for validation on a specific vehicle, sensor kit, firmware set, and map/runtime manifest. | Validated after static, route, replay, and downstream checks pass |
| Validated | Evidence package is complete but the package is not yet the fleet-active version. | Active through a ringed rollout or rollback-approved as a fallback |
| Active | Package is the approved runtime calibration for the compatibility manifest. | Superseded by a newer package or quarantined by drift/fault evidence |
| Quarantined | Package, vehicle, modality, or sensor pair has a red/unknown calibration state. | Candidate only after physical inspection or recalibration produces new evidence |
| Superseded | Package is replaced and retained only for audit, reproduction, or rollback analysis. | Archive after retention period |
| Rollback-approved | Previous package has known compatibility and fresh enough evidence for emergency rollback. | Active only through a controlled rollback gate |

The package state must be visible to dispatch, OTA/SUMS, observability, and release dashboards. A calibration package that is valid in the lab but incompatible with the vehicle's active sensor firmware, frame tree, map datum, or perception/SLAM release is not deployable.

## Artifact Manifest Contract

| Field | Required content |
|---|---|
| `package_digest` | Cryptographic digest over the calibration files, schema, frame tree, and tool manifest |
| `schema_version` | Versioned manifest schema and migration rule |
| `vehicle_id` / `sensor_kit_id` | Vehicle, kit, mount revision, and platform class |
| `sensor_serials` | Camera, LiDAR, radar, IMU, GNSS, wheel, thermal, and event sensor IDs used by the package |
| `firmware_versions` | Firmware and driver timestamp modes that affect measurement interpretation |
| `frame_tree_hash` | Hash of safety-relevant TF frames and parent-child relationships |
| `calibration_method` | Target, targetless, online monitor, factory fixture, or hybrid method |
| `tool_version` | Calibration tool, container, parameters, and operator/pipeline ID |
| `source_data_ids` | Bag/MCAP/session IDs, route IDs, fixture IDs, and reference target IDs |
| `evidence_ids` | Static residual report, route validation, replay comparison, fault-injection response, and release ticket |
| `signer` | Approval identity, signing key, timestamp, and rollback authority |

Manifest validation should fail closed. Missing source data, unsigned local overrides, stale frame-tree hashes, or unknown schema versions turn the calibration state to unknown even if the numeric residuals look acceptable.

## Fleet Telemetry

| Field | Type | Notes |
|---|---|---|
| `calibration.package_id` | string | Signed calibration artifact |
| `calibration.package_digest` | string | Digest matched against the active compatibility manifest |
| `calibration.schema_url` | string | Versioned telemetry schema used by dashboards and alert rules |
| `calibration.sensor_kit_id` | string | Sensor kit and mount revision |
| `calibration.sensor_serials` | string array | All sensors used by the package |
| `calibration.firmware_versions` | string map | Sensor/driver firmware affecting timing, distortion, beam, or radar mode |
| `calibration.frame_tree_hash` | string | Hash of safety-relevant TF tree |
| `calibration.last_verified_time` | timestamp | Last successful validation |
| `calibration.state` | enum | green, yellow, red, unknown |
| `calibration.pair.<pair>.translation_error_m` | double | Residual or drift proxy |
| `calibration.pair.<pair>.rotation_error_deg` | double | Residual or drift proxy |
| `calibration.pair.<pair>.time_offset_ms` | double | Estimated temporal offset |
| `calibration.pair.<pair>.confidence` | double | Method-specific confidence or validity |
| `calibration.prerequisite.reason` | enum | stationary, moving_fast, low_features, bad_weather, no_overlap, sensor_fault |
| `diagnostics.calibration.level` | enum | ROS/Autoware diagnostic level |

Publish diagnostic states through ROS diagnostics and fleet metrics through a versioned OpenTelemetry-compatible schema.

Telemetry schema changes require migration rules for dashboards, alerts, and release evidence. If a field is renamed, split, or unit-changed without a schema bump, fleet monitors can silently compare incompatible residuals. OpenTelemetry-style schema URLs make calibration events replayable across software releases and prevent stale alert rules from treating missing fields as green.

## Drift Classes

| State | Condition | Vehicle action | Fleet action |
|---|---|---|---|
| Green | Residuals inside release envelope and checks recently passed | Normal operation | Eligible for release evidence |
| Yellow | Residual trend or intermittent validation failure but safety margins remain | Continue with approved speed/margin limits | Maintenance ticket and canary watch |
| Red | Residual exceeds hard threshold, wrong sensor/package, or transform invalid | Remove modality or controlled stop per safety case | Incident, route hold, recalibration required |
| Unknown | Monitor missing, no overlap/features, telemetry schema broken, stale verification | Treat as degraded; exclude from release evidence | Repair telemetry or schedule validation run |

## Drift Remediation Workflow

1. Runtime monitor raises yellow, red, or unknown with package ID, source sensor pair, residual, prerequisite reason, and evidence clip.
2. Dispatch and runtime assurance apply the approved response: reject the affected input, degrade the modality, reduce speed, hold route, or stop depending on the safety case.
3. Fleet ops quarantines the affected vehicle, modality, or calibration package and prevents map publication, release evidence, or cross-vehicle reuse from that state.
4. Data logging preserves before/after bags, TF snapshots, projection/registration previews, diagnostic history, weather/route context, and active manifest IDs.
5. Maintenance checks physical causes first: mount slip, bracket torque, lens/window service, sensor replacement, water ingress, firmware mode, clock source, and cable/network faults.
6. Calibration produces a candidate package through the approved target, targetless, fixture, or hybrid workflow.
7. Release validation runs static residual checks, route/overlap validation, downstream replay, calibration monitor fault injection, and compatibility checks.
8. The new package rolls out through canary vehicles or site slices, with the rollback-approved package retained until the canary closes.

## Runbook

| Trigger | First 5 minutes | Next action | Closure evidence |
|---|---|---|---|
| LiDAR-camera miscalibration red | Preserve image, point cloud, projection preview, calibration package ID | Stop autonomous use of affected fusion path; inspect mount and lens/cover | Recalibration report and replay pass |
| LiDAR-LiDAR overlap residual high | Check sensor health, point density, TF tree, route geometry | Reduce speed or stop if occupancy/fusion depends on pair | Residual back inside threshold over validation route |
| LiDAR-IMU time offset high | Check PTP/GNSS/PPS state and IMU driver timestamp source | Block map-building and localization release evidence | Timing validation and replay RPE pass |
| Wrong calibration package active | Stop dispatch or force reload approved package | Audit OTA manifest and vehicle inventory | Active manifest matches signed compatibility matrix |
| Monitor unavailable | Mark calibration unknown and alert fleet SRE | Repair diagnostic producer or schema pipeline | Monitor emits valid green/yellow/red state |

## Release Gates

| Gate | Pass condition | Block condition |
|---|---|---|
| K0 provenance | Calibration package links vehicle, sensor kit, serials, firmware, method, operator/tool version | Package cannot be traced to physical sensors |
| K1 static validation | Target-based or surveyed validation inside installation tolerance | Baseline residual exceeds release threshold |
| K2 route validation | Targetless route/overlap validation passes on representative apron geometry | Only lab target evidence for airside release |
| K3 downstream impact | Localization, free-space, object projection, and map alignment metrics do not regress | Calibration passes alone but perception-SLAM regresses |
| K4 drift monitor | Runtime monitor detects injected perturbations before unsafe output | Red drift is silent or action is not consumed |
| K5 maintenance recovery | Recalibration workflow restores package and evidence without manual database edits | Field support can leave invisible local override |
| K6 compatibility | OTA manifest prevents package on wrong vehicle/sensor/map/runtime | Cross-vehicle calibration reuse possible |

## Maintenance Rules

- Recalibrate after sensor replacement, mount adjustment, collision/strike, windshield/camera service, LiDAR bracket repair, IMU replacement, firmware timestamp-mode change, or map datum/frame change.
- Do not auto-apply online calibration corrections to safety-relevant transforms unless a separate safety case validates correction limits, scene degeneracy checks, and rollback.
- Keep local field overrides time-limited, ticketed, and visible as config drift.
- Preserve before/after bags and projection/registration previews for every red calibration event.
- Do not use calibration-red logs for map publication or release claims.

## Anti-Patterns

| Anti-pattern | Why it is unsafe |
|---|---|
| Cross-vehicle package reuse | Sensor serials, mounts, frame trees, firmware, and wear state differ even inside one vehicle class. |
| Residual-only release | A calibration can fit its target yet regress object projection, free-space, map alignment, or localization replay. |
| Auto-correction as the first response | Targetless optimization can converge on degenerate geometry, dynamic clutter, or stale timestamps. |
| Invisible field override | Local YAML, TF, or launch edits bypass SUMS, rollback, and safety-case traceability. |
| Missing rollback package | A bad calibration update becomes a fleet outage rather than a controlled rollback. |
| Schema drift without migration | Dashboards and alert rules can read stale fields as green or compare values with changed units. |

## Evidence Artifacts

| Artifact | Contents |
|---|---|
| Calibration package | Intrinsics, extrinsics, time offsets, frame tree, sensor serials, signatures |
| Tool manifest | Calibration tool version, method, parameters, operator, environment |
| Validation report | Residuals, confidence, route/scene coverage, prerequisites, failed attempts |
| Fault-injection report | Perturbation magnitude, monitor response, alert latency, false alarm notes |
| Maintenance ticket | Physical finding, replaced parts, photos, torque/fixture checks |
| Runtime trend | Residual history, state transitions, route/weather context |
| Release record | Compatibility manifest, safety-case claim IDs, approval, rollback package |

## Related Repository Docs

- `20-av-platform/sensors/calibration-tracking.md`
- `20-av-platform/sensors/calibration-bay-fixtures.md`
- `20-av-platform/sensors/multi-lidar-calibration.md`
- `10-knowledge-base/geometry-3d/active-calibration-experiment-design.md`
- `20-av-platform/sensors/sensor-to-algorithm-readiness-contract.md`
- `40-runtime-systems/ros-autoware/autoware-localization-timing-diagnostics.md`
- `40-runtime-systems/software-operations/on-vehicle-supply-chain-runtime-security.md`
- `50-cloud-fleet/observability/slam-timing-health-dashboard.md`
- `50-cloud-fleet/ota/perception-slam-artifact-compatibility-matrix.md`
- `50-cloud-fleet/ota/software-update-management-system-ops.md`
- `60-safety-validation/verification-validation/multi-sensor-calibration-release-benchmark.md`
- `60-safety-validation/runtime-assurance/monitor-qualification-evidence.md`

## Sources

- Autoware/TIER IV CalibrationTools guide: https://autowarefoundation.github.io/autoware-documentation/latest/how-to-guides/integrating-autoware/creating-vehicle-and-sensor-model/calibrating-sensors/calibration-tools/
- Autoware calibration status classifier: https://autowarefoundation.github.io/autoware_universe/main/sensing/autoware_calibration_status_classifier/
- NVIDIA DRIVE OS 7.0.3 LiDAR self-calibration use case: https://developer.nvidia.com/docs/drive/drive-os/7.0.3/public/drive-os-linux-sdk/embedded-software-components/DRIVE_AGX_SoC/DriveWorks/DriveWorks_SDK/tutorials/intermediate_tutorials/calibration/usecase_lidar.html
- OpenCalib paper: https://arxiv.org/abs/2205.14087
- OpenCalib SensorsCalibration repository: https://github.com/PJLab-ADG/SensorsCalibration
- ROS multisensor_calibration package: https://index.ros.org/r/multisensor_calibration/
- OCAMO camera-LiDAR calibration monitoring project: https://cmp.felk.cvut.cz/~moravj34/ocamo/
- Hilti SLAM Challenge 2023 dataset: https://www.hilti-challenge.com/dataset-2023
- Hilti SLAM Challenge 2023 paper: https://arxiv.org/abs/2404.09765
- ROS 2 diagnostic_updater README: https://docs.ros.org/en/ros2_packages/rolling/api/diagnostic_updater/__README.html
- UK Vehicle Certification Agency cyber security and software updating: https://www.vehicle-certification-agency.gov.uk/connected-and-automated-vehicles/cyber-security-and-software-updating/
- Uptane deployment best practices 2.1.0: https://uptane.org/papers/V2.1.0_uptane_deploy.pdf
- OpenTelemetry schema specification: https://opentelemetry.io/docs/specs/otel/schemas/
