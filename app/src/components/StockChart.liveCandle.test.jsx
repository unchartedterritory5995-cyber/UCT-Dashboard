import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

// ─── THE INTRADAY DEVELOPING CANDLE, THROUGH THE REAL StockChart ──────────────
//
// lib/liveBarMerge.test.js proves the merge rules as pure functions. This file
// proves they are WIRED: the real StockChart, a 5m intraday series, the Massive
// push writer (B) authoritative, and the post-poll re-top (D) — with
// lightweight-charts replaced by a recorder whose update() has the real library's
// semantics (same time → replace, later → append, earlier → throw).
// All prices are synthetic.

const H = vi.hoisted(() => ({ series: [], onBar: null, delivering: true }))

vi.mock('lightweight-charts', () => {
  const makeSeries = (ctor, options) => {
    const s = {
      __ctor: ctor, __options: { ...(options || {}) }, __data: [],
      setData: (d) => { s.__data = [...(d || [])] },
      update: (p, historical) => {
        if (!p) return
        if (historical) {
          const i = s.__data.findIndex(d => d.time === p.time)
          if (i < 0) throw new Error('historical update of a missing time')
          s.__data = [...s.__data.slice(0, i), p, ...s.__data.slice(i + 1)]
          return
        }
        const last = s.__data[s.__data.length - 1]
        if (last && typeof p.time === 'number' && typeof last.time === 'number' && p.time < last.time) {
          throw new Error('Cannot update oldest data')
        }
        if (last && last.time === p.time) s.__data = [...s.__data.slice(0, -1), p]
        else s.__data = [...s.__data, p]
      },
      applyOptions: (o) => { Object.assign(s.__options, o || {}) },
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
      createPriceLine: () => ({ applyOptions: () => {} }), removePriceLine: () => {}, setMarkers: () => {},
      attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => s.__options,
      moveToPane: () => {}, getPane: () => ({ getHeight: () => 300 }),
      dataByIndex: () => null, data: () => s.__data,
    }
    H.series.push(s)
    return s
  }
  const timeScale = new Proxy({
    applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {},
    getVisibleLogicalRange: () => null, getVisibleRange: () => null, setVisibleRange: () => {},
    scrollToPosition: () => {}, scrollPosition: () => 0, timeToCoordinate: () => 0,
    coordinateToTime: () => null, logicalToCoordinate: () => 0, coordinateToLogical: () => 0,
    options: () => ({}), width: () => 600, height: () => 40, barSpacing: () => 6,
  }, { get: (t, p) => (p in t ? t[p] : (typeof p === 'symbol' || p === 'then') ? undefined : () => undefined) })
  const chart = {
    addSeries: (ctor, options) => makeSeries(ctor, options),
    addCustomSeries: (_i, options) => makeSeries('custom', options),
    removeSeries: () => {}, applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [0, 1, 2, 3].map(() => ({
      getHeight: () => 300, setHeight: () => {},
      getHTMLElement: () => document.createElement('div'),
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    })),
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: 'CandlestickSeries', HistogramSeries: 'HistogramSeries',
    LineSeries: 'LineSeries', AreaSeries: 'AreaSeries', BaselineSeries: 'BaselineSeries',
    BarSeries: 'BarSeries',
    createSeriesMarkers: () => ({ setMarkers: () => {} }),
  }
})

vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({
  default: ({ onBar }) => { H.onBar = onBar; return { connected: true, healthy: true, delivering: H.delivering, lastBarT: { current: null } } },
}))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

HTMLCanvasElement.prototype.getContext = function getContext() {
  const ctx = { canvas: null, measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop: () => {} }), getImageData: () => ({ data: [] }) }
  for (const m of ['clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'stroke', 'fill', 'save', 'restore', 'setLineDash', 'translate', 'scale', 'rotate', 'setTransform', 'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'rect', 'clip', 'drawImage', 'putImageData']) ctx[m] = () => {}
  return ctx
}

