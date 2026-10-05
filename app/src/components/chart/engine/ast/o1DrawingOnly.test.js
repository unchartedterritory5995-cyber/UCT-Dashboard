// app/src/components/chart/engine/ast/o1DrawingOnly.test.js
//
// ─── O1 (step 67) — DRAWING-ONLY SCRIPTS: the rails for what this lane changed ──
//
// `docs/pine/vendor-harness/objects-triage-2026-09-28.md`, section O1, holds the
// triage of the 33 `pine:no-output` + 6 `pine:object-removal-lost` corpus
// scripts. Every rail here has a control that must stay as it was.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'

const LF = String.fromCharCode(10)
const v5 = (...lines) => ['//@version=5', 'indicator("t", overlay=true)', ...lines].join(LF)
const host = (s) => translatePine(s, { strict: true })
const diag = (t) => t.objectDiagnostics || {}

describe('O1 — the sentence behind a dropped create (`createDropWhy`)', () => {
  it('a create dropped for a refused coordinate names the slot and the refusal', () => {
    const t = host(v5(
      'x = 0.0',
      'for i = 0 to 3',
      '    x := x + close[i]',
      'if barstate.islast',
      '    label.new(bar_index, x, "t")',
    ))
    expect(diag(t).dropReasons['create:label']).toBe(1)
    const why = diag(t).createDropWhy || []
    expect(why.length).toBe(1)
    expect(why[0]).toMatch(/^create label@7 y: pine:reassign /)
  })

  it('⛔ CONTROL — a create that converts records no sentence', () => {
    const t = host(v5('if barstate.islast', '    label.new(bar_index, close, "t")'))
    expect(diag(t).droppedOps).toBe(0)
    expect(diag(t).createDropWhy).toBeUndefined()
  })

  it('a guard the reader refuses keeps its sentence beside its short name', () => {
    const t = host(v5(
      'x = 0.0',
      'for i = 0 to 3',
      '    x := x + close[i]',
      'if x > 0',
      '    label.new(bar_index, close, "t")',
    ))
    const short = diag(t).guardRefusals || []
    const long = diag(t).guardRefusalWhy || []
    expect(short.length).toBeGreaterThan(0)
    expect(long.length).toBe(short.length)
    expect(long[0].startsWith(`${short[0]} :: `)).toBe(true)
  })
})

// ─── G7 — a drawing helper as the THEN arm of `?:` whose ELSE arm is `na` ─────
const HELPER = [
  'show = input.bool(false, "extra")',
  'lvl(x) =>',
  '    var line ln = na',
  '    line.delete(ln)',
  '    ln := line.new(bar_index - 5, x, bar_index, x)',
]
const TERNARY_FORM = v5(...HELPER, 'a = show ? lvl(close) : na')
const IF_FORM = v5(...HELPER, 'if show', '    lvl(close)')
const progOf = (t) => {
  const p = t.objects || { ops: [], trees: [] }
  return JSON.stringify({ ops: p.ops, trees: p.trees }, (k, v) => (k === 'site' || k === 'line' ? undefined : v))
}

describe('O1 G7 — `x = cond ? f(…) : na` is `if cond` + `f(…)`', () => {
  it('⛔ CONTROL — the `if` spelling draws, cleanly, under a guard', () => {
    const t = host(IF_FORM)
    expect(diag(t).droppedOps).toBe(0)
    expect((t.objects.ops || []).length).toBeGreaterThan(0)
    expect(t.objects.ops.some((o) => o.k === 'create' && o.when)).toBe(true)
  })

  it('⭐⭐ SAME PROGRAM, TWO SPELLINGS', () => {
    const a = host(TERNARY_FORM)
    const b = host(IF_FORM)
    expect(diag(a).dropReasons['fn:in-expression']).toBeUndefined()
    expect(diag(a).droppedOps).toBe(0)
    expect(progOf(a)).toBe(progOf(b))
  })

  it('a bare `cond ? f(…) : na` statement is the same program too', () => {
    expect(progOf(host(v5(...HELPER, 'show ? lvl(close) : na')))).toBe(progOf(host(IF_FORM)))
  })

  it('⛔ the guard is the test — dropping it would draw on every bar', () => {
    const always = host(v5(...HELPER, 'lvl(close)'))
    expect(progOf(host(TERNARY_FORM))).not.toBe(progOf(always))
  })

  const refusedInExpression = (src) => diag(host(src)).dropReasons['fn:in-expression'] || 0
  it('⛔ still refused: the bound name is READ elsewhere', () => {
    expect(refusedInExpression(v5(...HELPER, 'a = show ? lvl(close) : na', 'plot(na(a) ? 1 : 0)'))).toBe(1)
  })
  it('⛔ still refused: a reassignment (`:=`) or a `var` binding', () => {
    expect(refusedInExpression(v5(...HELPER, 'line a = na', 'a := show ? lvl(close) : na'))).toBe(1)
    // a `var` initialiser runs once, on the first bar — never `if cond` on every bar
    expect(refusedInExpression(v5(...HELPER, 'var a = show ? lvl(close) : na'))).toBe(1)
  })
  it('⛔ still refused: an ELSE arm other than `na`', () => {
    expect(refusedInExpression(v5(...HELPER, 'a = show ? lvl(close) : lvl(open)'))).toBe(1)
  })
  it('⛔ still refused: the call is not the WHOLE arm', () => {
    expect(refusedInExpression(v5(...HELPER, 'a = show ? lvl(close) + 0 : na'))).toBe(1)
  })
  it('⛔ still refused: the TEST itself draws', () => {
    expect(refusedInExpression(v5(...HELPER, 'a = not na(lvl(open)) ? lvl(close) : na'))).toBe(1)
  })
})

