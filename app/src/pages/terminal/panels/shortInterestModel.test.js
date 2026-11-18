// SHINT, the pure half: the route's answer as the panel draws it.
//   * every status is told apart: ok, computing, unavailable (a refused data plan), a symbol that
//     is not a stock, and an answer that is not this route's;
//   * a missing number is null, never 0, and a row without its date or its headline number is dropped;
//   * the two datasets fail apart; an "ok" section with nothing readable is a failed read;
//   * dates, ages, the bar scale, the short volume summary and the plain words for a refusal.
import { describe, it, expect } from 'vitest'
import {
  REPORTS_MORE, REPORTS_SHOWN, SHORT_INTEREST_CODE, SOURCE, VOLUME_DAYS_SHOWN, barShare, changeWay, dayText, daysBetween, etDayOf,
  maxShortOf, ratioSummary, shortDataRead, shortDataUrl, unavailableWords,
} from './shortInterestModel'

const report = (date, short, over = {}) => ({
  settlement_date: date, short_interest: short, avg_daily_volume: 1000000, days_to_cover: 2.5, change_shares: null, change_pct: null, ...over,
})
const volDay = (date, over = {}) => ({ date, short_volume: 400000, total_volume: 1000000, short_volume_ratio: 40, ...over })
const answer = (over = {}) => ({
  status: 'ok', sym: 'NVDA', settlement_date: '2026-10-30', published: null, publication_estimate: '2026-11-10',
  read_at: '2026-11-18T15:02:11+00:00', source: 'FINRA, through Massive',
  interest: {
    state: 'ok', http_status: 200, reason: null, count: 2, cut: false, first_date: '2026-10-15',
    reports: [report('2026-10-30', 3000000, { days_to_cover: 6, change_shares: 1000000, change_pct: 50 }), report('2026-10-15', 2000000)],
  },
  volume: { state: 'ok', http_status: 200, reason: null, count: 2, window_days: 60, days: [volDay('2026-11-17', { short_volume_ratio: 48 }), volDay('2026-11-14')] },
  float: { shares: 10000000, pct_float: 30, withheld: false, state: 'ok', source: 'x' },
  ...over,
})

describe('SHINT model: constants and the route', () => {
  it('names its code, its source and the route of one stock', () => {
    expect(SHORT_INTEREST_CODE).toBe('SHINT')
    expect(SOURCE).toBe('FINRA, through Massive')
    expect(shortDataUrl('BRK-B')).toBe('/api/research/short-data/BRK-B')
    expect(shortDataUrl('A/B')).toBe('/api/research/short-data/A%2FB')
    expect([REPORTS_SHOWN, REPORTS_MORE, VOLUME_DAYS_SHOWN]).toEqual([12, 24, 10])
  })
})

describe('SHINT model: reading the answer', () => {
  it('reads a full answer: the newest report first, its change, the short volume days and the float', () => {
    const v = shortDataRead(answer())
    expect(v.state).toBe('ok')
    expect(v).toMatchObject({ sym: 'NVDA', settlementDate: '2026-10-30', publicationEstimate: '2026-11-10', readAt: '2026-11-18T15:02:11+00:00', refreshing: false })
    expect(v.interest.rows).toEqual([
      { date: '2026-10-30', short: 3000000, adv: 1000000, dtc: 6, changeShares: 1000000, changePct: 50 },
      { date: '2026-10-15', short: 2000000, adv: 1000000, dtc: 2.5, changeShares: null, changePct: null },
    ])
    expect(v.interest).toMatchObject({ state: 'ok', latest: v.interest.rows[0], cut: false, firstDate: '2026-10-15', maxShort: 3000000 })
    expect(v.volume.rows).toEqual([
      { date: '2026-11-17', short: 400000, total: 1000000, ratio: 48 },
      { date: '2026-11-14', short: 400000, total: 1000000, ratio: 40 },
    ])
    expect(v.volume.windowDays).toBe(60)
    expect(v.float).toEqual({ shares: 10000000, pct: 30, withheld: false, state: 'ok' })
    expect(shortDataRead(answer({ refreshing: true })).refreshing).toBe(true)
  })

  it('a missing number is null, never 0, and a row without its date or its short interest is dropped', () => {
    const v = shortDataRead(answer({
      interest: {
        state: 'ok', reports: [
          report('2026-10-30', 5, { avg_daily_volume: null, days_to_cover: undefined, change_shares: 'x', change_pct: NaN }),
          report('2026-10-15', 0),                                   // a real zero stays a zero
          report('not a date', 9), report('2026-09-30', null), report('2026-09-15', -4), null, 'row',
        ],
      },
      volume: { state: 'ok', days: [volDay('2026-11-17', { total_volume: null, short_volume_ratio: null }), volDay('2026-11-14', { short_volume_ratio: 140 }), volDay('x'), { date: '2026-11-13' }] },
      float: { shares: null, pct_float: null, withheld: true, state: 'ok' },
    }))
    expect(v.interest.rows).toEqual([
      { date: '2026-10-30', short: 5, adv: null, dtc: null, changeShares: null, changePct: null },
      { date: '2026-10-15', short: 0, adv: 1000000, dtc: 2.5, changeShares: null, changePct: null },
    ])
    expect(v.volume.rows).toEqual([
      { date: '2026-11-17', short: 400000, total: null, ratio: null },
      { date: '2026-11-14', short: 400000, total: 1000000, ratio: null },     // above 100 percent is not a ratio
    ])
    expect(v.float).toEqual({ shares: null, pct: null, withheld: true, state: 'ok' })
  })

  it('the two datasets fail apart, and each keeps its own reason', () => {
    const v = shortDataRead(answer({ interest: { state: 'unavailable', http_status: 403, reason: 'refused' } }))
    expect(v.state).toBe('ok')
    expect(v.interest).toMatchObject({ state: 'unavailable', httpStatus: 403, reason: 'refused', rows: [], latest: null, firstDate: null })
    expect(v.settlementDate).toBeNull()
    expect(v.volume.state).toBe('ok')
    const none = shortDataRead(answer({ volume: { state: 'none', http_status: 200, reason: null } }))
    expect(none.volume).toMatchObject({ state: 'none', rows: [] })
    const failed = shortDataRead(answer({ volume: { state: 'failed', http_status: 502, reason: 'vendor' } }))
    expect(failed.volume).toMatchObject({ state: 'failed', httpStatus: 502, reason: 'vendor' })
  })

  it('an "ok" section with nothing this code can read is a failed read, never an empty stock', () => {
    const v = shortDataRead(answer({ interest: { state: 'ok', reports: [{ settlementDate: '2026-10-30', shortInterest: 5 }] } }))
    expect(v.state).toBe('ok')
    expect(v.interest.state).toBe('failed')
    expect(shortDataRead(answer({ interest: { state: 'ok', reports: [] }, volume: { state: 'ok', days: 'x' } })).state).toBe('failed')
    expect(shortDataRead(answer({ interest: { state: 'banana' }, volume: null })).state).toBe('failed')
  })

  it('tells every other status apart, and anything else is a failed read', () => {
    expect(shortDataRead({ status: 'computing', sym: 'NVDA' })).toEqual({ state: 'computing', busy: false })
    expect(shortDataRead({ status: 'computing', sym: 'NVDA', busy: true })).toEqual({ state: 'computing', busy: true })
    expect(shortDataRead({ status: 'bad_symbol', sym: null })).toEqual({ state: 'bad-symbol' })
    expect(shortDataRead({
      status: 'unavailable', sym: 'NVDA', interest: { state: 'unavailable', http_status: 403, reason: 'refused' }, volume: { state: 'unavailable', http_status: 403, reason: 'refused' },
    })).toEqual({ state: 'unavailable', reason: 'refused', httpStatus: 403 })
    expect(shortDataRead({ status: 'unavailable', interest: { state: 'failed' }, volume: { state: 'unavailable', http_status: null, reason: 'not_configured' } }))
      .toEqual({ state: 'unavailable', reason: 'not_configured', httpStatus: null })
    for (const bad of [null, undefined, 'x', [], {}, { status: 'failed', sym: 'NVDA' }, { detail: 'nope' }, { status: 'ok' }]) {
      expect(shortDataRead(bad), JSON.stringify(bad)).toEqual({ state: 'failed' })
    }
  })
})

