/* The Company Panel's directional colors follow the chart widget's own theme. */
import { describe, it, expect } from 'vitest'
import {
  hexToHsl, hslToHex, liftForText, dockColorsFromSettings, dockColorVars,
} from './dockThemeColors'

const L = (hex) => hexToHsl(hex).l

describe('color conversion', () => {
  it('round-trips a hex through HSL', () => {
    for (const hex of ['#26a869', '#e5484d', '#1ae51a', '#000000', '#ffffff']) {
      const back = hslToHex(hexToHsl(hex))
      const a = hexToHsl(hex), b = hexToHsl(back)
      expect(Math.abs(a.l - b.l)).toBeLessThan(0.01)
    }
  })

  it('expands 3-digit hex', () => {
    expect(hexToHsl('#fff').l).toBeCloseTo(1, 5)
  })

  it('returns null for anything it cannot parse', () => {
    for (const bad of ['rgba(1,2,3,0.5)', 'red', '', null, undefined, '#12345', {}]) {
      expect(hexToHsl(bad)).toBeNull()
    }
  })
})

describe('liftForText', () => {
  it('reproduces the hand-tuned text tier from the fill tier', () => {
    // The defaults in dockPanels.module.css were measured by eye against the
    // chart's price readout. The formula has to land on them, or it is a
    // different design rather than a generalisation of the existing one.
    expect(L(liftForText('#26a869'))).toBeCloseTo(L('#3fc885'), 1)   // up
    expect(L(liftForText('#e5484d'))).toBeCloseTo(L('#f1696e'), 1)   // down
  })

  it('keeps the hue, so the panel stays in the theme palette', () => {
    const src = hexToHsl('#7fb0ff')          // blue-mono up
    const out = hexToHsl(liftForText('#7fb0ff'))
    expect(Math.abs(out.h - src.h)).toBeLessThan(2)
  })

  it('lifts a dark color to a legible floor', () => {
    expect(L(liftForText('#2f6b4a'))).toBeGreaterThanOrEqual(0.5)   // green-mono down
  })

  it('never blows out to near-white', () => {
    expect(L(liftForText('#eaeaea'))).toBeLessThanOrEqual(0.88)
  })

  it('PRESERVES the up/down gap on mono themes', () => {
    // Grayscale and Green Mono separate direction by LIGHTNESS alone. Lifting
    // both to one target would render +109% and -3457% identically.
    for (const [up, down] of [['#d4d4d4', '#6e6e6e'], ['#6fe0a0', '#2f6b4a'],
                              ['#7fb0ff', '#34507f'], ['#b8c4d0', '#55606c']]) {
      const gap = L(liftForText(up)) - L(liftForText(down))
      expect(gap).toBeGreaterThan(0.08)
    }
  })

  it('returns null rather than a wrong color when unparseable', () => {
    expect(liftForText('rgba(0,0,0,0.5)')).toBeNull()
  })
})

describe('dockColorsFromSettings', () => {
  it('prefers the day-change colors the chart paints its own percentage with', () => {
    const c = dockColorsFromSettings({
      header: { colors: { dayChangeUp: '#1ae51a', dayChangeDown: '#c41f2d' } },
      candles: { upColor: '#000000', downColor: '#000000' },
    })
    expect(hexToHsl(c.up).h).toBeCloseTo(hexToHsl('#1ae51a').h, 0)
  })

  it('falls back to the candle bodies', () => {
    const c = dockColorsFromSettings({ candles: { upColor: '#6fe0a0', downColor: '#2f6b4a' } })
    expect(c.up).toBe('#6fe0a0')
    expect(c.down).toBe('#2f6b4a')
  })

  it('returns null with no settings, so the CSS defaults stand', () => {
    for (const bad of [null, undefined, {}, 'nope', 42]) {
      expect(dockColorsFromSettings(bad)).toBeNull()
    }
  })

  it('returns null if either side is unparseable rather than half-theming', () => {
    expect(dockColorsFromSettings({
      candles: { upColor: '#6fe0a0', downColor: 'rgba(1,2,3,1)' },
    })).toBeNull()
  })
})

describe('dockColorVars', () => {
  it('emits exactly the four properties the stylesheet consumes', () => {
    const v = dockColorVars({ candles: { upColor: '#26a869', downColor: '#e5484d' } })
    expect(Object.keys(v).sort()).toEqual(
      ['--dock-down', '--dock-down-text', '--dock-up', '--dock-up-text',
       '--gain', '--loss'])
  })

  it('themes the research-kit pair too, so the reaction bars follow', () => {
    // ReactionBars and five sibling kit components read --gain/--loss, not the
    // dock pair, so without this the bars stayed app-green under every theme.
    const v = dockColorVars({ candles: { upColor: "#26a869", downColor: "#e5484d" } })
    expect(v['--gain']).toBe(v['--dock-up-text'])
    expect(v['--loss']).toBe(v['--dock-down-text'])
  })

  it('is null when there is nothing to theme', () => {
    expect(dockColorVars(null)).toBeNull()
  })
})
