// app/src/components/chart/engine/ast/vendorRuledForms.test.js
//
// ─── ⭐⭐ THE GAPS THE VENDOR ALREADY ANSWERED, NOW SERVED ──────────────────
//
// `groupBVendorReadings.test.js` held three forms at `pine:arity` and recorded,
// in the same case, exactly what TradingView answers for each. Its comment said
// the refusal stood on a RULING, not on missing evidence:
//
//     "table-shape changes carrying the corpus-case price … a widening that
//      needs its own decision. Until that ruling, the ONLY acceptable behaviour
//      is a refusal."
//
// ⭐ THE RULING IS IN: the programme's goal is that a pasted script behaves as
// it does on TradingView. A form the vendor serves and we refuse is a
// difference a member can see, so each of these is served — and served to the
// vendor's own captured number, not to a reading of the reference manual.
//
//   math.round(0.125, 2)  → 0.13      (HALF AWAY FROM ZERO, not bankers')
//   math.max(1,2,3,4,5)   → 5         (variadic, at least 5 arguments)
//   math.min(5,4,3,2,1)   → 1
//
// ⛔ BOTH ARE TRANSFORMS, which is the test `PINE_NAMESPACED_TREE`'s own note
// sets for membership — `ta.highest` was reverted from that map for needing
// only a DEFAULT ARGUMENT. And the classification hazard that reversion
// recorded was checked EMPIRICALLY rather than by reading: `round`, `max`,
// `min` and `pow` appear in neither `FINITE_WINDOW` (sma, wma, stdev, sum, dev,
// median, highest, lowest, highestbars, lowestbars) nor `CARRIED` (ema, rma,
// rising, falling, barssincePine), so membership reclassifies nothing.
import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'

const LF = String.fromCharCode(10)
const Q = String.fromCharCode(34)
const head = `//@version=5${LF}indicator(${Q}t${Q})${LF}`

const N = 6
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100, h: 102, l: 98, c: 100 + i, v: 1000,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

function formula(src) {
  const out = translatePine(src, { strict: true })
  if (!out.ok) return `REFUSED ${(out.refusal || {}).guard}: ${(out.refusal || {}).message}`
  return String(out.outputs[out.selected].formula)
}

/** Run one plot through the RUNTIME lane and return its series. */
function run(src) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return Array.from(r.outputs[0])
}

describe('⭐⭐ `math.round(v, n)` — the vendor\'s own number', () => {
  it('⛔ CONTROL — the ONE-argument form is unchanged', () => {
    // ⭐ The builder now owns every arity it accepts, so the form that already
    // reached the table directly must still produce the same column.
    expect(formula(`${head}plot(math.round(close))${LF}`)).toBe('round(close)')
  })

  it('⭐⭐ 0.125 to 2 places is 0.13 — TradingView\'s captured answer', () => {
    // ⚰️ THE EXACT CASE `groupBVendorReadings` held at `pine:arity`, and the
    // number is the capture's, not a derivation: `math.round_half_rule`'s
    // evidence records `round(0.125, 2)` = 0.13.
    const out = run(`${head}plot(math.round(0.125, 2))${LF}`)
    for (let i = 0; i < N; i += 1) expect(out[i], `bar ${i}`).toBeCloseTo(0.13, 10)
  })

  it('⭐ and it rounds HALF AWAY FROM ZERO, both signs', () => {
    // ⛔ Bankers' rounding would give 2 and −2 here, which is the whole reason
    // the vendor question was asked.
    expect(run(`${head}plot(math.round(2.5))${LF}`)[0]).toBe(3)
    expect(run(`${head}plot(math.round(-2.5))${LF}`)[0]).toBe(-3)
  })

  it('⭐ a NON-LITERAL precision works — no compile-time constant needed', () => {
    // `pow` is a declared column, so the exponent may be any value. A folded
    // `10 ** n` would refuse an input-driven precision that Pine accepts.
    const f = formula(`${head}n = input.int(3)${LF}plot(math.round(close, n))${LF}`)
    expect(f.startsWith('REFUSED'), f).toBe(false)
    expect(f).toContain('pow(10, 3)')
  })
})

