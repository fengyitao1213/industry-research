# Camera Imaging, Noise, and Calibration

<!-- kb-visual:start -->
![Camera Imaging, Noise, and Calibration curated visual](../_assets/visuals/geometry-3d-camera-imaging-noise-calibration.svg)

*Visual: camera measurement chain from scene radiance through lens projection, distortion, rolling-shutter timing, sensor noise, calibration residual, and estimator covariance.*
<!-- kb-visual:end -->

Cameras measure irradiance projected through optics onto a pixel array. The
output image is shaped by perspective geometry, lens distortion, exposure,
sensor noise, rolling shutter, ISP processing, and calibration. For autonomy,
the important fact is that image pixels are not only appearance data. They are
geometric bearings with photometric uncertainty and time semantics.

In a LiDAR-primary segmentation system, cameras serve as colorization sources
and feature-distillation teachers. Understanding the physics of the imaging
pipeline — from photon arrival through ADC to ISP output — is essential for
building reliable colorized maps, feeding 2D-to-3D distillation networks with
correct pixel values, and diagnosing the failure modes that corrupt CLIP-space
feature lifting under airport apron illumination.

---

## Related Docs

- [Camera Projective Geometry, PnP, and Triangulation](camera-projective-geometry-pnp-triangulation.md) — the K matrix, distortion, LiDAR-to-image projection, and calibration reprojection error
- [LiDAR Working Principles and Noise Models](lidar-working-principles-noise-models.md) — the primary sensor whose points are colorized by camera
- [Sensor Calibration and Time Synchronization](sensor-calibration-time-synchronization.md) — extrinsic calibration and LiDAR-camera temporal offset
- [Event and Thermal Camera Models](event-thermal-camera-models.md) — alternative sensor for low-light and adverse weather
- [Aggregated-Map Semantic Segmentation](../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md) — §4.2 colorized cloud and §4.3 LiDAR+image fusion use the pipeline developed here
- [2DPASS Method Page](../../30-autonomy-stack/perception/methods/2dpass.md) — multi-scale feature distillation via camera projection
- [OpenScene Method Page](../../30-autonomy-stack/perception/methods/openscene.md) — CLIP feature lifting from calibrated projection
- [Mosaic3D Method Page](../../30-autonomy-stack/perception/methods/mosaic3d.md) — open-vocab 3D understanding via contrastive image alignment
- [Night Operations and Thermal Fusion](../../30-autonomy-stack/perception/overview/night-operations-thermal-fusion.md) — the LWIR alternative when camera color collapses

---

## Why It Matters

| Choice / Effect | Impact | Risk if ignored |
|---|---|---|
| HDR sensor vs standard | Captures 100 dB+ luminance ratio from shadowed apron to sunlit tarmac | Simultaneous clip-and-crush: colorized map has white noise on highlights, zero-noise on shadows |
| Linear RAW vs sRGB-encoded input to DNN | ImageNet-pretrained encoders expect sRGB gamma; linear data shifts feature space | 2DPASS/SLidR/ScaLR distillation aligns wrong pixel-to-point pairs; 3D network learns corrupted semantics |
| CLIP color-space assumption | CLIP trained on sRGB 8-bit JPEG; 12-bit RAW differs in texture statistics, color gamut, white point | Zero-shot language queries on airside classes return wrong 3D regions; magnitude of domain shift unquantified |
| Rolling vs global shutter | Rolling shutter timestamps vary per row; LiDAR points project to row-dependent poses | Colorization error up to 15 cm at 5 m/s; SLAM residuals biased by row |
| Dark current at 85 °C | Automotive sensor operating temperature raises dark current by up to ~10× vs 25 °C | Night / apron heat: dark current dominates noise, DR collapses, color meaningless |
| Vignetting per channel | Corner-projected LiDAR points receive less color signal than center-projected | Multi-pass colorized map has spatial luminance gradient; photometric aggregation inconsistent |
| White balance consistency | Illuminant shifts between sessions (D65 sun vs sodium-vapor apron lights) | Same painted marking has different RGB across map sweeps; per-point confidence aggregation fails |
| EMVA 1288 metrics | Standardized QE, system gain, DR, PRNU for sensor comparison | Selecting sensors from peak-spec marketing numbers leads to under-spec'd DR for airside scene range |

---

## 1. Why Camera Physics Matters for a LiDAR Segmenter

Fusion segmenters distill rich 2D appearance features into 3D LiDAR space.
This distillation is only as good as the image pixels that feed it:

**Colorized point clouds** carry per-point RGB values projected from camera
images. A saturated highlight on sun-lit tarmac clips all channel information
to 255/255/255 — indistinguishable from white road marking, aircraft fuselage,
or concrete apron. A shadow under an aircraft wing can clip to 0/0/0, losing
the painted centerline beneath it. Both failure modes corrupt the color features
that distinguish surface types in LiDAR segmenters.

**2D to 3D feature distillation** (2DPASS, SLidR, ScaLR) projects image
encoder features onto matched 3D points. If the image is noisy or overexposed
at the matched pixel, the distilled feature is corrupted; the LiDAR network
inherits the error without knowing its origin. A single saturated pixel silently
poisons the distillation loss at every 3D point that projects to it across all
training frames.

**The camera noise floor sets a confidence bound** on color-derived features.
Below a certain illuminance, shot noise dominates and per-pixel color becomes
unreliable. Any confidence weighting in colorization must be grounded in the
sensor's SNR curve, not assumed constant.

**OpenScene and Mosaic3D** lift CLIP/LSeg features from camera images. CLIP
was trained on internet images: sRGB, 8-bit, JPEG-compressed. A 12-bit RAW
industrial image needs careful conversion before feature extraction, or the
feature space is shifted relative to CLIP's training distribution. This
domain shift is real but its quantitative magnitude for LiDAR distillation
tasks has not been characterized in published literature — an open gap.

---

## 2. The CMOS Imaging Pipeline

### 2.1 Photon Arrival to Raw Pixel Value

The full pipeline from scene radiance to digital number (DN):

```
Photons
  --> Photodiode (QE η)
  --> Photoelectrons (N_e = η · N_photons)
  --> Capacitor (charge accumulation; limit = FWC)
  --> Charge-to-voltage (V = N_e / C_sense, gain K_cg µV/e-)
  --> Analog Amplifier (ISO / gain stage)
  --> ADC (N-bit; DN = N_e / K where K = system gain in e-/DN)
  --> Raw frame (linear-light, Bayer pattern, 10-16 bit)
  --> ISP (demosaic -> WB -> color matrix -> gamma -> JPEG)
  --> Encoded image (sRGB 8-bit)
```

