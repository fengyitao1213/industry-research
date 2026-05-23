# Camera Projective Geometry, PnP, and Triangulation

<!-- kb-visual:start -->
![Camera Projective Geometry, PnP, and Triangulation curated visual](../_assets/visuals/geometry-3d-camera-projective-geometry-pnp-triangulation.svg)

*Visual: camera-pose and landmark geometry showing projection rays, PnP pose constraints, triangulation intersection, reprojection residuals, and degeneracy cases.*
<!-- kb-visual:end -->

Cameras measure rays, not depth. Projective geometry is the bookkeeping that
connects 3D points, camera intrinsics, camera extrinsics, image measurements,
and multi-view constraints. PnP estimates a camera pose from 3D-to-2D
correspondences; triangulation estimates 3D points from 2D measurements across
known camera poses. The two-view model-selection layer for 2D-to-2D matches is
split into [Epipolar Geometry, Homographies, and Two-View Verification](epipolar-geometry-homographies-two-view.md)
so this page can stay focused on projection, PnP, and triangulation. Together,
these are first-principles building blocks for calibration, localization,
visual SLAM, and map validation.

In a LiDAR-primary segmentation system — the core workflow for airside AV and
aggregated-map pipelines — projective geometry is the bridge that lets the 2D
image domain contribute to 3D point-cloud understanding: calibrated projection
enables RGB colorization of map points, 2D-to-3D feature distillation, open-
vocabulary CLIP lifting, and automated 2D-to-3D label propagation. Getting it
wrong — by a stale calibration, a frame convention mismatch, or an OpenCV API
misuse — silently corrupts every downstream step.

---

## 1. Related Docs

- [Camera Imaging, Noise, and Calibration](camera-imaging-noise-calibration.md)
- [Coordinate Frames, Projections, and SE(3)](coordinate-frames-projections-se3.md) — camera frame conventions and axis handedness
- [Epipolar Geometry, Homographies, and Two-View Verification](epipolar-geometry-homographies-two-view.md) — two-view model selection, robust verification, and degeneracy handling
- [Lie Groups SE(3), SO(3), Adjoints, and Jacobians](lie-groups-se3-so3-jacobians.md) — rotation parameterization underpinning extrinsics
- [Sensor Calibration and Time Synchronization](sensor-calibration-time-synchronization.md) — extrinsic calibration, LiDAR-camera offset estimation
- [Aggregated-Map Semantic Segmentation](../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md) — §4.2 and §4.3 cover LiDAR+image fusion directly
- [2DPASS Method Page](../../30-autonomy-stack/perception/methods/2dpass.md) — multi-scale feature distillation using camera projection
- [OpenScene Method Page](../../30-autonomy-stack/perception/methods/openscene.md) — CLIP feature lifting via calibrated projection
- [Mosaic3D Method Page](../../30-autonomy-stack/perception/methods/mosaic3d.md) — open-vocab 3D understanding via contrastive image alignment

---

## 2. Why the Camera Matters in a LiDAR Segmenter

| Mechanism | How projection is used | What breaks if projection is wrong |
|---|---|---|
| RGB colorization | Each map point projects to its image pixel; weighted blending over N frames gives stable per-point color. | Color seams, double-coloring, RGB-geometry misalignment in the training cloud. |
| 2D-to-3D feature distillation | 2DPASS (ECCV 2022) projects image backbone features onto LiDAR space; SLidR (CVPR 2022) matches superpixels with point groups; ScaLR (CVPR 2024) scales to DINOv2 teacher features. All use `P_cam = K [R|t] P_lidar`. | Distillation loss aligns mismatched pixel-point pairs; the 3D network learns the wrong semantics. |
| Open-vocabulary feature lifting | OpenScene (CVPR 2023) and Mosaic3D (arXiv 2502.02548) associate each 3D point with its projected CLIP pixel feature, embedding 3D space in CLIP language space. | Zero-shot language queries find wrong regions; sub-pixel misalignment breaks the co-embedding. |
| Panoptic data engines | 2D segmentation results are back-projected to assign per-point labels; label diffusion (LDLS) propagates seeds through 3D graphs. | Systematic projection errors seed wrong labels across the training set. |
| Camera localization | PnP estimates `T_camera_map` from map landmarks or known calibration targets. | Vehicle appears lane-correct but camera pose is mirrored or behind the scene. |
| Visual odometry / SLAM | Triangulated tracks create motion constraints across keyframes. | Low-baseline tracks produce unstable scale and depth. |
| HD map QA | Reprojected poles, signs, lane markings, and landmarks validate map alignment. | System reports false map change because datum, frame, or camera convention is wrong. |

---

## 3. Core Math

### 3.1 Pinhole Camera — Central Projection

The pinhole model approximates a camera as a single center of projection (CoP)
through which all light rays pass before striking the image plane at focal
distance `f`.

**Intrinsic matrix K:**

```text
    [ fx   s   cx ]
K = [  0  fy   cy ]
    [  0   0    1 ]
```

- `fx`, `fy` — focal lengths in pixel units (`fx = f / sx` where `sx` is the
  horizontal pixel pitch). For square pixels `fx ≈ fy`.
- `cx`, `cy` — principal point: image-plane intersection of the optical axis,
  in pixels. Typically near but not exactly at image center.
