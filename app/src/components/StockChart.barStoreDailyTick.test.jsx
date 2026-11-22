// P3-S2b — BARSTORE with push GATED OFF (prod: VITE_REALTIME_BARS=0): the D candle, its volume and
// the legend follow the live tick source through the store — never a frozen bar, never a second
// feed. Synthetic prices only.
//   • every live-price tick moves the painted D candle (close, H/L union) and its volume (the live
//     day volume, through the store's one fold) — at tick cadence, no React render needed;
//   • the off-cursor legend prints the store's close and the % vs the PRIOR daily bar's close.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'

const S = vi.hoisted(() => ({ series: [], subs: new Set(), snap: { prices: {} } }))
vi.mock('../lib/realtimeBarsGate', () => ({ realtimeBarsEnabled: () => false }))
vi.mock('../lib/priceStreamManager', () => ({
  subscribe: (_t, cb) => { S.subs.add(cb); return () => S.subs.delete(cb) },
  getSnapshot: () => S.snap,
  getLastResume: () => 0, reconnectNow: () => {}, isConnected: () => false, _resetForTests: () => {},
  MAX_SSE_TICKERS: 50, REBUILD_DEBOUNCE_MS: 400,
}))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const make = (type) => {
    const s = {
      kind: type === real.CandlestickSeries ? 'candle' : type === real.HistogramSeries ? 'volume' : 'other',
      points: [],
      setData: (d) => { s.points = Array.isArray(d) ? d.map((p) => ({ ...p })) : [] },
      update: (p) => {
        const last = s.points[s.points.length - 1]
        const key = (x) => (typeof x === 'object' && x ? `${x.year}-${x.month}-${x.day}` : String(x))
        if (last && key(last.time) === key(p.time)) s.points[s.points.length - 1] = { ...p }
        else s.points.push({ ...p })
      },
      data: () => s.points,
      applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
      createPriceLine: () => ({ applyOptions: () => {} }), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
      detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
      getPane: () => ({ paneIndex: () => 0 }), priceFormatter: () => ({ format: (x) => String(x) }),
      dataByIndex: () => null, barsInLogicalRange: () => null,
      subscribeDataChanged: () => {}, unsubscribeDataChanged: () => {},
    }
    S.series.push(s)
    return s
  }
  const chart = {
    addSeries: (type) => make(type),
    addCandlestickSeries: () => make(real.CandlestickSeries), addHistogramSeries: () => make(real.HistogramSeries),
    addLineSeries: () => make(null), addAreaSeries: () => make(null), addBarSeries: () => make(null),
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
      setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
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
vi.mock('../utils/barsIDB', async (orig) => ({ ...(await orig()), idbGet: async () => null, idbPut: async () => {}, idbPutMonotonic: async () => {} }))
// The chart's quote hook sees the same feed (its prev_close / change_pct must NOT drive the D %).
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: S.snap.prices, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

// Tue 2026-11-10 11:00 ET (EST) — the session is open; today's daily bar is forming.
const clock = pinWallClock('2026-11-10T16:00:00Z')
afterAll(() => clock.restore())
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))
const candle = () => S.series.filter((s) => s.kind === 'candle').at(-1)
const volume = () => S.series.filter((s) => s.kind === 'volume').at(-1)
const dailyRows = () => {
  const out = []
  const d = new Date(Date.UTC(2026, 6, 1))
  while (out.length < 90) {
    const iso = d.toISOString().slice(0, 10)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6 && iso < '2026-11-10') out.push({ t: iso, o: 99, h: 101, l: 98, c: 100, v: 1_000_000 })
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const tick = (price, volume) => {
  S.snap = { prices: { ...S.snap.prices, DTX: { price, volume, prev_close: 101.9, change_pct: 0.5 } } }
  for (const cb of S.subs) cb()
}

describe('BARSTORE + push gated off: the D candle, volume and legend follow the tick source', () => {
  let M
  beforeAll(async () => {
    const rows = dailyRows()
    vi.stubGlobal('fetch', vi.fn((url) => {
      const u = String(url)
      if (!u.includes('/api/bars/DTX')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
      if (fetch.mock.calls.filter((c) => String(c[0]).includes('/api/bars/DTX')).length > 1) return new Promise(() => {})
      const dev = { t: '2026-11-10', o: 101, h: 102, l: 100.5, c: 101.5, v: 400_000 }
      const body = { ticker: 'DTX', tf: 'D', bars: [...rows, dev], developing: dev }
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => body })
    }))
    M = await loadWithBarStore(true, async () => ({ StockChart: (await import('./StockChart')).default }))
  })
  afterAll(() => cleanup())

  it('each tick moves the painted candle + volume; the legend prints the store close and % vs the prior bar', async () => {
    expect(M.__barStore).toBe(true)
    S.snap = { prices: { DTX: { price: 101.5, volume: 400_000, prev_close: 101.9, change_pct: 0.5 } } }   // the quote the chart renders with
    render(<M.StockChart sym="DTX" tf="D" backgroundWarm={false} alwaysShowLegend />)
    await wait(800)
    expect(candle()?.points.length, 'painted').toBeGreaterThan(50)
    let hi = 102, lo = 100.5
    const seq = [[101.83, 420_000], [103.21, 455_000], [100.12, 470_000], [102.47, 470_000], [104.37, 512_345]]
    for (const [px, vol] of seq) {
      await act(async () => { tick(px, vol) })
      await wait(40)   // one frame: the dev channel paints
      hi = Math.max(hi, px); lo = Math.min(lo, px)
      const P = candle().points.at(-1)
      expect(P, `tick ${px}`).toMatchObject({ open: 101, high: hi, low: lo, close: px })
      expect(volume().points.at(-1).value, `volume at ${px}`).toBe(vol)
    }
    await wait(700)    // the off-cursor legend refreshes (≤ 500 ms)
    const text = document.body.textContent
    expect(text).toContain('104.37')
    // % vs the PRIOR daily bar's close (100): +4.37 % — not the feed's prev_close / change_pct
    expect(text).toMatch(/4\.37\s*%/)
  })
})
