# Charts Dominance Initiative — Design Spec

**Date:** 2026-07-03
**Goal:** Make UCT charts feel elite — TradingView / TC2000 grade. The user's bar:
*"I don't even think about the slowness or question the data or notice anything other
than high quality charts and speed."* That decomposes into **instant paint** (no spinners,
no blank frames), **buttery live motion** (ticks flow, nothing jumps), and **zero data
doubt** (never a wrong candle).

**Approach (user-approved order):** A (feel pass) → B (latency floor) → C (streaming-native),
with **accuracy hardening** threaded through and landed early where cheap.

**Method:** every change is tied to measured or code-verified evidence. Sources: a frontend
jank audit (file:line verified) + a 6-way analysis workflow (backend latency, live prod
measurement, payload/serialization, accuracy pipeline, streaming architecture, competitive
techniques) + a synthesis pass. Raw findings archived in the initiative worktree.

## What is already elite — do NOT re-fix or regress

The synthesis's most important finding: this stack is already strong. These are intentional
and load-bearing; touching them re-opens known outages:

- **3-tier synchronous-first cache** (memPeek → IDB → SWR) with same-frame warm paint.
- **Viewport-first 600-bar first paint** + dwell/pan-gated deep backfill. **No `fitContent`/
  `scrollToRealTime` anywhere** — the classic "chart jumps under the cursor" bug is absent.
- **SSE connection pooling is ALREADY DONE** — a tab holds 1 price stream, not 6
  (`priceStreamManager`). Phase C is poll→push, *not* pooling.
- **`bar_broadcaster`** — a genuinely well-engineered push fan-out primitive, built but dark.
- **`isSaneLivePrice`** single chokepoint; **`classifyLiveBar`**; poison-proof `lastServerCloseRef`.
- **Delta-merge `sameTail` no-op guard**; **index-pane `setData` signature guard** (the pattern
  we replicate in A).
- **Download-side snapshot integrity verification** (3 points).
- Deliberately correct: no CDN edge-caching of bars, no multi-worker web pod (in-process SSE
  state), low web `busy_timeout`, empty-results-never-cached, cold-stale-synchronous-first-paint.

## Measured baseline (prod, 2026-07-03)

- **Warm origin latency: p50 89ms / p95 161ms / max 167ms** for a full 600-bar response —
  excellent, only 15–90ms over the ~70ms Cloudflare floor. **Do not optimize warm compute.**
- Warm hit still pays ~4–8ms stdlib `json.dumps` + gzip-9 on the pod (orjson fixes this).
- gzip is on; wire format is keyed objects (`{"t":..,"o":..}` per bar); `Cache-Control: no-store`.
- Deep 20,000-bar payload: 1.39MB raw / 274KB gz, ~332ms wire + a single ~13ms main-thread
  `JSON.parse` of 20k keyed objects during the drag.
- **Cold/deep worst-case is UNMEASURED** (all 32 prod cells were warm megacaps). Code paths show
  ~1–3s daily megacap, up to ~20s yfinance daily-tail, 3–8s deep intraday — all inline on a
  threadpool worker. Cold SLOs below are code-path estimates to be validated post-deploy.

---

## Service-Level Objectives

| Metric | Current | Target | How |
|---|---|---|---|
| Warm paint (cached sym+tf) | same-frame (good); server pays 4–8ms json | 0 blank frames; ≤2ms server serialize | A: preserve memPeek. B: orjson + gzip-5 |
| **TF switch on cached ticker** | full network round-trip every switch (p50 89ms) | **≤16ms same-frame from client aggregation**, then authoritative replace | A: resample cached lower TF (D→W/M, then 1/5→15/30/60) |
| Cold first paint (new ticker) | ~1–3s; up to 20s on yf tail; unmeasured | p95 ≤800ms (Massive-only), tail healed off-path | B: cap yf tail, non-blocking waiters, parallel fetch, Server-Timing |
| Deep pan (20k bars) | 274KB gz / ~332ms + ~13ms parse during drag | ≤150ms wire + ≤7ms parse, no dropped frame | B: columnar `?fmt=cols` + orjson |
| **Periodic RTH repaint** | **full chart `setData` every 30s** | incremental only; MAs track the live bar | A: incremental last-bar render branch + signature guards |
| Whole-component re-render (RTH) | ~every 2s (livePrices hook) | 0 from live prices | A: ref/subscription isolation |
| **Live-tick apply** | 250ms poll (4Hz), stair-stepped, no batch | push-driven p95 ≤100ms, ≤1 update/frame/sym | A: rAF coalesce (prereq) → C: poll→push |
| **Wrong-candle rate** | D/W/M/60 unaudited (Daily = default!); R2 upload ungated; outage 2026-07-03 | ~0 — R2 provably good; Daily under drift coverage | Accuracy: upload gate + weekly-key fix + reconcile D/60 |
| Warm origin p95 (guardrail) | 161ms | maintain — no regression | Server-Timing prod probe |

