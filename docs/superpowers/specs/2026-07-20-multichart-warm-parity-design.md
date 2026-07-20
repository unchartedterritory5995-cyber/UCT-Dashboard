# Multi-Chart Grid — Chart-Parity Warming (instant TF-switch + scroll-back)

**Date:** 2026-07-20
**Status:** Design (approved in principle; pending spec review)
**Owner request:** "Copy the same instantaneous feel of the recent chart upgrades so they mimic the speed and functionality on all timeframes in the multichart layout."

## 1. Problem & Goal

The primary chart (`ChartWidget` → `StockChart` with `backgroundWarm=true`) feels instant on every timeframe: switching TFs and scrolling back for history are immediate because it pre-fetches all timeframes and deep history in the background. Multi-Chart **grid cells** (`GridChartCell`) pass `backgroundWarm={false}` — a deliberate guard against the 2026-05-24 fetch-herd outage (16 cells × up to 7 TFs of direct `fetch()` = ~130+ concurrent cold fetches). As a result, in the grid **every timeframe switch is a cold `/api/bars` fetch** and scroll-back stalls.

**Goal:** give grid cells the same instant feel on all timeframes — without recreating the herd. Explicitly a *latency* project, not a correctness one.

### What is already true (verified against master — no work required)

Three of the four "recent upgrades" already reach grid cells unchanged; the design must **not** re-implement them:

- **Live streaming (CONFIRMED):** `GridChartCell` never sets `liveUpdates`, so it defaults `true`. On intraday TFs cells subscribe to the browser-wide **shared** bars push pool (`barsStreamManager` — 16 cells = **one** `/api/stream/bars` EventSource) and paint the developing bar via Writer B; D/W/M cells tick via the `livePrices` path (Writer A) + the 1-min bar Writer E. No per-cell stream exists and none must be added.
- **Stale-gap immediate refetch (CONFIRMED):** `idbStaleIntraday` / `_sinceParam` (StockChart.jsx ~2267-2294) is computed unconditionally — grid cells inherit "fill the stale gap immediately (full refetch)" for free.
- **Sane-price chokepoint (CONFIRMED):** `isSaneLivePrice()` guards all four developing-bar writer sites unconditionally — grid cells are protected from phantom spikes.

### The one real gap

The background **warm** (all-TF pre-fetch + deep-history dwell-warm) is off for grid cells. That is the entire scope of this project.

## 2. Approach (validated)

Do **not** re-enable StockChart's per-cell warm chain (`backgroundWarm`) — that path does **direct `fetch()`** outside any queue and is the literal herd vector. Instead:

1. **Container-driven shallow warm** of all cell symbols across **all 8 timeframes**, driven once from `MultiChartGrid`, routed through the **existing bounded, idle-deferred prefetch queue** (`prefetchBars.prefetchListAllTimeframes`, `_IDB_MAX = 3`). This makes any cell's TF-switch paint same-frame from the synchronous mem cache.
2. **Active-cell-only deep-history warm** via a new `deepWarm` StockChart prop that gates *only* the 900 ms dwell-warm (independent of the all-TF chain), passed for the focused **or** maximized cell only — so scroll-back is instant where the user is looking, with ≤1 deep fetch in flight.
3. **Live streaming / stale-gap / sane-price:** verification only — a manual/RTH check plus a regression guard test. No code.

### Why this is herd-safe (proven)

- `prefetchListAllTimeframes` funnels 100% into the `_idbQueue` (max **3** concurrent), short-circuits already-warm `(sym,tf)` via `idbGet` (no fetch), dedupes re-fires for 60 s, warms only the shallow **600-bar** window (not 5000), and is idle-deferred.
- Worst case for a 16-cell grid across 8 TFs = 128 enqueued jobs, **≤3 in flight**, plus the mount queue's ≤3 primary fetches ⇒ aggregate `/api/bars` ceiling ≈ **6 concurrent**, ~1/20th of the 2026-05-24 herd.
- This is a strict **subset** of the already-shipped watchlist warm (`Watchlists.jsx` calls the identical function at up to 100 syms × 5 TFs = 500 jobs on the same queue) running at ~200 users. Safe by construction.

