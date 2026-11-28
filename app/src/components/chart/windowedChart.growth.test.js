// A LOAD WHOSE FIRST ROWS WERE TOO FEW FOR A WINDOW KEEPS ITS VIEW WHEN ITS HISTORY ARRIVES (2026-11-28, the zoomed-out
// boards' 'view-frame' refusals). A hidden chart (the double buffer's shadow) opens the next symbol from a short first
// page (800 rows) under a zoomed-out view lock (4,019 bars across); its history then joins (19,000 rows). With 800 rows
// the window is off (ws 0, no start time), so the next setData of the SAME load was placed as a new load's window.
//   G1 the view, counted from the newest bar, is the same after the history joins as before it (nothing moves)
//   G2 ...and the window is placed by the load's anchor once, after which further growth keeps its start TIME
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createChart, CandlestickSeries } from 'lightweight-charts'
import { createWindowedChart, rawOf, renderWindowRows, RENDER_WINDOW_OFF_KEY } from './windowedChart'

beforeAll(() => {
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'canvas') return { width: 400, height: 500 }
      if (k === 'measureText') return () => ({ width: 30, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
      return () => {}
    },
    set: () => true,
  })
  HTMLCanvasElement.prototype.getContext = () => ctx
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get() { return 400 }, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get() { return 500 }, configurable: true })
})
beforeEach(() => { localStorage.removeItem(RENDER_WINDOW_OFF_KEY) })

const T = (i) => 1_000_000_000 + i * 60
const rows = (n, total) => Array.from({ length: n }, (_, k) => { const i = total - n + k; return { time: T(i), open: 10 + (i % 7), high: 12 + (i % 7), low: 9 + (i % 7), close: 11 + (i % 5) } })
const frame = () => new Promise((r) => setTimeout(r, 40))
const W = 4019
const LOCK = { fromRight: 0.99 * W, toRight: (0.99 - 1) * W }   // anchorFrac 0.99, width 4019 (the zo-m1 board's lock)

function fromRight(b) {
  const r = b.ts.getVisibleLogicalRange()
  const last = b.candles.data().length - 1
  return { fromRight: Math.round((last - r.from) * 100) / 100, toRight: Math.round((last - r.to) * 100) / 100 }
}
function board() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const chart = createWindowedChart(createChart(el, { width: 400, height: 500, timeScale: { rightOffset: 8, minBarSpacing: 0.05 } }))
  const candles = chart.addSeries(CandlestickSeries, {})
  chart.window.setPrimary(candles)
  return { chart, candles, ts: chart.timeScale() }
}
// the chart framing its rows at the lock (StockChart: from = (n - 1) - anchorFrac * width), through the facade
const frameAtLock = (b) => { const last = b.candles.data().length - 1; b.ts.setVisibleLogicalRange({ from: last - LOCK.fromRight, to: last - LOCK.toRight }) }

describe('a load that grows from a short first page', () => {
  it('G1 the view counted from the newest bar does not move when the history joins', async () => {
    const b = board()
    b.chart.window.setWindow(renderWindowRows(W, 0), { span: W })
    b.candles.setData(rows(800, 19000))
    frameAtLock(b)
    await frame()
    const before = fromRight(b)
    expect(before.fromRight).toBeCloseTo(LOCK.fromRight, 1)
    // the history joins: the same load, older rows in front (the chart re-sets its whole array, keeping the view by
    // the newest bar, as its prepend path does)
    const r0 = b.ts.getVisibleLogicalRange()
    b.candles.setData(rows(19000, 19000))
    b.ts.setVisibleLogicalRange({ from: r0.from + 18200, to: r0.to + 18200 })
    await frame()
    expect(fromRight(b)).toEqual(before)
    // ...and a re-hand of the same rows (the chart's next pass) moves nothing either
    b.candles.setData(rows(19000, 19000))
    await frame()
    expect(fromRight(b)).toEqual(before)
  })

  it('G2 a short first page places no window; the joined history is windowed by the load, then keeps its start time', async () => {
    const b = board()
    b.chart.window.setWindow(renderWindowRows(W, 0), { span: W })
    b.candles.setData(rows(800, 19000))
    expect(b.chart.window.windowStart()).toBe(0)
    b.candles.setData(rows(19000, 19000))
    const ws1 = b.chart.window.windowStart()
    const t1 = b.chart.window.windowStartTime()
    b.candles.setData(rows(25000, 25000).map((r, i) => r))   // more history again
    expect(b.chart.window.windowStartTime()).toBe(t1)
    expect(rawOf(b.candles).data()[0].time).toBe(t1 ?? rows(25000, 25000)[0].time)
    expect(ws1).toBeGreaterThanOrEqual(0)
  })
})
