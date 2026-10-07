// The wave-8 base tour stays EXACTLY as it shipped (wave 14, lane W14-0, milestone
// M0: "base tour unregressed").
//
// Why this file exists: every existing base-tour rail (NotebookTour*.test.jsx,
// NotebookTourGate.test.jsx, tourAnchors.test.js) DERIVES its expectations from
// `TOUR_STEPS` itself -- `Step 1 of ${TOUR_STEPS.length}`, one anchor per step --
// so a change to the step list moves the test and the product together and
// nothing goes red. This is the MUTATION CONTROL those derivations cannot be:
// a literal pin of the eight steps, the one preference key, and proof that the
// W14-0 code motion (isOnScreen / anchorFor moved to tourAnchorVisibility.js) is
// the same functions the tour exports, not a copy.
//
// Mutation-run when written (docs/notebook/wave14-w14-0.md, "Base tour"):
// swapping the last two steps reds this file (and one NotebookTour.test.jsx
// case); dropping the last step reds this file plus three existing rails. Both
// mutations were reverted by re-applying the original text.
// ⛔ Changing the base tour is an owner decision, not a lane edit: if this goes
// red, the change is a member-visible one and this pin moves only with it.
import { describe, it, expect } from 'vitest'
import { TOUR_STEPS } from './tourSteps'
import { TOUR_STEP_COPY } from './tourCopy'
import { TOUR_PREF } from './tourPref'
import { TOUR_START_STATE } from './tourControl'
import * as Tour from './NotebookTour'
import * as Visibility from './tourAnchorVisibility'
import { BASE_TOUR_ID, getTourEntry, startState } from './tourRegistry'
import { TOURS_PREF } from './tourSeenState'

// As shipped in wave 8 and still on the clean base b06ec4fd85 (plan 3.2: "It is
// 8 steps, not 3").
const SHIPPED = [
  ['first-run', 'first-run', 'components/notebook/ResearchHome.jsx'],
  ['sidebar', 'sidebar', 'components/notebook/FolderSidebar.jsx'],
  ['search', 'search', 'components/notebook/FolderSidebar.jsx'],
  ['new-note', 'new-note', 'tabs/NotebookTab.jsx'],
  ['view-switcher', 'view-switcher', 'tabs/NotebookTab.jsx'],
  ['import', 'import', 'tabs/NotebookTab.jsx'],
  ['ask', 'ask-row', 'components/notebook/NoteEditorPage.jsx'],
  ['export', 'note-export', 'components/notebook/NoteEditorPage.jsx'],
]

describe('the base tour is the eight steps wave 8 shipped', () => {
  it('same steps, same order, same anchors, same files', () => {
    expect(TOUR_STEPS.map((s) => [s.id, s.anchor, s.file])).toEqual(SHIPPED)
  })

  it('every step still has its copy, and the copy has no orphan', () => {
    expect(Object.keys(TOUR_STEP_COPY).sort()).toEqual(SHIPPED.map(([id]) => id).sort())
  })

  it('progress still lives on the one wave-8 key, and the registry never shares it', () => {
    expect(TOUR_PREF).toBe('notebook_tour')
    expect(TOURS_PREF).not.toBe(TOUR_PREF)
  })

  it('the registry base entry opens the tour with the same state "Take the tour" uses', async () => {
    expect(startState(BASE_TOUR_ID)).toBe(TOUR_START_STATE)
    const { steps, copy } = await getTourEntry(BASE_TOUR_ID).load()
    expect(steps).toBe(TOUR_STEPS)
    expect(copy).toBe(TOUR_STEP_COPY)
  })
})

describe('the W14-0 code motion is motion, not a rewrite', () => {
  it('NotebookTour re-exports the SAME isOnScreen / anchorFor the generic engine uses', () => {
    expect(Tour.isOnScreen).toBe(Visibility.isOnScreen)
    expect(Tour.anchorFor).toBe(Visibility.anchorFor)
  })
})
