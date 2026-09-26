# CONTRACTS — Domain pods, Wave 2 (Group C; Opus; BUDGET 100 tool calls or 70 minutes each unless stated)

Read `_EXTERNAL_PREAMBLE.md` first; it binds. Each role researches a TOPIC across products and disciplines and writes one file under the path given. KNOWN FACTS common to all: the Wave 1b dossiers under `03-competitive-research/<slug>/dossier.md` and the Bloomberg files under `bloomberg/` exist; read the sections relevant to your topic before searching (cite them as evidence, do not re-derive). Internal files you may read are named per role; otherwise do not read internal UCT reports or code.

## C1-01 — Fundamental intelligence: statements, valuation, estimates, guidance (Parts XIII §3, CXXXIX, CXL, CCLXVII–CCCLXVIII) → `05-product-strategy/domain-fundamental-intelligence.md`
How the benchmark products present statements (standardized vs as-reported; adjustments; point-in-time), estimates (consensus, revisions, analyst-level, surprise history, guidance tracking), valuation (historical bands, peer relative value), and provenance (drill-to-filing). Which vendors power them (where disclosed). Which of these an options-and-equities swing desk uses daily vs occasionally (cite practitioner evidence). Internal file allowed: `02-data-providers/provider-ledger.md` (FMP covers what; what has no provider) so the gap analysis is honest. Deliver a capability map with "data available to UCT today / needs a provider / licensing-bound" per row.

## C1-02 — Ownership, insiders, peers, corporate actions (appendix CCCLXXIII–CCCLXXVII, CCCLXVI) → `05-product-strategy/domain-ownership-peers.md` (BUDGET 80/60)
Institutional ownership, insider transactions, short interest, analyst actions, dividends/splits, IPO calendars, automated peer selection: what products show, from which sources, at what freshness; what a swing desk actually acts on (evidence). Internal file allowed: provider ledger.

## C2-01 — News architecture patterns (Parts XXXVI, CXLIII–CXLV, CCXVIII, appendix CCCLXXXIV) → `05-product-strategy/domain-news-intelligence.md`
Ingestion, dedupe/clustering, entity tagging, topic spine, importance ranking (editorial vs algorithmic; Benzinga's importance ladder; Bloomberg's NI codes), latency tiers and what they cost, personalization by watchlist, saved searches → alerts, read/unread, feeds vs panels vs streams. Deliver design patterns as hypotheses plus anti-patterns; note which are achievable with UCT's current sources (internal file allowed: provider ledger; and `08-ai/existing-ai-systems.md` §surfaces for what UCT already summarizes).

## C2-02 — Events intelligence (Parts XXXVII target, CXXXIV, CCXVII, CCLXXI, appendix CDXXXV–CDXXXVI) → `05-product-strategy/domain-events-intelligence.md`
Unified catalyst timelines across earnings, economic releases, corporate actions, conferences, FDA, investor days, index rebalances; time-of-day and TBD handling; expected-move integration; live-call and transcript workflows (Quartr); event replay. Internal file allowed: `01-existing-system/terminal-current-map.md` §1–3 (what Terminal-Current already does) so the "Events Intelligence" expansion is grounded, not invented.

## C2-03 — Alerts and notifications (Parts LIII, CXXXII, CCLXXXIV, appendix CCCLXXXV–CCCLXXXVI, CDXXVI) → `05-product-strategy/domain-alerts.md` (BUDGET 80/60)
Alert types, compound rules, delivery channels, severity, fatigue controls, cooldowns, snooze, alert-from-context creation, evaluation architectures (simple V1 vs rule engine). Internal file allowed: `01-existing-system/capability-ledger.md` rows for alerts (if present) or `frontend-archaeology.md` §alerts.

