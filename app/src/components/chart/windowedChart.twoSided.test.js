// ⚡ PHASE E1, SECOND HALF (2026-11-28): A DATED VIEW'S WINDOW IS CUT ON THE RIGHT TOO, ON THE REAL RENDERER.
//
// A view scrolled back in history was handed every bar from its window start to the newest (a 60m view of 2012: ~40k
// rows for the ~2k on screen). With `setWindow(rows, { span, tail })` naming the bars right of the view, a view more
// than RENDER_WINDOW_RIGHT_CUT_MIN bars (and two screens) back ends its window a margin right of the view.
//   D1 (red before the change) a dated view hands the library only the bars around it, not everything to the newest
//   D2 the same picture as the window without a right cut (range in full indices, times, x of the edge bars, prices)
//   D3 panning right extends the end before paint; nothing on screen moves; the view keeps its right margin
//   D4 a live bar right of the cut never reaches the library; going to the present (scrollToRealTime) takes the cut away
//      and the library then holds it
//   D5 a bar right of the cut still answers: timeToIndex (full index), timeToCoordinate, dataByIndex, barsInLogicalRange
//   D6 markers right of the cut are not handed to the plugin, and come back when the cut goes
//   D7 scrollPosition counts from the NEWEST bar, as on a window with no right cut; scrollToPosition goes to the present
//   D8 a view near the present is never cut
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createChart, createSeriesMarkers, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts'
import { createWindowedChart, createWindowedMarkers, rawOf, renderWindowRows, RENDER_WINDOW_OFF_KEY } from './windowedChart'

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
const T = (i) => 1_500_000_000 + i * 3600
const BARS = Array.from({ length: N }, (_, i) => ({ time: T(i), open: 100 + (i % 37), high: 104 + (i % 37) + (i % 5), low: 97 + (i % 37) - (i % 3), close: 101 + (i % 29) }))
const VOL = BARS.map((b) => ({ time: b.time, value: 1000 + (b.time % 97) }))
const MA = BARS.map((b, i) => (i < 20 ? { time: b.time } : { time: b.time, value: 101 + (i % 31) }))
const frame = () => new Promise((r) => setTimeout(r, 60))
const FROM = 3000
const SPAN = 600
const TAIL = N - 1 - (FROM + SPAN)

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
async function openDated(b, tail = TAIL, from = FROM, span = SPAN) {
  b.chart.window.setWindow(renderWindowRows(span, N - from), { span, tail })
  b.candles.setData(BARS); b.vol.setData(VOL); b.ma.setData(MA)
  b.ts.setVisibleLogicalRange({ from, to: from + span })
  await frame()
}
function picture(b) {
  const r = b.ts.getVisibleLogicalRange()
  const vr = b.ts.getVisibleRange()
  const from = Math.ceil(r.from)
  const to = Math.floor(r.to)
  return {
    range: [Math.round(r.from * 1000) / 1000, Math.round(r.to * 1000) / 1000],
    times: [vr.from, vr.to],
    xFirst: Math.round(b.ts.logicalToCoordinate(from) * 1000) / 1000,
    xLast: Math.round(b.ts.logicalToCoordinate(to) * 1000) / 1000,
    priceTop: Math.round(b.candles.coordinateToPrice(0) * 1e6) / 1e6,
    priceBottom: Math.round(b.candles.coordinateToPrice(400) * 1e6) / 1e6,
  }
}