---

## Phase A — Feel pass (frontend render discipline, zero infra risk)

Merges the jank audit (kill the 30s full repaint) with the synthesis (rAF coalescing + client
aggregation). Frontend-only, isolated worktree, revertable — but **not zero *regression* risk**
(StockChart.jsx is the most incident-prone file). The render-decision logic is extracted to a
**pure, unit-tested helper** (`renderPlan.js`, already built: 16 vitest cases green) and every
integration is verified with a build + browser screenshot before ship. Ordered by dependency
and payoff.

**A1 — rAF-coalesce live-tick apply** *(M / low; PREREQUISITE for Phase C)*
`app/src/utils/realtimeCandle.js` (`_notify`) + StockChart update subscriber (~5548–5622). On
`_notify`, mark the sym dirty and schedule one `requestAnimationFrame` flush that runs
subscribers once per frame with the latest candle, instead of a synchronous callback per tick.
**Accept:** under a simulated 20 ticks/s feed, ≤1 `series.update` per sym per frame, no
long-task >16ms; no visual change at today's 4Hz. *Lands first — Phase C's push feed is unsafe
without it.*

**A2 — Incremental last-bar render branch** *(M / medium; the 30s-repaint killer)*
`StockChart.jsx` `updateChart` (2881) using `barsRenderPlan(prevBars, nextBars)` (built). When
the plan is `incremental` (only the last bar's OHLCV changed — the dominant RTH case),
`series.update()` the candle + volume and recompute only the **tail** of each overlay/indicator
instead of full `setData`. `full` (append, backfill, ticker/tf switch, interior correction) and
`noop` behave as today. Bonus: MAs then track the developing bar instead of lagging 30s.
**Accept:** with 3 MAs + RSI + MACD on an intraday chart, a poll carrying only a developing-bar
change performs **zero `setData`** (asserted via a spy in the harness + devtools); MAs move live.

**A3 — Per-series signature guards** *(S / low; complements A2)*
Replicate the proven index-pane guard (4666–4674) via `seriesSig()` (built) on overlay/indicator/
volume `setData` sites (3301, 3391–3832). Skip a series' `setData` when its signature is
unchanged. **Accept:** toggling an unrelated setting triggers zero overlay/indicator `setData`.

**A4 — Client-side TF aggregation D→W/M (optimistic paint)** *(M / medium; instant switches)*
Generalize `resampleWeekly` (`app/src/utils/barsCsv.js`, today Model-Book-only) into
`resample(bars, fromTf, toTf)` mirroring `bucket_60_et_unix_seconds`. In the StockChart bars
selector (~1821): when the requested TF is empty but a lower TF is in memPeek/IDB, synthesize +
paint W/M from cached Daily on the first frame; SWR replaces with authoritative server bars.
**Accept:** with Daily cached, switching to Weekly/Monthly paints same-frame (no network, no
skeleton) and synthesized bars match the server response bar-for-bar (OHLC within cent-rounding).

**A5 — Parallelize cold first-paint fetch with the IDB read** *(M / medium)*
`StockChart.jsx` swrUrl gating (~1673) + `barsIDB.idbGet`. On memPeek miss, fire the no-`since`
full `/api/bars` immediately in parallel with `idbGet` instead of gating on `idbLoaded` (cold
ticker's `since` is null anyway; existing `data.ticker`/`idbReadyForRef` guards prevent
cross-ticker corruption). **Accept:** on a new ticker the fetch starts ≤5ms after mount; no
wrong-ticker flash in a 50-ticker rapid-switch soak.

**A6 — Move watermark off the render path** *(S / low)*
Watermark meta (`tickerMeta`/`watermarkMeta`, in `updateChart` deps 4082, used only at 3031–3043)
resolves after first paint → one extra full repaint per ticker open. Update via its own
`applyOptions` effect; drop those from `updateChart` deps. **Accept:** opening a ticker does the
watermark update with no candle/overlay `setData`.

**A7 — Isolate the 2s live-price re-render** *(M / medium)*
`useRealtimePrices` returns a `livePrices` object that changes ~2s → whole component re-renders.
Consume via ref/subscription (mirror the `realtimeCandle` registry path at 5538) or isolate the
updater in a child. **Accept:** parent re-renders attributable to live prices drop from ~30/min
to ~0; developing bar still updates.

**A8 — Client-side intraday aggregation 1/5 → 15/30/60** *(M / medium; depends on A4)*
Extend `resample` to intraday ET-anchored buckets matching `bucket_60_et_unix_seconds` bit-for-bit
(incl. the DST/session-boundary cases already property-tested server-side). **Accept:** with 5m
cached, switching to 15/30/60m paints same-frame and buckets equal the server buckets.

**Phase A exit:** every TF switch on a cached ticker paints ≤1 frame with no skeleton; live
candles move via rAF-batched `update()` with no dropped frames; cold fetch starts in parallel
with IDB; no viewport jump, no cross-ticker flash across a rapid-switch soak; pure helpers
unit-tested; `npm run build` + vitest green; browser-verified on a live intraday chart with
indicators on. Frontend-only, no backend deploy.

---

## Phase B — Latency floor (backend tail-kill, measurable SLOs)

Kill the pod-side serialization tax and every synchronous request-path tail. Quick wins first;
the two core-serve-path tail-kills (yf cap, dedup-waiter) LAST — they touch the 524-history path.

1. **orjson for bars responses** *(S / low — top single win)* — declare `orjson` in
   requirements.txt (installed, undeclared, unwired); return `ORJSONResponse` on bars paths only
   (`bars.py`, `_get_bars_inner` ~1710, `_get_bars_since_response` ~1387, deep ~1784, stale ~1813).
   Serialize 4.3ms→0.6ms @5000, 18ms→2.4ms @20000. orjson's NaN/Inf rejection is a bonus safety.
   **Accept:** measured serialize drop to targets; headers/status intact.
2. **`?since=` delta poll uses the index query** *(S / low — hottest RTH path)* —
   `_get_bars_since_response` (1376) currently reads 5000 rows + Python-filters to return 1–5;
   switch to `bars_sqlite.get_bars_since` range scan. **Accept:** reads ≤(returned+1) rows
   (EXPLAIN QUERY PLAN uses the index); byte-identical body.
3. **GZip compresslevel=5** *(S / low)* — `main.py:2699`. Near-identical size, less loop CPU on
   1.4MB payloads. SSE skip already correct. **Accept:** deep gz grows <3%, compress CPU drops.
4. **Covering index + mmap** *(S / low)* — `idx_ohlcv_cover(ticker,tf,ts DESC,o,h,l,c,v)` turns a
   5000-row read from ~5000 rowid lookups into one contiguous scan; `PRAGMA mmap_size=268435456`.
   **Accept:** EXPLAIN reports USING COVERING INDEX; warm read benchmark improves; rows unchanged.
5. **Server-Timing + cold measurement** *(M / low)* — emit cache-layer + upstream-ms header; then
   run the latency matrix against a deliberately cold small-cap post-deploy to get real worst case.
   **Accept:** prod responses carry Server-Timing; documented cold-small-cap numbers exist.
6. **Columnar wire `?fmt=cols` (deep/cold path first)** *(M / low)* — add
   `_fmt_sqlite_bars_columnar`; emit `{fmt:'cols',t:[...],o:[...],...}` only when requested;
   decode in ONE place in the fetcher so mergeDelta/IDB/mem/updateChart/live-apply are unchanged.
   Deep raw 1.44MB→~924KB, gz 383KB→~290KB, parse 13.2ms→7.3ms. Pairs with orjson. **Accept:**
   deep payload drops to targets; old clients (no param) get identical keyed responses.
7. **Cap request-path yfinance daily tail-fill** *(M / medium)* — `_fill_daily_tail_with_yf`
   (781) cap to 3–4s (or skip → heal next poll) on the request path; keep 20s only for the
   nightly worker. **Accept:** cold Massive-lagging small-cap first paint <1s; yf tail on a later
   poll; nightly warmer unchanged.
8. **Stop dedup waiters blocking a worker up to 12s** *(L / medium — highest-care in B)* —
   `waiter_ev.wait(timeout=12)` (1942) + deep (1802) each park an anyio worker. Make the handler
   async + `run_in_threadpool` with a capacity limiter, OR have waiters return current stale
   SQLite immediately (SWR retries next poll). **Accept:** a 30-way cold stampede parks ≤1 worker;
   a bare 401 stays <100ms during it. *Land last in B, behind Server-Timing + a stampede test.*
9. **Route per-sym all-TF warm through the shared bounded queue** *(M / low)* — the per-chart
   `runSequential` warm (1755) should feed `prefetchBars.js`'s global concurrency cap so a
   4-pane workspace can't launch several cold chains. **Accept:** 4 cold widgets never exceed the
   shared cap; instant TF switch preserved.
10. **Lower web per-connection SQLite cache_size** *(S / medium)* — `-8192`→`-2048` on web (rely
    on OS cache + mmap); keep worker large. Prevents 64×8MB≈512MB pressure on the 512MB pod.
    **Accept:** RSS under soak stays under ceiling; warm read latency unchanged.

**Phase B exit:** orjson serialize <2.5ms @20k; `?since=` reads only new rows with dedup; cold
small-cap p95 ≤800ms with no inline 20s yf and no worker parked >12s; deep pan columnar with
off-object parse; Server-Timing proves cold vs warm; warm p95 held ≤161ms.

---

## Phase C — Streaming-native (TradingView live-feel, highest care)

Collapse to one multiplexed push stream per tab for prices + developing bars; delete the 250ms
poll; apply via `update()`+rAF. Every task touches the live path with outage history — land only
after A1 (rAF) and behind soak tests.

1. **Drop the redundant price channel** *(S / low)* — the 250ms pass emits both a full price dict
   AND per-sym tick events carrying the same close. Keep the typed tick/bar_close events, drop the
   default full-price message. `stream.py:134` + `priceStreamManager.js`. **Accept:** each price
   emitted once; motion unchanged; per-pass serialize halves.
2. **Unify bar subscriptions into the pooled connection** *(M / medium)* — `useRealtimeBars.js`
   opens its own EventSource per chart; fold (sym,tf) bar subs into `priceStreamManager` so a tab
   holds ONE connection. **Accept:** a 4-widget workspace with bars holds ≤1–2 EventSources;
   generator count doesn't scale with widgets. *Must precede enabling bars.*
3. **Convert `/api/stream/prices` poll→push** *(L / medium)* — replace the `sleep(0.25)` loop with
   `await queue.get()` fed by `bar_broadcaster` (per-subscriber asyncio.Queue, 10–20Hz throttle,
   drop-oldest). Reuse the broadcaster verbatim. Depends on A1. **Accept:** candles move on tick
   arrival (p95 tick→emit <100ms); per-conn CPU proportional to real ticks; 401 fast at 200
   simulated watchers.
4. **Single authoritative developing-bar writer** *(M / high — highest-risk item)* — choose ONE
   writer per (sym,tf) (Massive-fed `bar_broadcaster` authoritative; `realtime_candle` defers or
   is fed from it). Without this, enabling both = last-write-wins flicker / backwards-ticking
   candles (data-doubt worse than slow). **Accept:** exactly one writer per (sym,tf); soak shows
   zero backwards-tick/flicker. *Never enable `STREAM_BARS_ENABLED` alongside Finnhub without this.*
5. **Promote Massive WS as primary tick source (entitlement-gated)** *(M / high)* — after the
   single-writer invariant, make Massive WS primary (AM closes + A per-second + T per-trade),
   Finnhub fallback. Verify entitlement/rate limits first. This removes the "tape feels stalled"
   signal on fast names. **Accept:** tick density matches a TradingView reference qualitatively;
   Massive closes reconcile with the REST snapshot; Finnhub fallback still engages on drop.

**Phase C exit:** one multiplexed push stream per tab; 250ms poll gone; continuous rAF-applied
motion with a single authoritative writer; per-user streaming CPU scales with real ticks;
unrelated routes fast under 200+ concurrent live watchers.

---

## Accuracy hardening (threaded through — land cheap items in parallel with A)

The write-side holes that match the recent outage. **These are cheap and land first.**

1. **R2 upload-time integrity gate** *(M / low — huge blast radius)* — `data_sync._make_tarball`
   / `_export_delta_db`: `PRAGMA integrity_check == 'ok'` + a row-count floor before the PUT.
   Download side verifies at 3 points; upload side at zero — a corrupt worker DB already reached
   the bucket (2026-07-03). **Accept:** a deliberately corrupted worker DB is refused upload; a
   valid one uploads; unit-tested.
2. **`audit.py` weekly Friday-key fix + test** *(S / low — unblocks W reconciliation)* — the
   cache-side second pass keys weekly wrong, so a Weekly audit silently intersects to 0. Re-key to
   ISO Friday (matching `fetch_canonical_bars` + the real cache scheme). **Accept:** a unit test
   asserts a known weekly series audits with `bars_compared > 0`. *Strict prerequisite before
   adding W to the reconciler — otherwise it could DELETE correct rows or audit nothing while green.*
3. **Add Daily (+60m) to the reconciler** *(M / medium)* — `_TFS` excludes D/W/M/60; **Daily is
   the default TF with zero drift coverage.** Add D (and 60 via its 30m source) after the weekly
   fix, gated on a unit test asserting `bars_compared > 0` (a reconciler bug over an untested TF
   can surgically delete good rows). **Accept:** reconciler audits D; test proves it compares real
   bars; drift on D is detected+healed in a seeded test.
4. **Date-TF-aware validate/quarantine before `put_bars`** *(M / medium)* — the daily write path
   validates nothing and always persists; quarantine is intraday-only. Make validation date-TF
   aware. **Accept:** a majority-valid daily payload with one bad bar quarantines the bad bar, not
   the batch.
5. **Tighten `isSaneLivePrice` + cross-check** *(S / low)* — ±50% deviation is too loose; tighten
   and cross-check against the 15s REST snapshot. **Accept:** a >X% single-tick jump vs the REST
   snapshot is rejected; legitimate fast moves pass.
6. **Zero-doubt UI freshness signal** *(S / low)* — a subtle last-updated / stale badge so the
   user never has to wonder. **Accept:** stale data is visibly marked; fresh data is unmarked.

---

## Sequencing & top risks

**Order:** A (+ cheap accuracy in parallel) → B (quick wins → columnar → risky tail-kills last)
→ C (redundant-channel → unify subs → poll→push → single-writer → Massive promotion).

**Within A:** A1 rAF first (prereq for C) → A2/A3 render discipline → A4 D→W/M aggregation →
A5 parallel fetch → A6/A7 → A8 intraday aggregation (depends on A4).

**Top risks (verbatim from analysis):**
1. Live-price path has outage history — the B `?since=` dedup change and all of C touch it;
   preserve bounded-semaphore/serve-stale degradation; soak-test worker parking before deploy.
2. Bars WRITE path can poison the fleet — fix the upload gate + date-TF validation before trusting
   the reconciler; never run the reconciler on W until the weekly-key fix lands.
3. Two developing-bar writers (Finnhub + Massive) without the single-writer invariant → flicker /
   backwards-ticking (data-doubt). Highest-risk item; gate hard.
4. The async bars-handler refactor (B #8) is the biggest tail win but rewrites the core serve path
   — land last in B, behind Server-Timing + a stampede test.
5. Cold/deep worst-case is unmeasured — validate the ≤800ms cold SLO against a real cold small-cap
   post-deploy before claiming it.
6. SQLite cache_size/mmap interact with the 512MB pod ceiling — measure RSS before/after.
7. Columnar has wide blast radius if global — keep it opt-in `?fmt=cols`, decode in one place.

**Verification discipline:** frontend changes get a build + Playwright screenshot of a live chart;
backend changes get a benchmark or EXPLAIN + the existing test suite; live-path/write-path changes
get a soak/stampede test before deploy. Ship in small, independently-revertable commits.
