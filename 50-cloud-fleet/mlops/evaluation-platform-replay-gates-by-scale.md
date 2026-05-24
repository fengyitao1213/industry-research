# Evaluation Platforms and Replay Gates by Scale

**Last updated:** 2026-05-24

An evaluation platform is the control surface that decides whether a model, map, labeler, prompt pack, runtime package, or training export has earned more authority. It is not a dashboard of aggregate accuracy. At autonomy scale, evaluation must join offline metrics, slice metrics, calibration, OOD behavior, scenario replay, runtime package smoke, shadow disagreement, canary exposure, delayed labels, safety-case claims, and rollback readiness.

Use this page when designing the evaluation layer for MLOps programs from S0 research through S5 shared platforms. Use `mlops-scale-research-scope.md` for the maturity ladder, `experiment-tracking-reproducibility-by-scale.md` for run authority, `dataset-split-leakage-controls-by-scale.md` for independent release data, `serving-inference-operations-by-scale.md` for serving manifests, endpoint readiness, package parity, traffic policy, and shadow/canary telemetry, `pipeline-orchestration-release-workflows-by-scale.md` for workflow placement, `site-sliced-release-evidence-by-scale.md` for ODD-cell release manifests, and `model-governance-release-evidence.md` for the release packet that consumes evaluation evidence.

The core rule is: **the evaluated artifact set must be the released artifact set.** A checkpoint score is not release evidence if the deployed ONNX/TensorRT engine, container, map, calibration package, semantic taxonomy, prompt/labeler, replay pack, telemetry schema, or threshold policy differs from what was evaluated.

---

## What Evaluation Owns

Evaluation should be treated as a product with explicit owners, interfaces, and service-level goals.

| Owned surface | What it controls | Failure it prevents |
|---|---|---|
| Metric specification | Primary metric, secondary metrics, denominator, thresholds, confidence interval, and slice definitions | Teams compare candidates with incompatible metrics |
| Evaluator implementation | Code, container, dependency lock, hardware assumptions, random seed policy, and output schema | Metric drift caused by evaluator changes |
| Evaluation datasets | Holdouts, site/local splits, safety holdouts, replay packs, delayed-label samples, and benchmark snapshots | Training, tuning, or replay data leaks into release gates |
| Slice taxonomy | Site, route, zone, weather, lighting, map state, object class, vehicle kit, sensor health, task, and release-state labels | Aggregate gains hide local or safety-critical regressions |
| Scenario replay suite | Known incidents, mined scenarios, hazard cases, changed-map tiles, normal-operation clips, and regression-required scenarios | Field failures are not converted into repeatable gates |
| Runtime package check | ONNX/TensorRT/container loading, class order, latency, memory, determinism, and target hardware compatibility | Offline checkpoint passes but deployed artifact fails |
| Shadow and canary evidence | Disagreement, interventions, latency, monitor triggers, exposure denominator, and delayed labels | Live exposure is treated as anecdotal rather than evidence |
| Waiver and exception records | Owner, expiry, residual risk, mitigation, and revalidation trigger | Known regressions become permanent informal exceptions |
| Evaluation service health | Queue time, flake rate, cost, stale scenario age, evaluator availability, and evidence completeness | Shared evaluation becomes too slow or too untrusted to use |

Evaluation outputs should be immutable once they influence release. If a threshold, slice set, evaluator container, replay package, or dataset snapshot changes, the comparison state changes too.

---

## Scale Ladder

