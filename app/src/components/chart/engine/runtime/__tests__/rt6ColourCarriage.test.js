// app/src/components/chart/engine/runtime/__tests__/rt6ColourCarriage.test.js
//
// ─── ⭐⭐ RT6 — the per-bar colour channel of the runtime lane, piece by piece ───
//
// The end-to-end evidence is `vendorHarness.rt6RuntimeColour` (a TradingView capture
// and five hand replays). These are the units it rests on, each a rule the door
// relies on: the colour is an OPT-IN output appended AFTER every other one; a colour
// the lane cannot lower never refuses the script; an `na` operand is `na`; the
// renderer folds a style transparency into an opaque colour only; the schema
// admits `colorPacked` and refuses a malformed one.
import { describe, it, expect } from 'vitest'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { COLOUR_FNS, hexToPacked } from '../colours.js'
import { probeRuntimeProgram } from '../runtimeColumns.js'
import { packedPointColour, columnColorsForPlot } from '../../pool.js'
import { validateDefinition, SCHEMA_VERSION } from '../../defSchema.js'

const SRC = `//@version=5
indicator("rt6", overlay = false)
var c = color.white
if close > close[1]
    c := #33ff00
plot(close, "a", color = color.new(c, 40))
plot(open, "b")
bgcolor(close > open ? color.blue : na)
`

const BARS = [
  { o: 1, h: 2, l: 0.5, c: 1.5 }, { o: 1.5, h: 2, l: 1, c: 1.2 }, { o: 1.2, h: 3, l: 1, c: 2.5 },
]
const run = (src, plotColours) => {
  const built = buildRuntimeIr(src, { bars: [], inputs: {}, objectTrees: [], pane: true, symbolAtBind: true, plotColours })
  expect(built.ok, JSON.stringify(built.refusal)).toBe(true)
  return built
}

describe('RT6 — the frontend: the colour is an opt-in output, appended last', () => {
  it('⛔ OFF (every caller but the runtime pane): the output table is exactly what it was', () => {
    const off = run(SRC, false)
    expect(off.ir.outputs.map((o) => o.call)).toEqual(['plot', 'plot', 'bgcolor'])
    expect(off.ir.outputs.every((o) => !('colour' in o) && !('transp' in o))).toBe(true)
  })

  it('⭐ ON: one `colour` output per plot that wrote `color =`, AFTER every other output, naming its plot', () => {
    const on = run(SRC, true)
    const calls = on.ir.outputs.map((o) => o.call)
    expect(calls).toEqual(['plot', 'plot', 'bgcolor', 'colour'])
    expect(on.ir.outputs[0].colour).toEqual({ output: 3 })
    expect(on.ir.outputs[3].of).toBe(0)
    // the plot with no `color =` carries no colour (the host's static default draws it)
    expect(on.ir.outputs[1].colour).toBeUndefined()
    // the paint carries its line and its opacity fact
    expect(on.ir.outputs[2].line).toBe(8)
    expect(on.ir.outputs[2].colourOpaque).toBe(true)
  })

  it('⭐ the colour is computed by the SAME run, bar for bar (`color.new(c, 40)`)', () => {
    const built = buildRuntimeIr(SRC, {
      bars: BARS.map((b, i) => ({ t: i, ...b, v: 1 })), inputs: {}, objectTrees: [], pane: true, symbolAtBind: true, plotColours: true,
    })
    const program = lowerIrProgram(built.ir, { historyFromListing: true })
    const series = ['o', 'h', 'l', 'c'].map((k) => Float64Array.from(BARS.map((b) => b[k]))).concat([Float64Array.from([1, 1, 1])])
    const res = execute(program, { bars: 3, series, columns: program.columns, confirmed: true, barTimes: [0, 1, 2] })
    const col = Array.from(res.outputs[3])
    const cc = { transparency: null }
    expect(col.map((c) => packedPointColour(cc, c))).toEqual(['#FFFFFF99', '#FFFFFF99', '#33FF0099'])
  })

  it('⛔ FAIL-SOFT: a `color =` the lane cannot read never refuses the script — the descriptor says why', () => {
    const src = `//@version=5
indicator("rt6b")
f() => color.red
plot(close, color = f())
`
    const probe = probeRuntimeProgram(src)
    expect(probe.ok, JSON.stringify(probe.refusal)).toBe(true)
    const plot = probe.outputs.find((o) => o.call === 'plot')
    expect(plot.colour && plot.colour.refused).toBeTruthy()
    expect(probe.outputs.some((o) => o.call === 'colour')).toBe(false)
  })

  it('`transp =` is read as written; a non-literal one is `unread`; opacity is provable only for fixed colours', () => {
    const src = `//@version=4
study("rt6c")
t = input(50)
var c = color.white
plot(close, color = close > open ? color.green : color.red, transp = 20)
plot(open, color = c, transp = t)
bgcolor(close > open ? color.green : na, transp = 90)
`
    const outs = probeRuntimeProgram(src).outputs
    const plots = outs.filter((o) => o.call === 'plot')
    expect(plots[0]).toMatchObject({ transp: 20, colourOpaque: true })
    expect(plots[1]).toMatchObject({ transp: 'unread', colourOpaque: false })
    expect(outs.find((o) => o.call === 'bgcolor')).toMatchObject({ transp: 90, colourOpaque: true })
  })
})

