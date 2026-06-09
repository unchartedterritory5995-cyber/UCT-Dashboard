# Instant Chart Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ticker/timeframe switches in `StockChart` feel instantaneous — a chart you've seen or hovered paints in the same frame with no spinner, and a cold switch shows a skeleton (never another ticker's candles).

**Architecture:** Add a synchronous in-memory LRU bar cache (`barsMemCache`) in front of the existing async IndexedDB layer. On switch, a memcache hit seeds the chart's state synchronously so `loading` never flips true (no flash); a miss falls back to the existing cold path which already renders a loading overlay (upgraded here to a shimmer skeleton). A new `prefetchBarOnIntent` warms the memcache on hover/focus so the eventual click is already warm. No backend changes.

**Tech Stack:** React + Vite, SWR, IndexedDB (`barsIDB`), TradingView Lightweight Charts v5. Tests: vitest 4 + @testing-library/react 16 (jsdom env, `app/src/test-setup.js`). Run tests from `app/`.

---

## File Structure

- **Create** `app/src/utils/barsMemCache.js` — synchronous LRU bar cache (`memGet`/`memHas`/`memPut`/`memClear`). One responsibility: hold recently-seen bars in memory, keyed by `${SYM}_${TF}`.
- **Create** `app/src/utils/barsMemCache.test.js` — unit tests for the cache.
- **Create** `app/src/components/chart/ChartSkeleton.jsx` + `ChartSkeleton.module.css` — presentational shimmer placeholder for the cold-load overlay.
- **Create** `app/src/components/chart/ChartSkeleton.test.jsx` — render test.
- **Modify** `app/src/utils/prefetchBars.js` — add `prefetchBarOnIntent` (debounced, cache-gated, warms mem+IDB+SWR) and `memPut` into the durable warm path.
- **Create** `app/src/utils/prefetchBarOnIntent.test.js` — debounce + gate + warm tests.
- **Modify** `app/src/components/StockChart.jsx` — synchronous memcache seed in the switch effect, `memPut` on resolve, render `ChartSkeleton` in the loading overlay.
- **Modify** list surfaces (hover/focus wiring): `app/src/components/MoversSidebar.jsx`, `app/src/components/tiles/CatalystTable.jsx`, `app/src/pages/Watchlists.jsx`, `app/src/pages/ThemeTrackerPage.jsx`, `app/src/pages/Screener.jsx`, `app/src/pages/Breadth.jsx` (DrillModal rows).

**Build order:** Task 1 (cache) → Task 2 (prefetch) → Task 3 (skeleton) → Task 4 (StockChart integration) → Task 5 (surface hover wiring). Tasks 1–3 are pure/isolated and fully TDD'd. Tasks 4–5 modify `StockChart` and page components that mount Lightweight Charts (canvas) and are not unit-renderable in jsdom, so they use exact edits + explicit manual verification in the running app.

---

## Task 1: Synchronous in-memory bar cache

**Files:**
- Create: `app/src/utils/barsMemCache.js`
- Test: `app/src/utils/barsMemCache.test.js`

- [ ] **Step 1: Write the failing test**

