# Data Catalog, Lineage, and Quality Operations

**Last updated:** 2026-05-24

## Why It Matters

Fleet data becomes useful only when engineers can answer three questions quickly: what does this dataset contain, where did it come from, and is it fit for the model or safety decision being made? A catalog without lineage is a search index. Lineage without quality checks is an audit trail for bad data. Quality checks without ownership decay into dashboards nobody trusts.

This page covers operational controls for curated fleet data products: raw logs, processed events, labels, features, replay sets, training splits, and evaluation datasets. Use it with `../mlops/mlops-scale-research-scope.md` and `../mlops/mlops-reference-architectures-by-scale.md` when deciding how much catalog, lineage, data quality, lakehouse, or data-versioning infrastructure is justified at each MLOps scale. When a data product can affect release, the catalog entry should also point to the split-firewall pattern in `../mlops/dataset-split-leakage-controls-by-scale.md` and the digest-bound attestation pattern in `../mlops/secure-artifact-attestation-profile.md`.

## Operating Model

1. Define data products with named owners: raw bag archive, normalized telemetry, object labels, scenario clips, model training tables, and evaluation tables.
2. Store large analytical datasets in snapshot-capable tables. Use Apache Iceberg snapshots, schema evolution, partition evolution, and retention policies to preserve reproducibility without freezing all storage forever.
3. Emit lineage events from each pipeline step. OpenLineage concepts of runs, jobs, datasets, and facets map cleanly to bag extraction, decoding, label import, feature generation, and training-set assembly.
4. Attach quality rules to the catalog entry, not only to the pipeline code. Rules should cover completeness, timestamp monotonicity, frame drops, calibration presence, label validity, class balance, split integrity, leakage reports, schema compatibility, and privacy filters.
5. Promote data by state: `raw`, `decoded`, `validated`, `curated`, `approved_for_training`, `approved_for_safety_evidence`, `deprecated`.
6. Review quality exceptions weekly with data owners and release blockers daily during model-release windows.

## MLOps Scale Ladder for Data Products

The data catalog should mature with the MLOps scale. The goal is not to catalog everything immediately; the goal is to make every dataset that can influence a release reproducible, governed, and reviewable.

| MLOps scale | Catalog requirement | Lineage requirement | Quality requirement | Feature/embedding requirement |
|---|---|---|---|---|
| S0 notebook research | Manifest next to files | Source path and collection date | Manual sample review | None |
| S1 repeatable prototype | Snapshot ID and fixed split | Preprocess script, config, and output digest | Validation script and basic schema checks | Optional offline cache |
| S2 production product | Curated dataset entry with owner and approved use | Raw -> decoded -> labels -> train/eval materialization chain | Scheduled rules, failure samples, waiver owner | Offline features only if reused by multiple models |
| S3 fleet and multi-site | Site/ODD partitions, access class, retention tier | Fleet trigger, site, vehicle, sensor, calibration, map, and label lineage | Slice coverage, class balance, drift, privacy/redaction QA | Embedding store for mining and retrieval with snapshot IDs |
| S4 regulated safety-critical | Evidence-locked catalog states and legal hold | Full graph from release artifact back to raw logs and reviewer decisions | Quality report tied to safety-case claim and expiry | Immutable feature/embedding snapshots only |
| S5 platform scale | Organization-wide catalog with policy-as-code | Automated lineage from ingestion, labels, training, replay, and serving | Quality SLOs, owner dashboards, exception workflow | Multi-tenant feature/embedding service with ACLs and quotas |

### Architecture Options by Scale

Do not confuse the layers. A table format is not a catalog. A catalog is not lineage. Lineage is not a quality gate. A quality gate is not a release approval. Mature MLOps usually combines small, explicit contracts with a few shared services instead of one "data platform" that silently owns every decision.

