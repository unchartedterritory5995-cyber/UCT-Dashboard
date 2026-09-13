# Full-Market Screener — Design Spec

**Date:** 2026-06-19
**Status:** Approved design, pre-implementation
**Owner:** UCT Dashboard

## 1. Summary

Rebuild the `/screener` ("Scanner Hub") into a **Finviz-grade custom stock
screener** that filters across the **entire ~3,685-ticker cap universe** on
dozens of criteria spanning **descriptive, fundamental, technical, single-candle
structure, multi-candle structure, and chart patterns**. Filtering runs
**server-side** against a **nightly-precomputed per-ticker snapshot DB**, so
results return in well under a second regardless of how many filters are stacked.

This replaces the current client-side `Custom Scan` tab (which can only filter
the few-hundred-stock breadth/scanner pool). The existing **7 AM Candidate
Board** and **⚡ Live Scan** tools are preserved as secondary tabs.

### Decisions locked with the user
- **Universe:** whole market (~3,685 stocks) — true Finviz parity. Requires a precomputed snapshot DB + server-side query engine.
- **Page integration:** the new full-market scanner becomes the **primary/default** view. The old "Scanner" candidate board is renamed **Candidate Board** and kept as a tab; **Live Scan** kept as a tab; **Custom Scan** is absorbed/retired by the new scanner.
- **Tier:** **paid** (stays out of `FREE_PAGES`, gated like today).
- **Layout:** "Finviz Classic" — collapsible filter grid on top, dense full-width sortable results table below; chart via the existing TickerPopup (no permanent inline chart panel).
- **Filter control style (my call, user deferred):** preset dropdowns **plus** an optional "Custom…" min/max range (with slider) on numeric filters.
- **Categories (my call):** Descriptive · Fundamental · Technical · Single Candle · Multi-Candle · Patterns · All.
- **Result Views (my call):** Overview · Valuation · Financial · Technical · UCT Ratings · Charts (gallery). Plus sortable columns, heat-map cell shading, live price overlay, CSV export, per-row flag/watchlist actions, and Save Screen (named, reusable, shareable).

## 2. Goals / Non-goals

**Goals**
- Screen the full cap universe on stacked filters across all 6 categories, server-side, sub-second.
- One-click swappable column "Views" + a charts gallery.
- Saved, named, shareable screens.
- Reuse existing infrastructure: local daily bars (zero-network technicals/candles), `research_ratings.db` (RS rank + fundamentals), pattern engine, `useLivePrices`, `TickerPopup`, `TickerActions`, breadth grouping toolkit.

**Non-goals (v1)**
- Real-time intraday *filtering* (filters operate on the nightly EOD snapshot; live prices overlay result rows for display only — same model as Finviz free).
- Replacing the Candidate Board or Live Scan logic.
- Backtesting screens over history.
- Per-user custom computed columns / formula filters.

## 3. Architecture overview

```
NIGHTLY (after ratings nightly):
  local daily bars ─┐
  research_ratings.db ─┤→ screener_snapshot_builder.py → /data/screener.db
  fundamentals (yf)  ─┤      (one row per ticker, all filterable fields)
  pattern engine     ─┘
                                   │
QUERY (per request):               ▼
  filter spec (JSON) → query.py → parametrized SQL WHERE/ORDER over screener.db
                                   │
  → matched rows (view columns + sort + pagination)
                                   ▼
FRONTEND:
  ScannerPro.jsx (filter panel + results table + views)
  + useLivePrices overlay on visible rows (display only)
```

### Why a snapshot DB
A Finviz-style screener must answer "all stocks where P/E<30 AND RS>80 AND
above 50SMA AND VCP" instantly. Computing technicals/candles/patterns on demand
for 3,685 tickers per request is impossible at interactive latency. The proven
pattern in this codebase (`ratings_universe` nightly gather from local bars,
zero-network) is extended: one nightly pass writes every filterable field to a
flat per-ticker table; queries are pure SQL.

## 4. Backend

### 4.1 Snapshot DB — `/data/screener.db`

Single table `screener_rows`, one row per ticker, replaced/upserted nightly.
All numeric fields nullable (a ticker missing fundamentals still screens on
technicals). Indices on the most-filtered columns.

**Column groups (representative, not exhaustive — final list in the plan):**

- **Identity / Descriptive:** `ticker` (PK), `company`, `sector`, `industry`,
  `exchange`, `market_cap`, `price`, `avg_volume_30d`, `dividend_yield`,
  `is_optionable` (best-effort), `country` (best-effort).
- **Fundamental:** `pe_ttm`, `pe_fwd`, `peg`, `ps`, `pb`, `eps_growth`,
  `rev_growth`, `op_margin`, `gross_margin`, `net_margin`, `roe`, `roa`,
  `debt_to_equity`, `current_ratio`, `beta`, `inst_pct`. (Sourced from
  `research_ratings.db` where available; remainder from a light yfinance pass.)
- **UCT Ratings:** `uct_composite`, `rs_rank` (1-99), `rs_return`,
  `accdis`, plus the component percentile ranks already produced by the ratings
  system (growth/value/quality/momentum).
