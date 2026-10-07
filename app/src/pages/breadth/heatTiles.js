// app/src/pages/breadth/heatTiles.js — the Breadth treemap's tile colours, from the THEME.
//
// ⭐ THE TERMINAL HAS NO LOOK OF ITS OWN (owner ruling, 2026-10-06). The treemap tiles used to
// be opaque dark fills (#0a3216 … #370606) carrying their own white ink: legible, but a block of
// near-black on a light page. They are now the app's own heat ladder — `--heat-g3 … --heat-r3`
// in tokens.css, the same translucent green/amber/red the Breadth tables use (.bgG3 … .bgR3) —
// composited onto the theme's ground, with the theme's own text inks on top.
//
// The HEAT MEANING is kept: tier intensity is still the ladder's alpha (an extreme tier is the
// strongest tint, a mild one the faintest), on any ground.
//
// Pure (no React, no DOM) so the contrast rail (heatTiles.contrast.test.js) can feed it every
// one of the 21 themes and check the text it picks.
import { ensureContrast } from '../../lib/theme/resolveThemeColor'

/** tier → the heat-ladder token that fills its tile. '' (no reading) has no heat. */
export const TIER_HEAT_TOKEN = Object.freeze({
  g3: '--heat-g3', g2: '--heat-g2', g1: '--heat-g1',
  a: '--heat-a',
  r1: '--heat-r1', r2: '--heat-r2', r3: '--heat-r3',
})

/** TIER_SCORES value → the semantic TEXT ink for that tier's label (tooltips). */
export const TIER_TIP_TOKEN = Object.freeze({
  6: '--success-ink', 5: '--success-ink', 4: '--success-ink',
  3: '--warn',
  2: '--danger-ink', 1: '--danger-ink', 0: '--danger-ink',
})

/** `#rgb` / `#rrggbb` / `#rrggbbaa` / `rgb()` / `rgba()` → { rgb:[r,g,b], a } or null. */
export function parseInk(str) {
  if (typeof str !== 'string') return null
  const s = str.trim()
  let m = /^#([0-9a-f]{3,8})$/i.exec(s)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    if (h.length !== 6 && h.length !== 8) return null
    const n = (k) => parseInt(h.slice(k, k + 2), 16)
    return { rgb: [n(0), n(2), n(4)], a: h.length === 8 ? n(6) / 255 : 1 }
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(s)
  if (m) {
    const a = m[4] == null ? 1 : (m[5] ? Number(m[4]) / 100 : Number(m[4]))
    return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a }
  }
  return null
}

const hex2 = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')

/** `fg` laid over the opaque `bg`, as an opaque `#rrggbb` (bg returned when fg is unreadable). */
export function compositeInk(fg, bg) {
  const top = parseInk(fg)
  const under = parseInk(bg)
  if (!under) return bg
  if (!top) return `#${under.rgb.map(hex2).join('')}`
  return `#${top.rgb.map((v, i) => hex2(v * top.a + under.rgb[i] * (1 - top.a))).join('')}`
}

/**
 * The colours of one tile, all from resolved theme inks.
 * @param {string} tier  g3 … r3, or '' for no reading
 * @param {{ bg: string, surface: string, text: string, muted: string,
 *           heat: Record<string, string> }} ink  resolved tokens (useThemeInk)
 * @returns {{ fill: string, value: string, label: string }}
 *   fill  — the heat tint composited onto --bg (no reading → --bg-surface)
 *   value — --text, nudged only if a theme ever drops it under 4.5:1 on the fill
 *   label — --text-muted when it clears 4.5:1 on the fill, else --text (same nudge)
 */
export function heatTileInks(tier, ink) {
  const heat = tier ? ink.heat?.[tier] : null
  const fill = heat ? compositeInk(heat, ink.bg) : compositeInk(ink.surface, ink.bg)
  const value = ensureContrast(ink.text, fill, 4.5)
  const label = ensureContrast(ink.muted, fill, 4.5) === ink.muted ? ink.muted : value
  return { fill, value, label }
}