describe('⭐⭐ `math.max` / `math.min` are VARIADIC', () => {
  it('⛔ CONTROL — the two-argument form is unchanged', () => {
    expect(formula(`${head}plot(math.max(high, low))${LF}`)).toBe('max(high, low)')
    expect(formula(`${head}plot(math.min(high, low))${LF}`)).toBe('min(high, low)')
  })

  it('⭐⭐ five arguments answer 5 and 1 — the captured evidence', () => {
    // `math_max_min_variadic`: max(5 args) = 5, min(5 args) = 1.
    expect(run(`${head}plot(math.max(1, 2, 3, 4, 5))${LF}`)[0]).toBe(5)
    expect(run(`${head}plot(math.min(5, 4, 3, 2, 1))${LF}`)[0]).toBe(1)
    expect(run(`${head}plot(math.max(1, 2, 3))${LF}`)[0]).toBe(3)
  })

  it('⛔⛔ the fold is LEFT-associative, and the shape is asserted not assumed', () => {
    // ⚰️ A VALUE ASSERTION CANNOT SEE THIS. `max` and `min` are associative, so
    // `max(max(a,b),c)` and `max(a,max(b,c))` compute the same number on every
    // bar — a right fold would pass every other case in this file. What differs
    // is the TREE, and therefore `astHash`: a member who types the nested form
    // by hand must land on the tree the imported script produced, or the same
    // indicator arrives as two definitions nobody can reconcile from the
    // read-back.
    // ⚠️ SERIES ARGUMENTS, NOT LITERALS. A plot of pure constants yields no
    // selectable output row in the columnar lane, so `math.max(1, 2, 3)` here
    // reads back as "no formula" rather than as a shape — a helper artifact,
    // not a finding about the fold.
    expect(formula(`${head}plot(math.max(open, high, low))${LF}`))
      .toBe('max(max(open, high), low)')
    expect(formula(`${head}plot(math.min(open, high, low, close))${LF}`))
      .toBe('min(min(min(open, high), low), close)')
  })

  it('⛔ the fold is over SERIES too, not just literals', () => {
    // ⭐ A left fold of a two-argument `max` is the whole implementation, so it
    // must behave for columns exactly as it does for numbers.
    const out = run(`${head}plot(math.max(open, close, high))${LF}`)
    for (let i = 0; i < N; i += 1) {
      expect(out[i], `bar ${i}`).toBe(Math.max(BARS[i].o, BARS[i].c, BARS[i].h))
    }
  })

  it('⛔ ONE argument still refuses, and NOT with a message about pivots', () => {
    // ⚰️⚰️ THE TRAP THIS CLOSES. A falsy return from `PINE_NAMESPACED_TREE`
    // reached a refusal whose text is hard-coded for the PIVOT case — "returns
    // its value `rightbars` after the pivot … write it as a plain whole
    // number". Every entry added to that map inherited it, so a one-argument
    // `math.max` would have been told about pivot bars.
    const f = formula(`${head}plot(math.max(1))${LF}`)
    expect(f.startsWith('REFUSED'), f).toBe(true)
    expect(f, 'the pivot refusal is still being reused for other names')
      .not.toContain('rightbars')
    expect(f).toContain('math.max')
  })

  it('⛔ CONTROL — the pivot refusal itself is intact for the pivot', () => {
    // ⭐ NON-VACUITY for the case above: the pivot message must still exist and
    // still be used where it belongs, or "not about pivots" passes for a
    // message that was simply deleted.
    const f = formula(`${head}n = close > 0 ? 3 : 4${LF}plot(ta.pivothigh(high, 2, n))${LF}`)
    expect(f.startsWith('REFUSED'), f).toBe(true)
    expect(f).toContain('rightbars')
  })
})
