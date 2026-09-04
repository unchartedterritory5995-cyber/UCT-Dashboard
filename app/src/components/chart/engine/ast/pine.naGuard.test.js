// app/src/components/chart/engine/ast/pine.naGuard.test.js
//
// ─── ⭐⭐ THE DEFENSIVE SPELLING WAS WORSE THAN THE CARELESS ONE ─────────────
//
// `ta.barssince(c)` bare is unbounded and refuses. `ta.barssince(c) <= K` is
// bounded and translates. Every careful author writes the FIRST beside the
// SECOND —
//
//     age   = ta.barssince(cross)
//     fresh = not na(age) and age <= within
//
// — so `na(age)` reached `resolve` on its own, hit the unbounded refusal, and
// took the whole script down over a term that cannot change the answer. Four of
// the forty-eight blind scripts are exactly this shape.
//
// ⭐ THE TERM CANNOT CHANGE THE ANSWER because a comparison against `na` yields
// `na`, and `na` is falsy: `age <= K` is ALREADY false wherever `age` is `na`,
// which is all `not na(age)` was enforcing.
//
// ⛔⛔ BUT IT IS NOT AN IDENTITY IN THIS ENGINE, AND THAT IS WHY THE RULE IS
// NARROW. `!na(x) && x > k` answers a hard FALSE on a bar where `x` is blank;
// `x > k` alone answers NOT COMPUTABLE. "It did not match" and "we could not
// tell" are different facts to a member — `CoverageLine` exists to keep them
// apart — so the guard is dropped ONLY where keeping it means no column at all.
// A script that already translates is left byte-identical.

import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

const S = (lines) => ['//@version=6', 'indicator("s")', ...lines, ''].join('\n')

const AGE = [
  'cross = ta.crossover(close, ta.sma(close, 50))',
  'age = ta.barssince(cross)',
]

function formulaOf(src) {
  const out = translatePine(src)
  expect(out.ok, out.ok ? '' : out.refusal.guard + ': ' + out.refusal.message).toBe(true)
  return out.outputs[out.selected].formula
}
function refusalOf(src) {
  const out = translatePine(src)
  expect(out.ok, 'expected a refusal, got: ' + (out.ok ? formulaOf(src) : '')).toBe(false)
  return out.refusal
}

describe('⭐⭐ a redundant `na` guard beside a bounded comparison', () => {
  it('⭐ the guarded spelling now translates — and to the SAME column as the bare one', () => {
    const bare = formulaOf(S([...AGE, 'plot(age <= 3 ? 1 : 0)']))
    const guarded = formulaOf(S([...AGE, 'plot(not na(age) and age <= 3 ? 1 : 0)']))
    // ⛔ BYTE-IDENTICAL, not merely "both translate". If the guard survived in any
    // form the two would differ, and the claim of this rule is that the term is
    // gone because it could not matter.
    expect(guarded).toBe(bare)
    expect(guarded).toContain('barssince(')
    expect(guarded).not.toContain('na(')
  })

  it('⭐ either order, because members write it both ways', () => {
    const bare = formulaOf(S([...AGE, 'plot(age <= 3 ? 1 : 0)']))
    expect(formulaOf(S([...AGE, 'plot(age <= 3 and not na(age) ? 1 : 0)']))).toBe(bare)
  })

  it('⭐ and through the binding the corpus actually uses', () => {
    const src = S([...AGE,
      'within = input.int(3, "Max bars since cross")',
      'fresh = not na(age) and age <= within',
      'plot(fresh and close > ta.sma(close, 100) ? 1 : 0)'])
    expect(formulaOf(src)).toContain('barssince(')
    expect(formulaOf(src)).not.toContain('na(')
  })

  it('⛔⛔ UNDER A DISJUNCTION THE GUARD IS NOT REDUNDANT, and is not dropped', () => {
    // ⚰️ THE SOUNDNESS BOUNDARY. In `not na(x) and (x <= 3 or close > open)` an `x`
    // that is `na` makes the left arm falsy while the RIGHT arm can still be true,
    // so dropping the guard would turn a false into a true — a wrong answer rather
    // than a refusal. Walking only through `and` is the whole proof.
    const r = refusalOf(S([...AGE, 'plot(not na(age) and (age <= 3 or close > open) ? 1 : 0)']))
    expect(r.guard).toBe('pine:function')
    expect(r.message).toContain('ta.barssince')
  })

  it('⛔ a guard beside an UNRELATED comparison is not dropped either', () => {
    // The rule requires the comparison to be on the SAME name; otherwise the
    // guard is load-bearing and removing it changes the answer.
    const r = refusalOf(S([...AGE, 'plot(not na(age) and close > open ? 1 : 0)']))
    expect(r.guard).toBe('pine:function')
  })

  it('⛔⛔ A GUARD THAT ALREADY WORKS IS LEFT ALONE — the narrowing, measured', () => {
    // ⚰️ THE FIRST DRAFT DROPPED IT UNCONDITIONALLY and rewrote
    // `20-smc-toolkit-udt`, a community script that already translated: explicit
    // zeroes before the first pivot became blanks. `pine.corpus.test.js` caught it.
    // Here the guarded value is an ordinary accumulator that resolves fine, so the
    // guard must survive verbatim.
    const src = S([
      'var float lastUp = na',
      'lastUp := close > open ? high : lastUp',
      'plot(not na(lastUp) and close > lastUp ? 1 : 0)'])
    const f = formulaOf(src)
    expect(f, 'the working guard was dropped').toContain('!na(')
    expect(f).toContain('accum(')
  })

  it('⛔ and the bare unbounded call still refuses — no vocabulary was widened', () => {
    expect(refusalOf(S([...AGE, 'plot(age > 0 and na(age) ? 1 : 0)'])).guard).toBe('pine:function')
    expect(refusalOf(S([...AGE, 'plot(na(age) ? 1 : 0)'])).guard).toBe('pine:function')
    // ⛔ `or` is not `and`, even in the guard position.
    expect(refusalOf(S([...AGE, 'plot(not na(age) or age <= 3 ? 1 : 0)'])).guard).toBe('pine:function')
  })
})
