// The "get started" checklist's rules (wave 14, lane W14-D; plan section 4.4, controller
// default D4). Pure: no React, no fetch -- `GettingStartedChecklist.jsx` reads the
// inputs and renders what this module answers, so every rule is railed here without a
// screen (gettingStarted.test.js).
//
// ⛔ AN ITEM IS TICKED BY WHAT THE MEMBER DID, NEVER BY A CLICK ON THE LIST. Each item's
// `done` is read off an authority that already exists for that thing:
//   note      a note of the member's own (not one of the sample's tracked ids) is on
//             Research Home's one aggregated read (`/api/j2/notebook/home`);
//   template  one of those own notes carries the walkthrough every catalog template
//             ends with (`WALKTHROUGH_TITLE`, lib/templateBlocks.js -- the SAME constant
//             the catalog builds the toggle from, and the toggle summary is plain text,
//             so it is in the note's `bodyPlain`);
//   sample    the sample notebook's own preference (`notebook_sample`, read by
//             sampleNotebook.js's own reader);
//   tour:<id> that tour's own seen-state says `done` -- the base tour's dedicated key
//             (`notebook_tour`, tourPref.js), every other registered tour's row in
//             `notebook_tours` (tourSeenState.js).
// Clicking an item only opens the door to the thing (a new note, the template picker,
// the sample, the tour). Nothing here records that a click happened.
//
// ⛔ THE TOUR ITEMS ARE DERIVED, NEVER LISTED. One item per REGISTERED, REPLAYABLE tour
// whose capability flag is armed (`notebookFlag(entry.flag) === true`), in registry
// order. A tour W14-B adds tomorrow appears here the day its flag arms, with no edit to
// this file. A non-replayable entry (the plan's row 21, a passive explainer) cannot be
// opened on demand, so it is not offered as a step.
//
// ⛔ ONE PREFERENCE KEY, `notebook_getting_started` -- its reader and writer live in
// `gettingStartedPref.js` (shared with the eager gate) and are re-exported here.
//
// ⛔ D4: ONCE CLOSED, CLOSED. `dismissed` (the member pressed Hide) and `done` (every item
// was ticked) both close the list for good. A capability that arms later adds a tour item
// to the DERIVATION, but a closed list never reopens for it -- that tour is reached from
// Help > Walkthroughs instead (Support.jsx), which lists every registered tour.
import { WALKTHROUGH_TITLE } from '../../../lib/templateBlocks'
import { BASE_TOUR_ID, TOUR_REGISTRY, replayableTours } from './tourRegistry'
import { TOUR_PREF, readTourPref } from './tourPref'
import { TOURS_PREF, readTourState } from './tourSeenState'
import { SAMPLE_PREF, readSamplePref } from './sampleNotebook'

export {
  CHECKLIST_PREF, CHECKLIST_STATES, readChecklistPref, checklistClosed, checklistRecord,
} from './gettingStartedPref'

/** Every word the checklist shows. Plain and short. */
export const CHECKLIST_COPY = Object.freeze({
  title: 'Get started',
  progress: (done, total) => `${done} of ${total} done`,
  hide: 'Hide',
  hideLabel: 'Hide the get started list',
  doneLabel: 'Done',
  note: 'Write your first note',
  template: 'Start a note from a template',
  sample: 'Open the sample notebook',
  sampleAdding: 'Adding the sample…',
  tour: (title) => `Take the ${title} tour`,
})

const HOME_SECTIONS = ['continueWorking', 'favorites', 'activeTheses', 'openPositionResearch', 'needsReview']

/** Every note summary on Research Home's aggregated read that is the member's own
 *  (not one of the sample's tracked ids), de-duplicated by id. */
export function ownHomeNotes(home, sampleIds = []) {
  const skip = new Set(sampleIds)
  const seen = new Map()
  for (const key of HOME_SECTIONS) {
    const list = Array.isArray(home?.[key]) ? home[key] : []
    for (const n of list) {
      if (n && typeof n.id === 'string' && !skip.has(n.id) && !seen.has(n.id)) seen.set(n.id, n)
    }
  }
  return Array.from(seen.values())
}

/** A note built from a catalog template still carries its walkthrough toggle. */
export function isTemplateNote(note) {
  return typeof note?.bodyPlain === 'string' && note.bodyPlain.includes(WALKTHROUGH_TITLE)
}

function tourDone(entry, prefs) {
  const state = entry.id === BASE_TOUR_ID
    ? readTourPref(prefs?.[TOUR_PREF])?.state
    : readTourState(prefs?.[TOURS_PREF], entry.id)?.state
  return state === 'done'
}

/**
 * The checklist's items, in order: note, template, sample (only where it can be had),
 * then one per armed, replayable registered tour.
 *
 *   prefs        usePreferences().prefs
 *   home         useNotebookHome().home
 *   hasAnyNotes  the Notebook's own note count, > 0 (NotebookTab's `hasAnyNotes`)
 *   canAddSample whether this member may add the sample now (the first-run door's own
 *                rule: onboarding on, paid, no notes yet)
 *   flag         notebookFlag (a parameter so a rail can arm a fake registry's flags)
 *   registry     TOUR_REGISTRY by default
 *
 * Each item: { id, label, done, kind } with kind one of note | template | sample | tour,
 * plus `tourId` on a tour item.
 */
export function deriveChecklistItems({
  prefs = {}, home = null, hasAnyNotes = false, canAddSample = false,
  flag, registry = TOUR_REGISTRY,
} = {}) {
  const sample = readSamplePref(prefs?.[SAMPLE_PREF])
  const own = ownHomeNotes(home, sample?.ids || [])
  // Without a sample every note is the member's own, so the count alone answers it.
  const wroteNote = Boolean(hasAnyNotes) && (!sample || own.length > 0)
  const items = [
    { id: 'note', kind: 'note', label: CHECKLIST_COPY.note, done: wroteNote },
    { id: 'template', kind: 'template', label: CHECKLIST_COPY.template, done: own.some(isTemplateNote) },
  ]
  // The sample is offered only where it can be had (the server refuses it to a member
  // with notes), and shown ticked once it was.
  if (sample || canAddSample) {
    items.push({ id: 'sample', kind: 'sample', label: CHECKLIST_COPY.sample, done: Boolean(sample) })
  }
  for (const entry of replayableTours(registry)) {
    if (typeof flag !== 'function' || flag(entry.flag) !== true) continue
    items.push({
      id: `tour:${entry.id}`, kind: 'tour', tourId: entry.id,
      label: CHECKLIST_COPY.tour(entry.title), done: tourDone(entry, prefs),
    })
  }
  return items
}
