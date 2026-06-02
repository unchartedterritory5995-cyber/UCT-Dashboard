// app/src/pages/calendar/filterLogic.test.js
import { describe, it, expect } from 'vitest'
import { applyFilters, sortEntries, DEFAULT_FILTERS } from './filterLogic'

const rows = [
  { sym: 'AAA', mine: true,  mc_b: 5,  expected_move: { pct: 3 } },
  { sym: 'BBB', mine: false, mc_b: 50, expected_move: { pct: 9 } },
  { sym: 'CCC', mine: false, mc_b: 0.1, expected_move: null },
]

describe('filterLogic', () => {
  it('audience=mine keeps only mine', () => {
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, audience: 'mine' })
    expect(out.map(r => r.sym)).toEqual(['AAA'])
  })

  it('minMcap drops sub-threshold names', () => {
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, minMcap: 1 })
    expect(out.map(r => r.sym)).toEqual(['AAA', 'BBB'])
  })

  it('sort by expected move desc, nulls last', () => {
    const out = sortEntries(rows, 'move')
    expect(out.map(r => r.sym)).toEqual(['BBB', 'AAA', 'CCC'])
  })

  it('sort mine-first keeps mine ahead', () => {
    const out = sortEntries(rows, 'mine')
    expect(out[0].sym).toBe('AAA')
  })
})
