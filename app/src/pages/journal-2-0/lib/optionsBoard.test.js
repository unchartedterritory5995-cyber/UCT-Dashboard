import { describe, it, expect } from 'vitest'
import { buildOptionCards, netOptionsPerformance } from './optionsBoard'

const strat = (over = {}) => ({
  id: 1,
  underlying: 'CRWV',
  strategyType: 'long_call',
  netEntry: 400,
  brokerCurrentValue: 600,
  legs: [{ qty: 2, strike: 110, expiration: '2099-10-16', entryPrice: 2 }],
  ...over,
})

describe('buildOptionCards', () => {
  it('maps label, contracts, expiry, mark and total return', () => {
    const [c] = buildOptionCards([strat()])
    expect(c.contracts).toBe(2)
    expect(c.expiration).toBe('2099-10-16')
    expect(c.dte).toBeGreaterThan(0)
    expect(c.mark).toBe(600)
    expect(c.totalReturnDollar).toBe(200)
    expect(c.totalReturnPct).toBeCloseTo(0.5)
    expect(typeof c.label).toBe('string')
  })

  it('nulls return when the broker mark is absent', () => {
    const [c] = buildOptionCards([strat({ brokerCurrentValue: null })])
    expect(c.mark).toBeNull()
    expect(c.totalReturnDollar).toBeNull()
  })

  it('sorts soonest expiry first', () => {
    const cards = buildOptionCards([
      strat({ id: 1, legs: [{ qty: 1, strike: 1, expiration: '2099-12-18', entryPrice: 1 }] }),
      strat({ id: 2, legs: [{ qty: 1, strike: 1, expiration: '2099-10-16', entryPrice: 1 }] }),
    ])
    expect(cards.map((c) => c.key)).toEqual(['o-2', 'o-1'])
  })
})

describe('netOptionsPerformance', () => {
  const closed = [
    { id: 'a', closedAt: '2026-06-01', pnlDollar: 100 },
    { id: 'b', closedAt: '2026-05-01', pnlDollar: -40 },
    { id: 'c', closedAt: '2026-06-15', pnlDollar: null },   // skipped
  ]

  it('builds the cumulative realized curve in closedAt order + live open point', () => {
    const openCards = [{ totalReturnDollar: 200 }, { totalReturnDollar: null }]
    // sorted: -40 (May) → +100 (Jun) ⇒ cumulative [-40, 60]; open Σ=200 ⇒ +260
    expect(netOptionsPerformance(closed, openCards)).toEqual([-40, 60, 260])
  })

  it('returns null with fewer than 2 points', () => {
    expect(netOptionsPerformance([], [])).toBeNull()
    expect(netOptionsPerformance([closed[0]], [])).toBeNull()
  })

  it('works with realized-only history (no open positions)', () => {
    expect(netOptionsPerformance(closed, [])).toEqual([-40, 60])
  })
})
