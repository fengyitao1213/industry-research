# Model Governance and Release Evidence

**Last updated:** 2026-05-24

## Why It Matters

An autonomy model release is not just a better checkpoint. It is a controlled change to vehicle behavior, data assumptions, safety evidence, runtime compatibility, and rollback posture. The release system must prove which model version is approved, what data and tests support it, where it is allowed to run, and how the fleet can return to the previous safe version.

Use this page for model release evidence. It does not replace OTA controls, software supply-chain evidence, or the safety case; it is the MLOps evidence packet that those systems consume.

## Operating Model

1. Register every deployable model in a model registry before release review. Use immutable model versions and mutable aliases such as `candidate`, `shadow`, `champion`, and `rollback` for deployment routing.
2. Attach release metadata to the model version: training run ID, code commit, dataset snapshots, label schema, feature schema, calibration package, runtime container, hardware target, and ODD scope.
3. Treat release approval as a claims-and-evidence review. The release claim states what improved, what did not regress, which ODD is covered, and which operational risk is being reduced.
4. Require named approval from the model owner, data owner, runtime owner, safety owner, and fleet operations owner before moving the `champion` alias.
5. Move through gates: offline metrics, scenario replay, shadow execution, limited canary, fleet expansion. Each gate either promotes, holds, or rejects the exact model version.
6. Keep rollback executable. The rollback model must be compatible with the active runtime, map schema, calibration schema, and config bundle.
7. Govern offboard labeler models and prompt sets as release-relevant artifacts when they influence semantic maps or training labels. A ZOPP/SALT/OpenUrban3D-style labeler may be offline-only, but its candidates can change the dataset, taxonomy, replay suite, and signed semantic-map bundle.

## Governance by MLOps Scale

The companion scale hub (`mlops-scale-research-scope.md`) separates MLOps maturity from fleet size alone. A small safety-critical deployment can need S4 evidence, while a large offline research program may still be S1 if no model reaches users.

| Scale | Governance minimum | Release risk to control |
|---|---|---|
| S0 notebook research | Run notes, code commit, data pointer, fixed split | Result cannot be reproduced |
| S1 repeatable prototype | Experiment tracker, dataset snapshot, Docker image, validation script | Demo model becomes an undocumented baseline |
| S2 production product | Registry version, candidate/shadow/champion/rollback aliases, release packet, canary plan | Unreviewed model reaches an operational system |
| S3 fleet and multi-site | Site/ODD slices, release channels, local holdouts, fleet monitoring, data-mining triggers | One global metric hides site-specific regressions |
| S4 regulated safety-critical | Named approvers, safety-case claim links, immutable evidence, incident/rollback drill | Behavior change cannot be justified after an incident or audit |
| S5 platform scale | Policy-as-code, multi-tenant registry, evidence automation, cost and access controls | Teams bypass shared governance with bespoke pipelines |

For airside autonomy, model governance should usually reach S2 before the first shadow deployment and S4 before a model controls or materially influences a safety-critical behavior. That includes offline models when their outputs become semantic-map labels, training positives, route restrictions, or release evidence.

### Where Governance Lives in the Architecture

Governance should attach to architecture boundaries, not meeting rituals. The companion `mlops-reference-architectures-by-scale.md` page defines which components are local versus shared; the release rule is that any artifact crossing from local experimentation into shared release authority must gain immutable identity, ownership, allowed use, evidence, and rollback metadata.

| Scale boundary | Governance anchor | What must be blocked |
|---|---|---|
| S0 -> S1 baseline | Dataset snapshot, run manifest, validation script | Reusing a notebook result as a hidden baseline |
| S1 -> S2 production | Model registry version and release packet | Moving `candidate`, `shadow`, or `champion` aliases without data/runtime/eval evidence |
| S2 -> S3 fleet | Site/ODD rollout manifest and telemetry IDs | Expanding one model to new sites, routes, weather, maps, or vehicle kits without local evidence |
| S3 -> S4 safety-critical | Safety-case claim/evidence record | Behavior authority changing while waivers, incident scenarios, or rollback proof are unresolved |
| S4 -> S5 platform | Policy-as-code and audit API | Shared services allowing tenant bypass, unsupported data reuse, or untracked evaluator/prompt changes |

