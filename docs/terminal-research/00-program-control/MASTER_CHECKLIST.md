# MASTER CHECKLIST — every deliverable (Document C Part CLXIII) → gate item (Document B §49) → artifact

Status: NOT STARTED / IN PROGRESS / DRAFT COMPLETE / MET / MET WITH BOUNDED UNKNOWNS / NOT MET. Updated at every checkpoint. Refreshed in full at the 2026-09-02 recovery checkpoint (prior version had drifted behind Wave 1/1b completion).

| # | Deliverable (Part CLXIII) | Gate item | Artifact path | Owner role(s) | Status |
|---|---|---|---|---|---|
| 1 | Executive Research Summary (one-page pointer to the Owner Decision Memo) | 23 | `13-executive-synthesis/executive-summary.md` | F-06 | NOT STARTED |
| 2 | Existing UCT System Architecture Map (all repos, both machines) | 2 | `01-existing-system/system-map.md` | F-03a ← D-01..D-14 | DRAFT COMPLETE (81 KB, 6 code locations, 5 Railway services, both machines, 25 reconciliations) |
| 3 | Existing UCT Capability Ledger | 3 | `01-existing-system/capability-ledger.md` | F-03a | DRAFT COMPLETE (211 rows, sections A-P) |
| 4 | Data Provider / API / Licensing Ledger | 4 | `02-data-providers/provider-ledger.md` | F-03b ← D-03, D-14, E-* | DRAFT COMPLETE (48 provider rows: 20 core, 7 retirement candidates, 9 dormant) |
| 5 | Benchmark Terminal Universe | 6 | `03-competitive-research/benchmark-universe.md` | B-VAL-01 | DRAFT COMPLETE (71 cited URLs; universe revised DL-017) |
| 6 | One Product Dossier per product | 6 | `03-competitive-research/<p>/dossier.md` | B-<P>-*, B-POD-<P> | 11 of 11 leaf dossiers ACCEPTED (Unusual Whales, TradingView, Koyfin, Benzinga Pro, AlphaSense, Fiscal.ai, Quartr, FactSet, LSEG Workspace, SpotGamma, adjacent light note [TIKR/YCharts/CIQ]); Wave-2 verifiers/reconstructors not yet dispatched |
| 7 | Bloomberg Deep-Dive Dossier | 7 | `03-competitive-research/bloomberg/dossier.md` | B-BBG-01..08, B-POD-BBG, B-BBG-DEEPEN, B-BBG-VERIFY | **ACCEPTED (2026-09-02 close)** — 171.8 KB, sections A-Q + Reconciliations + M/N/O/P + GAPS/SOURCES/NOT INSPECTED complete; a dedicated multi-asset deepening pass (new leaf `09-multi-asset-analytics.md`) closed the original equities-only ceiling across 33 of 36 owner-named topics, independently adversarially verified (zero fabrication, zero regression). 3 honest ceilings remain (preferred-securities depth, cross-company relationship mapping, cross-screen regime-chaining) — owner-input-bound (OI-08) |
| 8 | Gödel Terminal Dossier | 8 | `03-competitive-research/godel/dossier.md` | B-GDL-01..03, B-POD-GDL | **ACCEPTED (2026-09-02)** — full synthesis from the three accepted leaves; VERIFIED ~55 capabilities, CLAIMED ~9, REPORTED ~15, DEMONSTRATED 0 (structurally unreachable, no video channel); OI-18 (trial) is the only ceiling-raiser |
| 9 | Cross-Product Capability Matrix | 9 | `05-product-strategy/capability-matrix/capability-matrix.md` | F-05 | NOT STARTED — inputs now genuinely complete (11 dossiers + Bloomberg + Gödel all accepted, no longer blocked on synthesis) |
| 10 | Best-of-Breed Matrix | 9 | `05-product-strategy/capability-matrix/best-of-breed.md` | F-05 | NOT STARTED |
| 11 | Anti-Pattern Library | 13 | `05-product-strategy/anti-patterns.md` | F-01 | NOT STARTED |
| 12 | User Persona Framework | 10 | `04-workflows/personas.md` | F-07 | NOT STARTED |
| 13 | Jobs-to-be-Done Library (30+) | 10 | `04-workflows/jobs-to-be-done.md` | F-07 | NOT STARTED |
| 14 | Professional Workflow Library | 10 | `04-workflows/workflow-library.md` | F-07 | NOT STARTED |
| 15 | UCT Proprietary Advantage Inventory | 11 | `05-product-strategy/proprietary-advantage-inventory.md` | F-05 ← D-13 | Raw inventory ACCEPTED (D-13, 68 KB: decision provenance and first-party narrative as the moat); F-05 synthesis into the final inventory NOT STARTED |
| 16 | Feature Opportunity Backlog | 13 | `05-product-strategy/feature-opportunity-backlog.md` | F-05, A-03 | NOT STARTED |
| 17 | Feature Scoring Matrix | 13 | `05-product-strategy/feature-scoring.md` | F-05 | NOT STARTED |
| 18 | Product Vision (+ one-sentence philosophy, non-goals) | 13 | `05-product-strategy/product-vision.md`, `non-goals.md` | A-03, F-06 | NOT STARTED |
| 19 | Information Architecture | 14 | `06-ux-and-information-architecture/information-architecture.md` | ARCH-08 | NOT STARTED — inputs (command-grammars, workspace survey) ready |
| 20 | Workspace Interaction Architecture (fixed / modular / hybrid decision) | 14 | `06-ux-and-information-architecture/fixed-modular-hybrid.md` | C5-03, ARCH-01..03 | NOT STARTED — C5-01 (workspace survey) and C5-02 (personalization, partial) feed this; early signal favors fixed/hybrid over modular (six of seven observed failure modes are persistence, not layout) |
| 21 | Data Architecture | 15 | `07-technical-architecture/data-architecture.md` | ARCH-04 | NOT STARTED — C7-01 (streaming/caching, accepted), C7-02 (partial), C7-03 (not started) feed this |
| 22 | AI Architecture | 15 | `08-ai/ai-architecture.md` | ARCH-05 | NOT STARTED — D-12, C6-01, C6-02 (all accepted) feed this; E-06 cost model supplies the 15 guard constraints |
| 23 | Security & Entitlement Architecture | 15 | `09-security-licensing-cost/security-entitlement-architecture.md` | ARCH-06 | NOT STARTED — D-10 (flags/entitlements), R-17 (unauthenticated endpoints), licensing register feed this |
| 24 | Performance Architecture | 15 | `07-technical-architecture/realtime-performance-architecture.md` | ARCH-07 | NOT STARTED — D-05, C7-01 feed this |
| 25 | Observability Architecture | 21 | `10-roadmap/observability-plan.md` | ARCH-07, H-06 | NOT STARTED |
| 26 | Migration / Coexistence Strategy (+ legacy parity matrix, migration gates) | 16 | `10-roadmap/coexistence.md` | H-07 ← D-08, D-09 | Current-mechanisms input ACCEPTED (D-08: 4 precedents, replace-cost inventory); H-07 synthesis NOT STARTED |
| 27 | MVP Definition | 18 | `10-roadmap/mvp.md` | A-03, H-01 | NOT STARTED |
| 28 | Implementation Roadmap (NOW / NEXT / LATER / NOT PLANNED; three horizons) | 21 | `10-roadmap/roadmap.md` | H-03, A-01 | NOT STARTED |
| 29 | Technical Dependency Graph (+ parallel build graph) | 19 | `10-roadmap/dependency-graph.md` | H-04 | NOT STARTED |
| 30 | Engineering Backlog (Part CCI schema) | 20 | `10-roadmap/backlog.md` | H-03 | NOT STARTED |
| 31 | Architecture Decision Records | 15 | `12-decisions/adr/ADR-*.md` | ARCH-*, A-01 | NOT STARTED |
| 32 | Risk Register | 22 | `00-program-control/RISK_REGISTER.md` → final copy `11-risks-and-open-questions/risk-register.md` | orchestrator | DRAFT (19 risks, R-01..R-19) |
| 33 | Open Questions Register | 22 | `00-program-control/OPEN_QUESTIONS.md` → final copy `11-risks-and-open-questions/open-questions.md` | orchestrator | DRAFT (16 questions, OQ-01..OQ-16) |
| 34 | Cost Model (six scenarios; labeled assumptions) | 22 | `09-security-licensing-cost/cost-model.md` | E-05, E-06 | Inputs COMPLETE (E-05 data/infra, E-06 AI/infra, both accepted); final merged `cost-model.md` NOT STARTED |
| 35 | Success Metrics | 21 | `10-roadmap/success-metrics.md` | A-02, H-06 | NOT STARTED |
| 36 | Testing Strategy | 21 | `10-roadmap/testing-plan.md` | H-06 | NOT STARTED |
| 37 | Rollout Strategy (+ rollback) | 21 | `10-roadmap/rollout-rollback.md` | H-07 | NOT STARTED |
| 38 | Final Executive Recommendation (Owner Decision Memo, ≤4 pages) | 23 | `13-executive-synthesis/owner-decision-memo.md` | F-06, A-01 | NOT STARTED |
| — | Master Plan (Part CC) | 24 | `13-executive-synthesis/MASTER_PLAN.md` | F-06, A-01 | NOT STARTED |
| — | Forty executive questions | 12 | `13-executive-synthesis/executive-questions.md` | F-06 | DRAFT COMPLETE — all 40 answered; scoreboard 10 green / 23 yellow / 7 red; reallocation advice included |
| — | Hypothesis register | 12 | `13-executive-synthesis/hypothesis-register.md` | F-08 | DRAFT COMPLETE — 35 hypotheses (H1-H5 seed + H6-H35 evidence-raised), 57 table rows |
| — | Licensing register | 5 | `09-security-licensing-cost/licensing-register.md` | F-04 | DRAFT COMPLETE — 118 rows (3 Allowed, 7 Likely Allowed, 81 Restricted, 18 Unknown, 8 Unsuitable), 24 escalations, 19 addenda |
| — | Terminal-Current map | 1 | `01-existing-system/terminal-current-map.md` | D-09 | DRAFT COMPLETE — 4 views, 12-panel modal, 31 `/api/calendar/*` routes, 9 readers of the API, 32-item what-users-would-lose list |
| — | Red-team verdicts | 17 | `12-decisions/red-team/` | G-* | NOT STARTED (G-01-D2 light pass contract written, not yet dispatched) |
| — | First vertical slice | 18 | `10-roadmap/first-slice.md` | H-01 | NOT STARTED |
| — | Protection rail | 25 | `00-program-control/protection-rail.md` | orchestrator | PASS at R1 (recovery checkpoint) — app diff empty, frontend 31/31, backend 374 passed, prod health/calendar 200 |
| — | Readiness test | 26 | `00-program-control/readiness-test.md` | H-08 | NOT RUN (Day 7) |
| — | Day 1 executive synthesis | 12 (Doc A required Day-1 artifact) | `13-executive-synthesis/DAY_1_EXECUTIVE_SYNTHESIS.md` | F-06 | NOT STARTED — deliverable 2 of F-06's contract; killed by the 3rd pause before it began; executive-questions.md (deliverable 1) is done and is its primary input |
| — | Orientation memo (Part CLXXIX) | — | `13-executive-synthesis/orientation-memo.md` | orchestrator | COMPLETE (delivered before Day 1b approval) |
| — | Cost model: data/infra | 22 (feeds #34) | `09-security-licensing-cost/cost-model-data.md` | E-05 | DRAFT COMPLETE |
| — | Cost model: AI/infra | 22 (feeds #34) | `09-security-licensing-cost/cost-model-ai-infra.md` | E-06 | DRAFT COMPLETE |
| — | Data-use classification | 5 (feeds #4/#38) | `09-security-licensing-cost/data-use-classification.md` | E-02 | DRAFT COMPLETE |
| — | Tech-debt register | 22-adjacent | `01-existing-system/tech-debt-register.md` | F-03a | DRAFT COMPLETE (72 entries, 4 classes) |
| — | Ecosystem cartography (both machines, scheduler) | 2 (feeds #2) | `01-existing-system/ecosystem-cartography.md` | D-14 | DRAFT COMPLETE (34 scheduled tasks confirmed; 4 silently failing) |
| — | AI-native tools survey | 9 (feeds #9) | `08-ai/ai-native-tools-survey.md` | C6-01 | DRAFT COMPLETE (15 products) |
| — | Grounding/citation architectures | 15/22 (feeds #22) | `08-ai/grounding-architectures.md` | C6-02 | DRAFT COMPLETE |
| — | Workspace systems survey | 14 (feeds #20) | `06-ux-and-information-architecture/workspace-systems-survey.md` | C5-01 | DRAFT COMPLETE |
| — | Command grammars | 14 (feeds #19) | `06-ux-and-information-architecture/command-grammars.md` | C4-01 | DRAFT COMPLETE |
| — | Streaming/caching architectures | 15 (feeds #21/#24) | `07-technical-architecture/domain-streaming-caching.md` | C7-01 | DRAFT COMPLETE |
| — | Personalization patterns | 14 (feeds #20) | `06-ux-and-information-architecture/personalization-patterns.md` | C5-02 | PARTIALLY COMPLETE — §1-2 internal patterns done; external research pending completion re-dispatch |
| — | Symbol master / time model | 15 (feeds #21) | `07-technical-architecture/domain-symbol-master-time.md` | C7-02 | PARTIALLY COMPLETE — §0-1 internal baseline done; external patterns + GAPS/SOURCES pending completion re-dispatch |
| — | Vendor abstraction / data platform | 15 (feeds #21) | `07-technical-architecture/domain-data-platform.md` | C7-03 | NOT STARTED (killed before any output; re-dispatch pending) |
| — | News architecture patterns | 4 (feeds #9) | `05-product-strategy/domain-news-intelligence.md` | C2-01 | NOT STARTED (killed before any output; re-dispatch pending) |
| — | Events intelligence patterns | 1/37 (feeds #26) | `05-product-strategy/domain-events-intelligence.md` | C2-02 | NOT STARTED (stub discarded; re-dispatch pending) |
| — | Desk-tool reports (thinkorswim, TradingView, Finviz, Market Chameleon) | 6 (feeds #9) | `03-competitive-research/desk-tools/*.md` | B-DESK-01..04 | DRAFT COMPLETE — all 4 accepted |
