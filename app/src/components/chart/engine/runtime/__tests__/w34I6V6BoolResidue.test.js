// app/src/components/chart/engine/runtime/__tests__/w34I6V6BoolResidue.test.js
//
// ⭐⭐ W34-I6b — THE T14 RESIDUE: a v6 tail `if` / `switch` the bool typer did not reach.
//
// Pine semantics (as W4-T14, `w4V6Bool.test.js`): a Pine 6 `bool` is never `na`, so an `if`
// with no `else` (or a `switch` with no default) yields `false` for a bool when no arm matches,
// and `na` for every other type; v5 and below yield `na`. Q-A3 (the TradingView capture of the
// v6 `false`) is NOT yet taken, so a READ bool value stays the named refusal on the shipped lane;
// the served-false rails run through the test-only `w4t14ServeUnmatchedFalse` opt, as T14's do.
//
//   item 1  a function whose tail block can match nothing and EVERY call site of which is a
//           statement: the value is discarded, so no type is needed (no capture).
//   item 2  an arm that is itself a COMPLETE nested block (`if … else`, `switch` with a default)
//           is typed by recursion over its arms (bool half gated on Q-A3).
//   item 3  `c ? a : b` of bools and `and`/`or`/`not` arms: already typed bool by T14; pinned
//           here (gated on Q-A3).
//   item 4  `size.*`, `text.align_*`, `xloc.*`, `yloc.*`, `extend.*`, `label.style_*`,
//           `line.style_*` are typed by Pine's v6 reference (`namedConstantTypes.json`, generated
//           by tools/pine_survey/emit_named_constant_types.js): `const string`, so an unmatched
//           block of them is `na` in every version (no capture).
//
// Synthetic shapes only; no licence-held script text.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import NAMED_CONSTANT_TYPES from '../../ast/namedConstantTypes.json'

const N = 8
// close runs 100..107, open is 100
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100, h: 102 + i, l: 98, c: 100 + i, v: 1000,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = (v) => `//@version=${v}\nindicator("t")\n`
const V6_SENTENCE = /v6 bool is never `na`/
const PROBE = 'plot(b == false ? 5 : 7)\n'

