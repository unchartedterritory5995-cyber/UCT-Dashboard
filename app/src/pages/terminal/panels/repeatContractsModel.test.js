// ACCUM, the pure half. Rails:
//   * today's two URLs are exactly the keys the flow-worker keeps warm; a past day adds only the date;
//   * the words an order is typed as, a typed day, the weekday before a day, the command arguments;
//   * the day's read: dollars as sent, the bullish share worked out from the dollars (the route
//     sends no percent), a day with no tape told apart from a failed read, a cut day reported;
//   * the contracts: one row per contract in the order sent, the share on the heavier side worked
//     out from the dollars (the route's own shares are fractions and are not used), the top grade's
//     picture dropped, a missing number kept missing (never 0);
//   * the two orders.
// The fixtures are the routes' real shapes (api/live_massive_router.py _build_day_stats and
// _build_by_contract), with made-up tickers.
import { describe, it, expect } from 'vitest'
import {
  REPEAT_CODE, REPEAT_MIN_HITS, REPEAT_ORDERS, REPEAT_ORDER_ARG_WORDS, dayRead, dayReadUrl, directionWords, isoDay, leanPhrase,
  normRepeatDate, normRepeatOrder, orderRows, parseRepeatOrder, previousWeekday, repeatCommandArgs, repeatContractsUrl, repeatRead,
} from './repeatContractsModel'

const ROCKET = String.fromCodePoint(0x1F680)
const DAY = {
  query_date: '11/16/2026', total_classified: 5120, directional_count: 4210, covers_from: null,
  bull_premium: 812000000.0, bear_premium: 640000000.0, bull_count: 2500, bear_count: 1710,
  by_dte: [{ label: '0-7d', bull: 1, bear: 2, count: 3 }],
  top_bull: [{ ticker: 'AAA', premium: 40000000.0 }, { ticker: 'bbb', premium: 22000000.0 }],
  top_bear: [{ ticker: 'CCC', premium: 31000000.0 }],
  last_hour: { bull_premium: 90000000.0, bear_premium: 60000000.0, count: 300, is_today_target: true, top_tickers: [] },
}
const NO_TAPE = {
  query_date: '11/15/2026', total_classified: 0, directional_count: 0, covers_from: null, bull_premium: 0, bear_premium: 0, bull_count: 0,
  bear_count: 0, by_dte: [], top_bull: [], top_bear: [], last_hour: { bull_premium: 0, bear_premium: 0, count: 0, is_today_target: true, top_tickers: [] },
}
const CONTRACTS = {
  query_date: '11/16/2026', stock_etf: 'all', min_hits: 3, contract_count: 3, budget_cut_days: [],
  contracts: [
    {
      ticker: 'AAA', cp: 'C', strike: 420.0, exp: '12/18/2026', source: 'stocks', dte: 32, avg_fill: 4.2, spot: 401.5, hit_count: 14,
      qualifying_hits: 9, floor: 250000, total_premium: 2240000, total_volume: 5300, bull_premium: 1926400, bear_premium: 0, direction: 'Bull',
      consistency: 1.0, sided_pct: 0.86, cum_voi: 4.4, max_oi: 1200, grade: 'A', accumulation_grade: 'A', accumulation_score: 7.1,
      accumulation_shape: 'intraday_burst', swift_hits: 6, steady_hits: 8, burst_rising: true, is_intraday_burst: true, dormant: false,
      score: 50000000, first_ts: 1794839400, last_ts: 1794855600, prints: [],
    },
    {
      ticker: 'bbb', cp: 'P', strike: 27.5, exp: '1/15/2027', source: 'stocks', dte: 60, hit_count: 4, qualifying_hits: 4, floor: 15000,
      total_premium: 400000, total_volume: 900, bull_premium: 100000, bear_premium: 220000, direction: 'Mixed', consistency: 0.69,
      sided_pct: 0.8, cum_voi: null, max_oi: 0, accumulation_grade: `A+ ${ROCKET}`, accumulation_shape: 'single', swift_hits: 1,
      burst_rising: false, is_intraday_burst: false, dormant: true, score: 90000000, first_ts: 1794840000, last_ts: 1794852000, prints: [],
    },
    {
      ticker: 'CCC', cp: 'P', strike: 150, exp: '3/19/2027', source: 'stocks', dte: 123, hit_count: 3, qualifying_hits: 3, floor: 25000,
      total_premium: 900000, total_volume: 2100, bull_premium: 0, bear_premium: 0, direction: 'Unclear', consistency: 0.0, sided_pct: 0.0,
      cum_voi: 0.6, max_oi: 5000, accumulation_grade: 'C', accumulation_shape: 'single', swift_hits: 2, burst_rising: false,
      is_intraday_burst: false, dormant: false, score: 100000, first_ts: 1794841000, last_ts: 1794848400, prints: [],
    },
  ],
}

