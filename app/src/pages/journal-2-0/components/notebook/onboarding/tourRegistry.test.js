// @vitest-environment node
// The tour registry (wave 14, lane W14-0): shape, the base entry's zero-drift
// contract, and the two lookup helpers Help and the generic engine use.
import { describe, it, expect } from 'vitest'
import { TOUR_STEPS } from './tourSteps'
import { TOUR_STEP_COPY } from './tourCopy'
import { TOUR_START_STATE } from './tourControl'
import {
  BASE_TOUR_ID, TOUR_REGISTRY, getTourEntry, replayableTours, startState,
} from './tourRegistry'

describe('the registry itself', () => {
  it('is frozen, non-empty, and every entry has exactly these fields', () => {
    expect(Object.isFrozen(TOUR_REGISTRY)).toBe(true)
    expect(TOUR_REGISTRY.length).toBeGreaterThan(0)
    for (const t of TOUR_REGISTRY) {
      expect(Object.isFrozen(t), `${t.id} is not frozen`).toBe(true)
      expect(Object.keys(t).sort()).toEqual(['flag', 'id', 'load', 'replayable', 'title'])
      expect(typeof t.id).toBe('string')
      expect(typeof t.flag).toBe('string')
      expect(typeof t.title).toBe('string')
      expect(typeof t.replayable).toBe('boolean')
      expect(typeof t.load).toBe('function')
    }
  })

  it('ids are unique', () => {
    const ids = TOUR_REGISTRY.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('the base tour is entry 1, pointed at the real, unchanged flag and title', () => {
    const base = TOUR_REGISTRY[0]
    expect(base.id).toBe(BASE_TOUR_ID)
    expect(base.id).toBe('notebook-basics')
    expect(base.flag).toBe('notebook_onboarding_enabled')
    expect(base.replayable).toBe(true)
  })
})

describe('the base entry describes the real tour WITHOUT reimplementing it (zero drift)', () => {
  it('load() resolves to the SAME TOUR_STEPS and TOUR_STEP_COPY exports the real tour reads', async () => {
    const base = getTourEntry(BASE_TOUR_ID)
    const { steps, copy } = await base.load()
    // reference equality, not a deep-equal copy -- a change to tourSteps.js/tourCopy.js
    // is seen here automatically; nothing here can go stale on its own
    expect(steps).toBe(TOUR_STEPS)
    expect(copy).toBe(TOUR_STEP_COPY)
  })
})

describe('getTourEntry', () => {
  it('finds an entry by id, in a registry handed in (so a test never touches the real one)', () => {
    const fake = Object.freeze([{ id: 'x', flag: 'f', title: 'X', replayable: true, load: async () => ({}) }])
    expect(getTourEntry('x', fake)).toBe(fake[0])
    expect(getTourEntry('nope', fake)).toBeNull()
  })

  it('defaults to the real TOUR_REGISTRY', () => {
    expect(getTourEntry(BASE_TOUR_ID)?.id).toBe(BASE_TOUR_ID)
  })
})

describe('replayableTours', () => {
  it('returns only replayable entries, in registry order', () => {
    const fake = Object.freeze([
      { id: 'a', replayable: true },
      { id: 'b', replayable: false },
      { id: 'c', replayable: true },
    ])
    expect(replayableTours(fake).map((t) => t.id)).toEqual(['a', 'c'])
  })

  it('the real registry: every entry today is replayable', () => {
    expect(replayableTours().length).toBe(TOUR_REGISTRY.length)
  })
})

describe('startState', () => {
  it('the base tour resolves to the SAME TOUR_START_STATE the existing "Take the tour" link uses', () => {
    expect(startState(BASE_TOUR_ID)).toBe(TOUR_START_STATE)
    expect(startState(getTourEntry(BASE_TOUR_ID))).toBe(TOUR_START_STATE)
  })

  it('any other tour resolves to a startRegistryTourId state, frozen', () => {
    const s = startState('some-other-tour')
    expect(s).toEqual({ startRegistryTourId: 'some-other-tour' })
    expect(Object.isFrozen(s)).toBe(true)
  })

  it('accepts an entry object OR a bare id', () => {
    expect(startState({ id: 'z' })).toEqual({ startRegistryTourId: 'z' })
    expect(startState('z')).toEqual({ startRegistryTourId: 'z' })
  })
})
