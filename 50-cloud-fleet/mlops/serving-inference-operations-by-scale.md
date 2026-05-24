# Serving and Inference Operations by Scale

**Last updated:** 2026-05-24

Serving is the operational boundary where a trained model, map labeler, evaluator, or foundation-model tool becomes an accountable production system. In MLOps, serving is not only an HTTP endpoint. It includes batch inference, offline map segmentation, shadow mode, canary rollout, on-vehicle runtime packages, cloud endpoints, multi-model servers, model-mesh platforms, traffic mirroring, autoscaling, rollback, and the telemetry that proves the served artifact is the artifact that was evaluated.

Use this page with `mlops-scale-research-scope.md` for maturity, `model-registry-artifact-lifecycle-by-scale.md` for aliases and artifact identity, `evaluation-platform-replay-gates-by-scale.md` for runtime-package and replay gates, `site-sliced-release-evidence-by-scale.md` for ODD-cell rollout evidence, `model-monitoring-drift-response-by-scale.md` for telemetry and incident actions, `secure-artifact-attestation-profile.md` for signatures and provenance, and `../../40-runtime-systems/ml-deployment/production-ml-deployment.md` for vehicle-side TensorRT/Triton details.

The core rule is: **serving authority must be scoped, observable, and reversible.** A served model is release-relevant only for the scope named in its registry alias, deployment manifest, input contract, runtime package, monitor policy, and rollback bundle.

---

## What Serving Owns

| Surface | What it controls | Failure it prevents |
|---|---|---|
| Inference API | Request/response schema, protocol, error semantics, timeout, batching | Clients depend on undocumented tensors or unstable JSON fields |
| Runtime package | ONNX, TensorRT engine, container, Python service, preprocessing, postprocessing, class order | Offline checkpoint differs from deployed behavior |
| Routing | Shadow, mirror, canary, traffic split, site/channel rollout, fallback | New model receives authority outside its evidence scope |
| Scaling | Replica count, GPU placement, batching, queue policy, cold start, admission control | Latency SLO fails under load or cost explodes at idle |
| Observability | Latency, queue time, model load, input/output quality, artifact IDs, drift, errors | Runtime failures are mistaken for model-quality failures |
| Governance | Registry alias, release packet, attestation, endpoint IAM, approval state, rollback | Unreviewed model reaches production or cannot be rolled back |

Serving therefore sits between training/evaluation and operations. It consumes registry records and release evidence; it produces runtime telemetry, shadow/canary evidence, incident facts, and future data-mining triggers.

---

## Scale Ladder

| MLOps scale | Serving posture | Minimum control | Anti-pattern to block |
|---|---|---|---|
| S0 notebook research | Local inference in notebook or script | Commit, environment note, sample input/output, no production clients | Demo endpoint becomes a hidden dependency |
| S1 repeatable prototype | Containerized local or internal service | Frozen model path, deterministic preprocessing, smoke test, simple latency note | `latest.pkl` or mutable bucket prefix behind an API |
| S2 single-product production | Product endpoint or edge package | Registry alias, deployment manifest, runtime package test, rollback target, basic monitoring | Training job deploys directly to production |
| S3 fleet and multi-site | Site/ODD-scoped serving lanes | ODD-cell routing, shadow/canary, site telemetry, delayed-label joins, blast-radius query | Global traffic percentage approves local managed-site behavior |
| S4 regulated safety-critical | Evidence-controlled serving | Safety-case-linked release, signed artifact, retention hold, rollback drill, incident/evidence path | Endpoint update lacks immutable evidence or reportability context |
| S5 platform scale | Multi-tenant serving platform | Standard protocols, policy-as-code, tenant isolation, endpoint SLOs, audit API, cost attribution | Teams bypass platform controls because serving is slower than local scripts |

Scale follows artifact authority. A small offline semantic-map batch service can require S4 controls if its outputs publish map truth or feed safety evidence. A large exploratory embedding service can remain S1 if no release-affecting consumer depends on it.

---

## Serving Modes

