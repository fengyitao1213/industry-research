# LOSC

<!-- method-priority:start
priority:
  learning: 3
  deployment: 3
  type: "method"
  stage: "frontier"
  maturity: "research"
  tags: ["perception", "validation", "data-engine", "road-av", "mapping"]
  reason: "LOSC is rated for open-vocabulary LiDAR pseudo-label consolidation, annotation leverage, and map-labeling data-engine workflows."
method-priority:end -->

Related routes: [Aggregated-Map Semantic Segmentation](../overview/aggregated-map-semantic-segmentation.md), [Open-Vocabulary and Zero-Shot Detection](../overview/open-vocab-detection.md), [Data Engines and Datasets](../../../50-cloud-fleet/data-platform/data-engines-datasets.md), [Active Labeling Budget Ops](../../../50-cloud-fleet/data-platform/active-labeling-budget-ops.md), and [3D Annotation Tools](../../../50-cloud-fleet/data-platform/3d-annotation-tools.md).

## What It Is

LOSC, short for **LiDAR Open-voc Segmentation Consolidator**, is a 3DV 2026 oral method for annotation-free open-vocabulary LiDAR segmentation in driving settings. It starts with image-based vision-language or vision-foundation-model labels, back-projects those noisy 2D predictions into LiDAR, consolidates the resulting sparse point labels, and trains a 3D LiDAR network from the refined pseudo-labels.

The important boundary for this repository is that LOSC is a **pseudo-label consolidation method**, not a ground-truth authority. In an aggregated LiDAR-map pipeline it belongs in the offboard data-engine lane as a `candidate_label` or `pseudo_labeled` batch generator. Its outputs should pass taxonomy mapping, reviewer decisions, QA gates, and semantic-map manifest checks before they become release labels.

## Core Technical Idea

Open-vocabulary 2D image models can name objects and stuff classes that a fixed LiDAR taxonomy may not cover. The classical transfer pattern is simple:

1. Run a 2D open-vocabulary segmenter on calibrated camera images.
2. Project the 2D image labels into the corresponding LiDAR scans.
3. Train a 3D LiDAR network on the projected labels.

The weak point is step 2. Projected labels are sparse, viewpoint-dependent, and noisy around occlusion boundaries, image-mask errors, and calibration or timing imperfections. LOSC makes the missing step explicit: consolidate the noisy lifted labels before training the LiDAR model.

The paper describes two consolidation families:

- **Time-based consolidation:** align sequence evidence in a shared 3D frame and vote across repeated observations of the same physical region.
- **Augmentation-based consolidation:** run the image-labeling path under image augmentations and keep labels that remain stable across perturbations.

After consolidation, a LiDAR segmentation model is trained on the refined labels. Inference is LiDAR-only, but the pseudo-label generation stage still depends on synchronized images and calibrated camera-LiDAR geometry. Treat the trained model as operating over the selected/prompt-defined label set; it is not a fully arbitrary text-promptable model at runtime.

## Inputs and Outputs

| Type | Contract |
|---|---|
| LiDAR sequence | Time-synchronized driving LiDAR scans, preferably with ego poses or map-frame alignment for temporal consolidation. |
| Camera images | Calibrated images used during pseudo-label generation; not required at LiDAR-model inference time after training. |
| Calibration and timing | Camera intrinsics, LiDAR-camera extrinsics, timestamps, and projection rules; store hashes with every label batch. |
| 2D semantic source | OpenSeeD or comparable image segmentation model, prompt set, checkpoint, augmentation policy, and confidence output. |
| Consolidation policy | Time-voting, augmentation-voting, voxel size, ignore-label handling, confidence threshold, and unknown/abstention behavior. |
| Output pseudo-labels | Consolidated per-point or per-voxel pseudo-labels with provenance and confidence, still marked as candidate or pseudo-labeled data. |
| Output model | A LiDAR segmentation checkpoint trained from refined pseudo-labels for LiDAR-only inference. |
| Data-engine artifact | `candidate_label_batch_id`, source sequence hash, calibration hash, prompt/checkpoint IDs, consolidation policy, reviewer state, and QA report ID. |

