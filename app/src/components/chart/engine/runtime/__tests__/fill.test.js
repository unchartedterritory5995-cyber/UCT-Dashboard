// app/src/components/chart/engine/runtime/__tests__/fill.test.js
//
// ─── ⭐⭐ `fill(p1, p2, colour)` — THE BAND BETWEEN TWO PLOTS ────────────────
//
// `fill` is the top presentation blocker in the corpus: the first refusal for 9
// of the 266 scripts and mentioned by 64. It blocked on TWO different things in
// turn, and both are now gone:
//
//   1. a COLOUR was not a value this lane could hold   → the colour channel
//   2. an OUTPUT could not say WHICH TWO PLOTS it spans → the descriptor
//
// ⭐ The second is why an output stopped being a bare call name. `fill` emits a
// colour series like `bgcolor` does, but it also has to record the two outputs
// it sits between — and a string cannot carry that.
//
// ⭐⭐ THE TWO PLOTS ARE COMPILE-TIME HANDLES, which is what made this tractable.
// Pine's plot ids cannot be computed, so `fill` never needs a runtime value for
// them: it needs the output INDEX, which `plotRefs` already holds from the day
// the bound-plot defect was fixed.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { makeProgram, OP } from '../program.js'
import { colourHexByName } from '../../ast/pine.js'
import { hexToPacked } from '../colours.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const BARS = [
  { t: 1700000000, o: 100, h: 105, l: 99, c: 103, v: 10 },   // close > open
  { t: 1700086400, o: 104, h: 106, l: 100, c: 101, v: 11 },  // close < open
  { t: 1700172800, o: 101, h: 108, l: 100, c: 107, v: 12 },  // close > open
]
const N = BARS.length
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t")\n'
const RED = hexToPacked(colourHexByName('color.red', 6), 0)
const GREEN = hexToPacked(colourHexByName('color.green', 6), 0)

function run(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return { outputs: program.outputs, series: res.outputs.map((o) => Array.from(o, (v) => v >>> 0)) }
}

const refusalOf = (src) => {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  expect(built.ok, 'expected a refusal, got a program').toBe(false)
  return built.refusal
}

describe('a fill records the two plots it spans', () => {
  it('⭐⭐ THE SPAN IS THE POINT — the descriptor names both indices', () => {
    // ⛔ ASSERTING ONLY "it compiled" would pass on a fill that recorded the
    // wrong two plots, which draws a band between the wrong pair and looks
    // entirely deliberate. The indices are what a renderer reads.
    const r = run('p1 = plot(close)\np2 = plot(open)\nfill(p1, p2, color.red)')
    expect(r.outputs.map((o) => o.call)).toEqual(['plot', 'plot', 'fill'])
    expect(r.outputs[2]).toMatchObject({ call: 'fill', upper: 0, lower: 1 })
  })

  it('⛔ CONTROL: the indices follow the ORDER the plots were declared', () => {
    // Swapping the arguments must swap the recorded span. Without this, a build
    // that hard-coded `{upper: 0, lower: 1}` passes the case above.
    const r = run('p1 = plot(close)\np2 = plot(open)\nfill(p2, p1, color.red)')
    expect(r.outputs[2]).toMatchObject({ upper: 1, lower: 0 })
  })

  it('the emitted series is the COLOUR, and it varies', () => {
    const r = run(
      'p1 = plot(close)\np2 = plot(open)\n'
      + 'fill(p1, p2, close > open ? color.green : color.red)')
    expect(r.series[2]).toEqual([GREEN, RED, GREEN])
  })

  it('a named `color =` argument is the same fill', () => {
    const named = run('p1 = plot(close)\np2 = plot(open)\nfill(p1, p2, color = color.red)')
    const positional = run('p1 = plot(close)\np2 = plot(open)\nfill(p1, p2, color.red)')
    expect(named).toEqual(positional)
  })

  it('hlines can be filled between too', () => {
    // ⭐ This is why `hline` became an output. `fill` names hlines exactly as it
    // names plots, and a fixed level is a value this lane computes.
    const r = run('h1 = hline(50)\nh2 = hline(60)\nfill(h1, h2, color.red)\nplot(close)')
    expect(r.outputs.map((o) => o.call)).toEqual(['hline', 'hline', 'fill', 'plot'])
    expect(r.outputs[2]).toMatchObject({ upper: 0, lower: 1 })
  })
})

