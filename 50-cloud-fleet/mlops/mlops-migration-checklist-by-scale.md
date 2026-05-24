# MLOps Migration Checklist by Scale

**Last updated:** 2026-05-24

This page converts the S0-S5 MLOps scale model into migration gates. Use it when a team asks whether to add a tracker, registry, orchestration platform, evaluation service, feature store, GPU scheduler, policy engine, release board, or platform team. The answer should follow artifact authority and operational risk, not tool ambition. For registry identity, aliases, lifecycle states, artifact-set membership, and rollback retention, use `model-registry-artifact-lifecycle-by-scale.md`. For orchestrator selection and workflow-state design, use `pipeline-orchestration-release-workflows-by-scale.md`; for metric specs, evaluation manifests, replay gates, runtime package checks, and shared evaluation-service SLOs, use `evaluation-platform-replay-gates-by-scale.md`.

The core rule is: **contract first, platform second.** A team should not buy or build S5 infrastructure to compensate for missing S1 reproducibility, and it should not ship S2 production models without release evidence just because training is automated.

---

## How to Use This Checklist

1. Identify the artifact authority: research-only, baseline, production candidate, fleet rollout, safety-critical release, or shared platform service.
2. Find the highest authority level in the artifact set. A single semantic map, labeler, runtime engine, or prompt pack can raise the required scale even if the team is small.
3. Apply the transition checklist before migrating tooling.
4. Preserve the manifest/interface from the previous scale so migration adds control without breaking reproducibility.
5. Measure the migration with the scorecard in `mlops-scorecards-and-kpis-by-scale.md` and the run-authority/reproducibility contract in `experiment-tracking-reproducibility-by-scale.md`.

Do not treat scale as a vanity maturity score. A research team can stay S1 for months. A small airport, yard, campus, or warehouse fleet can require S4 controls for one map publication or safety-relevant model release.

---

## Migration Principles

| Principle | Meaning | Failure it prevents |
|---|---|---|
| Artifact authority beats team size | Required controls follow what the artifact can change | Small teams shipping unsafe production models |
| Interfaces survive tooling changes | JSON/Markdown manifests can later become registry/catalog records | Replatforming loses lineage |
| Automation produces evidence, not approval | Pipelines can create artifacts and reports; humans/policy approve promotion | Green job silently becomes deployment |
| Rollback is part of migration | Every new scale must preserve a known-good path | Upgrade creates unrecoverable release state |
| Local ODDs matter | Fleet scale means site/ODD cells, not only vehicle count | Global metrics hide local failures |
| Shared platforms need SLOs | Central services must be faster and safer than local bypass | Platform becomes ignored |
| Policy starts narrow | Enforce the highest-risk artifact boundary first | Broad policy blocks useful work and causes shadow pipelines |

---

## Scale Entry and Exit Criteria

| Scale | Enter when | Minimum exit criteria before moving up |
|---|---|---|
| S0 notebook research | One owner is exploring feasibility | Result has code commit, data pointer, config, metric, limitations, and decision note |
| S1 repeatable prototype | Another engineer must reproduce or compare a result | Frozen split, environment/container, deterministic script, baseline metric, failure examples |
| S2 single-product production | Artifact reaches a customer, operator, vehicle, map release, production label set, or service | Registry version, release packet, offline/replay gates, runtime package test, rollback target |
| S3 fleet and multi-site | Multiple sites, routes, ODD cells, vehicles, hardware kits, or local operating modes diverge | Site slices, local holdouts, ODD-cell release manifests, telemetry IDs, canary/rollback by cohort |
| S4 regulated safety-critical | Failure can affect people, protected assets, regulatory evidence, safety case, or incident reporting | Claim/evidence table, immutable evidence, approvers, waiver expiry, rollback drill, retention hold |
| S5 platform scale | Many teams/products share data, compute, labels, evals, registries, or governance | Tenant isolation, policy-as-code, audit API, platform SLOs, cost allocation, exception workflow |

Exit criteria are cumulative. S3 does not remove S2 release packets; it adds site/ODD scope and fleet observability. S5 does not remove product accountability; it standardizes the platform contracts.

---

## S0 to S1: Research to Repeatable Prototype

**Trigger:** A result is reused in a decision, benchmark, proposal, roadmap, or comparison.

