// The render-window facade on the REAL renderer (lightweight-charts 5.2.0 in jsdom).
// The library is handed only the window; the app keeps speaking full-history indices; a view that reaches left of
// the window extends it first; an extension never moves what is on screen; no series holds a time older than the
// candles' window; the live tail survives an extension; the switch turns it all off.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts'
import { createWindowedChart, rawOf, renderWindowRows, RENDER_WINDOW_OFF_KEY } from './windowedChart'

beforeAll(() => {
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'canvas') return { width: 900, height: 500 }
      if (k === 'measureText') return () => ({ width: 30, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
      return () => {}
    },
    set: () => true,
  })
  HTMLCanvasElement.prototype.getContext = () => ctx
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get() { return 900 }, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get() { return 500 }, configurable: true })
})
beforeEach(() => { localStorage.removeItem(RENDER_WINDOW_OFF_KEY) })

const N = 6000
const T = (i) => 1_500_000_000 + i * 86_400
const BARS = Array.from({ length: N }, (_, i) => ({ time: T(i), open: 100 + i % 7, high: 103 + i % 7, low: 98 + i % 7, close: 101 + i % 5 }))
const VOL = BARS.map((b) => ({ time: b.time, value: 1000 + (b.time % 97) }))
const MA = BARS.map((b, i) => (i < 20 ? { time: b.time } : { time: b.time, value: 101 + (i % 3) }))
const tick = () => new Promise((r) => setTimeout(r, 0))
// the library applies a range on its next frame (a timer in jsdom), as in a browser before the paint
const frame = () => new Promise((r) => setTimeout(r, 60))

function board() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const chart = createWindowedChart(createChart(el, { width: 900, height: 500, timeScale: { rightOffset: 8 } }))
  const candles = chart.addSeries(CandlestickSeries, {})
  const vol = chart.addSeries(HistogramSeries, { priceScaleId: 'vol' })
  const ma = chart.addSeries(LineSeries, {})
  chart.window.setPrimary(candles)
  return { chart, candles, vol, ma, ts: chart.timeScale() }
}
function load(b, rows = renderWindowRows(150, 0)) {
  b.chart.window.setWindow(rows, { span: 150 })
  b.candles.setData(BARS); b.vol.setData(VOL); b.ma.setData(MA)
}

