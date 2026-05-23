# ERASOR++

<!-- method-priority:start
priority:
  learning: 4
  deployment: 5
  type: "method"
  stage: "deployment-pattern"
  maturity: "pilot-proven"
  tags: ["slam", "mapping", "validation", "runtime-localization", "outdoor"]
  reason: "ERASOR++ is rated for dynamic-object filtering and map-cleaning workflows that protect localization maps."
method-priority:end -->

Related docs: [LiDAR Map Cleaning — Dynamic Removal](lidar-map-cleaning-dynamic-removal.md), [ERASOR](erasor.md), [FreeDOM](freedom-dynamic-object-removal.md), [MapCleaner](mapcleaner.md), [DR-Remover](dr-remover.md), [DO-Removal-LIO](do-removal-lio.md), [Moves and Label-Free Map Cleaning](moves-and-label-free-map-cleaning.md), [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md), [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md), [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md), [LiDAR Artifact Removal Techniques](../../perception/overview/lidar-artifact-removal-techniques.md).

**Last updated:** 2026-05-23

---

## What It Is

ERASOR++ is a training-free, geometry-only offline method for removing dynamic-object ghost trails from accumulated LiDAR point-cloud maps. It was published by **Jiabao Zhang and Yu Zhang (Zhejiang University)** as "ERASOR++: Height Coding Plus Egocentric Ratio Based Dynamic Object Removal for Static Point Cloud Mapping" at **ICRA 2024** (arXiv 2403.05019, IEEE DOI 10.1109/ICRA57147.2024.10610396).

ERASOR++ is the immediate successor to [ERASOR](erasor.md) (Lim et al., KAIST, RA-L 2021) in the egocentric pseudo-occupancy family, but it originates from a **different research group** (Zhejiang University, not KAIST). It retains ERASOR's core idea — comparing a current scan and an accumulated map inside egocentric polar bins — and replaces the single-scalar height-difference descriptor with a bit-coded height-layer encoding, enabling layer-by-layer comparison that resolves two structural failure modes of the original method.

**Critical authorship note.** ERASOR++ (Zhang & Zhang, Zhejiang University, ICRA 2024) must not be attributed to Lim et al. (KAIST), who authored the original ERASOR. It is also distinct from ERASOR2 (url-kaist, RSS 2023), which is a separate KAIST-lineage instance-aware successor. These three works are from different groups and represent different technical branches. The naming similarity creates a persistent disambiguation risk; see Variants and Lineage below.

**Key identifiers:**
- arXiv: https://arxiv.org/abs/2403.05019
- IEEE DOI: https://doi.org/10.1109/ICRA57147.2024.10610396
- No confirmed public repository as of 2026-05-23.

---

## Core Technical Idea

ERASOR's pseudo-occupancy descriptor (`Δh = max(z) − min(z)`) encodes each polar bin as a single scalar: the vertical height span of all points in that bin. The Scan Ratio Test (SRT) then flags a bin as dynamic if `Δh_scan / Δh_map < 0.2`. This approach is fast and largely effective, but ERASOR++ identifies two structural blind spots that the scalar representation cannot overcome.

**Blind spot A — small ghost trails inside tall bins.** If a map bin has a large vertical span (e.g., a tall roadside pole or signage structure), a small dynamic-object ghost trail at mid-height contributes little to `Δh_map`. The current scan, which lacks the ghost, still produces a near-1.0 ratio because the tall structure dominates both numerator and denominator. The SRT does not see the mid-height anomaly — it is drowned out by the dominant height span.

**Blind spot B — thin static structures near the SRT boundary.** Thin above-ground features (fence lines, poles, runway edge markers, vegetation stems) have a small but persistent `Δh^M`. When a dynamic object transiently occupies the same bin, `Δh^Q` drops close to zero, causing `scan_ratio < τ_SR` — the static structure is falsely flagged for removal. ERASOR explicitly acknowledged this in the Seq 01 vegetation case.

**The ERASOR++ fix: bitmask per layer.** Instead of a single scalar, ERASOR++ encodes each bin as a bitmask with one bit per height layer: bit `α` is set if any point in the bin falls in layer `α`. Comparing bitmasks is layer-by-layer. A ghost trail at a specific layer produces a missing bit in the query bitmask — visible regardless of tall dominant structure. A thin static feature at a specific layer produces a matching bit in both query and map bitmasks — preserved regardless of the ratio at column level.

The bitmask representation is not learned. It requires no training labels, no pre-trained weights, and no GPU. Construction is O(|bin|) per bin — the same computational order as computing `Δh`. The descriptor fits in a single 32-bit integer for up to 32 height layers.

