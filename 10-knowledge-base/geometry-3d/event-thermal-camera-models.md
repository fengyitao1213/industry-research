# Event and Thermal Camera Models

<!-- kb-visual:start -->
![Event and Thermal Camera Models curated visual](../_assets/visuals/geometry-3d-event-thermal-camera-models.svg)

*Visual: dual-sensor timing diagram contrasting asynchronous event threshold crossings with slower thermal frames, NUC/calibration, sync, and fusion.*
<!-- kb-visual:end -->

Event cameras and thermal cameras are both useful when ordinary RGB cameras are
weak, but their measurements are fundamentally different. Event cameras report
asynchronous brightness changes at microsecond resolution across ~140 dB dynamic
range. Thermal cameras report passive LWIR radiance — illumination-independent.
Both require explicit sensor models before use in perception, SLAM, or mapping.

---

## Related Docs

- [LiDAR Working Principles and Noise Models](lidar-working-principles-noise-models.md) — geometry and noise sibling; LiDAR is the primary 3D source in LiDAR-thermal fusion
- [Camera Imaging, Noise, and Calibration](camera-imaging-noise-calibration.md) — RGB camera sibling; thermal shares the same pinhole projection math
- [Camera Projective Geometry, PnP, and Triangulation](camera-projective-geometry-pnp-triangulation.md) — the projection math used for both thermal-LiDAR and event-LiDAR fusion
- [Sensor Calibration and Time Synchronization](sensor-calibration-time-synchronization.md) — extrinsic and timing procedures apply directly
- [Aggregated-Map Semantic Segmentation](../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md) — extending 2DPASS / OpenScene pipelines with thermal per-point features
- [Night Operations and Thermal Fusion](../../30-autonomy-stack/perception/overview/night-operations-thermal-fusion.md) — airside companion covering operational deployment

---

## Why It Matters

| Choice / Effect | Impact | Risk if ignored |
|---|---|---|
| Event camera ~140 dB dynamic range | Maintains signal across hangar-to-apron transitions | Frame camera saturates or underexposes; obstacle missed |
| Thermal LWIR passive emission | Illumination-independent pedestrian detection at >90 m | Night AEB failure rates approach 100% with visible-only cameras |
| Threshold mismatch noise (event) | Per-pixel sensitivity variation causes hot pixels and biased event rates | Stream polluted by persistent false events; SLAM residuals biased |
| NETD ~42–50 mK (microbolometer) | Resolves 0.5°C temperature differences; detects body heat against asphalt | High-NETD sensor misses cold-ambient ground crew in dark zones |
| NUC shutter interruption | 1–3 frame gap every few minutes in thermal output | Moving ground crew missed during NUC blackout without fusion fallback |
| Emissivity of polished metal ~0.05 | Aircraft fuselage nearly transparent in LWIR; may appear same as cold sky | False clearance for aircraft skin; missed structure detection |
| Refractory period (event) | Fast high-contrast motion can drop events at pixel | Events missed for fast-moving aircraft ground equipment |
| Thermal-LiDAR projection (shared math) | Pinhole model for LWIR is identical to RGB; same `P = K[R|t]` | Treating thermal as a separate geometry model duplicates calibration complexity |

---

## Part A — Event Cameras

### 1. What an Event Camera Is

An event camera — also called a Dynamic Vision Sensor (DVS) — is an asynchronous
per-pixel sensor that detects logarithmic changes in scene luminance rather than
integrating absolute light intensity over an exposure window. Each pixel fires
independently the moment its local log-luminance change exceeds a threshold.
The output is a stream of discrete events, each carrying four fields:

```
e_k = (x_k, y_k, t_k, p_k)
```

where `(x, y)` is the pixel address, `t` is a microsecond-resolution timestamp,
and `p ∈ {+1, −1}` is polarity (brightness increase or decrease).

The measurement model: let `L(u, t) = log(I(u, t))` be log-luminance at pixel
`u` at time `t`. The pixel fires when the cumulative change since the last event
crosses a signed threshold:

```
L(u_k, t_k) - L(u_k, t_last) >=  +C_pos  ->  polarity = +1  (ON event)
L(u_k, t_k) - L(u_k, t_last) <= -C_neg  ->  polarity = -1  (OFF event)
```

After an event the pixel reference resets. Output is sparse in static scenes
and dense at moving edges or flickering lights.

Key contrast with frame cameras:

| Property | Frame camera | Event camera |
|---|---|---|
| Temporal resolution | 1/frame-rate (≈ 33 ms @ 30 fps) | ~1 µs per event |
| Dynamic range | ~70 dB | ~120–140 dB |
| Data rate at rest | Fixed (every frame) | Near-zero (only changes) |
| Motion blur | Yes (exposure integration) | None (instantaneous per pixel) |
| Readout | Synchronous global / rolling | Fully asynchronous |
| Power | 0.5–5 W typical | 5–270 mW |

