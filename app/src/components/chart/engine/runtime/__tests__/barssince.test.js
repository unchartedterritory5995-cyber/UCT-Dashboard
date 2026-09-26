// app/src/components/chart/engine/runtime/__tests__/barssince.test.js
//
// ─── ⭐⭐ `ta.barssince` — UNBOUNDED, AND A TWIN OF THE HOUSE COUNTER ───────
//
// ⛔⛔ THIS ENGINE ALREADY HAS A FUNCTION CALLED `barssince`, AND IT IS A
// DIFFERENT FUNCTION. `interpret.js::barsSince(cond, n)` SATURATES: `n` is a
// sentinel meaning *"not true within the last n bars"*, and it may only be said
// once `n` readable condition bars have been seen. Pine's `ta.barssince(cond)`
// counts back as far as the condition requires and never caps. They line up
// positionally and answer different numbers, which is why `pine.js` refuses the
// Pine spelling with a long, correct sentence rather than translating onto the
// house one — a cap would be *a different number wearing the same name*.
//
// ⭐⭐ SO THIS IS A TWIN, NOT A REPLACEMENT, AND THE ARITY IS WHAT SEPARATES
// THEM. Measured on this build before a line was written:
//
//     `barssince(cond, 5)`      BUILDS  -> [0,1,2,3,4,5,5,5,…]   (house, saturating)
//     `ta.barssince(cond, 5)`   REFUSED pine:function
//     `ta.barssince(cond)`      REFUSED pine:function
//     `barssince(cond)`         REFUSED
//
// ⛔⛔ THEREFORE SERVING **ARITY 1 ONLY** CANNOT CHANGE ANY CALL THAT WORKS
// TODAY. The one spelling that builds is the bare 2-argument form, and this wave
// does not touch it — `test_the_house_TWO_argument_counter_is_UNCHANGED` pins its
// exact series. That matters beyond tidiness: the vendor capture's own
// `_notPinned` marker records that CORRECTING the table to Pine's one-argument
// signature "is a member-visible CHANGE, not an addition — a 2-arg call that
// translates today would stop", and routes it to an owner ruling. This wave
// deliberately takes only the half that removes nothing.
//
// ⭐⭐⭐ EVERY RULE BELOW IS MEASURED OFF TRADINGVIEW, NOT REASONED ABOUT.
// `tests/fixtures/vendor/r11-barssince-spy-1d-2026-09-11.json`, AMEX:SPY 1D,
// 405 bars, probes `tools/visual_conformance/probes/groupb-barssince-{1,2}arg.pine`:
//
//   theArity        ONE argument. The 2-arg form does not compile on TradingView
//                   at all (`compiles: false`, the one-plot failed stub).
//   theNeverTrue    a condition never true is `na` on all 405 bars — not 0.
//                   0 is the dangerous answer: `barssince(cond) < 5` would fire
//                   on every bar for something that never happened.
//   theOrdinary     0 ON THE BAR THE CONDITION IS TRUE, counting up from there,
//                   and NO `na` anywhere once it has fired at least once.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { CARRIED } from '../../ast/interpret.js'

const N = 40
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 100 + (i % 3), h: 105, l: 95, c: 100 + (i % 7), v: 10 + i }))
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

const refusalOf = (src) => {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  expect(built.ok, 'expected a refusal, got a program').toBe(false)
  return built.refusal
}

const REPO = path.resolve(process.cwd(), '..')
const FIXTURE = path.join(REPO, 'tests/fixtures/vendor/r11-barssince-spy-1d-2026-09-11.json')

