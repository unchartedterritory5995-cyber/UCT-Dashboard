# Chart Accuracy & Real-Time Engine — Design

**Date:** 2026-05-08
**Status:** Draft (pending user review)
**Owner:** Patrick

---

## Mission

> All stocks, accurate open/high/low/close data for the 1m, 5m, 15m, 30m, 1hr, daily, weekly, and monthly timeframes. Fast and instant load time for all charts in all locations of the dashboard so any stock is one click away. Live tick-by-tick price quotes that fluctuate in real time. Bloomberg/TradingView-grade reliability — trust the data without thinking.

This is the most critical feature of the app. Every architectural decision in this spec serves that mission.

**Scope is non-negotiable.** This is the complete and final build of the chart layer:
- **Every stock** — full 3,685-ticker cap universe, not a curated subset.
- **Every timeframe** — all 8 (1m, 5m, 15m, 30m, 1hr, D, W, M), no exceptions.
- **Every chart surface** — every location in the dashboard where a chart renders (StockChart instances in TickerPopup, DrillModal, ThemeTrackerPage, Watchlists, CustomScan, Journal, UCT20, Screener, Earnings, Catalyst, Calendar, Breadth, OptionsFlow, DarkPool, LeadershipTile, NHNLModal — and any future surface inheriting from `StockChart`).
- **No partial deliveries.** No "we'll polish that later." Phase 5 is not optional.

---

## Problem Statement

The chart system has multiple concurrent failure modes that have eroded trust:

1. **Phantom corruption** — concrete example: QQQ 30min on 2026-05-07 11:00 ET shows OHLC = 6.55 with V = 56 (real QQQ was ~$700). Cascades into broken indicators (EMA9 dragged to 371, EMA20 to 522, SMA50 to 646).
2. **Mid-day data stops** — charts go flat mid-session; uncertain whether feed is dead or there are simply no trades.
3. **Partial 1-minute bars** — sessions return less than the expected ~390 RTH minutes; gaps appear randomly.
4. **Slow chart load** — switching tickers/timeframes feels sluggish; indicators paint late.
5. **Inaccurate live candle** — developing candle's high/low/close don't always match ticks visible elsewhere.

Combined, these mean the user can't trust what they're looking at. That is unacceptable for a trading dashboard.

---

## Non-Goals

- **Replacing the architecture wholesale.** Fix what we have; keep Lightweight Charts v5, Massive primary + FMP/Finnhub fallbacks, 3-layer cache, SSE fan-out.
- **New chart types or new indicators.** Out of scope. Tier-1 indicators (RSI/MACD/BB/etc.) are tracked separately in `MEMORY.md`.
- **Mobile chart redesign.** Existing responsive layout stays; mobile inherits all accuracy/speed improvements.

---

## Approach

**Symptom-First Hybrid (Option A).** Phased delivery from immediate stop-the-bleeding to long-term continuous verification, prioritizing fast visible improvement over methodologically pure audit-first.

```
Phase 0  Validation gates + cleanup        hours
Phase 1  Diagnostic audit engine            1 day
Phase 2  Root-cause fixes (known bugs)      3–5 days
Phase 3  Pipeline hardening                 2–3 days
Phase 4  Real-time candle engine            2–3 days
Phase 5  Speed + continuous verification    1–2 days
Phase 6  Continuous audit + alerts          (folded into Phase 5; ongoing)
```

---

## Architecture

### New modules

