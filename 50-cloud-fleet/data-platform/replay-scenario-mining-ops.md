# Replay and Scenario Mining Operations

**Last updated:** 2026-05-24

## Why It Matters

Autonomous fleet logs contain many routine miles and a small number of high-value moments. Scenario mining turns uncurated logs into replayable evidence: near conflicts, strange object interactions, failed localization, blocked routes, rare weather, confusing ground markings, and other long-tail cases that should become regression tests.

This page covers the operational loop from mined fleet event to replayable scenario asset. It does not define simulator physics or the full safety validation strategy.

## Operating Model

1. Ingest candidate events from triggers, operator notes, incident reports, model disagreement, anomaly detectors, and natural-language scenario search.
2. Index clips with map context, ego trajectory, actor tracks, weather, lighting, airport zone, model versions, and intervention metadata.
3. Mine scenarios using both rule queries and embedding or language search. Argoverse's scenario-mining task frames the problem as retrieving specific safety-relevant scenarios from large multi-modal logs localized to HD maps.
4. Normalize each accepted scenario into a scenario record: intent, actors, dynamic sequence, trigger conditions, ODD tags, source clip, and expected system response.
5. Represent dynamic replay intent using ASAM OpenSCENARIO concepts where practical: entities, storyboard, maneuvers, events, actions, triggers, conditions, and external road-network references.
6. Represent object and scene annotations using ASAM OpenLABEL-compatible fields where practical: object identity, class, 2D/3D geometry, segmentation, relations, actions, intentions, and taxonomy references.
7. When a scenario is mined from semantic-map drift or open-vocabulary/offboard labeling, preserve whether the label is a reviewed map class, a candidate concept, or a deliberate `unknown` region. A replay can assert "this must remain unknown" just as legitimately as "this should be promoted to class X".
8. Promote scenarios by state: `candidate`, `triaged`, `replay_ready`, `regression_required`, `retired`.

## Replay Suite by MLOps Scale

Replay is not only a simulator asset; it is an MLOps release gate. The suite should start lightweight, then become a governed regression product as the model gains operational authority.

| MLOps scale | Replay scope | Promotion rule | Suite-management risk |
|---|---|---|---|
| S0 notebook research | Optional clips used for qualitative debugging | Store interesting failures as candidate events when they may recur | Losing high-value examples in local notebooks |
| S1 repeatable prototype | Small fixed smoke suite for representative routes, classes, and sensor states | A new baseline should pass the same clips as the previous baseline | Overfitting to a tiny hand-picked suite |
| S2 production product | Regression suite for known incidents, label-edge cases, and runtime packaging checks | A candidate must pass replay with the same artifact package that will be deployed | Evaluating the model checkpoint but not the container, map, taxonomy, or runtime config |
| S3 fleet and multi-site | Site/ODD-sliced suites from mined logs, shadow disagreements, operator notes, and intervention clusters | Promotion is per ODD cell; failed cells remain blocked or canaried separately | One airport or route dominates the suite and hides local regressions elsewhere |
| S4 regulated safety-critical | Hazard-linked scenarios tied to the safety case, monitor activations, and waiver records | A release cannot proceed with unresolved regression-required scenarios unless risk acceptance is explicit and time-limited | Waivers becoming permanent substitutes for fixes |
| S5 platform scale | Shared scenario catalog, common schemas, automated coverage reports, and cross-team replay infrastructure | Suites are versioned products with ownership, retention policy, deprecation rules, and platform observability | Teams fork incompatible scenario formats and cannot compare evidence |

The state machine should be stricter at higher scale. At S0-S1, `candidate` and `triaged` states are enough to preserve learning. At S2, `replay_ready` becomes part of product release hygiene. At S3-S4, `regression_required` scenarios are blocking evidence unless a named release authority accepts the residual risk. At S5, suite health itself becomes a platform SLO: run time, flake rate, coverage, stale scenario age, duplicate rate, and cost per replay hour.

## Evidence Artifacts

| Artifact | Minimum contents | Owner |
|---|---|---|
| Scenario mining query | Query text or rule, search index version, time window, filters, requester | Scenario curator |
| Candidate clip manifest | Source log IDs, timestamps, manifest ID, compatibility hash, semantic layer ID, taxonomy ID, map tile IDs, telemetry schema URL/version, sensor availability, model versions | Data platform |
| Triage record | Why the clip matters, duplicate check, severity, regression priority | Safety validation |
| Scenario metadata | Actors, maneuvers, triggers, ODD tags, semantic-map context, affected map tiles, expected classes/unknown regions, source evidence IDs, expected behavior, acceptance metric | Scenario curator |
| Candidate semantic-label evidence | Prompt set, offboard model/checkpoint, source-map or projection hash, reviewer state, taxonomy action, expected class or `unknown` assertion, promotion decision ID | Label operations |
| Annotation package | OpenLABEL-style labels, taxonomy ID/hash, label schema version, semantic-layer source, QA report ID, reviewer | Label operations |
| Replay package | Simulator version, map bundle, semantic layer, taxonomy, telemetry schema, runtime config, release evidence IDs, seed, initial state, scenario file | Simulation owner |
| Regression result | Pass/fail, metric deltas, videos, logs, model version, waiver if any | Safety validation |

