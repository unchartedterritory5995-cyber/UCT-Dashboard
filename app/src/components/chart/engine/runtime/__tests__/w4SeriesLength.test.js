// app/src/components/chart/engine/runtime/__tests__/w4SeriesLength.test.js
//
// ─── ⭐⭐ W4-T8 — v6 `series int` WINDOW LENGTHS: THE WINDOW IS THE LAST `length` BARS, EVERY BAR ──
//
// TradingView's v6 reference declares `length (series int)` for `ta.sma`, `ta.highest`,
// `ta.stdev` and the other windowed builtins, so the length may change from bar to bar:
//   https://www.tradingview.com/pine-script-reference/v6/#fun_ta.sma
// This lane refused every such length ("only known while the bar is running"). The qualifier is
// READ from the extracted reference (`windowLengthQualifiers.json`, generated), never typed.
//
// Acceptance (REFERENCE tier until capture W4-S1 turns it into VENDOR): at each bar the value is the
// FIXED-length kernel's value at that bar's length — the pure lane's own `ta.<fn>(close, K)`.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { translatePine } from '../../ast/pine.js'
import { parseFormula } from '../../ast/parse.js'
import { interpret } from '../../ast/interpret.js'
import QUALS from '../../ast/windowLengthQualifiers.json'
import { validateIr } from '../ir.js'

const N = 60
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + i,
  h: 102 + i + (i % 3),
  l: 98 + i - (i % 4),
  c: 100 + Math.sin(i / 2.3) * 12 + i * 0.7,
  v: 1000 + i * 13,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = (v) => `//@version=${v}\nindicator("t")\n`
const X = 'var x = 0.0\nx := close\n'
/** the per-bar length: 1..7 repeating, a runtime value (`bar_index`) the fold cannot know */
const LEN = 'bar_index % 7 + 1'
const lenAt = (i) => (i % 7) + 1

const build = (src, v = 6, extra = {}) => buildRuntimeIr(head(v) + src, { bars: BARS, inputs: {}, ...extra })
function run(src, v = 6, extra = {}) {
  const built = build(src, v, extra)
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return { outs: r.outputs.map((o) => Array.from(o)), program }
}
function pureLane(expr) {
  const t = translatePine(`${head(6)}plot(${expr})\n`)
  expect(t.ok, JSON.stringify(t.refusal || {})).toBe(true)
  const parsed = parseFormula(t.outputs[0].formula)
  expect(parsed.ok).toBe(true)
  const col = interpret(parsed.ast, BARS, {})
  return Array.from({ length: N }, (_, i) => (typeof col === 'number' ? col : col[i]))
}
const same = (got, want, label) => {
  for (let i = 0; i < N; i += 1) {
    if (Number.isNaN(want[i])) expect(Number.isNaN(got[i]), `${label} bar ${i} should be na (got ${got[i]})`).toBe(true)
    else expect(got[i], `${label} bar ${i}`).toBeCloseTo(want[i], 9)
  }
}
/** the reference formula: bar i takes the fixed-length kernel's value at bar i's length */
const reference = (fn, src, lenOf) => {
  const byK = {}
  for (let i = 0; i < N; i += 1) {
    const K = lenOf(i)
    if (!byK[K]) byK[K] = pureLane(`${fn}(${src}, ${K})`)
  }
  return Array.from({ length: N }, (_, i) => byK[lenOf(i)][i])
}
const refusal = (src, v = 6, extra = {}) => {
  const b = build(src, v, extra)
  expect(b.ok, 'expected a refusal, got a program').toBe(false)
  return b.refusal
}

// every table entry the lane serves, with the Pine v6 spelling the reference uses
const FNS = ['ta.sma', 'ta.wma', 'ta.stdev', 'math.sum', 'ta.dev', 'ta.median', 'ta.highest', 'ta.lowest',
  'ta.highestbars', 'ta.lowestbars']

describe('⭐⭐ the qualifier is read from the reference, not typed', () => {
  it('every served window says `series int`; `ta.ema` and `ta.rsi` say `simple int`', () => {
    for (const f of FNS) expect(QUALS.length[f], f).toBe('series int')
    expect(QUALS.length['ta.ema']).toBe('simple int')
    expect(QUALS.length['ta.rsi']).toBe('simple int')
  })

  it('the committed table is exactly what the generator emits from the reference (when it is given)', () => {
    const ref = process.env.PINE_V6_REFERENCE
    if (!ref) return // the reference is licence-held and never committed: the heavy job sets it
    const gen = path.resolve(__dirname, '../../../../../../../tools/pine_survey/emit_length_qualifiers.js')
    expect(fs.existsSync(gen)).toBe(true)
    const ref5 = process.env.PINE_V5_REFERENCE
    expect(ref5, 'PINE_V5_REFERENCE must accompany PINE_V6_REFERENCE').toBeTruthy()
    execFileSync(process.execPath, [gen, '--ref', ref, '--ref5', ref5, '--check'], { stdio: 'pipe' })
  })
})

