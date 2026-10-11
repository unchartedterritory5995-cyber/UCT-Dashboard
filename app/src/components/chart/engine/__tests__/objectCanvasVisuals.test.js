// app/src/components/chart/engine/__tests__/objectCanvasVisuals.test.js
//
// ⭐⭐ UIE PHASE 2 (M5) — the visual gaps the runtime acceptance named, closed in the ONE
// painter (`objectCanvas.js::paintObjects`), asserted on the calls it makes:
//   * a box's TEXT is painted, where `text_halign` / `text_valign` put it;
//   * a label's STYLE is what it draws: `label_*` = body + pointer on the side Pine's
//     name says, a shape style = its glyph, `none` = text alone, `text_outline` = ringed;
//   * `line.style_arrow_*` draws its arrowhead(s) at the end(s) it names.
// ⚠️ Positions are asserted RELATIVELY (above / below / inside / at the tip) — no
// capture pins TradingView's pixel geometry for these, and none is claimed.
import { describe, it, expect } from 'vitest'
import { paintObjects } from '../objectCanvas'

function recorder() {
  const calls = []
  const rec = (name) => (...args) => calls.push([name, ...args])
  return {
    calls,
    save: rec('save'), restore: rec('restore'), beginPath: rec('beginPath'), closePath: rec('closePath'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'), stroke: rec('stroke'), fill: rec('fill'),
    fillRect: rec('fillRect'), strokeRect: rec('strokeRect'), fillText: rec('fillText'),
    strokeText: rec('strokeText'), arc: rec('arc'), setLineDash: rec('setLineDash'),
    measureText: (s) => ({ width: s.length * 6 }),
  }
}
const mapping = { timeToX: (t) => t, priceToY: (p) => 500 - p, width: 1000, height: 500 }
const of = (calls, name) => calls.filter((c) => c[0] === name)
const label = (style, extra = {}) => ({ id: 1, x: 100, y: 300, yloc: 'price', text: 'S', style,
  color: '#f00', textcolor: '#fff', size: 'normal', ...extra })   // anchor at (100, 200) on screen

describe('⭐ box text', () => {
  const box = (extra) => ({ id: 1, left: 100, right: 300, top: 400, bottom: 200, bgcolor: '#00f4',
    border_color: '#00f', border_width: 1, border_style: 'solid', text: 'Zone', text_color: '#111', ...extra })
  // screen: x 100..300, y 100..300

  it('is painted, centred by default, inside the box', () => {
    const ctx = recorder()
    paintObjects(ctx, { boxes: [box()] }, mapping)
    const [t] = of(ctx.calls, 'fillText')
    expect(t[1]).toBe('Zone')
    expect(t[2]).toBe(200)
    expect(t[3]).toBe(200)
  })

  it('honours text_halign / text_valign', () => {
    const ctx = recorder()
    paintObjects(ctx, { boxes: [box({ text_halign: 'left', text_valign: 'top' }),
      { ...box({ text_halign: 'right', text_valign: 'bottom' }), id: 2 }] }, mapping)
    const [a, b] = of(ctx.calls, 'fillText')
    expect(a[2]).toBeLessThan(120); expect(a[3]).toBeLessThan(130)   // top-left corner
    expect(b[2]).toBeGreaterThan(280); expect(b[3]).toBeGreaterThan(270)   // bottom-right corner
    for (const t of [a, b]) { expect(t[2]).toBeGreaterThan(100); expect(t[2]).toBeLessThan(300) }
  })

  it('one line per \\n, stacked', () => {
    const ctx = recorder()
    paintObjects(ctx, { boxes: [box({ text: 'a\nb' })] }, mapping)
    const t = of(ctx.calls, 'fillText')
    expect(t.map((c) => c[1])).toEqual(['a', 'b'])
    expect(t[1][3]).toBeGreaterThan(t[0][3])
  })
})

describe('⭐⭐ label styles', () => {
  it('label_down: the body sits ABOVE its anchor, its pointer tip ON the anchor', () => {
    const ctx = recorder()
    paintObjects(ctx, { labels: [label('label_down')] }, mapping)
    const [, , by, , h] = of(ctx.calls, 'fillRect')[0]
    expect(by + h).toBeLessThanOrEqual(200)
    const tip = of(ctx.calls, 'moveTo')[0]
    expect(tip).toEqual(['moveTo', 100, 200])
  })

  it('label_up: the body sits BELOW its anchor', () => {
    const ctx = recorder()
    paintObjects(ctx, { labels: [label('label_up')] }, mapping)
    const [, , by] = of(ctx.calls, 'fillRect')[0]
    expect(by).toBeGreaterThanOrEqual(200)
  })

  it('label_left / label_right: the body is on the side the pointer faces away from', () => {
    for (const [style, right] of [['label_left', true], ['label_right', false]]) {
      const ctx = recorder()
      paintObjects(ctx, { labels: [label(style)] }, mapping)
      const [, bx, , w] = of(ctx.calls, 'fillRect')[0]
      if (right) expect(bx).toBeGreaterThanOrEqual(100)
      else expect(bx + w).toBeLessThanOrEqual(100)
    }
  })

  it('a shape style draws its glyph, not a box', () => {
    const cases = { circle: 'arc', triangleup: 'lineTo', diamond: 'lineTo', xcross: 'stroke', cross: 'stroke' }
    for (const [style, call] of Object.entries(cases)) {
      const ctx = recorder()
      paintObjects(ctx, { labels: [label(style)] }, mapping)
      expect(of(ctx.calls, call).length, style).toBeGreaterThan(0)
      expect(of(ctx.calls, 'fillRect'), style).toHaveLength(0)
      expect(of(ctx.calls, 'fillText')[0][1], style).toBe('S')
    }
  })

  it('triangleup sits below its anchor with the text below it; triangledown above, text above', () => {
    const up = recorder()
    paintObjects(up, { labels: [label('triangleup')] }, mapping)
    const down = recorder()
    paintObjects(down, { labels: [label('triangledown')] }, mapping)
    expect(of(up.calls, 'fillText')[0][3]).toBeGreaterThan(200)
    expect(of(down.calls, 'fillText')[0][3]).toBeLessThan(200)
  })

  it('none: text alone, no body; text_outline: the text ringed in the label colour', () => {
    const none = recorder()
    paintObjects(none, { labels: [label('none')] }, mapping)
    expect(of(none.calls, 'fillRect')).toHaveLength(0)
    expect(of(none.calls, 'fillText')[0]).toEqual(['fillText', 'S', 100, 200])
    const ring = recorder()
    paintObjects(ring, { labels: [label('text_outline')] }, mapping)
    expect(of(ring.calls, 'strokeText')[0]).toEqual(['strokeText', 'S', 100, 200])
    expect(of(ring.calls, 'fillRect')).toHaveLength(0)
  })
})

describe('⭐ line arrowheads', () => {
  const line = (style) => ({ id: 1, x1: 100, y1: 300, x2: 300, y2: 300, color: '#0f0', width: 1, style })
  const heads = (ctx) => of(ctx.calls, 'fill').length

  it('solid: no head; arrow_right: one, its tip on the right end; arrow_left: one on the left; both: two', () => {
    const counts = {}
    for (const s of ['solid', 'arrow_right', 'arrow_left', 'arrow_both']) {
      const ctx = recorder()
      paintObjects(ctx, { lines: [line(s)] }, mapping)
      counts[s] = heads(ctx)
      if (s === 'arrow_right') expect(of(ctx.calls, 'moveTo')[1]).toEqual(['moveTo', 300, 200])
      if (s === 'arrow_left') expect(of(ctx.calls, 'moveTo')[1]).toEqual(['moveTo', 100, 200])
    }
    expect(counts).toEqual({ solid: 0, arrow_right: 1, arrow_left: 1, arrow_both: 2 })
  })
})
