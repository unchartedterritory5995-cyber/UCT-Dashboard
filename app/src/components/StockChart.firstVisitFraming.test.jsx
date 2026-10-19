import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

const mod = await import('./StockChart')
const StockChart = mod.default

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

  it('CONTROL: once the pack has ingested, a stuck read is waited on (has data, just busy)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    localStorage.setItem('barspack.version', '2026-10-16')
    await primeCached()
    idb.CCC = 'hang'
    render(<StockChart sym="CCC" tf="D" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(barsCalls().some(u => u.includes('/api/bars/CCC'))).toBe(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(3500) })
    expect(barsCalls().some(u => u.includes('/api/bars/CCC'))).toBe(true)
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
