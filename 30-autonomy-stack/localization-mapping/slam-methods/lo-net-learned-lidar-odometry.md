# LO-Net and the Learned LiDAR Odometry Family

<!-- method-priority:start
priority:
  learning: 3
  deployment: 3
  type: "method"
  stage: "modern-core"
  maturity: "prototype"
  tags: ["slam", "mapping", "validation"]
  reason: "LO-Net Learned LiDAR Odometry is rated as a supporting SLAM method for autonomy-stack triage and follow-up reading."
method-priority:end -->

Related localization docs: [SLAM algorithms](../overview/lidar-slam-algorithms.md), [production LiDAR map localization](../overview/production-lidar-map-localization.md), [map construction pipeline](../maps/map-construction-pipeline.md).

Related method pages: [KISS-ICP](./kiss-icp.md) (classical no-IMU LO benchmark — the honest production baseline), [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) (IMU-tight production benchmark), [LOAM](./loam.md) (feature-based predecessor), [CT-ICP](./ct-icp.md), [LIO-SAM](./lio-sam.md), [DROID-SLAM](./droid-slam.md), [MASt3R-SLAM](./mast3r-slam.md), [Splat-SLAM](./splat-slam.md), [Learned LiDAR Place Recognition](./learned-lidar-place-recognition.md).