**Locked invariant:** `GridChartCell` keeps `backgroundWarm={false}` forever. Flipping it re-enables StockChart's direct-fetch all-TF chain = instant herd regression. A guard test enforces it.

## 3. Components & Changes

### 3a. `prefetchBars.js` — warm all 8 TFs for the grid
`prefetchListAllTimeframes(tickers, { tfs, cap })` already accepts a `tfs` override. The grid passes the full set `['D','5','60','30','15','W','M','1']` so Weekly/Monthly/1-min are warmed too (today `SCAN_WARM_TFS` omits W/M/1). No change to the queue/caps. (W/M already have an optimistic `_aggBars` Daily-resample fallback; 1-min has none, so warming it is the only way to make 1-min instant.)

### 3b. `MultiChartGrid.jsx` — the warm effect (4 mandatory guards)
A single `useEffect` that warms the current grid symbols. It **must**:

1. **Content-keyed dependency.** Key on `gridSyms.join(',')` (or a `prevSyms` ref compare), **never** the `gridSyms` array identity — `cells.map(...)` returns a new array on every mutation (TF-only click, Style-only click, undo, layout switch), so an identity-keyed effect would re-warm the whole grid on churn that didn't change the sym set.
2. **Hydration + first-paint deferral.** Skip while `!hydrated` (skeleton phase — a late saved-pref swap would waste warms). Defer the warm until the initial visible cells have released their mount-queue slots (`onBarsReady`) **or** a ~2 s fallback elapses — `requestIdleCallback` alone is *not* a hard gate against stealing server-pool slots from the visible cold paint (which would also erode the just-shipped peers-latency win).
3. **Read-only side-effect.** Call `prefetch*` only; never a state mutator — otherwise it trips `scheduleSave` (`useMultiChartState`) and thrashes `multichart_state` persistence.
4. **Dedupe-friendly.** Already-warm syms short-circuit in the queue; the effect just enqueues the current set.

