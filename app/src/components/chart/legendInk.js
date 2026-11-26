// app/src/components/chart/legendInk.js — which ink each neutral legend role draws in.
//
// The legend is drawn ON the chart canvas, which is painted from chart_settings, while its text
// rules name the APP theme's tokens. Over a canvas the app theme did not expect (a light app
// theme over the default dark canvas, a dark theme over a white one) those tokens read at
// 1.07-2.28:1 (WebKit, 2026-10-28). So, per ROLE and per canvas sample:
//
//   1. a member's explicit `header.colors.legend` wins everywhere it reads at >= 4.5:1 (base
//      legend, volume strip, pane legends and the RS ranks strip alike — one choice, one colour);
//      where it does not (a colour stored for a dark canvas, over a light one), the canvas ink;
//   2. otherwise the app token KEEPS ITS LOOK when it already reads at >= 4.5:1 against the
//      canvas it sits on, at the role's own opacity step — a dark theme over a dark canvas is
//      exactly what it was (values --text-bright, labels --text, keys --text-muted);
//   3. only a token that would fail is replaced by the canvas ink, `legendInkForCanvas` (the one
//      rule a /charts theme also stores as header.colors.legend).
//
// Published by StockChart as CSS variables on its wrapper; every legend rule reads them with its
// old token as the fallback, so text rendered outside a chart is unchanged.
import { legendCanvasRgb, legendInkForCanvas, legendTextContrast, LEGEND_INK_ON_LIGHT } from './chartThemes'
import { parseColorAlpha } from '../../utils/dividerColor'

export const LEGEND_MIN_CONTRAST = 4.5

/** ⭐ Owner 11-16 — "make sure they're all the same contrast and brightness": within a legend
 *  row the LABEL and the VALUE share ONE ink and (owner experiment, same day) one weight, 500 —
 *  they differ by position and series colour only. This is that ink's role, published as `--legend-ink-pair[-low]`.
 *  ⭐ `muted`, MEASURED: on the default dark canvas `text` resolves to #f0efea (OKLCH L 0.95),
 *  0.02 under `bright` — labels would simply turn white, and a coloured value clamped to L 0.95
 *  has almost no chroma left in sRGB (every series colour reads as off-white). `muted` (#cfcac0,
 *  L 0.84) is the ink the owner's labels already wore, so the values come down to the labels. */
export const LEGEND_PAIR_ROLE = 'muted'
/** Owner 11-16 ("it feels a little dim"): the pair ink is the muted ink lifted this far toward the BRIGHT ink
 *  of the same canvas (sRGB mix). Dark default: #cfcac0 → ≈#e1ddd5, still a step under the title's white; on a
 *  light canvas both inks are the canvas ink, so nothing moves. */
export const LEGEND_PAIR_LIFT = 0.6  // owner 11-16: 0.45 felt dim, 0.75 a little too bright — a notch under
/** Mix two colours `parseColorAlpha` reads (opaque result, sRGB), t = share of `b`. null when either won't parse. */
export function mixInk(a, b, t) {
  const pa = parseColorAlpha(a); const pb = parseColorAlpha(b)
  if (!pa || !pb) return null
  const h = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
  return '#' + [0, 1, 2].map((i) => h(pa.rgb[i] + (pb.rgb[i] - pa.rgb[i]) * t)).join('')
}

/** Half-width of the OKLCH lightness band a coloured value is clamped into, around the pair ink. */
export const LEGEND_VALUE_BAND = 0.03
/** The band before the ink is known (first paint, jsdom, an unreadable colour). */
export const LEGEND_VALUE_BAND_FALLBACK = Object.freeze({
  dark: Object.freeze({ lmin: 0.89, lmax: 0.95 }),
  light: Object.freeze({ lmin: 0.3, lmax: 0.4 }),
})

/** OKLCH lightness (0..1) of any colour `parseColorAlpha` reads; a translucent colour is first
 *  composited over `canvasRgb` when given (else its alpha is ignored). null when unreadable. */