| Mode | Typical workload | Required from | Notes |
|---|---|---|---|
| Local batch inference | Research scoring, one-off label generation | S0 | Must not create release labels without later promotion |
| Reproducible batch job | Dataset scoring, offline map segmentation, pseudo-label generation | S1-S2 | Best for aggregated LiDAR maps, image colorization, open-vocabulary labelers, and replay scoring |
| Online synchronous endpoint | Low-latency API, product service, live perception microservice | S2 | Needs timeout, readiness, liveness, autoscaling, and schema stability |
| Asynchronous endpoint | Large payloads, long processing, batch-like online workflows | S2-S3 | Useful for long map tiles, image/video clips, or foundation-model labelers |
| Shadow or mirrored endpoint | Candidate observes production traffic without authority | S2-S3 | Telemetry must separate champion and shadow outputs by artifact ID |
| Canary endpoint | Candidate serves limited real authority | S3 | Scope by ODD cell, not only traffic percentage |
| Edge or on-vehicle runtime | Perception, occupancy, segmentation, safety monitor | S2-S4 | Hard real-time, hardware, calibration, map, and fallback constraints dominate |
| Multi-tenant platform | Many teams, model families, endpoints, tenants | S5 | Requires policy, quotas, inventory, endpoint templates, and exception workflow |

For autonomy, batch serving is often as important as online serving. Offline map segmentation, replay evaluation, auto-labeling, synthetic-data scoring, and delayed-label joins can change release truth even when they never answer a live API request.

---

## Architecture Options

| Serving architecture | Advantages | Disadvantages | Best use |
|---|---|---|---|
| Python script or notebook | Fast, transparent, no platform dependency | Weak API contract, weak concurrency, weak observability | S0 exploration and tiny batch jobs |
| FastAPI/Flask custom service | Simple API, easy to wrap custom preprocessing | Reimplements model loading, batching, health, metrics, rollout, and GPU control | S1 prototypes and low-risk internal services |
| ONNX Runtime service | Portable model format, CPU/GPU execution options, quantization path | Custom preprocessing and rollout controls still need engineering | S1-S3 portable model serving and CPU/GPU batch inference |
| TensorRT embedded runtime | Lowest latency on NVIDIA targets, strong fit for Orin/Thor | Hardware/version-specific engines, build/cache discipline required | S2-S4 vehicle inference and edge map/perception packages |
| NVIDIA Triton | Multi-framework serving, model repository, dynamic batching, ensembles, metrics, model management | Operational complexity, repository discipline, edge integration choices | S2-S5 GPU serving, multi-model perception, batch/offline inference, shared GPU endpoints |
| KServe | Kubernetes-native InferenceService, serving runtimes, traffic, autoscaling, protocol standardization | Requires Kubernetes/Istio/Knative or raw deployment expertise | S2-S5 cloud/on-prem platform serving with common endpoint abstraction |
| Seldon Core 2 | Kubernetes/local deployment, control/data plane separation, experiments, pipelines | Platform ownership needed; autonomy metadata still external | S3-S5 enterprise model-serving platform and inference graphs |
| Ray Serve | Python-native composition, autoscaling, distributed replicas, good for model graphs | Needs Ray cluster operations and careful resource isolation | S2-S5 simulation, foundation-model tools, model cascades, Python-heavy services |
| BentoML | Good service packaging, Python developer ergonomics, deployment and autoscaling options | Production governance and autonomy evidence need external systems | S1-S3 teams shipping custom model APIs without full platform buildout |
| MLServer / Open Inference Protocol service | Standard V2 protocol, REST/gRPC, multi-model serving, works with KServe/Seldon | Lower-level than a complete release platform | S2-S5 interoperable Python inference servers |
| Managed SageMaker / Vertex AI / Azure ML endpoints | Fast production path, autoscaling, traffic split, monitoring integrations, managed operations | Vendor coupling, data-residency and custom artifact metadata limits | S2-S4 cloud-native products and standard model families |
| OTA edge package with local supervisor | Works offline, deterministic startup, can fail closed, integrates with vehicle safety | Harder rollout and observability; every package must match target hardware | S2-S4 vehicles, robots, managed sites, and safety-adjacent perception |

A practical stack often splits responsibilities: Triton or TensorRT for edge/GPU execution, KServe/Seldon/Ray/BentoML for service deployment, managed endpoints where cloud integration is enough, and a separate registry/evidence layer that controls authority.

---

## Platform Selection by Scale

