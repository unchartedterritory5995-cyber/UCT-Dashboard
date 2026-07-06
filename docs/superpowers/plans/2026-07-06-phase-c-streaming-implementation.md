# Phase C — Streaming-native (poll → push) Implementation Plan

**Date:** 2026-07-06 (for Monday market-open execution)
**Goal:** Convert the chart's live developing bar from the always-on 250 ms SSE **poll**
(`/api/stream/prices`) toward the built-but-dark Massive-WS **push** fan-out
(`bar_broadcaster` + `/api/stream/bars`), for continuous TradingView-grade live motion —
**without** introducing flicker, a stale chart, or a shared-loop outage.

Grounded in a 4-way deep read of the streaming stack + an adversarial review that found
8 defects (2 blockers) in the first draft. **This doc is the corrected plan** — every
adversarial fix is folded in and cross-referenced in §7.

## 1. The core hazard is DATA-DOUBT, not latency

The moment `STREAM_BARS_ENABLED=1` (backend) **and** `VITE_REALTIME_BARS=1` (frontend) are
both on, multiple client writers hit the same Lightweight-Charts series for the same
`(sym, resolvedTf)` with no arbitration → **backwards-ticking / flickering candles**, which
is worse than being slightly slow. There are **four** developing-bar geometry writers on the
client, not two:

- **A** — the `livePrices` tick effect (`StockChart.jsx ~2686-2802`, Finnhub-fed)
- **B** — `onRealtimeBar` (`~2819-2881`, Massive-push-fed)
- **C** — the `realtimeCandle` registry subscriber (`~5653-5739`, Finnhub-fed)
- **D** — the post-`setData` re-apply inside `updateChart` (`~3240-3287`), driven by
  `latestLiveRef` (set only in A) + `liveBarRef`; fires after every 30 s intraday `setData()`.
  **The first draft missed D — it is the source of the "seam every 30 s" failure.**

**Good news:** both *server* stores are already strictly single-feed — `realtime_candle._state`
is fed ONLY by the Finnhub trades WS (`realtime_stream.py:313-319`), and
`bar_broadcaster._partials` ONLY by the Massive `/stocks` WS. So the invariant only needs
enforcing on the **client**. (`api/massive_ws_worker.py` is the OPTIONS-flow WS — NOT a chart
bar writer; ignore it.)

## 2. The single-writer invariant (linchpin — get this exactly right)

Exactly ONE authoritative developing-bar writer per `(sym, resolvedTf)`, enforced on the client.

```
barsPushActive(sym, tf) =
     VITE_REALTIME_BARS === '1'                    // compile-time cohort gate
  && !localStorage['uct.barsPool.disabled']        // RUNTIME instant kill (see §6)
  && useRealtimeBars.healthy                        // connected AND a bar/heartbeat within N s (watchdog, §7-#4)
  && realtimeTfEligible(tf)                         // 1/5/15/30/60 only
  && pushDelivering(sym, tf)                        // a first bar for THIS (sym,tf) has actually arrived (§7-#5)
```

