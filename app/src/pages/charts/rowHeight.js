// Viewport-lock row-height math for the /charts board.
//
// Extracted from ChartsWorkspace so BOTH boards that run it (the main tab and a
// popped-out window, which measures its own window) share one implementation AND so
// the fit invariant below is testable — it was broken silently for merged boards and
// the only symptom was a chart's date axis sitting behind the OS taskbar.

export const FIXED_ROWS = 20   // the board is viewport-locked to this many rows
export const MARGIN_Y = 6      // px gap between widgets vertically (0 when merged)
export const BODY_PAD = 6      // px padding around the grid (0 when merged)

/** Total height react-grid-layout will give the grid container for `rows` rows.
 *  Mirrors RGL's own formula: rows*rowHeight + (rows-1)*marginY + containerPaddingY*2,
 *  where containerPadding defaults to margin. Exported so the fit assertion has one
 *  definition of "how tall does this actually render". */
export function gridHeightFor(rowHeight, gridGap, rows = FIXED_ROWS) {
  return rows * rowHeight + (rows - 1) * gridGap + gridGap * 2
}

/**
 * Row height that fits FIXED_ROWS rows inside a body of `clientHeight` px.
 *
 * EXACT, not rounded. 20 rows rarely tile an arbitrary pixel height as whole numbers,
 * and rounding forces a choice between two bugs: FLOOR leaves up to ~19px of remainder
 * that piles up as an oversized gap under the bottom row (the board sits above the
 * taskbar with a fat dark strip); CEIL overshoots and, since the body is overflow:clip,
 * shears that strip off the bottom-most widget — exactly where a chart's date/time axis
 * lives (the 2026-07-30 "time scale behind the Windows taskbar" report).
 *
 * A FRACTIONAL row height dissolves the dilemma. Feed the exact quotient to RGL and the
 * rendered grid height telescopes back to the body's inner height to the pixel (see
 * gridHeightFor: the FIXED_ROWS*rowHeight term cancels the /FIXED_ROWS below), so the
 * board fills its body with NO leftover gap and NO overflow — every margin (top, bottom,
 * left, right) is just the padding, and merged mode reaches flush to the taskbar. RGL
 * positions items at sub-pixel transforms without complaint, and the body's overflow:clip
 * absorbs any ≤1px float rounding. Only the degenerate <12px/row clamp stays integer-ish.
 *
 * @param clientHeight measured body height INCLUDING its padding (an element's
 *   clientHeight), matching what the callers read off the DOM.
 * @param merged whether the board is in merged mode — zeroes both the gap and the
 *   body padding, and MUST match the actual CSS (a mismatch is its own overflow bug).
 */
export function computeRowHeight(clientHeight, merged) {
  const bodyPad = merged ? 0 : BODY_PAD
  const gridGap = merged ? 0 : MARGIN_Y
  const available = (clientHeight - bodyPad * 2)
    - gridGap * (FIXED_ROWS - 1)
    // RGL's containerPadding, which defaults to `margin` when the prop is omitted —
    // and it is omitted here. Subtract it so the exact fill accounts for the top+bottom
    // container padding too; zero when merged (gap is 0).
    - gridGap * 2
  return Math.max(12, available / FIXED_ROWS)
}
