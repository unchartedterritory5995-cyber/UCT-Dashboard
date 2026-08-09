// app/src/constants/expectedMoveOutcome.js
//
// ONE phrasing and ONE decision for "there is no expected move, and here is
// why", for every surface in the app.
//
// It lives here — beside `disclaimer.js`, not inside `pages/calendar` — because
// the calendar is no longer the only consumer: the earnings research modal's
// Setup canvas reads the same `{kind, reason}` off `/api/research/expected-move`,
// and a research component reaching into a page module to borrow a sentence is
// how a second copy of that sentence eventually gets written instead.
// `pages/calendar/cardBits.jsx` re-exports these three so every existing import
// keeps resolving; there is still exactly one definition.
//
// THE FRONTEND OWNS NO COPY OF THE BACKEND'S REASON VOCABULARY.
// `api/services/implied_move.py::outcome_kind` is the only authority on what a
// reason MEANS, and the wire carries its verdict as `{kind, reason}`. Anything
// that is not an explicit `ok` means "we have no number", so a reason invented
// on the server tomorrow renders correctly here on day one and can never come
// out blank. The specific cause reaches support through a PURE TRANSFORM of the
// token — never a lookup table, because a lookup table would BE the copy of the
// list this must not own.
//
// ⛔ A MISSING outcome is NOT a refusal. It means either the read was never
// attempted (a past report — there is no forward straddle to price) or the
// payload has not landed yet. Both keep the surface's existing treatment, which
// is what stops a still-loading row from being labelled. An earlier guard that
// treated a bare null as "arrived and empty" froze calendar rows permanently.
export const MOVE_UNAVAILABLE = 'Expected move unavailable'

export function moveIsUnavailable(outcome) {
  return !!outcome && outcome.kind !== 'ok'
}

export function moveUnavailableTitle(outcome) {
  const cause = String(outcome?.reason ?? '').replace(/_/g, ' ').trim()
  return cause ? `${MOVE_UNAVAILABLE} — ${cause}` : MOVE_UNAVAILABLE
}