Key stages in detail:

1. **Photon arrival** — Poisson-distributed; mean arrival rate equals
   irradiance × pixel area × integration time divided by photon energy (hf).

2. **Photoelectric conversion** — Quantum efficiency `η` (wavelength-dependent)
   is the fraction of photons that generate one electron.
   `N_e = η · N_photons`

3. **Charge collection** — Electrons accumulate in the photodiode well until
   readout or full-well saturation. The FWC (full-well capacity) is the
   maximum electrons a pixel can hold without saturation.

4. **Charge-to-voltage conversion** — The conversion gain `K_cg` (µV/e⁻) is
   set by the sense-node capacitance: `V = N_e / C_sense`.

5. **Analog amplification** — Variable gain stage (ISO setting) amplifies
   voltage before digitization. Higher gain amplifies signal and read noise
   equally, reducing effective dynamic range.

6. **ADC quantization** — The voltage is digitized to N-bit integers (DN).
   System gain `K` (e⁻/DN) links electrons to digital output:
   `DN = N_e / K` → `N_e = K · DN`

### 2.2 EMVA 1288 Frame Model

The EMVA 1288 standard (release 4.0, with v3.0 still the most widely cited
in camera datasheets) defines a linear camera model. Total variance in
electrons is the sum of independent noise sources:

```
sigma²_total = sigma²_shot + sigma²_dark + sigma²_read + sigma²_FPN + sigma²_quant
```

For practical use, the standard collapses all dark noise sources (thermal,
amplifier, ADC) into a single measured parameter `sigma_d` (electrons RMS,
measured without illumination at a given temperature and exposure time).

The three primary unknowns measurable from a photon-transfer curve (PTC) are:
- `η` — quantum efficiency (from PTC slope in photoelectron units)
- `K` — system gain in e⁻/DN (from PTC slope in DN²/mean)
- `sigma_d` — temporal dark noise (from dark-frame variance)

Once these are known, the full noise model is predictive: given an exposure
setting and scene radiance, you can compute expected SNR at each pixel before
capture. This is the basis for confidence-weighted colorization.

---

## 3. Noise Sources

### 3.1 Photon Shot Noise

**Nature:** Poisson-distributed arrival of discrete photons. Irreducible —
a quantum fundamental, not a sensor defect.

```
sigma_shot = sqrt(N_e)
SNR_shot = N_e / sigma_shot = N_e / sqrt(N_e) = sqrt(N_e)
```

Where `N_e` is the mean number of photoelectrons collected. Doubling exposure
time doubles signal but SNR improves only as `sqrt(2)` (3 dB).

Practical numbers: at 100 e⁻ signal, SNR_shot = 10 (20 dB). At 10 000 e⁻,
SNR_shot = 100 (40 dB). For airside night scenes where AE drives exposures to
gather only ~50-100 e⁻ per pixel, color is shot-noise-limited and unreliable.

### 3.2 Read Noise

**Nature:** Gaussian, zero-mean, independent of illumination. Sources include
kTC noise on the sense node, source-follower thermal noise, column amplifier
noise, and ADC comparator noise.

```
sigma_total² = sigma_shot² + sigma_d²    (total noise in electrons)
```

`sigma_d` (temporal dark noise) collapses read noise and dark noise at a given
temperature and exposure time. Modern BSI (back-side illuminated) CMOS sensors
achieve `sigma_d ≈ 1–3 e⁻` RMS (scientific grade), `3–10 e⁻` (automotive
grade at room temperature). Read noise sets the noise floor that limits
low-light color reliability and is the denominator in the dynamic range formula.

### 3.3 Dark Current

**Nature:** Thermally generated electrons in the depletion region even with
no light. Rate: `D` electrons/pixel/second.

Contribution to noise:
```
sigma_dark = sqrt(D · t)    (shot noise on the dark signal)
```

**Temperature dependence (Arrhenius):**
```
D(T) = D_0 · exp(-E_a / k_B · T)
```

Where `E_a ≈ 0.63 eV` (silicon mid-gap), `k_B` is Boltzmann's constant,
`T` in Kelvin. Empirically: dark current doubles every approximately 6–10 °C
(literature cites 6 °C, 7 °C, and up to 10 °C depending on sensor design;
7 °C is a commonly cited midpoint for silicon — treat the range as uncertain).

Automotive cameras operate across −40 °C to +85 °C. At 85 °C (hot apron,
direct sun on camera housing), dark current is often the dominant noise source
in low-light scenes — tunnel entry, aircraft shadow, under-wing regions. A
20 °C drop reduces dark current by approximately 4× (~12 dB improvement in
DR in the dark-current-limited regime). For long-exposure night mapping,
thermoelectric cooling of the sensor is an option in precision MLS rigs.

### 3.4 Fixed-Pattern Noise (FPN)

Two types, both spatial and repeatable (not averaged away by frame stacking):

**DSNU (Dark Signal Non-Uniformity):** Pixel-to-pixel variation in dark current
offset. Corrected by subtracting an averaged dark frame captured at the same
temperature and exposure time as operation.

**PRNU (Photo Response Non-Uniformity):** Pixel-to-pixel variation in quantum
efficiency — a fixed gain map. Appears as a spatial pattern under uniform
illumination. Corrected by flat-field division.

EMVA 1288 defines `DSNU1288` (spatial std dev of dark signal, e⁻) and
`PRNU1288` (spatial std dev of photo response, % of signal) as standardized
metrics. PRNU > 1% requires mandatory flat-field calibration for photometric
consistency across a multi-pass aggregated map.

### 3.5 Quantization Noise

ADC rounding introduces uniform quantization error `ε ∈ [−½ LSB, +½ LSB]`.
Variance: `sigma_q² = (LSB)² / 12`. SNR improvement per added bit: 6.02 dB.

| Bit depth | Levels  | SQNR (dB) |
|-----------|---------|-----------|
| 8-bit     | 256     | 50.1 dB   |
| 10-bit    | 1 024   | 62.2 dB   |
| 12-bit    | 4 096   | 74.0 dB   |
| 14-bit    | 16 384  | 86.0 dB   |
| 16-bit    | 65 536  | 98.1 dB   |

For sensors with `sigma_read ≈ 2–5 e⁻` and FWC ≈ 20 000–100 000 e⁻, 12-bit
raw is usually sufficient to prevent quantization from being the dominant noise
source. **8-bit post-ISP JPEG discards 4–6 bits of original dynamic range**
and introduces blocking artefacts that damage high-frequency features (apron
markings, fence mesh, taxiway edge paint) most critical for airside class
discrimination.

