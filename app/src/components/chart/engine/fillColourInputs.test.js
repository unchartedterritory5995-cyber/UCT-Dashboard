// app/src/components/chart/engine/fillColourInputs.test.js
//
// SETTINGS PARITY (area colours, 2026-11-17): a fill's colours are the script's colour inputs when the script
// says so, even written through a name (RS Rating: `fillCol = rs > rsMA ? posCol : negCol`, then
// `fill(…, color = fillCol)`); and when the input carries its OWN transparency (`input(color.rgb(0, 230, 119, 75))`,
// not `color.new(input, t)`) the member's pick is the WHOLE colour, alpha included, as TradingView paints it.
// Checked against TradingView's own fill palette (set F: the areas picked at 0.5 / 0.6 paint at 0.5 / 0.6).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { bandColoursFor } from './binder'
import { bindingKey } from './pool'
import { colourHex } from './__tests__/vendorHarness/captureInputs'

const REPO = path.resolve(process.cwd(), '..')
const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const CAPTURE = path.join(REPO, 'tests/fixtures/vendor/harness/rs-rating-fred6724-setf-rddt-1d-2026-11-16.json')
const LF = String.fromCharCode(10)

const rsBand = () => {
  const def = memberPaneDefinition({ source: RS, id: 'u_fci', name: 'RS' }).definition
  return { def, plot: def.plots.find((p) => p && p.fill && p.fill.colorUpInput) }
}
// the band's colour on an up bar and a down bar (its deciding column: 1 = up, 0 = down)
const paint = (plot, inputs) => {
  const key = String(plot.fill.colorMode).slice('column:'.length)
  const columns = new Map([[bindingKey('i', key), [1, 0]]])
  return bandColoursFor(plot, 'i', columns, 2, false, inputs)
}

describe('RS Rating\'s area colours are its settings', () => {
  it('the fill names its two colour inputs, which carry their own transparency, declared at the author\'s 25%', () => {
    const { def, plot } = rsBand()
    expect(plot.fill).toMatchObject({ colorUpInput: 'posCol', colorDownInput: 'negCol',
      colorUpInputOwnAlpha: true, colorDownInputOwnAlpha: true })
    expect(def.inputs.filter((i) => i.key === 'posCol' || i.key === 'negCol')).toEqual([
      { key: 'posCol', type: 'color', label: 'Positive Area', default: '#00E67740' },
      { key: 'negCol', type: 'color', label: 'Negative Area', default: '#FF525240' }])
  })

  it('at the defaults the band paints exactly what it always did (the hue at the band\'s 0.25)', () => {
    const { plot } = rsBand()
    expect(paint(plot, { posCol: '#00E67740', negCol: '#FF525240' })).toEqual(['#00E67740', '#FF525240'])
    expect(paint(plot, {})).toEqual(['#00E67740', '#FF525240'])
  })

  it('⭐ a pick is the whole colour, alpha included: TradingView\'s own fill palette (set F, RDDT)', () => {
    const c = JSON.parse(fs.readFileSync(CAPTURE, 'utf8'))
    const byName = Object.fromEntries(c.study.inputs.filter((i) => /^in_\d+$/.test(i.id)).map((i) => [i.name, i.value]))
    const picks = { posCol: colourHex(byName['Positive Area']), negCol: colourHex(byName['Negative Area']) }
    const tv = Object.values(c.study.paletteState.palette_2.colors).map((x) => colourHex(x.color))
    const { plot } = rsBand()
    expect(paint(plot, picks)).toEqual(tv)
    expect(tv).toEqual(['#2962FF80', '#FF980099'])                      // not the default's 0.25 (0x40)
  })

  it('an opaque pick paints opaque (the picker writes #RRGGBBFF raising a see-through colour to 100%)', () => {
    const { plot } = rsBand()
    expect(paint(plot, { posCol: '#2962FFFF', negCol: '#FF525240' })).toEqual(['#2962FFFF', '#FF525240'])
  })
})

describe('⛔ CONTROL: `color.new(<input>, t)` keeps the script\'s transparency (the pick is the hue)', () => {
  it('a band whose colour is the input wrapped in color.new is not marked; a pick paints at the band\'s opacity', () => {
    const src = ['//@version=5', 'indicator("x")', 'c = input.color(color.green, "Up")', 'd = input.color(color.red, "Down")',
      'p1 = plot(ta.sma(close, 5))', 'p2 = plot(ta.sma(close, 20))',
      'fill(p1, p2, color = close > open ? color.new(c, 80) : color.new(d, 80))'].join(LF)
    const def = memberPaneDefinition({ source: src, id: 'u_fci2', name: 'x' }).definition
    const plot = def.plots.find((p) => p && p.fill && p.fill.colorUpInput)
    expect(plot.fill.colorUpInputOwnAlpha).toBeUndefined()
    const [up] = paint(plot, { [plot.fill.colorUpInput]: '#2962FF80' })
    expect(up).toBe('#2962FF33')                                           // the hue, at 1 - 80/100 = 0.2
  })
})
