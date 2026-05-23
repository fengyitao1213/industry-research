# Airport-FOD3S Synthetic FOD Data Engine

**Last updated:** 2026-05-23

Airport-FOD3S is best treated as a focused synthetic-data engine for foreign object debris (FOD), not just another dataset row. Its value is the repeatable workflow: collect real airport-scene and FOD exemplars, generate rare appearances, insert objects with physically plausible size, seam, and style handling, then prove that the augmented data improves small-object detection without replacing real airport validation.

**Related pages:** [Synthetic Data Generation](synthetic-data-generation.md), [Datasets, Benchmarks, and Data Engines](data-engines-datasets.md), [Data Catalog, Lineage, and Quality Operations](data-catalog-lineage-quality-ops.md), [Data Flywheel](../mlops/data-flywheel-airside.md), [Airside FOD Synthetic and Multimodal Benchmarks](../../30-autonomy-stack/perception/datasets-benchmarks/airside-fod-synthetic-multimodal-benchmarks.md), [Weather Robustness Datasets](../../30-autonomy-stack/perception/datasets-benchmarks/weather-robustness-datasets.md)

---

## What It Covers

| Layer | Role |
|---|---|
| Real seed data | FOD-A-style runway/taxiway imagery, local empty-surface negatives, and measured FOD exemplars. |
| Synthetic generation | Diffusion/GAN-style scene and object generation for rare FOD types, lighting, and weather contexts. |
| Three-stage insertion | Size transformation, seamless blending, and style transfer so pasted FOD does not create obvious shortcuts. |
| Detector loop | Real-only, synthetic-only, and mixed-training ablations with AP-small, recall, and false-clear reporting. |
| Data product controls | Manifests, lineage, quality gates, rejection logs, and validation slices before any dataset is approved for training. |

The page owns the data-engine workflow. Dataset descriptions remain in [Airside FOD Synthetic and Multimodal Benchmarks](../../30-autonomy-stack/perception/datasets-benchmarks/airside-fod-synthetic-multimodal-benchmarks.md).

---

## Why It Matters

FOD is a rare, safety-critical small-object class. Public road datasets do not provide the runway/taxiway surfaces, object scale, pavement texture, or airport operating context needed for FOD detection. Real airport FOD collection is constrained by safety and access rules, and small debris can be hard to label at deployment resolution.

Airport-FOD3S addresses a specific data bottleneck: it creates synthetic FOD composites that preserve object scale, blend boundaries, and style consistency. The 2025 Sensors paper reports that its three-stage blending method outperformed baseline blending metrics, reaching SSIM 0.99 and PSNR 45 dB, and that YOLOv11 with the SimD strategy trained on augmented data achieved 86.95% mAP on the paper's benchmark. Those results are useful as data-engine evidence, not as production acceptance evidence.

---

## Source-Backed Inputs

| Input source | Use in the data engine | Caveat |
|---|---|---|
| FOD-A | Public runway/taxiway RGB seed data with bounding boxes plus light-level and weather categories. | Strongest open baseline, but still not a target-airport holdout. |
| Airport-FOD3S | Synthetic FOD generation, physical-size transformation, seam processing, style transfer, and detection-driven evaluation. | Published as a framework and experiment, not a turnkey fleet data product. |
| RDD5000 | Visible/infrared runway-region scenes from a DJI drone for multimodal runway visibility stress. | Salient runway/region detection, not FOD object labels by itself. |
| DualFOD / FOD-UAS | Synchronized RGB/thermal UAS FOD detection with supervised RGB detection, unsupervised thermal anomaly extraction, and decision-level fusion. | Useful modality evidence; dataset access and site transfer need confirmation. |
| SemanticSpray++ | Wet-surface camera/LiDAR/radar proxy with labels across modalities. | Road-spray proxy only; does not model runway FOD. |
| LIDAROC | LiDAR cover-contamination dataset with clean and realistically contaminated samples, including dust subsets. | Sensor-cover contamination proxy, not airborne jet-blast dust. |
| RADIATE and CMHT | Public multimodal adverse-weather driving proxies for radar/camera/LiDAR/IR fusion. | Road-scene weather data; not an airside obscurant dataset. |

