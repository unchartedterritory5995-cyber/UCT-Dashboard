// app/src/components/chart/engine/markerPrimitive.js
//
// ─── C3A: EVENT MARKERS, AS A PURE FUNCTION OF A COLUMN ─────────────────────
//
// `plotshape(cond, style = shape.triangleup, location = location.abovebar,
// text = "BUY")` draws a glyph on every bar where `cond` is true. The engine
// already carries the CONDITION — `pine.js` yields it as an ordinary 0/1 column
// and has done since before this wave, which is why a `plotshape` script can
// already be screened on. What it did not carry was the GLYPH; the translator's
// own header said so ("WHAT IS NOT CLAIMED: the GLYPH").
//
// ⭐⭐ THE WHOLE RENDER IS A LIST, AND THAT IS WHY IT LIVES HERE. Lightweight-
// charts takes markers as data (`createSeriesMarkers(series, markers)`), so the
// interesting part is deciding WHICH BARS and WHAT EACH SAYS — arithmetic over a
// column, testable without a chart, a canvas, or a DOM. `binder.js` does the
// attaching; this module answers the question.
//
// ⛔ AN EVENT COLUMN'S DOMAIN IS {0, 1, NaN} AND ALL THREE MEAN SOMETHING.
// `1` is the event. `0` is "computed, did not happen". `NaN` is the warm-up pad
// — bars before the condition is computable at all. Treating NaN as false would
// be harmless here (neither draws) but treating "any finite non-zero" as true
// would not: a `plotshape` fed a PRICE (which Pine allows, and which
// `location.absolute` is for) would then mark every bar with a non-zero price,
// which is every bar. So the test is explicit rather than truthy.

/** Does this column value mark its bar?
 *
 *  ⚠️ `> 0` RATHER THAN `!== 0`, and it is deliberate. Pine's own rule for
 *  `plotchar`/`plotshape` is that the series is drawn where it is neither `na`
 *  nor `false`; a translated boolean is exactly 0 or 1, so the two readings
 *  agree on every column this engine actually produces. Where they differ — a
 *  NEGATIVE number — `> 0` is the safer half: `plotarrow` (the one call whose
 *  sign is its meaning) would otherwise mark its down-arrows as up-events. */
const marks = (v) => Number.isFinite(v) && v > 0

/**
 * The markers one plot draws.
 *
 * @param {object} spec
 * @param {ArrayLike<number>} spec.column the event column, one value per bar
 * @param {Array<number>} spec.times one chart time per bar, already adjusted
 * @param {object} spec.marker `{shape, position, size, text}` — the validated
 *   `plots[i].marker`
 * @param {string} spec.color the marker colour, already resolved
 * @param {ArrayLike<number>|null} [spec.condColumn] a `colorMode: 'column:<key>'`
 *   condition, so a marker can take the same two-colour treatment a line does
 * @param {string|null} [spec.colorUp]
 * @param {string|null} [spec.colorDown]
 * @returns {Array<object>} LWC marker objects, ascending by time
 */
export function markersFor({ column, times, marker, color,
  condColumn = null, colorUp = null, colorDown = null }) {
  const out = []
  if (!column || !times || !marker) return out
  const n = Math.min(
    typeof column.length === 'number' ? column.length : 0,
    times.length,
  )
  // ⭐ THE TWO-COLOUR RULE IS THE SAME ONE `binder.toPoints` APPLIES TO A LINE,
  // read off the same fields. A marker whose colour rule disagreed with the line
  // drawn from the same condition would be two authorities over one signal.
  const twoTone = condColumn && colorUp && colorDown
  for (let i = 0; i < n; i += 1) {
    if (!marks(column[i])) continue
    const c = twoTone
      ? ((Number.isFinite(condColumn[i]) && condColumn[i] !== 0) ? colorUp : colorDown)
      : color
    const m = {
      time: times[i],
      position: marker.position || 'aboveBar',
      shape: marker.shape,
      color: c,
    }
    if (marker.text) m.text = marker.text
    if (Number.isFinite(marker.size)) m.size = marker.size
    out.push(m)
  }
  return out
}

/**
 * A tiny stateful holder so the binder can create the controller once and
 * update it, rather than re-creating markers on every bar update.
 *
 * ⛔ IT NEVER IMPORTS `lightweight-charts`. The factory is injected, exactly as
 * `binder.js` injects everything else it needs from the chart library — that is
 * what lets every engine test in this directory run without a canvas, and what
 * makes this module's own behaviour checkable with a two-line fake.
 */
export function createMarkerLayer(createSeriesMarkers, series) {
  let controller = null
  let last = null
  return {
    set(markers) {
      // ⚠️ A NO-OP WRITE IS SKIPPED. Markers are re-derived on every bind, and
      // a chart that re-sets an identical list on every 250ms bar tick spends
      // its frame budget redrawing the same glyphs.
      const sig = JSON.stringify(markers)
      if (sig === last) return
      last = sig
      if (!controller) {
        if (!markers.length) return
        controller = createSeriesMarkers(series, markers)
        return
      }
      controller.setMarkers(markers)
    },
    clear() {
      if (controller) {
        last = '[]'
        controller.setMarkers([])
      }
    },
    get attached() { return controller !== null },
  }
}
