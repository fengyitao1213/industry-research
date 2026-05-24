# MLOps Scale Research Scope

**Last updated:** 2026-05-24

This page defines the MLOps research scope across scale levels: individual research, small-team prototypes, production products, fleet-scale autonomy, regulated safety-critical deployment, and foundation-model-scale platforms. It is the routing page for deciding which MLOps controls are necessary now, which should be designed for later, and which are overkill at the current stage.

The core rule is that MLOps is not one stack. It is a maturity ladder for making ML changes reproducible, reviewable, deployable, observable, and reversible. At small scale, the main risk is irreproducible experiments. At fleet and regulated scale, the main risk is uncontrolled behavior change across vehicles, maps, labels, runtime artifacts, safety cases, and customer sites.

---

## What MLOps Covers

MLOps covers the operating system around models:

| Plane | What must be controlled | Examples |
|---|---|---|
| Problem and data contract | Task definition, label semantics, feature schema, ODD, acceptance metric | Class taxonomy, map release-state labels, sensor schema, scenario coverage |
| Data platform | Ingestion, storage, lineage, quality, privacy, retention, split hygiene | Rosbags, MCAP, Iceberg/DVC snapshots, lakehouse tables, event clips |
| Label operations | Annotation tools, auto-labelers, reviewer workflow, label QA | 3D boxes, semantic masks, map-derived pseudo-labels, FOD review |
| Experiment tracking | Code, config, metrics, artifacts, seeds, hardware, environment | MLflow, W&B, ClearML, custom run registry |
| Pipeline orchestration | Repeatable DAGs for preprocessing, training, evaluation, packaging | Airflow, Argo, Kubeflow Pipelines, TFX, GitHub Actions |
| Compute platform | GPU scheduling, images, caches, quotas, cost attribution | Workstations, cloud A100/H100, Kubernetes, Ray, Slurm |
| Model registry | Immutable model versions, aliases, approvals, rollback targets | MLflow aliases such as `candidate`, `shadow`, `champion`, `rollback` |
| Evaluation and validation | Offline metrics, slice metrics, calibration, replay, shadow mode, safety cases | mAP/mIoU, ODD slices, scenario replay, intervention correlation |
| Serving and deployment | Packaging, optimization, rollout, canary, rollback, compatibility | ONNX, TensorRT, Triton, KServe, BentoML, OTA manifests |
| Monitoring and feedback | Input drift, prediction drift, latency, resource health, delayed labels | Fleet telemetry, OOD alerts, model SLOs, data-mining triggers |
| Governance | Approval, auditability, policy, regulatory evidence, incident response | EU AI Act technical docs, ISO data-quality governance, safety-case links |

For autonomy, the planes are coupled. A model update is also a data update, map update, calibration dependency, runtime compatibility event, safety-case delta, and rollback commitment.

The companion `mlops-scorecards-and-kpis-by-scale.md` defines how to measure whether those planes are healthy at S0-S5. Use it to separate informational metrics from release blockers, especially for site/ODD slice regression, label allowed-use violations, runtime package mismatch, rollback readiness, and evidence retention. Use `site-sliced-release-evidence-by-scale.md` for ODD-cell release manifests and `feature-embedding-store-ops-by-scale.md` when deciding whether a derived representation belongs in manifests, offline feature tables, online serving, vector search, or an evidence-locked snapshot.

---

## Scale Levels

| Scale | Typical team / fleet | Primary objective | Minimum controls | Controls to avoid until needed |
|---|---|---|---|---|
| S0: notebook research | 1-3 people, no production users | Explore feasibility quickly | Git commit, deterministic config, raw-data pointer, run notes, fixed train/val/test split | Kubernetes, feature store, full registry workflow |
| S1: repeatable prototype | 2-8 people, demo or POC | Re-run a promising result and compare candidates | Experiment tracker, DVC/lake snapshot, Docker image, basic CI, validation script | Multi-region deployment, complex approval boards |
| S2: single-product production | 5-20 people, one site or service | Deploy one model safely and roll it back | Model registry, dataset manifest, offline plus replay gates, shadow/canary, runtime compatibility test | Federated learning, large feature platform, automated continuous training |
| S3: fleet and multi-site | 15-50 people, many vehicles/sites | Learn from operations without breaking local ODDs | Triggered data collection, site slices, active learning, release channels, fleet telemetry, calibration/map/model compatibility | One global champion without site constraints |
| S4: regulated safety-critical | Cross-functional org, audited releases | Prove absence of unreasonable risk for the requested ODD | Evidence packets, safety-case traceability, approver roles, immutable artifacts, scenario regression, incident and rollback drills | Metric-only promotion, unlabeled online learning |
| S5: foundation-model / platform scale | Platform org, many products and model families | Reuse data/compute/evaluation across model lines | Data lakehouse, feature/embedding store, GPU scheduler, multi-tenant registry, eval platform, governance automation, cost controls | Per-project bespoke data formats and ad hoc deployment scripts |

The common mistake is jumping from S0 to S5 tools before S1-S2 discipline exists. A feature store does not fix unclear labels. Kubernetes does not fix missing dataset manifests. A model registry does not prove safety unless the registry entry points to the evidence that justifies release.

---

## Architecture by Scale

