# FOD And Airport Apron Detection Datasets

**Last updated:** 2026-05-23

Foreign object debris and airport-apron datasets are needed because public-road perception datasets rarely contain the small debris, pavement textures, service equipment, aircraft-adjacent occlusions, and airport operating context that determine airside perception risk. This page focuses on datasets and benchmark fit, not FOD operations procedures.

**Related pages:** [Airside FOD synthetic and multimodal benchmarks](airside-fod-synthetic-multimodal-benchmarks.md), [Airport-FOD3S synthetic FOD data engine](../../../50-cloud-fleet/data-platform/airport-fod3s-synthetic-data.md), [FOD perception validation](../../../60-safety-validation/verification-validation/robustness/fod-perception-validation.md)

---

## Scope

| Dataset | Scope | Best use |
|---|---|---|
| FOD-A | Image dataset of foreign object debris on runway or taxiway backgrounds | FOD object detection and environmental-slice evaluation. |
| IVFOD / dual-light FOD data | Infrared and visible-light small-scale FOD imagery from a dual-light camera setup | Visible/infrared small-target detection research. |
| Airport-FOD3S | Synthetic FOD generation, blending, and detector evaluation framework | Rare FOD augmentation and data-engine construction. |
| RDD5000 and DualFOD / FOD-UAS | Visible/infrared or RGB/thermal runway-style imagery | Multimodal runway visibility and thermal FOD recovery studies. |
| Apron Dataset | Airport-apron logistics images with bounding boxes, object categories, and environmental metadata | Apron object detection, logistics scene understanding, and robustness by environmental parameter. |

These datasets help fill an airside benchmark gap, but none alone is sufficient for final airport autonomy acceptance. A deployment program still needs site-specific data for pavement, lighting, camera height, FOD types, GSE, aircraft mix, and operating procedures.

---

## Evidence Boundary

Treat every result from these resources as either direct public FOD/apron evidence or proxy evidence before using it in a safety argument:

| Evidence class | Public inputs | Supports | Does not support |
|---|---|---|---|
| Direct public FOD screening | FOD-A, IVFOD, DualFOD/FOD-UAS, Airport-FOD3S real seed data | Detector pretraining, object-size slicing, wet/dry or light-level screening, and rare-FOD augmentation design. | Target-airport clearance, 3D vehicle localization, or closed-loop operational response without local holdout and placed-object tests. |
| Apron logistics proxy | Apron Dataset and airport-surface object datasets | Detecting GSE, aircraft-adjacent clutter, personnel-adjacent objects, and environmental robustness on apron imagery. | Small runway FOD detection or final debris-clearance claims by itself. |
| Synthetic/data-engine proxy | Airport-FOD3S and FOD-S2R-style sim-to-real workflows | Long-tail generation, augmentation ablations, lineage design, and negative-control experiments. | Acceptance evidence unless gains survive a locked real-only target-airport holdout. |
| Adverse-condition proxy | Weather datasets such as SemanticSpray++, RADIATE, Seeing Through Fog/DENSE, DSERT-RoLL, CMHT, and LIDAROC | Sensor degradation patterns, spray/fog/rain/snow stress tests, radar-primary fallback design, and LiDAR cover-contamination checks. | Direct validation of jet-blast dust, de-icing mist, glycol film, steam, wet-apron multipath, or retroreflector bloom on the target apron. |

Public FOD, apron, RGB/IR, RGB/thermal, and synthetic resources are therefore best used for pretraining, modality screening, regression tests, and test design. Final airside clearance claims still require target-airport evidence with local debris, pavement, markings, lighting, weather, aircraft adjacency, GSE, operating procedures, raw sensor provenance, reviewer disposition, and alert or inspection closure.

---

## What They Measure

