// app/src/components/chart/engine/__tests__/paneSeparatorPin.test.js
//
// ⭐ WHY THIS EXISTS. `SEPARATOR_PX` is the pixel budget the whole pane-0
// preservation identity is built on (plan §A6): the separators are taken out of
// the OSCILLATOR panes so pane 0's rectangle lands on the same pixels. If
// lightweight-charts changes that height in a patch release, every pane in the
// app moves by a pixel and NOTHING else in the tree would say so.
//
// It is the ONE number in `paneLayout.js` that is not ours, so it is MEASURED
// against the installed bundle rather than transcribed from its source. (The
// constant is `SeparatorConstants.SeparatorHeight` in
// `lightweight-charts/dist/lightweight-charts.standalone.development.js` — read
// it if this fails, but read the failure first: a renderer that changed it is a
// renderer that moved every pane.)

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createChart, LineSeries } from 'lightweight-charts'
import { SEPARATOR_PX } from '../paneLayout'

const CHART_H = 400

// ─── jsdom needs a 2D context and a non-zero layout ──────────────────────────
// Same file-scoped recipe as `autoscaleOnARealScale.test.js`: vitest gives every
// test file its own jsdom, so these patches cannot reach another suite. Nothing
// here draws — the assertions are on the pane LAYOUT arithmetic, which needs a
// height, not a canvas.
beforeAll(() => {
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'canvas') return { width: 600, height: CHART_H }
      if (k === 'measureText') return () => ({ width: 30, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
      return () => {}
    },
    set: () => true,
  })
  HTMLCanvasElement.prototype.getContext = () => ctx
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get() { return 600 }, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get() { return CHART_H }, configurable: true })
})

// ⚠️ THE PANE HEIGHTS ARE COMPUTED IN THE DRAW, AND THE DRAW IS rAF-SCHEDULED.
// `_private__adjustSizeImpl` (the function that distributes the height by stretch
// factor) runs from `_private__syncGuiWithModel`, which the invalidate handler
// defers to `requestAnimationFrame`. Read `getHeight()` synchronously after
// `addSeries` and you get the layout from BEFORE the pane existed — measured: a
// two-pane chart reporting [400, 0] and a `measured` separator of 0, which would
// have pinned SEPARATOR_PX at the wrong number for the wrong reason.
const frame = () => new Promise((r) => requestAnimationFrame(() => r()))

describe('the pane separator height is measured from the installed renderer', () => {
  let el, chart
  beforeAll(async () => {
    el = document.createElement('div')
    document.body.appendChild(el)
    // `timeScale.visible: false` removes the time-axis strip from the height
    // budget, so what is left over from `height` is separators and nothing else.
    chart = createChart(el, { width: 600, height: CHART_H, timeScale: { visible: false } })
    chart.addSeries(LineSeries, {}, 0)
    chart.addSeries(LineSeries, {}, 1)   // forces a second pane
    await frame()
  })
  afterAll(() => { chart.remove(); el.remove() })

  it('two panes account for the chart height minus exactly one separator', () => {
    const panes = chart.panes()
    expect(panes).toHaveLength(2)
    const sum = panes.reduce((s, p) => s + p.getHeight(), 0)
    const measured = CHART_H - sum
    // ⛔ If this fails, do NOT change SEPARATOR_PX to the new number and move on.
    // Re-run the pane-0 preservation cases in paneLayout.test.js first: the
    // budget arithmetic is what keeps `price_plot` at 0 changed pixels.
    expect(measured).toBe(SEPARATOR_PX)
  })

  it('stretch factors distribute the AVAILABLE height, so factors set to target pixels land exactly', async () => {
    const [p0, p1] = chart.panes()
    p0.setStretchFactor(300)
    p1.setStretchFactor(CHART_H - SEPARATOR_PX - 300)
    await frame()
    expect(p0.getHeight()).toBe(300)
    expect(p1.getHeight()).toBe(CHART_H - SEPARATOR_PX - 300)
  })
})
