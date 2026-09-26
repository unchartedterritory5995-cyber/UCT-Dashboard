// The tour's preference and its "is the tour for this member?" rule (wave 8 final review,
// fix I-2) -- in a module of their own because TWO files ask the same question:
//   * NotebookTour.jsx, which auto-starts itself;
//   * NotebookTourGate.jsx, which decides whether the tour's chunk is fetched AT ALL.
// The gate is imported statically by NotebookTab (so it cannot import the tour, whose code
// must stay out of the Notebook's first-open closure -- tourLazy.test.js), and a second copy
// of the rule inside it would drift from the tour's: the gate would then fetch a tour that
// never shows, or -- the worse direction -- never fetch one that should.
import { parsePref } from '../../../../../hooks/usePreferences'

export const TOUR_PREF = 'notebook_tour'
export const TOUR_STATES = Object.freeze({ started: 'started', done: 'done', dismissed: 'dismissed' })

/** The member's recorded tour ({v, state, step}) or null. */
export function readTourPref(raw) {
  const v = parsePref(raw, null)
  return v && typeof v === 'object' && typeof v.state === 'string' ? v : null
}

/** The preconditions for the tour to start on its own: the gate is on, the member is paid,
 *  the note count is KNOWN and is zero, and the preferences have loaded. */
export function tourIsForThisMember({ enabled, isPaid, notesKnown, hasAnyNotes, loading }) {
  return Boolean(enabled && isPaid && notesKnown && !hasAnyNotes && !loading)
}

/** A tour the member finished or dismissed never starts on its own again. */
export function tourFinished(savedState) {
  return savedState === TOUR_STATES.done || savedState === TOUR_STATES.dismissed
}
