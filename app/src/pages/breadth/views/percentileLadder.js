/**
 * The Percentile Ladder's geometry — framework-free, beside the view, the same
 * shape `rotation.js` and `divergence.js` take for their lenses.
 *
 * ⛔ IT LIVES HERE RATHER THAN IN THE VIEW because a component module that also
 * exports a constant or a helper cannot hot-reload as a component
 * (`react-refresh/only-export-components`), and the rule is right: the file
 * stops being a component module the moment something else imports a value out
 * of it. The view's own test imports `markerX` — so this is where it goes.
 */

// The marker's width and the track it slides along, in the row svg's viewBox
// units. Read by `markerX` below and by the `<rect>` the view draws.
export const MARKER_W = 1.4
export const TRACK_W = 100

/**
 * 🔴 THE 100th-PERCENTILE MARKER USED TO DRAW NOTHING AT ALL.
 *
 * `x={pct}` inside `viewBox="0 0 100 26"` puts a reading at the top of its own
 * distribution at x ∈ [100, 101.4] — entirely outside the box, so the svg
 * clipped it — and 96-99 were progressively half-clipped. A reading at the very
 * top of its distribution is exactly what this lens exists to surface, so the
 * one position that mattered most was the one that rendered blank.
 *
 * The marker is centred on its percentile and then clamped into the track.
 */
export const markerX = (pct) =>
  Math.min(Math.max(pct - MARKER_W / 2, 0), TRACK_W - MARKER_W)
