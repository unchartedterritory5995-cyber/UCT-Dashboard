# Performance & Reliability Overhaul — Strategic Overview

**Date:** 2026-05-03
**Author:** Claude (synthesized from 5 parallel deep-dive analyses)
**Status:** Strategic overview — awaiting approval before per-spec design docs
**Companion analyses:** 5 sub-spec deep-dives (Async, Web Worker, Prewarmer Extraction, WebSocket Bars, CDN+ErrorBoundary) summarized below; full text of each available on request.

> **Phase 1 post-incident note (2026-05-04):** the in-process gate on web is
> `USE_REMOTE_BARS=1`, not `WORKER_ENABLED=1` as written in §4 below.
> `WORKER_ENABLED` is reserved for `railway.json`'s `startCommand` conditional
> (worker service only). See `api/main.py:207-215` for the rationale.

---

## 1. Goal

Make the UCT Intelligence app feel as fast as TradingView for any logged-in user with warm caches, and make it stable for 10–100 concurrent users (with architecture that extends to 1,000+ without rewrites).

**Concrete success criteria:**
- Cold-load latency (first-time chart for any ticker): <1s p95 (currently 1–4s, up to 8s for indices)
- TF switches on a viewed ticker: <100ms p95 (currently instant via IDB — preserve this)
- Backend p99 under 100 concurrent users: <2s (currently saturates above ~10 concurrent)
- Zero blank-screen failures from uncaught render errors (currently every render bug = blank page)
- Hourly chart history: full Polygon-supported window (~2 years for 30/60min) — DONE this session
- Real-time bar updates without REST polling — feels live like Bloomberg/TradingView

---

## 2. The Five Workstreams

| # | Workstream | Effort (MVP) | Effort (Full) | Risk | Quick-win? |
|---|---|---|---|---|---|
| 0 | **CDN cache + ErrorBoundary + SMA algorithm fix** | 3h | 1d | Low | ✅ Yes |
| 1 | **Prewarmer extraction to its own Railway service** | 2d | 3d | Medium | ❌ Foundation |
| 2 | **Async backend (`/api/bars` first) + multi-worker** | 5d | 5d | Medium-High | ❌ Foundation |
| 3 | **Web Worker for chart indicators** | 3h | 1.5d | Low | ✅ After SMA fix |
| 4 | **WebSocket bar streaming** | 2d | 5d | Medium | ❌ Polish |

**Total:** ~17 days of focused engineering work, three weeks calendar time with testing and observation buffers.

---

## 3. Cross-Cutting Findings (the dependencies that matter)

These were discovered by the parallel agents and reshape the order of work:

### Finding A: Prewarmer extraction is a hard prerequisite for multi-worker