- `s` — skew coefficient; essentially zero on all modern CMOS/CCD sensors.
  OpenCV's `calibrateCamera` can estimate it but it is not advised without
  strong evidence of non-zero skew.

**World-to-image projection chain.** Given a 3D world point `P_w = [Xw Yw Zw]^T`:

```text
Step 1 — world to camera frame:
    P_c = R * P_w + t        (R in SO(3), t in R^3 are the extrinsics)

Step 2 — normalize to image plane:
    x' = Xc / Zc
    y' = Yc / Zc

Step 3 — apply distortion (Section 3.2):
    (x', y') -> (x'', y'')

Step 4 — apply intrinsics:
    u = fx * x'' + cx
    v = fy * y'' + cy
```

In homogeneous matrix form (before distortion):

```text
lambda * [u v 1]^T  =  K [R | t]  [Xw Yw Zw 1]^T
```

where `lambda = Zc` is the projective depth. The `3 x 4` camera projection
matrix is `P = K [R | t]`.

Most OpenCV camera APIs use the optical camera convention:

```text
x right, y down, z forward (into scene)
```

That differs from the ROS REP-103 vehicle body convention used by most AV
pipelines (`x forward, y left, z up`). See
[Coordinate Frames, Projections, and SE(3)](coordinate-frames-projections-se3.md)
for the rotation that converts between them.

The projection model is undefined for points with `Zc <= 0`; those points are
behind the camera and must fail cheirality checks immediately.

---

### 3.2 Lens Distortion Models

Real lenses deviate from the ideal pinhole. All models operate on the
normalized (pre-K) image coordinate `(x', y')` where `r^2 = x'^2 + y'^2`.

#### Brown-Conrady — OpenCV Polynomial Model

The full OpenCV `calib3d` model has up to 14 parameters:
`(k1, k2, p1, p2 [, k3 [, k4, k5, k6 [, s1, s2, s3, s4 [, taux, tauy]]]])`

The 8-coefficient rational model (`k1..k6, p1, p2`):

```text
x'' = x' * (1 + k1*r^2 + k2*r^4 + k3*r^6) / (1 + k4*r^2 + k5*r^4 + k6*r^6)
      + 2*p1*x'*y' + p2*(r^2 + 2*x'^2)

y'' = y' * (1 + k1*r^2 + k2*r^4 + k3*r^6) / (1 + k4*r^2 + k5*r^4 + k6*r^6)
      + p1*(r^2 + 2*y'^2) + 2*p2*x'*y'
```

Then: `u = fx * x'' + cx`, `v = fy * y'' + cy`.

- `k1..k3` — numerator radial polynomial. Positive `k1` produces barrel
  distortion; negative produces pincushion.
- `k4..k6` — denominator rational extension; needed only for very wide FOV or
  fisheye-like lenses; normally left zero for automotive cameras.
- `p1, p2` — tangential (decentering) terms arising from lens tilt or
  sensor-lens misalignment.
- `s1..s4` — thin-prism terms; only for precision metrology cameras.
- `taux, tauy` — tilted-sensor (Scheimpflug) terms; only for specialized optics.

The classic 5-parameter model `(k1, k2, p1, p2, k3)` captures >95% of
distortion for typical automotive cameras at 60–120 deg FOV. Introducing
higher-order terms without sufficient calibration data leads to over-fitting.

Note: OpenCV stores coefficients in `distCoeffs` as
`[k1, k2, p1, p2, k3, k4, k5, k6]` — not ascending polynomial order.

#### Fisheye / Equidistant — Kannala-Brandt (OpenCV fisheye Namespace)

OpenCV's `fisheye` module implements the Kannala-Brandt (2006) equidistant
model. It maps incidence angle `theta = atan2(r, 1)` (angle between optical
axis and ray) to a distorted angle:

```text
theta_d = theta * (1 + k1*theta^2 + k2*theta^4 + k3*theta^6 + k4*theta^8)

x'' = theta_d * x' / r
y'' = theta_d * y' / r
```

Handles FOVs up to ~180 deg without the division-by-zero singularity that
plagues polynomial radial models at large angles. Preferred for SLAM and
visual odometry because angular resolution is nearly uniform edge-to-edge.
Use `cv::fisheye::calibrate()` and `cv::fisheye::undistortPoints()`.

#### Mei Unified Sphere Model (UCM)

The Mei (also Geyer-Daniilidis) model adds a single mirror parameter `xi`
that controls the virtual sphere used for unified projection. A 3D point is
first normalized onto a unit sphere, then linearly projected with `K` to the
image. The inverse has a closed-form analytic solution. Covers parabolic,
hyperbolic, and ellipsoidal catadioptric mirrors plus fisheye lenses under one
framework. Computationally inexpensive (no polynomial). Assumes a central
camera; fails for off-axis or non-central catadioptric setups.

#### Scaramuzza / OCamCalib Polynomial

Scaramuzza's model (IROS 2006) represents the omnidirectional projection
function `f(rho)` as a polynomial in the radial image distance `rho` (not in
angle). Degree N is chosen empirically (typically N=3 or 4 by minimizing
reprojection error). Supports cameras up to 195 deg FOV. The reference
implementation is the OCamCalib MATLAB toolbox; a Python port exists at
`github.com/jakarto3d/py-OCamCalib`.

