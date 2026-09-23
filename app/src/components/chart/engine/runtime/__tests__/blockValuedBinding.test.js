// app/src/components/chart/engine/runtime/__tests__/blockValuedBinding.test.js
//
// ─── ⭐⭐ `x = if …` AND `x = switch …` — A BLOCK IN VALUE POSITION ─────────
//
// In Pine, `if` and `switch` are EXPRESSIONS: the block yields the last value of
// the branch it takes, and `na` when no branch is taken. This engine refused the
// whole family at `pine:block` — *"a Pine block spans several statements and
// this engine stores a single expression"* — which is a true sentence about the
// columnar value model and was being said about the RUNTIME lane, which has
// statements, slots and an `ifStmt` node and needs none of that restriction.
//
// ⭐ MEASURED: `pine:block` is the largest addressable row in the object-lane
// census at 22 scripts, and reading the call sites splits it cleanly —
// **13 die in the RUNTIME lane**, and 11 of those are exactly this shape
// (7 `x = switch`, 4 `x = if`). The other 7 are `for` loops inside functions and
// 2 are the object pass; both are different jobs and are not served here.
//
// ⛔⛔ AND THE RUNTIME LANE CAN BE MORE CORRECT THAN THE COLUMNAR ONE HERE.
// `foldIfChain` only yields a value when the chain HAS AN ELSE, because a
// ternary must have both sides. Pine has no such rule: `x = if cond` with no
// else is ordinary and yields `na` when the condition is false. The corpus's
// own first example is exactly that —
//
//     impDownWick = if impDown
//         high - open
//
// — so a lowering that required an else would refuse the commonest form of the
// construct. A slot initialised to `na` and assigned only inside a matching arm
// IS Pine's semantics, structurally.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 24
// close runs 100..123, so a threshold picks a contiguous tail of bars.
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 102 + i, l: 98 + i, c: 100 + i, v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'

