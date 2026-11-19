// app/src/components/chart/engine/runtime/__tests__/udtReaderDepth.test.js
//
// ─── ⭐⭐ ENGINE NUMBER PENDING (S14 fix 3) — THE USER-TYPE READER'S DEPTH TRAVELS THROUGH `fieldPathOf` ─────
//
// `udtTypeOf` bounds its own walk with a depth, but asked `fieldPathOf` about a dotted name, and `fieldPathOf` asked
// `udtTypeOf` about the binding of that name's head with the depth reset to 0. A binding whose own value reads a
// path with its name as the head (`string timeframe = timeframe.period`, then `timeframe.period` read again) went
// round that loop until the stack overflowed: an engine defect (S14), 5 walls in 3 sample scripts
// (market-sessions-and-volume-profile, volume-open-interest-footprint, fibonacci-extention-retracment). With the
// depth carried, the answer at the bound is `null`, which IS the answer: a `string` has no fields, so the dotted
// name is not a field path and is read as what it is, the built-in.
//
// The rule is the language's: renaming a variable changes nothing else. So each script equals the same script with
// its variable renamed, bar for bar.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + (i % 7), h: 108 + (i % 5), l: 92 - (i % 3), c: 100 + ((i * 3) % 11), v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const HEAD = '//@version=5\nindicator("t")\n'

function build(src) {
  return buildRuntimeIr(src, { bars: BARS, inputs: {}, ...runtimeClockOpts(false) })
}
function run(src) {
  const b = build(src)
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  const program = lowerIrProgram(b.ir, { historyFromListing: true })
  return execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true }).outputs.map((o) => Array.from(o))
}
const same = (a, b) => a.length === b.length && a.every((x, i) => (Number.isNaN(x) && Number.isNaN(b[i])) || x === b[i])

const CASES = {
  'a string named `timeframe` read back through `timeframe.period`':
    ['string timeframe = timeframe.period\nx = timeframe.period == "D" ? 1 : 0\nplot(close + x)\n',
      'string tfName = timeframe.period\nx = timeframe.period == "D" ? 1 : 0\nplot(close + x)\n'],
  'the market-sessions shape: a ternary over `timeframe.isintraday` and `timeframe.period`':
    ['string timeframe = timeframe.isintraday ? "1D" : timeframe.period\nx = timeframe.period == "D" ? 2 : 0\nplot(close + x)\n',
      'string tfName = timeframe.isintraday ? "1D" : timeframe.period\nx = timeframe.period == "D" ? 2 : 0\nplot(close + x)\n'],
  'the path read inside a function body':
    ['string timeframe = timeframe.period\nf(x) =>\n    timeframe.period == "D" ? x : 0.0\nplot(f(close))\n',
      'string tfName = timeframe.period\nf(x) =>\n    timeframe.period == "D" ? x : 0.0\nplot(f(close))\n'],
}
// (⚠️ not here: `float syminfo = …` then `syminfo.mintick` is refused `pine:type` by name before and after this
// fix, a separate limitation; it never reached the loop)

describe('S14 fix 3 — a binding named like a namespace no longer sends the user-type reader round in a loop', () => {
  for (const [what, [named, renamed]] of Object.entries(CASES)) {
    it(`${what}: builds, and equals the same script with the variable renamed`, () => {
      const r = build(`${HEAD}${named}`)
      expect(r.ok, r.refusal && r.refusal.message).toBe(true)
      const a = run(`${HEAD}${named}`)
      const b = run(`${HEAD}${renamed}`)
      expect(a.length).toBe(1)
      expect(same(a[0], b[0])).toBe(true)
      expect(a[0].some(Number.isFinite)).toBe(true)
    })
  }
})

describe('S14 fix 3 — CONTROL: a real field path through a binding still resolves', () => {
  it('`g = Foo.new(2.5)` then `g.a` reads the field', () => {
    const [o] = run(`${HEAD}type Foo\n    float a = 1.0\ng = Foo.new(2.5)\nplot(g.a)\n`)
    expect(o.every((v) => v === 2.5)).toBe(true)
  })
  it('a record field through a chain of bindings (`g = Foo.new(…)`, `h = g`) still resolves', () => {
    const [o] = run(`${HEAD}type Foo\n    float a = 1.0\ng = Foo.new(close)\nh = g\nplot(h.a)\n`)
    expect(same(o, Array.from(SERIES[3]))).toBe(true)
  })
})