The ~140 dB dynamic range is intrinsic to the log-luminance circuit: sensitivity
to relative luminance change (Weber fraction) rather than absolute intensity.

---

### 2. Sensor Architectures

| Sensor | Resolution | Dynamic range | Latency | Key property |
|---|---|---|---|---|
| DVS128 (2008, ETH/INI) | 128 × 128 | ~120 dB | ~15 µs | First practical DVS; reference architecture |
| DAVIS240C (2014, ETH/INI) | 240 × 180 | ~130 dB | ~3 µs | Dual DVS + APS greyscale from same pixels; native co-registration |
| Prophesee Gen3 / EVK3 GENX320 | 320 × 320 | — | — | Used in DSEC dataset (Gen 3.1 sensors, 60 cm baseline) |
| iniVation DVXplorer | 640 × 480 | 110 dB | — | 165 MEPS; mid-range between DAVIS346 and IMX636 |
| Sony IMX636 / Prophesee EVK4 HD | 1280 × 720 | >120 dB (low light) | <100 µs @ 1000 lux; <1000 µs @ 5 lux | Current production-grade sensor (2024); 1 GEPS peak; 50–70 mW |

The DAVIS architecture natively co-registers events and frames with no extrinsic
calibration. The Sony IMX636 (4.86 × 4.86 µm pitch; stacked CMOS; on-chip ESP)
is the highest-resolution production sensor as of mid-2026.

---

### 3. Event Generation Model and Noise

**Threshold mismatch noise**: Per-pixel threshold follows a Gaussian distribution
`theta_pixel ~ N(mu_theta, sigma_theta)`. This causes hot pixels (near-zero
threshold fires continuously) and spatially non-uniform sensitivity; simulators
reject θ < 0 to prevent non-physical behavior.

**Refractory period**: After firing, a pixel cannot fire again for `t_ref`
(typically 0.5–2 ms, hardware bias parameter), limiting per-pixel event rate.
At very high contrast / speed, events are dropped.

**Timestamp latency model**:

```
t_ev = t_change + l_fixed + tau_l * ln(theta / delta_L)
```

where `l_fixed` is amplifier/comparator propagation delay and `tau_l` is the
log-conversion time constant inversely proportional to photocurrent. High
illumination: ~1 µs latency; dim illumination: up to ~1 ms (consistent with
IMX636 spec).

**Noise source taxonomy**:

| Noise | Cause | Effect |
|---|---|---|
| Background activity (hot pixels) | Threshold near zero; pixel leakage | Persistent false events in static scenes |
| Threshold mismatch | Per-pixel C_pos, C_neg variation | Biased event timing and polarity rate |
| Refractory saturation | Pixel cannot fire immediately again | Missed events at very high contrast speed |
| Timestamp jitter | Sensor/transport/clock uncertainty | Motion-compensation and SLAM residual error |
| Flicker | Artificial lights (50/100/120 Hz) | Dense non-geometric event bursts at fixtures |
| Arbiter contention | Many simultaneous pixels; readout bottleneck | Temporal aliasing at high event density |

Common preprocessing: refractory filtering per pixel; nearest-neighbor
spatio-temporal filtering; hot-pixel masks; event-rate limiting; flicker
frequency rejection (band-stop at power-line frequency); time-surface
construction. Filtering should be logged because it changes the measurement
distribution and can remove real small/fast objects.

---

### 4. Event Representations for Downstream Processing

Raw events are a sparse, asynchronous point process in `(x, y, t, p)` space.
Standard deep-learning pipelines require dense, regular tensors; several
representations bridge this gap:

**Event histograms / event count maps**
Bin events over time window `[t₀, t₁]` into a 2D image (pixel value = ON minus
OFF count). Simplest; destroys sub-window temporal ordering; prone to motion blur
at long windows.

**Time surfaces**
For each pixel, store the timestamp of the most recent event with exponential
decay:

```
S(x, y) = exp(-(t_now - T(x, y)) / tau)
```

Compact; captures local motion direction and speed. Used in place recognition and
VIO. Loses polarity unless stored separately.

**Voxel grids**
Divide `(x, y, t)` into a 3D voxel volume with `B` temporal bins. Each event is
tri-linearly interpolated into the voxel. Preserves temporal ordering within the
window at cost of memory `H × W × B × 2` (per polarity). Standard representation
for CNN/transformer pipelines; stored as Minkowski Engine sparse tensors.

