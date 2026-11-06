// W6-T2: `method` is a keyword only in the shape `method <ident>` and only from Pine v5.
// https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/
// NOT CLAIMED (no committed capture): spec item 2 (a parameter named like a namespace, then
// `timeframe.period`). The runtime lane already serves that shape; the host resolver still refuses
// it as `pine:type`. TradingView's answer is uncaptured, so this task changes neither.
// `enum =` has no statement arm in this front end: nothing to fix.
import { describe, it, expect } from 'vitest'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 8
const BARS = Array.from({ length: N }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100, h: 102 + i, l: 98, c: 100 + i, v: 1000 }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const build = (v, src) => buildRuntimeIr(`//@version=${v}\nindicator("t")\n${src}`, { bars: BARS, inputs: {} })
const out0 = (v, src) => {
  const b = build(v, src)
  expect(b.ok, b.ok ? '' : `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
  const p = lowerIrProgram(b.ir)
  return Array.from(execute(p, { bars: N, series: SERIES, columns: p.columns, confirmed: true, barTimes: BARS.map((x) => x.t) }).outputs[0])
}

describe('W6-T2 method as a name', () => {
  it('v3 `method = 3` binds and reads', () => {
    expect(out0(3, 'method = 3\nplot(close + method)')).toEqual(BARS.map((b) => b.c + 3))
  })
  it('v4 `method := ` reassigns and reads', () => {
    expect(out0(4, 'method = 1\nmethod := method + 2\nplot(close + method)')).toEqual(BARS.map((b) => b.c + 3))
  })
  it('v6 `method m(float x) =>` still binds as a method', () => {
    expect(out0(6, 'type Q\n    float n\nmethod bump(Q q) => q.n + 1\nq = Q.new(close)\nplot(q.bump())')).toEqual(BARS.map((b) => b.c + 1))
  })
  it('v5 `method = 3` still refuses by name (keyword, uncaptured)', () => {
    const b = build(5, 'method = 3\nplot(close + method)')
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:udt-method')
  })
  it('user function and namespaced forms are untouched', () => {
    expect(out0(5, 'f(x) => x + 1\nplot(f(close) + ta.sma(close, 1))')).toEqual(BARS.map((b) => b.c * 2 + 1))
  })
  it('v4 held function calling `method` with history still refuses runtime:conditional-history', () => {
    const src = `method(x) => x - x[1]
g(s, n) => n > 0 ? method(s) : s
up = close > open
y = up ? g(close, 2) : close
plot(y)`
    const b = build(4, src)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:conditional-history')
    // control: the same script with the function renamed refuses identically
    const c = build(4, src.replace(/method/g, 'mm'))
    expect(c.ok).toBe(false)
    expect(c.refusal.guard).toBe('runtime:conditional-history')
  })
  it('v4 `method f(x) =>` (declaration shape) is never read as a name', () => {
    const b = build(4, `method f(x) => x + 1
plot(f(close))`)
    expect(b.ok === true || b.refusal.guard === 'runtime:udt-method').toBe(true)
    expect(b.ok ? 'declared' : 'refused').toBe('declared')
  })
})
