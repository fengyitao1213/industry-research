# Model Monitoring and Drift Response by Scale

**Last updated:** 2026-05-24

Model monitoring is the feedback control layer of MLOps. It detects when deployed or release-candidate models are no longer behaving like the evidence that approved them. For autonomy, monitoring must cover more than feature drift: model quality, input quality, output consistency, calibration, runtime health, serving manifest state, endpoint traffic policy, site/ODD slices, map and calibration state, delayed labels, replay regressions, intervention signals, and incident evidence all matter.

The key rule is that monitoring is not an automatic retraining switch. A drift alert should create a controlled artifact: a triage ticket, label batch, replay case, local holdout update, canary hold, ODD-cell quarantine, rollback decision, safety-case delta, or retraining proposal. Training remains gated by dataset lineage, split integrity, evaluation, shadow/canary evidence, and release approval.

---

## What Monitoring Must Answer

| Question | Example signal | Why it matters |
|---|---|---|
| Is the system alive? | Endpoint health, model load status, queue time, p99 latency, GPU memory, dropped frames | Runtime failure can masquerade as model failure |
| Is the serving route correct? | Serving manifest version, shadow/canary/champion route, traffic split, ODD-cell cohort, endpoint or batch job ID | A good model can be unsafe if served outside its approved scope |
| Is the input valid? | Missing sensor fields, timestamp skew, LiDAR point-count shift, camera exposure, calibration validity | The model may be fine but the input contract is broken |
| Is production like training? | Feature skew against training baseline, weather/site mix, object count distribution, map-state distribution | Training-serving skew can degrade performance before labels arrive |
| Is production changing over time? | Drift against recent production windows, seasonal shift, new aircraft or equipment type, construction zone | A model can become stale even with valid inputs |
| Are outputs changing? | Confidence distribution, unknown/OOD rate, class counts, occupancy/free-space changes, trajectory disagreement | Output drift may indicate model, map, threshold, or ODD change |
| Are predictions still calibrated? | Reliability curves, abstention rate, conformal coverage, false-free-space proxy | Overconfident wrong predictions are safety-relevant |
| What do delayed labels say? | Human-reviewed precision/recall, intervention correlation, replay delta, incident label result | Ground truth is delayed but decisive |
| Which artifact changed? | Active model, map, calibration, runtime, telemetry schema, prompt/labeler, feature/index snapshot | Root cause needs artifact identity, not only a graph |
| Which ODD cell is affected? | Site, route, zone, task, weather, lighting, vehicle kit, map release state | Fleet-wide averages hide local regressions |
| What action is justified? | Hold, mine data, replay, label, rollback, quarantine, safety review | Monitoring is only useful when it changes a controlled state |

---

## Signal Taxonomy

| Signal family | S2-S3 examples | S4-S5 examples | Common false interpretation |
|---|---|---|---|
| Service health | Endpoint ready, model loaded, inference count, latency p50/p95/p99, memory, queue time | Fleet SLO, tenant SLO, rollback drill telemetry, reserved incident-lane capacity | Treating latency as a model-quality metric |
| Data quality | Schema violations, missing fields, timestamp gaps, calibration missing, redaction failures | Evidence-retention gaps, privacy restriction, telemetry schema conformance | Retraining when ingestion is broken |
| Training-serving skew | Feature distribution differs from training snapshot | Evidence baseline no longer represents the approved ODD | Assuming all skew is harmful |
| Production drift | Current production window differs from prior windows | Seasonal/site drift, operations change, construction, tenant change | Ignoring drift because offline test is unchanged |
| Prediction drift | Output class counts, confidence, uncertainty, OOD, occupancy/free-space distribution | Safety-monitor activation rate, false-free-space proxy, abstention coverage | Treating high confidence as high correctness |
| Model quality | Delayed label precision/recall, slice metric, calibration, replay delta | Hazard-class metric, waiver expiry, safety-case claim delta | Waiting for enough natural exposure on rare hazards |
| Feature attribution drift | Saliency/feature-importance change, modality reliance shift | Explanation drift tied to safety argument or bias review | Treating explanations as causal proof |
| Bias or fairness drift | Protected class, worker area, site/tenant, or operational cohort disparity where applicable | Compliance-linked monitoring and review evidence | Applying generic bias metrics without a domain claim |
| Map and calibration drift | Localization covariance, map mismatch, changed tile, extrinsic shift, source-map age | Map/model compatibility invalidation and safety-case update | Blaming the model for stale maps |
| Human operations | Intervention rate, teleop request, operator override, near-miss note | Incident command, reportability assessment, corrective action | Treating operator behavior as noise |
| Foundation-model/agent drift | Prompt-output distribution, retrieval miss, judge disagreement, tool-call error | Trace retention, prompt-injection alert, policy-gated tool action | Treating generated summaries as evidence |

