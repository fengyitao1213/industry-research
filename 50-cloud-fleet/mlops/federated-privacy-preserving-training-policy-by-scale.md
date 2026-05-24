# Federated and Privacy-Preserving Training Policy by Scale

**Last updated:** 2026-05-24

This page defines when an autonomy program should move from centralized training to federated, hybrid, or other privacy-preserving training patterns. Federated learning is not a maturity badge and not a default replacement for a governed central data pipeline. It is justified when raw data movement is legally, contractually, operationally, or economically constrained and when the model family can tolerate decentralized optimization.

The short rule: **centralize consented and governed data when you can; federate or localize training when you must; never let privacy architecture bypass release evidence.**

---

## Decision Frame

Use federated or privacy-preserving training only when at least one hard constraint exists:

| Constraint | Examples | Better first option |
|---|---|---|
| Legal or contractual data residency | Airport, port, warehouse, customer, or country blocks raw data export | Local data enclave plus central metadata |
| Competitive or tenant boundary | Multiple operators share platform but not raw operations data | Tenant-isolated training exports |
| Raw-data volume or bandwidth | Multi-LiDAR/camera logs cannot be uploaded in useful time | Selective upload and compressed event clips |
| Privacy risk | Faces, bodies, badges, precise worker locations, cargo activity, or customer operations | Redaction, minimization, feature sharing |
| Institutional collaboration | Cross-company or cross-site model improvement is desired | Cross-silo federation with governance |
| Local adaptation | Sites differ materially in objects, markings, weather, lighting, or operating rules | Central base model plus local adapters |

Do not federate just because the system has multiple vehicles. If the organization owns the data, can lawfully process it, can upload useful samples, and needs strong centralized evaluation, centralized training is simpler, more debuggable, and often better.

---

## Scale Policy

| MLOps scale | Policy stance | Minimum evidence | Do not do |
|---|---|---|---|
| S0 notebook research | Simulate federation only for learning or feasibility | Clear note that clients are simulated and privacy is not proven | Claim privacy benefit from a local split |
| S1 repeatable prototype | Compare centralized, local-only, and federated baselines | Fixed federated partition, reproducible rounds, global and per-client metrics | Pick FL before measuring non-IID penalty |
| S2 single-product production | Prefer centralized or local fine-tuning unless data cannot move | Data-use decision, privacy review, registry record, release packet | Let federated round output move `champion` directly |
| S3 fleet and multi-site | Use hybrid training when sites differ or cannot share raw data | Site/client manifests, per-site holdouts, aggregation logs, privacy controls | One global aggregate without local site approval |
| S4 regulated safety-critical | Treat FL output as candidate evidence, not approval | Safety-case links, privacy budget, poisoning/robustness review, immutable round evidence | Approve safety-critical behavior from aggregate metric only |
| S5 platform scale | Provide federation as a governed platform service | Tenant isolation, secure aggregation, policy-as-code, audit API, cost/SLO scorecard | Let tenants define incompatible update schemas or privacy budgets |

For autonomy, the strongest near-term production pattern is usually **hybrid**: central training on consented/owned data, site-local adaptation, and federated aggregation of small adapters or selected layers when cross-site raw-data movement is constrained.

---

## Architecture Options

| Architecture | Advantages | Disadvantages | Best fit |
|---|---|---|---|
| Centralized training | Best observability, simpler debugging, strong global evaluation | Raw-data movement, privacy, residency, bandwidth, tenant concerns | Owned data, one site, consented centralized lake |
| Centralized with redaction/minimization | Keeps central tooling while reducing privacy risk | Redaction QA burden; may remove useful cues | Camera-rich fleets and worker-visible sites |
| Site-local fine-tuning | Simple governance, no cross-site optimizer complexity | Knowledge does not transfer automatically | One customer/site with unique ODD |
| Hybrid central base plus local adapters | Strong base model and cheap local adaptation | Adapter routing and compatibility must be governed | Multi-site perception and semantic segmentation |
| Cross-silo federated learning | Raw data stays local; shared model improves across sites | Non-IID drift, update security, orchestration overhead | Airports, ports, warehouses, hospitals, enterprises |
| Cross-device federated learning | Uses many edge clients | Client churn, bandwidth, privacy attack surface, unreliable hardware | Consumer-scale mobile/vehicle fleets, rarely early AV programs |
| Split learning | Keeps part of the model/data local | Latency, activation leakage, complex deployment | Sensitive features with stable connectivity |
| Secure enclave / confidential compute | Central compute with stronger isolation | Operational complexity, hardware/cloud dependency | Regulated central training or secure aggregation services |
| Synthetic/embedding sharing | Avoids raw-data transfer and may preserve task signal | Domain gap, reconstruction risk, weaker safety evidence | Rare scenes, scenario mining, low-risk analytics |

Do not collapse these into one "privacy-preserving ML" bucket. Each option changes accuracy, observability, failure diagnosis, release evidence, and incident response differently.

---

## Trigger Scorecard

Federation is justified when the scorecard shows a real constraint and the team can support the operational burden.

