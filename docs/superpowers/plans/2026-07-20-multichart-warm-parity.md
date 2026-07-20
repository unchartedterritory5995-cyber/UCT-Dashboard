# Multi-Chart Grid Chart-Parity Warming — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Multi-Chart grid cells feel instant on all timeframes (fast TF-switch + scroll-back) like the primary chart, without recreating the 2026-05-24 fetch-herd.

**Architecture:** Container-driven, herd-safe warming. `MultiChartGrid` warms all cell symbols across all 8 timeframes through the existing bounded, idle-deferred prefetch queue (`prefetchBars`), gated by a testable pure helper (`gridWarm.js`, modeled on `peerFill.js`). A new `deepWarm` StockChart prop gives only the focused/maximized cell the deep-history dwell-warm. Live streaming / stale-gap / sane-price already reach cells unchanged (verified) — verification only.

**Tech Stack:** React (Vite SPA), vitest + @testing-library (jsdom), SWR, IndexedDB (barsIDB), the shared `prefetchBars` queue.

Spec: `docs/superpowers/specs/2026-07-20-multichart-warm-parity-design.md`.

## Global Constraints

- **`GridChartCell` MUST keep `backgroundWarm={false}`** — flipping it re-enables StockChart's per-cell direct-`fetch()` all-TF chain = instant herd regression. Never change it.
- **Warming is READ-ONLY** — the warm path calls `prefetch*` only, never a state mutator (a state write trips `useMultiChartState`'s 500 ms persistence debounce).
- **All warm fetches ride the bounded queue** (`prefetchListAllTimeframes` → `_idbQueue`, `_IDB_MAX = 3`, idle-deferred) — never a direct `fetch()`.
- **Vitest:** run from `app/`. Grid/JS suites need `--pool=threads` (jsdom + echarts stability): `npm --prefix app run test -- --pool=threads <file>`.
- **Build check is mandatory** before any deploy — esbuild misses CSS-module keys, so also verify live (browser) not just tests (`lesson_worktree_cwd_relative_path_trap`).
- **Deploy freeze:** web master pushes only ≥4:20 PM ET or <9:15 AM ET (options tape). Ship `git push origin feat/multichart-warm-parity:master` — owner runs the master push.
- Worktree: `C:\Users\Patrick\uct-dashboard\.worktrees\multichart-warm-parity` (branch `feat/multichart-warm-parity`). Use ABSOLUTE paths.

---

### Task 1: `prefetchGridWarm` — warm all 8 timeframes for the grid

`prefetchListAllTimeframes` already accepts a `tfs` override but its default `SCAN_WARM_TFS` omits W/M/1. Add a grid-specific export covering all 8 so Weekly/Monthly/1-min switches are instant too.

**Files:**
- Modify: `app/src/utils/prefetchBars.js` (add export near `prefetchListAllTimeframes`, ~line 168-174)
- Test: `app/src/utils/prefetchBars.test.js` (new)

**Interfaces:**
- Produces: `export const GRID_WARM_TFS = ['D','5','60','30','15','W','M','1']`; `export function prefetchGridWarm(tickers: string[]): void`

- [ ] **Step 1: Write the failing test**

Create `app/src/utils/prefetchBars.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { GRID_WARM_TFS, prefetchGridWarm } from './prefetchBars'

describe('grid warm timeframe coverage', () => {
  it('GRID_WARM_TFS covers all 8 timeframes including W, M and 1', () => {
    expect(new Set(GRID_WARM_TFS)).toEqual(new Set(['D', '5', '15', '30', '60', 'W', 'M', '1']))
    expect(GRID_WARM_TFS.length).toBe(8)          // no dups
  })

  it('prefetchGridWarm is a no-op on empty/nullish input (never throws)', () => {
    expect(() => prefetchGridWarm([])).not.toThrow()
    expect(() => prefetchGridWarm(undefined)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix app run test -- --pool=threads src/utils/prefetchBars.test.js`
Expected: FAIL — `GRID_WARM_TFS`/`prefetchGridWarm` are not exported (import is undefined).

- [ ] **Step 3: Write minimal implementation**

In `app/src/utils/prefetchBars.js`, immediately after the `prefetchListAllTimeframes` function (after line ~174), add:

```js
// Multi-Chart grid warm: like prefetchListAllTimeframes but covers ALL 8 TFs
// (SCAN_WARM_TFS omits W/M/1). Rides the SAME bounded (3-concurrent) idle-deferred
// IDB queue, so 16 cells × 8 TFs = 128 jobs drain ≤3 at a time — a strict subset
// of the watchlist warm's envelope. Already-warm (sym,tf) pairs skip their fetch.
export const GRID_WARM_TFS = ['D', '5', '60', '30', '15', 'W', 'M', '1']
export function prefetchGridWarm(tickers) {
  prefetchListAllTimeframes(tickers, { tfs: GRID_WARM_TFS })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix app run test -- --pool=threads src/utils/prefetchBars.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Patrick/uct-dashboard/.worktrees/multichart-warm-parity
git add app/src/utils/prefetchBars.js app/src/utils/prefetchBars.test.js
git commit -m "feat(charts): prefetchGridWarm — warm all 8 TFs via the bounded queue"
```

---

### Task 2: `gridWarm.js` — content-keyed, ready-gated warm decision (pure helper)

The 4 mandatory guards live here where they're unit-testable (mirrors `peerFill.js`). The container passes the current syms + a `ready` flag; the helper dedupes by sym-set content so TF/Style/undo churn never re-warms.

**Files:**
- Create: `app/src/pages/charts/grid/gridWarm.js`
- Test: `app/src/pages/charts/grid/gridWarm.test.js`

**Interfaces:**
- Consumes: `warm: (syms: string[]) => void` (inject `prefetchGridWarm` from Task 1)
- Produces: `makeGridWarmer({ warm }) => { maybeWarm(syms: string[], ready: boolean): boolean, reset(): void }`

- [ ] **Step 1: Write the failing test**

Create `app/src/pages/charts/grid/gridWarm.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import { makeGridWarmer } from './gridWarm'

describe('makeGridWarmer', () => {
  it('warms once for a new sym set when ready', () => {
    const warm = vi.fn()
    const w = makeGridWarmer({ warm })
    expect(w.maybeWarm(['AAPL', 'MSFT'], true)).toBe(true)
    expect(warm).toHaveBeenCalledTimes(1)
    expect(warm).toHaveBeenCalledWith(['AAPL', 'MSFT'])
  })

  it('does NOT warm while not ready (pre-hydration / first paint pending)', () => {
    const warm = vi.fn()
    const w = makeGridWarmer({ warm })
    expect(w.maybeWarm(['AAPL'], false)).toBe(false)
    expect(warm).not.toHaveBeenCalled()
  })

  it('is a no-op on the SAME sym set regardless of order (content-keyed dedupe)', () => {
    const warm = vi.fn()
    const w = makeGridWarmer({ warm })
    w.maybeWarm(['AAPL', 'MSFT'], true)
    expect(w.maybeWarm(['MSFT', 'AAPL'], true)).toBe(false)   // reordered, same set
    expect(w.maybeWarm(['aapl', 'msft'], true)).toBe(false)   // case-insensitive
    expect(warm).toHaveBeenCalledTimes(1)
  })

  it('re-warms when the sym set changes (add/remove a ticker)', () => {
    const warm = vi.fn()
    const w = makeGridWarmer({ warm })
    w.maybeWarm(['AAPL'], true)
    expect(w.maybeWarm(['AAPL', 'NVDA'], true)).toBe(true)
    expect(warm).toHaveBeenCalledTimes(2)
    expect(warm).toHaveBeenLastCalledWith(['AAPL', 'NVDA'])
  })

  it('is a no-op on an empty/blank sym set', () => {
    const warm = vi.fn()
    const w = makeGridWarmer({ warm })
    expect(w.maybeWarm([], true)).toBe(false)
    expect(w.maybeWarm([null, '', undefined], true)).toBe(false)
    expect(warm).not.toHaveBeenCalled()
  })

  it('reset() clears the dedupe key so the next same-set call warms again', () => {
    const warm = vi.fn()
    const w = makeGridWarmer({ warm })
    w.maybeWarm(['AAPL'], true)
    w.reset()
    expect(w.maybeWarm(['AAPL'], true)).toBe(true)
    expect(warm).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix app run test -- --pool=threads src/pages/charts/grid/gridWarm.test.js`
Expected: FAIL — `./gridWarm` cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

Create `app/src/pages/charts/grid/gridWarm.js`:

```js
// app/src/pages/charts/grid/gridWarm.js
//
// Container-driven warm decision for the Multi-Chart grid. Owns the FOUR guards
// that keep grid warming from regressing the fetch-herd protections:
//   1. content-keyed dedupe — a TF/Style/undo/layout change that leaves the sym
//      SET unchanged never re-warms (cells.map() returns a fresh array each time).
//   2. ready-gate — the caller only passes ready=true once hydrated AND the
//      initial mount-queue paint has settled (so warming can't steal server-pool
//      slots from the visible cold paint).
//   3/4 (read-only + bounded) live at the call site: `warm` is prefetchGridWarm,
//      which is read-only and rides the bounded idle-deferred IDB queue.
//
// Modeled on peerFill.js: a pure factory, injected `warm`, fully unit-testable.

export function makeGridWarmer({ warm }) {
  let lastKey = null
  return {
    // syms: the grid's current cell symbols. ready: hydrated && first-paint settled.
    // Returns true iff it warmed this call.
    maybeWarm(syms, ready) {
      if (!ready) return false
      const clean = [...new Set(
        (Array.isArray(syms) ? syms : [])
          .map(s => (typeof s === 'string' ? s.trim().toUpperCase() : ''))
          .filter(Boolean),
      )]
      if (!clean.length) return false
      const key = clean.slice().sort().join(',')   // set-content key (order-invariant)
      if (key === lastKey) return false
      lastKey = key
      warm(clean)                                   // read-only prefetch of the current set
      return true
    },
    reset() { lastKey = null },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix app run test -- --pool=threads src/pages/charts/grid/gridWarm.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/charts/grid/gridWarm.js app/src/pages/charts/grid/gridWarm.test.js
git commit -m "feat(charts/grid): gridWarm helper — content-keyed, ready-gated warm decision"
```

---

### Task 3: Wire container warm into `MultiChartGrid` (instant TF-switch)

Drive `gridWarm` from the grid: warm the current syms once the grid is hydrated AND its initial mount-queue paint has settled. Flag-guarded for instant revert.

**Files:**
- Modify: `app/src/pages/charts/grid/MultiChartGrid.jsx` (imports ~24-34; new effect after the `gridSyms` block ~263)

**Interfaces:**
- Consumes: `makeGridWarmer` (Task 2), `prefetchGridWarm` (Task 1), existing `gridSyms` (line 263), `hydrated` (line 65), `mountedIds` (line 205), `cells`.

- [ ] **Step 1: Add imports**

In `app/src/pages/charts/grid/MultiChartGrid.jsx`, after line 28 (`import { makePeerFiller } from './peerFill'`) add:

```js
import { makeGridWarmer } from './gridWarm'
import { prefetchGridWarm } from '../../../utils/prefetchBars'
```

- [ ] **Step 2: Add the warmer ref + first-paint signal + warm effect**

In `MultiChartGrid.jsx`, immediately AFTER the `heatHoldings` useMemo (ends line ~267, right after the `gridSyms`/`livePrices` block), insert:

```js
  // ── Chart-parity warming (herd-safe): once the grid is hydrated AND its
  // initial mount-queue paint has settled, warm every cell's every timeframe
  // into IDB through the bounded prefetch queue, so any cell's TF-switch paints
  // instantly. gridWarm dedupes by sym-set content, so a TF/Style/undo/layout
  // change that leaves the sym set unchanged never re-warms. Flag: default ON,
  // set VITE_GRID_WARM_ENABLED='0' to disable. ──
  const gridWarmEnabled = import.meta.env.VITE_GRID_WARM_ENABLED !== '0'
  const gridWarmerRef = useRef(null)
  if (!gridWarmerRef.current) gridWarmerRef.current = makeGridWarmer({ warm: prefetchGridWarm })
  // First-paint settled = every non-empty cell's composite key has been admitted
  // by the mount queue (its cold paint is done / in its last ≤3 wave). Recomputes
  // as slots free (mountedIds is state), so this flips true when the grid drains.
  const firstPaintSettled = cells.every(c => !c.sym || mountedIds.has(`${c.id}::${c.sym}`))
  useEffect(() => {
    if (!gridWarmEnabled) return
    gridWarmerRef.current.maybeWarm(gridSyms, hydrated && firstPaintSettled)
  }, [gridWarmEnabled, gridSyms, hydrated, firstPaintSettled])
```

- [ ] **Step 3: Verify it compiles (build)**

Run: `npm --prefix app run build`
Expected: build succeeds (no unresolved import / syntax error). Look for `dist/` output with no errors.

- [ ] **Step 4: Run the grid suite (no regressions)**

Run: `npm --prefix app run test -- --pool=threads src/pages/charts/grid/`
Expected: PASS — all existing grid tests + gridWarm still green.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/charts/grid/MultiChartGrid.jsx
git commit -m "feat(charts/grid): drive herd-safe container warm (instant TF-switch)"
```

---

### Task 4: `deepWarm` prop on StockChart (split dwell-warm from the all-TF chain)

Add a prop that gates ONLY the deep-history dwell-warm, independent of `backgroundWarm`. Inert until a caller passes it.

**Files:**
- Modify: `app/src/components/StockChart.jsx` (prop default after line 849; dwell-warm effect ~7670-7676)

**Interfaces:**
- Produces: StockChart prop `deepWarm` (bool, default false) that pre-loads full history after a 900 ms dwell even when `backgroundWarm={false}`.

- [ ] **Step 1: Add the prop default**

In `app/src/components/StockChart.jsx`, immediately after line 849 (`backgroundWarm = true, ...`) add:

```js
  deepWarm = false,         // true = run ONLY the deep-history dwell-warm (not the all-TF chain) even when backgroundWarm=false. Multi-chart grid passes true for the focused/maximized cell so its scroll-back is instant; the all-TF chain stays off (herd guard).
```

- [ ] **Step 2: Gate the dwell-warm on `backgroundWarm || deepWarm`**

In the dwell-warm effect (currently line ~7672), change:

```js
    if (!backgroundWarm) return undefined
```

to:

```js
    if (!backgroundWarm && !deepWarm) return undefined
```

and add `deepWarm` to that effect's dependency array (the `useEffect` at ~line 7676) — append `, deepWarm` before the closing `]`:

```js
  }, [sym, resolvedTf, fetchDepth, _overlayActive, entryDate, exactDateRange, _hasOverride, _fullTarget, backgroundWarm, deepWarm])
