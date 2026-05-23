# Geodesy, Map Projections, Datums, and Map Frames

<!-- kb-visual:start -->
![Geodesy, Map Projections, Datums, and Map Frames curated visual](../_assets/visuals/geometry-3d-geodesy-map-projections-datums.svg)

*Visual: WGS84 to ECEF to ENU to projected local-map chain with datum/projection distortion and localization error budget.*
<!-- kb-visual:end -->

Autonomy systems need local metric coordinates, but GNSS, surveyed assets, road
maps, and aviation data are tied to Earth. Geodesy supplies the chain from
latitude, longitude, and height to ECEF, ENU, NED, UTM, local map frames, and
road-network coordinates. The first-principles problem is not just conversion;
it is preserving the coordinate reference system, datum realization, epoch,
axis order, units, and frame authority at every interface.

This page is the Earth-anchoring complement to
[Coordinate Frames, Projections, and SE(3)](coordinate-frames-projections-se3.md).
That page covers the SE(3) bookkeeping inside the vehicle transform tree;
this page covers the geodetic anchoring that fixes the world frame to Earth.

---

## 1. Related Docs

- [Coordinate Frames, Projections, and SE(3)](coordinate-frames-projections-se3.md) — SE(3) transform chain that consumes geodetic anchoring; ENU-to-map-frame mechanics
- [Sensor Calibration and Time Synchronization](sensor-calibration-time-synchronization.md) — extrinsic calibration quality gates the map accuracy this page anchors
- [LiDAR Working Principles and Noise Models](lidar-working-principles-noise-models.md) — upstream sensor physics; per-beam range errors enter the map error budget
- [Point Cloud Registration Math: ICP, NDT, GICP](point-cloud-registration-math-icp-ndt-gicp.md) — registration consumes the geodetically-anchored aggregated cloud
- [Aggregated-Map Semantic Segmentation](../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md) — §1.1 of that page defines the aggregated map's world frame; geodetic anchoring quality directly gates segmentation label integrity
- [RTK GPS and IMU Localization](../state-estimation/rtk-gps-imu-localization.md)
- [GNSS RTK Error Models](../state-estimation/gnss-rtk-error-models.md)
- [Occupancy Bayes, Evidential, and Dynamic Grids](../mapping/occupancy-bayes-evidential-dynamic-grids.md)
- [Lanelet2 Maps](../robotics/lanelet2-maps.md)

---

## 2. Why Geodesy Matters for an Aggregated LiDAR Map

Every aggregated LiDAR map begins with a GNSS-anchored survey drive. The
vehicle's pose at each scan epoch is computed in ECEF and ultimately expressed
in some geodetic datum. Those poses become the transforms used to project all
point returns into a single world frame. Geodesy errors therefore propagate
silently into every labeled point.

### 2.1 Why It Matters

| Workflow | Geodesy role | Risk if wrong |
|---|---|---|
| GNSS/INS localization | Converts WGS84/ITRF positions into map frame | Meter-scale shifts from datum, geoid, or lever-arm mistakes |
| Aggregated LiDAR map production | Survey drive anchors all scan poses to Earth | 1–2 m datum mismatch silently corrupts every labeled point |
| Cross-airport map fusion | Two airports, two national datums | Naive merge corrupts aggregate by up to 2 m |
| Simulation and OpenDRIVE | Defines projection and offset for road geometry | Scenario appears correct locally but wrong globally |
| Fleet map updates | Merges local changes into global map tiles | Different vehicles update different frames under the same tile name |
| ICAO certification evidence | Per-point geodetic position in safety case | Wrong datum makes cross-reference to obstacle databases invalid |
| Airside safety zones | Stand geometry, hold-short lines | 30 cm datum error shifts safety boundary into protected area |

### 2.2 Accuracy Stakes

- **Target**: sub-5 cm absolute, sub-2 cm relative (runway marking resolution
  drives this for airside certification).
- **Helmert datum transform at wrong epoch**: 1–2 m error in CONUS when mixing
  NAD83 and WGS84 without conversion.
- **Tectonic plate velocity ignored**: Australia's plate moves 7 cm/year;
  GDA94 vs GDA2020 differ by 1.8 m by 2020.
- **Web Mercator (EPSG:3857) used for engineering**: northing error up to 43 km
  in the map projection, 21 km on the ground — a category error, not a
  rounding issue.
- **Cross-airport merge without datum metadata**: two maps nominally in "WGS84"
  but in different realizations can differ by centimeters to 2 m.

> **Key rule**: a 30 cm datum transformation error or a 1 m projection
> distortion silently propagates into every back-projected label. Record datum,
> realization, and epoch in every map artifact.

---

## 3. The Shape of the Earth

### 3.1 Geoid

The **geoid** is the equipotential surface of Earth's gravity field that
coincides with mean sea level extended continuously under landmasses. It is
irregular — bumpy at the 100 m level globally — because mass distribution is
uneven. The geoid is the physical vertical datum: a spirit level naturally
aligns to the geoid, not to any mathematical ellipsoid.

The geoid-ellipsoid separation is called **geoid undulation N**:

```
H_orthometric = h_ellipsoidal - N
```

Globally, N ranges from approximately −105 m (Indian Ocean) to +85 m
(New Guinea). GNSS directly outputs ellipsoidal height `h`; converting to
orthometric height `H` requires a geoid model (§7).

### 3.2 WGS84 Ellipsoid

The reference ellipsoid is a biaxial oblate spheroid chosen to minimize the
global RMS of geoid undulation. WGS84 defines four fundamental parameters:

| Parameter | Value |
|---|---|
| Semi-major axis `a` | 6 378 137.0 m (exact) |
| Inverse flattening `1/f` | 298.257 223 563 (exact) |
| Gravitational constant `GM` | 3.986 004 418 × 10¹⁴ m³/s² |
| Angular velocity `ω` | 7.292 115 × 10⁻⁵ rad/s |

Derived values:

