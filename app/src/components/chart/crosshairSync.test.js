import { describe, it, expect } from 'vitest'
import { etDayOf, snapSyncedBar } from './crosshairSync'

// StockChart's adjustTime: numeric bar times are shifted to ET, strings pass through.
const OFFSET = -4 * 3600            // a fixed EDT offset is enough for these assertions
const adjust = (t) => (typeof t === 'number' ? t + OFFSET : t)

/** Build an intraday bar whose ET wall-clock is the given day + hour. */
const iBar = (day, hour) => ({ t: Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`) / 1000 - OFFSET })
const dBar = (day) => ({ t: day })

describe('etDayOf', () => {
  it('reads the day off a daily string time', () => {
    expect(etDayOf('2026-07-28')).toBe('2026-07-28')
  })

  it('reads the ET day off an ET-shifted intraday time', () => {
    // 2026-07-28 15:30 ET, stored shifted — the UTC parts ARE the ET wall clock.
    expect(etDayOf(adjust(iBar('2026-07-28', 15).t))).toBe('2026-07-28')
  })

  it('is null for junk', () => {
    expect(etDayOf(null)).toBeNull()
    expect(etDayOf(NaN)).toBeNull()
  })
})

describe('snapSyncedBar — intraday hover → daily chart', () => {
  const daily = ['2026-07-24', '2026-07-27', '2026-07-28', '2026-07-29'].map(dBar)

  it('lands on that exact day', () => {
    const hovered = adjust(iBar('2026-07-28', 11).t)
    expect(snapSyncedBar(daily, adjust, etDayOf(hovered), hovered)).toBe('2026-07-28')
  })

  it('regression: a numeric instant used to binary-search against STRING bar times', () => {
    // The pre-fix code compared `adjustTime(bars[mid].t) < T` with a string on the
    // left and a number on the right — always false — so it collapsed onto the
    // last bar no matter which day was hovered.
    const early = adjust(iBar('2026-07-24', 10).t)
    expect(snapSyncedBar(daily, adjust, etDayOf(early), early)).toBe('2026-07-24')
  })

  it('a weekend/holiday hover falls back to the prior session', () => {
    const sunday = adjust(iBar('2026-07-26', 12).t)   // between Fri 7/24 and Mon 7/27
    expect(snapSyncedBar(daily, adjust, etDayOf(sunday), sunday)).toBe('2026-07-24')
  })

  it('returns null when the day predates every loaded bar', () => {
    const old = adjust(iBar('2020-01-02', 12).t)
    expect(snapSyncedBar(daily, adjust, etDayOf(old), old)).toBeNull()
  })
})

describe('snapSyncedBar — daily hover → intraday chart', () => {
  const intraday = [
    iBar('2026-07-27', 10), iBar('2026-07-27', 15),
    iBar('2026-07-28', 10), iBar('2026-07-28', 12), iBar('2026-07-28', 15),
    iBar('2026-07-29', 10),
  ]

  it('marks that day, using its LAST bar so both charts agree on the close', () => {
    // Source is D/W/M → no numeric instant, only the day. This is the case the
    // pre-fix code skipped entirely (`typeof T === 'number'` was false), leaving
    // a 'YYYY-MM-DD' handed to a numeric series.
    const got = snapSyncedBar(intraday, adjust, '2026-07-28', null)
    expect(got).toBe(adjust(iBar('2026-07-28', 15).t))
    expect(etDayOf(got)).toBe('2026-07-28')
  })

  it('returns null when the intraday window does not reach that day', () => {
    expect(snapSyncedBar(intraday, adjust, '2026-05-01', null)).toBeNull()
  })
})

describe('snapSyncedBar — same timeframe', () => {
  const intraday = [iBar('2026-07-28', 10), iBar('2026-07-28', 11), iBar('2026-07-28', 12)]

  it('still lands on the exact bar', () => {
    const hovered = adjust(iBar('2026-07-28', 11).t)
    expect(snapSyncedBar(intraday, adjust, etDayOf(hovered), hovered)).toBe(hovered)
  })

  it('snaps to the nearest bar for an in-between instant', () => {
    const between = adjust(iBar('2026-07-28', 11).t) + 600   // 11:10 → nearer 11:00
    expect(snapSyncedBar(intraday, adjust, etDayOf(between), between)).toBe(adjust(iBar('2026-07-28', 11).t))
  })
})

describe('snapSyncedBar — degenerate input', () => {
  it('no bars / no day', () => {
    expect(snapSyncedBar([], adjust, '2026-07-28', null)).toBeNull()
    expect(snapSyncedBar(null, adjust, '2026-07-28', null)).toBeNull()
    expect(snapSyncedBar([dBar('2026-07-28')], adjust, null, null)).toBeNull()
  })
})
