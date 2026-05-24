# Site-Sliced Release Evidence by Scale

**Last updated:** 2026-05-24

Site-sliced release evidence prevents a common autonomy failure mode: a model improves globally, passes one replay suite, or succeeds at one site, then gets treated as approved everywhere. Fleet autonomy does not release to an abstract fleet. It releases to a bounded operational design domain (ODD): site, route, zone, weather, lighting, vehicle kit, sensor calibration, map state, runtime package, semantic taxonomy, task, and operating procedure.

The rule for S3+ autonomy is direct: **promotion is by ODD cell, not by fleet percentage.** A 5% canary on easy daytime service roads does not validate night stand entry, terminal frontage, jetblast zones, public pedestrian plazas, warehouse aisles, port quays, mine haul roads, campus crossings, or utility corridors.

Use `evaluation-platform-replay-gates-by-scale.md` for the underlying evaluation manifest, metric spec, replay package, runtime package smoke, shadow/canary denominator, and waiver fields that make an ODD-cell release decision comparable and auditable.

---

## Release Unit

A release unit should be smaller than "fleet" and larger than one vehicle. It is the minimum scope where evidence can justify behavior authority.

| Dimension | Examples | Why it matters |
|---|---|---|
| Site | Airport A, port terminal B, yard C, campus district D | Local geometry, rules, traffic mix, markings, and operational norms differ |
| Zone | Stand, apron lane, terminal frontage, warehouse aisle, loading bay, quay, public crossing | Hazard classes and right-of-way rules differ |
| Route/task | Gate-to-bagroom, tug crossing, inspection route, service-road transit | A model can be safe for transit but weak for close-proximity tasks |
| Time/weather | Day, night, rain, fog, de-icing, low sun, snow, dust | Perception and planning distributions shift |
| Vehicle/sensor kit | LiDAR model, camera coverage, radar, compute target, firmware | Runtime and calibration behavior differ |
| Map/calibration state | Map package, semantic layer, changed tiles, calibration package | Active artifacts bound what was evaluated |
| Model/runtime package | Model version, TensorRT/ONNX/container, class order, thresholds | Offline checkpoint approval does not prove runtime package approval |
| Operational authority | Advisory, shadow, supervised, limited autonomous, full autonomous | Evidence depth must match the consequence of wrong behavior |

The release packet should name the ODD cell explicitly. "Model v42 approved for Airport A" is too broad. "Model v42, runtime bundle R17, map M31, calibration C9, Airport A stand-entry task, daylight/dry, vehicle kit K2, supervised-to-autonomous canary" is reviewable.

---

## Scale Ladder

| MLOps scale | Site-slice posture | Minimum evidence | Promotion anti-pattern |
|---|---|---|---|
| S0 notebook research | Slice labels are exploratory notes | Record which site/zone examples were inspected | Claiming transfer from a few screenshots |
| S1 repeatable prototype | Frozen validation split has basic site/task tags | Report metrics by site, class, and known ODD slice if available | Treating one validation split as representative of operations |
| S2 single-product production | Release packet names the intended site or service | Offline holdout, replay smoke, package load, rollback target | Shipping to operators from aggregate mAP alone |
| S3 fleet and multi-site | Every rollout has an ODD-cell manifest and local holdout | Site/route/weather slices, replay, shadow, canary, delayed-label joins | One global champion hides local regressions |
| S4 regulated safety-critical | ODD-cell evidence links to safety-case claims and waiver state | Claim/evidence table, hazard slices, monitor thresholds, rollback drill, incident trigger policy | Waiving a local regression without owner, expiry, or mitigation |
| S5 platform scale | Shared release service enforces site-slice policy | Policy-as-code, evidence completeness, tenant/site isolation, scorecard API | Teams bypass platform with local canary spreadsheets |

Small fleets can still require S4 controls when the release affects people, aircraft, public roads, protected zones, or regulatory evidence. Large offline research programs can remain S1 if outputs do not affect operations or release evidence.

---

## Evidence Stack