```

Do NOT touch the all-TF warm chain effect (~line 2415) — it stays gated on `backgroundWarm` alone.

- [ ] **Step 3: Verify it compiles**

Run: `npm --prefix app run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/StockChart.jsx
git commit -m "feat(charts): deepWarm prop — dwell-warm deep history independent of backgroundWarm"
```

---

### Task 5: Forward `deepWarm` through `GridChartCell`

**Files:**
- Modify: `app/src/pages/charts/grid/GridChartCell.jsx` (prop list ~43-59; StockChart props ~389)

**Interfaces:**
- Consumes: StockChart `deepWarm` (Task 4).
- Produces: `GridChartCell` prop `deepWarm` (bool) forwarded to StockChart.

- [ ] **Step 1: Add `deepWarm` to the prop list**

In `app/src/pages/charts/grid/GridChartCell.jsx`, in the destructured props (after `isMaximized,` / `onToggleMaximize,` block, ~line 58), add:

```js
  deepWarm,           // bool — this cell is the active/maximized one; pre-load full history for instant scroll-back (StockChart deepWarm)
```

- [ ] **Step 2: Forward it to StockChart, keeping `backgroundWarm={false}`**

In the StockChart element, the `backgroundWarm={false}` line (~389) becomes two lines:

```js
            backgroundWarm={false}
            deepWarm={deepWarm}
