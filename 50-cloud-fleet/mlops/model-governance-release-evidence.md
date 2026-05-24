# Model Governance and Release Evidence

**Last updated:** 2026-05-24

## Why It Matters

An autonomy model release is not just a better checkpoint. It is a controlled change to vehicle behavior, data assumptions, safety evidence, runtime compatibility, and rollback posture. The release system must prove which model version is approved, what data and tests support it, where it is allowed to run, and how the fleet can return to the previous safe version.

Use this page for model release evidence. It does not replace OTA controls, software supply-chain evidence, runtime monitoring, or the safety case; it is the MLOps evidence packet that those systems consume. Use `experiment-tracking-reproducibility-by-scale.md` for the run authority, reproducibility level, and training/evaluation manifest layer that proves the candidate or release run can be rebuilt, compared, and traced to output artifacts. Use `model-registry-artifact-lifecycle-by-scale.md` for immutable artifact identity, alias authority, lifecycle states, artifact-set membership, rollback retention, and registry-scope controls before alias movement. Use `serving-inference-operations-by-scale.md` for the serving manifest, endpoint or batch route, input/output contract, traffic policy, autoscaling, ODD-cell canary, telemetry, and rollback load path that prove the approved artifact is the served artifact. Use `pipeline-orchestration-release-workflows-by-scale.md` to keep build, eval, export, register, release, incident, and evidence workflows separated so a successful training DAG cannot silently approve a release. Use `evaluation-platform-replay-gates-by-scale.md` for the metric spec, evaluator identity, replay/runtime checks, shadow/canary evidence, ODD-cell evaluation manifest, and platform evaluation SLOs that decide whether the release packet has enough evidence. Use `dataset-split-leakage-controls-by-scale.md` for the split manifest and leakage-report layer that proves release evaluation remained independent from training, tuning, pseudo-labeling, replay mining, feature building, and local holdouts. Use `model-monitoring-drift-response-by-scale.md` for the event contract and state machine that turns drift, delayed-label, replay, canary, and incident signals into release holds, ODD-cell quarantine, rollback, or safety-case evidence. Use `secure-artifact-attestation-profile.md` for the digest-bound signing, SBOM, SLSA/in-toto provenance, and policy verification layer that proves the release packet refers to the exact trusted artifacts.

## Operating Model

1. Register every deployable model in a model registry before release review. Use immutable model versions and mutable aliases such as `candidate`, `shadow`, `champion`, and `rollback` for deployment routing.
2. Attach release metadata to the model version: training run ID, code commit, dataset snapshots, split manifest, leakage report, label schema, feature schema, calibration package, runtime container, hardware target, and ODD scope.
3. Treat release approval as a claims-and-evidence review. The release claim states what improved, what did not regress, which ODD is covered, and which operational risk is being reduced. Use `site-sliced-release-evidence-by-scale.md` when the approval must be scoped by site, route, weather, task, map state, or vehicle kit.
4. Require named approval from the model owner, data owner, runtime owner, safety owner, and fleet operations owner before moving the `champion` alias.
5. Move through gates: offline metrics, scenario replay, shadow execution, limited canary, fleet expansion. Each gate either promotes, holds, or rejects the exact model version.
6. Keep rollback executable. The rollback model must be compatible with the active runtime, map schema, calibration schema, and config bundle.
7. Govern offboard labeler models and prompt sets as release-relevant artifacts when they influence semantic maps or training labels. A ZOPP/SALT/OpenUrban3D-style labeler may be offline-only, but its candidates can change the dataset, taxonomy, replay suite, and signed semantic-map bundle. The registry pattern is `offboard-labeler-registry-by-scale.md`.

## Governance by MLOps Scale

The companion scale hub (`mlops-scale-research-scope.md`) separates MLOps maturity from fleet size alone. A small safety-critical deployment can need S4 evidence, while a large offline research program may still be S1 if no model reaches users.

| Scale | Governance minimum | Release risk to control |
|---|---|---|
| S0 notebook research | Run notes, code commit, data pointer, fixed split | Result cannot be reproduced |
| S1 repeatable prototype | Experiment tracker, dataset snapshot, Docker image, validation script | Demo model becomes an undocumented baseline |
| S2 production product | Registry version, candidate/shadow/champion/rollback aliases, release packet, canary plan | Unreviewed model reaches an operational system |
| S3 fleet and multi-site | Site/ODD slices, release channels, local holdouts, fleet monitoring, data-mining triggers | One global metric hides site-specific regressions |
| S4 regulated safety-critical | Named approvers, safety-case claim links, immutable evidence, incident/rollback drill | Behavior change cannot be justified after an incident or audit |
| S5 platform scale | Policy-as-code, multi-tenant registry, evidence automation, cost and access controls | Teams bypass shared governance with bespoke pipelines |

