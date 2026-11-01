// app/src/components/chart/engine/runtime/__tests__/conditionalReviewFollowups.test.js
//
// ─── WS-C (Phase 3) review follow-ups, each reproduced first ─────────────────
//
//   H1  a parameter-SPECIALISED (held, C35) function in a `?:` arm / on the right
//       of v6 `and` was served every bar: its held body has no compiled flags.
//   H2  a function whose only state is a `var` in a `?:` arm was served every bar.
//   M1  `(expr)[k]` in a block was every-bar history; the `?:` route refused it.
//   M2  a dynamic offset in a pure subtree became one column and passed Pine's
//       history buffer without the VM stop (declared `max_bars_back`, or a chart
//       longer than 5,000 bars).
//   M3  v4 `iff(c, sma(close, 3), 0)` was served every bar; `?:` is refused.
//   L3  `ta.sma(source = close, length = 3)` in a block is the positional call.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const mkBars = (n) => Array.from({ length: n }, (_, i) => ({
  t: 1600000000 + i * 86400, o: 100 + (i % 7), h: 104 + (i % 5), l: 96 - (i % 3), c: 100 + ((i * 37) % 11), v: 1000 + i,
}))
const BARS = mkBars(60)
const seriesOf = (bars) => ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
const built = (src, bars = BARS) => buildRuntimeIr(src, { bars, inputs: {} })
const refusalOf = (src, bars) => { const b = built(src, bars); return b.ok ? null : b.refusal }
function run(src, bars = BARS) {
  const b = built(src, bars)
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  const program = lowerIrProgram(b.ir)
  return execute(program, { bars: bars.length, series: seriesOf(bars), columns: program.columns, confirmed: true })
    .outputs.map((o) => Array.from(o))
}
const v6 = (body) => `//@version=6\nindicator("t")\n${body}`
const R4 = 'runtime:conditional-history'

describe('H1 — a held (parameter-specialised) function in an arm', () => {
  const fn = 'f(mode) =>\n    float base = na\n    if mode == "ATR"\n        base := ta.atr(3)\n    else\n        base := high - low\n    nz(base)\n'
  it('is refused in a `?:` arm, with a literal or an input argument, and on the right of v6 `and`', () => {
    for (const tail of [
      'y = close > open ? f("ATR") : 0.0\nplot(y)\n',
      'm = input.string("ATR", "m")\ny = close > open ? f(m) : 0.0\nplot(y)\n',
      'plot(close > open and f("ATR") > 1 ? 1 : 0)\n',
    ]) {
      const r = refusalOf(v6(fn + tail))
      expect(r && r.guard, tail).toBe(R4)
    }
  })
  it('CONTROL: called on every bar it is still served', () => {
    expect(refusalOf(v6(`${fn}plot(f("ATR"))\n`))).toBeNull()
  })
  it('CONTROL: a held function with NO history in its body is served in an arm (its source is read, not guessed)', () => {
    const pure = 'g(mode) =>\n    float r = na\n    if mode == "A"\n        r := close\n    else\n        r := open\n    r\n'
    const sw = 'h(mode) =>\n    switch mode\n        "A" => close\n        => open\n'
    for (const src of [`${pure}plot(close > open ? g("A") : 0.0)\n`, `${sw}plot(close > open ? h("A") : 0.0)\n`]) {
      const b = built(v6(src))
      if (!b.ok) expect(b.refusal.guard, src).not.toBe(R4)
    }
  })
})

describe('H2 — a function whose state is a `var`, in an arm', () => {
  it('a counter and an accumulator are refused in `?:` and on the right of v6 `and`', () => {
    for (const src of [
      'f() =>\n    var float c = 0.0\n    c += 1\n    c\ny = close > open ? f() : 0.0\nplot(y)\n',
      'g(x) =>\n    var float s = 0.0\n    s := s + x\n    s\nplot(close > open ? g(close) : 0.0)\n',
      'f() =>\n    var float c = 0.0\n    c += 1\n    c > 3\nplot(close > open and f() ? 1 : 0)\n',
    ]) {
      const r = refusalOf(v6(src))
      expect(r && r.guard, src).toBe(R4)
    }
  })
  it('CONTROL: a pure function in an arm is served', () => {
    expect(refusalOf(v6('h(x) =>\n    x * 2\nplot(close > open ? h(close) : 0.0)\n'))).toBeNull()
  })
})

describe('M1 — `(expr)[k]` in a block', () => {
  it('is refused by name, as the `?:` route refuses it', () => {
    const r = refusalOf(v6('float y = na\nif close > open\n    y := (close + open)[1]\nplot(y)\n'))
    expect(r && r.guard).toBe(R4)
    const a = refusalOf(v6('plot(close > open ? (close + open)[1] : 0.0)\n'))
    expect(a && a.guard).toBe(R4)
  })
  it('CONTROL: at the root it is served, and a chart series\' `[1]` in a block is the chart\'s', () => {
    expect(refusalOf(v6('plot((close + open)[1])\n'))).toBeNull()
    expect(refusalOf(v6('float y = na\nif close > open\n    y := close[1]\nplot(y)\n'))).toBeNull()
  })
})

