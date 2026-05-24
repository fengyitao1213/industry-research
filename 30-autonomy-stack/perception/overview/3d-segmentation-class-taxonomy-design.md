# Semantic Class Taxonomy Design for 3D / LiDAR Segmentation

**Last updated:** 2026-05-24

This page is the deep-dive companion to §6 (Class Taxonomies) of the [Aggregated-Map Semantic Segmentation](aggregated-map-semantic-segmentation.md) hub page. It covers the full range of design decisions that determine what a 3D LiDAR segmentation taxonomy contains and why — from the stuff/things dichotomy and granularity trade-offs through cross-dataset harmonization, safety-criticality weighting, and open-set handling — culminating in a proposed 14-class airside aggregated-map taxonomy. Readers wanting single-scan taxonomy considerations in the context of runtime perception should also consult [LiDAR Semantic Segmentation](lidar-semantic-segmentation.md) §8.

---

## Why Taxonomy Design Matters

The taxonomy is the first and most consequential design decision in any segmentation system: it defines what the model can and cannot perceive, how annotation cost scales, what safety guarantees are expressible, and whether labels transfer across datasets or domains. Getting it wrong upstream propagates errors that no amount of architecture tuning can fully correct.

| Design choice | Effect on the system | Risk if wrong |
|---|---|---|
| Class granularity (N classes) | Directly determines annotation cost, mean IoU magnitude, and rare-class coverage | Too coarse → safety-critical distinctions lost; too fine → rare tail classes starved of training data and annotation quality degrades |
| Stuff vs things split | Determines whether instance IDs are generated; drives panoptic vs semantic task choice | Treating dynamic things as stuff hides instance identity; treating vast ground surfaces as countable things wastes annotation budget |
| Moving vs static distinction | Governs whether temporal labels are required; determines map contamination risk | Omitting the moving label forces dynamic actors into static map taxonomy, corrupting map geometry |
| Void / ignore design | Controls what is excluded from mIoU and from training loss | Poorly defined ignore labels leak noisy supervision signal; no ignore class forces annotators to assign wrong labels to ambiguous points |
| Safety-critical class resolution | Whether vulnerable road users and obstacles have dedicated fine-grained classes | Merging pedestrian into "dynamic object" destroys the highest-consequence category distinction |
| Cross-dataset alignment | Whether shared label spaces preserve semantics across datasets | Naive union training causes negative transfer; mismatched "road" definitions corrupt shared model parameters |
| Open-set handling | Whether novel objects produce a detection signal at all | Closed taxonomy with no unknown class means novel obstacles receive confident wrong labels silently |

---

## Stuff vs Things

The stuff/things dichotomy originates in panoptic segmentation theory (Kirillov et al., CVPR 2019) and governs the full task hierarchy.

**Things** are countable, individually-instanced objects with well-defined spatial extent: vehicles, pedestrians, cyclists, cones, bollards. Each instance is distinct and can be enumerated with a unique ID. **Stuff** (amorphous or uncountable classes) denotes regions of homogeneous material or surface type that do not admit individual counting: road, pavement, terrain, vegetation, building facade. Stuff receives a class label; things receive both a class label and a unique instance ID.

The three task variants that follow from this split:

- **Semantic segmentation** assigns every point a class label — valid for both stuff and things, but produces no instance IDs. The standard task for map annotation.
- **Instance segmentation** identifies individual object instances — only meaningful for things; not valid for stuff.
- **Panoptic segmentation** combines both: class labels for all points plus unique instance IDs for things. Stuff points receive class label but no instance ID.

In outdoor LiDAR benchmarks, representative **things** classes include: car, truck, bus, person, bicyclist, motorcyclist, bicycle, motorcycle, traffic cone, barrier, construction vehicle. Representative **stuff** classes include: road, parking, sidewalk, other-ground, building, fence, vegetation, trunk, terrain, pole, traffic-sign.

