// ⚡ A CONTINUOUS ZOOM-OUT RE-SETS THE SERIES A HANDFUL OF TIMES, NOT EVERY FEW WHEEL TICKS (review of #2955, 2026-11-28).
//
// With a wide view's window at 1.25 screens and its margin a quarter screen, a zoom-out (the view widening every wheel
// tick, its right edge held) reached the margin every tick or two, and each extension re-set every series with the
// whole window (2-3 screens of rows). An extension of a wide view now reaches at least as many rows as the library
// already holds, so the window at least doubles: the extensions of a zoom-out are geometric.
//   Z1 (red before the change) zooming a 1,600-bar view out to 24,000 bars in 25% steps re-sets the series at most
//      log2(final / first window) + 2 times, and the rows handed over in all of them add up to at most 3x the final
//      window (master: one extension every tick or two, ~4x more rows)
//   Z2 nothing on screen moves: every step's visible range (full-history indices) is the one it asked for, and the
//      view never comes within the margin of the window start
//   Z3 a narrow view's extension is exactly as before (one reach of two screens, never `held`)
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts'
import { createWindowedChart, rawOf, renderWindowRows, extendedStart, RENDER_WINDOW_OFF_KEY, RENDER_WINDOW_MIN_BARS, RENDER_WINDOW_STEP } from './windowedChart'

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

const N = 40000
const SPAN = 1600
const T = (i) => 1_000_000_000 + i * 3600
const BARS = Array.from({ length: N }, (_, i) => ({ time: T(i), open: 100 + (i % 37), high: 104 + (i % 37) + (i % 5), low: 97 + (i % 37) - (i % 3), close: 101 + (i % 29) }))
const VOL = BARS.map((b) => ({ time: b.time, value: 1000 + (b.time % 97) }))
const frame = () => new Promise((r) => setTimeout(r, 30))

function board() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const chart = createWindowedChart(createChart(el, { width: 900, height: 500, timeScale: { rightOffset: 8, minBarSpacing: 0.01 } }))
  const candles = chart.addSeries(CandlestickSeries, {})
  const vol = chart.addSeries(HistogramSeries, { priceScaleId: 'vol' })
  chart.window.setPrimary(candles)
  // count the rows the library is handed by every setData of the candles
  const raw = rawOf(candles)
  const sets = []
  const real = raw.setData.bind(raw)
  raw.setData = (rows) => { sets.push(rows.length); return real(rows) }
  return { chart, candles, vol, ts: chart.timeScale(), sets }
}

describe('a continuous zoom-out', () => {
  it('Z1 + Z2 re-sets the series a handful of times, and nothing on screen moves', async () => {
    const b = board()
    b.chart.window.setWindow(renderWindowRows(SPAN, 0), { span: SPAN })
    b.candles.setData(BARS); b.vol.setData(VOL)
    b.ts.setVisibleLogicalRange({ from: N - SPAN, to: N + 8 })
    await frame()
    const first = b.sets[b.sets.length - 1]
    b.sets.length = 0
    let span = SPAN
    while (span < 24000) {
      span = Math.min(24000, Math.round(span * 1.25))
      const want = { from: N - span, to: N + 8 }
      b.ts.setVisibleLogicalRange(want)
      await Promise.resolve(); await Promise.resolve()          // the facade's range check (a microtask)
      const got = b.ts.getVisibleLogicalRange()
      expect(Math.abs(got.from - want.from)).toBeLessThan(0.01)   // Z2: the view is where it was asked to be
      expect(Math.abs(got.to - want.to)).toBeLessThan(0.01)
      expect(want.from - b.chart.window.windowStart()).toBeGreaterThanOrEqual(Math.ceil(span / 4) - 1)
      await frame()
    }
    const finalRows = N - b.chart.window.windowStart()
    const bound = Math.ceil(Math.log2(finalRows / first)) + 2
    expect(b.sets.length).toBeLessThanOrEqual(bound)                               // master: 9+
    expect(b.sets.reduce((a, x) => a + x, 0)).toBeLessThanOrEqual(3 * finalRows)  // master: ~4x more
  })

  it('Z3 a narrow view reaches exactly as before', () => {
    // narrow (600 bars across): the reach is two screens, whatever the window holds
    expect(extendedStart(10000, 10400, 600, 30000)).toBe(Math.floor((10400 - 1200) / RENDER_WINDOW_STEP) * RENDER_WINDOW_STEP)
    expect(extendedStart(10000, 10400, 600, 0)).toBe(extendedStart(10000, 10400, 600, 30000))
    // wide (2,000 across): at least what the window holds
    expect(extendedStart(20000, 20300, 2000, 8000)).toBe(Math.floor((20300 - 8000) / RENDER_WINDOW_STEP) * RENDER_WINDOW_STEP)
    expect(extendedStart(20000, 20300, 2000, 0)).toBe(Math.floor((20300 - Math.max(2000, RENDER_WINDOW_MIN_BARS)) / RENDER_WINDOW_STEP) * RENDER_WINDOW_STEP)
  })
})
