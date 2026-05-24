# Model Registry and Artifact Lifecycle by Scale

**Last updated:** 2026-05-24

A model registry is the identity and lifecycle system for release-affecting ML artifacts. In autonomy, that scope is broader than model weights: it includes ONNX/TensorRT engines, containers, calibration-aware packages, semantic maps, map-hygiene layers, prompt packs, offboard labelers, evaluator packs, replay packs, feature/embedding snapshots, adapter weights, rollback bundles, and signed evidence records.

Use this page to design registry semantics across S0-S5 MLOps. Use `model-governance-release-evidence.md` for claims-and-evidence release packets, `secure-artifact-attestation-profile.md` for signatures and provenance, `evaluation-platform-replay-gates-by-scale.md` for evaluation/replay gates, `serving-inference-operations-by-scale.md` for serving manifests, endpoint traffic policy, batch/online/edge scope, and rollback load paths, `pipeline-orchestration-release-workflows-by-scale.md` for artifact-producing workflows, and `../ota/perception-slam-artifact-compatibility-matrix.md` for the artifact-set compatibility manifest.

The core rule is: **aliases are authority, not labels.** Moving `candidate`, `shadow`, `champion`, `rollback`, `site_champion`, or `quarantined` changes what downstream systems may load, evaluate, deploy, mine, or trust. Alias movement should therefore be gated by evidence, policy, owner, rollback state, and scope.

---

## Registry Scope

| Artifact family | Registry responsibility | Why it matters |
|---|---|---|
| Model weights/checkpoint | Immutable version, source run, dataset/split lineage, metric evidence, output digest | Prevents ambiguous "latest model" handoffs |
| Runtime package | ONNX/TensorRT engine, container digest, class order, hardware target, dependency lock | Prevents offline checkpoint approval from bypassing deployability checks |
| Serving endpoint or batch service | Service manifest, traffic policy, input/output contract, autoscaling, telemetry, rollback route | Prevents a valid artifact from being served to the wrong client, site, or ODD cell |
| Adapter or LoRA | Parent model, site/task scope, training data, compatibility, rollback pair | Prevents local adapters from becoming invisible production variants |
| Semantic map or map layer | Map bundle, source-map acceptance, semantic taxonomy, map-hygiene layer, release state | Prevents wrong map truth from contaminating runtime or training exports |
| Calibration-aware bundle | Sensor kit, calibration package, time-sync assumptions, hardware cohort | Prevents model/map approval from moving across incompatible vehicles |
| Prompt/labeler/evaluator pack | Prompt text, model ID, retrieval corpus, thresholds, judge/evaluator version, reviewer workflow | Prevents generated labels or scores from silently changing release evidence |
| Replay/evaluation pack | Scenario suite, evaluator container, metric spec, expected behavior, waiver state | Prevents release gates from drifting without version identity |
| Feature/embedding snapshot | Source corpus, feature code, embedding model, index build, point-in-time proof, deletion state | Prevents stale retrieval or feature leakage from affecting training/eval |
| Evidence/attestation bundle | SBOM, provenance, signature, policy result, approval, retention class | Proves the artifact was built and approved through the trusted path |

At S2+, registry identity should be immutable even when aliases are mutable. At S4+, registry records should be retained with evidence for the audit and incident window.

---

## Scale Ladder

| MLOps scale | Registry posture | Minimum control | Anti-pattern to block |
|---|---|---|---|
| S0 notebook research | File path plus run note | Commit hash, config, data pointer, metric output, checkpoint hash when reused | Reusing an unlabeled checkpoint as a baseline |
| S1 repeatable prototype | Lightweight model/artifact registry or DVC/W&B/MLflow artifact entry | Immutable version, baseline alias, dataset/split link, evaluator version | `latest` becomes the only reference |
| S2 production product | Product registry with controlled aliases | `candidate`, `shadow`, `champion`, `rollback`, evidence links, runtime package, approval metadata | Training job directly moves production alias |
| S3 fleet and multi-site | Site/ODD-scoped registry lifecycle | Site aliases, release channels, artifact-set compatibility, local holdouts, canary scope | One global `champion` hides local site regressions |
| S4 regulated safety-critical | Evidence-locked registry | Dual approval, safety-case links, signed attestations, waiver expiry, rollback drill, retention hold | Alias movement without immutable evidence and reportability context |
| S5 platform scale | Multi-tenant registry service | Namespaces, policy-as-code, audit API, lifecycle SLOs, exception workflow, cross-product inventory | Teams fork registries or bypass shared alias policy |

The same repository can contain artifacts at different scales. A research detector can remain S1 while a semantic-map publisher is S4 and a prompt-based offboard labeler is S5 because it feeds multiple product teams.

