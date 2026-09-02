# AGENT REGISTRY — capability probe, model classes, coverage map, waves

## 1. Capability probe (Document B §8) — run 2026-09-02 05:39–05:42 UTC

| Measurement | Result | Evidence |
|---|---|---|
| Orchestrator model / context | Claude Fable 5.1 (`claude-fable-5-1[1m]`), 1M-token context, effort xhigh | `~/.claude/settings.json`; session banner |
| Session token budget | ~15M tokens for the orchestrator's own context across the session; delegated-agent tokens are NOT charged against it (verified: 10 probes consumed ~503k agent tokens while the orchestrator budget moved ~30k) | probe accounting |
| Orchestration primitives | `Agent` tool (general-purpose / Explore / Plan / fork), background execution with completion notifications, `SendMessage` to continue an agent, model override per agent, `isolation: worktree`; `Workflow` tool (script-driven fan-out, default guideline ≤15 agents per workflow) — authorized by the owner | tool roster |
| Models available to delegated agents | Haiku 4.5 (`claude-haiku-4-5-20251001`), Sonnet 5 (`claude-sonnet-5`), Opus 5 (`claude-opus-5[1m]`, 1M context), Fable 5.1 (`claude-fable-5-1`) | PROBE-01..10 reports in the session scratchpad |
| Tools available to delegated agents | Bash, PowerShell, Read/Write/Edit, Glob/Grep, WebSearch (works, but a SHARED per-session cap of 200 searches was exhausted at ~11:20 UTC on Day 1b — later roles use WebFetch + browser search; DDG HTML answers WebFetch with a captcha, Bing answers but mis-tokenizes unquoted queries), WebFetch (works on resolvable hosts; the probe URL `help.koyfin.com` does not resolve — DNS, not a block; `https://www.koyfin.com/` fetched fine), browser MCP `mcp__claude-in-chrome__*` (22–28 deferred tools; usable for authenticated or JS-rendered pages), Agent (nested) | PROBE reports |
| Maximum safe concurrency | **10 concurrent tasks measured** (10 dispatched in one message, all completed, no errors, wall clock 2 min 13 s). Working rule: batches of 10, top up as tasks complete. Higher counts are unmeasured; re-measure only if a wave needs it. | dispatch 05:39:39Z → last END 05:41:52Z |
| Per-probe cost | 42–61k tokens for 6–9 tool calls (mostly system prompt); a real leaf task is estimated at 300k–900k tokens | probe usage lines |
| Known failures | `plugin:github` MCP fails to connect (400, auth header) — irrelevant to this program | PROBE-08/09/10 |
| Usage-limit behavior | OBSERVED 2026-09-02 ~08:05 UTC after 17 Opus leaf tasks plus 3 synthesis tasks: HTTP 429 "session limit, resets 04:20 America/Chicago"; three in-flight tasks lost before writing; re-dispatched 10:41 UTC. Working rule: ≤10 in flight, write-core-first instruction in every synthesis contract, no nested sub-agents. | DL-014 |

### Rough program token estimate (Day 1 checkpoint requirement)

~120 delegated tasks × ~0.5M tokens ≈ 60M agent tokens, plus the orchestrator's own context (multiple compactions of a 1M window across the week). Not billed per token on the Max seat; the binding constraint is the seat's usage window, which may pause a wave.

## 2. Model class per role class (OWNER_SEED_FACTS §5; DECISION_LOG DL-003)

| Role class | Model | Rationale |
|---|---|---|
| Leaf-depth: internal archaeology (D-*), licensing readers/classifiers (E-01..E-04), Bloomberg workflow roles (B-BBG-*), Gödel verifier, dossier authors, domain pods (C-*) | **Opus 5 [1m]** | judgment-heavy reading of large code or legal text; 1M context for big files |
| Leaf-breadth: dossier verifiers, workflow reconstructors, Gödel evidence collector, desk-tool reconstructors | **Sonnet 5** | bounded, source-collection missions with a strict schema |
| Synthesis (F-*), council review (A-*), red team (G-*), implementation planning (H-*), architecture proposal authors (ARCH-*), readiness tester | **Fable 5.1** | strongest available, per the seed facts |
| Probes, index generation, mechanical checks | Haiku 4.5 | cost of the seat's window |

## 3. Coverage map — every research question → one owning role

IDs are used in file names and citations. "Owning questions" cite Document C parts; the appendix checklist (Parts CCCLXX–CDLXV) is assigned by cluster in the last column. Destination = the role's single output file under `docs/terminal-research/`.

### Group A — Executive Product Council (review tasks at checkpoints; Fable)

| ID | Role | Owns | Runs |
|---|---|---|---|
| A-01 | Program Director / Chief Architect | conflict resolution, standards, the checkpoint verdict | every checkpoint |
| A-02 | CEO / Business Strategy | Part XVIII, XIX, CLXXXV Q36–40, cost/tier escalations | Day 3, 5, 7 |
| A-03 | Chief Product Officer | Part XLVI principles, tiers (CLXXXVI), non-goals (CXCV), Q1–5 | Day 3, 5, 7 |
| A-04 | Head of Trading + PM/Fundamental lens | Parts XV, XVI, LXVII desk simulation, Q6–15 | Day 3, 5, 7 |
| A-05 | Market Data / Quant / UX lens | Parts XXVII–XXXV, XLVII, Q16–30 | Day 4, 5, 7 |
| A-06 | Security, Licensing & Reliability | Parts XL, XLI, LVI, LVII, CXIX, Q19 | Day 2, 5, 7 |

### Group D — Internal system team (Wave 1, Day 1a; Opus)

