# Camera-LiDAR Fusion Interfaces

## What It Covers

- Camera-LiDAR fusion is not one architecture; it is a set of interface choices between image semantics and range geometry.
- The core interface question is where information crosses modality boundaries: raw points, image pixels, BEV features, object queries, voxels, or final detections.
- This page focuses on modern query, interaction, and occupancy fusion methods that complement broader BEV fusion coverage.
- Representative methods include FUTR3D, CMT, DeepInteraction, and MS-Occ.
- The goal for airside autonomy is not maximum leaderboard score alone; it is calibrated geometry, semantics, modality health, and graceful degradation.

## Interface Taxonomy

| Interface | What Crosses Modalities | Typical Methods | Main Risk |
|---|---|---|---|
| Projection augmentation | Image labels or features projected onto LiDAR points | PointPainting-style systems | Calibration and occlusion errors become point labels |
| BEV feature fusion | Camera BEV and LiDAR BEV tensors | BEVFusion, TransFusion-style systems | BEV flattening can hide vertical structure |
| Query feature sampling | Object queries sample both image and LiDAR/radar features | FUTR3D, CMT | Query budget can miss small or unusual objects |
| Modality interaction | Separate modality streams repeatedly exchange predictive features | DeepInteraction | More complex failure modes and latency |
| Voxel occupancy fusion | Camera semantics and LiDAR geometry combine in voxel space | MS-Occ | Semantic conflicts and sparse LiDAR labels |
| Late decision fusion | Boxes, tracks, or occupancy maps merge after independent inference | Production fallback systems | Loses low-level evidence and can double-count |

## Core Technical Ideas

- FUTR3D uses a Modality-Agnostic Feature Sampler (MAFS) so the same query-based detector can sample features from cameras, LiDAR, radar, or mixed sensor configurations.
- CMT frames multi-modal 3D detection as a cross-modal transformer problem, using transformer queries to integrate camera and LiDAR features efficiently.
- DeepInteraction keeps camera and LiDAR representations separate and lets them interact through dedicated modality interaction layers instead of collapsing one modality into the other early.
- MS-Occ applies fusion at multiple stages for semantic occupancy: Gaussian-Geo enriches image features with LiDAR-derived geometric priors, Semantic-Aware fusion enriches LiDAR voxels with image context, and late voxel fusion reconciles semantic conflicts.
- The deployment theme across these methods is that the interface should expose what each sensor contributed, not only the final fused answer.

## Inputs and Outputs

- Input: synchronized multi-view camera images.
- Input: LiDAR point clouds or voxel/pillar features.
- Input metadata: camera intrinsics, camera-LiDAR extrinsics, ego pose, timestamps, image augmentations, and LiDAR motion correction.
- Optional input: radar features, sensor-health masks, modality dropout masks, or calibration covariance.
- Output: 3D object detections, BEV segmentation, semantic occupancy, or fused BEV features.
- Monitoring output: modality contribution, feature alignment score, calibration residual, and per-modality confidence.

## Benchmark Signals

- FUTR3D reports that cameras plus a 4-beam LiDAR achieve 58.0 mAP on nuScenes, comparable to a CenterPoint 32-beam LiDAR baseline at 56.6 mAP.
- MS-Occ reports 32.1 IoU and 25.3 mIoU on nuScenes-OpenOccupancy, improving the cited state of the art by +0.7 IoU and +2.4 mIoU.
- DeepInteraction was a NeurIPS 2022 method designed around explicit modality interaction for multi-modal 3D detection.
- CMT focuses on fast, robust end-to-end multi-modal 3D object detection.
- Fair comparison requires matching sensors, LiDAR beam count, camera resolution, latency budget, temporal setting, and whether the model is detection-only or occupancy-capable.

## Deployment Risks

