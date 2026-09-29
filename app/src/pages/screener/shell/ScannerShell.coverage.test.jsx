import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'

/**
 * TERM-047 — the screener shell renders the APPLIED SCAN FILTER's own four-count
 * receipt, through S8's CoverageLine, beside the rows that filter produced.
 *
 * WHY HERE. A `My Scans` filter joins the screen to that scan's last sweep, so
 * a symbol the sweep could not compute is silently missing from the rows. The
 * backend already returns all four counts (`/api/screener/meta` → the scan
 * category's `scans[].latest`), and until this change the only thing that showed
 * them was the filter chip — three of the four, with `not computable` dropped.
 *
 * Asserted by RENDERED TEXT, never by state: the defect class this guards is a
 * member reading a quiet market where the truth is missing data, and only the
 * words on screen can show whether that happens.
 *
 * AND THE SAME RULE AS THE CHIP decides which sweep may be shown — the join
 * applied on this request AND the meta's latest is that same sweep. Two of the
 * cases below exist only to prove a stale or unapplied receipt draws nothing.
 */

const { scanMock, SAVED } = vi.hoisted(() => ({
  scanMock: vi.fn(),
  SAVED: { saved: [], starters: [], create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}))

// ONE stable meta object per test: ScannerShell's `viewColumnsFor` is memoized
// on `[meta]`, so a fresh literal per render would defeat that memo.
let metaState = { meta: undefined, isLoading: true }

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../hooks/useScreenerMeta', () => ({ default: () => metaState }))
vi.mock('../hooks/useScreenerScan', () => ({ default: scanMock }))
vi.mock('../hooks/useSavedScreens', () => ({ default: () => SAVED }))
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('./csvExport', () => ({ exportScreen: vi.fn() }))
vi.mock('../../../components/TickerPopup', () => ({ default: ({ children }) => <span>{children}</span> }))
vi.mock('../../../components/TickerActions', () => ({
  default: () => null,
  useTickerActions: () => ({ longPressProps: () => ({}), menu: null, closeMenu: () => {} }),
}))
vi.mock('../../../components/PatternFeedbackChip', () => ({ default: () => null }))

import ScannerShell from './ScannerShell'

const HASH = 'sha256:0123456789abcdef0123456789abcdef'
const SWEPT = '20260926'

/** The meta the server sends when the member has one saved scan. */
const metaWith = (latest) => ({
  categories: [{ key: 'descriptive', label: 'Descriptive' }, { key: 'my_scans', label: 'My Scans' }],
  filters: [{
    key: 'scan', label: 'My Scans', category: 'my_scans', type: 'enum', allow_custom: false,
    unit: null, presets: [{ label: 'Any' }, { label: 'Breakout', op: 'in', value: HASH }],
    scans: [{ def_hash: HASH, name: 'Breakout', latest }],
  }],
  views: [{ key: 'overview', label: 'Overview', columns: ['ticker', 'company', 'price'] }],
})

/** A scan response whose rows were filtered by that saved scan. */
const scanned = (scanJoins, total = 0, rows = []) => ({
  result: { total, rows, page: 1, view: 'overview', view_columns: ['ticker', 'company', 'price'],
    snapshot_date: '2026-09-26', scan_joins: scanJoins },
  isLoading: false,
  error: null,
})

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
  scanMock.mockReset()
})

describe('TERM-047 — the applied scan filter shows its own coverage receipt', () => {
  it('renders all FOUR counts from the backend receipt, labelled with the sweep', () => {
    metaState = { meta: metaWith({ as_of: SWEPT, evaluated: 3742, answered: 3620, dropped: 2,
      not_computable: 120 }), isLoading: false }
    scanMock.mockReturnValue(scanned([{ def_hash: HASH, as_of: SWEPT, applied: true }], 1,
      [{ ticker: 'AAA', company: 'Aaa Inc', price: 10 }]))
    render(<ScannerShell />)

    const block = screen.getByTestId('scan-join-coverage')
    expect(within(block).getByText('Scan filter: Breakout — swept 2026-09-26')).toBeInTheDocument()
    const line = within(block).getByTestId('coverage-line')
    // All four, never collapsed — `not computable` is the one the chip dropped.
    expect(line.textContent).toBe('3,742 evaluated·3,620 answered·2 dropped·120 not computable')
  })

  it('says "not a quiet market" when the scan could answer nothing for want of data', () => {
    // The real-universe failure CoverageLine was written for: rs_rank NULL
    // everywhere, so the sweep answered 0 and the filtered screen is EMPTY.
    metaState = { meta: metaWith({ as_of: SWEPT, evaluated: 3742, answered: 0, dropped: 0,
      not_computable: 3742 }), isLoading: false }
    scanMock.mockReturnValue(scanned([{ def_hash: HASH, as_of: SWEPT, applied: true }]))
    render(<ScannerShell />)

    expect(screen.getByText(/no stocks match the current filters/i)).toBeInTheDocument()
    const nodata = within(screen.getByTestId('scan-join-coverage')).getByTestId('coverage-nodata')
    expect(nodata.textContent).toContain('No symbol could be answered.')
    expect(nodata.textContent).toContain('3,742 of 3,742 are missing the data this screen needs')
    expect(nodata.textContent).toContain('not a quiet market')
  })

  it('REFUSES a receipt whose arithmetic does not close — on this surface', () => {
    // CoverageLine's refusal, seen to fire where it is now adopted (spec: "the
    // arithmetic refusal is seen to fire"). 100 + 2 + 3 is not 3,742.
    metaState = { meta: metaWith({ as_of: SWEPT, evaluated: 3742, answered: 100, dropped: 2,
      not_computable: 3 }), isLoading: false }
    scanMock.mockReturnValue(scanned([{ def_hash: HASH, as_of: SWEPT, applied: true }]))
    render(<ScannerShell />)

    const broken = within(screen.getByTestId('scan-join-coverage')).getByRole('alert')
    expect(broken.textContent).toContain('coverage does not add up')
    expect(broken.textContent).toContain('100 answered + 2 dropped + 3 not computable is not 3,742')
    expect(broken.textContent).toContain('cannot be trusted')
  })

  it('draws NOTHING for a stale meta — a different sweep\'s counts never sit beside these rows', () => {
    metaState = { meta: metaWith({ as_of: '20260925', evaluated: 3742, answered: 3620, dropped: 2,
      not_computable: 120 }), isLoading: false }
    scanMock.mockReturnValue(scanned([{ def_hash: HASH, as_of: SWEPT, applied: true }]))
    render(<ScannerShell />)
    expect(screen.queryByTestId('scan-join-coverage')).toBeNull()
    expect(screen.queryByTestId('coverage-line')).toBeNull()
  })

  it('draws NOTHING for a join that did not apply, or a screen with no scan filter', () => {
    metaState = { meta: metaWith(null), isLoading: false }
    scanMock.mockReturnValue(scanned([{ def_hash: HASH, as_of: null, applied: false }]))
    const { unmount } = render(<ScannerShell />)
    expect(screen.queryByTestId('scan-join-coverage')).toBeNull()
    unmount()

    // A plain screen: the wire carries no four-count receipt, and none is invented.
    metaState = { meta: metaWith({ as_of: SWEPT, evaluated: 10, answered: 10, dropped: 0,
      not_computable: 0 }), isLoading: false }
    scanMock.mockReturnValue(scanned([]))
    render(<ScannerShell />)
    expect(screen.queryByTestId('scan-join-coverage')).toBeNull()
  })
})
