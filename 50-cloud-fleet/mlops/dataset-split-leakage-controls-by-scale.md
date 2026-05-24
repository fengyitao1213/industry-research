# Dataset Split and Leakage Controls by Scale

**Last updated:** 2026-05-24

Dataset splits are release artifacts, not convenience files. In autonomy, a train/validation/test split can change whether a model is genuinely learning generalizable perception or only memorizing routes, vehicles, map tiles, labeler habits, repeated clips, or future information. The risk increases when training data comes from aggregated LiDAR maps, LiDAR-image fusion, map-derived pseudo-labels, active learning, ML-related SLAM, synthetic data, and multi-site fleets.

This page defines split and leakage controls across MLOps scale levels. Use it when a dataset, label batch, replay package, feature snapshot, embedding index, or model release needs evidence that evaluation data stayed independent from training and tuning decisions.

---

## Core Principle

The split manifest is the firewall between learning and evidence. It should be immutable for any promoted baseline, candidate, replay package, safety claim, or benchmark result.

The practical rule:

1. Split before training-time fitting, feature selection, normalization, labeler calibration, threshold tuning, and synthetic augmentation decisions.
2. Assign groups, not only frames, when frames share route, site, session, object identity, map tile, labeler, source map, or event family.
3. Treat validation and test sets as consumers with allowed uses. A validation set may tune thresholds. A release test, local holdout, safety holdout, or benchmark set must not.
4. Store split lineage next to the dataset snapshot, model registry record, replay package, and release packet.
5. Rerun leakage checks whenever a source map, calibration, taxonomy, pseudo-label batch, feature materialization, embedding index, synthetic generator, or federated client cohort changes.

Scikit-learn's leakage guidance is a useful baseline: split first, do not fit preprocessing on test data, and use pipelines to keep transformations scoped to training data. Fleet autonomy needs the same discipline plus grouping and lineage for site, map, vehicle, sensor, route, labeler, and time dependencies.

---

## Scope

| Artifact | Leakage question | Typical split unit |
|---|---|---|
| Single-scan LiDAR segmentation | Did adjacent frames, same object tracks, or same session leak across train/eval? | Clip, session, route, vehicle, time window |
| LiDAR-image segmentation | Did image-derived labels or calibration/projection artifacts leak into evaluation? | Sensor kit, calibration package, projection batch, session |
| Aggregated-map segmentation | Did map tiles, source-map sessions, or map-derived pseudo-labels appear in both training and release evidence? | Map tile, source map, semantic layer, source session, site |
| Dynamic/static map cleaning | Did removed dynamic residuals, stationary people, or static-transient assets appear in both training and hygiene evaluation? | Track/event family, map tile, review batch |
| ML-related SLAM | Did learned registration, place recognition, loop closure, or learned map priors train on evaluation routes or maps? | Route, place cluster, map version, sensor kit, date |
| Replay and scenario mining | Did replay scenarios become training examples after they were used as release gates? | Scenario ID, event family, root-cause cluster |
| Feature and embedding stores | Were feature definitions or vector indices fit with future/test data? | Event time, materialization snapshot, corpus/index build |
| Foundation-model labelers | Did prompt packs, evaluator thresholds, or retrieval corpora see benchmark answers? | Prompt/evaluator version, corpus snapshot, labeler run |
| Federated or local training | Did client/site holdouts leak through aggregation, shared adapters, or central distillation? | Client, site, round, adapter, holdout cohort |
| Synthetic data | Did generated cases use test-set geometry, labels, seeds, or scene reconstructions? | Generator seed, source asset, scenario template, domain randomization batch |

---

## Split Unit Taxonomy

Choosing the wrong split unit is the most common leakage source. A random frame split is rarely valid for autonomy release evidence because adjacent frames, repeated routes, static background, and object identities are highly correlated.

