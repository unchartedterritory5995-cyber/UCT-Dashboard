// S14 (audit 2026-11-05, details #65 and #68): what the member has done with each tour, read off the tour-seen state
// that already exists -- never a new key. The base tour keeps its own key (`notebook_tour`, tourPref.js); every other
// tour has a row in `notebook_tours` (tourSeenState.js). Read by the Learn menu (a ✓ for done, "New" for not taken)
// and Help > Walkthroughs ("Start" for not taken, "Replay" for taken).
//
//   done   the member finished it;
//   taken  the member walked into it (started, or closed it part way);
//   new    never taken: no record at all, or declined from the one-time offer before walking a step (the same rule
//          Help > What's new uses, tourEligibility.js `whatsNewTours`).
import { BASE_TOUR_ID } from './tourRegistry'
import { TOUR_PREF, readTourPref } from './tourPref'
import { TOURS_PREF, readTourState } from './tourSeenState'

export const TOUR_PROGRESS = Object.freeze({ done: 'done', taken: 'taken', new: 'new' })

/** 'done' | 'taken' | 'new' for one tour, from usePreferences().prefs. */
export function tourProgress(tourId, prefs) {
  const row = tourId === BASE_TOUR_ID ? readTourPref(prefs?.[TOUR_PREF]) : readTourState(prefs?.[TOURS_PREF], tourId)
  if (!row) return TOUR_PROGRESS.new
  if (row.state === 'done') return TOUR_PROGRESS.done
  if (row.state === 'dismissed' && (row.step === null || row.step === undefined)) return TOUR_PROGRESS.new
  return TOUR_PROGRESS.taken
}
