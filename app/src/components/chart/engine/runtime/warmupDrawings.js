// app/src/components/chart/engine/runtime/warmupDrawings.js
//
// ⭐⭐⭐ UIE PHASE 3 (M3A) — A RUN'S DRAWINGS OFF THE LISTING, HELD TO THE PLOTS' STANDARD.
//
// The warm-up curtain (`runtimeColumns.js::computeOffListing`) draws a listing
// document's PLOTS on a chart that does not start at the listing from the bar where two
// runs, begun on two different first bars, agree. Its DRAWINGS were withheld outright:
// the check compared columns, not objects. This is the check for objects, and it is
// the same evidence — two different starts, the same answer:
//
//   the drawings LIVE at the last bar of run A (from the chart's first bar) and of run
//   B (from `shift` bars later) are the SAME drawings, in the same creation order, every
//   property equal (`Object.is`, nested values by structure), where
//     * a bar-index coordinate (`xloc.bar_index`, the default: a line's x1/x2, a label's
//       x, a box's left/right) is compared in CHART bars — B's bar k is A's bar k + shift;
//     * an `xloc.bar_time` coordinate is an instant, the same in both runs;
//     * a linefill's two lines are compared by WHICH drawing they are (position in the
//       live list), not by id — the ids two runs hand out are their own;
//     * a table's cells are compared cell by cell;
//     * `createdBar` is NOT compared: it is not part of the picture (a diagnostic attribute,
//       and the collector's input DURING a run, whose effect — which drawings are still
//       live — is what is compared). A `var table` is made on each run's own first bar and
//       is the same dashboard in both.
//
// ⛔ ANY difference — one drawing more or fewer, one label's text, one box edge — and
// every drawing stays withheld by name: a picture is not drawn part-proven. A drawing
// whose text carries `bar_index` (or a running count) differs between the two runs and
// is withheld, which is right: what it would read here depends on where the chart starts.
// ⚠️ Like the plots' curtain this is MEASURED, not a proof about TradingView's own first
// bar: two starts agreeing is the evidence R-W accepts for a warm-up, and no more.

const X_PROPS = Object.freeze({ line: ['x1', 'x2'], label: ['x'], box: ['left', 'right'] })

const deepSame = (a, b) => {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepSame(a[k], b[k]))
}

/**
 * Whether two runs' live drawings are the same picture on the chart.
 * @param {Array} liveA  run A's `finish().live` (chart bars)
 * @param {Array} liveB  run B's (its bar k is the chart's bar k + shift)
 * @param {number} shift
 * @returns {{same: true} | {same: false, why: string}}
 */
export function sameDrawings(liveA, liveB, shift) {
  if (!Array.isArray(liveA) || !Array.isArray(liveB)) return { same: false, why: 'a run kept no drawings' }
  if (liveA.length !== liveB.length) {
    return { same: false, why: `one run ends with ${liveA.length} drawings and the other with ${liveB.length}` }
  }
  const posA = new Map(liveA.map((r, i) => [r.id, i]))
  const posB = new Map(liveB.map((r, i) => [r.id, i]))
  for (let i = 0; i < liveA.length; i += 1) {
    const a = liveA[i]
    const b = liveB[i]
    const at = `drawing ${i + 1} (a ${a.family})`
    if (a.family !== b.family) return { same: false, why: `${at} is a ${b.family} in the other run` }
    const pa = a.props || {}
    const pb = b.props || {}
    const keys = new Set([...Object.keys(pa), ...Object.keys(pb)])
    const byIndex = (pa.xloc === undefined || pa.xloc === 'bar_index') && pa.xloc === pb.xloc
    const xs = byIndex ? (X_PROPS[a.family] || []) : []
    for (const k of keys) {
      const va = pa[k]
      const vb = pb[k]
      if (xs.includes(k)) {
        const same = (typeof va === 'number' && typeof vb === 'number') ? Object.is(va, vb + shift) : Object.is(va, vb)
        if (!same) return { same: false, why: `${at}: its ${k} lands on a different bar` }
        continue
      }
      if ((k === 'line1' || k === 'line2') && va && vb && typeof va === 'object' && typeof vb === 'object') {
        if (posA.get(va.__ref) !== posB.get(vb.__ref)) return { same: false, why: `${at} fills between other lines` }
        continue
      }
      if (!deepSame(va, vb)) return { same: false, why: `${at}: its ${k} differs` }
    }
    if (!deepSame(a.cells || null, b.cells || null)) return { same: false, why: `${at}: its cells differ` }
  }
  return { same: true }
}
