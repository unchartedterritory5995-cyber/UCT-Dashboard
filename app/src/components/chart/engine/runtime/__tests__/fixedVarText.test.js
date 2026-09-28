// app/src/components/chart/engine/runtime/__tests__/fixedVarText.test.js
//
// ─── A `var` TEXT LITERAL THAT NOTHING REASSIGNS IS A FIXED TEXT ────────────
//
// bollinger-band-width-percentile declares its option labels once —
// `var string txt5point = 'High => … => Low'` — and then writes
// `input.string(txt5point, 'Spectrum.', [txt2point, txt3point, txt5point])`.
// `admitTextInput` requires the default to lower to a compile-time string, and a
// `var` name lowers to a slot READ, so the input was refused as "a text default
// that is only known while the bar runs" about a value that never changes.
//
// ⭐ The rule is narrow on purpose: a `var` whose initialiser is a TEXT LITERAL
// and that no `:=` or compound operator writes. Its initialiser runs once and
// nothing changes it, so it holds that literal on every bar.
//
// Every expectation is computed by hand: close is 100..103, open is 99..102.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 4
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'
const LABELS = "var string A = 'Alpha'\nvar string B = 'Beta'\n"

const build = (src, inputs = {}) => buildRuntimeIr(head + src, { bars: BARS, inputs })
function run(src, inputs = {}) {
  const built = build(src, inputs)
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return Array.from(res.outputs[0])
}

describe('⭐ a text input whose default names a fixed `var` text', () => {
  it('⭐⭐ serves that text as the default — the bbwp shape', () => {
    // m defaults to 'Alpha', so `m == A` is true on every bar → close
    expect(run(`${LABELS}m = input.string(A, 'Pick', options = [A, B])\nplot(m == A ? close : open)\n`))
      .toEqual([100, 101, 102, 103])
  })

  it('⭐ a member value from the named options still wins over the default', () => {
    // 'Beta' is admitted by the list read through the fixed names → open
    expect(run(`${LABELS}m = input.string(A, 'Pick', options = [A, B])\nplot(m == A ? close : open)\n`,
      { m: 'Beta' })).toEqual([99, 100, 101, 102])
  })

  it('⛔ and a member value OUTSIDE that list is refused, not replaced', () => {
    // The options were read through the fixed names; if they had been skipped as
    // unreadable, 'Gamma' would be served with nothing red.
    const b = build(`${LABELS}m = input.string(A, 'Pick', options = [A, B])\nplot(m == A ? close : open)\n`,
      { m: 'Gamma' })
    expect(b.ok).toBe(false)
    expect(b.refusal.message).toMatch(/was given "Gamma", and the script's own author offers "Alpha", "Beta"/)
  })

  it('⛔ CONTROL — a `var` text that a branch REASSIGNS is not fixed, and is still refused', () => {
    const b = build("var string A = 'Alpha'\nif close > 101\n    A := 'Zed'\n"
      + "m = input.string(A)\nplot(m == 'Alpha' ? close : open)\n")
    expect(b.ok).toBe(false)
    expect(b.refusal.message).toMatch(/needs a text default that is fixed/)
  })

  it('⛔ CONTROL — a compound write also unfixes it', () => {
    const b = build("var string A = 'Alpha'\nA += 'x'\n"
      + "m = input.string(A)\nplot(m == 'Alpha' ? close : open)\n")
    expect(b.ok).toBe(false)
    expect(b.refusal.message).toMatch(/needs a text default that is fixed/)
  })
})