| Component | S0-S1 pragmatic stack | S2-S3 production stack | S4-S5 platform stack |
|---|---|---|---|
| Source control | Git branch plus tagged experiment config | Protected branches, code owners, CI checks | Monorepo or federated repos with policy-as-code |
| Data versioning | DVC, object-store paths, manifest JSON | Lakehouse tables plus DVC/Iceberg snapshots | Data catalog, lineage graph, retention policy, privacy tiers |
| Orchestration | Makefile, scripts, GitHub Actions | Airflow, Argo, Kubeflow Pipelines, managed cloud pipelines | Multi-tenant orchestration with quotas, SLAs, lineage, audit logs |
| Training compute | Workstation, rented GPU, small cloud batch | Kubernetes/Ray/Slurm GPU pool, reproducible containers | Dedicated GPU fleet, scheduler, cache, cost attribution, capacity planning |
| Experiment tracking | MLflow/W&B run tracking | Run registry linked to dataset and code commits | Organization-wide experiment/eval warehouse |
| Registry | File path and release note | MLflow or managed registry with aliases | Registry integrated with policy, approvals, software bill of materials, rollback |
| Evaluation | Single validation split and smoke tests | Slice metrics, replay, calibration, regression suite | Eval service with scenario mining, red-team cases, safety-case claims |
| Serving | Local script or batch job | Triton/TensorRT, KServe, BentoML, managed endpoints, OTA artifacts | Multi-region serving, edge/cloud routing, progressive rollout, automated rollback |
| Monitoring | Logs and manual review | Latency, error rate, drift proxies, delayed-label metrics | Fleet-wide SLOs, incident response, root-cause attribution, compliance evidence |

### Pipeline Promotion Gates by Scale

The architecture should make promotion states explicit. A pipeline stage can automate artifact production, but promotion to the next authority level should require the evidence appropriate to that scale.

| Scale | Pipeline stages that may be automated | Promotion gate that must remain explicit | Evidence output |
|---|---|---|---|
| S0 | Preprocessing, training, local evaluation | Reusing the result outside the experiment | Run note and data pointer |
| S1 | Baseline rebuild, validation script, container build | Declaring a comparable baseline | Frozen split, metrics, environment |
| S2 | Training DAG, export, offline eval, replay smoke, package build | Moving candidate/shadow/champion/rollback aliases | Release packet and deployable artifact hash |
| S3 | Site-sliced training, replay, shadow, canary metrics, delayed-label joins | Expanding rollout to a new ODD cell | Canary report, local holdout metrics, blast-radius metadata |
| S4 | Evidence capture, safety-case linking, waiver expiry checks, rollback drill | Behavior-changing safety release | Claim/evidence table, approver record, incident-ready audit trail |
| S5 | Shared templates, policy-as-code, quotas, lineage capture, scorecard generation | Cross-product policy exception or platform change | Platform audit record, tenant impact, cost/SLO report |

This is the key distinction from web CI/CD: the pipeline can generate evidence automatically, but it should not silently create safety approval. Approval is a controlled state transition over artifacts, not a side effect of a green job.

Managed cloud platforms are useful at S2 when the team needs repeatability faster than it can build platform engineering. Open-source stacks become attractive when deployment targets, data gravity, cost, air-gapped sites, or custom vehicle constraints require more control.

For a concrete component-level blueprint, use `mlops-reference-architectures-by-scale.md`. The split is intentional: this page defines the maturity model and research scope; the reference-architecture page defines which components are local, shared, centralized, delayed, or policy-gated at S0-S5.

---

## Operating Model and Toolchain by Scale

MLOps maturity is also an ownership model. The same tool can be appropriate or wasteful depending on who owns it, who must approve changes, and whether it is tied to release evidence. A small team should keep the stack boring and explicit; a platform team should standardize interfaces so product teams do not reinvent data formats, labels, evals, and deployment scripts.

| Scale | Operating model | Toolchain stance | Review cadence | Failure mode |
|---|---|---|---|---|
| S0 notebook research | One owner per experiment | Git, notebook/script, fixed split, local artifact folder | Peer review only when result is reused | Nobody can reconstruct the result |
| S1 repeatable prototype | Research lead plus one reviewer | Experiment tracker, DVC/object snapshot, Docker, basic CI | Weekly baseline review | Demo becomes a hidden baseline |
| S2 production product | Model owner, data owner, runtime owner, release owner | Managed MLOps or lightweight OSS stack with registry and release packet | Candidate review before shadow/canary | Model ships without data/runtime/safety owner agreement |
| S3 fleet and multi-site | Product MLOps owner plus site operations and data platform owners | Lakehouse, orchestration, active-learning queue, site slices, fleet telemetry | Release train plus incident-driven review | Global process hides local ODD regressions |
| S4 regulated safety-critical | Cross-functional change-control board | Evidence system, immutable registry, safety-case traceability, rollback drills | Formal release review and periodic evidence expiry | Approval cannot be defended in audit or incident review |
| S5 platform scale | Central platform team with product-team consumers | Standardized data/model/eval/feature/embedding services, policy-as-code, self-service templates | Platform SLO review and product release review | Platform becomes bypassed because it is slower than bespoke pipelines |

### Build, Buy, or Borrow

| Decision | Prefer managed/cloud | Prefer open-source/self-hosted | Prefer simple scripts |
|---|---|---|---|
| Data versioning | Team needs quick lineage and cloud integration | Air-gapped, cost-sensitive, or custom map/log formats dominate | S0 fixed split and manifest are enough |
| Orchestration | Pipeline reliability matters more than platform flexibility | Custom GPU, on-prem, vehicle data gravity, or regulated isolation matters | One-off preprocessing or training |
| Model registry | Product releases need aliases and approvals | Artifact formats, offline operation, or custom metadata need control | Research checkpoint folder with release note |
| Evaluation service | Many teams share scenarios and judge/eval packs | Safety case requires bespoke scenario replay and evidence IDs | Local validation script for S0-S1 |
| Feature/embedding store | Online features or cross-product embeddings are reused | Offline-only autonomy logs with custom indexing dominate | Dataset manifests and precomputed files |
| Observability | Fleet/service metrics need standard SLO dashboards | Vehicle-specific telemetry and robotics traces need custom schemas | Manual logs and plots |

