import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('./hooks/useScreenerMeta', () => ({
  default: () => ({ meta: {
    categories: [{ key: 'technical', label: 'Technical' }],
    filters: [{ key: 'rsi14', label: 'RSI (14)', category: 'technical', type: 'range',
      allow_custom: true, presets: [{ label: 'Any' }] }],
    views: [{ key: 'overview', label: 'Overview', columns: ['ticker', 'price'] }] } }),
}))
vi.mock('./hooks/useScreenerScan', () => ({
  default: () => ({ result: {
    total: 1, view: 'overview', view_columns: ['ticker', 'price'],
    rows: [{ ticker: 'AAA', price: 10 }], snapshot_date: '2026-06-19' }, isLoading: false }),
}))
vi.mock('./hooks/useSavedScreens', () => ({
  default: () => ({ saved: [], starters: [], create: vi.fn(), remove: vi.fn() }),
}))
vi.mock('../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../components/TickerPopup', () => ({ default: ({ children, sym }) => <span>{children || sym}</span> }))
vi.mock('../../components/TickerActions', () => ({
  default: () => null,
  useTickerActions: () => ({ menu: null, closeMenu: () => {}, longPressProps: () => ({}) }),
}))

import ScannerPro from './ScannerPro'

// Resolve any stray relative-URL fetch (prefetch warmers, ticker-meta) so jsdom
// doesn't raise an unhandled URL-parse error after the test completes.
beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})

test('renders filter panel and results', async () => {
  render(<ScannerPro />)
  await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument())
  expect(screen.getByText('RSI (14)')).toBeInTheDocument()
  expect(screen.getByText(/1 matches/)).toBeInTheDocument()
})