```
b = a(1 - f)       ≈ 6 356 752.3142 m   [semi-minor axis]
e² = (a² - b²)/a² = 6.694 379 990 14 × 10⁻³   [first eccentricity squared]
e  = sqrt(e²)      ≈ 0.081 819 190 843
```

The semi-major and semi-minor axes define the ellipsoid shape. `e²` appears
explicitly in the LLA ↔ ECEF conversion formulas (§5).

### 3.3 GRS80

**GRS80** (Geodetic Reference System 1980) is the ellipsoid adopted by ITRF
and NAD83. Its defining parameters are `a = 6 378 137.0 m` (identical to
WGS84) and `1/f = 298.257 222 101` (differing from WGS84 by 0.000 001 462).
The resulting difference in polar radius is ~0.1 mm — negligible for all
engineering purposes. When a CORS network or national grid references GRS80,
treating it as WGS84 introduces no measurable error.

---

## 4. Geodetic Datums

A datum is a reference system that defines the origin, scale, and orientation
of a coordinate frame with respect to the Earth. A horizontal datum defines
(latitude, longitude) zero; a vertical datum defines height zero.

### 4.1 WGS84 — The GNSS Default

WGS84 is maintained by the U.S. National Geospatial-Intelligence Agency (NGA).
GNSS receivers output positions in WGS84 by default. WGS84 has gone through
successive **realizations** as the reference frame was refined:

| Realization | Epoch | Notes |
|---|---|---|
| Original (1984) | 1984.0 | ±1–2 m absolute accuracy |
| G730 | 1994.0 | First GPS-only realization; ~10 cm rms/component |
| G873 | 1997.0 | |
| G1150 | 2001.0 | |
| G1674 | 2013.0 | |
| G1762 | 2013.0 | Aligned with ITRF2014; ~1 cm WGS84 ≈ ITRF2014 |
| G2139 | 2016.0 | Aligned with ITRF2014/IGb14 |
| G2296 | 2022.0 | Released January 2024; aligned with ITRF2020/IGS20 |

**Key implication**: a map built with G1150 CORS corrections and a
certification document referencing G2296 can disagree at the centimeter level
even though both are nominally "WGS84." The realization and epoch must be
recorded in map metadata.

### 4.2 ITRF

**ITRF** (International Terrestrial Reference Frame) is the most precise global
terrestrial reference frame, maintained by the IERS using ~500 globally
distributed geodetic stations (GNSS, VLBI, SLR, DORIS). Current realization:
**ITRF2020**, internally consistent at the millimeter level. WGS84(G1762) and
ITRF2014 are virtually identical when the same epoch is used. Precision GNSS
processing against CORS networks yields ITRF-quality positions, conventionally
labeled as WGS84.

### 4.3 ETRF / ETRS89

**ETRF** (European Terrestrial Reference Frame) is the ITRF realization fixed
to the stable Eurasian plate. ETRS89 is the system; realized as ETRF89 through
ETRF2020. For airside surveys in Europe, positions are legally mandated in
ETRS89 (EU directives). ETRF89 ≈ ITRF89 at epoch 1989.0; subsequent
realizations diverge as the plate moves relative to ITRF.

### 4.4 NAD83

**NAD83** (North American Datum 1983) is fixed to the North American tectonic
plate. It moves at 10–20 mm/year relative to ITRF/WGS84. The latest
realization NAD83(2011) differs from WGS84(G1762) by **up to 2 m** in
the continental US. For US airports, all aeronautical data must be published
in WGS84 per ICAO requirements, but local survey networks often use
NAD83 — explicit conversion is required.

### 4.5 GDA94 / GDA2020

**GDA94** was aligned with ITRF92 at epoch 1994.0. Australia's plate moves
~7 cm/year NE. By 2020, GDA94 positions had drifted **1.8 m** from ITRF.
**GDA2020**, aligned with ITRF2014 at epoch 2020.0, closes this gap. The two
datums differ by up to 1.8 m horizontally and ~9 cm vertically across
Australia. Any Australian airside LiDAR map must specify which datum was used.

### 4.6 Local Airport Survey Datums

ICAO mandates WGS84 for all aeronautical data publication. However, legacy
airport survey infrastructure may be tied to national geodetic networks
(NAD83, ETRS89, GDA2020) or pre-WGS84 local engineering datums used for
runway construction.

**Airside reality**: ICAO Annex 14 and Doc 9674 require airport coordinates to
be WGS84-referenced, achieved by a direct geodetic connection from the Airport
Reference Point (ARP) to a WGS84 monument. In practice, ARP coordinates are
known to ~10 cm; runway threshold and taxiway coordinates to ~1 m in older
surveys and ~10 cm in modern RTK surveys. A survey drive must establish its own
RTK solution tied to the airport's WGS84 control network rather than trusting
legacy GIS exports.

### 4.7 Datum Transformations

#### Helmert 7-Parameter (3D Similarity Transform)

Transforms ECEF coordinates between two datums:

```
[X]_B = [Tx]   +  (1 + s×10⁻⁶) * R  *  [X]_A
[Y]_B   [Ty]                            [Y]_A
[Z]_B   [Tz]                            [Z]_A

R  ≈  I  +  skew([Rx, Ry, Rz])

    = [  1    -Rz   Ry ]
      [  Rz    1   -Rx ]
      [ -Ry   Rx    1  ]
```

Parameters:
- `Tx, Ty, Tz`: translations in meters
- `Rx, Ry, Rz`: rotations in arc-seconds (convert to radians before applying)
- `s`: scale factor in parts per million (ppm)

**Sign-convention warning**: two conventions exist — position vector and
coordinate frame — and both are in widespread use. Applying the wrong
convention flips the sign of all three rotation parameters and corrupts the
result by up to several meters. Always check the sign convention documented
with the parameter set before applying.

#### 14-Parameter (Kinematic) Helmert

