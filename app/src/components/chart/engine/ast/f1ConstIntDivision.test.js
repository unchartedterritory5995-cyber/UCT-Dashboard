// app/src/components/chart/engine/ast/f1ConstIntDivision.test.js
//
// ─── F1 — Pine's `/` between two `const int` TRUNCATES before v6 ─────────────
//
// WITNESSED on TradingView, `vw-int-div-assign` (AMEX:SPY 1D, v5, CAP round 4,
// tests/fixtures/vendor/harness/vw-int-div-assign-spy-1d-2026-10-02.json), every
// row constant across all 300 bars:
//
//   D01  sens = input.int(28)   sens /= 100     -> 0.28   an INPUT int keeps the fraction
//   D02  a = 28                 a /= 100        -> 0      const int / const int
//   D03  28 / 100                               -> 0
//   D04  b = input.int(28)      b / 100         -> 0.28
//   D05  c = 28                 c := c / 100    -> 0      a reassigned name stays const
//
// The rule lives in ONE place (`pine.js::pineConstIntValue`), asked by BOTH lanes:
// the columnar translator (a `/` it can prove const-int is written as the number)
// and the runtime lane (`constIntWritesOf` settles a mutated name's value).
// v6 keeps the fraction (`docs/pine/pine-version-evolution.md` row 47) — not
// captured here, and pinned only as that documented rule.
import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'
import { interpret } from './interpret.js'

const N = 6
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 103 + i, l: 98 + i, c: (i % 2 ? 99 : 101) + i, v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

const PROBE = `//@version=5
indicator("UCTPROBE_VW_INT_DIV_ASSIGN", overlay = false)
sens = input.int(28, minval = 1, title = "Sensitivity")
sens /= 100
plot(sens, "D01_input_int_div_assign")
a = 28
a /= 100
plot(a, "D02_int_literal_div_assign")
plot(28 / 100, "D03_int_literal_over_int")
b = input.int(28, title = "B")
plot(b / 100, "D04_input_int_over_int")
c = 28
c := c / 100
plot(c, "D05_int_reassigned_quotient")
`
const VENDOR = { D01: 0.28, D02: 0, D03: 0, D04: 0.28, D05: 0 }

/** ⭐ Every source ends with a bar-reading control plot: a script whose every
 *  column is constant refuses `pine:constant-only`, which is not this question. */
const CTL = 'plot(close, "ctl")\n'

/** The columnar lane: every plot's value on the first bar. */
function hostValues(src) {
  const t = translatePine(src + CTL, {})
  expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
  const out = {}
  for (const o of t.outputs) {
    if (o.kind !== 'plot' || !o.ast || o.title === 'ctl') continue
    out[o.title] = interpret(o.ast, BARS, {})[0]
  }
  return out
}

/** The runtime lane: every plot's value on the first bar, by output order. */
function runtimeValues(src) {
  const built = buildRuntimeIr(src + CTL, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return r.outputs.slice(0, -1).map((col) => Array.from(col))
}

describe('⭐⭐ F1 — the columnar lane draws what TradingView drew (vw-int-div-assign)', () => {
  it.each(Object.entries(VENDOR))('%s', (row, want) => {
    const got = hostValues(PROBE)
    const key = Object.keys(got).find((k) => k.startsWith(row))
    expect(key, `no plot ${row}`).toBeTruthy()
    expect(got[key]).toBeCloseTo(want, 12)
  })

  it('control: the five rows are not one answer (the probe can tell the two readings apart)', () => {
    const vals = Object.values(hostValues(PROBE))
    expect(new Set(vals.map((v) => Math.round(v * 100))).size).toBe(2)
  })
})

describe('⭐⭐ F1 — the runtime lane draws the same', () => {
  it('every D row, in output order', () => {
    const cols = runtimeValues(PROBE)
    expect(cols.map((c) => c[0])).toEqual([0.28, 0, 0, 0.28, 0])
    for (const c of cols) expect(new Set(c).size, 'a constant row').toBe(1)
  })

  it('a slot reassigned at the top level stays const int (`var`-free `a /= 100`)', () => {
    const src = '//@version=5\nindicator("t")\na = 7\na /= 2\nplot(a)\nplot(a / 2)\n'
    const cols = runtimeValues(src)
    expect(cols[0][0]).toBe(3)
    expect(cols[1][0]).toBe(1)
  })
})

describe('what is NOT a const int keeps the fraction (both lanes)', () => {
  const cases = [
    ['a float literal', 'plot(28.0 / 100)', 0.28],
    ['a `float` declaration', 'float a = 28\nplot(a / 100)', 0.28],
    ['a `var` declaration', 'var a = 28\nplot(a / 100)', 0.28],
    ['an input int', 'n = input.int(7)\nplot(n / 2)', 3.5],
    ['a name reassigned under a condition', 'x = 10\nif close > open\n    x := 3\nplot(x / 4)', null],
  ]
  it.each(cases)('%s', (_, body, want) => {
    const src = `//@version=5\nindicator("t")\n${body}\n`
    const host = Object.values(hostValues(src))[0]
    const rt = runtimeValues(src)[0]
    if (want === null) {
      // x is 3 on an up bar and 10 otherwise: 0.75 / 2.5, never the truncated 0 / 2
      for (let i = 0; i < N; i += 1) {
        const up = BARS[i].c > BARS[i].o
        expect(rt[i], `runtime bar ${i}`).toBe(up ? 0.75 : 2.5)
      }
      return
    }
    expect(host).toBeCloseTo(want, 12)
    expect(rt[0]).toBeCloseTo(want, 12)
  })
})

describe('the rest of the arithmetic and the version gate', () => {
  it('`/` truncates toward zero inside a larger const expression (`close * (3 / 2)` is `close * 1`)', () => {
    const v = Object.values(hostValues('//@version=5\nindicator("t")\nplot(close * (3 / 2))\n'))[0]
    expect(v).toBe(BARS[0].c)
  })

  it('a const quotient used as a WINDOW is the truncated one (`ta.sma(close, 7 / 2)` is 3 bars)', () => {
    const t = translatePine('//@version=5\nindicator("t")\nplot(ta.sma(close, 7 / 2))\n', {})
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    expect(t.outputs[0].formula).toMatch(/sma\(close, 3\)/)
  })

  it('v6 keeps the fraction of a const quotient (documented rule 47, not captured)', () => {
    const v = Object.values(hostValues('//@version=6\nindicator("t")\nplot(28 / 100)\n'))[0]
    expect(v).toBeCloseTo(0.28, 12)
    expect(runtimeValues('//@version=6\nindicator("t")\na = 28\na /= 100\nplot(a)\n')[0][0]).toBeCloseTo(0.28, 12)
  })

  it('a const division by zero is not a number this rule invents', () => {
    const v = Object.values(hostValues('//@version=5\nindicator("t")\nplot(close + 5 / 0)\n'))[0]
    expect(Number.isFinite(v)).toBe(false)
  })
})
