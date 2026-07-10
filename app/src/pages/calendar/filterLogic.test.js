// app/src/pages/calendar/filterLogic.test.js
import { describe, it, expect } from 'vitest'
import { applyFilters, sortEntries, DEFAULT_FILTERS } from './filterLogic'

const rows = [
  { sym: 'AAA', mine: true,  mc_b: 5,  expected_move: { pct: 3 }, _avg_vol: 2_000_000, _price: 50 },
  { sym: 'BBB', mine: false, mc_b: 50, expected_move: { pct: 9 }, _avg_vol: 500_000,   _price: 200 },
  { sym: 'CCC', mine: false, mc_b: 0.1, expected_move: null,      _avg_vol: 100_000,   _price: 8 },
  // Row with no metrics (null) — should always pass metric filters (null-safe passthrough)
  { sym: 'DDD', mine: false, mc_b: null, expected_move: null,     _avg_vol: null,      _price: null },
]

describe('filterLogic', () => {
  it('audience=mine keeps only mine', () => {
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, audience: 'mine' })
    expect(out.map(r => r.sym)).toEqual(['AAA'])
  })

  it('minMcap drops sub-threshold names', () => {
    // audience:'all' isolates the market-cap filter from the default mine filter
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, audience: 'all', minMcap: 1 })
    // CCC has mc_b=0.1, DDD has mc_b=null (unknown → let through)
    expect(out.map(r => r.sym)).toContain('AAA')
    expect(out.map(r => r.sym)).toContain('BBB')
    expect(out.map(r => r.sym)).not.toContain('CCC')
    expect(out.map(r => r.sym)).toContain('DDD')
  })

  it('sort by expected move desc, nulls last', () => {
    const out = sortEntries(rows, 'move')
    expect(out.map(r => r.sym)).toEqual(['BBB', 'AAA', 'CCC', 'DDD'])
  })

  it('sort mine-first keeps mine ahead', () => {
    const out = sortEntries(rows, 'mine')
    expect(out[0].sym).toBe('AAA')
  })

  // A3: minAvgVol tests
  it('minAvgVol filters rows below threshold', () => {
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, audience: 'all', minAvgVol: 1_000_000 })
    expect(out.map(r => r.sym)).toContain('AAA')      // 2M ≥ 1M ✓
    expect(out.map(r => r.sym)).not.toContain('BBB')  // 500K < 1M ✗
    expect(out.map(r => r.sym)).not.toContain('CCC')  // 100K < 1M ✗
    expect(out.map(r => r.sym)).toContain('DDD')      // null → passthrough ✓
  })

  it('minAvgVol=null or 0 passes all rows', () => {
    const out1 = applyFilters(rows, { ...DEFAULT_FILTERS, audience: 'all', minAvgVol: null })
    const out2 = applyFilters(rows, { ...DEFAULT_FILTERS, audience: 'all', minAvgVol: 0 })
    expect(out1).toHaveLength(4)
    expect(out2).toHaveLength(4)
  })

  // A3: priceMin tests
  it('priceMin filters rows below threshold', () => {
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, audience: 'all', priceMin: 20 })
    expect(out.map(r => r.sym)).toContain('AAA')      // $50 ≥ $20 ✓
    expect(out.map(r => r.sym)).toContain('BBB')      // $200 ≥ $20 ✓
    expect(out.map(r => r.sym)).not.toContain('CCC')  // $8 < $20 ✗
    expect(out.map(r => r.sym)).toContain('DDD')      // null → passthrough ✓
  })

  it('priceMin=null passes all rows', () => {
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, audience: 'all', priceMin: null })
    expect(out).toHaveLength(4)
  })

  // A3: priceMax tests
  it('priceMax filters rows above threshold', () => {
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, audience: 'all', priceMax: 100 })
    expect(out.map(r => r.sym)).toContain('AAA')      // $50 ≤ $100 ✓
    expect(out.map(r => r.sym)).not.toContain('BBB')  // $200 > $100 ✗
    expect(out.map(r => r.sym)).toContain('CCC')      // $8 ≤ $100 ✓
    expect(out.map(r => r.sym)).toContain('DDD')      // null → passthrough ✓
  })

  it('priceMax=null passes all rows', () => {
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, audience: 'all', priceMax: null })
    expect(out).toHaveLength(4)
  })

  // A3: combined filter test
  it('combined minAvgVol + priceMin + priceMax filters correctly', () => {
    const out = applyFilters(rows, {
      ...DEFAULT_FILTERS, audience: 'all',
      minAvgVol: 400_000, priceMin: 10, priceMax: 150,
    })
    // AAA: vol=2M✓ price=50✓ → keep
    // BBB: vol=500K✓ price=200>150✗ → drop
    // CCC: vol=100K<400K✗ → drop
    // DDD: all null → passthrough ✓
    expect(out.map(r => r.sym)).toContain('AAA')
    expect(out.map(r => r.sym)).not.toContain('BBB')
    expect(out.map(r => r.sym)).not.toContain('CCC')
    expect(out.map(r => r.sym)).toContain('DDD')
  })

  // 5a: confirmed-dates-only drops estimate-dated reporters
  it('confirmedOnly drops rows flagged date_est', () => {
    const dated = [
      { sym: 'AAA', mine: false, date_est: false },
      { sym: 'BBB', mine: false, date_est: true },
      { sym: 'CCC', mine: false },   // no flag → treated as confirmed
    ]
    const out = applyFilters(dated, { ...DEFAULT_FILTERS, audience: 'all', confirmedOnly: true })
    expect(out.map(r => r.sym)).toEqual(['AAA', 'CCC'])
  })

  // 5c: sector scoping — strict match, drops names in other/unknown sectors
  it('sector filter keeps only the chosen sector (strict)', () => {
    const sectored = [
      { sym: 'AAA', mine: false, sector: 'Technology' },
      { sym: 'BBB', mine: false, sector: 'Financials' },
      { sym: 'CCC', mine: false },   // unresolved sector → not offered under any chip
    ]
    const out = applyFilters(sectored, { ...DEFAULT_FILTERS, audience: 'all', sector: 'Technology' })
    expect(out.map(r => r.sym)).toEqual(['AAA'])
  })

  it('sector=null keeps every sector', () => {
    const sectored = [
      { sym: 'AAA', mine: false, sector: 'Technology' },
      { sym: 'BBB', mine: false, sector: 'Financials' },
    ]
    const out = applyFilters(sectored, { ...DEFAULT_FILTERS, audience: 'all', sector: null })
    expect(out).toHaveLength(2)
  })
})