**Event Spike Tensor (EST)**
Discretises the event stream into a sparse spike tensor preserving full timestamp
precision. Two variants: Multi-Channel Spike Tensor (MCS-Tensor) and
Time-Surface Spike Tensor (TSS-Tensor). Natural for Spiking Neural Networks.

**Event-to-frame reconstruction (E2VID family)**
A recurrent network synthesizes greyscale intensity frames from the event stream.
E2VID (2019) was the first; FireNet (2020), HyperE2VID (2023) improved quality.
Key advantage: reconstructed frames feed any RGB-based pipeline without
architectural change. Limitation: reconstruction introduces latency and artefacts,
losing the microsecond-resolution timing advantage.

---

### 5. Event Camera Calibration

Event cameras still need geometric calibration:

```
K, distortion, T_base_event, time_offset
```

Additional event-specific calibration:

- Positive and negative contrast thresholds `C_pos`, `C_neg`
- Per-pixel threshold bias map
- Timestamp offset relative to IMU / LiDAR / frame camera
- Event-camera to frame-camera alignment for hybrid DAVIS-style sensors

Calibration datasets must include moving edges and controlled illumination.
Static checkerboard images calibrate the APS frame but not event threshold
behavior. For LiDAR-to-event extrinsic calibration see §10.

---

### 6. AV and Mapping Applications

**High-speed motion without blur**: Events fire in ~1 µs; a vehicle at 30 m/s
moves ≈ 30 µm between events at the pixel — sub-mm motion resolution that frame
cameras at 100 fps cannot match.

**HDR driving scenes**: Airside aprons transition from full sunlight at hangar
thresholds (>100,000 lux) to near-dark taxiways (<1 lux). Event cameras maintain
signal across this range; frame cameras saturate or underexpose.

**Event-based Visual Inertial Odometry (EVIO)**: PL-EVIO (2023) is a monocular
event + IMU odometry system with point and line features; ESVIO is stereo event
+ IMU using time-surface images; MA-EVIO (2025) adds motion-aware adaptive
frame fusion. EVIO is the most mature near-production application and is
relevant for LiDAR SLAM initialisation in GPS-denied airside environments.

**Event-based depth (DSEC, MVSEC)**: MVSEC provides a 240 × 180 stereo
baseline at 10 cm (foundational but low resolution). DSEC (Gehrig et al. 2021)
uses Prophesee Gen3.1 cameras at 60 cm baseline hardware-synced with a VLP-16
LiDAR and RTK GPS, supporting disparity, optical flow, and semantic segmentation
benchmarks.

**Airside specifics**: Useful for beacon/light motion, high-contrast moving
ground crew, and low-latency obstacle cues. Vulnerable to LED signage, warning
beacons, and apron floodlight flicker. Best treated as a complementary motion
sensor, not a standalone map sensor.

---

### 7. Event-Based Semantic Segmentation

**Maturity warning**: Event-based semantic segmentation is materially less mature
than RGB or LiDAR segmentation. No production system uses it as a primary
segmentation modality as of mid-2026.

**EV-SegNet (CVPRW 2019)** was the first event-only segmentation baseline
(event-count image → standard CNN on DDD17); accuracy is well below contemporary
RGB methods. The **E2VID reconstruction trick** — synthesising greyscale frames
from events then applying any RGB model — preserves HDR advantage while reusing
mature architectures, at the cost of reconstruction artefacts and latency.
**Hybrid event + frame segmentation (2025 SOTA)** uses a dual SNN + ANN branch
achieving 65% energy reduction on DSEC-Semantic.

For LiDAR-primary segmentation: no event-LiDAR joint segmentation dataset exists
as of 2026 (DSEC includes LiDAR but benchmarks cover depth, not semantic labels).
Events are best treated as a temporal attention cue or motion-mask for dynamic
object separation, not a substitute geometry source.

---

### 8. Event Camera: Pros, Cons, Failure Modes

**Pros**: microsecond temporal resolution; no motion blur; ~120–140 dB dynamic
range; near-zero latency; low power (50–270 mW); no external trigger required.

**Cons**: 1280 × 720 resolution (IMX636) modest vs. 8 MP frame cameras; no
texture or colour; blank output for static scenes; segmentation is research-stage;
calibration requires active targets; pipelines less standardised than RGB.

**Failure modes**:

| Failure mode | Cause | Mitigation |
|---|---|---|
| Static obstacle disappears | No relative brightness change | Fuse with frame / LiDAR / radar; maintain independent tracks |
| Event flood | Flicker, vibration, rain streaks, flashing lights | Filters, flicker modelling, event-rate health monitor |
| Biased event SLAM | Wrong contrast threshold or time offset | Threshold / time calibration and IMU cross-check |
| Hot pixel stream | Near-zero threshold pixel | Bias tuning, spatial hot-pixel mask |
| Refractory saturation | Fast motion + very high contrast | Reduce sensitivity bias; fuse with frame camera for this scenario |
| Temperature drift | Threshold bias currents shift with chip temperature | Warm-up period; bias re-tuning after thermal stabilisation |

