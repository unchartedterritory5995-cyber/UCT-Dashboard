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

// ─── Fill resolution ────────────────────────────────────────────────────────

/**
 * What colour and opacity should this drawing's fill be?
 *
 * ⛔ A SHAPE THAT NAMES NO FILL MUST NOT CHANGE. Five surfaces fill a region —
 * Rectangle, Circle, Measure, Pitchfork's prongs, Parallel Channel's band — and
 * every one of them used to do the same two lines inline with its own hard-coded
 * alpha (0.08, 0.08, 0.06, 0.04, 0.04). Those numbers arrive here as
 * `baseOpacity`, so a drawing with no `fillColor` and no `fillOpacity` renders
 * exactly as it always has. Every rectangle and circle anyone has ever drawn is
 * in that case, and Phase 4 is not allowed to restyle them.
 *
 * @param {object} drawing
 * @param {string} strokeInk  the drawing's RESOLVED (brightened) stroke colour —
 *                            the same value the border is painted with, so a
 *                            fill that follows the colour cannot drift a shade
 *                            away from its own outline
 * @param {number} baseOpacity the painter's shipped alpha, used when the drawing
 *                            names none
 */
export function fillFor(drawing, strokeInk, baseOpacity = 0.08) {
  const clamp = (v, dflt) => (typeof v === 'number' && Number.isFinite(v))
    ? Math.max(0, Math.min(1, v))
    : dflt
  const own = drawing ? drawing.fillColor : null
  // ⛔ TWO DEFAULTS, AND THE DIFFERENCE IS THE WHOLE UX.
  //
  // NO EXPLICIT FILL — the shape tints itself with its own outline colour at the
  // shipped 0.08. That is what every existing rectangle and circle does, and it
  // must keep doing it exactly.
  //
  // AN EXPLICIT FILL — the user opened the Fill picker and chose a colour, and
  // that picker's OPACITY slider is the fill's opacity: it emits `rgba(...)`, so
  // the alpha they chose is already in the colour. Multiplying it by 0.08 again
  // would make the slider look broken (drag to 100%, get 8%). So an explicit
  // fill defaults to a multiplier of 1 and the colour carries the transparency.
  if (own === undefined || own === null) {
    return { color: strokeInk, opacity: clamp(drawing && drawing.fillOpacity, baseOpacity) }
  }
  return { color: own, opacity: clamp(drawing && drawing.fillOpacity, 1) }
}

// ─── Arrow head size ────────────────────────────────────────────────────────

/**
 * The three arrowhead sizes, in SCREEN pixels.
 *
 * ⛔ MEDIUM IS 10 BECAUSE 10 IS WHAT SHIPPED. `renderArrow` passed a hard-coded
 * `10` to `drawArrowhead`, so making Medium anything else would either restyle
 * every arrow anyone has ever drawn or leave legacy arrows matching no entry in
 * the picker. At 10 they are Medium, they look identical, and the control shows
 * them correctly the first time it is opened.
 *
 * ⭐ AND THE UNIT IS SCREEN PIXELS, NOT CHART SPACE. An arrowhead is chrome that
 * points at a place; the SHAFT is the geometry. Scaling the head with the zoom
 * would make it a blob at 5Y and invisible intraday.
 */
export const ARROW_SIZES = Object.freeze({ small: 7, medium: 10, large: 16 })
export const DEFAULT_ARROW_SIZE = ARROW_SIZES.medium

/** The stored numeric size for a drawing — legacy arrows carry none and are Medium. */
export const arrowSizeFor = (drawing) => {
  const v = drawing && drawing.arrowSize
  return (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : DEFAULT_ARROW_SIZE
}

/** Which named size is this, for showing the active entry in the picker? */
export const arrowSizeName = (drawing) => {
  const v = arrowSizeFor(drawing)
  return Object.keys(ARROW_SIZES).find((k) => ARROW_SIZES[k] === v) || null
}

/**
 * The border colour for a shape: its own if it has one, else the drawing colour.
 * `null` means "follow the line", which is a real user choice and not "unset".
 */
export function borderFor(drawing, strokeInk) {
  const own = drawing ? drawing.borderColor : null
  return (own === undefined || own === null) ? strokeInk : own
}
