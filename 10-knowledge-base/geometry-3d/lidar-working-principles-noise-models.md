# LiDAR Working Principles and Noise Models

<!-- kb-visual:start -->
![LiDAR Working Principles and Noise Models curated visual](../_assets/visuals/geometry-3d-lidar-working-principles-noise-models.svg)

*Visual: LiDAR point formation diagram showing emitted pulse or chirp, time-of-flight/FMCW measurement, beam angle, reflectance, incidence angle, weather dropout, and range noise.*
<!-- kb-visual:end -->

LiDAR turns emitted light into range, bearing, and sometimes reflectance or
velocity measurements. For perception it is a geometric sensor. For SLAM and
mapping it is a source of dense surface constraints. The useful model is not
"a point cloud is truth"; it is "each returned point is a range-bearing
measurement whose uncertainty depends on beam geometry, target material,
incidence angle, atmosphere, timing, and calibration."

---

## Related Docs

- [Point Cloud Representations and Voxelization: First Principles](point-cloud-representations-voxelization-first-principles.md)
- [Point Cloud Segmentation Losses and Metrics: First Principles](point-cloud-segmentation-losses-metrics-first-principles.md)
- [Correspondence Search and Data Structures](correspondence-search-data-structures.md)
- [Rolling Shutter and LiDAR Deskew / Motion Distortion](rolling-shutter-lidar-deskew-motion-distortion.md)
- [Sensor Calibration and Time Synchronization](sensor-calibration-time-synchronization.md)
- [LiDAR Artifact Removal Techniques](../../30-autonomy-stack/perception/overview/lidar-artifact-removal-techniques.md) — sensor noise feeds the conditioning pipeline
- [Aggregated-Map Semantic Segmentation](../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md) — §9 conditioning depends on the noise sources here

---

## Why It Matters

| Choice / Effect | Impact | Risk if ignored |
|---|---|---|
| ToF vs. FMCW | FMCW adds per-point velocity; different noise floor | Treating FMCW radial velocity as 3D velocity corrupts tracker |
| Wavelength (905 vs. 1550 nm) | Eye-safety budget, fog/mist tolerance, solar noise | 905 nm degrades significantly in de-icing mist |
| Beam divergence | Controls mixed-pixel rate at depth edges | Wide-divergence sensors miss wires and apron markers at range |
| Incidence-angle dependence | Reflectance and range noise scale with cos(alpha) | Ground markings at grazing incidence return near-zero intensity |
| Raw vs. calibrated intensity | ~4% mIoU gain from calibrated reflectivity | Models fail across passes, sensors, and temperatures |
| Weather attenuation | 2–10× outlier rate; reduced effective range | Clear-weather perception fails on foggy apron |
| Motion distortion | 50 cm smear at 5 m/s over 100 ms sweep | Painted markings smear; scan matching diverges |
| Time synchronization | 1 ms LiDAR–IMU offset → cm-class deskew error | Ghost duplicates in multi-LiDAR setups |

---

## 1. What a LiDAR Point Measures

A scanning LiDAR point is stored as:

```
p_lidar = [x, y, z]
intensity = returned signal metric, vendor-specific
ring = laser channel or scan line
time = per-point or per-column acquisition time
return_type = strongest, first, last, dual, or vendor-specific
radial_velocity = FMCW sensors only; signed m/s
```

The spherical measurement model:

```
z = [r, theta, phi, I]
x = r * cos(phi) * cos(theta)
y = r * cos(phi) * sin(theta)
z = r * sin(phi)
```

The sensor measures natively in spherical coordinates; the Cartesian conversion
introduces non-uniform spacing: tangential point spacing grows linearly with `r`,
so ground-plane density (points/m²) falls as 1/r². Along the radial direction
spacing is fixed by the pulse repetition interval.

### Sensor Model Impact

| Task | Why the model matters |
|---|---|
| Perception | Object size, freespace, curb height inherit range and angular noise. Ray drops can look like free space unless explicitly modeled. |
| SLAM | ICP/GICP residuals assume a point covariance. Wrong covariances over-weight grazing-angle and weather-corrupted points. |
| Mapping | Static maps accumulate systematic beam and timing errors into blurred walls, doubled poles, and biased ground planes. |
| Validation | Test against range, incidence angle, intensity, weather, and motion bins — not only aggregate precision/recall. |

---

## 2. Measurement Principles: ToF, AM-CW, and FMCW

### 2.1 Pulsed Direct Time-of-Flight (ToF)

