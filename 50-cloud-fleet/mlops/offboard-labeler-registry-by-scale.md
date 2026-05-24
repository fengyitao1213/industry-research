# Offboard Labeler Registry by Scale

**Last updated:** 2026-05-24

Offboard labelers are models, prompts, rules, tools, and human workflows that create labels outside the runtime vehicle stack. They include classical auto-labelers, heavy offline 3D detectors, foundation-model segmenters, VLM scene reviewers, LLM QA assistants, open-vocabulary point-cloud labelers, retrieval-augmented label search, and model-as-judge evaluators. They may never control a vehicle directly, but they can still change training data, semantic maps, replay assertions, safety reports, and release evidence.

The registry rule is simple: **if a labeler output can enter training, replay, evaluation, a signed map, a taxonomy, or a safety case, the labeler is a release-affecting artifact.** It needs identity, scope, evaluation, rollback, owner, allowed-use controls, the digest-bound trust-chain evidence defined in `secure-artifact-attestation-profile.md`, and the GenAI/agent evaluation controls in `llmops-agent-evaluation-by-scale.md` when prompts, RAG, judges, or tool calls are involved.

---

## What Counts as an Offboard Labeler

| Labeler type | Examples | Why registry matters |
|---|---|---|
| Heavy offline detector/segmenter | Multi-frame 3D detector, accumulated-cloud segmenter, Waymo 3DAL-style auto-labeler | Can produce large volumes of training truth faster than humans can inspect |
| Promptable image/point labeler | SAM/SAM2, Grounding-DINO, CLIP, DINOv2, SAM4D, SALT-style tools | Prompt/model changes can shift masks and names without code changes |
| Open-vocabulary 3D labeler | ZOPP, OpenUrban3D, VESPA, UniLiPs, LOSC-style consolidation | Useful for unknown classes but risky if text names become taxonomy IDs |
| Map-derived label exporter | Semantic map back-projection to single scans | Inherits source map, pose graph, calibration, release-state, and reviewer state |
| Weak labeling rule | Intensity threshold, map overlay, heuristic FOD candidate, ground marking extractor | Looks deterministic but still needs versioning and QA |
| LLM/VLM reviewer | Scene captioner, incident summarizer, taxonomy suggestion assistant | Generated explanations can steer humans and safety evidence |
| Evaluator/judge model | Model-as-judge, VLM replay reviewer, prompt scorer | Should route review, not replace release approval |
| Retrieval-augmented label assistant | Vector search over clips, maps, SOPs, prior labels, incidents | Corpus/index drift changes retrieved evidence |

Treat the labeler as a system, not just a checkpoint. The system includes prompts, thresholds, retrieval corpora, calibration/projection code, input filters, taxonomy mappings, reviewer UI, acceptance policy, and export code.

---

## Scale Ladder

| MLOps scale | Registry posture | Required control | Main risk |
|---|---|---|---|
| S0 notebook research | Run note and prompt text | Record model name, date, input sample, and output examples | Interesting labels cannot be reproduced |
| S1 repeatable prototype | Versioned labeler config | Frozen eval set, deterministic decoding when possible, reviewer notes | Prototype labels become hidden baseline truth |
| S2 single-product production | Product labeler registry | Immutable labeler version, prompt pack, thresholds, QA report, allowed-use state | Training data shifts while deployed model appears unchanged |
| S3 fleet and multi-site | Site/ODD-aware labeler registry | Local prompt variants, site holdouts, reviewer correction by slice, rollback bundle | One global prompt or labeler fails local terminology or objects |
| S4 regulated safety-critical | Evidence-locked labeler records | Safety-slice eval, expert review, retention hold, waiver/expiry, incident trace | Auto-labeler silently creates unsafe safety evidence |
| S5 platform scale | Multi-tenant labeler/prompt/evaluator platform | Policy-as-code, tenant isolation, audit API, cost and quality SLOs | Teams reuse unapproved labelers across unrelated products |

The critical transition is S2. Once an offboard labeler output can change a model, map, replay assertion, or release packet, it must be governed even if the labeler itself is offline-only.

---

## Registry Record

