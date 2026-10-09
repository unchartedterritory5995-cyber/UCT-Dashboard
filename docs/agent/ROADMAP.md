# UCT Agent — Master Roadmap

> **Owner:** UCT Agent project.
> **Status:** approved direction, 2026-10-08. Adopted from the Charts Capability & Architecture Audit with the Batch 4 release.
>
> **Rule:** update this file at the end of every batch: what shipped, the release commit, and any verification debt. A future capability is described here as **planned**. Nothing in this file means it works today.
>
> **Live source of truth** for "what can the Agent do right now":
> - the capability registry, `app/src/agent/capabilities/*`;
> - the golden manifest, `app/src/agent/contract/manifest.golden.json`;
> - the deterministic answers in `app/src/agent/discovery.js`. Every planned label there must also appear in this file; `agentBatch4.test.jsx` checks this.

UCT Agent is one product initiative. It is not one engine, and not one team.

- **The Agent proposes; UCT executes.** Each feature's own canonical writer makes the change, then the Agent reads it back and offers Undo where it exists.
- **No engine is duplicated.** These stay with their owners:
  - indicator
  - screener
  - pattern
  - drawing
  - historical query
  - backtest

## Principles

1. **Local-first, bounded batches.** Each batch moves through these steps:
   1. Isolated data and focused tests.
   2. Scripted-model browser acceptance.
   3. A real-model benchmark on a fresh ET day, within the existing cap.
   4. One controlled release.
   5. One production smoke test.
2. **Knowing ≠ doing.** Product registries let the Agent *describe* everything UCT has. It *executes* only approved capabilities, and refuses everything else by default (`CAPABILITY-CONTRACT.md`).
3. **Product-owned metadata.** Completeness rails fail CI when a new product setting ships unclassified.
4. **Deterministic engines compute; the model interprets and explains.** This covers history, backtests, similarity and vision reconstruction.
5. **Owner approval is required to change:**
   - access (admin-only today)
   - the model (Haiku 4.5 default)
   - the spend cap (`UCT_AGENT_DAILY_CAP`)
   - production configuration

## Current coverage (after Batch 6)

