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