| Architecture layer | Good fit | Scale trigger | Pros | Cons / controls |
|---|---|---|---|---|
| File manifest plus DVC/object snapshot | Small datasets, baselines, model checkpoints, fixed splits | S0-S1, narrow S2 artifacts | Cheap, reviewable, works offline, easy to commit next to runs | Weak discovery; needs naming discipline and immutable remote storage |
| Lakehouse table format | Large training/eval tables, decoded telemetry, label exports, feature materializations | S2 when datasets exceed simple manifests or need queryable snapshots | Snapshot/time-travel semantics, schema/partition evolution, scalable analytics | Retention/VACUUM policies can destroy evidence unless release snapshots are pinned |
| Data catalog / metadata graph | Many data products, owners, access tiers, schemas, and consumers | S2-S3, mandatory for S4/S5 release evidence | Discovery, ownership, glossary/taxonomy, impact analysis, governance workflow | A catalog that indexes mutable paths can create false confidence; require snapshot IDs and allowed-use state |
| OpenLineage-style event stream | Cross-pipeline lineage across Airflow, Spark, dbt, notebooks, training, labels, replay | S2-S5 whenever root cause crosses tools | Standard job/run/dataset model and facets; good bridge between pipelines and catalogs | Needs producer instrumentation and stable dataset naming |
| Quality runner | Schema, completeness, bounds, drift, duplicate, label, and slice checks | S1 for baselines; S2+ for release-affecting data | Makes quality failures reproducible and machine-readable | Rule sprawl if checks are not tied to owners, severity, and promotion state |
| Data lake version-control layer | Branching, isolated backfills, rollback, experiment branches over object storage | S2-S4 when backfills or cleaning jobs need atomic review before merge | Git-like review model for data changes and reproducible commits | Another control plane to operate; do not add until backfill/review pain is real |
| Cloud data catalog / governance suite | Enterprise IAM, lineage, policy, and discovery across teams | S3-S5 or strict data residency/compliance needs | Integrated access control and managed operations | Vendor metadata model may not express vehicle, map, calibration, labeler, and release-state semantics without custom fields |

For autonomy, the strongest practical pattern is: object-store raw logs with immutable registration, lakehouse snapshots for decoded/curated products, catalog entries for ownership and allowed use, OpenLineage events for transformations, data-quality reports for promotion, and registry/release packets for any artifact that can change model, map, label, replay, or safety evidence.

### Data Product Contract

A data product is not just a table. It is a reusable, owned, governed artifact with a declared consumer and allowed use. At S0 this can be a Markdown manifest; at S3-S5 it should be a cataloged object with API-visible fields.

| Field | Requirement | Example in autonomy |
|---|---|---|
| `data_product_id` | Stable ID, version, and human-readable name | `apron-stand-a-decoded-lidar-2026q2` |
| `product_type` | Raw log, decoded stream, clip set, label batch, feature table, embedding index, replay pack, split, evaluation set, semantic-map export | `semantic_map_training_export` |
| `producer` and `owner` | Team, service, and accountable human or role | Data platform owner plus map owner |
| `intended_consumers` | Training jobs, evaluators, labelers, replay workers, dashboards, safety case, incident response | Map segmentation training and release replay |
| `source_scope` | Raw logs, vehicles, sensors, calibration packages, maps, telemetry schema, site/route/ODD cell | Vehicle IDs, LiDAR serials, map version, terminal frontage zone |
| `schema_contract` | Field names, types, units, coordinate frames, timing semantics, nullable fields, taxonomy version | Point coordinates in map frame, class ID, release-state label |
| `snapshot_identity` | DVC hash, object manifest digest, Iceberg/Delta snapshot/version, lakeFS commit, or catalog snapshot tag | Iceberg snapshot plus semantic-map manifest digest |
| `partition_policy` | Site, date, route, map tile, session, vehicle, privacy tier, and retention partitioning | Site/date/map-tile partitions with local holdout flag |
| `quality_policy` | Rule suite ID, severity, sample policy, slice requirements, waiver owner, expiry | Missing calibration is blocker; low intensity coverage is warning |
| `allowed_use` | Research, baseline, training, release eval, safety evidence, replay, monitoring, restricted, deprecated | `approved_for_release_eval` |
| `retention_and_deletion` | Evidence hold, legal hold, privacy deletion path, purge propagation | Release snapshot retained for safety-case window |
| `lineage_entrypoint` | Parent datasets, pipeline run IDs, code/config digests, labeler/reviewer records | Raw bag -> decoded points -> cleaned map -> pseudo-label export |
| `change_policy` | Who can promote, deprecate, backfill, delete, or waive | Data owner plus release owner for S2+ |
| `service_level` | Freshness, quality-report latency, restore objective, incident lane if release-critical | S3 daily quality report; S4 restore proof before release |

