// app/src/components/chart/engine/runtime/__tests__/colourNaSelector.test.js
//
// ─── ⭐⭐ OWNER RULING 2 (2026-09-28): AN `na` COLOUR CONDITION TAKES THE ELSE
// BRANCH, IN THE RUNTIME LANE TOO ────────────────────────────────────────────
//
// Pine's `cond ? a : b` over colours is `b` when `cond` is `na`. This lane's `?:`
// is `interpret.js::TERNARY`, which answers NaN for a NaN test — right for a
// VALUE (the value lane's semantics are not this ruling's) and wrong for a
// colour, where NaN is no colour at all. A colour ternary's test is lowered as
// `t != 0`, and `!=` is a comparison, which answers 0 for NaN.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { colourHexByName } from '../../ast/pine.js'
import { hexToPacked } from '../colours.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const BARS = [
  { t: 1700000000, o: 100, h: 105, l: 99, c: 103, v: 10 },
  { t: 1700086400, o: 104, h: 106, l: 100, c: 101, v: 11 },
  { t: 1700172800, o: 101, h: 108, l: 100, c: 107, v: 12 },
]
const N = BARS.length
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'

function run(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return res.outputs.map((o) => Array.from(o))
}

const RED = hexToPacked(colourHexByName('color.red', 5), 0)
const GREEN = hexToPacked(colourHexByName('color.green', 5), 0)

// `t` is a `var bool` that starts `na` and becomes true only on bar 2.
const NA_UNTIL_BAR_2 = 'var bool t = na\nif close > 106\n    t := true\n'

describe('a colour conditional over an `na` test', () => {
  it('⭐⭐ takes the ELSE branch on every bar the test is `na`', () => {
    const out = run(`${NA_UNTIL_BAR_2}bgcolor(t ? color.red : color.green)\nplot(close)`)[0]
    // ⚰️ Without the ruling these two bars were NaN — no colour at all, where
    // Pine paints the else colour.
    expect(out[0]).toBe(GREEN)
    expect(out[1]).toBe(GREEN)
    // ⛔ NON-VACUITY: once the test is KNOWN it picks its own side.
    expect(out[2]).toBe(RED)
  })

  it('⭐ a test that is `na` on EVERY bar paints the else colour on every bar', () => {
    const out = run('bool t = na\nbgcolor(t ? color.red : color.green)\nplot(close)')[0]
    expect(out).toEqual([GREEN, GREEN, GREEN])
  })

  it('⛔ CONTROL — a VALUE ternary keeps the value lane\'s rule: an `na` test is `na`', () => {
    // This ruling is about colours. The same `?:` over numbers still answers
    // `na` for an `na` test, bar for bar.
    const out = run(`${NA_UNTIL_BAR_2}plot(t ? 1 : 2)`)[0]
    expect(Number.isNaN(out[0])).toBe(true)
    expect(Number.isNaN(out[1])).toBe(true)
    expect(out[2]).toBe(1)
  })
})