Adds seven rate-of-change parameters (Tx_dot, Ty_dot, Tz_dot, Rx_dot,
Ry_dot, Rz_dot, s_dot) to account for tectonic plate motion. Used for
ITRF2020 ↔ ETRF2020 or ITRF2020 ↔ NAD83 conversions at a specified epoch `t`:

```
P(t) = P_ref  +  P_dot * (t - t_ref)
```

For a 2024 survey, `t - t_ref` is typically 8–30 years, so the velocity terms
are not negligible: NAD83 accumulates 10–20 mm/year relative to ITRF.

#### NTv2 Grid Shift

A grid of tabulated (Δlat, Δlon) corrections on a regular geographic grid,
computed from dense survey network comparisons. Used for national datum
transformations (e.g., NAD27 → NAD83, OSGB36 → ETRS89). Accuracy:
- Dense grids in populated areas: sub-centimeter
- Sparse grids in remote areas: up to ~1 m
- Each grid cell carries its own accuracy estimate

PROJ and GDAL apply NTv2 grids automatically when available for a given
CRS pair; ensure the grid file is present and matches the correct national
version.

---

## 5. Coordinate Systems

### 5.1 ECEF (Earth-Centered Earth-Fixed)

Cartesian system with origin at Earth's center of mass. Z-axis points to the
North Pole (CTP). X-axis points toward the prime meridian / equator
intersection (Gulf of Guinea). Y-axis completes the right-handed system. Units:
meters. GNSS pseudorange computation and satellite orbit propagation are
performed natively in ECEF. ECEF rotates with the Earth.

**Numerical precision hazard**: Earth's radius is ~6.378 × 10⁶ m. Float32
(~7.2 significant digits) → precision floor **0.6 m** at ECEF magnitude;
centimeter differences are indistinguishable. Float64 (~15.9 significant digits)
→ ~8 significant digits survive after subtracting the ENU origin — adequate.

```
Rule: always compute in float64 ECEF. Subtract the ENU origin before
storing map-local coordinates (see §5.3). Never store raw ECEF in float32.
```

### 5.2 Geodetic Coordinates (LLA)

Latitude (φ), Longitude (λ), Ellipsoidal height (h). The geodetic latitude is
the angle between the ellipsoid normal at the surface point and the equatorial
plane — **not** the geocentric angle. At the equator and poles they coincide;
at 45° latitude they differ by about 12 arc-minutes.

#### LLA to ECEF (forward, exact)

```
N(φ) = a / sqrt(1 - e² * sin²(φ))    [radius of curvature in prime vertical]

X = (N + h) * cos(φ) * cos(λ)
Y = (N + h) * cos(φ) * sin(λ)
Z = ((1 - e²) * N + h) * sin(φ)
```

Using WGS84 values: `a = 6 378 137.0 m`, `e² = 6.694 379 990 14 × 10⁻³`.

#### ECEF to LLA (reverse, iterative — Bowring's method)

Longitude is direct:

```
λ = atan2(Y, X)
```

Latitude and height require iteration:

```
p = sqrt(X² + Y²)

Initial estimate:
  φ₀ = atan2(Z, (1 - e²) * p)     [sub-degree accuracy; good seed]

Iterate until |φᵢ - φᵢ₋₁| < ε  (ε ≈ 1e-12 rad for sub-micrometer accuracy):
  Nᵢ = a / sqrt(1 - e² * sin²(φᵢ₋₁))
  hᵢ = p / cos(φᵢ₋₁) - Nᵢ
  φᵢ = atan2(Z, p * (1 - e² * Nᵢ / (Nᵢ + hᵢ)))

Final height:
  h = p / cos(φ) - N
  [or h = Z / sin(φ) - N*(1 - e²) for near-polar points where cos(φ) → 0]
```

Convergence: typically 2–3 iterations to sub-micrometer accuracy. The seed
`φ₀ = atan2(Z, (1-e²)*p)` gives sub-degree accuracy sufficient to start.

### 5.3 Local Tangent Plane — ENU and NED

**ENU (East, North, Up)** is the standard for terrestrial robotics and
mapping. A right-handed frame tangent to the ellipsoid at a reference point
`P₀ = (φ₀, λ₀, h₀)`:

- E axis: tangent pointing East
- N axis: tangent pointing North (toward the geographic North Pole)
- U axis: normal to the ellipsoid pointing outward (Up)

**NED (North, East, Down)** is used in aerospace and most INS firmware
defaults: x north, y east, z down. Convert NED → ENU:
`x_enu = y_ned`, `y_enu = x_ned`, `z_enu = -z_ned`.

**ECEF → ENU conversion:**

Step 1: Compute ECEF coordinates of the ENU origin `P₀` using the LLA→ECEF
formula above.

Step 2: Form the rotation matrix from ECEF to ENU at origin `(φ₀, λ₀)`:

```
R_ecef2enu = [ -sin(λ₀)               cos(λ₀)              0       ]
             [ -sin(φ₀)*cos(λ₀)   -sin(φ₀)*sin(λ₀)    cos(φ₀)  ]
             [  cos(φ₀)*cos(λ₀)    cos(φ₀)*sin(λ₀)    sin(φ₀)  ]
```

Step 3: Apply translation then rotation:

```
ΔP_ecef = P_body_ecef - P₀_ecef    [subtraction MUST be in float64]

[E, N, U]ᵀ = R_ecef2enu · ΔP_ecef
```

**ENU → ECEF (inverse):**

```
P_body_ecef = P₀_ecef + R_ecef2enu^T · [E, N, U]ᵀ
```

`R_ecef2enu` is orthonormal, so its inverse equals its transpose.

**ROS convention**: REP-103 uses ENU for the `map` frame (x east, y north,
z up). NED frames are named with a `_ned` suffix. The rotation above produces
the standard ROS ENU orientation.

---

## 6. Map Projections

