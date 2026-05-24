# MLOps Reference Architectures by Scale

**Last updated:** 2026-05-24

This page turns the MLOps scale ladder into concrete architecture choices. Use it after `mlops-scale-research-scope.md` has identified the required maturity level, and before buying/building tooling. The core decision is not "which MLOps platform is best?" It is which artifacts, interfaces, owners, and promotion gates must be centralized at the current scale.

The architecture should grow by contract first, platform second. A small team can run on scripts, manifests, and a lightweight tracker if the artifact boundaries are disciplined. A large platform still fails if it centralizes dashboards while leaving labels, dataset snapshots, registry aliases, evaluation packs, and rollback evidence ambiguous.

Pair each architecture with the scorecard in `mlops-scorecards-and-kpis-by-scale.md`. The architecture defines where artifacts and decisions live; the scorecard defines whether those artifacts are reproducible, release-eligible, observable, rollback-ready, and cost-controlled at the current scale. Use `mlops-migration-checklist-by-scale.md` before moving an artifact family from one scale to the next. Pair feature and vector-search decisions with `feature-embedding-store-ops-by-scale.md` so S5 tooling is not introduced before S1-S2 data contracts exist, and pair release-affecting artifacts with `secure-artifact-attestation-profile.md` so signatures, SBOMs, provenance, and alias policy are added at the right authority level.

---

## Scale Blueprints

| Scale | Architecture shape | Local components | Shared components | Promotion authority | Main migration risk |
|---|---|---|---|---|---|
| S0 notebook research | Single-owner experiment loop | Notebook/script, local data pointer, config file, result folder | Git repository and raw-data location | Research owner decides whether a result is worth preserving | Result becomes tribal knowledge with no rebuild path |
| S1 repeatable prototype | Reproducible baseline lane | Docker image, deterministic config, DVC/object snapshot, validation script | Experiment tracker, baseline metric table, frozen split manifest | Research lead accepts a baseline | Demo data leaks into release evaluation later |
| S2 single-product production | Product release lane | Training DAG, export script, offline eval, package smoke test | Model registry, dataset manifest, release packet, rollback artifact | Model/data/runtime/release owners move candidate aliases | Training completion is mistaken for release approval |
| S3 fleet and multi-site | Site-sliced fleet flywheel | Site holdouts, local trigger queues, edge data triage, site canaries | Data catalog, active-learning queue, fleet telemetry, release channels | ODD-cell release owner expands rollout | One global champion hides local airport, yard, or warehouse regressions |
| S4 regulated safety-critical | Evidence-controlled change system | Hazard replay packs, safety monitor traces, incident evidence, rollback drill | Immutable evidence store, safety-case links, approver records, retention hold | Safety owner and release manager approve behavior authority | Evidence exists in tickets but not in immutable release artifacts |
| S5 platform scale | Multi-tenant ML platform | Product-specific model code, task-specific evals, site adapters | Data/model/eval registry, feature/embedding service, GPU scheduler, policy-as-code, cost/SLO dashboards | Platform policy plus product release authority | Platform becomes bypassed because it slows product teams or misses autonomy-specific metadata |

The same fleet can occupy multiple scales at once. A perception research branch may be S1, the deployed detector may be S3, the semantic-map label export may need S4 evidence, and a foundation-model labeler platform may be S5. Architecture decisions should follow the artifact's authority, not the team org chart.

---

## Minimum Viable Stack

| Capability | S0-S1 minimum | S2-S3 minimum | S4-S5 minimum |
|---|---|---|---|
| Dataset identity | File manifest, source path, split hash | Immutable dataset snapshot, data product ID, approved-use state | Cataloged lineage graph with retention, access class, and evidence lock |
| Experiment tracking | Run note plus commit/config | Tracker run linked to dataset, code, seed, hardware, and metric report | Organization eval warehouse with audit export |
| Label operations | Manual labels and instructions | Versioned annotation workflow, QA sampling, allowed-use state | Policy-enforced promotion states, expert review, vendor/privacy controls |
| Orchestration | Script, Makefile, or CI job | Airflow/Argo/Kubeflow/managed pipeline for train-eval-package | Multi-tenant pipeline with quotas, lineage, policy checks, and evidence capture |
| Model registry | Checkpoint path plus release note | Immutable version, aliases, approval metadata, rollback target, artifact digest | Registry integrated with policy, signing, SBOM, SLSA/in-toto provenance, tenant isolation, and audit logs |
| Evaluation | Validation script and frozen split | Slice metrics, replay, calibration, runtime smoke, shadow/canary report | Safety-case-linked claim/evidence table, scenario catalog, waiver expiry |
| Deployment | Manual batch or offline artifact | ONNX/TensorRT/container bundle, compatibility manifest, canary channel | OTA/SUMS integration, policy gates, rollback drill, reportability evidence |
| Monitoring | Manual plots and failure notes | Runtime health, drift proxies, delayed labels, incident hooks | Fleet SLOs, causal attribution, alert quality, suppression audit, compliance export |
| Cost and capacity | Per-run note | Job owner, GPU queue, timeout, cost tag | FinOps allocation, reserved incident capacity, utilization SLO, chargeback |

