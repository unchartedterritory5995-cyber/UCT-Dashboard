/**
 * Company Panel directional colors, derived from the CHART's own theme.
 *
 * Every colored number in the dock (growth %, surprise, sentiment, trend bars)
 * funnels through exactly two custom properties -- `--dock-up-text` and
 * `--dock-down-text` -- so the panel only needs those two values to follow
 * whatever UCT Chart Theme is on that particular chart widget.
 *
 * ⛔ TWO TIERS, DO NOT COLLAPSE THEM. The chart's raw up/down are FILL colors:
 * candle bodies, big solid shapes. At 11px and weight 700 they render dimmer
 * than the neutral values beside them, which is the "faint / visually dead"
 * read the hand-tuned defaults were introduced to fix. `liftForText` reproduces
 * that hand-tuning as a formula -- it returns the existing defaults to within
 * ~3% lightness when fed the existing fill colors (asserted in the tests).
 *
 * ⚠️ Mono themes (Grayscale, Green Mono, Blue Mono...) separate up from down by
 * LIGHTNESS rather than hue. So the lift is a FLOOR plus a fixed delta, never a
 * normalisation: raising both to one target would make +109% and -3457% render
 * as the same color. The darker side gets pulled up to legibility, the lighter
 * side keeps its lead, and the gap survives.
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** '#rgb' | '#rrggbb' -> {h,s,l} (0..1 for s/l, 0..360 for h), or null. */
export function hexToHsl(hex) {
  if (typeof hex !== 'string') return null
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(h)) return null          // rgba()/named/8-digit -> caller falls back
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let hue
  if (max === r) hue = ((g - b) / d) % 6
  else if (max === g) hue = (b - r) / d + 2
  else hue = (r - g) / d + 4
  hue *= 60
  if (hue < 0) hue += 360
  return { h: hue, s, l }
}

export function hslToHex({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const hx = (v) => Math.round(clamp((v + m) * 255, 0, 255)).toString(16).padStart(2, '0')
  return `#${hx(r)}${hx(g)}${hx(b)}`
}

// The hand-tuned tier was the fill color lifted ~12 lightness points, with the
// darker one floored so it clears the neutral text beside it.
const LIFT = 0.12
const FLOOR = 0.50
const CEIL = 0.88

/** A fill color made legible as 11px text on the dock's dark surface. */
export function liftForText(hex) {
  const hsl = hexToHsl(hex)
  if (!hsl) return null
  return hslToHex({ ...hsl, l: clamp(Math.max(hsl.l + LIFT, FLOOR), 0, CEIL) })
}

/**
 * Pull the up/down pair out of a chart settings blob.
 *
 * Prefers `header.colors.dayChange{Up,Down}` -- the color the chart already
 * paints its OWN day-change percentage, which is the closest thing to "this
 * theme's color for a directional number" -- and falls back to the candle
 * bodies. applyThemeToSettings writes both from the theme's up/down.
 */
export function dockColorsFromSettings(settings) {
  const s = settings && typeof settings === 'object' ? settings : null
  if (!s) return null
  const hc = (s.header && s.header.colors) || {}
  const cd = s.candles || {}
  const up = hc.dayChangeUp || cd.upColor
  const down = hc.dayChangeDown || cd.downColor
  const upText = liftForText(up)
  const downText = liftForText(down)
  if (!upText || !downText) return null       // unparseable -> keep the CSS defaults
  return { up, down, upText, downText }
}

/** Inline style object for the dock root, or null to inherit the defaults. */
export function dockColorVars(settings) {
  const c = dockColorsFromSettings(settings)
  if (!c) return null
  return {
    '--dock-up': c.up,
    '--dock-down': c.down,
    '--dock-up-text': c.upText,
    '--dock-down-text': c.downText,
  }
}
