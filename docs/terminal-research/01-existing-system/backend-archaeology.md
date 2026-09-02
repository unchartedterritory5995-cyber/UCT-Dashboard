---
id: D-02
title: Existing Backend Archaeology — the FastAPI `api/` service as it actually runs
role: Existing Backend Archaeologist
wave: 1
group: D
category: internal-system
scope: uct-dashboard worktree `terminal-research` — `api/` (+ `services/chart_renderer` boundary only)
confidence: 🟡 medium-high overall (composition, routers, topology, code health 🟢; production runtime state of individual jobs/flags 🟡/🔴)
evidence_ceiling: No pod shell, no Railway CLI reads, no logs, no admin endpoints (they require an admin session). Exactly ONE production call was permitted (`GET /api/health`). Every statement about which flag is set on Railway today is therefore CLAIM, not CONFIRMED.
sources: api/main.py, api/routers/*, api/services/*, api/middleware/*, api/{worker_main,flow_worker_main,bars_api_main}.py, railway.json, nixpacks.toml, pytest.ini, CLAUDE.md, https://uctintelligence.com/api/health
uct_relevance: high
status: draft
date: 2026-09-02
---

# D-02 — Existing Backend Archaeology

> **Vocabulary reminder.** TERMINAL-CURRENT is the shipped surface at route `/calendar`
> (display-named "UCT Terminal" since 2026-09-01; plumbing unchanged). TERMINAL-NEXT is
> the product this program designs. Grepping `api/` for "terminal" finds **nothing
> load-bearing** — the backend has no notion of a terminal at all. Every calendar route,
> service and cache key is spelled `calendar`.

---

## 0. HEADLINE

**OBSERVATION.** `api/` is not a service — it is a *monolith with 1,187 declared HTTP
routes, 143 scheduled jobs, ~34 in-process background threads and 54 distinct SQLite
databases, all inside one uvicorn process on one event loop.* There is no service layer
between the routers and the data: routers import services, services import providers,
and a large amount of business logic lives inside route handlers in `api/main.py`
(9,328 lines, 52 of its own routes) and `api/live_massive_router.py` (7,014 lines).

**EVIDENCE.** `find api -name '*.py' | wc -l` → **1,046** Python files.
Route census, derived by AST over the decorator sites (not typed):
`api/routers/*` = **972**, mounted top-level `api/*_router.py`-family = **163**,
`api/main.py` itself = **52** (42 module-level + 10 inside the `if os.path.exists(DIST)`
block) ⇒ **1,187**. `grep -c add_job api/main.py` = **144** call sites resolving to
**143 unique job ids**. CONFIRMED for the code; the running route table was not walked
(that requires importing `api.main:app`, which runs boot side-effects — out of bounds).

**INTERPRETATION.** Anything TERMINAL-NEXT wants to reuse it can reuse *only by importing
the monolith*, because almost nothing is exposed as a stable internal contract. The two
exceptions are architecturally important and are the two real seams (§12).

**RELEVANCE TO UCT.** A Terminal-Next "service layer" is not a refactor of this code —
it is a *new boundary drawn over it*. The cheapest correct move is a new process on the
`bars_api_main` template fronted by a `flow_proxy`-shaped forwarder, not a rewrite.

**CONFIDENCE.** 🟢 for the counts and structure. **EVIDENCE CEILING:** the *running*
route table, the *actual* flag states on Railway, and job execution history were all out
of reach; raising confidence needs `railway variables --json` (names only) and a log window.

---

## 1. APP COMPOSITION (`api/main.py`)

### 1.1 The object and its middleware stack

**OBSERVATION.** One app, five middleware layers, one exception handler.

**EVIDENCE.**
- `api/main.py:6681` — `app = FastAPI(title="UCT Dashboard", lifespan=lifespan)`.
  ⚠️ Uses the **lifespan** context manager, so `@app.on_event` handlers are silently
  ignored (stated as a LOCKED invariant in CLAUDE.md "Live Options Flow — Deploy
  Survival"; CONFIRMED by the constructor argument at `:6681` plus the `yield` at `:6615`).
- `api/main.py:6682` `MaintenanceMiddleware` (defined `:154`) — 503s everything except
  `/api/auth*`, `/api/maintenance`, `/api/health` while the **module-global**
  `_MAINTENANCE_MODE` (`:151`) is True. Per-process, in-memory, lost on restart.
- `api/main.py:6683` `CompassPaywallMiddleware` (defined `:165`) — path-gates every
  `/api/j2/**/coach**` and `/api/j2/**/unified-coach` to paid/admin. Reads the session
  **on the event loop** for every matching request.
- `api/main.py:6704` `AdminGuardMiddleware` (`api/middleware/admin_guard.py`) — fail-closed
  403 for six prefixes: `/api/admin/{massive,oi,ticker-types,flow}/`,
  `/api/admin/alert-tester`, `/api/live/admin/`.
- `api/main.py:6706` `CORSMiddleware(allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])`.
- `api/main.py:6738` `_GZipSkipSSE(minimum_size=1000, compresslevel=5)` — a `GZipMiddleware`
  subclass with an exemption predicate `_is_gzip_exempt` (`:6710`) covering `/api/stream*`,
  `/api/live/massive/stream`, `/api/community/chat/stream`, `/api/ai-search/stream`,
  `/assets/`, `/fonts/`.
- `api/main.py:6739-6740` — `app.state.limiter = limiter`;
  `add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)`.

Starlette prepends, so **execution order is GZip → CORS → AdminGuard → CompassPaywall →
Maintenance → router** (comment at `:6698`, consistent with the add order). CONFIRMED by source.

**INTERPRETATION.** Two of the five middlewares (`CompassPaywall`, `AdminGuard`) do a
**synchronous SQLite session read on the event loop** for matched paths. Acceptable at
today's admin/coach traffic; not at terminal-scale fan-out. `allow_origins=["*"]` with
cookie auth deserves a security look.

**RELEVANCE TO UCT.** Any Terminal-Next surface added under `/api/j2/**/coach**` inherits
a paywall for free; anything else inherits **nothing** and must gate itself.

**CONFIDENCE.** 🟢.

**RECOMMENDATION.** If Terminal-Next introduces a new path family, decide *up front*
whether it is middleware-gated (one place, cannot be forgotten) or `Depends`-gated
(40 duplicated copies today, §6.2). The middleware form is what caught the
"~30 destructive admin ops answered any caller" defect.

**OPEN QUESTION.** Is `allow_origins=["*"]` deliberate given `uct_session` is a cookie?

### 1.2 Lifespan (startup / shutdown)

**OBSERVATION.** The lifespan spans `api/main.py:2386` → `:6615` (yield) → `:6680`. It
does, in order: anyio thread-limiter bump to 64 → thread-burst watchdog → **cache snapshot
restore from the volume** → auth DB init → `ADMIN_EMAILS` promotion → dozens of DB
inits/seeds → ~34 background daemon threads → `acquire_scheduler_lock()` → one
`BackgroundScheduler` with 143 jobs → event-loop watchdog.

**EVIDENCE (selected, all `api/main.py`).**
- `:2390` `anyio.to_thread.current_default_thread_limiter().total_tokens = 64`.
- `:2415` `cache_snapshot.restore(...)` — carries the warm TTLCache across a deploy.
  `api/services/cache_snapshot.py`'s docstring records that the readiness-gate
  alternative caused a ~3-minute outage on 2026-07-26.
- `:4282` `acquire_scheduler_lock()` (`api/services/scheduler_lock.py` — `fcntl.flock` on
  `/tmp/uct_scheduler.lock`; **no-op grant on Windows**). The scheduler runs only in the
  lock-holding process.
- `:4289-4297` `memory_probe.instrument_scheduler(_scheduler)` wraps `add_job` *before any
  job is registered*, so the instrumentation cannot go stale as jobs are added.
- `:4325` `_add_compass_job()` — 9 call sites, 8 job ids (`awareness_engine_scan`,
  `compass_daily_focus`, `compass_eod_recap`, `compass_weekly_email_digest`,
  `voice_nightly_consolidate`, `voice_proactive_after_hours`, `voice_proactive_premarket`,
  `voice_proactive_scan`) gated on `COMPASS_AUTOMATION_ENABLED`.
- Shutdown (`:6616`–`:6680`): Massive WS `stop()` via `asyncio.to_thread` → Bullflow SSE
  worker `stop()` → `_scheduler.shutdown(wait=False)` → **`cache_snapshot.save()`** →
  `stop_snapshot_scheduler()` → `nhnl_live.stop()` → `volume_live.stop()`. Every step is a
  defensive `getattr` inside try/except.

**In-process daemon threads started at boot** (thread names, from `Thread(..., name=)` —
~34 sites in `main.py` alone): `startup-priority-audit`, `deploy-smoke`,
`chart-renderer-warmer`, `hot-tier-warmer`, `dashboard-warmer`, `rs-rankings-warmer`,
`industry-map-warmer`, `darkpool-prewarm-warmer`, `scanner-warmer`, `thread-burst-watch`,
`screener-warm`, `sqlite-integrity`, `sqlite-bydate-index`, `memory-prewarm`,
`web-memwatch`, `prewarm`, `initial_snapshot_pull`, `s3_pull`, `hotset_push`,
`breadth-ohlc-*`, `breadth_sentiment_seed`, `breadth_heal_loop`, `deep-cache-builder`,
`voice-kb-seed`, `flow-db-seed`, `darkpool-db-seed`, `prebuilt-watchlists-seed`,
`cot-seed`, `cot-catchup`, `flow-integrity-probe`, `bars-nightly`,
`ratings-percentile-catchup`, plus a confluence refresher started from a route handler
(`api/main.py:7251`).

**INTERPRETATION.** The lifespan is the biggest single concentration of risk in the repo:
every subsystem's boot cost lands here, on one pod, before the first request. Its shape
was set by two production outages (thread exhaustion 2026-06-09; readiness gate
2026-07-26), and every step is now non-fatal-on-failure.

**RELEVANCE TO UCT.** TERMINAL-NEXT cannot be "another tab" on this pod without adding to
this boot cost. The cache-snapshot idiom (restore at boot, save at drain) is the single
most reusable primitive here for a latency-sensitive terminal.

**CONFIDENCE.** 🟢 for what the code does at boot. 🟡 for what actually starts in
production, since nearly every block is env-gated.

### 1.3 Health endpoints — and what `/api/health` reports

**OBSERVATION + EVIDENCE.**

| Route | Auth | Source | Reports |
|---|---|---|---|
| `GET /api/health` | none (deliberate) | `api/main.py:6764` | `status`; `wire_date` from `cache.get("wire_data")["date"]`; `uptime_seconds` = `time.time() - _APP_BOOT_TS`; `thread_count` = `threading.active_count()`; `rss_mb` parsed from `/proc/self/status` `VmRSS` (`:6749`) |
| `GET /api/ready` | none | `:6779` | `readiness.snapshot()`, 503 until warm. **OBSERVABILITY ONLY** — the docstring records that pointing `healthcheckPath` here on 2026-07-26 caused a ~3-min outage; rail `tests/api/test_ready_endpoint.py` |
| `GET /api/health/threads` | `Depends(require_admin)` | `:6835` | per-location thread histogram |
| `GET /api/health/memory` | admin | `:6848` | |
| `GET /api/health/thread-stacks` | admin | `:6875` | previously anonymous; returned live stack traces |
| `GET /api/health/cache` | admin | `:6914` | R2 bars-snapshot sync freshness |
| `GET /api/maintenance` | none | `:6743` | |

**CONFIRMED (the one permitted production call).**
`GET https://uctintelligence.com/api/health` at **2026-09-02 06:02:19 UTC** returned:

