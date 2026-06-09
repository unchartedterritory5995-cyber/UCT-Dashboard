# Viewport-First Payload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `StockChart` paint a shallow first window (~600 bars) instead of 5000–8000, then lazily backfill deep history only when the user pans toward the oldest loaded bar — for ~8–13× faster first paint and cheaper prefetch.

**Architecture:** A two-tier fetch depth. A new pure `barsBackfill` module exposes `FIRST_PAINT_BARS`, `fullBarsFor(tf)`, and a pure `shouldBackfill(...)` decision. StockChart makes its bars fetch depth **stateful** (first-paint by default, reset on sym/tf change), drops `since` once bumped to full (so the server returns the older range, not just the newer tail), and bumps to full via a visible-range subscription when the user pans to the left edge. The existing same-ticker re-anchor (commit `911dfe91`, whose comment already names "older-history backfill") holds the view steady when the larger superset lands. Overlay/pinned charts keep the full fetch. No backend or caching changes.

**Tech Stack:** React + Vite, SWR, TradingView Lightweight Charts v5. Tests: vitest 4 (run from `app/`).

---

## File Structure

- **Create** `app/src/utils/barsBackfill.js` — single responsibility: the viewport-first constants + the pure backfill decision. `FIRST_PAINT_BARS`, `fullBarsFor(tf)`, `shouldBackfill(...)`.
- **Create** `app/src/utils/barsBackfill.test.js` — unit tests for `shouldBackfill` + `fullBarsFor`.
- **Modify** `app/src/utils/prefetchBars.js` — `BAR_COUNTS` use `FIRST_PAINT_BARS` so prefetch warms the shallow window (cheaper) and matches the chart's cold-fetch SWR key.
- **Modify** `app/src/components/StockChart.jsx` — stateful fetch depth + overlay carve-out (replaces the `barCount` constant), drop `since` when backfilling, and the backfill subscription effect.

**Build order:** Task 1 (lib) → Task 2 (prefetch) → Task 3 (StockChart). Task 1 is pure/TDD. Task 2 is a tiny constant swap. Task 3 bundles all StockChart edits into ONE atomic commit so the repo is never in a "can't load history" state. Task 3 is verified by build + manual in-app check (StockChart mounts a canvas charting lib; not jsdom-renderable).

---

## Task 1: barsBackfill module (pure + TDD)

**Files:**
- Create: `app/src/utils/barsBackfill.js`
- Test: `app/src/utils/barsBackfill.test.js`

- [ ] **Step 1: Write the failing test**

```js
// app/src/utils/barsBackfill.test.js
import { describe, it, expect } from 'vitest'
import { FIRST_PAINT_BARS, fullBarsFor, shouldBackfill } from './barsBackfill'

describe('barsBackfill', () => {
  it('FIRST_PAINT_BARS is a small shallow window', () => {
    expect(FIRST_PAINT_BARS).toBe(600)
  })

  it('fullBarsFor: 8000 for D/W, 5000 otherwise', () => {
    expect(fullBarsFor('D')).toBe(8000)
    expect(fullBarsFor('W')).toBe(8000)
    expect(fullBarsFor('M')).toBe(5000)
    expect(fullBarsFor('60')).toBe(5000)
    expect(fullBarsFor('5')).toBe(5000)
  })

  // shouldBackfill: true only when zoomed-in AND panned to the left edge AND
  // there is still deeper history to fetch.
  const base = { fromIndex: 10, toIndex: 210, loadedCount: 600, fullTarget: 5000 }

  it('triggers when panned to the left edge while zoomed in', () => {
    expect(shouldBackfill(base)).toBe(true)
  })

  it('does NOT trigger on the initial full-series view (width ≈ loadedCount)', () => {
    // Transient on first load / zoomed all the way out: showing the whole series.
    expect(shouldBackfill({ ...base, fromIndex: 0, toIndex: 600 })).toBe(false)
  })

  it('does NOT trigger at the default right-edge view (left edge not in view)', () => {
    expect(shouldBackfill({ ...base, fromIndex: 400, toIndex: 600 })).toBe(false)
  })

  it('does NOT trigger once loaded depth has reached the full target', () => {
    expect(shouldBackfill({ ...base, loadedCount: 5000 })).toBe(false)
  })

  it('respects the edge threshold boundary', () => {
    expect(shouldBackfill({ ...base, fromIndex: 50, toIndex: 250 })).toBe(true)   // 50 <= 50
    expect(shouldBackfill({ ...base, fromIndex: 51, toIndex: 251 })).toBe(false)  // 51 > 50
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run src/utils/barsBackfill.test.js`
Expected: FAIL — cannot resolve `./barsBackfill`.

