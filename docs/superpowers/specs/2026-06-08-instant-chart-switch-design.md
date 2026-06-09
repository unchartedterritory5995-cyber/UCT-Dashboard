# Instant Chart Switch — Design (Phase 1 of Chart Feel Initiative)

**Date:** 2026-06-08
**Status:** Approved (design); pending implementation plan
**Scope:** Frontend only. No backend/API changes.

## Context

`StockChart.jsx` is already sophisticated: IDB-first paint, delta-merge on SWR
resolve, extensive cross-ticker flip guards, WS tick streaming via
`useRealtimeBars`, a live-bar ref that survives `setData()`, and per-TF
prewarming. The remaining gap versus TradingView / top-tier broker apps is
**perceived latency on switch**: every ticker or timeframe change currently
shows a spinner flash even when the data is already cached, because the load
path is async-first.

### Root of the perceived-latency problem (current code)

On every `sym`/`tf` change, `StockChart.jsx` runs `setIdbBars(null)` (≈ line
1423) and then an **async** `idbGet(sym, tf).then(...)`. That guarantees at
least one render with `bars === null` → `loading = !bars && !error` (≈ line
1625) → spinner. IndexedDB reads are ~1–10ms, but they are still an async hop,
so even a chart you viewed seconds ago repaints through a spinner frame.

The SWR fetch is already gated behind the IDB load (`swrUrl` only set once
`idbLoaded && idbReadyForRef.current === \`${sym}_${tf}\``, ≈ line 1476) so it
can send a `since` delta — that part stays.

## Goal

A ticker/TF switch to **cached** data paints in the same frame (no spinner). A
switch to **uncached** data shows an honest skeleton (never another ticker's
candles) and snaps in real data when it lands. Hovering a ticker pre-warms it
so the eventual click is instant.

Non-goals (handled in later phases of the initiative): viewport-first payload
(Phase 2 / B4), Cloudflare edge cache for immutable history (Phase 2 / B5), WS
reconnect reliability (Phase 3 / B6), W/M canonical audit coverage
(Phase 4 / C7).

## Components

Three coordinated changes. Build order: A2 → A1 → A3 (A1 and A3 both consume
the A2 cache).

### A2 — Synchronous in-memory bar cache (foundation)

New module `app/src/utils/barsMemCache.js`.

- Module-level `Map` keyed `\`${SYM}_${TF}\`` → `{ bars, lastTs }`.
- LRU-capped at `MEM_CACHE_MAX = 60` entries (re-`set` on read to mark MRU;
  evict oldest when over cap). ~60 × ~5000 bars is a bounded, modest heap cost.
- API:
  - `memGet(sym, tf) → bars | null` (marks MRU on hit)
  - `memPut(sym, tf, bars)` (no-op on empty array)
  - `memHas(sym, tf) → boolean`
  - `memClear()` (test helper)
- Keys normalize the symbol to uppercase to match the rest of `StockChart`.
- Populated wherever bars resolve in `StockChart`: after the `idbGet` load,
  after a non-delta SWR response, and after a `mergeDelta`. Read synchronously
  on switch, **before** the async `idbGet`.

### A1 — Eliminate the blank frame

Modify the switch effect + loading derivation in `StockChart.jsx`.

- On `sym`/`tf` change, synchronously consult `memGet(sym, tf)`:
  - **Hit:** seed `idbBars` with the cached bars immediately (instead of
    `setIdbBars(null)`), and set `idbReadyForRef.current` to the matching
    `\`${sym}_${tf}\`` key so the existing guards treat it as belonging to the
    current sym. The chart paints the same tick. `idbGet` + SWR still run in the
    background to revalidate (delta-merge unchanged).
  - **Miss:** transition straight to the **skeleton** loading state. Do NOT
    leave the previous ticker's candles on screen during the cold fetch (that
    would reintroduce the "wrong ticker's price action" bug). Concretely: clear
    the series / mark `idbBars` unavailable for this key AND render
    `ChartSkeleton` in place of the candles until real data for the current sym
    lands. The cross-ticker guards remain the gate for applying any fetched
    data; A1 never bypasses the `data.ticker !== sym.toUpperCase()` check or the
    `idbReadyForRef` gate.
