// The joystick hub's wiring into the Focus list (spec §10), with the hub section stubbed so the
// test can drive its cursor and its screens door directly.
import { useState } from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi, beforeEach, expect, test } from 'vitest'

const hub = vi.hoisted(() => ({ args: null, setIndex: null }))
vi.mock('../../../../hub/sections/screenerSection', () => ({
  default: function useScreenerHubSectionStub(args) {
    hub.args = args
    const [index, setIndex] = useState(0)
    hub.setIndex = setIndex
    return {
      resultsRef: { current: null },
      hubMount: <div data-testid="hub-mount" />,
      cursor: { index, itemProps: i => (i === index ? { 'data-hub-cursor': 'active' } : {}) },
    }
  },
}))
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {} }))
import FocusScreener from '../FocusScreener'

const META = { filters: [], categories: [], views: [{ key: 'overview', columns: ['ticker', 'price'] }] }
const ROWS = [{ ticker: 'MU', price: 1, chg_pct_1d: 0, base_render: 'Flat Base', vol_ratio: 1 },
  { ticker: 'ECO', price: 2, chg_pct_1d: 0, base_render: 'Gap-up', vol_ratio: 1 }]
function route(url) {
  if (url.startsWith('/api/screener/meta')) return { ok: true, json: async () => META }
  if (url === '/api/screener/scan') return { ok: true, json: async () => ({ rows: ROWS, total: 2, page: 1 }) }
  if (url === '/api/screener/count') return { ok: true, json: async () => ({ count: 2 }) }
  if (url.startsWith('/api/screener/saved-screens')) return { ok: true, json: async () => ({ saved: [], starters: [] }) }
  return { ok: false, status: 404, json: async () => ({}) }
}
beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  globalThis.fetch = vi.fn(async u => route(String(u)))
})
const mount = () => render(<MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><FocusScreener /></SWRConfig></MemoryRouter>)

test('the list registers the rows as shown, carries the cursor props and mounts the hub', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  expect(hub.args.displayRows.map(r => r.ticker)).toEqual(['MU', 'ECO'])
  expect(typeof hub.args.loadMore).toBe('function')
  expect(screen.getByTestId('focus-row-MU')).toHaveAttribute('data-hub-cursor', 'active')
  expect(screen.getByTestId('hub-mount')).toBeInTheDocument()
})
test('the selection follows the hub cursor', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  act(() => hub.setIndex(1))
  await waitFor(() => expect(screen.getByTestId('stockchart')).toHaveAttribute('data-sym', 'ECO'))
})
test("the hub's screens door opens the screen menu", async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  expect(screen.queryByRole('dialog', { name: 'Screens' })).toBeNull()
  act(() => hub.args.onOpenScans())
  expect(screen.getByRole('dialog', { name: 'Screens' })).toBeInTheDocument()
})
