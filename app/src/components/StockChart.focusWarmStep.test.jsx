import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'

// ── A WARMED NEIGHBOUR MUST DRAW ON ITS FIRST FRAME AFTER THE BELL ─────────────
//
// Focus screener, 2026-10-16 after the close: every ArrowDown left "Loading chart…"
// up for 530-850 ms although the neighbour warm (useFocusSelection) had already put
// the next row's daily bars in the sync mem cache. The paint authority
// (`_dailyCacheVerdict`) answered 'provisional-close' for EVERY today-dated daily
// tail from the bell to midnight ET, without asking WHEN the set was written — so a
// set fetched at 17:00, which already holds the sealed close, was refused exactly
// like one written at 11:00, and the chart sat waiting on the network.
//
// The guard's job is real and stays: a set written DURING the session holds a
// mid-session close and must not be the first frame after the bell. What changes is
// that a set written after the close (plus settle) is recognised as sealed.
//
// /api/bars never answers in this file, so a draw can only come from the cache.

vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const series = {
    setData: () => {}, update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    getPane: () => ({ paneIndex: () => 0 }), priceFormatter: () => ({ format: (p) => String(p) }),
  }
  const chart = {
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
      setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
      resetTimeScale: () => {}, options: () => ({}), width: () => 600,
      subscribeSizeChange: () => {}, unsubscribeSizeChange: () => {},
      subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    }),
    paneSize: () => ({ width: 600, height: 300 }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return { ...real, createChart: () => chart, createSeriesMarkers: () => ({ setMarkers: () => {} }) }
})
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

// Tue 2026-09-22 (EDT = UTC-4).
const MIDSESSION_ISO = '2026-09-22T15:00:00Z'   // 11:00 ET
const AFTER_BELL_ISO = '2026-09-22T22:12:00Z'   // 18:12 ET, same ET day
const PRE_OPEN_ISO = '2026-09-22T12:00:00Z'     // 08:00 ET
const clock = pinWallClock(AFTER_BELL_ISO)
afterAll(() => clock.restore())

const { default: StockChart } = await import('./StockChart')
const { memPut, memClear } = await import('../utils/barsMemCache')

// N weekday-dated daily bars ending at `endISO` (no holidays in the window used).
function dailyEndingAt(endISO, n = 60) {
  const out = []
  const d = new Date(`${endISO}T12:00:00Z`)
  while (out.length < n) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) out.unshift(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out.map((t, i) => ({ t, o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 1000 + i }))
}

let netCalls
beforeEach(() => {
  cleanup()
  memClear()
  netCalls = []
  // The network never answers: anything drawn came from the cache.
  vi.stubGlobal('fetch', vi.fn((url) => {
    netCalls.push(String(url))
    return String(url).includes('/api/bars') ? new Promise(() => {}) : Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  }))
})

async function drawnWithin(sym, ms = 600) {
  const seen = []
  render(<StockChart sym={sym} tf="D" backgroundWarm={false} liveUpdates={false} onDrawnBarCount={(n) => seen.push(n)} />)
  const until = Date.now() + ms
  while (Date.now() < until && !(seen.some(n => n > 0))) await new Promise(r => setTimeout(r, 10))
  return Math.max(0, ...seen)
}

describe('a warmed daily neighbour draws from the cache on the first frame', () => {
  it('CONTROL — pre-open, a last-session set paints from mem with the network pending', async () => {
    // Non-vacuity: proves the harness CAN see a cache-only draw. If this goes red the
    // assertions below say nothing.
    clock.retarget(PRE_OPEN_ISO)
    try {
      const bars = dailyEndingAt('2026-09-21')
      memPut('CTRL', 'D', bars)
      expect(await drawnWithin('CTRL')).toBe(bars.length)
    } finally { clock.retarget(AFTER_BELL_ISO) }
  })

  it('AFTER THE BELL — a set written after the close (sealed) paints from mem', async () => {
    const bars = dailyEndingAt('2026-09-22')
    memPut('SEAL', 'D', bars)                 // written at 18:12 ET: holds the sealed close
    expect(await drawnWithin('SEAL')).toBe(bars.length)
  })

  it('GUARD KEPT — a set written mid-session is still refused after the bell', async () => {
    // The thing `isDailyTodayCloseProvisionalForPaint` exists for: a today bar cached at
    // 11:00 holds an 11:00 close. After the bell it must NOT be the first frame.
    clock.retarget(MIDSESSION_ISO)
    memPut('MIDS', 'D', dailyEndingAt('2026-09-22'))
    clock.retarget(AFTER_BELL_ISO)
    expect(await drawnWithin('MIDS', 400)).toBe(0)
    expect(netCalls.some(u => u.startsWith('/api/bars/MIDS'))).toBe(true)   // it waits on the server instead
  })
})
