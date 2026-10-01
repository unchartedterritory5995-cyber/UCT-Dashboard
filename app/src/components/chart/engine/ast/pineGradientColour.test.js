// app/src/components/chart/engine/ast/pineGradientColour.test.js
//
// ─── C37 — `color.from_gradient` AS A PLOT COLOUR: WHAT IS CARRIED, AND WHAT IS
//     STILL DECLINED BY NAME ───────────────────────────────────────────────────
//
// The rule is `pine.js::colourGradientRule`; its vendor rail is
// `vendorHarness.c37PlotGradient.test.js` (RVOL, 611 of 611 bars). This file
// pins the SHAPE the translator writes and every decline beside it, because a
// gradient carried where the schema cannot hold it is a colour drawn wrong.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'
import { validateDefinition } from '../defSchema'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

const LF = String.fromCharCode(10)
const src = (...lines) => ['//@version=6', 'indicator("g")', ...lines].join(LF) + LF
const tr = (...lines) => translatePine(src(...lines), {})
const G = 'color.from_gradient(close, 30, 70, color.red, color.green)'

describe('C37 — a gradient between two static colours is carried on a plot', () => {
  it('⭐ the position is ONE numeric tree, the two ends static strings', () => {
    const p = tr(`plot(close, color = ${G})`).outputs[0].presentation
    expect(p.colorDynamic).toBeUndefined()
    expect(p.colorGradient.formula).toBe('(close - 30) / (70 - 30)')
    expect(p.colorGradient).toMatchObject({ from: '#F23645', to: '#4CAF50' })
    expect(p.colorGradient.transparency).toBeUndefined()
  })

  it('named arguments are Pine\'s own parameter names, in any order', () => {
    const p = tr('plot(close, color = color.from_gradient(top_color = color.green, value = close, bottom_value = 30, top_value = 70, bottom_color = color.red))').outputs[0].presentation
    expect(p.colorGradient.formula).toBe('(close - 30) / (70 - 30)')
    expect(p.colorGradient).toMatchObject({ from: '#F23645', to: '#4CAF50' })
  })

  it('a NAME bound to the gradient is followed, and `color.new(<gradient>, t)` sets the transparency', () => {
    const p = tr(`g = ${G}`, 'plot(close, color = color.new(g, 25))').outputs[0].presentation
    expect(p.colorGradient).toMatchObject({ from: '#F23645', to: '#4CAF50', transparency: 25 })
  })

  it('bounds may be series, and a transparent end keeps its own alpha byte', () => {
    const p = tr('plot(close, color = color.from_gradient(close, ta.lowest(close, 20), ta.highest(close, 20), color.new(color.red, 40), #00FF0080))').outputs[0].presentation
    expect(p.colorGradient.formula).toBe('(close - lowest(close, 20)) / (highest(close, 20) - lowest(close, 20))')
    expect(p.colorGradient).toMatchObject({ from: '#F2364599', to: '#00FF0080' })
  })

  it('a rightward `offset` moves the colour with the value', () => {
    const p = tr(`plot(close, color = ${G}, offset = 2)`).outputs[0].presentation
    expect(p.colorGradient.formula).toBe('((close - 30) / (70 - 30))[2]')
  })

  it('⛔ R36 — the rule RESOLVES, it does not MINT: an input its position reads declares nothing new', () => {
    // the options under which a parameter is minted at all (`paramIds.test.js`)
    const MANIFEST = { strict: true, paramManifest: true }
    const head = ['len = input.int(14, "Len")', 'r = ta.rsi(close, len)']
    const ids = (...lines) => (translatePine(src(...head, ...lines), MANIFEST).inputParams || []).map((p) => `${p.id}=${p.label || p.title}`)
    const COLOURED = 'plot(close, color = color.from_gradient(r, 30, 70, color.red, color.green))'
    expect(translatePine(src(...head, COLOURED), MANIFEST).outputs[0].presentation.colorGradient).toBeTruthy()
    // the colour reads `len` and the plot does not: no parameter is declared
    expect(ids(COLOURED)).toEqual(ids('plot(close)'))
    expect(ids('plot(close)')).toEqual([])
    // 🔴 CONTROL — the same input read by a plot's VALUE does mint, so the
    // equality above is not two empty lists by accident of the options
    expect(ids('plot(r)')).toEqual(['__uct_param_1=Len'])
    // and a later output's id is not pushed along by the colour before it
    expect(ids(COLOURED, 'plot(r)')).toEqual(['__uct_param_1=Len'])
  })
})

