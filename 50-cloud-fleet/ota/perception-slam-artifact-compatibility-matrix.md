# Perception-SLAM Artifact Compatibility Matrix

**Last updated:** 2026-05-24

## Purpose

Perception-SLAM releases are not single artifacts. A safe runtime combination includes code, containers, models, TensorRT engines, maps, calibration, route/geofence overlays, parameters, diagnostics configuration, and cloud-side observability schemas. This matrix defines what must be compatible before an artifact can be activated on a vehicle or promoted through OTA rings.

The operating rule is simple: compatibility is proven by a signed manifest and validation evidence, not inferred from file names or "latest" labels.

## MLOps Scale Fit

Compatibility evidence should grow with MLOps authority. A research checkpoint can be compared with a run note; a production fleet artifact needs a signed compatibility manifest that joins model, map, calibration, runtime, semantic taxonomy, telemetry schema, evidence, and rollback.

| MLOps scale | Compatibility posture | Required compatibility artifact | What must not happen |
|---|---|---|---|
| S0 notebook research | Local comparison only | Run note naming code, data, model, and map/calibration assumptions | Result reused without recording incompatible inputs |
| S1 repeatable prototype | Baseline reproducibility | Dataset and environment manifest plus fixed validation script | Baseline silently changes due to data, schema, or preprocessing drift |
| S2 single-product production | Deployable artifact set | Model package manifest, dataset manifest, runtime package test, rollback target | Candidate model reaches shadow/canary with untested map, class order, calibration, or engine |
| S3 fleet and multi-site | Site/ODD compatibility | Per-site rollout manifest with active model/map/calibration/runtime/telemetry IDs and canary evidence | One global artifact set activates across sites with different maps, sensor kits, or ODDs |
| S4 regulated safety-critical | Evidence-locked compatibility | Signed compatibility manifest linked to safety-case claims, replay packs, incident retention, and rollback drill | Behavior authority changes while compatibility evidence is ticket-only, expired, or mutable |
| S5 platform scale | Policy-enforced compatibility | Policy-as-code checks over registry, map, calibration, prompt/evaluator, telemetry, feature/embedding, and deployment services | Shared platform permits a tenant to bypass compatibility or reuse unsupported artifacts |

This is the OTA/SUMS counterpart to `../mlops/mlops-reference-architectures-by-scale.md`, `../mlops/model-registry-artifact-lifecycle-by-scale.md`, `../mlops/mlops-scorecards-and-kpis-by-scale.md`, and `../mlops/secure-artifact-attestation-profile.md`: architecture defines where artifacts live, the registry lifecycle guide defines immutable artifact identity and alias authority, the scorecard defines what blocks release, the attestation profile defines artifact trust, and this matrix defines whether the artifact set can safely activate.

## Compatibility Axes

| Axis | Required metadata | Why it matters |
|---|---|---|
| Vehicle platform | Vehicle type, wheelbase, sensor kit, brake/steer interface, safety controller version | Geometry and actuation assumptions affect free-space and MRC behavior |
| Sensor hardware | Sensor model, serial, firmware, timestamp mode, mounting position, health limits | Models and calibration are sensor-specific |
| Compute/runtime | GPU/accelerator, driver, CUDA, TensorRT, ROS distro, kernel, DDS profile | Engines and latency behavior can change across runtime versions |
| Model | Model ID, training data ID, input/output schema, class ontology, precision, calibration file | Consumers must understand tensors, classes, uncertainty, and thresholds |
| Map | Site, bundle ID, tile IDs, datum, layers, overlays, route graph, expiry | Pose, route, and geofence depend on exact map bundle |
| Calibration | Intrinsics, extrinsics, time offsets, sensor-to-base transform, verification state | Fusion and map alignment fail silently with stale calibration |
| Configuration | ODD limits, monitor thresholds, planner margins, feature flags, diagnostics graph | Config can change behavior as much as code |
| Telemetry schema | OTel schema URL, robotics custom schema, event IDs, units | Dashboards and release gates must not misread fields |
| Artifact trust | Subject digests, signatures, SBOM/provenance, policy result, trusted builder, alias approval | Activation must use the same trusted artifact set that was evaluated |
| Evidence | Test partition, benchmark manifest, shadow/canary results, safety-case claim IDs | SUMS and safety case need reproducible approval evidence |

## Matrix

