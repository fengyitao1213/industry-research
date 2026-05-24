# Secure Artifact Attestation Profile by Scale

**Last updated:** 2026-05-24

This page defines the secure artifact chain for MLOps systems that train, label, evaluate, package, and release autonomy artifacts. It extends software supply-chain controls into ML-specific assets: model weights, ONNX exports, TensorRT engines, semantic-map layers, map-hygiene sidecars, dataset manifests, prompt packs, evaluator models, replay packs, containers, and release packets.

The core rule is that signing proves integrity only after the organization defines what identity, builder, inputs, evidence, and policy are trusted. A signed but unreviewed artifact is not release evidence. A model registry entry without digest-bound provenance is not enough for a vehicle, map publication, or safety case. Use `model-registry-artifact-lifecycle-by-scale.md` to define which registry records, lifecycle states, aliases, artifact-set memberships, and rollback retention policies the attestations must bind to.

---

## Why Attestation Matters for MLOps

Autonomy releases combine software, data, learned parameters, maps, runtime configuration, calibration, and evidence. A conventional container security program answers only part of the question. MLOps must also prove:

- which raw logs, labels, map layers, prompt packs, and evaluation sets were used;
- which code, dependency lock, container base, builder, GPU class, and workflow produced the artifact;
- whether the artifact was scanned, reviewed, approved, and promoted under the right authority;
- whether the digest deployed at runtime is the same digest that passed evaluation and safety review;
- whether a registry alias, OTA manifest, map bundle, or runtime contract can be rolled back to a previous trusted set.

The failure mode is not only a malicious image. It is also a stale TensorRT engine, a changed class order, an unsigned prompt pack, a dataset snapshot with wrong allowed-use state, a semantic map built from an unaccepted source map, or a release packet whose evidence cannot be reconstructed after an incident.

---

## Artifact Scope

| Artifact | Why it needs attestation | Minimum subject digest |
|---|---|---|
| Training container | Defines code, dependencies, CUDA/cuDNN, Python packages, and build environment | OCI image digest |
| Inference container | Defines runtime behavior, preprocessing, post-processing, message schemas, and diagnostics | OCI image digest |
| Model checkpoint | Learned parameters can change vehicle behavior or label generation | Checkpoint file digest |
| ONNX export | Export can change graph semantics, preprocessing, dynamic axes, or unsupported ops | ONNX file digest |
| TensorRT engine | Engine is hardware/runtime-specific and may not match evaluated checkpoint | Engine file digest plus target hardware/runtime |
| Semantic map layer | Published map semantics affect localization, planning, monitoring, and training exports | Semantic-map manifest digest |
| Map-hygiene layer | Removal decisions can delete permanent structure or retain dynamic residuals | Hygiene sidecar digest |
| Dataset manifest | Training and eval claims depend on exact raw/log/label/split lineage | Manifest digest plus data product ID |
| Label batch | Labels can enter training, replay assertions, map QA, or safety evidence | Label export digest |
| Prompt or labeler pack | Prompt/model/retrieval changes alter generated labels and reports | Prompt-pack manifest digest |
| Evaluator or judge pack | Evaluation rules can approve or reject candidates | Evaluation-pack manifest digest |
| Replay/scenario pack | Release gates depend on exact scenario and expected evidence | Replay manifest digest |
| Release packet | Approval state joins all evidence into a deployable claim | Release packet digest |

Treat an artifact as release-affecting when it can influence a deployed model, map, label set, evaluation result, monitoring threshold, or safety-case claim.

---

## Scale Profile

| Scale | Required control | Practical implementation | Do not overbuild |
|---|---|---|---|
| S0 notebook research | Preserve provenance for reusable results | Git commit, environment lock, dataset pointer, run note, local checksums | Enterprise PKI, admission policy |
| S1 repeatable prototype | Rebuildable baseline | Container image digest, dataset manifest digest, metric script digest, checksum file | Multi-tenant policy engine |
| S2 single-product production | Signed deployable artifacts and release packet | Signed container/model/export/map artifacts, SBOM, build provenance, registry alias approval | Continuous deployment without explicit promotion |
| S3 fleet and multi-site | Site/ODD-scoped artifact trust | Per-site release manifests, tenant/site IAM boundary, signed labeler/map/replay artifacts, chargeback tags | One global trust policy for every site |
| S4 regulated safety-critical | Evidence-locked provenance | SLSA-style provenance, dual approval, trusted builder, immutable evidence store, retention hold, rollback attestation | Ticket-only approval records |
| S5 platform scale | Policy-enforced multi-tenant trust chain | Central attestation service, policy-as-code, registry admission, audit API, exception workflow, platform scorecards | Platform self-service that bypasses product safety authority |

