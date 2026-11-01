// app/src/components/chart/engine/runtime/__tests__/p3WsaReviewFixes.test.js
//
// ─── ⭐⭐ P3 WS-A — THE INDEPENDENT REVIEW OF dae6d29434, EACH FINDING A RAIL ──────
//
// Every case below was a wrong answer (or a wrong refusal) found by a reviewer's
// probe after the WS-A rails were green. Each asserts Pine's value, worked by
// hand over the fixture (close 100..107), never the lane's previous output.
//
//   C1  `x := if/switch …` — a read of `x` INSIDE the block sees x's PRIOR value
//       (the lane assigned `na` to x before running the chain)
//   H1  a function whose last line is a comma statement yields the LAST segment
//   H2  the v6 `for` guard: the `by` step, a method receiver, a function in the
//       bound reading a global the body writes, a bound with side effects
//   H3  `varip x = if/switch` is refused by name, even on a realtime-ledger door
//   M1  a switch subject holding a call keeps WS-C's invariance (no R4 region)
//   M2  writes in later comma segments and in inline `=>` arms are mutations
//   M3  Pine 6 `bool` is never `na`: an unmatched block-valued bool
//   L1  the array write tables are derived from collections.js
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { ARRAY_FNS } from '../collections.js'

const N = 8
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100, h: 102 + i, l: 98, c: 100 + i, v: 1000,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const C = BARS.map((b) => b.c)
const v5 = '//@version=5\nindicator("t")\n'
const v6 = '//@version=6\nindicator("t")\n'

