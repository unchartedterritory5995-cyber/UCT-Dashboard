// The joystick hub's wiring into the Focus list (spec §10), with the hub section stubbed so the
// test can drive its cursor and its screens door directly, and the hub's eligibility gate
// (useHubEligible, the one its own mount reads) switchable per test.
import { useState } from 'react'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi, beforeEach, expect, test } from 'vitest'

const hub = vi.hoisted(() => ({ args: null, setIndex: null, index: 0, eligible: false }))
vi.mock('../../../../hub/useHubActive', () => ({ useHubEligible: () => hub.eligible, default: () => hub.eligible }))
vi.mock('../../../../hub/sections/screenerSection', () => ({
  default: function useScreenerHubSectionStub(args) {
    hub.args = args
    // Like the real cursor: it follows its TICKER when the list changes, and scrubTo(delta)
    // is the only way to set it.
    const rows = args.displayRows
    const n = rows.length
    const [ticker, setTicker] = useState(null)
    const found = rows.findIndex(r => r.ticker === ticker)
    const index = found >= 0 ? found : 0
    const setIndex = i => setTicker(rows[i]?.ticker ?? null)
    hub.setIndex = setIndex
    hub.index = index
    return {
      resultsRef: { current: null },
      hubMount: <div data-testid="hub-mount" />,
      cursor: {
        index,
        scrubTo: d => setIndex(Math.round(d * (n - 1))),
        itemProps: i => (i === index ? { 'data-hub-cursor': 'active' } : {}),
      },
    }
  },
}))
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {} }))
import FocusScreener from '../FocusScreener'

const META = { filters: [], categories: [], views: [{ key: 'overview', columns: ['ticker', 'price'] }] }
const row = t => ({ ticker: t, price: 1, chg_pct_1d: 0, base_render: 'Flat Base', vol_ratio: 1 })
let ROWS = [row('MU'), row('ECO'), row('AMD')]
function route(url) {
  if (url.startsWith('/api/screener/meta')) return { ok: true, json: async () => META }
  if (url === '/api/screener/scan') return { ok: true, json: async () => ({ rows: ROWS, total: ROWS.length, page: 1 }) }
  if (url === '/api/screener/count') return { ok: true, json: async () => ({ count: ROWS.length }) }
  if (url.startsWith('/api/screener/saved-screens')) return { ok: true, json: async () => ({ saved: [], starters: [] }) }
  return { ok: false, status: 404, json: async () => ({}) }
}
beforeEach(() => {
  hub.eligible = false
  ROWS = [row('MU'), row('ECO'), row('AMD')]
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  globalThis.fetch = vi.fn(async u => route(String(u)))
})
const mount = () => render(<MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><FocusScreener /></SWRConfig></MemoryRouter>)
const chartSym = () => screen.getByTestId('stockchart').getAttribute('data-sym')
const newScreen = () => {
  fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
  fireEvent.click(screen.getByRole('button', { name: /Universe: All stocks/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'UCT Universe' }))
}

test('the list registers the rows as shown and mounts the hub', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  expect(hub.args.displayRows.map(r => r.ticker)).toEqual(['MU', 'ECO', 'AMD'])
  expect(typeof hub.args.loadMore).toBe('function')
  expect(screen.getByTestId('hub-mount')).toBeInTheDocument()
})
test("the hub's screens door opens the screen menu", async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  expect(screen.queryByRole('dialog', { name: 'Screens' })).toBeNull()
  act(() => hub.args.onOpenScans())
  expect(screen.getByRole('dialog', { name: 'Screens' })).toBeInTheDocument()
})
test('desktop (hub not eligible): no row carries the hub cursor, and the hub index never moves the selection', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  expect(document.querySelector('[data-hub-cursor]')).toBeNull()
  act(() => hub.setIndex(2))
  await new Promise(r => setTimeout(r, 50))
  expect(chartSym()).toBe('MU')
  // and the member's own move is not written into the hub
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
  expect(chartSym()).toBe('ECO')
  expect(hub.index).toBe(2)
})
test('eligible: the hub cursor moves the selection, arrowing moves the hub cursor', async () => {
  hub.eligible = true
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  expect(screen.getByTestId('focus-row-MU')).toHaveAttribute('data-hub-cursor', 'active')
  act(() => hub.setIndex(2))
  await waitFor(() => expect(chartSym()).toBe('AMD'))
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowUp' })
  expect(chartSym()).toBe('ECO')
  await waitFor(() => expect(hub.index).toBe(1))
  expect(screen.getByTestId('focus-row-ECO')).toHaveAttribute('data-hub-cursor', 'active')
})
test('eligible: a new screen puts both the selection and the hub cursor on row 0', async () => {
  hub.eligible = true
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
  await waitFor(() => expect(hub.index).toBe(1))
  // The new screen still holds ECO, further down; a cursor that follows its ticker would stay on it.
  ROWS = [row('ZZZ'), row('YYY'), row('ECO')]
  newScreen()
  await waitFor(() => expect(chartSym()).toBe('ZZZ'))
  await waitFor(() => expect(hub.index).toBe(0))
  expect(chartSym()).toBe('ZZZ')
})
