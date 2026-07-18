// app/src/pages/charts/grid/groupRecents.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { pushRecent, getRecents, neighborGroup } from './groupRecents'

beforeEach(() => localStorage.clear())

describe('groupRecents', () => {
  it('pushRecent de-dupes, most-recent-first, caps at 6', () => {
    pushRecent('a'); pushRecent('b'); pushRecent('a')
    expect(getRecents()).toEqual(['a', 'b'])
    for (const id of ['c', 'd', 'e', 'f', 'g']) pushRecent(id)
    expect(getRecents()).toHaveLength(6)
    expect(getRecents()[0]).toBe('g')
  })
  it('neighborGroup steps and wraps', () => {
    const list = [{ id: 'x' }, { id: 'y' }, { id: 'z' }]
    expect(neighborGroup(list, 'y', 1)).toBe('z')
    expect(neighborGroup(list, 'y', -1)).toBe('x')
    expect(neighborGroup(list, 'z', 1)).toBe('x')   // wraps
    expect(neighborGroup(list, 'x', -1)).toBe('z')  // wraps
    expect(neighborGroup(list, 'missing', 1)).toBe('x')
  })
})