| ID | Role | Owning questions (Document C) | Destination |
|---|---|---|---|
| D-01 | Front-end archaeologist | Part IV (front-end half), XXXIII–XXXIV, CXXI, CXXII (routing), appendix CCCXCIX–CDIV | `01-existing-system/frontend-archaeology.md` |
| D-02 | Backend archaeologist | Part IV (backend half), LXXIX, LXXXI, CXVI, CXIX (auth surface) | `01-existing-system/backend-archaeology.md` |
| D-03 | Data/API archaeologist (dashboard providers) | Part VI (dashboard), CII, CXXXIX–CXLIII, CXCVIII; status vocabulary | `02-data-providers/provider-inventory-dashboard.md` |
| D-04 | Database & infrastructure archaeologist | Part IV (DB/infra), CI, CCCIX–CCCX, CCCXIX–CCCXX, deployment | `01-existing-system/database-and-infrastructure.md` |
| D-05 | Performance & real-time systems | Parts XXX, XXXI, LXXX, CXX (baseline design), CCCXIII–CCCXVIII, CDVI–CDXV | `07-technical-architecture/current-performance-and-realtime.md` |
| D-06 | Terminal UI architecture | Parts XXXIII, XXXIV, XXXV, LXVIII (current keyboard), CXXI, CCXIII, CCCXXXIII–CCCXXXV | `07-technical-architecture/current-ui-architecture.md` |
| D-07 | Testing / reliability / observability | Parts LVI, LVII, LVIII, CLV, CDXV, CDXLV–CDLVII; rail check (2) commands | `01-existing-system/testing-reliability-observability.md` |
| D-08 | Migration / coexistence architect | Parts XXXVIII, CX–CXII, CXXII (future route), CCXXXII, CDLXI–CDLXIII | `10-roadmap/coexistence-current-mechanisms.md` |
| D-09 | Terminal-Current surface specialist | Parts XXXVII, CXXII, CXXIII (calendar prefs), CCXXXIII, CDXXXIV–CDXXXVI; gate item 1 | `01-existing-system/terminal-current-map.md` |
| D-10 | Feature flags & entitlements | Parts XXXIX, XL, LXXXVIII (current), CCXXVIII, CDXVI–CDXVIII | `01-existing-system/flags-and-entitlements.md` |
| D-11 | State, persistence, existing workspace/widget system | Parts XXXII, XLIII, LIV, CXXIII, CXXIV, CXCIX, CCXXII, CCCXXXVII–CCCXXXVIII | `01-existing-system/state-persistence-and-workspaces.md` |
| D-12 | Existing AI systems | Parts XXV (current), LXXXIII–LXXXIV (current), CCLXXXIX–CCXCI (current), CDXXXIX–CDXLIV (current) | `08-ai/existing-ai-systems.md` |
| D-13 | Proprietary content & intelligence inventory | Parts XXII (B), XXVI, LXX (assets), CCLXV, CCCIV–CCCVIII | `05-product-strategy/proprietary-asset-inventory-raw.md` |
| D-14 | Multi-repository cartographer & scheduled-jobs mapper | Parts IIIA, VI (non-dashboard repos), CCCIX, both machines, Railway services, external surfaces | `01-existing-system/ecosystem-cartography.md` |

### Group E — Licensing, data rights, cost (Wave 1 for E-01/E-03/E-04; Opus)

| ID | Role | Owning questions | Wave | Destination |
|---|---|---|---|---|
| E-01 | Vendor terms reader | Part XLI (terms evidence), CCCXXI–CCCXXVI (terms side) | 1 | `09-security-licensing-cost/vendor-terms-evidence.md` |
| E-02 | Storage, caching, AI-use classifier | Part XLI classification, CCCXXV, CDXXI–CDXXII | 1b (after E-01) | `09-security-licensing-cost/data-use-classification.md` |
| E-03 | Real-time & exchange-fee classifier | Part CCCXXIV, XXX (rights side) | 1 | `09-security-licensing-cost/realtime-and-exchange-classification.md` |
| E-04 | Derived-data rights | Parts CCLXIII, CCCXXII–CCCXXIII (derived side) | 1 | `09-security-licensing-cost/derived-data-rights.md` |
| E-05 | Cost model: fixed and per-user, six scenarios | Part XLII | 2 | `09-security-licensing-cost/cost-model-data.md` |
| E-06 | Cost model: AI inference, infrastructure, feature attribution | Parts CCXC, CCCXXVII | 2 | `09-security-licensing-cost/cost-model-ai-infra.md` |

### Group B — Competitive terminal research (Wave 1b on approval; Wave 2 depth)