| Decision | S0-S1 | S2-S3 | S4-S5 |
|---|---|---|---|
| API protocol | Local function or simple REST | REST/gRPC with documented schema; prefer Open Inference Protocol where feasible | Standard protocol plus policy, audit, compatibility, and tenant namespace |
| Runtime loading | Direct checkpoint or ONNX | Immutable version, container/engine digest, readiness probe | Signed artifact, admission policy, rollback cache, evidence retention |
| Traffic control | Manual run selection | Shadow, canary, blue/green, mirror, header/route/site routing | Policy-gated rollout, automatic hold/rollback triggers, exception workflow |
| Scaling | Manual machine choice | Min/max replicas, GPU placement, batching, queue alerts | Capacity SLO, quota, chargeback, reserved incident/evidence lane |
| Observability | Logs and timing notes | Latency, errors, input/output quality, artifact IDs, drift proxies | Platform SLOs, alert quality, audit export, blast-radius query |
| Security | Local credentials | Endpoint IAM, network isolation, signed container | Tenant isolation, attestation verification, vulnerability disposition, data residency |

Do not start with a model-serving platform before the service contract is clear. The durable part is the endpoint manifest and artifact identity; the serving engine can change later.

---

## Inference Service Manifest

At S2+, every release-relevant service should have a manifest that can be attached to a release packet and queried during incidents.

| Field | Required contents |
|---|---|
| `service_id` | Stable service name, version, owner, environment, namespace, endpoint URL or vehicle package ID |
| `artifact_set` | Model/checkpoint, ONNX/TensorRT/container, preprocessing, postprocessing, map, calibration, taxonomy, prompt/evaluator, threshold IDs |
| `registry_authority` | Alias, lifecycle state, allowed-use scope, approver, rollback alias |
| `input_contract` | Modality, schema, tensor names/shapes, coordinate frame, timestamp policy, calibration requirements, missing-data behavior |
| `output_contract` | Class order, units, coordinate frame, confidence, uncertainty, abstention/OOD fields, release-state fields where used |
| `runtime_target` | CPU/GPU/DLA, CUDA/TensorRT/driver versions, memory budget, hardware cohort, acceleration profile |
| `traffic_policy` | Batch, online, shadow, canary, blue/green, mirror, site/route/vehicle cohort, percentage, header, or release channel |
| `scaling_policy` | Min/max replicas, autoscaling metric, queue length, batch size, max latency, cold-start budget |
| `observability` | Metrics, logs, traces, artifact IDs in telemetry, sampling policy, retention, delayed-label join key |
| `safety_policy` | Degraded mode, fail-closed behavior, fallback artifact, ODD restriction, on-call owner, incident severity |
| `security` | Image digest, signature, SBOM, provenance, IAM, network policy, secrets, vulnerability disposition |
| `evidence_links` | Evaluation manifest, runtime smoke, replay report, shadow/canary report, release packet, rollback drill |

The manifest should be generated by pipeline orchestration and consumed by deployment, monitoring, incident response, and registry lifecycle checks.

---

## Runtime Optimization and Capacity

Serving optimization is a trade among latency, throughput, determinism, cost, and safety margin.

| Technique | Benefit | Risk | Guardrail |
|---|---|---|---|
| Dynamic batching | Higher GPU utilization and throughput | Added queue latency can violate real-time budgets | Per-model max queue delay and p99 latency gate |
| Static batching | Predictable execution | Wastes capacity at low traffic | Use for deterministic replay or fixed camera/LiDAR batches |
| TensorRT FP16/INT8/FP8 | Lower latency and memory | Quantization can damage rare classes or calibration | Representative calibration set and slice metrics |
| Multi-model server | Fewer processes, shared metrics, model management | One serving process can become a shared failure domain | Isolation by criticality and rollback-tested model repository |
| Autoscaling | Cost and capacity elasticity | Cold starts, replica churn, unstable p99 | Min replicas for safety-critical services and warmup tests |
| Model ensembles | Standardized preprocessing/model/postprocessing graph | Hidden coupling between components | Version each component and hash the ensemble graph |
| Model mesh / multi-model loading | Efficient many-model hosting | Load/unload latency and cache eviction risk | Pin active champions and protect rollback artifacts |
| Edge DLA/GPU partitioning | Lower power and predictable compute | Unsupported ops or precision differences | Runtime package smoke on target hardware cohort |
| Request shedding/backpressure | Protects latency under overload | Dropped requests can hide safety evidence | Explicit admission policy, telemetry, and fallback behavior |