| Checklist item | Required output |
|---|---|
| Move from notebook-only state to scriptable run | `train/eval` command or equivalent reproducible script |
| Record data identity | Data pointer, sample manifest, split definition, excluded data |
| Freeze environment | Dependency lock or container image digest |
| Record configuration | Versioned config, random seed, preprocessing settings |
| Assign run authority | `scratch_run`, `exploratory_run`, or `baseline_run` state plus required reproducibility level |
| Produce deterministic metric output | Metric table, confidence interval if applicable, failure examples |
| Preserve limitations | ODD, input modality, label caveats, known missing slices |

**Do not add yet:** shared GPU platform, feature store, formal release board, multi-region deployment, heavy policy engine.

**Exit gate:** another engineer can rerun the baseline and explain why the result changed if it does.

---

## S1 to S2: Prototype to Production Product

**Trigger:** A model, map, prompt/labeler, runtime package, or evaluation artifact can affect an operator, customer, vehicle, production label set, semantic map, or release evidence.

| Checklist item | Required output |
|---|---|
| Introduce registry identity | Immutable model/map/labeler/eval/runtime artifact version, digest, authority state, aliases, and artifact-set membership |
| Add release packet | Claim, evidence, limitations, rollback, approvers |
| Freeze datasets and labels | Dataset manifest, label QA, leakage check, allowed-use state |
| Package runtime artifact | ONNX/TensorRT/container package, load test, latency/memory report |
| Add replay/offline gates | Holdout metrics, scenario replay smoke, calibration/OOD checks |
| Add evaluation manifest | Eval authority state, evaluator version, metric spec, slice set, artifact-set hash, runtime package smoke, waiver state |
| Add controlled aliases | `candidate`, `shadow`, `champion`, `rollback`, `quarantined` semantics |
| Add secure artifact chain | Signatures, SBOM/provenance, trusted-builder or CI identity, policy result |
| Add rollback proof | Previous compatible artifact set and cache state |

**Do not add yet:** automated continuous retraining to champion, one-click fleet expansion, federated learning without the trigger policy in `federated-privacy-preserving-training-policy-by-scale.md`, generic online feature store.

**Exit gate:** the exact artifact can be deployed, observed, held, rejected, or rolled back without ambiguity.

---

## S2 to S3: Product to Fleet and Multi-Site

**Trigger:** The same artifact family operates across sites, routes, ODD cells, vehicle kits, weather bands, map states, or local operational rules.

| Checklist item | Required output |
|---|---|
| Partition release scope | Site/ODD-cell manifest with route/task/weather/map-state boundaries |
| Add local holdouts | Per-site or per-ODD validation splits and replay packs |
| Add fleet telemetry IDs | Active model/map/calibration/runtime/taxonomy/prompt IDs in events |
| Add trigger mining | Incident, drift, rare-class, map-change, operator-flag queues |
| Add active-learning budgets | Label budget by site, safety slice, rare class, and local drift |
| Add site canaries | Canary by ODD cell, not only by fleet percentage |
| Add blast-radius query | Ability to isolate affected site/cohort/artifact version quickly |
| Add GPU and label capacity controls | Queue priority, owner/site tags, unit costs, assurance capacity |

**Do not add yet:** one global champion for every site, platform-wide policy that ignores local ODDs, centralized label budgets with no site weighting.

**Exit gate:** a release can expand to one ODD cell, hold another, and roll back a third while preserving evidence.

---

## S3 to S4: Fleet to Regulated Safety-Critical

**Trigger:** A release can affect people, aircraft, protected zones, false-free-space, FOD, regulatory evidence, safety-case claims, incident reporting, or contractual acceptance.

| Checklist item | Required output |
|---|---|
| Convert release claims to safety claims | Claim/evidence table and safety-case IDs |
| Lock evidence | Immutable release packet, raw/replay logs, approvals, retention hold |
| Add hazard-focused replay | Required scenarios, incident regressions, false-free-space/personnel/FOD slices |
| Add waiver governance | Owner, expiry, residual risk, mitigation, revalidation trigger |
| Add dual approval | Safety/release authority separate from model author |
| Add rollback drill | Time-bound rollback proof under active runtime/map/calibration |
| Add reportability path | Incident classification and evidence freeze workflow |
| Add trusted-builder controls | Provenance, signature verification, policy-gated release artifacts |