Dominant architecture for automotive and mobile laser scanning sensors. A laser
fires a short pulse (~few ns); the receiver measures the round-trip time:

```
r = c * delta_t / 2
```

where `c = 3e8 m/s`. Receivers use APD or SPAD detectors. Typical pulse widths
2–10 ns produce range ambiguity windows of 0.3–1.5 m, resolved by time-gating.

### 2.2 Amplitude-Modulated Continuous Wave (AM-CW)

The laser power is sinusoidally modulated at `f_mod`; range is from the phase
shift of the returning envelope:

```
r = c * delta_phi / (4 * pi * f_mod)
```

Practical for short-range depth cameras; rarely used in long-range automotive
class due to inherent range ambiguity beyond one modulation wavelength.

### 2.3 Frequency-Modulated Continuous Wave (FMCW)

FMCW adapts coherent radar to optical wavelengths. The transmitter emits a
linearly chirped continuous beam; a local oscillator mixes with the return to
produce a beat frequency proportional to range:

```
f_beat = kappa * tau_D     where tau_D = 2r/c
r = f_beat * c / (2 * kappa)
kappa = B / T_chirp                   (chirp rate, Hz/s)
range_resolution = c / (2 * B)
sigma_r ~= c / (2 * B * sqrt(SNR))   (Cramer-Rao precision)
```

Simultaneous velocity via Doppler (up-chirp / down-chirp pair separates range
and velocity):

```
f_D = 2 * v_r / lambda
```

FMCW advantages: coherent detection rejects solar photons; lower peak power
improves eye safety; per-point signed radial velocity enables dynamic/static
separation without temporal differencing. Disadvantages: requires high-quality
tunable lasers, high-speed ADC, FPGA-class FFT; currently higher cost than ToF.
Treat FMCW velocity as line-of-sight (radial only), not full 3D velocity.

---

## 3. Sensor Architectures and Scan Patterns

### 3.1 Spinning Mechanical

A motor rotates N laser/detector pairs at 10–20 Hz. Each laser fires at a
fixed elevation angle; the rotating platform sweeps 360° in azimuth, producing
a cylindrical scan with uniform azimuth spacing (~0.1°–0.4°) and fixed,
non-uniform elevation layers. One revolution = one scan (~50–100 ms at 10–20 Hz).

Point density is range-dependent in the horizontal plane (tangential spacing
proportional to r) but the number of rings is fixed. 64-channel sensors
(HDL-64E, OS1-64) provide 2–4× denser elevation coverage than 16-channel,
substantially improving thin-class recall. Gaps between rings widen with range;
thin horizontal features (wires, painted lines) can fall between rings at
distance. Mature technology with high MLS deployment reliability; rotating seal
limits IP-rating longevity.

### 3.2 MEMS

An oscillating mirror steers the beam with no full rotation. Scan patterns
include raster, Lissajous, or pseudo-random over limited FOV (e.g., ±25°
horizontal). Lissajous scan produces non-uniform density — denser at FOV
centre/edges — requiring density-normalized processing. Currently the dominant
commercial solid-state approach (Innoviz, Blickfeld, Hesai AT128).

### 3.3 OPA and Flash

**OPA:** phase-shift waveguide arrays steer the beam electronically — no moving
parts. Currently limited FOV and power efficiency; promising for future
sub-$100 costs.

**Flash:** a single large divergent pulse illuminates the entire scene; a 2D
SPAD/APD array detects returns simultaneously. No motion distortion per flash;
range limited by power/FOV trade-off. Suited for short-range proximity sensing
(AGV docking, drone landing).

---

## 4. Wavelength Choice: 905 nm vs. 1550 nm

### 4.1 Eye Safety (IEC 60825-1 Class 1)

Below ~1400 nm the beam focuses on the retina; MPE is low. At 1550 nm water
absorption in the cornea prevents retinal exposure; the Class 1 MPE is
approximately 40× higher than at 905 nm, allowing far more emitted optical
power for the same safety class.

### 4.2 Detectors and Solar Background

| Wavelength | Detector | Cost | Solar background |
|---|---|---|---|
| 905 nm | Silicon APD / SPAD | Low | High (solar peak ~500–900 nm) |
| 1550 nm | InGaAs / Germanium APD | Higher | Low (solar falls steeply above 1400 nm) |

1550 nm: better collimation (4× smaller spot at 100 m in direct comparison);
lower solar background → improved daytime SNR; 20–40% practical range
advantage in direct-sunlight conditions.

### 4.3 Weather Performance

