# Pipeline Orchestration and Release Workflows by Scale

**Last updated:** 2026-05-24

Pipeline orchestration is where MLOps discipline becomes enforceable. A workflow engine can run preprocessing, labeling, training, evaluation, export, replay, packaging, attestation, and deployment tasks, but the important design question is not "which orchestrator should we buy?" It is which state transitions must be automated, which must be gated, which artifacts must be immutable, and which failures should block release.

Use this page with `mlops-scale-research-scope.md` for maturity, `experiment-tracking-reproducibility-by-scale.md` for run manifests, `model-registry-artifact-lifecycle-by-scale.md` for registry lifecycle and alias authority, `evaluation-platform-replay-gates-by-scale.md` for evaluation manifests and replay/runtime/shadow evidence, `dataset-split-leakage-controls-by-scale.md` for split gates, `model-governance-release-evidence.md` for release packets, `secure-artifact-attestation-profile.md` for trust-chain gates, and `gpu-queueing-finops-by-scale.md` for workload routing.

The core rule is simple: orchestration may produce evidence automatically, but it must not silently create release authority. A green DAG can create a candidate. It cannot move a model, semantic map, labeler, prompt pack, or runtime artifact into production without the required evidence and approval state.

---

## What Orchestration Owns

| Layer | What it owns | What it must not hide |
|---|---|---|
| Workflow definition | Task graph, dependencies, retries, resources, schedules, parameters | Unclear artifact contracts between tasks |
| Execution | Running jobs, containers, GPU/CPU resources, logs, task status | Missing provenance, dirty code, mutable input data |
| Artifact handoff | Passing datasets, models, metrics, reports, exports, and evidence IDs | Untyped side effects in buckets or local folders |
| Policy hooks | Blocking missing manifests, failed checks, unsigned artifacts, unapproved labels | Release approval disguised as a pipeline step |
| Observability | Queue time, failure cause, retry rate, duration, cost, stale tasks | Dashboard-only status without downstream action |

An orchestrator is not a registry, data catalog, experiment tracker, or safety case. It should call those systems and write their IDs into the run record.

---

## Scale Ladder

| Scale | Orchestration posture | Minimum workflow | Explicit gate |
|---|---|---|---|
| S0 notebook research | Manual commands and run notes | `prepare -> train -> eval` script or notebook cell order | Result reused outside the notebook |
| S1 repeatable prototype | Makefile, DVC pipeline, GitHub Actions, simple CI | Rebuild baseline, emit metrics, preserve config and split | Declaring a comparable baseline |
| S2 single-product production | Product training/eval/package workflow | Decode/QA/label/train/eval/export/register candidate | Moving candidate to shadow/canary/champion |
| S3 fleet and multi-site | Site/ODD-aware workflows with queues | Site-sliced train/eval/replay/export with local holdouts and trigger batches | Expanding release scope to a new ODD cell |
| S4 regulated safety-critical | Evidence-preserving controlled workflows | Release replay, safety slices, rollback drill, attestation, retention hold | Behavior-changing safety release |
| S5 platform scale | Multi-tenant workflow platform with policy templates | Standard pipelines for datasets, labels, training, eval, release, incident, audit | Cross-product policy exception or platform workflow change |

The main migration from S1 to S2 is not adopting a bigger engine. It is separating build, evaluate, register, promote, deploy, and approve as different states with different evidence.

---

## Workflow Authority States

| State | Meaning | Can be automatic? | Evidence required |
|---|---|---|---|
| `draft_workflow` | Local or branch workflow under development | Yes | Owner, repo, intended task |
| `baseline_workflow` | Rebuilds a frozen baseline | Yes | Frozen split, config, metric spec, reproducibility level |
| `candidate_workflow` | Produces a reviewable artifact | Yes | Dataset/split manifests, run manifest, eval report, output digest |
| `release_workflow` | Produces release evidence for a named artifact set | Partly | Release packet, replay, runtime package, attestation, rollback proof |
| `evidence_workflow` | Produces audit, safety, incident, or corrective-action evidence | Partly | Immutable logs, retention class, safety-case/incident IDs |
| `platform_workflow` | Shared template used by many teams | Yes, after review | Versioned template, policy test, tenant impact, rollback path |

