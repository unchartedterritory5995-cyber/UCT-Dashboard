// FIX C (8/21 UI stress sweep, zero_a11y_name:_settingsBtn_1bmsl_163): the
// icon-only Theme Tracker settings gear had only a `title` — the sweep's a11y
// check (aria-label OR textContent) never reads `title`, so an icon-only
// button with neither reads as nameless. Pins the fix with the same mocking
// harness ThemeTrackerPage.chartmount.test.jsx uses (this page has heavy
// data/hook dependencies; nothing here needs them beyond an empty render).
import { render, screen } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../utils/prefetchBars', () => ({
  prefetchBar: () => {}, prefetchBars: () => {}, prefetchBarsToIDB: () => {},
  prefetchAllTimeframes: () => {}, prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {},
}))
vi.mock('../components/chart/pane/ChartPane', () => ({ default: () => null }))
vi.mock('../hooks/useMobileSWR', () => ({
  default: (key) => {
    if (key === '/api/theme-performance') return { data: { themes: [] }, isLoading: false }
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

test('the icon-only Theme Tracker settings gear has an accessible name', () => {
  render(<ThemeTrackerPage />)
  expect(screen.getByRole('button', { name: 'Theme Tracker settings' })).toBeInTheDocument()
})
