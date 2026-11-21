# Deliverable 2 — Verified capability inventory

Source: Appendix A (per-capability table, 123 rows with `file:line`), Appendix C (94-row website coverage matrix), Appendix E (flags), Appendix F (integrations). This document is the synthesis; the appendices are the evidence.

## 1. Classification totals

| Class | Definition | Count | Weighted share of the site* |
|---|---|---|---|
| **A** Working and user-visible (admin, on `/charts`, Agent switch on) | registered, available, wired through the feature's own writer with read-back | **120 capabilities / 44 feature rows** | 53 % (62 % of `/charts`) |
| **B** Implemented, disabled by a default-off server flag or cohort | stock.quote, stock.dailyBars (`UCT_AGENT_DATA`), screener via gateway (`UCT_AGENT_SCAN`), News ask (`UCT_AGENT_NEWS`), indicator NL authoring (Create-Indicator cohort) | 2 capabilities + 3 feature rows | +7 % |
| **C** Partially implemented | chart settings limited to the ELIGIBLE table; widget options only showList/showScan; definition edit only via draft flow; indicator.undoDraft conditional | 4 rows | +4 % (upper bound) |
| **D** Website function exists, not exposed to the Agent | 40 rows (see §3) | — | 35 % |
| **E** Missing in the product | mobile Charts host | 1 row | 1 % |

\* Weighting: 94 feature rows, each weighted 1–3 by user importance (documented per row in Appendix C §2); total weight 175. Formula: Σ weight(rows in class) / 175.

**Reading:** on the Charts page the Agent already operates about two thirds of what a member can do. Across the whole site it is about half, because no page other than `/charts` has an Agent host.

## 2. Working capabilities by area (class A)

