# Feature and Embedding Store Operations by Scale

**Last updated:** 2026-05-24

Feature stores and embedding stores solve different problems that are often confused. A feature store gives models consistent, versioned access to engineered features across training and serving. An embedding store or vector index retrieves semantically similar clips, map tiles, documents, scenes, or labels. Both can become critical MLOps infrastructure, but both are easy to overbuild before the data contract is stable.

For autonomy, the default should be conservative: start with immutable manifests, snapshot-capable tables, and reproducible batch exports. Add an offline feature store when multiple models reuse the same derived features. Add an online feature store only when runtime inference needs fresh, low-latency features from a shared serving path. Add an embedding/vector store when scenario mining, active learning, foundation-model labeling, or operator search needs semantic retrieval over large sensor, map, or document corpora.

---

## Store Types

| Store type | Primary question | Good fit | Poor fit |
|---|---|---|---|
| Manifest-backed files | Can this dataset or training export be reproduced? | S0-S2 experiments, map-derived labels, frozen replay/eval packages | Shared low-latency serving or many teams reusing the same features |
| Offline feature store | Can many training jobs reuse point-in-time-correct features? | Reused tabular features, expensive LiDAR/map features, delayed-label joins | One-off experiments or raw point-cloud tensors |
| Online feature store | Can serving use the same feature definitions with freshness and latency guarantees? | Cloud services, dispatch/routing models, recommendation-style systems, fleet dashboards | Vehicle real-time perception where features are computed on the edge sensor stream |
| Embedding/vector store | Can users retrieve similar scenes, clips, map tiles, labels, or documents? | Scenario mining, active learning, semantic search, RAG, foundation-model label triage | Release truth without reviewer, lineage, and snapshot controls |
| Lakehouse/catalog table | Can large derived datasets be queried, versioned, and governed? | Training/eval tables, feature materialization outputs, lineage and retention | Low-latency serving without online materialization |

The feature-store decision is not "Feast or Tecton?" first. The first decision is whether the artifact is a reusable model input with a stable entity/time contract. The embedding-store decision is not "Milvus or pgvector?" first. The first decision is whether retrieval results can be reconstructed from a named corpus snapshot, embedding model, index build, filter policy, and access class. When retrieval feeds prompts, judge models, or tool-using agents, apply `llmops-agent-evaluation-by-scale.md` so retrieval traces, grounding checks, prompt-injection tests, and reviewer dispositions become part of the evidence.

---

## Scale Ladder

| MLOps scale | Feature stance | Embedding/vector stance | Required evidence |
|---|---|---|---|
| S0 notebook research | Avoid platform; write feature files next to the run manifest | Local FAISS/NumPy index for exploration only | Code commit, data pointer, split, feature script |
| S1 repeatable prototype | Offline cache or Parquet table with deterministic rebuild | Small search index for candidate mining, versioned with the dataset snapshot | Dataset snapshot, feature config, index config, validation script |
| S2 single-product production | Offline feature store only if multiple models reuse features | Product-owned vector index for scenario mining, label triage, or document retrieval | Point-in-time join proof, lineage, quality report, allowed-use state |
| S3 fleet and multi-site | Site/ODD-partitioned features, backfills, freshness checks, delayed-label joins | Site-aware clip/map/document index with dedupe, ACLs, and index recall checks | Catalog ID, site scope, retention tier, query/index version, drift monitoring |
| S4 regulated safety-critical | Immutable feature snapshots for release evaluation and evidence | Frozen retrieval corpora and embedding snapshots; retrieval is supporting evidence only | Safety-case claim link, deletion propagation, waiver expiry, audit lock |
| S5 platform scale | Multi-tenant feature platform with quotas, SLAs, policy, and cost allocation | Shared vector service with corpus registry, tenant isolation, freshness, recall, and provenance SLOs | Policy-as-code, owner, SLOs, access logs, tenant impact, audit API |

The key boundary is S2 to S3. At S2, feature and embedding stores are product tools. At S3, they become fleet learning infrastructure because multiple sites, ODD cells, label queues, replay suites, and release channels consume the same derived representations. At S4, they become evidence-bearing dependencies and must be frozen, not just refreshed.

---

## Autonomy Use Cases