- **Fog / mist:** Mie scattering cross-section decreases with wavelength →
  1550 nm has lower extinction. At 50 m visibility, attenuation ~9.2 dB; 1550 nm
  gives measurably longer effective range. Airport apron de-icing mist
  (propylene-glycol aerosol) acts as artificial fog — 1550 nm is preferable.
- **Rain:** both wavelengths broadly comparable. Rain at 98 mm/h → ~22.7% FDR
  at 20 m; distance errors up to 4.9 cm at 20 m.
- **Snow:** 905 nm may have slight edge in heavy snowfall; 1550 nm water-
  absorption resonance is a disadvantage in wet snow.

**Practical airside recommendation:** 1550 nm for apron deployments where
de-icing mist and fog are primary risks. 905 nm adequate for clear-weather
high-speed outdoor domains where cost matters.

---

## 5. Geometry of Measurement

### 5.1 Polar-Native Representation and 1/r² Density

The 1/r² density fall-off is fundamental: far more returns per unit area near
the sensor than far away. Tangential spacing is fixed in angle but grows
linearly with r; radial spacing is fixed by the pulse repetition interval.
Aggregated multi-scan maps smooth the variation by accumulating returns from
many poses, but residual density gradients affect segmentation model behavior.

### 5.2 Beam Divergence and Footprint

For beam divergence half-angle `gamma`, the footprint diameter at range r:

```
d_footprint ~= 2 * r * tan(gamma/2) ~= r * gamma    [small angle]
```

Examples: Teledyne Optech CL-360, gamma ~= 0.3 mrad → d = 3 cm at 100 m;
typical automotive spinning sensor, gamma ~= 3 mrad → d = 30 cm at 100 m.

Larger footprint at range has two effects:
1. **Energy spreading:** received power from a Lambertian target falls as 1/r²
   (footprint area ∝ r² compensates geometric spreading).
2. **Mixed pixels:** footprint straddles depth discontinuities → flying points
   at incorrect intermediate ranges (§8.3).

### 5.3 Incidence Angle Effect

For a Lambertian surface, reflected intensity scales with `cos(alpha)` where
`alpha` is the angle between beam and surface normal:

```
sigma_r_eff = sigma_r_base / max(cos(alpha), epsilon)
drop_prob increases as cos(alpha) -> 0
```

Grazing incidence causes low SNR, widened range noise, elongated footprint, and
systematic range bias toward the leading edge of the footprint. Critical for:
ground-plane extraction at range; aircraft fuselage; glass and wet concrete;
apron markings at low sensor mounting height.

---

## 6. Intensity and Reflectance

### 6.1 Raw Intensity Model

The sensor reports a dimensionless integer proportional to returning pulse
amplitude. The essential dependencies for calibration:

```
I(r, alpha, rho) ~= eta(r) * rho * cos(alpha) / r^2
```

Where `rho` = surface reflectivity (0–1 diffuse; > 1 retro-reflectors),
`alpha` = incidence angle, `r` = range, `eta(r)` = near-range defocus
correction. A white wall at 50 m returns ~4× less raw intensity than at 25 m;
a surface tilted 60° returns half the power of a perpendicular one. Neither
effect is a material property — both must be removed.

### 6.2 Calibrated Reflectivity

To obtain material-intrinsic reflectivity:

```
rho_cal = I(r, alpha) * r^2 / [cos(alpha) * eta(r)]
```

Field evidence (arXiv 2403.13188 "Reflectivity Is All You Need"): replacing raw
intensity with `rho_cal` yields ~4% mIoU improvement on off-road segmentation
(12 of 13 classes improved) and ~3.8% F1 improvement on road-marking detection
across lighting conditions. Largest gains for material-based classes (ground
cover, painted markings).

For multi-pass MLS maps: (1) apply r²/cos(alpha) correction per point before
accumulation; (2) verify cross-pass consistency on stable targets; (3) average
corrected reflectivity across voxel occupants — averaging suppresses shot noise
and scan-to-scan variability; (4) report per-voxel standard deviation as a map
quality metric.

### 6.3 Per-Laser Calibration

Multi-beam sensors use N distinct laser/detector pairs with different output
power, responsivity, and optical-path efficiency. The Velodyne HDL-64E ships a
64-entry XML calibration file (rotational, vertical, distance, intensity
corrections per channel). Without it, identical targets appear at different
intensity values on different rings — a systematic artefact that corrupts
intensity-based segmentation. Per-layer adaptive thresholding (Otsu per ring)
is necessary precisely because of these inter-laser differences (arXiv 2211.01105).
Calibration drift over temperature requires periodic recalibration.

