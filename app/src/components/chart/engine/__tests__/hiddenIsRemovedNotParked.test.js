// app/src/components/chart/engine/__tests__/hiddenIsRemovedNotParked.test.js
//
// ─── PARK OR REMOVE? MEASURED, NOT ARGUED ───────────────────────────────────
//
// Under Flip A the legacy toggle is still the switch: `StockChart` projects an
// instance whose `indicators.<id>.enabled` is false to `hidden`, `planBindings`
// drops a hidden instance (`pool.js:652`), nothing claims its binding, and
// `binder.sync` step 3 calls `chart.removeSeries` (`binder.js:316`).
//
// A comment in `StockChart.jsx` used to say the opposite — that the binder
// "releases the series to the POOL, so this is an applyOptions-and-park, never
// the mass `removeSeries` of #2049". That was false, and the false version is
// the dangerous one: it is the RAIL that is supposed to stop the next
// implementer churning fifteen series, and it told them the hidden path was
// free. LWC #2049 (mass removeSeries) is the whole reason this engine pools at
// all, so "which is it" cannot be left to a sentence.
//
// The decision is REMOVE, and the first reason is a fact about the library, not
// a preference: **`visible: false` does not release the series' PANE.** Park an
// RSI and its pane survives the toggle — the price pane stays short with an
// empty band under it, while the legacy block (which removes its series) gives
// the height back. Flip A's entire contract is pixel-identity with legacy, so
// parking would fail `engine_rsi_toggle_off` on the parity gate.
//
// ⭐⭐ AND IT GOT MORE LOAD-BEARING AT FLIP C (B5 Task 10), NOT LESS. Under
// `paneMode() === 'panes'` an oscillator's band IS a pane, so "park it" would
// leave a whole EMPTY PANE in the stack with a divider above it — visible
// furniture for an indicator the user just switched off, and one the layout does
// not reserve height for. The other half was measured on the same bundle in
// `flipCGeometry.test.jsx`: `removeSeries` drops the pane SYNCHRONOUSLY, which is
// what makes "an oscillator turned OFF removes its pane" free rather than
// something the binder has to call `chart.removePane` for.
//
// That fact is asserted here against the REAL lightweight-charts bundle, in the
// same style as `autoscaleOnARealScale.test.js`, because it is the load-bearing
// half of a decision written into a comment. If a future LWC releases the pane
// on `visible:false`, this goes red and the decision is genuinely open again.
//
// (The OTHER half — that removal is not the #2049 pattern — is a property of the
// planner, not the library: `planBindings` releases only what nothing in the
// same pass can use, so "RSI off + BB on in one settings write" hands BB the
// line series RSI just gave up. That is gated in `pool.test.js` and at the
// component level in `stockChartWiring.test.jsx`, not here.)

import { describe, it, expect, beforeAll } from 'vitest'
import { createChart, LineSeries, CandlestickSeries } from 'lightweight-charts'

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
const CANDLES = Array.from({ length: 60 }, (_, i) => ({ time: T(i), open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i }))
const LINE = Array.from({ length: 60 }, (_, i) => ({ time: T(i), value: 50 + 20 * Math.sin(i / 6) }))

function chartWithBandedIndicator() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const chart = createChart(el, { width: 800, height: 400 })
  chart.addSeries(CandlestickSeries, {}).setData(CANDLES)
  chart.timeScale().setVisibleLogicalRange({ from: 0, to: CANDLES.length - 1 })
  // paneIndex 1 — an oscillator in its own band, which is what an RSI instance
  // resolves to.
  const s = chart.addSeries(LineSeries, { priceScaleId: 'right' }, 1)
  s.setData(LINE)
  return { chart, series: s }
}

describe('a hidden instance is REMOVED, and parking would not be equivalent', () => {
  it('an indicator on its own pane creates that pane', () => {
    const { chart } = chartWithBandedIndicator()
    expect(chart.panes()).toHaveLength(2)
  })

  it('⛔ visible:false does NOT release the pane — parking is a LAYOUT change, not a hide', () => {
    const { chart, series } = chartWithBandedIndicator()
    const before = chart.panes().length
    series.applyOptions({ visible: false })
    expect(
      chart.panes().length,
      'if this ever drops to 1, `visible:false` became a real hide and the '
      + 'park-vs-remove decision in StockChart.jsx is open again',
    ).toBe(before)
    // The pane is not merely present in a list — it still OWNS the series and
    // still claims a share of the chart's height. (Pixel heights are all 0 under
    // jsdom's faked layout, so the stretch factor is the observable that means
    // anything here.)
    expect(chart.panes()[1].getSeries()).toContain(series)
    expect(chart.panes()[1].getStretchFactor()).toBeGreaterThan(0)
  })

  it('✅ removeSeries DOES release it — which is why the toggle gives the height back', () => {
    const { chart, series } = chartWithBandedIndicator()
    chart.removeSeries(series)
    expect(chart.panes()).toHaveLength(1)
  })
})
