// AUCT, the pure half. Rails:
//   * each server status becomes one panel state; anything unreadable is a failed read, never "none";
//   * rows are grouped by auction day in the order sent; a row with no day or no security is counted;
//   * a missing number stays null and prints "No figure", never 0; a bidder split with a class
//     missing is no split; the shares are the server's (nothing is worked out here);
//   * the words: the count line, the dates and source, a refusal, a failed look above the last good.
// Every security, amount and rate is invented.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AUCT_CODE, AUCT_RESULTS_SHOWN, AUCT_SOURCE, AUCT_URL, NO_FIGURE, amountWords, asOfSentence, auctionsRead, checkWords,
  countLine, coverWords, cutDays, cutWords, dateCell, rateKindWords, rateWords, securityWords, shareWords, tagWords, unavailableWords,
} from './treasuryAuctionsModel'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const up = (type, term, date, over = {}) => ({
  security_type: type, security_term: term, auction_date: date, issue_date: '2026-11-30', announced_date: '2026-11-12',
  offering_amount: 58_000_000_000, reopening: false, cusip: '00000AA11', ...over,
})
const split = (i, d, p) => ({
  indirect: { amount: i * 1e9, share: i }, direct: { amount: d * 1e9, share: d }, primary_dealers: { amount: p * 1e9, share: p }, total: 100e9,
})
const res = (type, term, date, over = {}) => ({
  security_type: type, security_term: term, auction_date: date, issue_date: '2026-11-16', maturity_date: '2036-11-15',
  offering_amount: 42_000_000_000, rate: 4.117, rate_kind: 'high_yield', bid_to_cover: 2.58, reopening: false, tips: false,
  floating_rate: false, cash_management: false, cusip: `0000${term.slice(0, 2)}`, bidders: split(70, 20, 10), ...over,
})
const BODY = (over = {}) => ({
  status: 'ok', as_of: '2026-11-17', upcoming_as_of: '2026-11-17', results_through: '2026-11-17', window_days: 45,
  upcoming: [up('Bond', '20-Year', '2026-11-19'), up('Bill', '13-Week', '2026-11-23'), up('Bill', '26-Week', '2026-11-23'), up('Note', '7-Year', '2026-11-24')],
  results: [res('Bill', '4-Week', '2026-11-17', { rate: 4.25, rate_kind: 'high_rate' }), res('Note', '10-Year', '2026-11-12'), res('Bond', '30-Year', '2026-11-12')],
  dropped: { upcoming: 0, results: 0 }, read_at: '2026-11-17T23:20:04+00:00', basis: 'as_published', source: AUCT_SOURCE, check: null, ...over,
})