### 6.4 Retro-Reflectors and Intensity Saturation

Retro-reflective materials (road-sign sheeting, high-vis vest strips, airport
PAPI reflectors) have `rho >> 1`. Effects:
- **Saturation:** ADC clips; intensity is maximum-pegged and meaningless.
- **Blooming:** charge from saturated SPAD bleeds into adjacent channels →
  false nearby returns.
- **Ghost returns:** multi-bounce off adjacent specular surfaces → incorrect
  ranges.

This is the high-vis vest problem for airside AV: ground crew vest saturates
returns, obliterates body outline, generates ghosts. Ground crew detection must
be cross-modal (LiDAR geometry + camera); models need saturation augmentation.

---

## 7. Multi-Echo / Multi-Return

A single pulse produces multiple returns when the footprint straddles objects
at different ranges. The backend detects peaks in the returned waveform.

| Return mode | Description | Primary use |
|---|---|---|
| First return | Closest detectable target | Obstacle detection; foreground edge |
| Last return | Farthest detectable target | Ground beneath vegetation; wire background |
| Strongest return | Highest-amplitude peak | Best SNR; general detection |
| Dual / all returns | First and last recorded | Vegetation, wire, weather separation |

Velodyne VLP-32C: first-or-strongest vs. dual-return firmware modes. Typical
commercial spinning sensors support 2–5 returns per pulse.

**Airside use cases:** wire/cable detection (weak first return = cable, strong
last = background); weather filtering (near-field weak first returns from
rain/fog particles; strong last likely solid surface); vegetation penetration at
perimeter for Digital Terrain Model.

---

## 8. Noise Sources

### 8.1 Range Noise (Gaussian Model)

Timing jitter (comparator noise, APD dark counts, photon shot noise) translates
to range error. For a Lambertian target under good conditions:

```
r_meas = r_true + b_r(channel, temperature, range, intensity) + epsilon_r
epsilon_r ~ N(0, sigma_r^2)
```

Typical values: `sigma_r` ~= 1–3 cm at 30 m, rising to 5–10 cm at 100+ m.
Model per-channel range bias separately from random noise for high-accuracy
mapping. FMCW: `sigma_r ~= c / (2*B*sqrt(SNR))` — mm-class at moderate range
with wide-bandwidth chirps.

### 8.2 Angular Noise and Point Covariance

Angular uncertainty dominates lateral error at long range:

```
sigma_lateral ~= r * sigma_angle
```

Example: r = 80 m, sigma_angle = 0.05 deg = 0.000873 rad → sigma_lateral ~= 0.07 m.

Full anisotropic point covariance from spherical noise propagation:

```
Sigma_xyz = J_sph2cart * diag(sigma_r^2, sigma_theta^2, sigma_phi^2) * J_sph2cart^T
```

Inflate for: range > reliable_range; low intensity or saturation; high incidence
angle; weather; mixed pixels near depth discontinuities; dynamic object
probability.

### 8.3 Mixed Pixels (Depth Edge Artefact)

At depth discontinuities, a single footprint simultaneously illuminates
foreground and background. Electronics may return an interpolated "flying point"
at an incorrect range. Flying points cluster as halo artefacts at object edges.
Severity scales with beam divergence. In aggregated MLS maps, consistent scan
directions allow partial suppression. See also
[LiDAR Artifact Removal Techniques](../../30-autonomy-stack/perception/overview/lidar-artifact-removal-techniques.md).

### 8.4 Outlier Rate and False Returns

Sources of spurious points: atmospheric particles (dust, pollen); solar
cross-talk (especially 905 nm); multi-path from specular surfaces; electronic
noise floor. Typical outlier rates: 0.1–1% in clean conditions; exceeds 20%
at ranges below 20 m in fog or heavy dust.

### 8.5 Specular Surfaces

Wet asphalt, glass, and polished metal reflect the beam away from the sensor,
producing zero or very weak return. Consequences: ground plane drops points in
wet conditions; glass walls invisible; multi-bounce creates ghost points at
incorrect ranges; wet markings fall below intensity-threshold detectors.

### 8.6 Ambient Light (Sunlight Interference)

Sunlight in the detector time gate raises the noise floor. 905 nm sensors are
more susceptible (solar irradiance peaks near 900 nm). FMCW sensors are largely
immune due to coherent detection filtering incoherent photons.

---

