// app/src/components/chart/engine/runtime/__tests__/simpleArgWindow.test.js
//
// ─── C35 — THE RUNTIME LANE'S NEXT THREE STOPS, EACH SERVED OR NAMED EXACTLY ───
//
// (1) A `simple` argument is fixed for its CALL SITE (Pine's qualifier rule), so a
//     window a function sizes from a parameter is a constant window per call site:
//     the lane compiles one copy of the body per distinct set of such values
//     (`pineRuntimeFrontend.js::simpleSpecialisation`). An argument only known
//     while the bar runs is refused by name. Vendor proof on artemis' own
//     `drmEngine`: `vendorHarness.c35SimpleArg.test.js`.
// (2) ⛔ A WRONG VALUE, FIXED ON THE WAY: a length inside a function body was
//     folded by the top-level resolver, so a parameter that shared its name with a
//     top-level binding (`len = 3` beside `f(src, len) => ta.sma(src, len)`) ran
//     the TOP-LEVEL value's window whatever the call passed.
// (3) `runtime.error(msg)` stops the run by name where it is reached, as
//     TradingView stops the script; unreached it changes nothing.
// (4) A request below the chart's own timeframe is refused by the host's own C27
//     code (`lower-tf:unwitnessed`) before the state check, which is moot for it.
import { describe, it, expect, vi } from 'vitest'

import { buildRuntimeIr, paramQualifiers } from '../../ast/pineRuntimeFrontend.js'
import { lexPine } from '../../ast/pine.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { PineRuntimeError } from '../collections.js'

const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + (i % 5), h: 103 + ((i * 7) % 11), l: 97 - (i % 3), c: 100 + ((i * i) % 9), v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'

const build = (src) => buildRuntimeIr(src, { bars: BARS, inputs: {} })
function column(src) {
  const b = build(src)
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  const p = lowerIrProgram(b.ir)
  return { col: Array.from(execute(p, { bars: N, series: SERIES, columns: p.columns, confirmed: true }).outputs[0]), diagnostics: b.diagnostics }
}
const refusalOf = (src) => {
  const b = build(src)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}
const same = (a, b) => {
  expect(a.length).toBe(b.length)
  let finite = 0
  for (let i = 0; i < a.length; i += 1) {
    if (Number.isNaN(b[i])) { expect(Number.isNaN(a[i]), `bar ${i}`).toBe(true); continue }
    expect(a[i], `bar ${i}`).toBeCloseTo(b[i], 12)
    finite += 1
  }
  // ⛔ NON-VACUITY: a comparison of two all-NaN columns proves nothing.
  expect(finite).toBeGreaterThan(N / 2)
}

describe('(1) a `simple` argument sizes a window per call site', () => {
  it('⭐ `f(close, 5)` runs a 5-bar window — the column `ta.highest(close, 5)` gives', () => {
    const r = column(`${head}f(src, simple int len) =>\n    ta.highest(src, len)\nplot(f(close, 5))\n`)
    same(r.col, column(`${head}plot(ta.highest(close, 5))\n`).col)
    expect(r.diagnostics.specialisedCalls).toBe(1)
  })

  it('⭐⭐ two call sites with two values run two windows (never one shared)', () => {
    const r = column(`${head}f(src, simple int len) =>\n    ta.highest(src, len)\nplot(f(close, 5) - f(close, 2))\n`)
    same(r.col, column(`${head}plot(ta.highest(close, 5) - ta.highest(close, 2))\n`).col)
    // ⛔ CONTROL: the two windows differ on these bars, so a shared window is visible.
    const five = column(`${head}plot(ta.highest(close, 5))\n`).col
    const two = column(`${head}plot(ta.highest(close, 2))\n`).col
    expect(five.some((v, i) => Number.isFinite(v) && Number.isFinite(two[i]) && v !== two[i])).toBe(true)
  })

  it('⭐ an input argument folds at its default, as every length does', () => {
    same(column(`${head}n = input.int(4)\nf(src, simple int len) =>\n    ta.sma(src, len)\nplot(f(close, n))\n`).col,
      column(`${head}plot(ta.sma(close, 4))\n`).col)
  })

  it('⭐ an unqualified parameter takes its argument\'s qualifier — a literal fixes it too', () => {
    same(column(`${head}f(src, len) =>\n    ta.sma(src, len)\nplot(f(close, 4))\n`).col,
      column(`${head}plot(ta.sma(close, 4))\n`).col)
  })

  it('⭐ a parameter handed on to a helper is fixed at the helper\'s call site too', () => {
    same(column(`${head}g(src, simple int n) =>\n    ta.sma(src, n)\nf(src, simple int len) =>\n    g(src, len)\nplot(f(close, 4))\n`).col,
      column(`${head}plot(ta.sma(close, 4))\n`).col)
  })

  it('⛔ a `simple` parameter handed a value only known while the bar runs is refused by name', () => {
    const r = refusalOf(`${head}f(src, simple int len) =>\n    ta.highest(src, len)\nplot(f(close, bar_index % 3 + 1))\n`)
    expect(r.guard).toBe('runtime:history-dynamic-offset')
    expect(r.message).toContain('`len` is declared `simple` in `f`')
    expect(r.message).toContain('Pine does not compile that')
  })

  it('⛔ an unqualified parameter handed a bar-varying value is refused by name', () => {
    const r = refusalOf(`${head}f(src, len) =>\n    ta.highest(src, len)\nplot(f(close, bar_index % 3 + 1))\n`)
    expect(r.guard).toBe('runtime:history-dynamic-offset')
    expect(r.message).toContain('`len` sizes a window in `f`')
  })

  it('⛔ a parameter declared `series` is a series length — refused by name, even with a literal', () => {
    const r = refusalOf(`${head}f(src, series int len) =>\n    ta.highest(src, len)\nplot(f(close, 5))\n`)
    expect(r.guard).toBe('runtime:history-dynamic-offset')
    expect(r.message).toContain('`len` is declared `series` in `f`')
  })

  it('reads the qualifier written in front of each parameter, and nothing else', () => {
    const lexed = lexPine('f(series float src, simple int len, const string m, x, float y) => 1\n')
    const toks = lexed.tokens.filter((t) => t.kind !== 'newline')
    const arrow = toks.findIndex((t) => t.value === '=>')
    expect(Object.fromEntries(paramQualifiers(toks, arrow)))
      .toEqual({ src: 'series', len: 'simple', m: 'const' })
  })
})