| MLOps scale | Evaluation posture | Minimum gate | Anti-pattern to block |
|---|---|---|---|
| S0 notebook research | Local metric scripts and failure examples | Record data pointer, split note, metric version, and representative failures when reusing a result | Claiming deployment readiness from exploratory validation |
| S1 repeatable prototype | Frozen split and deterministic evaluator | Baseline report with environment, metric spec, confidence interval, and failure samples | Moving the baseline while keeping the same scorecard |
| S2 production product | Candidate evaluation lane | Independent holdout, replay smoke, calibration/OOD checks, runtime package smoke, rollback target, and release packet | Promoting a checkpoint whose deployable package was not evaluated |
| S3 fleet and multi-site | ODD-cell evaluation | Site/route/weather/map-state slices, mined replay, shadow, canary, delayed-label join, and artifact compatibility | One global aggregate approves every site or district |
| S4 regulated safety-critical | Evidence-locked evaluation | Safety-case-linked claims, hazard replay, monitor impact, waiver expiry, rollback drill, and retention hold | Shipping with unresolved safety regressions hidden behind average metrics |
| S5 platform scale | Shared evaluation service | Multi-tenant eval registry, scenario catalog, policy templates, audit API, platform SLOs, and exception workflow | Every team creates incompatible release gates and cannot compare evidence |

The transition from S2 to S3 is the major autonomy boundary. S2 can evaluate one product for one operational context. S3 must prove that the artifact is safe for this specific ODD cell, not just globally better.

---

## Evaluation Authority States

Use explicit states so exploratory reports do not become release truth.

| State | Meaning | May block release? |
|---|---|---|
| `debug_eval` | Local, ad hoc metric or visualization used to understand behavior | No |
| `baseline_eval` | Frozen comparison used to compare future candidates | Blocks only baseline mutation |
| `candidate_eval` | Evaluation of a registry candidate before shadow/canary | Yes, for S2+ release review |
| `runtime_package_eval` | Evaluation of the deployable container, engine, map, calibration, schema, and thresholds | Yes, for S2+ deployment |
| `site_eval` | ODD-cell evaluation for a named site, zone, route, task, weather, and artifact set | Yes, for S3+ expansion |
| `safety_evidence_eval` | Evidence-locked evaluation tied to safety-case claims, hazards, waivers, and retention | Yes, for S4+ behavior authority |
| `incident_replay_eval` | Regression evaluation produced after an incident, drift event, or operator-triggered concern | Yes, when scenario state is `regression_required` |
| `platform_benchmark_eval` | Shared platform comparison across tenants, model families, or foundation-model tools | Blocks only if policy declares it release-relevant |

Authority should flow from run manifest to evaluation manifest to release packet. A report without authority state, dataset identity, evaluator identity, and artifact-set identity is useful for debugging but not for release.

---

## Evaluation Manifest Contract

At S2+, every release-relevant evaluation should emit a machine-readable manifest.

| Field | Required contents |
|---|---|
| `eval_id` | Immutable evaluation ID, authority state, owner, timestamp, workflow run ID |
| `candidate_artifact` | Model, map, semantic layer, prompt/labeler, adapter, runtime package, or training export under review |
| `baseline_artifact` | Champion or previous approved artifact set used for comparison |
| `artifact_set_hash` | Hash over model, engine/container, map, calibration, telemetry schema, taxonomy, evaluator, thresholds, and replay package |
| `dataset_scope` | Dataset snapshot, split IDs, local holdout IDs, safety holdout IDs, delayed-label sample, access class |
| `leakage_report` | Train/tune/eval/replay/site-holdout overlap checks and allowed-use state |
| `metric_spec` | Metric names, thresholds, confidence intervals, bootstrap or statistical method, denominator, abstention/OOD policy |
| `evaluator_identity` | Evaluator code commit, container digest, dependency lock, hardware class, random seed policy |
| `slice_set` | Site, route, zone, weather, lighting, map state, class, sensor, task, vehicle kit, release-state labels |
| `scenario_replay` | Scenario suite IDs, ASAM/OpenSCENARIO-aligned package version where used, simulator/runtime config, seeds |
| `runtime_smoke` | Package load, class order, latency, memory, determinism, hardware target, compatibility manifest |
| `shadow_canary` | Exposure denominator, cohort, time window, disagreement taxonomy, interventions, delayed-label join |
| `known_failures` | Failure IDs, severity, waiver state, owner, expiry, mitigation, revalidation trigger |
| `decision` | Pass, hold, reject, canary-only, restricted, rollback, deprecated, or requires safety review |
| `retention` | Evidence retention class, audit/export location, garbage-collection hold |