#### Undistort-then-project vs. Distort-the-projection

Two equivalent workflows exist:

```text
Workflow A — undistort-first (preferred for feature matching):
  Undistort raw image -> undistorted image with ideal pinhole behavior
  Apply standard pinhole math to undistorted pixels

Workflow B — distort-the-projection (used in calibration and projection):
  Take 3D point, compute ideal normalized coords (x', y')
  Apply distortion equations to get (x'', y'')
  Apply K to get pixel (u, v)
```

When projecting LiDAR points to image, workflow B is standard: apply the
distortion forward and check pixel bounds. When running epipolar geometry on
feature matches, undistort the pixel observations first (workflow A) so the
ideal pinhole `F` and `E` formulations apply cleanly.

---

### 3.3 Homogeneous Coordinates and the Full Projection Chain

Homogeneous coordinates embed `R^n` in projective space `P^n`: the 2D point
`(x, y)` maps to `(x, y, 1)`, and any non-zero scalar multiple `(kx, ky, k)`
represents the same image point. This allows perspective projection to be
expressed as a linear matrix multiply.

The full `3 x 4` camera matrix `P = K [R | t]` has 11 independent degrees of
freedom (5 intrinsic + 3 rotation + 3 translation, minus 1 for scale):

```text
         [fx  s  cx  0] [r11 r12 r13 t1] [Xw]
lambda * [v] = [ 0 fy  cy  0] [r21 r22 r23 t2] [Yw]
         [1]   [ 0  0   1  0] [r31 r32 r33 t3] [Zw]
                                                [ 1]
       = P * P_w_homog
```

**Stereo depth from disparity.** For a calibrated stereo pair with parallel
optical axes, baseline `b`, shared focal length `f`, and horizontal disparity
`d = u_L - u_R` (in pixels):

```text
Z = (b * f) / d
sigma_Z ~= (b * f * sigma_d) / d^2
```

Depth uncertainty scales as `Z^2`. A wider baseline `b` improves accuracy at
range. Small disparity at long range means large depth uncertainty — the
fundamental stereo limitation that makes LiDAR necessary for AV.

---

### 3.4 Camera Calibration

#### Zhang Plane-Based Method (IEEE PAMI 2000)

Zhang's method is the de-facto standard for camera intrinsic calibration.
Requirements: a planar pattern (checkerboard) shown in at least 3
non-coplanar orientations.

Each view yields a homography `H = K [r1 | r2 | t]` (3×3). Because `r1` and
`r2` are orthonormal columns of `R`, two linear constraints on `K` arise per
view. With three or more views the closed-form solution for all 5 intrinsic
parameters follows. Extrinsics are solved per-view. A subsequent nonlinear
refinement minimizes reprojection error over all views jointly.

Reprojection error (RMS pixels) is the standard quality metric:

```text
e_rms = sqrt( (1/N) * sum_i || p_i - proj(P_i; K, D, [R|t]) ||^2 )
```

A value below 0.5 px is typically acceptable for automotive camera
calibration. Values above 1.0 px indicate a problem with the calibration data,
pattern detection, or distortion model.

#### Calibration Targets

| Target | Pros | Cons |
|---|---|---|
| Checkerboard | Subpixel-accurate corners; universal tool support | Full board must be visible; rotation ambiguity |
| ChArUco | Partial visibility OK (30–40% sufficient); unique corner IDs; no rotation ambiguity | Requires accurately printed ArUco markers |
| AprilGrid (Kalibr) | Codes survive partial occlusion; strongly recommended for multi-camera rigs | Less common in OpenCV toolchain |
| Circle grid | Dense samples; isotropic precision | Harder centroid localization under distortion |

ChArUco (OpenCV `aruco` module) provides subpixel-precise chessboard corners
interpolated from ArUco marker detections, making it superior for fisheye and
wide-FOV calibration where the board must reach image corners.

#### When to Recalibrate

- **Thermal effects**: focal length can shift ~0.1–0.3% over a 40 °C
  temperature range. For airside AV operations at extreme temperatures,
  thermal-model calibration or on-the-fly self-calibration is advisable.
- **Vibration or mechanical shock**: can shift lens-sensor alignment; monitor
  reprojection error on known targets during operation.
- **Sensor replacement or windshield change**: full recalibration required.
- **Kalibr** (ETH ASL) supports rolling-shutter intrinsic calibration and
  camera-IMU temporal calibration using AprilGrids in ROS bag format.

---

### 3.5 PnP — Problem Statement

Perspective-n-Point (PnP) solves for the 6-DOF camera pose given:

```text
Input:  n 3D-2D correspondences { (P_i^w, p_i) | i = 1..n }
        intrinsic matrix K
        (optionally) distortion coefficients D
Output: camera pose [R | t]
```

The projection constraint for each point:

```text
lambda_i * [u_i v_i 1]^T = K (R * P_i^w + t)
```

Eliminating `lambda_i` gives 2 linear equations per point. With `n = 3` (P3P),
the system is minimal and produces up to 4 solutions. With `n > 4`, the
overdetermined system is solved by minimizing total reprojection error:

```text
minimize over R, t:
    sum_i rho( || z_i - project(K, D, R * X_i + t) ||^2 )
```

where `rho` is often a robust loss or a RANSAC inlier rule.

#### P3P Geometry

