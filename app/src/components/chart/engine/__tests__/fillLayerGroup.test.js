// app/src/components/chart/engine/__tests__/fillLayerGroup.test.js
//
// ⭐⭐ THE BANDS ONE INSTANCE RIDES ON ONE HOST PAINT INTO ONE OFFSCREEN LAYER,
// COMPOSITED ONCE.
//
// ⚰️ The compounding fix erased each band's footprint (`destination-out`) on the
// CHART's canvas, which erased the chart's own background there too: a band then
// composited over whatever is behind the canvas (a magenta page turned every band
// magenta). Now the erase-then-paint runs in a layer that starts EMPTY, every band
// of the group paints into it in attach order, and the leader composites the layer
// onto the chart once, `source-over`. Pixels are proved in real Chromium and WebKit
// (the round reports); this rail pins the mechanism:
//   • the leader paints EVERY member into the layer, the others draw nothing;
//   • the chart's canvas sees exactly one `drawImage` and NO `destination-out`;
//   • the erase-then-paint (the compounding fix) still runs inside the layer;
//   • N4: the layer is sized to the bands' bounds, not the pane; it is re-rendered
//     only when a member's frame changed; it is RELEASED when its last band leaves;
//   • where no layer can be made, the leader paints EVERY member directly.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createFillPrimitive, createFillLayerGroup } from '../fillPrimitive'
import { createFakeChart, createRecordingCtx } from './fakeChart'

const TIMES = [1, 2, 3, 4, 5]
const UPPER = [10, 11, 12, 11, 10]
const MID = [8, 9, 10, 9, 8]
const LOWER = [5, 6, 7, 6, 5]
// the fake maps t → 10t and p → 500 − p: these bands span x 10..50, y 488..495
const PANE = { width: 2400, height: 1400 }  // a 1200×700 pane at DPR 2

function host() {
  const fake = createFakeChart()
  const series = fake.chart.addSeries(fake.LWC.LineSeries, {}, 0)
  series.setData(TIMES.map((t, i) => ({ time: t, value: UPPER[i] })))
  return { fake, series }
}

