# EmbodiedScan and MMScan Embodied 3D Benchmarks

**Last updated:** 2026-05-23

EmbodiedScan and MMScan are 2024 embodied 3D perception benchmarks from the OpenRobotLab/Shanghai AI Laboratory ecosystem. They are useful for AV research because they test egocentric RGB-D scene understanding, 3D boxes, semantic occupancy, visual grounding, and 3D question answering in real scanned indoor environments rather than only frame-level road perception.

**Related pages:** [open-vocabulary and zero-shot detection](../overview/open-vocab-detection.md), [Open-Vocabulary Panoptic Occupancy](../methods/open-vocabulary-panoptic-occupancy.md), [OVAD/OVODA open-vocabulary 3D attributes](../methods/ovad-ovoda-open-vocab-3d-attributes.md), [spatial foundation models for airport robotics](../../vla-vlm/spatial-foundation-models-airport.md), [VLM/VLA reliability benchmarks](../../vla-vlm/vlm-vla-reliability-benchmarks.md), [embodied AI crossover](../../../10-knowledge-base/robotics/embodied-ai-crossover.md), [perception coverage audit](../overview/coverage-audit-2026.md)

---

## Scope

| Item | EmbodiedScan | MMScan |
|---|---|---|
| Primary role | Multimodal egocentric 3D perception dataset and benchmark | Hierarchical grounded language dataset and benchmark for 3D scenes |
| Venue status | CVPR 2024 paper, official project page, and official repository | NeurIPS 2024 Datasets and Benchmarks paper, project page, OpenReview record, and shared official repository |
| Scene type | Real scanned indoor scenes built from ScanNet, 3RScan, and Matterport3D raw data | Real scanned indoor scenes with object-level and region-level grounded language annotations |
| Main inputs | RGB-D sequences, camera poses, 3D scene geometry, and text prompts | 3D scenes, object/region metadata, captions, grounding prompts, and VQA-style language |
| Main outputs | 3D-oriented boxes, dense semantic occupancy, language grounding, and baseline model predictions | Grounded captions, visual grounding samples, 3D question-answering samples, and 3D-LLM training/evaluation data |
| AV relevance | Tests spatial scene understanding and language grounding beyond closed-set boxes | Tests whether language-conditioned models remain grounded in 3D structure and object/region relationships |

This page treats EmbodiedScan/MMScan as benchmark and data primitives. It does not replace driving datasets such as nuScenes, Waymo, NAVSIM, Bench2Drive, or airside FOD datasets, and it does not by itself validate a road or airside perception stack.

---

## What They Measure

| Capability | Why it matters |
|---|---|
| Egocentric 3D perception | Embodied agents observe from moving first-person viewpoints, closer to robot and vehicle operation than static global scans. |
| Multi-view RGB-D fusion | AV and robot stacks often need to fuse repeated partial views into a stable 3D scene state. |
| 3D-oriented object boxes | Oriented boxes expose pose, size, and support relationships that 2D image labels hide. |
| Dense semantic occupancy | Occupancy-style labels connect perception to planning-facing free/occupied/semantic representations. |
| Language-grounded 3D understanding | VLM/VLA systems need to bind instructions and answers to actual objects, regions, and geometry. |
| Region-level reasoning | Many operational tasks depend on spaces and affordances, not only object instances. |

EmbodiedScan's headline scale in the CVPR paper includes more than 5k scans, 1M egocentric RGB-D views, 1M language prompts, 160k 3D-oriented boxes over 760 categories, and dense semantic occupancy with 80 common categories. MMScan adds hierarchical grounded language annotations: the NeurIPS paper reports 1.4M meta-annotated captions over 109k objects and 7.7k regions plus more than 3.04M benchmark samples, while the project page describes the continuing release as 6.9M hierarchical grounded annotations.

---

## Inputs And Outputs

| Asset | Use |
|---|---|
| RGB-D sequences | Train and test multi-view perception, depth-aware spatial reasoning, and sensor-fusion baselines. |
| Camera poses and scan geometry | Build metric 3D scene representations, align repeated observations, and evaluate view-invariant grounding. |
| 3D boxes and categories | Evaluate object detection, pose, size, and category grounding in cluttered indoor scenes. |
| Dense semantic occupancy | Compare voxel/occupancy-style scene understanding with object-box-only perception. |
| Object and region captions | Train and test 3D language grounding, attribute reasoning, and scene summaries. |
| Grounding and VQA samples | Evaluate 3D visual grounding, question answering, and hallucination-prone VLM behavior. |

The official repository provides dataset organization, training/evaluation configs, baselines, visualization tools, and benchmark submission utilities. The repo notes that the dataset depends on raw data from ScanNet, 3RScan, and Matterport3D, so downstream users must review those upstream licenses and access requirements before reuse.

---

## Tasks And Metrics

| Task | Evidence to preserve |
|---|---|
| Multi-view 3D detection | AP/AR at configured IoU thresholds, with the benchmark split and data version stated. |
| Continuous 3D detection | Sequence-aware detection behavior from repeated egocentric observations. |
| Multi-view 3D visual grounding | Whether a text prompt localizes the correct 3D object or region. |
| Dense semantic occupancy | Voxel-level semantic occupancy quality and label taxonomy assumptions. |
| 3D question answering | Correctness, grounding, and abstention behavior for spatial and attribute questions. |
| 3D-LLM training/evaluation | Whether language answers remain tied to scan geometry instead of text priors. |

Report EmbodiedScan and MMScan results with dataset version, split, input modality, prompt type, and benchmark evaluator. Do not mix indoor embodied scores with road-driving AP, planning score, or collision metrics.