For vehicle inference, latency budgets should include sensor preprocessing, transfer, inference, postprocessing, synchronization, and downstream consumer deadline. The model server's p50 latency is not enough.

---

## Rollout and Routing Patterns

| Pattern | What it proves | Good fit | Guardrail |
|---|---|---|---|
| Blue/green | New fleet or deployment can replace old without downtime | Cloud endpoints and service APIs | Health alarms and rollback before old fleet is removed |
| Canary | Candidate handles limited authority | S2-S3 product and site rollout | Canary cohort must match target ODD cell |
| Linear traffic shift | Gradual exposure | Stable web/API traffic | Not enough for rare hazards unless slice exposure is measured |
| Shadow/mirror | Candidate sees live traffic without authority | S2-S3 model comparison | Mirror logs must not affect operators or labels without promotion |
| Header or cohort routing | Explicit user/site/vehicle selection | Multi-site fleets and A/B tests | Scope in manifest and monitoring denominator |
| Route/zone/task routing | ODD-cell-specific model or adapter | Airports, ports, warehouses, campuses, urban districts | Site champion cannot leak into unapproved route/task |
| Emergency rollback | Restore known-good artifact set | All S2+ releases | Rollback artifact must still load under active runtime/map/schema |

Do not equate traffic percentage with safety coverage. A 10% canary can still miss night, rain, construction, terminal-frontage, worker-crossing, narrow-corridor, and changed-map slices.

---

## Training and Model-Architecture Coupling

Serving constraints should feed back into model and training choices before the final release gate.

| Model/training decision | Serving implication | Example control |
|---|---|---|
| Sparse 3D LiDAR network | May need custom ops, sparse libraries, or batch-size limits | Export smoke and target-hardware profile before promotion |
| Image-LiDAR fusion | Requires synchronized modalities and calibration validity | Input contract fails closed on missing image/calibration if image is runtime-required |
| Train-time image distillation | Image dependency should not appear at serving time | Manifest marks image as train-time only, not runtime input |
| Open-vocabulary labeler | Usually batch/offboard, not hard real-time | Reviewer workflow and allowed-use state before labels train a model |
| Foundation model or VLM endpoint | High latency, cost, prompt/retrieval drift | Use for advisory, labeling, or evaluation unless safety evidence supports authority |
| Quantization-aware training | Improves deployable accuracy under INT8/FP8 | Evaluate quantized package, not just FP32 checkpoint |
| Model cascade or early exit | Saves compute | Monitor branch distribution and rare-class misses |
| Site adapter or LoRA | Localizes behavior | Adapter is a registry artifact with site-scoped serving route |

The serving platform should not discover deployment infeasibility after evaluation. At S2+, export, runtime package smoke, and latency/memory gates belong before `shadow` or `site_canary`.

---

## Autonomy and Managed-Site Rules

For airside, port, yard, warehouse, campus, construction, mining, and non-road urban-district mapping applications:

- Serving scope should be ODD-cell-specific: site, route, zone, task, weather/lighting, vehicle kit, map state, calibration package, and release channel.
- Runtime models must report model, map, calibration, semantic taxonomy, telemetry schema, and runtime package IDs in every monitoring event.
- Offline aggregated-map segmentation services must be governed like production systems when they publish semantic maps, release-state labels, map-hygiene layers, pseudo-label exports, or digital-twin assets.
- LiDAR-only, LiDAR-image fusion, image-distilled, and image-dependent routes need different serving manifests. A model that needs images at runtime cannot be deployed to a LiDAR-only vehicle cohort.
- Stationary people, parked movable assets, cones, pallets, temporary barriers, and FOD candidates require serving outputs that preserve semantic class, confidence, and release-state fields instead of collapsing them into permanent map truth.
- Urban-district mapping that is not a road-driving ODD still needs privacy, facade/sidewalk/service-lane slice metrics, construction/change routing, and tenant/site data boundaries.

Serving is also a map-governance boundary. A semantic-map service, map cleaner, or labeler can change what downstream vehicles believe is permanent infrastructure.

