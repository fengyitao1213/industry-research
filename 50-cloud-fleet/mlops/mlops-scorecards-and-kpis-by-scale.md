# MLOps Scorecards and KPIs by Scale

**Last updated:** 2026-05-24

MLOps metrics should measure whether the ML system can be improved without losing reproducibility, safety, release control, or operational trust. A single "model accuracy" dashboard is not an MLOps scorecard. At production scale, the scorecard must join data quality, label quality, experiment reproducibility, release reliability, runtime behavior, incident response, cost, and governance evidence.

This page defines scale-specific KPIs for S0-S5 MLOps. Use it with `mlops-scale-research-scope.md` for maturity, `mlops-reference-architectures-by-scale.md` for architecture, `mlops-migration-checklist-by-scale.md` for transition gates, `experiment-tracking-reproducibility-by-scale.md` for run authority and reproducibility levels, `model-registry-artifact-lifecycle-by-scale.md` for registry identity, alias authority, lifecycle-state hygiene, artifact-set membership, and rollback retention, `serving-inference-operations-by-scale.md` for serving manifest coverage, package parity, endpoint readiness, traffic policy, autoscaling, ODD-cell canary evidence, and rollback load tests, `pipeline-orchestration-release-workflows-by-scale.md` for workflow gates and orchestrator health, `evaluation-platform-replay-gates-by-scale.md` for evaluation manifest coverage, replay/runtime gates, shadow/canary evidence, flake rate, and evaluation-service SLOs, `dataset-split-leakage-controls-by-scale.md` for split-firewall evidence, `model-monitoring-drift-response-by-scale.md` for drift-response evidence, `site-sliced-release-evidence-by-scale.md` for ODD-cell release blockers, `feature-embedding-store-ops-by-scale.md` for feature/vector-store health, `gpu-queueing-finops-by-scale.md` for compute economics, `secure-artifact-attestation-profile.md` for artifact trust-chain evidence, and `model-governance-release-evidence.md` for release evidence.

---

## KPI Families

| KPI family | What it measures | Why it matters |
|---|---|---|
| Reproducibility | Whether a result can be rebuilt and compared | Prevents notebook results from becoming untraceable baselines |
| Data quality and lineage | Whether training/eval data is complete, valid, and attributable | Prevents models from learning from mutable, leaked, or unsafe data |
| Split and leakage integrity | Whether train, validation, test, replay, safety holdout, site holdout, and benchmark partitions remain independent | Prevents temporal, route, site, map, labeler, feature, synthetic, and federated leakage |
| Feature and embedding store health | Whether feature materializations and vector indices are fresh, reproducible, governed, and traceable | Prevents point-in-time leakage, stale retrieval, and unsupported reuse of derived representations |
| Label quality | Whether labels are correct, reviewed, and allowed for the intended use | Prevents auto-labels, map-derived labels, and prompt outputs from becoming false truth |
| Model quality | Whether offline metrics, calibration, uncertainty, and slices support the claim | Prevents aggregate improvements from hiding class, site, or ODD regressions |
| Evaluation platform health | Whether evaluator identity, metric specs, replay packages, runtime checks, shadow/canary evidence, and platform SLOs are complete | Prevents dashboards or green training jobs from becoming unsupported release approval |
| Runtime quality | Whether the deployable artifact meets latency, memory, determinism, and compatibility needs | Prevents a model that passes offline tests from failing on vehicle hardware |
| Artifact compatibility | Whether model, map, calibration, runtime, telemetry, semantic taxonomy, labeler, prompt, and replay artifacts are mutually valid | Prevents release from activating an artifact set that was never evaluated together |
| Registry lifecycle | Whether artifact identity, aliases, authority states, rollback targets, and retention rules are complete | Prevents mutable `latest`, stale aliases, and undeployable rollback artifacts from controlling release |
| Serving operations | Whether batch jobs, online endpoints, edge packages, service manifests, traffic policies, autoscaling, and rollback paths are controlled | Prevents evaluated artifacts from diverging from served artifacts or reaching the wrong ODD cell |
| Artifact trust and provenance | Whether release-affecting artifacts are digest-pinned, signed, attested, and policy-verified | Prevents unsigned models, stale engines, mutable datasets, and untrusted prompt/eval packs from reaching release |
| Release reliability | Whether candidate, shadow, canary, champion, and rollback transitions are controlled | Prevents training completion from becoming deployment approval |
| Observability and incident response | Whether anomalies become evidence-backed action | Prevents dashboards from replacing mitigation, rollback, or learning loops |
| Drift response quality | Whether drift, delayed-label, replay, and incident signals route to controlled actions | Prevents automatic retraining, ignored local regressions, and unaudited alert suppression |
| Governance and compliance | Whether approvals, evidence, retention, and policy states are auditable | Prevents release claims from failing during incident review or audit |
| Cost and platform efficiency | Whether data, labeling, GPUs, storage, and platform services are economically controlled | Prevents scale from hiding waste or starving safety-critical work |

