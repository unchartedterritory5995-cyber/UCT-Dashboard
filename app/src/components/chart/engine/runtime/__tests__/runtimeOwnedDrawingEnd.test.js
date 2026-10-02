// app/src/components/chart/engine/runtime/__tests__/runtimeOwnedDrawingEnd.test.js
//
// ─── ⭐ R1 STEP 3 — A FUNCTION THAT ENDS IN A DRAWING THE OBJECT PASS OWNS ────
//
// `runtime:object-op` in the BARE census is a property of the harness
// (`runtimeCorpusCensus.measure.test.js` says so and rails it): a build that is
// not told who owns the drawing refuses every drawing call. Under ownership
// (`objectTrees`, as `buildObjectLane` and `probeObjectRuntime` pass it) a
// drawing STATEMENT is skipped — but a function whose LAST line is one
// (`liquidation-levels`' `f_print` ends in `label.set_text(…)`) still had that
// line lowered as its RESULT and refused `runtime:object-op`.
//
// Such a function has no value THIS lane computes: it is compiled valueless,
// exactly like a function ending in a loop (C18) — every statement lowered, the
// drawing skipped as the object program's, and a call that READS its result
// refused by name. Called on a line of its own, nothing is lost.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 30
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i + (i % 2), v: 100,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const HEAD = '//@version=5\nindicator("t", overlay = true)\n'
const OWNED = { objectTrees: [] }

const build = (body, extra = OWNED) => buildRuntimeIr(`${HEAD}${body}\n`, { bars: BARS, inputs: {}, ...extra })
const run = (body) => {
  const built = build(body)
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return outputs.map((o) => Array.from(o))
}

const ENDS_IN_SETTER = `f_print(_y) =>
    var _lbl = label.new(bar_index, _y, "x")
    label.set_xy(_lbl, bar_index, _y)
    label.set_text(_lbl, "y")
f_print(close)
plot(close)`

const ENDS_IN_CHAIN = `make(isIt) =>
    if isIt
        label.new(bar_index, high, "up")
    else
        label.new(bar_index, low, "dn")
make(close > open)
plot(close)`

describe('⭐ under ownership, a body that ends in a drawing is valueless', () => {
  it('a last-line setter: the function runs for its effect and the plot draws', () => {
    expect(run(ENDS_IN_SETTER)[0]).toEqual(BARS.map((b) => b.c))
  })

  it('a trailing `if` chain whose every arm ends in a drawing: the same', () => {
    expect(run(ENDS_IN_CHAIN)[0]).toEqual(BARS.map((b) => b.c))
  })

  it('⛔ a call that READS its result refuses by name', () => {
    const built = build(ENDS_IN_CHAIN.replace('make(close > open)', 'h = make(close > open)\nplot(h)'))
    expect(built.ok).toBe(false)
    expect(built.refusal.guard).toBe('runtime:function')
    expect(built.refusal.message).toMatch(/ends in a drawing, which the object program draws/)
  })

  it('⛔ an arm that ends in a VALUE keeps the chain a value — not valueless', () => {
    const built = build(`make(isIt) =>
    if isIt
        label.new(bar_index, high, "up")
    else
        1
h = make(close > open)
plot(h)`)
    expect(built.ok).toBe(false)
    expect(built.refusal.guard).toBe('runtime:object-op')
  })
})

describe('⛔ without ownership nothing changes', () => {
  it('the drawing still refuses as an object op', () => {
    for (const src of [ENDS_IN_SETTER, ENDS_IN_CHAIN]) {
      const built = build(src, {})
      expect(built.ok).toBe(false)
      expect(built.refusal.guard).toBe('runtime:object-op')
    }
  })
})
