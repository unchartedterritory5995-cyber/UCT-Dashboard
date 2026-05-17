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

### Part 4 — Frontend post-mount revalidate — NOT NEEDED (resolved by investigation)
Reading the code showed this is already covered, on every path:
- First visit (no IDB) → no `since` → `_get_bars_inner` → Part 1
  synchronous fetch → correct.
- Returning visit (IDB cache) → `?since=` → `_get_bars_since_response`,
  which **already does a synchronous delta refresh** (`bars_fetch.py`
  ~938) — and Part 1's `_delta_intraday` pagination makes it complete
  for multi-day gaps.
- WS reconnect → `StockChart.onRealtimeReconnect` already gap-backfills
  via `?since=` (`StockChart.jsx` ~1441).
- The frontend already has a since/IDB SWR effect (`StockChart.jsx`
  ~815).
Adding another revalidation to the 1700-line chart component would be
redundant complexity with regression risk — contrary to the
simplification mandate. Deliberately NOT implemented.

### Part 5 — Freshness watchdog (SHIPPED, then refined)
`bars_continuous_audit._run_5min_check` (was an empty placeholder).
First cut sampled the whole stored universe — but the untouched long
tail staying frozen is the EXPECTED steady state (Part 1 heals on
access), so that was a permanently-red signal that would hide a real
regression. Refined to the **actionable** signal: sample the *hot-set*
(recently-viewed tickers via `get_hot_intraday_tickers`). If ≥20% of
ACTIVELY-VIEWED intraday charts are ≥1 session behind → critical, ≥8% →
warning (alert key `intraday_hotset_stale`). The whole-universe baseline
is still computed and logged for operator visibility but **never
alerts**. Meaning: the watchdog now fires only when the freshness
pipeline that serves real users is actually broken.

## Verification (live production, 2026-05-16)

- **Part 1:** two independent cold-probe runs on never-touched tickers —
  **72/72 fresh on the FIRST request, 0 stale** (12 tickers × 15/30/60m,
  twice). The exact screenshot scenario is fixed; the live "spike bar"
  is gone (live candle now sits on fresh history).
- **Part 2:** Pass-2 (same tickers, +6 min) **36/36 still fresh, 0
  regressed**; several deepened (ACHR 15m 1022→4068 bars) — merge adds
  freshness, never rolls back. `/api/health/cache` confirms web is
  merging recent snapshots (`snapshot_ts` ~today, `seconds_since_sync`
  ~11 min) → worker alive + periodic merge live.
- **Part 3:** bar-count growth between passes = hot-set prewarm working.
- **Part 5:** watchdog confirmed emitting in logs
  (`[continuous_audit] … freshness …`); refined to hot-set actionable
  signal + non-alerting universe baseline.
- **Operational:** one-time bulk universe intraday warm
  (`/api/admin/warm-universe?tfs=60,30,15`, 11,145 jobs) triggered to
  clear the residual May-8 long-tail freeze so cold opens are instant,
  not 2-4s. Runs autonomously; priority/viewed tickers heal first;
  unaffected charts already correct via Part 1.

## Net effect

The two-mechanism conflict (worker→R2 REPLACE vs on-demand delta WRITE)
is replaced by one rule — **newest bar wins per (ticker,tf,ts)** — applied
on every path: first visit (`_get_bars_inner` synchronous), returning
visit (`_get_bars_since_response` synchronous + paginated delta),
periodic R2 (newer-wins merge), prewarm (hot-set). A freeze can no longer
silently persist (watchdog). This is the simplification: fewer competing
paths, one invariant.
