// @vitest-environment node
// app/src/components/chart/engine/ast/objectElseArmNaBool.test.js
//
// ─── ⭐⭐ OBJECTS C — AN `else` ARM OVER A `bool` THAT CAN BE `na` RUNS WHERE THE TEST IS `na` ─────────────────────
//
// Pine takes the ELSE arm of an `if` / `?:` whose test is `na` (v1-v5: `not na` is true, `na` reads false in a
// condition; S1 / s18 and the RT1 captures). The host object program composes an arm's guard as the AND of its tests,
// an `else` arm as `!test`. A NUMBER test was already read as `x != 0` there; a `bool` test that can be `na`
// (`b := c ? true : na`, a `bool(na)` latch) stayed the bare series, its `!` answered `na`, and the arm NEVER drew.
// ⚰️ Measured on relative-strength-index-divergences-libertus (licence-held RDDT 1D capture, TradingView 48 labels):
// the host drew 39, every low PIVOT (`… : pivoth ? label.new(…) : pivotl ? label.new(…) : na`, `pivoth := … ? true :
// na`) missing, and nothing was counted as dropped. Graded here on synthetic shapes against the bars by hand.
// Mutation-proved: `ci/mutants/object-else-arm-na-bool.json`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { hostObjectRun, hostObjectReaderOpts } from '../hostObjects'

const N = 60
const BARS = Array.from({ length: N }, (_, i) => {
  const o = 100 + Math.sin(i / 3) * 5
  const c = o + (i % 2 ? 1 : -1)
  return { t: 1700000000 + i * 86400, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 1000 + i }
})
const head = (v) => `//@version=${v}\n${v >= 5 ? 'indicator' : 'study'}("else-na", overlay = false)\n`
// `e` is true on bars 7, 17, ... and `na` elsewhere; `f` is true on bars 5, 15, ... and `na` elsewhere
const NA_BOOLS = 'e = bool(na)\ne := bar_index % 10 == 7 ? true : na\nf = bool(na)\nf := bar_index % 10 == 5 ? true : na\n'
const SHAPES = {
  ternary: 'l = e ? label.new(bar_index, 1, "E") : f ? label.new(bar_index, 2, "F") : na\nplot(close)\n',
  ifElse: 'if e\n    label.new(bar_index, 1, "E")\nelse\n    if f\n        label.new(bar_index, 2, "F")\nplot(close)\n',
}
const at = (k) => Array.from({ length: N }, (_, i) => i).filter((i) => i % 10 === k)

function labelsOf(source) {
  const d = memberPaneDefinition({ source, id: 'u_else_na', name: 'e' })
  expect(d.ok, d.reason).toBe(true)
  expect(d.definition.objects, 'the host document carries its object program').toBeTruthy()
  const r = hostObjectRun(d.definition, BARS, hostObjectReaderOpts({ tf: 'D', historyFromListing: true }))
  const by = {}
  for (const o of r.run.live.filter((x) => x.family === 'label')) (by[o.props.text] = by[o.props.text] || []).push(o.props.x)
  for (const k of Object.keys(by)) by[k].sort((a, b) => a - b)
  return { by, drops: (d.translation.objectDiagnostics || {}).dropReasons || {} }
}

beforeEach(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterEach(() => { vi.unstubAllEnvs() })

describe('an else arm over a bool that can be na draws where the test is na', () => {
  for (const v of [4, 5]) {
    for (const [shape, body] of Object.entries(SHAPES)) {
      it(`v${v} ${shape}: the then arm on e's bars, the else arm on f's (e is na there), nothing dropped`, () => {
        const { by, drops } = labelsOf(head(v) + NA_BOOLS + body)
        expect(by.E).toEqual(at(7))
        expect(by.F).toEqual(at(5))
        expect(Object.values(drops).filter((n) => n > 0)).toEqual([])
      })
    }
  }
  it('CONTROL: tests that are never na (comparisons) draw both arms, as before', () => {
    const src = head(5) + 'e = bar_index % 10 == 7\nf = bar_index % 10 == 5\n' + SHAPES.ternary
    const { by } = labelsOf(src)
    expect(by.E).toEqual(at(7))
    expect(by.F).toEqual(at(5))
  })
  it('CONTROL: the else arm still needs its own test (f is na on the other bars: nothing there)', () => {
    const { by } = labelsOf(head(5) + NA_BOOLS + SHAPES.ternary)
    const drawn = new Set([...(by.E || []), ...(by.F || [])])
    for (let i = 0; i < N; i += 1) if (i % 10 !== 7 && i % 10 !== 5) expect(drawn.has(i), `bar ${i}`).toBe(false)
  })
})
