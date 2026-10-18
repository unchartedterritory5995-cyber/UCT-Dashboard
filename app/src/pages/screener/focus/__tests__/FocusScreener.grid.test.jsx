// FocusScreener.grid.test.jsx — the Charts view: the screen's results on the /charts Multi-Chart grid.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi, beforeEach, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../ScreenerChartWidget', () => ({ default: p => <div data-testid="pane-chart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: p => <div data-testid="table-mode">{p.toolbarLead}</div> }))
// The grid is /charts' own; what is under test here is the board the screener hands it.
vi.mock('../../../charts/grid/MultiChartGrid', () => ({
  default: ({ mc }) => (
    <div data-testid="multichart" data-layout={mc.state.layout}>
      {mc.state.cells.map(c => <span key={c.id} data-testid="grid-cell" data-id={c.id}>{c.sym || ''}</span>)}
    </div>
  ),
}))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
import FocusScreener from '../FocusScreener'

const META = { filters: [{ key: 'rs_rank', label: 'RS Rank', category: 'technical', type: 'range', presets: [{ label: 'Any' }] }],
  categories: [{ key: 'technical', label: 'Technical' }], views: [{ key: 'overview', columns: ['ticker', 'price'] }] }
const mkRows = n => Array.from({ length: n }, (_, i) => ({ ticker: `S${i}`, price: 10 + i, chg_pct_1d: 0, base_render: 'Flat Base', vol_ratio: 1 }))
let scanRows = mkRows(12)
function route(url) {
  if (url.startsWith('/api/screener/meta')) return { ok: true, json: async () => META }
  if (url === '/api/screener/scan') return { ok: true, json: async () => ({ rows: scanRows, total: scanRows.length, page: 1, snapshot_date: '2026-10-16' }) }
  if (url === '/api/screener/count') return { ok: true, json: async () => ({ count: scanRows.length }) }
  if (url.startsWith('/api/screener/saved-screens')) return { ok: true, json: async () => ({ saved: [], starters: [] }) }
  if (url.startsWith('/api/screener/to-watchlist') || url.startsWith('/api/screener/save-fork') || url.startsWith('/api/exports/quota')) {
    return { ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) }
  }
  return { ok: true, json: async () => ([]) }
}
beforeEach(() => {
  scanRows = mkRows(12)
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  globalThis.fetch = vi.fn(async u => route(String(u)))
})
const mount = () => render(<MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><FocusScreener /></SWRConfig></MemoryRouter>)
const cellSyms = () => screen.getAllByTestId('grid-cell').map(c => c.textContent)

test('Charts puts the results on the grid, in list order, and back to List restores the list', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-S0'))
  fireEvent.click(screen.getByRole('button', { name: 'Charts' }))
  await screen.findByTestId('multichart')
  expect(cellSyms()).toEqual(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'])
  expect(screen.getByTestId('multichart')).toHaveAttribute('data-layout', '3x3')
  expect(localStorage.getItem('uct.screener.layout')).toBe('grid')
  // One board: the list and its side chart are not mounted behind the grid.
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(screen.queryByTestId('pane-chart')).toBeNull()
  expect(screen.getByText(/1–9 of 12/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'List' }))
  await waitFor(() => screen.getByTestId('focus-row-S0'))
  expect(screen.queryByTestId('multichart')).toBeNull()
})

test('Next turns the page onto the next results; Prev turns back', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-S0'))
  fireEvent.click(screen.getByRole('button', { name: 'Charts' }))
  await screen.findByTestId('multichart')
  expect(screen.getByRole('button', { name: 'Previous charts' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Next charts' }))
  expect(cellSyms()).toEqual(['S9', 'S10', 'S11', '', '', '', '', '', ''])
  expect(screen.getByText(/10–12 of 12/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Next charts' })).toBeDisabled()
  fireEvent.keyDown(window, { key: 'PageUp' })
  expect(cellSyms()[0]).toBe('S0')
})

test('the charts-per-page choice is kept, and the view reopens as Charts', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-S0'))
  fireEvent.click(screen.getByRole('button', { name: 'Charts' }))
  await screen.findByTestId('multichart')
  fireEvent.click(screen.getByRole('button', { name: '2×2' }))
  expect(screen.getByTestId('multichart')).toHaveAttribute('data-layout', '2x2')
  expect(cellSyms()).toEqual(['S0', 'S1', 'S2', 'S3'])
  expect(localStorage.getItem('uct.screener.gridLayout')).toBe('2x2')
})

test('a member who left on Charts lands on Charts', async () => {
  localStorage.setItem('uct.screener.layout', 'grid')
  mount()
  await screen.findByTestId('multichart')
  expect(screen.getByRole('button', { name: 'Charts' })).toHaveAttribute('aria-pressed', 'true')
})
