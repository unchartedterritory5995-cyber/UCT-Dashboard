// The Learn menu's rules (Notebook UX pass, 2026-10-10). Pure: no screen.
//
// ⛔ The tours are DERIVED from the registry, never listed: a fake registry entry appears in
// the menu the moment its flag arms, and leaves it the moment it is not live. ⛔ The derivation
// is the SAME one Help > Walkthroughs makes. ⛔ Starting a tour goes through the two existing
// doors, read off the events the gates listen for.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  GROUP_OF, HELP_WALKTHROUGHS_HREF, LEARN_COPY, LEARN_GROUPS, NEEDS_NOTES, learnMenuEnabled, learnMenuTours, learnTourGroup, startTour,
} from './learnTours'
import { BASE_TOUR_ID, TOUR_REGISTRY, replayableTours, tourLive } from './tourRegistry'
import { TOUR_OPEN_EVENT, __resetTourControl, hasPendingTourOpen } from './tourControl'
import {
  REGISTRY_TOUR_OPEN_EVENT, __resetRegistryTourControl, hasPendingRegistryTourOpen,
} from './tourRegistryControl'

const WAVE14 = ['notebook_onboarding_enabled', 'notebook_getting_started_enabled']
const armed = (...flags) => {
  const on = new Set([...WAVE14, ...flags])
  return (k) => on.has(k)
}

const FAKE_REGISTRY = Object.freeze([
  { id: BASE_TOUR_ID, flag: 'notebook_onboarding_enabled', title: 'Notebook basics', replayable: true, load: async () => ({}) },
  { id: 'writing-help', flag: 'notebook_writing_help_enabled', title: 'Writing help', replayable: true, load: async () => ({}) },
  { id: 'formulas', flag: 'notebook_formulas_enabled', title: 'Formulas', replayable: true, load: async () => ({}) },
  { id: 'needs-two', flag: 'notebook_formulas_enabled', title: 'Needs two', replayable: true, requires: ['notebook_chart_plan_enabled'], load: async () => ({}) },
  { id: 'resurface', flag: 'awareness_note_resurface_enabled', title: 'A note resurfaces', replayable: false, load: async () => ({}) },
])

afterEach(() => {
  __resetTourControl()
  __resetRegistryTourControl()
  vi.restoreAllMocks()
})

describe('learnMenuTours -- derived from the registry, never listed', () => {
  it('lists exactly the live, replayable tours, in registry order', () => {
    const ids = learnMenuTours({ registry: FAKE_REGISTRY, flag: armed('notebook_formulas_enabled', 'awareness_note_resurface_enabled') })
      .map((t) => t.id)
    expect(ids).toEqual([BASE_TOUR_ID, 'formulas'])
  })

  it('a tour added to the registry appears the moment its flag arms (no edit to the menu)', () => {
    const grown = Object.freeze([
      ...FAKE_REGISTRY,
      { id: 'brand-new', flag: 'notebook_brand_new_enabled', title: 'Brand new', replayable: true, load: async () => ({}) },
    ])
    expect(learnMenuTours({ registry: grown, flag: armed() }).map((t) => t.id)).not.toContain('brand-new')
    expect(learnMenuTours({ registry: grown, flag: armed('notebook_brand_new_enabled') }).map((t) => t.id))
      .toEqual([BASE_TOUR_ID, 'brand-new'])
  })

  it('a passive explainer (not replayable) is never offered, armed or not', () => {
    expect(learnMenuTours({ registry: FAKE_REGISTRY, flag: () => true }).map((t) => t.id)).not.toContain('resurface')
  })

  it('a tour with `requires` is offered only when every required flag is armed too', () => {
    expect(learnMenuTours({ registry: FAKE_REGISTRY, flag: armed('notebook_formulas_enabled') }).map((t) => t.id))
      .not.toContain('needs-two')
    expect(learnMenuTours({ registry: FAKE_REGISTRY, flag: armed('notebook_formulas_enabled', 'notebook_chart_plan_enabled') })
      .map((t) => t.id)).toContain('needs-two')
  })

  it('with the wave-14 switch off only the base tour is live; with no flag function, nothing', () => {
    const onlyOnboarding = (k) => k === 'notebook_onboarding_enabled' || k === 'notebook_formulas_enabled'
    expect(learnMenuTours({ registry: FAKE_REGISTRY, flag: onlyOnboarding }).map((t) => t.id)).toEqual([BASE_TOUR_ID])
    expect(learnMenuTours({ registry: FAKE_REGISTRY })).toEqual([])
  })

  it('on the REAL registry it is exactly Help > Walkthroughs\' list (one derivation, two doors)', () => {
    const flag = () => true
    const help = replayableTours().filter((t) => tourLive(t, flag)).map((t) => t.id)
    const menu = learnMenuTours({ flag }).map((t) => t.id)
    expect(menu).toEqual(help)
    // ⛔ NON-VACUITY: the real registry offers more than the base tour.
    expect(menu.length).toBeGreaterThan(1)
    expect(menu[0]).toBe(BASE_TOUR_ID)
    expect(TOUR_REGISTRY.some((t) => t.replayable === false)).toBe(true)
    expect(menu).not.toContain(TOUR_REGISTRY.find((t) => t.replayable === false).id)
  })
})