The scorecard should separate **leading indicators** from **lagging indicators**. Dataset manifest coverage is a leading indicator; field incident rate is lagging. Label reviewer disagreement is leading; safety-case corrective action is lagging. Good MLOps tracks both.

---

## Scale Scorecard

| Scale | Primary question | Minimum scorecard | Release blocker |
|---|---|---|---|
| S0 notebook research | Can this experiment be understood later? | Code commit, data pointer, config, run note, split definition, metric output | Missing data pointer or unreproducible metric when result is reused |
| S1 repeatable prototype | Can another engineer rerun and compare the baseline? | Dataset snapshot, Docker/env lock, validation script, confidence interval, failure examples | Baseline moves without snapshot or metric script |
| S2 single-product production | Can this exact artifact be deployed and rolled back? | Registry version, dataset manifest, label QA, runtime package test, release packet, rollback target | Candidate lacks model/data/runtime/eval/rollback evidence |
| S3 fleet and multi-site | Is the model safe for this site/ODD cell and not only globally better? | Site slices, trigger coverage, local holdouts, replay deltas, shadow/canary telemetry, delayed-label joins | Global aggregate passes while target site/ODD slice regresses |
| S4 regulated safety-critical | Can the release claim be defended after an incident or audit? | Claim/evidence table, hazard slices, safety monitor impact, waiver/expiry state, rollback drill, retention hold | Safety-relevant regression, expired waiver, or missing immutable evidence |
| S5 platform scale | Is the shared platform improving reuse without unsafe bypass? | Tenant scorecards, policy compliance, service SLOs, data/model/eval inventory, cost allocation, alert quality | Platform permits unsupported release path or cross-tenant evidence ambiguity |

At S2 and above, every KPI should name the artifact it applies to. "mAP improved" is incomplete; "model `detector-v42`, trained on dataset snapshot `airport-a-train-2026-05`, improved FOD recall on the S3 stand-entry slice with runtime package `trt-orin-v42`" is usable release evidence.

---

## KPI Catalog by Lifecycle Stage

