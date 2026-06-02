import { describe, it, expect } from 'vitest'
import { groupItemsByIndustry, UNCLASSIFIED_GROUP } from './groupByIndustry'

const mk = (t, pct) => ({ t, n: `${t} Inc`, c: 10, vr: 1, a50: 1, atr: 2, pct })

describe('groupItemsByIndustry', () => {
  it('sorts groups by member count descending (most represented first)', () => {
    const items = [mk('A', 5), mk('B', 6), mk('C', 7), mk('D', 8)]
    const industries = { A: 'Semiconductors', B: 'Semiconductors', C: 'Semiconductors', D: 'Biotech' }
    const { groups } = groupItemsByIndustry(items, industries)
    expect(groups.map(g => g.key)).toEqual(['Semiconductors', 'Biotech'])
    expect(groups[0].count).toBe(3)
    expect(groups[1].count).toBe(1)
  })

  it('puts Unclassified last even when it is the largest bucket', () => {
    const items = [mk('A', 5), mk('B', 6), mk('C', 7), mk('D', 8)]
    // A,B,C have no industry → Unclassified (3); D is Biotech (1)
    const industries = { D: 'Biotech' }
    const { groups } = groupItemsByIndustry(items, industries)
    expect(groups[0].key).toBe('Biotech')
    expect(groups[groups.length - 1].key).toBe(UNCLASSIFIED_GROUP)
  })

  it('computes avg pct and sorts members within a group by |pct| desc', () => {
    const items = [mk('A', 4), mk('B', 12)]
    const industries = { A: 'Energy', B: 'Energy' }
    const { groups } = groupItemsByIndustry(items, industries)
    expect(groups[0].avgPct).toBeCloseTo(8)
    expect(groups[0].items.map(i => i.t)).toEqual(['B', 'A'])  // 12 before 4
  })

  it('tie-breaks equal counts by larger |avgPct|', () => {
    const items = [mk('A', 2), mk('B', 9)]
    const industries = { A: 'Banks', B: 'Software' }  // 1 each
    const { groups } = groupItemsByIndustry(items, industries)
    expect(groups[0].key).toBe('Software')  // |9| > |2|
  })

  it('flattened order matches grouped display order', () => {
    const items = [mk('A', 5), mk('B', 6), mk('C', 7)]
    const industries = { A: 'Semiconductors', B: 'Biotech', C: 'Semiconductors' }
    const { groups, order } = groupItemsByIndustry(items, industries)
    const expected = groups.flatMap(g => g.items.map(i => i.t))
    expect(order.map(i => i.t)).toEqual(expected)
  })

  it('handles empty input', () => {
    expect(groupItemsByIndustry([], {}).groups).toEqual([])
    expect(groupItemsByIndustry(undefined, undefined).order).toEqual([])
  })

  it('treats null industry and lowercase ticker keys correctly', () => {
    const items = [mk('NVDA', 8)]
    const { groups } = groupItemsByIndustry(items, { NVDA: null })
    expect(groups[0].key).toBe(UNCLASSIFIED_GROUP)
  })
})
