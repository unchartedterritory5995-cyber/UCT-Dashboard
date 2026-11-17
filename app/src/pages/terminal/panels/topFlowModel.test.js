// TOPF, the pure half. Rails:
//   * `pickStats` is the Flow record's own scoring (api/flow_scoreboard.py pick_stats), checked
//     against that file's own test cases: entry, peak, current gain, days tracked, OI confirmed;
//   * fewer than two usable daily prices is NOT SCORED (null), never a 0% and never a loss;
//   * a gain rounds the way Python rounds, an exact tie included;
//   * dates read the Flow record's way; a date with no year is never given one;
//   * open or expired is the server's own list; a stopped pick is told apart;
//   * a not-scored pick never ranks among the gains; filters, counts and how fresh the prices are;
//   * the typed words: no word names two things, every default is the bare command.
// The picks are the store's real shape (api/top_flow_tracker.py), with made-up tickers.
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TOP_FLOW_DIRECTION, DEFAULT_TOP_FLOW_SORT, DEFAULT_TOP_FLOW_STATUS, GRADE_ORDER, MIN_HISTORY_SNAPSHOTS, OI_RISE_FACTOR,
  SNAPSHOT_PICK_CAP, STALE_AFTER_DAYS, TOP_FLOW_CODE, TOP_FLOW_DIRECTIONS, TOP_FLOW_DIRECTION_ARG_WORDS, TOP_FLOW_SORTS,
  TOP_FLOW_SORT_ARG_WORDS, TOP_FLOW_STATUSES, TOP_FLOW_STATUS_ARG_WORDS, TOP_FLOW_URL, cleanGrade, countRows, daysBetween, filterRows,
  normTopFlowDirection, normTopFlowSort, normTopFlowStatus, parsePickDay, parseTopFlowDirection, parseTopFlowSort, parseTopFlowStatus,
  pickStats, priceFreshness, round1, sortRows, topFlowCommandArgs, topFlowRead,
} from './topFlowModel'

const ROCKET = String.fromCodePoint(0x1F680)
const snap = (date, price, oi = 1000, extra = {}) => ({ date, price, oi, spot: 150, volume: 200, ...extra })
const pick = (over = {}) => ({
  id: 'ZZA|C|200.0|8/21/2026', sym: 'ZZA', cp: 'C', strike: 200, exp: '8/21/2026', entry: 2.0, grade: 'A', dir: 'BULL', cap: 'Large',
  dateSaved: '2026-07-01', hits: 4, prem: 1500000, history: [snap('7/1/2026', 2.0), snap('7/2/2026', 3.0, 1300), snap('7/6/2026', 2.5, 900)],
  ...over,
})

describe('TOPF constants', () => {
  it('the code, the route and the Flow record\'s own numbers', () => {
    expect(TOP_FLOW_CODE).toBe('TOPF')
    expect(TOP_FLOW_URL).toBe('/api/top-flow/history')
    expect(MIN_HISTORY_SNAPSHOTS).toBe(2)
    expect(OI_RISE_FACTOR).toBe(1.1)
    expect(GRADE_ORDER).toEqual(['A+', 'A', 'B', 'C', 'D'])
    expect(SNAPSHOT_PICK_CAP).toBe(200)
    expect(STALE_AFTER_DAYS).toBe(4)
  })
})