### 3.6 Banding and Column Noise

Column-parallel ADC architectures (used in nearly all modern CMOS sensors for
readout speed) can introduce **column fixed-pattern noise** — a faint vertical
stripe pattern. Row address decoder variation can produce **row banding**
(horizontal stripes). Both are FPN variants correctable by column-offset
calibration maps. Dynamic column noise (varying frame-to-frame) is harder to
remove and requires per-frame averaging or model-based correction.

---

## 4. Photo Response and Dynamic Range

### 4.1 Linear Photo-Response and Saturation

In the linear working range, DN is proportional to irradiance and exposure
time. **Full well capacity (FWC):** maximum electrons before saturation.
Typical values: 10 000–30 000 e⁻ (small 1–2 µm automotive pixels),
60 000–600 000 e⁻ (large-pixel scientific). Automotive 2 µm pixels:
~20 000–60 000 e⁻.

At saturation all channels clip to maximum DN — colors collapse to white,
gradients vanish, and texture is destroyed. No post-processing recovers
information that was not recorded.

### 4.2 Dynamic Range Definition

```
DR_dB   = 20 · log10(FWC / sigma_read)    [dB]
DR_stops = log2(FWC / sigma_read)          [exposure stops / EV]
```

Worked example — Adimec S-25 (OnSemi Vita25k sensor, measured values):
```
sigma_read = 34 e-  (global shutter sensor)
FWC        = 16 119 e-
DR         = 20 · log10(16 119 / 34) = 53.7 dB
```

A 120 dB DR sensor (state-of-art automotive LOFIC) handles a 10⁶:1 luminance
ratio — covering the ~90–100 dB dynamic range of a sunlit tarmac versus a
shadowed aircraft apron scene. A standard 60 dB sensor simultaneously saturates
in highlights and crushes shadows on the same airside scene.

### 4.3 High Dynamic Range (HDR) Techniques

**Multi-exposure bracketing / stacking:** Capture 2–4 frames at different
exposures; merge a tone-mapped HDR image. Introduces inter-frame motion
artefact for moving scenes (aircraft taxiing, GSE vehicles). Frame latency
breaks hard time synchronisation with LiDAR.

**Native single-exposure HDR sensors:**

*Dual Conversion Gain (DCG):* Each pixel reads out twice — once with high
conversion gain (low-noise, low-saturation limit) and once with low conversion
gain (high-saturation). Combined, this extends DR by ~1.5–2 stops without
motion artefact.

*LOFIC (Lateral Overflow Integration Capacitor):* Overflow electrons that
exceed the photodiode FWC spill into an in-pixel capacitor (LOFIC). The
photodiode captures dark/mid tones (HCG readout, low noise); the LOFIC
captures bright highlights (LCG readout, high FWC). Two-stage LOFIC sensors
(OmniVision OX08D10 with TheiaCel; Sony IMX490) achieve **greater than 120 dB
single-exposure DR** at automotive frame rates.

*Split-pixel / sub-pixel:* Large photodiode + small photodiode co-located; the
small photodiode handles highlights with inherently smaller FWC; merged at
readout.

**Relevance to airside:** On a clear-sky day, the luminance ratio between white
tarmac markings in direct sun and the dark interior of an aircraft hold exceeds
100 dB. A standard sensor with 60 dB DR will simultaneously saturate in
highlights and clip in shadows. HDR sensors or carefully controlled exposure
sequences are mandatory for reliable color-feature extraction across the full
apron scene.

### 4.4 Logarithmic and Piecewise-Linear Sensors

Some automotive sensors (including the Sony IMX390, used in several AV
camera platforms) implement a piecewise-linear or logarithmic response mode
that compresses highlights in-pixel before readout — effectively extending DR
without multi-exposure merging. The IMX390 supports HDR modes targeting
automotive exterior applications including LED-flicker mitigation.

**Important:** The non-linear in-sensor response means pixel values are no
longer linear with scene radiance. Feature distillation networks trained on
linear or sRGB-gamma images will see out-of-distribution pixel statistics.
Document the sensor mode and linearize before feeding any photometric pipeline.

---

## 5. Exposure Control

### 5.1 The Exposure Triangle

Three factors jointly determine signal level (electrons collected per pixel):

```
N_e = η · E_v · A_pixel · t_exp · T_lens
```

**Aperture (f-number):** `T_lens proportional_to 1/f²`. Closing the aperture
(large f-number) reduces light, increases depth of field. In most automotive
and airside infrastructure cameras, the aperture is fixed (no iris).

**Shutter speed / exposure time `t_exp`:** Longer exposure = more light but
more motion blur. Recommendation: keep `t_exp` short enough that motion blur
is less than 1 pixel at maximum platform speed.

**ISO / gain:** Electronic amplification applied after photoelectron collection.
High ISO amplifies signal and read noise equally. Beyond approximately ISO
800–1600 on most sensors, SNR degrades because shot noise already dominates
read noise. High-ISO-forced frames in low light have reduced effective DR:
at ISO 3200 on a typical 12-bit sensor, effective DR can drop from 70+ dB to
~50 dB.

Motion blur estimate:
```
blur_pixels ~= image_velocity_pixels_per_sec × t_exp
```

At 20 km/h with 20 ms exposure, a 60° horizontal FOV camera sees ~0.3° blur
per row — approximately 0.5% of frame width. For a 12 Mpx image at 90° FOV,
that is ~40 pixels of blur: significant for fine-feature extraction on apron
markings or fence mesh. Keep exposure short enough to stay below 1 pixel of
motion blur at maximum operating speed.

### 5.2 Rolling Shutter

In rolling-shutter sensors, rows are exposed and read out sequentially.
A typical 1/30 s frame at 1920 rows means each row starts ~16 µs after the
previous. During camera motion (vehicle at 20 km/h) or scene motion (aircraft
taxiing), vertical objects appear **sheared** in the image. A fence post tilts;
an aircraft nose appears stretched.

**Impact on LiDAR-camera fusion:** 3D points are timestamped to LiDAR spin
timing; the camera pixel for the matched projection is stamped at row-readout
time. For a rolling-shutter camera, the projection transform must use the
per-row pose, not the frame-start pose:

```
t_row(v) = t_frame_start + v × line_delay

P_c(v) = T_camera_map(t_row(v)) × P_map
pixel  = project(P_c(v))
```