| Field | Minimum contents |
|---|---|
| `labeler_id` | Stable name, version, owner, intended task |
| `labeler_type` | Detector, segmenter, prompt pack, rule, map exporter, LLM/VLM, evaluator, human workflow |
| `model_artifacts` | Checkpoint, provider/API model ID, container, dependency lock, hardware class |
| `attestation_refs` | Subject digests, signatures, provenance, SBOM where relevant, policy result, trusted-builder or provider identity |
| `prompt_pack` | System instructions, user templates, variables, examples, local terminology, prompt owner |
| `retrieval_context` | Corpus snapshot, embedding model, index build, filters, citation/trace policy |
| `input_contract` | Sensor streams, map tiles, calibration, source-map state, image coverage, data-quality gates |
| `taxonomy_contract` | Controlled taxonomy version, candidate class aliases, unknown policy, class order |
| `thresholds` | Confidence gates, abstention policy, class-specific acceptance/review/discard thresholds |
| `projection_contract` | Camera-LiDAR projection, pose source, time sync, occlusion policy, map back-projection code |
| `evaluation_set` | Gold set, local holdouts, rare-class slices, map-state slices, reviewer disagreement sample |
| `output_states` | Candidate, pre-label, review label, QA passed, training approved, safety evidence approved |
| `allowed_use` | Research only, pre-annotation, training, replay, release eval, map publication, safety evidence |
| `rollback` | Previous labeler/prompt/threshold bundle and affected downstream datasets |
| `expiry` | Evidence expiry, revalidation triggers, waiver owner |

For API-hosted foundation models, a version string is not enough. The record should include provider, model ID, hosted region, data-retention setting, prompt pack, safety settings, decoding parameters, and evaluation date.

---

## Labeler State Machine

| State | Meaning | Allowed output |
|---|---|---|
| `experimental` | Research-only labeler or prompt | Local candidate examples |
| `candidate_registry` | Reproducible config exists but eval is incomplete | Candidate pre-labels only |
| `qa_approved` | Eval set and reviewer QA passed for a bounded scope | Pre-labels and review acceleration |
| `training_approved` | Output may enter a named training snapshot after QA | `approved_for_training` labels |
| `release_eval_approved` | Output may support replay/eval assertions under frozen evidence | Release-eval labels, not safety approval |
| `safety_evidence_approved` | Expert-reviewed and evidence-locked for safety claims | Safety evidence labels within scope |
| `restricted` | Usable only with named exclusions or mitigations | Bounded use with waiver/expiry |
| `quarantined` | Regression, incident, prompt/model drift, or data restriction found | No new downstream consumption |
| `deprecated` | Replaced or retired | Historical reconstruction only |

Labeler approval is scoped. A prompt pack approved for "baggage tractor" candidates at one airport is not automatically approved for aircraft proximity, FOD, personnel, terminal frontage, or another country's site terminology.

---

## Output State Contract

| Output state | Meaning | Downstream use |
|---|---|---|
| `candidate_label` | Machine suggested a region, class, caption, or assertion | Review queue, active learning, search |
| `pre_labeled` | Candidate was imported into an annotation tool | Reviewer acceleration only |
| `review_label` | Human reviewer accepted, corrected, or rejected the candidate | QA sampling and adjudication |
| `qa_passed` | QA policy passed for the label batch | Training candidate if allowed-use permits |
| `approved_for_training` | Data steward approved for a training snapshot | Model training and ablation |
| `approved_for_release_eval` | Frozen for evaluation or replay | Release metrics only |
| `approved_for_safety_evidence` | Evidence owner approved and retention locked | Safety-case support within scope |
| `rejected` | Candidate was wrong or unsupported | Error analysis and labeler improvement |
| `unknown_review` | Candidate cannot be mapped safely | Unknown-region evidence or taxonomy backlog |

The registry should make illegal state transitions impossible. `candidate_label -> approved_for_safety_evidence` should be blocked unless the workflow records reviewer, QA, allowed-use, evidence owner, and retention state.

---

## Evaluation Gates

