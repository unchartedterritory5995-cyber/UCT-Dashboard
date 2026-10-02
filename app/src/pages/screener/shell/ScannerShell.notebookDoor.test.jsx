// G-040 ruling 1 — the Screener page's "Save to Notebook" control, in the REAL
// shell (same harness as ScannerShell.test.jsx). The door's send is the one seam
// mocked here: the capture it is handed is the thing under test, and the send path
// itself is railed by lib/offline/doorFamilies.settle.test.jsx.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { META, SAVED, scanMock, sendMock } = vi.hoisted(() => ({
  META: {
    categories: [{ key: 'descriptive', label: 'Descriptive' }],
    filters: [{ key: 'price', label: 'Price', category: 'descriptive',
      type: 'range', allow_custom: true, presets: [{ label: 'Any' }] }],
    views: [
      { key: 'overview', label: 'Overview', columns: ['ticker', 'company', 'price', 'chg_pct_1d'] },
    ],
  },
  SAVED: { saved: [], starters: [], create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  scanMock: vi.fn(),
  sendMock: vi.fn(async () => 'Screener results sent to “Plan”'),
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../hooks/useScreenerMeta', () => ({ default: () => ({ meta: META, isLoading: false }) }))
vi.mock('../hooks/useScreenerScan', () => ({ default: scanMock }))
vi.mock('../hooks/useSavedScreens', () => ({ default: () => SAVED }))
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: { AAA: { price: 10.5, change_pct: 5 } } }) }))
vi.mock('./csvExport', () => ({ exportScreen: vi.fn() }))
vi.mock('../../../components/TickerPopup', () => ({ default: ({ children }) => <span>{children}</span> }))
vi.mock('../../../components/TickerActions', () => ({
  default: () => null,
  useTickerActions: () => ({ longPressProps: () => ({}), menu: null, closeMenu: () => {} }),
}))
vi.mock('../../../components/PatternFeedbackChip', () => ({ default: () => null }))
vi.mock('../../journal-2-0/lib/sendToJournal', () => ({ sendCaptureToJournal: sendMock }))

import ScannerShell from './ScannerShell'

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
  scanMock.mockReset()
  sendMock.mockClear()
})

const READY = { result: { total: 2, rows: [{ ticker: 'AAA', company: 'Aaa Corp', price: 10, chg_pct_1d: 1 },
  { ticker: 'BBB', company: 'Bbb Inc', price: 20, chg_pct_1d: -1 }], page: 1, snapshot_date: '2026-08-21' },
  isLoading: false, error: null }

describe('Screener — Save to Notebook (G-040)', () => {
  it('is a real, named button that freezes the result set as shown', async () => {
    scanMock.mockReturnValue(READY)
    render(<ScannerShell />)
    const btn = screen.getByRole('button', { name: 'Save these screener results to Notebook' })
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.getAttribute('type')).toBe('button')
    expect(btn).not.toBeDisabled()

    fireEvent.click(btn)
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))
    const [widgetId, capture, opts] = sendMock.mock.calls[0]
    expect(widgetId).toBe('screener')
    expect(opts).toEqual({ label: 'Screener results' })
    expect(capture.name).toBe('Screener — All Market')
    expect(capture.total).toBe(2)
    expect(capture.asOf).toBe('2026-08-21 03:00 ET (nightly build)')
    expect(capture.columns.map((c) => c.key)).toEqual(['ticker', 'company', 'price', 'chg_pct_1d'])
    // AAA's price/change are the LIVE values the table painted, not the snapshot's.
    expect(capture.rows).toEqual([
      { ticker: 'AAA', cells: ['AAA', 'Aaa Corp', '$10.50', '+5.0%'] },
      { ticker: 'BBB', cells: ['BBB', 'Bbb Inc', '$20.00', '-1.0%'] },
    ])
    // The member is told where it went (the shared toast).
    expect(await screen.findByText('Screener results sent to “Plan”')).toBeInTheDocument()
  })

  it('an EMPTY result is still saveable — zero matches is a fact the capture carries', async () => {
    scanMock.mockReturnValue({ result: { total: 0, rows: [], page: 1, snapshot_date: '2026-08-21' }, isLoading: false, error: null })
    render(<ScannerShell />)
    fireEvent.click(screen.getByRole('button', { name: 'Save these screener results to Notebook' }))
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))
    expect(sendMock.mock.calls[0][1]).toMatchObject({ rows: [], total: 0 })
  })

  it('is disabled until a result has landed — there is nothing to freeze yet', () => {
    scanMock.mockReturnValue({ result: null, isLoading: true, error: null })
    render(<ScannerShell />)
    expect(screen.getByRole('button', { name: 'Save these screener results to Notebook' })).toBeDisabled()
  })
})
