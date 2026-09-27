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

/** The owner's door for ONE note's link: GET status, POST mint (`{expiresInDays}`),
 *  DELETE revoke (api/routers/notebook_shares.py). */
export function noteShareEndpoint(noteId) {
  return `/api/j2/notes/${encodeURIComponent(String(noteId ?? ''))}/share`
}

/** The owner's list of their own share links (Settings → Sharing & publishing). */
export const SHARE_LINKS_ENDPOINT = '/api/j2/share/links'

/** The expiry a member may choose (ruling D-B2), in the order the select shows them.
 *  `null` = never. ⛔ The server holds the same list (note_shares.EXPIRY_CHOICES) and
 *  refuses anything else with a 422 sentence. */
export const SHARE_EXPIRY_CHOICES = Object.freeze([
  { days: null, label: 'Never' },
  { days: 7, label: 'After 7 days' },
  { days: 30, label: 'After 30 days' },
  { days: 90, label: 'After 90 days' },
])

/** In-app path for one shared note. */
export function sharedNotePath(token) {
  return `${SHARED_NOTE_PATH}/${encodeURIComponent(String(token ?? ''))}`
}

/** The absolute URL the owner copies and sends to somebody else. */
export function sharedNoteUrl(token) {
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : ''
  return `${origin}${sharedNotePath(token)}`
}