---

## Operator Mechanics

ERASOR++ introduces four new components that collectively replace the R-POD + SRT step while retaining R-GPF for static-point recovery.

### Height Coding Descriptor (HCD)

The full descriptor for a bin is a two-field structure:

```
D_t^ij = { D_D^ij,  D_E^ij }
```

- `D_D^ij = max{z_k} - min{z_k}` for all points in the bin — identical to ERASOR's R-POD scalar; retained for compatibility.
- `D_E^ij` — the Height Encoding Descriptor: a bitmask where bit `alpha` is set if any point in the bin occupies height layer `alpha`.

Layer assignment for a point with height `z_p`:

```
alpha(p) = floor( (z_p - z_min) / Delta_z )    # clamped to [1, N_l]
```

Building the bitmask for a bin:

```
D_E^ij = 0
for each point p in bin B_ij:
    D_E^ij |= (1 << (alpha(p) - 1))
```

For `N_l = 16` or `32` layers, `D_E^ij` fits in a single 16-bit or 32-bit integer. Construction is one pass over the bin's points — O(|B_ij|), the same complexity as `Δh`.

### Ground Layer Test (GLT)

Before the bitmask comparison, the method must identify which layers contain ground returns. Ground-layer bits will agree between scan and map in every static bin (ground is static), so including them in the overlap count would inflate the overlap estimate and suppress dynamic-bin detection. GLT computes a per-ring ground-layer index `gamma` from point concentration:

```
For each ring i:
  For each bin in ring i:
    alpha_star = argmax over alpha of count(B_ij, layer alpha)
  If >= 75% of bins in ring i agree on the same alpha_star:
    gamma(i) = alpha_star

Layer(Ground) = (1 << gamma(i)) - 1    # bits 1..gamma(i) all set
```

The ground mask `Layer(Ground)` sets all bits at or below `gamma(i)`. These bits are excluded from the HST comparison via bitwise NOT.

**Operational effect.** GLT replaces the role of the absolute-z seed heuristic used in R-GPF to initialize ground fitting. It is more robust to z-axis odometry drift because it identifies ground from point concentration within each ring rather than from an absolute height threshold. GLT also reduces R-GPF invocations by 27–36% (see Benchmark Results), because bins already identified as ground-dominated by GLT need not undergo the full iterative PCA plane fit.

**Limitation.** The 75%-majority vote assumes that most bins in a ring share the same ground layer index. On sloped surfaces, ramps, or areas where multiple ground heights coexist within a single ring (airside apron ramps, taxiway shoulders), this assumption can fail. Validate per-ring GLT output on representative logs before deploying in sloped environments.

### Height Stack Test (HST)

HST is the core dynamic/static decision gate, replacing the SRT. It computes the bitwise overlap of scan and map height encodings, excluding ground layers:

```
H_t = (D_E^scan AND D_E^map) AND NOT(Layer(Ground))
overlap_count = popcount(H_t)

if overlap_count < threshold_hst:
    flag bin as DYNAMIC
```

- `D_E^scan` — HCD bitmask of the current scan's bin.
- `D_E^map` — HCD bitmask of the accumulated map's bin.
- `NOT(Layer(Ground))` — inverted ground mask; retains only above-ground layer bits.
- `popcount(H_t)` — number of above-ground layers where both scan and map have returns.

A low `popcount` means the scan and map share few above-ground occupied layers — the geometric signature of a ghost trail. The threshold `threshold_hst` is tuned empirically, analogously to ERASOR's `τ_SR = 0.2`.

**Why HST fixes Blind spot A.** A ghost trail at layer `alpha_g` in the map sets that bit in `D_E^map`. If the scan does not contain the ghost, bit `alpha_g` is clear in `D_E^scan`. The AND result clears `alpha_g` from `H_t`, reducing `popcount` — the ghost is detected regardless of the tall dominant structure in other layers.

**Why HST fixes Blind spot B.** A thin static structure at layer `alpha_s` sets bit `alpha_s` in both `D_E^scan` and `D_E^map`. The AND preserves that bit in `H_t`, increasing `popcount` and reducing the chance of over-flagging. The layer-specific evidence is not diluted by a column-level ratio.

### Surrounding Points Test (SPT)

After HST, some bins may be individually flagged as dynamic due to local sensor noise, momentary occlusion, or sub-meter pose jitter — isolated flags inconsistent with their neighborhood. SPT applies a 3×3 polar-grid neighborhood consistency check:

```
S_ij = { B_pq | (i - Range) <= p <= (i + Range),
                (j - Range) <= q <= (j + Range) }
```

