# Airside Map Hygiene Ground Truth Protocol

**Last updated:** 2026-05-23

Map hygiene validation needs ground truth that separates permanent static structure, movable-static assets, current dynamic actors, FOD/hazards, artifacts, and unknown space. Without that separation, a benchmark can reward a cleaner for deleting the very evidence needed for safety review.

## Protocol Role

This page is the V&V and benchmark-exchange companion to the canonical [Airside Map Hygiene Ground Truth Protocol](../../30-autonomy-stack/localization-mapping/maps/airside-map-hygiene-ground-truth-protocol.md). The map-operations page owns the layer vocabulary and reviewer-disposition workflow; this page translates that workflow into validation goals, label fields, ASAM OpenLABEL-style exchange requirements, split rules, and acceptance outputs. Any new label state should be added to the canonical map protocol first, then reflected here only when it changes benchmark evidence or safety acceptance.

| Workflow owner | V&V handoff |
|---|---|
| [Canonical map protocol](../../30-autonomy-stack/localization-mapping/maps/airside-map-hygiene-ground-truth-protocol.md) | layer labels, capture slices, reviewer dispositions, QA gates, benchmark splits |
| [Aggregated-map semantic segmentation](../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md) | semantic labels and confidence/unknown evidence that must be scored against these labels |
| [Map publication gates](../../50-cloud-fleet/map-operations/map-publication-gates-airside-hygiene.md) | release blockers, quarantine outputs, FOD retention, and unknown-region acceptance |
| [Map hygiene monitoring](../../50-cloud-fleet/observability/map-hygiene-operational-monitoring.md) | runtime drift, disagreement, FOD conflict, and semantic QA alerts tied back to ground truth |
| [Regulatory evidence](../safety-case/airside-map-hygiene-regulatory-evidence.md) | safety-case traceability for static preservation, FOD handling, and controlled AGVS test evidence |

## Ground Truth Goals

| Goal | Practical requirement |
|---|---|
| Measure false deletion | labels cover static assets and FOD-like hazards, not only moving actors |
| Measure ghost retention | dynamic and transient traces are labeled in accumulated maps |
| Support release review | labels are linked to map tile, route, stand, source frames, and reviewer |
| Support auditability | raw evidence and rejected/kept decisions can be traced after publication |
| Support transfer analysis | public benchmark classes map to airside-specific classes |

## Label Taxonomy

| Label | Definition | Examples | Map use |
|---|---|---|---|
| permanent_static | approved, persistent site structure | terminal edge, pole, curb, fixed cabinet, stand paint | retain |
| safety_static | static feature tied to rules or margins | stop bar, service-road edge, restricted area | retain and validate semantically |
| movable_static | stationary now but not permanent | cone, chock, barrier, parked GSE, cart | overlay or review |
| dynamic_actor | moving during capture or operationally transient | aircraft, tug, bus, worker, vehicle | remove from permanent map |
| fod_hazard | debris or small unsafe object | bolt, strap, rubber, plastic, tool | hazard/review layer |
| artifact | sensor or registration artifact | multipath, rain/spray, ghost, packet issue | remove or mark diagnostic |
| unknown | insufficient evidence | occluded, sparse, ambiguous, unobserved | quarantine or review |

## Capture Plan

| Capture | Purpose | Minimum slices |
|---|---|---|
| quiet survey | high-confidence static reference | low traffic, slow pass, full route/stand coverage |
| busy operation | dynamic and movable-static clutter | aircraft present, GSE staged, personnel/vehicles nearby |
| change pair | distinguish moved assets from permanent structure | object present and absent across sessions |
| FOD placement | small-hazard retention | controlled articles by size/material/location |
| adverse-airside holdout | local do-not-delete retention | dust, de-icing mist, steam/exhaust plume, glycol film, wet-apron multipath, retroreflector bloom where in ODD |
| sparse/degraded | weak-observation evidence | range bins, beam dropout, night/wet if in ODD |
| hard negative | false alert and false deletion control | markings, cracks, drains, rubber deposits, shadows |

## Annotation Requirements

