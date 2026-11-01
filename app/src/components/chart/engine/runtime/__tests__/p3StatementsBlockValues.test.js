// app/src/components/chart/engine/runtime/__tests__/p3StatementsBlockValues.test.js
//
// ─── ⭐⭐ PHASE 3, WORKSTREAM A — STATEMENTS AND BLOCK VALUES ──────────────────
//
// docs/pine/PHASE3-RUNTIME-PLAN.md, section 5, row A. Each feature below was a
// refusal by name on the runtime lane, and each is now lowered to the Pine
// semantics it names. Every case reads per-bar values over a fixture whose
// arms DIFFER, so a lowering that always took one arm, ran a block every bar
// instead of once, or skipped the statements in front of a value cannot pass.
//
//   A1  a multi-statement value arm runs its statements, then yields its last
//       line (Pine: the value of a block is its last statement's)
//   A2  the last line of a value block may be a binding / `:=` / compound /
//       destructuring (the function-body rule, §16, in every position)
//   A3  a TUPLE-valued block: `[a, b] = if …`, `[a, b] = switch …`, and a
//       function whose arms yield `[x, y]`
//   A4  a function body ending in a `switch` block, or in a binding the
//       resolver holds as an expression
//   A5  a branch with NO value (a loop, a void call, a valueless helper): a
//       function becomes valueless (C18), any read refuses by name
//   A6  `switch` as a STATEMENT — the first matching arm runs, and no other;
//       the subject is evaluated ONCE
//   A7  `var x = if …` / `var x = switch …` initialises ONCE
//   A8  Pine's comma statement separator
//   A9  the refusal vocabulary no longer claims capabilities this lane has
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr, RUNTIME_REFUSALS } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 8
// close runs 100..107: `close > 103` is false on bars 0-3 and true on bars 4-7.
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100, h: 102 + i, l: 98, c: 100 + i, v: 1000,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'
const C = BARS.map((b) => b.c)

function runAll(src) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {}, p3Statements: true })
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return r.outputs.map((o) => Array.from(o))
}
const run = (src) => runAll(src)[0]
const refusalOf = (src) => {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {}, p3Statements: true })
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}
const isNa = (v) => Number.isNaN(v)

describe('⛔ CONTROL — the fixture distinguishes the arms', () => {
  it('`close > 103` is false on four bars and true on four', () => {
    expect(C.filter((c) => c > 103).length).toBe(4)
    expect(C.filter((c) => c <= 103).length).toBe(4)
  })
})

describe('A1 — a multi-statement value arm', () => {
  it('⭐ a binding: an OUTER write runs first, the last line is the value', () => {
    const [x, y] = runAll(`${head}var float y = 0.0\nx = if close > 103\n    y := y + 1\n    y * 10\nelse\n    -1\nplot(x)\nplot(y)\n`)
    expect(x).toEqual([-1, -1, -1, -1, 10, 20, 30, 40])
    expect(y).toEqual([0, 0, 0, 0, 1, 2, 3, 4])
  })

  it('⭐ a reassignment `x := if …` with statements in front of the value', () => {
    const out = run(`${head}x = 0.0\nx := if close > 103\n    t = close * 2\n    t + 1\nelse\n    0\nplot(x)\n`)
    expect(out).toEqual(C.map((c) => (c > 103 ? c * 2 + 1 : 0)))
  })

  it('⭐ a function body: a call made for its effect, then the value', () => {
    const out = run(`${head}var a = array.new_float()\nf(c) =>\n    if c\n        array.push(a, close)\n        array.size(a)\n    else\n        -1\nplot(f(close > 103))\n`)
    expect(out).toEqual([-1, -1, -1, -1, 1, 2, 3, 4])
  })

  it('⭐ a `var` in an arm initialises once, on the first bar the arm runs', () => {
    const out = run(`${head}x = if close > 103\n    var k = close\n    k\nelse\n    0\nplot(x)\n`)
    expect(out).toEqual([0, 0, 0, 0, 104, 104, 104, 104])
  })

  it('⭐ a nested chain in an arm yields `na` when nothing in it matches', () => {
    const out = run(`${head}x = if close > 101\n    d = close - 100\n    if d > 5\n        d\nelse\n    0\nplot(x)\n`)
    expect(out.map((v) => (isNa(v) ? 'na' : v))).toEqual([0, 0, 'na', 'na', 'na', 'na', 6, 7])
  })
})