Default `Range = 1` gives a 3×3 neighborhood (up to 8 adjacent bins).

**Logic.** If none of the neighboring bins in `S_ij` are also flagged as dynamic, the target bin is reclassified as static — the isolated flag is likely noise rather than a genuine ghost trail. If at least one neighbor is also flagged, the dynamic classification is confirmed.

**Effect.** SPT suppresses isolated false positives without requiring any learned spatial prior. It adds negligible overhead: one neighborhood lookup per flagged bin. The ablation study (see Benchmark Results) confirms that SPT contributes +1.4 pp PR on Seq 00 independently of the HCD/HST/GLT core.

---

## Inputs and Outputs

ERASOR++ uses the same input–output contract as ERASOR. No new data dependencies are introduced.

| Item | Role |
|---|---|
| Aggregated LiDAR point-cloud map | Raw accumulated map containing dynamic-object ghost trails; the main input to clean. |
| Per-scan ego-poses | GT or odometry poses used to align each scan and the map into a shared frame; pose quality is a hard dependency. |
| Raw LiDAR scan sequence | Individual per-scan point clouds providing the current-scan evidence for HST; the accumulated cloud alone is insufficient. |
| Volume-of-interest limits (`L_max`, `H_min`, `H_max`) | Define the cylindrical processing region per scan frame. |
| Ring / sector / layer parameters (`N_r`, `N_theta`, `N_l`, `Delta_z`) | Define egocentric polar bins and the vertical layer resolution for HCD. |
| HST threshold (`threshold_hst`) | Main sensitivity control; analogous to ERASOR's `tau_SR = 0.2`. |
| GLT majority threshold | Default 75%; controls per-ring ground-layer consensus. |
| SPT neighborhood range | Default `Range = 1` (3×3 neighborhood). |
| **Output: cleaned static map** | Accumulated map with dynamic-object ghost trails removed and ground points reverted; main output for localization or segmentation. |
| **Output: rejected dynamic points** | Complement of the cleaned map; retained for QA, audit, and map lifecycle management. |

---

## Pipeline Architecture

ERASOR++ keeps the same high-level removed-then-revert structure as ERASOR but replaces the R-POD + SRT step with HCD + GLT + HST + SPT. R-GPF is retained for static-point recovery.

```
Input: aggregated map M, scan sequence {S_t}, per-scan poses {T_t}

For each scan S_t:
  1. Transform S_t to map frame using T_t.
  2. Compute VoI for current ego-pose (L_max, H_min, H_max).
  3. Divide VoI into egocentric ring x sector bins.
  4. Build HCD for each bin: D_t^ij = { D_D^ij, D_E^ij }.
  5. Run GLT per ring: estimate ground layer gamma(i);
     compute Layer(Ground) = (1 << gamma(i)) - 1.
  6. Run HST per bin pair:
     H_t = (D_E^scan AND D_E^map) AND NOT(Layer(Ground))
     Flag bin as DYNAMIC if popcount(H_t) < threshold_hst.
  7. Run SPT: for each DYNAMIC-flagged bin,
     if no neighbors in 3x3 grid are also DYNAMIC, revert to STATIC.
  8. For STATIC-flagged bins, run R-GPF (3-iteration PCA plane fit)
     to recover ground points from bins that were not flagged.
  9. Mark non-ground points in DYNAMIC bins as rejected.

Output: cleaned static map M' = retained points + R-GPF ground reverts
        rejected cloud = complement of M' (for QA)
```

Component-level comparison with ERASOR:

| Stage | ERASOR | ERASOR++ |
|---|---|---|
| Spatial partition | VoI → ring × sector bins | Same |
| Per-bin descriptor | R-POD: `Δh` scalar | HCD: `{D_D, D_E}` (scalar + bitmask) |
| Ground identification | Absolute-z seed in R-GPF | GLT (per-ring 75%-majority) + R-GPF retained |
| Dynamic test | SRT: `Δh_scan / Δh_map < 0.2` | HST: `popcount(D_E_scan AND D_E_map AND NOT(Ground)) < threshold` |
| Post-processing | None | SPT: 3×3 neighborhood consistency revert |
| Static-point recovery | R-GPF revert | R-GPF revert (retained, same step) |

**No learned parameters.** All thresholds are geometric and empirically tuned. ERASOR++ requires no training data, no neural network weights, and no GPU.

---

## Training-Free Nature

ERASOR++ has zero learned components. Every step is deterministic geometry:

- No neural-network weights.
- No training data or semantic class labels required or produced.
- No per-object detection or tracking.
- No pre-trained feature extractor.

