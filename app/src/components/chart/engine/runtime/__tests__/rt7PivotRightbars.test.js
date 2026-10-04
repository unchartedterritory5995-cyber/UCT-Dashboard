// app/src/components/chart/engine/runtime/__tests__/rt7PivotRightbars.test.js
//
// ─── RT7 — `ta.pivothigh` / `ta.pivotlow` `rightbars` fixed before bar 0 ──────────
//
// `pivotAtConfirmation` needs `rightbars` as a whole number (the confirmation shift `[R]`
// is a field of the node). It used to accept only a parse LITERAL, so a parameter the
// call site fixes, an input or a constant was refused "write it as a plain whole number"
// about a number the script had already fixed. The runtime lane now folds it with
// `constValueOf` (the fold every length and offset here uses) and the call proceeds to
// its REAL next wall; and the canonical `x[k]` the builder returns is handed to this
// lane in its own parse shape (`{arg, n}`), so a literal `R > 0` in a function body no
// longer refuses "a bar offset counts backwards in whole bars".
// ⭐ RT10 re-pin: a pivot over values this lane computes IS now served — a window over
// the source's own committed ring, read at the confirmation bar (`RUNTIME_WINDOW`,
// `rt10PivotOverState.test.js`). The two cases that stopped here on
// `runtime:history-expression` now BUILD, and each equals the same pivot over the
// plain price series, which the columnar lane answers.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 102 + (i % 5), l: 98 - (i % 3), c: 100 + (i % 7), v: 1000,
}))
const head = '//@version=5\nindicator("t")\n'
const build = (src) => buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const run = (built) => {
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return outputs.map((o) => Array.from(o, (v) => (Number.isFinite(v) ? v : null)))
}
const PLAIN = /write it as a plain whole number/
const prelude = 'var float k = 0.0\nk := k + 1\n'

describe('RT7 — a fixed `rightbars` is read as the number it is', () => {
  it('a call site fixing `rightbars` through a parameter is served (RT10), equal to the columnar pivot', () => {
    const r = build(`f(src, int len) => ta.pivothigh(src, len, len)\n${prelude}plot(f(high + 0 * k, 2))\nplot(ta.pivothigh(high, 2, 2))\n`)
    expect(r.ok).toBe(true)
    const out = run(r)
    expect(out[1].filter((v) => v !== null).length).toBeGreaterThan(2) // non-vacuity
    expect(out[0]).toEqual(out[1])
  })
  it('a literal `rightbars` in a function body is served the same way', () => {
    const r = build(`f(src) => ta.pivotlow(src, 3, 2)\n${prelude}plot(f(low + 0 * k))\nplot(ta.pivotlow(low, 3, 2))\n`)
    expect(r.ok).toBe(true)
    const out = run(r)
    expect(out[1].filter((v) => v !== null).length).toBeGreaterThan(2) // non-vacuity
    expect(out[0]).toEqual(out[1])
  })
  it('control: a `rightbars` only known while the bar runs keeps the builder\'s own refusal', () => {
    const r = build(`${prelude}r = int(k)\nplot(ta.pivothigh(high + 0 * k, 2, r))\n`)
    expect(r.ok).toBe(false)
    expect(String(r.refusal.message)).toMatch(PLAIN)
  })
})
