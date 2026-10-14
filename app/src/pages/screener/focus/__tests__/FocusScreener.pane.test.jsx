// Task 5, page level: the pane hands focus back to the list after its actions and forwards ↑/↓
// (B7), the flagged actions sit in the list head (B13), and live ticks do not re-render the chart (S5).
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi, beforeEach, expect, test } from 'vitest'

const chart = vi.hoisted(() => ({ renders: 0 }))
const live = vi.hoisted(() => ({ prices: {}, set: null }))
vi.mock('../../../../components/StockChart', () => {
  const note = () => { chart.renders += 1 }
  return { default: function StockChart(p) { note(); return <div data-testid="stockchart" data-sym={p.sym} /> } }
})
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', async () => {
  const React = await import('react')
  const keep = setP => { live.set = setP }
  function useRealtimePrices() { const [p, setP] = React.useState(live.prices); keep(setP); return { prices: p } }
  return { default: useRealtimePrices }
})
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {} }))
import FocusScreener from '../FocusScreener'

const META = { filters: [], categories: [], views: [{ key: 'overview', columns: ['ticker', 'price'] }] }
const rows = [{ ticker: 'MU', price: 956.12, chg_pct_1d: -3.7, base_render: 'Flat Base', vol_ratio: 0.8 },
  { ticker: 'ECO', price: 99.48, chg_pct_1d: 0.9, base_render: 'Gap-up', vol_ratio: 1 },
  { ticker: 'AAA', price: 10, chg_pct_1d: 0.1, base_render: 'Flat Base', vol_ratio: 1 }]
beforeEach(() => {
  chart.renders = 0
  live.prices = {}
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  globalThis.fetch = vi.fn(async u => {
    const url = String(u)
    if (url.startsWith('/api/screener/meta')) return { ok: true, json: async () => META }
    if (url === '/api/screener/scan') return { ok: true, json: async () => ({ rows, total: rows.length, page: 1 }) }
    if (url.startsWith('/api/screener/saved-screens')) return { ok: true, json: async () => ({ saved: [], starters: [] }) }
    return { ok: true, json: async () => ([]) }
  })
})
const mount = async () => {
  render(<MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><FocusScreener /></SWRConfig></MemoryRouter>)
  await waitFor(() => screen.getByTestId('focus-row-MU'), { timeout: 5000 })
}
const charted = () => screen.getByTestId('stockchart').dataset.sym

test('B7: after Flag in the pane, focus is back on the list and ↓ keeps stepping', async () => {
  await mount()
  fireEvent.click(screen.getByRole('button', { name: 'Flag' }))
  expect(document.activeElement).toBe(screen.getByRole('listbox'))
  fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
  expect(charted()).toBe('ECO')
}, 10000)
test('B7: after Add to watchlist in the pane, focus is back on the list', async () => {
  await mount()
  fireEvent.click(screen.getByRole('button', { name: 'Add to watchlist' }))
  expect(document.activeElement).toBe(screen.getByRole('listbox'))
  await screen.findByTestId('focus-toast')   // let the add settle before the test tears down
}, 10000)
test('B7: ↑/↓ pressed on the chart step the list and return focus to it', async () => {
  await mount()
  const paneEl = screen.getByTestId('focus-chart-pane')
  paneEl.focus()   // a click on the canvas lands focus on the pane
  fireEvent.keyDown(screen.getByTestId('stockchart'), { key: 'ArrowDown' })
  expect(charted()).toBe('ECO')
  expect(document.activeElement).toBe(screen.getByRole('listbox'))
  fireEvent.keyDown(paneEl, { key: 'ArrowDown' })
  fireEvent.keyDown(paneEl, { key: 'ArrowUp' })
  expect(charted()).toBe('ECO')
}, 10000)
test('B13: the first flag shows its actions inside the list head, not in a new row above the list', async () => {
  await mount()
  expect(screen.queryByRole('button', { name: /Flagged/ })).toBeNull()
  const head = screen.getByText('1 of 3').closest('[class*="listHead"]')
  expect(head).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'F', shiftKey: true })
  const flagged = await screen.findByRole('button', { name: /Flagged/ })
  expect(head.contains(flagged)).toBe(true)
  expect(within(head).getByText('1 of 3')).toBeInTheDocument()
  // nothing was inserted between the top bar and the list
  const body = screen.getByRole('listbox').closest('[class*="body"]')
  expect(body.previousElementSibling?.querySelector('button[aria-haspopup="true"]') || null).toBeNull()
}, 10000)
test('S5: live ticks for other stocks, and for the charted one, never re-render the chart', async () => {
  await mount()
  const before = chart.renders
  act(() => { live.set({ ECO: { price: 100, change_pct: 1 } }) })
  act(() => { live.set({ ECO: { price: 101, change_pct: 2 }, AAA: { price: 11, change_pct: 3 } }) })
  act(() => { live.set({ ECO: { price: 101, change_pct: 2 }, MU: { price: 960.5, change_pct: 0.5 } }) })
  act(() => { live.set({ ECO: { price: 102, change_pct: 2 }, MU: { price: 961.5, change_pct: 0.6 } }) })
  expect(within(screen.getByTestId('focus-chart-pane')).getByText('961.50')).toBeInTheDocument()
  expect(chart.renders).toBe(before)
}, 10000)