describe('ACCUM the routes and the typed words', () => {
  it('today reads exactly the two keys the flow-worker keeps warm; a past day adds only the date', () => {
    expect(REPEAT_CODE).toBe('ACCUM')
    expect(REPEAT_MIN_HITS).toBe(3)
    // day-stats key (today, exclude_algo False, 'all'); by-contract key (today, 'all', 3, True, 1)
    expect(dayReadUrl()).toBe('/api/live/massive/day-stats?stock_etf=all')
    expect(repeatContractsUrl()).toBe('/api/live/massive/by-contract?stock_etf=all&min_hits=3&lookback_days=1')
    expect(dayReadUrl('2026-11-13')).toBe('/api/live/massive/day-stats?stock_etf=all&target_date=2026-11-13')
    expect(repeatContractsUrl('2026-11-13')).toBe('/api/live/massive/by-contract?stock_etf=all&min_hits=3&lookback_days=1&target_date=2026-11-13')
    // a day that is not a real day is today, never a guess sent to the server
    for (const bad of [null, undefined, '', 'yesterday', '2026-02-30', '11/13/2026', '2026-11-13&x=1']) {
      expect(dayReadUrl(bad), String(bad)).toBe(dayReadUrl())
      expect(repeatContractsUrl(bad), String(bad)).toBe(repeatContractsUrl())
    }
  })

  it('a typed day, and the weekday before it', () => {
    expect(normRepeatDate('2026-11-13')).toBe('2026-11-13')
    expect(normRepeatDate(' 2026-11-13 ')).toBe('2026-11-13')
    for (const bad of [null, undefined, '', '2026-13-01', '2026-02-30', '2026-2-3', 'today', 20261113]) expect(normRepeatDate(bad), String(bad)).toBeNull()
    expect(previousWeekday('2026-11-16')).toBe('2026-11-13')   // Monday -> Friday
    expect(previousWeekday('2026-11-15')).toBe('2026-11-13')   // Sunday -> Friday
    expect(previousWeekday('2026-11-14')).toBe('2026-11-13')   // Saturday -> Friday
    expect(previousWeekday('2026-11-13')).toBe('2026-11-12')   // Friday -> Thursday
    expect(previousWeekday('2027-01-01')).toBe('2026-12-31')   // across a year
    expect(previousWeekday('2026-03-02')).toBe('2026-02-27')   // across a month
    expect(previousWeekday('nonsense')).toBeNull()
    expect(previousWeekday(null)).toBeNull()
  })

  it('the words an order is typed as, and the command arguments', () => {
    expect(Object.keys(REPEAT_ORDERS)).toEqual(['strong', 'latest'])
    for (const [raw, want] of [['LATEST', 'latest'], ['latest', 'latest'], [' Recent ', 'latest'], ['newest', 'latest'], ['STRONG', 'strong'],
      ['strongest', 'strong'], ['score', 'strong']]) expect(parseRepeatOrder(raw), String(raw)).toBe(want)
    for (const bad of [null, undefined, '', 'nonsense', 'toString', 'constructor', '__proto__', 7]) expect(parseRepeatOrder(bad), String(bad)).toBeNull()
    expect(normRepeatOrder('nonsense')).toBe('strong')
    expect(normRepeatOrder(null)).toBe('strong')
    expect(repeatCommandArgs()).toEqual([])
    expect(repeatCommandArgs({ order: 'strong' })).toEqual([])
    expect(repeatCommandArgs({ order: 'latest' })).toEqual(['LATEST'])
    expect(repeatCommandArgs({ date: '2026-11-13' })).toEqual(['2026-11-13'])
    expect(repeatCommandArgs({ date: '2026-11-13', order: 'latest' })).toEqual(['2026-11-13', 'LATEST'])
    expect(repeatCommandArgs({ date: 'someday', order: 'latest' })).toEqual(['LATEST'])
    // every token a chip writes is a word the reader gives back as the same order
    for (const [key, o] of Object.entries(REPEAT_ORDERS)) if (o.token) expect(parseRepeatOrder(o.token)).toBe(key)
    for (const v of Object.values(REPEAT_ORDER_ARG_WORDS)) expect(Object.keys(REPEAT_ORDERS)).toContain(v)
  })

  it('isoDay reads the store date and an ISO date as a calendar date, and nothing else', () => {
    expect(isoDay('11/16/2026')).toBe('2026-11-16')
    expect(isoDay('1/5/2027')).toBe('2027-01-05')
    expect(isoDay('2026-10-02')).toBe('2026-10-02')
    for (const bad of [null, undefined, '', 'yesterday', '13/40/2026', '2026-13-01', 20261116, '11-16-2026']) expect(isoDay(bad), String(bad)).toBeNull()
  })
})

