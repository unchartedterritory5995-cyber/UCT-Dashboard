// app/src/components/chart/engine/runtime/__tests__/w4TextConstants.test.js
//
// W4 T3: SESSION AND TIMEFRAME TEXT, FIXED BEFORE BAR 0, THROUGH ANYTHING.
//
// `time(tf, session[, zone])` is answered by the COLUMNAR lane's own vendor-measured session
// clock (`pine.js::sessionClockOf`) once its arguments are TEXT FIXED BEFORE BAR 0. This
// rail holds what counts as fixed text on the runtime lane:
//
//   - the chart's own timeframe (`timeframe.period`, v1-v4's `period`) through a UDF
//     parameter the call site fixes, and through a name that is bound to it
//     (`timeinrange(res, sess) => time(res, sess)`, `BarInSession(sess) => time(period, sess)`);
//   - `input.session` / `input.timeframe` / `input.string` and v3/v4 `input(type=session)` at
//     the value in force (the member's, when they set one);
//   - two fixed texts joined with `+` (`_sessPeriod + ":1234567"`); a `var` nothing reassigns;
//   - every day digit of a day mask, 1 = Sunday ... 7 = Saturday (Pine's `dayofweek`), checked
//     against a calendar written out by hand.
//
// And what is NOT fixed keeps its refusal BY NAME: a text written per bar, a join with one, a
// rebound `period`, another timezone, a session with no day list before Pine v5, an overnight
// window. The object door (C18) builds exactly what master builds: `objectDoorGate.test.js`.
//
// Every expectation is written out by hand from the bars' own calendar, never from the code
// under test.
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

// 5-minute bars from Tue 2024-01-02 09:30 New York (EST, UTC-5)
const T5 = Date.UTC(2024, 0, 2, 14, 30) / 1000
const BARS5 = mkBars(T5, 300, 200)
// hourly bars from Sun 2024-01-07 00:00 New York: seven whole days, Sunday first
const T60 = Date.UTC(2024, 0, 7, 5, 0) / 1000
const BARS60 = mkBars(T60, 3600, 7 * 24)

const optsOf = (bars, tf, extra = {}) => ({
  bars, inputs: {}, pane: true, basePeriod: tf, tf, symbol: NY_SYMBOL, ...runtimeClockOpts(false, { tf }), ...extra,
})
const HEAD5 = '//@version=5\nindicator("t")\n'
const HEAD4 = '//@version=4\nstudy("t")\n'
const STATE = 'var float x = 0.0\nx := close\n'

