// SHRTS, the pure half: the rank words, and the route's answer as the panel draws it.
//   * the rank a word or a key names, the words a chip writes back, the route of each rank;
//   * every status is told apart: ok, computing, unavailable (with its reason), anything else;
//   * a missing number is null, never 0; a row without its symbol or its short interest is
//     dropped and counted;
//   * the count, the cut, the floor, the float coverage and a refused check are carried through.
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SHORT_RANK, SHORT_LIST_CODE, SHORT_RANKS, SHORT_RANK_ARG_WORDS, SOURCE, changeWay, normShortRank, parseShortRank,
  shortListCommandArgs, shortListRead, shortListUrl,
} from './shortListModel'

const row = (sym, over = {}) => ({
  sym, short_interest: 3000000, avg_daily_volume: 500000, days_to_cover: 6, prev_short_interest: 2000000, change_shares: 1000000, change_pct: 50,
  float_shares: 10000000, pct_float: 30, ...over,
})
const answer = (over = {}) => ({
  status: 'ok', rank: 'dtc', settlement_date: '2026-10-30', previous_settlement_date: '2026-10-15', newer_report_landing: null,
  published: null, publication_estimate: '2026-11-10', read_at: '2026-11-18T15:02:11+00:00', count: 3412, universe: 3639, ranked: 3100,
  limit: 100, cut: true, floor_shares: null, rows: [row('ZZA'), row('ZZB', { days_to_cover: 4 })],
  float: { state: 'ok', with_float: 3301, withheld: 4, source: 'x' }, source: 'FINRA, through Massive', check: null, ...over,
})

describe('SHRTS model: the rank words', () => {
  it('names its code and source, and the four ranks in chip order', () => {
    expect(SHORT_LIST_CODE).toBe('SHRTS')
    expect(SOURCE).toBe('FINRA, through Massive')
    expect(Object.keys(SHORT_RANKS)).toEqual(['dtc', 'up', 'down', 'float'])
    expect(DEFAULT_SHORT_RANK).toBe('dtc')
    expect(Object.values(SHORT_RANKS).map((r) => r.token)).toEqual([null, 'UP', 'DOWN', 'FLOAT'])
  })

  it('reads a typed word, in any case, as its rank; anything else is no rank', () => {
    for (const [word, key] of Object.entries(SHORT_RANK_ARG_WORDS)) {
      expect(parseShortRank(word), word).toBe(key)
      expect(parseShortRank(` ${word.toLowerCase()} `), word).toBe(key)
      expect(Object.keys(SHORT_RANKS)).toContain(key)
    }
    for (const no of ['NVDA', '', null, undefined, 'toString', 'constructor', 'dtc1', 7]) expect(parseShortRank(no), String(no)).toBeNull()
    // every chip's own token is one of the typed words, and names that chip
    for (const [key, r] of Object.entries(SHORT_RANKS)) if (r.token) expect(parseShortRank(r.token)).toBe(key)
  })

  it('a prop is a word or a key; an unknown one is the default', () => {
    expect(normShortRank('UP')).toBe('up')
    expect(normShortRank('float')).toBe('float')
    expect(normShortRank('covering')).toBe('down')
    for (const no of [null, undefined, 'banana', 7, {}, 'toString']) expect(normShortRank(no)).toBe('dtc')
  })

  it('a pick writes its word into the command, and the default is the bare command', () => {
    expect(shortListCommandArgs({ rank: 'up' })).toEqual(['UP'])
    expect(shortListCommandArgs({ rank: 'down' })).toEqual(['DOWN'])
    expect(shortListCommandArgs({ rank: 'float' })).toEqual(['FLOAT'])
    expect(shortListCommandArgs({ rank: 'dtc' })).toEqual([])
    expect(shortListCommandArgs()).toEqual([])
    expect(shortListCommandArgs({ rank: 'banana' })).toEqual([])
  })

  it('each rank has its own route', () => {
    expect(shortListUrl('dtc')).toBe('/api/research/short-interest-list?rank=dtc')
    expect(shortListUrl('UP')).toBe('/api/research/short-interest-list?rank=up')
    expect(shortListUrl('banana')).toBe('/api/research/short-interest-list?rank=dtc')
  })
})