The manifest should be easy to produce locally at S1, but strict enough to become a service API at S5.

---

## Architecture Options

| Architecture | Advantages | Disadvantages | Best use |
|---|---|---|---|
| Local script or notebook evaluator | Fast, transparent, cheap, easy to modify | Weak lineage, fragile dependencies, easy to compare against moving data | S0 discovery and narrow debugging |
| CI/pytest-style metric smoke | Simple gate, close to code, catches obvious regressions | Too shallow for release, weak slice coverage, poor large-data handling | S1 baseline checks and package-level smoke |
| MLflow Evaluate-style run evaluation | Connects metrics, artifacts, datasets, model registry, and experiment tracking | Needs custom wrappers for robotics-specific replay, map, calibration, and runtime evidence | S1-S3 model comparison and registry-linked reports |
| TensorFlow Model Analysis-style sliced evaluation | Strong pattern for scalable sliced metrics and model analysis | TensorFlow/Beam orientation may not fit every robotics stack; replay and runtime checks remain separate | S2-S4 slice-heavy evaluation and fairness/ODD analysis |
| Evidently-style tests and reports | Strong data-quality, drift, reference-vs-current checks, and pass/fail test framing | Not a substitute for scenario replay or safety-case evaluation | S2-S5 data, monitoring, delayed-label, and regression-test scorecards |
| Managed cloud evaluation service | Fast integration with managed registries, pipelines, endpoints, and model metadata | Cloud coupling, data-residency constraints, limited custom scenario semantics | S2-S5 cloud-native teams with standard model families |
| Custom scenario replay service | Directly represents incidents, maps, actors, runtime packages, and ODD cells | Expensive to build, must control simulator validity, flake, cost, and coverage | S3-S4 autonomy releases and managed-site regression gates |
| Simulation/digital-twin evaluation platform | Tests rare hazards and map/site changes before field exposure | Fidelity limits, scenario authoring cost, possible false confidence | S3-S5 when natural exposure is too slow or unsafe |
| Data warehouse or BI scorecard | Good for fleet-wide trends, delayed labels, and operational KPIs | Can become passive dashboarding with no release authority | S2-S5 monitoring, post-release learning, and executive review |

Most autonomy programs need a hybrid: lightweight model-eval tooling for metric reports, a scenario replay path for behavior regressions, a monitoring scorecard for delayed evidence, and a governance layer that controls which outputs can block release.

---

## Evaluation Layers

| Layer | Question answered | Required from |
|---|---|---|
| Unit metric check | Does the evaluator still run and produce expected fields? | S0 |
| Offline holdout | Does the candidate improve on independent data? | S1 |
| Slice evaluation | Did any required class, site, weather, route, map state, or task regress? | S2 |
| Calibration/OOD/uncertainty | Are confidence, abstention, unknown, and threshold behavior controlled? | S2 |
| Runtime package evaluation | Does the deployable artifact load and meet edge constraints? | S2 |
| Serving manifest evaluation | Does the endpoint, batch job, traffic route, autoscaling policy, telemetry, and rollback path match the approved artifact set? | S2 |
| Replay regression | Do known incidents and required scenarios still pass? | S2 |
| Shadow disagreement | Does the candidate disagree with champion in acceptable ways on live inputs? | S3 |
| Canary/delayed-label evaluation | Does limited authority produce acceptable outcomes in the target ODD cell? | S3 |
| Safety-evidence evaluation | Does the evidence support a safety claim with retention, waiver, and rollback controls? | S4 |
| Platform benchmark | Can teams compare across shared model families, tenants, or evaluation templates? | S5 |

The layers are cumulative. A canary does not erase a replay regression. A replay pass does not prove live distribution coverage. A strong platform benchmark does not prove local site readiness.

---

## Replay Gate Design

Replay should be a release gate when a model can affect operations, maps, training labels, or safety evidence.

