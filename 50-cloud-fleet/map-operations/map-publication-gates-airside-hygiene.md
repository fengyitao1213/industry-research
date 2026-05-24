# Map Publication Gates for Airside Hygiene

**Last updated:** 2026-05-24

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
| source provenance | raw logs, survey dates, calibration, control points, coordinate frame, source-map acceptance package | map owner |
| hygiene validation | dynamic rejection, static preservation, source-map geometry QA report, FOD retention, unknown/quarantine report | V&V lead |
| semantic integrity | semantic-map manifest, taxonomy/class-order hash, source-map `qa_report_id`, safety-class metrics, unknown/confidence policy, Lanelet2/vector validation, route reachability, geofence, speed/no-go overlays | autonomy lead |
| runtime map-load contract | Autoware projection, Lanelet2, pointcloud metadata, PCD cell split, and loader smoke-test evidence | autonomy lead |
| operational fit | stand/route availability, closure/work-zone status, sponsor constraints | airport ops |
| safety case delta | hazard impact, residual risk, FAA AGVS/test-plan trace if applicable | safety lead |
| deployment readiness | signed compatibility manifest, compatible vehicle/software, rollback cache, canary monitors | fleet ops |
| post-release review | monitoring window, interventions, map disagreements, FOD tickets | release manager |

The **semantic-integrity** gate is evaluated against the semantic layer produced by the offline aggregated-map semantic segmentation pipeline (`../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md`). That pipeline's own QA gates — held-out mIoU, per-class IoU on safety-relevant classes, cross-pass consistency, seam audit, version-to-version label churn (its §13.2-13.3) — are the upstream evidence this gate consumes; per-point confidence and provenance (its §8.6, §10.6) make the layer auditable for the safety-case-delta gate.

The semantic manifest's `metrics_evidence.qa_report_id` must dereference to a QA bundle that includes source-map geometry quality before this gate can pass. For MapEval-style checks, require a `source_map_quality` block with method, metric set, config hash, reference-map hash or no-reference waiver, alignment transform, threshold policy, failure-region digest, and pass/warn/fail/waived status. If the QA report is missing or cannot be dereferenced, treat semantic metrics as provisional even when mIoU and class recall look acceptable.

The source-map acceptance package from the map-construction pipeline must be present before semantic publication. It binds the source-map manifest hash, pose-graph digest, CRS/datum, calibration package, dynamic/static-transient/FOD/artifact/unknown layer digests, MapEval or equivalent source-map quality report, projection QA when imagery is used, and any quarantined failure regions. Publication is blocked when the package is `blocked` or missing; `accepted_with_quarantine` is allowed only if every quarantined region is reflected in the semantic tiling ledger, map-hygiene layers, route restrictions, or reviewer disposition.

The manifest must also carry `outputs.map_hygiene_layer_digests` and `metrics_evidence.map_hygiene_metrics`. These bind the semantic layer to the removal governance decision: permanent static, dynamic residual, static transient, movable-static, FOD candidate, artifact, unknown/review, and reviewer-decision artifacts must all be hash-addressed. A map cannot pass publication on semantic mIoU alone if the false-permanent, false-deletion, FOD-retention, or localization-delta metrics are missing.

The **hygiene-validation** gate uses the canonical [Airside Map Hygiene Ground Truth Protocol](../../30-autonomy-stack/localization-mapping/maps/airside-map-hygiene-ground-truth-protocol.md) as its label and reviewer-disposition source, with the [V&V companion](../../60-safety-validation/verification-validation/airside-map-hygiene-ground-truth-protocol.md) defining benchmark exchange fields and acceptance outputs. Publication is blocked when the candidate map lacks a signed static/dynamic/FOD/artifact/unknown report, rejected-object layer, reviewer decision state, or quarantine disposition for safety-critical deletions.

## Training-Data Export Gate

Many semantic-map releases also export back-projected single-scan labels for the perception training flywheel. Treat that export as a separate gate from map publication. A map may be acceptable for vehicle localization while still being unsafe as a training corpus if transient objects, unresolved review regions, or pose-drift boundaries are exported as supervised positives.

| Export condition | Allowed training use | Blocker |
|---|---|---|
| `permanent_static` with source-map acceptance, pose-quality pass, semantic confidence, and split assignment | Positive label for fixed semantic classes | Missing source-map QA, low view count, or validation/test timestamp leakage |
| `dynamic_residual` | Dynamic-removal auxiliary target or permanent-map negative | Exported as pavement, building, marking, or other static positive |
| `movable_static` | Quarantine/context layer or ignored pseudo-label | Parked aircraft, GSE, cones, or barriers exported as permanent infrastructure |
| `static_transient` | Hard negative, review evidence, or ignored pseudo-label | Stationary people or temporary objects exported as map truth |
| `fod_candidate` | Hazard/FOD active-learning queue after reviewer disposition | Deleted as noise without retained evidence or exported as background |
| `artifact` | Artifact/noise auxiliary target or ignored point | Used to train against true thin structures without source-quality proof |
| `unknown_review` | Active-learning queue only | Any automatic supervised positive |