---

## Lifecycle States

| State | Meaning | Allowed next states |
|---|---|---|
| `scratch` | Local experiment artifact with no reuse guarantee | `preserved`, `deprecated` |
| `preserved` | Archived for reproducibility or comparison | `baseline_candidate`, `deprecated` |
| `baseline_candidate` | Proposed as comparable baseline | `baseline`, `rejected`, `deprecated` |
| `baseline` | Accepted comparison point | `candidate`, `deprecated` |
| `candidate` | Reviewable artifact with complete registry identity | `shadow`, `rejected`, `quarantined` |
| `shadow` | Runs without behavior authority | `site_canary`, `champion`, `rejected`, `quarantined` |
| `site_canary` | Limited authority in a named ODD cell | `site_champion`, `restricted`, `rollback`, `quarantined` |
| `site_champion` | Approved for one ODD cell | `expanded`, `restricted`, `rollback`, `deprecated` |
| `champion` | Approved default for a defined product scope | `expanded`, `rollback`, `deprecated` |
| `restricted` | Approved with exclusions or mitigations | `champion`, `rollback`, `deprecated` |
| `rollback` | Known-good artifact set retained for recovery | `champion`, `deprecated` after rollback window |
| `quarantined` | Artifact is unsafe, incompatible, stale, or under incident review | `rejected`, `repaired_candidate`, `deprecated` |
| `deprecated` | Not used for new release decisions | Retention or deletion after policy allows |

Do not rely only on tool-native states. MLflow aliases, W&B aliases, SageMaker approval statuses, Vertex model aliases, and Kubeflow registry metadata can support lifecycle control, but the autonomy program still needs its own authority semantics and ODD scope.

---

## Alias Policy

| Alias | Required evidence before assignment | Scope rule |
|---|---|---|
| `baseline` | Frozen split, evaluator version, reproducible run, limitation note | Model family or task |
| `candidate` | Run manifest, dataset/split IDs, output digest, evaluation manifest, artifact record | Product or artifact family |
| `shadow` | Runtime package smoke, replay smoke, telemetry schema, rollback target | Site/vehicle cohort if live |
| `site_canary` | ODD-cell manifest, local holdout, replay, monitor thresholds, on-call owner | One ODD cell only |
| `site_champion` | Site-sliced release decision, delayed-label review, rollback proof | Site, route, task, map/calibration state |
| `champion` | Release packet, approver record, compatibility manifest, attestations, rollback target | Explicit product scope |
| `rollback` | Previous compatible artifact set, cache state, load test, retention hold | Same runtime/map/schema scope as active release |
| `quarantined` | Incident, drift, compatibility, evidence, or security trigger | Blocks loading except for investigation |
| `deprecated` | Replacement, end-of-life decision, retention policy, consumers notified | Cannot be target of new release |

Avoid aliases that imply authority without scope. `production` is ambiguous unless the registry record names product, site, task, runtime, map, calibration, telemetry schema, and ODD.

---

## Registry Record Contract

Every release-relevant artifact should have a registry record that can be queried by humans and machines.

| Field | Required contents |
|---|---|
| `artifact_id` | Immutable ID, version, type, digest, storage URI, owner |
| `artifact_family` | Model, adapter, engine, container, map, calibration bundle, prompt pack, evaluator pack, replay pack, feature snapshot, evidence bundle |
| `authority_state` | Lifecycle state and allowed-use scope |
| `producer` | Workflow ID, code commit, container digest, builder identity, dirty-state disposition |
| `inputs` | Dataset, split, feature/embedding snapshot, map, calibration, taxonomy, prompt, evaluator, replay, or parent-model IDs |
| `evaluation` | Evaluation manifest IDs, metric spec, replay suite, runtime smoke, known failures, waiver state |
| `compatibility` | Model/map/calibration/runtime/telemetry/taxonomy compatibility hash and rollback set |
| `deployment_scope` | Product, site, route, task, vehicle kit, weather/lighting, release channel, data residency |
| `security` | Signature, SBOM, provenance, vulnerability disposition, policy result |
| `governance` | Approvers, release packet, safety-case claim IDs, exception/waiver owner, expiry |
| `retention` | Evidence class, legal/safety hold, deletion eligibility, consumer notification state |
| `lineage_queries` | Reverse links to active deployments, training data consumers, labels, maps, incidents, and monitoring events |

At S5, the registry should expose an audit API that answers: "Which artifact versions can influence this vehicle/site right now?" and "Which data, labelers, evaluators, maps, and prompts influenced this artifact?"

---

## Architecture Options