| Use case | Store pattern | Notes |
|---|---|---|
| Aggregated-map semantic segmentation | Manifest-backed training exports plus optional offline features | Store source map, semantic layer, release state, calibration, projection code, tile IDs, and invalidation state before training consumes labels |
| LiDAR/map feature reuse | Offline feature store or lakehouse table | Useful for density, normals, planarity, intensity statistics, visibility, persistence, and map-hygiene features reused by several models |
| Scenario mining | Embedding/vector store plus rule filters | Index clips by trajectory, actors, map zone, weather, intervention, semantic labels, model disagreement, and text/image/LiDAR embeddings |
| Active learning | Feature table plus vector index | Combine uncertainty, diversity, site coverage, risk class, duplicate suppression, and label cost |
| Foundation-model label triage | Embedding/vector store with prompt/model manifests | Candidate labels need prompt, model, retrieval corpus, taxonomy, reviewer, and allowed-use state |
| Incident root-cause | Catalog lineage plus vector search | Retrieve similar incidents, active artifact sets, nearby map tiles, related scenarios, and known regressions |
| Runtime serving | Usually edge-computed features, rarely online store | Vehicle perception should not depend on network feature lookups for safety-critical real-time perception |
| Operations dashboards | Online or near-real-time features | Appropriate for fleet health, queueing, ETA, utilization, and post-hoc risk scoring |

For non-road urban districts, campuses, yards, ports, warehouses, mines, farms, and airside sites, embeddings should preserve site context. A "similar scene" query that ignores zone type can mix terminal frontage, utility corridor, apron stand, warehouse aisle, and public pedestrian plaza cases that have different operating rules.

---

## Contract Fields

### Feature Definition

| Field | Why it matters |
|---|---|
| Feature ID and version | Prevents silent reuse after logic changes |
| Entity keys | Defines what the feature describes: vehicle, session, point, tile, track, site, scenario, or map layer |
| Event time and created time | Enables point-in-time training joins and leakage checks |
| Source datasets | Links features to raw logs, labels, maps, calibration, telemetry schema, and preprocessing code |
| Transformation code and config | Makes materialization reproducible |
| Freshness and TTL | Defines whether stale features are invalid, acceptable, or evidence-locked |
| Offline/online parity test | Detects training-serving skew |
| Quality rules | Nulls, bounds, distributions, duplicate rate, slice coverage, and drift |
| Allowed use | Research, training, release eval, safety evidence, runtime, or restricted |
| Owner and consumer | Makes breakage and deprecation accountable |

### Embedding Index

| Field | Why it matters |
|---|---|
| Corpus snapshot | Fixes exactly which clips, tiles, labels, documents, or scenarios were indexed |
| Embedding model and checkpoint | Prevents mixed vector spaces |
| Preprocessing/chunking policy | Controls scene windows, document chunks, map tiles, frame sampling, and normalization |
| Vector dimension and metric | Cosine, dot product, L2, or inner-product semantics affect ranking |
| Index algorithm and parameters | HNSW, IVF, PQ, flat, filtering, recall/latency tradeoff |
| Metadata filters | Site, ODD, time, class, privacy, release state, tenant, and access class |
| Index build ID | Supports rollback, audit, and stale-index detection |
| Recall and latency checks | Verifies that approximate search is still fit for use |
| Deletion and retention state | Ensures privacy and customer/site offboarding propagate to vectors |
| Retrieval trace | Records query, filters, top-k IDs, scores, and downstream consumer |

Embedding results should never become release truth by themselves. They can retrieve candidates for review, replay, investigation, or labeling; the promoted artifact still needs controlled taxonomy, reviewer, QA, lineage, and allowed-use evidence.

---

## Architecture Patterns

### Pattern A: Manifest-Only Feature Files

Use for S0-S1 and narrow S2 tasks. A run writes Parquet/NPZ/Arrow files plus a manifest naming source logs, map tiles, calibration, feature code, split, and metrics.

Pros:
- Lowest operational burden.
- Easy to inspect and archive.
- Good enough for one team and one model family.

Cons:
- Weak discovery across teams.
- Manual invalidation and ownership.
- Hard to support many backfills or consumers.

### Pattern B: Offline Feature Store

Use when multiple training/evaluation jobs reuse derived features or delayed labels. Feast-style systems emphasize historical retrieval and point-in-time joins; commercial feature platforms add managed materialization, monitoring, and online/offline consistency.