describe('TOPF parsePickDay (flow_scoreboard parse_pick_date)', () => {
  it('reads M/D/YYYY, M/D/YY and YYYY-MM-DD', () => {
    expect(parsePickDay('7/1/2026')).toBe('2026-07-01')
    expect(parsePickDay('12/18/26')).toBe('2026-12-18')
    expect(parsePickDay(' 3/15/2026 ')).toBe('2026-03-15')
    expect(parsePickDay('2026-07-01')).toBe('2026-07-01')
    expect(parsePickDay('2026-07-01T16:30:00')).toBe('2026-07-01')
  })
  it('a date with no year is never given one; an impossible or unreadable date is null', () => {
    for (const bad of ['6/20', '6', '', '   ', null, undefined, 20260701, '2/30/2026', '2026-02-30', '13/1/2026', 'a/b/c', '2026-7-1', {}, []]) {
      expect(parsePickDay(bad), String(bad)).toBeNull()
    }
  })
  it('daysBetween counts whole calendar days, and null with a date that does not read', () => {
    expect(daysBetween('2026-07-01', '2026-07-06')).toBe(5)
    expect(daysBetween('2026-03-06', '2026-03-09')).toBe(3) // across the clock change
    expect(daysBetween('7/1/2026', '2026-07-01')).toBe(0)
    expect(daysBetween('6/20', '2026-07-01')).toBeNull()
  })
})

describe('TOPF cleanGrade (flow_scoreboard clean_grade)', () => {
  it('keeps the five grades and drops a picture, a case and anything else', () => {
    expect(cleanGrade(`A+ ${ROCKET}`)).toBe('A+')
    expect(cleanGrade(' a ')).toBe('A')
    expect(cleanGrade('b')).toBe('B')
    for (const none of ['B+', 'E', '', '  ', null, undefined, 7, 'AA', 'A++']) expect(cleanGrade(none), String(none)).toBe('')
  })
})

describe('TOPF round1 (Python round(x, 1))', () => {
  it('goes to the even digit on an exact tie, as Python does', () => {
    expect(round1(6.25)).toBe(6.2)
    expect(round1(6.75)).toBe(6.8)
    expect(round1(-6.25)).toBe(-6.2)
    expect(round1(0.25)).toBe(0.2)
    expect(round1(112.75)).toBe(112.8)
  })
  it('rounds everything else to the nearest tenth, and has no negative zero', () => {
    expect(round1(6.35)).toBe(6.3) // 6.35 is just under the tie in binary; Python agrees
    expect(round1(0.15)).toBe(0.1)
    expect(round1(49.96)).toBe(50)
    expect(round1(-49.96)).toBe(-50)
    expect(round1(25)).toBe(25)
    expect(Object.is(round1(-0.01), 0)).toBe(true)
    expect(round1(NaN)).toBeNull()
    expect(round1(Infinity)).toBeNull()
  })
})

