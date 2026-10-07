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
// `notebook_getting_started` = {v:1, state?, at?, done?}:
//   * `done` -- the ids of every step the member has ticked, recorded the first time each
//     ticks, so a step NEVER unticks (a later read that no longer shows the evidence --
//     Research Home's home read is capped per section -- cannot take it back);
//   * `state` -- 'dismissed' (Hide) or 'done' (every step ticked): either closes the list
//     for good (D4). Absent while the list is open.
// Every write goes through `setPrefMerged`, so the three writers (a tick, Hide, finish)
// merge rather than overwrite one another. Its row in `api/routers/auth.py`
// `_PREFERENCE_KEYS` is required (an unlisted key answers 400);
// `tests/test_preference_key_validation.py` re-derives the key from the list's call site.
//
// The list shows only while BOTH `notebook_onboarding_enabled` and its own dark gate
// `notebook_getting_started_enabled` (NOTEBOOK_GETTING_STARTED_ENABLED) are on.
import { parsePref } from '../../../../../hooks/usePreferences'

export const CHECKLIST_PREF = 'notebook_getting_started'
export const CHECKLIST_STATES = Object.freeze({ dismissed: 'dismissed', done: 'done' })

/** The recorded value, or null. Tolerates the server's TEXT or an object. */
export function readChecklistPref(raw) {
  const v = parsePref(raw, null)
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null
}

/** Both gates: the onboarding flag AND the checklist's own. `flag` is notebookFlag. */
export function checklistEnabled(flag) {
  return flag('notebook_onboarding_enabled') === true && flag('notebook_getting_started_enabled') === true
}

/** The step ids recorded as ticked, as a Set. */
export function recordedDone(raw) {
  const done = readChecklistPref(raw)?.done
  return new Set(Array.isArray(done) ? done.filter((d) => typeof d === 'string' && d) : [])
}

/** `current` with `ids` added to its done-set, or undefined when nothing is new (an
 *  undefined from a setPrefMerged updater abandons the write). */
export function withDone(current, ids) {
  const have = recordedDone(current)
  const add = ids.filter((id) => !have.has(id))
  if (!add.length) return undefined
  const base = readChecklistPref(current) || {}
  return { ...base, v: 1, done: [...have, ...add] }
}

/** `current` closed as `state`, keeping its done-set. */
export function closedAs(current, state, now = new Date()) {
  const base = readChecklistPref(current) || {}
  return { ...base, v: 1, state, at: now.toISOString() }
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
