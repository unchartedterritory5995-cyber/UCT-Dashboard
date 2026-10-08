// app/src/lib/workspaceConflict.js
//
// REVISION SAFETY — "a save was refused because the workspace changed elsewhere".
//
// `usePreferences` reports here when the server refuses a board write as stale (409
// `workspace_conflict`) or as coming from an out-of-date page (409 `workspace_revision_required`).
// The Charts workspace listens and tells the member. Its own module — not an export of
// `usePreferences` — so a component can listen without depending on that hook's mocks in tests.

const listeners = new Set()

/** Subscribe; returns an unsubscribe. The listener gets `{ key, code, message }`. */
export function onWorkspaceConflict(fn) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Tell every listener. A listener that throws never breaks the save path. */
export function emitWorkspaceConflict(event) {
  for (const fn of listeners) {
    try { fn(event) } catch { /* a listener never breaks a save */ }
  }
}
