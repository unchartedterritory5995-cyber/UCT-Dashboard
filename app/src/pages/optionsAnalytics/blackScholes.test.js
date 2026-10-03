import { describe, it, expect } from 'vitest'
import { cdf, price } from './blackScholes'

// Reference values: S=100, K=100, sigma=20%, 1 year, r=0, q=0 (textbook ATM case):
//   d1 = 0.1, d2 = -0.1; call = 100 x (N(0.1) - N(-0.1)) = 7.9656; delta 0.5398;
//   gamma = n(0.1)/(100 x 0.2) = 0.019848; vega = 100 x n(0.1)/100 = 0.39695;
//   theta = -(100 x 0.396953 x 0.2)/2/365 = -0.010875 per day.
describe('blackScholes (FT-016 pricer, computed)', () => {
  it('the normal CDF', () => {
    expect(cdf(0)).toBeCloseTo(0.5, 7)
    expect(cdf(1.96)).toBeCloseTo(0.975, 4)
    expect(cdf(-1)).toBeCloseTo(0.158655, 5)
  })

  it('prices the textbook at-the-money call', () => {
    const c = price({ type: 'call', S: 100, K: 100, iv: 0.2, days: 365 })
    expect(c.price).toBeCloseTo(7.9656, 3)
    expect(c.delta).toBeCloseTo(0.5398, 4)
    expect(c.gamma).toBeCloseTo(0.019848, 5)
    expect(c.vega).toBeCloseTo(0.39695, 4)
    expect(c.theta).toBeCloseTo(-0.010875, 5)
  })

  it('put-call parity holds with r = 0 (C - P = S - K)', () => {
    const c = price({ type: 'call', S: 105, K: 100, iv: 0.3, days: 45 })
    const p = price({ type: 'put', S: 105, K: 100, iv: 0.3, days: 45 })
    expect(c.price - p.price).toBeCloseTo(5, 6)
    expect(c.delta - p.delta).toBeCloseTo(1, 6)
  })

  it('at expiry it is intrinsic value', () => {
    expect(price({ type: 'put', S: 90, K: 100, iv: 0.3, days: 0 })).toEqual({ price: 10, delta: -1, gamma: 0, theta: 0, vega: 0 })
    expect(price({ type: 'call', S: 90, K: 100, iv: 0.3, days: 0 }).price).toBe(0)
    expect(price({ type: 'call', S: 0, K: 100, iv: 0.3, days: 10 })).toBeNull()
  })
})
