// app/src/components/chart/engine/styleCapability.js
//
// ─── WHICH PLOT STYLES ONE INSTANCE MAY TAKE — ONE ANSWER, EVERY READER ─────────
//
// ⭐ MOVED VERBATIM OUT OF `ChartSettingsIndicators.jsx` (2026-10-27). The Inspector's
// Plot style control and the Agent's `setPlotStyle` mutation (I-2) must offer the SAME
// styles: a style the Agent could write that the menu never offers is a second writer's
// rule. `ohlcCapableFor` and `sourceCapabilityFor` are unchanged; `styleChoicesFor` is
// the control's own `restyleable` / `availableStyles` loop, as data.

import { ohlcCapabilityOf, outputIsSource } from './ohlcCapability'
import { anyCachedBars } from './secondaryBars'
import { canonicalFamily, canonicalSourceCapability } from '../../../hooks/useMarketIndicators'
import { sourceInputsOf, parseSource } from './sourceRef'
import { availableStyles, resolvePlotStyle } from './presentation'
import { resolveDisplayTarget } from './displayTarget'

/**
 * Is this instance's source genuinely OHLC-bearing?
 *
 * ⭐ ONE CAPABILITY ANSWER, TWO READERS. It began as an IIFE inside the style
 * control; the COLLAPSED row's summary needs the same answer, and a second copy
 * is how "Candles" ends up offered in one place and denied in the other.
 *
 * ⚠️ `anyCachedBars` IS THE WINDOW-AGNOSTIC READ: this tab knows the INSTRUMENT
 * and never the chart's timeframe, so asking for a specific (tf, bars) window
 * would make the answer flicker with the chart.
 */
export function ohlcCapableFor(def, inst) {
  if (!inst || !def) return false
  const declared = sourceInputsOf(def, inst)
  if (!declared.length) return false
  const parsed = parseSource(declared[0][1])
  if (!parsed || parsed.kind !== 'symbol') return false
  return ohlcCapabilityOf(def, parsed, anyCachedBars(parsed.symbol), canonicalFamily).ok
}

/**
 * The SOURCE's presentation capability for one instance — the exact answer the
 * binder computes, from the exact same two functions.
 *
 * ⛔⛔ THE MENU AND THE RENDERER MUST READ ONE CONTRACT, and this is the whole
 * reason this helper exists rather than an inline object. A dropdown that offers a
 * style the resolver then clamps is a dropdown that lies; a dropdown that hides a
 * style the resolver would have honoured silently removes a member's control. Both
 * are the same bug — two implementations of one rule — and the way to not have it
 * is for `styleCtx` here and `sourceCapabilityFor` in `binder.js` to be the same
 * three lines over the same inputs.
 *
 * ⚠️ THE DEFAULT IS GATED ON `passthrough` HERE TOO, identically: only a row that
 * IS its source takes its source's default, because `dataSeries` declares
 * `style: 'line'` generically while an authored definition means it.
 */
export function sourceCapabilityFor(def, inst) {
  if (!inst || !def) return null
  const declared = sourceInputsOf(def, inst)
  if (!declared.length) return null
  const parsed = parseSource(declared[0][1])
  if (!parsed || parsed.kind !== 'symbol' || !parsed.symbol) return null
  const cap = canonicalSourceCapability(parsed.symbol, ohlcCapableFor(def, inst))
  if (outputIsSource(def)) return cap
  return { defaultStyle: null, allowedStyles: cap.allowedStyles }
}

/** The `ctx` the Plot style control hands `availableStyles` / `resolvePlotStyle`. */
export function styleContextFor(def, inst, cs) {
  const srcCap = sourceCapabilityFor(def, inst)
  return {
    target: resolveDisplayTarget(inst, cs),
    ohlcCapable: ohlcCapableFor(def, inst),
    sourceDefaultStyle: srcCap ? srcCap.defaultStyle : null,
    allowedStyles: srcCap ? srcCap.allowedStyles : null,
  }
}

/**
 * Every output the Plot style control shows for this instance, with its current
 * style and the styles it offers.
 *
 * ⚠️ `plotKey` IS NULL FOR A SINGLE RESTYLEABLE OUTPUT — the control then writes the
 * INSTANCE-level style (`setInstancePlotStyle(…, undefined)`), exactly as the UI does.
 * @returns {{plotKey: string|null, key: string, label: string, current: string, choices: string[]}[]}
 */
export function styleChoicesFor(def, inst, cs) {
  if (!def || !inst) return []
  const styleCtx = styleContextFor(def, inst, cs)
  const plots = Array.isArray(def.plots) ? def.plots : []
  const restyleable = plots.filter((pl) => pl && pl.hidden !== true && availableStyles(pl, styleCtx).length > 0)
  const single = restyleable.length === 1
  return restyleable.map((plot) => ({
    plotKey: single ? null : plot.key,
    key: plot.key,
    label: plot.label || plot.key,
    current: resolvePlotStyle(inst, plot, styleCtx),
    choices: availableStyles(plot, styleCtx),
  }))
}