describe('A2 — the last line of a value block binds', () => {
  it('⭐ `:=` as the last line yields the value it wrote', () => {
    const out = run(`${head}var float y = 0.0\nx = if close > 103\n    y := close\nelse\n    -1\nplot(x)\n`)
    expect(out).toEqual(C.map((c) => (c > 103 ? c : -1)))
  })

  it('⭐ a compound assignment as a function\'s last line yields the new value', () => {
    const out = run(`${head}f(x) =>\n    s = x\n    s += 1\nplot(f(close))\n`)
    expect(out).toEqual(C.map((c) => c + 1))
  })

  it('⭐ a pure binding (held as an expression, not a slot) as a function\'s last line', () => {
    const out = run(`${head}f(x) =>\n    y = x * 3\nplot(f(close))\n`)
    expect(out).toEqual(C.map((c) => c * 3))
  })
})

describe('A3 — tuple-valued blocks', () => {
  it('⭐ `[a, b] = if …` unpacks the arm that ran, `na` where it yields `na`', () => {
    const [a, b] = runAll(`${head}[a, b] = if close > 103\n    [close, 1]\nelse\n    [na, 2]\nplot(a)\nplot(b)\n`)
    expect(a.map((v) => (isNa(v) ? 'na' : v))).toEqual(C.map((c) => (c > 103 ? c : 'na')))
    expect(b).toEqual(C.map((c) => (c > 103 ? 1 : 2)))
  })

  it('⭐ `[a, b] = switch` with a block arm', () => {
    const [a, b] = runAll(`${head}[a, b] = switch\n    close > 105 => [1, 2]\n    =>\n        z = close\n        [z, z + 1]\nplot(a)\nplot(b)\n`)
    expect(a).toEqual(C.map((c) => (c > 105 ? 1 : c)))
    expect(b).toEqual(C.map((c) => (c > 105 ? 2 : c + 1)))
  })

  it('⭐ a function whose arms yield tuples, unpacked at the call', () => {
    const [p, q] = runAll(`${head}f(x) =>\n    if x > 103\n        [x, 1.0]\n    else\n        s = x * 2\n        [s, 0.0]\n[p, q] = f(close)\nplot(p)\nplot(q)\n`)
    expect(p).toEqual(C.map((c) => (c > 103 ? c : c * 2)))
    expect(q).toEqual(C.map((c) => (c > 103 ? 1 : 0)))
  })

  it('⭐ a function ending in a destructuring returns that tuple', () => {
    const [p, q] = runAll(`${head}g(x) =>\n    [x, x + 1]\nf(x) =>\n    [m, n] = g(x)\n[p, q] = f(close)\nplot(p)\nplot(q)\n`)
    expect(p).toEqual(C)
    expect(q).toEqual(C.map((c) => c + 1))
  })

  it('⛔ an arm that yields a different count refuses BY NAME at that arm', () => {
    const r = refusalOf(`${head}[a, b] = if close > 103\n    [close, 1]\nelse\n    close\nplot(a)\n`)
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toMatch(/yields 1 value where 2 are read/)
    expect(r.line).toBe(6)
  })
})

describe('A4 — a function body that ends in a block', () => {
  it('⭐ ends in a `switch` whose arm is a block (loops, then the value)', () => {
    const out = run(`${head}eng(src, m) =>\n    switch m\n        "one" => src\n        "avg" =>\n            t = 0.0\n            for i = 0 to 2\n                t += src[i]\n            t / 3\nplot(eng(close, "avg"))\nplot(eng(close, "one"))\n`)
    expect(out.map((v) => (isNa(v) ? 'na' : v))).toEqual(['na', 'na', 101, 102, 103, 104, 105, 106])
  })

  it('⭐ ends in a binding whose value is an `if` (the chain spans the last lines)', () => {
    const out = run(`${head}f(x) =>\n    v = if x > 103\n        1\n    else\n        2\nplot(f(close))\n`)
    expect(out).toEqual(C.map((c) => (c > 103 ? 1 : 2)))
  })
})