- **Technical (from local daily bars):** `chg_pct_1d`, `chg_pct_1w`,
  `chg_pct_1m`, `rsi14`, `pct_vs_sma20/50/200`, `pct_vs_ema20`, `ma_stack`
  (enum: full-bull / partial / bear), `adr_pct`, `atr_pct`, `vol_ratio`
  (today vol / avg), `gap_pct`, `dist_52w_high_pct`, `dist_52w_low_pct`,
  `above_50sma` (bool), `new_52w_high` (bool).
- **Single-candle (today's bar, from bars):** `candle_type` (enum: hammer,
  inverted-hammer, doji, bullish/bearish-engulfing, shooting-star, marubozu,
  spinning-top, none), `body_pct`, `upper_wick_pct`, `lower_wick_pct`,
  `close_position` (0-1 within range), `wide_bar` / `narrow_bar` (bool vs ATR).
- **Multi-candle (recent window, from bars):** `inside_bar_run` (count),
  `tight_consolidation` (bool — close CV over N bars), `pullback_depth_pct`,
  `higher_lows_run` (count), `nr7` (bool), `pocket_pivot` (bool),
  `consecutive_up`/`consecutive_down` (count).
- **Patterns:** `patterns` (comma-joined detector keys + a parallel
  `pattern_conf_max`). v1 coverage strategy below.
- **Meta:** `snapshot_date`, `bars_asof`, `built_at`.

**Pattern coverage strategy (v1):**
- A curated set of **cheap, high-value structural patterns** (e.g. flat base,
  VCP-ish contraction, bull/bear flag, 52W-high breakout, golden/death cross,
  cup-with-handle approximation) computed **universe-wide** in the builder,
  reusing `pattern_engine` detectors that are cheap on a single bar series.
- **Expensive detectors** keep running only over the pattern engine's existing
  active set; those flags are LEFT-JOINed in at query time from
  `pattern_detections` where present.
- The UI labels pattern coverage honestly (universe-wide vs active-set-only) so
  a pattern filter never silently implies full coverage it doesn't have.

### 4.2 Nightly builder — `api/services/screener/snapshot_builder.py`

- Runs as an APScheduler job **after** the ratings nightly (so it can read fresh
  `research_ratings.db`). Proposed ~3:00 AM ET (ratings is 2:30 AM ET).
- For each ticker: read local daily bars (zero network) → compute technical +
  single/multi-candle + cheap patterns; read ratings DB row; supplement
  fundamentals/market_cap/dividend from a light yfinance/`catalyst_metadata`
  pass (1 call/ticker, cached, incremental).
- **Incremental + capped per run** (mirrors `ratings_universe`): env
  `SCREENER_SNAPSHOT_MAX_PER_RUN` so a cold first run warms over a few nights
  while serving partial results immediately; subsequent nights are cheap deltas.
- Atomic per-row upsert; `built_at`/`bars_asof` stamped. Fully wrapped so one
  bad ticker never aborts the run.
- Runs on the **worker** pod if present (heavy), bridged to web via the existing
  `/data` + R2 mechanism if needed; otherwise inline-capped on web. (Decide at
  implementation based on current worker/R2 wiring.)

### 4.3 Filter registry + views — `api/services/screener/filters.py`

Single source of truth (shared shape with frontend via a `/meta` endpoint):
- Each filter: `{ key, label, category, type: 'enum'|'range'|'bool',
  column, presets: [{label, op, value|min|max}], allow_custom: bool, unit }`.
- Each view: `{ key, label, columns: [colKey…] }` for Overview / Valuation /
  Financial / Technical / UCT Ratings / Charts.
- Keeps SQL column names server-side only; the API speaks filter `key`s, never
  raw column names (injection-safe; parametrized).

### 4.4 Query engine — `api/services/screener/query.py`

- Input: `{ filters: [{key, op, value|min|max|in}], sort:{key,dir},
  view, page, page_size }`.
- Validates every `key`/`op` against the registry, builds a **parametrized**
  `WHERE` + `ORDER BY` + `LIMIT/OFFSET`, returns `{ total, rows, view_columns,
  snapshot_date }`.
- Patterns filter resolves against the snapshot `patterns` column OR the
  active-set `pattern_detections` join, per the coverage strategy.
- `page_size` capped (e.g. ≤500); default sort by `uct_composite` desc.

### 4.5 Saved screens — `api/services/screener/saved_screens.py`

- Table `screener_saved_screens(id, user_id, name, filter_json, view, sort_json,
  is_public, share_token, created_at, updated_at)`.