```json
{"status":"ok","wire_date":"2026-09-01","uptime_seconds":28,"thread_count":67,"rss_mb":814.4}
```

Contract's KNOWN-FACT sample (05:41 UTC): `uptime_seconds 776`, `thread_count 67`,
`rss_mb 1306.6`.

**INTERPRETATION.**
1. **`thread_count: 67` is identical across both samples, 21 minutes and one restart
   apart.** That is a steady-state number, not a warm-up artifact — the web pod really
   does run ~67 threads. **This CONFIRMS that the in-process job/thread architecture is
   live in production**, which is the strongest evidence obtainable without a shell that
   the scheduler and warmers of §1.2 actually run on the web pod. It does *not* identify
   which jobs; that needs `/api/health/threads`, which is admin-gated.
2. `uptime_seconds: 28` at 06:02 means the pod restarted at ≈06:01:51 UTC — the pod that
   was 776s old at 05:41 is gone. Per project memory, uptime is a deploy/restart signal,
   not a sleep signal; the restart is a fact, its *cause* is NOT DETERMINED (deploy,
   `restartPolicyType: ALWAYS` restart after a crash, and a platform move are
   indistinguishable from here).
3. `rss_mb` 814 at 28s vs 1307 at 776s is consistent with the documented warm-up
   allocation curve. No leak conclusion drawn from two points.

**RECOMMENDATION.** Do not add another anonymous diagnostic route — the 2026-08-09 sweep
had to retro-gate three. And `healthcheckPath` must stay `/api/health`: this is the most
expensive documented mistake in the repo.

**CONFIDENCE.** 🟢 CONFIRMED for the payload (observed). 🟡 for the restart interpretation.

### 1.4 The SPA catch-all — and why production `GET /api/calendar/week` returned the SPA shell

**OBSERVATION.** `api/main.py:9323` declares, **last in the file and last in the route
table**, `@app.get("/{full_path:path}")` → `FileResponse(app/dist/index.html)` with
`Cache-Control: no-cache, no-store, must-revalidate`. It sits inside
`if os.path.exists(DIST)` (`:9222`), which is always true on Railway (nixpacks runs
`npm run build`).

Explicitly-routed static files precede it — `/assets` and `/fonts` mounts
(`_ImmutableStaticFiles`, `:9212`), `/manifest.json`, `/sw.js`, `/favicon.svg`,
`/vite.svg`, `/og-image.png`, `/og-coming-soon.png`, `/robots.txt`, `/sitemap.xml`,
`/pip-embed` — each with a comment noting that without its own route the catch-all would
serve HTML for it (the fonts mount is called out as load-bearing: an HTML response for a
`.woff2` makes lightweight-charts bake a fallback face into every chart axis).

**INTERPRETATION — the direct answer to the contract's question.**
**There is no `/api/calendar/week` route anywhere in the codebase.**
`grep -rn "api/calendar/week" api/` returns exactly two hits, both *image* routes:
`api/routers/calendar.py:4050 GET /api/calendar/week-earnings.png` and
`:4056 GET /api/calendar/week-econ.png`. The weekly payload is `GET /api/calendar`
(`api/routers/calendar.py:2001`, optional `?week=YYYY-MM-DD`).

So `GET /api/calendar/week` matches no API route, falls through to the catch-all, and is
answered **`200 text/html` — the SPA shell**. This generalises:

> ⛔ **Every unmatched `GET /api/…` path on this backend returns HTTP 200 with the React
> `index.html`, not a 404.** Only non-GET verbs surface the truth: a `POST` to an
> unmatched path gets `405 Method Not Allowed`, because the catch-all is GET-only.

Not hypothetical: CLAUDE.md's broker-sync section records this exact failure in
production — a dropped `include_router` made `POST /api/j2/broker/connect` return **405**
while `GET /connect` returned **200 HTML**, and the 405 was the only tell that the router
was unmounted.

**RELEVANCE TO UCT.** A first-order API-design hazard for TERMINAL-NEXT: a client cannot
distinguish "endpoint does not exist", "router failed to mount", and "typo in the path"
from a successful response. Any terminal client doing feature detection, capability
probing, or graceful degradation against this backend will mis-detect.

**CONFIDENCE.** 🟢 — route absence and catch-all both read directly from source, and the
production behaviour named in the contract is exactly what this code produces.

**RECOMMENDATION.** Add an `/api/{_:path}` 404-JSON route registered *immediately before*
the SPA catch-all. ~5 lines; changes no existing behaviour (every real `/api` route is
registered earlier and wins on first match); converts a whole class of silent mis-wiring
into a loud one. Prerequisite for any Terminal-Next client that negotiates capabilities.

**OPEN QUESTION.** Do any existing consumers rely on an `/api/...` path returning HTML
(a deep link the SPA router handles)? A frontend grep would settle it; out of scope here.

---

## 2. PROCESS TOPOLOGY

**OBSERVATION.** One `railway.json` is shared by **all** Railway services; the entrypoint
is chosen by an env-var `if`-chain in `startCommand`.

**EVIDENCE — `railway.json`.**

```
startCommand:
  if   BARS_API_ENABLED=1    -> exec python -m api.bars_api_main
  elif FLOW_WORKER_ENABLED=1 -> exec python -m api.flow_worker_main
  elif WORKER_ENABLED=1      -> exec python -m api.worker_main
  else                       -> exec uvicorn api.main:app --host 0.0.0.0 --port $PORT \
                                     --proxy-headers --forwarded-allow-ips='*' \
                                     --timeout-graceful-shutdown 5
drainingSeconds: 30
healthcheckPath: /api/health
healthcheckTimeout: 600
restartPolicyType: ALWAYS
```

`nixpacks.toml` builds python312 + nodejs_20 + **ffmpeg** into `/opt/venv`. ⚠️ Its own
`[start] cmd` is the *bare* uvicorn line — no dispatcher, no `--timeout-graceful-shutdown`.
`railway.json`'s `startCommand` overrides it, but that is a second authority over one
value (§11.4).

**The four processes.**

| Branch | Entrypoint | What it runs | Serves users? |
|---|---|---|---|
| default | `uvicorn api.main:app` | the whole monolith: 1,187 routes, 143 jobs, ~34 boot threads, all SSE, the SPA | **yes — the only fully user-facing pod** |
| `WORKER_ENABLED=1` | `api/worker_main.py` (883 ln) | bars pre-warmer (supervised), universe crawler (`BARS_UNIVERSE_CRAWLER_ENABLED`), deep-history warm, R2 `s3_upload` loop, breadth history + wick backfills, bars-freshness watchdog, **keep-warm pinger + Discord down-alert monitor** (`DOWN_ALERT_ENABLED`), optional `GET /api/bars-history/{ticker}` origin (`BARS_HISTORY_ORIGIN_ENABLED`) | no (health + optional origin) |
| `FLOW_WORKER_ENABLED=1` | `api/flow_worker_main.py` (824 ln) | Massive OPRA WS consumer; owns flow.db on its own volume; T+1 flat-file ingest, gap-fill, backup, nightly prune, OI capture, weekly flow push, instant/curated SSE tailers, HMAC vouch router; its own small scheduler | no (proxied from web) |
| `BARS_API_ENABLED=1` | `api/bars_api_main.py` (292 ln) | **NEW, dated 2026-09-02** — chart-data tier only: `GET /api/bars/{ticker}`, `GET /api/bars-history/{ticker}` off a fresh R2-synced `bars.db`. No warmers, no market socket, no scheduler | yes, bars only |