| Measurement question | Relevant dataset |
|---|---|
| Can the detector find common FOD categories against runway/taxiway pavement? | FOD-A |
| Does performance change by light level or wet/dry condition? | FOD-A |
| Can infrared and visible sensors improve small FOD detection? | IVFOD / dual-light FOD work |
| Can synthetic FOD improve rare-object recall without corrupting validation evidence? | Airport-FOD3S data-engine workflow |
| Can RGB/thermal or RGB/IR sensing recover low-contrast runway hazards? | DualFOD/FOD-UAS and RDD5000 |
| Can apron logistics objects be detected under environmental variation? | Apron Dataset |
| Can an airside perception system distinguish debris from legitimate equipment? | Use FOD and apron datasets together, then validate locally. |

The key benchmark challenge is scale. FOD can be small, low contrast, reflective, partially occluded, or visually similar to pavement markings and rubber deposits.

---

## Sensors And Labels

| Dataset | Sensors | Labels and metadata |
|---|---|---|
| FOD-A | RGB imagery | Bounding boxes for FOD objects; light-level categories; dry/wet weather categories; Pascal VOC format is recommended for experimentation. |
| IVFOD / dual-light FOD | Visible and infrared cameras | FOD detection labels for small-target experiments; reported work uses infrared-visible fusion and YOLOv5-derived models. |
| Airport-FOD3S | RGB FOD images plus synthesized airport-scene composites | Detection labels from generated composites; size transformation, seamless blending, and style transfer metadata should be preserved by a data engine. |
| RDD5000 | DJI drone visible and infrared cameras | Runway-region / salient-object style labels, useful for runway ROI and alignment stress rather than FOD boxes. |
| DualFOD / FOD-UAS | UAS RGB and thermal imagery | RGB detector outputs, thermal anomaly outputs, and decision-level fused FOD detections. |
| Apron Dataset | Image data for airport apron logistics | Bounding boxes, object categories, and meta parameters for robustness against environmental influences. |

FOD-A reports 31 object categories and more than 30,000 annotation instances in the arXiv abstract. The GitHub release provides original and Pascal VOC versions, with tools for resizing annotations and converting formats.

---

## Metrics And Tasks

| Task | Metrics |
|---|---|
| 2D FOD detection | mAP by IoU threshold, AP-small, recall at fixed false positives per image, miss rate by object size |
| Small-object localization | Center error, box IoU, distance-to-lane/path threshold, minimum detectable size by range |
| Light/weather slicing | AP and recall by bright/dim/dark and dry/wet labels |
| Visible/IR fusion | Per-modality AP, fusion AP, false positives on hot pavement/reflections |
| Apron logistics detection | mAP by object class, class confusion, recall near aircraft and service areas |
| Safety-oriented scoring | Hazard-weighted miss rate, false-clear rate, time-to-detect, duplicate/track stability |

For airside autonomy, AP is not enough. The acceptance metric must include false-clear risk: the system says the path is clear while a hazardous object remains in the operating corridor.

---

## Strengths

- FOD-A is public and directly targeted at airport FOD detection.
- FOD-A includes environmental annotations, allowing light and wet/dry performance slicing.
- The Pascal VOC release and conversion tools make detector benchmarking straightforward.
- Dual-light, RGB/IR, and RGB/thermal FOD research highlight the value of non-visible sensing for small or low-contrast FOD targets.
- Airport-FOD3S gives a source-backed path for building a synthetic FOD data product while keeping real-only validation separate.
- The Apron Dataset covers airport-apron logistics rather than only runway debris.
- Apron environmental metadata supports robustness analysis under operating variation.

---

## Gaps And Risks

- FOD-A backgrounds are runway/taxiway oriented; apron clutter and gate-area operations may differ.
- Public FOD datasets may not represent local debris distributions such as screws, cable ties, plastic wrap, luggage tags, straps, tools, and aircraft-specific items.
- 2D bounding boxes do not prove 3D localization accuracy, ground-plane contact, or planner relevance.
- Infrared-visible and RGB/thermal research may not transfer to the exact camera baseline, mounting height, or thermal environment of a vehicle.
- Synthetic FOD images can teach paste artifacts, wrong scale, or unrealistic placements if lineage and quality gates are weak.
- Apron object categories are broader logistics objects, not necessarily small FOD.
- Dataset images do not replace live tests with glare, rain, nighttime apron lighting, rubber deposits, de-icing residue, jet-blast dust, steam, glycol film, wet-apron multipath, retroreflector bloom, and moving GSE.
- A visually clean benchmark frame is not evidence that a downstream map cleaner, denoiser, or semantic filter preserved all FOD-like hazards; rejected candidates need raw evidence and reviewer disposition.

