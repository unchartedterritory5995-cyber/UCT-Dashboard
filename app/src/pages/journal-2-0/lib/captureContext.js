// ⛔⛔ THE DEFECT THIS FIXES, found by the Slice 5 integrated E2E (2026-09-08).
//
// Slice 2's ruling is "context changes DEFAULTS, never semantics", and every
// piece of that was built: `captureDestination({noteId, ticker})` computes the
// label, `CaptureDialog` renders it, `CaptureHost` accepts `detail.destination`,
// and `captureConvergence.test.js` asserts the labels are right.
//
// ⚰️ AND NO DOOR EVER PASSED ONE. The two live doors — the command palette and
// the global hotkey — both opened with an empty detail, so a member standing
// INSIDE a note, or on NVDA's research page, was asked "Choose a note…" about
// the note they were reading. The capability was unit-tested and unreachable:
// the tests exercised the FUNCTION, never a door calling it. That is this
// repo's signature defect class, and it survived a whole slice's certification
// because every door test opened capture with context supplied by the test.
//
// ⭐ SO CONTEXT IS DERIVED IN ONE PLACE. Both doors call this; neither decides
// anything itself. A third door gets the same defaults for free, and cannot
// invent its own reading of "where am I".

import { captureDestination } from './capture'

/** `/journal/notebook?note=<id>` — the member is reading one specific note. */
export function noteIdFromLocation({ pathname = '', search = '' } = {}) {
  if (!pathname.startsWith('/journal')) return null
  try {
    return new URLSearchParams(search).get('note') || null
  } catch {
    return null
  }
}

/** `/research/<SYM>` (and its compare sub-route) — the member is researching
 *  one security. Deliberately NOT a general "is there a ticker anywhere"
 *  sniff: a ticker in a query string somewhere else is not a destination. */
export function tickerFromLocation({ pathname = '' } = {}) {
  const m = /^\/research\/([A-Za-z][A-Za-z0-9.\-]{0,9})(?:\/|$)/.exec(pathname)
  return m ? m[1].toUpperCase() : null
}

/**
 * The destination a door should OFFER, given where the member is standing.
 *
 * ⛔ It returns `null` when there is genuinely no context, and the dialog then
 * ASKS. That is the designed outcome for a global invocation, not a fallback to
 * be papered over — guessing a destination is how a fast capture lands in the
 * wrong place, which is worse than one extra tap.
 *
 * @param {{pathname?: string, search?: string}} location
 * @param {{recents?: Array<{id: string, title?: string}>}} opts  Used only to
 *   put a NAME on a note we already know the id of. The destination is correct
 *   either way; this only decides whether the member reads "Weekly review" or
 *   the honest generic label.
 */
export function destinationFromLocation(location, { recents = [] } = {}) {
  const noteId = noteIdFromLocation(location)
  if (noteId) {
    const hit = recents.find((n) => n && n.id === noteId)
    return captureDestination({
      noteId,
      // ⭐ "This note" rather than "Notebook" when the title is not to hand.
      // The label must never imply "somewhere in your Notebook" when we are
      // about to write to one specific note (Slice 2 §3: a default may be
      // silent to type, never silent on screen).
      noteTitle: (hit && hit.title && hit.title.trim()) || 'This note',
      source: 'context',
    })
  }

  const ticker = tickerFromLocation(location)
  if (ticker) return captureDestination({ ticker, source: 'context' })

  return null
}
