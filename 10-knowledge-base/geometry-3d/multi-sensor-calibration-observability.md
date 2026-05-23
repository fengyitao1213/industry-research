# Multi-Sensor Calibration Observability

<!-- kb-visual:start -->
![Multi-Sensor Calibration Observability curated visual](../_assets/visuals/geometry-3d-multi-sensor-calibration-observability.svg)

*Visual: calibration factor graph linking camera, LiDAR, IMU, targetless constraints, time offset, motion excitation, and observability rank.*
<!-- kb-visual:end -->

Calibration is an estimation problem over geometry, time, and uncertainty. A
calibration value is only meaningful if the data made the parameter observable,
the residual model matched the sensor physics, and the resulting covariance is
usable by perception, SLAM, mapping, and validation.

This page focuses on observability: when a multi-sensor calibration is actually
identified by the data, and when an optimizer merely returns a plausible number.
It covers the underlying theory (Hermann-Krener, observability Gramian, Fisher
Information Matrix), the specific observable conditions for LiDAR-IMU and
LiDAR-camera pairs, degenerate motion patterns that silently corrupt calibration,
and the practical protocol implications for airside survey drives.

---

## Related Docs

- [Sensor Calibration and Time Synchronization](sensor-calibration-time-synchronization.md) — the broader calibration pipeline that consumes observability tests; FIM logging, recalibration triggers, and production checklist
- [Lie Groups SE(3), SO(3), Adjoints, and Jacobians](lie-groups-se3-so3-jacobians.md) — the SE(3) algebra underlying every extrinsic optimization; Exp/Log maps and Jacobians used in the AX=XB and nonlinear solvers
- [Point Cloud Registration Math: ICP, NDT, GICP](point-cloud-registration-math-icp-ndt-gicp.md) — registration consumes calibrated extrinsics; the ICP Hessian is structurally identical to the observability Gramian
- [Rolling Shutter and LiDAR Deskew / Motion Distortion](rolling-shutter-lidar-deskew-motion-distortion.md) — deskewing is the first downstream consumer of spatiotemporal calibration; temporal offset errors appear here as motion smear
- [Aggregated-Map Semantic Segmentation](../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md) — segmentation thin-class IoU is the most sensitive end-to-end indicator of calibration quality

---

## Why It Matters

| Effect | Impact | Risk if ignored |
|---|---|---|
| Unobservable extrinsic rotation (e.g., straight-line-only drive) | 2-3 of 6 extrinsic DoF unconstrained; optimizer finds plausible but wrong solution | Ghost walls, scan-seam artefacts; errors invisible until map quality degrades |
| Degenerate planar motion (airside vehicle on flat tarmac) | Roll/pitch extrinsic and z-lever-arm unobservable; FIM rank < 6 | Vertical misalignment corrupts ground-plane fitting and drivable-surface classification |
| Unobservable time offset (stationary or constant-velocity calibration) | Temporal offset absorbed into spatial extrinsic; correlated errors | Motion smear ≈ speed × offset; at 10 m/s and 2 ms error smear = 2 cm |
| Extrinsic rotation error δθ at lever arm L | Lateral offset ≈ L · sin(δθ) per scan | At L = 0.5 m, δθ = 0.5° → ~4 mm per scan; compounded over 200-scan aggregation exceeds 5 cm threshold |
| High FIM condition number (κ > 10³) | Near-degenerate calibration; small data perturbation shifts solution significantly | False convergence; optimizer satisfies all residuals while parameters remain wrong |
| All-zeros-residual trap | Degenerate data + flexible model → residual = 0 with wrong parameters | Appears successful; only detectable via FIM eigenvalue inspection or holdout validation |

Sub-5 cm RMS point error in aggregated maps is achievable when all parameters
are genuinely observable. Three of six extrinsic DoF are structurally
unobservable under pure straight-line or pure planar drives — the most common
failure mode for airside survey calibration.

---

## 1. The Observability Question

### 1.1 Three Related Concepts

Observability, structural identifiability, and practical identifiability are
distinct and often conflated:

