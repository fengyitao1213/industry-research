# GPU Queueing and FinOps by Scale

**Last updated:** 2026-05-24

GPU capacity becomes an MLOps control when training, replay, simulation, auto-labeling, map segmentation, foundation-model labeling, and incident analysis compete for the same accelerators. At S0, GPU cost is a run note. At S3, it is a shared product constraint. At S4, it is an assurance constraint because replay and incident retraining may be mandatory even when expensive. At S5, it is a platform service with quotas, priority lanes, observability, and unit economics.

The control objective is not simply "spend less." The objective is to allocate scarce compute to the work that creates reproducible models, reliable release evidence, and safety learning without allowing waste, hidden queues, or shadow clusters.

---

## Workload Classes

| Workload | Typical GPU need | Priority rule | Failure if unmanaged |
|---|---|---|---|
| Exploratory training | 1-8 GPUs for hours to days | Best-effort with budget cap | Research consumes production capacity |
| Candidate training | 1-16 GPUs, reproducible container | Scheduled lane with provenance | Candidate lacks rebuild evidence |
| Hyperparameter sweeps | Many short jobs | Quota and early-stop policy | Sweep floods queue and delays release work |
| Offline auto-labeling | Batch GPU inference over clips or maps | Throughput lane with cost per accepted label | Label backlog grows or spend is invisible |
| Aggregated-map segmentation | Large batch inference over tiles | Site/map release lane | Map publication waits behind non-release jobs |
| Replay and simulation | GPU/CPU mixed, often bursty | Release and incident priority | Safety evidence cannot be produced on time |
| Foundation-model labeling/eval | GPU or API budget | Prompt/model/corpus cost tags | Offboard labeler spend hides inside research |
| Incident retraining or replay | Urgent, evidence-preserving | Reserved S4 lane | Incident response blocks on routine training |
| Platform eval service | Repeated standardized evals | Tenant quota with service SLO | Teams bypass central eval because queue is slow |

Autonomy differs from generic ML because replay and evidence production can outrank model training. A lower mAP training run can wait; an incident replay, rollback proof, or safety-case evidence pack may not.

---

## Scale Ladder

| MLOps scale | Capacity model | Queueing control | FinOps control | Main risk |
|---|---|---|---|---|
| S0 notebook research | Local GPU or rented single GPU | None or manual calendar | Per-run cost note | Losing provenance or accidentally using restricted data |
| S1 repeatable prototype | Shared workstation or short cloud jobs | Simple job list, owner tag, max duration | Project budget and idle cleanup | Demo jobs starve baseline rebuilds |
| S2 single-product production | Scheduled runners or small GPU pool | Candidate/export/eval lane, retry policy | Cost per training run, label batch, replay job | Candidate artifact is expensive but not reproducible |
| S3 fleet and multi-site | Shared GPU pool across training, replay, labeling, maps | Queues by workload and site/ODD priority | Chargeback/showback by site, model, map, label, replay | One site or sweep consumes all shared capacity |
| S4 regulated safety-critical | Controlled training/evidence environment | Reserved incident/replay/release lanes, waiver for preemption | Cost per evidence pack, reserved assurance capacity | Cost pressure deletes or delays required evidence |
| S5 platform scale | Multi-tenant scheduler and eval platform | Quotas, cohorts, borrowing, preemption, policy-as-code | Unit economics, utilization SLO, forecasting, tenant billing | Teams create shadow GPU clusters outside governance |

The migration trigger is contention plus consequence. If training jobs compete only with other research jobs, S1 discipline is enough. If they compete with release replay, map publication, customer-site adaptation, or incident response, the system is at least S3 operationally.

---

## Queue Architecture