describe('M2 — a dynamic offset in a pure subtree meets the buffer stop', () => {
  const LONG = mkBars(5100)
  it('past a DECLARED buffer: the run stops (it was served)', () => {
    const src = '//@version=6\nindicator("t", max_bars_back = 20)\nplot(close[bar_index % 30])\n'
    expect(() => run(src, LONG)).toThrow(/history buffer of 20 bars/)
  })
  it('past 5,000 on a longer chart: the run stops (it answered `na`)', () => {
    expect(() => run(v6('plot(close[bar_index])\n'), LONG)).toThrow(/history buffer of 5000 bars/)
  })
  it('CONTROL: within the buffer the column answer is unchanged', () => {
    const src = '//@version=6\nindicator("t", max_bars_back = 20)\nplot(close[bar_index % 10])\n'
    const [y] = run(src, LONG)
    LONG.forEach((b, i) => { const k = i % 10; expect(y[i]).toBe(i - k >= 0 ? LONG[i - k].c : NaN) })
    const [z] = run(v6('plot(close[bar_index % 3])\n'))
    BARS.forEach((b, i) => { const k = i % 3; expect(z[i]).toBe(i - k >= 0 ? BARS[i - k].c : NaN) })
  })
})

describe('M3 — v4 `iff` with history in an argument', () => {
  const v4 = (body) => `//@version=4\nstudy("t")\n${body}`
  it('is refused by name (laziness of `iff` is not witnessed)', () => {
    const r = refusalOf(v4('plot(iff(close > open, sma(close, 3), 0))\n'))
    expect(r && r.guard).toBe(R4)
    expect(r.message).toMatch(/argument of `iff`/)
  })
  it('CONTROL: an `iff` over pure values, or on an input, is served', () => {
    expect(refusalOf(v4('plot(iff(close > open, close, open))\n'))).toBeNull()
    expect(refusalOf(v4('m = input(true)\nplot(iff(m, sma(close, 3), 0))\n'))).toBeNull()
  })
})

describe('L3 — named arguments to a served call in a block', () => {
  it('`ta.sma(source = close, length = 3)` equals the positional call', () => {
    const pos = run(v6('float y = na\nif close > open\n    y := ta.sma(close, 3)\nplot(y)\n'))[0]
    const nam = run(v6('float y = na\nif close > open\n    y := ta.sma(source = close, length = 3)\nplot(y)\n'))[0]
    const mix = run(v6('float y = na\nif close > open\n    y := ta.ema(close, length = 3)\nplot(y)\n'))[0]
    const emaPos = run(v6('float y = na\nif close > open\n    y := ta.ema(close, 3)\nplot(y)\n'))[0]
    expect(nam).toEqual(pos)
    expect(mix).toEqual(emaPos)
  })
  it('an unknown name is still refused', () => {
    const r = refusalOf(v6('float y = na\nif close > open\n    y := ta.sma(src = close, length = 3)\nplot(y)\n'))
    expect(r).not.toBeNull()
  })
})

describe('H1b — the held-body scan is an ALLOWLIST: any non-pointwise call or stateful name counts', () => {
  const held = (expr, v = 6) => {
    const head = v === 6 ? '//@version=6\nindicator("t")\n' : '//@version=4\nstudy("t")\n'
    const fl = v === 6 ? 'float base = na' : 'base = float(na)'
    return `${head}f(mode) =>\n    ${fl}\n    if mode == "ATR"\n        base := ${expr}\n    else\n        base := high - low\n    nz(base)\n`
      + 'y = close > open ? f("ATR") : 0.0\nplot(y)\n'
  }
  const v6Leaks = ['math.sum(close, 3)', 'ta.mom(close, 2)', 'ta.vwma(close, 3)', 'ta.valuewhen(close > open, close, 0)',
    'ta.barssince(close > open)', 'nz(ta.pivothigh(2, 2))', 'ta.linreg(close, 3, 0)', 'ta.crossover(close, open) ? 1.0 : 0.0',
    // a call the resolver has no answer for counts too (fail closed)
    'ta.percentrank(close, 3)', 'ta.correlation(close, open, 3)', 'ta.mfi(hlc3, 3)']
  const v4Leaks = ['change(close)', 'atr(3)', 'rsi(close, 3)', 'mom(close, 2)', 'roc(close, 2)', 'cci(close, 3)']
  it.each(v6Leaks)('v6 `%s` in a held branch, called from an arm, is refused', (expr) => {
    const r = refusalOf(held(expr))
    expect(r && r.guard).toBe(R4)
  })
  it.each(v4Leaks)('v4 `%s` in a held branch, called from an arm, is refused', (expr) => {
    const r = refusalOf(held(expr, 4))
    expect(r && r.guard).toBe(R4)
  })
  it('CONTROL: the v4 `tr` VARIABLE is the chart series (its `close[1]` is the chart one, as C06 / H06 witness), not call-site state', () => {
    const b = built(held('tr', 4))
    if (!b.ok) expect(b.refusal.guard).not.toBe(R4)
  })
  it('CONTROL: a held body whose calls are all pointwise (math.abs, math.max, nz) is still served in an arm', () => {
    // held for a reason that is not history (C47: a switch over a parameter)
    const sw = 'h(mode) =>\n    switch mode\n        "A" => math.abs(close - open) + nz(close)\n        => math.max(high, low)\n'
    const r = refusalOf(v6(`${sw}plot(close > open ? h("A") : 0.0)\n`))
    expect(r && r.guard).not.toBe(R4)
  })
})

describe('L3b — a parameter branch refusal names the real cause', () => {
  it('`(close - open)[1]` in a parameter branch says an expression\'s history, not a `ta.*` call', () => {
    const src = v6('f(mode) =>\n    float r = na\n    if mode == "A"\n        r := (close - open)[1]\n    else\n        r := 0.0\n    r\n'
      + 'plot(f(close > open ? "A" : "B"))\n')
    const r = refusalOf(src)
    expect(r && r.guard).toBe(R4)
    expect(r.message).not.toMatch(/a `ta\.\*` call/)
    expect(r.message).toMatch(/reads a series with history/)
  })
})
