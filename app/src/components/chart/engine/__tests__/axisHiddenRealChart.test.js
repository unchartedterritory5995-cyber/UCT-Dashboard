// app/src/components/chart/engine/__tests__/axisHiddenRealChart.test.js
//
// ─── A4 ON THE REAL RENDERER: lightweight-charts 5.2.0, in jsdom ────────────
//
// A recording double can say which options the binder sent; only the library can
// say what a pane's axis then DOES. This file drives the real `createChart` with
// the engine's own answers (`resolvePlacement` → `seriesOptionsForPlot`) and
// reads the scales back.
//
// It pins two things:
//
//   1. WHY the engine does not use `visible: false` — the option the contract
//      names. On any pane but the first it throws `Value is null` out of
//      `_adjustSizeImpl` on every resize (the chart freezes), and it leaks into
//      the chart-level `rightPriceScale` options every later pane is born from.
//      If a future lightweight-charts fixes this, the first case goes red and
//      says so, and the simpler mechanism becomes available.
//   2. THAT the overlay mechanism delivers the end state: the RS pane's right
//      scale holds nothing (no ticks, and no crosshair label, which the library
//      draws only on a non-empty left/right scale), the line still autoscales,
//      nothing leaks to the chart-level options, and an RSI pane keeps its axis.
//
// ⚠️ Two reads go through library internals (`_private__chartWidget`,
// `_internal_marks`), because tick marks have no public getter. They are the
// development build's names — the one vitest resolves — and each is used only to
// confirm what the public `getVisibleRange()` already says.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createChart, LineSeries, CandlestickSeries } from 'lightweight-charts'
import { resolvePlacement, HIDDEN_AXIS_SCALE_ID } from '../placement'
import { seriesOptionsForPlot } from '../pool'
import { __setPaneModeForTest } from '../paneLayout'
import * as registry from '../nativeRegistry'

beforeAll(() => { __setPaneModeForTest('panes') })
afterAll(() => { __setPaneModeForTest(null) })

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

const T = (i) => 1_700_000_000 + i * 86_400
const CANDLES = Array.from({ length: 120 }, (_, i) => ({ time: T(i), open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i }))
/** RS-ratio-shaped: 0.48 … 0.52. */
const RATIO = Array.from({ length: 120 }, (_, i) => ({ time: T(i), value: 0.5 + 0.02 * Math.sin(i / 6) }))
const RSI_VALUES = Array.from({ length: 120 }, (_, i) => ({ time: T(i), value: 50 + 20 * Math.sin(i / 6) }))

const RS = registry.getDefinition('rsLine')
const RS_HIDDEN = { ...RS, placement: { ...RS.placement, axis: 'hidden' } }
const RS_PLOT = RS.plots.find((p) => p.key === 'rsLine')
const RSI = registry.getDefinition('rsi')
const RSI_PLOT = RSI.plots.find((p) => p.key === 'rsi')

const RS1 = { instanceId: 'rsLine:1', defId: 'rsLine', inputs: {} }
const RSI1 = { instanceId: 'rsi:1', defId: 'rsi', inputs: {} }
const CTX = {
  paneLayout: { priceIndex: 0, panes: [{ key: 'price', index: 0 }, { key: RS1.instanceId, index: 1 }, { key: RSI1.instanceId, index: 2 }] },
  volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
}

function chartWithCandles() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const chart = createChart(el, { width: 800, height: 400 })
  chart.addSeries(CandlestickSeries, {}).setData(CANDLES)
  chart.timeScale().setVisibleLogicalRange({ from: 0, to: CANDLES.length - 1 })
  return chart
}

/** The engine's answer for one plot, bound the way the binder binds it. */
function bindEngine(chart, inst, def, plot, data) {
  const p = resolvePlacement(inst, def, CTX)
  const options = seriesOptionsForPlot(plot, {
    scaleId: p.scaleId, autoscale: p.autoscale, autoscaleRange: p.autoscaleRange, lastValue: p.lastValue,
  })
  const series = chart.addSeries(LineSeries, options, p.paneIndex)
  series.priceScale().applyOptions(p.scaleOptions)
  series.setData(data)
  return { series, placement: p, options }
}

const rightScaleOf = (chart, paneIndex) =>
  chart._private__chartWidget._internal_model()._internal_panes()[paneIndex]._internal_rightPriceScale()

