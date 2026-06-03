import { describe, it, expect } from 'vitest'
import { groupItems, UNCLASSIFIED_GROUP } from './groupItems'

describe('groupItems (generalized)', () => {
  it('honors custom tickerOf / pctOf accessors (CustomScan shape)', () => {
    const rows = [
      { ticker: 'NVDA', pct_1d: 4 },
      { ticker: 'AMD', pct_1d: 9 },
      { ticker: 'XOM', pct_1d: 6 },
    ]
    const labels = { NVDA: 'Semiconductors', AMD: 'Semiconductors', XOM: 'Energy' }
    const { groups, order } = groupItems(rows, labels, {
      tickerOf: r => r.ticker, pctOf: r => r.pct_1d,
    })
    expect(groups.map(g => g.key)).toEqual(['Semiconductors', 'Energy'])
    expect(groups[0].count).toBe(2)
    // within group sorted by |pct| desc → AMD(9) before NVDA(4)
    expect(groups[0].items.map(r => r.ticker)).toEqual(['AMD', 'NVDA'])
    expect(groups[0].avgPct).toBeCloseTo(6.5)
    expect(order.map(r => r.ticker)).toEqual(['AMD', 'NVDA', 'XOM'])
  })

  it('groups by whichever label map is passed (sector vs industry)', () => {
    const rows = [{ ticker: 'NVDA', pct_1d: 5 }, { ticker: 'AMD', pct_1d: 5 }]
    const bySector = groupItems(rows, { NVDA: 'Technology', AMD: 'Technology' },
      { tickerOf: r => r.ticker, pctOf: r => r.pct_1d })
    expect(bySector.groups).toHaveLength(1)
    expect(bySector.groups[0].key).toBe('Technology')
  })

  it('falls back to Unclassified (last) for missing labels', () => {
    const rows = [{ ticker: 'A', pct_1d: 1 }, { ticker: 'B', pct_1d: 2 }]
    const { groups } = groupItems(rows, { A: 'Banks' },
      { tickerOf: r => r.ticker, pctOf: r => r.pct_1d })
    expect(groups[0].key).toBe('Banks')
    expect(groups[groups.length - 1].key).toBe(UNCLASSIFIED_GROUP)
  })

  it('defaults to t / pct accessors (drill-modal shape)', () => {
    const { groups } = groupItems([{ t: 'NVDA', pct: 8 }], { NVDA: 'Semiconductors' })
    expect(groups[0].key).toBe('Semiconductors')
    expect(groups[0].avgPct).toBe(8)
  })
})
