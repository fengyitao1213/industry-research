# Map-Derived Pseudo-Label Invalidation Protocol

**Last updated:** 2026-05-24

Map-derived pseudo-labels are high-leverage and high-risk. A reviewed semantic map can back-project millions of labels into single-scan training data, but every exported label inherits the source map, pose graph, calibration, taxonomy, release-state decision, cleaner policy, reviewer state, and projection code that produced it. If any upstream artifact is corrected, the derived labels may become stale or unsafe.

This protocol defines when a map-derived pseudo-label batch must be quarantined, rebuilt, or permanently retired. It is the P0 control behind the `mlops-scale-research-scope.md` backlog item "Map-derived pseudo-label invalidation protocol." Use `dataset-split-leakage-controls-by-scale.md` for the companion split-firewall policy that prevents map-derived labels from contaminating release evaluation, replay, or local holdouts.

---

## Scope

The protocol applies to any label derived from an aggregated map and then consumed by training, evaluation, replay, active learning, benchmarking, or release evidence:

| Derived artifact | Example | Why invalidation matters |
|---|---|---|
| Back-projected scan labels | Semantic map labels projected into contributing LiDAR sweeps | Pose or calibration fixes can move labels onto the wrong points |
| Map-derived training table | Single-scan segmentation rows created from a semantic map | Training can learn stale map mistakes as ground truth |
| Release-state masks | `permanent_static`, `movable_static`, `fod_candidate`, `artifact`, `unknown_review` masks | A release-state change can convert a positive label into an ignore or review label |
| Pseudo-label confidence fields | Per-point or per-cluster confidence from a map segmenter or labeler | Threshold or calibration changes alter allowed use |
| Replay/eval labels | Map-derived expected outputs for scenario replay | A candidate can pass against stale expected labels |
| Foundation-model candidate labels | SALT/SAM/OpenUrban3D/VLM prompt outputs over map tiles | Prompt/model/corpus changes can alter candidate evidence |

The safest rule is simple: a pseudo-label batch is valid only for the exact source-map, semantic-layer, taxonomy, release-state, calibration, projection, and reviewer state recorded in its manifest.

---

## Invalidation Triggers

| Trigger | Examples | Default action |
|---|---|---|
| Source-map correction | Pose graph update, loop-closure fix, tile re-registration, map merge rerun | Quarantine derived labels for affected tiles and sessions; rebuild back-projection |
| Calibration update | LiDAR extrinsics, camera intrinsics, time offset, sensor serial swap, thermal drift correction | Reproject or invalidate labels that used the old calibration |
| Taxonomy change | Class split/merge, new unknown policy, class order change, facade or utility sublabel addition | Rebuild label mappings; block training until class compatibility is proven |
| Release-state change | `movable_static` becomes `permanent_static`, FOD review overturns, artifact confirmed, temporary overlay expires | Recompute training masks and remove invalid positives |
| Cleaner or permanence policy change | Dynamic removal threshold, static-transient quarantine, FOD retention rule, map hygiene policy update | Rebuild hygiene layers and all downstream training exports |
| Projection/back-projection code bug | Frame transform, timestamp interpolation, occlusion, nearest-neighbor assignment, tile stitch bug | Quarantine affected batches and models trained on them |
| Reviewer decision overturned | Audit finds label error, safety owner rejects promotion, waiver expires | Mark derived labels suspect and create rebuild/review task |
| Split or leakage violation | Training export overlaps validation/test/replay package or held-out site | Retire affected split; retrain/evaluate with clean split |
| Prompt/labeler/evaluator change | Prompt pack, model checkpoint, retrieval corpus, judge threshold, open-vocabulary mapping changes | Re-evaluate candidates; keep old batch frozen or deprecated |
| Privacy/deletion request | Customer/site offboarding, retention expiry, data-use restriction | Propagate deletion or restriction to derived labels, features, models, and evidence |
| Incident linkage | Field incident suggests source labels contributed to unsafe behavior | Freeze evidence, quarantine related labels, and run root-cause review |

Not every trigger requires retraining. It does require an impact query that can answer which labels, datasets, model versions, evaluation packs, semantic maps, and release packets consumed the affected source.

---

## State Machine

| State | Meaning | Allowed use |
|---|---|---|
| `active` | Batch is current for its manifest and allowed uses | Training/eval/replay as declared |
| `suspect` | Upstream trigger may affect the batch; impact not yet known | Read-only inspection; no new release training |
| `quarantined` | Batch is affected or cannot be proven unaffected | No training or release evidence; active-learning review allowed |
| `rebuilt` | Batch was regenerated from corrected sources | Candidate use only until QA passes |
| `reapproved` | Rebuilt batch passed QA and split checks | Training/eval/replay as declared |
| `deprecated` | Historical batch retained for audit, not future use | Incident/audit reference only |
| `purged_or_restricted` | Data must not be used due to privacy, contract, or retention rule | Remove from derived stores; retain only legally permitted audit record |

Promotion from `suspect` to `active` is allowed only with a negative impact analysis: the trigger did not touch the batch's source map tiles, calibration scope, taxonomy fields, release-state labels, split membership, or allowed use.

---

## Impact Graph

Every pseudo-label batch should be reachable through this graph:

