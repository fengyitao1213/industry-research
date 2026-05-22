# Industry Research — Claude Instructions

## Project Overview
Markdown-first knowledge base for spatial AI and autonomous systems — ~597 core docs, ~334k lines, 20 companies, 9 technology domains. A shared methods stack (perception, localization & mapping, world models, planning, simulation, safety, fleet/cloud, deployment) applied across two areas: **AV technology** — the full AV stack across road, airside, warehouse, logistics-yard, port, mining, construction, agriculture, and delivery-robot domains; and **environment mapping** — 3D reconstruction, semantic maps, and digital twins of urban districts and other non-road environments. No single application or domain is the default lens. Read as a VitePress site; the repo stays Markdown-first.

## Repository Layout
| Dir | Contents |
|---|---|
| `00-start-here/` | Reading guide, repo map, methodology + glossary pointers |
| `10-knowledge-base/` | Reusable fundamentals — probability, optimization, linear algebra, geometry, state estimation, sensors, signal processing, controls, robotics, ML |
| `20-av-platform/` | Vehicle hardware, sensors, compute, networking, drive-by-wire, power, thermal |
| `30-autonomy-stack/` | perception, localization-mapping, planning, world-models, vla-vlm, simulation, end-to-end-driving, multi-agent-v2x |
| `40-runtime-systems/` | ROS/Autoware, middleware, ML deployment, monitoring, data logging |
| `50-cloud-fleet/` | Cloud data platform, MLOps, map ops, OTA, fleet management, observability |
| `60-safety-validation/` | Safety case, standards/certification, V&V, runtime assurance, cybersecurity |
| `70-operations-domains/` | Per-domain ops — airside, warehouse, logistics-yards, ports, mining, construction, agriculture, road-av, delivery-robots, deployment-playbooks |
| `80-industry-intel/` | Company profiles, market/competitive, regulations, deployments |
| `90-synthesis/` | Master synthesis, design decisions, POC roadmaps, readiness/risk |

Root files `README.md`, `INDEX.md`, `GLOSSARY.md`, `METHODOLOGY.md` are stable entry points.

## Context & Conventions
- The user researches spatial-AI and autonomous-systems technology — world models, VLAs, and modern AI in both AV stacks and environment-mapping work. Treat every application and domain as first-class; default to none.
- New AV-stack work is a **greenfield parallel track** under Simplex.
- Generic methods/ratings should state how they transfer across domains, not assume one.
- Keep docs Markdown-first and consistent with the numbered-directory layout.

## Core Conclusions
Condensed digest; `90-synthesis/master/master-synthesis.md` is the full, maintained synthesis.
- **Architecture & safety** — Simplex through-line: neural Advanced Controller + classical Baseline Controller (Frenet, PointPillars) as certified fallback; runtime defense-in-depth Shield (LTL) → CBF-QP filter (<1 ms Orin) → Simplex failover. Fail-operational ≠ fail-safe: L4 needs a minimal-risk condition; ASIL-D decomposes into dual ASIL-B(D) channels + an independent safety MCU.
- **Compute & sensing** — Orin's ~100 ms cycle is the budget; PointPillars 6.84 ms INT8 is the safety-path detector; Thor (~1000 TOPS) enables on-vehicle world models. LiDAR-primary; 4D radar primary (not backup) in adverse weather; thermal/LWIR fixes the 84-88% night hi-vis AEB-failure rate.
- **Data & learning** — self-supervised pre-training + active learning + a data flywheel cut labeling cost 50-80%; cross-domain transfer needs only 500-1,000 LoRA/PointLoRA frames.
- **World models & AI** — ~6 open-source world-model repos are production-usable, Cosmos the lead integration candidate; DINOv2 needs adapter-mediated integration. VLMs run as a 1-2 Hz co-pilot, never in the control loop; Mamba/SSM planners beat transformers on efficiency.
- **Market & regulatory** — ISO 3691-4 covers driverless industrial trucks (warehouse, ports, logistics, airside), certification ~$130-380K over 12-24 months; EU PLD strict liability transposed by Dec 2026; the 2027 EU Machinery Regulation mandates third-party AI assessment.

## Entry Points
`INDEX.md` whole-corpus index · `GLOSSARY.md` terms · `90-synthesis/master/master-synthesis.md` executive view · `90-synthesis/master/getting-started.md` start building · `90-synthesis/poc-roadmaps/poc-proposals.md` POCs · `90-synthesis/decisions/design-spec.md` Simplex architecture · `90-synthesis/readiness-risk/technology-readiness.md` + `knowledge-gap-backlog.md` readiness & gaps · `80-industry-intel/market-competitive/competitive-landscape.md` competitive landscape · `30-autonomy-stack/perception/methods/overview.md` perception methods · `30-autonomy-stack/localization-mapping/slam-methods/overview.md` SLAM methods