Related overview pages: [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [Semantic Mapping and Learned Priors](../maps/semantic-mapping-learned-priors.md).

Related KB pages: [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md), [Foundation Model Training First Principles](../../../10-knowledge-base/machine-learning/foundation-model-training-first-principles.md) (self-supervised pre-training that underpins DeLORA).

**Last updated:** 2026-05-23

---

## What It Is

LO-Net — "Deep Real-Time Lidar Odometry" — is the canonical end-to-end deep neural network for LiDAR odometry, published by Qing Li, Shaoyang Chen, Cheng Wang, Xin Li, Chenglu Wen, Ming Cheng, and Jonathan Li (Xiamen University / Louisiana State University) at CVPR 2019 (pp. 8473–8482, arXiv: 1904.08242).

The method takes two consecutive LiDAR range images — a pair of full 360° sweeps from a spinning Velodyne HDL-64E — and regresses the 6-DoF relative pose between them using a convolutional neural network. No hand-crafted feature extraction, no ICP inner loop, no explicit correspondence solver. The entire pipeline from raw scan to pose estimate is differentiable and trained end-to-end.

LO-Net's historical significance is precise: at the time of publication, LOAM (Zhang and Singh, 2014) was the dominant high-accuracy classical method at ~0.5–1% translational drift on KITTI. LO-Net with its scan-to-map refinement module was the first purely learned approach to approach that accuracy, establishing the feasibility of learned LiDAR odometry on the canonical HD-LiDAR benchmark.

**Key identifiers:**
- arXiv: https://arxiv.org/abs/1904.08242
- IEEE Xplore: https://ieeexplore.ieee.org/document/8954330
- CVPR open-access: https://openaccess.thecvf.com/content_CVPR_2019/html/Li_LO-Net_Deep_Real-Time_Lidar_Odometry_CVPR_2019_paper.html

---

## Core Technical Idea

LO-Net applies a **Siamese CNN** to pairs of spherical range images. The two branches share weights — identical convolutional encoder applied to scan t and scan t+1 — and their joint features feed a pose regression head that outputs a 3D translation vector and unit quaternion. This is the simplest possible learned formulation: treat the odometry problem as image-pair regression.

Two innovations distinguish LO-Net from a naive deep regressor:

1. **Mask-weighted normal-consistency geometric constraint.** A per-cell soft mask is jointly learned alongside the pose. The mask weights each pixel's contribution to a geometric loss that enforces surface-normal alignment under the predicted rotation. High-motion or low-reliability cells (dynamic objects, scan boundary noise) are softly excluded. The mask and the pose are trained together, so the masking improves with pose quality and vice versa.

2. **Scan-to-map refinement module.** After the scan-to-scan network produces an initial pose estimate, an optional second stage refines it against an accumulated local map using the learned mask to exclude dynamic points from the alignment. This mirrors LOAM's map-optimization step but guided by learned scene understanding rather than hand-crafted feature categories.

Both innovations address the core weakness of naive pose regression: the rigid-body assumption is violated by dynamic objects and noisy regions, and scan-to-scan estimates drift without a persistent geometric reference.

---

## Operator Mechanics

### Spherical Range-Image Projection

LO-Net converts each raw Velodyne HDL-64E point cloud to a **spherical (range) image** by mapping 3D points to a 2D grid indexed by azimuth and elevation. See the range-image background in [Point Cloud Registration Math](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md).

For a 3D point p = (x, y, z):

```
u = floor( (1 - (arctan(y, x) + pi) / (2*pi)) * W )
v = floor( (1 - (arcsin(z / r) + f_down) / f) * H )
r = sqrt(x^2 + y^2 + z^2)
```

Where:
- W = image width (1024 for HDL-64E at 0.35° azimuth resolution)
- H = image height = number of beams (64 for HDL-64E)
- f = total vertical FoV (26.9° for HDL-64E)
- f_down = downward FoV angle
- r = range stored at pixel (u, v)

The result is a 64 x 1024 range image per scan. Surface normals are estimated from pixel neighborhoods and stacked as additional channels. A scan pair is formed by concatenating scan t and scan t+1 channel-wise into a single multi-channel 2D tensor. The exact channel count is not confirmed from available abstracts; standard practice for this approach uses [range, x, y, z, normal_x, normal_y, normal_z] per scan = 7 channels, yielding 14 input channels for the pair.

**Sensor-coupling implication.** This projection hard-codes the beam geometry of HDL-64E. A different sensor — VLP-16 (16 beams), Ouster OS1-32 (32 beams), or any solid-state LiDAR — produces a structurally different tensor (different H, different beam spacing statistics, different angular resolution). The trained weights are not transferable without retraining. This is the root cause of LO-Net's generalization gap.

### Siamese Feature Encoder

The backbone is a **Siamese CNN encoder**: identical, weight-sharing convolutional branches applied independently to scan t and scan t+1. This is the same structural choice as FlowNet-S (Dosovitskiy et al., ICCV 2015) applied to LiDAR range images rather than RGB images. The shared weights enforce that the same spatial features matter regardless of which scan is "earlier."

The encoder produces per-cell feature maps at multiple resolutions. These maps encode local geometry, range gradients, and normal-like cues implicitly learned during training.

### Per-Cell Mask Estimation Sub-network

A critical parallel branch outputs a scalar **learned mask weight** w_i ∈ [0, 1] for each pixel of the range image. The mask is not a hard binary filter; it is a continuous soft weight that enters the geometric loss. It is trained to assign low weight to:

- Dynamic objects (vehicles, pedestrians) whose motion violates the rigid-body assumption underlying odometry
- Noisy or occluded pixels at scan boundaries and at far range where point density thins

The mask is indirectly supervised: it is never given an explicit dynamic/static label. Instead, the mask is learned because it minimizes the total loss — cells where the normal-consistency loss is high (implying the predicted pose fits them poorly) are encouraged to receive low mask weights, reducing their penalty contribution. This is a form of self-supervised curriculum: the network learns which cells to trust as it learns the pose.

### Pose-Prediction Head

The feature maps from both branches are correlated or concatenated and fed into a **pose regression head** of fully connected layers over globally pooled features. The output is:

```
(t_pred, q_pred)
  t_pred ∈ R^3        [3D translation vector]
  q_pred ∈ R^4        [unit quaternion for rotation, L2-normalized]
```

The 6-DoF relative pose is recovered as the composition of this translation and rotation.

### Scan-to-Map Refinement Module

After scan-to-scan pose estimation, an optional second stage refines the estimate against an accumulated local map of recent scans. The refinement uses the same learned mask to exclude dynamic points from the map alignment, preventing moving objects from polluting the map reference. This is structurally analogous to LOAM's map optimization step but substitutes learned mask weighting for LOAM's edge/plane feature categories.

The scan-to-map module significantly reduces drift: the brief reports LO-Net scan-to-scan alone at ~1.4–1.8% t_rel, versus ~0.8–1.1% with the map module.

---

## Inputs and Outputs

| Item | Description |
|---|---|
| **Input** | Pair of consecutive spherical range images from a HDL-64E-class spinning LiDAR (64 x 1024 pixels per scan, multi-channel per-scan tensor) |
| **Output: Delta_T** | 6-DoF relative pose — 3D translation t and rotation quaternion q |
| **Output: mask M** | Per-pixel soft weight in [0, 1] indicating cell reliability |
| **Output: normals N** | Estimated surface normal map (auxiliary geometric cue) |
| **Derived output** | Accumulated odometry trajectory by composing Delta_T over time |
| **Optional output** | Refined pose from scan-to-map module when enabled |

No IMU, no wheel odometry, no GNSS, no loop closure, no prebuilt HD map.

---

## Architecture

```
Two consecutive LiDAR scans (scan t, scan t+1)
  │
  ▼
[1] Spherical projection → 64×1024 range images + normal maps
  │                        (sensor-geometry-specific step)
  │
  ├──[Branch A]──────────────────────────────────────┐
  │  Siamese CNN encoder (scan t)                    │
  │  (shared weights with Branch B)                  │
  └──[Branch B]──────────────────────────────────────┘
     Siamese CNN encoder (scan t+1)                  │
                                                      │
  ▼  [Feature maps from both branches]               │
[2] Mask sub-network (parallel to encoder)            │
    → per-cell weight w_i ∈ [0,1]                   │
  │                                                   │
  ▼                                                   │
[3] Feature correlation / concatenation               │
    + global spatial pooling                          │
  │                                                   │
  ▼                                                   │
[4] Pose regression head (FC layers)                  │
    → (t_pred, q_pred) = 6-DoF relative pose         │
  │                                                   │
  ▼                                                   │
[5] [Optional] Scan-to-map refinement module          │
    uses mask + normals from [2]+[1]                  │
    aligns current scan against local map             │
  │                                                   │
  ▼                                                   │
Output: refined Delta_T, M, N                         │
  │                                                   │
  ▼                                                   │
Compose: T_k = T_{k-1} * Delta_T_k (odometry chain)  │
```

---

## Training Recipe

### Dataset

- **Primary:** KITTI Odometry benchmark — Velodyne HDL-64E, 10 Hz, urban driving, Karlsruhe, Germany.
- **Training sequences:** 00–08 (standard split used across most contemporaries).
- **Validation:** 09, 10.
- **Test (no public ground truth):** 11–21.
- **Framework:** Not publicly released as an official codebase at the time. Community reimplementations exist.
- **Optimizer:** Adam (standard for 2019 deep-regression era).

### Loss Function

The total training loss has three components:

**1. Pose regression loss:**

```
L_pose = || t_pred - t_gt ||_2  +  lambda * || q_pred - q_gt ||_2
```

Lambda balances translation (in meters) against rotation (quaternion distance). The exact lambda from the paper is not confirmed from available abstracts; values in the range 100–500 are typical for KITTI metric scales. The rotation loss is quaternion L2; whether the paper uses a geodesic angle loss instead is not confirmed from abstract-only access.

**2. Normal-consistency geometric constraint loss — the key innovation:**

```
L_geo = sum_i [ w_i * || n_i^t - R_pred * n_i^(t+1) ||^2 ]
```

Where:
- n_i^t = surface normal at cell i in scan t (estimated from range-image neighborhood)
- n_i^(t+1) = normal at the corresponding cell in scan t+1
- R_pred = predicted rotation matrix
- w_i = learned mask weight for cell i

After applying the predicted rotation, the surface normals should agree if the prediction is correct. The mask w_i is simultaneously optimized: cells where normals remain inconsistent (dynamic objects, noise) receive low w_i, reducing their geometric loss contribution. This creates a coupled learning loop: better poses reduce geometric inconsistency; learned masks exclude cells where geometric inconsistency is irreducible.

**3. Mask regularization:**

```
L_mask = || mean(w_i) - target ||^2
```

Prevents mask collapse (all zeros or all ones) by encouraging a target proportion of active cells.

**Total loss:**

```
L = L_pose + alpha * L_geo + beta * L_mask
```

### Data Augmentation

Standard geometric augmentation for range-image-based methods: random horizontal flip, range perturbation, subsampling of scan pairs to simulate speed variation. Exact augmentation details are not confirmed from available abstracts.

---

## Benchmark Results

### KITTI Odometry (t_rel %, r_rel °/100 m)

All results on KITTI Odometry benchmark. Exact per-sequence numbers for LO-Net require full PDF access; values below are from paper abstract/summary characterizations and may not reflect precise Table 1 entries.

| Method | Category | t_rel (%) | r_rel (°/100m) | Notes |
|---|---|---|---|---|
| ICP-Point | Classical baseline | ~5.5 | ~3.0 | Vanilla point-to-point ICP |
| LOAM (2014) | Classical, feature-based | ~0.78 | ~0.35 | Dominant classical method circa 2019 |
| KISS-ICP (2022) | Classical, robust ICP | **~0.50** | — | Best open-source LO; zero retraining |
| CT-ICP (2022) | Classical, continuous-time | ~0.53 | — | 2nd open-source |
| LO-Net scan-to-scan | Learned, range image | ~1.4–1.8 | ~0.5–0.7 | No map module |
| LO-Net + map | Learned, range image | ~0.8–1.1 | ~0.35–0.5 | With scan-to-map |
| PWCLO-Net (2021) | Learned, 3D points | beats LOAM on most seqs | — | IRMVLab follow-on |
| TransLO (2023) | Learned, transformer | ~0.99 | ~0.50 | Best KITTI learned (2023) |
| RegFormer (2023) | Learned, transformer | ~0.96 | ~0.48 | Best KITTI learned reg (2023) |

**Uncertainty flag:** exact LO-Net numbers are from paper abstract characterizations ("similar accuracy to LOAM"). Per-sequence Table 1 values require the full PDF at the arXiv or CVPR links above.

**Headline finding.** LO-Net with the map module is competitive with LOAM on KITTI — approximately matching or slightly exceeding it on some sequences while falling short on others. Without the map module, scan-to-scan drift is roughly 2–3x higher than LOAM. The gap to KISS-ICP (0.50% t_rel, zero retraining, any sensor) is significant and grows dramatically off the KITTI domain.

### Inference Speed

The paper claims real-time operation (>10 Hz on a KITTI 10 Hz stream) on GPU. The exact GPU type and ms-per-frame are in the paper but not in available abstracts.

---

## The Broader Learned-LO Family

LO-Net launched a research line that ran through 2023, with each generation addressing the limitations of the prior one. The full family is covered here in chronological order.

### DeepLO — Geometry-Aware Hybrid (ICRA 2020)

**Citation:** Younggun Cho, Giseop Kim, Ayoung Kim. "DeepLO: Geometry-Aware Deep LiDAR Odometry." ICRA 2020 (arXiv: 1902.10562, February 2019).
**URL:** https://arxiv.org/abs/1902.10562 | Project: https://sites.google.com/view/deeplo

DeepLO appeared on arXiv before LO-Net (February vs. April 2019). It is a **hybrid geometry-aware** approach: the Iterated Closest Point algorithm is explicitly incorporated into the deep learning framework rather than replaced by a pure regressor. Key features:

- Two loss functions enable switching between **supervised** (with ground-truth trajectory) and **unsupervised** (geometry-consistency only) training.
- The unsupervised variant is a direct forerunner of DeLORA (2021) and later self-supervised methods.
- Evaluated on KITTI and Oxford RobotCar — demonstrating early cross-environment testing.

DeepLO preserves the classical ICP geometric engine inside the network graph, retaining interpretability at the pose-estimation step while learning the feature front-end.

---

### DeepPCO — Dual-Branch Parallel Odometry (IROS 2019)

**Citation:** Wei Wang et al. "DeepPCO: End-to-End Point Cloud Odometry through Deep Parallel Neural Network." IROS 2019.
**URL:** https://arxiv.org/abs/1910.11088

DeepPCO uses panoramic depth projection (conceptually similar to LO-Net's range image) with a **dual parallel sub-network** design: separate branches for 3D translation estimation and orientation estimation rather than a single shared regression head. The motivation is that translation and rotation have different geometric scales and should be estimated by specialized sub-networks. Published at IROS 2019, roughly contemporaneous with LO-Net.

---

### DMLO — Deep Matching LiDAR Odometry (2020)

**Citation:** Zhichao Li, Naiyan Wang. "DMLO: Deep Matching LiDAR Odometry." arXiv: 2004.03796, April 2020.
**URL:** https://arxiv.org/abs/2004.03796

DMLO decomposes 6-DoF estimation into two stages:

1. A CNN-based correspondence-matching network operating on **cylinder images** (cylindrical projection of point clouds) to establish per-cell correspondences between two scans.
2. A classical **closed-form SVD** solution for the rigid transformation from the established correspondences.

This is the "learn correspondences, solve pose classically" paradigm at its clearest — the learned component handles the hard feature-matching problem; the pose estimate retains mathematical interpretability and failure-detectability via SVD residuals. Evaluated on KITTI and Argoverse; claimed to "dramatically outperform existing learning-based methods and be comparable with state-of-the-art geometry-based approaches."

---

### PWCLO-Net — PWC 3D Point-Cloud Odometry (CVPR 2021)

**Citation:** Guangming Wang, Xinrui Wu, Zhe Liu, Hesheng Wang. "PWCLO-Net: Deep LiDAR Odometry in 3D Point Clouds Using Hierarchical Embedding Mask Optimization." CVPR 2021.
**arXiv:** https://arxiv.org/abs/2012.00972 | **GitHub:** https://github.com/IRMVLab/PWCLONet
**CVPR open-access:** https://openaccess.thecvf.com/content/CVPR2021/html/Wang_PWCLO-Net_Deep_LiDAR_Odometry_in_3D_Point_Clouds_Using_Hierarchical_CVPR_2021_paper.html

PWCLO-Net is the direct successor to LO-Net from the IRMVLab group (SJTU). Inspired by PWC-Net for optical flow, it applies the **Pyramid, Warping, and Cost volume (PWC)** architecture to 3D point clouds instead of range images:

- Operates on **raw 3D point clouds** at multiple pyramid levels, avoiding range-image quantization artifacts.
- **Attentive cost volume**: associates two point cloud sets at each pyramid level to extract motion embeddings.
- **Trainable embedding mask**: generalizes LO-Net's per-pixel mask to 3D space; learned soft weights per point.
- **Warping operation**: the estimated coarse pose warps the source cloud toward the target; the next pyramid level processes the residual motion, enabling coarse-to-fine estimation.
- **Hierarchical mask optimization**: mask refined across pyramid levels, progressively excluding dynamic/noisy points.

PWCLO-Net surpassed LO-Net and LOAM (with mapping) on most KITTI sequences — the learned-LO state of the art in 2021. The point-cloud representation removes the sensor-geometry hard-coding of range-image methods but does not eliminate the distribution shift problem (KITTI urban training data biases learned features).

---

### EfficientLO-Net — Projection-Aware 3D LO (IEEE TPAMI 2022)

**Citation:** Wang et al. (IRMVLab). "Efficient 3D Deep LiDAR Odometry." IEEE TPAMI, accepted 2022.
**arXiv:** https://arxiv.org/abs/2111.02135 | **GitHub:** https://github.com/IRMVLab/EfficientLO-Net

EfficientLO-Net builds on PWCLO-Net by adding **projection-aware representation** to organize raw 3D point clouds into ordered data, enabling faster point sampling and grouping while maintaining the PWC structure. The projection-aware design accelerates the costly PointNet-style set-abstraction operations that dominate PWCLO-Net's runtime. Evaluated on KITTI, M2DGR, and Argoverse.

This TPAMI paper is best understood as the extended journal version of PWCLO-Net, representing the IRMVLab group's mature position on learned point-cloud LO.

---

### DeLORA — Self-Supervised Deep LiDAR Odometry (ICRA 2021)

**Citation:** Julian Nubert, Shehryar Khattak, Marco Hutter. "Self-Supervised Learning of LiDAR Odometry for Robotic Applications." ICRA 2021.
**arXiv:** https://arxiv.org/abs/2011.05418 | **GitHub:** https://github.com/leggedrobotics/delora (ETH Zurich RSL)

DeLORA is the **self-supervised** branch of the learned-LO family — it requires no ground-truth pose labels during training. The training signal comes entirely from a **plane-to-plane geometric consistency loss** computed from estimated normals, extended from DeepLO's geometry-aware loss. This connects directly to the self-supervised pre-training paradigm covered in [Foundation Model Training First Principles](../../../10-knowledge-base/machine-learning/foundation-model-training-first-principles.md).

Key distinctions from LO-Net and PWCLO-Net:

- **No ground-truth supervision required**: enables deployment on new environments and sensors by collecting raw LiDAR data and retraining on the geometric loss alone. The data collection phase still requires driving the new environment, but no GPS/INS labeling is needed.
- Training signal is purely geometric (plane-to-plane alignment), sensitive to normal estimation quality.
- Supports custom sensor configurations via YAML config.
- Evaluated on KITTI; supports any sensor that produces dense-enough scans for reliable normal estimation.

**DeLORA's strategic significance.** Among all learned-LO methods, DeLORA is the most viable path for cross-domain adaptation without labeled trajectories. For airside survey-drive work, the framework could adapt to the apron environment by collecting raw LiDAR data from taxiways and stands and retraining on the geometric loss. This is the most practical "learned LO research direction" for domain adaptation — not production-ready, but closer than methods requiring GPS-quality ground truth.

---

### DELO — Deep Evidential LiDAR Odometry (ICCV 2023 Workshop)

**Citation:** Sk Aziz Ali, Djamila Aouada, Gerd Reis, Didier Stricker. "DELO: Deep Evidential LiDAR Odometry using Partial Optimal Transport." ICCV 2023 Workshop.
**arXiv:** https://arxiv.org/abs/2308.07153

DELO introduces two innovations for learned LO:

1. **Partial Optimal Transport (POT)** for LiDAR feature descriptor matching — grounds correspondence in optimal transport theory, addressing non-uniform point sampling density.
2. **Evidential uncertainty estimation**: the network learns predictive uncertainty alongside the pose and triggers pose-graph optimization when evidence indicates under- or over-confidence.

DELO is one of the few learned-LO methods to address the catastrophic-failure detection gap — the core weakness identified in the Failure Modes section below. Inference time: approximately 35–40 ms per frame (~25 Hz capable). Claims competitive KITTI performance and "superior generalization ability over recent state-of-the-art."

---

### TransLO — Window-Based Masked Point Transformer (AAAI 2023)

**Citation:** Jiuming Liu, Guangming Wang, Chaokang Jiang, Zhe Liu, Hesheng Wang. "TransLO: A Window-Based Masked Point Transformer Framework for Large-Scale LiDAR Odometry." AAAI 2023.
**Proceedings:** https://ojs.aaai.org/index.php/AAAI/article/view/25256 | **GitHub:** https://github.com/IRMVLab/TransLO

TransLO is the **first transformer-based LiDAR odometry network**, from the IRMVLab group extending their PWCLO-Net line with transformer attention:

- Projects points onto a 2D surface for linear-complexity processing (avoids O(n²) transformer cost on dense 3D point sets).
- **Window-based Masked Self-Attention (WMSA)**: captures long-range dependencies within local windows, analogous to Swin Transformer applied to LO.
- **Masked Cross-Frame Attention (MCFA)**: cross-attention between two scan frames with a binary mask removing dynamic/invalid points.

**Reported KITTI results:** average rotation RMSE = 0.500°/100 m; average translation = 0.993%. Surpasses all prior learning-based methods and outperforms LOAM on most sequences. This is the strongest single-number learned-LO result on KITTI as of 2023 from the IRMVLab line, but it falls short of KISS-ICP (0.50% t_rel) which simultaneously generalizes across all sensor platforms with zero retraining.

---

### RegFormer — Projection-Aware Transformer Registration (ICCV 2023)

**Citation:** Jiuming Liu, Guangming Wang, Zhe Liu, Chaokang Jiang, Marc Pollefeys, Hesheng Wang. "RegFormer: An Efficient Projection-Aware Transformer Network for Large-Scale Point Cloud Registration." ICCV 2023, pp. 8451–8460.
**arXiv:** https://arxiv.org/abs/2303.12384 | **GitHub:** https://github.com/IRMVLab/RegFormer

RegFormer applies to **point cloud registration** (the inner loop of LO) rather than full odometry. It uses a projection-aware hierarchical transformer with linear complexity for global feature extraction and a **bijective association transformer** for initial transformation regression. When applied to LiDAR odometry:

- Reported: ~0.48°/100 m average rotational RMSE, ~0.96% translational error on KITTI.
- Achieves competitive accuracy with faster inference than prior transformer approaches.
- The "projection-aware" design maps 3D features to 2D for efficient attention, then lifts back to 3D.

RegFormer++ (2025, arXiv: 2603.14290) extends to larger-scale scenes. For the DROID-SLAM and MASt3R-SLAM analogues in vision-based learned SLAM, see [DROID-SLAM](./droid-slam.md) and [MASt3R-SLAM](./mast3r-slam.md); for neural rendering integration, see [Splat-SLAM](./splat-slam.md).

---

## Learned-LO vs Classical LO: The Honest Verdict

This is the central question for production system design. The brief is unambiguous.

### Classical Reference Points

**KISS-ICP (IEEE RA-L 2023):** Point-to-point ICP with adaptive correspondence threshold (3-sigma from observed motion), Geman-McClure robust kernel, constant-velocity deskewing, and double-voxel downsampling. KITTI results: **0.50% t_rel (seqs 00–10), 0.61% (seqs 11–21)**. Second among open-source methods, ninth overall. **Zero retraining or parameter tuning** across automotive, UAV, segway, and handheld platforms with Velodyne, Ouster, and Livox sensors. Seven parameters, none of which change between datasets. See [KISS-ICP](./kiss-icp.md) for full analysis.

**FAST-LIO2 (IEEE T-Robotics 2022):** Tightly-coupled LiDAR-inertial odometry with iterated Extended Kalman Filter (iEKF), direct point registration to map (no feature extraction), and incremental kd-Tree (ikd-Tree) for O(log n) map insertion. Benchmarked on 19 sequences across diverse datasets; consistently sub-0.5% translational drift at up to 100 Hz on large outdoor environments. See [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) for full analysis.

### Accuracy Comparison (KITTI-centric)

| Method | Category | t_rel (%) | r_rel (°/100m) | Generalizes? |
|---|---|---|---|---|
| LOAM (2014) | Classical, feature-based | ~0.78 | ~0.35 | Yes (geometry) |
| KISS-ICP (2022) | Classical, robust ICP | **~0.50** | — | **Yes, zero retraining** |
| CT-ICP (2022) | Classical, continuous-time | ~0.53 | — | Yes (geometry) |
| LO-Net + map (2019) | Learned, range image | ~0.8–1.1 | ~0.4–0.5 | No — HDL-64E only |
| DMLO (2020) | Hybrid learned/SVD | comparable to classical | — | Partial |
| PWCLO-Net (2021) | Learned, 3D points | beats LOAM most seqs | — | No — KITTI domain |
| TransLO (2023) | Learned, transformer | ~0.99 | ~0.50 | No — KITTI domain |
| RegFormer (2023) | Learned, transformer | ~0.96 | ~0.48 | No — KITTI domain |

Numbers for LO-Net flagged as abstract-sourced (see Benchmark Results section). KITTI-trained learned methods are evaluated on KITTI; cross-domain numbers are not available from the same sources.

### The Generalization Gap

Classical methods generalize; learned methods need to be retrained per sensor and domain. The evidence is consistent across the literature:

1. **Range-image methods (LO-Net, DeepPCO)** hard-code the HDL-64E beam layout (H=64, W=1024). Applying to a VLP-16 requires full retraining — the feature maps have structurally different spatial statistics. A 2022 self-supervised LO paper explicitly states: "the network weights need to be retrained when verifying the performance" on 16-beam LiDAR after training on 64-beam KITTI.

2. **Point-cloud methods (PWCLO-Net, EfficientLO-Net)** are less sensor-geometry-dependent but suffer from distribution shift across environments. Urban KITTI training biases the network toward structured environments (buildings, parked vehicles, road surfaces); performance degrades in unstructured or non-urban domains.

3. **Overfitting to training sequences** is documented: learned methods often show significantly worse generalization on held-out test sequences. This problem does not exist for classical ICP/NDT.

4. **KISS-ICP's implicit argument**: by removing learned components and relying on core geometric principles with minimal parameters, the system works across all platforms without retraining. The same seven parameters cover automotive, UAV, handheld, and Livox solid-state LiDARs.

5. **The self-supervised path (DeLORA, DeepLO unsupervised)**: retraining on a new domain is practical since no labels are needed, but it still requires data collection in the new environment. Not zero-shot.

**Production verdict (as of 2025–2026).** Learned LO can match or slightly exceed classical LO in accuracy *on the trained domain* (KITTI automotive), but does not generalize to new sensors or environments without retraining. Classical methods (KISS-ICP, FAST-LIO2) are preferred for production deployment for three reasons: (a) zero retraining needed, (b) interpretable failure modes, (c) detectable divergence — classical ICP divergence is detectable from residual metrics, whereas a learned network can output confidently wrong poses with no warning signal.

---

## Learned Point-Cloud Registration as the LO Inner Loop

These methods learn the correspondence or registration step that classically sits inside ICP or NDT, providing a learned alternative to LOAM-style hand-crafted edge/planar feature matching. They can replace the scan-matching step in an otherwise classical odometry pipeline. See also [Point Cloud Registration Math](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md).

### DGR — Deep Global Registration (CVPR 2020 Oral)

**Citation:** Christopher Choy, Wei Dong, Vladlen Koltun. "Deep Global Registration." CVPR 2020.
**GitHub:** https://github.com/chrischoy/DeepGlobalRegistration

DGR is a differentiable end-to-end framework for pairwise point-cloud registration. Three stages:

1. **FCGF (Fully Convolutional Geometric Features)** via Minkowski Engine for sparse 3D CNN feature extraction.
2. A **6D convolutional network** for correspondence confidence prediction (outlier rejection).
3. **Differentiable Weighted Procrustes** for closed-form pose estimation plus robust SE(3) gradient optimizer for refinement.

By making correspondence weighting differentiable, the entire pipeline trains end-to-end: feature extraction, outlier rejection, and pose estimation are jointly optimized for registration quality. DGR can serve as the inner loop of LO (one registration per scan pair), but is slower at inference than classical ICP.

### PREDATOR — Overlap-Guided Registration (CVPR 2021 Oral)

**Citation:** Shengyu Huang, Zan Gojcic, Mikhail Usvyatsov, Andreas Wieser, Konrad Schindler. "PREDATOR: Registration of 3D Point Clouds with Low Overlap." CVPR 2021.
**arXiv:** https://arxiv.org/abs/2011.13005 | **GitHub:** https://github.com/prs-eth/OverlapPredator

PREDATOR addresses **low-overlap registration** — critical for sequential LiDAR frames where a large vehicle displacement means the two scans share only partial overlap. Core innovation: an **overlap-attention block** enables early information exchange between the two point-cloud encodings, conditioning per-point features on the other scan. Outputs:

- Per-point **overlap score** (probability that a point is in the overlap region)
- Per-point **matchability score**
- Rich per-point features conditioned on the paired scan

Sampling is guided by the overlap heatmap to focus on reliably matchable regions. Raises successful registration recall by >20% in low-overlap scenarios; state-of-the-art on 3DMatch at 89% recall. As an LO inner loop: overlap-aware registration benefits scenarios with partial occlusion or LiDAR spinning gaps.

### GeoTransformer — Geometry-Invariant Transformer (CVPR 2022)

**Citation:** Zheng Qin, Hao Yu, Changjian Wang, Yulan Guo, Yuxing Peng, Kai Xu. "Geometric Transformer for Fast and Robust Point Cloud Registration." CVPR 2022.
**arXiv:** https://arxiv.org/abs/2202.06688 | **GitHub:** https://github.com/qinzheng93/GeoTransformer

GeoTransformer encodes **pairwise distances and triplet-wise angles** between 3D points, making features transformation-invariant by design rather than by data augmentation. The key practical result: superpoint matching accuracy is high enough that **RANSAC is not required** — the initial alignment from transformer matching is used directly, yielding **100x speed-up** over RANSAC-based methods. Improves inlier ratio by 17–30 percentage points and registration recall by >7 points on 3DLoMatch.

For LO: GeoTransformer as a front-end eliminates the RANSAC verification step that makes learned registration slow, making it potentially viable for online LO rates.

---

## Hybrid Learned-Classical Approaches

The hybrid paradigm learns **features or correspondence weights** but delegates **pose estimation to classical least-squares**. This retains:

- Interpretability of the pose-estimation step
- Mathematical optimality guarantees given the correspondences
- Failure detectability via residual monitoring
- Computational efficiency of the classical pose solver

### Unsupervised LiDAR Feature Learning (RA-L/ICRA 2021)

**Citation:** Yoon, Zhang, Gridseth, Thomas, Barfoot. "Unsupervised Learning of Lidar Features for Use in a Probabilistic Trajectory Estimator." arXiv: 2102.11261.
**URL:** https://arxiv.org/abs/2102.11261

Uses a KPConv-based network (kernel point convolution on 3D points) trained in a Gaussian variational inference framework: the network learns features and uncertainty estimates that feed into a **batch-mode probabilistic trajectory estimator** (classical). No ground-truth trajectory labels required — the system maximizes the observed data likelihood under the classical probabilistic model. Performance is better than fully learned methods and comparable to state-of-the-art ICP on KITTI and Oxford RobotCar. This is the "learn the features, solve classically" paradigm at its purest.

### DFLIOM — LiDAR Inertial Odometry with Learned Registration Features (2024)

**Citation:** Dong et al. "LiDAR Inertial Odometry and Mapping Using Learned Registration-Relevant Features." arXiv: 2410.02961, 2024.
**URL:** https://arxiv.org/abs/2410.02961

Extends DLIOM (classical SLAM) with a learned network that selects **registration-relevant points** — reducing the point cloud to ~20% of original density while maintaining registration quality. Results: 2.4% reduction in localization error, 57.5% decrease in memory usage, maintained 20 Hz LiDAR processing. The learned component acts purely as a filter/selector; pose estimation remains the classical DLIOM backend.

### DMLO as Hybrid Exemplar

DMLO (reviewed above) is the clearest learned-LO example of this paradigm: CNN for correspondence matching + classical SVD for rigid transformation. The SVD step gives a closed-form, residual-producing, failure-detectable pose estimate — a direct improvement over LO-Net's pure regression in terms of auditability.

---

## Strengths

- **Implicit feature learning.** No manual design of edge, planar, or intensity features. The network learns task-relevant representations from data, potentially discovering cues that classical feature engineering misses.
- **Dynamic-point suppression.** The learned mask (LO-Net, PWCLO-Net, TransLO) implicitly identifies and excludes moving objects without explicit detection and tracking — a real advantage over classical ICP in dynamic-dense environments. This mask concept is transferable as an auxiliary aid to classical scan matching.
- **On-domain accuracy.** For the sensor and environment in the training set, modern learned methods (TransLO, RegFormer) achieve accuracy comparable to or slightly exceeding the best classical LO methods.
- **Potential for joint training.** End-to-end optimization targets trajectory accuracy directly rather than intermediate objectives (feature quality), theoretically enabling tighter coupling of all pipeline stages.
- **Coarse-motion initialization.** A learned network can produce reasonable initial pose estimates even in featureless regions where ICP would struggle to initialize, potentially improving robustness in the first few ICP iterations if used as a hybrid.
- **Semantic-adjacent learning.** The dynamic mask is a step toward semantic understanding of the scene — a learned LO system processing airport data could, in principle, learn to identify aircraft, belt loaders, and ground crew as dynamic entities without explicit semantic labels.

---

## Failure Modes

### Sensor-Transfer Brittleness (Critical)

Networks trained on HDL-64E **fail on VLP-16, OS1-32, or solid-state LiDARs without retraining.** The spherical range-image representation encodes beam geometry; even 3D point-cloud methods trained on KITTI fail on different scan patterns due to point density and distribution shift. A 2022 self-supervised LO paper explicitly confirms HDL-64 → VLP-16 retraining requirement.

This is the single most important deployment limitation. Any airside system would use Ouster, Livox, or other modern sensors whose beam layout and density differ from the 2014-era HDL-64E on which the entire learned-LO literature was built.

### Environment and Domain Brittleness

KITTI-trained networks fail in open fields, airports, warehouses, tunnels, and indoor environments. Learned features capture urban-scene statistics (buildings, road surfaces, parked vehicles). An airside apron has a completely different feature distribution: flat concrete, aircraft fuselages, ground support equipment, jet bridges, taxiway markings. A KITTI-trained learned LO would likely degrade severely on an open apron.

### Lack of Explicit Uncertainty (Most Methods)

Classical ICP provides a residual metric that correlates with alignment quality. Learned LO generally does not output a reliable confidence score. Degenerate poses from flat, featureless airport geometry produce wrong outputs without any failure signal. Only DELO (2023) attempts evidential uncertainty estimation; this remains a research open problem for the rest of the family.

### Catastrophic-Failure Detection Gap

When classical ICP diverges, the large residual is detectable and can trigger fallback behavior. When a learned network regresses a wrong pose, it produces a numerically plausible 6-DoF output with no warning. In the brief's words: "a learned network can output confidently wrong poses" — this is unacceptable for safety-critical or map-building applications where a single bad pose corrupts downstream products.

### Data Hunger and Label Cost

Competitive performance requires large labeled training sets with GPS/INS-quality ground truth (typically >10,000 scan pairs). The KITTI odometry dataset (seqs 00–10, ~23,000 frames) is the standard corpus; collecting equivalent airport-domain data at survey-grade accuracy is expensive and operationally disruptive.

### Accumulated Drift Without Loop Closure

Like all odometry systems, learned LO provides relative pose only. Without a global loop-closure mechanism and pose-graph back-end, drift accumulates without bound. LO-Net has no loop closure; neither do most family members. See [Learned LiDAR Place Recognition](./learned-lidar-place-recognition.md) for the learned loop-closure sibling that would need to be combined for full SLAM.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV — structured urban | Research-viable | Designed and benchmarked for KITTI urban driving. Not production-preferred (KISS-ICP, FAST-LIO2 preferred). |
| Road AV — highway | Weak | Open road reduces lateral feature richness; constant-motion assumption holds but LO suffers in featureless zones. |
| Airside — open apron | Weak | Flat concrete, specular surfaces, and different-from-KITTI feature distributions degrade KITTI-trained networks. Self-supervised retraining (DeLORA) may help. |
| Airside — terminal curb / jetway zone | Conditional | Rich vertical geometry may help; aircraft dynamics not in training distribution. Sensor mismatch still applies. |
| Warehouse / indoor | Not applicable | Requires full retraining on indoor data; classical methods (Cartographer, FAST-LIO2) preferred. |
| Mining / construction | Not applicable | Unstructured environments far outside KITTI distribution. |
| New sensor platforms | Requires retraining | Confirmed: HDL-64 → VLP-16 transition requires full retraining. |
| Research / ablation benchmark | Strong | The most appropriate use: comparing learned vs. classical components, measuring the value of dynamic masking, evaluating self-supervised adaptation. |

---

## Aggregated-Map Suitability

For production airside survey-drive LiDAR map building, the recommended stack is **FAST-LIO2 + KISS-ICP, not learned LO.** This is the honest assessment from the brief:

**Production-recommended pipeline:**

```
Survey-drive LiDAR + IMU
  → FAST-LIO2 (primary odometry, tightly coupled iEKF, ~100 Hz)
       [tightest drift per unit distance; handles aggressive motion and degenerate geometry via IMU]
  → KISS-ICP (fallback odometry, no IMU dependency, ~40 Hz)
       [zero-retraining, sensor-agnostic, classical auditable]
  → Aggregated point cloud in map frame
       [see: Aggregated-Map Semantic Segmentation]
  → Loop closure (Scan Context or learned place recognition descriptor)
       [see: Learned LiDAR Place Recognition]
  → Pose-graph back-end (GTSAM / g2o)
  → Map cleaning (ERASOR / FreeDOM for dynamic object removal)
  → Semantic segmentation and HD map products
```

**Where learned LO fits:**

1. **Research comparison track:** run DeLORA or PWCLO-Net in parallel on the same survey-drive data to measure learned vs. classical drift. The learned system should never be the primary pose source without validated uncertainty and failure detection.

2. **Self-supervised domain adaptation research:** DeLORA's framework could adapt a learned LO to the airside domain by collecting raw LiDAR data (no ground-truth labels needed) and retraining on plane-to-plane geometric consistency. This is the most viable research direction for learned LO on airport data, but is not production-ready as of 2025–2026.

3. **Learned dynamic mask as auxiliary aid:** train LO-Net-style mask networks on airport-specific data to produce per-point reliability weights for classical scan matching. Feed the learned weights into classical GICP or NDT to suppress aircraft, GSE, and transient obstacle contributions without requiring explicit detection and tracking.

4. **Correlation with FAST-LIO2 for anomaly detection:** run learned LO alongside FAST-LIO2; large pose disagreement flags a scene condition (high dynamic density, sensor degradation, unusual geometry) for human review or conservative map-insertion policy.

See [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) for the downstream pipeline.

---

## Implementation Notes

- **No official LO-Net codebase.** The LO-Net paper is available on arXiv and through CVPR open-access, but a clearly maintained official reference implementation was not released. Community reimplementations exist; verify the exact paper configuration, weights, dataset split, and preprocessing pipeline before relying on any reimplementation for comparison purposes.

- **IRMVLab/PWCLONet and IRMVLab/EfficientLO-Net** (https://github.com/IRMVLab/PWCLONet, https://github.com/IRMVLab/EfficientLO-Net) are official repositories for the direct successors and are the practical starting point for anyone wanting to run the learned-LO family.

- **DeLORA** (https://github.com/leggedrobotics/delora) is the practical starting point for self-supervised LO experiments. The ETH RSL codebase is maintained and supports custom sensor configurations via YAML.

- **Sensor configuration is not optional.** Before running any learned-LO system on new hardware, verify that the sensor's beam count, FoV, angular resolution, and scan pattern match what the model was trained on. Range-image-based methods (LO-Net, DeepPCO) will silently produce wrong outputs if the projection grid dimensions are mismatched without retraining.

- **Compare against KISS-ICP as the primary baseline.** Any evaluation of a learned LO method should include KISS-ICP (https://github.com/PRBonn/kiss-icp) as the baseline. KISS-ICP is the cleanest, most auditable, best-generalizing LO reference point. A learned method that does not outperform KISS-ICP on the target domain provides no deployment justification.

- **Covariance for factor-graph integration.** If learned odometry output is incorporated into a factor graph (GTSAM, g2o), covariance must be estimated empirically per environment, speed, and scene geometry. Learned networks do not output calibrated information matrices by default. The DELO framework (evidential uncertainty) is the only method in this family with an architectural approach to this problem.

- **License review.** Most learned-LO repositories use research licenses. Before using in any product work, verify license terms, training-data provenance (KITTI has its own terms), and hardware requirements.

- **TransLO GitHub** (https://github.com/IRMVLab/TransLO) and **RegFormer GitHub** (https://github.com/IRMVLab/RegFormer) are available for the transformer-based methods.

---

## Sources

| Paper | URL |
|---|---|
| LO-Net (CVPR 2019) | https://arxiv.org/abs/1904.08242 |
| LO-Net CVPR open-access | https://openaccess.thecvf.com/content_CVPR_2019/html/Li_LO-Net_Deep_Real-Time_Lidar_Odometry_CVPR_2019_paper.html |
| LO-Net IEEE Xplore | https://ieeexplore.ieee.org/document/8954330 |
| DeepLO (arXiv 2019, ICRA 2020) | https://arxiv.org/abs/1902.10562 |
| DeepLO project page | https://sites.google.com/view/deeplo |
| DeepPCO (IROS 2019) | https://arxiv.org/abs/1910.11088 |
| DMLO (arXiv 2020) | https://arxiv.org/abs/2004.03796 |
| PWCLO-Net (CVPR 2021) | https://arxiv.org/abs/2012.00972 |
| PWCLO-Net GitHub | https://github.com/IRMVLab/PWCLONet |
| EfficientLO-Net (PAMI 2022) | https://arxiv.org/abs/2111.02135 |
| EfficientLO-Net GitHub | https://github.com/IRMVLab/EfficientLO-Net |
| DeLORA (ICRA 2021) | https://arxiv.org/abs/2011.05418 |
| DeLORA GitHub | https://github.com/leggedrobotics/delora |
| DELO (ICCV 2023 workshop) | https://arxiv.org/abs/2308.07153 |
| TransLO (AAAI 2023) | https://ojs.aaai.org/index.php/AAAI/article/view/25256 |
| TransLO GitHub | https://github.com/IRMVLab/TransLO |
| RegFormer (ICCV 2023) | https://arxiv.org/abs/2303.12384 |
| RegFormer GitHub | https://github.com/IRMVLab/RegFormer |
| DGR (CVPR 2020) | https://github.com/chrischoy/DeepGlobalRegistration |
| PREDATOR (CVPR 2021) | https://arxiv.org/abs/2011.13005 |
| PREDATOR GitHub | https://github.com/prs-eth/OverlapPredator |
| GeoTransformer (CVPR 2022) | https://arxiv.org/abs/2202.06688 |
| GeoTransformer GitHub | https://github.com/qinzheng93/GeoTransformer |
| Unsupervised LiDAR Feature Learning (2021) | https://arxiv.org/abs/2102.11261 |
| DFLIOM (2024) | https://arxiv.org/abs/2410.02961 |
| KISS-ICP (RA-L 2023) | https://arxiv.org/abs/2209.15397 |
| KISS-ICP GitHub | https://github.com/PRBonn/kiss-icp |
| FAST-LIO2 (T-Robotics 2022) | https://arxiv.org/abs/2107.06829 |
| FAST-LIO2 GitHub | https://github.com/hku-mars/FAST_LIO |
| KITTI Odometry Benchmark | https://www.cvlibs.net/datasets/kitti/eval_odometry.php |

Local context:
- [KISS-ICP](./kiss-icp.md) — classical no-IMU LO benchmark
- [FAST-LIO / FAST-LIO2](./fast-lio-fast-lio2.md) — IMU-tight production benchmark
- [LOAM](./loam.md) — feature-based LO predecessor
- [CT-ICP](./ct-icp.md) — continuous-time ICP competitor
- [LIO-SAM](./lio-sam.md) — factor-graph LIO comparison
- [DROID-SLAM](./droid-slam.md) — learned visual SLAM sibling
- [MASt3R-SLAM](./mast3r-slam.md) — learned visual SLAM sibling
- [Splat-SLAM](./splat-slam.md) — neural-rendering SLAM sibling
- [Learned LiDAR Place Recognition](./learned-lidar-place-recognition.md) — learned loop-closure sibling
- [Production LiDAR Map Localization](../overview/production-lidar-map-localization.md)
- [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md)
- [Point Cloud Registration Math — ICP, NDT, GICP](../../../10-knowledge-base/geometry-3d/point-cloud-registration-math-icp-ndt-gicp.md)
- [Foundation Model Training First Principles](../../../10-knowledge-base/machine-learning/foundation-model-training-first-principles.md)
