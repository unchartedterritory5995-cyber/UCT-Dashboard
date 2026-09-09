// ⛔⛔ ONE VOCABULARY FOR A REVIEW OUTCOME (Wave O6 §7/§14).
//
// The four outcomes are the SERVER's vocabulary (`thesis_reviews.OUTCOMES`) and
// the member-facing wording for them has to be identical everywhere they are
// shown, because they are shown in places that are read together: the review
// panel where the member picks one, and — new in O6 — a search result that
// tells them what they decided. "Need more work" in the panel and "Deferred"
// in search would read as two different things having happened.
//
// This list lived inside `ThesisReviewSection.jsx` while it had exactly one
// consumer. It has two now, which is precisely the moment a private constant
// becomes a second authority over one value if it is copied rather than moved.
//
// ⛔ The order is the order the member is offered them in. Do not sort it by
// anything — least-to-most severe is a judgement about their thesis, and this
// product does not make that judgement (§4).

export const REVIEW_OUTCOMES = [
  { id: 'no_change', label: 'No change',
    hint: 'I reconsidered it and I still hold this view.' },
  { id: 'revised', label: 'Revised',
    hint: 'I changed the thesis itself — edit it above, then complete.' },
  { id: 'invalidated', label: 'Invalidated',
    hint: 'This thesis no longer holds.' },
  { id: 'deferred', label: 'Need more work',
    hint: "I couldn't settle it yet." },
]

/** The member-facing name for an outcome.
 *  ⛔ Falls back to the RAW id rather than to a blank or a guess: an outcome
 *  this build does not know about is a deploy skew, and showing the id makes
 *  that visible instead of silently rendering an empty pill. */
export function outcomeLabel(id) {
  return REVIEW_OUTCOMES.find((o) => o.id === id)?.label || id || ''
}