| Split unit | Use when | Leakage prevented |
|---|---|---|
| Frame | Only for S0 smoke checks on independent static samples | Minimal; not release grade for temporal logs |
| Clip/window | Adjacent frames share scene context | Immediate temporal duplicate leakage |
| Trip/session | Vehicle drives one continuous route or task | Route context, lighting, operator behavior, repeated actors |
| Route/zone | Managed-site tasks repeat the same lanes, stands, aisles, gates, or quays | Route memorization and local geometry shortcuts |
| Site/customer | New airport, port, campus, warehouse, or district is a deployment target | Site overfitting and customer-specific procedure leakage |
| Vehicle/sensor kit | Hardware, firmware, LiDAR model, camera layout, or mounting differs | Calibration and sensor-bias leakage |
| Calibration package | Projection, fusion, or back-projection is calibration-dependent | LiDAR-image or map-label projection leakage |
| Map version/tile | Labels or priors come from registered maps | Source-map and semantic-layer leakage |
| Time/date/AIRAC cycle | Future conditions differ from training conditions | Future leakage, seasonal leakage, construction or map-change leakage |
| Event family/root cause | Multiple clips are mined from one incident or anomaly cluster | Replay scenario duplication |
| Object or actor identity | Personnel, vehicles, aircraft, assets, or static objects repeat | Identity memorization |
| Labeler/prompt/evaluator | Auto-labelers, VLMs, LLM judges, or human reviewer pools differ | Labeler-style leakage and benchmark contamination |
| Synthetic source asset/seed | Synthetic scenes are generated from real assets or templates | Template and seed leakage |
| Federated client/site | Training happens across site or tenant boundaries | Client holdout and privacy-evidence leakage |

---

## Leakage Mode Taxonomy

| Leakage mode | Example | Control |
|---|---|---|
| Temporal future leakage | Model trains on data collected after the validation/test period | Time-ordered split, cutoff timestamp, exclusion window |
| Adjacent-frame leakage | Every fifth LiDAR frame goes to validation while neighboring frames train | Clip/session grouping and temporal gap |
| Near-duplicate clip leakage | Same hard-brake or FOD event is mined into both active learning and replay | Event-family grouping and scenario lineage |
| Route/site leakage | Model evaluated on the same route geometry and signage it trained on | Route, zone, and site holdouts |
| Vehicle/sensor leakage | Evaluation vehicle shares calibration quirks with training fleet | Held-out vehicles, sensor kits, and calibration packages |
| Map/tile leakage | Map-derived labels from a source map train the model, then the same map tile evaluates it | Map-version and tile-level split firewall |
| Source-map leakage | Learned SLAM prior trains on the same source sessions used for geometry QA | Source-session and map-build lineage gates |
| Labeler leakage | Human or foundation-model labeler tuned on the benchmark answer set | Labeler/prompt/evaluator registry and allowed-use state |
| Pseudo-label leakage | Back-projected semantic-map labels enter training and release eval from the same source map | Pseudo-label batch manifest and split checks |
| Active-learning leakage | Release failures are mined into training, then reused unchanged as release gates | Replay scenario retirement or separate clean holdout |
| Feature leakage | Feature normalization, PCA, embedding index, or retrieval corpus is fit on eval/test examples | Fit transforms on training-only snapshots; record corpus/index build |
| Monitoring leakage | Delayed labels from production monitoring become both retraining data and post-release success evidence | Monitoring cohort assignment and delayed-label evidence separation |
| Synthetic leakage | Synthetic generator reconstructs or copies test-set scenes | Seed/source-asset split and real-only final validation |
| Federated leakage | A held-out client contributes updates, adapters, or teacher logits to a global model | Client-holdout policy and round-level aggregation manifest |
| Benchmark leakage | Public leaderboard or internal safety test informs hyperparameters repeatedly | Evidence-locked test set, evaluation budget, and blind final gate |

---

## Scale Ladder

