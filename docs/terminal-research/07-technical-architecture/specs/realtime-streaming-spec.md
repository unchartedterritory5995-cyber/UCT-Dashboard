---
id: SPEC-D3-REALTIME-STREAMING
title: D3 — Realtime Streaming — Technical Specification
role: >
  Phase 3 deliverable. RATIFIES the realtime streaming machinery that already exists on
  origin/master and states what a second consumer (S7) would need from it. Docs only;
  nothing here authorizes code. Pairs with GATE-D3-REALTIME-STREAMING, whose approval
  block is EMPTY.
status: >
  SPEC ONLY — NOT BUILT, NOT AUTHORIZED. D3 is not a named system in the codebase; the
  machinery under it is live in production and is ratified here rather than designed.
date: 2026-09-12
measured_against: origin/master @ 5ff6fc04a
pairs_with: GATE-D3-REALTIME-STREAMING · SPEC-S7-ALERTS · SPEC-D2-CANONICAL-DATA-MODEL
---

# SPEC-D3 — Realtime Streaming

## 0. How every number in this document was obtained, and what was NOT measured

> **MEASURE IT, DO NOT QUOTE IT.** Every count, constant and path below was read from
> source in the working tree at `C:\Users\Patrick\uct-worktrees\s7-price-level` on
> 2026-09-12, this pass. Where a count appears, the method that produced it is stated
> beside it. Where something could not be measured, it says **not measured** rather than
> carrying an estimate.

⛔ **The one caveat that must be read first.** The frontmatter's
`measured_against: origin/master @ 5ff6fc04a` is the SHA this programme supplied. **This
pass ran no git commands and therefore did not verify that the working tree equals that
commit** — several `api/services/alert_taxonomy/*.py` files carry a working-tree mtime
later than the rest of the tree. Treat every `file:line` here as a **working-tree
reading**, correct as read, and re-derive any line number before acting on it.

⛔ **Line numbers drift; names do not.** Where a citation matters, the symbol name is
given alongside the line so the claim survives a shift.

**Not measured, deliberately, and named here rather than buried:**

| Question | Why not measured |
|---|---|
| How many `watchlist_alerts` rows the S7 dark cohort actually holds | Requires a read of production `auth.db`. No production probe was run this pass. |
| Live `bars_emitted_total` / `bars_dropped_total` / subscriber counts | `GET /api/admin/bars-stream-status` is a live-pod read; not performed this pass. |
| Whether `STREAM_BARS_ENABLED` is `1` on the `web` service right now | Only `railway variables --service web --kv` can answer it. Not run. The code path is read below; the flag STATE is not asserted. |
| Per-tick message volume of the Massive `A`/`T` channels at a given symbol count | `bar_stream.get_status()["feed"]` publishes exactly this (`bar_stream.py:457-481`) and it is a live read. Not performed. |
| Whether the browser pools behave as read under a real EventSource | No browser was driven this pass. Every frontend claim is a source reading. |

---

## 1. What D3 is, and what this spec is doing

**D3 Realtime Streaming is not a named system in the codebase.** There is no
`api/services/realtime/` package, no `D3` identifier, and no single module that owns the
concept. What exists instead is **two independent, production-live vendor→browser lanes**
that were each built for a specific product problem, hardened by a specific incident, and
never given a common name.

This spec **ratifies** those two lanes as D3. It does not propose a third, does not
propose merging them, and does not propose a rewrite. The reason is the same one D2's
gate gave for `closedTable.json`: *the codebase already has the idea, in production,
working* — what it lacks is the idea written down with one name so that a second consumer
can point at it.

⭐ **The strongest evidence that the machinery is ready to be ratified rather than
redesigned is that a second consumer seam already exists and is already used.**
`bar_stream.subscribe_symbols(symbols, owner="bars")` (`api/services/bar_stream.py:381`)
carries a per-symbol OWNER refcount (`_sub_owners`, `bar_stream.py:46`) whose docstring
names the exact scenario — *"independent consumers (the chart bars feed, owner `bars`; the
NH/NL print-exact tap, owner `nhnl`) share the one connection without one's unsubscribe
cutting the other's feed"* (`bar_stream.py:42-45`) — and
`bar_stream.add_trade_listener(fn)` (`bar_stream.py:427`) is the callback door that tap
uses. **A second consumer is a supported case today.** What is missing is narrower than
"a streaming layer", and §7 states it precisely.

---

## 2. (a) The topology

Two lanes. They are separate from the vendor socket all the way to the browser module,
and they cross in exactly two places, both of which are marked in the diagram.

