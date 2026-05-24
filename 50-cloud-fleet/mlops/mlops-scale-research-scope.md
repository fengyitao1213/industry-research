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

Managed cloud platforms are useful at S2 when the team needs repeatability faster than it can build platform engineering. Open-source stacks become attractive when deployment targets, data gravity, cost, air-gapped sites, or custom vehicle constraints require more control.

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

Auto-labeling is a production system. Its model versions, prompts, thresholds, calibration inputs, acceptance rates, reviewer corrections, and failure slices must be versioned. Offboard labelers can change a dataset even when the deployed vehicle model does not change.

For map-derived labels, the source map, semantic-map manifest, source-map acceptance package, map-hygiene layer, and pose back-projection must be part of the label lineage.

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
| P0 | Map-derived pseudo-label invalidation protocol | Handles source-map corrections without contaminating future training sets |
| P0 | Site-sliced model release evidence | Avoids approving a model for every airport or managed site from one aggregate score |
| P1 | GPU cost and queueing model for training and replay | Determines when to move from rented GPUs to owned or reserved capacity |
| P1 | Offboard labeler registry | Treats foundation-model prompt packs and thresholds as release-affecting artifacts |
| P1 | Feature/embedding store decision guide | Clarifies when online feature stores matter versus when offline manifests are enough |
| P2 | Federated and privacy-preserving training trigger policy | Identifies when cross-site data restrictions justify federated learning |
| P2 | LLMOps and agent-evaluation extension | Needed if VLM/VLA copilots, prompt packs, or tool-using agents become production artifacts |

---

## Related Pages

- `data-flywheel-airside.md` - closed-loop fleet learning and active data mining.
- `model-governance-release-evidence.md` - release evidence packet and approval controls.
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