**Strengths of the training-free design:**
- Works immediately on any new domain (airside, warehouse, port, mining, agriculture) without retraining or labeled data.
- Fully explainable: every removal decision traces to a specific bin's `popcount(H_t)` value and the GLT/SPT decisions that framed it.
- No domain transfer issues: the same parameter structure that works on SemanticKITTI road sequences applies to airside apron data with only VoI height and layer-resolution adjustments.

**Limits of the training-free design:**
- Cannot leverage class identity. A parked aircraft and a permanent terminal wall receive identical treatment if their bitmask patterns are similar.
- Cannot reason about motion history. A slowly-moving object whose ghost trail accumulates gradually will have a `popcount` that only gradually falls below `threshold_hst`.
- Semantic-class-agnostic: all object types receive identical geometric treatment.

---

## Benchmark Results

### Dataset and Metrics

**Dataset:** SemanticKITTI sequences 00, 01, 02, 05, 07 (outdoor urban driving; Velodyne HDL-64E).
**Hardware:** 2.2 GHz CPU, 16 GB RAM, Ubuntu 18.04, ROS.
**Metrics (voxel 0.2 m resolution):**

```
PR (Preservation Rate) = |retained static points| / |all true static points|
RR (Rejection Rate)    = |removed dynamic points| / |all true dynamic points|
F1 = 2 * PR * RR / (PR + RR)
```

PR measures how well static structure is preserved (higher = fewer false removals). RR measures how well dynamic ghost trails are removed. F1 is the harmonic mean.

### Main Results: ERASOR vs. ERASOR++ (Table I, arXiv 2403.05019)

| Seq | Method | PR (%) | RR (%) | F1 | Time (s) |
|---|---|---|---|---|---|
| 00 | ERASOR | 92.15 | 97.21 | 0.946 | 0.125 |
| 00 | ERASOR++ | **96.83** | 96.10 | **0.965** | 0.125 |
| 01 | ERASOR | 91.90 | 94.56 | 0.932 | 0.132 |
| 01 | ERASOR++ | **98.99** | 93.64 | **0.962** | 0.137 |
| 02 | ERASOR | 80.90 | 99.20 | 0.891 | 0.161 |
| 02 | ERASOR++ | **87.89** | 98.90 | **0.931** | 0.136 |
| 05 | ERASOR | 86.96 | 97.92 | 0.921 | 0.122 |
| 05 | ERASOR++ | **96.53** | 97.67 | **0.971** | 0.100 |
| 07 | ERASOR | 93.48 | 98.89 | 0.961 | 0.091 |
| 07 | ERASOR++ | **98.58** | 98.65 | **0.986** | 0.101 |

**Summary of gains:** ERASOR++ improves PR by +4–8 pp across all five sequences and F1 by +0.019–0.050 (approximately +2 to +5 pp). Sequence 02 shows the largest absolute gain (+7.0 pp PR, +4.0 pp F1). Sequence 07 achieves the highest absolute F1 (0.986). Sequence 01, where ERASOR was known to struggle with highway vegetation, shows the largest PR gain (+7.1 pp). Runtime remains in the same 0.10–0.14 s range — ERASOR++ is not slower than ERASOR in practice and is faster on Seq 05 (0.100 vs. 0.122 s).

Note: ERASOR was re-run under the ERASOR++ evaluation harness; minor differences from the original ERASOR paper numbers (e.g., seq 00 PR 93.98% in the original vs. 92.15% in the ERASOR++ baseline column) reflect re-run variation. The relative improvement is the meaningful comparison.

### R-GPF Reduction from GLT (Table II, arXiv 2403.05019)

Because GLT pre-identifies ground layers per ring, R-GPF is invoked on fewer bins:

| Sequence | ERASOR R-GPF invocations | ERASOR++ R-GPF invocations | Reduction |
|---|---|---|---|
| Seq 05 | 577.9 | 368.9 | ~36% |
| Seq 07 | 531.6 | 390.1 | ~27% |

This is the primary reason Seq 05 runtime decreases despite the added HCD/HST computation: 36% fewer R-GPF calls offset the bitmask overhead.

### Ablation Study (Table I, Seq 00)

| Configuration | PR (%) | F1 |
|---|---|---|
| ERASOR (baseline) | 92.15 | 0.946 |
| ERASOR++ without HCD/GLT/HST (variant A–C) | 95.83 | 0.959 |
| ERASOR++ without SPT (variant D) | 93.57 | 0.952 |
| ERASOR++ (full) | **96.83** | **0.965** |

Each component contributes independently. The HCD/HST/GLT core delivers the larger PR gain (+3.7 pp over ERASOR in the variant-D row); SPT contributes a further +1.4 pp PR by catching isolated noise-driven false positives.

