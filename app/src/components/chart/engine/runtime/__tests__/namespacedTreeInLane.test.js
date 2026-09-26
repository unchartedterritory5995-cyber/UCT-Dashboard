// app/src/components/chart/engine/runtime/__tests__/namespacedTreeInLane.test.js
//
// ─── ⛔⛔ THE TRANSFORM MAP MUST REACH THE LANE THAT LOWERS FUNCTION BODIES ──
//
// `PINE_NAMESPACED_TREE` rewrites a Pine call into the tree that means the same
// thing here — `ta.pivothigh`'s confirmation shift, `ta.highestbars`' sign,
// `math.round(v, n)`'s precision scaling. It is applied during RESOLUTION, and
// resolution is what a PURE subtree gets: those go to the columnar lane.
//
// ⛔ A USER FUNCTION BODY IS NOT PURE — its expressions read parameters, which
// are slots — so it is lowered by `lowerExpr`, which dispatches on the parse
// node and never consulted the map. The same call therefore meant two different
// things depending on whether it sat at the top level or inside a `f(x) =>`:
//
//     plot(math.round(close / 3, 1))        compiled
//     p(t, b) => math.round(…, 1)           refused
//
// ⚰️⚰️ THIS IS RC-E'S SHAPE FOR THE THIRD TIME. RC-A taught the resolver a rule
// and the drawing lane never got it; RC-F reconciled `time` and the object lane
// did not move; and here a transform map is consulted by one of the two places
// that lower a call. Each time the fix was correct and each time it was only as
// wide as the lane it was measured in.
//
// ⛔ AND THE TWO LANES SPEAK DIFFERENT DIALECTS, which is the part that bites:
// the map emits CANONICAL nodes (`{type:'num'}`, `{type:'series'}`) while this
// lowerer handles PARSE nodes (`{type:'number'}`, `{type:'name'}`). A canonical
// tree handed straight to `lowerExpr` dies on its first literal. The adapter is
// named, is one function, and is asserted here — a silent mix-up of these two
// vocabularies already cost a debugging session on 2026-09-22.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 8
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 104 + i, l: 96 - i, c: 100 + i, v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'

function run(src) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return Array.from(r.outputs[0])
}

describe('⭐⭐ a transform reaches a user function body', () => {
  it('⭐⭐ `math.round(v, n)` inside a function — the `ict-ipda` shape', () => {
    // The corpus script is `percenter(top, bottom) =>
    //   math.round(((close - bottom) / (top - bottom)) * 100, 1)`.
    const out = run(`${head}p(t, b) =>\n    math.round(((close - b) / (t - b)) * 100, 1)\n`
      + 'plot(p(high, low))\n')
    for (let i = 0; i < N; i += 1) {
      const { c, h, l } = BARS[i]
      const want = Math.round((((c - l) / (h - l)) * 100) * 10) / 10
      expect(out[i], `bar ${i}`).toBeCloseTo(want, 9)
    }
    // ⛔ CONTROL — the fixture must actually produce fractions, or a transform
    // that dropped the precision would pass unnoticed.
    expect(out.some((v) => !Number.isInteger(v)), 'nothing had a fractional part').toBe(true)
  })

  it('⭐ variadic `math.max` inside a function body too', () => {
    const out = run(`${head}pick(a, b, c) =>\n    math.max(a, b, c)\n`
      + 'plot(pick(open, close, high))\n')
    for (let i = 0; i < N; i += 1) {
      expect(out[i], `bar ${i}`).toBe(Math.max(BARS[i].o, BARS[i].c, BARS[i].h))
    }
  })

  it('⛔⛔ THE DIALECT IS BRIDGED — a canonical literal survives the lowering', () => {
    // ⚰️ `math.round`'s transform embeds `cNum(10)`, which is `{type:'num'}`.
    // This lowerer's number case is `'number'`. Without the adapter the tree
    // dies on that node, and the failure surfaces far from its cause.
    // ⭐ The case is written so the LITERAL is load-bearing: a precision of 0
    // still scales by `pow(10, 0)`, so the canonical `10` is present even
    // though the answer is a whole number.
    const out = run(`${head}q(x) =>\n    math.round(x, 0)\n`
      + 'plot(q(close / 3))\n')
    for (let i = 0; i < N; i += 1) {
      expect(out[i], `bar ${i}`).toBeCloseTo(Math.round(BARS[i].c / 3), 9)
    }
  })

  it('⛔ CONTROL — the top-level form still behaves identically', () => {
    // ⭐ NON-REGRESSION for the lane that already worked. The two must agree,
    // because the whole complaint was that they did not.
    const inside = run(`${head}r(x) =>\n    math.round(x, 2)\n`
      + 'plot(r(close / 3))\n')
    const top = run(`${head}plot(math.round(close / 3, 2))\n`)
    expect(inside).toEqual(top)
  })

  it('⛔ CONTROL — an ordinary table call in a body is untouched', () => {
    // A name the map does not rewrite must take exactly the path it took
    // before; the new lookup sits in front of every call in every body.
    const out = run(`${head}s(x) =>\n    math.abs(x)\n`
      + 'plot(s(close - 104))\n')
    for (let i = 0; i < N; i += 1) expect(out[i], `bar ${i}`).toBe(Math.abs(BARS[i].c - 104))
  })
})