```js
// app/src/utils/barsMemCache.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { memGet, memPeek, memHas, memPut, memClear, MEM_CACHE_MAX } from './barsMemCache'

const bars = (n, base = 1) =>
  Array.from({ length: n }, (_, i) => ({ t: base + i, o: 1, h: 2, l: 0, c: 1, v: 10 }))

describe('barsMemCache', () => {
  beforeEach(() => memClear())

  it('put then get returns the same bars', () => {
    const b = bars(3)
    memPut('AAPL', 'D', b)
    expect(memGet('AAPL', 'D')).toBe(b)
    expect(memHas('AAPL', 'D')).toBe(true)
  })

  it('normalizes symbol case', () => {
    const b = bars(2)
    memPut('aapl', '30', b)
    expect(memGet('AAPL', '30')).toBe(b)
    expect(memHas('Aapl', '30')).toBe(true)
  })

  it('is a no-op for empty/missing input', () => {
    memPut('AAPL', 'D', [])
    expect(memHas('AAPL', 'D')).toBe(false)
    expect(memGet(null, 'D')).toBeNull()
    expect(memGet('AAPL', null)).toBeNull()
    expect(memHas('', 'D')).toBe(false)
  })

  it('evicts the least-recently-used entry past the cap', () => {
    for (let i = 0; i < MEM_CACHE_MAX; i++) memPut(`T${i}`, 'D', bars(1, i))
    expect(memHas('T0', 'D')).toBe(true)
    memPut('OVER', 'D', bars(1, 999)) // one past cap → evicts oldest (T0)
    expect(memHas('T0', 'D')).toBe(false)
    expect(memHas('OVER', 'D')).toBe(true)
    expect(memHas('T1', 'D')).toBe(true)
  })

  it('promotes an entry to most-recently-used on get (survives eviction)', () => {
    for (let i = 0; i < MEM_CACHE_MAX; i++) memPut(`T${i}`, 'D', bars(1, i))
    memGet('T0', 'D')                  // touch oldest → now MRU
    memPut('OVER', 'D', bars(1, 999))  // evicts the NEW oldest (T1), not T0
    expect(memHas('T0', 'D')).toBe(true)
    expect(memHas('T1', 'D')).toBe(false)
  })

  it('memPeek returns bars WITHOUT reordering (safe to call during render)', () => {
    const first = bars(1, 0)
    memPut('T0', 'D', first)
    for (let i = 1; i < MEM_CACHE_MAX; i++) memPut(`T${i}`, 'D', bars(1, i))
    expect(memPeek('T0', 'D')).toBe(first)             // returns the stored array
    memPut('OVER', 'D', bars(1, 999)) // peek did NOT promote T0 → T0 still oldest → evicted
    expect(memHas('T0', 'D')).toBe(false)
    expect(memPeek('NOPE', 'D')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run src/utils/barsMemCache.test.js`
Expected: FAIL — `Failed to resolve import "./barsMemCache"` / functions not defined.

- [ ] **Step 3: Write the implementation**

```js
// app/src/utils/barsMemCache.js
// Synchronous in-memory LRU cache of chart bars, keyed by `${SYM}_${TF}`.
// This is the FAST layer in front of IndexedDB: a switch to a (sym, tf) that's
// in here paints in the SAME synchronous frame — no async idbGet hop, no
// spinner flash. IDB stays the durable layer; this map is wiped on reload by
// design (a small, hot, recency-bounded working set).
const MEM_CACHE_MAX = 60
const _map = new Map() // insertion-ordered; delete+set marks most-recently-used

function _key(sym, tf) {
  return `${String(sym || '').toUpperCase()}_${tf}`
}

export function memGet(sym, tf) {
  if (!sym || !tf) return null
  const k = _key(sym, tf)
  const entry = _map.get(k)
  if (!entry) return null
  _map.delete(k)        // re-insert at the end → mark MRU
  _map.set(k, entry)
  return entry.bars
}

// Like memGet but does NOT reorder (no MRU promotion). Safe to call during
// render — it's a pure read with no observable mutation.
export function memPeek(sym, tf) {
  if (!sym || !tf) return null
  const entry = _map.get(_key(sym, tf))
  return entry ? entry.bars : null
}

export function memHas(sym, tf) {
  if (!sym || !tf) return false
  return _map.has(_key(sym, tf))
}

export function memPut(sym, tf, bars) {
  if (!sym || !tf || !bars?.length) return
  const k = _key(sym, tf)
  if (_map.has(k)) _map.delete(k)
  _map.set(k, { bars, lastTs: bars[bars.length - 1]?.t ?? null })
  while (_map.size > MEM_CACHE_MAX) {
    _map.delete(_map.keys().next().value) // evict least-recently-used (oldest)
  }
}

export function memClear() {
  _map.clear()
}

export { MEM_CACHE_MAX }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run src/utils/barsMemCache.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/utils/barsMemCache.js app/src/utils/barsMemCache.test.js
git commit -m "feat(charts): synchronous in-memory bar cache (A2)"
```