| Term | Meaning | What fixes it |
|---|---|---|
| **Observability** | State/parameter can be inferred from outputs along trajectories starting from that state | Change motion pattern or sensor configuration |
| **Structural identifiability** | Parameter can in principle be determined from perfect, noise-free output — a model-structure property | Change model or sensor arrangement |
| **Practical identifiability** | Parameter can be reliably determined given finite, noisy data — combines structural identifiability with experiment design | Improve excitation or collect more data |

Structural unidentifiability cannot be fixed by collecting more data of the
same kind. Practical unidentifiability — high covariance rather than infinity —
can sometimes be reduced by better excitation or a longer data window.

### 1.2 Hermann-Krener Nonlinear Observability (1977)

For a smooth nonlinear system `ẋ = f(x), y = h(x)` (or with inputs), Hermann
and Krener defined the **observation space** O as the smallest vector space
containing `h` and closed under Lie derivatives along `f`. The **observability
rank condition** (ORC) states: if `dim(span{dO}) = n` at a point `x₀`, the
system is *locally weakly observable* at `x₀`.

The Lie derivative of a scalar output `h` along vector field `f`:

```
L_f h(x) = (dh/dx) * f(x)
```

Higher-order terms `L_f^k h` are computed recursively. The ORC matrix is formed
by stacking the differentials `d(L_f^k h)` as rows. If this matrix achieves
rank `n`, the system is locally weakly observable.

Key caveat: the ORC is sufficient but not necessary for local weak observability
(for analytic systems it is also necessary at generic points). It gives no
information about the unobservable subspace when rank is deficient — the null
space of the ORC matrix must be computed explicitly.

### 1.3 Linearized / First-Order Observability

For practical calibration systems an **extended observability matrix** is
computed by linearizing the measurement model around the current estimate:

```
H_k = dh/dtheta  |_{theta=theta_hat}
```

where theta is the parameter vector. Stacking rows from multiple time steps:

```
O = [ H_1 ]
    [ H_2 ]
    [ ... ]
    [ H_N ]
```

The null space of O identifies the unobservable directions in parameter space.
This is the approach used in EKF-based visual-inertial calibration (Mirzaei &
Roumeliotis 2008, IEEE TRO 24(5):1143-1156). The NOCT framework (arXiv:2207.07881)
extends this to handle nonlinear systems with constraints and time offset jointly.

---

## 3. The Observability Gramian

### 3.1 Definition

For a linearized time-varying system the **empirical observability Gramian**
integrates the outer product of the measurement Jacobian along the trajectory:

```
W(t0, t1) = integral_{t0}^{t1}  H(t)^T * H(t) dt
```

or in discrete time:

```
W = sum_k  H_k^T * H_k
```

where `H_k` is the measurement Jacobian with respect to the calibration
parameters at time step `k`. This matrix is always positive semi-definite. Its
**rank** equals the number of linearly independent observable directions; a rank
deficit indicates an unobservable subspace spanned by the null-space eigenvectors.

### 3.2 Diagnostics from the Gramian

| Diagnostic | Formula | Interpretation |
|---|---|---|
| Minimum eigenvalue | λ_min of W | Value near zero → corresponding eigenvector direction unobservable |
| Condition number | κ = sqrt(λ_max / λ_min) | κ > 10³–10⁴ → ill-posed calibration; numerical instability likely |
| Unobservability index | 1 / λ_min | Larger index means less observable in the worst direction |
| Per-parameter variance | diag(W⁻¹) | Approximate variance of each parameter (full-rank W only) |
| FIM rank | rank(W) | Must equal dim(theta) for all parameters to be jointly observable |

When `W` is rank-deficient, use the truncated pseudo-inverse `W⁺` (truncated
SVD) rather than `W⁻¹` to avoid numerical blow-up. The null-space eigenvectors
identify which parameter combinations are unobservable.

### 3.3 OA-LICalib Truncated-SVD Update (TRO 2022)

OA-LICalib (Lv et al., APRIL-ZJU) performs an **observability-aware state
update** inside the Gauss-Newton back-end: compute `W = J^T J`, SVD-decompose,
zero singular values below threshold τ, then apply only the truncated
pseudo-inverse:

```
delta_theta = V_r * Sigma_r^{-1} * U_r^T * residual
```