describe('I3: a tour whose first anchor needs a note is hidden while the member has none', () => {
  it('on the REAL registry, voice-notes is listed unless hasAnyNotes is exactly false', () => {
    const flag = () => true
    const ids = (hasAnyNotes) => learnMenuTours({ flag, hasAnyNotes }).map((t) => t.id)
    expect(ids(true)).toContain('voice-notes')
    expect(ids(undefined)).toContain('voice-notes')
    expect(ids(false)).not.toContain('voice-notes')
    // everything else is untouched: hiding is by id, not a wholesale drop (non-vacuity)
    expect(ids(false)).toEqual(ids(true).filter((id) => id !== 'voice-notes'))
    expect(ids(false)).toContain(BASE_TOUR_ID)
  })

  it('NEEDS_NOTES names real replayable tours only (a rename cannot strand the rule)', () => {
    const replayable = new Set(TOUR_REGISTRY.filter((t) => t.replayable !== false).map((t) => t.id))
    expect(NEEDS_NOTES).toContain('voice-notes')
    for (const id of NEEDS_NOTES) expect(replayable.has(id), `${id} is not a replayable registry tour`).toBe(true)
    expect(Object.isFrozen(NEEDS_NOTES)).toBe(true)
  })

  it('the voice tour first step really is the New note control that needs a note (the reason for the rule)', () => {
    const steps = readFileSync(join(__dirname, 'tours/b1VoiceNotes.steps.js'), 'utf8')
    expect(steps).toMatch(/anchor:\s*'new-note-home'/)
    const menu = readFileSync(join(__dirname, '../NewNoteMenu.jsx'), 'utf8')
    expect(menu).toMatch(/data-tour="new-note-home"/)
    const home = readFileSync(join(__dirname, '../ResearchHome.jsx'), 'utf8')
    expect(home).toMatch(/hasAnyNotes && onOpenNewNoteSheet && \(\s*<NewNoteMenu/)
  })
})

describe('learnMenuEnabled -- the wave-14 switch, reused', () => {
  it('needs BOTH the onboarding flag and getting-started, exactly true', () => {
    expect(learnMenuEnabled(armed())).toBe(true)
    expect(learnMenuEnabled((k) => k === 'notebook_onboarding_enabled')).toBe(false)
    expect(learnMenuEnabled((k) => k === 'notebook_getting_started_enabled')).toBe(false)
    expect(learnMenuEnabled(() => 'yes')).toBe(false)
    expect(learnMenuEnabled(undefined)).toBe(false)
  })
})

describe('startTour -- the existing doors, nothing new', () => {
  it('the base tour opens through its own door (TOUR_OPEN_EVENT), never the registry\'s', () => {
    const base = vi.fn()
    const reg = vi.fn()
    window.addEventListener(TOUR_OPEN_EVENT, base)
    window.addEventListener(REGISTRY_TOUR_OPEN_EVENT, reg)
    startTour(BASE_TOUR_ID)
    window.removeEventListener(TOUR_OPEN_EVENT, base)
    window.removeEventListener(REGISTRY_TOUR_OPEN_EVENT, reg)
    expect(base).toHaveBeenCalledTimes(1)
    expect(reg).not.toHaveBeenCalled()
    expect(hasPendingTourOpen()).toBe(true)
  })

  it('every other tour opens through the registry\'s door, with its id', () => {
    const base = vi.fn()
    const reg = vi.fn()
    window.addEventListener(TOUR_OPEN_EVENT, base)
    window.addEventListener(REGISTRY_TOUR_OPEN_EVENT, reg)
    startTour('formulas')
    window.removeEventListener(TOUR_OPEN_EVENT, base)
    window.removeEventListener(REGISTRY_TOUR_OPEN_EVENT, reg)
    expect(base).not.toHaveBeenCalled()
    expect(reg).toHaveBeenCalledTimes(1)
    expect(reg.mock.calls[0][0].detail).toEqual({ tourId: 'formulas' })
    expect(hasPendingRegistryTourOpen()).toBe('formulas')
  })
})

describe('the Help link', () => {
  it('lands on Help > Walkthroughs: the hash is Support.jsx\'s own WALKTHROUGHS_ID', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'pages', 'Support.jsx'), 'utf8')
    const m = /export const WALKTHROUGHS_ID = '([^']+)'/.exec(src)
    expect(m).not.toBeNull()
    expect(HELP_WALKTHROUGHS_HREF).toBe(`/support#${m[1]}`)
    // and /support is a real route
    const app = readFileSync(join(process.cwd(), 'src', 'App.jsx'), 'utf8')
    expect(app).toMatch(/path=["']\/?support["']/)
  })

  it('the copy is plain', () => {
    expect(LEARN_COPY.button).toBe('Learn')
    expect(LEARN_COPY.tour('Formulas')).toBe('Formulas tour')
  })
})

