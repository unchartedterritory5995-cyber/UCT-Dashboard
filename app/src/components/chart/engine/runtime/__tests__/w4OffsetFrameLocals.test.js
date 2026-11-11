// app/src/components/chart/engine/runtime/__tests__/w4OffsetFrameLocals.test.js
//
// ─── ⭐⭐ W4-T9 — AN OFFSET BOUNDED BY A FRAME PARAMETER, THROUGH A LOCAL ────
//
// `x[j]` over a `for` counter is sized when the counter's bound is fixed before
// bar 0 (RT3). A function body usually writes that bound as a LOCAL derived from
// its parameter (`periods = length - 1` ... `for j = 0 to periods`). The bound
// is then bounded by `length`, which each CALL SITE fixes, so the body is
// compiled once per call site (C35). The local used to be named as the culprit,
// which is no parameter, so no call site could settle it and the body refused.
//   https://www.tradingview.com/pine-script-docs/language/operators/#history-referencing-operator
//
// Every number is graded against the closed-table builtin over the same series,
// or the same function spelled with the bound written inline.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 24
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100, h: 110 + i, l: 90, c: 100 + i * i * 0.5 + (i % 3), v: 1000 + 37 * i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'

const build = (src, inputs = {}) => buildRuntimeIr(src, { bars: BARS, inputs })
function run(src, inputs = {}) {
  const built = build(src, inputs)
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return r.outputs.map((o) => Array.from(o))
}
const same = (a, b) => a.length === b.length
  && a.every((v, i) => (Number.isNaN(v) ? Number.isNaN(b[i]) : Math.abs(v - b[i]) <= 1e-9 * Math.max(1, Math.abs(b[i]))))
const refusal = (src) => {
  const b = build(src)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

// `decl` is written in the body before the loop; `bound` is the loop's `to`
const fn = (decl, bound) => `f(src, length) =>\n    s = 0.0\n${decl}    for j = 0 to ${bound}\n`
  + '        s += src[j]\n    s / length\n'
const two = (decl, bound, a = 3, b = 7) => `${head}${fn(decl, bound)}plot(f(close, ${a}))\nplot(f(close, ${b}))\n`
const ref = (a = 3, b = 7) => `${head}plot(ta.sma(close, ${a}))\nplot(ta.sma(close, ${b}))\n`

describe('⭐⭐ admitted: a local derived from the parameter bounds the loop, per call site', () => {
  it('`periods = length - 1` at two call sites with different lengths', () => {
    const [a, b] = run(two('    periods = length - 1\n', 'periods'))
    const [ra, rb] = run(ref())
    expect(same(a, ra)).toBe(true)
    expect(same(b, rb)).toBe(true)
    expect(same(a, b)).toBe(false) // non-vacuity: two rings, two answers
    expect(a.filter((v) => !Number.isNaN(v)).length).toBe(N - 2)
  })

  it('a chain of locals (`p0 = length - 1`, `periods = p0 * 1`) and a conditional value', () => {
    const [a, b] = run(two('    p0 = length - 1\n    periods = p0 * 1\n', 'periods'))
    const [ra, rb] = run(ref())
    expect(same(a, ra)).toBe(true)
    expect(same(b, rb)).toBe(true)
    const [c] = run(two('    periods = length > 2 ? length - 1 : 0\n', 'periods'))
    expect(same(c, ra)).toBe(true)
  })

  it('equals the same function with the bound written inline', () => {
    const [a, b] = run(two('    periods = length - 1\n', 'periods'))
    const [ia, ib] = run(two('', 'length - 1'))
    expect(same(a, ia)).toBe(true)
    expect(same(b, ib)).toBe(true)
  })

  it('the local sizes a direct offset too (`src[periods]`, one call site)', () => {
    // two call sites of a DIRECT parameter offset stop at the history plan, with or
    // without a local (`src[length - 1]` does too on master): not this lane's wall.
    const src = `${head}g(src, length) =>
    periods = length - 1
    src[periods]
plot(g(close, 7))
`
    const [a] = run(src)
    const [ra] = run(`${head}plot(close[6])
`)
    expect(same(a, ra)).toBe(true)
  })

  it('the local sizes a window length too (`ta.sma(src, n)`, `n = length * 2`)', () => {
    const src = `${head}h(src, length) =>\n    n = length * 2\n    ta.sma(src, n)\nplot(h(close, 2))\nplot(h(close, 3))\n`
    const [a, b] = run(src)
    const [ra, rb] = run(`${head}plot(ta.sma(close, 4))\nplot(ta.sma(close, 6))\n`)
    expect(same(a, ra)).toBe(true)
    expect(same(b, rb)).toBe(true)
  })

  it('a name the body redeclares in a nested block does not change what the local was bound to', () => {
    // `periods` was bound from the PARAMETER `length`; the inner `length` is another slot.
    const body = 'f(src, length) =>\n    periods = length - 1\n    s = 0.0\n    if close > 0\n        length = 2\n        length += 0\n'
      + '        for j = 0 to periods\n            s += src[j]\n    s\n'
    const [a, b] = run(`${head}${body}plot(f(close, 3))\nplot(f(close, 7))\n`)
    const [ra, rb] = run(`${head}plot(ta.sma(close, 3) * 3)\nplot(ta.sma(close, 7) * 7)\n`)
    expect(same(a, ra)).toBe(true)
    expect(same(b, rb)).toBe(true)
  })

  it('a length from a `simple` input (T2) fixes the call site, through the local', () => {
    const src = `${head}L = input.int(5, "L")\n${fn('    periods = length - 1\n', 'periods')}plot(f(close, L))\n`
    const [a] = run(src)
    const [ra] = run(`${head}plot(ta.sma(close, 5))\n`)
    expect(same(a, ra)).toBe(true)
  })
})

describe('⛔ still refused, by name: what the call site cannot fix', () => {
  it.each([
    ['a `var` local', '    var periods = length - 1\n'],
    ['a local the body reassigns', '    periods = length - 1\n    periods := periods + 1\n'],
    ['a division (T17)', '    periods = math.floor((length - 1) / 2)\n'],
    ['a remainder (T17)', '    periods = length % 4\n'],
    ['a local only known while the bar runs', '    periods = bar_index % 4\n'],
    ['a local read from a series', '    periods = int(close) % 3\n'],
  ])('%s', (_, decl) => {
    expect(refusal(two(decl, 'periods')).guard).toBe('runtime:history-dynamic-offset')
  })

  it('a call site whose length is only known while the bar runs', () => {
    const src = `${head}${fn('    periods = length - 1\n', 'periods')}plot(f(close, bar_index % 5 + 2))\n`
    expect(refusal(src).guard).toBe('runtime:history-dynamic-offset')
  })

  it('the offset `src[zxLag]` with `zxLag = math.floor((len - 1) / 2)` stays refused', () => {
    const src = `${head}g(src, len) =>\n    zxLag = math.floor((len - 1) / 2)\n    src[zxLag]\nplot(g(close, 7))\n`
    expect(refusal(src).guard).toBe('runtime:history-dynamic-offset')
  })

  it('control: the same bodies with the hole removed compile', () => {
    expect(() => run(two('    periods = 4\n', 'periods'))).not.toThrow()
    expect(() => run(two('', 'length - 1'))).not.toThrow()
  })
})