Managed services such as SageMaker Model Monitor, Azure ML model monitoring, and Vertex AI Model Monitoring use a common production pattern: collect production inputs/outputs, define a reference baseline, calculate monitoring metrics on a schedule or stream, compare to thresholds, and route alerts. Serving platforms such as Triton, KServe, Ray Serve, Seldon, BentoML, and managed endpoints also emit readiness, latency, queue, replica, and routing signals. Autonomy needs those signals joined with richer artifact IDs, ODD slices, delayed labels, and safety actions.

---

## Scale Ladder

| MLOps scale | Minimum monitoring | Response authority | Do not do |
|---|---|---|---|
| S0 notebook research | Record validation metric, representative failures, and data snapshot limitations | Research owner notes follow-up data needs | Claim production readiness from one validation plot |
| S1 repeatable prototype | Baseline metric trend, fixed split, smoke runtime stats, simple drift report if demo data changes | Research lead refreshes dataset or freezes baseline | Compare candidates on silently changed validation data |
| S2 single-product production | Endpoint/runtime health, schema checks, input/output drift, shadow disagreement, delayed-label sampling | Release owner can hold candidate, mine data, request labels, or roll back canary | Let training jobs automatically promote from drift alerts |
| S3 fleet and multi-site | Site/route/weather/vehicle/map-state monitoring, ODD-cell canary telemetry, active-learning triggers, local holdout updates | ODD-cell owner can quarantine a site/route/cohort and open replay or label tasks | Use a global dashboard to approve local behavior |
| S4 regulated safety-critical | Safety monitor activations, evidence freeze, waiver/suppression audit, reportability clock, rollback proof, safety-case deltas | Incident commander and safety owner can stop or restrict behavior authority | Suppress alerts without audit trail and expiry |
| S5 platform scale | Shared monitoring service, telemetry schema policy, tenant SLOs, alert-quality scorecard, cost and ownership controls | Platform policy can block unsupported release paths and open shared-service incidents | Allow teams to run silent bespoke monitors outside governance |

Monitoring scale follows artifact authority. A small fleet can need S4 monitoring if the model affects people or protected assets. A large offline model can remain S1 if it never influences release, labels, maps, or operations.

---

## Monitoring Architecture by Scale

| Architecture | Advantages | Disadvantages | Best use |
|---|---|---|---|
| Manual run notes and plots | Cheapest, fast to start, enough for exploration | No alerting, weak trend history, easy to lose context | S0 feasibility and early ablations |
| Scheduled batch monitoring job | Simple, privacy-friendly, works with delayed labels and batch inference | Not real time; window sizing matters | S1-S3 dataset drift, label QA, offline services, batch map segmentation |
| Managed cloud model monitor | Fast setup, built-in data quality/drift/model quality signals, alert integration | Tabular-first assumptions, cloud data gravity, limited autonomy metadata | S2 cloud endpoints, business models, non-safety services |
| Custom streaming telemetry | Low latency, ODD-specific, can join model/map/calibration/runtime IDs | More engineering, alert fatigue risk, schema discipline required | S2-S4 runtime perception, fleet canaries, safety-adjacent monitors |
| Embedded vehicle monitor | Detects degradation before cloud upload, works offline, can trigger safe mode | Tight compute budget, must be independent enough to trust | On-vehicle perception health and ODD enforcement |
| Fleet anomaly attribution service | Separates site, vehicle, map, model, weather, operator, and runtime causes | Needs historical data and causal/triage model maintenance | S3-S5 multi-site operations |
| Platform monitoring service | Shared telemetry schema, SLOs, ownership, alert quality, policy gates | Can be bypassed if slower than local tools; expensive if premature | S5 multi-team model platform |

