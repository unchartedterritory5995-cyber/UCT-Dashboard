// app/src/components/chart/engine/runtime/__tests__/boundPlot.test.js
//
// ─── ⚰️⚰️ A BOUND PLOT USED TO DISAPPEAR ────────────────────────────────────
//
// `plot(close)` as a STATEMENT emitted an output. The same call on the right of
// a binding — `p = plot(close)` — fell through to the ordinary-binding path,
// was lowered as an ordinary expression, and emitted NOTHING. The script
// compiled, answered `ok`, and drew one line where the author wrote two.
//
// ⛔⛔ AND IT IS THE STANDARD IDIOM WHEREVER `fill` IS USED. Pine's `fill` takes
// plot IDs, so a script that fills a band binds its plots first — 64 of the 266
// corpus scripts mention `fill`. Every one of them was losing plots silently.
//
// ⭐ A REFUSAL WOULD HAVE BEEN FAR BETTER THAN THIS. A member reading a chart
// with a line missing and no reason given has nothing to act on; that is why
// the fix is ONE emitter both spellings call, rather than a second code path
// that happens to agree today.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 6
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t")\n'

function run(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return { outputs: program.outputs, series: res.outputs.map((o) => Array.from(o)) }
}

const refusalOf = (src) => {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  expect(built.ok, 'expected a refusal, got a program').toBe(false)
  return built.refusal
}

describe('a plot bound to a name still draws', () => {
  it('⭐⭐ THE BOUND FORM AND THE BARE FORM PRODUCE THE SAME PROGRAM', () => {
    // ⛔ THE COMPARISON IS THE RAIL, not a count. Asserting "two outputs" would
    // pass on a build that emitted the right NUMBER of plots carrying the wrong
    // series — which is exactly what the defect did on the two-plot case that
    // first exposed it (one output, and it held `open`).
    const bare = run('plot(close)\nplot(open)')
    const bound = run('p = plot(close)\nplot(open)')
    const both = run('p1 = plot(close)\np2 = plot(open)')
    expect(bound.outputs).toEqual(bare.outputs)
    expect(bound.series).toEqual(bare.series)
    expect(both.outputs).toEqual(bare.outputs)
    expect(both.series).toEqual(bare.series)
  })

  it('⛔ CONTROL: the first plot really is `close`, not `open`', () => {
    // Without this the case above is satisfied by three builds that are equally
    // wrong in the same way (`lesson_a_fixture_that_cannot_distinguish…`).
    const bound = run('p = plot(close)\nplot(open)')
    expect(bound.series[0]).toEqual(BARS.map((b) => b.c))
    expect(bound.series[1]).toEqual(BARS.map((b) => b.o))
  })

  it('every output call binds the same way', () => {
    // The emitter is shared, so this holds by construction — the case exists so
    // that a future call added to only one of the two spellings fails here.
    for (const call of ['plot', 'plotshape', 'plotchar', 'plotarrow']) {
      const bare = run(`${call}(close)`)
      const bound = run(`x = ${call}(close)`)
      // ⛔⛔ EACH SPELLING IS CHECKED AGAINST THE TRUTH, NOT AGAINST THE OTHER.
      // ⚰ A first version asserted only `bound.outputs === bare.outputs`, and a
      // mutation that hard-coded the emitter to push `'plot'` for EVERY call
      // passed all six cases — both spellings were wrong in the same way, so
      // comparing them to each other could not tell
      // (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). The output
      // has to record the call the author actually wrote, because that is what
      // decides how it is drawn.
      expect(bare.outputs, call).toEqual([call])
      expect(bound.outputs, call).toEqual([call])
      expect(bound.series, call).toEqual(bare.series)
    }
  })
})

describe('⛔ a plot id is not a number', () => {
  it('reading one is refused BY ITS OWN NAME', () => {
    // ⚰️ This reached `runtime:unbound` — *"this Pine name was never given a
    // value"* — about a name the script gives a value to one line above, which
    // sends the reader hunting for a typo that is not there.
    const r = refusalOf('p = plot(close)\nplot(p + 1)')
    expect(r.guard).toBe('runtime:plot-id')
    expect(r.message).toMatch(/plot id/)
    expect(r.message).toContain('`p`')
  })

  it('⛔ and it is NOT a crash — the columnar lane never sees it', () => {
    // ⚰️ Binding the id in `env` (the pure-expression macro map the COLUMNAR
    // resolver reads) made that resolver dereference `bound.node.type` on an
    // entry with no node, and the member got *"Cannot read properties of
    // undefined"* — a TypeError wearing a refusal's clothes.
    const r = refusalOf('p = plot(close)\nplot(p + 1)')
    expect(r.message).not.toMatch(/Cannot read propert/)
    expect(r.line).toBeGreaterThan(0)
  })

  it('⛔ CONTROL: a genuinely unknown name still says so', () => {
    // The new refusal must be narrow. A name nobody bound is a different fact
    // and keeps its own sentence.
    expect(refusalOf('plot(nosuchthing)').guard).toBe('pine:undefined')
  })
})
