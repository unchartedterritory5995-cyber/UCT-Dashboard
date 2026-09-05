// app/src/components/provenance/presentationFormat.js
//
// ⚠️ NOT S10. S10 (Presentation Primitives — product-architecture.md's own
// system block) is the program's eventual "one number/percent/date/time
// formatter... 118 files define their own today" (TD-08); it has no PRD/
// spec of its own and is not built (confirmed by direct search, S8 Step 2's
// S10 dependency check, 2026-09-02). SPEC-S8 §19 Step 1 already sanctions
// exactly this interim: "it may format via the existing narrow helpers
// already in use at a call site rather than inventing a third formatter
// inside S8." This file IS that narrow, local, non-exported-as-a-platform
// helper — used only by this component family, establishing no new
// cross-system contract. When S10 ships, `<Provenance>`/`<FreshnessBadge>`
// swap onto it (SPEC-S8 §19 Step 2's own stated migration) and this file
// is deleted, not generalized.

/** Same explicit-locale discipline as `CoverageLine.jsx`'s own `n()` helper
 *  (this file's sibling in `components/provenance/`) — `toLocaleString()`
 *  with no argument formats to whatever the browser is set to. */
export function formatPrice(value) {
  return Number.isFinite(value) ? `$${Number(value).toFixed(2)}` : '—'
}

export function formatEtTime(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  })
}

/** Epoch seconds (D1's `ProvenanceRecord.source_observed_at`/`fetched_at`
 *  are both epoch seconds, per `provider_errors.py`) -> an ISO string, for
 *  the two formatters above. */
export function epochSecondsToIso(epochSeconds) {
  return Number.isFinite(epochSeconds) ? new Date(epochSeconds * 1000).toISOString() : null
}
