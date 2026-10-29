// app/src/components/chart/engine/__tests__/fillRealChart.test.js
//
// ─── ⭐⭐ THE FILL WINDOW ON THE REAL lightweight-charts, WITH DAILY STRINGS ────
//
// ⚰️ The first cut of the fill visible-window change was railed only against a
// double with NUMERIC times, and it accepted numeric times only. Production daily
// bars reach the fill as 'YYYY-MM-DD' strings (`bars_fetch._fmt_sqlite_bars`;
// `StockChart`'s `adjustTime` shifts numbers only; the binder hands
// `bars.map(adjustTime(bar.t))`), so every D/W/M chart — the case the change was
// for — silently kept the full walk. Review measured it: 104 vs 5,000
// `timeToCoordinate` calls per paint.
//
// ⭐ So this file drives the primitive through the REAL library — its own time
// scale, its own `timeToCoordinate` / `priceToCoordinate`, its own string-time
// handling — and asserts the two things that matter:
//
//   1. the WINDOWED path is the one taken: coordinate calls per paint are bounded
//      by the viewport and do not grow with the series;
//   2. what reaches the canvas equals the full walk, segment for segment.
//
// ⚠️ `fakeChart.js`'s time scale has no `width()` (its `width: () => 0` is the
// PRICE scale's), so the older fill suites all draw through the full-walk
// fallback. That is deliberate — their pins are byte-level, and that fake's
// `t * 10` mapping puts real timestamps far off any canvas — and it is why the
// windowed path is covered here and in `fillVisibleWindow.test.js`, not there.
import { describe, it, expect, beforeAll } from 'vitest'
import { createChart, LineSeries, CandlestickSeries } from 'lightweight-charts'
import { createFillPrimitive, EDGE_BARS } from '../fillPrimitive'
import { createRecordingCtx } from './fakeChart'
import { band, isoDay, visibleSegments } from './fillTestKit'

// jsdom needs a 2D context and a non-zero layout — the same file-scoped patch
// `autoscaleOnARealScale.test.js` uses. Nothing the library draws is asserted;
// the fill is drawn onto a RECORDING context below.
beforeAll(() => {
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'canvas') return { width: 800, height: 400 }
      if (k === 'measureText') return () => ({ width: 30, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
      return () => {}
    },
    set: () => true,
  })
  HTMLCanvasElement.prototype.getContext = () => ctx
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get() { return 800 }, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get() { return 400 }, configurable: true })
})

/** A real chart in production's order: daily candles (string times), the host
 *  line series, the last `visible` bars in view. Coordinate calls are counted on
 *  the library's own API objects. */
function realChart(n, { visible = 80, from } = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const chart = createChart(el, { width: 800, height: 400 })
  const data = band(n, { phase: n, iso: true })
  const candles = data.times.map((time, i) => {
    const c = (data.upper[i] + data.lower[i]) / 2
    return { time, open: c - 0.5, high: c + 2, low: c - 2, close: c + 0.5 }
  })
  chart.addSeries(CandlestickSeries, {}).setData(candles)
  const host = chart.addSeries(LineSeries, {})
  host.setData(data.times.map((time, i) => ({ time, value: data.upper[i] })))
  const start = from === undefined ? n - visible : from
  chart.timeScale().setVisibleLogicalRange({ from: start, to: start + visible })
  const ts = chart.timeScale()
  const counts = { time: 0, price: 0 }
  const t0 = ts.timeToCoordinate.bind(ts)
  ts.timeToCoordinate = (t) => { counts.time += 1; return t0(t) }
  const p0 = host.priceToCoordinate.bind(host)
  host.priceToCoordinate = (p) => { counts.price += 1; return p0(p) }
  return { chart, host, ts, data, counts, calls: () => counts.time + counts.price, reset: () => { counts.time = 0; counts.price = 0 } }
}