describe('⭐⭐ a per-bar length equals the fixed-length kernel at that bar\'s length', () => {
  for (const f of FNS) {
    it(`⭐ ${f}(x, bar_index % 7 + 1) over a runtime series`, () => {
      const { outs, program } = run(`${X}plot(${f}(x, ${LEN}))\n`)
      expect(program.windows.length).toBe(1)
      expect(program.windows[0].dynamic).toBe(true)
      same(outs[0], reference(f, 'close', lenAt), f)
    })
  }

  it('⭐ ta.highest(high, len) over a PRICE column (the commonest shape)', () => {
    const { outs } = run(`plot(ta.highest(high, ${LEN}))\n`)
    same(outs[0], reference('ta.highest', 'high', lenAt), 'highest(high)')
  })

  it('⭐ a length that is itself a variable, and a length that follows the data', () => {
    const src = `${X}len = bar_index % 5 + 2\nplot(ta.sma(x, len))\n`
    same(run(src).outs[0], reference('ta.sma', 'close', (i) => (i % 5) + 2), 'var length')
    const up = (i) => (i === 0 ? false : BARS[i].c > BARS[i - 1].c)
    const src2 = `${X}len = close > close[1] ? 4 : 1\nplot(ta.lowest(x, len))\n`
    same(run(src2).outs[0], reference('ta.lowest', 'close', (i) => (up(i) ? 4 : 1)), 'data length')
  })

  it('⭐ the length is read EVERY bar, not once (a length read at bar 0 would be 1 forever)', () => {
    const { outs } = run(`${X}plot(ta.sma(x, ${LEN}))\n`)
    // bar 6 has length 7 (a window of seven closes); a once-read length of 1 would answer the close
    const seven = BARS.slice(0, 7).reduce((a, b) => a + b.c, 0) / 7
    expect(outs[0][6]).toBeCloseTo(seven, 9)
    expect(Math.abs(outs[0][6] - BARS[6].c)).toBeGreaterThan(0.5)
  })

  it('⭐ two call sites keep two windows (one per site)', () => {
    const { outs, program } = run(`${X}plot(ta.sma(x, ${LEN}) - ta.sma(x, bar_index % 3 + 1))\n`)
    expect(program.windows.length).toBe(2)
    const a = reference('ta.sma', 'close', lenAt)
    const b = reference('ta.sma', 'close', (i) => (i % 3) + 1)
    same(outs[0], a.map((v, i) => v - b[i]), 'two sites')
  })

  it('⭐ inside a user function', () => {
    const { outs } = run(`f(s) =>\n    ta.sma(s, bar_index % 7 + 1)\n${X}plot(f(x))\n`)
    same(outs[0], reference('ta.sma', 'close', lenAt), 'udf')
  })

  it('⭐ a `na` in the source follows the same policy as the fixed window (skip: last finite values)', () => {
    const src = `${X}y = bar_index % 11 == 4 ? na : x\nplot(ta.sma(y, ${LEN}))\n`
    const { outs } = run(src)
    const want = Array.from({ length: N }, () => NaN)
    const cache = {}
    for (let i = 0; i < N; i += 1) {
      const K = lenAt(i)
      cache[K] = cache[K] || pureLane(`ta.sma(bar_index % 11 == 4 ? na : close, ${K})`)
      want[i] = cache[K][i]
    }
    same(outs[0], want, 'holey sma')
  })
})

describe('v5: served where the v5 reference declares `series int`', () => {
  it('the v5 section says `series int` for every served window and `simple int` for ta.ema', () => {
    for (const f of FNS) expect(QUALS.v5Length[f], f).toBe('series int')
    expect(QUALS.v5Length['ta.ema']).toBe('simple int')
  })
  for (const f of FNS) {
    it(`v5 ${f}(x, bar_index % 7 + 1) equals the fixed-length kernel at each bar`, () => {
      const { outs, program } = run(`${X}plot(${f}(x, ${LEN}))\n`, 5)
      expect(program.windows[0].dynamic).toBe(true)
      same(outs[0], reference(f, 'close', lenAt), `v5 ${f}`)
    })
  }
  it('v5 over a PRICE column, and the object door keeps master answer', () => {
    same(run(`plot(ta.highest(high, ${LEN}))\n`, 5).outs[0], reference('ta.highest', 'high', lenAt), 'v5 highest(high)')
    expect(refusal(`${X}plot(ta.sma(x, ${LEN}))\n`, 5, { objectDoor: true }).guard).toBe('runtime:history-dynamic-offset')
  })
  it('v5 ta.ema (simple int) is still refused', () => {
    expect(build(`${X}plot(ta.ema(x, ${LEN}))\n`, 5).ok).toBe(false)
  })
})