describe('TOPF pickStats (flow_scoreboard pick_stats)', () => {
  it('entry, peak, latest and both gains in percent, the days tracked and the open interest', () => {
    expect(pickStats(pick())).toEqual({
      entry: 2, entryFromFirstPrice: false, peakPrice: 3, latestPrice: 2.5, maxGainPct: 50, currentGainPct: 25, daysTracked: 5,
      firstDay: '2026-07-01', lastDay: '2026-07-06', prices: 3, oiEvaluable: true, oiConfirmed: true,
    })
  })

  it('fewer than two usable prices is not scored: null, never a 0% and never a loss', () => {
    expect(pickStats(pick({ history: [] }))).toBeNull()
    expect(pickStats(pick({ history: undefined }))).toBeNull()
    expect(pickStats(pick({ history: [snap('7/1/2026', 2.0)] }))).toBeNull()
    // a quote of 0, a missing price and a non-number are not prices
    expect(pickStats(pick({ history: [snap('7/1/2026', 2.0), snap('7/2/2026', 0), snap('7/3/2026', null), snap('7/6/2026', 'n/a'), snap('7/7/2026', true)] }))).toBeNull()
    expect(pickStats(null)).toBeNull()
    expect(pickStats({})).toBeNull()
  })

  it('a missing or zero entry falls back to the first tracked price, and says so', () => {
    const s = pickStats(pick({ entry: 0, history: [snap('7/1/2026', 4.0), snap('7/2/2026', 5.0)] }))
    expect(s).toMatchObject({ entry: 4, entryFromFirstPrice: true, maxGainPct: 25, currentGainPct: 25 })
    expect(pickStats(pick({ entry: undefined })).entryFromFirstPrice).toBe(true)
    expect(pickStats(pick({ entry: '2.0' }))).toMatchObject({ entry: 2, entryFromFirstPrice: false })
  })

  it('a losing pick keeps its loss, and a quote of 0 after it is skipped (the last priced day stands)', () => {
    const s = pickStats(pick({ entry: 4.0, history: [snap('7/1/2026', 4.0), snap('7/2/2026', 1.0), snap('7/3/2026', 0)] }))
    expect(s).toMatchObject({ peakPrice: 4, latestPrice: 1, maxGainPct: 0, currentGainPct: -75, daysTracked: 1, prices: 2 })
  })

  it('snapshots are read oldest first by their dates, whatever order they were stored in', () => {
    const s = pickStats(pick({ history: [snap('7/6/2026', 2.5), snap('7/1/2026', 2.0), snap('7/2/2026', 3.0)] }))
    expect(s).toMatchObject({ latestPrice: 2.5, firstDay: '2026-07-01', lastDay: '2026-07-06', daysTracked: 5 })
  })

  it('days tracked falls back to the count of intervals when a date does not read', () => {
    const s = pickStats(pick({ history: [snap('7/1', 2.0), snap('7/2', 3.0), snap('7/3', 2.5)] }))
    expect(s).toMatchObject({ daysTracked: 2, firstDay: null, lastDay: null, latestPrice: 2.5 })
    // an undated snapshot sorts first (the Flow record's date.min), so the span is not a calendar one
    expect(pickStats(pick({ history: [snap('7/2/2026', 3.0), snap('', 2.0), snap('7/6/2026', 2.5)] }))).toMatchObject({ daysTracked: 2, firstDay: null })
  })

  it('OI confirmed needs a later open interest more than 10% above the first; a first of 0 cannot be judged', () => {
    const at = (ois) => pickStats(pick({ history: ois.map((oi, i) => snap(`7/${i + 1}/2026`, 2 + i, oi)) }))
    expect(at([1000, 1100])).toMatchObject({ oiEvaluable: true, oiConfirmed: false })
    expect(at([1000, 1101])).toMatchObject({ oiEvaluable: true, oiConfirmed: true })
    expect(at([1000, 900, 1200])).toMatchObject({ oiConfirmed: true })
    expect(at([0, 5000])).toMatchObject({ oiEvaluable: false, oiConfirmed: false })
    expect(at([null, 'x'])).toMatchObject({ oiEvaluable: false, oiConfirmed: false })
  })

  it('a gain rounds the way the Flow record rounds it', () => {
    // (2.125 - 2) / 2 * 100 is exactly 6.25: Python's round gives 6.2
    expect(pickStats(pick({ entry: 2, history: [snap('7/1/2026', 2.0), snap('7/2/2026', 2.125)] })).currentGainPct).toBe(6.2)
    expect(pickStats(pick({ entry: 3, history: [snap('7/1/2026', 3.0), snap('7/2/2026', 4.0)] })).currentGainPct).toBe(33.3)
  })
})

