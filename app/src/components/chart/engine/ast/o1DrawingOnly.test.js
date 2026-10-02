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