| Area | Agent today | Status |
|---|---|---|
| Chart symbol / timeframe / type / scale / session | `chart.setSymbol/.setTimeframe/.setType/.setScale/.setSession`. Session follows the UI's pre/post window rules. | available |
| Chart appearance | `chart.applyTheme` (one chart) and `chart.applyThemeAll` (every chart), `.setBackground`, `.setCandleColors`, `volume.setState`, and `chart.setSetting`: **46** display settings from the product descriptor table (Batch 6 added grid/crosshair/text colours, watermark size/weight/lines, previous-day level style/width/colour, swing-label tint/background), colour names accepted | partial (indicator and drawing settings are owned elsewhere) |
| Chart templates / defaults | **`chart.applyTemplate`** (one of your saved templates, confirmed first), **`chart.resetDefaults`** (confirmed first). Both exact Undo. | partial (saving a new template is not supported) |
| Go to a date / compare | **`chart.goToDate`** (a view change: the receipt waits for the chart's right edge to read back; Undo scrolls back), **`chart.compare`** (add / remove / clear overlay symbols, the Compare panel's own entries) | partial (a date RANGE and replay are not supported) |
| Custom timeframes | **`chart.addCustomTimeframe`** (minutes / hours / days / weeks / months; optionally switches to it) | partial (removing one is not supported) |
| Chart tabs | **`chart.addTab` / `.selectTab` / `.closeTab` / `.renameTab` / `.linkTab`** — the tab strip's own reducers, one board write, exact Undo | available (the main tab cannot be closed) |
| Widgets | `widget.add`, `widget.addCharts` (into empty space); **`widget.showList`** (a Watchlist widget shows one of your lists), **`widget.showScan`** (a Scanner widget shows one of UCT's scans) | partial (other widgets' settings are not supported) |
| Arranging widgets | `widget.remove` (exact Undo), `widget.move` (a drop: the others re-tile), `widget.arrange` (fill / grid / columns / rows), **`widget.resize`** (one edge, the resize handles' own resolver; a neighbour never goes below its minimum and no gap is left), `widget.setLink` (A–D, N) | partial (float, pop-out, merge and link groups E–H are not supported — see Batch 6 evaluation) |
| Layouts | `layout.*` (9): list, open, save as, **save into the open layout**, rename, create blank, duplicate, delete | available |
| Watchlists | `watchlist.*` (8) | partial. Reorder, sort and notes are not supported. |
| Screener | `screener.run` / `.state`: numeric and yes/no fields, one sort, refine | partial |
| Saved screens | list, run, save as, copy (keeps rank and logic), rename, delete | partial. Overwrite is not supported. |
| Alerts | `alert.list/.create/.delete`, price alerts only | partial. Product gap: no background price-alert monitor. |
| Stock info / news | `stock.*`, `news.*` | available |
| App settings / pages | `settings.*`, `app.open` | available |
| Capability questions | `agent.capabilities`: deterministic, backed by the registry | available |
| Indicators / custom indicators | — | known product feature (Indicator Intelligence), not Agent-enabled |
| Drawings | — | known product feature, not Agent-enabled |
| Visual chart reading | — | planned (Stage 2) |
| Historical questions | — | planned (Stage 3) |
| Backtesting | — | planned (Stage 4) |
| Similar-chart search | — | planned (Stage 5) |

## Stage 1 — Charts workspace mastery

| Batch | Outcome | Depends on | Status |
|---|---|---|---|
| 1–3 | Symbols → Charts; stabilization; revision safety; Alerts; app, stock and settings; news; layout create/delete/duplicate; watchlist clear/delete; saved screens | — | shipped (see log) |
| **Batch 4: contract foundation + verification** | Four defect fixes: saved-screen spec, theme parity, session eligibility, honest Undo. Chart-settings descriptor table with a completeness rail. `chart.setSetting`. Manifest contract v1: golden file checked from JS and Python, `undo` metadata, a version number. Product lists imported instead of copied. Truthful capability questions. Relevance-routing design, not active. | — | **shipped** `c2d889a0fe` |
| **Batch 5: capability routing + workspace arrangement** | **Gate A:** relevance-routed manifests (only the action groups a request needs; one bounded reroute). **Gate B:** product fixes for the Dock "New layout" overwrite and the `addWidgetTab` options loss. Then: remove a widget (Undo restores its id, options and position). Move, resize and arrange through the pure placement helpers. Set link colour. Save into the open layout. Theme all charts. First non-chart widget settings: which list a watchlist widget shows, and which scan a scanner runs. | Bindings on the shared ChartsWorkspace host. Product fixes for the Dock "New layout" overwrite and the `addWidgetTab` options loss (`PRODUCT-HANDOFFS.md`). | **shipped** `e4c3466e38` |
| **Batch 6: chart control + scaling** | **Gate A:** the daily-cap 429 explained (a client clock reading, not the server; ET-day tests pinned). **Gate C:** the catalog may exceed one request (registered ≤ 200, group ≤ 40, request ≤ 60, routed ≤ 55); routing packs whole groups under the budget; the server refuses an over-limit request instead of trimming it. Then: 23 more descriptor rows (colours), apply template, restore defaults, go to a date, compare overlays, custom timeframes, chart tabs, widget resize. 70 registered actions. | Batch 4 descriptors; Batch 5 routing | **this batch** |
| **Batch 7: indicators** (joint with Indicator Intelligence) | An indicator target kind: add, remove, inputs, style, pane placement and order, catalog queries. Natural-language hand-off to Create Indicator. | An Indicator-owned instance write / read-back / Undo contract (`docs/indicators/INTEGRATION-READINESS.md`, gaps 1–7) | planned |
| **Batch 8: drawings** | A drawing target kind for horizontal lines, trendlines, rectangles, Fibonacci retracements and extensions, vertical lines and text, all placed from explicit price and date anchors. Style, remove, list. Undo by drawing id. | The drawings owner exports point counts, `validateDrawing` and a display-time helper; a decision on server persistence (`TRACINGS_STORE_ENABLED`) | planned |
| **Batch 9: screener depth** | Enum fields, field-to-field comparisons, rank, logic, multi-sort, columns, preset scans, custom-date (Period) sort, promote to watchlist, saved-screen overwrite | Screener flags (`SCREENER_LOGIC_ENABLED`, `SCREENER_PROMOTE_ENABLED`); a revision column on `screener_saved_screens` | planned |
| **Batch 10: lists, alerts, data reads** | Watchlist reorder, notes and sort. Read-only queries: calendar, ownership, insider, ETF holdings, breadth, options flow, themes, transcripts. Clear wording about how alerts are monitored. | Product: a background price-alert monitor; the watchlist save-as flag | planned |

**Stage 1 exit criteria:**
- The Charts acceptance catalog (audit §I) passes first time on the real model.
- Every chart setting, widget type, indicator definition and drawing tool is classified.
- A new product feature fails CI until someone classifies it.

## Stage 2 — Visual chart understanding and reconstruction (planned)

- **Image input on `/api/agent/turn`.** Size-capped and never stored.
- **"Look at my chart."** A host binding to `StockChart`'s `getSnapshotBlob`.
- **Reconstruction plan.** Every value is labelled **observed / inferred / unknown**. The plan runs only through Stage 1 capabilities.
- **Reuse.** `/api/indicator-vision/candidates`, owned by the Indicator team.
- **Depends on:**
  - Batches 6–8;
  - an owner decision on model routing for vision (`CAPABILITY-CONTRACT.md`, §Model routing).

## Stage 3 — Historical market intelligence (planned)

- **A deterministic historical query service.**
  - The model turns the question into a typed query: series, conditions, alignment, window.
  - The service evaluates it on aligned, as-of daily data and returns the rows plus coverage.
  - The Agent never computes the answer itself.
- **A dataset coverage registry.** For each series: first and last date, gaps, and revision policy.
- **Data already in UCT:**
  - sealed D/W/M bars (vendor floor 2003-09-10, plus a graft);
  - 44 `UCT*` breadth symbols (end of day);
  - point-in-time fundamentals and market cap.
- **Explicit definitions, no look-ahead.** An "all-time high" means the high of the history available *as of that day*.
- **Ambiguous names get a question, never a guess.** For example, "UCT A40".

## Stage 4 — Natural-language backtesting (planned)

- **Engine audit first.** Pick one canonical engine from:
  - `api/backtest_engine` (`/api/backtest`);
  - `services/screener/backtest.py` and `candle_backtest.py` (`/api/screener/backtest`);
  - `pattern_backtest.py` (voice only).
- **A typed strategy spec** that the member confirms before anything runs.
- **Explicit assumptions:** costs, slippage, survivorship (delisted coverage) and point-in-time universes.
- **Reproducible run records and transparent metrics.** The Agent never computes returns itself.

## Stage 5 — Historical chart similarity search (planned)

- **Feature vectors** over history: price structure, volume, moving-average stack, volatility, relative strength. Built into an offline index.
- **Reuse:**
  - the pattern detectors (`services/pattern_engine/*`);
  - the candle catalog;
  - the breadth-analogues precedent (`breadth_analogues.py`).
- **Outcome analysis.** What happened after each match, and backtests of the matches through the Stage 4 engine.

## Stage 6 — Unified trading research workflows (planned)

One conversation that coordinates workspace actions, historical queries, visual analysis, backtests, alerts and research.

**Depends on:**
- relevance-routed manifests being active;
- stable Stage 1–5 services.

## Stage 7 — Broader UCT expansion (planned, after Charts is excellent)

**Member rollout prerequisites:**
- entitlement-aware `available(ctx)`;
- `/api/agent/record` outcome kinds written by the server;
- byte limits on `pending`, `recentOutcome` and the manifest;
- disclosure that research queries are sent to Perplexity;
- an `https:`-only filter on citation links.

## Deferred dependencies (tracked)

| Dependency | Owner | Blocks |
|---|---|---|
| Indicator instance write / read-back / Undo contract; Create Indicator hand-off seam | Indicator Intelligence | Batch 7 |
| `POINT_COUNT` / `validateDrawing` / display-time helper exports; server drawing store | Charts (drawing layer) | Batch 8 |
| Saved-screen revision column (compare-and-set on write) | Screener | Saved-screen overwrite (Batch 9) |
| `SCREENER_LOGIC_ENABLED` and `SCREENER_PROMOTE_ENABLED` decisions | Screener / owner | Batch 9 |
| `WATCHLIST_COPY_OR_LINK_ENABLED` decision | Watchlists / owner | Watchlist save-as |
| Background price-alert monitor | Alerts | Being able to promise that alerts fire |
| Historical query service + coverage registry | Data / Breadth | Stage 3 |
| Choice of a canonical backtest engine | Screener / Research | Stage 4 |
| Float / pop-out / merge as data writes (Batch 6 evaluation: float is a per-session mode, pop-out opens an OS window, merge has no persisted inverse — none has a readback the Agent can verify) | Charts workspace | `widget.float`, `widget.popOut`, `widget.merge` |
| Link groups E–H are behind the extra-groups flag (a stored E–H widget is not linked while it is off) | Charts workspace / owner | `widget.setLink` E–H |
| Replay mode, removing a custom timeframe, saving a new chart template, a date RANGE (two edges) | Charts | the remaining Batch 6 chart-control items |

## Verification debt

| Item | Status |
|---|---|
| Batch 3 real-model benchmark: 15 of 25 cases ran; 3 fixes were never re-benchmarked | Carried into Batch 4 verification (see the Batch 4 report) |
| Full-app test failures: `pollingSites.rail` (`useTickerIpo.js`, chart team, 2026-10-04) and `ScanObjectCard` (passes when run on its own) | Not caused by the Agent; documented |

## Batch log

| Batch | Released | Notes / debt |
|---|---|---|
| Symbols→Charts, stabilization, overnight, revision safety, reliability, Alerts | 2026-10 | — |
| Batch 1 (`app.open`, `stock.*`, `settings.*`) | `3d8cb0cb55` | — |
| Batch 2 (hidden-tab fix, server pref validation, news, layout delete/duplicate, digest) | `9c9807f472` / Railway `04447b00` | — |
| Batch 3 (`layout.create`, watchlist clear/delete, saved screens) | `39c3ea6ca3` in `a947cbb542` / Railway `d9c5cbd7` | Benchmark: 15 of 25 cases ran. Rank/logic defect, fixed in Batch 4. |
| Batch 4 (contract foundation + verification) | `c2d889a0fe` / Railway `978069df` (2026-10-08) | Benchmark blocked by the daily cap (33 cases carried into Batch 5) |
| Batch 5 (routing, Dock/tab fixes, arrangement, save-into-layout, widget config) | `e4c3466e38` / Railway `2b9ee6e3`, redeployed as `2944ee28` (same commit) (2026-10-08) | Real-model benchmark blocked by the daily cap that evening; run in Batch 6 |
| Batch 6 (chart control, catalog scaling, resize, tabs) | *(filled in at release)* | |