| Stage | KPI | S0-S1 use | S2-S3 use | S4-S5 use |
|---|---|---|---|---|
| Data ingestion | Manifest coverage | Percentage of samples with source path and split | Percentage of release datasets with raw lineage, calibration, map, schema, and access class | Evidence completeness and retention-hold coverage |
| Data quality | Quality gate pass rate | Manual sample pass/fail | Schema, timestamp, calibration, duplicate, leakage, and slice coverage checks | Quality report tied to safety claims and legal/privacy state |
| Split integrity | Split firewall health | Fixed split note and duplicate spot check | Immutable split manifest, group-key completeness, temporal gap, replay overlap, and map/tile leakage checks | Evidence-locked holdout access log, evaluation budget, waiver aging, and split-policy audit |
| Feature/vector store | Freshness, leakage, recall, and deletion propagation | Manual rebuild note or local index manifest | Point-in-time join tests, online/offline parity, index build ID, golden-query recall, deletion propagation | Immutable feature/index snapshot, audit trace, stale-index blocker, safety-case link |
| Labeling | Accepted-label yield | Manual acceptance rate | Accepted / submitted / rejected / reworked labels by class and site | Expert-review yield, vendor quality, audit-export completeness |
| Auto-labeling | Reviewer correction rate | Candidate-label usefulness | Correction rate by class, ODD, labeler version, prompt pack, and map release state | Safety-slice false acceptance rate and promotion-state violations |
| Experiment | Rebuild success, run authority coverage, and comparable-baseline integrity | Can rerun locally and explain the run state | CI or pipeline can rebuild training/eval from manifests, links output digests, and blocks unsupported comparisons | Rebuild evidence preserved for audit window with run authority, reproducibility level, and policy result |
| Pipeline/workflow | Manifest coverage, artifact handoff completeness, retry/failure quality, and gate effectiveness | Script or CI job preserves inputs/outputs | Orchestrator writes workflow/run IDs to tracker, catalog, registry, and release packet | Workflow evidence, policy hooks, audit export, and incident/evidence lanes are tested |
| Model quality | Primary metric and uncertainty | Basic metric with confidence interval | Aggregate plus class/site/weather/map-state slices | Hazard-slice thresholds and safety-case-linked claims |
| Calibration | ECE / reliability / abstention | Diagnostic plot | Threshold selection and unknown routing | Conformal or calibrated coverage evidence where required |
| Evaluation | Manifest coverage, comparable baseline, slice coverage, replay pass/flake rate, and evaluation lead time | Small smoke replay and metric spec | Incident, rare-class, map-change replay packages, runtime smoke, shadow/canary denominator | Scenario catalog coverage, platform SLO, waiver expiry, and residual-risk record |
| Runtime | Package load and latency | Smoke test | p50/p95/p99 latency, memory, queue time, TensorRT/ONNX compatibility | Hardware cohort SLO, deterministic replay, degradation policy |
| Serving | Service manifest, package parity, endpoint readiness, and traffic policy | Local command or internal endpoint smoke | Batch/online/shadow/canary manifest, autoscaling policy, ODD-cell routing, rollback load test | Platform endpoint SLO, policy-gated rollout, tenant isolation, audit export |
| Compatibility | Artifact-set compatibility | Manual note of model/map/calibration assumptions | Compatibility manifest with hash over model, map, calibration, runtime, telemetry, taxonomy, and rollback | Policy-enforced manifest with safety-case links, expiry, and incident retention |
| Registry | Alias hygiene, lifecycle-state coverage, rollback retention | Checkpoint hash and baseline alias | Candidate/shadow/champion/rollback states, alias movement evidence, artifact-set membership | Site-scoped aliases, quarantine state, audit API, retention and deletion policy |
| Artifact trust | Signature/provenance coverage | Checksum manifest for preserved baselines | Signed containers/models/maps/prompts, SBOM, provenance, registry policy result | SLSA/in-toto provenance, trusted builder evidence, admission verification, immutable audit record |
| Federated/privacy training | Centralized-vs-local-vs-federated comparison | Simulated-client experiment note | Site/client metrics, privacy review, aggregation evidence, local holdouts | Privacy budget, secure aggregation, poisoning tests, safety-case release scope |
| GenAI and agent evaluation | Prompt/model/corpus/tool behavior under task-specific evals | Prompt examples and manual failures | Eval pack, trace capture, reviewer correction, grounding and tool-call metrics | Red-team, prompt-injection, safety-case, trace retention, and policy-gated tool actions |
| Deployment | Promotion lead time | Time from result to baseline | Time from candidate to shadow/canary/champion with evidence | Time from claim approval to controlled rollout with audit trail |
| Release reliability | Change failure rate | Regression count | Candidate hold/reject/rollback rate by cause | Safety-relevant change failure and corrective-action closure |
| Monitoring | Alert actionability | Failure notes become issues | Alerts produce label batch, replay case, rollback check, or ODD quarantine | Alert suppression audit, reportability, safety-case delta |
| Drift response | Signal-to-action closure | Manual failure list is triaged | Drift events have artifact IDs, owner, affected ODD slice, and action state | Evidence freeze, suppression expiry, containment latency, and safety-case delta |
| Incident response | MTTR / containment time | Time to explain regression | Time to isolate artifact and affected cohort | Time to evidence freeze, rollback, and reportability decision |
| Cost | Unit cost | Cost per run | Cost per accepted label, training run, replay hour, released model/map, queue wait time | Cost per evidence pack, platform tenant, reserved incident lane, and ODD-cell approval |
| Platform | Adoption and bypass rate | Not applicable | Shared registry/eval use by product team | Tenant compliance, bypass attempts, service SLOs, GPU queue wait time |
| Migration | Scale-transition readiness | S0->S1 reproducibility checklist | S1->S2 or S2->S3 release/fleet checklist | S3->S4 or S4->S5 evidence/platform checklist with exception aging |