// ─── G8 — `a := x, b := y` on one line is two statements ─────────────────────
const sigOf = (t) => JSON.stringify({
  ok: t.ok, guard: t.refusal && t.refusal.guard,
  outs: (t.outputs || []).map((o) => [o.title, o.formula, o.refusal && o.refusal.guard]),
  objs: progOf(t),
})
const STATE = [
  'var float lo1 = na',
  'var float lo2 = na',
  'pl = ta.pivotlow(low, 3, 3)',
]
const COMMA = v5(...STATE, 'if not na(pl)', '    lo2 := lo1, lo1 := pl', 'plot(lo2, "lo2")', 'plot(lo1, "lo1")')
const LINES = v5(...STATE, 'if not na(pl)', '    lo2 := lo1', '    lo1 := pl', 'plot(lo2, "lo2")', 'plot(lo1, "lo1")')

describe('O1 G8 — comma-joined reassignments split exactly as separate lines', () => {
  it('⛔ CONTROL — the two-line spelling translates both plots', () => {
    const t = host(LINES)
    expect(t.ok).toBe(true)
    expect((t.outputs || []).filter((o) => o.kind === 'plot' && !o.refusal)).toHaveLength(2)
  })

  it('⭐⭐ SAME TRANSLATION, TWO SPELLINGS — `a := x, b := y`', () => {
    expect(sigOf(host(COMMA))).toBe(sigOf(host(LINES)))
  })

  it('a binding and a reassignment on one line split too (`int d = na, d := …`)', () => {
    const one = v5('d = 0.0', 'e = close, d := e * 2', 'plot(d, "d")')
    const two = v5('d = 0.0', 'e = close', 'd := e * 2', 'plot(d, "d")')
    expect(sigOf(host(one))).toBe(sigOf(host(two)))
  })

  it('⛔ ALL OR NOTHING — a segment of any other shape keeps the line whole', () => {
    // `x := close, plot(x)`: the second segment is a call, not a binding — the line is
    // not split (unchanged), so it is NOT the two-line program.
    const one = v5('x = 0.0', 'x := close, plot(x, "x")')
    const two = v5('x = 0.0', 'x := close', 'plot(x, "x")')
    expect(sigOf(host(one))).not.toBe(sigOf(host(two)))
  })
})

// ─── a getter read through a local (`top = box.get_top(b)` … `if x > top`) ────
const LIST = [
  'var boxes = array.new_box()',
  'if bar_index % 7 == 0',
  '    array.push(boxes, box.new(bar_index, high, bar_index + 3, low))',
]
const loopOver = (...body) => v5(...LIST,
  'if array.size(boxes) > 0',
  '    for i = array.size(boxes) - 1 to 0',
  '        b = array.get(boxes, i)',
  ...body.map((l) => `        ${l}`))
const ALIAS = loopOver('top = box.get_top(b)', 'if close[1] > top', '    array.remove(boxes, i)', '    box.delete(b)')
const INLINE = loopOver('if close[1] > box.get_top(b)', '    array.remove(boxes, i)', '    box.delete(b)')
const objDrops = (t) => diag(t).droppedOps