describe('⭐⭐ `ta.barssince` is UNBOUNDED — measured on the vendor', () => {
  it('⛔⛔ CONTROL — the vendor capture still says what this file implements', () => {
    // ⭐ THE RULES ARE READ FROM THE CAPTURE, NOT RETYPED. A test that restates
    // a vendor verdict in its own words is a second authority over it, and it
    // stays green when the capture is replaced by one that says otherwise.
    const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    expect(fx.theArity.verdict).toMatch(/ONE argument/)
    expect(fx.theArity.oneArg.compiles).toBe(true)
    expect(fx.theArity.twoArg.compiles).toBe(false)
    expect(fx.theNeverTrueCase.verdict).toBe('na')
    expect(fx.theNeverTrueCase.naBars).toBe(fx.theNeverTrueCase.totalBars)
    // ⛔ 0 ON THE FIRING BAR, AND NO `na` ONCE IT HAS FIRED — both halves.
    expect(fx.theOrdinaryCase.min).toBe(0)
    expect(fx.theOrdinaryCase.naCount).toBe(0)
    expect(fx.theOrdinaryCase.distinctValues).toContain(0)
  })

  it('⭐⭐ 0 on the firing bar, then one per bar — against a SERIES oracle', () => {
    // ⭐ THE ORACLE IS COMPUTABLE FROM `bar_index` ALONE, so nothing here folds
    // to a constant and the comparison is exact rather than approximate. With
    // the condition firing every 5th bar, "bars since" IS `bar_index % 5`.
    const [got, want] = run(
      'cond = bar_index % 5 == 0\n'
      + 'plot(ta.barssince(cond))\n'
      + 'plot(bar_index % 5)\n')
    expect(got).toEqual(want)
    // ⛔ NON-VACUITY: an all-zero pair would compare equal and prove nothing.
    expect(new Set(want).size, 'the oracle never varies').toBeGreaterThan(3)
  })

  it('⭐⭐ THE WHOLE POINT — it does NOT saturate, however far back the firing is', () => {
    // ⭐⭐ THE ONE TEST THAT WOULD CATCH WIRING THIS TO `interpret.js::barsSince`.
    // The condition fires on bar 0 and never again. Pine counts 39 at bar 39;
    // the house counter with any window `n` answers `n` from bar `n` onward.
    const [v] = run('plot(ta.barssince(bar_index == 0))\n')
    expect(v[0]).toBe(0)
    expect(v[10]).toBe(10)
    expect(v[39], 'the count saturated — this is the HOUSE bar-window function').toBe(39)
  })

  it('⭐⭐ a condition that never fires is `na`, never 0', () => {
    // ⛔ `bar_index < 0` is ARITHMETIC, not the literal `false`, so it cannot be
    // folded away before it is ever evaluated — the vendor probe's own trick
    // (`never = close > 0 and close < 0`).
    const [never] = run('plot(ta.barssince(bar_index < 0))\nplot(close)')
    expect(never.every((x) => Number.isNaN(x)), 'a never-fired barssince was not na').toBe(true)
  })

  it('⭐ `na` before the first firing, then real for ever after', () => {
    const [v] = run('plot(ta.barssince(bar_index == 7))\n')
    expect(Number.isNaN(v[6]), 'answered before the condition had ever fired').toBe(true)
    expect(v[7]).toBe(0)
    expect(v[8]).toBe(1)
    expect(v.slice(7).every((x) => !Number.isNaN(x)), 'went na again after firing').toBe(true)
  })

  it('⭐ the bare v1-v3 one-argument spelling is the same function', () => {
    const [a] = run('cond = bar_index % 5 == 0\nplot(barssince(cond))\n')
    const [b] = run('cond = bar_index % 5 == 0\nplot(ta.barssince(cond))\n')
    expect(a).toEqual(b)
  })

  it('⭐⭐ over RUNTIME state — the shape that refused `call-windowed-state`', () => {
    // A condition fed by a mutable slot never reaches the columnar lane, and it
    // is the half of the demand a pure-only fix would leave refused.
    const [viaSlot] = run(
      'var float m = na\nm := ta.sma(close, 3)\n'
      + 'plot(ta.barssince(close > m))\n')
    const [pure] = run('plot(ta.barssince(close > ta.sma(close, 3)))\n')
    expect(viaSlot).toEqual(pure)
    expect(pure.some((x) => x > 0), 'the fixture never counts past zero').toBe(true)
  })

  it('⛔⛔ CONTROL — the house TWO-argument counter is UNCHANGED, and it SATURATES', () => {
    // ⭐⭐ THE NON-REGRESSION RAIL, AND THE REASON THIS WAVE IS SAFE TO SHIP.
    // This exact series was measured on the build BEFORE any of this existed.
    // It is the one `barssince` spelling that works today, members' saved
    // screener formulas depend on it, and correcting it to Pine's signature is
    // an owner ruling this wave deliberately does not take.
    const [v] = run('cond = bar_index == 0\nplot(barssince(cond, 5))\n')
    expect(v.slice(0, 8)).toEqual([0, 1, 2, 3, 4, 5, 5, 5])
    expect(v[39], 'the house counter stopped saturating').toBe(5)
  })

  it('⛔ CONTROL — the two arities really are two different functions here', () => {
    // ⭐ If this ever compares equal the twin has been wired onto the house
    // function (or vice versa) and every test above would still pass.
    const [pine] = run('plot(ta.barssince(bar_index == 0))\n')
    const [house] = run('plot(barssince(bar_index == 0, 5))\n')
    expect(pine).not.toEqual(house)
    expect(pine[39]).toBe(39)
    expect(house[39]).toBe(5)
  })

  it('⛔ the namespaced TWO-argument form stays refused, as it was', () => {
    // It has never built, and this wave does not start serving it: Pine itself
    // rejects it (`twoArg.compiles: false`), so accepting it would be this
    // engine diverging from the vendor in the expensive direction.
    expect(refusalOf('plot(ta.barssince(close > open, 5))\n').guard).toBeTruthy()
  })

  it('⛔ a zero-argument call is refused by name', () => {
    expect(refusalOf('plot(ta.barssince())\n').message).toMatch(/condition/i)
  })

  it('⭐⭐ UNMEASURED, SO PINNED AT THE TABLE — an `na` condition does not fire, '
    + 'and the bar still counts', () => {
    // ⚠️ NO CAPTURE EXERCISES AN `na` CONDITION. The vendor probe fires
    // `close > open`, `close > ta.highest(close,50)[1]` and a never-true
    // arithmetic pair — all finite. So this rule is THIS ENGINE'S CHOICE and is
    // pinned here as such rather than presented as a vendor fact.
    //
    // ⭐ The choice: `na` is not a firing (same as the `ta.valuewhen` twin), but
    // a bar is still a bar, so an already-running counter advances across it.
    // Resetting to `na` instead would forget a firing the engine really saw.
    const spec = CARRIED.barssincePine
    expect(spec, '`CARRIED.barssincePine` is missing').toBeTruthy()
    const st = new Float64Array(spec.cells)
    spec.init(st, 0)
    expect(Number.isNaN(spec.step(st, 0, NaN, 1)), 'an na condition fired').toBe(true)
    expect(spec.step(st, 0, 1, 1), 'a true condition did not answer 0').toBe(0)
    expect(spec.step(st, 0, NaN, 1), 'the counter did not advance across an na bar').toBe(1)
    expect(spec.step(st, 0, 0, 1)).toBe(2)
    expect(spec.step(st, 0, 1, 1), 'a later firing did not reset to 0').toBe(0)
  })

  it('⭐ inside a user function each invocation keeps its OWN counter', () => {
    // ⛔ `ta.valuewhen` and the cross family REFUSE inside a user function
    // because `OP.CARRIED2` has no frame-relative base. `OP.CARRIED` HAS one
    // (`carriedBase`), so this twin needs no such refusal — and that is a claim
    // about the opcode which has to be demonstrated, not assumed.
    const [a, b] = run(
      'f(c) =>\n    ta.barssince(c)\n'
      + 'plot(f(bar_index % 5 == 0))\n'
      + 'plot(f(bar_index % 7 == 0))\n')
    const [want5, want7] = run('plot(bar_index % 5)\nplot(bar_index % 7)\n')
    expect(a).toEqual(want5)
    expect(b).toEqual(want7)
  })
})