The goal is not to maximize every metric. For example, low candidate rejection can mean weak exploration, and high deployment frequency can be dangerous if release evidence is shallow. Interpret KPIs against the scale and authority of the artifact.

---

## Release-Blocking Metrics

Some metrics are informational; others should block promotion. For autonomy, the blocker list must include safety and evidence conditions, not only model metrics.

| Blocker | Applies from | Example block condition |
|---|---|---|
| Missing immutable dataset or label snapshot | S1 for baselines, S2 for release | Candidate points to mutable bucket prefix or unlabeled local files |
| Missing run authority or reproducibility manifest | S1-S5 | Baseline, candidate, release, evidence, or platform benchmark run lacks authority state, reproducibility level, code/data/config/environment/evaluator/output lineage, or dirty-state disposition |
| Missing or incomparable evaluation manifest | S1-S5 | Candidate lacks eval authority, evaluator version, metric spec, slice set, artifact-set hash, runtime smoke, replay IDs, waiver state, or comparable-baseline proof |
| Unsupported workflow transition | S2-S5 | Training completion moves a registry alias, release scope, semantic-map publication, label state, or evidence state without required workflow manifest, gate result, approval, or rollback proof |
| Label allowed-use violation | S2 | `candidate_label`, `movable_static`, `fod_candidate`, or `unknown_review` used as permanent-static positive without auxiliary-task declaration |
| Suspect feature or embedding snapshot | S2-S5 | Training, eval, replay, or safety evidence consumes a feature materialization or vector index whose source map, calibration, corpus, embedding model, deletion state, or backfill has been invalidated |
| Unregistered offboard labeler | S2-S5 | Training labels, semantic maps, replay assertions, or safety evidence consume outputs from a labeler, prompt pack, evaluator, threshold set, or retrieval corpus without registry evidence |
| Evaluation data leakage | S1-S5 | Training set overlaps with release gate, replay scenario, site/local holdout, map tile, source-map session, feature/index corpus, labeler benchmark, synthetic source asset, or federated client holdout |
| Missing ODD-cell release manifest | S3-S5 | Candidate expands to a new site, route, task, vehicle kit, weather band, or map state without site-sliced evidence |
| Runtime package mismatch | S2-S5 | Evaluated checkpoint differs from deployed ONNX/TensorRT/container artifact |
| Unsupported registry alias movement | S2-S5 | `candidate`, `shadow`, `champion`, `rollback`, `site_champion`, or `quarantined` changes without registry lifecycle evidence, scope, approval, compatibility, and rollback state |
| Unsupported serving change | S2-S5 | Endpoint, batch service, model server repository, traffic split, autoscaling policy, or edge package changes without serving manifest, evaluated artifact parity, telemetry, and rollback proof |
| Missing artifact attestation | S2-S5 | Model, ONNX/TensorRT engine, container, map layer, labeler/prompt pack, eval pack, or release packet lacks required digest-bound signature, SBOM, provenance, or policy result |
| Unsupported federated training output | S3-S5 | Federated or hybrid model/adaptor lacks trigger-policy justification, client manifests, privacy controls, local holdouts, aggregation report, or site-scoped release evidence |
| Unsupported GenAI/agent output | S2-S5 | Prompt, RAG, judge, VLM/VLA, or tool-agent output affects labels, maps, release evidence, incident closure, or operations without eval pack, trace, reviewer disposition, policy result, and rollback bundle |
| Compatibility manifest mismatch | S2-S5 | Model, map, calibration, runtime, semantic taxonomy, prompt/labeler, telemetry schema, or replay pack differs from the evaluated artifact set |
| Target ODD slice regression | S3-S5 | Aggregate score improves but target site, night, rain, stand-entry, FOD, or personnel slice regresses |
| Safety monitor regression | S4-S5 | New model increases false-free-space, protected-zone violation, unsafe speed, or intervention correlation |
| Rollback not executable | S2-S5 | Previous model cannot load under active runtime, schema, calibration, or map package |
| Assurance capacity unavailable | S4-S5 | Incident replay, release replay, rollback proof, or safety evidence job cannot run within the required response window because routine jobs consumed reserved capacity |
| Unsupported drift response | S2-S5 | Drift, delayed-label, replay, or incident signal triggers automatic retraining, has no owner/runbook, lacks artifact IDs, or suppresses safety-relevant evidence without expiry |
| Missing evidence retention | S4-S5 | Raw logs, replay package, release packet, approval, or incident evidence can be garbage-collected |
| Platform policy bypass | S5 | Team moves artifact outside shared registry/eval/policy controls |
| Premature scale migration | S1-S5 | Team adds shared platform tooling before run/data/release contracts exist, or moves an artifact to higher authority without the migration checklist evidence packet |

