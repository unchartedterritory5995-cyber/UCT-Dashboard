# Screener Deep-Work — Design

**Date:** 2026-08-21 · **Status:** approved in session, pending owner review of this document
**Owner decisions recorded:** product-first for both audiences · unify formula scans into the Scanner (join-only this round) · all four data families + competitor parity + our indicators/custom scans as data points · full UI redesign · direct replacement cutover at parity.

---

## 0. Goal

Make `/screener` the flagship third door of the indicator platform: a Finviz-Elite/TradingView-class full-market screener where classic filters, UCT's proprietary data (ratings, patterns, flow, dark pool, momentum mechanics), and member-authored formula scans live in **one surface** — with the owner's momentum screens shipped as the flagship presets.

Everything below builds on what already exists on master. Nothing forks the AST grammar, the interpreter, or the coverage semantics (Phase E adjudications E-A1…E-A8 stand).

## 1. Current state (verified against origin/master `08329c483`, 2026-08-21)

Three screener systems today:

1. **Scanner tab (ScannerPro)** — 65-column nightly snapshot (`screener_rows`, 03:00 ET, ~3,742 tickers), 43 registry filters in 6 categories, 6 fixed views, saved/shareable screens, CSV, charts gallery, live price overlay (top 300 rows, display-only).
2. **My Formulas tab (Phase E, shipped)** — user ASTs swept nightly 05:00 ET across the universe (`scan_hits`/`scan_coverage`), coverage receipts, scan→chart, NL concierge, starter library (1 starter). The **E-4 decision — how formula results join the classic Scanner — was explicitly deferred**; `scan_store.join_clause` exists unwired.
3. **Candidate Board + Live Scan tabs** — the 7:00 AM CT uct-intelligence scanner's output with client-side-only triggers.

Known debt this design absorbs: ~18 computed columns invisible or half-wired in the UI; no column customization / URL state / virtualization / phone table mode; missing loading/empty/error states; two disconnected saved-screens vocabularies; sort-vs-live mismatch during RTH; CSV silent-fallback; cramped filter panel; a11y gaps; 14 catalogued two-authorities-over-one-value duplications between the 7 AM scanner and the snapshot.

## 2. Column & filter taxonomy

Target: **65 → ~140 snapshot columns**, one shared taxonomy for the filter sidebar, the column picker, and the AST scalar manifest. Categories:

`Descriptive · Performance · Technical · Momentum Mechanics · Fundamentals · Ownership & Insiders · Events & Analysts · Patterns · Positioning/Flow · UCT · My Scans (filters only)`

### 2.1 New columns — Wave 1 (zero provider cost: local bars + reads the builder already does)

