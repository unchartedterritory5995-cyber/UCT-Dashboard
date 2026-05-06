# Phase 2: Async Bars Router + Multi-Worker — Design Spec

**Date:** 2026-05-05
**Author:** Claude (extending the strategic perf overhaul, after Phases 0/1/1.5/4 shipped)
**Status:** Design — awaiting implementation plan
**Spec reference:** `docs/superpowers/specs/2026-05-03-perf-overhaul-strategic-overview.md` Phase 2 (Workstream 2: Async Backend + Multi-Worker)

---

## 1. Goal

Eliminate FastAPI thread-pool saturation under load so backend p99 stays under 2s with 100 concurrent users (today saturates around ~10). Convert the bars hot path from sync handlers (which hold an anyio worker thread for 1–8s per cold-cache request) to native async (one coroutine per request, multiplexed on the event loop), then enable `--workers 2` on the web service for true CPU parallelism.

**Concrete acceptance criteria:**
- `GET /api/bars/{ticker}` cold-cache latency p95 ≤ current behavior (no regression behind flag-off)
- `GET /api/bars/{ticker}` p99 ≤ 2s under k6 load test of 100 concurrent users for 5 minutes
- Zero leaked event-loop blocking: `asyncio` debug mode in CI flags any `>100ms` block
- Sentry error rate within 2× baseline 24 hours after flag flip
- After stable: `--workers 2` enabled with no double-fired cron jobs (verified via Phase 1.5 lock)

---

## 2. Why Phase 2 is the Last Big Lever

After today's shipped phases:
- **Phase 0 + ErrorBoundary**: zero blank-screen failures
- **Phase 1 + corruption hardening (today)**: bars cache is reliable and self-healing
- **Phase 1.5 (today)**: cross-worker scheduler lock — multi-worker safe
- **Phase 4**: real-time bar streaming live

The remaining gap is **request handler concurrency under load**. Cold-cache `/api/bars/{ticker}` blocks an anyio worker thread for 1–8 seconds — yfinance, Massive, FMP fetch + SQLite write. With anyio thread pool tuned to 64 (already in `api/main.py:122`), 64 in-flight cold-cache requests saturate the pool. The 65th request queues until a thread frees up, adding the slowest-request latency to its own latency. Under sustained 100 concurrent cold loads, p99 grows unbounded.

Async handlers move concurrency from threads to coroutines. The event loop can multiplex thousands of in-flight HTTP requests provided the downstream calls are also async (or run in `asyncio.to_thread`). Combined with `--workers 2`, we get OS-level parallelism on top of in-process concurrency.

Phase 3 (web worker for indicators) is conditional — re-measure chart jank after Phase 0's SMA fix and only build it if jank persists. Most likely we never need Phase 3.

---

## 3. Architecture: Same Code, Async Wrapper Layer

The naive port — rewrite every `_fetch_*` and `_delta_*` to use `httpx.AsyncClient` — is days of refactor and risk. The pragmatic port keeps sync helpers (they work, they're tested, they're dozens of files) and wraps them in `asyncio.to_thread` calls from an async handler layer. This gives us the concurrency wins without the rewrite blast radius.

**Two-layer split:**

| Layer | Today (sync) | After Phase 2 (async) |
|---|---|---|
| HTTP handler in `api/routers/bars.py` | `def get_bars(...)` | `async def get_bars(...)` |
| Orchestrator `_get_bars_inner` in `api/services/bars_fetch.py` | sync function returning JSONResponse | new `async def _get_bars_inner_async(...)` that calls `await asyncio.wait_for(asyncio.to_thread(_get_bars_inner_sync, ...), timeout=8.0)` |
| Leaf fetch helpers (`_fetch_intraday_massive`, `_fetch_intraday_fmp`, `_fetch_intraday_yfinance`, `_delta_intraday`, `_fetch_daily`, etc.) | unchanged sync | unchanged sync |
| `bars_sqlite.put_bars` etc. | unchanged sync | unchanged sync |

