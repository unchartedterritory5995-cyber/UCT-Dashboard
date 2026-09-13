# 03 — Target architecture + SLOs

Phase 1 of the Discord render hardening program. Inputs: `00-system-map.md` (how it runs),
`01-failure-forensics.md` (what broke and why), `02-baseline.md` (the numbers this is judged
against). Every requirement below names the failure class it closes (`C-nn`, defined in `01`).
Owner decisions D-01…D-05 are honoured; where the design departs from the letter of one, the
departure is an `OI` line with the reason, and the build proceeds on the recommendation.

---

## 0. The two facts that shape everything

1. **`web` restarts constantly.** 1,077 deployments between 2026-08-30 and 2026-09-13; the median
   pod served **8.4 minutes**. Every restart kills in-flight Starlette BackgroundTasks after 5 s of
   grace, wipes the in-memory PNG cache, the hot set and the in-memory alert throttle, and — for
   ~30–90 s — makes the `/r/chart` page the renderer screenshots return 502/422. (**C-01**)
2. **`web` is one process with one event loop and one 64-thread pool shared with the whole
   dashboard.** When it saturates, two things fail together: Discord's 3-second acknowledgement
   (`10015 Unknown Webhook` on the later PATCH) and the renderer's 21-second page load. They
   co-occur 37× more often than chance. (**C-02**)

A design that keeps work inside `web` must therefore (a) survive a restart mid-job without
losing the reply, and (b) keep its acknowledgement path and its work off the shared loop and the
shared pool. Everything in §3 follows from those two.

---

## 1. SLOs

Measured from the durable jobs table (§3.3), never from in-memory counters — an in-memory metric
on this pod resets every 8 minutes and reports health straight through an outage.

| # | SLO | Definition (field in `discord_render_jobs`) | Window | Target |
|---|---|---|---|---|
| S1 | Acknowledged | `ack_ms` = handler entry → response returned, server side. Cross-checked against Railway `httpLogs.totalDuration` for the live deployment. | rolling 7 d, per command | p99 ≤ **1,000 ms**; zero acks > 3,000 ms |
| S2 | Chart delivered (liquid, RTH) | `final_ms` = ack → the PATCH carrying the image returns 2xx | rolling 7 d, RTH only, liquid set | p50 ≤ **2.5 s** · p95 ≤ **5 s** · p99 ≤ **8 s** |
| S3 | Hard ceiling | at `deadline_ms` = 15,000 with no artifact delivered, the honest failure message (§3.5) is sent | every job | **100 %** of jobs end in artifact-or-message by 15 s |
| S4 | Flow delivered | same shape as S2 for `/flow` | rolling 7 d | targets = `02-baseline.md` flow p50/p95/p99 × 0.5 (owner rule), per window class — see OI-11 |
| S5 | Success rate | delivered ÷ (all jobs − `user_error` class) | per command per ISO week | ≥ **99.5 %** |
| S6 | Invalid symbol | `user_error:symbol_not_found` answered ephemeral with ≤3 suggestions | every such request | answered in ≤ **1,000 ms** (it is the ack) |
| S7 | Zero silent failures | jobs whose `state` is not terminal 60 s after `created_at`, or terminal without a user-visible outcome recorded | continuous | **0** |
| S8 | Honest degradation | a stand-in or a cached artifact always carries its label | every degraded delivery | **100 %** (railed) |

"Delivered" counts a labelled stand-in; `/renderhealth` reports **house-quality rate** beside it
so a renderer outage cannot hide inside a green success rate.

---

## 2. Latency budget (V2, liquid chart, RTH)

| Hop | p50 budget | p95 budget | Enforced by |
|---|---|---|---|
| ack (verify, parse, gates, enqueue) | 20 ms | 250 ms | no I/O on the loop; enqueue is an in-memory put |
| queue wait | 0 ms | 1,000 ms | global worker count; interactive lane ahead of warming |
| data (bars D + page warm + quote) | 100 ms | 1,500 ms | per-call timeouts; breaker |
| render (house) | 1,800 ms | 3,500 ms | renderer pool, background-slot cap, hard timeout |
| upload (PATCH) | 400 ms | 1,200 ms | 429/5xx policy with deadline-aware waits |
| **total** | **≈2.4 s** | **≈5 s** | job deadline 15 s |

