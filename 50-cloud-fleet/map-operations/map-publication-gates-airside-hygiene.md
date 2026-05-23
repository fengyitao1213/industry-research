# Map Publication Gates for Airside Hygiene

**Last updated:** 2026-05-09

Airside map publication must combine map quality, operational approval, safety evidence, and rollout control. The goal is to prevent stale maps, over-cleaned maps, hidden FOD, and temporary assets from reaching vehicles as if they were permanent ground truth.

## Release States

| State | Meaning | Allowed use |
|---|---|---|
| draft | candidate map or overlay under construction | offline validation only |
| validation | automated and human checks running | replay, simulation, non-operational vehicle |
| quarantined | unresolved safety or evidence issue | not deployable |
| canary | signed release to limited zone/cohort | monitored operation inside approved envelope |
| active | production map for approved vehicles/routes | normal dispatch |
| rolled_back | superseded due to issue | incident/replay only |
| retired | no vehicle may use it | archive and legal hold as needed |

## Publication Gate Table

| Gate | Evidence | Required approver |
|---|---|---|
| source provenance | raw logs, survey dates, calibration, control points, coordinate frame | map owner |
| hygiene validation | dynamic rejection, static preservation, FOD retention, unknown/quarantine report | V&V lead |
| semantic integrity | semantic-map manifest, taxonomy/class-order hash, safety-class metrics, unknown/confidence policy, Lanelet2/vector validation, route reachability, geofence, speed/no-go overlays | autonomy lead |
| runtime map-load contract | Autoware projection, Lanelet2, pointcloud metadata, PCD cell split, and loader smoke-test evidence | autonomy lead |
| operational fit | stand/route availability, closure/work-zone status, sponsor constraints | airport ops |
| safety case delta | hazard impact, residual risk, FAA AGVS/test-plan trace if applicable | safety lead |
| deployment readiness | signed compatibility manifest, compatible vehicle/software, rollback cache, canary monitors | fleet ops |
| post-release review | monitoring window, interventions, map disagreements, FOD tickets | release manager |

The **semantic-integrity** gate is evaluated against the semantic layer produced by the offline aggregated-map semantic segmentation pipeline (`../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md`). That pipeline's own QA gates — held-out mIoU, per-class IoU on safety-relevant classes, cross-pass consistency, seam audit, version-to-version label churn (its §13.2-13.3) — are the upstream evidence this gate consumes; per-point confidence and provenance (its §8.6, §10.6) make the layer auditable for the safety-case-delta gate.

## Map Hygiene Checks

| Check | Pass signal | Blocker |
|---|---|---|
| dynamic object removal | ghost rate below zone threshold | aircraft/GSE ghosts in localization layer |
| static preservation | no unresolved deletion of safety-critical assets | eroded stand marking, curb, pole, or boundary |
| FOD retention | FOD-like candidates retained as hazard/review evidence | small hazard deleted as noise |
| movable-static policy | temporary assets published only as overlays | cone/barrier/GSE promoted without approval |
| sparse LiDAR handling | weak evidence marked unknown or reviewed | unobserved area marked free |
| localization replay | NDT/ICP health neutral or improved | residual, covariance, or recovery regression |

## Release Checklist

1. Bundle point-cloud, semantic, projection, overlay, and validation artifacts atomically.
2. Include map ID and active layer IDs in every vehicle mission log.
3. Sign the bundle and record compatible software, sensor, calibration, model, taxonomy, telemetry schema, and map-runtime versions.
4. Block publication if semantic provenance, taxonomy/class-order, confidence/unknown thresholds, safety-class metrics, QA report, or reviewer disposition is missing.
5. Block publication if unknown regions intersect route/geofence/FOD-sensitive zones without an approved ODD restriction or quarantine decision.
6. Confirm Autoware map loaders launch from the signed bundle and that projection, Lanelet2, pointcloud metadata, and PCD cells are mutually consistent; if dynamic map loading is enabled, replay a representative route that requests nearby cells without unhealthy diagnostics.
7. Confirm rollback bundle availability before canary deployment.
8. Canary by zone, route, stand, and vehicle cohort, not by percentage alone.
9. Monitor localization, route failures, map disagreement, semantic unknown-rate drift, FOD tickets, and interventions.
10. Promote only after the monitoring window covers relevant conditions such as shift handover, night, rain, or busy stand operations.
11. Retire superseded bundles only after all vehicles report leaving the old version.

## Operational Overrides

| Override | Rule |
|---|---|
| emergency no-go | fast publish allowed; post-change review within one business day |
| temporary work zone | owner, reason, expiry, and briefing required |
| FOD hazard | hazard alert can block route without permanent map edit |
| construction change | quarantine affected tile until source evidence and route checks pass |
| airport sponsor restriction | override map route availability immediately |

## Sources

- FAA AGVS on Airports: https://www.faa.gov/airports/new_entrants/agvs_on_airports
- FAA Part 139 CertAlert 24-02: https://www.faa.gov/airports/airport_safety/certalerts/part_139_certalert_24_02
- FAA Emerging Entrants Bulletin 25-02: https://www.faa.gov/airports/new_entrants/bulletins/25_02
- FAA Foreign Object Debris Program: https://www.faa.gov/airports/airport_safety/fod
- Autoware map component design: https://autowarefoundation.github.io/autoware-documentation/main/design/autoware-architecture-v1/components/map/
- Autoware map loader: https://autowarefoundation.github.io/autoware_core/latest/map/autoware_map_loader/
- Autoware map projection loader: https://autowarefoundation.github.io/autoware_core/latest/map/autoware_map_projection_loader/
- Uptane Standard 2.1.0: https://uptane.org/docs/2.1.0/standard/uptane-standard
- SLSA build provenance v1.2: https://slsa.dev/spec/v1.2/build-provenance
- Local context: hd-map-lifecycle-operations.md
- Local context: movable-static-asset-lifecycle-policy.md
