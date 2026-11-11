// W4-T14 — Pine 6 `bool` typing for valueless arms.
//
// In Pine 6 a `bool` is never `na`: an `if` with no `else` (or a `switch` with no
// default) whose arms yield a bool yields `false` when no arm matches. v5 yields `na`.
// The lane serves `false` only when EVERY arm value is provably a bool (a comparison,
// `and`/`or`/`not`, `true`/`false`, `input.bool`, a bool-typed name, a user function whose
// every result is one); a value that is neither provably bool nor provably non-bool keeps
// the named refusal. The object door keeps Q-A3 refused (p3WsaDarkGate.test.js).
// Q-A3 (the TradingView capture) is NOT yet taken, so the typing machinery is BUILT but the
// served `false` is GATED (V6_BOOL_UNMATCHED_CAPTURED = false): the unmatched case stays the
// named refusal. The served-value rails run through the test-only `w4t14ServeUnmatchedFalse`
// opt; flipping the constant (one line) is the whole change once the capture MATCHes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 8
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100, h: 102 + i, l: 98, c: 100 + i, v: 1000,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const v5 = '//@version=5\nindicator("t")\n'
const v6 = '//@version=6\nindicator("t")\n'
// close runs 100..107; `close > 103` matches the last four bars.
const FALSE_THEN_TRUE = [5, 5, 5, 5, 7, 7, 7, 7]
const PROBE = 'plot(b == false ? 5 : 7)\n'