| Question | Low pressure | Medium pressure | High pressure |
|---|---|---|---|
| Raw-data export allowed? | Yes, approved | Allowed with redaction or limited purpose | Blocked by law, contract, tenant, or site policy |
| Data volume manageable? | Upload samples and events easily | Upload budget constrains long-tail mining | Raw logs cannot move in time or cost envelope |
| Site distribution differs? | Similar ODD and objects | Some local terminology or weather | Local classes, layouts, sensors, or rules differ strongly |
| Client count sufficient? | One site or few vehicles | 2-3 sites with enough samples | 3+ meaningful clients or partner institutions |
| Evaluation available centrally? | Strong central holdout | Some site holdouts | Only local holdouts can legally hold raw labels |
| Privacy controls mature? | Basic access control | Redaction and data inventory | Privacy budget, secure aggregation, tenant isolation |
| Platform readiness? | Scripts only | Pilot orchestration possible | Registry, attestation, audit, monitoring, SLOs |

Recommended decision:

| Score pattern | Decision |
|---|---|
| Mostly low pressure | Stay centralized; improve data governance and selective upload |
| Privacy high, platform low | Use local fine-tuning or site-local models while building governance |
| Privacy/volume high, clients sufficient, platform medium | Pilot hybrid central base plus federated adapters |
| Many clients, shared platform, strong governance | Offer governed cross-silo FL as S5 platform capability |
| Safety-critical artifact without local evidence | Do not promote; collect site-sliced evidence first |

---

## Required Contracts

| Contract | Required fields |
|---|---|
| Client/site manifest | Site ID, owner, jurisdiction, data residency, vehicle/sensor kit, ODD cell, allowed task |
| Local dataset manifest | Snapshot ID, label schema, privacy tier, retention, allowed-use state, local holdout split |
| Training-round manifest | Round ID, server model digest, client update digests, optimizer, local epochs, sample counts, aggregation algorithm |
| Privacy manifest | Secure aggregation mode, differential privacy settings, privacy budget, clipping/noise policy, membership-inference test scope |
| Update attestation | Client identity, code/container digest, local data manifest, produced update digest, policy result |
| Aggregation report | Participating clients, dropped clients, weighting, robust aggregation, validation metrics, anomalies |
| Model registry record | Base model, federated/adapted artifact, client/site scope, global and local metrics, rollback target |
| Release packet | Claim, evidence, ODD/site scope, local approval, safety-case link, monitoring and rollback plan |

Federated updates are artifacts. They need digest-bound identity, policy checks, retention rules, and incident traceability.

---

## Privacy and Security Controls

| Control | What it helps with | What it does not solve |
|---|---|---|
| Access control and local enclaves | Keeps raw data at site or tenant boundary | Gradient/update leakage |
| Secure aggregation | Server sees only aggregate update, not individual updates | Malicious client updates, aggregate privacy leakage |
| Differential privacy | Quantifies privacy loss by adding noise/clipping | Accuracy loss, poor budget accounting, safety evidence gaps |
| Client update attestation | Proves client code and update identity | Data poisoning by approved client |
| Robust aggregation | Reduces outlier or malicious update impact | Sophisticated poisoning and non-IID bias |
| Trusted execution / confidential compute | Reduces infrastructure operator exposure | Model/data leakage through outputs or poor policy |
| Redaction/minimization | Reduces raw personal data before training | Does not prove privacy once features are learned |
| Privacy attack testing | Membership/attribute inference and reconstruction probes | Cannot guarantee all attacks are absent |

Privacy controls must be paired with utility evidence. A differentially private model that fails personnel detection, FOD recall, or false-free-space gates is not release-ready merely because privacy risk is lower.

---

## Training Architecture Comparison

| Model family | Federated fit | Preferred pattern | Caveats |
|---|---|---|---|
| Small 2D/3D detectors | Medium to high | FedAvg/FedProx or hybrid adapters | Watch class imbalance and site-specific labels |
| Large LiDAR/camera foundation backbones | Low for full-model FL | Central base plus LoRA/adapters | Communication and optimizer stability dominate |
| Aggregated-map semantic segmentation | Medium | Site-local maps plus shared adapter or batch-level distillation | Source-map acceptance and release-state labels stay local/evidence-bound |
| Open-vocabulary labelers | Medium | Federate prompt/eval metrics cautiously, not release labels directly | Taxonomy drift and prompt drift need governance |
| Planner or safety policy | Low | Central/safety-reviewed training and local validation | Do not federate safety authority without formal evidence |
| VLM/VLA assistants | Medium | Site-local retrieval/prompt packs plus central eval packs | Privacy and hallucination risk; advisory only unless gated |
| Drift detectors and monitors | Medium to high | Federated statistics with DP or secure aggregation | Metrics can leak site activity if too granular |

Federated learning is most attractive for representation adaptation, local perception robustness, and privacy-preserving analytics. It is least attractive for artifacts that require deterministic certification evidence or tightly controlled runtime behavior.

---

## Evaluation Gates

