// The pure "offer once" rules (wave 14, lane W14-C2), over FAKE registries -- the real
// one holds only the base tour on this branch.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  OFFER_SESSION_KEY, offerableTours, pickOffer, whatsNewTours, offerBlockedBy,
  readOfferSession, writeOfferSession, __resetOfferSession,
} from './tourEligibility'
import { BASE_TOUR_ID } from './tourRegistry'

const t = (id, flag = `f_${id}`, extra = {}) => ({ id, flag, title: `Tour ${id}`, replayable: true, load: () => null, ...extra })
const REG = [t(BASE_TOUR_ID, 'notebook_onboarding_enabled'), t('a'), t('b'), t('c'), t('x', 'f_x', { replayable: false })]
const allOn = () => true
const rows = (m) => JSON.stringify(m)

describe('offerableTours', () => {
  it('flag on, never seen, replayable, not the base tour -- in registry order', () => {
    expect(offerableTours({ tours: REG, flagOn: allOn, toursPrefRaw: undefined }).map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('a flag that is not EXACTLY true keeps the tour out (unlatched reads as off)', () => {
    const flagOn = (f) => ({ f_a: 'true', f_b: 1, f_c: true }[f])
    expect(offerableTours({ tours: REG, flagOn, toursPrefRaw: undefined }).map((e) => e.id)).toEqual(['c'])
  })

  it('ANY row -- started, done, dismissed -- means it was met and is never offered', () => {
    const raw = rows({ a: { v: 1, state: 'started', step: 's1' }, b: { v: 1, state: 'done', step: null }, c: { v: 1, state: 'dismissed', step: null } })
    expect(offerableTours({ tours: REG, flagOn: allOn, toursPrefRaw: raw })).toEqual([])
  })
})

describe('pickOffer -- one per session, in order, never expiring', () => {
  const offerable = [t('a'), t('b')]
  it('no session yet: the first in order', () => {
    expect(pickOffer({ offerable, session: null }).id).toBe('a')
  })
  it('this session offered a and it is unanswered: a again (still the one offer)', () => {
    expect(pickOffer({ offerable, session: { id: 'a', answered: false } }).id).toBe('a')
  })
  it('⛔ this session answered its offer: nothing else, even with b waiting', () => {
    expect(pickOffer({ offerable, session: { id: 'a', answered: true } })).toBeNull()
  })
  it('this session offered a, which was taken elsewhere: the session is spent, b is NOT offered', () => {
    expect(pickOffer({ offerable: [t('b')], session: { id: 'a', answered: false } })).toBeNull()
  })
  it('a NEW session after declining a: b, with no time limit anywhere', () => {
    const later = offerableTours({ tours: REG, flagOn: allOn, toursPrefRaw: rows({ a: { v: 1, state: 'dismissed', step: null } }) })
    expect(pickOffer({ offerable: later, session: null }).id).toBe('b')
  })
})

describe('whatsNewTours (Help)', () => {
  it('lists never-seen tours AND tours declined from the prompt; not walked, done or flag-off ones', () => {
    const raw = rows({
      a: { v: 1, state: 'dismissed', step: null },        // "Not now": still new
      b: { v: 1, state: 'dismissed', step: 's2' },        // skipped from INSIDE the tour: taken
      c: { v: 1, state: 'done', step: 's3' },
    })
    const reg = [...REG, t('d'), t('e', 'f_off')]
    const flagOn = (f) => f !== 'f_off'
    expect(whatsNewTours({ tours: reg, flagOn, toursPrefRaw: raw }).map((e) => e.id)).toEqual(['a', 'd'])
  })
  it('a started tour is taken', () => {
    expect(whatsNewTours({ tours: [t('a')], flagOn: allOn, toursPrefRaw: rows({ a: { v: 1, state: 'started', step: 's1' } }) })).toEqual([])
  })
  it('never lists the base tour', () => {
    expect(whatsNewTours({ tours: REG, flagOn: allOn }).map((e) => e.id)).not.toContain(BASE_TOUR_ID)
  })
})

describe('offerBlockedBy', () => {
  const clear = { prefsLoading: false, notesKnown: true, noteOpen: false, baseTourPending: false, checklistOpen: false, stageHeldByOthers: false, slot: {}, slotBusy: false }
  it('clear: null', () => { expect(offerBlockedBy(clear)).toBeNull() })
  it.each([
    ['prefsLoading', true, 'preferences-loading'],
    ['notesKnown', false, 'notes-unknown'],
    ['noteOpen', true, 'note-open'],
    ['baseTourPending', true, 'base-tour'],
    ['checklistOpen', true, 'checklist-open'],
    ['stageHeldByOthers', true, 'stage-held'],
    ['slot', null, 'no-slot'],
    ['slotBusy', true, 'slot-busy'],
  ])('%s -> waits (%s)', (k, v, reason) => {
    expect(offerBlockedBy({ ...clear, [k]: v })).toBe(reason)
  })
})

describe('the session store', () => {
  beforeEach(() => { __resetOfferSession() })
  afterEach(() => { vi.restoreAllMocks(); __resetOfferSession() })

  it('round-trips through sessionStorage under one key', () => {
    writeOfferSession({ id: 'a', answered: false })
    expect(JSON.parse(window.sessionStorage.getItem(OFFER_SESSION_KEY))).toEqual({ id: 'a', answered: false })
    expect(readOfferSession()).toEqual({ id: 'a', answered: false })
  })

  it('a store that THROWS falls back to page memory -- the cap still holds for this load', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readOfferSession()).toBeNull()
    writeOfferSession({ id: 'a', answered: true })
    expect(readOfferSession()).toEqual({ id: 'a', answered: true })
  })

  it('garbage in the store reads as no session', () => {
    window.sessionStorage.setItem(OFFER_SESSION_KEY, 'not json')
    expect(readOfferSession()).toBeNull()
  })
})