For airside AV at 5 m/s with a 30 ms readout, the top vs bottom of the
frame differs by 15 cm of vehicle translation — enough to misplace a runway
light by one row in the training map. This is called rolling-shutter-aware
projection, or RS correction. See also
[Camera Projective Geometry, PnP, and Triangulation §5.5](camera-projective-geometry-pnp-triangulation.md).

### 5.3 Global Shutter

All pixels expose simultaneously; no row skew. Required for high-speed or
spinning platforms. Trade-off: global shutter requires an in-pixel storage
node, reducing fill factor by ~20–30%, increasing read noise, and reducing FWC
by ~10–20%.

For fixed-mount or slow-moving cameras (airside infrastructure), rolling shutter
with RS correction is acceptable. For a rotating platform or high-speed vehicle
camera, global shutter is preferred despite the cost in noise performance.

### 5.4 Auto-Exposure (AE)

AE continuously adjusts `t_exp` (and sometimes gain) to maintain a target
image brightness using metering strategies (center-weighted, spot, evaluative).

**AE impact on fusion:** When exposure changes between LiDAR sweeps, the same
3D point projects onto a pixel with a different raw DN value. Aggregated maps
built over multiple passes will have inconsistent color values per point.
Feature distillation networks trained on fixed-exposure images may see
out-of-distribution pixel values under a changed AE regime.

A research-grade AE controller optimized for robot localization uses the
camera's photometric response function (PRF) to predict optimal exposure of
future frames rather than reacting to current brightness. The optimization
metric is gradient information (a proxy for feature detectability), and it
outperforms fixed exposure across a 1–217 lux range.

**Recommendation for aggregated maps:** Lock exposure (`t_exp` and gain) per
mapping session, or perform photometric normalization post-capture. HDR sensors
reduce the motivation to change AE mid-session by handling the full luminance
range in a single fixed exposure.

---

## 6. Color Reproduction

### 6.1 Bayer Pattern and Demosaicing

Standard CMOS image sensors use a **Bayer color filter array (CFA)**: 50%
green, 25% red, 25% blue pixels in a 2×2 repeating pattern (RGGB standard;
variants BGGR, GRBG exist). Each pixel captures only one color channel.

**Demosaicing** interpolates the missing two channels at each pixel location.
Algorithms range from bilinear (fast, blurs edges) to gradient-based (VNG,
AHD) to Malvar-He-Cutler (MHC) to deep-learning demosaicers. Demosaicing
introduces spatial correlations between adjacent pixels — the apparent
resolution is lower than the raw pixel count. Poor demosaicing creates
color fringing at edges (painted apron markings, aircraft fuselage outlines)
that degrades the feature maps projected onto 3D points.

### 6.2 White Balance

Illuminant chromaticity shifts the raw color distribution: noon sun (D65,
~6500 K) vs tungsten (A, ~2856 K) vs airport fluorescent or sodium-vapor
overhead lighting (very different spectral distribution from any CIE standard
illuminant).

**Methods:**

*Gray-world:* Assume mean scene color is neutral gray; scale R, G, B channels
to equalize means. Fails on scenes that are genuinely non-gray (apron at dawn
with orange sodium-vapor lights).

*Max-RGB:* Assume the brightest pixel is specular white; scale to match.
Fails when the brightest pixel is a bright non-white source.

*Learned / AWB (Auto White Balance):* CNN-based illuminant estimation.
More robust but can change between frames if scene content shifts.

**Consistency requirement:** White balance must be locked or normalized across
camera passes for colorized map consistency. Mismatched WB between morning and
afternoon sessions causes the same painted apron marking to have a different
hue in different map sweeps — a direct obstacle to per-point confidence
aggregation and cross-session class boundary stability.

### 6.3 Color Spaces and the Linear vs Gamma Trap

The ISP processing pipeline applies a series of transforms:

```
RAW (sensor linear, Bayer)
  -> Demosaic (interpolate missing channels)
  -> Color Matrix (camera RGB -> CIE XYZ)
  -> White Balance (scale channels to target illuminant)
  -> Gamma Encode:  V_out = 12.92 · V_lin               if V_lin <= 0.0031308
                    V_out = 1.055 · V_lin^(1/2.4) - 0.055  otherwise
  -> Optional tone-map (HDR)
  -> JPEG/PNG encode
  -> sRGB 8-bit image
```

**The linear vs gamma trap for ML:** Most CNN image encoders (ResNet, ViT,
DINOv2) were trained on ImageNet — sRGB JPEG images with gamma applied. The
expected input distribution is sRGB (gamma-encoded). If you feed a linear RAW
image (before gamma), the model sees a very different brightness distribution:
shadows appear too dark, highlights too compressed. Feature representations
shift out of the training distribution.

**Consequence for 2DPASS / SLidR / ScaLR:** These models are trained on public
AV datasets (SemanticKITTI, nuScenes, Waymo) where images are already
sRGB-encoded. For industrial cameras delivering 12-bit RAW, the pipeline must
apply the full ISP: `RAW -> demosaic -> WB -> color-matrix -> sRGB gamma`.
Feeding raw 12-bit linear pixel values to a pretrained encoder is incorrect.

**Consequence for OpenScene / Mosaic3D (CLIP-based):** CLIP was trained on
internet images (sRGB, 8-bit, JPEG-compressed with typical 15–30% quality
compression). The color distribution of uncompressed 12-bit RAW images — even
after gamma encoding — differs from JPEG-compressed internet photos in texture
statistics, color gamut, and white-point assumptions. Domain shift is real but
quantitatively uncharacterized in published distillation literature (noted in
the ScaLR/Three-Pillars paper, which does not address color space) — an open
empirical gap.

**Practical mitigation for CLIP-based methods:**
1. Convert industrial RAW to standard sRGB; apply light JPEG compression
   (Q = 90) before CLIP feature extraction to reduce domain shift from texture
   statistics.
2. Fine-tune the CLIP vision encoder on a small set of airside sRGB images
   (LoRA adapter) to adapt to domain-specific color statistics.
3. Never feed 16-bit linear images directly to a CLIP encoder.

### 6.4 Color Depth

**8-bit output (sRGB JPEG/PNG):** 256 levels per channel; standard for DNN
inputs. JPEG compression at typical quality settings introduces blocking
artefacts and blurs fine-detail edges (painted apron markings, fence mesh,
taxiway edge paint) that distinguish classes.

**10–14-bit RAW:** Preserves full sensor DR. Required for HDR merging and
photometric calibration pipelines.