| Column | Definition | Writer |
|---|---|---|
| `dollar_vol_30d` | `price × avg_volume_30d` (exists nowhere in the platform today) | builder derivation |
| `chg_pct_3m`, `chg_pct_6m` | from `rs_ranking.cached_rank_map()` `returns` dict — same read `rs_fields` already does | rs_fields |
| `chg_pct_1y`, `chg_pct_ytd` | from local daily bars (400-bar read covers 1y; YTD from first session of year within window, else NULL) | technicals |
| `chg_from_open_pct` | last close vs last open | technicals |
| `volatility_1w`, `volatility_1m` | stdev of daily % change over 5 / 21 bars (Finviz-parity) | technicals |
| `dist_20d_high_pct`, `dist_20d_low_pct` | close vs 20-bar extremes | technicals |
| `dist_ath_pct`, `new_ath` | vs all-time high — requires deep-history bar read (see §5.4 build-time gate) | technicals |
| `pole_pct` | trough→peak % gain in last 22 bars (scanner's definition, promoted; single authority becomes the snapshot) | technicals |
| `vol_nweek_low` | 0/2/3/4 — volume at N-week low (dry-up tell) | technicals |
| `vol_updown_ratio` | up-day volume ÷ down-day volume, 10 bars | technicals |
| `close_cv_pct` | numeric CV of last 10 closes (today destroyed into the `tight_consolidation` bool; bool becomes a derivation of this) | candles |
| `avg_body_pct_5` | 5-bar average body % | candles |
| `ema_touch_count` | bars in last 15 with low ≤ EMA20×1.005 | technicals |
| `ema10_rising`, `ema20_rising` | slope bools | technicals |
| `ema_stack` | enum intact/partial/none — close>EMA10>EMA20 with both rising (the swing stack; existing `ma_stack` is positional SMA20/50/200 and keeps its name) | technicals |
| `candle_score` | 0–110 pullback-quality composite — scanner rubric ported verbatim, snapshot becomes the single authority | new `setup_score.py` |
| `prev_day_open/high/low/close` | prior session OHLC from bars (collapses Live Scan's SSE-fallback second authority) | technicals |
| `rs_line_trend` | up/flat/down — slope of ticker/SPY ratio over 20 bars. **One authority**: computed here; the three existing RS spellings are documented in §8 | technicals (needs SPY bars, one shared read per build) |
| `atr_ext_sma50` | (close − SMA50) / ATR — extension in ATR units | technicals |
| `stage` | Weinstein 2/4 flag + `hvc_52w` bool — **joined from the breadth store**, never recomputed (price basis differs: collector is dividend-adjusted) | breadth join |
| `in_uct20` | membership bool from `wire_data["leadership"]` | engine join |
| `theme` | primary UCT theme (`groups.resolve_primary_theme` via ticker_meta) | ticker_meta |
| `index_sp500`, `index_ndx`, `index_dow`, `index_r2k` | membership bools from `index_constituents` | index join |
| `is_etf`, `is_leveraged` | from etf universe + `single_stock_etfs` map | meta join |
| `ipo_date`, `ipo_age_days` | `ticker_ipo` / Massive reference (cached) | meta join |
| `country` | Finviz universe pull (see Wave 2) or ticker_meta | meta join |

Plus **expose-existing work** (registry/UI only, no new data): `inst_pct`, `atr_pct`, `chg_pct_1w`, `chg_pct_1m`, `pct_vs_sma20`, `dist_52w_low_pct`, `rs_return`, `accdis`, `consecutive_down`, `close_position` display, `pattern_conf_max`, `body/wick` anatomy, `company`/`industry` filters, `beta`/`current_ratio` column defs, `spinning-top` candle preset.

### 2.2 New columns — Wave 2 (new source jobs)

| Column | Source | Cost |
|---|---|---|
| `shares_outstanding` | already-downloaded FMP bulk CSVs (unread field) | zero requests |
| `quick_ratio`, `p_fcf`, `p_cash`, `payout_ratio`, `roic`, `lt_debt_to_capital` | same FMP bulk CSVs, unread fields (zero-corroboration rules extend to each) | zero requests |
| `float_shares`, `float_pct`, `short_float_pct`, `short_ratio`, `insider_own_pct` | **new nightly Finviz pinned-column universe pull** (one `export.ashx` call, `v=152&c=` explicit; §5.3 traps apply) | 1 request/night |
| `next_earnings_date`, `days_to_earnings`, `earnings_session` | FMP `stable/earnings-calendar` ranged pull, **chunked by date** (4,000-row silent truncation) | ~2–5 requests/night |
| `last_report_move_pct` | earnings wire store (`wire_prints.peak_move_pct`), local | zero |
| `implied_move_pct`, `earnings_setup_grade` | `implied_moves.db` snapshots — imminent reporters only, NULL otherwise (disclosed) | zero |
| `analyst_consensus`, `pt_upside_pct`, `upgrades_30d`, `downgrades_30d` | FMP grades / price-target-consensus — **cadenced pass** (actives daily, tail weekly) since these are per-ticker calls | bounded budget, measured before enabling |
| `insider_cluster_buy` | `insider_clusters.py` (OpenInsider), days-since-cluster int | existing 30-min cache |
| `blended_growth`, `sector_rs_pct`, `rating_eps/growth/value/smr`, `sponsorship` | ratings store + distributions — same percentile path the research page uses | zero when ratings gather runs |
| `eps_next_y_growth` | FMP analyst-estimates (annual_financials path) — cadenced | bounded |

Authority change recorded: `inst_pct` writer moves from the ratings store (yfinance, partial coverage) to the Finviz nightly pull (full universe, fresher). The composite's internal inputs still read the ratings store directly — unaffected. The one-writer rail test extends to every new column.

### 2.3 New columns — Wave 5 (patterns + flow)

| Column | Source |
|---|---|
| `pattern_engine_ids`, `pattern_engine_conf`, `pattern_engine_dir` | patterns.db `pattern_detections` (active, tf=D, last 7 days) — local join. The 50-detector engine replaces the cheap heuristics as the headline pattern data; cheap set retained as its own clearly-tiered columns |
| `pattern_entry_dist_pct`, `pattern_stop_dist_pct` | from `levels_json` of the best active detection |
| `pattern_expectancy_r` | `pattern_stats` for (pattern, tf, current regime bucket) |
| `dp_notional_1d`, `dp_prints_1d`, `dp_notional_5d` | `/data/darkpool.db` (web-local) nightly aggregation |
| `dp_level_dist_pct` | distance to nearest dark-pool level (signature DPL clusters) |
| `opt_net_premium_1d`, `opt_bull_pct_1d`, `opt_net_premium_5d` | **new nightly per-ticker aggregate job on the flow worker**, delivered to web via the existing proxy (or R2 drop); tf spelling trap: ledger `1D` vs bars `D` |

**Stretch (measurement-gated):** `fcb_signal_recency` — requires widening the signature sweep beyond its 10-symbol default list; a universe FCB sweep's cost must be measured before committing. **Excluded with reason:** GEX walls (live Schwab call per symbol, ~20s, zero caching — not snapshot-honest); after-hours columns (live lane, not snapshot).

### 2.4 AST scalar manifest

Every new numeric/bool/enum column above also lands in `closedTable.json` as a scalar (`store: screener_rows`, `cadence: nightly`) so formulas can screen on float, days-to-earnings, pole %, etc. **Batched into at most two manifest bumps** (end of Wave 2, end of Wave 5), each with new corpus cases and a deliberate conformance digest re-record — the same governed path E-1's 54 scalars took. The interpreter itself is frozen infrastructure (1e-9 parity); no walker changes.

## 3. Competitive parity matrix

Legend: ✅ have · 🔜 this round (wave #) · 🧮 covered via formula lane (AST function, not a column) · ⏳ deferred with reason · ❌ won't do (reason).

### 3.1 Finviz Elite screener filters

| Finviz filter | Status |
|---|---|
| Exchange, Sector, Industry, Country | ✅ / country 🔜1 |
| Index (S&P 500 / DJIA) | 🔜1 (`index_*` bools; adds NDX/R2K beyond Finviz) |
| Market Cap, Price, Average Volume, Relative Volume, Current Volume | ✅ (`vol_ratio` = relative volume; raw current volume exposed via column picker) |
| Dividend Yield, P/E, Forward P/E, PEG, P/S, P/B | ✅ |
| Price/Cash, Price/Free Cash Flow | 🔜2 (FMP bulk unread fields) |
| EPS growth this year / qtr-over-qtr, Sales growth qtr-over-qtr | ✅ approximated by TTM growth; exact QoQ variants ⏳ (FMP growth endpoints, cadenced — parity gap-fill Wave 6) |
| EPS growth next year / next 5 years, Sales past 5 years | 🔜2 (`eps_next_y_growth`) / 5-year variants ⏳ Wave 6 |
| ROA, ROE, ROI | ✅ / ROI≈`roic` 🔜2 |
| Current Ratio, Quick Ratio, Debt/Equity, LT Debt/Equity | ✅ / quick + LT 🔜2 |
| Gross/Operating/Net Margin, Payout Ratio | ✅ / payout 🔜2 |
| Insider Ownership, Institutional Ownership | 🔜2 / ✅ (`inst_pct`, authority moves to Finviz pull) |
| Insider/Institutional Transactions (3-mo change) | ⏳ Wave 6 (needs the Finviz pull to carry the change columns; verify ids live before promising) |
| Float Short (short % of float), Short Ratio, Float, Shares Outstanding | 🔜2 |
| Analyst Recom, Target Price | 🔜2 (`analyst_consensus`, `pt_upside_pct`) |
| Option/Short availability | ⏳ Wave 6 (Finviz col ids to verify) |
| Earnings Date | 🔜2 |
| IPO Date | 🔜1 |
| Performance week/month/quarter/half/year/YTD | ✅ 1w/1m + 🔜1 (3m/6m/1y/YTD) |
| Change, Change from Open, Gap | ✅ / from-open 🔜1 |
| Volatility (week/month) | 🔜1 |
| RSI(14), Beta, ATR | ✅ (`atr_pct` exposed 🔜1) |
| 20/50/200-day SMA distance | ✅ |
| 20-day / 50-day / 52-week High/Low distance | ✅ 52w; 20d 🔜1; 50d 🧮 (`highest/lowest` AST) |
| All-Time High/Low | 🔜1 (`dist_ath_pct`, `new_ath`) |
| Pattern (chart patterns) | ✅ cheap set + 🔜5 pattern engine (50 detectors — beyond Finviz) |
| Candlestick | ✅ |
| After-Hours Close/Change | ❌ snapshot (live lane); ⏳ as live-overlay column |

### 3.2 TradingView screener fields

| TradingView field | Status |
|---|---|
| Technical Rating (buy/sell summary) | ❌ as a black-box rating; our answer is transparent formula scans + UCT composite. Revisit only if members ask. |
| MACD, Stochastic, CCI, ADX, Aroon, W%R, Momentum, BB position | 🧮 — all are AST functions today; screenable via My Scans without new columns. Dedicated columns only if usage data demands. |
| VWAP distance | 🧮 (session VWAP has known UTC-session caveats; not a nightly column) |
| Premarket change/gap | ❌ snapshot (nightly artifact); Board/Live Scan carry premarket for candidates |
| Perf fields, 52w metrics, float, shares, recs, earnings date | covered above |
| Sector/industry breadth ratings | ⏳ — sector-RS percentile 🔜2 covers the useful core |

### 3.3 TC2000 / TrendSpider (condition-based scanning)

Parity **by construction**: any builder formula is simultaneously chartable, scannable, alertable (one grammar, one hash). PCF intake reads 61/71 Worden spellings; Pine intake 12/21 corpus scripts. No new work in this round.

## 4. Unification (the E-4 wiring)

### 4.1 My Scans as a filter category

- New registry category `my_scans`, populated per-user at `meta()` time from their live AST definitions + applied starters. Selecting one adds `{key: "scan", op: "in", value: def_hash}` to the spec.
- `query.run_scan` gains the `scan_store.join_clause` intersection: `ticker IN (SELECT ticker FROM scan_hits WHERE def_hash=? AND tf='D' AND as_of=?)` at the **latest as_of holding a coverage row** for that hash. Multiple scan filters intersect (AND).
- **Freshness disclosed, never blended silently:** the chip shows name + as-of + coverage ("swept 08-21 · 3,701/3,742 answered · 41 dropped"). If the definition has never been swept (no coverage row), the filter is inert-and-labeled ("first sweep tonight") rather than silently matching nothing. A `withheld` (entitlement) run has no shared receipt — same "first sweep tonight" surface, per the no-shared-receipt rule.
- Coverage arithmetic and the four-outcome semantics are untouched. Member requests never trigger evaluation.

### 4.2 One saved-screens manager

- Single manager UI listing both **screen specs** (filters/sort/view/columns) and **formula definitions**, type-badged, replacing SaveScreenBar's popover and the My Formulas tab. Definition detail keeps ScanResults + CoverageLine.
- A saved screen spec may reference def_hashes (My Scans filters); loading one restores the whole state including custom columns.
- Share flow unchanged (spec-only tokens, public route, two-step publish).
- The My Formulas tab retires at cutover; `Screener.scanmount.test.jsx` and `reachable.test.js` are updated **deliberately in the same commit** that moves the mounts (the wire-cut lesson: these tests exist to catch severed wires — they must follow the wire, not be deleted).

### 4.3 Formula-value columns — deferred, capacity-gated

Join-only was the chosen architecture. Value-columns (a formula's numeric output as a sortable column) require a dense per-ticker store (hits-only storage math: 2% hit-rate ≈ 34 GB/yr @10k defs vs 1,717 GB dense) and added sweep wall-clock. Revisit after Wave 4 with measured sweep headroom (`unswept` counts from coverage receipts). Raised once here; standing.

## 5. Backend architecture

### 5.1 Snapshot expansion mechanics

- Columns added **only** in `snapshot_db.COLUMNS`; `_TEXT`/`_INT` sets updated per column (also fix the `accdis` letter-in-REAL-column latent mistake for new DBs; existing DBs unaffected — SQLite dynamic typing).
- One writer per new column; the derived rails (`test_no_two_screener_sources_write_the_same_column`, disjoint-map test, scalar population rail) extend automatically because they run the sources.
- The build receipt's per-column `populated` counts and `describe_rows` provenance close over new columns by construction; each wave's ship gate reads the receipt, not the log line.
- FMP zero-corroboration idiom (`value_for`) extends to each new bulk field.
- **No new uncached per-ticker Massive calls in the nightly loop** (get_ticker_details is the existing exception, unchanged).

### 5.2 New nightly jobs (all registered in `api/main.py` alongside the existing ones, each env-gated with default matching prod intent)

| Job | Time | Notes |
|---|---|---|
| Finviz universe pull | 02:45 ET (before snapshot) | one `export.ashx` call, pinned `c=`, browser UA; §5.3 traps |
| FMP earnings-date pull | 02:50 ET | date-chunked; writes a small local table the builder joins |
| Analyst cadenced pass | 02:00 ET | actives daily / tail weekly; "actives" = union of member watchlists, UCT20, current candidates, and top-500 by dollar_vol_30d; budget logged in receipt |
| Flow-worker per-ticker aggregate | on worker, post-ingest | ships one JSON/CSV to web (proxy or R2); web-side join in builder |
| DP aggregate | in-builder | local darkpool.db read |

### 5.3 Finviz pull — traps codified as tests

Filters fail **open** (invalid token silently ignored): the row-count-vs-liquidity-clause-alone diff test guards every filter string. Units: Market Cap raw **millions**, Average Volume raw **thousands**, suffixed forms also occur. `v=152` with no `c=` is a bug, full stop. 403s bare python UAs on HTML endpoints. Never build inline on a request path; background warm with an in-flight flag; never cache an empty result. Column ids for float/short/insider-own verified live before the wave ships (grep the concept, not the abbreviation).

### 5.4 Build-time budget

Current build reads 400 D bars/ticker. Wave 1 needs: SPY bars once per build (RS line), deeper history for ATH (up to 5,000 bars where available). Gate: measure build wall-clock before/after on the pod; if ATH depth pushes the 03:00 build past ~04:30 ET (it must finish before the 05:00 scan sweep), ATH moves to a weekly refresh column. Caps (`SCREENER_SNAPSHOT_MAX_PER_RUN` 4000, warm 500, refresh 800) unchanged.

### 5.5 Query & payload

`run_scan` moves from `SELECT *` to **projection**: the view/picker's column set + always-included identity/sort columns. At ~140 columns this keeps 100-row pages lean and CSV exports explicit. Sort-key validation continues to derive from `set(COLUMNS)`; the silent fallback-to-uct_composite on unknown sort keys becomes a 400 (matching filter behavior — no silent substitution).

## 6. UI/UX redesign

### 6.1 Layout (desktop)

- **Left sidebar**: searchable filter list, grouped by the §2 taxonomy, collapsible groups with active-count badges, presets inline per filter, custom-range inputs with Enter-to-apply and validation (controlled components — kills the `document.getElementById` pairing and its duplicate-mount id collision).
- **Toolbar**: view presets (the 6 canonical views become column-set presets), **column picker** (search, toggle, drag order; per-screen persistence), density toggle, saved-screens manager, share, CSV, snapshot-date + provenance popover (the `mixed`/oldest/newest data already in every response).
- **Results**: virtualized table (`react-virtual`, already installed), sticky header + sticky ticker column, `aria-sort` headers (focusable), heat scales per columnDef, live-overlay cells badged, rows beyond the live-subscription cap visually marked static.
- **Sort honesty**: sorts on live-overlaid columns get a "snapshot order" note + a client-side "re-sort loaded rows live" toggle (loaded rows only; server order remains snapshot-based and labeled).
- **States**: skeleton table on first scan; empty state that keeps the toolbar alive; error banner with retry; page-append spinner; CSV export **fails loudly** (error toast naming the row count exported, never a silent partial file).

### 6.2 Mobile

- Card/two-line row mode below 640px (ticker + price/chg on line 1, three picker-chosen stats on line 2), sticky symbol; FiltersSheet becomes a touch-first list (44px targets) rather than the shrunken desktop panel; Live Scan gets its first phone CSS (feed stacks above the watch table). Verified with `tools/mobile_audit.py` + opened screenshots (the vacuous-pass lesson: `overflowX=0` proves nothing — open the image).

### 6.3 Charts view, Board, Live Scan

- Charts gallery kept as a view; card-level click opens the popup (currently only the symbol text does).
- Board + Live Scan tabs restyled to tokens (Screener.module.css's hardcoded hex/rgba and the double `pulse` keyframe cleaned); **no functional rebuild** — server-side trigger evaluation on the alert engine is out of scope this round.
- `PatternFeedbackChip` scoped to admin (its original intent; it currently renders for every member on every row).

### 6.4 Cutover

Direct replacement: the new shell ships as THE Scanner tab once the parity checklist is green (all 43 existing filters + saved screens + share + CSV + views + live overlay + charts view). Old components deleted in the same wave (`reachable.test.js` sweeps orphans). No long-lived dual UI.

## 7. Flagship presets (owner thresholds — confirm at spec review)

Spec-starters (registry lane) and AST starters (starter library) both grow. Draft thresholds derived from in-product published sources (scanner hard gates, existing starters); **owner confirms or edits each number before the preset ships** (E-8):

| Preset | Draft definition |
|---|---|
| Momentum Leaders | rs_rank ≥ 90 · adr_pct ≥ 4 · dollar_vol_30d ≥ $20M · price ≥ $5 · above_50sma |
| Pullback to 20EMA (exists, extended) | rs_rank ≥ 80 · pct_vs_ema20 −2..2 · ema_stack intact · vol_nweek_low ≥ 2 |
| Tight Base Near Highs | dist_52w_high_pct ≥ −8 · close_cv_pct ≤ 2.5 · vol_updown_ratio ≥ 1 · rs_rank ≥ 70 |
| Gap Movers | gap_pct ≥ 8 · vol_ratio ≥ 3 · market_cap ≥ $300M |
| 52W Breakout on Volume | new_52w_high · vol_ratio ≥ 1.5 · dollar_vol_30d ≥ $10M |
| Earnings Momentum | days_to_earnings ≤ 7 · implied_move_pct present · rs_rank ≥ 70 (Wave 2+) |

The four existing spec starters migrate into the unified manager unchanged (pe_fwd starter keeps its corrected key).

## 8. Hygiene riding along

**Duplication ledger** (from the 2026-08-21 exploration; full list in the session record). Promotions make the snapshot the single authority for: ADR% definition, close-CV tightness, EMA20 distance naming, prev-day OHLC. Named-but-not-unified this round (different repos or genuinely different facts): scanner `volume_ratio` window (20d) vs snapshot `vol_ratio` (30d) — snapshot definition wins in all dashboard surfaces; three RS spellings (rs_rank authority stands; `rs_line_trend` becomes the one behavioral RS; the brain's internal 20-day percentile is out of scope but **named** so it can't become a fourth authority silently); three pattern systems become explicit tiers (engine > cheap heuristics; scanner wedge/flag stays scanner-side).

**uct-intelligence adjacent fix (separate repo, separate ship, confirm before touching):** `leading_sectors` is accepted, logged, and published in scanner output metadata but never filters anything — docstrings claim restriction, no membership test exists. Fix = either implement the filter or delete the parameter and the folklore; owner call at review.

## 9. Out of scope (recorded so absence reads as decision, not omission)

GEX columns (live-only source) · after-hours snapshot columns · Live Scan server-side rebuild · formula-value columns (capacity-gated, §4.3) · intraday sweep cadence (spec §8.5 owner question stays open) · scripting tier (killed, standing) · any interpreter/walker performance work (1e-9 parity is load-bearing) · growth of `INDICATOR_FUNCS` (frozen at 28 by adjudication).

## 10. Waves & ship gates

Every wave: review + audit → implement → ship → proceed (standing). Deploy verification by artifact: `/api/health` uptime reset + served `dist/assets` grep + **opening the page with a real, full payload** (screenshots on desktop + phone).

| Wave | Track | Content | Ship gate |
|---|---|---|---|
| 0 | spec | this document + owner threshold confirmations | owner review |
| 1 | backend | zero-cost columns + expose-existing + registry entries + rails | build receipt: new columns `populated` at expected coverage on prod; row-count sanity vs prior night |
| 2 | backend | Finviz pull, earnings dates, analyst pass, insider clusters, ratings-store fields, FMP-bulk unread fields | per-source receipt + the fail-open Finviz diff test green |
| 3 | frontend (parallel w/ 1–2; file ownership disjoint) | new Scanner shell: sidebar, virtualized table, column picker, URL state, states, mobile cards | parity checklist green → direct cutover; mobile audit screenshots opened |
| 4 | full-stack | E-4 scan join + unified saved-screens manager + retire Formulas tab | wire-cut tests moved deliberately; join freshness UX verified with a swept + never-swept definition |
| 5 | backend | pattern-engine join, DP aggregates, flow-worker aggregate job | receipts; flow job verified on worker artifacts, not logs |
| 6 | both | AST scalar manifest bumps (≤2), flagship presets, a11y polish, parity gap-fill (QoQ growth, insider/inst transactions, option/short flags) | conformance digests re-recorded deliberately; corpus cases added |

Rollback per wave: new columns are additive (old UI ignores them); UI cutover is a single revert; new jobs are env-gated; manifest bumps ship with their digest re-records atomically.

## 11. Testing & constraints checklist

- Backend: pytest per touched service; the ~9,600-test full run is chunked (~14 chunks). Frontend: vitest from `app/`, `--pool=threads` through the node_modules junction; CRLF-safe assertions.
- Rails that must extend, not break: one-writer-per-column (derived), scalar population rail, scan auth-coverage count test (`router.routes`-derived — update the asserted count when routes are added), coverage-arithmetic closure, wire-cut mount tests, reachable sweep, share-link single-source (`screenShareLink.js`).
- Probe names derived, never typed (`sqlite_master` / `router.routes`); verify with AST, not grep.
- Worktree discipline: never `git add -A`; ship `push origin <branch>:master` after fetch→merge→re-verify; Ravi's co-edited files (OptionsFlow.jsx, schwab_router.py, live_massive_router.py, massive_ws_worker.py, massive_processor.py) untouched by this initiative — no ack needed unless that changes.
- Keys: `FMP_API_KEY` lives in uct-intelligence/.env locally (Railway has its own); `MASSIVE_API_KEY` absence produced the all-NULL market_cap build — every new source reads its receipt, never assumes.