A map projection is a mathematical function from the curved ellipsoidal surface
to a flat plane. The Gauss-Tissot theorem states: **no map projection can
simultaneously preserve shape (conformal), area (equal-area), and distance
(equidistant).** Engineering selects the projection based on which error is
most tolerable.

### 6.1 Transverse Mercator (TM)

The base projection for UTM and local engineering grids. A cylinder tangent (or
secant) to the ellipsoid along a chosen central meridian. Properties:

- **Conformal** (angle-preserving): bearing measurements are correct.
- Scale distortion grows approximately as `k ≈ k₀ + (cos²φ / 2) * (λ - λ₀)²`
  — quadratic with distance from the central meridian.
- Snyder (USGS Professional Paper 1395, 1987) provides the full series
  expansion for (x, y) from (φ, λ).

### 6.2 UTM (Universal Transverse Mercator)

60 zones × 6° longitude each, covering 80°S – 84°N. Each zone uses a TM
projection with:

- **Central meridian**: zone center (e.g., Zone 32 → 9°E)
- **Scale factor at central meridian**: `k₀ = 0.9996` (−0.04% scale reduction
  keeps edge distortion below +0.04%)
- **False Easting**: 500 000 m (so all eastings within a zone are positive)
- **False Northing**: 0 m (Northern Hemisphere) or 10 000 000 m (Southern)
- **Maximum scale distortion within zone**: <1:2500 (0.04%)
- **Coordinate units**: meters

```
UTM zone from longitude:  zone = floor((λ_deg + 180) / 6) + 1
```

EPSG codes: `EPSG:326XX` (Northern Hemisphere) and `EPSG:327XX` (Southern
Hemisphere) where XX is the two-digit zone number (e.g., EPSG:32632 = Zone 32N).

For an airport spanning less than 50 km, UTM distortion is typically less than
5 cm/km — acceptable for mapping but not for highest-precision survey closure.
Use a local TM (§6.4) for sub-centimeter projection error.

### 6.3 State Plane and National Grids

**State Plane Coordinate System (SPCS, USA)**: zone-specific TM or Lambert
Conic Conformal; scale distortion <1:10 000. Must not be mixed with UTM
without explicit re-projection.

**UK National Grid (OSGB36)**: single TM covering Great Britain; origin at
49°N, 2°W; false origin −100 km E, 500 km N. National engineering standard;
datum is OSGB36, not WGS84. ETRS89 positions must be converted via the
OSTN15 NTv2 grid before using National Grid coordinates.

### 6.4 Web Mercator (EPSG:3857) — Visualization Only

Used by Google Maps, OpenStreetMap, and virtually all web tile services. Key
defects for engineering:

- **Treats Earth as a sphere, not an ellipsoid** — positional error grows with
  latitude.
- Northing error vs WGS84 World Mercator: up to **21 km on the ground** at
  high latitudes (43 km in the projected map).
- Scale error relative to true conformal Mercator: 0.7% at the equator; much
  larger at high latitudes.
- NGA has issued an advisory against using Web Mercator for defense and
  engineering applications.

```
EPSG:3857 is for visualization only.
NEVER use it as the aggregated map's coordinate frame or for any
metric distance computation.
```

### 6.5 Local Engineering Projection (Airport Frame)

For a single airport, the best practice is a **custom TM tangent to the
airport ARP**:

- Central meridian = ARP longitude
- Latitude of origin = ARP latitude
- Scale factor = 1.000 000 (no reduction needed; the airport fits within the
  ~0.01 ppm error zone)
- False E/N = (0, 0) or an offset to avoid negative coordinates

Projection distortion at distance `d` from origin:

```
relative distortion ≈ d² / (2 * a²) = (5000)² / (2 * (6.378e6)²) ≈ 6 × 10⁻⁷

At 5 km: absolute distortion ≈ 0.003 mm/m — sub-millimeter for any airport
```

This is the recommended world frame for the aggregated LiDAR map: ENU at the
ARP, implemented as a local TM projection with the ARP geodetic coordinates as
origin. Every scan pose is converted from RTK ECEF → ENU(ARP) at ingest.

---

## 7. Heights — Three Concepts

### 7.1 Height Types

| Type | Reference surface | Symbol | Source |
|---|---|---|---|
| Ellipsoidal | WGS84 ellipsoid | h | GNSS direct output |
| Orthometric | Geoid (mean sea level) | H | Spirit leveling or GNSS + geoid model |
| Normal | Quasi-geoid | H* | Used in some European national systems |

The fundamental relationship:

```
H = h - N      [N is geoid undulation from a geoid model]
```

GNSS outputs `h` directly. Runway elevations in ICAO AIP are orthometric `H`.
Storing both without metadata labels corrupts height comparisons by up to 100 m
where `|N|` is large.

### 7.2 Geoid Models

**EGM96**: NGA 1996 model; resolution 15' (~30 km); global RMS accuracy ~0.5 m;
now obsolete for precision work.

**EGM2008**: NGA 2008 model; resolution 2.5' (~5 km); global accuracy ~0.1–0.3 m;
standard for most current applications. RMS errors: ~17–30 cm in regions with
sparse terrestrial gravity data. Available as a global 2.5' grid from NGA.

**EGM2020**: NGA's higher-resolution successor model. As of early 2026, final
public release was in preparation. Expected improvements over EGM2008 in
South/East Asia and oceanic areas.

**National high-accuracy models** (preferred within their territories):
GEOID18 (USA), OSGM15 (UK), AUSGeoid2020 (Australia). These offer decimetre
accuracy in well-surveyed areas and should be used instead of global EGM models
when available.

### 7.3 Height Protocol for Airside Maps

1. GNSS survey drive yields ellipsoidal height `h` at each epoch.
2. Apply EGM2008 (or national geoid model) to get orthometric `H = h - N`.
3. The map world frame origin (ENU U axis) is the ellipsoidal Up at the ARP;
   ellipsoidal heights are stored in the map for computational convenience.
4. If certification requires orthometric heights (e.g., runway elevation in
   ICAO AIP), apply the geoid model at output time.