## 9. Weather Effects

### 9.1 Mie Scattering and Attenuation

Two-way propagation through an attenuating medium:

```
P_return = P_surface * exp(-2 * beta * r) + P_backscatter
sigma_ext,fog ~= 3 / V     [V = visibility in metres; simplified]
```

For rain, the Marshall-Palmer distribution governs extinction:

```
N(D) = N0 * exp(-Lambda * D)
Lambda = 4.1 * rainfall_rate^{-0.21}
```

### 9.2 Fog

Both attenuation (signal reduction) and backscatter (spurious near-range
returns). At 50 m visibility: ~9.2 dB attenuation. FDR in dense fog exceeds
500% at short ranges. 1550 nm has lower extinction → longer effective range.

### 9.3 Rain

Rain at 98 mm/h → ~22.7% FDR at 20 m; distance errors up to 4.9 cm at 20 m.
Both 905 nm and 1550 nm comparably affected.

### 9.4 Snow and De-Icing Mist

Falling snow: dense small-particle backscatter; weak, short-range, spatially
clustered intensity signature. Wet snow worse for 1550 nm (water absorption).
De-snowing algorithms (DSOR, LiSnowNet, SLiDE) exploit geometric and intensity
signatures.

De-icing mist on airport aprons (propylene-glycol aerosol) acts as artificial
fog. 905 nm especially affected. Intensity thresholds calibrated in clear
conditions need adaptive recalibration under de-icing. Models trained on clear
data degrade in mist; weather-augmented training data required.

---

## 10. Motion Distortion and Deskew

### 10.1 The Mechanism

A spinning LiDAR at 10 Hz sweeps 100 ms. At 5 m/s, the sensor translates 50 cm
during the sweep — a substantial geometric error. Each azimuth sector is captured
at a different sensor pose (directly analogous to rolling shutter). For
perception: markings smear, walls bend. For scan matching: undeskewed clouds
appear bent, biasing ICP. For mapping: the same structure is doubled across
passes acquired at different speeds.

### 10.2 Deskewing Algorithm

```
p_map(t_i) = T_map_lidar(t_i) * p_lidar_i
```

1. Record per-point timestamp `t_i` (Ouster/Velodyne/Livox all provide this).
2. Integrate IMU angular velocity and acceleration to reconstruct pose `T(t_i)`.
3. Transform each point to the reference frame at sweep-start `T(t_0)`.

Critical dependencies: LiDAR–IMU time sync (1 ms → cm-class error at 5 m/s);
extrinsic calibration (lever arm < 1 cm, rotation < 0.1°); IMU bias in state.
See also [Rolling Shutter and LiDAR Deskew](rolling-shutter-lidar-deskew-motion-distortion.md).

---

## 11. Timestamping and Synchronization

### 11.1 Per-Point Timestamps

Ouster OS-series and Velodyne sensors embed per-point nanosecond-precision
timestamps in the UDP packet stream (Ouster: 10 ns resolution counter referenced
to active clock source). This `t` channel enables deskewing (§10), sensor
fusion, and multi-sensor phase locking.

### 11.2 Clock Sources

| Mode | Mechanism | Absolute accuracy | Use case |
|---|---|---|---|
| Internal oscillator | Free-running monotonic counter | N/A | Relative timing only |
| GPS / 1-PPS | Opto-isolated pulse phase-locks sensor clock | ~1 µs | Outdoor mapping |
| IEEE 1588 PTP | Sensor as PTP slave synced to network master | ~100 µs network; 10 ns counter | Vehicle LAN; multi-sensor sync |

Ouster supports phase locking between sensors on the same PTP master (prevents
inter-sensor beam interference). Key sync impacts: 1 ms deskew offset ~= 5 mm
at 5 m/s; 10 ms camera–LiDAR offset → 5 cm projected misalignment; unsync'd
multi-LiDAR creates ghost duplicates on moving objects; PTP timestamps enable
GNSS trajectory stitching across passes. See also
[Sensor Calibration and Time Synchronization](sensor-calibration-time-synchronization.md).

---

## 12. Calibration

### 12.1 Intrinsic (Per-Laser)

For spinning sensors, each laser/detector pair requires: rotational correction
(azimuth offset), vertical correction (elevation offset), distance correction
(constant range offset), and intensity correction (per-channel gain/offset). The
Velodyne HDL-64E ships these as a 64-entry XML file. Without applying
calibration, identical targets appear at different intensity values on different
rings — corrupting intensity-based segmentation. Periodic recalibration against
known planar targets is advised for intensity-critical applications.