| Gate | Required evidence |
|---|---|
| Centralized baseline | Same architecture trained centrally on allowed data, when legally possible |
| Local-only baseline | Per-site model/adaptor without aggregation |
| Federated baseline | Global aggregate and per-client metrics under same splits |
| Non-IID stress | Sites/classes/weather/map states with skewed distributions |
| Privacy test | Membership/attribute inference, reconstruction risk, privacy budget report |
| Robustness test | Poisoned/stale/outlier client simulations and dropped-client rounds |
| Release test | Site-sliced holdout, replay, shadow/canary, runtime package compatibility |
| Rollback test | Previous central/local/federated artifact remains executable |

The release question is not "did the federated model improve the average?" It is "which sites improved, which regressed, which privacy promises hold, and which ODD cells are allowed to use this artifact?"

---

## Airside and Non-Road Managed-Site Rules

- Airport, port, campus, warehouse, and industrial customers may allow derived updates while blocking raw video/LiDAR export.
- Local terminology matters. Prompt packs, class aliases, and label taxonomies should remain governed artifacts, not hidden per-client patches.
- Site-local holdouts are mandatory when layout, lighting, markings, vehicle kits, aircraft/GSE mix, or pedestrian behavior differs.
- Semantic-map training exports must preserve release-state labels locally. A federated adapter must not learn that stationary people, parked assets, FOD candidates, construction barriers, or ghost artifacts are permanent map truth.
- Incident and safety/legal-hold data should not enter federation unless the legal/safety owner approves the purpose and retention state.
- A customer-specific local adapter can be the right answer. Cross-site aggregation is not required when cross-site transfer creates more governance risk than value.

---

## Operating Model

| Role | Responsibility |
|---|---|
| Federation owner | Aggregation service, round configuration, client onboarding, failure handling |
| Data/privacy owner | Data-use approvals, residency, privacy budget, deletion propagation |
| Model owner | Architecture, optimizer, evaluation, local/global performance tradeoff |
| Site owner | Local holdout, ODD scope, operational acceptance, incident impact |
| Security owner | Client identity, secure aggregation, attestation, poisoning review |
| Release owner | Registry alias, release packet, rollback, canary decision |
| Safety owner | Safety-case impact, waiver/expiry, hazard-slice release decision |

At S5, the platform may own the federation service, but product and site teams still own release decisions.

---

## Failure Modes

| Failure mode | Consequence | Control |
|---|---|---|
| Federation used before central baseline | Cannot tell if FL helped or hurt | Require central/local/federated comparison where lawful |
| Client data is too non-IID | Global model regresses local sites | Personalized adapters and site-sliced release gates |
| Privacy budget ignored | Claimed DP protection is meaningless | Privacy manifest and budget accounting |
| Secure aggregation treated as complete privacy | Aggregate still leaks or model memorizes | DP, minimization, privacy attack tests |
| Malicious or broken client poisons update | Global model degrades | Client attestation, anomaly detection, robust aggregation |
| Stale client updates | Model trains on outdated map/taxonomy/calibration | Client manifest freshness and update expiry |
| Site labels are incompatible | Aggregation mixes different class meanings | Taxonomy compatibility gate |
| FL output moves directly to champion | Release evidence is skipped | Registry and release packet gates |
| Local adapter routing is wrong | Vehicle loads wrong site model | Compatibility manifest and deployment scope checks |
| Deletion request cannot propagate | Derived model/update remains contaminated | Lineage graph and retraining/containment record |

---

## Related Pages

- `mlops-scale-research-scope.md` - MLOps maturity ladder and research backlog.
- `federated-learning-fleet.md` - detailed federated learning algorithms and airside fleet implementation notes.
- `mlops-migration-checklist-by-scale.md` - transition gates before adding FL platform capabilities.
- `site-sliced-release-evidence-by-scale.md` - local ODD-cell release approval.
- `model-governance-release-evidence.md` - registry aliases, release packets, and rollback evidence.
- `secure-artifact-attestation-profile.md` - update and model artifact attestation.
- `../data-governance/fleet-data-privacy-governance.md` - privacy governance and deletion propagation.
- `../data-platform/fleet-data-pipeline.md` - raw data movement, retention, and training exports.
- `continual-learning.md` - federated continual learning and drift adaptation context.

## Sources

- TensorFlow Federated, "Federated Learning." https://www.tensorflow.org/federated/federated_learning
- Flower Framework, "Secure Aggregation Protocols." https://flower.ai/docs/framework/explanation-ref-secure-aggregation-protocols.html
- Flower Framework documentation. https://flower.ai/docs/framework/index.html
- NVIDIA FLARE. https://developer.nvidia.com/flare
- NVIDIA Technical Blog, "Federated Learning Without the Refactoring Overhead Using NVIDIA FLARE." https://developer.nvidia.com/blog/federated-learning-without-the-refactoring-overhead-using-nvidia-flare/
- OpenDP, "Typical Workflow." https://docs.opendp.org/en/stable/getting-started/typical-workflow.html
- NIST Privacy Framework. https://www.nist.gov/privacy-framework
- NIST SP 800-226, "Guidelines for Evaluating Differential Privacy Guarantees." https://csrc.nist.gov/pubs/sp/800/226/final
