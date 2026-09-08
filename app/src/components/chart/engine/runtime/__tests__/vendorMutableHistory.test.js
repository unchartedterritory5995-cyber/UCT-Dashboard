// app/src/components/chart/engine/runtime/__tests__/vendorMutableHistory.test.js
//
// ─── ⭐⭐⭐ THE VENDOR PARITY RAIL FOR RUNTIME MUTABLE HISTORY ────────────────
//
// 2F-2A-CLOSE. TradingView's own chart model, read on 2026-09-08, answers the
// two questions the history architecture rests on:
//
//   1. is `x[1]` the PREVIOUS COMMITTED BAR, or the CURRENT live slot?
//   2. when a bar assigns a variable more than once, WHICH value does that bar
//      contribute to history?
//
//   fixture: tests/fixtures/vendor/runtime/mutable-history-spy-1d-2026-09-08.json
//
// ⛔⛔ THE EXPECTATIONS HERE COME FROM THE FIXTURE, NOT FROM THIS ENGINE. That is
// the whole point, and it is the `color.red` lesson written as a test: a rail
// that asserts our own constant proves only that we are consistent with
// ourselves.
//
// ⚠️ THE ABSOLUTE COUNTER VALUES ARE NOT THE EVIDENCE and this rail does not use
// them — TradingView accumulates over ~8,459 loaded bars, so its `A` reads ~8,459
// where ours reads 40 on the same probe. What is invariant to history depth, and
// what actually discriminates the hypotheses, is the RELATIONSHIPS between the
// four plots.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const FIXTURE = path.resolve(
  process.cwd(), '../tests/fixtures/vendor/runtime/mutable-history-spy-1d-2026-09-08.json')
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
/** Distinct values of a per-row relationship, ignoring rows where either side is
 *  `na` — which is how the vendor read was reduced too. */
const distinct = (xs) => [...new Set(xs.filter((v) => !Number.isNaN(v)).map((v) => +v.toFixed(10)))]