describe('SHINT model: helpers', () => {
  it('writes a date in words and leaves anything else as it came', () => {
    expect(dayText('2026-10-30')).toBe('Oct 30, 2026')
    expect(dayText('2026-01-05', { short: true })).toBe('Jan 5')
    expect(dayText('soon')).toBe('soon')
    expect(dayText(null)).toBe('')
  })

  it('counts days between two dates and gives the New York date of an instant', () => {
    expect(daysBetween('2026-10-30', '2026-11-18')).toBe(19)
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30)          // across the clock change
    expect(daysBetween('2026-11-18', '2026-10-30')).toBe(-19)
    expect(daysBetween('x', '2026-10-30')).toBeNull()
    expect(etDayOf('2026-11-18T03:30:00+00:00')).toBe('2026-11-17')   // still the evening before in New York
    expect(etDayOf('2026-11-18T15:02:11+00:00')).toBe('2026-11-18')
    expect(etDayOf('nope')).toBeNull()
    expect(etDayOf(null)).toBeNull()
  })

  it('scales a bar to the biggest value drawn, and draws none for a missing number', () => {
    expect(barShare(3000000, 3000000)).toBe(100)
    expect(barShare(1000000, 3000000)).toBe(33.3)
    expect(barShare(0, 3000000)).toBe(0)
    expect(barShare(null, 3000000)).toBeNull()
    expect(barShare(5, 0)).toBeNull()
    expect(barShare(-1, 10)).toBeNull()
    expect(barShare(48, 100)).toBe(48)
    expect(maxShortOf([{ short: 2 }, { short: 9 }, { short: 4 }])).toBe(9)
    expect(maxShortOf([])).toBe(0)
  })

  it('summarises the short volume ratio over the days that have one', () => {
    expect(ratioSummary([{ ratio: 40 }, { ratio: 50 }, { ratio: null }, { ratio: 45.5 }])).toEqual({ n: 3, avg: 45.2, low: 40, high: 50 })
    expect(ratioSummary([{ ratio: null }])).toBeNull()
    expect(ratioSummary([])).toBeNull()
  })

  it('says which way short interest went, and nothing when there is no earlier report', () => {
    expect(changeWay({ changeShares: 5 })).toBe('up')
    expect(changeWay({ changeShares: -5 })).toBe('down')
    expect(changeWay({ changeShares: 0 })).toBe('flat')
    expect(changeWay({ changeShares: null })).toBeNull()
    expect(changeWay(null)).toBeNull()
  })

  it('says a refusal in plain words, by its reason', () => {
    expect(unavailableWords('Short interest', 'refused', 403)).toBe('Short interest is not available on the data plan right now (the data vendor answered 403).')
    expect(unavailableWords('Short interest', null, null)).toBe('Short interest is not available on the data plan right now.')
    expect(unavailableWords('Daily short volume', 'not_configured', null)).toBe('Daily short volume is not available on this server: it has no key for the data vendor.')
    expect(unavailableWords('Short interest', 'thin', 200)).toBe('Short interest is not available right now: the data vendor answered, but not with a report this screen can read.')
  })
})