| MLOps scale | Minimum split control | Leakage control | Promotion blocker |
|---|---|---|---|
| S0 notebook research | Fixed train/validation/test file or seed in the run note | Manual check that examples are not obvious duplicates | Result reused as a baseline without data pointer and split note |
| S1 repeatable prototype | Immutable dataset snapshot plus split manifest | Repeatable split generator with clip/session grouping | Baseline metric changes without frozen split ID |
| S2 single-product production | Release dataset manifest with train/eval/replay split IDs | Automated duplicate, temporal, feature-fit, label, and replay overlap checks | Candidate lacks clean split report tied to registry version |
| S3 fleet and multi-site | Site/route/vehicle/map local holdouts and ODD-cell split manifests | Local holdout protection, event-family grouping, active-learning/replay separation | Global aggregate passes while target site holdout is contaminated |
| S4 regulated safety-critical | Evidence-locked safety holdouts with retention and waiver policy | Test-set access logging, evaluation budget, incident freeze, safety-case trace | Safety claim uses data that influenced training, tuning, labels, or thresholds |
| S5 platform scale | Shared split service and lineage graph across products and tenants | Policy-as-code, split-as-contract API, cross-tenant isolation, leakage audit API | Platform allows unsupported reuse or ambiguous split ownership |

Small fleets can need S4 split controls when the model affects people, aircraft, protected zones, or compliance claims. Large offline research programs can remain S1 if outputs never cross into release authority.

---

## Split Manifest Contract

At S1 the manifest can be a JSON sidecar. At S2-S5 it should become a cataloged artifact with lineage, owner, digest, policy result, and registry links.

| Field | Requirement |
|---|---|
| `split_id` | Immutable ID for the split assignment |
| `task` | Detection, semantic segmentation, map segmentation, SLAM registration, replay, labeler evaluation, or foundation-model judging |
| `artifact_scope` | Dataset, label batch, replay pack, feature snapshot, embedding index, pseudo-label export, or model release |
| `dataset_snapshot_id` | Immutable data/lakehouse/DVC/Iceberg snapshot |
| `split_version` | Split generator version and parameters |
| `assignment_unit` | Frame, clip, session, route, site, vehicle, map tile, client, event family, or combined group |
| `grouping_keys` | Site, route, session, vehicle, sensor kit, calibration, map version, map tile, object identity, event family, prompt pack |
| `temporal_cutoff` | Training cutoff time and validation/test time windows |
| `exclusion_windows` | Minimum time gap around split boundaries and event families |
| `holdout_scope` | Sites, routes, vehicles, map versions, clients, weather bins, or ODD cells reserved for validation/test/safety |
| `source_map_scope` | Source map manifest, semantic layer, map-hygiene layers, source sessions, and tile IDs for map-derived data |
| `labeler_scope` | Human team, vendor batch, model labeler, prompt pack, evaluator, threshold set, retrieval corpus |
| `feature_scope` | Feature definition, materialization snapshot, event-time policy, embedding model, corpus, index build |
| `synthetic_scope` | Generator version, source assets, seeds, scenario templates, domain randomization policy |
| `privacy_and_residency` | Tenant/site restrictions, deletion state, allowed jurisdictions, retention class |
| `allowed_use` | Train, validation, tuning, release test, safety holdout, replay, benchmark, monitoring, review only |
| `leakage_report_id` | Output of duplicate, temporal, lineage, feature-fit, labeler, replay, and policy checks |
| `downstream_consumers` | Training runs, registry versions, release packets, safety-case claims, replay suites |
| `owner_and_expiry` | Data owner, model owner, approver, expiry/revalidation trigger |

---

## Control Gates

