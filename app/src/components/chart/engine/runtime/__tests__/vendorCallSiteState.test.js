// app/src/components/chart/engine/runtime/__tests__/vendorCallSiteState.test.js
//
// ─── ⭐⭐ THE VENDOR PARITY RAIL FOR PER-CALL-SITE FUNCTION STATE ────────────
//
// 2E-CLOSE. TradingView's own chart model, read on 2026-09-08, answers the one
// question the whole frame model rests on: does a function-local `var` belong to
// the FUNCTION or to the CALL SITE?
//
//   fixture: tests/fixtures/vendor/runtime/callsite-state-spy-1d-2026-09-08.json
//
// ⛔⛔ THE EXPECTATIONS HERE COME FROM THE FIXTURE, NOT FROM THIS ENGINE. That is
// the whole point, and it is the `color.red` lesson written as a test: a rail
// that asserts our own constant proves only that we are consistent with
// ourselves. `#F23645` survived a 7,485-test suite because every colour rail did
// exactly that.
//
// ⚠️ THE ABSOLUTE COUNTER VALUES ARE NOT THE EVIDENCE and this rail does not use
// them. TradingView accumulates over its full loaded history (~8,459 bars), so
// its `A` reads ~8160 where ours reads 1 on the same visible window. What is
// invariant to history depth — and what actually discriminates the two
// hypotheses — is the STEP of each counter and the exact RATIO between them.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const FIXTURE = path.resolve(
  process.cwd(), '../tests/fixtures/vendor/runtime/callsite-state-spy-1d-2026-09-08.json')
const V = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))

const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1000,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

function runPine(src) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  })
  return outputs.map((o) => Array.from(o))
}

const steps = (xs) => [...new Set(xs.slice(1).map((v, i) => +(v - xs[i]).toFixed(10)))]

describe('⭐⭐ vendor: a function-local `var` is per CALL SITE, not per function', () => {
  it('the fixture records a discriminating result, not a plausible one', () => {
    // ⛔ A guard on the ORACLE itself. If the fixture were ever edited into
    // something that cannot tell the two hypotheses apart, every assertion below
    // would still pass while proving nothing.
    expect(V.conclusion.rule).toMatch(/INDEPENDENT PER CALL SITE/)
    expect(V.conclusion.rejects).toMatch(/per-function/)
    expect(V.observations.v5.distinct_A_step).toEqual([1])
    expect(V.observations.v5.distinct_B_step).toEqual([10])
    expect(V.observations.v5.distinct_B_over_A).toEqual([10])
    expect(V.observations.v5.rows_where_ratio_not_10).toBe(0)
    // and the two hypotheses must actually differ
    expect(V.hypotheses.per_call_site).not.toBe(V.hypotheses.per_function_definition)
  })

  it('⭐⭐ UCT reproduces the vendor RELATIONSHIPS on the vendor probe source', () => {
    const [A, B] = runPine(V.probe_source)
    expect(steps(A), 'A step').toEqual(V.observations.v5.distinct_A_step)
    expect(steps(B), 'B step').toEqual(V.observations.v5.distinct_B_step)
    const ratios = [...new Set(A.map((a, i) => +(B[i] / a).toFixed(10)))]
    expect(ratios, 'B / A').toEqual(V.observations.v5.distinct_B_over_A)
  })

  it('⭐ v6 agrees with v5, so the rule is not version-specific', () => {
    expect(V.observations.v6.distinct_A_step).toEqual(V.observations.v5.distinct_A_step)
    expect(V.observations.v6.distinct_B_step).toEqual(V.observations.v5.distinct_B_step)
    expect(V.conclusion.versions_agree).toBe(true)
    const v6src = V.probe_source.replace('//@version=5', '//@version=6')
    const [A, B] = runPine(v6src)
    expect(steps(A)).toEqual(V.observations.v6.distinct_A_step)
    expect(steps(B)).toEqual(V.observations.v6.distinct_B_step)
  })

  it('⛔ NON-VACUITY — the SHARED hypothesis would NOT satisfy these assertions', () => {
    // What a per-function implementation produces, computed here longhand: the
    // two calls interfere, so A steps by 11 and B - A is a constant 10.
    let c = 0
    const A = [], B = []
    for (let i = 0; i < N; i += 1) { c += 1; A.push(c); c += 10; B.push(c) }
    expect(steps(A)).toEqual([11])
    expect(steps(A)).not.toEqual(V.observations.v5.distinct_A_step)
    const ratios = [...new Set(A.map((a, i) => +(B[i] / a).toFixed(10)))]
    expect(ratios).not.toEqual(V.observations.v5.distinct_B_over_A)
  })
})

describe('⭐ vendor: `%` is TRUNCATED — the sign follows the dividend', () => {
  it('the fixture rejects the floored reading', () => {
    expect(V.modulo.conclusion).toMatch(/truncated/i)
    expect(V.modulo.rejects).toMatch(/floored/i)
    // the discriminating cell: floored would answer +1 here
    expect(V.modulo.observations['-7 % 2']).toBe(-1)
  })

  it('⭐⭐ the table `mod` Phase 1 lowered `%` onto matches the vendor', () => {
    // Phase 1 lowered `%` to `mod` from DOCUMENTATION alone and said so. This is
    // that decision meeting the oracle.
    const cases = V.modulo.observations
    for (const [expr, expected] of Object.entries(cases)) {
      const [a, b] = expr.split('%').map((s) => Number(s.trim()))
      const src = `//@version=5\nindicator("t")\nplot(${a} % ${b})\n`
      const [out] = runPine(src)
      expect(out[N - 1], `${expr}`).toBe(expected)
    }
  })
})
