// app/src/components/chart/engine/runtime/__tests__/rt10CumOverState.test.js
//
// ─── ⭐⭐ RT10 — `ta.cum` over RUNTIME STATE ─────────────────────────────────────
//
// The columnar `cum` carries the vendor's three facts (`interpret.js::cumCol`, SPY 1D
// 2026-09-08): `na` before the first finite input, `na` ON an `na` bar, the total HELD
// across it. Over a value the runtime lane computes it refused
// `runtime:call-windowed-state`; it is now a carried cell with the same rule. Graded
// against a hand replay of that sentence AND the columnar `cum` over the same values
// written as a pure expression.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 30
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + (i % 4), h: 104, l: 96, c: 100 + (i % 7) - 3, v: 1000 + i * 10,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const build = (src, head = '//@version=5\nindicator("t")\n') => buildRuntimeIr(head + src, { bars: BARS, inputs: {}, pane: true })
function run(src, head) {
  const built = build(src, head)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return { outputs: outputs.map((o) => Array.from(o, (v) => (Number.isFinite(v) ? v : null))), program }
}
const replay = (xs) => { let t = 0; return xs.map((v) => { if (v === null) return null; t += v; return t }) }
// na on bars 0-1 (before the first finite), 9 and 15-16 (held across)
const isNa = (i) => i < 2 || i === 9 || i === 15 || i === 16
const xs = BARS.map((b, i) => (isNa(i) ? null : b.c - b.o))
const X = 'var float x = na\nx := bar_index < 2 or bar_index == 9 or bar_index == 15 or bar_index == 16 ? na : close - open\n'

describe('⭐⭐ RT10 — ta.cum over runtime state carries the vendor rule', () => {
  it('equals the hand replay and the columnar cum over the same values', () => {
    const { outputs, program } = run(`${X}y = bar_index < 2 or bar_index == 9 or bar_index == 15 or bar_index == 16 ? na : close - open\n`
      + 'plot(ta.cum(x))\nplot(ta.cum(y))\n')
    expect(program.carried.map((c) => c.fn)).toContain('cumPine') // non-vacuity: the runtime twin ran
    const want = replay(xs)
    expect(want[2]).not.toBe(null)
    expect(want[9]).toBe(null)
    expect(outputs[0]).toEqual(want)
    expect(outputs[1]).toEqual(want)
  })

  it('two call sites of one function keep two totals; v4 bare `cum` is Pine\'s', () => {
    const { outputs } = run(`${X}f(s) => cum(s)\nplot(f(x))\nplot(f(x * 2))\n`, '//@version=4\nstudy("t")\n')
    expect(outputs[0]).toEqual(replay(xs))
    expect(outputs[1]).toEqual(replay(xs.map((v) => (v === null ? null : v * 2))))
  })

  it('a screen (no pane) keeps the window-dependent refusal', () => {
    const b = buildRuntimeIr(`//@version=5\nindicator("t")\n${X}plot(ta.cum(x))\n`, { bars: BARS, inputs: {} })
    expect(b.ok).toBe(false)
  })

  it('control: the script\'s own `cum` wins', () => {
    const { outputs } = run('var float x = na\nx := close\ncum(s) => s + 1\nplot(cum(x))\n', '//@version=4\nstudy("t")\n')
    expect(outputs[0]).toEqual(BARS.map((b) => b.c + 1))
  })
})