## Incident and Rollback Evidence by Scale

Post-release failures should update the model record, not only an operations ticket. The model registry is the anchor for finding which model, dataset, map, calibration, runtime, prompt, and evaluator artifacts were active when the failure occurred.

| Scale | Incident linkage | Rollback evidence | Governance outcome |
|---|---|---|---|
| S0 notebook research | Attach failure examples to the run note | Previous run or baseline remains the comparison point | Result is marked exploratory or invalid |
| S1 repeatable prototype | Link regression to dataset snapshot and validation script | Prior baseline can be rerun from archived artifacts | Baseline is frozen until comparison is clean |
| S2 production product | Incident ticket links to registry version, candidate/shadow/champion alias, and release packet | `rollback` alias points to compatible model/container/config bundle | Release packet is corrected or rejected |
| S3 fleet and multi-site | Incident links to active manifests by site, route, ODD cell, map tile, and vehicle cohort | Rollback/canary decision records affected and unaffected cohorts separately | Local holdouts and replay suite are updated |
| S4 regulated safety-critical | Incident links to safety-case claims, monitor activations, waiver state, and reportability assessment | Rollback proof includes timeline, authority, compatibility, and residual-risk decision | Safety-case delta and corrective action are mandatory |
| S5 platform scale | Incident links shared registry, evaluator, prompt, feature-store, and policy decisions across tenants | Rollback verifies tenant isolation and shared-service compatibility | Platform control or policy changes are reviewed organization-wide |

The release packet should keep the last known-good model executable for as long as the operational rollback window requires. If a new taxonomy, map schema, calibration schema, or runtime container makes the previous model unloadable, the release is not rollback-ready even if the old checkpoint still exists.

## Release Ownership Matrix

Release governance fails when "the model team approved it" means nobody checked data, runtime, maps, or safety evidence. Use explicit ownership:

| Decision | Accountable owner | Must approve when safety-relevant | Evidence to attach |
|---|---|---|---|
| Candidate model is reviewable | Model owner | Data owner | Training provenance, dataset manifest, evaluation report |
| Dataset snapshot is eligible | Data owner | Privacy/security owner, map owner for map-derived labels | Lineage, split policy, label QA, retention/data-use class |
| Runtime artifact is deployable | Runtime owner | OTA/SUMS owner | ONNX/TensorRT/container compatibility, load test, rollback artifact |
| ODD/site scope is valid | Fleet operations owner | Safety owner, site operations | Site slices, shadow coverage, local holdout metrics |
| Release claim is defensible | Safety owner | Model owner, data owner, runtime owner, release manager | Scenario replay, safety-case claim IDs, residual-risk decision |
| Champion alias can move | Release manager | Model, data, runtime, safety, fleet operations | Signed release decision, rollback trigger, expiry date |
| Rollback can execute | Runtime owner | Fleet operations owner | Rollback alias, cached artifact, compatibility proof, drill result |

Scale changes the ceremony, not the ownership. S0 may record the owner in a run note. S2 needs registry metadata. S4 needs immutable approval records and evidence expiry. S5 should automate ownership checks but should not remove named accountability.

## Evidence Artifacts

