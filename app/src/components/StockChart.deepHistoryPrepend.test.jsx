import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'

// ── W-S (2026-11-11): intraday deep history on the REAL component ────────────────
// Contracts:
//   1. After the dwell, deeper history is prefetched in the background as LEFT windows
//      (`&to=`), before any scroll — never a `bars=` whole-series re-download.
//   2. Scrolling toward the oldest bar loads the next left window; the newest drawn bar is
//      the same object time on every frame (the right edge never moves) and the drawn
//      count never shrinks.
//   3. The tail poll keeps its own key; `fetchDepth` never grows (no deep `bars=` ask).

const draws = vi.hoisted(() => ({ list: [], range: null, onRange: [] }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const series = {
    setData: (d) => {
      if (Array.isArray(d) && (d.length === 0 || d[0]?.open != null)) {
        draws.list.push({ n: d.length, firstT: d.length ? d[0].time : null, lastT: d.length ? d[d.length - 1].time : null })
      }
    },
    update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    getPane: () => ({ paneIndex: () => 0 }), priceFormatter: () => ({ format: (p) => String(p) }),
    dataByIndex: () => null, barsInLogicalRange: () => null,
  }
  const chart = {
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {},
      getVisibleLogicalRange: () => draws.range,
      setVisibleRange: () => {}, scrollToPosition: () => {},
      subscribeVisibleLogicalRangeChange: (cb) => { draws.onRange.push(cb) },
      unsubscribeVisibleLogicalRangeChange: (cb) => { draws.onRange = draws.onRange.filter(f => f !== cb) },
      timeToCoordinate: () => 0, coordinateToTime: () => null,
      resetTimeScale: () => {}, options: () => ({}), width: () => 600, logicalToCoordinate: () => 0,
      subscribeSizeChange: () => {}, unsubscribeSizeChange: () => {},
      subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    }),
    paneSize: () => ({ width: 600, height: 300 }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    subscribeDblClick: () => {}, unsubscribeDblClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return { ...real, createChart: () => chart, createSeriesMarkers: () => ({ setMarkers: () => {} }) }
})
vi.mock('../utils/barsIDB', async (orig) => {
  const real = await orig()
  return { ...real, idbGet: async () => null, idbPut: async () => {}, idbGetHistory: async () => null, idbPutHistory: async () => null }
})
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

// Tue 2026-09-22 13:17 ET — mid-session.
const clock = pinWallClock('2026-09-22T17:17:00Z')
afterAll(() => clock.restore())

const { default: StockChart, HISTORY_PREFETCH_TARGET_BARS } = await import('./StockChart')
const { memClear } = await import('../utils/barsMemCache')
const { etDateOf } = await import('../utils/historyPrepend')

// 60 RTH sessions of 15m bars ending today 13:15 ET (26 bars/session, EDT).
const DAY = 86400
const today930 = Math.floor(Date.UTC(2026, 8, 22, 13, 30) / 1000)
function fullHistory(sessions) {
  const out = []
  let d = 0, n = 0
  while (n < sessions) {
    const open = today930 - d * DAY
    const wd = new Date(open * 1000).getUTCDay()
    if (wd !== 0 && wd !== 6) {
      const bars = []
      for (let k = 0; k < 26; k++) {
        const t = open + k * 900
        if (d === 0 && t > today930 + 3 * 3600 + 45 * 60) break
        bars.push({ t, o: 10, h: 11, l: 9, c: 10.5, v: 100 })
      }
      out.unshift(...bars)
      n++
    }
    d++
  }
  return out
}
const FULL = fullHistory(500)                      // ~13k bars: deeper than any prefetch
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))
// act() flushes renders when it ENDS: step in short slices so each landed window renders.
const settle = async (ms) => { for (let t = 0; t < ms; t += 150) await wait(150) }