| ID | Role | Owning questions | Wave | Model | Destination |
|---|---|---|---|---|---|
| B-VAL-01 | Benchmark universe validator | Part VII validation; redundancy substitution | 1b | Opus | `03-competitive-research/benchmark-universe.md` |
| B-BBG-01 | Bloomberg: search & navigation | Parts VIII, CCXLV (begin, discover, move between securities) | 1b | Opus | `03-competitive-research/bloomberg/01-search-navigation.md` |
| B-BBG-02 | Bloomberg: monitors & workspaces (Launchpad) | VIII, XXI (BBG side), CCXLV (configure, save) | 1b | Opus | `bloomberg/02-monitors-workspaces.md` |
| B-BBG-03 | Bloomberg: news & alerts | VIII, XXXVI (BBG side), CCXLV (alerts, news+analysis) | 1b | Opus | `bloomberg/03-news-alerts.md` |
| B-BBG-04 | Bloomberg: earnings & estimates | VIII, XIV-B, CCXLV (research earnings) | 1b | Opus | `bloomberg/04-earnings-estimates.md` |
| B-BBG-05 | Bloomberg: fundamentals & valuation | VIII, XIV-C, CCXLV (provenance) | 1b | Opus | `bloomberg/05-fundamentals-valuation.md` |
| B-BBG-06 | Bloomberg: screening & charting | VIII, XIV-E, CCXLV (screen) | 1b | Opus | `bloomberg/06-screening-charting.md` |
| B-BBG-07 | Bloomberg: collaboration, export, API | VIII, CXXX, CCXLV (collaborate) | 1b | Opus | `bloomberg/07-collaboration-export-api.md` |
| B-BBG-08 | Bloomberg: why professionals stay all day | Parts XVII (B), CXV, CLXX, CCXLV (last question), CCLIX | 1b | Opus | `bloomberg/08-why-they-stay.md` |
| B-POD-BBG | Bloomberg pod synthesis → dossier | Part LX template; gate item 7 | 2 | Fable | `bloomberg/dossier.md` |
| B-GDL-01 | Gödel: evidence collector | Part IX (verify existence, sources, demos) | 1b | Sonnet | `godel/01-evidence.md` |
| B-GDL-02 | Gödel: capability verifier | Part IX (verified / demonstrated / claimed / speculated) | 2 | Opus | `godel/02-verification.md` |
| B-GDL-03 | Gödel: idea extractor | Part IX (transferable ideas), XXV | 2 | Sonnet | `godel/03-ideas.md` |
| B-POD-GDL | Gödel pod synthesis → dossier | gate item 8 | 2 | Fable | `godel/dossier.md` |
| B-<P>-01 | Dossier author, one per product P in {LSEG, FDS (FactSet), CIQ (Capital IQ Pro), KOY (Koyfin), TV (TradingView), AS (AlphaSense), FC (FinChat), TIKR, QTR (Quartr), YC (YCharts), BZ (Benzinga Pro)} | Part LX sections A–P, CCXLVII philosophy | 1b | Opus | `03-competitive-research/<p>/dossier.md` (draft) |
| B-<P>-02 | Workflow reconstructor per surviving product | Part CCXLVI (five equivalent workflows) | 2 | Sonnet | `<p>/workflows.md` |
| B-<P>-03 | Verifier per surviving product | five most consequential claims | 2 | Sonnet | `<p>/verification.md` |
| B-POD-<P> | Pod synthesis → final dossier | gate item 6 | 2 | Fable | `<p>/dossier.md` (final) |
| B-DESK-01 | thinkorswim / Schwab as the desk uses it | Executive Q8–10; OWNER_SEED_FACTS desk tools | 1b | Sonnet | `03-competitive-research/desk-tools/thinkorswim.md` |
| B-DESK-02 | TradingView as the desk uses it (workflows, not the dossier) | Q8–10 | 1b | Sonnet | `desk-tools/tradingview-desk-use.md` |
| B-DESK-03 | Finviz as the desk uses it | Q8–10 | 1b | Sonnet | `desk-tools/finviz.md` |
| B-DESK-04 | The fourth tool discovered by internal research | Q8–10 | 2 | Sonnet | `desk-tools/<tool>.md` |

### Group C — Cross-product domain pods (Wave 1b/2; Opus unless noted)

| ID | Pod / role | Owning questions | Wave | Destination |
|---|---|---|---|---|
| C1-01 | Fundamental: statements, valuation, estimates, guidance | Parts XIII §3, CXXXIX, CXL, CCLXVII–CCCLXVIII, appendix CCCLXX–CCCLXXI | 2 | `04-workflows/../` → `05-product-strategy/domain-fundamental-intelligence.md` |
| C1-02 | Fundamental: ownership, insiders, peers, corporate actions | appendix CCCLXXIII–CCCLXXVII, CCCLXVI | 2 | `05-product-strategy/domain-ownership-peers.md` |
| C2-01 | News architecture patterns | Parts XXXVI, CXLIII–CXLV, CCXVIII, appendix CCCLXXXIV | 2 | `05-product-strategy/domain-news-intelligence.md` |
| C2-02 | Event & calendar intelligence (Events Intelligence concept) | Parts XXXVII (target), CXXXIV, CCXVII, CCLXXI, appendix CDXXXV–CDXXXVI | 2 | `05-product-strategy/domain-events-intelligence.md` |
| C2-03 | Alerts and notifications | Parts LIII, CXXXII, CCLXXXIV, appendix CCCLXXXV–CCCLXXXVI, CDXXVI | 2 | `05-product-strategy/domain-alerts.md` |
| C3-01 | Charting patterns across products | Parts XIII §8, XXXV (benchmark side), CXXXVII | 2 | `05-product-strategy/domain-charting.md` |
| C3-02 | Market visualization: overview, breadth, heatmaps, macro | Parts XIII §1, §6, LXXI, appendix CCCLXXVIII–CCCLXXXIII | 2 | `05-product-strategy/domain-market-overview.md` |
| C4-01 | Terminal command grammars (Bloomberg-style and modern) | Parts XXIII, CL–CLI, CCCXLVIII–CCCLIII, appendix CCCXC–CCCXCIII, CDXLIII | 1b | `06-ux-and-information-architecture/command-grammars.md` |
| C4-02 | Command palettes and search in IDEs/software | Parts CLXXI, CLXXII, LXVIII | 2 | `06-ux-and-information-architecture/command-palette-patterns.md` |
| C4-03 | Global search & entity resolution | Parts XXIV, LXXVIII, CCCLVIII–CCCLX, CCLXIX | 2 | `06-ux-and-information-architecture/search-and-entity-resolution.md` |
| C5-01 | Workspace systems survey (docking, grids, linking; libraries) | Parts XXI (survey), XXII, L, LI, CCCXXXIV–CCCXXXVI, CDI | 1b | `06-ux-and-information-architecture/workspace-systems-survey.md` |
| C5-02 | Personalization, density, templates, saved objects | Parts XLVIII, XLIX, LIV, CXLVI–CXLIX, CCCXL–CCCXLIII | 2 | `06-ux-and-information-architecture/personalization-patterns.md` |
| C5-03 | Fixed / modular / hybrid comparison author (gated deliverable) | Parts XXI, CCVII, LXXII | 3 (Fable) | `06-ux-and-information-architecture/fixed-modular-hybrid.md` |
| C6-01 | AI-native financial tools survey | Parts XXV, XIII §13, CXXXV | 2 | `08-ai/ai-native-tools-survey.md` |
| C6-02 | Grounding, citation, provenance architectures | Parts XXVIII, LXXXIII, LXXXIV, CCLXXXVII, appendix CDXXXIX–CDXLIV | 2 | `08-ai/grounding-architectures.md` |
| C6-03 | Agentic workflows, AI actions, permissions, cost control | Parts CCLXXXV–CCXCII | 2 | `08-ai/agentic-patterns.md` |
| C7-01 | Streaming, caching, load architectures for terminals | Parts XXX, LXXX, CCCXIII–CCCXVIII, appendix CDVI–CDXIV | 1b | `07-technical-architecture/domain-streaming-caching.md` |
| C7-02 | Symbol master, corporate actions, time/session model | Parts LXXVI–LXXVIII, CXXXIX, appendix CDXXVII–CDXXXVIII | 2 | `07-technical-architecture/domain-symbol-master-time.md` |
| C7-03 | Vendor abstraction, normalization, provenance, data dictionary | Parts XXVII–XXIX, CLIV, CCCLXI–CCCLXIV | 2 | `07-technical-architecture/domain-data-platform.md` |
| C8-01 | Onboarding, progressive disclosure, education in context | Parts XVII, LXXXIX, XC, CCLXXII–CCLXXV, CCCVII | 2 | `05-product-strategy/domain-member-experience.md` |
| C8-02 | Pricing, tiering, retention, commercial patterns | Parts LXXXVIII, CVII, CCXXXVI, Q36–40 inputs | 2 | `05-product-strategy/domain-commercial-patterns.md` |

