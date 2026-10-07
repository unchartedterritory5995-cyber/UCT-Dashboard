// app/src/pages/breadth/views/useViewColors.js
//
// The Breadth Views' palette, made to follow the member's app theme.
//
// `resolveViewColors` (breadthViewShared.js) stays the pure source: the four
// selectable palettes (classic / colorblind / mono / ocean) were tuned on the dark
// ground and the rails pin their values. What this hook adds is the LIVE surface:
// on a LIGHT theme every tier / bull / bear ink is nudged — only if it must be —
// to clear 3:1 against --bg-surface (lib/theme ensureContrast), so pale tiers like
// classic's #86efac mint stop vanishing on white. On a dark theme the palette is
// returned exactly as declared. Re-resolves on every theme switch.
import { useMemo } from 'react'
import { useThemeInk, ensureContrast, isLightSurface } from '../../../lib/theme'
import { resolveViewColors } from './breadthViewShared'

export function adaptViewColors(colors, surface) {
  if (!isLightSurface(surface)) return colors
  const fix = (c) => ensureContrast(c, surface)
  const tier = Object.fromEntries(Object.entries(colors.tier).map(([k, c]) => [k, fix(c)]))
  return { ...colors, tier, bull: fix(colors.bull), bear: fix(colors.bear) }
}

export default function useViewColors(paletteKey, intensityKey) {
  const { surface } = useThemeInk({ surface: ['--bg-surface', '#17181b'] })
  // An object palette (the /charts widget's user-picked colours) is keyed by content.
  const paletteSig = paletteKey && typeof paletteKey === 'object' ? JSON.stringify(paletteKey) : paletteKey
  return useMemo(
    () => adaptViewColors(resolveViewColors(paletteKey, intensityKey), surface),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paletteSig, intensityKey, surface],
  )
}