---

## Task 2: Prefetch-on-intent + memcache warming in prefetchBars

**Files:**
- Modify: `app/src/utils/prefetchBars.js` (add `memPut` to the durable warm path; add `prefetchBarOnIntent`)
- Test: `app/src/utils/prefetchBarOnIntent.test.js`

- [ ] **Step 1: Write the failing test**

```js
// app/src/utils/prefetchBarOnIntent.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock the network + durable layers so the test observes ONLY the intent logic.
const preloadMock = vi.fn()
vi.mock('swr', () => ({ preload: (...a) => preloadMock(...a) }))
vi.mock('./barsIDB', () => ({ idbGet: vi.fn(async () => undefined), idbPut: vi.fn(async () => {}) }))
vi.mock('../hooks/useTickerMeta', () => ({ prefetchTickerMeta: vi.fn() }))

import { prefetchBarOnIntent } from './prefetchBars'
import { memHas, memPut, memClear, memGet } from './barsMemCache'

describe('prefetchBarOnIntent', () => {
  beforeEach(() => {
    memClear()
    preloadMock.mockReset()
    preloadMock.mockResolvedValue({ bars: [{ t: 1, o: 1, h: 2, l: 0, c: 1, v: 9 }] })
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('is a no-op when the (sym, tf) is already warm in memcache', () => {
    memPut('AAPL', 'D', [{ t: 1, o: 1, h: 2, l: 0, c: 1, v: 9 }])
    prefetchBarOnIntent('AAPL', 'D')
    vi.advanceTimersByTime(500)
    expect(preloadMock).not.toHaveBeenCalled()
  })

  it('debounces rapid repeated intents into a single fetch', () => {
    for (let i = 0; i < 6; i++) prefetchBarOnIntent('NVDA', 'D')
    vi.advanceTimersByTime(120)
    expect(preloadMock).toHaveBeenCalledTimes(1)
  })

  it('warms the synchronous memcache on a successful fetch', async () => {
    prefetchBarOnIntent('TSLA', '30')
    // advanceTimersByTimeAsync fires the debounce timer AND flushes the awaited
    // microtasks inside _warmIntentNow (preload → memPut), so the cache is warm.
    await vi.advanceTimersByTimeAsync(120)
    expect(memHas('TSLA', '30')).toBe(true)
    expect(memGet('TSLA', '30')?.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run src/utils/prefetchBarOnIntent.test.js`
Expected: FAIL — `prefetchBarOnIntent is not a function` (not yet exported).

- [ ] **Step 3: Add the memcache import + warm the durable path**

In `app/src/utils/prefetchBars.js`, add the import directly under the existing `barsIDB` import (line 14):

```js
import { idbGet, idbPut } from './barsIDB'
import { memHas, memPut } from './barsMemCache'
```

Then in `_idbWarmOne` (≈ line 124), add `memPut` right after the existing `idbPut` so durable prefetch also warms the synchronous cache:

```js
    if (json?.bars?.length && !json.delta) {
      await idbPut(sym, tf, json.bars)
      memPut(sym, tf, json.bars)   // also warm the synchronous mem cache
    }
```

- [ ] **Step 4: Add `prefetchBarOnIntent`**

Append to `app/src/utils/prefetchBars.js` (after `prefetchBarsToIDB`):

