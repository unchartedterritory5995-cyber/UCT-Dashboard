# Charts: real-time ticks and instant full intraday history (PLAN, not started)

Owner direction, 2026-11-15: *"Real time is what we want ... key to being competitive. Also ... fully
and instantly load the entire intraday history. Right now only a recent few candles (2 weeks ish) pop
up immediately and then the rest load shortly after."* Parked by the owner the same evening: "put that
into a plan for the future and we do it later". Everything below was measured or read that day; re-measure
before starting, the code moves.

Status of the surrounding work (all live 2026-11-15): delta-merge skip #1339, edge hedge #1343 (Cloudflare
version b3d48615), chart-monitor edge/latency checks #1348/#1349, PR-time Pine gate rails #1350, stale
tests #1351. Memory: `project_indicators_instant_2026_11_12`.

---

## Part 1 — Real-time ticks

### What adds latency today (read 2026-11-15)

| Stage | Where | Delay |
|---|---|---|
| Broadcaster emit throttle | `api/services/bar_broadcaster.py` `_emit_throttle_ms = 100` (per sym, tf; trailing flush) | up to 100 ms |
| `/api/stream/prices` loop | `api/routers/stream.py` `event_generator`: `await asyncio.sleep(0.25)` per connection | up to 250 ms |
| `/api/stream/bars` loop | same file: drains its broadcaster queue, then `await asyncio.sleep(0.25)` | up to 250 ms |
| Browser, live candle | `app/src/lib/barsStreamManager.js` `BAR_THROTTLE_MS = 500` (owner's 2026-07-20 "calm, TC2000-style" choice, `15bc56d35d`) | up to 500 ms |
| Browser, quotes | `app/src/lib/priceStreamManager.js` `PUBLISH_THROTTLE_MS = LIVE_UI_CADENCE_MS` = **1000** (`app/src/utils/streamStatus.js`) | up to 1000 ms |

Worst case before network: ~850 ms to move a candle, ~1.35 s to move a price label. The owner has now
reversed the July "calm" decision in favour of real time.

### Plan

1. **Server push, not a 250 ms poll.** The broadcaster already hands updates to per-connection
   `asyncio.Queue`s (`subscribe()` / `call_soon_threadsafe`). In `stream_bars` wait on the queue
   (`asyncio.wait_for(queue.get(), timeout=heartbeat)`) instead of sleeping between drains; move
   `stream_prices`' price/candle sources onto the same queue model. Keep the 15 s heartbeat, the
   disconnect check, `MAX_SUBSCRIBERS`, and the per-connection correction queue. Expected: −250 ms and
   fewer idle wakeups on the single event loop. Consider `_emit_throttle_ms` 100 → 50.
2. **Browser: coalesce per animation frame for charts.** Replace `BAR_THROTTLE_MS` and, for chart
   consumers, `PUBLISH_THROTTLE_MS` with `requestAnimationFrame` coalescing (latest value per key, one
   flush per frame; keep the immediate flush on a bucket boundary so a close is never coalesced away).
   ⛔ Tables/watchlists re-render React trees: keep them on a separate, slower cadence (e.g. 250 ms) and
   measure; do not move every `LIVE_UI_CADENCE_MS` consumer to 60 Hz blindly.
3. **Behind switches, proven on live ticks before anyone gets it.** Per-browser opt-in first
   (localStorage, as `uct.indwarm.off` etc.), build-time default second. Never flip the live path the
   night before an open without a premarket measurement.
4. **Perf guard.** The 16-cell multi-chart grid and a 12-chart workspace must stay smooth at real-time
   cadence: measure with `uct-desktop/scripts/proofs/charts-load-proofs.mjs` (`--trace`) and
   `?gridspike=16` (admin) during live ticks; CLAUDE.md rule 3 (no unconditional per-frame loop) — the
   rAF must arm only when an update is pending.

### How to measure (premarket 04:00 ET or RTH)

- Trade time is on the wire: `stream_prices` stamps `trade_ts` (ms, exchange) on each quote; bar events
  carry their bucket. Measure exchange `trade_ts` → SSE receipt → chart paint (a frame sampler like
  `indicator-flip-proof.mjs`'s `__flip` reading `__uctChartDebug[id].newestBar()`).
- Success: p50 trade→paint < 250 ms, p95 < 500 ms on liquid names (SPY/QQQ/NVDA) in a 1-chart and a
  16-cell layout; no long tasks > 50 ms added; server event-loop lag unchanged (`[cpu-probe]` logs).

---

## Part 2 — Instant full intraday history

### What happens today (measured 2026-11-15, 60m, returning-member profile, list never opened)

| Stage | When | Bars on screen |
|---|---|---|
| First paint (pack + local) | 26–45 ms | 469–588 |
| Second step | **1,010–1,150 ms**, every flip | 1,288–1,526 |
| Full history | 1.4–2.7 s | 2,101–2,443 |

Command: `node scripts/proofs/indicator-flip-proof.mjs <out> --set=base --tf=60 --flips=10 --dwell=4000
--warmup=3000 "--list=Bull & Bear" --profile=<persistent profile>` (uct-desktop), then group each flip's
frames by `newestBar().count`.

Why:
- The intraday pack (`api/services/intradaypack.py` `_DEPTHS`) holds a short window per ticker:
  5m 240 (~3 sessions), 60m 180 (~5 weeks), 15m 200, 30m 180, 1m 390. Manifest 11,411 tickers,
  3.99M bars, 16 shards ~2.5 MB each (~40 MB).
- Deep history is ARMED 900 ms after the sym/tf settles
  (`app/src/components/chart/useLegacyChartBars.js`, Phase 3' Part 3: `setTimeout(..., 900)`), so a
  held-key flip never fires it. Then up to `PREFETCH_WINDOWS = 2` older windows
  (`app/src/utils/historyPrepend.js`, target `HISTORY_PREFETCH_TARGET_BARS`).
- ⚠️ The same 900 ms wait also gates reading history ALREADY SAVED in IndexedDB (`idbGetHistory`):
  a local read is held back by a delay that exists to protect the network.

### Plan (in order of certainty)

1. **Saved history on the first paint.** Read `idbGetHistory` with the primary IDB read (or immediately
   on settle), no 900 ms arm. Revisited symbols then paint their whole history at once. Local only, no
   new network cost.
2. **Shorter network arm: 900 → ~250 ms.** Held-key flips (40 ms per row) still never fire it; a
   deliberate stop fills ~650 ms sooner. Watch server/provider load from tapping (700 ms dwell would now
   fire per row): measure `to=` request rates with the flip harness.
3. **Deep history local before the click (the "every stock, never opened" case).** Requires a deeper
   intraday pack. ⛔ DECISION FOR THE OWNER before building:
   - full depth (~2,400 60m bars + matching 5/15/30m) for ALL ~11.4k tickers ≈ 250+ MB per browser,
     re-downloaded daily without a delta path — fine for the desktop app, heavy for phones;
   - RECOMMENDED: deep depth for the ~2,500 actively used tickers (watchlists, scans, themes, UCT20 —
     the prewarmer's active set), current depth for the long tail; full depth in the desktop app;
   - add delta updates for the intraday pack (the daily pack has `MAX_DELTA_CATCHUP_DAYS` logic in
     `app/src/lib/barsPackClient.js`; the intraday manifest is per-day).
   Pack ingest must keep CLAUDE.md rule 4 (after first chart paint, one window at a time, worker-side
   decode).
4. **List neighbours.** When a list loads, prefetch deep history for the rows around the cursor
   (bounded, idle, the `prefetchBars` queue), so a list you scan is deep before you stop.

Success: on a returning profile, a symbol in the active set paints >= its full history (target bars)
on the first frame; never-opened long-tail symbols reach full history within one server round trip
after the arm.

---

## Part 3 — Smaller follow-ups found 2026-11-15

- **Thin-name hourly first open ~2.5 s, once per symbol per session per pod.** Each server re-verifies
  a thin name's tail with the provider (`sd-deadline`, `bars_fetch._bounded_delta`, 2.5 s ceiling)
  because `verified_through` lives in each pod's own `series_meta` and is not shipped in deltas.
  Fix direction: ship verification with the delta, or verify the long tail once after the close on
  the worker. ~1% of cold reads.
- **Simultaneous restarts.** 17:14Z: one chart-monitor cycle saw http failures while bars-api AND web
  restarted together; the edge hedge can only fall back to a server that is up. Stagger the two
  (bars-api deploys from master on `api/**`; web from production after the gate).
- **bars-api's ~1,413-row correction after each restart** (first sync after `bars_live_store`'s boot
  repair). 116 served series were identical tier vs web just before it: internal rows, members never
  see them. Low priority; find which stored rows differ if it ever matters.
- **#1350 (`pine-gate-rails-pr.yml`) is advisory** (`promotion-gate: no`); promote once it has been
  seen failing and passing, per this repo's rule.