### Cross-Paper Approximate Comparison (Seq 00)

The ERASOR++ paper's primary quantitative comparison is ERASOR vs. ERASOR++. Cross-paper numbers from MapCleaner and the KTH DynamicMap Benchmark literature use the same SemanticKITTI dataset and voxel size but were not produced in a single unified experimental run:

| Method | PR (%) | F1 | Note |
|---|---|---|---|
| Peopleremover | 37.52 | 0.528 | From ERASOR original paper |
| OctoMap | 76.73 | 0.865 | From ERASOR original paper |
| Removert | 85.50 | 0.919 | From ERASOR original paper |
| ERASOR | ~93.98 | ~0.955 | Original paper; ~92.15 in ERASOR++ harness |
| ERASOR++ | ~96.83 | ~0.965 | ERASOR++ paper |
| MapCleaner | ~98.89 | ~0.985 | From MapCleaner paper |

ERASOR++ sits above ERASOR and Removert but below MapCleaner on Seq 00 PR. This ranking is approximate and cross-paper; do not present it as a single controlled experiment.

**FreeDOM (RA-L 2025, arXiv 2504.11073) does NOT benchmark against ERASOR++.** FreeDOM's Table I compares OctoMap, DUFOMap, Removert, ERASOR, and BeautyMap on Seq 02 and Seq 07. Any claim that FreeDOM was benchmarked against ERASOR++ is inaccurate. See [FreeDOM](freedom-dynamic-object-removal.md) and [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md).

---

## Variants and Lineage

### Chronological Lineage

```
Removert (IROS 2020, Kim & Kim, SNU/KAIST)
  — ray-casting visibility check; "removed-then-revert" pipeline coined here
    |
    v
ERASOR (RA-L 2021 / ICRA 2021, Lim et al., KAIST)
  — pseudo-occupancy scalar descriptor (R-POD), SRT, R-GPF revert
    |
    +--- ERASOR2 (RSS 2023, url-kaist, KAIST)
    |      — instance-aware; uses 3D instance segmentation + motion history
    |      — separate KAIST-lineage branch; not in direct improvement chain vs. ERASOR++
    |
    +--- ERASOR++ (ICRA 2024, Zhang & Zhang, Zhejiang University)
           — height coding bitmask, HST/GLT/SPT; this page
           — different research group; geometry-only branch
             |
             v
           FreeDOM (RA-L 2025, HITSZ)
             — conservative free-space + ray-cast enhancement
             — does NOT benchmark against ERASOR++
```

### Disambiguation: ERASOR, ERASOR++, and ERASOR2

These three methods share a naming prefix but are from different groups and represent different technical directions:

| Property | ERASOR | ERASOR++ | ERASOR2 |
|---|---|---|---|
| Authors | Lim et al. | Zhang & Zhang | url-kaist (KAIST) |
| Institution | KAIST | Zhejiang University | KAIST |
| Venue | RA-L 2021 / ICRA 2021 | ICRA 2024 | RSS 2023 |
| Mechanism | Scalar R-POD + SRT | Bitmask HCD + HST/GLT/SPT | Instance segmentation + motion history |
| Training-free | Yes | Yes | No (uses detector) |
| arXiv | 2103.04316 | 2403.05019 | — |
| Repository | github.com/LimHyungTae/ERASOR | Not confirmed (May 2026) | erasor2.github.io |

The ERASOR GitHub README (LimHyungTae/ERASOR) recommends ERASOR2 as the successor, not ERASOR++. This is because ERASOR2 is the direct KAIST follow-on. ERASOR++ is an independent improvement from a different group that stays in the training-free geometry-only branch.

**Naming overlap risk.** In any document or slide that mentions all three, the full attribution ("ERASOR++ by Zhang & Zhang, Zhejiang University, ICRA 2024") must be stated explicitly. Shorthand like "ERASOR++" is sufficient only after the first full attribution on that page.

### Pseudo-Occupancy Family

ERASOR and ERASOR++ share the core assumption: dynamic objects leave vertical traces in accumulated maps that the current scan cannot reproduce. The pseudo-occupancy metric — whether it is a height span or a bitmask — is the common currency. Methods outside this family use fundamentally different evidence: ray-casting (Removert, FreeDOM), Bayesian voxel (OctoMap), or instance segmentation (ERASOR2).

---

## Strengths

### Retained from ERASOR

