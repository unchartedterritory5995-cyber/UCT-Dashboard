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
 * FLOOR, always. 20 rows rarely tile an arbitrary pixel height evenly, so ~≤19px of
 * remainder has to go somewhere. Unmerged it hides in the dark inter-widget margins.
 * Merged (no margins, no padding) this used to round UP so the board reached the
 * bottom edge — but the body is `overflow:hidden`, so those extra pixels were simply
 * CUT off the bottom-most widget, which is exactly where a chart's date/time axis
 * lives. Reported 2026-07-30: a merged board's time scale disappearing behind the
 * Windows taskbar. Flooring trades a thin strip of workspace under the board for
 * never clipping content, which is the right way round.
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
    // and it is omitted here. The old math never subtracted it, so an UNMERGED board
    // also rendered gridGap*2 = 12px taller than its body and clipped the bottom
    // row by 12px. Same defect as the merged ceil, just quieter (nobody noticed 12px
    // until the merged case took the whole axis). Zero when merged (gap is 0).
    - gridGap * 2
  return Math.max(12, Math.floor(available / FIXED_ROWS))
}