- CRUD (writes = owner; reads = owner + public). Optional `share_token` for a
  link. A handful of **built-in starter screens** (e.g. "Leaders pulling back to
  20EMA", "High-RS bases", "Earnings gappers holding gains") ship as read-only
  presets.

### 4.6 Router — extend `api/routers/screener.py`
- `GET  /api/screener/meta` — filter registry + views + preset starter screens.
- `POST /api/screener/scan` — run a query (filter spec in body).
- `GET/POST/PUT/DELETE /api/screener/saved-screens[/{id}]` — saved screens CRUD.
- `GET  /api/screener/snapshot-status` — coverage/freshness (rows built, asof).
- Existing `/api/candidates`, `/api/screener`, `/api/scanner/universe` untouched.
- All new endpoints `require` auth (paid gate enforced at the page/AuthGuard level as today).

## 5. Frontend

New package `app/src/pages/screener/`:
- `ScannerPro.jsx` — orchestrator (filter state, query, results, views, save).
- `FilterPanel.jsx` — category tabs (with per-tab active-count badges) + filter
  grid; each cell is a preset `<select>` with a "Custom…" option that reveals
  min/max inputs + slider for numeric filters. Reuse the shared `components/ui/`
  form primitives; mobile uses `FiltersSheet`.
- `ResultsTable.jsx` — view tabs (Overview/Valuation/Financial/Technical/UCT
  Ratings/Charts), sortable headers, heat-map numeric shading, per-row
  `TickerActions` (flag/tag/watchlist/alert) + click → `TickerPopup`. Optional
  breadth-grouping toggle (reuse `pages/breadth/grouping/`).
- `ChartsGallery.jsx` — the "Charts" view: grid of mini `StockChart`s per match
  (windowed/paged for perf; prefetch via `prefetchBars`).
- `SaveScreenBar.jsx` — preset/starter dropdown, save/rename/share.
- Hooks: `useScreenerMeta`, `useScreenerScan` (debounced POST as filters
  change), `useSavedScreens`.
- `ScannerPro.module.css` — UCT dark/gold theme; `@container`-query friendly so
  it also works as a `/charts` workspace widget (the existing `embedded` prop).

**Integrate into `Screener.jsx`:** tabs become **Scanner** (new ScannerPro,
default) · **Candidate Board** (today's 3-column board) · **⚡ Live Scan**. Remove
the `custom` tab; `CustomScan.jsx` retired (kept on disk as backup until ~30d
green, per project idiom).

**Live overlay:** visible result rows pass their tickers to `useLivePrices`;
price/Chg% cells update live. **Filtering still uses snapshot values** — live
data is display-only (clearly the Finviz model). A small "snapshot as of {date}"
line communicates freshness.

## 6. Performance / scale
- Query is indexed SQL over ~3,685 rows — microseconds; bottleneck is JSON
  serialization, bounded by `page_size`.
- Charts gallery windows/pages chart rendering (don't mount 142 charts at once).
- Builder is incremental + capped; reads local bars (no network) for the heavy
  technical/candle work.
- Live overlay only for the current page of rows.

## 7. Testing
- **Backend:** builder field computation (golden bars → expected candle/technical
  values), query engine (filter spec → correct WHERE + injection safety),
  saved-screens CRUD + sharing, meta registry integrity (every filter `column`
  exists; every view column exists).
- **Frontend:** FilterPanel preset↔custom toggle + active-count badges, view
  swap changes columns, sort, save/load a screen, live overlay merge, empty
  state.

## 8. Phasing (for the implementation plan)
1. **Snapshot foundation** — schema + builder (technical + single/multi candle
   from bars + ratings join + fundamentals pass) + nightly job + status endpoint.
2. **Query + meta + API** — filter registry, views, query engine, `/scan` +
   `/meta`, server tests.
3. **Frontend core** — ScannerPro page, FilterPanel, ResultsTable with views,
   sort, heat-map, live overlay; wire into Screener tabs (rename old Scanner →
   Candidate Board, retire Custom Scan).
4. **Saved screens + sharing + starter presets** + CSV export + row actions.
5. **Patterns + Charts gallery** — universe-wide cheap patterns in builder,
   active-set join, pattern filters, charts gallery view; honest coverage labels.
6. **Polish** — mobile sheet parity, `/charts` widget embedding, empty/loading
   states, perf passes.

Forward velocity per `feedback_ship_then_polish`: run phases end-to-end, polish last.

## 9. Implementation notes / risks
- **Branch from current `origin/master`** (which has the merged
  research/ratings DB code), NOT the stale local `feat/catalyst-coverage-precision`
  branch. Work in an **isolated git worktree** under `.worktrees/` and ship via
  fast-forward push (shared-tree hazard per `lesson_uct_dashboard_shared_worktree`).
- **Fundamentals universe-wide** is the one genuinely new data dependency beyond
  what's precomputed. Mitigate with the incremental/capped nightly pass + lean
  on `research_ratings.db` for the metrics it already holds (PE_fwd, growth,
  margins, ROE, RS, AccDis).
- **Pattern coverage** is intentionally tiered (universe-wide cheap set +
  active-set join). Don't claim full-universe pattern parity in the UI.
- **Worker vs web for the builder** — confirm current worker/R2 bridge wiring at
  implementation; default to worker pod for the heavy pass.
- Keep all new SQL parametrized and column names server-only (API speaks filter
  keys) — injection safety.
