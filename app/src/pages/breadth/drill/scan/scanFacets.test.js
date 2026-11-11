import { describe, it, expect } from 'vitest'
import {
  emptySelection, applyFacets, facetModel, toggleFacet, activeCount, activeChips,
} from './scanFacets'

const rows = [
  { sym: 'AAA', sector: 'Technology', industry: 'Semiconductors', theme: 'AI', pct: 12, price: 80, rvol: 3, rating: 85, mcap: 5e10, a50: 2, repeat: 0, also: ['new_52w_highs_list', 'stage2_list'], nextEarnings: '2026-11-12' },
  { sym: 'BBB', sector: 'Technology', industry: 'Software', theme: 'Cyber', pct: 6, price: 8, rvol: 1.2, rating: 55, mcap: 9e8, a50: -1, repeat: 4, also: ['stage2_list'], nextEarnings: '2027-02-01' },
  { sym: 'CCC', sector: 'Energy', industry: 'Uranium', theme: null, pct: 25, price: 30, rvol: 6, rating: 70, mcap: 3e9, a50: 1, repeat: 1, also: ['new_52w_highs_list'], nextEarnings: null },
  { sym: 'DDD', sector: 'Healthcare', industry: 'Biotech', theme: 'Biotech', pct: 4.5, price: 120, rvol: null, rating: null, mcap: 3e11, a50: null, repeat: null, also: [] },
]
const ctx = { date: '2026-11-06' }
const syms = (rs) => rs.map(r => r.sym)

describe('scan filters', () => {
  it('nothing picked shows everything', () => {
    expect(applyFacets(rows, emptySelection(), ctx)).toHaveLength(4)
  })
  it('options inside a section OR; sections AND', () => {
    let sel = toggleFacet(emptySelection(), 'sector', 'Technology')
    sel = toggleFacet(sel, 'sector', 'Energy')
    expect(syms(applyFacets(rows, sel, ctx))).toEqual(['AAA', 'BBB', 'CCC'])
    sel = toggleFacet(sel, 'mcap', 'large')
    expect(syms(applyFacets(rows, sel, ctx))).toEqual(['AAA'])
  })
  it('signals AND: "New 52-week high" + "Stage 2" means both', () => {
    let sel = toggleFacet(emptySelection(), 'signals', 'new_52w_highs_list')
    expect(syms(applyFacets(rows, sel, ctx))).toEqual(['AAA', 'CCC'])
    sel = toggleFacet(sel, 'signals', 'stage2_list')
    expect(syms(applyFacets(rows, sel, ctx))).toEqual(['AAA'])
  })
  it('row signals: first time, regular, earnings within 2 weeks of the drill day, above the 50-day', () => {
    const one = (k) => syms(applyFacets(rows, toggleFacet(emptySelection(), 'signals', k), ctx))
    expect(one('firstTime')).toEqual(['AAA'])
    expect(one('regular')).toEqual(['BBB'])
    expect(one('earnSoon')).toEqual(['AAA'])
    expect(one('above50')).toEqual(['AAA', 'CCC'])
  })
  it('"at least" steps use the size of the move whichever way it went, and drop unknowns', () => {
    const down = [{ sym: 'X', pct: -22 }, { sym: 'Y', pct: -6 }]
    expect(syms(applyFacets(down, toggleFacet(emptySelection(), 'move', 20), ctx))).toEqual(['X'])
    expect(syms(applyFacets(rows, toggleFacet(emptySelection(), 'rvol', 2), ctx))).toEqual(['AAA', 'CCC'])
  })
  it('picking the same step again clears it', () => {
    const sel = toggleFacet(toggleFacet(emptySelection(), 'price', 10), 'price', 10)
    expect(sel.price).toBeNull()
  })
  it('counts say what you would see if you also picked the option', () => {
    const sel = toggleFacet(emptySelection(), 'signals', 'stage2_list')
    const m = facetModel(rows, sel, ctx)
    const sector = Object.fromEntries(m.sector.map(o => [o.key, o.count]))
    expect(sector).toMatchObject({ Technology: 2, Energy: 0, Healthcare: 0 })
    const sig = Object.fromEntries(m.signals.map(o => [o.key, o.count]))
    expect(sig.new_52w_highs_list).toBe(1)
    expect(sig.stage2_list).toBe(2)
  })
  it('a section counts against the OTHER sections, not itself (so you can add a second sector)', () => {
    const sel = toggleFacet(emptySelection(), 'sector', 'Technology')
    const sector = Object.fromEntries(facetModel(rows, sel, ctx).sector.map(o => [o.key, o.count]))
    expect(sector.Energy).toBe(1)
  })
  it('offers only signals some stock in the list actually has', () => {
    const keys = facetModel(rows, emptySelection(), ctx).signals.map(s => s.key)
    expect(keys).toContain('new_52w_highs_list')
    expect(keys).not.toContain('new_52w_lows_list')
  })
  it('applied chips and the badge count match what is picked', () => {
    let sel = toggleFacet(emptySelection(), 'signals', 'new_52w_highs_list')
    sel = toggleFacet(sel, 'theme', 'AI')
    sel = toggleFacet(sel, 'rating', 80)
    expect(activeCount(sel)).toBe(3)
    expect(activeChips(sel).map(c => c.label)).toEqual(['New 52-week high', 'AI', 'UCT rating 80+'])
  })
})