The async handler hands work to a bounded `ThreadPoolExecutor` (so leaked yfinance threads can't grow unbounded), with `asyncio.wait_for` enforcing a per-request hard timeout. If the request times out, the coroutine returns an empty bars payload (matches current `except Exception` behavior at `bars_fetch.py:1203`); the leaked thread eventually finishes or dies.

This pattern is documented in the strategic overview (§4 Phase 2 step 5: "Use a dedicated `ThreadPoolExecutor(max_workers=8)` for yfinance to prevent leaking the default executor").

---

## 4. Why Not "Convert Everything to httpx.AsyncClient"

Considered and rejected for v1:

- **Massive client (`api/services/massive.py`)** is shared with sync callers (breadth_monitor, screener, earnings_enrichment, etc.). Converting `_get` to async forces every caller to await — cascading refactor across ~15 files. The strategic doc explicitly flags this: "with bars-local httpx.AsyncClient, NOT touching shared massive._http yet — other sync callers depend on it".
- **yfinance has no async API**. The library uses `requests` internally; we'd need to vendor + patch or wrap in `to_thread` regardless.
- **FMP client** is a thin function; converting could be future work but isn't blocking concurrency wins.

`asyncio.to_thread` has overhead (~50µs per call) but that's negligible compared to the hundreds-of-ms yfinance/Massive call times we're wrapping.

**Future migration path:** once v1 ships and we have load-test data, individual leaf functions can be ported to `httpx.AsyncClient` opportunistically. The async handler layer doesn't change.

---

## 5. Scope (What Ships in Phase 2)

### In scope

| File | Change | Effort |
|---|---|---|
| `api/services/bars_fetch_async.py` (new) | Async wrappers around the existing sync `_get_bars_inner`, `_get_bars_since_response`, etc. Bounded thread pool + per-call hard timeout. | Day 1 |
| `api/routers/bars.py` | New `async def get_bars_v2` handler gated by `BARS_ASYNC_ENABLED` env var. Sync `get_bars` stays as fallback. | Day 1 |
| `api/services/bars_fetch_async_test.py` (new) | Tests: timeout fires, empty result on timeout, normal completion path matches sync version | Day 1–2 |
| `tests/load/k6_bars.js` (new) | k6 script: 200 concurrent users for 5 min hammering `/api/bars/{ticker}` across a representative ticker mix | Day 2 |
| `railway.json` | Update `startCommand` to `--workers 2` (LAST step, only after async is stable for 24h) | Day 5 |

### Out of scope (separate future work)

- Full async port of `massive._get` and downstream sync callers
- Async port of yfinance helper (no async lib exists; would require vendoring)
- Conversion of admin endpoints (`/api/admin/warm-universe*`) — they're rare, no concurrency pressure
- Conversion of other routers (`/api/flow/*`, `/api/earnings/*`, etc.) — opportunistic later

---

## 6. Rollout Sequence

1. **Day 1 — implement + unit test** the async wrapper layer behind `BARS_ASYNC_ENABLED=0` (defaults off — no behavior change in prod).
2. **Day 2 — write k6 load script**, run locally against dev with flag on, verify no event-loop blocking via `PYTHONASYNCIODEBUG=1`.
3. **Day 3 — branch deploy to Railway preview** with flag on. Run k6 from local against preview URL. Capture p50/p95/p99.
4. **Day 4 — flip flag in prod**, observe Sentry + Cloudflare cache-hit ratio for 24h. Roll back if error rate >2× baseline.
5. **Day 5 — enable `--workers 2`** in `railway.json`. Phase 1.5 lock ensures scheduler still single-fires. Observe 24h.

---

## 7. Risks + Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Sync call leak inside async handler blocks event loop | High | All calls go through `asyncio.to_thread`; `PYTHONASYNCIODEBUG=1` in CI flags blocks; load test with loop-lag canary |
| Bounded thread pool too small → user latency spikes | Medium | Start at 8, increase to 16 if k6 shows queueing. Anyio's pool is separate (already 64); the bounded yfinance pool is in addition |
| Hard timeout too aggressive → false failures on legitimately-slow upstream | Medium | Default 8s (matches current effective ceiling); make configurable via `BARS_FETCH_TIMEOUT_SECONDS` env |
| `--workers 2` exposes hidden in-process global state assumptions | Medium | Audit before flipping (search for module-level mutable globals); the breadth_monitor / TTLCache / scheduler are the suspect surfaces |
| Phase 1.5 lock has bug → both workers run scheduler under `--workers 2` | Low | Tested via multi-process pytest (POSIX); manual verification on first multi-worker deploy |

---

## 8. Phase 2A: Today's Defensive Slice (ships before the async refactor)

Before the full Phase 2 lands, ship a smaller defensive change to bound yfinance latency spikes:

- New `api/services/yfinance_pool.py` module exposing `fetch_history(ticker, **kwargs, timeout=8.0)` that submits `yf.Ticker(...).history(...)` to a bounded `ThreadPoolExecutor(max_workers=8)` and `.result(timeout=8.0)`. Caller-perceived timeout enforced; leaked threads bounded.
- `api/services/bars_fetch.py` updated to call this instead of `yf.Ticker(...).history()` directly.
- Tests: timeout fires, normal path returns expected DataFrame.

This is ~1 hour of work, defends against the worst yfinance pathology (a single hung call holding an anyio thread for minutes), and is fully forward-compatible with the Phase 2 async wrapper (which would then call `await asyncio.to_thread(yfinance_pool.fetch_history, ...)`).

---

## 9. Open Questions (decide before implementation plan)

1. **Bounded pool size**: 8 is the strategic doc's suggestion. Empirically, what's the max concurrent yfinance calls we observe today? Check Sentry / Railway logs for clues. If we see bursts of 20+ concurrent fallbacks, 8 is too low.
2. **Hard timeout default**: 8s matches the strategic doc. But many cold-cache requests legitimately take 4–6s today. An 8s ceiling means the slowest 1% would fail under flag-on. Consider 12s as default; tune down once the async path is dominant.
3. **k6 ticker mix for load test**: should hit a representative blend of cached / cold / index / penny-stock tickers to expose real bottlenecks. Specify in the implementation plan.

---

## 10. Phases After Phase 2

- **Phase 3** (conditional): Web Worker for chart indicators. The strategic doc says skip if Phase 0's SMA O(n) fix eliminated jank. Need to re-measure on the deployed app — `PerformanceObserver.observe({type: 'longtask'})` for 30s of typical browsing. If 0 longtasks > 50ms, skip Phase 3 entirely.
- **Long-term Phase 1 follow-up**: migrate `bars.db` from SQLite-on-volume to Railway Postgres. Eliminates the snapshot-sync layer entirely and removes the corruption-recovery path we built today (which would no longer be needed). 3 days plus migration runbook. Defer until SQLite shows new pain.
- **Frontend Sentry**: add `@sentry/react` SDK so frontend errors surface (currently only api/main.py has Sentry). 1 hour, do it any time.