| Queue | Workload | Default priority | Required metadata |
|---|---|---|---|
| `research_best_effort` | Experiments, ablations, notebooks | Low | Owner, project, data sensitivity, max cost |
| `baseline_rebuild` | S1/S2 reproducibility rebuilds | Medium | Dataset snapshot, code commit, config, previous baseline |
| `candidate_train` | Candidate model training | Medium-high | Registry target, dataset, label schema, evaluation plan |
| `release_eval` | Replay, slice metrics, runtime package tests | High | Release packet ID, ODD cell, artifact set, rollback target |
| `map_semantic_batch` | Aggregated-map segmentation and QA | High when map blocks release | Source-map acceptance ID, tile set, semantic taxonomy, publication target |
| `labeler_batch` | Auto-labeling, offboard labeler runs | Medium | Labeler registry ID, prompt pack, allowed use, cost center |
| `incident_response` | Incident replay, root cause, emergency retraining | Highest | Incident ID, evidence hold, approver, retention policy |
| `platform_maintenance` | Image cache, evaluation service upkeep, health checks | Protected background | Platform owner, SLO, maintenance window |

Preemption should be explicit. Research jobs can be preempted by release evaluation. Release evaluation can be delayed only by incident response or safety owner approval. Evidence-producing jobs should write resumable checkpoints and immutable logs before preemption is allowed.

---

## Scheduler Choices

| Scheduler pattern | Strengths | Weaknesses | Best fit |
|---|---|---|---|
| Manual cloud rental | Fast start, minimal platform work | Weak quotas, weak provenance, manual cleanup | S0-S1 |
| GitHub Actions/self-hosted GPU runner | Simple CI integration | Poor for long jobs and multi-tenant GPU scheduling | S1-S2 export/smoke tests |
| Kubernetes Jobs + device plugin | Common cloud-native primitive, integrates with containers and quotas | Native GPU scheduling is coarse; needs queue layer for fairness | S2-S3 product jobs |
| Kubernetes + Kueue | Quotas, cohorts, borrowing, batch admission control | More platform surface area | S3-S5 shared batch workloads |
| Kubeflow Training Operator | ML-specific distributed job CRDs | Platform complexity and version lifecycle | S2-S5 distributed training |
| Ray | Flexible distributed Python, actors/tasks, autoscaling | Requires resource hygiene and cluster ops | S2-S5 training, simulation, evaluation |
| Slurm | Mature HPC scheduling, GPU GRES, fair-share | Less cloud-native; integration work for MLOps metadata | On-prem S3-S5 GPU clusters |
| Managed ML platform | Fastest governance integration | Cost, vendor coupling, custom metadata limits | S2-S4 when cloud fit is acceptable |

Choose the scheduler based on workload shape and governance needs. Kubernetes is natural when the backend is already Kubernetes-native. Slurm is natural for on-prem HPC-style clusters. Ray is useful when distributed Python simulation, data processing, or training dominates. Managed platforms are useful when the team needs registry, tracking, and policy faster than it can build them.

---

## FinOps Unit Economics

| Unit metric | What it includes | Why it matters |
|---|---|---|
| Cost per training run | GPU time, CPU preprocessing, storage reads/writes, egress, failed retries | Prevents "cheap" experiments from hiding retries and data movement |
| Cost per accepted label | Auto-label GPU/API cost, reviewer time, QA rework, rejected candidates | Measures labeler efficiency, not just label volume |
| Cost per replay hour | Simulation/replay GPU/CPU time, scenario setup, storage, video/log artifacts | Shows whether release evidence is becoming the bottleneck |
| Cost per released model | All training, eval, replay, packaging, and rollback proof for one release | Connects spend to shipped value |
| Cost per released map | Map construction, cleaning, segmentation, QA, publication, rollback bundle | Makes semantic-map publication economics visible |
| Cost per ODD-cell approval | Local holdout, replay, shadow/canary analysis, delayed labels, signoff | Prevents one site from hiding another site's evidence cost |
| Cost per safety evidence pack | Incident/replay/labels/monitor logs retained under evidence hold | Separates required assurance spend from waste |
| Platform cost per tenant | Shared services, scheduler, image cache, eval service, registry, observability | Detects platform bypass pressure and unfair allocation |

