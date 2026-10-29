// app/src/components/chart/legendInk.js — which ink each neutral legend role draws in.
//
// The legend is drawn ON the chart canvas, which is painted from chart_settings, while its text
// rules name the APP theme's tokens. Over a canvas the app theme did not expect (a light app
// theme over the default dark canvas, a dark theme over a white one) those tokens read at
// 1.07-2.28:1 (WebKit, 2026-10-28). So, per ROLE and per canvas sample:
//
//   1. a member's explicit `header.colors.legend` wins everywhere (base legend, volume strip and
//      pane legends alike — one choice, one colour);
//   2. otherwise the app token KEEPS ITS LOOK when it already reads at >= 4.5:1 against the
//      canvas it sits on, at the role's own opacity step — a dark theme over a dark canvas is
//      exactly what it was (values --text-bright, labels --text, keys --text-muted);
//   3. only a token that would fail is replaced by the canvas ink, `legendInkForCanvas` (the one
//      rule a /charts theme also stores as header.colors.legend).
//
// Published by StockChart as CSS variables on its wrapper; every legend rule reads them with its
// old token as the fallback, so text rendered outside a chart is unchanged.
import { legendCanvasRgb, legendInkForCanvas, legendTextContrast } from './chartThemes'
import { parseColorAlpha } from '../../utils/dividerColor'

export const LEGEND_MIN_CONTRAST = 4.5

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
      let v
      if (legendColor) v = legendColor
      else {
        const t = tokens[role]
        const c = t ? legendTextContrast(t, canvas, opacity) : null
        v = c != null && c >= LEGEND_MIN_CONTRAST ? t : ink
      }
      out[`--legend-ink-${role}${suffix}`] = v
    }
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
