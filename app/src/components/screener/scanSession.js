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
 *  ⛔⛔ IT READS THE SERVER'S STAMP. IT DOES NOT RE-DECIDE. `GET
 *  /api/user-definitions` runs `scan_definition.assert_scannable` per row and
 *  ships `scannable` + `scan_refusal` (`routers/user_definitions.py::_stamped`).
 *  This asks that field and nothing else.
 *
 *  ⚰️ WHAT USED TO BE HERE, and what it cost. This function checked that
 *  `compute` was an object, `compute.ast` was present and `compute.fn` was a
 *  non-empty string — a SHAPE check under a SCANNABILITY name — so
 *  `ScreensManager` offered `Use as filter` on formulas the nightly sweep
 *  refuses. Walked in a browser (X88): `macd(close, 12, 26)` marked Scan saved
 *  with no warning, appeared under My Scans, applied as a filter, and its chip
 *  read `first sweep tonight` while the screen showed the UNFILTERED universe —
 *  forever, because `run_sweep` refused it nightly with `[gate:yields] this tree
 *  returns a number, not a 0/1 column` and a refused definition never earns the
 *  receipt that would change the chip.
 *
 *  ⭐ AND WHY NOT JUST A STRONGER PREDICATE HERE. `pine.js::treeYieldsBool` is
 *  exported and would have answered `yields` correctly — but the server gate is
 *  canonical + a `max_lookback` RESOLVE pass + `is_boolean_tree`, and the resolve
 *  pass has no client twin. A `resolve:domain` refusal produces the same forever
 *  chip by the same mechanism, so a JS `yields` check would have closed half the
 *  hole and left the half nobody had measured. One authority, stamped by the side
 *  that owns it, closes every gate — including gates added after today.
 *
 *  Exported so the mount test can assert the FILTER rather than infer it from
 *  what happened to render. */
export function scannableScreens(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row && row.scannable === true)
}
