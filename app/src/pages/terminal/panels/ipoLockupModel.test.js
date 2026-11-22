// IPO LOCKUP's pure half. Every symbol, name, date and price is invented; the answers are the route's real shape
// (api/services/ipo_lockups.py get_lockups).
import { describe, it, expect } from 'vitest'
import {
  IPO_LOCKUP_BASIS, IPO_LOCKUP_BUSY_POLL_MS, IPO_LOCKUP_POLL_MS, IPO_LOCKUP_URL, IPO_VIEWS, IPO_VIEW_ARG_WORDS, changeText,
  changeWhy, countLine, dateText, daysText, ipoViewCommandArgs, lockupPollMs, lockupRead, normIpoView, parseIpoView, readText,
} from './ipoLockupModel'

const BASIS = 'estimated: 180 days after listing; the prospectus sets the actual date'
const row = (symbol, expiry, days, over = {}) => ({
  symbol, company: `${symbol} Holdings Inc`, listing_date: '2026-05-28', listing_source: 'first_bar',
  listing_source_words: "its first daily bar in the site's bar store", estimated_expiry: expiry, days_to_go: days,
  basis: 'estimated', basis_words: BASIS,
  change_since_listing: { pct: 25.0, first_close: 20.0, first_date: '2026-05-28', last_close: 25.0, last_date: '2026-11-19', reason: null },
  ...over,
})
const OK = {
  status: 'ok', today: '2026-11-20', lockup_days: 180, basis: 'estimated', basis_words: BASIS, built_at: '2026-11-20T15:00:00+00:00',
  listings_as_of: '2026-11-20T09:58:00-05:00', window: { behind_days: 7, ahead_days: 30, from: '2026-11-13', to: '2026-12-20' },
  counts: { listings: 412, with_listing_date: 410, without_listing_date: 2, in_window: 3, by_source: { first_bar: 2, reference: 1 } },
  rows: [row('AQXA', '2026-11-24', 4), row('BQXB', '2026-11-16', -4), row('GQXG', '2026-11-27', 7)],
}

describe('the view words', () => {
  it('LOCKUP and LOCKUPS, and the bare command is the calendar', () => {
    expect(IPO_LOCKUP_URL).toBe('/api/scans/ipo-lockups')
    expect(IPO_VIEW_ARG_WORDS).toEqual({ LOCKUP: 'lockup', LOCKUPS: 'lockup' })
    expect(parseIpoView('lockup')).toBe('lockup')
    expect(parseIpoView(' LOCKUPS ')).toBe('lockup')
    for (const no of ['', 'LOCK', 'toString', 'YEAR', null]) expect(parseIpoView(no), String(no)).toBeNull()
    expect([normIpoView('lockup'), normIpoView(undefined), normIpoView('x')]).toEqual(['lockup', 'calendar', 'calendar'])
    expect(ipoViewCommandArgs({ view: 'lockup' })).toEqual(['LOCKUP'])
    expect(ipoViewCommandArgs({ view: 'calendar' })).toEqual([])
    expect(ipoViewCommandArgs()).toEqual([])
    expect(IPO_VIEWS.lockup).toMatchObject({ label: 'Lockups ending', token: 'LOCKUP' })
    expect(IPO_LOCKUP_BASIS).toBe(BASIS)
  })
})