Updates are restricted to the identifiable subspace; null-space directions are
explicitly frozen. A complementary data-selection module uses log-det of the
accumulated FIM to admit only segments that improve the eigenspectrum.
OA-LICalib reports map thickness 1.9-2.3 cm vs 4.3-5.4 cm for uncalibrated
baselines (Table VI).

---

## 4. Fisher Information Matrix and Cramér-Rao Bounds

### 4.1 Definitions and CRLB

For a linear-Gaussian measurement model `y = H * theta + n`, `n ~ N(0, R)`,
the **Fisher Information Matrix** and **Cramér-Rao Lower Bound** are:

```
I(theta) = H^T * R^{-1} * H
Cov(theta_hat) >= I(theta)^{-1}     (Cramér-Rao Lower Bound)
```

When `I(theta)` is rank-deficient, the corresponding CRLB entries are infinite
— no unbiased estimator achieves finite variance for unobservable parameters.

### 4.2 Relation to the Observability Gramian

For a time-varying linearized system:

```
I(theta) = W(t0, t1) = sum_k  H_k^T * R_k^{-1} * H_k
```

The Gramian (unweighted) and FIM are equivalent up to noise weighting. Both
identify the same observable subspace; the FIM additionally quantifies how
well each direction is determined given the noise level.

### 4.3 FIM Minimum Eigenvalue as Trajectory Design Criterion

Observability-Aware Active Calibration (arXiv:2506.13420) uses the **minimum
eigenvalue of the FIM** as the optimization objective for trajectory generation:

```
maximize  lambda_min(I(theta))  over trajectory
```

Larger `lambda_min(I(theta))` → smaller CRLB trace → lower estimation
uncertainty. The optimized trajectories substantially outperform standard
patterns (figure-8, circle) across all calibration parameters. Rotation
parameters live on SO(3), not R^n — the intrinsic CRB on SO(3)
(arXiv:1503.04701) must be used for accurate bounds on rotation extrinsics.

---

## 5. Hand-Eye Calibration: `AX = XB`

### 5.1 The Formulation

Hand-eye calibration recovers the fixed extrinsic `X` from paired relative
motions satisfying `A_i * X = X * B_i`. Standard decomposition:

```
Rotation:    R_A * R_X = R_X * R_B          → solve for R_X
Translation: (R_A - I) * t_X = R_X*t_B - t_A  → solve for t_X given R_X
```

Methods: Tsai-Lenz (screw-motion), Daniilidis dual-quaternion, or iterative
nonlinear least-squares on SE(3). See
[Lie Groups SE(3), SO(3), Adjoints, and Jacobians](lie-groups-se3-so3-jacobians.md)
for the Exp/Log maps used in iterative solvers.

### 5.2 Observability Conditions

**Unique recovery of rotation** requires at least **two motions with non-parallel
rotation axes**. If all rotation axes are parallel (e.g., a vehicle that only
yaws), the rotation part of X is underdetermined — infinitely many R_X satisfy
the constraint.

**Unique recovery of translation** requires additionally that the rotation
sub-problem is uniquely solved AND that the translation equations form a
full-rank system. For pure rotations (no translation) t_X is unobservable.

Degenerate cases:

| Degenerate configuration | Unobservable component |
|---|---|
| Single rotation axis (vehicle yaw-only) | 2 of 3 rotation DoF; R_X underdetermined |
| All motion axes parallel across the dataset | Same as single axis, even with many motions |
| Pure translation, no rotation | R_X completely unobservable |
| Coplanar rotation axes | Provides 2 but not 3 independent rotation constraints |

The best calibration run is uncomfortable to drive: repeated speed changes,
left/right turns, figure-eights, pitch/roll excitation where safe, and scene
geometry visible across all overlapping sensors. The degenerate cases are
analyzed systematically in §6.

---

## 6. Degenerate Motion Patterns

This section is the most practically important for airside survey protocol
design.

### 6.1 Straight-Line Motion

Zero rotation → gyro-bias and LiDAR-IMU rotation extrinsic unobservable. Single
translation direction constrains only the lever-arm component along motion. Yaw
and lateral translation extrinsic are completely unobservable (compensating yaw
+ lateral shift produces identical outputs). Result: at best 2-3 of 6 extrinsic
DoF recoverable.

