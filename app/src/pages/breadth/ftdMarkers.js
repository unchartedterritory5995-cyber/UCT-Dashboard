/**
 * Follow-through days to mark on the chart, thinned for labelling.
 *
 * is_ftd clusters hard — the recorded history has seven hits between
 * 2026-04-08 and 2026-04-24 dating the April bottom, which would stack seven
 * labels inside three weeks. Every hit still draws a line; only the first of a
 * cluster carries a label, and a gap of `gap` sessions starts a new cluster.
 *
 * @param rows  visible rows in date order
 * @returns {Array<{date: string, label: boolean}>}
 */
export function ftdMarkers(rows, { gap = 5 } = {}) {
  const out = []
  let previous = -Infinity
  ;(rows ?? []).forEach((row, i) => {
    if (row?.is_ftd !== true) return
    out.push({ date: row.date, label: i - previous >= gap })
    previous = i
  })
  return out
}
