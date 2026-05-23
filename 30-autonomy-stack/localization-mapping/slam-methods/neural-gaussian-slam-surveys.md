# Neural/Gaussian SLAM Surveys

<!-- method-priority:start
priority:
  learning: 4
  deployment: 2
  type: "method-family"
  stage: "frontier"
  maturity: "research"
  tags: ["slam", "mapping", "simulation", "validation"]
  reason: "Taxonomy page for organizing neural, NeRF, 3DGS, and foundation-model SLAM methods and limits."
method-priority:end -->

Related docs: [SLAM Method Library Overview](overview.md), [Photoreal City-Scale 4D Reconstruction](../overview/photoreal-city-scale-4d-reconstruction.md), [Volume Rendering, Radiance Fields, and Gaussian Splatting](../../../10-knowledge-base/geometry-3d/volume-rendering-radiance-fields-gaussian-splatting.md), [Feed-Forward 3D Reconstruction and Splatting](../../../10-knowledge-base/geometry-3d/feed-forward-3d-reconstruction-and-splatting.md), [SLAM3R and VGGT Foundation SLAM](slam3r-vggt-foundation-slam.md), [Multi-Agent Neural and Gaussian SLAM](multi-agent-neural-gaussian-slam.md), [HI-SLAM2](hi-slam2.md), and [SEGS-SLAM](segs-slam.md).

## Executive Summary

Neural and Gaussian SLAM has become too broad to manage as a single method family. The 2024-2026 literature now includes NeRF-style implicit maps, 3D Gaussian maps, feed-forward pointmap/foundation SLAM, multi-agent neural maps, semantic Gaussian maps, dynamic Gaussian SLAM, LiDAR-camera Gaussian mapping, and radar/Gaussian hybrids.

This page is a taxonomy and routing guide. Its job is to keep individual method pages organized and to make the production boundary explicit: neural/Gaussian maps are promising dense map representations, visual QA artifacts, simulation assets, and research localizers, but they are not yet a general replacement for validated multi-sensor localization.

The survey sources are useful for structure, not for deployment claims by themselves. Any performance or readiness claim should be checked against the individual method paper, code, dataset, and local validation.

## Taxonomy

| Family | Representative local pages | Main representation | Primary value | Main deployment blocker |
|---|---|---|---|---|
| NeRF/implicit dense SLAM | [iMAP](imap.md), [NICE-SLAM](nice-slam.md), [Co-SLAM / ESLAM](co-slam-eslam.md), [NeRF-SLAM](nerf-slam.md) | Implicit neural fields, feature grids, SDF/radiance fields | Dense reconstruction and compact scene functions | Runtime, uncertainty, map editing, and metric integrity |
| First-wave 3DGS visual SLAM | [GS-SLAM and MonoGS](gs-slam-monogs.md), [SplaTAM](splatam.md), [Photo-SLAM](photo-slam.md) | 3D Gaussian primitives | Faster differentiable rendering and photorealistic maps | Static-scene and camera-fragility assumptions |
| Globally corrected RGB Gaussian SLAM | [Splat-SLAM](splat-slam.md), [HI-SLAM2](hi-slam2.md) | RGB-derived 3D Gaussian maps with global correction | Loop-consistent dense visual reconstruction | Monocular scale, learned priors, and no physical sensor authority |
| Outdoor/foundation visual Gaussian SLAM | [S3PO-GS](s3po-gs.md), [SLAM3R and VGGT Foundation SLAM](slam3r-vggt-foundation-slam.md) | Pointmaps, feed-forward geometry, Gaussians | Large-scale visual reconstruction and learned geometry priors | Domain shift, hallucination, and weak safety evidence |
| Structured visual Gaussian mapping | [SEGS-SLAM](segs-slam.md), [Photo-SLAM](photo-slam.md) | Structured Gaussian anchors and appearance embeddings | Better photorealistic mapping across camera modes | Rendering quality can diverge from pose integrity |
| Multi-sensor Gaussian SLAM | [Gaussian-LIC](gaussian-lic.md), [RMGS-SLAM](rmgs-slam.md), [GS-LIVM](gs-livm.md), [VIGS-SLAM](vigs-slam.md) | Gaussian maps constrained by LiDAR/camera/IMU | More metric outdoor mapping and visual QA | Calibration, sensor degradation, dependency complexity |
| Dynamic/radar Gaussian SLAM | [Dynamic 4D Gaussian SLAM](dynamic-4d-gaussian-slam.md), [RadarSplat-RIO](radarsplat-rio.md), [WildGS-SLAM](wildgs-slam.md) | Time-aware or radar-constrained Gaussians | Dynamic-scene and adverse-weather research | Robust dynamic-object lifecycle and certified uncertainty |
| Collaborative neural/Gaussian SLAM | [Multi-Agent Neural and Gaussian SLAM](multi-agent-neural-gaussian-slam.md), [COSMO-Bench](cosmo-bench.md) | Shared neural/Gaussian maps or backend graph data | Multi-robot mapping and dense digital twins | Communication, false inter-agent loops, and map consistency |