describe('the render window facade', () => {
  it('hands the library only the window; the app still sees full-history indices and counts', async () => {
    const b = board(); load(b)
    const ws = b.chart.window.windowStart()
    expect(ws).toBe(5250)                                       // 6,000 - 600 rows, floored to a 250 step
    expect(rawOf(b.candles).data().length).toBe(N - ws)
    expect(b.candles.data().length).toBe(N)                     // what the app reads stays whole
    b.ts.setVisibleLogicalRange({ from: 5850, to: 6000 })
    await frame()
    const r = b.ts.getVisibleLogicalRange()
    expect(Math.round(r.from)).toBe(5850)
    expect(Math.round(r.to)).toBe(6000)
    expect(Math.round(rawOf(b.chart).timeScale().getVisibleLogicalRange().from)).toBe(5850 - ws)
    expect(b.candles.dataByIndex(5900).time).toBe(T(5900))
  })

  it('no series holds a time older than the candles\' window (the library\'s logical 0 is the earliest of ANY series)', () => {
    const b = board(); load(b)
    const wsTime = b.chart.window.windowStartTime()
    for (const s of [b.candles, b.vol, b.ma]) expect(rawOf(s).data()[0].time).toBeGreaterThanOrEqual(wsTime)
    expect(rawOf(b.chart).timeScale().timeToCoordinate(wsTime)).toBe(rawOf(b.chart).timeScale().logicalToCoordinate(0))
  })

  it('a view reaching left of the window extends it first, then lands exactly where asked', async () => {
    const b = board(); load(b)
    b.ts.setVisibleLogicalRange({ from: 3000, to: 3150 })
    await frame()
    expect(b.chart.window.windowStart()).toBeLessThanOrEqual(3000 - 600)
    const r = b.ts.getVisibleLogicalRange()
    expect(Math.round(r.from)).toBe(3000)
    expect(b.ts.getVisibleRange().from).toBe(T(3000))
    expect(rawOf(b.ma).data()[0].time).toBeGreaterThanOrEqual(b.chart.window.windowStartTime())
  })

  it('a time range left of the window extends it first (setVisibleRange no longer clamps at the window start)', async () => {
    const b = board(); load(b)
    b.ts.setVisibleRange({ from: T(1000), to: T(1100) })
    await frame()
    expect(b.chart.window.windowStart()).toBeLessThanOrEqual(1000)
    expect(b.ts.getVisibleRange().from).toBe(T(1000))
  })

  it('scrolling near the window start extends it before paint, and nothing on screen moves', async () => {
    const b = board(); load(b)
    const lib = rawOf(b.chart).timeScale()
    lib.setVisibleLogicalRange({ from: 30, to: 180 })           // a pan straight on the library, near its 0
    await frame()
    const before = { ...b.ts.getVisibleRange() }
    await frame()
    expect(b.chart.window.windowStart()).toBeLessThan(5400)      // extended
    expect(b.ts.getVisibleRange()).toEqual(before)               // the same bars on screen
  })

  it('coordinates translate both ways, and an older time still gets an x', async () => {
    const b = board(); load(b)
    b.ts.setVisibleLogicalRange({ from: 5850, to: 6000 })
    await frame()
    const ws = b.chart.window.windowStart()
    const lib = rawOf(b.chart).timeScale()
    expect(b.ts.logicalToCoordinate(5900)).toBe(lib.logicalToCoordinate(5900 - ws))
    const x = b.ts.logicalToCoordinate(5920)
    expect(Math.round(b.ts.coordinateToLogical(x))).toBe(5920)
    expect(lib.timeToCoordinate(T(100))).toBe(null)              // the library alone: unknown time
    expect(b.ts.timeToCoordinate(T(100))).toBe(lib.logicalToCoordinate(100 - ws))
  })

  it('the live tail survives an extension (the forming bar is not rolled back)', () => {
    const b = board(); load(b)
    const live = { ...BARS[N - 1], close: 999, high: 999 }
    b.candles.update(live)
    b.ts.setVisibleLogicalRange({ from: 2000, to: 2150 })        // extends: every series re-set
    const lib = rawOf(b.candles).data()
    expect(lib[lib.length - 1].close).toBe(999)
    expect(b.candles.data()[N - 1].close).toBe(999)
  })

  it('a new load of the SAME series keeps its start by time (an appended bar never moves it)', () => {
    // 5,849 bars: the start is floor((5,849 - 600) / 250) * 250 = 5,000; one more bar would make it 5,250
    const b = board()
    b.chart.window.setWindow(renderWindowRows(150, 0), { span: 150 })
    b.candles.setData(BARS.slice(0, 5849))
    const t0 = b.chart.window.windowStartTime()
    expect(t0).toBe(T(5000))
    b.candles.setData(BARS.slice(0, 5850))                       // the same load, one bar appended
    expect(b.chart.window.windowStartTime()).toBe(t0)
  })

  it('setWindow(null) hands the library every bar (compare / replay / pinned views)', async () => {
    const b = board(); load(b)
    b.chart.window.setWindow(null)
    expect(b.chart.window.windowStart()).toBe(0)
    expect(rawOf(b.candles).data().length).toBe(N)
    expect(rawOf(b.ma).data().length).toBe(N - 20)              // the library leaves out the 20 warm-up whitespace points
  })

  it('switched off in this browser: a pure pass-through', () => {
    localStorage.setItem(RENDER_WINDOW_OFF_KEY, '1')
    const b = board(); load(b)
    expect(b.chart.window.windowStart()).toBe(0)
    expect(rawOf(b.candles).data().length).toBe(N)
  })

  it('a short chart is never windowed (too little to save)', () => {
    const b = board()
    b.chart.window.setWindow(renderWindowRows(150, 0))
    b.candles.setData(BARS.slice(0, 1200))
    expect(b.chart.window.windowStart()).toBe(0)
  })
})