**Do not add yet:** automatic release approval from scorecards, online learning without explicit gates, expired evidence reuse.

**Exit gate:** the release can be defended after an audit or incident with immutable evidence and named accountable owners.

---

## S4 to S5: Regulated Product to Shared Platform

**Trigger:** Multiple product teams, model families, sites, tenants, or foundation-model workflows reuse data, compute, labels, evals, registries, and policy services.

| Checklist item | Required output |
|---|---|
| Standardize durable interfaces | Dataset, training-run, model, compatibility, evaluation, replay, deployment, incident, and attestation manifests |
| Add tenant isolation | IAM, data partitions, registry namespaces, quota and cost allocation |
| Add policy-as-code | Release blockers for registry aliases, data access, attestation, eval, and deployment |
| Add platform SLOs | Queue wait, registry availability, eval lead time, incident lane, support response |
| Add audit API | Query artifact lineage, active deployments, exceptions, evidence completeness |
| Add self-service templates | Golden paths for S1 baseline, S2 release, S3 site rollout, S4 evidence packet |
| Add exception workflow | Owner, scope, expiry, compensating control, review cadence |
| Add platform scorecard | Adoption, bypass attempts, cost, policy pass/fail, evidence completeness, user friction |

**Do not add yet:** platform mandates without product-owner accountability, shared services that erase local ODD context, policy that cannot express safety exceptions.

**Exit gate:** teams can move faster through approved paths than through shadow infrastructure, while release authority and safety accountability remain intact.

---

## Workstream Migration Matrix

| Workstream | S0-S1 | S2 | S3 | S4 | S5 |
|---|---|---|---|---|---|
| Data | Manifest and fixed split | Immutable dataset snapshot | Site/ODD catalog partitions | Evidence lock and legal/safety hold | Multi-tenant catalog and lineage graph |
| Labels | Instructions and examples | QA states and allowed-use | Site-sliced reviewer metrics | Expert review for hazard labels | Shared label platform with policy |
| Compute | Workstation or rented GPU | Scheduled jobs and owner tags | Shared queue and priority lanes | Reserved assurance capacity | Multi-tenant scheduler and FinOps |
| Registry | Checkpoint folder | Versioned registry and aliases | Site/channel metadata | Immutable approval and retention | Registry policy and audit API |
| Evaluation | Validation script | Evaluation manifest, holdout/replay/runtime smoke | Local holdouts, replay suites, shadow/canary evidence | Safety-case claim evidence, hazard replay, waiver expiry | Shared eval service with adapters, scenario catalog, and SLOs |
| Deployment | Manual artifact | Shadow/canary/rollback | ODD-cell rollout | Controlled safety release | Progressive rollout platform |
| Monitoring | Failure notes | Drift/runtime/latency metrics | Fleet anomaly and delayed labels | Reportability and evidence freeze | Platform observability SLOs |
| Governance | Peer review | Release owners | Site/ODD release owners | Safety authority and approvers | Policy-as-code plus exception board |
| Security | Secrets outside notebooks | Signed artifacts and SBOM | Site/tenant IAM | Trusted builders and retention | Attestation service and admission policy |
| Cost | Run note | Cost per run/label/replay | Site chargeback and queue wait | Assurance capacity accounting | Unit economics by tenant/product |

---

## Tooling Upgrade Triggers

| Tooling | Add when | Avoid when |
|---|---|---|
| Experiment tracker | Two people compare runs, a baseline must be preserved, or a candidate needs run authority/reproducibility evidence | Single throwaway exploration |
| Data versioning/catalog | Datasets influence baselines or release evidence | Raw samples are exploratory only |
| Pipeline orchestrator | Steps repeat across candidates, artifacts need lineage, or release/evidence workflows need explicit states | One-off preprocessing dominates |
| Model/artifact registry | A model, runtime package, map, labeler, evaluator, replay pack, or adapter can be deployed, shadowed, rolled back, or consumed by another system | Checkpoints are local research only |
| Feature/embedding store | Derived representations are reused across teams, retrieval, mining, or evidence | One model owns a local feature file |
| GPU scheduler | Jobs compete for accelerators or incidents need priority | One user rents occasional GPUs |
| Policy engine | Manual gates miss required fields or many teams share release paths | Requirements are still changing daily |
| Attestation service | Artifacts cross release, runtime, OTA, map, or safety boundaries | Checksums are enough for local prototype |
| Eval service | Multiple teams duplicate replay/eval infrastructure, release candidates need ODD-cell manifests, or replay/runtime/shadow evidence must be policy-checked | One product has a small local script and no release authority |
| Platform team | Shared services need SLOs and support | Tool ownership is still part-time and local |