| Gate | What to measure | Scale where it becomes blocking |
|---|---|---|
| Reproducibility | Same inputs produce same candidate set under recorded config | S1 |
| Gold-set quality | Precision/recall/IoU, reviewer correction, class confusion | S2 |
| Slice quality | Site, zone, weather, map state, rare classes, personnel, FOD | S3 |
| Prompt stability | Small prompt/model/corpus changes do not flip critical outputs unexpectedly | S2-S3 |
| Projection quality | Camera-LiDAR/time/pose errors do not put labels on wrong points | S2 |
| Taxonomy compatibility | Candidate names map to controlled classes or explicit `unknown` | S2 |
| Reviewer workload | Candidate improves throughput without raising defect rate | S2 |
| Safety slice false acceptance | Hazard labels are not falsely promoted | S4 |
| Retrieval trace quality | Sources and top-k evidence can be reconstructed | S3-S5 |
| Downstream impact | Models trained on the labels improve target slices without leakage | S2-S5 |

Do not let "human in the loop" hide weak labeler evidence. The reviewer workflow is part of the labeler system and needs its own defect taxonomy, sampling plan, disagreement rate, and correction analytics.

---

## Architecture Comparison

| Labeling architecture | Advantages | Disadvantages | Best use |
|---|---|---|---|
| Manual labels only | Highest trust for small safety-critical batches | Slow, expensive, weak coverage | S0-S2 baselines, S4 hazard evidence |
| Closed-set offline auto-labeler | High precision on known classes, easy metrics | Misses novel objects and local terminology | Common vehicles, aircraft, people, GSE, routine labels |
| Promptable 2D labeler lifted to 3D | Fast rare-object discovery, image foundation-model leverage | Calibration/projection-sensitive, lighting-sensitive | Candidate masks and reviewer acceleration |
| Open-vocabulary 3D labeler | Finds unknown concepts in point clouds | Naming instability, taxonomy risk, uneven calibration | Taxonomy discovery and local benchmark bootstrapping |
| Map-derived pseudo-label exporter | Massive label multiplication from one reviewed map | Source-map and release-state errors contaminate training | Aggregated-map flywheel after map acceptance |
| LLM/VLM scene reviewer | Good for triage, captions, and taxonomy suggestions | Can hallucinate, over-explain, or miss geometry | Review routing and incident summarization |
| Model-as-judge evaluator | Scales qualitative checks | Bias and drift; not approval authority | Routing review, comparing candidate outputs |

The production pattern is layered: machine candidates reduce work, human review decides taxonomy and correctness, QA decides batch quality, data stewardship decides allowed use, and release governance decides whether a downstream model or map can consume the batch.

---

## Semantic Map and Non-Road Rules

Aggregated-map and non-road managed-site labelers need stricter controls than generic image annotation:

- Preserve semantic class and release state separately. A correctly named parked GSE unit, cone, worker, pallet, hose, or FOD candidate may still be wrong as permanent map truth.
- Store source-map acceptance ID, map tile IDs, pose/back-projection code, calibration package, and hygiene layer digest for every map-derived batch.
- Keep local terminology in prompt packs: stand, apron, tug, belt loader, ULD, terminal frontage, quay edge, warehouse aisle, mine bench, utility cabinet, campus crossing.
- Require site/ODD slices for reviewer correction rates. A prompt that works on apron scenes can fail on terminal-frontage crowds or utility corridors.
- Route new names through taxonomy promotion, not direct class creation.
- Treat stationary people and staged movable assets as high-risk false-permanent examples.
- Link labeler updates to `map-derived-pseudo-label-invalidation-protocol.md` when source-map, prompt, model, reviewer, taxonomy, projection, or release-state artifacts change.

For safety-critical labels, a useful auto-labeler is one that reduces reviewer burden while preserving auditability. It is not a replacement for release authority.

---

## Monitoring and Scorecards

| Metric | S0-S1 | S2-S3 | S4-S5 |
|---|---|---|---|
| Candidate yield | Useful examples per run | Accepted/rejected/reworked by class and site | Evidence-bearing accepted yield by hazard slice |
| Reviewer correction | Manual note | Correction rate by labeler version, prompt pack, site, ODD | Expert disagreement, false acceptance, adjudication aging |
| Prompt/model drift | Manual rerun | Regression suite by prompt/model/corpus version | Release blocker and audit trace |
| Taxonomy actions | Notes | New alias, parent, split/merge, unknown backlog | Safety-impacting taxonomy review |
| Projection defects | Visual spot check | Calibration/projection error samples | Safety-slice projection audit |
| Allowed-use violations | Not tracked | Blocked by workflow states | Policy-as-code and incident report |
| Cost | Per batch | Cost per accepted label and reviewer hour saved | Cost per evidence pack and platform tenant |