Workflow authority should be versioned independently from model authority. A new pipeline template can change artifact behavior even when model code is unchanged.

---

## Orchestrator Comparison

| Pattern | Best fit | Advantages | Disadvantages | Autonomy note |
|---|---|---|---|---|
| Shell script / Makefile | S0-S1 local reproducibility | Transparent, cheap, easy to review | Weak retries, weak lineage, hard to scale | Good first step if it writes manifests |
| DVC pipeline | S1-S2 data/model reproducibility | Git-native stages, data dependencies, metrics, cache, `dvc repro` workflow | Less suited to multi-tenant operations and long-running fleet services | Strong for LiDAR/map snapshots and deterministic preprocessing |
| GitHub Actions | S1-S2 CI, smoke tests, export checks | Repo-native triggers, PR checks, reusable actions | Not ideal for long GPU training or complex fleet data DAGs | Good for schema checks, tiny training smoke, ONNX/TensorRT export validation |
| Apache Airflow | S2-S4 scheduled data and batch workflows | Mature DAG scheduling, backfills, sensors, operators, operational UI | Python DAG lifecycle and task artifact conventions require discipline | Strong for fleet data ingest, decode, QA, label export, daily mining |
| Argo Workflows | S2-S5 Kubernetes-native batch jobs | Container-native, DAG/step workflows, parallelism, Kubernetes resource control | Needs Kubernetes operations and artifact repository discipline | Strong for GPU batch, map segmentation, replay, and release eval jobs |
| Kubeflow Pipelines | S2-S5 ML component pipelines | ML-first components, artifact passing, metadata, caching, resource requests | Platform complexity and version management | Good when train/eval/export are typed ML components |
| TFX pipelines | S3-S5 production ML pipelines | Strong ML metadata, component typing, model analysis/evaluation concepts | Best fit for TensorFlow/TFX-style stacks; heavier adoption | Useful where lineage and component reuse matter more than tool lightness |
| Ray workflows/train/tune pattern | S2-S5 distributed Python workloads | Flexible distributed training, data processing, sweeps, simulation, resource APIs | Needs resource hygiene and platform observability | Useful for simulation/replay, training, evaluation, and map-scale batch compute |
| Slurm pipelines | S3-S5 on-prem/HPC clusters | Mature fair-share scheduling, GPU resources, accounting, large clusters | Less cloud-native; MLOps metadata integration is extra work | Good for owned GPU clusters if job metadata is bridged to tracker/registry |
| Managed cloud ML pipelines | S2-S4 cloud-aligned teams | Fast setup, integrated tracking/registry/serving options | Vendor coupling, cost, metadata model limits, data-residency constraints | Useful until custom vehicle/map/evidence metadata outgrows managed schema |

The common industry pattern is hybrid: GitHub Actions for code/schema checks, DVC for local data stages, Airflow for data products, Argo/Kubeflow/Ray for GPU jobs, and a registry/policy layer for release authority.

---

## Durable Pipeline Interfaces

Every task boundary should pass typed artifacts, not path strings.