---

## 30/60/90 Migration Plan

| Window | Focus | Deliverables |
|---|---|---|
| First 30 days | Stabilize interfaces | Dataset/run/model/eval manifests, current-state audit, baseline reproduction, owner map |
| Days 31-60 | Add gates at artifact boundaries | Registry aliases, release packet, compatibility manifest, attestation, rollback proof, local scorecard |
| Days 61-90 | Scale scope and operations | Site/ODD release manifest, canary telemetry, trigger mining, queue/cost controls, incident linkage |

For S4/S5 migration, extend the plan with evidence-retention design, policy-as-code rollout, tenant isolation, audit API, exception workflow, and platform SLO review. Do not attempt all product teams at once; start with one artifact family and one release path.

---

## Airside and Non-Road Managed-Site Notes

MLOps migration in non-road autonomy should account for sites that are physically bounded but operationally diverse:

- Airport stands, terminal frontages, service roads, warehouses, ports, campuses, construction areas, and mine sites each need local ODD cells.
- A semantic-map release can require S4 evidence even if the fleet is small because false permanent structure, missed personnel, or wrong free-space can affect safety.
- Map-derived labels must not move from S1/S2 experiments into S3/S4 training without source-map acceptance, release-state masks, taxonomy compatibility, and invalidation policy.
- Site terminology belongs in labeler/prompt registries; it should not fork the core class taxonomy without promotion review.
- Migration should preserve site operations ownership. Platform automation cannot decide local route, weather, work-zone, or aircraft-proximity acceptance by itself.

---

## Migration Evidence Packet

Before declaring a migration complete, attach:

| Evidence | Purpose |
|---|---|
| Current-state audit | Shows which controls already exist and which are missing |
| Artifact inventory | Lists models, maps, prompts, evals, datasets, replay packs, and runtime packages by authority level |
| Registry lifecycle sample | Shows one artifact moving through `candidate`, `shadow`, `site_canary`, `champion`, `rollback`, or `quarantined` without losing evidence or scope |
| Interface manifest set | Proves durable contracts exist before platform migration |
| Evaluation manifest sample | Proves the new path can compare candidate and baseline artifacts with evaluator, metric, split, replay, runtime, waiver, and decision identity |
| Scorecard baseline | Measures reproducibility, data quality, release readiness, observability, cost, and governance |
| Risk register | Names failure modes, owner, mitigation, and accepted residual risk |
| Rollback plan | Defines previous scale fallback and known-good artifacts |
| Adoption plan | Names teams, training, templates, support channel, and exception process |

The migration is not complete when the tool is installed. It is complete when a real artifact passes through the new path, produces evidence, and can be rolled back or rejected cleanly.

---

## Failure Modes

| Failure mode | Consequence | Control |
|---|---|---|
| S5 platform before S1 reproducibility | Expensive infrastructure preserves bad habits | Require run/data/config manifest before platform onboarding |
| Pipeline automation before release contract | Training completion becomes release approval | Separate build, evaluate, promote, deploy, and approve states |
| Registry without rollback | Alias movement looks mature but recovery fails | Require `rollback` alias and compatibility proof |
| Site scale with global metrics | Local ODD regression reaches production | ODD-cell release manifests and local holdouts |
| Safety release with mutable evidence | Incident review cannot defend approval | Immutable release packet and retention hold |
| Policy engine too broad too early | Teams create shadow paths | Start with high-risk artifact boundaries and clear exceptions |
| Platform SLO ignored | Central service slows product teams | Measure queue wait, eval lead time, support time, and bypass attempts |
| Migration erases local ownership | Platform team becomes accidental release authority | Keep product/site/safety owners on approval records |

---