With 3 correspondences, the law of cosines applied to the triangle formed by
the camera CoP and the two 3D points in camera frame gives three quadratic
equations in the unknown depths `|OA'|, |OB'|, |OC'|`. This reduces to a
degree-4 polynomial with up to 4 real solutions. A 4th reference point
resolves the ambiguity via a cheirality check.

---

### 3.6 PnP Solver Lineage

#### DLT (Direct Linear Transform)

Treats each correspondence as contributing two linear constraints on the
12-element vector of `[R | t]`. Constructs a `2n × 12` matrix `A`, solves
`A x = 0` via SVD (last right singular vector). Rotation is recovered by
nearest-SO(3) projection (polar decomposition). Accuracy degrades below ~6
points. Used as initialization for iterative refinement.

#### P3P Solvers

**Grunert (1841):** original quartic polynomial formulation, 4 real roots.

**Lambda Twist (Persson and Nordberg, ECCV 2018):** avoids the quartic;
exploits elliptic equations via a single real root of a cubic, then finds up
to 4 P3P solutions. Faster and more numerically stable than prior quartic
solvers; never returns geometrically invalid solutions.
Reference code: `github.com/vlarsson/lambdatwist`.

**AP3P (Ke and Roumeliotis, CVPR 2017):** algebraic approach; claimed faster
than Lambda Twist in certain configurations. Integrated in OpenCV as
`SOLVEPNP_AP3P`.

#### EPnP (Lepetit, Moreno-Noguer, and Fua, IJCV 2009)

Key idea: express all n reference points as a weighted sum of 4 virtual
control points (centroid + PCA directions of the point cloud):

```text
P_i^c = sum_{j=1}^{4} alpha_{ij} * c_j^c    where sum(alpha_ij) = 1
```

The 12 unknown control-point coordinates in camera frame are expressed as a
linear combination of eigenvectors of a `12 × 12` matrix. Solving a small
quadratic system determines the coefficients. Complexity: `O(n)`. Optional
Gauss-Newton refinement converges in fewer than 5 iterations. Benchmark:
~1–2 px reprojection error at `n = 4`, comparable to iterative at large n.

#### DLS (Hesch and Roumeliotis, 2011)

Direct Least Squares; reformulates as a polynomial eigenvalue problem.
**The OpenCV `SOLVEPNP_DLS` implementation is broken and silently falls back
to EPnP (confirmed in OpenCV 4.x documentation). Do not rely on it.**

#### UPnP

Estimates unknown focal lengths `fx`, `fy` jointly with pose.
**Also broken in OpenCV 4.x; also falls back to EPnP. Do not use.**

#### SQPnP (Terzakis and Lourakis, ECCV 2020) — Current SOTA

Casts PnP as a sequentially quadratic program (SQP) over the 9-sphere of
rotation parameterizations. Identifies all local minima on the rotation
manifold, guaranteeing that at least one is the global minimum. Works for
`n >= 3`; handles coplanar and non-coplanar configurations uniformly without
special cases. Integrated into OpenCV 4.x as `cv::SOLVEPNP_SQPNP`. This is
the recommended default for non-minimal (`n > 4`) problems.

#### OpenCV solvePnP Flag Summary

| Flag | Min pts | Notes |
|---|---|---|
| `SOLVEPNP_ITERATIVE` | 4 (planar) / 6 | DLT init + Levenberg-Marquardt refinement |
| `SOLVEPNP_P3P` | 4 | Exactly 4 pts; up to 4 solutions |
| `SOLVEPNP_AP3P` | 4 | Ke and Roumeliotis; exactly 4 pts |
| `SOLVEPNP_EPNP` | >=4 | O(n) control-point method |
| `SOLVEPNP_DLS` | >=4 | **BROKEN** — falls back to EPnP silently |
| `SOLVEPNP_UPNP` | >=4 | **BROKEN** — falls back to EPnP silently |
| `SOLVEPNP_IPPE` | >=4 | Coplanar targets only (Collins and Bartoli) |
| `SOLVEPNP_IPPE_SQUARE` | 4 | Marker square (ArUco) |
| `SOLVEPNP_SQPNP` | >=3 | Globally optimal; recommended general-use default |

---

### 3.7 Robust PnP with RANSAC

```text
cv::solvePnPRansac(objectPoints, imagePoints, K, distCoeffs,
                   rvec, tvec, ...)
```

Standard RANSAC loop:

1. Randomly sample minimal subset (3 pts for P3P minimal step).
2. Estimate pose from subset.
3. Project all n points; count inliers where
   `||p_i - proj(P_i)||_2 < epsilon` (reprojection threshold in pixels).
4. Repeat for `N_iter` iterations; retain hypothesis with most inliers.
5. Re-estimate final pose on all inliers using a non-minimal solver
   (default: EPnP; replace with SQPnP for best accuracy).

Key parameters:

- `reprojectionError` (px): inlier threshold; typically 2–8 px for urban AV
  cameras; tighter (1–2 px) for calibration validation.
- `iterationsCount`: typically 100–1000. RANSAC theory:
  `N = log(1 - p) / log(1 - (1 - e)^s)` where `p = 0.99`, `e` = outlier
  fraction, `s` = sample size (3 for P3P).
- `confidence`: stopping criterion (default 0.99).

