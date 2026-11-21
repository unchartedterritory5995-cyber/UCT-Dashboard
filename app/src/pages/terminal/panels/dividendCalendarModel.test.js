// DVD's pure half. Every symbol, date and amount here is invented; the rows are the route's real shape.
import { describe, it, expect } from 'vitest'
import {
  DVD_BUCKETS, DVD_CODE, DVD_HISTORY_CODE, DVD_SOURCE, DVD_SYMBOL_CAP, DVD_WHAT, bucketOf, countLine, dayWords, detailWords,
  dvdHistoryCommand, dvdRead, dvdUrl, eventWords, weekEnd,
} from './dividendCalendarModel'

const TODAY = '2026-11-18'          // a Wednesday
const div = (sym, date, amount = 0.25) => ({ sym, type: 'dividend', date, amount, source: 'massive', entity: { id: `ent-${sym}` } })
const split = (sym, date, ratio = '4:1') => ({ sym, type: 'split', date, ratio, source: 'massive', entity: { id: `ent-${sym}` } })

describe('the names and the two reads', () => {
  it('names its code, its thing, its source, the route cap and where history lives', () => {
    expect(DVD_CODE).toBe('DVD')
    expect(DVD_WHAT).toBe('The dividend calendar')
    expect(DVD_SOURCE).toBe('Massive reference data')
    expect(DVD_SYMBOL_CAP).toBe(200)
    expect(DVD_HISTORY_CODE).toBe('CACT')
    expect(dvdHistoryCommand('NVDA')).toBe('NVDA CACT')
  })

  it('reads the member\'s own stocks with no symbol and one stock with one', () => {
    expect(dvdUrl(null)).toBe('/api/calendar/dividends')
    expect(dvdUrl('')).toBe('/api/calendar/dividends')
    expect(dvdUrl('NVDA')).toBe('/api/calendar/dividends?syms=NVDA')
    expect(dvdUrl('BRK-B')).toBe('/api/calendar/dividends?syms=BRK-B')
  })
})

describe('days and weeks', () => {
  it('a day reads from its own parts, with the year only when it is not this year', () => {
    expect(dayWords('2026-11-18', TODAY)).toBe('Wed Nov 18')
    expect(dayWords('2027-01-08', TODAY)).toBe('Fri Jan 8, 2027')
    expect(dayWords('2027-01-08')).toBe('Fri Jan 8')
    expect(dayWords('2026-02-30', TODAY)).toBe('an unknown day')
    expect(dayWords(null, TODAY)).toBe('an unknown day')
  })

  it('a week ends on its Sunday', () => {
    expect(weekEnd(TODAY)).toBe('2026-11-22')
    expect(weekEnd('2026-11-22')).toBe('2026-11-22')             // Sunday is the last day of its own week
    expect(weekEnd('2026-11-23')).toBe('2026-11-29')             // Monday starts the next
    expect(weekEnd(TODAY, 1)).toBe('2026-11-29')
    expect(weekEnd('2026-12-30', 0)).toBe('2027-01-03')
    expect(weekEnd('nope')).toBeNull()
  })

  it('this week, next week, and everything after', () => {
    expect(DVD_BUCKETS.map((b) => [b.key, b.label])).toEqual([['this', 'This week'], ['next', 'Next week'], ['later', 'Later']])
    expect(bucketOf('2026-11-18', TODAY)).toBe('this')
    expect(bucketOf('2026-11-22', TODAY)).toBe('this')
    expect(bucketOf('2026-11-23', TODAY)).toBe('next')
    expect(bucketOf('2026-11-29', TODAY)).toBe('next')
    expect(bucketOf('2026-11-30', TODAY)).toBe('later')
    expect(bucketOf('2026-11-30', null)).toBe('this')            // no today: one block, nothing guessed
  })
})

describe('the words for one event', () => {
  it('a dividend is an ex-dividend day with its cash a share; a split reads its ratio', () => {
    expect(eventWords({ type: 'dividend' })).toBe('Ex-dividend')
    expect(eventWords({ type: 'split' })).toBe('Split')
    expect(detailWords({ type: 'dividend', amount: 0.25 })).toBe('$0.25 a share')
    expect(detailWords({ type: 'dividend', amount: 0.0125 })).toBe('$0.0125 a share')
    expect(detailWords({ type: 'split', ratio: '4:1' })).toBe('4 for 1')
    expect(detailWords({ type: 'split', ratio: '1:10' })).toBe('1 for 10 (reverse split)')
  })

  it('a missing figure is said, never $0', () => {
    expect(detailWords({ type: 'dividend', amount: null })).toBe('Amount not given')
    expect(detailWords({ type: 'split', ratio: null })).toBe('Ratio not given')
  })
})

