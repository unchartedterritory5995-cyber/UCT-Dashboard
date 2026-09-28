// app/src/components/chart/engine/runtime/__tests__/treeRewrites.test.js
//
// ─── `iff`, `ta.vwma`, `ta.linreg` IN THE RUNTIME LANE (2026-09-27) ───
//
// The columnar lane rewrites these three through `pine.js::BUILTIN_CALL_TREE` during
// resolution. A subtree that reads a mutable slot never gets resolution, so over
// runtime state they arrived as `runtime:call-undeclared-builtin-state` — "a builtin
// the closed table does not declare" — though both lanes' maths already existed.
// `pineRuntimeFrontend.js::RUNTIME_TREE_REWRITES` runs the SAME builders here.
//
// Every expectation below is arithmetic on bars whose answer is known without the
// engine: `acc` counts bars (acc = bar + 1), a least-squares line through a straight
// series IS that series, and a volume-weighted mean with constant volume IS the mean.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const LF = String.fromCharCode(10)
const src = (...xs) => ['//@version=6', 'indicator("t")', ...xs].join(LF) + LF
const N = 10
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 102 + i, l: 98 + i, c: 100 + i * 2, v: 1000,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

function built(text) {
  return buildRuntimeIr(text, { bars: BARS, inputs: {} })
}
function run(text) {
  const b = built(text)
  if (!b.ok) throw new Error(`refused: ${b.refusal.guard} — ${b.refusal.message}`)
  const program = lowerIrProgram(b.ir)
  const res = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((x) => x.t),
  })
  return res.outputs.map((o) => Array.from(o, (v) => (Number.isFinite(v) ? v : null)))
}
const ACC = ['var float acc = 0.0', 'acc := acc + 1']
const close = (a, b) => a.length === b.length
  && a.every((v, i) => (v === null ? b[i] === null : b[i] !== null && Math.abs(v - b[i]) < 1e-9))

describe('⭐ iff over mutable state IS the ternary', () => {
  it('matches the same `?:` spelled out, bar for bar, with hand-computed values', () => {
    const [a, t] = run(src(...ACC,
      'plot(iff(acc % 2 == 0, acc, -acc))',
      'plot(acc % 2 == 0 ? acc : -acc)'))
    expect(a).toEqual([-1, 2, -3, 4, -5, 6, -7, 8, -9, 10])
    expect(a).toEqual(t)
  })

  it('CONTROL: without the rewrite this refused as an undeclared builtin (the census row)', () => {
    // The refusal the census recorded is the failure this file exists for; a lane that
    // lost the rewrite would say this sentence again, and the test above would throw it.
    const b = built(src(...ACC, 'plot(iff(acc > 3, 1, 0))'))
    expect(b.ok).toBe(true)
  })
})

describe('⭐ ta.linreg over mutable state IS the least-squares value', () => {
  it('a straight series is its own regression line: linreg(acc, 3, 0) = acc from bar 2, na before', () => {
    const [v] = run(src(...ACC, 'plot(ta.linreg(acc, 3, 0))'))
    expect(v).toEqual([null, null, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('the offset reads the fitted line that many bars back: linreg(acc, 4, 1) = acc − 1', () => {
    const [v] = run(src(...ACC, 'plot(ta.linreg(acc, 4, 1))'))
    expect(v).toEqual([null, null, null, 3, 4, 5, 6, 7, 8, 9])
  })

  it('on a CURVE it matches an independent least-squares fit (not the closed form re-typed)', () => {
    const [v] = run(src(...ACC, 'plot(ta.linreg(acc * acc, 5, 0))'))
    const want = Array.from({ length: N }, (_, b) => {
      if (b < 4) return null
      const xs = [0, 1, 2, 3, 4]
      const ys = xs.map((x) => (b - 4 + x + 1) ** 2)
      const mx = 2; const my = ys.reduce((s, y) => s + y, 0) / 5
      const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0)
        / xs.reduce((s, x) => s + (x - mx) ** 2, 0)
      return my + slope * (4 - mx)
    })
    expect(close(v, want), JSON.stringify({ v, want })).toBe(true)
  })
})

describe('⭐ ta.vwma inside a user function IS the volume-weighted mean', () => {
  it('with constant volume it equals the plain mean: close = 100 + 2b, so vwma(close, 3) = the 3-bar mean = close − 2', () => {
    const [v] = run(src(...ACC, 'f(len) => ta.vwma(close, len)', 'plot(f(3) + acc * 0)'))
    // bar 2: (100 + 102 + 104) / 3 = 102 — the plain mean, since volume is constant
    expect(v).toEqual([null, null, 102, 104, 106, 108, 110, 112, 114, 116])
  })
})

describe('⛔ what it will not guess', () => {
  it('a length only known while the bar runs refuses by name, not with a wrong window', () => {
    const b = built(src(...ACC, 'plot(ta.linreg(acc, int(acc), 0))'))
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:history-dynamic-offset')
    // the lane's shared sentence, naming the value it cannot know before bar 0
    expect(b.refusal.message).toMatch(/`acc` is given a value by this script/)
  })

  it('a named argument is refused, not silently reordered', () => {
    const b = built(src(...ACC, 'plot(iff(condition = acc > 3, then = 1, _else = 0))'))
    expect(b.ok).toBe(false)
    expect(b.refusal.message).toMatch(/named argument/)
  })

  it('the wrong number of arguments is said, not padded', () => {
    const b = built(src(...ACC, 'plot(ta.linreg(acc, 3))'))
    expect(b.ok).toBe(false)
    expect(b.refusal.message).toMatch(/takes 3 arguments, given 2/)
  })
})
