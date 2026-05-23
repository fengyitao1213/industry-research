# Coordinate Frames, Projections, and SE(3) for Autonomous Systems

<!-- kb-visual:start -->
![Coordinate Frames, Projections, and SE(3) for Autonomous Systems curated visual](../_assets/visuals/geometry-3d-coordinate-frames-projections-se3.svg)

*Visual: transform tree from map to odom to base to sensors to image plane, with SE(3) composition, projection, and common frame-error points.*
<!-- kb-visual:end -->

Coordinate conventions are not bookkeeping. They define what every position,
velocity, covariance, detection, map feature, and control command means. A
stack can have strong perception and planning models and still fail if one
frame is left-handed, one timestamp is late, or one map origin is silently
changed.

This page is the reusable foundation for 3D transforms, geodetic projections,
ROS/Autoware frame semantics, and SE(3) notation across road AV, indoor AMR,
outdoor industrial, and airport airside deployments.

---

## Related Docs

- [Lie Groups SE(3), SO(3), Adjoints, and Jacobians](lie-groups-se3-so3-jacobians.md) — the SE(3) Lie algebra (Exp/Log maps, Jacobians, Adjoint) that lives under every transform chain on this page
- [Sensor Calibration and Time Synchronization Fundamentals](sensor-calibration-time-synchronization.md) — extrinsics (`ego_T_lidar`) live in SE(3); how to measure, store, and monitor them
- [Rolling Shutter, LiDAR Deskew, and Motion Distortion](rolling-shutter-lidar-deskew-motion-distortion.md) — the time-varying-transform rule from Section 7 is the direct prerequisite for deskewing
- [Point Cloud Registration Math: ICP, NDT, GICP](point-cloud-registration-math-icp-ndt-gicp.md) — registration consumes the frame-correct aggregated cloud; map error budget connects here
- [Geodesy, Map Projections, and Datums](geodesy-map-projections-datums.md) — extended treatment of WGS-84, UTM, geoid height, and datum transformations

---

## 1. Why Frame Discipline Matters

Every point in an aggregated multi-scan LiDAR map carries a world-frame
coordinate that is the product of a chain of SE(3) transforms:

```
p_world = T_world_map  *  T_map_odom(t)  *  T_odom_ego(t)  *  T_ego_lidar  *  p_lidar
```

Each factor is estimated independently: GNSS/INS anchors the map, odometry
propagates the ego pose, and a one-time calibration procedure fixes the
ego-to-LiDAR rigid offset. If any two factors use inconsistent handedness or
axis conventions the product is silently wrong — the map is spatially coherent
but its axes are rotated or reflected relative to what the rest of the
pipeline expects.

### 1.1 Why It Matters

| Error class | Where it bites | Airside consequence |
|---|---|---|
| 90° LiDAR z-axis mis-orientation (z-up vs z-forward mix) | BEV grid cells wrong; ceiling labeled as ground | Apron surface mis-segmented; vehicle height estimates corrupted |
| ENU/NED mix at INS output | Map rotated 180° about East axis; north-south flip | All gate positions wrong; taxiway geometry inverted |
| Hamilton vs JPL quaternion at SLAM pose output | All rotation matrices are transpose of intended | Scan registration diverges; looks locally correct, globally wrong |
| Ouster Lidar frame vs Sensor frame confusion in `ego_T_lidar` | Map rotated ~180° about z | Scans land in wrong half of airport; duplicate structures |
| Motion transforms queried at bag-start time instead of point acquisition time | 100 ms sweep smears ~50 cm at 5 m/s | Painted taxiway markings wash out; hold-short lines undetectable |
| `map→odom` correction not applied (scans in odom frame) | Visible seam and duplicate structures at every loop closure | Aggregated apron cloud unusable for segmentation training |

The canonical silent failure mode is the **90-degree wrong-handed-axes** error:
a LiDAR calibration produced with a z-down convention consumed by a node
expecting z-up silently reflects every accumulated scan about the horizontal
plane. The map looks internally consistent; overlap metrics can even be low.
Only a sanity check — "do ground points have z ≈ 0?" — catches it.

> **Rule of thumb**: define, document, and enforce one convention at every
> interface between modules. A one-line comment `// world = ENU, z-up, ROS
> REP-103` in a header prevents multi-day debugging sessions.

**Scope across this KB**: this page covers the bookkeeping layer that every
other page in the segmentation KB depends on. The deskewing page requires the
per-point pose chain from Section 7. The calibration page defines
`ego_T_lidar` used in Section 6. The SLAM/LIO pages determine what values
populate `map_T_odom(t)`. Segmentation models (SphereFormer, RangeFormer)
consume the BEV and range-image projections from Section 5. Getting any link
in this chain wrong silently corrupts the input to all downstream steps.

---

## 2. SE(3) Review

### 2.1 The Group

SE(3) — the Special Euclidean group in 3D — is the set of all rigid-body
motions: rotations SO(3) plus translations in R^3. Its elements are
represented as **4×4 homogeneous transformation matrices**:

```
T = | R  t |    R in SO(3), t in R^3
    | 0  1 |
```

`R` is a 3×3 orthogonal matrix with det(R) = +1 (pure rotation, no
reflection). `t` is a 3×1 translation vector. The bottom row `[0 0 0 1]`
is the projective row that enables translation to be handled as matrix
multiplication.

A 3D point `p` in homogeneous coordinates is `[px, py, pz, 1]^T`. Applying T:

```
p_B = T_AB  *  p_A        (point expressed in frame A  ->  expressed in frame B)
```

Note the semantic carefully: `T_AB` means *"the transform that takes a point
expressed in frame B and expresses it in frame A"* — equivalently, *"the
pose of frame B described in frame A."* This is the robotics/GTSAM passive
convention (see Section 2.4).

### 2.2 Composition Rule

If `T_AB` is the pose of B in A, and `T_BC` is the pose of C in B, then
the pose of C in A is:

```
T_AC = T_AB * T_BC
```

The inner subscripts cancel: A<-B<-C yields A<-C. This **middle-subscript
cancellation** rule is the most reliable mental check. Example:

```
world_T_ego(t)  =  world_T_map  *  map_T_odom(t)  *  odom_T_ego(t)
```

The ego's world-frame pose is the product of: (1) the static map-to-world
anchor, (2) the slowly drifting odom-to-map correction published by the
localization node, (3) the continuously updated odom-frame ego pose.

