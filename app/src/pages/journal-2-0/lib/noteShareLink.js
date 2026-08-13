// ─── ONE PLACE THAT KNOWS WHERE A SHARED NOTE LIVES ─────────────────────────
//
// The screener-share idiom (screenShareLink.js), applied to notebook notes:
// the link the owner copies and the route that renders it are the SAME fact,
// spelled once here — a second authority over one value is this repo's most
// repeated defect. `App.jsx` routes on SHARED_NOTE_ROUTE; the editor's Share
// button builds its copyable URL with sharedNoteUrl; SharedNotePage reads
// SHARED_NOTE_ENDPOINT.
//
// ⛔ The server pair (`GET /api/j2/shared/{token}` + `/att/...`) is PUBLIC by
// design — the token is the credential — and flag-gated server-side
// (J2_SHARE_LINKS_ENABLED). The payload is a sanitized read-only document.

/** Where a shared note lives in the app, without the token. */
export const SHARED_NOTE_PATH = '/share/n'

/** The route pattern App.jsx registers. Derived — never retyped there. */
export const SHARED_NOTE_ROUTE = `${SHARED_NOTE_PATH}/:token`

/** The public read on the server. No auth: the token IS the credential. */
export const SHARED_NOTE_ENDPOINT = '/api/j2/shared'

/** In-app path for one shared note. */
export function sharedNotePath(token) {
  return `${SHARED_NOTE_PATH}/${encodeURIComponent(String(token ?? ''))}`
}

/** The absolute URL the owner copies and sends to somebody else. */
export function sharedNoteUrl(token) {
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : ''
  return `${origin}${sharedNotePath(token)}`
}