describe('⭐⭐ what it does NOT serve keeps its refusal by name', () => {
  it('⭐ v4 control: the same script in v4 is refused (no v4 reference section)', () => {
    const r = refusal(`${X}plot(ta.sma(x, ${LEN}))\n`, 4)
    expect(r.guard).toBe('runtime:history-dynamic-offset')
  })

  it('⭐ a `simple int` length (ta.ema) is refused in v6', () => {
    expect(build(`${X}plot(ta.ema(x, ${LEN}))\n`).ok).toBe(false)
  })

  it('⭐ the live OBJECT door keeps master\'s answer', () => {
    const r = refusal(`${X}plot(ta.sma(x, ${LEN}))\n`, 6, { objectDoor: true })
    expect(r.guard).toBe('runtime:history-dynamic-offset')
  })

  it('⭐ a foldable length is still a FIXED window (not dynamic)', () => {
    const { program } = run(`${X}plot(ta.sma(x, 5))\n`)
    expect(program.windows.map((w) => [w.span, w.dynamic === true])).toEqual([[5, false]])
  })

  it('⭐ a length that is `na`, below 1, fractional or beyond the ring stops the run BY NAME', () => {
    const stops = (lenSrc, why) => {
      expect(() => run(`${X}plot(ta.sma(x, ${lenSrc}))\n`), why).toThrow(/runtime:history-dynamic-offset/)
    }
    stops('bar_index > 3 ? na : 2', 'na')
    stops('bar_index - 5', 'zero then negative')
    stops('bar_index / 7 + 0.5', 'fractional below 1')
    stops('bar_index > 3 ? 2.5 : 2', 'fractional above 1')
    stops('bar_index > 2 ? 5001 : 2', 'beyond the ring (5000)')
  })

  it('a constant length that is no whole length (2.5, -3) keeps its build refusal in v5 and v6, not a per-bar window', () => {
    for (const v of [5, 6]) {
      for (const bad of ['2.5', '-3']) {
        const b = build(`${X}plot(ta.sma(x, ${bad}))\n`, v)
        expect(b.ok, `v${v} length ${bad} must not build`).toBe(false)
      }
    }
  })

  it('⭐ a declared `max_bars_back` is the ring: a length past it stops the run', () => {
    const src = `//@version=6\nindicator("t", max_bars_back = 10)\n${X}plot(ta.sma(x, bar_index > 20 ? 11 : 3))\n`
    const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
    expect(b.ok, b.refusal && b.refusal.message).toBe(true)
    const program = lowerIrProgram(b.ir)
    expect(program.windows[0].span).toBe(10)
    expect(() => execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true }))
      .toThrow(/runtime:history-dynamic-offset/)
  })
})

describe('⭐⭐ the IR says the same thing twice and the validator checks that they agree', () => {
  const irOf = (src) => {
    const b = build(src)
    expect(b.ok, b.refusal && b.refusal.message).toBe(true)
    return b.ir
  }
  it('⭐ a window planned per-bar whose call passes no length is rejected', () => {
    const ir = irOf(`${X}plot(ta.sma(x, ${LEN}))
`)
    expect(() => validateIr(ir)).not.toThrow()
    const bad = { ...ir, windows: ir.windows.map((w) => ({ ...w, dynamic: false })) }
    expect(() => validateIr(bad)).toThrow(/per-bar length/)
  })
  it('⭐ a fixed window whose call passes a length is rejected', () => {
    const dyn = irOf(`${X}plot(ta.sma(x, ${LEN}))
`)
    const fixed = irOf(`${X}plot(ta.sma(x, 5))
`)
    const bad = { ...dyn, windows: fixed.windows }
    expect(() => validateIr(bad)).toThrow(/per-bar length/)
  })
})

describe('⭐ serving it does not leave a refusal in the census counters', () => {
  it('⭐ the probe that found the length unfoldable is not counted as an outcome', () => {
    const b = build(`${X}plot(ta.sma(x, ${LEN}))
`)
    expect(b.ok).toBe(true)
    expect(b.diagnostics.families['runtime:history-dynamic-offset']).toBeUndefined()
  })
})