**INTERPRETATION.** The architecture is mid-migration *away* from the monolith, one data
family at a time, with a repeated recipe: give the family its own process + volume, and
make `web` a proxy or thin client. Flow went first (P5, 2026-07-13); bars started **the
day before this report**.

**Which jobs run inside the web process?**
- **CLAIM (source).** All 143 job ids are registered in `api/main.py`'s lifespan and
  therefore run in the web process, subject to `acquire_scheduler_lock()` and their
  individual env gates. `flow_worker_main.py` registers ~10 of its own; `worker_main.py`
  uses threads rather than APScheduler. Those families are disjoint.
- **CONFIRMED (health endpoint).** `thread_count: 67`, identical in two samples 21 minutes
  apart. A pod running no in-process background work would sit near uvicorn's baseline.
  67 steady-state threads is only explicable by the boot-thread + scheduler-worker
  population of §1.2. This confirms the *class*, not the roster.
- **NOT DETERMINED.** Which specific jobs fired today. `/api/health/threads` gives the
  by-location histogram and would settle it, but is `Depends(require_admin)`.

**RELEVANCE TO UCT.** TERMINAL-NEXT has a ready-made precedent for its own process: copy
`bars_api_main.py`. 292 lines, it shares the serve core with the monolith
(`api.routers.bars.serve_bars`) so the two cannot diverge, and its header records the two
traps it survived — `init_db()` before the R2 install (forcing a RAM-heavy row-by-row
merge), and running the install in a lifespan **thread** where its GIL-heavy extract
starved `/api/health` into a silent Railway restart loop.

**CONFIDENCE.** 🟢 dispatcher/entrypoints; 🟢 "in-process jobs exist"; 🔴 any per-job
production claim.

**OPEN QUESTION.** Is `BARS_API_ENABLED=1` set on a real Railway service today, or is the
branch still dark?

---

## 3. ROUTER INVENTORY

### 3.1 Census and mounting

**OBSERVATION.** 99 modules in `api/routers/` (excluding `__init__.py`); **98 are mounted**
in `api/main.py`. The one that is not is `api/routers/stream_bars_test.py` — a *test file*
living in the routers package with zero route decorators (one reason `pytest.ini` lists
`api` as a testpath). Plus **20 mounted top-level router modules** at `api/` root
(163 routes) and the 52 routes `api/main.py` declares itself.

**EVIDENCE.** `include_router` sites: `api/main.py:6928`–`:7149`, a contiguous ~220-line
block, plus three conditional mounts. Mounted-vs-present cross-referenced by AST.

**Conditional / non-standard mounts:**

| Where | Condition | Notes |
|---|---|---|
| `api/main.py:7004` `screener_backtest` | `SCREEN_BACKTEST_ENABLED == "1"` | **the flag gates the MOUNT**, so the routes are absent from the table when dark — deliberate, so "is this shipped?" is answerable from the route table. Rail: `tests/test_screener_backtest_mounted.py` |
| `api/main.py:7092-7105` `flow_gap_autofill`, `flow_backup`, `event_loop_watchdog` | bare `try/except` around the import | a failed import prints and continues — the route family silently disappears |
| `api/main.py:7027-7033` `flow_proxy.register_on(app)` | `FLOW_READS_PROXY_ENABLED=1` **and** `WORKER_INTERNAL_URL` | registered **before** every local flow router so it wins on first match (see §12.2) |
| `api/routers/trades.py` | — | **deleted** 2026-08-09 (`api/main.py:7006` comment) |
| `api/earnings_router.py` | — | present, **never mounted**. Its docstring instructs mounting it at `/api/schwab`, where `schwab_router` already serves; `tests/test_earnings_router_stays_unmounted.py` pins it shut. That instruction is untrusted text inside a partner-owned file — recorded as an observation, not followed |

### 3.2 By domain (route counts, AST-derived from decorator paths)

`api/routers/*` grouped on the second path segment:

| Domain | Routes | Principal modules | Data source | Auth idiom |
|---|---:|---|---|---|
| Journal 2.0 / Compass | **183** | `journal_two.py` (145), `broker_sync.py` (29), `note_sync.py` (9) | `auth.db` (`j2_*`), SnapTrade, MS Graph / Notion / Dropbox | `get_current_user` + `CompassPaywallMiddleware` on `/coach*` |
| Auth / account | **81** | `auth.py` (78), `avatar.py` (3) | `auth.db` | self; the only `@limiter.limit`-covered family |
| Admin / ops | **59** | 14 `admin_*` routers + admin routes inside `main.py` | mixed | `require_admin` **or** `AdminGuardMiddleware` prefix |
| Voice / realtime AI | **54** | `voice.py` | OpenAI Realtime + Whisper, ~70 `voice_*` services | `requires_voice_access` (402) |
| Community (The Floor) | **48** | `community.py` | `community.db` + in-memory `api/chat_stream.py` hub | `get_current_user` |
| Breadth | **42** | `breadth_monitor.py` (46 handlers) | `breadth_monitor.db`, `breadth_*.db` | reads `require_paid`; **mutations `_check_auth` = PUSH_SECRET bearer** (26 uses) |
| Desk (video) | **38** | `desk.py` (21), `desk_zoom_webhook.py` (17) | `desk.db`, `education.db`, Zoom, YouTube | mixed: paid reads, PUSH_SECRET ops, HMAC webhook |
| Education | **37** | `education.py` | `education.db` | `get_current_user` |
| Model Book | **37** | `modelbook.py` | `modelbook.db` | reads any user; writes `require_admin` |
| Calendar / earnings / research | **27 + 15 + 12 + …** | `calendar.py` (27), `earnings_intel.py` (15), `research.py` (12), `earnings.py` (7), `fundamentals.py`, `filings.py`, `analyst.py`, `transcripts.py`, `expected_move.py`, `ticker_logos.py` | Finnhub, FMP, EW/Finviz, AlphaVantage, EDGAR, logo.dev | **mixed and inconsistent** — see §6.4 |
| Scans / screener | **22 + 20 + 16 + …** | `scans.py`, `screener.py`, `scan_results.py`, `scan_live.py`, `scan_run.py`, `definition_record.py`, `user_definitions.py`, `screener_backtest.py` | `screener.db`, `screener_analyst.db`, `screener_insider.db`, `user_definitions.db` | per-handler `require_paid` |
| AI Search | **21** | `ai_search.py` (3,193 ln) | Anthropic + Perplexity + internal corpora | locally-defined `require_paid` |
| Watchlists / tags / alerts | **19 + 7 + 3** | `watchlists.py`, `ticker_tags.py`, `watchlist_alerts.py` | `auth.db` | `get_current_user` |
| Charts / bars / tickers | **14 + …** | `bars.py` (14), `charts.py`, `charts_layouts.py`, `ticker_search.py`, `ticker_meta.py`, `compare.py`, `stream.py` | `bars.db` + disk cache + Massive/yfinance/FMP | mostly anonymous or logged-in |
| Patterns / indicators / signature | **12 + 12 + 7** | `patterns.py`, `indicator_alerts.py`, `signature.py`, `indicator_vision.py`, `backtest.py` | `pattern_detections`, `bars.db` | `require_paid` |
| Wire | **4 + 3 + 3** | `wire.py`, `wire_feedback.py`, `push.py` | `wire_data.json` + TTLCache + `wire_feedback.db` + `earnings_wire.db` | PUSH_SECRET for ingest |
| COT | **10** | `cot.py` | `cot.db` from CFTC public zips | `require_paid` |
| Catalysts / tweets / news | **8 + 4 + …** | `catalysts.py`, `tweets.py`, `news.py`, `news_catalysts.py`, `chart_news.py` | `catalysts.db`, `tweets.db`, RSS / AlphaVantage / Perplexity | logged-in |
| Themes | **6 + 3 + 3** | `theme_engine.py`, `theme_index.py`, `theme_performance.py`, `groups.py` | `theme_db` + `auth.db` overlay | admin for engine ops |

Top-level (`api/*.py`) mounted routers — the **options-flow family**, all intercepted by
`flow_proxy` when `FLOW_READS_PROXY_ENABLED=1`:

| Module | Routes | Prefix family |
|---|---:|---|
| `live_massive_router.py` *(partner)* | 35 | `/api/live/massive/*` |
| `darkpool_router.py` | 26 | `/api/darkpool*` |
| `schwab_router.py` *(partner)* | 21 | `/api/schwab/*` |
| `flow_router.py` | 12 | `/api/flow/*` |
| `oi_snapshot_router.py` | 11 | `/api/oi-snapshot/*` |
| `liveflow_router.py` | 10 | `/api/liveflow/*` |
| `flow_gap_autofill.py` | 9 | `/api/flow-gap-fill/*` |
| `top_flow_router.py` | 7 | `/api/top-flow/*` |
| `notable_flow_router.py` | 6 | `/api/notable-flow/*` |
| `dealer_positioning_router.py` | 5 | `/api/dealer-positioning/*` |
| `csv_ingest.py` (4), `watchlist_router.py` (3), `gex_router.py` (2), `flow_backup.py` (2), `flow_explain.py` (2), `flow_scoreboard.py` (2), `event_loop_watchdog.py` (2), `alert_tester.py` (2), `flow_summary.py` (1), `debug_dump_router.py` (1) | 1–4 each | — |

### 3.3 `/api/calendar/*` — endpoint list only (D-09 owns depth)

All in `api/routers/calendar.py` (4,078 lines; the router has **no prefix**, so paths are absolute):