The contract should travel with the data product. A training run, evaluation report, registry record, or safety-case claim should be able to cite `data_product_id`, `snapshot_identity`, `allowed_use`, `quality_policy`, and `lineage_entrypoint` without reading pipeline code.

### Lineage Event Design

OpenLineage's run/job/dataset/facet model maps well to autonomy if the dataset naming convention is stable. Treat each materialization boundary as a lineage event, not every tiny function call.

| Lineage boundary | Job/run event | Input datasets | Output datasets | Required facets or custom fields |
|---|---|---|---|---|
| Raw upload registration | `register_bag` or `register_mcap` | Vehicle upload object | Raw log data product | Vehicle/site/session, telemetry schema, sensor kit, access class, checksum |
| Decode and normalization | `decode_rosbag_to_tables` | Raw log | Decoded topic tables, synchronized frames | Code commit, container digest, message counts, timestamp health, dropped-frame counts |
| Calibration/map join | `join_pose_calibration_map` | Decoded frames, calibration package, map package | Map-frame point/image products | Extrinsic/intrinsic IDs, map version, pose graph/source-map ID, projection QA |
| Label import or auto-label | `import_label_batch` or `run_labeler` | Candidate clips/maps/images, labeler/prompt/evaluator artifacts | Label batch or semantic layer | Taxonomy, reviewer workflow, accepted/rejected counts, allowed use |
| Quality validation | `validate_data_product` | Candidate data product | Quality report and promotion decision | Rule suite, severity, failing rows/clips/tiles, waiver owner, expiry |
| Split materialization | `materialize_split` | Curated dataset, labels, feature/index snapshot | Train/validation/test/replay split products | Split ID, grouping keys, leakage report, allowed uses |
| Training export | `build_training_export` | Split data, features, labels, maps | Model-ready table or tensor archive | Snapshot/digest, preprocessing config, class order, release-state mask |
| Replay/evidence export | `build_replay_pack` | Clips, maps, expected labels, runtime config | Replay package and evidence bundle | Scenario IDs, flake status, runtime contract, safety-case link |

For S3-S5, lineage events should be queryable in both directions: "what raw data produced this release?" and "which models, maps, labels, features, replay packs, and safety claims consumed this invalidated source?" The second query is the one that decides incident blast radius.

### Quality Gate Matrix

Quality rules should be attached to promotion states. The same failure can be a warning for research and a blocker for release evidence.

| Data layer | Typical checks | S0-S1 action | S2-S3 action | S4-S5 action |
|---|---|---|---|---|
| Raw logs | Checksum, metadata completeness, sensor/topic presence, upload integrity | Record limitation | Block curation if required topics are missing | Evidence hold cannot start until raw registration is complete |
| Decoded streams | Schema, timestamp monotonicity, frame drops, calibration presence, units, coordinate frames | Manual review | Block training export on missing calibration/time health | Safety evidence requires signed quality report and retained failure samples |
| Labels | Taxonomy compatibility, reviewer agreement, label geometry, class balance, allowed-use state | Mark candidate only | Only QA-passed labels enter production training | Hazard labels require expert review and audit trail |
| Semantic map exports | Source-map QA, release-state masks, tile coverage, dynamic residual rate, static-transient quarantine | Research-only candidate | Block map-derived training if source-map or release-state evidence is missing | Publication/safety evidence requires immutable manifest and map-hygiene report |
| Training/eval tables | Split ID, leakage report, duplicate/event overlap, feature-fit policy, privacy/access class | Baseline warning | Candidate release blocker if split or leakage is incomplete | Evidence-locked holdout access and retention policy |
| Feature tables | Point-in-time joins, freshness, null/bounds, online/offline parity, backfill state | Rebuild note | Block consumers during suspect backfill | Immutable feature snapshot for safety evidence |
| Embedding/vector indices | Corpus snapshot, embedding model, index build, recall/latency, deletion propagation | Local exploration only | Block active-learning/replay use when recall or deletion state is unknown | Retrieval supports evidence only with frozen corpus and trace |
| Replay packs | Scenario IDs, expected labels, runtime contract, flake rate, duplicate lineage | Smoke only | Release gate only if deterministic and non-overlapping | Safety-case replay needs retention, waiver, and reportability linkage |

