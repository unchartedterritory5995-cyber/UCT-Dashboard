// app/src/components/chart/engine/runtime/__tests__/w4PaintTyping.test.js
//
// W4-T12 - PAINT TYPING: a colour is a TYPE, and `na` is a valid colour that hides the output.
//
// `holdsColour` (pineRuntimeFrontend.js) used to prove a colour through a literal, a `color.*`
// call, an input colour, a `var color` slot and a `?:` whose arms are colours or `na`. It now also
// proves one through:
//   - `c = switch ... / if ...` whose every leaf is a colour or `na` (the slot is marked at its binding);
//   - a user function whose result leaves are all colours or `na` (`record.colour`);
//   - an element of an array built from colours.
// and `fill()` accepts a plot id chosen by `?:` over a literal `true` / `false`.
//
// Pine: colour is a type, `na` belongs to it, and an `na` colour draws nothing
// (https://www.tradingview.com/pine-script-docs/visuals/colors/). Never draw where TradingView hides.
//
// Every refusal below is a CONTROL: a number in a colour slot paints a plausible shade computed from
// the wrong thing.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { colourHexByName } from '../../ast/pine.js'
import { hexToPacked } from '../colours.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const BARS = [
  { t: 1700000000, o: 100, h: 105, l: 99, c: 101, v: 10 },
  { t: 1700086400, o: 104, h: 106, l: 100, c: 102, v: 11 },
  { t: 1700172800, o: 101, h: 108, l: 100, c: 103, v: 12 },
]
const N = BARS.length
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'
const RED = hexToPacked(colourHexByName('color.red', 5), 0)
const GREEN = hexToPacked(colourHexByName('color.green', 5), 0)
const BLUE = hexToPacked(colourHexByName('color.blue', 5), 0)
const MODE = 'm = input.string("a", "m", options = ["a", "b"])\n'

const build = (src, inputs = {}, plotColours = false) => buildRuntimeIr(head + src, { bars: BARS, inputs, plotColours })
function run(src, inputs = {}) {
  const built = build(src, inputs)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} - ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return { built, outputs: res.outputs.map((o) => Array.from(o)), program }
}
const refusal = (src) => {
  const built = build(src)
  expect(built.ok, 'expected a refusal, got a program').toBe(false)
  return built.refusal
}
const isNa = (v) => Number.isNaN(v)

describe('a colour switch / if value is a colour', () => {
  const SW = `${MODE}c = switch m\n    "a" => color.red\n    "b" => color.green\n    => color.blue\nbgcolor(c)\nplot(close)\n`
  it('a colour switch over an input text paints the chosen colour on each bar', () => {
    expect(run(SW, {}).outputs[0]).toEqual([RED, RED, RED])
    expect(run(SW, { m: 'b' }).outputs[0]).toEqual([GREEN, GREEN, GREEN])
  })

  it('an `na` arm hides the bar (the colour is na, not a stand-in)', () => {
    const out = run('c = switch\n    close > 102 => color.red\n    close > 101 => color.green\n    => na\nbgcolor(c)\nplot(close)\n').outputs[0]
    expect(isNa(out[0])).toBe(true)
    expect(out[1]).toBe(GREEN)
    expect(out[2]).toBe(RED)
  })

  it('a missing default yields na (hides) - the colour verdict still holds', () => {
    const out = run('c = switch\n    close > 102 => color.red\nbgcolor(c)\nplot(close)\n').outputs[0]
    expect(isNa(out[0])).toBe(true)
    expect(isNa(out[1])).toBe(true)
    expect(out[2]).toBe(RED)
  })

  it('an `if` value whose every branch is a colour', () => {
    const out = run('c = if close > 101\n    color.red\nelse\n    color.green\nbgcolor(c)\nplot(close)\n').outputs[0]
    expect(out).toEqual([GREEN, RED, RED])
  })

  it('a nested chain inside an arm is tallied through the one sink', () => {
    const out = run('c = if close > 101\n    if close > 102\n        color.red\n    else\n        color.blue\nelse\n    na\nbgcolor(c)\nplot(close)\n').outputs[0]
    expect(isNa(out[0])).toBe(true)
    expect(out[1]).toBe(BLUE)
    expect(out[2]).toBe(RED)
  })

  it('CONTROL - a numeric arm keeps the refusal (a price is not a colour)', () => {
    expect(refusal('c = switch\n    close > 102 => color.red\n    => 0\nbgcolor(c)\nplot(close)\n').guard).toBe('runtime:colour')
    expect(refusal('c = if close > 101\n    color.red\nelse\n    close\nbgcolor(c)\nplot(close)\n').guard).toBe('runtime:colour')
  })

  it('CONTROL - all-na arms say nothing about the type', () => {
    expect(refusal('c = switch\n    close > 102 => na\n    => na\nbgcolor(c)\nplot(close)\n').guard).toBe('runtime:colour')
  })

  it('CONTROL - a colour block value does not become a plottable number', () => {
    expect(refusal('c = if close > 101\n    color.red\nelse\n    color.green\nplot(c)\n').guard).toBe('runtime:colour')
  })

  it('a colour switch feeds `plot(color =)` as a per-bar colour output', () => {
    const built = build(`${MODE}c = switch m
    "a" => color.red
    => color.green
plot(close, color = c)
`, {}, true)
    expect(built.ok).toBe(true)
    const d = built.ir.outputs[0]
    expect(d.colour && Number.isInteger(d.colour.output), JSON.stringify(d.colour)).toBe(true)
  })
})