describe('WHY NOT `visible: false` — measured on lightweight-charts 5.2.0', () => {
  it('on a non-first pane it throws out of every resize and leaks to the chart-level options', () => {
    const chart = chartWithCandles()
    const s = chart.addSeries(LineSeries, { priceScaleId: 'right' }, 1)
    s.setData(RATIO)
    s.priceScale().applyOptions({ visible: false })
    expect(() => chart.resize(800, 401, true)).toThrow(/Value is null/)
    expect(() => chart.resize(800, 402, true), 'it does not recover').toThrow(/Value is null/)
    expect(chart.options().rightPriceScale.visible, 'the per-pane write reached the chart-level bag').toBe(false)
  })
})

describe('THE ENGINE\'S HIDDEN AXIS — the end state on a real chart', () => {
  it('the RS pane\'s right scale is empty: no tick marks and nothing for a crosshair label to read', () => {
    const chart = chartWithCandles()
    const { series, placement, options } = bindEngine(chart, RS1, RS_HIDDEN, RS_PLOT, RATIO)
    expect(placement.scaleId).toBe(HIDDEN_AXIS_SCALE_ID)
    expect(options.priceScaleId).toBe(HIDDEN_AXIS_SCALE_ID)
    expect(options.lastValueVisible).toBe(false)
    expect(() => chart.resize(800, 401, true)).not.toThrow()

    // The pane's own right scale is never told `visible: false` (that is the
    // wedge above); it stays a visible, EMPTY scale beside an axis-less overlay.
    expect(chart.priceScale('right', 1).options().visible).toBe(true)
    expect(series.priceScale().options().visible, 'an overlay scale draws no axis widget').toBe(false)
    expect(chart.priceScale('right', 1).getVisibleRange()).toBeNull()
    const right = rightScaleOf(chart, 1)
    expect(right._internal_isEmpty()).toBe(true)        // the crosshair label's own guard
    expect(right._internal_marks()).toEqual([])         // no tick labels to draw
  })

  it('the line still autoscales, on its own overlay, to the data\'s extent', () => {
    const chart = chartWithCandles()
    const { series } = bindEngine(chart, RS1, RS_HIDDEN, RS_PLOT, RATIO)
    chart.resize(800, 401, true)
    const r = series.priceScale().getVisibleRange()
    expect(r).not.toBeNull()
    expect(r.from).toBeGreaterThan(0.47); expect(r.from).toBeLessThan(0.49)
    expect(r.to).toBeGreaterThan(0.51); expect(r.to).toBeLessThan(0.53)
    expect(series.priceToCoordinate(0.5)).not.toBeNull()
  })

  it('nothing leaks to the chart-level right scale — byte-equal to a chart without RS', () => {
    const control = chartWithCandles()
    const before = JSON.stringify(control.options().rightPriceScale)
    const chart = chartWithCandles()
    bindEngine(chart, RS1, RS_HIDDEN, RS_PLOT, RATIO)
    chart.resize(800, 401, true)
    expect(JSON.stringify(chart.options().rightPriceScale)).toBe(before)
  })

  it('an RSI pane beside it keeps its axis, its ticks and its tag; price keeps its axis', () => {
    const chart = chartWithCandles()
    bindEngine(chart, RS1, RS_HIDDEN, RS_PLOT, RATIO)
    const rsi = bindEngine(chart, RSI1, RSI, RSI_PLOT, RSI_VALUES)
    chart.resize(800, 401, true)
    expect(rsi.options.priceScaleId).toBe('right')
    expect(rsi.options.lastValueVisible).toBe(true)
    expect(chart.priceScale('right', 2).getVisibleRange()).not.toBeNull()
    expect(rightScaleOf(chart, 2)._internal_marks().length).toBeGreaterThan(0)
    expect(chart.priceScale('right', 0).getVisibleRange()).not.toBeNull()
    expect(chart.priceScale('right', 2).width()).toBeGreaterThan(0)
  })

  it('re-tenanting the pane (RS out, RSI into the same series) brings the ticks back — no stale marks either way', () => {
    const chart = chartWithCandles()
    const s = chart.addSeries(LineSeries, { priceScaleId: 'right' }, 1)
    s.setData(RSI_VALUES)
    chart.resize(800, 401, true)
    expect(rightScaleOf(chart, 1)._internal_marks().length).toBeGreaterThan(0)

    // → RS: the engine's hidden answer applied to the pooled series.
    s.applyOptions({ priceScaleId: HIDDEN_AXIS_SCALE_ID, lastValueVisible: false })
    s.setData(RATIO)
    chart.resize(800, 402, true)
    expect(rightScaleOf(chart, 1)._internal_marks()).toEqual([])

    // → back to a visible tenant.
    s.applyOptions({ priceScaleId: 'right', lastValueVisible: true })
    s.setData(RSI_VALUES)
    chart.resize(800, 403, true)
    expect(rightScaleOf(chart, 1)._internal_marks().length).toBeGreaterThan(0)
  })
})