let serveOpt = {}
const build = (src) => buildRuntimeIr(src, { bars: BARS, inputs: {}, ...serveOpt })
function run(src) {
  const built = build(src)
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true, barTimes: BARS.map((b) => b.t) })
  return Array.from(r.outputs[0])
}
const refusalOf = (src) => {
  const b = build(src)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

describe('W4-T14 — Q-A3 GATE: the shipped lane keeps the named refusal for a typed bool block', () => {
  it('an `if` with no else, arm a comparison: refused by name (not served false)', () => {
    serveOpt = {}
    const r = refusalOf(`${v6}b = if close > 103
    close > open
${PROBE}`)
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toMatch(/v6 bool is never `na`/)
  })
  it('a `switch` with no default, bool arms: refused by name', () => {
    serveOpt = {}
    const r = refusalOf(`${v6}b = switch
    close > 105 => true
${PROBE}`)
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toMatch(/v6 bool is never `na`/)
  })
  it('the typing machinery is present: with the gate lifted (test-only opt) the same source is served false', () => {
    serveOpt = { w4t14ServeUnmatchedFalse: true }
    try {
      expect(run(`${v6}b = if close > 103
    close > open
${PROBE}`)).toEqual(FALSE_THEN_TRUE)
    } finally { serveOpt = {} }
  })
})

describe('W4-T14 — the object door keeps Q-A3 refused even with the gate lifted', () => {
  it('objectDoor + the test-only opt: still refused', () => {
    serveOpt = { w4t14ServeUnmatchedFalse: true, objectDoor: true }
    try {
      const r = refusalOf(`${v6}b = if close > 103
    close > open
${PROBE}`)
      expect(r.message).toMatch(/v6 bool is never `na`/)
    } finally { serveOpt = {} }
  })
})

describe('W4-T14 [machinery, gate lifted by the test-only opt] — a v6 unmatched block of provable bools yields false', () => {
  beforeAll(() => { serveOpt = { w4t14ServeUnmatchedFalse: true } })
  afterAll(() => { serveOpt = {} })
  it('an `if` with no else, arm a comparison', () => {
    expect(run(`${v6}b = if close > 103\n    close > open\n${PROBE}`)).toEqual(FALSE_THEN_TRUE)
  })
  it('an `if` with no else, arm the literal true', () => {
    expect(run(`${v6}b = if close > 103\n    true\n${PROBE}`)).toEqual(FALSE_THEN_TRUE)
  })
  it('an `else if` chain with no final else', () => {
    expect(run(`${v6}b = if close > 106\n    true\nelse if close > 103\n    close > 104\n${PROBE}`)).toEqual([5, 5, 5, 5, 5, 7, 7, 7])
  })
  it('a `switch` with no default, arms `and` / `not`', () => {
    expect(run(`${v6}b = switch\n    close > 105 => close > 100 and open < 200\n    close > 103 => not (close > 104)\n${PROBE}`))
      .toEqual([5, 5, 5, 5, 7, 5, 7, 7])
  })
  it('a subject switch with no default', () => {
    expect(run(`${v6}b = switch bar_index\n    5 => true\n    6 => close > 0\n${PROBE}`))
      .toEqual([5, 5, 5, 5, 5, 7, 7, 5])
  })
  it('an `input.bool` arm', () => {
    expect(run(`${v6}flag = input.bool(true, "f")\nb = if close > 103\n    flag\n${PROBE}`)).toEqual(FALSE_THEN_TRUE)
  })
  it('a name declared `bool` and a name bound to a comparison', () => {
    expect(run(`${v6}bool up = close > open\nb = if close > 103\n    up\n${PROBE}`)).toEqual(FALSE_THEN_TRUE)
    expect(run(`${v6}up = close > open\nb = if close > 103\n    up\n${PROBE}`)).toEqual(FALSE_THEN_TRUE)
  })
  it('a user function whose result is a comparison', () => {
    expect(run(`${v6}isUp(x) => x > 105\nb = if close > 103\n    isUp(close)\n${PROBE}`)).toEqual([5, 5, 5, 5, 5, 5, 7, 7])
  })
  it('a `:=` into a bool target (the temp is the hidden target, not the prior value)', () => {
    expect(run(`${v6}bool b = true\nb := if close > 103\n    close > 104\n${PROBE}`)).toEqual([5, 5, 5, 5, 5, 7, 7, 7])
  })
  it('a function body ending in a switch with no default', () => {
    expect(run(`${v6}f(x) =>\n    switch\n        x > 103 => true\nb = f(close)\n${PROBE}`)).toEqual(FALSE_THEN_TRUE)
  })
  it('a MATCHED arm still yields its own bool (true is 1, a false comparison is 0)', () => {
    expect(run(`${v6}b = if close > 103\n    close > 105\nplot(b ? 1 : 0)\n`)).toEqual([0, 0, 0, 0, 0, 0, 1, 1])
  })
})

describe('W4-T14 — v5 keeps na, and what is not provable keeps the refusal', () => {
  it('CONTROL v5: the same block is na, not false', () => {
    // na == false is false here, so every bar reads 7 in v5; v6 reads 5 on the unmatched bars
    expect(run(`${v5}b = if close > 103\n    close > open\n${PROBE}`)).toEqual([7, 7, 7, 7, 7, 7, 7, 7])
  })
  it('CONTROL v6: a number with no else is still na', () => {
    const out = run(`${v6}x = if close > 103\n    1.0\nplot(x)\n`)
    expect(out.slice(0, 4).every(Number.isNaN)).toBe(true)
  })
  it('an arm mixing a bool and a number is not provably either: refused by name', () => {
    const r = refusalOf(`${v6}b = if close > 103\n    close > 105\nelse if close > 101\n    1.0\nplot(b ? 1 : 0)\n`)
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toMatch(/v6 bool is never `na`/)
  })
  it('an untyped builtin arm (`timeframe.isdaily`) keeps the refusal', () => {
    const r = refusalOf(`${v6}b = if close > 103\n    timeframe.isdaily\n${PROBE}`)
    expect(r.guard).toBe('runtime:block-value')
  })
  it('a bool array element keeps the refusal', () => {
    const r = refusalOf(`${v6}var ba = array.new_bool(1, true)\nb = if close > 103\n    array.get(ba, 0)\n${PROBE}`)
    expect(r.guard).toBe('runtime:block-value')
  })
  it('a ternary mixing a bool and a number is not provably either: refused', () => {
    const r = refusalOf(`${v6}b = if close > 103
    close > 104 ? true : 1.0
${PROBE}`)
    expect(r.guard).toBe('runtime:block-value')
  })
})