---

## Observability and Incident Hooks

| Metric family | Examples | Release use |
|---|---|---|
| Service health | Readiness, liveness, model loaded, replica count, request errors | Blocks rollout or triggers rollback |
| Latency and queue | p50/p95/p99, queue time, batch size, timeout, dropped requests | Runtime SLO and canary exit |
| Resource | GPU memory, utilization, DLA usage, CPU, storage, model cache | Capacity and cost planning |
| Input quality | Schema violations, missing modality, point count, camera exposure, timestamp skew | Detects broken serving contract |
| Output behavior | Confidence, class counts, OOD rate, uncertainty, abstention, map release-state volume | Drift and delayed-label routing |
| Artifact identity | Model, engine, container, map, calibration, taxonomy, prompt/evaluator IDs | Root-cause and blast-radius query |
| Rollout state | Shadow/canary/champion, cohort, route, site, percentage, time window | Site-sliced release evidence |
| Security | Signature verification, image digest, vulnerability disposition, policy result | Admission and audit evidence |

The monitoring event contract in `model-monitoring-drift-response-by-scale.md` should include these fields. Without artifact identity, a serving dashboard cannot distinguish model drift from map changes, calibration faults, endpoint rollout, or runtime degradation.

---

## Release Blockers

| Blocker | Applies from | Example |
|---|---|---|
| Missing serving manifest | S2 | Endpoint has no input/output/runtime/traffic contract |
| Artifact mismatch | S2 | Deployed TensorRT engine was not the one evaluated |
| Mutable artifact reference | S2 | Runtime pulls `latest` image or bucket prefix |
| Missing rollback | S2 | Previous artifact cannot load under active runtime |
| No health/latency gate | S2 | Canary starts without readiness, liveness, p99, memory, or queue checks |
| Shadow contamination | S3 | Shadow output influences labels, operators, or maps before review |
| ODD scope leak | S3 | Site adapter receives traffic outside approved site/route/task |
| Missing artifact IDs in telemetry | S3 | Incident cannot identify active model/map/calibration/runtime |
| Unsigned or unverified package | S3-S4 | Vehicle loads untrusted model/container/map package |
| Safety monitor regression | S4 | Endpoint update changes monitor timing, false-free-space behavior, or fallback state without evidence |
| Platform bypass | S5 | Team deploys model outside shared registry/eval/policy path |

A serving release is ready only when it can be deployed, observed, held, rolled back, and explained from immutable evidence.

---

## KPIs

| KPI | Meaning | Scale |
|---|---|---|
| Package parity | Deployed artifact digest matches evaluated artifact digest | S2+ |
| Endpoint readiness | Percentage of releases with readiness/liveness/load smoke evidence | S2+ |
| p99 latency margin | Difference between deadline and observed p99 including preprocessing/postprocessing | S2+ |
| Canary exposure coverage | Target ODD cells observed during canary window | S3+ |
| Rollback load-test success | Rollback artifact still loads and serves under active runtime | S2+ |
| Artifact-ID telemetry coverage | Requests/events with model/map/calibration/runtime IDs | S3+ |
| Shadow disagreement closure | Shadow disagreements triaged into no-op, label, replay, hold, or reject | S3+ |
| Endpoint cost per useful inference | Cost normalized by accepted labels, replay decisions, or product requests | S3-S5 |
| Platform bypass rate | Deployments outside approved serving path | S5 |
| Incident blast-radius time | Time to identify affected endpoint, artifact, site, and cohort | S3-S5 |

Serving KPIs should be interpreted with risk. Reducing p99 by removing safety checks is not an improvement. Lowering cost by deleting rollback capacity is not FinOps success.

---

## Failure Modes