| Interface | Required fields | Produced by | Consumed by |
|---|---|---|---|
| Pipeline run manifest | `pipeline_run_id`, workflow version, trigger, parameters, owner, input artifact IDs, output artifact IDs, state | Orchestrator | Tracker, catalog, audit |
| Dataset build record | raw sources, decode version, QA result, privacy/access class, retention class | Ingest/decode workflow | Training, replay, catalog |
| Split manifest | split ID, grouping keys, leakage report, holdout policy, access log | Dataset workflow | Training/eval/release |
| Label batch record | taxonomy, labeler/prompt/evaluator IDs, reviewer workflow, QA state, allowed use | Label workflow | Training, semantic maps, safety evidence |
| Training run manifest | code/config/environment/data/split/metric/output lineage | Training workflow | Registry, governance |
| Evaluation manifest/report | eval authority, metric spec, evaluator version, artifact-set hash, aggregate and slice metrics, replay IDs, runtime smoke, failures, waivers | Eval workflow | Release packet |
| Runtime package manifest | ONNX/TensorRT/container digests, class order, hardware target, compatibility IDs | Export workflow | Deployment, OTA/SUMS |
| Attestation bundle | subject digest, builder identity, workflow ID, SBOM/provenance, policy result | Build/sign workflow | Registry, deployment policy |
| Release packet | claim, evidence links, approvers, scope, rollback, expiry | Release workflow | Governance, OTA, safety case |
| Incident evidence record | active artifacts, logs/clips, replay, containment, corrective action | Incident workflow | Safety case, post-release learning |

If a task writes an artifact that no downstream system can name by immutable ID, the workflow is not production-ready.

---

## State Machine

The safe production lane is a state machine, not one long DAG:

| State | Entry condition | Exit condition |
|---|---|---|
| `data_candidate` | Raw data uploaded or mined | Data QA, privacy/access, decode, and manifest pass |
| `training_snapshot` | Data is eligible for training | Split/leakage report and label QA pass |
| `model_candidate` | Training produces checkpoint/export | Eval report, runtime package, output digest, run manifest pass |
| `release_candidate` | Candidate is registered for review | Release packet, replay, site/ODD scope, attestation, rollback proof pass |
| `shadow` | Artifact is safe for non-authoritative execution | Shadow metrics and delayed-label review pass |
| `canary` | Limited authority in scoped ODD cell | Canary report and local holdout pass |
| `champion` | Release approved for named scope | Monitoring and rollback remain valid |
| `held` | Evidence or metric gap blocks progress | Owner fixes gap or expiry/waiver review resolves |
| `quarantined` | Artifact/data may be unsafe or invalidated | Rebuild, reapprove, or deprecate |

The orchestrator can move data through early states automatically. Human or policy approval should control transitions that change release authority.

---

## Autonomy Workflow Families

### Fleet Data Product Workflow

`upload -> decode -> timestamp/calibration QA -> privacy/access check -> trigger classification -> clip/scenario packaging -> data catalog -> training/replay eligibility`

Controls:

- fail closed on timestamp, calibration, schema, or access-state gaps;
- separate event clips, random samples, local holdouts, replay scenarios, and training exports;
- preserve raw evidence for incidents and safety-relevant triggers.

### Semantic Map and Aggregated LiDAR Workflow

`source logs -> SLAM/map build -> map geometry QA -> dynamic/static-transient removal -> semantic segmentation -> tile stitching -> map-hygiene QA -> publication or training export`

Controls:

- source-map acceptance package before segmentation;
- map-hygiene sidecars and release-state masks before publication;
- split/leakage and pseudo-label invalidation checks before training export;
- separate runtime map, training export, monitoring, digital-twin, and benchmark product modes.

### Model Candidate Workflow

`training snapshot -> train -> eval -> slice metrics -> replay smoke -> export -> runtime smoke -> registry candidate`

Controls:

- train/eval/export are child runs under one candidate authority record;
- candidate registration requires run manifest, output digest, metric spec, and runtime package manifest;
- release gate remains separate from training completion.

### Offboard Labeler and Foundation-Model Workflow

`prompt/model/corpus registration -> candidate inference -> reviewer workflow -> QA -> allowed-use promotion -> rollback impact`

Controls:

- prompt, retrieval corpus, model endpoint, threshold set, and reviewer workflow are artifacts;
- outputs remain candidate labels until review/QA/allowed-use state permits training or evidence use;
- generated prose is supporting context, not release evidence by itself.

