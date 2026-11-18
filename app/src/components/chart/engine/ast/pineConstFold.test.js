// app/src/components/chart/engine/ast/pineConstFold.test.js
//
// ⭐⭐ engine 78 (#1858) (Q-FCMP2) — THE HOST LANE'S COMPILE-TIME COMPARISON: in v1-v4 a comparison of two
// compile-time CONSTANTS is exact; inputs, series and reassigned names, and everything in v5 / v6, compare
// within the epsilon at run time. Each probe is translated by the member door's own translator and its trees
// evaluated with the Pine compare; the expected numbers are READ OFF the committed captures (AMEX:SPY 1D, the last
// bar of each probe row: every row here is a pair of literals, the same on every bar).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { translatePine } from './pine.js'
import { interpret } from './interpret.js'

const BARS = Array.from({ length: 12 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 10, h: 11 + i, l: 9, c: 10 + i * 0.1, v: 100 }))
const INPUTS = { ia: 1.00000000000003, ib: 1.0 }
const probe = (name) => readFileSync(`../tools/visual_conformance/probes/${name}.pine`, 'utf8')
/** TradingView's last-bar reading of every plot of a committed probe capture, in plot order (index 0 = the control). */
function tvLast(name) {
  const cap = JSON.parse(readFileSync(`../tests/fixtures/vendor/harness/${name}-spy-1d-2026-11-18.json`, 'utf8'))
  const last = cap.plotValues.rows[cap.plotValues.rows.length - 1]
  return cap.study.plots.map((p) => last[cap.plotValues.fields.indexOf(p.id)])
}

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
    expect(tvLast('vw-fcmp-const-v4').slice(1)).toEqual([50, 50, 50, 50, 41, 41, 41, 41, 41, 50, 50, 14, 50, 50])
    expect(lastValues('vw-fcmp-const-v4').slice(1)).toEqual(tvLast('vw-fcmp-const-v4').slice(1))
  })
  it('v5: everything is the run\'s tolerant compare', () => {
    expect(tvLast('vw-fcmp-const-v5').slice(1)).toEqual(Array(14).fill(41))
    expect(lastValues('vw-fcmp-const-v5').slice(1)).toEqual(tvLast('vw-fcmp-const-v5').slice(1))
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
  // ⭐ the D4 twins (#1849): v1 / v2 / v3 read as v4 does, every row, as TradingView read them (run fcmp2b)
  for (const name of ['vw-fcmp-form', 'vw-fcmp-form-v5', 'vw-fcmp-form-v4', 'vw-fcmp-form-v3', 'vw-fcmp-form-v2', 'vw-fcmp-form-v1']) {
    it(`${name}: every row T01-T50 is TradingView's last-bar reading`, () => {
      expect(lastValues(name).slice(1)).toEqual(tvLast(name).slice(1))
    })
  }
})