/** An offscreen canvas whose context records like the chart's. */
function stubOffscreen({ fail = false } = {}) {
  const made = []
  class FakeOffscreen {
    constructor(w, h) {
      if (fail) throw new Error('no offscreen canvas here')
      this.width = w
      this.height = h
      this.rec = createRecordingCtx()
      this.rec.ctx.setTransform = (...a) => this.rec.ops.push({ op: 'setTransform', a })
      this.rec.ctx.clearRect = (...a) => this.rec.ops.push({ op: 'clearRect', a })
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
  const media = createRecordingCtx()
  const ctx = {
    save: () => calls.push('save'), restore: () => calls.push('restore'),
    setTransform: () => {},
    set globalCompositeOperation(v) { calls.push(`gco:${v}`) },
    drawImage: (...a) => calls.push(['drawImage', ...a]),
  }
  return {
    calls,
    media,
    useBitmapCoordinateSpace: (fn) => fn({ context: ctx, bitmapSize: PANE, horizontalPixelRatio: 2, verticalPixelRatio: 2 }),
    useMediaCoordinateSpace: (fn) => fn({ context: media.ctx }),
  }
}
const draws = (t) => t.calls.filter((c) => Array.isArray(c) && c[0] === 'drawImage')
const renders = (made) => made.flatMap((m) => m.rec.ops).filter((o) => o.op === 'clearRect').length

afterEach(() => vi.unstubAllGlobals())

/** The fake's time scale has no `width()`; a real one does, and the geometry's
 *  visible-window cache (what makes an unchanged frame hand back the SAME groups)
 *  needs it. */
const withWidth = (chart) => ({ ...chart, timeScale: () => ({ ...chart.timeScale(), width: () => 1200 }) })

function pair(group, requestUpdate = () => {}) {
  const { fake, series } = host()
  const a = createFillPrimitive({ group, upper: UPPER, lower: MID, times: TIMES, color: '#111111', opacity: 0.5 })
  const b = createFillPrimitive({ group, upper: MID, lower: LOWER, times: TIMES, color: '#222222', opacity: 0.5 })
  const chart = withWidth(fake.chart)
  // …and a real price scale reports its mode (0 = normal), which the cache also needs
  const host2 = { ...series, priceScale: () => ({ ...series.priceScale(), options: () => ({ mode: 0 }) }) }
  for (const p of [a, b]) p.primitive.attached({ chart, series: host2, requestUpdate })
  return { fake, series: host2, a, b }
}
const drawOf = (p, t) => p.primitive.paneViews()[0].renderer().draw(t)

describe('the shared fill layer', () => {
  it('the LEADER paints every member into the layer and composites it once; the others draw nothing', () => {
    const made = stubOffscreen()
    const { a, b } = pair(createFillLayerGroup())
    const tA = chartTarget()
    const tB = chartTarget()
    drawOf(a, tA)
    drawOf(b, tB)
    expect(made).toHaveLength(1)
    const layer = made[0].rec
    // both bands, in attach order, each erase-then-paint INSIDE the layer
    expect(layer.fillStyles()).toEqual(['#11111180', '#22222280'])
    expect(layer.ops.filter((o) => o.op === 'fill' && o.compositeOp === 'destination-out').length).toBe(2)
    // the chart's canvas: one composite of the layer, never an erase
    expect(draws(tA)).toHaveLength(1)
    expect(tA.calls.includes('gco:destination-out')).toBe(false)
    expect(tB.calls).toEqual([])
  })

  it('⭐ N4: the layer is the bands\' BOUNDS (padded, at the pixel ratio), not the pane', () => {
    const made = stubOffscreen()
    const { a } = pair(createFillLayerGroup())
    const t = chartTarget()
    drawOf(a, t)
    // media x 10..50, y 488..495 → bitmap ×2 → 20..100 × 976..990, padded by 2:
    // an 84×18 box, in a canvas allocated with 1.25× headroom (105×23)
    expect([made[0].width, made[0].height]).toEqual([105, 23])
    const [, , sx, sy, sw, sh, dx, dy, dw, dh] = draws(t)[0]
    expect([sx, sy, sw, sh, dx, dy, dw, dh]).toEqual([0, 0, 84, 18, 18, 974, 84, 18])
    expect(made[0].width * made[0].height).toBeLessThan((PANE.width * PANE.height) / 100)
  })

  it('⭐ N4: an unchanged frame is composited from the cached layer, not re-rendered', () => {
    const made = stubOffscreen()
    const { a, b } = pair(createFillLayerGroup())
    const t = chartTarget()
    drawOf(a, t)
    drawOf(a, t)
    drawOf(a, t)
    expect(renders(made)).toBe(1)
    expect(draws(t)).toHaveLength(3)
    // a member's data changing re-renders it
    b.setOptions({ color: '#333333' })
    drawOf(a, t)
    expect(renders(made)).toBe(2)
    expect(made).toHaveLength(1)
  })

  it('⭐ N4: the layer is RELEASED when its last band leaves, and the group says it is empty', () => {
    stubOffscreen()
    const onEmpty = vi.fn()
    const group = createFillLayerGroup({ onEmpty })
    const { a, b } = pair(group)
    drawOf(a, chartTarget())
    expect(group.hasLayer()).toBe(true)
    a.primitive.detached()
    expect(group.hasLayer()).toBe(true)
    expect(onEmpty).not.toHaveBeenCalled()
    b.primitive.detached()
    expect(group.hasLayer()).toBe(false)
    expect(onEmpty).toHaveBeenCalledTimes(1)
    expect(group.stats.released).toBe(1)
  })

  it('⭐ N4: a band ALONE needs no layer — painted straight onto the chart, source-over, NO erase', () => {
    // A Bollinger / Keltner background or Ichimoku's cloud: nothing to compound
    // with, so no layer's cost and no erase to cut the chart's own background.
    const made = stubOffscreen()
    const { fake, series } = host()
    const a = createFillPrimitive({ upper: UPPER, lower: LOWER, times: TIMES, color: '#111111', opacity: 0.5 })
    a.primitive.attached({ chart: fake.chart, series, requestUpdate: () => {} })
    const t = chartTarget()
    drawOf(a, t)
    expect(made).toHaveLength(0)
    expect(draws(t)).toHaveLength(0)
    expect(t.media.fillStyles()).toEqual(['#11111180'])
    expect(t.media.ops.filter((o) => o.op === 'fill').map((o) => o.compositeOp || 'source-over')).toEqual(['source-over'])
  })

  it('the leader passes on when it detaches — and a band left alone paints directly', () => {
    const made = stubOffscreen()
    const group = createFillLayerGroup()
    const { a, b, series } = pair(group)
    const c = createFillPrimitive({ group, upper: UPPER, lower: LOWER, times: TIMES, color: '#333333', opacity: 0.5 })
    c.primitive.attached({ chart: withWidth(createFakeChart().chart), series, requestUpdate: () => {} })
    a.primitive.detached()
    const t = chartTarget()
    drawOf(b, t)
    expect(draws(t)).toHaveLength(1)
    expect(made[0].rec.fillStyles()).toEqual(['#22222280', '#33333380'])
    c.primitive.detached()
    const t2 = chartTarget()
    drawOf(b, t2)
    expect(draws(t2)).toHaveLength(0)
    expect(t2.media.fillStyles()).toEqual(['#22222280'])
  })

  it('⛔ N4 FALLBACK — a bitmap target with NO layer to be had: the leader paints EVERY member directly', () => {
    stubOffscreen({ fail: true })
    const { a, b } = pair(createFillLayerGroup())
    const tA = chartTarget()
    const tB = chartTarget()
    drawOf(a, tA)
    drawOf(b, tB)
    expect(draws(tA)).toHaveLength(0)
    expect(tA.media.fillStyles()).toEqual(['#11111180', '#22222280'])
    expect(tB.media.ops).toEqual([])
    // ⭐ R3: and NO erase on the chart's canvas
    expect(tA.media.ops.filter((o) => o.op === 'fill' && o.compositeOp === 'destination-out')).toEqual([])
  })

  it('⛔ R3 — the no-layer fallback keeps the CHART\'s background: a magenta page never shows through', () => {
    // A one-pixel compositor standing in for the chart canvas: it starts as the chart's
    // opaque background, every `fill` covers the pixel, and what the member SEES is that
    // pixel over a magenta page. An erase (`destination-out`) would hand the pixel to
    // the page; source-over keeps the background under the band.
    const BG = [23, 24, 26]
    const PAGE = [255, 0, 255]
    const px = { rgb: [...BG], a: 1 }
    let gco = 'source-over'
    let style = '#000000'
    const parse = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)).concat([s.length === 9 ? parseInt(s.slice(7, 9), 16) / 255 : 1])
    const ctx = new Proxy({}, {
      get: (o, k) => {
        if (k === 'fill') {
          return () => {
            const [r, g, b, sa] = parse(style)
            if (gco === 'destination-out') { px.a *= 1 - sa; return }
            const oa = sa + px.a * (1 - sa)
            px.rgb = [r, g, b].map((c, i) => (c * sa + px.rgb[i] * px.a * (1 - sa)) / oa)
            px.a = oa
          }
        }
        return () => {}
      },
      set: (o, k, v) => { if (k === 'globalCompositeOperation') gco = v; if (k === 'fillStyle') style = v; return true },
    })
    stubOffscreen({ fail: true })
    const { a } = pair(createFillLayerGroup())
    drawOf(a, { useBitmapCoordinateSpace: (fn) => fn({ context: {}, bitmapSize: PANE, horizontalPixelRatio: 2, verticalPixelRatio: 2 }), useMediaCoordinateSpace: (fn) => fn({ context: ctx }) })
    const seen = px.rgb.map((c, i) => Math.round(c * px.a + PAGE[i] * (1 - px.a)))
    // two bands at 50% over the chart background, never over the page
    const want = [0x22, 0x22, 0x22].map((c, i) => Math.round(c * 0.5 + (0x11 * 0.5 + BG[i] * 0.5) * 0.5))
    expect(px.a).toBe(1)
    seen.forEach((c, i) => expect(Math.abs(c - want[i])).toBeLessThanOrEqual(1))
  })

  it('⭐ canvas reuse — a zoom-out (a box growing every frame) does not reallocate every frame', () => {
    const made = stubOffscreen()
    const group = createFillLayerGroup()
    const { a, b } = pair(group)
    const t = chartTarget()
    // grow the bands' box a little every frame, 30 frames
    for (let k = 0; k < 30; k += 1) {
      const up = UPPER.map((v) => v + k * 0.4)
      a.setOptions({ upper: up })
      b.setOptions({ lower: LOWER.map((v) => v - k * 0.4) })
      drawOf(a, t)
    }
    expect(renders(made)).toBe(30)
    expect(group.stats.allocations).toBeLessThanOrEqual(6)
    expect(group.stats.allocations).toBeGreaterThan(1)
  })

  it('⭐ R4 — a sync that re-sends the same options re-renders nothing', () => {
    const made = stubOffscreen()
    const asked = vi.fn()
    const { a, b } = pair(createFillLayerGroup(), asked)
    const t = chartTarget()
    drawOf(a, t)
    for (let k = 0; k < 10; k += 1) {
      // exactly what a binder sync does: every option, unchanged
      a.setOptions({ upper: UPPER, lower: MID, times: TIMES, color: '#111111', opacity: 0.5 })
      b.setOptions({ upper: MID, lower: LOWER, times: TIMES, color: '#222222', opacity: 0.5 })
      drawOf(a, t)
    }
    expect(renders(made)).toBe(1)
    expect(draws(t)).toHaveLength(11)
    // …and it does not even ask the chart for a repaint
    expect(asked).not.toHaveBeenCalled()
    // equal CONTENT in new arrays (a recomputed column) is still not a change
    a.setOptions({ upper: [...UPPER] })
    drawOf(a, t)
    expect(renders(made)).toBe(1)
    // a real change is
    a.setOptions({ opacity: 0.25 })
    drawOf(a, t)
    expect(renders(made)).toBe(2)
  })

  it('⛔ CONTROL — with no bitmap space at all, each band paints itself directly, as before', () => {
    const { fake, series } = host()
    const a = createFillPrimitive({ upper: UPPER, lower: LOWER, times: TIMES })
    a.primitive.attached({ chart: fake.chart, series, requestUpdate: () => {} })
    const rec = createRecordingCtx()
    a.primitive.paneViews()[0].renderer().draw(rec.target)
    expect(rec.ops.some((o) => o.op === 'fill')).toBe(true)
  })
})
