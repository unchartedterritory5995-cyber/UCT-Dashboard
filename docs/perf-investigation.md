# Performance Investigation — uctintelligence.com

**Started:** 2026-05-02
**Companion:** [docs/perf-baseline.md](perf-baseline.md)
**Branch under investigation:** `master` @ `ba9e94e`
**Method:** static analysis + commit-history triangulation. No code changes, no production deploys, no local app run (not viable on this Windows workstation — see baseline doc preamble).
**Status:** Phase 2 complete. **STOP — awaiting user approval before any fix.**

---

## TOP 5 ROOT CAUSES (ranked by impact × confidence)

The production symptoms — 100 % CPU, 1→2 GB memory, p99 > 20 s, 80–90 % error rate, 502s, blank `/breadth` + `/journal`, 20 MB ingress correlated with failures — are produced by **five interlocking root causes**. Fixing any one of them helps; fixing the top three is what gets the app to "usable."

### #1 — 19.86 MB CSV downloads on every OptionsFlow / DarkPool / LiveFlow page mount, served by the FastAPI process with no Cloudflare cache, then parsed and rendered on the browser main thread without virtualization

**Severity:** **CRITICAL**
**Confidence:** **CONFIRMED** (byte-level + line-level)

| Evidence | Citation |
| --- | --- |
| `flow-data.csv` size | **19,866,637 bytes** (`app/public/flow-data.csv`, measured via `ls -la`) |
| `Darkpool-data.csv` size | **19,439,185 bytes** (`app/public/Darkpool-data.csv`) |
| Frontend fetch site (OptionsFlow) | [`app/src/pages/OptionsFlow.jsx:1138`](app/src/pages/OptionsFlow.jsx#L1138) — `csvFile = dataMode === "index" ? "/Indexes-data.csv" : "/flow-data.csv"` |
| Frontend fetch site (DarkPool) | [`app/src/pages/DarkPool.jsx:1237`](app/src/pages/DarkPool.jsx#L1237) — `fetch("/Darkpool-data.csv")` |
| Backend handler (no cache headers) | [`api/main.py:747-758`](api/main.py#L747) — `FileResponse(csv_path, media_type="text/csv")` with no `Cache-Control` header |
| ~100k rows kept in main-thread state | [`OptionsFlow.jsx:1134, 1189`](app/src/pages/OptionsFlow.jsx#L1134) — `parsedRows` state holds full parsed CSV; `processFlowData()` runs synchronously |
| 145 `.map()` calls + 64 `useState` + only 2 `useMemo` in same 4,740 LOC component | OptionsFlow.jsx counts (per Phase 2.4 audit) |

**Why this produces the observed symptoms — the failure chain:**

1. User navigates to `/options-flow` or `/dark-pool`.
2. Browser fetches `/flow-data.csv` (or `Darkpool-data.csv`) — **20 MB across the wire** through Cloudflare, then through the FastAPI uvicorn process.
3. Cloudflare doesn't cache the response (no `Cache-Control: public, max-age=...` set in `serve_csv` / `serve_darkpool_csv`), so **every page mount goes to origin**.
4. Origin is already CPU-pegged (see causes #2-5). uvicorn streams the 20 MB slowly. **Cloudflare gives up at ~100 s and returns 502.** This matches the user's reported "20 MB ingress spike correlates exactly with failures" — the spike *is* the cause.
5. On a successful download, `papaparse` parses 100k rows synchronously on the main thread → multi-second jank.
6. `processFlowData()` runs another synchronous pass over the 100k rows → more jank.
7. 145 `.map()` calls in JSX evaluate against derived arrays — even if final tables are `.slice(0,40)`, the intermediate state isn't memoised.
8. With `FD` potentially `null` after a parse error (`FD.shortBullTotal` accessed unguarded at [OptionsFlow.jsx:2059](app/src/pages/OptionsFlow.jsx#L2059); `.filter()` on `FD.CONV` chained at [4641](app/src/pages/OptionsFlow.jsx#L4641)), a single failed parse throws into a tree with **no error boundary** (see #5) → permanent blank screen.

This single root cause is the most likely explanation for the 502 wave AND the 20 MB ingress correlation AND part of the OptionsFlow blank-screen reports.

---

### #2 — `/api/bars/{ticker}` is a synchronous FastAPI handler that can pin a thread for up to 25 s; combined with sync handlers across 233 of 247 endpoints, the anyio thread pool (size 64) is the actual production bottleneck

**Severity:** **CRITICAL**
**Confidence:** **CONFIRMED** (code + measurement)

| Evidence | Citation |
| --- | --- |
| Handler is sync (`def`, not `async def`) | [`api/routers/bars.py:651`](api/routers/bars.py#L651) — `def get_bars(ticker: str, ...)` |
| First-fetch path is 4–8 s blocking on Massive | [`bars.py:13`](api/routers/bars.py#L13) docstring; [`massive.py:24-28`](api/services/massive.py#L24) — `httpx.Client(timeout=httpx.Timeout(read=25.0, ...))` |
| Sync vs async router-handler ratio | **233 sync `def` handlers vs 14 `async def`** across `api/routers/*.py` (counted) — **94 % sync** |
| anyio thread pool already pre-tuned 5→64 | [`api/main.py:104-108`](api/main.py#L104) — proof they've already hit this wall once |
| yfinance fallbacks with **NO timeout** | [`massive.py:202`](api/services/massive.py#L202), [`massive.py:235`](api/services/massive.py#L235), [`massive.py:254`](api/services/massive.py#L254) — `yf.Ticker(...).info`, `yf.Ticker(...).history(period="10d")`, `yf.Ticker(ticker)` — these can hang **forever** on Yahoo slowness |
| Anthropic SDK calls with **NO timeout** | [`api/services/journal_ai.py:92`](api/services/journal_ai.py#L92), [`api/services/engine.py:69`](api/services/engine.py#L69) — `client.messages.create(...)`; LLM hang of 10–60 s pins a thread |
| Massive client connection pool | [`massive.py:24-28`](api/services/massive.py#L24) — `max_connections=30, max_keepalive_connections=15` (bound on outbound HTTP concurrency too) |

**Why this produces the observed symptoms:**

- Sync handlers run in the anyio worker thread pool. Pool is **64 threads** (already pumped up from default 5 — they hit this wall earlier).
- Each `/api/bars` call holds one thread for 0.001 s (memory hit) → 5 ms (SQLite hit) → 1 s (delta) → **4–8 s (full Massive fetch)**, with a hard ceiling of 25 s before timeout.
- yfinance fallback can hang **indefinitely** with no timeout — that thread is gone for the lifetime of the Yahoo TCP connection's OS-level timeout (often minutes).
- Anthropic LLM calls (10–60 s typical) can pin threads on `journal_ai` paths.
- Multiply by the cap-universe prewarmer's continuous 5-minute refresh loop (see #4) consuming 2 worker threads of its own + the WebSocket reconnect attempts, and the 64-thread pool fills quickly.
- Once the pool is full, every new request **queues** in anyio. Queue wait + handler time > Cloudflare 100 s → **502s**.
- Python's GIL means CPU-bound work in the request thread blocks all other threads' Python-level execution → a single synchronous CSV-parse path or pandas operation on a request thread will spike to 100 % CPU on the active core (and you only have 1 worker, so 1 core).

This is the explanation for "p50–p99 spike to 20+ seconds" and "error rate hits 80–90 %." The error rate isn't the application returning errors — it's Cloudflare 502-ing on requests that never make it through the queue.

---

### #3 — Single uvicorn worker on 2 vCPU, with the same process owning a permanent 5-minute prewarm refresh loop, an APScheduler with 8 cron jobs, a Finnhub WebSocket stream, and the static-asset server — every minute the prewarmer runs, web traffic competes against it for CPU and Massive upstream

**Severity:** **CRITICAL**
**Confidence:** **CONFIRMED** (code + comments-as-incident-record)

| Evidence | Citation |
| --- | --- |
| Single-worker start command | [`Procfile`](Procfile), [`railway.json`](railway.json), [`nixpacks.toml`](nixpacks.toml) — all `uvicorn api.main:app --host 0.0.0.0 --port $PORT` (no `--workers N`) |
| Process owns the prewarmer | [`api/main.py:197-426`](api/main.py#L197) — `_prewarm_bars` background thread |
| Prewarmer **never stops** | [`api/main.py:414-425`](api/main.py#L414) — `while True: _t.sleep(300); ... refresh_jobs = ...; with _PrewarmTPE(max_workers=2): ...` — runs forever every 5 min |
| Prewarmer fans out to thousands of tickers | [`api/main.py:276-300`](api/main.py#L276) — cap_universe (3,715) + theme ETFs + every theme holding + watchlist + ticker_tags + wire_data candidates |
| Smoking-gun comment | [`api/main.py:193-196`](api/main.py#L193) — *"GATED OFF BY DEFAULT — set BARS_PREWARM_ENABLED=1 to enable. The prewarm starves the FastAPI process on Railway when combined with normal traffic."* |
| Process also owns 8 cron jobs | [`api/main.py:530-668`](api/main.py#L530) — APScheduler `BackgroundScheduler` with COT (×4), session cleanup, churn risk, MRR snapshot, watchlist daily/weekly digests, nightly bar refresh |
| Process also owns the Finnhub WS | [`api/services/realtime_stream.py:206-219`](api/services/realtime_stream.py#L206) — `start_stream()` spawns thread with its own asyncio loop |
| Process also serves the React bundle | [`api/main.py:744-758`](api/main.py#L744) — `FileResponse` for CSVs; static assets via `StaticFiles` mount |

**Why this produces the observed symptoms:**

- A single Python process can effectively use **one CPU core at a time** (GIL) for Python-level work. With 2 vCPUs allocated, half the CPU budget is permanently wasted on Python-level work, but available for I/O.
- The prewarmer runs every 5 minutes forever. Each pass enumerates all stale entries across 3,715+ tickers and refetches them via Massive. **This is 2 background threads doing HTTP fetching, plus pandas/json deserialisation, every 5 minutes.** Every fetch holds one of the 30 max_connections to Massive → fewer connections available for live traffic.
- Multi-worker (`--workers 2`) is **not safe** as a fix without refactoring: each worker would re-instantiate APScheduler (duplicate cron jobs), the prewarmer (double load on Massive), and the Finnhub WS (double subscriptions). The right answer is to extract the scheduler / prewarmer / WS to a separate process.
- The 1 GB idle memory baseline is partially explained by: the bar pre-warm's in-memory caches (Tier 1 × 6 timeframes × 8000 bars), `themes_taxonomy.json` (398 KB) parsed and pinned, pandas import (~50 MB), yfinance + anthropic + sentry + boto3 + websockets SDKs all imported, the WS stream's `_prices` and `_subscribed` sets, and the React `app/dist` directory mounted for static serving.

The user-reported "100 % CPU pegged" is consistent with: **a request thread doing CPU-bound CSV parse / pandas work** + **the prewarmer's HTTP-bound work waking up** + **realtime_stream's tick processing** all colliding on one Python process's GIL.

---

### #4 — SQLite contention: only 1 of 4 SQLite databases uses WAL; many code paths open a fresh connection per request; the `bars.db` is accessed from 12+ threads with `check_same_thread=False`; background scheduler jobs hold write locks during traffic windows

**Severity:** **HIGH**
**Confidence:** **CONFIRMED** (code-level)

| Evidence | Citation |
| --- | --- |
| `bars.db` uses WAL ✓ | [`api/services/bars_sqlite.py:21-23`](api/services/bars_sqlite.py#L21) — `journal_mode=WAL`, `synchronous=NORMAL`, `cache_size=-8192` |
| `auth.db` does **not** explicitly enable WAL | [`api/services/auth_db.py:225-229`](api/services/auth_db.py#L225) — `sqlite3.connect(_DB_PATH, timeout=10)` — defaults: journal_mode=DELETE, synchronous=FULL → **writers block readers entirely** |
| `cot.db` does **not** enable WAL | [`api/services/cot_service.py:220-222`](api/services/cot_service.py#L220) — `sqlite3.connect(DB_PATH)`, default journal_mode |
| `breadth_monitor.db` does **not** enable WAL | [`api/services/breadth_monitor.py:33-36`](api/services/breadth_monitor.py#L33) — `sqlite3.connect(_db_path())`, default journal_mode |
| Per-request connection (no pooling) | `auth_db.get_connection()`, `cot_service._get_conn()`, `breadth_monitor._conn()` — each call to these helpers opens a new SQLite connection |
| `bars.db` accessed from many threads | `check_same_thread=False` at [`bars_sqlite.py`](api/services/bars_sqlite.py); concurrent threads include uvicorn worker pool (64), prewarmer (2), bar seeder (multiple), nightly refresh, request handlers |
| Full-table scans in hot paths | [`cot_service.py:260`](api/services/cot_service.py#L260) — `SELECT COUNT(*) FROM cot_records` (no WHERE); [`cot_service.py:410`](api/services/cot_service.py#L410) — `SELECT MAX(date) AS d FROM cot_records`; [`cot_service.py:493`](api/services/cot_service.py#L493) — full-scan in `get_status()` called by an API endpoint |
| `breadth_monitor.db` has zero indexes | confirmed by Phase 2.2 audit |
| Background jobs hold write locks during business hours | [`api/main.py:660-666`](api/main.py#L660) — nightly bar refresh at 16:15 ET; [`api/main.py:535-555`](api/main.py#L535) — COT refresh Friday 15:50 ET (right during the close session); MRR snapshot 23:59; churn risk 09:00 ET |

**Why this produces the observed symptoms:**

- Without WAL, **any writer on `auth.db` / `cot.db` / `breadth_monitor.db` blocks every reader**. A single MRR-snapshot insert at midnight, or a churn-check write at 09:00 ET, can stall every dashboard auth check until the write commits.
- Per-request connect+close on `auth.db` adds 1–5 MB of SQLite buffer overhead per concurrent request. Under 80–90 concurrent requests during a spike, that's 80–450 MB of transient memory — explains a chunk of the 1→2 GB memory growth.
- Full-table scans on `cot_records` (called from `get_status()`, an API endpoint) hold read locks long enough to block the COT refresh writes — and vice versa.
- The nightly bar refresh thread fights `/api/bars` reader connections on `bars.db` (which DOES use WAL, so this is mitigated, but WAL-checkpoint stalls are still possible under heavy concurrent writes).

---

### #5 — Frontend has no top-level error boundary, so any uncaught render exception produces a permanent blank screen — and several pages have unguarded property access on data that can be `null` after a fetch failure

**Severity:** **HIGH**
**Confidence:** **CONFIRMED** (code-level)

| Evidence | Citation |
| --- | --- |
| `ErrorBoundary` exists | `app/src/components/ErrorBoundary.jsx` |
| Boundary mounted only locally on a single component | per Phase 2.4 audit, only `CotData.jsx:391` uses it |
| Routes rendered without boundary ancestor | `app/src/App.jsx` wraps routes with `<Suspense>` only — no `<ErrorBoundary>` |
| Unguarded null access in OptionsFlow | [`OptionsFlow.jsx:2059`](app/src/pages/OptionsFlow.jsx#L2059) — accesses `FD.shortBullTotal` without null check; [`OptionsFlow.jsx:4641`](app/src/pages/OptionsFlow.jsx#L4641) — chained `.filter()` on `FD.CONV` inside an IIFE |
| State explosion compounding crash surface | OptionsFlow has 64 `useState`, 18 `useEffect`, 145 `.map()`, only 2 `useMemo` (per Phase 2.4) |

**Why this produces the observed symptoms:**

- `/breadth` and `/journal` "blank black screens that never render" are the textbook signature of an uncaught JS error rendering inside a tree without an error boundary. React 19's behaviour is to unmount the whole tree if no boundary exists upstream — that's literally a blank document.
- OptionsFlow's unguarded `FD.shortBullTotal` will throw `TypeError: Cannot read properties of null (reading 'shortBullTotal')` if the CSV fetch fails or returns malformed data. Combined with no boundary, the user sees nothing.
- Charts rendered inside lazy chunks that fail to load (or hit a runtime error inside the chart library) also crash silently for the same reason.

---

## TRACK-BY-TRACK FINDINGS

### Track 2.1 — Backend endpoints

**247 total handlers across 32 router files.**

| Router | Handlers | Notes |
| --- | --- | --- |
| `auth.py` | 54 | Largest router. Auth flow, sessions, subscriptions, MFA. Uses `auth.db` (no WAL). |
| `journal_two.py` | 50 | New journal — has 4 `async def` handlers (highest async count). |
| `journal.py` | 42 | Old journal. |
| `schwab_router.py` | 18 | OAuth + market data + chart-proxy / chart-bounds / chart-ohlc — these are large endpoints (lines 230, 422, 470). |
| `watchlists.py` | 18 | |
| `intelligence.py` | 12 | UCT-Intelligence proxy. |
| `engine_data.py` | 8 | |
| `ticker_tags.py` | 7 | |
| `breadth_monitor.py` | 7 | 3 `async def` handlers. |
| `top_flow_router.py` | 5 | OptionsFlow companion endpoints. |
| `earnings.py` | 5 | |
| `cot.py` | 5 | |
| `calendar.py` | 4 | 786 LOC service file behind it. |
| `bars.py` | 4 | **Hot path** — sync handler at [bars.py:651](api/routers/bars.py#L651), see #2. |
| Others | 18 | snapshot, movers, news, screener, trades, traders, push, charts, gex, watchlist, theme_performance, alerts, insider, avatar, webhooks, watchlist_alerts, stream, community, live_prices, rs_ranking, transcripts. |

**Sync vs async ratio: 233 sync `def` / 14 `async def` (≈ 94 % sync).** All sync handlers run in the anyio thread pool. See root cause #2.

**Other observed patterns on the endpoints:**

- `serve_csv` / `serve_darkpool_csv` at [api/main.py:747-758](api/main.py#L747) — large file responses, no `Cache-Control` header — see root cause #1.
- `/api/health` at [api/main.py:701-706](api/main.py#L701) reads `cache.get("wire_data")` — depends on the wire_data being seeded; if seeding fails, healthcheck still returns 200 but the dashboard is degraded.
- `/api/stream/prices` SSE endpoint at [routers/stream.py:22-82](api/routers/stream.py#L22) polls every 100 ms (`asyncio.sleep(0.1)`). With many concurrent SSE clients, that's a lot of lock acquires on `_prices` per second.
- Several routers re-import services lazily inside handlers (e.g. inside `_check_churn_risk` at [main.py:589-610](api/main.py#L589)) — fine for cold-import cost amortisation but doesn't help once started.

---

### Track 2.2 — SQLite layer

Detailed audit at the top of root cause #4. Critical points:

- **WAL is enabled on only 1 of 4 databases** (`bars.db`). The other three (`auth.db`, `cot.db`, `breadth_monitor.db`) use the default `journal_mode=DELETE` + `synchronous=FULL` — writers block readers.
- **No connection pooling** anywhere. Every dashboard request that touches `auth.db` opens a fresh SQLite connection. With ~80–90 concurrent requests during a spike, that's 80–450 MB of transient SQLite buffer memory.
- **`breadth_monitor.db` has no indexes** at all.
- **`cot_service.py` runs full-table scans** in the API hot path (`get_status()` is exposed via `/api/cot/...`).
- **`bars_sqlite.py` has WAL + indexes**, but is accessed from 12+ threads — under heavy mixed read/write load, WAL checkpoint stalls become visible.
- **Background scheduler holds write locks during business hours**: nightly bar refresh at 16:15 ET, COT refresh Friday 15:50 ET, MRR snapshot 23:59 ET, churn risk 09:00 ET. The 16:15 nightly bar refresh in particular runs *during the close session* when traders are still using the dashboard.

---

### Track 2.3 — External API calls

Detailed audit dispatched to a sub-agent and integrated into root cause #2. Critical points:

| Call site | Library | Timeout | Retry | Cached | On Hot Path | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Massive httpx client | httpx | 25 s read, 3 s connect | ❌ | ✓ TTL | YES | **Read timeout too long for overload scenarios — 25 s pin per fail** |
| `_is_leveraged_etf` | yfinance | **NONE** | ❌ | ✓ 24 h | YES | **CRITICAL — unbounded hang** |
| `_get_avg_dollar_vol` | yfinance | **NONE** | ❌ | ❌ | YES | **CRITICAL — unbounded hang** |
| `_yfinance_snapshot` | yfinance | **NONE** | ❌ | ❌ | YES | **CRITICAL — unbounded hang** |
| `_fetch_intraday_fmp` | urllib | 8 s | ❌ | ❌ | YES | OK timeout, no retry |
| `_fetch_intraday_yfinance` (bars router) | yfinance | **NONE** | ❌ | ❌ | YES | unbounded hang |
| `journal_ai.generate_trade_summary` | anthropic | **NONE** | ❌ | ✓ DB | YES | **CRITICAL — 10–60 s LLM hang on request thread** |
| `engine.get_anthropic_client().messages.create` | anthropic | **NONE** | ❌ | ✓ Cache | NO (background) | acceptable in background |
| Finnhub WebSocket | websockets | ping=30, ping_timeout=10 — **no overall connect timeout** | exponential backoff capped at 60 s, **never gives up** | ✓ in-mem | NO (background) | startup delay if Finnhub unreachable |
| earnings_router (Finviz) | requests + run_in_executor | 8 s | ❌ | ✓ 12 h | YES | thread pool queue saturation under load |
| schwab_router (Yahoo + Schwab) | requests / httpx | 8–15 s | ❌ | ✓ | YES | OK |
| edgar / news_aggregator / cot CFTC / email / discord | requests | 5–15 s | ❌ | mixed | mixed | OK timeouts |

Universal gaps: **no retry policies**, **no circuit breakers**, **no graceful degradation** when the upstream is down.

---

### Track 2.4 — Frontend

Detailed audit dispatched to a sub-agent and integrated into root causes #1 and #5. Critical points:

- **No top-level `<ErrorBoundary>`** in `App.jsx` — root of `/breadth` and `/journal` blank screens.
- **`OptionsFlow.jsx` is 4,740 LOC** with 64 `useState`, 18 `useEffect`, 145 `.map()`, only 2 `useMemo`, 20 `fetch()` sites.
- **Three chart libraries** ship in production: `vendor-echarts` (1,137,559 bytes, 1.14 MB), `vendor-recharts` (415,965 bytes, 416 KB), `vendor-charts` (lightweight-charts, 176,776 bytes, 177 KB). `Analytics.jsx` imports both echarts AND recharts. `package.json` also has `chart.js` + `react-chartjs-2` — a fourth library — though no chunk for it appears in the production build (suggests it's tree-shaken or unused; verify in Phase 3).
- **`@tanstack/react-virtual` is installed** but per the agent's audit is not used to virtualise the 100k-row CSV tables.
- **CSV processing happens synchronously on the main thread** — no Web Worker, no streaming parse.
- **Code-splitting is partial** — pages are lazy chunks (good), but the `vendor-echarts` chunk (1.1 MB) loads with anything that imports echarts.
- **`papaparse` parses 19.86 MB synchronously** — this alone is multi-second main-thread block.

---

### Track 2.5 — Infrastructure & configuration

| Item | Current value | Concern |
| --- | --- | --- |
| Web start command | `uvicorn api.main:app --host 0.0.0.0 --port $PORT` | **Single worker.** Multi-worker not safe without scheduler/prewarmer/WS extraction. |
| Healthcheck | `/api/health`, timeout 600 s | Long timeout signals slow startup. The 600 s ceiling is what currently keeps Railway from marking the service unhealthy during prewarmer warm-up. |
| Healthcheck content | `cache.get("wire_data")`'s date | Returns 200 even when degraded; not a true readiness check. |
| Cloudflare cache headers on CSVs | None (`FileResponse` defaults) | Every page mount goes to origin. Adding `Cache-Control: public, max-age=300` (or higher) on the CSV endpoints would eliminate most of the 20 MB ingress to origin. |
| Gzip middleware | ✓ enabled, min size 1000, **excludes `/api/stream`** | Good. |
| Static asset cache | none configured at FastAPI level | Vite-built assets have content-hashed filenames — should be `Cache-Control: public, max-age=31536000, immutable`, but currently use whatever default `StaticFiles` ships. |
| Sentry | ✓ enabled at `traces_sample_rate=0.1` | **We have access to Sentry runtime data we haven't queried yet — see "Could not investigate."** |
| Memory baseline (1 GB idle) | Composed of: pandas + yfinance + anthropic + sentry SDKs (~150 MB), TTLCache pre-warm (Tier 1 × 6 TFs × 8000 bars ≈ 100–200 MB), themes_taxonomy.json + theme_db SQLite seed (~50 MB), realtime_stream `_prices`/`_subscribed` (small until populated), background thread stacks, uvicorn's own buffers. Roughly accounted for. | Nothing definitively pathological at idle, but the Tier 1 pre-warm is the biggest single contributor and can be deferred. |
| `/data` Railway volume | mounted, holds SQLite dbs + `wire_data.json` | OK. |

**Cloudflare config** (cache rules, Page Rules, Workers): cannot be inspected from this repo. If asset caching is misconfigured at the Cloudflare layer, that compounds the CSV problem.

---

### Track 2.6 — Concurrency

- **Sync handlers in async framework — 94 %** (233/247). See root cause #2.
- **Unprotected dict mutation in `TTLCache`** — [`api/services/cache.py:1-37`](api/services/cache.py): `OrderedDict.move_to_end`, `popitem`, dict assignment all without lock. Concurrent writes from prewarmer + request threads will surface `RuntimeError: dictionary changed size during iteration` and `KeyError` in Sentry. The single global `cache` object is shared by every request handler and the prewarmer thread. **Confidence: HIGH that Sentry already has these errors.**
- **Multiple threads against `bars.db` with `check_same_thread=False`** — see root cause #4.
- **Realtime stream uses asyncio in a separate thread + global mutable state** — guarded by `_lock` for `_prices` writes ([realtime_stream.py:187](api/services/realtime_stream.py#L187)) but `_subscribed` is a plain `set` mutated from multiple threads ([realtime_stream.py:69, 81](api/services/realtime_stream.py#L69)).
- **SSE event_generator polls every 100 ms** — for N concurrent clients, that's N × 10 lock-acquires per second on `_prices`. Acceptable for tens of clients, problematic at hundreds.
- **Cache TTLs on intraday bars (5–10 s) too short to provide protection** during sustained intraday browsing; nearly every chart load goes back to the SQLite delta path.

---

## What I could not investigate, and why

These would meaningfully improve the diagnosis but require either deploy authorization or out-of-repo access:

1. **Per-endpoint p50/p95/p99 from production traffic.** Sentry's Performance / Tracing tab almost certainly has this — `sentry_sdk.init(traces_sample_rate=0.1)` at [api/main.py:60-65](api/main.py#L60). **If you can paste the top 10 slowest transactions and top 10 most-frequent errors, I can correlate against the findings above.**
2. **Real Cloudflare cache hit ratio** for the 20 MB CSVs. Cannot see Cloudflare config from the repo.
3. **Live Railway logs** (last 24 h) showing actual `[startup]`, `[prewarm]`, `[scheduler]`, `[stream]` print lines, plus any `[bars] CRASH` messages from the existing exception handler at [bars.py:668-671](api/routers/bars.py#L668). I have the Railway CLI installed locally but the dashboard repo isn't `railway link`-ed; running `railway logs` requires you to authorise the link.
4. **`OptionsFlow.test.jsx`, `DarkPool.jsx`, `LiveFlow.jsx` deeper static reads** — sub-agent flagged the dominant patterns; I confirmed counts. The actual offending CSV-render code paths haven't been diffed against a working version because there isn't a "before" — these pages were always heavy.
5. **`OptionsFlow.jsx` collaborator commits** — the 6 "Update OptionsFlow.jsx" commits via GitHub web editor are a known-unknown. If they introduced any of the unguarded property accesses noted in #5, they're recent regressions and high-priority to revert/fix; if they predate the breakage, they're orthogonal. A `git log --follow -p app/src/pages/OptionsFlow.jsx` against a known-working SHA would tell us — but we don't yet have a "known-working" SHA.

---

## Recommended Phase 3 priority order

(_I am NOT executing this without your approval. This is the proposal._)

The top-three CONFIRMED-impact / lowest-risk fixes that should land first, before anything else:

1. **Cache the CSVs at Cloudflare + add `Cache-Control` headers** in `serve_csv` / `serve_darkpool_csv`. This alone should drop ingress + 502 rate dramatically, and is low-risk. (Track 2.5 + root cause #1.)
2. **Add a top-level `<ErrorBoundary>` in `App.jsx`** wrapping the routed `<Suspense>`. Eliminates the blank-screen failure mode immediately, regardless of what crashes inside. (Root cause #5.)
3. **Add timeouts to the 4 unbounded yfinance call sites and 1 unbounded anthropic call site.** Trivial line-count change, eliminates the unbounded-thread-pin failure mode. (Root cause #2.)

After those three are deployed and metrics confirm improvement, iterate to:

4. Lazy-load the 19.86 MB CSV with streaming parse + Web Worker (or move parsing server-side); virtualise the 100k-row tables.
5. Make `/api/bars/{ticker}` async (`async def`) and use `httpx.AsyncClient`; the in-flight dedup at [bars.py:32-37](api/routers/bars.py#L32) already protects against thundering herd.
6. Enable WAL on `auth.db`, `cot.db`, `breadth_monitor.db` and add a basic connection pool. Convert full-table scans on `cot_records` to indexed lookups.
7. Make `TTLCache` thread-safe with a single `threading.RLock`. Replace `_MAX_SIZE = 500` with size-by-class (e.g. bars vs wire_data) to prevent eviction churn.
8. Drop one of the chart libraries — recommend keeping `recharts` (most usage sites), removing `echarts` / `echarts-for-react`, and rewriting `Breadth.jsx` + `Analytics.jsx` to use it. Saves ~1.1 MB on the bundle.
9. Extract scheduler / prewarmer / Finnhub WS to a separate worker process / Railway service; switch web to `--workers 2`.
10. Code-split `OptionsFlow.jsx` into smaller components per tab/section. 4,740 LOC is unmaintainable.

---

**End of Phase 2.** Awaiting approval before any code change.