const buildAt = (bars, tf, src, extra) => buildRuntimeIr(src, optsOf(bars, tf, extra))
const run = (bars, tf, src, extra) => {
  const built = buildAt(bars, tf, src, extra)
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: bars.length, series: seriesOf(bars), columns: program.columns, confirmed: true,
    barTimes: bars.map((b) => b.t) })
  return r.outputs.map((o) => Array.from(o))
}
const run5 = (src, extra) => run(BARS5, '5', src, extra)
const refuse5 = (src, extra) => {
  const b = buildAt(BARS5, '5', src, extra)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

// 09:30-09:55 is in "0930-1000", 10:00 is out (half-open)
const WANT = [1, 1, 1, 1, 1, 1, 0, 0]
const LATE = [0, 0, 0, 1, 1, 1, 0, 0]
const head = (o) => o.slice(0, 8)
const FLAG = '? 1 : x * 0'
const hitsOf = (o) => o.map((v, i) => (v === 1 ? i : -1)).filter((i) => i >= 0)

describe('the chart own timeframe is fixed for the call site', () => {
  it('v5: `timeframe.period` through a UDF parameter', () => {
    const [o] = run5(`${HEAD5}${STATE}inS(r, s) => not na(time(r, s))\nplot(inS(timeframe.period, "0930-1000:23456") ${FLAG})\n`)
    expect(head(o)).toEqual(WANT)
  })
  it('v4: `timeinrange(res, sess) => time(res, sess) != 0` called with `period` (the corpus idiom)', () => {
    const [o] = run5(`${HEAD4}${STATE}timeinrange(res, sess) => time(res, sess) != 0\nplot(timeinrange(period, "0930-1000:23456") ${FLAG})\n`)
    expect(head(o)).toEqual(WANT)
  })
  it('v4: `BarInSession(sess) => time(period, sess) != 0` (period read in the body)', () => {
    const [o] = run5(`${HEAD4}${STATE}BarInSession(sess) => time(period, sess) != 0\nplot(BarInSession("0930-1000:23456") ${FLAG})\n`)
    expect(head(o)).toEqual(WANT)
  })
  it('a name bound to the chart timeframe is the chart timeframe, directly and through a parameter', () => {
    const [a, b] = run5(`${HEAD5}${STATE}tf = timeframe.period\ninS(r, s) => not na(time(r, s))\n`
      + `plot(not na(time(tf, "0930-1000:23456")) ${FLAG})\nplot(inS(tf, "0930-1000:23456") ${FLAG})\n`)
    expect(head(a)).toEqual(WANT)
    expect(head(b)).toEqual(WANT)
  })
  it('two call sites of one function, one session each, with the timeframe passed in', () => {
    const [a, b] = run5(`${HEAD5}${STATE}inS(r, s) => not na(time(r, s))\n`
      + `plot(inS(timeframe.period, "0930-1000:23456") ${FLAG})\nplot(inS(timeframe.period, "0945-1000:23456") ${FLAG})\n`)
    expect(head(a)).toEqual(WANT)
    expect(head(b)).toEqual(LATE)
  })
  it('CONTROL: a rebound `period` is what it was bound to, never the chart timeframe', () => {
    // v4 lets a script bind `period`; `period = "15"` means fifteen minutes, and this is a
    // 5-minute chart. Reading it as the chart's own timeframe would serve the 5-minute answer.
    const r = refuse5(`${HEAD4}${STATE}period = "15"\ntimeinrange(res, sess) => time(res, sess) != 0\n`
      + `plot(timeinrange(period, "0930-1000:23456") ${FLAG})\n`)
    expect(r.guard).toBe('pine:function')
    expect(r.message).toMatch(/OWN timeframe/)
  })
  it('CONTROL: a `period` bound to an expression this lane cannot fix is not the chart timeframe', () => {
    // the binding is read FIRST (`pine.js::ownTimeframeOf` states the same rule): `period` bound to
    // a choice of two timeframes is one of them, never "the chart's own"
    const r = refuse5(`${HEAD4}${STATE}period = syminfo.ticker == "SPY" ? "15" : "5"
`
      + `timeinrange(res, sess) => time(res, sess) != 0
plot(timeinrange(period, "0930-1000:23456") ? 1 : 0)
`)
    expect(r.guard).toBe('runtime:history-dynamic-offset')
  })
  it('CONTROL: a v4 `var period` is a slot the script writes, never the chart timeframe', () => {
    const r = refuse5(`${HEAD4}${STATE}var string period = "15"
period := close > 0 ? "15" : "5"
`
      + `timeinrange(res, sess) => time(res, sess) != 0
plot(timeinrange(period, "0930-1000:23456") ? 1 : 0)
`)
    expect(r.guard).toBe('runtime:history-dynamic-offset')
  })
  it('CONTROL: a timeframe written per bar is not fixed', () => {
    const r = refuse5(`${HEAD5}var string t = "5"\nt := close > 0 ? "5" : "15"\n`
      + `inS(r, s) => not na(time(r, s))\nplot(inS(t, "0930-1000:23456") ? 1 : 0)\n`)
    expect(r.guard).toBe('runtime:history-dynamic-offset')
  })
})

describe('an input is its text at the value in force', () => {
  it('`input.session` at the author default, and at the member value', () => {
    const src = `${HEAD5}${STATE}sess = input.session("0930-1000:23456", "S")\ninS(r, s) => not na(time(r, s))\n`
      + `plot(inS(timeframe.period, sess) ${FLAG})\n`
    expect(head(run5(src)[0])).toEqual(WANT)
    expect(head(run5(src, { inputs: { sess: '0945-1000:23456' } })[0])).toEqual(LATE)
  })
  it('v3/v4 `input(type=session)` through `timeinrange(period, sess)`', () => {
    const [o] = run5(`${HEAD4}${STATE}IB = input(title="IB", type=session, defval="0930-1000:23456")\n`
      + `timeinrange(res, sess) => time(res, sess) != 0\nplot(timeinrange(period, IB) ${FLAG})\n`)
    expect(head(o)).toEqual(WANT)
  })
  it('v3/v4 `input(type=resolution)` and `input(type=string)`, named or as the third argument', () => {
    const [a, b] = run5(`${HEAD4}${STATE}tfin = input(title="TF", type=resolution, defval="")
`
      + `ses = input("0930-1000:23456", "S", string)
`
      + `timeinrange(res, sess) => time(res, sess) != 0
plot(timeinrange(tfin, ses) ${FLAG})
`
      + `plot(timeinrange(period, input(title="S2", type=string, defval="0945-1000:23456")) ${FLAG})
`)
    expect(head(a)).toEqual(WANT)
    expect(head(b)).toEqual(LATE)
  })
  it('`input.string` holding a session', () => {
    const [o] = run5(`${HEAD5}${STATE}s = input.string("0930-1000:23456", "S")\ninS(r, q) => not na(time(r, q))\nplot(inS(timeframe.period, s) ${FLAG})\n`)
    expect(head(o)).toEqual(WANT)
  })
  it('`input.timeframe("")` is the chart own timeframe (the script main timeframe)', () => {
    const [o] = run5(`${HEAD5}${STATE}tfin = input.timeframe("", "TF")\ninS(r, s) => not na(time(r, s))\nplot(inS(tfin, "0930-1000:23456") ${FLAG})\n`)
    expect(head(o)).toEqual(WANT)
  })
})

describe('two fixed texts joined, and a `var` nothing reassigns', () => {
  it('a parameter joined to a day list (`_sessPeriod + ":23456"`)', () => {
    const [o] = run5(`${HEAD5}${STATE}inS(s) => not na(time(timeframe.period, s + ":23456"))\nplot(inS("0930-1000") ${FLAG})\n`)
    expect(head(o)).toEqual(WANT)
  })
  it('literals joined in the call, and a join of a name with a literal', () => {
    const [a, b] = run5(`${HEAD5}${STATE}base = "0930-1000"\n`
      + `plot(not na(time(timeframe.period, "0930-" + "1000:23456")) ${FLAG})\n`
      + `plot(not na(time(timeframe.period, base + ":23456")) ${FLAG})\n`)
    expect(head(a)).toEqual(WANT)
    expect(head(b)).toEqual(WANT)
  })
  it('a `var string` nothing reassigns is its literal', () => {
    const [o] = run5(`${HEAD5}${STATE}var string SESS = "0930-1000:23456"\nplot(not na(time(timeframe.period, SESS)) ${FLAG})\n`)
    expect(head(o)).toEqual(WANT)
  })
  it('CONTROL: a `var` written per bar is not fixed', () => {
    const r = refuse5(`${HEAD5}var string s = "0930-1000:23456"\ns := close > 0 ? "0930-1000:23456" : "1000-1100:23456"\n`
      + `plot(not na(time(timeframe.period, s)) ? 1 : 0)\n`)
    expect(r.guard).toBe('runtime:statement')
    expect(r.message).toMatch(/a session has to reach the engine as a literal/)
  })
  it('CONTROL: a join with a per-bar text is not fixed', () => {
    const r = refuse5(`${HEAD5}var string s = "0930-1000"\ns := close > 0 ? "0930-1000" : "1000-1100"\n`
      + `plot(not na(time(timeframe.period, s + ":23456")) ? 1 : 0)\n`)
    expect(r.guard).toBe('runtime:statement')
    expect(r.message).toMatch(/a session has to reach the engine as a literal/)
  })
  it('CONTROL: a join whose RIGHT half is per-bar is not fixed either', () => {
    const r = refuse5(`${HEAD5}var string s = "1000"
s := close > 0 ? "1000" : "1100"
`
      + `plot(not na(time(timeframe.period, "0930-" + s + ":23456")) ? 1 : 0)
`)
    expect(r.guard).toBe('runtime:statement')
    expect(r.message).toMatch(/a session has to reach the engine as a literal/)
  })
  it('CONTROL: a function parameter named like a constant `var` is the call value in a branch test', () => {
    // `s` the constant is "x"; `f(s)` decides a history branch on its OWN `s`, which the call passes
    // as a value only known while the bar runs: the branch is not fixed, so the refusal stands
    const r = refuse5(`${HEAD5}var string s = "x"
f(s) =>
    s ? ta.sma(close, 3) : ta.sma(open, 3)
`
      + `plot(f(close > 0 ? "a" : "b"))
`)
    expect(r.guard).toBe('runtime:conditional-history')
  })
  describe('CONTROL: a block, loop or function that rebinds the name shadows the `var` (review M1)', () => {
    const G = 'g() =>\n    ["0945-1000:23456", 1]\n'
    const VAR = 'var string SESS = "0930-1000:23456"\n'
    const USE = 'not na(time(timeframe.period, SESS)) ? 1 : 0'
    const refused = (body) => {
      const r = refuse5(`${HEAD5}${STATE}${G}${VAR}${body}`)
      expect(r.guard).toMatch(/^runtime:(statement|history-dynamic-offset)$/)
      return r
    }
    it('a tuple in an `if` block: the read there is the inner text, never the outer literal', () => {
      // Pine reads "0945-1000" there (0,0,0,1,1,1); the outer literal would read 1,1,1,1,1,1
      const r = refused(`c = close > 0
r = if c
    [SESS, k] = g()
    ${USE}
plot(r + x * 0)
`)
      expect(r.message).toMatch(/a session has to reach the engine as a literal/)
    })
    it('a tuple in a `for` loop', () => {
      refused(`acc = 0
for i = 0 to 1
    [SESS, k] = g()
    acc += ${USE}
plot(acc + x * 0)
`)
    })
    it('a tuple in a function body', () => {
      refused(`f() =>
    [SESS, k] = g()
    ${USE}
plot(f() + x * 0)
`)
    })
    it('a tuple in a block counts as a rebinding even when the read is OUTSIDE it (conservative)', () => {
      refused(`c = close > 0
r = if c
    [SESS, k] = g()
    1
plot((${USE}) + x * 0)
`)
    })
    it('a `:=` in a nested block', () => {
      refused(`c = close > 0
r = if c
    SESS := "0945-1000:23456"
    ${USE}
plot(r + x * 0)
`)
    })
    it('a same-name local in an `if` block, a loop and a function', () => {
      refused(`c = close > 0
r = if c
    SESS = "0945-1000:23456"
    ${USE}
plot(r + x * 0)
`)
      refused(`acc = 0
for i = 0 to 1
    SESS = "0945-1000:23456"
    acc += ${USE}
plot(acc + x * 0)
`)
      refused(`f() =>
    SESS = "0945-1000:23456"
    ${USE}
plot(f() + x * 0)
`)
    })
    it('a loop counter named like the `var`', () => {
      refused(`acc = 0
for SESS = 0 to 1
    acc += ${USE}
plot(acc + x * 0)
`)
    })
    it('a typed local, a `var` local and a `varip` local in a block', () => {
      refused(`c = close > 0\nr = if c\n    string SESS = "0945-1000:23456"\n    ${USE}\nplot(r + x * 0)\n`)
      refused(`c = close > 0\nr = if c\n    var string SESS = "0945-1000:23456"\n    ${USE}\nplot(r + x * 0)\n`)
    })
    it('CONTROL: with no rebinding the same shape is served', () => {
      const [o] = run5(`${HEAD5}${STATE}${VAR}c = close > 0
r = if c
    ${USE}
    
plot(r + x * 0)
`)
      expect(head(o)).toEqual(WANT)
    })
  })
  it('CONTROL: a `var` reassigned anywhere is not a constant', () => {
    const r = refuse5(`${HEAD5}var string s = "0930-1000:23456"\nif close > 1000000\n    s := "1000-1100:23456"\n`
      + `plot(not na(time(timeframe.period, s)) ? 1 : 0)\n`)
    expect(r.guard).toBe('runtime:statement')
  })
  it('CONTROL: a parameter named like a constant `var` is the call value, not the `var`', () => {
    // the constant `s` is "0930-1000:23456"; the function own `s` is what the call passes
    const [o] = run5(`${HEAD5}${STATE}var string s = "0930-1000:23456"\ninS(s) => not na(time(timeframe.period, s))\n`
      + `plot(inS("0945-1000:23456") ${FLAG})\n`)
    expect(head(o)).toEqual(LATE)
  })
})

describe('what stays refused BY NAME', () => {
  it('another timezone', () => {
    const r = refuse5(`${HEAD5}${STATE}inS(r, s) => not na(time(r, s, "Asia/Tokyo"))\nplot(inS(timeframe.period, "0930-1000:23456") ? 1 : 0)\n`)
    expect(r.guard).toBe('pine:function')
    expect(r.message).toMatch(/Asia\/Tokyo/)
  })
  it('a session with no day list before Pine v5 (the default days were never measured)', () => {
    const r = refuse5(`${HEAD4}${STATE}timeinrange(res, sess) => time(res, sess) != 0\nplot(timeinrange(period, "0930-1000") ? 1 : 0)\n`)
    expect(r.guard).toBe('pine:function')
    expect(r.message).toMatch(/has no day list/)
  })
  it('an overnight window', () => {
    const r = refuse5(`${HEAD5}${STATE}inS(r, s) => not na(time(r, s))\nplot(inS(timeframe.period, "1800-0200:1234567") ? 1 : 0)\n`)
    expect(r.guard).toBe('pine:function')
    expect(r.message).toMatch(/wraps past midnight/)
  })
  it('a timeframe that is not the chart (a 15-minute literal on a 5-minute chart)', () => {
    const r = refuse5(`${HEAD5}${STATE}inS(r, s) => not na(time(r, s))\nplot(inS("15", "0930-1000:23456") ? 1 : 0)\n`)
    expect(r.guard).toBe('pine:function')
    expect(r.message).toMatch(/OWN timeframe/)
  })
  it('a malformed day list', () => {
    const r = refuse5(`${HEAD5}${STATE}inS(r, s) => not na(time(r, s))\nplot(inS(timeframe.period, "0930-1000:8") ? 1 : 0)\n`)
    expect(r.guard).toBe('pine:function')
  })
})

describe('the day mask: digit d is Pine dayofweek == d (1 = Sunday ... 7 = Saturday)', () => {
  // BARS60 starts Sunday 2024-01-07 00:00 New York; the 09:00 bar of day k (k = 0 Sunday ...
  // 6 Saturday) is bar 24 * k + 9. The expected set is written out from that calendar.
  const NINE = Array.from({ length: 7 }, (_, k) => 24 * k + 9)
  const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  for (let d = 1; d <= 7; d += 1) {
    it(`":${d}" selects ${NAMES[d - 1]} and only ${NAMES[d - 1]}`, () => {
      const [o] = run(BARS60, '60', `${HEAD5}${STATE}inS(r, s) => not na(time(r, s))\n`
        + `plot(inS(timeframe.period, "0900-1000:${d}") ${FLAG})\n`)
      expect(hitsOf(o)).toEqual([NINE[d - 1]])
    })
  }
  it('":23456" is Monday to Friday, ":17" the weekend', () => {
    const [wk, we] = run(BARS60, '60', `${HEAD5}${STATE}inS(r, s) => not na(time(r, s))\n`
      + `plot(inS(timeframe.period, "0900-1000:23456") ${FLAG})\nplot(inS(timeframe.period, "0900-1000:17") ${FLAG})\n`)
    expect(hitsOf(wk)).toEqual([1, 2, 3, 4, 5].map((k) => NINE[k]))
    expect(hitsOf(we)).toEqual([NINE[0], NINE[6]])
  })
  it('a mask through a joined text and an input behaves the same as the literal', () => {
    const [a, b] = run(BARS60, '60', `${HEAD5}${STATE}d = input.string("0900-1000", "S")\ninS(r, s) => not na(time(r, s))\n`
      + `plot(inS(timeframe.period, d + ":6") ${FLAG})\nplot(inS(timeframe.period, "0900-1000:6") ${FLAG})\n`)
    expect(a).toEqual(b)
    expect(hitsOf(a)).toEqual([NINE[5]])
  })
})