```
════════════════════════════════════════════════════════════════════════════════════════
 LANE Q — QUOTES                                    LANE B — BARS
 (always started; not flag-gated)                   (gated on STREAM_BARS_ENABLED == "1")
════════════════════════════════════════════════════════════════════════════════════════

 VENDOR SOCKET
   wss://ws.finnhub.io?token=…                        wss://socket.massive.com/stocks
   realtime_stream.py:24  _WS_URL                     bar_stream.py:35  _WS_URL
   channel: trade                                     channels: AM.<s> · A.<s> · T.<s>
                                                      bar_stream.py:188-192
         │                                                     │
         │  refuse_if_local("finnhub")                         │  refuse_if_local("massive-bars")
         │  realtime_stream.py:526                             │  bar_stream.py:498
         │       └── api/services/vendor_socket_guard.py ──────┘   (ONE gate module, §3)
         ▼                                                     ▼
 INGEST                                              INGEST
   api/services/realtime_stream.py                     api/services/bar_stream.py
   thread "realtime-stream" (:536)                     thread "bar-stream" (:508)
   own asyncio loop (:531)                             own asyncio loop (:503)
   _run_websocket (:297)                               _run_websocket (:212)
   _process_finnhub_trade (:449)                       parse_aggregate_event (:78)
     └ trade_conditions.classify (:466)                _drain_pending_queue 250ms (:343)
   STORE: _prices dict + _lock (:27,:28)               _sub_owners refcount (:46)
   STORE: _last_seen dict (:45)                        _trade_listeners fan-out (:52,:326)
   SUBS:  _subscribed + _sub_counts (:32,:39)
         │                                                     │
         │  (also feeds realtime_candle.apply_tick             │  on_bar callback, wired in
         │   for 5 tfs — realtime_stream.py:500)               │  api/main.py:4536 _on_bar
         ▼                                                     ▼
 (no broadcaster on this lane)                       BROADCASTER
                                                       api/services/bar_broadcaster.py
                                                       BarBroadcaster (:69), singleton (:470)
                                                       init_broadcaster  ← api/main.py:4531
                                                       push_aggregate (:222)
                                                         T  path → 5 buckets  (:270)
                                                         AM/A path → 5 buckets (:338)
                                                       bucketing: bar_rollup.bucket_start (:38)
                                                       _partials / _am_partials (:73,:77)
                                                       _interest refcount (:87)   ◄── CROSS 1
                                                       _emit → per-(sym,tf) Queue (:421,:110)
                                                         throttle 100ms per key (:99)
                                                         AM bypasses throttle (:322)
                                                         drop-oldest on full (:405)
         │                                                     │
         ▼                                                     ▼
 SSE ENDPOINT                                        SSE ENDPOINT
   api/routers/stream.py                               api/routers/stream.py
   GET /api/stream/prices (:165)                       GET /api/stream/bars (:329)
   mounted api/main.py:7888                            same router, same mount
   cap 50 tickers (:181)                               cap 50 pairs (:359, inline literal)
   admission subscribe("prices") (:185)                admission subscribe("bars") (:363)
     MAX_SUBSCRIBERS 300 (:36)                           same counter, own registry (:41)
   realtime_stream.subscribe_tickers (:190)            bb.subscribe(sym,tf) per pair (:369)
   bb.add_interest(ticker_list) (:203) ─── CROSS 1 ──► reads the SAME broadcaster
   overlay: bb.get_last_price (:237) ──── CROSS 2 ──►  Massive price over Finnhub map
   loop sleep 0.25 every pass (:306)                   loop sleep 0.25 only when idle (:395)
   heartbeat 15s named event (:298)                    heartbeat 15s named event (:397)
         │                                                     │
         ▼                                                     ▼
 BROWSER POOL                                        BROWSER POOL
   app/src/lib/priceStreamManager.js                   app/src/lib/barsStreamManager.js
   MAX_SSE_TICKERS 50 (:24)                            MAX_BARS_PAIRS 50 (:20)
   union → 50-ticker buckets (:86,:99)                 union → 50-pair buckets (:148,:160)
   400ms rebuild debounce (:25)                        400ms rebuild debounce (:21)
   watchdog 30s / tick 10s (streamStatus.js)           watchdog 45s / tick 10s (:26,:27)
   publish throttle 1000ms (:48)                       bar throttle 500ms (:51)
   kill: uct.ssePool.disabled                          kill: uct.barsPool.disabled (:71)
                                                       delivering + hysteresis (:121-146)
         │                                                     │
         ▼                                                     ▼
 HOOK                                                HOOK(S)
   app/src/hooks/useRealtimePrices.js                  app/src/hooks/useRealtimeBars.js
     usePooledRealtimePrices (:100)                      gate VITE_REALTIME_BARS (:21)
     legacy per-instance fallback (:156)               app/src/hooks/useRealtimeBarPrices.js
     _streamSafe strips 9 stream keys (:52)              pickFreshPrice, 6s window (:8,:16)
     merge REST + stream (:123)
         │                                                     │
         ▼                                                     ▼
 COMPONENT                                           COMPONENT
   every quote surface (watchlist %, header,           app/src/components/StockChart.jsx
   theme %, chart legend) via the hook                 developing-bar writer B, gated on
                                                       `delivering` (§6)

 SIDE DOOR (lane B, in-process, no SSE):
   bar_stream.add_trade_listener(fn) (:427) → every T print, on the WS loop thread
   bar_broadcaster.add_interest(syms) (:160) + get_last_price(sym) (:203) → last price,
     no queue, no coroutine.  ⭐ THIS IS THE SEAM §7 RECOMMENDS FOR S7.
```

**Two crossings, both real, both worth naming because they are where "the two lanes are
independent" stops being true:**

- **CROSS 1 — interest.** `/api/stream/prices` registers Massive INTEREST for its tickers
  (`stream.py:199-205`, `bb.add_interest`). So the quote endpoint subscribes symbols on
  the **bars** vendor socket. This is deliberate and documented in place
  (`stream.py:191-198`): Finnhub's tier trickles, Massive does not.
- **CROSS 2 — price overlay.** The same handler overlays `bb.get_last_price(sym)["price"]`
  onto the Finnhub map before serialising (`stream.py:236-248`), and overlays
  `["volume"]` when present. **So the price a browser reads off `/api/stream/prices` is
  usually a MASSIVE price wearing the Finnhub lane's envelope.**

⚠️ **Both crossings are wrapped in `try/except` that sets `_bb = None`
(`stream.py:199-205`).** If the broadcaster was never initialised —
`bar_broadcaster.get_broadcaster()` raises `RuntimeError` when
`init_broadcaster` has not run (`bar_broadcaster.py:476`), and `init_broadcaster` runs
only under `STREAM_BARS_ENABLED == "1"` (`api/main.py:4529-4534`) — then **the quote
stream silently degrades to Finnhub-only and nothing says so.** That is a measured,
citable behaviour, not a hypothetical: the `except Exception: _bb = None` is the whole
mechanism.

---

## 3. The event contract, measured

**Method:** every `yield` in `api/routers/stream.py` was read and classified by whether it
carries an `event:` line. Every `addEventListener` / `onmessage` in the two browser pools
was read and matched against that list.

| Endpoint | Frames emitted | Where |
|---|---|---|
| `/api/stream/prices` | **7** — one unnamed `data:` frame + 6 named | `stream.py:259` (unnamed), `:265 tick`, `:267 bar_close`, `:273 bar_correction`, `:288 stale`, `:292 fresh`, `:299 heartbeat` |
| `/api/stream/bars` | **2** — both named, no unnamed frame | `stream.py:387 bar`, `:404 heartbeat` |

**Client coverage, with the control.** `priceStreamManager.js` handles all 7 —
`onmessage` (`:158`), `heartbeat` (`:187`), `stale` (`:189`), `fresh` (`:203`), `tick`
(`:217`), `bar_close` (`:226`), `bar_correction` (`:235`). `barsStreamManager.js` handles
both — `bar` (`:218`), `heartbeat` (`:249`). **Control for the absence claim "no frame
is unhandled":** the same read found 7 handlers against 7 frames and 2 against 2, i.e.
the method could have produced a mismatch and did not. Coverage is complete on both
pools this pass.