`GET /api/calendar` (`:2001`) · `GET /api/calendar/month` (`:1860`) ·
`GET /api/calendar/ipos` (`:2515`) · `GET /api/calendar/dividends` (`:2548`) ·
`POST /api/calendar/refresh` (`:2573`, admin-gated) · `GET /api/calendar/reactions` (`:2677`) ·
`GET /api/calendar/day-metrics` (`:2785`) · `GET /api/calendar/day-metrics-batch` (`:2948`) ·
`GET /api/calendar/my-sets` (`:2987`) · `GET /api/calendar/enrichment` (`:3414`) ·
`GET /api/calendar/implied-moves` (`:3424`) · `GET /api/calendar/enrichment-batch` (`:3456`) ·
`GET /api/calendar/seen` (`:3489`) · `POST /api/calendar/seen` (`:3507`) ·
`GET /api/calendar/next-report` (`:3702`) · `GET /api/calendar/export-token` (`:3747`) ·
`GET /api/calendar/export.ics` (`:3761`) · `GET /api/calendar/report.ics` (`:3813`) ·
`GET /api/calendar/most-anticipated.png` (`:3846`) · `GET /api/calendar/sector-read` (`:3943`) ·
`GET /api/calendar/week-earnings.png` (`:4050`) · `GET /api/calendar/week-econ.png` (`:4056`) ·
`POST /api/calendar/post-week` (`:4062`).

Four admin diagnostics live in the same file: `GET /api/admin/calendar-date-integrity`
(`:2976`), `/api/admin/calendar-coverage-status` (`:3351`),
`/api/admin/calendar-enrichment-status` (`:3373`), `/api/admin/implied-sweep-status` (`:3385`).

**There is no `/api/calendar/week`.** See §1.4.

**CONFIDENCE.** 🟢 (AST-derived, not typed).

---

## 4. SERVICES INVENTORY

**OBSERVATION.** `api/services/` holds ~846 Python files: **395 at the top level** plus
18 sub-packages.

**EVIDENCE.** `ls api/services/*.py | wc -l` = 395. Sub-package file counts:
`journal_two` 206 · `pattern_engine` 110 · `screener` 42 · `catalyst` 23 · `compass_eval` 13 ·
`research` 9 · `signature` 9 · `pattern_vision` 8 · `wire` 7 · `theme_engine` 6 ·
`awareness` 4 · `ai_search_eval` 3 · `news_catalysts` 3 · `stock_brief` 3 ·
`user_playbook` 3 · `voice_prompts` 2 (+ two asset directories).
⚠️ Many `*_test.py` / `test_*.py` files live *inside* `api/services/` rather than `tests/`
(e.g. `api/services/cache_test.py`, `api/services/test_grade_ticker.py`) — which is why
`pytest.ini` sets `testpaths = tests api`, and why a runner that globs `tests/**` walks
past ~93 collectable files (the `pytest.ini` comment records this history).

### 4.1 Shared infrastructure services — the genuinely reusable layer

| Module | What it is | Why it matters to TERMINAL-NEXT |
|---|---|---|
| `api/services/cache.py` | the shared `TTLCache` singleton — thread-safe `OrderedDict`, **absolute `expires_at`** (a `get()` never extends life), LRU cap `_MAX_SIZE = 1000` as a *default* that individual instances may override | the one cache every surface uses; the per-instance override exists because `live_prices` must escape LRU pressure |
| `api/services/cache_snapshot.py` | persists the TTLCache to the volume at drain, restores at boot with the **remaining** TTL | removes cold-start latency without a readiness gate; the best latency primitive here |
| `api/services/serve_stale.py` | bounded stale-while-revalidate. Three rules: bounded by `max_age_seconds`; only **good** payloads remembered (caller supplies `good()`); rebuild synchronously past the bound | only 5 call sites today (`routers/{calendar,signature,wire}.py`, `services/{implied_move,setup_grade}.py`) — under-adopted relative to its value. Its docstring carries the measurement that motivated it: `/api/calendar` at 4.5s and 8.0s on the two TTL-expiry polls out of 40, 0.12s on the rest |
| `api/services/cache_policy.py` | `set_by_completeness()` — a partial fetch is still SERVED but gets the **short** TTL and never reaches a persistent store | stops a provider outage from being cached as truth for hours |
| `api/limiter.py` | slowapi `Limiter(key_func=client_ip)` | keyed on `api/services/request_ip.client_ip` (CF-Connecting-IP), **not** `get_remote_address` — behind Cloudflare that would make every user share one bucket |
| `api/services/source_circuit_breaker.py` | per-source rolling-1h pass-rate breaker (≥20 attempts, <95% ⇒ `degraded`, auto-recovers) | generic, provider-agnostic |
| `api/services/yf_util.py` | **the yfinance chokepoint** — one pool, one hard deadline, one `YFRateLimitError` breaker (silent while tripped) | the fix for the 2026-07-01 anyio-pool exhaustion; replaced three separate pools |
| `api/services/feature_flag_index.py` | every gate the code reads, **derived by AST** (`os.getenv`, `os.environ.get`, `os.environ[...]`, and the `(getenv(x) or "1")` idiom) | 973 env names measured 2026-08-30; ledger rail `tests/test_feature_flag_ledger.py`, Railway diff `tools/flag_ledger_audit.py` |
| `api/services/provider_coverage_monitor.py` | per-FIELD **fill-rate** monitor + bounded self-heal + alert-on-change | built after two Finnhub endpoints returned 403 for months behind HTTP 200s |
| `api/services/fundamentals_monitor.py` | the same detect → heal → alert skeleton, one surface earlier | |
| `api/services/wire/coverage.py`, `coverage_monitor.py` | "did every notable reporter make the feed?" — a pure `assess` plus an I/O `build_coverage` | the denominator discipline is reusable (a reporter without published actuals is `scheduled_not_reported`, never `missing`) |
| `api/services/scheduler_lock.py` | `fcntl.flock` advisory lock; **no-op grant on Windows** | the reason only one process schedules |
| `api/services/readiness.py` | warm-gate snapshot behind `/api/ready` | must never gate a deploy |
| `api/services/vendor_socket_guard.py` | blocks local runs from opening vendor sockets | why a local backend is safe to run |
| `api/services/memory_probe.py` | wraps `scheduler.add_job` to attribute RSS growth per job | added after a 1,497 MB → 6,134 MB RSS jump between two samples |
| `api/services/entitlements.py` | `TOOLKITS` / `toolkit_for` / `limits_for`. One toolkit ships (`"all"`) but the lookup is real | the natural home for Terminal-Next tiering |
| `api/services/llm_timeouts.py`, `llm_batch.py`, `narrative_cost_guard.py`, `catalyst/cost_guard.py` | LLM deadlines, batching, daily USD soft/hard caps | the shared Anthropic client's `timeout=60` once broke Desk insights; that call now uses `with_options(timeout=DESK_CHAPTERS_LLM_TIMEOUT_SECS, default 300)` |
| `api/services/data_sync.py` | R2 snapshot bridge with a **newer-wins merge** (`merge_snapshot`, `sync_if_newer_merge`) | how the bars worker feeds web and the new bars-api tier |
| `api/services/disk_watchdog.py` | volume-level disk monitor naming the top consumers and their growth | detects the class, not one feature's own budget |
| `api/services/crypto_box.py` | Fernet, key-id prefixed, at-rest encryption for broker secrets | the only at-rest crypto in the backend |

### 4.2 Domain service families (representative, not exhaustive)

- **Bars / charts (~45 modules).** `bars_fetch` (3,406 ln, the fetch core), `bars_sqlite`
  (in-process write lock; context-aware `busy_timeout` — 30s on worker, 2s on web),
  `bars_disk_cache` (3 layers: memory → `/data/bars_cache` → provider), `bars_hot_tier`,
  `bars_prewarm`, `bars_reconciliation` (30-min drift correction against Polygon canonical),
  `bars_continuous_audit`, `bar_broadcaster` (per-`(sym,tf)` queue fan-out, maxsize 64,
  drop-oldest), `bar_stream` (Massive WS ingest), `bar_rollup`, `bar_quarantine`,
  `bar_validation`, `bars_split_repair`, `barspack`, `intradaypack`.
- **Journal 2.0 (206 files).** `journal_two/{db,analytics,options,coach*,broker/*,note_connectors/*}`
  — the largest single family in the repo.
- **Pattern engine (110 files).** `pattern_engine/*`, feeding the `pattern_detections`
  table that Compass tools read.
- **Screener (42).** `screener/{base_catalog (5,494 ln), scan_evaluator (2,506 ln), filters,
  snapshot_builder, scan_run}`.
- **Voice / Compass (~70 top-level `voice_*`).** Tools, prompts, memory, personas,
  hallucination audit, cost service, confidence calibration.
- **Catalyst (23).** `catalyst/{sources,scoring,tagging,selection,synthesize,store,engine,
  cost_guard,ticker_metadata}`.
- **Desk (~25 `desk_*`).** Session jobs, Zoom/YouTube clients, thumbnails, creative titles,
  insights, announce, audit.
- **Wire (7 + engine).** `wire/{coverage,coverage_monitor,detect,detector,session,store}`
  plus `api/services/engine.py` (3,068 ln), the wire_data normalizer and oldest module here.

**INTERPRETATION.** The infra layer in §4.1 is genuinely good and genuinely reusable — it
encodes roughly eight production incidents. The domain layer is where the coupling lives:
services import one another freely, and several import routers.

**CONFIDENCE.** 🟢 for the inventory; 🟡 for which of these is dormant (§11).

---

## 5. STREAMING (names and purpose only — D-05 owns behaviour)

**OBSERVATION.** **All client-facing streaming is Server-Sent Events. There is not a single
server WebSocket endpoint in this backend.** Every `websocket` occurrence under `api/` is
an *outbound consumer* (Massive / Polygon).