| Artifact | Compatible with | Block condition | Required evidence |
|---|---|---|---|
| Perception container | ROS distro, message definitions, GPU driver, model runtime, diagnostics graph | Topic/schema mismatch, unresolved dependency, untested DDS/QoS change | CI, SIL replay, interface contract check, SBOM/VEX |
| SLAM/localization container | Map format, TF tree, sensor drivers, calibration, timing stack | Frame/datum change without migration test, timing policy mismatch | Replay ATE/RPE, timing stress, map compatibility test |
| TensorRT engine | GPU architecture, TensorRT/CUDA versions, model hash, precision calibration | Engine built on different accelerator/runtime or stale calibration cache | Engine build attestation, deserialization test, latency report |
| Neural model | Input preprocessing, ontology, uncertainty calibration, runtime thresholds | Class/order/schema change not reflected in consumers | Model card, dataset lineage, calibration and slice metrics |
| Occupancy/free-space model | Grid resolution, unknown semantics, planner contract, protected-zone policy | Unknown/free encoding change or false-free-space gate failure | False-free-space report, OOD/unknown object evaluation |
| Map bundle | Site/route, localization algorithm, calibration, vehicle geometry, overlays | Wrong active map, expired overlay, tile frame mismatch | Map QA report, source traversal provenance, canary metrics |
| Semantic map layer | Source map, tile manifest, taxonomy/class order, unknown/confidence policy, segmentation model, calibration, map-runtime consumers | Semantic layer produced under a different manifest/hash, missing QA evidence, class-order mismatch, or runtime loader contract not validated | Semantic map manifest, per-tile QA, safety-class metrics, calibration/threshold report, Autoware loader smoke test |
| Calibration package | Sensor serials, mounts, firmware, TF tree, vehicle body frame | Applied to wrong vehicle/sensor kit or drift state red | Calibration benchmark report, drift monitor record |
| Runtime config | Code/model/map version set, ODD, monitor thresholds, release ring | Threshold differs from validation without approval | Config schema validation, safety impact record |
| Diagnostics graph | Node names, diagnostic producers, operation modes, latch policy | Missing critical node or changed severity semantics | Diagnostic graph test and alert routing proof |
| Observability schema | On-vehicle telemetry, cloud pipeline, dashboards, alert rules | Breaking schema without dashboard migration | Schema version, migration test, sample event replay |
| Offboard labeler / prompt pack | Label schema, prompt/model/checkpoint, retrieval corpus, projection/calibration hash, reviewer workflow | Labeler output can change datasets, semantic maps, and release evidence without runtime model changes | Labeler registry record, accepted/rejected statistics, reviewer QA, rollback impact |
| Evaluation/replay pack | Scenario IDs, map/runtime compatibility hash, expected metrics, waiver state | A model can be approved against stale or incompatible replay evidence | Replay package manifest, deterministic replay evidence, evidence expiry check |

## Manifest Fields

Use the checked JSON Schema contracts as the narrow machine-readable surface for semantic-map promotion: `../../schemas/semantic-map-manifest.schema.json` covers the semantic layer release manifest and `../../schemas/runtime-map-contract.schema.json` covers the runtime map-loader handoff, with examples under `../../examples/map-contracts/`.

| Field | Requirement |
|---|---|
| `manifest_id` | Immutable ID signed by release authority |
| `vehicle_eligibility` | Vehicle classes, sensor kits, excluded serials, site IDs |
| `artifact_set` | Code, model, engine, source map, semantic layer, taxonomy, calibration, config, telemetry schema, diagnostics graph, runtime map contract, and release-evidence digests |
| `compatibility_hash` | Hash over the full version set, not only individual artifacts |
| `semantic_map_contract` | Semantic layer ID, taxonomy ID/hash, model/weights digest, calibration ID, confidence threshold file, QA report ID, source-map hash, tile-manifest hash, runtime export contract version |
| `runtime_map_contract` | Autoware map contract version, `map_projector_info.yaml` hash, `pointcloud_map_metadata.yaml` hash, Lanelet2 loader evidence ID, pointcloud loader evidence ID, dynamic-load replay evidence ID if enabled |
| `activation_preconditions` | Parked/mission-complete state, battery, network, operator acknowledgement if required |
| `rollback_set` | Previous compatible artifact set and cache state |
| `evidence_ids` | CI, replay, calibration, map QA, safety-case, security, and canary evidence |
| `attestation_ids` | Digest-bound signatures, SBOMs, SLSA/in-toto provenance, vulnerability disposition, model/export/map-QA attestations, and policy results as defined in `../mlops/secure-artifact-attestation-profile.md` |
| `mlops_scale` | S0-S5 authority level for the artifact set, because the required evidence and approvers differ by scale |
| `labeler_artifacts` | Offboard labeler, prompt, evaluator, retrieval, and candidate-label bundle IDs when any of them affected training, semantic maps, or release evidence |
| `expiry` | Maximum activation window and sunset date for temporary overlays/configs |
| `signatures` | Uptane/TUF metadata signatures plus build provenance attestations |

## Release Gates

| Gate | Pass condition | Blocks |
|---|---|---|
| C0 inventory | Fleet reports active and candidate artifact IDs with digests | Unknown active version on target vehicle |
| C1 cryptographic trust | Package signatures, metadata, and provenance verify | Unsigned package, expired metadata, failed SLSA provenance check |
| C2 compatibility | Full compatibility matrix passes for vehicle/site/cohort; semantic map `manifest_id` and `compatibility_hash` match all evidence packets | Any required axis unresolved or evidence produced under a different manifest |
| C3 validation | Required benchmark, replay, calibration, map, and runtime evidence attached | Evidence missing or produced under a different manifest |
| C4 activation safety | Preconditions and rollback cache verified on representative vehicle | Activation during mission or no known-good rollback |
| C5 canary health | Canary metrics remain within baseline envelope for hold period | Localization, free-space, OOD, latency, intervention, or support-ticket regression |
| C6 closure | Post-deployment report links active manifests and residual issues | Unaccounted vehicles or unresolved safety alerts |

## Rollback and Quarantine

| Trigger | Immediate action | Follow-up |
|---|---|---|
| Engine deserialization failure | Keep previous engine and mark candidate incompatible | Rebuild engine for exact runtime and hardware |
| Map/calibration mismatch | Block dispatch for affected vehicle/site | Reissue compatible map or recalibrate vehicle |
| Semantic layer mismatch | Keep previous map/semantic bundle and mark candidate incompatible | Rebuild semantic layer or republish manifest with matching taxonomy/model/calibration/evidence set |
| Runtime map-load failure | Keep previous runtime map contract and block candidate activation | Regenerate Autoware export cells/metadata/projection and rerun loader smoke/replay tests |
| Unknown schema in telemetry | Freeze promotion and mark evidence invalid | Backfill parser or republish telemetry schema |
| Canary false-free-space alert | Stop rollout and quarantine candidate manifest | Preserve logs, replay event, update safety case |
| Security metadata failure | Abort activation and revoke affected metadata if needed | Incident review and key-rotation assessment |

## Governance Notes

UNECE R156 and ISO 24089 are road-vehicle software-update references, but the SUMS pattern applies directly to non-road airside fleets because behavior can change through software, maps, models, calibration, and configuration. Uptane protects OTA delivery against rollback, freeze, mix-and-match, and arbitrary software attacks, but it does not replace build provenance or safety validation. Use SLSA provenance for the build chain and the compatibility manifest for runtime activation.

## Related Repository Docs

- `50-cloud-fleet/ota/software-update-management-system-ops.md`
- `50-cloud-fleet/ota/ota-fleet-management.md`
- `40-runtime-systems/software-operations/on-vehicle-supply-chain-runtime-security.md`
- `40-runtime-systems/ml-deployment/production-ml-deployment.md`
- `50-cloud-fleet/mlops/mlops-reference-architectures-by-scale.md`
- `50-cloud-fleet/mlops/model-registry-artifact-lifecycle-by-scale.md`
- `50-cloud-fleet/mlops/mlops-scorecards-and-kpis-by-scale.md`
- `50-cloud-fleet/mlops/secure-artifact-attestation-profile.md`
- `50-cloud-fleet/mlops/model-governance-release-evidence.md`
- `50-cloud-fleet/observability/slam-timing-health-dashboard.md`
- `60-safety-validation/safety-case/safety-case-evidence-traceability.md`

## Sources

- UNECE UN Regulation No. 156, software update and SUMS: https://unece.org/transport/documents/2021/03/standards/un-regulation-no-156-software-update-and-software-update
- Uptane Standard 2.1.0: https://uptane.org/docs/2.1.0/standard/uptane-standard
- Uptane Standard 2.0.0: https://uptane.org/docs/2.0.0/standard/uptane-standard
- SLSA specification v1.2: https://slsa.dev/spec/latest/
- MLflow Model Registry workflows: https://www.mlflow.org/docs/latest/ml/model-registry/workflow/
- Amazon SageMaker AI Model Registry: https://docs.aws.amazon.com/sagemaker/latest/dg/model-registry-models.html
- ISO 24089:2023, Road vehicles - Software update engineering: https://www.iso.org/standard/77796.html
- Autoware perception component interfaces: https://autowarefoundation.github.io/autoware-documentation/main/design/autoware-architecture-v1/interfaces/components/perception/
- OpenTelemetry telemetry schemas: https://opentelemetry.io/docs/specs/otel/schemas/