describe('A5 — a branch with no value', () => {
  const LOOPY = `f(c) =>\n    var a = array.new_float()\n    if c\n        array.push(a, close)\n    else\n        for i = 0 to 1\n            array.push(a, 0)\n`

  it('⭐ a function whose arm ends in a void call is VALUELESS: a call on its own line runs', () => {
    const out = run(`${head}var a = array.new_float()\nf(c) =>\n    if c\n        array.push(a, close)\n    else\n        array.push(a, 0)\nf(close > 103)\nplot(array.size(a))\n`)
    expect(out).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('⛔ … and READING its result refuses by name at the call site', () => {
    const r = refusalOf(`${head}${LOOPY}x = f(close > 103)\nplot(x)\n`)
    expect(r.guard).toBe('runtime:function')
  })

  it('⛔ a BINDING whose arm ends in a void call refuses by name (its value is read)', () => {
    const r = refusalOf(`${head}var a = array.new_float()\nx = if close > 103\n    array.push(a, close)\nelse\n    0\nplot(x)\n`)
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toMatch(/array\.push.*no value/)
  })
})

describe('A6 — `switch` as a statement', () => {
  it('⭐ the FIRST matching arm runs, and no later one', () => {
    const out = run(`${head}var int n = 0\nswitch\n    close > 105 => n := n + 10\n    close > 102 =>\n        n := n + 1\n    => n := n\nplot(n)\n`)
    expect(out).toEqual([0, 0, 0, 1, 2, 3, 13, 23])
  })

  it('⭐ a subject with cases and a default', () => {
    const out = run(`${head}var float last = na\nm = input.string("b")\nswitch m\n    "a" => last := 1\n    "b" => last := close\n    => last := -1\nplot(last)\n`)
    expect(out).toEqual(C)
  })

  it('⭐⭐ the subject is evaluated ONCE per bar, not once per case tried', () => {
    // `tick()` carries `var` state, so each EVALUATION is observable. Evaluated
    // once, it reads 1, 2, 3, … and the arms are taken in order. Evaluated per
    // case, each comparison would be its own call site counting on its own.
    const out = run(`${head}tick() =>\n    var c = 0\n    c += 1\n    c\nvar float got = na\nswitch tick()\n    1 => got := 10\n    2 => got := 20\n    => got := 30\nplot(got)\n`)
    expect(out).toEqual([10, 20, 30, 30, 30, 30, 30, 30])
  })

  it('⭐ an arm with nothing matching and no default runs nothing', () => {
    const out = run(`${head}var int n = 5\nswitch\n    close > 200 => n := 0\nplot(n)\n`)
    expect(out).toEqual(BARS.map(() => 5))
  })
})

describe('A7 — `var x = if/switch` initialises ONCE', () => {
  it('⭐ the first bar\'s arm is kept on every later bar', () => {
    const [x, y] = runAll(`${head}var x = switch close > 102\n    true => close\n    => -close\nvar y = if close > 103\n    1\nelse\n    close\nplot(x)\nplot(y)\n`)
    expect(x).toEqual(BARS.map(() => -100))
    expect(y).toEqual(BARS.map(() => 100))
  })

  it('⭐ inside a function, once PER CALL SITE', () => {
    const [a, b] = runAll(`${head}f(x) =>\n    var v = if x > 103\n        x\n    else\n        -x\n    v\nplot(f(close))\nplot(f(close + 10))\n`)
    expect(a).toEqual(BARS.map(() => -100))
    expect(b).toEqual(BARS.map(() => 110))
  })
})

describe('A8 — the comma statement separator', () => {
  it('⭐ calls separated by commas all run, left to right', () => {
    const out = run(`${head}var arr = array.new_float()\nif close > 103\n    array.push(arr, close), array.push(arr, 1)\nplot(array.size(arr))\n`)
    expect(out).toEqual([0, 0, 0, 0, 2, 4, 6, 8])
  })

  it('⭐ a reassignment and a call on one line', () => {
    const [a, b] = runAll(`${head}var a = 0\nvar b = 0\nbump(x) =>\n    x + 1\nif close > 103\n    a := bump(a), b := b + 2\nplot(a)\nplot(b)\n`)
    expect(a).toEqual([0, 0, 0, 0, 1, 2, 3, 4])
    expect(b).toEqual([0, 0, 0, 0, 2, 4, 6, 8])
  })

  it('⛔ CONTROL — a generic type list `<string, float>` is not a separator', () => {
    // The lexer folds a type list into its head token (`typeArgs`), so this comma
    // never reaches the splitter at all; the case keeps that true from the outside.
    const r = refusalOf(`${head}m = map.new<string, float>()\nplot(close)\n`)
    expect(r.guard).toBe('runtime:array')
    expect(r.message).toMatch(/map\.new/)
  })

  it('⛔ a comma inside a call or a destructuring is not a separator', () => {
    const [p] = runAll(`${head}g(x) =>\n    [x, x + 1]\n[p, q] = g(math.max(close, 103))\nplot(p)\n`)
    expect(p).toEqual(C.map((c) => Math.max(c, 103)))
  })
})

describe('A9 — the refusal vocabulary', () => {
  it('⛔ no sentence claims a capability is missing that this lane has', () => {
    const stale = /no iteration yet|no call frames yet|no multiple-value form yet|no collections yet|has an effect yet|no multi-way branch yet/
    for (const [guard, sentence] of Object.entries(RUNTIME_REFUSALS)) {
      expect(sentence, guard).not.toMatch(stale)
    }
  })
})