The anti-pattern is buying an S5 platform to compensate for S1 discipline gaps. Tooling should remove friction from an already defined contract; it should not define the labels, ODD, release criteria, or safety claim by itself.

### Responsibility Map

| Artifact or decision | Primary owner | Required collaborators |
|---|---|---|
| Label schema and taxonomy | Data owner | Model owner, safety owner, map owner |
| Dataset snapshot and splits | Data owner | Model owner, privacy/security owner |
| Training run and checkpoint | Model owner | Compute/MLOps owner |
| Evaluation suite and thresholds | Model owner | Safety validation, site operations |
| Runtime package | Runtime owner | Model owner, OTA/SUMS owner |
| Semantic map or map-derived labels | Map owner | Localization/SLAM owner, data owner, safety owner |
| Release approval | Release owner | Model, data, runtime, safety, fleet operations |
| Monitoring and rollback trigger | Fleet operations owner | Runtime owner, safety owner, MLOps owner |

At S2 and above, every promoted artifact should have a named owner and a named consumer. Unowned artifacts decay into stale data, stale thresholds, or stale assumptions.

---

## Lifecycle Controls

### 1. Problem and Label Contract

Every serious MLOps program starts with a contract, not a model. The contract names the prediction target, ODD, input schema, label schema, metrics, safety slices, and explicit non-goals.

For aggregated LiDAR maps, the label contract must include both semantic class and release state. `pavement` is a semantic class; `permanent_static`, `dynamic_residual`, `static_transient`, `movable_static`, `fod_candidate`, `artifact`, and `unknown_review` are release-state decisions. Training export must not collapse those fields.

### 2. Data Ingestion and Lineage

Data lineage needs to answer:

- Which raw logs, vehicles, sensors, calibrations, maps, and software versions produced this sample?
- Which preprocessing code, labeling model, prompt set, reviewer, and threshold changed it?
- Which train/validation/test split did it enter?
- Which model versions consumed it?
- Which deployed model generated the next data trigger?

At S0, a manifest file can answer these questions. At S3-S5, the answers need a data catalog and searchable lineage graph.

### 3. Labeling and Auto-Label Governance

Auto-labeling is a production system. Its model versions, prompts, thresholds, calibration inputs, acceptance rates, reviewer corrections, and failure slices must be versioned. Offboard labelers can change a dataset even when the deployed vehicle model does not change. Use `offboard-labeler-registry-by-scale.md` once a labeler, prompt pack, evaluator, retrieval corpus, or threshold can affect training, replay, semantic-map publication, or safety evidence.

For map-derived labels, the source map, semantic-map manifest, source-map acceptance package, map-hygiene layer, and pose back-projection must be part of the label lineage.

### 3.1 Label Operations and Active Learning by Scale

Labeling maturity is often the real limiter on MLOps scale. More GPUs cannot compensate for unclear class definitions, drifting instructions, weak reviewer QA, duplicated clips, or labels that are promoted beyond their evidence state.

| MLOps scale | Label workflow | Active-learning policy | Release control |
|---|---|---|---|
| S0 notebook research | Small manual labels or ad hoc pre-labels | Select examples to understand the problem | Keep labels research-only unless promoted later |
| S1 repeatable prototype | Fixed schema, task instructions, and dataset snapshot | Balance uncertainty with basic diversity | Freeze baseline labels before comparing models |
| S2 production product | Annotation batches tied to model registry and dataset manifests | Select under budget with dedupe, data-quality, class-balance, and risk filters | Only `qa_passed` labels enter product training |
| S3 fleet and multi-site | Per-site queues for drift, incidents, rare classes, and local holdouts | Budget by ODD cell, not only global uncertainty | Promotion records include site, allowed use, expiry, and downstream release packet |
| S4 regulated safety-critical | Expert-reviewed labels for hazards, FOD, false-free-space, personnel, and map-release states | Safety-weighted selection overrides pure model uncertainty | Evidence-bearing labels need audit trail and safety/data-owner approval |
| S5 platform scale | Shared labeling service with quotas, vendors, privacy tiers, and policy APIs | Portfolio-level optimization across products and tenants | Workflow state machine prevents unsupported reuse |

For autonomy, "auto-label accepted" should never be a single confidence threshold. It should mean the source data passed quality gates, the labeler version is approved, the taxonomy is compatible, reviewer sampling passed, and the downstream allowed-use state is explicit.

### 4. Training and Experiment Reproducibility

A training run is reproducible only when it records code commit, config, dependency lock, random seeds, hardware class, dataset snapshot, label schema, preprocessing version, augmentation policy, and evaluation code. At S2+, this should be machine-generated by the training pipeline rather than hand-written in a notebook.

### 5. Evaluation, Replay, and Promotion

Promotion should be claims-based:

| Claim type | Evidence |
|---|---|
| Accuracy improved | Primary metric, confidence interval, class and zone slices |
| Safety did not regress | Required scenario replay, new mined scenarios, hazard-class slices |
| Runtime is compatible | ONNX/TensorRT/Triton load test, latency and memory budget, target hardware |
| ODD is covered | Airport/site/weather/lighting/vehicle slice coverage |
| Data is clean | Leakage checks, label QA, source-map acceptance for map-derived data |
| Rollback works | Previous artifact still loadable under active runtime and schema |

Metric-only promotion is not enough for autonomy. A new model can improve average mAP while creating an unacceptable regression near aircraft stands, terminal frontages, utility corridors, or rare FOD classes.

