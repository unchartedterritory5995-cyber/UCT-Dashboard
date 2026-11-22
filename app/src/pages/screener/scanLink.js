// app/src/pages/screener/scanLink.js
//
// RUN AN INDICATOR OVER A LIST, FROM WHERE THE INDICATOR IS (Studio plan lane R1; Screener request R13).
//
// A chart can hand the Screener one of the member's own indicators: `/screener?scan=<def_id>` opens the
// Screener's EXISTING "My scans" detail for that indicator. It is a link and a one-time reader, nothing
// more: no second run door, no new endpoint. The run itself is the Screener's.
//
// ⛔ THE ID IS ONLY EVER A HINT. The reader opens a row the member's own list already holds; an id that
// is malformed, unknown or someone else's opens nothing and says nothing (the page is simply the page).
//
// No imports: both the chart and the Screener read this.

export const SCAN_PARAM = 'scan'

/** The store's own id shape (`user_definitions.DEF_ID_RE`). */
const DEF_ID = /^u_[0-9a-f]{12}$/

/** The address that opens the Screener on one of the member's indicators; `null` for anything that is not an id. */
export function scanLink(defId) {
  return typeof defId === 'string' && DEF_ID.test(defId) ? `/screener?${SCAN_PARAM}=${defId}` : null
}

/** The indicator id a Screener address asks for, or `null`. Never throws. */
export function scanIdFromSearch(search) {
  try {
    const id = new URLSearchParams(typeof search === 'string' ? search : '').get(SCAN_PARAM)
    return typeof id === 'string' && DEF_ID.test(id) ? id : null
  } catch { return null }
}

/** The same address with the hint removed (the reader reads it once). */
export function withoutScanParam(search) {
  try {
    const p = new URLSearchParams(typeof search === 'string' ? search : '')
    p.delete(SCAN_PARAM)
    const s = p.toString()
    return s ? `?${s}` : ''
  } catch { return '' }
}

/**
 * What the Screener does with the hint: `{ open: true, detailId }` for one of the member's OWN scannable
 * indicators, `{ open: true, detailId: null }` for their own indicator that cannot scan (the menu opens on
 * the list that says why), and `{ open: false }` for anything else.
 */
export function resolveScanHint(id, scans, unscannable) {
  if (!id) return { open: false, detailId: null }
  if ((Array.isArray(scans) ? scans : []).some((r) => r && r.def_id === id)) return { open: true, detailId: id }
  if ((Array.isArray(unscannable) ? unscannable : []).some((r) => r && r.def_id === id)) return { open: true, detailId: null }
  return { open: false, detailId: null }
}
