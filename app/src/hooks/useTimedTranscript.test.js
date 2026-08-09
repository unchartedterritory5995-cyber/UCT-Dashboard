import { describe, it, expect } from 'vitest'
import { buildWordIndex, wordAt } from './useTimedTranscript'

// Shaped like the live provider response: parallel words[] / starts[] per turn.
const SEGMENTS = [
  { speaker: 1, words: ['Good', 'afternoon', 'everyone'], starts: [0.0, 0.4, 1.0] },
  { speaker: 2, words: ['Thanks', 'operator'], starts: [12.5, 13.1] },
]

describe('word index — flattens turns into one searchable timeline', () => {
  it('keeps every word and its turn:word key', () => {
    const { starts, keys } = buildWordIndex(SEGMENTS)
    expect(starts).toEqual([0.0, 0.4, 1.0, 12.5, 13.1])
    expect(keys).toEqual(['0:0', '0:1', '0:2', '1:0', '1:1'])
  })

  it('survives a transcript with no segments', () => {
    expect(buildWordIndex(null)).toEqual({ starts: [], keys: [] })
    expect(buildWordIndex([])).toEqual({ starts: [], keys: [] })
  })
})

describe('wordAt — which word is being spoken right now', () => {
  const { starts } = buildWordIndex(SEGMENTS)

  it('returns the LAST word at or before the playhead', () => {
    // Binary search, because this runs on every timeupdate (~4x/sec) against
    // a ~6,000-word call; a linear scan would be 24k comparisons a second.
    expect(wordAt(starts, 0.0)).toBe(0)
    expect(wordAt(starts, 0.6)).toBe(1)
    expect(wordAt(starts, 1.0)).toBe(2)
    expect(wordAt(starts, 11.9)).toBe(2)   // still in the gap before turn 2
    expect(wordAt(starts, 12.5)).toBe(3)
    expect(wordAt(starts, 99)).toBe(4)     // past the end: hold on the last word
  })

  it('is -1 before the first word, so nothing highlights at t=0 of silence', () => {
    expect(wordAt([2.0, 3.0], 0)).toBe(-1)
    expect(wordAt([2.0, 3.0], 1.99)).toBe(-1)
  })

  it('never throws on an empty or missing index', () => {
    expect(wordAt([], 5)).toBe(-1)
    expect(wordAt(null, 5)).toBe(-1)
    expect(wordAt(undefined, undefined)).toBe(-1)
  })

  it('agrees with a linear scan across the whole timeline', () => {
    // The property that matters: the fast path must equal the obvious one.
    const many = Array.from({ length: 500 }, (_, i) => i * 0.37)
    const linear = (t) => {
      let ans = -1
      many.forEach((s, i) => { if (s <= t) ans = i })
      return ans
    }
    for (const t of [0, 0.1, 5.55, 37.4, 91.2, 184.9, 1000]) {
      expect(wordAt(many, t)).toBe(linear(t))
    }
  })
})