⭐ **The heartbeat is a NAMED event on both endpoints and that is load-bearing.** The
comment at `stream.py:398-403` states the mechanism: an SSE comment (`: keepalive`) keeps
the pipe warm through a proxy but is never surfaced to `EventSource` as a JS event, so a
client watchdog could not distinguish quiet-but-healthy from dead and would false-reconnect
a working stream. Both pools reset `lastMsg` on it (`priceStreamManager.js:187`,
`barsStreamManager.js:249`).

⚠️ **The bars lane's candle events do not travel on the bars endpoint.** `tick`,
`bar_close` and `bar_correction` are emitted by `/api/stream/prices`
(`stream.py:262-277`) and are sourced from `realtime_candle`, i.e. the **Finnhub** tick
state machine (`realtime_stream.py:497-506`), not from the broadcaster. A reader who
assumes "bar events come from the bars stream" is wrong in both directions.

---

## 4. (b) One connection per API key

> **The vendor allows roughly ONE live socket per API key. A local process holding the
> production key takes production's slot.**

**Where it is enforced — one module, two call sites, both at the process entry point:**

| | |
|---|---|
| The gate | `api/services/vendor_socket_guard.py` — `may_open(vendor)` (`:45`), `refuse_if_local(vendor)` (`:67`) |
| Production test | `on_production()` reads `RAILWAY_ENVIRONMENT` (`:42`) — deliberately reusing the variable `COOKIE_SECURE` already depends on, so a second private "am I in prod" signal cannot drift (`:35-40`) |
| Escape hatch | `ALLOW_LOCAL_VENDOR_SOCKETS=1` (`_OPT_IN_VAR`, `:29`) — opt-IN, failure direction is a quiet local chart |
| Quote lane call site | `realtime_stream.start_stream` → `refuse_if_local("finnhub")` (`realtime_stream.py:525-527`) |
| Bars lane call site | `bar_stream.start_stream` → `refuse_if_local("massive-bars")` (`bar_stream.py:497-499`) |

**Where it is documented, verbatim, in three places that agree on the fact and disagree
on the number:**

- `realtime_stream.py:513-517` — *"🔴 A LOCAL RUN MUST NOT TAKE PRODUCTION'S ONE
  CONNECTION SLOT. On 2026-08-10 six forgotten dev servers on the owner's PC held this
  exact socket with the production key; prod connected, was kicked ~1 s later, and looped
  into a circuit breaker for hours while live charts sat dead."*
- `bar_stream.py:491-496` — *"SAME SLOT-THEFT AS FINNHUB … `MASSIVE_WS_DRY_RUN=1` does NOT
  protect the connection slot"*, and states the reason the guard exists: the warning had
  existed for weeks as *a thing to remember*, and remembering is what failed.
- `vendor_socket_guard.py:57-64` — the operator-facing refusal sentence, logged verbatim.

⭐ **The placement is itself a ruling and it is written down.** `realtime_stream.py:519-524`
records why the gate sits at `start_stream` and NOT inside the reconnect loop: *"the
decision 'should this PROCESS stream at all' is answered once at boot, not re-litigated on
every reconnect — and putting it in `_run_websocket` short-circuits the
connect/backoff/circuit-breaker tests that drive that coroutine directly."*

### 4.1 What the one-connection constraint means for ANY second consumer

This is the part that bears on D3's future and it is not a restatement of the guard.

1. **A second consumer must not open a second socket.** Both lanes are module-global,
   single-connection by construction: `bar_stream.py:38` — *"State (module globals — single
   connection per process by design)"*; `bar_stream.start_stream` refuses a second call
   outright (`:487-489`, `"start_stream called twice — ignoring duplicate call"`).
2. **The supported way to add a consumer already exists and is per-SYMBOL, refcounted by
   OWNER.** `subscribe_symbols(syms, owner=…)` / `unsubscribe_symbols(syms, owner=…)`
   (`bar_stream.py:381`, `:404`) queue a protocol subscribe only on a symbol's FIRST owner
   and a protocol unsubscribe only on its LAST. So a second consumer that wants symbols a
   chart is already streaming adds **zero** upstream messages.
3. **Therefore the marginal upstream cost of a second consumer is the set difference, not
   the set.** This is the single most important number for sizing S7 (§7.3).
4. **It also means a second consumer can starve the first if it unsubscribes carelessly** —
   which is precisely the bug the owner refcount was added to prevent, and the same class
   the quote lane fixed with `_sub_counts` (`realtime_stream.py:39`, and the
   `subscribe_tickers`/`unsubscribe_tickers` 0→1 / 1→0 transition logic at `:155-208`).
5. **A local development run of any D3 consumer inherits the guard.** Any new entry point
   that opens a vendor socket MUST call `refuse_if_local` at its own `start_*`, or it
   reintroduces the 2026-08-10 outage from a new door. This is a spec-level requirement,
   not a suggestion.

---

## 5. (c) Two byte-separate browser pools

> **A bug in the bars path must never break live prices.** The separation is structural,
> not conventional, and it is asserted in the file that would be the one to break.

**The claim, quoted from source** — `app/src/lib/barsStreamManager.js:1-4`:

> *"Shared SSE connection pool for /api/stream/bars — the bars analog of
> priceStreamManager, kept in a SEPARATE module so the always-on price path
> (priceStreamManager.js) is byte-untouched (a bug here must never break live prices)."*

**The measurement, with its control.** Method: read every `^import` line in both modules,
then grep each file for the other's name.

| | |
|---|---|
| `priceStreamManager.js` imports | 2 statements — `./realtimeCandle` (`:19`), and 4 named constants from `../utils/streamStatus` (`:20-22`) |
| `barsStreamManager.js` imports | 1 statement — `STREAM_RECONNECT_CAP_MS` from `../utils/streamStatus` (`:18`) |
| Cross-import | **none.** `priceStreamManager.js` contains zero occurrences of the string `barsStreamManager`; `barsStreamManager.js` contains two occurrences of `priceStreamManager`, both inside the header comment at `:2-3`, neither an import. |
| Shared surface | exactly **one module** (`app/src/utils/streamStatus.js`) and exactly **one symbol in common** (`STREAM_RECONNECT_CAP_MS`) |

⭐ **Control for the absence claim.** The same grep, run across `app/src`, returns
`priceStreamManager` in 10+ files and `barsStreamManager` in 6 — so the search could
plainly have found a cross-import and did not. The absence is measured, not assumed.