Standard re-calibration: scan a planar wall at multiple ranges and orientations;
least-squares fit per-laser parameters to minimise planar residuals.

### 12.2 Extrinsic (LiDAR–IMU, LiDAR–Camera)

**LiDAR–IMU:** 6-DOF rigid transform. Protocol: excite all rotational and
translational DOF; joint optimisation of LiDAR odometry and IMU pre-integration
(e.g., LI-Init, FAST-LIO). Required accuracy: lever arm < 1 cm, rotation < 0.1°.
Requires rotational excitation (figure-8 or 3D spiral trajectory).

**LiDAR–camera:** overlap in FOV needed. Methods: checkerboard target (plane-fit
in LiDAR + PnP in camera); trihedron (corner cube); targetless via natural edges
(needs good initial estimate).

| Calibration type | Parameters | Failure symptom |
|---|---|---|
| Intrinsic beam | angles, azimuth offsets, range offsets, channel timing | wavy walls, ring seams, blurred poles |
| Extrinsic to IMU | `T_imu_lidar`, lever arm | deskew residuals grow during turns only |
| Extrinsic to camera | `T_camera_lidar` | colored point clouds misalign; depth-edge projection artifacts |
| Time offset | LiDAR clock to IMU / PTP / GNSS | residuals grow in motion; vanish when static |
| Intensity / radiometric | range and channel response correction | markings inconsistent across passes and temperatures |

Mapping pipelines should preserve: raw point time, ring, return type, intensity,
calibration artifact ID, weather diagnostics, pose covariance and scan-matching
residuals — needed to audit map errors at aircraft stand clearance zones.

---

## 13. Noise Models for Estimation

### 13.1 Point-Level Anisotropic Covariance

```
Sigma_point = R_ray * diag(sigma_r^2, sigma_t1^2, sigma_t2^2) * R_ray^T
sigma_tangent ~= r * sigma_angle
```

### 13.2 Scan Matching

| Scene | Constraint quality |
|---|---|
| Two perpendicular walls, poles, curbs | Strong 6-DoF |
| Long featureless wall | Weak along-wall translation |
| Flat apron or open runway | Weak yaw and horizontal translation |
| Mostly dynamic objects | High outlier risk |

Monitor Hessian eigenvalues; small eigenvalues flag unconstrained directions —
increase uncertainty in those directions rather than clamping to a minimum.

### 13.3 Practical Starting Values

```
clear weather point range sigma:    0.02 to 0.05 m
angular sigma:                      0.02 to 0.1 deg (datasheet)
rain / fog / de-icing spray:        inflate sigma and outlier prob 2x to 10x
grazing incidence (alpha > 60 deg): inflate by 1 / max(cos(alpha), 0.2)
retro-reflector zone:               discard intensity; flag range as possibly biased
```

Validate with residual histograms and NIS-like consistency checks against
surveyed structures and repeated mapping passes.

---

## 14. Implications for Aggregated-Map Segmentation

### 14.1 Multi-Pass Intensity Calibration

In a multi-pass MLS map, the same ground patch is scanned from different ranges,
incidence angles, and conditions (atmospheric, thermal). Production approach:
(1) apply r²/cos(alpha) correction per point before accumulation; (2) verify
cross-pass consistency on stable targets (concrete, asphalt); (3) average
corrected reflectivity across voxel occupants; (4) report per-voxel standard
deviation as quality flag. Result: voxel-averaged calibrated reflectivity
approaches true material reflectance and enables stable class boundaries.

### 14.2 Density Signatures

- Ring gaps widen with range; thin horizontal features fall between rings.
- 64-channel sensors provide 2–4× denser elevation coverage than 16-channel,
  improving thin-class recall.
- Overlap regions (multi-pass, reversed headings) create dense local
  distributions — subsample before training or they dominate gradients.
- Evaluate mIoU stratified by local density (Low/Medium/High points/m²).

### 14.3 Sensor Choice → Segmentation Behaviour

| Factor | Effect on segmentation |
|---|---|
| High channel count (64+) | Better thin-structure recall (wires, curbs, signs); finer vegetation/ground separation |
| 1550 nm | Stable calibrated reflectivity in fog/mist → reliable class boundaries in adverse weather |
| 905 nm | Solar background spikes in low-angle sunlight → elevated false-return rate at horizon |
| FMCW | Per-point velocity enables dynamic/static separation without temporal differencing |
| Motion-deskewed input | Eliminates 50 cm marking smear at 5 m/s |
| Retro-reflector saturation | Class-boundary failure near high-vis vests and sign retro-reflectors |
| Wide beam divergence | Higher flying-point rate at depth edges |
| Uncalibrated per-laser intensity | Systematic inter-ring offset; requires per-ring normalization |

