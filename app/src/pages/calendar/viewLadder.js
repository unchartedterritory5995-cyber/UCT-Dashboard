// app/src/pages/calendar/viewLadder.js
//
// The calendar's view-preference ladder — which view a member lands on.
//
// ONE authority for it, pure, so it can be railed without a page (TD-37: the
// ladder shipped with no test at all). `Calendar.jsx` only feeds it inputs.
//
// ⭐ TERM-074 (FB-A5-04): the Wire (live earnings prints) shipped 2026-07-31,
// two weeks AFTER the view key moved to `calendar_view_v3` (2026-07-14). The
// ladder below it only ever answered table / board / month, so no stored
// preference and no default could land anyone on the Wire. The new rung pegs
// discovery to TODAY'S tape (Bloomberg FFM's shape) instead of adding a fifth
// affordance: a member with no explicit v3 choice lands on the Wire when it has
// prints on it, and on their old ladder answer when it does not.
//
// ⛔ READ-ONLY BY DESIGN. Nothing here (or at its call site) writes a
// preference: the legacy v2 values are COPIED into a decision, never
// destroyed, and re-running the ladder on the same inputs gives the same
// answer. A write here would also be the STATE-4 hazard — persisting a
// pre-hydration default — which is exactly what a migration must not do.
// `calendar_view_v3` stays the only key the view segment writes (MG-4: no key
// is renamed, so no read-fallback shim is needed).

/** The v2→v3 rung, verbatim from the 2026-07-14 migration: month stays month,
 *  feed+rows → table, everything else → board. */
export function legacyView(prefs) {
  const v2 = prefs?.calendar_view_v2
  if (v2 === 'month') return 'month'
  if (v2 === 'feed' && prefs?.calendar_density === 'rows') return 'table'
  return 'board'
}

/** Does the member have an explicit, post-v3 view choice? That choice always
 *  wins and makes the Wire rung irrelevant — so the caller need not probe. */
export function hasExplicitView(prefs) {
  return !!prefs?.calendar_view_v3
}

/** A wire payload has content when at least one print is on it. A missing,
 *  failed (`null`) or malformed payload is NOT content. */
export function wireHasContent(payload) {
  return Array.isArray(payload?.rows) && payload.rows.length > 0
}

/**
 * Resolve the view.
 *
 * @param {object} prefs            the merged preference map
 * @param {object} [opts]
 * @param {boolean} [opts.wireLanding]  true only when the Wire was probed for
 *        THIS landing and had content. The caller latches it once per mount so
 *        the view never moves under a member who is already reading.
 */
export function resolveCalendarView(prefs, { wireLanding = false } = {}) {
  if (hasExplicitView(prefs)) return prefs.calendar_view_v3
  if (wireLanding) return 'wire'
  return legacyView(prefs)
}
