// app/src/components/chart/engine/runtime/__tests__/vendorSkippedCallHistory.test.js
//
// ─── ⭐⭐⭐ THE VENDOR RAIL FOR A SKIPPED CALL SITE'S HISTORY ─────────────────
//
// P7.2. The directive called this "the most important unresolved semantic in the
// wave", and it is: 21 of the 24 windowed-over-state scripts read history over a
// UDF parameter, and a UDF call inside an `if` does not run on every bar.
//
//   fixture: tests/fixtures/vendor/runtime/skipped-callsite-history-spy-1d-2026-09-08.json
//
// FIVE hypotheses were live, and the probe had to separate all five:
//
//   A1  a skipped bar leaves the series `na`
//   A2  the series is indexed by CHART BAR and HOLDS across skipped bars
//   B   history counts INVOCATIONS, not bars
//   C   every offset clamps to the last executed value
//   D   the call runs every bar anyway, despite the `if`
//
// ⭐⭐ ONE PROBE CANNOT DO IT. With the call site firing every third bar:
// `v[1]` and `v[2]` both reading `A-3` kills B (which needs `A-6` at `v[2]`), A1
// and D. But A2 and C are still tied — so a SECOND probe reads `v[3]` and `v[4]`:
// `A-3` and `A-6`. Clamping would have answered `A-3` for both. Only A2 survives.
//
// ⛔⛔ THE EXPECTATIONS COME FROM THE FIXTURE, NOT FROM THIS ENGINE. A rail that
// asserts our own constant proves only that we are consistent with ourselves.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const FIXTURE = path.resolve(
  process.cwd(), '../tests/fixtures/vendor/runtime/skipped-callsite-history-spy-1d-2026-09-08.json')
const V = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))

const N = 60
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
const isNa = (v) => Number.isNaN(v)

describe('⭐⭐ vendor: a skipped call site HOLDS its function-local series', () => {
  it('the fixture separates all five hypotheses, not merely two', () => {
    // ⛔ A guard on the ORACLE. If the fixture were edited into something that
    // cannot discriminate, every assertion below would still pass.
    expect(V.conclusion.rule).toMatch(/CHART BAR/)
    expect(V.conclusion.rule).toMatch(/HOLDS/)
    expect(V.probes.shallow_v5.observations.distinct_A_minus_v1).toEqual([3])
    expect(V.probes.shallow_v5.observations.distinct_A_minus_v2).toEqual([3])
    expect(V.probes.deep_v5.observations.distinct_A_minus_v3).toEqual([3])
    expect(V.probes.deep_v5.observations.distinct_A_minus_v4).toEqual([6])
    // the five hypotheses must actually be five different statements
    const hs = Object.values(V.hypotheses)
    expect(new Set(hs).size).toBe(hs.length)
    expect(V.conclusion.rejects).toEqual(expect.arrayContaining([
      'per-invocation indexing', 'clamp-to-last-execution', 'na-on-skipped-bar',
    ]))
  })

  it('⛔ the compiled study identity was proved for every probe', () => {
    for (const key of ['shallow_v5', 'deep_v5', 'deep_v6']) {
      const p = V.probes[key].compiled_study_identity_proof
      expect(p.plot_titles, key).toEqual(['A', 'B', 'C', 'D'])
      expect(p.plot_count, key).toBe(4)
      expect(p.other_uct_studies_on_chart, key).toBe(0)
      expect(String(p.shortDescription), key).toMatch(/^UCT skipcall/)
    }
  })

  it('⭐⭐⭐ UCT reproduces the vendor RELATIONSHIPS on a gap-of-3 call site', () => {
    // The vendor probe verbatim in shape: one call site inside `if`, firing every
    // third bar, handed a monotonic counter so every answer is self-labelling.
    // ⚠️ `bar_index` here is the ENGINE's own bar ordinal over a 60-bar fixture,
    // where TradingView's ran over ~8,459 — which is exactly why the fixture's
    // evidence is the RELATIONSHIP (`A - v[k]`) and never the absolute value.
    const head = '//@version=5\nindicator("t")\n'
    const probe = (back) => `${head}f(v) =>\n    v[${back}]\ngo = bar_index % 3 == 0\nfloat p = na\nif go\n    p := f(bar_index)\nplot(bar_index, "A")\nplot(p, "B")\nplot(go ? 1 : 0, "D")\n`

    const gaps = {}
    for (const back of [1, 2, 3, 4]) {
      const [A, B, D] = runPine(probe(back))
      // only bars where the site actually ran, and only once history exists
      const seen = new Set()
      for (let i = 0; i < N; i += 1) {
        if (D[i] !== 1 || isNa(B[i])) continue
        seen.add(A[i] - B[i])
      }
      gaps[back] = [...seen]
    }

    // ⭐ THE VENDOR'S FOUR NUMBERS, ASSERTED AGAINST THE FIXTURE
    expect(gaps[1], 'A - v[1]').toEqual(V.probes.shallow_v5.observations.distinct_A_minus_v1)
    expect(gaps[2], 'A - v[2]').toEqual(V.probes.shallow_v5.observations.distinct_A_minus_v2)
    expect(gaps[3], 'A - v[3]').toEqual(V.probes.deep_v5.observations.distinct_A_minus_v3)
    expect(gaps[4], 'A - v[4]').toEqual(V.probes.deep_v5.observations.distinct_A_minus_v4)
  })

  it('⭐ v6 agrees with v5, so the rule is not version-specific', () => {
    expect(V.probes.deep_v6.observations.distinct_A_minus_v3)
      .toEqual(V.probes.deep_v5.observations.distinct_A_minus_v3)
    expect(V.probes.deep_v6.observations.distinct_A_minus_v4)
      .toEqual(V.probes.deep_v5.observations.distinct_A_minus_v4)
    expect(V.conclusion.versions_agree).toBe(true)
  })

  it('⛔ NON-VACUITY — the four rejected models would fail these assertions', () => {
    // Computed longhand for a gap-of-3 site, so the rail is shown to discriminate
    // rather than merely to pass.
    const perInvocation = { 1: 3, 2: 6, 3: 9, 4: 12 }
    const clamp = { 1: 3, 2: 3, 3: 3, 4: 3 }
    const everyBar = { 1: 1, 2: 2, 3: 3, 4: 4 }
    const hold = { 1: 3, 2: 3, 3: 3, 4: 6 }   // ← what the vendor answered

    expect(perInvocation[2]).not.toBe(hold[2])   // B dies at v[2]
    expect(clamp[4]).not.toBe(hold[4])           // C dies at v[4]
    expect(everyBar[1]).not.toBe(hold[1])        // D dies at v[1]
    // …and A1 (na on a skipped bar) would produce NO comparable rows at all
    expect(hold[1]).toBe(V.probes.shallow_v5.observations.distinct_A_minus_v1[0])
    expect(hold[4]).toBe(V.probes.deep_v5.observations.distinct_A_minus_v4[0])
  })
})

describe('⚠️ what this fixture does NOT pin', () => {
  it('says so out loud, rather than letting silence read as coverage', () => {
    expect(V.not_observed.warmup_at_the_first_bar_of_history).toMatch(/NOT vendor-pinned/i)
    expect(V.not_observed.committed_na_history_value).toMatch(/NOT vendor-pinned/i)
    // ⭐ Per-call-site HISTORY identity is implemented to match the 2E pin on
    // per-call-site PERSISTENT STATE, but it was not separately captured — and
    // the fixture is the place that admits it.
    expect(V.not_observed.two_distinct_call_sites_to_one_udf_with_history).toMatch(/not separately vendor-pinned/i)
  })
})
