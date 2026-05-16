# Bars Freshness Fix — Design (2026-05-16)

## Problem

Nearly all **intraday** charts (15m/30m/60m) were frozen at a uniform
**~May 8** date with a giant live-stream "spike bar" drawn on top.
Daily/Weekly were fine. User impact: dashboard's most critical function
(instant, accurate, real-time charts) effectively unusable.

## Root cause (proven, not theory)

Diagnosed against live production:

- `_debug_source` (bypasses cache) → Massive/FMP/yfinance **all fresh**
  through the latest close. Data providers are NOT the problem.
- 14/16 un-probed tickers were frozen at **exactly May 8**, all
  timeframes; re-hitting 12s later → all healed. The web service's
  `bars.db` is a **frozen snapshot**, healed only on-demand per
  `(ticker,tf)`, stale-first.

Mechanism — a chain of symptom-patches that each created the next:

1. **2026-05-07**: periodic R2 pull *replaced* the whole `bars.db` with
   the worker snapshot every 5 min, clobbering fresher local writes
   ("correct after refresh, reverts within 5 min"). → patch:
   `R2_PERIODIC_PULL_ENABLED` defaulted **OFF**.
2. Boot pull also overwrote fresher local data → patch: skip boot pull
   if local SQLite has ≥1000 bars.
3. Net of 1+2 with `USE_REMOTE_BARS=1`: web ingests **no** worker
   snapshot **and** runs no in-process prewarmer/seeder → universe
   frozen at last good state (~May 8).
4. `bars_prewarm.py` `_INTRADAY_TICKERS = ticker_list[:200]` → only 200
   of ~3,685 tickers ever get background intraday refresh anyway.
5. `_get_bars_inner` serves stale-while-revalidate on the **first**
   request; charts fetch once per mount, so they pin the stale paint and
   never pick up the background heal.

## Fix (5 parts) — the simplification is one coherent rule

**Locked principle:** newest bar wins per `(ticker, tf, ts)`; never
serve a multi-session-stale intraday first paint; never *replace* in a
way that regresses a fresher local row.

### Part 1 — Correct first paint (SHIPPED, verified live)
`bars_fetch._is_cold_stale_intraday(tf, last_ts)` +
`_expected_latest_session_yyyymmdd()` (weekend / pre-open aware). An
entry missing ≥1 whole trading session is "cold-stale" and the SWR guard
excludes it, so it falls through to Layer 4's existing de-duplicated
**synchronous** delta fetch → correct first paint. `_paginate_massive_aggs`
added; `_delta_intraday` now paginates `next_url` (both 60m and
1/5/15/30m), so multi-day/month gaps fully backfill in one call.
**Verified:** 36/36 cold first-hits fresh, 0 stale, on 12 un-probed
tickers × 15/30/60m.

### Part 2 — Newer-wins MERGE R2 sync (the "never again" core)
`data_sync.merge_snapshot(ts)`: extract snapshot, then
`ATTACH` + `INSERT OR IGNORE INTO ohlcv SELECT … WHERE l.mx IS NULL OR
s.ts > l.mx`. Adopts newer worker rows, pre-populates cold tickers,
**never overwrites a fresher local row** (kills the 2026-05-07
regression class). Periodic pull re-enabled on top of the merge instead
of the file-replace. Replaces the two-mechanism conflict with one rule.

### Part 3 — Usage-driven intraday hot-set (SHIPPED)
`bars_fetch._record_intraday_request` (bounded LRU, recorded in
`_get_bars_inner` + `_get_bars_since_response`) →
`get_hot_intraday_tickers()`. The prewarmer's refresh loop unions the
hot-set's intraday jobs each cycle, so charts the user actually flips
through stay pre-warm regardless of universe ordering.

### Part 4 — Frontend post-mount revalidate
`StockChart.jsx` schedules a short-delay `?since=<last_ts>` revalidation
and merges the returned gap (the `since` path is verified to return the
full gap). Residual staleness self-corrects within seconds, no reload.

### Part 5 — Universe freshness watchdog (SHIPPED)
`bars_continuous_audit._run_5min_check` (was an empty placeholder) now
samples ≤80 intraday entries, computes the cold-stale ratio, and
`chart_health_alerts.emit()`s warning (≥10%) / critical (≥30%). A
universe freeze now pages instead of lasting 8 days.

## Verification

- Part 1: live cold-probe — 36/36 fresh, 0 stale.
- Parts 3/5: unit tests + module import; post-deploy: `[prewarm] Hot-set`
  log line; `/api/admin/bars/alerts` shows no critical once healing.
- Part 2/4: merge unit tests (local-fresher kept / snapshot-newer applied
  / equal no-op); post-deploy universe-wide freshness re-probe.
