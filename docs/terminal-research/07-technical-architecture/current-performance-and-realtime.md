---
id: D-05
title: Current performance and real-time architecture (TERMINAL-CURRENT)
role: Performance & Real-Time Systems Engineer
wave: 1
group: D
category: internal-system
scope: uct-dashboard worktree (terminal-research) — api/, app/src/, docs/
confidence: 🟡
evidence_ceiling: No production telemetry. The one permitted GET of /api/health returned Cloudflare 502 at 06:02 UTC 2026-09-02 (see §6.1); no Railway logs, no Sentry, no CDN cache-status, no load measurement, no build. Every runtime number below is quoted from a repo artifact and labelled CLAIM unless the artifact itself records a measurement.
sources: api/routers/stream.py, api/services/bar_broadcaster.py, api/routers/live_prices.py, api/services/bars_fetch.py, api/services/bars_wal_checkpointer.py, api/main.py, api/event_loop_watchdog.py, api/flow_watchdog.py, api/flow_tape_spool.py, api/massive_stream.py, api/massive_curated_stream.py, api/chat_stream.py, api/flow_proxy.py, api/limiter.py, app/src/lib/priceStreamManager.js, app/src/lib/barsStreamManager.js, app/src/hooks/livePriceStore.js, app/src/hooks/useMobileSWR.js, app/src/pages/LiveFlowMassive.jsx, app/src/pages/optionsFlow/flowLoadPolicy.js, app/src/App.jsx, app/vite.config.js, railway.json, docs/perf-baseline.md, docs/perf-investigation.md, docs/runbooks/options-flow-cloudflare-cache.md, docs/superpowers/specs/2026-08-31-edge-deep-history.md, docs/superpowers/plans/2026-08-18-instant-origin-bars.md, docs/feature_flags.json
uct_relevance: high
status: draft
date: 2026-09-02
---

# TERMINAL-CURRENT — real-time data flow, caching, and capacity envelope

**Read this first.** The two documents this contract names as baselines —
`docs/perf-baseline.md` and `docs/perf-investigation.md` — are both dated
**2026-05-02** and pinned to commit `ba9e94e`. Four months of hardening have landed
since. Several of their headline root causes are **no longer true of the code in
this worktree** (§4.2). Treat them as a historical "before" snapshot, not as a
description of TERMINAL-CURRENT. Nothing later replaced them: there is **no current
performance baseline document in this repository**. That absence is itself the most
consequential finding for Terminal-Next (§4.4).

Vocabulary: TERMINAL-CURRENT is the surface at route `/calendar`, display-named
"UCT Terminal" since 2026-09-01. TERMINAL-NEXT is the product this program designs.

---

## 1. REAL-TIME PATHS, END TO END

### 1.1 OBSERVATION — Five live transports; only two are genuinely pushed to the browser

| # | Path | Browser transport | Server side | Fan-out unit |
|---|---|---|---|---|
| a | Options tape (Live Flow) | **SSE** (`/api/live/massive/stream`, `/api/live/massive/curated-stream`) plus a 20 s reconcile poll | Massive OPRA WebSocket → flow.db → a DB **tailer** | per-subscriber `asyncio.Queue(maxsize=500)`, drop-oldest |
| b | Quotes / live prices | **SSE** (`/api/stream/prices`) **and** a shared 2 s REST poll (`/api/live-prices`) running underneath it, always | Finnhub WS (fallback) overlaid by the Massive bar feed's last price | per-connection generator loop, 250 ms cadence |
| c | Breadth intraday | **poll only** — `/api/breadth-monitor/live`, 60 s | server-side accumulator, 55 s cache | none |
| d | Chart bars | **SSE** (`/api/stream/bars`) | Massive WS → `bar_stream.py` → `bar_broadcaster.py` | per-`(sym,tf)` `asyncio.Queue(maxsize=64)`, drop-oldest |
| e | Chat / AI Search | **SSE** (`/api/community/chat/stream`, `/api/ai-search/stream`) | in-process hub | per-connection `asyncio.Queue(maxsize=400)` |

### EVIDENCE

**(a) Options flow.** `api/massive_stream.py:1-30` — CONFIRMED by its own module
docstring: the stream is **decoupled from the OPRA write path**. A single background
tailer reads `flow.db` for `id > last_seen` every `TAIL_SEC` (default **1.0 s**,
`MASSIVE_STREAM_TAIL_SEC`), capped at `TAIL_LIMIT=500` rows per broadcast, and fans
out to subscribers — "one cheap query/sec total, independent of client count".
`MAX_SUBSCRIBERS=300` (`MASSIVE_STREAM_MAX_SUBSCRIBERS`), `_QUEUE_MAX=500` per
subscriber, drop-oldest. The curated twin is `api/massive_curated_stream.py`
(`TAIL_SEC=1.5`, same 300/500 bounds). Routes:
`api/routers/massive_stream_router.py:35` and `:71`.

Ingest is the partner-owned `api/massive_ws_worker.py` / `api/massive_processor.py`,
running on the **flow-worker** service, not on web: `api/flow_proxy.py:55-66` lists
`/api/live/massive` among `PROXY_PREFIXES`, and `FLOW_READS_PROXY_ENABLED` is
recorded **armed** in `docs/feature_flags.json`. Web forwards these reads to the
worker over Railway private networking, with an explicit SSE passthrough branch
(`api/flow_proxy.py:163-177`) because "an event-stream body NEVER ends, so the
buffered join below would hang forever + leak the held connection."

**`app/src/useFlowWebSocket.js` IS DEAD CODE.** It connects to
`ws://.../ws/live-flow` (`:34`). Grepping all of `api/` for that path returns
**zero** matches — no such server endpoint exists. Its only importer is
`app/src/LiveFlow_integration_guide.jsx` (a guide file), and
`app/src/components/screener/reachable.test.js:399` carries it as a known
exception. It still speaks of "UW upstream" (Unusual Whales), a retired provider.
**The live options page uses no WebSocket at all** — `LiveFlowMassive.jsx` uses
`EventSource` plus polling.

**(b) Live pricing.** Two mechanisms run **simultaneously**, by design:
- REST poll — `app/src/hooks/livePriceStore.js` is a singleton store. `_intervalMs()`
  is **2000 ms desktop / 4000 ms mobile** (`:33`); one poll of the **union** of every
  mounted component's tickers, chunked at **250 tickers per request** (`:21`,
  mirroring `live_prices._MAX_TICKERS`), paused on `visibilitychange` (`:134`), with
  an immediate poll when the union grows (`:152`). `useLivePrices.js` is a thin
  slice-selector over it.
