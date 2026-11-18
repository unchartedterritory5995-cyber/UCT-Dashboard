// ThemeTrackerPage — WHICH rows the list prewarm covers.
//
// The re-warm effect passed the holdings of EVERY theme, whether its group was open or not: about 370
// bar requests in 30 s on a fresh profile, on a page where all themes start closed and no row is
// showing. Only the open group's rows are on screen, so that is what gets warmed, capped at 50.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../components/chart/pane/ChartPane', () => ({ default: () => null }))

const warmed = []
vi.mock('../utils/prefetchBars', () => ({
  prefetchBar: () => {},
  prefetchAllTimeframes: () => {},
  prefetchBarOnIntent: () => {},
  prefetchListAllTimeframes: () => {},
  prefetchBars: () => {},
  prefetchBarsToIDB: () => {},
  warmMemFromIDB: () => {},
  prewarmVisibleList: (syms, opts) => { warmed.push({ syms, opts }) },
}))

const holding = (sym, ret) => ({ sym, name: sym, returns: { '1d': ret }, ref_prices: { '1d': 100 } })
const group = (ticker, name, syms) => ({
  ticker, name, etf_name: null, group_return: { '1d': 1 },
  holdings: syms.map((s, i) => holding(s, 50 - i)),
})
const bigGroup = Array.from({ length: 80 }, (_, i) => `BIG${i}`)
const THEME_DATA = {
  themes: [
    group('ALPHA', 'Alpha Theme', ['AAA', 'BBB', 'CCC']),
    group('BETA', 'Beta Theme', ['DDD', 'EEE']),
    group('HUGE', 'Huge Theme', bigGroup),
  ],
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
const hub = { sym: null, setSym: () => {}, tf: undefined }
vi.mock('./charts/ChartsSymContext', () => ({
  ChartsSymContext: { Provider: ({ children }) => children },
  useChartsSym: () => hub,
}))

const ThemeTrackerPage = (await import('./ThemeTrackerPage')).default

beforeEach(() => {
  localStorage.clear()
  warmed.length = 0
  hub.tf = undefined
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

const allWarmed = () => [...new Set(warmed.flatMap((w) => w.syms))]

test('with every theme closed, nothing is prewarmed', async () => {
  render(<ThemeTrackerPage embedded />)
  await screen.findByText('Alpha Theme')
  expect(allWarmed(), 'no row is on screen, so no row is worth a bar request').toEqual([])
})

test('opening one theme warms that group and no other', async () => {
  const user = userEvent.setup()
  render(<ThemeTrackerPage embedded />)
  await user.click(await screen.findByText('Alpha Theme'))
  expect(allWarmed().sort()).toEqual(['AAA', 'BBB', 'CCC'])
})

// prewarmVisibleList applies `cap` itself (prewarmVisibleList.test.js), so here every call has to
// pass it and hand over the group in visual order, which is what makes the cap keep the top rows.
test('every prewarm on opening a group passes the cap of 50, the group in best-first order', async () => {
  const user = userEvent.setup()
  render(<ThemeTrackerPage embedded />)
  await user.click(await screen.findByText('Huge Theme'))
  expect(warmed.length, 'opening a group must warm it').toBeGreaterThan(0)
  for (const w of warmed) {
    expect(w.opts?.cap, 'every call site must pass the cap').toBe(50)
    expect(w.syms.slice(0, 3), 'best row first').toEqual(['BIG0', 'BIG1', 'BIG2'])
  }
})