| Gate | What it proves | Required for |
|---|---|---|
| Data contract | The requested ODD cell is named with site, route, task, weather, vehicle, map, calibration, and taxonomy scope | S2+ |
| Offline holdout | The candidate does not regress on independent local data, with split lineage checked through `dataset-split-leakage-controls-by-scale.md` | S1+ |
| Scenario replay | Known incidents, map-change cases, hazard classes, and required maneuvers still pass | S2+ |
| Runtime package test | The exact deployable artifact loads and meets latency/memory/class-order constraints | S2+ |
| Shadow mode | The candidate behaves acceptably on live inputs without control authority | S3+ |
| Canary by ODD cell | Limited operational exposure shows acceptable health, disagreement, intervention, and delayed-label evidence | S3+ |
| Monitor and rollback readiness | Runtime monitors can detect degradation and rollback can execute for the same cell | S3+ |
| Safety-case review | Residual risk, waivers, mitigations, and reportability are approved | S4+ |
| Platform policy check | Shared evidence and release services enforce the fields and blocks automatically | S5 |

The gates are cumulative. A canary does not replace replay; replay does not replace shadow; shadow does not replace a safety-case decision when behavior authority changes.

---

## ODD-Cell Manifest

| Field | Minimum contents |
|---|---|
| `release_candidate_id` | Model registry version, alias, and release packet ID |
| `artifact_set` | Model, runtime, map, semantic taxonomy, calibration, telemetry schema, prompt/labeler/evaluator, replay package, rollback target |
| `site_scope` | Site ID, owner, customer/tenant, geography, local rules, data residency |
| `zone_scope` | Routes, lanes, stands, crossings, restricted/protected zones, map tile IDs |
| `task_scope` | Driving, inspection, FOD detection, tug crossing, routing, labeling, map publication, advisory-only |
| `environment_scope` | Weather, lighting, surface state, de-icing, jetblast, dust, GNSS state, construction |
| `vehicle_scope` | Vehicle type, sensor kit, compute hardware, firmware, maintenance/calibration status |
| `data_evidence` | Training snapshot, split manifest, local holdout, leakage check, label QA, source-map acceptance if map-derived |
| `evaluation_evidence` | Evaluation manifest, evaluator version, offline metrics, confidence intervals, replay suite, runtime smoke, hazard-slice metrics, known failures |
| `shadow_evidence` | Exposure hours, denominator, disagreement taxonomy, interventions, operator notes, trigger yield |
| `canary_evidence` | Cohort, start/end time, exposure denominator, monitor thresholds, rollback triggers |
| `delayed_label_evidence` | Reviewer samples, incident review, false positive/negative estimates, map-change review |
| `decision` | Approved, held, restricted, canary-only, rolled back, deprecated |
| `expiry` | Evidence expiry date, required revalidation triggers, waiver owner |

The manifest should be machine-readable even if the release review is written in Markdown. The same fields drive deployment, monitoring, incident response, and future invalidation.

---

## Slice Taxonomy for Managed Sites

| Slice family | Airside examples | Other non-road examples | Evidence focus |
|---|---|---|---|
| Protected people | Ground crew, security, pedestrians near terminal | Warehouse pickers, yard workers, campus pedestrians | Missed-person recall, false-free-space, safe stop behavior |
| Large movable assets | Aircraft, GSE, jet bridges, baggage trains | Containers, forklifts, trailers, mining trucks | Clearance, occlusion, prediction, protected-zone rules |
| Small hazards | FOD, chocks, cones, hoses, debris | Pallets, tools, rocks, cables, fallen cargo | Rare-class recall, close-range braking, scenario replay |
| Infrastructure | Stands, lane markings, signs, fences, poles | Racks, curbs, gates, quay edges, utility cabinets | Semantic-map correctness, localization stability, route constraints |
| Environmental state | Rain, fog, low sun, night, de-icing, jetblast | Dust, snow, indoor glare, wet floor, mud | Sensor degradation, OOD, perception health, ODD boundary |
| Operational phase | Pushback, turnaround, refuel, loading, maintenance | Loading, shift change, peak yard flow, public event | Procedure-specific behavior and operator handoff |
| Map state | New construction, changed stand, temporary closure | Temporary aisle closure, roadworks, site event | Map freshness, changed-tile replay, semantic release-state handling |

Non-road sites often have more repeated structure than public roads, but the local procedures are stronger. A class that is harmless in one zone can be release-blocking in another. A baggage cart, forklift, maintenance cone, or stationary person can be either expected context, protected obstacle, transient map artifact, or incident signal depending on the slice.

---

## Release State Machine