| Failure mode | What happens | Control |
|---|---|---|
| Endpoint-first MLOps | Team builds serving before defining data/eval/registry contracts | Require manifests and artifact identity before S2 endpoint |
| Checkpoint promoted instead of package | Offline score does not match deployed behavior | Evaluate the exact container/engine/service graph |
| Framework lock-in hides missing metadata | Managed endpoint looks production-ready but lacks map/calibration/ODD fields | Attach autonomy-specific deployment manifest |
| Autoscaling hides cold-start risk | Canary passes during warm traffic but fails after idle | Warmup, min replicas, load test, and cold-start SLO |
| Batch service treated as non-production | Auto-labeler or map segmenter silently changes training truth | Registry, allowed-use, and reviewer states for batch outputs |
| Global canary hides local failure | Easy routes dominate exposure | ODD-cell denominator and site-sliced rollout |
| Shadow output leaks into operations | Candidate affects humans without authority | Separate logs, access policy, and allowed-use state |
| Rollback artifact expired | Previous model cannot load due to runtime/schema drift | Periodic rollback load test and retention hold |
| Serving monitor shares failure mode | Same process failure disables model and monitor | Independent health path or safety monitor where required |
| Platform too slow | Teams deploy custom endpoints outside governance | Golden paths, platform SLOs, exception flow, admission control |

---

## Related Pages

- `mlops-scale-research-scope.md` - MLOps maturity ladder and lifecycle planes.
- `mlops-reference-architectures-by-scale.md` - S0-S5 platform blueprints and durable interfaces.
- `mlops-migration-checklist-by-scale.md` - transition gates before introducing serving platforms.
- `mlops-scorecards-and-kpis-by-scale.md` - serving, runtime, release, and platform KPIs.
- `model-registry-artifact-lifecycle-by-scale.md` - aliases, lifecycle states, artifact-set records, and rollback retention.
- `evaluation-platform-replay-gates-by-scale.md` - runtime package checks, replay gates, and shadow/canary evidence.
- `model-monitoring-drift-response-by-scale.md` - monitoring event contract and response state machine.
- `site-sliced-release-evidence-by-scale.md` - ODD-cell release manifests and canary denominators.
- `pipeline-orchestration-release-workflows-by-scale.md` - export, package, register, deploy, and release state machines.
- `secure-artifact-attestation-profile.md` - signed runtime artifacts and verification gates.
- `../ota/perception-slam-artifact-compatibility-matrix.md` - model/map/calibration/runtime compatibility for release.
- `../../40-runtime-systems/ml-deployment/production-ml-deployment.md` - TensorRT, Triton, edge inference, latency, and vehicle deployment details.

---

## Sources

- NVIDIA, "NVIDIA Triton Inference Server Architecture." https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/architecture.html
- NVIDIA, "Ensemble Models - Triton Inference Server." https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/ensemble_models.html
- NVIDIA, "Optimizing TensorRT Performance." https://docs.nvidia.com/deeplearning/tensorrt/latest/performance/optimization.html
- KServe, "Serving Runtime." https://kserve.github.io/website/docs/concepts/resources/servingruntime
- KServe, "Open Inference Protocol (V2 Inference Protocol)." https://kserve.github.io/website/docs/concepts/architecture/data-plane/v2-protocol
- Ray, "Ray Serve Autoscaling." https://docs.ray.io/en/latest/serve/autoscaling-guide.html
- Seldon, "Seldon Core 2 Architecture." https://docs.seldon.ai/seldon-core-2/v2.9/about/architecture
- Seldon, "Seldon Core 2 Features." https://docs.seldon.ai/seldon-core-2/v2.9/about/core-features
- BentoML, "Configure Deployments." https://docs.bentoml.com/en/latest/scale-with-bentocloud/deployment/configure-deployments.html
- MLServer, "MLServer Documentation." https://mlserver.readthedocs.io/
- Amazon SageMaker AI, "Blue/Green Deployments." https://docs.aws.amazon.com/sagemaker/latest/dg/deployment-guardrails-blue-green.html
- Amazon SageMaker AI, "Use canary traffic shifting." https://docs.aws.amazon.com/sagemaker/latest/dg/deployment-guardrails-blue-green-canary.html
- Google Cloud, "Deploy a model to an endpoint." https://cloud.google.com/vertex-ai/docs/general/deployment
- Google Cloud, "Scale inference nodes by using autoscaling." https://docs.cloud.google.com/vertex-ai/docs/predictions/autoscaling
- Microsoft Learn, "Online endpoints for real-time inference." https://learn.microsoft.com/en-us/azure/machine-learning/concept-endpoints-online
- Microsoft Learn, "Safe rollout for online endpoints." https://learn.microsoft.com/en-us/azure/machine-learning/how-to-safely-rollout-online-endpoints
