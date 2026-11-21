// tradingSessionTodayET: the chart's per-minute memo of isTradingSessionTodayET (switch profile 2026-11-20).
// It must (1) compute once per minute however often it is asked, and (2) never hold an answer past the ET
// date change: the Friday answer at 23:59:30 ET, the Saturday answer 40 s later.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const hoisted = vi.hoisted(() => ({ calls: 0 }))
vi.mock('../../utils/marketSession', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, isTradingSessionTodayET: () => { hoisted.calls++; return real.isTradingSessionTodayET() } }
})

import { tradingSessionTodayET, __resetTradingTodayMemoForTests } from './tradingTodayMemo'
import { isTradingSessionTodayET } from '../../utils/marketSession'

// ET is UTC-5 in November (EST).
const FRI_2359_30_ET = Date.UTC(2026, 10, 21, 4, 59, 30)   // Fri 2026-11-20 23:59:30 ET
const SAT_0000_10_ET = Date.UTC(2026, 10, 21, 5, 0, 10)    // Sat 2026-11-21 00:00:10 ET
const MON_1000_ET = Date.UTC(2026, 10, 23, 15, 0, 0)       // Mon 2026-11-23 10:00 ET

beforeEach(() => { vi.useFakeTimers(); hoisted.calls = 0; __resetTradingTodayMemoForTests() })
afterEach(() => { vi.useRealTimers() })

describe('tradingSessionTodayET', () => {
  it('computes once per minute, however often a switch asks', () => {
    vi.setSystemTime(MON_1000_ET)
    for (let i = 0; i < 50; i++) expect(tradingSessionTodayET()).toBe(true)
    expect(hoisted.calls).toBe(1)
    vi.setSystemTime(MON_1000_ET + 59_000)                   // same minute
    tradingSessionTodayET()
    expect(hoisted.calls).toBe(1)
    vi.setSystemTime(MON_1000_ET + 60_000)                   // the next minute asks again
    tradingSessionTodayET()
    expect(hoisted.calls).toBe(2)
  })

  it('answers the new ET date at midnight: Friday true, then Saturday false 40 s later', () => {
    vi.setSystemTime(FRI_2359_30_ET)
    expect(tradingSessionTodayET()).toBe(true)
    vi.setSystemTime(SAT_0000_10_ET)
    expect(tradingSessionTodayET()).toBe(false)
  })

  it('is the real answer at every hour of a week (the memo never changes what it returns)', () => {
    const start = Date.UTC(2026, 10, 22, 0, 0, 0)            // Sun 2026-11-22 00:00 UTC
    for (let h = 0; h < 24 * 8; h++) {
      vi.setSystemTime(start + h * 3_600_000)
      expect(tradingSessionTodayET()).toBe(isTradingSessionTodayET())
    }
  })
})
