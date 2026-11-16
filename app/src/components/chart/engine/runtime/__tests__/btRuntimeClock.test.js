// ⭐⭐ NUMBER PENDING (bt, 2026-11-16) — the runtime lane asks the COLUMNAR lane for three more
// answers instead of refusing them as builtins it does not hold:
//
//   · `na(time(tf, session))` as ONE membership read, so a wrapping session (membership measured,
//     `vw-w4-session-overnight-btcusd-60-2026-11-16`) is served here exactly as there;
//   · `timeframe.in_seconds([tf])` with a timeframe fixed before bar 0 (`pine.js::timeframeCallOf`,
//     the lengths measured on vw-time-tf T10-T15);
//   · the v1-v4 bare `avg(…)`, the migration guide's `math.avg` (the C23 expansion).
//
// Every expectation is written out by hand from the bars' own calendar or Pine's documented
// constants, never from the code under test. The host-lane twin is `ast/btSessionClock.test.js`.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'

const NY_SYMBOL = { ticker: 'SPY', exchange: 'NYSE Arca' }
const mkBars = (t0, step, n) => Array.from({ length: n }, (_, i) => ({
  t: t0 + i * step, o: 100 + i * 0.01, h: 101 + i * 0.01, l: 99 + i * 0.01, c: 100 + Math.sin(i), v: 1000 + i,
}))
const seriesOf = (bars) => ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
// hourly bars from Sun 2024-01-07 00:00 New York: seven whole days, Sunday first
const T60 = Date.UTC(2024, 0, 7, 5, 0) / 1000
const BARS60 = mkBars(T60, 3600, 7 * 24)
// 5-minute bars from Tue 2024-01-02 09:30 New York
const T5 = Date.UTC(2024, 0, 2, 14, 30) / 1000
const BARS5 = mkBars(T5, 300, 60)

const optsOf = (bars, tf, extra = {}) => ({
  bars, inputs: {}, pane: true, basePeriod: tf, tf, symbol: NY_SYMBOL, ...runtimeClockOpts(false, { tf }), ...extra,
})
const HEAD6 = '//@version=6\nindicator("t")\n'
const HEAD5 = '//@version=5\nindicator("t")\n'
const HEAD4 = '//@version=4\nstudy("t")\n'
const STATE = 'var float x = 0.0\nx := close\n'

const build = (bars, tf, src, extra) => buildRuntimeIr(src, optsOf(bars, tf, extra))
const run = (bars, tf, src, extra) => {
  const built = build(bars, tf, src, extra)
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: bars.length, series: seriesOf(bars), columns: program.columns, confirmed: true,
    barTimes: bars.map((b) => b.t) })
  return r.outputs.map((o) => Array.from(o))
}
const refuse = (bars, tf, src, extra) => {
  const b = build(bars, tf, src, extra)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

describe('a wrapping session through a UDF parameter, membership only', () => {
  const WANT = BARS60.map((_, i) => {
    const day = Math.floor(i / 24) // 0 = Sunday
    const hour = i % 24
    if (hour >= 18) return day <= 4 ? 1 : 0 // the session that ends tomorrow, Monday..Friday
    if (hour < 2) return day >= 1 && day <= 5 ? 1 : 0 // the session that ends today, Monday..Friday
    return 0
  })
  it('`inS(r, s) => not na(time(r, s))` on "1800-0200:23456" is the hand calendar on every bar', () => {
    const [o] = run(BARS60, '60', `${HEAD5}${STATE}inS(r, s) => not na(time(r, s))\n`
      + 'plot(inS(timeframe.period, "1800-0200:23456") ? 1 : x * 0)\n')
    expect(o).toEqual(WANT)
  })
  it('the corpus spelling `time("", sess, TZ)` with a zone (session-highs-and-lows) answers alike', () => {
    const [o] = run(BARS60, '60', `${HEAD6}${STATE}TZ = "America/New_York"\n`
      + 'inS(s) => not na(time("", s, TZ))\nplot(inS("1800-0200:23456") ? 1 : x * 0)\n')
    expect(o).toEqual(WANT)
  })
  it('⛔ its VALUE still refuses by name', () => {
    const r = refuse(BARS60, '60', `${HEAD5}${STATE}t(s) => time(timeframe.period, s)\nplot(t("1800-0200:1234567") + x * 0)\n`)
    expect(r.guard).toBe('pine:function')
    expect(r.message).toMatch(/VALUE inside a wrapping session is not measured/)
  })
})

describe('`timeframe.in_seconds` with a timeframe fixed before bar 0', () => {
  const each = (o, v) => o.every((y) => y === v)
  it('through a UDF parameter: the documented lengths, "M" the measured 2,628,003 s', () => {
    const outs = run(BARS5, '5', `${HEAD5}${STATE}secs(tf) => timeframe.in_seconds(tf) + x * 0\n`
      + 'plot(secs("60"))\nplot(secs("D"))\nplot(secs("W"))\nplot(secs("M"))\nplot(secs("3M"))\n')
    expect(outs.map((o) => o[0])).toEqual([3600, 86400, 604800, 2628003, 3 * 2628003])
    expect(outs.every((o) => each(o, o[0]))).toBe(true)
  })
  it('the chart\'s own, three spellings: no argument, `timeframe.period`, an input at its value', () => {
    const [a, b, c] = run(BARS5, '5', `${HEAD5}${STATE}tf = input.timeframe("15")\n`
      + 'f(t) => timeframe.in_seconds(t) + x * 0\n'
      + 'plot(timeframe.in_seconds() + x * 0)\nplot(f(timeframe.period))\nplot(f(tf))\n')
    expect(each(a, 300)).toBe(true)
    expect(each(b, 300)).toBe(true)
    expect(each(c, 900)).toBe(true)
  })
  it('⛔ a timeframe written per bar, and a code with no measured length, still refuse', () => {
    const perBar = refuse(BARS5, '5', `${HEAD5}var string t = "5"\nt := close > 0 ? "5" : "15"\n`
      + 'f(s) => timeframe.in_seconds(s)\nplot(f(t))\n')
    expect(perBar.guard).not.toBe('runtime:call-undeclared-builtin-state')
    const odd = refuse(BARS5, '5', `${HEAD5}${STATE}f(s) => timeframe.in_seconds(s) + x * 0\nplot(f("30S"))\n`)
    expect(odd.guard).toBe('pine:builtin')
  })
})

describe('the v1-v4 bare `avg` is `math.avg` (v4->v5 migration guide)', () => {
  it('v4 `avg(x, close)` over runtime state is the mean of its arguments', () => {
    const [o] = run(BARS5, '5', `${HEAD4}${STATE}y = avg(x, close * 3)\nplot(y)\n`)
    const want = BARS5.map((b) => (b.c + b.c * 3) / 2)
    o.forEach((v, i) => expect(v).toBeCloseTo(want[i], 9))
  })
  it('⛔ v5 has no bare `avg`: it stays an undeclared builtin, by name', () => {
    const r = refuse(BARS5, '5', `${HEAD5}${STATE}plot(avg(x, close))\n`)
    expect(r.guard).toBe('runtime:call-undeclared-builtin-state')
  })
  it('⛔ a script\'s own `avg` is its own function, never Pine\'s', () => {
    const [o] = run(BARS5, '5', `${HEAD4}${STATE}avg(a, b) => a - b\nplot(avg(x, close))\n`)
    expect(o.every((v) => v === 0)).toBe(true)
  })
})