| Module | Purpose |
|---|---|
| `api/services/bar_validation.py` | Pure validation rules. `validate_bar(bar, prior_close) -> (ok, reasons)`. No I/O. |
| `api/services/bar_quarantine.py` | SQLite-backed quarantine table. Bars in quarantine are skipped on read → forces re-fetch. |
| `api/services/bars_audit.py` | Single-ticker + universe-wide audit runners. Generates reports. |
| `api/services/bars_continuous_audit.py` | Long-running background thread for ongoing verification. |
| `api/services/bar_provenance.py` | Tracks `source` and `validated_at` per bar (sidecar columns in `bars_sqlite`). |
| `api/services/bar_reconcile.py` | Async multi-source agreement checking. Resolves disagreements 2-of-3. |
| `api/services/bar_liveness.py` | Per-ticker stale-bar watchdog; force REST refresh during RTH if no updates >2min. |
| `api/services/realtime_candle.py` | Server-authoritative live candle state per (ticker, tf). Handles ticks, minute-close reconciliation, broadcasts. |
| `app/src/lib/realtimeCandle.js` | Frontend single global candle registry; charts subscribe rather than each owning state. |

### Modified modules

- `api/services/bars_disk_cache.py` — write path runs `validate_bar()` before persisting; read path skips quarantined entries.
- `api/services/bars_fetch.py` — provenance fields written; multi-source retry on validation failure.
- `api/services/realtime_stream.py` — adds heartbeat (15s ping, dead at 30s), per-ticker `last_seen` telemetry, structured event types (`tick` / `bar_close` / `bar_correction` / `stale`).
- `api/routers/stream.py` — emits the new SSE event types.
- `app/src/components/StockChart.jsx` — delegates candle state to `realtimeCandle.js` registry; reacts to `bar_correction` events; visible stale indicator.

### Data flow

**Write path (cache fill):**
```
Source (Massive | FMP | Finnhub | yfinance)
  → bar_validation.validate_bar()
      ├─ pass → bars_disk_cache.write() with provenance
      └─ fail → bar_quarantine.add() + retry next source
                  → if all sources fail: serve last-known-good with stale_flag
```

**Read path (chart load):**
```
Browser request /api/bars/{ticker}?tf=X
  → in-memory hot tier (top 500 tickers, <5ms)
  → SQLite disk cache (skip quarantined, <20ms)
  → fetch from source + validate + cache
  → return
```

**Real-time tick path:**
```
Finnhub WS tick
  → realtime_candle.py applies tick to authoritative candle
      (drops out-of-order, sanity-checks deviation)
  → SSE broadcast tick event (100ms fan-out)
  → frontend realtimeCandle.js updates registry
  → all subscribed StockChart instances re-render via series.update()

On minute close:
  → realtime_candle.py fetches Massive REST snapshot for that minute
  → reconciles vs WS-built candle (0.05% close, 5% volume tolerance)
  → broadcasts bar_close OR bar_correction
```

---

## Validation Rules (the trust contract)

Every bar must satisfy:

1. **Structural:** `H ≥ max(O, C, L)`, `L ≤ min(O, C, H)`, all values > 0, `V ≥ 0`.
2. **Sanity vs prior close:** reject if `|open - prior_close| / prior_close > 0.5` and no split-adjusted equivalent within 5%.
3. **Volume sanity:** reject if `V` is implausibly low (per-ticker baseline) and price moved ≥5%.
4. **Wide-bar gate:** reject if `(H - L) / C > 0.3` for liquid tickers (configurable).
5. **Series-level:** monotonic time, no duplicate timestamps, no gaps inside RTH for intraday TFs.

The QQQ 6.55 fixture violates #2 (open of 6.55 vs prior close ~$694, 99% deviation), #3 (V = 56 with implied price move >99%), and #4 (H-L spread). Becomes a regression fixture.

---

## Multi-Source Reconciliation

For high-priority tickers (UCT20, watchlists, candidates, theme taxonomy core tier):
- After a bar is fetched and validated, an async background task pulls the same bar from a second source.
- If they agree within tolerance (0.1% on price, ±5% on volume), bar is marked `verified`.
- If they disagree, log discrepancy, prefer the source that 2-of-3 sources agree with, quarantine the loser, alert if pattern emerges.
- **Three-way disagreement** (no majority): full quarantine of the bar, serve last-known-good with `stale_flag=true`, log as high-priority audit event for manual investigation.

