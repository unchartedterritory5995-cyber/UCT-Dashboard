# Journal A+ — P2 Excursion Engine + Exit Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Compute MFE/MAE (max favorable/adverse excursion) per closed trade from intraday bars, in the web process, and surface Exit Quality: a per-trade exit-efficiency % on the trade page + a "Risk & Exits" analytics section. Fills the reserved `exitEfficiency` slot P1b left on the trade page and the `EFFICIENCY_TITLE` "computed nightly" placeholder.

**Architecture:** A greenfield `j2_trade_excursions` side-table keyed on the stable **`trade_ref`** (`ext:<external_id>` broker / `id:<row id>` manual — NOT raw external_id, which is NULL for all manual trades). A pure calc module + an engine that reads bars via **internal python** (`bars_sqlite.get_bars` local cache first, then `massive.get_agg_bars_minute` for deep windows — never HTTP `/api/bars`). A nightly in-web APScheduler backfill + on-close/on-demand compute + admin trigger + status endpoint, mirroring the existing web-side scheduled-job patterns. Exit-efficiency attaches to the existing `GET /api/j2/trades/{id}` and rides the existing `GET /api/j2/analytics` mega-endpoint as a new section.

**Tech Stack:** FastAPI + SQLite (auth.db, WAL) · APScheduler (web, scheduler_lock) · Massive REST via internal client · React/Vite (echarts-for-react, vitest) · pytest colocated.

## Global Constraints