Release blockers should be machine-checkable where possible and reviewable where judgment is required. A blocked release is a controlled state, not a failed engineering effort.

---

## Operating Cadence

| Cadence | S0-S1 | S2-S3 | S4-S5 |
|---|---|---|---|
| Per run | Commit, config, data pointer, metric output | Training provenance, dataset snapshot, evaluation report | Provenance plus policy checks and evidence IDs |
| Daily | Manual notes if active | Data quality exceptions, trigger queue health, label throughput | Evidence ingestion, incident queues, platform SLO exceptions |
| Weekly | Baseline comparison | Candidate review, label QA, site-slice drift, replay growth | Safety evidence review, waiver expiry, alert suppression audit |
| Per release | Baseline tag | Release packet, shadow/canary, rollback proof | Claim/evidence table, approval record, retention hold, rollback drill |
| Quarterly | Research direction review | Model/data/map scorecard trend | Safety-case scorecard, platform cost/SLO review, policy exceptions |

The cadence should keep the scorecard close to decisions. Metrics that nobody reviews before promotion or incident response are documentation debt.

---

## Scorecard Ownership

| Scorecard section | Primary owner | Required collaborators |
|---|---|---|
| Data quality and lineage | Data owner | Privacy/security, model owner, map owner |
| Label quality and auto-labeling | Label operations owner | Model owner, safety owner, vendor manager |
| Model quality and evaluation | Model owner | Safety validation, site operations, data owner |
| Runtime quality | Runtime owner | Model owner, compute owner, OTA/SUMS owner |
| Release reliability | Release manager | Model, data, runtime, safety, fleet operations |
| Observability and incident response | Fleet operations owner | Runtime, safety, MLOps, site owner |
| Governance and evidence | Safety or compliance owner | Release manager, data owner, platform owner |
| Platform cost and SLOs | Platform/MLOps owner | Product owners, finance, security |

At S5, the platform team owns the measurement system, but product teams still own release decisions. Automated scorecards can prove evidence completeness; they cannot remove accountability.

---

## Airside and Managed-Site KPI Focus

For airside, port, yard, campus, warehouse, and other non-road managed-site autonomy, the highest-value MLOps KPIs are:

- site/ODD slice coverage for stands, service roads, pedestrian routes, terminal frontage, night, rain, fog, de-icing, and construction;
- false-free-space, missed personnel, FOD, aircraft-proximity, and protected-zone regression rates;
- map/model/calibration/runtime compatibility completeness;
- semantic-map label export eligibility and release-state leakage;
- split manifest coverage for local holdouts, replay sets, source-map tiles, prompt/labeler batches, and evidence-locked safety holdouts;
- trigger yield by safety, localization, perception, planning, weather, map change, and operator flag;
- reviewer correction rate for map-derived labels, open-vocabulary labels, VLM labels, and FOD candidates;
- rollback readiness for model, map, calibration, runtime, prompt pack, and semantic taxonomy changes;
- MTTR for anomalies joined across model, map, calibration, sensor health, weather, site operations, and OTA release.

