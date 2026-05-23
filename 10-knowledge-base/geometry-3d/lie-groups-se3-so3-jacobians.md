# Lie Groups SE(3), SO(3), Adjoints, and Jacobians

<!-- kb-visual:start -->
![Lie Groups SE(3), SO(3), Adjoints, and Jacobians curated visual](../_assets/visuals/geometry-3d-lie-groups-se3-so3-jacobians.svg)

*Visual: manifold/tangent-space diagram showing SO(3)/SE(3), Exp/log maps, left/right perturbations, adjoint transform, and residual Jacobian linearization.*
<!-- kb-visual:end -->

Rigid body state is not a vector space. Rotations live on SO(3), poses live on
SE(3), and the local 3-vector or 6-vector used by an optimizer is only a
tangent-space perturbation. Treating pose parameters as ordinary Euclidean
variables is a common way to create inconsistent residuals, invalid covariance
propagation, and sign errors that only appear during aggressive turns or loop
closure.

---

## 1. Related Docs

- [Coordinate Frames, Projections, and SE(3)](coordinate-frames-projections-se3.md) — the bookkeeping layer that uses the same algebra; every `T_map_lidar` stored there is an SE(3) element
- [Point Cloud Registration Math: ICP, NDT, GICP](point-cloud-registration-math-icp-ndt-gicp.md) — consumes the SE(3) Jacobians derived here; the point-to-plane ICP Jacobian is derived in §8.1 below
- [Sensor Calibration and Time Synchronization](sensor-calibration-time-synchronization.md) — extrinsic transforms live in SE(3); Exp/Log maps appear in the per-point deskewing formula
- [Rolling Shutter / LiDAR Deskew and Motion Distortion](rolling-shutter-lidar-deskew-motion-distortion.md) — CT-ICP SE(3) geodesic interpolation described in §8.4 below
- [Multi-Sensor Calibration Observability](multi-sensor-calibration-observability.md)
- [GTSAM Factor Graphs](../state-estimation/gtsam-factor-graphs.md)
- [IMU Error Models and Preintegration](../state-estimation/imu-error-models-preintegration.md)
- [GLIM](../../30-autonomy-stack/localization-mapping/slam-methods/glim.md)

---

## 2. Why Lie Groups for 3D Pose

Rotations and rigid transforms are not elements of a vector space — they live
on curved manifolds. Standard Euclidean calculus fails because:

- SO(3) is a 3-dimensional manifold in R^9 constrained by R^T R = I and
  det(R) = +1. The average of two rotation matrices is not a rotation matrix.
- SE(3) is a 6-dimensional manifold. Adding a 6-vector to a 4x4 matrix is
  geometrically meaningless.

Lie theory provides a **tangent space** at every point — a vector space where
linearization, least-squares, and covariance propagation operate. The tangent
space at the identity is the **Lie algebra**.

| Object | Symbol | Dim | Role |
|---|---|---|---|
| SO(3) | Lie group (rotations) | 3-DoF manifold | orientation state |
| so(3) | Lie algebra | R^3 via hat | angular perturbation / velocity |
| SE(3) | Lie group (rigid transforms) | 6-DoF manifold | pose state |
| se(3) | Lie algebra | R^6 via hat | twist perturbation |

The **exponential map** `Exp: algebra -> group` and its inverse `Log: group ->
algebra` connect the two. Every ICP iteration, pose-graph linearization, IMU
bias correction, and CT-ICP interpolation uses this machinery.

Sources: Solà 2018, arXiv 1812.01537 — https://arxiv.org/abs/1812.01537;
Eade 2017 — https://www.ethaneade.com/lie.pdf

---

## 3. SO(3) — Rotations

### 3.1 The Manifold

```text
SO(3) = { R in R^(3x3) | R^T R = I,  det(R) = +1 }
```

Compact 3-dimensional manifold, not simply connected (pi_1(SO(3)) = Z/2Z) —
the topological reason quaternions (S^3) form a double cover.

### 3.2 The Lie Algebra so(3) — Hat and Vee Operators

The Lie algebra so(3) is the vector space of 3x3 **skew-symmetric** matrices.
Via the **hat operator** (^) any w in R^3 maps to so(3):

```text
hat(w) = [  0   -wz   wy ]
         [ wz    0   -wx ]
         [-wy   wx    0  ]
```

