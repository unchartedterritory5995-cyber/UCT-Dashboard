/* Line style for the drawing layer — one dash table, one authority.
 *
 * ⚰️ WHAT THIS REPLACES, AND WHY IT IS ONLY HALF A FIX (Phase 0, deliberately).
 *
 * The Color/Style picker offers three line styles and only two of them work.
 * The cause is not one bug, it is the same fact written down three times and
 * getting a different answer each time:
 *
 *   ColorPanel.jsx:277          offers  [[0,'solid'], [2,'dashed'], [1,'dotted']]
 *   ChartDrawingOverlay:2940    DRAW_STYLE_TO_NUM = { solid: 0, dashed: 2 }
 *   ChartDrawingOverlay:2941    numToDrawStyle = n => (n === 0 ? 'solid' : 'dashed')
 *   ChartDrawingOverlay:1687    ctx.setLineDash(d.lineStyle === 'dashed' ? [6,4] : [])
 *
 * So clicking Dotted STORES `'dashed'`, and reopening the picker reads that back
 * and highlights Dashed. The button is not dead — it is writing the wrong value.
 *
 * ⛔ PHASE 0 LANDS THE TABLE, NOT THE FIX. This module becomes the renderer's
 * single source for "what dash pattern is this style?", and it knows about
 * `dotted`. The two MAPS in the overlay are deliberately left broken, so no
 * drawing can currently carry `lineStyle: 'dotted'` and the render path is
 * byte-identical to before. Phase 1 flips those two maps and the feature lights
 * up with the dash pattern already under test. `drawingStyle.test.js` pins BOTH
 * halves: what the table does, and what the picker maps still (wrongly) do — so
 * Phase 1's change has to update a test that names the behaviour it is fixing,
 * rather than silently flipping an untested branch.
 */

/** Canonical dash patterns, keyed by the stored `lineStyle` string.
 *
 *  ⭐ THE VALUES FOR `solid` AND `dashed` ARE THE SHIPPED ONES, unchanged.
 *  `dotted` is new and unreachable until Phase 1. */
export const LINE_DASH = Object.freeze({
  solid: Object.freeze([]),
  dashed: Object.freeze([6, 4]),
  dotted: Object.freeze([2, 3]),
})

/** The style a drawing gets when it names none — and when it names one nobody
 *  has heard of. Unknown reads as solid rather than throwing: a drawing from a
 *  newer client must still render on an older one. */
export const DEFAULT_LINE_STYLE = 'solid'

/**
 * Dash array for a stored `lineStyle`.
 *
 * ⛔ RETURNS A FRESH ARRAY, NEVER THE FROZEN TABLE ENTRY. `ctx.setLineDash()` is
 * specified to copy its argument, so handing out the shared array would be safe
 * *today* — but the table is frozen and a caller that decided to scale a pattern
 * in place would throw in strict mode and silently no-op otherwise. Copying
 * costs nothing at these lengths and removes the question.
 */
export function dashFor(style) {
  const pattern = LINE_DASH[style] || LINE_DASH[DEFAULT_LINE_STYLE]
  return pattern.slice()
}

/** Is this a style the drawing layer can actually render? */
export function isLineStyle(style) {
  return Object.prototype.hasOwnProperty.call(LINE_DASH, style)
}