- **Training-free.** No labels, no pre-trained model, no GPU required. Works immediately on any new domain.
- **Fast.** O(bins) per scan; deterministic; 0.10–0.14 s on CPU for SemanticKITTI-scale scenes. Comparable to ERASOR, faster on dense sequences.
- **No semantic dependency.** Works regardless of object class, enabling generalization across domains.
- **Visibility-free.** Does not require ray traversal, avoiding incidence-angle sensitivity.
- **Offline post-processing.** Compatible with any prior mapping pipeline output; no changes to SLAM or trajectory estimation required.
- **Explainable.** Every removal decision traces to a specific bin's HST `popcount` and the GLT/SPT decisions. No black-box behavior.

### New in ERASOR++

- **Better thin-structure preservation.** HST is layer-by-layer rather than column-averaged, so a thin pole, fence line, or runway edge marker that occupies a specific layer set is preserved even inside a tall bin where the scalar ratio would fail.
- **Fewer ground-point false positives.** GLT pre-identifies ground layers per ring and masks them from HST, preventing ground returns from generating spurious bin-level disagreement near terrain contact.
- **Fewer isolated mislabels.** SPT's 3×3 neighborhood smoothing catches isolated dynamic detections caused by pose jitter, sensor dropouts, or momentary occlusion — without adding meaningful computational overhead.
- **Reduced R-GPF overhead.** GLT replaces some R-GPF work, giving a 27–36% reduction in R-GPF invocations and a measurable speedup on dense sequences (Seq 05: −22 ms/frame).
- **Improved PR without sacrificing RR.** Across all five tested sequences, RR is maintained or only marginally reduced (e.g., Seq 00: 97.21% → 96.10%) while PR gains +4–8 pp. The trade-off slightly favors static preservation over dynamic rejection — the correct direction for map quality in localization-serving pipelines.

---

## Failure Modes

### Inherited from ERASOR

- **Polar partition assumption.** Both methods are ego-centric; bins are centered on the sensor origin. Multi-session maps accumulated from different origins require reprojection into a common ego-centric frame before processing.

- **Static-but-transient problem.** Parked vehicles, staged aircraft, and construction equipment that are present throughout the mapping window but later removed appear static to any scan-ratio-based method. ERASOR++ does not solve this — it has no access to motion history or semantic class identity. See [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md) for the dedicated treatment.

- **Pose quality dependence.** Sub-bin pose errors cause bin-level disagreement independent of dynamic content. Binning resolution must be coarser than the expected pose error. The GTL ground-layer identification is also pose-dependent.

- **VoI height range sensitivity.** The `[H_min, H_max]` window must be tuned to include all relevant structure. Overhead obstructions (jet bridges at airside, warehouse mezzanines, crane structures at ports) require raising `H_max` beyond the road-vehicle default of 3.0 m.

- **Dense static objects.** If a large static object is present in every scan frame during the mapping run, its bins will always agree across scan and map — no test will flag them. This is a fundamental geometric limit.

- **Slow-moving objects.** Objects moving at <1 m/s accumulate ghost trails that spatially overlap with current-scan observations. Both scan and map have similar occupancy; the bitmask AND may show high `popcount` despite the object being movable.

### Specific to ERASOR++

- **Layer quantization sensitivity.** The bitmask resolution depends on `Delta_z` and `N_l`. Too coarse (large `Delta_z`): layer resolution is insufficient to distinguish ghost trail from static structure; mid-height anomalies are hidden in the same layer as the dominant feature. Too fine (small `Delta_z`): sparse returns from far-range bins leave many layers empty even in genuinely static bins, producing artificially low `popcount` — false positives.

- **GLT reliability in uneven terrain.** The 75%-majority-vote ground confirmation assumes most bins in a ring share the same ground layer index. On sloped surfaces, ramps, or areas where multiple ground heights coexist in a single ring (airside ramp approaches, taxiway shoulder transitions), this assumption can fail — producing a ground mask that either over-masks or under-masks actual ground layers.

- **No public reference implementation.** As of 2026-05-23, no open-source ERASOR++ code has been identified. The ERASOR GitHub (LimHyungTae/ERASOR) does not include ERASOR++ code. Integration requires re-implementing from arXiv 2403.05019, which introduces reproduction risk and development overhead.

- **Limited comparison scope in the paper.** The published benchmark compares ERASOR++ only against ERASOR. Cross-comparison against Removert, MapCleaner, DUFOMap, FreeDOM, and BeautyMap in a unified experimental setup has not been performed by the authors. Rankings against methods outside the ERASOR family are approximate and cross-paper.

---

## Domain Fit