Key identity: `hat(w) * p = w x p` for any p in R^3.
The inverse **vee operator** recovers w from hat(w): `vee(hat(w)) = w`.

### 3.3 Exponential Map — Rodrigues' Formula

For w in R^3 with theta = norm(w) (rotation angle) and unit axis u = w/theta:

```text
R = Exp_SO3(w) = exp(hat(w))
              = I  +  A * hat(w)  +  B * hat(w)^2

A = sin(theta) / theta
B = (1 - cos(theta)) / theta^2
```

For theta -> 0 use Taylor series (exact via Cayley-Hamilton, not truncated):

```text
A  ~= 1 - theta^2/6 + theta^4/120
B  ~= 1/2 - theta^2/24 + theta^4/720
```

Switch to series when |theta| < 1e-4 (double precision).

### 3.4 Logarithmic Map

For R != I, the inverse (Log) recovers w in R^3:

```text
theta = acos( (trace(R) - 1) / 2 )

hat(w) = theta / (2 * sin(theta)) * (R - R^T)
```

Clamp the acos argument to [-1, 1]. Two singularities: theta = 0 (return w = 0)
and theta = pi (axis undefined up to sign; read from R diagonal). The log map
derivative diverges near theta = pi — see Pitfall §11.6.

### 3.5 Left vs Right Perturbations on SO(3)

```text
Right:  R' = R * Exp(dw)   -- dw in LOCAL (body) frame
Left:   R' = Exp(dw) * R   -- dw in GLOBAL (world) frame
```

These produce **different Jacobians** related via the adjoint:
`dw_left = R * dw_right`. Choosing one and applying it consistently is a
mandatory design decision. See §6 for library conventions.

Sources: Solà 2018 §5 — https://arxiv.org/abs/1812.01537;
Barfoot 2024 Ch. 7 — https://asrl.utias.utoronto.ca/~tdb/bib/barfoot_ser24.pdf

---

## 4. SE(3) — Rigid Transforms

### 4.1 The Manifold

```text
SE(3) = { T = [R  t]  |  R in SO(3),  t in R^3 }   subset of R^(4x4)
                [0  1]
```

Group multiplication:

```text
T1 * T2 = [R1*R2    R1*t2 + t1]
          [  0           1    ]
```

Inverse:

```text
T^{-1} = [R^T   -R^T * t]
         [ 0        1   ]
```

Action on a homogeneous point p_bar = [p; 1]:

```text
T * p_bar = [R*p + t; 1]   =>   result in R^3 is R*p + t
```

### 4.2 The Lie Algebra se(3) — Twist

The Lie algebra se(3) consists of 4x4 matrices parametrized by a **twist**
xi = (rho, w) in R^6 (translational part rho, angular part w):

```text
hat(xi) = [ hat(w)   rho ]   in R^(4x4)
          [   0       0  ]
```

This 6-vector has a **screw / twist** interpretation: simultaneous rotation
about and translation along a screw axis. By Chasles' theorem, any rigid
displacement equals such a screw motion.

The ordering xi = (rho, w) vs xi = (w, rho) varies by library. This page
follows (rho, w) as in Solà/Blanco; GTSAM and Modern Robotics use (w, v).
Verify the convention before writing Jacobians (see Pitfall §11.5).

### 4.3 Exponential Map — SE(3) Closed Form

```text
T = Exp_SE3(xi) = exp(hat(xi)) = [ Exp_SO3(w)    V(w) * rho ]
                                  [     0              1     ]
```

where Exp_SO3(w) is the SO(3) Rodrigues formula and the **V matrix** is:

```text
V(w) = I  +  B * hat(w)  +  C * hat(w)^2

B = (1 - cos(theta)) / theta^2
C = (theta - sin(theta)) / theta^3
```

with theta = norm(w). For theta -> 0: V -> I (pure translation limit). Use
Taylor for C when |theta| < 1e-4: `C ~= 1/6 - theta^2/120`.

### 4.4 Logarithmic Map for SE(3)

```text
w = Log_SO3(R)          -- recover rotation vector from R
theta = norm(w)

V_inv = I  -  (1/2) * hat(w)
           +  (1/theta^2) * (1 - theta*sin(theta) / (2*(1 - cos(theta)))) * hat(w)^2

rho = V_inv * t
xi = [rho; w]           -- the 6-vector twist
```