### 5.1 Evaluation Evidence by Scale

Evaluation depth should grow with operational authority. The boundary from S2 to S3 is especially important: a product model can sometimes be released from a controlled offline gate, but a fleet model needs replay, shadow, canary, and delayed-label evidence before it is trusted across sites.

| MLOps scale | Evaluation baseline | Promotion evidence | Release anti-pattern to block |
|---|---|---|---|
| S0 notebook research | Train/validation split, sample visualization, run note | Metric table, limitations, representative failure examples | Claiming deployment readiness from exploratory runs |
| S1 repeatable prototype | Frozen dataset snapshot and deterministic evaluation script | Baseline comparison, confidence interval, basic class/slice table | Reusing the development set as the release gate |
| S2 production product | Independent holdout, calibration/OOD checks, and replay for known incidents | Release packet with model card, dataset manifest, container/engine smoke test, rollback artifact | Promoting a model whose runtime package was not evaluated |
| S3 fleet and multi-site | Site, route, weather, object, and map-state holdouts | Mined regression scenarios, deterministic replay, shadow disagreement, canary by ODD cell, delayed-label review | Treating a global aggregate score as approval for every site |
| S4 regulated safety-critical | Hazard-class scenario suite and safety-case-linked thresholds | Claim/evidence table, stress tests, monitor impact analysis, rollback drill, waiver owner and expiry | Shipping with unresolved safety regressions hidden behind average metrics |
| S5 platform scale | Standard evaluation service with shared schemas and policy checks | Organization-wide model/data inventory, automated evidence capture, cross-team scorecard, audit trail | Letting each team invent incompatible release gates |

Training data, tuning data, leaderboard data, and release-gate data must be treated as separate assets. At S3+, mined replay scenarios should be promoted into regression gates when they expose a credible field failure, not only when they improve an offline benchmark score.

### 6. Deployment and Rollback

Deployment modes should map to risk:

| Mode | Use case | Required guard |
|---|---|---|
| Offline batch | Labeling, map segmentation, scenario mining | Dataset lineage and reviewer QA |
| Shadow mode | Compare against active model without control authority | Output logging, disagreement metrics, latency budget |
| Canary | Limited vehicles, routes, sites, or times | Rollback artifact, monitor window, on-call owner |
| Active fleet | Production behavior | Compatibility manifest, safety-case link, incident triggers |
| Emergency rollback | Recover from regression | Tested rollback alias and cached artifact |

For vehicle and robot fleets, rollout is by ODD cell, not only by percentage. A 5% canary that covers only easy daylight routes does not prove a night/rain/stand-operation release.

### 6.1 Incident and Rollback Scale Ladder

MLOps is incomplete unless every release path has a matching incident and rollback path. At small scale this is mostly about reproducibility. At fleet and safety-critical scale it becomes containment authority, blast-radius analysis, reportability, and evidence preservation.

| MLOps scale | Incident response posture | Rollback or containment rule | Evidence that must survive |
|---|---|---|---|
| S0 notebook research | Record failure in the run notes | Stop reusing invalid results | Code/config, data pointer, sampled outputs |
| S1 repeatable prototype | Treat regressions as baseline hygiene issues | Freeze the benchmark until rerun is clean | Dataset snapshot, validation script, metric output |
| S2 production product | Release manager owns candidate hold/reject decisions | Roll back registry alias, container, prompt pack, or label batch before users depend on it | Release packet, package hash, replay/shadow report |
| S3 fleet and multi-site | Fleet SRE and ML owner jointly scope affected ODD cells | Quarantine by site, route, vehicle cohort, map tile, calibration, or model version | Active manifests, canary telemetry, raw clips, delayed labels |
| S4 regulated safety-critical | Incident commander and safety officer own response | Fleet/site stop and emergency rollback require documented risk acceptance and post-incident review | Incident timeline, safety-case delta, waiver, rollback drill proof |
| S5 platform scale | Platform owner manages tenant blast radius and policy state | Disable shared evaluator, registry alias, feature store, or pipeline lane through policy-as-code | Audit trail, tenant impact, policy decision, cost/SLO impact |

Rollback is not only model rollback. A safe recovery may require reverting a map layer, semantic taxonomy, calibration package, runtime container, feature flag, prompt pack, evaluator model, data snapshot, or release threshold. The compatibility manifest should define which artifact sets can move together.

### 7. Monitoring and Continuous Learning

Monitoring must separate system health from model quality:

| Monitoring layer | Signals |
|---|---|
| Runtime health | Latency, GPU memory, dropped frames, process restarts, TensorRT errors |
| Input quality | Missing sensors, calibration drift, timestamp skew, LiDAR return-rate change |
| Distribution drift | Feature statistics, weather/lighting mix, airport/site mix, object counts |
| Prediction behavior | Confidence distribution, unknown rate, cross-sensor disagreement, temporal flicker |
| Operational outcome | Interventions, near-misses, route failures, localization degradation, FOD tickets |
| Delayed labels | Human-reviewed precision/recall, scenario replay deltas, post-incident labels |

Continuous training should be gated, not automatic. Data can be automatically mined and queued; release still needs reproducible training, validation, shadow/canary evidence, and rollback.

### 7.1 Observability Response by Scale

Monitoring is valuable only when it creates a controlled response. At higher scale, an alert must name the affected artifact set and the evidence state it changes.

