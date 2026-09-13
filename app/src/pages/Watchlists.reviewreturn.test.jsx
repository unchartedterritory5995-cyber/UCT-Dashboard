/* RETURN TO LIST — does the list put you back where you were?
 *
 * ⚰️⚰️ THIS FILE ONCE ASSERTED THE OPPOSITE, AND IT WAS WRONG. A first pass
 * rendered `<Watchlists embedded />` with NO `pickList`, found that every list
 * was collapsed, that no row existed, that `scrollIntoView` therefore never
 * fired — and reported return-to-list as broken.
 *
 * ⛔ THAT CONFIGURATION IS ONE USERS NEVER SEE. `Watchlists.jsx`'s own header
 * says so in the first ten lines: SCOPED (`pickList` set) is "the ONLY mode
 * users ever see"; a workspace watchlist widget is always pinned to one list.
 * In the scoped mode the list auto-expands from `pickList`, the rows mount, and
 * the existing `scrollIntoView(selectedSym)` lands the review symbol.
 *
 * ⭐ THE LESSON, because it is the expensive kind: a test can measure a REAL
 * behaviour of a configuration that does not exist, and report it with total
 * confidence. The unscoped case is kept below — labelled — precisely so the
 * difference between the two is visible rather than re-discovered.
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

test('⭐ SCOPED (what users see) · returning mid-review lands on the CURRENT symbol', async () => {
  HUB = 'AVGO'                        // deep in the list — the 5th of ten
  render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
  await screen.findAllByText('Momentum Plays')
  await new Promise((r) => setTimeout(r, 50))
  expect(document.querySelector('[data-watch-sym="AVGO"]'), 'the row never mounted').toBeTruthy()
  expect(scrolled[scrolled.length - 1]).toBe('AVGO')
})

test('⛔ NON-VACUITY · a different review symbol lands somewhere else', async () => {
  // Without this the case above could pass against a list that scrolls every row
  // it renders, or a spy recording the same thing regardless of the symbol.
  HUB = 'TSLA'
  render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
  await screen.findAllByText('Momentum Plays')
  await new Promise((r) => setTimeout(r, 50))
  expect(scrolled[scrolled.length - 1]).toBe('TSLA')
})

test('no review in progress scrolls nothing — the list opens at the top', async () => {
  HUB = null
  render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
  await screen.findAllByText('Momentum Plays')
  await new Promise((r) => setTimeout(r, 50))
  expect(scrolled).toHaveLength(0)
})

test('UNSCOPED · lists start collapsed, so nothing scrolls — NOT a user-facing state', async () => {
  // Kept as the record of the configuration that produced the wrong finding.
  HUB = 'AVGO'
  render(<Watchlists embedded />)
  await screen.findByText('Momentum Plays')
  expect(document.querySelector('[data-watch-sym="AVGO"]')).toBeNull()
  expect(scrolled).toHaveLength(0)
})
