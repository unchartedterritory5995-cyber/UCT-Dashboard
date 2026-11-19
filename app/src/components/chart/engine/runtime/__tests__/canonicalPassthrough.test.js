// app/src/components/chart/engine/runtime/__tests__/canonicalPassthrough.test.js
//
// ─── ⭐⭐ ENGINE NUMBER PENDING (S14 fix 2) — A CALLER'S OWN ARGUMENT INSIDE A BUILT TREE STAYS ITSELF ─────────
//
// Some built-ins are lowered through a canonical tree (`PINE_NAMESPACED_TREE`): `ta.highestbars(src, len)` is
// `-highestbars(src, len)` (`pine.js::negatedBars`), with the caller's own `src` embedded as it was parsed.
// `fromCanonical` turns the tree into this lane's parse shape and promises to pass a parse node through untouched,
// but `call` and `offset` are spelled with one `type` in both dialects and were read as canonical: a caller's
// `high[2]` lost its operand (a TypeError, which S14 labels an engine defect: committed:smarter-snr), and a caller's
// `ta.sma(high, 3)` was double-wrapped and refused `pine:statement`. Both are told apart by SHAPE now.
//
// The rule is the language's: an argument is its value. So the call over an expression equals the same call over
// a name bound to that expression, bar for bar, which this lane computes by a separate path (a slot source).
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 90
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + ((i * 7) % 11),
  h: 110 + ((i * 13) % 17) + (i % 3),
  l: 85 - ((i * 5) % 9),
  c: 100 + ((i * 11) % 13),
  v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
// a length only known while the bar runs: a `var` the bars move between 2 and 8
const HEAD = '//@version=5\nindicator("t")\nvar int n = 2\nn := close > open ? math.min(n + 1, 8) : 2\n'

function build(src) {
  return buildRuntimeIr(src, { bars: BARS, inputs: {} })
}
function run(src) {
  const b = build(src)
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  const program = lowerIrProgram(b.ir, { historyFromListing: true })
  return execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true }).outputs.map((o) => Array.from(o))
}
const same = (a, b) => a.length === b.length && a.every((x, i) => (Number.isNaN(x) && Number.isNaN(b[i])) || x === b[i])

const SOURCES = ['high[2]', 'low[1]', 'ta.sma(high, 3)', 'math.max(high, low[1])', '(high + low) / 2']
const LENGTHS = ['5', 'n']

describe('S14 fix 2 — `ta.highestbars` / `ta.lowestbars` over an expression equal the same call over a name bound to it', () => {
  for (const name of ['ta.highestbars', 'ta.lowestbars']) {
    for (const src of SOURCES) {
      for (const len of LENGTHS) {
        it(`${name}(${src}, ${len})`, () => {
          const inline = run(`${HEAD}plot(${name}(${src}, ${len}))\n`)
          const bound = run(`${HEAD}s = ${src}\nplot(${name}(s, ${len}))\n`)
          expect(same(inline[0], bound[0])).toBe(true)
          // ⛔ non-vacuous: a real offset on some bars, zero on others
          expect(inline[0].some((v) => v < 0) && inline[0].some((v) => v === 0)).toBe(true)
        })
      }
    }
  }
  it('the series length really varies (the dynamic window is exercised)', () => {
    const lens = run(`${HEAD}plot(n)\n`)[0]
    expect(new Set(lens.filter(Number.isFinite)).size).toBeGreaterThan(2)
  })
})

describe('S14 fix 2 — the canonical spellings still convert (the shape test does not pass them through)', () => {
  // ⭐ Only a length known while the bar runs takes `ta.highestbars` / `ta.lowestbars` through the built tree on
  // this lane (a fixed length is a pure column, and the pivots are lowered before the tree), so these use `n`.
  it('a built tree\'s OWN canonical call and canonical source still convert: one argument equals `(high, n)`', () => {
    // `ta.highestbars(n)` builds its own canonical `high` (a `series` node) inside its own canonical call
    const one = run(`${HEAD}plot(ta.highestbars(n))\n`)
    const two = run(`${HEAD}plot(ta.highestbars(high, n))\n`)
    expect(same(one[0], two[0])).toBe(true)
    expect(one[0].some((v) => v < 0)).toBe(true)
  })
  it('and for `ta.lowestbars(n)` against `(low, n)`', () => {
    const one = run(`${HEAD}plot(ta.lowestbars(n))\n`)
    const two = run(`${HEAD}plot(ta.lowestbars(low, n))\n`)
    expect(same(one[0], two[0])).toBe(true)
  })
})