| Artifact | Minimum contents | Owner |
|---|---|---|
| Model registry record | Registered model, immutable version, aliases, tags, release notes | MLOps |
| Training provenance | Run ID, code commit, dependency lock, training config, random seeds, hardware | Model owner |
| Dataset manifest | Iceberg/DVC snapshot IDs, label schema, release-state label schema for map-derived data, excluded data, leakage checks | Data owner |
| Offboard labeler evidence | Labeler pipeline version, prompt set, model/checkpoint IDs, calibration/projection hash, threshold file, accepted/rejected candidate statistics, taxonomy-promotion IDs | Label operations |
| Evaluation report | Primary metrics, calibration, uncertainty, class slices, airport and weather slices | Model owner |
| Scenario replay report | Required scenario suite, new mined scenarios, failures, waivers | Safety validation |
| Shadow-mode report | Disagreement with champion, intervention correlation, latency and resource use | Fleet operations |
| Safety case link | Claim IDs supported by this release and evidence IDs attached to each claim | Safety owner |
| Compatibility manifest | Active model/map/calibration/runtime/telemetry/semantic-taxonomy artifact set, compatibility hash, MLOps scale, rollback set, labeler/prompt/evaluator dependencies | Release manager |
| Release decision record | Approvers, residual risks, rollout plan, rollback trigger, expiry date | Release manager |

## Foundation-Model and Prompt Evidence

Foundation-model artifacts need release evidence when they influence labels, maps, operator guidance, incident reports, safety-case drafts, or model evaluation. The question is not whether the model runs online. The question is whether its output can change a released artifact or an operational decision.

| Artifact | Evidence required before promotion | Release boundary |
|---|---|---|
| Prompt pack | Prompt text, system instruction, variables, few-shot examples, prompt owner, intended task, change log | May generate candidates only until tied to an approved evaluation pack |
| Foundation-model endpoint or checkpoint | Provider, model ID, checkpoint or API version, hosted region, data-retention mode, quantization | Provider updates require regression review when output affects evidence |
| Decoding and safety policy | Temperature, top-p, max tokens, refusal policy, abstention/unknown policy, content filters | Non-deterministic settings must not be used for release labels without stability evidence |
| Retrieval corpus | Corpus snapshot, embedding model, index ID, access policy, expiry, citation coverage | RAG outputs are invalid if the corpus or index cannot be reconstructed |
| Tool-using agent policy | Tool allowlist, read/write permissions, planner depth, timeout, human approval gates | Agents cannot mutate maps, labels, manifests, tickets, or approvals without an explicit workflow gate |
| Judge/evaluator model | Judge prompt, judge model, calibration set, human-disagreement rate, slice thresholds | Judge scores route review; they do not replace release approval in S4 contexts |
| Trace bundle | Input digest, output, citations, tool calls, latency, reviewer correction, final disposition | Audit and rollback require the full chain, not only the accepted answer |

For semantic-map pipelines, the strict boundary is `candidate_label -> review_label -> qa_label -> release_label`. VLMs, VLA teachers, open-vocabulary segmenters, prompt-driven labelers, and LLM reviewers can accelerate the first two states, but the release packet must still prove taxonomy action, source-map acceptance, calibration/projection hash, reviewer disposition, QA metrics, and rollback impact. A generated natural-language explanation is supporting context, not a substitute for geometric, scenario, or safety evidence.

## Acceptance Checks

- The model can be loaded by registry alias and by immutable version.
- The model version has dataset, code, config, and runtime provenance sufficient to rebuild or explain the release.
- Any offline labeler or prompt pack that contributed labels has immutable provenance and a rollback impact assessment for affected datasets, semantic-map manifests, and taxonomy versions.
- Any map-derived pseudo-label batch has semantic class, confidence, release-state label, source-map acceptance ID, split ID, and reviewer state; non-`permanent_static` labels cannot appear as supervised static positives without an explicit auxiliary-task declaration.
- The evaluation report includes both aggregate metrics and operational slices for airport zone, lighting, weather, vehicle platform, and object class.
- No critical scenario replay regression is open without an approved safety waiver and an explicit operational mitigation.
- Shadow-mode evidence covers the same ODD requested for release.
- The release packet states which previous model version is the rollback target and verifies runtime compatibility.
- The release packet includes the compatibility manifest when the model depends on a specific map, calibration package, runtime container, semantic taxonomy, prompt/labeler, telemetry schema, or replay package.
- The deployment decision references the relevant safety case claims and technical documentation record.

