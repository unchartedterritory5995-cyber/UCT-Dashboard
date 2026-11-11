// app/src/components/chart/engine/__tests__/priceFormatMinMove.realChart.test.js
//
// ─── B1: A TAG PRINTS THE DECIMALS IT CLAIMS ────────────────────────────────
//
// Decision B1 (2026-11-07): every engine series sets `minMove = 10^-precision`
// beside `precision`. Without it, lightweight-charts 5.2.0's `PriceFormatter`
// ROUNDS to the series' `minMove` (default 0.01) and only PADS to `precision`:
// its base is `10^precision / (minMove * 10^precision)`, i.e. 1 / minMove. So the
// RS line's 4-decimal tag printed 0.2500 for 0.2477 (visual review D1, which
// `precision: 4` alone was meant to fix and did not) and MACD's 5-decimal
// histogram printed 0.12000 for 0.12345.
//
// A recording double cannot answer "what text does the tag show": that is the
// library's arithmetic. So this drives the REAL `lightweight-charts` and reads
// `series.priceFormatter()`, the formatter the axis tag and crosshair label use.
// The options are not hand-written: they come from the real
// `seriesOptionsForPlot` for the real shipped plots. Each case carries a CONTROL
// with the pre-B1 shape, so the file fails if the library ever stops rounding
// to `minMove` (and the fix would no longer be what makes the difference).

import { describe, it, expect, beforeAll } from 'vitest'
import { createChart, LineSeries, HistogramSeries } from 'lightweight-charts'
import { seriesOptionsForPlot } from '../pool'
import { fundamentalPriceFormat } from '../fundamentalFormat'
import * as registry from '../nativeRegistry'

// jsdom needs a 2D context and a non-zero layout. File-scoped: vitest gives every
// test file its own jsdom. Nothing here draws; only formatters are read.
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

const plotOf = (defId, key) => registry.getDefinition(defId).plots.find((p) => p.key === key)

function seriesWith(ctor, options) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const chart = createChart(el, { width: 800, height: 400 })
  return chart.addSeries(ctor, options)
}

const tag = (series, v) => series.priceFormatter().format(v)

describe('B1 on the real renderer: the tag keeps every declared decimal', () => {
  it('the RS line (precision 4) prints 0.2477, not 0.2500', () => {
    const plot = plotOf('rsLine', 'rsLine')
    expect(plot.precision).toBe(4)
    expect(tag(seriesWith(LineSeries, seriesOptionsForPlot(plot, {})), 0.2477)).toBe('0.2477')
    // CONTROL: the pre-B1 option shape on the same renderer.
    expect(tag(seriesWith(LineSeries, { priceFormat: { type: 'price', precision: 4 } }), 0.2477)).toBe('0.2500')
  })

  it("the RS line's average (precision 4) prints its fourth decimal too", () => {
    const plot = plotOf('rsLine', 'rsMa')
    expect(tag(seriesWith(LineSeries, seriesOptionsForPlot(plot, {})), 0.2531)).toBe('0.2531')
  })

  it("MACD's histogram (precision 5) prints 0.12345, not 0.12000", () => {
    const plot = plotOf('macd', 'histogram')
    expect(plot.precision).toBe(5)
    expect(tag(seriesWith(HistogramSeries, seriesOptionsForPlot(plot, {})), 0.12345)).toBe('0.12345')
    expect(tag(seriesWith(HistogramSeries, { priceFormat: { type: 'price', precision: 5 } }), 0.12345)).toBe('0.12000')
  })

  it('a plot that declares nothing is unchanged: two decimals, as before', () => {
    const plot = plotOf('rsi', 'rsi')
    expect(plot.precision).toBeUndefined()
    const engine = seriesWith(LineSeries, seriesOptionsForPlot(plot, {}))
    const bare = seriesWith(LineSeries, {})
    for (const v of [52.3456, 0.004, 70]) expect(tag(engine, v), String(v)).toBe(tag(bare, v))
  })

  it('a pooled series re-purposed from a fundamental does not keep its whole-unit step', () => {
    // LWC's `merge` keeps any `priceFormat` key the new object omits. A
    // `compact_usd` fundamental sets `minMove: 1`; a 4-decimal plot binding onto
    // that series must not inherit it.
    const plot = plotOf('rsLine', 'rsLine')
    const s = seriesWith(LineSeries, { priceFormat: fundamentalPriceFormat('compact_usd') })
    s.applyOptions(seriesOptionsForPlot(plot, {}))
    expect(tag(s, 0.2477)).toBe('0.2477')
    // CONTROL: the pre-B1 shape inherits the step of 1 and shows nothing useful.
    const c = seriesWith(LineSeries, { priceFormat: fundamentalPriceFormat('compact_usd') })
    c.applyOptions({ priceFormat: { type: 'price', precision: 4 } })
    expect(tag(c, 0.2477)).toBe('0.0000')
  })
})