---

## Part B — Thermal / IR Cameras

### 9. Thermal Imaging Fundamentals

All objects above absolute zero emit electromagnetic radiation. Spectral
distribution follows Planck's law:

```
B(lambda, T) = (2hc^2 / lambda^5) * 1 / (exp(hc / lambda*k*T) - 1)
               [W sr^-1 m^-3]
```

where `h = 6.626e-34 J·s`, `c = 3e8 m/s`, `k = 1.381e-23 J/K`, `lambda` is
wavelength, and `T` is absolute temperature in kelvin.

**Wien's displacement law** gives the peak emission wavelength:

```
lambda_max = b / T     where b = 2.898e-3 m·K
```

At T = 310 K (human body): `lambda_max ≈ 9.35 µm` — squarely in the LWIR band.
At T = 6000 K (sun): `lambda_max ≈ 0.48 µm` — visible blue-green.

**Stefan-Boltzmann law** gives total emitted power per unit area:

```
M = epsilon * sigma * T^4     where sigma = 5.670e-8 W m^-2 K^-4
```

`epsilon` is emissivity (0–1; = 1 for ideal blackbody). Human skin ε ≈ 0.98;
asphalt ε ≈ 0.95; polished metal ε ≈ 0.05–0.1. Low emissivity of metals is a
key failure mode (§12).

Darkness has no effect on signal: thermal cameras detect emitted radiation from
the scene itself. **Infrared band classification**:

| Band | Wavelength | Detection principle | Primary detectors | Cooling required |
|---|---|---|---|---|
| SWIR | 1.0–2.5 µm | Reflected illumination (solar, ambient) | InGaAs | No |
| MWIR | 3–5 µm | Thermal emission + reflected; peak for T > 600°C | InSb, MCT (HgCdTe) | Stirling cryocooler |
| LWIR | 8–14 µm | Thermal emission dominant; peak for ambient-T objects | VOx microbolometer, a-Si, MCT | No (microbolometer); cooled MCT optional |

**LWIR is the AV industry choice**: peak emission from human body and road
objects falls in the 8–14 µm window; uncooled microbolometers eliminate
cryogenic cost; atmospheric transmission in LWIR is high. MWIR suits hot targets
(engines, exhausts) but requires a Stirling cryocooler.

---

### 10. LWIR / Microbolometer Specifics

**Microbolometer operating principle**: Incident LWIR radiation raises the pixel
element's temperature, altering its electrical resistance (VOx or a-Si material).
No photon-to-electron conversion occurs — this is a thermal, not photonic, detector.

**Key parameters**:
- **NETD** (Noise Equivalent Temperature Difference): minimum detectable scene
  temperature difference at SNR = 1. FLIR Boson 640 measured NETD ≈ 42–50 mK.
  This is sufficient to distinguish pedestrians (body ~37°C) from ambient
  pavement (~15–25°C on a clear night).
- **Thermal time constant**: ~5–10 ms (much slower than CMOS). Limits frame rate
  utility; fast-moving objects have slightly smeared thermal outlines.
- **Effective dynamic range**: ~60–70 dB — not HDR-class like an event camera.

**Automotive / airside LWIR sensors (2024 reference)**:

| Sensor | Resolution | NETD | Frame rate | Interface | Spectral band |
|---|---|---|---|---|---|
| FLIR Boson 640 | 640 × 512 | <50 mK (meas. 42 mK) | 30 / 60 Hz | USB, GMSL, Ethernet, FPD-link | 7.5–13.5 µm |
| FLIR Boson+ | 1280 × 1024 | <50 mK | 30 Hz | Same | 7.5–13.5 µm |
| FLIR ADK (Boson core) | 640 × 512 | <50 mK | 30 / 60 Hz | IP67, automotive rated | 8–14 µm |
| FLIR Lepton 3.5 | 160 × 120 | <50 mK | 8.7 Hz | SPI / I²C | 8–14 µm |
| Teledyne FLIR Vue Pro R 336 | 336 × 256 | — | 30 Hz | — | 7.5–13.5 µm |

Boson physical footprint: 35 × 40 × 47 mm, ~100 g, IP67, −40°C to +85°C —
suitable for automotive / airside vehicle integration. The 1280 × 1024 format
(FLIR Boson+) is becoming the standard for new deployments where spatial
resolution matters for distant-object detection.

---

### 11. Thermal Calibration and NUC