describe('TOPF topFlowRead', () => {
  const BODY = {
    active: [
      pick(),
      pick({ id: 'ZZB|P|27.5|6/20', sym: 'zzb', cp: 'P', strike: 27.5, exp: '6/20', entry: 1.2, grade: `A+ ${ROCKET}`, dir: 'BEAR', dateSaved: '2026-07-06', history: [snap('7/6/2026', 1.3)] }),
      pick({ id: 'ZZC|C|50.0|9/18/2026', sym: 'ZZC', strike: 50, exp: '9/18/2026', entry: 0, grade: 'B+', dir: '', dateSaved: '7/6/2026', history: [] }),
    ],
    archived: [
      pick({ id: 'ZZD|C|10.0|6/19/2026', sym: 'ZZD', strike: 10, exp: '6/19/2026', entry: 4.0, grade: 'C', dateSaved: '2026-06-01', archivedDate: '2026-06-20', finalPrice: 0, finalPnl: 0,
        history: [snap('6/1/2026', 4.0), snap('6/18/2026', 1.0), snap('6/19/2026', 0)] }),
      pick({ id: 'ZZE|P|5.0|6/12/2026', sym: 'ZZE', cp: 'P', strike: 5, exp: '6/12/2026', entry: 0.5, dir: 'BEAR', dateSaved: '2026-06-10', archivedDate: '2026-06-13', finalPrice: 0.4, finalPnl: -20,
        history: [snap('6/11/2026', 0.4)] }),
      pick({ id: 'ZZF|C|80.0|12/18/2026', sym: 'ZZF', strike: 80, exp: '12/18/2026', entry: 3.0, dateSaved: '2026-05-01', archivedDate: '2026-07-01', purgeReason: 'older than 60d', finalPrice: 6, finalPnl: 100,
        history: [snap('5/1/2026', 3.0), snap('5/4/2026', 6.0)] }),
    ],
  }

  it('one row per pick, open then expired, with the server\'s own split and the Flow record\'s scoring', () => {
    const v = topFlowRead(BODY)
    expect(v.state).toBe('ok')
    expect(v.unread).toBe(0)
    expect(v.newestDay).toBe('2026-07-06')
    expect(v.rows.map((r) => [r.sym, r.status, r.scored])).toEqual([
      ['ZZA', 'open', true], ['ZZB', 'open', false], ['ZZC', 'open', false], ['ZZD', 'expired', true], ['ZZE', 'expired', false], ['ZZF', 'expired', true],
    ])
    expect(v.rows[0]).toEqual({
      key: 'topf-open-0-ZZA|C|200.0|8/21/2026', id: 'ZZA|C|200.0|8/21/2026', sym: 'ZZA', status: 'open', stopped: false, side: 'call', strike: 200,
      exp: '8/21/2026', grade: 'A', direction: 'bullish', savedDay: '2026-07-01', savedText: '2026-07-01', scored: true, prices: 3, entry: 2,
      entryFromFirstPrice: false, latestPrice: 2.5, latestDay: '2026-07-06', laterQuoteNoPrice: false, peakPrice: 3, currentGainPct: 25,
      maxGainPct: 50, daysTracked: 5, oiEvaluable: true, oiConfirmed: true, premium: 1500000, hits: 4, capBand: 'Large',
    })
  })

  it('a pick that is not scored carries no gain at all (null, never 0), but keeps the one price it has', () => {
    const [, one, none, , expiredOne] = topFlowRead(BODY).rows
    expect(one).toMatchObject({
      sym: 'ZZB', side: 'put', exp: '6/20', grade: 'A+', direction: 'bearish', scored: false, prices: 1, entry: 1.2, latestPrice: 1.3,
      latestDay: '2026-07-06', currentGainPct: null, maxGainPct: null, peakPrice: null, daysTracked: null,
    })
    expect(none).toMatchObject({
      sym: 'ZZC', grade: null, direction: null, savedDay: '2026-07-06', savedText: '7/6/2026', scored: false, prices: 0, entry: null,
      latestPrice: null, latestDay: null, currentGainPct: null, maxGainPct: null,
    })
    // the store says -20% for it; one daily price is not a result, so the row carries none
    expect(expiredOne).toMatchObject({ sym: 'ZZE', status: 'expired', scored: false, prices: 1, currentGainPct: null })
    expect(JSON.stringify(topFlowRead(BODY).rows)).not.toContain('finalPnl')
  })

  it('an expired pick keeps the gain of its last PRICED day, and says a later quote had no price', () => {
    const zzd = topFlowRead(BODY).rows[3]
    expect(zzd).toMatchObject({ status: 'expired', stopped: false, scored: true, latestPrice: 1, latestDay: '2026-06-18', currentGainPct: -75, maxGainPct: 0, laterQuoteNoPrice: true })
    expect(topFlowRead(BODY).rows[5]).toMatchObject({ sym: 'ZZF', status: 'expired', stopped: true, currentGainPct: 100, laterQuoteNoPrice: false })
  })

  it('an answer that is not the route\'s shape is "failed", never an empty list', () => {
    for (const body of [undefined, null, [], 'x', 7, {}, { detail: 'Not authenticated' }, { active: [] }, { archived: [] }, { active: {}, archived: [] }]) {
      expect(topFlowRead(body).state, JSON.stringify(body)).toBe('failed')
    }
    expect(topFlowRead({ active: [], archived: [] })).toEqual({ state: 'ok', rows: [], newestDay: null, unread: 0 })
  })

  it('an entry with no readable symbol is counted, not drawn; odd fields become null, not guesses', () => {
    const v = topFlowRead({
      active: [null, 'ZZA', { sym: '' }, { sym: '<b>' }, pick({ sym: 'BRK.B', cp: 'X', strike: 'abc', exp: '', grade: 7, dir: 'SIDEWAYS', dateSaved: '', hits: 'many', prem: -5, cap: '' })],
      archived: [],
    })
    expect(v.unread).toBe(4)
    expect(v.rows).toHaveLength(1)
    expect(v.rows[0]).toMatchObject({
      sym: 'BRK.B', side: null, strike: null, exp: null, grade: null, direction: null, savedDay: null, savedText: null, hits: null, premium: null, capBand: null,
    })
  })

  it('two picks with one id keep two rows and two keys', () => {
    const v = topFlowRead({ active: [pick(), pick()], archived: [pick()] })
    expect(new Set(v.rows.map((r) => r.key)).size).toBe(3)
  })
})