describe('a user function that returns a colour is a colour', () => {
  it('an expression-bodied function', () => {
    const out = run('f(x) => x > 101 ? color.red : color.green\nbgcolor(f(close))\nplot(close)\n').outputs[0]
    expect(out).toEqual([GREEN, RED, RED])
  })

  it('a block-bodied function with a mutated colour local', () => {
    const out = run('f(x) =>\n    r = color.red\n    if x > 102\n        r := color.green\n    r\nbgcolor(f(close))\nplot(close)\n').outputs[0]
    expect(out).toEqual([RED, RED, GREEN])
  })

  it('a function ending in an `if` chain with an `na` branch hides that bar', () => {
    const out = run('f(x) =>\n    if x > 101\n        color.red\n    else\n        na\nbarcolor(f(close))\nplot(close)\n').outputs[0]
    expect(isNa(out[0])).toBe(true)
    expect(out[1]).toBe(RED)
  })

  it('a function that calls a colour function', () => {
    const out = run('g(x) => x > 101 ? color.red : na\nf(x) => g(x)\nbgcolor(f(close))\nplot(close)\n').outputs[0]
    expect(isNa(out[0])).toBe(true)
    expect(out[1]).toBe(RED)
  })

  it('CONTROL - a function returning a number is not a colour', () => {
    expect(refusal('f(x) => x > 101 ? 1 : 2\nbgcolor(f(close))\nplot(close)\n').guard).toBe('runtime:colour')
  })

  it('CONTROL - a function with ONE numeric leaf is not a colour', () => {
    expect(refusal('f(x) => x > 101 ? color.red : 0\nbgcolor(f(close))\nplot(close)\n').guard).toBe('runtime:colour')
  })

  it('CONTROL - a colour function cannot be plotted as a price', () => {
    expect(refusal('f(x) => x > 101 ? color.red : color.green\nplot(f(close))\n').guard).toBe('runtime:colour')
  })
})

describe('a refused definition never lends its index to a colour helper', () => {
  it('CONTROL - a selector refused at its call site stays refused by its OWN name, beside a colour helper', () => {
    // `bad` is held (conditional history) and its record is dropped while its NAME stays routed; `g`
    // is the next definition and reuses that index. Reading the index alone gave `bad(close)` the
    // colour verdict of `g`, and `plot(bad(close))` was refused as a colour. Measured on the
    // runtime-on census (bollinger-band-width-percentile): a script master served.
    const src = ['bad(float v) =>', '    v > 1 ? ta.sma(v, 3) :', '     v > 2 ? ta.ema(v, 3) :', '     na',
      'g(x) => x > 101 ? color.red : na', 'bgcolor(g(close))', 'plot(bad(close))', ''].join('\n')
    expect(refusal(src).guard).toBe('runtime:conditional-history')
  })
})

describe('an element of a colour array is a colour', () => {
  it('array.from of colours, read by a per-bar index', () => {
    const out = run('a = array.from(color.red, color.green)\nbgcolor(array.get(a, close > 101 ? 1 : 0))\nplot(close)\n').outputs[0]
    expect(out).toEqual([RED, GREEN, GREEN])
  })

  it('CONTROL - an array of numbers is not a colour source', () => {
    expect(refusal('a = array.from(1, 2)\nbgcolor(array.get(a, 0))\nplot(close)\n').guard).toBe('runtime:colour')
  })

  it('CONTROL - a mixed array is not a colour source', () => {
    expect(refusal('a = array.from(color.red, 2)\nbgcolor(array.get(a, 0))\nplot(close)\n').guard).toBe('runtime:colour')
  })
})

