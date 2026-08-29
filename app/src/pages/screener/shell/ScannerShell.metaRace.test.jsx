import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

/**
 * ⛔ THE ONE CASE EVERY OTHER ScannerShell TEST MOCKS AWAY.
 *
 * `ScannerShell.test.jsx` stubs `useScreenerMeta` to return a fully-loaded META
 * on the very first render — correctly, for what it tests — so no test in this
 * repo has ever rendered the shell while meta is still in flight. That window
 * is not hypothetical: `/api/screener/meta` is the whole filter registry and
 * the scan is a separate request, so the scan routinely wins the race.
 *
 * What the member saw when it did (measured on prod 2026-08-29, twice):
 * a fully-populated 3,745-row table rendered through ONE column —
 * `gridTemplateColumns: "127.986px"`, one cell per row — because
 * `ScannerShell` fell back to a FABRICATED `['ticker']`.
 *
 * ⛔⛔ THE ROWS AND THE COLUMNS MUST COME FROM THE SAME ANSWER. The server
 * already decides which columns it selected and says so in `view_columns`
 * (`query.py` L1170, echoed at L1280; `exportCsv.js` L35 has always read it).
 * The client re-deriving that list from `meta.views` is a second authority over
 * one value, and the fabricated fallback is what that second authority answers
 * when it does not know yet. A column list invented by the side that did NOT
 * run the query cannot be right except by coincidence.
 */

const { META, SAVED, scanMock } = vi.hoisted(() => ({
  // Stable identities — `viewColumnsFor` is memoized on [meta].
  META: {
    categories: [{ key: 'descriptive', label: 'Descriptive' }],
    filters: [],
    views: [{ key: 'overview', label: 'Overview',
      columns: ['ticker', 'company', 'price', 'chg_pct_1d'] }],
  },
  SAVED: { saved: [], starters: [], create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  scanMock: vi.fn(),
}))

let metaState = { meta: undefined, isLoading: true }

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
import { COLUMN_DEFS } from '../columnDefs'

// The server's own answer: what it selected, alongside the rows it selected.
const SERVER_COLUMNS = ['ticker', 'company', 'sector', 'price', 'chg_pct_1d', 'vol_ratio']
const SCANNED = {
  result: {
    total: 2,
    page: 1,
    view: 'overview',
    view_columns: SERVER_COLUMNS,
    rows: [
      { ticker: 'AAA', company: 'Aaa Inc', sector: 'Tech', price: 10, chg_pct_1d: 1, vol_ratio: 1.4 },
      { ticker: 'BBB', company: 'Bbb Inc', sector: 'Health', price: 20, chg_pct_1d: -1, vol_ratio: 0.8 },
    ],
    snapshot_date: '2026-08-29',
  },
  isLoading: false,
  error: null,
}

const renderedColumnCount = container => {
  const row = container.querySelector('[class*="gridRow"]')
  return row ? row.children.length : 0
}

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
  scanMock.mockReset()
  metaState = { meta: undefined, isLoading: true }
})

describe('the meta/scan race', () => {
  it('renders the columns the SERVER used when results arrive before meta', () => {
    scanMock.mockReturnValue(SCANNED)
    const { container } = render(<ScannerShell />)
    // ⛔ NOT 1. A populated table behind a single ticker column is the exact
    // picture a member reads as "this screener is broken".
    expect(renderedColumnCount(container)).toBe(SERVER_COLUMNS.length)
  })

  it("and they are the SERVER's columns by name, not six of anything", () => {
    // ⛔ A COUNT ALONE IS NOT A RENDER — six columns of the wrong thing would
    // satisfy the assertion above. The header labels are read back through
    // COLUMN_DEFS, so this pins the identity of the list, not its length.
    //
    // ⚠️ ROW BODIES ARE DELIBERATELY NOT ASSERTED HERE, AND THAT IS A HARNESS
    // LIMIT RATHER THAN AN OVERSIGHT: jsdom has no layout engine, react-virtual
    // measures a 0x0 rect and renders ZERO row windows unless `virtualOpts` is
    // injected — which `VirtualResults` accepts and its own test supplies
    // (`VirtualResults.test.jsx`, the 1200x800 stub). ScannerShell owns that
    // mount internally, so reaching the cells from here would mean adding a
    // test-only prop to production code. The cell rendering is VirtualResults'
    // claim and is covered there; what belongs HERE is which list it is handed.
    scanMock.mockReturnValue(SCANNED)
    const { container } = render(<ScannerShell />)
    const headers = [...container.querySelectorAll('[role="columnheader"]')]
      .map(h => h.textContent.trim())
    expect(headers).toEqual(
      SERVER_COLUMNS.map(c => COLUMN_DEFS[c]?.label || c))
  })

  it('once meta lands, the member\'s view choice still wins over the echo', () => {
    // The fallback must stay a FALLBACK: with meta known, the shell keeps
    // deriving from the view (that is what makes the Columns picker work).
    metaState = { meta: META, isLoading: false }
    scanMock.mockReturnValue(SCANNED)
    const { container } = render(<ScannerShell />)
    expect(renderedColumnCount(container)).toBe(META.views[0].columns.length)
  })

  it('falls back to ticker only when NOBODY has answered yet', () => {
    // No meta and no result — the fabricated list is correct here and nowhere
    // else, because there are no rows for it to misdescribe.
    scanMock.mockReturnValue({ result: null, isLoading: true, error: null })
    const { container } = render(<ScannerShell />)
    expect(renderedColumnCount(container)).toBe(0)   // skeleton, no grid rows
  })
})