A simplified radiometric model:

```
L_sensor =
  tau_atm * [ epsilon * L_bb(T_object)
            + (1 - epsilon) * L_reflected ]
  + (1 - tau_atm) * L_atmosphere
  + sensor_offset + noise
```

Temperature is inferred by inverting the calibrated radiance model. If emissivity
or reflected temperature is wrong, reported temperature can be wrong even if
image contrast looks plausible.

**Non-Uniformity Correction (NUC)**: All microbolometer arrays have pixel-to-pixel
sensitivity variations (gain/offset mismatch). Without correction, images show
strong fixed-pattern noise (FPN). NUC applies per-pixel corrections:

```
DN_corrected(u) = gain(u, camera_temp) * DN_raw(u) + offset(u, camera_temp)
```

Cameras may store multiple NUC tables and switch based on internal temperature.

**Shutter-based FFC**: A mechanical shutter is briefly inserted at known
temperature; the deviation from the expected uniform reading updates gain/offset
(audible "click"; momentary freeze). Automotive cameras perform NUC every few
minutes on command. Between NUC events, detector temperature drift causes slowly
growing non-uniformity (NUC drift); frequent NUC or temperature-stabilised
housing mitigates this.

**Radiometric vs. non-radiometric**: FLIR Vue Pro R 336 (used in PMC9653951)
outputs calibrated radiance or scene temperature in °C. Most automotive cameras
(Boson, ADK) output digital levels (DL) — sufficient for detection and
segmentation; radiometric output is needed for hot-spot quantification. For
geometric fusion also calibrate intrinsic `K`, distortion, extrinsic
`T_lidar_thermal` (6-DoF), and timestamp offset to the LiDAR clock.

---

### 12. Night Operations and AEB Failure Rate

**The AEB night-failure finding**: Multiple independent studies document that
conventional visible-camera AEB systems fail severely at night.

- **AAA 2019 study** (cited by FLIR/Teledyne AEB white paper): at 25 mph,
  vehicles hit a pedestrian target 100% of the time in nighttime conditions —
  none of the four production systems detected or reacted.
- **IIHS nighttime testing**: Only 4 of the first 23 cars tested achieved the
  highest "superior" rating; over half scored "low" for nighttime pedestrian
  detection.
- **Pedestrian fatality statistics**: 77.7% of US pedestrian fatalities occurred
  at night in 2022 (Teledyne FLIR AEB white paper).

**Important accuracy note**: The "84–88% night AEB miss rate" figure cited in some
KB summaries synthesises AAA and IIHS findings across different test protocols and
vehicle populations, not a single controlled experiment yielding an exact
percentage. The data are consistent in direction — visible-camera AEB approaches
near-complete failure at night — but the precise number varies by methodology.
Users should cite the underlying study protocols rather than the synthesised
percentage.

**Thermal camera night detection ranges**:
- Visible cameras lose pedestrian detection efficacy beyond ~20 m (beyond
  headlight reach in typical conditions).
- LWIR thermal cameras detect pedestrian body heat at up to **90 m** in the same
  conditions — approximately 4× the effective range of typical headlights.
- A VSI Labs proof-of-concept fused LWIR + radar AEB algorithm achieved **100%
  success rate** across 35 test runs in both daylight and darkness.

**Airside relevance**: Airport aprons at night combine variable artificial
lighting, large dark zones, personnel in dark coveralls, and vehicles creating
local overexposure — exactly the conditions where visible-camera AEB fails.
Ground crew body heat is detectable at >90 m in LWIR against cold asphalt.
Runway incursion detection (vehicle or pedestrian on an active runway) is a
primary thermal application.

---

### 13. Thermal in Fusion with LiDAR

**Projective geometry — identical to RGB-LiDAR**:
The projection model for LWIR is identical to a standard pinhole RGB camera.
A calibrated 3×4 projection matrix `P = K [R | t]` maps a 3D LiDAR point `X_w`
to pixel coordinates:

```
lambda [u, v, 1]^T = P * X_w      where P = K [R|t]
```

The intrinsic matrix `K` contains focal length and principal point in pixel
units; `[R|t]` is the extrinsic transform from LiDAR frame to thermal camera
frame. The same math used for RGB-LiDAR projection (e.g., in 2DPASS, UniSeg)
applies to LWIR-LiDAR without modification, provided the thermal camera is
calibrated. See [Camera Projective Geometry](camera-projective-geometry-pnp-triangulation.md)
for the full derivation.

**LiDAR-thermal datasets**:

| Dataset | Modalities | Scene type | Annotations |
|---|---|---|---|
| KAIST Multispectral Pedestrian | RGB + Thermal (640×480, 20 Hz) | Urban driving, day+night | 103k bboxes, 1182 pedestrians |
| MFNet | RGB + Thermal (480×640) | Urban driving, day+night | 8-class semantic segmentation (1569 pairs: 820 day, 749 night) |
| 3D Radiometric LiDAR-Thermal (PMC9653951) | LWIR (336×256) + Livox Horizon LiDAR | Indoor/outdoor mapping | Temperature voxel map (9 cm accuracy) |

**FreeDom dataset correction**: "FreeDom" as a named thermal-LiDAR dataset was
not confirmed in research as of 2026. The name "FreeDOM" refers to a dynamic
object removal framework (arxiv 2504.11073), not a sensor dataset. The KB
corrects this citation; do not use "FreeDom" to mean a thermal-LiDAR benchmark.

**Cross-modal segmentation**: MFNet (Ha et al. 2017) introduced the paired RGB-T
benchmark and showed that fusing thermal improves nighttime segmentation accuracy
significantly. Subsequent architectures (EGFNet, RTFNet, DooDLeNet) apply
attention-based or boundary-guided thermal-RGB fusion.

**Per-point thermal feature projection for 3D segmentation**: The standard approach
for LiDAR-primary segmentation pipelines — project LiDAR points into the thermal
image frame using calibrated `P`, fetch the thermal pixel value at the projected
location, and append it as an additional per-point feature. This extends 2DPASS /
LIF-Seg / OpenScene pipelines trivially: swap or add the thermal channel alongside
RGB channels. The thermal feature provides temperature contrast information that
survives total darkness, smoke, and moderate fog.

---

### 14. Thermal Artifacts and Failure Modes

**Pros**: fully passive; illumination-independent; pedestrian body heat detectable
at >90 m; penetrates moderate fog and smoke; NETD ≈ 40–50 mK; uncooled; IP67
achievable; identical pinhole projection math to RGB for LiDAR fusion.

**Cons**: lower resolution (640×512 standard; 1280×1024 expensive); no colour or
texture; 30–60 Hz frame rate; NUC shutter interrupts 1–3 frames every few
minutes; $500–$3000 automotive cost vs. $50–$200 for RGB; emissivity confusion
on low-ε surfaces.

**Failure modes**:

| Failure mode | Cause | Mitigation |
|---|---|---|
| Total saturation (solar loading) | Direct sun into optic at dawn/dusk | Sun-blocking baffles; spatial masking; fuse with LiDAR during saturation |
| Metal object invisibility | Aircraft fuselage ε < 0.1; appears same as cold sky | Cross-check with LiDAR geometry; emissivity-aware processing |
| Narcissus / self-reflection | Camera body and optics emit LWIR back onto detector | Factory NUC calibration; re-calibrate if dome/window added |
| Hot-source thermal blooming | Jet engine nacelles, APU exhausts near saturation; pixel cross-talk | Spatial masking of hot regions; saturation-aware classifiers |
| NUC shutter gap | 1–3 frame blackout during FFC (~33–100 ms at 30 fps) | Multi-modal fusion covers gap; log NUC events; maintain tracker confidence |
| Emissivity confusion | Low-ε surfaces reflect thermal from nearby heat source | Multi-view consistency; emissivity-aware fusion; avoid relying on thermal alone |
| False negative on hot pavement | Asphalt heated to >40°C in summer; body contrast disappears | Dynamic contrast enhancement; fuse with LiDAR for geometry |
| NUC drift | Detector temperature drifts between NUC events | Frequent NUC scheduling; temperature-stabilised housing for precision applications |
| False hot / cold objects | Wet surfaces, aircraft skin act as thermal mirrors | Multi-view verification; cross-modal (LiDAR geometry) consistency check |
| Rain / condensation on lens | Water film reduces LWIR transmission | Lens heater element (Boson/ADK heater mode ~12 W peak) |
| Poor map repeatability | Diurnal/seasonal temperature changes in thermal layers | Context-tagged thermal layers; do not treat as static geometry |

---

## Part C — Integration

### 15. Event + Thermal in Fusion

The four-modality stack (RGB + LiDAR + thermal + event) represents the
"all-weather, all-time" sensing philosophy:

| Modality | Darkness | High motion | Fog / smoke | HDR sun/shadow | 3D geometry |
|---|---|---|---|---|---|
| RGB | Fails | Motion blur | Degrades | Saturation / underexposure | No (needs stereo/depth) |
| LiDAR | Unaffected | Unaffected | Degrades (scatter) | Unaffected | Yes (primary) |
| Thermal LWIR | Unaffected | Slight thermal trail | Penetrates | Minor solar saturation | No |
| Event camera | Unaffected | No blur | Unaffected | High DR | No |

