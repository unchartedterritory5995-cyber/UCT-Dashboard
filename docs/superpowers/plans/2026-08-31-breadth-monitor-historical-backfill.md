# Breadth Monitor — Historical Backfill / Deep-Time Navigation (research + plan)

**Date:** 2026-08-31 · **Status:** research complete, awaiting go-decision
**Trigger:** the Monitor's new Time Navigator calendar only reaches back to
2026-01-02. The owner wants to navigate the Monitor back "many years" (they know
some breadth data reaches ~2003) and view it **instantly** from any chosen date.

---

## TL;DR

- **The navigator is not the limit.** The date box added 2026-08-31 auto-extends
  its calendar + year list from the data's `min_date`/`max_date`. It stops at Jan
  2026 purely because the Monitor's source table (`breadth_snapshots`) has no
  earlier rows.
- **Most of the history already exists** — in a *different* store. Prod's
  `breadth_daily_ohlc` holds reconstructed close-basis bodies for the full ~40
  metric set back to ~2008 (this is what already powers the UCTA50-style breadth
  charts). The Monitor simply never reads it.
- **Recommended: a serve-time merge (Phase 1).** Teach the Monitor's read to
  assemble historical rows from `breadth_daily_ohlc` for pre-collector dates,
  exactly the way the breadth charts already do. This lights the Monitor up back
  to ~2008 **with no new backfill and no frontend change** — the navigator
  extends itself the moment `min_date` moves.
- **Two honest caveats to surface in the UI:** (1) *count* metrics reconstruct as
  approximations (coverage-scaled); *percentage* metrics are exact. (2) The
  sentiment block (AAII / NAAIM / CBOE put-call / CNN F&G) and `uct_exposure`
  **do not exist** before 2026 and would render as "—" on historical rows unless
  separately imported (Phase 3).

---

## 1. Current state — why the calendar stops at Jan 2026

- The Monitor tab reads `breadth_snapshots` via
  `api/services/breadth_monitor.py::get_history`. That table is written **only**
  by the daily 4:15pm ET collector push (`POST /api/breadth-monitor/push` →
  `store_snapshot`), which **began storing on 2026-01-02**
  (`breadth_history_recon.py:3`).
- The Time Navigator (`app/src/pages/breadth/BreadthDateNav.jsx`, shipped
  2026-08-31) builds its calendar bounds + year list from `min_date`/`max_date`
  returned by `GET /api/breadth-monitor`. **So the moment `get_history` can
  return earlier rows, the navigator reaches back on its own — no UI work.**

## 2. The two-store architecture (the key finding)

| Store | Table | Content | Reaches back to | Read by |
|---|---|---|---|---|
| **Monitor** | `breadth_snapshots` (`breadth_monitor.db`) | one JSON blob/day, all 55 collected metrics incl. sentiment | **2026-01-02** | `get_history` → Monitor tab |
| **Chart/OHLC** | `breadth_daily_ohlc` (`breadth_daily_ohlc.db`) | per-`(date,metric)` OHLC body, `source` tag | **~2008** (`close_recon`) | UCTA50/UCTNH pseudo-ticker charts |

The reconstruction engine (`breadth_history_recon.sweep_history`) **already
computes the full derived Monitor row** for any past date (via the exact live
method `breadth_live.compute_metrics` + `breadth_monitor.derive_live_row`) — but
it serializes those values **into `breadth_daily_ohlc` as per-metric close
bodies** (`source='close_recon'`), *not* into `breadth_snapshots`. The only writer
that touches the Monitor table is `apply_adv_dec_counts` (2 keys, identity-gated,
writes nothing from the bars recon: 0/96 sessions).

The breadth charts already reconcile the two stores at serve time:
`breadth_symbols._build_breadth_series` **unions** `breadth_daily_ohlc.history()`
with `breadth_monitor.get_history(6000)`, **collector wins on shared dates**. That
merge idiom is the template for lighting up the Monitor.

## 3. Metric classification (what can be reconstructed)

55 collected scalar metrics fall into three classes:

- **(a) Reconstructable from OHLCV (~40):** every `pct_above_*sma`/`ema`,
  `up/down_4pct`, `up/down_20pct_5d`, `up/down_25pct_qtr/month`,
  `up/down_50pct_month`, `magna_up/down`, `new_20d/52w_highs/lows`, `adv_decline`
  (+`advancing`/`declining`), `mcclellan_osc`, `stage2/4_count`,
  `spy/qqq_above_*sma`, `up_vol_ratio`, `universe_count`.
- **(a\*) Reconstructable given the index/ETF series (~4):** `sp500_close`
  (^GSPC), `vix` (^VIX), plus `qqq_close`/`spy_close` (ETF bars, already present).
  `new_ath` needs *full-depth* history and is explicitly refused by the bounded
  sweep (`_NEVER_SWEEP_STORE`).
- **(c) Derived on read (~10) — free once base rows exist:** `breadth_score`,
  `ratio_5day`/`ratio_10day`, `hi_ratio`/`lo_ratio`, `spy/qqq_day_pct`,
  `adv_decline_cum`, `is_ftd`, `avg_10d_cpc`. `get_history` computes these already.
- **(b) External, NOT reconstructable (~8):** `aaii_bulls/bears/neutral/spread`,
  `naaim`, `cboe_putcall`, `cnn_fear_greed`, `uct_exposure`. No bars source; never
  archived before 2026. `uct_exposure` is proprietary and simply did not exist
  pre-2026.

### Fidelity (measured, `breadth_history_recon.py:15-43`, meas. 2026-08-30)
- **Percentages (`pct_above_*`) are coverage-invariant → reconstruct exactly.**
- **Counts are coverage-scaled.** `bars.db` prices 0.3–22% fewer names than the
  collector's point-in-time universe on a given session, and the miss is
  distributed like the day, so every count returns ≈ `collector_value ×
  coverage` — directionally right, systematically understated. The `adv_decline`
  exact-integer identity reproduces 0/96 sessions from bars (median |diff| ~8);
  add the missing names back and it's exact on 64/114. So counts backfill as
  faithful *approximations*, not tick-exact numbers.

## 4. Data-source depth (how far back the inputs reach)

| Input | Reaches | Via | Gap |
|---|---|---|---|
| Live-universe daily OHLCV | ~2003 | Massive REST aggs / bars.db deep-history warm | thins pre-2004 |
| Delisted-inclusive whole-market daily | ~mid-2004 (some ~2003) | Massive grouped-daily + `active=false` reference (6,177 delisted, earliest `delisted_date` 2004-06-29) | pre-2004 delisted incomplete; pre-2003 = manual CSV only (6 seeded) |
| Point-in-time universe | ~2004 (degrading earlier) | `breadth_pit_universe.eligible` (type=CS, `active_on`, exchange allow-list, price ≥ $5, trailing $-vol ≥ $1M) | cap filter is **proxy-only** at all dates; best Jaccard vs collector ~0.76 (target 0.9) — level-negligible (≤1pt) for `pct_above_*` |
| Whole-market minute (intraday wicks) | ~2008 practical | Massive minute flat files (S3) | pre-2008 minute sweep not done |
| VIX / SPX / NDX closes | 1990 / 1927 / 1985 | `index_bars.py` (yfinance) — **currently caps daily pull at 5y** | just widen `PERIOD_MAP` |
| AAII / NAAIM / put-call / CNN F&G | **not stored** (forward-only from 2026-01-02) | Morning-Wire live fetch + 4:15 collector | must import externally |

**Earliest a *full* Monitor row (all sentiment present) could exist:** ~2012
(bound by CNN F&G) · drop F&G → ~2006 (NAAIM) · drop F&G+NAAIM → ~2003 (CBOE
equity put/call). AAII + VIX alone reach the 1980s–90s. *(Public-series start
dates are general knowledge, to verify with each provider before import.)*

## 5. Options

### Option A — Serve-time merge (RECOMMENDED)
Teach the Monitor read to assemble rows for pre-collector dates from
`breadth_daily_ohlc` close values (reusing the `_build_breadth_series` union;
collector wins for 2026+). **The data already exists in prod back to ~2008**, so
this lights the Monitor up immediately, with the navigator extending itself.
- **Pros:** small, reuses a proven merge, instant (no re-sweep), no frontend
  change, no data duplication.
