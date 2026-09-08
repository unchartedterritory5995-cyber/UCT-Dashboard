// @vitest-environment jsdom
/* What a row SAYS it is — the shared answer, and the order it answers in.
 *
 * ⛔ THE BRANCH ORDER IS THE SAFETY PROPERTY. "Delisted" is the one label that
 * changes whether a member should tap the row at all; hidden behind a type badge
 * it is worth nothing, and the tap produces a dead chart with no warning.
 */
import { describe, it, expect } from 'vitest'
import { rowIdentity, CHIPS, INDICES_PRESET, TYPE_LABEL, POPULAR_RESULTS, matchQ } from './symbolSearchModel'

describe('rowIdentity', () => {
  it('⛔ DELISTED wins over everything, and carries the year', () => {
    const r = { ticker: 'YHOO', type: 'stock', exchange: 'NASDAQ', delisted: true, delisted_date: '2017-06-13' }
    expect(rowIdentity(r).badge).toEqual({ text: 'Delisted 2017', kind: 'delisted' })
    // and it does NOT also claim an exchange it no longer trades on
    expect(rowIdentity(r).exchange).toBeNull()
  })

  it('a delisted row with no date still says delisted', () => {
    expect(rowIdentity({ ticker: 'X', delisted: true }).badge.text).toBe('Delisted')
  })

  it('a UCT breadth pseudo-ticker is not an instrument and says so', () => {
    const r = { ticker: 'UCTA50', type: 'breadth', breadth: true, group_label: 'MA breadth' }
    expect(rowIdentity(r).badge).toEqual({ text: 'BREADTH', kind: 'breadth' })
  })

  it('an ETF is distinguishable from the operating company', () => {
    expect(rowIdentity({ ticker: 'SPY', type: 'etf', exchange: 'ARCA' }))
      .toEqual({ exchange: 'ARCA', badge: { text: 'ETF', kind: 'etf' } })
  })

  it('an index too', () => {
    expect(rowIdentity({ ticker: 'SPX', type: 'index' }).badge.text).toBe('index')
  })

  it('⭐ a plain STOCK is unbadged on the phone — its EXCHANGE is the disambiguator', () => {
    expect(rowIdentity({ ticker: 'AAPL', type: 'stock', exchange: 'NASDAQ' }))
      .toEqual({ exchange: 'NASDAQ', badge: null })
  })

  it('…and the desktop, which has the width, still labels it — one parameter, not a second copy', () => {
    expect(rowIdentity({ ticker: 'AAPL', type: 'stock', exchange: 'NASDAQ' }, { badgeStock: true }).badge)
      .toEqual({ text: 'stock', kind: 'stock' })
  })

  it('degrades to nothing rather than guessing', () => {
    expect(rowIdentity(null)).toEqual({ exchange: null, badge: null })
    expect(rowIdentity({ ticker: 'ZZZ' })).toEqual({ exchange: null, badge: null })
  })
})

describe('the shared vocabulary both surfaces read', () => {
  it('every chip maps to a real backend type, or to the explicit all', () => {
    expect(CHIPS.map((c) => c.key)).toEqual(['all', 'stock', 'etf', 'index', 'breadth'])
    expect(CHIPS.find((c) => c.key === 'all').type).toBe('')
    for (const c of CHIPS.filter((c) => c.key !== 'all')) {
      expect(TYPE_LABEL[c.type], `chip "${c.key}" has no label`).toBeTruthy()
    }
  })

  it('the indices preset is a closed list, so the chip never needs a round trip', () => {
    expect(INDICES_PRESET.length).toBeGreaterThan(4)
    for (const r of INDICES_PRESET) expect(r.type).toBe('index')
  })

  it('the popular list carries types, so a chip can filter it offline', () => {
    expect(POPULAR_RESULTS.some((r) => r.type === 'etf')).toBe(true)
    expect(POPULAR_RESULTS.some((r) => r.type === 'stock')).toBe(true)
  })

  it('matchQ matches ticker OR name, case-insensitively', () => {
    const r = { ticker: 'SPX', name: 'S&P 500 Index' }
    expect(matchQ(r, 'spx')).toBe(true)
    expect(matchQ(r, 'index')).toBe(true)
    expect(matchQ(r, 'zzz')).toBe(false)
    expect(matchQ(r, '')).toBe(true)
  })
})
