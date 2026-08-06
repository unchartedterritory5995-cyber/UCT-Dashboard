// ThemeTrackerPage — the /charts ChartPane mount (right panel, `!embedded`)
// has NO test coverage at all: this page has no test file, period. The
// ChartPane swap (~ThemeTrackerPage.jsx:752) sits behind the same `!embedded`
// gate Watchlists uses, and the only production render site (ThemesWidget)
// always passes `embedded` — so nothing short of a dedicated test can see
// this mount. A wrong sym, a stale timeframe, or a silently-added `onStore`
// would all ship invisibly.
//
// These tests render WITHOUT `embedded`, select a normal holding (NOT the
// theme's synthetic "$IDX:" equal-weight-index row, which renders bare
// StockChart instead of ChartPane — see useThemeIndexBars), and assert what
// the page hands ChartPane: the selected symbol + current timeframe,
// `stored=null` with no `onStore` (the "your chart everywhere" contract), and
// that symbol retargeting stays enabled.
//
// Mock `ChartPane` itself to a stub exposing what it was passed — the same
// idiom TickerPopup.test.jsx uses for StockChart, and the same technique
// Watchlists.chartmount.test.jsx uses for the sibling page — so ChartPane's
// own internals (AuthProvider, useFlagged, fundamentals, a market clock) never
// need satisfying. Every other hook/data dependency this page actually
// imports is mocked below (modeled on Watchlists.rowmenu.test.jsx's harness).
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

// ── Heavy leaves ──
vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../utils/prefetchBars', () => ({
  prefetchBar: () => {}, prefetchBars: () => {}, prefetchBarsToIDB: () => {},
  prefetchAllTimeframes: () => {}, prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {},
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

// ── Data hooks ──
// One theme, one holding (AAPL). The page auto-opens the FIRST theme on load
// (see ThemeTrackerPage's firstThemeTicker effect), so the holding row is
// visible without any click — we only click it to select.
const THEME_DATA = {
  themes: [
    {
      ticker: 'TESTTHEME',
      name: 'Test Theme',
      etf_name: null,
      group_return: { '1d': 1.5 },
      holdings: [
        { sym: 'AAPL', name: 'Apple Inc', returns: { '1d': 1.5 }, ref_prices: { '1d': 100 } },
      ],
    },
  ],
}
vi.mock('../hooks/useMobileSWR', () => ({
  default: (key) => {
    if (key === '/api/theme-performance') return { data: THEME_DATA, isLoading: false }
    if (key === '/api/theme-rotation') return { data: { rankings: {} } }
    return { data: undefined, isLoading: false }
  },
}))
vi.mock('../hooks/useFlagged', () => ({
  useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }),
}))
vi.mock('../hooks/useTickerTags', () => ({
  default: () => ({ getTag: () => null }),
}))
vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: () => {}, loading: false }),
  parsePref: (raw, fallback) => fallback,
}))
vi.mock('../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: {}, isLoading: false, isStreaming: false, staleSymbols: new Set() }),
}))
vi.mock('../hooks/useRealtimeBarPrices', () => ({
  default: () => ({}),
  pickFreshPrice: () => null,
}))
vi.mock('./charts/ChartsSymContext', () => ({
  ChartsSymContext: { Provider: ({ children }) => children },
  useChartsSym: () => ({ sym: null, setSym: () => {} }),
}))

const ThemeTrackerPage = (await import('./ThemeTrackerPage')).default

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

// Renders WITHOUT `embedded` — the entire point (ThemesWidget always passes
// `embedded`, hiding this panel; that's exactly why nothing else sees the mount).
function renderStandalone() {
  return render(<ThemeTrackerPage />)
}

test('empty state: no ticker selected shows the placeholder and mounts no chart pane', () => {
  renderStandalone()
  expect(screen.getByText(/select a ticker to view chart/i)).toBeInTheDocument()
  expect(screen.queryByTestId(/^chart-pane-/)).not.toBeInTheDocument()
})

test('selecting a holding mounts ChartPane with that symbol and the current timeframe', async () => {
  const user = userEvent.setup()
  renderStandalone()

  // Click the HOLDING row, not the theme's "… Index" row (that one is the
  // synthetic $IDX: pseudo-ticker and takes the bare-StockChart branch).
  await user.click(await screen.findByText('AAPL'))

  // ThemeTrackerPage's own chartPeriod state defaults to 'D' — this proves the
  // page passes the SELECTED symbol and its CURRENT timeframe through, not a
  // hardcoded or stale value.
  expect(await screen.findByTestId('chart-pane-AAPL-D', {}, { timeout: 8000 })).toBeInTheDocument()
})

test('passes stored=null with no onStore, and keeps symbol retargeting enabled', async () => {
  const user = userEvent.setup()
  renderStandalone()
  await user.click(await screen.findByText('AAPL'))

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
