// app/src/pages/screener/sharedScreen.js
//
// ─── ONE PLACE THAT KNOWS WHERE A SHARED SCREEN LIVES ───────────────────────
//
// The link a member copies and the route that renders it are the SAME fact. A
// SECOND AUTHORITY OVER ONE VALUE is this repo's most repeated defect — a
// hand-typed `/screener/shared/${token}` in the copy button and a hand-typed
// `<Route path="/screener/shared/:token">` in `App.jsx` agree on the day they
// are written and silently stop agreeing on the day one of them is renamed, at
// which point every link already sent out 404s and nothing goes red.
//
// So the prefix is spelled ONCE, here, and both sides derive from it:
//   * `App.jsx` routes on `SHARED_SCREEN_ROUTE`
//   * `SaveScreenBar` builds its copyable URL with `sharedScreenUrl`
//   * `SharedScreen` reads `SHARED_SCREEN_ENDPOINT` for the server read
//
// ⛔ The API path is spelled once too. `api/routers/screener.py` serves
// `GET /api/screener/shared/{share_token}` and its module docstring calls it
// "the ONE route that stays open" — token-authenticated public sharing, by
// design. It answers a saved FILTER SPEC, never scan output.

/** Where a shared screen lives in the app, without the token. */
export const SHARED_SCREEN_PATH = '/screener/shared'

/** The route pattern `App.jsx` registers. Derived — never retyped there. */
export const SHARED_SCREEN_ROUTE = `${SHARED_SCREEN_PATH}/:token`

/** The public read on the server. No auth: the token IS the credential. */
export const SHARED_SCREEN_ENDPOINT = '/api/screener/shared'

/** The query parameter that carries a share token INTO the scanner, so a
 *  recipient can run the screen rather than only look at it. */
export const SHARED_SCREEN_PARAM = 'screen'

/** In-app path for one shared screen. */
export function sharedScreenPath(token) {
  return `${SHARED_SCREEN_PATH}/${encodeURIComponent(String(token ?? ''))}`
}

/** The absolute URL a member copies and sends to somebody else.
 *
 *  `origin` is a parameter so a test can state the origin it is asserting
 *  about instead of asserting against `window.location`, which jsdom and the
 *  browser disagree on. */
export function sharedScreenUrl(token, origin) {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '')
  return `${base}${sharedScreenPath(token)}`
}

/** Where the scanner should be opened to RUN a shared screen. */
export function scannerPathForSharedScreen(token) {
  return `/screener?${SHARED_SCREEN_PARAM}=${encodeURIComponent(String(token ?? ''))}`
}

/** The server read for one shared screen. */
export function sharedScreenReadUrl(token) {
  return `${SHARED_SCREEN_ENDPOINT}/${encodeURIComponent(String(token ?? ''))}`
}