When the flag is `SOLVEPNP_P3P` or `SOLVEPNP_AP3P`, the final inlier-set
re-estimation uses `SOLVEPNP_EPNP`, not the P3P solver (P3P is minimal only).

---

### 3.8 Triangulation

Given two camera matrices `P1 = K1 [R1 | t1]` and `P2 = K2 [R2 | t2]` and
corresponding undistorted pixel observations `p1`, `p2`, triangulation
estimates the homogeneous 3D point `X` such that:

```text
p1 cross (P1 X) = 0
p2 cross (P2 X) = 0
```

In theory the two back-projected rays intersect; in practice they are skew due
to noise.

#### Linear DLT Triangulation

Each image observation contributes 2 linear equations; stacking for both
views gives `A X_homog = 0` (4×4); solve by SVD, take last right singular
vector, normalize. The Euclidean point is:

```text
X_euclidean = [X0/X3, X1/X3, X2/X3]
```

Fast and simple; not algebraically optimal under noise.
`cv::triangulatePoints` uses this method.

#### Midpoint Method

Find the 3D point `P` minimizing the sum of squared distances to both
back-projection rays (the midpoint of the common perpendicular). Closed form
and fast; not statistically optimal.

#### Hartley-Sturm Optimal Triangulation (CVIU 1997)

Minimizes reprojection error — the L2-optimal criterion under Gaussian noise:

```text
minimize ||p1 - p1*||^2 + ||p2 - p2*||^2
subject to: p2*^T F p1* = 0   (epipolar constraint exactly satisfied)
```

Hartley and Sturm showed this reduces to finding roots of a **degree-6
polynomial** in a single scalar parameter `t`. Up to 6 stationary points
exist; the global minimum is found by evaluating the cost at each root and
at the endpoints. A known singularity occurs when the epipole lies at one of
the correspondences (degenerate forward-motion); in that case the epipole
itself is the answer and must be handled separately.

`cv::triangulatePoints` uses DLT, not Hartley-Sturm. For optimal
triangulation implement the degree-6 polynomial solver manually or use
COLMAP's triangulator.

#### Depth Uncertainty in Stereo

For stereo with baseline `b`, focal length `f`, disparity `d`, and disparity
noise `sigma_d`:

```text
Z = f * b / d
sigma_Z ~= f * b * sigma_d / d^2
```

Small disparity at long range means large depth uncertainty — the fundamental
stereo limitation that motivates LiDAR-primary sensing.

---

### 3.9 Multi-View Geometry — Essential, Fundamental, and Epipolar

#### Essential Matrix

Encodes relative pose `(R, t)` between two **calibrated** cameras:

```text
E = [t]_x * R
```

where `[t]_x` is the 3×3 skew-symmetric cross-product matrix of `t`.

Epipolar constraint (calibrated):

```text
x2^T * E * x1 = 0
```

where `x1 = K1^-1 * p1`, `x2 = K2^-1 * p2` are metric (normalized) image
coordinates. `E` has rank 2; its singular values are `(sigma, sigma, 0)`.
Recovering `(R, t)` from E yields 4 candidate solutions; cheirality check
selects the correct one.

#### Fundamental Matrix

For **uncalibrated** cameras:

```text
F = K2^{-T} * E * K1^{-1} = K2^{-T} * [t]_x * R * K1^{-1}
```

Epipolar constraint in pixel coordinates:

```text
p2^T * F * p1 = 0
```

`F` is rank-2 and determined up to scale (7 DOF).

#### 8-Point Algorithm (Hartley 1997)

For `n >= 8` correspondences, each pair contributes one linear equation in the
9-element vectorization of `F`. Stacking gives `A f = 0` (n×9); solve by SVD.
The rank-2 constraint is enforced by zeroing the smallest singular value in a
second SVD.

Hartley's normalization is essential: translate and scale image coordinates so
centroid = origin and mean distance from origin = sqrt(2) **before** building
`A`. This dramatically improves numerical stability and is not optional.

---

## 4. Sparse LiDAR-to-Image Projection Recipe

For each LiDAR point `P_L = [XL, YL, ZL]^T` in a single-scan or aggregated
map context:

```text
Step 1 — transform to camera frame:
    P_C = R_LC * P_L + t_LC
    using the LiDAR-camera extrinsic calibration
    discard points with Zc <= 0 (behind camera)

Step 2 — optional range filter:
    discard Zc > range_max (e.g. 80 m) to avoid projecting weak far returns

Step 3 — normalize:
    x' = Xc / Zc
    y' = Yc / Zc

Step 4 — apply distortion (Section 3.2):
    (x', y') -> (x'', y'')

Step 5 — apply K:
    u = fx * x'' + cx
    v = fy * y'' + cy

Step 6 — bounds check:
    keep only points with 0 <= u < W and 0 <= v < H

Step 7 — depth buffer for occlusion:
    for overlapping projections, keep smallest Zc (nearest point wins)
```

#### Rolling-Shutter Caveat for Moving Cameras

Consumer-grade and many automotive cameras expose each row at a different time
(CMOS rolling shutter; typically 1/30 s frame period spread over H rows). For
a moving vehicle at ~10 m/s, the vehicle travels ~3 mm between row 0 and row H
within a single frame. This is negligible for feature matching but is
meaningful for sub-pixel colorization in HD maps and for per-point feature
lifting.