- Calibration errors can silently convert good image evidence into wrong 3D geometry.
- Time synchronization errors are amplified when fast-moving objects are fused across modalities.
- Camera features can dominate semantics while LiDAR dominates geometry, causing the system to look confident even when the two disagree.
- Sparse LiDAR returns can make small objects invisible, while camera-only depth can smear object extent.
- BEV fusion can lose vertical clearance information for wings, jet bridges, signs, and overhangs.
- Late-fused detections can double-count correlated evidence if covariance and source provenance are ignored.
- Training only on clean full-sensor data makes sensor dropout brittle.

## Airside AV Fit

- Camera-LiDAR fusion is essential for aircraft stands because semantics and precise geometry are both needed.
- LiDAR helps with clearance around aircraft, GSE, cones, chocks, tow bars, and pedestrians; cameras help classify equipment and interpret markings.
- Query fusion is attractive for standard actors such as tugs, buses, tractors, and trucks.
- Voxel occupancy fusion is stronger near irregular geometry such as wings, engines, dollies, hoses, and belt loaders.
- Airside stacks should expose modality health to planning: camera-only, LiDAR-only, and fused outputs should not have the same operational authority.
- Validate separately under floodlights, wet pavement, reflective aircraft skin, rain, fog, spray, jet exhaust, and camera occlusion.

## Implementation Guidance

- Start with a BEV or voxel fusion baseline that supports explicit modality dropout.
- Add query-level fusion when object detection latency and memory are more important than dense scene representation.
- Add occupancy fusion for clearance-critical areas where boxes are too coarse.
- Keep camera-LiDAR calibration versioned with every model and dataset artifact.
- Log per-object and per-voxel modality support so incident review can see which sensor drove the output.
- Train with missing modalities, degraded cameras, sparse LiDAR, and calibration perturbations.
- Require a conservative fallback when camera and LiDAR disagree inside the planned path.

## Offline Map Colorization

The same camera-LiDAR projection mechanics serve an *offline* consumer: colorizing an aggregated LiDAR map by projecting survey imagery onto each map point, so a 3D segmenter can ingest `(x,y,z,intensity,r,g,b)`. The interface concerns above — extrinsics, time-sync, distortion, rolling-shutter — apply unchanged, with two offline-specific additions: multi-pass colour conflicts must be resolved (median or most-confident projection), and grazing-angle projections rejected. See `aggregated-map-semantic-segmentation.md` §4.2 (colorized input) and §9.5 (colorization conditioning).

## Aggregated-Map Modality Contract

For a registered map, "LiDAR plus image" is not one input type. It is a release contract describing which evidence was used during training, which evidence is needed during replay, and which evidence must be present in the published artifact. Keep the lanes separate:

| Lane | Camera used when | Release input | Training benefit | Main release risk |
|---|---|---|---|---|
| LiDAR-only | Never, or only for human review | `(x,y,z,intensity,derived geometry)` | Stable geometry and reflectance baseline | Lower ceiling on appearance-defined classes |
| Pre-baked colorized cloud | Offline map conditioning | LiDAR points plus stored RGB/color-confidence attributes | Helps markings, signs, facade material, vegetation/soil split | Bad projection becomes a permanent feature channel |
| Train-time image distillation | Pre-training or supervised training only | LiDAR-only model weights | 2DPASS/SLidR/ScaLR/D-DITR-style 2D semantics without runtime camera dependency | Calibration errors poison the teacher signal unless filtered |
| Image-dependent fusion | Inference or offline replay | LiDAR plus images, calibration, image coverage | Highest ceiling under controlled survey conditions | Cannot be replayed or audited without the exact image evidence |
| Candidate-label lane | Labeling and review workflow | Reviewer-approved labels only | SAM/CLIP/DINO/SALT/LOSC-style proposal generation for rare classes | Candidate labels can become unreviewed ground truth if provenance is weak |

The recommended production default for aggregated LiDAR maps is **train-time image distillation with LiDAR-only release**. It extracts appearance semantics from cameras when high-quality paired data exists, but the published semantic map remains reproducible from the LiDAR map plus recorded model, taxonomy, and conditioning manifests. Direct image-dependent fusion is defensible for an offline survey product only when the release bundle stores the image set, calibration version, projection policy, and rejected-projection evidence.