### 3c. `deepWarm` split — StockChart + GridChartCell + MultiChartGrid
- **StockChart.jsx:** add prop `deepWarm = false`. Change the dwell-warm gate (~L7672) from `if (!backgroundWarm) return` to `if (!backgroundWarm && !deepWarm) return`, and add `deepWarm` to that effect's dep array. **Leave the all-TF chain (~L2416) gated on `backgroundWarm` alone — untouched.**
- **GridChartCell.jsx:** add a `deepWarm` prop, forward it to `<StockChart deepWarm={deepWarm} …>`, keep `backgroundWarm={false}`.
- **MultiChartGrid.jsx:** pass `deepWarm={activeIdx === i || maxId === cell.id}`. `deepWarm` is a **boolean value** (not the `isActive` thunk — a ref mutation won't re-run the effect). The dwell-warm's own 900 ms timer is the inherent debounce so a hover sweep fires no fetch; only the active + previously-active cell re-render (bounded).

## 4. Data flow

```
group fill / manual add / layout change
        │  (cells mutate → gridSyms content changes)
        ▼
MultiChartGrid warm effect  ── content-keyed, hydrated, deferred, read-only ──▶  prefetchListAllTimeframes(gridSyms, {tfs: all 8})
        │                                                                              │
        │                                                              _idbQueue (≤3 concurrent, idle-deferred, 600 bars, empty-slot-only)
        │                                                                              ▼
        │                                                              idbPut + memPut + SWR preload  (keyed by (sym,tf))
        ▼
cell TF-switch ──▶ StockChart bars selector reads memPeek(sym,tf) SYNCHRONOUSLY on frame 1 ──▶ instant paint

hover/focus/maximize a cell ──▶ deepWarm=true ──▶ (900ms dwell) setFetchDepth(_fullTarget) ──▶ deep history loads ──▶ scroll-back instant
```

## 5. Deliberate parity concessions (documented, tunable)

- **Deep history warms only the focused/maximized cell**, not all 16 (deep-warming all = herd). Scroll-back is instant where you're looking; a non-focused cell's first scroll-back is an on-demand backfill (already the case today).
- **The "warm 5-min early" ordering** (commit 54c11091) is a StockChart-internal `backgroundWarm` optimization the grid intentionally does not run per-cell; the container warm covers the same TFs via the shared queue instead.
- A **global Heikin-Ashi** chart-setting disables the push feed on all cells by design (they fall back to the 30 s SWR cadence). Documented, not fixed here.

## 6. Error handling / safety

- All warm fetches are best-effort (`_idbWarmOne` swallows errors; a single TF failure never breaks the chain).
- Warm writes only **full non-delta** responses into **empty** IDB slots ⇒ cannot overwrite or delta-corrupt an existing series. The unconditional `idbStaleIntraday` read-layer guard backstops any stale-but-nonempty full response the backend might serve.
- Kill path: the warm is a single call site; guarding it behind a flag (e.g. `VITE_GRID_WARM_ENABLED`, default on) gives an instant revert without touching streaming.

## 7. Testing

**Unit / component (vitest):**
- Content-keyed dedupe: a TF-only / Style-only / undo change with the same sym set does **not** re-call `prefetchListAllTimeframes`.
- Pre-hydration gate: `hydrated=false` ⇒ zero warm calls; flip ⇒ warms once.
- First-paint deferral: warm not invoked during the cold-paint window (only after mount slots release / fallback).
- `deepWarm`: only the active/maximized cell gets `deepWarm=true` and reaches `_fullTarget` after the 900 ms timer (fake timers); inactive cells stay `FIRST_PAINT_BARS`. Rapid active-flip < 900 ms ⇒ no `setFetchDepth`.
- Persistence isolation: warm path never calls `setPref`.
- **Locked-invariant guard:** every `GridChartCell` renders `StockChart` with `backgroundWarm={false}`.
- Warm all 8 TFs: the grid warm targets W/M/1 in addition to D/5/60/30/15.
- Reused-instance: a peer-fill sym swap on a deep-warmed instance resets `fetchDepth` to `FIRST_PAINT_BARS` (shallow open).

**Integration / perf (admin `?gridspike=16` harness + `read_network_requests`):**
- Peak concurrent `/api/bars` ≤ ~6 (3 mount + 3 warm); all warm fetches shallow (600), not 5000; warm starts only after first paint.
- Live smoke (RTH, push on): deep-warm the active cell mid-session ⇒ developing bar stays correct (single-writer / Writer-D re-top) after the deep-history `setData`.

## 8. Out of scope

- Deep-warming every cell; per-cell warm-ordering; any change to the streaming pool; fixing the global-HA-disables-push behavior; the primary chart.

## 9. Verified-assumption ledger (source: 6-agent adversarial verification, 2026-07-20)

| Assumption | Verdict | Consequence for this spec |
|---|---|---|
| Warm populates the exact cache a TF-switch reads | CONFIRMED (mechanism) / PARTIAL (not wired today) | Wire it up in MultiChartGrid + extend TFs to W/M/1 |
| 16-cell warm is herd-safe via the shared queue | CONFIRMED | Keep it on `prefetchListAllTimeframes`; keep `backgroundWarm=false` |
| Deep-warm can be split for the active cell only | CONFIRMED | New `deepWarm` prop gating only the dwell-warm |
| Live streaming already works in grid cells | CONFIRMED | Verification only; no code |
| No regression to mount queue / peers fix / persistence | PARTIAL | Only with the 4 mandatory guards in §3b |
| Stale-gap / first-paint parity + no warm poisoning | CONFIRMED | No new guard needed; add a regression test locking the read-layer guard |