### Data Product SLOs and Error Budgets

Once a data product can block release or incident response, it needs an operating target. Treat the SLO as a contract between producers and consumers, not only a dashboard.

| SLO | Applies when | Example target | Release meaning |
|---|---|---|---|
| Freshness | Monitoring, active learning, drift, incident triage | New trigger clips cataloged within 24 hours at S3 | Stale data can delay retraining but should not silently retrain |
| Quality-report latency | Training/eval/replay exports | Quality report produced in the same workflow run | Missing report blocks promotion |
| Lineage completeness | Release-affecting products | 100% parent/run/dataset coverage for promoted artifacts | Incomplete lineage blocks S2+ release |
| Restore objective | Evidence and catalog metadata | Catalog and quality reports restored within platform SLO | Unrestorable metadata blocks S4 evidence claims |
| Deletion propagation | Privacy, customer/site offboarding, restricted data | All derived products marked deleted/restricted within policy window | Derived artifacts remain suspect until propagation is proven |
| Blast-radius query time | Incidents and invalidation | Affected consumers identified within incident lane target | Slow impact analysis extends containment |

Error budgets should be strictest for evidence-bearing datasets, not for exploratory scratch data. A missed daily quality report on research clips is a nuisance; a missing release-eval lineage graph is a release blocker.

### Promotion States

Use explicit states so downstream consumers know what a dataset may do:

| State | Allowed use | Required next gate |
|---|---|---|
| `raw_registered` | Forensics, replay extraction, controlled inspection | Decode and schema validation |
| `decoded_validated` | Scenario mining, labeling intake | Sensor/time/calibration quality report |
| `labeled_candidate` | Reviewer workflow, active learning | Label QA and taxonomy compatibility |
| `curated_training` | Model training experiments | Split integrity, leakage check, privacy/access review |
| `approved_for_release_eval` | Release metrics and regression gates | Frozen snapshot, quality report, owner approval |
| `approved_for_safety_evidence` | Safety-case evidence and audit | Evidence lock, retention hold, waiver expiry |
| `deprecated_or_invalidated` | Historical reference only | Downstream invalidation and consumer notification |

Deletion, taxonomy changes, source-map corrections, and calibration fixes must propagate through the same states. If a source dataset is invalidated, derived clips, labels, features, embeddings, splits, replay packages, and model cards need either rebuild evidence or a documented containment waiver.

For map-derived pseudo-labels, use `../mlops/map-derived-pseudo-label-invalidation-protocol.md` as the required propagation pattern. The catalog entry should be able to answer which source map, semantic layer, release-state mask, calibration package, projection code, split ID, labeler/prompt artifact, model version, and release packet consumed the affected labels before a batch returns from `suspect` or `quarantined` to `active`.

For reusable features and embeddings, use `../mlops/feature-embedding-store-ops-by-scale.md` as the store-selection and evidence pattern. Catalog entries should record feature definition IDs, event-time semantics, materialization snapshots, online/offline parity checks, embedding model, corpus snapshot, index build ID, metadata filters, deletion state, and golden-query recall before derived representations can support training, replay, active learning, or safety evidence.