**Aggregated-map corollary.** Moving things leave motion-blur artefacts in accumulated clouds and are typically excluded from the static map taxonomy entirely (see [Moving vs Static Class Splits](#moving-vs-static-class-splits)). For aggregated-map segmentation, the effective taxonomy is stuff-heavy: nearly all dynamic things are absent, and only static-thing infrastructure elements (poles, signs, fixed GSE) survive into the map. This means panoptic segmentation is rarely needed for aggregated-map labeling — semantic segmentation is almost always sufficient.

Sources: LiDAR Panoptic Segmentation in an Open World (arXiv 2409.14273); DQFormer unified LiDAR panoptic segmentation (arXiv 2408.15813).

---

## Taxonomy Granularity

### How many classes?

There is no universal answer; class count reflects required fidelity of downstream reasoning versus practical annotation budget. Published dataset taxonomies span a wide range:

| Dataset | Annotated | Evaluated | Domain |
|---|---|---|---|
| SemanticKITTI | 28 (raw) → 20 (mapped) | 19 (single-scan) | On-road AV |
| nuScenes-lidarseg | 32 | 16 | On-road AV |
| Waymo Open | 23 | 23 | On-road AV |
| Paris-Lille-3D | 50 (full XML) | 9–10 coarse | Urban MLS |
| Toronto-3D | 8 | 8 | Urban MLS roadway |
| DALES | 8 | 8 | Aerial ALS |
| GridNet-HD | 12 groups incl. ignored | 11 | UAV LiDAR + image utility infrastructure |
| ECLAIR | 11 | 11 | Aerial LiDAR urban/utility |
| YUTO Semantic | 9 | 9 | Aerial LiDAR campus |
| S.MID | 25 | 14 | Industrial substation LiDAR |
| OpenTrench3D | 5 | 4-5 | Photogrammetric utility trench |
| MLDAS | 14 | 14 | Multi-LiDAR campus/street |
| USCILab3D | 267 reported | release to verify | Long-term campus robot |
| Industrial3D | 12 | 12 | TLS industrial MEP |
| Point Cloud City / Open3D-ML PCC | collection-specific | collection-specific | Managed-building / public-safety point clouds |
| City-Facade | 9 facade categories | 9 | MLS building frontage |
| ZAHA | 5 LoFG2 / 15 LoFG3 | 5 / 15 | MLS facade hierarchy and generalization |
| S3DIS | 13 | 13 | Indoor |
| ScanNet / ScanNet200 | 20 / 200 | 20 / 200 | Indoor |

### The accuracy / data-cost / annotation-cost trade-off

- More classes raises annotation cost: more boundary types require more annotator training, more inter-annotator disagreement, and more QA rounds.
- More classes increases the proportion of tail classes where per-class IoU is low, dragging down mean IoU regardless of model quality.
- Collapsing rare classes into a coarse parent raises measured mIoU without solving the underlying perceptual problem — a known criticism of benchmark design.
- The practical trade-off: keep fine-grained classes where safety distinctions matter; merge where boundary decisions are inherently ambiguous.

### Coarse-to-fine design

Starting with fewer well-defined superclasses and progressively splitting is standard practice because: (a) early annotation is cheaper — mistakes affect fewer boundary decisions; (b) a coarse taxonomy can be evaluated before the fine taxonomy is complete, providing earlier model-quality signal; (c) model transfer between coarse and fine taxonomies is tractable via class-tree re-labeling.

**SemanticKITTI** exemplifies this: 28 raw labels → 20 mapped labels via `learning_map` (merging bus and on-rails into other-vehicle; outlier and other-structure into unlabeled) → 19 evaluated labels (unlabeled excluded from mIoU). The YAML config at `semantic-kitti-api/config/semantic-kitti.yaml` encodes the remapping explicitly and is the canonical reference for this pattern.

Sources: SemanticKITTI (ICCV 2019); SemanticKITTI API YAML; Toronto-3D (arXiv 2003.08284).

---

## Hierarchical Taxonomies

### Class trees and coarse-to-fine evaluation

Hierarchical taxonomies arrange classes in a tree where parent nodes are coarser superclasses. SemanticKITTI's continual-learning partition illustrates a well-structured tree:

- **Vehicle** → car, truck, bus, motorcycle, bicycle, other-vehicle
- **Human** → person, bicyclist, motorcyclist
- **Ground** → road, parking, sidewalk, other-ground, terrain
- **Structure** → building, fence, other-structure
- **Nature** → vegetation, trunk
- **Object** → pole, traffic-sign, other-object

Benefits of hierarchical taxonomies:

1. **Rare-class advantage.** A rare subclass misclassified as a sibling still scores partial credit under hierarchical IoU — incentivising models to learn coarse distinctions even when fine-grained data is scarce.
2. **Incremental annotation.** Coarse labels can be collected from existing assets; fine labels added in a second annotation pass.
3. **Class-incremental learning.** Continual-learning strategies propose coarse-to-fine schedules where the model first learns the parent partition, then specialises, reducing catastrophic forgetting (arXiv 2304.03980).

### ScanNet200: head / common / tail stratification

ScanNet200 (Rozenberszki et al., ECCV 2022) extends the 20-class ScanNet to 200 categories, divided by labeled surface-point frequency:

- **Head**: 66 categories (high frequency)
- **Common**: 68 categories (medium frequency)
- **Tail**: 66 categories (low frequency)

Evaluation reports mIoU separately per stratum. This exposes models that achieve high overall mIoU by excelling on head classes while failing on tail classes. The benchmark explicitly shows that open-vocabulary and class-agnostic approaches are needed to bridge head-to-tail performance gaps — a lesson directly applicable to airside taxonomies where some infrastructure classes are very rare.

Sources: ScanNet200 project page; arXiv 2204.07761; arXiv 2304.03980.

---

## Cross-Dataset Taxonomy Harmonization

### Why taxonomies do not align

Datasets created independently choose class sets that reflect sensor type and mounting position, annotation team conventions, application focus, and the scale of rare classes. Key cross-dataset conflicts documented in the literature:

- **Ground splits.** SemanticKITTI has road / parking / sidewalk / other-ground / terrain (5 classes); nuScenes has driveable-surface / other-flat / sidewalk / terrain (4 classes); Waymo has road / lane-marker / walkable / other-ground / curb (5 classes, different split). These cannot be aligned without ambiguity.
- **Vegetation hierarchy.** SemanticKITTI separates vegetation (canopy) from trunk; nuScenes collapses both into vegetation; Toronto-3D uses "natural".
- **Moving-object conventions.** SemanticKITTI encodes moving instances as explicit per-point labels; nuScenes encodes motion via 3D bounding box attributes, not per-point labels.
- **Pole vs. traffic-sign.** Waymo distinguishes sign, traffic-light, pole separately; nuScenes merges many small verticals into "manmade".

For the full mismatch table across datasets, see the datasets reference: [Large-Scale 3D Segmentation Benchmarks](../datasets-benchmarks/large-scale-3d-segmentation-benchmarks.md).

### Label-mapping layer

The standard solution is a remapping table converting each source dataset's class IDs to a shared target space. The target is typically coarser than both sources: fine classes without a cross-dataset counterpart are merged into a parent or discarded. This is the approach used in both M3Net and Point Prompt Training (PPT).

### M3Net union label space

M3Net (Liu et al., CVPR 2024) trains a single model on SemanticKITTI (19 eval classes), nuScenes (16 eval), and Waymo (22 classes) simultaneously by constructing a union label space: `Y^u = Y^1 ∪ Y^2 ∪ ... ∪ Y^S`. Rather than merging to a common coarser taxonomy, M3Net uses language-guided alignment — text embeddings of class names — to relate semantically similar classes across datasets while retaining fine-grained granularity. The paper reports 75.1 / 83.1 / 72.4 mIoU on SemanticKITTI / nuScenes / Waymo using shared parameters. Pilot experiments in the paper confirm that naive joint training causes significant degradation, confirming the negative-transfer risk.

### Point Prompt Training (PPT): categorical alignment

PPT (Wu et al.) addresses the same problem with Prompt-driven Normalization (dataset-specific learnable normalization prompts) and Categorical Alignment (aligning class embeddings across datasets in a shared language space). This sidesteps explicit label remapping while preventing dataset-specific statistical distributions from interfering.

### Negative-transfer risk

When two datasets share a class name but define it differently — for example, "road" in SemanticKITTI includes lane markings while nuScenes does not — joint training without conflict resolution causes the model to learn contradictory supervision signals. M3Net constrains contrastive negative samples within each dataset's category space to reduce this. Automatic label unification via GNNs (arXiv 2407.10534) has also been proposed as a programmatic solution.

Sources: M3Net (arXiv 2405.01538, CVPR 2024); arXiv 2407.10534; arXiv 2207.08445; arXiv 2502.19177.

---

## Safety-Criticality Weighting

### Why standard mIoU is insufficient

Mean IoU weights all classes equally. For safety-critical AV operation, misclassifying a pedestrian is far more consequential than misclassifying terrain. Cross-entropy loss gives equal weight per point, so rare-but-critical classes — pedestrian points are approximately 0.01 % of a SemanticKITTI scan by point count — receive negligible gradient signal relative to dominant background classes.

### Importance-Aware Loss

Importance-Aware Loss (IAL) operates as a hierarchical weighted loss: high-importance classes (pedestrians, bicyclists) receive amplified loss weights. On SemanticKITTI, ENet+IAL lifts pedestrian IoU from 67.2 → 72.3 and bicyclist IoU from 34.1 → 50.9 compared to baseline, at the cost of slightly reduced scores on dominant background classes such as road and building.

### Safety metrics for semantic segmentation

Lis et al. (arXiv 2105.10142) define safety-aware metrics that penalise false negatives on safety-critical classes more than false positives. The key principle: failing to detect a pedestrian (false negative) is more dangerous than labeling background as pedestrian (false positive). Collisions involving pedestrians and cyclists are explicitly cited as the most critical failure modes.

### Taxonomy interaction with safety

The class taxonomy must be designed so that safety-critical objects are not collapsed into coarser classes. Merging pedestrian into "dynamic-object" would obscure the most safety-critical category entirely. Splitting car into car/truck/bus/other-vehicle is safety-neutral but useful for fleet profiling. A well-designed taxonomy therefore has fine granularity for vulnerable road users and major obstacles, and coarser granularity for background geometry that matters only for localization.

For the loss formulations underlying class-weighting, see [Point-Cloud Segmentation Losses and Metrics](../../../10-knowledge-base/geometry-3d/point-cloud-segmentation-losses-metrics-first-principles.md).

Sources: Importance-Aware Semantic Segmentation (liner.com); arXiv 2105.10142; Disparity-Weighted Loss (ResearchGate 336926978).

---

## Open-Set, Unknown, Void, and Ignore

### The void / ignore label

Every well-designed taxonomy reserves label ID 0 (or a sentinel value) for points that are unlabeled during annotation, ambiguous at class boundaries, or from classes explicitly excluded from the evaluation set.

In SemanticKITTI, ID 0 (unlabeled) and ID 1 (outlier) both map to the ignore label and are excluded from mIoU. In nuScenes-lidarseg, index 0 consolidates 12 categories including animal, personal-mobility devices, debris, emergency vehicles, and sensor noise — all treated as void during evaluation.

### Ignore vs unknown

"Ignore" is a training/evaluation artefact: annotation was not attempted or the class is excluded from scoring. "Unknown" is an explicit taxonomy class meaning a point belongs to no known class. The latter is operationally important for anomaly detection: a model that assigns high probability to the unknown class is signalling an out-of-distribution object. This distinction matters for runtime safety — ignore is a data-engineering label; unknown is a safety-relevant prediction.

### Open-world panoptic segmentation

LiPSOW (arXiv 2409.14273) is the first framework studying LiDAR panoptic segmentation in an open world: models trained on a closed vocabulary are evaluated on a larger dataset with novel stuff and thing classes. Unknown thing instances are detected using uncertainty estimates; unknown stuff regions are identified via low-confidence semantic predictions.

### Open-set semantic segmentation with anomaly detection

DOSS (arXiv 2503.11097) decomposes open-set segmentation into closed-set classification for known classes and anomaly detection for unknowns. Known-class features are pushed to the hypersphere surface; unknown-class features cluster near the sphere center. At inference, voxels with maximum feature value below threshold ξ are flagged as unknown. Evaluation uses held-out classes (barrier, construction-vehicle, traffic-cone, trailer in nuScenes) as evaluation unknowns withheld entirely from training — this approach sidesteps the need for an explicit "unknown" taxonomy class during training.

### Open-vocabulary segmentation as safety net

3D-AVS (CVPR 2025) generates a class vocabulary automatically from the scene without user-defined categories, enabling detection of objects absent from the closed training taxonomy. This is particularly relevant for long-tail safety scenarios where a stroller, animal, or unusual piece of ground-support equipment is never seen in training data. For method details, see [MoSaic3D](../methods/mosaic3d.md) and [OpenVoX](../methods/openvox.md).

Sources: arXiv 2409.14273; arXiv 2503.11097; 3D-AVS CVPR 2025; arXiv 2506.13265.

---

## Long-Tail and Class Imbalance

### The imbalance problem

In any outdoor LiDAR scan, ground-type stuff (road, terrain, vegetation) accounts for the overwhelming majority of points. In SemanticKITTI, a single scan contains 100,000+ points of road/terrain versus a few hundred points of person or bicycle. The class-frequency distribution follows a heavy-tailed power law.

RareBoost3D (arXiv 2510.10876, 2025) quantifies this for SemanticKITTI: approximately 1,950 car instances versus 412 combined instances of all rare classes (person, bicycle, motorcycle, rider, truck) in the benchmark. Their synthetic dataset deliberately inverts this ratio with over 1,000 pedestrian instances in certain subsets.

### Taxonomy granularity × imbalance interaction

The imbalance problem worsens with finer taxonomy: splitting "vehicle" into car/truck/bus/motorcycle fragments an already common class, but splitting "person" into standing/walking/crouching fragments a rare class further, making each sub-class even harder to learn. SemanticKITTI's decision to merge bus and on-rails into other-vehicle is precisely this logic — neither has enough points to learn reliably as a separate class.

Taxonomy design therefore interacts directly with the class imbalance problem: class count decisions must be informed by the point-frequency distribution in the expected deployment domain, not just by the distinctions that would be conceptually useful.

### Mitigation techniques

1. **Data augmentation / oversampling.** Copy-paste rare instances into training scans (PolarMix, LaserMix).
2. **Loss reweighting.** Inverse-frequency weighting or focal loss. See [Point-Cloud Segmentation Losses and Metrics](../../../10-knowledge-base/geometry-3d/point-cloud-segmentation-losses-metrics-first-principles.md) for formulations.
3. **Multi-head output.** Group head classes by shape and frequency into separate output heads — the input-output balanced framework (arXiv 2103.14269).
4. **Synthetic rare-class data.** RareBoost3D with CSC cross-domain alignment loss reports approximately 2–3 % mIoU gain.
5. **Semi-supervised active learning.** Query rare-class regions for annotation (Annotator, NeurIPS 2023).

Sources: arXiv 2510.10876; arXiv 2103.14269; arXiv 2310.20293.

---

## Moving vs Static Class Splits

### SemanticKITTI's moving-class variants

SemanticKITTI's multi-scan task (25-class taxonomy) distinguishes static and moving instances of the same object category via separate label IDs:

| Static class | Moving variant ID |
|---|---|
| car (10) | moving-car (252) |
| bicyclist (31) | moving-bicyclist (253) |
| person (30) | moving-person (254) |
| motorcyclist (32) | moving-motorcyclist (255) |
| on-rails (16) | moving-on-rails (256) |
| bus (13) | moving-bus (257) |
| truck (18) | moving-truck (258) |
| other-vehicle (20) | moving-other-vehicle (259) |

An object receives a "moving" designation if it moved in at least some consecutive scans during the sequence. The single-scan 19-class taxonomy collapses all moving variants back to their static counterparts via `learning_map`, because a single frame cannot measure velocity. The multi-scan taxonomy exposes these distinctions because temporal aggregation reveals motion artefacts.

### Moving / static as a second-order taxonomy axis

The moving/static axis is a second-order axis layered on top of the semantic class. It is only meaningful when temporal data is available. For applications relying on aggregated maps (a single static world model), this axis is irrelevant at inference time — but must be resolved at annotation time to prevent dynamic actor trails from entering the map.

### Relevance to aggregated maps

Aggregated multi-scan maps are inherently static-only representations:

- Moving objects appear as smeared ghost traces and are typically filtered before map construction or excluded from map labels entirely.
- The map taxonomy should therefore be the static subset of the single-scan taxonomy: all stuff classes plus static instances of infrastructure elements (poles, signs, fixed equipment) and staged or parked objects if operationally relevant.
- Moving-class labels generated during single-scan annotation must be discarded or remapped to "unknown / dynamic-removed" when back-projecting into the aggregated map.

Sources: SemanticKITTI ar5iv paper (1904.01416); SemanticKITTI API YAML; arXiv 2105.08971.

---

## Representative Domain Taxonomies

### Road AV: SemanticKITTI — 19 evaluated classes

From `learning_map_inv` in the official YAML: car, bicycle, motorcycle, truck, other-vehicle, person, bicyclist, motorcyclist, road, parking, sidewalk, other-ground, building, fence, vegetation, trunk, terrain, pole, traffic-sign. Unlabeled (ID 0) is excluded from mIoU → 19 scored classes.

Ground is split 5 ways (road / parking / sidewalk / other-ground / terrain). Vegetation is separated from trunk (structural element). People are split 3 ways (person on foot / person on bicycle / person on motorcycle), reflecting the distinction between vulnerable road users and their vehicles.

### Road AV: nuScenes-lidarseg — 16 evaluated classes

Reduced from 32 annotation classes. Void/ignore = index 0, consolidating 12 rare/noisy categories including animal, personal-mobility, debris, emergency-vehicle, stroller, pushable-pullable, ambulance-car, police-car.

**Things (10):** barrier, bicycle, bus, car, construction-vehicle, motorcycle, pedestrian, traffic-cone, trailer, truck.
**Stuff (6):** driveable-surface, other-flat, sidewalk, terrain, manmade, vegetation.

Key omissions versus SemanticKITTI: no pole class, no trunk class, no parking class (subsumed into driveable-surface or other-flat). "Manmade" is a catch-all for buildings, walls, structures — trading annotation cost reduction for semantic resolution.

### Road AV: Waymo Open Dataset — 23 classes

Car, Truck, Bus, Motorcyclist, Bicyclist, Pedestrian, Sign, Traffic Light, Pole, Construction Cone, Bicycle, Motorcycle, Building, Vegetation, Tree Trunk, Curb, Road, Lane Marker, Walkable, Sidewalk, Other Ground, Other Vehicle, Undefined.

Notable distinctions versus SemanticKITTI: explicit Traffic Light class; Lane Marker as separate from Road; Curb as an explicit class; Tree Trunk separate from Vegetation. Waymo labels at 2 Hz on the full dataset.

### Mobile mapping / survey: Paris-Lille-3D — 50 annotated, 9–10 coarse

Full annotation uses 50 classes in an XML hierarchy adapted from the iQmulus/TerraMobilita benchmark ontology. Vehicle subcategories split by state: parked / stopped / moving. Coarse benchmark evaluation (9–10 classes, exact list varies by study): ground, buildings, poles, bollards, trash cans, barriers, pedestrians, cars, natural — or alternatively: ground, vegetation, rail, poles, wires, signals, fence, installation, building.

### Mobile mapping / survey: Toronto-3D — 8 classes

Road, Road marking, Natural, Building, Utility line, Pole, Car, Fence. Covers approximately 1 km of urban street (~78.3 M points). Notably omits pedestrians (dataset focuses on static infrastructure). Road marking is a separate class enabling pavement-marking detection — directly relevant to airside applications.

### Aerial LiDAR: DALES — 8 classes

Ground, Vegetation, Cars, Trucks, Power lines, Fences, Poles, Buildings. Acquired from fixed-wing aircraft; no pedestrians (scale resolution insufficient); no ground surface subdivision (no road/sidewalk distinction at 10–20 pts/m²); buildings are rooftops only. The minimal taxonomy reflects the resolution constraints of aerial ALS rather than a deliberate design choice.

### Utility infrastructure: GridNet-HD — 11 evaluated groups

Pylon, Conductor cable, Structural cable, Insulator, High vegetation, Low vegetation, Herbaceous vegetation, Rock/gravel/soil, Impervious soil/road, Water, Building, plus an unassigned/unlabeled group ignored by evaluation. Acquired from UAV LiDAR plus oblique RGB imagery over overhead electrical infrastructure.

This taxonomy is valuable because it splits utility assets that many AV datasets collapse into generic `pole`, `wire`, `manmade`, or `other` labels. That split is useful for long-thin infrastructure stress testing, but it should not be copied into an AV release taxonomy without evidence: an airside, yard, or campus map should add `cable`, `gantry`, `mast`, or `overhead equipment` IDs only when reviewed examples, point counts, confusion analysis, and an operational need show the parent `pole/mast/light` or `fixed equipment` class is insufficient.

### Non-road proxy taxonomy pressure

The newest non-road datasets are most useful as *taxonomy stress tests*, not as direct release ontologies. Use them to decide where a target map needs a finer split, then promote only with reviewed local evidence.

- **ECLAIR and YUTO Semantic** show what ALS site-survey taxonomies can see reliably: ground/vegetation/building plus vehicles, roads, parking, water, and utility classes where point density and viewpoint support them. They should inform aerial/site-survey layers without forcing their coarse top-down definitions onto MLS map labels.
- **S.MID** annotates 25 industrial-substation categories and merges them into 14 evaluation classes. That is the right pattern for substations, depots, and industrial yards: preserve raw candidate categories during review, but release a coarser parent taxonomy unless tail-class counts justify separate IDs.
- **OpenTrench3D** uses a utility-owner-centered scheme (`main utility`, `other utility`, `trench`, `inactive utility`, `misc`). It is photogrammetric rather than LiDAR, so it is ontology evidence for works-zone and underground-utility mapping, not LiDAR sensor-noise evidence.
- **MLDAS** keeps one 14-class label space across 128-, 64-, and 32-beam LiDAR. Its lesson is operational: every taxonomy config needs explicit label-map tests across sensor packages before labels are back-projected into training data.
- **USCILab3D** reports 267 foundation-model-assisted categories. Treat those names as open-vocabulary candidate evidence until aliases, parent-class fallbacks, and release IDs are reviewed; do not let prompt-derived categories become map-truth IDs directly.
- **Industrial3D** has 12 dense TLS MEP classes (`duct`, `pipe`, `pump`, `valve`, `tank`, etc.). It is relevant when a map product must label industrial infrastructure, but its release/licence maturity and facility-count wording should be checked before it becomes a production benchmark dependency.

### Indoor reference: S3DIS — 13 classes

Ceiling, Floor, Wall, Beam, Column, Window, Door, Table, Chair, Sofa, Bookcase, Board, Clutter. Structured/architectural stuff dominates; things are furniture instances.

### Indoor reference: ScanNet (20) / ScanNet200 (200)

ScanNet 20-class: wall, floor, cabinet, bed, chair, sofa, table, door, window, bookshelf, picture, counter, desk, curtain, refrigerator, shower curtain, toilet, sink, bathtub, other-furniture. ScanNet200 extends to 200 categories with head/common/tail split (66/68/66) by labeled surface-point frequency. Primary metric: category mIoU evaluated per stratum.

---

## Taxonomy for Aggregated Maps

### How aggregated maps differ from single-scan datasets

Aggregated multi-scan maps differ from single-scan datasets in three ways that directly affect taxonomy design:

1. **Static-only.** Moving objects are filtered or smeared. The taxonomy must be the static subset of the single-scan taxonomy.
2. **Stuff-heavy.** The vast majority of surface area in an aggregated map is background geometry (pavement, terrain, structures). Dynamic things are absent; only static-thing infrastructure elements survive.
3. **Higher density and consistency.** Aggregated maps have far more points per square metre than single scans, improving geometric separability of fine classes — distinguishing kerb edge from pavement surface becomes more tractable, justifying finer granularity in some areas.

### The back-projection requirement for auto-labeling

When a model trained on single-scan data is used to auto-label an aggregated map (or vice versa), the taxonomies must be compatible. The recommended pattern:

```
Single-scan taxonomy (full) ──► annotation ──► single-scan labels
        │
        │  label_map (drop moving classes, keep static classes)
        ▼
Aggregated map taxonomy (static subset) ──► back-project ──► map labels
```

This requires: (a) the single-scan taxonomy includes all map classes as a proper subset; (b) moving-class labels and unlabeled labels from single-scan annotation map cleanly to "unknown" or "dynamic-removed" in the map taxonomy. Violating (a) means some map classes have no single-scan labels to back-project from, requiring separate annotation passes — a significant cost increase.

### Semantic class vs permanence layer

For aggregated-map publication, **semantic class** and **map permanence** must be separate axes. The semantic class answers "what is this point?" The permanence or hygiene layer answers "should this point become permanent map truth, be retained only as soft context, or be excluded from the released map?" A class ID alone is therefore not a publication decision.

This separation prevents the common failure where a semantically correct label still corrupts the map. A parked belt loader may be correctly labeled as `staged GSE`, a waiting person may be correctly labeled as `person`, and a cable left during maintenance may be correctly labeled as `cable/tooling`; none of those facts imply the points belong in the permanent aggregate map.

| Semantic evidence | Default map-hygiene layer | Release policy |
|---|---|---|
| Pavement, pavement marking, kerb, fixed building, fixed fence, surveyed pole/mast/light | `permanent_static` | Eligible for released geometry and localization priors after geometric QA and semantic-confidence gates |
| Person, crew, passenger, cyclist, animal | `static_transient` or hard exclusion | Never released as permanent geometry; may appear only in residual-review evidence or training negatives |
| Parked vehicle, parked GSE, parked aircraft, movable barrier, pallet, container | `movable_static` or `static_transient` | Keep out of permanent map; may be published as a soft occupancy/context layer only if consumers explicitly request it |
| FOD, chock, cone, temporary cable, tool, maintenance material | `fod_candidate` | Candidate hazard/review layer, not map structure; route to operational inspection and FOD datasets |
| Rain/snow returns, multipath ghosts, registration doubles, scan-shadow streaks | `artifact` | Exclude from release and count against map-conditioning quality |
| Unknown high-confidence object, low-confidence semantic region, open-vocabulary candidate not yet promoted | `unknown_review` | Human review or active-learning queue; cannot silently collapse into the nearest permanent class |

The release contract should carry both products: per-point or per-voxel semantic labels, and per-point or per-voxel hygiene-layer labels. In this repository that requirement is encoded in the semantic-map manifest: `outputs.map_hygiene_layer_digests` hash-addresses the published hygiene layers, while `metrics_evidence.map_hygiene_metrics` records false-permanent, false-deletion, residual-dynamic, static-transient, FOD-exclusion, and artifact metrics. The taxonomy document defines the meaning of labels; the manifest proves the release bundle carried the hygiene evidence.

**Release rule:** a point can be semantically correct and still be wrong for the permanent map. Publication gates must evaluate semantic class, permanence layer, confidence, change history, and consumer contract together.

### Training and Evaluation Consequences

The semantic taxonomy is therefore not the same thing as the training-data acceptance policy. A class config can say that class 12 means `staged GSE`; it cannot say whether a particular staged-GSE cluster is a supervised positive, an ignored pseudo-label, a soft-context overlay, or a quarantine object. That decision belongs to the release-state layer and must be carried into the training manifest defined in [Training Paradigms for 3D / LiDAR Segmentation](3d-segmentation-training-paradigms.md).

| Consumer | Semantic class it needs | Release-state evidence it also needs | Failure if omitted |
|---|---|---|---|
| Permanent HD-map layer | Fixed infrastructure, pavement, markings, kerbs, signs, poles | `permanent_static` plus source-map QA and confidence gates | Parked assets or stationary people become map truth |
| Single-scan auto-label export | Class labels back-projected from the map | Release-state-specific loss masks and split exclusion | Pseudo-labels teach the model to hallucinate temporary objects as static classes |
| Dynamic-removal training | Dynamic actor, ghost, or temporal-inconsistency targets | `dynamic_residual` with source-frame motion evidence | Cleaners over-delete fixed thin structures near moving objects |
| Hazard/FOD review | Debris/tool/chock/unknown-small-object candidate labels | `fod_candidate` and reviewer outcome | Safety-relevant small objects are erased as noise |
| Active-learning queue | Unknown/open-vocabulary candidate names | `unknown_review` with candidate-label provenance | Novel equipment is silently mapped to the nearest known class |

Evaluation should report semantic mIoU and release-state confusion separately. A model may improve pavement IoU while worsening false-permanent rate on staged equipment; that is not a release improvement. Conversely, a conservative model may abstain more often into `unknown_review`, lowering coverage but improving safety review yield. Both effects are invisible if the taxonomy and hygiene layer are collapsed into one label map.

### Non-road urban-district permanence mapping

Non-road managed districts — airport aprons, campuses, ports, yards, utility corridors, and industrial sites — have more static-but-movable structure than public-road AV datasets. Their taxonomies should therefore define permanence policy at the superclass level before fine class IDs are promoted.

| Domain slice | Typical semantic superclasses | Permanence policy |
|---|---|---|
| Airport apron / terminal frontage | Pavement, markings, kerbs, terminal facade, fences, poles, VDGS, fixed plant, staged GSE, parked aircraft | Fixed civil infrastructure can be permanent; staged GSE and parked aircraft are movable-static quarantine layers |
| Campus / pedestrian district | Walkways, plazas, buildings, vegetation, benches, bollards, bike racks, people, delivery carts | Benches/bollards may be permanent if bolted/surveyed; people, bikes, carts, and event furniture are static-transient |
| Port / logistics yard | Asphalt, rails, quay edges, cranes, containers, trailers, signs, lighting, fences | Civil structure and fixed cranes can be permanent; containers/trailers/pallets are movable-static and stale quickly |
| Industrial yard / substation | Ground, cable trays, ducts, pipes, tanks, pumps, fences, cabinets, temporary tools | Fixed plant may need fine classes; tools, cables laid for work, and mobile equipment are review or transient layers |
| Utility corridor / overhead infrastructure | Pylons, poles, conductor cables, insulators, vegetation, roads/soil, water, buildings | Grid assets can be permanent; vegetation needs freshness policy; maintenance vehicles and temporary works are excluded |
| Building frontage / managed facade | Wall, door, window, sign, balcony, awning, HVAC, rain shed, advertisement | Structural facade can be permanent; advertisements, movable signs, scaffolds, and construction wraps require review or versioned soft layers |

This is why GridNet-HD, S.MID, City-Facade, ZAHA, Point Cloud City, YUTO, and ECLAIR are valuable even when their taxonomies are not copied directly: they reveal which non-road classes are stable infrastructure, which are movable assets, and which are sensor/viewpoint artefacts. A production taxonomy should encode those distinctions explicitly rather than forcing everything into a road-style `static object` bucket.

### Taxonomy promotion from open-vocabulary candidates

Open-vocabulary labelers can suggest names that the controlled taxonomy does not yet contain. Treat those names as taxonomy evidence, not as new class IDs. The promotion path should be:

1. **Alias first.** Map text variants such as "light mast", "lamp post", and "floodlight pole" to an existing class or synonym table before creating a new class.
2. **Parent class second.** If the candidate is real but too rare or ambiguous, fold it into a parent such as `pole / mast / light`, `sign / VDGS`, `fixed equipment`, `staged GSE`, or `unknown`.
3. **New class only with evidence.** A new ID requires reviewed examples across sites or sessions, point/instance counts, boundary rules, confusion analysis against neighbouring classes, and a stated operational reason the parent class is insufficient.
4. **Versioned rollout.** Any accepted class split updates the taxonomy ID/digest, label map, evaluation subset, compatibility map for older labels, and the semantic-map manifest. Until that happens, open-vocabulary outputs stay as `candidate_label` metadata or `unknown`, not release labels.

This is especially important for urban-district and non-road mapping. OpenUrban3D-style whole-map labeling can discover campus furniture, construction assets, temporary barriers, or unusual service equipment, but a prompt string is not a safety-case ontology. The taxonomy change has to be reviewable, backward-compatible, and measurable before it is allowed to affect training, replay, or runtime map publication.

### Proposed airside aggregated-map taxonomy (14 classes)

*The following is a proposed taxonomy for an airport airside aggregated LiDAR map, informed by published airside LiDAR work. It is not drawn from a published standard and should be flagged accordingly during any downstream safety-case use.*

| ID | Class | Stuff / Static Thing | Notes |
|---|---|---|---|
| 0 | Unknown / void | — | Unannotated, filtered-dynamic, or ambiguous points |
| 1 | Pavement — manoeuvring | Stuff | Taxiways, runways, holding areas; high reflectance |
| 2 | Pavement — apron | Stuff | Stand and service road surfaces |
| 3 | Pavement — road (landside) | Stuff | Vehicle access roads within airport perimeter |
| 4 | Pavement marking | Stuff | Painted lines, centrelines, stop bars; distinct reflectance channel |
| 5 | Terrain / grass | Stuff | Infield grass, embankments |
| 6 | Kerb / edge | Stuff | Raised edge separating surfaces; hard lateral AV constraint |
| 7 | Building / terminal | Stuff | Terminal facades, maintenance hangar walls |
| 8 | Fence / barrier | Stuff | Perimeter fence, jet-blast deflectors, temporary barriers |
| 9 | Pole / mast / light | Static thing | Airfield lights, sign poles, lamp columns |
| 10 | Sign / VDGS | Static thing | Mandatory instruction signs, VDGS mast |
| 11 | Fixed GSE / infrastructure | Static thing | Fixed-base fuelling hydrant covers, fixed GPU stations |
| 12 | Staged GSE (parked) | Static thing | Parked GPUs, tugs, belt loaders — present in map but not in safety path |
| 13 | Aircraft (parked) | Static thing | Parked aircraft at stand; obstacle volume, not tracked instance |

**Design rationale:**

- **Pavement split 3 ways** because manoeuvring area, apron, and landside road have different speed limits, right-of-way rules, and sensor-reflectance signatures. AV operational domain differentiation requires these classes to be distinguishable.
- **Pavement marking separate** because it is the primary localization anchor in airside HD maps; conflating it with pavement wastes a critical geometric and radiometric cue.
- **Kerb separate** (not merged into terrain or pavement) because AV path planning treats it as a hard lateral constraint — not a soft semantic category.
- **Overhead/utility subclasses stay conditional.** GridNet-HD shows when pylons, conductor cables, structural cables, and insulators deserve separate labels in utility corridors, but a generic airside map should keep those under `pole / mast / light` or `fixed equipment` until a target site has enough reviewed points and an operational consumer for the split.
- **Facade and managed-building subclasses stay product-specific.** City-Facade supports finer facade labels such as wall, window, door, roof, advertisement, air conditioner, rain shed, and balcony; ZAHA adds the LoFG hierarchy for `floor`, `decoration`, `structural`, `opening`, and `other elements` plus 15 fine facade classes; Point Cloud City / Open3D-ML PCC supports public-safety indoor feature harmonization. These are strong references for terminal frontage, terminal interiors, BIM, and digital-twin products, but they should not split the default outdoor airside `building / terminal / hangar facade` class unless a downstream consumer needs the sublabels and enough owned target-site labels exist.
- **Staged GSE distinct** from fixed infrastructure because it may move between map updates. Map versioning logic needs to flag these as potentially stale objects during change detection.
- **Parked aircraft** is an obstacle category. At normal AV operation it does not need to be tracked as a counted instance — the AV needs to know the volume is occupied, not which aircraft it is.
- **Moving GSE, vehicles, persons** are absent from this taxonomy; they belong to the single-scan real-time perception taxonomy only.

Sources informing this taxonomy: IEEE DASC 2020 (LiDAR semantic segmentation for airport apron operations); MDPI Applied Sciences 2024 (real-time LiDAR segmentation for jetbridge operations); Airport Improvement magazine (mobile mapping, Houston Intercontinental Airport pavement program).

---

## Taxonomy and Annotation Cost

### How class count drives labeling effort

LiDAR point cloud annotation is among the most expensive labeling modalities: a single scan contains millions of points, each requiring a class assignment verified in 3D. MILAN (arXiv 2407.15797) reports that milli-annotation approaches (one click per cluster) can reduce labeling cost by approximately 1000×, but quality depends on the taxonomy — coarser classes produce fewer boundary disputes and lower cost per scan.

Key cost drivers:

1. **Number of classes.** Each boundary between classes requires annotators to make a judgment call; more classes means more boundary types, more annotator training time, and more QA checks.
2. **Class ambiguity at boundaries.** Kerb/pavement, vegetation/terrain, and pole/sign boundaries are consistently the hardest to annotate consistently. These are zones of highest inter-annotator disagreement.
3. **Rare class coverage.** Classes appearing in fewer than 1 % of scans are missed or misidentified by annotators; dedicated QA passes add cost.
4. **Moving-vs-static distinctions.** Annotating whether an object is moving requires temporal review of consecutive frames, roughly doubling annotation time for dynamic scenes.

### Inter-annotator agreement and taxonomy design

Best practices for ontology-driven annotation:

- **Boundary rules must be explicit.** Example: "the kerb class includes the top surface up to and including the break-of-slope onto the pavement; the pavement class begins at the break-of-slope." Ambiguous rules are the primary source of inter-annotator disagreement.
- **Edge cases documented in the ontology.** A bollard that has fallen onto the road — is it bollard or other-object? The taxonomy must specify.
- **Dual review plus agreement targets.** Industry practice targets 85–95 % agreement on per-point class assignments for boundary regions.
- **Statistically-grounded QA.** Acceptance criteria per class and per scan — not just overall accuracy.

### Class consolidation as a cost lever

Merging two confusable classes (for example, "other-ground" + "terrain" → "non-pavement-ground") reduces annotation ambiguity directly. SemanticKITTI's "other-structure" and "other-object" catch-all classes follow this pattern — annotators assign unclear points to the catch-all without needing to decide on the exact subtype. The catch-all is then excluded from evaluation mIoU, making it a low-stakes annotation target that absorbs boundary uncertainty without degrading scored results.

Sources: arXiv 2407.15797; DigitalDivideData annotation blog; arXiv 2310.20293.

---

## Implementation Notes

- **Start with superclasses.** Design the parent level first, confirm annotation guidelines and tooling, then decide whether to split — rather than designing all fine classes up front.
- **Reserve ID 0 unconditionally.** Every taxonomy must have an ignore/void class at ID 0 that absorbs unannotated, ambiguous, or filtered-dynamic points. Do not assign ID 0 to a real semantic class.
- **Write boundary rules before annotation begins.** The ontology document must be longer than the class list. Boundary rules, edge case resolutions, and example images per class reduce inter-annotator disagreement more than any QA process can recover afterward.
- **Encode the label_map explicitly in a config file.** Follow SemanticKITTI's YAML pattern: declare raw classes, the learning_map remapping, and the evaluation subset in one versioned file. This makes taxonomy changes auditable.
- **Align single-scan and map taxonomies before annotation starts.** The map taxonomy must be a proper subset of the single-scan taxonomy (see back-projection pattern above). Discovering misalignment after annotation requires relabeling.
- **Keep open-vocabulary names outside the release taxonomy until promoted.** Store prompt/model/reviewer provenance for candidate names, but require alias mapping, parent-class fallback, or a versioned taxonomy-change request before any new name receives a class ID.
- **Keep semantic IDs separate from hygiene layers.** A semantic class config should not encode whether a point is permanent map truth. Carry that in the release layer taxonomy (`permanent_static`, `movable_static`, `static_transient`, `dynamic_residual`, `fod_candidate`, `artifact`, `unknown_review`) and require both products in the semantic-map manifest.
- **Plan for class splits.** When designing a new class, document the conditions under which it might be split later (e.g., "pavement-apron may split into apron-hard-stand and apron-service-road if operational data reveals sufficient point-count"). This allows forward-compatible ontology design.
- **Track class-frequency distributions** in a held-out validation set before finalising the taxonomy. If any evaluated class has fewer than 100 instances in the training set, seriously consider merging it into a parent. Point count alone is misleading; instance count drives object-level evaluation quality.

---

## Failure Modes

| Symptom | Probable cause | Diagnostic |
|---|---|---|
| Very high overall mIoU but poor operational performance | Head classes dominate mIoU; tail classes unseen at deployment | Report per-class IoU and compute stratified mIoU (head/common/tail) |
| Model assigns wrong class confidently to novel objects | No unknown/void class in closed taxonomy; no open-set handling | Add explicit unknown class or deploy DOSS-style anomaly detection alongside closed-set model |
| Annotation quality degrades over the project | Boundary rules insufficiently specified; annotators diverge on edge cases | Audit inter-annotator agreement per class; re-anchor on boundary rule document |
| Cross-dataset transfer causes catastrophic performance drop | Negative transfer from incompatible class definitions (e.g., "road" semantics differ) | Build explicit label_map; use language-guided alignment (M3Net/PPT) rather than naive joint training |
| Dynamic actor trails appear in aggregated map labels | Moving classes not excluded from map taxonomy; back-projection remapping missing | Verify label_map remaps all moving-class IDs to unknown/dynamic-removed before map projection |
| Pedestrian or cyclist IoU low despite overall mIoU being acceptable | Safety-critical rare classes not weighted in loss | Apply Importance-Aware Loss or inverse-frequency weighting to safety-critical classes |
| Kerb / pavement boundary mislabeled at high rate | Boundary rule ambiguous; annotators unsure where class changes | Add explicit break-of-slope rule with visual examples; conduct targeted inter-annotator test on kerb sections |
| mIoU inflated by catch-all class counting | Catch-all class included in mIoU denominator even though it is an annotation artefact | Exclude catch-all and ignore-label classes from mIoU computation, following SemanticKITTI convention |
| Staged GSE objects reappear as permanent static structure across map versions | Staged GSE not distinguished from fixed infrastructure in taxonomy | Maintain separate class ID 12 (staged GSE) and flag as "potentially stale" in map versioning |
| Correctly labeled people, pallets, containers, or staged vehicles enter the released base map | Semantic class ID is being treated as the release decision; no separate permanence/hygiene layer | Require `map_hygiene_layer_digests` and reject releases where movable-static or static-transient points are fused into `permanent_static` |
| Rare infrastructure class (e.g., VDGS) never segmented correctly | Insufficient training instances; class not split from pole/sign catch-all early enough | Report per-instance recall; augment with copy-paste or synthetic objects; consider merging to parent until data volume justifies split |

---

## Sources

**Cross-links (this knowledge base):**
- [Aggregated-Map Semantic Segmentation](aggregated-map-semantic-segmentation.md) — §6 Class Taxonomies; §13 evaluation rigor
- [LiDAR Semantic Segmentation](lidar-semantic-segmentation.md) — §8 single-scan taxonomy section
- [Large-Scale 3D Segmentation Benchmarks](../datasets-benchmarks/large-scale-3d-segmentation-benchmarks.md) — cross-dataset taxonomy mismatch table
- [Point-Cloud Segmentation Losses and Metrics — First Principles](../../../10-knowledge-base/geometry-3d/point-cloud-segmentation-losses-metrics-first-principles.md) — class-weighting in losses
- [MoSaic3D](../methods/mosaic3d.md) — open-vocabulary 3D segmentation method
- [OpenVoX](../methods/openvox.md) — open-vocabulary voxel segmentation method

**Primary papers and datasets:**
- SemanticKITTI ICCV 2019: https://openaccess.thecvf.com/content_ICCV_2019/papers/Behley_SemanticKITTI_A_Dataset_for_Semantic_Scene_Understanding_of_LiDAR_Sequences_ICCV_2019_paper.pdf
- SemanticKITTI API YAML config: https://github.com/PRBonn/semantic-kitti-api/blob/master/config/semantic-kitti.yaml
- SemanticKITTI ar5iv (class taxonomy details): https://ar5iv.labs.arxiv.org/html/1904.01416
- nuScenes-lidarseg devkit README: https://github.com/nutonomy/nuscenes-devkit/blob/master/python-sdk/nuscenes/eval/lidarseg/README.md
- Waymo 23-class blog post (2022): https://waymo.com/blog/2022/03/expanding-waymo-open-dataset-with-new-labels/
- Paris-Lille-3D project page: https://npm3d.fr/paris-lille-3d
- Paris-Lille-3D paper: https://arxiv.org/pdf/1712.00032
- Toronto-3D (arXiv 2003.08284): https://arxiv.org/pdf/2003.08284
- DALES aerial ALS dataset (arXiv 2004.11985): https://arxiv.org/abs/2004.11985
- GridNet-HD utility LiDAR-image dataset: https://arxiv.org/abs/2601.13052 · https://huggingface.co/datasets/heig-vd-geo/GridNet-HD · [dataset page](../datasets-benchmarks/gridnet-hd-power-line-lidar-image-segmentation.md)
- Point Cloud City / Open3D-ML PCC: https://www.nist.gov/services-resources/software/point-cloud-city-open3d-ml-repository · https://www.nist.gov/publications/cross-dataset-semantic-segmentation-performance-analysis-unifying-nist-point-cloud-city
- City-Facade: https://doi.org/10.1016/j.isprsjprs.2026.01.003 · https://github.com/SYSU-3DSTAILab/City-Facade
- ZAHA: https://openaccess.thecvf.com/content/WACV2025/html/Wysocki_ZAHA_Introducing_the_Level_of_Facade_Generalization_and_the_Large-Scale_WACV_2025_paper.html · https://github.com/OloOcki/zaha · https://tum2t.win/datasets/pc-mls
- ECLAIR aerial LiDAR dataset: https://openaccess.thecvf.com/content/CVPR2024W/USM/html/Melekhov_ECLAIR_A_High-Fidelity_Aerial_LiDAR_Dataset_for_Semantic_Segmentation_CVPRW_2024_paper.html · https://github.com/SharperShape/eclair-dataset
- YUTO Semantic aerial LiDAR dataset: https://huggingface.co/datasets/ausmlab/yuto-semantic · https://yutosemantic.ausmlab.com/
- S.MID / SFPNet industrial LiDAR dataset: https://github.com/Cavendish518/SFPNet · https://www.semanticindustry.top/dataset
- OpenTrench3D utility-trench point-cloud dataset: https://arxiv.org/abs/2404.07711 · https://github.com/SimonBuusJensen/OpenTrench3D
- MLDAS multi-LiDAR domain-adaptation dataset: https://sychen320.github.io/projects/MLDAS/ · https://www.ijcai.org/proceedings/2024/0072.pdf
- USCILab3D long-term campus dataset: https://proceedings.neurips.cc/paper_files/paper/2024/hash/628433f240414517fd95164b4275f5cc-Abstract-Datasets_and_Benchmarks_Track.html · https://sites.google.com/usc.edu/uscilab3d/
- Industrial3D TLS industrial infrastructure dataset: https://arxiv.org/abs/2603.28660 · https://github.com/pointcloudyc/Industrial3D
- S3DIS MMDetection3D docs: https://mmdetection3d.readthedocs.io/en/v0.18.0/datasets/s3dis_sem_seg.html
- ScanNet200 project page: https://rozdavid.github.io/scannet200
- ScanNet200 paper (arXiv 2204.07761): https://arxiv.org/pdf/2204.07761
- M3Net CVPR 2024 (arXiv 2405.01538): https://arxiv.org/abs/2405.01538
- M3Net HTML paper: https://arxiv.org/html/2405.01538v1
- Automated label unification via GNNs (arXiv 2407.10534): https://arxiv.org/pdf/2407.10534
- Automatic universal taxonomies (arXiv 2207.08445): https://arxiv.org/pdf/2207.08445
- Knowledge distillation for label space unification (arXiv 2502.19177): https://arxiv.org/html/2502.19177
- Safety metrics for semantic segmentation (arXiv 2105.10142): https://arxiv.org/pdf/2105.10142
- Importance-Aware Semantic Segmentation (liner.com): https://liner.com/review/importanceaware-semantic-segmentation-for-autonomous-driving-system
- Disparity-weighted loss (ResearchGate 336926978): https://www.researchgate.net/publication/336926978_Disparity_weighted_loss_for_semantic_segmentation_of_driving_scenes
- LiDAR Panoptic Segmentation in an Open World (arXiv 2409.14273): https://arxiv.org/abs/2409.14273
- DQFormer panoptic segmentation (arXiv 2408.15813): https://arxiv.org/pdf/2408.15813
- DOSS open-set segmentation (arXiv 2503.11097): https://arxiv.org/pdf/2503.11097
- 3D-AVS auto-vocabulary CVPR 2025: https://openaccess.thecvf.com/content/CVPR2025/papers/Wei_3D-AVS_LiDAR-based_3D_Auto-Vocabulary_Segmentation_CVPR_2025_paper.pdf
- OpenUrban3D annotation-free open-vocabulary urban point-cloud segmentation: https://arxiv.org/abs/2509.10842
- Open-set panoptic guided by uncertainty (arXiv 2506.13265): https://arxiv.org/pdf/2506.13265
- RareBoost3D (arXiv 2510.10876): https://arxiv.org/abs/2510.10876
- Input-output balanced framework (arXiv 2103.14269): https://arxiv.org/abs/2103.14269
- Annotator active learning NeurIPS 2023 (arXiv 2310.20293): https://arxiv.org/abs/2310.20293
- Moving object segmentation in 3D LiDAR (arXiv 2105.08971): https://arxiv.org/pdf/2105.08971
- Continual learning for LiDAR segmentation (arXiv 2304.03980): https://arxiv.org/pdf/2304.03980
- MILAN milli-annotations (arXiv 2407.15797): https://arxiv.org/pdf/2407.15797
- Target-Aware Attentional Network for rare class segmentation: https://www.sciencedirect.com/science/article/abs/pii/S0924271624004222
- Airside LiDAR segmentation IEEE DASC 2020: https://ieeexplore.ieee.org/document/9256495/
- Jetbridge LiDAR segmentation MDPI 2024: https://www.mdpi.com/2076-3417/14/21/9685
- Mobile mapping Houston Intercontinental Airport: https://airportimprovement.com/article/mobile-mapping-maximizes-efficiency-pavement-program-houston-intercontinental/
- Ultralytics panoptic segmentation glossary: https://www.ultralytics.com/glossary/panoptic-segmentation
- 3D LiDAR annotation precision demands (DigitalDivideData): https://www.digitaldividedata.com/blog/3d-lidar-data-annotation-what-precision-actually-demands
