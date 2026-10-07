// @vitest-environment node
// Per-tour seen-state (wave 14, lane W14-0): the read side, and the R8 merge rule
// `recordTourState` leans on `setPrefMerged` for. The merge rule ITSELF is proved
// here with a fake `setPrefMerged` that behaves exactly like the real one (reads
// the current cache value, computes, writes once) -- the full wiring through the
// real hook and a real fetch is `GenericTourEngine.test.jsx`'s job.
import { describe, it, expect, vi } from 'vitest'
import {
  TOURS_PREF, TOUR_STATES, readToursPref, readTourState, tourFinished, recordTourState,
} from './tourSeenState'

describe('readToursPref', () => {
  it('parses a JSON string, defaults to {} for anything else', () => {
    expect(readToursPref(JSON.stringify({ a: { v: 1, state: 'done', step: null } })))
      .toEqual({ a: { v: 1, state: 'done', step: null } })
    expect(readToursPref(undefined)).toEqual({})
    expect(readToursPref(null)).toEqual({})
    expect(readToursPref('not json')).toEqual({})
    expect(readToursPref(JSON.stringify(['array', 'not', 'object']))).toEqual({})
    expect(readToursPref(42)).toEqual({})
  })
})

describe('readTourState', () => {
  const raw = JSON.stringify({
    'tour-a': { v: 1, state: 'started', step: 's2' },
    'tour-b': { v: 1, state: 'done', step: null },
    'tour-c': 'not an object',
  })
  it('returns one tour\'s row when it is shaped correctly', () => {
    expect(readTourState(raw, 'tour-a')).toEqual({ v: 1, state: 'started', step: 's2' })
    expect(readTourState(raw, 'tour-b')).toEqual({ v: 1, state: 'done', step: null })
  })
  it('null for a missing tour, or a malformed row', () => {
    expect(readTourState(raw, 'tour-x')).toBeNull()
    expect(readTourState(raw, 'tour-c')).toBeNull()
  })
})

describe('tourFinished', () => {
  it('done and dismissed are finished; started and unknown are not', () => {
    expect(tourFinished(TOUR_STATES.done)).toBe(true)
    expect(tourFinished(TOUR_STATES.dismissed)).toBe(true)
    expect(tourFinished(TOUR_STATES.started)).toBe(false)
    expect(tourFinished(null)).toBe(false)
    expect(tourFinished(undefined)).toBe(false)
  })
})

/** A fake `setPrefMerged` carrying the SAME contract the real `usePreferences()`
 *  hook promises (usePreferences.js): `updater(current)` runs against whatever
 *  the shared store holds RIGHT NOW, and the result replaces it in one step --
 *  so two calls in a row see each other's writes, exactly as two browser tabs
 *  racing through the real hook's SWR cache would. */
function fakeStore(initial = {}) {
  const store = { ...initial }
  const setPrefMerged = vi.fn(async (key, updater) => {
    const current = store[key]
    const next = updater(current)
    if (next === undefined) return
    store[key] = typeof next === 'string' ? next : JSON.stringify(next)
  })
  return { store, setPrefMerged }
}

describe('recordTourState — the R8 merge rule', () => {
  it('writes a brand-new tour\'s row under the SHARED key', async () => {
    const { store, setPrefMerged } = fakeStore()
    await recordTourState(setPrefMerged, 'tour-a', TOUR_STATES.started, 'step-1')
    expect(setPrefMerged).toHaveBeenCalledWith(TOURS_PREF, expect.any(Function))
    expect(readToursPref(store[TOURS_PREF])).toEqual({
      'tour-a': { v: 1, state: TOUR_STATES.started, step: 'step-1' },
    })
  })

  it('⛔⛔ RISK R8: writing tour B does not touch tour A\'s already-recorded row', async () => {
    const { store, setPrefMerged } = fakeStore({
      [TOURS_PREF]: JSON.stringify({ 'tour-a': { v: 1, state: TOUR_STATES.done, step: 'last' } }),
    })
    await recordTourState(setPrefMerged, 'tour-b', TOUR_STATES.started, 'first')
    expect(readToursPref(store[TOURS_PREF])).toEqual({
      'tour-a': { v: 1, state: TOUR_STATES.done, step: 'last' },        // untouched
      'tour-b': { v: 1, state: TOUR_STATES.started, step: 'first' },
    })
  })

  it('a step of null is stored as null (dismissed with no current step)', async () => {
    const { store, setPrefMerged } = fakeStore()
    await recordTourState(setPrefMerged, 'tour-a', TOUR_STATES.dismissed, undefined)
    expect(readToursPref(store[TOURS_PREF])['tour-a']).toEqual({ v: 1, state: TOUR_STATES.dismissed, step: null })
  })

  it('CONTROL: a blind (non-merging) write WOULD lose the sibling row -- proving the test can fail', async () => {
    const { store } = fakeStore({
      [TOURS_PREF]: JSON.stringify({ 'tour-a': { v: 1, state: TOUR_STATES.done, step: 'last' } }),
    })
    // the blind shape R8 warns against: {[tourId]: {...}} with no spread of the base
    const blindSetPrefMerged = async (key, updater) => {
      const current = store[key]
      const base = readToursPref(current)
      const patched = { [Object.keys({ 'tour-b': 1 })[0]]: { v: 1, state: 'started', step: 'first' } }
      void base // the blind writer ignores it on purpose, to demonstrate the loss
      store[key] = JSON.stringify(patched)
      void updater
    }
    await recordTourState(blindSetPrefMerged, 'tour-b', TOUR_STATES.started, 'first')
    expect(readToursPref(store[TOURS_PREF])).toEqual({ 'tour-b': { v: 1, state: 'started', step: 'first' } })
    expect(readToursPref(store[TOURS_PREF])['tour-a']).toBeUndefined() // the loss R8 exists to prevent
  })
})
