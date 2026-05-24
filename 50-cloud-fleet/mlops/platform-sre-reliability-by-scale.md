# MLOps Platform SRE and Reliability by Scale

**Last updated:** 2026-05-24

MLOps platform SRE is the operating discipline for the services that make ML change safe: experiment trackers, data catalogs, model registries, pipeline orchestrators, GPU schedulers, evaluation/replay services, serving platforms, feature/embedding stores, attestation systems, monitoring pipelines, audit logs, and release-policy engines. Fleet SRE keeps vehicles and operations recoverable; MLOps platform SRE keeps the ML evidence and release-control plane recoverable.

Use this page with `mlops-scale-research-scope.md` for maturity, `mlops-reference-architectures-by-scale.md` for platform boundaries, `pipeline-orchestration-release-workflows-by-scale.md` for workflow lanes, `model-registry-artifact-lifecycle-by-scale.md` for registry authority, `evaluation-platform-replay-gates-by-scale.md` for eval service SLOs, `serving-inference-operations-by-scale.md` for endpoint and batch serving SLOs, `gpu-queueing-finops-by-scale.md` for capacity and incident lanes, `model-monitoring-drift-response-by-scale.md` for alert actionability, and `../operations/fleet-sre-incident-response.md` for fleet incident command.

The core rule is: **the MLOps platform is part of the safety and release system once it can approve, block, serve, monitor, or reconstruct a model change.** Its reliability cannot be measured only as cloud uptime; it must also preserve evidence correctness, artifact identity, rollback readiness, and auditability.

---

## What Platform SRE Owns

| Surface | What must be reliable | Failure it prevents |
|---|---|---|
| Artifact identity | Registry versions, aliases, digests, artifact-set compatibility | A release loads an ambiguous or wrong artifact |
| Evidence generation | Evaluation, replay, runtime smoke, shadow/canary report, release packet | Green dashboards replace reproducible evidence |
| Evidence storage | Dataset manifests, eval reports, approvals, audit logs, incident records | Incident review cannot reconstruct why a release was approved |
| Workflow execution | Pipelines, retries, queues, artifact handoffs, policy hooks | Failed or partial DAGs produce silent side effects |
| Serving and endpoint control | Endpoint manifests, traffic routes, autoscaling, readiness, rollback | Approved artifacts are served outside approved scope |
| Monitoring and alerting | SLIs, alert routing, suppression expiry, delayed-label joins | Drift and failures become dashboard noise |
| Capacity | GPU queues, eval workers, replay clusters, registry API, metadata DBs | Release/evidence/incident jobs starve behind research workloads |
| Security and tenancy | IAM, namespaces, secrets, signing keys, tenant partitions, data residency | Cross-tenant leakage or unauthorized artifact promotion |
| Backup and restore | Metadata DBs, object stores, registry aliases, pipeline states, signing material | Platform outage destroys release history or rollback path |

The MLOps platform has two reliability dimensions: service reliability and evidence reliability. An API can be available while returning stale lineage, accepting unsupported alias changes, or losing approval history. That is not reliable MLOps.

---

## Scale Ladder

| MLOps scale | Platform SRE posture | Minimum reliability control | Anti-pattern to block |
|---|---|---|---|
| S0 notebook research | Local hygiene | Git, local backup, run note, data pointer | Irreplaceable notebook or checkpoint on one workstation |
| S1 repeatable prototype | Shared but low-criticality services | Tracker/catalog backup, owner, basic availability note, restore smoke | Shared tracker becomes source of truth with no export path |
| S2 single-product production | Product release control plane | Service inventory, SLOs for registry/eval/serving, backup/restore test, release freeze mode | Platform outage forces unsafe manual release |
| S3 fleet and multi-site | Site-aware release platform | Incident lane, ODD-cell blast-radius query, tenant/site partitions, capacity SLOs | One platform outage blocks rollback, evaluation, and fleet containment |
| S4 regulated safety-critical | Evidence-critical platform | Immutable audit log, retention hold, RPO/RTO, dual-control recovery, restore drill, reportability path | Evidence exists only in mutable tickets or dashboards |
| S5 platform scale | Multi-tenant platform SRE | Error budgets, platform SLOs, DR plan, policy-as-code, audit API, tenant isolation, support model | Platform becomes slower or less trusted than bypass paths |