---

## Data-Engine Pipeline

1. **Scope the real distribution.** Define airport surface zones, camera geometry, resolution, expected FOD size range, debris categories, lighting, wet/dry state, and hard negatives before generating images.
2. **Build a measured FOD object library.** Store object masks, dimensions, material tags, color/thermal properties if available, and permissible placement regions. Do not synthesize unknown physical sizes without a provenance flag.
3. **Generate or select airport backgrounds.** Use real empty surfaces where possible, then add synthetic airport-scene variants only when the target slice is missing.
4. **Apply Airport-FOD3S insertion.** Transform object scale by placement region, blend seams, and harmonize style so detectors cannot exploit paste artifacts.
5. **Write labels and manifests together.** Every synthetic box should carry source object ID, background ID, placement transform, generator version, rejection status, and whether the sample is real, synthetic, or mixed.
6. **Run quality rejection.** Reject images with impossible scale, floating objects, clipped masks, visible seams, inconsistent shadows, broken perspective, or labels that do not match the rendered pixels.
7. **Evaluate with ablations.** Compare real-only, synthetic-only, and mixed training against a real-only validation set and a locked target-airport holdout.
8. **Promote as a data product.** Publish only when lineage, quality checks, slice reports, and downstream training results are attached to the catalog entry.

---

## Outputs

| Output | Minimum contents |
|---|---|
| Synthetic frame set | Images or frames partitioned by surface, lighting, weather, object type, size, and real/synthetic state. |
| Label package | Bounding boxes, optional masks, object dimensions where known, and ground-plane position if calibrated. |
| Manifest | Source dataset IDs, generator version, blending parameters, random seed, object library version, camera geometry, and license/access notes. |
| Rejection log | Failed samples with reason codes such as seam artifact, scale mismatch, impossible placement, or label mismatch. |
| Validation report | Real-only versus mixed-training results, AP-small, recall at fixed false positives, false-clear rate, and slice-level deltas. |
| Safety handoff | Explicit statement that synthetic data supports training only; target-airport real holdouts remain required for safety evidence. |

---

## Evaluation Signals

| Signal | What to check |
|---|---|
| Image realism | SSIM/PSNR-style metrics can catch severe blending artifacts, but they do not prove operational transfer. |
| Scale realism | Synthetic FOD pixel size should match measured camera geometry and expected object dimensions. |
| Small-object detection | AP-small, recall by object size, and range-sliced recall matter more than headline mAP. |
| False-clear risk | Count cases where the model reports the path clear while hazardous FOD remains. |
| Hard-negative burden | Score false positives on rubber deposits, markings, cracks, drains, lights, cones, chocks, puddles, and normal hardware. |
| Modality benefit | For RGB/thermal or RGB/IR extensions, report RGB-only, thermal/IR-only, and fused results separately. |
| Synthetic dependency | Mixed-training gains must persist on real-only validation and the target-airport holdout. |

---

## Failure Modes

- The model learns synthetic paste artifacts rather than FOD shape, material, or context.
- Object scale is wrong for the camera height or distance, inflating detector confidence on unrealistic examples.
- Synthetic positives crowd out real hard negatives, raising false alarms on markings, rubber, lights, puddles, and apron clutter.
- Synthetic weather or lighting creates smooth domain-randomization diversity while missing real jet-blast dust, de-icing mist, steam, glycol residue, and wet-apron reflections.
- UAS or overhead imagery transfers poorly to vehicle-mounted cameras without a separate viewpoint ablation.
- RGB/thermal or RGB/IR pairs may be unaligned; late fusion must tolerate calibration and field-of-view mismatch.
- A high augmented-benchmark mAP can mask poor recall on screws, washers, cable ties, dark debris, or partly occluded FOD.
- Synthetic frames are accidentally mixed into acceptance holdouts, invalidating safety evidence.

---

## AV Relevance and Domain Fit