let serveOpt = {}
const build = (src, extra = {}) => buildRuntimeIr(src, { bars: BARS, inputs: {}, ...serveOpt, ...extra })
function run(src, extra) {
  const built = build(src, extra)
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true, barTimes: BARS.map((b) => b.t) })
  return Array.from(r.outputs[0])
}
const refusalOf = (src, extra) => {
  const b = build(src, extra)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

// ── item 1 ─────────────────────────────────────────────────────────────────────────────────
// `f` keeps a rolling array of at most three closes; its tail `if` yields `array.shift`'s value
// (a float the typer cannot prove anything about) only when it runs. Size: 1, 2, 3, 3, ...
const ROLL = [1, 2, 3, 3, 3, 3, 3, 3]
const B3_IF = (v, calls) => `${head(v)}var a = array.new_float()
f(x) =>
    array.push(a, x)
    if array.size(a) > 3
        array.shift(a)
${calls}
plot(array.size(a))
`
const B3_SWITCH = (v, calls) => `${head(v)}var a = array.new_float()
f(x) =>
    array.push(a, x)
    switch
        array.size(a) > 3 => array.shift(a)
${calls}
plot(array.size(a))
`

describe('W34-I6b item 1 — a tail block whose value is never read needs no type', () => {
  it('v6: tail `if` with no else, every call site a statement: served', () => {
    expect(run(B3_IF(6, 'f(close)'))).toEqual(ROLL)
  })
  it('v6: tail `switch` with no default, called as a statement: served', () => {
    expect(run(B3_SWITCH(6, 'f(close)'))).toEqual(ROLL)
  })
  it('v6: a statement call inside an `if` statement is still a statement', () => {
    expect(run(B3_IF(6, 'if close > 0\n    f(close)'))).toEqual(ROLL)
  })
  it('CONTROL v5: the same script is served (na rule), same values', () => {
    expect(run(B3_IF(5, 'f(close)'))).toEqual(ROLL)
  })
  it('MIXED: the same function ALSO called as a value refuses by name', () => {
    const r = refusalOf(B3_IF(6, 'f(close)\ny = f(open)'))
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toMatch(V6_SENTENCE)
  })
  it('a call that is the LAST line of another function is that function\'s value: refuses', () => {
    const r = refusalOf(B3_IF(6, 'g(x) =>\n    f(x)\ng(close)'))
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toMatch(V6_SENTENCE)
  })
  it('a call inside an expression is a value use: refuses', () => {
    const r = refusalOf(B3_IF(6, 'f(close)\nplot(na(f(open)) ? 1 : 0)'))
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toMatch(V6_SENTENCE)
  })
  it('the object door keeps Q-A3: a statement-only function there still refuses', () => {
    const r = refusalOf(B3_IF(6, 'f(close)'), { objectDoor: true, objectTrees: [] })
    expect(r.message).toMatch(/Q-A3/)
  })
})

// ── review r1 (B1, R1, R7) ──────────────────────────────────────────────────────────────────
// `f` is a v6 bool tail with no else (unmatched on bars 0..4). Each script below READS f's value
// through a value-bound block, a parameter default or another function, so the v6 rule must hold:
// refused by name on the shipped lane (Pine 6 answers false there: [5,5,5,5,5,7,7,7]).
const F6 = (v = 6) => `${head(v)}f(x) =>
    if x > 104
        close > open
`
const READ_THROUGH = {
  'the `else` arm of a value-bound `if` (review B1 repro)': 'y = if close > 1000\n    false\nelse\n    f(close)\nplot(y == false ? 5 : 7)\n',
  'an `else if` arm of a value-bound `if` (complete chain)': 'y = if close > 1000\n    false\nelse if close > 0\n    f(close)\nelse\n    false\nplot(y == false ? 5 : 7)\n',
  'an `else` arm of a value-bound `if` inside another function body': 'g(z) =>\n    y = if z > 1000\n        false\n    else\n        f(z)\n    y\nplot(g(close) == false ? 5 : 7)\n',
  'a nested `if` inside the `else` arm of a value-bound `if`': 'y = if close > 1000\n    false\nelse\n    if close > 0\n        f(close)\n    else\n        false\nplot(y == false ? 5 : 7)\n',
  'the HEAD arm of a value-bound `if` (R1)': 'y = if close > 0\n    f(close)\nelse\n    false\nplot(y == false ? 5 : 7)\n',
  'a block arm of a value-bound `switch` (R1)': 'y = switch\n    close > 0 =>\n        f(close)\n    => false\nplot(y == false ? 5 : 7)\n',
  'a parameter default of another function (R7)': 'g(a, d = f(close)) =>\n    a + (d ? 1 : 0)\nf(close)\nplot(g(close))\n',
}

describe('W34-I6b review r1 — a value read through a value-bound block is never "discarded"', () => {
  for (const [name, tail] of Object.entries(READ_THROUGH)) {
    it(`v6: ${name}: refused by name`, () => {
      serveOpt = {}
      const r = refusalOf(F6() + tail)
      expect(r.guard).toBe('runtime:block-value')
      expect(r.message).toMatch(V6_SENTENCE)
    })
  }
  it('[gate lifted] v6: the B1 repro reads f\'s false on the unmatched bars', () => {
    serveOpt = { w4t14ServeUnmatchedFalse: true }
    try {
      expect(run(F6() + READ_THROUGH['the `else` arm of a value-bound `if` (review B1 repro)'])).toEqual([5, 5, 5, 5, 5, 7, 7, 7])
    } finally { serveOpt = {} }
  })
  it('CONTROL v5: the B1 repro is na on the unmatched bars (all 7)', () => {
    expect(run(F6(5) + READ_THROUGH['the `else` arm of a value-bound `if` (review B1 repro)'])).toEqual(Array(N).fill(7))
  })
})

// ── item 2 ─────────────────────────────────────────────────────────────────────────────────
// outer `if x > 102` (bars 3..7) with no else; its arm is a complete `if x > 104 … else false`.
const B2 = (v) => `${head(v)}f(x) =>
    if x > 102
        if x > 104
            close > open
        else
            false
b = f(close)
${PROBE}`
const B2_SWITCH = (v) => `${head(v)}b = if close > 102
    switch
        close > 104 => close > open
        => false
${PROBE}`

describe('W34-I6b item 2 — Q-A3 GATE kept: a nested-arm bool block is still the named refusal', () => {
  it('v6 nested `if … else` arm, gate not lifted: refused by name', () => {
    serveOpt = {}
    const r = refusalOf(B2(6))
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toMatch(V6_SENTENCE)
  })
})

describe('W34-I6b item 2 [machinery, gate lifted by the test-only opt] — nested arms typed by recursion', () => {
  beforeAll(() => { serveOpt = { w4t14ServeUnmatchedFalse: true } })
  afterAll(() => { serveOpt = {} })
  it('v6: an arm that is a complete nested `if … else` of bools: unmatched is false', () => {
    expect(run(B2(6))).toEqual([5, 5, 5, 5, 5, 7, 7, 7])
  })
  it('v6: an arm that is a `switch` with a default, bool arms: unmatched is false', () => {
    expect(run(B2_SWITCH(6))).toEqual([5, 5, 5, 5, 5, 7, 7, 7])
  })
  it('CONTROL v5: the same block is na on the unmatched bars', () => {
    expect(run(B2(5))).toEqual([7, 7, 7, 5, 5, 7, 7, 7])
  })
  it('UNTYPABLE: a nested chain with no final `else` is not recursed into: refused', () => {
    const r = refusalOf(`${head(6)}b = if close > 102\n    if close > 104\n        true\n    else if close > 103\n        false\n${PROBE}`)
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toMatch(V6_SENTENCE)
  })
  it('UNTYPABLE: a nested `switch` with no default is not recursed into: refused', () => {
    const r = refusalOf(`${head(6)}b = if close > 102\n    switch\n        close > 104 => true\n${PROBE}`)
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toMatch(V6_SENTENCE)
  })
  it('UNTYPABLE: a nested arm mixing a bool and an untyped builtin: refused', () => {
    const r = refusalOf(`${head(6)}b = if close > 102\n    if close > 104\n        true\n    else\n        timeframe.isdaily\n${PROBE}`)
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toMatch(V6_SENTENCE)
  })
})

describe('W34-I6b item 2 — a nested arm of numbers is provably not a bool (no gate involved)', () => {
  it('the object door keeps master: a nested arm is not recursed into there (refused, Q-A3)', () => {
    serveOpt = {}
    const r = refusalOf(`${head(6)}x = if close > 102\n    if close > 104\n        1.0\n    else\n        2.0\nplot(x)\n`, { objectDoor: true, objectTrees: [] })
    expect(r.message).toMatch(/Q-A3/)
  })
  it('v6: na on the unmatched bars, served on the shipped lane', () => {
    serveOpt = {}
    const out = run(`${head(6)}x = if close > 102\n    if close > 104\n        1.0\n    else\n        2.0\nplot(x)\n`)
    expect(out.slice(0, 3).every(Number.isNaN)).toBe(true)
    expect(out.slice(3)).toEqual([2, 2, 1, 1, 1])
  })
})

// ── item 3 ─────────────────────────────────────────────────────────────────────────────────
const B4A = (v) => `${head(v)}flag = input.bool(false, "f")
b = switch bar_index % 3
    0 => flag == false ? close > 103 : close < 101
    1 => close > 104 and open < 200
${PROBE}`

describe('W34-I6b item 3 — ternary and logical arms (typed by T14; gated on Q-A3)', () => {
  it('gate not lifted: a v6 `switch` of `?:` / `and` arms is the named refusal', () => {
    serveOpt = {}
    const r = refusalOf(B4A(6))
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toMatch(V6_SENTENCE)
  })
  it('[gate lifted] v6: unmatched (bar_index % 3 == 2) is false', () => {
    serveOpt = { w4t14ServeUnmatchedFalse: true }
    try {
      // bars 0..7: m = 0,1,2,0,1,2,0,1 ; m0: close > 103 ; m1: close > 104 ; m2: unmatched
      expect(run(B4A(6))).toEqual([5, 5, 5, 5, 5, 5, 7, 7])
    } finally { serveOpt = {} }
  })
  it('CONTROL v5: unmatched is na', () => {
    expect(run(B4A(5))).toEqual([5, 5, 7, 5, 5, 7, 7, 7])
  })
  it('UNTYPABLE: a ternary with an untyped branch keeps the refusal, gate lifted', () => {
    serveOpt = { w4t14ServeUnmatchedFalse: true }
    try {
      const r = refusalOf(`${head(6)}b = switch bar_index % 3\n    0 => close > 103 ? timeframe.isdaily : false\n${PROBE}`)
      expect(r.guard).toBe('runtime:block-value')
      expect(r.message).toMatch(V6_SENTENCE)
    } finally { serveOpt = {} }
  })
})

// ── item 4 ─────────────────────────────────────────────────────────────────────────────────
// `mode` is an input whose default matches NO arm, so the switch is unmatched on every bar.
const B4B = (v, a, b, def = '"Z"') => `${head(v)}mode = input.string(${def}, "m", options=["A", "B", "Z"])
s = switch mode

    "A" => ${a}
    "B" => ${b}
plot(na(s) ? 1 : 0)
`
const FAMILIES = [
  ['size.small', 'size.large'], ['text.align_left', 'text.align_right'], ['xloc.bar_index', 'xloc.bar_time'],
  ['yloc.price', 'yloc.abovebar'], ['extend.none', 'extend.both'], ['label.style_none', 'label.style_label_up'],
  ['line.style_solid', 'line.style_dashed'],
]

describe('W34-I6b item 4 — named constants typed string by the v6 reference', () => {
  it('the generated table types every listed family `string`, from the reference', () => {
    const t = NAMED_CONSTANT_TYPES.type
    for (const [a, b] of FAMILIES) {
      expect(t[a], a).toBe('string')
      expect(t[b], b).toBe('string')
    }
    expect(Object.values(t).every((ty) => ty === 'string')).toBe(true)
    expect(t['text.format_bold']).toBeUndefined()
  })
  for (const [a, b] of FAMILIES) {
    it(`v6: a \`switch\` of \`${a.split('.')[0]}.*\` with no default (blank line after the header): served, unmatched na`, () => {
      expect(run(B4B(6, a, b))).toEqual(Array(N).fill(1))
    })
  }
  it('v6: a MATCHED arm still yields its constant (not na)', () => {
    expect(run(B4B(6, 'size.small', 'size.large', '"A"'))).toEqual(Array(N).fill(0))
  })
  it('CONTROL v5: the same block is na', () => {
    expect(run(B4B(5, 'size.small', 'size.large'))).toEqual(Array(N).fill(1))
  })
  it('(r2) the OBJECT DOOR keeps master: a v6 `size.*` switch with no default is refused there (Q-A3)', () => {
    const r = refusalOf(B4B(6, 'size.small', 'size.large'), { objectDoor: true, objectTrees: [] })
    expect(r.guard).toBe('runtime:object-door')
    expect(r.message).toMatch(/Q-A3/)
  })
  it('(r2) the same source OFF the door is served, unmatched na (the door rail\'s pair)', () => {
    expect(run(B4B(6, 'size.small', 'size.large'), { objectTrees: [] })).toEqual(Array(N).fill(1))
  })
  it('UNTYPABLE: a constant the table does not hold (`text.format_bold`, a `text_format`) keeps the refusal', () => {
    const r = refusalOf(B4B(6, 'text.format_bold', 'text.format_italic'))
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toMatch(V6_SENTENCE)
  })
})

// ⭐ Rail gap (review W34-I6b N1): item 4 reached through a DECLARATION, `var s = size.small` then
// `s := switch …` with no default. The typing runs through `declaredTypeOfName` / `nameIsNumeric`,
// not the arm itself, so it needs its own door rail. Door: master's answer (Q-A3, refused). Pane: the
// same block is served, unmatched `na` (a `size.*` is a `const string` in the v6 reference).
const B4V = (v) => `${head(v)}mode = input.string("Z", "m", options=["A", "B", "Z"])
var s = size.small
s := switch mode
    "A" => size.small
    "B" => size.large
plot(na(s) ? 1 : 0)
`
describe('W34-I6b N1 — the `var s = size.*` / `s := switch` path', () => {
  it('the OBJECT DOOR keeps master: refused by name (Q-A3)', () => {
    const r = refusalOf(B4V(6), { objectDoor: true, objectTrees: [] })
    expect(r.guard).toBe('runtime:object-door')
    expect(r.message).toMatch(/can match no arm.*Q-A3/)
  })
  it('the same source OFF the door is served, unmatched na (the door rail\'s pair)', () => {
    expect(run(B4V(6), { objectTrees: [] })).toEqual(Array(N).fill(1))
  })
})
