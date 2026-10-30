// app/src/components/chart/engine/__tests__/exactPaintAlpha.test.js
//
// ⭐⭐ EVERY PAINT PATH PAINTS THE EXACT TRANSPARENCY — `round((1 − t/100) × 255)`
// on the t the script wrote — and only `color.t`'s READ-BACK is whole (C29,
// `vw-gradient-spy-1d-2026-09-30`: `color.t(color.new(c, 70.5))` reads 70).
//
// The paint is TradingView's, measured on Uncharted Clouds (capture A): its bands
// are `color.new(c, 95 − 2.5k)`, and TradingView paints 92.5 → 19, 87.5 → 32 …
// where a truncated transparency gives 20, 33. One script must paint the same
// bytes whichever lane draws it, so each lane is railed here:
//   • the plot/fill presentation lane (`pine.js::colourHelperAlpha`) — fill
//     opacity 0.125 for `color.new(c, 87.5)`;
//   • the object lane (`objectProgram.withObjectTransparency`, the object runtime);
//   • the runtime VM (`runtime/colours.js` `color.new` / `color.rgb`);
//   • a gradient a `color.new` sets (`pine.js::colourGradientRule` →
//     `pool.gradientPointColour`);
//   • two branches with two alphas (`cond ? color.new(c, 70.4) : color.new(c, 70.5)`)
//     each paint their own — never both opaque;
// and the read-back still truncates.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../ast/pine'
import { withObjectTransparency } from '../ast/objectProgram'
import { COLOUR_FNS, objectHexToPacked, packedToObjectHex } from '../runtime/colours'
import { gradientPointColour, columnColorsForPlot } from '../pool'

const V5 = '//@version=5\nindicator("t", overlay = true)\n'
const alphaOf = (hex) => (/^#[0-9a-f]{8}$/i.test(hex) ? parseInt(hex.slice(7), 16) : 255)
const tvByte = (t) => Math.round((1 - t / 100) * 255)

describe('exact paint, every lane', () => {
  it('the ladder the capture proves: 87.5 → 32, 92.5 → 19 (truncated: 33, 20)', () => {
    expect([tvByte(87.5), tvByte(92.5)]).toEqual([32, 19])
    expect([tvByte(87), tvByte(92)]).toEqual([33, 20])
  })

  it('plot / fill lane: color.new(c, 87.5) is opacity 0.125', () => {
    const t = translatePine(`${V5}p1 = plot(close)\np2 = plot(open)\nfill(p1, p2, color = color.new(color.teal, 87.5))\nplot(high, color = color.new(color.red, 87.5))\n`, { strict: true })
    expect(t.presentation.fills[0].opacity).toBeCloseTo(0.125, 12)
    expect(t.outputs[2].presentation.opacity).toBeCloseTo(0.125, 12)
  })

  it('object lane: withObjectTransparency(c, 87.5) paints alpha 32', () => {
    expect(alphaOf(withObjectTransparency('#089981', 87.5))).toBe(32)
    expect(alphaOf(withObjectTransparency('#089981', 87))).toBe(33)
  })

  it('runtime VM: color.new(c, 87.5) and color.rgb(…, 87.5) paint alpha 32', () => {
    const base = objectHexToPacked('#089981')
    expect(alphaOf(packedToObjectHex(COLOUR_FNS['color.new'].fn([base, 87.5])))).toBe(32)
    expect(alphaOf(packedToObjectHex(COLOUR_FNS['color.rgb'].fn([8, 153, 129, 87.5])))).toBe(32)
    expect(alphaOf(packedToObjectHex(COLOUR_FNS['color.new'].fn([base, 70])))).toBe(77)
  })

  it('a gradient that color.new sets: 70.5 paints alpha 75, not 77', () => {
    const t = translatePine(`${V5}g = color.from_gradient(close, 0, 1000, color.red, color.green)\nplot(close, color = color.new(g, 70.5))\n`, { strict: true })
    const p = t.outputs[0].presentation
    expect(p.colorGradient.transparency).toBe(70.5)
    const cc = columnColorsForPlot({ colorMode: 'column:x', colorGradient: { from: p.colorGradient.from, to: p.colorGradient.to, transparency: 70.5 } })
    expect(alphaOf(gradientPointColour(cc.gradient, 0.5))).toBe(tvByte(70.5))
  })

  it('two branches, two alphas: each paints its own (70.4 → 76, 70.5 → 75)', () => {
    const t = translatePine(`${V5}plot(close, color = close > open ? color.new(color.red, 70.4) : color.new(color.red, 70.5))\n`, { strict: true })
    const p = t.outputs[0].presentation
    expect(p.opacity).toBeUndefined()
    expect([alphaOf(p.colorUp), alphaOf(p.colorDown)]).toEqual([tvByte(70.4), tvByte(70.5)])
  })

  it('⛔ the READ-BACK still truncates: color.t(color.new(c, 70.5)) is 70', () => {
    const t = translatePine(`${V5}plot(close, color = color.new(#112233, color.t(color.new(color.red, 70.5))))\n`, { strict: true })
    expect(t.outputs[0].presentation.opacity).toBeCloseTo(0.3, 12)
  })
})