A metric is only useful if its denominator is stable. "GPU spend this month" is not enough. "Cost per accepted FOD label at Airport A" or "cost per release-replay hour for ODD cell X" supports engineering decisions.

---

## Required Job Metadata

| Field | Reason |
|---|---|
| Owner, team, cost center | Allocation and incident follow-up |
| Workload class | Queue routing and priority |
| Site/ODD cell | Site-sliced cost and release evidence |
| Data access scope | Prevents cross-tenant or privacy violations |
| Source commit and container digest | Reproducibility and supply-chain evidence |
| Dataset/map/calibration/taxonomy IDs | Downstream lineage and compatibility |
| Labeler/prompt/evaluator IDs | Offboard labeler governance |
| GPU type/count and expected duration | Scheduling and capacity planning |
| Max cost and timeout | Prevents runaway jobs |
| Output artifact IDs | Registry, catalog, release packet, evidence pack |
| Preemption policy | Defines whether a job can be stopped for release/incident work |
| Retention policy | Controls logs, checkpoints, traces, and evidence artifacts |

At S2+, jobs that lack owner, data scope, code/container identity, and output target should not run on shared release-capable infrastructure. At S4+, missing metadata should fail closed.

---

## Capacity Planning

| Signal | Meaning | Action |
|---|---|---|
| Queue wait time > training time | Capacity or priority policy is wrong | Add capacity, reduce sweeps, or split queues |
| GPU utilization < 30% on shared pool | Waste or bad job packing | Improve batching, image cache, right-size requests, idle cleanup |
| GPU memory OOM retries high | Jobs under-specify memory or use wrong GPU type | Add memory class, admission checks, profile templates |
| Release replay delayed by research jobs | Priority policy is unsafe | Reserve release/evidence lane |
| Incident replay waits for capacity | S4 assurance gap | Reserve incident lane or cloud burst contract |
| Spot/preemptible failures erase work | Checkpointing and preemption policy are weak | Add resumable jobs and non-preemptible evidence lanes |
| One site dominates spend | Local drift or budget policy issue | Review site/ODD unit costs and active-learning yield |
| Image pull/setup dominates runtime | Cache and base image strategy are weak | Pre-pull images, shared base images, artifact cache |

Capacity plans should include cloud burst, on-prem reservations, and fallback modes. The team should know which workloads can wait, which can preempt, which can use spot capacity, and which require trusted non-preemptible workers.

---

## Safety and Evidence Policy

| Policy | S2-S3 | S4-S5 |
|---|---|---|
| Research preemption | Allowed when release work waits | Allowed by policy; audit if it affects evidence |
| Release replay lane | High priority | Reserved capacity with evidence retention |
| Incident response lane | Manual override | Reserved and tested |
| Spot/preemptible GPUs | Good for sweeps and non-critical training | Not for evidence-locked release jobs unless checkpoint and approval exist |
| Logs/checkpoints | Retain for candidate review | Immutable retention for safety-case window |
| Trusted workers | Required for promoted artifacts | Required with attestation and restricted access |
| Cost exceptions | Release owner approval | Safety owner or incident commander approval |

Cost optimization must not delete evidence, skip replay, or starve incident response. The scorecard should distinguish waste reduction from assurance reduction.

---

## Monitoring and Scorecards

| Metric | S0-S1 | S2-S3 | S4-S5 |
|---|---|---|---|
| Queue wait time | Manual note | By workload class and owner | SLO by release/incident/eval lane |
| GPU utilization | Manual `nvidia-smi` | DCGM/exporter or cloud metrics | Platform utilization SLO and anomaly review |
| Failure/retry rate | Manual rerun count | By image, dataset, GPU type, workload | Release blocker if evidence job fails reproducibility |
| Cost allocation | Run note | Owner/site/model/map/label/replay tags | Chargeback/showback, tenant allocation, forecast |
| Preemption impact | Not tracked | Count interrupted jobs and lost work | Audit release/incident preemption decisions |
| Cache efficiency | Not tracked | Image and dataset cache hit rate | Platform SLO |
| Unit economics | Cost per run | Cost per label, replay hour, candidate model | Cost per release, ODD cell, safety evidence pack |
| Bypass rate | Not applicable | Manual exceptions | Platform policy exception metric |