| MLOps scale | Observability scope | Response product | Failure mode to block |
|---|---|---|---|
| S0 notebook research | Training curves, sample outputs, obvious data defects | Run note or rejected result | Interesting failure disappears in a notebook |
| S1 repeatable prototype | Baseline metrics, reproducible validation, smoke runtime | Baseline drift report | Comparing models on changed data or code |
| S2 production product | Candidate health, package load, shadow disagreement, delayed labels | Release-ticket hold, label batch, replay case, rollback alias check | Monitoring finds issues but does not block promotion |
| S3 fleet and multi-site | Per-site and per-ODD drift, intervention correlation, artifact compatibility | ODD-cell quarantine, active-learning queue, local holdout update | Global dashboard hides local regression |
| S4 regulated safety-critical | Safety monitor activations, incident joins, waiver/suppression audit, rollback proof | Safety-case delta, reportability decision, emergency rollback package | Suppression hides safety evidence |
| S5 platform scale | Shared model SLOs, telemetry schema conformance, tenant ownership, alert quality, cost | Platform policy decision, scorecard, shared-service incident | Teams run bespoke silent monitors |

The observability schema should therefore carry both ML fields and autonomy fields: model version, prompt/evaluator version if relevant, dataset lineage, map package, semantic layer, calibration, runtime container, telemetry schema, site, route, ODD cell, vehicle hardware, and release channel.

---

## Foundation-Model, Prompt, and Agent Ops by Scale

GenAIOps, LLMOps, VLMOps, and agent operations are not separate from MLOps. They add new artifacts to the same release discipline: prompts, system instructions, retrieval corpora, tool permissions, evaluator prompts, judge models, trace logs, human feedback, synthetic data generators, and foundation-model checkpoints. In autonomy, these artifacts can alter datasets, semantic maps, incident reports, operator recommendations, and safety evidence even when no runtime detector or planner checkpoint changes.

| Scale | Typical foundation-model use | Minimum operational controls | Failure mode to prevent |
|---|---|---|---|
| S0 notebook research | Manual prompts against a cloud or local model for exploration | Prompt text in git, sample inputs/outputs, model name, date, data sensitivity note | A useful answer becomes tribal knowledge that cannot be reproduced |
| S1 repeatable prototype | Prompt pack for captioning, QA, data search, or offline labeling | Versioned prompt set, frozen eval examples, deterministic decoding where possible, manual error log | Demo prompt becomes a hidden production dependency |
| S2 single-product production | Offboard labeler, VLM scene reviewer, retrieval QA assistant, or model evaluator | Prompt registry, model/checkpoint ID, decoding config, retrieval corpus snapshot, tool allowlist, offline eval report, reviewer acceptance statistics | Foundation-model output changes labels, maps, or reports without release evidence |
| S3 fleet and multi-site | Site-specific prompt packs, local terminology, VLM/VLA copilots, fleet-scale data triage | ODD/site prompt variants, local holdout evals, trace sampling, drift monitors, per-site reviewer correction rates, rollback to previous prompt/model bundle | One global prompt works in one airport or district but fails in another |
| S4 regulated safety-critical | Advisory VLM/VLA reasoning, incident summarization, safety-case evidence generation | Human-in-the-loop approval, safety-case claim linkage, immutable traces, red-team and misuse evals, tool-permission review, prohibited-action policy | A probabilistic assistant is treated as certified decision logic |
| S5 foundation-model/platform scale | Shared foundation-model platform across products and teams | Multi-tenant prompt/model/tool/eval registry, policy-as-code, cost controls, data-governance tiers, automated eval pipelines, audit API | Teams reuse ungoverned prompts, judge models, or retrieval data across unrelated products |

The promotion rule is conservative: a foundation model may propose, summarize, review, rank, or explain, but it does not become release truth until the downstream artifact passes the normal data, model, map, and safety gates. A VLM-generated FOD label is a candidate until reviewer and QA evidence promote it. A judge-model score is a signal until calibrated against task-specific human labels. A retrieval-augmented answer is only as valid as the corpus snapshot, access policy, citation coverage, and evaluation suite recorded with it.

### Artifact Registry for GenAIOps

At S2 and above, the registry should track more than model weights:

| Artifact | Required fields | Why it matters |
|---|---|---|
| Prompt pack | Prompt text, system instruction, variables, examples, version, owner, intended task | Prompts change behavior like code |
| Model endpoint or checkpoint | Provider, model ID, checkpoint, quantization, hosted region, data-retention mode | Vendor/model updates can change outputs under the same API surface |
| Decoding and safety config | Temperature, top-p, max tokens, refusal/safety filters, abstention rule | Non-deterministic settings change label and report stability |
| Retrieval corpus | Document/data snapshot, embedding model, index build ID, access tier, expiry | RAG answers can drift when the corpus or embedder changes |
| Tool and agent policy | Tool allowlist, read/write scope, planner depth, human approval gates, timeout | Tool-using agents can mutate tickets, labels, or manifests |
| Evaluation pack | Golden examples, slice definitions, judge prompt/model, human labels, acceptance thresholds | LLM/VLM metrics are task-specific and need calibration |
| Trace bundle | Input digest, output, citations, tool calls, latency, reviewer correction | Debugging and audit require full lineage, not only final text |

### Evaluation Patterns

Foundation-model evaluation needs multiple layers because exact-match accuracy rarely captures the operational risk:

| Evaluation layer | What to measure | Autonomy example |
|---|---|---|
| Task correctness | Answer, label, or decision matches task-specific ground truth | VLM correctly identifies active pushback, FOD, stand closure, or staged GSE |
| Grounding and citation | Claims are supported by sensor evidence, map evidence, NOTAM, or retrieved document | NOTAM route impact answer cites the active closure and affected taxiway segment |
| Spatial consistency | Textual reasoning agrees with metric geometry and object tracks | "Loader is clear of aircraft" is checked against 3D clearance |
| Calibration and abstention | Confidence aligns with correctness and the model abstains on ambiguous cases | Low-quality night image triggers `unknown_review`, not a false permanent label |
| Robustness and adversarial behavior | Prompt injection, misleading signs, corrupted retrieval, ODD weather, rare objects | A malicious document cannot make the assistant approve an unsafe route |
| Human review load | Reviewer correction rate, time saved, disagreement categories | Auto-labeler reduces annotation time without raising false static-map positives |
| Regression across versions | Prompt/model/corpus update does not regress key slices | New prompt improves apron scenes but does not break terminal-frontage cases |