describe('(2) ⛔ a frame name is never answered by the top-level binding of the same name', () => {
  it('⛔⛔ `len = 3` beside `f(src, len)` called with 5 runs a 5-bar window, not 3', () => {
    const r = column(`${head}len = 3\nf(src, len) =>\n    ta.sma(src, len)\nplot(f(close, 5))\n`)
    same(r.col, column(`${head}plot(ta.sma(close, 5))\n`).col)
    // ⛔ CONTROL: the 3-bar column differs, so the old answer would be caught.
    const three = column(`${head}plot(ta.sma(close, 3))\n`).col
    expect(r.col.some((v, i) => Number.isFinite(v) && v !== three[i])).toBe(true)
  })
})

describe('(3) `runtime.error` stops the run where it is reached', () => {
  it('⭐ unreached, it changes nothing', () => {
    same(column(`${head}if bar_index < 0\n    runtime.error("never")\nplot(close)\n`).col, SERIES[3].slice())
  })

  it('⛔ reached, the run stops by name with the script\'s own message', () => {
    const b = build(`${head}if bar_index == 7\n    runtime.error("Periods must be ascending")\nplot(close)\n`)
    expect(b.ok, b.ok ? '' : b.refusal.message).toBe(true)
    const p = lowerIrProgram(b.ir)
    let err = null
    try { execute(p, { bars: N, series: SERIES, columns: p.columns, confirmed: true }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(PineRuntimeError)
    expect(err.name).toBe('runtime.error')
    expect(err.message).toBe('Periods must be ascending')
  })

  it('⛔ it is a statement, never a value — used as one it is refused, by name', () => {
    // a value position reaches the columnar resolver, which holds no such builtin
    expect(refusalOf(`${head}x = runtime.error("x")\nplot(x)\n`).message).toContain('`runtime.error`')
  })
})

describe('(4) a request below the chart\'s timeframe is the host\'s C27 refusal, asked first', () => {
  const src = (tf) => `${head}float s = close\nif bar_index > 1\n    s := open\ne = ta.ema(s, 3)\nx = request.security(syminfo.tickerid, "${tf}", e)\nplot(x)\n`
  it('⛔ `"15"` on a daily chart is stopped by the lower-timeframe code of the host, named for this lane', () => {
    // ⚰️ C41 (2026-10-01): this read `lower-tf:unwitnessed`, naming the Q-L1
    // capture as what would settle it. Q-L1 was captured and the HOST lane serves
    // the read now (an `ltf` node off the symbol's intraday bars); the per-bar
    // runtime lane holds no intraday bars, so the same request stops it under its
    // own name (`LOWER_TF_REFUSAL.RUNTIME_LANE`) — still asked before the state check.
    // ⭐ …with the host's read SERVED (`VITE_PINE_LOWER_TF_ENABLED`). It ships OFF,
    // and then the host's own refusal is the one asked first.
    expect(refusalOf(src('15')).guard).toBe('lower-tf:store-unmeasured')
    vi.stubEnv('VITE_PINE_LOWER_TF_ENABLED', '1')
    try {
      const r = refusalOf(src('15'))
      expect(r.guard).toBe('lower-tf:runtime-lane')
      expect(r.message).toContain('intraday bars')
    } finally { vi.unstubAllEnvs() }
  })
  it('⛔ a code no capture shows read below a chart (`"30"`) keeps `lower-tf:unwitnessed`', () => {
    expect(refusalOf(src('30')).guard).toBe('lower-tf:unwitnessed')
  })
  it('⛔ CONTROL — the same request at a HIGHER timeframe still meets the state check', () => {
    expect(refusalOf(src('W')).guard).toBe('runtime:request-with-state')
  })
})