### 6.2 Planar Motion (Ground Robot, Airside Vehicle)

x-y translation + yaw = 3 observable DoF of the 6 required. Unobservable:
z-translation (vertical lever arm), roll extrinsic, pitch extrinsic. GRIL-Calib
(arXiv:2312.14035) confirms: "the lack of full motion will make the rank of FIM
less than its dimension." Their fix injects ground-plane motion (GPM) constraints
— LiDAR ground segmentation + known mounting height — to restore z-translation
observability. This is the default condition for an airside tug on flat tarmac.

### 6.3 Constant Velocity and Stationary

Under constant velocity only `b_a - R*g` is observable (see §7.1 accelerometer
model); accel-bias and gravity are coupled. When stationary, all
motion-dependent parameters become unobservable; only gyro-bias (mean angular
velocity ≈ 0) and gravity direction (mean accelerometer) are accessible. Park
et al. 2020: "the time lag parameter is not observable when the platform is
stationary" (arXiv:2001.06175).

### 6.5 Summary Table

| Motion Pattern | Unobservable Parameters |
|---|---|
| Stationary | All extrinsics, all time offsets; accel-bias partially |
| Constant-velocity straight line | LiDAR-IMU rotation, yaw/lateral extrinsic, time offset, gyro-bias |
| Planar yaw-only (spinning in place) | Translation extrinsics, lever arm |
| Planar motion (x-y + yaw) | Roll/pitch extrinsic, z-lever-arm (3 of 6 DoF missing) |
| Single rotation axis | 2 of 3 rotation extrinsic DoF |
| Short baseline with no rotation | Translation extrinsic (weak constraint) |

---

## 7. LiDAR-IMU Observability

### 7.1 IMU Bias Observability

**Gyroscope bias** (`b_g`): observable during any rotation — modest yaw turns
suffice to separate true angular rate from bias via the LiDAR-estimated
orientation constraint.

**Accelerometer bias** (`b_a`): under constant velocity the accelerometer
measures only gravity:

```
a_meas = R_body^world * (a_true - g) + b_a + noise
```

Only `b_a - R*g` is observable, not each individually. Sustained acceleration
variation (speed changes, centripetal turns) is required — steady taxiway runs
are insufficient.

### 7.2 Roll, Pitch, and Rotation Extrinsic

Roll and pitch are observable from gravity alignment once gyro-bias is known;
static periods give a coarse estimate. The rotation extrinsic `R_L^I` requires
**rotation around at least two non-parallel axes** (same condition as AX=XB).
LiDAR-inertial initialization (arXiv:2202.11006) monitors this online:

```
rank(J_r^T * J_r) < 3  →  rotation extrinsic not fully observable
rank(J_t^T * J_t) < 3  →  translation extrinsic not fully observable
```

OA-LICalib's truncated-SVD update (§3.3) handles the degenerate case by
restricting updates to the identifiable subspace until full excitation arrives.

---

## 8. LiDAR-Camera Observability

### 8.1 Feature Visibility Constraints

The LiDAR-camera extrinsic `T_LC` is estimated by minimizing reprojection error:
LiDAR points (known 3D positions) should project to their matched image features.
The measurement Jacobian for a single correspondence:

```
H = K * [I | 0] * (d P_c / d T_LC)
```

where `P_c` is the 3D point in camera frame and `K` is the camera intrinsic
matrix. This Jacobian has at most rank 2 per point (two image coordinates). To
recover all 6 DoF of `T_LC`, at minimum 3 non-coplanar correspondences are
needed — but for robust recovery many more are required.

### 8.2 Degenerate Scene Geometries

- **Coplanar 3D points** (flat wall, flat tarmac): depth variation zero in one
  direction → system matrix rank-deficient; 1-2 rotation DoF and translation in
  degenerate direction unobservable. Need ≥4 non-coplanar points.
- **Single planar surface**: provides 3 constraints but not all 6 extrinsic DoF.
- **Featureless scene**: no correspondences → completely unobservable.

Taxiway markings are coplanar — calibration must include off-plane features
(jetbridges, vehicles, vertical signs).

