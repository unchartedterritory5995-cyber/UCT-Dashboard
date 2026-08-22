import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// ── hoisted, stable fixtures ────────────────────────────────────────────────
// META/SAVED must be stable OBJECT IDENTITIES across renders: ScannerShell's
// `viewColumnsFor` is memoized on `[meta]` (load-bearing — useScreenSpec's
// column stability depends on that callback keeping its identity across
// renders that don't change meta), so a mock that returns a fresh literal
// every call would defeat the memo the same way ScannerPro.test.jsx's own
// comment warns about for useScreenerScan's `result`.
const { META, SAVED, scanMock, exportMock } = vi.hoisted(() => ({
  META: {
    categories: [{ key: 'descriptive', label: 'Descriptive' }],
    filters: [{ key: 'price', label: 'Price', category: 'descriptive',
      type: 'range', allow_custom: true, presets: [{ label: 'Any' }] }],
    views: [
      { key: 'overview', label: 'Overview', columns: ['ticker', 'company', 'price', 'chg_pct_1d'] },
      { key: 'momentum', label: 'Momentum', columns: ['ticker', 'price', 'rs_rank'] },
    ],
  },
  SAVED: { saved: [], starters: [], create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  scanMock: vi.fn(),
  exportMock: vi.fn(),
}))

vi.mock('../hooks/useScreenerMeta', () => ({ default: () => ({ meta: META, isLoading: false }) }))
vi.mock('../hooks/useScreenerScan', () => ({ default: scanMock }))
vi.mock('../hooks/useSavedScreens', () => ({ default: () => SAVED }))
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('./csvExport', () => ({ exportScreen: exportMock }))
vi.mock('../../../components/TickerPopup', () => ({ default: ({ children }) => <span>{children}</span> }))
vi.mock('../../../components/TickerActions', () => ({
  default: () => null,
  useTickerActions: () => ({ longPressProps: () => ({}), menu: null, closeMenu: () => {} }),
}))
vi.mock('../../../components/PatternFeedbackChip', () => ({ default: () => null }))

import ScannerShell from './ScannerShell'

// Resolve any stray fetch (ScreensManager's useSavedScreens is mocked above,
// but prefetchBars / ticker-meta warmers still fire relative-URL fetches) so
// jsdom never raises an unhandled URL-parse error after a test completes —
// same guard as ScannerPro.test.jsx.
beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
  scanMock.mockReset()
  exportMock.mockReset()
})

const LOADING = { result: null, isLoading: true, error: null }
const EMPTY = { result: { total: 0, rows: [], page: 1, snapshot_date: '2026-08-21' }, isLoading: false, error: null }
const READY = { result: { total: 2, rows: [{ ticker: 'AAA', price: 10, chg_pct_1d: 1 },
  { ticker: 'BBB', price: 20, chg_pct_1d: -1 }], page: 1, snapshot_date: '2026-08-21' },
  isLoading: false, error: null }
const FAILED = { result: null, isLoading: false, error: new Error('scan failed') }

describe('ScannerShell', () => {
  it('shows the skeleton on first load, before any result has landed', () => {
    scanMock.mockReturnValue(LOADING)
    const { container } = render(<ScannerShell />)
    // SkeletonTable renders a grid of shimmer-line rows via Skeleton.module.css
    // (`.table` > N `.tableRow` > cols `.line`s) — no literal "loading" text
    // exists anywhere in the tree, so assert the structural shape instead.
    expect(container.querySelectorAll('[class*="tableRow"]').length).toBe(12)
    expect(screen.queryByText(/no stocks match/i)).not.toBeInTheDocument()
  })

  it('an empty result keeps the toolbar mounted and usable', () => {
    scanMock.mockReturnValue(EMPTY)
    render(<ScannerShell />)
    expect(screen.getByText(/no stocks match the current filters/i)).toBeInTheDocument()
    // The toolbar's view tabs are still live — not swallowed by the empty state.
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Momentum' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Momentum' }))
    // still renders the empty message under the new view — nothing crashed
    expect(screen.getByText(/no stocks match the current filters/i)).toBeInTheDocument()
  })

  it('error renders the scanError banner with Retry, which bumps _retry on the NEXT scan call', () => {
    scanMock.mockReturnValue(FAILED)
    render(<ScannerShell />)
    expect(screen.getByRole('alert')).toHaveTextContent(/scan failed — scan failed/i)
    const callsBefore = scanMock.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(scanMock.mock.calls.length).toBeGreaterThan(callsBefore)
    const lastSpec = scanMock.mock.calls.at(-1)[0]
    expect(lastSpec._retry).toBe(1)
  })

  it('the live-sort chip only appears once sort.key is live-overlaid (price/chg_pct_1d)', () => {
    scanMock.mockReturnValue(READY)
    render(<ScannerShell />)
    // Default sort is uct_composite — not live-sortable — chip absent.
    expect(screen.queryByText(/snapshot order/i)).not.toBeInTheDocument()
    const priceHeader = screen.getAllByRole('columnheader').find(h => h.textContent.includes('Price'))
    fireEvent.click(priceHeader.querySelector('button'))
    // Sorting by price is live-overlaid; liveSortOn defaults off, so the
    // "snapshot order" honesty chip must now show.
    expect(screen.getByText(/snapshot order/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /re-sort loaded rows live/i }))
      .toHaveAttribute('aria-pressed', 'false')
  })

  it('a failed export sets the loud error as a role=status, never a silent partial download', async () => {
    scanMock.mockReturnValue(READY)
    exportMock.mockRejectedValue(new Error('network down'))
    render(<ScannerShell />)
    fireEvent.click(screen.getByRole('button', { name: /csv/i }))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/export failed — nothing downloaded\. try again\./i))
    expect(exportMock).toHaveBeenCalled()
  })
})