Pros:
- Reduces duplicated feature engineering.
- Enforces feature definitions and historical joins.
- Supports dataset rebuilds and cross-model reuse.

Cons:
- Adds infrastructure and schema discipline.
- Poor fit for raw high-dimensional point clouds.
- Can hide leakage if event-time semantics are wrong.

### Pattern C: Online Feature Store

Use when a deployed service needs fresh shared features with bounded latency. This is common for web and fleet-service models, but uncommon for safety-critical vehicle perception because the edge model should compute from local sensor inputs and active maps.

Pros:
- Consistent serving features across models.
- Freshness and latency can be monitored centrally.
- Useful for operations, dispatch, routing, and cloud scoring.

Cons:
- Adds serving dependency and failure mode.
- Training-serving parity must be continuously tested.
- Network-dependent features are risky for closed-loop vehicle behavior.

### Pattern D: Embedding/Vector Search Service

Use for scenario mining, active learning, similar-incident retrieval, map-tile search, document RAG, and foundation-model label triage. The service may be a local FAISS index, pgvector, Milvus, or a managed vector database depending on scale.

Pros:
- Makes long-tail retrieval practical.
- Helps deduplicate and diversify labeling queues.
- Supports operator and reviewer search across multimodal corpora.

Cons:
- Approximate search can miss rare safety cases unless recall is tested.
- Ranking is sensitive to embedding model, filters, and chunking.
- Privacy deletion and corpus invalidation must propagate to the index.

---

## Training Architecture Comparison

| Architecture | Training input | Advantages | Disadvantages | Best scale |
|---|---|---|---|---|
| Direct raw-data training | Raw logs, point clouds, images, labels | Maximum fidelity; minimal derived-feature dependency | Expensive preprocessing; duplicated feature logic; weaker reuse | S0-S2 |
| Frozen feature table training | Offline feature snapshots plus labels | Reproducible, cheap to rerun, good for ablations | Can freeze stale preprocessing or leak future data | S1-S3 |
| Feature-store training | Point-in-time feature joins from a registry | Shared definitions, lineage, backfills, multi-model reuse | Requires strict event-time semantics and feature ownership | S2-S5 |
| Retrieval-augmented training set construction | Vector search selects similar/diverse clips, tiles, or documents | Improves long-tail mining and active learning | Retrieval bias and index drift can shape the dataset silently | S2-S5 |
| Foundation-model-assisted labeling | Prompt/model/retrieval outputs become candidate labels | Scales rare-class discovery and open-vocabulary triage | Needs reviewer, prompt registry, taxonomy mapping, and invalidation | S2-S5 |
| Online feature serving | Deployed model fetches live features | Useful for cloud/fleet models with shared context | Adds latency, freshness, and availability risk | S3-S5, rarely vehicle safety runtime |

For aggregated LiDAR maps, feature-store training is most useful for metadata and derived geometric summaries, not for replacing raw point tensors. The segmentation model still needs point/voxel/range/image tensors; the store helps govern reusable side features, map-tile descriptors, release-state masks, label eligibility, and retrieval-based data selection.

---

## Invalidation and Backfill Rules

Feature and embedding artifacts inherit upstream corrections. The following changes should move affected derived artifacts to `suspect` until impact is resolved:

| Trigger | Affected artifacts | Required action |
|---|---|---|
| Source log decode or telemetry schema fix | Features, training tables, scenario records | Rebuild affected materializations or document waiver |
| Calibration or pose correction | Point/image features, map-tile embeddings, projected labels | Recompute projections and invalidate stale joins |
| Source map or semantic layer update | Map features, pseudo-labels, map-tile embeddings, replay expected labels | Follow `map-derived-pseudo-label-invalidation-protocol.md` |
| Taxonomy or release-state change | Labels, class features, scenario assertions, evaluator filters | Rebuild mappings and block incompatible training/eval |
| Embedding model change | Vector index, retrieval traces, dedupe clusters | Rebuild index; do not compare scores across vector spaces |
| Corpus deletion or privacy restriction | Stored vectors, cached features, traces, derived datasets | Delete or restrict downstream copies and record propagation |
| Online/offline parity failure | Served features and training features | Freeze deployment path until skew is explained |

Backfills need the same release discipline as model retraining. A silent feature backfill can change labels, training distribution, replay selection, or safety evidence without a model-code change.

---

## Monitoring

