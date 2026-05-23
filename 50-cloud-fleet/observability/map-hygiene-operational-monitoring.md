# Map Hygiene Operational Monitoring

**Last updated:** 2026-05-23

Map hygiene needs runtime monitoring after publication. A map that passed offline validation can still fail in operation because the site changed, a temporary overlay expired, a vehicle received the wrong bundle, or perception disagrees with static assumptions.

## Monitoring Goals

| Goal | Signal |
|---|---|
| detect stale or wrong map | perception-map disagreement, operator reports, repeated route failures |
| catch localization regression | residuals, covariance, inlier count, NDT score, relocalization time |
| catch false-free-space risk | current obstacle where map says clear, FOD ticket in route corridor |
| control temporary overlays | expiry, owner acknowledgement, active vehicle count |
| support incident review | active map ID, prior map ID, rejected layer, raw evidence links |
| guide data collection | zones with repeated uncertainty, sparse features, or reviewer burden |

The dashboard interprets those signals against the canonical [Airside Map Hygiene Ground Truth Protocol](../../30-autonomy-stack/localization-mapping/maps/airside-map-hygiene-ground-truth-protocol.md), the [V&V companion](../../60-safety-validation/verification-validation/airside-map-hygiene-ground-truth-protocol.md), and the [map publication gates](../map-operations/map-publication-gates-airside-hygiene.md). Runtime alerts should therefore carry enough map, semantic-layer, reviewer-disposition, and rejected-layer IDs to reconstruct whether a disagreement is a stale map, a cleaning error, a legitimate temporary overlay, or an unresolved unknown/quarantine region.

## Telemetry Fields

| Field | Type | Notes |
|---|---|---|
| `map.site_id` | string | airport or test-site identifier |
| `map.tile_id` | string | stable tile/zone/stand identifier |
| `map.bundle_id` | string | signed map package ID |
| `map.layer_ids` | string array | point cloud, semantic, overlay, hazard, unknown |
| `release.manifest_id` | string | signed release manifest ID from the release authority |
| `release.compatibility_hash` | string | hash over active code/model/map/semantic/calibration/config/schema/evidence set |
| `map.semantic.layer_id` | string | active semantic HD-map layer ID |
| `map.semantic.manifest_id` | string | signed semantic-map manifest ID |
| `map.semantic.compatibility_hash` | string | hash binding source map, semantic layer, taxonomy, model, calibration, config, schema, and evidence |
| `map.semantic.taxonomy_id` | string | ordered class ontology and unknown-policy ID |
| `map.semantic.evidence_ids` | string array | map QA, runtime replay, calibration, and safety-case evidence packets |
| `map.semantic.coverage_at_tau` | double | fraction of route/tile points above the approved confidence threshold |
| `map.semantic.unknown_rate` | double | fraction of points/elements abstained to `unknown` |
| `map.semantic.safety_class_gate_state` | enum | green, yellow, red, unknown for markings, boundaries, FOD/hazard, barriers, and movable-static classes |
| `map.semantic.seam_boundary_f1` | double | tile-boundary semantic consistency metric from the release QA report |
| `map.semantic.label_churn_rate` | double | label change rate in unchanged geometry since the prior semantic layer |
| `map.semantic.review_status` | enum | passed, review, quarantined, waived, expired |
| `map.semantic.qa_report_id` | string | immutable semantic QA evidence packet |
| `telemetry.schema_url` | string | OpenTelemetry/custom schema URL used to interpret custom map fields |
| `telemetry.schema_version` | string | schema version expected by dashboards and release gates |
| `runtime.validation.map_manifest_match` | bool | vehicle-reported map/release IDs match the signed manifest |
| `runtime.validation.semantic_layer_match` | bool | vehicle-reported semantic layer matches the signed manifest |
| `runtime.validation.taxonomy_match` | bool | vehicle-reported taxonomy matches the signed manifest |
| `runtime.validation.schema_match` | bool | emitted telemetry schema matches the expected schema URL/version |
| `map.cleaner.version` | string | algorithm/model/config version |
| `map.release_state` | enum | draft, validation, canary, active, rolled_back, retired |
| `map.hygiene.static_preservation_rate` | double | by zone or asset class |
| `map.hygiene.ghost_rate` | double | residual dynamic clutter per tile or route |
| `map.hygiene.fod_candidates` | int | retained/reviewed FOD-like objects |
| `map.hygiene.unknown_area_m2` | double | unknown or quarantined area |
| `localization.ndt_score` | double | align with Autoware NDT debug/diagnostic outputs |
| `localization.covariance_xy` | double array | covariance or derived error ellipse |
| `localization.inlier_ratio` | double | scan-to-map health |
| `map.disagreement.count` | int | current perception disagrees with map |
| `map.overlay.expiry_time` | timestamp | required for temporary assets |
| `vehicle.active_map_id` | string | vehicle-reported active bundle |