| Gate | Required check | Blocking condition |
|---|---|---|
| Training export | Split manifest exists before examples are materialized | Dataset is drawn from mutable paths or split is generated after labels/features are fit |
| Preprocessing | Transform state is fit only on training partition | Normalizer, imputer, PCA, class weights, or feature selector uses eval/test data |
| Label import | Label batches preserve allowed-use and split state | Candidate/review labels become release truth or test answers leak to labelers |
| Pseudo-label promotion | Source-map, taxonomy, calibration, release-state, and split IDs are stable | Map-derived labels share source tiles with release evaluation without holdout policy |
| Feature/embedding build | Event-time join and corpus/index lineage are recorded | Future/test examples influence feature materialization or retrieval corpus |
| Replay promotion | Scenario IDs and event families are not already training examples unless marked retired | Release replay suite overlaps training or active-learning examples |
| Federated aggregation | Client/site holdouts are excluded from updates, distillation, and shared adapters | Held-out clients contribute model updates or teacher logits |
| Release evaluation | Candidate registry record names split IDs and leakage report | Test or local holdout set was used for tuning or repeated threshold selection |
| Safety evidence | Holdout is evidence-locked with access log, owner, expiry, and retention | Safety claim depends on data that influenced training, map labels, or evaluation policy |
| Platform reuse | Split ownership and allowed use are queryable by API | Another team reuses a release test, tenant holdout, or benchmark set as training data |

---

## Training and Evaluation Architecture Comparison

| Architecture | Advantages | Disadvantages | Best use |
|---|---|---|---|
| Random frame split | Simple, fast, useful for pipeline smoke tests | Severe leakage for video/LiDAR sequences, static maps, and repeated sites | S0 only, non-release debugging |
| Temporal split | Mirrors production by training on past data and testing on later data | Does not prove route/site/vehicle generalization by itself | S1-S2 baselines, drift studies, monitoring retrain decisions |
| Temporal split with gap | Reduces adjacent-frame and same-object leakage | Requires enough data volume; gap choice must be justified | LiDAR/image logs, airside routes, event-triggered clips |
| Group split by session/route | Prevents route and repeated-scene memorization | Can produce imbalanced class/site distributions | Managed-site perception and replay packages |
| Vehicle/sensor-kit holdout | Tests hardware and calibration robustness | Expensive for small fleets; confounds vehicle and site if fleet is not balanced | S2+ release for heterogeneous fleets |
| Site/ODD-cell holdout | Strong evidence for new airport, port, campus, warehouse, or district transfer | Hardest split; may make metrics lower and data needs higher | S3+ multi-site release and local acceptance |
| Map-version/tile holdout | Tests generalization to unseen map geometry and source-map builds | Needs careful tile boundary handling to avoid seam leakage | Aggregated-map segmentation and ML-SLAM QA |
| Event-family holdout | Prevents one incident from training and validating the same root cause | Requires event clustering and scenario lineage | Safety replay, active learning, root-cause regression suites |
| Group k-fold / leave-one-group-out | Uses limited data efficiently while respecting group independence | More compute; fold leakage if grouping keys are incomplete | S1-S3 model comparison and ablation |
| Evidence-locked blind holdout | Highest credibility for release or safety claims | Slow, expensive, and access-controlled; unsuitable for daily tuning | S4 safety evidence and benchmark-like final gates |
| Synthetic-real split | Tests whether synthetic data helps real data without replacing it | Synthetic assets can leak real test geometry if poorly sourced | Rare hazards, weather, FOD, digital-twin transfer |
| Federated client holdout | Tests cross-client/site generalization and privacy-preserving training | Hard to debug; aggregation can indirectly contaminate holdouts | S3-S5 local, hybrid, federated, or privacy-constrained training |

For scikit-learn-scale experiments, `GroupKFold`, `LeaveOneGroupOut`, and `TimeSeriesSplit` are useful mental models. At autonomy scale, the same ideas must be lifted into cataloged manifests so every pipeline and release gate sees the same split policy.

---

## LiDAR, Image, and ML-SLAM Specific Rules

### LiDAR

- Do not split individual point frames randomly when frames come from dense multi-sweep or aggregated-map sessions.
- Group by clip/session/route and keep a temporal gap for adjacent scans.
- Record LiDAR model, firmware, intensity calibration, mounting position, and extrinsic calibration in the split manifest.
- Treat de-skewing, ground removal, dynamic-object removal, voxel statistics, and range normalization as training-fitted or source-dependent operations that require lineage.

