// The crosshair legend prints CHART time (ET wall clock read as UTC — what
// LWC's param.time carries). Formatting it in America/New_York shifted the
// hovered intraday time a second time (a 10:30 bar read 06:30 / 05:30).
import { describe, it, expect } from 'vitest'
import { formatLegendTime, formatBarInfoDate } from './StockChart'
import { toChartTime } from './chart/barTime'

describe('legend time formatters take chart time', () => {
  it('an EDT and an EST 10:30 bar both read 10:30', () => {
    const oct = toChartTime(Date.UTC(2026, 9, 30, 14, 30) / 1000)   // 10:30 EDT
    const nov = toChartTime(Date.UTC(2026, 10, 2, 15, 30) / 1000)   // 10:30 EST
    expect(formatLegendTime(oct)).toMatch(/10:30/)
    expect(formatLegendTime(nov)).toMatch(/10:30/)
    expect(formatBarInfoDate(oct)).toBe('OCT 30 10:30')
    expect(formatBarInfoDate(nov)).toBe('NOV 2 10:30')
  })
  it('daily strings pass through', () => {
    expect(formatLegendTime('2026-11-02')).toBe('2026-11-02')
    expect(formatBarInfoDate('2026-11-02')).toBe('NOV 2')
  })
})