| Gate | Inputs | Output |
|---|---|---|
| Replay package validation | Raw log ID, map bundle, semantic layer, calibration, telemetry schema, scenario file, runtime config | Clean-worker reproducibility report |
| Artifact-set compatibility | Candidate model/runtime/map/calibration/taxonomy/prompt/evaluator IDs | Compatibility hash and mismatch blockers |
| Scenario selection | Required suite, changed tiles, recent incidents, local ODD cells, rare hazards, normal-operation controls | Suite manifest and coverage summary |
| Metric execution | Expected behavior, clearance, stop distance, lane/zone compliance, localization bound, perception correctness | Pass/fail plus metric deltas and videos/logs |
| Flake control | Repeated run policy, deterministic seeds, simulator/runtime version, hardware class | Stable/failing/flaky classification |
| Waiver review | Failure severity, residual risk, mitigation, owner, expiry, revalidation trigger | Hold, restricted release, or reject decision |

Replay suites need both failure cases and normal cases. A suite built only from incidents can overfit release gates to known failures while ignoring routine operations, comfort, throughput, and sensor-health conditions.

---

## Managed-Site and Urban-District Scope

Non-road managed sites require evaluation that is more local than public-road aggregate benchmarks:

- Airports need stand, apron lane, terminal frontage, service road, jetblast, de-icing, FOD, aircraft-proximity, and ground-crew slices.
- Ports and yards need quay, container lane, trailer, crane, worker, blind-corner, gate, and weather/dust slices.
- Warehouses and campuses need aisle, crossing, shared pedestrian space, loading bay, temporary work-zone, and shift-change slices.
- Urban districts that are not road-driving ODDs still need district-level map state, building frontage, sidewalk/service-lane geometry, construction, utility assets, crowds, and local operating rules.

For these settings, release evidence should be ODD-cell evidence. Public datasets and city-scale point-cloud benchmarks can pretrain models and expose failure modes, but they do not approve a local deployment. Local holdouts, replay scenarios, map-change cases, and delayed labels must carry the target site, route, task, and artifact-set IDs.

---

## LiDAR, Image, and Semantic-Map Evaluation

Aggregated LiDAR maps and LiDAR-image pipelines need evaluation contracts that preserve modality and release-state semantics.

| Evaluation topic | Required controls |
|---|---|
| LiDAR-only map segmentation | Evaluate point density, occlusion, intensity, scan-angle bias, multi-session registration quality, and tile stitching seams |
| LiDAR plus image fusion | Record calibration/projection hash, camera availability, lighting/weather state, image timestamp skew, and fallback behavior when image evidence is missing |
| Image-distilled LiDAR model | Treat teacher model, prompt pack, projection QA, and distillation dataset as release-affecting artifacts if they influence labels or thresholds |
| Map-derived pseudo-labels | Keep semantic class separate from release-state labels such as `permanent_static`, `dynamic_residual`, `static_transient`, `movable_static`, `artifact`, and `unknown_review` |
| ML-related SLAM inputs | Evaluate source-map geometry, loop/registration residuals, dynamic-object removal sidecars, static-transient quarantine, and changed-tile impact |
| Runtime semantic-map consumers | Verify map layer digest, taxonomy version, schema URL, compatibility hash, and rollback map before release |

For semantic maps, mIoU is necessary but insufficient. The evaluation must also show whether wrong points are release-eligible, whether false permanent structure can enter a runtime map, and whether static-but-transient objects such as stationary people, parked equipment, pallets, cones, or temporary barriers were quarantined instead of learned as permanent truth.

---

## Training and Evaluation Architecture Coupling

Training architecture affects the evidence architecture. The evaluation platform should make the coupling explicit.

