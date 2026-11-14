import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { BARSTORE_MODES, loadWithBarStore } from '../testing/barStoreModes'
import { render, cleanup, act } from '@testing-library/react'

// Two first-visit chart fixes (2026-10-18), measured on production:
//  1. While the first pack ingest runs, a ticker whose cache read is stuck behind it waits
//     the short first-paint timeout, not the 4 s "this browser has a cache" patience.
//  2. A frame set on a symbol switch is restated as a distance from the newest bar
//     (scrollToPosition), because LWC stores the view against the axis it holds at that
//     moment, which can still be the previous symbol's longer one.

const H = vi.hoisted(() => ({ scrolls: [], range: null, series: [] }))

vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  // Anything the chart calls that is not modelled here is a harmless no-op.
  const lenient = (o) => new Proxy(o, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? () => undefined : undefined)) })
  const makeSeries = () => {
    const s = {
      _data: [],
      setData: (d) => { s._data = Array.isArray(d) ? d : [] }, data: () => s._data,
      update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
      createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
      detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
      seriesType: () => 'Candlestick', getPane: () => null,
    }
    H.series.push(s)
    return lenient(s)
  }
  const ts = lenient({
    applyOptions: () => {}, fitContent: () => {},
    setVisibleLogicalRange: (r) => { H.range = r ? { from: r.from, to: r.to } : null },
    getVisibleLogicalRange: () => (H.range ? { ...H.range } : null),
    setVisibleRange: () => {}, scrollToPosition: (pos) => { H.scrolls.push(pos) },
    subscribeVisibleLogicalRangeChange: () => {}, unsubscribeVisibleLogicalRangeChange: () => {},
    timeToCoordinate: () => 0, coordinateToTime: () => null, resetTimeScale: () => {}, options: () => ({}),
    width: () => 600, getVisibleRange: () => null,
  })
  const chart = lenient({
    addSeries: () => makeSeries(), addCandlestickSeries: makeSeries, addHistogramSeries: makeSeries,
    addLineSeries: makeSeries, addAreaSeries: makeSeries, addBarSeries: makeSeries,
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ts,
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div'), getSeries: () => [] }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  })
  return {
    ...real,
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {}, BaselineSeries: {}, createSeriesMarkers: () => ({ setMarkers: () => {} }),
  }
})
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))
// The cache: `idb[sym]` is the entry it holds, `'hang'` a read that never resolves.
const idb = vi.hoisted(() => ({}))
vi.mock('../utils/barsIDB', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    idbGet: vi.fn((sym) => (idb[sym] === 'hang' ? new Promise(() => {}) : Promise.resolve(idb[sym] || null))),
    idbPut: vi.fn(() => Promise.resolve()),
    idbDelete: vi.fn(() => Promise.resolve()),
  }
})

const days = (n, end = '2026-10-16') => {
  const out = []
  const d = new Date(`${end}T00:00:00Z`)
  for (let i = 0; i < n; i++) {
    const t = new Date(d.getTime() - (n - 1 - i) * 86400000).toISOString().slice(0, 10)
    out.push({ t, o: 10, h: 11, l: 9, c: 10.5, v: 1000 })
  }
  return out
}
const barsBy = {}
const barsCalls = () => fetch.mock.calls.map(c => String(c[0])).filter(u => u.includes('/api/bars/'))

beforeEach(() => {
  cleanup()
  H.scrolls.length = 0
  for (const k of Object.keys(idb)) delete idb[k]
  vi.stubGlobal('fetch', vi.fn((url) => {
    const m = String(url).match(/\/api\/bars\/([^?]+)/)
    const body = m ? { ticker: m[1], tf: 'D', bars: barsBy[m[1]] || days(300) } : {}
    const res = { ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve(body) }
    res.clone = () => res
    return Promise.resolve(res)
  }))
  try { localStorage.clear() } catch { /* ignore */ }
})
afterEach(() => { vi.useRealTimers() })

let mod, StockChart, __barStore

