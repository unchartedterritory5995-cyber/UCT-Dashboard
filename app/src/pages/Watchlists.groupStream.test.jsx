// Watchlists in GROUP mode (the breadth drill's Sector / Industry / Theme
// sections) must stream live prices for the STOCKS, not the group names.
//
// ⛔ Shipped broken (owner, 2026-11-09): a live drill grouped by industry showed
// Price / % Chg / Vol as "—" on every stock, because the scan's items in group
// mode are the GROUP rows, and those names ("SEMICONDUCTORS") were what got
// subscribed. A recorded day hid it: its prices are pinned from the snapshot.
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
const streamed = []
vi.mock('../hooks/useRealtimePrices', () => ({
  default: (tickers) => { streamed.push([...(tickers || [])]); return { prices: {}, isLoading: false, isStreaming: false, staleSymbols: new Set() } },
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

beforeEach(() => {
  localStorage.clear()
  streamed.length = 0
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

const GROUPS = { SEMICONDUCTORS: ['AMD', 'MRVL'], BIOTECHNOLOGY: ['VRTX'] }

test('a grouped scan streams its member stocks', () => {
  render(
    <Watchlists embedded pickList="__scan__" pickName="UP 4%+"
      scanSymbols={Object.keys(GROUPS)} scanGroups={GROUPS} />,
  )
  const last = streamed[streamed.length - 1] || []
  expect(last).toEqual(expect.arrayContaining(['AMD', 'MRVL', 'VRTX']))
  // CONTROL: the group names are not tickers and are not what is asked for.
  expect(last).not.toContain('SEMICONDUCTORS')
})

test('an ungrouped scan still streams its own rows', () => {
  render(<Watchlists embedded pickList="__scan__" pickName="UP 4%+" scanSymbols={['NX', 'BBCP']} />)
  expect(streamed[streamed.length - 1]).toEqual(expect.arrayContaining(['NX', 'BBCP']))
})
