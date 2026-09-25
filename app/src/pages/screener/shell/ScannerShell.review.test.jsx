/* 🔴 THE WIRE — THE SCREENER'S ORDER REACHES THE REVIEW, AND IT IS ONE ORDER.
 *
 * ⛔ THE SAME ARGUMENT AS THE SCAN SIDE, worth stating separately because the
 * two surfaces order their rows for different reasons.
 * `reviewEntry.test.jsx` proves the button publishes the list it is given; it
 * renders the button directly, so it stays green if this shell never mounts one
 * or mounts one holding a stale list. The screener's contribution to a review
 * IS its order — a server sort, optionally re-sorted live over loaded rows —
 * and that order is decided here.
 *
 * ⭐ SO THE ASSERTION IS "THE RENDERER AND THE REVIEW GOT THE SAME LIST", not
 * "the review got the list I expected". A shell that computed the display order
 * twice would satisfy the second and fail the first, and two derivations of one
 * list agree on the day they are written. The results renderer is stubbed to
 * report the order it was handed, which is the only way to compare the two —
 * and it keeps the case off the virtualizer, which renders no rows into jsdom's
 * zero-height container and would make every DOM read vacuously empty.
 *
 * ⭐ THE LIVE RE-SORT MOVED UP INTO THIS SHELL to make that comparison possible
 * at all. It used to live inside `VirtualResults`, where it was true of the
 * desktop table and of nothing else: the toggle sits in the underbar, which the
 * phone renders too, so `ResultCards` ignored it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const { META, SAVED, scanMock, PRICES } = vi.hoisted(() => ({
  META: {
    categories: [{ key: 'descriptive', label: 'Descriptive' }],
    filters: [{ key: 'price', label: 'Price', category: 'descriptive',
      type: 'range', allow_custom: true, presets: [{ label: 'Any' }] }],
    views: [{ key: 'overview', label: 'Overview', columns: ['ticker', 'price', 'chg_pct_1d'] }],
  },
  SAVED: { saved: [], starters: [], create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  scanMock: vi.fn(),
  // A live overlay that DISAGREES with the snapshot prices, so re-sorting live
  // produces a different order — a fixture where both orders coincide could not
  // tell the two apart (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
  PRICES: { AAA: { price: 99 }, BBB: { price: 5 }, CCC: { price: 50 } },
}))

const navigated = []
vi.mock('react-router-dom', () => ({ useNavigate: () => (to) => { navigated.push(to) } }))
vi.mock('../hooks/useScreenerMeta', () => ({ default: () => ({ meta: META, isLoading: false }) }))
vi.mock('../hooks/useScreenerScan', () => ({ default: scanMock }))
vi.mock('../hooks/useSavedScreens', () => ({ default: () => SAVED }))
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: PRICES }) }))
vi.mock('../../../components/TickerPopup', () => ({ default: ({ children }) => <span>{children}</span> }))
vi.mock('../../../components/TickerActions', () => ({
  default: () => null,
  useTickerActions: () => ({ longPressProps: () => ({}), menu: null, closeMenu: () => {} }),
}))
vi.mock('../../../components/PatternFeedbackChip', () => ({ default: () => null }))
// ⚰️ Since #163 (2026-09-20) the review door opens the IN-SCREENER overlay, whose
// PatternSidePanel calls useAuth(); without a provider every click-the-door case here died
// on "useAuth must be used within AuthProvider" — a harness gap, not the property under
// test. Same shape as IndicatorLibraryDialog.refusals.test.jsx's mock.
vi.mock('../../../context/AuthContext', async () => {
  const { createContext } = await import('react')
  const value = { user: { id: 11, role: 'user' }, plan: 'premium', isPaid: true, loading: false }
  return { AuthContext: createContext(value), useAuth: () => value, useIsPaid: () => true }
})
// The stub reports the order it was handed. ⚠️ `LIVE_WINDOW` is re-exported
// because `ScannerShell` imports it from this module for its live-price window;
// a mock that dropped it would fail on an undefined slice bound, not on the
// property under test.
vi.mock('./VirtualResults', () => ({
  __esModule: true,
  LIVE_WINDOW: 60,
  default: ({ rows }) => (
    <div data-testid="rendered-order">{rows.map((r) => r.ticker).join(',')}</div>
  ),
}))

import ScannerShell from './ScannerShell'
import { encodeSpec, SPEC_PARAM } from './specUrl'
// ⚰️ THE MECHANISM MOVED IN #163 (2026-09-20): the door used to publish the order into
// charts/review/reviewSession and navigate to /charts; it now opens the IN-SCREENER
// overlay and hands it the rendered order as `symbols`. The stub below reports exactly
// what the shell handed it, the same way the VirtualResults stub reports the rendered
// order — so the property under test ("the review walks what the member is looking at")
// is asserted at the new seam, not the retired one.
vi.mock('./ScreenerReviewOverlay', () => ({
  __esModule: true,
  default: ({ symbols, open }) => (
    open ? <div data-testid="review-overlay-order">{symbols.join(',')}</div> : null
  ),
}))
/** The order the review overlay was handed, once the door is opened. */
const reviewed = () => screen.getByTestId('review-overlay-order').textContent.split(',').filter(Boolean)