| Training architecture | Evaluation advantage | Evaluation disadvantage | Best release posture |
|---|---|---|---|
| Centralized global model | One comparable artifact and broad data coverage | Hides local regressions and dominant-site bias | Require ODD-cell slices before S3 expansion |
| Global backbone plus site adapters/LoRA | Good transfer with small local evidence packets | Adapter registry, routing, rollback, and per-site thresholds add complexity | Evaluate each adapter as a release artifact |
| Site-specific models | Strong local fit and simple local thresholds | Fragmented evidence, high maintenance, weak cross-site learning | Use only for high-value or unusual ODD cells |
| Federated or hybrid training | Supports data-residency constraints and local privacy | Harder client lineage, aggregation evidence, poisoning checks, and local holdout discipline | Require client manifests, local evals, and aggregation reports |
| Self-supervised pretrain plus supervised fine-tune | Reduces label demand and improves representation reuse | Pretraining corpus can introduce hidden bias or privacy constraints | Record pretrain corpus, allowed-use state, and downstream release slices |
| Offboard/foundation-model labeler assisted training | Speeds labeling and open-vocabulary discovery | Prompt/model drift can contaminate labels and eval assertions | Require labeler registry, reviewer disposition, and eval-pack gates |
| Continual or triggered retraining | Faster response to drift and incidents | Can turn monitoring into uncontrolled behavior change | Mine data automatically; promote only through explicit eval gates |

The evaluation service should not simply score the final model. It should also evaluate whether the training route was eligible for the requested release authority.

---

## Release Blockers

| Blocker | Applies from | Why it blocks |
|---|---|---|
| Missing evaluation manifest | S1 for baselines, S2 for release | The report cannot be reproduced or tied to artifact authority |
| Unsupported evaluator comparison | S1-S5 | Candidate and baseline used different metric specs, slice sets, thresholds, or evaluator versions |
| Evaluation data leakage | S1-S5 | Training, tuning, pseudo-labeling, replay mining, feature building, or local holdouts contaminated the release gate |
| Runtime/evaluation artifact mismatch | S2-S5 | The released engine/container/map/calibration/taxonomy is not the evaluated artifact set |
| Serving/evaluation mismatch | S2-S5 | Endpoint, batch service, traffic policy, input schema, preprocessing path, autoscaling setting, or rollout scope differs from evaluated evidence |
| Replay suite mismatch | S2-S5 | Required incidents, changed tiles, hazard scenarios, or ODD-cell cases are missing |
| Target slice regression | S3-S5 | Aggregate score improves while site, class, weather, map-state, or task slice regresses |
| Missing shadow/canary denominator | S3-S5 | Live exposure cannot support the requested ODD-cell decision |
| Stale evaluation | S3-S5 | Map, calibration, taxonomy, dataset, evaluator, or runtime changed after the report |
| Flaky replay or evaluator | S3-S5 | Pass/fail state is not stable enough for release authority |
| Missing waiver owner or expiry | S4-S5 | Residual risk has no accountability or revalidation trigger |
| Platform policy bypass | S5 | Shared service cannot prove tenant isolation, evidence completeness, or release authority |

The blocked state should preserve evidence. A held release is useful: it names the missing artifact, owner, and next evaluation action.

---

## Scorecards

| KPI | Meaning |
|---|---|
| Evaluation manifest coverage | Percentage of baseline/candidate/release evaluations with complete manifest fields |
| Comparable-baseline rate | Percentage of candidates compared against a valid baseline with matching metric spec and slice set |
| Slice coverage | Required ODD/class/weather/map-state slices with sufficient denominator |
| Replay pass rate | Required scenarios passed by severity, ODD cell, and artifact set |
| Replay flake rate | Percentage of scenarios whose pass/fail state changes without artifact change |
| Evaluation lead time | Time from candidate registration to evidence-complete decision |
| Evaluation cost | Cost per candidate, replay hour, ODD-cell approval, and safety evidence packet |
| Stale scenario age | Age of regression-required scenarios and last passing release |
| Waiver aging | Open waivers by severity, owner, expiry, and mitigation |
| False pass / false block rate | Post-release failures after pass, and rejected candidates later found acceptable |
| Platform SLO | Eval service availability, queue time, artifact resolution success, and support response |

At S5, platform scorecards should measure adoption and bypass attempts, but product teams still own release decisions. A shared evaluation service can standardize evidence; it cannot absorb accountability for unsafe release scope.