## Acceptance Checks

- Every replay scenario links back to immutable raw log, map, label, and processing snapshots.
- Scenario metadata has enough structure for search, replay selection, and coverage accounting.
- Scenario labels use a controlled taxonomy and record the schema version.
- Candidate labels from offboard/open-vocabulary tools are either reviewed into a controlled taxonomy class, retained as explicit unknown-region evidence, or excluded from replay assertions.
- The replay package can be executed by a clean worker without local manual files.
- A scenario is not `replay_ready` until the clean worker validates the signed manifest, resolves all map/semantic/taxonomy/schema IDs, and confirms replayed telemetry conforms to the recorded schema URL/version.
- Runtime validation compares vehicle-reported active IDs against replay package IDs before metrics count as release-regression evidence.
- The expected behavior is measurable: clearance, stop distance, yield behavior, route recovery, localization bound, or intervention avoidance.
- Regression-required scenarios are included in release gates before a model can be promoted.
- Retired scenarios keep a reason, replacement scenario if any, and last passing release.

## Failure Modes

| Failure mode | Consequence | Control |
|---|---|---|
| Scenario remains a video bookmark | Cannot run regression or measure improvement | Require replay package before promotion |
| Query results are not versioned | Mining cannot be repeated after index changes | Store query and index version |
| Duplicate scenarios flood the suite | Release gates become slow without added coverage | Cluster and deduplicate before promotion |
| Labels drift across teams | Scenario semantics change over time | Version taxonomy and run label QA |
| Replay omits map or weather context | Test no longer represents the field event | Store map, zone, weather, lighting, and initial state |
| Replay omits semantic layer or schema context | Metrics compare against the wrong class ontology or dashboard interpretation | Require semantic layer/taxonomy/schema IDs before `replay_ready` |
| Expected behavior is vague | Review becomes subjective | Define quantitative pass criteria |
| Scenario suite only includes failures | Overfits to known bad cases and misses normal behavior | Maintain balanced coverage by ODD and maneuver |

## Related Repository Docs

- `50-cloud-fleet/mlops/data-flywheel-airside.md`
- `50-cloud-fleet/data-platform/fleet-data-pipeline.md`
- `30-autonomy-stack/simulation/simulators-for-airside.md`
- `30-autonomy-stack/end-to-end-driving/airside-autonomy-benchmark-spec.md`
- `60-safety-validation/verification-validation/airside-scenario-taxonomy.md`
- `60-safety-validation/verification-validation/shadow-mode.md`
- `60-safety-validation/verification-validation/testing-validation-methodology.md`

## Sources

- Argoverse User Guide, "Scenario Mining." https://argoverse.github.io/user-guide/tasks/scenario_mining.html
- ASAM OpenSCENARIO User Guide. https://www.asam.net/fileadmin/Standards/OpenSCENARIO/QUICK_READ_ASAM_OpenSCENARIO_BS-1-2_User-Guide_V1-0-0.html
- ASAM OpenLABEL. https://www.asam.net/standards/detail/openlabel/
- Apache Iceberg, "Spec." https://iceberg.apache.org/spec/
- OpenTelemetry telemetry schemas. https://opentelemetry.io/docs/specs/otel/schemas/
- OpenLineage object model. https://openlineage.io/docs/spec/object-model/
- ZOPP, "A Framework of Zero-shot Offboard Panoptic Perception for Autonomous Driving." https://arxiv.org/abs/2411.05311
- SALT, "A Flexible Semi-Automatic Labeling Tool for General LiDAR Point Clouds with Cross-Scene Adaptability and 4D Consistency." https://arxiv.org/abs/2503.23980
- OpenUrban3D, "Annotation-Free Open-Vocabulary Semantic Segmentation of Large-Scale Urban Point Clouds." https://arxiv.org/abs/2509.10842
- Waymo, "Safe to Deploy: How We Know The Waymo Driver Is Ready For The Road," 2025-06. https://waymo.com/blog/2025/06/safe-to-deploy/