describe('auctionsRead: one state per answer', () => {
  it('names the route, the code and the source', () => {
    expect([AUCT_CODE, AUCT_URL, AUCT_SOURCE, AUCT_RESULTS_SHOWN]).toEqual(['AUCT', '/api/research/treasury-auctions', 'US Treasury Fiscal Data', 12])
  })

  it('computing, unavailable (with its reason) and anything unreadable', () => {
    expect(auctionsRead({ status: 'computing' })).toEqual({ state: 'computing' })
    expect(auctionsRead({ status: 'unavailable', reason: 'refused', http_status: 403 })).toEqual({ state: 'unavailable', reason: 'refused', httpStatus: 403 })
    expect(auctionsRead({ status: 'unavailable', reason: 'shape', http_status: 200 })).toEqual({ state: 'unavailable', reason: 'shape', httpStatus: 200 })
    for (const bad of [undefined, null, [], 'ok', 7, {}, { status: 'failed', reason: 'source' }, { status: 'ok' },
      { status: 'ok', upcoming: [], results: null }, { status: 'ok', upcoming: {}, results: [] }, { status: 'weird', upcoming: [], results: [] }]) {
      expect(auctionsRead(bad), JSON.stringify(bad)).toEqual({ state: 'failed' })
    }
  })

  it('an answer with both lists empty is "none", an answer, with its dates kept', () => {
    const view = auctionsRead(BODY({ upcoming: [], results: [], as_of: null, upcoming_as_of: null, results_through: null }))
    expect(view.state).toBe('none')
    expect([view.upcomingCount, view.resultCount, view.asOf, view.windowDays]).toEqual([0, 0, null, 45])
  })

  it('ok: both lists by auction day in the order sent, with the dates, the read time and the counts', () => {
    const view = auctionsRead(BODY())
    expect(view.state).toBe('ok')
    expect([view.asOf, view.upcomingAsOf, view.resultsThrough, view.windowDays, view.readAt, view.check]).toEqual(
      ['2026-11-17', '2026-11-17', '2026-11-17', 45, '2026-11-17T23:20:04+00:00', null])
    expect(view.upcoming.map((d) => [d.date, d.rows.map((r) => r.term)])).toEqual([
      ['2026-11-19', ['20-Year']], ['2026-11-23', ['13-Week', '26-Week']], ['2026-11-24', ['7-Year']]])
    expect(view.results.map((d) => [d.date, d.rows.map((r) => r.term)])).toEqual([['2026-11-17', ['4-Week']], ['2026-11-12', ['10-Year', '30-Year']]])
    expect([view.upcomingCount, view.resultCount, view.dropped]).toEqual([4, 3, 0])
    expect(view.upcoming[0].rows[0]).toEqual({
      type: 'Bond', term: '20-Year', auctionDate: '2026-11-19', issueDate: '2026-11-30', amount: 58_000_000_000, reopening: false,
      cusip: '00000AA11', announcedDate: '2026-11-12',
    })
    const r = view.results[0].rows[0]
    expect([r.rate, r.rateKind, r.cover, r.maturityDate, r.tips, r.frn, r.cmb]).toEqual([4.25, 'high_rate', 2.58, '2036-11-15', false, false, false])
    expect(r.bidders).toEqual({ indirect: { share: 70, amount: 70e9 }, direct: { share: 20, amount: 20e9 }, dealers: { share: 10, amount: 10e9 } })
  })

  it('only one list filled is still ok', () => {
    expect(auctionsRead(BODY({ upcoming: [] })).state).toBe('ok')
    expect(auctionsRead(BODY({ results: [] })).state).toBe('ok')
  })

  it('a row with no day or no security is left out and counted, with the rows the server skipped', () => {
    const view = auctionsRead(BODY({
      upcoming: [up('Note', '7-Year', '2026-11-24'), up('', '5-Year', '2026-11-25'), up('Note', '2-Year', 'soon'), null, 'x'],
      results: [res('Note', '10-Year', '2026-11-12'), res('Bond', '30-Year', null)],
      dropped: { upcoming: 2, results: 1 },
    }))
    expect([view.upcomingCount, view.resultCount]).toEqual([1, 1])
    expect(view.dropped).toBe(2 + 1 + 4 + 1)
    expect(auctionsRead(BODY({ dropped: null })).dropped).toBe(0)
    expect(auctionsRead(BODY({ dropped: { upcoming: -3, results: 'many' } })).dropped).toBe(0)
  })

  it('a missing number stays null, never 0; a text number is not a number', () => {
    const view = auctionsRead(BODY({
      upcoming: [up('Note', '7-Year', '2026-11-24', { offering_amount: null, reopening: null, issue_date: null, announced_date: 'x', cusip: '' })],
      results: [res('Note', '10-Year', '2026-11-12', { rate: null, rate_kind: 'high_yield', bid_to_cover: '2.58', offering_amount: undefined, bidders: null })],
    }))
    const u = view.upcoming[0].rows[0]
    expect([u.amount, u.reopening, u.issueDate, u.announcedDate, u.cusip]).toEqual([null, null, null, null, null])
    const r = view.results[0].rows[0]
    expect([r.rate, r.rateKind, r.cover, r.amount, r.bidders]).toEqual([null, null, null, null, null])
  })

  it('a rate of a kind this screen does not know keeps its figure and names no kind', () => {
    const r = auctionsRead(BODY({ results: [res('Note', '10-Year', '2026-11-12', { rate_kind: 'something_new' })] })).results[0].rows[0]
    expect([r.rate, r.rateKind]).toEqual([4.117, null])
  })

  it('a bidder split with a class missing is no split at all', () => {
    const broken = [
      { indirect: { share: 70 }, direct: { share: 20 } },
      { indirect: { share: 70 }, direct: { share: null }, primary_dealers: { share: 10 } },
      { indirect: { share: '70' }, direct: { share: 20 }, primary_dealers: { share: 10 } },
      'none', [],
    ]
    for (const bidders of broken) {
      expect(auctionsRead(BODY({ results: [res('Note', '10-Year', '2026-11-12', { bidders })] })).results[0].rows[0].bidders, JSON.stringify(bidders)).toBeNull()
    }
  })

  it('a look that did not go well comes through with its reason', () => {
    expect(auctionsRead(BODY({ check: { state: 'failed', reason: 'source', http_status: null, at: 'x' } })).check).toEqual({ state: 'failed', reason: 'source', httpStatus: null })
    expect(auctionsRead(BODY({ check: { state: 'unavailable', reason: 'refused', http_status: 403 } })).check).toEqual({ state: 'unavailable', reason: 'refused', httpStatus: 403 })
    expect(auctionsRead(BODY({ check: 'bad' })).check).toBeNull()
  })

  it('never works a share out: the model has no division and no sum of the classes', () => {
    const src = fs.readFileSync(path.join(HERE, 'treasuryAuctionsModel.js'), 'utf8').split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n')
    expect(src).not.toMatch(/\.amount\s*[/+*]/)
    expect(src).not.toMatch(/\/\s*\w*[tT]otal/)
    expect(src).not.toMatch(/\*\s*100/)
  })
})

