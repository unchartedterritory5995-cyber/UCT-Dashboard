// The "get started" checklist's rules (wave 14, lane W14-D). Pure: no screen.
// Every item's `done` is read off an authority that already exists; these rails prove
// each one ticks from the member's real action and NOT from anything else.
import { describe, it, expect } from 'vitest'
import {
  CHECKLIST_PREF, CHECKLIST_STATES, CHECKLIST_COPY, readChecklistPref, checklistClosed,
  checklistRecord, ownHomeNotes, isTemplateNote, deriveChecklistItems,
} from './gettingStarted'
import { TOUR_REGISTRY, BASE_TOUR_ID, replayableTours } from './tourRegistry'
import { WALKTHROUGH_TITLE } from '../../../lib/templateBlocks'
import { TEMPLATES } from '../../../lib/notebookTemplates'
import { extractPlainText } from '../../../lib/tiptap'

const armAll = () => true
const armNone = () => false
const note = (id, extra = {}) => ({ id, title: id, bodyPlain: '', ...extra })
const home = (continueWorking = [], extra = {}) => ({
  continueWorking, favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [], ...extra,
})
const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]))

// A small registry of our own (the real one holds only the base tour today).
const FAKE_REGISTRY = Object.freeze([
  { id: BASE_TOUR_ID, flag: 'notebook_onboarding_enabled', title: 'Notebook basics', replayable: true, load: async () => ({}) },
  { id: 'writing-help', flag: 'notebook_writing_help_enabled', title: 'Writing help', replayable: true, load: async () => ({}) },
  { id: 'formulas', flag: 'notebook_formulas_enabled', title: 'Formulas', replayable: true, load: async () => ({}) },
  { id: 'resurface', flag: 'awareness_note_resurface_enabled', title: 'A note resurfaces', replayable: false, load: async () => ({}) },
])

describe('the one preference key', () => {
  it('is notebook_getting_started, and reads defensively', () => {
    expect(CHECKLIST_PREF).toBe('notebook_getting_started')
    expect(readChecklistPref(undefined)).toBeNull()
    expect(readChecklistPref('not json')).toBeNull()
    expect(readChecklistPref('{"v":1}')).toBeNull()
    expect(readChecklistPref('{"v":1,"state":"dismissed","at":"x"}')).toEqual({ v: 1, state: 'dismissed', at: 'x' })
    expect(readChecklistPref({ v: 1, state: 'done' })).toEqual({ v: 1, state: 'done' })
  })

  it('D4: dismissed and done both close the list; anything else does not', () => {
    expect(checklistClosed(null)).toBe(false)
    expect(checklistClosed({ v: 1, state: 'something-else' })).toBe(false)
    expect(checklistClosed({ v: 1, state: CHECKLIST_STATES.dismissed })).toBe(true)
    expect(checklistClosed(JSON.stringify({ v: 1, state: CHECKLIST_STATES.done }))).toBe(true)
  })

  it('records {v:1, state, at}', () => {
    expect(checklistRecord('dismissed', new Date('2026-10-04T12:00:00Z')))
      .toEqual({ v: 1, state: 'dismissed', at: '2026-10-04T12:00:00.000Z' })
  })
})

describe('own notes exclude the sample', () => {
  it('drops every tracked sample id and de-duplicates across sections', () => {
    const h = home([note('s1'), note('mine')], { favorites: [note('mine'), note('s2')] })
    expect(ownHomeNotes(h, ['s1', 's2']).map((n) => n.id)).toEqual(['mine'])
  })

  it('tolerates a missing home or missing sections', () => {
    expect(ownHomeNotes(null, [])).toEqual([])
    expect(ownHomeNotes({ continueWorking: null }, [])).toEqual([])
  })
})

describe('a template note is recognised by the walkthrough every template ends with', () => {
  it('reads the walkthrough title off the note body', () => {
    expect(isTemplateNote(note('a', { bodyPlain: `Thesis\n${WALKTHROUGH_TITLE}\n1. Do this` }))).toBe(true)
    expect(isTemplateNote(note('b', { bodyPlain: 'my own words' }))).toBe(false)
    expect(isTemplateNote(note('c', { bodyPlain: undefined }))).toBe(false)
  })

  // The rule rests on a fact about the catalog, so the catalog itself is the rail:
  // every template's built body, flattened by the SAME plain-text function the server
  // stores (`bodyPlain`), carries the walkthrough title.
  it('every catalog template, built and flattened, carries the walkthrough title', () => {
    expect(TEMPLATES.length).toBeGreaterThan(0)
    const missing = TEMPLATES.filter((t) => !extractPlainText(t.build({})).includes(WALKTHROUGH_TITLE))
      .map((t) => t.key)
    expect(missing).toEqual([])
  })
})

