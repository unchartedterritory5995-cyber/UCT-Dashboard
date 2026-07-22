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

/** Text/accent colors for chrome sitting ON a user-chosen canvas — widget header rows,
 *  session toggles, the market clock and its popup.
 *
 *  The dark values are the app's existing tokens; the light ones are the Sunset palette's
 *  darkened equivalents, so a light canvas gets the same identity rather than a
 *  washed-out version of the dark one (gold #c9a84c on white is barely legible).
 *  Returns null when unparseable → callers keep their existing tokens. */
export function chromeFor(canvasColor) {
  const rgb = parseColor(canvasColor)
  if (!rgb) return null
  const light = luminance(rgb) > 0.5
  return light
    ? { text: '#3e4a58', textStrong: '#0a141e', accent: '#7a5c16', accentBg: 'rgba(122, 92, 22, 0.14)' }
    : { text: '#9b9684', textStrong: '#d8d2c2', accent: '#c9a84c', accentBg: 'rgba(201, 168, 76, 0.12)' }
}

/** Blend `rgb` toward `target` ([r,g,b]) by `amount` (0..1). */
function mix(rgb, target, amount) {
  return rgb.map((v, i) => Math.round(v + (target[i] - v) * amount))
}
const rgbStr = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`

/** Sample a top→bottom gradient at `t` (0 = top, 1 = bottom).
 *
 *  A gradient canvas has no single color, so chrome anchored at different heights must
 *  sample at ITS OWN height or it fights the background — e.g. the range bar sits just
 *  above the volume pane, ~80% down, where a top-sampled dark panel would sit as a dark
 *  slab on a near-white area. Returns null if either stop is unparseable, meaning
 *  "fall back to the single-color path". */
export function sampleGradient(top, bottom, t) {
  const A = parseColor(top)
  const B = parseColor(bottom)
  if (!A || !B) return null
  const k = Math.min(1, Math.max(0, t))
  return rgbStr(A.map((v, i) => Math.round(v + (B[i] - v) * k)))
}

/** Styling for the drawing TOOLBAR buttons, which sit directly on the canvas.
 *
 *  Unlike the legend panels (which match the canvas), these are deliberately a small
 *  step AWAY from it so the controls are findable without shouting — on the default
 *  #0e0f0d canvas the buttons are #1a1c17, one token step up. Hardcoded, that "one
 *  step up" becomes "one step BRIGHTER than a white canvas", i.e. glowing. Here the
 *  step follows the canvas: lighter on a dark canvas, darker on a light one.
 *
 *  The mix amounts are calibrated to reproduce the existing dark values:
 *  #0e0f0d + 5% white ≈ #1a1b19 (was #1a1c17); + 13% ≈ #2d2e2c (was #2e3127).
 *  Returns null when unparseable, meaning "keep the hardcoded values". */
export function toolbarFor(canvasColor) {
  const rgb = parseColor(canvasColor)
  if (!rgb) return null
  const light = luminance(rgb) > 0.5
  const toward = light ? [0, 0, 0] : [255, 255, 255]
  return {
    bg: rgbStr(mix(rgb, toward, 0.05)),
    bgHover: rgbStr(mix(rgb, toward, 0.13)),
    text: light ? '#5a5548' : '#a8a290',
    textHover: light ? '#14181e' : '#e2dfd6',
  }
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

/** CSS-variable palette for the chart's POPUP MENUS (ticker search, timeframe menu,
 *  right-click context menu) so they match the chart canvas: a clean white/gold look
 *  on a light canvas, the dark OLED look on a dark one. Returns a style object of
 *  `--menu-*` vars (or null when the color can't be parsed → caller keeps its dark
 *  defaults). The menus' CSS reads these with `var(--menu-x, <dark default>)`. */
export function menuThemeVars(canvasColor) {
  const rgb = parseColor(canvasColor)
  if (!rgb) return null
  const light = luminance(rgb) > 0.5
  const W = [255, 255, 255], K = [0, 0, 0]
  const surface    = light ? mix(rgb, W, 0.42) : mix(rgb, W, 0.055)
  const surfaceTop = light ? mix(rgb, W, 0.58) : mix(rgb, W, 0.10)
  const input      = light ? mix(rgb, W, 0.62) : mix(rgb, K, 0.30)
  return {
    '--menu-bg': rgbStr(surface),
    '--menu-bg-top': rgbStr(surfaceTop),
    '--menu-input-bg': rgbStr(input),
    '--menu-border': light ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.09)',
    '--menu-divider': light ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.06)',
    '--menu-text': light ? '#1a2531' : '#ededed',
    '--menu-text-dim': light ? '#586572' : '#8a8a8f',
    '--menu-text-faint': light ? '#8a95a0' : '#6b6b6b',
    '--menu-accent': light ? '#7a5c16' : '#c9a84c',
    '--menu-accent-bg': light ? 'rgba(122,92,22,0.12)' : 'rgba(201,168,76,0.12)',
    '--menu-hover': light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.055)',
    '--menu-shadow': light ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.7)',
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
