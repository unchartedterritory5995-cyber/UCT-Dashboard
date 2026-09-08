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

test('RVOL renders from a directly-supplied ratio, with no raw volume anywhere', () => {
  // The derived form needs avg_vol_20d AND a live q.volume; a recorded breadth
  // drill has neither, so without the direct path the column is always blank.
  render(
    <Watchlists
      embedded pickList="__scan__" pickName="UP 4%+" scanSymbols={SYMS}
      quoteOverride={PINNED}
      metaOverride={{ NX: { rvol: 700 } }}
      defaultColCfg={{ order: ['flag', 'sym', 'price', 'chg', 'rvol'] }}
    />,
  )
  expect(screen.getByText('7.0x')).toBeTruthy()
})

test('ATR % and distance from the 50SMA render from metaOverride', () => {
  // Both are breadth-only fields with no live source at all, so if the override
  // does not reach them the columns are permanently em-dashes — which is exactly
  // what the drill showed until this was pinned.
  render(
    <Watchlists
      embedded pickList="__scan__" pickName="UP 4%+" scanSymbols={SYMS}
      quoteOverride={PINNED}
      metaOverride={{ NX: { atr: 4.7, a50: 3.6 }, BBCP: { atr: 4.6, a50: 0.8 } }}
      defaultColCfg={{ order: ['flag', 'sym', 'price', 'atr', 'a50'] }}
    />,
  )
  expect(screen.getByText('4.7%')).toBeTruthy()  // ATR %, a magnitude
  expect(screen.getByText('+3.6x')).toBeTruthy() // 3.6 ATRs above the 50-day
})

test('the 50SMA distance is an ATR MULTIPLE, never a percentage', () => {
  // ⛔ THIS ASSERTION USED TO READ `+3.60%`. The collector stores
  // `(close - sma50) / atr_abs` — a multiple — and the cell rendered it through
  // the % cell at `.toFixed(2)`, so a name 3.6 ATRs above its 50-day claimed to
  // be "+3.60%" above it. Two wrongs at once: a unit the number never had, and
  // a second decimal its 1dp source never carried. Both are asserted here
  // because fixing either one alone still leaves a cell that lies.
  render(
    <Watchlists
      embedded pickList="__scan__" pickName="UP 4%+" scanSymbols={SYMS}
      quoteOverride={PINNED}
      metaOverride={{ NX: { a50: 3.6 }, BBCP: { a50: -0.8 } }}
      defaultColCfg={{ order: ['flag', 'sym', 'price', 'a50'] }}
    />,
  )
  expect(screen.queryByText('+3.60%')).toBeNull()
  expect(screen.queryByText('3.60%')).toBeNull()
  expect(screen.getByText('+3.6x')).toBeTruthy()
  expect(screen.getByText('-0.8x')).toBeTruthy()   // signed both ways
})

test('an empty override object does not count as augmenting the feed', () => {
  // The bail-out must still fire for `{}` — otherwise every ordinary watchlist
  // pays for a merge that changes nothing.
  renderScan({ quoteOverride: {} })
  expect(screen.queryByText('22.93')).toBeNull()
})