### 8.3 Lever-Arm vs Orientation Trade-off

Translation (lever-arm) is most sensitive to depth variation and baseline
length. Rotation `R_LC` is most sensitive to rotational parallax. Varied heading
changes improve rotation; varied standoff distances improve translation. Driving
parallel to a wall at fixed distance excites neither.

---

## 9. Time-Offset Observability

### 9.1 When Is the Time Offset Observable?

Sensitivity of any measurement to time offset `tau` is:

```
dy/d_tau  ≈  (dy/d_pose) * (d_pose/dt) * (velocity at t)
```

This vanishes when velocity is zero. Park et al. 2020 (arXiv:2001.06175):
time offset not observable when stationary; higher roll/pitch/yaw amplitudes
improve accuracy; optimal calibration uses 10-15 relative pose samples.

### 9.2 Sliding Cross-Correlation

Cross-correlating angular velocity from IMU against angular velocity inferred
from LiDAR scan-to-scan rotation as a function of hypothesized time shift
gives the peak-correlation estimate of `tau`. A stationary or constant-velocity
platform produces a flat correlation — completely uninformative.

### 9.3 Coupling with Spatial Calibration

Linearizing the temporal model shows why temporal and spatial calibration are
correlated:

```
h(x(t + dt)) ~= h(x(t)) + (dh/dx) * x_dot(t) * dt
```

If `dt` is not estimated or eliminated by hardware synchronization, the
optimizer absorbs timing error into the extrinsic transform — producing spatial
estimates that are wrong in a motion-speed-dependent way. See
[Sensor Calibration and Time Synchronization](sensor-calibration-time-synchronization.md)
§7 for the GPS-PPS / PTP architecture that eliminates this coupling.

---

## 10. Online vs Offline Observability Assessment

This section tests whether a collected calibration dataset was informative.
For route, bay, and active-maneuver design before data collection, see
[Active Calibration Experiment Design](active-calibration-experiment-design.md).

### 10.1 Offline Observability Analysis

Collect data, compute `W = sum_k H_k^T H_k`, eigendecompose, and inspect before
solving. Threshold: declare eigenvector direction unobservable when
`lambda_min < 1e-6 * lambda_max`. Condition number `kappa = sqrt(lambda_max /
lambda_min) > 10³` signals near-degenerate calibration. Per-parameter variance
`sigma^2_i ≈ [W⁺]_{ii}` (truncated pseudo-inverse) quantifies uncertainty per
parameter. If rank-deficient, collect more data with better excitation or fix
unobservable parameters to prior values.

### 10.2 Online Observability-Aware Update

OA-LICalib's truncated-SVD mechanism (§3.3) projects each Gauss-Newton update
onto the observable subspace. The observability-aware online multi-LiDAR
calibration (arXiv:2212.09579) selects pose pairs by maximum mutual information,
admitting only pairs that improve the FIM eigenspectrum.

**Refusing updates**: when `det(W_new) ≈ det(W_old)` (no new information), the
update is suppressed. For online calibration in the SLAM state vector
(e.g., FAST-LIO2 iterated-EKF), freeze the calibration state during straight-
line segments to prevent divergence from degenerate geometry.

---

## 11. Probabilistic Degeneracy Detection for Scan-Matching

Hatleskog & Alexis (arXiv:2410.10784) extend degeneracy detection to the LiDAR
registration Hessian. For each eigendirection `u_k`:

```
Signal:                a_u = u^T * H * u
Noise model:           xi_u ~ N(mu_hat_u, sigma_hat^2_u)
Observability prob:    P(a_u > s * xi_u)    [s=10 → relative error ≤ 10%]
Attenuated eigenvalue: lambda_k_plus = p_{u_k} * (1 / lambda_k)
```

This is a principled replacement for arbitrary eigenvalue thresholding. The
ICP/NDT Hessian is structurally identical to the calibration Gramian; a
geometrically degenerate scene (long corridor, flat plane) produces the same
null-space structure. Validated on tunnel, cylinder, and open-field environments.
See [ICP/NDT Hessian treatment](point-cloud-registration-math-icp-ndt-gicp.md).

---

## 12. SE(3) Covariance and Calibration Error Budget