### 14.4 Airside-Specific Considerations

- **Painted markings** (taxiway centrelines, holding positions): rely entirely
  on calibrated reflectivity — geometry is near-flat. Otsu thresholding per ring
  is the production approach; requires per-laser calibration and r²/cos(alpha)
  correction beforehand (arXiv 2211.01105).
- **De-icing mist:** propylene-glycol aerosol acts as artificial fog; intensity
  thresholds need adaptive recalibration. Consider 1550 nm; include
  weather-augmented training data.
- **High-vis vests:** retro-reflective strips → saturation + ghost returns.
  Ground crew detection must be cross-modal; models need saturation augmentation.
- **Grazing incidence markings:** sensor mounted low → apron markings nearly
  coplanar with beam at short range. Without incidence-angle correction, marking
  intensity varies with heading and vehicle speed.
- The conditioning pipeline in
  [Aggregated-Map Semantic Segmentation §9](../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md)
  addresses these sensor-physics artifacts at the data level.

---

## 15. Implementation Notes

- Clip r²/cos(alpha) calibrated reflectivity at ~10× the 99th-percentile for
  Lambertian targets to prevent retro-reflector amplification to extreme values.
- Preserve raw intensity, ring, time, and return type in the map store;
  calibrated reflectivity is derived — re-derivable with updated calibration.
- Compute per-ring Otsu histograms across the full pass, not per scan;
  single-scan histograms may lack sufficient marking/non-marking balance.
- Apply LiDAR–IMU extrinsic before integrating IMU increments; the lever arm
  amplifies angular velocity error if not applied at the IMU output stage.
- Verify PTP phase locking is active in multi-LiDAR setups; unsync'd overlapping
  beams produce cross-talk returns in the merged cloud.
- Below ~2 m range, the near-range defocus term eta(r) dominates; validate the
  near-range reflectivity model before using it for marking detection.
- Apply voxel-grid subsampling before training on aggregated maps — dense
  near-field regions otherwise dominate gradients disproportionately.
- Treat intensity-saturated points as a distinct bin; include saturated-return
  examples in every training batch for high-vis-vest and sign classes.

---

## 16. Failure Modes

| Symptom | Cause | Diagnostic |
|---|---|---|
| Ray drop interpreted as free space | Dark material, rain, fog, glass, specular angle | Track hit/no-hit probability; separate unknown from observed free space |
| Doubled map structure | Time offset, motion distortion, bad extrinsic, moving objects | Deskew; calibrate; dynamic filtering; per-pass map QA |
| ICP converges to wrong pose | Repetitive geometry, open apron, poor initialization | IMU/GNSS prior; robust kernels; Hessian eigenvalue degeneracy detection |
| Overconfident scan factor | Fixed covariance in weak geometry | Derive covariance from registration Hessian and scene quality |
| Ghost or mixed returns | Glass, wet ground, aircraft panels, retro-reflectors | Multi-return logic; intensity/range gating; temporal confirmation |
| Weather false obstacles | Rain, snow, de-icing spray | Near-field weather classifier; dual-return gating; radar cross-check |
| Channel seam artifacts | Intrinsic beam error or thermal drift | Per-channel calibration; residual monitoring over temperature range |
| Intensity inconsistent across passes | Missing r²/cos(alpha) correction; thermal drift | Calibrated reflectivity pipeline; cross-pass consistency check |
| Paint marking detector fails at distance | Points falling between rings; grazing low return | Evaluate per-ring, per-range-bin; check channel count vs. feature size |
| High-vis vest causes false geometry | Retro-reflector saturation + blooming | Flag saturated points; cross-check with camera; add saturation augmentation |
| Deskew worsens accuracy | LiDAR–IMU time offset or extrinsic error; IMU bias | Check residuals during rotation vs. translation; validate at known structure |
| Marking intensity varies with heading | Incidence angle not corrected | Verify r²/cos(alpha); validate same marking from multiple headings |

---

## 17. Key Formulas

