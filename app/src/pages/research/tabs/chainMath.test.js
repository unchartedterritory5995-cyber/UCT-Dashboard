import { describe, it, expect } from 'vitest'
import { occRoot, adjustedRank, mergeChain, atmIvOf, midOf, volOiOf, isItm, expectedMove } from './chainMath'

const c = (strike, extra = {}) => ({ strike, contract: `O:TST261120C${String(strike * 1000).padStart(8, '0')}`, shares_per_contract: 100, ...extra })

describe('mergeChain', () => {
  it('prefers the standard contract whichever order the two arrive in, and counts the one left out', () => {
    const std = c(100, { bid: 2 })
    const adj = c(100, { bid: 9, shares_per_contract: 150 })
    for (const calls of [[std, adj], [adj, std]]) {
      const { rows, dropped } = mergeChain(calls, [], 'TST')
      expect(rows).toHaveLength(1)
      expect(rows[0].call.bid).toBe(2)
      expect(dropped).toBe(1)
    }
  })

  it('an adjusted ROOT (O:TST1...) at 100 shares is still not the standard contract', () => {
    const adjRoot = { strike: 100, contract: 'O:TST1261120C00100000', shares_per_contract: 100, bid: 9 }
    expect(adjustedRank(adjRoot, 'TST')).toBe(1)
    expect(occRoot(adjRoot.contract)).toBe('TST1')
    const { rows } = mergeChain([adjRoot, c(100, { bid: 2 })], [], 'TST')
    expect(rows[0].call.bid).toBe(2)
  })

  it('two equal-rank duplicates keep the FIRST, never silently the last', () => {
    const { rows, dropped } = mergeChain([c(100, { bid: 1 }), c(100, { bid: 5 })], [], 'TST')
    expect(rows[0].call.bid).toBe(1)
    expect(dropped).toBe(1)
  })

  it('puts and calls share a row per strike, sorted, with nothing dropped when nothing collides', () => {
    const { rows, dropped } = mergeChain([c(105), c(95)], [c(100)], 'TST')
    expect(rows.map((r) => r.strike)).toEqual([95, 100, 105])
    expect(rows[1].put.strike).toBe(100)
    expect(dropped).toBe(0)
  })
})

describe('atmIvOf (chain_tools.py::_atm)', () => {
  it('is the MEAN of call and put IV at the strike nearest spot', () => {
    const rows = [{ strike: 100, call: { iv: 0.2 }, put: { iv: 0.3 } }, { strike: 110, call: { iv: 0.9 }, put: { iv: 0.9 } }]
    expect(atmIvOf(rows, 101)).toBeCloseTo(0.25, 10)
  })
  it('skips strikes without any IV when choosing the nearest, like the backend', () => {
    const rows = [{ strike: 100, call: { iv: null }, put: {} }, { strike: 105, call: { iv: 0.4 } }]
    expect(atmIvOf(rows, 100)).toBe(0.4)
  })
  it('null without spot or without any IV', () => {
    expect(atmIvOf([{ strike: 100, call: { iv: 0.2 } }], null)).toBeNull()
    expect(atmIvOf([{ strike: 100, call: {} }], 100)).toBeNull()
  })
})

describe('the small columns', () => {
  it('midOf needs a two-sided, uncrossed quote', () => {
    expect(midOf({ bid: 1, ask: 1.5 })).toBe(1.25)
    expect(midOf({ bid: 0, ask: 1.5 })).toBeNull()
    expect(midOf({ bid: 2, ask: 1.5 })).toBeNull()
    expect(midOf({ ask: 1.5 })).toBeNull()
  })
  it('volOiOf is volume over prior-close OI, null over zero OI', () => {
    expect(volOiOf({ day_volume: 50, open_interest: 200 })).toBe(0.25)
    expect(volOiOf({ day_volume: 50, open_interest: 0 })).toBeNull()
    expect(volOiOf({ day_volume: null, open_interest: 10 })).toBeNull()
  })
  it('isItm: a call below spot, a put above it; at the strike is neither', () => {
    expect(isItm('call', 95, 100)).toBe(true)
    expect(isItm('put', 95, 100)).toBe(false)
    expect(isItm('put', 105, 100)).toBe(true)
    expect(isItm('call', 100, 100)).toBe(false)
    expect(isItm('put', 100, 100)).toBe(false)
  })
  it('expectedMove = ATM straddle mid / spot, null when a leg has no two-sided quote', () => {
    const rows = [
      { strike: 95, call: { bid: 6, ask: 6.2 }, put: { bid: 1, ask: 1.2 } },
      { strike: 100, call: { bid: 3, ask: 3.2 }, put: { bid: 2.8, ask: 3 } },
    ]
    const m = expectedMove(rows, 99)
    expect(m.strike).toBe(100)
    expect(m.dollars).toBeCloseTo(6.0, 10)
    expect(m.pct).toBeCloseTo(6.0 / 99 * 100, 10)
    expect(expectedMove([{ strike: 100, call: { bid: 3, ask: 3.2 }, put: { bid: 0, ask: 3 } }], 100)).toBeNull()
  })
})