### Image and LiDAR-Image Fusion

- Record camera model, intrinsics, extrinsics, time-sync package, projection code, and image source batch.
- Keep image-dependent labels separate from LiDAR-only release evidence unless the runtime artifact also depends on images.
- If images are used only for train-time distillation or colorized map labeling, record that as a training-only dependency with explicit allowed use.
- Rebuild or quarantine split evidence when projection QA, calibration, or time-sync changes.

### Aggregated Maps and Semantic Maps

- Split by source map, map version, semantic layer, tile, source session, and release-state mask.
- Do not let a semantic map tile produce training labels and also serve as the independent release test for that same product mode.
- Preserve map-hygiene labels for `permanent_static`, `dynamic_residual`, `movable_static`, `static_transient`, `fod_candidate`, `artifact`, and `unknown_review` so release-state leakage is measurable.
- Rerun leakage checks when map merging, loop closure, source-map acceptance, dynamic residual removal, or static-transient quarantine changes.

### ML-Related SLAM

- Learned place recognition and registration models should hold out place clusters, routes, and map versions, not only individual pairs.
- Learned dynamic removal and map cleaning should evaluate on scenes whose dynamic/static decisions were not used to tune thresholds.
- Neural or Gaussian map priors should record source sessions and reconstruction assets so evaluation maps are not regenerated from training scenes.
- SLAM improvements that change poses or map geometry invalidate downstream map-derived split claims until affected labels and replay packages are rechecked.

---

## Managed-Site and Non-Road Urban District Rules

Airside, port, yard, campus, warehouse, terminal-frontage, facade, utility, and other non-road mapping programs have repeated geometry and strong local procedures. That makes leakage easy and false confidence common.

| Domain feature | Split implication |
|---|---|
| Repeated routes and stands | Hold out routes/zones, not random frames |
| Stationary people or parked movable assets | Use release-state labels so static-but-transient objects do not become permanent training truth |
| Construction, de-icing, temporary closures | Split by date/map version and expire old holdouts after operational change |
| Thin utility/facade infrastructure | Use site and asset-family holdouts to avoid memorizing repeated structures |
| Local procedure differences | Release evidence must be scoped by ODD cell and operating phase |
| Multi-tenant sites | Split and access policy must preserve tenant/customer boundaries |
| Public-proxy benchmarks | Treat as pretraining or method evidence, not local release evidence |

The managed-site default should be: global training pool for representation learning, local holdouts for release evidence, and evidence-locked safety holdouts for behavior authority.

---

## Scorecards

| KPI | Meaning | Release interpretation |
|---|---|---|
| Split manifest coverage | Percentage of training/eval/replay artifacts with split IDs | S1 baseline and S2 release blocker |
| Group-key completeness | Required grouping keys present for site, route, session, vehicle, map, labeler, and event family | Missing key means leakage check is incomplete |
| Temporal gap violations | Adjacent train/eval examples within exclusion window | Block release eval until removed or waived |
| Duplicate/event overlap rate | Near-duplicate or same-event examples across train/eval/replay | Block if release replay or local holdout is affected |
| Feature-fit leakage rate | Preprocessing or feature materialization fit on eval/test | Block candidate; rebuild transform |
| Map/tile overlap rate | Shared source-map tiles or sessions across train and independent eval | Block map-derived release evidence |
| Labeler contamination rate | Benchmark/eval answers exposed to labelers, prompts, evaluators, or reviewers | Block affected labels/evals |
| Holdout access count | Number of human or automated accesses to blind/evidence holdout | S4/S5 audit input; high use may retire the holdout |
| Retired-test reuse count | Evidence tests moved into training after retirement and replacement | Healthy if explicit; dangerous if silent |
| Waiver age | Age of unresolved split/leakage exception | Old waivers should block S4/S5 release |

---

## Failure Modes

