// app/src/components/chart/groupViewDate.js
//
// ⭐ (2026-11-28, zero-network plan PR 1.3) WHICH KEYS A COLOUR GROUP'S CHARTS READ, PER TIMEFRAME. A chart the date box
// sent to a past date reads the WINDOW ending there on intraday (chart/viewWindow), so a list on the same colour that
// warms its next rows must warm THAT key: the plain key's newest rows are another set of bars. Each chart widget notes the
// key family it reads here (ChartWidget, while its board is shown): its native fetch timeframe and, when it reads a
// window, the date. The list asks, per timeframe it warms, which variants to warm (Watchlists sendWarm: warmVariantsFor).
// Module state, no React: a note re-renders nothing.
//
// ⛔ (review of #3020, B1/B2) PER TIMEFRAME, never per colour: a D chart at 2006 and a 5m chart at the present on one
// colour read D (plain: D/W/M read the plain key at a date) and 5 (plain), so the list warms both plain; a custom-tf chart
// (2h) reads its native base's PLAIN key at a date (chartKeyFor drops the window for a custom tf), so it notes `present`.
// A timeframe with charts both dated and present warms both keys. Two dated charts on one timeframe: the latest noted wins.
// ⛔ (R1) a hidden board's charts note nothing (noteGroupChartWhileShown): a board kept alive in the background must not
// drive the visible board's list.
import { viewWindowOfDate } from './viewWindow'
import { fetchTf } from './timeframes'
import { whileBoardShown } from './boardVisibility'

const _byGroup = new Map()   // group -> Map(owner -> { tf, day })

/** The key family a chart on widget timeframe `tf` reads, anchored at `day` ('YYYY-MM-DD') or not: its fetch timeframe,
 *  and the day only when that read is a window (native intraday; never D/W/M, never a custom timeframe). */
export function groupChartEntry(tf, day) {
  const t = String(tf || '')
  if (!t) return null
  const windowed = !!(day && viewWindowOfDate(String(day).slice(0, 10), t))
  return { tf: fetchTf(t), day: windowed ? String(day).slice(0, 10) : null }
}

export function noteGroupChart(group, owner, entry) {
  if (!group || !owner || !entry?.tf) return
  let m = _byGroup.get(group)
  if (!m) { m = new Map(); _byGroup.set(group, m) }
  m.delete(owner)   // re-inserted last: the latest noted wins among dated charts on one timeframe
  m.set(owner, { tf: String(entry.tf), day: entry.day || null })
}

export function dropGroupChart(group, owner) {
  const m = group ? _byGroup.get(group) : null
  if (!m) return
  m.delete(owner)
  if (!m.size) _byGroup.delete(group)
}

/** Note `entry` while the board `vis` is shown (dropped at the hide, noted again at the show). Returns the stop. */
export function noteGroupChartWhileShown(vis, group, owner, entry) {
  return whileBoardShown(vis, () => {
    noteGroupChart(group, owner, entry)
    return () => dropGroupChart(group, owner)
  })
}

/**
 * The key variants a list on `group` warms for timeframe `tf`: `[{ id, viewWindow }]`. The plain key (viewWindow null)
 * when a chart on that timeframe reads it or none notes the timeframe at all (the list's own warm, as before); the window
 * of the latest dated chart on that timeframe when one is anchored.
 */
export function warmVariantsFor(group, tf) {
  const t = String(tf || '')
  const m = group ? _byGroup.get(group) : null
  let present = false
  let day = null
  let any = false
  if (m) for (const e of m.values()) {
    if (e.tf !== t) continue
    any = true
    if (e.day) day = e.day
    else present = true
  }
  const out = []
  if (present || !any || !day) out.push({ id: t, viewWindow: null })
  const vw = day ? viewWindowOfDate(day, t) : null
  if (vw) out.push({ id: `${t}@${day}`, viewWindow: vw })
  return out
}

/** (tests) forget every group */
export function _resetGroupDatesForTests() { _byGroup.clear() }