**EVIDENCE.** AST sweep over route handlers whose body mentions `text/event-stream`:

| Method | Path | Module::function | Purpose |
|---|---|---|---|
| GET | `/api/stream/prices` | `routers/stream.py::stream_prices` (`:165`) | live price ticks; capped at `MAX_SSE_TICKERS = 50` (`stream.py:24`) |
| GET | `/api/stream/bars` | `routers/stream.py::stream_bars` (`:329`) | developing-bar push (Massive WS → `bar_stream` → `bar_broadcaster`) |
| GET | `/api/live/massive/stream` | `routers/massive_stream_router.py::massive_stream_sse` | options tape, instant |
| GET | `/api/live/massive/curated-stream` | `…::massive_curated_stream_sse` | options tape, curated |
| GET | `/api/community/chat/stream` | `routers/community.py::chat_stream_sse` (`:1062`) | The Floor live chat; hub is `api/chat_stream.py` |
| POST | `/api/ai-search/stream` | `routers/ai_search.py::ai_search_stream` | AI Search token stream |
| POST | `/api/j2/accounts/{id}/coach/chat/stream` (+ `/confirm`, `/cancel`, `/start_onboarding`, `/redo_onboarding`) | `routers/journal_two.py` | Compass chat token streams |

Non-SSE `StreamingResponse` (byte streams, not events): `GET /api/earnings/call-audio/{ticker}`,
`GET /api/chart/{ticker}`, `GET /api/auth/admin/export-csv`.

Outbound WS consumers: `api/services/bar_stream.py::_run_websocket` (`:212`),
`api/services/realtime_stream.py::_run_websocket` (`:297`), `api/massive_ws_worker.py`.

**INTERPRETATION.** Every SSE path is on the gzip exemption list (`_is_gzip_exempt`,
`api/main.py:6710`) **except** the five `/api/j2/**/coach/chat/*` POST-SSE routes. That is
either a latent bug (GZip buffers the whole body, so no event ever flushes) or those
responses simply fall under the 1000-byte `minimum_size`. The identical class was caught
live on 2026-07-11 for the Floor chat stream, which is why the exemption list exists.

**RELEVANCE TO UCT.** A terminal wants many concurrent live surfaces. The current model is
one SSE connection per stream family, multiplexed *client-side*
(`app/src/lib/priceStreamManager.js`, `barsStreamManager.js`), against a **single-process,
in-memory** server hub — which is precisely why the web pod cannot be multi-workered.

**CONFIDENCE.** 🟢 for the inventory. 🟡 for the gzip observation (not tested).

**OPEN QUESTION (for D-05).** Do the Compass POST-SSE routes actually flush, or are they
saved only by `minimum_size=1000`?

---

## 6. AUTH AND PERMISSIONS

### 6.1 The model

**OBSERVATION.** Cookie sessions in SQLite. No JWT for user auth; no OAuth for first-party
login. OAuth exists only for third-party integrations (SnapTrade, Microsoft Graph, Notion,
Dropbox, Zoom, YouTube, Schwab).

**EVIDENCE.**
- Cookie `uct_session` → `api/services/auth_service.validate_session(...)` → `auth.db`.
- Dependencies (`api/middleware/auth_middleware.py`): `get_session_token`,
  `get_current_user` (401), `get_current_user_optional` (never raises),
  `get_current_user_with_plan`, `require_plan([...])` factory, `require_admin` (403),
  `requires_voice_access` (**402**), `is_paid_user`.
- `PAID_PLANS = {"pro","premium","lifetime"}`, plus `"comped"` and the trial window
  (`api/services/trial.py::is_paid_or_trial`). Admin always passes. `PAID_VOICE_PLANS` is a
  back-compat alias. A comment states this set is mirrored by `isPaid` in
  `app/src/context/AuthContext.jsx` — a client/server pair to keep in sync.
- TOTP exists (`api/services/totp_service.py`); its coverage was not inspected.
- Admin promotion: `ADMIN_EMAILS` → `api/routers/auth.py::ADMIN_EMAILS`, applied at boot in
  the lifespan (`UPDATE users SET role='admin' WHERE email IN (…)`) and again on
  login/signup. The role check everywhere is `user["role"] == "admin"`.
- Machine auth: **`PUSH_SECRET` bearer** (`Authorization: Bearer <PUSH_SECRET>`) for
  ingest/ops routes; **HMAC(`PUSH_SECRET`, user_id)** for the calendar iCal export token;
  Zoom webhook HMAC (`ZOOM_WEBHOOK_SECRET_TOKEN`); Stripe webhook signature; and an
  **HMAC vouch** between web and flow-worker in `api/flow_proxy.py`.

*(Variable names only, per contract. No secret value was read or recorded.)*

### 6.2 Where the checks live — and the duplication

**OBSERVATION.** Server-side permission enforcement uses **four independent mechanisms**,
and the most common one is duplicated 40 times.

1. **Middleware, prefix-matched** — `AdminGuardMiddleware` (6 prefixes),
   `CompassPaywallMiddleware` (`/api/j2/**/coach**`).
2. **`Depends(...)` in the handler signature** — the dominant idiom.
   ⚠️ **`require_paid` is defined locally in 40 separate files**
   (`grep -rln 'def require_paid' api/ | wc -l` → 40), each with its own 402 sentence.
   `api/routers/breadth_monitor.py:61-67` documents this as *deliberate*: the per-router
   copy makes "which surface refused me" answerable, and
   `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…` pins it.
   It is still 40 copies of an authorization predicate.
3. **In-handler imperative check** — e.g. `api/routers/breadth_monitor.py:76 _check_auth(request)`
   (PUSH_SECRET bearer), used 26 times in that one file. A dependency-tree sweep reports
   these as bare; they are not.
4. **Router-level `dependencies=[...]`** — **used nowhere.** Every mounted router is
   included bare.

### 6.3 A dependency sweep, honestly reported

**OBSERVATION.** Of **1,211** route handlers scanned by AST across `api/routers/*` and
`api/*.py` (a superset that includes unmounted files), **320 carry no auth-shaped
`Depends` in their signature**. The heaviest files are `api/main.py` (44),
`routers/breadth_monitor.py` (34), `routers/calendar.py` (17),
`routers/desk_zoom_webhook.py` (17), `live_massive_router.py` (17), `schwab_router.py` (16).

**INTERPRETATION — this is a SIGNAL, NOT A VERDICT.** Spot-checking dissolves most of it:
breadth_monitor's 34 are PUSH_SECRET-checked in-handler; desk_zoom_webhook's 17 are
HMAC-verified; main.py's 44 are largely `AdminGuardMiddleware`-covered admin ops or
deliberately-anonymous status routes. Reporting the raw 320 as "unauthenticated" would be
exactly the false alarm that got the 2026-07-27 flow audit ignored (it flagged 56 proxy
forwarders as ungated, and four genuinely ungated mutating routes then sat for weeks).

The repo already owns the right tool for this question: **`api/auth_surface_check.py`**,
which runs at boot on both pods and inspects the **live route objects**, because "gated in
git" and "gated in production" are different facts when routes are proxied — and because
*probing a mutating endpoint to test auth once executed a real production job (8,108
contracts captured) during the audit that discovered the problem.*

### 6.4 Endpoints that look unauthenticated and are

**OBSERVATION (verified individually).** `GET /api/calendar`
(`api/routers/calendar.py:2001 get_calendar`) takes **no auth dependency at all**, does no
in-handler check, is mounted bare, and is matched by no middleware prefix. It returns the
full merged weekly earnings + econ payload.

**EVIDENCE.** `api/routers/calendar.py:34 router = APIRouter()` — no `dependencies`;
`api/main.py:7039 app.include_router(calendar_router.router)`; the handler signature is
`(week: str | None = None, full_impact: bool = False)`. CONFIRMED in source; **NOT probed
in production** (the single permitted production call was spent on `/api/health`).

**INTERPRETATION.** Calendar is **not** in the documented `FREE_PAGES` set (Dashboard,
Breadth, Charts, Options Flow, Journal, Model Book — CLAUDE.md "Auth & User System"), so
the *page* is paywalled in the SPA while its *primary payload endpoint* is open. This is
product data, **not** per-user member data — I found no anonymous route returning another
user's records. 17 of `calendar.py`'s 27 handlers likewise carry no signature dependency;
I verified only `GET /api/calendar`, so the remainder is NOT DETERMINED.

The same shape was already found and fixed once, in a neighbouring product:
`api/routers/breadth_monitor.py`'s docstring records that **every breadth read was
anonymous until 2026-08-09**, including `…/drill/{metric_key}`, which names the actual
tickers behind a breadth cell.

**RELEVANCE TO UCT.** If TERMINAL-NEXT is a paid product, its entitlement model cannot be
inherited — it has to be *stated*, once, in one place. `api/services/entitlements.py` is
the only module in the repo that looks like that place.

**CONFIDENCE.** 🟢 that `GET /api/calendar` is unauthenticated in code.
🟡 that this is deliberate — no comment says either way, and some of the calendar family
(`.png`, `.ics`, `export-token`) is clearly designed to be shareable.

**RECOMMENDATION.** Before any Terminal-Next design depends on it, run
`api/auth_surface_check.audit_routes` against the real app in a sandbox and treat its
output — not a grep, not this report's 320 — as the auth inventory.

**OPEN QUESTION.** Is `GET /api/calendar` intentionally public, or is it the same oversight
class as breadth-before-2026-08-09?

### 6.5 Two smaller notes

- `CORSMiddleware(allow_origins=["*"])` sits alongside cookie auth (`api/main.py:6706`).
  Browsers refuse credentialed cross-origin requests to `*`, so this is probably harmless
  in practice, but it means any origin can call every unauthenticated route.