describe('⛔ what a fill refuses, and by which name', () => {
  it('an argument that is not a plot names WHICH argument', () => {
    // `fill(close, open, color.red)` is a real mistake. "Expected a plot"
    // without saying which side sends a member to check both.
    const r = refusalOf('fill(close, open, color.red)\nplot(close)')
    expect(r.guard).toBe('runtime:fill-target')
    expect(r.message).toMatch(/argument 1/)
  })

  // ⭐⭐ WS-E — THE GRADIENT FORM WAS REFUSED BY ITS OWN NAME (`runtime:fill-gradient`)
  // and is now LOWERED AS AN UNDRAWN FILL: no fill is drawn from the run (the solid
  // form's colour column has no reader either), and the member pane names every run
  // fill in its "Not drawn by this pane" note. The refusal took the whole script off
  // the lane for a band the solid form would not have drawn. Asserted here: it is
  // recognised as a GRADIENT (never read as a solid fill of the wrong colour), it
  // spans the two plots it names, and its column carries no colour (`na`).
  const gradientOf = (src) => {
    const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
    expect(built.ok, built.refusal && built.refusal.message).toBe(true)
    const program = lowerIrProgram(built.ir)
    const res = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true, barTimes: BARS.map((b) => b.t) })
    return { outputs: program.outputs, series: res.outputs.map((o) => Array.from(o)) }
  }
  it('⭐⭐ THE GRADIENT FORM (six positionals) is a gradient fill, spanning its plots, with no colour column', () => {
    const r = gradientOf('p1 = plot(close)\np2 = plot(open)\nfill(p2, p1, 1, 2, color.red, color.green)')
    expect(r.outputs[2]).toMatchObject({ call: 'fill', upper: 1, lower: 0, gradient: true })
    expect(r.series[2].every((v) => Number.isNaN(v))).toBe(true)
  })

  it('⭐ the builtin RSI\'s spelling — four positionals and NAMED colours — is the gradient form too', () => {
    const r = gradientOf('p1 = plot(close)\np2 = plot(open)\n'
      + 'fill(p1, p2, 100, 70, top_color = color.new(color.green, 0), bottom_color = color.new(color.green, 100))')
    expect(r.outputs[2]).toMatchObject({ call: 'fill', gradient: true })
  })

  it('⭐ an all-NAMED gradient (no positional values at all) is the gradient form', () => {
    const r = gradientOf('p1 = plot(close)\np2 = plot(open)\n'
      + 'fill(p1, p2, top_value = 1, bottom_value = 2, top_color = color.red, bottom_color = color.green)')
    expect(r.outputs[2]).toMatchObject({ call: 'fill', gradient: true })
  })

  it('⛔ CONTROL — a number where the colour goes, then a TITLE, is a solid fill with a bad colour, not a gradient', () => {
    expect(refusalOf('p1 = plot(close)\np2 = plot(open)\nfill(p1, p2, close, "band")').guard).toBe('runtime:colour')
  })

  it('⛔ CONTROL — a solid fill with a colour and a TITLE is not a gradient', () => {
    const r = gradientOf('p1 = plot(close)\np2 = plot(open)\nfill(p1, p2, color.red, "band")')
    expect(r.outputs[2].gradient).toBeUndefined()
    expect(r.series[2].map((v) => v >>> 0)).toEqual([RED, RED, RED])
  })

  it('a third argument that is simply not a colour says so', () => {
    const r = refusalOf('p1 = plot(close)\np2 = plot(open)\nfill(p1, p2, close)')
    expect(r.guard).toBe('runtime:colour')
  })

  it('fewer than two plots is refused', () => {
    expect(refusalOf('p1 = plot(close)\nfill(p1)').guard).toBe('runtime:statement')
  })
})

describe('⛔ the descriptor is validated where it is BUILT', () => {
  it('an output that does not name its call is a BUILD error', () => {
    // ⚰ ADDED BECAUSE A MUTATION WAS GREEN WITHOUT IT. Deleting this check in
    // `makeProgram` changed nothing any fill case could see — the front end
    // never produces a malformed descriptor, so the guard had never been
    // watched to FIRE (`lesson_gate_that_cannot_fail`). A renderer reading
    // `undefined` off an output draws nothing and reports nothing, which is
    // exactly the failure the validation exists to turn into an error.
    expect(() => makeProgram({
      code: [OP.HALT, 0, 0],
      outputs: [{ upper: 0, lower: 1 }],
    })).toThrow(/names the call/)
  })

  it('⛔ CONTROL: a well-formed descriptor is accepted', () => {
    // Without this, "it throws" is equally satisfied by a validator that
    // refuses every output.
    const p = makeProgram({
      code: [OP.HALT, 0, 0],
      outputs: [{ call: 'fill', upper: 0, lower: 1 }],
    })
    expect(p.outputs[0]).toMatchObject({ call: 'fill', upper: 0, lower: 1 })
  })

  it('⭐ a bare string is still accepted, and becomes a descriptor', () => {
    // The shape changed under callers that may still pass a name. Widening
    // rather than breaking is deliberate; narrowing it later is a decision
    // somebody can make on purpose.
    expect(makeProgram({ code: [OP.HALT, 0, 0], outputs: ['plot'] }).outputs[0])
      .toEqual({ call: 'plot' })
  })
})
