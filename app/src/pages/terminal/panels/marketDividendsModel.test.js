// DVD MARKET's pure half (marketDividendsModel.js). Every symbol, name, date and amount is invented.
import { describe, it, expect } from 'vitest'
import {
  DVD_MARKET_COMPUTING_POLL_MS, DVD_MARKET_HELD_POLL_MS, DVD_MARKET_URL, DVD_VIEW_ARG_WORDS, cadenceWords, cashWords, cutWords,
  declaredWords, dvdViewCommandArgs, legWords, marketCountLine, marketDividendsRead, marketPollMs, marketSplitWords, normDvdView,
  notFollowedWords, parseDvdView, payWords, windowWords,
} from './marketDividendsModel'

const TODAY = '2031-03-12'
const dv = (sym, ex, over = {}) => ({ sym, name: `${sym} Holdings`, ex_date: ex, amount: 0.25, currency: 'USD', frequency: 4, type: 'CD',
  pay_date: '2031-03-28', declared_date: '2031-02-20', record_date: ex, ...over })
const sp = (sym, date, ratio = '4:1', over = {}) => ({ sym, name: null, date, split_from: 1, split_to: 4, ratio, reverse: false, ...over })
const BODY = (over = {}) => ({
  status: 'ok', window: { from: '2031-03-10', to: '2031-03-23' }, current_window: { from: '2031-03-10', to: '2031-03-23' },
  stale_window: false, read_at: '2031-03-12T14:02:00+00:00', source: 'Massive reference data', check: null,
  dividends: [dv('QQZB', '2031-03-18'), dv('QQZA', '2031-03-11'), dv('QQZC', '2031-03-11', { amount: null })],
  splits: [sp('QQZD', '2031-03-19'), sp('QQZE', '2031-03-13', '1:10', { reverse: true })],
  legs: { dividends: 'ok', splits: 'ok' },
  counts: { dividends: 3, splits: 2, not_followed_dividends: 41, not_followed_splits: 1 },
  cut: { dividends: false, splits: false }, dropped: { dividends: 0, splits: 0 }, caps: { dividends: 2000, splits: 300 },
  ...over,
})

describe('the view word', () => {
  it('MARKET and MKT are the market view; anything else is not a view word', () => {
    expect(DVD_VIEW_ARG_WORDS).toEqual({ MARKET: 'market', MKT: 'market' })
    expect(parseDvdView('market')).toBe('market')
    expect(parseDvdView(' MKT ')).toBe('market')
    for (const no of ['ALL', 'MINE', 'NVDA', '', null, undefined]) expect(parseDvdView(no), String(no)).toBeNull()
    expect(normDvdView('market')).toBe('market')
    expect(normDvdView('anything')).toBe('mine')
    expect(dvdViewCommandArgs({ view: 'market' })).toEqual(['MARKET'])
    expect(dvdViewCommandArgs({ view: 'mine' })).toEqual([])
    expect(DVD_MARKET_URL).toBe('/api/research/market-dividends')
  })

  it('asks every 3 seconds while the server reads, every half hour once held', () => {
    expect(marketPollMs({ status: 'computing' })).toBe(DVD_MARKET_COMPUTING_POLL_MS)
    expect(marketPollMs({ status: 'ok' })).toBe(DVD_MARKET_HELD_POLL_MS)
    expect(marketPollMs(undefined)).toBe(DVD_MARKET_HELD_POLL_MS)
    expect([DVD_MARKET_COMPUTING_POLL_MS, DVD_MARKET_HELD_POLL_MS]).toEqual([3000, 1800000])
  })
})

