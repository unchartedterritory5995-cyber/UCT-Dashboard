// app/src/components/chart/engine/runtime/__tests__/iterTrees.test.js
//
// ─── ⭐⭐ THE FRONT-END HALF — A PINE EXPRESSION, EVALUATED PER ROW ──────────
//
// `iterOutputs.test.js` proves the VM can hold a value per iteration. This file
// proves the FRONT END can fill one from real Pine: given an expression and the
// bounds a drawing loops over, it lowers a real loop that writes one slot per
// pass.
//
// ⛔ THE MEASURE IS THE VALUES, NOT THE SHAPE. A lowering that emitted the loop
// and wrote the same slot every pass would satisfy any check that asked whether
// a buffer existed — and would produce the forty-identical-rows failure this
// whole channel was built to prevent.
import { describe, it, expect } from 'vitest'

import { lexPine, parseWholeExpression } from '../../ast/pine.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 4
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t", overlay = true)\n'

/** Parse one Pine expression the way the object pass hands them over. */
const expr = (src) => {
  const { tokens } = lexPine(`//@version=6\nx = ${src}\n`)
  const eq = tokens.findIndex((t) => t.kind === 'punct' && t.value === '=')
  return parseWholeExpression(tokens.slice(eq + 1))
}

const build = (body, specs) => {
  const r = buildRuntimeIr(head + body, {
    bars: BARS,
    inputs: {},
    newestBarIsForming: false,
    objectTrees: [],
    objectIterTrees: specs,
  })
  if (!r.ok) throw new Error(`refused: ${r.refusal.guard} — ${r.refusal.message}`)
  const program = lowerIrProgram(r.ir)
  const run = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  })
  return { r, program, run }
}

describe('⭐⭐ a per-row value lowered from Pine', () => {
  const ARRAY_BODY = 'var a = array.new<float>(4, 0.0)\n'
    + 'array.set(a, 0, 10.0)\n'
    + 'array.set(a, 1, 20.0)\n'
    + 'array.set(a, 2, 30.0)\n'
    + 'array.set(a, 3, 40.0)\n'
    + 'plot(array.size(a))\n'

  const spec = (src, counter = 'r', from = '0', to = '3') => ({
    node: expr(src), counter, from: expr(from), to: expr(to),
  })

  it('⭐⭐ reads a DIFFERENT array element on every pass', () => {
    // The whole point: four rows, four values, none of them repeated. This is
    // the thing a per-BAR tree structurally cannot do.
    const { run } = build(ARRAY_BODY, [spec('array.get(a, r)')])
    expect(Array.from(run.iters[0].slice(0, 4))).toEqual([10, 20, 30, 40])
  })

  it('⭐ the counter composes into an expression, not just an index', () => {
    const { run } = build(ARRAY_BODY, [spec('array.get(a, r) + r')])
    expect(Array.from(run.iters[0].slice(0, 4))).toEqual([10, 21, 32, 43])
  })

  it('⭐⭐ a STRING per row — which is what a watchlist actually holds', () => {
    // ⛔ `array.from`, not `array.new<string>(0)` — the engine REFUSES the
    // latter by name ("what Pine fills a `string` array with has not been
    // measured on a chart"), which is a refusal worth keeping, not working
    // around.
    const body = 'var s = array.from("AAPL", "MSFT")\n'
      + 'plot(array.size(s))\n'
    const { r, run } = build(body, [spec('array.get(s, r)', 'r', '0', '1')])
    expect(r.objectIterTreeKinds).toEqual(['text'])
    expect(run.iters[0].slice(0, 2)).toEqual(['AAPL', 'MSFT'])
  })

  it('⛔ the KIND is decided by this lane, not asserted by the caller', () => {
    // The object pass knows a cell wants text; only this lane knows whether the
    // expression yields one. A buffer allocated as the wrong container coerces
    // everything it holds.
    const { r } = build(ARRAY_BODY, [spec('array.get(a, r)')])
    expect(r.objectIterTreeKinds).toEqual(['num'])
  })

  it('⭐ the BOUNDS are ordinary expressions, evaluated in the outer scope', () => {
    const { run } = build(ARRAY_BODY, [spec('array.get(a, r)', 'r', '1', 'array.size(a) - 2')])
    // rows 1..2 only — slots 0 and 3 are never written.
    expect(run.iters[0][0]).toBeNaN()
    expect(Array.from(run.iters[0].slice(1, 3))).toEqual([20, 30])
    expect(run.iters[0][3]).toBeNaN()
  })

  it('⛔⛔ a BOUND that names the counter reads the OUTER binding', () => {
    // `for a = 0 to array.size(a) - 1` is legal Pine and the corpus writes it:
    // the bound's `a` is the ARRAY, the counter's `a` is the loop variable.
    // ⚰️ A mutation lowering the bounds in the INNER scope stayed green against
    // every other case here, because none of their bounds named the counter —
    // and it is the only shape that can tell the two scopes apart. Lowered
    // inside, `array.size(a)` would read the counter's uninitialised slot.
    const { run } = build(ARRAY_BODY, [spec('a * 10', 'a', '0', 'array.size(a) - 1')])
    expect(Array.from(run.iters[0].slice(0, 4))).toEqual([0, 10, 20, 30])
  })

  it('⛔ TWO specs get TWO buffers, never one shared', () => {
    const { run } = build(ARRAY_BODY, [
      spec('array.get(a, r)'),
      spec('array.get(a, r) * 2'),
    ])
    expect(run.iters.length).toBe(2)
    expect(Array.from(run.iters[0].slice(0, 4))).toEqual([10, 20, 30, 40])
    expect(Array.from(run.iters[1].slice(0, 4))).toEqual([20, 40, 60, 80])
  })

  it('⛔ the counter does NOT outlive its loop', () => {
    // `r` must not be visible to a later statement, or a second spec reusing the
    // name would read the previous loop's final value instead of its own.
    const { run } = build(ARRAY_BODY, [
      spec('array.get(a, r)'),
      spec('r', 'r', '5', '5'),
    ])
    expect(run.iters[1][5]).toBe(5)
  })

  it('⛔ CONTROL — with no specs the program declares no buffers', () => {
    const { run } = build(ARRAY_BODY, [])
    expect(run.iters).toEqual([])
  })
})
