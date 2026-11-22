// app/src/components/chart/legend/indicatorTour.js
//
// ─── THE FIRST-ADD TOUR, ON THE CHART (UCT RS Phase 4, unit 4-05) ───────────
//
// PURE apart from one session set. The indicator library reports the first add
// of a definition that declares `meta.tour` (`IndicatorLibraryDialog`'s
// `onFirstAdd`, unit 4-03); the chart then opens its chip menu on a Tour page.
// This file answers the two questions that host asks, and names no indicator.
//
// ⛔ ONCE PER PAGE SESSION, ACROSS EVERY CHART. The seen state is the member's
// preference (`useIndicatorTours`, written on Done or Skip). Until that write
// lands — or when the member closes the tour without finishing it — a second
// chart on the same page (the /charts grid) must not open it again. A chart that
// opens a tour claims it here first; a claimed tour opens nowhere else until
// the page reloads.

import { definitionVisibility } from '../engine/instanceControls'
import { ENGINE_OWNED } from '../engine/flipState'

/** The tour cards a definition declares, or `[]`: only `{title, body}` cards whose two fields are text. */
export function tourCardsOf(def) {
  const tour = def && def.meta && Array.isArray(def.meta.tour) ? def.meta.tour : null
  if (!tour) return []
  return tour.filter((c) => c && typeof c.title === 'string' && c.title && typeof c.body === 'string' && c.body)
}

const claimed = new Set()

/** Claim `defId`'s tour for this page session: true the first time, false after. */
export function claimTour(defId) {
  if (!defId || claimed.has(defId)) return false
  claimed.add(defId)
  return true
}

/** Whether `defId`'s tour was already opened on this page. */
export function tourClaimed(defId) {
  return !!defId && claimed.has(defId)
}

/** Tests only: forget every claim. */
export function resetTourClaims() {
  claimed.clear()
}

/**
 * Is `before` → `after` the FIRST add of `row`'s definition, and does that
 * definition declare a `meta.tour`? `before` had no live instance of it, `after`
 * has one. Showing a HIDDEN instance starts from `hidden`, not `absent`, so it is
 * never a first add; nor is a second instance. A built-in, carved-out or
 * restoring row has no definition to tour. Pure: the caller asks whether the
 * member has seen the tour (`useIndicatorTours`). Shared by the indicator
 * library dialog and the Chart Settings → Indicators add surface (4-11), so the
 * two doors cannot disagree on what a first add is.
 */
export function isTouredFirstAdd(row, before, after, registry) {
  if (!row || row.builtIn || row.carvedOut || row.restores || !row.id) return false
  if (!before || !after || before === after) return false
  const def = typeof registry?.getDefinition === 'function' ? registry.getDefinition(row.id) : null
  const tour = def && def.meta && def.meta.tour
  if (!Array.isArray(tour) || tour.length === 0) return false
  if (definitionVisibility(before, row.id, ENGINE_OWNED).state !== 'absent') return false
  return definitionVisibility(after, row.id, ENGINE_OWNED).state !== 'absent'
}