/** Open the shell already sorted by a live-overlaid column.
 *
 *  ⛔ THROUGH THE APP'S OWN CODEC, never a hand-written query string. The sort
 *  normally arrives from a column header, and the results renderer — which owns
 *  those headers — is stubbed above so the rendered ORDER can be read at all.
 *  `encodeSpec` is the same door `useScreenSpec` decodes on mount, so seeding
 *  it here exercises the real path rather than a fixture of one. */
const openSortedByPrice = () => {
  const s = encodeSpec({ filters: {}, sort: { key: 'price', dir: 'desc' }, view: 'overview', columns: null })
  window.history.replaceState({}, '', `/screener?${SPEC_PARAM}=${s}`)
}

// Snapshot order is by price DESC: BBB (20), CCC (12), AAA (10).
const ROWS = [
  { ticker: 'BBB', price: 20, chg_pct_1d: -1 },
  { ticker: 'CCC', price: 12, chg_pct_1d: 2 },
  { ticker: 'AAA', price: 10, chg_pct_1d: 1 },
]
const READY = {
  result: { total: 3, rows: ROWS, page: 1, snapshot_date: '2026-08-21',
    view_columns: ['ticker', 'price', 'chg_pct_1d'] },
  isLoading: false, error: null,
}
const EMPTY = {
  result: { total: 0, rows: [], page: 1, snapshot_date: '2026-08-21' },
  isLoading: false, error: null,
}

/** The order the results renderer was handed — what a member is looking at. */
const rendered = () => screen.getByTestId('rendered-order').textContent.split(',').filter(Boolean)

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
  sessionStorage.clear()
  navigated.length = 0
  scanMock.mockReset()
  window.history.replaceState({}, '', '/screener')
})
afterEach(cleanup)

describe('the screener hands its order to the review', () => {
  it('🔴 the review door is ON the toolbar, and it publishes the rendered order', () => {
    scanMock.mockReturnValue(READY)
    render(<ScannerShell />)
    fireEvent.click(screen.getByTestId('review-charts'))

    expect(reviewed()).toEqual(rendered())
    expect(reviewed()).toEqual(['BBB', 'CCC', 'AAA'])
    // In-screener since #163: the member is never sent to /charts for this.
    expect(navigated).toEqual([])
  })

  it('⛔ an EMPTY screen offers NO door, and publishes nothing', () => {
    // ⚰️ This case used to expect a DISABLED door. #163 (2026-09-20, owner-merged) made the
    // door conditional on loaded rows (`reviewBar={displayRows.length > 0 ? … : null}` in
    // ScannerShell) — nothing to walk, nothing to offer — so the shipped behaviour is
    // absence, and the property that matters ("publishes nothing") is asserted the same way.
    scanMock.mockReturnValue(EMPTY)
    render(<ScannerShell />)
    expect(screen.queryByTestId('review-charts')).toBeNull()
    expect(screen.queryByTestId('review-overlay-order')).toBeNull()
    expect(navigated).toEqual([])
  })

  it('⛔⛔ WITH THE LIVE RE-SORT ON, THE REVIEW WALKS THE LIVE ORDER', () => {
    // The snapshot order is BBB, CCC, AAA; the live overlay reverses it to
    // AAA (99), CCC (50), BBB (5). Publishing the snapshot order while the
    // member is looking at the live one is the same defect as the scan's value
    // sort — a plausible list that is not the one on screen.
    openSortedByPrice()
    scanMock.mockReturnValue(READY)
    render(<ScannerShell />)
    fireEvent.click(screen.getByRole('button', { name: /re-sort loaded rows live/i }))

    expect(rendered()).toEqual(['AAA', 'CCC', 'BBB'])
    fireEvent.click(screen.getByTestId('review-charts'))
    expect(reviewed()).toEqual(rendered())
    expect(reviewed()).toEqual(['AAA', 'CCC', 'BBB'])
    // ⚰️ The retired session carried a `:live` sort tag; the overlay is handed only the
    // symbols, so the live order itself is the assertion now — and the CONTROL below
    // proves it is not a shell that always re-sorts.
  })

  it('CONTROL: with the toggle OFF the rendered order IS the snapshot one', () => {
    // Without this the case above could pass against a shell that always
    // re-sorts — which would make the "snapshot order" chip a lie.
    openSortedByPrice()
    scanMock.mockReturnValue(READY)
    render(<ScannerShell />)
    // The toggle is OFFERED (the sort is live-overlaid) and left off.
    expect(screen.getByRole('button', { name: /re-sort loaded rows live/i })).toBeInTheDocument()
    expect(rendered()).toEqual(['BBB', 'CCC', 'AAA'])
    fireEvent.click(screen.getByTestId('review-charts'))
    expect(reviewed()).toEqual(['BBB', 'CCC', 'AAA'])
  })
})