For the long tail (full 3,685-ticker universe), reconciliation runs in the continuous audit pass — not blocking on first read.

---

## Self-Healing & Circuit Breakers

- **Self-healing:** quarantined bars trigger a fresh fetch from an alternate source on next access. Replaced bars overwrite quarantine entries. Source which produced the bad bar gets a count incremented.
- **Source circuit breaker:** if any source produces >5% bad bars in any 1-hour window, mark `degraded`; fail over to next source automatically. Resets after 1 hour of clean validation.
- **WS heartbeat:** 15s ping, declared dead at 30s silence on a normally-active ticker → auto-reconnect + REST gap-fill on minutes missed.

---

## Real-Time Candle Engine

**Server-authoritative state** — `realtime_candle.py` owns the live candle for every (ticker, tf) currently subscribed. Frontend trusts the server; this eliminates browser-side timezone/DST drift and per-tab divergence.

**Frontend registry** — `realtimeCandle.js` is a single `Map<sym, CandleState>` shared across all chart instances. If two charts (dashboard tile + drill modal) display the same ticker, both update from the same shared state.

**Tick rules:**
- `current_bar.close = tick.price`
- `high = max(high, tick.price)`, `low = min(low, tick.price)`
- `volume += tick.size`
- Out-of-order ticks (timestamp older than current) dropped.
- Tick sanity: reject if >5% deviation from last close in single tick (likely Finnhub anomaly).

**Minute-close reconciliation** — at every minute boundary, server fetches Massive REST snapshot. If REST disagrees with WS-built candle >0.05% close or >5% volume, REST wins; broadcast `bar_correction`; frontend replaces the bar in `series` via `update()`.

**SSE wire format:**
- `tick` — `{sym, price, ts, vol_delta}`
- `bar_close` — `{sym, tf, bar}` final OHLCV
- `bar_correction` — `{sym, tf, bar_time, corrected_bar}` server overrode WS bar
- `stale` — `{sym, last_seen}` triggers chart's amber pulse indicator

---

## Speed Targets

| Path | Target |
|---|---|
| Cache hit (warm ticker) server-side | <50ms |
| Cache hit first paint (browser) | <150ms |
| Cache miss end-to-end | <500ms |
| Chart switch (already-loaded ticker) | <16ms (one frame) |
| Tick → pixel | <200ms |

**Optimizations:**
- **In-memory hot tier**: top 500 tickers always in RAM, never touch disk. "Hot" defined as: union of UCT20, all user watchlists, candidates, theme taxonomy core tier, plus most-recently-viewed-per-user (LRU). Refreshed on wire push and on watchlist mutations.
- **Disk cache profile pass**: SQLite query plan check, add indexes, batch reads.
- **Chart instance pool**: confirm no `chart.remove()` paths remain on ticker switch (already mostly done).
- **Skeleton states**: chart frame renders immediately with last-known price line; bars paint as they arrive.
- **Aggressive prefetch**: hover (TickerPopup), watchlist render, theme expansion, adjacent rows in lists.

---

## Continuous Verification

**`bars_continuous_audit.py`** background thread:
- Every 5 min: spot-check 100 most-recently-fetched bars across all sources.
- Every 1 hour: full sweep of UCT20 + watchlists + candidates universe (~500 tickers × 8 TFs).
- Every 24 hours: full universe sweep (3,685 × 8 TFs).
- Findings auto-quarantine + trigger re-fetch.

**Per-ticker data quality score (0–100):**
Composite of:
- % bars passing validation (last 7d)
- Source-agreement rate
- Hours since last corruption detected
- Completeness vs expected bars-per-session
- Freshness during RTH

Stored in `bars_quality_score` table. Surfaced in admin dashboard. Optionally rendered as a small green/amber/red dot beside ticker in main UI.