**What this buys, concretely:** the two pools have independent kill switches
(`uct.ssePool.disabled`, read at module load in `useRealtimePrices.js:328-330`;
`uct.barsPool.disabled`, read at every call in `barsStreamManager.js:69-73`), independent
watchdog windows (30 s vs 45 s, §9 row 5), independent reconnect state, and independent
throttles (1000 ms publish vs 500 ms bar). A regression in bucket rebuilding, event
parsing, or watchdog logic on one side cannot reach the other except through the single
shared constant.

⚠️ **The separation is at the BROWSER, not at the server.** Both endpoints live in the
same module (`api/routers/stream.py`), share one connection counter (`_conn_seq`, `:42`)
and one `MAX_SUBSCRIBERS` value (`:36`), and both hold a coroutine on the **one** shared
uvicorn event loop. The registries are per-stream *"so a wall of chart tabs on
/api/stream/bars can never crowd out the price quotes every page depends on"*
(`stream.py:38-41`) — that is admission isolation, and it is real, but it is not the same
property as the browser-side byte separation. Anyone extending D3 should not read §5 as
saying the server lanes are isolated. They are not.

---

## 6. (d) `delivering` — recency-gated, hysteretic, and never sticky

**Where:** `app/src/lib/barsStreamManager.js:121-146` (`getStatus`), constants at `:26`,
`:32`, `:37`.

Three states, in strictly increasing strength (`:117-120` documents them in place):

| state | condition, as read | line |
|---|---|---|
| `connected` | the bucket's `EventSource` is open | `:124-125` |
| `healthy` | `connected` AND something (a bar OR the 15 s heartbeat) arrived within `BARS_WATCHDOG_MS = 45000` | `:26`, `:126` |
| `delivering` | `connected` AND a real `bar` for **THIS** `(sym,tf)` has ever arrived AND the last one is recent, where "recent" is **hysteretic** | `:140-144` |

**The hysteresis, exactly:**

```js
const recent = ks ? Date.now() - ks.lastBarAt : Infinity
const wasDelivering = !!(ks && ks.delivering)
const delivering = connected && !!(ks && ks.everDelivered) &&
  recent < (wasDelivering ? BARS_LIVE_DISENGAGE_MS : BARS_LIVE_STALE_MS)
if (ks) ks.delivering = delivering   // persist for next call's hysteresis
```
— `barsStreamManager.js:140-144`

- **Engage** at `BARS_LIVE_STALE_MS = 120000` (`:32`)
- **Disengage** at `BARS_LIVE_DISENGAGE_MS = 150000` (`:37`)
- The 30 s band between them is the anti-thrash margin, and the in-file comment gives the
  reason (`:134-139`): *"Massive emits AM only for minutes WITH trades, so a thin name on a
  1m chart can cross 120s with no print; a single global boundary would flip delivering
  false→push-off→Finnhub→true on the next tick, and each handoff is a potential seam (the
  two feeds disagree on the developing close/volume)."*

### 6.1 Why it must never be made sticky, stated as three separate failures

