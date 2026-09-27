// Wave 10 lane 10B — R-5 / clause 13b: "Best matches", reciprocal-rank fusion
// over the sidebar's already-fetched search sections (lib/bestMatches.js).
import { describe, it, expect } from 'vitest'
import {
  BEST_MATCHES_LIMIT, KIND_EXCERPT, KIND_LABEL, KIND_NOTE, KIND_PAGE, KIND_REVIEW, RRF_K,
  bestMatchesCountText, fuseBestMatches, kindsWithHits, rankableCount,
} from './bestMatches'

const note = (id, extra = {}) => ({ id, title: id, ...extra })
const page = (d, p) => ({ documentId: d, pageNumber: p, noteId: 'n' })
const excerpt = (id) => ({ excerptId: id, noteId: 'n' })
const review = (id) => ({ reviewId: id, noteId: 'n' })
const keys = (fused) => fused.map((f) => f.key)

const LISTS = {
  [KIND_NOTE]: [note('n1'), note('n2'), note('n3')],
  [KIND_PAGE]: [page('d1', 4), page('d1', 9)],
  [KIND_EXCERPT]: [excerpt('e1')],
  [KIND_REVIEW]: [],
}

describe('fuseBestMatches — reciprocal-rank fusion, never concatenation', () => {
  it('the best hit of EVERY kind outranks the second-best of any kind', () => {
    expect(keys(fuseBestMatches(LISTS))).toEqual([
      'note:n1', 'excerpt:e1', 'page:d1-4', // every kind's #1, member-kept before raw on the tie
      'note:n2', 'page:d1-9',               // then every kind's #2
    ])
  })

  it('CONTROL: a concatenation would have buried the saved excerpt and the document', () => {
    const concat = [...LISTS[KIND_NOTE], ...LISTS[KIND_PAGE], ...LISTS[KIND_EXCERPT]].slice(0, 5)
    expect(concat.map((x) => x.id || x.excerptId || `${x.documentId}-${x.pageNumber}`))
      .toEqual(['n1', 'n2', 'n3', 'd1-4', 'd1-9'])
    expect(keys(fuseBestMatches(LISTS))).not.toContain('note:n3')
    expect(keys(fuseBestMatches(LISTS))).toContain('excerpt:e1')
  })

  it('scores are 1 / (k + rank) with k = 60, from the position in the item\'s own list', () => {
    const fused = fuseBestMatches(LISTS)
    const byKey = Object.fromEntries(fused.map((f) => [f.key, f]))
    expect(RRF_K).toBe(60)
    expect(byKey['note:n1'].score).toBeCloseTo(1 / 61)
    expect(byKey['page:d1-9'].score).toBeCloseTo(1 / 62)
    expect(byKey['page:d1-9'].rank).toBe(2)
  })

  it('stops at the limit (5 by default)', () => {
    const many = { [KIND_NOTE]: Array.from({ length: 9 }, (_, i) => note(`n${i}`)),
                   [KIND_PAGE]: Array.from({ length: 9 }, (_, i) => page('d', i)) }
    expect(fuseBestMatches(many)).toHaveLength(BEST_MATCHES_LIMIT)
    expect(fuseBestMatches(many, { limit: 3 })).toHaveLength(3)
  })

  it('a thesis review ties before a document page, after a note and an excerpt', () => {
    const fused = fuseBestMatches({
      [KIND_PAGE]: [page('d', 1)], [KIND_REVIEW]: [review('r1')],
      [KIND_EXCERPT]: [excerpt('e1')], [KIND_NOTE]: [note('n1')],
    })
    expect(fused.map((f) => f.kind)).toEqual([KIND_NOTE, KIND_EXCERPT, KIND_REVIEW, KIND_PAGE])
  })

  it('leaves out a row the meaning search appended (it matched no word)', () => {
    const fused = fuseBestMatches({
      [KIND_NOTE]: [note('n1'), note('m1', { matchKind: 'meaning' })],
      [KIND_PAGE]: [page('d', 1)],
    })
    expect(keys(fused)).toEqual(['note:n1', 'page:d-1'])
  })

  it('every kind has a label', () => {
    for (const k of [KIND_NOTE, KIND_EXCERPT, KIND_REVIEW, KIND_PAGE]) expect(KIND_LABEL[k]).toBeTruthy()
  })
})

describe('the counts are honest', () => {
  it('counts only rankable rows the sections list', () => {
    expect(rankableCount(LISTS)).toBe(6)
    expect(rankableCount({ [KIND_NOTE]: [note('n1'), note('m', { matchKind: 'meaning' })] })).toBe(1)
    expect(kindsWithHits(LISTS)).toBe(3)
    expect(kindsWithHits({ [KIND_NOTE]: [note('m', { matchKind: 'meaning' })], [KIND_PAGE]: [page('d', 1)] }))
      .toBe(1)
  })

  it('says "top N of the M results below", or "all M" when it shows them all', () => {
    expect(bestMatchesCountText(5, 23)).toBe('Best matches · top 5 of the 23 results below')
    expect(bestMatchesCountText(3, 3)).toBe('Best matches · all 3, best first')
  })
})
