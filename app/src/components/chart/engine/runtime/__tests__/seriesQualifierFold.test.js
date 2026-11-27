// app/src/components/chart/engine/runtime/__tests__/seriesQualifierFold.test.js
//
// ─── ⭐⭐ M-D — A DECLARED `series` QUALIFIER IS AN UPPER BOUND ─────────────────────────────────────────────
//
// A parameter declared `series` accepts a value fixed for the whole run. At a call site that passes one, the parameter
// IS that value on every bar, so the call site's copy answers it as a constant, as it does an unqualified parameter.
// Before M-D every such call was refused: `ta.checkLTF(series string lowerTimeframe)` (TradingView/ta/10 and ta/12,
// reached by the CVD / Volume Delta built-ins and two community scripts) was reported as "declared `series` ... sizes a
// window there", though no window is there: it only measures a timeframe with `timeframe.in_seconds`.
// And `timeframe.main_period` (the ta library's other half of that test) is the chart's own timeframe wherever this
// lane reads it: outside a request's value, in a script `indicator(timeframe = …)` does not move (that is refused).
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 102 + i + (i % 3), l: 98 + i - (i % 4), c: 100 + Math.sin(i / 2.3) * 12 + i * 0.7, v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const HEAD = '//@version=6\nindicator("t")\n'
const build = (src) => buildRuntimeIr(HEAD + src, { bars: BARS, inputs: {} })
function run(src) {
  const b = build(src)
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  const p = lowerIrProgram(b.ir)
  return execute(p, { bars: N, series: SERIES, columns: p.columns, confirmed: true }).outputs.map((o) => Array.from(o))
}
const sameAs = (a, b) => {
  const x = run(a)
  const y = run(b)
  expect(x.length).toBe(y.length)
  let finite = 0
  for (let k = 0; k < y.length; k += 1) {
    for (let i = 0; i < N; i += 1) {
      if (Number.isNaN(y[k][i])) expect(Number.isNaN(x[k][i]), `plot ${k} bar ${i} na`).toBe(true)
      else { expect(x[k][i], `plot ${k} bar ${i}`).toBeCloseTo(y[k][i], 9); finite += 1 }
    }
  }
  expect(finite).toBeGreaterThan(N / 2)
}
const refusal = (src) => {
  const b = build(src)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}
const CHECK = 'checkLTF(series string lowerTimeframe) =>\n'
  + '    if timeframe.in_seconds(lowerTimeframe) > timeframe.in_seconds(timeframe.main_period)\n'
  + '        runtime.error("Invalid lower timeframe")\n'

describe('⭐⭐ M-D: a `series` parameter given a value fixed for the run is that value', () => {
  it('`series string` at an input.timeframe: timeframe.in_seconds reads it as the unqualified parameter does', () => {
    sameAs('g(series string lt) =>\n    timeframe.in_seconds(lt)\ntf = input.timeframe("60", "ltf")\nplot(g(tf))\n',
      'g(string lt) =>\n    timeframe.in_seconds(lt)\ntf = input.timeframe("60", "ltf")\nplot(g(tf))\n')
  })
  it('the ta.checkLTF shape, through a caller whose own parameter is `series` too, builds and draws', () => {
    sameAs(`${CHECK}f(series string ltf) =>\n    checkLTF(ltf)\n    close\ntf = input.timeframe("60", "ltf")\nplot(f(tf))\n`,
      'plot(close)\n')
  })
  it('`series int` at a literal: ta.ema(src, n) is ta.ema(src, 5) (master said "`n` is passed a value read on every bar")', () => {
    sameAs('f(src, series int n) => ta.ema(src, n)\nplot(f(close, 5))\n', 'plot(ta.ema(close, 5))\n')
  })
})

describe('⭐ M-D: timeframe.main_period is the chart\'s own timeframe where this lane reads it', () => {
  it('timeframe.in_seconds(timeframe.main_period) equals timeframe.in_seconds(timeframe.period)', () => {
    sameAs('plot(timeframe.in_seconds(timeframe.main_period))\n', 'plot(timeframe.in_seconds(timeframe.period))\n')
  })
})

describe('⛔ M-D: a value read per bar keeps its refusal, and says what the parameter does', () => {
  it('a per-bar text for a `series string` timeframe: refused, naming the timeframe, not a window or a ring', () => {
    const r = refusal('g(series string lt) =>\n    timeframe.in_seconds(lt)\nplot(g(close > open ? "60" : "D"))\n')
    expect(r.guard).toBe('runtime:history-dynamic-offset')
    expect(r.message).toMatch(/`lt` is the timeframe `timeframe\.in_seconds` measures in `g`/)
    expect(r.message).not.toMatch(/sizes a window/)
  })
})
