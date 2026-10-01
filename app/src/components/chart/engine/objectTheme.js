// app/src/components/chart/engine/objectTheme.js
//
// ─── ⭐⭐ C37 — `chart.fg_color` / `chart.bg_color`: THE CHART'S OWN COLOURS ────
//
// Pine's two theme built-ins are not colours a script chooses; they are the
// colours of the chart the script is running on (its background, and the
// foreground that reads against it). On TradingView that is TradingView's
// theme; on our chart it is the member's own chart settings. So neither can be
// folded to a hex when a script is translated — the translation is one document
// and the chart it lands on is not known until it is drawn.
//
// THE RULE, stated once:
//   · the translator carries a theme colour as a REFERENCE — the Pine name
//     itself (`chart.fg_color`), optionally with the transparency a `color.new`
//     set on it (`chart.fg_color@80`);
//   · the reference rides every colour channel as an ordinary colour string
//     (an object's `{c:'lit'}` literal, a plot's `color` / `colorUp` /
//     `colorDown` / palette entry), so no channel grows a new shape;
//   · it is RESOLVED WHERE IT IS DRAWN, against the chart's own settings
//     (`chartThemeOf`): foreground = the chart's text colour, background = its
//     solid background;
//   · ⛔ NEVER TradingView's theme colours. A vendor capture records what
//     TradingView drew on ITS theme (`#0f0f0f` text on white, measured on
//     trend-duration-forecast 2026-09-28); our chart is a different chart, and
//     the same script is CORRECT here when it wears our chart's colours. The
//     colour column therefore grades a theme reference as THEME-RELATIVE —
//     neither agreeing nor mismatching.
//
// ⛔ WHAT IS NOT SERVED, by name:
//   · a GRADIENT chart background. Pine's reference says `chart.bg_color` is
//     then "the middle point of the gradient"; no capture shows it, so the
//     reference resolves to nothing there and the slot keeps the renderer's
//     default (`unresolvedReason`: `theme:gradient-background`). Settles it:
//     capture Q-T1 (`vw-chart-theme.pine` under a solid light, a solid dark and
//     a gradient background).
//   · a channel READ of a theme colour (`color.r(chart.bg_color)`) or a
//     comparison against one (`chart.bg_color == color.white`): the answer is
//     the chart's, not known at translation — refused where it already was.
//
// One authority: the translator (`pine.js`), the object runtime
// (`objectProgram.js::withObjectTransparency`), the render state and the plot
// pool all ask THIS file what a reference is and what it resolves to.

/** The two Pine names, which are also the reference strings. */
export const THEME_FG = 'chart.fg_color'
export const THEME_BG = 'chart.bg_color'
export const THEME_NAMES = Object.freeze([THEME_FG, THEME_BG])

const TOKEN = /^chart\.(fg|bg)_color(?:@(\d{1,3}))?$/

/** Is this colour string a theme reference (with or without a transparency)? */
export function isThemeColour(c) {
  return typeof c === 'string' && TOKEN.test(c)
}

/** `{which: 'fg'|'bg', transparency: 0..100}` of a reference, else null. */
export function parseThemeColour(c) {
  const m = typeof c === 'string' ? TOKEN.exec(c) : null
  if (!m) return null
  const t = m[2] === undefined ? 0 : Number(m[2])
  if (!Number.isInteger(t) || t < 0 || t > 100) return null
  return { which: m[1], transparency: t }
}

/** A reference with its transparency SET to the whole number `t` (Pine's
 *  `color.new` replaces a base's transparency, never stacks). Null for anything
 *  that is not a reference or a transparency outside 0..100. */
export function themeColourWithTransparency(c, t) {
  const p = parseThemeColour(c)
  if (!p || !Number.isInteger(t) || t < 0 || t > 100) return null
  const name = p.which === 'fg' ? THEME_FG : THEME_BG
  return t === 0 ? name : `${name}@${t}`
}

const HEX6 = /^#([0-9a-f]{6})$/i
const HEX3 = /^#([0-9a-f]{3})$/i

/** `#RRGGBB` of a settings colour, or null when it is not a plain opaque hex
 *  (the chart's two colours are stored as hex by the settings panel; anything
 *  else is not a colour this file can put a transparency on). */
function plainHex(c) {
  if (typeof c !== 'string') return null
  const s = c.trim()
  if (HEX6.test(s)) return s.toUpperCase()
  const m = HEX3.exec(s)
  return m ? `#${m[1].split('').map((x) => x + x).join('')}`.toUpperCase() : null
}

/**
 * The chart's own two colours, from its merged settings.
 *
 * @param {object} settings  `mergeChartSettings(...)` output (or any object
 *        carrying `textColor`, `background`, `bgMode`)
 * @returns {{fg: string|null, bg: string|null, reason: string|null}}
 */
export function chartThemeOf(settings) {
  const s = settings && typeof settings === 'object' ? settings : {}
  const fg = plainHex(s.textColor)
  // ⛔ A gradient background has no one colour, and the value Pine returns for it
  // is documented, not witnessed (Q-T1) — unresolved, by name.
  if (s.bgMode === 'gradient') return { fg, bg: null, reason: 'theme:gradient-background' }
  return { fg, bg: plainHex(s.background), reason: null }
}

/**
 * A colour string as it is DRAWN on a chart whose theme is `theme`: a theme
 * reference becomes that chart's colour (`#RRGGBB`, or `#RRGGBBAA` with the
 * reference's transparency, alpha `round((1 − t/100) × 255)` — the object
 * lane's one formula); any other string is returned untouched.
 *
 * ⛔ A reference the theme cannot answer (no theme handed in, a gradient
 * background) resolves to `undefined` — "this slot has no colour of its own",
 * which every renderer already answers with its default — never to a guess.
 */
export function resolveThemeColour(c, theme) {
  const p = parseThemeColour(c)
  if (!p) return c
  const base = theme && (p.which === 'fg' ? theme.fg : theme.bg)
  if (typeof base !== 'string' || !HEX6.test(base)) return undefined
  if (p.transparency === 0) return base
  const alpha = Math.round((1 - p.transparency / 100) * 255)
  return base + alpha.toString(16).padStart(2, '0').toUpperCase()
}