| Area | Capabilities (count) | Canonical writer | Approval | Undo | Notes |
|---|---|---|---|---|---|
| Chart (symbol, timeframe, type, scale, session, theme, colours, volume, settings, templates, go-to-date, compare, tabs) | 19 chart + 15 board-tab | `ChartWidget` agent adapter → `onOptsChange` | local, auto-apply | exact | `chart.setSetting` limited to ELIGIBLE rows |
| Board / widgets (add, remove, move, resize, arrange, swap, duplicate, link colour, tabs, show list/scan, theme all, chart grid) | 21 board + 2 workspace | `applyBoard`, `handleAddWidget` | local; remove = confirm | exact (re-inserts widget object) | widget.add only into empty space by design |
| Layouts (current, list, open, save, save-as, rename, create, delete, duplicate, previous) | 9 | `useChartLayouts` → `/api/charts/layouts` | delete/save-over = confirm | exact; protected layouts refused | |
| Watchlists (list, show, create, rename, delete, add, remove, clear, reorder, note, open, digest) | 8 + 2 library + 1 digest | `/api/watchlists/*` via `host.watchlists` | delete/clear = confirm | exact | flagged/public/copy lists not exposed |
| Indicators (list, add, remove, update inputs, style, place-in, pane move/resize, duplicate, copy-to, definitions search/describe/duplicate/delete, open Create) | 2 + 3 + 6 + 4 + 2 | Indicators' `agentMutations` / `agentDefinitions` / `agentSeams` | definition.delete = confirm | exact via Indicators' undo | `manageIndicators` entitlement |
| Indicator authoring (draft, preview, save, undo, discard) | 5 | Indicators' `agentAuthoring` → `POST /converse` (Opus 5) | save = always proposed (sealed) | draft undo | **cohort/admin gated** (class B for members) |
| Drawings (horizontal levels: add, set, style, visibility, lock, remove, clear, list) | 9 | `drawingsStore` by symbol+id, server `tracings_doc` read-back | clear = confirm | exact by id | time-anchored tools "NOT OFFERED YET" |
| Alerts (price alert create/list/delete; sound) | 1 + 2 + 1 | `/api/watchlist-alerts` | create = confirm | delete | price levels only |
| Screener (run, count, saved run/list/state, save-as, rename, duplicate, delete) | 4 + 4 | `/api/screener/scan` or gateway `screen.*`; `/api/screener/saved-screens` | save/delete = confirm | exact | F-16 hides UCT ratings/scores/flow from the Agent (PRs #654/#657 still open) |
| Breadth (show current/compare/series; history questions) | 2 | `/api/agent/breadth*` over breadth monitor | query | — | LOCAL_ONLY: values never return to the model |
| Stock (profile, earnings, compare) | 3 | `/api/fundamentals-full`, `/api/earnings-intel`, `/api/research/compare` | query | — | legacy path calls `/api/live-prices` directly (alert side-effect risk, App. E §6) |
| News (latest, catalysts) | 2 | `/api/company-news`, `/api/catalysts/history` | query | — | |
| Navigation, settings, guide, about, session measures | 1 + 4 + 2 + 1 + 1 | router navigate; `setPref`; guide registry | local | — | guide covers 11 features / 20 targets on `/charts` only |

Fast-path (zero-model) phrase matchers exist for 54 of these. Test coverage: 2 capabilities have no test naming them (`chart.renameTab`, `drawing.list`); 35 appear in exactly one test file (App. A §7.5).

## 3. Website functions not exposed to the Agent (class D), ranked by value ÷ effort

Effort: S < 1 day, M 1–3 days, L > 3 days for one builder session. Full rows with writers in Appendix C §2.

| # | Feature | Writer already exists | Effort | Risk | Why it matters |
|---|---|---|---|---|---|
| 1 | Time-anchored drawings (trendline, ray, rect, fib, text, channel, AVWAP, position) | `drawingsStore` + `validateDrawing` / `drawingTimeFor` exported (`drawings.js:26-28`) | M | low | the most-used chart action after symbol/timeframe |
| 2 | Dated close / point-in-time bars ("NVDA close last Friday") | `bars.daily` adapter already supports `to` | S | low | top held-out miss class (#662 class 3) |
| 3 | Indicator alerts (create/toggle/delete) | `useIndicatorAlerts.js` writers | M | med | needs Indicators sign-off; "mark when 9 crosses 20" |
| 4 | Per-widget settings (`widget.setOption` over registry param schemas) | `handleOptsChange` + `widgets/registry.js:381-661` | M | low | unlocks news filters, breadth tiles, scatter axes, calendar day in one generic capability |
| 5 | Remaining chart settings rows (KNOWN → ELIGIBLE) | `chartSettingsDescriptors.js:148-181` | S per batch | low | ownership wall only |
| 6 | Chart replay mode | `openReplay` / `replayCutoff` | S–M | low | "show me this chart as of last March" |
| 7 | Drawing-bound alerts; screener standing alerts; alert inbox | `PATCH /api/watchlist-alerts/bound`, `useScreenAlerts`, `/api/alerts` | S each | med | completes "alert me when" |
| 8 | Flagged list, public/copy lists, CSV export, columns prefs | `/api/watchlists/flagged*`, save-as, `setPref` | S each | low–med | |
| 9 | Fundamentals/filings/transcripts/insider/estimates reads; options chain/IV | `research.py:243-398`, `options_chain.py` | M | low–med | research package input |
| 10 | Journal notes / trades / positions; capture-to-notebook | `/api/j2/*`, `chartJournalCapture.js` | L | med–high | coach package input; trades/positions must stay proposed |
| 11 | Calendar (next report, day list, my-sets); morning wire read; model book, setup library, portfolio heat, flow reads | routers exist | S–M each | low–med | all blocked by "no host off /charts" |
| 12 | Terminal command surface (89 deterministic function codes) | `pages/terminal/functions.js:37` | L | low–med | a ready-made deterministic action grammar for a second surface |
| 13 | Layout share / versions / restore; chart share link; screener share | routes exist | S–M | med (publishes) | always proposed |
| 14 | AI Search (threads, briefings, deep research) | `/api/ai-search*` | M | med | product decision: merge the two assistants or bridge |

Actions with **no programmatic writer** (DOM-only, blocked by the no-DOM rule until the product grows a writer): watchlist column layout, screener layout/pinned, breadth collapsed columns, model-book/desk/journal UI toggles, drawing-tool recents, pop-out windows (App. C §3).

## 4. Server-side data kinds (gateway) and their browser exposure

| Kind | Flag(s) | Browser capability | State |
|---|---|---|---|
| quote, quotes, instrument.resolve | `UCT_AGENT_DATA` + `UCT_AGENT_DATA_KINDS` | stock.quote | B (QA GO #672; FAIL = 0 on 4 held-out sets) |
| bars.daily | same | stock.dailyBars | B |
| screen.run, screen.saved, screen.count | `UCT_AGENT_SCAN` | screener.run / runSaved / listSaved | B (falls back to screener's own routes when off, so A either way) |
| fundamentals, earnings, news.company, themes | `UCT_AGENT_DATA` | **none** | server-only |
| breadth.current, ratings | `UCT_AGENT_DATA` + `UCT_AGENT_ISOLATED` | **none** (model-isolated by ADR-005) | server-only, dormant |

Nine of thirteen kinds have no consumer. They are the raw material for the Market Analyst and Research packages (Deliverable 4).

## 5. Flags and access (production values unverified; code defaults shown)

| Flag | Default | Gates |
|---|---|---|
| per-browser `uct.feature.agent` + admin | off | the panel itself |
| `require_admin_dark` on all 15 `/api/agent/*` routes | paid + admin | every turn |
| `UCT_AGENT_DATA`, `UCT_AGENT_DATA_KINDS` | off / empty (fail-closed) | gateway kinds |
| `UCT_AGENT_SCAN` | off | gateway scans |
| `UCT_AGENT_ISOLATED` | off | ratings/breadth.current kinds |
| `UCT_AGENT_NEWS` | off | headline conversations |
| `UCT_AGENT_NL1` (+ localStorage) | off; capped at 60 actions so unusable at catalog size | model-first interpreter |
| `UCT_AGENT_STREAM` | off | SSE streaming |
| `AGENT_BREADTH_CURRENT` | off | "now" breadth overlay |
| Create Indicator cohort (`CREATE_INDICATOR_COHORT_ENABLED`) | admin only | `/converse` and 6 authoring capabilities |

A production read of these values was denied to this audit (auto-mode classifier). Session notes from 2026-11-02 record the Agent flags OFF.

## 6. Integration state of the adjacent workstreams

| Workstream | State on master | Open items |
|---|---|---|
| Indicators M1–M3 + P2 + A1 | merged (#465, #467, #477, #481, #493, #517, #520) | #516 on hold by owner ruling; #617 F-15 Pine undo draft; IC-1 conditions planning-only (ADR-004); indicator alerts not armed |
| News → Agent | merged dark via #692 (`d16867f344`); #684 and #665 are open drafts whose content is already in | flag activation; QA verdict listed "pending" in #692 unverified |
| Sprint 1 / Sprint 2 program | #616, #682, #697 merged flags-off; QA GO #672 | F-16 PRs #654/#657/#661 open; F-23 #666 open; `agent/int` is 263 commits behind master |
| Research (RS-1) | not started | — |
| Historical (event study) | `api/services/market_intel/event_study.py` exists, zero callers | — |

## 7. Caveats

- "Working" means registered and wired through the feature's writer as read from source; this audit executed nothing.
- Entitlement holders (`manageIndicators`, `createIndicator`) and production flag values are not visible from source.
- Capability counts differ by method: 121 in the golden manifest, 119 by `name:` grep, 110 distinct actions in the routed catalog, "117" in ROADMAP. Appendix A reconciles them.