1. **Sticky `delivering` freezes the candle with the fallback suppressed.** `delivering`
   is the last term of `StockChart.jsx`'s single-writer gate (`barsPushActive = … &&
   delivering`); when it is true the Finnhub writers early-return. A feed that stops
   emitting bars while its SSE keeps heartbeating would leave `healthy` true forever —
   `barsStreamManager.js:128-133` names exactly this: *"A feed that stops emitting bars but
   keeps the 15s heartbeat alive would otherwise keep `healthy` true forever, freezing the
   candle with Finnhub suppressed and no watchdog recovery."* **The recency gate, not the
   watchdog, is what recovers this.**
2. **Sticky `delivering` breaks resubscribe.** A freshly reconnected key has a stale
   `lastBarAt`, so `delivering` correctly stays false until a fresh bar arrives, keeping
   the fallback authoritative across the gap (`:132-133`). The unsubscribe path deletes a
   key's state when its LAST subscriber leaves (`:109`) precisely so a later resubscribe
   starts at `everDelivered = false` rather than "instantly reporting delivering on stale
   state".
3. **A time-based gate is dead code unless someone re-reads it.** This is the subtle one
   and it is already handled: nothing fires an event when a feed goes quiet, so the pool's
   watchdog sweep calls `_notifyAllStatus()` on **every** sweep (`:284`), with the reason
   written at `:277-283`. `useRealtimeBars`'s `refresh` then bails when the triple is
   unchanged (`useRealtimeBars.js:38-42`), so the every-10 s re-notify costs a render only
   when liveness actually flips. **Removing either half — the sweep notify or the bail —
   silently converts the recency gate into decoration.**

⛔ **Finding, recorded rather than fixed:** `CLAUDE.md`'s "Bars Push Feed" section states
*"disengage only after 300s (`BARS_LIVE_DISENGAGE_MS`)"*. The constant reads **150000 ms**
(`barsStreamManager.js:37`), and the in-file comment says *"Was 5min — too long a visible
freeze"*. **The doc is describing the pre-fix value.** See §9 row 1.

---

## 7. (e) What the S7 trigger types will need from D3

This is the section D3 exists for. S7 has **four** trigger types built and **four** planned.
The question is not "should S7 use the stream" — it is *which types have an event whose
identity is a transition that a poll can miss*, and *what would that cost*.

### 7.1 How S7 gets prices TODAY — read from source, not from the plan

`api/services/alert_taxonomy/price_level_projection.py` is the live example, and it does
**not** use a stream.

| step | what happens | line |
|---|---|---|
| Schedule | `CronTrigger(day_of_week="mon-fri", hour="9-16", minute="*")`, `max_instances=1`, id `alert_taxonomy_price_level_dark` | `api/main.py:6695-6701` |
| Gate | `ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED`, default `"0"` | `api/main.py:6679` |
| Cadence, computed | `hour="9-16"` = 8 hours × `minute="*"` = 60 ⇒ **480 ticks per weekday**; one tick per **60 s** | derived from `main.py:6697-6698` |
| Symbol set | `sorted({p["symbol"] for p in project_admin_alerts()})` — one `SELECT` over live `watchlist_alerts` joined to the cohort | `price_level_projection.py:330`, `:110-127` |
| Price, first pass | the **shared** `live_px1_*` cache, imported directly: `from api.routers.live_prices import cache as _px_cache, _px_key` | `price_level_projection.py:271` |
| Cache TTL | `_CACHE_TTL = 15` seconds, and the key is per-ticker | `api/routers/live_prices.py:31`, `:116` |
| Price, misses | ONE call to `massive._get_client().get_batch_rich_snapshots(missing)` | `price_level_projection.py:290-291` |
| Misses reported | `missing` is RETURNED, not swallowed, and printed every tick | `:265`, `:309`; `main.py:6684-6691` |
| Liveness | `price_level_sweep_heartbeat` table — monotonic tick count + wall clock, stamped on EVERY tick | `:345-407` |

⭐ **The cache-first design is the load argument, stated in place** (`:256-260`): on a
weekday with an admin watching the dashboard, `/api/live-prices` has already populated
`live_px1_*` on its 15 s poll, so *"this sweep costs ZERO network calls — the same read
the awareness engine makes."*

⛔ **One correction to the module's own vocabulary, measured.** The docstring calls the
fallback *"one bounded batch fetch"* and says *"The fallback is bounded and never raises"*
(`:253`, `:262`). **"Bounded" there means bounded to ONE call and wrapped in `try/except`.
It is NOT bounded in ticker count.** `massive.get_batch_rich_snapshots` joins every ticker
into a single query string with no chunking and no cap
(`api/services/massive.py:728-737`), while the HTTP door that normally fills that same
cache refuses more than 250 tickers per request (`live_prices.py:30`, `:569-572`). A
cohort larger than that reaches the vendor as one unbounded URL. This is a real D3-adjacent
scaling edge and it is named here, not fixed.

### 7.2 Which trigger types would want a stream rather than a poll

The discriminator is **whether the event's identity is a transition**. `price_level`
states the principle for the whole taxonomy in `_crossed`'s docstring
(`price_level.py:235-249`):

> *"`price >= level` alone re-fires on every tick while price sits above the line. The
> predicate's `fire_key` dedup would swallow the repeats, which is exactly what makes the
> level test the dangerous version: the comparison would look clean while the two sides
> disagreed about WHEN the event happened. Requiring a transition makes the fire's
> identity the crossing rather than the sampling."*

**A transition predicate sampled at 60 s cannot see a crossing that reverts inside the
minute.** That is the entire case for a stream, and it applies to some types and not
others.

| # | Trigger type | Built? | Data class as declared | Wants a stream? | Why, from source |
|---|---|---|---|---|---|
| 1 | `document-arrival` | built | `source_data_class="sec_filing"`, `freshness_class=None` — *"honest: SEC filings are not a D1-typed feed"* (`document_arrival.py:144-145`, module docstring `:15`) | **NO** | The event is a document appearing. There is no vendor tick and no transition to miss; a poll IS the arrival detector. |
| 2 | `price-level` | built | `source_data_class="quote"`, `freshness_class="real_time"` (`price_level.py:351-352`) | **YES — the only unambiguous one** | The fire's identity is `prev < level <= now` (`:252-254`). At a 60 s sample, an intra-minute round trip through the level is invisible AND unrecoverable — the projection's own docstring records that a provider's answer for a past instant is not obtainable. It already declares itself `real_time` while being fed by a 15 s cache read once a minute. |
| 3 | `event-proximity` | built | `source_data_class="calendar"`, `freshness_class="end_of_day"` (`event_proximity.py:242`) | **NO** | `main.py:6721-6724` states the ruling in place: *"Cadence is DAILY, not per-minute … A minute-by-minute sweep would re-ask a question whose answer cannot change until tomorrow."* |
| 4 | `catalyst-match` | built (evaluator only) | **none declared** | **NO, and not yet answerable** | Measured absence with a control: `grep source_data_class` over `catalyst_match.py` returns **nothing**, while the identical grep over `price_level.py` returns `:351`. The module exposes `would_fire` (`:342`) and no `record_fire` call — it is pre-receipt, so it has no freshness contract to satisfy yet. |
| 5 | `indicator-condition` | planned | — | **PROBABLY, but blocked upstream** | GATE-D2 §3 D2-C records the ruling that it waits on D2 CP1 plus the first non-screener store. Its evaluator already exists at `api/services/indicator_alert_evaluator.py` and reaches bars through `bars_fetch` — and it is **inside flow-worker's import closure** (§8.2), which changes the deploy calculus before it changes the data calculus. |
| 6 | `position-risk` | planned | — | **YES, same class as price-level** | A stop breach is a level crossing on a member's position. The awareness engine already runs this shape off the SAME shared cache (`api/services/awareness/rules.py` R1/R2, per `CLAUDE.md`) — so the precedent is a poll, and the precedent's known limitation is the one D3 would remove. |
| 7 | `scan-membership-change` | planned | — | **NO** | Membership is computed from `screener_rows`, whose declared cadence is nightly (GATE-D2 §2). There is no intraday transition to miss. |
| 8 | `regime-change` | planned | — | **NO** | The existing regime-flip rule needs a DURABLE prior label, not a faster one — `awareness_regime_snapshots` exists because *"the regime classifier recomputes from a 15-min cache and never persisted a prior label"* (`CLAUDE.md`). Its problem is memory, not latency. |

**Summary, stated so it can be quoted without re-deriving: of eight trigger types, TWO
(`price-level` and the planned `position-risk`) have an event whose identity is an
intraday transition, and those two are the whole of D3's S7 demand. One more
(`indicator-condition`) probably joins them and is blocked on D2 and on a flow-worker
classification. The other five do not want a stream, and giving them one would be latency
nobody asked for on a question whose answer cannot change that fast.**

### 7.3 The per-(sym,tf) fan-out cost, measured from the existing machinery

⚠️ **`(sym, tf)` is the BARS lane's key. `price-level` does not have a `tf`.** Its
predicate is a symbol and a level (`price_level_projection.py:134-147` — the projected
shape carries `symbol`, `level_kind`, `target_price`, `direction`, anchors; no timeframe).
So the honest answer to "what is the per-(sym,tf) fan-out cost" has two halves.

**Half one — what a `(sym, tf)` subscription actually costs today:**

| resource | cost | line |
|---|---|---|
| one `asyncio.Queue(maxsize=64)` per (sym,tf) **per subscriber** | 64-message ring, drop-oldest when full | `bar_broadcaster.py:110`, `:405-419` |
| one `(queue, loop)` tuple in `_subscribers[(sym,tf)]` | set membership | `:79`, `:117` |
| per emit, per subscriber | one `loop.call_soon_threadsafe(_safe_put, q, msg)` cross-thread hop | `:443-449` |
| emit rate ceiling for A/T | **10 Hz per (sym,tf)** (`_emit_throttle_ms = 100`) | `:99`, `:432-438` |
| emit rate for AM | **unthrottled**, ~1 per minute per (sym,tf) | `:322` |
| partial state, per SYMBOL | **5** buckets — the T path and the AM/A path both loop `("1",) + ROLLUP_TFS`, and `ROLLUP_TFS = ("5","15","30","60")` | `:58`, `:270`, `:338` |
| `_emit` calls per inbound trade, per symbol | **5** (one per bucket), each throttled independently | `:270`, `:309` |
| SSE-side, per connection | ≤ **50** pairs, one queue each | `stream.py:359`, `:369` |
| SSE-side, per stream registry | ≤ **300** connections (`STREAM_MAX_SUBSCRIBERS`, default 300) | `stream.py:36`, `:50-54` |

So one symbol carried on the bars lane costs **5 partial dicts** regardless of who is
watching, and **5 × N** `call_soon_threadsafe` hops per trade for N subscribers spread
across those buckets, each bucket capped at 10 Hz.

**Half two — what S7 would actually add, which is much less than half one suggests:**

1. **Upstream: the set difference, not the set.** `subscribe_symbols(syms, owner="s7")`
   queues a protocol subscribe only for symbols gaining their FIRST owner
   (`bar_stream.py:388-401`). A cohort symbol already on a member's chart or already held
   by `/api/stream/prices`'s `add_interest` costs **zero** extra vendor messages. The
   channel count per newly-added symbol is **3** (`AM.` + `A.` + `T.`,
   `bar_stream.py:188-192`).
2. **S7 does not need per-(sym,tf) queues at all.** `add_interest(symbols)`
   (`bar_broadcaster.py:160`) is the queue-free path, and its docstring says exactly why it
   exists (`:81-86`): the live-price SSE needs Massive ticks *"but it reads the developing
   bar directly (get_last_price) and must NOT create a per-(sym,tf) subscriber queue — that
   would dispatch a throttled tick into the request event loop for every watched symbol
   (the 524 surface)."* **S7's need is identical in shape.** Cost: one refcount entry per
   symbol, plus the 5 partials that symbol already has.
3. **The marginal S7 cost is therefore ≈ (new symbols) × (3 channel subs + 1 refcount),
   plus its own read loop.** Not 5 queues per symbol, not one connection per predicate.

**The number that is NOT measured: the cohort size.** `project_admin_alerts()` reads live
production rows and no production probe ran this pass. Without it, no absolute fan-out
figure can be honest. What CAN be stated: the mechanism's own ceilings are 50 pairs per
SSE connection and 300 connections per registry, and `add_interest` has **no length check
at all** — read `bar_broadcaster.py:160-175`: it iterates the list and refcounts, with no
cap, while its sibling `subscribe()` does validate (`:108-109` raises on an unknown `tf`).
**Control for that absence: the same read found a validation guard 50 lines away, so the
method could have found one and did not.** An S7 consumer calling `add_interest` with an
unbounded cohort would fan the vendor socket out with nothing stopping it.

### 7.4 What D3 would have to EXPOSE that it does not today

Six gaps, each read from source, ordered by how much they block.

**G1 — There is no server-side subscription API callable from a scheduler thread.**
`BarBroadcaster.subscribe` calls `asyncio.get_running_loop()` (`bar_broadcaster.py:112`)
to capture the caller's loop for `call_soon_threadsafe`. A scheduler job — which is where
every S7 sweep runs (`main.py:6695`) — has no running loop, so `subscribe()` **raises**
there. ⭐ This is the single concrete reason S7 cannot "just subscribe" today, and it is
also why `add_interest` + `get_last_price` is the right recommendation: neither touches a
loop.

**G2 — `get_last_price` returns a price, not a transition, and not a per-timeframe bar.**
It returns `{"price", "ts", "volume"}` off the 1-minute partial only
(`bar_broadcaster.py:203-218`), returns `None` before the first tick, and `volume` may be
`None` until the first `A` event (`:210`). A crossing detector needs `prev` and `now`;
D3 supplies only `now`. Today S7 keeps `prev` itself, per predicate, in
`last_seen_state.prev_price` (`price_level.py:313-315`, and the clearing rule at `:280-292`).
**That is the correct place for it and D3 should not take it over** — but D3 must
guarantee that consecutive reads are ordered and gap-visible, which today they are not.

**G3 — No liveness/staleness answer on the bars lane.** The quote lane has
`realtime_stream.get_last_seen(sym)` and `get_last_seen_ages()`
(`realtime_stream.py:141-152`). The bars lane has only the partial's `ts`
(`bar_broadcaster.py:218`) — and `_build_stale_events` in the SSE layer has to normalise
that timestamp defensively because it is a *bucket start in milliseconds*, not a tick time
(`stream.py:148-155`). **A consumer that cannot distinguish "quiet symbol" from "dead
feed" will manufacture a finding**, which is precisely the failure the `delivering` gate
exists to prevent on the browser side and which has no server-side equivalent.

**G4 — State is dropped the moment interest ends, and there is no replay.** When a symbol
loses its last subscriber AND its last interest, all five partials, the AM baseline and the
day volume are deleted (`bar_broadcaster.py:139-144` and `:192-196`). There is no ring
buffer and no history. A consumer that reconnects sees nothing until the next tick. For a
forward-only comparison that is acceptable by design; for anything that must not miss a
crossing it is a hard constraint that must be stated in the consumer's contract.

**G5 — Everything is in-process, single-instance.** `bar_broadcaster` is a module
singleton with a double-init guard (`:470-489`); `bar_stream` is module globals, one
connection per process (`:38`); `stream.py`'s subscriber registries are module dicts
(`:41`). The web pod is one uvicorn process. **A D3 consumer running anywhere else — the
`worker` service, `flow-worker`, a second web instance — gets none of this**, and there is
no cross-process transport in either lane. This is the constraint that decides whether
S7's evaluator can ever move off the web pod.

**G6 — There is no "price crossed" event and no per-consumer cursor.** The full emitted
vocabulary is the 9 frames of §3. Nothing carries a sequence number, a consumer offset, or
a gap marker; `_safe_put` drops the oldest message silently on a full queue and only
increments a global counter (`bar_broadcaster.py:405-419`, `_bars_dropped_total`). A
consumer cannot tell that IT lost a message — only that the process lost some.

### 7.5 The shape this spec recommends, stated once

**For `price-level` and `position-risk`, the smallest change that removes the sampling gap
is NOT an SSE consumer. It is a scheduler-thread-safe read path over the existing
broadcaster:** `bar_stream.subscribe_symbols(cohort, owner="s7")` +
`bar_broadcaster.add_interest(cohort)` + a tick loop that reads `get_last_price` at a
cadence D3 owns, with G3's staleness answer added so a quiet symbol is not scored as a
price. That composes existing, incident-hardened parts, adds no vendor connection, adds no
queue on the request loop, and leaves `prev_price` where S7 already keeps it.

⛔ **This spec does not authorize that.** It is the shape a checkpoint would take; the gate
packet's CP table is where it is proposed, and the approval block there is empty.

---

## 8. (f) What this spec does NOT own

Named explicitly so a future reader does not treat silence as scope.

### 8.1 Not owned — the SSE event loop's timing

- **The 100 ms → 250 ms idle-sleep tuning.** `stream.py:302-306` records the decision and
  its reason (*"Every open tab holds one of these loops on the SINGLE event loop; at launch
  scale the 10Hz tick … was measurable pure overhead"*), and `:390-395` records the bars
  loop matching it. **D3 ratifies that these values exist and are deliberate; it does not
  own re-tuning them.** That belongs to whoever owns the single-event-loop budget.
- ⚠️ **Recorded while reading, not proposed as a change:** the two loops sleep
  differently. `/api/stream/prices` sleeps 0.25 s **every** iteration (`:306`, outside any
  conditional). `/api/stream/bars` sleeps 0.25 s **only when it drained nothing**
  (`:389-395`, inside `if not got_one`). A bars connection with continuously non-empty
  queues therefore spins without yielding to a timer. Whether that is a problem is a
  measurement nobody has taken, and taking it is not this spec's.
- **The broadcaster's 100 ms per-key emit throttle** (`bar_broadcaster.py:99`) and the
  browser's 500 ms bar coalesce (`barsStreamManager.js:51`) and 1000 ms publish throttle
  (`priceStreamManager.js:48` ← `LIVE_UI_CADENCE_MS`, `streamStatus.js`). Four throttles
  in series. D3 names them; it does not re-derive them.

### 8.2 Not owned — the multi-worker question

The web pod is deliberately single-process because SSE state is in-process
(`bar_broadcaster` singleton, `stream.py` registries, `bar_stream` globals — all cited in
G5). **Whether the web pod should ever be multi-worker or multi-instance is an
architecture decision that D3 constrains and does not make.** D3's contribution is the
constraint, stated once and citably: *every piece of realtime state in both lanes is
per-process, and none of it has a durable or cross-process equivalent.*

### 8.3 Not owned — anything in flow-worker

`flow-worker` runs the Massive **OPRA** consumer and the flow database. It is a different
service, a different socket, a different vendor product, and a different deploy
discipline. **Nothing in D3's two lanes runs there** — measured, §8.4.

D3 also does not own: `api/massive_stream.py` / `api/routers/massive_stream_router.py`
(the flow SSE, mounted separately at `api/main.py:7933`), `chat_stream`, or
`volume_live.on_aggregate` (which rides `_on_bar` at `api/main.py:4542` behind its own
flag and is explicitly a *"defensive add-on"* that *"can never break the bars feed"*,
`:4539-4544`).

### 8.4 The flow-worker measurement, so §8.3 is a fact and not a hope

**Method:** `tools/flow_worker_watch_coverage.reachable_paths(root)` and
`watched_paths(root)`, called with an explicit repo root (no git invocation), this pass.

- flow-worker's static import closure from `api/flow_worker_main.py`: **154** api modules.
- flow-worker's watch list, parsed from its own header: **24** patterns.

| module | in flow-worker's import closure? | on its watch list? |
|---|---|---|
| `api/services/realtime_stream.py` | **no** | no |
| `api/services/bar_stream.py` | **no** | no |
| `api/services/bar_broadcaster.py` | **no** | no |
| `api/routers/stream.py` | **no** | no |
| `api/services/vendor_socket_guard.py` | **no** | no |
| `api/services/realtime_candle.py` | **no** | no |
| `api/services/volume_live.py` | **no** | no |
| `api/main.py` | **no** | no |
| `api/services/bar_rollup.py` | **YES** | **no** |
| `api/services/massive.py` | **YES** | **no** |
| `api/services/finnhub_client.py` | **YES** | **no** |
| `api/services/indicator_alert_evaluator.py` | **YES** | **no** |

⛔ **`api/services/bar_rollup.py` is the one D3 module flow-worker runs.** The broadcaster
imports `TF_TO_SECONDS`, `aggregate` and `bucket_start` from it
(`bar_broadcaster.py:38`); flow-worker reaches it through exactly one edge —
`api/services/bars_fetch.py` imports `bucket_start` inside a function
(`bars_fetch.py:413`), and `bars_fetch` is reachable from seven modules in the closure.
**So a D3 change to `bar_rollup.py` would be run by flow-worker and would not redeploy
it.** That is the stranding case, it has a name, and it is carried into the gate packet's
CP table rather than discovered at merge time.

⚠️ **A drift worth recording, not correcting here:** the tool's own header states *"reaches
**162** api modules; only ~21 are watched"* (`flow_worker_watch_coverage.py:12-13`,
measured 2026-09-11). This pass measured **154** and **24** on the working tree. Both are
readings of a moving tree; the number to trust is the one you just ran, which is the tool's
own stated point.

---

## 9. Findings register — where two artifacts name one thing differently

Every row is a divergence found while reading, recorded because *"where two modules name
one thing differently, that is a finding"*. **None is fixed by this spec.**

| # | The two authorities | What they say | Assessment |
|---|---|---|---|
| 1 | `CLAUDE.md` "Bars Push Feed" vs `barsStreamManager.js:37` | doc: *"disengage only after 300s"* · source: `BARS_LIVE_DISENGAGE_MS = 150000` | **The doc is stale.** The source comment says *"Was 5min"*, so the doc records the pre-fix value. A reader sizing the stale-candle window is off by 2×. |
| 2 | `realtime_stream.py:1-7` vs `stream.py:189` | ingest: Finnhub is *"primary"*, Massive REST the *"fallback"* · SSE: Finnhub is *"the fallback source"* | **A direct contradiction about which feed is primary, in two files on the same hop.** Both are defensible descriptions of different eras; neither says which era it is describing. §2's CROSS 2 is the resolution: Massive's price overlays Finnhub's, so at the browser Finnhub IS the fallback — the ingest docstring is describing its own module and reads as a system-level claim. |
| 3 | `CLAUDE.md` "Theme Tracker → Real-Time Streaming" vs `realtime_stream.py:24` | doc: *"`api/services/realtime_stream.py` — Massive/Polygon WebSocket"*, *"WebSocket: `wss://socket.polygon.io/stocks` via `MASSIVE_API_KEY`"* · source: `wss://ws.finnhub.io?token={_FINNHUB_KEY}` | **The doc names the wrong vendor, the wrong URL and the wrong key for that module.** The Massive socket is `bar_stream.py:35`. Anyone reasoning about the Finnhub budget, the Finnhub tier cap, or the one-connection rule from that paragraph reasons about the wrong socket. |
| 4 | `useRealtimePrices.js:9-10` vs `useRealtimeBarPrices.js:25-30` | hook A: *"Merges Finnhub WebSocket (tick-by-tick) with Massive REST (2s polling)"* · hook B: *"the Finnhub price SSE (/api/stream/prices) drops/rotates symbols under its tier cap, so many names (e.g. OKTA) go minutes without a tick; the Massive feed does not"* | **A third voice on the same question**, and the most operationally useful one. `useRealtimeBarPrices` exists BECAUSE the quote lane is unreliable per-symbol — which is a fact about D3 that D3's own primary hook does not state. |
| 5 | `barsStreamManager.js:26` vs `utils/streamStatus.js` | bars watchdog **45000 ms**, prices watchdog **30000 ms**, both against the same 15 s server heartbeat | Not a contradiction — two independent tunings, consistent with §5's byte separation. Recorded so nobody "unifies" them without knowing they were separate on purpose. |
| 6 | `stream.py:359` vs `barsStreamManager.js:20` | server: `pairs = pairs[:50]` — an **inline literal**, no named constant · client: `export const MAX_BARS_PAIRS = 50   // mirror of api/routers/stream.py pairs[:50]` | The prices lane does this correctly (`MAX_SSE_TICKERS = 50` at `stream.py:24`, mirrored at `priceStreamManager.js:24`). The bars lane's client "mirrors" a magic number that has no name to mirror. A change to one is invisible to the other. |
| 7 | `stream.py:209` vs `stream.py:397` | prices: `heartbeat_interval = 15` (a named local) · bars: `if time.time() - last_heartbeat > 15` (a literal), in the same file | Same value today. Two authorities over one interval, 190 lines apart. |
| 8 | `price_level_projection.py:253,262` vs `massive.py:728-737` | projection: *"one bounded batch"*, *"The fallback is bounded"* · massive: every ticker joined into one URL, no chunk, no cap | **"Bounded" means bounded to one CALL, not bounded in SIZE.** §7.1. |
| 9 | `flow_worker_watch_coverage.py:12-13` vs this pass | header: 162 reachable / ~21 watched · measured: 154 / 24 | Drift in a header count beside the function that derives it. The tool's own doctrine (*"THE POINT IS NOT TO WIDEN THE LIST"*) is unaffected. |
| 10 | `realtime_stream.py:48` vs `useRealtimePrices.js:52-61` | server sends `_STREAM_FIELDS = {price, change_pct, change, timestamp, updated_at}` · client's `_streamSafe` strips `change_pct`, `change`, `prev_close`, `day_open`, `day_high`, `day_low`, `day_close`, `ext_price`, `ext_session` | **The server computes and serialises two fields (`change_pct`, `change`) that every pooled consumer deliberately discards**, for the reason at `:44-51`: the stream's prev_close is unseeded and *"measured 2026-08-21: ORCL streamed +0.20% while the true day move was +3.78%"*. Bandwidth is trivial; the finding is that the wire contract still advertises a field the product has ruled untrustworthy. |

