# Data Catalog, Lineage, and Quality Operations

**Last updated:** 2026-05-24

## Why It Matters

Fleet data becomes useful only when engineers can answer three questions quickly: what does this dataset contain, where did it come from, and is it fit for the model or safety decision being made? A catalog without lineage is a search index. Lineage without quality checks is an audit trail for bad data. Quality checks without ownership decay into dashboards nobody trusts.

This page covers operational controls for curated fleet data products: raw logs, processed events, labels, features, replay sets, training splits, and evaluation datasets. When a data product can affect release, the catalog entry should also point to the split-firewall pattern in `../mlops/dataset-split-leakage-controls-by-scale.md` and the digest-bound attestation pattern in `../mlops/secure-artifact-attestation-profile.md`.

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
- Every promoted training, evaluation, replay, local holdout, safety holdout, feature, embedding, or pseudo-label dataset resolves to a split manifest and leakage report appropriate to its MLOps scale.
- Every derived dataset has machine-readable lineage back to raw logs, labels, and processing code.
- Every release-affecting dataset, label batch, feature snapshot, embedding index, or replay pack has an immutable manifest digest and attestation link.
- Quality checks run before promotion and store both pass/fail status and failure samples.
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
| Data product lacks digest-bound attestation | Registry or release gate cannot prove the dataset evaluated is the dataset deployed or reused | Attach manifest digest, lineage predicate, quality policy result, and allowed-use scope |
| Pipeline lineage stops at a staging table | Root cause analysis cannot trace bad labels or corrupted logs | Emit lineage at every materialization boundary |
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
- Apache Iceberg, "Evolution." https://iceberg.apache.org/docs/1.4.2/evolution/
- Feast, "Introduction." https://docs.feast.dev/
- Regulation (EU) 2024/1689, Artificial Intelligence Act, Articles 10-12 and Annex IV. https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689
