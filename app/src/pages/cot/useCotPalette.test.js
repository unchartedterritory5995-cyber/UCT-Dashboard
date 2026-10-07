// The COT palette follows the live surface: as declared on the dark default,
// every trader-group ink >= 3:1 (and price / OI legible) on a light theme.
import { describe, it, expect } from 'vitest'
import { cotPaletteFor } from './useCotPalette'
import { SERIES_COLORS, HOVER_COLORS } from './cotPalette'
import { contrastRatio } from '../../lib/theme'

const DARK = { surface: '#17181b', text: '#f0efea', muted: '#cfcac0', gold: '#dcbb5e', xs: 10 }
const LIGHT = { surface: '#f4f5f6', text: '#1f2328', muted: '#57606a', gold: '#7a5c16', xs: 10 }

describe('cotPaletteFor', () => {
  it('keeps the declared hues on the dark default', () => {
    const p = cotPaletteFor(DARK)
    for (const k of ['commercials', 'largeSpecs', 'smallSpecs']) {
      expect(p.series[k]).toBe(SERIES_COLORS[k])
      expect(p.hover[k]).toBe(HOVER_COLORS[k])
    }
  })

  it('is readable on a light surface: groups >= 3:1, axis/price/OI >= 4.5:1, hover distinct', () => {
    const p = cotPaletteFor(LIGHT)
    for (const k of ['commercials', 'largeSpecs', 'smallSpecs']) {
      expect(contrastRatio(p.series[k], LIGHT.surface), k).toBeGreaterThanOrEqual(3)
      expect(p.hover[k]).not.toBe(p.series[k])
    }
    for (const c of [p.axis, p.price, p.series.openInterest]) {
      expect(contrastRatio(c, LIGHT.surface)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