| State | Meaning | Exit criterion |
|---|---|---|
| `candidate_global` | Candidate passed generic offline checks | ODD-cell manifest created |
| `candidate_site` | Candidate has target site/task scope | Local holdout and replay suite attached |
| `site_shadow` | Candidate runs without authority in the target cell | Shadow exposure and disagreement review pass |
| `site_canary` | Candidate has limited authority in controlled cohort | Canary metrics, monitor health, and delayed labels pass |
| `site_champion` | Candidate is approved for this ODD cell | Release decision signed and rollback verified |
| `restricted_champion` | Candidate is approved with exclusions or mitigations | Restriction expires or evidence closes gap |
| `held` | Evidence incomplete or regression unresolved | Missing evidence supplied or candidate rejected |
| `quarantined_cell` | Field signal invalidates current approval for a cell | Rollback or containment plus root-cause review |
| `deprecated_cell` | Cell approval retired by new artifact, map, or ODD change | Replacement release or permanent withdrawal |

Alias movement should respect the state. A model can be `champion` for Airport A daylight service-road transit and only `site_shadow` for Airport B night stand entry.

---

## Training and Adaptation Choices

| Approach | Advantages | Disadvantages | Best use |
|---|---|---|---|
| One global model | Operationally simple, more data, one runtime package | Hides local regressions, weak local terminology, can overfit dominant site | S2 single site or S3 when sites are very similar |
| Global model plus local thresholds | Fast adaptation, small release delta | Can mask calibration or label-quality issues; needs per-slice evidence | Confidence/calibration differences by site/weather |
| Global backbone plus site adapters/LoRA | Strong transfer with small local data | Adds adapter registry, compatibility, and rollback complexity | Multi-site perception where local visuals differ |
| Site-specific model | Best local specialization | Fragmented evidence, harder fleet learning, more runtime variants | High-value sites with unique ODD or regulatory constraints |
| Mixture-of-experts / route-gated model | Can route by ODD cell | Routing errors become safety-critical; harder audit | S5 platform with strong ODD classification and policy |
| No promotion; collect more data | Prevents unsafe release | Slower rollout and higher labeling cost | Any slice with insufficient exposure or unresolved hazard regression |

The default for managed-site autonomy is global backbone plus local evidence. Local adapters are attractive for different airports, yards, or warehouses, but the release unit must include the adapter ID, training data, local holdout, runtime package, and rollback artifact.

---

## Statistical Discipline

Site-sliced release evidence should report uncertainty, not only point estimates.

| Evidence type | Minimum discipline |
|---|---|
| Offline metrics | Confidence intervals, class/slice sample counts, unchanged thresholds unless justified |
| Rare hazards | Use scenario replay and targeted sampling; do not rely on natural exposure alone |
| Shadow exposure | Count relevant opportunities, not only hours or kilometers |
| Canary | Compare to baseline/control for the same ODD cell and time window |
| Delayed labels | Sample enough negatives and positives to estimate false-free-space and missed-object risk |
| Monitoring | Record denominator: active hours, routes, sites, map tiles, vehicle cohort, weather bins |
| Waivers | Name owner, expiry, operational mitigation, and revalidation trigger |

Natural exposure is weakest exactly where safety matters most. FOD, personnel intrusion, aircraft proximity, construction changes, and near-conflict behavior need designed replay, targeted mining, and local review because waiting for field frequency can be unsafe and statistically slow.

---

## Semantic Map and ML-SLAM Coupling

For semantic maps and ML-related SLAM, site-sliced release evidence must include map state:

| Map/SLAM artifact | Release-slice dependency |
|---|---|
| Source map | Source-map acceptance package must cover the target tiles and sessions |
| Semantic layer | Class taxonomy and release-state labels must match the consuming model |
| Map hygiene layer | Dynamic residual, static-transient, FOD-candidate, artifact, and unknown-review states must be preserved |
| Calibration | Local sensor calibration and time sync must match training/eval/replay evidence |
| Changed tiles | Runtime approval does not carry across map changes without replay or impact review |
| Pseudo-label exports | Training labels derived from a site map inherit that site's evidence and invalidation rules |

A segmentation model trained from Airport A map-derived labels may be a strong prior for Airport B, but Airport B release still needs local map acceptance, holdout, and ODD-cell evidence. Public road datasets, urban district proxies, or utility/facade benchmarks are pretraining evidence; they are not local release evidence.

---

## Acceptance Checks