- `loading` becomes a real skeleton render rather than a bare spinner. New
  lightweight `ChartSkeleton` (inline subcomponent or small file): chart frame
  + axis placeholders + a single shimmer band, `prefers-reduced-motion` aware
  (static when reduced).

**Safety contract (must not regress):** the only data ever drawn for the
current sym is data whose server `ticker` matches that sym, or
memcache/IDB entries whose key matches `idbReadyForRef.current`. The "random
candles flashing on flip" class of bug stays closed.

### A3 — Prefetch on hover/focus intent

Extend `app/src/utils/prefetchBars.js`.

- New `prefetchBarOnIntent(sym, tf)`:
  - No-op if `memHas(sym, tf)` (already warm).
  - ~120ms debounce per `\`${sym}_${tf}\`` key; dedupe in-flight requests.
  - Fetches **only the current TF** (not all five), writes to both memcache and
    IDB on success.
- Wire `pointerenter` / `focus` handlers on ticker rows/chips across
  high-traffic surfaces: Watchlists, ThemeTrackerPage, Screener, MoversSidebar,
  CatalystTable, Breadth drill lists. `TickerPopup` already prefetches on
  hover — reuse/extend that pattern rather than duplicate it.
- Actual selection continues to call the existing `prefetchAllTimeframes`
  (warms all TFs for the picked symbol).

**Cost posture:** hover-prefetch is current-TF-only, debounced, and
cache-gated, so it only reaches Massive for genuinely-cold tickers the user
lingers on. It is net-new request volume, bounded by user attention. Dials if
needed: longer linger (~250ms), keyboard-focus-only, or a per-surface opt-out.

## Data Flow (post-change)

```
switch(sym, tf)
  → memGet(sym,tf)            [synchronous]
      hit  → seed idbBars, paint THIS FRAME ─┐
      miss → render ChartSkeleton            │
  → idbGet(sym,tf) [async]  → seed/merge ────┤→ updateChart setData()
  → SWR fetch /api/bars?...&since=…          │   (existing flip guards)
      → memPut + idbPut on resolve ──────────┘
  → useRealtimeBars WS ticks → series.update() (unchanged)

hover(sym) → prefetchBarOnIntent(sym, currentTf) → memPut + idbPut (cold only)
```

## Error Handling

- Memcache is a pure perf layer: any miss/throw falls back to the existing
  IDB → SWR path. It never holds error state.
- Skeleton renders on miss until either data lands or `error` is set; on
  `error` the existing error UI shows (unchanged).
- Prefetch failures are swallowed (best-effort warm); they never surface to the
  user and never poison the cache (only successful non-empty responses
  `memPut`).

## Testing

- **`barsMemCache` units:** put/get/has, empty-array no-op, LRU eviction at cap,
  MRU promotion on read, uppercase key normalization.
- **StockChart behavior:**
  - Warm switch (memcache seeded) paints without a `null`/spinner frame.
  - Cold switch renders the skeleton, not the previous ticker's candles.
  - Cross-ticker guard still rejects a `data.ticker` ≠ current-sym response.
- **Prefetch units:** debounce collapses rapid hovers, dedupe prevents parallel
  duplicate fetches, cache-gate skips fetch when `memHas` is true.

## Files

- New: `app/src/utils/barsMemCache.js` (+ test)
- New: `ChartSkeleton` (inline in `StockChart.jsx` or `app/src/components/chart/ChartSkeleton.jsx`)
- Modified: `app/src/components/StockChart.jsx` (switch effect, loading render, memPut wiring)
- Modified: `app/src/utils/prefetchBars.js` (`prefetchBarOnIntent`)
- Modified: high-traffic ticker-list surfaces (hover/focus wiring): Watchlists,
  ThemeTrackerPage, Screener, MoversSidebar, CatalystTable, Breadth drill
- Tests: `app/src/utils/barsMemCache.test.js`, prefetch test, StockChart switch tests

## Tunables (defaults chosen, easily changed)

- `MEM_CACHE_MAX = 60` entries.
- Hover-prefetch debounce `120ms`, current-TF-only.
