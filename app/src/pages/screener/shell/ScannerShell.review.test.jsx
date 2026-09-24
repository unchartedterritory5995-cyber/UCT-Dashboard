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

// The review surface, stubbed to report the order IT was handed -- the same
// method as the VirtualResults stub above, so the two lists can be compared
// (see the header). Only what an OPEN overlay would walk is reported: a closed
// overlay reports nothing, which is what lets the empty-screen case below say
// "no review was offered" rather than "some list happened to be empty".
vi.mock('./ScreenerReviewOverlay', () => ({
  __esModule: true,
  default: ({ symbols, open }) => (
    <div data-testid="review-order">{open ? symbols.join(',') : ''}</div>
  ),
}))

import ScannerShell from './ScannerShell'
import { encodeSpec, SPEC_PARAM } from './specUrl'

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
/** The order the review overlay was handed, once opened -- what a member will flip through. */
const reviewed = () => screen.getByTestId('review-order').textContent.split(',').filter(Boolean)
const reviewDoor = () => screen.queryByRole('button', { name: /review charts/i })

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
  sessionStorage.clear()
  navigated.length = 0
  scanMock.mockReset()
  window.history.replaceState({}, '', '/screener')
})
afterEach(cleanup)

describe('the screener hands its order to the review', () => {
  // ⚰️ REWRITTEN FOR #163 (42d6e439c, 2026-09-20): "review charts IN the screener,
  // keyboard-driven". The door used to publish a review SESSION and navigate to
  // /charts; the member wanted to stay on the screener, so it now opens an
  // in-page overlay handed `displayRows.map(r => r.ticker)` -- the order shown.
  // The four cases below assert the SAME invariant as before, "the renderer and
  // the review got the same list", against the door that exists. What retired
  // with the old mechanism: `navigated` (there is none -- asserted, not assumed)
  // and the session's `:live` sort tag, which rode the navigation that is gone.

  it('🔴 the review door is ON the toolbar, and it walks the rendered order -- without navigating', () => {
    scanMock.mockReturnValue(READY)
    render(<ScannerShell />)
    const door = reviewDoor()
    expect(door).toBeInTheDocument()
    // The button's own count is the LOADED page, the honest reviewable set.
    expect(door).toHaveTextContent('3')
    fireEvent.click(door)

    expect(reviewed()).toEqual(rendered())
    expect(reviewed()).toEqual(['BBB', 'CCC', 'AAA'])
    // #163's own claim: the member stays on the screener.
    expect(navigated).toEqual([])
  })

  it('⛔ an EMPTY screen offers NO door, and no review is opened', () => {
    // ⚰️ This used to assert a DISABLED door. #163 renders the reviewBar only
    // when displayRows.length > 0, so an empty screen has no door at all -- a
    // control a member cannot press is one they cannot mistake for a broken one.
    scanMock.mockReturnValue(EMPTY)
    render(<ScannerShell />)
    expect(reviewDoor()).toBeNull()
    expect(reviewed()).toEqual([])
    expect(navigated).toEqual([])
  })

  it('⛔⛔ WITH THE LIVE RE-SORT ON, THE REVIEW WALKS THE LIVE ORDER', () => {
    // The snapshot order is BBB, CCC, AAA; the live overlay reverses it to
    // AAA (99), CCC (50), BBB (5). Walking the snapshot order while the member
    // is looking at the live one is the same defect as the scan's value sort --
    // a plausible list that is not the one on screen.
    openSortedByPrice()
    scanMock.mockReturnValue(READY)
    render(<ScannerShell />)
    fireEvent.click(screen.getByRole('button', { name: /re-sort loaded rows live/i }))

    expect(rendered()).toEqual(['AAA', 'CCC', 'BBB'])
    fireEvent.click(reviewDoor())
    expect(reviewed()).toEqual(rendered())
  })

  it('CONTROL: with the toggle OFF the rendered order IS the snapshot one', () => {
    // Without this the case above could pass against a shell that always
    // re-sorts -- which would make the "snapshot order" chip a lie.
    openSortedByPrice()
    scanMock.mockReturnValue(READY)
    render(<ScannerShell />)
    // The toggle is OFFERED (the sort is live-overlaid) and left off.
    expect(screen.getByRole('button', { name: /re-sort loaded rows live/i })).toBeInTheDocument()
    expect(rendered()).toEqual(['BBB', 'CCC', 'AAA'])
    fireEvent.click(reviewDoor())
    expect(reviewed()).toEqual(['BBB', 'CCC', 'AAA'])
  })
})
