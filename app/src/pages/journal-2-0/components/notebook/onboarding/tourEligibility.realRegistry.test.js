// @vitest-environment node
// Integration step 1 (W14-C2 merged onto the real B1-B3 registry). C2's own rails ran on a
// fake registry; these ask the SAME pure rules TourOfferGate and Help > "What's new" ask,
// over the REAL tours, with the REAL flag reader semantics: flags off means nothing offered.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { OTHER_TOURS, TOUR_REGISTRY, BASE_TOUR_ID, replayableTours } from './tourRegistry'
import { offerableTours, pickOffer, whatsNewTours } from './tourEligibility'
import { TOURS_PREF } from './tourSeenState'
import {
  FLAG_FALLBACKS, __resetNotebookFlags, latchNotebookFlags, notebookFlag,
} from '../../../lib/offline/notebookFlags'

const tourFlags = [...new Set(OTHER_TOURS.map((t) => t.flag))]
const offerIds = (args) => offerableTours({ tours: OTHER_TOURS, ...args }).map((t) => t.id)
const newIds = (args) => whatsNewTours({ tours: replayableTours(), ...args }).map((t) => t.id)

beforeEach(() => __resetNotebookFlags())
afterEach(() => __resetNotebookFlags())

describe('the real registry, through the real flag reader', () => {
  it('every tour flag is a notebookFlag() key (otherwise it could never be offered)', () => {
    for (const f of tourFlags) expect(Object.keys(FLAG_FALLBACKS), f).toContain(f)
  })

  it('nothing latched yet: nothing offered, nothing new', () => {
    expect(offerIds({ flagOn: notebookFlag, toursPrefRaw: undefined })).toEqual([])
    expect(newIds({ flagOn: notebookFlag, toursPrefRaw: undefined })).toEqual([])
  })

  it('every tour flag OFF: nothing offered, nothing new (the default-ON kill switch excepted only when ON)', () => {
    latchNotebookFlags(Object.fromEntries(tourFlags.map((f) => [f, false])))
    expect(offerIds({ flagOn: notebookFlag })).toEqual([])
    expect(newIds({ flagOn: notebookFlag })).toEqual([])
    expect(pickOffer({ offerable: offerableTours({ tours: OTHER_TOURS, flagOn: notebookFlag }) })).toBeNull()
  })

  it('a payload that omits the tour flags: only the kill switch tour (task reminders, ON when unset) is offered', () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true })
    expect(offerIds({ flagOn: notebookFlag })).toEqual(['task-reminders'])
  })

  it('every flag ON, no rows: every replayable registered tour, in registry order; never the base tour or the explainer', () => {
    latchNotebookFlags(Object.fromEntries(tourFlags.map((f) => [f, true])))
    const expected = TOUR_REGISTRY.filter((t) => t.id !== BASE_TOUR_ID && t.replayable).map((t) => t.id)
    expect(offerIds({ flagOn: notebookFlag })).toEqual(expected)
    expect(newIds({ flagOn: notebookFlag })).toEqual(expected)
    expect(expected).not.toContain('note-resurfaces')
    expect(expected).toHaveLength(19)        // 20 registered tours (B1 7, B2 6, B3 7) less the explainer
    expect(pickOffer({ offerable: offerableTours({ tours: OTHER_TOURS, flagOn: notebookFlag }) }).id).toBe(expected[0])
  })

  it('one capability ON: only its tours (the chart plan has two)', () => {
    latchNotebookFlags({ notebook_chart_plan_enabled: true, notebook_task_reminders_enabled: false })
    expect(offerIds({ flagOn: notebookFlag })).toEqual(['chart-plan-basics', 'chart-plan-replay'])
  })

  it('a seen row stops the offer; a "Not now" row (dismissed, step null) stays in What\'s new', () => {
    latchNotebookFlags({ notebook_chart_plan_enabled: true, notebook_task_reminders_enabled: false })
    const rows = JSON.stringify({ 'chart-plan-basics': { v: 1, state: 'dismissed', step: null } })
    expect(offerIds({ flagOn: notebookFlag, toursPrefRaw: rows })).toEqual(['chart-plan-replay'])
    expect(newIds({ flagOn: notebookFlag, toursPrefRaw: rows })).toEqual(['chart-plan-basics', 'chart-plan-replay'])
    const walked = JSON.stringify({ 'chart-plan-basics': { v: 1, state: 'dismissed', step: 'draw' } })
    expect(newIds({ flagOn: notebookFlag, toursPrefRaw: walked })).toEqual(['chart-plan-replay'])
    expect(TOURS_PREF).toBe('notebook_tours')
  })
})