- `MaintenanceMiddleware` state is a **module global** (`api/main.py:151`), not persisted —
  a redeploy silently clears maintenance mode.

---

## 7. CACHING AND STALENESS

**OBSERVATION.** Seven distinguishable layers, with no single policy over them.

| # | Layer | Where | TTLs / bounds |
|---|---|---|---|
| 1 | Process TTLCache singleton | `api/services/cache.py` | absolute `expires_at`; LRU `_MAX_SIZE = 1000` default, per-instance overridable. `live_prices` has its **own** instance to escape LRU pressure (`live_px1_{TK}`, 15s) |
| 2 | Cache snapshot on the volume | `api/services/cache_snapshot.py`, `CACHE_SNAPSHOT_ENABLED` | restore at boot with *remaining* TTL; save at drain; plus a periodic `cache_snapshot_save` job |
| 3 | Serve-stale wrapper | `api/services/serve_stale.py` | bounded `max_age_seconds`; only `good()` payloads retained; 5 call sites |
| 4 | Completeness policy | `api/services/cache_policy.py::set_by_completeness` | a partial gets the short/failure TTL and never reaches a persistent store |
| 5 | Disk caches on `/data` | `bars_disk_cache` (`/data/bars_cache`), `ticker_meta_cache`, `ticker_logos`, `voice_audio_cache`, `discord_chart_cache`, `bar_quarantine_cache` | see the conflict noted in §11.4 |
| 6 | SQLite stores acting as caches | **54 distinct `*.db` filenames** referenced under `api/` | `bars.db`, `auth.db`, `flow.db`, `cot.db`, `screener.db`, `catalysts.db`, `tweets.db`, `education.db`, `desk.db`, `community.db`, `modelbook.db`, `breadth_*.db`, `research_ratings.db`, `provider_coverage.db`, `implied_moves.db`, `user_definitions.db`, `wire_feedback.db`, `earnings_wire.db`, `signal_ledger.db`, … |
| 7 | HTTP / Cloudflare edge | response headers | `/assets`, `/fonts`: `public, max-age=31536000, immutable, no-transform` (`_ImmutableStaticFiles`, `api/main.py:9212`). Flow: `public, max-age=0, s-maxage=60, stale-while-revalidate=600` (`api/flow_router.py:123`). Darkpool: `public, max-age=300, stale-while-revalidate=86400` (`api/darkpool_router.py:82`), with version routes `no-store`. `flow_summary`: `public, max-age=60`. `index.html`: `no-cache, no-store, must-revalidate` |

**INTERPRETATION.** Layers 1–4 are principled and tested. Layer 6 is where staleness
becomes invisible: a SQLite store has no TTL, so freshness is whatever its writer last
managed. That is why this repo carries **four separate freshness monitors**
(`bars_continuous_audit`, `bars_reconciliation`, `fundamentals_monitor`,
`provider_coverage_monitor`) plus `disk_watchdog`. The governing pattern is:
**detect drift continuously and self-heal, rather than prevent it.**

**RELEVANCE TO UCT.** Any Terminal-Next latency budget lives or dies on layer 2 (cache
snapshot) and layer 7 (edge). Note that `/api/flow/data` is deliberately shaped to stay
Cloudflare-edge-cacheable: the proxy forwards the worker's already-gzipped bytes raw and
**preserves `Content-Encoding: gzip`** so web's GZip middleware skips re-compressing and
the buffered response keeps a `Content-Length` (`api/flow_proxy.py:68-73`). That is the
only place in the backend where CDN cacheability is treated as a first-class design
constraint, and it is the model to copy.

**CONFIDENCE.** 🟢 for the layers; 🟡 for specific TTL numbers (documented values conflict).

---

## 8. RATE LIMITING, RETRIES, CIRCUIT BREAKERS, WATCHDOGS

### 8.1 HTTP rate limiting

**OBSERVATION.** slowapi is wired but **barely used**: 38 `@limiter.limit(...)` decorations
across **6 files** — `routers/{auth,earnings,transcripts,voice,waitlist}.py` and
`services/transcripts.py`. Buckets observed: `3/minute` ×6, `5/minute` ×7, `8/minute`,
`10/minute` ×8, `20/minute`, `30/minute` ×5, `60/minute` ×8, `120/minute`, `180/minute`.

**EVIDENCE.** `api/limiter.py` is nine lines and keys on `client_ip`
(CF-Connecting-IP / X-Forwarded-For) rather than `get_remote_address`, because behind
Cloudflare→Railway the peer address is the same edge IP for every user — which would make
the login/signup limits one global bucket.

**INTERPRETATION.** Roughly 1,150 of 1,187 routes have **no HTTP rate limit**. Protection is
applied instead at the *provider* boundary (below) and by caching. That has held for a
member product with a browser client; it would not hold for a terminal with programmatic
clients or an API key.

### 8.2 Provider budgets, breakers, pools

| Mechanism | Module | Shape |
|---|---|---|
| Finnhub process-wide budget | `api/services/finnhub_client.py` | one 60/min account budget shared by REST **and** WS reconnects; `fh_ws_reconnect_allowed()` makes WS **yield first**; `fh_budget_denied_total()` counts shedding. Explicitly documented as process-local — a multi-process deployment would need a DB- or Redis-backed budget |
| yfinance chokepoint | `api/services/yf_util.bounded_call` + `yfinance_pool.py` | one pool, hard `Future.result(timeout=…)`, `YFRateLimitError` circuit breaker with cooldown (returns the default without touching the network *and without logging* while tripped) |
| Per-source pass-rate breaker | `api/services/source_circuit_breaker.py` | rolling 1h window, ≥20 attempts, <95% pass ⇒ `degraded`, auto-recovers |
| Massive request valve | `api/routers/live_prices.py` | `Semaphore(6)` plus a herd-collapse re-check over a shared per-ticker cache |
| SnapTrade | `journal_two/broker/{rate_limit,snaptrade_client}.py` | global token bucket; sync SDK via `asyncio.to_thread`; typed errors (`SnapNotConfigured`, `SnapAuthError`, `SnapUserSecretInvalid`, `SnapRateLimited`, `SnapTransient`) |
| LLM cost caps | `catalyst/cost_guard.py`, `narrative_cost_guard.py`, `llm_timeouts.py`, `llm_batch.py` | daily USD soft/hard caps; per-call timeouts |
| SSE subscription cap | `api/routers/stream.py:24` | `MAX_SSE_TICKERS = 50` |

### 8.3 Watchdogs

| Module | Watches | Action |
|---|---|---|
| `api/event_loop_watchdog.py` (467 ln) | event-loop lag, from an **OS thread** so it survives a wedged loop (`WATCHDOG_CHECK_SEC` 5s, `WATCHDOG_WEDGE_SEC` 30s, measured via `loop.call_soon_threadsafe`) | on a sustained wedge, **kills the process** *when armed*, so `restartPolicyType: ALWAYS` recovers. The only auto-recovery mechanism in the system — Railway restarts a container only on process exit |
| `api/flow_watchdog.py` (274 ln) | flow.db `MAX(id)` progress, from outside the consumer's own loop | force-exit on a true **freeze**; deliberately does nothing on **lag** (a restart makes lag worse). Only 09:45–15:55 ET Mon–Fri, and only if the newest row is from today |
| `api/services/disk_watchdog.py` (252 ln) | total `/data` usage; names top consumers plus growth since the last check on threshold crossings | alert (built after 33 GB of unpruned gap-fill backups silently starved the tape spool for three trading days) |
| `bars_freshness_watchdog` (`worker_main.py:491`, `BARS_FRESHNESS_WATCHDOG_ENABLED`) | prewarmer liveness | alert |
| `_start_thread_burst_watch` (`api/main.py:1274`) | thread-count bursts | self-logging (2026-06-09 thread-exhaustion incident) |
| `bars_continuous_audit._run_5min_check` | hot-set intraday staleness | `chart_health_alerts.emit('intraday_hotset_stale', …)`; the universe long tail is logged, not alerted, to avoid permanent-red |

**INTERPRETATION.** The watchdog philosophy is consistent and unusual: *the guard must not
be able to die with its patient.* Both process-killing watchdogs run on plain OS threads
precisely so a wedged asyncio loop cannot take them down with it.

**CONFIDENCE.** 🟢 (source). 🔴 on whether the event-loop watchdog's kill is **armed** in
production — that is an env var I cannot read.

**OPEN QUESTION.** Is the event-loop watchdog armed today, or observe-only?

---

## 9. OBSERVABILITY