---

## 3. Design

### 3.1 Ack path — the only code on the event loop (C-02, C-05, D-04)

`POST /api/discord/interactions` keeps its current gates (public key, signature, guild). Behind
`DISCORD_RENDER_V2_ENABLED` and the per-command flag, a V2 branch runs **only**:

1. parse the interaction (pure);
2. syntactic validation (pure) → a malformed ticker is an **ephemeral type 4 in the same response**;
3. symbol resolution in a dedicated executor with a **400 ms** budget (§3.8). Unknown to every
   authority → ephemeral type 4 with up to 3 suggestions (**D-04**), and a background warm so a
   re-run of a real-but-unseen ticker succeeds (**OI-01**);
4. per-member checks in memory (rate `12/60` as today; **≤2 jobs in flight per member**);
5. `queue.offer(job)` — an in-memory put; **queue full → ephemeral "busy · id · retry" now**, not a
   deferred spinner;
6. return the defer (`type 5`, ephemeral where the command already is; `type 6` for controls).

Moved **off** the loop: the prefs read (now in the worker), `_settings_reply`'s SQLite, the save
pick's write, and autocomplete's search (dedicated executor, **1,200 ms** budget; on timeout the
typed symbol is offered back — never an empty list, the v20 lesson).

Autocomplete and every other in-process call go to **service functions, never route functions**:
the 6-day autocomplete outage (C-05) was a FastAPI route called in-process whose `Query()`
default leaked through as an object. A rail forbids importing a router's endpoint function from
`api/services/discord_render/**`.

### 3.2 Runtime — bounded queue, dedicated workers (C-01, C-02, C-09)

`api/services/discord_render/runtime.py`

- **Thread-backed bounded queue** (`maxsize = DISCORD_RENDER_QUEUE_MAX`, default 48) drained by a
  **dedicated** `ThreadPoolExecutor` (`DISCORD_RENDER_WORKERS`, default 6) — not Starlette
  BackgroundTasks, not the anyio pool. Member jobs can no longer consume the dashboard's 64 threads
  and the dashboard can no longer starve member jobs. (**OI-02**: D-01 allowed an asyncio queue; a
  thread-backed one is chosen because the failure being closed is the event loop itself.)
- **Two lanes.** Interactive (commands, controls, popups, retries) and background (hot warm, roster
  seed). A worker takes background work only when the interactive lane is empty, and at most
  `DISCORD_RENDER_BG_MAX` (default 2) background jobs run at once. The warm cycle stops being a
  22-second fixture on the shared scheduler thread (4,750 over-budget cycles in 14 days).
- **Queue-position feedback.** A slash-command job that has waited > 2 s edits its deferred reply
  once: `Queued — position N · id abcd1234`. Control clicks (`type 6`) get no text edit — it would
  overwrite the chart the member is looking at.
- **Deadline watchdog.** Every job carries `deadline = created + 15 s`. At the deadline with no
  artifact delivered, the watchdog sends the failure message (§3.5) **while the job keeps
  running**; if it finishes inside the token's 15-minute life it replaces the message with the
  artifact. Never silence, never a spinner forever (S3).
- **Coalescing.** Identical `(command, normalized args, data version)` in flight share one
  production; followers wait up to their own deadline (§3.6).

### 3.3 Durable jobs + restart recovery (C-01, C-11, S7)

`api/services/discord_render/jobs_store.py` — its own SQLite file,
`DISCORD_RENDER_DB_PATH` (default `/data/discord_render_jobs.db`), WAL, `busy_timeout` 5 s, one
writer thread. Its own file so a lock here can never wait on `bars.db` or `auth.db`.