At S2 and above, platform reliability is release readiness. A candidate should not move to `shadow`, `site_canary`, or `champion` if registry, evaluation, serving, attestation, monitoring, or rollback evidence is degraded beyond its SLO.

---

## Criticality Tiers

| Tier | Services | Reliability posture |
|---|---|---|
| T0 release authority | Model/artifact registry, alias policy, release packet store, compatibility manifest store, attestation/signing, approval audit log | Strongest backup, access control, restore test, retention hold, and change review |
| T1 evidence generation | Evaluation/replay service, runtime package smoke, split/leakage checker, scenario catalog, safety evidence workflows | Capacity reservation, flake monitoring, deterministic rerun, evidence immutability |
| T2 production operation | Serving platform, monitoring pipeline, feature/embedding store used in production, fleet telemetry joins | Availability, latency, staleness, rollback, site/tenant scope, incident runbooks |
| T3 data and training platform | Data catalog, lakehouse tables, annotation queue, training orchestrator, GPU scheduler | Queue SLOs, lineage correctness, quota, cost visibility, restore for metadata |
| T4 research convenience | Exploratory trackers, notebooks, scratch storage, ad hoc dashboards | Export path, owner, TTL, no release authority |

Do not apply one uniform SLO to every tool. T0/T1 systems need correctness and recoverability more than low latency. T3/T4 systems need usability, cost, and data hygiene but should not be able to change release truth without promotion.

---

## SLIs and SLOs

| Platform area | SLIs | SLO examples |
|---|---|---|
| Registry | API success, alias mutation latency, alias policy pass/fail, stale alias count, audit-log write success | 99.9% read availability for release hours; zero unlogged alias mutation |
| Evaluation/replay | Queue wait by priority, flake rate, evaluator availability, stale scenario age, evidence completeness | Release eval starts within target window; incident replay preempts research jobs |
| Orchestration | Workflow start latency, success rate by class, retry cause, policy hook availability, artifact handoff completeness | Release/evidence workflows have higher SLO than exploratory sweeps |
| Serving | Readiness, p99 latency, model load success, traffic policy match, rollback load success | Canary and rollback endpoints meet p99 and load-test SLO before promotion |
| Data catalog | Metadata freshness, lineage completeness, quality report availability, deletion propagation | Release datasets have complete lineage before training/eval |
| Monitoring | Event ingestion latency, missing artifact IDs, alert precision, suppression expiry, delayed-label join success | Safety-relevant alerts route to owner within target time |
| GPU/compute | Queue wait, utilization, preemption correctness, quota violations, reserved incident capacity | Incident and release lanes retain reserved capacity |
| Attestation | Signing success, verification success, policy false positive/negative, key availability | Release-affecting artifacts verify before alias movement or activation |
| Backup/restore | Backup age, restore success, RPO/RTO, restore drill frequency, immutable-retention coverage | T0 metadata restore tested on schedule and before major platform migration |

SLOs should be scoped by scale and artifact authority. A research tracker can tolerate downtime. A release registry with active vehicles cannot silently lose alias history, approval state, or rollback target.

---

## Error Budgets and Change Freezes

Error budgets are useful only when they affect behavior.

| Budget type | What consumes it | Policy when exhausted |
|---|---|---|
| Availability budget | Registry/eval/serving/platform API failures | Freeze non-urgent platform changes and focus on reliability |
| Evidence-correctness budget | Missing artifact IDs, incomplete manifests, stale lineage, audit write failure | Block release authority until evidence completeness is restored |
| Eval lead-time budget | Release/evidence jobs miss queue or runtime SLO | Reserve capacity, reduce exploratory load, fix flakes |
| Alert-quality budget | Low alert precision, stale suppressions, missing owners | Tune monitors, audit suppressions, update runbooks |
| Rollback-readiness budget | Rollback load test fails or cache expires | Hold promotion and rebuild compatible rollback set |
| Platform-bypass budget | Teams deploy outside approved path | Improve golden path, narrow policy, escalate unsupported bypasses |

For autonomy, error budgets should never justify safety-evidence loss. If the evidence system is unhealthy, the correct response is to hold releases, not to accept undocumented risk.

