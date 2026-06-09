# Viewport-First Payload — Design (Phase 2 of Chart Feel Initiative)

**Date:** 2026-06-08
**Status:** Approved (design); pending implementation plan
**Scope:** Frontend only. No backend/API changes. No HTTP/CDN caching changes (the `no-store` bars invariant is preserved).

## Context

`StockChart.jsx` fetches a fixed, large bar count on **every** chart load:

```js
const barCount = (resolvedTf === 'D' || resolvedTf === 'W') ? 8000 : 5000   // line ~1407
```

The chart then default-zooms to the most recent ~200 bars (8-bar right padding). So first paint downloads, parses, and IDB-writes 25–40× more data than the viewport shows. This is the dominant lever on real first-paint latency (Massive fetch time, transfer bytes, JSON parse, IndexedDB write).

The bars endpoint (`GET /api/bars/{ticker}?tf=&bars=&since=`) already accepts any `bars` value (default 200, max 10000) and supports a `since`-delta path. So reducing first-paint depth is a **client fetch-strategy** change — no backend work.

**Phase 2 deliberately does NOT add CDN/edge caching (the deferred "B5").** `api/routers/bars.py` sets `Cache-Control: no-store, must-revalidate` on purpose — HTTP-layer caching would let a corrupted OHLC bar survive at the edge after a reconciliation fix ships. That invariant stays untouched.

## Goal

Paint the visible window almost immediately, then load deep history lazily only when the user actually pans/zooms into it — with the on-screen view staying rock-steady when the deep history arrives. Net: ~8–13× smaller first paint and faster cold loads, plus cheaper prefetch.

Non-goals (later phases): WS reconnect reliability (Phase 3 / B6), W/M reconciliation-audit coverage (Phase 4 / C7), and the deferred edge cache (B5).

## Two-tier fetch depth

- **`FIRST_PAINT_BARS = 600`** — the initial cold fetch depth. Covers the 200-bar default zoom plus ~400 bars of left-side lookback, so any on-screen moving average up to ~380 periods (i.e. typical 50/100/200 MAs) is fully correct in the visible window. Tunable; must exceed `visible(200) + longest_in_view_indicator_lookback`.
- **`FULL_BARS`** — the current values: 8000 for D/W, 5000 otherwise. The lazy backfill target.

### Fetch matrix

| Situation | Depth requested | Why |
|---|---|---|
| Cold load, standalone chart (no IDB) | `FIRST_PAINT_BARS` | fast first paint |
| Warm load (IDB has bars) | `since`-delta (unchanged) | returns only the fresh tail; preserves whatever depth IDB already holds (600 or a previously-backfilled FULL) |
| User pans/zooms toward oldest loaded bar AND loaded depth < FULL | `FULL_BARS` (one-shot) | deep history, on demand |
| Comparison / index-overlay mode active | `FULL_BARS` (unchanged) | overlays must align across the whole range; secondary case — keep current behavior |

Depth is **sticky once earned**: once a (sym, tf) has been backfilled to FULL, IDB holds FULL, and the `since`-delta warm path keeps that depth on subsequent visits.

## Components

### 1. `barCount` → first-paint depth (StockChart)
The main bars SWR URL (line ~1490) requests `FIRST_PAINT_BARS` instead of `barCount` — **unconditionally** for the standalone chart, not branched on cold vs warm. The `bars=` cap doesn't truncate a warm revisit: when `since` is present the endpoint returns only the newer tail, and the chart's existing depth comes from IDB (which may already be FULL from a prior backfill). So a small `bars=` cap costs nothing on warm loads and bounds the payload on cold ones.

Comparison fetch (line ~2120) and index-pane fetch (line ~2156) keep `FULL_BARS`. When comparison/index overlay is active, the main series ALSO fetches `FULL_BARS` so the overlays align with it across the full range (the one carve-out from viewport-first).

### 2. Backfill-trigger decision — pure, testable helper
New `app/src/utils/barsBackfill.js`:

```
shouldBackfill({ fromIndex, loadedCount, fullTarget, edgeThreshold = 50, alreadyBackfilled }) -> boolean
```

