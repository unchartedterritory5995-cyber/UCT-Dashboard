// ThemeTrackerPage — how often /api/theme-performance is polled.
//
// It polled every 10 s around the clock: 161 KB a time, about 58 MB an hour, even with the market
// closed and nothing moving. The fast cadence is for the regular session only. Hidden tabs are already
// paused by useMobileSWR, which this file does not re-test.
import { render, screen } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../components/chart/pane/ChartPane', () => ({ default: () => null }))
vi.mock('../utils/prefetchBars', () => ({
  prefetchBar: () => {}, prefetchAllTimeframes: () => {}, prefetchBarOnIntent: () => {},
  prefetchListAllTimeframes: () => {}, prefetchBars: () => {}, prefetchBarsToIDB: () => {},
  warmMemFromIDB: () => {}, prewarmVisibleList: () => {},
}))

const THEME_DATA = {
  themes: [{
    ticker: 'ALPHA', name: 'Alpha Theme', etf_name: null, group_return: { '1d': 1 },
    holdings: [{ sym: 'AAA', name: 'AAA', returns: { '1d': 1 }, ref_prices: { '1d': 100 } }],
  }],
}
const swrCalls = {}
vi.mock('../hooks/useMobileSWR', () => ({
  default: (key, _f, options) => {
    if (key) swrCalls[key] = options
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
vi.mock('./charts/ChartsSymContext', () => ({
  ChartsSymContext: { Provider: ({ children }) => children },
  useChartsSym: () => ({ sym: null, setSym: () => {}, tf: undefined }),
}))

const ThemeTrackerPage = (await import('./ThemeTrackerPage')).default

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

async function intervalAt(iso, data = { themes: [] }) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
  render(<ThemeTrackerPage embedded />)
  await screen.findByText('Alpha Theme')
  const interval = swrCalls['/api/theme-performance'].refreshInterval
  return typeof interval === 'function' ? interval(data) : interval
}

// 2026-11-09 is a Monday; New York is UTC-5.
test('regular session: 10 s, near-live', async () => {
  expect(await intervalAt('2026-11-09T15:00:00Z')).toBe(10_000)
})

test('after the close but in the extended session: slowed', async () => {
  expect(await intervalAt('2026-11-09T22:00:00Z')).toBe(120_000)
})

test('premarket: slowed', async () => {
  expect(await intervalAt('2026-11-09T12:00:00Z')).toBe(120_000)
})

test('overnight: slowed', async () => {
  expect(await intervalAt('2026-11-10T03:00:00Z')).toBe(120_000)
})

test('weekend: slowed', async () => {
  expect(await intervalAt('2026-11-07T17:00:00Z')).toBe(120_000)
})

test('the session is read at each tick, not frozen at mount', async () => {
  const closed = await intervalAt('2026-11-09T12:00:00Z')
  expect(closed).toBe(120_000)
  const interval = swrCalls['/api/theme-performance'].refreshInterval
  vi.setSystemTime(new Date('2026-11-09T15:00:00Z'))
  expect(interval({ themes: [] }), 'a page left open across the open must speed up').toBe(10_000)
})

test('a computing response keeps its 15 s retry even outside the session', async () => {
  expect(await intervalAt('2026-11-10T03:00:00Z', { status: 'computing' })).toBe(15_000)
})

test('the interval is one stable function, so a re-render cannot restart the timer', async () => {
  await intervalAt('2026-11-09T15:00:00Z')
  const first = swrCalls['/api/theme-performance'].refreshInterval
  render(<ThemeTrackerPage embedded />)
  expect(swrCalls['/api/theme-performance'].refreshInterval).toBe(first)
})
