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

  it('D2b the price line and last-value tags never show the cut bar as the last price', async () => {
    // (review of #2970, F1) both options on, as the chart sets them on the candles and the averages / volume
    const b = board()
    for (const s of [b.candles, b.vol, b.ma]) s.applyOptions({ priceLineVisible: true, lastValueVisible: true })
    await openDated(b)
    expect(b.chart.window.windowEnd()).not.toBeNull()
    for (const s of [b.candles, b.vol, b.ma]) {
      expect(rawOf(s).options().priceLineVisible).toBe(false)            // the library draws no line at the cut's close
      expect(rawOf(s).options().lastValueVisible).toBe(false)            // ... and no axis tag
      expect(s.options().priceLineVisible).toBe(true)                    // the app's own choice, as it set it
      expect(s.options().lastValueVisible).toBe(true)
    }
    // the app turns a tag off and on while cut: kept for later, never handed to the library
    b.ma.applyOptions({ lastValueVisible: false, color: '#123456' })
    expect(rawOf(b.ma).options().color).toBe('#123456')
    expect(b.ma.options().lastValueVisible).toBe(false)
    b.ma.applyOptions({ lastValueVisible: true })
    expect(rawOf(b.ma).options().lastValueVisible).toBe(false)
    // the view goes to the present: the cut goes, and every tag is the app's again (at the true newest bar)
    b.ts.scrollToPosition(4, false)
    await frame()
    expect(b.chart.window.windowEnd()).toBeNull()
    for (const s of [b.candles, b.vol, b.ma]) {
      expect(rawOf(s).options().priceLineVisible).toBe(true)
      expect(rawOf(s).options().lastValueVisible).toBe(true)
    }
    expect(rawOf(b.candles).data().at(-1).time).toBe(T(N - 1))
    // a view with no cut never touches them
    const a = board()
    a.candles.applyOptions({ priceLineVisible: true, lastValueVisible: true })
    await openDated(a, 0)
    expect(rawOf(a.candles).options().priceLineVisible).toBe(true)
  })

  it('D3b an end extension leaves the view exactly where it was; a rightOffset change takes the cut away', async () => {
    // (review of #2970, F2) pans right in small steps: every extension of the end puts the view back as it found it
    const b = board(); await openDated(b)
    const we0 = b.chart.window.windowEnd()
    let moved = 0
    for (let k = 0; k < 12 && b.chart.window.windowEnd() === we0; k++) {
      const r = b.ts.getVisibleLogicalRange()
      const want = { from: r.from + 100, to: r.to + 100 }
      b.ts.setVisibleLogicalRange(want)
      await frame()
      const got = b.ts.getVisibleLogicalRange()
      if (Math.abs(got.from - want.from) > 0.01 || Math.abs(got.to - want.to) > 0.01) moved++
    }
    expect(b.chart.window.windowEnd()).not.toBe(we0)                    // the end did move right
    expect(moved).toBe(0)
    // StockChart's live Right margin (timeScale().applyOptions({ rightOffset })) re-scrolls to the right edge: the
    // newest bar, not the cut's
    b.ts.applyOptions({ rightOffset: 5 })
    await frame()
    expect(b.chart.window.windowEnd()).toBeNull()
    expect(rawOf(b.candles).data().at(-1).time).toBe(T(N - 1))
  })

  it('D3c a drag that shows the cut bar extends the end and leaves the view where the drag put it', async () => {
    // (review of #2970, F2) the library moves its own view (a drag, a kinetic scroll) past the margin in one step, so
    // the cut's last bar is on screen when the end extends: the re-set must not scroll the view to keep that bar in view
    const b = board(); await openDated(b)
    const ws = b.chart.window.windowStart()
    const held = b.chart.window.windowEnd() - ws
    const raw = rawOf(b.ts)
    const want = { from: held - SPAN + 40, to: held + 40 }      // library indices: the last held bar 40 bars inside the view
    raw.setVisibleLogicalRange(want)
    await frame()
    expect(b.chart.window.windowEnd() === null || b.chart.window.windowEnd() - ws > held).toBe(true)   // the end moved
    const got = b.ts.getVisibleLogicalRange()
    expect(Math.abs(got.from - (want.from + ws))).toBeLessThan(0.01)
    expect(Math.abs(got.to - (want.to + ws))).toBeLessThan(0.01)
  })

  it('D8 a view near the present is never cut', async () => {
    const b = board(); await openDated(b, 300, N - 1 - 300 - SPAN)
    expect(b.chart.window.windowEnd()).toBeNull()
    expect(rawOf(b.candles).data().at(-1).time).toBe(T(N - 1))
  })
})