describe('O1 — a getter read through a local is the getter read at the `if`', () => {
  it('⛔ CONTROL — the inline spelling is read cleanly (C16)', () => {
    const t = host(INLINE)
    expect(objDrops(t)).toBe(0)
    expect(t.objects.ops.length).toBeGreaterThan(0)
  })

  it('⭐⭐ SAME PROGRAM, TWO SPELLINGS — the local and the inline getter', () => {
    const a = host(ALIAS)
    expect(objDrops(a)).toBe(0)
    expect(progOf(a)).toBe(progOf(host(INLINE)))
  })

  it('a second alias between the binding and the `if` keeps it (no object effect)', () => {
    const a = host(loopOver('top = box.get_top(b)', 'bot = box.get_bottom(b)', 'if close[1] > top', '    array.remove(boxes, i)', '    box.delete(b)'))
    expect(progOf(a)).toBe(progOf(host(INLINE)))
  })

  it('⛔ not rewritten when an object operation stands between them', () => {
    const t = host(loopOver('top = box.get_top(b)', 'box.set_right(b, bar_index)', 'if close[1] > top', '    array.remove(boxes, i)', '    box.delete(b)'))
    expect(objDrops(t)).toBeGreaterThan(0)
  })

  it('⛔ not rewritten when the handle is reassigned between them', () => {
    const t = host(loopOver('top = box.get_top(b)', 'b := array.get(boxes, 0)', 'if close[1] > top', '    array.remove(boxes, i)', '    box.delete(b)'))
    expect(objDrops(t)).toBeGreaterThan(0)
  })

  it('⛔ not rewritten for a history read of the local (`top[1]`)', () => {
    const t = host(loopOver('top = box.get_top(b)', 'if close[1] > top[1]', '    array.remove(boxes, i)', '    box.delete(b)'))
    expect(objDrops(t)).toBeGreaterThan(0)
  })
})

// ─── G2a — a first-match search loop is the chained `?:` it computes ───────────
const searchLoop = (head, ...body) => v5('x = 0.0', head, ...body, 'plot(x, "x")')
const FIRST = searchLoop('for i = 2 to 5', '    if close[i] > open[i]', '        x := i', '        break')
const chainOf = (passes) => v5('x = 0.0',
  `x := ${passes.map((v) => `(close[${v}] > open[${v}]) ? ${v} : `).join('')}x`, 'plot(x, "x")')
const plotOf = (t) => (t.outputs || []).find((o) => o.kind === 'plot')

describe('O1 G2a — `for i = A to B: if c(i): x := i; break` is the chained `?:`', () => {
  it('⛔ CONTROL — the chained spelling is served', () => {
    const p = plotOf(host(chainOf([2, 3, 4, 5])))
    expect(p && p.refusal).toBeFalsy()
    expect(p.formula).toMatch(/close\[2\] > open\[2\]/)
  })

  it('⭐⭐ SAME PLOT, TWO SPELLINGS — ascending, no `by`', () => {
    expect(sigOf(host(FIRST))).toBe(sigOf(host(chainOf([2, 3, 4, 5]))))
  })
  it('`by` a positive step, and a descending count without one', () => {
    expect(sigOf(host(searchLoop('for i = 2 to 6 by 2', '    if close[i] > open[i]', '        x := i', '        break'))))
      .toBe(sigOf(host(chainOf([2, 4, 6]))))
    expect(sigOf(host(searchLoop('for i = 5 to 2', '    if close[i] > open[i]', '        x := i', '        break'))))
      .toBe(sigOf(host(chainOf([5, 4, 3, 2]))))
  })

  const servedPlot = (src) => { const p = plotOf(host(src)); return !!(p && !p.refusal) }
  it('⛔ left alone: a test that calls something', () => {
    expect(servedPlot(searchLoop('for i = 2 to 5', '    if math.abs(close[i] - open[i]) > 1', '        x := i', '        break'))).toBe(false)
  })
  it('⛔ left alone: a body with anything else in it', () => {
    expect(servedPlot(searchLoop('for i = 2 to 5', '    if close[i] > open[i]', '        x := i', '        y = 1', '        break'))).toBe(false)
    expect(servedPlot(searchLoop('for i = 2 to 5', '    if close[i] > open[i]', '        x := i'))).toBe(false)
  })
  it('⛔ left alone: a bound that is not a literal', () => {
    expect(servedPlot(v5('n = input.int(5)', 'x = 0.0', 'for i = 2 to n', '    if close[i] > open[i]', '        x := i', '        break', 'plot(x, "x")'))).toBe(false)
  })
  it('⛔ left alone: more than 64 passes', () => {
    expect(servedPlot(searchLoop('for i = 1 to 70', '    if close[i] > open[i]', '        x := i', '        break'))).toBe(false)
  })
})