Labeler scorecards should be reviewed before training data freezes, map publication, release evaluation, and any safety-case evidence update.

---

## Failure Modes

| Failure mode | Consequence | Control |
|---|---|---|
| Prompt text becomes class ID | Taxonomy drifts and backward compatibility breaks | Taxonomy promotion record and controlled class mapping |
| Provider model updates silently | Labels change under the same prompt | Provider/model ID, eval date, regression pack, rollback bundle |
| Threshold changed without review | Training distribution shifts invisibly | Threshold version, acceptance report, downstream impact query |
| Reviewer accepts machine bias | Systematic false labels pass QA | Risk-weighted QA and independent adjudication |
| Open-vocabulary candidates treated as truth | Unknown objects become unsafe map classes | Candidate-only state and reviewer taxonomy decision |
| Projection error lifts image labels to wrong points | 3D training labels are corrupted | Calibration/projection QA and rejected-projection logging |
| Labeler improves average yield but harms hazard slices | More labels, worse safety evidence | Hazard-slice blockers and expert review |
| Retrieval corpus drift changes evidence | RAG-assisted label decisions cannot be reconstructed | Corpus/index snapshot and retrieval trace |
| Labeler rollback ignored | Bad labels remain in datasets after rollback | Impact graph across datasets, maps, replay, and models |

---

## Related Pages

- `mlops-scale-research-scope.md` - MLOps maturity ladder and prompt/foundation-model operations scope.
- `model-governance-release-evidence.md` - release packet evidence for offboard labelers and prompt packs.
- `map-derived-pseudo-label-invalidation-protocol.md` - invalidation for map-derived training exports.
- `feature-embedding-store-ops-by-scale.md` - retrieval corpus and vector-index controls.
- `secure-artifact-attestation-profile.md` - signatures, SBOM/provenance, and policy verification for release-affecting labeler artifacts.
- `llmops-agent-evaluation-by-scale.md` - prompt, RAG, judge, tool-agent, trace, and GenAI eval controls.
- `data-flywheel-airside.md` - auto-labeling pipeline, quality gate, and closed-loop training.
- `../data-platform/active-labeling-budget-ops.md` - label-budget states and promotion boundaries.
- `../data-platform/3d-annotation-tools.md` - annotation tooling, pre-labels, and reviewer workflows.
- `../data-platform/data-catalog-lineage-quality-ops.md` - data product promotion and lineage.
- `../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md` - offboard semantic-map candidate lane.
- `../../30-autonomy-stack/perception/methods/losc.md` - LiDAR open-vocabulary segmentation consolidation.

## Sources

- Google Cloud, "Prompt management." https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/prompt-classes
- Google Cloud, "Optimize prompts." https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/prompts/prompt-optimizer
- Microsoft Learn, "Advance your maturity level for GenAIOps." https://learn.microsoft.com/en-us/azure/machine-learning/prompt-flow/concept-llmops-maturity?view=azureml-api-2
- AWS Machine Learning Blog, "FMOps/LLMOps: Operationalize generative AI and differences with MLOps." https://aws.amazon.com/blogs/machine-learning/fmops-llmops-operationalize-generative-ai-and-differences-with-mlops/
- NIST, "Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile." https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf
- Label Studio, "Import pre-annotated data into Label Studio." https://labelstud.io/guide/predictions
- Label Studio, "Integrate Label Studio into your machine learning pipeline." https://labelstud.io/guide/ml.html
- ASAM OpenLABEL. https://www.asam.net/standards/detail/openlabel/
- ZOPP, "A Framework of Zero-shot Offboard Panoptic Perception for Autonomous Driving." https://arxiv.org/abs/2411.05311
- SALT, "A Flexible Semi-Automatic Labeling Tool for General LiDAR Point Clouds with Cross-Scene Adaptability and 4D Consistency." https://arxiv.org/abs/2503.23980
- OpenUrban3D, "Annotation-Free Open-Vocabulary Semantic Segmentation of Large-Scale Urban Point Clouds." https://arxiv.org/abs/2509.10842