## C3-01 — Charting patterns (Parts XIII §8, XXXV benchmark side, CXXXVII) → `05-product-strategy/domain-charting.md` (BUDGET 80/60)
Chart-as-workstation patterns (TradingView), Bloomberg addressable charts, comparison and normalization, event markers, saved templates, multi-pane, drawing persistence, alerts from charts. Internal file allowed: `07-technical-architecture/current-ui-architecture.md` §charts (what UCT's chart pane already does) for the gap table.

## C3-02 — Market overview and visualization (Parts XIII §1, §6, LXXI, appendix CCCLXXVIII–CCCLXXXIII) → `05-product-strategy/domain-market-overview.md` (BUDGET 80/60)
Home/overview surfaces, heatmaps, movers, breadth, sector dashboards, macro dashboards, regime displays across products; what answers "what deserves my attention right now". Internal file allowed: `05-product-strategy/proprietary-asset-inventory-raw.md` (breadth, exposure, regime rails) for the "UCT already has" column.

## C4-02 — Command palettes and search in software (Parts CLXXI, CLXXII, LXVIII) → `06-ux-and-information-architecture/command-palette-patterns.md` (BUDGET 80/60)
VS Code, JetBrains, Figma, Notion, Raycast, Spotlight, Linear, GitHub, Slack: palette grammar, ranking, recents, keyboard conventions, discoverability, conflicts with browser/OS shortcuts. Read `command-grammars.md` (C4-01) first if present to avoid overlap; you own the software analogs and the keyboard-strategy evidence.

## C4-03 — Global search and entity resolution (Parts XXIV, LXXVIII, CCCLVIII–CCCLX, CCLXIX) → `06-ux-and-information-architecture/search-and-entity-resolution.md`
Entity types (equity vs company vs indicator vs function), ticker-change and share-class handling, symbol masters (OpenFIGI, CUSIP/ISIN, vendor ids), fuzzy matching, semantic search, deep-linkable search states. Internal file allowed: `01-existing-system/backend-archaeology.md` §ticker search and `01-existing-system/frontend-archaeology.md` §search.

## C5-02 — Personalization, density, templates, saved objects (Parts XLVIII, XLIX, LIV, CXLVI–CXLIX, CCCXL–CCCXLIII) → `06-ux-and-information-architecture/personalization-patterns.md` (BUDGET 80/60)
Density modes, defaults quality, templates, favorites/recents, saved-object models, staff-published layouts, cross-device state. Read `workspace-systems-survey.md` (C5-01) first if present. Internal file allowed: `01-existing-system/state-persistence-and-workspaces.md` §gap analysis.

## C6-01 — AI-native financial tools survey (Parts XXV, XIII §13, CXXXV) → `08-ai/ai-native-tools-survey.md`
Fiscal.ai, AlphaSense generative search, Koyfin/TradingView AI features, Gödel, Perplexity Finance, Fintool, Rogo, Bloomberg's AI features (document summaries, earnings call summaries), FactSet Mercury, Benzinga AI: what is shipped vs demoed, grounding and citation behavior, "why is it moving" implementations, natural-language screening. Read the dossiers' §I first.

## C6-02 — Grounding, citation, provenance architectures (Parts XXVIII, LXXXIII, LXXXIV, CCLXXXVII, appendix CDXXXIX–CDXLIV) → `08-ai/grounding-architectures.md`
Tool-based retrieval vs stuffed context, citation spans, temporal context (market clock), refusal behaviors, evaluation harnesses for financial QA, cost/latency tiers. Internal file allowed: `08-ai/existing-ai-systems.md` (UCT's registry, exams, guards) for the "already have" column.

## C6-03 — Agentic workflows, AI actions, permissions, cost control (Parts CCLXXXV–CCXCII) → `08-ai/agentic-patterns.md` (BUDGET 80/60)
AI creating watchlists/screens/alerts with confirmation, tool permission models, context visibility, caching of summaries, model routing, per-user vs population budgets. Internal file allowed: `08-ai/existing-ai-systems.md` §cost control.

## C7-02 — Symbol master, corporate actions, time and session model (Parts LXXVI–LXXVIII, CXXXIX, appendix CDXXVII–CDXXXVIII) → `07-technical-architecture/domain-symbol-master-time.md`
Identifier schemes, ticker changes, share classes, delistings, adjustment conventions, market calendar and sessions, timezone handling, earnings time normalization, TBD events. Internal file allowed: `01-existing-system/backend-archaeology.md` and `terminal-current-map.md` §time handling (what UCT does today).

## C7-03 — Vendor abstraction, normalization, provenance, data dictionary (Parts XXVII–XXIX, CLIV, CCCLXI–CCCLXIV) → `07-technical-architecture/domain-data-platform.md`
Canonical data models for terminals, adapter layers, metric dictionaries, provenance fields, reconciliation rules across vendors, versioned calculations. Internal file allowed: provider ledger and `database-and-infrastructure.md` §datastores.

## C8-01 — Onboarding, progressive disclosure, education in context (Parts XVII, LXXXIX, XC, CCLXXII–CCLXXV, CCCVII) → `05-product-strategy/domain-member-experience.md` (BUDGET 80/60)
Beginner/advanced/professional modes, guided tours, command discovery, tooltips and empty states that teach, function directories, how products keep power discoverable. Internal file allowed: `05-product-strategy/proprietary-asset-inventory-raw.md` §curriculum.

## C8-02 — Pricing, tiering, retention, commercial patterns (Parts LXXXVIII, CVII, CCXXXVI; Q36–40 inputs) → `05-product-strategy/domain-commercial-patterns.md` (BUDGET 80/60)
Tier boundaries across the dossiers (freshness-based, feature-based, seat-based), what justifies premium pricing, retention through workflow, per-user data costs passed through, community bundles (Discord). Internal file allowed: `00-program-control/OWNER_INPUTS_REQUESTED.md` OI-01/OI-12 and `01-existing-system/flags-and-entitlements.md` §user classes.

RETURN SUMMARY ≤150 words each. OUTPUT STRUCTURE, CONFIDENCE, SOURCE HANDLING, DO NOT per `_EXTERNAL_PREAMBLE.md` (binding). Do not spawn sub-agents. FILE DESTINATION root: `C:\Users\Patrick\uct-worktrees\terminal-research\docs\terminal-research\`.
