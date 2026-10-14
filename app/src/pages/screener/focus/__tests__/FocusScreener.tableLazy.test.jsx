// Task 7a review minor: List mode never requests Table mode's code (ScannerShell); switching to
// Table loads it once, behind the same skeleton Screener.jsx uses.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi, expect, test } from 'vitest'

const loaded = vi.hoisted(() => ({ shell: 0 }))
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => { loaded.shell += 1; return { default: p => <div data-testid="table-mode">{p.toolbarLead}</div> } })
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {} }))
import FocusScreener from '../FocusScreener'

const META = { filters: [], categories: [], views: [{ key: 'overview', columns: ['ticker', 'price'] }] }
const rows = [{ ticker: 'MU', price: 956.12, chg_pct_1d: -3.7, base_render: 'Flat Base', vol_ratio: 0.8 }]

test('List mode never loads ScannerShell; Table mode loads it on demand', async () => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  globalThis.fetch = vi.fn(async u => {
    const url = String(u)
    if (url.startsWith('/api/screener/meta')) return { ok: true, json: async () => META }
    if (url === '/api/screener/scan') return { ok: true, json: async () => ({ rows, total: 1, page: 1 }) }
    if (url.startsWith('/api/screener/saved-screens')) return { ok: true, json: async () => ({ saved: [], starters: [] }) }
    return { ok: true, json: async () => ([]) }
  })
  render(<MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><FocusScreener /></SWRConfig></MemoryRouter>)
  await waitFor(() => screen.getByTestId('focus-row-MU'), { timeout: 5000 })
  expect(loaded.shell).toBe(0)
  fireEvent.click(screen.getByRole('button', { name: 'Table' }))
  expect(await screen.findByTestId('table-mode')).toBeInTheDocument()
  expect(loaded.shell).toBe(1)
  // the List|Table switch still leads the table's own toolbar
  expect(screen.getByRole('button', { name: 'List' })).toBeInTheDocument()
}, 10000)
