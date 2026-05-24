# LLMOps and Agent Evaluation by Scale

**Last updated:** 2026-05-24

This page defines MLOps controls for LLM, VLM, VLA, RAG, model-as-judge, and tool-using agent systems in autonomous vehicle and managed-site operations. These systems may be advisory, offline, or back-office, but they can still affect labels, semantic maps, incident reports, operator guidance, evaluation decisions, safety-case prose, and release packets.

The operating rule is conservative: **a generative model may propose, summarize, retrieve, rank, or route review, but it does not become release truth unless the downstream artifact passes the normal data, model, map, runtime, and safety gates.**

---

## Artifact Scope

| Artifact | Why it matters | Required identity |
|---|---|---|
| Prompt pack | Prompts change behavior like code | Prompt digest, owner, task, variables, examples |
| Model endpoint/checkpoint | Provider/model updates change outputs | Provider, model ID, checkpoint/API version, region, retention mode |
| Decoding and safety config | Temperature, top-p, filters, and abstention alter stability | Config digest and allowed-use scope |
| Retrieval corpus | RAG answers depend on indexed content | Corpus snapshot, embedding model, index build, access tier |
| Tool policy | Agents can read, write, or mutate systems | Tool allowlist, permission scope, approval gate |
| Agent graph | Planner/router/tool sequence changes outcomes | Graph version, state schema, memory policy |
| Evaluator/judge model | Judges can approve or reject candidates | Judge prompt/model/calibration set |
| Evaluation pack | Metrics define what "good" means | Golden set, rubrics, thresholds, slices |
| Trace schema | Debugging and audit require full path | Input/output digest, retrieved docs, tool calls, reviewer disposition |
| Guardrail policy | Blocks unsafe, private, or unsupported actions | Policy version, test set, exception owner |

Treat any of these as release-affecting once output can influence training data, map publication, replay assertions, safety evidence, operations decisions, or deployment approval.

---

## Scale Policy

| MLOps scale | LLMOps posture | Required evidence | What to block |
|---|---|---|---|
| S0 notebook research | Local prompt experiments and manual review | Prompt text, model name, sample inputs/outputs, limitations | Reusing generated outputs as labels or evidence |
| S1 repeatable prototype | Versioned prompt/eval notebook | Frozen eval set, prompt digest, model/config record, failure examples | Demo prompt becoming hidden production workflow |
| S2 single-product production | Prompt/model/retrieval registry and release packet | Eval pack, trace capture, reviewer workflow, rollback prompt/model | Prompt/model update changing labels, reports, or tools without review |
| S3 fleet and multi-site | Site/ODD-aware prompt, retrieval, and evaluation slices | Local terminology tests, site holdouts, corpus snapshots, canary traces | One global prompt or corpus applied to every site |
| S4 regulated safety-critical | Evidence-locked generative outputs and human approval | Safety-case links, red-team/prompt-injection tests, abstention rules, immutable traces | Generated prose or judge score replacing accountable approval |
| S5 platform scale | Multi-tenant GenAIOps platform | Registry, eval service, policy-as-code, telemetry, cost/SLOs, tenant isolation | Teams using ungoverned agents, prompts, tools, or retrieval corpora |

The most important transition is S2. Once a prompt, RAG system, VLM labeler, judge, or agent can affect a product artifact, it needs the same candidate/shadow/champion/rollback discipline as other MLOps artifacts.

---

## Autonomy Use Cases

| Use case | Allowed role | Release boundary |
|---|---|---|
| Open-vocabulary auto-labeling | Candidate labels, taxonomy suggestions, reviewer acceleration | Labels need reviewer, taxonomy, QA, allowed-use, and provenance |
| Semantic-map tile review | Candidate class names, anomaly flags, uncertainty triage | Published map needs source-map acceptance and map QA |
| Incident summarization | Draft timeline, evidence links, suspected factors | Incident record needs human owner and source-linked evidence |
| SOP/NOTAM/RAG assistant | Retrieve and summarize operational rules | Active operations need cited, current, approved documents |
| Model-as-judge evaluation | Route review and compare candidates | Judge score cannot replace release approval in S4 contexts |
| Agentic data mining | Query fleet data, create candidate batches, open tickets | Writes need scoped tools, dry-run mode, and human approval |
| VLM scene co-pilot | Advisory scene description and risk cue | Vehicle control remains behind deterministic runtime assurance |
| VLA action proposal | Candidate trajectory or task plan for simulation/review | Runtime action requires planner, monitor, and safety gate |

For managed-site autonomy, generative systems are most useful as offboard accelerators and reviewer aids. Direct control authority should remain outside the generative layer unless a separate safety architecture proves bounded behavior.

---

## Architecture Comparison