The same Python process currently owns the web handlers, APScheduler (10 cron jobs — perf doc said 8 — see analysis #3), Finnhub WebSocket, and the prewarmer. Running `--workers 2` today would duplicate every cron job (10 → 20 fires), open 2 Finnhub WS connections (free-tier limit collision), and double-prewarm.

**Implication:** Workstream 1 (extraction) MUST land before Workstream 2 (multi-worker) can safely roll out. The async refactor can ship without multi-worker, but the bigger throughput unlock requires both.

### Finding B: Railway volumes cannot be shared between services

This was confirmed by direct Railway docs check. We cannot just mount `/data` to both web and worker. Two viable architectures:

- **MVP (recommended):** worker writes to its own `/data`, syncs to S3 every 5 min; web pulls from S3 on a background thread. Adds ~30–60s to web cold-start (downloading initial snapshot), eliminates contention.
- **Long-term:** Migrate `bars.db` to Railway-managed Postgres. Both services connect. Eliminates S3 sync. Bigger refactor (~3 days extra).

S3 is the day-one answer; Postgres is a Phase-3 follow-up after MVP proves stable.

### Finding C: The chart "jank" might not need a Web Worker

The Web Worker analysis (Workstream 3) audited the chart's compute and found:
- `computeEMA` / `computeHVC` are already O(n) — fast (~1ms for 8000 bars)
- `computeSMA` is **O(n × period)** with a naive nested loop — SMA200 on 8000 bars ≈ 1.6M ops, dominates the cost
- The 30-minute fix is to convert SMA to a rolling-window O(n) algorithm. **That alone may eliminate jank** without any worker.

**Implication:** Ship the SMA algorithm fix in Phase 0 (today). Re-measure. Only build the Web Worker if jank persists after that.

### Finding D: Polygon/Massive supports WebSocket bar aggregates natively

Confirmed via Massive/Polygon docs: `wss://socket.polygon.io/stocks` provides `AM` (1-minute aggregates) and `A` (per-second aggregates) channels. We don't need to invent server-side aggregation from Finnhub trades — the data is there, properly aggregated, matching what we already get from REST.

**Implication:** Workstream 4 design becomes much cleaner — extend SSE protocol with typed bar events, broadcast 1-min bars from Massive, server-side roll up to 5/15/30/60-min. Avoids the entire class of "stream-vs-REST drift" bugs (which already bit us once with volume).

**Cost gate:** May require Polygon Stocks Advanced (~$200/mo) — verify current Massive plan before committing.

### Finding E: Frontend has no Sentry

Perf doc said Sentry covered both ends. It doesn't — only `api/main.py:60-65` has Sentry. The frontend has no `@sentry/react` SDK. ErrorBoundary needs to be designed knowing crashes only surface in user reports until we add Sentry React (separate small task).

### Finding F: Two stale references in perf-investigation.md

- CSV handlers cited as `api/main.py:747-758`; actual location is `api/main.py:670-689`. Three handlers, not two (Indexes-data.csv is the third sibling).
- 8 cron jobs cited; actual count is 10.

These don't change conclusions — flagging so the per-spec writing has accurate references.

---

## 4. Recommended Ordered Roadmap

### Phase 0 — Quick Wins (Day 1, ~3 hours)

**Ship today, no spec needed beyond brief PR descriptions:**

1. **`<ErrorBoundary>` wrapping the routed `<Suspense>` in `App.jsx:62`** — eliminates blank-screen failures forever. Key the boundary by `useLocation().pathname` so it resets on route change.
2. **`Cache-Control: public, max-age=300, stale-while-revalidate=86400`** on the 5 CSV/flow endpoints (`api/main.py:670-689`, `api/flow_router.py:66, 97`). Verify gzip is also being applied via curl.
3. **Convert `computeSMA` to rolling-window O(n)** in `app/src/components/StockChart.jsx:35`. Re-measure jank.

**Acceptance:** Three commits, deployed to prod, verified within 24 hours via Cloudflare cache-hit ratio + manual blank-screen check + `PerformanceObserver` longtask reduction.

### Phase 1 — Foundation: Prewarmer Extraction (Week 1, ~3 days)

Per Workstream 1 analysis, MVP cut:

1. Refactor `_get_bars_inner` + `_needs_fresh` from `api/routers/bars.py` into `api/services/bars_fetch.py` (so the worker doesn't import a router module)
2. Create `api/worker_main.py` — minimal FastAPI app for healthcheck + threading.Thread targets running prewarmer body + bars seeder
3. New Railway service `worker`, separate `/data` volume
4. S3 sync: worker tarballs `/data/bars.db` + `bars_cache/` every 5min, uploads; web downloads delta on a background thread
5. New `/api/health/cache` endpoint on web showing `seconds_since_last_prewarm`
6. Behind feature flag `WORKER_ENABLED=1` on web, defaults off until verified

**Phase 1.5 (later, +3h):** Move APScheduler to worker. Required before Phase 2 multi-worker. Set up Railway Cron Jobs as belt-and-suspenders backup for time-critical jobs (COT Friday refresh, MRR snapshot).

**Acceptance:** Web CPU graph drops materially, `/api/health/cache` shows fresh data, manual chart load on cold ticker hits cache (<200ms).

### Phase 2 — Async Backend + Multi-Worker (Week 2, ~5 days)

Per Workstream 2 analysis, file-by-file conversion of `api/routers/bars.py`:

1. Spike: convert `_fetch_intraday_yfinance` and Massive `_get` to async (with bars-local `httpx.AsyncClient`, NOT touching shared `massive._http` yet — other sync callers depend on it)
2. Port all `_delta_*` and `_fetch_*` helpers
3. Port `_get_bars_inner` and `_get_bars_since_response` (replace `threading.Event/Lock` with `asyncio.Event/Lock`; replace `threading.Thread` for SWR with `asyncio.create_task`)
4. Port `get_bars` and `debug_source` handlers, behind `BARS_ASYNC_ENABLED` env flag
5. Add hard timeouts to all yfinance + Anthropic call sites via `asyncio.wait_for(asyncio.to_thread(...), timeout=8.0)`. Use a dedicated `ThreadPoolExecutor(max_workers=8)` for yfinance to prevent leaking the default executor.
6. Branch deploy to Railway preview, load test with k6 (200 concurrent users for 5min)
7. Flag flip in prod, 24h Sentry watch
8. After stable: switch web to `--workers 2` (only after Phase 1.5 APScheduler extraction)

**Acceptance:** Backend p99 < 2s under 100 concurrent users (load tested). No event-loop sync-call leaks (verified via `asyncio` debug mode in CI). Sentry error rate within 2× baseline post-deploy.

### Phase 3 — Web Worker for Indicators (Week 3, ~3h–1.5d)

**Decide AFTER Phase 0:** if SMA algorithm fix eliminated jank, this becomes optional polish. If jank persists, ship the worker.

If shipping:

1. Create `app/src/components/chart/indicatorWorker.js` via Vite `?worker` import
2. Pack bars as `Float64Array`, transfer ownership via Transferable to avoid copy
3. Threshold: only delegate to worker if `bars.length >= 1000` (small datasets stay inline; worker round-trip dwarfs compute below the threshold)
4. Replace `useMemo` for `overlayData`/`hvcSet` with `useEffect`+state, with stale-result handling via monotonic id correlation
5. Localstorage feature flag `uct-chart-worker` for instant rollback

**Acceptance:** Zero >50ms longtasks during chart render (measured via `PerformanceObserver`).

### Phase 4 — WebSocket Bar Streaming (Week 4, ~5 days)

Per Workstream 4 analysis, full v1:

1. New `api/services/bar_stream.py` — second WebSocket client to Polygon/Massive `wss://socket.polygon.io/stocks`, subscribe to `AM.*` for active universe
2. `BarBroadcaster` class — maintains per-`(sym,tf)` deques and broadcasts to subscribed SSE clients
3. Server-side roll-up worker: when 5/15/30/60-min boundary closes, aggregate 1-min bars and emit
4. Extend `api/routers/stream.py` with `event: bar` typed events + `bars=AAPL:5,MSFT:1` query param
5. Client `app/src/hooks/useRealtimeBars.js` + wire into `StockChart.jsx`
6. Gap-backfill on EventSource reconnect — fire one `/api/bars/{ticker}?since=<lastBarT>` REST call to fill the gap
7. Feature flag `VITE_REALTIME_BARS` + `STREAM_BARS_ENABLED` for instant rollback

**Acceptance:** Chart bars update without REST poll on actively-viewed timeframe. Gap-backfill works after a 30s WS blip.

---

## 5. Testing & Iteration Loop (How We Maintain Quality)

For each phase:

**Pre-deploy (per spec):**
- Unit tests covering happy path + 3-5 edge cases per file changed
- Snapshot regression: capture current API responses for 5 representative tickers; assert byte-equal after change
- Load test for backend changes (k6 or locust): scripted concurrent-user simulation
- Manual chart QA: open 5 tickers across normal/index/penny-stock categories, switch all 8 timeframes, verify no jank

**Post-deploy verification (24h watch per phase):**
- Sentry error rate must stay within 2× baseline; spike → automatic rollback
- Cloudflare cache-hit ratio target by phase: Phase 0 = >90% on cached endpoints
- Healthcheck SLI: `/api/health` returning 200 with correct payload, `/api/health/cache` (post-Phase 1) showing fresh data
- Browser-side: `PerformanceObserver` longtask count + p95 chart load time tracked across releases

**Iteration cadence:**
- Each phase ships behind a feature flag, defaults off
- 24-hour observation window before flipping flag default to on
- 48-hour bake before removing the legacy code path
- All commits use the existing pattern: branch + PR + Railway preview + manual smoke + flip in prod

---

## 6. Risk Register

| Risk | Workstream | Severity | Mitigation |
|---|---|---|---|
| Async sync-call leak (one missed `httpx.Client` blocks event loop) | 2 | High | `asyncio` debug mode in CI; `flake8-async` lint; load test with loop-lag canary |
| S3 sync lag making web serve stale data | 1 | Medium | `/api/health/cache` endpoint + Sentry alert if `seconds_since_last_prewarm > 1800` |
| Polygon plan doesn't include WS aggregates | 4 | Medium (cost) | Verify before committing; fallback is to aggregate Finnhub trades server-side (separate design path) |
| Multi-worker breaks something subtle (in-process state, file locks) | 2 | Medium | `--workers 2` is the LAST step of Phase 2, after async migration is stable; all tested in branch deploy first |
| ErrorBoundary masks real bugs (no Sentry to catch them) | 0 | Low (fixable) | Ship `console.error` now; add `@sentry/react` as a Phase 0.5 follow-up (~1h) |
| Web Worker overhead exceeds compute savings on small datasets | 3 | Low | Threshold at `bars.length >= 1000`; small datasets stay inline |
| Deploy ordering issues (worker before web ready, or vice versa) | 1 | Low | Both services boot independently; web's fallback path serves correctly with stale/missing prewarm data |

---

## 7. What's Explicitly OUT of Scope

- Migration of remaining 232 sync handlers (only `bars.py` in Phase 2; rest can convert opportunistically over months)
- Frontend `@sentry/react` SDK installation (small follow-up after Phase 0)
- `TTLCache` thread-safety fix (perf-investigation #6 — separate spec)
- SQLite WAL on `auth.db`/`cot.db`/`breadth_monitor.db` (perf-investigation #4 — quick spec)
- Bundle dedup (drop one of 3 chart libraries — perf-investigation #4 — separate spec)
- OptionsFlow refactor from 4,740 LOC monolith (perf-investigation #1 + #5 — separate spec)
- Hourly chart history beyond Polygon's tier limits (separate data-source evaluation)
- Move to Postgres for `bars.db` (Phase 1 long-term; deferred to after MVP stability)

---

## 8. Total Commitment Summary

**Calendar time:** 3–4 weeks with proper testing and observation windows
**Engineering effort:** ~17 days focused work
**Risk profile:** Manageable — every phase has feature flags and reversible deploys
**Expected outcome:** App feels TradingView-fast for warm users, handles 100+ concurrent users without queuing, eliminates blank-screen failures, real-time bar updates

**This is the biggest leverage we'll get without going to institutional-grade infra (Bloomberg/TC2000 tier — co-located feeds, dedicated CDN POPs, paid market-data tiers ~$2k+/mo).**

---

## 9. Next Step

If approved: each of the 5 workstreams gets its own design spec, in this order (matching dependencies):

1. `2026-05-03-phase-0-quick-wins-design.md` (CDN + ErrorBoundary + SMA fix combined)
2. `2026-05-03-prewarmer-extraction-design.md`
3. `2026-05-03-async-bars-router-design.md`
4. `2026-05-03-chart-indicator-worker-design.md` (conditional on Phase 0 results)
5. `2026-05-03-websocket-bar-streaming-design.md`

Each spec gets its own implementation plan via `superpowers:writing-plans`, executed via `superpowers:executing-plans` with review checkpoints.

Awaiting your review before writing the first spec.