Calibration uncertainty creates range-dependent measurement error. For a
rotation error δθ and translation error δt at sensor separation L:

```
e_projection ~= delta_t + range * delta_theta
```

At 30 m, a 0.1 degree yaw error produces `30 * sin(0.1 deg) ≈ 5.2 cm`. Covariance
must propagate through the same SE(3) adjoint used to apply the transform:

```
Sigma_out = Ad_{T} * Sigma_in * Ad_{T}^T
```

Do not rotate points without rotating their uncertainty. See
[Lie Groups SE(3), SO(3), Adjoints, and Jacobians](lie-groups-se3-so3-jacobians.md)
for the full adjoint derivation, and
[Sensor Calibration and Time Synchronization](sensor-calibration-time-synchronization.md)
§4 for the target-based vs targetless method comparison and production checklist.

---

## 14. Implications for Aggregated-Map Survey Protocols

### 14.1 Error Budget

Rotation error δθ at sensor separation d: lateral displacement ≈ `d × δθ`.
For d = 0.5 m, δθ = 0.5° → ~4.4 mm per scan; over 200-scan aggregation ≈ 4 cm,
crossing the 5 cm thin-class IoU degradation threshold. Time-offset error 1 ms
at 10 m/s → 1 cm shift; at 30 m/s → 3 cm. Both compound into "double wall" and
"ghost surface" artefacts in dense point clouds.

### 14.2 Observable Parameters by Motion Profile

| Calibration Parameter | Static | Straight Line | Planar (yaw+translate) | 6-DoF Full Excitation |
|---|---|---|---|---|
| Roll / pitch (tilt) | Partial (gravity) | Partial | Partial | Yes |
| Yaw extrinsic | No | No | Partial | Yes |
| Lever-arm x, y | No | Partial (x only) | Yes | Yes |
| Lever-arm z | No | No | No | Yes |
| Gyro bias | Partial (static avg) | No (need rotation) | Partial | Yes |
| Accel bias | No | No (const vel) | No (const vel) | Yes (with accel variation) |
| LiDAR-IMU time offset | No | No | Partial | Yes (with fast motion) |
| LiDAR-camera time offset | No | Partial | Partial | Yes |
| LiDAR-camera rotation extrinsic | No | No | Partial | Yes |
| LiDAR-camera translation extrinsic | No | Partial | Partial | Yes (with depth variation) |

Under straight-line or pure planar drives, 3 of 6 extrinsic DoF are structurally
unobservable. All ten parameter groups in this table are only fully observable
under 6-DoF excitation.

### 14.3 Required Motions for Fully Observable Calibration

| Parameter Group | Required Excitation |
|---|---|
| LiDAR-IMU rotation (all 3 axes) | Rotate around at least 2 non-parallel axes; include roll/pitch changes (speed bumps, ramp transitions at terminal curb) |
| LiDAR-IMU translation (lever arm) | Varied acceleration: accelerate and brake, not constant speed |
| Accelerometer bias | Sustained acceleration variation: multiple distinct speed profiles |
| Gyroscope bias | Any sustained rotation; even slow yaw turns suffice |
| LiDAR-camera rotation extrinsic | Multiple heading changes with scene viewpoints at varied elevation angles |
| LiDAR-camera translation extrinsic | Varied standoff distances; avoid driving parallel to walls at fixed distance |
| Time offset (LiDAR-camera) | Fast motion segments (> 5 m/s), high angular rates |
| Time offset (LiDAR-IMU) | High angular velocity events; sharp turns |

### 14.4 Recommended Survey Drive Protocol

1. **Dedicated 2-3 minute calibration segment before main survey**: figure-8
   or lemniscate paths (dual-axis rotation); slalom (lateral acceleration +
   heading variation); accelerate/decelerate on straight (accel-bias excitation);
   ramp or grade transition (roll/pitch unavailable on flat tarmac).
2. **Never calibrate from taxiway straight-line segments only**: roll/pitch
   extrinsic and z-lever-arm remain unobservable. The resulting map is internally
   consistent but geometrically wrong.
3. **Scene diversity for LiDAR-camera**: calibration area must include off-plane
   features (jetbridges, vehicles, vertical signs). Flat tarmac markings are
   coplanar and structurally insufficient.