---

## Related Pages

- `mlops-scale-research-scope.md` - MLOps maturity ladder and lifecycle controls.
- `mlops-reference-architectures-by-scale.md` - architecture placement for eval services and durable interfaces.
- `mlops-migration-checklist-by-scale.md` - when to add evaluation services and platform controls.
- `mlops-scorecards-and-kpis-by-scale.md` - KPI families, release blockers, and operating cadence.
- `experiment-tracking-reproducibility-by-scale.md` - run authority and reproducibility inputs to evaluation.
- `pipeline-orchestration-release-workflows-by-scale.md` - workflow state machine for build/eval/release separation.
- `serving-inference-operations-by-scale.md` - serving manifests, endpoint readiness, traffic routing, autoscaling, package parity, and rollback checks.
- `dataset-split-leakage-controls-by-scale.md` - split firewall and leakage controls for release evaluation.
- `model-monitoring-drift-response-by-scale.md` - monitoring, delayed-label, replay, and incident response inputs.
- `site-sliced-release-evidence-by-scale.md` - ODD-cell manifests and local release decisions.
- `model-governance-release-evidence.md` - release packets, aliases, approvals, and rollback evidence.
- `feature-embedding-store-ops-by-scale.md` - embedding/vector index evidence for scenario mining and eval data.
- `offboard-labeler-registry-by-scale.md` - prompt/model/evaluator artifacts that affect labels or evals.
- `secure-artifact-attestation-profile.md` - signed eval packs, replay packs, and runtime artifacts.
- `federated-privacy-preserving-training-policy-by-scale.md` - evaluation gates for federated, local, and hybrid training.
- `llmops-agent-evaluation-by-scale.md` - judge, prompt, RAG, VLM/VLA, and agent evaluation controls.
- `../data-platform/replay-scenario-mining-ops.md` - scenario mining and replay package promotion.
- `../data-platform/fleet-data-pipeline.md` - raw logs, data products, lineage, and retention.
- `../../40-runtime-systems/ml-deployment/production-ml-deployment.md` - runtime packaging and deployment evidence.
- `../../60-safety-validation/verification-validation/testing-validation-methodology.md` - simulation, replay, and validation methodology.
- `../../60-safety-validation/verification-validation/shadow-mode.md` - dual-stack shadow evidence.
- `../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md` - semantic-map release-state and training-export controls.
- `../../30-autonomy-stack/localization-mapping/overview/ml-related-slam-research-scope.md` - learned SLAM and map-cleaning handoff controls.

## Sources

- MLflow, "Model Evaluation." https://mlflow.org/docs/latest/ml/evaluation/
- TensorFlow, "Getting Started with TensorFlow Model Analysis." https://www.tensorflow.org/tfx/model_analysis/get_started
- Evidently AI, "Evaluations." https://docs.evidentlyai.com/metrics/introduction
- Evidently AI, "Tests." https://docs.evidentlyai.com/docs/library/tests
- Google Cloud, "Model evaluation in Vertex AI." https://cloud.google.com/vertex-ai/docs/evaluation/introduction
- Google Cloud, "Gen AI evaluation service overview." https://cloud.google.com/vertex-ai/generative-ai/docs/models/evaluation-overview
- NVIDIA, "NVIDIA Triton Inference Server Architecture." https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/architecture.html
- KServe, "Open Inference Protocol (V2 Inference Protocol)." https://kserve.github.io/website/docs/concepts/architecture/data-plane/v2-protocol
- ASAM OpenSCENARIO. https://www.asam.net/standards/detail/openscenario/
- ASAM OpenLABEL. https://www.asam.net/standards/detail/openlabel/
- Waymo, "Safe to Deploy: How We Know The Waymo Driver Is Ready For The Road." https://waymo.com/blog/2025/06/safe-to-deploy
- NIST, "Artificial Intelligence Risk Management Framework." https://www.nist.gov/itl/ai-risk-management-framework