5. Record in map metadata: geoid model name, version, and epoch.

**Pitfall**: EGM96 vs EGM2008 differ by up to 1 m in some regions. If the
survey uses EGM2008 but the certification evidence quotes EGM96, orthometric
heights disagree.

---

## 8. GNSS-RTK and the Survey Anchor

### 8.1 GNSS Accuracy Hierarchy

| Method | Typical horizontal accuracy | Notes |
|---|---|---|
| Standalone (SPS/PVT) | 3–10 m | Consumer GPS, no augmentation |
| SBAS (WAAS/EGNOS) | 1–3 m | Broadcast ionospheric corrections |
| DGPS (code differential) | 0.3–1 m | Corrections from nearby base station |
| RTK (carrier phase, real-time) | **1–3 cm** | Fixed solution; baseline <20 km |
| PPK (carrier phase, post-processed) | **1–3 cm** | Same accuracy; latency acceptable |
| PPP (precise point positioning) | **3–5 cm** | Single receiver; ~30 min convergence |
| PPP-RTK / ambiguity-resolved PPP | **<1 cm** | Long observations required |

For airside survey drives, RTK Fixed (or PPK where RTK drops) is the target.
Float RTK (ambiguities not resolved as integers) gives only decimeter accuracy
and must be excluded from map-quality epochs.

### 8.2 RTK Architecture

**Base station** (known WGS84 position) broadcasts code and carrier-phase
observations at L1/L2/L5 for all visible satellites.

**Rover** (survey vehicle) computes: (1) double-difference observables
eliminating clock and ionospheric errors; (2) float ambiguity solution —
least-squares integer carrier-phase cycle counts as non-integers; (3) integer
ambiguity fix via LAMBDA — searches the integer vector minimizing the residual
within the ambiguity covariance ellipsoid; (4) **Fixed solution** — ambiguities
set to integers; carrier-phase noise ~5 mm → position accuracy **1–5 cm**.

**Float vs Fixed**: Float gives decimeter accuracy only. The ratio test (ratio
of second-best to best integer candidate residuals > 2–3) confirms the fix.
Log solution type per epoch; reject Float epochs from map aggregation.

**Baseline**: ionospheric de-correlation over baselines >20 km degrades
ambiguity resolution. Use a base station on airport property or a CORS
within 10–15 km.

### 8.3 Airside Survey-Drive Protocol

A production airside RTK survey drive:

1. Base station established over a WGS84-monumented point on airport property
   (tied to the ICAO-published ARP control network).
2. Rover initialized in a clear-sky area; wait for RTK Fixed (ratio > threshold,
   typically <60 s with multi-constellation GNSS).
3. Log raw GNSS observables and RTK solution simultaneously (for PPK backup in
   case of dropouts under jetways).
4. Drive all taxiways, runways, aprons, and stand areas at walking pace
   (<10 km/h) in overlapping lines.
5. At surveyed checkpoints, compare RTK position to known benchmark; required
   residual <5 cm.
6. Post-process dropout regions with PPK; apply corrected poses before map
   aggregation.
7. Report RTK Fixed percentage by driven distance in map metadata.

---

## 9. GNSS-INS / GNSS-IMU Integration

### 9.1 The Integration Problem

GNSS provides accurate absolute position at 1–10 Hz but drops out under
jetways and tunnels. IMU provides ~200 Hz relative pose but accumulates drift.
Their combination delivers the continuous pose stream required for LiDAR
deskewing and map aggregation.

### 9.2 Coupling Architectures

**Loosely coupled**: GNSS solver output (position + velocity) fused with IMU
in a Kalman filter. GNSS dropout is covered by IMU dead-reckoning; accuracy
limited by the GNSS solver's internal filter.

**Tightly coupled**: raw pseudorange and carrier-phase observables fed directly
into the navigation filter alongside IMU. Updates continue even with <4
satellites. **Standard for survey-grade LiDAR mapping.**

**Deeply coupled**: GNSS tracking loops use IMU aiding. Not yet standard in
commercial survey systems.

### 9.3 LIO + GNSS Pose-Graph Fusion

LiDAR-Inertial Odometry (LIO) provides high-rate relative pose with
sub-centimeter consistency over short distances. Fused with GNSS RTK, the
architecture is:

1. LIO propagates pose at scan rate; accumulated map is internally consistent
   (no sensor-rate GNSS noise).
2. GNSS RTK fixes provide absolute anchoring at ~5 Hz, injected as
   absolute-position constraints in a factor graph or pose-graph optimizer.
3. Loop closure detects overlap regions and tightens the graph globally.
4. The final trajectory is globally consistent to the WGS84 datum.

This produces the survey drive's **georeferenced trajectory** from which the
aggregated map is built by projecting all points into the ENU(ARP) world frame.

See [Coordinate Frames, Projections, and SE(3)](coordinate-frames-projections-se3.md)
§4 and §8 for the map/odom/base_link frame architecture and GNSS-RTK → ENU
setup that consumes this trajectory.

---

## 10. Local-Frame Conversions

### 10.1 The Standard Pipeline

```
GNSS raw observables
       |
       v
ECEF position (WGS84, float64)
       |
       v
ENU(ARP) = R_ecef2enu · (P_ecef - P_ARP_ecef)
       |
       v
Aggregated map coordinates (ENU meters, float64 origin, float32/64 offsets)
```

The ENU origin is the **Airport Reference Point (ARP)** — the geometric center
of the airport's usable movement area, as defined in the ICAO AIP. Its WGS84
(φ₀, λ₀, h₀) anchors the entire map frame.

### 10.2 Numerical Conditioning

ECEF coordinates near an airport are ~6.4 × 10⁶ m. A 1 m difference is
10⁻⁷ of the raw coordinate — below float32 resolution (§5.1). **Perform
ECEF → ENU subtraction in float64; store ENU offsets in float32 or float64
as required by the downstream consumer.**