These KPIs keep MLOps connected to operational risk. A model that improves average mAP but worsens personnel recall in fog at stands is a failed release candidate, not a successful experiment.

---

## Anti-Metrics

| Anti-metric | Why it is dangerous | Replace with |
|---|---|---|
| More data collected | Volume alone hides low-value, duplicated, or non-release-eligible data | Useful data yield, slice coverage, accepted-label impact |
| More labels completed | Speed can hide low QA and wrong allowed-use state | Accepted-label yield, correction rate, audit pass, model/replay impact |
| Higher aggregate mAP | Average can hide rare-class or ODD regressions | Slice metrics, hazard-class metrics, confidence intervals |
| Faster deployment | Autonomy release speed without evidence increases risk | Evidence-complete lead time and rollback readiness |
| Fewer alerts | Alert suppression can hide safety evidence | Alert precision, actionability, suppression audit, missed incident rate |
| Lower GPU spend | Cost cuts can starve replay, incident analysis, or safety evidence | Waste reduction versus reserved assurance capacity |
| Platform adoption percentage | Teams may use a platform while bypassing critical fields | Policy compliance, evidence completeness, bypass rate |

---

## Related Pages

- `mlops-scale-research-scope.md` - scale ladder, lifecycle controls, and research backlog.
- `mlops-reference-architectures-by-scale.md` - architecture blueprints and durable interfaces.
- `mlops-migration-checklist-by-scale.md` - migration readiness gates, workstream matrix, and adoption evidence packets.
- `experiment-tracking-reproducibility-by-scale.md` - run authority states, reproducibility levels, manifest contract, tracker options, and comparison rules.
- `model-registry-artifact-lifecycle-by-scale.md` - registry identity, alias authority, lifecycle states, artifact-set membership, and rollback retention KPIs.
- `serving-inference-operations-by-scale.md` - serving manifest coverage, endpoint readiness, traffic policy, autoscaling, ODD-cell canary, and rollback KPIs.
- `pipeline-orchestration-release-workflows-by-scale.md` - workflow state machines, orchestrator choices, artifact handoffs, release/evidence gates, and platform workflow KPIs.
- `evaluation-platform-replay-gates-by-scale.md` - evaluation manifest KPIs, replay pass/flake rates, runtime package gates, shadow/canary evidence, and platform evaluation SLOs.
- `dataset-split-leakage-controls-by-scale.md` - split-firewall KPIs, leakage modes, holdout controls, and split architecture tradeoffs.
- `model-monitoring-drift-response-by-scale.md` - drift-response KPIs, monitoring event contracts, alert-quality controls, and retraining trigger policy.
- `site-sliced-release-evidence-by-scale.md` - ODD-cell manifests, local holdouts, shadow/canary gates, and release-state approvals.
- `feature-embedding-store-ops-by-scale.md` - feature and vector-store health, leakage, freshness, recall, and invalidation controls.
- `offboard-labeler-registry-by-scale.md` - labeler, prompt, evaluator, retrieval, threshold, and reviewer workflow controls.
- `gpu-queueing-finops-by-scale.md` - queue wait, utilization, unit economics, priority lanes, and assurance capacity controls.
- `secure-artifact-attestation-profile.md` - artifact signing, SBOM/provenance, registry alias policy, and verification gates.
- `federated-privacy-preserving-training-policy-by-scale.md` - federated/hybrid/local training trigger policy, privacy controls, and release gates.
- `llmops-agent-evaluation-by-scale.md` - GenAI, RAG, judge, VLM/VLA, tool-agent, trace, and prompt-injection scorecards.
- `model-governance-release-evidence.md` - release packet, governance, and rollback evidence.
- `data-flywheel-airside.md` - closed-loop learning metrics, active learning, and label economics.
- `../observability/fleet-anomaly-root-cause-attribution.md` - fleet anomaly attribution and MTTR reduction.
- `../../40-runtime-systems/ml-deployment/production-ml-deployment.md` - runtime monitoring and promotion evidence.
- `../../40-runtime-systems/ml-deployment/perception-slam-runtime-interface-contract.md` - runtime telemetry and interface gates.
- `../data-platform/data-catalog-lineage-quality-ops.md` - data product quality, lineage, and promotion states.
- `../ota/perception-slam-artifact-compatibility-matrix.md` - artifact-set compatibility and activation gates.

