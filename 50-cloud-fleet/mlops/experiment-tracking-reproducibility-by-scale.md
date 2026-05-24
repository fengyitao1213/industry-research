# Experiment Tracking and Reproducibility by Scale

**Last updated:** 2026-05-24

Experiment tracking is the control plane for deciding whether an ML result is disposable, comparable, promotable, auditable, or reusable. A run is useful only when the next engineer, pipeline, reviewer, or incident-response process can answer: what code, data, split, labels, config, environment, hardware, seeds, preprocessing, map/calibration/runtime inputs, metrics, costs, and downstream artifacts produced this result?

This page deepens the experiment-tracking plane in `mlops-scale-research-scope.md`. Use it with `dataset-split-leakage-controls-by-scale.md` for split independence, `mlops-reference-architectures-by-scale.md` for component placement, `mlops-migration-checklist-by-scale.md` for adoption gates, `model-governance-release-evidence.md` for promoted artifact evidence, and `gpu-queueing-finops-by-scale.md` for run cost and capacity metadata.

The goal is not to log everything. The goal is to make the run authority explicit: which runs are notes, which are baselines, which are candidate artifacts, which are release evidence, and which can be ignored.

---

## Core Principle

Experiment tracking should preserve three kinds of truth:

| Truth | Question it answers | Minimum evidence |
|---|---|---|
| Rebuild truth | Can the run be recreated or explained? | Code commit, dependency lock, config, seed policy, container or environment, command |
| Comparison truth | Can this result be compared fairly with another run? | Dataset snapshot, split ID, metric spec, evaluator version, label schema, excluded data |
| Release truth | Can the output affect production, maps, labels, or safety evidence? | Registry link, output digest, approval state, compatibility manifest, audit retention, rollback impact |

For autonomy, comparison truth is usually the hard part. Two runs with the same architecture are not comparable if one uses a different map revision, calibration package, semantic taxonomy, pseudo-label batch, camera projection, local holdout, or replay suite.

---

## Run Authority States

Every tracked run should carry an authority state. The state prevents exploratory results from becoming hidden baselines and prevents training jobs from silently becoming release approvals.

| State | Meaning | Allowed downstream use | Required controls |
|---|---|---|---|
| `scratch_run` | Quick local experiment or notebook probe | Personal learning only | Owner, date, rough data pointer |
| `exploratory_run` | Result may inform design direction | Research discussion | Code commit, config, data pointer, metric note, limitations |
| `baseline_run` | Comparable reference used in reports or roadmaps | Future run comparison | Frozen split, environment lock, metric spec, failure examples |
| `candidate_run` | Produces an artifact for product review | Registry candidate, shadow review, labeler review | Dataset snapshot, split/leakage report, output digests, eval report, runtime/export evidence |
| `release_run` | Produces or verifies a deployable artifact | Shadow, canary, champion, rollback | Release packet, compatibility manifest, attestation, rollback target, approver handoff |
| `evidence_run` | Produces safety, audit, replay, or incident evidence | Safety case, audit, corrective action | Immutable logs, retention hold, safety-case IDs, waiver/expiry state |
| `platform_benchmark` | Measures shared platform, model family, or hardware lane | Capacity planning, architecture choice, platform SLO | Standard workload, hardware/software bill, cost, queue wait, reproducibility level |

Authority is not the same as model quality. A weak baseline can still be authority-bearing if it anchors comparison. A high-scoring notebook result remains non-authoritative if nobody can reconstruct its data and evaluation path.

---

## Reproducibility Levels

Use these levels to avoid vague claims such as "reproducible" or "tracked."

| Level | Definition | Typical scale |
|---|---|---|
| R0: note-only | Human-readable note exists but the run cannot be rerun reliably | S0 throwaway work |
| R1: command-replayable | Command, config, data pointer, and metric output are saved | S0-S1 |
| R2: data/config-replayable | Immutable data snapshot, split ID, config hash, metric spec, and evaluator are recorded | S1-S2 |
| R3: environment-replayable | Container/image digest, dependency lock, hardware class, seed policy, and framework versions are recorded | S2-S3 |
| R4: tolerance-bound | Rebuild can reproduce metrics within an agreed tolerance on an equivalent hardware/software lane | S2-S4 |
| R5: evidence-locked | Run record, logs, artifacts, policy checks, and output digests are immutable for the audit or safety-case window | S4-S5 |

Bitwise determinism is often unnecessary and sometimes unrealistic for GPU training. PyTorch explicitly warns that exact reproducibility is not guaranteed across releases, commits, platforms, or CPU/GPU paths. The practical target for most S2-S4 autonomy work is R4: metrics and outputs are reproducible within declared tolerance on the supported lane, with nondeterministic sources named.

