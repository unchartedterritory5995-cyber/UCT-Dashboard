// The Charts view mounts the REAL /charts Multi-Chart grid (only the canvas is stubbed): the
// screener host must supply everything the grid and its cells read, or a cell renders dead.
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi, beforeEach, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({
  default: p => { p.onBarsReady?.(); return <div data-testid="stockchart" data-sym={p.sym} data-tf={p.tf} /> },
}))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchGridWarm: () => {}, prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
import ScreenerChartGrid from '../ScreenerChartGrid'
import { AuthContext } from '../../../../context/AuthContext'

beforeEach(() => {
  localStorage.clear()
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
})
const rows = n => Array.from({ length: n }, (_, i) => ({ ticker: `R${i}` }))

test('the real grid charts the first page of results through its mount queue', async () => {
  localStorage.setItem('uct.screener.gridLayout', '2x2')
  render(<MemoryRouter><AuthContext.Provider value={{ user: { role: 'member' } }}><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <ScreenerChartGrid rows={rows(6)} total={6} hasMore={false} onLoadMore={() => {}} resetKey="k" />
  </SWRConfig></AuthContext.Provider></MemoryRouter>)
  // ≤3 at once, each slot freed by onBarsReady: all four land.
  await waitFor(() => expect(screen.getAllByTestId('stockchart')).toHaveLength(4))
  expect(screen.getAllByTestId('stockchart').map(c => c.dataset.sym)).toEqual(['R0', 'R1', 'R2', 'R3'])
  expect(screen.getByText(/1–4 of 6/)).toBeInTheDocument()
})
