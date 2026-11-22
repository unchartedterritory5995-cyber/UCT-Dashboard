import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

// ─── THE DRAWING OVERLAY SEES THE BARS THE CANDLE SERIES IS BUILT FROM ─────────
//
// ChartDrawingOverlay maps points BY INDEX: a future point (a trendline extended past
// the last candle) is drawn at logical `bars.length - 1 + futureBars`, a point whose
// time is not a series key falls back to `logicalToCoordinate(nearestIndex(t))`, and a
// click resolves `bars[coordinateToLogical(x)]`. In the RTH-only view the candle
// series is session-filtered while the overlay used to receive the RAW `bars` (with
// pre/post-market rows) — every one of those indices was off by the number of
// extended-hours bars. These tests drive the real StockChart and compare the overlay's
// `bars` to what the candle series was given. All prices are synthetic.

const H = vi.hoisted(() => ({ series: [], onBar: null, delivering: true, prices: {}, e1: [], overlay: [] }))

vi.mock('./chart/ChartDrawingOverlay', () => ({
  default: (props) => { H.overlay.push(props); return null },
}))

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

vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: H.prices, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({
  default: ({ onBar, session, symbol }) => { H.onBar = onBar; H.session = session; H.pushSymbol = symbol; return { connected: true, healthy: true, delivering: H.delivering, lastBarT: { current: null } } },
}))
vi.mock('../lib/barsStreamManager', () => ({
  subscribe: (sym, tf, cbs) => { H.e1.push({ sym, tf, ...(cbs || {}) }); return () => {} },
  getStatus: () => ({ connected: false, healthy: false, delivering: false }),
  getLastResume: () => null,
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

// Mon 2026-11-09, 5m bars 08:00 → 17:55 ET (EST = UTC-5): pre-market, RTH, post-market.
const ET0800 = Date.UTC(2026, 10, 9, 13, 0, 0) / 1000
const BARS = Array.from({ length: 120 }, (_, i) => ({ t: ET0800 + i * 300, o: 20, h: 20.3, l: 19.7, c: 20, v: 1000 }))
const etMin = (t) => { const d = new Date((t - 5 * 3600) * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes() }
const RTH = BARS.filter(b => etMin(b.t) >= 570 && etMin(b.t) < 960)

let StockChart
// cold import of the ~22k-line module: once, with room (a per-test hook hit the 10 s default)
beforeAll(async () => { StockChart = (await import('./StockChart')).default }, 60000)
const candle = () => H.series.find(s => s.__ctor === 'CandlestickSeries')
const lastOverlay = () => H.overlay.at(-1)

beforeEach(async () => {
  cleanup()
  H.series.length = 0
  H.overlay.length = 0
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.UTC(2026, 10, 10, 17, 0, 0))
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

async function mount(forceExtendedHours, extra = {}) {
  render(<StockChart sym="SYN" tf="5" barsOverride={extra.bars || BARS} forceExtendedHours={forceExtendedHours} showDrawingTools {...extra.props} />)
  await act(async () => { await Promise.resolve() })
}

describe('drawing overlay bars == candle series bars', () => {
  it('RTH-only view: the overlay gets the session-filtered series, not the raw bars', async () => {
    expect(RTH.length).toBeGreaterThan(0)
    expect(RTH.length).toBeLessThan(BARS.length)
    await mount(false)
    const ov = lastOverlay()
    expect(ov).toBeTruthy()
    expect(candle().__data.length).toBe(RTH.length)
    expect(ov.bars.length).toBe(candle().__data.length)
    expect(ov.bars.map(b => b.t)).toEqual(RTH.map(b => b.t))
    // a trendline extended 3 bars past the close lands on the series' slot
    // (last RTH index + 3), not 3 bars past the last POST-market bar
    const futureLogical = (ov.bars.length - 1) + 3
    expect(futureLogical).toBe(candle().__data.length - 1 + 3)
  })

  it('CONTROL extended view: overlay and series both carry every bar', async () => {
    await mount(true)
    const ov = lastOverlay()
    expect(candle().__data.length).toBe(BARS.length)
    expect(ov.bars.length).toBe(BARS.length)
  })

  it('replay cutoff: a point after the cursor keeps its true slot (no clamp onto the cursor candle)', async () => {
    // two sessions; the replay cutoff hides the second
    const DAY = 24 * 3600
    const two = [...BARS, ...BARS.map(b => ({ ...b, t: b.t + DAY }))]
    const rth2 = two.filter(b => etMin(b.t) >= 570 && etMin(b.t) < 960)
    await mount(false, { bars: two, props: { replayCutoff: '2026-11-09' } })
    const ov = lastOverlay()
    const series = candle().__data
    expect(series.length).toBe(RTH.length)                       // the series stops at the cutoff
    // indices the series has are the series' own (RTH alignment kept) ...
    expect(ov.bars.slice(0, series.length).map(b => b.t)).toEqual(RTH.map(b => b.t))
    // ... and a stored time on the hidden day resolves PAST the cursor, at its real slot
    expect(ov.bars.length).toBe(rth2.length)
    const after = rth2[RTH.length + 10].t
    const idx = ov.bars.findIndex(b => b.t === after)
    expect(idx).toBe(series.length + 10)
  })
})
