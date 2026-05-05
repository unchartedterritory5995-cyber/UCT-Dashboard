# Performance Baseline — uctintelligence.com

**Captured:** 2026-05-02
**Branch:** `master` @ `ba9e94e` (clean, in sync with origin)
**Stack:** FastAPI (Python 3.12, uvicorn) + Vite/React, single Railway web process (2 vCPU / 8 GB), Cloudflare proxy, SQLite on `/data` volume

This document is the "before" measurement. After Phase 3 fixes, we re-measure each row and record the delta to prove improvement.

---

## 1. Observed production symptoms (reported)

| Metric | Value | Source |
| --- | --- | --- |
| CPU under load | 100% (2.0 / 2.0 vCPU pegged) | Railway metrics |
| Memory idle baseline | ~1 GB | Railway metrics |
| Memory under load | ~2 GB | Railway metrics |
| Response time p50–p99 | 20+ seconds during spikes | Railway metrics |
| Error rate during spikes | 80–90% | Railway metrics |
| Ingress spike correlated with failures | ~20 MB | Railway metrics |
| User-visible failures | 502 from Cloudflare; blank `/breadth`, `/journal`; charts hang; multi-minute section loads | User report |

**Suspected origin of the 20 MB ingress spike:** CSV files served by the same FastAPI process (see §2.3). Confirmed below at the byte level.

---

## 2. Code-derived static measurements

### 2.1 Frontend bundle (production build at `app/dist/`)

Total built bundle: **21 MB**. Top chunks:

| File | Size |
| --- | --- |
| `vendor-echarts-*.js` | **1,137,559** (1.14 MB) |
| `vendor-recharts-*.js` | **415,965** (416 KB) |
| `JournalTwoRoot-*.js` | 251,981 |
| `Breadth-*.js` | 237,968 |
| `index-*.js` | 216,800 |
| `OptionsFlow-*.js` | 192,673 |
| `vendor-charts-*.js` | 176,776 |
| `JournalPage-*.js` | 160,913 |
| `JournalPage-*.css` | 117,928 |
| `LiveFlow-*.js` | 115,864 |
| `JournalTwoRoot-*.css` | 87,795 |

**Note:** the bundle ships **three chart libraries** — `echarts`, `recharts`, and a separate `vendor-charts` chunk — totalling **~1.7 MB** before gzip. Only one charting library is needed at any given page, so most of this is wasted shipping.

### 2.2 Single-file React component sizes

| File | LOC |
| --- | --- |
| `app/src/pages/OptionsFlow.jsx` | **4,740** |
| `app/src/pages/DarkPool.jsx` | (fetches 19.43 MB CSV on mount; size not directly measured) |
| `app/src/pages/Breadth.jsx` | (referenced by recent `Make all drill-list charts load instantly` commit) |

A 4,740-line single-component file is a render and bundle hazard on its own; combined with the recent collaborator commit pattern (`Update OptionsFlow.jsx` x6 via GitHub web editor + `Add files via upload` x3) it is a high-risk hot spot.

### 2.3 Static data files served from the FastAPI process