describe('TOPF filterRows, sortRows, countRows', () => {
  const row = (over) => ({ sym: 'ZZA', status: 'open', stopped: false, direction: 'bullish', scored: true, prices: 3, currentGainPct: 10, maxGainPct: 20, savedDay: '2026-07-01', ...over })
  const ROWS = [
    row({ sym: 'UP', currentGainPct: 40, maxGainPct: 45, savedDay: '2026-06-01' }),
    row({ sym: 'NEW', scored: false, prices: 1, currentGainPct: null, maxGainPct: null, savedDay: '2026-07-06' }),
    row({ sym: 'DOWN', direction: 'bearish', currentGainPct: -60, maxGainPct: 90, savedDay: '2026-06-15' }),
    row({ sym: 'OLD', status: 'expired', currentGainPct: 5, maxGainPct: 5, savedDay: '2026-03-01' }),
    row({ sym: 'NONE', scored: false, prices: 0, direction: null, currentGainPct: null, maxGainPct: null, savedDay: null }),
    row({ sym: 'GONE', status: 'expired', stopped: true, scored: false, prices: 1, direction: 'bearish', currentGainPct: null, maxGainPct: null, savedDay: '2026-04-01' }),
  ]
  const syms = (rows) => rows.map((r) => r.sym)

  it('filters by the server\'s split and by direction; no direction is only under "any"', () => {
    expect(syms(filterRows(ROWS, {}))).toEqual(['UP', 'NEW', 'DOWN', 'OLD', 'NONE', 'GONE'])
    expect(syms(filterRows(ROWS, { status: 'open' }))).toEqual(['UP', 'NEW', 'DOWN', 'NONE'])
    expect(syms(filterRows(ROWS, { status: 'expired' }))).toEqual(['OLD', 'GONE'])
    expect(syms(filterRows(ROWS, { direction: 'bearish' }))).toEqual(['DOWN', 'GONE'])
    expect(syms(filterRows(ROWS, { status: 'OPEN', direction: 'BULL' }))).toEqual(['UP', 'NEW'])
    expect(filterRows(null, {})).toEqual([])
  })

  it('a pick that is not scored never ranks among the gains: it goes last, newest first', () => {
    expect(syms(sortRows(ROWS, 'gain'))).toEqual(['UP', 'OLD', 'DOWN', 'NEW', 'GONE', 'NONE'])
    expect(syms(sortRows(ROWS, 'loss'))).toEqual(['DOWN', 'OLD', 'UP', 'NEW', 'GONE', 'NONE'])
    expect(syms(sortRows(ROWS, 'peak'))).toEqual(['DOWN', 'UP', 'OLD', 'NEW', 'GONE', 'NONE'])
    expect(syms(sortRows(ROWS, 'newest'))).toEqual(['NEW', 'DOWN', 'UP', 'GONE', 'OLD', 'NONE'])
    expect(syms(sortRows(ROWS))).toEqual(syms(sortRows(ROWS, 'gain')))
    // the input is not reordered
    expect(syms(ROWS)).toEqual(['UP', 'NEW', 'DOWN', 'OLD', 'NONE', 'GONE'])
  })

  it('equal gains keep the newer pick first, then the order sent', () => {
    const tie = [row({ sym: 'B', savedDay: '2026-01-01' }), row({ sym: 'A', savedDay: '2026-02-01' }), row({ sym: 'C', savedDay: '2026-02-01' })]
    expect(syms(sortRows(tie, 'gain'))).toEqual(['A', 'C', 'B'])
  })

  it('counts open, expired, stopped, scored, too new, never scored and each direction', () => {
    expect(countRows(ROWS)).toEqual({ all: 6, open: 4, expired: 2, stopped: 1, scored: 3, tooNew: 2, neverScored: 1, noPrice: 1, bullish: 3, bearish: 2 })
    expect(countRows([])).toEqual({ all: 0, open: 0, expired: 0, stopped: 0, scored: 0, tooNew: 0, neverScored: 0, noPrice: 0, bullish: 0, bearish: 0 })
  })
})

