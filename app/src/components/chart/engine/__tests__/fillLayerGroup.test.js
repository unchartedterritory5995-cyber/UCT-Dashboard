// app/src/components/chart/engine/__tests__/fillLayerGroup.test.js
//
// ⭐⭐ THE BANDS OF ONE HOST PAINT INTO ONE OFFSCREEN LAYER, COMPOSITED ONCE.
//
// ⚰️ The compounding fix erased each band's footprint (`destination-out`) on the
// CHART's canvas, which erased the chart's own background there too: a band then
// composited over whatever is behind the canvas (a magenta page turned every band
// magenta). Now the erase-then-paint runs in a layer that starts EMPTY, every band
// sharing the host paints into it in attach order, and the leader composites the
// layer onto the chart once, `source-over`. Pixels are proved in real Chromium and
// WebKit (the round-2 report); this rail pins the mechanism:
//   • the leader paints EVERY member into the layer, the others draw nothing;
//   • the chart's canvas sees exactly one `drawImage` and NO `destination-out`;
//   • the erase-then-paint (the compounding fix) still runs inside the layer;
//   • where no layer can be made, a band paints itself directly, as before.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createFillPrimitive, createFillLayerGroup } from '../fillPrimitive'
import { createFakeChart, createRecordingCtx } from './fakeChart'

const TIMES = [1, 2, 3, 4, 5]
const UPPER = [10, 11, 12, 11, 10]
const MID = [8, 9, 10, 9, 8]
const LOWER = [5, 6, 7, 6, 5]

function host() {
  const fake = createFakeChart()
  const series = fake.chart.addSeries(fake.LWC.LineSeries, {}, 0)
  series.setData(TIMES.map((t, i) => ({ time: t, value: UPPER[i] })))
  return { fake, series }
}

/** An offscreen canvas whose context records like the chart's. */
function stubOffscreen() {
  const made = []
  class FakeOffscreen {
    constructor(w, h) {
      this.width = w
      this.height = h
      this.rec = createRecordingCtx()
      this.rec.ctx.setTransform = () => {}
      this.rec.ctx.clearRect = () => this.rec.ops.push({ op: 'clearRect' })
      this.rec.ctx.canvas = this
      made.push(this)
    }
    getContext() { return this.rec.ctx }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreen)
  return made
}

/** A target with BOTH coordinate spaces, recording the chart canvas's calls. */
function chartTarget() {
  const calls = []
  const ctx = {
    save: () => calls.push('save'), restore: () => calls.push('restore'),
    setTransform: () => {},
    set globalCompositeOperation(v) { calls.push(`gco:${v}`) },
    drawImage: (img) => calls.push(['drawImage', img]),
  }
  return {
    calls,
    useBitmapCoordinateSpace: (fn) => fn({ context: ctx, bitmapSize: { width: 120, height: 80 }, horizontalPixelRatio: 1, verticalPixelRatio: 1 }),
    useMediaCoordinateSpace: () => calls.push('MEDIA'),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('the shared fill layer', () => {
  it('the LEADER paints every member into the layer and composites it once; the others draw nothing', () => {
    const made = stubOffscreen()
    const { fake, series } = host()
    const group = createFillLayerGroup()
    const a = createFillPrimitive({ group, upper: UPPER, lower: MID, times: TIMES, color: '#111111', opacity: 0.5 })
    const b = createFillPrimitive({ group, upper: MID, lower: LOWER, times: TIMES, color: '#222222', opacity: 0.5 })
    for (const p of [a, b]) p.primitive.attached({ chart: fake.chart, series, requestUpdate: () => {} })
    const tA = chartTarget()
    const tB = chartTarget()
    a.primitive.paneViews()[0].renderer().draw(tA)
    b.primitive.paneViews()[0].renderer().draw(tB)
    expect(made).toHaveLength(1)
    const layer = made[0].rec
    // both bands, in attach order, each erase-then-paint INSIDE the layer
    expect(layer.fillStyles()).toEqual(['#11111180', '#22222280'])
    expect(layer.ops.filter((o) => o.op === 'fill' && o.compositeOp === 'destination-out').length).toBe(2)
    // the chart's canvas: one composite of the layer, never an erase
    expect(tA.calls.filter((c) => Array.isArray(c) && c[0] === 'drawImage')).toHaveLength(1)
    expect(tA.calls.includes('gco:destination-out')).toBe(false)
    expect(tB.calls).toEqual([])
  })

  it('a band with no group is a group of one — still layered', () => {
    const made = stubOffscreen()
    const { fake, series } = host()
    const a = createFillPrimitive({ upper: UPPER, lower: LOWER, times: TIMES, color: '#111111', opacity: 0.5 })
    a.primitive.attached({ chart: fake.chart, series, requestUpdate: () => {} })
    const t = chartTarget()
    a.primitive.paneViews()[0].renderer().draw(t)
    expect(made).toHaveLength(1)
    expect(t.calls.filter((c) => Array.isArray(c) && c[0] === 'drawImage')).toHaveLength(1)
  })

  it('the leader passes on when it detaches', () => {
    stubOffscreen()
    const { fake, series } = host()
    const group = createFillLayerGroup()
    const a = createFillPrimitive({ group, upper: UPPER, lower: MID, times: TIMES })
    const b = createFillPrimitive({ group, upper: MID, lower: LOWER, times: TIMES })
    for (const p of [a, b]) p.primitive.attached({ chart: fake.chart, series, requestUpdate: () => {} })
    a.primitive.detached()
    const t = chartTarget()
    b.primitive.paneViews()[0].renderer().draw(t)
    expect(t.calls.filter((c) => Array.isArray(c) && c[0] === 'drawImage')).toHaveLength(1)
  })

  it('⛔ CONTROL — with no layer to be had, each band paints itself directly, as before', () => {
    const { fake, series } = host()
    const a = createFillPrimitive({ upper: UPPER, lower: LOWER, times: TIMES })
    a.primitive.attached({ chart: fake.chart, series, requestUpdate: () => {} })
    const rec = createRecordingCtx()
    a.primitive.paneViews()[0].renderer().draw(rec.target)
    expect(rec.ops.some((o) => o.op === 'fill')).toBe(true)
  })
})