| Path | Size | Served by |
| --- | --- | --- |
| `app/public/flow-data.csv` | **19,866,637** (19.86 MB) | `serve_csv` at [api/main.py:747](api/main.py#L747) |
| `app/public/Darkpool-data.csv` | **19,439,185** (19.43 MB) | `serve_darkpool_csv` at [api/main.py:754](api/main.py#L754) |
| `app/public/Indexes-data.csv` | 1,503,667 (1.50 MB) | static mount |
| `themes_taxonomy.json` (root) | 398,563 (398 KB) | parsed in startup |
| `api/data/cap_universe.json` | 27,844 (3,715 tickers) | loaded by prewarmer if enabled |

**Frontend fetch sites for the heavy CSVs:**
- `app/src/pages/DarkPool.jsx:1237` — `fetch("/Darkpool-data.csv")` on mount
- `app/src/pages/OptionsFlow.jsx:1138` — `csvFile = dataMode === "index" ? "/Indexes-data.csv" : "/flow-data.csv"` on mount
- `app/src/pages/LiveFlow.jsx` — same `/flow-data.csv` (per file header comment)

**Observation:** every visit to `/options-flow` or `/dark-pool` ships ~20 MB of CSV from origin through Cloudflare. **Magnitude exactly matches the 20 MB ingress-correlated failure spike.**

### 2.4 Backend code volume

| Area | Files | LOC |
| --- | --- | --- |
| `api/routers/` | 32 | 7,043 |
| `api/services/` | 47 | 14,046 |
| `api/main.py` | 1 | 760 |
| Standalone routers in `api/` (`gex_router.py`, `top_flow_router.py`, `schwab_router.py`, `watchlist_router.py`, `earnings_router.py` and trackers) | 6 | ~2,200 |
| **Total backend** | **~80 files** | **~24,000 LOC** |

Heaviest single files (potential hot paths):
- `api/services/engine.py` — 2,112 LOC
- `api/routers/bars.py` — 1,265 LOC
- `api/services/auth_service.py` — 1,221 LOC
- `api/routers/auth.py` — 1,088 LOC
- `api/routers/journal_two.py` — 897 LOC
- `api/services/journal_service.py` — 768 LOC
- `api/routers/calendar.py` — 786 LOC
- `api/routers/journal.py` — 641 LOC
- `api/services/news_aggregator.py` — 666 LOC
- `api/services/massive.py` — 632 LOC

Total **31 routers** registered in `app.include_router(...)` calls at [api/main.py:708-742](api/main.py#L708).

### 2.5 Startup work (synchronous before traffic)

In order, inside the FastAPI `lifespan` ([api/main.py:98-676](api/main.py#L98)):

1. anyio thread-pool tokens raised from default ~5 to **64** (already a known thread-starvation workaround) — [api/main.py:104-108](api/main.py#L104)
2. Auth DB init
3. SQLite bar store init
4. **Synchronous in-memory bar pre-warm**: 62 Tier 1 tickers × 6 timeframes (D, W, 5, 15, 30, 60) + every breadth drill-list ticker × 2 timeframes (D, W). Bars loaded into TTLCache with up to 8000 entries each — [api/main.py:130-179](api/main.py#L130)
5. Background bar-seeder thread started
6. `/data/wire_data.json` loaded into TTLCache with 23-hour TTL
7. **`_prewarm_bars` background thread** (gated by `BARS_PREWARM_ENABLED=1`): loads `cap_universe.json` (3,715 tickers) + every theme ETF + every theme holding + watchlist tickers + ticker_tags + wire_data candidates → builds Daily/Weekly/Monthly job list for the union, plus intraday for top 200, then **enters a permanent 5-minute refresh loop forever** with `ThreadPoolExecutor(max_workers=2)` — [api/main.py:197-426](api/main.py#L197)
8. `_build_deep_cache` thread (gated by `DEEP_CACHE_ENABLED=1`)
9. **Theme DB seed** (synchronous) — parses 398 KB JSON
10. `theme_performance.load_persisted_on_startup()` (synchronous)
11. **Realtime WebSocket stream** opened to Massive/Polygon — [api/main.py:483-487](api/main.py#L483)
12. `daily_tracker.start_snapshot_scheduler()`
13. `top_flow_tracker.init() + archive_expired()`
14. `watchlist_tracker.init()`
15. COT service init + possible background seed/catchup
16. `BackgroundScheduler` registers **8 cron jobs** (COT × 4, session cleanup, churn risk, MRR snapshot, watchlist daily/weekly digests, nightly bar refresh) — [api/main.py:530-668](api/main.py#L530)
17. `record_mrr_snapshot()` runs synchronously on startup

Health-check timeout in `railway.json` is **600 seconds** — already telling us startup is slow.

### 2.6 In-process cache primitive

`api/services/cache.py` defines a single global `TTLCache` ([cache.py:1-37](api/services/cache.py)):

| Property | Value |
| --- | --- |
| Implementation | `OrderedDict` with manual TTL + LRU eviction |
| Max entries | **500** ([cache.py:5](api/services/cache.py#L5)) |
| Thread safety | **None** — `move_to_end`, `popitem`, dict mutation all unprotected |
| Shared by | bar series, wire_data, screener results, anything that calls `cache.set` |

**Problem at the count level:** Tier 1 bars alone consume 62 × 6 = 372 entries before any user traffic. With the full prewarmer enabled, the same cache becomes a target for thousands of bar entries — eviction churn will trash hot keys constantly.

**Problem at the concurrency level:** the prewarmer thread and N request handler threads call `cache.get`/`cache.set` simultaneously with no lock; under concurrent mutation `OrderedDict` raises `RuntimeError: dictionary changed size during iteration` and `KeyError` (these will surface in Sentry — see §4).

### 2.7 `/api/bars` hot path (chart endpoint)

Per [api/routers/bars.py:1-18](api/routers/bars.py) docstring, the cache hierarchy is:

| Layer | Stated latency |
| --- | --- |
| In-memory TTLCache | < 1 ms |
| SQLite bar store | < 5 ms |
| Disk cache | < 20 ms |
| Massive API delta fetch | < 1 s |
| **Massive API full fetch** | **4–8 s** |

The router has in-flight deduplication ([bars.py:32-37](api/routers/bars.py#L32)) — good. But intraday cache TTLs are 5–10 s ([bars.py:102](api/routers/bars.py#L102)), which means the cache layer offers little protection during sustained intraday browsing.

### 2.8 Local-only artifacts (NOT in git)

- `api/data/bars_cache_deep.tar.gz` — **337 MB**. Local dev artifact only (`.gitignore` excludes the directory; `git ls-files api/data/` confirms only `cap_universe.json` is tracked). Mentioned to rule out as a Railway issue.

---

## 3. Production-runtime measurements I do NOT yet have

These need either a local reproduction (not feasible here — see preamble) or deployed instrumentation (not authorised to deploy in Phase 1):

- Per-endpoint p50 / p95 / p99 response times
- Per-endpoint payload size (request and response)
- Per-endpoint outbound API call counts and durations (Massive, Anthropic, Schwab, yfinance, etc.)
- SQLite query counts and per-query timings under real load
- WebSocket message rate and buffer depth
- APScheduler job durations (especially `_nightly_bar_refresh` and the in-process `_prewarm_bars` refresh loop)
- Memory growth over time (leak vs. heavy-but-stable)
- TTLCache hit/miss rate
- Cloudflare cache hit rate for static assets

**To capture these in Phase 2 / 3, I need one of:**
1. Authorisation to deploy a tagged instrumentation commit (e.g. `[perf-instrument]`-prefixed log lines wrapping every router and every external call), OR
2. Sentry access — we already have `sentry_sdk.init(traces_sample_rate=0.1)` at [api/main.py:60-65](api/main.py#L60), which means the Performance / Tracing tab already has some of these numbers, OR
3. Railway log export for the last 24h (the existing `[startup]`, `[prewarm]`, `[scheduler]` print lines already give startup duration and prewarmer progress).

---

## 4. Suspect-but-unconfirmed signals already visible in code

These will be turned into ranked findings in Phase 2.

- 20 MB CSV downloads on every OptionsFlow / DarkPool / LiveFlow page mount → ingress spike
- Permanent 5-min prewarmer refresh loop competing with web requests for CPU + Massive upstream
- Single non-thread-safe TTLCache shared by background threads and request threads
- Heavy synchronous startup parsing (themes_taxonomy.json) before health-check is satisfied
- 3 chart libraries shipped in one bundle
- 4,740-line `OptionsFlow.jsx` with recent web-editor commit churn
- `/api/bars` "first fetch 4–8 s" path with only 5–10 s intraday TTL → cache offers little protection during fast browsing
- 8 in-process APScheduler crons in the same uvicorn process serving traffic
- 31 routers + WebSocket client + scheduler all sharing a single 2 vCPU container

---

## 5. Targets for "after" measurement (Phase 3)

For each fix landed, we re-record the relevant row(s):

- 20 MB CSV ingress per page mount → target near zero (cache headers, server-side filter, or lazy load)
- Frontend initial bundle size → target -50 % via dropping duplicate chart libraries and code-splitting OptionsFlow
- Idle memory after startup → target < 600 MB (current ~1 GB)
- p99 response time during traffic burst → target < 5 s (current 20+ s)
- Error rate during traffic burst → target < 1 % (current 80–90 %)
- Cache thread-safety → target zero `RuntimeError: dictionary changed size` in Sentry over 7 d

---

## Methodology note

Phase 1 was completed with **static analysis only** — no app code changes, no production deploys, no local app start-up. Local reproduction of the production failure pattern is not viable from this Windows workstation (no `/data` volume, missing API keys, load shape requires real traffic). All numbers above are either user-reported production metrics or byte-level / line-level / count-level facts derived from the repo at `ba9e94e`.

Phase 2 (next) will fan out across the six tracks listed in the work plan, file evidence-rich findings, and rank them. Phase 3 (after approval) will fix in confirmed-first order with re-measurement after each fix.