The profile should grow with artifact authority. A research checkpoint can be identified by a checksum and run note. A champion model, runtime map, or safety-relevant labeler must be digest-pinned, signed, linked to provenance, and verified before alias movement or deployment.

---

## Attestation Types

| Attestation | What it proves | ML-specific fields to include |
|---|---|---|
| Build provenance | Who built the artifact, where, from which source and workflow | Source repo, commit, workflow/run ID, builder image, base image, dependency lock, config hash |
| SBOM | Components in a software artifact | Python wheels, CUDA/TensorRT packages, OS packages, ROS packages, model-serving libraries |
| VEX or vulnerability disposition | Whether known vulnerabilities are exploitable or accepted | Runtime exposure, GPU driver dependency, mitigation owner, expiry |
| Dataset lineage | Which data products and splits were consumed | Raw log IDs, calibration IDs, map IDs, label schema, allowed-use state, privacy tier |
| Model card or model provenance | What model was trained, evaluated, and intended for | Architecture, task, class order, preprocessing, training run, metrics, limitations |
| Export/optimization attestation | Whether ONNX/TensorRT conversion preserves intended behavior | Source checkpoint digest, exporter version, target hardware, precision, calibration cache, parity test |
| Map QA attestation | Whether source/semantic map artifacts passed publication gates | Source-map acceptance ID, tile QA, hygiene metrics, release-state confusion, localization replay |
| Labeler/prompt attestation | Whether auto-label outputs came from approved labeler artifacts | Prompt pack, model endpoint/checkpoint, retrieval corpus, thresholds, reviewer workflow |
| Evaluation attestation | Whether release metrics came from the approved eval suite | Dataset/replay IDs, metric code, slice definitions, thresholds, waiver state |
| Approval attestation | Who authorized promotion and under what scope | Artifact set hash, ODD/site scope, approvers, expiry, rollback target |

Use standard formats where possible. SLSA provenance and in-toto statements are appropriate for build-chain evidence. SPDX or CycloneDX are appropriate SBOM formats. ML-specific evidence can be attached as custom in-toto predicates when the predicate schema is controlled and versioned.

---

## Trust Chain Architecture

| Stage | Control | Release implication |
|---|---|---|
| Source | Protected branch, code owner, dependency lock, reviewed config | Unreviewed source cannot produce release artifacts |
| Build | Ephemeral or controlled builder, OIDC identity, pinned base images, isolated secrets | Provenance names the workflow and builder identity |
| Package | Digest-pinned OCI images, model files, map manifests, prompt packs, replay packs | Every artifact has immutable subject digest |
| Sign | Sigstore/Cosign, KMS-backed key, or private PKI according to environment | Signature identity is bound to policy |
| Attach | SBOM, provenance, vulnerability disposition, eval, map QA, model card | Evidence follows the artifact digest |
| Register | Model/map/eval/labeler registry stores digest, metadata, aliases, and approval state | Registry alias cannot point to unknown digest |
| Verify | CI, registry gate, Kubernetes admission, OTA/SUMS, edge startup, audit query | Deployment uses verified artifact set, not tags |
| Observe | Runtime telemetry reports active artifact IDs and compatibility hash | Incidents can reconstruct active trust state |
| Roll back | Previous signed and verified artifact set remains available | Rollback is an executable state, not a hope |

The verification boundary should be close to the behavior boundary. A build job can verify provenance before publishing. A release gate can verify before alias movement. Kubernetes or an edge orchestrator can verify container admission. OTA/SUMS can verify before activation. Vehicle startup can report active digests for incident response.

---

## Registry and Alias Policy

Model registries are useful only when aliases are tied to evidence. At S2+, alias mutation should be a policy-checked state transition:

| Alias or state | Required attestation before move |
|---|---|
| `candidate` | Training run provenance, dataset manifest, model digest, basic metric report |
| `shadow` | Runtime package digest, export/engine parity, replay smoke, rollback target |
| `canary` | Site/ODD release manifest, compatibility hash, canary entry criteria |
| `champion` | Release packet, approver record, safety/replay evidence, monitoring and rollback plan |
| `rollback` | Known-good artifact set, compatibility proof under active runtime, retained package |
| `quarantined` | Incident/evidence freeze record and reason code |

The registry should not allow a mutable tag such as `latest` to stand in for release identity. Use aliases for human workflow, but bind every alias to immutable digests and policy evidence.

---

## Policy Enforcement Patterns