### Group F — Synthesis (Fable; dispatched when inputs exist)

| ID | Role | Writes (canonical; single writer) | Wave |
|---|---|---|---|
| F-01 | Competitive cluster synthesizer | `03-competitive-research/cross-product-synthesis.md`, anti-pattern library `05-product-strategy/anti-patterns.md` | 2–3 |
| F-02 | Domain-pod synthesizer | `05-product-strategy/domain-synthesis.md` | 2–3 |
| F-03a | Internal synthesizer: system map + capability ledger | `01-existing-system/system-map.md`, `01-existing-system/capability-ledger.md`, `01-existing-system/tech-debt-register.md` | 2 |
| F-03b | Internal synthesizer: provider ledger | `02-data-providers/provider-ledger.md` | 2 |
| F-04 | Licensing/cost synthesizer | `09-security-licensing-cost/licensing-register.md` | 2–3 |
| F-05 | Cross-pod synthesizer | `05-product-strategy/capability-matrix/` (matrix, best-of-breed), `05-product-strategy/proprietary-advantage-inventory.md` | 3 |
| F-06 | Executive synthesizer | `13-executive-synthesis/executive-questions.md`, `DAY_N_EXECUTIVE_SYNTHESIS.md`, checkpoints | every day |
| F-07 | Workflow / JTBD synthesizer | `04-workflows/personas.md`, `jobs-to-be-done.md`, `workflow-library.md`, `daily-journey.md` | 3 |
| F-08 | Hypothesis-register keeper | `13-executive-synthesis/hypothesis-register.md` | every day |

### Group G — Red team (Fable)

| ID | Role | Gate | Destination |
|---|---|---|---|
| G-01 | Product Skeptic | Day 2 light (benchmark), Day 3 light (prioritization), Day 5 heavy, Day 7 final | `12-decisions/red-team/<day>-product.md` |
| G-02 | Architecture Skeptic | Day 5 heavy, Day 7 | `red-team/<day>-architecture.md` |
| G-03 | Trader Skeptic | Day 3 light, Day 5, Day 7 | `red-team/<day>-trader.md` |
| G-04 | Commercial / Cost Skeptic | Day 5, Day 7 | `red-team/<day>-commercial.md` |
| G-05 | First-Principles Challenger (Part CCXXXIV) | Day 5 | `red-team/day5-first-principles.md` |
| G-06 | "Why should we not build this" (Part CCXL) | Day 5, Day 7 | `red-team/<day>-why-not.md` |

### ARCH — Day 4 competing proposal authors (Fable; added under extreme ownership, DL-004)

| ID | Proposal | Destination |
|---|---|---|
| ARCH-01 | Target architecture A: fixed, deeply optimized page model | `07-technical-architecture/target-A-fixed-pages.md` |
| ARCH-02 | Target architecture B: hybrid fixed pages + a small number of linked panels | `07-technical-architecture/target-B-hybrid.md` |
| ARCH-03 | Target architecture C: modular workspace | `07-technical-architecture/target-C-modular.md` |
| ARCH-04 | Data & provider architecture (canonical model, adapters, provenance) | `07-technical-architecture/data-architecture.md` |
| ARCH-05 | AI architecture | `08-ai/ai-architecture.md` |
| ARCH-06 | Security & entitlement architecture | `09-security-licensing-cost/security-entitlement-architecture.md` |
| ARCH-07 | Real-time, performance, reliability, observability architecture | `07-technical-architecture/realtime-performance-architecture.md` |
| ARCH-08 | Information architecture & terminal design spec | `06-ux-and-information-architecture/information-architecture.md`, `terminal-design-spec.md` |

### Group H — Implementation planning (Fable; Days 4–7)

| ID | Role | Destination |
|---|---|---|
| H-01 | Vertical-slice specifier 1 (leading candidate) | `10-roadmap/first-slice.md` |
| H-02 | Vertical-slice specifier 2 (runner-up, skeleton) | `10-roadmap/slice-candidate-2.md` |
| H-03 | Backlog author (Part CCI schema) | `10-roadmap/backlog.md` |
| H-04 | Dependency grapher / parallel build graph | `10-roadmap/dependency-graph.md` |
| H-05 | Code-impact mapper / code ownership map | `10-roadmap/code-impact-map.md` |
| H-06 | Test strategist | `10-roadmap/testing-plan.md` |
| H-07 | Rollout / rollback planner; coexistence plan | `10-roadmap/rollout-rollback.md`, `10-roadmap/coexistence.md` |
| H-08 | Readiness tester (gate item 26) | `00-program-control/readiness-test.md` |

Role-slot count: A6 + D14 + E6 + B(1+8+1+3+1+33+11+4)=62 + C21 + F9 + G6 + ARCH8 + H8 = 140 slots; ~105 distinct roles after the per-product roles are counted once. The coverage map, not the count, is the requirement.