Returns true when the visible logical range's left edge (`fromIndex`) is within `edgeThreshold` bars of index 0 (the oldest loaded bar), the loaded count is still below `fullTarget`, and we haven't already backfilled this (sym, tf). Pure function → unit tested in isolation.

### 3. Backfill effect (StockChart)
A `subscribeVisibleLogicalRangeChange` handler (the chart already has this subscription pattern, e.g. line ~4671) that:
1. Reads the current visible logical range + loaded bar count.
2. Calls `shouldBackfill(...)`. If false, returns (cheap, runs on scroll — debounced ~150ms).
3. If true: set a per-`(sym,tf)` `backfilledRef` guard immediately (prevents repeat/parallel fetches), fetch `/api/bars/{sym}?tf=&bars=FULL_BARS` (no `since` → full superset), then:
   - `setData` the superset onto the existing series,
   - **re-anchor** the visible range with the existing `reanchorLogicalRange(oldCount, oldRange, newCount)` so the view doesn't jump (the locked "bar-count change without ticker switch must re-anchor" invariant),
   - persist via `idbPut` + `memPut` (Phase 1 cache) so the depth is durable.
4. On fetch failure: clear the guard so a later pan can retry; keep the 600-bar view on screen (never blank).

### 4. Cheaper prefetch (prefetchBars.js)
`BAR_COUNTS` drop from 5000/8000 to `FIRST_PAINT_BARS` for all timeframes. Hover-warming and `prefetchAllTimeframes` now fetch ~8× less data — faster warming and lower Massive/egress cost. Deep history is only ever fetched when a user actually pans into it on a real chart. (Keep a single shared `FIRST_PAINT_BARS` constant — export it from one module so StockChart and prefetchBars agree.)

## Data flow

```
open chart (cold) → fetch bars=600 → paint last ~200 (≈8-13x faster)
   user pans left near oldest loaded bar
     → shouldBackfill() true → guard set → fetch bars=FULL
       → setData(superset) → reanchorLogicalRange (view holds steady)
       → idbPut + memPut (depth now durable)
warm revisit → since-delta tail only (depth preserved from IDB)
comparison/index mode → FULL fetch for main + overlays (unchanged)
```

## Error handling

- Backfill fetch failure: clear `backfilledRef` guard, log nothing user-facing, keep current view. Next pan retries.
- A 503 from `/api/bars` during backfill is treated like any transient (existing SWR/retry semantics elsewhere); the foreground chart is unaffected because backfill is background.
- Re-anchor uses the existing tested helper; if it returns null (no safe anchor), fall back to leaving the range as-is (the superset still renders; worst case the view shifts once — acceptable and rare).

## Testing

- **`shouldBackfill` unit tests** (`app/src/utils/barsBackfill.test.js`): near-left-edge true; mid-view false; already-backfilled false; loadedCount ≥ fullTarget false; threshold boundary.
- **`reanchorLogicalRange`**: already covered by `chartViewAnchor.test.js` (count-change re-anchor). No new test needed; the backfill reuses it.
- **StockChart wiring + backfill effect**: manual verification in the running app (StockChart is not jsdom-renderable — mounts Lightweight Charts/canvas). Verify: cold open is visibly faster; panning left loads deep history without the view jumping; comparison mode still loads full range; repeated pans don't refetch.

## Files

- New: `app/src/utils/barsBackfill.js` (+ `barsBackfill.test.js`) — `shouldBackfill` + the shared `FIRST_PAINT_BARS` / `fullBarsFor(tf)` constants.
- Modify: `app/src/components/StockChart.jsx` — first-paint depth on the cold fetch; backfill effect; comparison/index-mode carve-out.
- Modify: `app/src/utils/prefetchBars.js` — `BAR_COUNTS` → `FIRST_PAINT_BARS`.

## Tunables (defaults chosen)

- `FIRST_PAINT_BARS = 600` (raise if very long in-view MAs are common).
- Backfill edge threshold `= 50` bars from the oldest loaded bar.
- Backfill debounce `≈ 150ms`.
