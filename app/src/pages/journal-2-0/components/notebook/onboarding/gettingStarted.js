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
//   tour:<id> the base tour's own seen-state says `done` -- its dedicated key
//             (`notebook_tour`, tourPref.js).
// Clicking an item only opens the door to the thing (a new note, the template picker,
// the sample, the tour). Nothing here records that a click happened.
//
// ⛔ FIVE STEPS AT MOST, AND ONE TOUR (Notebook UX pass, 2026-10-10). The list is what a new
// member can actually finish: write a note, start one from a template, the sample (only
// where it can be had), and the Notebook basics tour (`BASE_TOUR_ID`, only while it is live
// for this member). It used to carry one "Take the X tour" step per armed capability -- about
// twenty in production, "1 of 22 done" on a sandbox -- which made a list nobody could finish.
// `CHECKLIST_MAX_ITEMS` is the ceiling and gettingStarted.test.js holds the derivation to it
// with every flag armed.
//
// ⛔ THE OTHER TOURS ARE STILL DERIVED, NEVER LISTED -- in the LEARN MENU now, not here.
// Research Home's "Learn" button (LearnMenu.jsx, rules in learnTours.js) lists one item per
// REGISTERED, REPLAYABLE tour that is live for this member (`tourLive`), in registry order --
// the same derivation Help > Walkthroughs makes. A tour W14-B adds tomorrow appears there the
// day its flag arms, with no edit to either file. This list names only the base tour, and
// reads it off the registry rather than restating it.
//
// ⛔ ONE PREFERENCE KEY, `notebook_getting_started` -- its reader and writer live in
// `gettingStartedPref.js` (shared with the eager gate) and are re-exported here.
//
// ⛔ D4: ONCE CLOSED, CLOSED. `dismissed` (the member pressed Hide) and `done` (every item
// was ticked) both close the list for good. A capability that arms later adds its tour to
// the Learn menu and to Help > Walkthroughs (Support.jsx), never to this list, so a closed
// list has nothing to reopen for.
import { WALKTHROUGH_TITLE } from '../../../lib/templateBlocks'
import { BASE_TOUR_ID, TOUR_REGISTRY, getTourEntry, tourLive } from './tourRegistry'
import { TOUR_PREF, readTourPref } from './tourPref'
import { SAMPLE_PREF, readSamplePref } from './sampleNotebook'

import { CHECKLIST_PREF as CHECKLIST_PREF_KEY, recordedDone } from './gettingStartedPref'

export {
  CHECKLIST_PREF, CHECKLIST_STATES, readChecklistPref, checklistClosed, checklistRecord,
  checklistEnabled, recordedDone, withDone, closedAs,
} from './gettingStartedPref'

/** Every word the checklist shows. Plain and short. */
export const CHECKLIST_COPY = Object.freeze({
  title: 'Get started',
  progress: (done, total) => `${done} of ${total} done`,
  hide: 'Hide',
  hideLabel: 'Hide the get started list',
  // W14-keys: the name of the steps' one-Tab-stop toolbar (a screen reader announces it, and
  // that Arrow keys move inside it).
  stepsLabel: 'Get started steps',
  doneLabel: 'Done',
  // FIN-A11Y (M-1): said once, politely, when the last step is ticked and the card closes.
  allDone: 'Get started: every step is done.',
  note: 'Write your first note',
  template: 'Start a note from a template',
  sample: 'Open the sample notebook',
  sampleAdding: 'Adding the sample…',
  tour: (title) => `Take the ${title} tour`,
})

/** The most steps the list ever shows (see the header). */
export const CHECKLIST_MAX_ITEMS = 5

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

/** The base tour ticks from its own key, and only on `done` (a dismissed tour is not taken). */
function baseTourDone(prefs) {
  return readTourPref(prefs?.[TOUR_PREF])?.state === 'done'
}

/**
 * The checklist's items, in order: note, template, sample (only where it can be had),
 * then the Notebook basics tour while it is live (never any other tour: those are in the
 * Learn menu, learnTours.js).
 *
 *   prefs        usePreferences().prefs
 *   home         useNotebookHome().home
 *   hasAnyNotes  the Notebook's own note count, > 0 (NotebookTab's `hasAnyNotes`)
 *   canAddSample whether this member may add the sample now (the first-run door's own
 *                rule: onboarding on, paid, no notes yet)
 *   flag         notebookFlag (a parameter so a rail can arm a fake registry's flags)
 *   registry     TOUR_REGISTRY by default (the base tour's entry is read from it)
 *
 * Each item: { id, label, done, kind } with kind one of note | template | sample | tour,
 * plus `tourId` on the tour item. A step recorded as ticked in `notebook_getting_started`
 * stays ticked whatever the current evidence says (a step never unticks).
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
  if (sample || canAddSample || recordedDone(prefs?.[CHECKLIST_PREF_KEY]).has('sample')) {
    items.push({ id: 'sample', kind: 'sample', label: CHECKLIST_COPY.sample, done: Boolean(sample) })
  }
  const base = getTourEntry(BASE_TOUR_ID, registry)
  if (base && base.replayable && tourLive(base, flag)) {
    items.push({
      id: `tour:${base.id}`, kind: 'tour', tourId: base.id,
      label: CHECKLIST_COPY.tour(base.title), done: baseTourDone(prefs),
    })
  }
  const recorded = recordedDone(prefs?.[CHECKLIST_PREF_KEY])
  return items.map((i) => (recorded.has(i.id) && !i.done ? { ...i, done: true } : i))
}