**Practical guidance:** Store camera frames as 16-bit PNG or TIFF (lossless)
for mapping pipelines. Convert to sRGB 8-bit only at the point of DNN feature
extraction. Do not compress intermediate pipeline stages with lossy JPEG.

---

## 7. Lens Artifacts

### 7.1 Vignetting

Radial falloff of brightness from center to corner of image. Causes include:
natural vignette (cos⁴θ law for off-axis illumination), mechanical vignette
(lens barrel occlusion), and optical vignette (pupil solid-angle reduction):

```
E(r) = E_0 · cos^4(theta)    (natural vignette; off-axis angle theta)
```

Vignetting is **per-channel** (different spectral transmittance in each filter).
Not correcting it introduces a spatial luminance gradient that biases colorized
point cloud edges: corner-projected LiDAR points receive less color signal than
center-projected points, creating a systematic spatial bias in per-point RGB.
Flat-field correction removes vignetting simultaneously with PRNU (§9.1).

### 7.2 Chromatic Aberration

**Axial (longitudinal) CA:** Different focal lengths for different wavelengths;
red and blue planes focus at slightly different depths. Appears as color fringe
at high-contrast edges; worse at large aperture.

**Lateral (transverse) CA:** Magnification varies with wavelength; appears as
a color fringe that scales radially from the image center. Measurable and
correctable in lens calibration (lensfun database provides per-lens polynomials).

Both forms affect the sub-pixel accuracy of LiDAR-point-to-image projection.
For CLIP-feature lifting where sub-pixel accuracy is required, uncorrected CA
can associate a surface point with the feature of an adjacent object.

### 7.3 Flare and Ghosting

Internal reflections between lens elements; triggered by bright sources in or
near the FOV (sun angle over tarmac, aircraft landing lights, apron floodlights
at night). Introduces spurious bright patches and halos that do not correspond
to scene radiance. Extremely difficult to calibrate out; must be detected and
masked. Flare regions corrupt colorized map points with false bright patches
that are inconsistent across viewing angles and sessions.

### 7.4 Defocus and Motion Blur

**Defocus:** Increases with aperture and departure from focus distance.
A fixed-focus industrial camera focused at mid-range (10–30 m) will have
acceptable sharpness across most airside operating distances.

**Motion blur:** Proportional to angular velocity × exposure time. At 20 km/h
with 20 ms exposure, a 60° horizontal FOV camera sees ~0.3° blur per row —
approximately 0.5% of frame width. For 12 Mpx at 90°, ~40 pixels of blur.
For fine-feature extraction on painted apron markings, keep exposure time short
enough that motion blur remains below 1 pixel at maximum platform speed.

---

## 8. Camera Intrinsic Calibration

### 8.1 The K Matrix (Pinhole Projection)

```
K = [ fx   0   cx ]
    [  0  fy   cy ]
    [  0   0    1 ]
```

Where:
- `fx`, `fy` — focal lengths in pixel units (`fx = F / p_x`, F = focal length
  in mm, `p_x` = pixel pitch). For square pixels `fx ≈ fy`.
- `cx`, `cy` — principal point (optical axis intersection with sensor plane,
  in pixels). Typically near but not exactly at image center.

The full projection, distortion models, and extrinsic calibration are covered
in depth in the sibling page
[Camera Projective Geometry, PnP, and Triangulation](camera-projective-geometry-pnp-triangulation.md).
This section focuses on the photometric aspects.

### 8.2 Distortion Coefficients

Real lenses deviate from the pinhole model. The OpenCV Brown-Conrady model
for most automotive lenses uses:

```
Radial:     k1, k2, k3, [k4, k5, k6]
Tangential: p1, p2
```

For most automotive lenses at 60–120° FOV, `k1` and `k2` are dominant. High-
FOV fisheye lenses require the equidistant Kannala-Brandt model.

### 8.3 Zhang's Plane-Based Method and Reprojection Error

Capture 20–50 images of a planar checkerboard target at varied orientations.
Detect corners with sub-pixel accuracy. Estimate homography per view, decompose
to get initial K. Jointly optimize K, distortion coefficients, and per-view
pose via Levenberg-Marquardt to minimize reprojection error:

```
epsilon_reproj = (1/N) · sum_i || p_i - proj(K, d, R_j, t_j, P_i) ||   [pixels RMS]
```

Where `proj(·)` is the projection function, `P_i` are 3D target points,
`p_i` are detected corners.

Target values:
- `epsilon_reproj < 0.5 px` — mapping-grade calibration
- `< 1.0 px` — acceptable for standard AV cameras
- `> 1.5 px` — indicates poor calibration, pattern coverage, or lens quality

Recalibrate after thermal extremes (focal length shifts ~0.1–0.3% over 40 °C),
vibration or mechanical shock, sensor replacement, or windshield change.

---

## 9. Photometric Calibration

Geometric calibration (K matrix) gives **where** a pixel corresponds to in 3D.
Photometric calibration tells you **what the pixel value means radiometrically**
— a necessary foundation for consistent multi-pass colorized maps.

### 9.1 Flat-Field Correction (Vignetting + PRNU)

Capture frames of a uniform luminance source (integrating sphere, calibrated
flat panel). At each pixel `(u, v)`:

```
I_corrected(u,v) = (I_raw(u,v) - Dark(u,v)) / FlatField(u,v)
```

Where `Dark(u,v)` is the dark frame (lens cap on, same temperature and
exposure) and `FlatField(u,v)` is the normalized flat-field response map.
This corrects PRNU (gain variation) and vignetting simultaneously.
Per-channel flat fields are required because vignetting and PRNU are spectrally
dependent — a single luminance flat field is insufficient.

### 9.2 Dark Frame Subtraction

Average N ≥ 30 dark frames (lens cap on, same temperature, same exposure time)
to estimate `DSNU(u,v)` — the per-pixel dark offset. Subtract before flat-field
division. Dark frames must be re-captured at operating temperature if dark
current is significant (>10 e⁻/s). For an automotive sensor at 85 °C, a dark
frame captured at 25 °C will under-correct DSNU by a potentially large margin.

### 9.3 Gamma Linearization

Before photometric operations (HDR merge, colorimetric analysis, per-point
confidence weighting): invert the ISP gamma curve to restore linear-light
values. For sRGB-encoded images, apply the inverse sRGB transfer function.

For proprietary ISP curves (sensor-specific tone pipelines): measure the
camera's photometric response function (PRF) by photographing a step-wedge at
known exposures and fitting the tone curve. Apply the inverse PRF to linearize.

