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

describe('⛔ the colour-bearing calls stay refused, by name', () => {
  it.each(['fill(a, b, color.red)', 'bgcolor(color.red)', 'barcolor(color.red)'])(
    '%s', (call) => {
      const r = refusalOf(`${call}\nplot(close)`)
      expect(r.guard).toBe('runtime:presentation')
    })

  it('⛔ and the reason is REAL — a colour is not a value in this lane', () => {
    // Without this the refusals above read as "not done yet" when the actual
    // blocker is a value model. If a colour ever becomes plottable, this goes
    // red and somebody revisits the family deliberately.
    const r = refusalOf('plot(color.red)')
    expect(r.guard).toBe('pine:colour-value')
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
    // `hline` is an output here and not there, deliberately: the host lane
    // offers outputs to a SCREENER, and a fixed level screens nothing. This
    // lane computes bar values, and the level is one.
    const extra = [...RUNTIME_OUTPUT_CALLS].filter((c) => !(c in HOST_OUTPUT_CALLS))
    expect(extra).toEqual(['hline'])
  })
})