- Isolated worktree `.worktrees/journal-aplus-p2` off origin/master (branch `feat/journal-aplus-p2`). NEVER touch the main tree. Never `git add -A`. Ship via `git push origin feat/journal-aplus-p2:master`.
- Before EVERY push: `grep -c broker_sync api/main.py` ≥ 7.
- **Bars: internal python only.** `bars_sqlite.get_bars(ticker, tf, max_bars) -> list[(ts,o,h,l,c,v)]` (local SQLite, `ts`=unix seconds intraday / YYYYMMDD-int for D/W/M) and `massive.get_agg_bars_minute(ticker, multiplier:int, from_date:'YYYY-MM-DD', to_date:'YYYY-MM-DD') -> list[{t:unix MS, o,h,l,c,v}]` (deep intraday, network — but internal python, NOT the anyio threadpool). NEVER call the `/api/bars` HTTP route.
- **⚠️ TIMESTAMP UNITS DIFFER — the #1 bug risk.** Massive raw dicts (`get_agg_bars_minute`) = unix **milliseconds**. `bars_sqlite.get_bars` = unix **seconds** (intraday) / YYYYMMDD-int (daily). Normalize everything to unix **seconds** at the boundary; assert in tests.
- **Excursion key = `trade_ref`** (`trade_refs.trade_ref_for_row(row)`), NOT external_id. Partial-unique index `(user_id, trade_ref)`. This survives the broker purge+reinsert cycle AND covers manual trades. (Correction to design Appendix A #2.)
- **Heavy work NEVER at import/boot.** Backfill = admin endpoint + nightly cron only. Engine reads bars during off-hours; batched by symbol with cross-user dedupe; short DB writer locks (auth.db serves logins).
- **Options via underlying, excluded from blended $.** Compute option excursions on the strategy's `underlying` symbol, label `data_quality='underlying'`, and EXCLUDE them from the equity Exit Quality $ aggregates and the blended exit-efficiency %; report separately in R/underlying-move terms.
- **Honesty invariants (tested):** every surface shows a methodology label (`bar_resolution` / `data_quality`), renders "N/A — insufficient bars" or "pending nightly" states — NEVER a silent 0. Aggregates coverage-gated ("computed from N of M trades") and n<10 confidence-shaded (imitate `analytics._edge_score`'s `score=None` + components pattern).
- `original_stop` is NOT NULL; `trade_r_multiple(side, entry_price, price, original_stop)` (calculations.py) converts any excursion price → R with the correct denominator. Reuse it — no new R math.
- No vite `manualChunks` edits. No emoji (UIcon only). Deploys ship any time (user authorized window override) — but still `grep broker_sync` first.
- Backend baseline failures NOT yours: 15 `test_options.py` (time-brittle past-expirations) + 5 `test_coach_chat_tools.py`.

---

### Task 1: `excursion_calc.py` — pure MFE/MAE math

**Files:** Create `api/services/journal_two/excursion_calc.py` + `test_excursion_calc.py`

**Interfaces — Produces:**
- `compute_excursion(side: str, entry_price: float, original_stop: float, entry_ts: int, exit_ts: int, bars: list[dict], *, exit_price: float) -> dict | None` where each bar is `{"t": int_unix_seconds, "h": float, "l": float}`. Returns `None` if no bar falls in `[entry_ts, exit_ts]`. Else:
  - `mfe_price`, `mae_price` — for Long: mfe=max high, mae=min low in window; for Short: mfe=min low (favorable = price down), mae=max high.
  - `mfe_ts`, `mae_ts` — the bar time of each extreme (first occurrence).
  - `mfe_r`, `mae_r` — via `trade_r_multiple(side, entry_price, mfe_price, original_stop)` / `(…, mae_price, …)` (may be None when stop==entry).
  - `exit_efficiency` — `captured / available` where captured = favorable move entry→exit, available = favorable move entry→mfe; clamp to `[0, 1]`; **None** when `available <= EPSILON` (no favorable excursion → efficiency undefined, never 0).
  - `missed_r` — `mfe_r - r_at_exit` (favorable R left on the table), None when either is None.

**Semantics (the load-bearing decisions):** window is inclusive of entry and exit bars; a bar's high/low both count (intrabar path unknown — this is the standard bar-approximation, documented). Efficiency uses PRICE move (not R) so it's stop-independent. Short-side favorable = downward.

- [ ] Step 1 — Write failing tests: Long winner (entry 100, stop 95, exit 110, a bar with high 115 → mfe_price 115, mfe_r=(115-100)/(100-95)=3.0, exit_efficiency=(110-100)/(115-100)=0.667, missed_r=3.0-2.0=1.0); Short winner (entry 50, stop 52.5, exit 45, bar low 42 → mfe_price 42, favorable); no-favorable case (price only went against → available≈0 → exit_efficiency None, not 0); empty-window (no bar in range → None); stop==entry (mfe_r None but exit_efficiency still computes from price). Run `python -m pytest api/services/journal_two/test_excursion_calc.py -q` → FAIL (module missing).
- [ ] Step 2 — Implement (import `trade_r_multiple`, `safe_divide`, `EPSILON` from `calculations.py`). Run → PASS.
- [ ] Step 3 — Commit `feat(j2): pure MFE/MAE + exit-efficiency excursion math`.

---

### Task 2: schema `j2_trade_excursions` + `excursions_store.py`

**Files:** Modify `api/services/journal_two/db.py` (append `_PHASE_2_ALTERS`) · Create `excursions_store.py` + `test_excursions_store.py`

**Schema (append to `_PHASE_2_ALTERS` as list entries, imitating P1b's j2_trade_attachments):**
```
"CREATE TABLE IF NOT EXISTS j2_trade_excursions ("
"user_id TEXT NOT NULL, trade_ref TEXT NOT NULL, symbol TEXT, "
"mfe_price REAL, mae_price REAL, mfe_r REAL, mae_r REAL, "
"mfe_ts INTEGER, mae_ts INTEGER, exit_efficiency REAL, missed_r REAL, "
"bar_resolution TEXT, data_quality TEXT, computed_at TEXT NOT NULL, "
"PRIMARY KEY (user_id, trade_ref))",
"CREATE INDEX IF NOT EXISTS idx_j2_excursions_user ON j2_trade_excursions(user_id)",
```
(`data_quality` ∈ `'intraday_1m'|'intraday_5m'|'daily'|'underlying'|'insufficient'`.)

**Interfaces — Produces (service acquires own conn via `auth_db.get_connection`, `conn` param optional for tests):**
- `upsert_excursion(user_id, trade_ref, data: dict, conn=None) -> None` (INSERT OR REPLACE; `computed_at`=now ISO).
- `get_excursion(user_id, trade_ref, conn=None) -> dict | None`.
- `list_excursions_for_user(user_id, conn=None) -> dict[str, dict]` (ref→row, for the analytics join).
- `existing_refs(user_id, conn=None) -> set[str]` (for the backfill's idempotency skip).

- [ ] Step 1 — Failing tests (`:memory:` + `j2db.ensure_schema(conn)` per test_trade_refs.py): upsert→get roundtrip; upsert twice on same ref = 1 row (REPLACE); list returns ref-keyed map; insufficient-tier row stores data_quality='insufficient' with NULL metrics. RED.
- [ ] Step 2 — Implement. GREEN. Full suite vs baseline.
- [ ] Step 3 — Commit `feat(j2): j2_trade_excursions side table (trade_ref keyed) + store`.

---

### Task 3: `excursion_engine.py` — bar-fetch + compute orchestrator

**Files:** Create `excursion_engine.py` + `test_excursion_engine.py`

**Interfaces — Produces:**
- `compute_for_trade(trade_row, *, bar_fetch=None, conn=None) -> dict` — given a `j2_trades` row (sqlite3.Row or dict w/ symbol/side/entry_price/original_stop/entry_date/exit_date/exit_price), resolve `trade_ref_for_row`, pick the tier, fetch bars via `bar_fetch` (injectable; default = the internal reader below), run `excursion_calc.compute_excursion`, and `upsert_excursion`. Returns the stored dict (or an `insufficient`-tier record when no bars). **`bar_fetch` is injected so the core is network-free and unit-tested with synthetic bars.**
- Default internal `_fetch_bars(symbol, entry_ts, exit_ts) -> tuple[list[dict], tier]`:
  - hold-time = exit_ts − entry_ts. Same-day (hold < ~1 trading day) → try 5m; sub-day/scalp → 1m. Multi-day swing → 5m if the window ≤ the 5m ceiling, else **daily** (`data_quality='daily'`, high/low per day).
  - Read order: `bars_sqlite.get_bars(symbol, tf, N)` first (local cache); if it doesn't cover `[entry_ts, exit_ts]`, call `massive.get_agg_bars_minute(symbol, mult, from_date, to_date)` (deep) and NORMALIZE `t/1000` → seconds. Daily tier → `massive.get_agg_bars(symbol, from, to)` (also ms → seconds) using per-day h/l.
  - No bars at all → `([], 'insufficient')`.
- `compute_for_option_strategy(strategy_row, legs, *, bar_fetch=None, conn=None) -> dict` — compute on the strategy's `underlying`, tier forced `data_quality='underlying'`, using net_entry-derived "price" is NOT valid → instead compute the UNDERLYING's MFE/MAE in underlying-price terms and store R vs a synthetic underlying stop = None (mfe_r/mae_r NULL; exit_efficiency in underlying-move terms). Keep it clearly separate; store under the strategy's trade_ref (`id:<strategy id>` — options aren't in j2_trades, so always `id:`).
- `_pick_tier(hold_seconds) -> (tf_code, data_quality)` — pure, unit-tested.

**⚠️ Timestamp normalization:** entry_ts/exit_ts derive from the trade's entry_date/exit_date via `datetime.fromisoformat(...).timestamp()` (handle date-only → midnight-UTC and the P1a heterogeneous formats). A trade with a date-only entry AND a date-only exit on the same day has a zero/sub-day window → daily tier or insufficient (document). Reuse `timeutil._parse` if it helps.

- [ ] Step 1 — Failing tests with an INJECTED `bar_fetch` returning synthetic bars: same-day Long → 5m tier, correct mfe from the synthetic high; multi-day → daily tier; empty fetch → insufficient record stored; tier picker boundaries; option strategy → underlying tier. RED.
- [ ] Step 2 — Implement (core network-free via injection; `_fetch_bars` is the only networked part, covered by an integration-style test that monkeypatches `bars_sqlite.get_bars`/`massive.get_agg_bars_minute` to return canned rows and asserts ms→seconds normalization). GREEN. Full suite vs baseline.
- [ ] Step 3 — Commit `feat(j2): excursion engine (tiered internal bars, network-free core)`.

---

### Task 4: in-web nightly job + admin trigger + status endpoint

**Files:** Create `excursion_jobs.py` (register_jobs + run_backfill + get_state) · Modify `api/main.py` (register in scheduler-lock block next to j2_attachments_backup at ~:2877) · Modify `api/routers/journal_two.py` (admin trigger + status routes)

**Interfaces — Produces:**
- `run_backfill(*, user_id=None, force=False, limit_batch=200) -> dict` — SELECT closed trades (all users, or one) whose `trade_ref` is NOT in `existing_refs` (unless force); **batch by symbol** (fetch each symbol's bar window once, compute all that symbol's trades — cross-trade dedupe), `compute_for_trade` each, upsert; commit per symbol-batch (short locks). Also closed option strategies. Returns `{trades_done, options_done, insufficient, batches, symbols}`. Runs off the request path.
- `register_jobs(scheduler) -> bool` — gated `EXCURSION_ENGINE_ENABLED` (default '0', fresh-read helper like `j2_attachments_backup._enabled`); `add_job(_nightly, CronTrigger(day_of_week='mon-sat', hour=3, minute=10), id='j2_excursion_backfill', max_instances=1, replace_existing=True)`. `_nightly` calls `run_backfill()`.
- `get_state() -> dict` (last run counts/time, under a lock) for the status endpoint.
- main.py: `from api import` … no — it's under journal_two; register via `from api.services.journal_two import excursion_jobs; if excursion_jobs.register_jobs(_scheduler): print('[startup] j2 excursion backfill registered')` in a try/except next to the attachments-backup registration. Confirm `grep -c broker_sync api/main.py` ≥ 7 after.
- Routes: `POST /api/j2/admin/excursion-backfill` (`require_admin`; if not `_enabled()` → `{"started":False,"reason":"disabled"}`; else daemon thread → `run_backfill`, `{"started":True}` — copy the attachments-backup route). `GET /api/j2/admin/excursion-status` (no-auth read-only → `get_state()`, mirror reconciliation-status).

- [ ] Step 1 — Failing test: `run_backfill(user_id=…, bar_fetch injected via monkeypatch)` over 2 seeded trades → both get excursion rows; a 2nd run with no force → 0 done (idempotent skip on existing_refs); force → recomputes. Register/route wiring: `python -c "import api.main"` exits 0; the two routes resolve. RED.
- [ ] Step 2 — Implement. GREEN. `grep -c broker_sync api/main.py` ≥ 7.
- [ ] Step 3 — Commit `feat(j2): excursion nightly backfill job + admin trigger + status (gated)`.

---

### Task 5: attach excursion to the trade detail endpoint

**Files:** Modify `api/services/journal_two/trades.py` (`get_trade_detail` ~:1113 add a 4th key) · Modify `_row_to_trade`? No — attach as a sibling.

**Interface:** `get_trade_detail` returns `{trade, tradeRef, brokerActivities, excursion}` where `excursion = excursions_store.get_excursion(user_id, trade_ref_for_row(row))` (or None if not yet computed). Add a **compute-on-first-view** fallback: if `excursion is None` AND the trade is closed AND ENABLED, fire a best-effort `compute_for_trade` synchronously with a tight per-symbol bar read ONLY if it's cheap (same-day, bars likely cached) — else leave None (nightly fills it). Keep it bounded (never block the response > ~1s; wrap in try/except → None). Simplest safe version: return the stored row or None, and let the nightly job / admin backfill populate; the FE shows "pending nightly". (Implementer: prefer the simple stored-or-None; only add on-view compute if trivially bounded.)

- [ ] Step 1 — Failing test: seed a trade + an excursion row → `get_trade_detail` returns the `excursion` sub-object; no excursion → `excursion: None`. RED → implement → GREEN.
- [ ] Step 2 — Commit `feat(j2): attach excursion to trade detail endpoint`.

---

### Task 6: trade-page exit-efficiency + MFE/MAE chart overlay

**Files:** Modify `app/src/pages/journal-2-0/components/trade/tradePageModel.js` (`outcomeModel`) + `.test.js` · Modify `TradeDetailPage.jsx` (efficiency cell + chart overlay + states) · `.module.css`

**Interfaces:**
- `outcomeModel(trade, excursion = null)` — fill the reserved `exitEfficiency` slot: `excursion?.exitEfficiency ?? null`; add `mfeR`/`maeR`/`dataQuality`/`missedR` passthrough for display. Keep pure; update tests.
- TradeDetailPage: `const excursion = data?.excursion`; `outcomeModel(trade, excursion)`. The efficiency cell (lines ~330-333) renders: a real `percent(out.exitEfficiency, {isRatio:true})` when present; else the honest state — "pending" (excursion null, title "Analyzed nightly — lands ~3 AM ET") vs "N/A — insufficient bars" (excursion present but data_quality='insufficient') vs "bar-approx (5m)" label on real values. Add MFE/MAE as horizontal priceLines on the chart (via `buildTradeMarkers` extension or a new overlay) with a labeled legend. Options trades (isOption / underlying quality) → efficiency shown "underlying-based" labeled.
- Fire NO new telemetry here (trade_page_open already covers opens).

- [ ] Step 1 — Model tests: `outcomeModel(trade, {exitEfficiency:0.667,...})` → exitEfficiency 0.667; `outcomeModel(trade, null)` → null; data_quality passthrough. RED → implement → GREEN.
- [ ] Step 2 — Component test (mock SWR incl. `excursion`): real % renders with the bar-approx label; null → "pending"; insufficient → "N/A — insufficient bars". `npx vitest run src/pages/journal-2-0/components/trade/` + `npm run build`.
- [ ] Step 3 — Commit `feat(j2): trade-page exit efficiency + MFE/MAE overlay + honest states`.

---

### Task 7: `_exit_quality_section` analytics aggregate

**Files:** Modify `api/services/journal_two/analytics.py` (new `_exit_quality_section`, one dict key, extend `_fetch_trades` SELECT to include `id`, `external_id`, `source` so rows can key excursions) · `test_analytics.py`

**Interface:** `get_analytics` gains `"exitQuality": _exit_quality_section(rows, excursions_map)` where `excursions_map = excursions_store.list_excursions_for_user(user_id)` filtered to the fetched rows' trade_refs. The section returns:
- `coverage`: `{eligible, computed}` (computed = rows with a non-insufficient excursion). Aggregates SUPPRESSED (fields None) until `computed/eligible >= 0.9` — with a `coverageReady` bool + the counts so the UI explains "computed from N of M".
- `avgExitEfficiency` (equity, non-underlying only), `missedDollars` total, `missedR` total, `efficiencyBuckets` (histogram: 0-25/25-50/50-75/75-100%), `actualVsPotential` (two cumulative curves: realized vs if-captured-80%-of-MFE).
- n<10 gate: like `_edge_score`, return the shape with metric Nones + `tradeCount` when `computed < 10`.
- Options excursions EXCLUDED from the $ aggregates; a separate `optionsExitQuality` sub-block in R/underlying terms (or omit in v1 and note).

- [ ] Step 1 — Failing tests (seed trades + excursion rows via the store): coverage gate suppresses aggregates below 90%; above 90% + n≥10 → real avgExitEfficiency/missedDollars; n<10 → Nones + counts; options excluded from $ agg. RED → implement → GREEN (full suite vs baseline).
- [ ] Step 2 — Commit `feat(j2): Exit Quality analytics section (coverage-gated, n<10 shaded)`.

---

### Task 8: FE "Risk & Exits" analytics section

**Files:** Create `app/src/pages/journal-2-0/components/analytics/RiskExitsSection.jsx` (+ test) · Modify `AnalyticsTab.jsx` (CollapsibleSection id="riskExits")

**Interface:** `<RiskExitsSection data={data.exitQuality} />` inside a `{data.exitQuality && <CollapsibleSection id="riskExits" title="Risk & Exits">...}` (after attribution, ~AnalyticsTab.jsx:240). Component (NO own header — CollapsibleSection supplies it):
- If `!data.coverageReady`: a designed "computed from N of M trades — check back after tonight's analysis" state (NOT an empty chart).
- Modules with plain-language titles + technical subtitle: "How much of the move did you capture?" (avgExitEfficiency gauge + efficiencyBuckets bar), "What did exits leave on the table?" (missedDollars/missedR headline + the actualVsPotential overlay line chart). n<10 → grayed with the count shown.
- ECharts via the AnalyticsTab pattern (baseChart/moneyAxis/CHART_COLORS, `<ReactECharts>` in a chartCard div). `money`/`percent`/`rMultiple` from format.js. NO emoji.

- [ ] Step 1 — Test: coverage-not-ready → the check-back copy; ready+data → renders the efficiency + missed modules; n<10 → grayed. `npx vitest run src/pages/journal-2-0/components/analytics/RiskExitsSection.test.jsx` + build.
- [ ] Step 2 — Commit `feat(j2): Risk & Exits analytics section (honest coverage + plain-language)`.

---

### Task 9: gates + prod backfill dry-run

- [ ] Step 1 — Broker-less manual account: seed 3 manual trades (real-timestamp, date-only, no-favorable); run `run_backfill(user_id=…)` locally with real `bars_sqlite`/massive (or injected) → verify excursion rows + the trade page shows a real efficiency for the timed trade and "insufficient" for the date-only same-day trade. Zero-data account: analytics `exitQuality` absent/empty → section hidden or check-back copy, no crash.
- [ ] Step 2 — Full gates: `python -m pytest api/services/journal_two/ -q` (vs 20-baseline) · `cd app && npx vitest run src/pages/journal-2-0/ src/lib/journal-2-0/` · `npm run build` · `python -c "import api.main"` · `grep -c broker_sync api/main.py` ≥ 7.
- [ ] Step 3 — Commit any fixes.

### Task 10: whole-branch review + ship
- [ ] Whole-branch adversarial review (correctness: timestamp normalization + tier picker + coverage gate; data-safety: internal-bars-not-HTTP + no boot-time work + per-user isolation; UX: honest states + no emoji + mobile). Fix confirmed findings.
- [ ] Rebase onto origin/master, final gate, push `feat/journal-aplus-p2:master`.
- [ ] Post-deploy: set `EXCURSION_ENGINE_ENABLED=1` on Railway web (user action) → run `POST /api/j2/admin/excursion-backfill` → watch `/api/j2/admin/excursion-status`; verify a real trade shows exit-efficiency.

## Self-review notes
- Design corrections baked in: trade_ref keying (not external_id), Massive deep-intraday (not the yfinance ≤90d tiers), timestamp ms/seconds normalization as the #1 risk.
- Options excursions are the softest area — v1 keeps them separate + labeled, excluded from $ aggregates; acceptable per §5.
- Compute-on-view is optional/bounded; the nightly job + admin backfill is the reliable populate path.