```js
// ── Intent prefetch (hover / keyboard focus) ─────────────────────────────────
// Warms mem + IDB + SWR for ONE timeframe on hover/focus so the eventual click
// paints instantly. Debounced (so brushing across a list doesn't fire), and a
// no-op when the (sym, tf) is already in the synchronous mem cache. Current-TF
// only — selection still calls prefetchAllTimeframes for the rest.
const _intentTimers = new Map()

async function _warmIntentNow(sym, tf) {
  if (memHas(sym, tf)) return
  try {
    const json = await preload(_url(sym, tf), fetcher) // dedupes + warms SWR cache
    if (json?.bars?.length && !json.delta) {
      memPut(sym, tf, json.bars)
      await idbPut(sym, tf, json.bars)                 // durable too
    }
  } catch { /* best-effort; the chart's own fetch remains source of truth */ }
}

export function prefetchBarOnIntent(sym, tf = 'D', { delay = 120 } = {}) {
  if (!sym || !tf) return
  if (memHas(sym, tf)) return
  const key = `${String(sym).toUpperCase()}_${tf}`
  if (_intentTimers.has(key)) return // debounce: a fire is already pending
  const t = setTimeout(() => {
    _intentTimers.delete(key)
    _warmIntentNow(sym, tf)
  }, delay)
  _intentTimers.set(key, t)
  prefetchTickerMeta(sym)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd app && npx vitest run src/utils/prefetchBarOnIntent.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the existing util tests to confirm no regression**

Run: `cd app && npx vitest run src/utils/`
Expected: PASS (existing util tests + the two new files).

- [ ] **Step 7: Commit**

```bash
git add app/src/utils/prefetchBars.js app/src/utils/prefetchBarOnIntent.test.js
git commit -m "feat(charts): prefetchBarOnIntent + memcache warming on hover (A3)"
```

---

## Task 3: ChartSkeleton component

**Files:**
- Create: `app/src/components/chart/ChartSkeleton.jsx`
- Create: `app/src/components/chart/ChartSkeleton.module.css`
- Test: `app/src/components/chart/ChartSkeleton.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/components/chart/ChartSkeleton.test.jsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ChartSkeleton from './ChartSkeleton'