// P3-S1: every case runs under BOTH bar sources (chart/barStoreSwitch.js, read once at module
// load → the graph is re-imported per mode; testing/barStoreModes.js).
describe.each(BARSTORE_MODES)('BARSTORE=%s', (barStoreOn) => {
  beforeAll(async () => {
    mod = await loadWithBarStore(barStoreOn, () => import('./StockChart'))
    StockChart = mod.default; __barStore = mod.__barStore
  })
  it('the module graph under test holds this switch value (non-vacuity)', () => {
    expect(__barStore).toBe(barStoreOn)
  })

  describe('first visit: a cache read stuck behind the pack ingest', () => {
    // Make this browser "have a cache": one ticker resolves from IDB.
    const primeCached = async () => {
      idb.AAA = { bars: days(300), lastT: '2026-10-16', savedAt: Date.now() }
      const r = render(<StockChart sym="AAA" tf="D" />)
      await act(async () => { await vi.advanceTimersByTimeAsync(50) })
      r.unmount()
    }

    it('while the pack is still ingesting, the server is asked after the short wait', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      await primeCached()
      idb.BBB = 'hang'
      render(<StockChart sym="BBB" tf="D" />)
      await act(async () => { await vi.advanceTimersByTimeAsync(700) })
      expect(barsCalls().some(u => u.includes('/api/bars/BBB'))).toBe(true)
    })

    // ⭐ (2026-11-14) NO LONGER DIFFERS BY SOURCE. This was the one case whose expectation
    // did (P3-S1): the legacy selector gated its request on the IDB read (patient 4 s once this
    // browser has shown a cache) while the BarStore never waits on a cache. The legacy daily
    // path full-fetched after the read anyway, so the wait bought nothing, and on production it
    // was 217-484 ms of empty chart on 8 of 40 flips of a new list. The legacy selector now lets
    // a D/W/M request go after `IDB_DWM_GRACE_MS` (chart/useLegacyChartBars.js): one request,
    // not held by the read, under either source. StockChart.dailyCacheGrace.test.jsx holds what
    // happens to the stores when the read lands late.
    it(barStoreOn
      ? 'BARSTORE: a stuck cache read never holds the request (hydrate runs beside it)'
      : 'a stuck cache read does not hold a DAILY request past the grace, even once the pack has ingested', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      localStorage.setItem('barspack.version', '2026-10-16')
      await primeCached()
      idb.CCC = 'hang'
      render(<StockChart sym="CCC" tf="D" />)
      await act(async () => { await vi.advanceTimersByTimeAsync(700) })
      expect(barsCalls().filter(u => u.includes('/api/bars/CCC')).length).toBe(1)
    })

    // The legacy selector's own switch brings the old wait back (has data, just busy: 4 s).
    if (!barStoreOn) it('CONTROL: with `uct.barsgrace.off` set, a stuck read is waited on once the pack has ingested', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      localStorage.setItem('barspack.version', '2026-10-16')
      localStorage.setItem('uct.barsgrace.off', '1')
      try {
        await primeCached()
        idb.DDD = 'hang'
        render(<StockChart sym="DDD" tf="D" />)
        await act(async () => { await vi.advanceTimersByTimeAsync(700) })
        expect(barsCalls().some(u => u.includes('/api/bars/DDD'))).toBe(false)
        await act(async () => { await vi.advanceTimersByTimeAsync(3500) })
        expect(barsCalls().some(u => u.includes('/api/bars/DDD'))).toBe(true)
      } finally {
        localStorage.removeItem('uct.barsgrace.off')
      }
    })
  })

  describe('a symbol switch restates its frame from the newest bar', () => {
    it('scrollToPosition carries the frame as an offset from the NEW symbol\'s newest bar', async () => {
      barsBy.LONG = days(600)
      barsBy.SHORT = days(300)
      const { rerender } = render(<StockChart sym="LONG" tf="D" />)
      await act(async () => { await new Promise(r => setTimeout(r, 300)) })
      H.scrolls.length = 0
      rerender(<StockChart sym="SHORT" tf="D" />)
      await act(async () => { await new Promise(r => setTimeout(r, 300)) })
      expect(H.scrolls.length).toBeGreaterThan(0)
      const pos = H.scrolls[H.scrolls.length - 1]
      // The offset is measured from SHORT's newest bar (index 299), so it is a small right
      // pad, never ~300 bars of the previous symbol's longer axis.
      expect(pos).toBeGreaterThan(-1)
      expect(pos).toBeLessThan(40)
      expect(H.range.to - 299).toBeCloseTo(pos, 5)
    })
  })
})
