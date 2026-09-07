// Watchlists — `quoteOverride`, the prop that lets a caller PIN quotes for rows
// whose numbers are not "now" (a historical breadth drill showing what stocks did
// on a recorded day).
//
// ⛔ THIS FILE EXISTS BECAUSE THE FEATURE SHIPPED DEAD. The `prices` memo has a
// fast path — `if (!hasFreshReadouts() && idxKeys.length === 0) return feedPrices`
// — that skips the whole merge when nothing augments the live feed. The override
// merge was written AFTER that line, so on the only path that normally runs (no
// chart readouts, no thematic-index rows) it never executed, and the breadth drill
// went to production with Price, Vol and % Chg blank on EVERY row. It was caught
// by opening the page, not by the suite.
//
// So the load-bearing condition here is `hasFreshReadouts: () => false` below:
// that is the state the bug lived in, and any fixture with readouts would pass
// while the product stayed broken.
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
// ⭐ THE CONTROL: no readouts. This is the state that made the override dead.
vi.mock('../lib/chartReadoutStore', () => ({
  subscribeChartReadouts: () => () => {}, getChartReadout: () => null, hasFreshReadouts: () => false,
}))
vi.mock('swr', () => ({ default: () => ({ data: [], mutate: () => {} }) }))
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
// ⭐ THE OTHER HALF OF THE CONTROL: the live feed is EMPTY, exactly as it is on a
// closed market. Without the override there is nothing at all to render.
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
vi.mock('./charts/ChartsSymContext', () => ({
  ChartsSymContext: { Provider: ({ children }) => children },
  useChartsSym: () => ({ sym: null, setSym: () => {} }),
}))
// jsdom reports clientHeight 0, so the REAL virtualizer yields zero rows and every
// assertion below would pass vacuously. Render the whole window instead.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 28, size: 28 })),
    getTotalSize: () => count * 28,
    scrollToIndex: () => {}, measureElement: () => {}, scrollToOffset: () => {},
  }),
  observeElementRect: () => () => {},
  observeElementOffset: () => () => {},
  elementScroll: () => {},
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

const Watchlists = (await import('./Watchlists')).default

const SYMS = ['NX', 'BBCP']
const PINNED = {
  NX: { price: 22.93, change_pct: 22.2, volume: null },
  BBCP: { price: 10.5, change_pct: 16, volume: null },
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

function renderScan(props = {}) {
  return render(
    <Watchlists
      embedded
      pickList="__scan__"
      pickName="UP 4%+"
      scanSymbols={SYMS}
      {...props}
    />,
  )
}

test('a pinned quote reaches the row even with NO readouts and an EMPTY live feed', () => {
  renderScan({ quoteOverride: PINNED })
  // The exact regression: these were em-dashes in production.
  expect(screen.getByText('22.93')).toBeTruthy()
  expect(screen.getByText('10.50')).toBeTruthy()
})

test('NON-VACUITY: without the override the same render has no prices at all', () => {
  // If this ever finds a price, the fixture is feeding quotes from somewhere else
  // and the test above proves nothing.
  renderScan()
  expect(screen.queryByText('22.93')).toBeNull()
  expect(screen.queryByText('10.50')).toBeNull()
})

test('an empty override object does not count as augmenting the feed', () => {
  // The bail-out must still fire for `{}` — otherwise every ordinary watchlist
  // pays for a merge that changes nothing.
  renderScan({ quoteOverride: {} })
  expect(screen.queryByText('22.93')).toBeNull()
})