Minimum viable does not mean minimal governance. At S2+, the smallest acceptable production stack is one that can answer: what changed, what data justified it, where is it allowed to run, how will we know it failed, and how do we roll back?

---

## Centralize, Decentralize, or Delay

| Decision area | Centralize early | Keep decentralized | Delay until trigger |
|---|---|---|---|
| Schemas and contracts | Label taxonomy, telemetry schema, dataset manifest fields, model package manifest, map/model/calibration compatibility IDs | Task-specific feature engineering and local experiment configs | Full schema registry UI until multiple producers/consumers exist |
| Data storage | Immutable raw-data pointer and retention class | Small research samples and temporary scratch data | Full lakehouse/catalog until release-relevant data products multiply |
| Evaluation | Release metrics, safety slices, scenario IDs, replay package format | Exploratory notebooks and model-debug visualizations | Shared eval service until teams repeatedly duplicate evaluation logic |
| Model registry | Immutable model ID, alias semantics, rollback target, approval metadata | Research checkpoints not reused outside a branch | Multi-tenant registry automation until several product lines share releases |
| Compute | Container base images and hardware class tags | Local prototyping and one-off sweeps | GPU scheduler/chargeback until contention or cost becomes a real bottleneck |
| Labeling | Taxonomy, instructions, QA states, accepted/rejected provenance | Local candidate discovery and failure analysis | Vendor marketplace and workflow engine until annotation volume requires it |
| Monitoring | Common model/map/calibration/runtime identifiers in telemetry | Product-specific dashboards and debug panels | Central alert platform until incidents cross teams or sites |
| Governance | Owner fields, evidence IDs, release decision records | Review meeting format and local triage rituals | Policy-as-code until manual enforcement becomes the bottleneck |

The practical pattern is "centralized identifiers, decentralized iteration." Let teams experiment locally, but force every artifact that can influence release to cross the same typed interfaces.

---

## Interfaces That Must Survive Scale

These interfaces should exist before the platform becomes large. They can begin as JSON or Markdown manifests and later move into services.

| Interface | Required fields | Consumed by |
|---|---|---|
| Dataset manifest | dataset ID, raw sources, split ID, label schema, release-state label schema, access class, retention class, quality report | training, evaluation, privacy, safety case |
| Training run manifest | code commit, dependency lock, config, seed, hardware class, dataset snapshot, augmentation policy, output model hash | model registry, experiment tracking, reproducibility review |
| Model package manifest | model version, ONNX/TensorRT/container hashes, class order, calibration dependencies, map/schema compatibility, hardware target | runtime deployment, OTA/SUMS, rollback |
| Compatibility manifest | model, map, calibration, runtime, telemetry, semantic taxonomy, labeler/prompt/evaluator dependencies, MLOps scale, rollback set | OTA/SUMS, release review, safety case, incident response |
| Evaluation report | metric version, aggregate and slice metrics, confidence intervals, replay package IDs, known failures, waiver state | release review, safety validation, monitoring thresholds |
| Deployment manifest | model alias, runtime container, map bundle, calibration package, vehicle/site/ODD scope, rollout cohort, rollback artifact | fleet deployment, operations, incident response |
| Monitoring event schema | model/map/calibration/runtime IDs, site, route, ODD cell, input quality, output quality, latency, intervention/disagreement fields | fleet observability, active learning, incident triage |
| Incident evidence link | event ID, active artifacts, logs/clips, replay scenario, safety monitor state, containment action, corrective action | governance, safety case, post-release learning |
| Foundation-model artifact manifest | prompt/model/checkpoint, retrieval corpus, tool permissions, decoding policy, trace bundle, reviewer disposition | label operations, evaluator governance, safety review |
| Artifact attestation manifest | subject digest, artifact type, producer identity, build provenance, SBOM/eval/map-QA predicate, policy result, allowed scope, rollback target | registry, OTA/SUMS, Kubernetes/admission policy, safety case, audit |

If any of these interfaces are missing at S2+, scale will produce hidden coupling. The symptom is familiar: a model passes offline tests, but nobody can prove which data, labeler, map, calibration, runtime, or prompt artifact produced the behavior.

---

## Reference Architecture Patterns

### S0-S1: Research and Prototype Lane

- Local data sample with a manifest and fixed split.
- Git-tracked config and run script.
- Docker or locked environment file.
- Lightweight experiment tracker or committed run notes.
- Validation script that emits a deterministic metric table.
- Explicit note that artifacts are not release eligible.