For airside autonomy, model governance should usually reach S2 before the first shadow deployment and S4 before a model controls or materially influences a safety-critical behavior. That includes offline models when their outputs become semantic-map labels, training positives, route restrictions, or release evidence.

### Where Governance Lives in the Architecture

Governance should attach to architecture boundaries, not meeting rituals. The companion `mlops-reference-architectures-by-scale.md` page defines which components are local versus shared, and `mlops-migration-checklist-by-scale.md` defines the gate evidence before an artifact crosses from one scale to the next. The release rule is that any artifact crossing from local experimentation into shared release authority must gain immutable identity, ownership, allowed use, evidence, and rollback metadata.

| Scale boundary | Governance anchor | What must be blocked |
|---|---|---|
| S0 -> S1 baseline | Dataset snapshot, run manifest, validation script | Reusing a notebook result as a hidden baseline |
| S1 -> S2 production | Model registry version and release packet | Moving `candidate`, `shadow`, or `champion` aliases without data/runtime/eval evidence |
| S2 -> S3 fleet | Site/ODD rollout manifest and telemetry IDs | Expanding one model to new sites, routes, weather, maps, or vehicle kits without local evidence |
| S3 -> S4 safety-critical | Safety-case claim/evidence record | Behavior authority changing while waivers, incident scenarios, or rollback proof are unresolved |
| S4 -> S5 platform | Policy-as-code and audit API | Shared services allowing tenant bypass, unsupported data reuse, or untracked evaluator/prompt changes |

## Incident and Rollback Evidence by Scale

Post-release failures should update the model record, not only an operations ticket. The model registry is the anchor for finding which model, dataset, map, calibration, runtime, prompt, and evaluator artifacts were active when the failure occurred.

| Scale | Incident linkage | Rollback evidence | Governance outcome |
|---|---|---|---|
| S0 notebook research | Attach failure examples to the run note | Previous run or baseline remains the comparison point | Result is marked exploratory or invalid |
| S1 repeatable prototype | Link regression to dataset snapshot and validation script | Prior baseline can be rerun from archived artifacts | Baseline is frozen until comparison is clean |
| S2 production product | Incident ticket links to registry version, candidate/shadow/champion alias, and release packet | `rollback` alias points to compatible model/container/config bundle | Release packet is corrected or rejected |
| S3 fleet and multi-site | Incident links to active manifests by site, route, ODD cell, map tile, and vehicle cohort | Rollback/canary decision records affected and unaffected cohorts separately | Local holdouts and replay suite are updated |
| S4 regulated safety-critical | Incident links to safety-case claims, monitor activations, waiver state, and reportability assessment | Rollback proof includes timeline, authority, compatibility, and residual-risk decision | Safety-case delta and corrective action are mandatory |
| S5 platform scale | Incident links shared registry, evaluator, prompt, feature-store, and policy decisions across tenants | Rollback verifies tenant isolation and shared-service compatibility | Platform control or policy changes are reviewed organization-wide |

The release packet should keep the last known-good model executable for as long as the operational rollback window requires. If a new taxonomy, map schema, calibration schema, or runtime container makes the previous model unloadable, the release is not rollback-ready even if the old checkpoint still exists.

## Release Ownership Matrix

Release governance fails when "the model team approved it" means nobody checked data, runtime, maps, or safety evidence. Use explicit ownership:

| Decision | Accountable owner | Must approve when safety-relevant | Evidence to attach |
|---|---|---|---|
| Candidate model is reviewable | Model owner | Data owner | Training provenance, dataset manifest, evaluation report |
| Dataset snapshot is eligible | Data owner | Privacy/security owner, map owner for map-derived labels | Lineage, split policy, label QA, retention/data-use class |
| Runtime artifact is deployable | Runtime owner | OTA/SUMS owner | ONNX/TensorRT/container compatibility, load test, rollback artifact |
| Serving route is approved | Serving/runtime owner | Fleet operations, release manager | Serving manifest, traffic policy, endpoint readiness, autoscaling, ODD-cell scope, rollback load test |
| ODD/site scope is valid | Fleet operations owner | Safety owner, site operations | Site slices, shadow coverage, local holdout metrics |
| Release claim is defensible | Safety owner | Model owner, data owner, runtime owner, release manager | Scenario replay, safety-case claim IDs, residual-risk decision |
| Champion alias can move | Release manager | Model, data, runtime, safety, fleet operations | Signed release decision, rollback trigger, expiry date |
| Rollback can execute | Runtime owner | Fleet operations owner | Rollback alias, cached artifact, compatibility proof, drill result |

Scale changes the ceremony, not the ownership. S0 may record the owner in a run note. S2 needs registry metadata. S4 needs immutable approval records and evidence expiry. S5 should automate ownership checks but should not remove named accountability.

## Evidence Artifacts

| Artifact | Minimum contents | Owner |
|---|---|---|
| Model registry record | Registered model, immutable version, aliases, tags, release notes | MLOps |
| Registry artifact lifecycle record | Artifact type, digest, authority state, alias movement history, artifact-set membership, compatibility hash, rollback retention, quarantine/deprecation state | MLOps |
| Training provenance | Run authority, reproducibility level, run ID, code commit, dependency lock, training config, random seeds, hardware class, dirty-state disposition, metric spec, output digest | Model owner |
| Dataset and split manifest | Iceberg/DVC snapshot IDs, split ID, grouping keys, allowed-use state, label schema, release-state label schema for map-derived data, excluded data, leakage checks | Data owner |
| Feature or embedding snapshot | Feature definition IDs, event-time join proof, materialization snapshot, embedding model, corpus/index build, parity/recall checks, deletion state | Data platform |
| Pseudo-label invalidation record | Batch ID, invalidation trigger, affected source map/calibration/taxonomy/release-state scope, downstream consumers, rebuild or waiver decision | Data owner |
| Offboard labeler evidence | Labeler pipeline version, prompt set, model/checkpoint IDs, calibration/projection hash, threshold file, accepted/rejected candidate statistics, taxonomy-promotion IDs | Label operations |
| Evaluation manifest/report | Eval authority, evaluator identity, metric spec, artifact-set hash, primary metrics, calibration, uncertainty, class/site/weather/map-state slices, runtime smoke, comparable-baseline proof | Model owner |
| Serving manifest | Service ID, endpoint or batch job, registry alias, input/output contract, traffic policy, scaling policy, telemetry fields, security state, rollback route | Runtime/serving owner |
| Scenario replay report | Required scenario suite, replay package IDs, new mined scenarios, changed-map tiles, failures, flake state, waiver owner/expiry | Safety validation |
| Shadow-mode report | Disagreement with champion, intervention correlation, latency and resource use | Fleet operations |
| Site-sliced release record | ODD-cell manifest, local holdout, shadow/canary exposure, delayed-label review, rollout decision, expiry, waiver state | Release manager |
| Monitoring and drift-response record | Monitoring event IDs, active artifact set, affected ODD slice, signal family, containment action, owner, suppression/waiver expiry, delayed-label or replay follow-up | Fleet operations + MLOps |
| Safety case link | Claim IDs supported by this release and evidence IDs attached to each claim | Safety owner |
| Compatibility manifest | Active model/map/calibration/runtime/telemetry/semantic-taxonomy artifact set, compatibility hash, MLOps scale, rollback set, labeler/prompt/evaluator dependencies | Release manager |
| Artifact attestation bundle | Subject digests, signatures, SBOM/provenance, trusted-builder record, vulnerability disposition, model/export/map/labeler/eval policy results | Security + MLOps |
| Release decision record | Approvers, residual risks, rollout plan, rollback trigger, expiry date | Release manager |

## Foundation-Model and Prompt Evidence

Foundation-model artifacts need release evidence when they influence labels, maps, operator guidance, incident reports, safety-case drafts, or model evaluation. The question is not whether the model runs online. The question is whether its output can change a released artifact or an operational decision.