### 10.3 ENU Frame Extent and Curvature Error

The ENU tangent-plane approximation accumulates curvature error with distance
from the origin:

```
curvature error ≈ d² / (2 * R_Earth)

At d = 5 km:  (5000)² / (2 × 6.378e6) ≈ 2 mm
At d = 50 km: (50000)² / (2 × 6.378e6) ≈ 0.2 m
```

For a single airport (<10 km extent), 2 mm curvature error is entirely
acceptable. For multi-airport networks, ECEF is preferable as the master frame;
each airport's ENU tile is a separate local projection with its ARP geodetic
coordinates as the transform to global.

---

## 11. CRS Tooling

### 11.1 EPSG Registry

EPSG (maintained by IOGP) assigns numeric codes to coordinate reference
systems, datums, and transformations:

| EPSG code | Definition |
|---|---|
| 4326 | WGS84 geographic 2D (latitude, longitude in degrees) |
| 4979 | WGS84 geographic 3D (latitude, longitude, ellipsoidal height) |
| 4978 | WGS84 geocentric ECEF (X, Y, Z in meters) |
| 326XX | WGS84 / UTM Zone XX North (e.g., 32632 = Zone 32N) |
| 327XX | WGS84 / UTM Zone XX South |
| 3857 | WGS84 / Pseudo-Mercator (Web Mercator — visualization only) |
| 4269 | NAD83 geographic 2D |
| 7844 | GDA2020 geographic 2D (Australia) |

**Axis order pitfall**: EPSG:4326 defines axis order as (latitude, longitude)
— the opposite of (longitude, latitude) / (x, y). Most GIS software and the
PROJ library enforce the EPSG axis order by default. Always use `always_xy=True`
in pyproj or explicitly specify axis order when reading/writing geographic data.

### 11.2 PROJ and pyproj

PROJ (formerly PROJ.4) is the canonical open-source coordinate transformation
library used by GDAL, QGIS, pyproj, and most geospatial software:

```python
from pyproj import Transformer, CRS

# WGS84 LLA → UTM Zone 32N
t = Transformer.from_crs("EPSG:4326", "EPSG:32632", always_xy=True)
easting, northing = t.transform(longitude_deg, latitude_deg)

# WGS84 LLA → ECEF (float64 inputs required)
t2 = Transformer.from_crs("EPSG:4326", "EPSG:4978", always_xy=True)
x, y, z = t2.transform(lon, lat, height_ellipsoidal)

# Custom local TM at ARP (lon0=9.0, lat0=53.5 degrees)
crs_local = CRS.from_proj4(
    "+proj=tmerc +lat_0=53.5 +lon_0=9.0 +k=1.0 +x_0=0 +y_0=0 +datum=WGS84 +units=m"
)
t3 = Transformer.from_crs("EPSG:4326", crs_local, always_xy=True)
e, n = t3.transform(longitude_deg, latitude_deg)
```

`always_xy=True` enforces (longitude, latitude) order regardless of EPSG axis
convention. Without it, EPSG:4326 passes (latitude, longitude) — a common
source of silently transposed coordinates.

### 11.3 GDAL and Point Clouds

GDAL's `gdaltransform` and `ogr2ogr` expose PROJ transformations for batch
conversion of LAS/LAZ point clouds. LAS 1.4 format includes a WKT-encoded CRS
record (VLR record type 2112). **Always write this field.** Omitting it makes
the point cloud's datum unrecoverable without external documentation — a
certification risk. The CRS VLR must record the full datum, realization, and
epoch, not just "WGS84."

---

## 12. Common Pitfalls

| Pitfall | Error magnitude | Diagnostic |
|---|---|---|
| Mixing datums without conversion (NAD83 vs WGS84) | 1–2 m in CONUS | Compare against surveyed control points in both CRSs |
| Wrong WGS84 realization (G1150 vs G2296) | Centimeters | Check CORS network realization; record realization in map metadata |
| Web Mercator (EPSG:3857) for engineering coordinates | Up to 21 km on the ground | Switch to EPSG:4978 → ENU(ARP) or UTM; never use EPSG:3857 for distances |
| Ellipsoidal height confused with orthometric height | Up to 100 m (geoid range) | Check geoid separation at site; label height type in all stored fields |
| Geoid model mismatch (EGM96 vs EGM2008) | Up to 1 m | Standardize on EGM2008 or national model; store model name in metadata |
| Float32 ECEF computation | 0.6 m precision floor | Use float64 for all ECEF arithmetic; subtract ENU origin first |
| Epoch mismatch in kinematic datums | Several cm in tectonically active regions | Record both realization and epoch; use 14-parameter Helmert with epoch |
| RTK Float accepted as Fixed | Decimeter-scale error | Log solution type per epoch; reject Float epochs from map aggregation |
| Wrong Helmert sign convention | Meters | Verify position-vector vs coordinate-frame convention in parameter set |
| Missing CRS metadata in LAS/LAZ file | Datum unrecoverable | Write VLR record type 2112 with WKT CRS string |
| Wrong ENU origin (ARP offset) | Up to ~distance × angular error | Use ICAO-published ARP; store ENU origin source in map metadata |
| EPSG:4326 axis order (lat, lon) vs (lon, lat) | Silent coordinate swap | Use `always_xy=True` in pyproj; test with a known point |

---

## 13. Implications for Aggregated-Map Segmentation

### 13.1 The Canonical Data Pipeline

```
Survey drive: RTK GNSS + IMU
       |
       v
Georeferenced trajectory (WGS84 ECEF, float64)
       |
       v
LIO pose graph + GNSS factor-graph anchoring → corrected trajectory
       |
       v
Per-scan point projection into ENU(ARP) world frame → aggregated map
       |
       v
Semantic segmentation → labels assigned in ENU(ARP)
       |
       v
Back-projection: labels → individual scan frames (ENU → sensor frame)
```