describe('ChartSkeleton', () => {
  it('renders an accessible busy status carrying the label', () => {
    render(<ChartSkeleton label="Loading TSLA…" />)
    const el = screen.getByRole('status')
    expect(el).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Loading TSLA…')).toBeInTheDocument()
  })

  it('falls back to a default label', () => {
    render(<ChartSkeleton />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run src/components/chart/ChartSkeleton.test.jsx`
Expected: FAIL — cannot resolve `./ChartSkeleton`.

- [ ] **Step 3: Write the component + CSS**

```jsx
// app/src/components/chart/ChartSkeleton.jsx
import styles from './ChartSkeleton.module.css'

// Cold-load placeholder shown while a chart with NO cached bars fetches.
// Renders a shimmer band over the chart frame instead of a spinner, and never
// shows another ticker's candles. prefers-reduced-motion drops the animation.
export default function ChartSkeleton({ label = 'Loading chart…' }) {
  return (
    <div className={styles.skeleton} role="status" aria-live="polite" aria-busy="true">
      <div className={styles.shimmer} aria-hidden="true" />
      <span className={styles.srOnly}>{label}</span>
    </div>
  )
}
```

```css
/* app/src/components/chart/ChartSkeleton.module.css */
.skeleton {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--color-bg-elevated, #0e1117);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}
.shimmer {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    rgba(255, 255, 255, 0) 30%,
    rgba(255, 255, 255, 0.05) 50%,
    rgba(255, 255, 255, 0) 70%
  );
  background-size: 200% 100%;
  animation: chartSkeletonShimmer 1.4s ease-in-out infinite;
}
@keyframes chartSkeletonShimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .shimmer { animation: none; }
}
.srOnly {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0);
  white-space: nowrap; border: 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run src/components/chart/ChartSkeleton.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/components/chart/ChartSkeleton.jsx app/src/components/chart/ChartSkeleton.module.css app/src/components/chart/ChartSkeleton.test.jsx
git commit -m "feat(charts): ChartSkeleton shimmer placeholder (A1)"
```

---

## Task 4: Integrate memcache + skeleton into StockChart

**Files:**
- Modify: `app/src/components/StockChart.jsx` (import line 33, bars derivation ≈1616-1625, resolve effect ≈1536-1543, loading overlay ≈4770-4774)

> **No unit test for this task.** `StockChart` mounts Lightweight Charts (canvas) and pulls in dozens of hooks/providers; it is not rendered in the jsdom vitest suite (there is no `StockChart.test.jsx`). The unit-level safety is already covered by Tasks 1–3. This task is verified by **running the app** (Step 5). Keep every edit minimal and the fragile cross-ticker switch effect (≈1421-1436) **untouched** — we add a render-time fallback instead of rewriting it.

- [ ] **Step 1: Add imports**

In `app/src/components/StockChart.jsx`, find the import at line 33:

```js
import { idbGet, idbPut, mergeDelta } from '../utils/barsIDB'
```

Add directly below it:

```js
import { memPeek, memPut } from '../utils/barsMemCache'
import ChartSkeleton from './chart/ChartSkeleton'
```

- [ ] **Step 2: Add a render-time memcache fallback to the `bars` derivation**

This is the actual flash-killer. `memPeek` is keyed to the CURRENT `sym`+`resolvedTf`, so it can only ever return the current ticker's bars — flip-safe by construction — and because it's read during render it paints on the very first frame, with no dependency on effect timing. It sits as the LAST fallback, only used when neither the network nor IDB data matches yet.

Replace the derivation at ≈lines 1616-1625:

```js
  const _symU = sym ? sym.toUpperCase() : ''
  const _netMatches = data?.bars?.length && (!data.ticker || data.ticker === _symU)
  const _idbFresh = idbBars?.length && idbReadyForRef.current === `${sym}_${resolvedTf}` && !idbStaleIntraday
  const bars = _overrideArr
    ? barsOverride
    : (barsOverridePending
        ? null  // override expected but not here yet → render nothing (spinner), don't fall back to provider data
        : ((_netMatches && !data.delta)
            ? data.bars
            : (_idbFresh ? idbBars : (_netMatches ? data.bars : null))))
  const loading = !bars && !error
```

with:

```js
  const _symU = sym ? sym.toUpperCase() : ''
  const _netMatches = data?.bars?.length && (!data.ticker || data.ticker === _symU)
  const _idbFresh = idbBars?.length && idbReadyForRef.current === `${sym}_${resolvedTf}` && !idbStaleIntraday
  // A2/A1: synchronous in-memory hit for THIS exact sym+tf. Used only as the
  // last fallback (when net+IDB haven't resolved for the current key yet) so a
  // warm switch paints on the first frame instead of flashing the loading
  // overlay. Keyed to the current sym+tf → cannot show another ticker's data.
  const _memBars = (!_overrideArr && !barsOverridePending) ? memPeek(sym, resolvedTf) : null
  const bars = _overrideArr
    ? barsOverride
    : (barsOverridePending
        ? null  // override expected but not here yet → render nothing (spinner), don't fall back to provider data
        : ((_netMatches && !data.delta)
            ? data.bars
            : (_idbFresh
                ? idbBars
                : (_netMatches
                    ? data.bars
                    : (_memBars?.length ? _memBars : null)))))
  const loading = !bars && !error
```

- [ ] **Step 3: Write resolved bars into the memcache**

In the SWR-resolve effect, update the two write branches at ≈lines 1536-1543.

Find:

```js
      setIdbBars(merged)
      if (merged.length) idbSinceRef.current = merged[merged.length - 1].t
      idbPut(sym, resolvedTf, merged)
    } else if (!data.delta && data.bars.length) {
      setIdbBars(data.bars)
      idbSinceRef.current = data.bars[data.bars.length - 1]?.t ?? null
      idbPut(sym, resolvedTf, data.bars)
    }
```

Replace with (adds `memPut` to both branches):

```js
      setIdbBars(merged)
      if (merged.length) idbSinceRef.current = merged[merged.length - 1].t
      idbPut(sym, resolvedTf, merged)
      memPut(sym, resolvedTf, merged)
    } else if (!data.delta && data.bars.length) {
      setIdbBars(data.bars)
      idbSinceRef.current = data.bars[data.bars.length - 1]?.t ?? null
      idbPut(sym, resolvedTf, data.bars)
      memPut(sym, resolvedTf, data.bars)
    }
```

- [ ] **Step 4: Render the shimmer skeleton in the loading overlay**

Replace the loading overlay at ≈lines 4770-4774:

```jsx
      {loading && (
        <div className={styles.skeletonOverlay}>
          <div className={styles.skeletonText}>Loading {sym}…</div>
        </div>
      )}
```

with:

```jsx
      {loading && <ChartSkeleton label={`Loading ${sym}…`} />}
```

- [ ] **Step 5: Verify in the running app (manual)**

Build and run:

```bash
cd app && npm run build
cd .. && python -m uvicorn api.main:app --port 8077
```

Open `http://localhost:8077`, go to `/charts`, and verify:
1. **Warm switch:** open AAPL (D), switch to another ticker and back to AAPL → AAPL repaints with **no "Loading…" flash** (it's in memcache).
2. **TF switch:** flip AAPL between D/30/60 after they've each loaded once → no flash.
3. **Cold switch:** type a long-tail ticker you've never opened → a **shimmer skeleton** appears (not the previous ticker's candles), then real data snaps in.
4. **No flip-bug:** rapidly switch between two tickers → never see one ticker's candles under the other's header.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/StockChart.jsx
git commit -m "feat(charts): synchronous memcache seed + skeleton on cold switch (A1/A2)"
```

---

## Task 5: Wire hover/focus prefetch into ticker-list surfaces

**Files (one edit each):**
- Modify: `app/src/components/MoversSidebar.jsx`
- Modify: `app/src/components/tiles/CatalystTable.jsx`
- Modify: `app/src/pages/Watchlists.jsx`
- Modify: `app/src/pages/ThemeTrackerPage.jsx`
- Modify: `app/src/pages/Screener.jsx`
- Modify: `app/src/pages/Breadth.jsx`

> **No unit test for this task** (these pages mount charts/providers; not jsdom-renderable). Verified manually in Step 3. The handler is identical across surfaces; each step shows the exact import + the row element to attach it to.

- [ ] **Step 1: Find existing hover-prefetch call sites to upgrade**

Run: `cd app && grep -rn "prefetchBar\b\|prefetchBarsToIDB\|onMouseEnter\|onPointerEnter" src/components/MoversSidebar.jsx src/components/tiles/CatalystTable.jsx src/pages/Watchlists.jsx src/pages/ThemeTrackerPage.jsx src/pages/Screener.jsx src/pages/Breadth.jsx`

For any existing `prefetchBar(sym, 'D')`-on-hover call, replace it with `prefetchBarOnIntent(sym, 'D')` (same arguments). For surfaces with no hover prefetch yet, add one per the steps below. `'D'` is the most-likely-first-viewed timeframe and matches the existing `prefetchBar` default; selection still warms all TFs via `prefetchAllTimeframes`.

- [ ] **Step 2: MoversSidebar — add the import and handler**

In `app/src/components/MoversSidebar.jsx`, add the import near the top (with the other `../utils` imports):

```js
import { prefetchBarOnIntent } from '../utils/prefetchBars'
```

On the element that wraps each mover ticker (the row/chip that the user clicks to open a chart), add:

```jsx
onPointerEnter={() => prefetchBarOnIntent(sym, 'D')}
onFocus={() => prefetchBarOnIntent(sym, 'D')}
```

(Use the row's existing symbol variable in place of `sym`.)

- [ ] **Step 3: CatalystTable — add the import and handler**

In `app/src/components/tiles/CatalystTable.jsx`:

```js
import { prefetchBarOnIntent } from '../../utils/prefetchBars'
```

On each catalyst row's ticker cell/link, add:

```jsx
onPointerEnter={() => prefetchBarOnIntent(row.ticker, 'D')}
onFocus={() => prefetchBarOnIntent(row.ticker, 'D')}
```

(Use the row's existing ticker field in place of `row.ticker`.)

- [ ] **Step 4: Watchlists — add the import and handler**

In `app/src/pages/Watchlists.jsx`:

```js
import { prefetchBarOnIntent } from '../utils/prefetchBars'
```

On each `.listRow` ticker element (the same element carrying `data-watch-sym`), add:

```jsx
onPointerEnter={() => prefetchBarOnIntent(rowSym, 'D')}
onFocus={() => prefetchBarOnIntent(rowSym, 'D')}
```

(Use the row's existing symbol variable in place of `rowSym`.)

- [ ] **Step 5: ThemeTrackerPage — add the import and handler**

In `app/src/pages/ThemeTrackerPage.jsx`:

```js
import { prefetchBarOnIntent } from '../utils/prefetchBars'
```

On each holding-row ticker element, add:

```jsx
onPointerEnter={() => prefetchBarOnIntent(holdingSym, 'D')}
onFocus={() => prefetchBarOnIntent(holdingSym, 'D')}
```

(Use the row's existing holding symbol variable in place of `holdingSym`.)

- [ ] **Step 6: Screener — add the import and handler**

In `app/src/pages/Screener.jsx`:

```js
import { prefetchBarOnIntent } from '../utils/prefetchBars'
```

On each candidate row's ticker element, add:

```jsx
onPointerEnter={() => prefetchBarOnIntent(candidateSym, 'D')}
onFocus={() => prefetchBarOnIntent(candidateSym, 'D')}
```

(Use the row's existing candidate symbol variable in place of `candidateSym`.)

- [ ] **Step 7: Breadth DrillModal — add the import and handler**

In `app/src/pages/Breadth.jsx`:

```js
import { prefetchBarOnIntent } from '../utils/prefetchBars'
```

On each DrillModal mover-list ticker row, add:

```jsx
onPointerEnter={() => prefetchBarOnIntent(moverSym, 'D')}
onFocus={() => prefetchBarOnIntent(moverSym, 'D')}
```

(Use the row's existing symbol variable in place of `moverSym`.)

- [ ] **Step 8: Build and verify (manual)**

```bash
cd app && npm run build
```

Expected: build succeeds with no errors. Then run the app (as in Task 4 Step 5), hover a ticker in each surface for ~1s, then click it → the chart opens **instantly** (it was warmed into the memcache by the hover). Confirm via the Network tab that idle hovering across a list does not fire a fetch per row (debounce + cache-gate), only for tickers you linger on.

- [ ] **Step 9: Commit**

```bash
git add app/src/components/MoversSidebar.jsx app/src/components/tiles/CatalystTable.jsx app/src/pages/Watchlists.jsx app/src/pages/ThemeTrackerPage.jsx app/src/pages/Screener.jsx app/src/pages/Breadth.jsx
git commit -m "feat(charts): prefetch-on-hover wiring across ticker-list surfaces (A3)"
```

---

## Final verification

- [ ] **Run the full frontend unit suite**

Run: `cd app && npx vitest run`
Expected: PASS — all existing tests plus the 3 new files (barsMemCache, prefetchBarOnIntent, ChartSkeleton).

- [ ] **Push**

```bash
git pull --rebase origin master
git push origin master
```

---

## Spec coverage check

- **A2 synchronous memcache** → Task 1 (cache, incl. `memPeek`) + Task 4 Step 2 (render-time fallback) + writes in Task 4 Step 3 / Task 2 Step 3.
- **A1 eliminate blank frame** → Task 4 Step 2 (`memPeek` fallback paints warm switch on frame 1, so `loading` stays false) + Task 3 + Task 4 Step 4 (skeleton on cold).
- **A1 cold = skeleton, never wrong data** → cold has no `memPeek` hit → `bars` is null → `loading` true → Task 4 Step 4 renders `ChartSkeleton` (the existing switch effect already clears the prior ticker's `idbBars`, untouched here).
- **A1 cross-ticker safety contract** → `memPeek(sym, resolvedTf)` is keyed to the current sym+tf (can't return another ticker's bars); the fragile `idbReadyForRef` switch effect and the resolve effect's `data.ticker` checks are left unchanged.
- **A3 prefetch-on-intent (current-TF, debounced, cache-gated)** → Task 2 Step 4 + Task 5.
- **Tunables (MEM_CACHE_MAX=60, 120ms debounce)** → Task 1 (`MEM_CACHE_MAX`), Task 2 (`delay = 120`).
- **Testing** → Tasks 1-3 unit tests; Tasks 4-5 manual verification (documented rationale: not jsdom-renderable).
