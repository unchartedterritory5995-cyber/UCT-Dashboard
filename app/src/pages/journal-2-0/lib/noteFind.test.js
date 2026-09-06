import { describe, it, expect } from 'vitest'
import { findMatchesInDoc, nextMatchIndex, prevMatchIndex } from './noteFind'

// A minimal fake ProseMirror doc -- only `descendants(fn)` is used by
// findMatchesInDoc, so a real schema/Node instance isn't needed for these
// unit tests. `pos` mirrors ProseMirror's absolute text-node start offset.
function fakeDoc(textNodes) {
  return {
    descendants(fn) {
      for (const n of textNodes) fn({ isText: true, text: n.text }, n.pos)
    },
  }
}

describe('findMatchesInDoc', () => {
  it('returns no matches for an empty/whitespace term', () => {
    const doc = fakeDoc([{ text: 'the capex thesis', pos: 0 }])
    expect(findMatchesInDoc(doc, '')).toEqual([])
    expect(findMatchesInDoc(doc, '   ')).toEqual([])
  })

  it('is case-insensitive', () => {
    const doc = fakeDoc([{ text: 'NVDA is extended', pos: 0 }])
    expect(findMatchesInDoc(doc, 'nvda')).toEqual([{ from: 0, to: 4 }])
  })

  it('finds multiple matches within one text node', () => {
    const doc = fakeDoc([{ text: 'buy buy buy', pos: 0 }])
    expect(findMatchesInDoc(doc, 'buy')).toEqual([
      { from: 0, to: 3 }, { from: 4, to: 7 }, { from: 8, to: 11 },
    ])
  })

  it('matches are non-overlapping', () => {
    const doc = fakeDoc([{ text: 'aaaa', pos: 0 }])
    // "aa" in "aaaa" -> 2 non-overlapping matches (0-2, 2-4), not 3.
    expect(findMatchesInDoc(doc, 'aa')).toEqual([{ from: 0, to: 2 }, { from: 2, to: 4 }])
  })

  it('accumulates absolute positions across multiple text nodes', () => {
    const doc = fakeDoc([
      { text: 'the thesis', pos: 0 },
      { text: 'is a thesis', pos: 20 },
    ])
    const matches = findMatchesInDoc(doc, 'thesis')
    expect(matches).toEqual([{ from: 4, to: 10 }, { from: 25, to: 31 }])
  })

  it('a term matching nothing returns an empty array', () => {
    const doc = fakeDoc([{ text: 'the capex thesis', pos: 0 }])
    expect(findMatchesInDoc(doc, 'zzz')).toEqual([])
  })

  it('non-text nodes (isText: false) are skipped without throwing', () => {
    const doc = {
      descendants(fn) {
        fn({ isText: false }, 0) // e.g. a widget embed node
        fn({ isText: true, text: 'thesis' }, 5)
      },
    }
    expect(findMatchesInDoc(doc, 'thesis')).toEqual([{ from: 5, to: 11 }])
  })

  it('trims and lowercases the search term before matching', () => {
    const doc = fakeDoc([{ text: 'NVDA breakout', pos: 0 }])
    expect(findMatchesInDoc(doc, '  NVDA  ')).toEqual([{ from: 0, to: 4 }])
  })
})

describe('nextMatchIndex / prevMatchIndex', () => {
  it('nextMatchIndex wraps from the last match back to the first', () => {
    expect(nextMatchIndex(3, 0)).toBe(1)
    expect(nextMatchIndex(3, 1)).toBe(2)
    expect(nextMatchIndex(3, 2)).toBe(0)
  })

  it('prevMatchIndex wraps from the first match back to the last', () => {
    expect(prevMatchIndex(3, 1)).toBe(0)
    expect(prevMatchIndex(3, 0)).toBe(2)
  })

  it('both return -1 when there are no matches', () => {
    expect(nextMatchIndex(0, -1)).toBe(-1)
    expect(prevMatchIndex(0, -1)).toBe(-1)
  })
})
