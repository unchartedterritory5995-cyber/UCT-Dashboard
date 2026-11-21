// IPO's pure half. Every company, symbol and figure here is invented; the rows are the route's real shape.
import { describe, it, expect } from 'vitest'
import {
  IPO_CODE, IPO_EARLIER_SHOWN, IPO_LISTINGS_COMMAND, IPO_SOURCE, IPO_WHAT, NOT_GIVEN, addDays, countLine, cutDays, dayWords, ipoRead,
  ipoUrl, ipoWindow, priceWords, sharesWords, statusWords, tradesNow, valueWords,
} from './ipoCalendarModel'

const TODAY = '2026-11-18'          // a Wednesday
const deal = (sym, date, over = {}) => ({
  sym, name: `${sym} Holdings Inc`, date, exchange: 'NASDAQ', price_range: '$18.00-$20.00', shares: 12_500_000, value: 237_500_000,
  status: 'expected', entity: { id: `ent-${sym}` }, ...over,
})

describe('the names and the window', () => {
  it('names its code, its thing, its source and where the last year of listings lives', () => {
    expect(IPO_CODE).toBe('IPO')
    expect(IPO_WHAT).toBe('The IPO calendar')
    expect(IPO_SOURCE).toBe('Finnhub and FMP IPO calendars')
    expect(IPO_LISTINGS_COMMAND).toBe('LEAD IPO')
    expect(IPO_EARLIER_SHOWN).toBe(15)
    expect(NOT_GIVEN).toBe('Not given')
  })

  it('asks from last week\'s Monday to next week\'s Friday, whatever weekday today is', () => {
    expect(ipoWindow(TODAY)).toEqual({ from: '2026-11-09', to: '2026-11-27' })
    expect(ipoWindow('2026-11-16')).toEqual({ from: '2026-11-09', to: '2026-11-27' })      // Monday
    expect(ipoWindow('2026-11-22')).toEqual({ from: '2026-11-09', to: '2026-11-27' })      // Sunday ends the same week
    expect(ipoWindow('2026-11-23')).toEqual({ from: '2026-11-16', to: '2026-12-04' })      // the next Monday moves it
    expect(ipoWindow('2027-01-01')).toEqual({ from: '2026-12-21', to: '2027-01-08' })      // across a year end
    expect(ipoUrl(TODAY)).toBe('/api/calendar/ipos?from=2026-11-09&to=2026-11-27')
    for (const bad of ['', null, undefined, 'today', '2026-13-01', '2026-02-30']) {
      expect(ipoWindow(bad), String(bad)).toBeNull()
      expect(ipoUrl(bad), String(bad)).toBeNull()
    }
  })

  it('reads a day from its own parts and moves it by calendar days', () => {
    expect(dayWords('2026-11-18')).toBe('Wed Nov 18')
    expect(dayWords('2026-03-01')).toBe('Sun Mar 1')
    expect(dayWords('2026-02-30')).toBe('an unknown day')
    expect(dayWords(null)).toBe('an unknown day')
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('nope', 1)).toBeNull()
  })
})

describe('the words for one deal', () => {
  it('a status the calendar gives is one word; a missing one is Not given; an unknown one is shown as written', () => {
    expect(statusWords('expected')).toBe('Expected')
    expect(statusWords('PRICED')).toBe('Priced')
    expect(statusWords('withdrawn')).toBe('Withdrawn')
    expect(statusWords('filed')).toBe('Filed')
    expect(statusWords('postponed')).toBe('Postponed')
    expect(statusWords('rumoured')).toBe('Rumoured')
    for (const none of [null, undefined, '', '   ', 0]) expect(statusWords(none), String(none)).toBe('Not given')
  })

  it('a price range reads low to high, one price reads alone, and none is never $0', () => {
    expect(priceWords('$18.00-$20.00')).toBe('$18.00 to $20.00')
    expect(priceWords('20.00 - 18.00')).toBe('$18.00 to $20.00')
    expect(priceWords('$19.00')).toBe('$19.00')
    expect(priceWords('19')).toBe('$19.00')
    expect(priceWords('4.5-4.5')).toBe('$4.50')
    expect(priceWords('to be set')).toBe('to be set')
    for (const none of [null, undefined, '', '  ', 0, 19]) expect(priceWords(none), String(none)).toBe('Not given')
    expect(priceWords('0.00')).toBe('0.00')            // no real price in it: shown as written, never "$0.00"
  })

  it('shares and value are compact, and a missing or zero figure is Not given', () => {
    expect(sharesWords(12_500_000)).toBe('12.5M')
    expect(valueWords(237_500_000)).toBe('$237.5M')
    for (const none of [null, undefined, 0, -5, NaN, '12500000']) {
      expect(sharesWords(none), String(none)).toBe('Not given')
      expect(valueWords(none), String(none)).toBe('Not given')
    }
  })

  it('a symbol is a link only once its deal has priced and its day has come', () => {
    const row = (over) => ({ sym: 'AAAQ', status: 'priced', date: '2026-11-17', ...over })
    expect(tradesNow(row(), TODAY)).toBe(true)
    expect(tradesNow(row({ date: TODAY }), TODAY)).toBe(true)
    expect(tradesNow(row({ date: '2026-11-19' }), TODAY)).toBe(false)
    expect(tradesNow(row({ status: 'expected' }), TODAY)).toBe(false)
    expect(tradesNow(row({ status: null }), TODAY)).toBe(false)
    expect(tradesNow(row({ sym: null }), TODAY)).toBe(false)
    expect(tradesNow(row(), null)).toBe(false)
  })
})

