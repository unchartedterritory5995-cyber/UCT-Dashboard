/**
 * 2,000 MEMBERS IS NOT 2,000 LIVE ROW COMPONENTS — AND SORTING STILL SEES ALL 2,000.
 *
 * Measured before this change (prod 2026-09-20 + a synthetic DOM floor):
 *   · the widget row list was a plain `.map` — 1,872 mounted rows, 13,104 DOM nodes,
 *     618 ms of build+layout BEFORE React, logos, effects or quotes
 *   · every row was streamed: ~38 EventSource connections (50/conn) and 8 parallel
 *     `/api/live-prices` calls every 2 s, per widget
 *   · `/api/research/snapshot-batch` truncated at 100, so rows 101+ could NEVER show
 *     Market Cap / Rating / Sector
 *
 * ⛔ THE RULE THIS FILE EXISTS TO HOLD: virtualization controls RENDERING. It must
 * not redefine sorting. "Sort Russell 2000 by % Change" ranks all 1,872 members or
 * the column header is lying about what it ordered — so the whole-list quote vector
 * and the whole-list bulk enrichment are asked for even though only ~40 rows exist
 * in the DOM.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { ChartsSymContext } from './charts/ChartsSymContext'

const BIG = 400          // > VIRTUALIZE_MIN_ROWS
const SMALL = 12         // < VIRTUALIZE_MIN_ROWS

const mkItems = (n, prefix = 'S') =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, sym: `${prefix}${i}`, notes: '' }))

const hoisted = vi.hoisted(() => ({ prebuilt: [], calls: [] }))

vi.mock('swr', () => ({
  default: (key, fetcher) => {
    const k = Array.isArray(key) ? key[0] : key
    const path = typeof k === 'string' ? k.split('?')[0] : null
    if (path) hoisted.calls.push({ path, arg: Array.isArray(key) ? key[1] : null })
    if (path === '/api/watchlists') return { data: [], mutate: () => {} }
    if (path === '/api/watchlists/public') return { data: [], mutate: () => {} }
    if (path === '/api/watchlists/prebuilt') return { data: hoisted.prebuilt, mutate: () => {} }
    return { data: undefined, mutate: () => {} }
  },
  SWRConfig: ({ children }) => children,
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'user', display_name: 'Pat' } }),
}))
vi.mock('../utils/prefetchBars', () => ({
  prefetchBars: () => {}, prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {},
  prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {}, warmMemFromIDB: () => {},
  prefetchVisibleList: () => {}, prewarmVisibleList: () => {},
}))
vi.mock('../hooks/useRealtimePrices', () => ({
  default: (tickers) => {
    hoisted.calls.push({ path: 'stream', arg: tickers })
    return { prices: {}, staleSymbols: new Set(), isStreaming: false, status: 'idle' }
  },
}))
vi.mock('../hooks/useBulkQuotes', () => ({
  default: (tickers, enabled) => {
    hoisted.calls.push({ path: 'bulk-quotes', arg: enabled ? tickers : null })
    return {}
  },
}))

const { default: Watchlists } = await import('./Watchlists')

function lastArg(path) {
  for (let i = hoisted.calls.length - 1; i >= 0; i--) {
    if (hoisted.calls[i].path === path) return hoisted.calls[i].arg
  }
  return undefined
}

beforeEach(() => {
  hoisted.calls = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
  // jsdom gives every element a zero-sized box AND ships a no-op ResizeObserver
  // (src/test-setup.js), so the virtualizer would measure a 0px viewport and render
  // nothing. Give it a real box and an observer that actually reports one.
  // ⚠️ `offsetHeight`, not `getBoundingClientRect` — virtual-core's `getRect` reads
  // `offsetWidth`/`offsetHeight`, and jsdom answers 0 for both. Stub the wrong pair
  // and the virtualizer measures a 0px viewport and renders nothing, which looks
  // exactly like a broken component.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 400 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 400 })
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { top: 0, left: 0, bottom: 600, right: 400, width: 400, height: 600, x: 0, y: 0, toJSON() {} }
  }
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb) { this.cb = cb }
    observe(el) { this.cb([{ target: el, contentRect: el.getBoundingClientRect() }], this) }
    unobserve() {}
    disconnect() {}
  })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('a large watchlist', () => {
  beforeEach(() => {
    hoisted.prebuilt = [{ id: 'big', name: 'Russell 2000', items: mkItems(BIG) }]
  })

  it('mounts far fewer rows than it has members', async () => {
    const { container } = render(<Watchlists embedded pickList="community:big" pickName="Russell 2000" />)
    await waitFor(() => expect(container.querySelectorAll('[data-watch-sym]').length).toBeGreaterThan(0))

    const mounted = container.querySelectorAll('[data-watch-sym]').length
    expect(mounted).toBeLessThan(BIG / 2)
    expect(mounted).toBeLessThan(120)
  })

  it('streams only what is on screen', async () => {
    render(<Watchlists embedded pickList="community:big" pickName="Russell 2000" />)
    // ⚠️ Wait for a NON-EMPTY set. The first render streams `[]` before the
    // virtualizer has reported a window, and `[]` is truthy — waiting on truthiness
    // read that first value and made the assertion below pass on an empty list.
    await waitFor(() => expect(lastArg('stream')?.length || 0).toBeGreaterThan(0))

    const streamed = lastArg('stream')
    // Non-empty as well as narrow: a virtualizer that measured a 0px viewport would
    // stream nothing and pass a "less than" assertion while rendering an empty list.
    expect(streamed.length).toBeGreaterThan(0)
    expect(streamed.length).toBeLessThan(BIG / 2)
  })

  it('still asks for the WHOLE list to sort by', async () => {
    render(<Watchlists embedded pickList="community:big" pickName="Russell 2000" />)
    await waitFor(() => expect(lastArg('bulk-quotes')).toBeTruthy())

    // ⛔ The sort universe is the LIST, never the window. If this ever narrows to the
    // visible rows, "sort by % Change" silently starts ranking ~40 of 1,872.
    expect(lastArg('bulk-quotes')).toHaveLength(BIG)
  })
})

describe('a small watchlist', () => {
  beforeEach(() => {
    hoisted.prebuilt = [{ id: 'small', name: 'Dow 30', items: mkItems(SMALL, 'D') }]
  })

  it('renders every row outright and streams all of them', async () => {
    const { container } = render(<Watchlists embedded pickList="community:small" pickName="Dow 30" />)
    await waitFor(() => expect(container.querySelectorAll('[data-watch-sym]').length).toBe(SMALL))

    expect(lastArg('stream')).toHaveLength(SMALL)
    // Below the threshold there is no separate whole-list pass to pay for — the
    // stream already covers every row.
    expect(lastArg('bulk-quotes')).toBeNull()
  })
})

describe('keyboard navigation across a virtualized list', () => {
  beforeEach(() => {
    hoisted.prebuilt = [{ id: 'big', name: 'Russell 2000', items: mkItems(BIG) }]
  })

  it('walks past the edge of the rendered window', async () => {
    // ⛔ THE REGRESSION THIS PINS. `handleKeyDown` derives its order from the
    // `[data-watch-sym]` elements in the DOM — deliberately, so nav follows the
    // active COLUMN SORT, which the stored order does not know about. That is exact
    // while every row is mounted. Once 1,872 rows render ~40, the arrows would stop
    // dead at the edge of the window, and the existing `if (!flat.length)` fallback
    // never fires because the window is short, not empty.
    const picked = []
    const ctx = { sym: null, setSym: (s) => { ctx.sym = s; picked.push(s) } }
    const { container } = render(
      <ChartsSymContext.Provider value={ctx}>
        <Watchlists embedded pickList="community:big" pickName="Russell 2000" />
      </ChartsSymContext.Provider>,
    )
    await waitFor(() => expect(container.querySelectorAll('[data-watch-sym]').length).toBeGreaterThan(0))

    const mounted = container.querySelectorAll('[data-watch-sym]').length
    // Step further than the DOM alone could ever answer for.
    for (let i = 0; i < mounted + 25; i++) {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      })
    }

    expect(picked.length).toBeGreaterThan(mounted)
    // …and it is still walking the LIST's order, never repeating the window.
    expect(new Set(picked).size).toBe(picked.length)
    expect(picked[0]).toBe('S0')
    expect(picked[picked.length - 1]).toBe(`S${picked.length - 1}`)
  })
})
