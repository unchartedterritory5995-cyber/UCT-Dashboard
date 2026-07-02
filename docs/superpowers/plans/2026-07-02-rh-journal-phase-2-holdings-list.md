# Robinhood Journal — Phase 2: Holdings List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default Open Positions view with a Robinhood-style holdings list — logo + ticker + share count + 30-day sparkline + colored price pill + today % — with an RH-style sort control, keeping the dense table behind a view toggle.

**Architecture:** Pure row-model builders in `holdingsRows.js` (testable, no React), a fan-out sparkline hook mirroring the shipped `useIntradayEquityCurve` pattern, a display-only `HoldingsList` component, and a persisted List|Table toggle in `OpenPositionsTab`. A generic `<Sparkline>` component is extracted from `JournalSnapshotTile`'s inline SVG for reuse.

**Tech Stack:** React 18 + Vite, CSS modules, vitest + @testing-library/react, existing endpoints only (`/api/bars/{sym}?tf=D`, `useRealtimePrices`, `/api/ticker-logo` via `CompanyLogo`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-01-robinhood-journal-design.md` (Phase 2 section). Locked invariants apply.
- **Keep the dense table as a toggle — don't delete existing functionality.**
- Gains green / losses red (`var(--gain, #22c55e)` / `var(--loss, #ef4444)`); UCT gold only for chrome.
- **No emoji as icons** — inline SVG or `UIcon` only.
- Breakpoints: ONLY 640 and 1024 (`@media (max-width: 640px)` for phone).
- Options: broker mark only (`brokerCurrentValue`, camelCase); no greeks/quotes.
- Phase 2 list rows are **display-only** (Phase 3 adds click-through to the per-stock detail page). Edit/Close/Delete stay in the Table view.
- Frontend-only; zero new backend.
- Worktree: `.worktrees/rh-journal`, branch `feat/rh-journal-p2` off `origin/master`. Main repo tree is another session's WIP — do NOT touch it.
- Test runner: `cd app && npx vitest run <path>`. Build check: `cd app && npm run build`.

---

### Task 1: Reusable `<Sparkline>` component

**Files:**
- Create: `app/src/components/Sparkline.jsx`
- Test: `app/src/components/Sparkline.test.jsx`

**Interfaces:**
- Produces: `default Sparkline({ values, width = 96, height = 32, fill = true, className })` — renders an SVG polyline (viewBox `0 0 100 100`, `preserveAspectRatio="none"`) colored by trend (last ≥ first → `var(--gain, #22c55e)`, else `var(--loss, #ef4444)`); returns `null` when fewer than 2 finite values.
- Produces: `export function sparkPaths(values)` → `{ line, area, up }` or `null` — the pure path builder (generalized from `buildSpark` in `JournalSnapshotTile.jsx:76`, which takes `{value}` objects; this one takes plain numbers).

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/components/Sparkline.test.jsx
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Sparkline, { sparkPaths } from './Sparkline'

describe('sparkPaths', () => {
  it('returns null for fewer than 2 finite values', () => {
    expect(sparkPaths([])).toBeNull()
    expect(sparkPaths([5])).toBeNull()
    expect(sparkPaths([NaN, null])).toBeNull()
  })

  it('builds a line spanning x 0..100 and flags up-trend', () => {
    const res = sparkPaths([1, 2, 3])
    expect(res.up).toBe(true)
    expect(res.line.startsWith('M0.00')).toBe(true)
    expect(res.line).toContain('L100.00')
    expect(res.area.endsWith('L100 100 L0 100 Z')).toBe(true)
  })

  it('flags down-trend', () => {
    expect(sparkPaths([3, 2, 1]).up).toBe(false)
  })

  it('skips non-finite values', () => {
    expect(sparkPaths([1, NaN, 3]).up).toBe(true)
  })
})

describe('Sparkline', () => {
  it('renders nothing without enough data', () => {
    const { container } = render(<Sparkline values={[1]} />)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders an svg with line and area paths', () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(container.querySelectorAll('path').length).toBe(2)
  })

  it('omits the area path when fill is false', () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} fill={false} />)
    expect(container.querySelectorAll('path').length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/Sparkline.test.jsx`
Expected: FAIL — `Cannot find module './Sparkline'`

- [ ] **Step 3: Write the implementation**

```jsx
// app/src/components/Sparkline.jsx
/**
 * Generic mini price sparkline (Robinhood-style). Pure SVG, no deps.
 * Colored by trend: last value >= first → gain green, else loss red.
 */
import { useId } from 'react'

/** Pure path builder: number[] → { line, area, up } (viewBox 0..100), or null. */
export function sparkPaths(values) {
  const pts = (values || []).filter((v) => Number.isFinite(v))
  if (pts.length < 2) return null
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const span = max - min || 1
  const n = pts.length
  const coords = pts.map((v, i) => ({
    x: (i / (n - 1)) * 100,
    y: 100 - ((v - min) / span) * 100,
  }))
  const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(' ')
  const area = `${line} L100 100 L0 100 Z`
  return { line, area, up: pts[n - 1] >= pts[0] }
}

export default function Sparkline({ values, width = 96, height = 32, fill = true, className = '' }) {
  const gradId = useId()
  const spark = sparkPaths(values)
  if (!spark) return null
  const color = spark.up ? 'var(--gain, #22c55e)' : 'var(--loss, #ef4444)'
  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {fill && (
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {fill && <path d={spark.area} fill={`url(#${gradId})`} />}
      <path
        d={spark.line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/components/Sparkline.test.jsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add app/src/components/Sparkline.jsx app/src/components/Sparkline.test.jsx
git commit -m "feat(journal): reusable Sparkline component — Phase 2 groundwork"
```

---

### Task 2: Pure holdings row models + sort (`holdingsRows.js`)

**Files:**
- Create: `app/src/pages/journal-2-0/lib/holdingsRows.js`
- Test: `app/src/pages/journal-2-0/lib/holdingsRows.test.js`

**Interfaces:**
- Consumes: `currentPriceFor(position, prices)` and `positionPnlDollar(p, current)` from `app/src/lib/journal-2-0` (barrel re-exports `calculations.js`); `buildStrategyLabel(s)` from `../lib/optionCalcs`. `prices` is the `useRealtimePrices` map: `{ SYM: { price, change_pct, prev_close? } }`.
- Produces:
  - `buildEquityRows(positions, prices, todayIso)` → array of `{ kind: 'equity', key, symbol, side, shares, price, changePct, todayDollar, marketValue, totalReturnDollar, totalReturnPct, sparkKey }`
  - `buildOptionRows(strategies)` → array of `{ kind: 'option', key, label, underlying, contracts, marketValue, pnlDollar, pnlPct }`
  - `sortRows(rows, key, dir)` → new sorted array. `key ∈ SORT_OPTIONS` keys, `dir ∈ 'asc'|'desc'`. Null/undefined sort values always sink last.
  - `SORT_OPTIONS` — `[{ key, label }]`: `symbol` "Symbol", `price` "Price", `changePct` "Today %", `marketValue` "Equity", `todayDollar` "Today $", `totalReturnDollar` "Total return".

Row semantics (from the spec's locked RH facts):
- `price` = `currentPriceFor(p, prices)` (live tick → broker mark → null).
- `changePct` = raw stock `change_pct` from the live snapshot (stock-centric, drives the pill color) — null when absent.
- `todayDollar` = `signedShares × (price − ref)` where `ref` = `entryPrice` if `p.entryDate === todayIso` (same-day fills measure from the fill), else `prev_close` from the snapshot, else derived `price / (1 + change_pct/100)`; null if no reference. Shorts: `signedShares` negative.
- `marketValue` = `|shares| × price` (null when price null).
- `totalReturnDollar` = `positionPnlDollar(p, price)` (side-aware); `totalReturnPct` = `totalReturnDollar / (entryPrice × shares)`.
- Option `marketValue` = `Math.abs(brokerCurrentValue)` (null when absent); `pnlDollar` = `brokerCurrentValue − netEntry`; `pnlPct` = `pnlDollar / |netEntry|`.

- [ ] **Step 1: Write the failing test**

```js
// app/src/pages/journal-2-0/lib/holdingsRows.test.js
import { describe, it, expect } from 'vitest'
import { buildEquityRows, buildOptionRows, sortRows, SORT_OPTIONS } from './holdingsRows'

const TODAY = '2026-07-02'

const long = {
  id: 1, symbol: 'AAPL', side: 'Long', shares: 10, entryPrice: 100, entryDate: '2026-06-01',
}
const short = {
  id: 2, symbol: 'TSLA', side: 'Short', shares: 5, entryPrice: 200, entryDate: '2026-06-01',
}
const openedToday = {
  id: 3, symbol: 'NVDA', side: 'Long', shares: 2, entryPrice: 150, entryDate: TODAY,
}

const prices = {
  AAPL: { price: 110, change_pct: 2, prev_close: 107.84 },
  TSLA: { price: 190, change_pct: -1, prev_close: 191.92 },
  NVDA: { price: 155, change_pct: 4, prev_close: 149.04 },
}

describe('buildEquityRows', () => {
  it('computes price, market value and total return (long)', () => {
    const [row] = buildEquityRows([long], prices, TODAY)
    expect(row.kind).toBe('equity')
    expect(row.price).toBe(110)
    expect(row.marketValue).toBe(1100)
    expect(row.totalReturnDollar).toBe(100)          // (110-100)*10
    expect(row.totalReturnPct).toBeCloseTo(0.1)
    expect(row.changePct).toBe(2)
  })

  it('today$ = signedShares × (price − prev_close); shorts flip sign', () => {
    const [row] = buildEquityRows([short], prices, TODAY)
    // short: -5 × (190 − 191.92) = +9.6
    expect(row.todayDollar).toBeCloseTo(9.6)
    expect(row.changePct).toBe(-1)                   // stock-centric, not flipped
  })

  it('same-day entries measure today from the fill price', () => {
    const [row] = buildEquityRows([openedToday], prices, TODAY)
    expect(row.todayDollar).toBeCloseTo((155 - 150) * 2)  // ref = entry, not prev_close
  })

  it('derives prev_close from change_pct when snapshot lacks it', () => {
    const p = { ...long }
    const noPc = { AAPL: { price: 110, change_pct: 10 } }  // implied prev_close = 100
    const [row] = buildEquityRows([p], noPc, TODAY)
    expect(row.todayDollar).toBeCloseTo(100)               // 10 × (110 − 100)
  })

  it('falls back to broker mark and nulls today when no live entry', () => {
    const p = { ...long, brokerPrice: 105 }
    const [row] = buildEquityRows([p], {}, TODAY)
    expect(row.price).toBe(105)
    expect(row.todayDollar).toBeNull()
    expect(row.changePct).toBeNull()
    expect(row.marketValue).toBe(1050)
  })
})

describe('buildOptionRows', () => {
  it('maps broker mark and P&L', () => {
    const s = { id: 9, underlying: 'CRWV', netEntry: 400, brokerCurrentValue: 600, legs: [] }
    const [row] = buildOptionRows([s])
    expect(row.kind).toBe('option')
    expect(row.marketValue).toBe(600)
    expect(row.pnlDollar).toBe(200)
    expect(row.pnlPct).toBeCloseTo(0.5)
  })

  it('nulls when the broker mark is absent', () => {
    const s = { id: 9, underlying: 'CRWV', netEntry: 400, brokerCurrentValue: null, legs: [] }
    const [row] = buildOptionRows([s])
    expect(row.marketValue).toBeNull()
    expect(row.pnlDollar).toBeNull()
  })
})

describe('sortRows', () => {
  const rows = buildEquityRows([long, short, openedToday], prices, TODAY)

  it('exposes the RH sort options', () => {
    expect(SORT_OPTIONS.map((o) => o.key)).toEqual(
      ['symbol', 'price', 'changePct', 'marketValue', 'todayDollar', 'totalReturnDollar'],
    )
  })

  it('sorts text asc and numeric desc', () => {
    expect(sortRows(rows, 'symbol', 'asc').map((r) => r.symbol)).toEqual(['AAPL', 'NVDA', 'TSLA'])
    expect(sortRows(rows, 'price', 'desc').map((r) => r.symbol)).toEqual(['TSLA', 'NVDA', 'AAPL'])
  })

  it('sinks null sort values last regardless of direction', () => {
    const withNull = [...rows, { kind: 'equity', key: 'x', symbol: 'ZZZ', price: null }]
    expect(sortRows(withNull, 'price', 'desc').at(-1).symbol).toBe('ZZZ')
    expect(sortRows(withNull, 'price', 'asc').at(-1).symbol).toBe('ZZZ')
  })

  it('does not mutate the input', () => {
    const before = rows.map((r) => r.symbol)
    sortRows(rows, 'price', 'desc')
    expect(rows.map((r) => r.symbol)).toEqual(before)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/holdingsRows.test.js`
Expected: FAIL — `Cannot find module './holdingsRows'`

- [ ] **Step 3: Write the implementation**

```js
// app/src/pages/journal-2-0/lib/holdingsRows.js
/**
 * Robinhood-style holdings list row models (Phase 2).
 * Pure functions — no React, no fetch. Semantics per the RH spec:
 *   today$ = signedShares × (price − ref); ref = fill price for same-day
 *   entries, else prev close (derived from change_pct when the feed lacks it).
 */
import { currentPriceFor, positionPnlDollar } from '../../../lib/journal-2-0'
import { buildStrategyLabel } from './optionCalcs'

const fin = (v) => (Number.isFinite(v) ? v : null)

function prevCloseOf(snap) {
  if (!snap) return null
  if (Number.isFinite(snap.prev_close)) return snap.prev_close
  if (Number.isFinite(snap.price) && Number.isFinite(snap.change_pct)) {
    const pc = snap.price / (1 + snap.change_pct / 100)
    return Number.isFinite(pc) ? pc : null
  }
  return null
}

export function buildEquityRows(positions, prices, todayIso) {
  return (positions || []).map((p) => {
    const snap = prices?.[p.symbol]
    const price = fin(currentPriceFor(p, prices))
    const signed = (p.side === 'Short' ? -1 : 1) * (p.shares || 0)
    const ref = p.entryDate === todayIso ? fin(p.entryPrice) : prevCloseOf(snap)
    const livePrice = fin(snap?.price)
    const todayDollar = livePrice != null && ref != null ? signed * (livePrice - ref) : null
    const totalReturnDollar = price == null ? null : positionPnlDollar(p, price)
    const basis = (p.entryPrice || 0) * (p.shares || 0)
    return {
      kind: 'equity',
      key: `e-${p.id}`,
      symbol: p.symbol,
      side: p.side,
      shares: p.shares,
      price,
      changePct: fin(snap?.change_pct),
      todayDollar,
      marketValue: price == null ? null : Math.abs(p.shares || 0) * price,
      totalReturnDollar,
      totalReturnPct: totalReturnDollar != null && basis ? totalReturnDollar / basis : null,
      sparkKey: p.symbol,
    }
  })
}

export function buildOptionRows(strategies) {
  return (strategies || []).map((s) => {
    const mark = fin(s.brokerCurrentValue)
    const pnl = mark == null || !Number.isFinite(s.netEntry) ? null : mark - s.netEntry
    return {
      kind: 'option',
      key: `o-${s.id}`,
      label: buildStrategyLabel(s),
      underlying: s.underlying,
      contracts: s.legs?.[0]?.qty ?? null,
      marketValue: mark == null ? null : Math.abs(mark),
      pnlDollar: pnl,
      pnlPct: pnl != null && s.netEntry ? pnl / Math.abs(s.netEntry) : null,
    }
  })
}

export const SORT_OPTIONS = [
  { key: 'symbol', label: 'Symbol' },
  { key: 'price', label: 'Price' },
  { key: 'changePct', label: 'Today %' },
  { key: 'marketValue', label: 'Equity' },
  { key: 'todayDollar', label: 'Today $' },
  { key: 'totalReturnDollar', label: 'Total return' },
]

export function sortRows(rows, key, dir) {
  const mult = dir === 'desc' ? -1 : 1
  return [...(rows || [])].sort((a, b) => {
    const av = a?.[key]
    const bv = b?.[key]
    const aNull = av == null
    const bNull = bv == null
    if (aNull && bNull) return 0
    if (aNull) return 1                       // nulls sink last, both directions
    if (bNull) return -1
    if (typeof av === 'string') return mult * av.localeCompare(bv)
    return mult * (av - bv)
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/holdingsRows.test.js`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/lib/holdingsRows.js app/src/pages/journal-2-0/lib/holdingsRows.test.js
git commit -m "feat(journal): holdings row models + RH sort — Phase 2"
```

---

### Task 3: Daily-bars sparkline hook (`useHoldingsSparklines`)

**Files:**
- Create: `app/src/pages/journal-2-0/hooks/useHoldingsSparklines.js`
- Test: `app/src/pages/journal-2-0/hooks/useHoldingsSparklines.test.js`

**Interfaces:**
- Consumes: `GET /api/bars/{sym}?tf=D&bars=30` → `{ bars: [{ t, o, h, l, c, v }] }` (same endpoint the shipped `useIntradayEquityCurve.js:46` uses with `tf=5`).
- Produces: `default useHoldingsSparklines(symbols)` → `{ closes, loading }` where `closes` = `{ SYM: number[] }` (chronological daily closes). Fetches once per distinct symbol-set (joined-key dep, mirroring `useIntradayEquityCurve`'s `symKey` pattern); caps fan-out at 60 symbols; failed fetches yield `[]` for that symbol.

- [ ] **Step 1: Write the failing test**

```js
// app/src/pages/journal-2-0/hooks/useHoldingsSparklines.test.js
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import useHoldingsSparklines from './useHoldingsSparklines'

const barsFor = (closes) => ({ bars: closes.map((c, i) => ({ t: 1700000000 + i * 86400, c })) })

beforeEach(() => {
  global.fetch = vi.fn((url) => {
    const sym = url.match(/\/api\/bars\/([A-Z.]+)\?/)?.[1]
    if (sym === 'BAD') return Promise.resolve({ ok: false })
    return Promise.resolve({ ok: true, json: () => Promise.resolve(barsFor([1, 2, 3])) })
  })
})
afterEach(() => vi.restoreAllMocks())

describe('useHoldingsSparklines', () => {
  it('fetches daily closes per symbol', async () => {
    const { result } = renderHook(() => useHoldingsSparklines(['AAPL', 'TSLA']))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.closes.AAPL).toEqual([1, 2, 3])
    expect(result.current.closes.TSLA).toEqual([1, 2, 3])
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/bars/AAPL?tf=D&bars=30', expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('yields [] for a failed symbol without breaking the rest', async () => {
    const { result } = renderHook(() => useHoldingsSparklines(['AAPL', 'BAD']))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.closes.AAPL).toEqual([1, 2, 3])
    expect(result.current.closes.BAD).toEqual([])
  })

  it('returns empty map for no symbols without fetching', () => {
    const { result } = renderHook(() => useHoldingsSparklines([]))
    expect(result.current.closes).toEqual({})
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('caps fan-out at 60 symbols', async () => {
    const many = Array.from({ length: 80 }, (_, i) => `S${i}A`)
    const { result } = renderHook(() => useHoldingsSparklines(many))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(global.fetch).toHaveBeenCalledTimes(60)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/journal-2-0/hooks/useHoldingsSparklines.test.js`
Expected: FAIL — `Cannot find module './useHoldingsSparklines'`

- [ ] **Step 3: Write the implementation**

```js
// app/src/pages/journal-2-0/hooks/useHoldingsSparklines.js
/**
 * 30-day daily-close sparkline data for the RH-style holdings list.
 * One /api/bars/{sym}?tf=D&bars=30 fetch per holding (parallel), re-run only
 * when the symbol SET changes — mirrors useIntradayEquityCurve's pattern.
 * Fan-out is capped; a failed symbol resolves to [] so one miss never blanks
 * the whole list.
 */
import { useEffect, useMemo, useState } from 'react'

const MAX_SYMBOLS = 60

export default function useHoldingsSparklines(symbols) {
  const [closes, setCloses] = useState({})
  const [loading, setLoading] = useState(false)

  const capped = useMemo(
    () => [...new Set((symbols || []).filter(Boolean))].slice(0, MAX_SYMBOLS),
    [symbols],
  )
  const symKey = capped.join(',')

  useEffect(() => {
    if (!capped.length) {
      setCloses({})
      return undefined
    }
    let cancelled = false
    setLoading(true)
    Promise.all(
      capped.map((sym) =>
        fetch(`/api/bars/${encodeURIComponent(sym)}?tf=D&bars=30`, { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
          .then((d) => [sym, (d?.bars || []).map((b) => b?.c).filter(Number.isFinite)]),
      ),
    ).then((pairs) => {
      if (cancelled) return
      setCloses(Object.fromEntries(pairs))
      setLoading(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symKey])

  return { closes, loading }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/journal-2-0/hooks/useHoldingsSparklines.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/hooks/useHoldingsSparklines.js app/src/pages/journal-2-0/hooks/useHoldingsSparklines.test.js
git commit -m "feat(journal): daily-bars sparkline hook for holdings list — Phase 2"
```

---

### Task 4: `HoldingsList` component

**Files:**
- Create: `app/src/pages/journal-2-0/components/HoldingsList.jsx`
- Create: `app/src/pages/journal-2-0/components/HoldingsList.module.css`
- Test: `app/src/pages/journal-2-0/components/HoldingsList.test.jsx`

**Interfaces:**
- Consumes: `buildEquityRows` / `buildOptionRows` / `sortRows` / `SORT_OPTIONS` (Task 2); `useHoldingsSparklines` (Task 3); `Sparkline` (Task 1); `CompanyLogo` (`app/src/components/CompanyLogo.jsx`, props `sym`, `size`, `tile`); `money`, `moneySigned`, `percent` from `app/src/lib/journal-2-0`.
- Produces: `default HoldingsList({ positions, optionStrategies, prices })` — sections **Stocks & ETFs** and **Options** (each rendered only when non-empty), sort `<select>` + asc/desc toggle button (persisted `localStorage['uct.j2.holdings.sort']` as `key:dir`, default `marketValue:desc`).

Row layout (RH-minimal + UCT adaptation from the spec): `CompanyLogo tile 28px` · bold ticker + gray "N shares" (or "Short N" for shorts) · flexible center `Sparkline` (30-day closes) · right column = **price pill** (solid `--gain`/`--loss` background by `changePct` sign; neutral dark chip when `changePct` null) with today % beneath. Option rows: label + "N contracts" left, mark value + P&L right, no logo/sparkline (broker mark only).

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/journal-2-0/components/HoldingsList.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import HoldingsList from './HoldingsList'

vi.mock('../hooks/useHoldingsSparklines', () => ({
  default: () => ({ closes: { AAPL: [1, 2, 3], TSLA: [3, 2, 1] }, loading: false }),
}))
vi.mock('../../../components/CompanyLogo', () => ({
  default: ({ sym }) => <span data-testid={`logo-${sym}`} />,
}))

const positions = [
  { id: 1, symbol: 'AAPL', side: 'Long', shares: 10, entryPrice: 100, entryDate: '2026-06-01' },
  { id: 2, symbol: 'TSLA', side: 'Short', shares: 5, entryPrice: 200, entryDate: '2026-06-01' },
]
const prices = {
  AAPL: { price: 110, change_pct: 2, prev_close: 107.84 },
  TSLA: { price: 190, change_pct: -1, prev_close: 191.92 },
}
const strategies = [
  {
    id: 9, underlying: 'CRWV', strategyType: 'long_call', netEntry: 400,
    brokerCurrentValue: 600, legs: [{ qty: 2, strike: 110, expiration: '2026-10-16', entryPrice: 2 }],
  },
]

beforeEach(() => localStorage.clear())

describe('HoldingsList', () => {
  it('renders the Stocks & ETFs section with logo, ticker, shares and price pill', () => {
    render(<HoldingsList positions={positions} optionStrategies={[]} prices={prices} />)
    expect(screen.getByText('Stocks & ETFs')).toBeInTheDocument()
    expect(screen.getByTestId('logo-AAPL')).toBeInTheDocument()
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('10 shares')).toBeInTheDocument()
    expect(screen.getByText('$110.00')).toBeInTheDocument()
    expect(screen.getByText('Short 5')).toBeInTheDocument()
  })

  it('renders the Options section from the broker mark', () => {
    render(<HoldingsList positions={[]} optionStrategies={strategies} prices={{}} />)
    expect(screen.getByText('Options')).toBeInTheDocument()
    expect(screen.getByText('$600.00')).toBeInTheDocument()
    expect(screen.queryByText('Stocks & ETFs')).toBeNull()
  })

  it('defaults to Equity desc and re-sorts via the control', () => {
    render(<HoldingsList positions={positions} optionStrategies={[]} prices={prices} />)
    let syms = screen.getAllByTestId('holding-sym').map((el) => el.textContent)
    expect(syms).toEqual(['AAPL', 'TSLA'])          // 1100 > 950
    fireEvent.change(screen.getByLabelText('Sort holdings'), { target: { value: 'symbol' } })
    fireEvent.click(screen.getByRole('button', { name: /direction/i }))  // desc → asc
    syms = screen.getAllByTestId('holding-sym').map((el) => el.textContent)
    expect(syms).toEqual(['AAPL', 'TSLA'])
    expect(JSON.parse(localStorage.getItem('uct.j2.holdings.sort'))).toEqual({ key: 'symbol', dir: 'asc' })
  })

  it('renders nothing when the book is empty', () => {
    const { container } = render(<HoldingsList positions={[]} optionStrategies={[]} prices={{}} />)
    expect(container.textContent).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/journal-2-0/components/HoldingsList.test.jsx`
Expected: FAIL — `Cannot find module './HoldingsList'`

- [ ] **Step 3: Write the component**

```jsx
// app/src/pages/journal-2-0/components/HoldingsList.jsx
/**
 * Robinhood-style holdings list (Phase 2 of the RH Journal initiative).
 * Minimal rows — logo · ticker + share count · 30-day sparkline · colored
 * price pill + today % — grouped into Stocks & ETFs / Options sections with
 * an RH-style sort control. Display-only: Edit/Close/Delete live in the
 * dense Table view; Phase 3 wires row click-through to the detail page.
 */
import { useMemo, useState } from 'react'
import CompanyLogo from '../../../components/CompanyLogo'
import Sparkline from '../../../components/Sparkline'
import useHoldingsSparklines from '../hooks/useHoldingsSparklines'
import { buildEquityRows, buildOptionRows, sortRows, SORT_OPTIONS } from '../lib/holdingsRows'
import { money, moneySigned, percent } from '../../../lib/journal-2-0'
import styles from './HoldingsList.module.css'

const SORT_STORAGE_KEY = 'uct.j2.holdings.sort'
const DEFAULT_SORT = { key: 'marketValue', dir: 'desc' }

function loadSort() {
  try {
    const raw = JSON.parse(localStorage.getItem(SORT_STORAGE_KEY))
    if (raw && SORT_OPTIONS.some((o) => o.key === raw.key) && ['asc', 'desc'].includes(raw.dir)) {
      return raw
    }
  } catch { /* corrupt pref — fall through to default */ }
  return DEFAULT_SORT
}

export default function HoldingsList({ positions = [], optionStrategies = [], prices = {} }) {
  const [sort, setSort] = useState(loadSort)

  const todayIso = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
    [],
  )
  const equityRows = useMemo(
    () => sortRows(buildEquityRows(positions, prices, todayIso), sort.key, sort.dir),
    [positions, prices, todayIso, sort],
  )
  const optionRows = useMemo(() => buildOptionRows(optionStrategies), [optionStrategies])

  const symbols = useMemo(() => positions.map((p) => p.symbol), [positions])
  const { closes } = useHoldingsSparklines(symbols)

  if (!equityRows.length && !optionRows.length) return null

  const saveSort = (next) => {
    setSort(next)
    try { localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }

  return (
    <div className={styles.wrap}>
      {equityRows.length > 0 && (
        <section aria-label="Stocks and ETFs">
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>Stocks &amp; ETFs</h3>
            <div className={styles.sortCtl}>
              <label className={styles.srOnly} htmlFor="holdings-sort">Sort holdings</label>
              <select
                id="holdings-sort"
                className={styles.sortSelect}
                value={sort.key}
                onChange={(e) => saveSort({ ...sort, key: e.target.value })}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
              <button
                type="button"
                className={styles.dirBtn}
                aria-label={`Sort direction: ${sort.dir === 'desc' ? 'descending' : 'ascending'}`}
                onClick={() => saveSort({ ...sort, dir: sort.dir === 'desc' ? 'asc' : 'desc' })}
              >
                <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
                  {sort.dir === 'desc'
                    ? <path d="M2 4l4 5 4-5z" fill="currentColor" />
                    : <path d="M2 8l4-5 4 5z" fill="currentColor" />}
                </svg>
              </button>
            </div>
          </div>
          <ul className={styles.rows}>
            {equityRows.map((row) => (
              <EquityRow key={row.key} row={row} spark={closes[row.sparkKey]} />
            ))}
          </ul>
        </section>
      )}

      {optionRows.length > 0 && (
        <section aria-label="Options">
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>Options</h3>
          </div>
          <ul className={styles.rows}>
            {optionRows.map((row) => <OptionRow key={row.key} row={row} />)}
          </ul>
        </section>
      )}
    </div>
  )
}

function EquityRow({ row, spark }) {
  const pillTone = row.changePct == null
    ? styles.pillFlat
    : row.changePct >= 0 ? styles.pillUp : styles.pillDown
  return (
    <li className={styles.row}>
      <CompanyLogo sym={row.symbol} size={28} tile />
      <div className={styles.ident}>
        <span className={styles.sym} data-testid="holding-sym">{row.symbol}</span>
        <span className={styles.shares}>
          {row.side === 'Short' ? `Short ${row.shares}` : `${row.shares} shares`}
        </span>
      </div>
      <div className={styles.spark}>
        <Sparkline values={spark} width={96} height={30} />
      </div>
      <div className={styles.right}>
        <span className={`${styles.pill} ${pillTone}`}>
          {row.price == null ? '—' : money(row.price)}
        </span>
        <span className={styles.today}>
          {row.changePct == null
            ? ' '
            : percent(row.changePct, { dp: 2, signed: true, isRatio: false })}
        </span>
      </div>
    </li>
  )
}

function OptionRow({ row }) {
  const tone = row.pnlDollar == null ? '' : row.pnlDollar >= 0 ? styles.pos : styles.neg
  return (
    <li className={styles.row}>
      <div className={styles.ident}>
        <span className={styles.sym}>{row.label}</span>
        <span className={styles.shares}>
          {row.contracts != null ? `${row.contracts} ${row.contracts === 1 ? 'contract' : 'contracts'}` : 'Broker mark'}
        </span>
      </div>
      <div className={styles.spacer} />
      <div className={styles.right}>
        <span className={styles.optValue}>
          {row.marketValue == null ? '—' : money(row.marketValue)}
        </span>
        <span className={`${styles.today} ${tone}`}>
          {row.pnlDollar == null ? ' ' : moneySigned(row.pnlDollar)}
        </span>
      </div>
    </li>
  )
}
```

```css
/* app/src/pages/journal-2-0/components/HoldingsList.module.css */
.wrap {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.sectionHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.sectionTitle {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text, #e8e6e1);
  letter-spacing: 0.2px;
}

.sortCtl {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sortSelect {
  background: var(--surface-2, #17171a);
  color: var(--text-muted, #8a8a8a);
  border: 1px solid var(--border, #2a2a2e);
  border-radius: 999px;
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
}

.dirBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid var(--border, #2a2a2e);
  background: var(--surface-2, #17171a);
  color: var(--accent, #c9a84c);
  cursor: pointer;
}

.srOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
}

.row:last-child {
  border-bottom: none;
}

.ident {
  display: flex;
  flex-direction: column;
  min-width: 84px;
  gap: 2px;
}

.sym {
  font-weight: 700;
  font-size: 14px;
  color: var(--text, #e8e6e1);
}

.shares {
  font-size: 12px;
  color: var(--text-muted, #8a8a8a);
}

.spark {
  flex: 1;
  display: flex;
  justify-content: center;
  min-width: 0;
}

.spacer {
  flex: 1;
}

.right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  min-width: 92px;
}

/* Robinhood-style solid price pill — green up / red down. */
.pill {
  display: inline-block;
  min-width: 78px;
  text-align: center;
  padding: 4px 10px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.pillUp {
  background: var(--gain, #22c55e);
  color: #04140a;
}

.pillDown {
  background: var(--loss, #ef4444);
  color: #fff;
}

.pillFlat {
  background: var(--surface-2, #17171a);
  color: var(--text-muted, #8a8a8a);
  border: 1px solid var(--border, #2a2a2e);
}

.today {
  font-size: 12px;
  color: var(--text-muted, #8a8a8a);
  font-variant-numeric: tabular-nums;
}

.optValue {
  font-size: 13px;
  font-weight: 700;
  color: var(--text, #e8e6e1);
  font-variant-numeric: tabular-nums;
}

.pos { color: var(--gain, #22c55e); }
.neg { color: var(--loss, #ef4444); }

/* Phone: drop the sparkline so ticker + pill keep breathing room. */
@media (max-width: 640px) {
  .spark { display: none; }
  .row { gap: 10px; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/journal-2-0/components/HoldingsList.test.jsx`
Expected: PASS (4 tests). If `percent(..., { isRatio: false })` renders differently than assumed, check `app/src/lib/journal-2-0/format.js` and adjust the assertion to the real output — the tile (`JournalSnapshotTile.jsx:389`) uses exactly this call shape.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/components/HoldingsList.jsx app/src/pages/journal-2-0/components/HoldingsList.module.css app/src/pages/journal-2-0/components/HoldingsList.test.jsx
git commit -m "feat(journal): Robinhood-style holdings list component — Phase 2"
```

---

### Task 5: List | Table view toggle in `OpenPositionsTab`

**Files:**
- Modify: `app/src/pages/journal-2-0/tabs/OpenPositionsTab.jsx` (imports ~line 25; render block ~lines 395–411; actions group ~lines 351–392)
- Modify: `app/src/pages/journal-2-0/tabs/OpenPositionsTab.module.css` (append toggle styles)
- Test: extend `app/src/pages/journal-2-0/tabs/OpenPositionsTab.test.jsx` if it exists; otherwise create focused test `app/src/pages/journal-2-0/tabs/OpenPositionsTab.view.test.jsx`

**Interfaces:**
- Consumes: `HoldingsList` (Task 4). Existing `mergedPositions`, `positions`, `optionStrategies`, `prices` already computed in the tab.
- Produces: pill toggle **List | Table** (persisted `localStorage['uct.j2.openPositions.view']`, default `'list'`). `'list'` renders `<HoldingsList positions={positions} optionStrategies={showOptions ? optionStrategies : []} prices={prices} />`; `'table'` renders the existing `<PositionsTable …>` unchanged. The `▦ Columns` picker button renders **only** in table view (it configures table columns).

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/journal-2-0/tabs/OpenPositionsTab.view.test.jsx
// Focused view-toggle tests. Mock the heavy children — this only asserts
// which view renders and that the choice persists.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import OpenPositionsTab from './OpenPositionsTab'

vi.mock('../hooks/useJ2Positions', () => ({
  default: () => ({
    positions: [{ id: 1, symbol: 'AAPL', side: 'Long', shares: 10, entryPrice: 100, entryDate: '2026-06-01', stopPrice: 95 }],
    isLoading: false, error: null, refresh: vi.fn(),
  }),
}))
vi.mock('../hooks/useJ2OptionStrategies', () => ({
  default: () => ({ strategies: [], isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../hooks/useJ2SelectedAccount', () => ({
  default: () => ({ accountId: 'a1', account: { id: 'a1', name: 'Test' }, accounts: [] }),
}))
vi.mock('../hooks/useJ2Nudges', () => ({ default: () => ({ nudges: null }) }))
vi.mock('../hooks/useBrokerWarming', () => ({ default: () => ({ warming: false, broker: null }) }))
vi.mock('../../../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: { AAPL: { price: 110, change_pct: 2 } }, isStreaming: false }),
}))
vi.mock('../components/BrokerAccountHero', () => ({ default: () => null }))
vi.mock('../components/BrokerSyncStatus', () => ({ default: () => null }))
vi.mock('../components/BrokerReviewNudge', () => ({ default: () => null }))
vi.mock('../components/NudgesBanner', () => ({ default: () => null }))
vi.mock('../components/HoldingsList', () => ({
  default: () => <div data-testid="holdings-list" />,
}))
vi.mock('../components/PositionsTable', () => ({
  default: () => <div data-testid="positions-table" />,
  POSITIONS_COLUMNS: [{ key: 'symbol', label: 'Symbol' }],
}))

beforeEach(() => localStorage.clear())

describe('OpenPositionsTab view toggle', () => {
  it('defaults to the RH holdings list', () => {
    render(<OpenPositionsTab settings={{}} />)
    expect(screen.getByTestId('holdings-list')).toBeInTheDocument()
    expect(screen.queryByTestId('positions-table')).toBeNull()
  })

  it('switches to the table and persists the choice', () => {
    render(<OpenPositionsTab settings={{}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(screen.getByTestId('positions-table')).toBeInTheDocument()
    expect(localStorage.getItem('uct.j2.openPositions.view')).toBe('table')
  })

  it('restores a persisted table preference', () => {
    localStorage.setItem('uct.j2.openPositions.view', 'table')
    render(<OpenPositionsTab settings={{}} />)
    expect(screen.getByTestId('positions-table')).toBeInTheDocument()
  })

  it('shows the Columns button only in table view', () => {
    render(<OpenPositionsTab settings={{}} />)
    expect(screen.queryByRole('button', { name: /columns/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(screen.getByRole('button', { name: /columns/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/journal-2-0/tabs/OpenPositionsTab.view.test.jsx`
Expected: FAIL — no `holdings-list` testid rendered, no "Table" button.

- [ ] **Step 3: Implement the toggle in `OpenPositionsTab.jsx`**

Add the import next to the PositionsTable import (~line 25):

```jsx
import HoldingsList from '../components/HoldingsList'
```

Add state + persistence near the other `useState` calls (~line 145):

```jsx
const VIEW_STORAGE_KEY = 'uct.j2.openPositions.view'   // module scope, next to COLUMN_STORAGE_KEY
```

```jsx
const [view, setView] = useState(() => {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(VIEW_STORAGE_KEY) : null
  return saved === 'table' ? 'table' : 'list'
})
const switchView = (v) => {
  setView(v)
  try { localStorage.setItem(VIEW_STORAGE_KEY, v) } catch { /* private mode */ }
}
```

In the actions group (`styles.actionGroup`, ~line 351), add the toggle FIRST and wrap the existing Columns picker `<div className={styles.pickerWrap}>` block in `{view === 'table' && ( … )}`:

```jsx
<div className={styles.viewToggle} role="group" aria-label="Positions view">
  <button
    type="button"
    className={view === 'list' ? styles.viewBtnActive : styles.viewBtn}
    onClick={() => switchView('list')}
  >
    List
  </button>
  <button
    type="button"
    className={view === 'table' ? styles.viewBtnActive : styles.viewBtn}
    onClick={() => switchView('table')}
  >
    Table
  </button>
</div>
```

Replace the `<PositionsTable …/>` render (~lines 399–410) with:

```jsx
view === 'list' ? (
  <HoldingsList
    positions={showShares ? positions : []}
    optionStrategies={showOptions ? optionStrategies : []}
    prices={prices}
  />
) : (
  <PositionsTable
    positions={mergedPositions}
    prices={prices}
    accountSize={accountSize}
    visibleColumns={visibleColumns}
    onEdit={(p) => setEditTarget(p)}
    onClose={(p) => setCloseTarget(p)}
    onDelete={handleDeleteRequest}
    onOptionClose={(s) => setOptionsCloseTarget(s)}
    onOptionDelete={(s) => setOptionsDeleteTarget(s)}
  />
)
```

Append to `OpenPositionsTab.module.css`:

```css
.viewToggle {
  display: inline-flex;
  border: 1px solid var(--border, #2a2a2e);
  border-radius: 999px;
  overflow: hidden;
}

.viewBtn,
.viewBtnActive {
  border: none;
  background: transparent;
  color: var(--text-muted, #8a8a8a);
  font-size: 12px;
  font-weight: 600;
  padding: 6px 14px;
  cursor: pointer;
}

.viewBtnActive {
  background: var(--accent, #c9a84c);
  color: #151310;
}
```

- [ ] **Step 4: Run the new test + the full journal suite**

Run: `cd app && npx vitest run src/pages/journal-2-0 src/components/tiles/JournalSnapshotTile.test.jsx src/components/Sparkline.test.jsx`
Expected: ALL PASS. If existing `OpenPositionsTab` tests assert the table renders by default, update those tests to first click the "Table" toggle (the table is intact, just behind the toggle — spec-mandated adaptation).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/tabs/OpenPositionsTab.jsx app/src/pages/journal-2-0/tabs/OpenPositionsTab.module.css app/src/pages/journal-2-0/tabs/OpenPositionsTab.view.test.jsx
git commit -m "feat(journal): List|Table view toggle — RH holdings list is the default view"
```

---

### Task 6: DRY — `JournalSnapshotTile` uses the shared `Sparkline`

**Files:**
- Modify: `app/src/components/tiles/JournalSnapshotTile.jsx` (BrokerHero, lines ~75–92 `buildSpark` + ~295–332 inline SVG)

**Interfaces:**
- Consumes: `Sparkline`, `sparkPaths` (Task 1).
- Produces: `buildSpark(series)` **stays exported with the same signature** (`{value}` objects → `{line, area, up}`) as a thin wrapper over `sparkPaths` — existing tests/tile callers keep working.

- [ ] **Step 1: Refactor**

Replace the `buildSpark` body with a delegation and swap the inline `<svg>` block for the shared component:

```jsx
import Sparkline, { sparkPaths } from '../Sparkline'

/** Back-compat wrapper: broker equity series ({value} objects) → paths. */
export function buildSpark(series) {
  return sparkPaths((series || []).map((p) => p?.value))
}
```

In `BrokerHero`, replace the whole `{spark && (<svg …>…</svg>)}` block with:

```jsx
<Sparkline
  className={styles.spark}
  values={series.map((p) => p?.value)}
  fill
/>
```

and delete the now-unused `spark`/`sparkColor` locals (keep `buildSpark` export for tests).

- [ ] **Step 2: Run the tile tests + build**

Run: `cd app && npx vitest run src/components/tiles/JournalSnapshotTile.test.jsx && npm run build`
Expected: PASS + build green. The `styles.spark` class supplies the absolute positioning — verify visually in Task 7 that the dashboard tile sparkline still renders behind the hero. If the CSS sizing relied on the SVG's 100%-width attribute, pass `width="100%" height="100%"` through (add a `stretch` prop or style via the className) rather than reworking the tile CSS.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/tiles/JournalSnapshotTile.jsx
git commit -m "refactor(journal): JournalSnapshotTile reuses the shared Sparkline"
```

---

### Task 7: Full verification + ship

- [ ] **Step 1: Full frontend suite + build**

Run: `cd app && npx vitest run && npm run build`
Expected: all tests pass (note the ONE known pre-existing failure: `ModelBook.test.jsx` Setup-Library heading — fails on master too, NOT this branch); build green.

- [ ] **Step 2: Visual check (local)**

Follow the CLAUDE.md local-backend recipe (heavy jobs off) + `cd app && npm run build`, then eyeball `/journal?j2tab=positions`:
- List view default: logos, sparklines, price pills, sort control work; Options section shows marks.
- Toggle → Table: identical to the shipped dense table, Columns picker back.
- Phone width (≤640): sparkline hidden, no horizontal overflow (`python tools/mobile_audit.py --base http://localhost:8077 --auth --viewport phone --routes /journal`).

- [ ] **Step 3: Ship (per repo flow: rebase onto origin/master, fast-forward push to master)**

```bash
git fetch origin
git rebase origin/master
cd app && npx vitest run && npm run build && cd ..
git push origin HEAD:master
git push origin feat/rh-journal-p2
```

- [ ] **Step 4: Verify the Railway deploy actually landed (stale-build-cache lesson)**

```bash
# 1. new index chunk name
curl -s https://uctintelligence.com/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1
# 2. journal chunk name from that index bundle
curl -s https://uctintelligence.com/<index chunk> | grep -oE 'JournalTwoRoot-[A-Za-z0-9_-]+\.js' | head -1
# 3. Phase 2 source marker present in the deployed chunk
curl -s https://uctintelligence.com/assets/<JournalTwoRoot chunk> | grep -c 'Stocks & ETFs'
```
Expected: step 3 ≥ 1. Do NOT trust deploy SUCCESS alone.

---

## Self-Review

- **Spec coverage:** logo+ticker+shares+sparkline+pill+today-% row → Task 4; reusable `<Sparkline>` extraction → Tasks 1+6; `/api/bars?tf=D&bars=30` fan-out → Task 3; dense table behind toggle → Task 5; RH sort control (Symbol/Price/%/Equity/Today/Total return) → Tasks 2+4. Per-stock detail click-through is Phase 3 (explicitly out of scope).
- **Types:** `buildEquityRows(positions, prices, todayIso)` / `sortRows(rows, key, dir)` / `useHoldingsSparklines(symbols) → {closes, loading}` / `Sparkline({values,…})` used consistently across Tasks 2–6.
- **No placeholders:** every step carries real code/commands.
