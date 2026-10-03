// app/src/components/chart/engine/runtime/__tests__/naCondition.test.js
//
// ─── ⭐⭐ RT3 — AN `na` CONDITION READS AS FALSE, IN THE RUNTIME LANE ─────────
//
// RT1 found the runtime `?:` answering `na` on an `na` test where TradingView
// takes the else branch (`qqe-signals` RDDT 1D bar 73), and declined every such
// script at the member door (`runtime:na-test`). The host lane had already learned
// the rule (`interpret.js::pineBoolAt`, H1). RT3 gives both lanes ONE authority
// (`interpret.js::pineBool`, `naConditionIsFalse`) and has the runtime lowering
// read a condition through it (`lowerIr.js::asCondition`).
//
// What each assertion pins, and on what evidence:
//   - v4 `?:`: MEASURED (the two v4 captures; the vendor rail is
//     `vendorHarness.rt1RuntimeFallback.test.js`).
//   - v5/v6 `?:`, v6 `not`: argued from Pine (`pineBool`'s comment).
//   - v4/v5 `and` / `or` / `not` over a value that can be `na`: MEASURED by
//     F2 (Q-NL captures `rt3-na-logic` / `-v4`) — the `na` operand is false,
//     the answer never `na`; no longer counted.
//   - below v4: nothing claimed — `TERNARY`'s `na`, counted.
//
// Every assertion runs the RUNTIME lane end to end from Pine source, and each
// carries its control (a bar where the test is NOT `na` answers as before).

import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { BINARY, pineBool, naConditionIsFalse, NA_CONDITION_FALSE_FROM_VERSION } from '../../ast/interpret.js'
import { lowerIrProgram, naTestsOf } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 6
const NL = String.fromCharCode(10)
// open alternates 100/101 and close climbs from 100, so `close > open` is
// false on bars 0-1 and true from bar 2.
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + (i % 2), h: 102 + i, l: 98 + i, c: 100 + i, v: 1000 + i,
}))
// ⛔ THE TEST MUST READ A SLOT. A pure subtree (`plot(close[1] ? 1 : 2)`) is
// handed whole to the columnar lane (`EXPR.COLUMN`, the seam) and answered by
// the host translator's own rules, never by this lowering; `x := close[1]`
// makes `x` a variable the runtime lane reads per bar.
const NA_FIRST = ['float x = na', 'x := close[1]', ''].join('\n')
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

// `listing` defaults ON: the rule is claimed only for a run from the symbol's
// first bar, where a `NaN` IS Pine's `na` (the member door's fallback runs so).
function runPine(version, body, listing = true) {
  const src = `//@version=${version}\n${version >= 5 ? 'indicator' : 'study'}("t")\n${body}`
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir, { historyFromListing: listing })
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return { out: Array.from(r.outputs[0]), naTests: naTestsOf(program) }
}

describe('⭐ ONE AUTHORITY: the lowering\'s `x != 0` IS `pineBool`', () => {
  it('the two agree on na, zero, signs, fractions and infinities', () => {
    const samples = [NaN, 0, -0, 1, -1, 0.5, -1e-12, 42, Infinity, -Infinity]
    for (const v of samples) expect(BINARY['!='](v, 0), String(v)).toBe(pineBool(v))
    // non-vacuity: both answers occur
    expect(new Set(samples.map(pineBool))).toEqual(new Set([0, 1]))
    expect(pineBool(NaN)).toBe(0)
  })

  it('the version gate reads the lexed pragma, and claims nothing below v4 or without one', () => {
    expect(NA_CONDITION_FALSE_FROM_VERSION).toBe(4)
    expect([null, undefined, 1, 2, 3, NaN].map(naConditionIsFalse)).toEqual([false, false, false, false, false, false])
    expect([4, 5, 6, '5'].map(naConditionIsFalse)).toEqual([true, true, true, true])
  })
})

describe('⭐⭐ a `?:` whose test is `na` takes the ELSE arm from v4', () => {
  it.each([4, 5, 6])('v%i: bar 0 (`x` holds `close[1]`, na) is the else arm; every later bar the then arm', (v) => {
    const { out, naTests } = runPine(v, `${NA_FIRST}plot(x ? 1 : 2)\n`)
    expect(out[0]).toBe(2)
    expect(out.slice(1)).toEqual(Array(N - 1).fill(1)) // control: a real test is unchanged
    expect(naTests).toBe(0)
  })

  it('v3: nothing is claimed — `na` as before, and counted for the member door', () => {
    const { out, naTests } = runPine(3, 'x = 0.0\nx := close[1]\nplot(x ? 1 : 2)\n')
    expect(Number.isNaN(out[0])).toBe(true)
    expect(out.slice(1)).toEqual(Array(N - 1).fill(1))
    expect(naTests).toBe(1)
  })

  it('a test this lane can prove is 0/1 is never counted, in any version (control)', () => {
    for (const v of [3, 4, 5]) expect(runPine(v, `${v >= 4 ? NA_FIRST : 'x = 0.0\nx := close[1]\n'}plot(x > open ? 1 : 2)\n`).naTests).toBe(0)
  })
})