| Registry architecture | Advantages | Disadvantages | Best use |
|---|---|---|---|
| Folder plus Markdown release note | Cheap, transparent, no service dependency | Weak queryability, alias drift, poor multi-user control | S0 exploration only |
| Git/DVC artifact manifest | Reproducible, reviewable, good for data snapshots | Not ideal for mutable deployment aliases or high-volume artifact metadata | S1 baselines and offline artifacts |
| MLflow Model Registry | Strong experiment/run integration, aliases/tags, model loading by alias | Needs extra metadata for maps, calibration, safety evidence, and non-model artifacts | S1-S3 model lifecycle and small platform teams |
| W&B Registry/artifacts | Strong artifact lineage and alias workflows, good UX for teams | Registry authority and safety gates need external policy integration | S1-S3 research-to-product handoffs |
| SageMaker Model Registry | Managed model groups, versions, approval status, deployment integration | AWS coupling and custom autonomy metadata need disciplined extensions | AWS-native S2-S4 product lanes |
| Vertex AI Model Registry | Managed model versioning, aliases, evaluation/deploy/test integration | GCP coupling and limited fit for custom map/replay artifacts | GCP-native S2-S4 model lifecycles |
| Kubeflow Model Registry | Kubernetes-native platform component, open-source extensibility | Requires platform ownership and metadata discipline | S3-S5 self-hosted platform teams |
| OCI/artifact registry plus metadata DB | Digest-native, works for containers, engines, SBOMs, arbitrary artifacts | Needs custom lifecycle UI/API and release semantics | Runtime packages, signed artifacts, edge deployment |
| Custom autonomy registry | Can represent model/map/calibration/replay/site semantics exactly | Expensive to build and easy to under-maintain | S4-S5 when standard registries cannot express safety scope |

A pragmatic architecture is often split: MLflow/W&B/SageMaker/Vertex/Kubeflow for model versions, OCI registry for runtime containers and engines, data catalog for datasets/features, and a thin autonomy artifact-set registry that binds them into one compatibility and release record.

---

## Artifact-Set Registry

Autonomy releases are artifact sets, not single models.

| Artifact-set member | Compatibility question |
|---|---|
| Model or adapter | Was it trained and evaluated for this taxonomy, ODD, and runtime package? |
| Runtime engine/container | Does the deployed artifact match the evaluated package and target hardware? |
| Serving service manifest | Does the endpoint, batch job, traffic split, input/output schema, telemetry, and scaling policy match the approved scope? |
| Semantic map/map layer | Does the map state, release-state layer, and taxonomy match the model contract? |
| Calibration package | Does the sensor kit and time-sync state match training/eval/replay evidence? |
| Telemetry schema | Can monitoring, canary, and incident replay interpret outputs correctly? |
| Prompt/labeler/evaluator pack | Did any generated label, score, or report affect the artifact or release decision? |
| Replay/evaluation pack | Did the artifact pass the exact scenario and metric suite required for the scope? |
| Rollback set | Can the previous known-good set still load under active runtime and schema? |

The registry should store both member IDs and a compatibility hash over the member set. If any member changes, the release evidence must either be invalidated or explicitly reviewed as compatible.

---

## Deletion, Retention, and Rebuild

| Artifact state | Retention rule |
|---|---|
| Scratch artifact | Delete after short TTL unless referenced by preserved run note |
| Baseline artifact | Retain while comparisons depend on it |
| Candidate artifact | Retain until rejected and no incident/review depends on it |
| Shadow/canary artifact | Retain through delayed-label window and rollback window |
| Champion/site champion | Retain while deployed plus evidence/incident window |
| Rollback artifact | Retain and periodically load-test until no active deployment depends on it |
| Safety-evidence artifact | Retain under legal/safety policy; do not garbage-collect from cost-only rules |
| Quarantined artifact | Retain until root cause, consumers, and corrective action are closed |

Deletion should be dependency-aware. A model can be deleted only if no active deployment, replay result, safety case, label batch, map export, incident, or rollback set depends on it.

---

## Managed-Site and Semantic-Map Rules

For airside, port, yard, campus, warehouse, construction, mine, and urban-district mapping applications:

- Registry aliases must be scoped by ODD cell when local map state, route/task, weather, or vehicle kit changes behavior.
- Semantic maps require registry records for source-map acceptance, map-hygiene layers, release-state labels, taxonomy version, projection/calibration evidence, and map-publication decision.
- LiDAR-only, LiDAR-image fusion, image-distilled, and open-vocabulary/offboard labeler routes must register different artifact dependencies. A LiDAR-only runtime model cannot inherit an image-dependent evaluation claim unless the dependency is explicitly train-time only.
- Stationary people, parked movable assets, cones, pallets, FOD candidates, construction barriers, and temporary work-zone objects must remain registry-visible as removal, quarantine, or release-state decisions when they influence map publication or training export.
- Local adapters and thresholds should be first-class registry artifacts. A site-specific threshold file can change safety behavior as much as a model checkpoint.

