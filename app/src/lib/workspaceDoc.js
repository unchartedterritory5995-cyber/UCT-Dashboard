// app/src/lib/workspaceDoc.js
//
// TERM-021 read-new — does the server say the versioned workspace document is ARMED?
//
// The answer rides the preferences read itself: while `WORKSPACE_DOC_STORE_ENABLED` is
// armed, every `GET /api/auth/preferences` carries an `X-Workspace-Doc` header naming the
// store that answered (`document; v=12`, `fallback; reason=absent`, …). While it is dark the
// response is byte-for-byte what it always was and carries NO such header — so a client
// that learns "armed" this way costs a dark deployment nothing: no probe request, no 404.
//
// `usePreferences` records the header from every preferences response it reads (its SWR
// fetcher and `refreshPreferences`). The Charts board asks `isWorkspaceDocArmed()` before a
// board change: armed, the change is ONE document write; dark, it is the same per-key
// preference writes it always was. A response that failed or lacked the header reads as
// dark, which is the safe direction — the legacy path is correct in both states.
//
// Module state, deliberately: it is a fact about the SERVER, shared by every consumer, and
// it changes only when a preferences response says so.

export const WORKSPACE_DOC_HEADER = 'X-Workspace-Doc'

let stamp = null

/** Record what a preferences response said. Never throws: a response without headers (a
 *  test double, a network error) reads as dark. */
export function noteWorkspaceDocResponse(res) {
  try {
    const v = res && res.headers && typeof res.headers.get === 'function'
      ? res.headers.get(WORKSPACE_DOC_HEADER)
      : null
    stamp = v == null || v === '' ? null : String(v)
  } catch {
    stamp = null
  }
}

/** True only when the last preferences read came from an armed server. */
export function isWorkspaceDocArmed() {
  return stamp != null
}

/** What the last armed read said (`document; v=…` / `fallback; reason=…`), or null. */
export function workspaceDocStamp() {
  return stamp
}

/** Tests only: set the state a preferences response would have left. */
export function __setWorkspaceDocStampForTests(value) {
  stamp = value == null ? null : String(value)
}
