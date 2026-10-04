// Per-tour seen/dismissed/in-progress state for every REGISTERED tour except the
// wave-8 base tour (wave 14, lane W14-0). The base tour keeps its own dedicated
// preference key (`notebook_tour`, tourPref.js) completely UNCHANGED -- moving an
// already-armed capability's stored state would be a live behaviour change for a
// member mid-tour today, which the lane charter forbids. Every tour the registry
// adds from here on shares ONE preference key, `notebook_tours`, a map keyed by
// tour id -- a 2nd, 3rd, ... 20th tour costs no new preference key.
//
// ⛔⛔ RISK R8. A blind `setPref('notebook_tours', value)` would overwrite every
// OTHER tour's row the instant two tours' state change in overlapping requests (two
// tabs; or, once W14-C's trigger exists, two tours whose flags armed in the same
// session). `recordTourState` never calls `setPref` -- it is handed the caller's
// `setPrefMerged` (usePreferences.js), which re-reads the FRESHEST SWR cache value
// inside the same synchronous mutate the merge computes from, so this can never be
// a blind POST. `tourSeenState.test.js` mutation-proves it: reverting the merge to
// a blind overwrite loses a sibling tour's row, and the rail catches it.
import { parsePref } from '../../../../../hooks/usePreferences'

export const TOURS_PREF = 'notebook_tours'
export const TOUR_STATES = Object.freeze({ started: 'started', done: 'done', dismissed: 'dismissed' })

/** The whole `notebook_tours` map, parsed defensively -- never an array, never a
 *  non-object, so a caller can always spread it. */
export function readToursPref(raw) {
  const v = parsePref(raw, null)
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

/** One tour's recorded `{v, state, step}`, or null -- the same shape tourPref.js's
 *  `readTourPref` returns for the base tour, so a future consumer can treat every
 *  tour's state identically regardless of which key it lives on. */
export function readTourState(toursPrefRaw, tourId) {
  const row = readToursPref(toursPrefRaw)[tourId]
  return row && typeof row === 'object' && typeof row.state === 'string' ? row : null
}

/** A tour the member finished or dismissed never starts on its own again --
 *  identical predicate to tourPref.js's `tourFinished`, duplicated rather than
 *  imported because the two keys' shapes are independent data, not the same value
 *  (lesson: a second authority over one value is the defect; this is two values
 *  that happen to share a shape). */
export function tourFinished(savedState) {
  return savedState === TOUR_STATES.done || savedState === TOUR_STATES.dismissed
}

/** Record one tour's `{state, step}`, merging into whatever the OTHER tours'
 *  rows currently hold. `setPrefMerged` is `usePreferences()`'s own read-modify-
 *  write hook (already built for exactly this shape of risk -- `chart_settings`'s
 *  per-instance union); this function supplies only the per-tour merge rule. */
export function recordTourState(setPrefMerged, tourId, state, stepId) {
  return setPrefMerged(TOURS_PREF, (current) => {
    const base = readToursPref(current)
    return { ...base, [tourId]: { v: 1, state, step: stepId ?? null } }
  })
}
