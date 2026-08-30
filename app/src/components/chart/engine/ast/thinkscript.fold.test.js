// app/src/components/chart/engine/ast/thinkscript.fold.test.js
//
// ─── ⭐⭐ A `fold` THAT IS A ROLLING SUM, AND NOTHING ELSE ───────────────────
//
// ⛔⛔ THIS EXISTS INSTEAD OF A COLLECTION NODE TYPE, and the reason is measured.
// Four independent designs and three adversaries examined adding collections to the
// closed grammar; all four designs and all three judges reached the same answer.
// `pine:collection` is the FIRST wall for exactly ONE script in 75 and appears
// nowhere else — and that script has FOUR more walls behind the array (`pine:tuple`,
// `pine:builtin`, `pine:state`, and `pine:request` for a `'D'` rung `TF_RESAMPLABLE`
// cannot serve). The measured corpus delta of the permanent grammar change is ZERO
// scripts. This recogniser, which changes no grammar at all, is +1.
//
// ⭐ `fold i = 0 to 8 with p do p + GetValue(<expr>, i)` IS `sum(<expr>, 8)`.
// thinkorswim's fold runs while `index < end`, so the bound is EXCLUSIVE and `0 to
// 8` is eight terms. Reading it as inclusive would compute a nine-bar sum under the
// member's own title with nothing announcing the substitution.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translateThinkScript } from './thinkscript.js'
import { parseFormula } from './parse.js'
import { maxLookback } from './interpret.js'

const ROOT = path.resolve(process.cwd(), '..')
const formulaOf = (out) => (out.outputs.find((o) => o.formula) || {}).formula
const sum = (body) => `def s = ${body};\nplot x = s;\n`

describe('the one fold shape that is a rolling sum', () => {
  it('⭐⭐ the REAL corpus script translates, and to the right thing', () => {
    // ⛔ THE FORMULA, NOT MERELY `ok`. `18-fold-up-down-points-ratio` computes the
    // ratio of up-points to down-points over eight bars; a recogniser that produced
    // *a* formula rather than *the* formula would pass an `ok` check happily.
    const src = fs.readFileSync(
      path.join(ROOT, 'tests/fixtures/thinkscript/18-fold-up-down-points-ratio.ts'), 'utf8')
    const out = translateThinkScript(src)
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(formulaOf(out)).toBe(
      'sum(close > close[1] ? close - close[1] : 0, 8) '
      + '/ abs(sum(close < close[1] ? close - close[1] : 0, 8))')
  })

  it('⛔⛔ the bound is EXCLUSIVE — `0 to 8` is EIGHT terms, not nine', () => {
    // ⚰️ THE OFF-BY-ONE THAT WOULD BE INVISIBLE. Both forms translate, both compute,
    // both look right on a chart, and one is a different indicator. thinkorswim's
    // own semantics are `while index < end`.
    expect(formulaOf(translateThinkScript(sum('fold i = 0 to 8 with p do p + GetValue(close, i)'))))
      .toBe('sum(close, 8)')
    expect(formulaOf(translateThinkScript(sum('fold i = 0 to 3 with p do p + GetValue(volume, i)'))))
      .toBe('sum(volume, 3)')
  })

  it('⭐ the result is an ordinary tree — lookback is a plain tree sum', () => {
    const f = formulaOf(translateThinkScript(sum('fold i = 0 to 5 with p do p + GetValue(close, i)')))
    const ast = parseFormula(f).ast
    expect(ast.type).toBe('call')
    expect(ast.name).toBe('sum')
    expect(maxLookback(ast)).toBe(5)
  })

  it('⛔ an explicit ZERO seed is the same fold', () => {
    expect(formulaOf(translateThinkScript(
      sum('fold i = 0 to 5 with p = 0 do p + GetValue(close, i)')))).toBe('sum(close, 5)')
  })

  it('⛔⛔ EVERY OTHER FOLD KEEPS ITS REFUSAL, with the same guard', () => {
    // ⭐ THE HALF THAT MAKES THE RECOGNISER SAFE. A shape recognised loosely is how a
    // translator answers a plausible different number, so each of these differs from
    // the accepted shape in exactly ONE way and each must still refuse.
    const notSums = {
      'a non-zero seed is a sum PLUS something':
        'fold i = 0 to 5 with p = 5 do p + GetValue(close, i)',
      'a product is not a sum':
        'fold i = 0 to 5 with p do p * GetValue(close, i)',
      'a fixed index reads one bar, not a window':
        'fold i = 0 to 5 with p do p + GetValue(close, 2)',
      'a different index variable is a different loop':
        'fold i = 0 to 5 with p do p + GetValue(close, j)',
      'the accumulator must be the one being folded':
        'fold i = 0 to 5 with p do q + GetValue(close, i)',
      'a body that is not an addition at all':
        'fold i = 0 to 5 with p do GetValue(close, i)',
    }
    for (const [why, body] of Object.entries(notSums)) {
      const out = translateThinkScript(sum(body))
      expect(out.ok, `ACCEPTED and should not have: ${why}`).toBe(false)
      expect(out.refusal.guard, why).toBe('thinkscript:fold')
    }
  })

  it('⛔ a non-literal bound refuses — a window must be a whole number', () => {
    for (const body of ['fold i = 0 to n with p do p + GetValue(close, i)',
      'fold i = 0 to 2 + 3 with p do p + GetValue(close, i)']) {
      expect(translateThinkScript(sum(body)).ok, body).toBe(false)
    }
  })

  it('⛔ an empty or backwards range is not a window', () => {
    for (const body of ['fold i = 0 to 0 with p do p + GetValue(close, i)',
      'fold i = 5 to 2 with p do p + GetValue(close, i)']) {
      expect(translateThinkScript(sum(body)).ok, body).toBe(false)
    }
  })
})