describe('cutDays', () => {
  it('keeps the first rows across whole-day groups, in order', () => {
    const days = auctionsRead(BODY()).results
    expect(cutDays(days, 2).map((d) => [d.date, d.rows.length])).toEqual([['2026-11-17', 1], ['2026-11-12', 1]])
    expect(cutDays(days, 1).map((d) => d.date)).toEqual(['2026-11-17'])
    expect(cutDays(days, 99)).toEqual(days)
    expect(cutDays(days, 0)).toEqual([])
  })
})

describe('the words', () => {
  it('a security is its term and type; its tags say what else it is', () => {
    expect(securityWords({ type: 'Note', term: '7-Year' })).toBe('7-Year Note')
    expect(securityWords({ type: 'Bill', term: null })).toBe('Bill')
    expect(tagWords({ tips: true, frn: false, cmb: false, reopening: true })).toBe('TIPS, reopening')
    expect(tagWords({ tips: false, frn: true, cmb: true, reopening: false })).toBe('floating rate, cash management')
    expect(tagWords({ reopening: null })).toBe('')
  })

  it('figures go through the app formatters, and a missing one is "No figure", never 0', () => {
    expect(amountWords(58_000_000_000)).toBe('$58.00B')
    expect(amountWords(650_000_000)).toBe('$650.0M')
    expect(rateWords(4.117)).toBe('4.117%')
    expect(rateWords(4.25)).toBe('4.250%')
    expect(coverWords(2.58)).toBe('2.58')
    expect(coverWords(3)).toBe('3.00')
    expect(shareWords(70)).toBe('70.0%')
    expect(shareWords(8.26)).toBe('8.3%')
    for (const f of [amountWords, rateWords, coverWords, shareWords]) {
      for (const v of [null, undefined, '', '4.1', NaN]) expect(f(v), `${f.name} ${v}`).toBe(NO_FIGURE)
    }
    expect(rateWords(0)).toBe('0.000%')
    expect(rateKindWords('high_yield')).toBe('high yield')
    expect(rateKindWords('high_rate')).toBe('high rate')
    expect(rateKindWords('high_discount_margin')).toBe('high discount margin')
    expect(rateKindWords(null)).toBe('')
    expect(dateCell('2026-11-30')).toBe('Nov 30')
    expect(dateCell(null)).toBe('Not given')
  })

  it('the count line says how many are coming, the next one, and how many were held', () => {
    const view = auctionsRead(BODY())
    expect(countLine(view, '2026-11-18')).toBe('4 auctions are coming up, the next on Thu Nov 19. 3 auctions in the last 45 days are listed with their results.')
    expect(countLine(view, '2026-11-19')).toContain('the next today.')
    const one = auctionsRead(BODY({ upcoming: [up('Note', '7-Year', '2026-11-24')], results: [res('Note', '10-Year', '2026-11-12')] }))
    expect(countLine(one, '2026-11-18')).toBe('1 auction is coming up, the next on Tue Nov 24. 1 auction in the last 45 days is listed with its results.')
    const none = auctionsRead(BODY({ upcoming: [], results: [], window_days: 30 }))
    expect(countLine(none, '2026-11-18')).toBe('The Treasury lists no auction from today on. No auction is listed for the last 30 days.')
  })

  it('the dates of both lists and the source are one sentence', () => {
    expect(asOfSentence(auctionsRead(BODY()))).toBe(
      "The list of coming auctions is the Treasury's as of Nov 17, 2026. Results run through Nov 17, 2026. Source: US Treasury Fiscal Data.")
    expect(asOfSentence(auctionsRead(BODY({ upcoming_as_of: null })))).toBe('Results run through Nov 17, 2026. Source: US Treasury Fiscal Data.')
    expect(asOfSentence(auctionsRead(BODY({ upcoming_as_of: null, results_through: null })))).toBe('The answer carries no date of its own. Source: US Treasury Fiscal Data.')
  })

  it('a refusal and an unreadable answer are said in plain words', () => {
    expect(unavailableWords('refused', 403)).toBe("Treasury auctions are not available right now: the Treasury's data service refused the server's request (it answered 403).")
    expect(unavailableWords('refused', null)).toBe("Treasury auctions are not available right now: the Treasury's data service refused the server's request.")
    expect(unavailableWords('shape', 200)).toBe("Treasury auctions are not available right now: the Treasury's data service answered, but not with rows this screen can read.")
  })

  it('a failed look is said above the last good records, with their date', () => {
    expect(checkWords({ state: 'failed', reason: 'source' }, '2026-11-17')).toBe(
      'The last look for newer auction records did not get an answer. These are the last records the site read, through Nov 17, 2026.')
    expect(checkWords({ state: 'unavailable', reason: 'refused', httpStatus: 403 }, '2026-11-17')).toBe(
      "The Treasury's data service refused the server's request (it answered 403). These are the last records the site read, through Nov 17, 2026.")
    expect(checkWords({ state: 'failed' }, null)).toBe('The last look for newer auction records did not get an answer. These are the last records the site read.')
  })
})