4. **Monitor `lambda_min(W)` during calibration**: do not start the main survey
   until all DoF achieve eigenvalue above threshold. OA-LICalib's stopping
   criterion provides a principled implementation.
5. **Post-survey holdout check**: re-estimate from a different motion profile
   and compare; a significant discrepancy indicates thermal or vibration drift.

### 14.5 Map Artefacts from Poor Calibration

| Artefact | Cause |
|---|---|
| Double walls | Extrinsic translation error; two sensors place same surface at offset world positions |
| Smeared edges | Wrong orientation extrinsic; rotation error δR sweeps edge artefact proportional to δR × range |
| Z-layer confusion | Unobservable vertical lever arm; ground points float above road surface |
| Temporal blurring | Time-offset error; at 30+ km/h and 2 ms offset → 2-3 cm blur |

See [Aggregated-Map Semantic Segmentation](../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md)
for how map quality gates thin-class IoU.

---

## 15. Observability Tests Before Trusting a Calibration

An optimizer converging is not evidence of observability. A low residual can
be produced by correlated wrong parameters, a poor scene, or an over-flexible
time model.

| Check | What it catches |
|---|---|
| Motion coverage report | Straight-line-only data and single-axis rotations |
| Residual split by motion regime | Time offset hidden in turns or accelerations |
| Holdout dataset validation | Overfit to calibration target or one route |
| FIM rank / condition number | Parameters not identifiable from the dataset |
| FIM minimum eigenvalue per DoF | Estimate exists but too uncertain for fusion |
| Artificial perturbation test | Perturb solution; residuals must increase; flat response indicates degenerate manifold |
| Transform direction projection test | `T_A_B` vs `T_B_A` mistakes |

Online calibration updates should be gated by sufficient FIM rank, bounded
correction magnitude, and no concurrent dynamic-object dominance in residuals.
For airside autonomy, a calibration anomaly should feed degraded-mode policy
(reduce speed, disable fusion path, request maintenance) — never silently modify
the geometry used for aircraft clearance. See
[Sensor Calibration and Time Synchronization](sensor-calibration-time-synchronization.md)
§8 and §9 for the full online calibration and health-monitoring treatment.

---

## 18. Implementation Notes

- Apply LiDAR-IMU extrinsic before integrating IMU increments; the lever arm amplifies angular velocity error if applied late.
- Use `T_target_source` naming consistently; add projection tests in CI to catch inversion bugs.
- Log FIM minimum singular value per DoF in every calibration artifact; a small `sigma_min` is a leading indicator of poor calibration even when residuals look acceptable.
- Freeze online calibration state during straight-line segments to prevent divergence from degenerate geometry.
- Initialize targetless MI methods from a hand-measured approximate transform; convergence basin is narrow (~10 cm / ~5°).
- Use map wall-thickness as the primary end-to-end acceptance criterion. OA-LICalib reports 1.9-2.3 cm for observability-aware calibration vs 4.3-5.4 cm for uncalibrated baselines.
- Preserve calibration covariance; correlated sensors treated as independent create overconfident fusion.
- Truncated-SVD threshold `tau = 1e-3 * sigma_max` is a common starting point; smaller tau increases responsiveness at the cost of sensitivity to degenerate data.
- Rotation parameters live on SO(3), not R^3 — use the intrinsic CRB on SO(3) for accurate rotation uncertainty bounds; Euclidean bounds are valid only in the small-angle regime.

---

## 19. Failure Modes