| Upstream node | Downstream nodes to query |
|---|---|
| Raw survey/session | source map, semantic map, training export, replay/eval packages |
| Pose graph / source map | semantic layer, map-hygiene layers, back-projected labels, localization replay |
| Calibration package | colorization, projection, back-projection, fusion labels, runtime map contract |
| Dynamic-removal / hygiene sidecar | release-state masks, training positives/negatives, FOD/hazard labels |
| Semantic taxonomy | training labels, model heads, class-order consumers, metrics, runtime loaders |
| Reviewer decision | label state, QA report, release packet, safety-case evidence |
| Prompt/labeler/evaluator | candidate labels, reviewer tasks, label QA, model cards |
| Training export | dataset snapshot, model training run, experiment, registry version |
| Model registry version | evaluation pack, release packet, deployment manifest, incident evidence |

The data catalog should store this as lineage, not as prose. At minimum, each edge needs source ID, output ID, code version, parameter hash, timestamp, owner, and allowed-use state.

---

## Batch Manifest Fields

| Field | Requirement |
|---|---|
| `pseudo_label_batch_id` | Immutable ID for the exported label batch |
| `source_map_manifest_hash` | Exact source map and pose graph used |
| `semantic_layer_id` | Semantic map layer ID and digest |
| `map_hygiene_layer_digests` | Dynamic, transient, FOD, artifact, and review layers consumed |
| `taxonomy_id` / `class_id_map` | Versioned semantic taxonomy and ordered class mapping |
| `release_state_schema` | Allowed release-state values and training permissions |
| `calibration_id` | Sensor/camera/extrinsic/timing calibration used for projection |
| `projection_code_hash` | Back-projection/materialization code and parameters |
| `split_id` | Train/val/test/replay/local-holdout split membership, grouping keys, allowed use, and leakage checks |
| `review_state` | Candidate, reviewed, QA-passed, waived, rejected, or expired |
| `allowed_use` | Training positive, auxiliary task, evaluation, replay, review only, or blocked |
| `invalidation_status` | Active, suspect, quarantined, rebuilt, reapproved, deprecated, or restricted |
| `upstream_artifact_ids` | Source maps, prompts, labelers, evaluators, cleaner configs, and QA reports |
| `downstream_consumers` | Dataset snapshots, training runs, registry versions, release packets, and replay packs |

These fields can begin as JSON sidecars. At S3-S5 they should be data-catalog fields with queryable lineage and policy checks.

---

## Scale Requirements

| MLOps scale | Minimum invalidation control |
|---|---|
| S0 notebook research | Note the source map and projection script; do not reuse pseudo-labels outside the experiment without promotion |
| S1 repeatable prototype | Batch manifest, fixed split, and manual invalidation note when the source map or taxonomy changes |
| S2 single-product production | Cataloged batch state, lineage to model registry version, release-ticket hold when a batch becomes suspect |
| S3 fleet and multi-site | Site/ODD impact query, active-learning rebuild queue, and local holdout protection for affected sites |
| S4 regulated safety-critical | Evidence freeze, safety-case impact review, retention hold, rollback assessment, and approver record |
| S5 platform scale | Policy-as-code invalidation propagation across catalog, registry, feature/embedding store, evaluator, and deployment services |

At S2+, invalidation should fail closed: if impact cannot be proven, treat the batch as quarantined until rebuilt or waived.

---

## Airside Rules

- `permanent_static` is the only default positive state for base semantic class supervision.
- `movable_static`, `static_transient`, `fod_candidate`, `artifact`, and `unknown_review` may train auxiliary heads, hard negatives, or review queues, but not permanent-static positives without explicit declaration.
- FOD and personnel corrections are safety-critical invalidation triggers even when the corrected region is small.
- Temporary overlays must expire or renew; labels exported from expired overlays become suspect by default.
- Airport/site-specific taxonomy aliases must not propagate into global labels without taxonomy approval.
- Back-projected labels from a corrected source map must not share split IDs with the old labels unless leakage checks are rerun.

---

## Related Pages

- `mlops-scale-research-scope.md` - scale ladder and backlog.
- `dataset-split-leakage-controls-by-scale.md` - split manifests and leakage controls for map-derived labels, replay, local holdouts, and release evidence.
- `data-flywheel-airside.md` - map-derived semantic label branch.
- `model-governance-release-evidence.md` - release evidence and registry controls.
- `../data-platform/data-catalog-lineage-quality-ops.md` - catalog states, lineage, and data quality.
- `../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md` - semantic-map training export and release-state masks.
- `../../30-autonomy-stack/localization-mapping/maps/airside-map-hygiene-ground-truth-protocol.md` - release-state labels and QA fields.
- `../ota/perception-slam-artifact-compatibility-matrix.md` - artifact-set compatibility and activation gates.

## Sources

- ISO/IEC 5259-5:2025, "Artificial intelligence - Data quality for analytics and machine learning (ML) - Part 5: Data quality governance framework." https://www.iso.org/standard/84150.html
- OpenLineage object model. https://openlineage.io/docs/spec/object-model/
- Apache Iceberg, "Spec." https://iceberg.apache.org/spec/
- MLflow, "Model Registry Workflows." https://www.mlflow.org/docs/latest/ml/model-registry/workflow/
- Google Cloud, "MLOps: Continuous delivery and automation pipelines in machine learning." https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning
