// app/src/components/chart/engine/runtime/__tests__/conditionalArmsParams.test.js
//
// ─── ⭐⭐ WS-C (Phase 3) — P3 BEYOND THE `if` BLOCK: ARMS, HEADS, PARAMETERS ────
//
// `conditionalCallSite.test.js` pins the `if` / `switch` block. This file pins
// the four places the same rule (Pine keeps a `ta.*` call's history PER CALL
// SITE: only the bars on which the call ran) reached past it:
//
//   1. A `ta.*` in ONE ARM OF `?:` (or on the right of v6's `and` / `or`). Pine
//      runs only the arm it takes; this lane evaluates both on every bar. The
//      witness is `vw-arm-history-rddt-1d-2026-10-02`: T03 `up ? ta.sma(close,
//      5) : close` and K03 `even ? ta.change(close) : na` count RUNS. Refused by
//      name, unless the test reads nothing per-bar (an input, a literal, the
//      chart's own timeframe or symbol text).
//   2. A `ta.*` whose HEAD rewrites to offsets over a chart series (`ta.mom`,
//      `ta.roc`, `ta.swma`) in a block. `statefulTree` called them pure, so they
//      were every-bar columns; Pine's `ta.change` there is the previous RUN's
//      (T05 / K03). Refused by name.
//   3. `ta.rma` in a block, SERVED per call site: the CARRIED recurrence `ta.ema`
//      is served by (C04), with Pine's documented `alpha = 1 / n`, seeded by the
//      mean of its first n runs. Pinned against that recurrence over the runs.
//   4. A branch on a PARAMETER (deadband-hysteresis's `getBaseTau(mode, …)`,
//      `if mode == "ATR"`) is the CALL SITE's: a call passing a value fixed
//      before bar 0 compiles its own copy (C35) where the branch runs on every
//      call; a per-bar argument is refused by name, naming the parameter.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const load = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
const ARM = load('vw-arm-history-rddt-1d-2026-10-02.json')

const barsOf = (cap) => cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
const seriesOf = (bars) => ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
const BARS = barsOf(ARM)
const rowOf = (cap, k) => {
  const at = cap.plotValues.fields.indexOf(`plot_${k}`)
  return cap.plotValues.rows.map((r) => (r[at] == null ? NaN : r[at]))
}
const opts = (extra) => ({ bars: BARS, inputs: {}, ...extra })
function run(src, extra) {
  const built = buildRuntimeIr(src, opts(extra))
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: BARS.length, series: seriesOf(BARS), columns: program.columns, confirmed: true })
  return r.outputs.map((o) => Array.from(o))
}
const refusalOf = (src, extra) => { const b = buildRuntimeIr(src, opts(extra)); return b.ok ? null : b.refusal }
const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b))
const v6 = (body) => `//@version=6\nindicator("t")\n${body}`
const UP = BARS.map((b) => b.c > b.o)
const R4 = 'runtime:conditional-history'

describe('1 — a `ta.*` in one arm of `?:` keeps that arm\'s runs: refused by name', () => {
  it('⚰️ THE DEFECT, MEASURED: the every-bar column differs from TradingView on most T03 / K03 bars', () => {
    // What the lane printed before this guard: the every-bar sma / change,
    // selected per bar. TradingView's T03 (plot_8) and K03 (plot_15) count runs.
    const [sma, chg] = run(v6('plot(ta.sma(close, 5))\nplot(ta.change(close))\n'))
    const t03 = rowOf(ARM, 8)
    const k03 = rowOf(ARM, 15)
    let diffT = 0
    let diffK = 0
    BARS.forEach((b, i) => {
      if (UP[i] && i >= 30 && !same(sma[i], t03[i])) diffT += 1
      if (i % 2 === 0 && i >= 30 && !same(chg[i], k03[i])) diffK += 1
    })
    expect(diffT).toBeGreaterThan(150)
    expect(diffK).toBeGreaterThan(250)
  })
  it('the probe\'s own rows are refused by name, on the column route and the slot route', () => {
    for (const body of [
      'plot(close > open ? ta.sma(close, 5) : close)\n',                       // T03, a column
      'y = close > open ? ta.sma(close, 5) : close\nplot(y)\n',                // through a binding
      'plot(bar_index % 2 == 0 ? ta.change(close) : na)\n',                    // K03
      'var float s = 0.0\ns := s + 1\nplot(s > 3 ? ta.sma(close, 5) : close)\n', // the test reads a slot
      'var float s = 0.0\ns := close > open ? ta.ema(close, 5) : s\nplot(s)\n',  // the arm reads a slot
    ]) {
      const r = refusalOf(v6(body))
      expect(r && r.guard, body).toBe(R4)
      expect(r.message).toMatch(/one arm of `\?:`/)
    }
  })
  it('v6 `and` / `or` skip their right operand: refused there; v5 evaluates both: served', () => {
    const r = refusalOf(v6('plot(close > open and ta.rising(close, 2) ? 1 : 0)\n'))
    expect(r && r.guard).toBe(R4)
    expect(r.message).toMatch(/right of v6's `and`/)
    expect(refusalOf('//@version=5\nindicator("t")\nplot(close > open and ta.rising(close, 2) ? 1 : 0)\n')).toBeNull()
  })
  it('SERVED: a test fixed before bar 0 takes one arm on every bar (input, chart timeframe, symbol text)', () => {
    const [every] = run(v6('plot(ta.sma(close, 5))\n'))
    for (const body of [
      'm = input.bool(true, "m")\nplot(m ? ta.sma(close, 5) : close)\n',
      'm = input.string("A", "m")\nplot(m == "A" ? ta.sma(close, 5) : ta.ema(close, 5))\n',
    ]) {
      const [y] = run(v6(body))
      y.forEach((v, i) => expect(same(v, every[i]), `${body} bar ${i}`).toBe(true))
    }
    // the chart's timeframe flag and its symbol text are fixed for one binding: built, not refused
    expect(refusalOf(v6('plot(timeframe.isdaily ? ta.sma(close, 5) : close)\n'), { ...runtimeClockOpts(false), basePeriod: 'D' })).toBeNull()
    const sym = { ...runtimeClockOpts(false), symbol: { ticker: 'SPY', exchange: 'NYSE Arca' } }
    expect(refusalOf(v6('r = str.contains(syminfo.ticker, "/")\nplot(r ? close : ta.sma(close, 5))\n'), sym)).toBeNull()
  })
  it('SERVED: a value `switch` on an `input.string` with quoted inline arms (volume-supertrend-ai\'s `switch maSrc`)', () => {
    const body = 'maSrc = input.string("WMA", "m", options = ["SMA", "WMA"])\n'
      + 'v = switch maSrc\n    \'SMA\' => ta.sma(close, 5)\n    \'WMA\' => ta.wma(close, 5)\nplot(v)\n'
    const [y] = run(v6(body))
    const [every] = run(v6('plot(ta.wma(close, 5))\n'))
    y.forEach((v, i) => expect(same(v, every[i]), `bar ${i}`).toBe(true))
    // ⛔ the same switch on a PER-BAR text stays refused
    const r = refusalOf(v6('m = close > open ? "WMA" : "SMA"\nv = switch m\n    \'SMA\' => ta.sma(close, 5)\n    \'WMA\' => ta.wma(close, 5)\nplot(v)\n'))
    expect(r && r.guard).toBe(R4)
  })
  it('SERVED: a NAME in an arm is its own line\'s value, and chart history in an arm is the chart\'s', () => {
    expect(refusalOf(v6('ma = ta.sma(close, 5)\nplot(close > open ? ma : close)\n'))).toBeNull()
    expect(refusalOf(v6('plot(close > open ? close[1] : nz(close[2]))\n'))).toBeNull()
  })
})

describe('2 — a `ta.*` head that rewrites to offsets is the call site\'s too', () => {
  it('`ta.mom` / `ta.roc` / `ta.swma` in a block are refused by name (they were every-bar columns)', () => {
    for (const c of ['ta.mom(close, 2)', 'ta.roc(close, 2)', 'ta.swma(close)']) {
      const r = refusalOf(v6(`float y = na\nif close > open\n    y := ${c}\nplot(y)\n`))
      expect(r && r.guard, c).toBe(R4)
      expect(r.message).toContain(c.slice(0, c.indexOf('(')))
    }
  })
  it('… and stay served where they run on every bar, as does chart history in a block', () => {
    expect(refusalOf(v6('plot(ta.mom(close, 2))\nplot(ta.swma(close))\n'))).toBeNull()
    expect(refusalOf(v6('float y = na\nif close > open\n    y := close[1] - close[2]\nplot(y)\n'))).toBeNull()
  })
})

describe('3 — `ta.rma` in a block, served per call site', () => {
  it('equals Pine\'s documented recurrence over the RUNS (alpha 1/n, seeded by the mean of the first n runs)', () => {
    const n = 4
    const [y] = run(v6(`float y = na\nif close > open\n    y := ta.rma(close, ${n})\nplot(y)\n`))
    const runs = []
    let prev = NaN
    let compared = 0
    BARS.forEach((b, i) => {
      if (!UP[i]) { expect(Number.isNaN(y[i])).toBe(true); return }
      runs.push(b.c)
      let want = NaN
      if (runs.length === n) want = runs.reduce((a, x) => a + x, 0) / n
      else if (runs.length > n) want = (1 / n) * b.c + (1 - 1 / n) * prev
      if (runs.length >= n) prev = want
      expect(same(y[i], want), `bar ${i}`).toBe(true)
      compared += 1
    })
    expect(compared).toBeGreaterThan(300)
  })
  it('⚰️ and it is NOT the every-bar rma it would have been', () => {
    const [y] = run(v6('float y = na\nif close > open\n    y := ta.rma(close, 4)\nplot(y)\n'))
    const [every] = run(v6('plot(ta.rma(close, 4))\n'))
    expect(BARS.filter((b, i) => UP[i] && i > 20 && !same(y[i], every[i])).length).toBeGreaterThan(150)
  })
  it('a LOOP still refuses it (several steps a bar, never witnessed)', () => {
    const r = refusalOf(v6('float s = 0.0\nfor i = 0 to 1\n    s += ta.rma(close, 3)\nplot(s)\n'))
    expect(r && r.guard).toBe(R4)
  })
})

describe('4 — a branch on a PARAMETER is the call site\'s', () => {
  const fn = 'f(mode) =>\n    float base = na\n    if mode == "ATR"\n        base := ta.atr(3)\n    else\n        base := high - low\n    nz(base)\n'
  it('a call passing an input text compiles its own copy: the branch runs on every bar', () => {
    const [y] = run(v6(`m = input.string("ATR", "m")\n${fn}plot(f(m))\n`))
    const [every] = run(v6('plot(nz(ta.atr(3)))\n'))
    y.forEach((v, i) => expect(same(v, every[i]), `bar ${i}`).toBe(true))
    expect(refusalOf(v6(`${fn}plot(f("Percent"))\n`))).toBeNull()
  })
  it('a call passing a per-bar text is refused by name, naming the parameter', () => {
    const r = refusalOf(v6(`${fn}plot(f(close > open ? "ATR" : "P"))\n`))
    expect(r && r.guard).toBe(R4)
    expect(r.message).toMatch(/`mode` decides a branch of `f`/)
  })
  it('a `?:` on a parameter (MLExtensions\' filter_volatility) is the call site\'s too', () => {
    const fv = 'fv(simple int a, bool on) =>\n    on ? ta.atr(a) : 0.0\n'
    const [y] = run(v6(`${fv}plot(fv(3, true))\n`))
    const [every] = run(v6('plot(ta.atr(3))\n'))
    y.forEach((v, i) => expect(same(v, every[i]), `bar ${i}`).toBe(true))
    const r = refusalOf(v6(`${fv}plot(fv(3, close > open))\n`))
    expect(r && r.guard).toBe(R4)
    expect(r.message).toMatch(/`on` decides a branch of `fv`/)
  })
  it('a branch on a body LOCAL stays refused (no call site can fix it)', () => {
    const r = refusalOf(v6('g(x) =>\n    float y = na\n    k = x > 0\n    if k\n        y := ta.atr(3)\n    y\nplot(g(close - open))\n'))
    expect(r && r.guard).toBe(R4)
  })
})
