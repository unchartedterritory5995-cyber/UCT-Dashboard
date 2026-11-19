// app/src/components/chart/engine/runtime/__tests__/frameHistoryDepth.test.js
//
// ⭐⭐ engine NUMBER PENDING — THE PROGRAM CHECK READS A FUNCTION BODY'S HISTORY AGAINST ITS OWN RING.
//
// `validateProgram` proves every `READ_HIST_SLOT` stays inside its planned ring (a deeper read would answer `na`
// on every bar). Inside a function body the slot index is FRAME-relative (an invocation reads at its call site's
// `historyBase`), but the check compared every read with `p.history[a]`, the MAIN frame's entry. A body's `s[4]`
// whose frame index collided with a main ring of depth 1 was refused at lowering, naming the main variable
// (lead from the language-units agent, verified 2026-11-19):
//   `var float m = 0.0`, `m := close`, `plot(m[1])` and `f(x) => var float s = 0.0, s := x, s[4]`, `plot(f(close))`
//   → "READ_HIST_SLOT reads `m`[4] but its ring was planned for depth 1": a wrong refusal of a valid program.
// The check now asks which region a pc belongs to and, for a function body, checks the read against the
// function's ring at every call site.
import { describe, it, expect } from 'vitest'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { OP, validateProgram } from '../program.js'

const N = 10
const BARS = Array.from({ length: N }, (_, i) => ({ t: 1700000000 + i * 86400, o: 50 + i, h: 105, l: 95, c: 100 + i, v: 1 }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const lower = (src) => {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  return lowerIrProgram(b.ir)
}
const outs = (p) => execute(p, { bars: N, series: SERIES, columns: p.columns, confirmed: true }).outputs
  .map((o) => Array.from(o, (v) => (Number.isNaN(v) ? null : v)))
const lag = (xs, k) => xs.map((_, i) => (i - k >= 0 ? xs[i - k] : null))
const CLOSE = BARS.map((b) => b.c)
const OPEN = BARS.map((b) => b.o)
const F = 'f(x) =>\n    var float s = 0.0\n    s := x\n    s[4]\n'
const REPRO = `//@version=5\nindicator("t")\nvar float m = 0.0\nm := close\nplot(m[1])\n${F}plot(f(close))\n`

/** a copy of a lowered program with one READ_HIST_SLOT's offset changed, re-checked by the validator */
function withOffset(p, pick, b2) {
  const code = Int32Array.from(p.code)
  const sites = []
  for (let pc = 0; pc < p.instructions; pc += 1) if (code[pc * 3] === OP.READ_HIST_SLOT) sites.push(pc)
  code[pick(sites, p) * 3 + 2] = b2
  return () => validateProgram({ ...p, code })
}
const firstFnEntry = (p) => Math.min(...p.functions.map((f) => f.entry))

describe('a function body\'s history read is checked against its own ring, not the main frame\'s', () => {
  it('the repro builds, and both plots are the hand values (m[1] and close[4])', () => {
    const p = lower(REPRO)
    expect(p.history.map((h) => [h.name, h.depth])).toEqual([['m', 1], ['f.s', 4]])
    const [m1, f4] = outs(p)
    expect(m1).toEqual(lag(CLOSE, 1))
    expect(f4).toEqual(lag(CLOSE, 4))
  })
  it('two call sites: each invocation reads its own ring', () => {
    const p = lower(`//@version=5\nindicator("t")\nvar float m = 0.0\nm := close\nplot(m[1])\n${F}plot(f(close))\nplot(f(open))\n`)
    const [, a, b] = outs(p)
    expect(a).toEqual(lag(CLOSE, 4))
    expect(b).toEqual(lag(OPEN, 4))
  })
})

describe('the check still proves every read: too deep is a compiler error, naming the right ring', () => {
  it('a body read deeper than ITS ring (5 against f.s depth 4) is refused, naming `f.s`', () => {
    const p = lower(REPRO)
    expect(withOffset(p, (sites, q) => sites.find((pc) => pc >= firstFnEntry(q)), 5))
      .toThrow(/`f\.s`\[5\] but its ring was planned for depth 4/)
  })
  it('a main read deeper than its ring (2 against m depth 1) is refused, naming `m`', () => {
    const p = lower(REPRO)
    expect(withOffset(p, (sites, q) => sites.find((pc) => pc < firstFnEntry(q)), 2))
      .toThrow(/`m`\[2\] but its ring was planned for depth 1/)
  })
  it('CONTROL: the program as lowered passes the check', () => {
    const p = lower(REPRO)
    expect(() => validateProgram(p)).not.toThrow()
  })
})
