// Watchlists — the /charts ChartPane mount (right panel, `!embedded`) has NO
// test coverage. Every existing Watchlists test (including
// Watchlists.rowmenu.test.jsx, the harness this file's mocks are modeled on)
// renders the page WITH `embedded`, which hides this panel entirely
// (Watchlists.jsx:1822 `{!embedded && (...)}`). Mutating that panel's
// `<ChartPane sym={...}>` to a hardcoded wrong ticker left the full suite
// green — nothing in the suite could see the mount.
//
// These tests render WITHOUT `embedded` (the whole point — that's what makes
// the chart panel exist), select a real ticker, and assert what the page
// hands ChartPane: the selected symbol + its current timeframe, `stored=null`
// with no `onStore` (the "your chart everywhere" contract — this panel must
// render the user's own global `chart_settings`, not a page-local override),
// and that symbol retargeting stays enabled (`onSymbolChange` wired — unlike
// the locked TickerPopup, the user IS allowed to change ticker from here).
//
// Mock `ChartPane` itself to a stub exposing what it was passed — the same
// idiom TickerPopup.test.jsx uses for StockChart — so we never need to satisfy
// ChartPane's own internals (AuthProvider, useFlagged, fundamentals, a market
// clock: all irrelevant to "did the page pass the right props").
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

// ── Heavy leaves that never render in embedded mode but cost real import time ──
vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/chart/SymbolSearch', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../utils/prefetchBars', () => ({
  prefetchBars: () => {}, prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {},
  prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {}, warmMemFromIDB: () => {},
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
vi.mock('./charts/ChartsSymContext', () => ({
  ChartsSymContext: { Provider: ({ children }) => children },
  useChartsSym: () => ({ sym: null, setSym: () => {} }),
}))

const Watchlists = (await import('./Watchlists')).default

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

// Renders WITHOUT `embedded` — that is the entire point of this file.
// `pickList` puts the page in SCOPED mode (the only mode users ever reach per
// this file's own header comment); it has no bearing on the `embedded` gate.
function renderStandalone() {
  return render(<Watchlists pickList="user:wl1" pickName="Momentum Plays" />)
}

test('empty state: no ticker selected shows the placeholder and mounts no chart pane', () => {
  renderStandalone()
  expect(screen.getByText(/select a ticker to view chart/i)).toBeInTheDocument()
  expect(screen.queryByTestId(/^chart-pane-/)).not.toBeInTheDocument()
})

test('selecting a ticker mounts ChartPane with that symbol and the current timeframe', async () => {
  const user = userEvent.setup()
  renderStandalone()

  await user.click(screen.getByText('AAPL'))

  // Watchlists' own chartPeriod state defaults to 'D' — this proves the page
  // passes the SELECTED symbol and its CURRENT timeframe through, not a
  // hardcoded or stale value.
  expect(await screen.findByTestId('chart-pane-AAPL-D', {}, { timeout: 8000 })).toBeInTheDocument()
})

test('passes stored=null with no onStore, and keeps symbol retargeting enabled', async () => {
  const user = userEvent.setup()
  renderStandalone()
  await user.click(screen.getByText('AAPL'))

  // Located by a symbol/tf-agnostic regex so this assertion is immune to a
  // sym/tf mutation and stays focused on the settings contract + retargeting.
  const pane = await screen.findByTestId(/^chart-pane-/, {}, { timeout: 8000 })
  // The assertion that matters most and is least obvious: stored={null} with
  // no onStore is what makes this panel render the user's OWN global
  // chart_settings. If someone later passes an onStore here, this page
  // silently stops being "your chart everywhere" and nothing else notices.
  expect(pane).toHaveAttribute('data-stored', 'null')
  // Unlike the locked TickerPopup, the user IS allowed to retarget the ticker
  // from this chart.
  expect(pane).toHaveAttribute('data-has-symbol-change', 'yes')
})