describe('SHRTS model: reading the answer', () => {
  it('reads a ranked answer with its dates, its counts and whether it was cut', () => {
    const v = shortListRead(answer())
    expect(v).toMatchObject({
      state: 'ok', rank: 'dtc', settlementDate: '2026-10-30', previousDate: '2026-10-15', landing: null, publicationEstimate: '2026-11-10',
      readAt: '2026-11-18T15:02:11+00:00', count: 3412, universe: 3639, ranked: 3100, limit: 100, cut: true, floorShares: null, unread: 0, check: null,
    })
    expect(v.rows).toEqual([
      { sym: 'ZZA', short: 3000000, adv: 500000, dtc: 6, prevShort: 2000000, changeShares: 1000000, changePct: 50, floatShares: 10000000, pctFloat: 30 },
      { sym: 'ZZB', short: 3000000, adv: 500000, dtc: 4, prevShort: 2000000, changeShares: 1000000, changePct: 50, floatShares: 10000000, pctFloat: 30 },
    ])
    expect(v.float).toEqual({ state: 'ok', withFloat: 3301, withheld: 4 })
  })

  it('a missing number is null, never 0, and a row without its symbol or short interest is dropped and counted', () => {
    const v = shortListRead(answer({
      rank: 'up', floor_shares: 500000, cut: false, ranked: undefined, previous_settlement_date: null, newer_report_landing: '2026-11-13',
      rows: [
        row('zzc', { avg_daily_volume: null, days_to_cover: null, prev_short_interest: null, change_shares: null, change_pct: null, float_shares: null, pct_float: null }),
        row('ZZD', { short_interest: 0, change_shares: -2000000, change_pct: -100 }),
        row('', {}), row('ZZE', { short_interest: null }), null, 'x',
      ],
      float: { state: 'missing' },
    }))
    expect(v.rows).toEqual([
      { sym: 'ZZC', short: 3000000, adv: null, dtc: null, prevShort: null, changeShares: null, changePct: null, floatShares: null, pctFloat: null },
      { sym: 'ZZD', short: 0, adv: 500000, dtc: 6, prevShort: 2000000, changeShares: -2000000, changePct: -100, floatShares: 10000000, pctFloat: 30 },
    ])
    expect(v).toMatchObject({ rank: 'up', floorShares: 500000, cut: false, ranked: 2, previousDate: null, landing: '2026-11-13', unread: 4 })
    expect(v.float).toEqual({ state: 'missing', withFloat: null, withheld: null })
  })

  it('carries a check that did not go well', () => {
    expect(shortListRead(answer({ check: { state: 'unavailable', reason: 'refused', http_status: 403, at: '2026-11-18T15:00:00+00:00' } })).check)
      .toEqual({ state: 'unavailable', reason: 'refused', httpStatus: 403 })
    expect(shortListRead(answer({ check: { state: 'failed', reason: 'vendor', http_status: null } })).check).toEqual({ state: 'failed', reason: 'vendor', httpStatus: null })
    expect(shortListRead(answer({ check: 'x' })).check).toBeNull()
  })

  it('tells every other status apart, and anything else is a failed read', () => {
    expect(shortListRead({ status: 'computing' })).toEqual({ state: 'computing' })
    expect(shortListRead({ status: 'unavailable', reason: 'refused', http_status: 403 })).toEqual({ state: 'unavailable', reason: 'refused', httpStatus: 403 })
    expect(shortListRead({ status: 'unavailable', reason: 'thin', http_status: 200 })).toEqual({ state: 'unavailable', reason: 'thin', httpStatus: 200 })
    expect(shortListRead({ status: 'unavailable' })).toEqual({ state: 'unavailable', reason: null, httpStatus: null })
    for (const bad of [
      null, undefined, 'x', [], {}, { status: 'failed', reason: 'universe' }, { status: 'bad_rank', ranks: [] }, { detail: 'nope' },
      answer({ rows: null }), answer({ settlement_date: 'soon' }), answer({ rank: 'banana' }), answer({ rank: 'toString' }),
    ]) {
      expect(shortListRead(bad), JSON.stringify(bad)).toEqual({ state: 'failed' })
    }
  })

  it('says which way short interest went, and nothing when there is no earlier report', () => {
    expect(changeWay({ changeShares: 5 })).toBe('up')
    expect(changeWay({ changeShares: -5 })).toBe('down')
    expect(changeWay({ changeShares: 0 })).toBe('flat')
    expect(changeWay({ changeShares: null })).toBeNull()
  })
})
