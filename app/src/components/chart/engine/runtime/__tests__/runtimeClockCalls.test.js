// app/src/components/chart/engine/runtime/__tests__/runtimeClockCalls.test.js
//
// ─── ⭐⭐ P3 WS-B — PINE'S CLOCK CALLS WHERE THE COLUMNAR LANE STOPS ──────────
//
//   · `timestamp(y, mo, d[, h, mi, s])`, `timestamp(zone, …)`,
//     `timestamp(dateString)` — UNIX MILLISECONDS (`clockFns.js`), the exchange's
//     zone by default (reference: "The default is syminfo.timezone");
//   · `<field>(t[, zone])` over an instant the run computes, or in a named zone;
//   · `time(tf, session[, zone])` whose arguments are texts fixed before bar 0 —
//     a parameter a call site fixes, `""` ("the script's main timeframe") —
//     answered by the COLUMNAR lane's own vendor-measured session clock.
//
// Every expected instant below is computed independently of `clockFns.js`
// (a fixed UTC offset written out by hand, `Date.UTC`), never by the code under
// test.

import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { canonicalZone, timestampMs, instantField, dateStringMs } from '../clockFns.js'

// 5-minute bars from 2024-01-02 09:30 New York (EST, UTC-5), a Tuesday
const T0 = Date.UTC(2024, 0, 2, 14, 30) / 1000
const N = 200
const BARS = Array.from({ length: N }, (_, i) => ({
  t: T0 + i * 300, o: 100 + i * 0.01, h: 101 + i * 0.01, l: 99 + i * 0.01, c: 100 + Math.sin(i) , v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const HEAD5 = '//@version=5\nindicator("t")\n'
const STATE = 'var float x = 0.0\nx := close\n'
const OPTS = { bars: BARS, inputs: {}, pane: true, basePeriod: '5', tf: '5', ...runtimeClockOpts(false, { tf: '5' }) }

const build = (src) => buildRuntimeIr(src, OPTS)
function runAll(src) {
  const built = build(src)
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t) })
  return r.outputs.map((o) => Array.from(o))
}
const refusalOf = (src) => {
  const b = build(src)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

describe('`clockFns.js` — the arithmetic, against instants written out by hand', () => {
  it('zones: the exchange\'s, its IANA name, fixed UTC/GMT offsets; anything else is null', () => {
    expect(canonicalZone(undefined)).toBe('exchange')
    expect(canonicalZone('America/New_York')).toBe('exchange')
    expect(canonicalZone('UTC')).toBe('fixed:0')
    expect(canonicalZone('GMT+0')).toBe('fixed:0')
    expect(canonicalZone('UTC-5')).toBe('fixed:-300')
    expect(canonicalZone('GMT+0530')).toBe('fixed:330')
    expect(canonicalZone('GMT+5:30')).toBe('fixed:330')
    expect(canonicalZone('Asia/Tokyo')).toBe(null)
    expect(canonicalZone('UTC+15')).toBe(null)
  })
  it('`timestamp` in New York reads EST in winter and EDT in summer, before 1990 too', () => {
    expect(timestampMs('exchange', 2024, 1, 2, 9, 30, 0)).toBe(Date.UTC(2024, 0, 2, 14, 30))
    expect(timestampMs('exchange', 2024, 7, 4, 9, 30, 0)).toBe(Date.UTC(2024, 6, 4, 13, 30))
    expect(timestampMs('exchange', 1985, 7, 4, 12, 0, 0)).toBe(Date.UTC(1985, 6, 4, 16, 0))
    expect(timestampMs('fixed:-300', 2024, 7, 4, 9, 30, 0)).toBe(Date.UTC(2024, 6, 4, 14, 30))
  })
  it('a year below 100 is that year, not 19xx (`Date.UTC`\'s trap)', () => {
    const ms = timestampMs('fixed:0', 50, 1, 1, 0, 0, 0)
    expect(new Date(ms).getUTCFullYear()).toBe(50)
  })
  it('out-of-range components normalise like a lenient calendar (NEEDS CAPTURE)', () => {
    expect(timestampMs('fixed:0', 2024, 1, 32, 0, 0, 0)).toBe(Date.UTC(2024, 1, 1))
    expect(timestampMs('fixed:0', 2024, 1, 2, 9, 75, 0)).toBe(Date.UTC(2024, 0, 2, 10, 15))
  })
  it('`na` in, `na` out', () => {
    expect(Number.isNaN(timestampMs('exchange', NaN, 1, 1, 0, 0, 0))).toBe(true)
    expect(Number.isNaN(instantField('year', NaN, 'exchange'))).toBe(true)
  })
  it('calendar fields of an instant, by zone; Pine\'s `dayofweek` is 1 = Sunday', () => {
    const t = Date.UTC(2024, 0, 7, 3, 15, 42) // Sunday 03:15:42 UTC = Saturday 22:15:42 EST
    expect(instantField('dayofweek', t, 'fixed:0')).toBe(1)
    expect(instantField('dayofweek', t, 'exchange')).toBe(7)
    expect(instantField('hour', t, 'exchange')).toBe(22)
    expect(instantField('dayofmonth', t, 'exchange')).toBe(6)
    expect(instantField('minute', t, 'fixed:330')).toBe(45)
    expect(instantField('second', t, 'exchange')).toBe(42)
  })
  it('`timestamp(dateString)`: no zone is GMT+0 (the reference), a zone is honoured, a non-date is null', () => {
    expect(dateStringMs('2020-02-20')).toBe(Date.UTC(2020, 1, 20))
    expect(dateStringMs('2020-02-20T15:30:00+02:00')).toBe(Date.UTC(2020, 1, 20, 13, 30))
    expect(dateStringMs('20 Feb 2020 15:30 +0200')).toBe(Date.UTC(2020, 1, 20, 13, 30))
    expect(dateStringMs('01 Jan 2000 20:00')).toBe(Date.UTC(2000, 0, 1, 20))
    expect(dateStringMs('2021-02-30')).toBe(null)
    expect(dateStringMs('yesterday')).toBe(null)
  })
})

describe('⭐⭐ `timestamp` in the run', () => {
  it('a date window over the bar\'s own `time` — the strategy-range idiom', () => {
    const [o] = runAll(`${HEAD5}${STATE}start = timestamp(2024, 1, 2, 10, 0)\nplot(time >= start ? 1 : 0)\n`)
    // 09:30 + 6 bars of 5 minutes = 10:00
    expect(o.slice(0, 8)).toEqual([0, 0, 0, 0, 0, 0, 1, 1])
  })
  it('a zone first: 15:00 UTC is 10:00 New York in January', () => {
    const [o] = runAll(`${HEAD5}${STATE}plot(timestamp("UTC", 2024, 1, 2, 15, 0) - timestamp(syminfo.timezone, 2024, 1, 2, 10, 0) + x * 0)\n`)
    expect(o[0]).toBe(0)
  })
  it('over values the run computes', () => {
    const [o] = runAll(`${HEAD5}${STATE}plot(timestamp(year(time), month(time), dayofmonth(time), 9, 30 + bar_index % 3) + x * 0)\n`)
    expect(o[0]).toBe(Date.UTC(2024, 0, 2, 14, 30))
    expect(o[2]).toBe(Date.UTC(2024, 0, 2, 14, 32))
  })
  it('`timestamp(dateString)` folds before bar 0', () => {
    const [o] = runAll(`${HEAD5}${STATE}plot(timestamp("2024-01-02T15:00:00") + x * 0)\n`)
    expect(o[0]).toBe(Date.UTC(2024, 0, 2, 15))
  })
  it('⛔ a zone this engine does not answer for refuses by name', () => {
    const r = refusalOf(`${HEAD5}${STATE}plot(timestamp("Asia/Tokyo", 2024, 1, 2, 10, 0) + x)\n`)
    expect(r.message).toMatch(/Asia\/Tokyo/)
  })
  it('⛔ the script\'s own `timestamp` is never replaced', () => {
    const [o] = runAll(`//@version=4\nstudy("t")\n${STATE}timestamp(a, b, c) => a + b + c\nplot(timestamp(1, 2, 3) + x * 0)\n`)
    expect(o[0]).toBe(6)
  })
})

describe('⭐⭐ a calendar field of an instant the run computes, or in a zone', () => {
  it('`dayofweek(time + offset)` — the instant, not the bar', () => {
    const [o] = runAll(`${HEAD5}${STATE}plot(dayofweek(time + 15 * 3600000) + x * 0)\n`)
    // Tuesday 09:30 EST + 15 h = Wednesday 00:30 EST
    expect(o[0]).toBe(4)
  })
  it('`hour(time, "UTC")`, `second(time)`', () => {
    const [h, s] = runAll(`${HEAD5}${STATE}plot(hour(time, "UTC") + x * 0)\nplot(second(time) + x * 0)\n`)
    expect(h[0]).toBe(14)
    expect(s[0]).toBe(0)
  })
  it('⛔ CONTROL — the bar\'s own clock still reads the clock column (`OP.READ_CLOCK`)', () => {
    const built = build(`${HEAD5}${STATE}plot(hour(time) + x * 0)\n`)
    expect(built.ok).toBe(true)
    expect(JSON.stringify(built.ir)).not.toMatch(/hour\/instant/)
  })
  it('`hour(time, syminfo.timezone)` is the bar\'s clock column too, not a refusal', () => {
    // The exchange's zone named by `syminfo.timezone` reaches the clock lowering
    // (two arguments), which answers it with the clock column; handed back to the
    // older arm it refused "a timezone only known while the bar runs".
    const src = `${HEAD5}${STATE}plot(hour(time, syminfo.timezone) + x * 0)\nplot(hour(time) + x * 0)\n`
    const built = build(src)
    expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
    expect(JSON.stringify(built.ir)).not.toMatch(/hour\/instant/)
    const [a, b] = runAll(src)
    expect(a).toEqual(b)
  })
})

describe('⭐⭐ the session clock, through the columnar lane\'s own reading', () => {
  const inSession = (out) => out.slice(0, 8)
  const want = [1, 1, 1, 1, 1, 1, 0, 0] // 09:30–09:55 in, 10:00 out
  it('a literal session is the columnar answer (the reference point)', () => {
    const [o] = runAll(`${HEAD5}${STATE}plot(not na(time(timeframe.period, "0930-1000:23456")) ? 1 : x * 0)\n`)
    expect(inSession(o)).toEqual(want)
  })
  it('`""` is the script\'s main timeframe', () => {
    const [o] = runAll(`${HEAD5}${STATE}plot(not na(time("", "0930-1000:23456", "America/New_York")) ? 1 : x * 0)\n`)
    expect(inSession(o)).toEqual(want)
  })
  it('a session a call site fixes — `BarInSession(sess) => time(period, sess) != 0`', () => {
    const [o] = runAll(`//@version=4\nstudy("t")\n${STATE}BarInSession(sess) => time(period, sess) != 0\nplot(BarInSession("0930-1000:23456") ? 1 : x * 0)\n`)
    expect(inSession(o)).toEqual(want)
  })
  it('two call sites, two sessions', () => {
    const [a, b] = runAll(`${HEAD5}${STATE}inS(s) => not na(time(timeframe.period, s))\nplot(inS("0930-1000:23456") ? 1 : x * 0)\nplot(inS("0945-1000:23456") ? 1 : x * 0)\n`)
    expect(inSession(a)).toEqual(want)
    expect(inSession(b)).toEqual([0, 0, 0, 1, 1, 1, 0, 0])
  })
  it('⛔ a session only known while the bar runs keeps a refusal', () => {
    const b = build(`${HEAD5}var string s = "0930-1000"\ns := close > 0 ? "0930-1000" : "1000-1100"\nplot(not na(time(timeframe.period, s)) ? 1 : 0)\n`)
    expect(b.ok).toBe(false)
    // the session arm's own sentence: the clock lowering hands the call back
    // rather than rebuilding it with a session it cannot read
    expect(b.refusal.guard).toBe('runtime:statement')
    expect(b.refusal.message).toMatch(/a session has to reach the engine as a literal/)
  })
})
