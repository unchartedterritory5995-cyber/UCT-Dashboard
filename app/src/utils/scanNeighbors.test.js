import { describe, it, expect } from 'vitest'
import { scanNeighbors, jumpTarget, jumpStride, strideTarget } from './scanNeighbors'

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

// ⭐ (2026-11-25 wide sweep) A member JUMPING through a list (scroll, then a click 20 rows on, again and again) outran
// the urgent next-row warm, which warms the row after the selection only. The jump's own stride, in its own direction,
// names the row the next jump most likely lands on.
describe('jumpTarget', () => {
  it('a jump down by 3 names the row 3 further down', () => {
    expect(jumpTarget(L, 5, 2)).toBe('I')
  })
  it('a jump up by 3 names the row 3 further up', () => {
    expect(jumpTarget(L, 4, 7)).toBe('B')
  })
  it('wrap-aware, like the nav: the shortest way round is the stride', () => {
    expect(jumpTarget(L, 1, 8)).toBe('E')                 // 8 -> 1 is +3 through the end
    expect(jumpTarget(L, 8, 1)).toBe('F')                 // 1 -> 8 is -3 through the start
  })
  it('a step of one row is no jump (the next-row warm has it), and neither is the first selection', () => {
    expect(jumpTarget(L, 3, 2)).toBeNull()
    expect(jumpTarget(L, 2, 3)).toBeNull()
    expect(jumpTarget(L, 3, -1)).toBeNull()
    expect(jumpTarget(L, 3, 3)).toBeNull()
  })
  it('never the selected row itself, and nothing on a list too short to jump in', () => {
    expect(jumpTarget(['A', 'B', 'C', 'D'], 2, 0)).toBeNull()   // +2 on 4 rows lands back on the start
    expect(jumpTarget(['A', 'B'], 1, 0)).toBeNull()
  })
})

// (2026-11-26) the stride a jump landed with, and the row one stride further: what a re-run for the same selection keeps
it('jumpStride is the signed shorter-way stride of a jump, 0 for no jump', () => {
  const flat = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
  expect(jumpStride(flat, 5, 2)).toBe(3)
  expect(jumpStride(flat, 2, 5)).toBe(-3)
  expect(jumpStride(flat, 1, 8)).toBe(3)        // wrap: 8 -> 1 is three rows down, not seven up
  expect(jumpStride(flat, 3, 2)).toBe(0)        // one row on is no jump
  expect(jumpStride(flat, 3, 3)).toBe(0)
  expect(jumpStride(flat, 3, -1)).toBe(0)
  expect(jumpStride(['A', 'B'], 1, 0)).toBe(0)
})

it('strideTarget is the row one stride on (wrap-aware), null for no stride or the row itself', () => {
  const flat = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
  expect(strideTarget(flat, 5, 3)).toBe('I')
  expect(strideTarget(flat, 8, 3)).toBe('B')
  expect(strideTarget(flat, 1, -3)).toBe('I')
  expect(strideTarget(flat, 5, 0)).toBe(null)
  expect(strideTarget(flat, 5, 10)).toBe(null)  // a whole lap lands on the row itself
  expect(strideTarget(flat, -1, 3)).toBe(null)
})