Compensation:

```text
t_row = t_frame_start + (row_i / H) * t_frame_duration
```

Interpolate the vehicle ego-motion at `t_row` to get a per-row refined
extrinsic `R_LC(t_row)`, `t_LC(t_row)`. Kalibr provides rolling-shutter
camera calibration including readout-time estimation.

---

## 5. Aggregated-Map Segmentation — Camera Geometry Specifics

In a multi-scan aggregated LiDAR map (airside AV or urban survey context),
each physical 3D point appears in potentially dozens to hundreds of camera
frames as the vehicle traverses the same zone. The sections below detail
camera-geometry specifics for each fusion pattern.

### 5.1 Multi-Pass Weighted Colorization

For each 3D map point `P`:

1. Find all camera frames `{i}` where P projects within image bounds and is
   not occluded (depth buffer check).
2. For each frame `i`, sample the image at `(u_i, v_i)` using bilinear
   interpolation.
3. Aggregate with weighted mean over frames. Suggested weights:
   - Distance to image center: penalize extreme fisheye distortion at edges.
   - Incidence angle `cos(theta)` between viewing direction and surface normal
     (if normal is available from the map).
   - Depth buffer confidence: ensure the point is not occluded by closer
     geometry in that frame.
   - Temporal: avoid frames with motion blur or exposure anomalies.

For feature distillation (SLidR / ScaLR / OpenScene style), the feature
vector sampled at each frame is aggregated by mean pooling or max pooling
over all visible frames.

### 5.2 2D-to-3D Feature Lifting — 2DPASS / SLidR / ScaLR Pattern

At training time:

1. Forward-pass the image through a 2D backbone (e.g., DINOv2 ViT) to
   produce a dense feature map `F_2D [H, W, C]`.
2. For each LiDAR point, project to `(u, v)` using the full pipeline
   (Section 4) and bilinearly sample `F_2D` → per-point feature vector.
3. Apply a distillation loss (contrastive for SLidR/ScaLR; MSFSKD for
   2DPASS) between the sampled per-point feature and the 3D network output.

At inference time the 3D network runs standalone; no camera or image is
required. The camera geometry shapes the learned feature space only during
training.

### 5.3 Open-Vocabulary Feature Lifting — OpenScene / Mosaic3D Pattern

CLIP features are pixel-aligned in 2D. The training-time association is:

```text
feature_3D(P) <- CLIP_pixel_feature( proj(P, K, [R|t]) )
```

The resulting 3D feature space is co-embedded with CLIP text features,
enabling zero-shot language queries (`"aircraft tow tractor"`,
`"jet blast deflector"`, `"hold-short line"`) directly in 3D space.
Sub-pixel projection accuracy is required: a 2-pixel error can associate
a LiDAR surface point with the CLIP feature of an adjacent object, polluting
the co-embedding and degrading zero-shot recall.

### 5.4 Label Back-Projection

Run a 2D segmentation model to produce a pixel label map. For each LiDAR
point, sample the label at its projected pixel `(u, v)`. Strategies to
improve stability:

- **Multi-frame voting**: majority label over N visible frames for static
  objects.
- **Temporal filtering**: for dynamic objects (aircraft moving through the
  map), filter by frame timestamp so only frames when the object was
  stationary contribute.
- **Confidence weighting**: use the 2D model's softmax confidence as a weight
  in the vote to down-weight uncertain predictions.

### 5.5 Rolling-Shutter Per-Row Correction for Moving-Vehicle Cameras

For airside or road AV with rolling-shutter cameras at speed, apply the
per-row extrinsic correction from Section 4 before projecting to ensure
that each LiDAR point is associated with the camera row whose exposure timing
matches the IMU pose at that instant. At 5 m/s a 30 ms readout introduces up
to 15 cm of positional error at the top vs bottom of the frame — enough to
misplace a runway light by one row in the training map.

---

## 6. Algorithm Steps

### 6.1 Robust PnP Pose Estimate

1. Normalize or undistort image observations using the same calibration used
   by the projection code.
2. Build 2D-to-3D correspondences with point IDs, timestamps, and frame names.
3. Run a minimal solver (P3P / AP3P) inside RANSAC with a pixel threshold
   calibrated to detection noise (typically 2–4 px for HD map landmarks).
4. Reject hypotheses with negative depths, impossible height, or impossible
   vehicle motion (domain-aware sanity checks).
5. Refine the best-inlier pose using SQPnP or iterative LM on all inliers.
6. Report pose, inlier count, residual distribution, and Hessian quality.
7. Validate by reprojecting held-out points and checking spatial residual
   patterns across the image for systematic structure (edge-biased residuals
   indicate distortion model mismatch).

### 6.2 Multi-View Triangulation

1. Start with calibrated and time-synchronized camera poses.
2. Undistort observations or use a projection model that includes distortion.
3. Triangulate with linear DLT from the strongest baseline pair or all views.
4. Enforce cheirality: point depth must be positive in every contributing view.
5. Refine by minimizing reprojection error (Hartley-Sturm optimal or bundle
   adjustment depending on scale and accuracy requirements).
6. Filter by triangulation angle (require > 2–3 deg), covariance, reprojection
   residual, and track length.
7. Store the point in a documented map or anchor frame, never in a moving
   camera frame.