Best use: feasibility, ablations, early dataset discovery, model comparison.

Avoid: production registry aliases, shared feature stores, continuous retraining, and complex orchestration before the baseline can be rerun.

### S2: Single-Product Production Lane

- Curated training and evaluation snapshots with quality reports.
- Training DAG that produces a candidate checkpoint and provenance.
- Evaluation lane with slice metrics, replay smoke, calibration/OOD checks, and runtime package smoke.
- Registry aliases: `candidate`, `shadow`, `champion`, `rollback`.
- Release packet that links model, data, runtime, map, calibration, evaluation, and rollback.
- Canary or shadow deployment channel with explicit exit criteria.

Best use: first deployable model, offline semantic-map segmenter, production batch labeler, or edge detector that affects operations.

Avoid: training job directly moving `champion`, mutable bucket prefixes feeding release models, and release decisions based only on aggregate metrics.

### S3: Fleet and Multi-Site Lane

- Site/ODD partitions in data catalog and holdout sets.
- On-vehicle triage and selective upload with trigger budgets.
- Active-learning queues separated by site, route, weather, vehicle hardware, map state, and safety slice.
- Replay/scenario mining with promotion from incident to regression case.
- Canary by ODD cell, not only by fleet percentage.
- Monitoring joins model, map, calibration, runtime, and telemetry schema IDs.

Best use: learning from operations while controlling blast radius across airports, yards, campuses, warehouses, and logistics districts.

Avoid: one global champion for every site, one undifferentiated label budget, and dashboards that cannot separate map, calibration, runtime, and model regressions.

### S4: Regulated Safety-Critical Lane

- Immutable evidence snapshots with retention hold.
- Claim/evidence tables tied to safety-case claims.
- Expert-reviewed labels and hazard scenarios.
- Waiver owner, expiry, and operational mitigation for every unresolved regression.
- Rollback drill and incident response runbook linked to the release.
- Dual approval where behavior authority changes.

Best use: model, map, planner, or labeler changes that can affect people, aircraft, protected zones, false-free-space, or compliance claims.

Avoid: metric-only approval, expired evidence, ticket-only approval records, unversioned prompt packs, and online learning without controlled gates.

### S5: Platform Lane

- Multi-tenant data/model/eval registry with policy-as-code.
- Shared GPU scheduler with quotas, priority lanes, cache policy, cost attribution, and `gpu-queueing-finops-by-scale.md` unit economics.
- Standardized feature/embedding service only where reuse justifies it.
- Shared evaluation platform with product-specific adapters.
- Audit API for model, data, prompt, evaluator, map, calibration, deployment artifacts, and digest-bound attestations.
- Platform SLOs covering usability, latency, queue time, cost, evidence completeness, and alert quality.

Best use: many teams, products, sites, model families, and foundation-model tools sharing data and compute.

Avoid: platform mandates that ignore autonomy-specific metadata, centralized queues that block incident response, and self-service tools that allow unsupported release bypasses.

---

## Migration Sequence

| Trigger | Add next | Do not migrate first |
|---|---|---|
| A result must be rerun by another engineer | Experiment tracker, dataset snapshot, container, validation script | Kubernetes or shared GPU platform |
| A model reaches an operator, customer, vehicle, or map release | Registry aliases, release packet, runtime compatibility, rollback artifact | Automated continuous deployment |
| Multiple sites show different failures | Site/ODD slices, local holdouts, canary channels, trigger budgets | One global model gate |
| Incidents need root-cause across model/map/runtime/calibration | Common artifact IDs in telemetry and incident evidence link | New dashboards without schema fixes |
| Label volume exceeds reviewer capacity | Label workflow states, QA sampling, auto-label provenance, budget metrics | More auto-labeling without allowed-use controls |
| Many teams contend for GPUs | Shared queue, image cache, quotas, owner tags, unit-cost metrics | Multi-cloud abstraction before capacity policy |
| Foundation models influence labels, evals, incidents, or safety prose | Prompt/model/retrieval registry, trace capture, calibrated judge evals | Letting assistants write release truth |

Architectures scale cleanly when each migration preserves the old interface. For example, a local JSON dataset manifest can become a catalog entry later if the fields are already correct. A local run note can become a registry metadata record if it already names code, data, config, hardware, and metrics.

The checklist companion (`mlops-migration-checklist-by-scale.md`) turns this table into explicit S0->S1, S1->S2, S2->S3, S3->S4, and S4->S5 gates, including migration evidence packets and 30/60/90-day rollout plans.

---

## Airside and Managed-Site Reference Target

For a 5-20 vehicle airside, port, yard, campus, or warehouse deployment, the practical target is **S2-S3 with selective S4 gates**:

- S2 for deployable perception, map-segmentation, labeler, and runtime packages.
- S3 for site-sliced data mining, active learning, canary by ODD cell, fleet observability, and `site-sliced-release-evidence-by-scale.md` release manifests.
- S4 for releases that affect aircraft/personnel proximity, false-free-space, FOD, map publication, semantic-map training exports, or regulatory evidence.
- S5 only for shared foundation-model tooling, cross-product data catalogs, large GPU scheduling, or multi-team platform services once reuse pressure is real.

The minimum architecture should therefore include registry-backed release packets, immutable dataset snapshots, map/model/calibration compatibility manifests, trigger-based data collection, site holdouts, replay packages, and explicit rollback. Feature stores, federated learning, and multi-tenant platform services are optional until cross-site reuse, data-sovereignty, or team count forces them.

---

## Failure Modes

| Failure mode | What happens | Architecture control |
|---|---|---|
| S5 tools before S1 discipline | Expensive platform with irreproducible experiments | Require dataset/run/config manifest before platform migration |
| Local flexibility with no central IDs | Models, maps, labels, and telemetry cannot be joined after incidents | Centralize artifact IDs and telemetry fields early |
| Registry without release evidence | Alias movement looks controlled but approvals are empty | Make alias mutation depend on release packet fields |
| Data catalog without quality states | Users find bad data faster | Promotion states and quality reports gate training/eval use |
| Feature store too early | Team maintains infrastructure for features that no model reuses | Use manifest-backed offline files until reuse threshold is crossed; apply the feature/embedding store scale guide |
| Global canary by percentage | Easy routes pass while target ODD fails | Canary by site, route, vehicle, weather, lighting, and map state |
| Foundation-model outputs treated as truth | Prompt drift changes labels, reports, or safety evidence silently | Prompt/model/retrieval registry plus reviewer disposition and trace bundle |
| Platform bypass | Teams ship bespoke pipelines outside governance | Platform SLOs, self-service templates, fast incident lanes, and policy enforcement at artifact boundaries |

---

## Related Pages

- `mlops-scale-research-scope.md` - scale ladder and lifecycle controls.
- `mlops-migration-checklist-by-scale.md` - transition gates, tooling triggers, and migration evidence packets.
- `mlops-scorecards-and-kpis-by-scale.md` - scale-specific KPIs, release blockers, cadence, and anti-metrics.
- `site-sliced-release-evidence-by-scale.md` - ODD-cell release manifests, local holdouts, and rollout state machine.
- `feature-embedding-store-ops-by-scale.md` - feature, embedding, vector-search, and manifest store architecture by scale.
- `gpu-queueing-finops-by-scale.md` - GPU scheduler, queueing, quota, and FinOps architecture by scale.
- `secure-artifact-attestation-profile.md` - signing, SBOM, provenance, registry alias policy, and policy-enforced verification by scale.
- `model-governance-release-evidence.md` - registry aliases, claims-and-evidence release packets, and rollback evidence.
- `data-flywheel-airside.md` - closed-loop fleet learning and active data mining.
- `../data-platform/fleet-data-pipeline.md` - raw logs, ingestion, data product states, and retention.
- `../data-platform/data-catalog-lineage-quality-ops.md` - catalog, lineage, quality, and data-product promotion controls.
- `../../40-runtime-systems/ml-deployment/av-cicd-devops-pipeline.md` - CI/CD lane architecture across code, ML, maps, configuration, calibration, and deployment.
- `../../40-runtime-systems/ml-deployment/production-ml-deployment.md` - runtime packaging, TensorRT/Triton deployment, and production monitoring.
- `../ota/perception-slam-artifact-compatibility-matrix.md` - model/map/calibration/runtime compatibility.
- `../../60-safety-validation/standards-certification/ml-assurance-data-governance.md` - ML assurance and data governance.

## Sources

- Google Cloud, "MLOps: Continuous delivery and automation pipelines in machine learning." https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning
- Microsoft Azure Architecture Center, "MLOps maturity model." https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/mlops-maturity-model
- AWS Solutions, "AWS MLOps Framework." https://docs.aws.amazon.com/solutions/latest/aws-mlops-framework/
- MLflow, "Model Registry Workflows." https://www.mlflow.org/docs/latest/ml/model-registry/workflow/
- Kubeflow, "Pipeline." https://www.kubeflow.org/docs/components/pipelines/concepts/pipeline/
- TensorFlow, "TFX: ML Production Pipelines." https://www.tensorflow.org/tfx
- Feast, "Introduction." https://docs.feast.dev/
- Kubernetes, "Resource Quotas." https://kubernetes.io/docs/concepts/policy/resource-quotas/
- FinOps Foundation, "FinOps Framework." https://www.finops.org/framework/