| Metric | S0-S1 | S2-S3 | S4-S5 |
|---|---|---|---|
| Feature freshness | Manual note if relevant | Scheduled freshness/TTL dashboard | Release blocker for evidence-bearing features |
| Point-in-time leakage | Fixed split review | Automated join tests | Audit evidence and waiver workflow |
| Feature quality | Sample plots | Null/bounds/drift by site and ODD | Quality SLO, owner escalation, evidence lock |
| Online/offline skew | Not applicable | Parity test before deployment | Continuous parity with incident linkage |
| Vector index recall | Manual spot check | Golden-query recall and latency | SLO, stale-index alert, audit trace |
| Retrieval quality | Reviewer feedback | Precision/yield by query type and slice | Safety-case relevance and missed-case review |
| Deletion propagation | Manual cleanup | Catalog-driven invalidation | Policy-enforced purge/restriction proof |
| Cost | Per-run note | Cost per feature, query, label, and replay hour | Tenant quotas, chargeback, platform SLO |

The scorecard should treat store health as a release dependency when the store influences training, evaluation, replay, or safety evidence. It is only an observability metric when it supports exploratory search.

---

## Failure Modes

| Failure mode | Consequence | Control |
|---|---|---|
| Feature store before stable label contract | Infrastructure stores the wrong semantics consistently | Require data contract and owner before promotion |
| Event-time semantics wrong | Training sees future information | Point-in-time join tests and created-time auditing |
| Offline and online logic diverge | Model passes offline but fails in serving | Single feature definition plus parity checks |
| Embedding index rebuilt silently | Scenario mining and RAG results cannot be reproduced | Index build IDs, corpus snapshots, retrieval traces |
| Vector search ignores site/ODD filters | Similarity search returns operationally irrelevant cases | Mandatory metadata filters and slice-aware evaluation |
| Deletion does not reach vectors | Privacy or customer offboarding violation | Catalog-driven deletion propagation |
| Approximate search misses rare hazard | Safety scenario is not mined | Golden-query recall tests and rule-based safety queries |
| Feature backfill bypasses release review | Model/eval evidence changes under same name | Backfill approval, versioned materialization, downstream impact query |
| Online feature lookup added to vehicle control path | Network or freshness failure affects safety behavior | Keep vehicle-critical perception local unless a safety case explicitly accepts the dependency |

---

## Related Pages

- `mlops-scale-research-scope.md` - MLOps scale ladder and build order.
- `mlops-reference-architectures-by-scale.md` - architecture boundaries and durable interfaces.
- `mlops-scorecards-and-kpis-by-scale.md` - MLOps KPIs and release blockers.
- `map-derived-pseudo-label-invalidation-protocol.md` - invalidation state machine for map-derived labels.
- `model-governance-release-evidence.md` - release packet and registry evidence.
- `llmops-agent-evaluation-by-scale.md` - RAG, prompt, judge, and agent evaluation controls for retrieval-backed workflows.
- `../data-platform/data-catalog-lineage-quality-ops.md` - catalog, lineage, quality, and data-product states.
- `../data-platform/replay-scenario-mining-ops.md` - scenario mining and replay package governance.
- `data-flywheel-airside.md` - active learning and closed-loop data mining.
- `../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md` - semantic-map training exports and release-state labels.

## Sources

- Feast, "Offline stores overview." https://docs.feast.dev/reference/offline-stores/overview
- Feast, "Introduction." https://docs.feast.dev/
- Tecton, "Introduction." https://docs.tecton.ai/docs/introduction
- Tecton, "Concepts." https://docs.tecton.ai/docs/0.9/introduction/tecton-concepts
- OpenLineage, "About OpenLineage." https://openlineage.io/docs/
- Apache Iceberg, "Introduction." https://iceberg.apache.org/docs/latest/
- Apache Iceberg, "Spec." https://iceberg.apache.org/spec/
- MLflow, "Model Registry Workflows." https://www.mlflow.org/docs/latest/ml/model-registry/workflow/
- Milvus, "What is Milvus." https://milvus.io/docs/overview.md
- Milvus, "Basic vector search." https://milvus.io/docs/single-vector-search.md
- pgvector README. https://github.com/pgvector/pgvector
- Meta Engineering, "Faiss: A library for efficient similarity search." https://engineering.fb.com/2017/03/29/data-infrastructure/faiss-a-library-for-efficient-similarity-search/