function drawOn(env, chartArg, data = env.data) {
  const prim = createFillPrimitive({ ...data, color: '#2962FF', opacity: 0.2 })
  prim.primitive.attached({ chart: chartArg, series: env.host, requestUpdate: () => {} })
  const rec = createRecordingCtx()
  prim.primitive.paneViews()[0].renderer().draw(rec.target)
  return { rec, prim }
}

/** The full walk through the same real coordinates: a chart whose time scale
 *  offers no `width()` cannot prove a window, so the primitive walks it all. */
const blind = (env) => ({ timeScale: () => ({ timeToCoordinate: (t) => env.ts.timeToCoordinate(t) }) })

describe('the fill window on the REAL lightweight-charts, daily string times', () => {
  it('⛔⛔ NON-VACUITY — the fixture is the production shape and the chart really lays out', () => {
    const env = realChart(500)
    expect(env.data.times[0]).toBe(isoDay(0))
    expect(typeof env.data.times[0], 'daily bars must be strings here').toBe('string')
    expect(env.ts.width(), 'the time scale has no width — every path below would be the fallback').toBeGreaterThan(500)
    expect(env.ts.timeToCoordinate(env.data.times[0]), 'an off-screen bar still answers a coordinate in 5.2')
      .toBeLessThan(-1000)
  })

  it('⛔⛔ coordinate calls per paint are bounded by the viewport and independent of series length', () => {
    const per = (n) => {
      const env = realChart(n)
      env.reset()
      const { rec } = drawOn(env, env.chart)
      const r = env.ts.getVisibleLogicalRange()
      return { calls: env.calls(), polys: visibleSegments(rec, env.ts.width()).length, bars: Math.ceil(r.to - r.from) + 1 }
    }
    const small = per(500)
    const big = per(5000)
    // The library settles the range itself (it held ~133 bars at 6 px here), so
    // the bound is derived from ITS answer: three calls per visible bar plus the
    // 2×EDGE_BARS margin, the O(log n) window search and the 5-sample proof.
    const bound = 3 * (big.bars + 2 * EDGE_BARS + 2) + 2 * 14 + 5
    expect(big.calls, `5,000 daily bars made ${big.calls} coordinate calls in one paint (bound ${bound})`).toBeLessThanOrEqual(bound)
    expect(big.calls - small.calls, 'cost grew with history').toBeLessThanOrEqual(10)
    expect(big.polys).toBe(small.polys)
    // the control: the same chart, full walk, really is O(series)
    const env = realChart(5000)
    env.reset()
    drawOn(env, blind(env))
    expect(env.calls()).toBeGreaterThan(3 * 4900)
  })

  it('⛔⛔ what reaches the canvas equals the full walk — at the end, mid-series, and at the series start', () => {
    for (const from of [undefined, 2400.37, -12.6]) {
      const env = realChart(3000, { from })
      const w = env.ts.width()
      const windowed = visibleSegments(drawOn(env, env.chart).rec, w)
      const reference = visibleSegments(drawOn(env, blind(env)).rec, w)
      expect(reference.length, `NON-VACUITY at from=${from}: nothing on screen`).toBeGreaterThan(0)
      expect(windowed, `from=${from}`).toEqual(reference)
    }
  })

  it('⛔ an idle redraw on the real chart resolves no bars; a last-bar tick resolves one', () => {
    const env = realChart(5000)
    const { prim } = drawOn(env, env.chart)
    const redraw = () => {
      const rec = createRecordingCtx()
      prim.primitive.paneViews()[0].renderer().draw(rec.target)
      return rec
    }
    env.reset()
    redraw()
    const idle = env.calls()
    expect(idle, 'an idle real-chart redraw re-resolved bars').toBeLessThanOrEqual(2 * 13 + 5)
    const upper = Float64Array.from(env.data.upper)
    upper[4999] += 0.01
    prim.setOptions({ upper, times: env.data.times.slice() })
    env.reset()
    const rec = redraw()
    expect(env.calls()).toBeLessThanOrEqual(idle + 3)
    const w = env.ts.width()
    expect(visibleSegments(rec, w)).toEqual(visibleSegments(drawOn(env, blind(env), { ...env.data, upper }).rec, w))
  })
})
