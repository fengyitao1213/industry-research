# Map Publication Gates for Dynamic Object Removal

**Last updated:** 2026-05-24

Dynamic-object removal changes a map package that vehicles may use for localization, route planning, geofencing, simulation, annotation, and incident review. Publication therefore needs explicit gates, not an informal "map looks cleaner" approval.

## Gate Summary

| Gate | Purpose | Required artifact | Stop condition |
|---|---|---|---|
| Intake | prove source data is controlled | source manifest, calibration, poses, raw logs | missing provenance or incompatible coordinate frame |
| Cleaner run | produce auditable output | raw map, cleaned map, removed/restored/unknown layers | rejected layer missing |
| Static preservation | prevent false deletion | class and asset preservation metrics | safety-critical erosion unresolved |
| Dynamic rejection | prevent ghost maps | dynamic artifact and ghost-rate metrics | moving clutter remains in release layer |
| FOD retention | prevent hazard erasure | FOD retained/reviewed evidence table | hazardous FOD candidate silently deleted |
| Localization replay | prove vehicle can localize | NDT/ICP residuals, inliers, covariance, recovery | release-zone regression |
| Semantic validation | prove topology and rules are intact | Lanelet2/vector map validation, route checks | disconnected route or shifted rule feature |
| Manifest contract | make release evidence machine-checkable | semantic-map manifest with hygiene layer digests and metric vector | missing permanent/dynamic/transient/FOD/artifact/review layer hashes |
| Safety release | connect to AGVS evidence | safety-case delta and operating limits | unapproved ODD or unresolved regulatory dependency |
| Deployment | control rollout and rollback | signed manifest, canary plan, rollback bundle | no rollback or monitor coverage |

## Evidence Required Per Map Tile

| Evidence | Fields |
|---|---|
| Tile manifest | site, stand/route, coordinate frame, source session IDs, map version, checksum |
| Cleaning configuration | algorithm, model, thresholds, input filters, runtime, operator, build ID |
| Layer outputs | static, removed, restored, movable-static, FOD/hazard, unknown/review |
| Validation results | PR/RR, static erosion, ghost rate, localization delta, semantic diff |
| Semantic-map manifest fields | `outputs.map_hygiene_layer_digests`, `metrics_evidence.map_hygiene_metrics`, reviewer decision, waiver/quarantine state |
| Review record | reviewer, decision, timestamp, comments, linked images/point-cloud views |
| Release state | draft, quarantined, canary, active, rolled back, retired |

## Gate Criteria

| Decision | Criteria | Next action |
|---|---|---|
| Accept | all gates pass, no unresolved safety-critical false deletion | sign and stage canary |
| Accept with overlay | base map passes, temporary restriction or asset layer required | publish overlay with owner and expiry |
| Quarantine | uncertainty affects route, stand, FOD, or localization feature | block tile and create review ticket |
| Rerun | cleaner parameter or source-data issue is correctable | rerun with locked change note |
| Reject | false deletion, coordinate error, semantic break, or unsafe FOD handling | keep prior map active and open corrective action |

## Evidence Conflict Checks

The gate must check conflicts between motion, semantics, persistence, operations, and reviewer policy. A cleaner can pass "dynamic removal" while still publishing a bad map if a stationary movable object is promoted, a fixed object is deleted, or a hazard is converted into free space.

| Conflict | Example | Required gate behavior |
|---|---|---|
| Motion says dynamic; semantics says fixed infrastructure | High flow on pole, curb, marking, wall, gate edge, or fixed sign | Block deletion until pose, de-skew, timestamp, correspondence, and occlusion evidence are reviewed |
| Motion says static; semantics says movable | Parked aircraft, GSE, bus, pallet, cone, barrier, or worker standing still | Quarantine as movable-static/static-transient; do not export as permanent map label |
| Persistent across sessions; operations says temporary | Long-running construction barrier, work-zone equipment, staged storage line | Publish as temporary overlay with owner, expiry, and rollback rule; do not merge into base map |
| Cleaner says noise/artifact; safety zone says hazard-sensitive | Small unknown cluster on stand, route, pedestrian path, or FOD-prone area | Route to FOD/hazard or unknown-review layer; reviewer must approve removal |
| Semantic class changed; localization improves | Removed clutter made NDT residual better but erased a fixed feature class | Require class-preservation evidence before accepting localization-only improvement |
| Reviewer approves; manifest lacks layer digest | Decision exists in ticket but not in release artifact | Fail manifest contract; release cannot be reproduced or audited |

Accepted map tiles should carry a per-cluster or per-region decision chain: `motion_state`, `semantic_mobility`, `persistence_state`, `ops_state`, `map_eligibility`, reviewer decision, and release state. This is the publication-side counterpart to the segmentation pipeline's permanence decision layer.

## Release Checklist

1. Confirm raw, cleaned, removed, restored, and unknown layers exist and share the same frame.
2. Verify map_projection, point-cloud map, and vector map are compatible as a bundle.
3. Run Lanelet2/map validation and route reachability checks for all affected routes.
4. Replay localization with production vehicle configuration and target map loader settings.
5. Review removed points near stands, hold lines, pedestrian routes, gate equipment, and FOD-prone areas.
6. Attach FAA AGVS test/demo assumptions where the release affects airside operation.
7. Sign the map bundle and keep the previous compatible bundle on vehicle or fetchable.
8. Canary by zone and vehicle cohort; monitor map-specific telemetry before promotion.

## Canary Monitoring

| Monitor | Trigger |
|---|---|
| Localization residual | sustained increase by tile, stand, or route |
| NDT convergence health | low score, high covariance, repeated initial-to-result distance warnings |
| Planner infeasibility | route failures clustered on updated map area |
| Perception-map disagreement | persistent static disagreement or new obstruction reports |
| Operator intervention | manual takeover, remote assist, or stop clustered by map version |
| FOD/hazard ticket mismatch | FOD alert appears in removed/static-cleaning evidence |

## Rollback Rules

| Condition | Action |
|---|---|
| coordinate frame mismatch | immediate rollback and vehicle cache audit |
| localization regression | pause rollout, revert affected cohort, preserve logs |
| false-free-space event | rollback and open safety investigation |
| semantic route break | rollback semantic and point-cloud layers as a compatible set |
| expired temporary overlay | remove overlay or republish with fresh approval |

## Sources

- FAA AGVS on Airports: https://www.faa.gov/airports/new_entrants/agvs_on_airports
- FAA Emerging Entrants Bulletin 25-02: https://www.faa.gov/airports/new_entrants/bulletins/25_02
- Autoware map component design: https://autowarefoundation.github.io/autoware-documentation/main/design/autoware-architecture/map/
- Autoware map loader: https://autowarefoundation.github.io/autoware_core/latest/map/autoware_map_loader/
- Autoware NDT scan matcher: https://autowarefoundation.github.io/autoware_core/latest/localization/autoware_ndt_scan_matcher/
- Autoware Lanelet2 map validator: https://github.com/tier4/autoware_lanelet2_map_validator
- Local context: ../../50-cloud-fleet/map-operations/hd-map-lifecycle-operations.md
- Local context: map-cleaning-false-deletion-test-protocol.md