Complementarity logic:
- **LiDAR** = 3D geometry backbone; weather-robust; no thermal / appearance.
- **Thermal** = night / darkness; pedestrian heat contrast; fog / smoke penetration.
- **Event** = high-speed motion without blur; HDR transitions; microsecond timing.
- **RGB** = texture, colour, appearance-based recognition (day, good lighting only).

Minimum viable all-conditions airside stack: (1) LiDAR — primary geometry,
illumination-independent; (2) Thermal LWIR — night/dusk pedestrian and vehicle
detection; (3) RGB — day operations for markings and identification;
(4) Event — optional HDR supplement for apron transitions and fast-moving ground
equipment. Event cameras are least mature for semantic tasks and are most
justifiable as a motion-alert trigger rather than a segmentation input.

---

### 16. Calibration of Event / Thermal to LiDAR

**Thermal-to-LiDAR calibration (heated-target method)**: Place a heated
calibration target (heated cardboard box or resistive-element thermal
checkerboard) in the scene; it appears with high contrast in both the thermal
image and the LiDAR intensity channel. Detect 2D corner correspondences in the
thermal image and the same corners in the 3D LiDAR scan; solve the 6-DoF
extrinsic `[R|t]` via PnP. Intrinsic `K` is determined via LWIR checkerboard
(alternating heated/unheated squares) or the heated-box at multiple poses.
Alternative: targetless calibration using mutual information between LWIR image
and LiDAR reflectivity / intensity maps.

**Event-to-LiDAR calibration (frequency-coded LED target)**:
Event cameras do not produce frames; standard checkerboard calibration does not
work. Frequency-coded LED target approach (arxiv 2511.12291): embed LEDs that
blink at known frequencies (10–200 Hz) at target corners; event camera fires
periodically at each LED location; FFT identifies LED locations by blink
frequency; ellipse fitting refines corner positions; LiDAR detects the same
target corners via geometric structure. A single unified calibration target
(3D cube with ChArUco faces + LED corners + geometric edges) calibrates RGB,
event, and LiDAR simultaneously. **Reported accuracy: event-LiDAR reprojection
error 2.732 px** (vs. 3.161–4.691 px for competing methods).

**Key differences from RGB-LiDAR calibration**:

| Camera type | Target | Sync requirement | Notes |
|---|---|---|---|
| RGB | Static checkerboard | Millisecond | Well-established; OpenCV |
| Thermal | Heated / differential-emissivity target | Millisecond | Same math; slightly complex target fabrication |
| Event | Dynamic (motion or blinking LED) | Microsecond hardware sync | Requires active target content to generate events |

---

### 17. For Aggregated-Map Segmentation

In the host KB context (aggregated multi-scan LiDAR maps; airside; segmentation
focus):

**1. Thermal enhances night map labelling**: Night-time aggregated scans lack
co-registered camera texture; a co-calibrated LWIR camera provides an
illumination-independent temperature-channel annotation source that can reach
comparable quality to LiDAR + RGB labels in daylight.

**2. LiDAR-thermal feature projection is drop-in**: Extend any 2DPASS / LIF-Seg
/ OpenScene pipeline by appending LWIR pixel values as additional per-point
features after `P = K [R|t]` projection. Multi-modal knowledge distillation
trains modality-agnostic features from day (RGB+LiDAR) and night (thermal+LiDAR)
data jointly.

**3. Airside person class improvement**: Ground crew in dark overalls have small
LiDAR cross-section and low reflectivity. Thermal body heat detection reduces
the false-negative rate for the "person" class at night.

**4. Event cameras and aggregated maps**: Events do not directly contribute to a
static aggregated point-cloud map. Their value is in real-time motion
segmentation — a high-speed event stream can flag which LiDAR points are from
moving objects in the current scan, improving aggregated-map consistency. This
is conceptually related to the dynamic object removal problem.

**5. Dataset gap**: No publicly available dataset combines all four modalities
(event + thermal + RGB + LiDAR) with semantic labels for airside environments
as of mid-2026 — DSEC covers road driving, KAIST/MFNet cover 2D road images,
and PMC9653951 covers thermal+LiDAR without semantic labels. Building an
airside multi-modal annotated dataset is an open research need.

---

### 18. Validation

Event camera:
```
event rate versus motion and illumination conditions
timestamp alignment to IMU / LiDAR / frame camera
hot pixel count; contrast threshold calibration (positive and negative)
flicker response to power-line frequency sources
SLAM residuals by event age and image region
```

Thermal camera:
```
NETD and fixed-pattern noise checks (blackbody or reference target)
NUC event frequency and image jump characterisation
pedestrian / equipment detection range by weather and ambient temperature
emissivity / reflection test cases (metal surfaces, wet pavement)
geometric reprojection residual versus LiDAR / RGB co-registration
NUC gap coverage by fusion fallback modality
```