## Representation Choices

| Representation | Good at | Weak at | AV interpretation |
|---|---|---|---|
| NeRF / implicit field | Smooth dense reconstruction and continuous rendering | Slow optimization, hard map editing, hidden geometry failures | Useful for offline reconstruction and simulation, less practical for runtime pose |
| 3D Gaussian splats | Fast rendering and explicit primitives | Uncertainty, dynamic-object ghosts, map lifecycle, primitive explosion | Strong visual QA/simulation artifact if aligned to trusted trajectories |
| Pointmaps / feed-forward geometry | Fast dense visual priors and calibration-light reconstruction | Learned-prior hallucination and scale ambiguity | Useful for camera-log mining and dense map proposals, not authority |
| LiDAR/camera/IMU-constrained Gaussians | Metric geometry plus photorealistic appearance | Calibration and multi-rate synchronization sensitivity | Most AV-relevant neural/Gaussian direction, still research-stage |
| Dynamic/time-aware Gaussians | Reconstructing non-static scenes | Separating moving hazards from persistent map truth | Useful for map-cleaning research, not yet runtime safety state |

## Production-Readiness Ladder

| Level | Description | Examples | Gate before promotion |
|---|---|---|---|
| Visual research mapper | RGB/RGB-D Gaussian or NeRF map with trajectory output | GS-SLAM, MonoGS, SplaTAM, SEGS-SLAM | Reproduce paper metrics and document alignment policy. |
| Globally corrected visual mapper | Loop or global correction updates dense map state | Splat-SLAM, HI-SLAM2 | Prove loop false-positive handling and scale behavior. |
| Foundation-prior mapper | Learned pointmaps/depths initialize or regularize SLAM | SLAM3R, VGGT-SLAM, S3PO-GS | Test domain shift and hallucination against physical sensors. |
| Metric multi-sensor Gaussian mapper | LiDAR/IMU/camera constrain Gaussian maps | Gaussian-LIC, GS-LIVM, RMGS-SLAM, VIGS-SLAM | Validate calibration, covariance, timing, and sensor-fault behavior. |
| Production localization authority | Certified map-frame pose with health and fallback | Conventional scan-to-map localization, LIO/VIO/RIO plus HD map | Requires bounded latency, covariance consistency, map lifecycle, and safety evidence. |

Most neural/Gaussian SLAM is currently in the first four levels. A system can be useful for production QA without being the production pose authority.

## Evaluation Checklist

For every neural/Gaussian SLAM method, report:

- trajectory ATE/RPE and alignment mode;
- scale drift for monocular methods;
- rendering metrics such as PSNR, SSIM, and LPIPS;
- reconstruction accuracy/completeness against depth, LiDAR, or mesh truth;
- map size, primitive count, memory, and runtime P95/P99;
- loop-closure and relocalization false positives;
- dynamic-object ghosting and static-map contamination;
- calibration, timestamp, and sensor-degradation assumptions;
- license and dependency constraints;
- whether generated maps are used for visualization, simulation, QA, or live pose.

For autonomy, add physical-sensor disagreement and route-level safety gates. Good rendering is not enough.

## Domain Fit

| Domain | Useful applications | Caution |
|---|---|---|
| Indoor warehouse, terminal, hangar, lab | Dense visual QA, digital twins, multi-robot inspection maps | Dynamic workers/equipment and repetitive corridors need loop verification. |
| Road AV, outdoor campus, yard, port, construction | Offline reconstruction, map-change visualization, simulation assets | Weather, lighting, long range, and dynamic traffic require metric sensor checks. |
| Mining and agriculture | Terrain/asset reconstruction under controlled captures | Dust, vibration, vegetation, and low texture stress visual priors. |
| Delivery robots | Sidewalk visual reconstruction and route review | Small platforms have compute, vibration, and privacy constraints. |
| Airside | Hangar/terminal reconstruction, stand visual QA, simulation layers | Open tarmac, reflective aircraft, wet pavement, night floodlights, GNSS multipath, and moving GSE demand physical-sensor authority. |

## Routing Rules

1. Put one-method evidence in an atomic method page.
2. Use this page for survey/taxonomy updates and family routing only.
3. Do not copy survey tables or broad performance summaries without checking the original method paper.
4. Treat project pages and repositories as artifact evidence, not deployment evidence.
5. If the method relies on RGB-only input, separate rendering quality from localization integrity.
6. If the method uses LiDAR/camera/IMU, inspect calibration, timing, and failure monitoring before raising deployment relevance.
7. If a method is dynamic or collaborative, require outlier, communication, and map-consistency tests before treating it as more than research.

## Open Follow-Ups

- Radar and online calibration: GV-iRIOM and radar-IMU spatio-temporal calibration deserve a separate physical-sensor robustness pass.
- Occupancy and Gaussian perception: GS-Occ3D and GaussTR belong in the perception method library, not this SLAM page.
- Foundation visual SLAM splits: VGGT-SLAM++, ViSTA-SLAM, GaussianFlow-SLAM, and MegaSaM should remain in or split from the foundation-SLAM page only when source maturity and reader demand justify it.
- Collaborative dense maps: use [COSMO-Bench](cosmo-bench.md) for backend benchmarking, then compare dense map fusion through [Multi-Agent Neural and Gaussian SLAM](multi-agent-neural-gaussian-slam.md).

## Practical Recommendation

Use neural/Gaussian SLAM as a map-representation and reconstruction research layer. For production autonomy, keep the authoritative pose in a conservative, testable localization stack and use neural/Gaussian maps for QA, simulation, inspection, and research until uncertainty, lifecycle, dynamics, and failure monitoring mature.

## Sources

- Tosi, Zhang, Gong, Sandstrom, Mattoccia, Oswald, and Poggi, "How NeRFs and 3D Gaussian Splatting are Reshaping SLAM: a Survey." https://arxiv.org/abs/2402.13255
- Wang et al., "Towards Next-Generation SLAM: A Survey on 3DGS-SLAM Focusing on Performance, Robustness, and Future Directions." https://arxiv.org/abs/2602.04251
- Nguyen Xuan, Nguyen Canh, Nguyen, Chong, and HoangVan, "A Survey on Collaborative SLAM with 3D Gaussian Splatting." https://arxiv.org/abs/2510.23988
- Local context: [HI-SLAM2](hi-slam2.md)
- Local context: [SEGS-SLAM](segs-slam.md)
- Local context: [SLAM3R and VGGT Foundation SLAM](slam3r-vggt-foundation-slam.md)
