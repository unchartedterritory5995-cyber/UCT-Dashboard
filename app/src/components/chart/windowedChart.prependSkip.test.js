// The render-window facade on the REAL renderer: a prepend behind the window (the history deepening) hands the library
// nothing when the window's rows are unchanged.
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

// ⭐ (2026-11-27, the second full draw after a typed Enter) the history deepening joins OLDER rows behind the view, and the
// chart hands every series its whole new array (setData). With the window on, the library's window starts at the same
// TIME (the anchor of the same load), so the cut it would be handed is the very rows it holds: the library's setData
// (every series re-set in its model, its time points redone) bought nothing. The facade now hands nothing when the
// cut equals the rows it last handed and nothing was update()d since.
const OLDER = Array.from({ length: 3000 }, (_, i) => ({ time: T(i - 3000), open: 90, high: 92, low: 88, close: 91 }))
const copy = (rows) => rows.map((r) => ({ ...r }))   // the chart builds new row objects on every pass
// every library setData, counted per series, at the library's own method (the facade calls the original it captured at
// addSeries, so the count is installed on the series prototype before the board is made)
const LIB = { counts: new Map() }
let protoPatched = false
function patchProto() {
  if (protoPatched) return
  const el = document.createElement('div')
  document.body.appendChild(el)
  const s = createChart(el, { width: 900, height: 500 }).addSeries(LineSeries, {})
  const proto = Object.getPrototypeOf(s)
  const orig = proto.setData
  proto.setData = function (d) { LIB.counts.set(this, (LIB.counts.get(this) || 0) + 1); return orig.call(this, d) }
  protoPatched = true
}
function spySets(b) {
  const base = {}
  for (const k of ['candles', 'vol', 'ma']) base[k] = LIB.counts.get(rawOf(b[k])) || 0
  return new Proxy({}, {
    get: (_t, k) => (LIB.counts.get(rawOf(b[k])) || 0) - base[k],
    ownKeys: () => ['candles', 'vol', 'ma'],
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  })
}
const counts = (sets) => ({ candles: sets.candles, vol: sets.vol, ma: sets.ma })
const libRows = (s) => JSON.stringify(rawOf(s).data())

describe('a prepend behind the window hands the library nothing', () => {
  beforeAll(() => patchProto())
  it('older rows joined (new arrays, same values in the window): no library setData, the same library rows and view', async () => {
    const b = board(); load(b)
    b.ts.setVisibleLogicalRange({ from: 5850, to: 6000 })
    await frame()
    const before = { c: libRows(b.candles), v: libRows(b.vol), m: libRows(b.ma), t: JSON.stringify(b.ts.getVisibleRange()) }
    const sets = spySets(b)
    b.candles.setData([...OLDER, ...copy(BARS)])
    b.vol.setData([...OLDER.map((r) => ({ time: r.time, value: 5 })), ...copy(VOL)])
    b.ma.setData([...OLDER.map((r) => ({ time: r.time })), ...copy(MA)])
    b.ts.setVisibleLogicalRange({ from: 5850 + 3000, to: 6000 + 3000 })   // the chart's re-anchor: bars from the right kept
    await frame()
    expect(counts(sets)).toEqual({ candles: 0, vol: 0, ma: 0 })
    expect(libRows(b.candles)).toBe(before.c)
    expect(libRows(b.vol)).toBe(before.v)
    expect(libRows(b.ma)).toBe(before.m)
    expect(JSON.stringify(b.ts.getVisibleRange())).toBe(before.t)
    expect(b.candles.data().length).toBe(N + 3000)                // the app reads the whole new history
  })

  it('control: a value that changed inside the window is handed over', async () => {
    const b = board(); load(b)
    const sets = spySets(b)
    const next = copy(BARS)
    next[N - 10] = { ...next[N - 10], close: next[N - 10].close + 1 }
    b.candles.setData([...OLDER, ...next])
    expect(sets.candles).toBe(1)
  })

  it('control: after a live update() the next setData is handed over (the library holds the updated bar)', async () => {
    const b = board(); load(b)
    b.candles.update({ ...BARS[N - 1], close: 999 })
    const sets = spySets(b)
    b.candles.setData([...OLDER, ...copy(BARS)])
    expect(sets.candles).toBe(1)
    expect(rawOf(b.candles).data().at(-1).close).toBe(BARS[N - 1].close)
  })

  it('control: the same array changed in place and handed again reaches the library (review of #2903)', async () => {
    const b = board()
    b.chart.window.setWindow(renderWindowRows(150, 0), { span: 150 })
    const rows = copy(BARS.slice(0, 500))            // short: no window, the library is handed this very array
    b.candles.setData(rows)
    const sets = spySets(b)
    rows.push({ time: T(500), open: 1, high: 2, low: 0.5, close: 1.5 })
    b.candles.setData(rows)
    expect(sets.candles).toBe(1)
    expect(rawOf(b.candles).data().at(-1).time).toBe(T(500))
  })

  // (review of #2903) a re-hand of the SAME rows (new objects, equal values, no older history: the chart re-merging the
  // axis after another series joined it, StockChart.symSwitchPinned's compare series) is handed as before
  it('control: equal rows handed again WITHOUT older history at the front still reach the library', async () => {
    const b = board(); load(b)
    const sets = spySets(b)
    b.candles.setData(copy(BARS))
    expect(sets.candles).toBe(1)
  })
})