```
discord_render_jobs(
  corr_id TEXT PRIMARY KEY, interaction_id TEXT, created_at REAL, command TEXT, kind TEXT,
  args_json TEXT, user_id TEXT, guild_id TEXT, channel_id TEXT, app_id TEXT,
  token TEXT NULL,              -- 15-minute bearer; NULLED at terminal state, purged at 16 min
  ephemeral INT, interaction_type INT,
  state TEXT,                   -- queued | running | delivered | messaged | abandoned | superseded
  lease_owner TEXT, lease_until REAL, attempts INT, resumed INT,
  ack_ms REAL, queue_ms REAL, first_image_ms REAL, final_ms REAL,
  outcome TEXT, failure_class TEXT, detail TEXT, quality TEXT,   -- house | standin | cached | text
  cache_hit INT, render_attempts INT, renderer_status TEXT, discord_status TEXT,
  pod_boot_ts REAL, commit TEXT, updated_at REAL)
```

- The job row is written **by the writer thread**, not the handler: `offer()` returns after the
  in-memory put; the row lands within milliseconds. A crash in that window loses one job; it is
  the only such window and it is recorded as a known limit.
- **Lease.** A running job heartbeats `lease_until = now + 20 s` every 5 s.
- **On shutdown** (lifespan, inside uvicorn's 5 s grace): release every running lease
  (`lease_until = now`) so the next pod can take them at once.
- **On boot** (`resume_pending()`): claim rows in `queued|running` whose lease has expired and
  whose `created_at` is within 13.5 minutes (compare-and-set on `lease_owner`), and re-run them
  with `resumed = 1`. Older rows → `abandoned`; if the token is still inside 15 minutes a
  follow-up says *"UCT restarted while this was rendering — please run it again · id …"*.
- **Double-delivery guard.** Before any PATCH a worker re-reads its row: if the lease is no
  longer its own, it does not send. The old pod finishing after the new pod reclaimed cannot
  double-post.
- **Retention.** Rows kept 30 days without tokens — they ARE the SLO store and the forensic
  record the last two weeks did not have.

### 3.4 Delivery — `DiscordClient` (C-03, C-04, C-11)

`api/services/discord_render/delivery.py`

- **Every result is checked and classified.** `10015` → `ack_late`; `50035` with a `components`
  path → `discord_rejected:components` (never reachable once §3.4 validation runs — railed);
  `50035 ATTACHMENT_NOT_FOUND` → `discord_rejected:attachments`; `40005` → `too_large` (size guard
  retries); `50013` → `permission`; 5xx/timeouts → retry.
- **429:** honour `retry_after` (body) / `Retry-After` (header) when it fits the job's remaining
  deadline; otherwise fail honestly with `rate_limited`. Per-route bucket memory.
- **5xx / transport:** exponential backoff with jitter, 0.5 s → 1 s → 2 s, max 3 tries, bounded by
  the deadline.
- **Size guard:** before upload, if the PNG exceeds `DISCORD_RENDER_ATTACH_MAX_BYTES` (default
  8 MiB — the conservative floor), re-encode (optimize → 256-colour quantize → 0.75× downscale steps)
  until it fits; record `resized`.
- **Pre-flight validation of every component tree and payload**, locally, against Discord's
  rules: ≤5 rows, ≤5 buttons/row, select ≤25 options and ≤1 default, `custom_id` ≤100 and unique,
  label ≤80, placeholder ≤150, emoji drawn from an allow-list of real unicode emoji actually used
  (the ▲ that stripped every chart's controls for a week would have failed this in CI), content
  ≤2000. A tree that fails is a **test failure**, and at runtime is dropped with a recorded class
  rather than sent.
- **No stale attachment re-declarations.** The context line is composed **in parallel with the
  render** and folded into the image PATCH; a context line not ready when the image is gets
  dropped for that message, not sent as a second edit (**OI-04**). This removes the only code
  path that re-declares attachment ids, which is where the 23 double-failed
  `ATTACHMENT_NOT_FOUND` edits came from (see `01` for the evidence and the one open question).

### 3.5 Failure message contract (D-05, S3, S7)

`api/services/discord_render/contract.py` — one function builds every user-visible failure:

`"/chart NVDA failed — the chart service took too long · id 7f3a9c21 · retry?"` + one row: **[Retry]**
(`custom_id = rt|<corr_id>`, re-enqueues the stored args; ephemeral when the original was).

| class | plain English |
|---|---|
| `ack_late` | Discord closed the request before we answered |
| `queue_full` | we're at capacity right now |
| `deadline` | the chart service took too long |
| `renderer_unavailable` | the chart renderer is unavailable (a simplified chart was sent instead) |
| `data_unavailable` | market data for this symbol couldn't be loaded |
| `symbol_not_found` | I don't have that symbol (user error; ephemeral, with suggestions) |
| `flow_timeout` | the options-flow service didn't answer in time |
| `flow_unavailable` | the options-flow service is unavailable |
| `flow_error` | the options-flow service returned an error |
| `discord_rejected` | Discord refused the message |
| `rate_limited` | Discord is rate-limiting us |
| `restarted` | UCT restarted while this was rendering |
| `internal` | something went wrong on our side |

No stack trace, exception text or URL ever reaches a member (railed on the builder's output).

### 3.6 Artifact cache + coalescing (D-02, C-01)

`api/services/discord_render/cache.py`, flag `RENDER_CACHE_ENABLED`.

- **Key:** `sha1(command, normalized args incl. prefs signature, data_version)`. `data_version`
  for a chart = `(last bar t, last close, session_state)`; for a flow card = `(window end,
  contract_count, net bull/bear/unclassified)`.
- **TTL by session state (D-02):** RTH 30 s · extended 120 s · closed until the next session open.
- **On the volume:** `DISCORD_RENDER_CACHE_DIR` (default `/data/discord_render_cache/`), LRU by
  bytes (`DISCORD_RENDER_CACHE_BYTES`, default 512 MiB). ⭐ A cache that survives the 8-minute pod
  is a different product from one that does not.
- **Cached reply stamp:** a hit within TTL posts with `cached 14:32:05 ET` in the message.
- **Degraded artifacts are cached apart:** stand-ins 60 s (the 2026-08-27 lesson), cached flow
  cards only as a labelled fallback.

### 3.7 Renderer pool (C-06, C-09, C-13)

`services/chart_renderer/app.py`, flag `RENDER_POOL_ENABLED` (renderer service env).

- **Boot warm:** launch Chromium in the lifespan, run one hermetic warm-up render
  (`/r/chart?fixedbars=ramp200`, no data fetch) before `/health` reports `ready: true`.
- **Pool:** pre-created browser contexts sized for the house viewport; a render borrows one and
  returns a fresh one. Measured gain decides whether page reuse is kept (v15 measured 0.4 s).
- **Recycle:** a new browser after `RENDER_RECYCLE_AFTER` renders (default 500) or when RSS
  exceeds `RENDER_RSS_CEILING_MB` (default 2,500); in-flight renders drain on the old one.
- **Hard timeout:** `RENDER_HARD_TIMEOUT_S` (default 20) around the whole render; on expiry the
  context is closed (the page dies) and the response is `504` with a reason.
- **Priority:** `X-Render-Priority: background` requests are capped at
  `RENDER_BACKGROUND_SLOTS` (default 2) of `RENDER_MAX_CONCURRENT`.
- **`/health`:** `ready, browser_connected, renders_total, renders_since_recycle, active, queued,
  rss_mb, last_render_ms, p95_render_ms, recycles`.
- **Correlation:** reads `X-Correlation-Id` and prints it on its one-line render log.
- **Log hygiene (C-13):** never logs a query string. Playwright's call log (which printed the full
  URL including the render token) is caught and reduced to the path.
- **Web side:** a circuit breaker on the renderer (open after 5 consecutive failures, or ≥50 %
  of the last 20; half-open probe every 15 s). Open → the labelled stand-in immediately.
- **Deploy swap on web (C-01):** `422 selector not found` and a page-load timeout are
  "page not served" signatures; one retry after 1.5 s if the deadline allows, then the stand-in.

*Built in 2.3* (`services/chart_renderer/app.py`; measured against real Chromium in `05`): log
hygiene, the hard ceiling (504) and the correlation log line are **unconditional**; boot warm, spare
contexts (kept — the one measured gain), recycle with the replacement launched at retire time, and
the background cap are behind `RENDER_POOL_ENABLED`. Web sends `X-Correlation-Id` from the V2 job
(a thread-local binding, carried across the multi-chart pool) and `X-Render-Priority: background`
from the warm cycle, and scrubs the renderer's error body before logging it. Where it differs from
the text above: the hard ceiling defaults to the budget the request declares, not 20 s (**OI-18**);
the boot warm is hermetic plus an optional `RENDER_WARM_URL`, because `/r/chart` refuses a request
without the render token and the renderer does not hold it (**OI-17**). `/health` also reports
`pool_enabled, pool_hits, pool_misses, timeouts, failures, launch_error`. The web-side breaker and
the deploy-swap retry are 2.4.

### 3.8 Data layer — one resolver, one clock, a freshness envelope (C-07, C-10, D-04)

- **Symbol resolution** `api/services/discord_render/symbols.py::resolve(sym)` composes the
  authorities the app already has, in one place: `breadth_symbols.is_breadth_symbol` ·
  `bars.is_index` · `delisted_registry.resolve` · `entity_master.resolve` (aliases, renamed
  tickers) · `cap_universe` · presence in the bars store. The Discord path uses it; nothing in the
  bot keeps symbol logic of its own. Suggestions: entity-master alias hit first, then
  `ticker_search` exact/prefix/substring, then edit distance 1 over the universe; ≤3.
- **Market clock** `freshness.session_state(now)` → `holiday | weekend | pre | rth | post |
  overnight`, using `bars_fetch._NYSE_HOLIDAYS_YYYYMMDD` (the one closure list) — no second table.
- **Freshness envelope** on every fetched payload:
  `{as_of_utc, as_of_et, provider (serve layer), session_state, age_s, budget_s, stale}`.
  Budgets: intraday in RTH = 2 × the bar interval; daily in RTH = today's bar present; pre/post =
  the last session's bar; closed = the last completed session.
- **STALE badge:** the house page draws it (`?stale=<as_of>` on `ChartRender.jsx`; not a partner
  file), the stand-in draws it, the message content says `⚠ data as of … (stale)`; it is logged.
- **Vintage, not wall clock:** the footer stamps the data's `as_of`, so the same closed-market
  input renders the same pixels (determinism, §3.10).
- **Timeouts per dependency:** bars 8 s (executor future) · quote 1.5 s · context 1.5 s ·
  flow-worker 10 s (connect 2 s) · renderer 20 s. **Retries with jitter:** bars one retry after
  0.4–0.9 s (was a fixed 1.5 s). **Breakers:** renderer, flow-worker, quote.
- **Flow degraded mode (C-08):** flow-worker timeout / 5xx / breaker open → the last good card for
  that `(ticker, days)` if ≤10 minutes old, labelled `cached hh:mm ET — live flow unavailable`;
  otherwise the honest class message. "The flow feed is reconnecting" is retired: it was the
  message for every cause, including the three that were not a reconnect.

*Built in 2.4a* (`api/services/discord_render/symbols.py`; measured on production data in `05`):
symbol resolution at the ack for `/chart` (compare tickers included) and `/flow`, inside a 0.6 s budget
on its own threads, failing OPEN on a timeout, an error, or an unloaded search index. One authority
was added to the list above after measuring production: when every static authority misses,
`/api/bars` itself decides, and only its `symbol_not_carried` answer refuses (^GSPC is in no static
authority and charts). Suggestions rank symbol-prefix matches, then one edit away in the universe,
then symbols merely containing the input, then name matches. `/flow` reads the `etfs` partition for an
ETF or index underlying (`massive_processor.is_index_source`, then the liquid-ETF list) — C-14, on the
V2 path only. Kill switch: `DISCORD_RENDER_V2_SYMBOLS_ENABLED`. The market clock, the freshness
envelope, the STALE badge, per-dependency timeouts and breakers, and the cached flow card are 2.4b.

### 3.9 Observability (C-12)

- **Correlation id** = 8 hex chars of `sha1(interaction_id)` — deterministic, shown to the member,
  on every log line, in the jobs row, sent to the renderer as `X-Correlation-Id` and to flow-worker
  as a `cid` query parameter (it lands in flow-worker's access log with **no change to a
  flow-worker or partner file**).
- **Structured logs:** one JSON object per event, logger `discord_render`, always containing the
  searchable token `drender` (Railway search cannot match brackets — measured) and
  `{evt, cid, cmd, sym, tf, hop, ms, outcome, cls, attempt, status}`.
- **Metrics** are queries over the jobs table (durable) plus live gauges (queue depth, active,
  lanes, breaker states, renderer `/health`).
- **`GET /api/discord/render-health`** (PUSH_SECRET bearer or admin session) and the admin-only
  **`/renderhealth`** command (`default_member_permissions: "8"` **and** a backend check of the
  member's permission bits): SLO table per command (1 h / 24 h / 7 d), success and house-quality
  rates, queue, lanes, breakers, renderer health, cache hit rate, last 10 failures with class and id,
  running commit and pod uptime.
- **Alerts** to `DISCORD_RENDER_ALERT_WEBHOOK` (blank = off, **OI-08**): SLO breach (30-min p95
  final > 8 s with ≥10 jobs; 1-h success < 99.5 % with ≥20), renderer not ready for 2 probes,
  breaker open, ≥5 failures in 5 minutes, any job non-terminal at 60 s. Cooldown **durable** in
  the jobs DB (an in-memory cooldown resets every 8 minutes and pages on every pod).
  *Built in 2.2* (`observe.evaluate_alerts`, run every 60 s by `observe.Observer`): every rule above
  except **breaker open**, which arrives with the breakers in 2.4 — plus **any acknowledgement over
  3 s in the last hour** (S1's hard ceiling: Discord has already failed that interaction). A blank
  webhook still writes each alert as a `drender` log event under the same cooldown; a failed POST
  records no cooldown. The observer also runs `store.purge()` hourly.
- **Running SHA:** `/api/discord/render-health` reports `RAILWAY_GIT_COMMIT_SHA`, which is how
  every merge in `05-progress.md` proves the deployed code.

### 3.10 Consistency and quality

`04-visual-spec.md` is the one theme spec. Golden-image regression: stand-in and flow card
goldens run in pytest from committed fixtures (perceptual diff with tolerance); house-chart goldens
run through `tools/discord_render_goldens.py` against the hermetic `?fixedbars=` page and the
real renderer code path. Deterministic layout: no wall-clock text on any image.

### 3.11 Kill switches (all default OFF → declared `dark` in `docs/feature_flags.json`)

| Flag | Service | Scope |
|---|---|---|
| `DISCORD_RENDER_V2_ENABLED` | web | the whole V2 path; off = today's path exactly |
| `DISCORD_RENDER_V2_CHART_ENABLED` · `…_FLOW_ENABLED` · `…_BUZZ_ENABLED` · `…_CONTROLS_ENABLED` | web | per command, each ANDed with the master |
| `RENDER_CACHE_ENABLED` | web | volume artifact cache |
| `RENDER_POOL_ENABLED` | chart-renderer | pool, recycle, priority lanes (hard timeout and log hygiene are unconditional) |
| `DISCORD_RENDER_ALERT_WEBHOOK` | web | alert destination; blank sends nothing |

Rollback of the whole program is one variable: `DISCORD_RENDER_V2_ENABLED` unset.

---

## 4. Where it runs (and why not elsewhere)

Stays in `web` (D-01), isolated inside it: its own executor, its own SQLite file, its own cache
directory, durable lease-based resume. The alternative — a dedicated `discord-worker` Railway
service with narrow watch paths — would remove restart exposure for the job bookkeeping, but the
house page is still served by `web`, so a `web` swap still costs a render. **OI-03** recommends
revisiting it only if the V2 jobs table shows `resumed` rates that break S2 after 5 sessions.

---

## 5. Build order (Phase 2), each its own merge

| Step | Closes | Ships behind |
|---|---|---|
| 2.1 ack/queue/durable jobs/failure contract | C-01 C-02 C-11 S3 S7 | `DISCORD_RENDER_V2_*` |
| 2.2 correlation, structured logs, render-health, alerts | C-12 | V2 (health endpoint always on, read-only) |
| 2.3 renderer pool, hard timeout, log hygiene | C-06 C-09 C-13 | `RENDER_POOL_ENABLED` (renderer deploy) |
| 2.4 resolver, clock, freshness, breakers, flow degraded mode | C-05 C-07 C-08 C-10 | V2 |
| 2.5 volume cache + coalescing | C-01 | `RENDER_CACHE_ENABLED` |
| 2.6 delivery hardening + pre-flight validation | C-03 C-04 C-11 | V2 (validators also run in CI) |
| 2.7 visual spec + goldens | consistency | V2 (image changes only on the V2 path) |
| 2.8 one regression test per failure class | all | — |

---

## 6. Open decisions (mirrored in `LEDGER.md`)

| OI | Question | Recommendation (proceeding on it) |
|---|---|---|
| OI-01 | D-04 says refuse an unknown symbol in <1 s; v20 measured that the universe is not a gate (AEHL, TCEHY, FNMA, BTC-USD all chart and none are in it). | Refuse only when **every** authority (entity master, universe, bars store, breadth, index, delisted) misses; answer with suggestions **and** start a background warm so a re-run of a real ticker works. A first-time microcap costs one extra command, measured in the jobs table. |
| OI-02 | D-01 allows an asyncio queue. | Thread-backed bounded queue + dedicated executor: the class being closed is event-loop saturation. SQLite persistence exactly as D-01. |
| OI-03 | Stay in `web` or a dedicated worker service? | Stay in `web` with durable resume; revisit after 5 sessions of `resumed` data. |
| OI-04 | The context line is a second PATCH that re-declares attachment ids. | Fold it into the image PATCH; drop it for that message when it is late. |
| OI-05 | The warm cycle renders ~3,300 charts/day through the same 8 renderer slots members use. | Background lane: yields to members, ≤2 renderer slots; roster sized per session state as today. |
| OI-06 | The mplfinance stand-in says different things from the house chart and is unlabelled. | Label it on the image and in the message: "simplified chart — house renderer unavailable". |
| OI-07 | `/flow` says "the flow feed is reconnecting" for timeouts, 500s and restarts alike. | Per-class wording + ≤10-minute cached card labelled as cached. |
| OI-08 | Alert destination. | New `DISCORD_RENDER_ALERT_WEBHOOK`, ships blank; recommend the dev server's `#system-alerts`. |
| OI-09 | `/renderhealth` registration changes the app's command set. | Register at flip time (admin-only); the HTTP endpoint is the read path until then. |
| OI-10 | D-02's RTH TTL (30 s) is shorter than today's 120 s daily TTL. | Follow D-02; the durable cache and the background lane absorb the extra renders; measured in `05`. |
| OI-11 | Flow target = baseline × 0.5 may be unreachable for `days=all`, whose cost is flow-worker compute on a partner file. | Set per-window targets from `02`; `all` gets its own row; the compute budget belongs to flow-worker (OI-15). |
| OI-12 | `chart-renderer` has no repo source; it deploys with `railway up` from a local directory. | Deploy from a clean checkout of the exact merged commit, weekend/after-hours; recommend connecting the service to the repo with watch path `services/chart_renderer/**` (owner action). |
| OI-13 | The render token has been written to renderer logs in plaintext. | Ship the log fix (2.3), then rotate `CHART_RENDER_TOKEN` (owner action — it touches web and the SPA build var `VITE_CHART_RENDER_TOKEN`). |
| OI-14 | 77 web deploys/day is the root of C-01 for every feature on the pod, not only this one. | Out of this program's scope; recorded with the measurement. |
| OI-15 | flow-worker `/ticker-flow` has no internal time budget (9/11: Massive OI fallback >60 s while web gave up at 30 s). | Our side: 10 s timeout + cached card + honest class. Their side (partner file): a budget inside `_compute_ticker_flow` — raised, not built here. |

OI-16 onward were raised during the build and live **only** in `LEDGER.md` (one table, so the two
cannot drift): OI-16 the ETF partition, OI-17 the renderer warm-up URL, OI-18 the hard-ceiling default.