| Symptom | Cause | Diagnostic |
|---|---|---|
| Double walls in aggregated map | Extrinsic rotation or translation error between sensors or scan epochs | Measure wall thickness metric; compare with and without per-sensor calibration applied |
| Z-layer confusion (ground points float) | Unobservable vertical lever arm from planar-only calibration drive | Check FIM rank for z-DoF; repeat calibration with ramp traversal or pitch excitation |
| Smeared edges proportional to range | Wrong orientation extrinsic; rotation error δR sweeps edge at long range | Per-beam plane residuals; compare planar std-dev by ring against spec |
| Temporal blurring at speed | Time-offset error absorbed into spatial extrinsic during constant-velocity calibration | Validate temporal offset independently; check residuals at high vs low speed |
| Single-axis motion | Translation or roll/pitch covariance remains large; FIM rank deficient | Require multi-axis calibration maneuvers; inspect per-DoF eigenvalue |
| Time offset ignored | Residuals grow with speed and yaw rate | Estimate temporal offset or enforce hardware sync (GPS-PPS / PTP) |
| Flat-scene targetless ICP | Calibration appears stable but yaw/height are weak | Check local geometry eigenvalues and scene diversity |
| Dynamic objects in residuals | Online monitor reports false drift | Use static-scene filters, temporal consistency, and robust loss |
| Wrong covariance frame | Fusion overweights or underweights detections after transform | Store covariance frame and apply adjoint propagation |
| All-zeros-residual trap | Degenerate motion: optimizer finds family of solutions with zero residual in observable subspace | Artificially perturb solution; residuals must increase; if flat, system is in degenerate manifold |
| High FIM condition number (κ > 10³) | Near-degenerate data; small perturbation shifts solution | Collect data with richer excitation; truncated-SVD update as mitigation |
| Silent mount movement | Perception still runs but objects shift consistently | Online residual monitoring and maintenance triggers |
| Camera-LiDAR projection misalignment at edges | Brown-Conrady model insufficient for fisheye lens | Switch to Kannala-Brandt / OpenCV fisheye model for >90° FoV cameras |

---

## Sources

- Hermann & Krener 1977, "Nonlinear controllability and observability" IEEE TAC: https://www.semanticscholar.org/paper/Nonlinear-controllability-and-observability-Hermann-Krener/efb2c0a57c0da86302c37e96cbbeb0f00c893746
- Mirzaei & Roumeliotis 2008, IMU-camera calibration observability, IEEE TRO 24(5): https://experts.umn.edu/en/publications/a-kalman-filter-based-algorithm-for-imu-camera-calibration-observ
- NOCT (Nonlinear Observability with Constraints and Time offset): https://arxiv.org/pdf/2207.07881
- OA-LICalib TRO 2022 (Lv et al., APRIL-ZJU): https://arxiv.org/abs/2205.03276 — GitHub: https://github.com/APRIL-ZJU/OA-LICalib
- GRIL-Calib RA-L 2024: https://arxiv.org/abs/2312.14035
- Park et al., spatiotemporal Camera-LiDAR calibration 2020: https://ar5iv.labs.arxiv.org/html/2001.06175
- Observability-Aware Active Calibration, arXiv:2506.13420: https://arxiv.org/html/2506.13420
- Intrinsic CRB on SO(3), arXiv:1503.04701: https://arxiv.org/pdf/1503.04701
- Probabilistic Degeneracy Detection, Hatleskog & Alexis, arXiv:2410.10784: https://arxiv.org/abs/2410.10784
- Hand-Eye Calibration Survey, Horaud, arXiv:2311.12655: https://arxiv.org/abs/2311.12655
- On the Covariance of X in AX=XB, arXiv:1706.03498: https://arxiv.org/pdf/1706.03498
- Robust Real-time LiDAR-inertial Initialization, arXiv:2202.11006: https://ar5iv.labs.arxiv.org/html/2202.11006
- Observability-aware Online Multi-lidar Calibration, arXiv:2212.09579: https://arxiv.org/abs/2212.09579
- Analytical Framework for Online Calibration Observability (PMC): https://pmc.ncbi.nlm.nih.gov/articles/PMC12116184/
- Observability Gramian usage, arXiv:1801.09877: https://arxiv.org/pdf/1801.09877
- LiDAR-Camera Calibration Observability for Arbitrary Configurations, arXiv:1903.06141: https://arxiv.org/pdf/1903.06141
- Tsai and Lenz, Hand/Eye Calibration: https://ieeexplore.ieee.org/document/34770
- Park and Martin, AX=XB on the Euclidean Group: https://ieeexplore.ieee.org/document/326576
- Furgale et al., Unified Temporal and Spatial Calibration: https://furgalep.github.io/bib/furgale_iros13.pdf
- Kalibr camera-IMU calibration toolbox: https://github.com/ethz-asl/kalibr