---

## 7. Implementation Notes

- In OpenCV, `solvePnP` estimates the transform from object/world coordinates
  into the camera frame. Name the output `T_camera_object` or convert it
  immediately to avoid sign errors.
- Use `solvePnPRansac` when correspondences come from feature matching,
  detector association, or semantic landmarks. Pass `SOLVEPNP_SQPNP` as the
  final inlier re-estimation flag for best accuracy.
- **Do not use `SOLVEPNP_DLS` or `SOLVEPNP_UPNP` in OpenCV 4.x.** Both are
  documented as broken and silently fall back to EPnP. Use `SOLVEPNP_SQPNP`
  as the default for n > 4 and `SOLVEPNP_AP3P` for the minimal RANSAC step.
- For planar calibration boards, use `SOLVEPNP_IPPE` or `SOLVEPNP_IPPE_SQUARE`
  and explicitly handle the two-pose ambiguity.
- Do not triangulate raw distorted pixels with an ideal pinhole matrix. Always
  undistort first or pass distortion coefficients through the projection.
- Use a minimum triangulation angle; one degree is typically too small for
  accurate AV-range depth. Two to three degrees is a practical lower bound.
- Use double precision for calibration and mapping; pixel residuals are small
  and normal equations become ill-conditioned in single precision.
- `cv::triangulatePoints` uses linear DLT. For optimal accuracy implement the
  Hartley-Sturm degree-6 polynomial or use COLMAP's triangulator.
- Keep image timestamp, exposure midpoint, rolling-shutter model, and vehicle
  pose interpolation together. Geometry cannot compensate for temporal
  misalignment.
- The OpenCV `distCoeffs` vector ordering is `[k1, k2, p1, p2, k3, k4, k5, k6]`
  — not ascending polynomial order. Match the coefficient vector dimensionality
  exactly to the calibration that produced it.
- For Kannala-Brandt fisheye, use the `cv::fisheye` namespace functions, not
  the standard `cv::undistortPoints`; the two use different distortion math.

---

## 8. Library Landscape

| Library | Role | Key camera-geometry capabilities |
|---|---|---|
| OpenCV `calib3d` | Standard C++/Python | `calibrateCamera`, `solvePnP` (all solvers including SQPnP), `solvePnPRansac`, `triangulatePoints`, `stereoCalibrate`, fisheye namespace, ChArUco; docs: docs.opencv.org/4.x/d9/d0c/group__calib3d.html |
| Kalibr (ETH ASL) | Multi-camera + IMU calibration | Rolling-shutter intrinsics + readout time; camera-IMU temporal offset; AprilGrid support; ROS bag input |
| COLMAP | SfM + MVS | Incremental SfM: feature extraction, matching, optimal triangulation, bundle adjustment; 9 camera models (pinhole, radial, fisheye); colmap.github.io |
| Open3D | Point cloud processing | `PinholeCameraIntrinsic`; RGBD integration; colored ICP; Python/C++; open3d.org |
| GTSAM (Georgia Tech) | Factor-graph optimization | `Pose3`/`Cal3_S2` types; camera-IMU factor; stereo factor; iSAM2 for incremental BA; gtsam.org |
| Sophus | Lie group math (C++) | SO(3), SE(3), Sim(3) with Jacobians; used inside GTSAM, Basalt, Kimera |
| Basalt | VIO + calibration | Kalibr-compatible; stereo-inertial odometry with online calibration refinement |

---

## 9. Failure Modes and Diagnostics

| Symptom | Likely cause | Diagnostic |
|---|---|---|
| PnP solution places camera behind the target. | Ambiguous minimal solution or transform direction mistake. | Check depths of all 3D points in camera frame and draw projected axes on the image. |
| Reprojection residual grows near image edges. | Distortion model mismatch or undistorted/raw point mix. | Plot residual vectors by image location; edge-biased pattern confirms distortion issue. |
| Depth explodes for distant features. | Low disparity or narrow triangulation angle. | Plot depth uncertainty versus triangulation angle; require > 2 deg minimum. |
| Planar marker pose flips between two orientations. | Planar PnP ambiguity. | Use `SOLVEPNP_IPPE_SQUARE`, apply temporal continuity, or include off-plane points. |
| Camera localization is biased after hard braking. | Rolling shutter or timestamp offset. | Compare residuals against image row and vehicle angular velocity. |
| RANSAC finds many inliers but wrong pose. | Repeated structures or map association ambiguity. | Check semantic IDs, spatial distribution, and multiple-hypothesis scores. |
| LiDAR colorization has seam-like color shifts at scan boundaries. | Stale or per-frame extrinsic drift; rolling-shutter not compensated. | Compute per-frame reprojection error on known static targets; plot vs timestamp. |
| 2D-to-3D feature lifting produces noisy distillation loss. | Camera projection placing LiDAR points in wrong pixels; distortion model not applied in the lifting code. | Render projected points onto image as overlay; check alignment visually for a known frame. |
| OpenCV DLS / UPnP returns unexpected pose. | Broken implementation falling back silently to EPnP with incompatible API usage. | Switch to `SOLVEPNP_SQPNP`; never use DLS or UPnP in OpenCV 4.x. |
| Hartley-Sturm triangulation fails at forward motion. | Epipole singularity when epipole coincides with one correspondence. | Detect this case and fall back to midpoint or DLT; flag as degenerate. |

