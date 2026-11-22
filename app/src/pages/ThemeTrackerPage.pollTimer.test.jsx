// ThemeTrackerPage — the theme-performance timer as it is actually scheduled, through the real
// useMobileSWR and SWR's own polling loop (pollCadence.test.jsx covers the returned number).
//
// Outside the session the poll is slow, so a timer started just before the opening bell could run
// its full length past it: 120 s on desktop, 240 s on touch, where useMobileSWR doubles the interval.
// The timer now ends at the next session boundary. These tests count real requests on a fake clock.
import { render, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { vi, beforeEach, afterEach, describe, test, expect } from 'vitest'

vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../components/chart/pane/ChartPane', () => ({ default: () => null }))
vi.mock('../utils/prefetchBars', () => ({
  prefetchBar: () => {}, prefetchAllTimeframes: () => {}, prefetchBarOnIntent: () => {},
  prefetchListAllTimeframes: () => {}, prefetchBars: () => {}, prefetchBarsToIDB: () => {},
  warmMemFromIDB: () => {}, prewarmVisibleList: () => {},
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

const THEME_BODY = {
  themes: [{
    ticker: 'ALPHA', name: 'Alpha Theme', etf_name: null, group_return: { '1d': 1 },
    holdings: [{ sym: 'AAA', name: 'AAA', returns: { '1d': 1 }, ref_prices: { '1d': 100 } }],
  }],
}

// 2026-11-09 is a Monday. The opening bell is 14:30:00Z.
const BELL = Date.parse('2026-11-09T14:30:00Z')

let requestTimes
function stubFetch() {
  requestTimes = []
  vi.stubGlobal('fetch', vi.fn((url) => {
    if (String(url).startsWith('/api/theme-performance')) requestTimes.push(Date.now())
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(THEME_BODY) })
  }))
}

async function loadPage({ touch }) {
  vi.resetModules()
  if (touch) window.ontouchstart = null
  else delete window.ontouchstart
  const page = (await import('./ThemeTrackerPage')).default
  return page
}

async function mountAt(iso, { touch = false } = {}) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
  stubFetch()
  const Page = await loadPage({ touch })
  render(<SWRConfig value={{ provider: () => new Map() }}><Page embedded /></SWRConfig>)
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
}
// In steps: one long act() holds React's updates until it ends, which would hide the once-a-minute
// market re-render, and that re-render is exactly what can restart a timer.
async function advanceUntil(ms) {
  while (Date.now() < ms) {
    const step = Math.min(5_000, ms - Date.now())
    await act(async () => { await vi.advanceTimersByTimeAsync(step) })
  }
}
const requestsAfter = (ms) => requestTimes.filter((t) => t >= ms)

beforeEach(() => { localStorage.clear() })
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete window.ontouchstart
})

describe('theme-performance timer at the opening bell', () => {
  test('desktop: a timer started 100 s before the bell still polls right at the bell', async () => {
    await mountAt('2026-11-09T14:28:20Z')
    await advanceUntil(BELL + 11_000)
    expect(requestsAfter(BELL).length, 'the first poll of the session must land within seconds').toBeGreaterThan(0)
  })

  test('touch: the doubled timer is still cut at the bell', async () => {
    await mountAt('2026-11-09T14:28:20Z', { touch: true })
    await advanceUntil(BELL + 11_000)
    expect(requestsAfter(BELL).length, 'touch must not run a 240 s timer past the bell').toBeGreaterThan(0)
  })

  test('desktop: once open it settles to the 10 s cadence', async () => {
    await mountAt('2026-11-09T14:29:30Z')
    await advanceUntil(BELL + 45_000)
    expect(requestsAfter(BELL).length).toBeGreaterThanOrEqual(3)
  })
})

describe('theme-performance timer well outside the session', () => {
  test('desktop: overnight it polls about every 2 minutes, not every 10 s', async () => {
    await mountAt('2026-11-10T03:00:00Z')
    const start = Date.now()
    await advanceUntil(start + 10 * 60_000)
    const polls = requestsAfter(start).length
    expect(polls).toBeGreaterThanOrEqual(4)
    expect(polls).toBeLessThanOrEqual(6)
  })

  test('touch: overnight the doubled timer still fires, despite the once-a-minute market re-render', async () => {
    await mountAt('2026-11-10T03:00:00Z', { touch: true })
    const start = Date.now()
    await advanceUntil(start + 20 * 60_000)
    const polls = requestsAfter(start).length
    expect(polls, 'a timer restarted every 60 s would never reach 240 s').toBeGreaterThanOrEqual(3)
    expect(polls).toBeLessThanOrEqual(6)
  })
})