describe('a list the server cut', () => {
  it('reads the cut flags the server sends, and only a true one counts', () => {
    expect(auctionsRead(BODY()).cut).toEqual({ upcoming: false, results: false })
    expect(auctionsRead(BODY({ cut: { upcoming: false, results: true } })).cut).toEqual({ upcoming: false, results: true })
    expect(auctionsRead(BODY({ cut: { upcoming: 'yes', results: 1 } })).cut).toEqual({ upcoming: false, results: false })
    expect(auctionsRead(BODY({ cut: null })).cut).toEqual({ upcoming: false, results: false })
  })

  it('says which list was cut and from which end, or nothing', () => {
    expect(cutWords({ upcoming: false, results: false })).toBeNull()
    expect(cutWords(undefined)).toBeNull()
    expect(cutWords({ upcoming: false, results: true })).toBe(
      'The results held more rows than the site reads at once, newest first: the oldest results are not shown.')
    expect(cutWords({ upcoming: true, results: false })).toBe(
      'The list of coming auctions held more rows than the site reads at once, newest first: the oldest copies of the list of '
      + 'coming auctions are not read, so an auction listed only there is not shown.')
    expect(cutWords({ upcoming: true, results: true })).toMatch(/^Both lists held more rows than the site reads at once, newest first: the oldest results are not shown, and the oldest copies/)
  })
})
