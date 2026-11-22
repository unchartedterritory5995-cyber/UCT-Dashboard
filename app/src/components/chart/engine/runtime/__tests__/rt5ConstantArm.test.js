// app/src/components/chart/engine/runtime/__tests__/rt5ConstantArm.test.js
//
// ─── L4 — AN `if` WHOSE TEST IS A SCRIPT CONSTANT, IN THE DRAWING BUILD ──────
//
// Pine keeps a `ta.*` call's history per call site: inside an `if` it steps only
// on the bars the block runs. A test built only from inputs (at their values),
// literals and the chart's own timeframe (`timeframe.isweekly`) is the same on
// every bar, so the block runs on EVERY bar (history = an unconditional call) or
// on NONE (the call never runs). RT5 used to refuse both as
// `runtime:conditional-history`; it now admits exactly that case. A test that can
// change from bar to bar keeps the refusal, and every admitted rail has a control
// that must come out the other way. The shape is RS Rating's (Fred6724, MPL-2.0)
// MA ladder: `rsMA := ta.ema(rs, lenMa)` under `if (typMa == 'EMA' and not
// timeframe.isweekly)`.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 300
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 7) + i * 0.05
  return { t: 1700000000 + i * 86400, o: c - 0.5 + (i % 3) * 0.4, h: c + 1, l: c - 1, c, v: 1000 + (i % 13) * 10 }
})
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const CLOSE = BARS.map((b) => b.c)
const src = (...lines) => ['//@version=6', 'indicator("t", overlay = true)', ...lines,
  'if barstate.islast', '    label.new(bar_index, m)'].join('\n') + '\n'

// the chart's timeframe reaches the columns as the product run hands it (`runtimeColumns.js`)
const build = (s, tf = 'D') => buildRuntimeIr(s, {
  bars: BARS, inputs: {}, objectsInRun: true, tf, basePeriod: tf, ...runtimeClockOpts(false, { tf }),
})

/** The y of the one label drawn on the last bar. */
function lastY(s, tf = 'D') {
  const built = build(s, tf)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true, barTimes: BARS.map((b) => b.t),
  })
  const labels = res.objects.finish().live.filter((o) => o.family === 'label')
  expect(labels).toHaveLength(1)
  expect(labels[0].props.x).toBe(N - 1)
  return labels[0].props.y
}
const refusalOf = (s, tf = 'D') => {
  const built = build(s, tf)
  return built.ok ? null : built.refusal.guard
}

// Pine's definitions, by hand over every bar: the SMA window, and the EMA seeded
// by the mean of its first `len` values.
const smaAt = (i, len) => CLOSE.slice(i - len + 1, i + 1).reduce((a, b) => a + b, 0) / len
const emaAt = (i, len) => {
  let e = smaAt(len - 1, len)
  for (let k = len; k <= i; k += 1) e = (2 / (len + 1)) * CLOSE[k] + (1 - 2 / (len + 1)) * e
  return e
}

const LADDER = [
  'typMa = input.string("EMA", options = ["SMA", "EMA"])',
  'lenMa = input(21)',
  'm = ta.sma(close, lenMa)',
  'if (typMa == "SMA" and not timeframe.isweekly)',
  '    m := ta.sma(close, lenMa)',
  'if (typMa == "EMA" and not timeframe.isweekly)',
  '    m := ta.ema(close, lenMa)',
]

describe('L4 — a constant test: the arm runs on every bar, and its history is the unconditional one', () => {
  it('the RS Rating MA ladder builds, and the label reads the every-bar EMA', () => {
    expect(lastY(src(...LADDER))).toBeCloseTo(emaAt(N - 1, 21), 9)
  })

  it('the `else` of a constant chain is constant too: it runs on every bar', () => {
    const y = lastY(src('typ = input.string("EMA")', 'm = 0.0',
      'if typ == "SMA"', '    m := 1.0', 'else', '    m := ta.ema(close, 5)'))
    expect(y).toBeCloseTo(emaAt(N - 1, 5), 9)
  })

  it('a block local\'s `[1]` inside a constant arm is the bar before', () => {
    const y = lastY(src('typ = input.string("EMA")', 'm = 0.0',
      'if typ == "EMA"', '    s = ta.sma(close, 3)', '    m := s[1]'))
    expect(y).toBeCloseTo(smaAt(N - 2, 3), 9)
  })
})