## Related Pages

- `mlops-scale-research-scope.md` - maturity ladder and research scope.
- `mlops-reference-architectures-by-scale.md` - concrete S0-S5 architectures and durable interfaces.
- `mlops-scorecards-and-kpis-by-scale.md` - migration scorecards and release blockers.
- `experiment-tracking-reproducibility-by-scale.md` - run authority states, reproducibility levels, manifest fields, and tracker architecture tradeoffs.
- `model-registry-artifact-lifecycle-by-scale.md` - registry records, alias authority, lifecycle states, artifact-set membership, and rollback retention.
- `pipeline-orchestration-release-workflows-by-scale.md` - orchestrator choices, workflow state machines, artifact handoff contracts, and release/evidence gates.
- `evaluation-platform-replay-gates-by-scale.md` - evaluation manifests, metric specs, replay gates, runtime package checks, shadow/canary evidence, and platform service SLOs.
- `model-governance-release-evidence.md` - release packets, aliases, and rollback evidence.
- `site-sliced-release-evidence-by-scale.md` - ODD-cell release manifests and local rollout gates.
- `feature-embedding-store-ops-by-scale.md` - store migration triggers.
- `gpu-queueing-finops-by-scale.md` - compute migration triggers and unit economics.
- `secure-artifact-attestation-profile.md` - artifact trust-chain migration gates.
- `federated-privacy-preserving-training-policy-by-scale.md` - trigger policy before adding federated or privacy-preserving training lanes.
- `../data-platform/fleet-data-pipeline.md` - data-platform posture by MLOps scale.
- `../../40-runtime-systems/ml-deployment/av-cicd-devops-pipeline.md` - CI/CD and deployment lane architecture.

## Sources

- Google Cloud, "MLOps: Continuous delivery and automation pipelines in machine learning." https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning
- Google Cloud, "MLOps on Vertex AI." https://cloud.google.com/vertex-ai/docs/start/introduction-mlops
- Microsoft Azure Architecture Center, "MLOps maturity model." https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/mlops-maturity-model
- AWS, "What is MLOps?" https://aws.amazon.com/what-is/mlops/
- AWS Solutions, "AWS MLOps Framework." https://docs.aws.amazon.com/solutions/latest/aws-mlops-framework/
- MLflow, "MLflow Tracking." https://mlflow.org/docs/latest/ml/tracking/
- Weights & Biases, "Experiments overview." https://docs.wandb.ai/models/track
- DVC, "Experiment Management." https://doc.dvc.org/user-guide/experiment-management
- Apache Airflow, "Dags." https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dags.html
- Argo Workflows, "What is Argo Workflows?" https://argo-workflows.readthedocs.io/en/latest/
- GitHub Docs, "Workflows." https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows
- DVC, "Pipelines." https://doc.dvc.org/user-guide/pipelines
- Kubeflow, "Pipeline." https://www.kubeflow.org/docs/components/pipelines/concepts/pipeline/
- TensorFlow, "Understanding TFX Pipelines." https://www.tensorflow.org/tfx/guide/understanding_tfx_pipelines
- MLflow, "Model Evaluation." https://mlflow.org/docs/latest/ml/evaluation/
- TensorFlow, "Getting Started with TensorFlow Model Analysis." https://www.tensorflow.org/tfx/model_analysis/get_started
- Evidently AI, "Tests." https://docs.evidentlyai.com/docs/library/tests
- Google Cloud, "Model evaluation in Vertex AI." https://cloud.google.com/vertex-ai/docs/evaluation/introduction
- MLflow, "Model Registry Workflows." https://www.mlflow.org/docs/latest/ml/model-registry/workflow/
- Weights & Biases, "Reference an artifact version with aliases." https://docs.wandb.ai/models/registry/aliases
- Google Cloud, "Model versioning with Model Registry." https://cloud.google.com/vertex-ai/docs/model-registry/versioning
- Amazon SageMaker AI, "Model Registry Models, Model Versions, and Model Groups." https://docs.aws.amazon.com/sagemaker/latest/dg/model-registry-models.html
- Kubeflow, "Kubeflow Model Registry." https://www.kubeflow.org/docs/components/model-registry/
- SLSA specification v1.2. https://slsa.dev/spec/latest/
