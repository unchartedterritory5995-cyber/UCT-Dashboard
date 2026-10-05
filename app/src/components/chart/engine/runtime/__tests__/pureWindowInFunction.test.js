// app/src/components/chart/engine/runtime/__tests__/pureWindowInFunction.test.js
//
// ─── ⭐⭐ RT3 — A WINDOW OVER A PRICE SERIES, SIZED BY A FUNCTION PARAMETER ─────
//
// `f(int len) => ta.highest(high, len)` refused `runtime:function-global-state`
// — "a function body reading a mutable GLOBAL — `high`". `high` is a price
// series, not a mutable global: the call reached the runtime path only because
// its LENGTH is a frame slot. RT3 (`pineRuntimeFrontend.js`, the window arm):
// when the SOURCE is one the columnar lane holds (nothing in it reads a slot)
// and the LENGTH folds for the call site (C35's `frameConsts`), the call is the
// columnar lane's own column — exactly what the same call with the number
// pasted in computes. A length still waiting on a call site refuses carrying the
// parameter (so the call site specialises); a length only known while the bar
// runs says so; a source that reads runtime state keeps the old path.
//
// Graded against the pasted-constant spelling of the same Pine — argued from
// C35's rule (a `simple` argument is fixed per call site), which the vendor
// harness already witnesses (`vendorHarness.c35SimpleArg`).

import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 30
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 50 + i, h: 55 + i + ((i * 7) % 5), l: 45 + i - ((i * 3) % 4), c: 50 + i + (i % 3), v: 100 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const HEAD = '//@version=5\nindicator("t")\n'

const build = (body) => buildRuntimeIr(`${HEAD}${body}`, { bars: BARS, inputs: {} })
const run = (body) => {
  const built = build(body)
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  return execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true }).outputs.map((o) => Array.from(o))
}
const refusalOf = (body) => {
  const b = build(body)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

describe('⭐ admitted: the call site fixes the length, the columnar lane computes it', () => {
  it('two call sites, two lengths, each equal to its pasted spelling', () => {
    const [a, b] = run('f(int len) => ta.highest(high, len)\nplot(f(3))\nplot(f(7))\n')
    const [ra, rb] = run('plot(ta.highest(high, 3))\nplot(ta.highest(high, 7))\n')
    expect(a).toEqual(ra)
    expect(b).toEqual(rb)
    expect(a).not.toEqual(b) // non-vacuity: the two sites are two windows
  })

  it('a length DERIVED from parameters (`l + r + 1`) and a `bars` builtin', () => {
    const [a] = run('f(int l, int r) => ta.highestbars(high, l + r + 1)\nplot(f(2, 2))\n')
    const [ra] = run('plot(ta.highestbars(high, 5))\n')
    expect(a).toEqual(ra)
    expect(a.some((v) => v < 0)).toBe(true) // non-vacuity: a real bars offset
  })

  it('the one-argument short form inside a function', () => {
    const [a] = run('f(int len) => ta.lowest(len)\nplot(f(4))\n')
    const [ra] = run('plot(ta.lowest(low, 4))\n')
    expect(a).toEqual(ra)
  })
})

describe('⛔ unchanged where the source or the length is runtime state', () => {
  it('a PARAMETER source named like a top-level value is the parameter, never the global', () => {
    // `src` is a parameter: the old path (a window over the parameter's ring)
    // serves it, and it must be `high`'s window, not the top-level `src`'s.
    const [a] = run('src = close\nf(src, int len) => ta.highest(src, len)\nplot(f(high, 3))\n')
    const [ra] = run('plot(ta.highest(high, 3))\n')
    expect(a).toEqual(ra)
  })

  it('a length only known while the bar runs says so, by name — not "a mutable GLOBAL"', () => {
    const r = refusalOf('f() =>\n    var int k = 1\n    k := k + 1\n    ta.highest(high, k)\nplot(f())\n')
    expect(r.guard).toBe('runtime:history-dynamic-offset')
    expect(r.message).not.toMatch(/mutable GLOBAL/)
    // a length the function reads from the main program, changing every bar
    const g = refusalOf('var int k = 1\nk := k % 3 + 2\nf() => ta.highest(high, k)\nplot(f())\n')
    expect(g.guard).toBe('runtime:history-dynamic-offset')
    expect(g.message).toMatch(/only known while the bar is running/)
  })

  it('a mutable GLOBAL source is still refused as one', () => {
    const r = refusalOf('var float g = 0.0\ng := close\nf(int len) => ta.highest(g, len)\nplot(f(3))\n')
    expect(r.guard).toBe('runtime:function-global-state')
  })
})
