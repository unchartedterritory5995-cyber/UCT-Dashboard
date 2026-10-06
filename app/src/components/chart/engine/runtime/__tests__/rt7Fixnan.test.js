// app/src/components/chart/engine/runtime/__tests__/rt7Fixnan.test.js
//
// ─── ⭐⭐ RT7 — Pine's `fixnan(x)` on the runtime lane ───────────────────────────
//
// The Pine reference: `fixnan(source)` "for a given series replaces NaN values with
// previous nearest non-NaN value". So: `x` where `x` is real, else the most recent real
// value of `x`, and `na` until `x` has had one. The columnar lane refuses it on purpose
// (`pine:na`: an unbounded carry has no window); this lane carries one cell
// (`CARRIED.fixnanPine`), frame-relative per call site like every carried member.
// Graded against a hand replay of that rule over a series with leading, isolated and
// runs of `na`; no TradingView capture exercises it (Q-RT7b queues one).
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 103 + (i % 4), l: 97 - (i % 3), c: 100 + (i % 9) - 4, v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'

function run(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return outputs.map((o) => Array.from(o, (v) => (Number.isFinite(v) ? v : null)))
}
const replay = (xs) => { let last = null; return xs.map((x) => { if (x !== null) last = x; return last }) }
// `x` is na on bars 0-2, every bar where close > open + 2, and bars 20-26
const X = 'x = bar_index < 3 or (bar_index >= 20 and bar_index <= 26) or close > open + 2 ? na : close\n'
const xs = BARS.map((b, i) => (i < 3 || (i >= 20 && i <= 26) || b.c > b.o + 2 ? null : b.c))

describe('⭐⭐ RT7 — fixnan carries the last non-na value', () => {
  it('equals the hand replay on every bar (leading na stays na)', () => {
    const out = run(`${X}plot(fixnan(x))\nplot(x)\n`)
    expect(out[1]).toEqual(xs) // non-vacuity: the input really has leading, isolated and run na
    expect(xs.slice(0, 3)).toEqual([null, null, null])
    expect(xs.filter((v) => v === null).length).toBeGreaterThan(9)
    expect(out[0]).toEqual(replay(xs))
  })

  it('two call sites of one function keep two memories', () => {
    const out = run(`${X}f(s) => fixnan(s)\nplot(f(x))\nplot(f(bar_index % 3 == 0 ? high : na))\n`)
    expect(out[0]).toEqual(replay(xs))
    expect(out[1]).toEqual(replay(BARS.map((b, i) => (i % 3 === 0 ? b.h : null))))
  })

  it('control: the script\'s own `fixnan` wins over the builtin', () => {
    const own = run(`${X}fixnan(s) => nz(s, -1)\nplot(fixnan(x))\n`)
    expect(own[0]).toEqual(xs.map((v) => (v === null ? -1 : v)))
  })
})