## Failure Modes

| Failure mode | Consequence | Control |
|---|---|---|
| Alias moved without evidence | Fleet runs a model that was not reviewed | Require signed release decision before alias mutation |
| Metric-only approval | Model improves averages while regressing rare safety cases | Gate on scenario replay and ODD slices |
| Dataset snapshot missing | Release cannot be reproduced or audited | Block release unless dataset IDs are immutable |
| Map-derived labels lack release-state evidence | Model learns transient or quarantined map points as permanent static classes | Require release-state masks, source-map acceptance, split IDs, and pseudo-label batch invalidation controls |
| Shadow evidence from a different ODD | Approval does not support target deployment | Tie evidence to airport, route, weather, and vehicle class |
| Runtime incompatibility | Model passes offline tests but fails on vehicle | Validate TensorRT/ONNX/runtime bundle before canary |
| Offline labeler changes without governance | Training labels or semantic maps shift while the deployed model appears unchanged | Version prompt sets, labeler models, thresholds, accepted/rejected statistics, and rollback impact |
| Rollback model not executable | Recovery depends on a manual hotfix | Keep `rollback` alias and compatible artifact bundle current |
| Approval expires silently | Old evidence is reused after data or ODD drift | Require evidence expiry and periodic revalidation |

## Related Repository Docs

- `40-runtime-systems/ml-deployment/production-ml-deployment.md`
- `40-runtime-systems/ml-deployment/av-cicd-devops-pipeline.md`
- `50-cloud-fleet/mlops/mlops-scale-research-scope.md`
- `50-cloud-fleet/mlops/mlops-reference-architectures-by-scale.md`
- `50-cloud-fleet/mlops/data-flywheel-airside.md`
- `30-autonomy-stack/perception/overview/3d-segmentation-training-paradigms.md`
- `30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md`
- `50-cloud-fleet/ota/software-update-management-system-ops.md`
- `60-safety-validation/safety-case/safety-case-evidence-traceability.md`
- `60-safety-validation/verification-validation/testing-validation-methodology.md`
- `60-safety-validation/standards-certification/eu-ai-act-machinery-compliance-dossier.md`

## Sources

- MLflow, "Model Registry Workflows." https://www.mlflow.org/docs/latest/ml/model-registry/workflow/
- ZOPP, "A Framework of Zero-shot Offboard Panoptic Perception for Autonomous Driving." https://arxiv.org/abs/2411.05311
- SALT, "A Flexible Semi-Automatic Labeling Tool for General LiDAR Point Clouds with Cross-Scene Adaptability and 4D Consistency." https://arxiv.org/abs/2503.23980
- OpenUrban3D, "Annotation-Free Open-Vocabulary Semantic Segmentation of Large-Scale Urban Point Clouds." https://arxiv.org/abs/2509.10842
- Google Cloud, "Prompt management." https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/prompt-classes
- Google Cloud, "Gen AI evaluation service overview." https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/evaluation-overview
- Microsoft Learn, "Advance your maturity level for GenAIOps." https://learn.microsoft.com/en-us/azure/machine-learning/prompt-flow/concept-llmops-maturity?view=azureml-api-2
- Waymo, "Safe to Deploy: How We Know The Waymo Driver Is Ready For The Road," 2025-06. https://waymo.com/blog/2025/06/safe-to-deploy/
- Waymo, "Building a credible case for safety: Waymo's approach for the determination of absence of unreasonable risk." https://waymo.com/research/building-a-credible-case-for-safety-waymos-appro/
- Regulation (EU) 2024/1689, Artificial Intelligence Act, Articles 10-12 and Annex IV. https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689
- ISO/IEC 5259-5:2025, "Artificial intelligence - Data quality for analytics and machine learning (ML) - Part 5: Data quality governance framework." https://www.iso.org/standard/84150.html
