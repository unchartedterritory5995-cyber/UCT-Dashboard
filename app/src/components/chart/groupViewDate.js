// app/src/components/chart/groupViewDate.js
//
// ⭐ (2026-11-28, zero-network plan PR 1.3) THE DATE A COLOUR GROUP'S CHARTS ARE AT. A chart the date box sent to a past
// date reads the WINDOW ending there on intraday (chart/viewWindow), so a list on the same colour that warms its next rows
// must warm THAT key: the plain key's newest rows are another set of bars, and an arrow onto a row warmed on the plain
// key waited on a cold window. The chart widget publishes its date here (ChartWidget, while anchored and not in replay);
// the list reads it at each warm (Watchlists sendWarm). Module state, no React: a publish re-renders nothing.
// One entry per (group, owner): two charts on one colour at different dates -> the latest published wins.

const _byGroup = new Map()   // group -> Map(owner -> day 'YYYY-MM-DD')

/** `day`: the ISO date the owner's chart is at, or null (the present / replay / unmounted): its entry goes. */
export function publishGroupDate(group, owner, day) {
  if (!group || !owner) return
  let m = _byGroup.get(group)
  if (!day) {
    if (m) { m.delete(owner); if (!m.size) _byGroup.delete(group) }
    return
  }
  if (!m) { m = new Map(); _byGroup.set(group, m) }
  m.delete(owner)   // re-inserted last: the latest published wins
  m.set(owner, String(day).slice(0, 10))
}

/** The date the group's charts are at ('YYYY-MM-DD'), or null at the present. */
export function groupDateFor(group) {
  const m = group ? _byGroup.get(group) : null
  if (!m || !m.size) return null
  let last = null
  for (const d of m.values()) last = d
  return last
}

/** (tests) forget every group's date */
export function _resetGroupDatesForTests() { _byGroup.clear() }
