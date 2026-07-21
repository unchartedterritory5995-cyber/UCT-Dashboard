// Pick a hairline/gridline color that stays visible on a user-chosen canvas color.
//
// The app's dividers were authored as fixed near-white translucent lines, which is
// right on the dark default and invisible the moment a canvas is set light. Rather
// than hardcode a second palette, derive the side that contrasts with the canvas.
//
// Used by the /charts workspace (per-widget --widget-divider) and by the watchlist's
// own style vars (--wl-divider) so both behave identically.

/** Parse the color forms the canvas pickers actually produce.
 *  Handles #rgb, #rrggbb, #rrggbbaa (alpha ignored — the swatch sits on an opaque
 *  surface) and rgb()/rgba(). Returns [r,g,b], or null when unreadable so callers
 *  can leave the existing hardcoded divider alone rather than guess. */
export function parseColor(c) {
  if (typeof c !== 'string') return null
  const s = c.trim()
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('')
    if (h.length !== 6 && h.length !== 8) return null
    const v = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)].map((p) => parseInt(p, 16))
    return v.some(Number.isNaN) ? null : v
  }
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s)
  if (!m) return null
  const v = [Number(m[1]), Number(m[2]), Number(m[3])]
  return v.some((n) => !Number.isFinite(n)) ? null : v
}

/** Rec. 709 relative luminance, 0..1. Cheap and good enough to pick a side. */
export function luminance(rgb) {
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
}

/** Styling for the small floating panels drawn ON the chart canvas — the crosshair
 *  OHLC legend, the volume legend, and the range-selector bar.
 *
 *  These are not a fixed dark chrome: they're the CANVAS COLOR at partial alpha, which
 *  is why they read as "part of the chart" while still masking the candles behind them.
 *  The default dark canvas (#0e0f0d) is literally where the hardcoded
 *  rgba(14, 15, 13, 0.72) came from — deriving it keeps that exact look while making a
 *  light canvas produce a light panel instead of a dark blob.
 *
 *  Text/border/hover flip on luminance so the contents stay legible either way.
 *  Returns null when the color can't be parsed, meaning "keep the hardcoded values". */
export function panelFor(canvasColor) {
  const rgb = parseColor(canvasColor)
  if (!rgb) return null
  const [r, g, b] = rgb
  const light = luminance(rgb) > 0.5
  return {
    bg: `rgba(${r}, ${g}, ${b}, 0.88)`,
    bgSoft: `rgba(${r}, ${g}, ${b}, 0.62)`,
    border: light ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.06)',
    text: light ? '#4a5561' : '#8a8578',
    textStrong: light ? '#0a141e' : '#e2dfd6',
    hover: light ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.07)',
  }
}

/** Divider color for hairlines drawn ON `canvasColor`.
 *  Alpha is asymmetric on purpose: dark-on-light needs more weight than
 *  light-on-dark to read as the same hairline. Returns null when the color can't
 *  be parsed, meaning "keep whatever is already there". */
export function dividerFor(canvasColor, { strong = false } = {}) {
  const rgb = parseColor(canvasColor)
  if (!rgb) return null
  const light = luminance(rgb) > 0.5
  if (light) return strong ? 'rgba(0, 0, 0, 0.22)' : 'rgba(0, 0, 0, 0.18)'
  return strong ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.10)'
}
