// app/src/pages/cot/useCotPalette.js
//
// The COT palette (cotPalette.js — still the ONE authority for the hues) made to
// follow the member's app theme, for both the Chart.js panes and the rail.
//
// ⭐ What changes with the theme, and why:
//   • the pane SURFACE is the app's --bg-surface (CotData.module.css), no longer a
//     fixed dark #14160f — so axis text and rules must follow it too: axis text is
//     --text-muted, rules are --text at low alpha, the zero line is --ut-gold.
//   • price and open interest were creams (#f0ead8 / #d4c9a8) that vanish on white;
//     they are now the body text and the muted text — the same "neutral, not a
//     trader group" role, legible on every ground.
//   • the three trader-group hues (green / gold / steel blue) keep their identity
//     and are nudged, only if they must be, to 3:1 against the live surface
//     (lib/theme ensureContrast). On the dark default they are exactly as declared.
//     The hover variants step the OTHER way from the fill (lighter on dark, darker
//     on light) so the active bar always stands out.
import { useMemo } from 'react'
import { useThemeInk, SIZE_INK, withAlpha, ensureContrast, isLightSurface, contrastRatio } from '../../lib/theme'
import { SERIES_COLORS, HOVER_COLORS } from './cotPalette'

const SPEC = {
  surface: ['--bg-surface', '#17181b'],
  text: ['--text', '#f0efea'],
  muted: ['--text-muted', '#cfcac0'],
  gold: ['--ut-gold', '#dcbb5e'],
  xs: SIZE_INK.xs,
}

const GROUPS = ['commercials', 'largeSpecs', 'smallSpecs']

export function cotPaletteFor(t) {
  const light = isLightSurface(t.surface)
  const series = {}
  const hover = {}
  for (const k of GROUPS) {
    series[k] = ensureContrast(SERIES_COLORS[k], t.surface)
    hover[k] = light
      ? ensureContrast(series[k], t.surface, (contrastRatio(series[k], t.surface) || 3) + 1.5)
      : HOVER_COLORS[k]
  }
  series.openInterest = t.muted
  return {
    series,
    hover,
    price: t.text,
    axis: t.muted,
    grid: withAlpha(t.text, 0.07),
    zero: withAlpha(t.gold, 0.45),
    oiFill: withAlpha(t.muted, 0.1),
    border: withAlpha(t.text, 0.15),
    fontSize: t.xs,
  }
}

export default function useCotPalette() {
  const t = useThemeInk(SPEC)
  return useMemo(() => cotPaletteFor(t), [t])
}