## Architecture or Pipeline

```text
Synchronized camera + LiDAR sequence
        |
        v
[1] 2D open-vocabulary image segmentation
        |
        v
[2] Camera-to-LiDAR back-projection
        |
        v
[3] Raw sparse point pseudo-labels
        |
        +--> time-based consolidation
        |
        +--> augmentation-based consolidation
        |
        v
[4] Refined pseudo-label set
        |
        v
[5] Train 3D LiDAR segmentation network
        |
        v
[6] LiDAR-only segmentation model
```

This is distinct from related pages:

- [OpenScene](openscene.md) lifts CLIP-aligned 2D features into 3D and supports text-querying a 3D scene representation.
- [Mosaic3D](mosaic3d.md) focuses on an open-vocabulary 3D segmentation dataset/model built around mask-text supervision.
- [SAM4D](sam4d.md) is a promptable camera-and-LiDAR stream segmentation system.
- SALT is a semi-automatic labeling tool with 4D prompting and review workflow, not the same consolidation method.

## Training and Evaluation

LOSC is evaluated on public-road driving datasets: nuScenes and SemanticKITTI. The arXiv record lists the paper as submitted on July 10, 2025, revised on March 13, 2026, and accepted as a 3DV 2026 oral. OpenReview and the Valeo project page also list it as 3DV 2026, and the official Valeo GitHub repository is public.

The paper and public records report stronger zero-shot open-vocabulary semantic and panoptic segmentation than the compared baselines on nuScenes and SemanticKITTI. The reported semantic-segmentation values used elsewhere in this corpus are 49.3 mIoU on nuScenes and 35.2 mIoU on SemanticKITTI, with panoptic PQ of 48.4 on nuScenes and 32.4 on SemanticKITTI. Treat those as public-road benchmark evidence, not validation for airports, depots, ports, campuses, construction sites, or aggregated-map release quality.

IGLOSS is a newer same-author 2026 preprint for LiDAR open-vocabulary semantic segmentation using generated prototype images. Do not describe LOSC as timeless "current SOTA"; use date- and benchmark-scoped wording.

## Strengths

- **Explicit noise consolidation:** LOSC attacks the noisy-lifted-label problem directly rather than assuming a 3D network will absorb every projection and prompt error.
- **Annotation leverage:** It reduces dependence on manual 3D semantic labels for early open-vocabulary exploration and data-engine bootstrapping.
- **LiDAR-only inference after training:** Cameras and heavyweight image models are needed during pseudo-label generation, but the trained 3D model can run on LiDAR alone.
- **Good fit for candidate-label lanes:** The method naturally emits batch-level pseudo-label artifacts with consolidation policy and source provenance.
- **Bridge from open vocabulary to closed taxonomy:** It can surface rare concepts, then let reviewers map them to a production taxonomy or retain them as `unknown`.

## Failure Modes

- **Calibration and synchronization sensitivity:** Camera-LiDAR misalignment, timestamp skew, rolling shutter, motion distortion, or incorrect projection depth can move a correct image label onto the wrong LiDAR points.
- **2D model bias:** Image segmentation errors, prompt sensitivity, texture bias, and class-name ambiguity are inherited by the 3D pseudo-labels.
- **Persistent wrong labels:** Temporal voting can make a repeated wrong label look stable, especially around static-but-transient objects that remain in place for the survey window.
- **Dynamic and movable-object leakage:** Stationary people, parked vehicles, carts, cones, construction equipment, or staged GSE can be consolidated into the map unless map-hygiene gates reject them.
- **Rare-class over-filtering:** Augmentation-stability voting can suppress thin, small, partly visible, or long-tail objects that are unstable under image perturbations.
- **Domain gap:** Public-road nuScenes/SemanticKITTI evidence does not prove performance on airside, yard, campus, construction, warehouse, or city-district survey maps.
- **Not a safety-class authority:** LOSC can propose candidate concepts, but release labels need controlled taxonomy, QA evidence, and traceable human or policy approval.

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV data engines | Strong research fit | Source evidence is public-road driving, and the LiDAR-only inference result fits offboard model training. |
| Urban district and campus mapping | Conditional | Useful for long-tail label discovery if synchronized imagery and geographic holdouts exist; validate against local tiles. |
| Airside, ports, yards, construction | Conditional | Useful for rare equipment and candidate-label discovery, but no direct production or benchmark evidence. Static-but-transient guards are mandatory. |
| Warehouse and indoor robots | Weak to conditional | The method assumes driving-style LiDAR-camera sequences; indoor RGB-D or handheld scans need separate validation. |
| Camera-poor LiDAR surveys | Weak | Pseudo-label generation needs imagery and calibration; use LiDAR-only discovery methods when images are absent. |
| Runtime safety perception | Weak | Treat as offline data-engine/training infrastructure unless a closed taxonomy, latency budget, and safety monitor are validated. |

