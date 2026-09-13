# 00 — System map: Discord chart + flow rendering (as it runs today)

Measured from `origin/master` @ `f4fc5d1c1` (2026-09-13 08:58 CT) and from Railway, 2026-09-13.
Every claim names the file and function it was read from. Numbers marked **measured** come
from production logs or Railway's API; numbers marked **assumed** are budgets I have not yet
measured and are replaced by `02-baseline.md`.

---

## 1. What "the bot" is — there is no gateway bot in this path

| Thing | What it is | Chart/flow commands? |
|---|---|---|
| **UCT Intelligence** Discord app (`1474900505917653142`) | Its `interactions_endpoint_url` points at `https://uctintelligence.com/api/discord/interactions`. Discord POSTs every slash command, button click, select pick and autocomplete keystroke there as a signed HTTPS request. | **Yes — all of them.** |
| Local `discord.py` bot (`C:\Users\Patrick\uct_intelligence\bot\commands.py`) | Gateway bot: `/recall /watchlist /summary /ask /compare /status /save`. While the HTTP endpoint is set on the same app, gateway commands for that app are routed to HTTP too. | **No.** |
| "UCT Charts" app (`1541909310588719104`) | Created 2026-08-25, never activated (MFA-gated credentials). Carries the endpoint URL, no commands. | No. |

⭐ **Consequence for the brief:** "gateway reconnect handling" has no referent here — nothing holds a
websocket. The failure that plays that role is the **`web` pod restarting** with jobs in flight
(§4, §6-S3), which on this service happens on every master push.

Registration: `tools/discord_chart_commands.py register --global` PUTs `build_commands()`
(`api/services/discord_interactions.py`) → `chart · c · chartsettings · buzz · flow`, every one
stamped `GUILD_ONLY = {"integration_types":[0], "contexts":[0]}`.

---

## 2. Command inventory

Router: `api/routers/discord_interactions.py::discord_interactions` (one `async def` handles every
interaction type). Gates applied **before** any handler: public key set (else 503 = the kill
switch) → Ed25519 signature (`di.verify_signature`) → `di.guild_allowed` (only guilds
`882293203485720596` Uncharted Territory and `1524909611054792786` UCT Intelligence; no DMs, no user installs).

