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
import { mergeIntoPreferenceCache, parsePref } from '../../../../../hooks/usePreferences'

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

/** The server's per-row merge door (wave 14, lane W14-C2; api/routers/notebook_onboarding.py). */
export const TOUR_ROW_URL = (tourId) => `/api/j2/onboarding/tours/${encodeURIComponent(tourId)}`

/** One write at a time, in call order (module scope, like usePreferences' own
 *  `queueWrite`): two PUTs for one tour in flight at once could land in either
 *  order and leave an earlier step on top. */
let rowChain = Promise.resolve()
function queueRow(task) {
  const next = rowChain.then(task)
  rowChain = next.then(() => {}, () => {})
  return next
}

/** Record one tour's `{state, step}`.
 *
 *  ⛔⛔ CROSS-TAB (W14-C2). `setPrefMerged` merges against THIS TAB's cache and then
 *  posts the WHOLE map to `POST /api/auth/preferences`, which replaces the stored
 *  value -- so two tabs recording different tours in the same moment each post a
 *  map missing the other's row, and the later arrival erases the earlier one. The
 *  write therefore goes to the server's per-row door, which merges ONE row inside
 *  one SQL statement, and the merged map it answers (other tabs' rows included)
 *  goes into this tab's cache. This tab's cache is updated optimistically first.
 *
 *  Fallback: a 404/405 (the onboarding gate dark, or a server that predates the
 *  door) or a network failure takes the old path, `setPrefMerged`, unchanged --
 *  read-modify-write over the freshest cache (R8 within one tab). Any other refusal
 *  (400, 413) writes nothing more: re-posting the whole map would step around the
 *  server's own validation and cap.
 *
 *  Signature unchanged, so GenericTourEngine.jsx (not this lane's file) is untouched. */
export function recordTourState(setPrefMerged, tourId, state, stepId) {
  const row = { v: 1, state, step: stepId ?? null }
  const merge = (current) => ({ ...readToursPref(current), [tourId]: row })
  mergeIntoPreferenceCache(TOURS_PREF, merge).catch(() => {})
  return queueRow(async () => {
    let res = null
    try {
      res = await fetch(TOUR_ROW_URL(tourId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: row.state, step: row.step }),
      })
    } catch {
      res = null
    }
    if (res && res.ok) {
      let body = null
      try { body = await res.json() } catch { body = null }
      if (body && typeof body.value === 'string') await mergeIntoPreferenceCache(TOURS_PREF, body.value)
      return true
    }
    if (!res || res.status === 404 || res.status === 405) {
      await setPrefMerged(TOURS_PREF, merge)
      return true
    }
    return false
  })
}