describe('the read', () => {
  it('an answer that is not a list is a failed read; so is an empty list the server labelled failed', () => {
    for (const body of [undefined, null, {}, { detail: 'x' }, 'x', 7]) expect(dvdRead(body, null, TODAY).state, JSON.stringify(body)).toBe('failed')
    expect(dvdRead([], 'failed', TODAY)).toMatchObject({ state: 'failed', partial: false, count: 0 })
    expect(dvdRead([{ junk: 1 }], 'failed', TODAY).state).toBe('failed')          // no usable row is no row
  })

  it('an answered, empty list is an answer; a partial one says so', () => {
    expect(dvdRead([], null, TODAY)).toMatchObject({ state: 'none', partial: false, count: 0, buckets: [] })
    expect(dvdRead([], 'partial', TODAY)).toMatchObject({ state: 'none', partial: true })
  })

  it('rows the server labelled failed or partial are kept and marked as possibly missing some', () => {
    expect(dvdRead([div('KO', TODAY)], 'failed', TODAY)).toMatchObject({ state: 'ok', partial: true, count: 1 })
    expect(dvdRead([div('KO', TODAY)], 'partial', TODAY)).toMatchObject({ state: 'ok', partial: true })
    expect(dvdRead([div('KO', TODAY)], null, TODAY)).toMatchObject({ state: 'ok', partial: false })
  })

  it('groups by week block and by day, soonest first, symbols in order', () => {
    const view = dvdRead([
      div('PEP', '2026-12-04', 1.42), div('KO', '2026-11-20'), split('NVDA', '2026-11-24', '10:1'), div('AAPL', '2026-11-20', 0.26),
      div('MSFT', TODAY, 0.83), split('KO', '2026-11-20', '2:1'),
    ], null, TODAY)
    expect(view.buckets.map((b) => [b.key, b.count, b.days.map((d) => [d.date, d.rows.map((r) => `${r.sym} ${r.type}`)])])).toEqual([
      ['this', 4, [[TODAY, ['MSFT dividend']], ['2026-11-20', ['AAPL dividend', 'KO dividend', 'KO split']]]],
      ['next', 1, [['2026-11-24', ['NVDA split']]]],
      ['later', 1, [['2026-12-04', ['PEP dividend']]]],
    ])
    expect([view.count, view.dividends, view.splits, view.dropped]).toEqual([6, 4, 2, 0])
  })

  it('reads each field, and counts the rows it cannot place', () => {
    const view = dvdRead([
      { sym: ' ko ', type: 'dividend', date: '2026-11-20', amount: 0 }, { sym: 'PEP', type: 'split', date: '2026-11-20', ratio: '  ' },
      { sym: 'X', type: 'dividend', date: null, amount: 1 }, { sym: '', type: 'dividend', date: TODAY, amount: 1 },
      { sym: 'Y', type: 'earnings', date: TODAY }, null, 'junk', { sym: 'Z', type: 'split', date: '2026-11-31', ratio: '2:1' },
    ], null, TODAY)
    expect(view.count).toBe(2)
    expect(view.dropped).toBe(6)
    expect(view.buckets[0].days[0].rows).toEqual([
      { sym: 'KO', type: 'dividend', date: '2026-11-20', amount: null, ratio: null },
      { sym: 'PEP', type: 'split', date: '2026-11-20', amount: null, ratio: null },
    ])
  })
})

describe('the count line', () => {
  it('says whose events it counts, and an empty answer says so for that stock or for your stocks', () => {
    expect(countLine(dvdRead([], null, TODAY), null)).toBe('No dividend or split is declared ahead for your stocks.')
    expect(countLine(dvdRead([], null, TODAY), 'NVDA')).toBe('No dividend or split is declared ahead for NVDA.')
    expect(countLine(dvdRead([div('KO', TODAY)], null, TODAY), null)).toBe('1 ex-dividend date ahead for your stocks.')
    expect(countLine(dvdRead([split('NVDA', TODAY)], null, TODAY), 'NVDA')).toBe('1 split ahead for NVDA.')
    expect(countLine(dvdRead([div('KO', TODAY), div('PEP', TODAY), split('NVDA', TODAY), split('KO', TODAY)], null, TODAY), null))
      .toBe('2 ex-dividend dates and 2 splits ahead for your stocks.')
  })
})
