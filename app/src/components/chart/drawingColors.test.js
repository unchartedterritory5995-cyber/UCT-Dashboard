/* Drawing colour resolution — and the remap that makes it non-obvious.
 *
 * ⛔ WHY THIS DESERVES ITS OWN TESTS. `brightenAnnotationColor` quietly rewrites
 * five stored hexes on the way to the canvas, so a drawing's colour ON SCREEN is
 * not the colour in its record. Phase 1 makes selection handles adopt "the
 * drawing's colour"; if it reads `d.color` instead of the brightened value, a
 * red trend line gets salmon handles and nobody will be able to say why. These
 * tests are what makes that mistake fail loudly.
 */
import { describe, it, expect } from 'vitest'
import { UCT_DRAW_GOLD, brightenAnnotationColor, colorLuminance, autoLabelInk } from './drawingColors'

describe('UCT_DRAW_GOLD', () => {
  it('is the canvas gold #c9a84c, not the chrome gold #dcbb5e', () => {
    // ⛔ THE APP HAS TWO GOLDS AND THEY ARE NOT INTERCHANGEABLE. `--ut-gold` in
    // tokens.css is #dcbb5e (menus, buttons). The drawing layer has always used
    // #c9a84c — designTokens.js calls it `premium`. Owner decision 2026-09-09:
    // this is the canonical DRAWING gold. Anything that renders on the chart
    // canvas reads it from here.
    expect(UCT_DRAW_GOLD).toBe('#c9a84c')
    expect(UCT_DRAW_GOLD).not.toBe('#dcbb5e')
  })
})

describe('brightenAnnotationColor', () => {
  it('lifts both stored reds to the bright canvas red', () => {
    expect(brightenAnnotationColor('#e74c3c')).toBe('#ff5b5b')
    expect(brightenAnnotationColor('#ef4444')).toBe('#ff5b5b')
  })

  it('snaps all three stored greens to the bold candle green', () => {
    // So a green level matches the candles it is drawn over, rather than sitting
    // a shade off them.
    for (const g of ['#4ade80', '#3cb868', '#22c55e']) {
      expect(brightenAnnotationColor(g)).toBe('#1ae51a')
    }
  })

  it('is case-insensitive — a hand-typed hex remaps too', () => {
    expect(brightenAnnotationColor('#EF4444')).toBe('#ff5b5b')
  })

  it('passes anything unmapped straight through, gold included', () => {
    expect(brightenAnnotationColor(UCT_DRAW_GOLD)).toBe(UCT_DRAW_GOLD)
    expect(brightenAnnotationColor('#60a5fa')).toBe('#60a5fa')
    expect(brightenAnnotationColor('rgba(1,2,3,0.5)')).toBe('rgba(1,2,3,0.5)')
  })

  it('returns the input unchanged for null / empty rather than throwing', () => {
    expect(brightenAnnotationColor(null)).toBeNull()
    expect(brightenAnnotationColor('')).toBe('')
    expect(brightenAnnotationColor(undefined)).toBeUndefined()
  })

  it('is idempotent — remapping a remapped colour changes nothing', () => {
    expect(brightenAnnotationColor(brightenAnnotationColor('#ef4444'))).toBe('#ff5b5b')
  })
})

describe('colorLuminance', () => {
  it('reads 6-digit and 3-digit hex', () => {
    expect(colorLuminance('#000000')).toBe(0)
    expect(colorLuminance('#ffffff')).toBe(1)
    expect(colorLuminance('#fff')).toBe(1)
  })

  it('reads rgb() and rgba(), ignoring the alpha', () => {
    expect(colorLuminance('rgb(255,255,255)')).toBe(1)
    expect(colorLuminance('rgba(0, 0, 0, 0.4)')).toBe(0)
  })

  it('weights green most, blue least (perceived, not average)', () => {
    expect(colorLuminance('#00ff00')).toBeGreaterThan(colorLuminance('#ff0000'))
    expect(colorLuminance('#ff0000')).toBeGreaterThan(colorLuminance('#0000ff'))
  })

  it('tolerates surrounding whitespace', () => {
    expect(colorLuminance('  #ffffff  ')).toBe(1)
  })

  it('returns null — never NaN — for anything it cannot parse', () => {
    // ⛔ NaN WOULD BE THE DANGEROUS ANSWER. `autoLabelInk` compares the result
    // to 0.5, and `NaN > 0.5` is false, so an unparseable background would
    // silently pick black ink — invisible on the dark canvas that is the
    // default. Returning null routes to an explicit fallback instead.
    for (const bad of ['nope', '#12', '', null, undefined, 42, {}]) {
      expect(colorLuminance(bad)).toBeNull()
    }
  })
})

describe('autoLabelInk', () => {
  const chartWith = (background) => ({ options: () => ({ layout: { background } }) })

  it('picks black ink on a light canvas and white on a dark one', () => {
    expect(autoLabelInk(chartWith({ color: '#ffffff' }))).toBe('#000000')
    expect(autoLabelInk(chartWith({ color: '#0f0f0f' }))).toBe('#ffffff')
  })

  it('reads a gradient background from its TOP colour', () => {
    expect(autoLabelInk(chartWith({ topColor: '#ffffff' }))).toBe('#000000')
  })

  it('defaults to white when the background is unreadable', () => {
    // White, because the dark canvas is the default and an invisible label is
    // worse than a slightly low-contrast one.
    expect(autoLabelInk(chartWith({ color: 'not-a-color' }))).toBe('#ffffff')
    expect(autoLabelInk(chartWith(undefined))).toBe('#ffffff')
  })

  it('never throws on a missing or disposed chart', () => {
    // Called every frame from redraw(); a chart torn down mid-frame must not
    // take the whole overlay down with it.
    expect(autoLabelInk(null)).toBe('#ffffff')
    expect(autoLabelInk({})).toBe('#ffffff')
    expect(autoLabelInk({ options: () => { throw new Error('disposed') } })).toBe('#ffffff')
  })
})