## 4. Wave plan at measured concurrency (10 per batch, top-up on completion)

| Wave | Program day | Tasks | Batches |
|---|---|---|---|
| 1 (internal + licensing) | 1a | D-01..D-14, E-01, E-03, E-04 (17) | 10 now, 7 on top-up |
| 1b (external landscape) | 1b on approval | B-VAL-01, B-BBG-01..08, B-GDL-01, 11 dossier authors, B-DESK-01..03, C4-01, C5-01, C7-01, E-02 (28) | 3 batches |
| 2 (targeted depth + first synthesis) | 2 | B-GDL-02/03, verifiers and reconstructors for surviving products, B-DESK-04, C1/C2/C3/C6/C8 pods, C4-02/03, C5-02, C7-02/03, E-05/06, F-03a/b, F-04, pod syntheses, F-06 draft of the forty questions, F-08, G-01 light | ~50 tasks in 5 batches |
| 3 (workflow + opportunity synthesis) | 3 | F-07, F-05, F-01, F-02, C5-03, council A-01..A-06, G-01/G-03 light, owner batch 2 | ~15 |
| 4 (architecture) | 4 | ARCH-01..08, H-01/H-02 skeletons, ADR authors | ~12 |
| 5 (red team + roadmap) | 5 | G-01..G-06 heavy, tiers/MVP/first-slice/dependency/coexistence revisions | ~12 |
| 6 (implementation-ready plan) | 6 | H-03..H-07, specs, code-impact, tests, rollout | ~10 |
| 7 (validation + master plan) | 7 | citation validation, G final, H-08 readiness test, owner memo, MASTER_PLAN, rail | ~8 |

## 5. Dispatch ledger