The export manifest should include semantic class, release-state label, confidence, source-frame IDs, pose-quality bucket, split ID, reviewer state, and reason code for every exported point/voxel cluster. Publication is blocked for a training-enabled bundle if these fields are absent, even when the vehicle-facing map layers themselves pass. This mirrors the training eligibility contract in `../../30-autonomy-stack/perception/overview/3d-segmentation-training-paradigms.md`.

## Map Hygiene Checks

| Check | Pass signal | Blocker |
|---|---|---|
| dynamic object removal | ghost rate below zone threshold | aircraft/GSE ghosts in localization layer |
| static preservation | no unresolved deletion of safety-critical assets | eroded stand marking, curb, pole, or boundary |
| FOD retention | FOD-like candidates retained as hazard/review evidence | small hazard deleted as noise |
| do-not-delete hazard retention | raw, rejected, semantic, reviewer, quarantine/waiver, and placed-object evidence complete for all hazard-like candidates | hazard candidate deleted, waived, or class-filtered without preserved evidence and signed disposition |
| movable-static policy | temporary assets published only as overlays | cone/barrier/GSE promoted without approval |
| sparse LiDAR handling | weak evidence marked unknown or reviewed | unobserved area marked free |
| localization replay | NDT/ICP health neutral or improved | residual, covariance, or recovery regression |

## Release Checklist

1. Bundle point-cloud, semantic, projection, overlay, and validation artifacts atomically.
2. Include map ID and active layer IDs in every vehicle mission log.
3. Sign the bundle and record compatible software, sensor, calibration, model, taxonomy, telemetry schema, and map-runtime versions.
4. Block publication if source-map acceptance, semantic provenance, taxonomy/class-order, confidence/unknown thresholds, safety-class metrics, map-hygiene layer digests, map-hygiene metrics, QA report, or reviewer disposition is missing.
5. Block publication if unknown regions intersect route/geofence/FOD-sensitive zones without an approved ODD restriction or quarantine decision.
6. Block publication when the active ODD includes adverse-airside conditions but the bundle lacks signed local holdout results for do-not-delete hazards, or an explicit quarantine/ODD restriction.
7. If the bundle exports training labels, block publication unless every exported point has a release-state label and split assignment, and unless non-`permanent_static` labels are masked or routed as review/auxiliary targets.
8. Confirm Autoware map loaders launch from the signed bundle and that projection, Lanelet2, pointcloud metadata, and PCD cells are mutually consistent; if dynamic map loading is enabled, replay a representative route that requests nearby cells without unhealthy diagnostics.
9. Confirm rollback bundle availability before canary deployment.
10. Canary by zone, route, stand, and vehicle cohort, not by percentage alone.
11. Monitor localization, route failures, map disagreement, semantic unknown-rate drift, FOD tickets, and interventions.
12. Promote only after the monitoring window covers relevant conditions such as shift handover, night, rain, or busy stand operations.
13. Retire superseded bundles only after all vehicles report leaving the old version.

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
- FAA AC 150/5210-24A, Airport FOD Management: https://www.faa.gov/airports/resources/advisory_circulars/index.cfm/go/document.current/documentNumber/150_5210-24
- FAA AC 150/5220-24, FOD Detection Equipment: https://www.faa.gov/regulations_policies/advisory_circulars/index.cfm/go/document.information/documentNumber/150_5220-24
- Autoware map component design: https://autowarefoundation.github.io/autoware-documentation/main/design/autoware-architecture-v1/components/map/
- Autoware map loader: https://autowarefoundation.github.io/autoware_core/latest/map/autoware_map_loader/
- Autoware map projection loader: https://autowarefoundation.github.io/autoware_core/latest/map/autoware_map_projection_loader/
- Autoware pointcloud divider: https://autowarefoundation.github.io/autoware_tools/latest/map/autoware_pointcloud_divider/
- MapEval point-cloud map-quality evaluation: https://doi.org/10.1109/LRA.2025.3548441 and https://github.com/JokerJohn/Cloud_Map_Evaluation
- Uptane Standard 2.1.0: https://uptane.org/docs/2.1.0/standard/uptane-standard
- SLSA build provenance v1.2: https://slsa.dev/spec/v1.2/build-provenance
- Local context: hd-map-lifecycle-operations.md
- Local context: movable-static-asset-lifecycle-policy.md
- Local context: ../../30-autonomy-stack/perception/overview/3d-segmentation-training-paradigms.md
- Local context: ../../30-autonomy-stack/localization-mapping/maps/airside-map-hygiene-ground-truth-protocol.md
- Local context: ../../60-safety-validation/verification-validation/airside-map-hygiene-ground-truth-protocol.md
- Local context: ../observability/map-hygiene-operational-monitoring.md