describe('color.new keeps demanding a colour', () => {
  it('CONTROL - color.new(close, 50) still refuses', () => {
    expect(refusal('bgcolor(color.new(close, 50))\nplot(close)\n').guard).toBe('runtime:colour')
  })
  it('CONTROL - a numeric switch under color.new still refuses', () => {
    expect(refusal('c = switch\n    close > 102 => close\n    => open\nbgcolor(color.new(c, 50))\nplot(close)\n').guard).toBe('runtime:colour')
  })
  it('a colour switch under color.new is accepted', () => {
    const out = run('c = switch\n    close > 102 => color.red\n    => color.green\nbgcolor(color.new(c, 0))\nplot(close)\n').outputs[0]
    expect(out.length).toBe(N)
    expect(out.every((v) => !isNa(v))).toBe(true)
  })
})

describe('fill() accepts a plot id chosen by a literal ?:', () => {
  const PLOTS = 'p1 = plot(close)\np2 = plot(open)\np3 = plot(high)\n'
  it('a literal-true choice spans the first arm', () => {
    const { built } = run(`${PLOTS}fill(true ? p1 : p2, p3, color.new(color.red, 80))\n`)
    const f = built.ir.outputs.find((o) => o.call === 'fill')
    expect([f.upper, f.lower]).toEqual([0, 2])
  })
  it('a literal-false choice spans the second arm', () => {
    const { built } = run(`${PLOTS}fill(p3, false ? p1 : p2, color.new(color.red, 80))\n`)
    const f = built.ir.outputs.find((o) => o.call === 'fill')
    expect([f.upper, f.lower]).toEqual([2, 1])
  })
  it('the fill choice is off at the object door (master built no such fill there)', () => {
    const src = `${head}${PLOTS}fill(true ? p1 : p2, p3, color.new(color.red, 80))
`
    expect(buildRuntimeIr(src, { bars: BARS, inputs: {} }).ok).toBe(true)
    const door = buildRuntimeIr(src, { bars: BARS, inputs: {}, objectDoor: true })
    expect(door.ok).toBe(false)
  })
  it('CONTROL - a series condition keeps the fill-target refusal', () => {
    expect(refusal(`${PLOTS}fill(close > 101 ? p1 : p2, p3, color.new(color.red, 80))\n`).guard).toBe('runtime:fill-target')
  })
  it('CONTROL - an input condition keeps the fill-target refusal (the member may flip it)', () => {
    expect(refusal(`useA = input.bool(true, "a")\n${PLOTS}fill(useA ? p1 : p2, p3, color.new(color.red, 80))\n`).guard).toBe('runtime:fill-target')
  })
  it('CONTROL - a non-plot arm keeps the refusal', () => {
    expect(refusal(`${PLOTS}fill(true ? close : p2, p3, color.new(color.red, 80))\n`).guard).toBe('runtime:fill-target')
  })
})

describe('the object door builds what master builds', () => {
  it('the new colour proofs are off at the door', () => {
    const src = `${head}f(x) => x > 101 ? color.red : color.green\nbgcolor(f(close))\nplot(close)\n`
    const pane = buildRuntimeIr(src, { bars: BARS, inputs: {} })
    const door = buildRuntimeIr(src, { bars: BARS, inputs: {}, objectDoor: true })
    expect(pane.ok).toBe(true)
    expect(door.ok).toBe(false)
  })

  // W4-T12 r1 (review B1): the other two gates, each with its own rail. A colour SWITCH / IF and a
  // colour ARRAY are proved colours on the pane and are NOT at the door, which keeps master's answer.
  it('a colour switch is off at the door (master refused it: runtime:colour)', () => {
    const src = `${head}c = switch
    close > 101 => color.red
    => color.green
bgcolor(c)
plot(close)
`
    expect(buildRuntimeIr(src, { bars: BARS, inputs: {} }).ok).toBe(true)
    const door = buildRuntimeIr(src, { bars: BARS, inputs: {}, objectDoor: true })
    expect(door.ok).toBe(false)
    expect(door.refusal.guard).toBe('runtime:colour')
  })
  it('a colour if-block is off at the door', () => {
    const src = `${head}c = if close > 101
    color.red
else
    color.green
bgcolor(c)
plot(close)
`
    expect(buildRuntimeIr(src, { bars: BARS, inputs: {} }).ok).toBe(true)
    expect(buildRuntimeIr(src, { bars: BARS, inputs: {}, objectDoor: true }).ok).toBe(false)
  })
  it('an element of a colour array is off at the door (master refused it: runtime:colour)', () => {
    const src = `${head}a = array.from(color.red, color.green)
bgcolor(array.get(a, 0))
plot(close)
`
    expect(buildRuntimeIr(src, { bars: BARS, inputs: {} }).ok).toBe(true)
    const door = buildRuntimeIr(src, { bars: BARS, inputs: {}, objectDoor: true })
    expect(door.ok).toBe(false)
    expect(door.refusal.guard).toBe('runtime:colour')
  })
})