| Artifact | Evidence required before promotion | Release boundary |
|---|---|---|
| Prompt pack | Prompt text, system instruction, variables, few-shot examples, prompt owner, intended task, change log | May generate candidates only until tied to an approved evaluation pack |
| Foundation-model endpoint or checkpoint | Provider, model ID, checkpoint or API version, hosted region, data-retention mode, quantization | Provider updates require regression review when output affects evidence |
| Decoding and safety policy | Temperature, top-p, max tokens, refusal policy, abstention/unknown policy, content filters | Non-deterministic settings must not be used for release labels without stability evidence |
| Retrieval corpus | Corpus snapshot, embedding model, index ID, access policy, expiry, citation coverage | RAG outputs are invalid if the corpus or index cannot be reconstructed |
| Tool-using agent policy | Tool allowlist, read/write permissions, planner depth, timeout, human approval gates | Agents cannot mutate maps, labels, manifests, tickets, or approvals without an explicit workflow gate |
| Judge/evaluator model | Judge prompt, judge model, calibration set, human-disagreement rate, slice thresholds | Judge scores route review; they do not replace release approval in S4 contexts |
| Trace bundle | Input digest, output, citations, tool calls, latency, reviewer correction, final disposition | Audit and rollback require the full chain, not only the accepted answer |

For semantic-map pipelines, the strict boundary is `candidate_label -> review_label -> qa_label -> release_label`. VLMs, VLA teachers, open-vocabulary segmenters, prompt-driven labelers, and LLM reviewers can accelerate the first two states, but the release packet must still prove taxonomy action, source-map acceptance, calibration/projection hash, reviewer disposition, QA metrics, and rollback impact. A generated natural-language explanation is supporting context, not a substitute for geometric, scenario, or safety evidence.

## Acceptance Checks

- The model can be loaded by registry alias and by immutable version.
- Any registry alias movement has lifecycle-state evidence, target scope, owner, approval, artifact-set compatibility, and rollback retention recorded.
- The model version has run authority, reproducibility level, dataset, split, code, config, environment, evaluator, output digest, and runtime provenance sufficient to rebuild, compare, or explain the release.
- The evaluation evidence has an eval authority state, evaluator version, metric spec, slice set, artifact-set hash, comparable baseline, runtime package smoke, replay IDs, decision state, and waiver disposition.
- The model version names the split manifest and leakage report for training, validation, release test, replay, local holdout, feature/embedding snapshots, and any map-derived pseudo-label batch it consumes.
- Any offline labeler or prompt pack that contributed labels has immutable provenance and a rollback impact assessment for affected datasets, semantic-map manifests, and taxonomy versions.
- Any offboard labeler promoted beyond research has a registry record with model/prompt/retrieval/threshold/config identity, evaluation scope, allowed-use state, and rollback bundle.
- Any map-derived pseudo-label batch has semantic class, confidence, release-state label, source-map acceptance ID, split ID, and reviewer state; non-`permanent_static` labels cannot appear as supervised static positives without an explicit auxiliary-task declaration.
- Any suspect or quarantined map-derived pseudo-label batch has an invalidation record and cannot feed training, release evaluation, or safety evidence until rebuilt, reapproved, or waived.
- Any feature materialization or embedding/vector index used for training, replay, evaluation, RAG, or safety evidence resolves to a snapshot with point-in-time join proof, corpus/index version, deletion state, and stale-index/backfill status.
- Any federated, hybrid, or privacy-preserving training output has trigger-policy justification, client/site manifests, aggregation-round evidence, privacy controls, local holdouts, and release scope before it can move beyond `candidate`.
- Any GenAI, RAG, judge, VLM/VLA, or tool-agent output that affects labels, maps, release evidence, incidents, or operations has prompt/model/corpus/tool identity, eval-pack evidence, trace retention, reviewer disposition, policy result, and rollback bundle before it can move beyond candidate use.
- Any drift, monitoring, delayed-label, replay, or incident signal tied to the candidate has a response record that names the active artifacts, affected ODD slice, containment action, owner, expiry, and required follow-up before release expansion.
- The evaluation report includes both aggregate metrics and operational slices for airport zone, lighting, weather, vehicle platform, and object class.
- No critical scenario replay regression is open without an approved safety waiver and an explicit operational mitigation.
- Shadow-mode evidence covers the same ODD requested for release.
- Site-sliced release evidence is present before expanding a model to a new site, route, task, vehicle kit, weather band, or map release state.
- The release packet states which previous model version is the rollback target and verifies runtime compatibility.
- The release packet includes the compatibility manifest when the model depends on a specific map, calibration package, runtime container, semantic taxonomy, prompt/labeler, telemetry schema, or replay package.
- The release packet includes required artifact attestations for every release-affecting model, container, ONNX/TensorRT engine, semantic map, dataset, labeler/prompt pack, replay pack, and evaluation pack.
- The deployment decision references the relevant safety case claims and technical documentation record.