The platform team owns the measurement system at S5, but product teams own whether a GPU job creates valid release evidence. A green scheduler dashboard cannot compensate for a training run that lacks data lineage or evaluation scope.

---

## Failure Modes

| Failure mode | Consequence | Control |
|---|---|---|
| GPU spend optimized globally | Safety replay or incident work starves | Reserved release/incident lanes and workload priorities |
| No cost attribution | Teams cannot explain expensive models or labels | Mandatory owner/site/artifact tags |
| One queue for all jobs | Research, replay, labeling, and incidents block each other | Separate queues and priority policy |
| Spot-only evidence jobs | Preemption erases release evidence | Non-preemptible release lane or robust checkpointing |
| Utilization target too high | No slack for urgent incident work | Reserved assurance capacity |
| Utilization target too low | Expensive idle cluster | Forecasting, autoscaling, and idle cleanup |
| Shadow GPU cluster | Teams bypass provenance and policy | Platform SLOs, self-service templates, and policy gates at registry/eval |
| Scheduler metadata not linked to registry | Cost data cannot explain releases | Job IDs written into dataset, model, map, and release records |
| Cost pressure deletes logs | Safety case cannot be reconstructed | Retention policy and evidence holds |

---

## Related Pages

- `mlops-scale-research-scope.md` - MLOps maturity ladder and GPU FinOps scope.
- `mlops-reference-architectures-by-scale.md` - platform architecture and centralization triggers.
- `mlops-scorecards-and-kpis-by-scale.md` - cost, platform, and release-blocking metrics.
- `platform-sre-reliability-by-scale.md` - platform SLOs, incident lanes, reserved capacity, restore evidence, and bypass controls.
- `site-sliced-release-evidence-by-scale.md` - ODD-cell release evidence and local holdouts.
- `data-flywheel-airside.md` - auto-labeling, active learning, retraining, and scenario mining workloads.
- `../data-platform/cloud-backend-infrastructure.md` - Kubernetes backend, processing jobs, and cost model.
- `../../20-av-platform/compute/training-infrastructure.md` - training infrastructure, containers, and pipeline orchestration.
- `../data-platform/replay-scenario-mining-ops.md` - replay scenarios and suite-management cost.
- `model-governance-release-evidence.md` - model registry and release evidence.

## Sources

- Kubernetes, "Resource Quotas." https://kubernetes.io/docs/concepts/policy/resource-quotas/
- Kubernetes, "Schedule GPUs." https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/
- Kubernetes, "Device Plugins." https://kubernetes.io/docs/concepts/cluster-administration/device-plugins/
- NVIDIA, "About the NVIDIA GPU Operator." https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/
- NVIDIA, "DCGM." https://developer.nvidia.com/dcgm
- NVIDIA, "DCGM-Exporter." https://docs.nvidia.com/datacenter/dcgm/latest/gpu-telemetry/dcgm-exporter.html
- Ray, "Resources." https://docs.ray.io/en/latest/ray-core/scheduling/resources.html
- Ray, "Using GPUs." https://docs.ray.io/en/latest/cluster/kubernetes/user-guides/gpu.html
- Slurm, "Generic Resource (GRES) Scheduling." https://slurm.schedmd.com/gres.html
- Kueue, "Overview." https://kueue.sigs.k8s.io/docs/overview/
- Kueue, "Cluster Queue." https://kueue.sigs.k8s.io/docs/concepts/cluster_queue/
- Kubeflow, "PyTorch Training (PyTorchJob)." https://www.kubeflow.org/docs/components/trainer/legacy-v1/user-guides/pytorch/
- FinOps Foundation, "Allocation." https://www.finops.org/framework/capabilities/allocation/
- FinOps Foundation, "Unit Economics." https://www.finops.org/framework/capabilities/unit-economics/