export function oklchLightness(color, canvasRgb = null) {
  const p = parseColorAlpha(color)
  if (!p) return null
  const a = canvasRgb && p.a < 1 ? p.a : 1
  const [r, g, b] = p.rgb.map((c, i) => {
    const v = (a < 1 ? c * a + canvasRgb[i] * (1 - a) : c) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
}

/** The lightness band a coloured legend value is clamped into: centred on its label's ink, so
 *  every hue reads as bright as the label beside it. `L` null → the fallback for the canvas. */
export function legendValueBand(L, lightCanvas = false) {
  if (L == null || !Number.isFinite(L)) return LEGEND_VALUE_BAND_FALLBACK[lightCanvas ? 'light' : 'dark']
  const r = (x) => Math.round(Math.max(0, Math.min(1, x)) * 1000) / 1000
  return { lmin: r(L - LEGEND_VALUE_BAND), lmax: r(L + LEGEND_VALUE_BAND) }
}

/** The pre-measure CSS variables: the fallback band for both samples (StockChart spreads
 *  `legendInkVars` over these once the inks resolve). */
export function legendValueBandVars(lightCanvas = false) {
  const { lmin, lmax } = legendValueBand(null, lightCanvas)
  return {
    '--legend-val-lmin': String(lmin), '--legend-val-lmax': String(lmax),
    '--legend-val-lmin-low': String(lmin), '--legend-val-lmax-low': String(lmax),
  }
}

/** role → the app token it stands for, and the lowest opacity a rule draws that role at
 *  (the bar strip's keys sit at 0.72, its date at 0.82; LegendRow's label at 1). */
export const LEGEND_ROLES = Object.freeze({
  bright: { token: '--text-bright', opacity: 1 },
  text: { token: '--text', opacity: 1 },
  muted: { token: '--text-muted', opacity: 0.72 },
})

/**
 * @param {{ tokens?: {bright?: string, text?: string, muted?: string}, top: string, low: string,
 *           under?: string|null, legendColor?: string|null }} o
 *   `tokens`: each role's token as the browser resolved it on the chart (any colour string);
 *   `top` / `low`: the canvas at the crosshair legend and at ~80% down (volume strip, pane
 *   legends); `under`: the opaque surface the chart sits on, for a translucent canvas.
 * @returns {Record<string, string>} `--legend-ink-<role>` and `--legend-ink-<role>-low`.
 */
export function legendInkVars({ tokens = {}, top, low, under = null, legendColor = null }) {
  const out = {}
  for (const [suffix, sample] of [['', top], ['-low', low ?? top]]) {
    const canvas = legendCanvasRgb(sample, under)
    const ink = legendInkForCanvas(sample, under)
    for (const [role, { opacity }] of Object.entries(LEGEND_ROLES)) {
      // ⭐ 2026-11-13 — the member's explicit legend colour wins WHERE IT READS. A colour
      // stored for a dark canvas (a dark theme applied once, then the background set to
      // white by hand) kept #d6d8dd over a white RS pane: the ranks strip's "1M 3M 6M"
      // read ~1.4:1. Below 4.5:1 on this sample, the canvas ink stands in; an unreadable
      // colour or canvas keeps the member's colour, exactly as before.
      const pick = (t) => {
        const c = t ? legendTextContrast(t, canvas, opacity) : null
        return c != null && c >= LEGEND_MIN_CONTRAST ? t : null
      }
      let v
      if (legendColor) v = (canvas && legendTextContrast(legendColor, canvas, opacity) != null) ? (pick(legendColor) || ink) : legendColor
      else v = pick(tokens[role]) || ink
      out[`--legend-ink-${role}${suffix}`] = v
    }
    // ⭐ Owner 11-16 — the shared label/value ink, and the band a coloured value is clamped into,
    // measured from THAT ink on THIS sample (so a pane legend low on a gradient canvas gets its own).
    const pairBase = out[`--legend-ink-${LEGEND_PAIR_ROLE}${suffix}`]
    // Lift toward the APP's bright ink when it reads on this canvas — so a legend colour a chart theme stored
    // (header.colors.legend, e.g. #d6d8dd) brightens too instead of pinning the legend dim (owner 11-16).
    const brightTok = tokens.bright && legendTextContrast(tokens.bright, canvas, 1) != null
      && legendTextContrast(tokens.bright, canvas, 1) >= LEGEND_MIN_CONTRAST ? tokens.bright : null
    const pair = mixInk(pairBase, brightTok || out[`--legend-ink-bright${suffix}`], LEGEND_PAIR_LIFT) || pairBase
    out[`--legend-ink-pair${suffix}`] = pair
    const lightCanvas = !!canvas && ink === LEGEND_INK_ON_LIGHT
    const band = legendValueBand(oklchLightness(pair, canvas), lightCanvas)
    out[`--legend-val-lmin${suffix}`] = String(band.lmin)
    out[`--legend-val-lmax${suffix}`] = String(band.lmax)
  }
  return out
}

/** Read each role's token as the browser resolves it INSIDE `el` (a probe span: a var() chain
 *  comes back as one computed colour — rgb()/rgba(), or `color(srgb r g b / a)` for a token
 *  defined with color-mix(), which parseColorAlpha reads too, so such a token keeps its look),
 *  and the first opaque background behind `el`. Browser-only; jsdom answers empty strings, which
 *  read as "unknown" and fall back to the canvas ink. */
export function readLegendContext(el) {
  const tokens = {}
  if (!el || typeof document === 'undefined' || typeof getComputedStyle !== 'function') return { tokens, under: null }
  const probe = document.createElement('span')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.style.pointerEvents = 'none'
  el.appendChild(probe)
  try {
    for (const [role, { token }] of Object.entries(LEGEND_ROLES)) {
      probe.style.color = `var(${token})`
      const c = getComputedStyle(probe).color
      if (c) tokens[role] = c
    }
  } finally {
    probe.remove()
  }
  let under = null
  for (let a = el.parentElement; a; a = a.parentElement) {
    const bg = getComputedStyle(a).backgroundColor
    const p = parseColorAlpha(bg)
    if (p && p.a >= 1) { under = bg; break }
  }
  return { tokens, under }
}

/** ⚡ (2026-11-26, the board switch) THE SAME CONTEXT IS READ ONCE. `readLegendContext` makes the browser resolve the role
 *  tokens inside the chart (a probe span, one style read per role) and walks every ancestor's background (a style read
 *  each): 2.7 ms of a two-chart board switch on production's build, every chart mount and canvas change paying it
 *  again for the same answer. What the browser resolves there follows from the stylesheets (fixed for the page's life)
 *  and from the chain of elements up to the root: each one's tag and attributes (class, style, data-*: a widget's
 *  inline tokens, the app theme on <html>) and the viewport (media queries). That chain is the key: the same chain
 *  is the same answer, read once and reused; any attribute changing anywhere on it, or the viewport, reads again. */
const LEGEND_CONTEXT_MAX = 32
const _legendContexts = new Map()
export function legendContextKey(el) {
  if (!el) return null
  let key = typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : ''
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    key += `<${n.tagName}`
    const attrs = n.attributes
    for (let i = 0; i < attrs.length; i++) key += ` ${attrs[i].name}=${attrs[i].value}`
  }
  return key
}
/** `readLegendContext(el)`, remembered by `legendContextKey(el)`. */
export function readLegendContextCached(el) {
  const key = legendContextKey(el)
  if (key == null) return readLegendContext(el)
  const hit = _legendContexts.get(key)
  if (hit) return hit
  const out = readLegendContext(el)
  _legendContexts.set(key, out)
  if (_legendContexts.size > LEGEND_CONTEXT_MAX) _legendContexts.delete(_legendContexts.keys().next().value)
  return out
}
/** Tests: forget every remembered context. */
export function _resetLegendContextsForTests() { _legendContexts.clear() }

/** ⭐ 2026-11-13 — a PLOT's own colour as legend text (the RS Line's "RS 96" end tag), kept
 *  only where it reads at >= 4.5:1 on the canvas sample it sits on; else null, and the caller
 *  draws the text in the legend's neutral ink and keeps the plot colour as a swatch. Measured:
 *  the RS line's #6ba3be on a white canvas is 2.7:1. An unreadable colour or canvas keeps the
 *  colour (nothing to judge it against), exactly as before. */
export function legibleInk(color, canvas, under = null) {
  if (!color) return null
  const rgb = legendCanvasRgb(canvas, under)
  if (!rgb) return color
  const c = legendTextContrast(color, rgb, 1)
  return c == null || c >= LEGEND_MIN_CONTRAST ? color : null
}
