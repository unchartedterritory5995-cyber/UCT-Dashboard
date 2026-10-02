// BRK-01 increment 2 — the payoff math, checked against hand-computed values.
import { describe, it, expect } from 'vitest'
import { mid, buildLegs, pnlAt, netCost, summary, curve } from './optionPayoff'

const ROWS = [
  { strike: 90, call: { bid: 11, ask: 12 }, put: { bid: 1, ask: 1.4 } },
  { strike: 100, call: { bid: 4.8, ask: 5.2 }, put: { bid: 4.6, ask: 5.0 } },
  { strike: 110, call: { bid: 1.5, ask: 1.9 }, put: { bid: 10.5, ask: 11.5 } },
  { strike: 120, call: { bid: 0, ask: 0.3 }, put: null },
]

describe('mid', () => {
  it('is the mid of a two-sided quote, else null', () => {
    expect(mid({ bid: 4.8, ask: 5.2 })).toBeCloseTo(5)
    expect(mid({ bid: 0, ask: 0.3 })).toBeNull()          // no bid: not two-sided
    expect(mid({ bid: 2, ask: 1 })).toBeNull()             // crossed
    expect(mid(null)).toBeNull()
  })
})

describe('long call at 100 for $5', () => {
  const { legs } = buildLegs('long_call', [100], ROWS)
  it('costs $500 and loses all of it below the strike', () => {
    expect(netCost(legs)).toBeCloseTo(500)
    expect(pnlAt(legs, 80)).toBeCloseTo(-500)
    expect(pnlAt(legs, 105)).toBeCloseTo(0)
    expect(pnlAt(legs, 120)).toBeCloseTo(1500)
  })
  it('max loss $500, profit unlimited, breakeven 105', () => {
    const s = summary(legs)
    expect(s.maxLoss).toBeCloseTo(-500)
    expect(s.maxProfit).toBe(Infinity)
    expect(s.breakevens).toEqual([105])
  })
})

describe('long put at 100 for $4.80', () => {
  const { legs } = buildLegs('long_put', [100], ROWS)
  it('profit is capped at the strike minus the premium, breakeven 95.20', () => {
    const s = summary(legs)
    expect(s.maxProfit).toBeCloseTo((100 - 4.8) * 100)
    expect(s.maxLoss).toBeCloseTo(-480)
    expect(s.breakevens).toEqual([95.2])
  })
})

describe('bull call spread 100/110', () => {
  const { legs } = buildLegs('bull_call', [110, 100], ROWS)   // order does not matter
  it('buys the lower, sells the higher; debit $330, max profit $670', () => {
    expect(legs.map((l) => [l.type, l.side, l.strike])).toEqual([['call', 1, 100], ['call', -1, 110]])
    const s = summary(legs)
    expect(s.cost).toBeCloseTo(330)
    expect(s.maxLoss).toBeCloseTo(-330)
    expect(s.maxProfit).toBeCloseTo(670)
    expect(s.breakevens).toEqual([103.3])
  })
})

describe('bear put spread 90/100', () => {
  const { legs } = buildLegs('bear_put', [90, 100], ROWS)
  it('buys the higher put, sells the lower; debit $360, max profit $640', () => {
    expect(legs.map((l) => [l.type, l.side, l.strike])).toEqual([['put', 1, 100], ['put', -1, 90]])
    const s = summary(legs)
    expect(s.cost).toBeCloseTo(360)
    expect(s.maxProfit).toBeCloseTo(640)
    expect(s.maxLoss).toBeCloseTo(-360)
    expect(s.breakevens).toEqual([96.4])
  })
})

describe('refusals are sentences, never a made-up price', () => {
  it('a leg without a two-sided quote is named', () => {
    expect(buildLegs('long_call', [120], ROWS).error).toMatch(/No two-sided quote for the 120 call/)
    expect(buildLegs('long_put', [120], ROWS).error).toMatch(/120 put/)
  })
  it('a spread needs two different strikes', () => {
    expect(buildLegs('bull_call', [100, 100], ROWS).error).toMatch(/two different strikes/)
  })
  it('an unknown strategy or a missing strike says so', () => {
    expect(buildLegs('iron_condor', [100], ROWS).error).toBeTruthy()
    expect(buildLegs('long_call', [], ROWS).error).toMatch(/Pick a strike/)
  })
})

describe('curve', () => {
  it('samples n points across the range, ends inclusive', () => {
    const { legs } = buildLegs('long_call', [100], ROWS)
    const c = curve(legs, 80, 120, 5)
    expect(c.map(([x]) => x)).toEqual([80, 90, 100, 110, 120])
    expect(c[4][1]).toBeCloseTo(1500)
  })
})