- Every production or safety-affecting release has an ODD-cell manifest.
- Aggregate metrics are accompanied by target site, route, weather, object, map-state, and vehicle-kit slices.
- Training, local holdout, replay, source-map tile, and safety-holdout assignments have split IDs and leakage reports for the target ODD cell.
- The release packet names the exact model/runtime/map/calibration/telemetry/taxonomy artifact set.
- Replay scenarios include known incidents, local map changes, rare objects, protected people, and operating procedures for the target cell.
- Shadow/canary evidence covers the same ODD cell requested for approval.
- Delayed-label review samples are tied to the canary cohort and active artifact IDs.
- Monitor thresholds, suppression rules, and rollback triggers are versioned release artifacts.
- A local regression cannot be waived without owner, expiry, mitigation, and revalidation trigger.
- Rollback is tested for the same vehicle kit, runtime, map, calibration, and deployment channel.
- Expansion to a new site, task, vehicle kit, map state, or weather band creates a new release decision.

---

## Failure Modes

| Failure mode | Consequence | Control |
|---|---|---|
| Global mAP approval | Local rare-class or ODD regression reaches operations | Require ODD-cell manifest and local blocker metrics |
| Canary by fleet percentage | Easy cells dominate evidence | Canary by site, route, weather, task, map state, and vehicle kit |
| Shadow data from wrong ODD | Evidence does not support requested release | Gate on matching ODD-cell exposure |
| Local holdout leaks into training | Site evidence overstates performance | Split lineage and leakage checks by site/task |
| Runtime artifact differs from evaluated artifact | Canary does not test what will deploy | Compatibility manifest and package hash |
| Map change not reflected in model release | Model runs against unseen or stale map semantics | Changed-tile replay and map/model compatibility check |
| Waiver becomes permanent | Known local risk remains unresolved | Waiver owner, expiry, mitigation, and review cadence |
| Adapter sprawl | Many local models with weak evidence | Adapter registry, shared backbone policy, per-adapter rollback |
| Incident cannot be scoped | Fleet cannot know which cells are affected | Active artifact IDs in monitoring and incident evidence |

---

## Related Pages

- `mlops-scale-research-scope.md` - MLOps maturity ladder and research backlog.
- `model-governance-release-evidence.md` - registry aliases, release packets, approval, and rollback evidence.
- `mlops-scorecards-and-kpis-by-scale.md` - release-blocking metrics and operating cadence.
- `mlops-reference-architectures-by-scale.md` - S2-S5 release lanes and artifact interfaces.
- `evaluation-platform-replay-gates-by-scale.md` - evaluation manifests, metric specs, replay/runtime gates, shadow/canary evidence, and waiver controls.
- `dataset-split-leakage-controls-by-scale.md` - split manifests, local holdout leakage controls, and training/evaluation split architectures.
- `data-flywheel-airside.md` - active learning, local holdouts, shadow/canary validation, and data mining.
- `../data-platform/replay-scenario-mining-ops.md` - scenario mining and replay package promotion.
- `../ota/perception-slam-artifact-compatibility-matrix.md` - model/map/calibration/runtime compatibility.
- `../../40-runtime-systems/ml-deployment/production-ml-deployment.md` - runtime packaging, shadow, canary, and rollback.
- `../../60-safety-validation/verification-validation/shadow-mode.md` - dual-stack shadow-mode architecture.
- `../../60-safety-validation/runtime-assurance/online-perception-monitoring-odd-enforcement.md` - runtime ODD and perception health monitoring.
- `../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md` - semantic-map release-state and training-export controls.

## Sources

- Waymo, "Safe to Deploy: How We Know The Waymo Driver Is Ready For The Road." https://waymo.com/blog/2025/06/safe-to-deploy
- Waymo, "Waymo's Safety Methodologies and Safety Readiness Determinations." https://arxiv.org/abs/2011.00054
- Waymo, "Building a Credible Case for Safety." https://arxiv.org/abs/2306.01917
- NHTSA, "Automated Driving Systems." https://www.nhtsa.gov/vehicle-manufacturers/automated-driving-systems
- UL Solutions, "UL 4600 Edition 3 Updates Incorporate Autonomous Trucking." https://www.ul.com/news/ul-4600-edition-3-updates-incorporate-autonomous-trucking
- ANSI Webstore, "UL 4600 Ed. 3-2023 - Evaluation of Autonomous Products." https://webstore.ansi.org/standards/ul/ul4600ed2023
- ISO 21448:2022, "Road vehicles - Safety of the intended functionality." https://www.iso.org/standard/77490.html
- ASAM OpenODD. https://www.asam.net/standards/detail/openodd/
- ASAM OpenSCENARIO. https://www.asam.net/standards/detail/openscenario/