Use model-as-judge only as an evaluated instrument. The judge prompt, judge model, calibration set, and disagreement rate against humans must be versioned. For safety-relevant releases, judge-model scores should route review, not replace the approval authority.

### Autonomy-Specific Boundaries

For airside and non-road urban mapping, foundation-model operations must respect these boundaries:

- VLM/VLA copilots can advise, narrate, flag, or request a safety action, but direct vehicle control remains behind deterministic runtime assurance, Simplex, CBF, or planner safety gates.
- Open-vocabulary labels from VLMs, SAM/SAM2, Grounding-DINO, CLIP, ZOPP, SALT, OpenUrban3D, or similar tools stay in `candidate_label` state until reviewer, taxonomy, source-map, and QA evidence promote them.
- Foundation-model summarizers used for incidents or safety cases must preserve source links, scenario IDs, and evidence IDs; generated prose is not evidence by itself.
- Site-specific terminology matters. Airport stands, aprons, terminal frontages, service yards, pedestrian plazas, industrial estates, and depot lanes can use the same object name for different operational states.
- Privacy and data residency are deployment controls. Airside imagery, tail numbers, security staff positions, and customer operations data should not be sent to a cloud model unless the data-governance record explicitly allows it.

---

## Security, Privacy, and Cost Guardrails by Scale

MLOps scale is constrained by trust boundaries as much as by fleet size. The same pipeline that trains a detector also handles credentials, third-party packages, cloud GPUs, raw sensor logs, map evidence, labels, model weights, prompt packs, and deployment artifacts. At S0 the main control is not losing provenance. At S4-S5 the main control is preventing an untrusted artifact, over-permissioned pipeline, or runaway GPU job from changing safety evidence or fleet behavior.

| Scale | Security minimum | Privacy/data minimum | Cost and capacity minimum | Failure mode to prevent |
|---|---|---|---|---|
| S0 notebook research | Private data excluded or redacted, secrets outside notebooks, package versions recorded | Do not copy customer/airport data into personal storage | Manual GPU cost note per run | Sensitive data leaks through an exploratory notebook |
| S1 repeatable prototype | Locked dependencies, container image, secret manager, basic vulnerability scan | Dataset manifest names data sensitivity and retention class | Per-project budget, spot GPU limit, run owner tag | Prototype uses production data without retention or access policy |
| S2 production product | Signed containers/model artifacts, SBOM, registry ACLs, CI vulnerability gates | Access-controlled raw/curated zones, approved export path, DPIA where required | GPU job queue, cost tags, maximum job duration, idle cleanup | Candidate model is built from untrusted code, mutable data, or an unbounded GPU job |
| S3 fleet and multi-site | Site/tenant IAM boundaries, provenance for data/model/map/prompt artifacts, incident audit logs | Regional residency, airline/customer partitions, local retention overrides | Chargeback/showback by site, queue priorities for incidents and replay | One site can access another site's data or consume all training capacity |
| S4 regulated safety-critical | SLSA-style provenance, dual approval for release artifacts, secure build workers, evidence legal hold | Immutable incident and safety evidence, privacy review linked to safety case | Reserved capacity for replay and incident re-training, budget exceptions logged | Security or cost pressure deletes evidence needed for audit or incident review |
| S5 platform scale | Policy-as-code, multi-tenant artifact registry, attestation verification, platform-wide secrets and access reviews | Data catalog with sensitivity tiers, automated retention, cross-border controls | FinOps allocation, quotas, forecasting, unit cost metrics, GPU utilization SLOs | Teams bypass platform controls with shadow data lakes, models, or compute clusters |

### Secure Artifact Chain

Every promoted artifact should answer four questions:

| Question | Required evidence |
|---|---|
| Who built it? | CI identity, build worker, approver, service account, key/certificate identity |
| What was it built from? | Source commit, dependency lock, dataset snapshot, prompt pack, config, base image |
| Was it tampered with? | Hash, signature, SBOM/provenance attestation, registry verification result |
| Where may it run? | ODD/site scope, runtime image, hardware target, data tier, deployment alias |

This applies to TensorRT engines, ONNX exports, map tiles, semantic-map manifests, prompt packs, evaluation packs, Docker images, and batch-labeling outputs. The rule for S2+ is that an artifact not signed, versioned, and tied to evidence cannot be promoted by alias.

### GPU FinOps for ML Systems

GPU capacity becomes a shared product resource at S3+. Cost control should not mean blocking safety-critical learning; it should mean making priority, ownership, and waste visible. The detailed queueing and unit-economics policy is `gpu-queueing-finops-by-scale.md`.

| Control | S0-S1 | S2-S3 | S4-S5 |
|---|---|---|---|
| Ownership | Run notes | Mandatory owner/project/site tags | Cost allocation and approval workflow |
| Queueing | Manual scheduling | Shared queue with max duration and preemption | Priority lanes for incidents, release replay, and regulated evidence |
| Utilization | Manual review | Idle GPU cleanup, cache policy, spot/on-demand mix | Utilization SLO, reserved capacity plan, forecasting |
| Unit economics | Total run cost | Cost per labeled frame, scenario, training run, replay hour | Cost per released model/map/site and per safety-case evidence pack |
| Guardrails | Spending alert | Budget caps, quota, egress warning | Policy-as-code, exceptions logged, finance/engineering review |