---

## 10. Invariants D3 ratifies — the list a future change must not break

Each is stated with the citation that makes it checkable. This is the durable output of
the spec.

1. **One vendor socket per lane per process, gated at the entry point.**
   `vendor_socket_guard.refuse_if_local` at `realtime_stream.py:526` and
   `bar_stream.py:498`; not in the reconnect loop, for the reason at
   `realtime_stream.py:519-524`.
2. **Upstream subscription is refcounted, and the refcount is what makes sharing safe.**
   Per-owner on the bars lane (`bar_stream.py:46,381,404`), per-connection on the quote
   lane (`realtime_stream.py:39,155,181`). A consumer that unsubscribes without refcounting
   cuts someone else's feed.
3. **The two browser pools stay byte-separate.** §5. One shared module, one shared symbol,
   zero cross-imports.
4. **`delivering` stays recency-gated and hysteretic, and the watchdog keeps re-notifying.**
   §6. Three independent failures follow from breaking it.
5. **The heartbeat stays a NAMED event on both endpoints.** `stream.py:295-300`,
   `:397-405`. A bare SSE comment is invisible to `EventSource` and re-creates the
   false-reconnect class.
6. **Admission happens BEFORE any upstream subscription.** `stream.py:183-187`,
   `:361-365` — *"a refused connection must not leave Finnhub/Massive interest registered
   for tickers nobody is watching."*
7. **The quote endpoint's Massive coupling stays best-effort.** `stream.py:199-205` and
   `:236-248`. It must degrade to Finnhub-only rather than fail — ⚠️ and §2's warning
   stands: it degrades **silently**.
8. **`add_interest` must never grow a per-(sym,tf) queue.** `bar_broadcaster.py:81-86`
   names the 524 surface it exists to avoid.
9. **Any new realtime consumer declares which process it runs in.** G5.
10. **`bar_rollup.py` is shared with flow-worker.** §8.4. A change there is a deploy
    decision before it is a code decision.

---

## 11. Open questions this spec deliberately leaves to the gate

1. Does D3 get a name in the codebase at all, or does it stay a documented set of
   invariants over two lanes? (Naming it invites a package; a package invites a rewrite.)
2. Should the quote lane's silent Massive-degradation (§2 warning) surface anywhere?
   Today `/api/stream/status` (`stream.py:423`) reports the Finnhub side and the admission
   counters, and says nothing about whether the Massive overlay is live.
3. Does S7's price consumer read through D3, or keep reading `live_px1_*`? §7.5 recommends
   the former in shape and authorizes nothing.
4. Whose is finding #3 (the `CLAUDE.md` vendor error) to fix? It is in a file this
   programme does not own.