---

## Backup, Restore, and Disaster Recovery

| Asset | Backup requirement | Restore question |
|---|---|---|
| Registry metadata | Versioned database backup, alias-history export, immutable audit log | Can we prove which artifact was active at a past time? |
| Object artifacts | Digest-pinned object storage, retention class, cross-zone/region policy where justified | Can we fetch the exact model/map/eval/replay artifact used in release? |
| Evaluation reports | Immutable report store plus source evaluator/container IDs | Can we reproduce or defend the release decision? |
| Pipeline state | Workflow definitions, run history, logs, parameters, output artifact IDs | Can we resume or replay failed evidence generation without hidden side effects? |
| Feature/vector stores | Snapshot metadata, index build IDs, corpus versions, deletion state | Can we avoid stale retrieval or point-in-time leakage after restore? |
| Secrets and signing keys | Key management, break-glass policy, rotation history, dual control | Can we recover without allowing unauthorized signing? |
| Monitoring data | Active artifact IDs, incident windows, alert state, suppression history | Can we reconstruct a field anomaly after platform outage? |
| Policy rules | Versioned policy-as-code and exception records | Can we tell whether a release passed the policy active at the time? |

Backups are not enough. Restore drills should be scheduled, measured, and recorded as platform evidence. At S4/S5, a restore drill should include one sample release packet, one registry alias history query, one eval report, one serving manifest, and one incident evidence query.

---

## Architecture Options

| Platform reliability architecture | Advantages | Disadvantages | Best use |
|---|---|---|---|
| Local files plus Git | Transparent, cheap, easy to export | Weak concurrency, weak audit, manual restore | S0-S1 research and baselines |
| Managed cloud MLOps platform | Fast reliability baseline, integrated registry/pipelines/endpoints, managed backups | Vendor coupling and limited autonomy metadata | S2-S4 cloud-native product lanes |
| Self-hosted Kubernetes platform | Strong control, air-gapped/on-prem fit, custom metadata and policy | Requires platform SRE, upgrades, DR, tenancy design | S3-S5 autonomy platforms and private deployments |
| Hybrid managed plus autonomy metadata layer | Balances managed reliability with custom release semantics | Integration and ownership complexity | S2-S5 teams using managed services but needing map/calibration/ODD evidence |
| Multi-region active/passive control plane | Strong DR and business continuity | Cost and consistency complexity | S4-S5 high-availability release platforms |
| Air-gapped or site-local platform | Data sovereignty and offline operation | Hard updates, constrained capacity, manual evidence synchronization | Regulated sites, customer isolation, low-connectivity managed sites |

Do not overbuild multi-region MLOps before artifact contracts exist. But once a platform is the only path to rollback, evidence, or release authority, restore and DR become part of the safety case.

---

## Incident Response for the MLOps Platform

| Incident type | First containment | Evidence to preserve |
|---|---|---|
| Registry alias policy failure | Freeze alias mutation and deployment admission | Alias history, policy version, affected artifacts, approver record |
| Evaluation service outage | Hold candidate promotion and route incident/release jobs to reserve lane | Queue state, failed workflow IDs, missing evidence, workaround decision |
| Serving platform outage | Roll back or route traffic by approved manifest | Endpoint manifest, traffic split, model server logs, active artifact IDs |
| Monitoring ingestion loss | Restrict rollout expansion and preserve raw telemetry | Missing window, impacted sites/cohorts, monitor config, delayed-label plan |
| Data catalog lineage corruption | Block training/eval consuming affected datasets | Snapshot IDs, lineage diff, downstream model/replay consumers |
| Signing or attestation outage | Block release-affecting artifact activation | Key state, policy decision, build provenance, affected subject digests |
| Tenant isolation breach | Disable affected namespace or data path | Access logs, data products, artifacts, consumers, notification record |
| Backup restore failure | Freeze authority changes until recoverability is proven | Last good backup, restore logs, missing artifacts, compensating controls |

MLOps platform incidents should update release records. If an evaluation outage forced a waiver, if a registry restore changed alias history, or if monitoring missed a canary window, the affected candidate or champion record must show that fact.

---

## Operating Model

