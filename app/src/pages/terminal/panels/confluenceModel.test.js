// CONFL, the pure half. Rails:
//   * the one URL read is the 30-day window the server keeps warm;
//   * the words a direction is typed as, and the command arguments a chip writes;
//   * the row shaping: one row per stock in the server's rank, the long-dated share turned from the
//     server's FRACTION into a percent exactly once, the bullish share kept as the percent sent,
//     a missing number kept missing (never 0);
//   * warming, could-not-build and not-a-board are three states, none of them an empty board.
// The fixture is the route's real shape (api/confluence_screen.py compute_board), with made-up
// tickers.
import { describe, it, expect } from 'vitest'
import {
  CONFLUENCE_BANDS, CONFLUENCE_CODE, CONFLUENCE_DAYS, CONFLUENCE_LEANS, CONFLUENCE_LEAN_ARG_WORDS, CONFLUENCE_URL, bandGroups,
  confluenceCommandArgs, confluenceRead, expiryDay, leanRows, leanWords, normConfluenceLean, parseConfluenceLean, windowEndDay,
  windowText,
} from './confluenceModel'

const DASH = String.fromCharCode(0x2013)
const BOARD = {
  ok: true,
  window: `Oct 6 ${DASH} Nov 14, 2026`,
  days: 30,
  rows: [
    {
      sym: 'AAA', band: 'L', dir: 'BULL', dpn: 1200000000, acc: 'Acc', net: 12400000.0, net5: 6000000.0, bull: 13000000.0, bear: 600000.0,
      bullPct: 96, top: { cp: 'C', strike: 420, exp: '1/15/2027', dte: 60, prem: 5200000.0 }, leapPrem: 6100000.0, leapShare: 0.482,
      status: 'BUILDING', freshRatio: 0.48, bigPrint: 88000000, bigDate: '11/03', dpLo: 170.5, dpHi: 195.25, dpAvg: 182.4, dpLast: 190.06,
      bigPrice: 181.0, sector: 'Technology', score: 2.732,
    },
    {
      sym: 'CCC', band: 'S', dir: 'BEAR', dpn: 41000000, acc: 'Dist', net: -3500000.0, net5: 0, bull: 100000.0, bear: 3600000.0,
      bullPct: 3, top: { cp: 'P', strike: 27.5, exp: '3/19/2027', dte: 123, prem: 2100000.0 }, leapPrem: 800000.0, leapShare: 0.216,
      status: 'ESTABLISHED', freshRatio: 0, bigPrint: 9000000, bigDate: '10/21', dpLo: 26.0, dpHi: 33.1, dpAvg: 30.0, dpLast: 28.5,
      bigPrice: 31.2, sector: null, score: 2.1,
    },
    {
      sym: 'bbb', band: 'M', dir: 'BULL', dpn: 90000000, acc: null, net: 4000000.0, net5: 800000.0, bull: 4400000.0, bear: 400000.0,
      bullPct: 92, top: { cp: 'C', strike: 55, exp: '6/18/2027', dte: 0, prem: 0 }, leapPrem: 3200000.0, leapShare: 0.8,
      status: 'STEADY', freshRatio: 0.2, bigPrint: 0, bigDate: null, dpLo: null, dpHi: null, dpAvg: null, dpLast: 61.2,
      bigPrice: null, sector: 'Industrials', score: 1.9,
    },
  ],
  counts: { total: 3, bull: 2, bear: 1, building: 1 },
  band_meta: { L: ['Large Cap', `$10B ${DASH} $500B`], M: ['Mid Cap', `$2B ${DASH} $10B`], S: ['Small Cap', '< $2B'] },
  allowedDays: [20, 30, 60, 90],
  warnings: null,
}
const WARMING = { ok: false, status: 'warming', reason: `board is computing ${String.fromCharCode(0x2014)} try again shortly`, rows: [] }
const DEGRADED = { ok: false, status: 'flow_unavailable', rows: [], days: 30, reason: 'flow-leg large/30d: timed out' }

