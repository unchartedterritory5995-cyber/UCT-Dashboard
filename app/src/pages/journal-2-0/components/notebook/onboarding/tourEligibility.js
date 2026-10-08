// "Newly switched on, offer once" (wave 14, lane W14-C2; plan 4.3, defaults D3 and D4).
//
// PURE rules, no React, no I/O beyond the one session store below -- so the eager gate
// (TourOfferGate.jsx), Help's "What's new" (Support.jsx) and the rails all ask the SAME
// questions and cannot drift.
//
// ── What "eligible to be OFFERED" means ──────────────────────────────────────────────
// A registered tour is offered when ALL hold:
//   * it is not the base tour (the wave-8 first-run tour has its own auto-start);
//   * it is `replayable` (a passive explainer is not a stepper; nothing to offer);
//   * its OWN capability flag is exactly `true` for this member (`notebookFlag`);
//   * the member has NO row for it in `notebook_tours` -- not started, not done, not
//     dismissed. Any row means the member has met it, so it is never offered again.
//
// ── "Became available" -- and why there is no timestamp ──────────────────────────────
// Flags reach the client as BOOLEANS on the auth payload (`_access_payload`); the arming
// time lives only in docs/feature_flags.json, which the client never reads. So "this
// capability became available to you" is DEFINED as "its flag is on and you have never
// seen its tour". A member who had the flag on before this lane shipped and never took
// the tour is therefore offered it too -- deliberately: they have not seen it either.
//
// ── Queue, session, expiry (D3) ──────────────────────────────────────────────────────
// * ONE prompt at a time, in REGISTRY order. Registry order is the arming order we can
//   know: tours/index.js lists track files in the order capabilities are planned to arm,
//   and the client has no arming timestamp to sort by (above).
// * AT MOST ONE prompt per SESSION. A session is one browser TAB's `sessionStorage`
//   lifetime: it survives reloads in that tab and ends when the tab closes; a new tab is
//   a new session. If `sessionStorage` is unavailable or throws (private mode, blocked
//   storage), the session falls back to this module's memory -- one page load -- which
//   can only make the cap STRICTER per load, never let two prompts stack.
//   The record is `{id, answered}`: the tour offered this session, and whether the
//   member answered it. An UNANSWERED offer is shown again in the same session (it is
//   still the one offer -- e.g. after a reload, or after another first-run surface that
//   pushed it aside closes); once answered (Take the tour / Not now), nothing else is
//   offered until the next session.
// * An unseen prompt NEVER expires: nothing here has a time limit. A tour not yet
//   offered simply waits for a later session, in order.
//
// ── "Not now" ────────────────────────────────────────────────────────────────────────
// Writes the tour's row as `{state: 'dismissed', step: null}` -- dismissed for PROMPTING
// only. Help's Walkthroughs still lists it (replayableTours ignores seen state), and
// "What's new" still lists it: `step: null` with `dismissed` is the one row shape that
// means "declined before ever walking a step" (the engine always records the step it was
// on when a tour is closed from inside it).
import { BASE_TOUR_ID, tourLive } from './tourRegistry'
import { readToursPref } from './tourSeenState'

export const OFFER_SESSION_KEY = 'uct:notebook-tour-offer'

let memorySession = null

function sessionStore() {
  try {
    const s = window.sessionStorage
    // a store that throws on use is as good as none
    s.getItem(OFFER_SESSION_KEY)
    return s
  } catch {
    return null
  }
}

/** This session's offer record, `{id, answered}`, or null. */
export function readOfferSession() {
  const s = sessionStore()
  if (!s) return memorySession
  try {
    const v = JSON.parse(s.getItem(OFFER_SESSION_KEY) || 'null')
    return v && typeof v === 'object' && typeof v.id === 'string' ? { id: v.id, answered: v.answered === true } : null
  } catch {
    return null
  }
}

/** Record this session's offer. Writes memory too, so a store that fails mid-session
 *  still caps the rest of this page load. */
export function writeOfferSession(record) {
  memorySession = record ? { id: record.id, answered: record.answered === true } : null
  const s = sessionStore()
  if (!s) return
  try {
    if (record) s.setItem(OFFER_SESSION_KEY, JSON.stringify(memorySession))
    else s.removeItem(OFFER_SESSION_KEY)
  } catch {
    // memory already holds it
  }
}

/** Rails only. */
export function __resetOfferSession() {
  memorySession = null
  try { window.sessionStorage.removeItem(OFFER_SESSION_KEY) } catch { /* none */ }
}

function candidate(t, flagOn) {
  // tourLive: own flag, `requires`, and the wave-14 onboarding switch (the one shared rule)
  return t && t.id !== BASE_TOUR_ID && t.replayable === true && tourLive(t, flagOn)
}

/** Every tour eligible to be offered, in registry order (see the header). */
export function offerableTours({ tours = [], flagOn, toursPrefRaw }) {
  const rows = readToursPref(toursPrefRaw)
  return tours.filter((t) => candidate(t, flagOn) && !rows[t.id])
}

/** The ONE tour to offer now, or null: the session's unanswered offer if it is still
 *  eligible, nothing once this session's offer was answered (or was taken elsewhere),
 *  else the first eligible tour. */
export function pickOffer({ offerable = [], session = null }) {
  if (session) {
    if (session.answered) return null
    return offerable.find((t) => t.id === session.id) || null
  }
  return offerable[0] || null
}

/** Help > "What's new": tours whose capability is on for this member and that the
 *  member has not TAKEN -- no row, or declined from the prompt before walking a step.
 *  Registry order. Never touches the checklist (D4). */
export function whatsNewTours({ tours = [], flagOn, toursPrefRaw }) {
  const rows = readToursPref(toursPrefRaw)
  return tours.filter((t) => {
    if (!candidate(t, flagOn)) return false
    const row = rows[t.id]
    if (!row || typeof row !== 'object') return true
    return row.state === 'dismissed' && (row.step === null || row.step === undefined)
  })
}

/** Why an offer must WAIT right now (a reason string), or null when it may show.
 *  Waiting is never dismissing: the offer comes back when the reason goes. */
export function offerBlockedBy({
  prefsLoading, notesKnown, noteOpen, baseTourPending, checklistOpen, stageHeldByOthers, slot, slotBusy,
}) {
  if (prefsLoading) return 'preferences-loading'
  if (!notesKnown) return 'notes-unknown'
  if (noteOpen) return 'note-open'                  // R4: never while a member is editing
  if (baseTourPending) return 'base-tour'           // the first-run tour goes first
  if (checklistOpen) return 'checklist-open'        // the open checklist already lists every armed tour
  if (stageHeldByOthers) return 'stage-held'        // a tour, or the phone editor, holds the stage
  if (!slot) return 'no-slot'                       // no in-flow slot: never float
  if (slotBusy) return 'slot-busy'                  // the "Meet Compass" card is in the slot
  return null
}