## Failure Modes

| Failure mode | Consequence | Control |
|---|---|---|
| Alias moved without evidence | Fleet runs a model that was not reviewed | Require signed release decision before alias mutation |
| Metric-only approval | Model improves averages while regressing rare safety cases | Gate on scenario replay and ODD slices |
| Dataset snapshot missing | Release cannot be reproduced or audited | Block release unless dataset IDs are immutable |
| Dataset split or leakage report missing | Release metrics may use examples, map tiles, feature corpora, labeler outputs, or replay scenarios that influenced training | Require split manifest, grouping keys, leakage report, and allowed-use state before candidate review |
| Map-derived labels lack release-state evidence | Model learns transient or quarantined map points as permanent static classes | Require release-state masks, source-map acceptance, split IDs, and pseudo-label batch invalidation controls |
| Shadow evidence from a different ODD | Approval does not support target deployment | Tie evidence to airport, route, weather, and vehicle class |
| Drift alert ignored or auto-retrains | Release state changes without evidence, or a local regression remains uncontained | Route monitoring events through response states, owner, containment action, and retraining trigger policy |
| Runtime incompatibility | Model passes offline tests but fails on vehicle | Validate TensorRT/ONNX/runtime bundle before canary |
| Serving route mismatch | Approved artifact is served through an unreviewed endpoint, traffic split, or ODD cohort | Require serving manifest parity, endpoint readiness, telemetry IDs, and rollback route before deployment |
| Artifact digest or provenance missing | Release packet cannot prove the deployed package is the evaluated package | Require signed artifacts, SBOM/provenance, policy result, and trusted-builder evidence before alias movement |
| Offline labeler changes without governance | Training labels or semantic maps shift while the deployed model appears unchanged | Version prompt sets, labeler models, thresholds, accepted/rejected statistics, and rollback impact |
| Rollback model not executable | Recovery depends on a manual hotfix | Keep `rollback` alias and compatible artifact bundle current |
| Approval expires silently | Old evidence is reused after data or ODD drift | Require evidence expiry and periodic revalidation |

## Related Repository Docs

- `40-runtime-systems/ml-deployment/production-ml-deployment.md`
- `40-runtime-systems/ml-deployment/av-cicd-devops-pipeline.md`
- `50-cloud-fleet/mlops/mlops-scale-research-scope.md`
- `50-cloud-fleet/mlops/mlops-reference-architectures-by-scale.md`
- `50-cloud-fleet/mlops/mlops-migration-checklist-by-scale.md`
- `50-cloud-fleet/mlops/model-registry-artifact-lifecycle-by-scale.md`
- `50-cloud-fleet/mlops/serving-inference-operations-by-scale.md`
- `50-cloud-fleet/mlops/platform-sre-reliability-by-scale.md`
- `50-cloud-fleet/mlops/dataset-split-leakage-controls-by-scale.md`
- `50-cloud-fleet/mlops/experiment-tracking-reproducibility-by-scale.md`
- `50-cloud-fleet/mlops/pipeline-orchestration-release-workflows-by-scale.md`
- `50-cloud-fleet/mlops/evaluation-platform-replay-gates-by-scale.md`
- `50-cloud-fleet/mlops/model-monitoring-drift-response-by-scale.md`
- `50-cloud-fleet/mlops/site-sliced-release-evidence-by-scale.md`
- `50-cloud-fleet/mlops/feature-embedding-store-ops-by-scale.md`
- `50-cloud-fleet/mlops/offboard-labeler-registry-by-scale.md`
- `50-cloud-fleet/mlops/secure-artifact-attestation-profile.md`
- `50-cloud-fleet/mlops/federated-privacy-preserving-training-policy-by-scale.md`
- `50-cloud-fleet/mlops/llmops-agent-evaluation-by-scale.md`
- `50-cloud-fleet/mlops/data-flywheel-airside.md`
- `50-cloud-fleet/data-platform/data-catalog-lineage-quality-ops.md`
- `30-autonomy-stack/perception/overview/3d-segmentation-training-paradigms.md`
- `30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md`
- `50-cloud-fleet/ota/software-update-management-system-ops.md`
- `60-safety-validation/safety-case/safety-case-evidence-traceability.md`
- `60-safety-validation/verification-validation/testing-validation-methodology.md`
- `60-safety-validation/standards-certification/eu-ai-act-machinery-compliance-dossier.md`