The world frame is the ENU local tangent plane at the ARP.
[Aggregated-Map Semantic Segmentation](../../30-autonomy-stack/perception/overview/aggregated-map-semantic-segmentation.md)
§1.1 defines this frame contract that the geodetic anchoring described on this
page must satisfy.

### 13.2 Map Metadata Requirements

Every aggregated map must carry:

| Metadata field | Example value | Why |
|---|---|---|
| Geodetic datum and realization | WGS84(G2296) / ITRF2020 | Identifies the realization; needed for Helmert transforms |
| Datum epoch | 2024.5 | Required for kinematic datums; centimeter corrections over time |
| ENU origin — ARP geodetic coordinates | φ₀=53.5°, λ₀=9.0°, h₀=25.3 m | Anchors the entire map frame |
| ENU origin source | ICAO AIP published; survey confirmed | Traceability chain for certification |
| Horizontal CRS | EPSG:4326 → local TM at ARP | Projection used; recoverable from parameters |
| Vertical datum | Ellipsoidal (WGS84) | Height convention explicitly declared |
| Geoid model | EGM2008 v1 | For orthometric conversion at output |
| Survey GNSS method | RTK Fixed (base: CORS station XY23) | Confirms accuracy tier |
| RTK Fixed % by distance | 98.3% | Completeness metric; residual Float flagged |
| Coordinate storage type | float64 ECEF origin + float32 ENU offsets | Precision chain documented |

### 13.3 Cross-Airport Map Portability

Two airports in different countries may use different national datums if legacy
data is involved. Correct merge procedure:

1. Transform all poses to WGS84(G2296)/ITRF2020 at the survey epoch using a
   14-parameter Helmert transform (velocity parameters account for plate motion
   during the observation period).
2. Each airport's ENU map is a separate tile; the tile's ARP geodetic
   coordinates provide the transform to the global ECEF frame.
3. Point cloud merging is then a chain: ENU(ARP_A) → ECEF → ENU(ARP_B),
   always in float64.
4. No naive coordinate concatenation — explicit transform at every step.

### 13.4 Per-Point Absolute Geodetic Recovery

Each point in the aggregated map has ENU(ARP) coordinates (E, N, U) in meters.
The corresponding WGS84 LLA is recoverable via:

```
P_ecef = P_ARP_ecef + R_ecef2enu^T · [E, N, U]^T

then apply ECEF → LLA (Bowring iteration, §5.2)
```

This is the **safety-case audit trail**: any labeled point can be located on
Earth to sub-meter absolute accuracy, enabling cross-reference with runway
charts, obstacle databases, and ICAO AIP data. It is also the mechanism for
verifying that a labeled "hold-short line" point is within the expected
geodetic corridor.

### 13.5 Segmentation Label Integrity Under Pose Corrections

Labels back-projected from the map to individual scan frames:

- Must carry the same ENU(ARP) world-frame provenance as the map.
- If the survey drive is re-processed with a corrected pose graph (e.g., PPK
  replaces RTK for a dropout region), **all labels derived from affected poses
  must be invalidated and re-assigned** — not merely shifted — because
  geometric correction changes which physical surface each return belongs to.
- The datum and epoch of the corrected trajectory must be logged in the label
  provenance record.
- A per-epoch solution-type flag (Fixed / Float / PPK / IMU-dead-reckoned)
  enables the segmentation pipeline to weight or exclude epochs by quality.

---

## 14. Algorithm Summary

### LLA → ECEF

```
N = a / sqrt(1 - e² * sin²(φ))
X = (N + h) * cos(φ) * cos(λ)
Y = (N + h) * cos(φ) * sin(λ)
Z = ((1 - e²) * N + h) * sin(φ)

a = 6378137.0 m,  e² = 6.694379990 14e-3
```

### ECEF → ENU at reference (φ₀, λ₀)

```
R = [ -sin(λ₀)              cos(λ₀)             0       ]
    [ -sin(φ₀)*cos(λ₀)  -sin(φ₀)*sin(λ₀)   cos(φ₀)  ]
    [  cos(φ₀)*cos(λ₀)   cos(φ₀)*sin(λ₀)   sin(φ₀)  ]

[E, N, U]^T = R · (P_ecef - P₀_ecef)        [float64]
P_ecef = P₀_ecef + R^T · [E, N, U]^T
```

### Height Conversion

```
H_orthometric = h_ellipsoidal - N_geoid
N_geoid from EGM2008 (or national model) at (φ, λ)
```

### Helmert 7-Parameter

```
X_B = T + (1 + s*1e-6) * R * X_A
T = [Tx, Ty, Tz]^T
R ≈ I + skew([Rx, Ry, Rz])   [check sign convention before applying]
s = scale in ppm
```

---

## 15. Implementation Notes

- Use PROJ, GeographicLib, or GDAL for all CRS work. Do not implement UTM or
  datum transforms ad hoc.
- Use float64 for all ECEF arithmetic. Convert to ENU-local float32 only after
  the origin subtraction. Keep ECEF and ENU types separate so a float32 downcast
  is a type error, not silent precision loss.
- Record axis order at every API boundary: EPSG:4326 is (lat, lon); use
  `always_xy=True` in pyproj. Label every stored height field (ellipsoidal vs
  orthometric).
- Avoid UTM across zone boundaries unless the tiling strategy re-projects
  explicitly.
- Write the CRS WKT to every LAS/LAZ VLR record type 2112 and every
  GeoJSON/GeoTIFF. A point cloud without this field has an unrecoverable datum.
- Use the ICAO-published ARP for the ENU origin. Record the source.
- Validate against surveyed control points after aggregation; required residual
  <5 cm for airside certification.

---

## 16. Failure Modes