## Sources

- Google Cloud, "MLOps: Continuous delivery and automation pipelines in machine learning." https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning
- Microsoft Azure Architecture Center, "MLOps maturity model." https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/mlops-maturity-model
- AWS Solutions, "AWS MLOps Framework." https://docs.aws.amazon.com/solutions/latest/aws-mlops-framework/
- MLflow, "MLflow Tracking." https://mlflow.org/docs/latest/ml/tracking/
- Weights & Biases, "Experiments overview." https://docs.wandb.ai/models/track
- DVC, "Experiment Management." https://doc.dvc.org/user-guide/experiment-management
- Apache Airflow, "Dags." https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dags.html
- Argo Workflows, "What is Argo Workflows?" https://argo-workflows.readthedocs.io/en/latest/
- Kubeflow, "Pipeline." https://www.kubeflow.org/docs/components/pipelines/concepts/pipeline/
- GitHub Docs, "Workflows." https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows
- PyTorch, "Reproducibility." https://docs.pytorch.org/docs/2.12/notes/randomness.html
- MLflow, "Model Registry Workflows." https://www.mlflow.org/docs/latest/ml/model-registry/workflow/
- Weights & Biases, "Reference an artifact version with aliases." https://docs.wandb.ai/models/registry/aliases
- Google Cloud, "Model versioning with Model Registry." https://cloud.google.com/vertex-ai/docs/model-registry/versioning
- Amazon SageMaker AI, "Model Registry Models, Model Versions, and Model Groups." https://docs.aws.amazon.com/sagemaker/latest/dg/model-registry-models.html
- Kubeflow, "Kubeflow Model Registry." https://www.kubeflow.org/docs/components/model-registry/
- NVIDIA, "NVIDIA Triton Inference Server Architecture." https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/architecture.html
- KServe, "Open Inference Protocol (V2 Inference Protocol)." https://kserve.github.io/website/docs/concepts/architecture/data-plane/v2-protocol
- Amazon SageMaker AI, "Blue/Green Deployments." https://docs.aws.amazon.com/sagemaker/latest/dg/deployment-guardrails-blue-green.html
- Google Cloud, "Deploy a model to an endpoint." https://cloud.google.com/vertex-ai/docs/general/deployment
- scikit-learn, "Common pitfalls and recommended practices: Data leakage." https://scikit-learn.org/stable/common_pitfalls.html
- TensorFlow, "Get started with TensorFlow Data Validation." https://www.tensorflow.org/tfx/data_validation/get_started/
- MLflow, "Model Evaluation." https://mlflow.org/docs/latest/ml/evaluation/
- TensorFlow, "Getting Started with TensorFlow Model Analysis." https://www.tensorflow.org/tfx/model_analysis/get_started
- Evidently AI, "Evaluations." https://docs.evidentlyai.com/metrics/introduction
- Evidently AI, "Tests." https://docs.evidentlyai.com/docs/library/tests
- Google Cloud, "Model evaluation in Vertex AI." https://cloud.google.com/vertex-ai/docs/evaluation/introduction
- AWS, "Data and model quality monitoring with Amazon SageMaker Model Monitor." https://docs.aws.amazon.com/sagemaker/latest/dg/model-monitor.html
- Microsoft Learn, "Model monitoring in production - Azure Machine Learning." https://learn.microsoft.com/en-us/azure/machine-learning/concept-model-monitoring
- Evidently AI, "Monitoring overview." https://docs.evidentlyai.com/docs/platform/monitoring_overview
- ISO/IEC 5259-5:2025, "Artificial intelligence - Data quality for analytics and machine learning (ML) - Part 5: Data quality governance framework." https://www.iso.org/standard/84150.html
- NIST, "Artificial Intelligence Risk Management Framework." https://www.nist.gov/itl/ai-risk-management-framework
- FinOps Foundation, "FinOps Framework." https://www.finops.org/framework/