---

### 19. Implementation Notes

- For thermal-LiDAR fusion, apply `P = K [R|t]` per-point projection before the
  network forward pass; the thermal pixel value becomes an additional per-point
  feature alongside XYZ and intensity. No architectural changes to 2DPASS /
  OpenScene are required beyond adjusting the input channel count.
- Preserve raw thermal digital level (DL) alongside any converted temperature
  output; recalibration updates the conversion but the raw DL is the archival unit.
- Log every NUC shutter event with a timestamp; tracking and fusion pipelines
  must suppress confidence during the 1–3 frame gap.
- Warm up event cameras at least 5 minutes before calibration logging; bias
  currents shift during thermal stabilisation.
- Apply hot-pixel masking before any voxel-grid step; a few hot pixels at high
  event rate can dominate the entire voxel volume.
- For airside ground crew detection, treat the event stream as a motion-salience
  mask over the thermal image — pixels with recent events are prioritised for
  thermal-based person detection.

---

## 20. Sources

- Gallego et al., "Event-based Vision: A Survey." IEEE TPAMI, 2022. https://arxiv.org/abs/1904.08405
- Mueggler et al., "The event-camera dataset and simulator." IJRR, 2017. https://journals.sagepub.com/doi/10.1177/0278364917691115
- Gallego, Forster, Mueggler, Scaramuzza, "Event-based Camera Pose Tracking using a Generative Event Model." https://arxiv.org/abs/1510.01972
- Gallego, Rebecq, Scaramuzza, "A Unifying Contrast Maximization Framework." CVPR, 2018. https://openaccess.thecvf.com/content_cvpr_2018/papers/Gallego_A_Unifying_Contrast_CVPR_2018_paper.pdf
- Stoffregen et al., "Event Camera Calibration of Per-pixel Biased Contrast Threshold." https://arxiv.org/abs/2012.09378
- Frontiers fnins.2021.702765 — DVS simulator (threshold mismatch model). https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2021.702765/full
- Gehrig et al., "DSEC: A Stereo Event Camera Dataset." RA-L, 2021. https://arxiv.org/abs/2103.06011
- Prophesee / Sony IMX636 product brief 2024. https://www.prophesee.ai/event-based-sensor-imx636-sony-prophesee/
- Event camera innovations survey. arxiv 2408.13627. https://arxiv.org/html/2408.13627v2
- Unified LiDAR-RGB-event calibration (LED target; 2.732 px result). arxiv 2511.12291. https://arxiv.org/html/2511.12291v1
- Hybrid event-frame semantic segmentation (65% energy reduction, 2025 SOTA). arxiv 2507.03765. https://arxiv.org/html/2507.03765v1
- Holst, "Electro-Optical Imaging System Performance." SPIE Press.
- FLIR, "How does FLIR calibrate thermal cameras? What is NUC?" https://oem.flir.com/support/support-center/knowledge-base/how-does-flir-calibrate-thermal-cameras-what-is-nuc/
- FLIR Boson datasheet. https://f.hubspotusercontent10.net/hubfs/20335613/flir-boson-datasheet.pdf
- FLIR ADK announcement. https://oem.flir.com/about/news/flir-announces-adk-with-boson-for-automotive-thermal-vision/
- PMC9653951 — 3D radiometric LiDAR-thermal mapping (heated-box calibration; Vue Pro R 336). https://pmc.ncbi.nlm.nih.gov/articles/PMC9653951/
- KAIST Multispectral Pedestrian benchmark. https://soonminhwang.github.io/rgbt-ped-detection/
- MFNet RGB-thermal semantic segmentation dataset. https://github.com/haqishen/MFNet-pytorch
- Thermal-LiDAR extrinsic calibration. MDPI Sensors 2024. https://www.mdpi.com/1424-8220/24/2/669
- Lynred nighttime detection and thermal AEB studies. https://www.lynred.com/blog/how-thermal-imaging-contributing-development-new-generation-nighttime-pedestrian-detection
- FLIR Thermal AEB page (AAA 2019 100% hit rate data). https://oem.flir.com/learn/discover/Thermal-Cameras-and-Pedestrian-Detection-and-Automatic-Emergency-Braking-System/
- FLIR user documentation on thermography parameters and emissivity. https://support.flir.com/docdownload/assets/web/27eh/en-us/T505000.xml.html
- 2DPASS: 2D Priors Assisted Semantic Segmentation. https://arxiv.org/pdf/2207.04397
- OpenScene: 3D Scene Understanding with Open Vocabularies. https://arxiv.org/abs/2211.15654