**When to linearize:** Always linearize before computing ratios (for flat-field
correction), before computing differences (for dark subtraction), and before
any HDR merge. Do not linearize before DNN feature extraction — the encoder
expects sRGB-encoded (gamma-applied) images.

### 9.4 Color Calibration (Macbeth ColorChecker)

The Macbeth ColorChecker (24-patch target) provides spectrophotometrically
characterized reference patches. Procedure:

1. Photograph the target under controlled illumination at the operating site.
2. Measure camera RGB values at each patch in linear-light units.
3. Solve a 3×3 (or 3×4 for higher accuracy) color-correction matrix `M`
   mapping camera linear RGB to device-independent XYZ or sRGB.
4. Apply `M` to all images from that camera under that illuminant.

For multi-camera systems: calibrate each camera to a common color space to
ensure colorized point cloud is consistent regardless of which camera assigned
the per-point color.

### 9.5 Multi-Camera Consistency for HDR Aggregated Maps

When aggregating color from multiple cameras and multiple passes, all inputs
must be photometrically normalized to a common standard before merging. Steps:

1. Apply dark subtraction, flat-field, and gamma linearization per frame.
2. Apply per-camera color calibration matrix to bring all cameras to a common
   linear RGB space.
3. Normalize for exposure: divide by `t_exp × gain` to produce
   radiance-proportional values.
4. Weight observations by incidence angle, projection confidence, and
   saturation mask before averaging.
5. Apply gamma at the final output stage only, for DNN input.

OmniColor (arXiv 2404.04693) optimizes camera pose for photometric consistency
but does not address radiometric normalization across exposure-varying passes.
That gap means per-point color inconsistency across map sweeps is not corrected
by pose optimization alone — it requires the pipeline above.

---

## 10. Aggregated-Map and LiDAR-Camera Fusion Specifics

### 10.1 Multi-Pass Colorization Quality

An aggregated map is built from multiple LiDAR sweeps with synchronized camera
frames. A given 3D point may be visible in dozens of camera frames from
different passes, times of day, and exposure settings. Naive color averaging:

```
C(P) = (1/k) · sum_i C_i(P)    for k observing frames
```

treats all observations equally. Problems include:
- Frames with different AE settings contribute different raw brightness.
- White-balance changes between morning and afternoon sessions cause hue shift.
- Incidence angle variation changes effective surface reflectance (Lambertian
  BRDF cos(theta) term).
- Occluded or grazing projections contribute low-quality colors.

**Better approach — weighted aggregation:**

1. Per-frame photometric normalization (bring all frames to common exposure
   before merging).
2. Incidence angle weighting (prefer near-normal incidence; down-weight grazing).
3. Confidence from predicted saturated/clipped pixel mask.
4. Point-to-image projection error (geometric confidence from depth buffer).

OmniColor optimizes camera pose for photometric consistency but does not address
radiometric normalization across exposure-varying passes — a documented gap that
must be filled at the pipeline level.

### 10.2 Feature Distillation Pipeline (2DPASS, SLidR, ScaLR)

These methods project 3D LiDAR points onto 2D image planes and extract CNN
features at the corresponding pixel locations. The image encoder (ResNet, ViT,
DINOv2) expects **sRGB-encoded 8-bit images** consistent with ImageNet
pre-training.

Key requirements:
- Apply the full ISP pipeline (demosaic → WB → color matrix → gamma) before
  feature extraction. Do not feed raw linear pixel values.
- Lock AE during training data collection to match deployment distribution,
  or apply per-frame photometric normalization.
- Avoid JPEG compression below ~95 quality — blocking artefacts corrupt
  high-frequency features at edges (markings, fences) which are the most
  discriminative airside classes.

Published benchmarks (SemanticKITTI, nuScenes) use JPEG-compressed sRGB.
Industrial 12-bit RAW cameras need explicit conversion. This conversion step
is underspecified in the distillation literature and must be implemented and
validated by each deployment team.

### 10.3 OpenScene and Mosaic3D (CLIP-Based)

OpenScene fuses CLIP/LSeg per-pixel features from multiple views onto 3D points
using weighted averaging. Mosaic3D aligns a sparse ConvNet LiDAR encoder with
text embeddings via contrastive learning.

**CLIP's color-space assumption:** CLIP was trained on ~400 million image-text
pairs scraped from the web — virtually all sRGB, most JPEG-compressed, 8-bit.
CLIP features for a given patch are optimized for this distribution.

**Domain shift problem:** A 12-bit RAW industrial image even after gamma
encoding differs from a web JPEG:
- No JPEG blocking artefacts in the clean image → texture statistics differ.
- Industrial cameras with calibrated color matrices may produce a wider color
  gamut than typical consumer camera sRGB clipping.
- Airport lighting (metal halide, sodium vapor) has a very different spectral
  distribution from the D65 illuminant assumed by sRGB.

**The magnitude of this domain shift for airside industrial cameras feeding
CLIP-based 3D segmenters is not quantified in published literature.** It is
an open empirical question requiring measurement on real airside data.

**Practical mitigations:**
1. Convert industrial RAW to standard sRGB; apply light JPEG compression
   (Q = 90) before CLIP feature extraction.
2. Fine-tune the CLIP vision encoder on a small set of airside sRGB images
   (LoRA adapter) to adapt to domain-specific color statistics.
3. Never feed 16-bit linear images to a CLIP encoder.

### 10.4 Night and Adverse Lighting Failure Modes

At low illuminance (airside night, unlit apron, aircraft shadow):

- **Shot noise dominates** at the noise floor: SNR ∝ sqrt(N_e) falls below
  3–5 dB, making per-pixel color unreliable as a class discriminator.
- **Color collapses** — chroma from shot noise is random; color clusters shrink
  toward the achromatic axis. ColorChecker patches become indistinguishable.
- **Dark current grows** — at 85 °C ambient (hot apron, long day, camera
  housing in direct sun) and long exposures, dark current adds thousands of
  electrons of noise per pixel.
- **AE drives ISO up** — high ISO gain amplifies read noise; dynamic range
  decreases. At ISO 3200 on a typical 12-bit sensor, effective DR drops from
  70+ dB to ~50 dB.
- **Feature distillation degrades** — the 2D encoder receives noisy, low-SNR
  inputs; distilled features are unreliable; downstream LiDAR segmentation
  accuracy falls.

**Bridge to thermal fusion:** For night operations, LWIR cameras measure
emitted thermal radiation (independent of ambient illumination), bypassing all
of the above failure modes. See
[Night Operations and Thermal Fusion](../../30-autonomy-stack/perception/overview/night-operations-thermal-fusion.md)
for the thermal/LiDAR fusion pipeline. Also see
[Event and Thermal Camera Models](event-thermal-camera-models.md) for the
sensor physics of LWIR vs. visible cameras.