### 4.5 Screw / Twist Interpretation

A general SE(3) element represents a **screw motion** (Chasles' theorem): rotation
by theta about a screw axis combined with translation d along that axis; pitch = d/theta.
For a vehicle moving straight ahead: xi = (t, 0), V = I, T = [I, t; 0, 1].

Sources: Eade 2017 — https://www.ethaneade.com/lie.pdf;
Blanco 2010 — https://ingmec.ual.es/~jlblanco/papers/jlblanco2010geometry3D_techrep.pdf;
Solà 2018 — https://arxiv.org/abs/1812.01537

---

## 5. Quaternions — Double Cover of SO(3)

### 5.1 Unit Quaternions and S^3

`q = w + x*i + y*j + z*k` with `i^2 = j^2 = k^2 = ijk = -1`. Unit quaternion:
`w^2 + x^2 + y^2 + z^2 = 1`, placing q on the unit 3-sphere S^3. The group of
unit quaternions is isomorphic to SU(2). The map `pi: S^3 -> SO(3)` is a **2-to-1
double cover**: both q and -q represent the same rotation (source of Pitfall §11.4).

### 5.2 Rotation Action

For unit quaternion q = (w, v) with v = (x, y, z) and a vector p in R^3
(encoded as a pure quaternion [0, p]):

```text
p' = q * [0, p] * q*      (q* is conjugate = (w, -v))
```

### 5.3 Conversion Quaternion <-> Rotation Matrix

```text
R(q) = I + 2*w*hat(v) + 2*hat(v)^2

     = [ 1 - 2(y^2+z^2)    2(xy - wz)       2(xz + wy)   ]
       [ 2(xy + wz)         1 - 2(x^2+z^2)   2(yz - wx)   ]
       [ 2(xz - wy)         2(yz + wx)        1 - 2(x^2+y^2) ]
```

### 5.4 Hamilton vs JPL Convention

Hamilton (ROS, Eigen, GTSAM, Sophus): `q1*q2` applies q2 first, then q1
(same as matrix composition). JPL (aerospace/NASA): `q1*q2` applies q1 first.
Storage order `(w,x,y,z)` vs `(x,y,z,w)` also varies. Mixing produces
transposed rotations. Use Hamilton unless forced by an existing JPL codebase.

### 5.5 Numerical Advantages

No gimbal lock; cheap normalization `q <- q/norm(q)`; stable composition
avoids orthogonality drift; SLERP interpolation directly on S^3.

Sources: Solà 2018 §5.4 — https://arxiv.org/abs/1812.01537;
Wikipedia Charts on SO(3) — https://en.wikipedia.org/wiki/Charts_on_SO(3)

---

## 6. Left vs Right Perturbation Conventions

### 6.1 Definitions

```text
Right:  T' = T * Exp(d_xi)   -- d_xi in LOCAL (body) frame
Left:   T' = Exp(d_xi) * T   -- d_xi in GLOBAL (world) frame
```

Related via the group adjoint (§7.3): `d_xi_left = Ad_T * d_xi_right`.

### 6.2 Jacobian Consequences and Residual Rule

`J_left = J_right * Ad_T^{-1}`. Practical rule:

```text
Right residual:  r = Log( T_est^{-1} * T_gt )  -->  use right Jacobians
Left residual:   r = Log( T_gt * T_est^{-1} )  -->  use left Jacobians
```

Mixing introduces a sign flip or adjoint-conjugation error (Pitfall §11.1).

### 6.4 Library Conventions

| Library | Default | Notes |
|---|---|---|
| GTSAM | **Left** | `retract(xi) = Exp(xi) * X`; left-invariant factors |
| Sophus | **Right** | `BoxPlus(T,x) = T*Exp(x)`; `leftJacobian()` available |
| Ceres | **Right** (common) | `Plus(x,delta) = x*Exp(delta)`; user-defined |
| manif | **Right** | Based on Solà 2018; all ops expose right Jacobian |
| g2o | Varies | Typically right |

**GTSAM note**: Pose3 `retract` is `Exp(xi)*X` (left) despite some docs
saying "right". Verify with a numerical Jacobian check.

Sources: Solà 2018 §7 — https://arxiv.org/abs/1812.01537;
Sophus docs — https://deepwiki.com/strasdat/Sophus/2.1-3d-transformations-(so3-and-se3);
Blanco 2010 — https://ingmec.ual.es/~jlblanco/papers/jlblanco2010geometry3D_techrep.pdf

---

## 7. Jacobians of Common Operations

### 7.1 d(R*p)/dR — Rotation of a Point

Under **right** `R' = R * Exp(dw)` and **left** `R' = Exp(dw) * R`:

```text
Right:  d(R*p)/d(dw) |_0  =  - hat(R*p)       in R^(3x3)
Left:   d(R*p)/d(dw) |_0  =  - R * hat(p)     in R^(3x3)
```

Note: `hat(R*p) = R * hat(p) * R^T` — the two differ by conjugation.

### 7.2 d(T*p_bar)/dT — Rigid Transform of a Point

For T = [R, t] in SE(3), p_bar = [p; 1]:

```text
Right (T' = T*Exp(d_xi)):  d(T*p_bar)/d(d_xi) |_0  =  R * [ -hat(p)     I_3 ]   R^(3x6)
Left  (T' = Exp(d_xi)*T):  d(T*p_bar)/d(d_xi) |_0  =      [ -hat(T*p)   I_3 ]   R^(3x6)
```

where `T*p = R*p + t`. The left form is used in ICP Jacobian (§9.1).

Sources: Solà 2018 Tab. 4 — https://arxiv.org/abs/1812.01537;
Blanco 2010 — https://ingmec.ual.es/~jlblanco/papers/jlblanco2010geometry3D_techrep.pdf;
https://daniel.lawrence.lu/blog/y2021m09d08/

### 7.3 Adjoint Ad_T and Small Adjoint ad_xi

Group adjoint `Ad_T: se(3) -> se(3)`: `T * Exp(xi) = Exp(Ad_T * xi) * T`

For T = [R, t], twist ordering (rho, w):

```text
Ad_T  =  [ R          0  ]   in R^(6x6)
          [ hat(t)*R   R  ]
```

Block layout changes for (w, rho) ordering — see Pitfall §11.5.

Algebra adjoint (small ad) for xi = (rho, w):

```text
ad_xi  =  [ hat(w)    0     ]
           [ hat(rho)  hat(w) ]
```

satisfying `d/dt Ad_{Exp(t*xi)} |_0 = ad_xi`.
For SO(3): `Ad_R = R` and `ad_w = hat(w)`.

### 7.4 Right and Left Jacobians of SO(3)

The **right Jacobian** J_R(w) in R^(3x3) relates a perturbation in the algebra
to its first-order effect under right composition:

```text
Exp(w + dw) ~= Exp(w) * Exp(J_R(w) * dw)      (right BCH approximation)
```

Exact formula with theta = norm(w):

```text
J_R(w)  =  I  -  B * hat(w)  +  C * hat(w)^2

B = (1 - cos(theta)) / theta^2
C = (theta - sin(theta)) / theta^3
```

For theta -> 0: J_R -> I. Inverse:

```text
J_R^{-1}(w) = I  +  (1/2) * hat(w)
                 +  (1/theta^2) * (1 - theta*sin(theta)/(2*(1-cos(theta)))) * hat(w)^2
```

The **left Jacobian** J_L(w) = J_R(-w): same formula but +B instead of -B on
the hat(w) term. `J_L^{-1}(w) = J_R^{-1}(-w)`.

Both appear throughout IMU pre-integration, pose-graph linearization, and
covariance propagation. Omitting J_R in IMU bias correction is Pitfall §11.3.

Sources: Solà 2018 §C — https://arxiv.org/abs/1812.01537; Eade 2017 — https://www.ethaneade.com/lie.pdf

### 7.5 BCH Formula — Baker-Campbell-Hausdorff

```text
log(exp(A)*exp(B)) = A + B + (1/2)[A,B] + (1/12)([A,[A,B]] - [B,[A,B]]) + ...
```

First-order small-dw approximation:

```text
Exp(w) * Exp(dw)  ~=  Exp(w + J_L(w)^{-1} * dw)
Exp(dw) * Exp(w)  ~=  Exp(w + J_R(w)^{-1} * dw)
```

For both A and B small: `Exp(A)*Exp(B) ~= Exp(A+B)`. Used in IMU bias
correction to fuse a small db_omega into the accumulated rotation (§9.3).

---

## 8. On-Manifold Optimization

### 8.1 Boxplus / Boxminus (Hertzberg et al. 2013)

Hertzberg et al. (arXiv 1107.1119) formalize on-manifold optimization via:

```text
boxplus:   S x R^n -> S       X boxplus delta
boxminus:  S x S   -> R^n     Y boxminus X
```

Four axioms: (1) `X boxplus 0 = X`; (2) `X boxplus (Y boxminus X) = Y`;
(3) `(X boxplus d) boxminus X = d`; (4) Lipschitz in d.

For SO(3) right: `R boxplus dw = R * Exp(dw)`, `R2 boxminus R1 = Log(R1^{-1} * R2)`.
For SE(3) right: `T boxplus d_xi = T * Exp(d_xi)`, `T2 boxminus T1 = Log(T1^{-1} * T2)`.

### 8.2 On-Manifold Gauss-Newton

Replace vector addition with boxplus; compute J = dr/d(delta) in the local
tangent space:

```text
Standard:  x_{k+1}  =  x_k  -  (J^T W J)^{-1} J^T W r(x_k)
Manifold:  X_{k+1}  =  X_k  boxplus  (- (J^T W J)^{-1} J^T W r(X_k))
```

### 8.3 GTSAM LieGroup Traits

Every group type (SO3, Pose3 etc.) provides a `traits<T>` struct with:
`Retract(X, xi)` = `Exp(xi) * X` (left); `LocalCoordinates(X, Y)` = boxminus;
`between(X, Y)` = `X^{-1} * Y`; optional analytic Jacobian H pointers.
`BetweenFactor<Pose3>` implements relative-pose residuals under left convention.

### 8.4 Ceres Manifold API

`Plus(x, delta)` implements boxplus; `ComputeJacobian(x)` returns J_GL =
`d(x boxplus delta)/d(delta)|_0`. Chain rule:
`J_residual_local = J_residual_global * J_GL`.
`QuaternionParameterization` lifts a 3D tangent update to a 4D quaternion update.

Sources: Hertzberg 2013 — https://arxiv.org/abs/1107.1119;
GTSAM Concepts — https://gtsam.org/notes/GTSAM-Concepts.html;
Ceres — http://ceres-solver.org/nnls_modeling.html;
Solà 2018 — https://arxiv.org/abs/1812.01537

---

## 9. Applications in the LiDAR Pipeline

### 9.1 ICP Linearization — Point-to-Plane Jacobian

Objective: `E(T) = sum_i ( n_i^T * (T*p_s_i - p_t_i) )^2`

Under left perturbation `T' = Exp(d_xi) * T`, the per-correspondence row:

```text
j_i^T  =  n_i^T * [ -hat(T*p_s_i)   I_3 ]   in R^(1x6)
```

Under right perturbation `T' = T*Exp(d_xi)`:

```text
J_T  =  R(T) * [ -hat(p_s_i)   I_3 ]   in R^(3x6)
```

Stack all rows; solve normal equations or QR. This is the core of LOAM-family
odometry. Jacobian follows directly from d(T*p)/dT in §7.2.
Full context: [Point Cloud Registration Math](point-cloud-registration-math-icp-ndt-gicp.md).

Sources: Blanco 2010 — https://ingmec.ual.es/~jlblanco/papers/jlblanco2010geometry3D_techrep.pdf;
https://daniel.lawrence.lu/blog/y2021m09d08/

### 9.2 Pose-Graph Optimization — Relative SE(3) Constraints

Residual: `r_ij = Log( Z_ij^{-1} * T_i^{-1} * T_j )  in R^6`

Jacobians (right perturbation):

```text
d r_ij / d d_xi_i  =  - Ad_{T_j^{-1} T_i}^{-1}  *  J_R(r_ij)^{-1}
d r_ij / d d_xi_j  =    J_R(r_ij)^{-1}
```

Omitting `J_R^{-1}` is valid only at near-zero residuals; freshly closed loops
will converge slowly or incorrectly without it.
Solvers: g2o (LeGO-LOAM), GTSAM iSAM2 (LIO-SAM), Ceres.

Sources: Forster 2017 — https://arxiv.org/abs/1512.02363;
Blanco 2010 — https://ingmec.ual.es/~jlblanco/papers/jlblanco2010geometry3D_techrep.pdf

### 9.3 IMU Pre-Integration on SO(3) (Forster / Carlone 2017)

Integrate the **rotation increment** on the SO(3) manifold between keyframes:

```text
DeltaR_ij  =  product_{k=i}^{j-1}  Exp(omega_k * dt)     in SO(3)
```

where `omega_k = omega_measured_k - b_omega`. First-order bias correction:

```text
DeltaR_ij(b + db)  ~=  DeltaR_ij(b) * Exp(J^DeltaR_{b} * db)

J^DeltaR_{b}  =  - sum_{k=i}^{j-1}  DeltaR_{k+1,j}^T * J_R(omega_k*dt) * dt
```

J_R appears because integration uses right composition `R_{k+1} = R_k * Exp(omega_k*dt)`.
Covariance propagation: `F_k` includes `d Exp(omega*dt)/d omega = J_R(omega*dt)*dt`.
Full derivation in 2017 TRO supplemental.
See [IMU Error Models and Preintegration](../state-estimation/imu-error-models-preintegration.md).

Sources: Forster, Carlone, Dellaert, Scaramuzza (2017 TRO) — https://arxiv.org/abs/1512.02363;
Supplementary — https://rpg.ifi.uzh.ch/docs/RSS15_Forster_Supplementary.pdf

### 9.4 CT-ICP — Continuous-Time Geodesic Interpolation on SE(3)

CT-ICP (Dellenbach et al., ICRA 2022) corrects per-point motion distortion via
**SE(3) geodesic interpolation** (SE(3) analogue of SLERP):

```text
T(tau)  =  T_0 * Exp( tau * Log(T_0^{-1} * T_1) )      tau in [0, 1]
```

Per-point Jacobians via chain rule:

```text
d r_k / d xi_0  =  J_pointplane * d T(tau_k) / d xi_0
d r_k / d xi_1  =  J_pointplane * d T(tau_k) / d xi_1
```

Essential for platforms with <20 Hz LiDAR or fast manoeuvres (aircraft tow,
AGVs). The same formula appears in calibration deskewing:
[Sensor Calibration §5.3](sensor-calibration-time-synchronization.md).
Full treatment: [Rolling Shutter / LiDAR Deskew](rolling-shutter-lidar-deskew-motion-distortion.md).

Sources: CT-ICP ICRA 2022 — https://arxiv.org/abs/2109.12979

### 9.5 LiDAR Bundle Adjustment

3D points and poses jointly optimized. Pose nodes are SE(3); residuals
linearized via d(T*p)/dT from §7.2; Schur complement marginalizes points.
True LiDAR BA is less mature than visual BA as of 2025; pose graph + loop
closure + raw-scan re-aggregation is the current production approach.

---

## 10. Numerical Considerations

### 10.1 Small-Angle Approximations

Near theta = 0, Rodrigues and J_R have 0/0 forms; use Taylor series:

```text
sin(theta)/theta         ~= 1 - theta^2/6 + theta^4/120
(1-cos(theta))/theta^2   ~= 1/2 - theta^2/24
(theta-sin(theta))/theta^3 ~= 1/6 - theta^2/120
```

Switch at |theta| < 1e-4. Reference: https://github.com/nurlanov-zh/so3_log_map.

### 10.2 Re-Orthogonalization

Rotation matrix drift: re-orthogonalize via SVD `[U,S,V^T] = svd(R)`,
`R <- U*V^T`. Quaternion drift: re-normalize `q <- q/norm(q)` after each update.

### 10.3 Library Implementations

| Library | Groups | Notes |
|---|---|---|
| Sophus | SO2/3, SE2/3, Sim3 | Right BoxPlus default; leftJacobian() available; Ceres-compatible |
| GTSAM | Rot3, Pose3, SO3/4 | Left perturbation; full factor-graph integration |
| manif | SO2/3, SE2/3, S2 | Right Jacobians; auto-diff; based on Solà 2018 |
| smooth | SO3, SE3, Rn, Sn | Right and left Jacobians; dr_exp, dl_exp, dr_expinv |
| pytransform3d | SO3, SE3 | Python; quaternion + matrix |

---

## 11. Common Pitfalls

Six pitfalls that appear in LiDAR SLAM, calibration, and IMU fusion code and
produce symptoms easy to misdiagnose as data quality problems.

### 11.1 Left vs Right Convention Mismatch

Copying a Jacobian from a paper with the opposite convention is the most common
error. Symptom: optimizer converges to wrong values; factor-of-2 bias in EKFs.
Diagnosis: `r = Log(T_est^{-1} * T_gt)` => right Jacobians;
`r = Log(T_gt * T_est^{-1})` => left Jacobians. Always verify with a
finite-difference Jacobian check.

### 11.2 Skew-Matrix Sign Convention

Convention A (Solà/Eade/Barfoot — standard): see §3.2 matrix. Satisfies
`hat(w)*p = w x p`. Convention B (some older texts) has opposite signs.
Mixing flips every rotation Jacobian. Test: `hat(e1)*e2 = e3` under A.

### 11.3 Missing J_R in IMU Pre-Integration

Correct formula: `DeltaR_corrected ~= DeltaR * Exp(J^DeltaR_{b} * db)`.
A common error sets J^DeltaR = I (i.e., `Exp(db)` directly). Valid only for
very small `omega_k * dt`; introduces systematic bias for large angular rates
or long integration windows.

### 11.4 Quaternion Antipodal Inconsistency

q and -q represent the same rotation. SLERP across a hemisphere boundary without
sign flip produces a spurious 360° spin. Fix: if `dot(q_a, q_b) < 0`, negate
q_b before interpolating. Same issue corrupts EKF updates with inconsistent sign.

### 11.5 Incorrect Adjoint Block Order

Block layout depends on twist ordering: (rho, w) [Solà/Blanco] places
`[hat(t)*R, R]` in the lower row; (w, rho) [Modern Robotics] rearranges blocks.
Verify numerically: `T * Exp(xi) = Exp(Ad_T * xi) * T` for a sample T and xi.

### 11.6 Log Map Singularity at theta = pi

The SO(3) log is not smooth at theta = pi: the axis is only defined up to sign
and the derivative diverges. Pose-graph edges spanning near-180 deg require
special handling (split rotation or use angle-axis directly). In scan-to-map
matching after long dead-reckoning this can produce NaN or an inconsistent axis.

---

## 12. Algorithm Steps

### 12.1 Pose Optimization (Manifold-Correct)

1. Store state as T in SE(3), not as six unconstrained scalars.
2. Compute residuals via group ops: `r = Log(T_meas^{-1} * T_pred)`.
3. Compute Jacobians w.r.t. local tangent delta; document left or right.
4. Solve normal equations or damped LS for delta in R^6.
5. Retract: right `T <- T * Exp(delta)` or left `T <- Exp(delta) * T`.
6. Re-normalize rotation if storing as matrix.
7. Stop on tangent norm, residual change, and cost change.

### 12.2 Covariance Propagation

```text
T_ac = T_ab * T_bc:
  Sigma_ac  ~=  J_ab * Sigma_ab * J_ab^T  +  J_bc * Sigma_bc * J_bc^T

Frame change only:
  Sigma_a  =  Ad_{T_ab} * Sigma_b * Ad_{T_ab}^T
```

Do not rotate a mean transform and leave its covariance in the old tangent frame.

---

## 13. Implementation Notes

- Use library Lie operations: GTSAM Pose3, Sophus, manif, Ceres Manifold.
- Clamp `acos` input to [-1, 1] before the SO(3) log map.
- Use series expansions (§10.1) when |theta| < 1e-4.
- Keep quaternion storage normalized; never optimize 4 components as 4 free DoF.
- Name transforms by direction: `T_map_base`, not `base_pose`.
- Include a point-transform sanity test for every extrinsic.
- In code reviews: check perturbation side, tangent ordering (rho,w vs w,rho),
  and residual invariance under global frame changes.
- When integrating between libraries (Sophus rotation into GTSAM factor), write
  an explicit convention-translation adapter and add a numerical Jacobian test.
- Finite-difference Jacobian checks must use the same retraction as the analytic
  Jacobian; raw matrix addition will not test the manifold correctly.

---

## 14. Failure Modes and Diagnostics

| Symptom | Likely cause | Diagnostic |
|---|---|---|
| Optimizer converges for small rotations but fails on U-turns | Euler-angle or small-angle approximation used outside its domain | Compare analytic residuals with finite differences at 90, 170, and 179 degrees |
| Optimizer converges slowly near the true optimum; first step looks correct | Left/right perturbation mismatch in Jacobian | Run finite-difference Jacobian check using the same retraction as the solver |
| EKF rotation estimate has a systematic factor-of-2 bias | Left/right convention mismatch; adjoint applied on wrong side | Check convention of every Jacobian source against the filter's retraction |
| Covariance ellipse points in the wrong direction after a transform | Missing adjoint or wrong 6-vector ordering | Transform sampled perturbations; compare empirical covariance to Ad_T * Sigma * Ad_T^T |
| Loop closure moves the graph in the opposite direction | Relative-pose residual is inverted | Evaluate a one-edge graph with a known 1 m error; inspect the first Gauss-Newton step |
| IMU bias correction causes drift to grow rather than shrink | J_R accumulation omitted in pre-integration bias Jacobian | Verify bias-corrected DeltaR against re-integrated rotation; check for J_R = I substitution |
| Pose jumps when crossing a 180 deg rotation | SO(3) log branch cut | Plot norm(Log(R_ref^T * R)) across the sequence; inspect discontinuities near pi |
| SLERP trajectory has a 360 deg spin at one point | Quaternion antipodal flip | Check dot(q_a, q_b) before each SLERP; negate q_b when dot < 0 |
| Adjoint-transformed covariance is clearly wrong | Adjoint block layout mismatches twist ordering | Verify numerically: sample perturbations, transform via group multiplication, compare to Ad_T prediction |
| Map ghost structures appear when using CT-ICP | SE(3) geodesic interpolation convention wrong | Verify T(0) = T_0 and T(1) = T_1 analytically; check that tau is normalized to [0,1] |

---

## 15. Sources

- Joan Solà, Jeremie Deray, Dinesh Atchuthan (2018/2021). A micro Lie theory for state estimation in robotics. arXiv 1812.01537: https://arxiv.org/abs/1812.01537; ar5iv HTML: https://ar5iv.labs.arxiv.org/html/1812.01537
- Ethan Eade (2017). Lie Groups for 2D and 3D Transformations: https://www.ethaneade.com/lie.pdf
- Timothy D. Barfoot (2024). State Estimation for Robotics, 2nd ed. Cambridge: https://asrl.utias.utoronto.ca/~tdb/bib/barfoot_ser24.pdf
- Forster, Carlone, Dellaert, Scaramuzza (2017 TRO). On-Manifold Preintegration for Real-Time Visual-Inertial Odometry: https://arxiv.org/abs/1512.02363; Supplementary: https://rpg.ifi.uzh.ch/docs/RSS15_Forster_Supplementary.pdf
- Hertzberg, Wagner, Frese, Schröder (2013). Integrating Generic Sensor Fusion Algorithms with Sound State Representations through Encapsulation of Manifolds. arXiv 1107.1119: https://arxiv.org/abs/1107.1119; ar5iv: https://ar5iv.labs.arxiv.org/html/1107.1119
- Blanco-Claraco (2010). A tutorial on SE(3) transformation parameterizations and on-manifold optimization: https://ingmec.ual.es/~jlblanco/papers/jlblanco2010geometry3D_techrep.pdf
- Dellenbach et al. (CT-ICP, ICRA 2022). CT-ICP: Real-time Elastic LiDAR Odometry with Loop Closure: https://arxiv.org/abs/2109.12979
- nurlanov SO3 log map edge cases: https://github.com/nurlanov-zh/so3_log_map
- Sophus: https://github.com/strasdat/Sophus; DeepWiki: https://deepwiki.com/strasdat/Sophus/2.1-3d-transformations-(so3-and-se3)
- manif: https://github.com/artivis/manif
- smooth: https://pettni.github.io/smooth/
- GTSAM Concepts: https://gtsam.org/notes/GTSAM-Concepts.html; Pose3 docs: https://borglab.github.io/gtsam/pose3/
- Ceres LocalParameterization: http://ceres-solver.org/nnls_modeling.html
- SE3 Jacobian derivation: https://daniel.lawrence.lu/blog/y2021m09d08/
- Modern Robotics adjoint: https://modernrobotics.northwestern.edu/nu-gm-book-resource/3-3-2-twists-part-2-of-2/
- On-Manifold Optimization / Local Parameterization: https://spatial-ai.net/state%20estimation/manifold-optimization-local-parameterization.html
- karnikram Lie blog: https://karnikram.info/blog/lie/
- ROS REP-103 coordinate conventions: https://www.ros.org/reps/rep-0103.html
