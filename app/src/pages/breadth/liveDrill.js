/**
 * Where one cell's list of names comes from.
 *
 * Two surfaces render the same live row — the monitor table and the eight
 * BreadthViews tiles — and both must answer this identically. A cell that opens
 * a live list in one place and yesterday's in the other is the kind of drift
 * nothing reports, so the decision lives here once rather than twice.
 *
 * Three cases:
 *
 *   settled row   drills its own date, exactly as it always has
 *   live + live   drills the LIVE endpoint
 *   live + carried  drills the SESSION IT CAME FROM
 *
 * That last one is the whole reason this isn't a boolean. `atr_ext_7` needs
 * intraday high/low, so the live row shows last night's number; opening today's
 * list for it would caption a past session's names as today's. Routing it to
 * `carried_from` gives a working click AND a truthful list.
 */
export function drillTarget(row, col, live = null) {
  if (!col?.drillKey || !row) return null

  if (!row._live) {
    return { url: `/api/breadth-monitor/${row.date}/drill/${col.drillKey}`,
             date: row.date, live: false }
  }

  if (live?.carried?.has?.(col.key)) {
    // No date to attribute the names to — better inert than mislabelled.
    if (!live.carriedFrom) return null
    return { url: `/api/breadth-monitor/${live.carriedFrom}/drill/${col.drillKey}`,
             date: live.carriedFrom, live: false }
  }

  return { url: `/api/breadth-monitor/live/drill/${col.drillKey}`,
           date: row.date, live: true }
}

export default drillTarget