**While `barsPushActive` is TRUE for a `(sym,tf)`:**
- **B (`onRealtimeBar`) is the SOLE writer** of `candleSeriesRef.update()`, `liveBarRef`,
  and `lastBarRef` geometry. B must **OWN** those refs — create-or-advance them for the
  current bucket, not merely sync-on-time-match (the draft's bug at bucket rollover).
- **A, C, and D all early-return** their series/geometry writes (A/C may still update the
  legend/price badge; D must early-return entirely). `latestLiveRef` must be frozen/ignored
  while push is authoritative (else D repaints a stale bar over the fresh REST tail).

**While `barsPushActive` is FALSE** (flag off, market closed, ineligible TF, push not yet
delivering, disconnected, or killed): Finnhub A + C revert to sole writer = **today's exact
behavior**. A unit test asserts `barsPushActive` is provably FALSE whenever
`VITE_REALTIME_BARS !== '1'`, so the arbitration ships **dark** with zero behavior change.

**Server invariant:** keep each store strictly single-feed; NEVER add a second feed to either.
Add a defensive per-`(sym,tf)` "last authoritative source" assertion in `bar_broadcaster`.

## 3. Weekend dark-prep (safe to ship now — verify each is truly dark)

All of these are invisible while `VITE_REALTIME_BARS=0` / `STREAM_BARS_ENABLED=0`. Ship
behind tests; a bug must not touch the always-on price path.

1. **A1 coalescer as a pure module (NOT wired in yet)** — NEW `app/src/lib/liveCoalesce.js`
   (rAF scheduler with injectable schedule fn + jsdom setTimeout fallback + flush/cancel) +
   tests. **Accept:** vitest green; grep shows ZERO call sites, so runtime is byte-identical.
2. **Bars pool in a SEPARATE module** — NEW `app/src/lib/barsStreamManager.js` (SYM:TF
   buckets, union dedupe, ONE `/api/stream/bars` EventSource per ≤50-pair bucket, 400 ms
   debounced rebuild, **keyed dispatch: a `bar` event goes ONLY to subscribers matching
   `data.sym:data.tf`** — see §7-#1). Convert `useRealtimeBars.js` to `subscribe()` this pool
   (keep the `VITE_REALTIME_BARS` gate + a localStorage kill). **DO NOT edit
   `priceStreamManager.js`** — a bug there breaks live prices for everyone (§7-#6). **Accept:**
   with `VITE_REALTIME_BARS` unset no EventSource opens (test); pool unit tests cover keyed
   dispatch + union dedupe + bucket cap + debounced rebuild.
3. **Client single-writer arbitration (`barsPushActive`), shipped dark** — the A/B/C/**D**
   suppression in `StockChart.jsx` + the `data.sym/tf` guard at the top of `onRealtimeBar`
   (§7-#1) + B owning `liveBarRef` on new buckets (§7-#2). **Accept:** unit test asserts
   `barsPushActive` is strictly FALSE when `VITE_REALTIME_BARS!=='1'`; a rollover test; existing
   StockChart tests green.
4. **`useRealtimeBars` heartbeat watchdog** (§7-#4) — reset a timer on any message incl. the
   15 s `: heartbeat`; on timeout force reconnect + `healthy=false`. Derive `barsPushActive`
   from "healthy", not raw `connected`.
5. **Harden `stream_bars` endpoint** (`stream.py:241-267`) — replace the `get_nowait` +
   `sleep(0.05)` idle floor with **persistent per-queue `get()` tasks** (create once, re-arm
   only fired ones) or one shared queue, to avoid the cancel/deliver drop (§7-#9). 503 while
   dark, unchanged in prod. **Accept:** local test drives the generator with a fake broadcaster,
   asserts one awaited wake per emitted bar, zero drops, heartbeat cadence, clean unsubscribe.
6. **Soak harness** — NEW `tools/bars_stream_soak.py` (+ `tests/test_bar_broadcaster_concurrency.py`):
   concurrent-stampede against the broadcaster, assert no queue corruption / unbounded growth,
   drain path executes. Not imported into the app.
7. **Backend authoritative-feed fingerprint + defensive single-feed assertion** — boot-log line
   next to `chart-realtime-mode`; assertion in `bar_broadcaster` never trips in the soak.

## 4. Monday live steps (ordered — each behind a fast RUNTIME rollback)

**Step 1 — Ship A1 live** *(medium)*. Wire `liveCoalesce` into `realtimeCandle._notify` + fix
the 5m+ wick branch. **MANDATORY:** land the localStorage/VITE synchronous-path kill in the
SAME commit (§7-#7) — A1 rides the always-on Finnhub feed and otherwise has no instant revert.
**Verify (live):** developing 1m candle moves smoothly, ≤1 repaint/frame on bursty tickers;
5/15/30/60m wicks reach the same highs/lows (compare a second tab on the SWR path);
background→foreground repaints latest. **Rollback:** flip the localStorage kill (instant).
**Gate:** weekend A1 + StockChart tests green; market open.

**Step 2 — `STREAM_BARS_ENABLED=1` BACKEND-ONLY** *(high; `VITE_REALTIME_BARS` stays 0)*. Prove
entitlement + the never-run-in-prod dormant paths. **Verify:** curl `GET /api/stream/bars?bars=AAPL:1`
(browser UA — Cloudflare 1010-blocks bare curl); logs show Massive `auth_success`, the subscribe
queue FLUSHES (the `_drain_pending_queue` fix — never run live before), and **both AM (minute
close) AND A/T (sub-minute)** events arrive (confirms real-time `/stocks`, not the 15-min tier);
single Massive connection. **Failure:** 503 (flag not read), no `auth_success`, only AM (not
real-time entitled), or silent no-subscribe. **Rollback:** `STREAM_BARS_ENABLED=0` + redeploy
(next-boot gate, NOT instant — §7-#8; fine here since no consumer). **Gate:** Step 1 verified;
arbitration merged dark; soak clean.

**Step 3 — `VITE_REALTIME_BARS=1` for a CANARY** *(high — the data-doubt gate)*. Activates the
pooled consumer + arbitration. **Verify (live, active name):** developing bar tracks Massive with
NO backwards-tick/flicker/oscillation; NO seam/jump at the 30 s SWR repaint; DevTools shows ONE
`/api/stream/bars` EventSource per tab regardless of chart count; a temporary dev assertion never
logs a double-writer. **Failure:** flicker/backwards-tick (arbitration leak — Finnhub still
writing), a 30 s seam (D not suppressed / B not owning refs), or N connections for N charts (pool
bypassed). **Rollback:** localStorage `uct.barsPool.disabled=1` (INSTANT — §7-#3); NOT
`VITE_REALTIME_BARS=0` (build-time). **Gate:** Step 2 proven (A/T flowing); invariant proven in
code (barsPushActive test + rollover test + dev double-writer assertion).

**Step 4 — Widen rollout + resolve the backend double-close seam** *(medium)*. **Verify:** closed
bars match the persisted Massive SQLite row (no post-close correction flash) and REST on next SWR
poll; reconnect gap-backfill (`onRealtimeReconnect ~2883`) doesn't un-draw the developing bar.
**Rollback:** localStorage kill for the widened cohort; `STREAM_BARS_ENABLED=0` full backstop.
**Gate:** canary green a full session, no flicker, no seam.

## 5. Massive-WS-primary (later, entitlement-gated)

After the canary is stable, optionally promote Massive WS as the primary tick source (AM closes +
A per-second + T per-trade), Finnhub as fallback. Requires the entitlement proof from Step 2. Not
required for the initial live-feel win.

## 6. Kill-switches (corrected — which are actually instant)

| Switch | Scope | Speed | Effect |
|---|---|---|---|
| **`localStorage['uct.barsPool.disabled']='1'`** | per-browser | **INSTANT (runtime)** | pool → `healthy=false` → `barsPushActive=false` → A/C resume. **The real canary kill.** |
| **A1 synchronous-path localStorage/VITE kill** | per-browser | **INSTANT (runtime)** | forces `_notify` synchronous fan-out. Must ship in the A1-wire commit. |
| `VITE_REALTIME_BARS=0` | frontend build | minutes (rebuild+deploy) | compile-time **cohort gate**, NOT an instant kill (§7-#3). |
| `STREAM_BARS_ENABLED=0` | Railway web env | **next boot** (redeploy; does NOT stop a running WS thread) | 503 on next boot + skips Massive init. Backend backstop (§7-#8). |
| Complete revert to today | — | — | `STREAM_BARS_ENABLED=0` AND `VITE_REALTIME_BARS=0` = exact current behavior. |

## 7. Adversarial fixes folded in (traceability)

1. **[blocker] Cross-symbol bar application** — pool dispatches `bar` events ONLY to matching
   `(sym,tf)` subscribers, AND a guard `if (data.sym!==sym || data.tf!==resolvedTf) return` at the
   top of `onRealtimeBar`. Same dark commit as pooling. *(→ §3.2, §3.3)*
2. **[blocker] Single-writer hole at rollover + missed 4th writer (D)** — B owns `liveBarRef`/
   `lastBarRef` (create-or-advance per bucket); D (post-`setData` re-apply, 3240-3287) ALSO
   early-returns under `barsPushActive`; `latestLiveRef` frozen while push authoritative. Add a
   rollover test. *(→ §1, §2, §3.3)*
3. **[major] `VITE_REALTIME_BARS` is build-time, not instant** — the instant kill is runtime
   localStorage. Re-labeled in §6. *(→ §6, Step 3 rollback)*
4. **[major] No heartbeat watchdog → half-open freeze** — add a watchdog to `useRealtimeBars`;
   derive `barsPushActive` from "healthy" (bar/heartbeat within N s), not raw `connected`. *(→ §2, §3.4)*
5. **[major] `marketLive` undefined + extended-hours** — replaced with `pushDelivering` (first
   bar for THIS (sym,tf) actually arrived), so A/C keep the candle alive until B is proven live,
   and it works in extended hours. *(→ §2)*
6. **[major] Bars pool edited the always-on price manager** — put it in a SEPARATE
   `barsStreamManager.js`; `priceStreamManager.js` byte-untouched. *(→ §3.2)*
7. **[major] A1 had no instant rollback** — the synchronous-path kill is MANDATORY and ships in
   the same commit that wires `_notify`. *(→ Step 1)*
8. **[minor] `STREAM_BARS_ENABLED=0` is next-boot, not instant, and doesn't stop a running WS** —
   documented as a next-boot backstop, not an instant stop. *(→ §6, Step 2)*
9. **[minor] `stream_bars` wait-over-queues can drop a bar (cancel/deliver race)** — persist
   per-queue `get()` tasks (re-arm only fired ones) or one shared queue; soak asserts zero drops.
   *(→ §3.5)*

## 8. Sequencing summary

Weekend (dark, ships now, all behind tests + off flags): §3.1–§3.7.
Monday (live, market open, each behind a runtime kill): Step 1 (A1) → Step 2 (backend-only) →
Step 3 (canary — the data-doubt gate) → Step 4 (widen + seam). Never `STREAM_BARS_ENABLED=1`
alongside a frontend consumer without the §2 invariant proven in code.