describe('TOPF priceFreshness', () => {
  const view = (rows, newestDay) => ({ rows, newestDay })
  it('says how old the newest daily price is, and when the history has stopped', () => {
    expect(priceFreshness(view([], '2026-07-06'), '2026-07-06')).toEqual({ newestDay: '2026-07-06', ageDays: 0, stale: false, behind: 0, newestPickDay: null, pickAgeDays: null, noNewPicks: false })
    expect(priceFreshness(view([], '2026-07-02'), '2026-07-06')).toMatchObject({ ageDays: 4, stale: false }) // a long weekend
    expect(priceFreshness(view([], '2026-07-01'), '2026-07-06')).toMatchObject({ ageDays: 5, stale: true })
    expect(priceFreshness(view([], null), '2026-07-06')).toEqual({ newestDay: null, ageDays: null, stale: false, behind: 0, newestPickDay: null, pickAgeDays: null, noNewPicks: false })
    expect(priceFreshness(view([], '2026-07-06'), 'today')).toMatchObject({ ageDays: null, stale: false })
  })
  it('says when the newest PICK is weeks old, a different question from the newest price', () => {
    const rows = [{ status: 'open', savedDay: '2026-06-01' }, { status: 'expired', savedDay: '2026-05-10' }, { status: 'open', savedDay: null }]
    expect(priceFreshness(view(rows, '2026-07-06'), '2026-07-06')).toMatchObject({ newestPickDay: '2026-06-01', pickAgeDays: 35, noNewPicks: true, stale: false })
    const recent = [{ status: 'open', savedDay: '2026-06-22' }]
    expect(priceFreshness(view(recent, '2026-07-06'), '2026-07-06')).toMatchObject({ pickAgeDays: 14, noNewPicks: false })
    expect(priceFreshness(view([{ status: 'open', savedDay: null }], '2026-07-06'), '2026-07-06')).toMatchObject({ newestPickDay: null, noNewPicks: false })
  })
  it('counts the open picks whose latest price is older than the newest day on record', () => {
    const rows = [
      { status: 'open', latestDay: '2026-07-06' }, { status: 'open', latestDay: '2026-07-01' }, { status: 'open', latestDay: null },
      { status: 'expired', latestDay: '2026-06-01' },
    ]
    expect(priceFreshness(view(rows, '2026-07-06'), '2026-07-06').behind).toBe(1)
  })
})

