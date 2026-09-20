// app/src/components/chart/engine/runtime/__tests__/presentationOutputs.test.js
//
// ─── ⭐ WHICH CALLS CARRY A VALUE THIS LANE CAN COMPUTE ─────────────────────
//
// `alertcondition` and `hline` were filed under PRESENTATION and refused. The
// line between the two families is *"does this call carry a VALUE SERIES this
// lane computes?"* — and for both of these it does: `alertcondition`'s first
// argument is the condition, `hline`'s is the level. They read as decorative,
// which is a fact about what a CHART does with the answer, not about whether
// this lane can produce it.
//
// ⚠️ `fill`, `bgcolor` and `barcolor` STAY REFUSED for a real reason rather than
// an ordering: each carries a COLOUR, and a colour is not a value this lane can
// hold — the columnar lane refuses one by name at `pine:colour-value`. Serving
// them needs a colour channel, which is a capability and not a table entry.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr, RUNTIME_OUTPUT_CALLS } from '../../ast/pineRuntimeFrontend.js'
import { OUTPUT_CALLS as HOST_OUTPUT_CALLS } from '../../ast/pine.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

// ⭐ open and close CROSS here, so a condition over them is sometimes false.
const BARS = [
  { t: 1700000000, o: 100, h: 105, l: 99, c: 103, v: 10 },   // close > open
  { t: 1700086400, o: 104, h: 106, l: 100, c: 101, v: 11 },  // close < open
  { t: 1700172800, o: 101, h: 108, l: 100, c: 107, v: 12 },  // close > open
  { t: 1700259200, o: 108, h: 109, l: 102, c: 104, v: 13 },  // close < open
]
const N = BARS.length
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t")\n'

function run(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
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

describe('alertcondition carries its condition', () => {
  it('⭐ the emitted series is the condition, and it VARIES', () => {
    // ⛔ THE VARIATION IS THE RAIL. On a fixture where `close > open` on every
    // bar, a build that emitted a constant 1 — or emitted the wrong argument
    // entirely — is indistinguishable from a correct one
    // (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). These bars
    // cross deliberately.
    const r = run('alertcondition(close > open, "up", "it rose")\nplot(close)')
    expect(r.outputs).toEqual(['alertcondition', 'plot'])
    expect(r.series[0]).toEqual([1, 0, 1, 0])
  })

  it('⛔ CONTROL: the plot beside it is untouched', () => {
    const r = run('alertcondition(close > open, "up", "it rose")\nplot(close)')
    expect(r.series[1]).toEqual(BARS.map((b) => b.c))
  })
})

describe('hline carries its level', () => {
  it('⭐ the level is emitted on every bar', () => {
    const r = run('hline(50)\nplot(close)')
    expect(r.outputs).toEqual(['hline', 'plot'])
    expect(r.series[0]).toEqual([50, 50, 50, 50])
  })

  it('a bound hline emits exactly as a bare one does', () => {
    // `fill` names hlines as well as plots, so the bound spelling has to work —
    // and it goes through the same one emitter, so this holds by construction.
    expect(run('h = hline(50)\nplot(close)')).toEqual(run('hline(50)\nplot(close)'))
  })
})

describe('⛔ `fill` stays refused, and for a DIFFERENT reason now', () => {
  // ⭐⭐ THIS CASE PREDICTED ITS OWN FAILURE AND THE PREDICTION CAME TRUE ONE
  // INCREMENT LATER. It used to refuse `bgcolor` and `barcolor` alongside
  // `fill`, and said in as many words: *"if a colour ever becomes plottable,
  // this goes red and somebody revisits the family deliberately."* The colour
  // channel landed, all three went red together, and this is that revisit.
  //
  // ⭐ A rail that names the condition under which it should fail is worth more
  // than one that merely passes — it turned a surprise into a checklist item.
  it('fill(a, b, color.red)', () => {
    const r = refusalOf('fill(a, b, color.red)\nplot(close)')
    expect(r.guard).toBe('runtime:presentation')
  })

  it('⛔ and the reason is now PLOT REFERENCES, not colours', () => {
    // `fill` names two PLOTS, so it needs the output list to carry WHICH two,
    // and that list holds bare call names today. A colour is no longer the
    // blocker — the case below is what says so.
    const painted = buildRuntimeIr(`${head}bgcolor(color.red)\nplot(close)`,
      { bars: BARS, inputs: {} })
    expect(painted.ok).toBe(true)
  })
})

describe('⛔⛔ the two lanes agree about what an output IS', () => {
  it('every call the HOST lane calls an output, this lane does too', () => {
    // ⭐ ONE AUTHORITY, ASKED RATHER THAN RESTATED. Two hand-typed sets beside
    // each other is the drift this repo has paid for more than any other; the
    // host lane's table is imported and compared.
    for (const call of Object.keys(HOST_OUTPUT_CALLS)) {
      expect(RUNTIME_OUTPUT_CALLS.has(call), `${call} is an output next door`).toBe(true)
    }
  })

  it('⭐ where this lane is WIDER, the difference is named', () => {
    // All three are outputs here and not there, for one reason: the host lane
    // offers outputs to a SCREENER. A fixed level screens nothing, and you
    // cannot screen on a colour at all — which is exactly why that lane refuses
    // one by name. This lane computes bar values for DRAWING, where a level and
    // a colour are both values.
    const extra = [...RUNTIME_OUTPUT_CALLS].filter((c) => !(c in HOST_OUTPUT_CALLS))
    expect(extra).toEqual(['hline', 'bgcolor', 'barcolor'])
  })
})