| Domain | Fit | Transfer note |
|---|---|---|
| Airport runway/taxiway | Strong | Directly targets FOD on airport surfaces, but still requires site-specific real validation. |
| Airport apron | Moderate | Useful for rare debris and hard negatives, but apron clutter, aircraft, GSE, jet bridges, and service equipment need local data. |
| Road AV | Moderate | Transfers to small road-debris augmentation and unknown-obstacle recall, with different surfaces and traffic context. |
| Yard, port, warehouse, and campus autonomy | Moderate | Useful for dropped cargo, straps, tools, and low obstacles when local object libraries are available. |
| Mining, construction, and agriculture | Conditional | Debris analogs transfer, but dust, terrain, object scale, and sensor placement differ substantially. |
| Indoor inspection and maintenance | Conditional | FOD-S2R-style lessons transfer to confined inspection, not to open runway clearance without new validation. |

---

## Implementation Notes

1. Treat `airport_fod3s_synth_<date>` as a derived data product with immutable source snapshots, not as a loose folder of generated images.
2. Keep `real`, `synthetic`, and `mixed` partitions explicit through DVC/Iceberg manifests, training configs, metrics tables, and reports.
3. Attach each generated sample to object and background provenance. If a generated object has no real exemplar, mark it as generated-only.
4. Require a real-only validation set before training starts and a target-airport holdout before safety claims.
5. Make hard-negative mining part of the same data engine. Empty runway and apron images are as important as synthetic positives.
6. Use active learning triggers from the fleet to decide which synthetic slices to expand: low-confidence FOD, near-miss clearance events, missed small objects, or high false-alarm zones.
7. If public sources do not cover de-icing mist, glycol film, wet-apron multipath, steam, or jet-blast dust, record the gap and route it to local collection instead of inventing synthetic evidence.

---

## Integration With Existing Corpus

| Existing page | How to use it |
|---|---|
| [Airside FOD Synthetic and Multimodal Benchmarks](../../30-autonomy-stack/perception/datasets-benchmarks/airside-fod-synthetic-multimodal-benchmarks.md) | Dataset and benchmark catalog for FOD-A, Airport-FOD3S, IVFOD, RDD5000, DualFOD/FOD-UAS, and FOD-S2R. |
| [FOD and Airport Apron Detection Datasets](../../30-autonomy-stack/perception/datasets-benchmarks/fod-and-airport-apron-detection-datasets.md) | Baseline public FOD/apron dataset routing and acceptance caveats. |
| [Weather Robustness Datasets](../../30-autonomy-stack/perception/datasets-benchmarks/weather-robustness-datasets.md) | Public proxy datasets for rain, spray, fog, snow, night, thermal/radar fusion, and LiDAR cover contamination. |
| [Data Flywheel](../mlops/data-flywheel-airside.md) | Trigger-based collection, auto-labeling, active learning, model training, and deployment validation loop. |
| [Data Catalog, Lineage, and Quality Operations](data-catalog-lineage-quality-ops.md) | Data product promotion states, lineage, quality checks, owner reviews, and release evidence controls. |

---

## Sources

- [FOD-A GitHub repository](https://github.com/FOD-UNOmaha/FOD-data)
- [FOD-A arXiv paper](https://arxiv.org/abs/2110.03072)
- [Airport-FOD3S Sensors paper](https://www.mdpi.com/1424-8220/25/15/4565)
- [RDD5000 visible-infrared runway detection paper](https://www.mdpi.com/2072-4292/17/4/669)
- [DualFOD / FOD-UAS Drones paper](https://www.mdpi.com/2504-446X/10/3/225)
- [SemanticSpray++ project page](https://semantic-spray-dataset.github.io/)
- [LIDAROC 20m Zenodo dataset](https://zenodo.org/doi/10.5281/zenodo.12800632)
- [RADIATE project page](https://pro.hw.ac.uk/radiate/)
- [CMHT Autonomous Dataset article](https://www.sciencedirect.com/science/article/pii/S2352340925002847)