| Field | Requirement |
|---|---|
| object_id | stable ID across frames, map layers, and review exports |
| label_class | one taxonomy class plus optional subclass |
| geometry | 3D cuboid, polygon, point cluster, semantic mask, or map cell set |
| coordinate_system | map frame plus sensor frame transforms where labels originate |
| temporal_extent | first/last observation, session ID, permanence evidence |
| source_evidence | raw frame IDs, image crops, LiDAR cluster IDs, reviewer notes |
| confidence | label confidence and reason for unknown/review |
| disposition | retain, remove, overlay, hazard alert, quarantine, or ignore |

### Removal-Handoff Evidence Fields

Benchmark exchange should preserve the same handoff fields required by the canonical map protocol so validation can score not only whether a point was removed, but why it was removed and which downstream consumers may use it.

| Field | Validation use |
|---|---|
| `release_state_alias` | Scores `permanent_static`, `dynamic_residual`, `movable_static`, `static_transient`, `fod_candidate`, `artifact`, and `unknown_review` confusion separately from semantic mIoU |
| `reason_code` | Separates moving ghosts, stationary people, movable assets, FOD candidates, artifacts, and static-wrong demotions in failure analysis |
| `source_evidence_ref` | Lets auditors replay raw frames, pose quality, calibration, and reviewer evidence for safety-critical removals |
| `temporal_evidence` | Supports K-of-N, first/last-seen, absence-vote, and TTL acceptance tests |
| `policy_evidence` | Preserves zone, work-order, asset-registry, inspection-ticket, and waiver context |
| `downstream_permission` | Verifies that review-only, soft-context, training-positive, training-negative, and ignore-mask states are not mixed |

ASAM OpenLABEL is a good exchange format because it supports multi-sensor labels, coordinate systems, object annotations, scenario tags, and extensible taxonomies. Use an airport-specific ontology for classes that public road datasets do not cover.

## QA And Split Rules

| Rule | Rationale |
|---|---|
| Double-label safety-critical static assets and FOD. | false deletion claims need high label quality |
| Keep acceptance zones separate from tuning zones. | prevents threshold overfit |
| Label unknown explicitly. | unobserved space must not become assumed free space |
| Preserve reviewer disagreement. | disagreement identifies taxonomy or evidence gaps |
| Include site-specific hard negatives. | public datasets miss local pavement, lighting, and equipment |
| Version labels with map and cleaner releases. | changing ground truth changes acceptance history |
| Lock the do-not-delete/adverse-airside holdout. | proxy, synthetic, and public samples can guide test design but cannot enter or replace the local acceptance split |

## Acceptance Outputs

| Output | Consumer |
|---|---|
| labeled static and dynamic point sets | map-cleaning metric pipeline |
| FOD/hazard ground truth | safety case and FOD workflow |
| movable-static inventory | map operations lifecycle |
| unknown/quarantine polygons | publication gate |
| annotation manifest | audit, replay, and regression |
| benchmark split manifest | repeatable release testing |
| local holdout coverage report | publication gate, safety case, and ODD restriction decisions |

## Sources

- ASAM OpenLABEL: https://www.asam.net/standards/detail/openlabel/
- FOD-A paper: https://arxiv.org/abs/2110.03072
- FOD-A repository: https://github.com/FOD-UNOmaha/FOD-data
- AIT Apron Dataset: https://publications.ait.ac.at/de/datasets/apron-dataset/
- AIT Apron repository: https://github.com/apronai/apron-dataset
- KTH Dynamic Map Benchmark: https://kth-rpl.github.io/DynamicMap_Benchmark/
- FAA Foreign Object Debris Program: https://www.faa.gov/airports/airport_safety/fod
- FAA AC 150/5210-24A, Airport FOD Management: https://www.faa.gov/airports/resources/advisory_circulars/index.cfm/go/document.current/documentNumber/150_5210-24
- FAA AC 150/5220-24, FOD Detection Equipment: https://www.faa.gov/regulations_policies/advisory_circulars/index.cfm/go/document.information/documentNumber/150_5220-24
- NOAA/NWS Aviation Weather Center Data API: https://aviationweather.gov/data/api/
- Local context: [Airside Dynamic Map Cleaning Benchmark](airside-dynamic-map-cleaning-benchmark.md)
- Local context: [Map Publication Gates for Airside Hygiene](../../50-cloud-fleet/map-operations/map-publication-gates-airside-hygiene.md)