### Incident and Corrective-Action Workflow

`incident trigger -> evidence freeze -> active artifact query -> replay reproduction -> root-cause candidate -> corrective action -> regression test -> release/safety-case update`

Controls:

- incident lane preempts research work when required;
- evidence records include model/map/calibration/runtime/taxonomy/prompt/evaluator IDs;
- corrective actions update replay packs, labels, monitoring, and release blockers.

---

## Scheduling and Resource Policy

Orchestration and scheduling are related but different:

| Decision | Orchestrator owns | Scheduler owns |
|---|---|---|
| What steps run | DAG, task definitions, dependencies | No |
| Where steps run | Resource requests, node selectors, container image | Actual admission and placement |
| When steps run | Trigger, schedule, backfill, retry | Queue priority, quotas, preemption |
| What artifacts move | Inputs, outputs, metadata IDs | Usually no |
| What capacity is reserved | Workload class and requested lane | Partition/queue/cohort capacity |

At S3+, tie workflow states to queue classes from `gpu-queueing-finops-by-scale.md`: research, baseline rebuild, candidate train, release eval, map semantic batch, labeler batch, incident response, and platform maintenance. Release replay and incident evidence should not wait behind exploratory sweeps.

---

## Non-Road Managed-Site Rules

Airport aprons, ports, logistics yards, warehouses, mines, campuses, and construction districts need local ODD state inside the workflow:

- Site, zone, task, weather, shift, map revision, vehicle kit, and local operating rule are workflow parameters, not notebook notes.
- Site holdouts and replay packs must be separate artifacts from training snapshots.
- A workflow may pass globally and still fail a target ODD cell; the release workflow should hold only the affected scope when possible.
- Map publication workflows can require S4-style evidence even for a small fleet if wrong free space, personnel labels, FOD state, or protected-zone geometry can affect safety.
- Local terminology in prompts or annotation instructions should be tracked through offboard labeler records instead of forking the core taxonomy silently.

---

## Implementation Sequence

| Step | S0-S1 version | S2-S3 version | S4-S5 version |
|---|---|---|---|
| Define artifact IDs | Filenames and manifest JSON | Catalog/registry IDs | Policy-enforced typed IDs |
| Build baseline workflow | Script or DVC stage | CI rebuild job | Template with audit export |
| Add data QA | Manual sample check | Scheduled decode/QA workflow | Evidence retention and access audit |
| Add training workflow | Scripted train/eval | Orchestrated train/eval/export/register | Evidence-locked child runs |
| Add release gate | Manual note | Release packet and alias policy | Claim/evidence table and approver record |
| Add incident workflow | Ticket plus clips | Evidence freeze and replay reproduction | Reportability and safety-case delta |
| Add platform templates | Not needed | Golden paths for product teams | Multi-tenant policy and exception workflow |

Do not begin with a platform migration. Begin by making the artifact contracts explicit, then move the workflow into the smallest orchestrator that can enforce them.

---

## Scorecards

| KPI | Why it matters | Release blocker |
|---|---|---|
| Manifest coverage | Ensures each workflow run can be traced | Candidate lacks pipeline/run manifest |
| Artifact handoff completeness | Prevents hidden bucket side effects | Task output has no immutable ID |
| Retry/failure cause quality | Separates flaky infra from invalid evidence | Evidence job repeatedly fails without owner |
| Queue wait by workflow class | Shows whether release/incident work is starved | Incident or release eval misses SLO |
| Backfill correctness | Prevents replaying old data with new assumptions | Backfill changes split/eval evidence silently |
| Policy hook pass rate | Shows whether gates are useful and usable | Required attestation, split, eval, or rollback gate missing |
| Template drift | Detects platform workflow changes | Shared workflow version changes without impact review |
| Bypass rate | Measures whether teams avoid the platform | Release-affecting artifact created outside approved workflow |