The durable interface is not the dashboard. It is the monitoring event contract: active artifact IDs, ODD slice, signal family, threshold policy, owner, evidence state, and required action.

---

## Monitoring Event Contract

| Field | Requirement |
|---|---|
| `monitor_event_id` | Immutable event ID for alert, anomaly, drift run, or delayed-label result |
| `event_type` | Service health, data quality, skew, drift, prediction drift, calibration, OOD, delayed label, replay, incident, suppression |
| `artifact_set` | Model, runtime, map, calibration, telemetry schema, semantic taxonomy, prompt/labeler/evaluator, feature/index snapshot |
| `deployment_scope` | Site, route, zone, task, vehicle kit, weather/lighting, map release state, tenant, rollout channel |
| `serving_scope` | Endpoint, batch job, model server, service manifest, traffic policy, shadow/canary/champion state, autoscaling policy |
| `baseline_reference` | Training snapshot, validation snapshot, recent production window, safety holdout, replay suite, or SLO target |
| `comparison_window` | Production time window, fleet denominator, sample count, missing-data rate |
| `metric_payload` | Metric name, value, threshold, confidence/uncertainty, slice denominator, severity |
| `ground_truth_state` | None, delayed labels pending, human-reviewed, replay-evaluated, incident-confirmed |
| `evidence_links` | Logs, clips, traces, replay case, label batch, dashboard, release packet, safety-case claim |
| `action_state` | Informational, triage, label, replay, hold candidate, quarantine ODD cell, rollback, safety review |
| `owner_and_expiry` | On-call owner, model owner, site owner, safety owner, waiver/suppression expiry |

At S3+, every event should be joinable to active deployment manifests and data catalog records. Without those joins, monitoring cannot distinguish model drift from a map update, sensor degradation, calibration shift, operator procedure change, or weather event.

---

## Response State Machine

| State | Meaning | Exit criterion |
|---|---|---|
| `observed` | Metric or monitor emitted a signal | Event has owner, artifact IDs, denominator, and severity |
| `triaged` | Signal has been classified as noise, data issue, model issue, map/calibration issue, ODD shift, or unknown | First containment decision recorded |
| `contained` | Blast radius is limited by canary hold, ODD-cell quarantine, speed restriction, rollback, or operational mitigation | Affected cohort and active artifacts are known |
| `evidence_open` | Labeling, replay, root-cause analysis, or safety review is collecting evidence | Evidence packet links raw data and monitoring event |
| `actioned` | Team has selected data mining, label QA, retraining proposal, rollback, map fix, threshold fix, or no-op with reason | Decision owner signs or records action |
| `validated` | Fix or non-fix has been evaluated against clean split, local holdout, replay, shadow/canary, or safety evidence | Regression and side effects are checked |
| `closed` | Monitoring event is resolved or converted to a tracked backlog item | Postmortem or learning record exists when required |

Do not skip containment while waiting for labels. If a monitor plausibly indicates a safety-relevant degradation, restrict the affected ODD cell or cohort first, then refine root cause.

---

## Trigger-to-Action Matrix

| Trigger | S2 response | S3 response | S4-S5 response |
|---|---|---|---|
| Endpoint load failure or runtime latency breach | Hold canary or rollback runtime package | Restrict affected vehicle kit or site channel | Incident response, rollback proof, platform SLO record |
| Input schema or missing sensor drift | Block release and fix data/runtime contract | Quarantine affected sensor kit/site cohort | Evidence freeze if safety impact is plausible |
| Training-serving skew | Create triage ticket and candidate label batch | Slice by site/route/weather/map state; update active-learning queue | Review baseline validity and safety-case assumptions |
| Prediction confidence drift | Compare shadow/champion and mine samples | ODD-cell canary hold and local replay update | Safety monitor review if false-free-space/personnel/FOD risk |
| Delayed-label regression | Hold candidate or create retraining proposal | Local holdout update and site-scoped release review | Safety-case delta, waiver expiry, reportability assessment |
| Replay regression | Block promotion until fixed or waived | Add scenario to affected ODD-cell release gate | Hazard replay pack and approval record |
| Map/calibration anomaly | Check compatibility manifest and source-map state | Quarantine changed tiles, routes, or sensor kit | Map/model release review and evidence lock |
| Foundation-model prompt drift | Freeze prompt/labeler output beyond candidate use | Re-evaluate local prompt pack and reviewer corrections | Trace audit and policy gate for release-affecting outputs |
| Alert suppression request | Owner records reason and expiry | Suppression scoped by site/cohort/signal | Suppression audit and safety-owner approval |