```

(`backgroundWarm={false}` MUST remain — global constraint.)

- [ ] **Step 3: Verify it compiles**

Run: `npm --prefix app run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/charts/grid/GridChartCell.jsx
git commit -m "feat(charts/grid): forward deepWarm to the cell's StockChart"
```

---

### Task 6: Pass `deepWarm` per cell in `MultiChartGrid` (instant scroll-back on the focused cell)

**Files:**
- Modify: `app/src/pages/charts/grid/MultiChartGrid.jsx` (GridChartCell render, ~line 405-421)

**Interfaces:**
- Consumes: `GridChartCell` `deepWarm` (Task 5), existing `activeIdx`, `maxId`, `cell.id`, loop index `i`.

- [ ] **Step 1: Add the `deepWarm` prop to the GridChartCell render**

In the `<GridChartCell ... />` block (~line 405), add a line (next to `isMaximized={maxId === cell.id}` ~line 419):

```js
                deepWarm={gridWarmEnabled && (activeIdx === i || maxId === cell.id)}
```

(Only the hovered/focused cell OR the maximized cell deep-warms → ≤1 deep fetch in flight. Gated by the same flag so revert disables both warms.)

- [ ] **Step 2: Verify it compiles**

Run: `npm --prefix app run build`
Expected: build succeeds.

- [ ] **Step 3: Run the grid suite**

Run: `npm --prefix app run test -- --pool=threads src/pages/charts/grid/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/charts/grid/MultiChartGrid.jsx
git commit -m "feat(charts/grid): deep-warm the focused/maximized cell (instant scroll-back)"
```

---

### Task 7: Full build + suite + lint gate

**Files:** none (verification).

- [ ] **Step 1: Full frontend build**

Run: `npm --prefix app run build`
Expected: succeeds, no errors/warnings about unresolved modules.

- [ ] **Step 2: Run the full charts test area**

Run: `npm --prefix app run test -- --pool=threads src/pages/charts/ src/utils/prefetchBars.test.js`
Expected: PASS.

- [ ] **Step 3: Lint the touched files**

Run: `npm --prefix app run lint -- src/pages/charts/grid/MultiChartGrid.jsx src/pages/charts/grid/GridChartCell.jsx src/pages/charts/grid/gridWarm.js src/components/StockChart.jsx src/utils/prefetchBars.js`
Expected: no new errors. (If `lint` script doesn't accept file args, run `npm --prefix app run lint` and confirm no NEW errors in these files.)

- [ ] **Step 4: Commit any lint fixes**

```bash
git add -A && git commit -m "chore(charts/grid): lint pass for warm-parity" || echo "nothing to commit"
```

---

### Task 8: Live verification (gridspike harness + browser) — herd-safety + parity

**Files:** none (manual/live; StockChart + wiring have no unit tests per repo convention — this is their gate).

- [ ] **Step 1: Herd-safety via the perf harness**

After deploy (or against a local `npm --prefix app run dev` build), as admin open `/charts?gridspike=16&tf=D` in a VISIBLE tab. In DevTools use the network panel (or `read_network_requests`) to confirm: peak concurrent `/api/bars` in flight ≤ ~6 (≤3 mount + ≤3 warm); all warm fetches are `bars=600` (shallow), none `bars=5000`; warming starts only AFTER the initial cells paint. Read `localStorage['uct.gridspike.last']` for the heap/timing budget (must stay in the documented envelope: 16 cells ~900 ms / +63 MB).

- [ ] **Step 2: TF-switch parity**

Fill a Groups-mode group (type a seed), let it settle ~3-5 s, then click 5m / 1h / W / M / 1 on several cells. Confirm each switch paints instantly (no loading overlay) — the warm populated mem/IDB.

- [ ] **Step 3: Scroll-back parity**

Hover/focus one cell, wait ~1 s (dwell), scroll back into older bars — confirm it's instant (deep-warmed). Confirm a NON-focused cell's first scroll-back is the expected on-demand backfill (documented concession), not a regression.

- [ ] **Step 4: Live ticking (RTH)**

During market hours confirm developing candles tick on intraday cells and daily cells; confirm ONE `/api/stream/bars` + ONE `/api/stream/prices` EventSource (not 16 each). (If a global Heikin-Ashi pref is on, cells fall back to 30 s SWR — expected.)

- [ ] **Step 5: Record outcome**

Note the gridspike concurrency/heap numbers + parity results in the PR/commit description. If any concurrency exceeds ~6 or the peers-fill latency regressed, STOP and re-open the design (do not ship).

---

## Self-Review

**Spec coverage:**
- Container warm all 8 TFs → Task 1 (`prefetchGridWarm`/`GRID_WARM_TFS`) + Task 3 (wire).
- 4 guards (content-key, first-paint defer, read-only, dwell-gate) → gridWarm helper (Task 2) + Task 3 effect (`hydrated && firstPaintSettled`, read-only) + Task 6 (deepWarm dwell is inherently timer-gated).
- deepWarm split → Tasks 4-6.
- backgroundWarm=false locked → global constraint + Task 5 keeps it.
- Live/stale-gap/sane-price already-work → Task 8 verification (no code), matches spec §1.
- Herd-safety proof → Task 8 gridspike.
- Flag-guard revert → Task 3 (`VITE_GRID_WARM_ENABLED`) + Task 6 (same flag gates deepWarm).

**Placeholder scan:** none — every code step shows complete code.

**Type consistency:** `makeGridWarmer({ warm })` → `maybeWarm(syms, ready)`/`reset()` consistent across Task 2 def and Task 3 use. `prefetchGridWarm(tickers)` consistent Task 1 def / Task 3 import. `deepWarm` bool consistent StockChart (Task 4) ← GridChartCell (Task 5) ← MultiChartGrid (Task 6).

**Deliberate non-unit-tested surface:** StockChart `deepWarm` gate + the GridChartCell/MultiChartGrid prop plumbing have no vitest (the repo render-tests none of these components; helper logic is extracted to `gridWarm.js` which IS tested). Their gate is Task 8's live/gridspike verification — called out honestly, not a hidden gap.
