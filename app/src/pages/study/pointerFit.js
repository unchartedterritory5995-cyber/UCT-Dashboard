/**
 * pointerFit — where the pointer's label chip ("THIS CANDLE", "YOU WERE RIGHT", "THE ANSWER") goes so it stays
 * fully inside the plot.
 *
 * Found on the real screen (2026-11-08, the RS drafts): lab/pointers spot() anchors the chip a fixed number of BARS
 * left of the candle, but a text drawing grows to the RIGHT of its anchor by a fixed number of PIXELS. The drill
 * frames its window exactly (exactDateRange), so the candle in question is the last one, against the price scale;
 * on a window of 100+ bars the bars are a few pixels wide and the chip ran past the candle and under the price
 * scale, clipped. This picks the chip's anchor bar from the chart's real bar width: the chip ends before the candle
 * (so it never covers it, and never reaches the scale); when the window is too narrow for that on the left, the chip
 * flips to the right of the candle if the bars after it (the reveal's forward strip) have the room.
 *
 * Pure: no DOM. DrillPlayer measures the chart box and hands the width in.
 */

/** The text drawing's own box (components/chart/drawingText.js: PAD_X 8 + BORDER_W 1, each side). */
export const CHIP_PAD_PX = 2 * (8 + 1)
/** A capital in the drawing font (Instrument Sans), in em, on the generous side so the estimate never under-reads. */
export const CHIP_CAP_EM = 0.68
export const CHIP_FONT_PX = 11
/** The right price scale the plot loses to (wide enough for a four-figure price; the RS pane shares it). */
export const PRICE_SCALE_PX = 72
/** The chart box width assumed before it is measured: a phone, so the first frame errs toward room. */
export const UNMEASURED_BOX_PX = 360

/** The chip's width in pixels for a label (spot() pads it with a space each side and prints it in capitals). */
export function chipWidthPx(label, fontPx = CHIP_FONT_PX) {
  const text = ` ${String(label || '').toUpperCase()} `
  return text.length * fontPx * CHIP_CAP_EM + CHIP_PAD_PX
}

/** Pixels per bar on an exactly framed window of `barCount` bars in a box `boxWidth` wide (unmeasured = a phone). */
export function barPxFor(boxWidth, barCount, scalePx = PRICE_SCALE_PX) {
  const w = Number(boxWidth) > 0 ? Number(boxWidth) : UNMEASURED_BOX_PX
  const n = Number(barCount)
  if (!(n > 0)) return null
  return Math.max(0.5, (w - scalePx) / n)
}

/** spot()'s own anchor (lab/pointers.js): the starting point, which this only ever moves further left or flips. */
export function defaultChipIndex(i, label, gap = 11) {
  return i - gap - Math.max(3, Math.ceil(String(label || '').length / 3))
}

/**
 * chipPlacement({ i, n, label, barPx, gap }) -> { index, side, span }
 *   i      the candle the pointer is on        n      bars in the window
 *   barPx  pixels per bar (barPxFor)           gap    spot()'s arrow length in bars
 * `index` is the bar the chip is anchored at (its LEFT edge), never 0 (a drawing anchored on the window's edge is
 * culled by the overlay); `span` is how many bars the chip covers; `side` is 'left' or 'right' of the candle.
 */
export function chipPlacement({ i, n, label, barPx, gap = 11, fontPx = CHIP_FONT_PX }) {
  const base = defaultChipIndex(i, label, gap)
  if (!(barPx > 0) || !(n > 0)) return { index: Math.max(1, base), side: 'left', span: null }
  // the bars the chip covers, plus one for the half bar at the anchor and at the end
  const span = Math.ceil(chipWidthPx(label, fontPx) / barPx) + 1
  const left = Math.min(base, i - 1 - span)    // the chip ends before the candle in question
  if (left >= 1) return { index: left, side: 'left', span }
  const right = i + 2                          // clear of the candle and its halo (one bar each side)
  if (right + span <= n - 1) return { index: right, side: 'right', span }
  // neither side has the room: stay inside the plot at least, as far right as the chip still fits
  return { index: Math.max(1, Math.min(base, n - 1 - span)), side: 'left', span }
}

/** The chip's right edge, in bars, for a placement: what has to stay at or before the last bar. */
export function chipEnd(placement) {
  return placement.span == null ? null : placement.index + placement.span
}