describe('ACCUM dayRead', () => {
  it('the dollars as sent, and the bullish share worked out from them', () => {
    const out = dayRead(DAY)
    expect(out).toMatchObject({
      state: 'ok', date: '2026-11-16', bull: 812000000, bear: 640000000, net: 172000000, lean: 'bullish', trades: 4210, classified: 5120,
      hasTape: true, coversFrom: null,
    })
    // 812 / (812 + 640): a percent between 0 and 100, never the fraction 0.559
    expect(out.bullSharePct).toBeCloseTo(55.923, 2)
    expect(out.lastHour).toEqual({ bull: 90000000, bear: 60000000, count: 300, live: true })
    expect(out.topBull).toEqual([{ sym: 'AAA', premium: 40000000 }, { sym: 'BBB', premium: 22000000 }])
    expect(out.topBear).toEqual([{ sym: 'CCC', premium: 31000000 }])
    expect(leanPhrase(out)).toBe('Bullish premium leads')
  })

  it('bearish, even, and a day with no tape are told apart; a cut day says where it starts', () => {
    expect(dayRead({ ...DAY, bull_premium: 10, bear_premium: 30 })).toMatchObject({ lean: 'bearish', bullSharePct: 25, net: -20 })
    expect(leanPhrase({ lean: 'bearish' })).toBe('Bearish premium leads')
    expect(dayRead({ ...DAY, bull_premium: 5, bear_premium: 5 })).toMatchObject({ lean: 'even', bullSharePct: 50 })
    expect(leanPhrase({ lean: 'even' })).toBe('Bullish and bearish premium are even')
    const none = dayRead(NO_TAPE)
    // no premium on either side: there is no share to state, and it is never 0% or 50%
    expect(none).toMatchObject({ state: 'ok', date: '2026-11-15', bull: 0, bear: 0, lean: null, bullSharePct: null, hasTape: false, trades: 0 })
    expect(leanPhrase(none)).toBe('No directional premium has been read')
    expect(dayRead({ ...NO_TAPE, total_classified: 12 }).hasTape).toBe(true)
    const cut = dayRead({ ...DAY, covers_from: 1794847560 })
    expect(cut.coversFrom).toBe(new Date(1794847560 * 1000).toISOString())
    // an older answer without directional_count falls back to the two counts
    expect(dayRead({ ...DAY, directional_count: undefined }).trades).toBe(4210)
    expect(dayRead({ ...DAY, directional_count: undefined, bull_count: undefined }).trades).toBeNull()
    expect(dayRead({ ...DAY, last_hour: undefined }).lastHour).toBeNull()
    expect(dayRead({ ...DAY, last_hour: { ...DAY.last_hour, is_today_target: false } }).lastHour.live).toBe(false)
  })

  it('anything that is not the route\'s shape is a failed read, never a day of zeros', () => {
    for (const body of [undefined, null, [], 'x', {}, { query_date: '11/16/2026' }, { bull_premium: 5 }, { bull_premium: 'lots', bear_premium: 1 },
      { detail: 'This data requires a paid plan' }, CONTRACTS]) {
      const out = dayRead(body)
      expect(out.state, JSON.stringify(body)?.slice(0, 60)).toBe('failed')
      expect(out.bull).toBeNull()
    }
  })
})