| Domain | Fit | Notes |
|---|---|---|
| Road AV — outdoor urban | Strong | Designed for outdoor LiDAR map cleaning; bitmask encoding is particularly effective around mixed-height urban objects. |
| Road AV — highway | Strong | Open road, fast-moving vehicles; both ERASOR and ERASOR++ perform well; ERASOR++ adds value in vegetation-heavy corridors (Seq 01 proxy). |
| Airside — taxiing aircraft and active GSE | Strong | Large, fast-enough movers; bitmask HST cleanly flags their ghost trails. Raise `H_max` to 4.5–5.0 m; tune `Delta_z` for aircraft gear height. |
| Airside — parked aircraft / staged GSE | Not suitable | Static-but-transient; ERASOR++ cannot distinguish parked aircraft from permanent infrastructure. Use ERASOR2 or a quarantine layer. |
| Airside — open apron survey | Promising | Height coding is attractive around aircraft, buses, and GSE with complex vertical structure. Validate GLT per-ring behavior near ramps and curbs. |
| Airside — jet bridges and elevated structures | Caution | Structures above default `H_max`; must raise `H_max` and confirm `N_l` / `Delta_z` covers the relevant height range. |
| Indoor warehouses | Moderate | Flat floor assumption holds; tune layer parameters for shorter-range scanners; validate GLT on racking and mezzanine environments. |
| Indoor multi-level | Weak | Multi-floor bins degrade all bin-based methods; GLT particularly unreliable where ground layer varies with range. |
| Mining / construction | Conditional | Large moving machinery produces strong ghost trails (good RR); irregular terrain degrades GLT (moderate PR risk). |
| Port / logistics yard | Conditional | Flat apron areas suitable; complex crane and container-stack geometry challenges thin-structure preservation. |
| Agriculture / outdoor vegetation | Moderate improvement over ERASOR | Paper targets vegetation failures; gains on Seq 01 confirm improvement, but wind-driven vegetation variability remains a residual challenge. |

---

## Aggregated-Map Suitability and Role in the §9.1 Prerequisite Chain

ERASOR++ is a drop-in upgrade for ERASOR in the §9.1 segmentation prerequisite chain. The canonical ordering is:

```
Accumulate → ERASOR++ (clean) → Segment → Auto-label
```

This ordering is non-optional for aggregated-map segmentation pipelines: ghost trails carry vehicle and pedestrian geometry that segmentation models assign to incorrect classes, and auto-labels back-projected from a dirty map propagate erroneous labels into every downstream training set. See [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) §9.1 and [LiDAR Map Cleaning — Dynamic Removal](lidar-map-cleaning-dynamic-removal.md).

**Where ERASOR++ helps the segmenter over ERASOR:**

- Lower over-removal of thin static structures (poles, fence lines, airside runway markings, stand equipment uprights) means the downstream segmenter sees more complete geometry. ERASOR's column-averaged ratio would erase these structures in bins where a dynamic object transiently passed; ERASOR++'s layer-specific bitmask preserves the above-ground bits.
- Fewer isolated false-positive removals from SPT means small but real structural elements (curb faces, runway edge markers, dock stops) are less likely to be absent from the cleaned map — fewer "gaps" that confuse semantic segmentation and depth completion.
- GLT-masked ground means ground-adjacent structure (surface markings, low-profile obstacles) is less likely to be incorrectly swept into the ground-removal step.

**Residual limitations for airside use:**

- The 75%-majority GLT will struggle on apron ramps and sloped taxiway exits. Validate per-ring ground detection on representative airside logs before deploying.
- Static-but-transient objects (parked aircraft during the mapping window, staged GSE) remain a fundamental gap — ERASOR++ does not solve this. The gap is documented in [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md).
- Without a public implementation, the reproduction burden is higher than for ERASOR. Custom implementation from arXiv 2403.05019 is required and should be validated against the paper's Table I results before airside deployment.

**Recommended integration path:**

1. Reproduce ERASOR++ on SemanticKITTI Seq 00 and Seq 02 to verify implementation matches Table I numbers within acceptable tolerance.
2. Run ERASOR and ERASOR++ side by side on representative airside logs; measure PR/RR and static erosion around poles, markings, and fence lines.
3. Tune `Delta_z`, `N_l`, GLT majority threshold, and `threshold_hst` using airside ground-truth annotations or manual inspection of the rejected-points cloud.
4. Cross-link [ERASOR](erasor.md) as the predecessor; note that ERASOR2 (KAIST, instance-aware) is a separate fork, not in this geometry-only chain.

---

## Implementation Notes

- **No public repository confirmed.** As of 2026-05-23, no open-source ERASOR++ code is available. The ERASOR GitHub (LimHyungTae/ERASOR) does not include ERASOR++ code. Its README directs users to ERASOR2, which is the KAIST-lineage successor, not ERASOR++. Plan for a custom implementation effort from arXiv 2403.05019.