- [ ] **Step 3: Write the implementation**

```js
// app/src/utils/barsBackfill.js
// Viewport-first payload (Phase 2): fetch a shallow window first, backfill deep
// history only when the user pans into it. Shared by StockChart (fetch depth +
// backfill trigger) and prefetchBars (warm the same shallow window).

// Shallow first-paint depth. Must exceed the 200-bar default zoom PLUS enough
// left-side lookback that on-screen moving averages (<=~380 periods, i.e.
// typical 50/100/200 MAs) are fully correct in view. Raise if very long
// in-view MAs become common.
export const FIRST_PAINT_BARS = 600

// The deep-history target — the values StockChart used before viewport-first.
export function fullBarsFor(tf) {
  return (tf === 'D' || tf === 'W') ? 8000 : 5000
}

// Pure decision: should we bump from the shallow window to the full depth?
// True only when (a) there is still deeper history to load, (b) the visible
// left edge is within `edgeThreshold` bars of the oldest loaded bar (the user
// panned left), and (c) the view is zoomed IN — not showing essentially the
// whole loaded series. (c) rejects the transient full-range view on first load
// / zoom-settle, so a cold chart doesn't immediately re-fetch the full set.
export function shouldBackfill({
  fromIndex,
  toIndex,
  loadedCount,
  fullTarget,
  edgeThreshold = 50,
  maxViewFrac = 0.7,
}) {
  if (!(loadedCount > 0) || !(fullTarget > 0) || loadedCount >= fullTarget) return false
  if (!(fromIndex <= edgeThreshold)) return false
  const width = toIndex - fromIndex
  if (!(width > 0)) return false
  return width < loadedCount * maxViewFrac
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run src/utils/barsBackfill.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/utils/barsBackfill.js app/src/utils/barsBackfill.test.js
git commit -m "feat(charts): barsBackfill — viewport-first constants + shouldBackfill (B4)"
```

---

## Task 2: Prefetch the shallow window

**Files:**
- Modify: `app/src/utils/prefetchBars.js` (the `BAR_COUNTS` map, line ~19)

> No new test. Verified by the existing util suite still passing + the constant change is mechanical. Warming the same shallow depth the chart cold-fetches keeps the SWR cache keys aligned and cuts prefetch bandwidth ~8×.

- [ ] **Step 1: Add the import**

In `app/src/utils/prefetchBars.js`, below the existing `barsMemCache` import (added in Phase 1, near line 15), add:

```js
import { FIRST_PAINT_BARS } from './barsBackfill'
```

- [ ] **Step 2: Point BAR_COUNTS at the shallow window**

Find (line ~19):

```js
const BAR_COUNTS = { 1: 5000, 5: 5000, 15: 5000, 30: 5000, 60: 5000, D: 8000, W: 8000, M: 5000 }
```

Replace with:

```js
// Viewport-first: prefetch only the shallow first-paint window. Deep history is
// fetched lazily by StockChart's backfill when the user actually pans into it,
// so warming need not pull 5000-8000 bars per ticker/TF. Keeps the SWR cache key
// (bars=FIRST_PAINT_BARS) aligned with the chart's cold fetch.
const BAR_COUNTS = {
  1: FIRST_PAINT_BARS, 5: FIRST_PAINT_BARS, 15: FIRST_PAINT_BARS,
  30: FIRST_PAINT_BARS, 60: FIRST_PAINT_BARS,
  D: FIRST_PAINT_BARS, W: FIRST_PAINT_BARS, M: FIRST_PAINT_BARS,
}
```

- [ ] **Step 3: Run the util suite to confirm no regression**

Run: `cd app && npx vitest run src/utils/`
Expected: PASS (includes barsBackfill, barsMemCache, prefetchBarOnIntent, etc.).

- [ ] **Step 4: Commit**

```bash
git add app/src/utils/prefetchBars.js
git commit -m "feat(charts): prefetch the shallow first-paint window (B4)"
```

---

## Task 3: StockChart viewport-first fetch + backfill (atomic)

**Files:**
- Modify: `app/src/components/StockChart.jsx` (import ~line 33; `barCount` ~line 1407; `_sinceParam` block ~line 1480-1483; new effect before the "Cleanup: destroy chart only on unmount" comment ~line 4678)

