// app/src/components/chart/engine/runtime/__tests__/floorAndCeil.test.js
//
// ─── ⭐⭐ THE ONLY TWO NAMES MISSING FROM THE WHOLE MATH FAMILY ─────────────
//
// Probed across both lanes on 2026-09-22, every `math.*` name the corpus uses:
//
//   abs · max · min · round · sqrt · pow · sign · avg · log · exp · sum   ok
//   floor · ceil                                                          REFUSED
//
// Thirteen names, eleven served. `math.floor` is 43 sites across 22 scripts
// and `math.ceil` is 10 across 7 — and they are the LAST two, which is what
// makes them worth doing together rather than waiting for a "math wave".
//
// ⭐ IT IS THE SELECTION RULE, NOT THE BIGGEST COUNT. `market-structure-by-
// leviathan` sits 2 walls from building on ONE guard family, and this is it:
//
//     runtime:call-undeclared-builtin-state — a builtin fed by a mutable value
//     that the CLOSED TABLE does not declare at all … `math.floor`
//
//     label.new(math.floor(bar_index - (bar_index - prevHighIndex) / 2), …)
//
// ⛔ AND THERE IS NO VENDOR QUESTION HERE, WHICH IS RARE AND WORTH SAYING.
// `floor` is the largest integer not greater than x and `ceil` the smallest
// not less than x — the same on every platform, for every input, with no
// half-rule to settle and no convention to witness. That is exactly why
// `math.round` needed a capture (Pine rounds a half AWAY FROM ZERO, which
// neither `Math.round` nor Python's `round` does) and these two do not.
//
// ⛔⛔ THE NaN RULE IS THE ONE THING THAT COULD GO WRONG. `Math.floor(NaN)` is
// NaN already, so the naive spelling happens to be right — but every other
// entry in `POINTWISE` writes the guard explicitly, because "it happens to
// work" is not the same claim as "it is specified to", and the next person
// editing the line cannot see which one they are relying on.
import { describe, it, expect } from 'vitest'

import { translatePine } from '../../ast/pine.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 24
// ⭐ VALUES CHOSEN TO SEPARATE THE TWO FUNCTIONS AND TO CROSS ZERO. A fixture
// of positive non-integers would let `ceil` pass as `round` and `floor` pass as
// truncation — the two cases where they genuinely differ are a NEGATIVE
// non-integer and an exact integer.
const VALS = [2.5, -2.5, 2.4, -2.4, 3.0, -3.0, 0.0, 0.5, -0.5, 7.9, -7.9, 1.1]
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100, h: 110, l: 90, c: VALS[i % VALS.length], v: 10 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t")\n'

/** Run through the RUNTIME lane and hand back the output series. */
function run(body) {
  const built = buildRuntimeIr(head + body, { bars: BARS, inputs: {} })
  expect(built.ok, built.ok ? '' : `refused ${built.refusal.guard} — ${built.refusal.message}`)
    .toBe(true)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return Array.from(res.outputs[0])
}

/** The HOST/columnar lane's answer for the same source. */
function hostOk(body) {
  const t = translatePine(head + body, { strict: true })
  return !(t && t.ok === false)
}

describe('⭐⭐ `math.floor` and `math.ceil` — the last two of the math family', () => {
  it('⭐ both resolve, in BOTH lanes', () => {
    // ⛔ ONE LANE IS NOT A CAPABILITY. A name served by the runtime and refused
    // by the host is a script that draws and cannot be screened, which is the
    // asymmetry `ta.cross`'s exclusion nearly shipped.
    expect(hostOk('plot(math.floor(close))'), 'host refused math.floor').toBe(true)
    expect(hostOk('plot(math.ceil(close))'), 'host refused math.ceil').toBe(true)
    expect(run('plot(math.floor(close))').length).toBe(N)
    expect(run('plot(math.ceil(close))').length).toBe(N)
  })

  it('⭐⭐ the VALUES are right, including the cases that separate them', () => {
    const f = run('plot(math.floor(close))')
    const c = run('plot(math.ceil(close))')
    for (let i = 0; i < N; i += 1) {
      const x = VALS[i % VALS.length]
      expect(f[i], `floor(${x})`).toBe(Math.floor(x))
      expect(c[i], `ceil(${x})`).toBe(Math.ceil(x))
    }
  })

  it('⛔⛔ a NEGATIVE non-integer is where truncation and rounding both break', () => {
    // ⭐ THE LOAD-BEARING CASE. floor(-2.4) is -3, not -2: truncation answers
    // -2 and `round` answers -2 as well, so a fixture of positives only cannot
    // tell any of the three apart.
    const f = run('plot(math.floor(close))')
    const c = run('plot(math.ceil(close))')
    const at = (v) => VALS.indexOf(v)
    expect(f[at(-2.4)]).toBe(-3)
    expect(c[at(-2.4)]).toBe(-2)
    expect(f[at(2.4)]).toBe(2)
    expect(c[at(2.4)]).toBe(3)
    // ...and an exact integer moves under neither
    expect(f[at(3.0)]).toBe(3)
    expect(c[at(3.0)]).toBe(3)
    expect(f[at(-3.0)]).toBe(-3)
    expect(c[at(-3.0)]).toBe(-3)
  })

  it('⛔ they are NOT each other, and not `round`', () => {
    // ⭐ NON-VACUITY: two functions wired to one implementation would satisfy
    // every "is it a number" assertion above.
    const f = run('plot(math.floor(close))')
    const c = run('plot(math.ceil(close))')
    const r = run('plot(math.round(close))')
    expect(f).not.toEqual(c)
    expect(f).not.toEqual(r)
    expect(c).not.toEqual(r)
  })

  it('⛔ `na` propagates — not computable stays not computable', () => {
    // ⛔ THE RULE THE WHOLE TABLE IS BUILT ON. `na` in, `na` out; a floor that
    // answered 0 for an unknown value would read as a real reading of zero.
    const v = run('plot(math.floor(ta.sma(close, 5)))')
    expect(Number.isNaN(v[0]), 'bar 0 answered a number').toBe(true)
    expect(v.slice(6).every((x) => Number.isFinite(x)), 'never became computable').toBe(true)
  })

  it('⭐ they compose with a MUTABLE value — the shape that refused', () => {
    // ⚰️ THE ORIGINAL WALL, reduced. `market-structure-by-leviathan` feeds
    // `math.floor` an expression over a `var` it reassigns, and the refusal was
    // `runtime:call-undeclared-builtin-state` — "blocked on the builtin
    // existing, not on the runtime". Serving the name is the whole fix.
    const v = run('var float m = na\nm := ta.sma(close, 3)\nplot(math.floor(m))\n')
    expect(v.length).toBe(N)
    expect(v.slice(4).every((x) => Number.isFinite(x) && x === Math.floor(x))).toBe(true)
  })
})
