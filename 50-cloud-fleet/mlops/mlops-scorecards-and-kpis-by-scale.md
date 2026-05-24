# MLOps Scorecards and KPIs by Scale

**Last updated:** 2026-05-24

MLOps metrics should measure whether the ML system can be improved without losing reproducibility, safety, release control, or operational trust. A single "model accuracy" dashboard is not an MLOps scorecard. At production scale, the scorecard must join data quality, label quality, experiment reproducibility, release reliability, runtime behavior, incident response, cost, and governance evidence.

This page defines scale-specific KPIs for S0-S5 MLOps. Use it with `mlops-scale-research-scope.md` for maturity, `mlops-reference-architectures-by-scale.md` for architecture, `site-sliced-release-evidence-by-scale.md` for ODD-cell release blockers, `feature-embedding-store-ops-by-scale.md` for feature/vector-store health, and `model-governance-release-evidence.md` for release evidence.

---

## KPI Families

| KPI family | What it measures | Why it matters |
|---|---|---|
| Reproducibility | Whether a result can be rebuilt and compared | Prevents notebook results from becoming untraceable baselines |
| Data quality and lineage | Whether training/eval data is complete, valid, and attributable | Prevents models from learning from mutable, leaked, or unsafe data |
| Feature and embedding store health | Whether feature materializations and vector indices are fresh, reproducible, governed, and traceable | Prevents point-in-time leakage, stale retrieval, and unsupported reuse of derived representations |
| Label quality | Whether labels are correct, reviewed, and allowed for the intended use | Prevents auto-labels, map-derived labels, and prompt outputs from becoming false truth |
| Model quality | Whether offline metrics, calibration, uncertainty, and slices support the claim | Prevents aggregate improvements from hiding class, site, or ODD regressions |
| Runtime quality | Whether the deployable artifact meets latency, memory, determinism, and compatibility needs | Prevents a model that passes offline tests from failing on vehicle hardware |
| Artifact compatibility | Whether model, map, calibration, runtime, telemetry, semantic taxonomy, labeler, prompt, and replay artifacts are mutually valid | Prevents release from activating an artifact set that was never evaluated together |
| Release reliability | Whether candidate, shadow, canary, champion, and rollback transitions are controlled | Prevents training completion from becoming deployment approval |
| Observability and incident response | Whether anomalies become evidence-backed action | Prevents dashboards from replacing mitigation, rollback, or learning loops |
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
| Feature/vector store | Freshness, leakage, recall, and deletion propagation | Manual rebuild note or local index manifest | Point-in-time join tests, online/offline parity, index build ID, golden-query recall, deletion propagation | Immutable feature/index snapshot, audit trace, stale-index blocker, safety-case link |
| Labeling | Accepted-label yield | Manual acceptance rate | Accepted / submitted / rejected / reworked labels by class and site | Expert-review yield, vendor quality, audit-export completeness |
| Auto-labeling | Reviewer correction rate | Candidate-label usefulness | Correction rate by class, ODD, labeler version, prompt pack, and map release state | Safety-slice false acceptance rate and promotion-state violations |
| Experiment | Rebuild success | Can rerun locally | CI or pipeline can rebuild training/eval from manifests | Rebuild evidence preserved for audit window |
| Model quality | Primary metric and uncertainty | Basic metric with confidence interval | Aggregate plus class/site/weather/map-state slices | Hazard-slice thresholds and safety-case-linked claims |
| Calibration | ECE / reliability / abstention | Diagnostic plot | Threshold selection and unknown routing | Conformal or calibrated coverage evidence where required |
| Evaluation | Replay pass rate | Small smoke replay | Incident, rare-class, and map-change replay packages | Scenario catalog coverage, waiver expiry, and residual-risk record |
| Runtime | Package load and latency | Smoke test | p50/p95/p99 latency, memory, queue time, TensorRT/ONNX compatibility | Hardware cohort SLO, deterministic replay, degradation policy |
| Compatibility | Artifact-set compatibility | Manual note of model/map/calibration assumptions | Compatibility manifest with hash over model, map, calibration, runtime, telemetry, taxonomy, and rollback | Policy-enforced manifest with safety-case links, expiry, and incident retention |
| Deployment | Promotion lead time | Time from result to baseline | Time from candidate to shadow/canary/champion with evidence | Time from claim approval to controlled rollout with audit trail |
| Release reliability | Change failure rate | Regression count | Candidate hold/reject/rollback rate by cause | Safety-relevant change failure and corrective-action closure |
| Monitoring | Alert actionability | Failure notes become issues | Alerts produce label batch, replay case, rollback check, or ODD quarantine | Alert suppression audit, reportability, safety-case delta |
| Incident response | MTTR / containment time | Time to explain regression | Time to isolate artifact and affected cohort | Time to evidence freeze, rollback, and reportability decision |
| Cost | Unit cost | Cost per run | Cost per accepted label, training run, replay hour, released model/map | Cost per evidence pack, platform tenant, and reserved incident lane |
| Platform | Adoption and bypass rate | Not applicable | Shared registry/eval use by product team | Tenant compliance, bypass attempts, service SLOs, queue wait time |

