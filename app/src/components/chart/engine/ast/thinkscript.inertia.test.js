// app/src/components/chart/engine/ast/thinkscript.inertia.test.js
//
// ─── ⭐⭐ A LINEAR REGRESSION FOR THE thinkScript DOOR, AT ZERO NEW VOCABULARY ──
//
// `Inertia(data, length)` is thinkorswim's least-squares curve. The reflex is to
// declare a `linreg` function — and this file exists partly because that reflex
// was followed once and reverted: adding it broke `ta.linreg`, which the Pine
// door has expanded correctly all along, and `pine.js::EXPANSIONS.vwma` had
// already written down why:
//
//   "A table entry would have been the reflex and it would have added a name to
//    the sayable vocabulary, the picker, the plain-language door and both
//    interpreters, to express something the table can already say."
//
// ⭐ THE MATHS WAS ALREADY MEASURED ONE DOOR OVER, so this door inherits it
// rather than asserting a second result about the same arithmetic. Pine's closed
// form at `offset = 0` collapses to the least-squares endpoint identity:
//
//     C = 6·((n−1)/2) / (n·(n−1)) = 3/n
//     ⇒ sum/n + 3·wma − 3·sum/n = 3·wma − 2·sma
//
// ⛔⛔ AND THE CLAIM IS CHECKED ACROSS THE DOORS, NOT RE-DERIVED. Re-deriving the
// identity in the test would be the same algebra written twice and would agree
// with itself even if `wma` were weighted backwards. Running BOTH doors on real
// bars and differencing the columns is a claim that can fail.

import { describe, it, expect } from 'vitest'

import { translateThinkScript, TS_CALL_SHAPES } from './thinkscript.js'
import { translatePine } from './pine.js'
import { parseFormula } from './parse.js'
import { interpret } from './interpret.js'

const BARS = Array.from({ length: 80 }, (_, i) => ({
  t: 20260101 + i, o: 1, h: 1, l: 1,
  c: 100 + Math.sin(i / 3) * 8 + i * 0.4, v: 1000,
}))

const col = (formula) => interpret(parseFormula(formula).ast, BARS, {})
const tsFormula = (src) => {
  const out = translateThinkScript(src)
  expect(out.ok, out.ok ? '' : `${out.refusal.guard}: ${out.refusal.message}`).toBe(true)
  return out.outputs[out.selected].formula
}
const pineFormula = (body) => {
  const out = translatePine(`//@version=5\nindicator("t")\nplot(${body})\n`)
  expect(out.ok, out.ok ? '' : `${out.refusal.guard}: ${out.refusal.message}`).toBe(true)
  return out.outputs[out.selected].formula
}

/** Max |a − b| over the bars where BOTH are a number, plus how many those were. */
function agree(a, b) {
  let max = 0
  let shared = 0
  for (let i = 0; i < BARS.length; i++) {
    const x = a[i]
    const y = b[i]
    // ⛔ A NaN ON ONE SIDE ONLY IS A DISAGREEMENT, not a bar to skip — two
    // columns with different warmups would otherwise "agree" on their overlap.
    if (Number.isNaN(x) !== Number.isNaN(y)) return { max: Infinity, shared }
    if (Number.isNaN(x)) continue
    max = Math.max(max, Math.abs(x - y))
    shared += 1
  }
  return { max, shared }
}

describe('Inertia is the same line ta.linreg already draws', () => {
  it('⭐ it expands into the table’s own vocabulary, adding no name', () => {
    expect(tsFormula('plot p = Inertia(close, 20);\n'))
      .toBe('3 * wma(close, 20) - 2 * sma(close, 20)')
  })

  it('⭐⭐ the two doors draw the SAME COLUMN — the claim that can fail', () => {
    const ts = col(tsFormula('plot p = Inertia(close, 20);\n'))
    const pine = col(pineFormula('ta.linreg(close, 20, 0)'))
    const { max, shared } = agree(ts, pine)
    expect(shared).toBeGreaterThan(50)
    expect(max).toBeLessThan(1e-9)
  })

  it('⛔ …and they are NOT the same text, so that was not a tautology', () => {
    // ⚠️ WITHOUT THIS THE CASE ABOVE COULD BE COMPARING ONE FORMULA WITH ITSELF.
    // The whole point is two spellings of one line: Pine keeps its `offset` in a
    // folded constant, thinkScript collapses to the endpoint identity.
    const ts = tsFormula('plot p = Inertia(close, 20);\n')
    const pine = pineFormula('ta.linreg(close, 20, 0)')
    expect(ts).not.toBe(pine)
    expect(pine).toContain('sum(close, 20)')
    expect(ts).not.toContain('sum(close, 20)')
  })

  it('⛔⛔ the identity depends on `wma` weighting the NEWEST bar heaviest', () => {
    // ⭐ MEASURED, NOT TRUSTED. `pine.js` states this dependency in a comment;
    // a comment naming a mechanism is a claim about a run, so the run is here.
    // Weighted the other way the regression line leans backwards on every chart
    // and still plots — nothing else in this file would notice.
    const ramp = [1, 2, 3, 4, 5].map((c, i) => ({ t: 20260101 + i, o: c, h: c, l: c, c, v: 1 }))
    const w = interpret(parseFormula('wma(close, 3)').ast, ramp, {})
    expect(w[4]).toBeCloseTo(4 + 1 / 3, 9)
    expect(w[4]).not.toBeCloseTo(3 + 2 / 3, 3)
  })

  it('⛔ a one-bar window has no line, and both doors say so', () => {
    // Two points define a line; one does not. `3*wma - 2*sma` would quietly
    // return the bar’s own value — a number with no regression in it.
    const ts = translateThinkScript('plot p = Inertia(close, 1);\n')
    expect(ts.ok).toBe(false)
    expect(ts.refusal.guard).toBe('thinkscript:window')

    const pine = translatePine('//@version=5\nindicator("t")\nplot(ta.linreg(close, 1, 0))\n')
    expect(pine.ok).toBe(false)
  })

  it('⭐ the shape carries its citation, and it names the page that publishes the maths', () => {
    // ⛔ A MAPPING WITHOUT EVIDENCE IS HOW A NAME MATCH BECOMES A DEFINITION
    // MATCH. Every entry in this table carries `cite`; this asserts ours is not
    // the one that quietly does not.
    const shape = TS_CALL_SHAPES.inertia
    expect(shape.expand).toBe('inertia')
    expect(shape.engines).toEqual(['wma', 'sma'])
    expect(shape.cite).toMatch(/Functions\/Statistical\/Inertia/)
    expect(shape.cite).toMatch(/least-squares/)
  })
})