| Command / control | Options (defaults) | Channel gate | Initial response | Background job |
|---|---|---|---|---|
| `/chart`, `/c` | `ticker` (req, autocomplete; 1–4 symbols space/comma separated), `tf` (D/W/60/30/15/5; default = member's saved tf, else D), `compare` (≤3 symbols, id-budgeted). Retired `mas/volume/style/theme` still parse. | `CHART_FLOW_CHANNEL_ID` = `1546563720702853280` (#chart-flow-requests); refusal = ephemeral nudge | `{"type":5}` deferred, public | 1 symbol → `di.run_chart_job`; 2–4 → `di.run_multi_chart_job` |
| `/charts` (retired from the picker, handler live) | `tickers`, `tf` | same | `type 5` | `di.run_multi_chart_job` |
| Chart controls under a chart (buttons/select, `custom_id` `c2|…`, legacy `chart|…`, `zoom|ind|look|opt|…`) | state rides in the id (ticker, tf, mas, flags digit vol/expanded/darkpool, zoom, ind, style, theme, to, compare, control tag) | none (clicks under an existing chart always work) | `{"type":6}` deferred update (re-render in place) · help/save picks answer `type 7` · activity `type 12` | `di.run_chart_job` (or `run_multi_chart_job` for `m2|…`) |
| `/flow` | `ticker` (req, autocomplete), `days` (optional, autocomplete presets Today/7/30/63/126/all; free integer ≤400; default Today = `1`) | same channel | `type 5`, public | `run_flow_card_job` (router module) |
| "View chart" button under a `/flow` card (`flowchart|SYM`) | none (tf = member's saved tf; dark-pool overlay ON) | none | `type 5` **ephemeral** popup | `di.run_chart_job` |
| `/buzz` | `ticker` (optional, autocomplete from `buzz_store`), `window` (choices from `buzz_boards.WINDOW_LABEL`, default `open`) | none | ticker → `type 4` ephemeral text; bare + image enabled → `type 5` ephemeral | `run_buzz_image_job` (renderer board PNG) |
| `/chartsettings` | flat: tf, mas, theme, style, scale, indicators, zoom, volume, grid, watermark, ext, stats, reset | none | `type 4` ephemeral, synchronous | none |
| Autocomplete (`type 4` interaction) | chart/flow ticker → `fetch_ticker_choices` (in-process `ticker_search` + breadth symbols + "chart it" fallback); flow days → presets; buzz → `buzz_store.known_tickers` | none | `type 8` choices (**cannot be deferred**) | none |

**Who can invoke:** any member of the two allowed guilds who holds *Use Application Commands* in
the channel. Per-member throttle `di.user_rate_check`: `DISCORD_CHART_USER_RATE` default `12/60`,
**one budget shared by `/chart`, `/flow`, `/buzz` and every chart re-render** (each symbol of a
multi-chart counts once).

Scheduled image posts that **share the same renderer** but are not commands (capacity neighbours):
`_discord_chart_hot_warm` (every `DISCORD_CHART_WARM_INTERVAL_S`=60 s, 20 s budget, `api/main.py`),
`_start_chart_renderer_warm_background` (one SPY render 40 s after **web** boot), the index-close
post (`register_discord_index_close_job`, 15:45 + 15:58 ET), the buzz digest (`discord_buzz_digest`,
seven slots/session).

---

## 3. Request path per command

### 3a. `/chart NVDA` (single symbol) — and every chart button click

```
Discord ──HTTPS──▶ Cloudflare ──▶ Railway edge ──▶ web (uvicorn, ONE process, ONE event loop)
  POST /api/discord/interactions        api/routers/discord_interactions.py::discord_interactions  [async]
    ├─ _public_key()  →  503 if unset                                  (kill switch)
    ├─ di.verify_signature (PyNaCl Ed25519)                            ~ms, on the loop
    ├─ di.guild_allowed · di.cmd_channel_ok
    ├─ _prefs_for(uid) → discord_chart_prefs.get_prefs                 ⚠ SYNC SQLite read ON THE EVENT LOOP
    ├─ di.parse_chart_requests / di.parse_component                    CommandError → ephemeral type 4
    ├─ di.user_rate_check                                              throttle → ephemeral type 4
    ├─ breadth_adjust (imports breadth_symbols)                        on the loop
    ├─ background.add_task(di.run_chart_job, …)                        Starlette BackgroundTasks
    └─ return {"type":5}  (slash)  |  {"type":6}  (button)             ◀── THE ACK
                                                                        (sent BEFORE the task runs)
  ── after the response, same request task, anyio threadpool (shared, total_tokens=64, api/main.py:2846) ──
  di.run_chart_job(app_id, token, req, bars_fn, render_fn, edit_fn, house_fn, prefs, quote_fn, components_fn, context_fn)
    ├─ hotset.record(key)                                              key = SYM:tf:<style sig>[:to][:vs:…][:dp]
    ├─ png_cache.get(key) ── HIT ──▶ edit_fn(PNG) ─▶ _context_follow_up ─▶ "ok"
    └─ MISS: png_cache.single_flight(key, produce_chart)               concurrent callers share one production
         worker thread "discord-chart-produce"; job thread join(timeout=DISCORD_CHART_FAST_AFTER_S=3.0)
         │   if still running → send_fast_preview (mplfinance stand-in PATCH) then join() unbounded
         ▼
       di.produce_chart
         ├─ RENDER_SLOTS.acquire(blocking=False)                       busy → "Busy, try again in a few seconds."
         ├─ _fetch("D", 260) → bars_warm_gate() → router.fetch_bars → api.routers.bars.serve_bars (IN-PROCESS)
         │      memory → SQLite /data/bars.db (busy_timeout 2 s on web) → disk → Massive/yfinance fetch-on-miss
         │      retry ×1 after BARS_RETRY_DELAY_S=1.5
         ├─ _fetch(tf, max(page_fetch_bars(tf,deep), 5000))           pre-warm the PAGE's own fetch
         ├─ compare symbols warmed (2000 bars each)
         ├─ quote_fn → massive.get_batch_rich_snapshots → Pre/Post chip
         ├─ darkpool (popup) → darkpool_db.get_ticker_zones (web-local darkpool.db)
         ├─ house_fn = discord_chart_house.render_house_chart
         │      build_render_url → https://uctintelligence.com/r/chart?sym&tf&w&h&token&stats(b64)&…
         │      httpx.Client(timeout=60) POST http://chart-renderer.railway.internal:8080/render
         │         attempt 1: settle 300 ms, ready ≤15 000 ms   │ attempt 2: settle 3000 ms, ready ≤25 000 ms
         │      judge: X-Chart-Probe bars ≥ 2 → PNG magic → body grey std-dev ≥ 6.0
         │      ──▶ PNG  →  ("ok", png, NVDA_D_2026-09-11_Chart.png)
         └─ house None → mplfinance render_chart_png (1920×1080, _PLOT_LOCK) → ("fallback", …)
    ├─ outcome ok/fallback → edit_fn = di.edit_original                PATCH webhooks/{app}/{token}/messages/@original
    │      multipart payload_json + files[0], httpx 15 s                 (return value NOT checked — §6-S1)
    ├─ fallback → schedule_stand_in_heal (daemon thread: 45 s, 120 s; 2 slots)
    └─ _context_follow_up → discord_chart_context.context_line → 2nd PATCH (keep_attachments)

  chart-renderer (services/chart_renderer/app.py, Playwright python v1.47.0, uvicorn :8080 on ::)
    POST /render → check_secret → check_url (RENDER_ALLOWED_HOSTS) → render_png
      _get_browser()  (ONE chromium, launched lazily on the first render after boot; relaunched only if disconnected)
      async with Semaphore(RENDER_MAX_CONCURRENT=8):
        browser.new_context(viewport 1336×738, dsf 2) → page.goto(url, wait_until="load", timeout = ready+6000)
        → wait_for_function(ready_js)  (timeout is logged, NOT fatal — the shot is taken anyway)
        → wait settle → locator('#chart-export').screenshot → probe_js → close context
      the page itself (app/src/pages/ChartRender.jsx) is served by WEB and fetches /api/bars from WEB
      (proxied to bars-api only when BARS_PROXY_ENABLED=1 AND BARS_PROXY_PCT>0; api/routers/bars.py::_bars_proxy_should_route)
```

Readiness contract on the page (`ChartRender.jsx`): `window.__chartBarsReady` (StockChart
`onBarsReady` + `onComparisonsReady`), `window.__chartReady` (pixels held still),
`window.__chartBarCount` (drawn candles, read back as `X-Chart-Probe`). Vintage: footer appends
`· data as of <date>` when `stats.as_of` ≠ today ET (`dataVintage`, line ~786).

### 3b. `/chart NVDA AMD AVGO` and the `/charts` timeframe row

`di.run_multi_chart_job`: per item `png_cache` hit → else `_warm_bars` **sequentially** for every
symbol (bars-store write lock) → `ThreadPoolExecutor(max_workers=min(n,4))` → `produce_chart(…,
slot_wait=25.0)` → ONE `edit_fn(pngs=[…])` with the `m2|SYM+SYM|tf` row. Failures named
(`Skipped: X (no bars)`); crash → `"Charts failed, try again."`.

### 3c. `/flow DPRO 30`

```
router: channel gate → rate → di.parse_flow_command → background.add_task(run_flow_card_job) → {"type":5}
run_flow_card_job (api/routers/discord_interactions.py)
  ├─ httpx.get(WORKER_INTERNAL_URL + "/api/live/massive/ticker-flow", params symbol/days/source=stocks, timeout=30)
  │     flow-worker: api/live_massive_router.py::ticker_flow → _compute_ticker_flow           [partner-owned, flow-worker watched]
  │        _ticker_flow_cache (TTL 60 s) → _build_by_contract(today, stocks, 1, True, lookback≤400, only_ticker)
  │        → block-only filter (_contract_has_sweep_map) → expired filter → net bull/bear/unclassified
  │        → massive_oi_snapshots.fetch_chain_price_oi (urllib, HTTP_TIMEOUT_SEC) → oi_snapshots.get_history
  │  (fallback when WORKER_INTERNAL_URL unset: lmr._compute_ticker_flow in-process)
  ├─ not ok / exception → "⚠️ The flow feed is reconnecting — couldn't read X right now."   (§6-S4: same words for EVERY cause)
  ├─ no contracts → "X — no significant options flow today."
  ├─ api/flow_ticker_card.py::render_ticker_flow_card (PIL, DejaVuSans, 1180 × (156+40n+54) px, supersampled)
  └─ edit_original(png, components=flow_components → "View chart" flowchart|SYM)                (return NOT checked)
```

### 3d. `/buzz` (bare)

Router builds the board text in `run_in_threadpool` → `type 5` ephemeral →
`run_buzz_image_job` → `buzz_image.render_board_png` (60 s cache, single-flight lock 20 s,
**takes a `RENDER_SLOTS` slot** with an 8 s wait) → renderer `/r/buzz` 1400×2400 @2x, 45 s timeout
→ `edit_original` (image, or the text alone on any failure — by design).

---

## 4. Where it runs

| Service | Source / deploy trigger | Restart behaviour | What it does for this path | Env (names only; values that matter) |
|---|---|---|---|---|
| **web** | repo `master`; watch patterns `[]` = **every push rebuilds it** | **measured: 1,077 deployments 2026-08-30 → 2026-09-13** (Railway GraphQL; ≈77/day, 20 before 10:00 ET on a Sunday). `railway.json`: `exec` uvicorn, `--timeout-graceful-shutdown 5`, `drainingSeconds 30`, healthcheck `/api/health`. A restart kills every in-flight BackgroundTask after ≤5 s of grace. | endpoint, every job, PNG cache, hot set, prefs DB (`/data/discord_chart_prefs.db`), bars reads, flow card PIL render, mplfinance stand-in, **and the `/r/chart` + `/r/buzz` pages the renderer screenshots** | `DISCORD_CHART_PUBLIC_KEY` (set) · `DISCORD_CHART_APP_ID`=1474900505917653142 · `CHART_RENDERER_URL`=http://chart-renderer.railway.internal:8080 · `CHART_RENDERER_SECRET` (set) · `CHART_RENDER_TOKEN` (set) · `CHART_RENDER_BASE_URL`=https://uctintelligence.com · `DISCORD_CHART_MAX_CONCURRENT`=**8** · `CHART_FLOW_CHANNEL_ID`=`FLOW_CMD_CHANNEL_ID`=1546563720702853280 · `WORKER_INTERNAL_URL`=http://flow-worker.railway.internal:8080 · `DISCORD_ACTIVITY_GUILDS`=off · `BUZZ_DIGEST_ENABLED`=1 · `DISCORD_INDEX_CLOSE_ENABLED`=1 · unset (code defaults apply): `DISCORD_CHART_USER_RATE`, `…_FAST_FIRST`, `…_FAST_AFTER_S`, `…_SELF_HEAL`, `…_HOTWARM_ENABLED`, `…_QUIET_TTL`, `…_CACHE_BYTES`, `…_WARM_*`, `…_ROSTER_*` |
| **chart-renderer** | **no repo source** (`source.repo = null`); deployed by `railway up services/chart_renderer --path-as-root -s chart-renderer` from a linked dir; watch `[]` but nothing to watch | Last deploy **2026-09-01 01:53 UTC** (measured). Exactly **1** `chromium launched` line in 12 days → the browser has never been recycled. A restart drops every in-flight render (the TCP connection from web resets → `render_house_chart` returns None → stand-in). | headless Chromium screenshots; `RENDER_MAX_CONCURRENT`=**8**; allowlist `uctintelligence.com,web-production-05cb6.up.railway.app` | `CHART_RENDERER_SECRET`, `PORT`=8080, `RENDER_ALLOWED_HOSTS`, `RENDER_MAX_CONCURRENT`=8 — no memory/recycle settings exist |
| **flow-worker** | repo, narrow watch list (`docs/runbooks/deploy-windows.md`); `api/live_massive_router.py` **is on it** and is **partner-owned** | Restart = OPRA tape gap (permanent until T+1). Rare: 19 of its last 20 deployments `SKIPPED`. | serves `GET /api/live/massive/ticker-flow` over the private network | — |
| **bars-api** | repo, `api/**` | redeploys on any `api/**` push | serves `/api/bars` for the page's fetch **only** when `BARS_PROXY_ENABLED=1` and `BARS_PROXY_PCT>0` | `BARS_API_ENABLED=1` |

Resource limits: none configured per service for this path. The renderer's host cgroup was
measured at 32 GB / 32 vCPU with the process at 604 MB (commit `81397162e`, 2026-08-30). The web
pod is one process: **one event loop + one anyio threadpool of 64** shared with every sync route
in the dashboard.

---

## 5. Timeouts, retries, caches, locks — every one in the path

| Where | Knob | Value | File |
|---|---|---|---|
| ack | none; the handler awaits nothing but the body | — | router |
| ack | sync SQLite prefs read / write, ticker search, breadth import **on the event loop** | unbounded | router `_prefs_for`, `_settings_reply`, save pick, `fetch_ticker_choices` |
| job host | Starlette BackgroundTasks on the shared anyio limiter | 64 tokens | `api/main.py:2846` |
| render valve | `RENDER_SLOTS` BoundedSemaphore | 8 (env) — single chart **non-blocking**, multi/warm wait 25 s, buzz waits 8 s | `discord_interactions.py` |
| bars gate | `BARS_WARM_SLOTS` | 1 slot, 30 s acquire then proceeds anyway | same |
| bars retry | `BARS_RETRY_DELAY_S` | 1 retry after 1.5 s | same |
| stand-in | `DISCORD_CHART_FAST_AFTER_S` | 3.0 s | same |
| house render | `RENDER_TIMEOUT_S` (httpx) | 60 s | `discord_chart_house.py` |
| house render | `_ATTEMPTS` | (300 ms, 15 000 ms), (3 000 ms, 25 000 ms) | same |
| renderer | page default timeout | ready + 6 000 ms (21 s / 31 s) | `services/chart_renderer/app.py` |
| renderer | `RENDER_MAX_CONCURRENT` | 8 (env) | same |
| renderer | browser recycle / max renders / memory ceiling / per-render kill | **none** | same |
| judge | `MIN_DRAWN_BARS` / `_MIN_BODY_STDDEV` | 2 / 6.0 | `discord_chart_house.py` |
| cache | PNG TTL | D/W/M 120 s · intraday 60 s · quiet (weekend / 20:00–04:00 ET) 900 s · stand-in 60 s | `discord_chart_cache.py` · `FALLBACK_TTL_S` |
| cache | byte budget | 96 MB LRU | same |
| cache | `single_flight` waiter | 75 s; result kept 2 s | same |
| hot set | keys / recency / refresh point | 24 / 3600 s / 70 % of TTL | `discord_chart_hotset.py` |
| warm cycle | interval / budget / renders | 60 s / 20 s / 12 live · 16 quiet; roster 10 live · 24 quiet | `api/main.py`, `discord_interactions.py` |
| self-heal | delays / slots | 45 s, 120 s / 2 | `discord_interactions.py` |
| Discord PATCH | `edit_original` httpx | 15 s, **no retry on 5xx / 429 / timeout**; 4xx+components → retry without rows; 4xx+image → text note | same |
| Discord follow-up / read-back | httpx | 15 s, no retry | same |
| flow fetch | httpx to flow-worker | 30 s, no retry | router `run_flow_card_job` |
| flow compute | `_TICKER_FLOW_TTL` | 60 s | `live_massive_router.py:4362` |
| context line | per-ticker cache | 30 min | `discord_chart_context.py` |
| buzz image | cache / flight / slot / render | 60 s / 20 s / 8 s / 45 s | `buzz_image.py` |
| throttle | per member | 12 per rolling 60 s, all commands | `discord_interactions.py` |
| alerts | `chart_health_alerts` | in-memory deque(200), wiped every deploy; critical → `DISCORD_WEBHOOK_URL`, 30 min cooldown | `chart_health_alerts.py` |

---

## 6. Every place a failure can end without a user-visible message

| # | Where | What the member sees |
|---|---|---|
| S1 | `run_chart_job` / `run_multi_chart_job` / `run_flow_card_job` ignore `edit_fn`'s return. A final PATCH that times out (15 s), gets 5xx or 429, or fails DNS returns `False`; the job returns `"ok"`. | slash: "thinking…" until the token dies (15 min); button: nothing changes |
| S2 | `run_chart_job`'s outer `except Exception` logs and returns `"error"` **without editing**. (`run_multi_chart_job` does send "Charts failed".) | "thinking…" forever |
| S3 | A `web` restart while a BackgroundTask is running. Nothing is persisted; the new pod does not know the interaction existed. ≈77 restarts/day measured. | "thinking…" forever |
| S4 | `/flow`: every non-ok read (timeout, flow-worker 500, JSON error, `ok:false`) reads "The flow feed is reconnecting". | a message, but it names the wrong cause |
| S5 | Router exceptions not wrapped (e.g. `handoff.record`, an import error) → FastAPI 500. | "The application did not respond" / "Interaction failed" |
| S6 | Ack blocked past 3 s by the shared event loop (sync SQLite + ticker search run on it). Discord discards the late response; the background task still runs and its PATCH 404s (unknown interaction). | "The application did not respond" |
| S7 | Button clicks (`type 6`) whose re-render fails for any reason in S1/S2. | the old chart stays; no indication |
| S8 | `edit_original` component-strip retry that also fails → `False` → ignored. | "thinking…" forever |
| S9 | Stand-in delivered because the house render failed — delivered, but **unlabelled**: a different MA set, window and no ext chip, with nothing saying it is degraded. | a chart that is not the house chart and does not say so |
| S10 | Heal, context line, follow-up receipts — logged only (the member already has the chart; acceptable). | nothing (acceptable) |

There is **no correlation id** anywhere: the interaction id and token are never logged, job
outcomes are returned to Starlette (which discards them), and a member's report cannot be matched
to a log line except by timestamp and ticker.

---

## 7. Discord constraints in play

| Constraint | Value | How this code meets it today |
|---|---|---|
| Initial response deadline | 3 s | defer (`type 5`/`6`) before the job — but the handler does sync I/O first (S6) |
| Autocomplete | must answer `type 8` within 3 s; cannot defer | in-process search on the event loop |
| Interaction token lifetime | 15 min (follow-ups and `@original` edits) | jobs usually finish in seconds; heal edits at 45 s / 120 s |
| Ephemeral | the flag must be on the DEFER; later PATCH flags are ignored | buzz + flow popup set it on `type 5` |
| Rate limits | interaction webhooks are outside the global bot limit but have per-route buckets; a 429 carries `retry_after` | **no 429 handling anywhere in the path** |
| Attachments | per-message file limit depends on guild boost tier; conservative floor 8 MiB (legacy) / 10 MiB (current default) | no size guard; measured house PNG ≈ 200 KB (2592×1340 @ 198 KB, 2026-08-25); multi = 4 of those |
| Components | ≤5 rows · ≤5 buttons/row · select ≤25 options, one `default` · `custom_id` ≤100 and unique per message · placeholder ≤150 · emoji must be a real emoji | railed (`compare_budget`, unique tags, 🔼 not ▲) |
| Content / embeds | 2000 chars content; embed title 256, description 4096, 25 fields, name 256, value 1024, footer 2048, total 6000 | content is sliced ad hoc (`[:1900]`); no embeds used |
| Whole-tree validation | one invalid component rejects the entire edit | `edit_original` retries without components |

---

## 8. Latency budget as I understand it (assumed until `02-baseline.md`)

```
member presses Enter
  │  Discord → CF → Railway → web                          ~100–300 ms
  ├─ verify + parse + prefs read + defer                    ~5–50 ms   (unbounded if the loop is blocked)
  │  ──────────── ACK (type 5) ─────────────────────────   target ≤ 1.0 s p99
  ├─ BackgroundTask starts                                  0 ms, or queued behind the 64-thread pool
  ├─ CACHE HIT → PATCH 200–400 KB multipart                 ~0.3–1.0 s          ═▶ delivered ≈ 0.5–1.3 s
  └─ MISS
      ├─ daily bars (warm store / cold provider delta)      0–50 ms / 0.5–20 s
      ├─ page-bars warm (5000)                              0–600 ms warm
      ├─ ext quote                                          ~0.1–0.5 s
      ├─ renderer wait for a slot (8, shared with warming)  0–? s
      ├─ page load + bars + held-still + screenshot         ~1.9–2.7 s warm (measured 2026-08-26)
      ├─ judge (PNG decode)                                 ~50 ms
      ├─ PATCH upload                                        ~0.3–1.0 s
      └─ context line lookup + 2nd PATCH                    ~0.2–0.5 s
                                                            ═▶ delivered ≈ 3–4 s warm, 10–60 s cold/degraded
  /flow: flow-worker compute (cached 60 s) + chain snapshot  ~0.5–5 s  → PIL card ~0.3 s → PATCH
```

---

## 9. Renderer load today (measured, 2026-09-01 → 2026-09-13, 42,769 renderer log lines)

| | Count |
|---|---|
| `POST /render` 200 | 39,311 (≈3,300/day) |
| `POST /render` 422 (`selector not found` — page not served) | 205 |
| `POST /render` 502 (all 133 = `Page.goto: Timeout 21000ms exceeded`) | 133 |
| ready predicate timed out (screenshot taken anyway) | 454 |
| chromium launches | 1 |

Most of that volume is the warm cycle and scheduled posts, not members: the most frequent
failing URLs are roster names (DELL, QMCO, LITE, FRVO, SVC, NESR, XFOR). The member-facing split
is in `01-failure-forensics.md`.

⚠️ **The render token is written to the renderer's logs in plaintext** — Playwright's call log
prints the full navigation URL (`…&token=…`) on every `Page.goto` timeout. Recorded as a
finding in `01`; the value is not repeated in these docs.