---

## Scale Ladder

| Scale | Tracking posture | Reproducibility target | Upgrade trigger |
|---|---|---|---|
| S0 notebook research | Run note, git commit, config, data pointer, metric, failure sample | R1 for any result that leaves the notebook | Another person must understand or reuse the result |
| S1 repeatable prototype | Experiment tracker or committed run table, frozen split, Docker/env lock, baseline script | R2-R3 for baseline runs | Two candidates need fair comparison |
| S2 single-product production | Tracker run linked to dataset manifest, split/leakage report, registry candidate, export/eval artifacts | R3-R4 for candidate and release runs | Artifact reaches shadow, canary, customer demo, production labels, or map export |
| S3 fleet and multi-site | Site/ODD run lineage, active-learning batch IDs, replay package IDs, map/calibration/runtime scope | R4 for site-scoped candidates | Local ODD cells can pass/fail independently |
| S4 regulated safety-critical | Evidence-locked run records, immutable logs, approver handoff, retention, rollback drill | R5 for release and incident evidence | Run supports a safety claim, waiver, incident, or reportability decision |
| S5 platform scale | Organization experiment/eval warehouse, lineage graph, policy templates, multi-tenant namespaces, cost/SLO metadata | R4-R5 by artifact authority | Many teams share data, evals, registries, GPUs, and release policies |

The practical transition is from "log a run" at S1 to "govern run authority" at S2+. A tracker full of runs is not a release system unless the authoritative runs point to immutable data, split manifests, output artifacts, and review states.

---

## Run Manifest Contract

A training, evaluation, labeling, replay, or benchmark run should emit a manifest. The manifest may start as JSON, YAML, or Markdown, then move into MLflow, W&B, TFX ML Metadata, OpenLineage, or an internal warehouse.

| Field group | Required fields | Notes |
|---|---|---|
| Identity | `run_id`, `run_authority`, `owner`, `project`, `task`, `hypothesis`, `created_at`, `parent_run_id` | Parent/child runs are useful for sweeps, folds, multi-site runs, and export/eval substeps |
| Code | `repo`, `code_commit`, `repo_dirty_state`, `branch`, `config_uri`, `config_hash`, `train_command`, `eval_command` | Dirty state should block baseline/candidate authority unless patched artifacts are archived |
| Environment | `container_digest`, `dependency_lock`, `framework_versions`, `python_version`, `cuda_driver`, `os_image`, `hardware_class` | Hardware class is enough at R3; exact worker identity is needed at R5 |
| Randomness | `seed_policy`, `global_seed`, `dataloader_seed`, `augmentation_seed`, `determinism_flags`, `known_nondeterministic_ops` | Capture tolerance when deterministic mode is too slow or unsupported |
| Data | `dataset_snapshot_ids`, `split_id`, `split_policy_version`, `leakage_report_id`, `excluded_data`, `data_quality_report_id` | Use immutable IDs, not bucket prefixes |
| Labels | `label_schema_id`, `taxonomy_version`, `label_batch_ids`, `qa_report_id`, `allowed_use_state`, `pseudo_label_batch_ids` | Map-derived and foundation-model labels need separate allowed-use states |
| Autonomy context | `site_ids`, `odd_cells`, `vehicle_kits`, `map_ids`, `calibration_ids`, `runtime_ids`, `telemetry_schema_id` | Required when model behavior depends on maps, calibration, runtime, or site semantics |
| Modality | `lidar_sensor_set`, `camera_sensor_set`, `projection_calibration_hash`, `image_distillation_teacher`, `fusion_mode` | LiDAR-only, image-conditioned, image-distilled, and LiDAR-image fusion runs are not interchangeable |
| Features and indices | `feature_snapshot_ids`, `embedding_index_ids`, `corpus_snapshot_ids`, `point_in_time_join_report` | Required if features or retrieval can influence training/eval/evidence |
| Model | `architecture`, `pretrained_checkpoint`, `init_policy`, `hyperparameters`, `augmentation_policy`, `loss_spec`, `class_weights` | For segmentation, include class order and ignored/release-state masks |
| Evaluation | `metric_spec_id`, `evaluator_version`, `eval_dataset_ids`, `replay_pack_ids`, `slice_set_id`, `threshold_policy`, `comparison_baseline` | Metric spec must be versioned before S2 promotion |
| Outputs | `checkpoint_uri`, `model_digest`, `export_artifacts`, `plots`, `failure_examples`, `registry_version`, `release_packet_id` | Output digests are required before registry alias movement |
| Compute and cost | `gpu_type`, `gpu_count`, `wall_time`, `queue_wait`, `utilization`, `storage_cost`, `egress_cost`, `cost_center` | Required at S3+, useful earlier for expensive experiments |
| Governance | `reviewer`, `policy_result`, `retention_class`, `allowed_downstream_use`, `waiver_id`, `expiry`, `incident_or_safety_case_ids` | Separates artifact production from approval |

