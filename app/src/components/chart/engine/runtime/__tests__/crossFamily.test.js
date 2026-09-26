// app/src/components/chart/engine/runtime/__tests__/crossFamily.test.js
//
// ─── ⭐⭐ `ta.crossover` / `ta.crossunder` OVER RUNTIME STATE ────────────────
//
// Both already work over PURE arguments: the router hands the subtree to the
// columnar lane and `interpret.js::crossOver` answers it. What was refused is
// the same call with an argument this lane computes per bar —
// `runtime:call-windowed-state`, *"a WINDOWED builtin fed by a mutable
// variable — this one needs the series bridge"*.
//
// ⛔⛔ AND THE OBVIOUS SHORTCUT IS WRONG, WHICH THE FRONT END ALREADY SAID IN
// AS MANY WORDS BEFORE THIS WAS BUILT. `ta.change(x)` is lowered into `x - x[1]`
// — semantics this runtime already has — and lowering the cross family into
// `a > b and a[1] <= b[1]` looks like the same move. It is not:
//
//     `interpret.js::crossing` answers NaN when ANY of the four values it reads
//     is NaN. This grammar's `>` answers 0 on a NaN (measured:
//     `BINARY['>'](NaN, 5) === 0`).
//
// So the operator lowering would answer **0 where the table says NOT
// COMPUTABLE** — a silent approximation on every warm-up bar of every script
// that uses it, which is the one thing this engine may not ship. The front end
// left them refused *"until the family gets its own authoritative step"*. This
// is that step.
//
// ⭐⭐ THE PREDICATES ARE THE COLUMNAR LANE'S OWN, LIFTED OUT AND SHARED —
// `CROSS_OVER_FIRED` / `CROSS_UNDER_FIRED` in `interpret.js`, reached by both
// `TABLE.crossOver` and the carried step. A second copy of `an > bn && ap <= bp`
// is exactly `lesson_a_second_authority_over_one_value`, and the two would
// disagree the first time either was touched.
//
// ⭐ IT RIDES `CARRIED2`, the two-input carried state built for `ta.valuewhen`.
// The fit is exact: two series in, two cells of state (the previous pair), one
// value out — so this needed no new opcode.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

// ⭐ close and open CROSS repeatedly, so a cross series is not all zeros.
const N = 24
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + ((i % 4) < 2 ? 3 : -3),
  h: 106, l: 94,
  c: 100 + ((i % 4) < 2 ? -3 : 3),
  v: 10 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t")\n'

function run(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return res.outputs.map((o) => Array.from(o))
}

/** ⭐ THE SAME VALUE, FORCED DOWN THE RUNTIME PATH. Binding an otherwise pure
 *  expression into a `var` slot makes the call read a MUTABLE variable, which
 *  is precisely the shape that was refused — and it leaves the NUMBERS
 *  identical to the pure spelling, which is what makes the parity rail below
 *  an equality rather than an approximation. */
const VIA_SLOT = 'var float m = na\nm := ta.sma(close, 3)\n'
const PURE = 'ta.sma(close, 3)'