| Pattern | Advantages | Disadvantages | Best fit |
|---|---|---|---|
| Prompt registry only | Simple, low overhead, enough for prototypes | Weak eval and trace controls | S1 prototypes |
| Prompt plus eval pack | Enables regression testing and prompt comparison | Does not control retrieval/tool drift | S2 production prompts |
| RAG with frozen corpus snapshots | Grounded answers and reproducible retrieval | Corpus/index invalidation burden | SOP, NOTAM, incident, map-doc assistants |
| VLM labeler with human review | Speeds rare-class and open-vocab discovery | Projection, prompt, and taxonomy risk | Candidate labels and map-tile triage |
| Model-as-judge | Scales qualitative comparison | Bias, drift, and circular evaluation | Review routing, not safety approval |
| Tool-using agent | Automates multi-step workflows | Write actions, prompt injection, hidden state, cost runaway | Ticket creation, batch mining, report drafts |
| Agent platform service | Shared governance and telemetry | Platform bypass risk if too slow | S5 multi-team GenAIOps |

Prefer the smallest pattern that preserves evidence. A RAG assistant does not need an agent planner if retrieval plus a cited answer is enough. A tool-using agent should start in dry-run mode until traces prove it behaves within scope.

---

## Evaluation Layers

| Layer | What to test | Autonomy example |
|---|---|---|
| Task correctness | Output matches task-specific ground truth | Correctly classify pushback tug, FOD, stand closure, worker, or construction barrier |
| Grounding and citation | Claims are supported by source evidence | NOTAM answer cites the active closure and route segment |
| Spatial consistency | Text agrees with metric geometry and tracks | "Loader is clear of aircraft" matches 3D clearance |
| Retrieval quality | Right documents/clips/tiles are retrieved | Similar incident search returns the relevant site and map state |
| Tool correctness | Tool calls use correct inputs and permissions | Agent opens a candidate-label ticket without mutating release labels |
| Prompt-injection resistance | Malicious or irrelevant context does not override policy | Retrieved document cannot make the assistant approve a release |
| Abstention and uncertainty | Model refuses or routes review when evidence is weak | Low-quality night image becomes `unknown_review` |
| Robustness | Sensor, text, document, and context corruptions | Prompt typo, stale SOP, occluded worker, rain/fog image |
| Regression | Prompt/model/corpus update does not break slices | New prompt improves apron scenes but not terminal frontage |
| Human review load | Reviewer correction and disagreement | Auto-labeler saves time without raising false acceptance |
| Cost and latency | Token, tool, retrieval, and runtime cost | Agent mining job does not starve release replay |

Public benchmark scores are not sufficient. Every production GenAI artifact needs a task-specific eval pack and site/ODD slices that reflect the actual operating context.

---

## Agent Evaluation Contract

Agent evaluation must inspect the trajectory, not only the final answer.

| Field | Required evidence |
|---|---|
| Task ID | Scenario, ticket, label batch, map tile, incident, or operator request |
| Input digest | User prompt, image/clip/map/document IDs, context window |
| Planning trace | Steps proposed, tools selected, branch/loop decisions |
| Tool calls | Tool name, arguments, return value digest, permission result, error handling |
| Retrieval trace | Query, filters, top-k IDs, score, corpus/index version |
| Memory state | What short/long-term memory was read or written |
| Output | Final text, structured JSON, labels, tickets, or proposed action |
| Reviewer disposition | Accepted, corrected, rejected, escalated, waived |
| Policy result | Guardrail decisions, blocked actions, exceptions, expiry |
| Cost/latency | Tokens, tool time, retries, timeout, rate-limit behavior |

For safety-relevant or release-affecting tasks, the agent should not have direct write permission to labels, semantic maps, registry aliases, deployment manifests, safety-case records, or incident closure. It can create candidate artifacts that a governed workflow reviews.

---

## Release Gates

| Gate | Pass condition | Blocks |
|---|---|---|
| G0 inventory | Prompt/model/retrieval/tool/eval artifacts have IDs and owners | Unknown prompt or model endpoint |
| G1 reproducibility | Same inputs, model/config, corpus, and tools can reconstruct trace | Missing prompt/corpus/tool version |
| G2 task eval | Eval pack passes aggregate and slice thresholds | Poor grounding, wrong labels, unsupported summaries |
| G3 security eval | Prompt injection, tool misuse, data exfiltration, and unsafe output tests pass | OWASP LLM risk unresolved |
| G4 human review | Reviewer correction rate and disagreement are within bounds | Model overloads reviewers or creates false confidence |
| G5 compatibility | Downstream taxonomy, map, data, runtime, or release packet accepts artifact state | Candidate output used as release truth |
| G6 rollout | Shadow/canary traces show expected behavior under real workflow | Site-specific prompt/corpus regression |
| G7 closure | Active prompt/model/corpus/tool IDs are monitored and rollback exists | No rollback prompt/model/corpus bundle |