At S2+, the manifest should be emitted by the pipeline, not typed by hand after the result is known.

---

## Architecture Options

| Option | Best fit | Advantages | Disadvantages | Autonomy caveat |
|---|---|---|---|---|
| Git plus Markdown/CSV run table | S0, very small S1 | Simple, reviewable, no service dependency | Hard to query, weak artifact handling, manual discipline required | Good only while runs do not affect release artifacts |
| MLflow Tracking plus Model Registry | S1-S3, self-hosted or managed model teams | Tracks params/metrics/artifacts, groups runs into experiments, can link models and datasets, registry path is clear | Metadata model needs conventions; registry alone does not enforce safety evidence | Add custom tags for map, calibration, ODD, split, labeler, and compatibility IDs |
| W&B Experiments and Artifacts | S1-S3 research-heavy teams | Strong UI, sweeps, media logging, system metrics, artifact workflows, collaboration | SaaS/data-boundary review may be needed; governance still needs local policy | Good for segmentation visualizations, failure panels, and site-sliced dashboards if data policy allows |
| DVC experiments and pipelines | S1-S2 reproducible data/model workflows | Git-native data/pipeline versioning, metrics diffs, experiment comparison, cache reuse | UI/governance less complete than dedicated trackers; large teams need conventions | Strong fit for immutable LiDAR/map snapshots and pipeline stages |
| TensorBoard | S0-S2 deep learning diagnostics | Lightweight metrics, graphs, histograms, embeddings, common framework support | Not a run-governance system by itself | Useful for debugging training dynamics, not enough for release evidence |
| TFX ML Metadata | S3-S5 pipeline platforms | Models artifacts, executions, contexts, lineage queries, and reuse of previous executions | Heavier integration; strongest inside pipeline platforms | Useful when train/eval/export/replay are typed components with lineage |
| OpenLineage-compatible lineage backend | S3-S5 data and pipeline observability | Standard run/job/dataset event model, cross-platform lineage graph, extensible facets | Does not replace experiment UI or model registry | Good for joining data pipelines, feature builds, training, replay, and map exports |
| Custom experiment/eval warehouse | S4-S5 autonomy platform | Can model map/calibration/runtime/site/safety concepts exactly | Expensive to build and maintain; risk of bespoke lock-in | Justified when release evidence, fleet telemetry, and scenario replay need one query surface |

Industry-proven systems usually combine tools. A pragmatic S2 lane can use DVC for dataset snapshots, MLflow or W&B for run tracking, a registry for model aliases, and a release packet in the governance system. S5 platforms often separate raw lineage, experiment UI, registry state, policy decisions, and eval warehouse while keeping stable artifact IDs across all of them.

---

## Run Comparison Rules

Do not compare runs unless these contracts are compatible:

| Contract | Compatibility requirement |
|---|---|
| Task and taxonomy | Same task definition, class order, ignored labels, release-state masks, and allowed-use states |
| Dataset and split | Same dataset snapshot family, split policy, leakage report, local holdout policy, and excluded data |
| Metric and evaluator | Same metric spec, threshold policy, evaluator version, slice set, and confidence interval method |
| Modality | Same input contract or explicitly declared comparison lane: LiDAR-only, LiDAR-image fusion, image-distilled LiDAR, image-conditioned map labeler |
| Map and calibration | Same source-map acceptance policy, map revision family, calibration set, projection QA, and pose/registration quality threshold |
| Runtime | Same export path, precision, hardware target, preprocessing, post-processing, and latency/memory budget if production relevance is claimed |
| Evidence authority | Same or higher run authority state; a scratch run cannot replace a baseline or release run |

If a contract changes intentionally, create a new comparison family. This is common when a team changes semantic taxonomy, adopts map-derived labels, introduces camera distillation, switches from sparse convolution to point transformer, or starts site-specific adaptation.

---

## Autonomy-Specific Controls

### Aggregated LiDAR Maps and Semantic Segmentation

For aggregated-map semantic segmentation, a run is not defined only by point clouds and labels. It also depends on the map-building substrate.