- **Start from the ERASOR codebase.** The HCD replaces R-POD; the HST replaces SRT; R-GPF is retained. This surgical replacement strategy limits implementation risk: the outer loop, VoI definition, bin structure, and output format are unchanged.

- **Layer resolution is the primary tuning lever.** Set `Delta_z` and `N_l` first. For SemanticKITTI-style urban scenes, `N_l = 16` layers over a 3 m VoI height gives `Delta_z = 0.1875 m` — sufficient to separate ground, vehicle body, and vehicle roof. For airside with `H_max = 5 m`, `N_l = 32` layers gives `Delta_z ≈ 0.19 m`.

- **Validate GLT before deploying on sloped terrain.** Log per-ring `gamma(i)` values and the fraction of bins agreeing on the majority layer for each ring. If the agreement rate is below 75% for significant fractions of the map, the GLT output is unreliable on those rings. Consider falling back to the ERASOR absolute-z seed for R-GPF initialization on those rings.

- **Inspect the rejected-points cloud for static erosion.** Run a visual diff of the ERASOR and ERASOR++ rejected clouds on the same input. ERASOR++ should reject fewer static-structure points. If it rejects more, the layer resolution or `threshold_hst` is misconfigured.

- **Version parameters alongside the map artifact.** `N_l`, `Delta_z`, `threshold_hst`, `L_max`, `H_min`, `H_max`, GLT majority threshold, and SPT range are all map-version parameters. Downstream localization and segmentation systems must know the exact configuration that produced the map they depend on.

- **Multi-session strategy.** ERASOR++ processes one query-scan-vs-map pair per iteration, like ERASOR. For multi-session surveys, run ERASOR++ separately per session or accumulate all sessions into a single map before cleaning. The multi-session path produces stronger ghost-trail elimination for short-occupancy objects but is dominated by objects present in most sessions (static-but-transient case).

- **Use rejected points as a review layer.** Do not promote cleaned maps to production without inspecting the rejected cloud for unexpected static erosion around localization anchors (poles, road edges, building walls, runway markings).

- **Compare against ERASOR as the minimum baseline.** Before adopting ERASOR++ as the default cleaner, confirm the PR improvement on target domain data. If the implementation cannot reproduce the +4–8 pp PR gain from Table I, the implementation has an error.

---

## Sources

- ERASOR++ arXiv: https://arxiv.org/abs/2403.05019
- ERASOR++ HTML: https://arxiv.org/html/2403.05019v1
- ERASOR++ IEEE Xplore: https://ieeexplore.ieee.org/document/10610396/
- ERASOR++ DOI: https://doi.org/10.1109/ICRA57147.2024.10610396
- ERASOR arXiv: https://arxiv.org/abs/2103.04316
- ERASOR GitHub: https://github.com/LimHyungTae/ERASOR
- ERASOR2 project: https://erasor2.github.io/
- ERASOR2 GitHub: https://github.com/url-kaist/ERASOR2
- FreeDOM arXiv: https://arxiv.org/abs/2504.11073 (does not benchmark ERASOR++)
- MapCleaner paper: https://www.mdpi.com/2072-4292/14/18/4496
- KTH DynamicMap Benchmark: https://arxiv.org/abs/2307.07260
- Related method page: [ERASOR](erasor.md) — predecessor; deepened iter 19
- Related method page: [FreeDOM](freedom-dynamic-object-removal.md) — conservative free-space successor; not benchmarked vs. ERASOR++
- Related method page: [MapCleaner](mapcleaner.md) — terrain-first high-PR alternative
- Related method page: [DR-Remover](dr-remover.md) — terrain-first successor
- Related method page: [DO-Removal-LIO](do-removal-lio.md) — online dynamic-object removal
- Related method page: [Moves and Label-Free Map Cleaning](moves-and-label-free-map-cleaning.md)
- Related method page: [LiDAR Map Cleaning — Dynamic Removal](lidar-map-cleaning-dynamic-removal.md) — family overview; deepened iter 5
- Related method page: [Dynamic Map Cleaning Benchmarks](dynamic-map-cleaning-benchmarks.md) — cross-method evaluation; deepened iter 21
- Related overview page: [Static-but-Transient Point Removal](../../perception/overview/static-but-transient-point-removal.md) — fundamental gap ERASOR++ does not solve; iter 19
- Related overview page: [Aggregated-Map Semantic Segmentation](../../perception/overview/aggregated-map-semantic-segmentation.md) — §9.1 prerequisite chain
- Related overview page: [LiDAR Artifact Removal Techniques](../../perception/overview/lidar-artifact-removal-techniques.md)
