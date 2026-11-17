// app/src/components/chart/engine/ast/tcMethodColour.test.js
//
// ─── TC (text-colour unit, 2026-11-16) — A SCRIPT'S OWN READ METHOD IN A DRAWING'S COLOUR ─────
//
// `chart.fg_color.transp(50)` over `method transp(color x, int t) => color.new(x, t)` is the call
// `transp(chart.fg_color, 50)` (the rewrite `recv.m(a)` → `m(recv, a)` the Resolver's read methods,
// C11c, and the runtime front end already make), so the host object reader reads it as the colour
// `color.new(chart.fg_color, 50)` — the theme reference at 50 (C37). ⚰️ It was dropped as
// `prop:unreadable`, and volatility-trend-score's two reference lines were drawn by neither lane
// (its committed capture `volatility-trend-score-backquant-rddt-1d-2026-11-14` holds both).
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

const HEAD = '//@version=6\nindicator("t", overlay=true)\n'
const LINE = (colour) => `if barstate.islast\n    line.new(x1=last_bar_index, x2=bar_index - 1, y1=close, y2=close, color=${colour}, style=line.style_dashed, extend=extend.right)\nplot(close)\n`
const METHOD = 'method transp(color x, int t) =>\n    color.new(x, t)\n'

const colourOf = (src) => {
  const t = translatePine(src, { strict: false })
  const ops = (t.objects && t.objects.ops) || []
  const d = t.objectDiagnostics || {}
  return { colour: ops[0] && ops[0].props && ops[0].props.color, dropped: d.droppedOps || 0, reasons: d.dropReasons || {} }
}

describe('⭐ a read method in a drawing colour is the colour its body makes', () => {
  it('`chart.fg_color.transp(50)` reads exactly as `color.new(chart.fg_color, 50)`', () => {
    const viaMethod = colourOf(`${HEAD}${METHOD}${LINE('chart.fg_color.transp(50)')}`)
    const direct = colourOf(`${HEAD}${LINE('color.new(chart.fg_color, 50)')}`)
    expect(direct.colour).toEqual({ v: 'color', node: { c: 'lit', hex: 'chart.fg_color@50' } })
    expect(viaMethod.dropped).toBe(0)
    expect(viaMethod.colour).toEqual(direct.colour)
  })
  it('a fixed colour through the method folds to its one string, as `color.new` does', () => {
    const viaMethod = colourOf(`${HEAD}${METHOD}${LINE('color.red.transp(50)')}`)
    const direct = colourOf(`${HEAD}${LINE('color.new(color.red, 50)')}`)
    expect(viaMethod.colour).toEqual(direct.colour)
  })
  it('⛔ CONTROL: a method declared twice (an overload) is not opened, and the colour stays dropped by name', () => {
    const twice = `${METHOD}method transp(float x, int t) =>\n    x + t\n`
    const r = colourOf(`${HEAD}${twice}${LINE('chart.fg_color.transp(50)')}`)
    expect(r.dropped).toBe(1)
    expect(r.reasons).toEqual({ 'prop:unreadable': 1 })
  })
})