function build(src) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  return built
}
function runPine(src) {
  const program = lowerIrProgram(build(src).ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return Array.from(r.outputs[0])
}
const refusalOf = (src) => {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

describe('⭐⭐ `x = if …` — an if in value position', () => {
  it('⭐⭐ NO ELSE: the value is the branch when taken, and `na` when not', () => {
    // ⚰️ THE CORPUS'S OWN SHAPE, from `atr-support-and-resistance` L24. The
    // columnar folder cannot value this at all — it needs an else to build a
    // ternary — so requiring one here would have refused the commonest form.
    const out = runPine(`${head}x = if close > 110\n    close - open\nplot(x)\n`)
    for (let i = 0; i < N; i += 1) {
      const { c, o } = BARS[i]
      if (c > 110) expect(out[i], `bar ${i}`).toBe(c - o)
      else expect(Number.isNaN(out[i]), `bar ${i} should be na, got ${out[i]}`).toBe(true)
    }
    // ⛔ CONTROL — the fixture must exercise BOTH sides, or it proves one.
    expect(out.some((v) => Number.isNaN(v)), 'no bar took the na path').toBe(true)
    expect(out.some((v) => !Number.isNaN(v)), 'no bar took the value path').toBe(true)
  })

  it('⭐⭐ an else-if CHAIN with no final else — the `cppivot` shape', () => {
    // Four arms, no bare `else`: unmatched bars are `na`.
    const out = runPine(`${head}x = if close > 118\n    1\nelse if close > 112\n`
      + `    2\nelse if close > 106\n    3\nplot(x)\n`)
    for (let i = 0; i < N; i += 1) {
      const c = BARS[i].c
      const want = c > 118 ? 1 : c > 112 ? 2 : c > 106 ? 3 : null
      if (want === null) expect(Number.isNaN(out[i]), `bar ${i} should be na`).toBe(true)
      else expect(out[i], `bar ${i} (close ${c})`).toBe(want)
    }
    // ⛔ all four outcomes must occur, or an arm is untested
    expect(new Set(out.map((v) => (Number.isNaN(v) ? 'na' : v))).size).toBe(4)
  })

  it('⭐ a final else is honoured like any other arm', () => {
    const out = runPine(`${head}x = if close > 115\n    1\nelse\n    2\nplot(x)\n`)
    for (let i = 0; i < N; i += 1) expect(out[i]).toBe(BARS[i].c > 115 ? 1 : 2)
    expect(new Set(out).size).toBe(2)
  })

  it('⛔ a later arm is NOT evaluated once an earlier one matches', () => {
    // ⭐ Nested ifs, never a flattened condition — the same invariant the bare
    // `if` chain states. A division by zero in a later arm must never run on a
    // bar the first arm already claimed.
    const out = runPine(`${head}x = if close > 110\n    1\nelse\n    close / (close - close)\nplot(x)\n`)
    for (let i = 0; i < N; i += 1) {
      if (BARS[i].c > 110) expect(out[i], `bar ${i}`).toBe(1)
    }
  })
})

describe('⭐⭐ `x = switch …` — a switch in value position', () => {
  it('⭐⭐ literal arms and a bare `=>` default — the `multicator` shape', () => {
    const src = `${head}mode = input.string("B", "m", options = ["A", "B", "C"])\n`
      + 'x = switch mode\n    "A" => 1\n    "B" => 2\n    => 9\nplot(x)\n'
    const out = runPine(src)
    for (let i = 0; i < N; i += 1) expect(out[i], `bar ${i}`).toBe(2)
  })

  it('⭐ the bare `=>` arm is the DEFAULT, not a case', () => {
    const src = `${head}mode = input.string("Z", "m", options = ["A", "Z"])\n`
      + 'x = switch mode\n    "A" => 1\n    => 9\nplot(x)\n'
    expect(new Set(runPine(src))).toEqual(new Set([9]))
  })

  it('⛔ no matching arm and NO default is `na`, not a wrong arm', () => {
    // ⚰️ The dangerous failure here is picking the first arm, or the last, when
    // nothing matches — a confident wrong number rather than an absent one.
    const src = `${head}mode = input.string("Z", "m", options = ["A", "Z"])\n`
      + 'x = switch mode\n    "A" => 1\n    "B" => 2\nplot(x)\n'
    const out = runPine(src)
    expect(out.every((v) => Number.isNaN(v)), `expected all na, got ${out[0]}`).toBe(true)
  })

  it('⭐ a switch on a SERIES subject branches per bar, not once', () => {
    // ⛔ THE CASE THAT SEPARATES A REAL LOWERING FROM A CONSTANT FOLD. The
    // columnar lane reduces a switch by folding its subject; a subject that
    // moves bar to bar cannot be folded and must branch at runtime.
    const out = runPine(`${head}x = switch\n    close > 115 => 1\n    close > 105 => 2\n    => 3\nplot(x)\n`)
    for (let i = 0; i < N; i += 1) {
      const c = BARS[i].c
      expect(out[i], `bar ${i} (close ${c})`).toBe(c > 115 ? 1 : c > 105 ? 2 : 3)
    }
    expect(new Set(out).size).toBe(3)
  })
})

describe('⛔ the bounds of what is served, stated rather than implied', () => {
  it('⛔ CONTROL — a BARE `if` statement still lowers exactly as before', () => {
    // ⭐ NON-REGRESSION. The new arm must key off the RHS of a binding, never
    // off the keyword alone, or it swallows the statement form.
    const out = runPine(`${head}var x = 0.0\nif close > 115\n    x := 1\nelse\n    x := 2\nplot(x)\n`)
    for (let i = 0; i < N; i += 1) expect(out[i]).toBe(BARS[i].c > 115 ? 1 : 2)
  })

  it('⛔ an arm whose body is EMPTY refuses by name', () => {
    // A block with no value is not a value, and saying so beats inventing `na`
    // for a script that is probably mistyped.
    const r = refusalOf(`${head}x = if close > 110\nplot(x)\n`)
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toContain('no value')
  })

  it('⛔ a MULTI-STATEMENT arm body refuses by name, and names the shape', () => {
    // ⚠️ NOT SERVED ON PURPOSE, and the refusal says which part is the problem.
    // Every one of the 11 corpus scripts on this row has single-expression arms;
    // serving the general case means deciding what a mid-arm assignment does to
    // an outer name, which is `foldIfChain`'s whole `touched` loop and belongs
    // in its own measurement.
    const r = refusalOf(`${head}var y = 0.0\nx = if close > 110\n    y := 1\n    y + 1\nplot(x)\n`)
    expect(r.guard).toBe('runtime:block-value')
    expect(r.message).toMatch(/one expression|single/i)
  })
})
