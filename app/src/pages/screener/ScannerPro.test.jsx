import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

// These mock returns are hoisted to stable module constants ON PURPOSE. ScannerPro
// accumulates pages via `useEffect(..., [result])`, so a mock that builds a fresh
// object literal per call gives `result` a new identity every render and re-fires
// the effect forever — appending rows each pass until the V8 heap dies. The real
// useScreenerScan holds `result` in useState (stable identity) and returns `page`,
// so this is a fixture-only hazard, not a production one. Keep these frozen.
// vi.hoisted so the constants exist before the hoisted vi.mock factories run.
const { META, SCAN, SAVED } = vi.hoisted(() => ({
  META: { meta: {
    categories: [{ key: 'technical', label: 'Technical' }],
    filters: [{ key: 'rsi14', label: 'RSI (14)', category: 'technical', type: 'range',
      allow_custom: true, presets: [{ label: 'Any' }] }],
    views: [{ key: 'overview', label: 'Overview', columns: ['ticker', 'price'] }] } },
  SCAN: { result: {
    total: 1, page: 1, view: 'overview', view_columns: ['ticker', 'price'],
    rows: [{ ticker: 'AAA', price: 10 }], snapshot_date: '2026-06-19' }, isLoading: false },
  SAVED: { saved: [], starters: [], create: vi.fn(), remove: vi.fn() },
}))

vi.mock('./hooks/useScreenerMeta', () => ({ default: () => META }))
vi.mock('./hooks/useScreenerScan', () => ({ default: () => SCAN }))
vi.mock('./hooks/useSavedScreens', () => ({ default: () => SAVED }))
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
