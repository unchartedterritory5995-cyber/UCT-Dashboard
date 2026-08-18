# Instant Origin — "No Lag, Ever" Bars Architecture

**Goal:** every `/api/bars` response is a warm local read — **< ~100 ms, no
synchronous data‑provider call, ever** — backed by an always‑current, supervised,
observable store. Match the web-app feel of TradingView / DeepVue / TC2000.

**Author:** 2026‑08‑18. Grounded in a full serve-path + ingestion audit (file:line
citations below). Supersedes the "compensate on the client" posture of the Bars
Pack initiative — the Pack stays as a zero‑latency cherry on top, not a crutch.

---

## The reframe — we are NOT missing a fast engine

The audit's single most important finding: **when the data is warm, the origin is
already instant.**

| Layer | Read latency | On request path? |
|---|---|---|
| In‑memory TTLCache (`cache.py`) | **< 1 ms** | yes (`bars_fetch.py:2349`) |
| SQLite `bars.db` WAL read | **< 5 ms** | yes, lock‑free (`bars_fetch.py:2358`, `bars_sqlite.py:36`) |
| Disk cache `/data/bars_cache` | < 20 ms (RAM‑promoted → sub‑ms) | on miss only |
| **Provider (Massive/yfinance/FMP)** | **delta ~1 s / full 4–8 s** | **the problem** |

A warm response already serializes fast (ORJSON, ~0.6 ms at 5000 bars) and gzips
~6×. So the work is **not** a storage/serve rewrite. It is two things:

1. **Make the request path never block on the provider** — on a miss or a
   cold‑stale entry, serve the best local data instantly and heal in the
   background, instead of waiting 1–8 s on Massive.
2. **Make the store always warm and make staleness impossible to miss** — so
   "cache miss" is structurally rare, and when ingestion breaks we know in
   minutes, not a week.

Everything below serves those two invariants.

---

## Current state (audited)

### A. The six places the request path blocks on the provider

All in `api/services/bars_fetch.py` unless noted. Entry: `GET /api/bars/{ticker}`
(`api/routers/bars.py:301`) → `_get_bars_inner` (`bars_fetch.py:2333`).

1. **Deep intraday pan‑backfill** — synchronous `_fetch_intraday` (`:2439`), waiter blocks ≤12 s (`:2468`).
2. **Same‑session stale intraday first paint** — synchronous `_delta_intraday` (`:2497`), waiter ≤8 s (`:2523`).
3. **Layer‑4 delta fetch** — `_delta_daily/weekly/monthly/intraday` (`:2688‑2699`), waiter ≤12 s (`:2665`). *This is where cold‑stale daily/intraday entries land.*
4. **Layer‑4 full fetch (first‑ever)** — `_fetch_*` (`:2714‑2725`), the 4–8 s cold open.
5. **`since=` 30 s SWR poll when stale** — synchronous delta before serving (`:1998‑2012`). Highest‑QPS entrypoint.
6. **Replay `to=` on a cold deep ticker** — synchronous deep `_fetch_*` (`:1820‑1830`).

The cold‑stale predicates `_is_cold_stale_daily` / `_is_cold_stale_intraday`
(`:504‑557`) **deliberately** route first paint *through* the blocking fetch
(guard at `:2397‑2401`) — for correctness (avoid the stale‑first‑paint /
"Frankenstein candle" bug). The only non‑blocking refresh is the `Semaphore(6)`‑
bounded background `_bg_delta` thread (`:2547‑2624`); when full it skips and serves
stale.

Because the web pod is **one uvicorn process (one event loop + 64‑thread anyio
pool)**, each blocking fetch pins a pool thread — this is the same resource that
produced the 2026‑07‑01 524 outage. Removing provider calls from the request path
is also a stability win, not just latency.

Delivery: ORJSON + `_GZipSkipSSE` (`main.py:5476`), but **`Cache-Control: no-store`
on every bars response** (`bars.py:427‑428`) — so nothing is cached at the browser
or the Cloudflare edge today.

### B. Why the store silently froze for a week

Warming runs on the **worker pod only** (`worker_main.py:88‑91`; web sets
`USE_REMOTE_BARS=1` and skips its own, `main.py:2892‑2905`). D/W/M are warmed
**full‑universe** (`bars_prewarm.py:223‑225`) — so the Aug‑11 freeze was
*warming‑stopped*, not a coverage gap. Root causes:

1. **Unsupervised thread + unguarded crash.** The prewarmer is a bare daemon
   thread (`worker_main.py:91`) and its refresh‑loop body is **not** wrapped in
   try/except — `refresh_jobs = [... _needs_fresh(_sqlite.get_last_ts(...)) ...]`
   (`bars_prewarm.py:301`) and the executor block (`:304‑308`) sit outside any
   guard. One `get_last_ts` raise (`database is locked` past the 2 s/30 s
   busy_timeout, or a malformed‑image event) escapes `while True` → **the thread
   dies permanently while the process stays up.**
