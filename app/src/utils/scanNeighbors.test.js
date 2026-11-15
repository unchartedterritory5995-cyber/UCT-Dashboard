import { describe, it, expect } from 'vitest'
import { scanNeighbors } from './scanNeighbors'

const L = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
describe('scanNeighbors', () => {
  it('walking DOWN: the next rows first, nearest first, then a couple behind', () => {
    expect(scanNeighbors(L, 2, 1, { ahead: 3, behind: 2 })).toEqual(['D', 'E', 'F', 'B', 'A'])
  })
  it('walking UP: the rows above first', () => {
    expect(scanNeighbors(L, 5, -1, { ahead: 3, behind: 1 })).toEqual(['E', 'D', 'C', 'G'])
  })
  it('wraps at both ends like the nav, never returns the current row, dedupes short lists', () => {
    expect(scanNeighbors(L, 9, 1, { ahead: 2, behind: 1 })).toEqual(['A', 'B', 'I'])
    expect(scanNeighbors(['A', 'B', 'C'], 0, 1, { ahead: 6, behind: 2 })).toEqual(['B', 'C'])
  })
  it('nothing to warm for a missing row or a 1-row list', () => {
    expect(scanNeighbors(L, -1, 1)).toEqual([])
    expect(scanNeighbors(['A'], 0, 1)).toEqual([])
  })
})
