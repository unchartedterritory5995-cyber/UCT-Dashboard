// app/src/components/chart/engine/runtime/__tests__/requestHoist.test.js
//
// ─── ⭐⭐ A WINDOW INSIDE A REQUEST, AND PINE'S `na` ─────────────────────────
//
// `ta.sma(volume[1], N)` inside `request.security` refused, and the refusal was
// right about the rule: a window needs a COMMITTED SERIES, and only a variable
// has one. What it could not see is that inside a request THERE IS NOWHERE FOR
// A MEMBER TO PUT THAT VARIABLE — the value is a single expression evaluated
// against another symbol's bars, so there is no line on which to write
// `tmp = volume[1]` first.
//
// ⭐ A request's region IS a statement sequence (its own entry point, its own
// bar loop), so the binding the author cannot write is hoisted for them. It is
// exactly the rewrite the refusal describes, performed instead of demanded.
//
// ⛔ AND IT IS SCOPED TO A REQUEST. Everywhere else the refusal stands: the
// member CAN write that line, and inventing a hidden variable for them would
// hide a real authoring decision.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'

const head = '//@version=6\nindicator("t", overlay = true)\n'
const N = 4
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))

const build = (src) => buildRuntimeIr(head + src, {
  bars: BARS, inputs: {}, newestBarIsForming: false,
})
const why = (r) => (r.ok ? 'OK' : `[${r.refusal.guard}] ${r.refusal.message}`)

describe('⭐⭐ a window over an expression, inside a request', () => {
  it('`ta.sma(volume[1], 3)` compiles', () => {
    const r = build('plot(request.security("A", "D", ta.sma(volume[1], 3)))\n')
    expect(r.ok, why(r)).toBe(true)
    expect(r.ir.requests[0].statements.length, 'nothing was hoisted, so the '
      + 'window found a committed series some other way — check this is still '
      + 'testing what it says').toBeGreaterThan(0)
  })

  it('⭐ an arithmetic source too — `ta.sma(high - low, 3)`', () => {
    const r = build('plot(request.security("A", "D", ta.sma(high - low, 3)))\n')
    expect(r.ok, why(r)).toBe(true)
  })

  it('⭐ and the hoisted program LOWERS — the statements reach the region', () => {
    // A hoist that produced IR the back end drops would look identical here
    // until a bar ran, so the program is lowered rather than merely built.
    const r = build('plot(request.security("A", "D", ta.sma(volume[1], 3)))\n')
    expect(() => lowerIrProgram(r.ir)).not.toThrow()
  })

  it('⛔ OUTSIDE a request the refusal STANDS — the member can write the line', () => {
    // ⛔ THE SOURCE MUST BE MUTABLE FOR THIS CASE TO MEAN ANYTHING. `ta.sma(high
    // - low, 3)` at top level is a PURE subtree, which the COLUMNAR lane answers
    // without ever reaching the runtime window path — so it compiles, and a
    // fixture using it would assert the opposite of what it claims. Reading a
    // `var` forces the runtime path, where the refusal lives.
    const r = build('var float s = 0.0\ns := close\nplot(ta.sma(s + 1, 3))\n')
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:history-expression')
  })

  it('⭐⭐ the corpus shape: a helper whose window length is its PARAMETER', () => {
    // `calcDaily(simple int N) => ta.sma(volume[1], N)` — the acceptance
    // dashboard's own helper, and the one the recorded diagnosis blamed on
    // `simple int`. Measured: a plain `int` fails identically; the blocker is a
    // PARAMETER used as a length, which substitution at the call site resolves.
    const r = build('f(simple int N) =>\n    ta.sma(volume[1], N)\n'
      + 'plot(request.security("A", "D", f(3)))\n')
    expect(r.ok, why(r)).toBe(true)
  })
})

describe("⭐⭐ Pine's `na` is a literal, not an unbound name", () => {
  it('a bare `na` in a ternary arm, inside a request', () => {
    // ⚰️ `x > 0 ? y : na` is how a member leaves a plot blank, and it reached
    // `runtime:unbound` — "a name nothing in this script binds" — about Pine's
    // own absent value. It only ever surfaced INSIDE a request, because
    // everywhere else the surrounding expression is pure and the columnar lane
    // answers it; a request bars that lane, which is what exposed the gap.
    const r = build('f(simple int N) =>\n    float a = ta.sma(volume[1], N)\n'
      + '    a > 0 ? volume / a : na\n'
      + 'plot(request.security("A", "D", f(3)))\n')
    expect(r.ok, why(r)).toBe(true)
  })

  it('⛔ and it is the ONLY non-finite const the IR accepts', () => {
    // The validator refuses a non-finite `num` on purpose — that is how a
    // coordinate silently becomes nothing. `na` carries a marker so the
    // author's ABSENT is distinguishable from a number that lost itself.
    const r = build('plot(request.security("A", "D", close > 0 ? close : na))\n')
    expect(r.ok, why(r)).toBe(true)
    expect(() => lowerIrProgram(r.ir)).not.toThrow()
  })

  it('⛔ a name that really is unbound still refuses by name', () => {
    const r = build('plot(request.security("A", "D", close > 0 ? close : nope))\n')
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:unbound')
  })
})