At S5, platform SLOs should include workflow start latency, median/95th task runtime, queue wait, cache hit rate, failure triage time, and policy false-positive rate.

---

## Failure Modes

| Failure mode | Consequence | Control |
|---|---|---|
| One mega-DAG owns everything | Failures are hard to isolate and approval boundaries blur | Split data, training, eval, release, and incident workflows |
| Task writes untracked files | Registry/evidence cannot prove what was used | Require typed outputs and immutable artifact IDs |
| Retries mask data quality failures | Bad data eventually passes by chance | Separate transient infra retries from semantic validation failures |
| Backfill overwrites evidence | Historical metrics change under old release claims | Evidence-locked inputs and versioned workflow templates |
| Training completion moves alias | Model reaches deployment without review | Separate register/promote/deploy/approve states |
| Orchestrator metadata not linked | Workflow logs cannot explain a model or incident | Write workflow/run IDs into tracker, registry, catalog, and release packet |
| Platform too heavy too early | Teams bypass it with scripts | Start with manifest contracts and lightweight CI/DVC |
| Platform too weak too late | Fleet releases depend on ad hoc scripts | Add policy hooks before S2/S3 artifacts reach users |
| Site scope is a parameter nobody checks | Global pass hides local ODD regression | Make site/ODD scope a release workflow input and blocker |
| Incident workflow has no capacity | Safety evidence waits behind routine jobs | Reserved incident lane and tested evidence-freeze workflow |

---

## Related Pages

- `mlops-scale-research-scope.md` - MLOps maturity ladder and orchestration scope.
- `mlops-reference-architectures-by-scale.md` - architecture choices and durable interfaces.
- `mlops-migration-checklist-by-scale.md` - transition triggers for adding orchestrators and policy gates.
- `experiment-tracking-reproducibility-by-scale.md` - run authority, reproducibility levels, and run manifest contract.
- `model-registry-artifact-lifecycle-by-scale.md` - registry records, alias authority, lifecycle states, artifact-set membership, and rollback retention.
- `mlops-scorecards-and-kpis-by-scale.md` - scorecards and release-blocking metrics.
- `evaluation-platform-replay-gates-by-scale.md` - evaluation manifests, metric specs, replay gates, runtime package checks, shadow/canary evidence, and evaluation-service SLOs.
- `dataset-split-leakage-controls-by-scale.md` - split manifests and leakage reports.
- `model-governance-release-evidence.md` - release packets, aliases, and rollback evidence.
- `secure-artifact-attestation-profile.md` - signed artifacts, SBOM/provenance, and policy verification.
- `gpu-queueing-finops-by-scale.md` - queue classes, GPU capacity, and cost controls.
- `data-flywheel-airside.md` - trigger mining, labeling, training, validation, and monitoring loop.
- `../data-platform/fleet-data-pipeline.md` - fleet ingest, data products, and pipeline states.
- `../../20-av-platform/compute/training-infrastructure.md` - training infrastructure and orchestration examples.

## Sources

- Apache Airflow, "Dags." https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dags.html
- Argo Workflows, "What is Argo Workflows?" https://argo-workflows.readthedocs.io/en/latest/
- Kubeflow, "Pipeline." https://www.kubeflow.org/docs/components/pipelines/concepts/pipeline/
- TensorFlow, "Understanding TFX Pipelines." https://www.tensorflow.org/tfx/guide/understanding_tfx_pipelines
- MLflow, "Model Evaluation." https://mlflow.org/docs/latest/ml/evaluation/
- TensorFlow, "Getting Started with TensorFlow Model Analysis." https://www.tensorflow.org/tfx/model_analysis/get_started
- GitHub Docs, "Workflows." https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows
- DVC, "Pipelines." https://doc.dvc.org/user-guide/pipelines
- Ray, "Ray Train: Scalable Model Training." https://docs.ray.io/en/latest/train/train.html
- Slurm, "Overview." https://slurm.schedmd.com/overview.html