For dataset splits and holdouts, use `../mlops/dataset-split-leakage-controls-by-scale.md` as the split manifest and leakage-report pattern. Catalog entries should record the split ID, assignment unit, grouping keys, temporal cutoff, exclusion windows, held-out sites/routes/vehicles/map tiles, labeler or prompt scope, synthetic source assets, federated client scope, and leakage report before a data product is promoted to training, release evaluation, replay, or safety evidence.

## Evidence Artifacts

| Artifact | Minimum contents | Owner |
|---|---|---|
| Catalog entry | Dataset purpose, schema, ODD scope, owner, retention, access class | Data platform |
| Lineage graph | Source datasets, pipeline run IDs, code version, parameters, outputs | Data platform |
| Iceberg snapshot record | Table snapshot ID, schema ID, partition spec ID, branch/tag if used | Data engineer |
| Quality report | Rule results, sample counts, failure rows, waived failures, trend | Data quality owner |
| Data contract | Required fields, units, coordinate frames, timing assumptions, valid ranges | Producer and consumer |
| Label-schema record | Taxonomy, label versions, ontology references, compatibility notes | Label operations |
| Semantic-map catalog record | Semantic layer ID, manifest ID, compatibility hash, source map snapshot, map tile IDs, taxonomy ID/hash, schema URL/version, QA/evidence IDs, retention hold | Mapping + data platform |
| Data-product attestation | Dataset/label/replay/feature manifest digest, producer identity, lineage predicate, quality policy result, allowed-use scope | Data platform |
| Approval decision | Accepted use, restrictions, expiry, approvers, downstream consumers | Data steward |

## Acceptance Checks

- Every training and evaluation dataset resolves to immutable source snapshots.
- Every promoted data product has a contract naming ID, owner, consumers, schema, snapshot identity, quality policy, allowed use, retention/deletion policy, lineage entrypoint, and change authority.
- Every promoted training, evaluation, replay, local holdout, safety holdout, feature, embedding, or pseudo-label dataset resolves to a split manifest and leakage report appropriate to its MLOps scale.
- Every derived dataset has machine-readable lineage back to raw logs, labels, and processing code.
- Every release-affecting dataset, label batch, feature snapshot, embedding index, or replay pack has an immutable manifest digest and attestation link.
- Quality checks run before promotion and store both pass/fail status and failure samples.
- Quality rules have severity, owner, action, waiver scope, expiry, and release interpretation; dashboards without action do not count as gates.
- Schema changes are reviewed for downstream model, feature, replay, and safety evidence impact.
- Catalog entries identify the data owner, business purpose, access restrictions, retention class, and approved uses.
- Data used in release evidence is marked `approved_for_safety_evidence`, not only `approved_for_training`.
- Semantic-map datasets used for replay, training, or safety evidence resolve `manifest_id`, `compatibility_hash`, `semantic_layer_id`, `taxonomy_id`, map tile IDs, telemetry schema URL/version, and evidence IDs.
- Lineage events exist at materialization boundaries for fleet ingest, scenario extraction, semantic-label joins, replay package creation, and safety-evidence export.
- Dataset/schema promotion fails when telemetry schema URL/version is missing or incompatible with the consuming dashboard, replay worker, or release gate.
- Waivers have an owner, expiry date, scope, and measurable containment rule.

## Failure Modes

