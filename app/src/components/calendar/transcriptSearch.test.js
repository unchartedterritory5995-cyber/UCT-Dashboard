import { describe, it, expect } from 'vitest'
import { findMatches, segmentsWithMatches, stepIndex } from './transcriptSearch'

const SEGS = [
  { speaker: 'Operator', content: 'Welcome to the call. Our first question please.' },
  { speaker: 'Hugh Johnston', content: 'We expect margin expansion and margin leverage.' },
  { speaker: 'Benjamin Daniel Swinburne, C.F.A.', content: 'What about ESPN?' },
  { speaker: 'Josh D’Amaro', content: 'Experiences revenue hit a record.' },
]

describe('findMatches', () => {
  it('returns nothing for an empty or whitespace query', () => {
    expect(findMatches(SEGS, '')).toEqual([])
    expect(findMatches(SEGS, '   ')).toEqual([])
  })

  it('finds every occurrence, including two in one segment', () => {
    const m = findMatches(SEGS, 'margin')
    expect(m).toHaveLength(2)
    expect(m.every(x => x.segIndex === 1)).toBe(true)
    expect(m[0].start).toBeLessThan(m[1].start)
  })

  it('is case-insensitive', () => {
    expect(findMatches(SEGS, 'ESPN')).toHaveLength(1)
    expect(findMatches(SEGS, 'espn')).toHaveLength(1)
  })

  it('searches SPEAKER names, not just content', () => {
    // The reported complaint was that searching the transcript "does not work
    // properly" — looking for who said something is half of what a reader wants.
    const m = findMatches(SEGS, 'Swinburne')
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ segIndex: 2, field: 'speaker' })
  })

  it('orders matches in reading order across segments and fields', () => {
    const m = findMatches(SEGS, 'e')
    const keys = m.map(x => [x.segIndex, x.field === 'speaker' ? 0 : 1, x.start])
    const sorted = [...keys].sort((a, b) =>
      a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
    expect(keys).toEqual(sorted)
  })

  it('treats regex metacharacters as literal text', () => {
    const segs = [{ speaker: '', content: 'Free cash flow (FCF) rose 12%.' }]
    expect(findMatches(segs, '(FCF)')).toHaveLength(1)
    expect(findMatches(segs, '12%')).toHaveLength(1)
    expect(() => findMatches(segs, '(')).not.toThrow()
    expect(findMatches(segs, '.')).toHaveLength(1)   // the literal period, not "any char"
  })

  it('never loops forever on a zero-width pattern', () => {
    expect(findMatches(SEGS, '​')).toEqual([])
  })

  it('tolerates missing speaker or content fields', () => {
    const ragged = [{ content: 'only content' }, { speaker: 'only speaker' }, {}]
    expect(() => findMatches(ragged, 'only')).not.toThrow()
    expect(findMatches(ragged, 'only')).toHaveLength(2)
  })
})

describe('stepIndex', () => {
  it('advances and retreats', () => {
    expect(stepIndex(0, 5, 1)).toBe(1)
    expect(stepIndex(3, 5, -1)).toBe(2)
  })

  it('wraps in BOTH directions — the last hit is adjacent to the first', () => {
    expect(stepIndex(4, 5, 1)).toBe(0)
    expect(stepIndex(0, 5, -1)).toBe(4)   // JS % alone would give -1 here
  })

  it('is safe with no matches at all', () => {
    expect(stepIndex(0, 0, 1)).toBe(0)
    expect(stepIndex(0, 0, -1)).toBe(0)
  })
})

describe('segmentsWithMatches', () => {
  it('is the set of segment indices carrying at least one match', () => {
    expect(segmentsWithMatches(findMatches(SEGS, 'margin'))).toEqual(new Set([1]))
    expect(segmentsWithMatches(findMatches(SEGS, 'record'))).toEqual(new Set([3]))
    expect(segmentsWithMatches([])).toEqual(new Set())
  })

  it('counts a segment once even when it holds several matches', () => {
    const s = segmentsWithMatches(findMatches(SEGS, 'margin'))
    expect(s.size).toBe(1)
  })
})