describe('⭐⭐ vendor: `x[1]` is the previous COMMITTED bar, not the live slot', () => {
  it('the fixture records a DISCRIMINATING result, not a plausible one', () => {
    // ⛔ A guard on the ORACLE itself. If the fixture were ever edited into
    // something that cannot tell the hypotheses apart, every assertion below
    // would still pass while proving nothing.
    expect(V.conclusion.rule_1).toMatch(/PREVIOUS COMMITTED BAR/)
    expect(V.conclusion.rule_2).toMatch(/FINAL value/)
    expect(V.observations.v5.distinct_A_minus_B).toEqual([1])
    expect(V.observations.v5.distinct_C_minus_D).toEqual([100])
    expect(V.observations.v5.B_equals_previous_A).toBe('399/399')
    expect(V.observations.v5.D_equals_previous_C).toBe('399/399')
    // and the competing hypotheses must be POSITIVELY excluded by the data
    expect(V.observations.v5.rows_where_B_equals_A).toBe(0)
    expect(V.observations.v5.rows_where_D_equals_A_minus_1).toBe(0)
    // …and they must actually differ from one another
    expect(V.hypotheses.committed_previous_bar).not.toBe(V.hypotheses.reads_current_slot)
    expect(V.hypotheses.committed_previous_bar).not.toBe(V.hypotheses.commits_at_first_assignment)
  })

  it('⛔ the identity of the compiled study was proved before any value was read', () => {
    // The DOM lied on this capture too — a `.view-line` read returned 1 line
    // while the editor held 11 — so this is the gate that made the values
    // trustworthy, not a formality.
    expect(V.compiled_study_identity_proof.v5.shortDescription).toBe('UCT runtime history probe')
    expect(V.compiled_study_identity_proof.v5.plot_titles).toEqual(['A', 'B', 'C', 'D'])
    expect(V.compiled_study_identity_proof.v6.shortDescription).toBe('UCT runtime history probe v6')
    expect(V.compiled_study_identity_proof.other_uct_studies_on_chart).toBe(0)
  })

  it('⭐⭐⭐ UCT reproduces the vendor RELATIONSHIPS on the vendor probe source', () => {
    const [A, B, C, D] = runPine(V.probe_source_v5)

    // 1. `x[1]` trails `x` by exactly one bar — the vendor's `A - B`
    expect(distinct(A.map((a, i) => a - B[i])), 'A - B')
      .toEqual(V.observations.v5.distinct_A_minus_B)
    // 2. the second same-bar assignment took effect — the vendor's `C / A`
    expect(distinct(A.map((a, i) => C[i] / a)), 'C / A')
      .toEqual(V.observations.v5.distinct_C_over_A)
    // 3. ⭐ THE COMMIT-POINT CELL. `m[1]` is the previous bar's FINAL `m`, so
    //    `C - D` is 100 — the multiply is INSIDE the committed value. A runtime
    //    that committed at the first assignment would put `A - 1` in D and this
    //    difference would not be constant at all.
    expect(distinct(C.map((c, i) => c - D[i])), 'C - D')
      .toEqual(V.observations.v5.distinct_C_minus_D)

    // 4. index-for-index, which is what excludes a one-bar-early/late ring
    let bPrev = 0; let dPrev = 0; let cmp = 0
    for (let i = 1; i < N; i += 1) {
      cmp += 1
      if (B[i] === A[i - 1]) bPrev += 1
      if (D[i] === C[i - 1]) dPrev += 1
    }
    expect(`${bPrev}/${cmp}`, 'B[i] === A[i-1]').toBe(`${cmp}/${cmp}`)
    expect(`${dPrev}/${cmp}`, 'D[i] === C[i-1]').toBe(`${cmp}/${cmp}`)

    // 5. the hypotheses the vendor excluded, excluded here too
    expect(A.filter((a, i) => a === B[i]).length, 'rows where B === A').toBe(0)
    expect(D.filter((d, i) => d === A[i] - 1).length, 'rows where D === A - 1').toBe(0)
  })

  it('⭐ v6 agrees with v5, so the rule is not version-specific', () => {
    expect(V.observations.v6.distinct_A_minus_B).toEqual(V.observations.v5.distinct_A_minus_B)
    expect(V.observations.v6.distinct_C_minus_D).toEqual(V.observations.v5.distinct_C_minus_D)
    expect(V.conclusion.versions_agree).toBe(true)
    const [A, B, C, D] = runPine(V.probe_source_v6)
    expect(distinct(A.map((a, i) => a - B[i]))).toEqual(V.observations.v6.distinct_A_minus_B)
    expect(distinct(C.map((c, i) => c - D[i]))).toEqual(V.observations.v6.distinct_C_minus_D)
  })

  it('⛔ NON-VACUITY — the two WRONG implementations would fail these assertions', () => {
    // Computed here longhand, from the same probe, so the rail is shown to
    // discriminate rather than merely to pass.
    const liveA = []; const liveC = []
    let x = 0
    for (let i = 0; i < N; i += 1) { x += 1; liveA.push(x); liveC.push(x * 100) }

    // (a) "history reads the current slot": B === A and D === C.
    expect(distinct(liveA.map((a, i) => a - liveA[i])), 'reads-current A - B').toEqual([0])
    expect(distinct(liveA.map((a, i) => a - liveA[i])))
      .not.toEqual(V.observations.v5.distinct_A_minus_B)

    // (b) "commit at the FIRST assignment": D would be the pre-multiply value,
    //     so `C - D` would be `A*100 - (A-1)` — not constant, and nothing like 100.
    const dFirstAssign = liveA.map((a) => a - 1)
    const cMinusD = distinct(liveC.map((c, i) => c - dFirstAssign[i]))
    expect(cMinusD.length, 'commit-at-first-assignment C - D is not constant').toBeGreaterThan(1)
    expect(cMinusD).not.toEqual(V.observations.v5.distinct_C_minus_D)
  })
})

describe('⚠️ what this fixture does NOT pin', () => {
  it('says so out loud, rather than letting silence read as coverage', () => {
    // ⛔ The returned window starts at A = 8060, so bar 0 of the variable's life
    // is outside it: `x[1] === na` on the first bar was NOT observed. UCT answers
    // `na` there by the same rule its columnar lane already applies, and engine
    // tests cover it — but the VENDOR has not been asked, and the fixture says so.
    expect(V.not_observed.warmup_at_the_first_bar_of_history).toMatch(/NOT vendor-pinned|NOT observed/i)
    expect(V.not_observed.historical_na).toMatch(/not been asked|not probed/i)
    expect(V.conclusion.verified_versions).toEqual(['v5', 'v6'])
  })
})
