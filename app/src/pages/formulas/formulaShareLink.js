// app/src/pages/formulas/formulaShareLink.js
//
// ─── ONE PLACE THAT KNOWS WHERE A SHARED FORMULA LIVES ──────────────────────
//
// ⚰️⚰️ THIS MODULE EXISTS BECAUSE THE WARNING NEXT DOOR WAS WRITTEN AND THEN
// NOT HEEDED. `app/src/pages/screener/screenShareLink.js` opens with exactly
// this paragraph — "a hand-typed `/screener/shared/${token}` in the copy button
// and a hand-typed `<Route>` in `App.jsx` agree on the day they are written and
// silently stop agreeing" — and while the SCREENER share was built that way,
// the FORMULA share was not. `SharePanel.jsx` hand-typed
// `${origin}/formulas/shared/${token}` at line 31 and no `<Route>` was ever
// registered for `/formulas` at all, so every share link a member has ever
// copied out of the builder resolved to `App.jsx`'s catch-all 404.
//
// ⛔ IT WAS NOT A DRIFT. The two sides never agreed for one day — there was no
// second side. That is worse than the failure the neighbouring header predicts,
// and it went unnoticed because the backend is complete (six routes, an
// append-only `definition_shares` table, a grammar-version check on every read)
// and because the ONE path a test exercised was the paste box, which takes the
// token out of the URL rather than routing to it. `SharePanel.test.jsx` pastes
// the URL into an input and passes; it can never notice that the URL is dead.
//
// ⭐ SO THE PREFIX IS SPELLED ONCE, HERE, and every side derives from it:
//   * `App.jsx` routes on `SHARED_FORMULA_ROUTE`
//   * `SharePanel`'s copy button builds its URL with `sharedFormulaUrl`
//   * `SharedFormula` reads the token out of the route and calls the shipped
//     `previewSharedDefinition` / `installSharedDefinition` helpers
//
// ⛔ THE SERVER PAIR IS NOT SPELLED HERE, deliberately, because it already has
// exactly one authority: `USER_DEFINITIONS_KEY` in `hooks/useUserDefinitions.js`,
// which `previewSharedDefinition` (:351) and `installSharedDefinition` (:377)
// both build from. Re-declaring the API path in this module would create the
// second authority this file exists to prevent.

/** Where a shared formula lives in the app, without the token. */
export const SHARED_FORMULA_PATH = '/formulas/shared'

/** The route pattern `App.jsx` registers. Derived — never retyped there. */
export const SHARED_FORMULA_ROUTE = `${SHARED_FORMULA_PATH}/:token`

/** ⭐ THE SHAPE OF A MINTED TOKEN, spelled once.
 *
 *  `user_definitions.resolve_share` refuses anything not starting `sh_` before
 *  it touches the database ("that is not a share link this engine minted"), and
 *  `SharePanel`'s paste box independently carries `sh_[0-9a-f]{32}` to pull a
 *  token out of a pasted URL. Both are reading the same fact about the mint, so
 *  it is declared here and the paste box derives from it rather than holding a
 *  third copy.
 *
 *  ⚠️ IT HELD A THIRD AND A FOURTH: `SharePanel.jsx` carried `/sh_[0-9a-f]{32}/i`
 *  inline TWICE, once in `lookUp` and once in `install`, so a member could look a
 *  link up under one spelling and install under another. Case-insensitivity is
 *  KEPT rather than tidied away — it is the shipped behaviour a pasted link
 *  already relies on, and narrowing it here would break links in the wild to make
 *  this file prettier.
 *  ⛔ NO `/g` FLAG, deliberately: a module-level regex with `/g` carries
 *  `lastIndex` between calls, so the second lookup of the same token would miss. */
export const SHARE_TOKEN_RE = /sh_[0-9a-f]{32}/i

/** In-app path for one shared formula. */
export function sharedFormulaPath(token) {
  return `${SHARED_FORMULA_PATH}/${encodeURIComponent(String(token ?? ''))}`
}

/** The absolute URL a member copies and sends to somebody else.
 *
 *  `origin` is a parameter so a test can state the origin it is asserting about
 *  instead of asserting against `window.location`, which jsdom and the browser
 *  disagree on — the same reason `sharedScreenUrl` takes one. */
export function sharedFormulaUrl(token, origin) {
  if (!token) return ''
  const base = origin ?? (typeof window !== 'undefined' && window.location
    ? window.location.origin
    : '')
  return `${base}${sharedFormulaPath(token)}`
}

/** The token inside a pasted share link, or the input itself if it is already
 *  a bare token. Returns `''` when there is no token-shaped substring — so a
 *  caller can tell "nothing to look up" from "look this up". */
export function tokenFromShareInput(text) {
  const m = SHARE_TOKEN_RE.exec(String(text ?? ''))
  return m ? m[0] : ''
}