describe('L4 — a constant-false test: the arm never runs', () => {
  it('`typ == "SMA"` at the default "EMA" leaves the seed', () => {
    expect(lastY(src('typ = input.string("EMA")', 'm = 0.0', 'if typ == "SMA"', '    m := ta.sma(close, 5)'))).toBe(0)
  })

  it('on a weekly chart the ladder\'s daily arms are dead: the value is the unconditional SMA', () => {
    expect(lastY(src(...LADDER), 'W')).toBeCloseTo(smaAt(N - 1, 21), 9)
  })

  it('control: on a daily chart the same `not timeframe.isweekly` arm runs', () => {
    const s = src('m = 0.0', 'if not timeframe.isweekly', '    m := ta.ema(close, 5)')
    expect(lastY(s, 'D')).toBeCloseTo(emaAt(N - 1, 5), 9)
    expect(lastY(s, 'W')).toBe(0)
  })
})

// ⭐ L4d (re-pinned): a per-bar block's `ta.ema` is now served per call site (W3N-D1b), so these
// controls use `ta.wma`, which no capture witnesses for a drawing: a per-bar test still refuses it,
// while under a constant arm it reads the every-bar column.
describe('L4 — a test that can change from bar to bar keeps the refusal, by name', () => {
  it('CONTROL: under a constant arm the same `ta.wma` builds (the per-bar test, not the kind, refuses below)', () => {
    expect(refusalOf(src('typ = input.string("EMA")', 'm = 0.0', 'if typ == "EMA"', '    m := ta.wma(close, 5)'))).toBe(null)
  })
  it('control: `if close > open` around a `ta.wma` refuses', () => {
    expect(refusalOf(src('lenMa = input(21)', 'm = ta.sma(close, lenMa)',
      'if close > open', '    m := ta.wma(close, lenMa)'))).toBe('runtime:conditional-history')
  })

  it('control: a per-bar `else if` after a constant first arm refuses (each arm is the tests before it too)', () => {
    expect(refusalOf(src('typ = input.string("EMA")', 'm = 0.0',
      'if typ == "SMA"', '    m := 1.0', 'else if close > open', '    m := ta.wma(close, 5)'))).toBe('runtime:conditional-history')
  })

  it('control: a per-bar block inside a constant arm refuses', () => {
    expect(refusalOf(src('typ = input.string("EMA")', 'm = 0.0',
      'if typ == "EMA"', '    if close > open', '        m := ta.wma(close, 5)'))).toBe('runtime:conditional-history')
  })

  it('control: a constant arm inside a per-bar block refuses', () => {
    expect(refusalOf(src('typ = input.string("EMA")', 'm = 0.0',
      'if close > open', '    if typ == "EMA"', '        m := ta.wma(close, 5)'))).toBe('runtime:conditional-history')
  })
})

describe('L4 — in a function body the constant arm is judged at the CALL SITE', () => {
  const F = ['typ = input.string("EMA")', 'f() =>', '    float r = 0.0', '    if typ == "EMA"', '        r := ta.ema(close, 5)', '    r']

  it('called on every bar, the body\'s constant arm builds and reads the every-bar EMA', () => {
    expect(lastY(src(...F, 'm = f()'))).toBeCloseTo(emaAt(N - 1, 5), 9)
  })

  it('control: the same function called inside a per-bar block refuses', () => {
    expect(refusalOf(src(...F, 'm = 0.0', 'if close > open', '    m := f()'))).toBe('runtime:conditional-history')
  })

  it('control: a per-bar block in a body, called inside a constant arm, refuses', () => {
    expect(refusalOf(src('typ = input.string("EMA")', 'f() =>', '    float r = 0.0',
      '    if close > open', '        r := ta.ema(close, 5)', '    r',
      'm = 0.0', 'if typ == "EMA"', '    m := f()'))).toBe('runtime:conditional-history')
  })

  it('control: the same, with a `simple` parameter the call site fixes (its own copy, compiled there), refuses', () => {
    expect(refusalOf(src('typ = input.string("EMA")', 'f(simple int len) =>', '    float r = 0.0',
      '    if close > open', '        r := ta.ema(close, len)', '    r',
      'm = 0.0', 'if typ == "EMA"', '    m := f(5)'))).toBe('runtime:conditional-history')
  })
})