**Admin chart-health dashboard** (`/admin/chart-health`):
- Universe-wide quality heatmap (tickers × timeframes, colored by score)
- Live source telemetry (WS connection status, REST poll cadence, error rate per provider)
- Per-ticker drill (last 100 audit events, current quarantine list, recent bar provenance)
- "Force re-audit" button per ticker
- Source health (pass-rate per provider, circuit breaker state)

**Alerts** (admin-panel only, no Discord spam):
- Source pass-rate <95% in 1hr window
- WS disconnect >60s
- New corruption pattern detected (rule violated >10 times in 1 hour) with bar samples

---

## Testing Strategy

- **Validation unit tests** — every rule has known-good and known-bad fixtures. The QQQ 6.55 bar lives in `tests/fixtures/bad_bars/`.
- **Tick replay harness** — feeds canned tick sequences (out-of-order, period boundaries, gaps); asserts candle state matches expected.
- **WS chaos test** — kill WS mid-session, verify reconnect + zero-gap recovery within 30s.
- **Two-chart sync test** — same ticker open in two charts, single tick updates both via shared registry.
- **Audit chaos test** — inject 10 corrupt bars into cache; assert all 10 are quarantined within 5 minutes.
- **Latency benchmark in CI** — load 50 random tickers; assert p95 cache hit <50ms.
- **Reconciliation tests** — synthetic source-disagreement scenarios; assert correct 2-of-3 winner selection.
- **Smoke audit on every deploy** — runs against curated 20-ticker fixture set; flagged but non-blocking.

---

## Success Criteria

The mission is delivered when:

1. **Coverage** — all 3,685 cap-universe tickers have validated, audited, fresh data in all 8 timeframes (1m, 5m, 15m, 30m, 1hr, D, W, M).
2. **Accuracy** — universe-wide validation pass rate ≥99.9%; data quality score ≥95 for UCT20 + watchlist tickers.
3. **Speed** — every latency target above is met at p95.
4. **Live feel** — tick-to-pixel <200ms; developing candle reconciles correctly with REST minute close >99% of the time; mid-day stops eliminated (no chart goes >2min stale during RTH without recovery).
5. **Trust** — admin chart-health dashboard exists; you can verify any ticker's status in <10 seconds. No corruption visible in casual use.

---

## Open Questions

- **Reconciliation cost:** Multi-source reconciliation for 500 priority tickers means ~500 extra API calls per refresh window. Acceptable given Massive + FMP + Finnhub quotas? Should be confirmed against current usage.
- **Quarantine sidecar table vs disk cache schema migration:** Sidecar is simpler (no migration); disk cache schema migration is cleaner long-term. Recommend sidecar to avoid migration risk; can fold in later if needed.
- **Data quality dot in main UI:** Show on every ticker by default, or admin-only? Recommend admin-only initially to avoid UI noise; expose to users as opt-in setting once stable.

---

## Phase Sequence (delivery order)

| # | Phase | Output | Time |
|---|---|---|---|
| 0 | Stop the bleeding | `bar_validation.py`, `bar_quarantine.py`, write-path validation, 6.55 purge, liveness probe | hours |
| 1 | Audit engine | `bars_audit.py`, `/admin/bars/audit/run`, baseline universe report | 1 day |
| 2 | Root-cause fixes | Fixes for 6.55 phantoms, mid-day stops, partial 1m bars (each diagnosed via Phase 1 telemetry) | 3–5 days |
| 3 | Pipeline hardening | Provenance, `bar_reconcile.py`, circuit breakers, self-healing | 2–3 days |
| 4 | Real-time engine | `realtime_candle.py` (server), `realtimeCandle.js` (frontend), reconciliation events | 2–3 days |
| 5 | Speed + verification | Hot tier, latency benchmarks, `bars_continuous_audit.py`, `/admin/chart-health` dashboard | 1–2 days |

Total: ~10–17 working days.