| Failure mode | Consequence | Control |
|---|---|---|
| Dataset name reused for mutable contents | Model release cannot be reproduced | Require snapshot IDs in manifests |
| Catalog indexes mutable paths but not snapshots | Search results look governed while release inputs still drift | Require snapshot identity, manifest digest, and allowed-use state for promoted data products |
| Data product lacks digest-bound attestation | Registry or release gate cannot prove the dataset evaluated is the dataset deployed or reused | Attach manifest digest, lineage predicate, quality policy result, and allowed-use scope |
| Pipeline lineage stops at a staging table | Root cause analysis cannot trace bad labels or corrupted logs | Emit lineage at every materialization boundary |
| Quality tool is detached from promotion states | Teams see failures but still consume the data | Attach rule severity and promotion blockers to catalog states |
| Data backfill merges without review | Training, eval, replay, and safety evidence change under old IDs | Use branch/review/merge or new snapshot IDs plus downstream impact query |
| Split manifest is missing or incomplete | Training data, local holdout, replay, feature corpus, or safety evidence may overlap without detection | Require split IDs, grouping keys, allowed use, and leakage reports before promotion |
| Quality checks live only in notebooks | Failures are not enforced in production | Move checks into scheduled pipeline gates |
| Schema evolution breaks consumers | Training jobs silently drop or misread fields | Data contract review before schema promotion |
| Semantic-map context stripped during joins | Replay or training data points to labels from the wrong map/taxonomy | Require manifest, compatibility hash, semantic layer, taxonomy, and tile IDs in catalog records |
| Catalog has owner gaps | Exceptions are never resolved | Block promotion for ownerless data products |
| Quality rules ignore ODD slices | Dataset passes globally but misses airport-specific defects | Require zone, weather, lighting, sensor, and vehicle slices |
| Retention deletes evidence inputs | Safety case cannot be reconstructed | Lock release evidence snapshots under retention hold |

## Related Repository Docs

- `50-cloud-fleet/data-platform/fleet-data-pipeline.md`
- `50-cloud-fleet/data-platform/perception-slam-fleet-data-contract.md`
- `50-cloud-fleet/data-platform/data-engine-from-bags.md`
- `50-cloud-fleet/mlops/data-flywheel-airside.md`
- `50-cloud-fleet/mlops/dataset-split-leakage-controls-by-scale.md`
- `50-cloud-fleet/mlops/feature-embedding-store-ops-by-scale.md`
- `50-cloud-fleet/mlops/secure-artifact-attestation-profile.md`
- `50-cloud-fleet/data-governance/fleet-data-privacy-governance.md`
- `60-safety-validation/safety-case/safety-case-evidence-traceability.md`
- `60-safety-validation/verification-validation/perception-slam-statistical-validity-protocol.md`

## Sources

- ISO/IEC 5259-5:2025, "Artificial intelligence - Data quality for analytics and machine learning (ML) - Part 5: Data quality governance framework." https://www.iso.org/standard/84150.html
- OpenLineage object model. https://openlineage.io/docs/spec/object-model/
- scikit-learn, "Common pitfalls and recommended practices: Data leakage." https://scikit-learn.org/stable/common_pitfalls.html
- TensorFlow, "Get started with TensorFlow Data Validation." https://www.tensorflow.org/tfx/data_validation/get_started/
- OpenLineage facets and data quality metrics facet. https://openlineage.io/docs/spec/facets/ and https://openlineage.io/docs/spec/facets/dataset-facets/data_quality_metrics/
- OpenTelemetry telemetry schemas. https://opentelemetry.io/docs/specs/otel/schemas/
- Apache Iceberg, "Spec." https://iceberg.apache.org/spec/
- Apache Iceberg, "Branching and Tagging." https://apache.github.io/iceberg/docs/latest/branching/
- Apache Iceberg, "Evolution." https://iceberg.apache.org/docs/1.4.2/evolution/
- Delta Lake, "Welcome to the Delta Lake documentation." https://docs.delta.io/
- lakeFS, "Welcome to lakeFS." https://docs.lakefs.io/
- DVC, "Data and Model Versioning." https://doc.dvc.org/example-scenarios/versioning-data-and-models/tutorial
- Feast, "Introduction." https://docs.feast.dev/
- DataHub, "What is DataHub?" https://docs.datahub.com/
- OpenMetadata, "Explore the Lineage View." https://docs.open-metadata.org/how-to-guides/data-lineage/explore
- Great Expectations, "Expectations overview." https://docs.greatexpectations.io/docs/cloud/expectations/expectations_overview
- AWS Glue, "Data Quality Definition Language (DQDL) reference." https://docs.aws.amazon.com/glue/latest/dg/dqdl.html
- Regulation (EU) 2024/1689, Artificial Intelligence Act, Articles 10-12 and Annex IV. https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689