2. **No prewarmer liveness anywhere.** Worker health reports `uploader_alive`
   (which stays green shipping a *static* DB) but has **no** prewarmer signal
   (`worker_main.py:536‑553`). Railway only asserts HTTP 200.
3. **The freshness watchdog is structurally blind to this.**
   `bars_continuous_audit` runs on the **web** pod, samples **intraday only**
   (`TFS=("60","30","15","5","1")`, `bars_continuous_audit.py:85`), and the web's
   own on‑demand fetches keep that intraday hot‑set fresh independent of the
   worker — so the ratio never trips. A frozen **daily** store is outside what it
   samples. `store_health` only detects table‑gone/empty, not frozen
   (`bars_sqlite.py:864‑892`).
4. **Alerts page no one.** `chart_health_alerts.emit` writes an **in‑memory deque**
   surfaced only by an admin pull endpoint (`chart_health_alerts.py:16‑48`,
   `admin_chart_health.py:182`) — **zero Discord/email.** The only things that
   reach Discord are HTTP up/down pings and OPRA‑flow health, neither of which
   looks at bars.

### C. Web ↔ worker ↔ R2 lag

Worker uploads a bars.db snapshot+delta to R2 (~1200 s cadence); web pulls + merges
newer‑wins (~1200 s) → **worst‑case ~40 min** for snapshot‑borne *historical*
bars. Today's *live* bars reach the web pod directly (Massive WS + on‑demand),
not via R2. This lag is fine for history but means the web pod can't rely solely
on the worker for "did the last session land."

---

## Target architecture — the invariant

> **The request path performs only local reads. It never awaits a provider.**
> A miss/stale entry serves the best local data we have (or a fast "warming"
> marker) and enqueues an async heal. Freshness is the ingestion layer's job, and
> the ingestion layer is supervised and alarmed.

Two supporting invariants:

- **Always‑warm:** the universe's D/W/M (and active‑set intraday) is kept current
  by a *supervised, self‑restarting* warmer, so "truly cold" is rare and always
  transient.
- **Loud on staleness:** any pod whose store falls ≥1 session behind pages a human
  (Discord) within minutes — measured on the pod that actually warms.

---

## Phased plan

Ordered by **leverage ÷ risk**. Phase 0 is cheap, high‑value, and unblocks trust
in everything else — do it first.

### Phase 0 — Supervision & observability (make a freeze impossible to miss)

*Small, additive, no serve‑path change. This is what would have turned the
week‑long freeze into a 5‑minute alert.*

- **0.1 Guard the prewarmer loop.** Wrap the `while True` body in
  `bars_prewarm.py` (esp. `:301,304‑308`) in try/except so a single `get_last_ts`
  / DB‑locked raise logs + continues instead of killing the thread. *(One‑line
  blast‑radius fix for the exact Aug‑11 death.)*
- **0.2 Supervise the thread.** Replace the bare daemon spawn
  (`worker_main.py:91`) with a supervisor that restarts `run_prewarmer_forever`
  on exit/exception (bounded backoff) and records `prewarm_last_pass_ts` +
  `prewarm_passes` + `prewarm_alive`.
- **0.3 Prewarmer liveness in worker health** (`worker_main.py:536‑553`): expose
  `prewarm_last_pass_ts` and the store's **newest‑daily‑bar date across the
  universe** (a cheap `MAX(ts)`‑by‑sample query). Green requires *both* uploader
  and prewarmer fresh.
- **0.4 A DAILY freshness watchdog on the WORKER.** New cheap job (or extend
  `bars_continuous_audit` to run worker‑side for `"D"`): sample N liquid symbols'
  newest daily bar; if the **median** is ≥1 completed session behind, emit
  critical. This catches the exact failure the current watchdog structurally
  cannot.
- **0.5 Wire critical bars alerts to Discord.** Give `chart_health_alerts` (or a
  thin new `bars_freshness_alert`) a real delivery channel
  (`DISCORD_WEBHOOK_URL`, dedup + cooldown like the down‑alert), so
  `bars_store_unhealthy` / `daily_universe_stale` / `prewarm_dead` actually page.
- **0.6 (shipped 2026‑08‑18)** Bars‑Pack freshness floor already refuses to
  publish a stale pack and surfaces `newest_session` — keep as the pack‑layer
  tripwire.

**Risk:** minimal (additive/observability). **Payoff:** we can trust the store is
warm, which is the precondition for Phase 1.

### Phase 1 — Serve path never blocks on the provider

*The core "instant origin" change. Convert the six blocking sites into
"serve‑local‑now + async‑heal."*

- **1.1 Async‑heal queue.** A bounded, prioritized in‑process queue that performs
  `_delta_*` / `_fetch_*` off the request path and writes SQLite + mem cache.
  Generalize the existing `_bg_delta` + `Semaphore(6)` into the single heal path;
  user‑viewed misses jump the queue (heal in ~1 s, still non‑blocking).
