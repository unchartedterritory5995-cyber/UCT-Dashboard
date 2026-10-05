// app/src/components/chart/engine/runtime/__tests__/rt10FrameHoist.test.js
//
// ─── ⭐⭐ RT10 — an expression's own committed series INSIDE a function frame ─────
//
// `ta.sma(x + 1, 5)` at the top level already hoists `x + 1` into a slot on the line
// above (`hoistCommittedSeries`) — the rewrite the `runtime:history-expression`
// refusal asks the member to make. Inside a function body it refused, because a slot
// declared into the caller's root list would be shared by every call site. The slot
// now lands in the FRAME's own body list, where its history is the call site's (as
// every body local's is), and only for an expression with no state of its own.
// Graded: each served form equals the SAME function written with the binding spelled
// out by hand (the form the lane already served), and a hand replay of the arithmetic;
// a stateful subexpression keeps its refusal.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + (i % 6), h: 103 + (i % 4), l: 97 - (i % 3), c: 100 + (i % 9) - 4, v: 1000 + (i % 5) * 300,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'
const build = (src) => buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
function run(src) {
  const built = build(src)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return outputs.map((o) => Array.from(o, (v) => (Number.isFinite(v) ? Math.round(v * 1e9) / 1e9 : null)))
}
const X = 'var float x = 0.0\nx := close * 2 + bar_index\n'
const xs = BARS.map((b, i) => b.c * 2 + i)
const vs = BARS.map((b) => b.v)
const winSum = (arr, n) => arr.map((_, i) => (i < n - 1 ? null : arr.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0)))
const r9 = (v) => (v === null ? null : Math.round(v * 1e9) / 1e9)

describe('⭐⭐ RT10 — a stateless expression gets its own series inside a function', () => {
  it('`ta.vwma` over a parameter (the respelled `sma(src*volume)`) equals the hand-bound form and the replay', () => {
    const out = run(`${X}f(src, len) => ta.vwma(src, len)\n`
      + 'g(src, len) =>\n    sv = src * volume\n    ta.sma(sv, len) / ta.sma(volume, len)\n'
      + 'plot(f(x, 4))\nplot(g(x, 4))\n')
    const num = winSum(xs.map((x, i) => x * vs[i]), 4)
    const den = winSum(vs, 4)
    const want = num.map((n, i) => (n === null ? null : r9(n / den[i])))
    expect(want.filter((v) => v !== null).length).toBeGreaterThan(30)
    expect(out[0]).toEqual(want)
    expect(out[1]).toEqual(want)
  })

  it('an expression of two parameters, two call sites keep two series (`math.sum(v * w, p)`)', () => {
    const out = run(`${X}dot(v, w, p) => math.sum(v * w, p)\nplot(dot(x, volume, 3))\nplot(dot(x, x, 2))\n`)
    expect(out[0]).toEqual(winSum(xs.map((x, i) => x * vs[i]), 3).map(r9))
    expect(out[1]).toEqual(winSum(xs.map((x) => x * x), 2).map(r9))
  })

  it('a single-line body with a fixed-offset read of a parameter (`ta.highest(s[2], k)`)', () => {
    // graded against the hand-bound form (the lane's `highest` keeps its measured
    // RESTART rule after the two leading `na` bars), and a replay past the warm-up
    const out = run(`${X}f(s, k) => ta.highest(s[2], k)\ng(s, k) =>\n    l = s[2]\n    ta.highest(l, k)\n`
      + 'plot(f(x, 3))\nplot(g(x, 3))\n')
    expect(out[0]).toEqual(out[1])
    const lag = xs.map((_, i) => (i < 2 ? null : xs[i - 2]))
    for (let i = 4; i < N; i += 1) expect(out[0][i]).toBe(Math.max(lag[i], lag[i - 1], lag[i - 2]))
  })

  it('`(v + 1)[2]` and `ta.change(v * 2)` in a frame read the CALL SITE\'s ring (two sites, two rings)', () => {
    const out = run(`${X}f(v) => (v + 1)[2]\ng(v) => ta.change(v * 2)\n`
      + 'plot(f(x))\nplot(f(volume))\nplot(g(x))\nplot(g(volume))\n')
    expect(out[0]).toEqual(xs.map((_, i) => (i < 2 ? null : xs[i - 2] + 1)))
    expect(out[1]).toEqual(vs.map((_, i) => (i < 2 ? null : vs[i - 2] + 1)))
    expect(out[2]).toEqual(xs.map((v, i) => (i < 1 ? null : r9(v * 2 - xs[i - 1] * 2))))
    expect(out[3]).toEqual(vs.map((v, i) => (i < 1 ? null : r9(v * 2 - vs[i - 1] * 2))))
  })

  it('a STATEFUL subexpression is not hoisted out of where it was written (refusal kept)', () => {
    // RT12 re-pin (measured): a STATEFUL expression evaluated on EVERY evaluation of
    // the result now hoists too (`rt12StatementsHistory.test.js` (3)); the wall stands
    // where the hoist WOULD change when it runs - inside a `?:` arm.
    const b = build(`${X}f(s, c) => c ? ta.sma(ta.ema(s, 3) * 2, 4) : 0.0\nplot(f(x, close > open))\n`)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:history-expression')
  })

  it('control: the top-level hoist is unchanged', () => {
    const out = run(`${X}plot(math.sum(x * volume, 3))\n`)
    expect(out[0]).toEqual(winSum(xs.map((x, i) => x * vs[i]), 3).map(r9))
  })
})