## AV Relevance

For an end-to-end semantic-map pipeline, LOSC is most useful in three places:

1. **Open-vocabulary discovery:** propose labels for rare or under-specified classes before the production taxonomy is finalized.
2. **Training-data bootstrapping:** create pseudo-labeled regions that reviewers can accept, remap, reject, or escalate into taxonomy changes.
3. **Back-projected label generation:** train a LiDAR model from image-assisted labels, then use the LiDAR model to label scans or map tiles where cameras are unavailable at inference time.

For aggregated maps, the right architecture is conservative. LOSC outputs enter as `candidate_label` or `pseudo_labeled` regions. A separate map-hygiene lane removes dynamic residuals and static-but-wrong objects before the labels can be promoted to `reviewed_label` and then `release_label`.

## Implementation Notes

- Store source sequence IDs, map tile IDs, calibration package hashes, projection settings, prompt sets, image-model checkpoints, LiDAR-model checkpoints, and consolidation-policy IDs with every pseudo-label batch.
- Keep `candidate_label`, `pseudo_labeled`, `reviewed_label`, `ground_truth`, and `release_label` as separate states. Do not let prompt strings become map class IDs directly.
- Use geographic or site holdouts, not random point or scan splits, when evaluating transfer to urban districts, campuses, airports, yards, ports, or construction sites.
- Compare against a closed-set supervised LiDAR baseline, an OpenScene-style feature-lifting baseline, and a human-reviewed slice before relying on LOSC labels for training.
- Review disagreement regions between accumulate-then-segment and segment-then-accumulate passes; they are high-value QA targets.
- Run dynamic residual and static-but-transient object checks before map publication, especially for stationary people, parked equipment, temporary barriers, and staged operational objects.
- Track IGLOSS and related successor methods as watch items, but avoid replacing LOSC's concrete consolidation role unless a newer method has comparable public artifacts and implementation maturity.

## Sources

- LOSC arXiv record: https://arxiv.org/abs/2507.07605
- LOSC OpenReview record: https://openreview.net/forum?id=COPq80tRPd
- LOSC official repository: https://github.com/valeoai/LOSC
- LOSC Valeo project page: https://valeoai.github.io/publications/losc/
- IGLOSS watch item: https://arxiv.org/abs/2604.01361
- OpenScene comparator: https://openaccess.thecvf.com/content/CVPR2023/html/Peng_OpenScene_3D_Scene_Understanding_With_Open_Vocabularies_CVPR_2023_paper.html
- Mosaic3D comparator: https://openaccess.thecvf.com/content/CVPR2025/html/Lee_Mosaic3D_Foundation_Dataset_and_Model_for_Open-Vocabulary_3D_Segmentation_CVPR_2025_paper.html
- SAM4D comparator: https://openaccess.thecvf.com/content/ICCV2025/html/Xu_SAM4D_Segment_Anything_in_Camera_and_LiDAR_Streams_ICCV_2025_paper.html
- SALT comparator: https://arxiv.org/abs/2503.23980