const build = (src, opts = {}) => buildRuntimeIr(src, { bars: BARS, inputs: {}, ...opts })
function run(src, opts) {
  const built = build(src, opts)
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return Array.from(r.outputs[0])
}
const refusalOf = (src, opts) => {
  const b = build(src, opts)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

describe('C1 — `x := if/switch`: a read of x inside the block is x\'s PRIOR value', () => {
  it('⛔⛔ the reviewer\'s case: an outer write, then `x + y`; else `x + 1`', () => {
    const src = `${v5}var float x = 1.0\nvar float y = 0.0\nx := if close > 103\n    y := y + 1\n    x + y\nelse\n    x + 1\nplot(x)\n`
    expect(run(src)).toEqual([2, 3, 4, 5, 6, 8, 11, 15])
  })
  it('⛔⛔ an arm ending in `y := x * 2` yields that value, computed from x\'s prior value', () => {
    const src = `${v5}var float x = 1.0\nvar float y = 0.0\nx := if close > 103\n    y := x * 2\nelse\n    x + 1\nplot(x)\n`
    expect(run(src)).toEqual([2, 3, 4, 5, 10, 20, 40, 80])
  })
  it('⛔⛔ a switch block arm `n += 1` then `x * 2`', () => {
    const src = `${v5}var float x = 1.0\nvar n = 0\nx := switch\n    close > 103 =>\n        n += 1\n        x * 2\n    => x + 1\nplot(x)\n`
    expect(run(src)).toEqual([2, 3, 4, 5, 10, 20, 40, 80])
  })
  it('⛔⛔ an inline comma arm `n += 1, x * 2`', () => {
    const src = `${v5}var float x = 1.0\nvar n = 0\nx := if close > 103\n    n += 1, x * 2\nelse\n    x + 1\nplot(x)\n`
    expect(run(src)).toEqual([2, 3, 4, 5, 10, 20, 40, 80])
  })
  it('⛔⛔ a counter: `cnt := if close > 101 / cnt + 1 / else 0`', () => {
    expect(run(`${v5}var cnt = 0\ncnt := if close > 101\n    cnt + 1\nelse\n    0\nplot(cnt)\n`))
      .toEqual([0, 0, 1, 2, 3, 4, 5, 6])
  })
  it('⛔⛔ a state machine: `st := switch st` cycles 1, 2, 0', () => {
    expect(run(`${v5}var st = 0\nst := switch st\n    0 => 1\n    1 => 2\n    => 0\nplot(st)\n`))
      .toEqual([1, 2, 0, 1, 2, 0, 1, 2])
  })
  it('⛔⛔ a trailing stop: `tr := if close > tr …` reads tr\'s prior value in test and arm', () => {
    const src = `${v5}var float tr = 0.0\ntr := if close > tr\n    math.max(tr, close - 2)\nelse\n    close + 2\nplot(tr)\n`
    expect(run(src)).toEqual(C.map((c) => c - 2))
  })
  it('⛔ a non-`var` name: its value this bar before the block', () => {
    const src = `${v5}x = close\nx := if close > 103\n    x * 2\nelse\n    x + 1\nplot(x)\n`
    expect(run(src)).toEqual(C.map((c) => (c > 103 ? c * 2 : c + 1)))
  })
  // ⛔ review 3 L-2 — the temp carries the target's kind (text here)
  it('⛔ a TEXT target: `s := if … "b" else "c"` keeps its text kind through the temp', () => {
    expect(run(`${v5}var string s = "a"\ns := if close > 103\n    "b"\nelse\n    "c"\nplot(s == "b" ? 1 : 0)\n`)).toEqual([0, 0, 0, 0, 1, 1, 1, 1])
  })
  it('⛔ a COLOUR target keeps its colour kind through the temp', () => {
    expect(run(`${v5}var color c = color.red\nc := if close > 103\n    color.green\nelse\n    color.blue\nplot(c == color.green ? 1 : 0)\n`)).toEqual([0, 0, 0, 0, 1, 1, 1, 1])
  })
  it('⛔ CONTROL — an unmatched `x := if` with no else still yields na (Pine)', () => {
    const out = run(`${v5}var float x = 1.0\nx := if close > 103\n    x + 1\nplot(x)\n`)
    expect(out.slice(0, 4).every(Number.isNaN)).toBe(true)
    expect(out.slice(4).every(Number.isNaN)).toBe(true)   // na + 1 stays na
  })
})

describe('H1 — a function whose last line is a comma statement yields the LAST segment', () => {
  for (const head of [v5, v6]) {
    const ver = head.includes('=5') ? 'v5' : 'v6'
    it(`⛔⛔ ${ver}: \`a = x, g(a)\` yields g(a)`, () => {
      expect(run(`${head}g(v) => v * 3\nf(x) =>\n    a = x, g(a)\nplot(f(close))\n`)).toEqual(C.map((c) => c * 3))
    })
    it(`⛔⛔ ${ver}: \`a := x, g(a)\` yields g(a)`, () => {
      expect(run(`${head}g(v) => v * 3\nf(x) =>\n    a = 0.0\n    a := x, g(a)\nplot(f(close))\n`)).toEqual(C.map((c) => c * 3))
    })
    it(`⛔⛔ ${ver}: \`a = x, b = a * 2, g(b)\` yields g(b)`, () => {
      expect(run(`${head}g(v) => v * 3\nf(x) =>\n    a = x, b = a * 2, g(b)\nplot(f(close))\n`)).toEqual(C.map((c) => c * 6))
    })
  }
})

describe('H2 — the v6 `for` guard: every way a pass can move the loop', () => {
  it('⛔⛔ (a) the body writes the `by` step', () => {
    const r = refusalOf(`${v6}int st = 1\nint c = 0\nfor i = 0 to 9 by st\n    c += 1\n    if i == 0\n        st := 3\nplot(c)\n`)
    expect(r.guard).toBe('runtime:loop')
    expect(r.message).toMatch(/Pine 6/)
  })
  it('⛔ CONTROL — (a) a step the body never writes is served', () => {
    expect(run(`${v6}int st = 3\nint c = 0\nfor i = 0 to 9 by st\n    c += 1\nplot(c)\n`)).toEqual(Array(N).fill(4))
  })
  it('⛔⛔ (b) a user METHOD on the bound\'s array pushes into it', () => {
    const src = `${v6}method grow(array<float> arr) =>\n    array.push(arr, 9.0)\n    0\na = array.from(1.0, 2.0)\nfloat s = 0.0\n`
      + 'for i = 0 to array.size(a) - 1\n    s += 1\n    if array.size(a) < 4\n        a.grow()\nplot(s)\n'
    expect(refusalOf(src).guard).toBe('runtime:loop')
  })
  it('⛔⛔ (b) a user METHOD sets the element an element bound reads', () => {
    const src = `${v6}method bump(array<float> arr) =>\n    array.set(arr, 0, 5.0)\n    0\na = array.from(3.0)\nfloat s = 0.0\n`
      + 'for i = 0 to array.get(a, 0)\n    s += 1\n    a.bump()\nplot(s)\n'
    expect(refusalOf(src).guard).toBe('runtime:loop')
  })
  it('⛔⛔ (c) a function in the bound reads a global the body reassigns', () => {
    const src = `${v6}var int lim = 3\nlimit() => lim\nint c = 0\nfor i = 0 to limit()\n    c += 1\n    lim := 1\nplot(c)\n`
    const b = build(src)
    if (b.ok) throw new Error('served a bound read through `limit()` that the body moves')
    expect(b.refusal.guard).toMatch(/runtime:loop|runtime:function-global-state/)
  })
  it('⛔⛔ (c) the same through a nested function', () => {
    const src = `${v6}var int lim = 3\ninner() => lim\nlimit() => inner() + 0\nint c = 0\nfor i = 0 to limit()\n    c += 1\n    lim := 1\nplot(c)\n`
    const b = build(src)
    if (b.ok) throw new Error('served a bound read through nested functions that the body moves')
    expect(b.refusal.guard).toMatch(/runtime:loop|runtime:function-global-state/)
  })
  it('⛔⛔ (d) a bound whose call pushes to a global array runs every pass in v6', () => {
    const src = `${v6}var a = array.new_float(0)\nnxt() =>\n    array.push(a, 1.0)\n    3\nint c = 0\nfor i = 0 to nxt()\n    c += 1\nplot(c)\n`
    const b = build(src)
    if (b.ok) throw new Error('served a bound with a side effect')
    expect(b.refusal.guard).toMatch(/runtime:loop|runtime:function-global-state/)
  })
  it('⛔⛔ (d) a bound whose call keeps `var` state runs every pass in v6', () => {
    const src = `${v6}tick() =>\n    var int c = 0\n    c += 1\n    3\nint n = 0\nfor i = 0 to tick()\n    n += 1\nplot(n)\n`
    const r = refusalOf(src)
    expect(r.guard).toBe('runtime:loop')
  })
  it('⛔ CONTROL — (d) a pure function in the bound is served', () => {
    expect(run(`${v6}three() => 3\nint n = 0\nfor i = 0 to three()\n    n += 1\nplot(n)\n`)).toEqual(Array(N).fill(4))
  })
})

describe('H3 — `varip x = if/switch` is refused by name', () => {
  it('⛔⛔ on a realtime-ledger door (where a plain top-level `varip` is admitted)', () => {
    const r = refusalOf(`${v6}varip float x = if close > 103\n    1.0\nelse\n    2.0\nplot(x)\n`, { realtimeLedger: true })
    expect(r.guard).toBe('runtime:varip')
    expect(r.message).toMatch(/block-valued `varip`/)
  })
  it('⛔⛔ and `varip x = switch` the same', () => {
    const r = refusalOf(`${v6}varip x = switch\n    close > 103 => 1\n    => 2\nplot(x)\n`, { realtimeLedger: true })
    expect(r.guard).toBe('runtime:varip')
  })
})

describe('M1 — a switch subject holding a call keeps its invariance', () => {
  it('⛔⛔ `switch input.string(…)` with ta arms draws exactly the chosen arm', () => {
    const src = `${v5}x = switch input.string("WMA", "t", options = ["WMA", "HMA"])\n    "WMA" => ta.wma(close, 3)\n    "HMA" => ta.hma(close, 3)\nplot(x)\n`
    expect(run(src)).toEqual(run(`${v5}plot(ta.wma(close, 3))\n`))
  })
})

describe('M2 — a write in a later comma segment or an inline arm is a mutation', () => {
  it('⛔⛔ the switch-statement counter idiom on a plain name: `close > 103 => c += 1`', () => {
    expect(run(`${v5}c = 0\nswitch\n    close > 103 => c += 1\nplot(c)\n`)).toEqual([0, 0, 0, 0, 1, 1, 1, 1])
  })
  it('⛔ CONTROL — the same with `var` accumulates', () => {
    expect(run(`${v5}var c = 0\nswitch\n    close > 103 => c += 1\nplot(c)\n`)).toEqual([0, 0, 0, 0, 1, 2, 3, 4])
  })
  it('⛔⛔ a write in a LATER comma segment', () => {
    expect(run(`${v5}a = 0\nb = 0\nif close > 103\n    a += 1, b += 2\nplot(b)\n`)).toEqual([0, 0, 0, 0, 2, 2, 2, 2])
  })
  it('⛔⛔ inside a function body: `x > 103 => acc += x` on a plain local', () => {
    const src = `${v5}f(x) =>\n    acc = 0.0\n    switch\n        x > 103 => acc += x\n    acc\nplot(f(close))\n`
    expect(run(src)).toEqual([0, 0, 0, 0, 104, 105, 106, 107])
  })
})

describe('M3 — Pine 6 `bool` is never `na`', () => {
  // `b == false` tells false from na: na compares false to everything here.
  it('⛔⛔ v6: an unmatched block-valued bool is FALSE, or refused by name — never na', () => {
    const b = build(`${v6}b = if close > 103\n    true\nplot(b == false ? 5 : 7)\n`)
    if (!b.ok) { expect(b.refusal.message).toMatch(/bool/); return }
    const program = lowerIrProgram(b.ir)
    const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true, barTimes: BARS.map((x) => x.t) })
    expect(Array.from(r.outputs[0])).toEqual([5, 5, 5, 5, 7, 7, 7, 7])
  })
  it('⛔⛔ v6: the same in a function ending in a switch', () => {
    const b = build(`${v6}f(x) =>\n    switch\n        x > 103 => true\nplot(f(close) == false ? 5 : 7)\n`)
    if (!b.ok) { expect(b.refusal.message).toMatch(/bool/); return }
    const program = lowerIrProgram(b.ir)
    const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true, barTimes: BARS.map((x) => x.t) })
    expect(Array.from(r.outputs[0])).toEqual([5, 5, 5, 5, 7, 7, 7, 7])
  })
  it('⛔⛔ v6: a name declared `bool` as the arm value — refused by name too', () => {
    const r = refusalOf(`${v6}bool up = close > open\nb = if close > 103\n    up\nplot(b ? 1 : 0)\n`)
    expect(r.message).toMatch(/bool/)
  })
  it('⛔ CONTROL — v6: a NUMBER with no else still yields na (not refused)', () => {
    const out = run(`${v6}x = if close > 103\n    1.0\nplot(x)\n`)
    expect(out.slice(0, 4).every(Number.isNaN)).toBe(true)
    expect(out.slice(4)).toEqual([1, 1, 1, 1])
  })
  it('⛔ CONTROL — v6: a bool WITH an else is served', () => {
    expect(run(`${v6}b = if close > 103\n    true\nelse\n    false\nplot(b ? 1 : 0)\n`)).toEqual([0, 0, 0, 0, 1, 1, 1, 1])
  })
  // ⭐⭐ review H-2 — the guard FAILS CLOSED: unmatched (bars 0-5, close > 105 is
  // false) must never serve `na` where Pine 6 draws `false` ([5,5,5,5,5,5,7,7]).
  const unmatchedBoolIsRefused = (src) => {
    const b = build(src)
    if (b.ok) {
      const program = lowerIrProgram(b.ir)
      const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true, barTimes: BARS.map((x) => x.t) })
      expect(Array.from(r.outputs[0])).toEqual([5, 5, 5, 5, 5, 5, 7, 7])
      return
    }
    expect(b.refusal.guard).toBe('runtime:block-value')
    expect(b.refusal.message).toMatch(/v6 bool is never `na`/)
  }
  it('⛔⛔ H-2: a user function returning bool', () => {
    unmatchedBoolIsRefused(`${v6}isUp(x) => x > 105\nb = if close > 105\n    isUp(close)\nplot(b == false ? 5 : 7)\n`)
  })
  it('⛔⛔ H-2: a `timeframe.isdaily` arm', () => {
    unmatchedBoolIsRefused(`${v6}b = if close > 105\n    timeframe.isdaily\nplot(b == false ? 5 : 7)\n`)
  })
  it('⛔⛔ H-2: `array.get` of a bool array', () => {
    unmatchedBoolIsRefused(`${v6}var ba = array.new_bool(1, true)\nb = if close > 105\n    array.get(ba, 0)\nplot(b == false ? 5 : 7)\n`)
  })
  it('⛔⛔ H-2: a switch arm ending in a user bool function', () => {
    unmatchedBoolIsRefused(`${v6}isUp(x) => x > 105\nb = switch\n    close > 105 => isUp(close)\nplot(b == false ? 5 : 7)\n`)
  })
  it('⛔⛔ H-2: a target declared `bool b = false`, then `b := if …`', () => {
    unmatchedBoolIsRefused(`${v6}isUp(x) => x > 105\nbool b = false\nb := if close > 105\n    isUp(close)\nplot(b == false ? 5 : 7)\n`)
  })
  it('⛔ CONTROL — H-2: a target declared `float` is served (na) whatever the arm', () => {
    const out = run(`${v6}g(x) => x * 2\nfloat f = na\nf := if close > 105\n    g(close)\nplot(f)\n`)
    expect(out.slice(0, 6).every(Number.isNaN)).toBe(true)
    expect(out.slice(6)).toEqual([212, 214])
  })
  it('⛔ CONTROL — H-2: a name bound to arithmetic is provably a number: served', () => {
    const out = run(`${v6}m = close * 2\nx = if close > 105\n    m\nplot(x)\n`)
    expect(out.slice(0, 6).every(Number.isNaN)).toBe(true)
    expect(out.slice(6)).toEqual([212, 214])
  })
  // ⛔⛔ review 3 M-1a — `ta.valuewhen` / `ta.change` / `nz` return their SOURCE's type
  it('⛔⛔ M-1a: `ta.valuewhen` of a bool source is not a number', () => {
    const r = refusalOf(`${v6}b = if close > 105\n    ta.valuewhen(high > low + 6, close > open, 0)\nplot(b ? 1 : 0)\n`)
    expect(r.message).toMatch(/v6 bool is never `na`/)
  })
  it('⛔⛔ M-1a: `nz` of a bool name is not a number', () => {
    const r = refusalOf(`${v6}up = close > open\nb = if close > 105\n    nz(up)\nplot(b ? 1 : 0)\n`)
    expect(r.message).toMatch(/v6 bool is never `na`/)
  })
  // ⛔⛔ review 3 M-1b — a global `float x` must not type a function-local bool `x`
  it('⛔⛔ M-1b: `x := if` on a local bool x shadowing a global float x', () => {
    const r = refusalOf(`${v6}float x = 0.0\nf(v) =>\n    x = v > 100\n    x := if v > 102\n        true\n    x ? 1 : 0\nplot(f(close))\n`)
    expect(r.message).toMatch(/v6 bool is never `na`/)
  })
  it('⛔⛔ M-1b: an arm reading the local bool x (a global float x elsewhere)', () => {
    const r = refusalOf(`${v6}float x = 0.0\nf(v) =>\n    x = v > 100\n    y = if v > 102\n        x\n    y ? 1 : 0\nplot(f(close))\n`)
    expect(r.message).toMatch(/v6 bool is never `na`/)
  })
  // ⛔ review 3 L-3 — a ternary whose both branches are numbers is a number
  it('⛔ CONTROL — L-3: a numeric ternary arm is served (na where unmatched)', () => {
    const out = run(`${v6}x = if close > 103\n    close > open ? 1.0 : 2.0\nplot(x)\n`)
    expect(out.slice(0, 4).every(Number.isNaN)).toBe(true)
    expect(out.slice(4)).toEqual([1, 1, 1, 1])
  })
  it('⛔ CONTROL — v5: an unmatched block-valued bool is na', () => {
    expect(run(`${v5}b = if close > 103\n    true\nplot(b == false ? 5 : 7)\n`)).toEqual(Array(N).fill(7))
  })
})

describe('L2 — a branch ending in a loop: the refusal does not claim a loop has no value', () => {
  it('⛔ the sentence says the loop\'s value is not lowered (Pine yields its last pass)', () => {
    const r = refusalOf(`${v5}x = if close > 103\n    for i = 0 to 2\n        0\nelse\n    0\nplot(x)\n`)
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toMatch(/last pass/)
    expect(r.message).not.toMatch(/no value to yield/)
  })
})

describe('L1 — every array function says whether it writes, and how', () => {
  it('⛔ each ARRAY_FNS entry declares `writes` as one of none / elements / size', () => {
    const bad = Object.entries(ARRAY_FNS).filter(([, d]) => !['none', 'elements', 'size'].includes(d.writes)).map(([k]) => k)
    expect(bad).toEqual([])
  })
  it('⛔ CONTROL — the writers are the ones Pine documents', () => {
    expect(ARRAY_FNS['array.push'].writes).toBe('size')
    expect(ARRAY_FNS['array.set'].writes).toBe('elements')
    expect(ARRAY_FNS['array.size'].writes).toBe('none')
  })
})