If you instead wrote `imu_T_world * imu_T_lidar` the inner subscripts are
`world` and `imu` — they do not cancel, which signals that the chain is
wrong. No amount of testing will catch this if the first few scans happen to
look correct.

### 2.3 Inverse

Because `R` is orthogonal, `R^{-1} = R^T`. Therefore:

```
T^{-1} = | R^T  -R^T t |
          |  0      1  |
```

Proof: `T * T^{-1} = I` requires `R * R^T = I` (satisfied by SO(3)) and
`R * (-R^T t) + t = 0` (verified by substitution). The inverse is also in
SE(3). This closed-form inverse is cheaper than general 4×4 matrix inversion
and numerically exact for rotation matrices.

### 2.4 Active vs Passive Interpretation

- **Active (alibi)**: T rotates/translates the physical object. The
  coordinate frame stays fixed. Used in motion planning: "move the robot by T."
- **Passive (alias)**: T re-expresses a fixed point in a new coordinate
  frame. The point stays fixed; the frame moves. Used in sensor fusion:
  "express the LiDAR point in the ego frame."

Mathematically identical; the confusion arises because the passive
interpretation of T is the active interpretation of T^{-1}. ROS tf2 and most
SLAM literature use the passive interpretation: `T_AB` re-expresses vectors
from frame B into frame A.

### 2.5 The `world_T_sensor` Notation Convention

The most readable notation in SLAM literature writes the target (result)
frame as the **left subscript** and the source frame as the **right subscript**:
`world_T_sensor` transforms a vector from `sensor` frame into `world` frame.
GTSAM formalises this as `wTc` for "pose of camera c expressed in world w".

An alternative in some papers writes `T^{source}_{target}` as
superscript/subscript — these are equivalent; always confirm which direction
of transport is intended. The "A Standard Rigid Transformation Notation
Convention" (arXiv 2405.07351) provides a formal treatment of this notation
across robotics literature.

### 2.6 Lie Algebra, Small Errors, and Covariance

SE(3) poses live on a manifold, not in Euclidean vector space. Small pose
errors are represented in the tangent space `se(3)` as a 6-vector:

```
xi = [omega_x, omega_y, omega_z, v_x, v_y, v_z]
T  = Exp(xi)
xi = Log(T)
```

For uncertainty propagation through transform composition, the SE(3) adjoint
is the standard tool:

```
xi_A = Ad_T_AB * xi_B
Sigma_A = Ad_T_AB * Sigma_B * Ad_T_AB^T
```

If a LiDAR detection covariance is reported in the sensor frame and later
fused in `map`, this covariance rotation is not optional. See
[Lie Groups SE(3), SO(3), Adjoints, and Jacobians](lie-groups-se3-so3-jacobians.md)
for the full Exp/Log and Jacobian treatment.

---

## 3. Standard Frame Conventions

### 3.1 REP-103 / REP-105 (ROS)

**REP-103** mandates:

- All coordinate systems **right-handed**.
- Body/robot frames: **x forward, y left, z up**.
- ENU geographic frame: **x east, y north, z up** (used for the `map` frame
  when GNSS is available).
- NED secondary frames get a `_ned` suffix: **x north, y east, z down**.
- Camera/optical frames (suffix `_optical`): **z forward, x right, y down**.
- Quaternion order in `geometry_msgs/Quaternion`: **x, y, z, w**
  (Hamilton convention).
- Covariance arrays are **row-major float64**, ordering
  `[x, y, z, Rx, Ry, Rz]`.

**REP-105** defines the frame hierarchy for mobile platforms:

```
earth  ->  map  ->  odom  ->  base_link  ->  [sensor frames]
```

| Frame | Nature | Authority |
|---|---|---|
| `earth` | ECEF; anchors multiple map frames | Static publisher or GNSS |
| `map` | World-fixed, z-up, ENU default; may jump | Localization node (AMCL, SLAM) |
| `odom` | World-fixed, continuous, drifts | Odometry source (wheel, VIO, LIO) |
| `base_link` | Rigidly attached to robot base | URDF/robot_state_publisher |
| sensor frames | Fixed offset from base_link | URDF extrinsics (static TF) |

The map frame publishes `map->odom` (a correction transform), not
`map->base_link` directly. This keeps the `odom->base_link` chain continuous
and free of jumps — critical for real-time controllers.

### 3.2 ISO 8855 / SAE J670 (Automotive)

**ISO 8855:2011** defines the vehicle body axis system as: **+X forward,
+Y left, +Z up** — identical to REP-103 body convention. Right-handed.

**SAE J670e** (legacy, pre-2008) used aeronautical convention: **+X forward,
+Y right, +Z down** — left-handed when viewed from outside. This caused
decades of incompatibility with ISO 8855.

**SAE J670:2008** reconciles both by recognising both Z-Up and Z-Down axis
systems. SAE J670 defines five axis systems: Earth, intermediate, vehicle,
tire, and wheel.

**Practical takeaway**: when ingesting data from an automotive INS (OxTS,
Applanix), check whether the firmware output is ISO 8855 (+Y left) or legacy
SAE (+Y right). The difference is a 180-degree rotation about X — it looks
like a sign flip on lateral and vertical accelerations, and it passes many
plausibility checks before appearing in the map as a vertical-axis artifact.

### 3.3 Camera Frame (OpenCV / Bouguet)

OpenCV and most calibration toolboxes use the camera optical frame:

```
+x right   (along sensor columns, increasing column index)
+y down    (along sensor rows, increasing row index)
+z forward (optical axis, into the scene)
```

This is **right-handed** but differs 90 degrees about X from REP-103 body
frame. In ROS, camera topics using this convention name their frame
`camera_optical` to distinguish from the mounting frame `camera_link`
(x-forward/y-left/z-up). Always confirm which frame is in use before
computing reprojection residuals.

### 3.4 LiDAR Frame Conventions

Manufacturer conventions vary; check the datasheet for every sensor:

| Sensor | x | y | z | Handed |
|---|---|---|---|---|
| Velodyne HDL-64/VLP-16 | forward | left | up | right |
| Ouster OS1/OS2 — Sensor frame | forward | left | up | right |
| Ouster OS1/OS2 — Lidar frame | toward connector (encoder 0°) | toward encoder 90° | up | right |
| Livox Avia | forward | left | up | right |
| Livox MID-360 | forward | left | up | right |