describe('reading the answer', () => {
  it('not an answer, computing and a failed read are each their own state, never an empty list', () => {
    for (const body of [null, [], 'x', { status: 'ok' }, { status: 'ok', dividends: [] }, { status: 'weird', dividends: [], splits: [] }]) {
      expect(marketDividendsRead(body, TODAY).state, JSON.stringify(body)).toBe('failed')
    }
    expect(marketDividendsRead({ status: 'computing' }, TODAY)).toEqual({ state: 'computing' })
    expect(marketDividendsRead({ status: 'failed', reason: 'source' }, TODAY)).toEqual({ state: 'unavailable', reason: 'source' })
  })

  it('groups dividends by ex-date into this week and next, soonest first, then by symbol', () => {
    const v = marketDividendsRead(BODY(), TODAY)
    expect(v.state).toBe('ok')
    expect(v.dividendBuckets.map((b) => [b.key, b.count])).toEqual([['this', 2], ['next', 1]])
    expect(v.dividendBuckets[0].days.map((d) => [d.date, d.rows.map((r) => r.sym)])).toEqual([['2031-03-11', ['QQZA', 'QQZC']]])
    expect(v.dividendBuckets[1].days[0].rows[0]).toMatchObject({ sym: 'QQZB', exDate: '2031-03-18', payDate: '2031-03-28', declaredDate: '2031-02-20' })
    expect(v.splitBuckets.flatMap((b) => b.days.map((d) => d.date))).toEqual(['2031-03-13', '2031-03-19'])
    expect([v.dividendCount, v.splitCount]).toEqual([3, 2])
    expect(v.notFollowed).toEqual({ dividends: 41, splits: 1 })
    expect(v.symbols).toEqual(['QQZA', 'QQZC', 'QQZB', 'QQZE', 'QQZD'])
    expect(v.window).toEqual({ from: '2031-03-10', to: '2031-03-23' })
    expect(v.readAt).toBe('2031-03-12T14:02:00+00:00')
  })

  it('a row with no day or no symbol is dropped and counted with the server\'s own count', () => {
    const v = marketDividendsRead(BODY({ dividends: [dv('QQZA', '2031-03-11'), dv('', '2031-03-11'), dv('QQZB', 'soon')],
      splits: [sp('QQZD', null)], dropped: { dividends: 2, splits: 1 } }), TODAY)
    expect(v.dividendCount).toBe(1)
    expect(v.dropped).toBe(6)
  })

  it('an answered, empty list is "none"', () => {
    const v = marketDividendsRead(BODY({ dividends: [], splits: [] }), TODAY)
    expect(v.state).toBe('none')
    expect(marketCountLine(v, TODAY)).toBe('No ex-dividend date or split is listed for the stocks the site follows, Mon Mar 10 to Sun Mar 23.')
  })

  it('a stale window, a failed later look and a failed leg are carried', () => {
    const v = marketDividendsRead(BODY({ stale_window: true, current_window: { from: '2031-03-17', to: '2031-03-30' },
      check: { state: 'failed', reason: 'source' }, legs: { dividends: 'ok', splits: 'failed' } }), TODAY)
    expect(v.staleWindow).toBe(true)
    expect(v.currentWindow).toEqual({ from: '2031-03-17', to: '2031-03-30' })
    expect(v.check).toEqual({ state: 'failed', reason: 'source' })
    expect(legWords(v)).toBe('The splits could not be read from the data vendor just now, so none are shown. That is not the same as no splits.')
    expect(legWords(marketDividendsRead(BODY({ legs: { dividends: 'failed', splits: 'ok' } }), TODAY))).toContain('That is not the same as no dividends.')
    expect(legWords(marketDividendsRead(BODY(), TODAY))).toBe('')
  })
})

describe('words', () => {
  it('the count line names both kinds and the window', () => {
    expect(marketCountLine(marketDividendsRead(BODY(), TODAY), TODAY))
      .toBe('3 ex-dividend dates and 2 splits for the stocks the site follows, Mon Mar 10 to Sun Mar 23.')
    expect(marketCountLine(marketDividendsRead(BODY({ splits: [] }), TODAY), TODAY))
      .toBe('3 ex-dividend dates for the stocks the site follows, Mon Mar 10 to Sun Mar 23.')
    expect(windowWords(null, TODAY)).toBe('this week and next')
  })

  it('a missing amount is never $0; another currency carries its code, not a dollar sign', () => {
    expect(cashWords({ amount: 0.25, currency: 'USD' })).toBe('$0.25')
    expect(cashWords({ amount: 0.0125, currency: 'USD' })).toBe('$0.0125')
    expect(cashWords({ amount: null })).toBe('Amount not given')
    expect(cashWords({ amount: 0 })).toBe('Amount not given')
    expect(cashWords({ amount: 0.45, currency: 'CAD' })).toBe('0.45 CAD')
    expect(cashWords({ amount: 1.2345, currency: 'CAD' })).toBe('1.2345 CAD')
  })

  it('how often, and what kind', () => {
    expect(cadenceWords({ frequency: 4, type: 'CD' })).toBe('Quarterly')
    expect(cadenceWords({ frequency: 12 })).toBe('Monthly')
    expect(cadenceWords({ frequency: 0, type: 'SC' })).toBe('Special, one-time')
    expect(cadenceWords({ frequency: null, type: 'LT' })).toBe('Long-term capital gain')
    expect(cadenceWords({ frequency: 7 })).toBe('Frequency not given')
    expect(cadenceWords({})).toBe('Frequency not given')
  })

  it('pay and declared days in words; a split ratio in words', () => {
    expect(payWords({ payDate: '2031-03-28' }, TODAY)).toBe('Pays Fri Mar 28')
    expect(payWords({ payDate: null }, TODAY)).toBe('Pay date not given')
    expect(declaredWords({ declaredDate: '2031-02-20' }, TODAY)).toBe('Declared Thu Feb 20')
    expect(declaredWords({ declaredDate: null }, TODAY)).toBe('')
    expect(marketSplitWords({ ratio: '4:1' })).toBe('4 for 1')
    expect(marketSplitWords({ ratio: '1:10' })).toBe('1 for 10 (reverse split)')
    expect(marketSplitWords({ ratio: null })).toBe('Ratio not given')
  })

  it('what was left out and what was cut, in words', () => {
    expect(notFollowedWords(marketDividendsRead(BODY(), TODAY)))
      .toBe('The feed also lists 41 ex-dividend dates and 1 split for funds, preferred shares and stocks the site does not follow; they are not shown.')
    expect(notFollowedWords(marketDividendsRead(BODY({ counts: {} }), TODAY))).toBe('')
    expect(cutWords(marketDividendsRead(BODY({ cut: { dividends: true, splits: false } }), TODAY)))
      .toBe('The list is longer than the panel holds: it shows the first 2,000 ex-dividend dates, soonest first; the latest days are left out.')
    expect(cutWords(marketDividendsRead(BODY(), TODAY))).toBe('')
  })
})