describe('reading the answer', () => {
  it('ok: rows soonest first, the past apart from today and ahead, each row\'s basis kept', () => {
    const v = lockupRead(OK)
    expect(v.state).toBe('ok')
    expect(v.rows.map((r) => r.sym)).toEqual(['BQXB', 'AQXA', 'GQXG'])
    expect(v.behind.map((r) => r.sym)).toEqual(['BQXB'])
    expect(v.ahead.map((r) => r.sym)).toEqual(['AQXA', 'GQXG'])
    expect(v.rows[1]).toMatchObject({ sym: 'AQXA', company: 'AQXA Holdings Inc', listing: '2026-05-28', expiry: '2026-11-24', days: 4,
      basis: 'estimated', basisWords: BASIS, listingSource: "its first daily bar in the site's bar store" })
    expect(v.rows[1].change).toEqual({ pct: 25, firstClose: 20, firstDate: '2026-05-28', lastClose: 25, lastDate: '2026-11-19', reason: null })
    expect(v.counts).toEqual({ listings: 412, withDate: 410, withoutDate: 2, inWindow: 3, bySource: { firstBar: 2, relisting: 0, reference: 1, unknown: 0 } })
    expect([v.from, v.to, v.aheadDays, v.behindDays, v.lockupDays]).toEqual(['2026-11-13', '2026-12-20', 30, 7, 180])
  })

  it('a row the server did not mark is still an estimate, and a row it cannot place is dropped and counted', () => {
    const v = lockupRead({ ...OK, rows: [row('AQXA', '2026-11-24', 4, { basis: undefined, basis_words: null }), row('', '2026-11-24', 4),
      row('BQXB', 'soon', 4), row('CQXC', '2026-11-25', 'x'), 7] })
    expect(v.rows).toHaveLength(1)
    expect(v.rows[0]).toMatchObject({ basis: 'estimated', basisWords: BASIS })
    expect(v.dropped).toBe(4)
  })

  it('computing, warming, a failed build and a shape this panel cannot read', () => {
    expect(lockupRead({ status: 'computing' })).toEqual({ state: 'computing' })
    expect(lockupRead({ status: 'warming', rows: [] })).toEqual({ state: 'warming' })
    for (const bad of [null, [], 'x', { status: 'failed', reason: 'error' }, { status: 'unavailable' }, { status: 'ok', rows: 'x' }]) {
      expect(lockupRead(bad).state, JSON.stringify(bad)).toBe('failed')
    }
  })

  it('asks again soon only while the server works the list out', () => {
    expect(lockupPollMs({ status: 'computing' })).toBe(IPO_LOCKUP_BUSY_POLL_MS)
    expect(lockupPollMs({ status: 'warming' })).toBe(IPO_LOCKUP_BUSY_POLL_MS)
    expect(lockupPollMs(OK)).toBe(IPO_LOCKUP_POLL_MS)
    expect(lockupPollMs(undefined)).toBe(IPO_LOCKUP_POLL_MS)
  })
})

describe('the words', () => {
  it('days to go, the date, and the change or why there is none', () => {
    expect([daysText(0), daysText(1), daysText(-1), daysText(15), daysText(-4), daysText(null)])
      .toEqual(['today', 'tomorrow', 'yesterday', 'in 15 days', '4 days ago', ''])
    expect(dateText('2026-11-24')).toBe('Tue Nov 24')
    const c = lockupRead(OK).rows[1].change
    expect(changeText(c)).toBe('+25.0%')
    expect(changeWhy(c)).toBe('$25.00 on Nov 19 against its first close, $20.00 on May 28')
    expect(changeText({ pct: -12.34 })).toBe('-12.3%')
    expect(changeText({ pct: null, reason: 'no_closes' })).toBe('')
    expect(changeWhy({ pct: null, reason: 'no_first_day', firstDate: '2026-06-02' })).toBe("The site's closes start Jun 2, after its first days.")
    expect(changeWhy({ pct: null, reason: 'no_later_close' })).toBe('Only its first close is held.')
    expect(changeWhy({ pct: null, reason: 'bars_unreadable' })).toBe('Its closes could not be read just now.')
    expect(changeWhy({ pct: null, reason: 'no_closes' })).toBe('The site holds no daily closes for it.')
  })

  it('the count line and what was read, with how many listing dates and where they came from', () => {
    const v = lockupRead(OK)
    expect(countLine(v)).toBe('3 estimated lockup expiries from Fri Nov 13 to Sun Dec 20: 2 today or ahead, 1 in the past 7 days.')
    expect(readText(v)).toBe('Read from 412 stocks listed in the last year; 410 have a listing date. 2 stocks have no listing date and are left out. '
      + "The listing dates in this list: 2 from the first daily bar in the site's bar store, 1 from the listing date in Massive's reference data.")
    const none = lockupRead({ ...OK, rows: [], counts: { ...OK.counts, in_window: 0, by_source: {} } })
    expect(countLine(none)).toBe('No estimated lockup expiry falls from Fri Nov 13 to Sun Dec 20.')
    expect(readText(none)).not.toContain('The listing dates in this list')
  })
})