| Symptom | Likely cause | Diagnostic |
|---|---|---|
| Entire map shifted 1–2 m | Datum realization mismatch (NAD83 vs WGS84) | Compare against surveyed control points in both CRSs |
| Map correct locally, wrong globally | Tectonic epoch ignored; GDA94 vs GDA2020 or NAD83 drift | Apply 14-parameter Helmert with plate velocity rates |
| Height wrong by tens of meters | Ellipsoidal height confused with orthometric | Check geoid undulation N at site; EGM2008 grid lookup |
| Height wrong by up to 1 m | EGM96 used instead of EGM2008 | Standardize geoid model; record name in metadata |
| East and north transposed | EPSG axis order (lat, lon) vs (lon, lat) swapped | Move a test point due east; only E coordinate should change |
| Map tears at tile or zone boundary | Different UTM zones, ENU origins, or offsets per tile | Convert a shared boundary point through both tile transforms |
| Duplicate structures near loop closure | RTK Float epochs included in map; `map→odom` jump not detected | Filter to Fixed-only epochs; add jump detector on map transform |
| Segmentation labels misassigned after pose correction | Labels not invalidated after PPK reprocessing | Track per-epoch solution type; invalidate labels from corrected poses |
| Helmert produces larger error than naive copy | Wrong sign convention on rotation parameters | Verify position-vector vs coordinate-frame convention in parameter set |
| Point cloud datum unrecoverable | No VLR CRS record in LAS file | Write WKT CRS to VLR record type 2112 at export time |
| Cross-airport map merge offset by meters | Different airports in different national datums, naively merged | Transform all maps to common datum/epoch before merging tiles |

---

## 17. Sources

- NGA WGS84 information and standardization documents: https://earth-info.nga.mil/GandG/wgs84/index.html
- WGS84 parameters and realizations (Wikipedia): https://en.wikipedia.org/wiki/World_Geodetic_System
- ESA Navipedia: Ellipsoidal and Cartesian Coordinates Conversion: https://gssc.esa.int/navipedia/index.php/Ellipsoidal_and_Cartesian_Coordinates_Conversion
- ESA Navipedia: Transformations between ECEF and ENU coordinates: https://gssc.esa.int/navipedia/index.php/Transformations_between_ECEF_and_ENU_coordinates
- ESA Navipedia: RTK Fundamentals: https://gssc.esa.int/navipedia/index.php/RTK_Fundamentals
- ESA Navipedia: Precise Point Positioning: https://gssc.esa.int/navipedia/index.php/Precise_Point_Positioning
- PROJ Helmert transform documentation: https://proj.org/en/stable/operations/transformations/helmert.html
- PROJ UTM projection: https://proj.org/en/stable/operations/projections/utm.html
- pyproj documentation: https://pyproj4.github.io/pyproj/stable/examples.html
- EPSG registry: https://epsg.io
- EPSG method 9602, geographic/geocentric conversions: https://epsg.io/9602-method
- IOGP/EPSG Guidance Note 7-2, coordinate conversions and transformations: https://docslib.org/doc/3972254/guidance-note-7-part-2
- Point One Nav: WGS84 vs NAD83 vs ITRF (realizations and datum offsets): https://pointonenav.com/news/wgs84-vs-nad83-vs-itrf-014/
- Point One Nav: RTK accuracy overview: https://pointonenav.com/news/drone-rtk/
- Geoscience Australia: GDA2020 datum description: https://www.ga.gov.au/scientific-topics/positioning-navigation/positioning-australia/geodesy/datums-projections/gda2020
- ICAO WGS-84 Implementation Manual (Eurocontrol, 1998): https://www.icao.int/sites/default/files/safety/pbn/External%20References/Eurocontrol-WGS-84-Implementation-Manual.pdf
- SKYbrary: WGS84 in aviation: https://skybrary.aero/articles/world-geodetic-system-1984-wgs84
- EPSG:3857 Web Mercator distortion notes: https://epsg.io/3857
- Esri: NGA Web Mercator advisory: https://www.esri.com/arcgis-blog/products/arcgis-solutions/defense/what-does-the-nga-web-mercator-advisory-mean-for-esri-defense-and-intelligence-users/
- Fixposition: ECEF to ENU conversion: https://docs.fixposition.com/fd/converting-from-ecef-to-enu-local-frame
- NTv2 grid shift files (Wikipedia): https://en.wikipedia.org/wiki/NTv2
- NGS: WGS84 and NAD83 relationship: https://www.ngs.noaa.gov/CORS/Articles/WGS84NAD83.pdf
- NOAA VDatum: datums tutorial: https://vdatum.noaa.gov/docs/datums.html
- GIS Geography: WGS84 overview: https://gisgeography.com/wgs84-world-geodetic-system/
- CEREGE sigeo: tectonic velocity and datum offsets: https://sigeo.cerege.fr/?p=467
- Tightly coupled GNSS/INS/LiDAR — Satellite Navigation journal: https://satellite-navigation.springeropen.com/articles/10.1186/s43020-021-00056-w
- GNSS/INS tightly coupled LiDAR mapping — ScienceDirect: https://www.sciencedirect.com/science/article/abs/pii/S0263224124003002
- EGM96 geoid undulation — NASA CDDIS: https://cddis.nasa.gov/926/egm96/doc/S11.HTML
- NOAA GNSS/EGM2008 accuracy study (PMC): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4721726/
- Snyder, J.P. (1987). Map Projections — A Working Manual. USGS Professional Paper 1395: https://pubs.usgs.gov/pp/1395/report.pdf
- UTM coordinate system (Wikipedia): https://en.wikipedia.org/wiki/Universal_Transverse_Mercator_coordinate_system
- GeographicLib documentation: https://geographiclib.sourceforge.io/
- ROS REP-103, coordinate conventions: https://www.ros.org/reps/rep-0103.html
- ROS REP-105, mobile platform frames: https://www.ros.org/reps/rep-0105.html
- ASAM OpenDRIVE 1.8.1 georeferencing: https://publications.pages.asam.net/standards/ASAM_OpenDRIVE/ASAM_OpenDRIVE_Specification/v1.8.1/specification/08_coordinate_systems/08_05_geo_referencing.html
