// app/src/components/chart/engine/ast/pineConstFold.test.js
//
// ⭐⭐ engine NUMBER PENDING (Q-FCMP2) — THE HOST LANE'S COMPILE-TIME COMPARISON: in v1-v4 a comparison of two
// compile-time CONSTANTS is exact; inputs, series and reassigned names, and everything in v5 / v6, compare
// within the epsilon at run time. Each probe is translated by the member door's own translator and its trees
// evaluated with the Pine compare; the expected numbers are TradingView's readings (AMEX:SPY 1D, the last bar).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { translatePine } from './pine.js'
import { interpret } from './interpret.js'

const BARS = Array.from({ length: 12 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 10, h: 11 + i, l: 9, c: 10 + i * 0.1, v: 100 }))
const INPUTS = { ia: 1.00000000000003, ib: 1.0 }
const probe = (name) => readFileSync(`../tools/visual_conformance/probes/${name}.pine`, 'utf8')

function lastValues(name) {
  const r = translatePine(probe(name), { declareInputs: 'all' })
  expect(r.ok, JSON.stringify(r.refusal)).toBe(true)
  return r.outputs.map((o) => {
    const col = interpret(o.ast, BARS, INPUTS, undefined, undefined, { pineCompare: true })
    return typeof col === 'number' ? col : col[col.length - 1]
  })
}

describe('vw-fcmp-const-v4 / -v5 (Q-FCMP2 rows 11 / 12): which operands v4 compares exactly', () => {
  it('v4: literals, named literals, sums, a function\'s literal, a ?: of literals and int vs float are exact', () => {
    expect(lastValues('vw-fcmp-const-v4').slice(1)).toEqual([50, 50, 50, 50, 41, 41, 41, 41, 41, 50, 50, 14, 50, 50])
  })
  it('v5: everything is the run\'s tolerant compare', () => {
    expect(lastValues('vw-fcmp-const-v5').slice(1)).toEqual([41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41])
  })
})

describe('the form probes\' const twins (T49 / T50): v4 exact, v6 tolerant', () => {
  it('v4 T50 (two literals 2e-14 apart, inline) reads 14; v6 reads 41', () => {
    const v4 = lastValues('vw-fcmp-form-v4')
    const v6 = lastValues('vw-fcmp-form')
    expect([v4[49], v4[50]]).toEqual([14, 14])
    expect([v6[49], v6[50]]).toEqual([14, 41])
    // and every series row agrees across the two versions (T01-T48), as TradingView's twins do
    expect(v4.slice(1, 49)).toEqual(v6.slice(1, 49))
  })
})