| Channel | Wiring | Notes |
|---|---|---|
| **Sentry** | `sentry-sdk[fastapi]==2.23.1`; `api/main.py:195` `sentry_sdk.init(dsn=SENTRY_DSN, traces_sample_rate=0.1, environment=RAILWAY_ENVIRONMENT)` | **conditional on `SENTRY_DSN` being set** — that it is on in production is a CLAIM, unverifiable from here |
| **stdout logging** | `logging.basicConfig` at `api/main.py:27`; `httpx`, `httpcore`, `websockets.*`, `asyncio`, `uvicorn.access` forced to WARNING (`:35`) | mirrored in `worker_main.py` because Railway tags all worker stderr as `severity=error`, making a 200-OK firehose look like an error flood |
| **`print()` startup fingerprints** | **391 `print(` calls in `api/main.py` alone** | the de-facto boot trace, `[startup] …` / `[shutdown] …`. Grep-verifiable fingerprint lines exist for the chart realtime mode and the bars-push rail; one of them interpolates a value at boot rather than hardcoding it, after a hardcoded copy went stale for three weeks |
| **Discord alerts** | `api/services/discord_notify.py` imported by **16** modules; `chart_health_alerts.py` by **12** | webhooks include `DISCORD_WEBHOOK_URL`, `DISCORD_TSDR_WEBHOOK_URL`, `COT_WEEKLY_DISCORD_WEBHOOK_URL`. Standing rule: blank the webhook variable, never remove it |
| **`api/deploy_log.py`** | intended to record every web boot to `/data/deploy_log.jsonl` | ⛔ **DEAD — see §11.1** |
| **Anonymous status endpoints (by design)** | `/api/watchdog/status`, `/api/admin/bars-stream-status`, `/api/admin/reconciliation-status`, `/api/admin/fundamentals-health`, `/api/admin/twitter-stats`, `/api/admin/catalyst-stats`, `/api/massive/status`, `/api/desk/sessions-status` (PUSH_SECRET) | counters only; re-verified clean in the 2026-08-09 sweep |
| **Boot-time auth audit** | `api/auth_surface_check.py` | inspects live route objects on both pods at startup; touches no handler, sends no request |
| **Memory attribution** | `api/services/memory_probe.instrument_scheduler` | per-job RSS delta, wrapped around `add_job` before any job is registered |
| **Down-alert monitor** | `worker_main._down_alert_decision` | the worker pings web `/api/health` and posts red/green to Discord (`DOWN_ALERT_ENABLED`) |
| **Pipeline audit** | `api/services/desk_session_audit.py` + a 09:00 ET job | re-reads the **artifacts** (the `edu_videos` row, the announce ledger) rather than a counter, because an in-memory failure streak resets on every redeploy |

**INTERPRETATION.** There is **no metrics system** (no Prometheus, StatsD or OpenTelemetry)
and **no structured log format**. Observability is `print()` + Discord webhooks + a family
of hand-built status endpoints. That has worked because one person operates it; it does not
survive a second operator or any latency/uptime commitment.

**RELEVANCE TO UCT.** If TERMINAL-NEXT carries any performance promise, the observability
gap is a larger blocker than the architecture. Sentry is already installed; structured
request logging plus a per-route latency histogram is the cheapest first step.

**CONFIDENCE.** 🟢 for wiring; 🔴 for whether `SENTRY_DSN` is set in production.

---

## 10. PARTNER-OWNED FILES (existence, mounting, two-line boundary)

All four exist and are read-only for this program.

| File | Lines | Mounted? | Boundary (two lines) |
|---|---:|---|---|
| `api/schwab_router.py` | 883 | **Yes** — `api/main.py:7038` | Serves `/api/schwab/*` (21 routes): OAuth redirect handling, quotes, option chains, and the Yahoo-backed `POST /api/schwab/earnings`. Gates on the shared `api/flow_admin_auth.{require_flow_admin,require_flow_user}` and delegates data work to `api/schwab_service.py` plus `api/uw_service.py`. |
| `api/live_massive_router.py` | **7,014** | **Yes** — `api/main.py:7111` | Serves `/api/live/massive/*` (35 routes): reads the OPRA consumer's flow.db output for the Live Flow page. Under `FLOW_READS_PROXY_ENABLED=1` these paths are intercepted by `flow_proxy` and forwarded to the flow-worker, so web's frozen local copy is never consulted. |
| `api/massive_ws_worker.py` | 3,909 | n/a (not a router) | The Massive OPRA WebSocket consumer: one dedicated thread with its own asyncio loop, guarded by `acquire_scheduler_lock()`, writing aggregated SWEEP/BLOCK events into flow.db. Its `stop()` is called from the lifespan shutdown so the OPRA connection slot is released cleanly within the drain window. |
| `api/massive_processor.py` | 698 | n/a (pure logic) | Aggregates raw OPRA trades into BBS-format events — `TradeAggregator` for the streaming path, `batch_process()` for flat files. Explicitly no I/O, which is what makes it the one straightforwardly testable piece of the flow ingest chain. |

A **non-partner** one-line change landed in `api/live_massive_router.py` on 2026-09-01
(a duplicate `_parse_mdy` definition deleted, now guarded by
`tests/test_no_shadowed_definitions.py`); CLAUDE.md carries a note addressed to the
partner. Recorded here only so nobody re-reports it as new.

**CONFIDENCE.** 🟢.

---

## 11. CODE HEALTH

### 11.1 Dead modules (zero importers anywhere in the worktree)

**EVIDENCE.** Every `api/*.py` module cross-referenced against every `.py` file in the
worktree. **11 of 96 top-level modules have no importer at all:**

| Module | Size | Verdict |
|---|---|---|
| `api/flow_router_RESTORE.py` | 388 ln / 17 KB | **DEAD.** A verbatim older copy of `flow_router.py` — same route paths, same headers, same `Cache-Control` constants. A backup checked into the import path. |
| `api/main_py_additions.py` | 20 ln | **DEAD.** A snippet file; the name says it. |
| `api/deploy_log.py` | 97 ln | **DEAD *and* it makes a false claim.** Nothing imports it, so nothing ever writes `/data/deploy_log.jsonl`; and its docstring says *"Read via GET `/api/admin/deploy-log`"* — **that route exists nowhere** (`grep -rn "deploy-log" api/` returns only the docstring). The module was written to *measure whether the flow-worker cutover was worth its cost* ("we instrument before we pay") and was never wired, so the decision it existed to inform was made without it. This is `lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run` in its purest form. |
| `api/hypothesis_sheet.py` | 17.6 KB | **EXPERIMENTAL.** A one-off falsification sheet for the 7/7 OPRA comparison. |
| `api/uw_live_flow.py` | 9.6 KB | **DORMANT.** (Its sibling `api/uw_service.py` *is* live — imported by `schwab_router.py`.) |
| `api/build_patches.py`, `build_cancel_patches.py`, `build_gap_fill_csv.py`, `generate_patches.py`, `backfill_side_heal.py` | 7–13 KB each | **ONE-OFF SCRIPTS** living inside the app package (see §11.2). |
| `api/test_j2_attachments_backup.py` | 9.5 KB | a test file in the app package. |

`api/earnings_router.py` (174 ln) is a twelfth case: it *is* imported, but only by the two
tests that keep it unmounted. It is the one live row in CLAUDE.md's "DOCUMENTED BUT
UNREACHABLE" table, and that row remains accurate.

Also present and mounted but easy to misread: `api/flow_router_mount.py` (63 ln) is **not**
mounted on web — it is imported by `flow_worker_main.py` and `worker_main.py`, which is
correct.

### 11.2 146 MB of one-off operational data committed inside the app package

**OBSERVATION.** `api/` contains **24 non-code data files**: 14 `fill-*-{stocks,indexes}.csv`
and 10 `patches-*.json`, dated 6-24 through 7-10, totalling **146 MB**
(`du -ch api/*.csv api/*.json` → `146M total`; the largest single file,
`api/patches-7-2.json`, is **8.8 MB**).

**EVIDENCE.** `git ls-files api/patches-7-2.json api/fill-7-2-stocks.csv` returns both, so
**they are tracked in git** — not gitignored runtime artifacts. They are the inputs to the
five dead `build_*` / `apply_*` / `backfill_*` patch scripts above.

**INTERPRETATION.** Every clone, every worktree, every Railway build context and every
resulting image layer carries 146 MB of month-old options back-fill data that no running
code reads. It inflates build time and image size on all four services, and it sits inside
the directory the flow-worker watches for deploy triggers.

**RELEVANCE TO UCT.** Not a correctness risk, but it is the clearest measurable statement
of the repo's hygiene ceiling, and it is a trivially reversible win ahead of any
Terminal-Next build-pipeline work.

**RECOMMENDATION.** Move to `tools/one-off/` and gitignore, or delete (git history retains
them). Confirm first that nothing in the flow-worker's watch list depends on their presence.

### 11.3 Duplication

- **`require_paid` × 40 files** (§6.2) — deliberate and test-pinned, not an accident, but
  still 40 copies of an authorization predicate.
- **`api/liveflow_worker.py` (3,496 ln) vs `api/liveflow_worker_threaded.py` (186 ln)** —
  **both live, both imported.** `_threaded` is the thin thread wrapper that owns `stop()`
  (called from the lifespan shutdown, `api/main.py:6640`); `liveflow_worker` is the
  implementation, imported by nine modules. This is a wrapper + core pair, not a duplicate;
  the naming is what makes it read as one, which is why it appears on the contract's
  suspect list.
- **`api/flow_router.py` vs `api/flow_router_RESTORE.py`** — a real duplicate (§11.1).
- **`_process_rss_mb()`** duplicated verbatim in `api/main.py:6749` and `api/worker_main.py`
  — **deliberately**, with a comment: `worker_main` must not import `api.main`, which
  builds the entire web app at import time.

### 11.4 Second-authority-over-one-value instances found

