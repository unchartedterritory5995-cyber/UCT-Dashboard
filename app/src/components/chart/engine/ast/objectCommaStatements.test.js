// app/src/components/chart/engine/ast/objectCommaStatements.test.js
//
// ─── ⭐⭐ `a, b, c` ON ONE LINE IS THREE STATEMENTS — for the object reader ──
//
// Pine lets a line hold several statements joined by commas, and v4 function
// bodies are routinely written that way:
//
//     f_print(_txt) => var _lbl = label(na), label.delete(_lbl), _lbl := label.new(…)
//
// The object reader read such a line as ONE statement. In a one-line body only
// the last statement survived: the `var` handle became a per-bar local and the
// `label.delete` vanished, so every label ever printed stayed on the chart.
//
// ⚰️ MEASURED against TradingView (2026-09-28, NYSE:RDDT 1D):
// `position-size-calculator` holds FOUR labels on TradingView (four printers,
// each deleting its predecessor) and held FIFTY here — every label, up to the
// default cap. `docs/pine/vendor-harness/objects-triage-2026-09-28.md`, C6.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'
import { evaluateObjects } from '../objectRuntime'

const LF = String.fromCharCode(10)
const v4 = (...lines) => ['//@version=4', 'study("t", overlay=true)', ...lines].join(LF)
const host = (s) => translatePine(s, { strict: true })
const opsOf = (t) => (t.objects && t.objects.ops) || []

/** Run a program over synthetic bars; `bar_index` and `close` are the only
 *  series these fixtures read, and anything else is NaN (visibly not firing). */
function run(t, bars = 40) {
  const trees = t.objects.trees
  const ev = (n, bar) => {
    if (!n) return NaN
    if (n.type === 'num') return n.value
    if (n.type === 'series') return n.name === 'barindex' ? bar : n.name === 'close' ? 100 + bar : NaN
    return NaN
  }
  return evaluateObjects(t.objects, {
    barCount: bars,
    readNode: (i, bar) => ev(trees[i], bar),
    readTime: (i) => i,
  })
}
const liveTexts = (r) => r.live.filter((o) => o.family === 'label').map((o) => o.props.text)

describe('⭐⭐ several statements on one line, joined by commas', () => {
  const ONE_LINE = [
    'f_print(_txt) => var _lbl = label(na), label.delete(_lbl), _lbl := label.new(bar_index, close, _txt)',
    'f_print("a")',
    'f_print("b")',
  ]
  const BLOCK = [
    'f_print(_txt) =>',
    '    var _lbl = label(na)',
    '    label.delete(_lbl)',
    '    _lbl := label.new(bar_index, close, _txt)',
    'f_print("a")',
    'f_print("b")',
  ]

  it('a one-line function body keeps its `var` handle AND its delete — one label per call site', () => {
    const t = host(v4(...ONE_LINE))
    expect(opsOf(t).filter((o) => o.k === 'delete')).toHaveLength(2)
    const r = run(t)
    expect(r.status).toBe('ok')
    expect(liveTexts(r)).toEqual(['a', 'b'])
    expect(r.stats.deleted).toBe(2 * 39)
  })

  it('⛔ CONTROL — the one-line body now compiles to exactly what the block body does', () => {
    // The block form always worked; it is the oracle the one-line form is held to.
    expect(opsOf(host(v4(...ONE_LINE)))).toEqual(opsOf(host(v4(...BLOCK))))
  })

  it('a multi-line body whose statements are joined by trailing commas splits the same way', () => {
    // `position-size-calculator` writes its main printer this way: each line
    // ends in `,`, so the block reader joins them into one dangling statement.
    const t = host(v4(
      'f_print(_txt) =>',
      '    var _lbl = label(na),',
      '    label.delete(_lbl),',
      '    _lbl := label.new(bar_index, close, _txt)',
      'f_print("a")',
    ))
    expect(opsOf(t)).toEqual(opsOf(host(v4(...BLOCK.slice(0, 4), 'f_print("a")'))))
    expect(liveTexts(run(t))).toEqual(['a'])
  })

  it('at the TOP LEVEL: `label.delete(a[1]), label.delete(b[1])` deletes both', () => {
    // `extrapolated-pivot-connector`'s shape. Unsplit, neither delete is read and
    // the labels pile up to the default cap of 50.
    const t = host(v4(
      'a = label.new(bar_index, close, "a")',
      'b = label.new(bar_index, close, "b")',
      'label.delete(a[1]), label.delete(b[1])',
    ))
    const r = run(t)
    expect(r.status).toBe('ok')
    expect(liveTexts(r)).toEqual(['a', 'b'])
  })

  it('⛔ a comma inside a call is an ARGUMENT, never a statement break', () => {
    const t = host(v4('label.new(bar_index, close, "x,y")'))
    const c = opsOf(t).filter((o) => o.k === 'create')
    expect(c).toHaveLength(1)
    expect(c[0].props.text).toEqual({ v: 'text', node: { t: 'lit', s: 'x,y' } })
  })
})