Required run dependencies include:

- registered source-map IDs, multi-session merge method, and pose graph quality summary;
- map-hygiene layer digests for dynamic residual removal, static-but-transient quarantine, and false deletion masks;
- semantic taxonomy and release-state taxonomy;
- tile ledger, tile overlap/stitching policy, ignored border state, and seam-confusion checks;
- LiDAR intensity/range normalization, voxelization or superpoint partitioning, and any camera projection/colorization inputs;
- source-map acceptance package and MapEval-style geometry QA before semantic labeling;
- pseudo-label invalidation policy for downstream training exports.

### LiDAR and Image Inputs

LiDAR-only and image-supported runs need different release contracts:

| Input lane | What must be tracked | Release implication |
|---|---|---|
| LiDAR-only | Sensor model, range/intensity normalization, sweep aggregation, registration quality, map-hygiene masks | Best release portability when runtime map has no image dependency |
| LiDAR plus image fusion | Camera calibration, synchronization, projection QA, image coverage, exposure/weather quality | Stronger semantics but release depends on camera provenance and projection validity |
| Image-distilled LiDAR | Teacher model, image corpus, teacher checkpoint, distillation labels, projection QA | Runtime may remain LiDAR-only, but training evidence depends on image teacher lineage |
| Open-vocabulary or VLM-assisted labeling | Prompt/model/retrieval IDs, reviewer disposition, candidate/accepted state, eval pack | Candidate labels cannot become release labels without labeler governance |

### ML-Related SLAM and Map Cleaning

ML-SLAM, dynamic-object removal, learned registration, neural implicit maps, and Gaussian maps can feed tracking runs in two ways:

| Role | Tracking rule |
|---|---|
| Upstream map producer | Treat SLAM/map-cleaning run as a data-product run with source logs, registration method, dynamic removal method, map acceptance metrics, and map digest |
| Training/eval dependency | Reference the exact map product, removal sidecar, static/transient labels, and acceptance package in the downstream model run manifest |

Stationary people, parked service equipment, movable barriers, and temporary construction assets are not simply dynamic-object removal errors. They are release-state decisions. Runs must distinguish semantic class, observed motion, persistence evidence, operations context, and map eligibility.

### Non-Road Managed Sites

Airport aprons, terminal frontages, service yards, warehouses, ports, campuses, mines, and construction districts create local ODD semantics that generic road datasets do not capture. Track:

- site/zone/task IDs, not only dataset name;
- route family, operational shift, weather/lighting, work-zone state, and map revision;
- local holdout and local replay packs;
- site-specific terminology in prompts or annotation instructions;
- whether a run supports a global model, site adapter, local LoRA, map update, or operations-only dashboard.

---

## Pipeline Design Pattern

### S1-S2 Candidate Pipeline

1. Create immutable dataset and split manifests.
2. Launch training through a script, DVC stage, CI job, or orchestrator.
3. Emit a run manifest before training starts.
4. Log metrics, parameters, artifacts, system metrics, and failure samples during training.
5. Run evaluator with a versioned metric spec and slice set.
6. Export model/package artifacts and compute digests.
7. Register candidate artifact without moving production aliases.
8. Attach release packet only if output authority moves beyond baseline/candidate.

### S3-S4 Fleet Evidence Pipeline

1. Partition by site/ODD cell and local holdout.
2. Run train/eval/replay/export as separate child runs under one candidate authority record.
3. Join run records with active-learning batch IDs, map/calibration/runtime IDs, and replay package IDs.
4. Create evidence run records for safety slices, incident replay, and rollback drills.
5. Block alias movement when any required child run lacks R4/R5 evidence.
6. Preserve logs, artifacts, and policy results for the retention window.

The important design choice is that training, evaluation, export, replay, and release review are separate state transitions. A green training job can produce a candidate. It cannot approve a release by itself.

---

## Scorecards

| KPI | S0-S1 threshold | S2-S3 threshold | S4-S5 threshold |
|---|---|---|---|
| Run manifest coverage | Preserved baselines have manifest | Candidate/release runs have machine-generated manifest | Evidence runs have immutable manifest and audit export |
| Rebuild success | Another engineer can rerun baseline | CI/pipeline rebuilds within metric tolerance | Rebuild drill passes for evidence-retention sample |
| Comparable baseline coverage | Baselines name data/split/metric | Candidate report compares against compatible baseline | Policy blocks unsupported comparisons |
| Dirty-state rate | Manual review | Dirty candidate runs are blocked unless patch is archived | Dirty evidence runs are disallowed |
| Dataset/split linkage | Frozen split for baseline | Dataset, split, leakage report linked to tracker and registry | Holdout access and evidence retention are audited |
| Artifact linkage | Checkpoint path saved | Output digest, registry version, export package, eval report linked | Attestation and policy result linked to release packet |
| Run cost coverage | Manual note for expensive runs | GPU/cost center/queue wait recorded | Unit cost and reserved-assurance capacity reported |
| Run-to-incident traceability | Not required | Active artifact IDs join to telemetry and incidents | Incident evidence freezes run/map/runtime state |

