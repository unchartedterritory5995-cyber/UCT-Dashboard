// Pin bookkeeping for the Layout Dock (see LayoutDock.jsx).
//
// Extracted from the component for the same reason rowHeight.js was: this is the
// rule that decides what appears on the bar, and it is worth testing without a
// DOM. (It also keeps LayoutDock.jsx exporting nothing but its component, which
// is what Fast Refresh needs.)

import { parsePref } from '../../hooks/usePreferences'

// The frozen "UCT Default" is not a DB row, so it needs an id of its own to be
// pinnable and to read as active. ChartsWorkspace writes the same sentinel into
// charts_active_template from applyUctDefault().
export const UCT_DEFAULT_ID = 'uct-default'

export const DOCK_PREF = 'charts_layout_dock'

/**
 * Stored shape: { pins: [id…], known: [id…], hidden: bool }.
 *
 * `known` is what makes "a layout you save is pinned; a layout you unpin is not"
 * survive a reload. Without it the two states are indistinguishable on the next
 * load — an unpinned layout still exists, so an "append anything not pinned"
 * rule would silently re-pin it every session.
 */
export function readDockPref(raw) {
  const v = parsePref(raw, null)
  if (!v || typeof v !== 'object' || !Array.isArray(v.pins)) return null
  return {
    pins: v.pins,
    known: Array.isArray(v.known) ? v.known : v.pins,
    hidden: v.hidden === true,
  }
}

/**
 * Fold the live layout list into the stored pin order.
 *  - first run (no pref): seed with everything, in list order — the dock is
 *    useful the second it ships instead of presenting an empty bar
 *  - deleted layouts drop out of both lists
 *  - layouts we have never seen append to the end (a Save-as from the Layouts
 *    menu lands on the bar too)
 */
export function reconcilePins(stored, entries) {
  const ids = entries.map(e => e.id)
  if (!stored) return { pins: ids, known: ids, hidden: false }
  const live = new Set(ids)
  const seen = new Set(stored.known)
  const kept = stored.pins.filter(id => live.has(id))
  const added = ids.filter(id => !seen.has(id))
  return { pins: kept.concat(added), known: ids, hidden: stored.hidden }
}

/** Value equality, so a reconciliation that changed nothing is never persisted. */
export function sameDock(a, b) {
  return !!a && !!b && a.hidden === b.hidden &&
    a.pins.length === b.pins.length && a.pins.every((v, i) => v === b.pins[i]) &&
    a.known.length === b.known.length && a.known.every((v, i) => v === b.known[i])
}

/**
 * A stable signature of a board's ARRANGEMENT — the only thing the dock's
 * unsaved-state indicator compares.
 *
 * Deliberately excludes everything else a layout blob carries (chart settings,
 * watchlist columns, per-widget opts, colors): those are rewritten by ordinary
 * use and by theme resolution, so including them would light the dot on a board
 * nobody touched — and a false dirty fires the switch-away confirm on every
 * switch, turning the guard into noise.
 *
 * Sorted, so a reordered widgets array is not a change.
 */
export function arrangementSig(layout) {
  const widgets = Array.isArray(layout?.widgets) ? layout.widgets : []
  const parts = widgets
    .map(w => `${w.id}:${w.type}:${w.x ?? 0},${w.y ?? 0},${w.w ?? 0},${w.h ?? 0}`)
    .sort()
  return `${layout?.cols ?? ''}|${parts.join('|')}`
}