The registry is therefore also a map and label governance system. It must prevent a reviewed map truth, candidate label, removed dynamic residual, and release-approved static point from collapsing into the same unqualified artifact.

---

## Failure Modes

| Failure mode | Consequence | Control |
|---|---|---|
| Mutable `latest` drives deployment | Fleet loads an unreviewed artifact | Load by immutable version or gated alias only |
| Alias has no ODD scope | One site approval becomes global approval | Require site/task/map/calibration scope on authority aliases |
| Registry lacks runtime package identity | Checkpoint passes but deployed engine fails | Register model package, engine/container, and compatibility hash |
| Registry lacks map/calibration identity | Model runs against unseen geometry or sensor state | Bind artifact set to map and calibration package |
| Rollback artifact expires | Recovery requires emergency rebuild | Load-test and retain rollback sets through active window |
| Quarantined artifact remains consumable | Bad data/model/map continues to affect training or evidence | Registry policy blocks downstream use by state |
| Foundation-model labeler is not registered | Prompt/model drift changes labels invisibly | Register prompt/model/retrieval/threshold/reviewer state |
| Registry is used as evidence store only | Release packets exist but no deployment control | Enforce aliases and deployment admission against registry state |
| Registry becomes too slow | Teams bypass it with local artifacts | Platform SLOs, self-service templates, and narrow mandatory fields |

---

## Related Pages

- `mlops-scale-research-scope.md` - MLOps maturity ladder and lifecycle controls.
- `mlops-reference-architectures-by-scale.md` - registry placement, durable interfaces, and architecture patterns.
- `mlops-migration-checklist-by-scale.md` - triggers for moving from local artifacts to managed registry services.
- `mlops-scorecards-and-kpis-by-scale.md` - registry, release, rollback, and evidence KPIs.
- `model-governance-release-evidence.md` - claims-and-evidence release packets and approval ownership.
- `evaluation-platform-replay-gates-by-scale.md` - evaluation manifests and replay/runtime gates before alias movement.
- `serving-inference-operations-by-scale.md` - serving manifests, traffic policy, endpoint readiness, autoscaling, ODD-cell rollout, and rollback.
- `platform-sre-reliability-by-scale.md` - registry SLOs, alias audit durability, backup/restore, DR, tenant isolation, and platform incident controls.
- `secure-artifact-attestation-profile.md` - signing, SBOM, provenance, and policy verification.
- `pipeline-orchestration-release-workflows-by-scale.md` - workflow states that produce and promote artifacts.
- `site-sliced-release-evidence-by-scale.md` - ODD-cell release manifests and site-scoped aliases.
- `offboard-labeler-registry-by-scale.md` - prompt, labeler, evaluator, threshold, and reviewer artifact governance.
- `feature-embedding-store-ops-by-scale.md` - feature/vector index identity and deletion propagation.
- `../ota/perception-slam-artifact-compatibility-matrix.md` - artifact-set compatibility manifest.
- `../ota/software-update-management-system-ops.md` - OTA/SUMS update and rollback controls.
- `../../40-runtime-systems/ml-deployment/production-ml-deployment.md` - production loading, canary, monitoring, and rollback.
- `../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md` - semantic-map release-state and artifact dependencies.

## Sources

- MLflow, "Model Registry Workflows." https://www.mlflow.org/docs/latest/ml/model-registry/workflow/
- Weights & Biases, "Reference an artifact version with aliases." https://docs.wandb.ai/models/registry/aliases
- Google Cloud, "Model versioning with Model Registry." https://cloud.google.com/vertex-ai/docs/model-registry/versioning
- Amazon SageMaker AI, "Model Registry Models, Model Versions, and Model Groups." https://docs.aws.amazon.com/sagemaker/latest/dg/model-registry-models.html
- Amazon SageMaker AI, "Update the Approval Status of a Model." https://docs.aws.amazon.com/sagemaker/latest/dg/model-registry-approve.html
- Kubeflow, "Kubeflow Model Registry." https://www.kubeflow.org/docs/components/model-registry/
- KServe, "Serving Runtime." https://kserve.github.io/website/docs/concepts/resources/servingruntime
- Google Cloud, "Deploy a model to an endpoint." https://cloud.google.com/vertex-ai/docs/general/deployment
- OCI Distribution Specification. https://github.com/opencontainers/distribution-spec
- SLSA Specification. https://slsa.dev/spec/latest/