Release blockers should include missing run manifest, missing dataset/split linkage, unsupported run comparison, dirty candidate state, missing output digest, missing evaluator version, and missing reproducibility level for the requested authority.

---

## Failure Modes

| Failure mode | Consequence | Control |
|---|---|---|
| Tracker used as a scrapbook | Many runs exist but nobody knows which is authoritative | Require run authority state and lifecycle transitions |
| Baseline not frozen | New candidates compare against a moving target | Promote baseline only with dataset/split/config/evaluator manifest |
| Dirty code promoted | Result cannot be rebuilt from source control | Block candidate/release authority unless patch bundle is archived and digested |
| Mutable data path logged | Rebuild silently uses different samples | Require immutable dataset snapshot and split ID |
| Metric spec drift | Apparent improvement is evaluator change | Version metric spec, evaluator code, threshold policy, and slice set |
| Modality mismatch | LiDAR-only and image-assisted results are compared as if identical | Track modality lane and release contract |
| Map/calibration mismatch | Model passes offline but fails on active map or vehicle kit | Include map, calibration, runtime, and telemetry IDs in the run manifest |
| Sweep best run cherry-picked | Best seed or config becomes claim without multiple-run evidence | Require seed policy, variance reporting, and baseline comparison set |
| Tracker does not link to registry | Candidate cannot be connected to deployed artifact | Store registry version, output digest, and export package in the run record |
| Evidence garbage-collected | Audit or incident review cannot reproduce approval | Apply retention class and immutable evidence store at S4-S5 |

---

## Related Pages

- `mlops-scale-research-scope.md` - maturity ladder and lifecycle controls.
- `mlops-reference-architectures-by-scale.md` - architecture patterns and durable interfaces.
- `mlops-migration-checklist-by-scale.md` - transition gates for adding trackers, registries, orchestration, and policy.
- `mlops-scorecards-and-kpis-by-scale.md` - KPIs and release blockers for reproducibility and governance.
- `dataset-split-leakage-controls-by-scale.md` - split manifests, leakage reports, and holdout independence.
- `model-monitoring-drift-response-by-scale.md` - drift events, retraining triggers, and incident follow-up.
- `model-governance-release-evidence.md` - registry aliases, release packets, and approval evidence.
- `secure-artifact-attestation-profile.md` - artifact signing, SBOM/provenance, and policy verification.
- `gpu-queueing-finops-by-scale.md` - GPU job metadata, queueing, unit economics, and assurance capacity.
- `feature-embedding-store-ops-by-scale.md` - feature, embedding, vector index, and snapshot reproducibility.
- `offboard-labeler-registry-by-scale.md` - labeler, prompt, evaluator, threshold, and reviewer workflow governance.
- `map-derived-pseudo-label-invalidation-protocol.md` - invalidation state machine for map-derived training exports.
- `../data-platform/data-catalog-lineage-quality-ops.md` - data product lineage and promotion states.
- `../../20-av-platform/compute/training-infrastructure.md` - GPU infrastructure, orchestration, DVC, and tracker examples.
- `../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md` - aggregated-map segmentation pipeline and release contracts.
- `../../30-autonomy-stack/localization-mapping/overview/ml-related-slam-research-scope.md` - ML-SLAM substrate and map-cleaning handoff.

## Sources

- MLflow, "MLflow Tracking." https://mlflow.org/docs/latest/ml/tracking/
- Weights & Biases, "Experiments overview." https://docs.wandb.ai/models/track
- DVC, "Experiment Management." https://doc.dvc.org/user-guide/experiment-management
- DVC, "Pipelines." https://doc.dvc.org/user-guide/pipelines
- TensorFlow, "Get started with TensorBoard." https://www.tensorflow.org/tensorboard/get_started
- TensorFlow, "ML Metadata." https://www.tensorflow.org/tfx/guide/mlmd
- OpenLineage, "Object Model." https://openlineage.io/docs/spec/object-model/
- PyTorch, "Reproducibility." https://docs.pytorch.org/docs/2.12/notes/randomness.html
