// app/src/components/chart/engine/__tests__/objectCanvasClip.test.js
//
// ⭐⭐ UIE PHASE 3 (M3B/M3C) — AN ENDPOINT THE CHART HOLDS NO SLOT FOR, AND THE PLOT CLIP.
//
// Through the real path (`toRenderState` → `paintObjects`), with a mapping that answers
// the way lightweight-charts' `timeToCoordinate` does: a coordinate for a LOADED bar's
// time only, bars spaced uniformly. A line whose endpoint lies before the first loaded
// bar (or past the last) used to be dropped whole; it is now placed by bar spacing and
// cut at the plot's edge — its colour, width, style and arrowheads intact — while an
// endpoint that cannot be placed honestly (a `bar_time` instant off the axis, a loaded
// bar the chart cannot place) still skips the object rather than guessing.
// ⚠️ Positions are this chart's own coordinates; no TradingView pixel capture is claimed.
import { describe, it, expect } from 'vitest'
import { paintObjects } from '../objectCanvas'
import { toRenderState } from '../objectRenderState'

const N = 40
const bars = Array.from({ length: N }, (_, i) => ({ t: 1700000000 + i * 300, o: 10, h: 11, l: 9, c: 10, v: 1 }))
/** LWC-like: loaded bars only, `x = off + index * spacing`; pan/zoom = another off/spacing */
const mapping = ({ off = 50, sp = 10, top = 0, hole = null } = {}) => {
  const at = new Map(bars.map((b, i) => [b.t, i]))
  return {
    timeToX: (t) => (at.has(t) && at.get(t) !== hole ? off + at.get(t) * sp : null),
    priceToY: (p) => top + 500 - p * 10,
    width: 800, height: 500, rightInset: 60,
  }
}
function recorder() {
  const calls = []
  const rec = (name) => (...args) => calls.push([name, ...args])
  return {
    calls,
    save: rec('save'), restore: rec('restore'), beginPath: rec('beginPath'), closePath: rec('closePath'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'), stroke: rec('stroke'), fill: rec('fill'),
    fillRect: rec('fillRect'), strokeRect: rec('strokeRect'), fillText: rec('fillText'),
    strokeText: rec('strokeText'), arc: rec('arc'), setLineDash: rec('setLineDash'),
    rect: rec('rect'), clip: rec('clip'),
    measureText: (s) => ({ width: s.length * 6 }),
  }
}
const of = (calls, name) => calls.filter((c) => c[0] === name)
const live = (family, props, id = 1) => ({ family, id, createdBar: 0, props })
const paint = (objs, m = mapping()) => {
  const ctx = recorder()
  const stats = paintObjects(ctx, toRenderState(objs, { bars, tf: '5' }), m)
  return { ctx, stats }
}
const LINE = { x1: -30, y1: 20, x2: 20, y2: 25, color: '#ff0000', width: 3, style: 'dashed' }

describe('⭐⭐ a line with an endpoint before the first loaded bar is drawn, cut at the plot edge', () => {
  it('placed by bar spacing (bar -30 → x = 50 - 300), its style, colour and width intact', () => {
    const { ctx, stats } = paint([live('line', LINE)])
    expect(stats.drawn.line).toBe(1)
    expect(stats.skipped.line).toBe(0)
    expect(of(ctx.calls, 'moveTo')[0]).toEqual(['moveTo', -250, 300])
    expect(of(ctx.calls, 'lineTo')[0]).toEqual(['lineTo', 250, 250])
    expect(of(ctx.calls, 'setLineDash').some((c) => Array.isArray(c[1]) && c[1].length > 0)).toBe(true)
  })

  it('clipped to the plot: the clip rect ends at the price scale', () => {
    const { ctx } = paint([live('line', LINE)])
    expect(of(ctx.calls, 'rect')[0]).toEqual(['rect', 0, 0, 800 - 60, 500])
    expect(of(ctx.calls, 'clip')).toHaveLength(1)
    // the clip is saved first and restored last: nothing after the painter is clipped
    expect(ctx.calls[0][0]).toBe('save')
    expect(ctx.calls[ctx.calls.length - 1][0]).toBe('restore')
  })

  it('arrowheads stay on the end the style names — the off-chart end included', () => {
    const left = paint([live('line', { ...LINE, style: 'arrow_left' })]).ctx
    const right = paint([live('line', { ...LINE, style: 'arrow_right' })]).ctx
    expect(of(left.calls, 'fill')).toHaveLength(1)
    expect(of(left.calls, 'moveTo')[1]).toEqual(['moveTo', -250, 300])   // the tip, off the plot
    expect(of(right.calls, 'moveTo')[1]).toEqual(['moveTo', 250, 250])
  })

  it('an endpoint past the last loaded bar is placed the same way (bar N+5)', () => {
    const { ctx, stats } = paint([live('line', { ...LINE, x1: 30, x2: N + 5 })])
    expect(stats.drawn.line).toBe(1)
    expect(of(ctx.calls, 'lineTo')[0][1]).toBe(50 + (N + 5) * 10)
  })

  it('a fill between a cut line and a loaded one is drawn', () => {
    const { stats } = paint([live('line', LINE, 1), live('line', { ...LINE, x1: 2, y1: 15, y2: 15 }, 2),
      live('linefill', { line1: { __ref: 1 }, line2: { __ref: 2 }, color: '#00f4' }, 3)])
    expect(stats.drawn.linefill).toBe(1)
  })

  it('a box that starts before the first loaded bar is drawn from its true left edge', () => {
    const { ctx, stats } = paint([live('box', { left: -10, right: 5, top: 30, bottom: 20, bgcolor: '#0f04', text: 'OB' })])
    expect(stats.drawn.box).toBe(1)
    const [, x, , w] = of(ctx.calls, 'fillRect')[0]
    expect(x).toBe(50 - 100)
    expect(x + w).toBe(100)
  })
})

describe('⛔ what cannot be placed honestly is still skipped, never guessed', () => {
  it('a bar_time endpoint off the axis', () => {
    const { stats } = paint([live('line', { ...LINE, x1: (bars[0].t - 3000) * 1000, x2: bars[3].t * 1000, xloc: 'bar_time' })])
    expect(stats.skipped.line).toBe(1)
  })

  it('a LOADED bar the chart cannot place', () => {
    const { stats } = paint([live('line', { ...LINE, x1: 4 })], mapping({ hole: 4 }))
    expect(stats.skipped.line).toBe(1)
  })

  it('a chart that cannot place the bars it measures spacing from', () => {
    const m = mapping()
    const { stats } = paint([live('line', LINE)], { ...m, timeToX: (t) => (t === bars[0].t ? null : m.timeToX(t)) })
    expect(stats.skipped.line).toBe(1)
  })
})

describe('⭐ pan, zoom, pane and replay: the coordinates follow the chart', () => {
  it('pan/zoom: a different offset and spacing move every point by the same rule', () => {
    const a = paint([live('line', LINE)], mapping({ off: -120, sp: 4 })).ctx
    expect(of(a.calls, 'moveTo')[0][1]).toBe(-120 + -30 * 4)
    expect(of(a.calls, 'lineTo')[0][1]).toBe(-120 + 20 * 4)
  })

  it("a lower pane's price mapping places the y, the x is the chart's", () => {
    const { ctx } = paint([live('line', LINE)], mapping({ top: 300 }))
    expect(of(ctx.calls, 'moveTo')[0]).toEqual(['moveTo', -250, 600])
  })

  it('replay: built on fewer bars, a later endpoint is a future bar and is placed', () => {
    const replay = bars.slice(0, 20)
    const ctx = recorder()
    const state = toRenderState([live('line', { ...LINE, x2: 25 })], { bars: replay, tf: '5' })
    const m = mapping()
    const at = new Map(replay.map((b, i) => [b.t, i]))
    const stats = paintObjects(ctx, state, { ...m, timeToX: (t) => (at.has(t) ? 50 + at.get(t) * 10 : null) })
    expect(stats.drawn.line).toBe(1)
    expect(of(ctx.calls, 'lineTo')[0][1]).toBe(50 + 25 * 10)
  })

  it('a label projected past the last bar is placed, not dropped', () => {
    const { stats } = paint([live('label', { x: N + 3, y: 20, yloc: 'price', text: 'T', style: 'label_left' })])
    expect(stats.drawn.label).toBe(1)
  })
})