At S4, the release gate must explicitly say which generated outputs are evidence, which are supporting context, and which are merely drafts.

---

## Observability and Telemetry

GenAI telemetry should be structured enough for debugging, cost control, and audit:

| Signal | Examples |
|---|---|
| Trace spans | Model call, retrieval call, tool call, planner step, evaluator step |
| Metrics | Latency, tokens, cost, tool error rate, refusal rate, unsupported-claim rate |
| Logs/events | Prompt/model IDs, corpus/index version, policy result, reviewer correction |
| Safety counters | Prompt-injection hits, blocked tool calls, private-data suppression, hallucination reports |
| Release linkage | Artifact IDs, release packet, ODD/site scope, rollback bundle |

OpenTelemetry GenAI semantic conventions are still evolving, so record the convention version emitted by instrumentation. Do not depend on free-text chat logs as the system of record for release evidence.

---

## Airside and Non-Road Managed-Site Rules

- Site terminology belongs in versioned prompt packs and retrieval corpora: stand, apron, tug, ULD, belt loader, quay, aisle, bay, mine bench, utility cabinet, terminal frontage.
- VLM labels over images or maps should enter `candidate_label` or `unknown_review`, not `release_label`.
- RAG assistants must cite active documents and show corpus freshness; stale SOP, NOTAM, work-order, or map-overlay data can be worse than no answer.
- Agent tools that open tickets, label tasks, or map hygiene reviews should write only candidate records until human approval.
- Generated incident reports must preserve evidence IDs, raw clips, timestamps, active artifact IDs, and reviewer decisions.
- A VLA action proposal is a simulation or advisory artifact unless deterministic planning, runtime monitoring, and safety-case evidence accept it.

---

## Failure Modes

| Failure mode | Consequence | Control |
|---|---|---|
| Prompt update without eval | Labels, reports, or advice drift silently | Prompt registry and eval pack |
| RAG corpus changes invisibly | Answers cannot be reproduced | Corpus/index snapshot and retrieval trace |
| Judge model approves its own family | Inflated eval scores | Human calibration set and judge/model separation |
| Agent writes to production systems | Bad labels, tickets, maps, or releases propagate | Tool scopes, dry-run, human approval |
| Prompt injection through retrieved docs | Tool misuse or false approval | Retrieval sanitization, policy checks, injection tests |
| Missing abstention | Model fabricates on weak evidence | Unknown/review states and abstention thresholds |
| Trace gaps | Incident cannot be reconstructed | Structured trace schema and retention |
| Site terminology mismatch | Wrong object or rule interpretation | Site-specific prompt and eval slices |
| Cost runaway | Agent loops or starves GPU/eval capacity | Token/tool budgets, timeouts, queue policy |
| Generated prose becomes evidence | Safety case rests on unsupported claims | Source-linked evidence and human sign-off |

---

## Related Pages

- `mlops-scale-research-scope.md` - MLOps scale ladder and foundation-model operations.
- `offboard-labeler-registry-by-scale.md` - labeler, prompt, evaluator, retrieval, and reviewer workflow registry.
- `feature-embedding-store-ops-by-scale.md` - retrieval corpus and vector-index controls.
- `secure-artifact-attestation-profile.md` - prompt/eval/tool artifact signing and provenance.
- `model-governance-release-evidence.md` - release packets and rollback evidence.
- `data-flywheel-airside.md` - auto-labeling, active learning, and scenario mining.
- `../../30-autonomy-stack/vla-vlm/vlm-scene-understanding.md` - VLM scene-understanding use cases and reliability notes.
- `../../30-autonomy-stack/vla-vlm/vlm-vla-reliability-benchmarks.md` - VLM/VLA benchmark design.

## Sources

- Google Cloud, "Gen AI evaluation service overview." https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/evaluation-overview
- Google Cloud, "Gen AI evaluation service API." https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/evaluation
- Microsoft Learn, "Advance your maturity level for GenAIOps." https://learn.microsoft.com/en-us/azure/machine-learning/prompt-flow/concept-llmops-maturity?view=azureml-api-2
- MLflow, "Evaluating LLMs/Agents with MLflow." https://www.mlflow.org/docs/latest/genai/eval-monitor
- MLflow, "Evaluating Prompts." https://www.mlflow.org/docs/3.3.0/genai/eval-monitor/running-evaluation/prompts/
- OpenTelemetry, "Semantic conventions for generative AI systems." https://opentelemetry.io/docs/specs/semconv/gen-ai/
- NIST AI Risk Management Framework. https://www.nist.gov/itl/ai-risk-management-framework
- NIST AI 600-1, "Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile." https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf
- OWASP Top 10 for Large Language Model Applications. https://owasp.org/www-project-top-10-for-large-language-model-applications/
