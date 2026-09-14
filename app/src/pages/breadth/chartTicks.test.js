// app/src/pages/breadth/chartTicks.test.js
import { describe, it, expect } from 'vitest'
import { spanDays, tickBoundary, formatSessionTick, formatTooltipDate } from './chartTicks'

describe('spanDays', () => {
  it('counts calendar days between two session dates', () => {
    expect(spanDays('2026-06-15', '2026-09-11')).toBe(88)
    expect(spanDays('2024-09-16', '2026-09-11')).toBe(725)
    expect(spanDays(null, '2026-09-11')).toBe(0)
  })
})

describe('formatSessionTick', () => {
  // A-06: labels were MM/DD, so over a year "03/31" appeared twice, a year apart.
  it('shows month and day within six months, and the year on the first session of a year', () => {
    expect(formatSessionTick('2026-06-15', 90, false)).toBe('Jun 15')
    expect(formatSessionTick('2026-01-02', 90, true)).toBe('Jan 2, 2026')
  })
  it('shows month and short year up to two years', () => {
    expect(formatSessionTick('2026-06-01', 365, false)).toBe("Jun '26")
    expect(formatSessionTick('2025-03-31', 730, false)).toBe("Mar '25")
  })
  it('shows the year beyond two years', () => {
    expect(formatSessionTick('2024-01-02', 731, true)).toBe('2024')
  })
})

describe('tickBoundary', () => {
  const dates = ['2025-12-30', '2025-12-31', '2026-01-02', '2026-01-05', '2026-02-02', '2026-02-03']
  it('leaves spacing to ECharts within six months', () => {
    expect(tickBoundary(dates, 90)).toBeNull()
  })
  it('labels the first session of each month up to two years', () => {
    const at = tickBoundary(dates, 400)
    expect(dates.map((_, i) => at(i))).toEqual([true, false, true, false, true, false])
  })
  it('labels the first session of each year beyond two years', () => {
    const at = tickBoundary(dates, 900)
    expect(dates.map((_, i) => at(i))).toEqual([true, false, true, false, false, false])
  })
})

describe('formatTooltipDate', () => {
  it('names the weekday and the year (02-design §4)', () => {
    expect(formatTooltipDate('2026-09-11')).toBe('Fri, Sep 11, 2026')
    expect(formatTooltipDate('2024-02-29')).toBe('Thu, Feb 29, 2024')
  })
})
