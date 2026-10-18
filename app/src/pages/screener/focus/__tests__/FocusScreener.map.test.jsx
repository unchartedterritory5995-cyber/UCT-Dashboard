// FocusScreener.map.test.jsx — the Map view: the screen's results as a market-cap treemap.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi, beforeEach, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../ScreenerChartWidget', () => ({ default: p => <div data-testid="pane-chart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: p => <div data-testid="table-mode">{p.toolbarLead}</div> }))
// The canvas is ECharts'; the stub draws each tile as a button that fires the chart's click event.
vi.mock('echarts-for-react', () => ({
  default: ({ option, onEvents }) => (
    <div data-testid="treemap">
      {option.series[0].data.map(g => (
        <div key={g.name} data-testid="map-group" data-name={g.name}>
          {g.children.map(c => <button key={c.ticker} type="button" data-testid={`tile-${c.ticker}`} data-tier={c.tier}
            onClick={() => onEvents.click({ data: c })}>{c.ticker}</button>)}
        </div>
      ))}
    </div>
  ),
}))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
import FocusScreener from '../FocusScreener'

const META = { filters: [{ key: 'rs_rank', label: 'RS Rank', category: 'technical', type: 'range', presets: [{ label: 'Any' }] }],
  categories: [{ key: 'technical', label: 'Technical' }], views: [{ key: 'overview', columns: ['ticker', 'price'] }] }
const mkRows = n => Array.from({ length: n }, (_, i) => ({ ticker: `S${i}`, price: 10 + i, chg_pct_1d: i % 2 ? -3 : 5, market_cap: (n - i) * 1e9,
  sector: i < 3 ? 'Technology' : 'Energy', base_render: 'Flat Base', vol_ratio: 1 }))
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

test('Map draws the results grouped by sector; a tile opens that stock on the List', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-S0'))
  fireEvent.click(screen.getByRole('button', { name: 'Map' }))
  await screen.findByTestId('treemap')
  expect(localStorage.getItem('uct.screener.layout')).toBe('map')
  expect(screen.getAllByTestId('map-group').map(g => g.dataset.name)).toEqual(['Energy', 'Technology'])
  expect(screen.getByTestId('tile-S0')).toHaveAttribute('data-tier', 'g3')
  expect(screen.getByTestId('tile-S1')).toHaveAttribute('data-tier', 'r2')
  expect(screen.queryByRole('listbox')).toBeNull()
  fireEvent.click(screen.getByTestId('tile-S4'))
  await waitFor(() => screen.getByTestId('focus-row-S0'))
  expect(screen.getByTestId('pane-chart')).toHaveAttribute('data-sym', 'S4')
  expect(screen.getByTestId('focus-row-S4')).toHaveAttribute('aria-selected', 'true')
})

test('the grouping choice is kept; Theme groups by the batched theme read', async () => {
  globalThis.fetch = vi.fn(async (u) => (String(u) === '/api/watchlists/themes-batch'
    ? { ok: true, json: async () => ({ results: { S0: 'AI Compute', S1: 'AI Compute' } }) } : route(String(u))))
  mount()
  await waitFor(() => screen.getByTestId('focus-row-S0'))
  fireEvent.click(screen.getByRole('button', { name: 'Map' }))
  await screen.findByTestId('treemap')
  fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
  expect(localStorage.getItem('uct.screener.mapGroup')).toBe('theme')
  await waitFor(() => expect(screen.getAllByTestId('map-group').map(g => g.dataset.name)).toEqual(['No theme', 'AI Compute']))
})