The goal is not to maximize every metric. For example, low candidate rejection can mean weak exploration, and high deployment frequency can be dangerous if release evidence is shallow. Interpret KPIs against the scale and authority of the artifact.

---

## Release-Blocking Metrics

Some metrics are informational; others should block promotion. For autonomy, the blocker list must include safety and evidence conditions, not only model metrics.

| Blocker | Applies from | Example block condition |
|---|---|---|
| Missing immutable dataset or label snapshot | S1 for baselines, S2 for release | Candidate points to mutable bucket prefix or unlabeled local files |
| Label allowed-use violation | S2 | `candidate_label`, `movable_static`, `fod_candidate`, or `unknown_review` used as permanent-static positive without auxiliary-task declaration |
| Suspect feature or embedding snapshot | S2-S5 | Training, eval, replay, or safety evidence consumes a feature materialization or vector index whose source map, calibration, corpus, embedding model, deletion state, or backfill has been invalidated |
| Unregistered offboard labeler | S2-S5 | Training labels, semantic maps, replay assertions, or safety evidence consume outputs from a labeler, prompt pack, evaluator, threshold set, or retrieval corpus without registry evidence |
| Evaluation data leakage | S1-S5 | Training set overlaps with release gate, replay scenario, or site holdout |
| Missing ODD-cell release manifest | S3-S5 | Candidate expands to a new site, route, task, vehicle kit, weather band, or map state without site-sliced evidence |
| Runtime package mismatch | S2-S5 | Evaluated checkpoint differs from deployed ONNX/TensorRT/container artifact |
| Compatibility manifest mismatch | S2-S5 | Model, map, calibration, runtime, semantic taxonomy, prompt/labeler, telemetry schema, or replay pack differs from the evaluated artifact set |
| Target ODD slice regression | S3-S5 | Aggregate score improves but target site, night, rain, stand-entry, FOD, or personnel slice regresses |
| Safety monitor regression | S4-S5 | New model increases false-free-space, protected-zone violation, unsafe speed, or intervention correlation |
| Rollback not executable | S2-S5 | Previous model cannot load under active runtime, schema, calibration, or map package |
| Missing evidence retention | S4-S5 | Raw logs, replay package, release packet, approval, or incident evidence can be garbage-collected |
| Platform policy bypass | S5 | Team moves artifact outside shared registry/eval/policy controls |

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
- `site-sliced-release-evidence-by-scale.md` - ODD-cell manifests, local holdouts, shadow/canary gates, and release-state approvals.
- `feature-embedding-store-ops-by-scale.md` - feature and vector-store health, leakage, freshness, recall, and invalidation controls.
- `offboard-labeler-registry-by-scale.md` - labeler, prompt, evaluator, retrieval, threshold, and reviewer workflow controls.
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
- MLflow, "Model Registry Workflows." https://www.mlflow.org/docs/latest/ml/model-registry/workflow/
- ISO/IEC 5259-5:2025, "Artificial intelligence - Data quality for analytics and machine learning (ML) - Part 5: Data quality governance framework." https://www.iso.org/standard/84150.html
- NIST, "Artificial Intelligence Risk Management Framework." https://www.nist.gov/itl/ai-risk-management-framework
- FinOps Foundation, "FinOps Framework." https://www.finops.org/framework/