| Pattern | Advantages | Disadvantages | Best fit |
|---|---|---|---|
| Checksum manifest only | Simple, works offline, low overhead | No identity, weak automation, easy to bypass | S0-S1 reproducibility |
| Signed artifact with manual review | Clear integrity check, simple release record | Review can miss missing provenance or wrong scope | S2 first production |
| Cosign/Sigstore keyless signing | Good CI identity binding and transparency-log workflow | Requires correct identity policy and offline/private deployment planning | Cloud CI and container/model artifacts |
| KMS/private PKI signing | Strong enterprise control, air-gapped compatible | Key lifecycle burden, weaker public transparency unless added | Regulated or private infrastructure |
| SLSA/in-toto provenance | Structured build-chain evidence, policy-friendly | Needs disciplined predicate schemas and trusted builders | S2-S5 build and release gates |
| SBOM plus vulnerability disposition | Supports security review and patch response | SBOM alone does not prove artifact origin or ML data lineage | Containers, Python packages, ROS stacks |
| Kubernetes admission policy | Blocks untrusted runtime workloads automatically | Covers Kubernetes workloads, not every OTA/edge/map path | Cloud/edge services and training clusters |
| OTA/SUMS manifest verification | Directly protects vehicle/map activation | Needs integration with model/map/calibration compatibility | Vehicle and managed-site rollout |
| Registry policy-as-code | Scales across teams and tenants | Can become a bottleneck if exceptions are slow | S4-S5 platform scale |

The right pattern is usually layered: signed artifacts plus provenance at build time, registry policy at promotion time, admission policy at runtime, and OTA/SUMS verification at vehicle activation.

---

## MLOps-Specific Verification Gates

| Gate | Verification question | Block condition |
|---|---|---|
| Training start | Are code, container, dataset, labels, and secrets allowed for this run? | Dataset allowed-use or privacy tier does not match task |
| Training completion | Does output model digest match recorded run, config, dataset, and hardware? | Missing run provenance or mutable dataset pointer |
| Export/optimization | Does ONNX/TensorRT artifact derive from the approved checkpoint? | Engine built from a different checkpoint, CUDA/TensorRT version, or calibration cache |
| Evaluation | Were metrics computed on approved splits/replay packs with matching artifact set? | Eval data leakage, stale replay pack, or metric code mismatch |
| Map publication | Was semantic map produced from accepted source map and approved hygiene state? | Source-map acceptance, release-state labels, or tile QA missing |
| Label promotion | Were labels produced by registered labeler/prompt/evaluator and reviewer workflow? | Unregistered prompt pack, retrieval corpus, or threshold set |
| Registry alias | Does candidate have all required attestations for target alias? | Alias movement without release packet or rollback target |
| Deployment admission | Is the runtime image/package signed, digest-pinned, and policy-compliant? | Unsigned image, untrusted signer, missing SBOM, or mutable tag |
| Vehicle activation | Does compatibility hash match model/map/calibration/runtime/telemetry evidence? | Artifact set differs from evaluated release packet |
| Incident review | Can active artifact IDs and evidence be reconstructed? | Telemetry omitted active digests or evidence was garbage-collected |

These gates should fail closed once an artifact can affect a customer, vehicle, map publication, safety evidence, or production label set.

---

## Airside and Non-Road Managed-Site Notes

For airside, campus, port, yard, warehouse, mining, construction, and service-district mapping, attestation must cover map and label artifacts as rigorously as model files.

- Semantic-map layers should carry source-map acceptance, tile manifest, taxonomy, segmentation model, projection/calibration, map-hygiene metrics, and QA evidence.
- Static-but-transient exclusions need reason-coded sidecars so a stationary person, parked GSE, construction barrier, or temporary sign does not become permanent map structure.
- VLM/open-vocabulary labels remain candidate evidence until prompt/model/retrieval/reviewer attestations and taxonomy promotion approve their allowed use.
- Site-specific release manifests should bind artifact sets to airport, yard, warehouse, campus, route, ODD cell, vehicle kit, and map state.
- Edge startup and fleet telemetry should report active compatibility hashes so incident response can query exactly which model/map/runtime/calibration set was active.

The same digest-bound evidence pattern applies whether the input is LiDAR, imagery, radar, fused BEV, map tiles, or text/retrieval context. Inputs can differ; trust boundaries must stay explicit.

---

## Minimum Metadata Schema

| Field | Required meaning |
|---|---|
| `artifact_id` | Human-readable stable ID |
| `subject_digest` | Immutable digest of the signed artifact |
| `artifact_type` | Model, container, map, prompt, label batch, dataset, eval pack, release packet, etc. |
| `producer_identity` | CI OIDC identity, service account, human approver, or signing key identity |
| `source_refs` | Git commit, dataset IDs, label batch IDs, map IDs, prompt pack IDs, dependency lock |
| `builder` | Workflow, runner class, build image, build timestamp, hardware class if relevant |
| `materials` | Base images, packages, checkpoints, calibration files, source maps, retrieval corpus |
| `predicate_type` | Provenance, SBOM, eval, map QA, labeler, approval, vulnerability disposition |
| `policy_result` | Pass/fail, policy version, exception ID, owner, expiry |
| `allowed_scope` | Site, ODD cell, vehicle cohort, data tier, runtime target, release alias |
| `rollback_target` | Prior compatible artifact set and cache state |
| `retention_class` | Evidence retention and legal/safety hold state |

