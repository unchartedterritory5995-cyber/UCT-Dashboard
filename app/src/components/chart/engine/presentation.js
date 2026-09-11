/**
 * HOW an output draws — as distinct from WHAT it computes and WHERE it goes.
 *
 * ⭐⭐ THIS FILE IS THE THIRD SIDE OF THE TRIANGLE. `nativeRegistry` owns
 * CALCULATION, `displayTarget.js` owns PLACEMENT, and this owns PRESENTATION.
 * The whole point of POC D is that changing this one changes neither of the
 * others: an RSI drawn as a single horizontal line at its current value is the
 * SAME RSI, computed once, placed where it already was — only its plot style
 * differs. If switching style ever recomputes, the seam has failed.
 *
 * ⛔ DELIBERATELY NOT AN RSI BOOLEAN. The owner's instruction was explicit: do
 * not make Last Value Horizontal a flag on one indicator. It is a member of a
 * VOCABULARY that Histogram, Dots and Area join later without this file
 * changing shape — which is why the stored value is a style NAME and not
 * `lastValueHorizontal: true`.
 *
 * ⚠️ PER INSTANCE TODAY, PER OUTPUT EVENTUALLY. A multi-output indicator
 * (MACD: line, signal, histogram) will want a style per plot, and the natural
 * growth is `presentation.plots[plotKey].style` alongside the instance-wide
 * default this reads. Nothing here has to move for that; `resolvePlotStyle`
 * gains an optional plot argument and falls back to what it already returns.
 */

/** The default. Absent means this, and `setInstancePlotStyle` deletes rather
 *  than writes it, so the default has exactly one representation on disk. */
export const DEFAULT_PLOT_STYLE = 'line'

/** Every style the binder can actually draw. A stored value outside this list
 *  is data that bypassed validation and reads as the default rather than as a
 *  guess — the same fail-safe direction `resolvePlacement` takes. */
export const PLOT_STYLES = Object.freeze(['line', 'lastValueHorizontal'])

/** What the Plot Style control offers, in order, with the words a user sees. */
export const PLOT_STYLE_CHOICES = Object.freeze([
  { value: 'line', label: 'Line' },
  { value: 'lastValueHorizontal', label: 'Last value horizontal' },
])

/**
 * The effective plot style for one instance.
 *
 * @param {object} instance an entry from `cs.indicatorInstances`
 * @returns {string} a member of `PLOT_STYLES`
 */
export function resolvePlotStyle(instance) {
  const stored = instance && instance.presentation && instance.presentation.plotStyle
  return (typeof stored === 'string' && PLOT_STYLES.includes(stored)) ? stored : DEFAULT_PLOT_STYLE
}

/**
 * Does this style draw the HISTORY, or only the current value?
 *
 * ⭐ THE SERIES KEEPS ITS DATA EITHER WAY, and that is the load-bearing part.
 * "The historical line disappears" is a statement about INK, not about the
 * numbers: the crosshair still reads a value per bar, the legend still prints
 * `RSI(14) 56.53`, `readout.legendChips` is untouched, and nothing recomputes.
 * Only `visible` changes — so switching back is a repaint, not a rebuild.
 */
export function drawsHistory(style) {
  return style !== 'lastValueHorizontal'
}