| Formula | Meaning |
|---|---|
| `r = c * delta_t / 2` | Pulsed ToF range |
| `r = f_beat * c / (2 * kappa)` | FMCW range from beat frequency |
| `delta_r = c / (2 * B)` | FMCW range resolution |
| `sigma_r ~= c / (2 * B * sqrt(SNR))` | FMCW range precision |
| `d_footprint ~= r * gamma` | Beam footprint diameter at range r |
| `I(r, alpha, rho) ~= eta(r) * rho * cos(alpha) / r^2` | Intensity model |
| `rho_cal = I * r^2 / [cos(alpha) * eta(r)]` | Calibrated reflectivity |
| `sigma_ext,fog ~= 3 / V` | Fog extinction from visibility V (m) |
| `sigma_lateral ~= r * sigma_angle` | Lateral position error from angular noise |

---

## 18. Sources

- Glennie and Lichti, "Static Calibration and Analysis of the Velodyne HDL-64E S2." Remote Sensing, 2010. https://www.mdpi.com/2072-4292/2/6/1610
- Atanacio-Jimenez et al., "LIDAR Velodyne HDL-64E Calibration Using Pattern Planes." 2011. https://journals.sagepub.com/doi/10.5772/50900
- Glennie et al., "Temporal Stability of the Velodyne HDL-64E S2." Remote Sensing, 2011. https://www.mdpi.com/2072-4292/3/3/539
- Royo and Ballesta-Garcia, "An Overview of Lidar Imaging Systems for Autonomous Vehicles." Applied Sciences, 2019. https://www.mdpi.com/2076-3417/9/19/4093
- Kim et al., "Enhanced High-Resolution and Long-Range FMCW LiDAR." PMC 2025. https://pmc.ncbi.nlm.nih.gov/articles/PMC12251745/
- Kaasalainen et al., "Radiometric Calibration of Airborne LiDAR Intensity Data." ISPRS. https://www.isprs.org/proceedings/XXXVIII/part1/03/03_01_Paper_153.pdf
- Roriz et al., "Empirical Analysis of AV LiDAR Degradation in Rain and Fog." Sensors, 2023. https://pmc.ncbi.nlm.nih.gov/articles/PMC10051412/
- "Reflectivity Is All You Need." arXiv 2403.13188. https://arxiv.org/html/2403.13188v1
- "Road Markings Segmentation using Reflectivity." arXiv 2211.01105. https://arxiv.org/html/2211.01105v2
- MDPI — Generalised LiDAR Intensity Normalization. https://www.mdpi.com/2072-4292/14/17/4393
- PMC — Methodology for Rain and Fog LiDAR Modeling. https://pmc.ncbi.nlm.nih.gov/articles/PMC10422612/
- arXiv 2109.07078 — DSOR Snow Removal. https://arxiv.org/pdf/2109.07078
- arXiv 2003.06660 — ToF LiDAR in Fog. https://arxiv.org/pdf/2003.06660
- arXiv 2407.19154 — RePLAy projective depth artefacts. https://arxiv.org/pdf/2407.19154
- arXiv 2209.03336 — Multibounce LiDAR returns. https://arxiv.org/pdf/2209.03336
- University of Michigan — Reflectance Field Map for Glass. https://web.eecs.umich.edu/~kuipers/papers/Foster-icra-23.pdf
- Inertial Labs — 905nm vs 1550nm. https://inertiallabs.com/why-have-905-and-1550-nm-become-the-standard-for-lidars/
- Blickfeld — ToF vs FMCW. https://www.blickfeld.com/blog/time-of-flight-vs-fmcw/
- 4sense Medium — FMCW vs ToF LiDAR. https://4sense.medium.com/fmcw-lidar-vs-tof-lidar-da1fefcf4be8
- Bridger Photonics — FMCW LiDAR. https://www.bridgerphotonics.com/blog/frequency-modulated-continuous-wave-fmcw-lidar
- Voyant Photonics — LiDAR Blooming. https://voyantphotonics.com/news/437/
- arXiv 2108.06078 — Piecewise Linear LiDAR Deskewing. https://arxiv.org/pdf/2108.06078
- Ouster Sensor Docs — Time Synchronisation. https://static.ouster.dev/sensor-docs/image_route1/image_route2/time_sync/time-sync.html
- IEEE Xplore — 3D Modelling Airport Environment for LiDAR Segmentation. https://ieeexplore.ieee.org/document/9256495/
- Think Autonomous — Solid-State LiDAR. https://www.thinkautonomous.ai/blog/solid-state-lidar/
- Hesai — Solid-State vs Hybrid. https://www.hesaitech.com/things-you-need-to-know-about-lidar-solid-state-and-hybrid-solid-state-whats-the-difference/