describe('TOPF typed words', () => {
  it('no word names two things, and every word leads to a real choice', () => {
    const maps = [[TOP_FLOW_STATUS_ARG_WORDS, TOP_FLOW_STATUSES], [TOP_FLOW_DIRECTION_ARG_WORDS, TOP_FLOW_DIRECTIONS], [TOP_FLOW_SORT_ARG_WORDS, TOP_FLOW_SORTS]]
    const words = maps.flatMap(([m]) => Object.keys(m))
    expect(new Set(words).size).toBe(words.length)
    for (const [m, choices] of maps) {
      for (const [w, key] of Object.entries(m)) {
        expect(w).toBe(w.toUpperCase())
        expect(Object.keys(choices), w).toContain(key)
      }
      // every chip's own token parses back to that chip
      for (const [key, c] of Object.entries(choices)) if (c.token) expect(m[c.token], c.token).toBe(key)
    }
  })

  it('parses a word in any case, and nothing else', () => {
    expect(parseTopFlowStatus(' open ')).toBe('open')
    expect(parseTopFlowStatus('Expired')).toBe('expired')
    expect(parseTopFlowDirection('bear')).toBe('bearish')
    expect(parseTopFlowSort('peak')).toBe('peak')
    expect(parseTopFlowSort('NEW')).toBe('newest')
    for (const no of ['', null, undefined, 'constructor', 'toString', 'ALL', 'NVDA']) {
      expect([parseTopFlowStatus(no), parseTopFlowDirection(no), parseTopFlowSort(no)], String(no)).toEqual([null, null, null])
    }
  })

  it('a prop is a word or a key; anything unknown is the default', () => {
    expect([normTopFlowStatus('expired'), normTopFlowStatus('ARCHIVED'), normTopFlowStatus('all'), normTopFlowStatus('x'), normTopFlowStatus(null)])
      .toEqual(['expired', 'expired', 'all', DEFAULT_TOP_FLOW_STATUS, DEFAULT_TOP_FLOW_STATUS])
    expect([normTopFlowDirection('bullish'), normTopFlowDirection('BEAR'), normTopFlowDirection('any'), normTopFlowDirection('hasOwnProperty')])
      .toEqual(['bullish', 'bearish', 'any', DEFAULT_TOP_FLOW_DIRECTION])
    expect([normTopFlowSort('newest'), normTopFlowSort('losers'), normTopFlowSort(undefined)]).toEqual(['newest', 'loss', DEFAULT_TOP_FLOW_SORT])
  })

  it('a choice writes its words into the command, and every default is the bare command', () => {
    expect(topFlowCommandArgs()).toEqual([])
    expect(topFlowCommandArgs({ status: 'all', direction: 'any', sort: 'gain' })).toEqual([])
    expect(topFlowCommandArgs({ status: 'open' })).toEqual(['OPEN'])
    expect(topFlowCommandArgs({ status: 'expired', direction: 'bearish', sort: 'peak' })).toEqual(['EXPIRED', 'BEAR', 'PEAK'])
    expect(topFlowCommandArgs({ direction: 'bullish', sort: 'newest' })).toEqual(['BULL', 'NEW'])
    expect(topFlowCommandArgs({ sort: 'loss' })).toEqual(['LOSERS'])
    // the words a command writes read back as the same choice
    const round = topFlowCommandArgs({ status: 'expired', direction: 'bullish', sort: 'loss' })
    expect([parseTopFlowStatus(round[0]), parseTopFlowDirection(round[1]), parseTopFlowSort(round[2])]).toEqual(['expired', 'bullish', 'loss'])
  })
})
