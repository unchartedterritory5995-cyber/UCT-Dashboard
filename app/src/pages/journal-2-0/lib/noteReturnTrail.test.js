// Wave 10 lane D2, fix round 1 (I-1): the trail "Back to notes" walks, one router
// navigation at a time. The rendered half is tabs/NotebookTab.phoneNote.test.jsx.
import { describe, it, expect } from 'vitest'
import { stepTrail, stepsBackToList } from './noteReturnTrail'

const push = (t, key, o = {}) => stepTrail(t, { type: 'PUSH', key, noteOpen: true, fromList: false, ...o })

describe('noteReturnTrail', () => {
  it('openNote from a list starts the trail one entry deep', () => {
    const t = push(null, 'a', { fromList: true })
    expect(stepsBackToList(t, 'a')).toBe(1)
  })

  it('a same-note push goes one deeper; a replace keeps the depth under a new key', () => {
    let t = push(null, 'a', { fromList: true })
    t = push(t, 'b')
    expect(stepsBackToList(t, 'b')).toBe(2)
    t = stepTrail(t, { type: 'REPLACE', key: 'c', noteOpen: true, fromList: false })
    expect(stepsBackToList(t, 'c')).toBe(2)
  })

  it('a POP back inside the trail moves the position; a POP to an unknown entry forgets it', () => {
    let t = push(push(null, 'a', { fromList: true }), 'b')
    t = stepTrail(t, { type: 'POP', key: 'a', noteOpen: true, fromList: false })
    expect(stepsBackToList(t, 'a')).toBe(1)
    // a push after going back drops the forward entries, as history does
    t = push(t, 'x')
    expect(t.keys).toEqual(['a', 'x'])
    expect(stepTrail(t, { type: 'POP', key: 'zz', noteOpen: true, fromList: false })).toBeNull()
  })

  it('no list under the note (a pasted link) -> no trail -> 0 (close instead)', () => {
    expect(push(null, 'b')).toBeNull()
    expect(stepsBackToList(null, 'b')).toBe(0)
  })

  it('any navigation that shows the list ends the trail', () => {
    const t = push(null, 'a', { fromList: true })
    expect(stepTrail(t, { type: 'POP', key: 'list', noteOpen: false, fromList: false })).toBeNull()
  })

  it('a stale key (the trail is not where the member is) -> 0', () => {
    const t = push(null, 'a', { fromList: true })
    expect(stepsBackToList(t, 'other')).toBe(0)
  })
})