describe('ACCUM repeatRead', () => {
  it('one row per contract in the order sent, with the hits, the premium and the contract', () => {
    const out = repeatRead(CONTRACTS)
    expect(out).toMatchObject({ state: 'ok', date: '2026-11-16', minHits: 3 })
    expect(out.rows.map((r) => [r.sym, r.side, r.strike, r.expiry, r.daysLeft])).toEqual([
      ['AAA', 'call', 420, '2026-12-18', 32], ['BBB', 'put', 27.5, '2027-01-15', 60], ['CCC', 'put', 150, '2027-03-19', 123],
    ])
    expect(out.rows.map((r) => r.order)).toEqual([0, 1, 2])
    expect(out.rows.map((r) => [r.hits, r.trades, r.floor, r.premium])).toEqual([[9, 14, 250000, 2240000], [4, 4, 15000, 400000], [3, 3, 25000, 900000]])
    expect(out.rows.map((r) => [r.volToOi, r.openInterest])).toEqual([[4.4, 1200], [null, null], [0.6, 5000]])
    expect(out.rows.map((r) => [r.burst, r.burstHits, r.burstRising, r.shape, r.quietName])).toEqual([
      [true, 6, true, 'intraday_burst', false], [false, 1, false, 'single', true], [false, 2, false, 'single', false],
    ])
    expect(new Set(out.rows.map((r) => r.key)).size).toBe(3)
    expect(out.rows[0].firstAt).toBe(new Date(1794839400 * 1000).toISOString())
    expect(out.latestAt).toBe(new Date(1794855600 * 1000).toISOString())
  })

  it('the direction, and the share on the heavier side worked out from the dollars', () => {
    const out = repeatRead(CONTRACTS)
    expect(out.rows.map((r) => [r.direction, r.leanSide])).toEqual([['bullish', 'bullish'], ['mixed', 'bearish'], ['unclear', null]])
    // 1,926,400 of 2,240,000 is 86%; 220,000 of 400,000 is 55%: percent, 0 to 100
    expect(out.rows.map((r) => (r.leanSharePct == null ? null : Math.round(r.leanSharePct)))).toEqual([86, 55, null])
    expect(out.rows.map(directionWords)).toEqual(['Bullish', 'Mixed, mostly bearish', 'Side not clear'])
    expect(directionWords({ direction: 'bearish' })).toBe('Bearish')
    expect(directionWords({ direction: 'mixed', leanSide: null })).toBe('Mixed')
    expect(directionWords(undefined)).toBe('Side not clear')
  })

  it('the top grade loses its picture and keeps its letters', () => {
    expect(repeatRead(CONTRACTS).rows.map((r) => r.grade)).toEqual(['A', 'A+', 'C'])
    expect(JSON.stringify(repeatRead(CONTRACTS))).not.toContain(ROCKET)
  })

  it('a missing number stays missing, a row with no ticker is dropped, an odd direction is not clear', () => {
    const odd = repeatRead({ query_date: 'soon', contracts: [{ cp: 'C', strike: 10 }, null, { ticker: 'eee', cp: 'X', strike: 0, exp: 'later', direction: 'Sideways' }] })
    expect(odd).toMatchObject({ state: 'ok', date: null, minHits: null, latestAt: null })
    expect(odd.rows).toHaveLength(1)
    expect(odd.rows[0]).toMatchObject({
      sym: 'EEE', side: null, strike: null, expiry: null, daysLeft: null, hits: null, trades: null, premium: null, bull: null, bear: null,
      direction: 'unclear', leanSide: null, leanSharePct: null, volToOi: null, openInterest: null, grade: null, burst: false, score: null,
      firstAt: null, lastAt: null,
    })
  })

  it('no contracts is a healthy answer; anything that is not the route\'s shape is a failed read', () => {
    expect(repeatRead({ ...CONTRACTS, contracts: [], contract_count: 0 })).toMatchObject({ state: 'ok', date: '2026-11-16', rows: [], latestAt: null })
    for (const body of [undefined, null, [], 'x', {}, { contracts: 'none' }, { query_date: '11/16/2026' }, { detail: 'Not authenticated' }, DAY]) {
      const out = repeatRead(body)
      expect(out.state, JSON.stringify(body)?.slice(0, 60)).toBe('failed')
      expect(out.rows).toEqual([])
    }
  })
})

describe('ACCUM orderRows', () => {
  const { rows } = repeatRead(CONTRACTS)

  it('strongest first is the server\'s score; latest first is the order sent', () => {
    expect(orderRows(rows, 'strong').map((r) => r.sym)).toEqual(['BBB', 'AAA', 'CCC'])
    expect(orderRows(rows, 'latest').map((r) => r.sym)).toEqual(['AAA', 'BBB', 'CCC'])
    expect(orderRows(rows, 'nonsense').map((r) => r.sym)).toEqual(['BBB', 'AAA', 'CCC'])
    // the rows handed in are not reordered
    expect(rows.map((r) => r.sym)).toEqual(['AAA', 'BBB', 'CCC'])
  })

  it('a row with no score goes last, and a tie keeps the order sent', () => {
    const mixed = [{ sym: 'X', order: 0, score: null }, { sym: 'Y', order: 1, score: 5 }, { sym: 'Z', order: 2, score: 5 }]
    expect(orderRows(mixed, 'strong').map((r) => r.sym)).toEqual(['Y', 'Z', 'X'])
    expect(orderRows([...mixed].reverse(), 'latest').map((r) => r.sym)).toEqual(['X', 'Y', 'Z'])
  })
})