---

## Retraining Trigger Policy

Retraining should be a controlled response, not the default response.

Retraining is justified when:

- a monitored degradation is reproducible on delayed labels, replay, shadow/champion disagreement, or clean local holdout evidence;
- the root cause is model/data mismatch rather than broken telemetry, stale map, calibration drift, runtime mismatch, or operating procedure change;
- a new training dataset can be built with split integrity, label QA, allowed-use state, and privacy controls;
- evaluation covers the affected ODD cell and relevant hazard classes;
- rollback and release evidence exist for the new candidate.

Retraining is not justified when:

- the drift signal is caused by bad ingestion, missing calibration, schema change, map staleness, or sensor degradation;
- the signal is informational and has no performance, safety, or operational consequence;
- the only evidence is an aggregate global drift metric with no affected slice;
- training would consume local holdouts, release replay, or safety evidence as ordinary training data;
- the artifact can be fixed with a map, calibration, threshold, runtime, or operational procedure change.

---

## Autonomy and Managed-Site Rules

Airside, port, yard, campus, warehouse, terminal-frontage, facade, and utility-infrastructure autonomy need site-aware monitoring because the same metric can mean different things by zone and operating phase.

| Managed-site condition | Monitoring implication |
|---|---|
| Repeated local geometry | Track route/zone-specific drift; do not hide behind fleet average |
| Construction or temporary closure | Link drift to map version, changed tiles, and operational notices |
| Stationary people or parked assets | Monitor static-transient and false-permanent labels separately from semantic class accuracy |
| Weather and surface state | Separate rain, fog, de-icing, snow, dust, wet floor, low sun, and night bins |
| Rare hazards | Use replay and targeted mining; natural exposure is too slow |
| Local operator procedure | Join intervention and teleop signals to task phase and site rules |
| Multi-tenant data boundaries | Keep tenant/site monitoring baselines and alert visibility separated |

For aggregated-map semantic segmentation and ML-related SLAM, monitoring should include map freshness, pose graph changes, loop closure events, source-map acceptance state, changed tile rate, localization covariance, dynamic residual rate, static-transient quarantine volume, and map-derived pseudo-label invalidation state.

---

## KPIs

| KPI | Meaning | Release use |
|---|---|---|
| Monitoring coverage | Percentage of release-affecting artifacts with active monitors | S2+ release readiness |
| Event attribution completeness | Events with model/map/calibration/runtime/site/ODD IDs | Required for incident root cause |
| Alert precision | Percentage of alerts that lead to valid action or evidence | Alert-quality scorecard |
| Alert latency | Time from anomaly onset to notification | S2-S5 operational SLO |
| Triage latency | Time from alert to owner and first classification | Incident readiness |
| Containment latency | Time from safety-relevant signal to hold, rollback, or quarantine | S3-S4 release safety metric |
| Delayed-label lag | Time from production exposure to reviewed label evidence | Retraining and post-market monitoring health |
| Replay conversion rate | Share of confirmed issues converted into regression replay cases | Learning-loop quality |
| Drift-with-action rate | Drift events that become label batch, replay, release hold, or documented no-op | Avoids dashboard-only monitoring |
| Suppression age | Age of active alert suppressions and waivers | S4-S5 audit blocker |
| False rollback rate | Rollbacks later found unnecessary | Signal quality and blast-radius calibration |
| Missed incident rate | Incidents not preceded by monitor warning or actionable alert | Monitoring gap evidence |

---

## Failure Modes