// 2026-11-09 (Mon) 14:07 ET = 19:07 UTC (EST). Bars every 5m from 10:00 ET.
const NOW_MS = Date.UTC(2026, 10, 9, 19, 7, 0)
const T1400 = Date.UTC(2026, 10, 9, 19, 0, 0) / 1000
const mkBars = (lastBar) => {
  const out = []
  for (let t = T1400 - 48 * 300; t < T1400; t += 300) out.push({ t, o: 20, h: 20.3, l: 19.7, c: 20, v: 1000 })
  out.push({ t: T1400, ...lastBar })
  return out
}

let StockChart
const candle = () => H.series.find(s => s.__ctor === 'CandlestickSeries')
const tail = () => { const d = candle().__data; return d[d.length - 1] }
const push = (tUnix, o, h, l, c, v, extra = {}) => act(() => {
  H.onBar({ sym: 'SYN', tf: '5', bar: { t: tUnix * 1000, o, h, l, c, v, ...extra } })
})

beforeEach(async () => {
  cleanup()
  H.series.length = 0
  H.onBar = null
  H.delivering = true
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW_MS)
  try { localStorage.removeItem('uct.barsPush.enabled') } catch { /* jsdom */ }
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
  StockChart = StockChart || (await import('./StockChart')).default
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

async function mount(lastBar) {
  const view = render(<StockChart sym="SYN" tf="5" barsOverride={mkBars(lastBar)} />)
  await act(async () => { await Promise.resolve() })
  return view
}

describe('developing intraday candle — push writer (B) + poll re-top (D)', () => {
  it('a push frame narrower than the fetched partial does NOT shrink the painted H/L', async () => {
    await mount({ o: 20.0, h: 20.8, l: 19.6, c: 20.1, v: 5000 })
    expect(H.onBar).toBeTypeOf('function')
    const offset = tail().time - T1400   // chart time = unix + ET offset
    push(T1400, 20.3, 20.5, 20.0, 20.4, 1200)
    expect(tail()).toMatchObject({ time: T1400 + offset, open: 20.0, high: 20.8, low: 19.6, close: 20.4 })
    push(T1400, 20.3, 20.6, 20.1, 20.2, 1300)
    expect(tail()).toMatchObject({ high: 20.8, low: 19.6, close: 20.2 })
  })

  it('poll landing mid-bucket with a LOWER server high keeps the live H/L and close', async () => {
    const view = await mount({ o: 20.0, h: 20.3, l: 19.9, c: 20.1, v: 5000 })
    push(T1400, 20.0, 20.9, 19.5, 20.6, 7000)
    expect(tail()).toMatchObject({ high: 20.9, low: 19.5, close: 20.6 })
    // The 30s poll arrives with the server's lagging snapshot of the same bucket.
    view.rerender(<StockChart sym="SYN" tf="5" barsOverride={mkBars({ o: 20.0, h: 20.5, l: 19.8, c: 20.3, v: 6500 })} />)
    await act(async () => { await Promise.resolve() })
    expect(tail()).toMatchObject({ open: 20.0, high: 20.9, low: 19.5, close: 20.6 })
  })

  it('bucket roll: the new candle opens clean (no fusion), a late prior-bucket frame is ignored, and a poll that has not seen the new bucket does not blank it', async () => {
    const view = await mount({ o: 20.0, h: 20.8, l: 19.6, c: 20.1, v: 5000 })
    const offset = tail().time - T1400
    push(T1400 + 300, 20.2, 20.25, 20.15, 20.2, 50)
    expect(tail()).toMatchObject({ time: T1400 + 300 + offset, open: 20.2, high: 20.25, low: 20.15 })
    push(T1400, 20.0, 21.5, 19.0, 21.4, 6000)          // late prior-bucket frame
    expect(tail()).toMatchObject({ time: T1400 + 300 + offset, high: 20.25, low: 20.15, close: 20.2 })
    push(T1400 + 300, 20.2, 20.3, 20.1, 20.28, 90)
    // Poll lands; server tail is still the 14:00 bucket.
    view.rerender(<StockChart sym="SYN" tf="5" barsOverride={mkBars({ o: 20.0, h: 20.8, l: 19.6, c: 20.1, v: 5100 })} />)
    await act(async () => { await Promise.resolve() })
    expect(tail()).toMatchObject({ time: T1400 + 300 + offset, open: 20.2, high: 20.3, low: 20.1, close: 20.28 })
  })
})

describe('developing intraday candle — live volume', () => {
  it('volume never decreases within the bucket when a push frame carries less than the fetched partial', async () => {
    await mount({ o: 20.0, h: 20.8, l: 19.6, c: 20.1, v: 5000 })
    const vol = H.series.find(s => s.__ctor === 'HistogramSeries' && s.__data.length && s.__data[s.__data.length - 1].value === 5000)
    expect(vol).toBeTruthy()
    push(T1400, 20.3, 20.5, 20.0, 20.4, 1200)   // since-subscribe rollup volume
    expect(vol.__data[vol.__data.length - 1].value).toBe(5000)
    push(T1400, 20.3, 20.5, 20.0, 20.4, 5600)
    expect(vol.__data[vol.__data.length - 1].value).toBe(5600)
  })
})

describe('fallback (push NOT delivering) — Writer C on 1m', () => {
  const mk1m = (lastBar) => {
    const out = []
    for (let t = T1400 - 120 * 60; t < T1400; t += 60) out.push({ t, o: 20, h: 20.3, l: 19.7, c: 20, v: 100 })
    out.push({ t: T1400, ...lastBar })
    return out
  }
  it('the since-subscribe registry minute never shrinks the fetched minute, and a bar_close without o/h/l never paints undefined', async () => {
    H.delivering = false
    const rc = await import('../lib/realtimeCandle')
    rc._reset()
    render(<StockChart sym="SYN" tf="1" barsOverride={mk1m({ o: 20.0, h: 20.8, l: 19.6, c: 20.1, v: 5000 })} />)
    await act(async () => { await Promise.resolve() })
    const offset = tail().time - T1400
    act(() => { rc.applyTick('SYN', 20.4, 300, T1400 + 20) })
    expect(tail()).toMatchObject({ time: T1400 + offset, open: 20.0, high: 20.8, low: 19.6, close: 20.4 })
    act(() => { rc.applyBarClose('SYN', '1', { t: T1400, c: 20.35, v: 5200 }) })
    const b = tail()
    for (const k of ['open', 'high', 'low', 'close']) expect(Number.isFinite(b[k])).toBe(true)
    expect(b).toMatchObject({ open: 20.0, high: 20.8, low: 19.6, close: 20.35 })
  })
})

describe('W-B contract: a FINAL bar with an OLDER t than the developing bar', () => {
  it('replaces that closed bar in place and leaves the developing candle alone', async () => {
    await mount({ o: 20.0, h: 20.8, l: 19.6, c: 20.1, v: 5000 })
    const offset = tail().time - T1400
    push(T1400 + 300, 20.2, 20.25, 20.15, 20.2, 50)        // developing 14:05
    push(T1400, 20.0, 20.9, 19.5, 20.15, 5400, { final: true, trade_ts: (T1400 + 299) * 1000 })
    const d = candle().__data
    expect(d[d.length - 1]).toMatchObject({ time: T1400 + 300 + offset, open: 20.2, high: 20.25, low: 20.15, close: 20.2 })
    expect(d[d.length - 2]).toMatchObject({ time: T1400 + offset, open: 20.0, high: 20.9, low: 19.5, close: 20.15 })
    push(T1400 + 300, 20.2, 20.3, 20.1, 20.28, 90)
    expect(tail()).toMatchObject({ time: T1400 + 300 + offset, high: 20.3, low: 20.1, close: 20.28 })
  })
})
