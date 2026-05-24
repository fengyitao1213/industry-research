# GridNet-HD Power-Line LiDAR-Image Segmentation

**Last updated:** 2026-05-24

GridNet-HD is a 2026 multimodal benchmark for 3D semantic segmentation of overhead electrical infrastructure. It matters for aggregated-map semantic segmentation because it is one of the few public datasets that couples very dense LiDAR, high-resolution oblique RGB imagery, camera parameters, hidden-test evaluation, and thin infrastructure classes such as pylons, conductor cables, structural cables, and insulators.

**Related pages:** [Large-scale 3D segmentation benchmarks](large-scale-3d-segmentation-benchmarks.md), [Aggregated-map semantic segmentation](../overview/aggregated-map-semantic-segmentation.md), [3D segmentation class taxonomy design](../overview/3d-segmentation-class-taxonomy-design.md), [3D segmentation training paradigms](../overview/3d-segmentation-training-paradigms.md), [large-scale tiling and throughput](../overview/large-scale-3d-segmentation-tiling-and-throughput.md), [camera-LiDAR fusion interfaces](../overview/camera-lidar-fusion-interfaces.md)

---

## Scope

| Item | GridNet-HD coverage |
|---|---|
| Primary role | LiDAR-image fusion benchmark for overhead electrical infrastructure segmentation |
| Source status | arXiv 2026 paper, Hugging Face dataset card, public data split, public leaderboard, baseline model releases |
| Acquisition | UAV LiDAR point clouds plus high-resolution oblique RGB images |
| Scale | 36 geographic zones, 7,694 images, and 2,448,762,950 labeled LiDAR points |
| Evaluation | Hidden-label test set with mIoU leaderboard on remapped semantic groups |
| License | CC-BY-4.0 on the Hugging Face dataset card |
| Core question | Whether calibrated RGB appearance improves dense LiDAR segmentation of long, thin utility assets |

The dataset should be treated as a utility-infrastructure and multimodal-fusion benchmark. It is not an autonomous-driving dataset, not an airport dataset, and not a dynamic-map-cleaning benchmark.

---

## Inputs And Outputs

| Asset | Use |
|---|---|
| LiDAR `.las` point cloud per zone | Primary 3D geometry for point-wise semantic segmentation. |
| RGB images | High-resolution oblique appearance source for image-only baselines, reprojection, and fusion. |
| Image masks | 2D semantic supervision aligned with the image set. |
| Camera pose and calibration files | Required for image-to-point projection and reproducible LiDAR-image fusion. |
| `split.json` | Defines official zone-level train/test partitioning. |
| Hidden test labels | Prevent local test-set tuning; official scores come from the hosted leaderboard. |

For loaders, preserve the full geometry, RGB projection metadata, zone ID, train/validation/test role, and ignored class mapping. The dataset card warns that the full dataset is large and should be downloaded with `huggingface_hub.snapshot_download` rather than through the auto-converted Hugging Face `datasets.load_dataset()` parquet view.

---

## Semantic Classes

The public dataset card groups original labels into the following evaluated semantic groups:

| Group | Class |
|---|---|
| 0 | Pylon |
| 1 | Conductor cable |
| 2 | Structural cable |
| 3 | Insulator |
| 4 | High vegetation |
| 5 | Low vegetation |
| 6 | Herbaceous vegetation |
| 7 | Rock, gravel, soil |
| 8 | Impervious soil / road |
| 9 | Water |
| 10 | Building |
| 255 | Unassigned / unlabeled ignored group |

This taxonomy is useful because the rare load-bearing classes are not generic "pole" or "wire" labels. They split tower structure, conductor cable, structural cable, and insulator, which forces a model to learn long thin geometry, support hardware, and vegetation/utility separation rather than collapsing everything into a single infrastructure class.

For AV or managed-site transfer, do not copy the GridNet-HD taxonomy directly. Use it to decide whether a target taxonomy needs a `wire/cable`, `mast/pylon`, `overhead asset`, or `utility infrastructure` branch, then require local evidence before adding new class IDs to a release map.

---

## Baselines And Architecture Signal

| Baseline family | What it tests | Reported test mIoU on dataset card |
|---|---|---|
| ImageVote | Image segmentation projected back into LiDAR | 69.10 |
| Superpoint Transformer | LiDAR-only 3D segmentation | 66.90 |
| LateFusionMLP | Fusion of SPT and image logits | 74.22 |

The paper reports that multimodal fusion improves over the best unimodal baseline by 5.55 mIoU. The practical lesson for aggregated maps is not "always fuse images." The lesson is narrower:

- high-resolution RGB can materially help rare, thin, appearance-defined infrastructure classes when camera-LiDAR projection is well calibrated;
- a LiDAR-only baseline still needs to be reported because color coverage, lighting, exposure, and calibration can fail in production;
- late fusion is a useful conservative starting point because the LiDAR branch remains inspectable and the image branch can be disabled when projection quality is poor.

---