let reqs
function serve() {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    if (!u.includes('/api/bars/')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    const ticker = decodeURIComponent(u.match(/\/api\/bars\/([^?]+)/)[1]).toUpperCase()
    const n = Number((u.match(/[?&]bars=(\d+)/) || [])[1] || 600)
    const since = (u.match(/[?&]since=(\d+)/) || [])[1]
    const to = (u.match(/[?&]to=(\d{4}-\d{2}-\d{2})/) || [])[1]
    const tfq = (u.match(/[?&]tf=([^&]+)/) || [])[1]
    reqs.push({ url: u, n, tf: tfq, to: to || null, since: since ? Number(since) : null })
    if (tfq !== '15') return new Promise(() => {})      // other-tf warms: never answer, never counted
    let bars
    if (since) bars = FULL.filter(b => b.t > Number(since))
    else if (to) { const upto = FULL.filter(b => etDateOf(b.t) <= to); bars = upto.slice(Math.max(0, upto.length - n)) }
    else bars = FULL.slice(Math.max(0, FULL.length - n))
    const body = { ticker, tf: '15', bars, ...(since ? { delta: true } : {}) }
    return new Promise((res) => setTimeout(() => res({ ok: true, status: 200, json: async () => body }), 20))
  }))
}

beforeEach(() => {
  cleanup(); memClear()
  draws.list.length = 0; draws.onRange = []; draws.range = null; reqs = []
})

const fireRange = (from, to) => act(async () => {
  draws.range = { from, to }
  for (const cb of [...draws.onRange]) cb(draws.range)
  await new Promise((r) => requestAnimationFrame(() => r()))
})

describe('intraday deep history: left windows', { timeout: 60000 }, () => {
  it('prefetches older windows in the background after the dwell — `to=` only, never a deep `bars=`', async () => {
    serve()
    render(<StockChart sym="DEEPA" tf="15" />)
    await settle(6000)
    const left = reqs.filter(r => r.to)
    expect(left.length).toBeLessThanOrEqual(2)                       // PREFETCH_WINDOWS, not one more
    expect(left.length).toBeGreaterThan(0)
    // every non-window request stays under the deep threshold (no whole-series re-download)
    expect(reqs.filter(r => r.tf === '15' && !r.to && !r.since).every(r => r.n < 1200)).toBe(true)
    const drawn = draws.list.filter(d => d.n > 0)
    const last = drawn[drawn.length - 1]
    expect(last.n).toBeGreaterThanOrEqual(Math.min(HISTORY_PREFETCH_TARGET_BARS, FULL.length) * 0.35) // RTH-visible share
    expect(last.lastT).toBe(drawn[0].lastT)
  })

  it('scrolling toward the oldest bar loads the next window; right edge fixed, count never shrinks', async () => {
    serve()
    render(<StockChart sym="DEEPB" tf="15" />)
    await settle(6000)
    const before = reqs.filter(r => r.to).length
    const drawnBefore = draws.list.filter(d => d.n > 0)
    const rightEdge = drawnBefore[drawnBefore.length - 1].lastT
    const firstBefore = drawnBefore[drawnBefore.length - 1].firstT
    await fireRange(5, 205)              // member panned to the left edge
    await settle(1500)
    expect(reqs.filter(r => r.to).length).toBe(before + 1)
    const drawn = draws.list.filter(d => d.n > 0)
    for (let i = 1; i < drawn.length; i++) {
      expect(drawn[i].lastT).toBe(rightEdge)
      expect(drawn[i].n).toBeGreaterThanOrEqual(drawn[i - 1].n)
    }
    expect(drawn[drawn.length - 1].firstT).toBeLessThan(firstBefore)
    // a view far from the edge asks nothing
    const n = reqs.filter(r => r.to).length
    await fireRange(5000, 5200)
    await wait(200)
    expect(reqs.filter(r => r.to).length).toBe(n)
  })
})

describe('grid cells (backgroundWarm=false): no background herd', { timeout: 60000 }, () => {
  it('a grid cell fires NO background `to=` window; a scroll still loads one', async () => {
    serve()
    render(<StockChart sym="GRIDA" tf="15" backgroundWarm={false} />)
    await settle(4000)
    expect(reqs.filter(r => r.to).length).toBe(0)
    await fireRange(5, 205)
    await settle(1500)
    expect(reqs.filter(r => r.to).length).toBe(1)
    const drawn = draws.list.filter(d => d.n > 0)
    expect(drawn[drawn.length - 1].lastT).toBe(drawn[0].lastT)
  })
})