| ID | Wave | Status | Dispatched (UTC) | Returned | QC (ACCEPT / ACCEPT WITH GAPS / RESEARCH AGAIN / DISCARD) | Notes |
|---|---|---|---|---|---|---|
| PROBE-01..10 | probe | done | 2026-09-02 05:39 | 05:42 | ACCEPT | see §1 |
| D-08 | 1 | done | 06:02 | 06:55 (72 calls, 284k) | ACCEPT — coexistence mechanisms with four precedents and the replace-cost inventory (5 persisted prefs, 1 widget-type key, 2 embed hosts, 3 external consumers, free-tier deep-link path); corrects the rename SHA and the `/r/calendar` consumer (morning-wire + Sunday Scan screenshots, not the chart renderer) | `10-roadmap/coexistence-current-mechanisms.md`; cohort gap → RG-04 |
| D-01 | 1 | done | 06:02 | 06:58 (61 calls, 320k) | ACCEPT — 285 KLOC / 2,068 modules measured; strong correctness rails, weak structural enforcement (15.5k-line `StockChart.jsx`, 5 sort + 4 CSV impls, 25+ formatters, no shared table/shortcut registry); corrects 10 stale CLAUDE.md claims | `01-existing-system/frontend-archaeology.md`; open qs → RG-07, RG-09, RG-10 |
| D-02 | 1 | done | 06:02 | 07:00 (71 calls, 327k) | ACCEPT: 1,187 routes, 143 scheduler jobs, ~34 boot threads, 54 SQLite DBs on one loop; the SPA catch-all answers unmatched `/api/*` GETs with 200 HTML (closes OQ-12; weekly payload is `GET /api/calendar`) | `01-existing-system/backend-archaeology.md` |
| D-03 | 1 | done | 06:02 | 07:05 (74 calls, 353k) | ACCEPT: 30 providers measured; Massive IS Polygon.io; FMP in 28 modules with 6 duplicate helpers and no shared budget; Bullflow retired-in-code, Polygon-direct duplicate key, UW half-dormant | `02-data-providers/provider-inventory-dashboard.md`; OBSERVED-CALLED partly supplied by ORCH-RAILWAY-01 |
| D-04 | 1 | done | 06:02 | 07:00 (63 calls, 353k) | ACCEPT: ~55 SQLite files, no Postgres, no migration framework; `auth.db` ~110 tables fed by 16 modules on the request path; the local-backend recipes set neither DATA_DIR nor AUTH_DB_PATH, so a local run hits live `C:\data` | `01-existing-system/database-and-infrastructure.md`; Railway link gap closed by ORCH-RAILWAY-01 |
| D-05 | 1 | done | 06:02 | 07:00 (83 calls, 364k) | ACCEPT: pooled-SSE single-process real-time layer; the two named baseline docs are four months stale; ~3-min cold window per web deploy; documented Cloudflare cache rule not applied (HEAD `/api/flow/data` gives `cf-cache-status: BYPASS`, orchestrator-confirmed) | `07-technical-architecture/current-performance-and-realtime.md` |
| D-09 | 1 | done | 06:02 | 07:20 (69 calls, 366k) | ACCEPT: 4 views + 12-panel modal over 31 `/api/calendar/*` routes; `/api/calendar` has NINE readers (4 browser, 5 server, 1 other repo); removing `/calendar` changes 32 things (17 vanish, 7 degrade, 8 break elsewhere); corrects the modal token claim (now `--menu-*`) and five stale CLAUDE.md calendar claims. Flags it asked about: IMPLIED_ENRICHMENT_CUTOVER=1, CALENDAR_ALERTS_ENABLED=1, CALENDAR_WEEK_POST_ENABLED=1 (ORCH-RAILWAY-01) | `01-existing-system/terminal-current-map.md` (gate item 1 draft) | 2026-09-02 06:02 (batch 1, Opus) | — | — | contracts in `contracts/D-0x.md` |
| D-06 | 1 | done | 06:02 | 06:42 (81 tool calls, 311k tokens) | ACCEPT — 77 KB, 13 sections, GAPS + NOT INSPECTED present; static read only (🟡 runtime) | `07-technical-architecture/current-ui-architecture.md`; open qs → RG-05..07 |
| D-07 | 1 | done | 06:02 | 06:38 (58 calls, 267k) | ACCEPT — 75 KB; both rail commands executed green; found the rail's substring-filter fragility and the missing CI gate | `01-existing-system/testing-reliability-observability.md`; → DL-009, RG-01/02 |
| D-10 | 1 | done | 06:02 | 06:38 (62 calls, 270k) | ACCEPT — 66 KB, 10 sections; corrected two contract KNOWN FACTS (paywall inverted; `tier` enforced server-side) | `01-existing-system/flags-and-entitlements.md`; → DL-010, OI-12, RG-03/04 |
| D-11 | 1 | done | 06:20 | 06:50 (64 calls, 281k) | ACCEPT — workspace state lives in `user_preferences` (unversioned key→TEXT) as eight non-atomic keys; every hard state pattern (versioning, tombstones, instanceId merge, write queue, highwatermark sync, hydration-gated autosave) already exists elsewhere in the repo but is not applied to the layout blob; names a silent data-loss path (`parseLayout`→null→empty board→autosave) | `01-existing-system/state-persistence-and-workspaces.md`; → RG-11, RISK R-13 |
| D-12 | 1 | done | 06:20 | 06:52 (87 calls, 288k) | ACCEPT: a full AI platform exists (154-tool registry across voice, Compass, AI-Search; four answer lanes; two graded exams; Batch ledger; cache-aware cost guards); five price tables with one rail and `catalyst/cost_guard.py:33` mis-prices Sonnet 5 | `08-ai/existing-ai-systems.md`; AI_SEARCH_CLAUDE_SYNTH=1 confirmed by ORCH-RAILWAY-01 |
| D-13 | 1 | done | 06:20 | 07:25 (67 calls, 315k) | ACCEPT: the moat is decision provenance and first-party narrative (7,766 classified #tsdr messages 2024-03 to 2026-02; 19,050 considered-and-dropped wire_universe rows over 43 issues; 4,440 leadership theses over 1,038 symbols; two quantified writer voice models; 16-module/79-lesson curriculum with 181 bar-verified examples; six-gate lift ledger), not data volume; every UCT-way rule resolves to a cited constant | `05-product-strategy/proprietary-asset-inventory-raw.md`; production volumes 🔴 (volume not readable) |
| E-01 | 1 | done | 06:20 | 07:10 (76 calls, 278k) | ACCEPT: verbatim clauses for 9 vendors; Massive Business ToS permits Edge Users but retail tiers are individual-use; FMP bars multi-user display without a Data Display and Licensing Agreement; Finviz publishes no terms; yfinance Unsuitable; Anthropic makes UCT warrant input rights | `09-security-licensing-cost/vendor-terms-evidence.md`; escalated as D-002; OI-03 sharpened; R-14 |
| ORCH-RAILWAY-01 | 1 | done | 07:05 | 07:12 | orchestrator-only read (DL-012) | `02-data-providers/railway-flag-state.md` |
| D-14 | 1 | done | 06:20 | 07:35 (51 calls, 299k) | ACCEPT: 34 UCT scheduled tasks CONFIRMED from `Get-ScheduledTaskInfo` across SIX code locations and FIVE Railway services; four scheduled jobs failing silently (flow-corpus archive has written nothing since 2026-08-09; breadth-live monitor 'could not check' on 52 runs since 2026-08-10; two more named in the report) | `01-existing-system/ecosystem-cartography.md`; → R-16, CP-11 🟡 |
| E-03 | 1 | done | 06:20 | 07:45 (86 calls, 344k) | ACCEPT WITH GAPS: real-time consolidated equity quotes, OPRA prints, and Schwab chains reach members from accounts whose published terms are personal/non-business; it reports several real-time endpoints (`/api/live-prices`, `/api/bars`, `/api/snapshot`, `/api/movers`, `/api/stream/*`, `/api/gex/data`) as UNAUTHENTICATED and no non-professional attestation anywhere; the fee-free escape is UTP's 15-min-delayed-plus-real-time-volume rule. The no-auth claim was VERIFIED by the orchestrator at 08:05 UTC (three endpoints answer 200 with live data unauthenticated; `/api/gex/data` reaches its handler). Corrects a memory claim: the 15:45 no-numerals rule is hallucination safety, not licensing. | `09-security-licensing-cost/realtime-and-exchange-classification.md`; → D-002 evidence, R-17, OQ-15 |
| E-04 | 1 | done | 06:20 | 07:55 (140 calls, 377k) | ACCEPT: 29 derived products inventoried; the Massive Individual-vs-Business tier re-classifies twenty of them (Individual = personal, non-business, display-only; Business = Edge Users carve-out plus an express store right); five clause-vs-code collisions (FRED attribution and caching, X display requirements in `TapeFeed.jsx`, no tweet deletion-sync, `catalysts.db` defeating the 7-day tweet window); retracts an unverified FRED-series assertion in-file | `09-security-licensing-cost/derived-data-rights.md`; → D-002 evidence, RG-21, OQ-16 |
| E-02 | 1b | done | 08:00 / 10:41 | 10:55 (46 calls, 413k on the re-run) | ACCEPT: the first attempt had in fact written the full artifact before the 429; the re-run re-verified every inherited claim at source and made three corrections in place. Master table of provider x data class x seven uses, with Individual-vs-Business Massive scenario columns. Disclosure: one read-only git status ran in a compound check (nothing mutated). | `09-security-licensing-cost/data-use-classification.md`; feeds F-04 |
| F-03a | 2 | done | 10:41 | 14:10 (64 calls, 887k) | ACCEPT: system map (six code locations, five services, both machines, 25 reconciliations), capability ledger (178 rows, sections A–P), tech-debt register (72 entries in four classes). Its three open flags are already answered by ORCH-RAILWAY-01/E-02: IMPLIED_ENRICHMENT_CUTOVER=1; DESK_PUBLIC_SHOWS=* is a documented owner decision (2026-08-19); the live ticker-mentions door stays RG-24 | `01-existing-system/system-map.md`, `capability-ledger.md`, `tech-debt-register.md` (gate items 2, 3 drafts) |
| F-06 | 2 | dispatched (Fable) | 2026-09-02 14:15 | — | — | forty executive questions + Day 1 executive synthesis; `contracts/F-06.md` |
| F-08 | 2 | dispatched (Fable) | 2026-09-02 14:15 | — | — | hypothesis register; `contracts/F-08.md` |
| F-03b | 2 | done | 10:41 | 12:00 (35 calls, 542k) | ACCEPT: 48 provider rows across 6 code locations and 5 services; 20 core; 7 retirement/consolidation candidates; 9 dormant keyless lanes; named data classes with NO provider; zero CONTRACT-ACTIVE rows; only FMP and Finnhub reach OBSERVED-CALLED | `02-data-providers/provider-ledger.md` (gate item 4 draft) |
| F-04 | 2 | dispatched (Fable) | 2026-09-02 12:05 | — | — | licensing register; `contracts/F-04.md` |
| B-QTR-01 | 1b | done | 12:05 | 12:30 (63 calls, 232k) | ACCEPT: Quartr is a corpus company, not a terminal (six taxonomy slots deliberately empty); 🟢 only on Workflows B and F; the transferable primitive is "take me to the exact source"; product interior login-gated (ceiling) | `quartr/dossier.md` |
| B-SG-01 | 1b | dispatched (Opus) | 2026-09-02 12:35 | — | — | `contracts/B-DOSSIER.md` §B-SG-01 |
| B-VAL-01 | 1b | done | 10:50 | 11:15 (68 calls, 244k) | ACCEPT: universe validated with 71 cited URLs; zero options-native products in the candidate list; three name corrections (Fiscal.ai, Eikon sunset, Fey closed); two naming traps logged | `03-competitive-research/benchmark-universe.md`; → DL-017, OI-18, OI-19 |
| B-BBG-01 | 1b | done | 10:50 | 11:45 (56 calls, 266k) | ACCEPT: navigation is a grammar (`TICKER <SECTOR> FUNCTION <GO>`) with menus/tabs/help/history as views over it; 2 Bloomberg-authored primaries + 9 university guides; `ESRV` not found (contract guess) | `bloomberg/01-search-navigation.md` |
| B-BBG-02 | 1b | done | 10:50 | 11:35 (70 calls, 260k) | ACCEPT: fixed four-panel terminal plus floating Launchpad with two crossing primitives (`LLP`, monitor row-click into a panel); corrects contract premises (no colour groups: `Group-1, #A` badges; `MON` unverified, restore is `MNRS`) | `bloomberg/02-monitors-workspaces.md` |
| B-BBG-03 | 1b | done | 10:50 | 11:35 (67 calls, 258k) | ACCEPT: the edge is routing not latency (one tag spine; saved search -> `NI` code -> alert; `MRUL` delivery rules); bloomberg.com help is CAPTCHA-walled | `bloomberg/03-news-alerts.md` |
| B-BBG-04 | 1b | done | 10:50 | 11:30 (67 calls, 255k) | ACCEPT: earnings staged by phase relative to the print (`EVTS` -> `EE`/`EEG` -> `MODL`/`DS`); `TRAN` unsupported (transcripts under `EVTS`/`DS`), `GUID` is guidance | `bloomberg/04-earnings-estimates.md` |
| B-BBG-05 | 1b | done | 10:50 | 11:30 (58 calls, 270k) | ACCEPT: fundamentals as a lane over one loaded security; normalisation a named parameter shared by screen/Excel/BQL; `PEERS` not found (`RV`, `CCB`, `PC`, `RVR`) | `bloomberg/05-fundamentals-valuation.md` |
| B-BBG-06 | 1b | done | 10:50 | 11:40 (62 calls, 245k) | ACCEPT: addressability (charts become mnemonics `G53`; screens are named objects; backtests queued/emailed; live match count) | `bloomberg/06-screening-charting.md` |
| B-BBG-07 | 1b | done | 10:58 | 11:40 (77 calls, 270k) | ACCEPT: asymmetric integration posture (drive the Terminal in, never data out; per-device licence; metered numbers); sources cited scheme-less in backticks | `bloomberg/07-collaboration-export-api.md` |
| NOTE | 1b | — | — | — | All seven Bloomberg files carry mixed 🔴/🟡/🟢 with named ceilings (no uniform-green file). Shared observation: the session `WebSearch` cap (200) was exhausted by ~11:20 UTC; later roles use WebFetch + browser search (preamble updated). | — |
| B-BBG-07 | 1b | dispatched (top-up, Opus) | 2026-09-02 10:58 | — | — | `contracts/B-BBG.md` §B-BBG-07 |
| B-BBG-08 | 1b | done | 11:20 | 12:55 (72 calls, 293k) | ACCEPT: professionals stay for counterparties inside IB chat and a decades-frozen keyboard grammar; the corpus' most experienced practitioner ranks centralised data as far easier to replicate than the network; copyable parts = stable gestures, drill-to-source provenance, persisted layouts; load-bearing quotes re-verified via raw HN/Reddit JSON | `bloomberg/08-why-they-stay.md` |
| B-POD-BBG | 2 | dispatched (Fable) | 2026-09-02 13:00 | — | — | Bloomberg dossier (gate item 7); `contracts/B-POD-BBG.md` |
| B-GDL-01 | 1b | done | 11:45 | 12:10 (58 calls, 227k, Sonnet) | ACCEPT: Gödel = DL Software Inc. (2024, Shkreli; $7M raised through Jan 2026), browser-based command-driven Bloomberg alternative, $996/yr or $118/mo plus a $30/mo FINRA surcharge, self-labeled public beta, no confirmed public API; social/video tier thin (X unauthenticated; no transcripts) | `godel/01-evidence.md`; feeds B-GDL-02/03 in Wave 2 |
| B-UW-01 | 1b | done | 11:50 | 12:20 (37 calls, 285k) | ACCEPT: every paid retail tier gets the same real-time full options tape; tiers differ on saved configuration and refresh cadence; free tier degrades by freshness (15-min tape, 2-day derived), not by feature; Super Flow / latency / Mr. Whale grounding 🔴 (no seat) | `unusual-whales/dossier.md`; Wave 2 verifier must use the browser (site serves an agent shell to fetchers) |
| B-AS-01 | 1b | done | 11:55 | 12:40 (52 calls, 241k) | ACCEPT: AlphaSense is a document-search/AI research platform, not a terminal; transferable assets are citation discipline (sentence -> source span), a four-perspective provenance taxonomy, and credit allocation with a pacing forecast; 31 primary sources; no demo/price/accuracy evidence (ceiling) | `alphasense/dossier.md` |
| B-FC-01 | 1b | done | 11:58 | 12:50 (53 calls, 272k) | ACCEPT: Fiscal.ai (ex-FinChat) rebuilt as a data-provenance company (every figure click-throughs to the filing page; one entitlement check serves terminal, API, and MCP agents); no regime/breadth/options/real-time layer; pricing verified (Pro $49, Max $99 monthly); terminal never opened (card-gated trial) | `finchat/dossier.md` |
| B-TV-01 | 1b | done | 11:50 | 13:05 (114 calls, 273k) | ACCEPT: "the chart is the workstation" (bare typing changes symbol; modifier+cursor chord places order/alert/level); its one shipped AI feature emits an inspectable screen configuration with an Explanation panel; its two empty workflows (D, G) are UCT's proprietary strengths; UX/perf 🔴 (no session, no practitioner voices) | `tradingview/dossier.md` |
| B-KOY-01 | 1b | done | 11:52 | 13:15 (96 calls, 273k) | ACCEPT: Koyfin deliberately refuses the tape (no intraday candles, no options, no bid/ask), so it is complementary to UCT; transferable mechanics = 7 colour groups whose payload can be a symbol, a set, or a watchlist, and user-minted command shortcuts bound to saved artefacts; 50 sources | `koyfin/dossier.md` |
| B-BZ-01 | 1b | done | 11:55 | 13:20 (58 calls, 296k) | ACCEPT: a catalyst-delivery pipe with tools attached (WIIM, a 3-rung editorial importance ladder, a published Signals taxonomy with cooldowns, silent-by-default squawk); embeds TradingView; 4-tool workspaces persisted to browser cache; live UI unobserved (403 + browser read denied), 35 official help articles | `benzinga-pro/dossier.md` |
| B-DESK-04 | 1b | done | 13:25 | 14:05 (58 calls, 265k) | ACCEPT: Market Chameleon's differentiator is per-ticker implied-vs-actual calibration history over a 30-strategy earnings-outcomes backtester and strategy-scoped screeners; one tier $99/mo (verified live 2026-09-02); Premium numbers unobserved. Flags that the contract's KNOWN FACT about D-13 citing implied-move code was not locatable (a contract error, recorded in RG-23) | `desk-tools/market-chameleon.md` |
| B-DESK-03 | 1b | done | 13:20 | 13:45 (28 calls, 207k) | ACCEPT: Finviz Elite is a narrow hard dependency (3 automated scans + static chart PNG tab); its other features are replicated natively; its $300M Small bucket is baked into UCT's scanner floor; Elite shipped automatic candlestick pattern detection 2026-08-27; hand-usage beyond the scanner unconfirmed (owner input) | `desk-tools/finviz.md` |
| C5-01 | 1b | dispatched (Opus) | 2026-09-02 13:50 | — | — | `contracts/C-WAVE1B.md` §C5-01 |
| B-DESK-02 | 1b | done | 13:10 | 13:50 (27 calls, 263k) | ACCEPT: TradingView is code-confirmed link + embed only, never a data source; sits at the inspection edge (TickerPopup, DrillModal, wire links); UCT's formula grammar and indicator ledger already cover the batch half of Pine; the interactive multi-timeframe charting half is the real, narrow gap; usage-blind (no telemetry, no interview) | `desk-tools/tradingview-desk-use.md`; → OI-06 sharpened |
| C7-01 | 1b | dispatched (Opus) | 2026-09-02 13:55 | — | — | `contracts/C-WAVE1B.md` §C7-01 (last of batch C) |
| B-DESK-01 | 1b | done | 12:55 | 13:50 (61 calls, 319k) | ACCEPT WITH GAPS: zero code references to thinkorswim in any repo, so desk usage is unconfirmed (owner input); platform capability well-sourced (Analyze tab, Stock Hacker, Flexible Grid, thinkScript, paperMoney; $0 with funded account); Schwab's Aug 2026 positioning of thinkorswim as the deterministic no-hallucination alternative is a counter-signal worth carrying | `desk-tools/thinkorswim.md` |
| B-ADJ-01 | 1b | done | 12:45 | 13:35 (24 calls, 212k, Sonnet) | ACCEPT (light): TIKR = prosumer fundamentals + 13F superinvestor tracking, no AI; YCharts = advisor charting/proposals, quote-only pricing (~$3.6–6k/user/yr reported, one source conflicts); CIQ Pro = enterprise research with named AI tools, pricing sales-gated | `adjacent-notes/dossier.md` |
| C4-01 | 1b | dispatched (Opus) | 2026-09-02 13:40 | — | — | `contracts/C-WAVE1B.md` §C4-01 |
| B-LSEG-01 | 1b | dispatched (Opus) | 2026-09-02 12:25 | — | — | `contracts/B-DOSSIER.md` §B-LSEG-01 |
| B-FDS-01 | 1b | done | 12:15 | 14:00 (48 calls, 275k) | ACCEPT: FactSet sells substrate, not a destination screen; the 2026 AI brand is FactSet Intelligence (Mercury the engine beneath); published moat is provenance (full in-context source linking, NL to precise API calls, entitlements enforced per human incl. agents); Workstation login-only, no price published (UX/density/seat cost 🔴) | `factset/dossier.md` |
| C7-01 | 1b | queued (batch C, revised per DL-017) | — | — | — | top-up on completion | 2026-09-02 06:20 (batch 2, Opus; 17 in flight = measured step-up, DL-008) | — | — | contracts on disk |