## AV And Map-Segmentation Relevance

| Need | Transfer from GridNet-HD |
|---|---|
| Thin infrastructure recall | Pylons, cables, and insulators stress the same long-thin class failure mode as poles, signs, fencing, gantries, light masts, jet-bridge elements, and overhead service structures. |
| LiDAR-image fusion design | The dataset provides aligned imagery, camera parameters, and point labels, making it a concrete benchmark for colorization and late-fusion choices. |
| Non-road urban-district mapping | Utility corridors and service infrastructure are closer to managed sites, campuses, substations, and industrial districts than ordinary road-driving datasets. |
| Class-taxonomy pressure | Splitting `pylon`, `conductor cable`, `structural cable`, and `insulator` exposes when a coarse `pole/wire` taxonomy is insufficient. |
| Benchmark discipline | Hidden test labels and leaderboard mIoU support clean validation/test separation. |

For airside maps, the main value is proxy evidence for thin overhead/edge infrastructure and camera-LiDAR projection QA. It does not validate runway/apron pavement, aircraft, GSE, FOD, wet-apron multipath, de-icing mist, jet-blast dust, or safety-critical do-not-delete rules.

### Managed-Site Transfer Protocol

When using GridNet-HD inside a non-road urban-district benchmark bundle, keep three questions separate:

| Question | GridNet-HD can answer | Must be validated locally |
|---|---|---|
| Does RGB help thin-asset segmentation? | Yes: compare LiDAR-only SPT, image-vote, and late-fusion baselines on cables, pylons, and insulators | Whether cameras cover the target asset under airport/yard lighting, weather, and occlusion |
| Does the taxonomy need overhead-infrastructure splits? | Yes: pylon, conductor cable, structural cable, and insulator expose class-pressure missing from road datasets | Whether `wire/cable`, `gantry`, `mast`, or `overhead equipment` deserves a release class rather than a reviewed alias |
| Can points be published as permanent map truth? | No: the dataset has semantic labels, not target-site permanence labels | Release-state overlay for `permanent_static`, `movable_static`, `static_transient`, `fod_candidate`, `artifact`, and `unknown_review` |

For an aggregated semantic-map pipeline, GridNet-HD should therefore sit in the **pre-training / stress-test** lane. It can justify architecture choices such as LiDAR-image distillation or late fusion; it cannot replace the local release-state benchmark that decides whether a cable-like, pole-like, or artifact-like cluster belongs in the permanent map.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Utility corridors and power-line inspection | Strong | Direct target domain. |
| Urban districts, campuses, and managed industrial sites | Moderate to strong | Useful for overhead/edge infrastructure, vegetation conflicts, and LiDAR-image fusion. |
| Airside AV | Conditional proxy | Transfers to light masts, gantries, cables, fencing, and camera-LiDAR calibration, but airport objects and weather/operational slices are absent. |
| Road AV | Conditional | Thin-class lessons transfer to poles, wires, signs, and gantries; scenes are not driving logs. |
| Ports, yards, construction, and mining | Conditional | Infrastructure and long-thin assets transfer conceptually; terrain, dust, machines, and operational classes need local data. |
| Warehouses | Limited | Indoor classes and sensor geometry differ substantially. |

---

## Failure Modes And Caveats

- UAV/oblique acquisition differs from vehicle-mounted MLS survey maps.
- The domain is overhead electrical infrastructure, not road traffic, airports, yards, or indoor logistics.
- RGB fusion can overfit to lighting, seasonal vegetation appearance, image resolution, or camera-LiDAR calibration quality.
- Test labels are hidden; local architecture iteration should use a held-out validation split rather than repeated leaderboard submissions.
- The dominant vegetation and ground classes can hide weak cable, insulator, and pylon performance unless per-class IoU is reported.
- The dataset is large enough that storage, LAS parsing, projection caching, and tile manifests need to be versioned before experiments are reproducible.

---

## Implementation Notes

1. Keep zone IDs as the geographic split unit. Do not random-split points from the same zone across train and validation.
2. Preserve the LiDAR-to-image projection files and version them with the point-cloud tiles.
3. Report LiDAR-only, image-only, and fusion scores separately. A fused headline score without unimodal ablations is not enough for production design.
4. Treat the ignored group as neither background nor unknown; it should stay excluded from mIoU and training loss unless explicitly remapped.
5. Build rare-class sampling around cables, insulators, and pylons, not only around point-count frequency.
6. Add calibration and projection-health checks before using RGB features in any release-map training run.
7. For aggregated-map transfer, route GridNet-HD through the benchmark and taxonomy layers first, then validate on owned target-domain survey maps before using weights or class splits operationally.

---

## Sources

- GridNet-HD arXiv record: https://arxiv.org/abs/2601.13052
- GridNet-HD Hugging Face dataset: https://huggingface.co/datasets/heig-vd-geo/GridNet-HD
- GridNet-HD Hugging Face collection and baseline links: https://huggingface.co/collections/heig-vd-geo/gridnet-hd
