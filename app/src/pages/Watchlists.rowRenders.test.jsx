/**
 * NEXT-ROW: AN ARROW PRESS RE-RENDERS THE TWO ROWS WHOSE SELECTION CHANGED, AND NO OTHER (2026-11-23).
 *
 * `WatchRow` is React.memo over all-primitive props, so a selection change should re-render only the row that
 * loses the highlight and the row that gains it. A column from the column library (LIVE / FACT columns, e.g.
 * Gap %) handed every row a NEW `libCells` object on every render (`libCellsFor` built one per row per call),
 * so with one shown, EVERY mounted row re-rendered on every press. The rows' cells now keep their object while
 * what they show is unchanged.
 *   R1 virtualized list, default columns: a press re-renders exactly the two rows
 *   R2 virtualized list with a library column: exactly the two rows
 *   R3 small list, default columns: exactly the two rows
 *   R4 small list with a library column: exactly the two rows
 *   R5 a library cell still shows a new value when its input changes (the kept object is never a stale one)
 *
 * The counter: `RowSpark` (mocked) renders once per WatchRow render, inside every row's symbol cell.
 *
 * Mutation proof: `libCellsFor` returns its freshly built object again (no reuse) -> R2, R4 red.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { ChartsSymContext } from './charts/ChartsSymContext'

const BIG = 400          // > VIRTUALIZE_MIN_ROWS
const SMALL = 12         // < VIRTUALIZE_MIN_ROWS
const mkItems = (n, prefix) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, sym: `${prefix}${i}`, notes: '' }))
const WITH_GAP = { order: ['flag', 'sym', 'price', 'vol', 'chg', 'gap'] }   // Gap %: a LIVE column of the library

const hoisted = vi.hoisted(() => ({ prebuilt: [], renders: new Map(), prices: {} }))

vi.mock('../components/mobile/RowSpark', () => ({
  default: ({ sym }) => { hoisted.renders.set(sym, (hoisted.renders.get(sym) || 0) + 1); return null },
}))
vi.mock('swr', () => ({
  default: (key) => {
    const k = Array.isArray(key) ? key[0] : key
    const path = typeof k === 'string' ? k.split('?')[0] : null
    if (path === '/api/watchlists') return { data: [], mutate: () => {} }
    if (path === '/api/watchlists/public') return { data: [], mutate: () => {} }
    if (path === '/api/watchlists/prebuilt') return { data: hoisted.prebuilt, mutate: () => {} }
    return { data: undefined, mutate: () => {} }
  },
  SWRConfig: ({ children }) => children,
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
const MOCK_USER = { id: 'u1', role: 'user', display_name: 'Pat' }
vi.mock('../context/AuthContext', async () => {
  const { createContext } = await import('react')
  return { useAuth: () => ({ user: MOCK_USER }), AuthContext: createContext({ user: MOCK_USER }) }
})
vi.mock('../utils/prefetchBars', () => ({
  prefetchBars: () => {}, prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {},
  prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {}, warmMemFromIDB: () => {},
  prefetchVisibleList: () => {}, prewarmVisibleList: () => {},
}))
// A NEW prices object on every call, as a live feed hands one over on every tick: the rows' values must not
// depend on its identity.
vi.mock('../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: { ...hoisted.prices }, staleSymbols: new Set(), isStreaming: false, status: 'idle' }),
}))
vi.mock('../hooks/useBulkQuotes', () => ({ default: () => ({}) }))

const { default: Watchlists } = await import('./Watchlists')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const press = async () => {
  await act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
  await act(async () => { await sleep(30) })          // and whatever the press sets off
}
const mountedSyms = (container) => [...container.querySelectorAll('[data-watch-sym]')].map((el) => el.getAttribute('data-watch-sym'))
const rerendered = () => [...hoisted.renders.keys()].sort()

beforeEach(() => {
  try { localStorage.clear() } catch { /* private mode */ }
  hoisted.renders = new Map()
  hoisted.prices = {}
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 30 })
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

/** Mounted and settled on the list's first row, the render counter emptied. */
async function mountOnFirstRow(listId, extra = {}) {
  const ctx = { sym: null, setSym: () => {} }
  const view = render(
    <ChartsSymContext.Provider value={ctx}>
      <Watchlists embedded pickList={`community:${listId}`} pickName={listId} {...extra} />
    </ChartsSymContext.Provider>,
  )
  await waitFor(() => expect(view.container.querySelectorAll('[data-watch-sym]').length).toBeGreaterThan(0))
  await act(async () => { await sleep(30) })
  await press()                                        // onto the first row
  const mounted = mountedSyms(view.container)
  // non-vacuity: more rows than the two a press may touch, and the counter saw every one of them
  expect(mounted.length).toBeGreaterThan(4)
  for (const s of mounted) expect(hoisted.renders.get(s) || 0, `${s} never counted`).toBeGreaterThan(0)
  hoisted.renders = new Map()
  return { ...view, mounted }
}

describe('a virtualized list', () => {
  beforeEach(() => { hoisted.prebuilt = [{ id: 'big', name: 'Big', items: mkItems(BIG, 'S') }] })

  it('R1 default columns: a press re-renders exactly the two rows whose selection changed', async () => {
    const { mounted } = await mountOnFirstRow('big')
    expect(mounted.length).toBeLessThan(BIG / 2)       // it IS the virtualized path
    await press()                                      // S0 -> S1
    expect(rerendered()).toEqual(['S0', 'S1'])
  })

  it('R2 with a library column (Gap %): exactly the two rows', async () => {
    await mountOnFirstRow('big', { defaultColCfg: WITH_GAP })
    await press()
    expect(rerendered()).toEqual(['S0', 'S1'])
  })
})

describe('a small list', () => {
  beforeEach(() => { hoisted.prebuilt = [{ id: 'small', name: 'Small', items: mkItems(SMALL, 'D') }] })

  it('R3 default columns: exactly the two rows', async () => {
    const { mounted } = await mountOnFirstRow('small')
    expect(mounted).toHaveLength(SMALL)
    await press()                                      // D0 -> D1
    expect(rerendered()).toEqual(['D0', 'D1'])
  })

  it('R4 with a library column (Gap %): exactly the two rows', async () => {
    await mountOnFirstRow('small', { defaultColCfg: WITH_GAP })
    await press()
    expect(rerendered()).toEqual(['D0', 'D1'])
  })

  it('R5 a library cell shows its new value when its input changes, on the next render', async () => {
    const { container } = await mountOnFirstRow('small', { defaultColCfg: WITH_GAP })
    const gapCell = (sym) => {
      const row = container.querySelector(`[data-watch-sym="${sym}"]`)
      return [...row.children].pop().textContent     // Gap % is the last column
    }
    expect(gapCell('D5')).toBe('—')                    // no quote yet
    hoisted.prices = { D5: { price: 11, day_open: 11, prev_close: 10 } }   // opened 10% up
    await press()                                      // any render reads the new quotes
    expect(gapCell('D5')).toBe('+10.00%')
    expect(rerendered()).toEqual(expect.arrayContaining(['D0', 'D1', 'D5']))
    expect(rerendered()).toHaveLength(3)               // D5 because its cell changed; the two by selection
  })
})
