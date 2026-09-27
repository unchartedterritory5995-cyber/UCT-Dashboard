// app/src/components/chart/engine/runtime/__tests__/methodDrawings.test.js
//
// ─── ⭐⭐ A USER METHOD THAT DRAWS RUNS AT ITS CALL SITE, LIKE A FUNCTION ──────
//
// ⚰️ MEASURED AGAINST TRADINGVIEW, 2026-09-27. Zero-Lag MA Trend Levels
// [ChartPrime] (NYSE:RDDT 1D, 631 bars from listing, live capture) draws every
// one of its trend boxes through a METHOD:
//
//     var box1 = box(na)
//     method draw_box(color col, top, bot, price) => box.new(bar_index, top, …)
//     switch
//         signalUp => box1 := up.draw_box(zlma, zlma - atr, close)
//
// TradingView held 18 boxes; we drew none — the reader refused every drawing
// method by name ("its receiver is typed"). `recv.m(a, b)` IS `m(recv, a, b)` in
// Pine, so the receiver binds to the first parameter and the body inlines exactly
// as a function body does. These rails run through the MEMBER DOOR and the object
// runtime it feeds, with expectations computed by hand from the fixed bars.
import { describe, it, expect } from 'vitest'

import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { translatePine } from '../../ast/pine'

const N = 60
const BARS = Array.from({ length: N }, (_, i) => ({
  t: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
  o: 100 + (i % 7), h: 110 + (i % 5), l: 90 - (i % 3), c: 100 + (i % 11), v: 1000000 + i,
}))
const H = '//@version=5\nindicator("t", overlay=true, max_boxes_count=500)\nplot(close)\n'
const METHOD = 'method mk(color c, float top, float bot) => box.new(bar_index, top, bar_index, bot, c)\n'
const UP = BARS.map((b, i) => (b.c > b.o ? i : -1)).filter((i) => i >= 0)

/** Through the MEMBER DOOR and the object runtime it feeds — the path a chart takes. */
function live(body) {
  const d = memberPaneDefinition({ source: H + body, id: 'u_md', name: 'md' })
  expect(d.ok, d.reason).toBe(true)
  const objs = d.definition.objects
  expect(objs && (objs.ops || []).length, `no object program: ${JSON.stringify(d.notes)}`).toBeGreaterThan(0)
  const reader = objectReaderFor(d.definition, BARS, { inputs: undefined, tf: 'D', symbol: 'TEST' })
  expect(reader, 'objectReaderFor returned null').toBeTruthy()
  const run = evaluateObjects(reader.program, {
    barCount: BARS.length, readNode: reader.readNode, readTime: (i) => BARS[i].t,
  })
  return (run.live || []).filter((o) => o && o.family === 'box')
}
const diag = (body) => translatePine(H + body, { strict: true }).objectDiagnostics || {}

describe('⭐⭐ a drawing METHOD inlines at its call site', () => {
  it('⛔ CONTROL — the fixture has up bars and non-up bars, so a count can tell a guard from none', () => {
    expect(UP.length).toBeGreaterThan(0)
    expect(UP.length).toBeLessThan(N)
  })

  it('⭐ `recv.m(…)` under a guard draws one box per bar the guard holds, at that bar\'s own coordinates', () => {
    const boxes = live('col = color.red\nvar b = box(na)\n' + METHOD
      + 'if close > open\n    b := col.mk(high, low)\n')
    expect(boxes.map((o) => o.props.left)).toEqual(UP)
    expect(boxes.map((o) => o.props.top)).toEqual(UP.map((i) => BARS[i].h))
    expect(boxes.map((o) => o.props.bottom)).toEqual(UP.map((i) => BARS[i].l))
  })

  it('⭐ the RECEIVER binds to the first parameter — the border is the receiver\'s colour', () => {
    const red = live('col = color.red\nvar b = box(na)\n' + METHOD + 'if close > open\n    b := col.mk(high, low)\n')
    const blue = live('col = color.blue\nvar b = box(na)\n' + METHOD + 'if close > open\n    b := col.mk(high, low)\n')
    const colours = (bs) => [...new Set(bs.map((o) => String(o.props.border_color).toLowerCase()))]
    expect(colours(red)).toHaveLength(1)
    expect(colours(blue)).toHaveLength(1)
    expect(colours(red)[0], 'both receivers drew the same colour — the receiver was not bound').not.toBe(colours(blue)[0])
  })

  it('⭐ the FUNCTION spelling `m(recv, …)` draws exactly what the method spelling draws', () => {
    const asMethod = live('col = color.red\nvar b = box(na)\n' + METHOD + 'if close > open\n    b := col.mk(high, low)\n')
    const asFn = live('col = color.red\nvar b = box(na)\n' + METHOD + 'if close > open\n    b := mk(col, high, low)\n')
    expect(asFn.map((o) => [o.props.left, o.props.top, o.props.bottom]))
      .toEqual(asMethod.map((o) => [o.props.left, o.props.top, o.props.bottom]))
  })

  it('⭐ a method called as a whole STATEMENT (no assignment) draws too', () => {
    const boxes = live('col = color.red\n' + METHOD + 'if close > open\n    col.mk(high, low)\n')
    expect(boxes.map((o) => o.props.left)).toEqual(UP)
  })

  it('⭐ the call is carried, not refused — no `fn:method` drop', () => {
    const dg = diag('col = color.red\nvar b = box(na)\n' + METHOD + 'if close > open\n    b := col.mk(high, low)\n')
    expect(dg.inlinedCalls).toBe(1)
    expect((dg.dropReasons || {})['fn:method']).toBeUndefined()
  })
})

describe('⛔ where the body is not decidable from the tokens, a drawing method still refuses `method`', () => {
  it('an OVERLOADED method (defined twice) — Pine picks the body by the receiver\'s type', () => {
    const dg = diag('col = color.red\nvar b = box(na)\n' + METHOD
      + 'method mk(int c, float top, float bot) => box.new(bar_index, top, bar_index, bot)\n'
      + 'if close > open\n    b := col.mk(high, low)\n')
    expect(dg.dropReasons['fn:method']).toBe(1)
    expect(dg.inlinedCalls || 0).toBe(0)
  })

  it('a method named like a BUILT-IN, called on a declared drawing handle', () => {
    const dg = diag('var b = box(na)\n'
      + 'method set_right(box bx, int x) => box.new(bar_index, high, x, low)\n'
      + 'if close > open\n    b.set_right(bar_index + 4)\n')
    expect(dg.dropReasons['fn:method']).toBe(1)
  })
})