## Projection Evidence for Map Releases

A colorized or image-distilled map should carry a projection QA artifact. At minimum, store:

| Field | Purpose |
|---|---|
| `camera_intrinsics_id` / `extrinsics_id` | Pins the projection to calibrated sensor geometry |
| `time_sync_profile_id` | Records whether images and LiDAR points are temporally compatible |
| `projection_residual_summary` | Quantifies reprojection error on targets or natural correspondences |
| `per_point_camera_id` / `view_count` | Shows which camera(s) contributed to each point's color or teacher feature |
| `occlusion_policy` | Prevents projecting texture through foreground objects onto background points |
| `grazing_angle_rejection_policy` | Rejects unstable facade/ground projections |
| `exposure_white_balance_policy` | Makes multi-pass color fusion reproducible |
| `color_conflict_policy` | Defines median, newest, highest-confidence, or reviewer-selected color fusion |
| `rejected_projection_digest` | Preserves points/images rejected from colorization or distillation |
| `image_teacher_id` | Identifies the 2D model used for distillation or candidate labels |

These fields are not cosmetic. A map that uses RGB or image-derived features without projection evidence cannot explain whether a wrong label came from LiDAR geometry, camera appearance, a calibration shift, an occlusion, or the 2D teacher. That ambiguity breaks both safety review and data-flywheel debugging.

## Fusion Choice for Non-Road Urban Districts

Non-road districts often have more appearance-defined structure than road benchmarks: facade openings, loading-bay doors, warehouse signage, utility cabinets, painted safety zones, cable trays, pipes, gantries, and temporary work equipment. Cameras help classify these, but the map still needs LiDAR-first permanence and geometry.

| Target condition | Preferred lane | Reason |
|---|---|---|
| Airport apron or port yard at night | LiDAR-only or distill-to-LiDAR | Image quality varies; LiDAR remains the reliable release input |
| Terminal frontage / facade-heavy map | Colorized cloud plus D-DITR/ScaLR-style distillation | Appearance helps windows, doors, signage, HVAC, and facade parts |
| Utility corridor or overhead-line survey | LiDAR-image fusion for training, LiDAR-only release when possible | Image cues help insulators/cables; LiDAR geometry governs clearance |
| Managed building / warehouse | RGB-D or colorized point-cloud training plus LiDAR/depth release contract | Indoor semantics benefit from color but must preserve localization landmarks |
| Construction or temporary works zone | Candidate-label lane plus reviewer approval | Camera proposals are useful, but temporary objects need policy gates before map promotion |

## Sources

- FUTR3D arXiv paper: https://arxiv.org/abs/2203.10642
- FUTR3D CVF paper: https://openaccess.thecvf.com/content/CVPR2023W/WAD/papers/Chen_FUTR3D_A_Unified_Sensor_Fusion_Framework_for_3D_Detection_CVPRW_2023_paper.pdf
- CMT arXiv paper: https://arxiv.org/abs/2301.01283
- DeepInteraction NeurIPS paper page: https://proceedings.neurips.cc/paper_files/paper/2022/hash/0d18ab3b5fabfa6fe47c62e711af02f0-Abstract-Conference.html
- MS-Occ arXiv paper: https://arxiv.org/abs/2504.15888
- 2DPASS: https://arxiv.org/abs/2207.04397
- SLidR: https://arxiv.org/abs/2203.16258 and https://github.com/valeoai/SLidR
- ScaLR: https://arxiv.org/abs/2310.17504
- DITR / D-DITR: https://arxiv.org/abs/2503.18944
- Existing fusion overview: [Sensor Fusion Architectures](sensor-fusion-architectures.md)
- Aggregated-map companion: [Aggregated-Map Semantic Segmentation](aggregated-map-semantic-segmentation.md)