| Scale | Ownership | Review cadence | On-call expectation |
|---|---|---|---|
| S0-S1 | Model owner or research lead | Baseline review | No formal on-call; document recovery |
| S2 | Product MLOps owner plus runtime/data owners | Release readiness and weekly platform health | Business-hours or release-window coverage |
| S3 | Platform owner, product owners, site operations | Release train, incident review, capacity review | On-call for release/eval/serving/monitoring |
| S4 | Platform SRE, safety owner, release manager, security | Formal evidence and restore review | Incident-ready coverage for safety-relevant releases |
| S5 | Central platform SRE with tenant product owners | SLO/error-budget review, tenant council, policy exception review | 24/7 or risk-based support for critical services |

The platform team owns reliability of the path. Product teams still own release decisions. A healthy platform makes the approved path faster than bypassing it.

---

## Managed-Site and Autonomy Rules

Airside, port, yard, campus, warehouse, construction, mining, and urban-district mapping deployments need MLOps platform SRE rules that account for local operations:

- Release/eval/rollback capacity should be reserved for active sites, not consumed by exploratory sweeps.
- Site and tenant partitions must carry through data catalog, registry, evaluation, serving, monitoring, and audit logs.
- Local outages should degrade to safe operational states: hold rollout, freeze map publication, use cached rollback artifacts, or restrict ODD cells.
- Edge and site-local artifacts need a synchronization policy for registry aliases, compatibility manifests, and incident evidence after reconnect.
- Map, calibration, semantic taxonomy, and serving manifests must remain queryable during incidents even when training systems are unavailable.
- For offline aggregated-map segmentation, platform SLOs include batch backlog age, map-tile evidence completeness, source-map QA availability, and publication rollback readiness.

The non-road setting often has fewer vehicles than road AVs, but each site has stronger local procedures and higher map dependence. Platform SRE should preserve local authority instead of forcing one global release lane.

---

## Release Blockers

| Blocker | Applies from | Example |
|---|---|---|
| No service inventory | S2 | Registry, eval, serving, and monitoring dependencies are unknown |
| Untested restore | S2-S5 | Registry or eval metadata backup exists but has never been restored |
| Missing artifact IDs in platform telemetry | S3-S5 | Platform incident cannot identify affected model/map/runtime/prompt artifacts |
| T0 service degraded during promotion | S2-S5 | Registry, attestation, release packet, or compatibility store is unhealthy |
| Incident lane starved | S3-S5 | Release replay or safety evidence waits behind research jobs |
| Audit log mutable or incomplete | S4-S5 | Alias movement or approval cannot be defended after incident |
| Tenant/site boundary missing | S3-S5 | Data, models, prompts, or evidence can cross customer/site boundaries unsupported |
| Platform SLO bypass | S5 | Teams deploy outside platform because supported path is too slow or unreliable |

Release blockers should preserve the blocked state. A frozen alias, held candidate, or paused rollout is useful evidence when it records the unhealthy dependency and owner.

---

## KPIs

| KPI | Meaning |
|---|---|
| Evidence completeness | Release-affecting workflows with complete manifests, artifact IDs, and audit links |
| T0 availability | Registry, release packet, attestation, compatibility, and policy service health |
| Restore drill success | Percentage of required restore tests passing within RPO/RTO |
| Release/eval queue SLO | Release and incident workflows starting within target windows |
| Platform incident MTTR | Time to contain, diagnose, and restore MLOps platform incidents |
| Alias mutation audit coverage | Percentage of alias changes with policy result, approver, evidence, and scope |
| Platform bypass rate | Release-affecting artifacts outside approved platform path |
| Tenant isolation findings | Cross-tenant/site access or evidence-boundary violations |
| Alert actionability | Platform alerts that produce owner, action, evidence, or suppression expiry |
| Rollback readiness | Rollback artifacts and serving routes that pass scheduled load/restore tests |

---

## Failure Modes

