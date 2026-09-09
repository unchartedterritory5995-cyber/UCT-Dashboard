/* Colour rules for the chart drawing layer — the ONE place a drawing's stored
 * colour becomes a canvas colour.
 *
 * ⛔ EXTRACTED VERBATIM FROM `ChartDrawingOverlay.jsx` (Phase 0). Every function
 * here is byte-for-byte the body that lived in the overlay: same remap table,
 * same luminance maths, same fallbacks. Phase 0 is behaviour-neutral by
 * contract, so a "tidier" rewrite would have been a silent regression with no
 * test to catch it — the tests came first, the changes come later.
 *
 * ⭐ WHY THIS IS ITS OWN MODULE AND NOT PART OF `drawingRenderers`. Three
 * separate consumers need the SAME answer to "what colour is this drawing,
 * really?": the stroke, the (Phase 1) selection handles, and the (Phase 1)
 * label ink. The handle-colour work is specified as "handles adapt to the
 * drawing's colour" — and the drawing's colour is NOT `d.color`, it is
 * `brightenAnnotationColor(d.color)`, because five stored hexes are remapped on
 * the way to the canvas. A handle painted from the raw value would be visibly
 * the wrong shade beside its own line. One authority, so they cannot disagree.
 */

/** The UCT drawing gold.
 *
 * ⛔ NOT `--ut-gold` FROM `tokens.css`, WHICH IS `#dcbb5e`. The app carries two
 * golds: the chrome gold (`--ut-gold`, menus/buttons) and this one — the CANVAS
 * gold, which is what `designTokens.js` calls `premium` and what every drawing
 * fallback in this layer has always used. Owner decision 2026-09-09: this is the
 * canonical drawing gold. The comments in `tokens.css` that call `--ut-gold`
 * "#c9a84c" are stale and describe this value, not that token.
 *
 * ⭐ THE POINT OF THE CONSTANT is that the hex stops being retyped. It was
 * written out in eight places across the drawing layer (stroke fallback, handle
 * fill, quick-bar swatch, context-menu swatch, two `chartDefaults` entries, the
 * workspace preset JSON, the Position renderer), so "change the drawing gold"
 * was a grep, and a grep that missed one left a chart with two golds on it.
 */
export const UCT_DRAW_GOLD = '#c9a84c'

// Render-time color remap so existing drawings pop on the dark chart without
// rewriting stored data: the palette reds brighten, and the palette greens snap
// to the exact bold candle green (#1ae51a) so a green level matches the candles.
const _ANNOTATION_REMAP = {
  '#e74c3c': '#ff5b5b', '#ef4444': '#ff5b5b',   // brighter red
  '#4ade80': '#1ae51a', '#3cb868': '#1ae51a', '#22c55e': '#1ae51a',   // match the bold candle green
}

export function brightenAnnotationColor(color) {
  return (color && _ANNOTATION_REMAP[color.toLowerCase()]) || color
}

/** Perceived luminance (0..1) of a CSS hex or rgb()/rgba() color; null if unparseable. */
export function colorLuminance(c) {
  if (!c || typeof c !== 'string') return null
  const s = c.trim()
  let r, g, b
  if (s[0] === '#') {
    let hex = s.slice(1)
    if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('')
    if (hex.length < 6) return null
    r = parseInt(hex.slice(0, 2), 16); g = parseInt(hex.slice(2, 4), 16); b = parseInt(hex.slice(4, 6), 16)
  } else {
    const m = s.match(/rgba?\(([^)]+)\)/i)
    if (!m) return null
    const parts = m[1].split(',').map(x => parseFloat(x))
    ;[r, g, b] = parts
  }
  if (![r, g, b].every(Number.isFinite)) return null
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

// Auto-ink for BARE text labels (the advance % label): black on a light canvas,
// white on a dark one, so the label always contrasts the background without the
// old shadow/outline. Reads the chart's ACTUAL applied background so a custom,
// gradient, or light (sunrise) theme all resolve correctly. White when unreadable.
export function autoLabelInk(chart) {
  try {
    const bg = chart?.options?.().layout?.background
    const lum = colorLuminance(bg?.color ?? bg?.topColor)
    if (lum == null) return '#ffffff'
    return lum > 0.5 ? '#000000' : '#ffffff'
  } catch { return '#ffffff' }
}