---

## 10. Quick-Reference Math Cheat Sheet

```text
# Full projection pipeline (world -> pixel with distortion)
P_c = R * P_w + t
x'  = P_c[0] / P_c[2],   y' = P_c[1] / P_c[2]
r^2 = x'^2 + y'^2

# Brown-Conrady (8-param rational):
x'' = x'*(1+k1*r^2+k2*r^4+k3*r^6)/(1+k4*r^2+k5*r^4+k6*r^6) + 2*p1*x'*y' + p2*(r^2+2*x'^2)
y'' = y'*(1+k1*r^2+k2*r^4+k3*r^6)/(1+k4*r^2+k5*r^4+k6*r^6) + p1*(r^2+2*y'^2) + 2*p2*x'*y'
u   = fx*x'' + cx
v   = fy*y'' + cy

# Kannala-Brandt fisheye:
theta   = atan2(r, 1)
theta_d = theta*(1 + k1*theta^2 + k2*theta^4 + k3*theta^6 + k4*theta^8)
x'' = theta_d * x'/r,   y'' = theta_d * y'/r

# Stereo depth
Z = b*f / (u_L - u_R),   sigma_Z ~= b*f*sigma_d / (u_L - u_R)^2

# Essential and fundamental matrices
E = [t]_x * R,                    x2^T E x1 = 0  (normalized coords)
F = K2^{-T} * [t]_x * R * K1^{-1},  p2^T F p1 = 0  (pixel coords)

# PnP — recommended solvers
[R,t] = solvePnPRansac(pts3d, pts2d, K, D, rvec, tvec,
                        SOLVEPNP_AP3P)       # minimal RANSAC step
[R,t] = solvePnP(pts3d_inliers, pts2d_inliers, K, D,
                  SOLVEPNP_SQPNP)            # inlier re-estimation (n>4)
# NOTE: SOLVEPNP_DLS and SOLVEPNP_UPNP are BROKEN in OpenCV 4.x

# Rolling-shutter per-row timing
t_row = t_frame_start + (row_i / H) * t_frame_duration
```

---

## 11. Sources

- OpenCV, "Perspective-n-Point (PnP) pose computation": https://docs.opencv.org/4.x/d5/d1f/calib3d_solvePnP.html
- OpenCV calib3d module documentation: https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html
- OpenCV calibration tutorial: https://docs.opencv.org/4.x/dc/dbb/tutorial_py_calibration.html
- Richard Hartley and Andrew Zisserman, "Multiple View Geometry in Computer Vision", Cambridge University Press: https://www.cambridge.org/core/books/multiple-view-geometry-in-computer-vision/0B6F289C78B2B23F596CAA76D3D43F7A
- Hartley and Zisserman book figures and errata, Oxford VGG: https://www.robots.ox.ac.uk/~vgg/hzbook/
- Z. Zhang, "A Flexible New Technique for Camera Calibration", IEEE PAMI 2000: https://opi-lab.github.io/topics-computer-vision/pdfs/PAMI_2000_Zhang.pdf
- Vincent Lepetit, Francesc Moreno-Noguer, and Pascal Fua, "EPnP: Efficient Perspective-n-Point Camera Pose Estimation": https://www.epfl.ch/labs/cvlab/software/multi-view-stereo/epnp/
- Terzakis and Lourakis, "A Consistently Fast and Globally Optimal Solution to the PnP Problem" (SQPnP), ECCV 2020: https://link.springer.com/chapter/10.1007/978-3-030-58452-8_28
- SQPnP reference implementation: https://github.com/terzakig/sqpnp
- Persson and Nordberg, "Lambda Twist: An Accurate Fast Robust PnP Solver", ECCV 2018: https://github.com/vlarsson/lambdatwist
- Kannala and Brandt, "A Generic Camera Model and Calibration Method for Conventional, Wide-Angle, and Fish-Eye Lenses", IEEE PAMI 2006: https://oulu3dvision.github.io/calibgeneric/Kannala_Brandt_calibration.pdf
- Hartley and Sturm, "Triangulation", CVIU 1997: http://perception.inrialpes.fr/Publications/1994/HS94/HartleySturm-cviu97.pdf
- Hartley, "In Defense of the Eight-Point Algorithm", IEEE PAMI 1997: https://users.cecs.anu.edu.au/~hartley/Papers/fundamental/fundamental.pdf
- Kalibr multi-camera and rolling-shutter calibration: https://github.com/ethz-asl/kalibr/wiki
- COLMAP Structure-from-Motion Revisited: https://colmap.github.io
- 2DPASS: Multi-Scale Fusion-Supervision for 3D Semantic Segmentation (ECCV 2022): https://arxiv.org/pdf/2207.04397
- OpenScene: 3D Scene Understanding with Open Vocabularies (CVPR 2023): https://arxiv.org/abs/2211.15654
- Mosaic3D (arXiv 2502.02548): https://arxiv.org/html/2502.02548v1
- ScaLR: https://github.com/valeoai/ScaLR
- ROS REP-103 camera optical frame convention: https://www.ros.org/reps/rep-0103.html
- Stanford CS231A Camera Models notes: https://web.stanford.edu/class/cs231a/course_notes/01-camera-models.pdf