// P0.12: the menu is grouped. The group of a tour is DATA beside the registry, so a tour added
// to the registry without a group would fall into the default one by accident -- this rail
// makes that a red test instead of a quiet mis-filing. The ids come from TOUR_REGISTRY, never
// from a list typed here.
describe('learnTourGroup -- every replayable tour has a home', () => {
  it('the four groups, in the order the menu shows them', () => {
    expect(LEARN_GROUPS).toEqual(['Basics', 'Writing and capture', 'Trading', 'Research'])
    expect(Object.isFrozen(LEARN_GROUPS)).toBe(true)
    expect(Object.isFrozen(GROUP_OF)).toBe(true)
  })

  it('every replayable registry id has an entry in GROUP_OF (a new tour cannot land ungrouped by accident)', () => {
    const replayable = TOUR_REGISTRY.filter((t) => t.replayable !== false).map((t) => t.id)
    // NON-VACUITY: the real registry has the base tour and many more
    expect(replayable.length).toBeGreaterThan(10)
    expect(replayable).toContain(BASE_TOUR_ID)
    const missing = replayable.filter((id) => !Object.prototype.hasOwnProperty.call(GROUP_OF, id))
    expect(missing, `replayable tours with no group: ${missing.join(', ')}`).toEqual([])
  })

  it('every entry names a real group and a real replayable tour (no stale id outlives a rename)', () => {
    const replayable = new Set(TOUR_REGISTRY.filter((t) => t.replayable !== false).map((t) => t.id))
    for (const [id, group] of Object.entries(GROUP_OF)) {
      expect(LEARN_GROUPS, `${id} -> ${group}`).toContain(group)
      expect(replayable.has(id), `${id} is not a replayable registry tour`).toBe(true)
    }
  })

  it('the base tour is under Basics, and an id the map does not know falls back to Basics', () => {
    expect(learnTourGroup(BASE_TOUR_ID)).toBe('Basics')
    expect(learnTourGroup('chart-plan-basics')).toBe('Trading')
    expect(learnTourGroup('voice-notes')).toBe('Writing and capture')
    expect(learnTourGroup('transcript-capture')).toBe('Research')
    expect(learnTourGroup('not-a-tour')).toBe('Basics')
  })
})