describe('CONFL the route and the typed words', () => {
  it('reads only the 30-day window the server keeps warm', () => {
    expect(CONFLUENCE_CODE).toBe('CONFL')
    expect(CONFLUENCE_DAYS).toBe(30)
    expect(CONFLUENCE_URL).toBe('/api/confluence?days=30')
  })

  it('the words a direction is typed as, and the command arguments', () => {
    expect(Object.keys(CONFLUENCE_LEANS)).toEqual(['all', 'bullish', 'bearish'])
    for (const [raw, want] of [['BULL', 'bullish'], ['bull', 'bullish'], [' Bullish ', 'bullish'], ['long', 'bullish'], ['BEAR', 'bearish'],
      ['bears', 'bearish'], ['short', 'bearish'], ['ALL', 'all'], ['both', 'all']]) expect(parseConfluenceLean(raw), String(raw)).toBe(want)
    for (const bad of [null, undefined, '', 'nonsense', 'toString', 'constructor', '__proto__', 7]) expect(parseConfluenceLean(bad), String(bad)).toBeNull()
    expect(normConfluenceLean('nonsense')).toBe('all')
    expect(normConfluenceLean(null)).toBe('all')
    expect(normConfluenceLean('BEAR')).toBe('bearish')
    expect(confluenceCommandArgs({ lean: 'all' })).toEqual([])
    expect(confluenceCommandArgs({ lean: 'bullish' })).toEqual(['BULL'])
    expect(confluenceCommandArgs({ lean: 'bearish' })).toEqual(['BEAR'])
    expect(confluenceCommandArgs()).toEqual([])
    // every token a chip writes is a word the reader gives back as the same direction
    for (const [key, l] of Object.entries(CONFLUENCE_LEANS)) if (l.token) expect(parseConfluenceLean(l.token)).toBe(key)
    // every typed word names a direction the chips have
    for (const v of Object.values(CONFLUENCE_LEAN_ARG_WORDS)) expect(Object.keys(CONFLUENCE_LEANS)).toContain(v)
  })

  it('a date and the window are read as calendar text, never as a time', () => {
    expect(expiryDay('1/15/2027')).toBe('2027-01-15')
    expect(expiryDay('12/5/2026')).toBe('2026-12-05')
    for (const bad of [null, undefined, '', '2027-01-15', '13/40/2027', 'soon', 20270115]) expect(expiryDay(bad), String(bad)).toBeNull()
    expect(windowText(`Oct 6 ${DASH} Nov 14, 2026`)).toBe('Oct 6 to Nov 14, 2026')
    expect(windowText('Nov 14, 2026')).toBe('Nov 14, 2026')
    expect(windowText(null)).toBe('')
    expect(windowEndDay(`Oct 6 ${DASH} Nov 14, 2026`)).toBe('2026-11-14')
    expect(windowEndDay('Nov 3, 2026')).toBe('2026-11-03')
    for (const bad of [null, '', 'last month', 'Foo 3, 2026', 'Nov 40, 2026']) expect(windowEndDay(bad), String(bad)).toBeNull()
  })
})