describe('deriveChecklistItems -- the fixed items', () => {
  it('first run: note and template unticked; sample offered when it can be had', () => {
    const items = deriveChecklistItems({ hasAnyNotes: false, canAddSample: true, flag: armNone })
    expect(items.map((i) => i.id)).toEqual(['note', 'template', 'sample'])
    expect(items.every((i) => !i.done)).toBe(true)
    expect(byId(items).note.label).toBe(CHECKLIST_COPY.note)
  })

  it('the sample is not offered where it cannot be had, and ticks once it was added', () => {
    expect(deriveChecklistItems({ canAddSample: false, flag: armNone }).map((i) => i.id))
      .toEqual(['note', 'template'])
    const prefs = { notebook_sample: JSON.stringify({ v: 1, ids: ['s1'] }) }
    const sample = byId(deriveChecklistItems({ prefs, canAddSample: false, flag: armNone })).sample
    expect(sample.done).toBe(true)
  })

  it('note: ticked by having notes when there is no sample', () => {
    expect(byId(deriveChecklistItems({ hasAnyNotes: true, flag: armNone })).note.done).toBe(true)
    expect(byId(deriveChecklistItems({ hasAnyNotes: false, flag: armNone })).note.done).toBe(false)
  })

  it('note: the sample alone does NOT tick it -- only a note of the member\'s own does', () => {
    const prefs = { notebook_sample: JSON.stringify({ v: 1, ids: ['s1', 's2'] }) }
    const sampleOnly = deriveChecklistItems({ prefs, hasAnyNotes: true, home: home([note('s1'), note('s2')]), flag: armNone })
    expect(byId(sampleOnly).note.done).toBe(false)
    const withOwn = deriveChecklistItems({ prefs, hasAnyNotes: true, home: home([note('s1'), note('mine')]), flag: armNone })
    expect(byId(withOwn).note.done).toBe(true)
  })

  it('template: ticked only by a note of the member\'s own built from a template', () => {
    const tpl = note('t', { bodyPlain: `x ${WALKTHROUGH_TITLE} y` })
    expect(byId(deriveChecklistItems({ hasAnyNotes: true, home: home([tpl]), flag: armNone })).template.done).toBe(true)
    expect(byId(deriveChecklistItems({ hasAnyNotes: true, home: home([note('plain')]), flag: armNone })).template.done).toBe(false)
    // A sample note that happens to carry a walkthrough is not the member's own.
    const prefs = { notebook_sample: JSON.stringify({ v: 1, ids: ['t'] }) }
    expect(byId(deriveChecklistItems({ prefs, hasAnyNotes: true, home: home([tpl]), flag: armNone })).template.done).toBe(false)
  })
})

describe('deriveChecklistItems -- the tour items are DERIVED from the registry', () => {
  it('one item per replayable registered tour whose flag is armed, in registry order', () => {
    const armed = new Set(['notebook_onboarding_enabled', 'notebook_formulas_enabled', 'awareness_note_resurface_enabled'])
    const items = deriveChecklistItems({ registry: FAKE_REGISTRY, flag: (k) => armed.has(k) })
    expect(items.filter((i) => i.kind === 'tour').map((i) => i.tourId)).toEqual([BASE_TOUR_ID, 'formulas'])
    expect(byId(items)['tour:formulas'].label).toBe('Take the Formulas tour')
  })

  it('no armed flag, no tour item; a flag must be exactly true', () => {
    expect(deriveChecklistItems({ registry: FAKE_REGISTRY, flag: armNone }).some((i) => i.kind === 'tour')).toBe(false)
    expect(deriveChecklistItems({ registry: FAKE_REGISTRY, flag: () => 'yes' }).some((i) => i.kind === 'tour')).toBe(false)
    expect(deriveChecklistItems({ registry: FAKE_REGISTRY }).some((i) => i.kind === 'tour')).toBe(false)
  })

  it('the base tour ticks from its own key (notebook_tour), only on done', () => {
    const at = (state) => byId(deriveChecklistItems({
      registry: FAKE_REGISTRY, flag: armAll, prefs: { notebook_tour: JSON.stringify({ v: 1, state, step: 'x' }) },
    }))[`tour:${BASE_TOUR_ID}`].done
    expect(at('done')).toBe(true)
    expect(at('started')).toBe(false)
    expect(at('dismissed')).toBe(false)
  })

  it('every other tour ticks from its own row in notebook_tours, never the base key', () => {
    const prefs = {
      notebook_tours: JSON.stringify({ 'writing-help': { v: 1, state: 'done', step: null } }),
      notebook_tour: JSON.stringify({ v: 1, state: 'done' }),
    }
    const items = byId(deriveChecklistItems({ registry: FAKE_REGISTRY, flag: armAll, prefs }))
    expect(items['tour:writing-help'].done).toBe(true)
    expect(items['tour:formulas'].done).toBe(false)
  })

  it('the real registry is what the component derives from (non-vacuous: it holds the base tour)', () => {
    expect(replayableTours(TOUR_REGISTRY).map((t) => t.id)).toContain(BASE_TOUR_ID)
    const items = deriveChecklistItems({ flag: (k) => k === 'notebook_onboarding_enabled' })
    expect(items.map((i) => i.id)).toContain(`tour:${BASE_TOUR_ID}`)
    expect(byId(items)[`tour:${BASE_TOUR_ID}`].label).toBe('Take the Notebook basics tour')
  })
})
