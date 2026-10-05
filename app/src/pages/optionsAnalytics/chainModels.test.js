import { describe, it, expect } from 'vitest'
import { todayPnl, probBelow, popAtExpiry, priceSlices, extraGreeks, findStrategies } from './chainModels'
import { price } from './blackScholes'
import { pnlAt } from '../research/tabs/optionPayoff'

// lane/o-options-remainders: FT-001 / FT-014 / FT-015 arithmetic, checked against first principles.

const q = (type, strike, bid, ask, iv = 0.3) => ({ type, strike, bid, ask, iv, expiration: '2026-11-20' })
const ROWS = [95, 100, 105].map((k) => ({
  strike: k,
  call: q('call', k, Math.max(0.5, 100 - k + 2), Math.max(0.7, 100 - k + 2.4)),
  put: q('put', k, Math.max(0.5, k - 100 + 2), Math.max(0.7, k - 100 + 2.4)),
}))

describe('FT-001 today at IV', () => {
  const leg = { type: 'call', side: 1, strike: 100, premium: 3, iv: 0.3 }

  it('values each leg by Black-Scholes at its own IV, minus its mid', () => {
    const bs = price({ type: 'call', S: 102, K: 100, iv: 0.3, days: 30 }).price
    expect(todayPnl([leg], 102, 30)).toBeCloseTo((bs - 3) * 100, 6)
  })

  it('collapses to the at-expiry P/L with no time left', () => {
    expect(todayPnl([leg], 110, 0)).toBeCloseTo(pnlAt([leg], 110), 6)
  })

  it('has no today value when a leg has no vendor IV (never a stand-in)', () => {
    expect(todayPnl([{ ...leg, iv: null }], 100, 30)).toBeNull()
  })

  it('probBelow is the driftless lognormal CDF: the median sits below spot by half the variance', () => {
    const iv = 0.4
    const days = 365
    const median = 100 * Math.exp(-0.5 * iv * iv)
    expect(probBelow(median, 100, iv, days)).toBeCloseTo(0.5, 6)
    expect(probBelow(100, 100, iv, days)).toBeGreaterThan(0.5)
  })

  it('PoP of a long call is the chance of finishing above its breakeven', () => {
    const pop = popAtExpiry([leg], 100, 0.3, 30)
    expect(pop).toBeCloseTo(1 - probBelow(103, 100, 0.3, 30), 6)
  })

  it('PoP of a short straddle is the mass between its two breakevens', () => {
    const legs = [{ type: 'call', side: -1, strike: 100, premium: 3, iv: 0.3 }, { type: 'put', side: -1, strike: 100, premium: 3, iv: 0.3 }]
    const pop = popAtExpiry(legs, 100, 0.3, 30)
    expect(pop).toBeCloseTo(probBelow(106, 100, 0.3, 30) - probBelow(94, 100, 0.3, 30), 6)
  })

  it('price slices carry today, expiry and the chance below at each price', () => {
    const s = priceSlices([leg], { lo: 90, hi: 110, days: 30, spot: 100, iv: 0.3, n: 5 })
    expect(s.map((r) => r.price)).toEqual([90, 95, 100, 105, 110])
    expect(s[4].expiry).toBeCloseTo(700)
    expect(s[0].below).toBeLessThan(s[4].below)
  })
})

describe('FT-015 rho / lambda / epsilon', () => {
  it('rho matches the finite difference of the price in the rate (per 1 point)', () => {
    // price() is zero-rate; recover d(price)/dr by discounting K: C(r) = BS with K*e^{-rt} at r=0
    const t = 60 / 365
    const c = (r) => price({ type: 'call', S: 100, K: 100 * Math.exp(-r * t), iv: 0.3, days: 60 }).price
    const fd = (c(0.0001) - c(-0.0001)) / 0.0002 / 100
    const g = extraGreeks({ type: 'call', strike: 100, iv: 0.3, bid: 4, ask: 4.2 }, 100, 60)
    expect(g.rho).toBeCloseTo(fd, 4)
  })

  it('epsilon matches the finite difference in the dividend yield (per 1 point)', () => {
    const t = 60 / 365
    const p = (qy) => price({ type: 'put', S: 100 * Math.exp(-qy * t), K: 100, iv: 0.3, days: 60 }).price
    const fd = (p(0.0001) - p(-0.0001)) / 0.0002 / 100
    const g = extraGreeks({ type: 'put', strike: 100, iv: 0.3, bid: 4, ask: 4.2 }, 100, 60)
    expect(g.epsilon).toBeCloseTo(fd, 4)
  })

  it('lambda is delta x spot / mid, and absent without a two-sided quote', () => {
    const g = extraGreeks({ type: 'call', strike: 100, iv: 0.3, bid: 4, ask: 4.2 }, 100, 60)
    const delta = price({ type: 'call', S: 100, K: 100, iv: 0.3, days: 60 }).delta
    expect(g.lambda).toBeCloseTo((delta * 100) / 4.1, 6)
    expect(extraGreeks({ type: 'call', strike: 100, iv: 0.3, bid: 0, ask: 4.2 }, 100, 60).lambda).toBeNull()
    expect(extraGreeks({ type: 'call', strike: 100, iv: null, bid: 4, ask: 4.2 }, 100, 60).rho).toBeNull()
  })
})

describe('FT-014 strategy finder', () => {
  it('builds bullish candidates off the chain and sorts by probability of profit', () => {
    const { candidates } = findStrategies('bullish', ROWS, { spot: 100, iv: 0.3, days: 30 })
    expect(candidates.map((c) => c.name)).toEqual(expect.arrayContaining(['Long call', 'Bull call spread', 'Bull put spread']))
    const pops = candidates.map((c) => c.pop)
    expect([...pops].sort((a, b) => b - a)).toEqual(pops)
  })

  it('a structure with a leg lacking a two-sided quote is left out and COUNTED', () => {
    const rows = ROWS.map((r) => (r.strike === 105 ? { ...r, call: { ...r.call, bid: 0 } } : r))
    const full = findStrategies('bullish', ROWS, { spot: 100, iv: 0.3, days: 30 })
    const thin = findStrategies('bullish', rows, { spot: 100, iv: 0.3, days: 30 })
    expect(thin.skipped).toBeGreaterThan(0)
    expect(thin.candidates.length + thin.skipped).toBe(full.candidates.length)
    expect(thin.candidates.some((c) => c.legs.some((l) => l.type === 'call' && l.strike === 105))).toBe(false)
  })

  it('a short straddle is flagged undefined risk; reward sort puts it by its cap', () => {
    const { candidates } = findStrategies('neutral', ROWS, { spot: 100, iv: 0.3, days: 30, sort: 'reward' })
    const ss = candidates.find((c) => c.name === 'Short straddle')
    expect(ss.undefinedRisk).toBe(true)
    expect(ss.rewardToRisk).toBeNull()
    expect(candidates.find((c) => c.name === 'Iron butterfly').rewardToRisk).toBeGreaterThan(0)
  })
})