---

## Best Use

Use these benchmarks to:

- test 3D spatial grounding for VLM/VLA and robot foundation models;
- evaluate whether a model can connect language to object boxes, regions, and occupancy;
- compare RGB-D multi-view fusion against single-frame perception;
- design annotation schemas for region, object, attribute, relation, and occupancy labels;
- pre-screen spatial-reasoning models before collecting expensive site-specific robot or AV data;
- build negative controls for hallucination, language-prior leakage, and ungrounded explanations.

They are especially useful as a bridge between robotics embodied AI and AV scene-understanding research. For safety-critical vehicle use, they should feed representation and benchmark design, not serve as deployment evidence.

---

## AV Relevance

| AV need | Transfer from EmbodiedScan/MMScan |
|---|---|
| Spatial VLM/VLA evaluation | Grounding prompts to 3D objects and regions is directly relevant to VLM co-pilots and instruction-following systems. |
| Occupancy and scene memory | Dense semantic occupancy and scan-level scene state are useful analogues for persistent world models. |
| Long-tail annotation | Object/region captions and attributes suggest schemas for rare equipment, temporary objects, and task-specific labels. |
| Data-engine design | Human-corrected VLM initialization shows how foundation models can accelerate annotation while still needing review. |
| Runtime assurance | Text-only, wrong-context, and corrupted-input controls can be adapted from VLM reliability benchmarks to detect hallucination. |

The main transfer value is evaluation structure: metric 3D grounding plus language QA. The physical domain, sensor rigs, object taxonomy, and dynamics differ from road and managed-site AVs.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Indoor robots and mobile manipulators | Strong | Directly targets embodied indoor 3D scene understanding, language grounding, and RGB-D perception. |
| Warehouses and factories | Moderate to strong | Spatial region/object reasoning transfers to racks, pallets, workcells, and loading areas, but local industrial classes need new labels. |
| Road AV | Limited to moderate | Useful for VLM grounding and occupancy-representation design; weak for road geometry, traffic actors, weather, and speed. |
| Airside AV | Moderate benchmark-design proxy | Helpful for spatial language, object-region schemas, and hallucination tests; missing aircraft, GSE, FOD, ramp markings, outdoor lighting, wet apron, jet blast, and airport rules. |
| Yards, ports, mines, and construction | Moderate proxy | Object-region grounding transfers conceptually, but scale, outdoor weather, dust, heavy machines, and terrain require local data. |
| Delivery robots and campuses | Moderate | Egocentric RGB-D and language grounding are relevant, but outdoor clutter and public-space behavior need separate validation. |

Do not treat indoor embodied benchmark performance as proof of AV readiness. Use it to choose models, label schemas, and evaluation controls before target-domain data collection.

---

## Assumptions And Failure Modes

| Assumption | Failure mode |
|---|---|
| RGB-D sensors are available and calibrated | Camera/depth misalignment, reflective surfaces, missing depth, and pose drift can corrupt the 3D scene state. |
| Indoor scan taxonomies cover the target objects | AV-specific objects such as cones, chocks, hoses, GSE, aircraft parts, road users, and machinery may be absent or mislabeled. |
| Language annotations are grounded | VLM-initialized captions can introduce plausible but wrong attributes or relationships if human correction misses cases. |
| Static scans approximate operating scenes | Vehicles, workers, mobile equipment, weather, lighting changes, and dynamic hazards are underrepresented. |
| Benchmark prompts match deployment questions | Operational prompts may require rules, maps, temporal state, permissions, or safety policy not present in the dataset. |

For AV use, pair these benchmarks with domain-specific logs, negative controls, and independent safety monitors. A model should be allowed to abstain when geometry or context is insufficient.

---

## Implementation Notes

1. Keep EmbodiedScan and MMScan as benchmark references, not as direct training substitutes for road, airside, or industrial AV datasets.
2. Version the source scan dataset, released annotations, train/validation/test split, prompt set, and evaluator together.
3. Preserve camera poses, depth validity masks, object/region IDs, and coordinate frames in any converted dataset format.
4. For VLM/VLA evaluation, add text-only and wrong-context controls so language priors cannot masquerade as visual grounding.
5. For occupancy transfer, map indoor voxel labels into a smaller safety ontology before comparing with driving occupancy labels.
6. For airside or yard adaptation, add target objects, outdoor lighting/weather, dynamic actors, and operational rules before making deployment claims.
7. Review upstream ScanNet, 3RScan, Matterport3D, and repository terms before commercial or redistributed use.

---

## Sources

- EmbodiedScan official project page: https://tai-wang.github.io/embodiedscan/
- EmbodiedScan CVPR 2024 paper page: https://openaccess.thecvf.com/content/CVPR2024/html/Wang_EmbodiedScan_A_Holistic_Multi-Modal_3D_Perception_Suite_Towards_Embodied_AI_CVPR_2024_paper.html
- EmbodiedScan official repository: https://github.com/InternRobotics/EmbodiedScan
- EmbodiedScan arXiv record: https://arxiv.org/abs/2312.16170
- MMScan official project page: https://tai-wang.github.io/mmscan/
- MMScan NeurIPS 2024 proceedings page: https://proceedings.neurips.cc/paper_files/paper/2024/hash/5aed0d900297bd5593afc14ff452d4a8-Abstract-Datasets_and_Benchmarks_Track.html
- MMScan OpenReview record: https://openreview.net/forum?id=z1nITsHKb4
- MMScan arXiv record: https://arxiv.org/abs/2406.09401
- OpenRobotLab/EmbodiedScan repository path used by project links: https://github.com/OpenRobotLab/EmbodiedScan