describe('C37 — what a gradient does NOT carry, each still declared `colorDynamic`', () => {
  it('⛔ an END that is not a static colour', () => {
    const p = tr('c = close > open ? color.red : color.blue', 'plot(close, color = color.from_gradient(close, 30, 70, c, color.green))').outputs[0].presentation
    expect(p.colorGradient).toBeUndefined()
    expect(p.colorDynamic).toBe(true)
  })

  it('⛔ a transparency that moves bar to bar', () => {
    const p = tr(`plot(close, color = color.new(${G}, close))`).outputs[0].presentation
    expect(p.colorGradient).toBeUndefined()
    expect(p.colorDynamic).toBe(true)
  })

  it('⛔ a marker — its renderer holds a pair or a palette, not a gradient', () => {
    const p = tr(`plotshape(close > open, color = ${G})`).outputs[0].presentation
    expect(p.colorGradient).toBeUndefined()
    expect(p.colorDynamic).toBe(true)
  })

  it('⛔ a fill — and the loss is declared on the fill, never silent', () => {
    const t = tr('a = plot(close)', 'b = plot(open)', `fill(a, b, color = ${G})`)
    expect(t.presentation.fills).toEqual([{ a: 0, b: 1, colorDynamic: true }])
  })

  it('🔴 CONTROL — the same plot with a static colour is untouched by the new rule', () => {
    const p = tr('plot(close, color = color.red)').outputs[0].presentation
    expect(p).toEqual({ color: '#F23645' })
  })
})

describe('C37 — the member pane document carries it, and the schema holds it', () => {
  const built = memberPaneDefinition({
    source: src('r = ta.rsi(close, 14)', 'plot(r, "RSI", color = color.new(color.from_gradient(r, 30, 70, color.red, color.green), 10))'),
    id: 'u_member-pane-c37gradient', name: 'g',
  })

  it('⭐ one hidden position column, named by the plot\'s `colorMode`', () => {
    expect(built.ok, built.reason).toBe(true)
    const plots = built.definition.plots.filter((p) => p.style !== 'hlines')
    const main = plots.find((p) => p.colorGradient)
    expect(main.colorGradient).toEqual({ from: '#F23645', to: '#4CAF50', transparency: 10 })
    expect(main.colorMode).toMatch(/^column:/)
    const col = plots.find((p) => p.key === main.colorMode.slice('column:'.length))
    expect(col && col.hidden).toBe(true)
    expect(validateDefinition(built.definition).errors || []).toEqual([])
  })

  it('⛔ the schema refuses a gradient with no column, a bad end, or a second colour source', () => {
    const base = JSON.parse(JSON.stringify(built.definition))
    const at = base.plots.findIndex((p) => p.colorGradient)
    const errorsOf = (mut) => {
      const d = JSON.parse(JSON.stringify(base))
      mut(d.plots[at])
      return (validateDefinition(d).errors || []).join(' | ')
    }
    expect(errorsOf((p) => { delete p.colorMode })).toMatch(/colorGradient: a gradient is read through a column/)
    expect(errorsOf((p) => { p.colorGradient.from = 'red' })).toMatch(/colorGradient: expected \{from, to\}/)
    expect(errorsOf((p) => { p.colorGradient.transparency = 140 })).toMatch(/colorGradient\.transparency/)
    expect(errorsOf((p) => { p.colorUp = '#FF0000'; p.colorDown = '#00FF00' })).toMatch(/colorGradient OR colorUp\/colorDown/)
    expect(errorsOf((p) => { p.colorPalette = ['#FF0000', '#00FF00'] })).toMatch(/colorPalette OR colorGradient/)
    // CONTROL — unmutated, it is valid
    expect(errorsOf(() => {})).toBe('')
  })
})