describe('a dated view is cut on the right too', () => {
  it('D1 the library holds only the bars around the view', async () => {
    const b = board(); await openDated(b)
    const held = rawOf(b.candles).data()
    const we = b.chart.window.windowEnd()
    expect(we).not.toBeNull()
    expect(held.length).toBe(we - b.chart.window.windowStart())
    expect(held.length).toBeLessThanOrEqual(3500)                            // master: ~9,750 (window start to newest)
    expect(held[held.length - 1].time).toBeLessThan(b.chart.window.windowEndTime())
    expect(held[held.length - 1].time).toBeGreaterThanOrEqual(T(FROM + SPAN))   // the view and its margin are inside
    for (const s of [b.vol, b.ma]) expect(rawOf(s).data().at(-1).time).toBeLessThan(b.chart.window.windowEndTime())
    expect(b.candles.data().length).toBe(N)
  })

  it('D2 the same picture as the window with no right cut', async () => {
    const a = board(); await openDated(a, 0)
    const b = board(); await openDated(b)
    expect(a.chart.window.windowEnd()).toBeNull()
    expect(rawOf(b.candles).data().length).toBeLessThan(rawOf(a.candles).data().length)
    expect(picture(b)).toEqual(picture(a))
  })

  it('D3 a pan right extends the end before paint; nothing moves; the view keeps its margin', async () => {
    const b = board(); await openDated(b)
    const lib = rawOf(b.chart).timeScale()
    let we = b.chart.window.windowEnd()
    let moved = 0
    for (let step = 0; step < 8; step++) {
      const cur = lib.getVisibleLogicalRange()
      lib.setVisibleLogicalRange({ from: cur.from + 250, to: cur.to + 250 })   // a drag straight on the library
      await frame()
      const before = picture(b)
      await frame()
      expect(picture(b)).toEqual(before)
      const now = b.chart.window.windowEnd()
      if (now !== we) moved += 1
      we = now
      if (we != null) expect(we - b.ts.getVisibleLogicalRange().to).toBeGreaterThanOrEqual(150 - 1)
    }
    expect(moved).toBeGreaterThan(0)
  })

  it('D4 a live bar right of the cut stays out of the library until the view goes to the present', async () => {
    const b = board(); await openDated(b)
    const n0 = rawOf(b.candles).data().length
    const live = { time: T(N), open: 130, high: 140, low: 125, close: 135 }
    b.candles.update(live)
    expect(rawOf(b.candles).data().length).toBe(n0)
    expect(b.candles.data().at(-1)).toEqual(live)                              // the app's rows have it
    b.ts.scrollToRealTime()
    await frame()
    expect(b.chart.window.windowEnd()).toBeNull()
    expect(rawOf(b.candles).data().at(-1).time).toBe(T(N))                     // re-applied after the cut went
    // (the library animates this scroll; where a scroll to the present lands is D7's, with an unanimated scrollToPosition)
  })

  it('D5 a bar right of the cut still answers', async () => {
    const b = board(); await openDated(b)
    const i = b.chart.window.windowEnd() + 500
    expect(b.ts.timeToIndex(T(i))).toBe(i)
    expect(b.ts.timeToCoordinate(T(i))).toBeCloseTo(b.ts.logicalToCoordinate(i), 6)
    expect(b.candles.dataByIndex(i).time).toBe(T(i))
    const a = board(); await openDated(a, 0)
    const r = { from: FROM, to: FROM + SPAN }
    expect(b.candles.barsInLogicalRange(r)).toEqual(a.candles.barsInLogicalRange(r))
  })

  it('D6 markers right of the cut are not handed to the plugin, and come back when the cut goes', async () => {
    const b = board(); await openDated(b)
    const handed = []
    const plugin = (s, m) => { const inner = createSeriesMarkers(s, m); handed.push(m.length); return new Proxy(inner, { get: (t, k) => (k === 'setMarkers' ? (x) => { handed.push(x.length); return t.setMarkers(x) } : t[k]) }) }
    const all = [FROM + 10, FROM + 300, N - 5].map((i) => ({ time: T(i), position: 'aboveBar', shape: 'circle', color: '#fff' }))
    const mk = createWindowedMarkers(plugin, b.candles, all)
    expect(handed.at(-1)).toBe(2)
    expect(mk.markers()).toHaveLength(3)
    b.ts.scrollToRealTime()
    await frame()
    expect(handed.at(-1)).toBe(3)
  })

  it('D7 scrollPosition counts from the newest bar; scrollToPosition goes to the present', async () => {
    const a = board(); await openDated(a, 0)
    const b = board(); await openDated(b)
    expect(Math.round(b.ts.scrollPosition())).toBe(Math.round(a.ts.scrollPosition()))
    b.ts.scrollToPosition(4, false)
    await frame()
    expect(b.chart.window.windowEnd()).toBeNull()
    expect(b.ts.getVisibleRange().to).toBe(T(N - 1))
  })

  it('D8 a view near the present is never cut', async () => {
    const b = board(); await openDated(b, 300, N - 1 - 300 - SPAN)
    expect(b.chart.window.windowEnd()).toBeNull()
    expect(rawOf(b.candles).data().at(-1).time).toBe(T(N - 1))
  })
})
