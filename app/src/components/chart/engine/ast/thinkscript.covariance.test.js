// app/src/components/chart/engine/ast/thinkscript.covariance.test.js
//
// ─── ⭐⭐ TWO STATISTICS THE PAGE PUBLISHES OUTRIGHT, AT ZERO NEW VOCABULARY ───
//
// thinkorswim's Covariance page does not describe the calculation, it PRINTS it:
//
//   "Average(data1 * data2, length) - Average(data1, length) * Average(data2, length)"
//
// and its Correlation page defines that function in terms of this one:
//
//   "Covariance(data1, data2, length) / (StDev(data1, length) * StDev(data2, length))"
//
// Both `Average` and `StDev` are already mapped in `TS_CALL_SHAPES` with their own
// citations, so neither expansion derives anything — they are the vendor's own
// formulas with one substitution each, and the table gains no name.
//
// ⛔⛔ THE ONE THING A COVARIANCE CAN BE SILENTLY WRONG ABOUT IS ITS DIVISOR, and
// nothing about the output would show it. The page spells covariance with
// `Average`, so the divisor is `n`; `interpret.js::windowStdev` is population for
// its own documented reason, also `n`. If those two ever disagreed the ratio
// would still plot, still be smooth, still look like a correlation — and sit at
// n/(n−1) where it should sit at 1. On a 20-bar window that is 1.0526, which is
// not a number anyone would notice on a chart.
//
// ⭐⭐ SO THE RAIL ASKS THE QUESTION THAT NUMBER ANSWERS: a series correlated with
// ITSELF must be exactly 1, and with its own negation exactly −1. Those two
// identities hold only when both sides divide the same way, which makes them a
// direct measurement of the convention rather than a restatement of the formula.

import { describe, it, expect } from 'vitest'

import { translateThinkScript, TS_CALL_SHAPES } from './thinkscript.js'
import { parseFormula } from './parse.js'
import { interpret } from './interpret.js'

const BARS = Array.from({ length: 60 }, (_, i) => ({
  t: 20260101 + i,
  o: 100 + Math.cos(i / 4) * 5,
  h: 110, l: 90,
  c: 100 + Math.sin(i / 3) * 8 + i * 0.3,
  v: 1000,
}))

function formula(src) {
  const out = translateThinkScript(src)
  expect(out.ok, out.ok ? '' : `${out.refusal.guard}: ${out.refusal.message}`).toBe(true)
  return out.outputs[out.selected].formula
}
const numbers = (src) => Array.from(interpret(parseFormula(formula(src)).ast, BARS, {}))
  .filter((v) => !Number.isNaN(v))

describe('Covariance and Correlation are the published formulas', () => {
  it('⭐ Covariance is the page’s own line, with Average read as `sma`', () => {
    expect(formula('plot p = Covariance(close, open, 20);\n'))
      .toBe('sma(close * open, 20) - sma(close, 20) * sma(open, 20)')
  })

  it('⭐⭐ Correlation is built from THAT tree, not a second copy of it', () => {
    // The vendor says the two are one thing; `covarianceTree` is why the code
    // says it the same way, and this is how a future edit to one that misses the
    // other gets caught (`lesson_one_grammar_four_hand_written_copies`).
    const cov = formula('plot p = Covariance(close, open, 20);\n')
    const corr = formula('plot p = Correlation(close, open, 20);\n')
    expect(corr).toContain(cov)
    expect(corr).toBe(`(${cov}) / (stdev(close, 20) * stdev(open, 20))`)
  })

  it('⛔⛔ a series against ITSELF is exactly 1 — the divisor agreement, measured', () => {
    // ⚠️ NOT `toBeCloseTo` WITH A LOOSE TOLERANCE. The failure this guards against
    // is a CONSTANT factor of n/(n−1) = 1.0526 on a 20-bar window, which a sloppy
    // tolerance would wave through while the column was wrong on every bar.
    const self = numbers('plot p = Correlation(close, close, 20);\n')
    expect(self.length).toBeGreaterThan(30)
    for (const v of self) expect(v).toBeCloseTo(1, 10)
  })

  it('⛔ …and against its own negation exactly −1, which pins the SIGN too', () => {
    const neg = numbers('plot p = Correlation(close, -close, 20);\n')
    expect(neg.length).toBeGreaterThan(30)
    for (const v of neg) expect(v).toBeCloseTo(-1, 10)
  })

  it('⭐ two DIFFERENT series stay inside [-1, 1] and actually vary', () => {
    // ⛔ THE NON-VACUITY HALF. The two identities above would both pass against a
    // function that returned the sign of its arguments and nothing else; this
    // asserts the middle of the range is populated and bounded.
    const mix = numbers('plot p = Correlation(close, open, 20);\n')
    expect(mix.length).toBeGreaterThan(30)
    for (const v of mix) {
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
    }
    expect(Math.max(...mix) - Math.min(...mix)).toBeGreaterThan(0.5)
  })

  it('⭐ the published default length of 10 is the one that fills in', () => {
    expect(formula('plot p = Correlation(close, open);\n'))
      .toContain('stdev(close, 10)')
  })

  it('⛔ both shapes carry the citation that publishes their maths', () => {
    expect(TS_CALL_SHAPES.covariance.cite).toMatch(/Average\(data1 \* data2, length\)/)
    expect(TS_CALL_SHAPES.correlation.cite).toMatch(/StDev\(data1, length\)/)
    expect(TS_CALL_SHAPES.covariance.defaults.length).toBe(10)
    expect(TS_CALL_SHAPES.correlation.defaults.length).toBe(10)
  })
})