> **No unit test** (StockChart mounts Lightweight Charts/canvas; not jsdom-renderable — there is no `StockChart.test.jsx`). Task 1's `shouldBackfill` is unit-tested; this task is the wiring, verified by a production build + manual in-app check (Step 6). All edits are find/replace on the exact strings below — read each region first to confirm the match (the file may have drifted a few lines).

- [ ] **Step 1: Add imports**

Find (line ~34, added in Phase 1):

```js
import { reanchorLogicalRange } from '../utils/chartViewAnchor'
```

Add directly below it:

```js
import { FIRST_PAINT_BARS, fullBarsFor, shouldBackfill } from '../utils/barsBackfill'
```

(If the `reanchorLogicalRange` import line differs, just add the new import on its own line among the other `../utils/...` imports near the top.)

- [ ] **Step 2: Replace the fixed `barCount` with a stateful, overlay-aware depth**

Find (line ~1407):

```js
  const barCount = (resolvedTf === 'D' || resolvedTf === 'W') ? 8000 : 5000
```

Replace with:

```js
  // Viewport-first payload (Phase 2): fetch a shallow window first (fetchDepth =
  // FIRST_PAINT_BARS), bump to the full target only when the user pans into deep
  // history (see the backfill effect below). Reset to shallow on sym/tf change
  // via a render-time key guard (React "adjust state on prop change" pattern).
  // Overlay modes (compare / index pane / multi-symbol comparisons) keep the
  // full fetch so their overlays align across the whole range.
  const [fetchDepth, setFetchDepth] = useState(FIRST_PAINT_BARS)
  const _depthKeyRef = useRef(null)
  const _fullTarget = fullBarsFor(resolvedTf)
  const _overlayActive = !!(
    compareSymbol || indexPaneSymbol ||
    (cs.comparisonSymbols || []).some(c => c && c.enabled && c.sym)
  )
  const _depthKey = `${sym}_${resolvedTf}`
  if (_depthKeyRef.current !== _depthKey) {
    _depthKeyRef.current = _depthKey
    if (fetchDepth !== FIRST_PAINT_BARS) setFetchDepth(FIRST_PAINT_BARS)
  }
  const barCount = _overlayActive ? _fullTarget : fetchDepth
```

(`useState`/`useRef` are already imported and used in this region — e.g. the `idbBars` `useState` a few lines below — so adding these hooks here is safe; there is no early return before this point.)

- [ ] **Step 3: Drop `since` when backfilling**

Find the end of the `_sinceParam` block (line ~1480-1483):

```js
  let _sinceParam = null
  if (isIntraday && typeof idbSinceRef.current === 'number' && !idbStaleIntraday) {
    _sinceParam = Math.max(0, idbSinceRef.current - 1)
  }
```

Replace with (adds the backfill carve-out — `_fullTarget` is defined in Step 2, above this line):

```js
  let _sinceParam = null
  if (isIntraday && typeof idbSinceRef.current === 'number' && !idbStaleIntraday) {
    _sinceParam = Math.max(0, idbSinceRef.current - 1)
  }
  // Viewport-first backfill: once we've bumped to the full depth, drop `since`
  // so the server returns the full (older) range. `since` only returns the
  // newer tail, which would never load the deep history the user panned to see.
  // The bar count grows FIRST_PAINT_BARS→full and the existing same-ticker
  // re-anchor (the `else if … lastBarCountRef.current !== filteredBars.length`
  // branch in the zoom effect) holds the view steady across the swap.
  if (fetchDepth >= _fullTarget) _sinceParam = null
```

- [ ] **Step 4: Add the backfill subscription effect**

Find (line ~4678):

```js
  // Cleanup: destroy chart only on unmount
```

Insert ABOVE that comment:

```js
  // Viewport-first backfill (Phase 2): while at the shallow first-paint depth,
  // bump to the full target when the user pans toward the oldest loaded bar.
  // setFetchDepth changes the SWR key → a no-`since` full fetch lands the deeper
  // superset, and the same-ticker re-anchor holds the view. Disabled for overlay
  // modes (they already fetch full) and pinned charts (entryDate / exactDateRange
  // / barsOverride). Mirrors the existing visible-range subscription pattern.
  useEffect(() => {
    if (_overlayActive || entryDate || exactDateRange || _hasOverride) return undefined
    if (fetchDepth >= _fullTarget) return undefined
    const chart = chartRef.current
    if (!chart) return undefined
    let raf = null
    const onRange = () => {
      if (raf != null) return
      raf = requestAnimationFrame(() => {
        raf = null
        let range = null
        try { range = chart.timeScale().getVisibleLogicalRange() } catch { /* mid-load */ }
        if (!range) return
        if (shouldBackfill({
          fromIndex: range.from,
          toIndex: range.to,
          loadedCount: lastBarCountRef.current,
          fullTarget: _fullTarget,
        })) {
          setFetchDepth(_fullTarget)
        }
      })
    }
    let unsub = null
    try { unsub = chart.timeScale().subscribeVisibleLogicalRangeChange(onRange) } catch { /* ignore */ }
    return () => {
      if (unsub) { try { unsub() } catch { /* ignore */ } }
      if (raf != null) cancelAnimationFrame(raf)
    }
  }, [sym, resolvedTf, fetchDepth, _overlayActive, entryDate, exactDateRange, _hasOverride, _fullTarget])
```

(`chartRef`, `lastBarCountRef`, `entryDate`, `exactDateRange`, and `_hasOverride` are all already defined in the component. `_hasOverride` is defined near line 1486.)

- [ ] **Step 5: Build to confirm it compiles**

Run: `cd app && npm run build`
Expected: build succeeds. If it fails on a parallel-session file (e.g. `LiveFlow.jsx` duplicate-key warning, or files under `voice/`, `journal-2-0/`, `App.jsx`, `NavBar.jsx`), that's pre-existing — only fix errors that reference `StockChart.jsx`.

- [ ] **Step 6: Manual verification in the running app**

```bash
cd app && npm run build
cd .. && python -m uvicorn api.main:app --port 8077
```

Open `http://localhost:8077` → `/charts`, then verify:
1. **Cold open** of a fresh ticker paints quickly; in the Network tab the first `/api/bars/...` request is `bars=600` (not 5000/8000).
2. **Pan left** toward the oldest bar → a single `bars=5000` (or `8000` for D/W) request fires, deep history appears, and **the view does not jump** (stays on the same dates).
3. **No premature backfill**: simply opening a chart and NOT panning does not fire the `bars=5000` request (the shallow window stays until you pan).
4. **Comparison mode** (add a comparison symbol) still loads the full range for both series.
5. **Repeated left pans** after backfill do not refetch (depth is now full; effect unsubscribed).

- [ ] **Step 7: Commit**

```bash
git add app/src/components/StockChart.jsx
git commit -m "feat(charts): viewport-first fetch + pan-to-backfill in StockChart (B4)"
```

---

## Final verification

- [ ] **Run the full frontend suite** (memory fix from earlier lets this complete):

Run: `cd app && npx vitest run`
Expected: PASS — all files green, including the new `barsBackfill.test.js`.

- [ ] **Push**

```bash
git pull --rebase --autostash origin master
git push origin master
```

---

## Spec coverage check

- **Two-tier depth (FIRST_PAINT / FULL)** → Task 1 (`FIRST_PAINT_BARS`, `fullBarsFor`) + Task 3 Step 2 (stateful `barCount`).
- **Cold fetch shallow; warm fetch preserves IDB depth via `since`** → Task 3 Step 2 (depth) + Step 3 (`since` only dropped when backfilling, otherwise unchanged).
- **Backfill on pan; superset replace; re-anchor holds view** → Task 3 Step 4 (effect) + the existing `911dfe91` same-ticker re-anchor (Step 3 comment references it; no change needed).
- **Backfill drops `since` to fetch deep/older range** → Task 3 Step 3.
- **Comparison/index carve-out keeps full fetch** → Task 3 Step 2 (`_overlayActive ? _fullTarget : fetchDepth`) + Step 4 (effect disabled when `_overlayActive`).
- **Pinned charts (entryDate/exactDateRange/override) unaffected** → Task 3 Step 4 guard.
- **Cheaper prefetch** → Task 2.
- **No premature backfill on first load** → Task 1 `shouldBackfill` `maxViewFrac` guard + tests.
- **Testing: `shouldBackfill` unit-tested; wiring manual** → Task 1 tests; Task 3 Step 6 manual.

## Tunables (defaults chosen)
- `FIRST_PAINT_BARS = 600` (barsBackfill.js).
- `edgeThreshold = 50`, `maxViewFrac = 0.7` (shouldBackfill args).
