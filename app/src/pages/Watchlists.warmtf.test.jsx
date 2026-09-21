// Watchlists — WHICH timeframe the bar warmers are keyed on.
//
// ⛔ THE DEFECT (identical to ThemeTrackerPage.warmtf.test.jsx — same class, two
// surfaces): embedded in the /charts workspace this page's own chart panel is
// hidden (`{!embedded && (`), so the `chartPeriod` selector that would move it
// never renders and the state sits on its 'D' seed forever. Every warm call was
// keyed on that state, so a member scanning a list with the linked ChartWidget
// on 5m warmed SYM_D on every flip while the chart read SYM_5 — a 100% cold
// client cache for the whole scan (cold T0→paint p50 = 287ms vs 12ms warm).
//
// The fix reads the linked chart's live timeframe off the sym hub. These tests
// pin BOTH directions: embedded follows the hub, standalone keeps its own
// selector (there is no linked chart to follow there).
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

// ── Heavy leaves that never render in embedded mode but cost real import time ──
vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/chart/SymbolSearch', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
// Record every warm call's timeframe argument.
const warmCalls = { prewarmVisibleList: [], prefetchBars: [], prefetchBarOnIntent: [] }
vi.mock('../utils/prefetchBars', () => ({
  prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {},
  prefetchListAllTimeframes: () => {}, warmMemFromIDB: () => {},
  prefetchBars: (syms, tf) => { warmCalls.prefetchBars.push(tf) },
  prefetchBarOnIntent: (sym, tf) => { warmCalls.prefetchBarOnIntent.push(tf) },
  prewarmVisibleList: (syms, opts) => { warmCalls.prewarmVisibleList.push(opts?.chartTf) },
}))
vi.mock('../lib/chartReadoutStore', () => ({
  subscribeChartReadouts: () => () => {}, getChartReadout: () => null, hasFreshReadouts: () => false,
}))

// The panel under test. Stub exposes exactly what the page passed it.
vi.mock('../components/chart/pane/ChartPane', () => ({
  default: ({ sym, tf, stored, onSymbolChange }) => (
    <div
      data-testid={`chart-pane-${sym}-${tf}`}
      data-stored={stored === null ? 'null' : String(stored)}
      data-has-symbol-change={onSymbolChange ? 'yes' : 'no'}
    >pane {sym} {tf}</div>
  ),
}))

// ── Data hooks (mirrors Watchlists.rowmenu.test.jsx's mock set) ──
const WL = {
  id: 'wl1', name: 'Momentum Plays', description: '',
  items: [{ id: 'i1', sym: 'AAPL', notes: '' }],
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
  default: () => ({
    alerts: [], createAlert: () => {}, deleteAlert: () => {}, getAlertsForSym: () => [], hasAlert: () => false,
  }),
}))
vi.mock('../hooks/useTagColors', () => ({
  default: () => ({ tagColors: [], tagByKey: {}, setTagLabel: () => {} }),
}))
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
// The sym hub, swapped per test: `hub.tf` stands in for the linked ChartWidget's
// live timeframe (in production it arrives via the workspace's groupTfs map).
const hub = { sym: null, setSym: () => {}, tf: undefined }
vi.mock('./charts/ChartsSymContext', () => ({
  ChartsSymContext: { Provider: ({ children }) => children },
  useChartsSym: () => hub,
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))


const Watchlists = (await import('./Watchlists')).default

beforeEach(() => {
  localStorage.clear()
  for (const k of Object.keys(warmCalls)) warmCalls[k] = []
  hub.tf = undefined
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

test('embedded: the visible-list warm uses the LINKED CHART timeframe', async () => {
  hub.tf = '5'
  render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
  await screen.findByText('AAPL')
  expect(warmCalls.prewarmVisibleList).toContain('5')
  // The bug's signature: the list warmed under the page's own hidden 'D' seed.
  expect(warmCalls.prewarmVisibleList).not.toContain('D')
})

test('embedded: row-hover intent prefetches the linked timeframe, not a hardcoded D', async () => {
  const user = userEvent.setup()
  hub.tf = '15'
  render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
  await user.hover(await screen.findByText('AAPL'))
  // onRowIntent used to pass a LITERAL 'D' — a hover warmed daily no matter what
  // the chart was showing.
  expect(warmCalls.prefetchBarOnIntent).toContain('15')
  expect(warmCalls.prefetchBarOnIntent).not.toContain('D')
})

test('embedded but hub has no timeframe: falls back to the page selector', async () => {
  hub.tf = undefined            // an older provider, or no chart in this group
  render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
  await screen.findByText('AAPL')
  expect(warmCalls.prewarmVisibleList).toContain('D')
})

test('standalone: ignores the hub and uses its own visible selector', async () => {
  // A stale/foreign tf on the hub must NOT hijack the standalone page, whose
  // chart panel IS rendered and whose selector is the real authority there.
  hub.tf = '60'
  render(<Watchlists pickList="user:wl1" pickName="Momentum Plays" />)
  await screen.findByText('AAPL')
  expect(warmCalls.prewarmVisibleList).toContain('D')
  expect(warmCalls.prewarmVisibleList).not.toContain('60')
})