Use OpenTelemetry semantic conventions where they fit, and publish a map-specific schema URL for custom fields so dashboards and offline analysis can handle schema evolution.

## Alerts

| Alert | Trigger | Action |
|---|---|---|
| map mismatch | vehicle active map differs from dispatch expectation | stop dispatch or force reload |
| localization degradation | sustained residual/covariance increase by tile | canary pause or rollback |
| high disagreement | repeated perception-map conflict in same zone | create map-change ticket |
| expired overlay | temporary overlay active past expiry | block route or renew approval |
| FOD conflict | FOD/hazard candidate overlaps cleaned/removed layer | safety review ticket |
| unknown growth | unknown/quarantine area exceeds route threshold | block publication or data collection |
| semantic contract mismatch | semantic layer, taxonomy, manifest, or compatibility hash differs from signed bundle | stop dispatch/canary and force approved reload |
| semantic QA drift | unknown rate, coverage at threshold, safety-class gate, seam score, or label churn leaves validation envelope | quarantine tile, open label/map review, and preserve evidence |
| intervention cluster | remote assist/manual takeover by map tile | incident triage |

## Dashboard Views

| View | Contents |
|---|---|
| release health | map bundle, release state, cohort, rollback readiness |
| localization by tile | NDT score, covariance, residuals, relocalization failures |
| hygiene by asset | static preservation, ghost rate, movable-static decisions |
| semantic layer health | active semantic layer, taxonomy, coverage, unknown rate, safety-class gate, seam score, label churn, review state |
| FOD and hazards | retained candidates, inspection status, false alarms, closures |
| overlays | owner, expiry, affected routes, active vehicles |
| incidents | active/prior map ID, logs, reviewer records, source evidence |

## Operational Rules

1. Every mission log must include the active map bundle ID, semantic layer ID, semantic manifest ID, compatibility hash, and active overlay IDs.
2. Every map-related alert must include tile, route, vehicle, software, sensor config, and timestamp.
3. Canary promotion requires monitoring coverage for the operational slices affected by the release.
4. Diagnostics should feed the same incident workflow as software and vehicle health alerts.
5. Map schema changes must be versioned so older dashboards do not silently misread fields.
6. Semantic QA drift must be interpreted against the signed threshold file; do not tune dashboard thresholds outside the release process.
7. Retain telemetry, raw evidence, semantic manifests, QA reports, and map bundles for any incident or safety event.

## Sources

- OpenTelemetry semantic conventions: https://opentelemetry.io/docs/specs/semconv/
- OpenTelemetry telemetry schemas: https://opentelemetry.io/docs/specs/otel/schemas/
- Autoware diagnostics API: https://autowarefoundation.github.io/autoware-documentation/latest/design/autoware-interfaces/ad-api/features/diagnostics/
- Autoware diagnostic graph aggregator: https://autowarefoundation.github.io/autoware_universe/main/system/autoware_diagnostic_graph_aggregator/
- Autoware topic state monitor: https://autowarefoundation.github.io/autoware_universe/main/system/autoware_topic_state_monitor/
- Autoware NDT scan matcher: https://autowarefoundation.github.io/autoware_core/latest/localization/autoware_ndt_scan_matcher/
- Local context: ../map-operations/map-publication-gates-airside-hygiene.md
- Local context: ../map-operations/hd-map-lifecycle-operations.md
- Local context: ../../30-autonomy-stack/localization-mapping/maps/airside-map-hygiene-ground-truth-protocol.md
- Local context: ../../60-safety-validation/verification-validation/airside-map-hygiene-ground-truth-protocol.md
