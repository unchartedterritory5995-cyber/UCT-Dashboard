import { describe, it, expect } from 'vitest'
import { computeBarTime } from './barTime'

// Weekly candles are dated by the week's CLOSE (Friday of the ET week), to
// match the backend resample (_resample_weekly_iso). The live-update path
// must produce the SAME Friday key or a live tick would target a Monday
// timestamp that no longer matches the last bar → a duplicate weekly candle.

// Mon 2026-06-15 ~14:00 ET = 18:00 UTC.
const MON_1400_ET = Math.floor(Date.UTC(2026, 5, 15, 18, 0, 0) / 1000)
// Thu 2026-06-18 ~14:00 ET = 18:00 UTC (same ISO week as the Monday above).
const THU_1400_ET = Math.floor(Date.UTC(2026, 5, 18, 18, 0, 0) / 1000)

describe('computeBarTime weekly = Friday of the week', () => {
  it('Monday tick → that week\'s Friday', () => {
    expect(computeBarTime('W', MON_1400_ET)).toBe('2026-06-19')
  })

  it('Thursday tick → the same Friday (stable key within the week)', () => {
    expect(computeBarTime('W', THU_1400_ET)).toBe('2026-06-19')
  })

  it('daily still dates by the trading day itself', () => {
    expect(computeBarTime('D', MON_1400_ET)).toBe('2026-06-15')
  })
})