describe('⭐⭐ the cross family over runtime state', () => {
  it('⛔⛔ PARITY — the runtime path equals the COLUMNAR path, bar for bar', () => {
    // ⭐⭐ THE LOAD-BEARING TEST IN THIS FILE. The columnar lane has answered
    // this call correctly for as long as it has existed; the only honest
    // acceptance for a second path is that it agrees with the first one
    // everywhere, INCLUDING the warm-up bars where `ta.sma` is still `na`.
    const [viaSlot] = run(`${VIA_SLOT}plot(ta.crossover(close, m) ? 1 : 0)\n`)
    const [pure] = run(`plot(ta.crossover(close, ${PURE}) ? 1 : 0)\n`)
    expect(viaSlot).toEqual(pure)
  })

  it('⛔⛔ PARITY — `ta.crossunder` likewise', () => {
    const [viaSlot] = run(`${VIA_SLOT}plot(ta.crossunder(close, m) ? 1 : 0)\n`)
    const [pure] = run(`plot(ta.crossunder(close, ${PURE}) ? 1 : 0)\n`)
    expect(viaSlot).toEqual(pure)
  })

  it('⛔ CONTROL — the fixture actually CROSSES, so parity is not two zero series', () => {
    // ⭐ Two identical all-zero series compare equal and prove nothing. This is
    // the non-vacuity half of the two rails above.
    const [pure] = run(`plot(ta.crossover(close, ${PURE}) ? 1 : 0)\n`)
    expect(pure.some((v) => v === 1), 'the fixture never crosses over').toBe(true)
    const [under] = run(`plot(ta.crossunder(close, ${PURE}) ? 1 : 0)\n`)
    expect(under.some((v) => v === 1), 'the fixture never crosses under').toBe(true)
  })

  it('⛔⛔ THE NaN RULE — not computable is `na`, never 0', () => {
    // ⚰️ THE ENTIRE REASON THIS FAMILY WAS REFUSED RATHER THAN LOWERED INTO
    // OPERATORS. `ta.sma(close, 3)` is `na` on bars 0 and 1, so the cross is not
    // computable on bars 0, 1 and 2 — bar 2 because the PREVIOUS bar's value is
    // still `na`. An operator lowering answers 0 on all three, which reads as
    // "it did not cross" and is a different claim entirely.
    const [v] = run(`${VIA_SLOT}plot(ta.crossover(close, m) ? 1 : 0)\n`)
    expect(Number.isNaN(v[0]), 'bar 0 answered a number').toBe(true)
    expect(Number.isNaN(v[1]), 'bar 1 answered a number').toBe(true)
    expect(Number.isNaN(v[2]), 'bar 2 answered a number — the PREVIOUS bar was na').toBe(true)
    // ...and once both bars are finite it is a real 0/1 answer, not more na.
    expect(v.slice(3).every((x) => x === 0 || x === 1), 'never became computable').toBe(true)
  })

  it('⛔ bar 0 is `na` even when both inputs are finite there', () => {
    // `crossing` starts its loop at i = 1: with no previous bar there is no
    // crossing to report, and that is `na` rather than 0.
    const [v] = run('var float m = na\nm := close\nplot(ta.crossover(high, m) ? 1 : 0)\n')
    expect(Number.isNaN(v[0])).toBe(true)
    expect(v.slice(1).every((x) => x === 0 || x === 1)).toBe(true)
  })

  it('⭐ the bare v1-v3 spellings are the same functions', () => {
    const [a] = run(`${VIA_SLOT}plot(crossover(close, m) ? 1 : 0)\n`)
    const [b] = run(`${VIA_SLOT}plot(ta.crossover(close, m) ? 1 : 0)\n`)
    expect(a).toEqual(b)
    const [c] = run(`${VIA_SLOT}plot(crossunder(close, m) ? 1 : 0)\n`)
    const [d] = run(`${VIA_SLOT}plot(ta.crossunder(close, m) ? 1 : 0)\n`)
    expect(c).toEqual(d)
  })

  it('⭐ the ORDER of the two arguments means something', () => {
    // `ta.crossover(a, b)` is "a crossed ABOVE b" and is NOT `crossover(b, a)`.
    // A step that stored its pair in the wrong order would still produce a
    // plausible 0/1 series, and only a comparison like this can see it.
    const [ab] = run(`${VIA_SLOT}plot(ta.crossover(close, m) ? 1 : 0)\n`)
    const [ba] = run(`${VIA_SLOT}plot(ta.crossover(m, close) ? 1 : 0)\n`)
    expect(ab).not.toEqual(ba)
    // and crossing one way IS crossing the other way with the arguments swapped
    const [under] = run(`${VIA_SLOT}plot(ta.crossunder(m, close) ? 1 : 0)\n`)
    expect(ab).toEqual(under)
  })

  it('⛔⛔ PARITY — `ta.cross` too, and its exclusion was a WRONG ASSUMPTION', () => {
    // ⚰️ THIS TEST ASSERTED THE OPPOSITE FIRST. `closedTable.json` declares
    // `crossOver` and `crossUnder` and no `cross`, so serving `ta.cross` here
    // read like inventing a ruling, and the control asserted it stayed refused
    // in BOTH paths. It failed — because `ta.cross` over PURE arguments has
    // compiled all along: `pine.js` rewrites it to `crossOver || crossUnder`.
    // The exclusion would have created exactly the asymmetry it was meant to
    // avoid, in 28 sites across 8 scripts.
    const [viaSlot] = run(`${VIA_SLOT}plot(ta.cross(close, m) ? 1 : 0)
`)
    const [pure] = run(`plot(ta.cross(close, ${PURE}) ? 1 : 0)
`)
    expect(viaSlot).toEqual(pure)
    // ⛔ NON-VACUITY: `cross` must be the OR, so it fires where neither of the
    // one-way tests does alone — two all-zero series would compare equal.
    const [over] = run(`plot(ta.crossover(close, ${PURE}) ? 1 : 0)
`)
    const [under] = run(`plot(ta.crossunder(close, ${PURE}) ? 1 : 0)
`)
    for (let i = 0; i < pure.length; i += 1) {
      if (Number.isNaN(pure[i])) { expect(Number.isNaN(over[i])).toBe(true); continue }
      expect(pure[i]).toBe((over[i] === 1 || under[i] === 1) ? 1 : 0)
    }
    expect(pure.some((v) => v === 1)).toBe(true)
  })
})
