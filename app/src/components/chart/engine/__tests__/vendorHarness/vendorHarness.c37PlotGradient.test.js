// ─── ⭐⭐ C37 — `color.from_gradient` AS A PLOT'S COLOUR, AGAINST TRADINGVIEW ──
//
// RVOL (`rvol-rddt-1d-2026-09-27`, NYSE:RDDT 1D, 631 bars from the listing):
//
//     grad = color.from_gradient(rvol, 0.5, 2, dnv, upv)
//     plot(rvol, style = plot.style_line, color = color.new(grad, 0), linewidth = 2)
//
// C28 measured it: every VALUE agreed and the line wore the pane's gold on 611
// of 611 coloured bars (ruling R-G: the plot keeps its line; the fix is to CARRY
// the colour). C29 measured the gradient's curve on `vw-gradient-spy-1d-2026-09-30`
// and served it to the object/runtime lanes; the plot lane had no rule that
// could hold one. `pine.js::colourGradientRule` is that rule, and this rail reads
// both captures: RVOL through the member door, bar for bar, and the probe's own
// colorer through the plot lane's renderer function.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { gradeCapture, loadCapture } from './harness'
import { sealCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { decodePackedColour } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { translatePine } from '../../ast/pine'
import { columnColorsForPlot, gradientPointColour } from '../../pool'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const load = (id) => {
  const loaded = loadCapture(path.join(DIR, `${id}.json`))
  if (!loaded.capture) throw new Error(`${id}: not a capture — ${loaded.reason}`)
  return loaded.capture
}

describe('C37 — RVOL: the gradient line is TradingView\'s colour on every bar', () => {
  const cap = load('rvol-rddt-1d-2026-09-27')

  it('⭐ value AND colour agree on all 611 coloured bars; the capture grades MATCH', () => {
    const { verdict, ours } = gradeCapture(cap)
    const line = verdict.plots.find((p) => p.id === 'plot_0')
    expect(line.verdict, line.reason).toBe('MATCH')
    expect(line.color).toBe('compared')
    expect(line.stats.valueMismatches).toBe(0)
    expect(line.stats.colorCompared).toBe(611)
    expect(line.stats.colorMismatches).toBe(0)
    expect(verdict.verdict, verdict.reason).toBe('MATCH')
    // ⛔ NON-VACUITY: it is a GRADIENT that was compared, not one flat colour —
    // more than a hundred distinct colours, and none of them the pane's gold.
    const drawn = ours.plots.find((p) => p.colors).colors.filter(Boolean)
    expect(new Set(drawn).size).toBeGreaterThan(100)
    expect(drawn).not.toContain('#c9a84cff')
  }, 60000)

  it('the two ends are the script\'s own inputs: `dnv` at rvol ≤ 0.5, `upv` at rvol ≥ 2', () => {
    const { ours } = gradeCapture(cap)
    const p = ours.plots.find((x) => x.colors)
    let low = 0
    let high = 0
    for (let i = 0; i < p.column.length; i += 1) {
      if (!Number.isFinite(p.column[i]) || !p.colors[i]) continue
      if (p.column[i] <= 0.5) { expect(p.colors[i], `bar ${i}`).toBe('#909090ff'); low += 1 }
      if (p.column[i] >= 2) { expect(p.colors[i], `bar ${i}`).toBe('#ff0000ff'); high += 1 }
    }
    expect(low).toBeGreaterThan(10)
    expect(high).toBeGreaterThan(10)
  }, 60000)

  it('🔴 CONTROL — the comparison can SEE a wrong gradient: one flat vendor colour disagrees on most bars', () => {
    const c = JSON.parse(JSON.stringify(cap))
    const col = c.plotValues.fields.indexOf('plot_1')
    expect(col).toBeGreaterThan(0)
    c.plotValues.rows.forEach((r) => { if (Number.isInteger(r[col])) r[col] = 0xff909090 })
    const line = gradeCapture(sealCapture(c)).verdict.plots.find((p) => p.id === 'plot_0')
    expect(line.verdict).toBe('DIVERGE')
    expect(line.stats.colorMismatches).toBeGreaterThan(400)
  }, 60000)

  it('the translation says what it carries: a position column and two static ends, no `colorDynamic`', () => {
    const t = translatePine(cap.source.text, {})
    const pres = t.outputs[0].presentation
    expect(pres.colorDynamic).toBeUndefined()
    expect(pres.colorGradient).toMatchObject({ from: '#909090', to: '#FF0000', transparency: 0 })
    expect(typeof pres.colorGradient.formula).toBe('string')
    // the threshold line beside it keeps its own static colour, untouched
    expect(t.outputs[1].presentation.colorGradient).toBeUndefined()
  })
})

describe('C37 — the plot lane\'s gradient function, on the probe\'s own colorer', () => {
  // `vw-gradient.pine` draws `plot(v, color = g1)` with
  // g1 = color.from_gradient(v, 0, 1, color.new(#0064C8, 70), color.new(#FF3232, 70)).
  // The probe is refused at the door (it also plots `color.r(...)`, a colour as a
  // VALUE), so the door cannot grade it; the renderer function can be asked
  // directly, with the endpoints spelled as the translator spells them.
  const cap = JSON.parse(fs.readFileSync(path.join(DIR, 'vw-gradient-spy-1d-2026-09-30.json'), 'utf8'))
  const idOf = new Map(cap.study.plots.map((p) => [p.title || p.id, p.id]))
  const idx = new Map(cap.plotValues.fields.map((f, i) => [f, i]))
  const col = (title) => cap.plotValues.rows.map((r) => r[idx.get(idOf.get(title) || title)])

  it('⭐ 300 of 300 bars: transparent ends (0x4D), the truncated blend (0x4C) between them', () => {
    const cc = columnColorsForPlot({
      colorMode: 'column:w',
      colorGradient: { from: '#0064C84D', to: '#FF32324D' },
    })
    expect(cc && cc.gradient).toBeTruthy()
    const v = col('G01_v')
    const colorer = col('plot_23')
    expect(v.length).toBe(300)
    const alphas = new Set()
    for (let i = 0; i < v.length; i += 1) {
      const ours = gradientPointColour(cc.gradient, v[i])
      const ourHex = (ours.length === 7 ? `${ours}ff` : ours).toLowerCase()
      expect(ourHex, `bar ${i} v=${v[i]}`).toBe(decodePackedColour(colorer[i]))
      alphas.add(ourHex.slice(7))
    }
    // ⛔ NON-VACUITY: both opacity bytes really occur (the ends' 4d and the blend's 4c)
    expect([...alphas].sort()).toEqual(['4c', '4d'])
  })

  it('`color.new(<gradient>, t)` SETS the transparency: g3 = color.new(gradient(blue→red), 30)', () => {
    const cc = columnColorsForPlot({
      colorMode: 'column:w',
      colorGradient: { from: '#2962FF', to: '#F23645', transparency: 30 },
    })
    const v = col('G01_v')
    const [r3, g3, b3] = ['G11_g3_r_new30', 'G12_g3_g_new30', 'G13_g3_b_new30'].map(col)
    for (let i = 0; i < v.length; i += 1) {
      const c = gradientPointColour(cc.gradient, v[i])
      const got = [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16))
      expect(got, `bar ${i}`).toEqual([r3[i], g3[i], b3[i]])
      // alpha is round((1 − 30/100) × 255) = 179 = 0xB3 on every bar
      expect(c.slice(7).toUpperCase(), `bar ${i}`).toBe('B3')
    }
  })

  it('⛔ a position that is not a finite number has NO colour (unmeasured: `top == bottom`, `na`)', () => {
    const cc = columnColorsForPlot({ colorMode: 'column:w', colorGradient: { from: '#000000', to: '#FFFFFF' } })
    expect(gradientPointColour(cc.gradient, NaN)).toBeNull()
    expect(gradientPointColour(cc.gradient, Infinity)).toBeNull()
    expect(gradientPointColour(cc.gradient, -Infinity)).toBeNull()
    // CONTROL — a finite position outside [0, 1] IS measured (clamped to an end)
    expect(gradientPointColour(cc.gradient, -3)).toBe('#000000')
    expect(gradientPointColour(cc.gradient, 7)).toBe('#FFFFFF')
  })
})