describe('the read', () => {
  it('an answer that is not a list, or one the server labelled failed, is a failed read and never an empty calendar', () => {
    for (const body of [undefined, null, {}, { detail: 'x' }, 'x', 7]) expect(ipoRead(body, null, TODAY).state, JSON.stringify(body)).toBe('failed')
    expect(ipoRead([], 'failed', TODAY).state).toBe('failed')
    expect(ipoRead([deal('AAAQ', TODAY)], 'failed', TODAY).state).toBe('failed')
    expect(ipoRead([], null, TODAY)).toMatchObject({ state: 'none', count: 0, ahead: [], earlier: [] })
  })

  it('puts today and later ahead, soonest first, and the days before today behind, newest first', () => {
    const view = ipoRead([
      deal('DDDQ', '2026-11-24'), deal('AAAQ', '2026-11-10', { status: 'priced' }), deal('CCCQ', TODAY),
      deal('BBBQ', '2026-11-17', { status: 'priced' }), deal('EEEQ', '2026-11-24'), deal('ZZZQ', '2026-11-17'),
    ], null, TODAY)
    expect(view.state).toBe('ok')
    expect(view.ahead.map((d) => [d.date, d.rows.map((r) => r.sym)])).toEqual([[TODAY, ['CCCQ']], ['2026-11-24', ['DDDQ', 'EEEQ']]])
    expect(view.earlier.map((d) => [d.date, d.rows.map((r) => r.sym)])).toEqual([['2026-11-17', ['BBBQ', 'ZZZQ']], ['2026-11-10', ['AAAQ']]])
    expect([view.count, view.aheadCount, view.earlierCount, view.dropped]).toEqual([6, 3, 3, 0])
  })

  it('keeps a deal with no symbol, reads each field, and counts the rows it cannot place', () => {
    const view = ipoRead([
      { sym: null, name: 'Northwind Robotics', date: '2026-11-20', exchange: null, price_range: null, shares: null, value: null, status: null },
      { sym: ' bbbq ', name: '', date: '2026-11-20', exchange: 'NYSE', price_range: '21.00', shares: 0, value: 3.1e9, status: ' Priced ' },
      { sym: 'NODAY', name: 'No Day Inc', date: null }, { sym: null, name: null, date: '2026-11-20' }, null, 'junk', { sym: 'BAD', name: 'Bad', date: '2026-11-31' },
    ], null, TODAY)
    expect(view.count).toBe(2)
    expect(view.dropped).toBe(5)
    const [a, b] = view.ahead[0].rows
    expect(a).toEqual({ sym: 'BBBQ', name: null, date: '2026-11-20', exchange: 'NYSE', price: '21.00', shares: null, value: 3.1e9, status: 'priced' })
    expect(b).toEqual({ sym: null, name: 'Northwind Robotics', date: '2026-11-20', exchange: null, price: null, shares: null, value: null, status: null })
  })

  it('without a today every deal is ahead', () => {
    const view = ipoRead([deal('AAAQ', '2020-01-02')], null, null)
    expect([view.aheadCount, view.earlierCount]).toEqual([1, 0])
  })

  it('cuts the earlier block by deals, keeping whole-day groups in order', () => {
    const days = [{ date: 'a', rows: [1, 2, 3] }, { date: 'b', rows: [4, 5] }, { date: 'c', rows: [6] }]
    expect(cutDays(days, 4)).toEqual([{ date: 'a', rows: [1, 2, 3] }, { date: 'b', rows: [4] }])
    expect(cutDays(days, 3)).toEqual([{ date: 'a', rows: [1, 2, 3] }])
    expect(cutDays(days, 99)).toEqual(days)
    expect(cutDays(days, 0)).toEqual([])
  })

  it('the count line names the days asked for, and an empty calendar says so for those days', () => {
    expect(countLine(ipoRead([], null, TODAY), TODAY)).toBe('No IPO is on the calendar, Mon Nov 9 to Fri Nov 27.')
    expect(countLine(ipoRead([deal('AAAQ', TODAY)], null, TODAY), TODAY)).toBe('1 IPO on the calendar, Mon Nov 9 to Fri Nov 27: 1 today or ahead, 0 earlier.')
    const view = ipoRead([deal('AAAQ', TODAY), deal('BBBQ', '2026-11-10'), deal('CCCQ', '2026-11-11')], null, TODAY)
    expect(countLine(view, TODAY)).toBe('3 IPOs on the calendar, Mon Nov 9 to Fri Nov 27: 1 today or ahead, 2 earlier.')
  })
})