describe('⭐ `and` stays eager and is settled wherever it is tested — never counted', () => {
  it.each([4, 5])('v%i: `na and true` read as a test is false; a real operand answers as before', (v) => {
    const { out, naTests } = runPine(v, `${NA_FIRST}plot((x and true) ? 1 : 2)\n`)
    expect(out[0]).toBe(2)
    expect(out.slice(1)).toEqual(Array(N - 1).fill(1))
    expect(naTests).toBe(0)
  })
})

describe('⭐⭐ F2 — v4/v5 `and` / `or` / `not` over a value that can be `na`: SETTLED (Q-NL), the `na` operand reads as false', () => {
  // MEASURED (CAP2 `rt3-na-logic` v5 / `-v4`, RDDT 1D from the listing): an `na`
  // operand of `and` / `or` / `not` is FALSE and the answer is never `na`.
  // `x` is `na` on bar 0 and 99..104 after (truthy), so bar 0 answers by the rule
  // and bars 1..5 are the control.
  it.each([4, 5])('v%i `or`: `(x or false)` on an `na` x is false — 2 on bar 0, uncounted', (v) => {
    const { out, naTests } = runPine(v, `${NA_FIRST}plot((x or false) ? 1 : 2)
`)
    expect(out[0]).toBe(2)
    expect(out.slice(1)).toEqual(Array(N - 1).fill(1))
    expect(naTests).toBe(0)
  })
  it.each([4, 5])('v%i `not`: `(not x)` on an `na` x is true — 1 on bar 0, uncounted', (v) => {
    const { out, naTests } = runPine(v, `${NA_FIRST}plot((not x) ? 1 : 2)
`)
    expect(out[0]).toBe(1)
    expect(out.slice(1)).toEqual(Array(N - 1).fill(2))
    expect(naTests).toBe(0)
  })
  it.each([4, 5])('v%i: `na(x or false)` and `na(not x)` are never `na`', (v) => {
    expect(runPine(v, `${NA_FIRST}plot(na(x or false) ? 1 : 2)
`).out).toEqual(Array(N).fill(2))
    expect(runPine(v, `${NA_FIRST}plot(na(not x) ? 1 : 2)
`).out).toEqual(Array(N).fill(2))
  })
  it('control: an `or` / `not` over comparisons is 0/1 and not counted', () => {
    expect(runPine(5, `${NA_FIRST}plot((x > open or not (x < open)) ? 1 : 2)
`).naTests).toBe(0)
  })
  it('v6: a `bool` cannot be `na` — `b[1]` on bar 0 is false — so `not b[1]` there is true, uncounted', () => {
    // b = [F, F, T, T, T, T]; b[1] = [false (held as NaN), F, F, T, T, T]
    const { out, naTests } = runPine(6, 'bool b = false' + NL + 'b := close > open' + NL + 'c = b[1]' + NL + 'plot(not c ? 1 : 2)' + NL)
    expect(out).toEqual([1, 1, 1, 2, 2, 2]) // bars 1-5 are the control: a real `b[1]`
    expect(naTests).toBe(0)
  })
  it('⛔ off the listing the shared `logical` / `!` stand: `not x` on bar 0 is `na`', () => {
    expect(Number.isNaN(runPine(5, `${NA_FIRST}plot((not x) ? 1 : 2)
`, false).out[0])).toBe(true)
  })
})

describe('⛔ OFF THE LISTING the shared `{0,1,NaN}` rules stand — a `NaN` may be "not computable from this window"', () => {
  it.each([4, 5, 6])('v%i: the same `?:` answers `na` on bar 0 and is counted, as before RT3', (v) => {
    const src = `${NA_FIRST}plot(x ? 1 : 2)\n`
    const listed = runPine(v, src, true)
    const off = runPine(v, src, false)
    expect(listed.out[0]).toBe(2) // non-vacuity: the same script does change under the rule
    expect(Number.isNaN(off.out[0])).toBe(true)
    expect(off.naTests).toBe(1)
    expect(off.out.slice(1)).toEqual(listed.out.slice(1))
  })
})

describe('the `if` statement already read `na` as false (`JUMP_IF_FALSE`) — pinned, unchanged', () => {
  it.each([3, 4, 5])('v%i: `if y` with `y` na skips bar 0', (v) => {
    const { out } = runPine(v, 'y = 0.0\ny := close[1]\nx = 2\nif y\n    x := 1\nplot(x)\n')
    expect(out[0]).toBe(2)
    expect(out.slice(1)).toEqual(Array(N - 1).fill(1))
  })
})
