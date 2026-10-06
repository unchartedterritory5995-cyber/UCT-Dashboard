// app/src/components/chart/engine/runtime/__tests__/rt7Carried2InFunction.test.js
//
// ─── ⭐⭐ RT7 — `ta.valuewhen` and the cross family INSIDE a user function ──────
//
// `OP.CARRIED2` had no frame-relative base, so both refused inside a function body
// ("each invocation needs its own occurrence ring"). The two-input store is now
// materialised per CALL SITE (`carried2Base`, as `OP.CARRIED`'s `carriedBase`), so
// two call sites of one body keep two rings / two previous-bar pairs. Graded against
// a HAND REPLAY of Pine's semantics on the bars: `ta.valuewhen(c, s, k)` is `s` on the
// k-th most recent bar where `c` was true (na before k+1 firings); `ta.crossover(a, b)`
// is `a > b and a[1] <= b[1]`, na-aware (na while either pair is incomplete).
// Control: each call site equals the same call written at top level.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 60
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 3) + (i % 7)
  const o = 100 + 10 * Math.sin((i - 1) / 3) + ((i + 3) % 5)
  return { t: 1700000000 + i * 86400, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 1000 + i }
})
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'

function run(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return outputs.map((o) => Array.from(o, (v) => (Number.isFinite(v) ? v : null)))
}

const valuewhen = (cond, src, k) => {
  const fired = []
  return cond.map((c, i) => {
    if (c) fired.push(src[i])
    return fired.length > k ? fired[fired.length - 1 - k] : null
  })
}
const crossover = (a, b) => a.map((x, i) => (i === 0 ? null : (x > b[i] && a[i - 1] <= b[i - 1] ? 1 : 0)))

describe('⭐⭐ RT7 — two-input carried state inside a user function, per call site', () => {
  const C = BARS.map((b) => b.c)
  const O = BARS.map((b) => b.o)
  const H = BARS.map((b) => b.h)
  // `var` state makes each argument runtime state, so the call cannot be routed to the columnar lane
  const prelude = 'var float k = 0.0\nk := k + 1\nup = close + 0 * k > open\ndn = close + 0 * k < open\n'

  it('two call sites of one `valuewhen` helper keep two rings (each equals the hand replay)', () => {
    const out = run(prelude + 'vw(c, s, int n) => ta.valuewhen(c, s, n)\n'
      + 'plot(vw(up, close + 0 * k, 0))\nplot(vw(dn, high + 0 * k, 1))\n')
    const up = C.map((c, i) => c > O[i])
    const dn = C.map((c, i) => c < O[i])
    expect(out[0]).toEqual(valuewhen(up, C, 0))
    expect(out[1]).toEqual(valuewhen(dn, H, 1))
    expect(out[0].filter((v) => v !== null).length).toBeGreaterThan(10) // non-vacuity
    expect(out[0]).not.toEqual(out[1])
  })

  it('two call sites of one `crossover` helper keep two previous-bar pairs', () => {
    const out = run(prelude + 'xo(a, b) => ta.crossover(a, b)\n'
      + 'plot(xo(close + 0 * k, open) ? 1 : 0)\nplot(xo(open + 0 * k, close) ? 1 : 0)\n')
    // bar 0: the pair is incomplete, so the cross is na and `na ? 1 : 0` is na (v5, not
    // from the listing: `runtime:na-test` is RT3's ruling, unchanged here)
    const a = crossover(C, O)
    const b = crossover(O, C)
    expect(out[0]).toEqual(a)
    expect(out[1]).toEqual(b)
    expect(a.some((v) => v === 1) && b.some((v) => v === 1)).toBe(true) // non-vacuity: both fire
  })

  it('control: the helper equals the same calls written at top level', () => {
    const inFn = run(prelude + 'vw(c, s) => ta.valuewhen(c, s, 0)\nplot(vw(up, close + 0 * k))\nplot(vw(dn, open + 0 * k))\n')
    const top = run(prelude + 'plot(ta.valuewhen(up, close + 0 * k, 0))\nplot(ta.valuewhen(dn, open + 0 * k, 0))\n')
    expect(inFn).toEqual(top)
    const xIn = run(prelude + 'xo(a, b) => ta.crossover(a, b)\nplot(xo(close + 0 * k, open) ? 1 : 0)\n')
    const xTop = run(prelude + 'plot(ta.crossover(close + 0 * k, open) ? 1 : 0)\n')
    expect(xIn).toEqual(xTop)
  })
})