describe('CONFL confluenceRead', () => {
  it('one row per stock in the server rank, with its dark pool, its flow and its largest contract', () => {
    const out = confluenceRead(BOARD)
    expect(out.state).toBe('ok')
    expect(out.rows.map((r) => [r.sym, r.band, r.direction, r.status])).toEqual([
      ['AAA', 'L', 'bullish', 'building'], ['CCC', 'S', 'bearish', 'established'], ['BBB', 'M', 'bullish', 'steady'],
    ])
    expect(out.rows.map((r) => r.order)).toEqual([0, 1, 2])
    expect(out.rows.map((r) => [r.darkPool, r.avgPrice, r.lastPrice])).toEqual([[1200000000, 182.4, 190.06], [41000000, 30, 28.5], [90000000, null, 61.2]])
    expect(out.rows.map((r) => [r.net, r.net5, r.bull, r.bear])).toEqual([[12400000, 6000000, 13000000, 600000], [-3500000, 0, 100000, 3600000], [4000000, 800000, 4400000, 400000]])
    expect(out.rows.map((r) => [r.side, r.strike, r.expiry, r.daysLeft, r.topPremium])).toEqual([
      ['call', 420, '2027-01-15', 60, 5200000], ['put', 27.5, '2027-03-19', 123, 2100000], ['call', 55, '2027-06-18', null, null],
    ])
    // the largest print: its dollar size, its price and its day are three different fields
    expect(out.rows.map((r) => [r.bigPrint, r.bigPrice, r.bigDate])).toEqual([[88000000, 181, '11/03'], [9000000, 31.2, '10/21'], [null, null, null]])
    expect(out.rows.map((r) => r.sector)).toEqual(['Technology', null, 'Industrials'])
    expect(out.counts).toEqual({ all: 3, bullish: 2, bearish: 1, building: 1 })
    expect(out).toMatchObject({ days: 30, window: 'Oct 6 to Nov 14, 2026', windowEnd: '2026-11-14', partial: false })
    expect(out.bands).toEqual({
      L: { name: 'Large cap', range: '$10B to $500B' }, M: { name: 'Mid cap', range: '$2B to $10B' }, S: { name: 'Small cap', range: 'under $2B' },
    })
  })

  it('the long-dated share is a fraction on the wire and a percent here; the bullish share is already a percent', () => {
    const out = confluenceRead(BOARD)
    // `leapShare` 0.482 is 48.2%, never 0.482% and never 4820%
    expect(out.rows.map((r) => Math.round(r.leapSharePct * 10) / 10)).toEqual([48.2, 21.6, 80])
    expect(out.rows.map((r) => r.leapPremium)).toEqual([6100000, 800000, 3200000])
    // `bullPct` 96 is 96%: never multiplied again
    expect(out.rows.map((r) => r.bullShare)).toEqual([96, 3, 92])
  })

  it('the last dark pool price against the average is worked out only when both are known', () => {
    const out = confluenceRead(BOARD)
    expect(out.rows[0].lastVsAvgPct).toBeCloseTo(4.1996, 3)
    expect(out.rows[1].lastVsAvgPct).toBeCloseTo(-5, 6)
    expect(out.rows[2].lastVsAvgPct).toBeNull()
  })

  it('a missing number stays missing, a stock sent twice is one row, and a row that cannot be placed is dropped', () => {
    const odd = confluenceRead({
      ok: true, days: '30', window: '',
      rows: [
        { sym: 'aaa', band: 'L', dir: 'BULL' },
        { sym: 'AAA', band: 'L', dir: 'BEAR', net: -9 },
        { band: 'L', dir: 'BULL' },
        null,
        { sym: 'ZZZ', band: 'L', dir: 'SIDEWAYS' },
        { sym: 'YYY', band: 'X', dir: 'BULL' },
        { sym: 'DDD', band: 's', dir: 'bear', leapShare: 0, dpAvg: 0, dpLast: 0, top: 'none', status: 'odd' },
      ],
    })
    expect(odd.rows.map((r) => r.sym)).toEqual(['AAA', 'DDD'])
    expect(odd.rows[0]).toMatchObject({
      direction: 'bullish', status: null, darkPool: null, avgPrice: null, lastPrice: null, lastVsAvgPct: null, net: null, bullShare: null,
      leapPremium: null, leapSharePct: null, side: null, strike: null, expiry: null, daysLeft: null, score: null,
    })
    // a share of 0 is a real 0%; a price of 0 is not a price
    expect(odd.rows[1]).toMatchObject({ band: 'S', direction: 'bearish', status: null, leapSharePct: 0, avgPrice: null, lastPrice: null })
    expect(odd).toMatchObject({ days: 30, window: '', windowEnd: null, partial: false })
    expect(odd.bands.S).toEqual(CONFLUENCE_BANDS.S)
  })

  it('warming, could not build and not-a-board are three states, none of them an empty board', () => {
    expect(confluenceRead(WARMING)).toMatchObject({ state: 'warming', rows: [] })
    expect(confluenceRead({ ok: false, status: 'warming', days: 30, reason: 'dark-pool 30d window building', rows: [] }).state).toBe('warming')
    expect(confluenceRead({ ok: false, reason: 'flow leg still computing on the worker' }).state).toBe('warming')
    expect(confluenceRead(DEGRADED)).toMatchObject({ state: 'unavailable', rows: [] })
    expect(confluenceRead({ ok: false }).state).toBe('unavailable')
    for (const body of [undefined, null, [], 'x', {}, { rows: [] }, { ok: true }, { ok: true, rows: 'none' }, { detail: 'Not authenticated' }]) {
      expect(confluenceRead(body).state, JSON.stringify(body)).toBe('failed')
    }
    expect(confluenceRead({ ...BOARD, rows: [] })).toMatchObject({ state: 'ok', rows: [], counts: { all: 0, bullish: 0, bearish: 0, building: 0 } })
  })

  it('a build the server marked with warnings is partial', () => {
    expect(confluenceRead({ ...BOARD, warnings: ['flow-leg mid_small/30d: timed out'] }).partial).toBe(true)
    expect(confluenceRead({ ...BOARD, warnings: [] }).partial).toBe(false)
  })
})

describe('CONFL filtering, grouping and wording', () => {
  const { rows } = confluenceRead(BOARD)

  it('a direction keeps its rows in the server order', () => {
    expect(leanRows(rows, 'all').map((r) => r.sym)).toEqual(['AAA', 'CCC', 'BBB'])
    expect(leanRows(rows, 'bullish').map((r) => r.sym)).toEqual(['AAA', 'BBB'])
    expect(leanRows(rows, 'BEAR').map((r) => r.sym)).toEqual(['CCC'])
    expect(leanRows(rows, 'nonsense').map((r) => r.sym)).toEqual(['AAA', 'CCC', 'BBB'])
  })

  it('the bands are listed large first, each in the server order, and an empty band is left out', () => {
    expect(bandGroups(rows).map((g) => [g.band, g.rows.map((r) => r.sym)])).toEqual([['L', ['AAA']], ['M', ['BBB']], ['S', ['CCC']]])
    expect(bandGroups(leanRows(rows, 'bullish')).map((g) => g.band)).toEqual(['L', 'M'])
    expect(bandGroups([])).toEqual([])
  })

  it('a direction is said with a word, and with how fresh the flow is', () => {
    expect(rows.map(leanWords)).toEqual(['Bullish, building', 'Bearish, established', 'Bullish, steady'])
    expect(leanWords({ direction: 'bearish', status: null })).toBe('Bearish')
    expect(leanWords({ direction: null })).toBe('Not given')
    expect(leanWords(undefined)).toBe('Not given')
  })
})