For airside autonomy, cost and safety interact. Incident replay, retained raw data, and release evidence may be expensive, but deleting or skipping them can invalidate the safety case. The cost model must distinguish waste from required assurance capacity.

---

## Data Product, Feature, and Embedding Stores by Scale

Most autonomy programs do not need an online feature store early. They do need disciplined data products: immutable raw logs, decoded clips, labels, map-derived training exports, replay scenarios, evaluation sets, and model-ready tables. Feature and embedding stores become useful when many consumers reuse the same derived representation and need consistent lookup, lineage, access control, and expiry.

| Scale | Data product pattern | Feature/embedding stance | Promotion gate |
|---|---|---|---|
| S0 notebook research | Local files plus manifest | Avoid; precompute files if needed | Fixed split and run note |
| S1 repeatable prototype | DVC/object snapshots and small metadata table | Avoid online store; use offline feature cache | Dataset snapshot and validation script |
| S2 production product | Curated training/eval tables with release notes | Offline feature store only if multiple models reuse features | Data contract, quality report, label QA, registry link |
| S3 fleet and multi-site | Cataloged site/ODD data products, active-learning queues, replay sets | Offline feature/embedding store for mining, retrieval, and auto-labeling | Site slices, lineage graph, access class, retention tier |
| S4 regulated safety-critical | Evidence-locked datasets and replay packages | Feature/embedding snapshots must be immutable and evidence-linked | Safety-case claim link, deletion/retention review, waiver expiry |
| S5 platform scale | Shared lakehouse, catalog, feature/embedding service, lineage automation | Multi-tenant store with quotas, freshness, ACLs, and reproducibility controls | Policy-as-code, ownership, SLOs, audit trail |

### Store Selection Rules

| Need | Use manifests/files | Use offline feature store | Use online feature store | Use embedding/vector store |
|---|---|---|---|---|
| Reproduce a training set | Yes | Sometimes | No | No |
| Share expensive precomputed LiDAR/map features | No | Yes | No | Sometimes |
| Serve real-time model features | No | No | Yes, only if latency and consistency justify it | Rare for vehicle runtime |
| Mine similar incidents or rare scenes | No | Sometimes | No | Yes |
| Retrieve SOP/NOTAM/map documents for VLM tools | No | No | No | Yes, with corpus snapshots |
| Support safety evidence | Yes | Yes if immutable | Only with strict audit/freshness proof | Only as supporting search evidence |

For aggregated-map semantic segmentation, the most important data store is still the manifest-backed training export, not a generic feature platform. A back-projected label set must preserve source map, semantic layer, taxonomy, release-state label, split ID, reviewer state, and invalidation policy before it can enter training. The dedicated store guide (`feature-embedding-store-ops-by-scale.md`) separates reusable offline LiDAR/map features from vector-search indices used for scenario mining, active learning, and foundation-model label triage.

---

## Scale Transition Triggers

| Trigger | Indicates | Required upgrade |
|---|---|---|
| Two engineers cannot reproduce each other's result | Leaving S0 | Add run tracking, dataset snapshots, Docker, deterministic configs |
| A model is used by a customer, vehicle, or operations team | Entering S2 | Add registry, release evidence, rollback, runtime compatibility tests |
| Multiple sites or ODDs produce different failures | Entering S3 | Add site slices, deployment channels, active learning, local holdouts |
| A failure can create safety, legal, or regulatory exposure | Entering S4 | Add safety-case traceability, approval roles, incident process, immutable artifacts |
| Many teams train on shared data and compute | Entering S5 | Add platform contracts, governance automation, cost allocation, data catalog |

---

## Autonomy and Fleet-Specific Scope

Generic web-service MLOps is not enough for autonomous systems. The research scope must include:

- high-volume sensor data and selective upload;
- calibration, timestamp, map, and runtime compatibility;
- delayed or missing ground truth;
- scenario replay and simulation;
- edge inference packaging and deterministic runtime behavior;
- OTA/SUMS release channels and rollback;
- safety-case evidence and regulatory traceability;
- site-specific ODD slices and local holdout sets;
- map-derived pseudo-label governance;
- incident-driven mining and post-market monitoring;
- privacy and airport/customer data isolation.

This is why the local MLOps stack connects to the fleet data pipeline, production ML deployment, semantic-map manifest, OTA compatibility matrix, runtime verification, and model-governance evidence pages.

---

## Build Order for This Corpus

| Phase | Build first | Do not overbuild yet |
|---|---|---|
| P0: research discipline | Dataset manifests, run tracking, deterministic configs, basic eval scripts | Federated learning, feature platform, multi-cloud abstraction |
| P1: first deployed model | Model registry, release packet, shadow mode, canary, rollback | Continuous training without human gates |
| P2: fleet flywheel | Trigger mining, auto-label QA, active learning, site slices, semantic-map label export controls | One global model for all airports/sites |
| P3: regulated release | Safety-case traceability, scenario replay, incident linkage, evidence expiry | Metric-only approval or unversioned prompt packs |
| P4: platform scale | Data catalog, multi-tenant GPU scheduling, feature/embedding store, eval service, cost controls | Per-team bespoke pipelines |

For the reference airside AV stack, the practical near-term target is S2-S3: reproducible training, governed auto-labeling, registry-backed release packets, shadow/canary deployment, map-derived label eligibility, and fleet-triggered data mining. S4 controls are needed for safety-critical releases even if the fleet is still small.

---

## Research Backlog