- **1.2 Cold‑stale → serve‑then‑heal, safely.** Change the guard at `:2397‑2401`
  so a cold‑stale entry **serves what we have and enqueues a heal** instead of
  falling into the synchronous Layer‑4 fetch (`:2688‑2725`). Correctness is now
  preserved *without* blocking because the client already: (a) paints the last
  closed session instantly (the 2026‑08‑18 gate + Writer‑E fixes), (b) fuses
  today's candle from the live feed, and (c) picks up the healed full series on
  the next SWR tick. *This is the change the earlier daily‑gate work was building
  toward.*
- **1.3 Truly‑cold ticker (`not stored_rows`).** The one case with nothing to
  serve. Options, in order: (a) Phase 2 keeps the universe warm so this is rare;
  (b) return a fast `202/"warming"` marker + enqueue a priority heal so the client
  shows a ~1 s skeleton and auto‑fills — **never a 4–8 s hang**; (c) keep a hard
  per‑request provider deadline (≤1.5 s) as a backstop only, never the norm.
- **1.4 De‑block the `since=` poll** (`:1998‑2012`): serve the local delta
  immediately, heal async. This is the highest‑QPS path; unblocking it directly
  relieves anyio‑pool pressure.
- **1.5 Replay `to=`** (`:1820‑1830`): warm replay windows async (the existing
  `prefetchReplayTimeframes` already primes these) and serve‑local on the request.

**Risk:** medium — touches the correctness‑sensitive first‑paint path. Mitigate
with the cold‑stale predicates as *heal triggers* (not serve blockers), the
client‑side safety already shipped, and a feature flag + `Server-Timing` layer
metric (`bars.py:433`) to watch cold‑serve ratio in prod.

### Phase 2 — Always‑warm, self‑healing store (make "miss" rare)

- **2.1 Bulletproof the daily universe warm** (built on Phase 0 supervision): the
  full‑universe D/W/M pass must complete reliably every cycle; alert if a pass
  hasn't completed in T.
- **2.2 Shrink web freshness dependence on the ~40 min R2 lag.** For **daily**,
  let the web pod keep its own last‑closed‑session current (it already fetches
  on‑demand) or pull the R2 delta more frequently, so the web store is never a
  session behind the worker for D/W/M.
- **2.3 Reconciliation for frozen/missing (not just wrong).**
  `bars_reconciliation` heals *drift*; add a "missing recent session" detector so
  a frozen table self‑heals even without an alert.

**Risk:** low–medium (mostly reliability hardening of existing components).

### Phase 3 — Edge & wire speed (shave the network hop)

- **3.1 Immutable edge caching for closed‑session daily.** A closed daily bar
  never changes. Serve *historical* daily/weekly ranges under a versioned,
  `immutable`, long‑`max-age` URL (like the Bars Pack shards already do) so
  Cloudflare answers from the edge (~20 ms) and origin load drops. Keep the live
  tail on `no-store`. This is the "served from a CDN" piece TradingView leans on.
- **3.2 Optional columnar/binary serve.** The Pack already encodes columnar; reuse
  `decodeShardPayload`‑shaped arrays on the hot serve path to cut payload ~6× more
  pre‑gzip. Measure first — ORJSON+gzip may already be enough.

**Risk:** low (additive; edge cache is scoped to immutable data).

### Phase 4 — Intraday parity + long tail

- **4.1** Extend proactive intraday (5m/1m) beyond the active top‑1500 for the
  long tail (currently on‑demand only, `bars_prewarm.py:205,228‑229`), within
  memory budget.
- **4.2** Extend the Bars Pack to intraday (5m/1h) so intraday first‑paint is
  instant too — the last "waiting for a chart" scenario.

**Risk:** medium (memory/throughput on the single worker — size carefully).

---

## Sequencing & what to do first

1. **Phase 0 now** — highest leverage, near‑zero risk, and it protects tonight's
   pack pipeline too. Ship 0.1/0.2/0.3/0.4/0.5 as one hardening pass.
2. **Phase 1** behind a flag, watching the cold‑serve ratio via `Server-Timing`.
3. **Phase 2** to make Phase 1's "serve‑local" almost always a *fresh* local.
4. **Phase 3/4** as polish and to close intraday.

**Definition of done:** in prod, `Server-Timing: bars;desc=…` shows **≥99% of
`/api/bars` responses served from `mem`/`sqlite`** (never `massive_full`), p99
origin latency **< 100 ms**, and a synthetic "freeze the worker" test pages
Discord within 5 minutes.

## Non‑goals / keep

- Keep the Bars Pack (zero‑latency client pre‑seed) — it complements an instant
  origin; it is no longer the primary mechanism.
- Keep the single‑process web pod (SSE live‑price state is in‑process); Phase 1
  *reduces* its load by removing blocking fetches — do not multi‑worker it.
- Do not touch the Options‑Flow / flow‑worker subsystem (separate rail).
