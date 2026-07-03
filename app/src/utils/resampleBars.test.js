import { describe, it, expect } from 'vitest'
import { resample, resampleDailyToWeekly, resampleDailyToMonthly } from './resampleBars'

// Daily bar factory (t = ISO date, as /api/bars returns for D).
const d = (t, o, h, l, c, v = 100) => ({ t, o, h, l, c, v })

describe('resampleDailyToWeekly (mirrors server _resample_weekly_iso: ISO-Friday key)', () => {
  it('dates a complete week at its ISO Friday, not the first trading day', () => {
    // Mon 6/15 .. Fri 6/19 2026 — ISO week 25, Friday = 2026-06-19.
    const daily = [
      d('2026-06-15', 12.0, 12.5, 11.8, 12.3, 100),
      d('2026-06-16', 12.3, 12.4, 11.5, 11.7, 200),
      d('2026-06-17', 11.7, 11.9, 11.0, 11.2, 150),
      d('2026-06-18', 11.2, 11.6, 10.9, 11.5, 120),
      d('2026-06-19', 11.5, 12.0, 11.3, 11.9, 180),
    ]
    const w = resampleDailyToWeekly(daily)
    expect(w).toHaveLength(1)
    expect(w[0]).toEqual({ t: '2026-06-19', o: 12.0, h: 12.5, l: 10.9, c: 11.9, v: 750 })
  })

  it('in-progress week keys to its Friday even before Friday trades', () => {
    // Mon-Wed of the 6/22-6/26 week (ISO week 26, Friday 2026-06-26).
    const daily = [
      d('2026-06-22', 11.0, 11.4, 10.8, 11.3, 100),
      d('2026-06-23', 11.3, 11.3, 10.9, 11.2, 110),
      d('2026-06-24', 11.2, 11.3, 10.3, 10.5, 120),
    ]
    const w = resampleDailyToWeekly(daily)
    expect(w).toHaveLength(1)
    expect(w[0].t).toBe('2026-06-26')
    expect(w[0].o).toBe(11.0)
    expect(w[0].c).toBe(10.5) // last day seen so far
  })

  it('groups multiple weeks and sorts ascending by Friday', () => {
    const daily = [
      d('2026-06-15', 1, 2, 0.5, 1.5), d('2026-06-19', 1.5, 3, 1, 2.5),
      d('2026-06-22', 2.5, 4, 2, 3.5), d('2026-06-26', 3.5, 5, 3, 4.5),
    ]
    const w = resampleDailyToWeekly(daily)
    expect(w.map(b => b.t)).toEqual(['2026-06-19', '2026-06-26'])
  })

  it('handles a holiday-Monday week (first trading day is Tuesday) — still Friday-keyed', () => {
    // Week of 2026-01-19 (MLK Mon off); Tue-Fri only. ISO Friday = 2026-01-23.
    const daily = [
      d('2026-01-20', 10, 11, 9, 10.5), d('2026-01-21', 10.5, 12, 10, 11),
      d('2026-01-22', 11, 11.5, 10.2, 10.8), d('2026-01-23', 10.8, 11, 10, 10.4),
    ]
    const w = resampleDailyToWeekly(daily)
    expect(w).toHaveLength(1)
    expect(w[0].t).toBe('2026-01-23')
    expect(w[0].o).toBe(10) // Tuesday's open (earliest present)
  })

  it('crosses a year boundary (ISO week 1 of next year)', () => {
    // 2026-12-28 (Mon) .. 2027-01-01 (Fri) is ISO week 53 of 2026; Friday 2027-01-01.
    const daily = [d('2026-12-28', 1, 2, 0.5, 1.2), d('2027-01-01', 1.2, 2.5, 1, 1.8)]
    const w = resampleDailyToWeekly(daily)
    expect(w).toHaveLength(1)
    expect(w[0].t).toBe('2027-01-01')
  })

  it('single day → single Friday-keyed bar', () => {
    const w = resampleDailyToWeekly([d('2026-06-17', 5, 6, 4, 5.5, 42)])
    expect(w).toEqual([{ t: '2026-06-19', o: 5, h: 6, l: 4, c: 5.5, v: 42 }])
  })

  it('empty input → empty output', () => {
    expect(resampleDailyToWeekly([])).toEqual([])
  })
})

describe('resampleDailyToMonthly (mirrors server _resample_monthly_iso: 1st-of-month key)', () => {
  it('dates each month at the 1st and aggregates OHLCV', () => {
    const daily = [
      d('2026-06-01', 10, 11, 9, 10.5, 100),
      d('2026-06-15', 10.5, 13, 10, 12, 200),
      d('2026-06-30', 12, 12.5, 11, 11.8, 150),
      d('2026-07-01', 11.8, 14, 11.5, 13.5, 300),
    ]
    const m = resampleDailyToMonthly(daily)
    expect(m).toEqual([
      { t: '2026-06-01', o: 10, h: 13, l: 9, c: 11.8, v: 450 },
      { t: '2026-07-01', o: 11.8, h: 14, l: 11.5, c: 13.5, v: 300 },
    ])
  })

  it('single day → single 1st-keyed bar; empty → empty', () => {
    expect(resampleDailyToMonthly([d('2026-03-14', 5, 6, 4, 5.5, 9)]))
      .toEqual([{ t: '2026-03-01', o: 5, h: 6, l: 4, c: 5.5, v: 9 }])
    expect(resampleDailyToMonthly([])).toEqual([])
  })
})

describe('resample dispatcher', () => {
  const daily = [d('2026-06-15', 1, 2, 0.5, 1.5), d('2026-06-19', 1.5, 3, 1, 2.5)]
  it('D->W and D->M dispatch to the resamplers', () => {
    expect(resample(daily, 'D', 'W')[0].t).toBe('2026-06-19')
    expect(resample(daily, 'D', 'M')[0].t).toBe('2026-06-01')
  })
  it('returns null for unsupported pairs (caller falls back to network)', () => {
    expect(resample(daily, 'D', '5')).toBeNull()   // can't upscale D to intraday
    expect(resample(daily, 'W', 'M')).toBeNull()   // not supported in this pass
    expect(resample(daily, 'D', 'D')).toBeNull()   // no-op
    expect(resample(null, 'D', 'W')).toBeNull()
    expect(resample([], 'D', 'W')).toBeNull()
  })
})