---

## 11. EMVA 1288 Standardized Metrics

The EMVA 1288 standard (latest: release 4.0; v3.0 still the most widely
referenced in camera datasheets) provides a manufacturer-neutral protocol for
characterizing image sensors via the **photon-transfer curve (PTC)** method.

### 11.1 Core Metrics

| Metric | Symbol | Definition | Typical values |
|--------|--------|------------|----------------|
| Quantum efficiency | η(λ) | Fraction of photons → electrons at wavelength λ | 60–85% peak (BSI CMOS) |
| System gain | K | e⁻/DN; measured from PTC slope | 0.1–5 e⁻/DN |
| Temporal dark noise | sigma_d | RMS noise (e⁻) in dark, at operating T and t_exp | 1–10 e⁻ |
| Dynamic range | DR | 20·log10(FWC / sigma_d) | 50–120 dB |
| SNR_max | — | 20·log10(sqrt(FWC)) | 40–55 dB (standard); >60 dB (LOFIC) |
| Absolute sensitivity threshold | µ_p,min | Photons/pixel detectable above noise | 1–10 photons |
| Saturation capacity (FWC) | µ_e,sat | Max e⁻ per pixel | 10 000–600 000 e⁻ |
| DSNU1288 | — | Spatial std dev of dark signal (e⁻) | <1–10 e⁻ |
| PRNU1288 | — | Spatial std dev of photo response (% of signal) | 0.1–2% |
| Dark current | I_d | e⁻/pixel/second at reference T (25 °C) | 1–100 e⁻/px/s |

### 11.2 SNR1 Metric

**SNR1** is the illuminance (in photons/pixel) at which SNR = 1 (0 dB) — the
absolute sensitivity threshold. Defined as:

```
SNR1: the mean number of photons mu_p such that mu_p · eta = sigma_d^2
```

This is the point where signal-to-noise equals 1 under the shot + read noise
model. Below SNR1, any per-pixel measurement is noise-dominated. For airside
color feature extraction, map out the illuminance at which the worst-case
apron zone falls below SNR1 under your sensor's EMVA 1288 data — that defines
when camera color features must be discarded.

### 11.3 How to Use EMVA 1288 Data for Sensor Selection

When selecting cameras for LiDAR fusion in airside AV:

- **DR (dB):** assess HDR adequacy for the scene luminance range (~100 dB for
  sunlit apron vs shadowed aircraft hold). Require DR > 90 dB for single-
  exposure HDR; consider LOFIC sensors for ≥120 dB.
- **η(λ) at 550 nm:** a proxy for color sensitivity (green channel peak);
  higher η → higher SNR at a given exposure.
- **sigma_d:** estimate the minimum illuminance below which color features
  become noise-dominated. At SNR1, color reliability is by definition gone.
- **PRNU1288:** if PRNU > 1%, mandatory flat-field calibration for photometric
  map consistency. PRNU > 2% without correction causes visible color banding
  in the colorized cloud.
- **Compare sensors using EMVA 1288 datasheet values only** (standardized test
  conditions). Do not compare manufacturer peak-spec marketing numbers across
  different test conditions or illumination levels.

---

## 12. Implementation Notes

- Store camera frames as 16-bit PNG or TIFF (lossless) for all mapping pipeline
  stages. Convert to 8-bit sRGB only at the point of DNN feature extraction.
- Apply dark subtraction before flat-field division; both before gamma encoding.
  Order matters: subtracting a dark frame from a gamma-encoded image gives wrong
  results because the subtraction is not linear in pixel values.
- Capture dark frames at the operating temperature, not room temperature.
  Dark current is highly temperature-sensitive (doubles every ~6–10 °C);
  a dark frame captured at 25 °C is invalid for 85 °C operation.
- For rolling-shutter cameras, implement per-row pose interpolation in the
  LiDAR-to-image projection code. Skipping this introduces systematic
  colorization error that scales with vehicle speed and frame readout time.
- Lock AE (`t_exp` and gain) during a mapping session or normalize per-frame
  photometric exposure before aggregating colors across passes.
- Apply white balance consistently: use the same AWB mode or a fixed calibrated
  white-balance matrix across all camera passes for the same site.
- For CLIP-based distillation (OpenScene, Mosaic3D): apply the full ISP pipeline
  and optionally apply light JPEG compression (Q = 90) before feature extraction
  to reduce texture-statistic domain shift.
- Clip `r²/cos(alpha)` calibrated reflectivity for LiDAR at ~10× the
  99th-percentile Lambertian value — and similarly clip any per-point confidence
  weight from photometric calibration at extreme values.
- Validate flat-field calibration per channel (R, G, B separately); a single
  monochrome flat field does not capture per-channel vignetting differences.
- When selecting a sensor, use EMVA 1288 DR and PRNU metrics from standardized
  datasheets; do not compare peak-spec marketing numbers across vendors.

---

## 13. Failure Modes

| Symptom | Cause | Diagnostic |
|---|---|---|
| Colorized map has white highlights across multiple classes | Sensor saturation at exposed tarmac or aircraft fuselage; standard DR insufficient | Inspect per-point confidence map; saturated pixels show zero gradient; add HDR sensor or reduce exposure |
| Zero-valued black patches in colorized cloud | Shadow clip under aircraft wing; standard DR insufficient | Same as above; complement with HDR sensor or check with thermal camera |
| Color seams between map passes | White balance or AE changed between sessions | Compare per-channel mean of stable ground patches across passes; lock WB and AE or normalize photometrically |
| Distillation loss noisy in outdoor scenes | Linear RAW fed to sRGB-trained encoder | Inspect pixel histograms at encoder input; apply full ISP gamma pipeline |
| Zero-shot CLIP queries return wrong apron regions | Domain shift: industrial RAW-derived vs internet JPEG training distribution | Apply Q=90 JPEG re-encode before CLIP; fine-tune vision encoder with LoRA on airside images |
| Color banding parallel to rows | Dark current DSNU not corrected or dark frame captured at wrong temperature | Recapture dark frames at operating temperature; check DSNU1288 vs applied correction |
| Vignette gradient in colorized cloud | Flat-field correction not applied or applied only to luma, not per-channel | Verify per-channel flat-field correction; plot mean per-point color vs image radius |
| Sheared objects in rolling-shutter frames | RS not compensated in LiDAR projection | Implement per-row pose interpolation; validate by reprojecting LiDAR edge points and checking alignment |
| High-frequency edge features washed out | JPEG compression below Q=95 in pipeline | Store as lossless 16-bit; use only at DNN input stage |
| Night color features unreliable | Shot noise dominates below SNR1; AE drives ISO up | Check sensor SNR1 vs scene illuminance; bridge to thermal fusion below illuminance threshold |
| Camera color inconsistent with hot housing | Dark current up to 10× at 85 °C; dark frame captured at 25 °C is stale | Recapture dark frames at full operating temperature range; consider sensor with lower dark current or active cooling |
| Reprojection residuals grow near image corners | Distortion model not applied, or uncorrected chromatic aberration | Plot residual vectors by image location; edge-biased pattern confirms distortion or CA issue |
| Calibration drifts over seasons | Focal length thermal shift (~0.1–0.3% over 40 °C) | Monitor reprojection error on stable known targets; trigger recalibration when error exceeds 0.8 px |