describe('RT6 — an `na` operand is `na`, never transparent black', () => {
  it('`color.new(na, t)`, `color.new(c, na)` and `color.rgb(na, …)` are na; a real colour is unchanged', () => {
    expect(Number.isNaN(COLOUR_FNS['color.new'].fn([NaN, 40]))).toBe(true)
    expect(Number.isNaN(COLOUR_FNS['color.new'].fn([hexToPacked('#ff0000'), NaN]))).toBe(true)
    expect(Number.isNaN(COLOUR_FNS['color.rgb'].fn([NaN, 0, 0]))).toBe(true)
    expect(COLOUR_FNS['color.new'].fn([hexToPacked('#ff0000'), 40])).toBe(hexToPacked('#ff0000', 40))
  })
})

describe('RT6 — the renderer reads a packed colour column', () => {
  it('a packed colour is drawn as the run computed it; `na` is no colour', () => {
    const p = { transparency: null }
    expect(packedPointColour(p, hexToPacked('#33ff00', 40))).toBe('#33FF0099')
    expect(packedPointColour(p, NaN)).toBeNull()
    expect(packedPointColour(p, undefined)).toBeNull()
  })

  it('⭐ a STYLE transparency folds into an OPAQUE colour only (the vendor rule, `withStyleTransparency`)', () => {
    const p = { transparency: 90 }
    expect(packedPointColour(p, hexToPacked('#4caf50'))).toBe('#4CAF501A')
    // a colour carrying its own transparency keeps it
    expect(packedPointColour(p, hexToPacked('#4caf50', 40))).toBe('#4CAF5099')
  })

  it('`columnColorsForPlot` answers `packed` for a `colorPacked` row, and nothing without a column mode', () => {
    expect(columnColorsForPlot({ colorMode: 'column:c', colorPacked: { transparency: 90 } }))
      .toEqual({ key: 'c', up: null, down: null, packed: { transparency: 90, sig: 'packed|90' } })
    expect(columnColorsForPlot({ colorPacked: {} })).toBeNull()
  })
})

describe('RT6 — the schema admits `colorPacked`, and only well formed', () => {
  const doc = (plot, paints) => ({
    schemaVersion: SCHEMA_VERSION,
    id: 'u_rt6',
    name: 'rt6',
    compute: { kind: 'runtime', fn: 'runtime:u_rt6', rev: 1, source: 'x', outputs: { value: 0, out2: 1 } },
    plots: [
      { key: 'value', label: 'v', style: 'line', color: '#ffffff', ...plot },
      { key: 'out2', label: '', style: 'line', color: '#ffffff', hidden: true },
    ],
    ...(paints ? { paints } : {}),
  })
  const errs = (d) => {
    const r = validateDefinition(d)
    return r.ok ? [] : r.errors.map(String)
  }
  it('a plot and a paint naming a column with `colorPacked` validate', () => {
    expect(errs(doc({ colorMode: 'column:out2', colorPacked: { transparency: 40 } },
      [{ kind: 'bgcolor', colorMode: 'column:out2', colorPacked: { transparency: 90 } }])).filter((e) => /colorPacked|paints/.test(e))).toEqual([])
  })
  it('⛔ a malformed transparency, a missing mode, or two colour forms at once are refused by name', () => {
    expect(errs(doc({ colorMode: 'column:out2', colorPacked: { transparency: 101 } })).join(' ')).toMatch(/colorPacked\.transparency/)
    expect(errs(doc({ colorPacked: {} })).join(' ')).toMatch(/colorPacked: a computed colour/)
    expect(errs(doc({ colorMode: 'column:out2', colorPacked: {}, colorUp: '#fff', colorDown: '#000' })).join(' ')).toMatch(/colorPacked alone/)
    expect(errs(doc({}, [{ kind: 'bgcolor', colorMode: 'column:out2', colorPacked: { transparency: 1.5 } }])).join(' ')).toMatch(/colorPacked\.transparency/)
  })
})
