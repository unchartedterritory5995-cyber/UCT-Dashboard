// ThemeTrackerPage — WHICH timeframe the bar warmers are keyed on.
//
// ⛔ THE DEFECT: embedded in the /charts workspace this page's own chart panel
// is hidden (`{!embedded && (`), so the `chartPeriod` selector that would move
// it is never rendered and the state sits on its 'D' seed forever. Every warm
// call was keyed on that state, so a member scanning a theme with the linked
// ChartWidget on 5m warmed SYM_D on every flip while the chart read SYM_5 —
// a 100% cold client cache for the whole scan. Measured with
// tools/intraday_scan_harness.py: cold T0→paint p50 = 287ms, warm = 12ms.
//
// The fix reads the linked chart's live timeframe off the sym hub. These tests
// pin BOTH directions: embedded follows the hub, standalone keeps its own
// selector (there is no linked chart to follow).
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

// ── Heavy leaves ──
vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../components/chart/pane/ChartPane', () => ({ default: () => null }))

// Record every warm call's timeframe argument.
const warmCalls = { prewarmVisibleList: [], prefetchBars: [], prefetchBarsToIDB: [], warmMemFromIDB: [] }
vi.mock('../utils/prefetchBars', () => ({
  prefetchBar: () => {},
  prefetchAllTimeframes: () => {},
  prefetchBarOnIntent: () => {},
  prefetchListAllTimeframes: () => {},
  prefetchBars: (syms, tf) => { warmCalls.prefetchBars.push(tf) },
  prefetchBarsToIDB: (syms, tf) => { warmCalls.prefetchBarsToIDB.push(tf) },
  warmMemFromIDB: (syms, tfs) => { warmCalls.warmMemFromIDB.push(tfs) },
  prewarmVisibleList: (syms, opts) => { warmCalls.prewarmVisibleList.push(opts?.chartTf) },
}))

const THEME_DATA = {
  themes: [{
    ticker: 'TESTTHEME', name: 'Test Theme', etf_name: null,
    group_return: { '1d': 1.5 },
    holdings: [
      { sym: 'AAPL', name: 'Apple Inc', returns: { '1d': 1.5 }, ref_prices: { '1d': 100 } },
      { sym: 'MSFT', name: 'Microsoft', returns: { '1d': 1.1 }, ref_prices: { '1d': 200 } },
      { sym: 'NVDA', name: 'Nvidia', returns: { '1d': 0.9 }, ref_prices: { '1d': 300 } },
    ],
  }],
}
vi.mock('../hooks/useMobileSWR', () => ({
  default: (key) => {
    if (key === '/api/theme-performance') return { data: THEME_DATA, isLoading: false }
    if (key === '/api/theme-rotation') return { data: { rankings: {} } }
    return { data: undefined, isLoading: false }
  },
}))
vi.mock('../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../hooks/useTickerTags', () => ({ default: () => ({ getTag: () => null }) }))
vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: () => {}, loading: false }),
  parsePref: (raw, fallback) => fallback,
}))
vi.mock('../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: {}, isLoading: false, isStreaming: false, staleSymbols: new Set() }),
}))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))

// The sym hub, swapped per test: `hub.tf` stands in for the linked ChartWidget's
// live timeframe (in production it arrives via the workspace's groupTfs map).
const hub = { sym: null, setSym: () => {}, tf: undefined }
vi.mock('./charts/ChartsSymContext', () => ({
  ChartsSymContext: { Provider: ({ children }) => children },
  useChartsSym: () => hub,
}))

const ThemeTrackerPage = (await import('./ThemeTrackerPage')).default

beforeEach(() => {
  localStorage.clear()
  for (const k of Object.keys(warmCalls)) warmCalls[k] = []
  hub.tf = undefined
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

test('embedded: opening a theme warms the LINKED CHART timeframe, not the hidden default', async () => {
  const user = userEvent.setup()
  hub.tf = '5'
  render(<ThemeTrackerPage embedded />)
  await user.click(await screen.findByText('Test Theme'))

  expect(warmCalls.prewarmVisibleList).toContain('5')
  // The bug's signature: the list warmed under the page's own 'D' seed.
  expect(warmCalls.prewarmVisibleList).not.toContain('D')
})

test('embedded: the ±6 neighbour warm follows the linked chart too', async () => {
  const user = userEvent.setup()
  hub.tf = '15'
  render(<ThemeTrackerPage embedded />)
  await user.click(await screen.findByText('Test Theme'))
  await user.click(await screen.findByText('AAPL'))

  // useNeighborWarm drives these two; they are what make the NEXT arrow press
  // paint in the same frame, so a wrong tf here is the whole defect.
  expect(warmCalls.prefetchBarsToIDB).toContain('15')
  expect(warmCalls.warmMemFromIDB.flat()).toContain('15')
  expect(warmCalls.prefetchBars).toContain('15')
})

test('embedded but hub has no timeframe: falls back to the page selector', async () => {
  const user = userEvent.setup()
  hub.tf = undefined            // an older provider, or no chart in this group
  render(<ThemeTrackerPage embedded />)
  await user.click(await screen.findByText('Test Theme'))
  expect(warmCalls.prewarmVisibleList).toContain('D')
})

test('a CUSTOM timeframe warms its NATIVE base, not the display code', async () => {
  const user = userEvent.setup()
  // 2m is client-resampled from 1m, so the bars cache is keyed SYM_1. Warming
  // SYM_2 warms nothing — the harness measured a "warm" 2m scan at p50 409ms,
  // indistinguishable from cold, while every native tf warmed to ~10ms.
  hub.tf = '2'
  render(<ThemeTrackerPage embedded />)
  await user.click(await screen.findByText('Test Theme'))
  expect(warmCalls.prewarmVisibleList).toContain('1')
  expect(warmCalls.prewarmVisibleList).not.toContain('2')
})

test('standalone: ignores the hub and uses its own visible selector', async () => {
  const user = userEvent.setup()
  // A stale/foreign tf on the hub must NOT hijack the standalone page, whose
  // chart panel IS rendered and whose selector is the real authority there.
  hub.tf = '60'
  render(<ThemeTrackerPage />)
  await user.click(await screen.findByText('Test Theme'))
  expect(warmCalls.prewarmVisibleList).toContain('D')
  expect(warmCalls.prewarmVisibleList).not.toContain('60')
})