---

## AV And Airside Fit

| Airside need | Fit | Notes |
|---|---|---|
| FOD detector pretraining | Strong | FOD-A is the most direct public starting point. |
| Environmental slice testing | Moderate | FOD-A light and wet/dry annotations are useful but coarse. |
| Synthetic FOD data engine | Moderate | Airport-FOD3S supports rare-object augmentation, but real target-airport holdouts remain mandatory. |
| Visible/IR or RGB/thermal sensor trade study | Moderate | IVFOD, RDD5000, and DualFOD/FOD-UAS support early modality selection. |
| Apron object detection | Strong for logistics | Apron Dataset is closer to airport operations than road datasets. |
| Full autonomous clearance claim | Insufficient alone | Requires site-specific collection, physical test articles, and operational acceptance rules. |

Recommended evidence flow: pretrain or screen on FOD-A, expand rare examples with the [Airport-FOD3S data engine](../../../50-cloud-fleet/data-platform/airport-fod3s-synthetic-data.md), test sensor choices with visible/IR and RGB/thermal small-target data, validate apron-object recognition on the Apron Dataset, then run a target-airport FOD and apron hazard campaign.

---

## Implementation And Evaluation Notes

1. Split results by object size, pavement type, light condition, wet/dry state, and range where range can be estimated.
2. Preserve original-resolution evaluation for small objects. Training on resized images can hide detection limits.
3. Report false positives on markings, rubber deposits, cracks, reflections, shadows, leaves, bolts embedded in pavement, and normal airport hardware.
4. Convert detector outputs into a ground-plane hazard region and evaluate whether the planner would receive a usable obstacle.
5. Use hard-negative apron samples without FOD to tune false-alarm rates before operational trials.
6. Build a target-domain holdout set with site-specific debris and equipment, and keep it locked for acceptance testing.
7. For multimodal systems, score RGB-only, IR-only, and fused outputs to prove fusion benefit rather than assuming it.

---

## Sources

- [FOD-A GitHub repository](https://github.com/FOD-UNOmaha/FOD-data)
- [FOD-A arXiv paper](https://arxiv.org/abs/2110.03072)
- [FAA AC 150/5210-24A Airport Foreign Object Debris Management](https://www.faa.gov/airports/resources/advisory_circulars/index.cfm/go/document.current/documentNumber/150_5210-24)
- [FAA AC 150/5200-30D Airport Field Condition Assessments and Winter Operations Safety](https://www.faa.gov/airports/resources/advisory_circulars/index.cfm/go/document.current/documentNumber/150_5200-30)
- [FAA AC 150/5300-14D Design of Aircraft Deicing Facilities](https://www.faa.gov/airports/resources/advisory_circulars/index.cfm/go/document.current/documentNumber/150_5300-14)
- [Small-Scale Foreign Object Debris Detection Using Deep Learning and Dual Light Modes](https://www.mdpi.com/2076-3417/14/5/2162)
- [Airport-FOD3S Sensors paper](https://www.mdpi.com/1424-8220/25/15/4565)
- [RDD5000 RGB-IR runway detection paper](https://www.mdpi.com/2072-4292/17/4/669)
- [DualFOD / FOD-UAS Drones paper](https://www.mdpi.com/2504-446X/10/3/225)
- [AIT Apron Dataset record](https://publications.ait.ac.at/de/datasets/apron-dataset/)
- [Apron Dataset GitHub repository](https://github.com/apronai/apron-dataset)
- [LIDAROC Zenodo dataset](https://zenodo.org/records/12800039)
- [SemanticSpray++ project page](https://semantic-spray-dataset.github.io/)
- [RADIATE dataset documentation](https://pro.hw.ac.uk/radiate/doc/dataset/)