## Sources

- MLflow, "Model Registry Workflows." https://www.mlflow.org/docs/latest/ml/model-registry/workflow/
- Weights & Biases, "Reference an artifact version with aliases." https://docs.wandb.ai/models/registry/aliases
- Google Cloud, "Model versioning with Model Registry." https://cloud.google.com/vertex-ai/docs/model-registry/versioning
- Amazon SageMaker AI, "Model Registry Models, Model Versions, and Model Groups." https://docs.aws.amazon.com/sagemaker/latest/dg/model-registry-models.html
- Kubeflow, "Kubeflow Model Registry." https://www.kubeflow.org/docs/components/model-registry/
- KServe, "Serving Runtime." https://kserve.github.io/website/docs/concepts/resources/servingruntime
- Google Cloud, "Deploy a model to an endpoint." https://cloud.google.com/vertex-ai/docs/general/deployment
- MLflow, "MLflow Tracking." https://mlflow.org/docs/latest/ml/tracking/
- Weights & Biases, "Experiments overview." https://docs.wandb.ai/models/track
- DVC, "Experiment Management." https://doc.dvc.org/user-guide/experiment-management
- OpenLineage, "Object Model." https://openlineage.io/docs/spec/object-model/
- OpenLineage, "Data Quality Metrics Facet." https://openlineage.io/docs/spec/facets/dataset-facets/data_quality_metrics/
- Apache Airflow, "Dags." https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dags.html
- Argo Workflows, "What is Argo Workflows?" https://argo-workflows.readthedocs.io/en/latest/
- Kubeflow, "Pipeline." https://www.kubeflow.org/docs/components/pipelines/concepts/pipeline/
- MLflow, "Model Evaluation." https://mlflow.org/docs/latest/ml/evaluation/
- TensorFlow, "Getting Started with TensorFlow Model Analysis." https://www.tensorflow.org/tfx/model_analysis/get_started
- Evidently AI, "Evaluations." https://docs.evidentlyai.com/metrics/introduction
- ASAM OpenSCENARIO. https://www.asam.net/standards/detail/openscenario/
- ZOPP, "A Framework of Zero-shot Offboard Panoptic Perception for Autonomous Driving." https://arxiv.org/abs/2411.05311
- SALT, "A Flexible Semi-Automatic Labeling Tool for General LiDAR Point Clouds with Cross-Scene Adaptability and 4D Consistency." https://arxiv.org/abs/2503.23980
- OpenUrban3D, "Annotation-Free Open-Vocabulary Semantic Segmentation of Large-Scale Urban Point Clouds." https://arxiv.org/abs/2509.10842
- AWS, "Data and model quality monitoring with Amazon SageMaker Model Monitor." https://docs.aws.amazon.com/sagemaker/latest/dg/model-monitor.html
- Microsoft Learn, "Model monitoring in production - Azure Machine Learning." https://learn.microsoft.com/en-us/azure/machine-learning/concept-model-monitoring
- Google Cloud, "Prompt management." https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/prompt-classes
- Google Cloud, "Gen AI evaluation service overview." https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/evaluation-overview
- Microsoft Learn, "Advance your maturity level for GenAIOps." https://learn.microsoft.com/en-us/azure/machine-learning/prompt-flow/concept-llmops-maturity?view=azureml-api-2
- Waymo, "Safe to Deploy: How We Know The Waymo Driver Is Ready For The Road," 2025-06. https://waymo.com/blog/2025/06/safe-to-deploy/
- Waymo, "Building a credible case for safety: Waymo's approach for the determination of absence of unreasonable risk." https://waymo.com/research/building-a-credible-case-for-safety-waymos-appro/
- Regulation (EU) 2024/1689, Artificial Intelligence Act, Articles 10-12 and Annex IV. https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689
- ISO/IEC 5259-5:2025, "Artificial intelligence - Data quality for analytics and machine learning (ML) - Part 5: Data quality governance framework." https://www.iso.org/standard/84150.html