| Failure mode | Consequence | Control |
|---|---|---|
| Platform uptime hides evidence loss | API is up but audit, lineage, or report fields are missing | Evidence-correctness SLOs and manifest coverage checks |
| Registry restored without alias history | Active deployment cannot be reconstructed | Immutable alias log and restore drill |
| Eval service is reliable but flaky | Results arrive quickly but cannot support release | Flake SLO and rerun policy |
| Serving platform bypass | Endpoint ships outside registry/eval/attestation path | Admission policy and golden-path SLOs |
| One shared queue | Incident and release jobs starve | Priority lanes and reserved assurance capacity |
| S5 governance too early | Small team stops using the platform | Scale-gated controls and exportable simple manifests |
| S5 governance too late | Many teams create incompatible platforms | Standard interfaces and policy at artifact boundaries |
| Backups miss object artifacts | Metadata restores but models/maps/eval packs are gone | Digest inventory and object-retention audit |
| Tenant isolation is dashboard-only | Data or evidence crosses site/customer boundaries | Namespace/IAM/data-product enforcement and audit |
| Platform team becomes release authority | Product accountability is blurred | Product/safety owners remain approvers; platform owns path reliability |

---

## Related Pages

- `mlops-scale-research-scope.md` - maturity ladder and lifecycle controls.
- `mlops-reference-architectures-by-scale.md` - platform placement, service boundaries, and durable interfaces.
- `mlops-migration-checklist-by-scale.md` - transition gates before adding shared platform SRE.
- `mlops-scorecards-and-kpis-by-scale.md` - KPIs, release blockers, operating cadence, and anti-metrics.
- `pipeline-orchestration-release-workflows-by-scale.md` - workflow SLOs, incident lanes, and evidence state machines.
- `model-registry-artifact-lifecycle-by-scale.md` - registry authority, aliases, audit, rollback, and retention.
- `evaluation-platform-replay-gates-by-scale.md` - evaluation service health and replay/evidence SLOs.
- `serving-inference-operations-by-scale.md` - endpoint, batch, edge, traffic, autoscaling, and rollback reliability.
- `model-monitoring-drift-response-by-scale.md` - monitoring event contract, alert quality, and response states.
- `gpu-queueing-finops-by-scale.md` - capacity, queueing, reserved incident lanes, and unit economics.
- `secure-artifact-attestation-profile.md` - trust-chain service reliability and policy verification.
- `../operations/fleet-sre-incident-response.md` - fleet SRE, incident command, and safety evidence.
- `../data-platform/data-catalog-lineage-quality-ops.md` - lineage, quality, and data-product promotion reliability.
- `../ota/perception-slam-artifact-compatibility-matrix.md` - compatibility manifest and activation gates.

---

## Sources

- Google SRE, "Service Level Objectives." https://sre.google/sre-book/service-level-objectives/
- Google SRE, "Embracing Risk." https://sre.google/sre-book/embracing-risk/
- Google SRE, "Production Services: Best Practices." https://sre.google/sre-book/service-best-practices/
- Google Cloud, "AI and ML perspective: Reliability." https://docs.cloud.google.com/architecture/framework/perspectives/ai-ml/reliability
- Google Cloud, "MLOps on Vertex AI." https://cloud.google.com/vertex-ai/docs/start/introduction-mlops
- AWS, "Reliability Pillar - AWS Well-Architected Framework." https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html
- AWS, "AWS Well-Architected Framework definitions." https://docs.aws.amazon.com/en_us/wellarchitected/latest/framework/definitions.html
- AWS Architecture Blog, "Introducing the latest Machine Learning Lens for the AWS Well-Architected Framework." https://aws.amazon.com/blogs/architecture/introducing-the-latest-machine-learning-lens-for-the-aws-well-architected-framework/
- Microsoft Learn, "Azure Well-Architected Framework." https://learn.microsoft.com/en-us/azure/well-architected/
- Microsoft Learn, "MLOps and GenAIOps for AI workloads on Azure." https://learn.microsoft.com/en-us/azure/well-architected/ai/mlops-genaiops
- OpenTelemetry, "Documentation." https://opentelemetry.io/docs/
- OpenTelemetry, "Signals." https://opentelemetry.io/docs/concepts/signals/
- Kubeflow, "Multi-user Isolation." https://www.kubeflow.org/docs/components/pipelines/operator-guides/multi-user/
- Kubeflow, "Pipeline." https://www.kubeflow.org/docs/components/pipelines/concepts/pipeline/
- SLSA specification v1.2. https://slsa.dev/spec/latest/