- SSE — `api/routers/stream.py:165` `stream_prices()`. Per connection: **50 tickers**
  max (`MAX_SSE_TICKERS`), a **250 ms** loop (`:306` — deliberately slowed from
  100 ms; the in-file comment says the 10 Hz snapshot+diff per connection "was
  measurable pure overhead" at launch scale), a **15 s named heartbeat**, and
  `await request.is_disconnected()` on every iteration "to prevent zombie
  coroutines". The Massive last price is overlaid on the Finnhub store per tick
  (`:230-250`) because "Finnhub's free tier trickles trades out… watchlist/theme/
  header quotes looked frozen".
  Client pooling: `app/src/lib/priceStreamManager.js` unions every subscriber's
  tickers into 50-ticker buckets, rebuild debounced **400 ms**
  (`REBUILD_DEBOUNCE_MS`), initial retry **5000 ms**, plus a watchdog sweep;
  unchanged buckets keep their live connection across a rebuild (`:114`).

**(c) Breadth live.** `app/src/hooks/useLiveBreadth.js:27` — `refreshIntervalFor()`
returns **60 s** normally, **15 min** once the row is `superseded`. Server side
`api/services/breadth_live.py:1245` sets `_LIVE_TTL_SECONDS = 55`, deliberately just
under the client's 60 s so a poll costs one cheap guard. Drill lists are cached
**beside** the payload (`_live_cache["members"]`, `:1414`) and never inside it,
because the endpoint "is polled every 60s by every Dashboard user on a
single-process pod". No push transport exists for breadth.

**(d) Chart bars.** `api/routers/stream.py:329` `stream_bars()`, gated on
`STREAM_BARS_ENABLED == "1"` (recorded **armed**). Accepts `SYM:TF` pairs, TF
restricted to `1/5/15/30/60`, capped at **50 pairs** per connection. Idle floor
**250 ms** (`:395` — "deliberately slowed 100ms→250ms because every open tab holds
one of these loops on the single shared event loop"), **15 s** named heartbeat
(named, not a `:` comment, so the client watchdog can see it).
Broadcaster — `api/services/bar_broadcaster.py`: `subscribe()` returns
`asyncio.Queue(maxsize=64)` (`:91`); `_safe_put` drops the **oldest** on `QueueFull`
and increments `_bars_dropped_total` (`:372-385`); `_emit` throttles to **10 Hz per
(sym,tf)** (`_emit_throttle_ms = 100`, `:83`) for A/T events and is **unthrottled**
for AM (authoritative minute bars); dispatch is `loop.call_soon_threadsafe` so the
WS thread never touches a queue directly (`:411`). `ROLLUP_TFS = ("5","15","30","60")`
(`:42`). Status counters at `:421-434`.
Client — `useRealtimeBars.js` → `app/src/lib/barsStreamManager.js`, a **byte-separate
pool** from the price pool, `MAX_BARS_PAIRS=50`, with **hysteresis** on "delivering":
engage at `BARS_LIVE_STALE_MS=120000`, disengage only at
`BARS_LIVE_DISENGAGE_MS=150000` (`:32-37`) so a thin ticker cannot thrash
push↔Finnhub.

**(e) Other SSE.** `api/chat_stream.py:34-36` — `MAX_SUBSCRIBERS=400`
(`CHAT_MAX_SUBSCRIBERS`), `QUEUE_MAX=400`, plus an *ephemeral-message* backpressure
rule: presence/typing events are dropped once the queue is half full (`:47`).
`/api/ai-search/stream` is gzip-exempt and documented at
`api/routers/ai_search.py:2759`.

### INTERPRETATION

The architecture is **one shared uvicorn event loop holding one coroutine per open
SSE connection**, and every visible design decision is a reaction to that. Admission
control (`stream.py:26-77`), the 100→250 ms cadence slowdown, the client-side pools,
the per-`(sym,tf)` drop-oldest queues, and the 10 Hz emit throttle are the same
lesson applied five times: *bound the per-connection cost, because connections are
cheap for the browser and expensive for this pod.*

`stream.py:26-36` states the admission rationale and CONFIRMS by code that
`/api/stream/prices` and `/api/stream/bars` were **the last two streams without a
subscriber cap** — "tickers were capped at 50 per connection; connections themselves
were capped at nothing." It is now `STREAM_MAX_SUBSCRIBERS=300` per stream, with
**separate registries** for `prices` and `bars` so "a wall of chart tabs on
/api/stream/bars can never crowd out the price quotes every page depends on", and a
503 `at_capacity` refusal so the client falls back to polling.

**Freshness indicators shown to users.** The price stream emits transition-only
`stale` / `fresh` named events (`stream.py:283-296`), computed at most once per
second against `bars_liveness._STALE_THRESHOLD` — 120 s for 1 m, 600 s for 5 m,
1800 s for 15 m, 25 h for D (`api/services/bars_liveness.py:8-18`) — and intraday is
never stale while the market is closed. LiveFlowMassive names its transport in the
header ("Live stream (SSE)" vs "Refreshing every 20s", `:4902`). On charts the
indicator is *behavioural*: `delivering=false` hands the developing bar back to the
REST/Finnhub writer rather than showing a warning.

**Disconnect behaviour.** Server: `finally` blocks unsubscribe the admission token,
the tickers, and the broadcaster interest on every stream. Client: browser
`EventSource` auto-reconnects, and **both pools add a watchdog** because a proxy can
kill a stream without firing `onerror` — `LiveFlowMassive.jsx:82` names this
directly (`SSE_STALL_MS = 40000`, ">2.5x the server's 15s heartbeat so quiet markets
don't trip it"). The options page keeps rendered data on disconnect rather than
blanking.

### RELEVANCE TO UCT
Terminal-Next's likely shape — a long-lived multi-panel workspace — multiplies
exactly the quantity these caps bound. A 12-widget board in one browser today
consumes **one** price-pool connection and **one** bars-pool connection, because the
pools union and chunk. That is the single most valuable property to preserve: any
Terminal-Next panel that opens its own stream instead of joining the pool converts a
300-connection budget into a 300/N-user budget.

### CONFIDENCE
🟢 for code paths, transports, caps and cadences — all read directly.
🟡 for whether each path is *live in production*: flag states come from
`docs/feature_flags.json`, whose own `_readme` says it "records INTENT. It cannot see
Railway, so it can drift from reality."
**EVIDENCE CEILING:** no Railway variable read, no logs, no sample of
`/api/admin/bars-stream-status` (which publishes `bars_emitted_total`,
`bars_dropped_total`, `last_emit_age_s` and subscriber counts, and is documented
no-auth at `api/main.py:6830`). One read of that endpoint during RTH would confirm
or falsify "push is live" outright.

### RECOMMENDATION
Treat the pooled-client + capped-server + drop-oldest-queue triple as the inherited
contract for Terminal-Next, and make "does this panel join the existing pool?" an
explicit review question rather than an emergent property.

### OPEN QUESTION
Is `app/src/useFlowWebSocket.js` retired deliberately or forgotten? It is the only
artifact in the repo describing a client WebSocket, and a Terminal-Next designer
reading it would conclude the flow tape is push-over-WS when it is
poll-plus-SSE-over-a-proxy.

---

### 1.2 OBSERVATION — A latent gzip trap: one SSE route is missing from the exemption list

### EVIDENCE
`api/main.py:6710-6721` — `_is_gzip_exempt(path)` enumerates paths that must never be
gzip-buffered because "GZip buffers the whole body, so an event-stream never flushes
and no events reach the client (caught live 2026-07-11 on the Floor chat stream)".
It matches `/api/stream*`, `/api/live/massive/stream*`, `/api/community/chat/stream`,
`/api/ai-search/stream`, `/assets/`, `/fonts/`.

`/api/live/massive/`**`curated-stream`** — a real SSE route at
`api/routers/massive_stream_router.py:71` — **matches none of them**:
`"/api/live/massive/curated-stream".startswith("/api/live/massive/stream")` is False.

The standing guard, `tests/api/test_sse_gzip_exempt.py:8-12`, iterates a **hand-typed
tuple of five paths** and omits the curated stream too. The middleware is applied at
`api/main.py:6738` with `minimum_size=1000, compresslevel=5`.

Relevant mitigations: the flow-worker app registers **no** GZip middleware (grep for
`GZip` in `api/flow_worker_main.py` returns nothing) and the proxy streams the
upstream body raw (`api/flow_proxy.py:163-177`) — so what reaches web's
GZipMiddleware is an **uncompressed** `text/event-stream`, i.e. precisely the case
the exemption exists for. Client-side the curated stream is dark by default
(`LiveFlowMassive.jsx:66-76`: `VITE_MASSIVE_CURATED_STREAM`, or a `?curatedstream` /
localStorage escape), while the **server** flag `MASSIVE_CURATED_STREAM_ENABLED` is
recorded armed.

### INTERPRETATION
This is the repo's own most-documented defect shape — a hand-typed enumeration
sitting beside the source that owns it — reproduced in the one place where it
silences a feature without erroring. The failure mode is not an exception: it is a
stream that connects, heartbeats into a compressor buffer and delivers nothing,
while the 20 s reconcile poll quietly covers for it and the page still looks
correct. That is exactly how it could sit unnoticed while the client flag stayed
dark.

### RELEVANCE TO UCT
Any middleware that buffers is a correctness hazard for streams, and a list is not a
rail. Terminal-Next will add streams; the exemption set must be derived, not typed.

### CONFIDENCE
🟡 overall. The exemption gap and the missing test case are 🟢 (read directly).
Whether gzip actually swallows this stream in production is 🔴 — it depends on
Starlette's `GZipResponder` behaviour for streaming bodies and on the client sending
`Accept-Encoding: gzip`.
**EVIDENCE CEILING:** not reproduced; no local backend permitted. One
`curl -N -H 'Accept-Encoding: gzip'` against a non-production instance, or arming the
client flag for a single browser and watching for events, would settle it.

### RECOMMENDATION
Derive the exempt set from the routes: enumerate `app.routes` for handlers whose
`media_type` is `text/event-stream`, or tag SSE routes and assert tag ⇒ exemption.

### OPEN QUESTION
Was `curated-stream` left dark *because* it was observed to deliver nothing? If so
this is a known cause; if not, the flag may be un-armable for a reason nobody has
diagnosed.

---

## 2. POLLING INVENTORY AND SERVER-SIDE WARMERS

### 2.1 OBSERVATION — 186 `refreshInterval` sites; the fastest user-facing poll is 2 s, and four widgets poll at 2 s

### EVIDENCE
`grep -rn "refreshInterval" app/src --include=*.js --include=*.jsx | grep -v '\.test\.'`
returns **186** lines (measured 2026-09-02). By cadence:

| Cadence | Sites (endpoint) |
|---|---|
| **2 s** | `hooks/livePriceStore.js:33` → `/api/live-prices` (shared union poll; 4 s mobile) |
| **2 s** | `charts/widgets/NewHighsLowsWidget.jsx:84,222`; `NhnlPulseWidget.jsx:123`; `VolumeScanWidget.jsx:227` — comments read "feel live; server accumulates every ~2s / ~2.5s" |
| **10 s** | `tiles/FuturesStrip.jsx:183`, `tiles/MorningWireIndexes.jsx:37` (`/api/snapshot`); `calendar/useWire.js:21` |
| **12 s** | `charts/widgets/OptionsFlowWidget.jsx:196` |
| **15 s** | `tiles/MARelationship.jsx:62` (`/api/snapshot`); `tiles/JournalSnapshotTile.jsx:82`; J2 `useJ2Positions`, `useJ2OptionMarks`, `useJ2OptionStrategies` |
| **20 s** | `LiveFlowMassive.jsx:49` `POLL_INTERVAL_MS`; J2 `useJ2DisciplineState.js:22` |
| **25–30 s** | J2 broker status (`useBrokerWarming.js:14`), most dashboard tiles, `usePatternDetections`, `useWatchlistAlerts`, `useIndicatorAlerts`, community channels/spaces, `ScannerResults` |
| **30 s / 300 s** | `StockChart.jsx:4841` — intraday SWR 30 s, D/W/M 300 s |
| **30 s (reconcile)** | `LiveFlowMassive.jsx:77` `STREAM_RECONCILE_MS` when SSE is on |
| **45–60 s** | `ScatterWidget` 45 s; `AlertBell` 60 s/120 s; `NavBar` 30 s/120 s; `useLiveBreadth` 60 s; `Watchlists` 60 s |
| **2–15 min** | calendar family (`useCalendarData.js:85-207`), news 300 s, `ZoneRead` 300 s, sector rotation 900 s, theme performance 900 s |
| **1 h / 6 h** | `UCT20.jsx:348-352` (five keys at 3 600 s), `RsBadge` 3 600 s, breadth analogues 6 h |

Three global dampers exist, and **all three are opt-in** —
`app/src/hooks/useMobileSWR.js`: **×10 when the market is fully closed** (only with
`marketHoursOnly`), **×2 on mobile**, and `refreshInterval: 0` while the tab is
hidden. A bare `useSWR(..., {refreshInterval})` gets none of them. The repo polices
this in prose (`pages/dashboard/ZoneDoors.jsx:7`, `ZoneRead.jsx:22`) and with a rail
(`app/src/hooks/pollingSites.rail.test.js`). `App.jsx` mounts a global `<SWRConfig>`
(revalidateOnFocus off, 8 s dedup — CLAIM from CLAUDE.md).

`LiveFlowMassive.jsx:47-50` records its cadence as an **incident-driven regression**,
verbatim: *"20s (reverted from 5s 2026-07-08): the 5s cadence 4x'd concurrent /recent
handler builds (limit=20000 = ~34K-row responses in memory), piling up anyio workers
+ ballooning RSS → tipped the pre-existing thread burst into OOM crashes. Restore
true-instant later via SSE + a capped response, not fast polling."* CONFIRMED as a
code artifact recording a production event.

### 2.2 OBSERVATION — At least a dozen named background threads on the web pod; one exists purely to keep a user off a 25 s recompute

### EVIDENCE (all `api/main.py`, all daemon threads started in lifespan)

| Thread | Delay | Cadence | Purpose |
|---|---|---|---|
| `_start_dashboard_warm_background` (`:856`) | 20 s | one-shot | movers/themes/news/breadth/calendar after a deploy |
| `_start_scanner_warm_background` (`:1161`) | 30 s | active hours | |
| `_start_chart_renderer_warm_background` (`:820`) | 40 s | one-shot | Discord chart renderer |
| `_start_hot_tier_warm_background` (`:844`) | 45 s | one-shot | hot-tier bars |
| `_start_darkpool_prewarm_background` (`:1128`) | 60 s | one-shot | |
| `_start_calendar_enrichment_warm_background` (`:995`) | 90 s | **loop, 240 s** | keeps the current week hot under a 300 s TTL, rotating one neighbouring week per cycle |
| `_start_rs_rankings_warm_background` (`:1073`) | 120 s | loop, under the 1 h TTL | |
| industry-map warmer (`:1125`) | — | one-shot | |
| `start_screener_snapshot_warm` (`:1277`) | boot | one-shot, bounded | tops up the stalest screener rows |
| memory-prewarm (`:3630`) | boot | one-shot | Tier-1 bar series from SQLite |
| `_web_memwatch` (`:3641`) | boot | **60 s** | logs `[mem] rss_mb=… threads=…` |
| `_start_thread_burst_watch` (`:1240`) | boot | **30 s** | logs a thread histogram above `THREAD_BURST_LOG_THRESHOLD` (default 200) |
| `bars_wal_checkpointer` (`:2888`) | 30 s | **20 s** | see §3.4 |
| `call_recap` warm sweep (`:2096`) | — | cron + boot | |

`api/main.py:995-1069` is the calendar enrichment warmer, and it carries the
measurement that justifies it — CONFIRMED as a recorded production measurement:
*"Measured on prod 2026-08-08: enrichment cold **17.9 s**, warm **0.14 s**; the
whole-week batch cold **24.8 s**, warm **0.22 s**. A 130x cliff, re-armed every five
minutes."* Neighbour weeks measured *"120 reporters = **57.2 s**, 67 reporters =
**33.3 s**"*. The 240 s cycle sits under the 300 s TTL with the reason stated: *"the
margin has to exceed the compute itself (~25 s) or the entry expires while the warm
that would have refreshed it is still running, and a user walks into the gap — which
is the whole defect, reintroduced."* It also notes it adds **no** steady-state
provider load: the same compute already ran once per TTL expiry, on the request path,
inside the anyio threadpool.

`_prewarm_bars` — the permanent 5-minute in-process refresh loop that
`docs/perf-investigation.md` ranks as root cause #3 — has since moved to the
**worker** service and is supervised: `api/worker_main.py:88` `_start_prewarmer` uses
`run_prewarmer_supervised` with bounded backoff, and
`docs/superpowers/plans/2026-08-18-instant-origin-bars.md` records a
`prewarm_heartbeat`, a `daily_freshness_report` sampler, and a worker-side watchdog
that pages Discord on a dead prewarmer or a stale daily store.
`BARS_PREWARM_ENABLED` is recorded **armed**.

**PC-side task, cross-reference only.** Contract D-14's Task Scheduler listing for
2026-09-02 includes a task named **`Warm Bars Universe`**. No file in this worktree
names it; D-14 owns it. Its relationship to the web-pod warmers above is NOT
DETERMINED from this repo.

### INTERPRETATION
The polling inventory is not a flat cost — it is shaped by three gates (visibility,
market hours, mobile) that a hook must **opt into**, and by warmers that move the
expensive rebuild off the request path. Both mechanisms are correct and both are
opt-in, so the real cost of any new surface is decided by whether its author
remembered. The 186 sites are the surface area of that decision.

### RELEVANCE TO UCT
A multi-panel workspace is the worst case for opt-in dampers: N panels, each with its
own hook, several of which will legitimately want 2 s data. The existing 2 s widgets
already demonstrate the right coupling — they poll at the *server accumulator's* own
cadence, so a faster poll would return identical bytes.

### CONFIDENCE
🟢 for the inventory and the warmer list (counted and read). 🟡 for "how much traffic
this actually produces", which needs a concurrent-user number this research cannot
obtain.

### RECOMMENDATION
For Terminal-Next make the damper the default rather than the opt-in: a
`usePanelData` wrapper that cannot be constructed without a visibility gate and a
market-hours policy. `useMobileSWR` already is that wrapper; it is simply not
mandatory.

### OPEN QUESTION
What is the actual concurrent-user distribution across pages? Every cadence decision
above is reasoned from "~200 users", and nothing in the repo measures how many are
simultaneously on the two-second surfaces.

---

## 3. CACHING LAYERS AND TTLs

### 3.1 OBSERVATION — Six distinct layers, and the entry-count bound is per-instance for a measured reason

| Layer | Where | Bound / TTL |
|---|---|---|
| Browser IndexedDB (bars) | `app/src/utils/barsIDB.js` | `CACHE_LOGIC_VERSION` invalidation; intraday eviction keyed on **bar freshness** (newest bar >26 h ⇒ miss), not save time |
| Cloudflare edge | per-route headers | §3.3 |
| HTTP `Cache-Control` | per-route | §3.3 |
| In-process `TTLCache` | `api/services/cache.py` | shared singleton `_MAX_SIZE = 1000`; **`live_prices.py` owns a separate instance** |
| `ServeStale` last-good slots | `api/services/serve_stale.py` | per-key, bounded `max_keys=256`, single-flight |
| Disk / SQLite | `bars_disk_cache.py`, `bars_sqlite.py` | §3.2 |

### EVIDENCE
`api/services/cache.py:1-24` — the default LRU cap moved 500 → **1000** on
2026-07-02, and the comment records why the constant had to stop being module-wide:
read inside `set()`, it *"silently capped the DEDICATED `live_prices.cache` too — the
instance that exists specifically to escape LRU pressure. Above ~970 distinct tickers
that cache thrashed permanently (**31.7 % miss / ~3.1 k upstream fetches per 2 s poll
round at 200 users × 50 tickers**, 68.7 % and ~34 k at 200 × 250), which funnels into
`live_prices._MASSIVE_SEM` … and reproduces the launch-day 524 from a different
direction."* The class is now genuinely thread-safe (`threading.RLock`, `:56`), with
the failure modes it removes spelled out — resolving `docs/perf-investigation.md`'s
Track 2.6 finding.

`api/routers/live_prices.py:33-107` derives its own bound instead of inheriting one:
`CACHE_MAX_SIZE = _universe_size() * 2 + 1000`, where `_universe_size()` reads
`api/data/cap_universe.json` and floors at 4000 so a truncated file cannot silently
shrink the cache back into the thrash regime. TTLs: **15 s** for both the per-ticker
`live_px1_{TK}` key and the whole-set `live_prices_{md5}` key; **45 s** for
`live_exvol_{TK}`. Two whole-market close maps are held as *module state*, not cache
entries, with the reason stated: *"Two LRU slots holding ~24 k rows would be a
size-blind bound pretending to be a memory bound."*

`api/services/serve_stale.py:1-37` — the last-good-payload layer, with its own
measurement: polling `/api/calendar` every 20 s for 13 minutes on prod 2026-07-31
produced **4.51 s** and **7.97 s** on the two TTL-expiry requests and **0.12 s** on
the other 38. Its stated diagnosis is structural: *"a cache in front of an expensive
multi-provider rebuild does not protect users — it just decides WHICH user pays."*
Three rules: bounded staleness (`max_age_seconds`), only GOOD payloads remembered,
and single-flight. Consumers: `routers/calendar.py`, `routers/wire.py`,
`routers/signature.py`, `services/implied_move.py`, `services/setup_grade.py`.

### 3.2 OBSERVATION — Bars is a four-layer cache with per-timeframe TTLs and five shed-capable valves

### EVIDENCE
`api/services/bars_fetch.py:867` — in-memory TTLs, seconds:
`{'1': 5, '5': 10, '15': 10, '30': 10, '60': 10, 'D': 300, 'W': 900, 'M': 900}`.
`api/services/bars_disk_cache.py:26-31` — disk TTLs: **5 m → 2 h, 30 m → 4 h,
60 m → 8 h, D → 48 h, W → 72 h**; the deep cache has **no TTL** ("the data is
historical and doesn't expire"); empty results are never cached.

Five global semaphores bound the expensive paths (`bars_fetch.py:144-197`), each with
its incident in the comment:
- `_bg_delta_sem` = **6** (`BARS_BG_DELTA_MAX`) — background delta fetches; unbounded
  they *"starved the single async loop for seconds (all live streams froze at once)"*.
- `_deepfill_sem` = **2** (`BARS_DEEPFILL_MAX`), throttled to once per
  `(ticker,tf,depth-tier)` per **6 h**.
- `_replay_cold_sem` = **2** (`REPLAY_COLD_CONCURRENCY`), with cold replay windows
  capped at `REPLAY_INTRADAY_COLD_BARS=4000`.
- `_cold_fetch_sem` = **3** (`BARS_COLD_FETCH_CONCURRENCY`) — truly-cold provider
  fetches. CONFIRMED measurement from a real member HAR, 2026-08-19: *"**15 cold
  tickers dragged 664 warm charts to 5-20s and a /api/watchlists call to 18s**"*. Over
  cap, the request **sheds a fast 503 + Retry-After** instead of holding a thread ~20 s.
- `_warm_serve_sem` = **6** (`BARS_WARM_SERVE_MAX`) — best-effort prefetch serves shed
  instantly so a real click never queues behind a theme-flood warm. *"The click's own
  request never sheds."*

Elsewhere: `routers/calendar.py:3004` `_ENRICH_SEMAPHORE = Semaphore(2)`;
`live_prices.py:94` `_MASSIVE_SEM = Semaphore(6)` with `_SEM_WAIT_S = 8.0` and
`:219` `_EXVOL_SEM = Semaphore(4)`; `routers/signature.py:1025` a bounded cold lane;
`live_massive_router.py:2017` `_recent_fill_sem` (partner-owned, noted not described).

### 3.3 OBSERVATION — HTTP/CDN caching is deliberate, and the highest-value rule is documented as NOT APPLIED

### EVIDENCE
- Hashed assets: `api/main.py:9212-9223` `_ImmutableStaticFiles` sets an immutable
  `Cache-Control` on `/assets` and `/fonts`.
- **Sealed chart history — the best idea in this codebase's perf work.**
  `api/routers/bars.py:640-654`: when the client's `?d=` matches the current sealed
  boundary the response is `public, max-age=31536000, immutable`; otherwise
  `public, max-age=3600, stale-while-revalidate=86400`. *"The date makes each day's
  URL unique: when a new trading day seals, the client … request a NEW d → a NEW URL,
  so the cache self-refreshes with NO purge."* Recent corrections are covered by the
  always-fresh `/api/bars` tail the client merges over the history.
- Live bars: `bars_fetch.py:1709` `public, max-age={_CACHE_TTL[tf]}`.
- Uncacheable by intent: `bars.py:505,543,592` `no-store, must-revalidate`.
- Legacy CSV routes: `api/main.py:7262-7275` `_CSV_CACHE_HEADERS` =
  `public, max-age=300, stale-while-revalidate=86400` + `Vary: Accept-Encoding`.
- GZip: `api/main.py:6738`, `minimum_size=1000`, **`compresslevel=5`** — the comment
  records that level 9 *"burns materially more CPU per request on the single shared
  event loop for a <3 % size gain"* on the ~1.4 MB deep-bar payloads.

**`docs/runbooks/options-flow-cloudflare-cache.md` — its status line reads "rule NOT
yet applied."** Measured on prod 2026-07-25: `GET /api/flow/data?days=1` returns
**12.4 MB gzipped**, `cf-cache-status: **DYNAMIC**` (Cloudflare caches nothing),
`age: null`, origin **386 ms warm → 3 643 ms cold**, rebuilt from a **2.7 GB /
2.1 M-row** SQLite by the first member in each 60 s version bucket — *"A lone user is
always that member."* Expected result of the rule: **~50 ms edge hit** for every
member after the first in each 60 s window, globally. The runbook carries three named
damage cases; the first ("never enable Ignore Query String") would serve a 1-day
payload to a 20-day request and one member's calendar range to another. Rollback is
disabling the rule — no deploy.

### 3.4 OBSERVATION — The freshest performance finding in the repo is dated TODAY and is a SQLite WAL problem

### EVIDENCE
`api/services/bars_wal_checkpointer.py:1-36`, dated **2026-09-02**: *"First-view of an
obscure long-tail chart was measured at **0.3–6.8 s** and HIGHLY variable, while
`last_ts` on the same table/connection stayed **<50 ms**. Phase timing localised the
entire cost to `bars_sqlite.get_bars` — the read of the OHLCV rows — not the provider
fetch and not the query."* Diagnosis: **WAL bloat**. The web pod does continuous
background **writes** into `bars.db` (the R2 newer-wins merge, barspack web-ingest,
stale-swr background delta heals, reconciliation deletes), and SQLite's default
autocheckpoint cannot keep up, so every reader walks an ever-larger WAL index —
*"A big WAL turns a 5 ms read into a multi-second one, and the size of the WAL at the
instant of the read is why it is so variable."*
Fix: a dedicated thread running `PRAGMA wal_checkpoint(PASSIVE)` every
`BARS_WAL_CHECKPOINT_SECONDS` (default **20 s**, after a 30 s startup delay), with an
opportunistic TRUNCATE above `BARS_WAL_CHECKPOINT_TRUNCATE_FRAMES` (default **2000**
frames ≈ 8 MB at 4 KB pages) only when it would not block. PASSIVE by default because
it *"cannot block a request or the background writers"*. Every cycle logs
`(busy, wal_frames, checkpointed_frames)` so the fix is falsifiable in prod logs.
Wired at `api/main.py:2888-2899`; gated `BARS_WAL_CHECKPOINT_ENABLED` (code default
1); **absent from `docs/feature_flags.json`**.

### INTERPRETATION
Caching has moved from "one global TTLCache and hope" (the May baseline) to a layered
system where each layer states its own bound and cites the incident that set it. Two
things stand out for Terminal-Next:

1. **The `?d=`-keyed immutable history URL** converts a mutable resource into an
   immutable one by naming the trading day, which makes CDN caching purge-free. It is
   directly reusable for any Terminal-Next historical series.
2. **The highest-leverage caching win is unclaimed and is not a code change.** A
   documented, reversible, zero-deploy Cloudflare rule that turns a 386–3 643 ms
   origin build into a ~50 ms edge hit has sat unapplied since 2026-07-25, with the
   client-side prerequisite (`baseFetchUrl`'s versioned refresh) already shipped.

The "bump BOTH cache layers" hazard the contract names (earnings modal) is the general
shape here: a value memoised at more than one layer, where refreshing one leaves the
other authoritative. `_ENRICH_TTL` (300 s, warmed at 240 s) sitting above per-provider
caches is the live instance of it.

### CONFIDENCE
🟢 for TTLs, bounds and headers (read directly). 🟡 for the Cloudflare rule's status —
the runbook says not applied, but a runbook is a CLAIM and the rule may have been
applied without the doc being updated.
**EVIDENCE CEILING:** one `cf-cache-status` header read would settle it; not permitted
here.

### RECOMMENDATION
Before Terminal-Next adds a caching layer, verify the CDN rule's real state and apply
it if still open — it is the largest already-designed, already-code-ready win
available, and it costs a dashboard change rather than a deploy.

### OPEN QUESTION
Is `BARS_WAL_CHECKPOINT_ENABLED` deliberately absent from the flag ledger, or did a
same-day fix miss the ledger's own rail? The ledger exists precisely so
"off-and-unset" is distinguishable from "off on purpose".

---

## 4. DOCUMENTED BASELINES — every number, with its date and method

### 4.1 `docs/perf-baseline.md` — captured 2026-05-02, commit `ba9e94e`

Method, from its own closing note: **static analysis only** — *"no app code changes,
no production deploys, no local app start-up… All numbers above are either
**user-reported production metrics** or byte-level / line-level / count-level facts
derived from the repo."*

**Production symptoms (USER-REPORTED via Railway metrics — CLAIM, no artifact):**
CPU 100 % (2.0/2.0 vCPU) · memory ~1 GB idle, ~2 GB under load · p50–p99 **20+ s**
during spikes · error rate **80–90 %** during spikes · ingress spike **~20 MB**
correlated with failures · Cloudflare 502s, blank `/breadth` and `/journal`.

**Repo-derived facts (MEASURED at `ba9e94e`):** bundle **21 MB** total;
`vendor-echarts` **1 137 559 B**, `vendor-recharts` **415 965 B**, `vendor-charts`
**176 776 B** (~1.7 MB of chart libraries pre-gzip); `OptionsFlow.jsx` **4 740 LOC**
with 64 `useState` / 18 `useEffect` / 145 `.map()` / 2 `useMemo` / 20 `fetch()`;
`flow-data.csv` **19 866 637 B**; `Darkpool-data.csv` **19 439 185 B`;
`Indexes-data.csv` 1 503 667 B; `themes_taxonomy.json` 398 563 B; backend ~80 files /
~24 000 LOC across 32 routers; **233 sync `def` vs 14 `async def`** handlers
(94 % sync) of 247; anyio pool raised 5 → **64**; `TTLCache` max **500** entries with
**no lock**; healthcheck timeout **600 s**; a local-only 337 MB
`bars_cache_deep.tar.gz`.

**Stated (not measured) layer latencies, from `bars.py`'s docstring:**
memory <1 ms · SQLite <5 ms · disk <20 ms · Massive delta <1 s · **Massive full fetch
4–8 s**.

### 4.2 `docs/perf-investigation.md` — Phase 2, 2026-05-02, same method

Five ranked root causes, each labelled CONFIRMED **by code reading**, none by runtime
measurement. Status against the code in this worktree on 2026-09-02:

| # (May) | Claim | Status now | Evidence |
|---|---|---|---|
| 1 | 19.86 MB CSV on every OptionsFlow/DarkPool mount, no cache headers, no Cloudflare cache | **LARGELY RESOLVED.** The main flow path is `/api/flow/data` (`OptionsFlow.jsx:201`, `optionsFlow/flowLoadPolicy.js`), not a static CSV. Files in this worktree: `flow-data.csv` **3 065 800 B**, `Darkpool-data.csv` **704 087 B**, `Indexes-data.csv` **1 889 283 B**. `_csv_response` now sets `max-age=300, stale-while-revalidate=86400`. **`serve_csv()` at `api/main.py:9200` carries NO route decorator — it is dead code**; `/Darkpool-data.csv` and `/Indexes-data.csv` remain routed and read the whole file into memory per request. The only client fetch sites left are in `OptionsFlow_admin.jsx`. | measured `ls -la app/public/*.csv`; `api/main.py:9199-9209`, `:7262-7275` |
| 2 | Sync handlers + unbounded external calls exhaust the 64-thread anyio pool | **PARTLY RESOLVED — STILL THE DOMINANT RISK.** Unbounded calls are bounded (`yf_util.bounded_call`, Anthropic `timeout=60`), and five shed-capable semaphores now guard bars. The pool is still **64** on **one** process. | `api/main.py:2388-2395`; `bars_fetch.py:144-197` |
| 3 | Prewarmer + scheduler + Finnhub WS + static server all in one uvicorn process | **PARTLY RESOLVED.** Prewarmer moved to **worker**; the OPRA consumer and every flow.db-owning job moved to **flow-worker**; web proxies flow reads. Web still owns the scheduler, the Finnhub WS, static serving and ~13 daemon threads. | `railway.json` startCommand branches; `worker_main.py`, `flow_worker_main.py`, `flow_proxy.py` |
| 4 | Only 1 of 4 SQLite DBs on WAL; no pooling; full-table scans in hot paths | **PARTLY RESOLVED and SUPERSEDED.** The live problem is now WAL **bloat** under continuous web-side writes (§3.4), not WAL absence. | `api/services/bars_wal_checkpointer.py` |
| 5 | No top-level `<ErrorBoundary>`; blank screens | **NOT RE-VERIFIED here** — D-06 owns UI structure. `App.jsx:1-3` describes a route-level Suspense fallback "plus a recovery panel". | `app/src/App.jsx:1-3` |

### 4.3 Later measured artifacts — these ARE measurements, and they post-date the baseline

| Date | Number | Source |
|---|---|---|
| 2026-07-25 | `/api/flow/data?days=1` = **12.4 MB gz**; origin **386 ms warm / 3 643 ms cold**; `cf-cache-status: DYNAMIC`, `age: null` | `docs/runbooks/options-flow-cloudflare-cache.md` |
| 2026-07-25 | Options Flow cold shell: base 12.7 MB / **2 583 ms** + parse 486 ms (96 178 rows) + process 1 420 ms, then an **identical** delta 12.7 MB / 2 718 ms + 541 ms + 1 661 ms → **sidebar click → data ready 9 505 ms** | `app/src/pages/optionsFlow/flowLoadPolicy.js:18-35` |
| 2026-07-31 | `/api/calendar` polled every 20 s for 13 min: **4.51 s** and **7.97 s** on the two TTL-expiry requests, **0.12 s** on the other 38 | `api/services/serve_stale.py:11-17` |
| 2026-08-08 | Calendar enrichment **cold 17.9 s / warm 0.14 s**; week batch **cold 24.8 s / warm 0.22 s**; neighbour weeks **57.2 s** (120 reporters) and **33.3 s** (67) | `api/main.py:1010-1050` |
| 2026-08-19 | Bars warm/cold via `Server-Timing`: **daily p50 ~60–70 ms, 100 % `stale-swr`**; **intraday 0 % warm, p50 366 ms → p50 66 ms** after `BARS_INTRADAY_ASYNC_HEAL=1`; `PREWARM_5M_UNIVERSE=1` queued **+3 200** shallow 5 m jobs with web on-demand holding 57–63 ms | `docs/superpowers/plans/2026-08-18-instant-origin-bars.md` |
| 2026-08-19 | **Every WEB deploy costs a ~3-minute cold window** — `bars.db integrity check passed (179.1 s)` at boot plus a cold memory cache. Worker deploys don't blip `/api` | same |
| 2026-08-19 | Member HAR: **15 cold tickers dragged 664 warm charts to 5–20 s and `/api/watchlists` to 18 s** | `api/services/bars_fetch.py:174-181` |
| 2026-08-29 | Auth gate serialised chunk loading: `auth/me` **665 → 1 879 ms**; page chunks **not requested until 1 891 ms** | `app/src/App.jsx:38-45` |
| 2026-08-31 | A `force_resync` to install the full **~20 GB** bars base **OOM'd the pod and left an empty db** | `docs/superpowers/specs/2026-08-31-edge-deep-history.md` |
| 2026-09-02 | Long-tail first view **0.3–6.8 s**, highly variable, localised to `get_bars` (WAL bloat) while `last_ts` stayed **<50 ms** | `api/services/bars_wal_checkpointer.py:3-18` |
| undated | Web pod RSS *"climbs ~**2.2 MB/s** (1 201 MB at 105 s, 1 661 MB at 318 s, **11 665 MB observed on a long-lived one**)"* | `api/main.py:6866-6872` |
| 2026-06-09/10 | Thread burst **~58 → 931 threads in minutes for ~25 min**, then self-heals; during it sync endpoints and catalyst threads cannot start | `api/main.py:1240-1247` |
| 2026-07-16/17 | Tape spool: **~3.5 GB of OPRA trade frames across 8 hours**, tripping a 4 GB cap mid-session (now 8 GB) | `api/flow_tape_spool.py:69-72` |
| 2026-07-16 | A 6-minute consumer freeze cost **~13 872 prints across 8 gaps in one day**, permanently lost until the T+1 flat file | `api/flow_tape_spool.py:1-11` |

### 4.4 INTERPRETATION — two bodies of evidence, only one of them discoverable

There are two kinds of evidence here. The May documents are a **static audit whose
production numbers are user-reported**. The 2026-07 → 2026-09 numbers are **measured
artifacts embedded in the code that acts on them**, usually recorded in the comment
beside the fix. The second body is far more trustworthy and far less discoverable: it
lives in roughly fifteen docstrings scattered across `api/` and `app/src/`, and
**nothing indexes it**.

If Terminal-Next is designed against `docs/perf-baseline.md`, it will be designed
against a four-month-old picture in which the top problem (20 MB CSVs) is already
solved and the current top problems — WAL bloat, the ~3-minute deploy cold window,
RSS growth, an unapplied CDN rule, and single-process thread-pool contention — do not
appear at all.

### RELEVANCE TO UCT
The one artifact Terminal-Next most needs (a current, dated, regenerable performance
baseline) is the one artifact this repo does not have.

### CONFIDENCE
🟢 that these numbers exist in these artifacts with these dates. 🟡 that they still
describe production — none was re-verified.
**EVIDENCE CEILING:** `tools/bars_warmth_audit.py` and `tools/market_open_chart_check.py`
would refresh most of the table in minutes and are read-only HTTP tools; neither was
run (this contract forbids measurement).

### RECOMMENDATION
Retire `docs/perf-baseline.md` as "the baseline" and replace it with a dated,
regenerable one (§8). Keep the old file, marked historical — the deltas it enables are
valuable. Then index the fifteen in-code measurements into it, so the next reader does
not have to grep docstrings to learn what production actually does.

### OPEN QUESTION
Are the May documents' user-reported symptoms (100 % CPU, 80–90 % error rate) still
reachable states? Every structural fix since assumes they are not, and no artifact
records a re-measurement after the fixes.

---

## 5. BUNDLE AND LOAD

### 5.1 OBSERVATION — Chunking is object-form and hand-tuned, with a 231 KB gz regression documented in the config itself

### EVIDENCE
`app/vite.config.js` `manualChunks` uses the **object form** (function form is banned
in-file). Declared chunks: `vendor-react` (react, `react/jsx-runtime`,
`react/jsx-dev-runtime`, react-dom, `react-dom/client`, scheduler, react-router-dom),
`vendor-swr`, `vendor-charts` (lightweight-charts), `vendor-echarts` (echarts +
echarts-for-react).

The comment records a measured defect from 2026-08-09: listing bare `'react'` matched
one module id, so Rollup put `react/jsx-runtime` in **vendor-tiptap** and React's CJS
body in **vendor-swr**; the entry chunk then statically imported vendor-tiptap to get
the JSX runtime, which pulled vendor-recharts — *"**231 KB gz of a rich-text editor
and a second chart library loaded on the LOGIN screen**."* Fix: name every React entry
point, and **deliberately do not list** recharts or tiptap, because *"naming a package
here FORCES a chunk into existence, and Rollup then hosts unassigned shared modules
… inside it"*; unlisted, they hang off the lazy routes where they belong.
Verification is explicitly **not** by reading the list: *"Verify with
`app/vite.config.chunkmap.mjs`-style module→chunk dump … the failure is silent and the
entry still works, it is just 231 KB heavier."*

`chunkSizeWarningLimit: 4000`. A build-only plugin `stripManifestProse()` removes
~68 KB of documentation prose from `engine/ast/closedTable.json` **from the bundle
only** (`apply: 'build'` is called out as load-bearing, since vitest runs through the
same config and dozens of rails assert on that prose).

There is **no `app/dist/` in this worktree**, so current chunk sizes could not be
measured. The May figures (§4.1) are the only ones available, and they predate this
overhaul.

### 5.2 OBSERVATION — The auth-gate serialization is real, was measured, and has been fixed by a module-scope prefetch

### EVIDENCE
`app/src/App.jsx:38-52` states the mechanism exactly: *"React.lazy only begins
downloading a page's chunk when that component first RENDERS — and AuthGuard holds
every protected route at a splash until BOTH `/api/auth/me` and `/api/maintenance`
answer. That put a ~1.2 s auth round-trip strictly IN FRONT of a multi-hundred-KB page
chunk on every cold load, two independent fetches run one after the other. **Measured
on prod 2026-08-29: auth/me 665→1879 ms, page chunks not requested until 1891 ms.**"*

Both gating fetches are visible: `AuthGuard.jsx:59-65` fetches `/api/maintenance` in a
`useEffect`, and `useAuth()` supplies the `/api/auth/me` result.

The fix: `lazyPage(path, importer)` (`App.jsx:53-58`) registers each route's importer
in a `Map` alongside its `lazy()` — *"Both uses share ONE importer, so the prefetch can
never resolve a different module than lazy() does."* A **module-scope** block
(`App.jsx:120-135`) resolves the longest registered prefix of
`window.location.pathname` and calls the importer immediately, so the chunk downloads
in parallel with auth. It is explicitly *"a best-effort accelerator, NOT a gate"*: an
unregistered path keeps the old behaviour, and a failed prefetch is swallowed so
`lazyWithRetry` still owns the real load.

Coverage is **enumerated, and partial**: **26** routes use `lazyPage` (dashboard,
morning-wire, research, uct-20, breadth, calendar, calendar/mystocks, screener,
ai-search, options-flow, flow-scoreboard, live-massive, traders, dark-pool,
post-market, model-book, setup-library, desk, desk/article, charts, …). Of the 72
`lazy(` sites in the file, the rest remain plain — including `/journal` and every
Journal surface, `/watchlists`, `/community`, and the render-only routes.

### 5.3 OBSERVATION — `/calendar` initial load, as far as code reveals

### EVIDENCE
`app/src/pages/calendar/useCalendarData.js` exposes ten SWR hooks with these
cadences: `useCalendar` (`marketHoursOnly`; 2 min for a non-week view, **0** for a
paged week), `useCalendarMySets` (5 min), `useEnrichment` (5 min), `useReactions`
(**30 s**, `marketHoursOnly`), `useWeekEnrichment` (5 min — the **batched**
`/api/calendar/enrichment-batch?dates=`, which replaced one request per day),
`useDayMetrics` (2 min), `useWeekMetrics` (2 min on the current week, 0 otherwise),
`useMonthCalendar`, `useIpos` (30 min), `useDividends` (30 min). `/calendar` and
`/calendar/mystocks` are both registered for prefetch (`App.jsx:70-71`).

The load characteristic that dominates is **not** request count: it is whether
`_ENRICH_TTL` happens to be warm — cold 17.9 s for a day and 24.8 s for the week
batch, warm 0.14 s / 0.22 s (§2.2). The 240 s warmer exists so that "warm" is the only
state a user meets. D-09 owns the calendar's features; this is its load profile only.

### INTERPRETATION
Front-end load work here is mature and evidence-driven, but its coverage is
**enumerated rather than derived** in both places that matter: 26 of ~72 lazy routes
are prefetch-registered, and the chunk map is verified by a separate dump script
rather than by a rail. Both are the same defect shape as §1.2.

### RELEVANCE TO UCT
Terminal-Next will be a heavy route. Prefetch registration and chunk-map verification
must be part of its definition of done, or it inherits the ~1.9 s serialized cold
start and is one Rollup reshuffle away from shipping a chart library to the login
screen.

### CONFIDENCE
🟢 for the code and the quoted measurements. 🔴 for current bundle sizes.
**EVIDENCE CEILING:** no `app/dist/` in the worktree and no build permitted;
`cd app && npm run build`, or reading a production asset manifest, would produce them.

### RECOMMENDATION
Register the remaining heavy routes with `lazyPage`, and turn the chunk-map dump into
a CI rail that fails when the entry chunk gains a statically-imported vendor chunk.

### OPEN QUESTION
What is the current entry-chunk size, and does `vendor-echarts` still load on any
first paint? Unanswerable without a build.

---

## 6. CAPACITY ENVELOPE OF THE SINGLE-REPLICA WEB POD

### 6.1 OBSERVATION — One uvicorn process, no `--workers`, 64 anyio threads, and a health endpoint that reports threads and RSS

### EVIDENCE
`railway.json` `startCommand` is a four-way branch on env
(`BARS_API_ENABLED` / `FLOW_WORKER_ENABLED` / `WORKER_ENABLED`, else web), each using
**`exec`**, with web running
`uvicorn api.main:app --host 0.0.0.0 --port $PORT --proxy-headers
--forwarded-allow-ips='*' --timeout-graceful-shutdown 5`. **No `--workers`.**
`drainingSeconds: 30`, `healthcheckPath: /api/health`, `healthcheckTimeout: 600`,
`restartPolicyType: ALWAYS`. CLAUDE.md records `exec` + the graceful-shutdown bound +
`drainingSeconds` as a unit that must never be broken apart (without `exec`, `sh` is
PID 1 and swallows SIGTERM). `Procfile` and `nixpacks.toml` carry the same single-worker
command without the graceful-shutdown flag.

`api/main.py:2388-2395` — `anyio.to_thread.current_default_thread_limiter().total_tokens = 64`,
printed at startup.

`api/main.py:6764-6776` — `/api/health` returns
`{status, wire_date, uptime_seconds, thread_count, rss_mb}`, RSS read straight from
`/proc/self/status` `VmRSS` and paired with `thread_count` specifically to diagnose
the 2026-06-09 outage: *"a climbing thread_count points to a thread leak; flat threads
with climbing rss_mb points to memory pressure."*

`api/main.py:6778-6800` — `/api/ready` is **observability only**, and its docstring
records that pointing `healthcheckPath` at it on 2026-07-26 (deploy `650865d5`) caused
a **~3-minute outage**: *"Railway does NOT keep the old pod serving while the new one
healthchecks — the old pod is already gone, so a 503-until-warm probe does not hold
traffic on the warm pod, it takes the site DOWN until the gate releases … Slow-but-
serving beats hard-down."* **Four places in the repo had asserted the wiring existed.**
`tests/api/test_ready_endpoint.py::test_railway_healthcheck_must_not_gate_on_readiness`
is the standing guard.

**The one permitted production read.** `GET https://uctintelligence.com/api/health`
with a browser User-Agent at **06:02 UTC 2026-09-02** returned Cloudflare
**`error code: 502`** — no JSON body. This is a single sample and I am not entitled to
call it an outage: project memory records the pod is unreachable for roughly two
minutes around a deploy swap, and that Railway can mark a deploy failed after a
healthcheck passes. It does mean the contract's KNOWN FACTS (`uptime 776 s,
thread_count 67, rss_mb 1306.6` at 05:41 UTC) could not be re-confirmed, and that the
pod had a very short uptime an hour earlier. **NOT DETERMINED:** whether this was a
swap, a cold start, or a fault. A second read minutes later, or `railway status` /
`railway logs`, would settle it; neither is permitted here.

### 6.2 OBSERVATION — Three named capacity incidents are recorded in code, with thresholds and instrumentation

| Incident | Recorded where | Instrumentation left behind |
|---|---|---|
| **Thread burst**, 2026-06-09/10: ~58 → **931 threads in minutes for ~25 min**, self-healing; during it sync endpoints and catalyst refresh threads cannot start | `api/main.py:1240-1275` | `_start_thread_burst_watch` samples every 30 s and logs a **normalised** thread histogram (digits and ticker-ish tokens stripped, so `bars-bg-NVDA-5-partial` collapses to `bars-bg`) above `THREAD_BURST_LOG_THRESHOLD` (default **200**), at most once a minute, plus a "subsided" line so the duration is in the logs. Admin `/api/health/threads` and `/api/health/thread-stacks` (deepest app-level frame per thread) |
| **RSS growth**: *"climbs ~2.2 MB/s on this pod (1 201 MB at 105 s, 1 661 MB at 318 s, **11 665 MB observed on a long-lived one**) and nothing said what was holding it"* | `api/main.py:6866-6872` | `/api/health/memory` (admin; `?deep=1` adds a GC type histogram and per-cache byte estimates; `?trim=1` runs glibc `malloc_trim(0)` and reports RSS either side — *"the one call that separates 'allocator is hoarding freed pages' from 'a C extension is genuinely holding this'"*). `_web_memwatch` logs `[mem] rss_mb=… threads=…` every 60 s |
| **OOM on deep-history install**, 2026-08-31: a `force_resync` of the ~20 GB bars base *"OOM'd the pod and left an empty db — proof the monolithic approach is unsafe on this single, memory-constrained pod"* | `docs/superpowers/specs/2026-08-31-edge-deep-history.md` | The edge-deep-history design: web never holds or fetches deep history, it proxies a cache miss to the worker, and the immutable `?d=` URL means the edge serves everything after the first hit |

Also recorded: memory pre-warm "pass 2" was **removed** on 2026-06-15 because it
evicted the curated hot set from the then-500-entry cache, kept only its last 500 of
~7 400 series, and *"churned ~1.8 GB of transient bar payloads, which glibc keeps
resident as arena fragmentation … inflating web-pod RSS toward ~2.4 GB"*
(`api/main.py:3607-3628`).

**On `MALLOC_ARENA_MAX=2` — the project-memory claim is contradicted by the code.**
`api/main.py:3623` (2026-06-15) says of those transient payloads that glibc keeps them
resident as arena fragmentation *"(MALLOC_ARENA_MAX is **unset**)"*.
`api/worker_main.py:63` says of the worker's 3–23 GB RSS sawtooth during prewarm that
*"**MALLOC_ARENA_MAX=2 did NOT shrink it**"*. `api/main.py:6436` adds that the trim
endpoint *"does NOT replace MALLOC_ARENA_MAX, it is the half that needs no restart."*
So: the variable is believed relevant, was tried on at least the worker, **did not
work there**, and was described as unset on web as of 2026-06-15. Whether it is set on
web today is **NOT DETERMINED** — no Railway read permitted. Treat "RSS = glibc arena
fragmentation, fixed by `MALLOC_ARENA_MAX=2`" as an unproven hypothesis, not a fact.

### 6.3 OBSERVATION — A wedge watchdog exists, ships dark, and its arming runbook is not recorded as executed

### EVIDENCE
`api/event_loop_watchdog.py:1-56`. A **daemon thread** (deliberately not on the event
loop, *"so it keeps running even when the loop is wedged"*) captures the running loop
and every `WATCHDOG_CHECK_SEC` (default **5 s**) schedules a trivial probe via
`loop.call_soon_threadsafe`, measuring lag. After `WATCHDOG_WEDGE_SEC` (default
**30 s**) of total unresponsiveness across enough consecutive misses it (1) Discord-
alerts with lag telemetry, (2) flushes stdout and dumps **all** thread stacks via
`faulthandler`, (3) calls `os._exit(1)` so Railway restarts the container.
`_STALL_CAPTURE_MS = 3000` captures a stack once a stall passes ~3 s, while the
blocking frame is still live.

Safety: `WATCHDOG_ENABLED` defaults to **0** — *"`os._exit` is NEVER called unless
`WATCHDOG_ENABLED=1`"*. `WATCHDOG_OBSERVE` is a hard override that measures and exposes
lag but never exits. **With both off the measuring thread does not even start.** The
three-step arming runbook (dark → observe → arm, sizing `WATCHDOG_WEDGE_SEC` at 3–5×
the observed `max_lag_ms` from `GET /api/watchdog/status`) is in the docstring.
**Neither flag appears in `docs/feature_flags.json`** (104 flags: 86 armed, 13 pending,
5 dark), so there is no record of whether observe mode was ever run.

### 6.4 OBSERVATION — Rate limiting exists, keyed correctly, but covers only auth, voice and a few routes

### EVIDENCE
`api/limiter.py` — slowapi keyed on `client_ip()` (Cloudflare `CF-Connecting-IP` /
`X-Forwarded-For`), with the reason stated: `get_remote_address` behind
Cloudflare→Railway *"would make the login/signup limits a single GLOBAL bucket (a
self-inflicted launch-morning 429 lockout)"*. **38** `@limiter.limit` decorators
repo-wide: auth 3–10/min, voice 10–60/min, transcripts 10/min, earnings 60/min.
**No rate limit on `/api/live-prices`, `/api/bars`, `/api/stream/*`, or the flow
endpoints** — those are protected by semaphores, admission caps and shed-503s instead.

### INTERPRETATION — what a long-lived multi-panel client stresses first

Ranked by what the code's own bounds say, for one browser holding N panels:

1. **The anyio thread pool (64).** Every sync handler holds one slot. The bars valves
   (`_cold_fetch_sem=3`, `_warm_serve_sem=6`) exist precisely because a handful of cold
   or warm-prefetch requests can occupy it, and a panel board that opens a dozen cold
   tickers at once is the exact HAR shape measured on 2026-08-19.
2. **The event loop.** Each SSE connection is a coroutine looping at 4 Hz. The pools
   mean N panels ≈ **2** connections per browser, so the binding constraint is
   `STREAM_MAX_SUBSCRIBERS=300` **per stream across all users** — roughly 300
   concurrent browsers, not 300 panels. This is the single strongest argument for the
   pooled design.
3. **RSS.** ~1.3 GB at 776 s uptime (contract KNOWN FACT) against a documented growth
   rate and an 11.6 GB observation. Panels holding large payloads amplify it — the
   options tape defaults to "All" (up to 10 000 rows client-side) and `/recent` at
   limit 20 000 built ~34 K-row responses in memory, the exact mechanism named in the
   5 s→20 s poll reversion.
4. **SQLite WAL on `bars.db`.** Continuous web-side writes plus concurrent panel reads
   is the §3.4 shape; more simultaneous chart panels means more readers walking the WAL.
5. **Massive upstream.** `_MASSIVE_SEM = 6` with an 8 s acquire, then a 503.

### RELEVANCE TO UCT
Terminal-Next as "one long-lived tab with many panels" is *cheaper* than the same data
spread across many tabs — but only for **streams**. For **request-path** work it is
strictly more expensive, and the pod has no horizontal escape: CLAUDE.md records that
multi-worker is unsafe because SSE and live-price state are in-process, and that jobs
cannot move off web because ~20 SQLite DBs live on the volume.

### CONFIDENCE
🟢 for the process model, thread pool, watchdog design, limiter and recorded incidents
(all read directly). 🟡 for the current envelope. 🔴 for present-moment health.
**EVIDENCE CEILING:** the single production `/api/health` sample returned 502; no logs,
no metrics, no `/api/health/threads`. A 24-hour export of the `[mem]` and
`[thread-burst]` log lines the pod **already emits** would convert most of §6 from
CLAIM to CONFIRMED at zero operational risk.

### RECOMMENDATION
Before Terminal-Next commits to a panel count, arm `WATCHDOG_OBSERVE=1` for a week and
record `max_lag_ms` across market open, a deploy, and the heavy job windows. That is
the only number that says how much loop headroom a multi-panel client may consume, and
the runbook to obtain it is already written and cannot exit the process.

### OPEN QUESTION
Was the 06:02 UTC 502 a deploy swap or a fault — and does a long-lived Terminal-Next
session survive a swap gracefully? Today's pooled clients auto-reconnect and keep
rendered data, which suggests yes, but nothing measures it.

---

## 7. MARKET-OPEN AND EVENT SPIKES

### 7.1 OBSERVATION — Spike handling is real, layered, and concentrated on the flow ingest path

| Mechanism | Where | Behaviour under a spike |
|---|---|---|
| Raw OPRA **tape spool** | `api/flow_tape_spool.py:1-31` | The consumer's receive loop hands every raw WS frame to a bounded `deque(maxlen=50_000)` (`_QUEUE_MAX`, *"~1-2 min of extreme-volume frames"*) drained by a daemon thread into hourly files. *"The hot loop only ever does an append to a deque; the writer can die, lag, or drop (counted) without ever back-pressuring the tape."* Current hour is plain JSONL, rotated hours gzip, pruned after ~26 h |
| Spool **disk budget** | same, `:69-76` | `MAX_SPOOL_BYTES` default **8 GB** (`FLOW_TAPE_SPOOL_MAX_GB`), raised from 4 GB because *"4GB was under a single RTH day of OPRA trade frames (2026-07-17 spooled ~3.5GB across 8 hours), so the cap tripped mid-session on every busy day"*; `MIN_FREE_BYTES` **2 GB**; disk check every ~60 s; oldest-first trim, then pause with a 6 h re-nag |
| Autonomous **gap replay** | same | On consumer start (watchdog restart, deploy, crash) a daemon thread rebuilds each detected gap window from the spool through the **same** pipeline as the T+1 heal, dedup-keyed so overlap is harmless. `REPLAY_MAX_MIN = 120`. *"A freeze becomes minutes of lag, zero loss, no human in the loop"* |
| **Freeze watchdog** | `api/flow_watchdog.py:1-33` | *"the guard that cannot die with its patient"* — a plain OS thread outside the consumer's asyncio loop; force-exits on no `flow.db` inserts for `FLOW_FREEZE_WATCHDOG_STALE_SEC` (**300 s**) so `restartPolicy=ALWAYS` restarts within ~60 s. **Distinguishes FREEZE from LAG**: rows still inserting but timestamps trailing means *"a restart makes lag WORSE (loses buffered backlog + reconnect gap) → do nothing"*. Fires only 09:45–15:55 ET Mon–Fri, only if the newest row is from today, only past `MIN_UPTIME_SEC` (300 s) |
| Stream **broadcast caps** | `massive_stream.py:26`, `bar_broadcaster.py:372` | `TAIL_LIMIT=500` rows per tick with leftovers draining next tick (last-processed id remembered); per-subscriber queues drop **oldest** and count the drops |
| Request **shedding** | `bars_fetch.py:174-197` | Cold fetches over cap and warm prefetches over cap return a **fast 503 + Retry-After** rather than holding a thread ~20 s |
| Upstream **valve** | `live_prices.py:12-17, 94` | `Semaphore(6)`, 8 s acquire, herd-collapse re-check — sized explicitly for *"after a deploy clears the cache, 200 browsers resuming their 2s polls would otherwise fan out to ~200 simultaneous Massive fetches"* |
| Ephemeral **backpressure** | `chat_stream.py:47` | Presence/typing events dropped once a subscriber's queue is half full; real messages are not |
| **Self-heal lease / narrow watch paths** | `api/flow_worker_main.py` header + Railway dashboard | flow-worker builds only on narrow watch paths so unrelated pushes do not bounce the OPRA tape. ⚠️ The dashboard is the only authority; the in-repo header is a mirror |

### 7.2 OBSERVATION — The one spike nothing absorbs is a web deploy, and its guard was deliberately removed

### EVIDENCE
`docs/superpowers/plans/2026-08-18-instant-origin-bars.md`: *"⚠️ **Every WEB deploy
costs a ~3-min cold window** (`bars.db integrity check passed (179.1s)` at boot + cold
mem cache) — so batch web pushes and avoid market-hours churn. Worker deploys don't
blip `/api`."*

CLAUDE.md records that the market-hours push freeze (Mon–Fri 09:15–16:20 ET) and
**both** its guards (a `pre-push` hook and a "Deploy window guard" workflow) were
removed by owner decision on **2026-08-24**: *"Push whenever. The physics did not
change and is now unguarded."*

For the flow path the equivalent is harsher and permanent: Massive OPRA does **not**
replay, so a flow-worker bounce leaves a hole in the tape until the overnight T+1 flat
file. `flow_tape_spool.py:8-10` names the exception the spool cannot cover:
*"Deploy-swap gaps (socket down) are the one class this cannot capture — those need
Massive's 2nd concurrent connection."*

### INTERPRETATION
Spike engineering is excellent on the **data-ingest** side and effectively absent on
the **deploy** side, which is the far more frequent event. Every warm cache in §2.2 is
cold after a swap; the boot integrity check is ~3 minutes of degraded serving; and the
guard that used to keep swaps out of market hours was deliberately removed.

### RELEVANCE TO UCT
A long-lived Terminal-Next session will meet deploys far more often than it meets a
genuine market spike. The design question is therefore not "can we absorb the open?" —
the flow path demonstrably can — but "**what does a panel board do for the three
minutes after a swap?**" Today's implicit answer is good: pooled SSE clients
reconnect, rendered data is retained rather than blanked, REST polls retry, and warm
caches refill on the warmer schedule. It is worth making that answer explicit and
tested rather than emergent.

### CONFIDENCE
🟢 for the mechanisms and constants (read directly). 🟡 for the deploy cold window's
present duration — one measurement, 2026-08-19, before the WAL checkpointer landed.

### RECOMMENDATION
Add "survives a deploy swap without user-visible loss" to Terminal-Next's acceptance
criteria and measure it (§8, Protocol E). It is a single, repeatable, zero-load
experiment.

### OPEN QUESTION
Is a second Massive OPRA connection obtainable? It is named twice as the only fix for
deploy-swap tape gaps, and nothing records whether it was ever requested.

---

## 8. PROPOSED BASELINE PROTOCOL FOR TERMINAL-CURRENT (Part CXX)

**This is a protocol for a later role to execute. Nothing below was run.** It uses only
tools already in this repo plus a browser, adds no dependencies, and generates no load
beyond a handful of ordinary page views.

**Governing rules.**
1. Every run records date, ET clock, market session (pre / RTH / post / closed), the
   pod's `uptime_seconds` from `/api/health`, and the deploy id if obtainable. An
   uptime under ~300 s invalidates a warm measurement.
2. **Never run heavy scripts on the prod pod** — a member-visible OOM outage happened
   twice on 2026-08-28.
3. Cloudflare 1010-blocks non-browser UAs; send a browser UA (every tool below already
   does).
4. Probe the 12.4 MB flow endpoint **sparingly** — the runbook records a
   `retry-after: 60` HTML challenge after two curls 8 s apart, and warns to check that
   `content-type` is `text/csv`, not `text/html`.

### Protocol A — server-side warm/cold ratio (existing tool, read-only)
`tools/bars_warmth_audit.py` samples a stratified spread of `cap_universe.json` across
timeframes and tallies the `Server-Timing: bars;desc="<layer>"` tier
(`mem`/`sqlite` = warm; `fetch`/`stale-swr`/`inflight-wait`/`disk`/`miss` = cold, i.e.
the user waited). Run `--tf D,5 --n 40` twice: once during **RTH**, once **after
close**. Record the warm ratio and p50/p95 per tier. The instant-origin plan's
definition of done is **≥99 % served mem/sqlite**; 2026-08-19 recorded daily p50
~60–70 ms and intraday p50 66 ms post-fix. This is the highest-value single number in
the whole protocol and it is one command.

### Protocol B — full chart-surface matrix (existing tool, read-only, HTTP-only)
`tools/market_open_chart_check.py` — health; a ticker×TF **latency matrix** with
`Server-Timing` server-compute vs total vs cache layer (warm / cold / delta); weekly
dedup and bar-sanity checks; **live-bar liveness during RTH** (does the developing bar
actually advance between polls — the "frozen chart" regression class); the
reconciliation-status read; and a measured deep-intraday fetch at `bars=20000`. Prints
markdown plus a `<<<JSON>>>` blob, exit 0 = all pass. Run at **09:45 ET** and again
after close; the after-close run is the weekend-safe baseline it was written against.

### Protocol C — browser waterfall, per surface (browser only)
For `/calendar`, `/charts`, `/dashboard`, `/live-massive`, `/options-flow`, in a
**visible foreground tab** (hidden tabs rAF-throttle and defer paint), with DevTools
Network + Performance recording:
1. A **cold** pass (empty cache + hard reload) and a **warm** pass (reload) each.
2. Record: document TTFB; when `/api/auth/me` and `/api/maintenance` resolve; **when the
   first page chunk is requested** (this is the auth-gate serialization number —
   2026-08-29 measured 665→1 879 ms and 1 891 ms); LCP; total transferred bytes; the
   entry chunk name and size; and whether any `vendor-*` chunk loads on the login
   screen (the 231 KB regression).
3. Export the HAR. A member HAR is what produced the "15 cold tickers dragged 664 warm
   charts" finding — HARs are this project's most productive instrument.
4. Run a **Lighthouse** performance audit from the same panel. Treat it as a trend
   line, not a target.

### Protocol D — CDN reality check (three requests total)
For `/api/flow/data?days=1` and one `/api/bars-history/...?d=<sealed date>` URL, read
`cf-cache-status` and `age` on two spaced requests. MISS→HIT with a non-null `age` is
the success signal, and `?days=20` must produce its **own** MISS→HIT pair rather than
sharing the `days=1` entry. This settles §3.3's open question — whether the documented
Cloudflare rule was ever applied — and is the cheapest high-value measurement here.

### Protocol E — deploy-swap behaviour (observational, zero load)
With a Terminal-Current session open and a chart streaming, observe a deploy. Record:
how long `/api/*` is unavailable; whether the SSE pools reconnect without user action;
whether rendered data survives; how long until `/api/health` `uptime_seconds` resets;
and how long until Protocol A's warm ratio recovers. Compare against the recorded
~3-minute cold window.

### Protocol F — capacity telemetry, zero cost
The pod already emits `[mem] rss_mb=… threads=…` every 60 s and a `[thread-burst]`
histogram above 200 threads. **Export 24 h of Railway logs and plot both.** This
distinguishes a leak from a large-but-stable working set — which `api/main.py:3639-3644`
calls *"the prerequisite for any further memory work"* — and requires nothing to be
deployed, armed, or run.

### Protocol G — loop-lag baseline (one env var, reversible, cannot kill the pod)
Set `WATCHDOG_OBSERVE=1` (never `WATCHDOG_ENABLED`) and read
`GET /api/watchdog/status` → `max_lag_ms` across market open, a deploy, and the heavy
job windows for several days. Observe mode is a hard override that **cannot** exit the
process. This is the prerequisite the watchdog's own runbook names before arming, and
the number that bounds how much event-loop budget Terminal-Next panels may spend.
⚠️ `railway variables --set` STAGES ONLY and auto-redeploys; plan the change like a
deploy.

### Protocol H — front-end micro-timing (existing harnesses)
- `tools/mobile_audit.py` — Playwright sweep at phone/tablet viewports, flagging
  horizontal overflow and sub-44 px targets, with a full-page screenshot per
  route/viewport plus `report.md`. Two standing hazards: it must be passed `--auth`
  (the `--routes` flag alone does not log in), and its hand-typed route list has been
  wrong before — it audited the 404 page for a non-existent `/patterns` while never
  auditing `/ai-search`, `/flow-scoreboard`, `/live-massive`, `/desk` or `/community`.
  **Derive its routes from `App.jsx` before trusting a pass.** Identical screenshot
  byte-sizes are a vacuity tell.
- Admin-only `?gridspike=N&tf=D|5` on `/charts` runs the real multi-chart grid path
  with persistence off, reporting to console `[gridspike:done]` and
  `localStorage['uct.gridspike.last']`. Must be run in a **visible** tab (the sweep has
  a validity guard). The recorded result is 16 cells framed in ~900 ms, +63 MB heap —
  the closest existing analogue to a Terminal-Next panel board, and the natural place
  to start.
- `vitest` timing is available but **must not be used as a performance metric**:
  `app/vite.config.js` documents that on this suite it measures the scheduler as much
  as the code — cumulative test time **triples** from 25 % to default workers while
  wall time barely moves, hence `maxWorkers: '50%'` and `testTimeout: 15000`.

### Deliverable
A dated `docs/perf-baseline-<YYYY-MM-DD>.md` with one table per protocol, the
session/uptime context for every row, and an explicit delta against §4.3's numbers.
Move the 2026-05-02 documents to an archive path marked historical.

### CONFIDENCE
🟢 that these tools exist with these capabilities (headers and code read). 🟡 that each
runs cleanly today — none was executed.

---

## GAPS — what this budget did not reach

- **No production telemetry of any kind.** The single permitted `/api/health` GET
  returned a Cloudflare 502, so §6.1's KNOWN FACTS could not be re-confirmed and no
  runtime figure in this report is a fresh measurement.
- **No current bundle sizes.** `app/dist/` is absent and no build was permitted, so
  §5's size figures are the 2026-05-02 ones — taken before the 2026-08-09 chunking
  overhaul. Every "how heavy is the client today" question is unanswered.
- **Flag reality.** Statuses come from `docs/feature_flags.json`, which its own readme
  says can drift from Railway. `VITE_*` flags (`VITE_REALTIME_BARS`,
  `VITE_MASSIVE_STREAM`, `VITE_MASSIVE_CURATED_STREAM`, `VITE_GRID_WARM_ENABLED`) are
  build-time and appear in **no** ledger — NOT DETERMINED. Nor are `WATCHDOG_ENABLED`,
  `WATCHDOG_OBSERVE`, `BARS_WAL_CHECKPOINT_ENABLED`, `BARS_INTRADAY_ASYNC_HEAL`,
  `BARS_DAILY_ASYNC_HEAL`, `PREWARM_5M_UNIVERSE`, `RECONCILE_ENABLED`,
  `USE_REMOTE_BARS`, `FLOW_TAPE_SPOOL_ENABLED` or `FLOW_FREEZE_WATCHDOG_ENABLED`.
- **The partner-owned ingest** (`massive_ws_worker.py`, `massive_processor.py`,
  `live_massive_router.py`) was read only far enough to establish where it runs and how
  it connects to the tailer. Its internal backpressure, reconnect and restart-log
  behaviour is deliberately not described.
- **The gzip/curated-stream hypothesis was not reproduced.** The exemption gap and the
  missing test case are certain; the runtime consequence is inferred.
- **`/api/health/memory?deep=1` per-cache byte attribution** — the tool exists and would
  name what holds the ~1.3 GB. Admin-only, production, not permitted.
- **Cloudflare configuration** cannot be read from the repo. Whether the flow cache
  rule, Cache Reserve, or any other rule is live is unknown.
- **No measurement of concurrent users, per-endpoint p50/p95/p99, or CDN hit ratio** —
  the same three gaps `docs/perf-investigation.md` listed in May 2026 as "what I could
  not investigate", still open four months later.
- **`docs/perf-investigation.md` root cause #5** (error boundaries / blank screens) was
  not re-verified; D-06 owns UI structure.
- **Worker and flow-worker capacity envelopes** were characterised only where they
  bear on web. Their own thread/RSS profiles are out of this contract's scope.

## NOT INSPECTED — paths, systems and machines out of reach, and why

- `https://uctintelligence.com/*` beyond the one permitted `/api/health` GET — the
  contract forbids production access.
- Railway CLI (`status`, `logs`, `variables --json`) — permitted by the preamble only
  where a contract says so; this one does not.
- Sentry, Railway metrics, the Cloudflare dashboard — out of repo, no access.
- The local backend on port 8077 — the preamble forbids probing it and records that it
  may serve stale data against live `C:\data`.
- The pytest suite and any vitest or Playwright run — no measurement permitted, and
  `C:\data` is real on this box.
- `git log` / `git show` / `git blame` — the preamble permits them only when a contract
  names them; this one does not, so all dating comes from in-file dates and doc
  headers.
- `app/dist/` — does not exist in this worktree; no build run.
- The `uct-intelligence`, `uct_intelligence`, `morning-wire` and `uct-sunday-scan`
  repositories — outside this contract's scope.
- Windows Task Scheduler — D-14 owns it; `Warm Bars Universe` is cross-referenced by
  name only.
- `OptionsFlow.jsx` internals beyond its data-loading policy, and all partner-owned
  files beyond their mounting and transport.
