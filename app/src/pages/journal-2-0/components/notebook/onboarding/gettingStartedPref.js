// The "get started" checklist's ONE preference key (wave 14, lane W14-D), in a module of
// its own because TWO files ask "is the list closed?":
//   * GettingStartedChecklist.jsx -- the small, EAGER gate Research Home imports
//     statically, which decides whether the list's chunk is fetched at all;
//   * GettingStartedList.jsx -- the lazy list itself.
// The gate must not import the list's rules (`gettingStarted.js` reaches the tour
// registry and the template blocks), or that code rejoins the Notebook's first-open
// bytes; a second copy of the rule inside the gate would drift from the list's. So the
// rule lives here, imported by both -- the same split tourPref.js makes for the tour.
//
// `notebook_getting_started` = {v:1, state, at}. Its row in `api/routers/auth.py`
// `_PREFERENCE_KEYS` is required (an unlisted key answers 400);
// `tests/test_preference_key_validation.py` re-derives the key from the list's
// `setPref(` call site.
import { parsePref } from '../../../../../hooks/usePreferences'

export const CHECKLIST_PREF = 'notebook_getting_started'
export const CHECKLIST_STATES = Object.freeze({ dismissed: 'dismissed', done: 'done' })

/** The recorded `{v, state, at}`, or null. Tolerates the server's TEXT or an object. */
export function readChecklistPref(raw) {
  const v = parsePref(raw, null)
  return v && typeof v === 'object' && typeof v.state === 'string' ? v : null
}

/** D4: dismissed OR done closes the list for good. */
export function checklistClosed(raw) {
  const s = readChecklistPref(raw)?.state
  return s === CHECKLIST_STATES.dismissed || s === CHECKLIST_STATES.done
}

/** The value the one key is written with. */
export function checklistRecord(state, now = new Date()) {
  return { v: 1, state, at: now.toISOString() }
}
