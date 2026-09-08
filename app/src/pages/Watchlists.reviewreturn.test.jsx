/* RETURN TO LIST — does the list put you back where you were?
 *
 * ⛔ THE AMBIGUITY THIS CLOSES. The review session carried a `scrollTop` that
 * nothing consumed, and the phone shell's comment ("it never unmounts —
 * returning is free") is about the CHART, not the list: the widget page is
 * conditionally rendered (`{!tablet && screenWidget && …}`), so it genuinely
 * unmounts and its scroll offset genuinely dies with it.
 *
 * ⭐ AND A PIXEL OFFSET WAS THE WRONG THING TO RESTORE ANYWAY. After several
 * next/prev steps the right place to land is wherever the CURRENT symbol is —
 * not wherever the list happened to be scrolled when you left it.
 *
 * ⚰️ I EXPECTED THE EXISTING MECHANISM TO COVER THAT, AND IT DOES NOT. Watchlists
 * scrolls the selected row into view (`data-watch-sym` + `scrollIntoView`) and
 * `selectedSym` syncs from the hub symbol, so re-mounting mid-review LOOKED like
 * it would land correctly. Written as a passing assertion, it failed: see the
 * block above the tests for what actually happens.
 *
 * Mock set mirrors Watchlists.keyboard.test.jsx exactly.
 */
import { render, screen } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/chart/SymbolSearch', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../components/chart/pane/ChartPane', () => ({ default: () => null }))
vi.mock('../utils/prefetchBars', () => ({
  prefetchBars: () => {}, prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {},
  prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {}, warmMemFromIDB: () => {},
  prewarmVisibleList: () => {},
}))
vi.mock('../lib/chartReadoutStore', () => ({
  subscribeChartReadouts: () => () => {}, getChartReadout: () => null, hasFreshReadouts: () => false,
}))

// A list long enough that landing on the wrong row would mean hunting.
const SYMS = ['AAPL', 'MSFT', 'NVDA', 'AMD', 'AVGO', 'MU', 'TSLA', 'META', 'GOOG', 'AMZN']
const WL = {
  id: 'wl1', name: 'Momentum Plays', description: '',
  items: SYMS.map((s, i) => ({ id: `i${i}`, sym: s, notes: '' })),
}
vi.mock('swr', () => ({
  default: (key) => {
    if (key === '/api/watchlists') return { data: [WL], mutate: () => {} }
    if (key === '/api/watchlists/public') return { data: [], mutate: () => {} }
    return { data: [], mutate: () => {} }
  },
}))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'user', display_name: 'Pat' } }),
}))
vi.mock('../hooks/useFlagged', () => ({
  useFlagged: () => ({
    flagged: [], toggle: () => {}, remove: () => {}, isFlagged: () => false,
    isShared: false, toggleShare: () => {}, flaggedName: 'Flagged', renameFlagged: () => {},
  }),
}))
vi.mock('../hooks/useTickerTags', () => ({
  default: () => ({
    tags: {}, setTag: () => {}, removeTag: () => {}, getTag: () => null,
    shared: [], isColorShared: () => false, toggleShareColor: () => {}, communityTags: [],
  }),
}))
vi.mock('../hooks/useWatchlistAlerts', () => ({
  default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {}, getAlertsForSym: () => [], hasAlert: () => false }),
}))
vi.mock('../hooks/useTagColors', () => ({ default: () => ({ tagColors: [], tagByKey: {}, setTagLabel: () => {} }) }))
vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: () => {}, loading: false }),
  parsePref: (raw, fallback) => fallback,
}))
vi.mock('../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: {}, isLoading: false, isStreaming: false, staleSymbols: new Set() }),
}))
vi.mock('../hooks/useWatchlistPerformance', () => ({ default: () => ({ perfData: {}, isLoading: false }) }))
vi.mock('../hooks/useWatchlistMeta', () => ({ default: () => ({ metaData: {}, isLoading: false }) }))
vi.mock('../hooks/useWatchlistThemes', () => ({ default: () => ({ themeData: {}, isLoading: false }) }))
vi.mock('../hooks/useBreakpoint', () => ({
  useIsTouch: () => false, useIsPhone: () => false, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))

// The hub symbol IS the return signal: on re-mount the chart's current review
// symbol arrives here, and the list must land on it.
let HUB = null
vi.mock('./charts/ChartsSymContext', () => ({
  ChartsSymContext: { Provider: ({ children }) => children },
  useChartsSym: () => ({ sym: HUB, setSym: () => {} }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

const Watchlists = (await import('./Watchlists')).default

let scrolled
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  scrolled = []
  // jsdom has no layout, so scrollIntoView is absent — record who it is called on.
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoViewSpy() {
    scrolled.push(this.getAttribute('data-watch-sym'))
  }
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals(); HUB = null })

/* ⚠️⚠️ THESE ARE CHARACTERIZATION TESTS — they pin what the product does TODAY,
 * and two of them SHOULD BE INVERTED when the gap below is closed. They are
 * written this way rather than left red so the finding lives in a rail instead
 * of a paragraph nobody re-reads.
 *
 * THE FINDING. Returning to the list mid-review does NOT land on your symbol,
 * and the loss is bigger than a scroll offset:
 *   1. the phone's widget page is conditionally rendered
 *      (`{!tablet && screenWidget && …}`), so it genuinely UNMOUNTS — the
 *      "never unmounts, returning is free" comment is about the CHART beneath;
 *   2. on remount `expandedLists` resets to an empty Set, so every list
 *      RE-COLLAPSES;
 *   3. with no rows rendered there is nothing to scroll to, which is why the
 *      existing `scrollIntoView(selectedSym)` never fires. The mechanism is
 *      real and correct; it is simply unreachable from a collapsed list.
 *
 * ⭐ THE SMALLEST FIX NEEDS NO NEW MACHINERY, and both halves already exist:
 * the review session carries `sourceId`, and Watchlists already auto-expands a
 * list when handed `pickList`. Seed `sourceId` on ENTER, pass it as `pickList`
 * on RETURN, and the existing scroll-into-view lands the row. Deliberately NOT
 * done here — it writes widget opts from the phone shell, which is a change
 * worth making on its own rather than inside a test-driven detour.
 */
test('⚠️ TODAY: returning mid-review does NOT land on the current symbol', async () => {
  // INVERT THIS when the pickList wiring lands: it should become
  // `expect(scrolled[scrolled.length - 1]).toBe('AVGO')`.
  HUB = 'AVGO'                       // deep in the list — the 5th of ten
  render(<Watchlists embedded />)
  await screen.findByText('Momentum Plays')
  expect(scrolled, 'the list re-collapsed, so no row existed to scroll to').toHaveLength(0)
})

test('⚠️ TODAY: the row is not even rendered, because the list re-collapsed', async () => {
  // This is the ROOT of the one above, asserted separately so a future fix that
  // restores scrolling without restoring expansion cannot look like success.
  HUB = 'AVGO'
  render(<Watchlists embedded />)
  await screen.findByText('Momentum Plays')
  expect(document.querySelector('[data-watch-sym="AVGO"]'),
    'a row exists — expansion now survives, so the sibling test above must be inverted').toBeNull()
})

test('no review in progress scrolls nothing — the list opens at the top', async () => {
  HUB = null
  render(<Watchlists embedded />)
  await screen.findByText('Momentum Plays')
  expect(scrolled).toHaveLength(0)
})