| Failure mode | Consequence | Control |
|---|---|---|
| Drift alert triggers automatic retraining | Model learns from unreviewed or contaminated data | Retraining trigger policy and release gates |
| Monitoring lacks artifact IDs | Root cause cannot separate model, map, calibration, runtime, or site changes | Monitoring event contract with active deployment manifest IDs |
| Aggregate dashboard hides local regression | A site or ODD cell degrades while global metric looks stable | Slice monitors by site, route, weather, vehicle kit, and map state |
| Alert has no runbook or owner | Dashboard noise replaces operational control | Owner, first triage query, action state, and expiry on every alert |
| Alert suppression never expires | Known safety evidence is hidden | Suppression audit, owner, expiry, and safety approval |
| Delayed labels are not joined | Model quality is inferred from proxies forever | Label sampling, replay, and post-incident review loop |
| Monitoring data becomes training data silently | Holdouts and post-release evidence are contaminated | Split/leakage controls and allowed-use state |
| Runtime monitor is not independent | The same failure disables model and monitor | Independent telemetry path or degraded safety monitor where required |
| Platform monitoring is too slow | Teams bypass it with local scripts | Self-service monitors with standard event contract and platform SLOs |
| Overbroad rollback or stop | Operational disruption and alert desensitization | Cohort/site/ODD-scoped containment options |

---

## Related Pages

- `mlops-scale-research-scope.md` - scale ladder and lifecycle controls.
- `mlops-scorecards-and-kpis-by-scale.md` - release-blocking metrics, cadence, and anti-metrics.
- `mlops-reference-architectures-by-scale.md` - S0-S5 architecture patterns and monitoring interfaces.
- `mlops-migration-checklist-by-scale.md` - migration gates and adoption evidence packets.
- `serving-inference-operations-by-scale.md` - serving telemetry, service manifests, traffic policy, endpoint readiness, autoscaling, and rollback hooks.
- `platform-sre-reliability-by-scale.md` - monitoring pipeline SLOs, alert-quality budgets, incident lanes, restore evidence, and platform bypass controls.
- `dataset-split-leakage-controls-by-scale.md` - split manifests and leakage controls for monitoring-derived datasets.
- `model-governance-release-evidence.md` - release packet, rollback, and incident evidence.
- `site-sliced-release-evidence-by-scale.md` - ODD-cell release manifests and local holdout gates.
- `data-flywheel-airside.md` - active learning, trigger mining, labels, and retraining loops.
- `../observability/fleet-anomaly-root-cause-attribution.md` - fleet anomaly triage and causal attribution.
- `../operations/fleet-sre-incident-response.md` - incident command, severity, and post-incident review.
- `../../40-runtime-systems/ml-deployment/production-ml-deployment.md` - runtime deployment and vehicle-side monitoring.
- `../../60-safety-validation/runtime-assurance/online-perception-monitoring-odd-enforcement.md` - on-vehicle perception quality and ODD enforcement.
- `../../60-safety-validation/runtime-assurance/runtime-verification-monitoring.md` - formal runtime monitors and safety envelopes.
- `../../60-safety-validation/safety-case/incident-reporting-post-market-monitoring.md` - post-market monitoring and reportability.

## Sources

- AWS, "Data and model quality monitoring with Amazon SageMaker Model Monitor." https://docs.aws.amazon.com/sagemaker/latest/dg/model-monitor.html
- Microsoft Learn, "Model monitoring in production - Azure Machine Learning." https://learn.microsoft.com/en-us/azure/machine-learning/concept-model-monitoring
- Google Cloud, "Introduction to Vertex AI Model Monitoring." https://docs.cloud.google.com/vertex-ai/docs/model-monitoring/overview
- Evidently AI, "Monitoring overview." https://docs.evidentlyai.com/docs/platform/monitoring_overview
- NVIDIA, "NVIDIA Triton Inference Server Architecture." https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/architecture.html
- Ray, "Ray Serve Autoscaling." https://docs.ray.io/en/latest/serve/autoscaling-guide.html
- TensorFlow, "Get started with TensorFlow Data Validation." https://www.tensorflow.org/tfx/data_validation/get_started/
- OpenTelemetry, "What is OpenTelemetry?" https://opentelemetry.io/docs/what-is-opentelemetry/
- Prometheus, "Alerting rules." https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/
- Google Site Reliability Engineering, "Incident Management Guide." https://sre.google/resources/practices-and-processes/incident-management-guide/