---

## 14. Key Formulas

```
# Photon shot noise
sigma_shot = sqrt(N_e)
SNR_shot   = sqrt(N_e)

# Full noise model (EMVA 1288)
sigma²_total = N_e + sigma_d²         (shot + dark noise in electrons)

# Full SNR
SNR = N_e / sqrt(N_e + sigma_d²)

# Dynamic range
DR_dB  = 20 · log10(FWC / sigma_d)
DR_EV  = log2(FWC / sigma_d)

# Dark current Arrhenius
D(T) = D_0 · exp(-E_a / k_B · T),   E_a ~= 0.63 eV for Si
Rule of thumb: D doubles every ~6-10 C (silicon; 7 C commonly cited midpoint)

# ADC quantization
sigma_q    = LSB / sqrt(12)
SQNR_dB   = 6.02 · N_bits + 1.76 dB

# Lens vignetting (natural)
E(r) = E_0 · cos^4(theta)

# Motion blur
blur_pixels = image_velocity_px_per_sec × t_exp

# Reprojection error (calibration quality)
epsilon_rms = sqrt( (1/N) · sum_i || p_i - proj(K, d, R, t, P_i) ||^2 )   [pixels RMS]

# sRGB gamma encode (IEC 61966-2-1)
V_out = 12.92 · V_lin                          if V_lin <= 0.0031308
V_out = 1.055 · V_lin^(1/2.4) - 0.055         otherwise

# Rolling-shutter per-row timing
t_row(v) = t_frame_start + v × line_delay

# SNR1 condition
mu_p · eta = sigma_d^2              (point where SNR = 1)
```

---

## 15. Sources

- OpenCV Camera Calibration tutorial. https://docs.opencv.org/4.x/dc/dbb/tutorial_py_calibration.html
- OpenCV Camera Calibration and 3D Reconstruction module. https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html
- EMVA Standard 1288, image sensor characterization. https://www.emva.org/standards-technology/emva-1288/
- EMVA Standard 1288 v3.0 release document (PDF). https://www.emva.org/wp-content/uploads/EMVA1288-3.0.pdf
- Hartley and Zisserman, "Multiple View Geometry in Computer Vision." Cambridge University Press, 2004.
- Li and Mourikis, "Vision-aided inertial navigation with rolling-shutter cameras." IJRR, 2014. https://journals.sagepub.com/doi/abs/10.1177/0278364914538326
- Hedborg et al., "Rolling Shutter Bundle Adjustment." CVPR, 2012. https://openaccess.thecvf.com/content_cvpr_2012/html/Hedborg_Rolling_Shutter_Bundle_2012_CVPR_paper.html
- Kalibr camera-IMU calibration toolbox. https://github.com/ethz-asl/kalibr
- 2DPASS: Multi-Scale Fusion-Supervision for 3D Semantic Segmentation (ECCV 2022). https://arxiv.org/abs/2207.04397
- ScaLR / Three Pillars (CVPR 2024). https://arxiv.org/html/2310.17504
- OpenScene: 3D Scene Understanding with Open Vocabularies (CVPR 2023). https://arxiv.org/abs/2211.15654
- Mosaic3D (arXiv 2502.02548). https://arxiv.org/html/2502.02548v1
- OmniColor aggregated map colorization (arXiv 2404.04693). https://arxiv.org/html/2404.04693v1
- EMVA 1288 Wikipedia overview. https://en.wikipedia.org/wiki/EMVA1288
- Basler EMVA 1288 explainer. https://www.baslerweb.com/en/learning/emva-1288-standard/
- LUCID Vision Labs EMVA 1288 tech brief. https://thinklucid.com/tech-briefs/camera-sensor-review/
- Teledyne Vision Solutions — EMVA 1288 overview. https://www.teledynevisionsolutions.com/learn/learning-center/machine-vision/emva-1288-overview-imaging-performance/
- Adimec — dynamic range and SNR in camera specifications. https://www.adimec.com/how-to-interpret-the-dynamic-range-and-signal-to-noise-ratio-snr-in-image-sensor-and-industrial-camera-specifications/
- OmniVision TheiaCel HDR announcement (>120 dB LOFIC). https://www.ovt.com/press-releases/omnivision-announces-new-theiacel-technology-and-automotive-image-sensor-for-led-flicker-free-exterior-cameras/
- Sony IMX390 HDR for self-driving cars. http://www.camera-module.com/download/sony-imx390-sensor-self-driving-cars-led-flicker.html
- PMC — LOFIC area-efficient readout. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10181580/
- PMC — automotive 120 dB LOFIC sensor. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10675219/
- PMC — auto-exposure for robot localization. https://pmc.ncbi.nlm.nih.gov/articles/PMC8839417/
- RAW vs sRGB for computer vision. PMC 6560817. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6560817/
- e-con Systems — Bayer pattern and ISP. https://www.e-consystems.com/blog/camera/technology/understanding-bayer-pattern-and-the-significance-of-an-isp-in-image-processing/
- Lensfun vignetting calibration tutorial. https://lensfun.github.io/calibration-tutorial/lens-vignetting.html
- DFRobot — rolling shutter vs global shutter. https://www.dfrobot.com/blog-15419.html
- Oxford Instruments — dynamic range and full-well capacity. https://andor.oxinst.com/learning/view/article/dynamic-range-and-full-well-capacity
- Automatic color calibration for camera arrays. eScholarship. https://escholarship.org/content/qt3dw2p389/qt3dw2p389.pdf
- PMC — LiDAR colorization multi-camera and low-light enhancement. https://pmc.ncbi.nlm.nih.gov/articles/PMC12610118/
