// ⚡ PHASE E1 (2026-11-28): A WIDE VIEW IS HANDED 1.25 SCREENS OF BARS, NOT THREE, ON THE REAL RENDERER.
//
// renderWindowRows sized every load's window at 3 screens of the view it opens at. A zoomed-out view is ~1,800 bars
// across on this 900 px chart at the library's 0.5 px floor (and 4-14k at 0.1 px), so a switch handed the library
// 5,400+ rows (12-42k at 0.1 px) for bars no frame draws: setData 29-132 ms (zero-network plan, E1). Above
// RENDER_WINDOW_WIDE_SPAN bars across the window is now 1.25 screens (a quarter-screen margin) and a pan extends it a
// screen at a time, before paint.
//   W1 (red before the change) a 1,600-bar view hands the library at most 1.25 screens + the margin + one 250-row step
//   W2 a narrow view (at most RENDER_WINDOW_WIDE_SPAN across) is sized exactly as before: 3 screens, the same margin
//   W3 the SAME PICTURE: the wide window and the old 3-screen window show the same bars in the same places (visible
//      range in full-history indices, the newest and oldest visible bars' x, the price scale's range)
//   W4 panning a wide view left extends the window before paint, nothing on screen moves, and the view never comes
//      within the margin of the window start
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts'
import {
  createWindowedChart, rawOf, renderWindowRows, RENDER_WINDOW_OFF_KEY, RENDER_WINDOW_WIDE_SPAN, RENDER_WINDOW_WIDE_SCREENS,
  RENDER_WINDOW_MIN_BARS, RENDER_WINDOW_SCREENS, RENDER_WINDOW_MARGIN_BARS, RENDER_WINDOW_STEP,
} from './windowedChart'

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

const N = 12000
const SPAN = 1600
const T = (i) => 1_500_000_000 + i * 86_400
const BARS = Array.from({ length: N }, (_, i) => ({ time: T(i), open: 100 + (i % 37), high: 104 + (i % 37) + (i % 5), low: 97 + (i % 37) - (i % 3), close: 101 + (i % 29) }))
const VOL = BARS.map((b) => ({ time: b.time, value: 1000 + (b.time % 97) }))
const MA = BARS.map((b, i) => (i < 20 ? { time: b.time } : { time: b.time, value: 101 + (i % 31) }))
const frame = () => new Promise((r) => setTimeout(r, 60))

function board() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const chart = createWindowedChart(createChart(el, { width: 900, height: 500, timeScale: { rightOffset: 8, minBarSpacing: 0.5 } }))
  const candles = chart.addSeries(CandlestickSeries, {})
  const vol = chart.addSeries(HistogramSeries, { priceScaleId: 'vol' })
  const ma = chart.addSeries(LineSeries, {})
  chart.window.setPrimary(candles)
  return { chart, candles, vol, ma, ts: chart.timeScale() }
}
async function open(b, rows, span = SPAN) {
  b.chart.window.setWindow(rows, { span })
  b.candles.setData(BARS); b.vol.setData(VOL); b.ma.setData(MA)
  b.ts.setVisibleLogicalRange({ from: N - span, to: N + 8 })
  await frame()
}
/** What is on screen, read through the facade in full-history indices and pixels. */
function picture(b) {
  const r = b.ts.getVisibleLogicalRange()
  const vr = b.ts.getVisibleRange()
  const from = Math.ceil(r.from)
  const to = Math.min(N - 1, Math.floor(r.to))
  return {
    range: [Math.round(r.from * 1000) / 1000, Math.round(r.to * 1000) / 1000],
    times: [vr.from, vr.to],
    xFirst: Math.round(b.ts.logicalToCoordinate(from) * 1000) / 1000,
    xLast: Math.round(b.ts.logicalToCoordinate(to) * 1000) / 1000,
    priceTop: Math.round(b.candles.coordinateToPrice(0) * 1e6) / 1e6,
    priceBottom: Math.round(b.candles.coordinateToPrice(400) * 1e6) / 1e6,
  }
}
/** The rows a window of the OLD sizing (3 screens, a one-screen margin) holds. */
const oldRows = (s, l) => Math.max(RENDER_WINDOW_MIN_BARS, Math.ceil(s * RENDER_WINDOW_SCREENS), Math.ceil(l + Math.max(s, RENDER_WINDOW_MARGIN_BARS)) + 1)

describe('a wide view is handed 1.25 screens', () => {
  it('W1 a 1,600-bar view hands the library at most 1.25 screens + the margin + one step', async () => {
    const b = board()
    await open(b, renderWindowRows(SPAN, SPAN))
    const held = rawOf(b.candles).data().length
    const cap = Math.ceil(SPAN * RENDER_WINDOW_WIDE_SCREENS) + 1 + RENDER_WINDOW_STEP
    expect(held).toBeLessThanOrEqual(cap)
    expect(held).toBeLessThan(oldRows(SPAN, SPAN))          // (the old sizing: 4,800 rows)
    expect(b.candles.data().length).toBe(N)                  // the app's view stays whole
    expect(b.chart.window.windowStart()).toBeGreaterThan(0)
  })

  it('W2 a narrow view is sized exactly as before', () => {
    for (const s of [0, 1, 67, 150, 300, 599, 800, RENDER_WINDOW_WIDE_SPAN]) {
      for (const l of [0, s, 2 * s + 40, 5000]) expect([s, l, renderWindowRows(s, l)]).toEqual([s, l, oldRows(s, l)])
    }
  })

  it('W3 the same picture as the 3-screen window', async () => {
    const a = board(); await open(a, oldRows(SPAN, SPAN))
    const b = board(); await open(b, renderWindowRows(SPAN, SPAN))
    expect(rawOf(b.candles).data().length).toBeLessThan(rawOf(a.candles).data().length)
    expect(picture(b)).toEqual(picture(a))
  })

  it('W4 a pan left extends before paint; nothing on screen moves; the view keeps its margin', async () => {
    const b = board(); await open(b, renderWindowRows(SPAN, SPAN))
    const lib = rawOf(b.chart).timeScale()
    let extensions = 0
    let ws = b.chart.window.windowStart()
    for (let step = 0; step < 6; step++) {
      const cur = lib.getVisibleLogicalRange()
      lib.setVisibleLogicalRange({ from: cur.from - 300, to: cur.to - 300 })   // a drag straight on the library
      await frame()
      const before = picture(b)
      await frame()
      expect(picture(b)).toEqual(before)                                         // an extension moved nothing
      const now = b.chart.window.windowStart()
      if (now < ws) extensions += 1
      ws = now
      const from = b.ts.getVisibleLogicalRange().from
      if (ws > 0) expect(from - ws).toBeGreaterThanOrEqual(Math.ceil(SPAN / 4) - 1)
    }
    expect(extensions).toBeGreaterThan(0)
  })
})