| Priority | Research item | Why it matters |
|---|---|---|
| P0 | Unified model/data/map/calibration compatibility manifest | Prevents a model from deploying against the wrong semantic map, calibration, or runtime container |
| P0 | Map-derived pseudo-label invalidation protocol (`map-derived-pseudo-label-invalidation-protocol.md`) | Handles source-map corrections without contaminating future training sets |
| P0 | Site-sliced model release evidence (`site-sliced-release-evidence-by-scale.md`) | Avoids approving a model for every airport or managed site from one aggregate score |
| P1 | GPU cost and queueing model for training and replay (`gpu-queueing-finops-by-scale.md`) | Determines when to move from rented GPUs to owned, reserved, or queued capacity |
| P1 | Offboard labeler registry (`offboard-labeler-registry-by-scale.md`) | Treats foundation-model prompt packs and thresholds as release-affecting artifacts |
| P1 | Secure artifact attestation profile | Defines signing, SBOM, SLSA/provenance, and registry-verification requirements for models, maps, prompts, and containers |
| P1 | GPU FinOps unit-cost model (`gpu-queueing-finops-by-scale.md`) | Tracks cost per label, training run, replay hour, released model, released map, ODD-cell approval, and safety evidence pack so S3-S5 scale does not hide waste |
| P1 | Feature/embedding store decision guide (`feature-embedding-store-ops-by-scale.md`) | Clarifies when online feature stores matter versus when offline manifests are enough, and when vector retrieval needs corpus/index evidence |
| P1 | Reference architecture migration checklist | Prevents teams from buying S5 tooling before S1 reproducibility or shipping S2 models without release evidence |
| P2 | Federated and privacy-preserving training trigger policy | Identifies when cross-site data restrictions justify federated learning |
| P2 | LLMOps and agent-evaluation extension | Needed if VLM/VLA copilots, prompt packs, or tool-using agents become production artifacts |

---

## Related Pages

- `data-flywheel-airside.md` - closed-loop fleet learning and active data mining.
- `model-governance-release-evidence.md` - release evidence packet and approval controls.
- `mlops-reference-architectures-by-scale.md` - concrete S0-S5 architecture patterns, centralization boundaries, interfaces, and migration sequence.
- `mlops-scorecards-and-kpis-by-scale.md` - scale-specific scorecards, release-blocking metrics, KPI cadence, and anti-metrics.
- `site-sliced-release-evidence-by-scale.md` - ODD-cell release manifests, local holdouts, shadow/canary gates, and site-scope approvals.
- `feature-embedding-store-ops-by-scale.md` - feature-store, vector-search, and data-product controls by maturity level.
- `offboard-labeler-registry-by-scale.md` - prompt packs, foundation-model labelers, evaluator models, thresholds, and reviewer workflows as governed artifacts.
- `gpu-queueing-finops-by-scale.md` - GPU queueing, quotas, priority lanes, unit economics, and assurance capacity controls.
- `map-derived-pseudo-label-invalidation-protocol.md` - invalidation state machine and impact graph for semantic-map training exports.
- `../data-platform/fleet-data-pipeline.md` - raw logs, ingestion, storage, labeling, and fleet-scale data movement.
- `../../40-runtime-systems/ml-deployment/production-ml-deployment.md` - edge inference, monitoring, A/B testing, TensorRT, and Triton.
- `../../20-av-platform/compute/training-infrastructure.md` - GPU training infrastructure and experiment management.
- `../ota/perception-slam-artifact-compatibility-matrix.md` - compatibility of models, maps, calibration, runtime, and OTA artifacts.
- `../../60-safety-validation/standards-certification/ml-assurance-data-governance.md` - data and ML assurance controls.
- `../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md` - map-derived semantic labels and release-state training gates.

## Sources

- Google Cloud, "MLOps: Continuous delivery and automation pipelines in machine learning." https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning
- Microsoft Azure Architecture Center, "MLOps maturity model." https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/mlops-maturity-model
- AWS Solutions, "AWS MLOps Framework." https://docs.aws.amazon.com/solutions/latest/aws-mlops-framework/
- MLflow, "Model Registry Workflows." https://www.mlflow.org/docs/latest/ml/model-registry/workflow/
- Kubeflow, "Pipeline." https://www.kubeflow.org/docs/components/pipelines/concepts/pipeline/
- TensorFlow, "TFX: ML Production Pipelines." https://www.tensorflow.org/tfx
- Feast, "Introduction." https://docs.feast.dev/
- BentoML Documentation. https://docs.bentoml.com/
- Google Cloud, "Prompt management." https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/prompt-classes
- Google Cloud, "Gen AI evaluation service overview." https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/evaluation-overview
- Microsoft Learn, "Advance your maturity level for GenAIOps." https://learn.microsoft.com/en-us/azure/machine-learning/prompt-flow/concept-llmops-maturity?view=azureml-api-2
- AWS Machine Learning Blog, "FMOps/LLMOps: Operationalize generative AI and differences with MLOps." https://aws.amazon.com/blogs/machine-learning/fmops-llmops-operationalize-generative-ai-and-differences-with-mlops/
- NIST, "Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile." https://www.nist.gov/itl/ai-risk-management-framework
- NIST, "SP 800-218 Secure Software Development Framework." https://csrc.nist.gov/pubs/sp/800/218/final
- SLSA, "Security levels." https://slsa.dev/spec/v1.1/levels
- Sigstore, "Cosign signing overview." https://docs.sigstore.dev/cosign/signing/overview/
- Kubernetes, "Resource Quotas." https://kubernetes.io/docs/concepts/policy/resource-quotas/
- FinOps Foundation, "FinOps Framework." https://www.finops.org/framework/