- **Cons:** counts are coverage-scaled approximations; sentiment/exposure blank
  pre-2026; the existing sweep used *today's* (survivorship-biased) universe
  unless re-run (Phase 2).

### Option B — Backfill `breadth_snapshots` directly
Add a snapshot-writer to the sweep so reconstructed full rows land in the Monitor
table.
- **Pros:** single source of truth; can fold in imported sentiment + PIT-universe
  counts.
- **Cons:** heavier; duplicates the OHLC store; whole-market grouped-daily sweeps
  are expensive; still bounded by the same fidelity/universe caveats.

**Recommendation: A now, B only if a single canonical table is later required.**

## 6. Recommended phased plan

**Phase 0 — Verify prod coverage (½ day).** Hit
`GET /api/breadth-monitor/ohlc/status` (and `breadth_daily_ohlc.stats()`) on prod
to confirm how far `close_recon` actually reaches and which metrics are present
(the dev-box copy is empty; the depth is a prod/R2 artifact). This sets the real
`min_date` Phase 1 will expose.

**Phase 1 — Serve-time merge → instant deep Monitor (1–2 days).**
- Extend the Monitor read: for dates below the collector floor, build rows from
  `breadth_daily_ohlc` close-basis values, then run them through
  `derive_live_row` so the derived block is filled. Union with collector rows
  (collector wins on shared dates) — mirror `breadth_symbols._build_breadth_series`.
- Return the extended `min_date`; the navigator + calendar/year-list reach back
  automatically (no UI change).
- **UI honesty:** badge reconstructed dates (a muted "reconstructed" marker + a
  tooltip: "counts are model estimates; survey/exposure data unavailable before
  2026"). Sentiment/`uct_exposure` cells render "—".
- Keep `get_history`'s 5-min cache; deep windows are still a bounded `LIMIT`
  read, so "instant" holds. Watch the cumulative-A/D seed SUM over a much larger
  table (index on `date` already exists; measure).

**Phase 2 — Accuracy upgrade (optional, 3–5 days).**
- Re-run the deep sweep with the **survivorship-free PIT universe**
  (`breadth_pit_universe.eligible`) instead of today's-universe, and enable the
  **dividend basis** for long-window metrics — improves count fidelity and
  removes survivorship bias. Push coverage toward ~2003-2004.
- Widen `index_bars.py` daily `PERIOD_MAP` (or source historical index closes) so
  `sp500_close`/`vix` populate on historical rows.

**Phase 3 — Sentiment completeness (optional, higher effort).**
- Import historical AAII (1987+), NAAIM (2006+), CBOE equity put/call (2003+),
  CNN F&G (2011+) into the historical rows so pre-2026 sentiment shows where it
  exists. `uct_exposure` stays "—" pre-2026 (proprietary, never existed).

## 7. Open questions / decisions for the owner
1. **How far back is enough?** ~2008 is free (Phase 1). ~2003-2004 needs Phase 2.
   Pre-2003 needs manual delisted-CSV work — likely not worth it.
2. **Approximate counts acceptable?** Percentages are exact; counts are
   coverage-scaled estimates. Fine for context/regime reading; not for
   tick-exact history.
3. **Sentiment worth importing?** Decides whether historical rows are "breadth
   only" (Phase 1) or "full rows where the series exist" (Phase 3).
4. **A vs B** — serve-time merge vs a written backfill of `breadth_snapshots`.

## 8. Key files
`api/services/breadth_monitor.py` (store/read/derive) ·
`api/services/breadth_history_recon.py` (sweep + fidelity study) ·
`api/services/breadth_daily_ohlc.py` (chart store) ·
`api/services/breadth_live.py` (compute_metrics + `NOT_LIVE` list) ·
`api/services/breadth_pit_universe.py` + `breadth_pit_calibrate.py` (PIT universe) ·
`api/services/breadth_symbols.py` (`_build_breadth_series` merge idiom) ·
`api/services/breadth_ohlc_sync.py` (worker→web R2 transport) ·
`api/index_bars.py` (index closes) · `app/src/pages/breadth/BreadthDateNav.jsx`
(the navigator, already deep-time-ready).
