// app/src/components/screener/scanSession.js
//
// The session vocabulary a definition-scan surface needs, lifted out of
// `SavedScreensPanel.jsx` (its original owner — see that file's own header for
// the mount story) so `pages/screener/ScreensManager.jsx` can use it without
// importing the panel itself. The panel re-exports these four names verbatim
// so the scanmount rail's existing import source stays valid until the panel
// is deleted (Task 7 of docs/superpowers/plans/2026-08-22-screener-wave4-e4-unification.md).

/** The exchange's timezone. The session control is seeded from the market's
 *  calendar day, not the browser's — a member in London asking for "today"
 *  means today's US session. */
export const SESSION_TZ = 'America/New_York'

/** The bars-store timeframe CODE the nightly sweep runs on
 *  (`scan_evaluator.DEFAULT_TF`). Spelled once, here, and handed down. */
export const SCAN_TF = 'D'

/** `YYYY-MM-DD` for the market's current calendar day.
 *
 *  ⚠️ `en-CA` IS THE LOCALE THAT FORMATS ISO, and the explicit locale is the
 *  point: `toLocaleDateString()` with no argument answers `8/9/2026` for one
 *  member and `09/08/2026` for another, and the route parses neither.
 *  `_normalise_as_of` accepts the ISO spelling and collapses it to the same
 *  YYYYMMDD key `scan_store` files receipts under. */
export function defaultSession(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SESSION_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/** The saved definitions this surface can ask the scan route about.
 *
 *  Exported so the mount test can assert the FILTER rather than infer it from
 *  what happened to render. */
export function scannableScreens(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const compute = row && row.definition && row.definition.compute
    if (!compute || typeof compute !== 'object') return false
    if (compute.ast === undefined || compute.ast === null) return false
    return typeof compute.fn === 'string' && compute.fn.length > 0
  })
}
