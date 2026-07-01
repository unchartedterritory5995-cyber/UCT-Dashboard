import { describe, it, expect } from 'vitest'
import { buildIntradayEquitySeries } from './intradayEquity.js'

describe('buildIntradayEquitySeries', () => {
  const positions = [
    { symbol: 'AAPL', side: 'Long', shares: 10 },
    { symbol: 'TSLA', side: 'Short', shares: 2 },
  ]
  const prevClose = { AAPL: 100, TSLA: 200 }

  it('builds portfolio value per timestamp = cash + Σ close×signedShares (+options)', () => {
    const bars = {
      AAPL: [{ t: 100, c: 101 }, { t: 200, c: 102 }],
      TSLA: [{ t: 100, c: 199 }, { t: 200, c: 198 }],
    }
    const s = buildIntradayEquitySeries(bars, positions, prevClose, 50, 1000)
    // baseline (t=99): 1000 + 50 + 100*10 + 200*(-2) = 1650
    // t=100: 1000+50 + 101*10 + 199*(-2) = 1050 + 1010 - 398 = 1662
    // t=200: 1000+50 + 102*10 + 198*(-2) = 1050 + 1020 - 396 = 1674
    expect(s.map((p) => p.value)).toEqual([1650, 1662, 1674])
    expect(s[0].baseline).toBe(true)
    expect(s[0].t).toBe(99)
  })

  it('forward-fills a symbol that has no bar yet at a timestamp', () => {
    const bars = {
      AAPL: [{ t: 100, c: 110 }, { t: 300, c: 120 }],
      TSLA: [{ t: 200, c: 190 }],
    }
    // at t=100 TSLA has no bar → uses its prev close 200 (seeded)
    const s = buildIntradayEquitySeries(bars, positions, prevClose, 0, 0)
    const at100 = s.find((p) => p.t === 100)
    // 110*10 + 200*(-2) = 1100 - 400 = 700
    expect(at100.value).toBe(700)
    const at200 = s.find((p) => p.t === 200)
    // AAPL still 110 (last), TSLA now 190 → 1100 - 380 = 720
    expect(at200.value).toBe(720)
  })

  it('returns null when there are no equity positions or no bars', () => {
    expect(buildIntradayEquitySeries({}, [], prevClose, 0, 0)).toBeNull()
    expect(buildIntradayEquitySeries({}, positions, prevClose, 0, 0)).toBeNull()
  })

  it('omits the baseline point when a prev close is missing', () => {
    const bars = { AAPL: [{ t: 100, c: 105 }], TSLA: [{ t: 100, c: 195 }] }
    const s = buildIntradayEquitySeries(bars, positions, { AAPL: 100 }, 0, 0) // TSLA prev close missing
    expect(s.some((p) => p.baseline)).toBe(false)
    // still values the point (TSLA seeded null → but has a bar at t=100 so usable)
    expect(s[0].value).toBe(105 * 10 + 195 * -2)
  })
})
