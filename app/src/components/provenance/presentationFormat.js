// app/src/components/provenance/presentationFormat.js
//
// ⚰️ THIS FILE'S HEADER SAID S10 DID NOT EXIST. IT DOES NOW — 2026-09-12 — AND
// THE MIGRATION THIS FILE PREDICTED IS THE COMMIT YOU ARE READING.
//
// The retired header, kept verbatim because it is the record of the decision:
//
//     ⚠️ NOT S10. S10 (Presentation Primitives — product-architecture.md's own
//     system block) is the program's eventual "one number/percent/date/time
//     formatter... 118 files define their own today" (TD-08); it has no PRD/
//     spec of its own and is not built (confirmed by direct search, S8 Step 2's
//     S10 dependency check, 2026-09-02). SPEC-S8 §19 Step 1 already sanctions
//     exactly this interim: "it may format via the existing narrow helpers
//     already in use at a call site rather than inventing a third formatter
//     inside S8." This file IS that narrow, local, non-exported-as-a-platform
//     helper — used only by this component family, establishing no new
//     cross-system contract. When S10 ships, `<Provenance>`/`<FreshnessBadge>`
//     swap onto it (SPEC-S8 §19 Step 2's own stated migration) and this file
//     is deleted, not generalized.
//
// ⛔ AND IT IS **NOT DELETED**, WHICH IS A CORRECTION TO THAT PLAN, NOT A
// SHORTCUT PAST IT. The plan said "used only by this component family". It is
// not, and has not been for some time — measured 2026-09-12, `epochSecondsToIso`
// has FOUR importers outside S8's four components:
//
//     pages/ProvenanceDemo.jsx
//     pages/research/tabs/AnalystRatingsTab.jsx
//     pages/research/tabs/NewsTab.jsx
//     pages/research/tabs/OwnershipTab.jsx
//
// S10's approval line is explicit — "adopted by S8's existing components
// (Provenance, FreshnessBadge, Cited, CoverageLine) and nothing else; no other
// consumer migrated". Deleting this file would have migrated four consumers
// under cover of a refactor. So it survives, narrowed, and the four keep their
// import path unchanged.
//
// WHAT CHANGED HERE, EXACTLY:
//   - `formatEtTime` is GONE. Its only caller was `<Provenance>`, which now
//     calls S10's `formatTimeEt(v, {seconds: true})` — the same function, and
//     `presentationPrimitives.test.js` holds a frozen copy of the deleted body
//     as the oracle that proves it.
//     ⚠️ One comment elsewhere still names it by its old name
//     (`pages/research/tabs/AskAiTab.jsx:48`, explaining why that tab passes a
//     date-only string somewhere else). Out of this approval's scope to edit;
//     recorded so the next reader knows the function moved rather than died.
//   - `formatPrice` now DELEGATES to S10's `formatCurrency` instead of holding
//     a second copy of the same three lines. No importer changed, no signature
//     changed, and no rendered character changed (proved input-by-input in
//     `presentationPrimitives.test.js`).
//   - `epochSecondsToIso` is untouched. It is a type conversion, not a
//     presentation decision, so it is not S10's to own.

import { formatPriceDisclosure, formatCurrency } from '../../lib/presentation/presentationPrimitives'

/**
 * ⚰️ This was the implementation:
 *
 *     export function formatPrice(value) {
 *       return Number.isFinite(value) ? `$${Number(value).toFixed(2)}` : '—'
 *     }
 *
 * It is now one line over S10, kept at this name and path so its importers do
 * not move. `formatCurrency`'s defaults ARE these defaults — two decimals, a
 * leading `$`, the em dash when there is no number — which is why this is a
 * bare forward and not an adapter.
 *
 * ⛔⛔ AND THERE IS A SECOND, UNRELATED `formatPrice` IN THIS APP, WITH A
 * DIFFERENT CONTRACT. `components/chart/drawingLabels.js::formatPrice(value,
 * {tick})` renders `"123.46"` — no currency symbol, tick-aware decimals, and
 * the EMPTY STRING rather than an em dash when it has nothing. Six files
 * import that one. Its own comment calls it "the one place in the app that
 * knows how a price is rendered", and that sentence has been false for as long
 * as this file has existed.
 *
 * ⚰️ S10 CP2 SETTLED IT, AND NOT BY RECONCILING THEM. The retired sentence,
 * kept verbatim because its reasoning is why the answer is what it is:
 *
 *     ⛔ Reconciling them is NOT in S10's approved scope and must not be
 *     smuggled in here: they disagree on the currency symbol, on the decimal
 *     rule and on the absent sentinel, so every one of those six call sites
 *     would move visibly.
 *
 * ⭐ All three disagreements are REAL and both rules are RIGHT — for different
 * surfaces. S10 now owns both, named: `formatPriceDisclosure` (this one) and
 * `formatPriceTick` (the chart one). Nothing collapsed, nothing moved.
 * ⛔ That "next line" is this one. GATE-S10 line 2 (CP2).
 */
export function formatPrice(value) {
  return formatPriceDisclosure(value)
}

/** Epoch seconds (D1's `ProvenanceRecord.source_observed_at`/`fetched_at`
 *  are both epoch seconds, per `provider_errors.py`) -> an ISO string.
 *
 *  ⛔ NOT AN S10 PRIMITIVE, ON PURPOSE. This converts a type; it decides
 *  nothing about how a human reads the result. S10's boundary is "renders a
 *  value for a person to read", and widening it to every date coercion in the
 *  app is how a presentation layer turns into a utility drawer. */
export function epochSecondsToIso(epochSeconds) {
  return Number.isFinite(epochSeconds) ? new Date(epochSeconds * 1000).toISOString() : null
}
