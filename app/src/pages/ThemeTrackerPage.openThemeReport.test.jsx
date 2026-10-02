// ThemeTrackerPage — COV-10 follow-up: the page REPORTS the open taxonomy theme to a host that
// asked (`onOpenThemeChange`), which the /charts Themes widget publishes as a list source.
// The real page is mounted (harness mirrors ThemeTrackerPage.flagkey.test.jsx); the assertion
// is what the host is told when a member opens and closes a theme.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../components/chart/pane/ChartPane', () => ({ default: () => null }))
vi.mock('../utils/prefetchBars', () => ({
  prefetchBar: () => {}, prefetchBars: () => {}, prefetchBarsToIDB: () => {},
  prefetchAllTimeframes: () => {}, prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {},
  prewarmVisibleList: () => {}, warmMemFromIDB: () => {},
}))

let THEME_DATA
vi.mock('../hooks/useMobileSWR', () => ({
  default: (key) => {
    if (key === '/api/theme-performance') return { data: THEME_DATA, isLoading: false }
    if (key === '/api/theme-rotation') return { data: { rankings: {} } }
    return { data: undefined, isLoading: false }
  },
}))
vi.mock('../hooks/useFlagged', () => ({
  useFlagged: () => ({ flagged: [], toggle: () => {}, isFlagged: () => false }),
}))
vi.mock('../hooks/useTickerTags', () => ({ default: () => ({ getTag: () => null }) }))
vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: () => {}, loading: false }),
  parsePref: (raw, fallback) => fallback,
}))
vi.mock('../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: {}, isLoading: false, isStreaming: false, staleSymbols: new Set() }),
}))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('./charts/ChartsSymContext', () => ({
  ChartsSymContext: { Provider: ({ children }) => children },
  useChartsSym: () => ({ sym: null, setSym: () => {} }),
}))

const ThemeTrackerPage = (await import('./ThemeTrackerPage')).default

const theme = (extra) => ({
  ticker: 'QTUM', name: 'Quantum Computing', etf_name: null, group_return: { '1d': 1.5 },
  holdings: [{ sym: 'IONQ', name: 'IonQ', returns: { '1d': 1.5 }, ref_prices: { '1d': 10 } }],
  ...extra,
})

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

test('opening a taxonomy theme reports its theme_db id and name; closing it reports null', async () => {
  THEME_DATA = { themes: [theme({ theme_id: 'quantum' })] }
  const seen = []
  const user = userEvent.setup()
  render(<ThemeTrackerPage onOpenThemeChange={(t) => seen.push(t)} />)
  const row = await screen.findByText('Quantum Computing', {}, { timeout: 8000 })
  expect(seen.at(-1)).toBeNull()
  await user.click(row)
  expect(seen.at(-1)).toEqual({ id: 'quantum', name: 'Quantum Computing' })
  await user.click(screen.getByText('Quantum Computing'))
  expect(seen.at(-1)).toBeNull()
})

test('a theme with no taxonomy id (or a custom one) reports null: nothing server-side to track', async () => {
  THEME_DATA = { themes: [theme({})] }
  const seen = []
  const user = userEvent.setup()
  render(<ThemeTrackerPage onOpenThemeChange={(t) => seen.push(t)} />)
  await user.click(await screen.findByText('Quantum Computing', {}, { timeout: 8000 }))
  expect(await screen.findByText('IONQ', {}, { timeout: 8000 })).toBeInTheDocument()   // it IS open
  expect(seen.every(t => t === null)).toBe(true)
})