| Failure mode | Consequence | Control |
|---|---|---|
| Split generated after preprocessing | Test information changes model features | Split first; fit transforms on train only |
| Random frames from one route split across train/test | Metrics overstate route generalization | Clip, session, route, and temporal grouping |
| Local holdout enters active-learning training | Site release evidence becomes self-fulfilling | Holdout allowed-use policy and lineage block |
| Replay scenario used for training without retirement | Candidate learns the release gate | Scenario lineage and replacement replay case |
| Map-derived labels from eval tile train the model | Aggregated-map metric measures memorization | Map/tile/source-session split firewall |
| Static-transient object treated as permanent ground truth | Model learns stationary people or parked assets as map fixtures | Map-hygiene release-state masks and static-transient quarantine |
| Feature/vector index includes future examples | Retrieval or feature quality leaks test data | Event-time materialization and corpus/index split policy |
| Prompt/evaluator sees test answers | Foundation-model labeler or judge contaminates benchmark | Prompt/evaluator registry and blind eval discipline |
| Federated held-out client contributes updates | Client holdout no longer independent | Client-round manifest and aggregation policy |
| Old safety holdout reused too often | Safety evidence becomes tuned to the known test set | Access log, evaluation budget, holdout retirement |
| Split policy differs across teams | Model, data, replay, and safety evidence cannot be reconciled | Shared split service or cataloged split-as-contract |

---

## Related Pages

- `mlops-scale-research-scope.md` - MLOps maturity ladder and research backlog.
- `mlops-scorecards-and-kpis-by-scale.md` - release-blocking metrics and operating cadence.
- `mlops-reference-architectures-by-scale.md` - S0-S5 architecture patterns and platform interfaces.
- `mlops-migration-checklist-by-scale.md` - transition evidence before raising artifact authority.
- `site-sliced-release-evidence-by-scale.md` - ODD-cell manifests and local holdout evidence.
- `model-governance-release-evidence.md` - release packet, registry aliases, and rollback evidence.
- `map-derived-pseudo-label-invalidation-protocol.md` - semantic-map pseudo-label state machine and impact graph.
- `feature-embedding-store-ops-by-scale.md` - point-in-time feature and vector-index leakage controls.
- `federated-privacy-preserving-training-policy-by-scale.md` - client/site holdout rules for federated and hybrid training.
- `../data-platform/fleet-data-pipeline.md` - raw logs, split generation, and training export pipeline.
- `../data-platform/data-catalog-lineage-quality-ops.md` - catalog states, lineage, and data product promotion.
- `../data-platform/perception-slam-fleet-data-contract.md` - perception/SLAM data contracts and duplicate grouping.
- `../../10-knowledge-base/machine-learning/av-data-evaluation-fundamentals.md` - AV dataset and evaluation fundamentals.
- `../../10-knowledge-base/machine-learning/evaluation-calibration-and-data-leakage-first-principles.md` - first principles for leakage and calibration.
- `../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md` - semantic-map training exports and release-state controls.
- `../../30-autonomy-stack/localization-mapping/overview/ml-related-slam-research-scope.md` - learned SLAM and map-cleaning research scope.

## Sources

- scikit-learn, "Common pitfalls and recommended practices: Data leakage." https://scikit-learn.org/stable/common_pitfalls.html
- scikit-learn, "sklearn.model_selection." https://scikit-learn.org/stable/api/sklearn.model_selection.html
- TensorFlow, "Get started with TensorFlow Data Validation." https://www.tensorflow.org/tfx/data_validation/get_started/
- OpenLineage, "Object Model." https://openlineage.io/docs/spec/object-model/
- Google Cloud Architecture Center, "MLOps: Continuous delivery and automation pipelines in machine learning." https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning
- MLflow, "Model Registry Workflows." https://www.mlflow.org/docs/latest/ml/model-registry/workflow/
- ISO/IEC 5259-5:2025, "Artificial intelligence - Data quality for analytics and machine learning (ML) - Part 5: Data quality governance framework." https://www.iso.org/standard/84150.html