The **Ouster distinction** between "Sensor Coordinate Frame"
(robotics-convention, x-forward) and "Lidar Coordinate Frame"
(data-aligned, x toward the rear connector) is a common pitfall. Ouster
drivers output data in the Lidar frame by default. When computing
`ego_T_lidar` extrinsics, always confirm which Ouster frame was used during
the calibration target procedure. Using the wrong one silently applies a
~180° rotation about z — the canonical "map is mirrored" failure mode.

For spherical projection (Section 5.3), the azimuth zero and scan direction
also matter: Ouster scans **clockwise** when viewed from above (negative
rotational velocity about z), so azimuth increases clockwise rather than
the mathematical counter-clockwise convention.

### 3.5 NED, ENU, and ECEF

The three global frames used most often in GNSS/INS-fused AV systems are
ECEF, NED, and ENU. Confusion between them is the single most common source
of systematic map orientation errors in multi-session survey datasets.

**ECEF (Earth-Centered Earth-Fixed)**:

- Origin at Earth's centre of mass.
- +X toward prime meridian / equator intersection.
- +Z toward geographic north pole.
- Rotates with the Earth (non-inertial in a Newtonian sense, but fixed to
  Earth's surface).
- Used internally by GNSS receivers; WGS-84 datum.

**ENU (East-North-Up)** — local tangent plane, ROS default for `map`:

- Origin at a chosen surface reference point (lat0, lon0, alt0).
- +X east, +Y north, +Z up (normal to ellipsoid).
- Right-handed. Suitable for robotics/AV work within ~50 km of origin
  (float32 precision adequate at centimetre scale).

**NED (North-East-Down)** — aerospace/INS default:

- +X north, +Y east, +Z down into ground.
- Right-handed. Used in most INS firmware (Applanix, Xsens, VectorNav) by
  default. Many units also support ENU output via firmware setting.
- To convert ENU -> NED: `x_ned = y_enu`, `y_ned = x_enu`, `z_ned = -z_enu`.
- To convert NED -> ENU: `x_enu = y_ned`, `y_enu = x_ned`, `z_enu = -z_ned`.

**ECEF -> ENU conversion**: rotate ECEF by `(pi/2 + lambda0)` about Z then
by `(pi/2 - phi0)` about the intermediate X-axis. Given an ENU origin at
geodetic (phi0, lambda0), the rotation matrix is:

```
R_ecef_to_enu = [[-sin(lambda0),           cos(lambda0),           0        ],
                 [-cos(lambda0)*sin(phi0), -sin(lambda0)*sin(phi0), cos(phi0) ],
                 [ cos(lambda0)*cos(phi0),  sin(lambda0)*cos(phi0), sin(phi0) ]]

p_enu = R_ecef_to_enu  *  (p_ecef  -  p_ecef_origin)
```

where `p_ecef_origin` is the ECEF coordinates of (phi0, lambda0, alt0)
converted via the WGS-84 ellipsoid equations.

---

## 4. Map, Odom, and World — The Drift/Continuity Trade-off

In LIO/VIO systems two competing requirements apply:

1. **Continuity**: the pose estimate must be smooth and free of discrete
   jumps, or the controller will saturate and IMU pre-integration will lose
   calibration. This is satisfied by the `odom` frame.
2. **Accuracy**: the accumulated map must not drift; loop closures and GNSS
   corrections must be incorporated. This is satisfied by the `map` frame,
   which **is allowed to jump**.

The REP-105 architecture resolves this by decoupling them:

- The odometry source publishes `odom -> base_link` continuously.
- The localization node (SLAM back-end, AMCL, or GNSS fusion) publishes
  `map -> odom` as an offset correction. This offset is updated discretely
  when loop closures or GNSS measurements arrive.
- Downstream consumers needing global accuracy (map building, lane-level
  localization) use `map -> base_link = (map -> odom) * (odom -> base_link)`.
- Downstream consumers needing smooth real-time control use only
  `odom -> base_link`.

**Consequence for aggregated-map segmentation**: always aggregate LiDAR
scans into the **map** frame, not the odom frame. A map built in the odom
frame will exhibit visible seams and duplicate structures at every
loop-closure boundary. In practice, the map-frame transform at scan
acquisition time is retrieved from the tf2 buffer (or from a pose-graph
solver's output) at the exact scan timestamp.

**Practical architecture in LIO-SAM**: two factor graphs run in parallel.
The "IMU preintegration" factor graph resets periodically (~0.5 s) to
guarantee real-time odometry at IMU frequency — this produces the odom
frame. The "map optimization" factor graph ingests loop-closure constraints
and GPS factors to produce map-frame corrections, publishing `map -> odom`
at a lower rate. The aggregated cloud builder always uses the map-frame
poses from the slower graph, not the real-time odom poses.

**Jump handling**: because `map -> odom` can jump, any consumer that caches
the map-frame ego pose (e.g., a rolling-window aggregator) must invalidate
its cache when it detects a jump larger than a threshold. In LIO-SAM this is
implicit because the aggregated map is rebuilt from the pose graph after
optimization; in online systems a jump detector on the `map -> odom`
transform magnitude is needed.

---

## 5. Projections

### 5.1 Pinhole Camera Model

Given a 3D point `p = [X, Y, Z]^T` in the camera frame (z-forward, x-right,
y-down OpenCV convention), the ideal pinhole projection to pixel `[u, v]^T`:

```
s * [u, v, 1]^T  =  K * [X, Y, Z]^T
```

where the **intrinsic matrix** K is:

```
K = | fx   0   cx |
    |  0  fy   cy |
    |  0   0    1 |
```

- `fx`, `fy` — focal lengths in pixels (fx ~= fy for non-anamorphic lenses).
- `(cx, cy)` — principal point (image centre in pixels).
- Normalised image coordinates: `(X/Z, Y/Z)`.

The full projection chain for a world point `p_w`:

```
p_cam  =  R_cw * p_w + t_cw        (extrinsic: world -> camera)
[u,v]  =  project(K, p_cam)        (intrinsic: camera 3D -> pixel)
```

Practical checks before trusting the chain:

- Points behind the camera have `Z <= 0` in the optical frame.
- Straight vertical poles should not curve after projection unless lens
  distortion is still applied.
- Reprojected LiDAR points should align with image edges under braking,
  turning, and vibration, not only in static scenes.

### 5.2 Distortion Models

Real lenses deviate from the ideal pinhole. Distortion is applied in
normalised image coordinates `(x_n, y_n) = (X/Z, Y/Z)` before scaling by K.

**Brown-Conrady (radial + tangential)** — default in OpenCV:

```
r_sq = x_n^2 + y_n^2
x_dist = x_n*(1 + k1*r_sq + k2*r_sq^2 + k3*r_sq^3)
       +  2*p1*x_n*y_n  +  p2*(r_sq + 2*x_n^2)
y_dist = y_n*(1 + k1*r_sq + k2*r_sq^2 + k3*r_sq^3)
       +  p1*(r_sq + 2*y_n^2)  +  2*p2*x_n*y_n
```

Parameters: `[k1, k2, p1, p2, k3]` (OpenCV order). Radial coefficients k1–k3
dominate wide-angle optics. The undistorted normalised point is then mapped
to pixels by K.

**Fisheye / equidistant** (OpenCV fisheye model, Kannala-Brandt):

```
r_dist = theta * (1 + k1*theta^2 + k2*theta^4 + k3*theta^6 + k4*theta^8)
```

where `theta = atan2(sqrt(X^2+Y^2), Z)` is the angle from the optical axis.
Suited for FoV > 150°. No singularity at z=0; can model fisheye lenses up to
360° FoV. OpenCV's `undistortPoints()` takes distorted normalised coordinates
and returns ideal normalised coordinates; then apply K.

**Workflow**: always undistort points (or images) before applying the
pinhole K projection. Failure to undistort when projecting LiDAR points into
a wide-angle camera produces up to tens of pixels of reprojection error at
the image periphery — masking calibration errors and corrupting
segmentation-label transfer.

### 5.3 Spherical (Range Image) Projection for LiDAR

A LiDAR scan is naturally parameterised in spherical coordinates `(r, theta,
phi)` where `r` is range, `theta` is azimuth, and `phi` is elevation. To
project to a 2D range image of width `W` (azimuth resolution) and height `H`
(elevation channels):

```
u = floor( (theta + pi) / (2*pi)  *  W )
v = floor( (1 - (phi - phi_min)/(phi_max - phi_min)) * H )
```

where `phi_min` and `phi_max` are the sensor's vertical FoV limits. For the
Ouster OS1-128 these are approximately -22.5° and +22.5°.

The **Ouster-specific** spherical-to-Cartesian formula in the Lidar frame:

```
x = (r - |n|)*cos(theta_enc + theta_az)*cos(phi) + beam_to_lidar[0,3]*cos(theta_enc)
y = (r - |n|)*sin(theta_enc + theta_az)*cos(phi) + beam_to_lidar[0,3]*sin(theta_enc)
z = (r - |n|)*sin(phi)                           + beam_to_lidar[2,3]
```

where `|n|` is the optical offset and `beam_to_lidar` is the per-beam rigid
offset from the beam origin to the Lidar frame origin. Using the generic
spherical formula instead of this exact model introduces centimetre-level
artefacts in the range image that degrade SphereFormer-class models trained
on Ouster data.

### 5.4 BEV / Orthographic Projection

For top-down map building, points in the map frame are collapsed to 2D by
discarding the z coordinate (or binning into z-slices) and assigning to a
regular grid cell:

```
col = floor( (p_x - x_min) / resolution )
row = floor( (p_y - y_min) / resolution )
```

This is an orthographic (parallel) projection — no perspective foreshortening,
no scale variation with range. It preserves metric distances and is the
standard input format for BEV semantic segmentation networks (PointPillars,
CenterPoint, BEVFusion). The grid definition must state: source frame
(`base_link`, `map`, or sensor frame); resolution; origin and cell-centre
convention; row/column orientation; whether ego motion compensation has
already been applied.

For radar, preserve Doppler frame semantics: radial velocity is measured along
the radar line of sight and must be transformed carefully before it becomes
`vx` or `vy` in vehicle coordinates.

### 5.5 Equirectangular / Stereographic (360 Cameras)

**Equirectangular**: maps azimuth `theta` -> u and elevation `phi` -> v
linearly across a 2:1 image. Used by Ricoh Theta, Insta360, and most
360-camera firmware. Easy to interpret; significant distortion at poles.

```
u = W * (theta + pi) / (2*pi)
v = H * (pi/2 - phi) / pi
```

**Equidistant fisheye**: image radius proportional to incidence angle theta.
OpenCV `fisheye` model. The mapping is `r_image = f * theta` where
`theta = arccos(z / |p|)`. Valid up to theta = pi/2 (hemisphere) or beyond
for super-fisheye lenses.

**Stereographic**: conformal (angle-preserving) projection from a sphere.
Used in some omni-camera SLAM systems where local shape fidelity matters.
The mapping is `r_image = 2*f*tan(theta/2)`, which preserves angles but not
areas.

---

## 6. Transforming a Point Through a Sensor Chain

**Scenario**: a LiDAR point `p_lidar` measured at scan time `t_i` during an
airport surface drive; we want its world (map-frame) coordinates.

**Step 1 — deskew**: correct for ego motion during the scan sweep (see
[Rolling Shutter, LiDAR Deskew, and Motion Distortion](rolling-shutter-lidar-deskew-motion-distortion.md)).
Each point is first expressed in the LiDAR frame at the **start of the sweep**
rather than at the time it was actually measured, by interpolating the IMU
pose chain over the sweep duration.

**Step 2 — full transform chain**:

```
p_world = T_world_map(static)
        * T_map_odom(t_i)         <- published by localization, retrieved from tf2 buffer
        * T_odom_ego(t_i)         <- published by odometry, retrieved from tf2 buffer
        * T_ego_lidar(static)     <- extrinsic calibration, loaded at startup
        * p_lidar
```

In shorthand notation (middle-subscript cancellation):

```
p_w  =  world_T_map  *  map_T_odom(t_i)  *  odom_T_ego(t_i)  *  ego_T_lidar  *  p_L
```

**Step 3 — to spherical pixel** (reverse lookup): project `p_w` back to a
specific scan via `ego_T_lidar^{-1}`, compute `(r, theta, phi)`, then apply
the range-image projection formula from Section 5.3. This lookup is used
during pseudo-label transfer in the segmentation pipeline.

**Error propagation**: any angular error epsilon in `ego_T_lidar` produces a
lateral shift of `r * sin(epsilon) ~= r * epsilon` (radians) at range `r`.
At 50 m range, a 0.5° calibration error causes ~44 cm map misalignment —
enough to misassign a taxiway marking to the wrong semantic class.

### 6.1 Per-Factor Uncertainty Table

| Step | Transform | Typical uncertainty |
|---|---|---|
| GNSS/RTK ENU anchor | `world_T_map` (static) | < 2 cm horizontal if RTK fixed |
| Map-to-odom correction | `map_T_odom(t)` | < 5 cm after loop closure |
| Odometry | `odom_T_ego(t)` | 0.1–1% of distance traveled (LIO) |
| Extrinsic LiDAR calibration | `ego_T_lidar` (static) | 1–3 cm translation, 0.1–0.5° rotation |

The dominant error source for a short survey drive (< 1 km) is typically the
extrinsic calibration of the LiDAR mount. For long drives, odometry drift
dominates until a loop closure or RTK correction is applied.

---

## 7. Time-Stamped Transforms and tf2

### 7.1 tf2 Architecture

ROS 2 tf2 maintains a **forest of transform trees** (one tree per connected
component) buffered in time. Key properties:

- Default buffer window: **10 seconds**.
- Transforms are stored as discrete samples; lookups **interpolate linearly**
  (SLERP for rotations) between bracketing samples.
- No extrapolation: requesting a future timestamp raises
  `ExtrapolationException`.
- Each transform is identified by `(parent_frame, child_frame, stamp)`.

### 7.2 lookupTransform Signature

```cpp
geometry_msgs::msg::TransformStamped ts =
    tf_buffer->lookupTransform(
        target_frame,   // "map"
        source_frame,   // "lidar_link"
        time,           // rclcpp::Time(scan_stamp_ns)
        timeout         // rclcpp::Duration::from_seconds(0.05)
    );
```

When `time = tf2::TimePointZero` (= 0), tf2 returns the **latest** available
transform. For historical lookups (deskewing), provide the exact point
timestamp; tf2 interpolates between bracketing samples using SLERP for the
rotation quaternion and linear interpolation for the translation vector.

### 7.3 The "Transform at the Right Time" Rule

A deskewing pipeline that queries
`tf_buffer->lookupTransform("odom", "lidar_link", point_stamp)` for each
point in a sweep will obtain the correct ego-to-LiDAR transform at that
point's acquisition time, enabling motion-compensated aggregation. Using the
sweep-end time for all points introduces a motion error of
`v * delta_t_sweep` — e.g., at 5 m/s and a 100 ms sweep, ~50 cm end-to-end
error. This directly couples frame bookkeeping to the deskew quality
discussed in
[Rolling Shutter, LiDAR Deskew, and Motion Distortion](rolling-shutter-lidar-deskew-motion-distortion.md).

### 7.4 Static vs Dynamic Transforms

- **Static** (published once via `tf2_ros::StaticTransformBroadcaster`):
  sensor extrinsics like `base_link -> lidar_link`. Stored without time
  history; always return the same value regardless of query time.
- **Dynamic** (published continuously via `tf2_ros::TransformBroadcaster`):
  `odom -> base_link`, `map -> odom`. Must be published at a rate sufficient
  for the expected query frequency (typically 50–200 Hz for IMU-rate deskewing).

### 7.5 Bag Conventions and Buffer Depth

In ROS 2 bag files, transform topics are `/tf` (dynamic) and `/tf_static`
(static). When replaying a bag for offline map building, `/tf_static` must be
latched or the first message re-published before playback begins; otherwise
static transforms may not be available at the start of the bag.

The default 10-second buffer is sufficient for deskewing a 100 ms LiDAR
sweep, but too shallow if the pose-graph optimizer runs at 1 Hz and corrects
poses older than 10 seconds. For offline map-building workflows it is common
to use a custom transform buffer with no expiry (`tf2::Duration::MAX`) so
that the full survey history is queryable during the aggregation pass.

---

## 8. GNSS-RTK / ECEF -> ENU -> Map Frame

### 8.1 RTK Positioning

Real-Time Kinematic (RTK) GNSS provides centimetre-level positioning by
differentially correcting carrier-phase measurements against a fixed base
station or network (NTRIP). The raw RTK solution is delivered in **ECEF
Cartesian coordinates** (WGS-84), or equivalently in geodetic LLH (latitude,
longitude, ellipsoidal height).

### 8.2 Setting Up the Local Map Frame

To set up a local map frame centred at the survey origin (phi0, lambda0, alt0):

1. Convert origin LLH to ECEF: `p_ecef_origin = LLH_to_ECEF(phi0, lambda0, alt0)`.
2. For each RTK fix `p_ecef`: `p_enu = R_ecef_to_enu * (p_ecef - p_ecef_origin)`
   using the rotation matrix from Section 3.5.
3. The resulting `p_enu` is in the local tangent-plane ENU frame, used as the
   ROS `map` frame (REP-103: x east, y north, z up).

Libraries: [ethz-asl/geodetic_utils](https://github.com/ethz-asl/geodetic_utils)
(ROS), [PROJ](https://proj.org/en/stable/operations/conversions/topocentric.html)
for Python/C++.

### 8.3 Map Frame Anchoring

For a survey drive, the first RTK-valid fix is typically used as the ENU
origin. All subsequent pose estimates (including LIO when GNSS is momentarily
unavailable) are expressed relative to this origin. After the survey, the map
frame is frozen; new data ingestion always uses the same origin transform.

Most INS units (OxTS, Applanix, Xsens MTi-G) default to outputting poses in
NED. Convert to ENU before publishing to the ROS `map` frame, or configure
the firmware to output ENU directly.

### 8.4 Airside Specifics

Airport surfaces are typically surveyed to sub-10 cm accuracy. The recommended
ENU origin for an airside deployment is the **aerodrome reference point (ARP)**
published in the AIP, giving the map frame a stable, internationally registered
anchor. The WGS-84 ellipsoidal height at the ARP serves as alt0. Any
georegistered prior map (e.g., an airport's GIS export or a prior LiDAR
survey) can then be converted to the same ENU origin for direct overlay without
an additional registration step.

For multi-session consistency, save the ENU origin as part of the map metadata.
If a later survey uses a different base station, compute the ECEF offset between
the two base stations and apply it before comparing maps.

---

## 9. Frame Conventions Across Libraries

| Library | Matrix storage | Quaternion order | Default frame | Notes |
|---|---|---|---|---|
| **Eigen** | Column-major (default) | Coeffs: x,y,z,w | None (agnostic) | `Quaterniond(w,x,y,z)` constructor takes w first; `coeffs()` returns xyzw |
| **ROS tf2** | Row-major in messages | x,y,z,w (Hamilton) | REP-103 | `geometry_msgs/Quaternion` is xyzw |
| **GTSAM Pose3** | Eigen column-major | Eigen xyzw internally | Right-hand, any | `wTc` notation; compose left-to-right |
| **PCL** | Eigen column-major | Eigen xyzw | None | `pcl::transformPointCloud` uses Eigen 4x4 |
| **Open3D** | Column-major (NumPy-compatible) | — | None | `transform()` accepts 4x4 NumPy array |
| **Ceres** | Row-major arrays | w,x,y,z (Hamilton) | None | Local parameterisation needed for SO(3) |

**Key cross-library pitfall**: Eigen's `Quaterniond` constructor is
`(w, x, y, z)` but `coeffs()` returns `[x, y, z, w]`. Code that passes
`q.coeffs()` directly to a function expecting `[w, x, y, z]` (as Ceres
local parameterisations sometimes do) will silently apply the wrong rotation.

**GTSAM note**: GTSAM uses Hamilton quaternion convention throughout. Its
`Pose3` is `(Rot3, Point3)` = (rotation, translation). The pose `wTc`
transforms a point from camera to world: `p_w = wTc.transformFrom(p_c)`.
Calling `transformTo()` applies the inverse. GTSAM's left-to-right
composition mirrors the middle-subscript cancellation rule: `wTi * iTl`
cancels `i` to yield `wTl`.

**PCL note**: `pcl::transformPointCloud(cloud_in, cloud_out, transform)`
where `transform` is `Eigen::Matrix4f`. Convention: `p_out = transform * p_in`,
i.e., `transform = T_{out<-in}` (target-from-source). Matches the GTSAM/ROS
passive convention.

**Open3D note**: `pcd.transform(T)` applies `T` as `p_new = T * p_old` in
homogeneous coordinates. Open3D's `get_rotation_matrix_from_xyz` produces
rotation matrices in ZYX extrinsic convention by default — confirm axis order
when bridging with Eigen or GTSAM.

**Ceres note**: the built-in `ceres::QuaternionParameterization` stores
quaternions as `[w, x, y, z]` (Hamilton). Eigen's `coeffs()` output is
`[x, y, z, w]`. When passing from Eigen to Ceres:
`ceres_q[0] = q.w(); ceres_q[1] = q.x(); ceres_q[2] = q.y(); ceres_q[3] = q.z();`.

---

## 10. Common Pitfalls

### 10.1 Column-Major vs Row-Major

Eigen defaults to column-major storage. NumPy and C arrays default to
row-major. When copying a 4×4 matrix's raw `data()` pointer across a language
boundary (e.g., via a C extension in Python), the matrix will be **transposed**
unless you explicitly convert. Use `Eigen::Map<Eigen::Matrix4d>` with stride
information, or always pass via named accessor methods, never via raw pointer.

### 10.2 Left vs Right Multiplication

For extrinsic-frame rotations (rotating about fixed world axes), multiply
**on the left**: `T_new = T_rotation * T_old`. For body-frame rotations
(rotating about the body's own axes), multiply **on the right**:
`T_new = T_old * T_rotation`. Confusing these produces the correct rotation
magnitude but about the wrong axis.

### 10.3 Hamilton vs JPL Quaternion Convention

The two most widely used quaternion conventions differ in the sign of the
imaginary basis products:

- **Hamilton** (standard math, Eigen, ROS, MATLAB, Ceres): `ijk = -1`. Unit
  quaternion `q = w + xi + yj + zk`. Rotation matrix and composition follow
  the standard formula.
- **JPL** (aerospace, some NASA toolchains): `ijk = +1`. The resulting
  rotation matrix is the **transpose** of the Hamilton rotation matrix.

Mixing JPL and Hamilton produces a rotation matrix R where the sign of all
off-diagonal elements is flipped — visually a reflection, not a rotation,
but it passes many unit tests because the diagonal terms are correct.

**Storage order** (separate from algebra): ROS uses `[x, y, z, w]` in
messages; Eigen constructor takes `(w, x, y, z)`; some papers write
`[w, x, y, z]`. Always check both algebra convention and storage order when
integrating a new library.

### 10.4 Yaw Convention

ROS REP-103: yaw increases **counter-clockwise** when viewed from above
(z-up right-hand rule). Zero yaw points **east** for georeferenced poses.
Compass bearings increase **clockwise** and zero points **north**. Converting
heading to ROS yaw: `yaw_ros = pi/2 - heading_compass`. Failure to convert
causes the vehicle to navigate 90 degrees off-course while the localization
error metrics appear reasonable.

### 10.5 Time-Zone and Epoch Pitfalls

In ROS 2, `rclcpp::Time` uses UNIX epoch (nanoseconds since 1970-01-01 UTC).
GNSS receivers commonly output GPS time (week + seconds-of-week, offset from
GPS epoch 1980-01-06, no leap seconds). The current GPS-UTC offset (as of
2026) is 18 seconds. Failing to account for this offset when correlating GNSS
poses with LiDAR scan stamps will misalign them by 18 seconds —
approximately 90 metres at typical survey speed. Always convert GPS time to
UNIX epoch at the driver level and stamp ROS messages accordingly.

### 10.6 Frame ID Case and Whitespace

ROS tf2 frame IDs are **case-sensitive strings**. `map`, `Map`, and `MAP`
are three distinct frames. A tf2 lookup between `map` and `Map` silently
fails with `ExtrapolationException`. This is a frequent source of
frame-not-found bugs when integrating third-party packages with different
naming conventions. The fix is one `std::string`-lowercasing line in the
driver; the cost of ignoring it is a silent failure that can take hours to
trace.

---

## 11. The Aggregated-Map Segmentation Transform Chain

### 11.1 The Canonical Pipeline

```
RAW SCAN  ->  DESKEW  ->  EGO-TO-MAP TRANSFORM  ->  AGGREGATED CLOUD  ->  SEGMENT  ->  MAP-FRAME LABELS
```

In detail for scan `i` with `N` points:

1. **Timestamp each point**: the LiDAR driver timestamps every point with its
   firing time `t_j` within the sweep `[t_start, t_end]`.
2. **Deskew**: for each point, compute the incremental IMU pose `T_imu(t_j)`
   relative to the sweep start, then:
   `p_lidar_deskewed = T_imu(t_j)^{-1} * T_imu(t_start) * ego_T_lidar^{-1} * p_lidar_raw`.
   After deskewing, all points are expressed as if the sensor was stationary
   at `t_start`.
3. **Register to map frame**: compute the ego pose in the map frame at
   `t_start` via `world_T_ego(t_start) = tf_buffer.lookupTransform("map",
   "base_link", t_start)`. Then:
   `p_map = world_T_ego(t_start) * ego_T_lidar * p_lidar_deskewed`.
4. **Accumulate**: concatenate all registered scans into a global point cloud
   in the map frame.
5. **Segment**: run the semantic segmentation model (SphereFormer,
   RangeFormer, or a BEV-based model) on the aggregated cloud or on
   voxel-downsampled tiles.
6. **Label per point in map frame**: each labeled point `(p_map, class_id)`
   is the final output.

### 11.2 Error-Propagation Table

| Error source | Where it enters | Spatial consequence | Segmentation consequence |
|---|---|---|---|
| `ego_T_lidar` uses wrong Ouster frame | Step 3, `ego_T_lidar` | ~180° rotation about z; all scans in wrong half of airport | Every class misplaced; map unusable |
| `ego_T_lidar` rotation error 0.5° | Step 3, `ego_T_lidar` | ~44 cm lateral shift at 50 m range | Taxiway markings misassigned; curbs lost |
| `ego_T_lidar` translation error 2 cm | Step 3, `ego_T_lidar` | 2 cm uniform world-frame shift | Thin-class IoU degraded (curbs, lights) |
| INS outputs NED, code reads as ENU | Step 3, `world_T_map` | Y and Z swapped; map flipped north-south | Entire map geometry inverted |
| JPL quaternion fed to Hamilton converter | Step 3, `map_T_odom` | All rotations transposed; scan registration diverges | Locally plausible, globally wrong |
| `map->odom` correction not applied | Step 3 | Seam at every loop closure; duplicate structures | Ghost walls in aggregated cloud |
| Point timestamp missing (all at scan start) | Step 2 (deskew) | 100 ms sweep at 5 m/s -> 50 cm smear | Painted markings wash out |
| tf2 buffer expires (> 10 s lag) | Step 3, tf2 lookup | `ExtrapolationException`; scan dropped | Gaps in aggregated cloud |
| GPS-UTC epoch offset (18 s) not applied | Step 3, pose association | ~90 m misalignment at survey speed | Catastrophic; scans land in wrong region |
| `map->odom` jump not detected in cache | Step 4, accumulation | Scan strip offset by jump magnitude | Duplicate structures near loop closure |

### 11.3 Validation Checklist

- Visualise a single static scan in RViz with `Fixed Frame = map`; the sensor
  outline should be at the correct geographic position and orientation.
- Overlay RTK trajectory on the BEV map; lanes should be parallel /
  perpendicular to expected taxiway geometry.
- Check that successive non-overlapping scans tile flush in the xy-plane
  (no z-gap or twist between strips).
- Publish a `/tf_tree` diagram at bag start; verify the chain
  `map -> odom -> base_link -> lidar_link` is complete with the correct
  parent-child order.
- Echo `ego_T_lidar` static transform; verify x-axis points in the physical
  forward direction by correlating with a known forward-facing structural
  feature in a captured scan.
- Run `ros2 run tf2_tools view_frames` on the bag; confirm every expected
  frame is in the tree and no orphan sub-trees exist.
- Check the sign of the z-coordinate of aggregated ground points; they should
  be near zero (±0.05 m for a flat apron surface), not ±1.5 m, which would
  indicate a z-axis flip.
- Confirm the GPS-UTC epoch offset has been applied: the timestamp of the
  first GNSS fix in the ROS bag should be within a few milliseconds of the
  first LiDAR sweep, not offset by 18 seconds.

---

## 12. Implementation Notes

- Define the full frame chain in URDF/XACRO loaded via `robot_state_publisher`;
  source all static transforms from version-controlled files, not ad-hoc
  `StaticTransformBroadcaster` calls scattered across launch files.
- Apply the middle-subscript cancellation check to every new transform chain.
  If inner subscripts do not cancel, the chain is wrong — no amount of testing
  will catch a silently incorrect chain if the first scans happen to look plausible.
- When integrating a new INS, confirm NED vs ENU output **and** whether the
  quaternion is Hamilton or JPL before writing any transform parsing code.
- For Ouster sensors, confirm whether calibration was performed in "Sensor
  frame" (x-forward) or "Lidar frame" (x-toward-connector); the two differ by
  ~180° about z.
- Store extrinsic calibrations as SE(3) matrices with 6×6 covariance diagonals,
  not as Euler angles. Load with `Eigen::Matrix4d::Identity()` as the on-missing-file
  default so a misconfigured path fails loudly.
- For offline map building, set the tf2 buffer duration to `tf2::Duration::MAX`
  and replay `/tf_static` before `/tf` to avoid `ExtrapolationException` on the
  first scan lookups.
- Validate the GNSS-UTC epoch offset before the first survey:
  `assert(abs(gps_stamp_as_unix - ros_now) < 0.1)`.
- When bridging Eigen and Ceres quaternions, never pass `q.coeffs()` directly;
  copy `w, x, y, z` individually to avoid the xyzw/wxyz ordering trap.
- Maintain a frame authority table (one node per transform) and preserve TF
  tree, calibration artifact IDs, timestamp source per topic, and covariance
  variable ordering in every dataset log — without these, incident replay is
  impossible.

---

## 13. Failure Modes

| Failure mode | Symptom | Mitigation |
|---|---|---|
| ENU/NED mix-up | Vertical or yaw signs inverted; INS and ROS disagree | Convert at the driver boundary; name frames with `_ned` only when truly NED |
| Left-handed frame | Mirrored detections or lane geometry | Enforce REP-103 right-handed frames; run basis-vector tests |
| 90° z-axis flip (z-up vs z-down) | Map looks valid locally; BEV cells wrong; ground labeled as ceiling | Check z of aggregated ground points; should be ~0 |
| Extrinsic direction reversal | Reprojected objects displaced in a way that grows with range | Use `T_target_source` naming; include inverse tests in calibration CI |
| Ouster Lidar frame vs Sensor frame | Map rotated ~180° about z | Confirm which frame was active during calibration target capture |
| `map` correction sent to controller | Vehicle command jumps after localization update | Keep controller reference smooth in `odom` or trajectory-relative coordinates |
| Hamilton vs JPL quaternion mix | All rotations transposed; scan matching appears locally correct, globally diverges | Enforce Hamilton throughout; add determinant check `det(R) == +1` |
| Column-major vs row-major across language boundary | Matrix silently transposed | Use named accessors; never pass raw `data()` across language boundaries |
| Yaw convention mismatch (compass vs ROS) | Vehicle navigates 90° off-course | Apply `yaw_ros = pi/2 - heading_compass` at INS driver output |
| GPS-UTC epoch offset ignored | Scans and GNSS poses misaligned by ~90 m | Convert GPS time to UNIX epoch in the GNSS driver; add assertion on delta |
| tf2 frame ID case mismatch | `ExtrapolationException`; silent lookup failure | Normalise all frame IDs to lowercase in all drivers |
| Float precision loss | GPU BEV or map tensors show quantization at large coordinates | Use local origins for ML and rasterization; subtract ENU origin before encoding |
| Covariance in wrong frame | Fusion becomes overconfident or rejects good measurements | Transform covariance with SE(3) adjoint; see Section 2.6 |
| `map->odom` jump not handled | Rolling aggregator contains seam artefacts near loop closure | Add jump detector; invalidate cache when transform delta exceeds threshold |
| Timestamped transform lookup error | Moving objects smear; sensor fusion biased during turns | Query transforms at measurement acquisition time, not processing time |

---

## Related Repository Documents

- [PointPillars: First Principles](pointpillars.md)
- [RTK-GPS, IMU, and Multi-Sensor Localization](../state-estimation/rtk-gps-imu-localization.md)
- [GTSAM Factor Graph Optimization](../state-estimation/gtsam-factor-graphs.md)
- [Lanelet2 Map Representation](../robotics/lanelet2-maps.md)
- [Frenet-Frame Trajectory Planning](../controls/frenet-trajectory-math.md)
- [Robust State Estimation and Multi-Sensor Localization Fusion](../../30-autonomy-stack/localization-mapping/overview/robust-state-estimation-multi-sensor.md)
- [HD Map Construction Pipeline](../../30-autonomy-stack/localization-mapping/maps/map-construction-pipeline.md)

---

## Sources

- ROS REP-103, "Standard Units of Measure and Coordinate Conventions": https://www.ros.org/reps/rep-0103.html
- ROS REP-105, "Coordinate Frames for Mobile Platforms": https://www.ros.org/reps/rep-0105.html
- ROS 2 tf2 Overview (Humble): https://docs.ros.org/en/humble/Concepts/Intermediate/About-Tf2.html
- tf2 Time Tutorial (C++): https://daobook.github.io/ros2-docs/xin/Tutorials/Tf2/Learning-About-Tf2-And-Time-Cpp.html
- Modern Robotics, Lynch and Park — SE(3) resources: https://modernrobotics.northwestern.edu/nu-gm-book-resource/3-3-1-homogeneous-transformation-matrices/
- GTSAM Geometry and Variable Naming Conventions: https://gtsam.org/gtsam.org/2020/06/28/gtsam-conventions.html
- A Standard Rigid Transformation Notation Convention (arXiv 2405.07351): https://arxiv.org/pdf/2405.07351
- Hamilton vs JPL Quaternion Conventions: https://fzheng.me/2017/11/12/quaternion_conventions_en/
- Why and How to Avoid the Flipped Quaternion Multiplication (arXiv 1801.07478): https://arxiv.org/pdf/1801.07478
- OpenCV Camera Calibration and 3D Reconstruction: https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html
- calib.io Camera Models Overview: https://calib.io/blogs/knowledge-base/camera-models
- Fisheye Distortion Survey (arXiv 2401.00442): https://arxiv.org/html/2401.00442v1
- Ouster Sensor Data Docs: https://static.ouster.dev/sensor-docs/image_route1/image_route2/sensor_data/sensor-data.html
- Navipedia: ECEF to ENU Transformations: https://gssc.esa.int/navipedia/index.php/Transformations_between_ECEF_and_ENU_coordinates
- Fixposition: ECEF to ENU Conversion: https://docs.fixposition.com/fd/converting-from-ecef-to-enu-local-frame
- LIO-SAM GitHub README: https://github.com/TixiaoShan/LIO-SAM/blob/master/README.md
- LIO-SAM Paper (arXiv 2007.00258): https://arxiv.org/pdf/2007.00258
- Extrinsic Calibration LiDAR/IMU/Camera (arXiv 2205.08701): https://arxiv.org/pdf/2205.08701
- Eigen Storage Orders: https://libeigen.gitlab.io/eigen/docs-nightly/group__TopicStorageOrders.html
- Extrinsic vs Intrinsic Rotation (Medium): https://dominicplein.medium.com/extrinsic-intrinsic-rotation-do-i-multiply-from-right-or-left-357c38c1abfd
- SAE J670-2008 on Scribd: https://www.scribd.com/document/242952000/SAE-J670-2008-pdf
- Autoware TF documentation: https://autowarefoundation.github.io/autoware-documentation/main/design/autoware-interfaces/components/localization/#tf
- Lanelet2 projection and coordinate systems: https://github.com/fzi-forschungszentrum-informatik/Lanelet2/blob/master/lanelet2_projection/doc/Map_Projections_Coordinate_Systems.md
- GeographicLib documentation: https://geographiclib.sourceforge.io/
- PROJ documentation: https://proj.org/
- geodetic_utils (ETH ASL): https://github.com/ethz-asl/geodetic_utils
- Sola et al., "A micro Lie theory for state estimation in robotics": https://arxiv.org/abs/1812.01537
- De-Skewing LiDAR Scan (PMC): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7180945/
- Active Versus Passive Transformations in Robotics: https://www.researchgate.net/publication/Active_versus_passive_transformations_in_robotics