This metadata can begin as a checked manifest and later move into a registry or catalog. The important property is digest-bound linkage, not the database brand.

---

## Failure Modes

| Failure mode | Consequence | Control |
|---|---|---|
| Signature accepted without identity policy | Any trusted-looking signer can publish unsafe artifacts | Verify signer identity, issuer, repo, workflow, and policy version |
| Mutable tag is signed instead of digest | Runtime can pull a different image than the evaluated one | Require digest pinning and tag-to-digest mutation |
| SBOM is not bound to artifact digest | Security review may describe a different artifact | Attach SBOM as digest-bound attestation |
| Provenance comes from untrusted runner | Build can be tampered with before signing | Use trusted builder, isolated secrets, protected workflows |
| Model signed but engine rebuilt later | Deployed TensorRT engine differs from evaluated checkpoint | Sign/export attest engine with source checkpoint and parity test |
| Dataset manifest points to mutable data | Rebuild and audit produce different training set | Use immutable snapshots and split hashes |
| Prompt pack is unversioned | Auto-labels or incident summaries drift silently | Register prompt/model/retrieval/evaluator artifacts |
| Release packet omits map/calibration IDs | Candidate passes eval against the wrong runtime context | Compatibility hash over full artifact set |
| Registry alias moved outside release process | Champion points to artifact without approval | Policy gate alias mutation and audit every change |
| Evidence retention is shorter than audit need | Incident review cannot reconstruct decision | Retention class and legal/safety hold attached to artifact |

---

## Related Pages

- `mlops-scale-research-scope.md` - maturity ladder and research backlog.
- `mlops-reference-architectures-by-scale.md` - where artifact trust belongs in S0-S5 architectures.
- `model-registry-artifact-lifecycle-by-scale.md` - registry identity, alias authority, lifecycle states, and rollback retention for signed artifacts.
- `mlops-scorecards-and-kpis-by-scale.md` - attestation metrics and release blockers.
- `model-governance-release-evidence.md` - release packets, aliases, and rollback evidence.
- `offboard-labeler-registry-by-scale.md` - labeler, prompt, evaluator, and retrieval artifacts.
- `llmops-agent-evaluation-by-scale.md` - prompt, RAG, judge, tool-agent, trace, and GenAI evaluation controls.
- `gpu-queueing-finops-by-scale.md` - queueing and cost controls for trusted build/eval capacity.
- `../data-platform/data-catalog-lineage-quality-ops.md` - lineage and data-product promotion states.
- `../ota/perception-slam-artifact-compatibility-matrix.md` - activation-time artifact-set compatibility.
- `../ota/software-update-management-system-ops.md` - SUMS-style software/update governance.
- `../../20-av-platform/compute/training-infrastructure.md` - training infrastructure and secure workers.
- `../../40-runtime-systems/software-operations/on-vehicle-supply-chain-runtime-security.md` - runtime supply-chain controls.

## Sources

- SLSA specification v1.2. https://slsa.dev/spec/latest/
- SLSA provenance format. https://slsa.dev/spec/v1.1/provenance
- in-toto attestations. https://github.com/in-toto/attestation
- Sigstore Cosign overview. https://docs.sigstore.dev/cosign/signing/overview/
- Sigstore Cosign verification. https://docs.sigstore.dev/cosign/verifying/verify/
- GitHub Docs, using artifact attestations to establish provenance for builds. https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds
- SPDX overview. https://spdx.dev/about/overview/
- CycloneDX specification overview. https://cyclonedx.org/specification/overview/
- Kyverno verify images overview. https://kyverno.io/docs/policy-types/cluster-policy/verify-images/overview/
- Kubernetes admission controllers. https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/
- Open Policy Agent for Kubernetes admission control. https://www.openpolicyagent.org/docs/latest/kubernetes-introduction/
- MLflow Model Registry workflows. https://www.mlflow.org/docs/latest/ml/model-registry/workflow/
- Weights & Biases, "Reference an artifact version with aliases." https://docs.wandb.ai/models/registry/aliases
- Google Cloud, "Model versioning with Model Registry." https://cloud.google.com/vertex-ai/docs/model-registry/versioning
- Amazon SageMaker AI, "Model Registry Models, Model Versions, and Model Groups." https://docs.aws.amazon.com/sagemaker/latest/dg/model-registry-models.html
- Kubeflow, "Kubeflow Model Registry." https://www.kubeflow.org/docs/components/model-registry/
