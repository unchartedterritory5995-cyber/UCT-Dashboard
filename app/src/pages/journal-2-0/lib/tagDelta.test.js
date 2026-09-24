// Wave 6 items 9 + 12 — a tag change is a DELTA applied to the server's list.
import { describe, it, expect } from 'vitest'
import { mergeTagDelta, sameTagList } from './tagDelta'

describe('mergeTagDelta', () => {
  it('adds to the END of the list it is given, keeping every tag it did not touch', () => {
    expect(mergeTagDelta(['a', 'bulk-added'], { add: ['mine'] })).toEqual(['a', 'bulk-added', 'mine'])
  })

  it('removes by identity (tag_key: normalised, lower-cased), keeping the rest in order', () => {
    expect(mergeTagDelta(['Research', 'b', 'c'], { remove: ['research'] })).toEqual(['b', 'c'])
    expect(mergeTagDelta(['a / b', 'c'], { remove: ['a/b'] })).toEqual(['c'])
  })

  it('never adds a tag the list already has under another spelling, and normalises what it adds', () => {
    expect(mergeTagDelta(['Research/Semis'], { add: ['research/semis'] })).toEqual(['Research/Semis'])
    expect(mergeTagDelta([], { add: [' research / semis '] })).toEqual(['research/semis'])
    expect(mergeTagDelta([], { add: ['', '  ', '/'] })).toEqual([])
  })

  it('drops duplicates already in the base (the server list is the truth, once each)', () => {
    expect(mergeTagDelta(['a', 'A', 'b'], {})).toEqual(['a', 'b'])
  })
})

describe('sameTagList', () => {
  it('compares identities in order', () => {
    expect(sameTagList(['A', 'b'], ['a', 'B'])).toBe(true)
    expect(sameTagList(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(sameTagList(['a'], ['a', 'b'])).toBe(false)
    expect(sameTagList([], null)).toBe(true)
  })
})