1. **Start command.** `nixpacks.toml [start] cmd` is a *bare* uvicorn line with no
   entrypoint dispatcher and no `--timeout-graceful-shutdown 5`; `railway.json`'s
   `startCommand` carries the real one. If the nixpacks line ever wins, the four-way
   dispatcher and the graceful-shutdown bound both vanish silently — and CLAUDE.md's
   invariant ("`exec` in both branches + `--timeout-graceful-shutdown 5` +
   `drainingSeconds: 30` are a unit") is stated about `railway.json` alone.
2. **Bars disk-cache TTLs.** CLAUDE.md states `D=48hr, W=72hr, 60m=8hr, 30m=4hr, 5m=2hr`;
   `api/services/bars_disk_cache.py`'s own header says the disk layer "persists **4-8
   hours**" and that TTLs are "sized so the background refresh loop (32hr full cycle) can
   complete a full pass before ANY entry expires". Both cannot be the authority.
   **Read the constants in the module.**
3. **`deploy_log.py`'s endpoint** (§11.1) — a documented route with no implementation.
4. **`PAID_PLANS`** in `api/middleware/auth_middleware.py` is mirrored by `isPaid` in
   `app/src/context/AuthContext.jsx` (the comment says so). Two copies of the paid-plan set.

### 11.5 Largest modules and where the churn is

| Lines | File |
|---:|---|
| 9,328 | `api/main.py` |
| 7,014 | `api/live_massive_router.py` *(partner)* |
| 5,494 | `api/services/screener/base_catalog.py` |
| 4,121 | `api/services/voice_tool_impls.py` |
| 4,078 | `api/routers/calendar.py` |
| 3,909 | `api/massive_ws_worker.py` *(partner)* |
| 3,626 | `api/services/ast_interpret.py` |
| 3,496 | `api/liveflow_worker.py` |
| 3,406 | `api/services/bars_fetch.py` |
| 3,193 | `api/routers/ai_search.py` |
| 3,068 | `api/services/engine.py` |
| 2,635 | `api/routers/journal_two.py` |

**Churn, last 90 days** (`git log --since="90 days ago" --name-only -- api/`, commit-touch
counts): `api/main.py` **330** · `live_massive_router.py` 165 · `massive_ws_worker.py` 67 ·
`flow_worker_main.py` 60 · `routers/ai_search.py` 57 · `routers/calendar.py` 51 ·
`routers/journal_two.py` 50 · `services/discord_interactions.py` 47 ·
`services/bars_fetch.py` 47 · `services/ast_interpret.py` 47 ·
`services/screener/filters.py` 46 · `routers/modelbook.py` 46.

**INTERPRETATION.** `api/main.py` is touched in roughly a third of a thousand commits per
quarter. It is simultaneously the app factory, the middleware stack, the scheduler, the
thread supervisor, ~30 admin-ops handlers and the SPA server. **It is the highest-conflict
file in the repository and the single thing most likely to break a Terminal-Next merge.**

**CONFIDENCE.** 🟢 (all measured).

---

## 12. SEAMS FOR A TERMINAL-NEXT SERVICE LAYER

Three real seams exist. Everything else is coupling.

### 12.1 `api/bars_api_main.py` — the split-a-tier-off template (the best seam)

292 lines, one day old, and it does the thing correctly: it **shares the serve core**
(`api.routers.bars.serve_bars`, `serve_bars_history`) with the monolith so the two cannot
diverge; it installs its data snapshot from R2 **synchronously in `main()` before uvicorn**
so the 600s startup-healthcheck grace covers it and there is no live `/api/health` to
starve; and it runs no warmers, no market socket and no scheduler. Its header records both
traps it survived. If TERMINAL-NEXT needs its own process, this is the pattern.

### 12.2 `api/flow_proxy.py` — the transparent-forwarding template

Explicit catch-all routes per prefix (**not** a `BaseHTTPMiddleware` — that buffers bodies
and mishandles streamed responses), registered **ahead of** the local routers so they win
on first match, HMAC-vouched between pods, SSE-passthrough, and **honest on failure**: when
proxying is on, an upstream error returns **502 rather than a silently-stale local answer**.
It preserves `Content-Encoding: gzip` end-to-end specifically to keep the response
Cloudflare-edge-cacheable. Nine prefixes; `register_on(app)` returns a boolean so the mount
is observable in the boot log. This is how a Terminal-Next service can be introduced behind
the existing origin with zero client change.

### 12.3 The infrastructure services of §4.1

`cache` + `cache_snapshot` + `serve_stale` + `cache_policy` + `source_circuit_breaker` +
`yf_util` + `entitlements` + `feature_flag_index` form a coherent, tested, domain-neutral
layer that a new service can import directly. They are the most valuable code in `api/`.

### 12.4 What is NOT a seam

- **`api/services/engine.py`** (3,068 ln) — the wire_data normalizer every dashboard tile
  reaches data through. It has a local-dev filesystem fallback (`UCT_INTEL_PATH`, and a
  `../../../morning-wire` resolution) plus a production push path. Reusable only by
  importing the monolith.
- **`api/main.py`'s ~30 admin-ops routes** — business logic living in the app factory.
- **The scheduler.** 143 jobs in one **in-memory** APScheduler jobstore, inside the
  user-facing process, behind a `/tmp` flock. There is no job durability: a restart loses
  every pending run, and single-instance assumptions are load-bearing in at least the
  awareness engine (`max_instances=1`, regime read-then-append) and broker sync
  (per-account `asyncio.Lock`, poll and refresh dedup dicts).

**RECOMMENDATION (ranked, for the architecture roles).**

1. **Add the `/api/{_:path}` 404 immediately before the SPA catch-all** (§1.4). Smallest
   change, largest reduction in "is this shipped?" ambiguity, and a precondition for any
   client that negotiates capabilities.
2. **Build the TERMINAL-NEXT backend as a new process** on the `bars_api_main` template,
   fronted on `web` by a **`flow_proxy`-shaped forwarder**. This buys deploy isolation
   (Terminal-Next deploys never blip the options tape or the charts) while touching
   `api/main.py` in exactly one line — which matters given that file's 330-commit quarter.
3. **Import §4.1's infrastructure rather than re-implementing it**, and adopt
   `cache_snapshot` from day one: cold-start latency is the documented top user complaint
   and the readiness-gate alternative is a known outage.
4. **State entitlements once**, in `entitlements.py`, rather than inheriting the 40-copy
   `require_paid` idiom into a new surface.
5. **Do not add scheduled work to `api/main.py`'s lifespan.** It is at 143 jobs, ~34 boot
   threads, and 67 live threads on one pod.
6. **Decide the observability floor before the first endpoint ships** (§9). Today there are
   no metrics and no structured logs — only `print()`, Discord webhooks, and hand-built
   status routes.

---

## GAPS (what this budget did not reach)

- **Per-route auth verdicts.** I verified `GET /api/calendar` by hand and characterised the
  other 319 signature-bare handlers by sampling three routers. A complete answer needs
  `api/auth_surface_check.audit_routes` run against the real app in a sandbox.
- **Which flags are actually set on Railway.** Every "dark by default" statement here is a
  source-level default, not a production state. `railway variables --json` (names only) was
  not run — this contract did not authorise it. **This is the largest single ceiling in the
  report** and it affects §2, §8.3 and §9.
- **Which of the 143 jobs fired recently.** `/api/health/threads` is admin-gated and no log
  window was available. The `thread_count: 67` observation establishes the *class* of
  in-process background work, not the roster.
- **The running route table.** Not walked — importing `api.main:app` executes boot
  side-effects (DB inits, threads, seeds). All route counts are AST-derived from decorators
  and may differ from FastAPI's resolved table (conditional mounts, `flow_proxy`'s 18
  catch-alls when enabled, `include_in_schema=False` routes).
- **Per-router caching/TTL detail.** §7 lists the layers and cites the ones with stated
  numbers; a per-endpoint TTL table was out of budget.
- **`api/services/journal_two/` (206 files) and `pattern_engine/` (110 files)** were
  inventoried but not read.
- **Test-suite health.** `pytest.ini` was read (testpaths `tests` + `api`; repo-wide
  `timeout = 300`; the pytest-timeout history) but no suite was run, per the preamble.
- **Middleware and dependency latency.** The two session-reading middlewares run on the
  event loop; their cost was not measured (D-05 owns performance).

## NOT INSPECTED (and why)

- **Production pod, Railway CLI, logs.** Out of bounds. Exactly one read-only
  `GET https://uctintelligence.com/api/health` was permitted and was used (§1.3).
- **`localhost:8077`.** The preamble states a stale local backend may be listening; not
  probed, not treated as truth.
- **`C:\data`.** Real on this box; nothing under it was opened.
- **Database schemas** — D-04. I record only DB *filenames* and which subsystem owns them.
- **Provider endpoints, keys, quotas, status** — D-03. Provider modules appear here only as
  boundaries (`massive.py`, `finnhub_client.py`, `yf_util.py`, `alphavantage_client.py`,
  `perplexity_search.py`, `fmp_*`, `edgar`). No key value was read; variables are named only.
- **Performance and real-time behaviour** — D-05. Streaming appears here by name only.
- **AI internals** — D-12. `voice_*`, `coach_*`, `ai_search`, `compass_eval` are inventory
  entries only.
- **Calendar internals** — D-09. Endpoint list only (§3.3).
- **Feature-flag semantics** — D-10. `feature_flag_index.py` is described as infrastructure;
  no individual flag's meaning is interpreted here.
- **`services/chart_renderer/`** — boundary only, as scoped: a separate Railway service
  (`Dockerfile` + `app.py` + `requirements.txt`) exposing `POST /render`, a
  headless-Chromium screenshotter of the dashboard's own `/r/chart` page, existing because
  the `web` service has no browser. It returns `X-Chart-Ready` and `X-Chart-Probe` headers
  so the caller judges *what the page said it drew* rather than the pixels. Per the
  preamble it is deployed with `railway up` from its subdirectory and is claimed not to be
  git-connected — **not verified** (that would need Railway access).
- **`app/` frontend** — another role's scope; referenced only where the backend's contract
  with it is load-bearing (SPA catch-all, SSE pooling, `FREE_PAGES`, `PAID_PLANS` mirror).
- **The five `api/build_*` / `apply_*` one-off scripts' logic** — identified as dead
  (§11.1); not read.
