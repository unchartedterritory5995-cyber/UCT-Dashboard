// Joystick hub — "is the hub hidden for THIS SESSION only?", as one tiny external store.
//
// ⛔ WHY A MODULE-LEVEL STORE AND NOT CONTEXT OR COMPONENT STATE.
//
// Three places need this answer and two of them are outside `<HubProvider>`:
//   HubRoot.jsx  — whether to render the hub or the restore tab
//   Layout.jsx   — whether to keep mounting <FeedbackWidget/>
//   App.jsx:207  — whether to keep mounting <GlobalVoiceGate/> (the voice orb)
//
// `App.jsx` calls `useHubActive()` as a SIBLING of the routed Layout tree, so a context
// provider mounted inside Layout cannot reach it. Component state in HubRoot cannot either.
//
// ⭐ AND GETTING THIS WRONG PUTS TWO CONTROLS IN ONE CORNER. If a session hide were invisible
// to `useHubActive`, the orb and the feedback FAB would come back while the hub's restore tab
// was still on screen — the exact 36-42px overlap Wave 0 measured and the whole reason the hub
// gates them at all.
//
// `useSyncExternalStore` rather than state + effect, for the same reason `hubViewport.js` uses
// it: subscribe and read in one atomic step, with no window between the initial read and the
// subscription in which the value can change.

import { useSyncExternalStore } from 'react'

/**
 * `null`   — no session override; the stored preference decides.
 * `'hidden'` — hidden for this session only (Actions sheet → Hide joystick).
 * `'shown'`  — shown for this session only (restore tab tapped while the preference is off).
 *
 * ⛔ DELIBERATELY NOT PERSISTED. That is the entire point of the fix: hiding must not be a
 * one-way door. A reload clears this, which is what "Hidden for now. Reload to bring it back."
 * promises — and the promise is only true because nothing here writes to storage.
 */
let override = null

const listeners = new Set()

function emit() {
  for (const l of listeners) l()
}

function subscribe(onChange) {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

const getSnapshot = () => override

/** Hide for this session only. Does NOT touch the stored preference. */
export function hideForSession() {
  override = 'hidden'
  emit()
}

/** Show for this session only, even if the stored preference says off. */
export function showForSession() {
  override = 'shown'
  emit()
}

/** Drop the override so the stored preference decides again (used by tests and by Settings). */
export function clearSessionOverride() {
  override = null
  emit()
}

/** @returns {null|'hidden'|'shown'} */
export default function useHubSessionOverride() {
  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}

/**
 * Resolve the stored preference against any session override.
 * @param {boolean} storedEnabled
 * @param {null|'hidden'|'shown'} sessionOverride
 */
export function resolveVisible(storedEnabled, sessionOverride) {
  if (sessionOverride === 'hidden') return false
  if (sessionOverride === 'shown') return true
  return !!storedEnabled
}
